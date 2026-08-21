import * as fs from 'fs';
import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';
const f = 'src/test/python-scratch/mro-case.py';
const r = new PythonFactExtractor().extract({
  sourceCode: fs.readFileSync(f, 'utf8'), filePath: f, baseMservPath: '/r', serviceVersionLinkHash: 'SV' });
const mByHash = new Map(r.methods.map(m => [m.getHash(), m.toCsv().split('\t')]));
for (const c of r.callSites) {
  if (c.getReceiverKind() !== 'SUPER') continue;
  const t = mByHash.get(c.getResolvedCalleeHash());
  console.log(`  super().${c.getCalleeName()}() line ${c.getStartLine()} -> ` +
    (t ? t[3] : c.getResolvedCalleeKind()));
}
