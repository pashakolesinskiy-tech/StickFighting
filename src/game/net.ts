import { PROTOCOL_VERSION, type CtlMsg, type FastMsg } from './protocol';

/**
 * Serverless connection between two browsers (WebRTC data channels).
 *
 * There is no game server: the device that creates the game is the host (it runs the match),
 * the other one joins it. To connect, the two players exchange two short codes by any messenger:
 *   host -> guest: "host code" (WebRTC offer), guest -> host: "answer code" (WebRTC answer).
 * STUN is only used to discover the public address when the devices are not in one network.
 */

export type LinkStatus = 'idle' | 'gathering' | 'waiting' | 'connecting' | 'open' | 'closed' | 'failed';

const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
/** Codes are not trickled: wait for the candidates, but never longer than this (offline LAN has no STUN answer). */
const GATHER_TIMEOUT_MS = 2500;
const WATCHDOG_MS = 8000;
const BUFFER_LIMIT = 64 * 1024;

// ---- Signal codes ---------------------------------------------------------------------------

export type SignalKind = 'offer' | 'answer';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(new Uint8Array(bytes)).then(() => writer.close()).catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

const hasCompression = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** "SF1-O-..." (compressed) or "SF0-O-..." (plain, for browsers without CompressionStream). O = offer, A = answer. */
export async function encodeSignal(kind: SignalKind, sdp: string): Promise<string> {
  const raw = new TextEncoder().encode(sdp);
  const packed = hasCompression() ? await pipe(raw, new CompressionStream('deflate-raw')) : raw;
  return `SF${hasCompression() ? 1 : 0}-${kind === 'offer' ? 'O' : 'A'}-${toBase64Url(packed)}`;
}

export class SignalError extends Error {}

export async function decodeSignal(code: string, expected: SignalKind): Promise<string> {
  const match = /^SF([01])-([OA])-([A-Za-z0-9_-]+)$/.exec(code.replace(/\s+/g, ''));
  if (!match) throw new SignalError('Код не распознан. Скопируйте его целиком, без изменений.');
  const kind: SignalKind = match[2] === 'O' ? 'offer' : 'answer';
  if (kind !== expected) {
    throw new SignalError(expected === 'offer'
      ? 'Это код ответа. Здесь нужен код хоста, который создал игру.'
      : 'Это код хоста. Здесь нужен код ответа, который прислал друг.');
  }
  try {
    const bytes = fromBase64Url(match[3]);
    if (match[1] === '0') return new TextDecoder().decode(bytes);
    if (!hasCompression()) throw new SignalError('Этот браузер не поддерживает такие коды. Обновите браузер.');
    return new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw')));
  } catch (error) {
    if (error instanceof SignalError) throw error;
    throw new SignalError('Код повреждён. Скопируйте его целиком, без изменений.');
  }
}

// ---- Session --------------------------------------------------------------------------------

export class NetSession {
  readonly host: boolean;
  status: LinkStatus = 'idle';
  detail = '';
  /** Smoothed round-trip time, ms. */
  rtt = 0;
  /** performance.now() of the last message on the fast channel. */
  lastFastAt = 0;
  onStatus: ((status: LinkStatus, detail: string) => void) | null = null;
  onCtl: ((msg: CtlMsg) => void) | null = null;
  onFast: ((msg: FastMsg) => void) | null = null;
  onStats: (() => void) | null = null;

  private pc: RTCPeerConnection;
  private ctl: RTCDataChannel;
  private fast: RTCDataChannel;
  private lastRecvAt = performance.now();
  private pingTimer = 0;
  private disconnectTimer = 0;
  private closing = false;
  private wasOpen = false;
  private answerApplied = false;

