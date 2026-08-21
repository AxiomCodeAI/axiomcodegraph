/**
 * SELF-TEST FOR THE HARNESS.
 *
 * The harness is the arbiter for every other agent. If it is wrong, everything
 * downstream is wrong and nobody notices — so a harness that has only ever seen
 * correct input has not been tested at all.
 *
 * Method: mutation testing. Build a fact set that is correct by construction
 * (from the oracle's own answer), assert the harness passes it, then introduce
 * ONE specific defect at a time and assert the harness reports THAT defect. A
 * mutation the harness fails to catch is a hole in the arbiter.
 */

import { execFileSync } from 'child_process';
import * as path from 'path';

import {
  invariant10_interpreterPinned,
  invariant11_schemaAgreement,
  invariant1_referentialIntegrity,
  invariant2_noPkCollisions,
  invariant3_prefixDiscipline,
  invariant4_serviceVersion,
  invariant5_deterministic,
  invariant6_columnCount,
  invariant7_ownershipTotality,
  invariant8_scopeForest,
  invariant9a_symtableAstPairing,
  invariant9b_syntheticIterator,
  runFactInvariants,
} from '../harness/invariants';
import { compare, summarise } from '../harness/compare';
import {
  assertGoldenMatchesEnvironment,
  buildGolden,
  renderGolden,
} from '../harness/golden';
import {
  assertOracleUsable,
  oracleForSource,
  oracleRawForSource,
} from '../harness/oracle-runner';
import { FactSet, OraclePayload } from '../harness/types';
import { cloneFacts, synthesiseFacts } from './fact-synth';

// --------------------------------------------------------------------------
// Inline sources. Deliberately NOT .py files: fixtures are A1/A2/A5's to own,
// and these exist only to exercise the harness.
// --------------------------------------------------------------------------

const SRC_RICH = `import os
from mod import *

GLOBAL_CONST = 1

class C(Base, metaclass=M):
    attr = 1

    def __init__(self, a, *args, **kw):
        self.x = a
        self.y = [i for i in args]
        def inner():
            nonlocal a
            return a + GLOBAL_CONST
        self.f = inner

    @property
    def prop(self):
        return self.x

lam = lambda z: z

def gen(items):
    global GLOBAL_CONST
    squares = {k: v for k, v in items}
    uniq = {u for u in items}
    lazy = (t for t in items)
    yield squares, uniq, lazy
`;

/** Two lambdas and two comprehensions on one line — the PK collision case. */
const SRC_SAME_LINE = `g = (lambda: 1, lambda: 2)
h = [x for x in a] + [y for y in b]
`;

/** Nested calls sharing a start offset. */
const SRC_NESTED_CALLS = `def f(self, e):
    super().set_exception(e)
    sink(taint(e))
    taint(sink(e))
`;

// --------------------------------------------------------------------------

interface Case {
  name: string;
  run: () => void;
}

const failures: string[] = [];
const passes: string[] = [];

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passes.push(name);
  else failures.push(`${name}${detail ? ': ' + detail : ''}`);
}

/** Assert a mutation IS caught. The whole point of the file. */
function expectCaught(
  name: string,
  violations: string[],
  mustMention?: string
): void {
  if (violations.length === 0) {
    failures.push(`${name}: MUTATION NOT CAUGHT — the harness has a hole here`);
    return;
  }
  if (mustMention && !violations.join(' ').includes(mustMention)) {
    failures.push(
      `${name}: caught, but message lacks ${JSON.stringify(mustMention)} — got ${violations[0]}`
    );
    return;
  }
  passes.push(name);
}

const cases: Case[] = [];

// ==========================================================================
// 0. The oracle itself
// ==========================================================================
cases.push({
  name: 'oracle: pinned interpreter self-check',
  run: () => {
    const prov = assertOracleUsable();
    check('interpreter is 3.10.x', prov.versionInfo[0] === 3 && prov.versionInfo[1] === 10,
      `got ${prov.versionInfo.join('.')}`);
    check('regime is PY3_0_11', prov.emissionRegime === 'PY3_0_11', prov.emissionRegime);
    check('11 symbol predicates', prov.symbolPredicates.length === 11,
      String(prov.symbolPredicates.length));
    check('interpreter path absolute', prov.interpreterPath.startsWith('/'), prov.interpreterPath);
  },
});

