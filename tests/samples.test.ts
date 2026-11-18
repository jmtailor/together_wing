import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadScore } from '../src/core/mscz';
import { buildTimeline } from '../src/core/timeline';

// 실제 팀 악보(저작권 때문에 저장소에 없음). samples/ 에 파일이 있을 때만 실행된다.
const dir = join(__dirname, '../samples');
const load = (name: string) => {
  const p = join(dir, name);
  return existsSync(p) ? loadScore(name, new Uint8Array(readFileSync(p))) : undefined;
};

const ireona = load('일어나BbSA.mscz');
describe.skipIf(!ireona)('일어나BbSA.mscz', () => {
  it('파트·마디·음표 수를 MuseScore 원본과 같게 읽는다', () => {
    const s = ireona!;
    expect(s.parts.map((p) => p.name)).toEqual(['Melody', '알토']);
    expect(s.measures).toHaveLength(81);
    expect(s.notes.filter((n) => n.staff === 0)).toHaveLength(274);
    expect(s.notes.filter((n) => n.staff === 1)).toHaveLength(136);
    expect(s.notes.filter((n) => n.staff === 0 && n.lyrics.length > 0)).toHaveLength(272);
    expect(s.measures[0].keySig).toBe(-2);
    expect(s.tempos[0].bpm).toBeCloseTo(152, 0);
  });
  it('MuseScore 재생 규칙으로 펼치면 D.C. 두 번을 처음(1마디)으로 간다', () => {
    const tl = buildTimeline(ireona!);
    const firsts = tl.measures.filter((m) => m.measure === 0).length;
    expect(firsts).toBe(3);
    expect(tl.measures).toHaveLength(30 + 46 + 50 + 35);
  });
});

const grace = load('내안에가장_은혜아니면DE_SA.mscz');
describe.skipIf(!grace)('내안에가장_은혜아니면DE_SA.mscz', () => {
  it('전조와 1·2번 괄호를 읽는다', () => {
    const s = grace!;
    expect(s.measures).toHaveLength(53);
    expect(s.measures[0].keySig).toBe(2);
    expect(s.measures[29].keySig).toBe(4);
    expect(s.voltas.map((v) => [v.startMeasure + 1, v.endings])).toEqual([[12, [1]], [13, [2]]]);
    expect(s.notes.flatMap((n) => n.lyrics).filter((l) => l.verse === 1)).toHaveLength(29);
  });
});
