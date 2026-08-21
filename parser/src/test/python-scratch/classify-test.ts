/**
 * Direct assertion of typeCategory/typeModifier, which NEITHER gate covers:
 * the oracle emits no typeCategory field, so this class of bug is invisible to
 * both the symtable gate and the ast declaration differ (A2 finding
 * typeCategory_classification). Expectations are hand-derived from the language.
 */
import * as fs from 'fs';
import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const f = 'src/test/python-scratch/classify-input.py';
const facts = new PythonFactExtractor().extract({
  sourceCode: fs.readFileSync(f, 'utf8'), filePath: f, baseMservPath: '/repo',
  serviceVersionLinkHash: 'SERVICE_VERSION_test',
});

const expected: Record<string, { category: string; hasAbstract: boolean }> = {
  ClassicABC: { category: 'ABC_TYPE', hasAbstract: true },
  ClassicABC2: { category: 'ABC_TYPE', hasAbstract: true },
  FunctionalEnum: { category: 'ENUM_CLASS_TYPE', hasAbstract: false },
  RealABC: { category: 'ABC_TYPE', hasAbstract: true },
  RealEnum: { category: 'ENUM_CLASS_TYPE', hasAbstract: false },
  Plain: { category: 'CLASS_TYPE', hasAbstract: false },
  PlainWithMeta: { category: 'CLASS_TYPE', hasAbstract: false },
};

let failures = 0;
for (const t of facts.types) {
  const cols = t.toCsv().split('\t');
  const name = cols[0]!, category = cols[3]!, modifier = cols[5]!;
  const want = expected[name];
  if (!want) { console.log(`UNEXPECTED CLASS ${name}`); failures++; continue; }
  const hasAbstract = modifier.split(',').includes('ABSTRACT');
  const ok = category === want.category && hasAbstract === want.hasAbstract;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(16)} category=${category.padEnd(18)} modifier=${modifier || '-'}`);
  // Internal consistency: ABSTRACT must never coexist with a plain CLASS_TYPE.
  if (hasAbstract && category === 'CLASS_TYPE') {
    console.log(`      INCONSISTENT: ABSTRACT modifier with CLASS_TYPE category`);
    failures++;
  }
}
console.log(failures === 0 ? '\nall classification cases pass' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
