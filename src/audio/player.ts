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

/** 짧은 사인파 딸깍 소리 (잡음 없이 부드럽게 시작해 빨리 사라짐) */
function makeClick(ctx: BaseAudioContext, freq: number, gain: number): AudioBuffer {
  const len = Math.round(ctx.sampleRate * 0.05);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const attack = ctx.sampleRate * 0.0015;
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    const env = Math.min(1, i / attack) * Math.exp(-t * 90);
    d[i] = gain * env * Math.sin(2 * Math.PI * freq * t);
  }
  return buf;
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
  private sources = new Set<AudioBufferSourceNode>();
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
  /** 메트로놈: 켜기/끄기, 음량(0..1) */
  metronome = { on: true, volume: 0.6 };
  /** 재생을 시작할 때 4박 카운트 */
  countIn = true;
  private metroGain: GainNode | null = null;
  private countGain: GainNode | null = null;
  /** 메트로놈 딸깍 소리 (첫 박 / 나머지 박), 미리 만들어 둔 짧은 소리 */
  private clickBufs: [AudioBuffer, AudioBuffer] | null = null;
  /** 박마다 메트로놈 시각 (원래 템포 기준 초) */
  private beats: { time: number; accent: boolean }[] = [];
  /** 조금씩 앞당겨 예약하는 스케줄러 상태 */
  private sched: { to: number; ctxStart: number; from: number; ni: number; bi: number } | null = null;
  private pumpTimer: number | undefined;

  private score: Score;
  private warmedUp = false;

  constructor(original: Score) {
    // 코드 기호가 있으면 '코드 반주' 파트를 가상 보표로 덧붙인다
    const accStaff = original.staffClefs.length;
    const acc = accompanimentNotes(original, accStaff);
    this.score = acc.length ? { ...original, notes: [...original.notes, ...acc] } : original;
    this.timeline = buildTimeline(this.score);
    this.channels = original.parts.map((p) => ({ name: p.name, staves: p.staves, volume: 0.8, muted: false, solo: false }));
    if (acc.length) this.channels.push({ name: '반주', staves: [accStaff], volume: 0.45, muted: false, solo: false });
    this.channels.forEach((c, i) => c.staves.forEach((st) => this.staffToChannel.set(st, i)));
    for (const pm of this.timeline.measures) {
      const n = Math.max(1, this.score.measures[pm.measure].timeSig.n);
      for (let k = 0; k < n; k++) this.beats.push({ time: pm.time + (k * pm.duration) / n, accent: k === 0 });
    }
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
      this.metroGain = this.ctx.createGain();
      this.metroGain.connect(this.master);
      this.countGain = this.ctx.createGain();
      this.countGain.connect(this.master);
      this.clickBufs = [makeClick(this.ctx, 1600, 0.9), makeClick(this.ctx, 1050, 0.6)];
      this.applyMix();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
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
    // 카운트 중에는 시작 위치에 머문다
    return this.startPos + Math.max(0, this.ctx.currentTime - this.startCtxTime) * this.rate;
  }

  /** 카운트 중이면 남은 박 수 (4,3,2,1), 아니면 0 */
  countdown(): number {
    if (!this.playing || !this.ctx || this.ctx.currentTime >= this.startCtxTime) return 0;
    const beat = this.beatSeconds(this.startPos) / this.rate;
    return Math.min(4, Math.ceil((this.startCtxTime - this.ctx.currentTime) / beat));
  }

  /** 위치 t(초)가 들어 있는 마디의 한 박 길이(초, 원래 템포 기준) */
  private beatSeconds(t: number): number {
    const ms = this.timeline.measures;
    let pm = ms[0];
    for (const x of ms) if (x.time <= t + 1e-6) pm = x;
    if (!pm) return 0.5;
    const sig = this.score.measures[pm.measure].timeSig;
    return pm.duration / Math.max(1, sig.n);
  }

  play(withCountIn = this.countIn) {
    if (!this.ctx || this.playing) return;
    if (this.pos >= this.duration - 0.01) this.pos = 0;
    if (this.loop && (this.pos < this.loop.start || this.pos >= this.loop.end)) this.pos = this.loop.start;
    this.playing = true;
    this.startPos = this.pos;
    // 처음 켤 때는 오디오 장치가 깨어날 시간을 조금 더 준다
    let lead = this.warmedUp ? 0.08 : 0.3;
    this.warmedUp = true;
    if (withCountIn) {
      const beat = this.beatSeconds(this.pos) / this.rate;
      for (let k = 0; k < 4; k++) this.click(this.ctx.currentTime + lead + k * beat, k === 0, this.countGain!);
      lead += 4 * beat;
    }
    this.startCtxTime = this.ctx.currentTime + lead;
    this.schedule(this.pos, this.loop ? this.loop.end : this.duration, this.startCtxTime);
    this.emit();
  }

  /** 메트로놈 딸깍 소리 (첫 박은 높게) */
  private click(when: number, accent: boolean, out: GainNode) {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.clickBufs![accent ? 0 : 1];
    src.connect(out);
    src.start(when);
    this.track(src);
  }

  private track(src: AudioBufferSourceNode) {
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /**
   * 재생 예약. 곡 전체를 한 번에 예약하면 시작할 때 버벅이므로
   * 앞으로 몇 초 분량만 예약하고, 타이머로 조금씩 이어서 예약한다.
   */
  private schedule(from: number, to: number, ctxStart: number) {
    const lower = (arr: { time: number }[], t: number) => {
      let lo = 0;
      let hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid].time < t - 1e-6) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    this.sched = { from, to, ctxStart, ni: lower(this.timeline.notes, from), bi: lower(this.beats, from) };
    this.pump();
    window.clearInterval(this.pumpTimer);
    this.pumpTimer = window.setInterval(() => this.pump(), 250);
    const endIn = (to - from) / this.rate + (ctxStart - this.ctx!.currentTime);
    window.clearTimeout(this.endTimer);
    this.endTimer = window.setTimeout(() => this.reachedEnd(), Math.max(0, endIn * 1000));
  }

  private pump() {
    const sc = this.sched;
    if (!sc || !this.ctx) return;
    const ctx = this.ctx;
    // 지금부터 3초 뒤까지 (원래 템포 기준 위치로 바꿔서)
    const until = Math.min(sc.to, sc.from + (ctx.currentTime + 3 - sc.ctxStart) * this.rate);
    const notes = this.timeline.notes;
    for (; sc.ni < notes.length && notes[sc.ni].time < until - 1e-6; sc.ni++) {
      const n = notes[sc.ni];
      if (n.time >= sc.to - 1e-6) break;
      const ch = this.staffToChannel.get(n.staff) ?? 0;
      const sp = nearestSample(n.pitch);
      const buf = this.buffers.get(sp);
      if (!buf) continue;
      const when = Math.max(ctx.currentTime, sc.ctxStart + (n.time - sc.from) / this.rate);
      const dur = Math.max(0.05, Math.min(n.duration, sc.to - n.time) / this.rate);
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
      this.track(src);
    }
    for (; sc.bi < this.beats.length && this.beats[sc.bi].time < until - 1e-6; sc.bi++) {
      const bt = this.beats[sc.bi];
      if (bt.time >= sc.to - 1e-6) break;
      const when = sc.ctxStart + (bt.time - sc.from) / this.rate;
      if (when < ctx.currentTime) continue;
      this.click(when, bt.accent, this.metroGain!);
    }
  }

  private reachedEnd() {
    if (!this.playing) return;
    if (this.loop) {
      // 구간 반복: 처음으로 돌아가 다시 예약
      this.stopSources();
      this.pos = this.loop.start;
      this.playing = false;
      this.play(false);
      return;
    }
    this.stopSources();
    this.playing = false;
    this.pos = this.duration;
    this.emit();
  }

  private stopSources() {
    window.clearTimeout(this.endTimer);
    window.clearInterval(this.pumpTimer);
    this.sched = null;
    for (const src of this.sources) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* 이미 멈춤 */
      }
    }
    this.sources.clear();
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
    if (wasPlaying) this.play(false);
    this.emit();
  }

  setRate(rate: number) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.rate = rate;
    if (wasPlaying) this.play(false);
    this.emit();
  }

  setLoop(loop: { start: number; end: number } | null) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.loop = loop;
    if (loop) this.pos = loop.start;
    if (wasPlaying) this.play(false);
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
    if (this.ctx && this.metroGain && this.countGain) {
      const mv = this.metronome.on ? this.metronome.volume : 0;
      this.metroGain.gain.setTargetAtTime(mv, this.ctx.currentTime, 0.02);
      // 카운트는 메트로놈을 꺼도 들리게 (음량만 따름, 0이면 기본값)
      this.countGain.gain.setTargetAtTime(this.metronome.volume || 0.6, this.ctx.currentTime, 0.02);
    }
    this.emit();
  }
}
