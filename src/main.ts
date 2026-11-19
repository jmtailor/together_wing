import { loadScore } from './core/mscz';
import type { Score } from './core/types';
import { renderScore } from './render/renderScore';
import { mountPractice } from './ui/practice';
import { scoreReport } from './report/scoreReport';
import { renderMarkdown } from './ui/markdown';

const input = document.querySelector<HTMLInputElement>('#file')!;
const out = document.querySelector<HTMLElement>('#out')!;

const practiceRoot = document.querySelector<HTMLElement>('#practice')!;
let unmount: (() => void) | null = null;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function show(name: string, score: Score) {
  out.innerHTML = `
    <section class="score-head">
      <h2>${esc(score.title || name)}</h2>
      <p class="muted">${esc(score.composer)} · ${score.parts.map((p) => esc(p.name)).join(', ')}</p>
    </section>
    <section id="sheet" class="sheet" aria-label="악보"></section>
    <details class="report"><summary>파일 점검 결과 보기</summary><div id="report"></div></details>`;
  // 악보 글꼴(Bravura)이 준비된 뒤에 그려야 기호가 제자리에 나온다
  await document.fonts.ready;
  const rendered = renderScore(document.querySelector<HTMLElement>('#sheet')!, score);
  unmount?.();
  practiceRoot.hidden = false;
  unmount = mountPractice(practiceRoot, score, rendered);
  document.querySelector<HTMLElement>('#report')!.innerHTML = renderMarkdown(scoreReport(name, score));
}

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;
  out.innerHTML = '<p>읽는 중…</p>';
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
