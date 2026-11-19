import { describe, expect, it } from 'vitest';
import { chordIntervals, tpcToPc, voiceChord } from '../src/core/chords';

describe('코드 기호 해석', () => {
  it('TPC를 음높이 클래스로', () => {
    expect(tpcToPc(14)).toBe(0); // C
    expect(tpcToPc(12)).toBe(10); // Bb
    expect(tpcToPc(11)).toBe(3); // Eb
    expect(tpcToPc(21)).toBe(1); // C#
  });
  it.each([
    ['', [0, 4, 7]],
    ['m', [0, 3, 7]],
    ['7', [0, 4, 7, 10]],
    ['m7', [0, 3, 7, 10]],
    ['maj7', [0, 4, 7, 11]],
    ['add9', [0, 4, 7, 14]],
    ['sus4', [0, 5, 7]],
    ['(sus4)', [0, 5, 7]],
    ['7sus4', [0, 5, 7, 10]],
    ['m7(b5)', [0, 3, 6, 10]],
    ['m6', [0, 3, 7, 9]],
    ['dim', [0, 3, 6]],
    ['aug', [0, 4, 8]],
    ['9', [0, 4, 7, 10, 14]],
    ['2', [0, 4, 7, 14]],
  ])('%s', (name, expected) => {
    expect(chordIntervals(name)).toEqual(expected);
  });
  it('분수 코드는 베이스를 슬래시 음으로', () => {
    const v = voiceChord({ tick: 0, measure: 0, staff: 0, root: 12, bass: 16, name: '', text: 'Bb/D' })!;
    expect(v.bass % 12).toBe(2); // D
    expect(v.upper.map((p) => p % 12).sort()).toEqual([10, 2, 5].sort());
  });
});
