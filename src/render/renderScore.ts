/**
 * VexFlow로 악보를 그린다. 줄바꿈은 MuseScore 원본(LayoutBreak)을 따른다.
 * 한 줄(시스템)마다 SVG 하나를 만들고, 화면 폭에 맞춰 늘이고 줄인다.
 */
import {
  Accidental, Barline, Beam, Dot, Formatter, ModifierPosition,
  Renderer, Stave, StaveConnector, StaveNote, StaveText, StaveTie, StemmableNote, Tuplet, Voice, VoltaType,
} from 'vexflow/bravura';
import type { MeasureInfo, NoteEvent, RestEvent, Score } from '../core/types';

/** 한 줄의 가상 폭. 실제 화면에서는 SVG viewBox로 비율을 맞춘다 */
const SYSTEM_WIDTH = 1000;
const LEFT_MARGIN = 14;
const STAFF_HEIGHT = 40; // 오선 5줄 높이 (VexFlow 기본 간격 10)
const ABOVE_SPACE = 70; // 오선 위 여백 (리허설 마크, 괄호, 글자)
const STAFF_GAP = 70; // 보표 사이 기본 여백
const LYRIC_LINE = 18; // 가사 한 줄 높이
const LYRIC_TOP = 30; // 맨 아래 줄에서 첫 가사 글자 바닥까지
const LYRIC_FONT = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

const KEY_NAMES: Record<number, string> = {
  [-7]: 'Cb', [-6]: 'Gb', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F',
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
};

const DURATIONS: Record<string, string> = {
  long: '1/4', breve: '1/2', whole: 'w', half: 'h', quarter: 'q', eighth: '8',
  '16th': '16', '32nd': '32', '64th': '64', '128th': '128',
};

const CLEFS: Record<string, { clef: string; annotation?: string; restKey: string }> = {
  G: { clef: 'treble', restKey: 'b/4' },
  G8vb: { clef: 'treble', annotation: '8vb', restKey: 'b/4' },
  G8va: { clef: 'treble', annotation: '8va', restKey: 'b/4' },
  F: { clef: 'bass', restKey: 'd/3' },
  F8vb: { clef: 'bass', annotation: '8vb', restKey: 'd/3' },
  C3: { clef: 'alto', restKey: 'c/4' },
  C4: { clef: 'tenor', restKey: 'a/3' },
  PERC: { clef: 'percussion', restKey: 'b/4' },
};

/** TPC(조성 음이름)와 MIDI 음높이로 VexFlow 음 이름 만들기 (예: "bb/4") */
export function spellNote(pitch: number, tpc?: number): string {
  if (tpc === undefined) {
    const names = ['c', 'c#', 'd', 'eb', 'e', 'f', 'f#', 'g', 'ab', 'a', 'bb', 'b'];
    return `${names[pitch % 12]}/${Math.floor(pitch / 12) - 1}`;
  }
  const letter = 'fcgdaeb'[(((tpc + 1) % 7) + 7) % 7];
  const alter = Math.floor((tpc + 1) / 7) - 2;
  const acc = alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter);
  const octave = Math.floor((pitch - alter) / 12) - 1;
  return `${letter}${acc}/${octave}`;
}

export interface MeasureBox {
  system: number;
  /** 가상 좌표 (SYSTEM_WIDTH 기준) */
  x: number;
  width: number;
  noteStartX: number;
  noteEndX: number;
}

export interface RenderedScore {
  systems: SVGSVGElement[];
  measureBoxes: MeasureBox[];
  systemWidth: number;
}

/** 마디가 겹치지 않고 그려지는 데 필요한 최소 폭(가상 좌표) 추정 */
function minMeasureWidth(score: Score, mi: number): number {
  let maxEvents = 1;
  let lyricChars = 0;
  score.staffClefs.forEach((_, st) => {
    for (const list of eventsFor(score, mi, st).values()) maxEvents = Math.max(maxEvents, list.length);
  });
  for (const n of score.notes) if (n.measure === mi) for (const l of n.lyrics) lyricChars = Math.max(lyricChars, l.text.length);
  const perEvent = 26 + (lyricChars > 1 ? 6 : 0);
  return 36 + maxEvents * perEvent;
}

