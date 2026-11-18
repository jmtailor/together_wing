/**
 * 반복 기호(도돌이표, 1·2번 괄호, D.C./D.S./Coda/Fine)를 실제 연주 순서로 펼친다.
 *
 * MuseScore 4의 재생 규칙(src/engraving/dom/repeatlist.cpp, RepeatList::unwind)과
 * 같은 결과를 내도록 동작을 맞췄다. MuseScore 저장소의 반복 테스트 69개
 * (tests/musescoreRepeats.test.ts)로 결과를 대조한다.
 *
 * 핵심 규칙
 * - 끝 도돌이표에 시작 도돌이표가 없으면 악보(섹션) 처음으로 돌아간다.
 * - 점프(D.C./D.S.)는 그 마디의 마지막 반복 때만, 한 번씩만 실행된다.
 * - 점프 뒤에는 기본적으로 반복을 다시 하지 않고(마지막 괄호로) 진행한다.
 *   점프에 "반복 연주(playRepeats)"가 켜져 있으면 반복을 다시 한다.
 */
import type { Jump, Marker, MeasureInfo, Score, Volta } from './types';

type ElType = 'SECTION_BREAK' | 'VOLTA_START' | 'VOLTA_END' | 'REPEAT_START' | 'REPEAT_END' | 'JUMP' | 'MARKER';

interface El {
  type: ElType;
  measure: number;
  volta?: Volta;
  jump?: Jump;
  marker?: Marker;
  repeatCount: number;
}

export interface RepeatSegment {
  /** 이 구간에서 연주되는 마디 번호들(0부터) */
  measures: number[];
  /** 몇 번째 반복인지 (1부터). 가사 절 선택에 쓴다 */
  playbackCount: number;
}

export interface PlayedMeasure {
  measure: number;
  playbackCount: number;
}

const firstEnding = (v: Volta) => v.endings[0] ?? 0;
const lastEnding = (v: Volta) => v.endings[v.endings.length - 1] ?? 0;
const hasEnding = (v: Volta, n: number) => v.endings.includes(n);

function makeEl(type: ElType, measure: number, extra: Partial<El> = {}): El {
  return { type, measure, repeatCount: type === 'REPEAT_START' ? 1 : 0, ...extra };
}

/** 겹치는 볼타를 겹치지 않는 조각으로 나눈다 (겹친 부분은 번호의 교집합) */
function splitOverlappingVoltas(voltasIn: Volta[]): Volta[] {
  const sorted = [...voltasIn].sort((a, b) => a.startMeasure - b.startMeasure);
  const done: Volta[] = [];
  for (const orig of sorted) {
    let volta: Volta | null = { ...orig, endings: [...orig.endings] };
    if (done.length === 0) {
      done.push(volta);
      continue;
    }
    const toMerge: Volta[] = [];
    while (done.length > 0 && volta.startMeasure <= done[done.length - 1].endMeasure) toMerge.push(done.pop()!);
    while (toMerge.length > 0 && volta) {
      const back = toMerge[toMerge.length - 1];
      let remainder: Volta = { ...back, endings: [...back.endings] };
      if (volta.startMeasure !== remainder.startMeasure) {
        back.endMeasure = volta.startMeasure - 1;
        remainder.startMeasure = volta.startMeasure;
        done.push(back);
      }
      toMerge.pop();
      if (volta.endMeasure < remainder.endMeasure) [volta, remainder] = [remainder, volta];
      const v: Volta = volta;
      remainder.endings = remainder.endings.filter((n) => v.endings.includes(n));
      done.push(remainder);
      if (volta.endMeasure !== remainder.endMeasure) {
        volta.startMeasure = remainder.endMeasure + 1;
      } else {
        while (toMerge.length > 0) done.push(toMerge.shift()!);
        volta = null;
      }
    }
    if (volta) done.push(volta);
  }
  return done;
}

