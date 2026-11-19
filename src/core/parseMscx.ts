import type {
  ChordSymbol, Jump, Lyric, Marker, MeasureInfo, NoteEvent, Part, RestEvent, Score, TempoChange, TextMark, Volta,
} from './types';
import { childNum, childText, has, kid, kids, parseFraction, parseXml, type XEl } from './xml';

const DURATION_TYPES: Record<string, number> = {
  long: 4, breve: 2, whole: 1, half: 1 / 2, quarter: 1 / 4, eighth: 1 / 8,
  '16th': 1 / 16, '32nd': 1 / 32, '64th': 1 / 64, '128th': 1 / 128, '256th': 1 / 256,
};

const GRACE_TAGS = [
  'acciaccatura', 'appoggiatura', 'grace4', 'grace8', 'grace16', 'grace32',
  'grace8after', 'grace16after', 'grace32after',
];

const SYM_TEXT: Record<string, string> = {
  segno: '𝄋', coda: '𝄌', varcoda: '𝄌', metNoteQuarterUp: '♩', metNoteHalfUp: '𝅗𝅥',
  metNote8thUp: '♪', metAugmentationDot: '.',
};

const RIGHT_MARKER_SUBTYPES = new Set(['fine', 'toCoda', 'toCodaSym', 'daCoda', 'daDblCoda', 'daDoubleCoda']);

