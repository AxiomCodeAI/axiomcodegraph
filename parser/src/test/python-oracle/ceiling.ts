/**
 * ADJUDICATION CEILING — what CAN be checked, against what IS.
 *
 *     npx tsx src/test/python-oracle/ceiling.ts
 *
 * coverage.ts answers "how many columns does a harness check". That number alone
 * is unreadable, because it silently divides by columns nothing could ever check.
 * A primary key has no CPython counterpart; neither does serviceVersionLinkHash.
 * Counting those in the denominator makes the parser look worse than it is, and
 * counting them in the numerator would make it look better. Both are wrong.
 *
 * So every column is classified by WHAT COULD DECIDE IT, and the report gives
 * three numbers instead of one:
 *
 *   CEILING   columns some oracle could decide, if someone wrote the comparator
 *   DONE      columns a harness actually compares today
 *   STRUCTURAL columns no external oracle can speak to — checked by INVARIANT
 *             instead (referential integrity, determinism, PK uniqueness)
 *
 * The classification is by rule, not by hand, so it cannot drift quietly as
 * columns are added.
 */
import * as fs from 'fs';
import * as path from 'path';

const DOC = path.resolve(__dirname, '..', '..', '..', 'python-work', 'PYTHON-FACT-SCHEMA.md');

type Source =
  | 'SYMTABLE'      // CPython symtable — exact, Gate 1
  | 'AST'           // CPython ast — independent second implementation, Gate 2
  | 'RESOLVER'      // needs name resolution: jedi / MRO / bytecode adjudicate
  | 'SPEC'          // our taxonomy; author separation only, never ground truth
  | 'STRUCTURAL';   // hashes and provenance — invariant-checked, not oracle-checked

interface Col { rel: string; idx: number; name: string; source: Source }

/** Relations whose whole content comes from symtable. */
const SYMTABLE_RELS = new Set(['py_scope', 'py_binding']);

/** Columns that are keys, links or provenance — no external oracle applies. */
function isStructural(name: string): boolean {
  return /Hash$/.test(name)
    || name === 'serviceVersionLinkHash'
    || name === 'baseMservPath'
    || /^symtableId$/.test(name);
}

/** Columns that only a resolver can decide — the engine's territory. */
const RESOLVER_COLS = new Set([
  'resolvedCalleeKind', 'resolvedCalleeHash', 'resolvedTargetKind', 'resolvedModulePath',
  'inferredTypeName', 'inferredTypeKind', 'inferenceEvidence', 'inferenceConfidence',
  'potentialQualifiedName', 'isAmbiguous', 'isExternalTarget', 'referencedEntityKind',
  'argFlowIsPrecise', 'mroKind', 'providedBy', 'ownerTypeName',
]);

/**
 * Columns whose value is a taxonomy WE invented. CPython has no opinion on them,
 * so the strongest available check is author separation: A0 specifies, A3
 * implements, and agreement means only that two readings of one spec matched.
 */
const SPEC_COLS = new Set([
  'typeCategory', 'typeModifier', 'methodKind', 'methodModifier', 'importKind',
  'fieldOrigin', 'fieldModifier', 'emissionRegime', 'moduleKind', 'grammarUsed',
  'pythonDialect', 'dialectConfidence', 'targetVersion', 'expressionOwnerKind',
  'rootContext', 'edgeRole', 'receiverKind', 'callKind', 'baseKind', 'context',
  'typeAccess', 'methodAccess', 'fieldAccess', 'typePlacement', 'disposition',
]);

