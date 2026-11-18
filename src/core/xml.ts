import { DOMParser } from '@xmldom/xmldom';

/** 최소한의 DOM 요소 인터페이스 (xmldom / 브라우저 DOM 공통) */
export interface XEl {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<XEl>;
  getAttribute(name: string): string | null;
}

export function parseXml(text: string): XEl {
  const doc = new DOMParser().parseFromString(text, 'text/xml') as unknown as {
    documentElement: XEl | null;
  };
  if (!doc.documentElement) throw new Error('XML 문서를 읽을 수 없습니다');
  return doc.documentElement;
}

export function kids(el: XEl, name?: string): XEl[] {
  const out: XEl[] = [];
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.nodeType === 1 && (name === undefined || n.nodeName === name)) out.push(n);
  }
  return out;
}

export function kid(el: XEl, name: string): XEl | undefined {
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.nodeType === 1 && n.nodeName === name) return n;
  }
  return undefined;
}

/** 자식 요소의 텍스트 (태그 안의 서식 태그는 무시하고 글자만) */
export function childText(el: XEl, name: string): string | undefined {
  const c = kid(el, name);
  return c ? (c.textContent ?? '') : undefined;
}

export function childNum(el: XEl, name: string): number | undefined {
  const t = childText(el, name);
  if (t === undefined || t.trim() === '') return undefined;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

export function has(el: XEl, name: string): boolean {
  return kid(el, name) !== undefined;
}

/** "3/8", "-1/4" 같은 분수를 온음표 단위 비율로 */
export function parseFraction(s: string | undefined | null): number {
  if (!s) return 0;
  const m = s.trim().match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}
