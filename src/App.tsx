import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, ChevronRight, Keyboard, LogOut, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Settings2, Swords, Trophy, Volume2, VolumeX, Wifi } from 'lucide-react';
import { BrandMark, FighterPortrait, HUD, Kbd, PixelWord, TouchControls } from './components/GameUI';
import { DesktopControls, HelpModal, opponentFor, SettingsModal, SetupScreen } from './components/Overlays';
import { LobbyScreen, OnlineScreen } from './components/Online';
import { createGame } from './game/phaser';
import { FightEngine } from './game/engine';
import { lobbyConfig, OnlineGame, type OnlineView } from './game/online';
import { ARENAS, DEFAULT_MATCH, FIGHTERS, type Action, type FighterId, type MatchConfig, type Settings, type Snapshot } from './game/types';

type Screen = 'menu' | 'setup' | 'battle' | 'online' | 'lobby';
type ModalKind = 'help' | 'settings' | null;
const KEYMAP: Record<string, Action> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  KeyJ: 'jab', KeyK: 'heavy', KeyU: 'kick', KeyI: 'heavyKick', Space: 'block', KeyO: 'special',
};

function readSettings(): Settings {
  const defaults: Settings = { volume: 0.65, muted: false, shake: true, touch: window.matchMedia('(pointer: coarse)').matches };
  try {
    const saved = JSON.parse(localStorage.getItem('stickfighting-settings-v1') ?? 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    return {
      volume: typeof saved.volume === 'number' && Number.isFinite(saved.volume) ? Math.max(0, Math.min(1, saved.volume)) : defaults.volume,
      muted: typeof saved.muted === 'boolean' ? saved.muted : defaults.muted,
      shake: typeof saved.shake === 'boolean' ? saved.shake : defaults.shake,
      touch: typeof saved.touch === 'boolean' ? saved.touch : defaults.touch,
    };
  } catch { return defaults; }
}

function initialSnapshot(): Snapshot {
  return {
    phase: 'menu', paused: false, timer: 60, round: 1, countdown: '', message: '', roundWinner: null, winner: null,
    player: { id: 'vortex', health: 100, energy: 0, wins: 0, combo: 0, comboDamage: 0 },
    enemy: { id: 'titan', health: 100, energy: 0, wins: 0, combo: 0, comboDamage: 0 },
  };
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [modal, setModal] = useState<ModalKind>(null);
  const [config, setConfig] = useState<MatchConfig>({ ...DEFAULT_MATCH });
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [snapshot, setSnapshot] = useState<Snapshot>(initialSnapshot);
  const [fullscreen, setFullscreen] = useState(false);
  const [toast, setToast] = useState('');
  const [online, setOnline] = useState<OnlineView | null>(null);
  const [netConfig, setNetConfig] = useState<MatchConfig | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const engineRef = useRef<FightEngine | null>(null);
  const resumeAfterModal = useRef(false);
  const onlineRef = useRef<OnlineGame | null>(null);
  const qrHandledRef = useRef(false);
  const configRef = useRef(config);
  const screenRef = useRef(screen);
  const settingsRef = useRef(settings);
  configRef.current = config; screenRef.current = screen; settingsRef.current = settings;

  useEffect(() => {
    if (!canvasRef.current) return;
    let active = true;
    const instance = createGame(canvasRef.current, settingsRef.current, state => { if (active) setSnapshot(state); });
    engineRef.current = instance.engine;
    instance.engine.preview(configRef.current);
    return () => { active = false; instance.destroy(); engineRef.current = null; };
  }, []);

  useEffect(() => {
    engineRef.current?.setSettings(settings);
    try { localStorage.setItem('stickfighting-settings-v1', JSON.stringify(settings)); } catch { /* Storage is optional. */ }
  }, [settings]);

  useEffect(() => {
    if (screen === 'battle') return;
    // The lobby shows the two fighters that were picked there, everything else the solo selection.
    engineRef.current?.preview(screen === 'lobby' && online ? lobbyConfig(online.lobby) : config);
  }, [config, screen, online?.lobby]);

  useEffect(() => () => { onlineRef.current?.dispose(); onlineRef.current = null; }, []);

  // The connection is up: both players meet in the lobby.
  useEffect(() => {
    if (online?.link === 'open' && screen === 'online') { window.scrollTo(0, 0); setScreen('lobby'); }
  }, [online?.link, screen]);

  const disposeOnline = useCallback(() => {
    onlineRef.current?.dispose(); onlineRef.current = null;
    setOnline(null); setNetConfig(null);
  }, []);

  /** In a network match pause is shared and the match goes on behind the menus, so nothing is paused locally. */
  const setPaused = useCallback((value: boolean) => {
    const game = onlineRef.current;
    if (game) game.setPaused(value); else engineRef.current?.pause(value);
  }, []);

  const closeModal = useCallback(() => {
    setModal(null);
    if (resumeAfterModal.current && screenRef.current === 'battle') engineRef.current?.pause(false);
    resumeAfterModal.current = false;
  }, []);

  const openModal = useCallback((kind: Exclude<ModalKind, null>) => {
    const engine = engineRef.current;
    engine?.audio.unlock(); engine?.audio.play('click');
    if (onlineRef.current) { resumeAfterModal.current = false; engine?.clearInput(); }
    else {
      resumeAfterModal.current = screenRef.current === 'battle' && !!engine && !engine.paused && engine.phase !== 'match-end';
      if (resumeAfterModal.current) engine?.pause(true);
    }
    setModal(kind);
  }, []);

  const returnToMenu = useCallback(() => {
    disposeOnline();
    resumeAfterModal.current = false; setModal(null);
    engineRef.current?.audio.play('click'); engineRef.current?.preview(configRef.current);
    window.scrollTo(0, 0); setScreen('menu');
  }, [disposeOnline]);

  const showSetup = useCallback(() => {
    engineRef.current?.audio.unlock(); engineRef.current?.audio.play('click');
    window.scrollTo(0, 0); setScreen('setup');
  }, []);

  const showOnline = useCallback(() => {
    engineRef.current?.audio.unlock(); engineRef.current?.audio.play('click');
    disposeOnline(); window.scrollTo(0, 0); setScreen('online');
  }, [disposeOnline]);

  /** The player chose to host or to join: a new network game (and its connection) begins. */
  const chooseRole = useCallback((role: 'host' | 'guest', autoJoinCode?: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.audio.unlock(); engine.audio.play('click');
    onlineRef.current?.dispose();
    let game: OnlineGame;
    try {
      game = new OnlineGame(role, engine, {
        view: setOnline,
        start: matchConfig => {
          setNetConfig(matchConfig); resumeAfterModal.current = false; setModal(null);
          window.scrollTo(0, 0); setScreen('battle');
          requestAnimationFrame(() => stageRef.current?.focus({ preventScroll: true }));
        },
        lobby: () => { setModal(null); window.scrollTo(0, 0); setScreen('lobby'); },
      });
    } catch { setToast('Не удалось начать сетевую игру в этом браузере.'); return; }
    onlineRef.current = game; setOnline(game.view);
    if (role === 'host') void game.begin();
    else if (autoJoinCode) void game.join(autoJoinCode);
  }, []);

  // Автоматический вход в лобби при переходе по QR-коду (?join=...)
  useEffect(() => {
    if (qrHandledRef.current || !engineRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join')?.trim();
    if (!joinCode) return;

    qrHandledRef.current = true;
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);

    window.scrollTo(0, 0);
    setScreen('online');
    chooseRole('guest', joinCode);
  }, [chooseRole]);

  const startMatch = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    resumeAfterModal.current = false; setModal(null);
    engine.audio.unlock(); engine.start(configRef.current);
    window.scrollTo(0, 0); setScreen('battle');
    requestAnimationFrame(() => stageRef.current?.focus({ preventScroll: true }));
  }, []);

  const rematch = useCallback(() => {
    if (onlineRef.current) onlineRef.current.requestRematch(); else startMatch();
  }, [startMatch]);

  const changeConfig = useCallback((next: MatchConfig) => {
    engineRef.current?.audio.unlock(); engineRef.current?.audio.play('click'); setConfig(next);
  }, []);

  const onAction = useCallback((action: Action, down: boolean, source: string) => {
    if (down) engineRef.current?.press(action, source);
    else engineRef.current?.release(action, source);
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select')) return;
      if (modal) return;
      if (event.code === 'Escape' && !event.repeat) {
        if (screen === 'battle') { event.preventDefault(); setPaused(!engineRef.current?.paused); }
        else if (screen === 'setup' || screen === 'online') { event.preventDefault(); returnToMenu(); }
        return;
      }
      if (event.code === 'Enter' && !event.repeat && target?.tagName !== 'BUTTON') {
        if (screen === 'menu') { event.preventDefault(); showSetup(); }
        else if (screen === 'setup') { event.preventDefault(); startMatch(); }
      }
      const action = KEYMAP[event.code];
      if (screen === 'battle' && action) { event.preventDefault(); if (!event.repeat) engineRef.current?.press(action, `keyboard-${event.code}`); }
    };
    const keyup = (event: KeyboardEvent) => {
      const action = KEYMAP[event.code];
      if (action) engineRef.current?.release(action, `keyboard-${event.code}`);
    };
    // A network match cannot be paused by walking away, but the keys must not stay pressed.
    const pauseWhenAway = () => {
      if (onlineRef.current) { engineRef.current?.clearInput(); return; }
      if (screenRef.current === 'battle' && !engineRef.current?.paused) engineRef.current?.pause(true);
    };
    const visibility = () => { if (document.hidden) pauseWhenAway(); };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
    window.addEventListener('blur', pauseWhenAway); document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', pauseWhenAway); document.removeEventListener('visibilitychange', visibility);
    };
  }, [screen, modal, returnToMenu, showSetup, startMatch, setPaused]);

  useEffect(() => {
    document.body.classList.toggle('in-battle', screen === 'battle');
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const previous = viewport?.content;
    if (screen === 'battle' && viewport) viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
    return () => { document.body.classList.remove('in-battle'); if (viewport && previous) viewport.content = previous; };
  }, [screen]);

  useEffect(() => {
    const handle = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handle);
    return () => document.removeEventListener('fullscreenchange', handle);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => { if (snapshot.phase === 'match-end') document.querySelector<HTMLButtonElement>('.rematch-button')?.focus({ preventScroll: true }); }, [snapshot.phase]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (shellRef.current?.requestFullscreen) await shellRef.current.requestFullscreen();
      else setToast('Полноэкранный режим недоступен. Игра работает и без него.');
    } catch { setToast('Браузер не разрешил полноэкранный режим.'); }
  };

  const you: 0 | 1 = online?.role === 'guest' ? 1 : 0;
  const matchConfig = online && netConfig ? netConfig : config;

  const toggleSound = () => { engineRef.current?.audio.unlock(); setSettings(previous => ({ ...previous, muted: !previous.muted })); };

  return <div ref={shellRef} className={`app-shell ${screen === 'battle' ? 'battle-mode' : ''} ${settings.touch ? 'with-touch' : ''}`}>
    <header className="site-header">
      <button type="button" className="brand" onClick={returnToMenu} aria-label="StickFighting, в главное меню"><BrandMark /><PixelWord text="STICKFIGHTING" /></button>
      <nav className="main-nav" aria-label="Главное меню"><button type="button" className={screen !== 'battle' ? 'active' : ''} onClick={returnToMenu}>Главная</button><button type="button" onClick={() => openModal('help')}>Управление</button></nav>
      {screen === 'battle' && <span className="battle-arena-name"><span />{ARENAS[matchConfig.arena].name}</span>}
      <div className="header-actions">
        <button type="button" className="icon-button sound-button" onClick={toggleSound} aria-label={settings.muted ? 'Включить звук' : 'Выключить звук'} title={settings.muted ? 'Включить звук' : 'Выключить звук'}>{settings.muted || settings.volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}</button>
        {screen === 'battle' && <button type="button" className="icon-button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? 'Выйти из полноэкранного режима' : 'На весь экран'} title="На весь экран">{fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}</button>}
        {screen === 'battle' && snapshot.phase !== 'match-end' && <button type="button" className="icon-button" onClick={() => setPaused(!snapshot.paused)} aria-label={snapshot.paused ? 'Продолжить бой' : 'Пауза'}>{snapshot.paused ? <Play size={19} /> : <Pause size={19} />}</button>}
        <button type="button" className="settings-button" onClick={() => openModal('settings')}><Settings2 size={18} /><span>Настройки</span></button>
      </div>
    </header>

    <main className={`main-content screen-${screen}`}>
      <section ref={stageRef} className={`game-stage ${screen === 'battle' ? 'battle-stage' : 'menu-stage'}`} tabIndex={-1} aria-label={screen === 'battle' ? 'Арена StickFighting. Стрелки - движение, J K U I - атаки, пробел - блок, O - спецприём.' : 'Главное меню StickFighting'}>
        <div ref={canvasRef} className="canvas-container" aria-hidden="true" />
        {screen === 'menu' && <>
          <div className="hero-shade" />
          <div className="hero-content">
            <div className="eyebrow hero-eyebrow"><span className="live-dot" /> ОРИГИНАЛЬНЫЙ ПИКСЕЛЬНЫЙ ФАЙТИНГ</div>
            <h1 className="hero-title" aria-label="StickFighting"><PixelWord text="STICK" /><PixelWord text="FIGHTING" className="accent" /></h1>
            <h2 className="hero-subtitle">Маленькие бойцы.<br />Большие разборки.</h2>
            <p className="hero-description">Один на один с ИИ или с другом по сети. Всё решает твой следующий удар.</p>
            <div className="hero-actions"><button type="button" className="primary-button play-button" onClick={showSetup}><Play size={19} fill="currentColor" /> ИГРАТЬ <ChevronRight size={21} /></button><button type="button" className="secondary-button online-button" onClick={showOnline}><Wifi size={19} /> По сети</button><button type="button" className="secondary-button" onClick={() => openModal('help')}><Keyboard size={19} /> Управление</button></div>
            <div className="start-hint"><Kbd>Enter</Kbd><span>чтобы начать</span></div>
          </div>
          <div className="stage-vignette" />
        </>}

        {screen === 'setup' && <SetupScreen config={config} onChange={changeConfig} onBack={returnToMenu} onStart={startMatch} />}

        {screen === 'online' && <OnlineScreen view={online} onChoose={chooseRole} onJoin={code => void onlineRef.current?.join(code)} onAccept={code => void onlineRef.current?.accept(code)} onRestart={() => void onlineRef.current?.begin()} onBack={returnToMenu} />}

        {screen === 'lobby' && online && <LobbyScreen view={online}
          onPickFighter={id => { engineRef.current?.audio.play('click'); onlineRef.current?.pickFighter(id); }}
          onPickArena={id => { engineRef.current?.audio.play('click'); onlineRef.current?.pickArena(id); }}
          onStart={() => { engineRef.current?.audio.play('click'); onlineRef.current?.startMatch(); }}
          onLeave={returnToMenu} />}

        {screen === 'battle' && <>
          <div className="hud-shade" />
          <HUD snapshot={snapshot} you={online ? you : null} />
          {online && <div className="net-chip" title="Задержка до соперника"><span className="live-dot" />{online.rtt ? `${online.rtt} мс` : 'СЕТЬ'}</div>}
          {online?.stalled && !online.ended && <div className="net-banner" role="status">{online.role === 'guest' ? 'Нет данных от хоста. Ждём связи…' : 'Соперник не отвечает. Ждём связи…'}</div>}
          {(snapshot.phase === 'countdown' || (snapshot.phase === 'fight' && snapshot.countdown === 'БОЙ!')) && !snapshot.paused && <div className="round-overlay" key={snapshot.countdown}><span className="round-overlay-label">РАУНД {snapshot.round}</span>{snapshot.countdown === 'БОЙ!' ? <strong className="fight-call">БОЙ!</strong> : <PixelWord text={snapshot.countdown || '3'} className="countdown-number" />}<small>{snapshot.round === 1 ? 'Твой момент. Твой удар.' : 'Соберись. Следующий раунд за тобой.'}</small></div>}
          {snapshot.phase === 'round-end' && !snapshot.paused && <div className="round-overlay round-result"><strong>{snapshot.message}</strong><span>{snapshot.roundWinner === null ? 'Равное здоровье. Раунд будет переигран.' : `${FIGHTERS[snapshot.roundWinner === 0 ? snapshot.player.id : snapshot.enemy.id].name} забирает раунд`}</span><small>{snapshot.player.wins} : {snapshot.enemy.wins}</small></div>}
          {snapshot.paused && !modal && !online?.ended && <div className="game-overlay"><div className="pause-menu screen-enter"><div className="eyebrow">{online ? 'ПАУЗА ДЛЯ ОБОИХ ИГРОКОВ' : 'ВЫДОХНИ. И ВОЗВРАЩАЙСЯ.'}</div><h2>ПАУЗА</h2><button type="button" autoFocus className="primary-button" onClick={() => setPaused(false)}><Play size={18} /> ПРОДОЛЖИТЬ</button><button type="button" className="secondary-button" onClick={() => openModal('help')}><Keyboard size={18} /> Управление</button><button type="button" className="secondary-button" onClick={() => openModal('settings')}><Settings2 size={18} /> Настройки</button><button type="button" className="text-button" onClick={returnToMenu}>{online ? <LogOut size={17} /> : <ArrowRight size={17} />} {online ? 'Выйти из игры' : 'В главное меню'}</button></div></div>}
          {snapshot.phase === 'match-end' && !online?.ended && <div className="game-overlay result-overlay"><div className={`result-menu screen-enter ${snapshot.winner === you ? 'victory' : 'defeat'}`}><div className="result-symbol">{snapshot.winner === you ? <Trophy size={36} /> : <Swords size={36} />}</div><div className="eyebrow">МАТЧ ЗАВЕРШЁН</div><h2>{snapshot.winner === you ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ'}</h2><p>{snapshot.winner === you ? 'Твой характер оказался сильнее.' : 'Следующий бой - новая история.'}</p><div className="final-score"><span>{FIGHTERS[matchConfig.player].name}</span><strong>{snapshot.player.wins}<i>:</i>{snapshot.enemy.wins}</strong><span>{FIGHTERS[matchConfig.enemy].name}</span></div>{online?.role === 'host' && online.rematch && <p className="rematch-note">Соперник просит реванш</p>}<button type="button" className="primary-button rematch-button" disabled={online?.role === 'guest' && online.rematch} onClick={rematch}><RotateCcw size={19} /> {online?.role === 'guest' && online.rematch ? 'ЖДЁМ ХОСТА' : 'РЕВАНШ'}</button>{online && <button type="button" className="secondary-button" onClick={() => onlineRef.current?.backToLobby()}>В лобби <ChevronRight size={17} /></button>}<button type="button" className="secondary-button" onClick={returnToMenu}>{online ? 'Выйти из игры' : 'В главное меню'} <ArrowRight size={17} /></button></div></div>}
        </>}

        {online?.ended && <div className="game-overlay"><div className="pause-menu ended-menu screen-enter"><div className="eyebrow">СЕТЕВАЯ ИГРА</div><h2>ИГРА ПРЕРВАНА</h2><p>{online.detail || 'Соперник вышел из игры.'}</p><button type="button" autoFocus className="primary-button" onClick={returnToMenu}>В ГЛАВНОЕ МЕНЮ</button></div></div>}
      </section>

      {screen === 'menu' && <section className="fighter-roster" aria-label="Выбор бойца">
        <div className="roster-heading"><span className="eyebrow">НЕ ПРОСТО ЦВЕТ.</span><h2>Выбери<br />характер.</h2></div>
        <div className="roster-options">{(Object.keys(FIGHTERS) as FighterId[]).map(id => <button type="button" key={id} className={`roster-fighter ${config.player === id ? 'selected' : ''}`} aria-pressed={config.player === id} onClick={() => changeConfig({ ...config, player: id, enemy: opponentFor(id) })} style={{ '--fighter-color': FIGHTERS[id].color } as CSSProperties}><FighterPortrait id={id} /><span className="roster-fighter-text"><strong>{FIGHTERS[id].name}</strong><span>{FIGHTERS[id].role}</span><small>{config.player === id ? 'ТВОЙ БОЕЦ' : 'ВЫБРАТЬ БОЙЦА'}</small></span><ChevronRight size={18} className="roster-arrow" /></button>)}</div>
      </section>}

      {screen === 'battle' && (settings.touch ? <TouchControls onAction={onAction} paused={snapshot.paused || snapshot.phase === 'match-end' || !!modal} /> : <DesktopControls onHelp={() => openModal('help')} onPause={() => setPaused(!snapshot.paused)} />)}
      {screen === 'battle' && settings.touch && <div className="orientation-hint"><RotateCw size={17} /><span>Для удобного боя поверни телефон горизонтально</span></div>}
    </main>

    {screen !== 'battle' && <footer className="site-footer"><span>Без загрузок. Без регистрации. Только бой.</span><span>ПИКСЕЛИ. УДАРЫ. ХАРАКТЕР.</span></footer>}
    {modal === 'help' && <HelpModal onClose={closeModal} />}
    {modal === 'settings' && <SettingsModal settings={settings} onChange={setSettings} onClose={closeModal} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
