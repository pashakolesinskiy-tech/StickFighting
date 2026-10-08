import { GameAudio } from './audio';
import { drawArena, drawFighter } from './art';
import { ClientInput, InputController } from './input';
import {
  ACTIONS, ATTACK_IDS, FIGHTER_IDS, HOLD_ACTIONS, PHASES, POSES,
  type FighterState, type InputMsg, type NetEvent, type NetSound, type StateMsg,
} from './protocol';
import {
  ATTACKS, DEFAULT_MATCH, FIGHTERS, GROUND, WORLD_WIDTH,
  type Action, type AttackId, type FighterId, type FighterSnapshot,
  type FighterVisual, type MatchConfig, type Phase, type Settings, type Snapshot,
} from './types';

/** 'local' - against the AI; 'host' - runs the simulation with a remote second player; 'client' - only renders the host's state. */
export type NetRole = 'local' | 'host' | 'client';

interface Fighter {
  id: FighterId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  health: number;
  energy: number;
  wins: number;
  attack: AttackId | null;
  attackTime: number;
  attackHit: boolean;
  confirmed: boolean;
  stun: number;
  invulnerability: number;
  hitFlash: number;
  blockFlash: number;
  crouching: boolean;
  blocking: boolean;
  moving: boolean;
  combo: number;
  comboDamage: number;
  comboEnded: boolean;
  lastHit: number;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number }
interface FloatingText { x: number; y: number; text: string; life: number; color: string }

const CHAIN: Record<AttackId, AttackId[]> = {
  jab: ['jab', 'heavy', 'kick', 'special'],
  kick: ['kick', 'heavyKick', 'jab'],
  uppercut: ['jab', 'airKick'],
  heavy: ['kick', 'uppercut'],
  heavyKick: ['jab'],
  sweep: ['jab'],
  airKick: ['jab', 'kick'],
  dash: ['jab', 'heavy'],
  special: [],
};

function makeFighter(id: FighterId, x: number, facing: number): Fighter {
  return {
    id, x, y: GROUND, vx: 0, vy: 0, facing, health: 100, energy: 0, wins: 0,
    attack: null, attackTime: 0, attackHit: false, confirmed: false, stun: 0,
    invulnerability: 0, hitFlash: 0, blockFlash: 0, crouching: false, blocking: false,
    moving: false, combo: 0, comboDamage: 0, comboEnded: false, lastHit: -10,
  };
}

export class FightEngine {
  readonly audio: GameAudio;
  config: MatchConfig = { ...DEFAULT_MATCH };
  settings: Settings;
  phase: Phase = 'menu';
  paused = false;
  fighters: [Fighter, Fighter];
  timer = 60;
  round = 1;
  now = 0;
  visualTime = 0;
  phaseTime = 0;
  roundWinner: number | null = null;
  winner: number | null = null;
  message = '';
  private countdown = '';
  private hitstop = 0;
  private shakeTime = 0;
  private shakePower = 0;
  private emitTime = 0;
  /** Input of both fighters. In a local match only [0] is used (the second one is the AI). */
  private ctl: [InputController, InputController] = [new InputController(), new InputController()];
  role: NetRole = 'local';
  /** Called after every simulation tick: the network layer sends state (host) or input (guest) from here. */
  onNetTick: (() => void) | null = null;
  matchId = 0;
  private tick = 0;
  private outbox: NetEvent[] = [];
  private stateSeq = 0;
  private remoteSeen = 0;
  private remoteSeq = -1;
  private remoteEvent = 0;
  private remoteMask = 0;
  private clientInput = new ClientInput();
  private stateQueue: StateMsg[] = [];
  private lastStateSeq = -1;
  private lastStateAt = 0;
  private hitstopView = false;
  private hudKey = '';
  private netVisuals: [FighterVisual, FighterVisual] = [{ id: 'vortex', x: 310, y: GROUND, facing: 1, pose: 'idle' }, { id: 'titan', x: 650, y: GROUND, facing: -1, pose: 'idle' }];
  private aiTimer = 0.4;
  private aiDirection = 0;
  private aiBlock = false;
  private particles: Particle[] = [];
  private floating: FloatingText[] = [];
  private onSnapshot: (snapshot: Snapshot) => void;

  constructor(settings: Settings, onSnapshot: (snapshot: Snapshot) => void) {
    this.settings = settings;
    this.audio = new GameAudio(settings);
    this.onSnapshot = onSnapshot;
    this.fighters = [makeFighter('vortex', 653, 1), makeFighter('titan', 824, -1)];
  }

  private fighterSnapshot(f: Fighter): FighterSnapshot {
    return { id: f.id, health: f.health, energy: f.energy, wins: f.wins, combo: f.combo, comboDamage: f.comboDamage };
  }