function collect(measures: MeasureInfo[], voltasIn: Volta[]): El[][] {
  const sections: El[][] = [];
  if (measures.length === 0) return sections;
  const voltas = splitOverlappingVoltas(voltasIn);
  let section: El[] = [];
  let startFrom = makeEl('REPEAT_START', 0);
  section.push(startFrom);
  let active: Volta | null = null;
  let vi = 0;

  for (const m of measures) {
    const i = m.index;
    if (vi < voltas.length && voltas[vi].startMeasure === i) {
      if (active) section.push(makeEl('VOLTA_END', i - 1, { volta: active }));
      active = voltas[vi];
      section.push(makeEl('VOLTA_START', i, { volta: active }));
      vi++;
      // 같은 마디에서 시작하는 볼타가 더 있으면(여러 보표 중복) 건너뛴다
      while (vi < voltas.length && voltas[vi].startMeasure === i) vi++;
    }
    if (m.startRepeat) {
      if (active && active.startMeasure !== i) {
        section.push(makeEl('VOLTA_END', i - 1, { volta: active }));
        active = null;
      }
      startFrom = makeEl('REPEAT_START', i);
      section.push(startFrom);
    }
    for (const j of m.jumps) {
      section.push(makeEl('JUMP', i, { jump: j }));
      if (active && (active.endMeasure < i || (active.endMeasure === i && !active.closed)) && !m.endRepeat) {
        section.push(makeEl('VOLTA_END', i, { volta: active }));
        active = null;
      }
    }
    for (const mk of m.markers) {
      const el = makeEl('MARKER', i, { marker: mk });
      // 같은 마디 안에서는 마커가 점프보다 먼저, 왼쪽 마커가 오른쪽 마커보다 먼저 평가된다
      let at = section.length - 1;
      while (section[at].measure === i) {
        const cur = section[at];
        const goBefore = (cur.type === 'MARKER' && !mk.isRight && !!cur.marker?.isRight) || cur.type === 'JUMP';
        if (goBefore && at > 0) at--;
        else break;
      }
      section.splice(at + 1, 0, el);
    }
    if (m.endRepeat) {
      section.push(makeEl('REPEAT_END', i));
      startFrom.repeatCount += m.endRepeat - 1;
      if (active) {
        section.push(makeEl('VOLTA_END', i, { volta: active }));
        active = null;
      }
    }
    if (active && active.endMeasure === i && active.closed) {
      section.push(makeEl('VOLTA_END', i, { volta: active }));
      active = null;
    }
    const isLast = i === measures.length - 1;
    if (m.sectionBreak || isLast) {
      if (active) {
        section.push(makeEl('VOLTA_END', i, { volta: active }));
        active = null;
      }
      section.push(makeEl('SECTION_BREAK', i));
      sections.push(section);
      if (!isLast) {
        section = [];
        startFrom = makeEl('REPEAT_START', i + 1);
        section.push(startFrom);
      }
    }
  }
  return sections;
}

class Segment implements RepeatSegment {
  measures: number[] = [];
  constructor(public playbackCount: number) {}
  addMeasure(m: number) {
    if (this.measures.length === 0 || this.measures[this.measures.length - 1] !== m) this.measures.push(m);
  }
  /** 마지막 마디부터 m 까지 채우거나(앞으로), m 이전으로 자른다 */
  addMeasures(m: number) {
    if (this.measures.length > 0) {
      let next = this.measures[this.measures.length - 1] + 1;
      if (next < m) while (next !== m) this.measures.push(next++);
      while (this.measures.length > 0 && this.measures[this.measures.length - 1] >= m) this.measures.pop();
    }
    this.addMeasure(m);
  }
  popMeasure() {
    this.measures.pop();
  }
  get isEmpty() {
    return this.measures.length === 0;
  }
}

interface Pos {
  s: number;
  e: number;
}

