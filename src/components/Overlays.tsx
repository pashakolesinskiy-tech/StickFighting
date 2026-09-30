import { useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronRight, Keyboard, MoveHorizontal, Shield, Swords, Volume2, Zap } from 'lucide-react';
import { ARENAS, ATTACKS, DIFFICULTIES, FIGHTERS, type ArenaId, type Difficulty, type FighterId, type MatchConfig, type Settings } from '../game/types';
import { ArenaThumbnail, FighterPortrait, Kbd, Modal } from './GameUI';

export function opponentFor(id: FighterId): FighterId { return id === 'vortex' ? 'titan' : id === 'spark' ? 'vortex' : 'spark'; }

export function SetupScreen({ config, onChange, onBack, onStart }: { config: MatchConfig; onChange: (config: MatchConfig) => void; onBack: () => void; onStart: () => void }) {
  return <div className="setup-screen screen-enter">
    <div className="setup-top"><div><div className="eyebrow">ТВОЙ БОЙ НАЧИНАЕТСЯ ЗДЕСЬ</div><h1>Выбери свой стиль.</h1></div><button type="button" className="text-button setup-back" onClick={onBack}><ArrowLeft size={17} /> Назад</button></div>
    <div className="setup-field-heading"><span className="step-number">01</span><span>БОЕЦ</span><span className="selected-move">{FIGHTERS[config.player].special}</span></div>
    <div className="setup-fighters">
      {(Object.keys(FIGHTERS) as FighterId[]).map(id => <button key={id} type="button" className={`setup-fighter ${config.player === id ? 'selected' : ''}`} aria-pressed={config.player === id} onClick={() => onChange({ ...config, player: id, enemy: opponentFor(id) })} style={{ '--fighter-color': FIGHTERS[id].color } as CSSProperties}>
        <FighterPortrait id={id} />
        <span className="setup-fighter-info"><strong>{FIGHTERS[id].name}</strong><span>{FIGHTERS[id].role}</span><span className="fighter-traits"><i>Скорость <b>{id === 'spark' ? '5' : id === 'vortex' ? '3' : '2'}/5</b></i><i>Сила <b>{id === 'titan' ? '5' : id === 'vortex' ? '3' : '2'}/5</b></i></span></span>
        {config.player === id && <Check size={17} className="selection-check" />}
      </button>)}
    </div>
    <div className="setup-field-heading"><span className="step-number">02</span><span>АРЕНА</span></div>
    <div className="setup-arenas">
      {(Object.keys(ARENAS) as ArenaId[]).map(id => <button key={id} type="button" className={`arena-option ${config.arena === id ? 'selected' : ''}`} aria-pressed={config.arena === id} onClick={() => onChange({ ...config, arena: id })}>
        <ArenaThumbnail id={id} /><span className="arena-option-caption"><strong>{ARENAS[id].name}</strong><span>{ARENAS[id].description}</span>{config.arena === id && <Check size={16} />}</span>
      </button>)}
    </div>
    <div className="difficulty-row">
      <div><div className="setup-field-heading"><span className="step-number">03</span><span>СЛОЖНОСТЬ ИИ</span></div><p>{DIFFICULTIES[config.difficulty].description}</p></div>
      <div className="difficulty-options" aria-label="Сложность ИИ">{(Object.keys(DIFFICULTIES) as Difficulty[]).map(id => <button key={id} type="button" aria-pressed={config.difficulty === id} className={config.difficulty === id ? 'selected' : ''} onClick={() => onChange({ ...config, difficulty: id })}>{DIFFICULTIES[id].name}</button>)}</div>
    </div>
    <div className="setup-bottom"><span className="opponent-note"><Swords size={18} /><span>Твой соперник: <strong>{FIGHTERS[config.enemy].name}</strong></span></span><button type="button" className="primary-button" onClick={onStart}>В БОЙ <ChevronRight size={22} /></button></div>
  </div>;
}

const HELP_MOVES = [
  { id: 'jab', keys: 'J' }, { id: 'heavy', keys: 'K' }, { id: 'kick', keys: 'U' }, { id: 'heavyKick', keys: 'I' },
  { id: 'uppercut', keys: '↓ + K' }, { id: 'sweep', keys: '↓ + I' }, { id: 'airKick', keys: '↑ + I' },
  { id: 'dash', keys: '→ → + J' }, { id: 'special', keys: 'O' },
] as const;