function parse(): Col[] {
  const md = fs.readFileSync(DOC, 'utf-8');
  const heads = [...md.matchAll(/^### 2\.\d+ `(py_\w+)` \/ `lib_\1` — (\d+) columns/gm)];
  const cols: Col[] = [];
  for (let i = 0; i < heads.length; i++) {
    const rel = heads[i]![1]!;
    const from = heads[i]!.index!;
    const to = i + 1 < heads.length ? heads[i + 1]!.index! : md.length;
    const seg = md.slice(from, to).split('**PK**')[0]!;
    let rows = [...seg.matchAll(/^\| (\d+) \| `(\w+)`/gm)].map((m) => ({
      idx: Number(m[1]), name: m[2]!,
    }));
    if (!rows.length) {
      // inline form: `0 colA · 1 colB · 2 colC`
      const inline = [...seg.matchAll(/`([^`]*·[^`]*)`/gs)].map((m) => m[1]).join(' ');
      rows = [...inline.matchAll(/(?:^|·)\s*(\d+)\s+(\w+)/g)].map((m) => ({
        idx: Number(m[1]), name: m[2]!,
      }));
    }
    for (const r of rows) {
      let source: Source;
      if (isStructural(r.name)) source = 'STRUCTURAL';
      else if (RESOLVER_COLS.has(r.name)) source = 'RESOLVER';
      else if (SYMTABLE_RELS.has(rel)) source = 'SYMTABLE';
      else if (SPEC_COLS.has(r.name)) source = 'SPEC';
      else source = 'AST';
      cols.push({ rel, idx: r.idx, name: r.name, source });
    }
  }
  return cols;
}

/**
 * Relations with an emitter today. py_comment and py_parse_gap are declared and
 * unbuilt, and py_type_parameter is deferred, so counting their columns in the
 * denominator would report a coverage gap that is really a backlog item — two
 * different problems with two different owners.
 */
const EMITTED = new Set([
  'py_module', 'py_scope', 'py_binding', 'py_type', 'py_type_base', 'py_type_reference',
  'py_method', 'py_method_parameter', 'py_field', 'py_field_position', 'py_decorator',
  'py_decorator_argument', 'py_import', 'py_expression', 'py_call_site', 'py_block',
]);

function main(): number {
  const emittedOnly = !process.argv.includes('--all');
  const cols = parse().filter((c) => !emittedOnly || EMITTED.has(c.rel));
  const by = new Map<Source, number>();
  for (const c of cols) by.set(c.source, (by.get(c.source) ?? 0) + 1);
  const n = cols.length;

  const rels = new Set(cols.map((c) => c.rel)).size;
  console.log(`ADJUDICATION CEILING — ${n} columns across ${rels} relations` +
              (emittedOnly ? '  (emitted only; --all for the declared 19)' : '') + '\n');
  const order: Source[] = ['SYMTABLE', 'AST', 'RESOLVER', 'SPEC', 'STRUCTURAL'];
  const label: Record<Source, string> = {
    SYMTABLE: 'symtable — exact, Gate 1',
    AST: 'ast — independent 2nd implementation, Gate 2',
    RESOLVER: 'resolver — jedi / CPython MRO / bytecode',
    SPEC: 'spec — author separation only, NOT ground truth',
    STRUCTURAL: 'no external oracle — invariant-checked instead',
  };
  for (const s of order) {
    const c = by.get(s) ?? 0;
    console.log(`  ${s.padEnd(11)} ${String(c).padStart(4)}  ${((100 * c) / n).toFixed(1).padStart(5)}%  ${label[s]}`);
  }
  const ceiling = (by.get('SYMTABLE') ?? 0) + (by.get('AST') ?? 0) + (by.get('RESOLVER') ?? 0);
  const weak = by.get('SPEC') ?? 0;
  const structural = by.get('STRUCTURAL') ?? 0;
  console.log(`\n  CEILING (a real oracle exists)      ${ceiling}/${n} = ${((100 * ceiling) / n).toFixed(1)}%`);
  console.log(`  weakly checkable (spec only)        ${weak}`);
  console.log(`  structural (invariants, not oracles) ${structural}`);
  // The number the question actually asks for.
  const DONE = 45;   // from coverage.ts, which counts what a harness compares today
  console.log(`\n  DONE (a harness compares it today)  ${DONE}/${ceiling} = ` +
              `${((100 * DONE) / ceiling).toFixed(1)}% OF THE CEILING`);
  console.log(`  unbuilt comparators                 ${ceiling - DONE}`);
  console.log('\n  Read it this way: the denominator for "is the parser right" is the');
  console.log('  CEILING. Structural columns are not unchecked — they are checked by a');
  console.log('  different instrument, and folding them in either direction is a lie.');
  return 0;
}

if (require.main === module) process.exit(main());
