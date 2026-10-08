import type { Action, ArenaId, AttackId, FighterId, MatchConfig, Phase, Pose } from './types';

/**
 * Wire protocol for network play. The host runs the whole simulation (it is the "server"),
 * the guest only sends its input and renders what the host reports.
 *
 * Two WebRTC data channels are used:
 *  - "ctl"  - reliable and ordered: lobby, start/rematch, sound/particle events, ping, pause;
 *  - "fast" - unordered, no retransmits: host -> guest state at 60 Hz, guest -> host input at 60 Hz.
 */

export const PROTOCOL_VERSION = 1;

export const ACTIONS: Action[] = ['left', 'right', 'up', 'down', 'jab', 'heavy', 'kick', 'heavyKick', 'block', 'special'];
export const HOLD_ACTIONS: Action[] = ['left', 'right', 'up', 'down', 'block'];
export const PHASES: Phase[] = ['menu', 'countdown', 'fight', 'round-end', 'match-end'];
export const POSES: Pose[] = ['idle', 'walk', 'jump', 'crouch', 'attack', 'block', 'hurt', 'ko', 'victory'];
export const ATTACK_IDS: AttackId[] = ['jab', 'heavy', 'kick', 'heavyKick', 'uppercut', 'sweep', 'airKick', 'dash', 'special'];
export const FIGHTER_IDS: FighterId[] = ['vortex', 'spark', 'titan'];
export const ARENA_IDS: ArenaId[] = ['sunset', 'forest', 'city'];

export type NetSound = 'light' | 'heavy' | 'swing' | 'block' | 'special' | 'count' | 'fight' | 'ko' | 'win' | 'lose' | 'voice';

/** Cosmetic events produced by the host simulation: sound, particles, floating text, screen shake. */
export type NetEvent =
  | ['s', NetSound]
  | ['i', number, number, string, 0 | 1]
  | ['d', number, number, number]
  | ['t', number, number, string, number, string]
  | ['k', number, number];

/** [fighterIndex, x, y, facing, pose, attack(-1 = none), extension, hitFlash, blockFlash, invulnerable, health, energy, wins, combo, comboDamage] */
export type FighterState = [number, number, number, number, number, number, number, number, number, 0 | 1, number, number, number, number, number];

/** Host -> guest, every simulation tick, on the unreliable channel. */
export interface StateMsg {
  k: 's';
  /** Match id: states from an earlier match are ignored after a rematch. */
  m: number;
  /** Sequence number: late or duplicated states are dropped. */
  n: number;
  ph: number;
  pa: 0 | 1;
  /** 1 while the host is in hit-stop (the guest freezes its animations as well). */
  hs: 0 | 1;
  ti: number;
  ro: number;
  cd: string;
  ms: string;
  rw: number;
  wn: number;
  f: [FighterState, FighterState];
}

/** [id, actionIndex, down(1)/up(0)] */
export type InputEvent = [number, number, 0 | 1];

/**
 * Guest -> host, every tick, on the unreliable channel.
 * `e` holds every press/release of the last ~0.5 s (receiver dedups by id), `h` is the whole held mask,
 * so a lost packet can neither drop a tap nor leave a key stuck.
 */
export interface InputMsg {
  k: 'i';
  n: number;
  h: number;
  e: InputEvent[];
}

export type FastMsg = StateMsg | InputMsg;

export interface LobbyState {
  host: FighterId;
  guest: FighterId;
  arena: ArenaId;
}

export type CtlMsg =
  | { t: 'hello'; v: number }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'pick'; fighter: FighterId }
  | { t: 'start'; config: MatchConfig; m: number }
  | { t: 'ev'; e: NetEvent[] }
  | { t: 'pause'; v: boolean }
  | { t: 'rematch' }
  | { t: 'toLobby' }
  | { t: 'bye' }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number };

export function actionMask(actions: Iterable<Action>): number {
  let mask = 0;
  for (const action of actions) mask |= 1 << ACTIONS.indexOf(action);
  return mask;
}
