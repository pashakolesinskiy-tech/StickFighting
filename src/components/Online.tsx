import { useEffect, useRef, useState, type ClipboardEvent, type CSSProperties } from 'react';
import { ArrowLeft, Check, ChevronRight, Copy, LogOut, QrCode, Share2, Swords, Users, Wifi } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { OnlineView } from '../game/online';
import { ARENAS, FIGHTERS, type ArenaId, type FighterId } from '../game/types';
import { ArenaThumbnail, FighterPortrait } from './GameUI';

const CODE_PATTERN = /^(SF[01]-[OA]-[A-Za-z0-9_-]{20,}|[A-Z0-9]{4,12})$/i;
const looksLikeCode = (text: string) => CODE_PATTERN.test(text.replace(/\s+/g, ''));

async function copyText(text: string, field: HTMLTextAreaElement | HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* Fall back to the old way below. */ }
  if (!field) return false;
  field.focus();
  field.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  }
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

  const copy = async () => {
    if (!code) return;
    const ok = await copyText(code, field.current);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    }
  };

  const copyLink = async () => {
    if (!joinUrl) return;
    const ok = await copyText(joinUrl, field.current);
    if (ok) {
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2200);
    }
  };

  const share = async () => {
    try {
      await navigator.share({
        title: 'Stick Fighting — Вход в лобби',
        text: `Подключайся к бою! Код: ${code}`,
        url: joinUrl || undefined,
      });
    } catch { /* The player closed the sheet. */ }
  };

  return (
    <div className="code-box">
      {showQr && code && (
        <div
          className="qr-lobby-box"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '14px',
            padding: '16px',
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: '14px',
          }}
        >
          <div style={{ background: '#ffffff', padding: '12px', borderRadius: '12px', lineHeight: 0 }}>
            <QRCodeSVG value={joinUrl} size={176} level="M" />
          </div>
          <span style={{ fontSize: '0.85rem', opacity: 0.8, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <QrCode size={16} /> Наведи камеру телефона, чтобы сразу войти в лобби
          </span>
        </div>
      )}

      <textarea
        ref={field}
        readOnly
        aria-label={label}
        className="code-field"
        rows={code.length > 20 ? 3 : 1}
        spellCheck={false}
        placeholder={busy ? 'Создаём код…' : ''}
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
    </div>
  );
}

