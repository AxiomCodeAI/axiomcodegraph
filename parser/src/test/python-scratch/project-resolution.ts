/** Project-level resolution rate: runs the analyzer, which does cross-module. */
import * as fs from 'fs';
import * as path from 'path';
import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';
const OUT = '/tmp/proj-res';
(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const s = await new PythonProjectAnalyzer().analyze({
    rootDir: process.argv[2]!, outputDir: OUT, baseMservPath: '/repo', serviceVersionLinkHash: 'SV' });
  console.log(`files ${s.filesAnalysed}  imports resolved ${s.resolution.importsResolved}  extra call sites ${s.resolution.callSitesResolved}`);
  const load = (n: string) => {
    const l = fs.readFileSync(path.join(OUT, n), 'utf8').split('\n').filter(Boolean);
    return { h: l[0]!.split('\t'), r: l.slice(1).map(x => x.split('\t')) };
  };
  const cs = load('all-python-call-sites.csv'), tb = load('all-python-type-bases.csv'), im = load('all-python-imports.csv');
  const ci = cs.h.indexOf('resolvedCalleeKind'), ri = cs.h.indexOf('receiverKind');
  const by = new Map<string, { r: number; t: number }>();
  for (const r of cs.r) {
    const e = by.get(r[ri]!) ?? { r: 0, t: 0 };
    e.t++; if (r[ci] !== 'UNRESOLVED') e.r++;
    by.set(r[ri]!, e);
  }
  const tot = [...by.values()].reduce((a, c) => ({ r: a.r + c.r, t: a.t + c.t }), { r: 0, t: 0 });
  console.log(`\ncall sites: ${tot.r}/${tot.t} (${(100 * tot.r / tot.t).toFixed(1)}%)`);
  for (const k of [...by.keys()].sort()) {
    const c = by.get(k)!;
    console.log(`  ${k.padEnd(12)} ${c.r}/${c.t}  ${(100 * c.r / c.t).toFixed(1)}%`);
  }
  const bi = tb.h.indexOf('isResolvedLocally'), bk = tb.h.indexOf('keywordName');
  const pos = tb.r.filter(r => r[bk] === '');
  console.log(`\npy_type_base positional: ${pos.filter(r => r[bi] === 'true').length}/${pos.length} resolved`);
  const ie = im.h.indexOf('isExternalTarget');
  console.log(`py_import in-project: ${im.r.filter(r => r[ie] === 'false').length}/${im.r.length}`);
})();
