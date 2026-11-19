/**
 * 송폼 카드: 구간 이름을 버튼으로 보여 주고, 재생 중인 구간을 밝게 표시한다.
 * 버튼을 누르면 그 구간으로 이동. ✎로 직접 고쳐 쓸 수 있다 (곡마다 이 기기에 저장).
 */
import type { Score } from '../core/types';
import type { PracticeHandle } from './practice';

export interface Section {
  label: string;
  time: number;
}

/** 재생 순서대로 펼친 마디에서 연습 기호(Intro, Verse, PC …)가 나올 때마다 구간을 나눈다 */
export function playedSections(score: Score, tl: PracticeHandle['timeline']): Section[] {
  const markAt = new Map<number, string>();
  for (const m of score.marks) if (m.kind === 'rehearsal' && m.text.trim()) markAt.set(m.measure, m.text.trim());
  const out: Section[] = [];
  tl.measures.forEach((pm, i) => {
    const label = markAt.get(pm.measure);
    if (label) out.push({ label, time: pm.time });
    else if (i === 0) out.push({ label: '시작', time: pm.time });
  });
  return out;
}

/** "Intro - V1 - PC, C" 같은 글을 구간 이름 목록으로 */
export function splitForm(text: string): string[] {
  let parts = text.split(/\s*(?:[-–—,>→|·/]|\n)\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1 && /\s/.test(parts[0])) parts = parts[0].split(/\s+/);
  return parts;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s.]/g, '');
const similar = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return x === y || x.startsWith(y) || y.startsWith(x) || x.replace(/\d+$/, '') === y.replace(/\d+$/, '') || x[0] === y[0];
};

/** 적은 송폼 이름마다 실제 구간을 짝지음: 개수가 같으면 차례대로, 다르면 비슷한 이름을 앞에서부터 찾음 */
export function matchSections(names: string[], sections: Section[]): (number | null)[] {
  if (names.length === sections.length) return names.map((_, i) => i);
  let from = 0;
  return names.map((n) => {
    for (let i = from; i < sections.length; i++) {
      if (similar(n, sections[i].label)) {
        from = i + 1;
        return i;
      }
    }
    return null;
  });
}

export function mountSongform(card: HTMLElement, key: string, score: Score, practice: PracticeHandle, practiceRoot: HTMLElement) {
  const sections = playedSections(score, practice.timeline);
  const storeKey = `songform:${key}`;
  const read = () => {
    try { return localStorage.getItem(storeKey) ?? ''; } catch { return ''; }
  };
  const write = (v: string) => {
    try { if (v.trim()) localStorage.setItem(storeKey, v); else localStorage.removeItem(storeKey); } catch { /* 저장 불가 */ }
  };
  const auto = sections.map((s) => s.label).join(' - ');

  card.innerHTML = `
    <div class="card-head">
      <span class="card-label">송폼</span>
      <button class="sf-edit" type="button" aria-pressed="false" title="송폼 고치기">✎ 고치기</button>
    </div>
    <div class="sf-chips" role="list"></div>
    <textarea class="sf-text" rows="2" hidden placeholder="예: Intro - V1 - PC - C - Int - V2 - PC - C - B - C - Outro"></textarea>`;
  const chipsEl = card.querySelector<HTMLDivElement>('.sf-chips')!;
  const text = card.querySelector<HTMLTextAreaElement>('.sf-text')!;
  const edit = card.querySelector<HTMLButtonElement>('.sf-edit')!;
  let chips: { el: HTMLButtonElement; section: number | null }[] = [];
  let active = -1;

  function build() {
    const value = read() || auto;
    const names = splitForm(value);
    const map = matchSections(names, sections);
    chipsEl.replaceChildren();
    chips = names.map((n, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'sf-chip';
      el.textContent = n;
      el.setAttribute('role', 'listitem');
      const section = map[i];
      if (section == null) el.disabled = true;
      else el.addEventListener('click', () => practice.seek(sections[section].time));
      chipsEl.appendChild(el);
      return { el, section };
    });
    if (!names.length) chipsEl.innerHTML = '<span class="muted">이 악보에는 구간 표시가 없어요. ✎로 직접 적어 주세요.</span>';
    active = -1;
  }

  function highlight(t: number) {
    let cur = -1;
    for (let i = 0; i < sections.length; i++) if (sections[i].time <= t + 1e-6) cur = i;
    if (cur === active) return;
    active = cur;
    for (const c of chips) {
      const on = c.section === cur;
      c.el.classList.toggle('on', on);
      if (on) c.el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }

  edit.addEventListener('click', () => {
    const editing = text.hidden;
    if (editing) {
      text.value = read() || auto;
      text.hidden = false;
      chipsEl.hidden = true;
      edit.textContent = '완료';
      text.focus();
    } else {
      write(text.value.trim() === auto ? '' : text.value);
      text.hidden = true;
      chipsEl.hidden = false;
      edit.textContent = '✎ 고치기';
      build();
      const t = lastT;
      highlight(t);
    }
    edit.setAttribute('aria-pressed', String(editing));
  });

  let lastT = 0;
  const onTime = (e: Event) => {
    lastT = (e as CustomEvent<number>).detail;
    highlight(lastT);
  };
  practiceRoot.addEventListener('practice:time', onTime);
  build();
  highlight(0);
  card.hidden = false;
  return () => practiceRoot.removeEventListener('practice:time', onTime);
}
