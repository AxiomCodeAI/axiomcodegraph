/**
 * Classifies WHY each call site failed to resolve, so "38.8%" becomes a list of
 * causes rather than a number. Every cause is derived from emitted facts.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const OUT = '/tmp/why-out';

function load(name: string): { header: string[]; rows: string[][] } {
  const text = fs.readFileSync(path.join(OUT, name), 'utf8');
  const lines = text.split('\n').filter(Boolean);
  return { header: lines[0]!.split('\t'), rows: lines.slice(1).map(l => l.split('\t')) };
}
const col = (h: string[], n: string) => h.indexOf(n);

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const summary = await new PythonProjectAnalyzer().analyze({
    rootDir: process.argv[2]!, outputDir: OUT, baseMservPath: '/repo',
    serviceVersionLinkHash: 'SV',
  });
  console.log(`files ${summary.filesAnalysed}   call sites ${summary.counts.py_call_site}`);

  const cs = load('all-python-call-sites.csv');
  const ty = load('all-python-types.csv');
  const tb = load('all-python-type-bases.csv');
  const me = load('all-python-methods.csv');

  const cRk = col(cs.header, 'receiverKind'), cKind = col(cs.header, 'resolvedCalleeKind');
  const cName = col(cs.header, 'calleeName'), cType = col(cs.header, 'pyTypeLinkHash');

  const basesOf = new Map<string, string[][]>();
  const tbType = col(tb.header, 'pyTypeLinkHash'), tbKw = col(tb.header, 'keywordName');
  for (const r of tb.rows) {
    if (r[tbKw] !== '') continue;
    const list = basesOf.get(r[tbType]!) ?? [];
    list.push(r);
    basesOf.set(r[tbType]!, list);
  }
  const tbResolved = col(tb.header, 'isResolvedLocally');
  const tbTarget = col(tb.header, 'resolvedTypeLinkHash');

  const methodsOnType = new Map<string, Set<string>>();
  const meType = col(me.header, 'pyTypeLinkHash'), meName = col(me.header, 'name');
  const meEncl = col(me.header, 'enclosingMemberLinkHash');
  for (const r of me.rows) {
    if (r[meType] === '' || r[meEncl] !== '') continue;
    const set = methodsOnType.get(r[meType]!) ?? new Set();
    set.add(r[meName]!);
    methodsOnType.set(r[meType]!, set);
  }

  const reasons = new Map<string, number>();
  const bump = (k: string) => reasons.set(k, (reasons.get(k) ?? 0) + 1);

  for (const r of cs.rows) {
    if (r[cKind] !== 'UNRESOLVED') continue;
    const rk = r[cRk]!;

    if (rk === 'ATTRIBUTE' || rk === 'CALL_RESULT' || rk === 'SUBSCRIPT' || rk === 'LITERAL') {
      bump(`${rk}: needs receiver TYPE (py_field / return typing, deferred)`);
      continue;
    }
    if (rk === 'SUPER' || rk === 'SELF' || rk === 'CLS') {
      const t = r[cType]!;
      if (t === '') { bump(`${rk}: no enclosing class recorded`); continue; }
      const bases = basesOf.get(t) ?? [];
      if (bases.length === 0) {
        bump(`${rk}: class has NO explicit base (implicit object)`);
        continue;
      }
      const unresolved = bases.filter(b => b[tbResolved] !== 'true');
      if (unresolved.length === bases.length) {
        bump(`${rk}: every base UNRESOLVED (base outside this analysis)`);
        continue;
      }
      if (unresolved.length > 0) {
        bump(`${rk}: SOME base unresolved -> refused for soundness`);
        continue;
      }
      const found = bases.filter(b => methodsOnType.get(b[tbTarget]!)?.has(r[cName]!));
      if (found.length === 0) {
        bump(`${rk}: bases resolved but none declares "${'<name>'}" (defined further up, outside)`);
      } else if (found.length > 1) {
        bump(`${rk}: AMBIGUOUS - ${found.length} bases declare it`);
      } else {
        bump(`${rk}: base declares it but not resolved - INVESTIGATE`);
      }
      continue;
    }
    bump(`${rk}: name not bound to a def/class in scope chain (param, import-external, or variable)`);
  }

  console.log('\nreasons, most common first:');
  [...reasons.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
    console.log(`  ${String(v).padStart(6)}  ${k}`));
})();
