/**
 * 파서가 읽은 내용과 반복 전개 순서를 사람이 확인하기 쉬운 Markdown으로 만든다.
 * CLI(scripts/report.ts)와 웹 화면이 함께 쓴다.
 */
import { buildTimeline } from '../core/timeline';
import type { Score } from '../core/types';

const KEY_NAMES: Record<number, string> = {
  [-7]: 'C♭', [-6]: 'G♭', [-5]: 'D♭', [-4]: 'A♭', [-3]: 'E♭', [-2]: 'B♭', [-1]: 'F',
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F♯', 7: 'C♯',
};
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const pitchName = (p: number) => `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** 마디마다 각 성부의 음표+쉼표 길이 합이 마디 길이와 맞는지 */
function checkMeasureFill(score: Score): string[] {
  const sums = new Map<string, number>();
  const add = (staff: number, voice: number, measure: number, d: number) => {
    const k = `${staff}:${voice}:${measure}`;
    sums.set(k, (sums.get(k) ?? 0) + d);
  };
  const chordSeen = new Set<string>();
  for (const n of score.notes) {
    const ck = `${n.staff}:${n.voice}:${n.tick}`;
    if (chordSeen.has(ck)) continue; // 화음은 한 번만
    chordSeen.add(ck);
    add(n.staff, n.voice, n.measure, n.duration);
  }
  for (const r of score.rests) add(r.staff, r.voice, r.measure, r.duration);
  const problems: string[] = [];
  for (const [k, sum] of sums) {
    const [staff, voice, measure] = k.split(':').map(Number);
    const len = score.measures[measure].length;
    if (sum !== len && voice === 0) {
      problems.push(`보표 ${staff + 1} 마디 ${measure + 1}: 길이 합 ${sum} ≠ 마디 길이 ${len}`);
    }
  }
  return problems;
}

export function scoreReport(fileName: string, score: Score): string {
  const tl = buildTimeline(score);
  const L: string[] = [];
  L.push(`## ${fileName}`);
  L.push('');
  L.push(`- 제목: ${score.title} / 작곡: ${score.composer}`);
  L.push(`- MuseScore ${score.programVersion} (파일 형식 ${score.museScoreVersion}), Division ${score.division}`);
  L.push(`- 마디 수: ${score.measures.length}, 박자: ${[...new Set(score.measures.map((m) => `${m.timeSig.n}/${m.timeSig.d}`))].join(', ')}`);
  const keyChanges = score.measures.filter((m, i) => i === 0 || m.keySig !== score.measures[i - 1].keySig);
  L.push(`- 조성: ${keyChanges.map((m) => `${m.number}마디 ${KEY_NAMES[m.keySig] ?? m.keySig}장조`).join(' → ')}`);
  L.push(`- 템포: ${score.tempos.map((t) => `♩=${t.bpm}`).join(', ')}`);
  L.push(`- 펼친 연주 길이: ${tl.measures.length}마디, 약 ${fmtTime(tl.totalTime)}`);
  L.push('');
  L.push('### 파트');
  L.push('');
  L.push('| 파트 | 보표 | 음표 | 쉼표 | 가사(절별) | 음역 | 연주 음표(반복 포함) |');
  L.push('|---|---|---:|---:|---|---|---:|');
  for (const p of score.parts) {
    for (const st of p.staves) {
      const ns = score.notes.filter((n) => n.staff === st);
      const rs = score.rests.filter((r) => r.staff === st);
      const verses = new Map<number, number>();
      for (const n of ns) for (const l of n.lyrics) verses.set(l.verse, (verses.get(l.verse) ?? 0) + 1);
      const lyr = [...verses.entries()].sort().map(([v, c]) => `${v + 1}절 ${c}`).join(', ') || '-';
      const pitches = ns.map((n) => n.pitch);
      const range = pitches.length ? `${pitchName(Math.min(...pitches))}~${pitchName(Math.max(...pitches))}` : '-';
      const played = tl.notes.filter((n) => n.staff === st).length;
      L.push(`| ${p.name} | ${st + 1} | ${ns.length} | ${rs.length} | ${lyr} | ${range} | ${played} |`);
    }
  }
  L.push('');
  L.push('### 반복·점프 표기');
  L.push('');
  for (const m of score.measures) {
    const items: string[] = [];
    if (m.startRepeat) items.push('시작 도돌이표 |:');
    if (m.endRepeat) items.push(`끝 도돌이표 :| (${m.endRepeat}번 연주)`);
    for (const j of m.jumps) items.push(`점프 "${j.text}" (가는 곳=${j.jumpTo || '-'}, 까지=${j.playUntil || '-'}, 이어서=${j.continueAt || '-'}${j.playRepeats ? ', 반복 다시 연주' : ''})`);
    for (const mk of m.markers) items.push(`표지 "${mk.text || mk.label}"`);
    for (const v of score.voltas.filter((x) => x.startMeasure === m.index)) {
      items.push(`${v.endings.join(',')}번 괄호 (${v.startMeasure + 1}~${v.endMeasure + 1}마디)`);
    }
    const texts = score.marks.filter((x) => x.measure === m.index && x.kind !== 'tempoText').map((x) => `"${x.text}"`);
    if (items.length) L.push(`- ${m.number}마디: ${items.join(', ')}${texts.length ? ` / 글자: ${texts.join(' ')}` : ''}`);
  }
  L.push('');
  L.push('### 펼친 연주 순서 (MuseScore 재생 규칙)');
  L.push('');
  L.push('| 순서 | 마디 | 반복 회차 | 구간 표시 | 시작 시각 | 첫 가사 |');
  L.push('|---:|---|---:|---|---|---|');
  // 연속된 마디는 묶어서 보여준다
  const runs: { from: number; to: number; pass: number; start: number; startOrder: number }[] = [];
  for (const pm of tl.measures) {
    const last = runs[runs.length - 1];
    if (last && pm.measure === last.to + 1 && pm.playbackCount === last.pass) last.to = pm.measure;
    else runs.push({ from: pm.measure, to: pm.measure, pass: pm.playbackCount, start: pm.time, startOrder: pm.order });
  }
  runs.forEach((r, i) => {
    const labels = score.marks
      .filter((x) => x.kind === 'rehearsal' && x.measure >= r.from && x.measure <= r.to)
      .map((x) => `${x.text}(${score.measures[x.measure].number})`);
    const firstLyricNote = tl.notes.find((n) => n.staff === 0 && n.measure >= r.from && n.measure <= r.to && n.lyric && n.time >= r.start - 1e-6);
    const lyricLine = firstLyricNote
      ? tl.notes
          .filter((n) => n.staff === 0 && n.lyric && n.time >= firstLyricNote.time && n.measure <= r.to)
          .slice(0, 8)
          .map((n) => n.lyric!.text)
          .join('')
      : '';
    L.push(`| ${i + 1} | ${score.measures[r.from].number}~${score.measures[r.to].number} | ${r.pass} | ${labels.join(' ') || ''} | ${fmtTime(r.start)} | ${lyricLine} |`);
  });
  const problems = checkMeasureFill(score);
  L.push('');
  L.push('### 자동 점검');
  L.push('');
  L.push(`- 마디 길이 점검(1성부): ${problems.length === 0 ? '모든 마디 정상' : `${problems.length}건 확인 필요`}`);
  for (const p of problems.slice(0, 20)) L.push(`  - ${p}`);
  L.push(`- 파서 경고: ${score.warnings.length === 0 ? '없음' : score.warnings.join('; ')}`);
  L.push('');
  return L.join('\n');
}

