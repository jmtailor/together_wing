/**
 * 연습 화면: 재생 막대(재생·정지·템포·위치), 파트 믹서(음량·뮤트·솔로), 악보 위 재생 커서.
 */
import { Player } from '../audio/player';
import type { Score } from '../core/types';
import type { RenderedScore } from '../render/renderScore';
import type { Timeline } from '../core/timeline';

/** 연습 화면 손잡이: 호출하면 정리, seek로 위치 이동. 위치가 바뀔 때마다 root에 'practice:time'(detail=초) 이벤트 */
export type PracticeHandle = (() => void) & { seek(t: number): void; timeline: Timeline };

const SVG_NS = 'http://www.w3.org/2000/svg';
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function mountPractice(root: HTMLElement, score: Score, rendered: RenderedScore): PracticeHandle {
  const player = new Player(score);
  const tl = player.timeline;
  const baseBpm = Math.round(score.tempos[0]?.bpm ?? 120);
  // 40~180 BPM, 느린 곡도 원래 템포의 200%까지 올릴 수 있게
  const minBpm = Math.min(40, baseBpm);
  const maxBpm = Math.max(180, baseBpm * 2);

  root.innerHTML = `
    <div class="mixer">
      ${player.channels
        .map(
          (c, i) => `
        <div class="ch" data-ch="${i}">
          <span class="ch-name">${esc(c.name)}</span>
          <button class="ch-m" aria-pressed="false" title="이 파트 끄기">M</button>
          <button class="ch-s" aria-pressed="false" title="이 파트만 듣기">S</button>
          <input class="ch-v" type="range" min="0" max="100" value="${Math.round(c.volume * 100)}" aria-label="${esc(c.name)} 음량" />
          <span class="ch-vv">${Math.round(c.volume * 100)}</span>
        </div>`,
        )
        .join('')}
      <div class="ch metro">
        <span class="ch-name">메트로놈</span>
        <button class="mt-on" aria-pressed="${player.metronome.on}" title="메트로놈 켜기/끄기">${player.metronome.on ? 'ON' : 'OFF'}</button>
        <button class="mt-ci" aria-pressed="${player.countIn}" title="시작 전 4박 카운트">카운트</button>
        <input class="mt-v" type="range" min="0" max="100" value="${Math.round(player.metronome.volume * 100)}" aria-label="메트로놈 음량" />
        <span class="ch-vv mt-vv">${Math.round(player.metronome.volume * 100)}</span>
      </div>
      <div class="ch tempo">
        <span class="ch-name">템포</span>
        <button class="tp-dn" aria-label="템포 내리기">−</button>
        <input class="tempo-r" type="range" min="${minBpm}" max="${maxBpm}" step="1" value="${baseBpm}" aria-label="재생 속도 (BPM)" />
        <button class="tp-up" aria-label="템포 올리기">+</button>
        <div class="tempo-sub">
          <label class="tempo-l">♩=<input class="tempo-n" type="number" inputmode="numeric" min="${minBpm}" max="${maxBpm}" step="1" value="${baseBpm}" aria-label="BPM 직접 입력" /></label>
          <span class="tempo-v">100%</span>
          <button class="tp-reset" title="악보 템포로 (♩=${baseBpm})">원래대로 ${baseBpm}</button>
        </div>
      </div>
    </div>
    <div class="transport">
      <button class="t-mix" aria-pressed="true">믹서</button>
      <button class="t-stop" aria-label="처음으로">⏮</button>
      <input class="t-seek" type="range" min="0" max="${Math.ceil(tl.totalTime * 10)}" value="0" aria-label="재생 위치" />
      <span class="t-time">0:00 / ${fmt(tl.totalTime)}</span>
      <button class="t-play" aria-label="재생">▶</button>
    </div>
    <p class="t-status" hidden></p>`;

  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const playBtn = $<HTMLButtonElement>('.t-play');
  const seek = $<HTMLInputElement>('.t-seek');
  const timeEl = $<HTMLSpanElement>('.t-time');
  const status = $<HTMLParagraphElement>('.t-status');
  const mixer = $<HTMLDivElement>('.mixer');

  // 각 줄(SVG)에 커서 막대와 마디 강조 칸을 하나씩 준비
  const cursors = rendered.systems.map((svg) => {
    const hl = document.createElementNS(SVG_NS, 'rect');
    hl.setAttribute('class', 'measure-hl');
    hl.setAttribute('visibility', 'hidden');
    const line = document.createElementNS(SVG_NS, 'rect');
    line.setAttribute('class', 'cursor');
    line.setAttribute('width', '3');
    line.setAttribute('visibility', 'hidden');
    svg.insertBefore(hl, svg.firstChild);
    svg.appendChild(line);
    return { hl, line };
  });
  let lastSystem = -1;

  function locate(t: number) {
    // 지금 시각이 펼친 순서의 몇 번째 마디인지 (이진 탐색)
    const ms = tl.measures;
    let lo = 0;
    let hi = ms.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ms[mid].time <= t) lo = mid;
      else hi = mid - 1;
    }
    return ms[lo];
  }

  function drawCursor(t: number) {
    root.dispatchEvent(new CustomEvent('practice:time', { detail: t }));
    if (!tl.measures.length) return;
    const pm = locate(t);
    const box = rendered.measureBoxes[pm.measure];
    if (!box) return;
    const m = score.measures[pm.measure];
    const frac = pm.duration > 0 ? Math.min(1, Math.max(0, (t - pm.time) / pm.duration)) : 0;
    const tick = frac * m.length;
    // 음표 위치를 따라가며 사이를 이어 준다
    const pts = [{ tick: 0, x: box.noteStartX }, ...box.ticks.filter((p) => p.tick > 0), { tick: m.length, x: box.noteEndX }];
    if (box.ticks[0]?.tick === 0) pts[0].x = box.ticks[0].x;
    let x = box.noteStartX;
    for (let i = 0; i < pts.length - 1; i++) {
      if (tick >= pts[i].tick && tick <= pts[i + 1].tick) {
        const f = (tick - pts[i].tick) / Math.max(1, pts[i + 1].tick - pts[i].tick);
        x = pts[i].x + f * (pts[i + 1].x - pts[i].x);
        break;
      }
    }
    cursors.forEach((c, i) => {
      const on = i === box.system;
      c.line.setAttribute('visibility', on ? 'visible' : 'hidden');
      c.hl.setAttribute('visibility', on ? 'visible' : 'hidden');
    });
    const c = cursors[box.system];
    c.line.setAttribute('x', String(x - 1));
    c.line.setAttribute('y', String(box.top));
    c.line.setAttribute('height', String(box.bottom - box.top));
    c.hl.setAttribute('x', String(box.x));
    c.hl.setAttribute('y', String(box.top));
    c.hl.setAttribute('width', String(box.width));
    c.hl.setAttribute('height', String(box.bottom - box.top));
    if (box.system !== lastSystem && player.playing) {
      // 악보 칸(스크롤 프레임) 안에서 지금 줄이 보이도록 넘긴다
      const svg = rendered.systems[box.system];
      const frame = svg.closest<HTMLElement>('.stage');
      const target = svg.closest<HTMLElement>('.system') ?? svg;
      const r = target.getBoundingClientRect();
      const f = frame?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
      if (r.top < f.top + 8 || r.bottom > f.bottom - 8) {
        (frame ?? window).scrollBy({ top: r.top - f.top, behavior: 'smooth' });
      }
    }
    lastSystem = box.system;
  }

  function refresh() {
    const t = player.position();
    playBtn.textContent = player.playing ? '⏸' : '▶';
    playBtn.setAttribute('aria-label', player.playing ? '일시정지' : '재생');
    const cd = player.countdown();
    timeEl.textContent = cd > 0 ? `카운트 ${5 - cd} …` : `${fmt(t / player.rate)} / ${fmt(tl.totalTime / player.rate)}`;
    timeEl.classList.toggle('counting', cd > 0);
    if (document.activeElement !== seek) seek.value = String(Math.round(t * 10));
    drawCursor(t);
  }

  let raf = 0;
  const loop = () => {
    refresh();
    raf = player.playing ? requestAnimationFrame(loop) : 0;
  };
  player.onChange(() => {
    if (!raf) raf = requestAnimationFrame(loop);
  });

  playBtn.addEventListener('click', async () => {
    if (player.playing) {
      player.pause();
      return;
    }
    try {
      status.hidden = false;
      status.textContent = '피아노 소리를 준비하는 중…';
      await player.ensureAudio((d, n) => (status.textContent = `피아노 소리를 준비하는 중… ${d}/${n}`));
      status.hidden = true;
      player.play();
    } catch (e) {
      status.hidden = false;
      status.textContent = e instanceof Error ? e.message : String(e);
    }
  });
  $<HTMLButtonElement>('.t-stop').addEventListener('click', () => player.stop());
  seek.addEventListener('input', () => {
    drawCursor(Number(seek.value) / 10);
  });
  seek.addEventListener('change', () => player.seek(Number(seek.value) / 10));
  $<HTMLButtonElement>('.t-mix').addEventListener('click', (ev) => {
    mixer.hidden = !mixer.hidden;
    (ev.currentTarget as HTMLElement).setAttribute('aria-pressed', String(!mixer.hidden));
  });

  root.querySelectorAll<HTMLDivElement>('.ch[data-ch]').forEach((row) => {
    const i = Number(row.dataset.ch);
    const ch = player.channels[i];
    const m = row.querySelector<HTMLButtonElement>('.ch-m')!;
    const s = row.querySelector<HTMLButtonElement>('.ch-s')!;
    const v = row.querySelector<HTMLInputElement>('.ch-v')!;
    const vv = row.querySelector<HTMLSpanElement>('.ch-vv')!;
    m.addEventListener('click', () => {
      ch.muted = !ch.muted;
      m.setAttribute('aria-pressed', String(ch.muted));
      player.applyMix();
    });
    s.addEventListener('click', () => {
      ch.solo = !ch.solo;
      s.setAttribute('aria-pressed', String(ch.solo));
      player.applyMix();
    });
    v.addEventListener('input', () => {
      ch.volume = Number(v.value) / 100;
      vv.textContent = v.value;
      player.applyMix();
    });
  });

  const tempo = $<HTMLInputElement>('.tempo-r');
  const tempoN = $<HTMLInputElement>('.tempo-n');
  const tempoV = $<HTMLSpanElement>('.tempo-v');
  const clampBpm = (b: number) => Math.min(maxBpm, Math.max(minBpm, Math.round(b)));
  const showBpm = (b: number) => {
    tempo.value = String(b);
    if (document.activeElement !== tempoN) tempoN.value = String(b);
    tempoV.textContent = `${Math.round((b / baseBpm) * 100)}%`;
  };
  const setBpm = (b: number) => {
    const bpm = clampBpm(b);
    showBpm(bpm);
    tempoN.value = String(bpm);
    if (Math.abs(player.rate - bpm / baseBpm) > 1e-9) player.setRate(bpm / baseBpm);
  };
  tempo.addEventListener('input', () => showBpm(Number(tempo.value)));
  tempo.addEventListener('change', () => setBpm(Number(tempo.value)));
  tempoN.addEventListener('change', () => {
    const v = Number(tempoN.value);
    setBpm(Number.isFinite(v) && tempoN.value.trim() !== '' ? v : player.rate * baseBpm);
  });
  tempoN.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') tempoN.blur();
  });
  tempoN.addEventListener('focus', () => tempoN.select());
  $<HTMLButtonElement>('.tp-dn').addEventListener('click', () => setBpm(Math.round(player.rate * baseBpm) - 5));
  $<HTMLButtonElement>('.tp-up').addEventListener('click', () => setBpm(Math.round(player.rate * baseBpm) + 5));
  $<HTMLButtonElement>('.tp-reset').addEventListener('click', () => setBpm(baseBpm));

  // 메트로놈: 켜기/끄기, 시작 전 카운트, 음량
  const mtOn = $<HTMLButtonElement>('.mt-on');
  const mtCi = $<HTMLButtonElement>('.mt-ci');
  const mtV = $<HTMLInputElement>('.mt-v');
  const mtVv = $<HTMLSpanElement>('.mt-vv');
  mtOn.addEventListener('click', () => {
    player.metronome.on = !player.metronome.on;
    mtOn.setAttribute('aria-pressed', String(player.metronome.on));
    mtOn.textContent = player.metronome.on ? 'ON' : 'OFF';
    player.applyMix();
  });
  mtCi.addEventListener('click', () => {
    player.countIn = !player.countIn;
    mtCi.setAttribute('aria-pressed', String(player.countIn));
  });
  mtV.addEventListener('input', () => {
    player.metronome.volume = Number(mtV.value) / 100;
    mtVv.textContent = mtV.value;
    player.applyMix();
  });

  // 악보의 마디를 누르면 그 마디부터 (지금 위치 이후 처음 나오는 차례로)
  rendered.systems.forEach((svg, si) => {
    svg.addEventListener('click', (ev) => {
      const r = svg.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * rendered.systemWidth;
      const mi = rendered.measureBoxes.findIndex((b) => b && b.system === si && x >= b.x && x < b.x + b.width);
      if (mi < 0) return;
      const now = player.position();
      const occ = tl.measures.filter((pm) => pm.measure === mi);
      if (!occ.length) return;
      const next = occ.find((pm) => pm.time > now + 0.01) ?? occ[0];
      player.seek(next.time);
      drawCursor(next.time);
    });
  });

  drawCursor(0);
  const unmount = () => {
    player.pause();
    cancelAnimationFrame(raf);
  };
  return Object.assign(unmount, {
    seek(t: number) {
      player.seek(t);
      drawCursor(t);
    },
    timeline: tl,
  });
}