/** <text> 안의 <sym>, <font> 같은 서식을 정리해 사람이 읽는 글자로 */
export function richText(el: XEl | undefined): string {
  if (!el) return '';
  let out = '';
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.nodeType === 3 || n.nodeType === 4) out += n.textContent ?? '';
    else if (n.nodeType === 1) {
      if (n.nodeName === 'sym') out += SYM_TEXT[n.textContent ?? ''] ?? '';
      else out += richText(n);
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

interface ScoreContext {
  division: number;
  wholeTicks: number;
  warnings: string[];
  idCounter: number;
}

function durationTicks(el: XEl, ctx: ScoreContext, measureLen: number): number {
  const type = childText(el, 'durationType') ?? '';
  if (type === 'measure') {
    const d = childText(el, 'duration');
    return d ? Math.round(parseFraction(d) * ctx.wholeTicks) : measureLen;
  }
  const base = DURATION_TYPES[type];
  if (base === undefined) {
    ctx.warnings.push(`알 수 없는 음길이 "${type}"`);
    return 0;
  }
  const dots = childNum(el, 'dots') ?? 0;
  const factor = 2 - 1 / 2 ** dots;
  return Math.round(base * factor * ctx.wholeTicks);
}

/** 1차: 첫 보표에서 박자·마디 길이·반복·점프 등 마디 정보를 모은다 */
function readMeasures(firstStaff: XEl, ctx: ScoreContext): { measures: MeasureInfo[]; voltas: Volta[] } {
  const measures: MeasureInfo[] = [];
  const voltas: Volta[] = [];
  const voltaSpans: { measures: number; frac: number; startOffset: number }[] = [];
  let timeSig = { n: 4, d: 4 };
  let keySig = 0;
  let tick = 0;
  let number = 0;

  // 프레임(VBox 등)에 붙은 섹션 나누기는 바로 앞 마디에 적용한다
  const sectionBreakAfter = new Set<number>();
  const measureEls: XEl[] = [];
  for (const c of kids(firstStaff)) {
    if (c.nodeName === 'Measure') measureEls.push(c);
    else if (/^[VHT]Box$/.test(c.nodeName) && measureEls.length > 0) {
      if (kids(c, 'LayoutBreak').some((b) => childText(b, 'subtype') === 'section')) {
        sectionBreakAfter.add(measureEls.length - 1);
      }
    }
  }
  measureEls.forEach((mEl, index) => {
    const voices = kids(mEl, 'voice');
    // 박자/조표 변경은 첫 성부에 들어 있다
    for (const v of voices.slice(0, 1)) {
      for (const c of kids(v)) {
        if (c.nodeName === 'TimeSig') {
          const n = childNum(c, 'sigN');
          const d = childNum(c, 'sigD');
          if (n && d) timeSig = { n, d };
        } else if (c.nodeName === 'KeySig') {
          const k = childNum(c, 'concertKey') ?? childNum(c, 'accidental');
          if (k !== undefined) keySig = k;
        }
      }
    }
    const lenAttr = mEl.getAttribute('len');
    const length = lenAttr
      ? Math.round(parseFraction(lenAttr) * ctx.wholeTicks)
      : Math.round((timeSig.n / timeSig.d) * ctx.wholeTicks);

    const irregular = has(mEl, 'irregular') && (childText(mEl, 'irregular') ?? '').trim() !== '0';
    number += irregular ? 0 : 1;
    const noOffset = childNum(mEl, 'noOffset') ?? 0;
    number += noOffset;

    const endRepeatEl = kid(mEl, 'endRepeat');
    const jumps: Jump[] = kids(mEl, 'Jump').map((j) => ({
      text: richText(kid(j, 'text')),
      jumpTo: childText(j, 'jumpTo') ?? '',
      playUntil: childText(j, 'playUntil') ?? '',
      continueAt: childText(j, 'continueAt') ?? '',
      playRepeats: (childText(j, 'playRepeats') ?? '0').trim() === '1',
    }));
    const markers: Marker[] = kids(mEl, 'Marker').map((mk) => {
      const style = childText(mk, 'style') ?? '';
      const subtype = childText(mk, 'subtype') ?? '';
      return {
        label: childText(mk, 'label') ?? '',
        text: richText(kid(mk, 'text')),
        isRight: /right/i.test(style) || RIGHT_MARKER_SUBTYPES.has(subtype),
      };
    });
    const breaks = kids(mEl, 'LayoutBreak').map((b) => childText(b, 'subtype') ?? '');
    let endBarLine: string | undefined;
    for (const v of voices) for (const bl of kids(v, 'BarLine')) endBarLine = childText(bl, 'subtype') ?? endBarLine;

    measures.push({
      index,
      tick,
      length,
      timeSig: { ...timeSig },
      keySig,
      startRepeat: has(mEl, 'startRepeat'),
      endRepeat: endRepeatEl ? Number(endRepeatEl.textContent || 2) || 2 : 0,
      jumps,
      markers,
      sectionBreak: breaks.includes('section') || sectionBreakAfter.has(index),
      lineBreak: breaks.includes('line'),
      endBarLine,
      number: irregular ? Math.max(number, 1) : number,
    });

    // 볼타(1·2번 괄호): 성부 안의 Spanner로 들어 있다
    for (const v of voices) {
      let cursor = 0;
      for (const c of kids(v)) {
        if (c.nodeName === 'location') {
          cursor += Math.round(parseFraction(childText(c, 'fractions')) * ctx.wholeTicks);
        } else if (c.nodeName === 'Spanner' && c.getAttribute('type') === 'Volta') {
          const vEl = kid(c, 'Volta');
          if (!vEl) continue;
          const loc = kid(kid(c, 'next') ?? c, 'location');
          const spanMeasures = loc ? childNum(loc, 'measures') ?? 0 : 0;
          const spanFrac = loc ? Math.round(parseFraction(childText(loc, 'fractions')) * ctx.wholeTicks) : 0;
          const endings = (childText(vEl, 'endings') ?? '')
            .split(/[,\s]+/).map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0);
          voltas.push({
            startMeasure: index,
            // 끝 위치는 나중에 마디 tick 표로 계산한다
            endMeasure: -1,
            endings,
            closed: (childNum(vEl, 'endHookType') ?? 0) !== 0,
            text: richText(kid(vEl, 'beginText')),
          });
          voltaSpans.push({ measures: spanMeasures, frac: spanFrac, startOffset: cursor });
        } else if ((c.nodeName === 'Chord' || c.nodeName === 'Rest') && !GRACE_TAGS.some((g) => has(c, g))) {
          // 셋잇단음표는 무시한 대략 위치 (볼타 끝은 마디 단위로만 쓰므로 충분)
          cursor += durationTicks(c, ctx, length);
        }
      }
    }
    tick += length;
    // 섹션이 바뀌면 마디 번호를 1부터 다시 센다 (MuseScore 기본값)
    if (measures[index].sectionBreak) number = 0;
  });

  // 볼타 끝 마디 계산: 시작 마디 + measures, 그 위치 바로 앞 tick이 속한 마디
  voltas.forEach((vol, vi) => {
    const span = voltaSpans[vi];
    const endIdx = vol.startMeasure + span.measures;
    let endTick: number;
    if (endIdx >= measures.length) endTick = tick + span.frac;
    else endTick = measures[endIdx].tick + span.startOffset + span.frac;
    let endMeasure = vol.startMeasure;
    for (const m of measures) if (m.tick < endTick) endMeasure = m.index;
    vol.endMeasure = Math.max(vol.startMeasure, endMeasure);
  });
  return { measures, voltas };
}

/** TPC → 음 이름 (B♭, F♯ ...) */
export function tpcName(tpc: number): string {
  const letter = 'FCGDAEB'[(((tpc + 1) % 7) + 7) % 7];
  const alter = Math.floor((tpc + 1) / 7) - 2;
  return letter + (alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter));
}

interface StaffReadResult {
  chords: ChordSymbol[];
  notes: NoteEvent[];
  rests: RestEvent[];
  marks: TextMark[];
  tempos: TempoChange[];
}

