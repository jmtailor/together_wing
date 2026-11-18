import { loadScore } from './core/mscz';
import { scoreReport } from './report/scoreReport';
import { renderMarkdown } from './ui/markdown';

const input = document.querySelector<HTMLInputElement>('#file')!;
const out = document.querySelector<HTMLElement>('#out')!;

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;
  out.innerHTML = '<p>읽는 중…</p>';
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const score = loadScore(file.name, data);
    out.innerHTML = renderMarkdown(scoreReport(file.name, score));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    out.innerHTML = `<p class="error">이 파일을 읽지 못했습니다: ${msg.replace(/</g, '&lt;')}</p>`;
  } finally {
    input.value = '';
  }
});