export function HelpModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'controls' | 'moves'>('controls');
  return <Modal title="Каждый удар в твоих руках." eyebrow="УПРАВЛЕНИЕ" onClose={onClose} className="help-modal">
    <div className="modal-tabs"><button type="button" className={tab === 'controls' ? 'active' : ''} onClick={() => setTab('controls')}><Keyboard size={16} /> Основы</button><button type="button" className={tab === 'moves' ? 'active' : ''} onClick={() => setTab('moves')}><Swords size={16} /> Приёмы и комбо</button></div>
    {tab === 'controls' ? <>
      <div className="control-guide">
        <div className="movement-guide"><span className="guide-label">ДВИЖЕНИЕ</span><div className="guide-dpad"><Kbd className="up"><ArrowUp size={18} /></Kbd><Kbd className="left"><ArrowLeft size={18} /></Kbd><Kbd className="down"><ArrowDown size={18} /></Kbd><Kbd className="right"><ArrowRight size={18} /></Kbd></div><p>Влево и вправо - движение.<br />Вверх - прыжок. Вниз - присесть.</p></div>
        <div className="attacks-guide"><span className="guide-label">АТАКИ</span><div className="guide-key-row"><Kbd>J</Kbd><span>Быстрая рука</span><Kbd>K</Kbd><span>Сильная рука</span></div><div className="guide-key-row"><Kbd>U</Kbd><span>Быстрая нога</span><Kbd>I</Kbd><span>Сильная нога</span></div><div className="guide-key-row"><Kbd>O</Kbd><span>Спецприём</span><span className="special-cost"><Zap size={14} /> 50 энергии</span></div></div>
      </div>
      <div className="guide-defense"><div><Shield size={19} /><Kbd>Space</Kbd><span>Удерживай для блока</span></div><div><Kbd>Esc</Kbd><span>Пауза</span></div></div>
      <p className="help-note">На телефоне используй экранные кнопки: можно одновременно двигаться и атаковать. Блок нужно удерживать. Для удобства поверни устройство горизонтально.</p>
      <div className="match-explanation"><strong>100 здоровья. 60 секунд. Две победы.</strong><span>Побеждай нокаутом или сохрани больше здоровья к концу раунда. При равном здоровье раунд переигрывается.</span></div>
    </> : <>
      <div className="moves-table-wrap"><table className="moves-table"><thead><tr><th>ПРИЁМ</th><th>КНОПКИ</th><th>УРОН</th><th>КАДРЫ*</th></tr></thead><tbody>{HELP_MOVES.map(item => { const move = ATTACKS[item.id]; return <tr key={item.id}><td>{move.name}</td><td><Kbd>{item.keys}</Kbd></td><td>{item.id === 'special' ? '16-20' : move.damage}</td><td>{Math.round(move.startup * 60)} / {Math.round(move.active * 60)} / {Math.round(move.recovery * 60)}</td></tr>; })}</tbody></table></div>
      <p className="frame-note">* Старт / активные / восстановление при 60 кадрах/с. Характеристики бойца влияют на скорость и урон. Рывок также работает влево.</p>
      <div className="combo-guide"><span className="guide-label">ПОПРОБУЙ КОМБИНАЦИИ</span><div><span><Kbd>J</Kbd><ChevronRight size={13} /><Kbd>J</Kbd><ChevronRight size={13} /><Kbd>K</Kbd></span><span><Kbd>U</Kbd><ChevronRight size={13} /><Kbd>U</Kbd><ChevronRight size={13} /><Kbd>I</Kbd></span><span><Kbd>↓ + K</Kbd><ChevronRight size={13} /><Kbd>J</Kbd></span></div></div>
      <p className="help-note">Продолжай комбо после попадания: ввод запоминается на 180 мс. Блок или пауза между попаданиями дольше 1,2 с сбрасывают комбо. После третьего удара урон снижается, после восьмого соперник получает передышку.</p>
    </>}
    <div className="modal-footer"><button type="button" className="primary-button compact" onClick={onClose}>ПОНЯТНО <Check size={18} /></button></div>
  </Modal>;
}

function Switch({ value, onChange, label }: { value: boolean; onChange: () => void; label: string }) {
  return <button type="button" className={`switch ${value ? 'on' : ''}`} role="switch" aria-checked={value} aria-label={label} onClick={onChange}><span /></button>;
}

export function SettingsModal({ settings, onChange, onClose }: { settings: Settings; onChange: (settings: Settings) => void; onClose: () => void }) {
  return <Modal title="Настрой свой ритм." eyebrow="НАСТРОЙКИ" onClose={onClose} className="settings-modal">
    <div className="volume-setting"><div><Volume2 size={19} /><label htmlFor="game-volume">Громкость</label><strong>{Math.round(settings.volume * 100)}%</strong></div><input id="game-volume" type="range" min={0} max={100} value={Math.round(settings.volume * 100)} onChange={event => onChange({ ...settings, volume: Number(event.target.value) / 100 })} style={{ '--range-value': `${settings.volume * 100}%` } as CSSProperties} /></div>
    <div className="setting-row"><div><strong>Звук</strong><p>Удары, блоки и оригинальные эффекты</p></div><Switch value={!settings.muted} label="Включить звук" onChange={() => onChange({ ...settings, muted: !settings.muted })} /></div>
    <div className="setting-row"><div><strong>Тряска экрана</strong><p>Небольшой импульс при сильном попадании</p></div><Switch value={settings.shake} label="Тряска экрана" onChange={() => onChange({ ...settings, shake: !settings.shake })} /></div>
    <div className="setting-row"><div><strong>Сенсорные кнопки</strong><p>Экранное управление для телефона</p></div><Switch value={settings.touch} label="Показывать сенсорное управление" onChange={() => onChange({ ...settings, touch: !settings.touch })} /></div>
    <p className="settings-saved">Настройки сохраняются на этом устройстве.</p>
    <div className="modal-footer"><button type="button" className="primary-button compact" onClick={onClose}>ГОТОВО <Check size={18} /></button></div>
  </Modal>;
}

export function DesktopControls({ onHelp, onPause }: { onHelp: () => void; onPause: () => void }) {
  return <div className="desktop-controls"><div className="control-legend"><span><Kbd><MoveHorizontal size={16} /></Kbd> Движение</span><span><Kbd>J</Kbd><Kbd>K</Kbd><Kbd>U</Kbd><Kbd>I</Kbd> Атаки</span><span><Kbd>Space</Kbd> Блок</span><span><Kbd>O</Kbd> Спецприём</span></div><div className="control-legend-actions"><button type="button" className="text-button" onClick={onHelp}><Keyboard size={16} /> Управление</button><button type="button" className="text-button" onClick={onPause}><Kbd>Esc</Kbd> Пауза</button></div></div>;
}