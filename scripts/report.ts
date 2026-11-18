/**
 * 악보 파일 검증 리포트: npm run report -- samples/*.mscz
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { loadScore } from '../src/core/mscz';
import { scoreReport } from '../src/report/scoreReport';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('사용법: npm run report -- <악보.mscz> [...]');
  process.exit(1);
}
console.log(files.map((f) => scoreReport(basename(f), loadScore(f, new Uint8Array(readFileSync(f))))).join('\n'));