  constructor(host: boolean) {
    if (typeof RTCPeerConnection === 'undefined') throw new SignalError('Этот браузер не поддерживает сетевую игру (WebRTC).');
    this.host = host;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    // Both sides create the same pre-negotiated channels, so no signalling is needed for them.
    this.ctl = this.pc.createDataChannel('ctl', { negotiated: true, id: 0 });
    this.fast = this.pc.createDataChannel('fast', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    this.ctl.onmessage = event => this.receive(event.data, false);
    this.fast.onmessage = event => this.receive(event.data, true);
    this.ctl.onopen = () => this.checkOpen();
    this.fast.onopen = () => this.checkOpen();
    this.ctl.onclose = () => { if (this.wasOpen) this.finish('closed', 'Соединение закрыто.'); };
    this.pc.onconnectionstatechange = () => this.onConnectionState();
  }

  get isOpen() { return this.status === 'open'; }

  private setStatus(status: LinkStatus, detail = '') {
    if (this.status === status && this.detail === detail) return;
    this.status = status; this.detail = detail;
    this.onStatus?.(status, detail);
  }

  private waitForGathering(): Promise<void> {
    return new Promise(resolve => {
      if (this.pc.iceGatheringState === 'complete') { resolve(); return; }
      const check = () => { if (this.pc.iceGatheringState === 'complete') done(); };
      const done = () => { clearTimeout(timer); this.pc.removeEventListener('icegatheringstatechange', check); resolve(); };
      const timer = window.setTimeout(done, GATHER_TIMEOUT_MS);
      this.pc.addEventListener('icegatheringstatechange', check);
    });
  }

  private async localCode(kind: SignalKind): Promise<string> {
    await this.waitForGathering();
    const sdp = this.pc.localDescription?.sdp;
    if (!sdp) throw new SignalError('Не удалось подготовить код подключения.');
    return encodeSignal(kind, sdp);
  }

  /** Host: create the code to give to the friend. */
  async createOffer(): Promise<string> {
    this.setStatus('gathering');
    await this.pc.setLocalDescription(await this.pc.createOffer());
    const code = await this.localCode('offer');
    if (this.status === 'gathering') this.setStatus('waiting');
    return code;
  }

  /** Guest: take the host's code, return the answer code to send back. */
  async acceptOffer(code: string): Promise<string> {
    const sdp = await decodeSignal(code, 'offer');
    this.setStatus('gathering');
    try {
      await this.pc.setRemoteDescription({ type: 'offer', sdp });
      await this.pc.setLocalDescription(await this.pc.createAnswer());
    } catch {
      this.setStatus('idle');
      throw new SignalError('Код хоста не подходит. Попросите друга создать игру заново.');
    }
    const answer = await this.localCode('answer');
    if (this.status === 'gathering') this.setStatus('waiting');
    return answer;
  }

  /** Host: take the friend's answer code. The connection starts right after this. */
  async acceptAnswer(code: string): Promise<void> {
    const sdp = await decodeSignal(code, 'answer');
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp });
    } catch {
      throw new SignalError('Код ответа не подходит к этой игре. Создайте игру заново и отправьте новый код.');
    }
    this.answerApplied = true;
    this.setStatus(this.wasOpen ? 'open' : 'connecting');
  }

  private onConnectionState() {
    if (this.closing) return;
    const state = this.pc.connectionState;
    window.clearTimeout(this.disconnectTimer);
    // The guest starts its connectivity checks as soon as it has the offer, which makes the host's browser report
    // "connecting" before the host has even received the answer code: the host only counts from acceptAnswer().
    if (state === 'connecting' && !this.wasOpen) { if (!this.host || this.answerApplied) this.setStatus('connecting'); }
    else if (state === 'failed') this.finish('failed', this.wasOpen ? 'Соединение потеряно.' : 'Не удалось соединиться. Проверьте, что оба устройства в одной Wi-Fi сети или у обоих есть интернет, и попробуйте ещё раз.');
    else if (state === 'closed') this.finish('closed', 'Соединение закрыто.');
    else if (state === 'disconnected') this.disconnectTimer = window.setTimeout(() => this.finish('failed', 'Соединение потеряно.'), 5000);
  }

  private checkOpen() {
    if (this.ctl.readyState !== 'open' || this.fast.readyState !== 'open' || this.wasOpen) return;
    this.wasOpen = true;
    this.lastRecvAt = performance.now();
    this.setStatus('open');
    this.sendCtl({ t: 'hello', v: PROTOCOL_VERSION });
    this.pingTimer = window.setInterval(() => {
      if (performance.now() - this.lastRecvAt > WATCHDOG_MS) { this.finish('failed', 'Соединение потеряно.'); return; }
      this.sendCtl({ t: 'ping', ts: performance.now() });
    }, 1000);
  }

  private receive(data: unknown, fast: boolean) {
    this.lastRecvAt = performance.now();
    if (typeof data !== 'string') return;
    let msg: unknown;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (fast) {
      this.lastFastAt = this.lastRecvAt;
      this.onFast?.(msg as FastMsg);
      return;
    }
    const ctl = msg as CtlMsg;
    if (ctl.t === 'ping') { this.sendCtl({ t: 'pong', ts: ctl.ts }); return; }
    if (ctl.t === 'pong') {
      const sample = performance.now() - ctl.ts;
      this.rtt = this.rtt ? this.rtt * 0.7 + sample * 0.3 : sample;
      this.onStats?.();
      return;
    }
    this.onCtl?.(ctl);
  }

  sendCtl(msg: CtlMsg): boolean {
    if (this.ctl.readyState !== 'open') return false;
    try { this.ctl.send(JSON.stringify(msg)); return true; } catch { return false; }
  }

  /** Unreliable and unordered; dropped when the link is congested, a newer one follows in 16 ms anyway. */
  sendFast(msg: FastMsg): boolean {
    if (this.fast.readyState !== 'open' || this.fast.bufferedAmount > BUFFER_LIMIT) return false;
    try { this.fast.send(JSON.stringify(msg)); return true; } catch { return false; }
  }

  private finish(status: 'closed' | 'failed', detail: string) {
    if (this.closing) return;
    this.teardown();
    this.setStatus(status, detail);
  }

  private teardown() {
    this.closing = true;
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.disconnectTimer);
    try { this.ctl.close(); this.fast.close(); this.pc.close(); } catch { /* Already closed. */ }
  }

  /** Leave the game. The peer is told first, so it can show "friend left" instead of "connection lost". */
  close() {
    if (this.closing) return;
    this.sendCtl({ t: 'bye' });
    this.closing = true;
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.disconnectTimer);
    this.onStatus = null; this.onCtl = null; this.onFast = null; this.onStats = null;
    // Give the "bye" a moment to leave before the channel is torn down.
    window.setTimeout(() => { try { this.ctl.close(); this.fast.close(); this.pc.close(); } catch { /* Already closed. */ } }, 200);
  }
}