cases.push({
  name: 'oracle: emits no internal errors on rich source',
  run: () => {
    const o = oracleForSource(SRC_RICH, 'rich.py', 'rich');
    check('no oracle errors', o.errors.length === 0, JSON.stringify(o.errors));
    check('module scope present', o.scopes.some((s) => s.scopeKind === 'MODULE'));
    check('comprehension scopes present (PY3_0_11)',
      o.scopes.filter((s) => s.scopeKind.startsWith('COMPREHENSION')).length === 3,
      String(o.scopes.filter((s) => s.scopeKind.startsWith('COMPREHENSION')).length));
    check('genexpr scope present',
      o.scopes.some((s) => s.scopeKind === 'GENERATOR_EXPRESSION'));
    check('nonlocal detected', o.scopes.some((s) => s.declaresNonlocal));
    check('wildcard import detected', o.scopes.some((s) => s.usesWildcardImport));
    check('self.x attribute write captured',
      o.attributeWrites.some((w) => w.attribute === 'x' && w.origin === 'SELF_ASSIGN'));
  },
});

cases.push({
  name: 'oracle: byte-identical across runs (invariant #5)',
  run: () => {
    const a = oracleRawForSource(SRC_RICH, 'rich.py');
    const b = oracleRawForSource(SRC_RICH, 'rich.py');
    const r = invariant5_deterministic(a, b);
    check('deterministic', r.passed, r.violations[0] ?? '');
    // and prove the check itself can fail
    const neg = invariant5_deterministic(a, a + ' ');
    expectCaught('invariant #5 catches a divergence', neg.violations);
  },
});

cases.push({
  name: 'oracle: same-line scopes get distinct identities',
  run: () => {
    const o = oracleForSource(SRC_SAME_LINE, 'sameline.py', 'sameline');
    check('no oracle errors', o.errors.length === 0, JSON.stringify(o.errors));
    const ids = new Set(o.scopes.map((s) => s.scopeId));
    check('all scope ids distinct', ids.size === o.scopes.length,
      `${ids.size} ids for ${o.scopes.length} scopes`);
    const lambdas = o.scopes.filter((s) => s.scopeKind === 'LAMBDA');
    check('two lambdas found', lambdas.length === 2, String(lambdas.length));
    check('lambdas share a line', lambdas.length === 2 && lambdas[0].startLine === lambdas[1].startLine);
    check('lambdas differ by startColumn',
      lambdas.length === 2 && lambdas[0].startColumn !== lambdas[1].startColumn,
      lambdas.map((l) => l.startColumn).join(','));
    const comps = o.scopes.filter((s) => s.scopeKind === 'COMPREHENSION_LIST');
    check('two listcomps found', comps.length === 2, String(comps.length));
    check('listcomps differ by startColumn',
      comps.length === 2 && comps[0].startColumn !== comps[1].startColumn);
  },
});

cases.push({
  name: 'oracle: nested calls sharing a start offset stay distinct',
  run: () => {
    const o = oracleForSource(SRC_NESTED_CALLS, 'nested.py', 'nested');
    const calls = o.structure.calls as Record<string, unknown>[];
    const zeroCol = calls.filter((c) => c.line === 2);
    check('super() and set_exception both recorded', zeroCol.length === 2, String(zeroCol.length));
    const spans = new Set(zeroCol.map((c) => `${c.line}:${c.col}-${c.endLine}:${c.endCol}`));
    check('their spans differ', spans.size === 2, [...spans].join(' | '));
    const receivers = calls.filter((c) => c.callee === 'set_exception');
    check('super() receiver classified as SUPER',
      receivers.length === 1 && receivers[0].receiverKind === 'SUPER',
      String(receivers[0]?.receiverKind));
  },
});

