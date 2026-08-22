/**
 * ADJUDICATION COVERAGE METER — the union of every harness, computed not asserted.
 *
 * This exists because both A0 and A3 quoted a coverage number and both were wrong:
 * each measured its own harness. The harnesses turned out to be 41/42 DISJOINT, so
 * neither component could see the total. Nobody should quote a coverage figure that
 * did not come from here.
 *
 * A0 harness  src/test/python-oracle/harness/compare.ts
 * A3 harness  src/test/python-extractor-tests.ts :: gate2
 * A3 gate     src/test/python-gates/diff-expr.ts  (expression tree vs ast)
 *
 * DECLINED VERDICTS DO NOT COUNT (A3's finding). A tier-1 classification is
 * authoritative only when `residue` is empty. `methodKind: INSTANCE_METHOD` with
 * `residue: "DECORATED:property"` means "this is outside my tier-1 set", not "it is
 * an instance method" — so it adjudicates nothing and must not inflate the number.
 */
import * as fs from 'fs';
import * as path from 'path';

/** Columns with no possible oracle: covered by invariants 1–4, not by comparison. */
const STRUCTURAL =
  /UniqueHash$|LinkHash$|^filePath$|^serviceVersionLinkHash$|^baseMservPath$|Hash$/;

/** Column indices each harness compares against the oracle, per relation. */
export const ADJUDICATED: Record<string, { a0?: number[]; a3?: number[] }> = {
  scopes:    { a0: [0, 1, 2, 3, 8, 9, 10, 18, 19, 22] },
  bindings:  { a0: [0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] },
  types:     { a3: [10, 19] },
  methods:   { a3: [6, 8, 13, 24, 25, 26, 28, 29, 30, 35] },
  imports:   { a3: [9] },
  callSites: { a3: [4, 11, 12, 13, 14, 15, 23] },
  // A3's python-gates/diff-expr.ts, reading annotations CPython computed itself
  // (Name.ctx, the index in Call.args) rather than reimplementing the rules.
  // c1 edgeRole, c6 parentExpressionHash, c7 position, c8 depth, c27 nameContext.
  expressions: { a3: [1, 6, 7, 8, 27] },
};

export interface RelationCoverage {
  relation: string;
  columns: number;
  structural: number;
  adjudicable: number;
  adjudicated: number;
  byA0: number;
  byA3: number;
  overlap: number;
  unchecked: string[];
}

export function coverageFor(facts: Record<string, unknown>): {
  rows: RelationCoverage[];
  adjudicable: number;
  adjudicated: number;
  pct: number;
} {
  const rows: RelationCoverage[] = [];
  let adjudicable = 0;
  let adjudicated = 0;

  for (const key of Object.keys(facts).sort()) {
    const v = facts[key];
    const arr = Array.isArray(v) ? v : v ? [v] : [];
    const first = arr[0] as { getCsvHeader?: () => string } | undefined;
    if (!first || typeof first.getCsvHeader !== 'function') continue;

    const hdr = first.getCsvHeader().split('\t');
    const adjIdx = hdr.map((h, i) => [h, i] as const).filter(([h]) => !STRUCTURAL.test(h));
    const spec = ADJUDICATED[key] ?? {};
    const a0 = new Set((spec.a0 ?? []).filter((i) => adjIdx.some(([, j]) => j === i)));
    const a3 = new Set((spec.a3 ?? []).filter((i) => adjIdx.some(([, j]) => j === i)));
    const union = new Set([...a0, ...a3]);
    const overlap = [...a0].filter((i) => a3.has(i)).length;

    adjudicable += adjIdx.length;
    adjudicated += union.size;
    rows.push({
      relation: key,
      columns: hdr.length,
      structural: hdr.length - adjIdx.length,
      adjudicable: adjIdx.length,
      adjudicated: union.size,
      byA0: a0.size,
      byA3: a3.size,
      overlap,
      unchecked: adjIdx.filter(([, i]) => !union.has(i)).map(([h]) => h),
    });
  }
  return { rows, adjudicable, adjudicated, pct: (100 * adjudicated) / adjudicable };
}

export function formatCoverage(c: ReturnType<typeof coverageFor>): string {
  const out: string[] = [];
  out.push('relation'.padEnd(18) + 'adj'.padStart(5) + 'done'.padStart(6) +
           'cov'.padStart(7) + '  A0/A3/both   first unchecked');
  for (const r of [...c.rows].sort((x, y) =>
        (y.adjudicable - y.adjudicated) - (x.adjudicable - x.adjudicated))) {
    out.push(
      r.relation.padEnd(18) +
      String(r.adjudicable).padStart(5) + String(r.adjudicated).padStart(6) +
      (r.adjudicable ? ((100 * r.adjudicated) / r.adjudicable).toFixed(0) + '%' : '—').padStart(7) +
      `  ${r.byA0}/${r.byA3}/${r.overlap}`.padEnd(13) +
      r.unchecked.slice(0, 3).join(', ')
    );
  }
  out.push('');
  out.push(`PROJECT TOTAL  ${c.adjudicated} / ${c.adjudicable} adjudicable columns = ${c.pct.toFixed(1)}%`);
  const dup = c.rows.reduce((n, r) => n + r.overlap, 0);
  out.push(`harness overlap: ${dup} column(s) — the rest is disjoint, which is why ` +
           `neither harness can state this number alone`);
  return out.join('\n');
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PythonFactExtractor } = require('@/parsers/python/extractors/python-fact-extractor');
  const target = process.argv[2] ?? 'src/test-data/python/linkage-sample/models.py';
  const facts = new PythonFactExtractor().extract({
    sourceCode: fs.readFileSync(target, 'utf8'),
    filePath: target,
    baseMservPath: '/repo',
    moduleQualifiedName: path.basename(target).replace(/\.pyi?$/, ''),
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });
  console.log(formatCoverage(coverageFor(facts)));
}
