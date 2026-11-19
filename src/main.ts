import { loadScore } from './core/mscz';
import type { Score } from './core/types';
import { renderScore } from './render/renderScore';
import { mountPractice } from './ui/practice';
import { scoreReport } from './report/scoreReport';
import { renderMarkdown } from './ui/markdown';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const input = $<HTMLInputElement>('#file');
const out = $('#out');
const titleEl = $('#title');
const metaEl = $('#meta');
const songformCard = $('#songform-card');
const songform = $<HTMLTextAreaElement>('#songform');
const refInput = metaEl.querySelector<HTMLInputElement>('[data-k="reference"]')!;
const practiceRoot = $('#practice');
const extras = $('#extras');
const transportBar = $('#transport-bar');
let unmount: (() => void) | null = null;
let fitObserver: ResizeObserver | null = null;

/** 악보 칸에 보이는 보표 수 */
const VISIBLE_STAVES = 4;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 송폼·레퍼런스는 곡마다 이 기기에 저장 (악보 파일에는 쓰지 않음)
const store = {
  get(k: string) {
    try { return localStorage.getItem(k) ?? ''; } catch { return ''; }
  },
  set(k: string, v: string) {
    try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경은 무시 */ }
  },
};
let songKey = '';
songform.addEventListener('input', () => songKey && store.set(`songform:${songKey}`, songform.value));
refInput.addEventListener('input', () => songKey && store.set(`reference:${songKey}`, refInput.value));

function fillInfo(name: string, score: Score) {
  songKey = score.title || name;
  titleEl.textContent = score.title || name;
  const set = (k: string, v: string) => (metaEl.querySelector<HTMLElement>(`[data-k="${k}"]`)!.textContent = v || '-');
  set('lyricist', score.lyricist);
  set('composer', score.composer);
  const bpm = Math.round(score.tempos[0]?.bpm ?? 120);
  set('tempo', `♩=${bpm}`);
  refInput.value = store.get(`reference:${songKey}`) || score.reference;
  songform.value = store.get(`songform:${songKey}`);
  metaEl.hidden = false;
  songformCard.hidden = false;
}

/** 악보 칸 높이를 보표 4개(= 4 ÷ 보표 수 만큼의 줄)에 맞춘다 */
function fitStage(staffCount: number) {
  const first = out.querySelector<HTMLElement>('.system');
  if (!first) return;
  const systems = Math.max(1, Math.round(VISIBLE_STAVES / Math.max(1, staffCount)));
  out.style.height = `${Math.ceil(first.getBoundingClientRect().height * systems)}px`;
}

async function show(name: string, score: Score) {
  fillInfo(name, score);
  out.scrollTop = 0;
  out.classList.add('loaded');
  out.innerHTML = `
    <section id="sheet" class="sheet" aria-label="악보"></section>
    <details class="report"><summary>파일 점검 결과 보기</summary><div id="report"></div></details>`;
  // 악보 글꼴(Bravura)이 준비된 뒤에 그려야 기호가 제자리에 나온다
  await document.fonts.ready;
  const sheet = $('#sheet');
  const rendered = renderScore(sheet, score);
  fitObserver?.disconnect();
  fitObserver = new ResizeObserver(() => fitStage(score.staffClefs.length));
  fitObserver.observe(sheet);
  fitStage(score.staffClefs.length);

  unmount?.();
  practiceRoot.hidden = false;
  unmount = mountPractice(practiceRoot, score, rendered);
  // 재생 막대는 화면 맨 아래에 따로 고정
  transportBar.replaceChildren(...practiceRoot.querySelectorAll('.transport, .t-status'));
  transportBar.hidden = false;
  extras.hidden = false;
  $('#report').innerHTML = renderMarkdown(scoreReport(name, score));
}

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;
  out.innerHTML = '<p class="empty">읽는 중…</p>';
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    await show(file.name, loadScore(file.name, data));
  } catch (err) {
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    out.innerHTML = `<p class="error">이 파일을 읽지 못했습니다: ${esc(msg)}</p>`;
  } finally {
    input.value = '';
  }
});
