/**
 * 파트별 재생 엔진 (Web Audio).
 * - 피아노 소리: Salamander Grand Piano 샘플(앱에 포함)을 음높이에 맞춰 늘이고 줄여 재생
 * - 파트마다 GainNode 하나: 음량·뮤트·솔로
 * - 반복을 펼친 타임라인(timeline.ts)을 그대로 재생하므로 MuseScore 재생 순서와 같다
 */
import type { Score } from '../core/types';
import { accompanimentNotes } from '../core/chords';
import { buildTimeline, type Timeline } from '../core/timeline';

/** 샘플이 있는 음: 옥타브마다 C, D#, F#, A */
const SAMPLE_NAMES = ['C', 'Ds', 'Fs', 'A'];
const SAMPLE_OFFSETS = [0, 3, 6, 9];
const SAMPLE_MIN = 24; // C1
const SAMPLE_MAX = 108; // C8

function sampleUrl(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const name = SAMPLE_NAMES[SAMPLE_OFFSETS.indexOf(midi % 12)];
  return `${import.meta.env.BASE_URL}audio/piano/${name}${octave}.mp3`;
}

function nearestSample(pitch: number): number {
  const base = Math.floor(pitch / 3) * 3; // C, D#, F#, A 는 3반음 간격
  const cand = pitch - base <= 1 ? base : base + 3;
  return Math.min(SAMPLE_MAX, Math.max(SAMPLE_MIN, cand));
}

export interface ChannelState {
  name: string;
  staves: number[];
  volume: number; // 0..1
  muted: boolean;
  solo: boolean;
}

type Listener = () => void;

export class Player {
  readonly timeline: Timeline;
  readonly channels: ChannelState[];
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private gains: GainNode[] = [];
  private buffers = new Map<number, AudioBuffer>();
  private sources: AudioBufferSourceNode[] = [];
  private staffToChannel = new Map<number, number>();
  private startCtxTime = 0;
  private startPos = 0;
  private pos = 0;
  private endTimer: number | undefined;
  /** 재생 속도 배율 (1 = 악보 템포) */
  rate = 1;
  playing = false;
  /** 구간 반복 [시작, 끝) 초. 없으면 끝까지 */
  loop: { start: number; end: number } | null = null;
  private listeners = new Set<Listener>();

  private score: Score;

  constructor(original: Score) {
    // 코드 기호가 있으면 '코드 반주' 파트를 가상 보표로 덧붙인다
    const accStaff = original.staffClefs.length;
    const acc = accompanimentNotes(original, accStaff);
    this.score = acc.length ? { ...original, notes: [...original.notes, ...acc] } : original;
    this.timeline = buildTimeline(this.score);
    this.channels = original.parts.map((p) => ({ name: p.name, staves: p.staves, volume: 0.8, muted: false, solo: false }));
    if (acc.length) this.channels.push({ name: '반주', staves: [accStaff], volume: 0.45, muted: false, solo: false });
    this.channels.forEach((c, i) => c.staves.forEach((st) => this.staffToChannel.set(st, i)));
  }

  get duration() {
    return this.timeline.totalTime;
  }