  snapshot(): Snapshot {
    return {
      phase: this.phase, paused: this.paused, timer: Math.ceil(this.timer), round: this.round,
      countdown: this.countdown, message: this.message, roundWinner: this.roundWinner, winner: this.winner,
      player: this.fighterSnapshot(this.fighters[0]), enemy: this.fighterSnapshot(this.fighters[1]),
    };
  }

  emit() { this.onSnapshot(this.snapshot()); }

  preview(config: MatchConfig) {
    this.setRole('local');
    this.config = { ...config };
    this.phase = 'menu'; this.paused = false; this.clearInput();
    this.fighters = [makeFighter(config.player, 653, 1), makeFighter(config.enemy, 824, -1)];
    this.particles = []; this.floating = []; this.winner = null; this.roundWinner = null;
    this.emit();
  }

  start(config: MatchConfig) {
    this.config = { ...config };
    this.fighters = [makeFighter(config.player, 310, 1), makeFighter(config.enemy, 650, -1)];
    this.now = 0; this.timer = 60; this.round = 1; this.phaseTime = 0;
    this.phase = 'countdown'; this.countdown = '3'; this.paused = false;
    this.winner = null; this.roundWinner = null; this.message = '';
    this.hitstop = 0; this.shakeTime = 0; this.particles = []; this.floating = [];
    this.aiTimer = 0.4; this.aiDirection = 0; this.aiBlock = false;
    this.tick = 0; this.outbox = [];
    if (this.role === 'host') this.matchId++;
    this.clearInput(); this.sfx('count'); this.emit();
  }

  setSettings(settings: Settings) { this.settings = settings; this.audio.update(settings); }

  pause(value = !this.paused) {
    if (this.role === 'client') return;
    if (this.phase === 'menu' || this.phase === 'match-end') return;
    this.paused = value; this.clearInput(); this.emit();
  }

  clearInput() {
    this.ctl[0].clear(); this.ctl[1].clear(); this.clientInput.clear();
  }

  press(action: Action, source: string = action) {
    this.audio.unlock();
    if (this.role === 'client') { this.clientInput.press(action, source); return; }
    if (this.paused) return;
    this.ctl[0].press(action, source, this.now, this.phase === 'fight', this.fighters[0]);
  }

  release(action: Action, source: string = action) {
    if (this.role === 'client') { this.clientInput.release(action, source); return; }
    this.ctl[0].release(action, source);
  }

  // ---- Network play ------------------------------------------------------------------------

  setRole(role: NetRole) {
    this.role = role;
    if (role === 'local') { this.onNetTick = null; this.stateQueue = []; this.outbox = []; this.hitstopView = false; }
  }

  /** A new network session begins: forget the previous peer's input counters. */
  resetNetInput() {
    this.clientInput = new ClientInput();
    this.remoteSeen = 0; this.remoteSeq = -1; this.remoteEvent = 0; this.remoteMask = 0;
    this.ctl[1].clear();
  }

  /** Guest: begin rendering a match that the host started. */
  startClient(config: MatchConfig, matchId: number) {
    this.setRole('client');
    this.matchId = matchId;
    this.config = { ...config };
    this.fighters = [makeFighter(config.player, 310, 1), makeFighter(config.enemy, 650, -1)];
    this.netVisuals = [this.visual(this.fighters[0], 0), this.visual(this.fighters[1], 1)];
    this.now = 0; this.timer = 60; this.round = 1; this.phaseTime = 0;
    this.phase = 'countdown'; this.countdown = '3'; this.paused = false;
    this.winner = null; this.roundWinner = null; this.message = '';
    this.hitstop = 0; this.hitstopView = false; this.shakeTime = 0; this.particles = []; this.floating = [];
    this.stateQueue = []; this.lastStateSeq = -1; this.lastStateAt = performance.now(); this.hudKey = '';
    this.clientInput.clear();
    this.emit();
  }

  /** Host: everything the guest needs to draw this tick. */
  netState(): StateMsg {
    const r1 = (value: number) => Math.round(value * 10) / 10;
    const r2 = (value: number) => Math.round(value * 100) / 100;
    const f = this.fighters.map((fighter, index): FighterState => {
      const v = this.visual(fighter, index);
      return [
        FIGHTER_IDS.indexOf(fighter.id), r1(v.x), r1(v.y), v.facing, POSES.indexOf(v.pose),
        v.attack ? ATTACK_IDS.indexOf(v.attack) : -1, r2(v.extension ?? 0), r2(v.hitFlash ?? 0), r2(v.blockFlash ?? 0),
        v.invulnerable ? 1 : 0, Math.round(fighter.health), r1(fighter.energy), fighter.wins, fighter.combo, fighter.comboDamage,
      ];
    }) as [FighterState, FighterState];
    return {
      k: 's', m: this.matchId, n: ++this.stateSeq, ph: PHASES.indexOf(this.phase), pa: this.paused ? 1 : 0,
      hs: this.hitstop > 0 ? 1 : 0, ti: Math.ceil(this.timer), ro: this.round, cd: this.countdown, ms: this.message,
      rw: this.roundWinner ?? -1, wn: this.winner ?? -1, f,
    };
  }