cases.push({
  name: 'oracle: scopes hidden in defaults/decorators/annotations belong to the PARENT',
  run: () => {
    // These are evaluated in the ENCLOSING scope, so symtable makes them
    // siblings of `f`, not children. A naive walker loses them entirely — this
    // was a real bug, found by sweeping the oracle over sqlalchemy.
    const src = [
      'def outer():',
      "    @d(lambda: 'DEC')",
      "    def f(x=lambda: 'DEF', *, y: C[lambda: 'ANN'] = 2): pass",
      '    return [q for q in [r for r in z]]',
      '',
    ].join('\n');
    const o = oracleForSource(src, 'hidden.py', 'hidden');
    check('no pairing errors', o.errors.length === 0, JSON.stringify(o.errors));
    const lams = o.scopes.filter((s) => s.scopeKind === 'LAMBDA');
    check('all three hidden lambdas found', lams.length === 3, String(lams.length));
    check('hidden lambdas are children of outer, not f',
      lams.every((l) => l.qualifiedName === 'hidden.outer.<locals>.lambda'),
      lams.map((l) => l.qualifiedName).join(' | '));
    check('hidden lambdas have distinct columns',
      new Set(lams.map((l) => `${l.startLine}:${l.startColumn}`)).size === 3,
      lams.map((l) => `${l.startLine}:${l.startColumn}`).join(','));
    const comps = o.scopes.filter((s) => s.scopeKind === 'COMPREHENSION_LIST');
    check('both listcomps found', comps.length === 2, String(comps.length));
    check('nested comp iterable belongs to outer',
      comps.filter((c) => c.qualifiedName === 'hidden.outer.<locals>.listcomp').length === 2,
      comps.map((c) => c.qualifiedName).join(' | '));
    check('all scope ids distinct',
      new Set(o.scopes.map((s) => s.scopeId)).size === o.scopes.length);
  },
});

// ==========================================================================
// 1. Invariants pass on a correct fact set
// ==========================================================================
cases.push({
  name: 'invariants: all pass on a correct-by-construction fact set',
  run: () => {
    const o = oracleForSource(SRC_RICH, 'rich.py', 'rich');
    const facts = synthesiseFacts(o);
    for (const r of runFactInvariants(facts)) {
      check(`#${r.id} ${r.name}`, r.passed, r.violations.join(' | '));
    }
    for (const r of [invariant9a_symtableAstPairing(o), invariant9b_syntheticIterator(o),
                     invariant10_interpreterPinned(o)]) {
      check(`#${r.id} ${r.name}`, r.passed, r.violations.join(' | '));
    }
  },
});

cases.push({
  name: 'compare: perfect fact set scores 100% with zero disagreements',
  run: () => {
    const o = oracleForSource(SRC_RICH, 'rich.py', 'rich');
    const facts = synthesiseFacts(o);
    const { scores, disagreements } = compare({ oracle: o, facts });
    for (const s of scores) {
      check(`${s.entityKind} precision 1.0`, s.precision === 1, String(s.precision));
      check(`${s.entityKind} recall 1.0`, s.recall === 1, String(s.recall));
    }
    check('zero disagreements', disagreements.length === 0,
      JSON.stringify(disagreements.slice(0, 3)));
  },
});

// ==========================================================================
// 2. MUTATIONS — each must be caught
// ==========================================================================
function withFacts(fn: (o: OraclePayload, f: FactSet) => void): () => void {
  return () => {
    const o = oracleForSource(SRC_RICH, 'rich.py', 'rich');
    fn(o, synthesiseFacts(o));
  };
}

cases.push({
  name: 'mutation: dangling FK is caught (#1)',
  run: withFacts((o, base) => {
    const f = cloneFacts(base);
    f['py_binding'][0][1] = 'PY_SCOPE_' + 'f'.repeat(32);
    expectCaught('#1 dangling FK', invariant1_referentialIntegrity(f).violations, 'dangling');
  }),
});

cases.push({
  name: 'mutation: PK collision is caught (#2)',
  run: withFacts((o, base) => {
    const f = cloneFacts(base);
    f['py_scope'][1][24] = f['py_scope'][0][24];
    expectCaught('#2 PK collision', invariant2_noPkCollisions(f).violations, 'PK');
  }),
});

