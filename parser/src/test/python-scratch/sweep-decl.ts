import * as fs from 'fs';
import * as path from 'path';
import { diffDecl } from './diff-decl';

function walk(dir: string, out: string[]): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['__pycache__','.git','node_modules','test','tests','lib2to3'].includes(e.name)) walk(p, out); }
    else if (e.name.endsWith('.py')) out.push(p);
  }
  return out;
}
const args = process.argv.slice(2);
const li = args.indexOf('--limit');
const limit = li >= 0 ? Number(args[li + 1]) : Infinity;
const si = args.indexOf('--show');
const show = si >= 0 ? Number(args[si + 1]) : 15;
const skip = new Set<string>();
if (li >= 0) skip.add(args[li + 1]!);
if (si >= 0) skip.add(args[si + 1]!);
const dirs = args.filter(a => !a.startsWith('--') && !skip.has(a));

let files: string[] = [];
for (const d of dirs) files = files.concat(walk(d, []));
files.sort(); files = files.slice(0, limit);

let clean = 0, dirty = 0, errored = 0;
const kinds = new Map<string, number>();
const samples: string[] = [];
const totals = { types: 0, methods: 0, params: 0, imports: 0, bases: 0 };

for (const f of files) {
  try {
    const r = diffDecl(f);
    totals.types += r.counts.classes ?? 0;
    totals.methods += r.counts.methods ?? 0;
    totals.params += r.counts.params ?? 0;
    totals.imports += r.counts.imports ?? 0;
    totals.bases += r.counts.bases ?? 0;
    if (r.problems.length === 0) { clean++; continue; }
    dirty++;
    for (const p of r.problems) {
      const kind = p.split(' ')[0]! + (p.includes(':') && p.split(' ')[2] ? ' ' + p.split(' ')[2].replace(':','') : '');
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      if (samples.length < show) samples.push(`${path.basename(f)}: ${p}`);
    }
  } catch (e: any) {
    errored++;
    const m = 'THREW: ' + String(e.message).split('\n')[0].slice(0, 70);
    kinds.set(m, (kinds.get(m) ?? 0) + 1);
    if (samples.length < show) samples.push(`${path.basename(f)}: ${m}`);
  }
}
console.log(`\nfiles: ${files.length}  clean: ${clean}  problems: ${dirty}  errored: ${errored}`);
console.log(`emitted: ${totals.types} types, ${totals.bases} bases, ${totals.methods} methods, ${totals.params} params, ${totals.imports} imports`);
if (kinds.size) {
  console.log('\nproblem kinds:');
  [...kinds.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`  ${String(v).padStart(6)}  ${k}`));
  console.log('\nsamples:'); samples.forEach(s => console.log('  ' + s));
}
