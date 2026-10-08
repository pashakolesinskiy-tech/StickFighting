import { PROTOCOL_VERSION, type CtlMsg, type FastMsg } from './protocol';

/**
 * WebRTC connection between two browsers using two negotiated DataChannels:
 *  - "ctl" (id 0): reliable & ordered control messages
 *  - "fast" (id 1): unreliable & unordered 60Hz state/input messages
 *
 * Supports automatic 1-step room connection (for QR codes and 6-char room codes)
 * with Trickle ICE, plus manual SDP codes (SF1-O-... / SF1-A-...) as an offline fallback.
 */

export type LinkStatus = 'idle' | 'gathering' | 'waiting' | 'connecting' | 'open' | 'closed' | 'failed';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

const GATHER_TIMEOUT_MS = 3000;
const WATCHDOG_MS = 8000;
const BUFFER_LIMIT = 64 * 1024;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ---- Manual Signal codes (offline fallback) -------------------------------------------------

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

export async function encodeSignal(kind: SignalKind, sdp: string): Promise<string> {
  const raw = new TextEncoder().encode(sdp);
  if (typeof CompressionStream !== 'undefined') {
    try {
      const packed = await pipe(raw, new CompressionStream('deflate-raw'));
      return `SF1-${kind === 'offer' ? 'O' : 'A'}-${toBase64Url(packed)}`;
    } catch { /* Fallback to uncompressed SF0 below */ }
  }
  return `SF0-${kind === 'offer' ? 'O' : 'A'}-${toBase64Url(raw)}`;
}

export class SignalError extends Error {}

export async function decodeSignal(code: string, expected: SignalKind): Promise<string> {
  const match = /^SF([01])-([OA])-([A-Za-z0-9_-]+)$/.exec(code.replace(/\s+/g, ''));
  if (!match) throw new SignalError('Код не распознан. Проверьте код комнаты или отсканируйте QR-код.');
  const kind: SignalKind = match[2] === 'O' ? 'offer' : 'answer';
  if (kind !== expected) {
    throw new SignalError(expected === 'offer'
      ? 'Это код ответа. Здесь нужен код хоста, который создал игру.'
      : 'Это код хоста. Здесь нужен код ответа, который прислал друг.');
  }
  try {
    const bytes = fromBase64Url(match[3]);
    if (match[1] === '0') return new TextDecoder().decode(bytes);
    if (typeof DecompressionStream === 'undefined') throw new SignalError('Этот браузер не поддерживает сжатые коды.');
    return new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw')));
  } catch (error) {
    if (error instanceof SignalError) throw error;
    throw new SignalError('Код повреждён. Скопируйте его целиком, без изменений.');
  }
}

export function isManualSignalCode(code: string): boolean {
  return /^SF[01]-[OA]-/i.test(code.trim());
}

export function normalizeRoomCode(input: string): string {
  const raw = input.trim();
  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const url = new URL(raw);
      const fromParam = url.searchParams.get('join') || url.searchParams.get('room');
      if (fromParam) return fromParam.trim().toUpperCase();
    }
  } catch { /* Not a URL */ }
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function randomRoomCode(length = 6): string {
  let code = '';
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  for (let i = 0; i < length; i++) code += ROOM_CHARS[values[i] % ROOM_CHARS.length];
  return code;
}

// ---- Automatic Room Signaling (WebSocket + BroadcastChannel + ntfy) -------------------------

type WireSignal =
  | { id: string; from: string; to: string; sig: 'join' }
  | { id: string; from: string; to: string; sig: 'offer'; sdp: string }
  | { id: string; from: string; to: string; sig: 'answer'; sdp: string }
  | { id: string; from: string; to: string; sig: 'ice'; candidate: RTCIceCandidateInit };

class RoomSignaler {
  private myId: string;
  private room: string;
  private bc: BroadcastChannel | null = null;
  private peerWs: WebSocket | null = null;
  private ntfyWs: WebSocket | null = null;
  private heartbeatTimer = 0;
  private seenIds = new Set<string>();
  private closed = false;
  onSignal: ((msg: WireSignal) => void) | null = null;

