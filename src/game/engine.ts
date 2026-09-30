import { GameAudio } from './audio';
import { drawArena, drawFighter } from './art';
import {
  ATTACKS, DEFAULT_MATCH, FIGHTERS, GROUND, WORLD_WIDTH,
  type Action, type AttackId, type FighterId, type FighterSnapshot,
  type FighterVisual, type MatchConfig, type Phase, type Settings, type Snapshot,
} from './types';

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

interface Command { attack: AttackId; time: number }
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
  private held = new Set<Action>();
  private sources = new Map<string, Action>();
  private buffer: Command[] = [];
  private lastTap = new Map<Action, number>();
  private dashUntil = 0;
  private dashDirection = 0;
  private jumpUntil = -1;
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
    this.clearInput(); this.audio.play('count'); this.emit();
  }

  setSettings(settings: Settings) { this.settings = settings; this.audio.update(settings); }

  pause(value = !this.paused) {
    if (this.phase === 'menu' || this.phase === 'match-end') return;
    this.paused = value; this.clearInput(); this.emit();
  }

  clearInput() {
    this.held.clear(); this.sources.clear(); this.buffer = [];
    this.jumpUntil = -1; this.dashUntil = 0; this.lastTap.clear();
  }

  press(action: Action, source: string = action) {
    this.audio.unlock();
    if (this.paused || this.sources.has(source)) return;
    this.sources.set(source, action); this.held.add(action);
    if (this.phase !== 'fight') return;
    if (action === 'left' || action === 'right') {
      const last = this.lastTap.get(action);
      if (last !== undefined && this.now - last < 0.27) {
        this.dashUntil = this.now + 0.38;
        this.dashDirection = action === 'right' ? 1 : -1;
      }
      this.lastTap.set(action, this.now);
    } else if (action === 'up') {
      this.jumpUntil = this.now + 0.18;
    } else if (['jab', 'heavy', 'kick', 'heavyKick', 'special'].includes(action)) {
      const f = this.fighters[0];
      let attack = action as AttackId;
      if (action === 'heavy' && this.held.has('down')) attack = 'uppercut';
      if (action === 'heavyKick') {
        if (this.held.has('down') && f.y >= GROUND) attack = 'sweep';
        else if (this.held.has('up') || f.y < GROUND - 1) attack = 'airKick';
      }
      if (action === 'jab' && this.dashUntil > this.now && this.dashDirection === f.facing) {
        attack = 'dash'; this.dashUntil = 0;
      }
      this.buffer.push({ attack, time: this.now });
      if (this.buffer.length > 6) this.buffer.shift();
    }
  }

  release(action: Action, source: string = action) {
    this.sources.delete(source);
    if (![...this.sources.values()].includes(action)) this.held.delete(action);
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
      this.audio.play('special');
    } else this.audio.play('swing');
    if (attack === 'airKick' && f.y >= GROUND && f.vy >= 0) {
      f.vy = -465; f.crouching = false;
    }
    f.attack = attack; f.attackTime = 0; f.attackHit = false; f.confirmed = false;
    f.crouching = attack === 'sweep'; f.blocking = false; f.moving = false;
    return true;
  }

  private consumeInput() {
    this.buffer = this.buffer.filter(command => this.now - command.time <= 0.18);
    const command = this.buffer[0];
    if (!command) return;
    const f = this.fighters[0];
    if (command.attack === 'special' && f.energy < 50 && !f.attack && f.stun <= 0) {
      this.floating.push({ x: f.x / 2, y: f.y / 2 - 71, text: 'НУЖНО 50 ЭНЕРГИИ', life: 0.65, color: '#e1c89b' });
      this.buffer.shift(); return;
    }
    if (this.beginAttack(f, command.attack)) this.buffer.shift();
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
      f.vy = -520; this.audio.play('swing');
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
    for (let i = 0; i < count; i++) {
      const life = 0.2 + Math.random() * 0.18;
      this.particles.push({ x, y, vx: (Math.random() - 0.5) * 65, vy: -Math.random() * 35, life, maxLife: life, color: '#b5a089', size: 1 + Math.floor(Math.random() * 2) });
    }
  }

  private impact(x: number, y: number, color: string, heavy: boolean) {
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
      this.floating.push({ x: target.x / 2, y: target.y / 2 - 68, text: chip ? 'БЛОК -2' : 'БЛОК', life: 0.7, color: '#a7eff0' });
      this.impact(hitX, hitY, '#84dce5', false);
      this.audio.play('block'); this.hitstop = 0.025;
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
    this.floating.push({ x: target.x / 2 + (Math.random() - 0.5) * 10, y: target.y / 2 - targetHeight / 2 - 9, text: `-${damage}`, life: 0.85, color: attack.heavy ? '#ffca83' : '#fff3d9' });
    this.impact(hitX, hitY, FIGHTERS[attacker.id].color, attack.heavy);
    this.audio.play(attack.heavy ? 'heavy' : 'light');
    this.audio.voice();
    this.hitstop = attack.heavy ? 0.07 : 0.033;
    this.shakeTime = attack.heavy ? 0.15 : 0.07;
    this.shakePower = attack.heavy ? 3 : 1;
    if (attacker === this.fighters[1] && count < 8) this.aiTimer = Math.min(this.aiTimer, this.config.difficulty === 'hard' ? 0.1 : this.config.difficulty === 'normal' ? 0.15 : 0.3);
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
    if (this.roundWinner !== null) this.audio.play('ko');
    this.emit();
  }

  private nextRound() {
    const [p, e] = this.fighters;
    if (p.wins >= 2 || e.wins >= 2) {
      this.winner = p.wins >= 2 ? 0 : 1;
      this.phase = 'match-end'; this.paused = false;
      this.audio.play(this.winner === 0 ? 'win' : 'lose'); this.emit(); return;
    }
    if (this.roundWinner !== null) this.round++;
    this.fighters = [makeFighter(p.id, 310, 1), makeFighter(e.id, 650, -1)];
    this.fighters[0].wins = p.wins; this.fighters[1].wins = e.wins;
    this.fighters[0].energy = p.energy; this.fighters[1].energy = e.energy;
    this.timer = 60; this.phaseTime = 0; this.phase = 'countdown'; this.countdown = '3';
    this.message = ''; this.roundWinner = null; this.hitstop = 0;
    this.aiTimer = 0.4; this.aiDirection = 0; this.aiBlock = false;
    this.floating = []; this.particles = []; this.clearInput();
    this.audio.play('count'); this.emit();
  }

  private updateEffects(dt: number) {
    this.shakeTime = Math.max(0, this.shakeTime - dt);
    this.particles.forEach(p => { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 140 * dt; });
    this.particles = this.particles.filter(p => p.life > 0);
    this.floating.forEach(text => { text.life -= dt; text.y -= dt * 18; });
    this.floating = this.floating.filter(text => text.life > 0);
  }

  step(dt: number) {
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
      if (next !== this.countdown) { this.countdown = next; this.audio.play(next === 'БОЙ!' ? 'fight' : 'count'); this.emit(); }
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
    const [p, e] = this.fighters;
    p.facing = e.x >= p.x ? 1 : -1; e.facing = -p.facing;
    p.crouching = p.stun <= 0 && p.y >= GROUND && (p.attack === 'sweep' || (this.held.has('down') && !this.held.has('block') && !p.attack));
    p.blocking = this.held.has('block') && p.y >= GROUND && !p.attack && (p.stun <= 0 || p.blockFlash > 0);
    this.thinkAI(dt);
    e.blocking = this.aiBlock && e.y >= GROUND && !e.attack && (e.stun <= 0 || e.blockFlash > 0);
    e.crouching = e.attack === 'sweep' && e.stun <= 0;
    if (this.jumpUntil >= this.now && p.y >= GROUND && p.stun <= 0 && !p.attack && !p.blocking) {
      p.vy = -535; p.crouching = false; this.jumpUntil = -1; this.audio.play('swing');
    }
    this.consumeInput();
    const playerDirection = Number(this.held.has('right')) - Number(this.held.has('left'));
    this.updateBody(p, dt, playerDirection);
    this.updateBody(e, dt, this.aiDirection);
    const separation = e.x - p.x;
    if (Math.abs(separation) < 48 && Math.abs(e.y - p.y) < 76) {
      const push = (48 - Math.abs(separation)) / 2;
      const sign = separation >= 0 ? 1 : -1;
      p.x -= sign * push; e.x += sign * push;
      p.x = Math.max(52, Math.min(WORLD_WIDTH - 52, p.x));
      e.x = Math.max(52, Math.min(WORLD_WIDTH - 52, e.x));
    }
    this.updateAttack(p, e, dt);
    if (this.phase === 'fight') this.updateAttack(e, p, dt);
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
    const focus = this.phase === 'menu' ? Math.sin(this.visualTime * 0.14) * 0.35 : ((this.fighters[0].x + this.fighters[1].x) / 2 - 480) / 480;
    drawArena(ctx, this.config.arena, this.visualTime, focus);
    const scale = this.phase === 'menu' ? 1.65 : 1.15;
    drawFighter(ctx, this.visual(this.fighters[1], 1), this.visualTime, scale);
    drawFighter(ctx, this.visual(this.fighters[0], 0), this.visualTime, scale);
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