import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMscx } from '../src/core/parseMscx';
import { unrollRepeats } from '../src/core/unroll';

// MuseScore 공식 반복 테스트(repeat_tests.cpp)의 기대 결과와 비교한다.
// 데이터는 scripts/fetch-musescore-tests.sh 로 받는다. 없으면 건너뛴다.
const dir = join(__dirname, '../vendor/musescore/src/engraving/tests');
const cppPath = join(dir, 'repeat_tests.cpp');
const available = existsSync(cppPath);

function expectedCases(): { file: string; expected: string }[] {
  const src = readFileSync(cppPath, 'utf8');
  const re = /repeat\("([^"]+)",\s*u"([^"]*)"\)/g;
  const out: { file: string; expected: string }[] = [];
  for (let m = re.exec(src); m; m = re.exec(src)) out.push({ file: m[1], expected: m[2].replace(/\s/g, '') });
  return out;
}

describe.skipIf(!available)('MuseScore 반복 규칙 호환성', () => {
  const cases = available ? expectedCases() : [];
  it.each(cases)('$file', ({ file, expected }) => {
    const score = parseMscx(readFileSync(join(dir, 'repeat_data', file), 'utf8'));
    const seq = unrollRepeats(score.measures, score.voltas)
      .flatMap((sg) => sg.measures.map((m) => score.measures[m].number))
      .join(';');
    expect(seq).toBe(expected);
  });
});
