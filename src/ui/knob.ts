/**
 * 원형 노브. 좌우로 끌면 값이 바뀌고(오른쪽·위로 = 올림), 위아래로 쓸면 화면이 그대로 스크롤된다.
 * (touch-action: pan-y 라서 세로 쓸기는 브라우저가 스크롤로 가져가고 노브는 손대지 않는다)
 * 두 번 톡톡 누르면 기본값으로 돌아간다.
 */
const START = 135; // 왼쪽 아래에서 시작해 오른쪽 아래까지 270도
const SWEEP = 270;

export interface KnobOptions {
  min: number;
  max: number;
  step?: number;
  value: number;
  /** 두 번 눌렀을 때 돌아갈 값 */
  defaultValue?: number;
  label: string;
  /** 가운데 글자 */
  format?: (v: number) => string;
  /** 끄는 동안 계속 */
  onInput?: (v: number) => void;
  /** 손을 뗐을 때 (또는 키보드로 바꿨을 때) */
  onChange?: (v: number) => void;
}

export interface Knob {
  el: HTMLDivElement;
  get value(): number;
  set value(v: number);
  /** 꺼진 것처럼 흐리게 */
  setDimmed(d: boolean): void;
}

function arcPath(r: number, a0: number, a1: number): string {
  const p = (a: number) => {
    const rad = (a * Math.PI) / 180;
    return `${(28 + r * Math.cos(rad)).toFixed(2)} ${(28 + r * Math.sin(rad)).toFixed(2)}`;
  };
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p(a0)} A ${r} ${r} 0 ${large} 1 ${p(a1)}`;
}

export function createKnob(o: KnobOptions): Knob {
  const step = o.step ?? 1;
  const fmt = o.format ?? ((v: number) => String(Math.round(v)));
  const el = document.createElement('div');
  el.className = 'knob';
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', o.label);
  el.setAttribute('aria-valuemin', String(o.min));
  el.setAttribute('aria-valuemax', String(o.max));
  el.innerHTML = `<svg viewBox="0 0 56 56" aria-hidden="true">
    <path class="knob-track" d="${arcPath(23, START, START + SWEEP)}" />
    <path class="knob-arc" />
    <line class="knob-tick" x1="28" y1="28" x2="28" y2="28" />
  </svg><span class="knob-v"></span>`;
  const arc = el.querySelector<SVGPathElement>('.knob-arc')!;
  const tick = el.querySelector<SVGLineElement>('.knob-tick')!;
  const text = el.querySelector<HTMLSpanElement>('.knob-v')!;

  let value = o.value;
  const clamp = (v: number) => Math.min(o.max, Math.max(o.min, Math.round(v / step) * step));
  const draw = () => {
    const f = (value - o.min) / (o.max - o.min || 1);
    const a = START + f * SWEEP;
    arc.setAttribute('d', f > 0.002 ? arcPath(23, START, a) : '');
    const rad = (a * Math.PI) / 180;
    tick.setAttribute('x1', (28 + 23 * Math.cos(rad)).toFixed(2));
    tick.setAttribute('y1', (28 + 23 * Math.sin(rad)).toFixed(2));
    tick.setAttribute('x2', (28 + 23 * Math.cos(rad)).toFixed(2));
    tick.setAttribute('y2', (28 + 23 * Math.sin(rad)).toFixed(2));
    text.textContent = fmt(value);
    el.setAttribute('aria-valuenow', String(value));
    el.setAttribute('aria-valuetext', fmt(value));
  };
  const set = (v: number, commit: boolean) => {
    const nv = clamp(v);
    if (nv !== value) {
      value = nv;
      draw();
      o.onInput?.(value);
    }
    if (commit) o.onChange?.(value);
  };
  draw();

  // 끌기: 160px 에 전체 범위. 좌우(→ 올림)와 마우스 위아래(↑ 올림)
  let drag: { id: number; x: number; y: number; v: number; moved: boolean } | null = null;
  let lastTap = 0;
  el.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, v: value, moved: false };
    el.setPointerCapture(ev.pointerId);
    el.classList.add('active');
  });
  el.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const dx = ev.clientX - drag.x;
    const dy = ev.pointerType === 'mouse' ? drag.y - ev.clientY : 0;
    const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    if (!drag.moved && Math.abs(d) < 4) return;
    drag.moved = true;
    set(drag.v + (d / 160) * (o.max - o.min), false);
  });
  const end = (ev: PointerEvent, cancelled: boolean) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    el.classList.remove('active');
    if (cancelled) {
      // 스크롤로 넘어갔으면 원래 값으로
      if (d.moved) set(d.v, true);
      return;
    }
    if (d.moved) {
      o.onChange?.(value);
      return;
    }
    const now = performance.now();
    if (now - lastTap < 350 && o.defaultValue !== undefined) {
      set(o.defaultValue, true);
      lastTap = 0;
    } else lastTap = now;
  };
  el.addEventListener('pointerup', (ev) => end(ev, false));
  el.addEventListener('pointercancel', (ev) => end(ev, true));
  el.addEventListener('keydown', (ev) => {
    const big = (o.max - o.min) / 10;
    const k: Record<string, number> = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: big, PageDown: -big };
    if (ev.key in k) {
      ev.preventDefault();
      set(value + k[ev.key], true);
    } else if (ev.key === 'Home') set(o.min, true);
    else if (ev.key === 'End') set(o.max, true);
  });

  return {
    el,
    get value() {
      return value;
    },
    set value(v: number) {
      value = clamp(v);
      draw();
    },
    setDimmed(dim: boolean) {
      el.classList.toggle('dim', dim);
    },
  };
}
