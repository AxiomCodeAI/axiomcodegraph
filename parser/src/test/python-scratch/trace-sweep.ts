import * as fs from 'fs';
import * as path from 'path';
import { trace } from './trace';
function walk(d: string, out: string[]): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['__pycache__','.git','node_modules'].includes(e.name)) walk(p, out); }
    else if (e.name.endsWith('.py')) out.push(p);
  }
  return out;
}
const args = process.argv.slice(2);
const li = args.indexOf('--limit');
const limit = li >= 0 ? Number(args[li+1]) : Infinity;
const skip = new Set<string>(); if (li >= 0) skip.add(args[li+1]!);
const dirs = args.filter(a => !a.startsWith('--') && !skip.has(a));
let files: string[] = []; for (const d of dirs) files = files.concat(walk(d, []));
files.sort(); files = files.slice(0, limit);
let total = 0, bad = 0, errored = 0; const kinds = new Map<string, number>(); const samples: string[] = [];
for (const f of files) {
  try {
    const r = trace(f);
    total += r.checked;
    for (const p of r.problems) {
      bad++; const k = p.split(':')[0]!;
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
      if (samples.length < 10) samples.push(path.basename(f) + ': ' + p);
    }
  } catch { errored++; }
}
console.log(`files ${files.length}  errored ${errored}`);
console.log(`links checked ${total}   BROKEN ${bad}`);
if (kinds.size) { console.log('\nby kind:'); [...kinds].sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${String(v).padStart(6)}  ${k}`));
  console.log('\nsamples:'); samples.forEach(s=>console.log('  '+s)); }