  /** Host: sound, particles and text produced since the last call (sent reliably; losing one would be audible). */
  drainEvents(): NetEvent[] {
    const events = this.outbox;
    this.outbox = [];
    return events;
  }

  /** Host: input of the remote player (the second fighter). */
  remoteInput(msg: InputMsg) {
    if (this.role !== 'host') return;
    this.remoteSeen = performance.now();
    const ctl = this.ctl[1];
    for (const [id, bit, down] of msg.e) {
      if (id <= this.remoteEvent) continue;
      this.remoteEvent = id;
      const action = ACTIONS[bit];
      if (!action || this.paused) continue;
      const source = `net-${action}`;
      if (down) {
        ctl.release(action, source);
        ctl.press(action, source, this.now, this.phase === 'fight', this.fighters[1]);
      } else ctl.release(action, source);
    }
    if (msg.n <= this.remoteSeq) return;
    this.remoteSeq = msg.n;
    if (msg.h === this.remoteMask) return;
    // The held mask heals a lost release/press: every packet carries the full state of the hold keys.
    this.remoteMask = msg.h;
    for (const action of HOLD_ACTIONS) {
      const want = (msg.h & (1 << ACTIONS.indexOf(action))) !== 0;
      const source = `net-${action}`;
      if (!want && ctl.held.has(action)) { ctl.sources.delete(source); ctl.held.delete(action); }
      else if (want && !ctl.held.has(action) && !this.paused) { ctl.sources.set(source, action); ctl.held.add(action); }
    }
  }

  /** Guest: this tick's input packet for the host. */
  netInput(): InputMsg { return this.clientInput.packet(); }

  /** Guest: a state sent by the host. */
  receiveState(state: StateMsg) {
    if (this.role !== 'client' || state.m !== this.matchId || state.n <= this.lastStateSeq) return;
    this.lastStateSeq = state.n; this.lastStateAt = performance.now();
    this.stateQueue.push(state);
  }

  /** Guest: milliseconds since the last state from the host. */
  msSinceState() { return performance.now() - this.lastStateAt; }

  /** Guest: sounds and particles that the host's simulation produced. */
  receiveEvents(events: NetEvent[]) {
    if (this.role !== 'client') return;
    for (const event of events) {
      switch (event[0]) {
        case 's':
          // "win"/"lose" are reported from the host's point of view; the guest hears the opposite.
          if (event[1] === 'voice') this.audio.voice();
          else this.audio.play(event[1] === 'win' ? 'lose' : event[1] === 'lose' ? 'win' : event[1]);
          break;
        case 'i': this.spawnImpact(event[1], event[2], String(event[3]).slice(0, 16), !!event[4]); break;
        case 'd': this.spawnDust(event[1], event[2], Math.min(24, event[3])); break;
        case 't':
          if (this.floating.length < 24) this.floating.push({ x: event[1], y: event[2], text: String(event[3]).slice(0, 24), life: event[4], color: String(event[5]).slice(0, 16) });
          break;
        case 'k': this.shakeTime = event[1]; this.shakePower = event[2]; break;
      }
    }
  }

  private sfx(sound: NetSound) {
    if (sound === 'voice') this.audio.voice(); else this.audio.play(sound);
    if (this.role === 'host') this.outbox.push(['s', sound]);
  }

  private text(x: number, y: number, text: string, life: number, color: string) {
    this.floating.push({ x, y, text, life, color });
    if (this.role === 'host') this.outbox.push(['t', Math.round(x * 10) / 10, Math.round(y * 10) / 10, text, life, color]);
  }

  private shake(time: number, power: number) {
    this.shakeTime = time; this.shakePower = power;
    if (this.role === 'host') this.outbox.push(['k', time, power]);
  }

  private canStart(f: Fighter, attack: AttackId) {
    if (f.stun > 0 || f.health <= 0 || f.blocking) return false;
    if (!f.attack) return true;
    const current = ATTACKS[f.attack];
    const startup = current.startup * FIGHTERS[f.id].timing;
    return f.confirmed && f.combo < 8 && f.attackTime >= startup + current.active * 0.75 && CHAIN[f.attack].includes(attack);
  }