/**
 * MuseScore처럼 줄을 나눈다: 직접 넣은 줄바꿈(LayoutBreak)은 반드시 지키고,
 * 그 사이가 한 줄에 다 들어가지 않으면 MuseScore가 하듯 자동으로 더 나눈다.
 */
export function layoutSystems(score: Score, width = SYSTEM_WIDTH): number[][] {
  const groups: number[][] = [];
  let cur: number[] = [];
  for (const m of score.measures) {
    cur.push(m.index);
    if (m.lineBreak || m.sectionBreak) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);

  const usable = width - LEFT_MARGIN - 6;
  const systems: number[][] = [];
  for (const g of groups) {
    const widths = g.map((mi) => minMeasureWidth(score, mi));
    const head = 70 + Math.abs(score.measures[g[0]].keySig) * 9;
    const total = widths.reduce((a, b) => a + b, 0) + head;
    const lines = Math.max(1, Math.ceil(total / usable));
    // 줄 수를 정한 뒤, 남은 폭을 남은 줄 수로 나눠 가며 고르게 채운다
    let line: number[] = [];
    let acc = head;
    let remaining = total;
    let linesLeft = lines;
    g.forEach((mi, k) => {
      const target = remaining / linesLeft;
      const over = acc + widths[k] - target;
      if (line.length > 0 && linesLeft > 1 && over > widths[k] / 2) {
        systems.push(line);
        remaining -= acc;
        linesLeft--;
        line = [];
        acc = head;
      }
      line.push(mi);
      acc += widths[k];
    });
    if (line.length) systems.push(line);
  }
  return systems;
}

interface StaffEvent {
  tick: number;
  rest?: RestEvent;
  notes?: NoteEvent[];
}

function eventsFor(score: Score, measure: number, staff: number): Map<number, StaffEvent[]> {
  const byVoice = new Map<number, StaffEvent[]>();
  const push = (voice: number, e: StaffEvent) => {
    const list = byVoice.get(voice) ?? [];
    list.push(e);
    byVoice.set(voice, list);
  };
  const chords = new Map<number, NoteEvent[]>();
  for (const n of score.notes) {
    if (n.measure !== measure || n.staff !== staff) continue;
    const c = chords.get(n.chordId) ?? [];
    c.push(n);
    chords.set(n.chordId, c);
  }
  for (const c of chords.values()) push(c[0].voice, { tick: c[0].tick, notes: c });
  for (const r of score.rests) if (r.measure === measure && r.staff === staff) push(r.voice, { tick: r.tick, rest: r });
  for (const list of byVoice.values()) list.sort((a, b) => a.tick - b.tick);
  return byVoice;
}

function keyChanged(score: Score, i: number) {
  return i > 0 && score.measures[i].keySig !== score.measures[i - 1].keySig;
}
function timeChanged(score: Score, i: number) {
  if (i === 0) return true;
  const a = score.measures[i].timeSig;
  const b = score.measures[i - 1].timeSig;
  return a.n !== b.n || a.d !== b.d;
}

/** 마디 안 음표 수로 폭 비중을 정한다 */
function measureWeight(score: Score, m: MeasureInfo): number {
  let max = 1;
  score.staffClefs.forEach((_, st) => {
    let count = 0;
    for (const list of eventsFor(score, m.index, st).values()) count = Math.max(count, list.length);
    max = Math.max(max, count);
  });
  return 1.6 + Math.sqrt(max) * 1.2;
}

interface TieStart {
  note: StaveNote;
  index: number;
}

