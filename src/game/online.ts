import type { FightEngine } from './engine';
import { isManualSignalCode, NetSession, SignalError, type LinkStatus } from './net';
import { ARENA_IDS, FIGHTER_IDS, PROTOCOL_VERSION, type CtlMsg, type FastMsg, type LobbyState } from './protocol';
import type { MatchConfig } from './types';

export interface OnlineView {
  role: 'host' | 'guest';
  link: LinkStatus;
  detail: string;
  error: string;
  /** Host: 6-char room code (or manual offer code). Guest: empty in auto mode, or answer code in manual mode. */
  code: string;
  busy: boolean;
  lobby: LobbyState;
  rtt: number;
  stalled: boolean;
  ended: boolean;
  rematch: boolean;
}

export interface OnlineCallbacks {
  view(view: OnlineView): void;
  start(config: MatchConfig): void;
  lobby(): void;
}

export const DEFAULT_LOBBY: LobbyState = { host: 'vortex', guest: 'titan', arena: 'sunset' };

export function lobbyConfig(lobby: LobbyState): MatchConfig {
  return { player: lobby.host, enemy: lobby.guest, arena: lobby.arena, difficulty: 'normal' };
}

export class OnlineGame {
  readonly role: 'host' | 'guest';
  view: OnlineView;
  private net: NetSession | null = null;
  private engine: FightEngine;
  private cb: OnlineCallbacks;
  private stallTimer = 0;
  private peerBye = false;
  private disposed = false;

  constructor(role: 'host' | 'guest', engine: FightEngine, callbacks: OnlineCallbacks) {
    this.role = role; this.engine = engine; this.cb = callbacks;
    this.view = { role, link: 'idle', detail: '', error: '', code: '', busy: false, lobby: { ...DEFAULT_LOBBY }, rtt: 0, stalled: false, ended: false, rematch: false };
    engine.resetNetInput();
    this.stallTimer = window.setInterval(() => this.checkStall(), 500);
  }

  private update(patch: Partial<OnlineView>) {
    if (this.disposed) return;
    this.view = { ...this.view, ...patch };
    this.cb.view(this.view);
  }

  private fresh(): NetSession {
    this.net?.close();
    const net = new NetSession(this.role === 'host');
    net.onStatus = (link, detail) => this.onLink(link, detail);
    net.onCtl = msg => this.onCtl(msg);
    net.onFast = msg => this.onFast(msg);
    net.onStats = () => { const rtt = Math.round(net.rtt); if (rtt !== this.view.rtt) this.update({ rtt }); };
    this.net = net;
    this.peerBye = false;
    return net;
  }

  private async guard(work: () => Promise<void>) {
    this.update({ busy: true, error: '' });
    try { await work(); }
    catch (error) {
      this.update({ error: error instanceof SignalError ? error.message : 'Не удалось подготовить соединение. Попробуйте ещё раз.', link: this.view.link === 'gathering' ? 'idle' : this.view.link });
    } finally { this.update({ busy: false }); }
  }

  // ---- Connecting ----------------------------------------------------------------------------

  /** Host: create a room with a 6-char code and QR code. */
  begin() {
    return this.guard(async () => {
      this.update({ code: '', link: 'gathering', ended: false });
      const code = await this.fresh().createRoom();
      this.update({ code });
    });
  }

  /** Guest: join by 6-char room code / QR link, or accept a manual SF1-O-... offer code. */
  join(code: string) {
    return this.guard(async () => {
      this.update({ code: '', ended: false });
      if (isManualSignalCode(code)) {
        const answer = await this.fresh().acceptOffer(code);
        this.update({ code: answer });
      } else {
        await this.fresh().joinRoom(code);
      }
    });
  }

  /** Host: accept a manual answer code (used only in offline manual mode). */
  accept(code: string) {
    return this.guard(async () => {
      if (!this.net) throw new SignalError('Сначала создайте игру.');
      await this.net.acceptAnswer(code);
    });
  }

  private onLink(link: LinkStatus, detail: string) {
    if (link === 'open') {
      this.update({ link, detail: '', error: '' });
      return;
    }
    if (link === 'failed' || link === 'closed') {
      const wasOpen = this.view.link === 'open';
      this.engine.onNetTick = null;
      if (this.role === 'host' && this.engine.role === 'host') this.engine.pause(true);
      this.update({ link, detail: this.peerBye ? 'Соперник вышел из игры.' : detail, ended: wasOpen || this.peerBye || this.view.ended, stalled: false });
      return;
    }
    this.update({ link, detail });
  }

  // ---- Messages ------------------------------------------------------------------------------

  private onFast(msg: FastMsg) {
    if (this.role === 'host' && msg.k === 'i') this.engine.remoteInput(msg);
    else if (this.role === 'guest' && msg.k === 's') this.engine.receiveState(msg);
  }

