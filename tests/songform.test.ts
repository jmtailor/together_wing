import { describe, expect, it } from 'vitest';
import { matchSections, splitForm } from '../src/ui/songform';

describe('송폼', () => {
  it('구분 기호로 나눈다', () => {
    expect(splitForm('Intro - V1 - PC, C → Bridge')).toEqual(['Intro', 'V1', 'PC', 'C', 'Bridge']);
    expect(splitForm('Intro V1 PC')).toEqual(['Intro', 'V1', 'PC']);
  });
  it('개수가 같으면 차례대로, 다르면 비슷한 이름을 앞에서부터 짝짓는다', () => {
    const s = ['Intro', 'Verse', 'PC', 'Chorus'].map((label, i) => ({ label, time: i }));
    expect(matchSections(['A', 'B', 'C', 'D'], s)).toEqual([0, 1, 2, 3]);
    expect(matchSections(['Intro', 'V1', 'C'], s)).toEqual([0, 1, 3]);
    expect(matchSections(['Intro', 'X'], s)).toEqual([0, null]);
  });
});