/** 2차: 각 보표의 음표·쉼표·가사·템포를 읽는다 */
function readStaff(staffEl: XEl, staffIdx: number, measures: MeasureInfo[], ctx: ScoreContext): StaffReadResult {
  const res: StaffReadResult = { chords: [], notes: [], rests: [], marks: [], tempos: [] };
  const measureEls = kids(staffEl, 'Measure');
  if (measureEls.length !== measures.length) {
    ctx.warnings.push(`보표 ${staffIdx + 1}의 마디 수(${measureEls.length})가 첫 보표(${measures.length})와 다릅니다`);
  }
  measureEls.forEach((mEl, mi) => {
    const m = measures[mi];
    if (!m) return;
    kids(mEl, 'voice').forEach((v, voiceIdx) => {
      let cursor = 0;
      const tupletStack: { actual: number; normal: number; id: number }[] = [];
      const tupletById = new Map<string, { actual: number; normal: number; id: number }>();
      for (const c of kids(v)) {
        switch (c.nodeName) {
          case 'location':
            cursor += Math.round(parseFraction(childText(c, 'fractions')) * ctx.wholeTicks);
            break;
          case 'Tuplet': {
            const normal = childNum(c, 'normalNotes') ?? 1;
            const actual = childNum(c, 'actualNotes') ?? 1;
            const t = { actual, normal, id: ++ctx.idCounter };
            const id = c.getAttribute('id');
            if (id) tupletById.set(id, t); // MuseScore 3 형식
            else tupletStack.push(t); // MuseScore 4 형식: endTuplet 까지
            break;
          }
          case 'endTuplet':
            tupletStack.pop();
            break;
          case 'Tempo': {
            const t = childNum(c, 'tempo');
            if (t) res.tempos.push({ tick: m.tick + cursor, bpm: Math.round(t * 60 * 1000) / 1000 });
            const txt = richText(kid(c, 'text'));
            if (txt) res.marks.push({ tick: m.tick + cursor, measure: mi, kind: 'tempoText', text: txt });
            break;
          }
          case 'Harmony': {
            const info = kid(c, 'harmonyInfo') ?? c; // 구형식은 Harmony 바로 아래에 있음
            const root = childNum(info, 'root');
            const bass = childNum(info, 'bass');
            const name = childText(info, 'name') ?? '';
            const plain = richText(kid(c, 'text'));
            const text = root !== undefined
              ? tpcName(root) + name + (bass !== undefined ? '/' + tpcName(bass) : '')
              : plain || name;
            if (text) res.chords.push({ tick: m.tick + cursor, measure: mi, staff: staffIdx, root, bass, name, text });
            break;
          }
          case 'RehearsalMark':
            res.marks.push({ tick: m.tick + cursor, measure: mi, kind: 'rehearsal', text: richText(kid(c, 'text')) });
            break;
          case 'StaffText':
          case 'SystemText':
          case 'Expression':
            res.marks.push({ tick: m.tick + cursor, measure: mi, kind: 'staffText', text: richText(kid(c, 'text')) });
            break;
          case 'Chord':
          case 'Rest': {
            const isGrace = GRACE_TAGS.some((g) => has(c, g));
            let dur = durationTicks(c, ctx, m.length);
            for (const r of tupletStack) dur = Math.round((dur * r.normal) / r.actual);
            const tRef = childText(c, 'Tuplet');
            const oldTuplet = tRef ? tupletById.get(tRef) : undefined;
            if (oldTuplet) dur = Math.round((dur * oldTuplet.normal) / oldTuplet.actual);
            const notation = {
              durationType: childText(c, 'durationType') ?? 'quarter',
              dots: childNum(c, 'dots') ?? 0,
              tuplet: tupletStack[tupletStack.length - 1] ?? oldTuplet,
            };
            if (isGrace) {
              // 꾸밈음은 MVP에서 재생하지 않는다 (시간도 차지하지 않음)
              break;
            }
            const tick = m.tick + cursor;
            if (c.nodeName === 'Rest') {
              res.rests.push({ tick, duration: dur, measure: mi, staff: staffIdx, voice: voiceIdx, ...notation });
            } else {
              const lyrics: Lyric[] = kids(c, 'Lyrics').map((l) => ({
                verse: childNum(l, 'no') ?? 0,
                text: richText(kid(l, 'text')),
                syllabic: (childText(l, 'syllabic') as Lyric['syllabic']) ?? undefined,
              }));
              const chordId = ++ctx.idCounter;
              const stem = childText(c, 'StemDirection');
              kids(c, 'Note').forEach((n, ni) => {
                const pitch = childNum(n, 'pitch');
                if (pitch === undefined) return;
                let tieToNext = false;
                let tieFromPrev = false;
                for (const sp of kids(n, 'Spanner')) {
                  if (sp.getAttribute('type') !== 'Tie') continue;
                  if (has(sp, 'next')) tieToNext = true;
                  if (has(sp, 'prev')) tieFromPrev = true;
                }
                if (has(n, 'Tie')) tieToNext = true; // 구형식
                if (has(n, 'endSpanner')) tieFromPrev = true; // 구형식
                res.notes.push({
                  tick, duration: dur, pitch, measure: mi, staff: staffIdx, voice: voiceIdx,
                  tpc: childNum(n, 'tpc'), chordId,
                  stemDirection: stem === 'up' || stem === 'down' ? stem : undefined,
                  ...notation,
                  tieToNext, tieFromPrev, lyrics: ni === 0 ? lyrics : [],
                });
              });
            }
            cursor += dur;
            break;
          }
          default:
            break;
        }
      }
    });
  });
  return res;
}

