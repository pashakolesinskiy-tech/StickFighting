import { GROUND, type Action, type AttackId } from './types';
import { ACTIONS, actionMask, type InputEvent, type InputMsg } from './protocol';

export interface Command { attack: AttackId; time: number }

interface Body { y: number; facing: number }

/** Input state of one fighter: held keys, buffered attacks, double-tap dash, jump buffer. */
export class InputController {
  held = new Set<Action>();
  sources = new Map<string, Action>();
  buffer: Command[] = [];
  lastTap = new Map<Action, number>();
  dashUntil = 0;
  dashDirection = 0;
  jumpUntil = -1;

  clear() {
    this.held.clear(); this.sources.clear(); this.buffer = [];
    this.jumpUntil = -1; this.dashUntil = 0; this.lastTap.clear();
  }

  press(action: Action, source: string, now: number, fighting: boolean, body: Body) {
    if (this.sources.has(source)) return;
    this.sources.set(source, action); this.held.add(action);
    if (!fighting) return;
    if (action === 'left' || action === 'right') {
      const last = this.lastTap.get(action);
      if (last !== undefined && now - last < 0.27) {
        this.dashUntil = now + 0.38;
        this.dashDirection = action === 'right' ? 1 : -1;
      }
      this.lastTap.set(action, now);
    } else if (action === 'up') {
      this.jumpUntil = now + 0.18;
    } else if (['jab', 'heavy', 'kick', 'heavyKick', 'special'].includes(action)) {
      let attack = action as AttackId;
      if (action === 'heavy' && this.held.has('down')) attack = 'uppercut';
      if (action === 'heavyKick') {
        if (this.held.has('down') && body.y >= GROUND) attack = 'sweep';
        else if (this.held.has('up') || body.y < GROUND - 1) attack = 'airKick';
      }
      if (action === 'jab' && this.dashUntil > now && this.dashDirection === body.facing) {
        attack = 'dash'; this.dashUntil = 0;
      }
      this.buffer.push({ attack, time: now });
      if (this.buffer.length > 6) this.buffer.shift();
    }
  }

  release(action: Action, source: string) {
    this.sources.delete(source);
    if (![...this.sources.values()].includes(action)) this.held.delete(action);
  }
}

const EVENT_WINDOW_MS = 500;

/**
 * Guest side: records the local player's input and packs it for the host.
 * Every packet repeats the events of the last 0.5 s, so a single lost packet changes nothing.
 */
export class ClientInput {
  private held = new Set<Action>();
  private sources = new Map<string, Action>();
  private events: { id: number; bit: number; down: 0 | 1; at: number }[] = [];
  private nextId = 1;
  private seq = 0;

  clear() {
    for (const action of this.held) this.push(action, 0);
    this.held.clear(); this.sources.clear();
  }

  press(action: Action, source: string) {
    if (this.sources.has(source)) return;
    this.sources.set(source, action); this.held.add(action);
    this.push(action, 1);
  }

  release(action: Action, source: string) {
    if (!this.sources.delete(source)) return;
    if ([...this.sources.values()].includes(action)) return;
    this.held.delete(action);
    this.push(action, 0);
  }

  private push(action: Action, down: 0 | 1) {
    this.events.push({ id: this.nextId++, bit: ACTIONS.indexOf(action), down, at: performance.now() });
  }

  packet(): InputMsg {
    const cutoff = performance.now() - EVENT_WINDOW_MS;
    this.events = this.events.filter(event => event.at >= cutoff);
    const e: InputEvent[] = this.events.map(event => [event.id, event.bit, event.down]);
    return { k: 'i', n: ++this.seq, h: actionMask(this.held), e };
  }
}
