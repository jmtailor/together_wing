/** 4분음표 하나의 tick 수 (MuseScore 기본값). 파일의 <Division> 값을 따른다. */
export type Ticks = number;

export interface Lyric {
  /** 0부터 시작하는 절 번호 (MuseScore <no>) */
  verse: number;
  text: string;
  syllabic?: 'single' | 'begin' | 'middle' | 'end';
}

export interface NoteEvent {
  /** 악보 기준 절대 tick (반복 전개 전) */
  tick: Ticks;
  duration: Ticks;
  /** MIDI 음높이 (실음, concert pitch) */
  pitch: number;
  /** 0부터 시작하는 마디 번호 */
  measure: number;
  staff: number;
  voice: number;
  tieToNext: boolean;
  tieFromPrev: boolean;
  /** 같은 화음(Chord) 안에서 첫 음표에만 가사를 붙인다 */
  lyrics: Lyric[];
}

export interface RestEvent {
  tick: Ticks;
  duration: Ticks;
  measure: number;
  staff: number;
  voice: number;
}

export interface TextMark {
  tick: Ticks;
  measure: number;
  kind: 'rehearsal' | 'staffText' | 'tempoText';
  text: string;
}

export interface Volta {
  /** 시작 마디 (0부터) */
  startMeasure: number;
  /** 끝 마디 (포함) */
  endMeasure: number;
  endings: number[];
  /** 닫힌 괄호(끝 갈고리 있음)인지 */
  closed: boolean;
  text: string;
}

export interface Jump {
  text: string;
  jumpTo: string;
  playUntil: string;
  continueAt: string;
  playRepeats: boolean;
}

export interface Marker {
  label: string;
  text: string;
  /** Fine, To Coda 처럼 마디 끝에 붙는 표지 */
  isRight: boolean;
}

export interface MeasureInfo {
  index: number;
  tick: Ticks;
  length: Ticks;
  timeSig: { n: number; d: number };
  /** 조표: 플랫이면 음수, 샵이면 양수 (concert key) */
  keySig: number;
  startRepeat: boolean;
  /** 끝 도돌이표 반복 횟수 (없으면 0) */
  endRepeat: number;
  jumps: Jump[];
  markers: Marker[];
  sectionBreak: boolean;
  lineBreak: boolean;
  /** 화면에 표시되는 마디 번호 (MuseScore 기준, 1부터) */
  number: number;
}

export interface TempoChange {
  tick: Ticks;
  bpm: number;
}

export interface Part {
  id: string;
  name: string;
  instrumentId: string;
  /** 이 파트에 속한 보표 번호들 (0부터) */
  staves: number[];
}

export interface Score {
  title: string;
  composer: string;
  museScoreVersion: string;
  programVersion: string;
  division: Ticks;
  parts: Part[];
  measures: MeasureInfo[];
  voltas: Volta[];
  tempos: TempoChange[];
  notes: NoteEvent[];
  rests: RestEvent[];
  marks: TextMark[];
  warnings: string[];
}