cases.push({
  name: 'mutation: malformed and mis-prefixed PKs are caught (#3)',
  run: withFacts((o, base) => {
    const bad = cloneFacts(base);
    bad['py_scope'][0][24] = 'NOT_A_HASH';
    expectCaught('#3 malformed PK', invariant3_prefixDiscipline(bad).violations, 'malformed');

    const wrong = cloneFacts(base);
    wrong['py_scope'][0][24] = 'PY_BINDING_' + 'a'.repeat(32);
    expectCaught('#3 wrong prefix', invariant3_prefixDiscipline(wrong).violations, 'prefix mismatch');
  }),
});

cases.push({
  name: 'mutation: missing / inconsistent serviceVersion is caught (#4)',
  run: withFacts((o, base) => {
    const empty = cloneFacts(base);
    empty['py_scope'][0][23] = '';
    expectCaught('#4 empty svc', invariant4_serviceVersion(empty).violations, 'empty');

    const mixed = cloneFacts(base);
    mixed['py_scope'][0][23] = 'SERVICE_VERSION_' + 'b'.repeat(32);
    expectCaught('#4 mixed svc', invariant4_serviceVersion(mixed).violations, 'multiple');
  }),
});

cases.push({
  name: 'mutation: wrong column count is caught (#6)',
  run: withFacts((o, base) => {
    const f = cloneFacts(base);
    f['py_scope'][0].push('EXTRA');
    expectCaught('#6 arity drift', invariant6_columnCount(f).violations, 'expected 25');

    const short = cloneFacts(base);
    short['py_binding'][0].pop();
    expectCaught('#6 short row', invariant6_columnCount(short).violations, 'expected 29');
  }),
});

cases.push({
  name: 'mutation: unresolved expression scope is caught (#7)',
  run: withFacts((o, base) => {
    const f = cloneFacts(base);
    const row = new Array(35).fill('');
    row[24] = 'PY_SCOPE_' + 'c'.repeat(32); // scope that does not exist
    row[34] = 'PY_EXPRESSION_' + 'd'.repeat(32);
    f['py_expression'] = [row];
    expectCaught('#7 unresolved scope', invariant7_ownershipTotality(f).violations, 'unresolved');
  }),
});

cases.push({
  name: 'mutation: scope cycle and multi-root are caught (#8)',
  run: withFacts((o, base) => {
    const cyc = cloneFacts(base);
    const a = cyc['py_scope'][0][24];
    const b = cyc['py_scope'][1][24];
    cyc['py_scope'][0][4] = b;
    cyc['py_scope'][1][4] = a;
    expectCaught('#8 cycle', invariant8_scopeForest(cyc).violations);

    const multi = cloneFacts(base);
    multi['py_scope'][1][4] = ''; // second root in the same module
    expectCaught('#8 two roots', invariant8_scopeForest(multi).violations, 'root scopes');
  }),
});

cases.push({
  name: 'mutation: broken symtable/ast pairing is caught (#9a)',
  run: () => {
    const o = oracleForSource(SRC_RICH, 'rich.py', 'rich');

    // (a) an unpaired node — startColumn cannot be trusted at all
    const unpaired: OraclePayload = JSON.parse(JSON.stringify(o));
    const t = unpaired.pairing.find((p) => p.symtableChildren.length >= 1)!;
    t.unpaired = ['ast node function:lambda@9:4 has no symtable child'];
    expectCaught('#9a unpaired node', invariant9a_symtableAstPairing(unpaired).violations,
      'no symtable child');

    // (b) pairing disagrees with symtable on identity
    const mism: OraclePayload = JSON.parse(JSON.stringify(o));
    const m = mism.pairing.find((p) => p.pairedColumns.length >= 1)!;
    m.pairedColumns[0]!.name = '__wrong__';
    expectCaught('#9a identity mismatch', invariant9a_symtableAstPairing(mism).violations,
      'against symtable');

    // (c) THE POINT: two children indistinguishable to symtable AND sharing a
    //     column — startColumn cannot disambiguate, so the PKs would collide.
    const ambiguous: OraclePayload = JSON.parse(JSON.stringify(o));
    const target = ambiguous.pairing.find((p) => p.pairedColumns.length >= 2)!;
    target.pairedColumns[1] = { ...target.pairedColumns[0]! };
    target.symtableChildren[1] = { ...target.symtableChildren[0]! };
    expectCaught('#9a ambiguous column', invariant9a_symtableAstPairing(ambiguous).violations,
      'PK collision');

    // (d) arity divergence
    const dropped: OraclePayload = JSON.parse(JSON.stringify(o));
    const d = dropped.pairing.find((p) => p.symtableChildren.length >= 1)!;
    d.symtableChildren.pop();
    d.pairedColumns.pop();
    expectCaught('#9a arity divergence', invariant9a_symtableAstPairing(dropped).violations);
  },
});