  private beginAttack(f: Fighter, attack: AttackId) {
    if (!this.canStart(f, attack)) return false;
    if (attack === 'special' && f.energy < 50) return false;
    if (attack === 'special') {
      f.energy -= 50;
      if (f.id === 'spark') f.invulnerability = 0.2;
      this.sfx('special');
    } else this.sfx('swing');
    if (attack === 'airKick' && f.y >= GROUND && f.vy >= 0) {
      f.vy = -465; f.crouching = false;
    }
    f.attack = attack; f.attackTime = 0; f.attackHit = false; f.confirmed = false;
    f.crouching = attack === 'sweep'; f.blocking = false; f.moving = false;
    return true;
  }

  private consumeInput(index: 0 | 1) {
    const ctl = this.ctl[index];
    ctl.buffer = ctl.buffer.filter(command => this.now - command.time <= 0.18);
    const command = ctl.buffer[0];
    if (!command) return;
    const f = this.fighters[index];
    if (command.attack === 'special' && f.energy < 50 && !f.attack && f.stun <= 0) {
      this.text(f.x / 2, f.y / 2 - 71, 'НУЖНО 50 ЭНЕРГИИ', 0.65, '#e1c89b');
      ctl.buffer.shift(); return;
    }
    if (this.beginAttack(f, command.attack)) ctl.buffer.shift();
  }

  /** Stance of a human-controlled fighter: crouch and block follow the held keys. */
  private driveStance(index: 0 | 1) {
    const f = this.fighters[index];
    const held = this.ctl[index].held;
    f.crouching = f.stun <= 0 && f.y >= GROUND && (f.attack === 'sweep' || (held.has('down') && !held.has('block') && !f.attack));
    f.blocking = held.has('block') && f.y >= GROUND && !f.attack && (f.stun <= 0 || f.blockFlash > 0);
  }

  /** Jump and attack of a human-controlled fighter. Returns the walking direction. */
  private driveActions(index: 0 | 1) {
    const f = this.fighters[index];
    const ctl = this.ctl[index];
    if (ctl.jumpUntil >= this.now && f.y >= GROUND && f.stun <= 0 && !f.attack && !f.blocking) {
      f.vy = -535; f.crouching = false; ctl.jumpUntil = -1; this.sfx('swing');
    }
    this.consumeInput(index);
    return Number(ctl.held.has('right')) - Number(ctl.held.has('left'));
  }

  private thinkAI(dt: number) {
    this.aiTimer -= dt;
    if (this.aiTimer > 0) return;
    const f = this.fighters[1];
    const p = this.fighters[0];
    const level = this.config.difficulty;
    const reaction = level === 'easy' ? 0.5 : level === 'normal' ? 0.29 : 0.17;
    this.aiTimer = reaction + Math.random() * reaction * 0.6;
    const distance = Math.abs(p.x - f.x);
    const blockChance = level === 'easy' ? 0.12 : level === 'normal' ? 0.4 : 0.7;
    // The AI observes an already-started animation only on its delayed decision ticks.
    this.aiBlock = !f.attack && f.y >= GROUND && distance < 160 && (
      (p.attack !== null && Math.random() < blockChance) || Math.random() < blockChance * 0.11
    );
    this.aiDirection = distance > 112 ? f.facing : distance < 56 && Math.random() < 0.55 ? -f.facing : 0;
    if (this.aiBlock) { this.aiDirection = 0; return; }
    if (f.stun > 0) return;
    if (f.attack) {
      const chance = level === 'easy' ? 0.22 : level === 'normal' ? 0.58 : 0.87;
      if (f.confirmed && Math.random() < chance) {
        const followup = f.attack === 'jab' ? (Math.random() < 0.5 ? 'jab' : 'heavy')
          : f.attack === 'kick' ? (Math.random() < 0.5 ? 'kick' : 'heavyKick')
            : f.attack === 'uppercut' ? 'jab' : CHAIN[f.attack][0];
        if (followup) this.beginAttack(f, followup);
      }
      return;
    }
    if (distance > 200 && Math.random() < (level === 'easy' ? 0.025 : 0.12) && f.y >= GROUND) {
      f.vy = -520; this.sfx('swing');
    }
    if (f.energy >= 50 && distance < FIGHTERS[f.id].specialRange + 14 && Math.random() < (level === 'easy' ? 0.18 : 0.38)) {
      this.beginAttack(f, 'special'); return;
    }
    if (distance > 147) return;
    const choices: AttackId[] = level === 'easy'
      ? ['jab', 'heavy', 'kick', 'heavyKick', 'heavyKick', 'sweep']
      : ['jab', 'jab', 'kick', 'kick', 'heavy', 'heavyKick', 'uppercut', 'sweep'];
    let attack = choices[Math.floor(Math.random() * choices.length)];
    if (f.y < GROUND - 10) attack = 'airKick';
    if (distance > 113 && Math.random() < 0.35) attack = 'dash';
    if (distance < ATTACKS[attack].range + (level === 'easy' ? 24 : 12)) this.beginAttack(f, attack);
  }

