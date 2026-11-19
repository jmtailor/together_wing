/** 화면 테마: 자동(휴대폰 설정 따름) → 밝게 → 어둡게 차례로 바뀐다. 이 기기에 저장. */
type Theme = 'auto' | 'light' | 'dark';
const LABEL: Record<Theme, string> = { auto: '◐ 자동', light: '☀ 밝게', dark: '☾ 어둡게' };
const NEXT: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' };

export function initTheme(btn: HTMLButtonElement) {
  let theme: Theme = 'auto';
  try {
    const t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') theme = t;
  } catch { /* 저장 불가 */ }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const media = matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    btn.textContent = LABEL[theme];
    btn.setAttribute('aria-label', `화면 테마: ${LABEL[theme].slice(2)}`);
    const dark = theme === 'dark' || (theme === 'auto' && media.matches);
    meta?.setAttribute('content', dark ? '#101114' : '#f4f4f1');
  };
  btn.addEventListener('click', () => {
    theme = NEXT[theme];
    try {
      if (theme === 'auto') localStorage.removeItem('theme');
      else localStorage.setItem('theme', theme);
    } catch { /* 저장 불가 */ }
    apply();
  });
  media.addEventListener('change', apply);
  apply();
}