export function unrollRepeats(measures: MeasureInfo[], voltas: Volta[]): RepeatSegment[] {
  const sections = collect(measures, voltas);
  const out: Segment[] = [];
  if (sections.length === 0) return out;

  const NOT_FOUND: Pos = { s: -1, e: -1 };
  const findMarker = (label: string, s: number, e: number): Pos => {
    if (label === 'start') return { s, e: 0 };
    if (label === 'end') return { s, e: sections[s].length - 1 };
    const isIt = (el: El) => el.type === 'MARKER' && el.marker?.label === label;
    for (let k = e - 1; k >= 0; k--) if (isIt(sections[s][k])) return { s, e: k };
    for (let k = e + 1; k < sections[s].length; k++) if (isIt(sections[s][k])) return { s, e: k };
    for (let ps = s - 1; ps >= 0; ps--) {
      for (let k = sections[ps].length - 1; k >= 0; k--) if (isIt(sections[ps][k])) return { s: ps, e: k };
    }
    for (let ns = s + 1; ns < sections.length; ns++) {
      for (let k = 0; k < sections[ns].length; k++) if (isIt(sections[ns][k])) return { s: ns, e: k };
    }
    return NOT_FOUND;
  };

  const performJump = (target: Pos, withRepeats: boolean) => {
    let activeVolta: Volta | null = null;
    let startRef = sections[target.s][0];
    for (let k = 0; k < target.e; k++) {
      const el = sections[target.s][k];
      if (el.type === 'VOLTA_START') activeVolta = el.volta!;
      else if (el.type === 'VOLTA_END') activeVolta = null;
      else if (el.type === 'REPEAT_START') startRef = el;
    }
    let playbackCount: number;
    if (withRepeats) {
      playbackCount = activeVolta ? firstEnding(activeVolta) || 1 : 1;
    } else {
      playbackCount = activeVolta ? lastEnding(activeVolta) || startRef.repeatCount : startRef.repeatCount;
    }
    return { playbackCount, activeVolta, startRef };
  };

  const jumpsTaken = new Set<string>();
  const jumpKey = (j: Jump, n: number) => `${jumpIds.get(j)}@${n}`;
  const jumpIds = new Map<Jump, number>();
  sections.flat().forEach((el, k) => el.jump && jumpIds.set(el.jump, k));

  let playUntil: Pos = NOT_FOUND;
  let continueAt: Pos = NOT_FOUND;
  let activeJump: Jump | null = null;
  let guard = 0;

  for (let s = 0; s < sections.length; s++) {
    let playbackCount = 1;
    let e = 0;
    let startRef = sections[s][0];
    let activeVolta: Volta | null = null;
    playUntil = NOT_FOUND;
    continueAt = NOT_FOUND;
    let forceFinalRepeat = false;

    let rs: Segment | null = new Segment(playbackCount);
    rs.addMeasure(sections[s][e].measure);
    e++;

    while (e < sections[s].length) {
      if (++guard > 200000) throw new Error('반복 기호 전개가 끝나지 않습니다 (무한 반복 의심)');
      const el = sections[s][e];
      if (rs) rs.addMeasures(el.measure);
      let advance = true;
      switch (el.type) {
        case 'SECTION_BREAK':
          if (rs && !rs.isEmpty) out.push(rs);
          break;
        case 'VOLTA_START': {
          activeVolta = el.volta!;
          if (!hasEnding(activeVolta, playbackCount)) {
            rs!.popMeasure();
            if (!rs!.isEmpty) out.push(rs!);
            do {
              e++;
            } while (sections[s][e].type !== 'VOLTA_END');
            activeVolta = null;
            const nextMeasure = sections[s][e].measure + 1;
            if (nextMeasure >= measures.length) rs = null;
            else {
              rs = new Segment(playbackCount);
              rs.addMeasure(nextMeasure);
            }
          }
          break;
        }
        case 'VOLTA_END':
          activeVolta = null;
          break;
        case 'REPEAT_START': {
          if (rs === null) {
            rs = new Segment(playbackCount);
            rs.addMeasure(el.measure);
          } else {
            const desired = forceFinalRepeat ? el.repeatCount : 1;
            if (rs.playbackCount !== desired) {
              rs.popMeasure();
              if (!rs.isEmpty) out.push(rs);
              playbackCount = desired;
              rs = new Segment(playbackCount);
              rs.addMeasure(el.measure);
            }
            startRef = el;
          }
          break;
        }
        case 'REPEAT_END': {
          el.repeatCount += 1;
          const measureRepeatCount = measures[el.measure].endRepeat;
          if (playbackCount < startRef.repeatCount && el.repeatCount < measureRepeatCount) {
            if (rs && !rs.isEmpty) out.push(rs);
            rs = null;
            do {
              e--;
              const back = sections[s][e];
              if (back.type === 'VOLTA_START') activeVolta = null;
              else if (back.type === 'VOLTA_END') activeVolta = back.volta!;
            } while (sections[s][e] !== startRef);
            playbackCount++;
            advance = false; // 시작 도돌이표를 다시 평가한다
          }
          break;
        }
        case 'JUMP': {
          const jump = el.jump!;
          if (activeJump === jump) forceFinalRepeat = false;
          if (playbackCount >= startRef.repeatCount || (activeVolta && playbackCount === lastEnding(activeVolta))) {
            const key = jumpKey(jump, playbackCount);
            if (!jumpsTaken.has(key)) {
              jumpsTaken.add(key);
              const jumpTo = findMarker(jump.jumpTo, s, e);
              playUntil = findMarker(jump.playUntil, s, e);
              continueAt = findMarker(jump.continueAt, s, e);
              if (jumpTo.s !== -1) {
                if (rs && !rs.isEmpty) out.push(rs);
                rs = null;
                activeJump = jump;
                const r = performJump(jumpTo, jump.playRepeats);
                playbackCount = r.playbackCount;
                activeVolta = r.activeVolta;
                startRef = r.startRef;
                s = jumpTo.s;
                e = jumpTo.e;
                forceFinalRepeat = !jump.playRepeats;

                if (playUntil.s !== -1) {
                  for (let k = e + 1; k < sections[s].length; k++) {
                    const x = sections[s][k];
                    if (x.type === 'REPEAT_END' && x.repeatCount !== 0) {
                      x.repeatCount = forceFinalRepeat ? measures[x.measure].endRepeat : 0;
                    }
                  }
                }
                if (activeVolta && playbackCount < startRef.repeatCount) {
                  let k = e;
                  do {
                    k--;
                  } while (sections[s][k] !== startRef);
                  k++;
                  let voltaRef: Volta | null = null;
                  let processed = 1;
                  while (k < sections[s].length && sections[s][k].type !== 'REPEAT_START' && processed < startRef.repeatCount) {
                    const x = sections[s][k];
                    if (x.type === 'VOLTA_START') {
                      voltaRef = x.volta!;
                      if (lastEnding(voltaRef) < playbackCount) voltaRef = null;
                    } else if (x.type === 'REPEAT_END') {
                      if (voltaRef) {
                        const remaining = voltaRef.endings.filter((n) => n >= playbackCount).length;
                        x.repeatCount = measures[x.measure].endRepeat - remaining - 1;
                      }
                      processed += measures[x.measure].endRepeat - 1;
                    }
                    k++;
                  }
                }
                rs = new Segment(playbackCount);
                rs.addMeasure(sections[s][e].measure);
              }
            }
          }
          break;
        }
        case 'MARKER': {
          if (
            s === playUntil.s && e === playUntil.e &&
            (playbackCount === startRef.repeatCount || (activeVolta && playbackCount === lastEnding(activeVolta)))
          ) {
            if (rs && !rs.isEmpty) out.push(rs);
            rs = null;
            playUntil = NOT_FOUND;
            forceFinalRepeat = false;
            if (continueAt.s !== -1) {
              const r = performJump(continueAt, true);
              playbackCount = r.playbackCount;
              activeVolta = r.activeVolta;
              startRef = r.startRef;
              s = continueAt.s;
              e = continueAt.e;
              if (startRef.measure !== sections[s][e].measure) startRef = sections[s][e];
              rs = new Segment(playbackCount);
              rs.addMeasure(sections[s][e].measure);
              continueAt = NOT_FOUND;
            } else {
              e = sections[s].length;
              advance = false;
            }
          }
          break;
        }
      }
      if (advance) e++;
    }
  }
  return out;
}

/** 펼친 순서를 마디 단위 목록으로 */
export function playedMeasures(segments: RepeatSegment[]): PlayedMeasure[] {
  return segments.flatMap((sg) => sg.measures.map((measure) => ({ measure, playbackCount: sg.playbackCount })));
}

export function unrollScore(score: Score): PlayedMeasure[] {
  return playedMeasures(unrollRepeats(score.measures, score.voltas));
}
