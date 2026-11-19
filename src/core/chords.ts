/**
 * 코드 기호(Harmony)로 피아노 반주 음을 만든다.
 * 코드가 바뀌는 곳과 매 마디 첫 박에서 베이스 + 화음을 길게 누른다(패드처럼).
 */
import type { ChordSymbol, NoteEvent, Score } from './types';

/** TPC → 음높이 클래스 (C=0 ... B=11) */
export function tpcToPc(tpc: number): number {
  return ((((tpc - 14) * 7) % 12) + 12) % 12;
}

/** 근음 위의 음정(반음) 목록. 예: "m7" → [0, 3, 7, 10] */
export function chordIntervals(nameIn: string): number[] {
  const name = nameIn.replace(/[()\s]/g, '');
  let third = 4;
  let fifth = 7;
  const extra = new Set<number>();
  let rest = name;

  if (/^(ø|m7b5|mi7b5|min7b5)/.test(rest)) {
    third = 3; fifth = 6; extra.add(10);
    rest = rest.replace(/^(ø7?|m7b5|mi7b5|min7b5)/, '');
  } else if (/^(dim|o)/.test(rest)) {
    third = 3; fifth = 6;
    rest = rest.replace(/^(dim|o)/, '');
    if (/^7/.test(rest)) { extra.add(9); rest = rest.slice(1); }
  } else if (/^(aug|\+)/.test(rest)) {
    fifth = 8;
    rest = rest.replace(/^(aug|\+)/, '');
  } else if (/^(m|mi|min|-)(?!aj)/.test(rest)) {
    third = 3;
    rest = rest.replace(/^(min|mi|m|-)/, '');
  }

  if (/sus4|sus(?!2)/.test(rest)) third = 5;
  if (/sus2/.test(rest)) third = 2;
  if (/b5|-5/.test(rest)) fifth = 6;
  if (/#5|\+5/.test(rest)) fifth = 8;
  const isMaj = /maj|M7|M9|Δ|ma7/.test(rest);
  const ext = rest.replace(/maj|ma|M|Δ/g, '');
  if (/(^|[^d])13/.test(ext)) { extra.add(isMaj ? 11 : 10); extra.add(14); extra.add(21); }
  else if (/(^|[^d])11/.test(ext)) { extra.add(isMaj ? 11 : 10); extra.add(14); extra.add(17); }
  else if (/(^|[^d#b])9/.test(ext) && !/add9/.test(ext)) { extra.add(isMaj ? 11 : 10); extra.add(14); }
  else if (/7/.test(ext) && !/^o7/.test(ext)) extra.add(isMaj ? 11 : 10);
  if (/add9|add2|(^|[^us])2/.test(ext)) extra.add(14);
  if (/(^|[^1])6/.test(ext) && !/b6/.test(ext)) extra.add(9);
  if (/b9/.test(ext)) extra.add(13);
  if (/#9/.test(ext)) extra.add(15);
  if (/#11/.test(ext)) extra.add(18);
  if (/b13/.test(ext)) extra.add(20);
  return [...new Set([0, third, fifth, ...extra])].sort((a, b) => a - b);
}

/** 반주 음높이: 베이스 1음 + 가운데 음역 화음 */
export function voiceChord(sym: ChordSymbol): { bass: number; upper: number[] } | null {
  if (sym.root === undefined) return null;
  const rootPc = tpcToPc(sym.root);
  const bassPc = sym.bass !== undefined ? tpcToPc(sym.bass) : rootPc;
  const bass = 40 + (((bassPc - 40) % 12) + 12) % 12; // E2 ~ D#3
  const rootNote = 52 + (((rootPc - 52) % 12) + 12) % 12; // E3 ~ D#4
  const upper = chordIntervals(sym.name)
    .map((iv) => rootNote + (iv >= 12 ? iv - 12 : iv))
    .map((p) => (p > 67 ? p - 12 : p))
    .filter((p) => p !== bass)
    .filter((p, i, a) => a.indexOf(p) === i)
    .sort((a, b) => a - b);
  return { bass, upper };
}

/**
 * 코드 기호로 반주 음표를 만든다. staff 는 실제 보표 뒤의 가상 번호를 쓴다.
 * 코드는 다음 코드가 나올 때까지 이어지고, 마디마다 첫 박에서 다시 친다.
 */
export function accompanimentNotes(score: Score, staff: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  // 같은 위치의 코드가 여러 보표에 있으면 하나만
  const byTick = new Map<number, ChordSymbol>();
  for (const c of score.chords) if (c.root !== undefined && !byTick.has(c.tick)) byTick.set(c.tick, c);
  const chords = [...byTick.values()].sort((a, b) => a.tick - b.tick);
  if (chords.length === 0) return out;
  let id = 1_000_000;
  let current: ChordSymbol | null = null;
  let ci = 0;
  for (const m of score.measures) {
    const end = m.tick + m.length;
    // 마디 시작 시점에 울리는 코드 (앞 마디에서 이어짐)
    const starts: { tick: number; chord: ChordSymbol }[] = [];
    while (ci < chords.length && chords[ci].tick < end) {
      if (chords[ci].tick <= m.tick) current = chords[ci];
      else starts.push({ tick: chords[ci].tick, chord: chords[ci] });
      ci++;
    }
    const segs: { tick: number; chord: ChordSymbol }[] = [];
    if (current && (starts.length === 0 || starts[0].tick > m.tick)) segs.push({ tick: m.tick, chord: current });
    segs.push(...starts);
    if (starts.length) current = starts[starts.length - 1].chord;
    segs.forEach((sg, k) => {
      const segEnd = k + 1 < segs.length ? segs[k + 1].tick : end;
      const v = voiceChord(sg.chord);
      if (!v) return;
      const chordId = ++id;
      for (const pitch of [v.bass, ...v.upper]) {
        out.push({
          tick: sg.tick, duration: segEnd - sg.tick, pitch, measure: m.index, staff, voice: 0,
          chordId, durationType: 'quarter', dots: 0, tieToNext: false, tieFromPrev: false, lyrics: [],
        });
      }
    });
  }
  return out;
}