  private onCtl(msg: CtlMsg) {
    switch (msg.t) {
      case 'hello':
        if (msg.v !== PROTOCOL_VERSION) {
          this.peerBye = false;
          this.update({ ended: true, detail: 'Версии игры у вас и у соперника не совпадают. Обновите страницу на обоих устройствах.' });
          this.net?.close();
        } else if (this.role === 'host') this.net?.sendCtl({ t: 'lobby', lobby: this.view.lobby });
        break;
      case 'lobby':
        if (this.role === 'guest') this.update({ lobby: msg.lobby });
        break;
      case 'pick':
        if (this.role === 'host') this.setGuestFighter(msg.fighter);
        break;
      case 'start':
        if (this.role === 'guest') this.beginClientMatch(msg.config, msg.m);
        break;
      case 'ev':
        if (this.role === 'guest') this.engine.receiveEvents(msg.e);
        break;
      case 'pause':
        if (this.role === 'host') this.engine.pause(msg.v);
        break;
      case 'rematch':
        if (this.role === 'host') this.update({ rematch: true });
        break;
      case 'toLobby':
        this.enterLobby();
        break;
      case 'bye':
        this.peerBye = true;
        this.engine.onNetTick = null;
        if (this.role === 'host' && this.engine.role === 'host') this.engine.pause(true);
        this.update({ ended: true, detail: 'Соперник вышел из игры.', stalled: false });
        break;
    }
  }

  // ---- Lobby ---------------------------------------------------------------------------------

  private broadcastLobby(lobby: LobbyState) {
    this.update({ lobby });
    this.net?.sendCtl({ t: 'lobby', lobby });
  }

  private setGuestFighter(fighter: string) {
    const lobby = this.view.lobby;
    if (!FIGHTER_IDS.includes(fighter as never) || fighter === lobby.host) { this.net?.sendCtl({ t: 'lobby', lobby }); return; }
    this.broadcastLobby({ ...lobby, guest: fighter as LobbyState['guest'] });
  }

  pickFighter(fighter: LobbyState['host']) {
    const lobby = this.view.lobby;
    if (this.role === 'host') {
      if (fighter !== lobby.guest) this.broadcastLobby({ ...lobby, host: fighter });
    } else if (fighter !== lobby.host) this.net?.sendCtl({ t: 'pick', fighter });
  }

  pickArena(arena: LobbyState['arena']) {
    if (this.role !== 'host' || !ARENA_IDS.includes(arena)) return;
    this.broadcastLobby({ ...this.view.lobby, arena });
  }

  private enterLobby() {
    this.engine.onNetTick = null;
    this.update({ rematch: false, stalled: false });
    this.cb.lobby();
  }

  backToLobby() {
    this.net?.sendCtl({ t: 'toLobby' });
    this.enterLobby();
  }

  // ---- Match ---------------------------------------------------------------------------------

  startMatch() {
    if (this.role !== 'host' || !this.net?.isOpen) return;
    const config = lobbyConfig(this.view.lobby);
    this.engine.setRole('host');
    this.engine.start(config);
    this.engine.onNetTick = () => {
      const net = this.net;
      if (!net) return;
      net.sendFast(this.engine.netState());
      const events = this.engine.drainEvents();
      if (events.length) net.sendCtl({ t: 'ev', e: events });
    };
    this.net.sendCtl({ t: 'start', config, m: this.engine.matchId });
    this.update({ rematch: false, stalled: false });
    this.cb.start(config);
  }

  private beginClientMatch(config: MatchConfig, matchId: number) {
    this.engine.startClient(config, matchId);
    this.engine.onNetTick = () => { this.net?.sendFast(this.engine.netInput()); };
    this.update({ rematch: false, stalled: false });
    this.cb.start(config);
  }

  requestRematch() {
    if (this.role === 'host') this.startMatch();
    else if (!this.view.rematch) { this.net?.sendCtl({ t: 'rematch' }); this.update({ rematch: true }); }
  }

  setPaused(paused: boolean) {
    if (this.role === 'host') this.engine.pause(paused);
    else this.net?.sendCtl({ t: 'pause', v: paused });
  }

  private checkStall() {
    if (!this.net?.isOpen || this.engine.role === 'local') {
      if (this.view.stalled) this.update({ stalled: false });
      return;
    }
    const silent = this.role === 'guest' ? this.engine.msSinceState() : performance.now() - this.net.lastFastAt;
    const stalled = silent > 1500;
    if (stalled !== this.view.stalled) this.update({ stalled });
  }

  dispose() {
    this.disposed = true;
    window.clearInterval(this.stallTimer);
    this.net?.close();
    this.net = null;
    this.engine.onNetTick = null;
    this.engine.setRole('local');
  }
}
