import { useRef, useState, type ClipboardEvent, type CSSProperties } from 'react';
import { ArrowLeft, Check, ChevronRight, Copy, LogOut, QrCode, Share2, Swords, Users, Wifi } from 'lucide-react';
import type { OnlineView } from '../game/online';
import { ARENAS, FIGHTERS, type ArenaId, type FighterId } from '../game/types';
import { ArenaThumbnail, FighterPortrait } from './GameUI';

const CODE_PATTERN = /^(SF[01]-[OA]-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{4,12})$/;
const looksLikeCode = (text: string) => CODE_PATTERN.test(text.replace(/\s+/g, '')) || text.includes('?join=');

// ---- Zero-Dependency ISO/IEC 18004 QR Code SVG Generator (Versions 1..6, ECC-L) -------------

const QR_VERSIONS = [
  { size: 21, dataBytes: 19, eccBytes: 7, align: [] as number[] },
  { size: 25, dataBytes: 34, eccBytes: 10, align: [6, 18] },
  { size: 29, dataBytes: 55, eccBytes: 15, align: [6, 22] },
  { size: 33, dataBytes: 80, eccBytes: 20, align: [6, 26] },
  { size: 37, dataBytes: 108, eccBytes: 26, align: [6, 30] },
  { size: 41, dataBytes: 136, eccBytes: 36, align: [6, 34] }, // 2 blocks of (68 data, 18 ecc)
];

function makeQrMatrix(text: string): boolean[][] | null {
  const payload = new TextEncoder().encode(text);
  const verIdx = QR_VERSIONS.findIndex(v => payload.length + 2 <= v.dataBytes);
  if (verIdx === -1) return null;
  const ver = QR_VERSIONS[verIdx];
  const size = ver.size;

  // 1. Encode data bits (Byte mode 0100)
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(payload.length, 8);
  for (const b of payload) pushBits(b, 8);
  const maxBits = ver.dataBytes * 8;
  pushBits(0, Math.min(4, maxBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data = new Uint8Array(ver.dataBytes);
  for (let i = 0; i < bits.length / 8; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
    data[i] = byte;
  }
  for (let i = bits.length / 8, p = 0; i < ver.dataBytes; i++, p ^= 1) {
    data[i] = p === 0 ? 0xec : 0x11;
  }

  // 2. Reed-Solomon ECC in GF(256) with 0x11d
  const exp = new Uint8Array(512);
  const log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : exp[log[a] + log[b]]);

  const computeEcc = (block: Uint8Array, eccLen: number): Uint8Array => {
    let poly = new Uint8Array([1]);
    for (let i = 0; i < eccLen; i++) {
      const next = new Uint8Array(poly.length + 1);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], exp[i]);
      }
      poly = next;
    }
    const rem = new Uint8Array(eccLen);
    for (const b of block) {
      const factor = b ^ rem[0];
      rem.copyWithin(0, 1);
      rem[eccLen - 1] = 0;
      for (let j = 0; j < eccLen; j++) rem[j] ^= gfMul(poly[j + 1], factor);
    }
    return rem;
  };

  let codewords: number[] = [];
  if (verIdx < 5) {
    const ecc = computeEcc(data, ver.eccBytes);
    codewords = [...data, ...ecc];
  } else {
    const b1 = data.subarray(0, 68), b2 = data.subarray(68, 136);
    const e1 = computeEcc(b1, 18), e2 = computeEcc(b2, 18);
    for (let i = 0; i < 68; i++) codewords.push(b1[i], b2[i]);
    for (let i = 0; i < 18; i++) codewords.push(e1[i], e2[i]);
  }

  // 3. Matrix setup & function patterns
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunc: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const setFunc = (r: number, c: number, val: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) { modules[r][c] = val; isFunc[r][c] = true; }
  };

  const drawFinder = (r0: number, c0: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunc(r0 + dr, c0 + dc, inOuter && (onBorder || inInner));
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  if (ver.align.length === 2) {
    const ar = ver.align[1], ac = ver.align[1];
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        setFunc(ar + dr, ac + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
  }

  // Reserve format info areas
  for (let i = 0; i < 9; i++) { setFunc(8, i, false); setFunc(i, 8, false); }
  for (let i = 0; i < 8; i++) { setFunc(8, size - 1 - i, false); setFunc(size - 1 - i, 8, false); }
  setFunc(size - 8, 8, true);

  // 4. Place data bits + Mask 0 ((r + c) % 2 === 0)
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!isFunc[r][c]) {
          const bit = bitIdx < totalBits ? ((codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1 : false;
          modules[r][c] = bit !== ((r + c) % 2 === 0);
          bitIdx++;
        }
      }
    }
  }

  // 5. Place Format Info for ECC Level L (01) + Mask 0 (000) -> 0x7584
  const fmt = 0x7584;
  const fBit = (i: number) => ((fmt >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) modules[8][i] = fBit(14 - i);
  modules[8][7] = fBit(8);
  modules[8][8] = fBit(7);
  modules[7][8] = fBit(6);
  for (let i = 0; i <= 5; i++) modules[5 - i][8] = fBit(5 - i);
  for (let i = 0; i <= 6; i++) modules[size - 1 - i][8] = fBit(14 - i);
  for (let i = 0; i <= 7; i++) modules[8][size - 8 + i] = fBit(7 - i);

  return modules;
}