  constructor(room: string, isHost: boolean) {
    this.room = room.toUpperCase();
    const suffix = Math.random().toString(36).slice(2, 6);
    this.myId = isHost ? `sf26-host-${this.room}` : `sf26-guest-${this.room}-${suffix}`;
    this.setupBroadcastChannel();
    this.setupPeerJsSocket();
    this.setupNtfySocket();
  }

  get peerId(): string {
    return this.myId;
  }

  get hostPeerId(): string {
    return `sf26-host-${this.room}`;
  }

  private handleIncoming(raw: unknown) {
    if (this.closed || !raw || typeof raw !== 'object') return;
    const msg = raw as WireSignal;
    if (!msg.id || !msg.sig || !msg.from) return;
    if (msg.from === this.myId) return;
    if (msg.to && msg.to !== '*' && msg.to !== this.myId) return;
    if (this.seenIds.has(msg.id)) return;
    this.seenIds.add(msg.id);
    this.onSignal?.(msg);
  }

  private setupBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      this.bc = new BroadcastChannel(`sf26-room-${this.room}`);
      this.bc.onmessage = event => this.handleIncoming(event.data);
    } catch { /* Ignore */ }
  }

  private setupPeerJsSocket() {
    try {
      const token = Math.random().toString(36).slice(2, 10);
      const ws = new WebSocket(`wss://0.peerjs.com/peerjs?key=peerjs&id=${encodeURIComponent(this.myId)}&token=${token}`);
      this.peerWs = ws;
      ws.onmessage = event => {
        try {
          const data = JSON.parse(String(event.data));
          if (data && data.payload) this.handleIncoming(data.payload);
        } catch { /* Ignore malformed packet */ }
      };
      this.heartbeatTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
        }
      }, 15000);
    } catch { /* Fallback to other channels */ }
  }

  private setupNtfySocket() {
    try {
      const topic = `sf26-room-sig-${this.room.toLowerCase()}`;
      const ws = new WebSocket(`wss://ntfy.sh/${topic}/ws`);
      this.ntfyWs = ws;
      ws.onmessage = event => {
        try {
          const wrapper = JSON.parse(String(event.data));
          if (wrapper?.event === 'message' && typeof wrapper.message === 'string') {
            this.handleIncoming(JSON.parse(wrapper.message));
          }
        } catch { /* Ignore */ }
      };
    } catch { /* Optional backup */ }
  }

  send(to: string, payload: Omit<WireSignal, 'id' | 'from' | 'to'>) {
    if (this.closed) return;
    const msg: WireSignal = {
      ...payload,
      id: `${this.myId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      from: this.myId,
      to,
    } as WireSignal;

    try { this.bc?.postMessage(msg); } catch { /* Ignore */ }

    if (this.peerWs && this.peerWs.readyState === WebSocket.OPEN && to !== '*') {
      try {
        this.peerWs.send(JSON.stringify({ type: 'CANDIDATE', dst: to, payload: msg }));
      } catch { /* Ignore */ }
    }

    const topic = `sf26-room-sig-${this.room.toLowerCase()}`;
    void fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      body: JSON.stringify(msg),
    }).catch(() => {});
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.onSignal = null;
    window.clearInterval(this.heartbeatTimer);
    try { this.bc?.close(); } catch { /* Ignore */ }
    try { this.peerWs?.close(); } catch { /* Ignore */ }
    try { this.ntfyWs?.close(); } catch { /* Ignore */ }
    this.bc = null;
    this.peerWs = null;
    this.ntfyWs = null;
  }
}

// ---- Session --------------------------------------------------------------------------------

export class NetSession {
  readonly host: boolean;
  status: LinkStatus = 'idle';
  detail = '';
  rtt = 0;
  lastFastAt = 0;
  onStatus: ((status: LinkStatus, detail: string) => void) | null = null;
  onCtl: ((msg: CtlMsg) => void) | null = null;
  onFast: ((msg: FastMsg) => void) | null = null;
  onStats: (() => void) | null = null;

  private pc: RTCPeerConnection;
  private ctl: RTCDataChannel;
  private fast: RTCDataChannel;
  private signaler: RoomSignaler | null = null;
  private joinRetryTimer = 0;
  private connectTimeoutTimer = 0;
  private remotePeerId = '';
  private remoteDescSet = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private makingOffer = false;
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
    this.ctl = this.pc.createDataChannel('ctl', { negotiated: true, id: 0 });
    this.fast = this.pc.createDataChannel('fast', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    this.ctl.onmessage = event => this.receive(event.data, false);
    this.fast.onmessage = event => this.receive(event.data, true);
    this.ctl.onopen = () => this.checkOpen();
    this.fast.onopen = () => this.checkOpen();
    this.ctl.onclose = () => { if (this.wasOpen) this.finish('closed', 'Соединение закрыто.'); };
    this.pc.onconnectionstatechange = () => this.onConnectionState();

    this.pc.onicecandidate = event => {
      if (event.candidate && this.signaler && this.remotePeerId) {
        this.signaler.send(this.remotePeerId, { sig: 'ice', candidate: event.candidate.toJSON() });
      }
    };
  }

  get isOpen() { return this.status === 'open'; }

  private setStatus(status: LinkStatus, detail = '') {
    if (this.status === status && this.detail === detail) return;
    this.status = status; this.detail = detail;
    this.onStatus?.(status, detail);
  }

  // ---- Automatic Room Connection (QR & 6-char room code) ------------------------------------

  /** Host: create a room with a short 6-char code and wait for a guest via QR or code. */
  async createRoom(): Promise<string> {
    const roomCode = randomRoomCode(6);
    this.signaler?.close();
    this.signaler = new RoomSignaler(roomCode, true);
    this.setStatus('waiting');

    this.signaler.onSignal = msg => {
      void this.handleHostSignal(msg);
    };

    return roomCode;
  }

  /** Guest: join a host's room by its 6-char code (or QR link). */
  async joinRoom(rawCode: string): Promise<void> {
    const roomCode = normalizeRoomCode(rawCode);
    if (roomCode.length < 4 || roomCode.length > 12) {
      throw new SignalError('Введите 6-значный код комнаты или отсканируйте QR-код.');
    }

    this.signaler?.close();
    const signaler = new RoomSignaler(roomCode, false);
    this.signaler = signaler;
    this.remotePeerId = signaler.hostPeerId;
    this.setStatus('connecting');

    signaler.onSignal = msg => {
      void this.handleGuestSignal(msg);
    };

    const sendJoin = () => {
      if (this.wasOpen || this.closing || this.remoteDescSet) return;
      signaler.send(signaler.hostPeerId, { sig: 'join' });
    };

    // Send immediately and retry every 1.2s until the host responds with an offer
    window.setTimeout(sendJoin, 150);
    this.joinRetryTimer = window.setInterval(sendJoin, 1200);

    window.clearTimeout(this.connectTimeoutTimer);
    this.connectTimeoutTimer = window.setTimeout(() => {
      if (!this.wasOpen && !this.closing) {
        this.finish('failed', 'Не удалось найти комнату или установить соединение. Проверьте код и попробуйте снова.');
      }
    }, 22000);
  }

  private async handleHostSignal(msg: WireSignal) {
    if (this.wasOpen || this.closing || !this.signaler) return;

    if (msg.sig === 'join') {
      if (this.makingOffer) return;
      // If a new guest joins or retries before answer was applied, create/send offer
      if (!this.remotePeerId || this.remotePeerId === msg.from) {
        this.remotePeerId = msg.from;
        this.setStatus('connecting');
        try {
          this.makingOffer = true;
          if (!this.pc.localDescription) {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
          }
          if (this.pc.localDescription?.sdp) {
            this.signaler.send(this.remotePeerId, { sig: 'offer', sdp: this.pc.localDescription.sdp });
          }
        } catch { /* Ignore */ } finally {
          this.makingOffer = false;
        }
      }
      return;
    }

    if (msg.from !== this.remotePeerId) return;

    if (msg.sig === 'answer' && !this.remoteDescSet) {
      try {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
        this.remoteDescSet = true;
        this.answerApplied = true;
        await this.flushCandidates();
      } catch { /* Ignore duplicate answer */ }
    } else if (msg.sig === 'ice') {
      await this.addOrQueueCandidate(msg.candidate);
    }
  }

  private async handleGuestSignal(msg: WireSignal) {
    if (this.wasOpen || this.closing || !this.signaler) return;

    if (msg.sig === 'offer' && !this.remoteDescSet) {
      window.clearInterval(this.joinRetryTimer);
      this.remotePeerId = msg.from;
      try {
        await this.pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        this.remoteDescSet = true;
        await this.flushCandidates();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        if (this.pc.localDescription?.sdp) {
          this.signaler.send(this.remotePeerId, { sig: 'answer', sdp: this.pc.localDescription.sdp });
        }
      } catch {
        this.finish('failed', 'Ошибка при согласовании соединения с хостом.');
      }
    } else if (msg.sig === 'ice') {
      await this.addOrQueueCandidate(msg.candidate);
    }
  }

  private async addOrQueueCandidate(candidate: RTCIceCandidateInit) {
    if (!this.remoteDescSet) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch { /* Ignore invalid/late candidate */ }
  }

  private async flushCandidates() {
    while (this.pendingCandidates.length > 0) {
      const c = this.pendingCandidates.shift();
      if (c) {
        try { await this.pc.addIceCandidate(c); } catch { /* Ignore */ }
      }
    }
  }

  // ---- Manual SDP Methods (Offline Fallback) ------------------------------------------------

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

  async createOffer(): Promise<string> {
    this.setStatus('gathering');
    await this.pc.setLocalDescription(await this.pc.createOffer());
    const code = await this.localCode('offer');
    if (this.status === 'gathering') this.setStatus('waiting');
    return code;
  }

  async acceptOffer(code: string): Promise<string> {
    const sdp = await decodeSignal(code, 'offer');
    this.setStatus('gathering');
    try {
      await this.pc.setRemoteDescription({ type: 'offer', sdp });
      this.remoteDescSet = true;
      await this.pc.setLocalDescription(await this.pc.createAnswer());
    } catch {
      this.setStatus('idle');
      throw new SignalError('Код хоста не подходит. Попросите друга создать игру заново.');
    }
    const answer = await this.localCode('answer');
    if (this.status === 'gathering') this.setStatus('waiting');
    return answer;
  }

  async acceptAnswer(code: string): Promise<void> {
    const sdp = await decodeSignal(code, 'answer');
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp });
      this.remoteDescSet = true;
    } catch {
      throw new SignalError('Код ответа не подходит к этой игре. Создайте игру заново.');
    }
    this.answerApplied = true;
    this.setStatus(this.wasOpen ? 'open' : 'connecting');
  }

  // ---- Lifecycle & Data Channels ------------------------------------------------------------

  private onConnectionState() {
    if (this.closing) return;
    const state = this.pc.connectionState;
    window.clearTimeout(this.disconnectTimer);
    if (state === 'connecting' && !this.wasOpen) {
      if (!this.host || this.answerApplied || this.signaler) this.setStatus('connecting');
    } else if (state === 'failed') {
      this.finish('failed', this.wasOpen ? 'Соединение потеряно.' : 'Не удалось соединиться. Проверьте подключение к сети и попробуйте ещё раз.');
    } else if (state === 'closed') {
      this.finish('closed', 'Соединение закрыто.');
    } else if (state === 'disconnected') {
      this.disconnectTimer = window.setTimeout(() => this.finish('failed', 'Соединение потеряно.'), 5000);
    }
  }

  private checkOpen() {
    if (this.ctl.readyState !== 'open' || this.fast.readyState !== 'open' || this.wasOpen) return;
    this.wasOpen = true;
    window.clearInterval(this.joinRetryTimer);
    window.clearTimeout(this.connectTimeoutTimer);
    this.signaler?.close();
    this.signaler = null;
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
    window.clearInterval(this.joinRetryTimer);
    window.clearTimeout(this.connectTimeoutTimer);
    window.clearTimeout(this.disconnectTimer);
    this.signaler?.close();
    this.signaler = null;
    try { this.ctl.close(); this.fast.close(); this.pc.close(); } catch { /* Already closed. */ }
  }

  close() {
    if (this.closing) return;
    this.sendCtl({ t: 'bye' });
    this.closing = true;
    window.clearInterval(this.pingTimer);
    window.clearInterval(this.joinRetryTimer);
    window.clearTimeout(this.connectTimeoutTimer);
    window.clearTimeout(this.disconnectTimer);
    this.signaler?.close();
    this.signaler = null;
    this.onStatus = null; this.onCtl = null; this.onFast = null; this.onStats = null;
    window.setTimeout(() => { try { this.ctl.close(); this.fast.close(); this.pc.close(); } catch { /* Already closed. */ } }, 200);
  }
}
