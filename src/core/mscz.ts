import { strFromU8, unzipSync } from 'fflate';
import { parseMscx } from './parseMscx';
import type { Score } from './types';
import { kid, kids, parseXml } from './xml';

/** .mscz(압축) 안에서 본 악보 .mscx 텍스트를 꺼낸다. 파트보(Excerpts)는 무시한다. */
export function extractMscx(data: Uint8Array): { path: string; text: string } {
  const files = unzipSync(data);
  let rootPath: string | undefined;
  const container = files['META-INF/container.xml'];
  if (container) {
    const root = parseXml(strFromU8(container));
    const rootfiles = kid(root, 'rootfiles');
    // 첫 번째 .mscx 가 본 악보, Excerpts/ 아래는 파트보
    const paths = rootfiles ? kids(rootfiles, 'rootfile').map((r) => r.getAttribute('full-path') ?? '') : [];
    rootPath = paths.find((p) => p.endsWith('.mscx') && !p.startsWith('Excerpts/'));
  }
  if (!rootPath || !files[rootPath]) {
    rootPath = Object.keys(files).find((p) => p.endsWith('.mscx') && !p.includes('/'));
  }
  if (!rootPath) throw new Error('.mscz 안에서 악보(.mscx)를 찾지 못했습니다');
  return { path: rootPath, text: strFromU8(files[rootPath]) };
}

/** 파일 이름을 보고 .mscz / .mscx 를 알아서 읽는다 */
export function loadScore(fileName: string, data: Uint8Array): Score {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.mscx')) return parseMscx(strFromU8(data));
  // zip 시그니처(PK)면 .mscz 로 본다
  if (data[0] === 0x50 && data[1] === 0x4b) return parseMscx(extractMscx(data).text);
  throw new Error('MuseScore 파일(.mscz 또는 .mscx)만 열 수 있습니다');
}
