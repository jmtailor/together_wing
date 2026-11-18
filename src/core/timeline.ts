/**
 * 반복을 펼친 실제 연주 타임라인. 재생 엔진과 악보 커서가 같은 표를 쓴다.
 */
import type { Lyric, Score } from './types';
import { unrollRepeats, type PlayedMeasure, playedMeasures } from './unroll';

export interface PlayedNote {
  /** 연주 시작 시각(초) */
  time: number;
  /** 길이(초), 붙임줄은 하나로 합친다 */
  duration: number;
  /** 연주 기준 tick (반복 전개 후) */
  playTick: number;
  durationTicks: number;
  pitch: number;
  staff: number;
  voice: number;
  /** 원본 악보의 마디 번호(0부터)와 마디 안 위치 — 커서 표시용 */
  measure: number;
  scoreTick: number;
  /** 몇 번째 반복에서 나오는 음인지 (1부터) */
  pass: number;
  /** 이번 반복에 맞는 가사 (절 번호 = 반복 횟수, 없으면 1절) */
  lyric?: Lyric;
}

export interface PlayedMeasureTime extends PlayedMeasure {
  /** 펼친 순서상 위치 */
  order: number;
  playTick: number;
  time: number;
  duration: number;
}

export interface Timeline {
  measures: PlayedMeasureTime[];
  notes: PlayedNote[];
  totalTime: number;
}

export function buildTimeline(score: Score, tempoScale = 1): Timeline {
  const order = playedMeasures(unrollRepeats(score.measures, score.voltas));
  const tempos = score.tempos;
  const tempoAt = (scoreTick: number) => {
    let bpm = tempos[0]?.bpm ?? 120;
    for (const t of tempos) if (t.tick <= scoreTick) bpm = t.bpm;
    return bpm * tempoScale;
  };
  const secPerTick = (bpm: number) => 60 / bpm / score.division;

  // 마디마다 연주 시작 시각 계산 (마디 안 템포 변화도 반영)
  const measureTimes: PlayedMeasureTime[] = [];
  let playTick = 0;
  let time = 0;
  /** 마디 안의 tick → 초 변환 함수 */
  const offsetToSeconds: ((offset: number) => number)[] = [];
  order.forEach((pm, i) => {
    const m = score.measures[pm.measure];
    const changes = tempos.filter((t) => t.tick > m.tick && t.tick < m.tick + m.length).map((t) => t.tick - m.tick);
    const points = [0, ...changes, m.length];
    const toSec = (offset: number) => {
      let sec = 0;
      for (let k = 0; k < points.length - 1; k++) {
        const a = points[k];
        const b = Math.min(points[k + 1], offset);
        if (b <= a) break;
        sec += (b - a) * secPerTick(tempoAt(m.tick + a));
      }
      return sec;
    };
    const duration = toSec(m.length);
    measureTimes.push({ ...pm, order: i, playTick, time, duration });
    offsetToSeconds.push(toSec);
    playTick += m.length;
    time += duration;
  });

  // 원본 마디별 음표 목록
  const notesByMeasure = new Map<number, typeof score.notes>();
  for (const n of score.notes) {
    const list = notesByMeasure.get(n.measure) ?? [];
    list.push(n);
    notesByMeasure.set(n.measure, list);
  }

  const notes: PlayedNote[] = [];
  // 붙임줄 연결: (보표, 성부, 음높이) → 이어질 음
  const openTies = new Map<string, PlayedNote>();
  measureTimes.forEach((pmt, i) => {
    const m = score.measures[pmt.measure];
    const toSec = offsetToSeconds[i];
    for (const n of notesByMeasure.get(pmt.measure) ?? []) {
      const offset = n.tick - m.tick;
      const start = pmt.time + toSec(offset);
      const end = pmt.time + toSec(Math.min(offset + n.duration, m.length));
      const key = `${n.staff}:${n.voice}:${n.pitch}`;
      const open = openTies.get(key);
      if (n.tieFromPrev && open && Math.abs(open.time + open.duration - start) < 1e-6) {
        open.duration = end - open.time;
        open.durationTicks += n.duration;
        if (!n.tieToNext) openTies.delete(key);
        continue;
      }
      const lyric = n.lyrics.find((l) => l.verse === pmt.playbackCount - 1) ?? n.lyrics.find((l) => l.verse === 0);
      const pn: PlayedNote = {
        time: start,
        duration: end - start,
        playTick: pmt.playTick + offset,
        durationTicks: n.duration,
        pitch: n.pitch,
        staff: n.staff,
        voice: n.voice,
        measure: n.measure,
        scoreTick: n.tick,
        pass: pmt.playbackCount,
        lyric,
      };
      notes.push(pn);
      if (n.tieToNext) openTies.set(key, pn);
      else openTies.delete(key);
    }
  });
  notes.sort((a, b) => a.time - b.time || a.staff - b.staff || a.pitch - b.pitch);
  return { measures: measureTimes, notes, totalTime: time };
}
