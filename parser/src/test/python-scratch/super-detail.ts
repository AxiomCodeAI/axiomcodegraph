/** Categorises every unresolved SUPER/SELF site using the linker's own rule. */
import * as fs from 'fs';
import * as path from 'path';
const OUT = '/tmp/why-out';
function load(n: string) {
  const l = fs.readFileSync(path.join(OUT, n), 'utf8').split('\n').filter(Boolean);
  return { h: l[0]!.split('\t'), r: l.slice(1).map(x => x.split('\t')) };
}
const cs = load('all-python-call-sites.csv'), tb = load('all-python-type-bases.csv'), me = load('all-python-methods.csv');
const c = (h: string[], n: string) => h.indexOf(n);
const basesOf = new Map<string, string[][]>();
for (const r of tb.r) {
  if (r[c(tb.h, 'keywordName')] !== '') continue;
  const k = r[c(tb.h, 'pyTypeLinkHash')]!;
  basesOf.set(k, [...(basesOf.get(k) ?? []), r]);
}
const declares = new Map<string, Set<string>>();
for (const r of me.r) {
  const t = r[c(me.h, 'pyTypeLinkHash')]!;
  if (t === '' || r[c(me.h, 'enclosingMemberLinkHash')] !== '') continue;
  if (r[c(me.h, 'methodKind')] === 'OVERLOAD_STUB' || r[c(me.h, 'bodyIsStub')] === 'true') continue;
  declares.set(t, (declares.get(t) ?? new Set()).add(r[c(me.h, 'name')]!));
}
/** Nearest declaration within one chain; null if opaque or absent. */
function nearest(t: string, name: string, seen = new Set<string>()): string | null | 'OPAQUE' {
  if (seen.has(t)) return null;
  seen.add(t);
  if (declares.get(t)?.has(name)) return t;
  const bases = basesOf.get(t) ?? [];
  const answers = new Set<string>();
  for (const b of bases) {
    if (b[c(tb.h, 'isResolvedLocally')] !== 'true') return 'OPAQUE';
    const a = nearest(b[c(tb.h, 'resolvedTypeLinkHash')]!, name, seen);
    if (a === 'OPAQUE') return 'OPAQUE';
    if (a) answers.add(a);
  }
  return answers.size === 1 ? [...answers][0]! : null;
}
const reasons = new Map<string, number>();
for (const r of cs.r) {
  const rk = r[c(cs.h, 'receiverKind')]!;
  if (r[c(cs.h, 'resolvedCalleeKind')] !== 'UNRESOLVED') continue;
  if (rk !== 'SUPER' && rk !== 'SELF') continue;
  const t = r[c(cs.h, 'pyTypeLinkHash')]!;
  const name = r[c(cs.h, 'calleeName')]!;
  const bases = basesOf.get(t) ?? [];
  let why: string;
  if (bases.length === 0) why = 'class has no explicit base (target is on object/builtin)';
  else if (bases.some(b => b[c(tb.h, 'isResolvedLocally')] !== 'true'))
    why = 'a base is OUTSIDE the analysis (opaque, could shadow)';
  else {
    const answers = new Set<string>();
    let opaque = false;
    for (const b of bases) {
      const a = nearest(b[c(tb.h, 'resolvedTypeLinkHash')]!, name);
      if (a === 'OPAQUE') { opaque = true; break; }
      if (a) answers.add(a);
    }
    why = opaque ? 'a base further up is OUTSIDE the analysis'
      : answers.size === 0 ? 'name declared nowhere in the reachable closure'
      : 'AMBIGUOUS: sibling bases give different targets (no C3 computed)';
  }
  const k = `${rk}: ${why}`;
  reasons.set(k, (reasons.get(k) ?? 0) + 1);
}
[...reasons.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
  console.log(`  ${String(v).padStart(4)}  ${k}`));
