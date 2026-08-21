/**
 * Sweep: run the differential check over a directory tree of real Python.
 * Usage: npx tsx src/test/python-scratch/sweep.ts <dir> [--limit N] [--show N]
 */
import * as fs from 'fs';
import * as path from 'path';

import { diffFile } from './diff-oracle';

function walk(dir: string, out: string[]): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['__pycache__', '.git', 'node_modules', 'test', 'tests', 'lib2to3'].includes(e.name)) walk(p, out);
    } else if (e.name.endsWith('.py')) out.push(p);
  }
  return out;
}

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const showIdx = args.indexOf('--show');
const show = showIdx >= 0 ? Number(args[showIdx + 1]) : 12;
const flagValues = new Set<string>();
if (limitIdx >= 0) flagValues.add(args[limitIdx + 1]!);
if (showIdx >= 0) flagValues.add(args[showIdx + 1]!);
const dirs = args.filter(a => !a.startsWith('--') && !flagValues.has(a));

let files: string[] = [];
for (const d of dirs) files = files.concat(walk(d, []));
files.sort();
files = files.slice(0, limit);

let clean = 0, dirty = 0, errored = 0;
let scopesExp = 0, scopesOk = 0, bindsExp = 0, bindsOk = 0;
const problemKinds = new Map<string, number>();
const samples: string[] = [];

for (const f of files) {
  try {
    const r = diffFile(f);
    scopesExp += r.scopeExpected; scopesOk += r.scopeMatched;
    bindsExp += r.bindExpected; bindsOk += r.bindMatched;
    if (r.problems.length === 0) { clean++; continue; }
    dirty++;
    for (const p of r.problems) {
      const kind = p.split(' ')[0]! + (p.includes('(c') ? ' ' + p.split(' ').slice(3, 4).join('') : '');
      problemKinds.set(kind, (problemKinds.get(kind) ?? 0) + 1);
      if (samples.length < show) samples.push(`${path.basename(f)}: ${p}`);
    }
  } catch (e: any) {
    errored++;
    const msg = String(e.message).split('\n')[0]!.slice(0, 90);
    problemKinds.set('THREW: ' + msg, (problemKinds.get('THREW: ' + msg) ?? 0) + 1);
    if (samples.length < show) samples.push(`${path.basename(f)}: THREW ${msg}`);
  }
}

console.log(`\nfiles: ${files.length}   clean: ${clean}   with problems: ${dirty}   errored: ${errored}`);
console.log(`scopes: ${scopesOk}/${scopesExp}   bindings: ${bindsOk}/${bindsExp}`);
if (problemKinds.size) {
  console.log('\nproblem kinds:');
  [...problemKinds.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(6)}  ${k}`));
  console.log('\nsamples:');
  samples.forEach(s => console.log('  ' + s));
}