export function parseMscx(text: string): Score {
  const root = parseXml(text);
  if (root.nodeName !== 'museScore') throw new Error('MuseScore 악보 파일(.mscx)이 아닙니다');
  const scoreEl = kid(root, 'Score');
  if (!scoreEl) throw new Error('악보(Score) 데이터를 찾을 수 없습니다');

  const division = childNum(scoreEl, 'Division') ?? 480;
  const ctx: ScoreContext = { division, wholeTicks: division * 4, warnings: [], idCounter: 0 };

  const meta = new Map<string, string>();
  for (const mt of kids(scoreEl, 'metaTag')) meta.set(mt.getAttribute('name') ?? '', mt.textContent ?? '');

  // 파트와 보표 연결 (파트 안의 Staff 순서 = 악보 본문의 Staff 순서)
  const parts: Part[] = [];
  let staffCounter = 0;
  for (const p of kids(scoreEl, 'Part')) {
    const inst = kid(p, 'Instrument');
    const staves = kids(p, 'Staff').map(() => staffCounter++);
    const name = (childText(p, 'trackName') || (inst && childText(inst, 'longName')) || `파트 ${parts.length + 1}`).trim();
    parts.push({
      id: p.getAttribute('id') ?? String(parts.length + 1),
      name,
      instrumentId: (inst && (childText(inst, 'instrumentId') ?? inst.getAttribute('id'))) || '',
      staves,
    });
  }

  const staffEls = kids(scoreEl, 'Staff');
  if (staffEls.length === 0) throw new Error('악보에 보표가 없습니다');
  const { measures, voltas } = readMeasures(staffEls[0], ctx);

  const staffClefs = staffEls.map((s) => {
    for (const mEl of kids(s, 'Measure')) {
      for (const v of kids(mEl, 'voice')) {
        const clef = kid(v, 'Clef');
        if (clef) return (childText(clef, 'concertClefType') ?? childText(clef, 'subtype') ?? 'G').trim();
      }
    }
    return 'G';
  });

  const notes: NoteEvent[] = [];
  const rests: RestEvent[] = [];
  const marks: TextMark[] = [];
  const chords: ChordSymbol[] = [];
  const tempoMap = new Map<number, number>();
  staffEls.forEach((s, i) => {
    const r = readStaff(s, i, measures, ctx);
    notes.push(...r.notes);
    rests.push(...r.rests);
    chords.push(...r.chords);
    if (i === 0) marks.push(...r.marks);
    else marks.push(...r.marks.filter((mk) => mk.kind === 'staffText'));
    for (const t of r.tempos) if (!tempoMap.has(t.tick)) tempoMap.set(t.tick, t.bpm);
  });
  const tempos = [...tempoMap.entries()].sort((a, b) => a[0] - b[0]).map(([tick, bpm]) => ({ tick, bpm }));
  if (tempos.length === 0 || tempos[0].tick > 0) tempos.unshift({ tick: 0, bpm: 120 });

  notes.sort((a, b) => a.tick - b.tick || a.staff - b.staff || a.voice - b.voice || a.pitch - b.pitch);

  const title = meta.get('workTitle') || richText(findTitleText(staffEls[0])) || '';
  return {
    title,
    composer: meta.get('composer') ?? '',
    museScoreVersion: root.getAttribute('version') ?? '',
    programVersion: childText(root, 'programVersion') ?? '',
    division,
    parts,
    staffClefs,
    measures,
    voltas,
    tempos,
    notes,
    rests,
    marks,
    chords,
    warnings: ctx.warnings,
  };
}

function findTitleText(staff: XEl): XEl | undefined {
  for (const box of kids(staff, 'VBox')) {
    for (const t of kids(box, 'Text')) {
      if (childText(t, 'style') === 'title' || childText(t, 'style') === 'Title') return kid(t, 'text');
    }
  }
  return undefined;
}