  private updateBody(f: Fighter, dt: number, direction: number) {
    f.stun = Math.max(0, f.stun - dt);
    f.invulnerability = Math.max(0, f.invulnerability - dt);
    f.hitFlash = Math.max(0, f.hitFlash - dt);
    f.blockFlash = Math.max(0, f.blockFlash - dt);
    if (this.now - f.lastHit > 1.2) { f.combo = 0; f.comboDamage = 0; f.comboEnded = false; }
    f.moving = false;
    if (!f.attack && f.stun <= 0 && !f.crouching && !f.blocking && f.health > 0 && direction !== 0) {
      f.x += direction * FIGHTERS[f.id].speed * (f.y < GROUND ? 0.83 : 1) * dt;
      f.moving = true;
    }
    f.x += f.vx * dt;
    f.vx *= Math.max(0, 1 - dt * 9);
    if (f.y < GROUND || f.vy < 0) {
      f.vy += 1450 * dt;
      f.y += f.vy * dt;
      if (f.y >= GROUND) {
        f.y = GROUND; f.vy = 0;
        this.addDust(f.x / 2, GROUND / 2, 6);
      }
    }
    f.x = Math.max(52, Math.min(WORLD_WIDTH - 52, f.x));
  }

  private addDust(x: number, y: number, count = 8) {
    this.spawnDust(x, y, count);
    if (this.role === 'host') this.outbox.push(['d', Math.round(x), Math.round(y), count]);
  }

  private spawnDust(x: number, y: number, count: number) {
    if (this.particles.length > 600) return;
    for (let i = 0; i < count; i++) {
      const life = 0.2 + Math.random() * 0.18;
      this.particles.push({ x, y, vx: (Math.random() - 0.5) * 65, vy: -Math.random() * 35, life, maxLife: life, color: '#b5a089', size: 1 + Math.floor(Math.random() * 2) });
    }
  }

  private impact(x: number, y: number, color: string, heavy: boolean) {
    this.spawnImpact(x, y, color, heavy);
    if (this.role === 'host') this.outbox.push(['i', Math.round(x * 10) / 10, Math.round(y * 10) / 10, color, heavy ? 1 : 0]);
  }