export function renderScore(container: HTMLElement, score: Score): RenderedScore {
  container.innerHTML = '';
  const systems = layoutSystems(score);
  const staffCount = score.staffClefs.length;
  const measureBoxes: MeasureBox[] = [];
  const svgs: SVGSVGElement[] = [];

  // 보표별로 가사 절 수 (가사 공간 확보용)
  const verseCount = score.staffClefs.map((_, st) => {
    let max = 0;
    for (const n of score.notes) if (n.staff === st) for (const l of n.lyrics) max = Math.max(max, l.verse + 1);
    return max;
  });
  const staffTop: number[] = [];
  let y = ABOVE_SPACE;
  for (let st = 0; st < staffCount; st++) {
    staffTop.push(y);
    y += STAFF_HEIGHT + STAFF_GAP + (verseCount[st] ? LYRIC_TOP - 10 + verseCount[st] * LYRIC_LINE : 0);
  }
  const systemHeight = y - STAFF_GAP + 20;

  // 줄을 넘어가는 붙임줄: (보표:성부:음높이) → 시작 음표
  let pendingTies = new Map<string, TieStart>();
  const voltaByMeasure = new Map<number, { type: number; label: string }>();
  for (const v of score.voltas) {
    for (let m = v.startMeasure; m <= v.endMeasure; m++) {
      const single = v.startMeasure === v.endMeasure;
      const type = single ? VoltaType.BEGIN_END : m === v.startMeasure ? VoltaType.BEGIN : m === v.endMeasure ? (v.closed ? VoltaType.END : VoltaType.MID) : VoltaType.MID;
      const finalType = single && !v.closed ? VoltaType.BEGIN : type;
      voltaByMeasure.set(m, { type: finalType, label: m === v.startMeasure ? v.text || `${v.endings.join(', ')}.` : '' });
    }
  }

  systems.forEach((sysMeasures, si) => {
    const div = document.createElement('div');
    div.className = 'system';
    container.appendChild(div);
    const renderer = new Renderer(div, Renderer.Backends.SVG);
    renderer.resize(SYSTEM_WIDTH, systemHeight);
    const ctx = renderer.getContext();

    const usable = SYSTEM_WIDTH - LEFT_MARGIN - 6;
    const firstExtra = 70 + Math.abs(score.measures[sysMeasures[0]].keySig) * 9 + (timeChanged(score, sysMeasures[0]) ? 26 : 0);
    const weights = sysMeasures.map((mi) => {
      const m = score.measures[mi];
      return measureWeight(score, m) + (keyChanged(score, mi) ? 1 : 0) + (mi !== sysMeasures[0] && timeChanged(score, mi) ? 0.8 : 0);
    });
    const totalW = weights.reduce((a, b) => a + b, 0);
    const flexible = usable - firstExtra;
    let x = LEFT_MARGIN;
    const newTies = new Map<string, TieStart>();

    sysMeasures.forEach((mi, k) => {
      const m = score.measures[mi];
      const width = (weights[k] / totalW) * flexible + (k === 0 ? firstExtra : 0);
      const staves: Stave[] = [];
      const rehearsalQueue: { stave: Stave; text: string }[] = [];
      for (let st = 0; st < staffCount; st++) {
        const stave = new Stave(x, staffTop[st] - 40, width);
        const clef = CLEFS[score.staffClefs[st]] ?? CLEFS.G;
        if (k === 0) {
          stave.addClef(clef.clef, 'default', clef.annotation);
          stave.addKeySignature(KEY_NAMES[m.keySig] ?? 'C');
        } else if (keyChanged(score, mi)) {
          stave.addKeySignature(KEY_NAMES[m.keySig] ?? 'C', KEY_NAMES[score.measures[mi - 1].keySig]);
        }
        if (timeChanged(score, mi)) stave.addTimeSignature(`${m.timeSig.n}/${m.timeSig.d}`);
        if (m.startRepeat) stave.setBegBarType(Barline.type.REPEAT_BEGIN);
        if (m.endRepeat) stave.setEndBarType(Barline.type.REPEAT_END);
        else if (m.endBarLine === 'double') stave.setEndBarType(Barline.type.DOUBLE);
        else if (m.endBarLine === 'end' || mi === score.measures.length - 1) stave.setEndBarType(Barline.type.END);

        if (st === 0) {
          if (k === 0) stave.setMeasure(m.number);
          const volta = voltaByMeasure.get(mi);
          if (volta) stave.setVoltaType(volta.type, volta.label, -8);
          const rehearsal = score.marks.filter((t) => t.measure === mi && t.kind === 'rehearsal').map((t) => t.text);
          if (rehearsal.length) rehearsalQueue.push({ stave, text: rehearsal.join(' ') });
          const texts = [
            ...m.jumps.map((j) => j.text),
            ...score.marks.filter((t) => t.measure === mi && t.kind === 'staffText').map((t) => t.text),
            ...m.markers.map((mk) => mk.text || mk.label),
          ];
          if (texts.length) {
            stave.addModifier(new StaveText(texts.join('\u00a0\u00a0'), ModifierPosition.ABOVE, { shiftY: volta ? -16 : -2 }));
          }
          const tempo = score.tempos.find((t) => t.tick >= m.tick && t.tick < m.tick + m.length);
          if (tempo && (mi === 0 || tempo.tick > 0)) stave.setTempo({ duration: 'q', bpm: Math.round(tempo.bpm) }, -2);
        }
        staves.push(stave);
      }
      // 여러 보표의 음표 시작 위치를 맞춘다
      const noteStart = Math.max(...staves.map((s) => s.getNoteStartX()));
      staves.forEach((s) => s.setNoteStartX(noteStart));
      staves.forEach((s) => s.setContext(ctx).draw());
      // 리허설 마크(Intro, Verse ...): 네모 칸 안의 굵은 글자
      for (const r of rehearsalQueue) {
        ctx.save();
        ctx.setFont('Academico, "Noto Sans KR", serif', 16, 'bold');
        const w = ctx.measureText(r.text).width;
        const bx = r.stave.getX() + (r.stave === staves[0] && k === 0 ? 2 : 4);
        const by = r.stave.getYForLine(0) - 52;
        ctx.setLineWidth(1.2);
        ctx.rect(bx, by, w + 10, 22);
        ctx.stroke();
        ctx.fillText(r.text, bx + 5, by + 17);
        ctx.restore();
      }

      // 음표 만들기
      const allVoices: Voice[] = [];
      const staffVoices: Voice[][] = [];
      const beams: Beam[] = [];
      const tuplets: Tuplet[] = [];
      const ties: StaveTie[] = [];
      const lyricQueue: { note: StaveNote; staff: number; verse: number; text: string }[] = [];
      for (let st = 0; st < staffCount; st++) {
        const clef = CLEFS[score.staffClefs[st]] ?? CLEFS.G;
        const voices: Voice[] = [];
        const byVoice = eventsFor(score, mi, st);
        const multiVoice = byVoice.size > 1;
        for (const [voiceIdx, events] of [...byVoice.entries()].sort((a, b) => a[0] - b[0])) {
          const tickables: StaveNote[] = [];
          const tupletGroups = new Map<number, StaveNote[]>();
          const tupletInfo = new Map<number, { actual: number; normal: number }>();
          for (const e of events) {
            const nt = e.rest ?? e.notes![0];
            const isMeasureRest = !!e.rest && e.rest.durationType === 'measure';
            const dur = isMeasureRest ? 'w' : DURATIONS[nt.durationType] ?? 'q';
            const keys = e.notes ? [...e.notes].sort((a, b) => a.pitch - b.pitch).map((n) => spellNote(n.pitch, n.tpc)) : [clef.restKey];
            const note = new StaveNote({
              keys,
              duration: dur + (e.rest ? 'r' : ''),
              clef: clef.clef,
              dots: isMeasureRest ? 0 : nt.dots,
              alignCenter: isMeasureRest,
              autoStem: !multiVoice && !e.notes?.[0].stemDirection,
            });
            if (multiVoice) note.setStemDirection(voiceIdx % 2 === 0 ? 1 : -1);
            else if (e.notes?.[0].stemDirection) note.setStemDirection(e.notes[0].stemDirection === 'up' ? 1 : -1);
            if (!isMeasureRest && nt.dots) Dot.buildAndAttach([note], { all: true });
            if (e.notes) {
              const sorted = [...e.notes].sort((a, b) => a.pitch - b.pitch);
              for (const l of e.notes.flatMap((n) => n.lyrics)) {
                if (l.text) lyricQueue.push({ note, staff: st, verse: l.verse, text: l.text });
              }
              sorted.forEach((n, idx) => {
                const key = `${st}:${voiceIdx}:${n.pitch}`;
                if (n.tieFromPrev) {
                  const start = newTies.get(key) ?? pendingTies.get(key);
                  if (start && newTies.has(key)) {
                    ties.push(new StaveTie({ firstNote: start.note, lastNote: note, firstIndexes: [start.index], lastIndexes: [idx] }));
                  } else {
                    // 앞 줄에서 넘어온 붙임줄: 줄 머리에서 시작
                    ties.push(new StaveTie({ firstNote: null, lastNote: note, firstIndexes: [idx], lastIndexes: [idx] }));
                  }
                  newTies.delete(key);
                  pendingTies.delete(key);
                }
                if (n.tieToNext) newTies.set(key, { note, index: idx });
              });
            }
            if (nt.tuplet) {
              const g = tupletGroups.get(nt.tuplet.id) ?? [];
              g.push(note);
              tupletGroups.set(nt.tuplet.id, g);
              tupletInfo.set(nt.tuplet.id, nt.tuplet);
            }
            tickables.push(note);
          }
          for (const [id, notes] of tupletGroups) {
            const t = tupletInfo.get(id)!;
            tuplets.push(new Tuplet(notes, { numNotes: t.actual, notesOccupied: t.normal }));
          }
          const voice = new Voice({ numBeats: m.timeSig.n, beatValue: m.timeSig.d }).setMode(Voice.Mode.SOFT);
          voice.addTickables(tickables);
          voices.push(voice);
          const beamable = tickables.filter((n) => !n.isRest()) as StemmableNote[];
          beams.push(...Beam.generateBeams(beamable, {
            groups: Beam.getDefaultBeamGroups(`${m.timeSig.n}/${m.timeSig.d}`),
            maintainStemDirections: multiVoice,
          }));
        }
        if (voices.length) Accidental.applyAccidentals(voices, KEY_NAMES[m.keySig] ?? 'C');
        staffVoices.push(voices);
        allVoices.push(...voices);
      }
      if (allVoices.length) {
        const formatter = new Formatter();
        staffVoices.forEach((vs) => vs.length && formatter.joinVoices(vs));
        const avail = staves[0].getNoteEndX() - staves[0].getNoteStartX() - 12;
        formatter.format(allVoices, Math.max(avail, 20));
        staffVoices.forEach((vs, st) => vs.forEach((v) => v.draw(ctx, staves[st])));
      }
      beams.forEach((b) => b.setContext(ctx).draw());
      tuplets.forEach((t) => t.setContext(ctx).draw());
      ties.forEach((t) => t.setContext(ctx).draw());

      // 가사: 보표 아래 일정한 줄에 음표 머리 가운데 맞춰 쓴다
      ctx.save();
      ctx.setFont(LYRIC_FONT, 14);
      for (const l of lyricQueue) {
        const baseY = staves[l.staff].getYForLine(4) + LYRIC_TOP + l.verse * LYRIC_LINE;
        const cx = l.note.getAbsoluteX() + l.note.getGlyphWidth() / 2;
        const w = ctx.measureText(l.text).width;
        ctx.fillText(l.text, cx - w / 2, baseY);
      }
      ctx.restore();

      if (k === 0 && staffCount > 1) {
        new StaveConnector(staves[0], staves[staffCount - 1]).setType('singleLeft').setContext(ctx).draw();
        new StaveConnector(staves[0], staves[staffCount - 1]).setType('bracket').setContext(ctx).draw();
      }
      measureBoxes[mi] = {
        system: si,
        x,
        width,
        noteStartX: staves[0].getNoteStartX(),
        noteEndX: staves[0].getNoteEndX(),
      };
      x += width;
    });

    // 줄 끝까지 이어지지 못한 붙임줄은 줄 끝에서 닫는다
    for (const t of newTies.values()) {
      new StaveTie({ firstNote: t.note, lastNote: null, firstIndexes: [t.index], lastIndexes: [t.index] }).setContext(ctx).draw();
    }
    pendingTies = newTies;

    const svg = div.querySelector('svg')!;
    svg.setAttribute('viewBox', `0 0 ${SYSTEM_WIDTH} ${systemHeight}`);
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.width = '100%';
    svg.style.height = 'auto';
    svgs.push(svg);
  });

  return { systems: svgs, measureBoxes, systemWidth: SYSTEM_WIDTH };
}