function QrCodeSvg({ value, size = 184 }: { value: string; size?: number }) {
  const matrix = makeQrMatrix(value);
  if (!matrix) return null;
  const n = matrix.length;
  const margin = 2;
  const total = n + margin * 2;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) path += `M${c + margin},${r + margin}h1v1h-1z`;
    }
  }
  return (
    <svg viewBox={`0 0 ${total} ${total}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label="QR-код для входа в лобби">
      <rect width={total} height={total} fill="#ffffff" rx={1.5} />
      <path d={path} fill="#090d16" />
    </svg>
  );
}

// ---- Helpers & UI Components ----------------------------------------------------------------

async function copyText(text: string, field: HTMLTextAreaElement | HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* Fall back to the old way below. */ }
  if (!field) return false;
  field.focus(); field.select();
  try { return document.execCommand('copy'); } catch { return false; }
}

function buildJoinUrl(code: string): string {
  if (!code) return '';
  const url = new URL(window.location.href);
  url.searchParams.set('join', code);
  return url.toString();
}

function CodeBox({ code, busy, label, showQr = false }: { code: string; busy: boolean; label: string; showQr?: boolean }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const canShare = typeof navigator.share === 'function';
  const joinUrl = buildJoinUrl(code);
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  const copy = async () => {
    if (!code) return;
    const ok = await copyText(code, field.current);
    if (ok) { setCopied(true); window.setTimeout(() => setCopied(false), 2200); }
  };

  const copyLink = async () => {
    if (!joinUrl) return;
    const ok = await copyText(joinUrl, field.current);
    if (ok) { setCopiedLink(true); window.setTimeout(() => setCopiedLink(false), 2200); }
  };

  const share = async () => {
    try {
      await navigator.share({
        title: 'StickFighting — Вход в лобби',
        text: `Заходи в бой! Код комнаты: ${code}`,
        url: joinUrl || undefined,
      });
    } catch { /* The player closed the sheet. */ }
  };

  return <div className="code-box">
    {showQr && code && (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', marginBottom: '14px', padding: '16px', background: 'rgba(255,255,255,0.04)', borderRadius: '14px' }}>
        <div style={{ background: '#ffffff', padding: '8px', borderRadius: '12px', lineHeight: 0, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
          <QrCodeSvg value={joinUrl} size={184} />
        </div>
        <span style={{ fontSize: '0.85rem', opacity: 0.85, display: 'flex', alignItems: 'center', gap: '6px', textAlign: 'center' }}>
          <QrCode size={16} /> Отсканируй камерой телефона, чтобы сразу войти в лобби
        </span>
        {isLocalhost && (
          <small style={{ fontSize: '0.75rem', opacity: 0.65, textAlign: 'center', maxWidth: '340px' }}>
            Игра открыта на localhost. Чтобы сканировать QR с телефона в локальной сети, открой игру по IP компьютера (например, http://192.168.x.x:5173).
          </small>
        )}
      </div>
    )}

    <textarea
      ref={field}
      readOnly
      aria-label={label}
      className="code-field"
      rows={code.length > 20 ? 3 : 1}
      style={code.length <= 12 ? { fontSize: '1.5rem', textAlign: 'center', letterSpacing: '0.2em', fontWeight: 800 } : undefined}
      spellCheck={false}
      placeholder={busy ? 'Создаём комнату и QR-код…' : ''}
      value={code}
      onFocus={event => event.currentTarget.select()}
    />
    <div className="code-actions">
      <button type="button" className="secondary-button compact" disabled={!code} onClick={() => void copy()}>
        {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Скопировано' : 'Копировать код'}
      </button>
      {showQr && (
        <button type="button" className="secondary-button compact" disabled={!code} onClick={() => void copyLink()}>
          {copiedLink ? <Check size={16} /> : <Copy size={16} />} {copiedLink ? 'Ссылка скопирована' : 'Копировать ссылку'}
        </button>
      )}
      {canShare && (
        <button type="button" className="secondary-button compact" disabled={!code} onClick={() => void share()}>
          <Share2 size={16} /> Поделиться
        </button>
      )}
    </div>
  </div>;
}

function PasteBox({ label, placeholder, button, busy, disabled, onSubmit }: {
  label: string; placeholder: string; button: string; busy: boolean; disabled: boolean; onSubmit: (code: string) => void;
}) {
  const [text, setText] = useState('');
  const submit = (value: string) => { if (value.trim()) onSubmit(value.trim()); };
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (looksLikeCode(pasted)) { event.preventDefault(); setText(pasted); submit(pasted); }
  };
  return <div className="code-box">
    <textarea
      aria-label={label}
      className="code-field"
      rows={2}
      spellCheck={false}
      autoComplete="off"
      autoCapitalize="characters"
      placeholder={placeholder}
      value={text}
      disabled={disabled}
      onChange={event => setText(event.target.value)}
      onPaste={paste}
    />
    <div className="code-actions">
      <button type="button" className="primary-button compact" disabled={disabled || busy || !text.trim()} onClick={() => submit(text)}>
        {button} <ChevronRight size={18} />
      </button>
    </div>
  </div>;
}

function Status({ tone = 'info', children }: { tone?: 'info' | 'ok' | 'error'; children: string }) {
  return <p className={`online-status ${tone}`} role="status"><span className="live-dot" />{children}</p>;
}

export function OnlineScreen({ view, onChoose, onJoin, onAccept, onRestart, onBack }: {
  view: OnlineView | null;
  onChoose: (role: 'host' | 'guest') => void;
  onJoin: (code: string) => void;
  onAccept: (code: string) => void;
  onRestart: () => void;
  onBack: () => void;
}) {
  const failed = view && (view.link === 'failed' || view.link === 'closed');
  return <div className="setup-screen online-screen screen-enter">
    <div className="setup-top"><div><div className="eyebrow">ИГРА ПО СЕТИ</div><h1>{view ? (view.role === 'host' ? 'Пригласи соперника.' : 'Подключись к игре.') : 'Бой с живым соперником.'}</h1></div><button type="button" className="text-button setup-back" onClick={onBack}><ArrowLeft size={17} /> Назад</button></div>

    {!view && <>
      <div className="online-modes">
        <button type="button" className="online-mode" onClick={() => onChoose('host')}>
          <Wifi size={26} /><strong>СОЗДАТЬ ИГРУ</strong>
          <span>Твоё устройство создаёт комнату и показывает QR-код. Друг сканирует его и сразу попадает в лобби.</span>
          <small>ХОСТ <ChevronRight size={15} /></small>
        </button>
        <button type="button" className="online-mode" onClick={() => onChoose('guest')}>
          <Users size={26} /><strong>ПОДКЛЮЧИТЬСЯ</strong>
          <span>Введи 6-значный код комнаты друга или отсканируй его QR-код камерой телефона.</span>
          <small>ГОСТЬ <ChevronRight size={15} /></small>
        </button>
      </div>
      <p className="online-note">Отсканируй QR-код на экране хоста или введи короткий код комнаты — лобби выбора бойцов откроется автоматически.</p>
    </>}

    {view?.role === 'host' && <>
      <div className="setup-field-heading"><span className="step-number">01</span><span>ОТСКАНИРУЙ QR-КОД ИЛИ ОТПРАВЬ КОД КОМНАТЫ ДРУГУ</span></div>
      <CodeBox code={view.code} busy={view.busy} label="Код комнаты" showQr />

      {view.code.startsWith('SF') && <>
        <div className="setup-field-heading"><span className="step-number">02</span><span>ВСТАВЬ ОТВЕТНЫЙ КОД ОТ ДРУГА</span></div>
        <PasteBox label="Ответный код друга" placeholder="Сюда вставь код, который друг пришлёт в ответ" button="ПОДКЛЮЧИТЬ" busy={view.busy} disabled={!view.code || view.link === 'connecting' || !!failed} onSubmit={onAccept} />
      </>}

      {view.error && <Status tone="error">{view.error}</Status>}
      {!view.error && failed && <Status tone="error">{view.detail || 'Соединение не удалось.'}</Status>}
      {!view.error && !failed && (
        <Status>
          {view.busy && !view.code
            ? 'Создаём комнату и QR-код…'
            : view.link === 'connecting'
              ? 'Друг подключился! Открываем лобби…'
              : 'Ждём, пока друг отсканирует QR-код или введёт код комнаты. Лобби откроется само.'}
        </Status>
      )}
      {(failed || view.error) && <button type="button" className="text-button" onClick={onRestart}>Создать комнату заново</button>}
    </>}

    {view?.role === 'guest' && <>
      <div className="setup-field-heading"><span className="step-number">01</span><span>ВВЕДИ КОД КОМНАТЫ (ИЛИ СКАНИРУЙ QR-КОД ХОСТА)</span></div>
      <PasteBox label="Код комнаты" placeholder="Например: K7M9P2 (или ссылка от друга)" button="ВОЙТИ В ЛОББИ" busy={view.busy} disabled={view.link === 'connecting' || !!failed} onSubmit={onJoin} />
      {view.code && <>
        <div className="setup-field-heading"><span className="step-number">02</span><span>ОТПРАВЬ ОТВЕТНЫЙ КОД ХОСТУ</span></div>
        <CodeBox code={view.code} busy={view.busy} label="Ответный код" />
      </>}
      {view.error && <Status tone="error">{view.error}</Status>}
      {!view.error && failed && <Status tone="error">{view.detail || 'Соединение не удалось.'}</Status>}
      {!view.error && !failed && (
        <Status>
          {view.busy || view.link === 'connecting'
            ? 'Подключаемся к лобби хоста…'
            : view.code
              ? 'Отправь этот код хосту.'
              : 'Введи 6-значный код комнаты хоста или отсканируй его QR-код.'}
        </Status>
      )}
      {failed && <button type="button" className="text-button" onClick={() => onChoose('guest')}>Попробовать заново</button>}
    </>}
  </div>;
}

export function LobbyScreen({ view, onPickFighter, onPickArena, onStart, onLeave }: {
  view: OnlineView;
  onPickFighter: (id: FighterId) => void;
  onPickArena: (id: ArenaId) => void;
  onStart: () => void;
  onLeave: () => void;
}) {
  const host = view.role === 'host';
  const mine = host ? view.lobby.host : view.lobby.guest;
  const theirs = host ? view.lobby.guest : view.lobby.host;
  return <div className="setup-screen lobby-screen screen-enter">
    <div className="setup-top"><div><div className="eyebrow">ИГРА ПО СЕТИ · {host ? 'ТЫ ХОСТ' : 'ТЫ ГОСТЬ'}</div><h1>Выберите бойцов.</h1></div><button type="button" className="text-button setup-back" onClick={onLeave}><LogOut size={16} /> Выйти</button></div>
    <p className="lobby-link"><span className="live-dot" />Соперник подключён{view.rtt ? ` · пинг ${view.rtt} мс` : ''}</p>
    <div className="setup-field-heading"><span className="step-number">01</span><span>ТВОЙ БОЕЦ</span><span className="selected-move">{FIGHTERS[mine].special}</span></div>
    <div className="setup-fighters">
      {(Object.keys(FIGHTERS) as FighterId[]).map(id => {
        const taken = id === theirs;
        return <button key={id} type="button" disabled={taken} className={`setup-fighter ${mine === id ? 'selected' : ''}`} aria-pressed={mine === id} onClick={() => onPickFighter(id)} style={{ '--fighter-color': FIGHTERS[id].color } as CSSProperties}>
          <FighterPortrait id={id} />
          <span className="setup-fighter-info"><strong>{FIGHTERS[id].name}</strong><span>{taken ? 'ВЫБРАН СОПЕРНИКОМ' : FIGHTERS[id].role}</span></span>
          {mine === id && <Check size={17} className="selection-check" />}
        </button>;
      })}
    </div>
    <div className="setup-field-heading"><span className="step-number">02</span><span>АРЕНА</span><span className="selected-move">{host ? '' : 'ВЫБИРАЕТ ХОСТ'}</span></div>
    <div className="setup-arenas">
      {(Object.keys(ARENAS) as ArenaId[]).map(id => <button key={id} type="button" disabled={!host} className={`arena-option ${view.lobby.arena === id ? 'selected' : ''}`} aria-pressed={view.lobby.arena === id} onClick={() => onPickArena(id)}>
        <ArenaThumbnail id={id} /><span className="arena-option-caption"><strong>{ARENAS[id].name}</strong><span>{ARENAS[id].description}</span>{view.lobby.arena === id && <Check size={16} />}</span>
      </button>)}
    </div>
    <div className="setup-bottom">
      <span className="opponent-note"><Swords size={18} /><span>Ты: <strong>{FIGHTERS[mine].name}</strong> · Соперник: <strong>{FIGHTERS[theirs].name}</strong></span></span>
      {host
        ? <button type="button" className="primary-button" onClick={onStart}>В БОЙ <ChevronRight size={22} /></button>
        : <span className="lobby-wait"><span className="live-dot" /> Ждём, пока хост начнёт бой</span>}
    </div>
  </div>;
}