  private spawnImpact(x: number, y: number, color: string, heavy: boolean) {
    if (this.particles.length > 600) return;
    for (let i = 0; i < (heavy ? 21 : 13); i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (heavy ? 80 : 52) * (0.4 + Math.random());
      const life = 0.13 + Math.random() * 0.22;
      this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 16, life, maxLife: life, color: i % 3 ? color : '#fff1d2', size: i % 4 === 0 ? 3 : 1 });
    }
  }

  private tryHit(attacker: Fighter, target: Fighter) {
    if (!attacker.attack || attacker.attackHit || target.invulnerability > 0 || target.health <= 0) return;
    const attack = ATTACKS[attacker.attack];
    const special = attacker.attack === 'special';
    const range = special ? FIGHTERS[attacker.id].specialRange : attack.range;
    const aLeft = attacker.facing > 0 ? attacker.x + 11 : attacker.x - range;
    const aRight = attacker.facing > 0 ? attacker.x + range : attacker.x - 11;
    const aTop = attacker.y - (special && attacker.id === 'titan' ? 55 : attack.top);
    const aBottom = attacker.y - attack.bottom;
    const targetHeight = (target.crouching ? 82 : 112) * FIGHTERS[target.id].size;
    if (aRight <= target.x - 22 || aLeft >= target.x + 22 || aBottom <= target.y - targetHeight || aTop >= target.y) return;
    attacker.attackHit = true;
    const hitX = (target.x - attacker.facing * 17) / 2;
    const hitY = (Math.max(aTop, target.y - targetHeight) + Math.min(aBottom, target.y)) / 4;
    if (target.blocking && !target.attack && target.facing === -attacker.facing && target.y >= GROUND) {
      const chip = special ? 2 : 0;
      target.health = Math.max(0, target.health - chip);
      target.energy = Math.min(100, target.energy + 5);
      attacker.energy = Math.min(100, attacker.energy + 2);
      attacker.combo = 0; attacker.comboDamage = 0; attacker.comboEnded = false; attacker.confirmed = false;
      target.blockFlash = 0.17; target.stun = 0.09;
      target.vx = attacker.facing * 120; attacker.vx = -attacker.facing * 35;
      this.text(target.x / 2, target.y / 2 - 68, chip ? 'БЛОК -2' : 'БЛОК', 0.7, '#a7eff0');
      this.impact(hitX, hitY, '#84dce5', false);
      this.sfx('block'); this.hitstop = 0.025;
      if (target.health <= 0) this.finishRound();
      return;
    }
    const count = !attacker.comboEnded && this.now - attacker.lastHit <= 1.2 ? attacker.combo + 1 : 1;
    if (count === 1) attacker.comboDamage = 0;
    attacker.comboEnded = false;
    const scaling = Math.max(0.42, 1 - Math.max(0, count - 3) * 0.12);
    const rawDamage = special ? FIGHTERS[attacker.id].specialDamage : attack.damage * FIGHTERS[attacker.id].damage;
    const damage = Math.max(2, Math.round(rawDamage * scaling));
    attacker.combo = count; attacker.comboDamage += damage; attacker.lastHit = this.now;
    attacker.confirmed = true;
    attacker.energy = Math.min(100, attacker.energy + (special ? 5 : 11));
    target.energy = Math.min(100, target.energy + damage * 0.85 + 4);
    target.health = Math.max(0, target.health - damage);
    target.attack = null; target.confirmed = false; target.blocking = false;
    target.crouching = false; target.stun = attack.heavy ? 0.34 : 0.24;
    target.hitFlash = 0.13; target.blockFlash = 0;
    target.vx = attacker.facing * (attack.heavy ? 210 : 105);
    attacker.vx = -attacker.facing * 18;
    if (attacker.attack === 'uppercut' || (special && attacker.id === 'titan')) {
      target.vy = -345; target.stun = 0.46;
    }
    if (attacker.attack === 'sweep') { target.stun = 0.46; target.vx = attacker.facing * 245; }
    if (attacker.attack === 'dash' || (special && attacker.id === 'vortex')) target.vx = attacker.facing * 300;
    if (count >= 8) {
      attacker.comboEnded = true;
      target.invulnerability = 0.85; target.stun = 0.1; target.vx = attacker.facing * 480; target.vy = -290;
      attacker.stun = 0.34; attacker.confirmed = false;
    }
    this.text(target.x / 2 + (Math.random() - 0.5) * 10, target.y / 2 - targetHeight / 2 - 9, `-${damage}`, 0.85, attack.heavy ? '#ffca83' : '#fff3d9');
    this.impact(hitX, hitY, FIGHTERS[attacker.id].color, attack.heavy);
    this.sfx(attack.heavy ? 'heavy' : 'light');
    this.sfx('voice');
    this.hitstop = attack.heavy ? 0.07 : 0.033;
    this.shake(attack.heavy ? 0.15 : 0.07, attack.heavy ? 3 : 1);
    if (this.role === 'local' && attacker === this.fighters[1] && count < 8) this.aiTimer = Math.min(this.aiTimer, this.config.difficulty === 'hard' ? 0.1 : this.config.difficulty === 'normal' ? 0.15 : 0.3);
    if (target.health <= 0) this.finishRound();
    this.emit();
  }

  private updateAttack(f: Fighter, target: Fighter, dt: number) {
    if (!f.attack || f.stun > 0) return;
    const attack = ATTACKS[f.attack];
    const timing = FIGHTERS[f.id].timing;
    const startup = attack.startup * timing;
    const active = attack.active;
    const recovery = attack.recovery * timing;
    f.attackTime += dt;
    if (f.attack === 'dash' && f.attackTime < startup + active) f.x += f.facing * 310 * dt;
    if (f.attack === 'special' && f.id === 'vortex' && f.attackTime < startup + active) f.x += f.facing * 135 * dt;
    if (f.attackTime >= startup && f.attackTime < startup + active) this.tryHit(f, target);
    if (f.attackTime >= startup + active + recovery) {
      f.attack = null; f.confirmed = false; f.attackTime = 0;
    }
    f.x = Math.max(52, Math.min(WORLD_WIDTH - 52, f.x));
  }

  private finishRound() {
    if (this.phase !== 'fight') return;
    const [p, e] = this.fighters;
    this.roundWinner = p.health === e.health ? null : p.health > e.health ? 0 : 1;
    if (this.roundWinner !== null) this.fighters[this.roundWinner].wins++;
    this.message = this.roundWinner === null ? 'НИЧЬЯ' : p.health <= 0 || e.health <= 0 ? 'НОКАУТ' : 'ВРЕМЯ!';
    this.phase = 'round-end'; this.phaseTime = 0;
    this.fighters.forEach(f => { f.attack = null; f.blocking = false; f.moving = false; });
    this.clearInput();
    if (this.roundWinner !== null) this.sfx('ko');
    this.emit();
  }

  private nextRound() {
    const [p, e] = this.fighters;
    if (p.wins >= 2 || e.wins >= 2) {
      this.winner = p.wins >= 2 ? 0 : 1;
      this.phase = 'match-end'; this.paused = false;
      this.sfx(this.winner === 0 ? 'win' : 'lose'); this.emit(); return;
    }
    if (this.roundWinner !== null) this.round++;
    this.fighters = [makeFighter(p.id, 310, 1), makeFighter(e.id, 650, -1)];
    this.fighters[0].wins = p.wins; this.fighters[1].wins = e.wins;
    this.fighters[0].energy = p.energy; this.fighters[1].energy = e.energy;
    this.timer = 60; this.phaseTime = 0; this.phase = 'countdown'; this.countdown = '3';
    this.message = ''; this.roundWinner = null; this.hitstop = 0;
    this.aiTimer = 0.4; this.aiDirection = 0; this.aiBlock = false;
    this.floating = []; this.particles = []; this.clearInput();
    this.sfx('count'); this.emit();
  }

  private updateEffects(dt: number) {
    this.shakeTime = Math.max(0, this.shakeTime - dt);
    this.particles.forEach(p => { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 140 * dt; });
    this.particles = this.particles.filter(p => p.life > 0);
    this.floating.forEach(text => { text.life -= dt; text.y -= dt * 18; });
    this.floating = this.floating.filter(text => text.life > 0);
  }

  step(dt: number) {
    if (this.role === 'client') this.stepClient(dt); else this.stepSim(dt);
    this.onNetTick?.();
  }

  /** Guest: no simulation. Show the host's states one per tick, with a one-tick buffer against network jitter. */
  private stepClient(dt: number) {
    const queue = this.stateQueue;
    if (queue.length > 3) queue.splice(0, queue.length - 2);
    if (queue.length > 1) this.applyState(queue.shift()!);
    if (this.paused || this.hitstopView) return;
    this.visualTime += dt;
    this.updateEffects(dt);
  }

  private applyState(s: StateMsg) {
    this.phase = PHASES[s.ph] ?? 'fight';
    this.paused = s.pa === 1;
    this.hitstopView = s.hs === 1;
    this.timer = s.ti; this.round = s.ro; this.countdown = s.cd; this.message = s.ms;
    this.roundWinner = s.rw < 0 ? null : s.rw;
    this.winner = s.wn < 0 ? null : s.wn;
    s.f.forEach((a, i) => {
      const f = this.fighters[i];
      f.id = FIGHTER_IDS[a[0]] ?? f.id;
      f.x = a[1]; f.y = a[2]; f.facing = a[3];
      f.health = a[10]; f.energy = a[11]; f.wins = a[12]; f.combo = a[13]; f.comboDamage = a[14];
      this.netVisuals[i] = {
        id: f.id, x: a[1], y: a[2], facing: a[3], pose: POSES[a[4]] ?? 'idle',
        attack: a[5] >= 0 ? ATTACK_IDS[a[5]] : undefined, extension: a[6], hitFlash: a[7], blockFlash: a[8], invulnerable: a[9] === 1,
      };
    });
    const hud = `${s.ph}|${s.pa}|${s.ti}|${s.ro}|${s.cd}|${s.ms}|${s.rw}|${s.wn}|${s.f[0].slice(10)}|${s.f[1].slice(10)}`;
    if (hud !== this.hudKey) { this.hudKey = hud; this.emit(); }
  }

  private stepSim(dt: number) {
    // The remote player's tab may stop sending (hidden tab, lost connection): never leave their keys stuck.
    if (this.role === 'host' && this.remoteSeen && performance.now() - this.remoteSeen > 300) {
      this.ctl[1].clear(); this.remoteMask = 0; this.remoteSeen = 0;
    }
    if (this.paused) return;
    this.now += dt;
    this.emitTime += dt;
    if (this.hitstop > 0) { this.hitstop = Math.max(0, this.hitstop - dt); return; }
    this.visualTime += dt;
    this.updateEffects(dt);
    if (this.phase === 'menu' || this.phase === 'match-end') return;
    this.phaseTime += dt;
    if (this.phase === 'countdown') {
      const next = this.phaseTime < 1 ? '3' : this.phaseTime < 2 ? '2' : this.phaseTime < 3 ? '1' : 'БОЙ!';
      if (next !== this.countdown) { this.countdown = next; this.sfx(next === 'БОЙ!' ? 'fight' : 'count'); this.emit(); }
      if (this.phaseTime >= 3) { this.phase = 'fight'; this.phaseTime = 0; this.emit(); }
      return;
    }
    if (this.phase === 'round-end') {
      this.fighters.forEach(f => this.updateBody(f, dt, 0));
      if (this.phaseTime >= 2.8) this.nextRound();
      return;
    }
    if (this.countdown && this.phaseTime > 0.75) this.countdown = '';
    this.timer = Math.max(0, this.timer - dt);
    this.tick++;
    const [p, e] = this.fighters;
    const versus = this.role === 'host';
    p.facing = e.x >= p.x ? 1 : -1; e.facing = -p.facing;
    this.driveStance(0);
    if (versus) this.driveStance(1);
    else {
      this.thinkAI(dt);
      e.blocking = this.aiBlock && e.y >= GROUND && !e.attack && (e.stun <= 0 || e.blockFlash > 0);
      e.crouching = e.attack === 'sweep' && e.stun <= 0;
    }
    const playerDirection = this.driveActions(0);
    const enemyDirection = versus ? this.driveActions(1) : this.aiDirection;
    this.updateBody(p, dt, playerDirection);
    this.updateBody(e, dt, enemyDirection);
    const separation = e.x - p.x;
    if (Math.abs(separation) < 48 && Math.abs(e.y - p.y) < 76) {
      const push = (48 - Math.abs(separation)) / 2;
      const sign = separation >= 0 ? 1 : -1;
      p.x -= sign * push; e.x += sign * push;
      p.x = Math.max(52, Math.min(WORLD_WIDTH - 52, p.x));
      e.x = Math.max(52, Math.min(WORLD_WIDTH - 52, e.x));
    }
    // Against a human the one who is processed first wins an exactly simultaneous hit, so the order alternates.
    const [first, second] = versus && this.tick % 2 === 0 ? [e, p] : [p, e];
    this.updateAttack(first, second, dt);
    if (this.phase === 'fight') this.updateAttack(second, first, dt);
    if (this.timer <= 0 && this.phase === 'fight') this.finishRound();
    if (this.emitTime >= 0.05) { this.emitTime = 0; this.emit(); }
  }

  private visual(f: Fighter, index: number): FighterVisual {
    let pose: FighterVisual['pose'] = 'idle';
    if (f.health <= 0) pose = 'ko';
    else if ((this.phase === 'round-end' && this.phaseTime > 0.65 && index === this.roundWinner) || (this.phase === 'match-end' && index === this.winner)) pose = 'victory';
    else if (f.blocking) pose = 'block';
    else if (f.stun > 0) pose = 'hurt';
    else if (f.attack) pose = 'attack';
    else if (f.y < GROUND) pose = 'jump';
    else if (f.crouching) pose = 'crouch';
    else if (f.moving) pose = 'walk';
    let extension = 0;
    if (f.attack) {
      const attack = ATTACKS[f.attack];
      const timing = FIGHTERS[f.id].timing;
      const startup = attack.startup * timing;
      extension = f.attackTime < startup ? f.attackTime / startup * 0.25
        : f.attackTime < startup + attack.active ? 1
          : Math.max(0, 1 - (f.attackTime - startup - attack.active) / (attack.recovery * timing));
    }
    const facing = pose === 'ko' && f.x < 190 ? -1 : pose === 'ko' && f.x > 770 ? 1 : f.facing;
    return { id: f.id, x: f.x, y: f.y, facing, pose, attack: f.attack ?? undefined, extension, hitFlash: f.hitFlash, blockFlash: f.blockFlash, invulnerable: f.invulnerability > 0 };
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#171b24'; ctx.fillRect(0, 0, 480, 270);
    ctx.save();
    if (!this.paused && this.settings.shake && this.shakeTime > 0) ctx.translate(Math.round((Math.random() - 0.5) * this.shakePower * 2), Math.round((Math.random() - 0.5) * this.shakePower));
    const [first, second] = this.role === 'client' ? this.netVisuals : [this.visual(this.fighters[0], 0), this.visual(this.fighters[1], 1)];
    const focus = this.phase === 'menu' ? Math.sin(this.visualTime * 0.14) * 0.35 : ((first.x + second.x) / 2 - 480) / 480;
    drawArena(ctx, this.config.arena, this.visualTime, focus);
    const scale = this.phase === 'menu' ? 1.65 : 1.15;
    drawFighter(ctx, second, this.visualTime, scale);
    drawFighter(ctx, first, this.visualTime, scale);
    for (const particle of this.particles) {
      ctx.globalAlpha = Math.min(1, particle.life / particle.maxLife * 1.5);
      ctx.fillStyle = particle.color;
      ctx.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
    }
    ctx.textAlign = 'center'; ctx.font = 'bold 11px monospace'; ctx.lineWidth = 3;
    for (const text of this.floating) {
      ctx.globalAlpha = Math.min(1, text.life * 4);
      ctx.strokeStyle = '#172029'; ctx.fillStyle = text.color;
      ctx.strokeText(text.text, Math.round(text.x), Math.round(text.y));
      ctx.fillText(text.text, Math.round(text.x), Math.round(text.y));
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  destroy() { this.clearInput(); this.audio.destroy(); }
}