function PasteBox({ label, placeholder, button, busy, disabled, onSubmit }: {
  label: string; placeholder: string; button: string; busy: boolean; disabled: boolean; onSubmit: (code: string) => void;
}) {
  const [text, setText] = useState('');
  const submit = (value: string) => {
    const raw = value.trim();
    if (!raw) return;
    // Если вставили полную ссылку из QR-кода — извлекаем параметр ?join=
    try {
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        const url = new URL(raw);
        const fromUrl = url.searchParams.get('join');
        if (fromUrl) {
          onSubmit(fromUrl.trim());
          return;
        }
      }
    } catch { /* Обычный текстовый код */ }
    onSubmit(raw);
  };

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (looksLikeCode(pasted) || pasted.includes('?join=')) {
      event.preventDefault();
      setText(pasted);
      submit(pasted);
    }
  };

  return (
    <div className="code-box">
      <textarea
        aria-label={label}
        className="code-field"
        rows={3}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        onChange={event => setText(event.target.value)}
        onPaste={paste}
      />
      <div className="code-actions">
        <button
          type="button"
          className="primary-button compact"
          disabled={disabled || busy || !text.trim()}
          onClick={() => submit(text)}
        >
          {button} <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
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
  const autoJoinedRef = useRef(false);
  const failed = view && (view.link === 'failed' || view.link === 'closed');

  // Автоматический вход при переходе по QR-коду (?join=...)
  useEffect(() => {
    if (autoJoinedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join');
    if (!joinCode) return;

    if (!view) {
      onChoose('guest');
      return;
    }

    if (view.role === 'guest' && !view.code && !view.busy) {
      autoJoinedRef.current = true;
      // Очищаем ?join= из адресной строки
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);
      onJoin(joinCode);
    }
  }, [view, onChoose, onJoin]);

  return (
    <div className="setup-screen online-screen screen-enter">
      <div className="setup-top">
        <div>
          <div className="eyebrow">ИГРА ПО СЕТИ</div>
          <h1>{view ? (view.role === 'host' ? 'Создай игру.' : 'Подключись к игре.') : 'Бой с живым соперником.'}</h1>
        </div>
        <button type="button" className="text-button setup-back" onClick={onBack}><ArrowLeft size={17} /> Назад</button>
      </div>

      {!view && <>
        <div className="online-modes">
          <button type="button" className="online-mode" onClick={() => onChoose('host')}>
            <Wifi size={26} /><strong>СОЗДАТЬ ИГРУ</strong>
            <span>Твоё устройство ведёт бой и показывает QR-код. Друг сканирует его или вводит код.</span>
            <small>ХОСТ <ChevronRight size={15} /></small>
          </button>
          <button type="button" className="online-mode" onClick={() => onChoose('guest')}>
            <Users size={26} /><strong>ПОДКЛЮЧИТЬСЯ</strong>
            <span>Отсканируй QR-код хоста камерой или вставь присланный код вручную.</span>
            <small>ГОСТЬ <ChevronRight size={15} /></small>
          </button>
        </div>
        <p className="online-note">Устройства соединяются напрямую по WebRTC. Можно подключиться в один шаг по QR-коду с экрана хоста или переслать код в мессенджере.</p>
      </>}

      {view?.role === 'host' && <>
        <div className="setup-field-heading"><span className="step-number">01</span><span>ДАЙ ДРУГУ ОТСКАНИРОВАТЬ QR-КОД ИЛИ ОТПРАВЬ КОД</span></div>
        <CodeBox code={view.code} busy={view.busy} label="Код хоста" showQr />

        {/* Если используется старый ручной режим с ответным кодом SF1-A-... */}
        {view.code.startsWith('SF') && (
          <>
            <div className="setup-field-heading"><span className="step-number">02</span><span>ВСТАВЬ ОТВЕТНЫЙ КОД ОТ ДРУГА</span></div>
            <PasteBox
              label="Ответный код друга"
              placeholder="Сюда вставь код, который друг пришлёт в ответ"
              button="ПОДКЛЮЧИТЬ"
              busy={view.busy}
              disabled={!view.code || view.link === 'connecting' || !!failed}
              onSubmit={onAccept}
            />
          </>
        )}

        {view.error && <Status tone="error">{view.error}</Status>}
        {!view.error && failed && <Status tone="error">{view.detail || 'Соединение не удалось.'}</Status>}
        {!view.error && !failed && (
          <Status>
            {view.busy && !view.code
              ? 'Создаём комнату и QR-код…'
              : view.link === 'connecting'
                ? 'Соединяемся с другом…'
                : 'Ждём подключения друга по QR-коду или коду. Лобби откроется автоматически.'}
          </Status>
        )}
        {(failed || view.error) && <button type="button" className="text-button" onClick={onRestart}>Создать игру заново</button>}
      </>}

      {view?.role === 'guest' && <>
        <div className="setup-field-heading"><span className="step-number">01</span><span>ВСТАВЬ КОД ХОСТА (ИЛИ СКАНИРУЙ QR КАМЕРОЙ)</span></div>
        <PasteBox
          label="Код хоста"
          placeholder="Сюда вставь код или ссылку от друга"
          button="ПОДКЛЮЧИТЬСЯ"
          busy={view.busy}
          disabled={view.link === 'connecting' || !!failed}
          onSubmit={onJoin}
        />
        {view.code && (
          <>
            <div className="setup-field-heading"><span className="step-number">02</span><span>ОТПРАВЬ ОТВЕТНЫЙ КОД ХОСТУ</span></div>
            <CodeBox code={view.code} busy={view.busy} label="Ответный код" />
          </>
        )}
        {view.error && <Status tone="error">{view.error}</Status>}
        {!view.error && failed && <Status tone="error">{view.detail || 'Соединение не удалось.'}</Status>}
        {!view.error && !failed && (
          <Status>
            {view.busy
              ? 'Подключаемся к комнате…'
              : view.link === 'connecting'
                ? 'Соединяемся с хостом…'
                : view.code
                  ? 'Отправь этот код хосту. Как только он его вставит, соединение установится само.'
                  : 'Вставь код хоста или отсканируй его QR-код камерой.'}
          </Status>
        )}
        {failed && <button type="button" className="text-button" onClick={() => onChoose('guest')}>Попробовать заново</button>}
      </>}
    </div>
  );
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
