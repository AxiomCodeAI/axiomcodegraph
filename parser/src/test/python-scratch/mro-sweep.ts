import * as fs from 'fs';
import * as path from 'path';
import { adjudicateMro } from './mro-adjudicate';
function walk(d: string, out: string[]): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['__pycache__','.git','node_modules','test','tests'].includes(e.name)) walk(p, out); }
    else if (e.name.endsWith('.py')) out.push(p);
  }
  return out;
}
const li = process.argv.indexOf('--limit');
const limit = li >= 0 ? Number(process.argv[li+1]) : Infinity;
const skip = new Set<string>(); if (li>=0) skip.add(process.argv[li+1]!);
const dirs = process.argv.slice(2).filter(a => !a.startsWith('--') && !skip.has(a));
let files: string[] = []; for (const d of dirs) files = files.concat(walk(d, []));
files.sort(); files = files.slice(0, limit);
let mc=0,mb=0,oc=0,ob=0,om=0,un=0; const samples: string[] = []; const mroSamples: string[] = [];
for (const f of files) {
  const r = adjudicateMro(f);
  if (r.unjudged) { un++; continue; }
  mc+=r.mroChecked; mb+=r.mroBad; oc+=r.ovChecked; ob+=r.ovBad; om+=r.ovMissing;
  r.problems.forEach(p => {
    if (p.startsWith('MRO') && mroSamples.length < 8) mroSamples.push(path.basename(f)+': '+p);
    else if (p.startsWith('OVERRIDE') && samples.length < 8) samples.push(path.basename(f)+': '+p);
  });
}
console.log(`files ${files.length}   unjudged (import failed) ${un}`);
console.log(`MRO order       : ${mc-mb}/${mc}  (${mc?((100*(mc-mb)/mc).toFixed(1)):'-'}%)`);
const decided = oc - om;
console.log(`override, DECIDED: ${decided-ob}/${decided} correct  (${decided?((100*(decided-ob)/decided).toFixed(1)):'-'}%)`);
console.log(`override, missing : ${om}  (no py_method — e.g. \`__rand__ = __and__\` aliases)`);
if (mroSamples.length) { console.log('\nMRO disagreements:'); mroSamples.forEach(s=>console.log('  '+s)); }
if (samples.length) { console.log('\nWRONG override answers:'); samples.forEach(s=>console.log('  '+s)); }
