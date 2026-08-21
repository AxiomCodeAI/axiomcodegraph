import * as crypto from 'crypto';
import * as fs from 'fs';

import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

function emit(file: string): string {
  const ex = new PythonFactExtractor().extract({
    sourceCode: fs.readFileSync(file, 'utf8'),
    filePath: file,
    baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_test',
  });
  // Every relation, in export order — this is what must be byte-identical.
  const parts: string[] = [];
  if (ex.module) parts.push(ex.module.toCsv());
  ex.scopes.forEach(r => parts.push(r.toCsv()));
  ex.bindings.forEach(r => parts.push(r.toCsv()));
  ex.types.forEach(r => parts.push(r.toCsv()));
  ex.typeBases.forEach(r => parts.push(r.toCsv()));
  ex.methods.forEach(r => parts.push(r.toCsv()));
  ex.methodParameters.forEach(r => parts.push(r.toCsv()));
  ex.imports.forEach(r => parts.push(r.toCsv()));
  ex.expressions.forEach(r => parts.push(r.toCsv()));
  ex.callSites.forEach(r => parts.push(r.toCsv()));
  ex.typeReferences.forEach(r => parts.push(r.toCsv()));
  ex.fields.forEach(r => parts.push(r.toCsv()));
  ex.fieldPositions.forEach(r => parts.push(r.toCsv()));
  return parts.join('\n') + '\n';
}

const args = process.argv.slice(2);
// Defaulting to zero files made this report "all 0 byte-identical", which is a
// pass that proves nothing. A run with no files is now an error.
const files = args;
if (files.length === 0) {
  console.error('determinism: no files given — a zero-file run is not evidence');
  process.exit(1);
}
let bad = 0;
for (const f of files) {
  // Fresh extractor instances, separate passes — this is the run-to-run check.
  const a = emit(f);
  const b = emit(f);
  const ha = crypto.createHash('md5').update(a).digest('hex');
  const hb = crypto.createHash('md5').update(b).digest('hex');
  const ok = ha === hb;
  if (!ok) bad++;
  console.log(`${ok ? 'IDENTICAL' : 'DIVERGED  '} ${ha}  ${f.split('/').pop()}`);
}
console.log(bad === 0 ? `\nall ${files.length} byte-identical across runs` : `\n${bad} DIVERGED`);
process.exit(bad === 0 ? 0 : 1);
