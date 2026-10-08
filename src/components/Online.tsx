import { useRef, useState, type ClipboardEvent, type CSSProperties } from 'react';
import { ArrowLeft, Check, ChevronRight, Copy, LogOut, Share2, Swords, Users, Wifi } from 'lucide-react';
import type { OnlineView } from '../game/online';
import { ARENAS, FIGHTERS, type ArenaId, type FighterId } from '../game/types';
import { ArenaThumbnail, FighterPortrait } from './GameUI';

const CODE_PATTERN = /^SF[01]-[OA]-[A-Za-z0-9_-]{20,}$/;
const looksLikeCode = (text: string) => CODE_PATTERN.test(text.replace(/\s+/g, ''));

async function copyText(text: string, field: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* Fall back to the old way below. */ }
  // A page opened by a local address (http://192.168...) has no clipboard API: select and copy instead.
  if (!field) return false;
  field.focus(); field.select();
  try { return document.execCommand('copy'); } catch { return false; }
}

function CodeBox({ code, busy, label }: { code: string; busy: boolean; label: string }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator.share === 'function';
  const copy = async () => {
    if (!code) return;
    const ok = await copyText(code, field.current);
    if (ok) { setCopied(true); window.setTimeout(() => setCopied(false), 2200); }
  };
  const share = async () => { try { await navigator.share({ text: code }); } catch { /* The player closed the sheet. */ } };
  return <div className="code-box">
    <textarea ref={field} readOnly aria-label={label} className="code-field" rows={4} spellCheck={false} placeholder={busy ? 'Создаём код…' : ''} value={code} onFocus={event => event.currentTarget.select()} />
    <div className="code-actions">
      <button type="button" className="secondary-button compact" disabled={!code} onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Скопировано' : 'Копировать код'}</button>
      {canShare && <button type="button" className="secondary-button compact" disabled={!code} onClick={() => void share()}><Share2 size={16} /> Поделиться</button>}
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
    <textarea aria-label={label} className="code-field" rows={4} spellCheck={false} autoComplete="off" autoCapitalize="off" placeholder={placeholder} value={text} disabled={disabled}
      onChange={event => setText(event.target.value)} onPaste={paste} />
    <div className="code-actions">
      <button type="button" className="primary-button compact" disabled={disabled || busy || !text.trim()} onClick={() => submit(text)}>{button} <ChevronRight size={18} /></button>
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
    <div className="setup-top"><div><div className="eyebrow">ИГРА ПО СЕТИ</div><h1>{view ? (view.role === 'host' ? 'Создай игру.' : 'Подключись к игре.') : 'Бой с живым соперником.'}</h1></div><button type="button" className="text-button setup-back" onClick={onBack}><ArrowLeft size={17} /> Назад</button></div>

    {!view && <>
      <div className="online-modes">
        <button type="button" className="online-mode" onClick={() => onChoose('host')}>
          <Wifi size={26} /><strong>СОЗДАТЬ ИГРУ</strong>
          <span>Твоё устройство ведёт бой и становится сервером. Друг подключается к тебе по коду.</span>
          <small>ХОСТ <ChevronRight size={15} /></small>
        </button>
        <button type="button" className="online-mode" onClick={() => onChoose('guest')}>
          <Users size={26} /><strong>ПОДКЛЮЧИТЬСЯ</strong>
          <span>Друг уже создал игру и прислал тебе код. Вставь его, чтобы войти в бой.</span>
          <small>ГОСТЬ <ChevronRight size={15} /></small>
        </button>
      </div>
      <p className="online-note">Отдельный сервер и регистрация не нужны: устройства соединяются напрямую. Лучше всего работает в одной Wi-Fi сети, но подойдёт и интернет. Перед игрой оба игрока открывают эту же страницу.</p>
    </>}

    {view?.role === 'host' && <>
      <div className="setup-field-heading"><span className="step-number">01</span><span>ОТПРАВЬ КОД ДРУГУ</span></div>
      <CodeBox code={view.code} busy={view.busy} label="Код хоста" />
      <div className="setup-field-heading"><span className="step-number">02</span><span>ВСТАВЬ ОТВЕТНЫЙ КОД ОТ ДРУГА</span></div>
      <PasteBox label="Ответный код друга" placeholder="Сюда вставь код, который друг пришлёт в ответ" button="ПОДКЛЮЧИТЬ" busy={view.busy} disabled={!view.code || view.link === 'connecting' || !!failed} onSubmit={onAccept} />
      {view.error && <Status tone="error">{view.error}</Status>}
      {!view.error && failed && <Status tone="error">{view.detail || 'Соединение не удалось.'}</Status>}
      {!view.error && !failed && <Status>{view.busy && !view.code ? 'Создаём код…' : view.link === 'connecting' ? 'Соединяемся с другом…' : 'Ждём ответный код от друга. Игра начнётся сама, когда вы соединитесь.'}</Status>}
      {(failed || view.error) && <button type="button" className="text-button" onClick={onRestart}>Создать игру заново</button>}
    </>}

    {view?.role === 'guest' && <>
      <div className="setup-field-heading"><span className="step-number">01</span><span>ВСТАВЬ КОД ХОСТА</span></div>
      <PasteBox label="Код хоста" placeholder="Сюда вставь код, который прислал друг" button="ГОТОВО" busy={view.busy} disabled={view.link === 'connecting' || !!failed} onSubmit={onJoin} />
      <div className="setup-field-heading"><span className="step-number">02</span><span>ОТПРАВЬ ОТВЕТНЫЙ КОД ХОСТУ</span></div>
      <CodeBox code={view.code} busy={view.busy} label="Ответный код" />
      {view.error && <Status tone="error">{view.error}</Status>}
      {!view.error && failed && <Status tone="error">{view.detail || 'Соединение не удалось.'}</Status>}
      {!view.error && !failed && <Status>{view.busy ? 'Обрабатываем код…' : view.link === 'connecting' ? 'Соединяемся с хостом…' : view.code ? 'Отправь этот код хосту. Как только он его вставит, соединение установится само.' : 'Вставь код хоста, чтобы получить ответный код.'}</Status>}
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
