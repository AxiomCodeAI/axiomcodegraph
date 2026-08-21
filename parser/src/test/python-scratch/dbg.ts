import * as fs from 'fs';
import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';
const f = process.argv[2]!;
const r = new PythonFactExtractor().extract({
  sourceCode: fs.readFileSync(f, 'utf8'), filePath: f, baseMservPath: '/r',
  serviceVersionLinkHash: 'SV' });
const seen = new Map<string, number>();
r.expressions.forEach(e => seen.set(e.getHash(), (seen.get(e.getHash()) ?? 0) + 1));
const dups = [...seen.entries()].filter(([, v]) => v > 1);
console.log('expressions', r.expressions.length, 'duplicate keys', dups.length);
for (const [h] of dups.slice(0, 5)) {
  r.expressions.filter(e => e.getHash() === h).forEach(e =>
    console.log('  DUP role=' + e.getEdgeRole() + ' pos=' + e.getPosition() + ' ' + e.getEntryCombined()));
}
console.log('\ncalls:'); r.callSites.forEach(c => console.log('  ' + c.getEntryCombined()));