  onChange(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  /** 첫 재생 버튼을 누를 때(사용자 동작 안에서) 불러야 iOS에서도 소리가 난다 */
  async ensureAudio(onProgress?: (done: number, total: number) => void) {
    if (!this.ctx) {
      // 아이폰: 무음(진동) 모드에서도 소리가 나도록 '재생' 용도로 표시 (Safari 17+)
      const nav = navigator as unknown as { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      // 여러 파트가 겹쳐도 찢어지지 않게 살짝 눌러준다
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      this.master.connect(comp).connect(this.ctx.destination);
      this.gains = this.channels.map(() => {
        const g = this.ctx!.createGain();
        g.connect(this.master!);
        return g;
      });
      this.applyMix();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const needed = [...new Set(this.score.notes.map((n) => nearestSample(n.pitch)))].filter((p) => !this.buffers.has(p));
    let done = 0;
    await Promise.all(
      needed.map(async (p) => {
        const res = await fetch(sampleUrl(p));
        if (!res.ok) throw new Error(`피아노 음원을 불러오지 못했습니다 (${res.status})`);
        const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(p, buf);
        onProgress?.(++done, needed.length);
      }),
    );
  }

  /** 지금 위치(초, 악보 템포 기준) */
  position(): number {
    if (!this.playing || !this.ctx) return this.pos;
    return this.startPos + (this.ctx.currentTime - this.startCtxTime) * this.rate;
  }

  play() {
    if (!this.ctx || this.playing) return;
    if (this.pos >= this.duration - 0.01) this.pos = 0;
    if (this.loop && (this.pos < this.loop.start || this.pos >= this.loop.end)) this.pos = this.loop.start;
    this.playing = true;
    this.startPos = this.pos;
    this.startCtxTime = this.ctx.currentTime + 0.06;
    this.schedule(this.pos, this.loop ? this.loop.end : this.duration, this.startCtxTime);
    this.emit();
  }

  private schedule(from: number, to: number, ctxStart: number) {
    const ctx = this.ctx!;
    for (const n of this.timeline.notes) {
      if (n.time < from - 1e-6 || n.time >= to - 1e-6) continue;
      const ch = this.staffToChannel.get(n.staff) ?? 0;
      const sp = nearestSample(n.pitch);
      const buf = this.buffers.get(sp);
      if (!buf) continue;
      const when = ctxStart + (n.time - from) / this.rate;
      const dur = Math.max(0.05, Math.min(n.duration, to - n.time) / this.rate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 2 ** ((n.pitch - sp) / 12);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, when);
      env.gain.linearRampToValueAtTime(0.9, when + 0.004);
      env.gain.setValueAtTime(0.9, when + dur);
      env.gain.exponentialRampToValueAtTime(0.001, when + dur + 0.25);
      src.connect(env).connect(this.gains[ch]);
      src.start(when);
      src.stop(when + dur + 0.3);
      this.sources.push(src);
    }
    const endIn = (to - from) / this.rate + (ctxStart - ctx.currentTime);
    window.clearTimeout(this.endTimer);
    this.endTimer = window.setTimeout(() => this.reachedEnd(), Math.max(0, endIn * 1000));
  }

  private reachedEnd() {
    if (!this.playing) return;
    if (this.loop) {
      // 구간 반복: 처음으로 돌아가 다시 예약
      this.stopSources();
      this.pos = this.loop.start;
      this.playing = false;
      this.play();
      return;
    }
    this.stopSources();
    this.playing = false;
    this.pos = this.duration;
    this.emit();
  }

  private stopSources() {
    window.clearTimeout(this.endTimer);
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* 이미 멈춤 */
      }
    }
    this.sources = [];
  }

  pause() {
    if (!this.playing) return;
    this.pos = this.position();
    this.playing = false;
    this.stopSources();
    this.emit();
  }

  stop() {
    this.pause();
    this.pos = this.loop ? this.loop.start : 0;
    this.emit();
  }

  seek(seconds: number) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.pos = Math.max(0, Math.min(this.duration, seconds));
    if (wasPlaying) this.play();
    this.emit();
  }

  setRate(rate: number) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.rate = rate;
    if (wasPlaying) this.play();
    this.emit();
  }

  setLoop(loop: { start: number; end: number } | null) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.loop = loop;
    if (loop) this.pos = loop.start;
    if (wasPlaying) this.play();
    this.emit();
  }

  /** 파트 음량·뮤트·솔로를 실제 소리에 반영 */
  applyMix() {
    const anySolo = this.channels.some((c) => c.solo);
    this.channels.forEach((c, i) => {
      const audible = anySolo ? c.solo : !c.muted;
      const v = audible ? c.volume : 0;
      const g = this.gains[i];
      if (g && this.ctx) g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    });
    this.emit();
  }
}
