import type { Settings } from './types';

export type Sound = 'light' | 'heavy' | 'swing' | 'block' | 'special' | 'count' | 'fight' | 'ko' | 'win' | 'lose' | 'click';

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private settings: Settings;
  private voiceVariant = 0;

  constructor(settings: Settings) { this.settings = settings; }

  unlock() {
    try {
      if (!this.context) {
        const AudioClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioClass) return;
        this.context = new AudioClass();
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
        this.applyVolume();
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* A browser without audio still gets a fully playable game. */ }
  }

  update(settings: Settings) { this.settings = settings; this.applyVolume(); }

  private applyVolume() {
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.volume * 0.38, this.context.currentTime, 0.025);
  }

  private tone(freq: number, end: number, duration: number, gain: number, type: OscillatorType = 'square', delay = 0) {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(15, end), now + duration);
    envelope.gain.setValueAtTime(0.001, now);
    envelope.gain.linearRampToValueAtTime(gain, now + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  }

  private noise(duration: number, gain: number, cutoff: number) {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const buffer = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * duration), this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    source.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, now);
    filter.frequency.exponentialRampToValueAtTime(100, now + duration);
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter); filter.connect(envelope); envelope.connect(this.master);
    source.start(now);
    source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
  }

  // Three short vowel-formant sounds are synthesized locally, never loaded or spoken by a service.
  voice() {
    if (!this.context || !this.master || this.settings.muted) return;
    const vowels = [[760, 1170], [430, 820], [350, 970]];
    this.voiceVariant = (this.voiceVariant + 1 + Math.floor(Math.random() * 2)) % vowels.length;
    const now = this.context.currentTime;
    const source = this.context.createOscillator();
    source.type = 'sawtooth';
    source.frequency.setValueAtTime(115 + Math.random() * 45, now);
    source.frequency.exponentialRampToValueAtTime(75, now + 0.14);
    const nodes: AudioNode[] = [];
    vowels[this.voiceVariant].forEach((frequency, i) => {
      const filter = this.context!.createBiquadFilter();
      const envelope = this.context!.createGain();
      filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = 5;
      envelope.gain.setValueAtTime(0.001, now);
      envelope.gain.linearRampToValueAtTime(i ? 0.11 : 0.24, now + 0.018);
      envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      source.connect(filter); filter.connect(envelope); envelope.connect(this.master!);
      nodes.push(filter, envelope);
    });
    source.start(now); source.stop(now + 0.18);
    source.onended = () => { source.disconnect(); nodes.forEach(node => node.disconnect()); };
  }

  play(sound: Sound) {
    if (!this.context || this.settings.muted || this.settings.volume === 0) return;
    const variation = 0.88 + Math.random() * 0.24;
    switch (sound) {
      case 'light': this.noise(0.07, 0.48, 2400 * variation); this.tone(160 * variation, 48, 0.07, 0.35, 'triangle'); break;
      case 'heavy': this.noise(0.14, 0.7, 1500 * variation); this.tone(105 * variation, 26, 0.15, 0.66, 'sine'); break;
      case 'swing': this.noise(0.08, 0.1, 3700 * variation); break;
      case 'block': this.noise(0.055, 0.23, 4900); this.tone(730 * variation, 390, 0.1, 0.23, 'triangle'); break;
      case 'special': this.tone(110, 670, 0.22, 0.18, 'sawtooth'); this.noise(0.18, 0.16, 2700); break;
      case 'count': this.tone(440, 440, 0.1, 0.17); break;
      case 'fight': [440, 660, 880].forEach((f, i) => this.tone(f, f, 0.13, 0.19, 'square', i * 0.06)); break;
      case 'ko': this.tone(165, 38, 0.42, 0.42, 'triangle'); this.noise(0.24, 0.2, 900); break;
      case 'win': [392, 494, 587, 784].forEach((f, i) => this.tone(f, f, 0.2, 0.17, 'square', i * 0.12)); break;
      case 'lose': [392, 330, 262, 196].forEach((f, i) => this.tone(f, f, 0.2, 0.15, 'triangle', i * 0.13)); break;
      case 'click': this.tone(590, 780, 0.035, 0.1, 'square'); break;
    }
  }

  destroy() {
    if (this.context) void this.context.close().catch(() => {});
    this.context = null; this.master = null;
  }
}