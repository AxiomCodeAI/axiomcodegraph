/**
 * Measures declares-vs-forwards for isArgsKwargsPassthrough across a corpus.
 *
 * "Declares" = the method's own signature has both *args and **kwargs.
 * "Forwards" = it ALSO contains a call site that spreads both.
 * Both are derivable from facts we already emit, so this needs no oracle.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

function walk(d: string, out: string[]): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['__pycache__','.git','node_modules'].includes(e.name)) walk(p, out); }
    else if (e.name.endsWith('.py')) out.push(p);
  }
  return out;
}
const li = process.argv.indexOf('--limit');
const limit = li >= 0 ? Number(process.argv[li + 1]) : Infinity;
const files = walk(process.argv[2]!, []).sort().slice(0, limit);

let declares = 0, forwardsBoth = 0, forwardsEither = 0, methods = 0;
for (const f of files) {
  let facts;
  try {
    facts = new PythonFactExtractor().extract({
      sourceCode: fs.readFileSync(f, 'utf8'), filePath: f, baseMservPath: '/r',
      moduleQualifiedName: path.basename(f).replace(/\.pyi?$/, ''), serviceVersionLinkHash: 'SV' });
  } catch { continue; }
  const spreadBoth = new Set<string>();
  const spreadEither = new Set<string>();
  for (const c of facts.callSites) {
    const cols = c.toCsv().split('\t');
    if (cols[13] === 'true' && cols[14] === 'true') spreadBoth.add(cols[8]!);
    if (cols[13] === 'true' || cols[14] === 'true') spreadEither.add(cols[8]!);
  }
  for (const m of facts.methods) {
    methods++;
    if (m.toCsv().split('\t')[27] !== 'true') continue;
    declares++;
    if (spreadBoth.has(m.getHash())) forwardsBoth++;
    else if (spreadEither.has(m.getHash())) forwardsEither++;
  }
}
console.log(`files ${files.length}   methods ${methods}`);
console.log(`declares both *args and **kwargs : ${declares}`);
console.log(`  of which forward BOTH onward   : ${forwardsBoth}  (${(100*forwardsBoth/Math.max(declares,1)).toFixed(1)}%)`);
console.log(`  of which forward one of them   : ${forwardsEither}`);
console.log(`  of which forward neither       : ${declares - forwardsBoth - forwardsEither}`);