cases.push({
  name: "mutation: missing and stray '.0' are both caught (#9b)",
  run: () => {
    const o = oracleForSource(SRC_RICH, 'rich.py', 'rich');

    // (a) REMOVE a '.0' from a comprehension scope. A whitelist would pass this;
    //     a positive assertion must not.
    const missing: OraclePayload = JSON.parse(JSON.stringify(o));
    const compScope = missing.scopes.find((s) => s.scopeKind.startsWith('COMPREHENSION'))!;
    missing.bindings = missing.bindings.filter(
      (b) => !(b.scopeId === compScope.scopeId && b.name === '.0')
    );
    expectCaught("#9b missing '.0'", invariant9b_syntheticIterator(missing).violations,
      'expected exactly one');

    // (b) ADD one to a plain function scope.
    const stray: OraclePayload = JSON.parse(JSON.stringify(o));
    const fnScope = stray.scopes.find((s) => s.scopeKind === 'FUNCTION')!;
    stray.bindings.push({ scopeId: fnScope.scopeId, name: '.0', isSynthetic: true });
    expectCaught("#9b stray '.0'", invariant9b_syntheticIterator(stray).violations,
      'outside a comprehension');
  },
});

cases.push({
  name: 'mutation: provenance defects are caught (#10)',
  run: () => {
    const o = oracleForSource(SRC_RICH, 'rich.py', 'rich');
    const relative: OraclePayload = JSON.parse(JSON.stringify(o));
    relative.provenance.interpreterPath = 'python3';
    expectCaught('#10 non-absolute interpreter',
      invariant10_interpreterPinned(relative).violations, 'absolute');

    const wrongRegime: OraclePayload = JSON.parse(JSON.stringify(o));
    wrongRegime.provenance.emissionRegime = 'PY3_12_PLUS';
    expectCaught('#10 wrong regime', invariant10_interpreterPinned(wrongRegime).violations,
      'PY3_12_PLUS');

    const noVersion: OraclePayload = JSON.parse(JSON.stringify(o));
    noVersion.provenance.sysVersion = '';
    expectCaught('#10 missing sysVersion', invariant10_interpreterPinned(noVersion).violations);
  },
});

cases.push({
  name: 'invariant #11 delegates to gen_decls.py --check',
  run: () => {
    const workdir = path.resolve(__dirname, '..', '..', '..', '..', 'python-work');
    let out = '';
    let code = 0;
    try {
      out = execFileSync('python3', ['gen_decls.py', '--check'], {
        cwd: workdir, encoding: 'utf-8',
      });
    } catch (e) {
      const err = e as { status?: number; stdout?: string; message?: string };
      code = err.status ?? 1;
      out = err.stdout ?? err.message ?? '';
    }
    const r = invariant11_schemaAgreement(out, code);
    check('#11 schema/declaration agreement', r.passed, r.violations.join(' | '));
    expectCaught('#11 catches a non-zero exit',
      invariant11_schemaAgreement('drift detected', 1).violations, 'drift');
  },
});

// ==========================================================================
// 3. Comparison arithmetic — the numbers the report will quote
// ==========================================================================
cases.push({
  name: 'compare: precision/recall arithmetic and classification',
  run: withFacts((o, base) => {
    // drop a binding -> recall < 1, one MISSING
    const dropped = cloneFacts(base);
    const removed = dropped['py_binding'].pop()!;
    let r = compare({ oracle: o, facts: dropped });
    const bind = r.scores.find((s) => s.entityKind === 'py_binding')!;
    check('recall drops when a binding is missing', bind.recall < 1, String(bind.recall));
    check('precision stays 1 when only dropping', bind.precision === 1, String(bind.precision));
    check('classified MISSING', r.disagreements.some((d) => d.klass === 'MISSING'),
      JSON.stringify(r.disagreements.slice(0, 2)));

    // add a bogus binding -> precision < 1, one SPURIOUS
    const added = cloneFacts(base);
    const bogus = [...removed];
    bogus[0] = '__totally_invented__';
    bogus[28] = 'PY_BINDING_' + 'e'.repeat(32);
    added['py_binding'].push(bogus);
    r = compare({ oracle: o, facts: added });
    const bind2 = r.scores.find((s) => s.entityKind === 'py_binding')!;
    check('precision drops on a spurious row', bind2.precision < 1, String(bind2.precision));
    check('classified SPURIOUS', r.disagreements.some((d) => d.klass === 'SPURIOUS'));

    // flip a predicate -> PREDICATE_MISMATCH, but counts unchanged
    const flipped = cloneFacts(base);
    flipped['py_binding'][0][4] = flipped['py_binding'][0][4] === 'true' ? 'false' : 'true';
    r = compare({ oracle: o, facts: flipped });
    check('predicate flip classified',
      r.disagreements.some((d) => d.klass === 'PREDICATE_MISMATCH'),
      JSON.stringify(r.disagreements.slice(0, 2)));
    const bind3 = r.scores.find((s) => s.entityKind === 'py_binding')!;
    check('predicate flip does not change recall', bind3.recall === 1, String(bind3.recall));

    // corrupt a startColumn -> the scope no longer matches: MISSING + SPURIOUS
    const shifted = cloneFacts(base);
    const li = shifted['py_scope'].findIndex((row) => row[0] === 'LAMBDA' || row[0].startsWith('COMPREHENSION'));
    if (li >= 0) {
      shifted['py_scope'][li][19] = String(Number(shifted['py_scope'][li][19]) + 7);
      r = compare({ oracle: o, facts: shifted });
      check('startColumn corruption surfaces',
        r.disagreements.some((d) => d.entityKind === 'py_scope'),
        'no py_scope disagreement reported');
    }

    check('summary renders', summarise(r.scores, r.disagreements).includes('py_scope'));
  }),
});

// ==========================================================================
// 4. Golden files
// ==========================================================================
cases.push({
  name: 'golden: deterministic render, provenance carried, regime mismatch refused',
  run: () => {
    const o = oracleForSource(SRC_RICH, 'rich.py', 'rich');
    const g1 = buildGolden(SRC_RICH, 'rich.py', o);
    const g2 = buildGolden(SRC_RICH, 'rich.py', oracleForSource(SRC_RICH, 'rich.py', 'rich'));
    check('golden render is byte-identical', renderGolden(g1) === renderGolden(g2));
    check('interpreter path recorded', g1.generatedFrom.interpreterPath.startsWith('/'));
    check('sys.version recorded', g1.generatedFrom.sysVersion.includes('3.10.4'),
      g1.generatedFrom.sysVersion);
    check('source hash recorded', /^[0-9a-f]{64}$/.test(g1.sourceSha256));

    const foreign = { ...o.provenance, emissionRegime: 'PY3_12_PLUS', sysVersion: '3.12.4 ...' };
    const problems = assertGoldenMatchesEnvironment(g1, foreign);
    expectCaught('golden refuses a foreign regime', problems, 'regenerate');
  },
});

// ==========================================================================

function main(): number {
  console.log('Python oracle — harness self-test');
  console.log('='.repeat(72));
  for (const c of cases) {
    try {
      c.run();
      console.log(`  ran  ${c.name}`);
    } catch (e) {
      failures.push(`${c.name}: THREW ${(e as Error).message}`);
      console.log(`  FAIL ${c.name} (threw)`);
    }
  }
  console.log('='.repeat(72));
  console.log(`assertions passed: ${passes.length}`);
  if (failures.length) {
    console.log(`assertions FAILED: ${failures.length}`);
    for (const f of failures) console.log(`   - ${f}`);
    return 1;
  }
  console.log('all harness self-tests passed');
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

export { main as runHarnessSelfTest };
