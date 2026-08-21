/**
 * ORACLE SEMANTICS TESTS.
 *
 * The companion to harness-self-test.ts. That file asks "does the harness catch
 * a defect?"; this one asks "does the oracle report CPython's model correctly?"
 *
 * On hand-written expectations: the project rule is that nobody hand-writes
 * expected FACTS. These tests do not. They assert structural RELATIONSHIPS that
 * CPython's own model guarantees — a parameter is local to its function, a free
 * variable is free, a comprehension target does not leak on PY3_0_11. If CPython
 * disagrees with one of these, the assertion is wrong and I want to find out;
 * that is the point of testing the arbiter rather than trusting it.
 */

import {
  invariant9a_symtableAstPairing,
  invariant9b_syntheticIterator,
} from '../harness/invariants';
import {
  introspectModule,
  introspectionSelfCheck,
  tierFor,
} from '../harness/classification';
import { oracleForSource, oracleRawForSource } from '../harness/oracle-runner';
import { OracleBinding, OraclePayload, OracleScope } from '../harness/types';

interface IntrospectedRow {
  class: string;
  typeCategoryCandidates: string[];
  categoryCollision: boolean;
  typeModifier: string[];
  methods: { name: string; descriptorKind: string; isAbstract: boolean }[];
}

const failures: string[] = [];
const passes: string[] = [];

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passes.push(name);
  else failures.push(`${name}${detail ? ': ' + detail : ''}`);
}

function load(src: string, name: string): OraclePayload {
  const o = oracleForSource(src, `${name}.py`, name);
  if (o.fatal) {
    failures.push(`${name}: oracle returned fatal ${o.fatal} ${JSON.stringify(o.detail ?? '')}`);
  }
  for (const e of o.errors ?? []) {
    failures.push(`${name}: oracle internal error ${e.kind} — ${e.detail}`);
  }
  // structural invariants must hold on every sample in this file
  for (const r of [invariant9a_symtableAstPairing(o), invariant9b_syntheticIterator(o)]) {
    if (!r.passed) failures.push(`${name}: invariant #${r.id} — ${r.violations[0]}`);
  }
  return o;
}

function scope(o: OraclePayload, pred: (s: OracleScope) => boolean): OracleScope | undefined {
  return o.scopes.find(pred);
}
function binding(o: OraclePayload, scopeId: string, name: string): OracleBinding | undefined {
  return o.bindings.find((b) => b.scopeId === scopeId && b.name === name);
}
function pred(b: OracleBinding | undefined, p: string): boolean {
  return b ? b[p] === true : false;
}

interface Case { name: string; run: () => void }
const cases: Case[] = [];

// ==========================================================================
// Binding kinds — the 11 predicates are py_binding c4..c14
// ==========================================================================

cases.push({
  name: 'bindings: parameters',
  run: () => {
    const o = load(
      'def f(a, /, b, *args, c=1, **kw):\n    return a, b, args, c, kw\n', 'params');
    const f = scope(o, (s) => s.name === 'f')!;
    for (const n of ['a', 'b', 'args', 'c', 'kw']) {
      const bd = binding(o, f.scopeId, n);
      check(`param ${n} exists`, !!bd);
      check(`param ${n} is_parameter`, pred(bd, 'is_parameter'));
      check(`param ${n} is_local`, pred(bd, 'is_local'));
      check(`param ${n} not global`, !pred(bd, 'is_global'));
    }
  },
});

cases.push({
  name: 'bindings: closures produce free variables and cells',
  run: () => {
    const o = load(
      'def outer():\n    captured = 1\n    def inner():\n        return captured\n    return inner\n',
      'closure');
    const inner = scope(o, (s) => s.name === 'inner')!;
    const outer = scope(o, (s) => s.name === 'outer')!;
    const free = binding(o, inner.scopeId, 'captured');
    check('captured is free in inner', pred(free, 'is_free'));
    check('captured is not local in inner', !pred(free, 'is_local'));
    check('captured is local in outer', pred(binding(o, outer.scopeId, 'captured'), 'is_local'));
    check('inner is nested', inner.isNested);
  },
});

cases.push({
  name: 'bindings: global and nonlocal statements',
  run: () => {
    const o = load(
      'G = 0\n' +
      'def setg():\n    global G\n    G = 1\n' +
      'def outer():\n    n = 0\n    def inner():\n        nonlocal n\n        n = 2\n    return inner\n',
      'globals');
    const setg = scope(o, (s) => s.name === 'setg')!;
    const g = binding(o, setg.scopeId, 'G');
    check('G is_declared_global in setg', pred(g, 'is_declared_global'));
    check('G is_global in setg', pred(g, 'is_global'));
    check('G is not local in setg', !pred(g, 'is_local'));
    check('setg.declaresGlobal', setg.declaresGlobal);

    const inner = scope(o, (s) => s.name === 'inner')!;
    const n = binding(o, inner.scopeId, 'n');
    check('n is_nonlocal in inner', pred(n, 'is_nonlocal'));
    check('inner.declaresNonlocal', inner.declaresNonlocal);
  },
});

cases.push({
  name: 'bindings: imports',
  run: () => {
    const o = load(
      'import os\nimport os.path as osp\nfrom sys import argv\nfrom json import loads as L\n',
      'imports');
    const mod = scope(o, (s) => s.scopeKind === 'MODULE')!;
    for (const n of ['os', 'osp', 'argv', 'L']) {
      const b = binding(o, mod.scopeId, n);
      check(`${n} bound at module scope`, !!b);
      check(`${n} is_imported`, pred(b, 'is_imported'));
    }
    check('dotted import binds the ROOT name only',
      !!binding(o, mod.scopeId, 'os') && !binding(o, mod.scopeId, 'os.path'));
    const imports = o.structure.imports as Record<string, unknown>[];
    check('alias recorded for os.path as osp',
      imports.some((i) => i.importedPath === 'os.path' && i.bound === 'osp'),
      JSON.stringify(imports));
  },
});

cases.push({
  name: 'bindings: comprehension targets are scoped, not leaked (PY3_0_11)',
  run: () => {
    const o = load(
      'def f(xs):\n' +
      '    a = [i for i in xs]\n' +
      '    b = {j for j in xs}\n' +
      '    c = {k: k for k in xs}\n' +
      '    d = (m for m in xs)\n' +
      '    return a, b, c, d\n',
      'comps');
    const f = scope(o, (s) => s.name === 'f')!;
    for (const leaked of ['i', 'j', 'k', 'm']) {
      check(`${leaked} does NOT leak into f`, !binding(o, f.scopeId, leaked),
        `found ${leaked} in f — that is PY2/PY3_12 behaviour, not PY3_0_11`);
    }
    const kinds = o.scopes.map((s) => s.scopeKind);
    for (const k of ['COMPREHENSION_LIST', 'COMPREHENSION_SET', 'COMPREHENSION_DICT',
                     'GENERATOR_EXPRESSION']) {
      check(`${k} scope emitted`, kinds.includes(k), kinds.join(','));
    }
    // each comprehension scope owns its target and exactly one '.0'
    for (const s of o.scopes.filter((x) => x.scopeKind.startsWith('COMPREHENSION') ||
                                            x.scopeKind === 'GENERATOR_EXPRESSION')) {
      const dots = o.bindings.filter((b) => b.scopeId === s.scopeId && b.name === '.0');
      check(`${s.scopeKind} has exactly one '.0'`, dots.length === 1, String(dots.length));
    }
  },
});

cases.push({
  name: 'bindings: walrus, except-as, with-as, for, tuple unpack, star target',
  run: () => {
    const o = load(
      'def f(xs, path):\n' +
      '    if (w := len(xs)) > 0:\n        pass\n' +
      '    try:\n        pass\n    except ValueError as exc:\n        pass\n' +
      '    with open(path) as fh:\n        pass\n' +
      '    for item in xs:\n        pass\n' +
      '    p, q = xs\n' +
      '    first, *rest = xs\n' +
      '    return w, fh, item, p, q, first, rest\n',
      'targets');
    const f = scope(o, (s) => s.name === 'f')!;
    for (const n of ['w', 'exc', 'fh', 'item', 'p', 'q', 'first', 'rest']) {
      const b = binding(o, f.scopeId, n);
      check(`${n} bound in f`, !!b, 'missing');
      check(`${n} is_local`, pred(b, 'is_local'));
      check(`${n} is_assigned`, pred(b, 'is_assigned'));
    }
  },
});

cases.push({
  name: 'bindings: class scope is not a closure scope',
  run: () => {
    // A class body does NOT participate in closures: a method cannot see class
    // attributes as free variables. Getting this wrong would silently invent
    // resolutions the runtime does not have.
    const o = load(
      'def outer():\n' +
      '    v = 1\n' +
      '    class K:\n' +
      '        attr = v\n' +
      '        def m(self):\n            return attr\n' +
      '    return K\n',
      'classscope');
    const k = scope(o, (s) => s.name === 'K')!;
    const m = scope(o, (s) => s.name === 'm')!;
    check('class K is a CLASS scope', k.scopeKind === 'CLASS');
    check('attr is local to the class body', pred(binding(o, k.scopeId, 'attr'), 'is_local'));
    const inM = binding(o, m.scopeId, 'attr');
    check('attr is GLOBAL (not free) inside the method', pred(inM, 'is_global'),
      'class attributes are not closure cells — a method sees `attr` as a global');
    check('attr is not free inside the method', !pred(inM, 'is_free'));
    check('v IS free in the class body', pred(binding(o, k.scopeId, 'v'), 'is_free'));
  },
});

cases.push({
  name: 'bindings: annotated-only declaration binds without assigning',
  run: () => {
    const o = load('def f():\n    x: int\n    y: int = 1\n    z = 2\n    return y, z\n', 'annonly');
    const f = scope(o, (s) => s.name === 'f')!;
    const x = binding(o, f.scopeId, 'x');
    const y = binding(o, f.scopeId, 'y');
    const z = binding(o, f.scopeId, 'z');
    check('x is annotated', pred(x, 'is_annotated'));
    // COUNTER-INTUITIVE, verified against CPython 3.10.4: a bare `x: int` with
    // NO value still reports is_assigned=True — the annotation reserves the
    // local slot. My first version of this test asserted the opposite and was
    // wrong; had it been hand-written into a golden file it would have shipped.
    check('x is_assigned despite having no value (CPython behaviour)',
      pred(x, 'is_assigned'));
    check('x is local', pred(x, 'is_local'));
    check('x is NOT referenced', !pred(x, 'is_referenced'));
    check('y is annotated and assigned', pred(y, 'is_annotated') && pred(y, 'is_assigned'));
    check('z is assigned but not annotated',
      pred(z, 'is_assigned') && !pred(z, 'is_annotated'));
  },
});

cases.push({
  name: 'bindings: def and class bind a namespace in the parent scope',
  run: () => {
    const o = load('def f(): pass\nclass K: pass\nlam = lambda: 1\n', 'namespaces');
    const mod = scope(o, (s) => s.scopeKind === 'MODULE')!;
    check('f is_namespace', pred(binding(o, mod.scopeId, 'f'), 'is_namespace'));
    check('K is_namespace', pred(binding(o, mod.scopeId, 'K'), 'is_namespace'));
    check('lam is assigned but NOT a namespace',
      pred(binding(o, mod.scopeId, 'lam'), 'is_assigned') &&
        !pred(binding(o, mod.scopeId, 'lam'), 'is_namespace'),
      'a lambda bound to a name is a value, not a declared namespace');
  },
});

// ==========================================================================
// Scope-tree hazards — permanent regressions for bugs the sweep found
// ==========================================================================

cases.push({
  name: 'regression: scopes hidden in defaults/decorators/annotations/bases',
  run: () => {
    const o = load(
      'def outer():\n' +
      "    @d(lambda: 'DEC')\n" +
      "    def f(x=lambda: 'DEF', *, y: C[lambda: 'ANN'] = 2): pass\n" +
      '    class K(Base(lambda: 1), metaclass=Meta(lambda: 2)): pass\n' +
      '    return [q for q in [r for r in z]]\n',
      'hidden');
    const lams = o.scopes.filter((s) => s.scopeKind === 'LAMBDA');
    check('all five hidden lambdas found', lams.length === 5, String(lams.length));
    check('every hidden lambda is a child of outer, never of f or K',
      lams.every((l) => l.qualifiedName === 'hidden.outer.<locals>.lambda'),
      lams.map((l) => l.qualifiedName).join(' | '));
    check('hidden lambdas have distinct positions',
      new Set(lams.map((l) => `${l.startLine}:${l.startColumn}`)).size === 5);
    const comps = o.scopes.filter((s) => s.scopeKind === 'COMPREHENSION_LIST');
    check('both listcomps are children of outer', comps.length === 2 &&
      comps.every((c) => c.qualifiedName === 'hidden.outer.<locals>.listcomp'),
      comps.map((c) => c.qualifiedName).join(' | '));
    check('all scope ids distinct',
      new Set(o.scopes.map((s) => s.scopeId)).size === o.scopes.length);
  },
});

cases.push({
  name: 'regression: same-line siblings are separated by startColumn',
  run: () => {
    const o = load(
      'g = (lambda: 1, lambda: 2)\n' +
      'h = [x for x in a] + [y for y in b]\n' +
      'k = ((i for i in a), (j for j in b))\n',
      'sameline');
    const groups: Record<string, OracleScope[]> = {};
    for (const s of o.scopes) (groups[`${s.scopeKind}@${s.startLine}`] ??= []).push(s);
    for (const [k, v] of Object.entries(groups)) {
      if (v.length > 1) {
        check(`${k}: ${v.length} same-line siblings have distinct columns`,
          new Set(v.map((s) => s.startColumn)).size === v.length,
          v.map((s) => s.startColumn).join(','));
      }
    }
    check('all scope ids distinct',
      new Set(o.scopes.map((s) => s.scopeId)).size === o.scopes.length,
      `${new Set(o.scopes.map((s) => s.scopeId)).size} vs ${o.scopes.length}`);
    check('six scopes beyond module', o.scopes.length === 7, String(o.scopes.length));
  },
});

cases.push({
  name: 'regression: deeply nested scopes keep a correct qualname chain',
  run: () => {
    const o = load(
      'class A:\n    class B:\n        def m(self):\n' +
      '            def n():\n                return lambda: [q for q in x]\n            return n\n',
      'deep');
    const lam = scope(o, (s) => s.scopeKind === 'LAMBDA')!;
    check('lambda qualname threads <locals> correctly',
      lam.qualifiedName === 'deep.A.B.m.<locals>.n.<locals>.lambda', lam.qualifiedName);
    const comp = scope(o, (s) => s.scopeKind === 'COMPREHENSION_LIST')!;
    check('comprehension is a child of the lambda',
      comp.qualifiedName.endsWith('lambda.<locals>.listcomp'), comp.qualifiedName);
    check('depths increase monotonically along the chain',
      o.scopes.map((s) => s.nestingDepth).join(',') === '0,1,2,3,4,5,6',
      o.scopes.map((s) => s.nestingDepth).join(','));
  },
});

// ==========================================================================
// Imprecision must be visible, never invented
// ==========================================================================

cases.push({
  name: 'escape hatches: wildcard import is flagged on the scope that has it',
  run: () => {
    // `import *` is ONLY legal at module level in Python 3 — a function-local
    // wildcard is a SyntaxError, which the first draft of this test tripped over.
    const o = load('from x import *\ndef f():\n    return 1\n', 'wild');
    const mod = scope(o, (s) => s.scopeKind === 'MODULE')!;
    const f = scope(o, (s) => s.name === 'f')!;
    check('module scope flags the wildcard import', mod.usesWildcardImport);
    check('function scope does not', !f.usesWildcardImport);

    const illegal = oracleForSource(
      'def f():\n    from y import *\n', 'illegalwild.py', 'illegalwild');
    check('function-local wildcard is a SyntaxError, reported cleanly',
      illegal.fatal === 'SYNTAX_ERROR', JSON.stringify(illegal.fatal));
  },
});

cases.push({
  name: 'escape hatches: dynamic access and passthrough are visible in structure',
  run: () => {
    const o = load(
      'def f(o, *args, **kwargs):\n' +
      '    getattr(o, "m")()\n' +
      '    setattr(o, "a", 1)\n' +
      '    return o.handle(*args, **kwargs)\n',
      'dynamic');
    const calls = o.structure.calls as Record<string, unknown>[];
    check('getattr recorded', calls.some((c) => c.callee === 'getattr'));
    check('setattr recorded', calls.some((c) => c.callee === 'setattr'));
    const handle = calls.find((c) => c.callee === 'handle')!;
    check('star-args marked on the call', handle.hasStarArgs === true);
    check('double-star marked on the call', handle.hasDoubleStarArgs === true);
    const fn = (o.structure.functions as Record<string, unknown>[])[0]!;
    check('function records *args', fn.hasVarArgs === true);
    check('function records **kwargs', fn.hasKwArgs === true);
  },
});

cases.push({
  name: 'attribute writes: self.* across methods, and foreign objects',
  run: () => {
    const o = load(
      'class C:\n' +
      '    def __init__(self):\n        self.a = 1\n        self.b = 2\n' +
      '    def reset(self):\n        self.a = 0\n' +
      '    def touch(self, other):\n        other.z = 9\n',
      'attrs');
    const w = o.attributeWrites as Record<string, unknown>[];
    const selfA = w.filter((x) => x.attribute === 'a' && x.origin === 'SELF_ASSIGN');
    check('self.a written in two methods', selfA.length === 2, String(selfA.length));
    check('the two writes are in different methods',
      new Set(selfA.map((x) => x.method)).size === 2);
    check('only one of them is __init__',
      selfA.filter((x) => x.method === '__init__').length === 1);
    check('foreign write classified OTHER_OBJECT',
      w.some((x) => x.attribute === 'z' && x.origin === 'OTHER_OBJECT'),
      JSON.stringify(w));
  },
});

// ==========================================================================
// Robustness
// ==========================================================================

cases.push({
  name: 'robustness: degenerate and edge-case inputs',
  run: () => {
    const empty = oracleForSource('', 'empty.py', 'empty');
    check('empty file yields one module scope',
      !empty.fatal && empty.scopes.length === 1, JSON.stringify(empty.fatal ?? empty.scopes.length));

    const doc = load('"""just a docstring."""\n', 'doconly');
    check('docstring-only file is clean', doc.errors.length === 0);

    const uni = load('def \u00e9l\u00e8ve():\n    caf\u00e9 = 1\n    return caf\u00e9\n', 'unicode');
    check('unicode identifiers survive',
      !!scope(uni, (s) => s.name === '\u00e9l\u00e8ve'),
      uni.scopes.map((s) => s.name).join(','));

    // >32767 chars: ast has no such limit, but tree-sitter's direct-string path
    // does (see python-work/HANDOFF-parser-core-32k.md). The ORACLE must not
    // inherit that constraint, or it cannot adjudicate large files at all.
    const big = 'def f0(): pass\n' + Array.from({ length: 4000 },
      (_, i) => `def g${i}(): return ${i}\n`).join('');
    check('generated source exceeds the tree-sitter string limit', big.length > 32767,
      String(big.length));
    const bigO = oracleForSource(big, 'big.py', 'big');
    check('oracle handles a >32KB file', !bigO.fatal && bigO.scopes.length === 4002,
      JSON.stringify(bigO.fatal ?? bigO.scopes.length));
  },
});

cases.push({
  name: 'robustness: syntax errors are structured, not thrown',
  run: () => {
    const bad = oracleForSource('def f(\n', 'broken.py', 'broken');
    check('syntax error reported as fatal SYNTAX_ERROR', bad.fatal === 'SYNTAX_ERROR',
      JSON.stringify(bad.fatal));
    check('provenance still present on failure', !!bad.provenance?.interpreterPath);

    // Python 2 source: tree-sitter parses it happily, CPython 3.10 does not.
    // The oracle must say so cleanly — this is what the Py2 REJECTION path
    // (schema §6.2) keys off.
    const py2 = oracleForSource('print "hello"\n', 'py2.py', 'py2');
    check('python 2 source reports SYNTAX_ERROR', py2.fatal === 'SYNTAX_ERROR',
      JSON.stringify(py2.fatal));
  },
});

cases.push({
  name: 'robustness: determinism across many shapes',
  run: () => {
    const samples = [
      'x = 1\n',
      'def f():\n    return [i for i in range(3)]\n',
      'class A:\n    def m(self): pass\n',
      'g = (lambda: 1, lambda: 2)\n',
    ];
    for (const [i, s] of samples.entries()) {
      const a = oracleRawForSource(s, `d${i}.py`);
      const b = oracleRawForSource(s, `d${i}.py`);
      check(`sample ${i} byte-identical across processes`, a === b);
    }
  },
});

// ==========================================================================
// Field classification: tiers 1 and 2
// ==========================================================================

cases.push({
  name: 'tier 1: importKind is decided by ast node shape alone',
  run: () => {
    const o = load(
      'import os\n' +
      'import os.path as osp\n' +
      'from sys import argv\n' +
      'from json import loads as L\n' +
      'from mod import *\n' +
      'from . import sib\n' +
      'from .rel import thing\n' +
      'from .rel import thing as aliased\n' +
      'from __future__ import annotations\n',
      'impkinds');
    const byName: Record<string, { tier1: Record<string, string>; residue?: string }> = {};
    for (const c of (o as unknown as { classifications: { entity: string; name: string;
        tier1: Record<string, string>; residue?: string }[] }).classifications) {
      if (c.entity === 'py_import') byName[c.name] = c;
    }
    const expect: [string, string][] = [
      ['os', 'MODULE_IMPORT'], ['osp', 'MODULE_IMPORT_ALIAS'],
      ['argv', 'FROM_MEMBER'], ['L', 'FROM_MEMBER_ALIAS'],
      ['*', 'FROM_WILDCARD'], ['sib', 'RELATIVE_MEMBER'],
      ['thing', 'RELATIVE_MEMBER'], ['annotations', 'FUTURE'],
    ];
    for (const [name, kind] of expect) {
      check(`importKind ${name} = ${kind}`, byName[name]?.tier1?.importKind === kind,
        String(byName[name]?.tier1?.importKind));
      check(`importKind ${name} is tier 1`, tierFor('importKind', kind) === 'TIER_1_AST');
    }
    // the enum gap must be REPORTED, not papered over
    check('relative+alias reports the RELATIVE_MEMBER_ALIAS enum gap',
      byName['aliased']?.residue === 'RELATIVE_MEMBER_ALIAS',
      String(byName['aliased']?.residue));
  },
});

cases.push({
  name: 'tier 1: methodKind refuses to resolve decorator-driven cases',
  run: () => {
    const o = load(
      'class K:\n' +
      '    def __init__(self): pass\n' +
      '    def __new__(cls): pass\n' +
      '    def __repr__(self): return ""\n' +
      '    def plain(self): pass\n' +
      '    def gen(self):\n        yield 1\n' +
      '    async def coro(self): pass\n' +
      '    async def agen(self):\n        yield 1\n' +
      '    @staticmethod\n    def st(): pass\n' +
      '    @unknown_deco\n    def weird(self): pass\n' +
      'def top(): pass\n' +
      'def outer():\n    def inner(): pass\n    return inner\n',
      'mkinds');
    const by: Record<string, { tier1: Record<string, string>; residue?: string }> = {};
    for (const c of (o as unknown as { classifications: { entity: string; name: string;
        tier1: Record<string, string>; residue?: string }[] }).classifications) {
      if (c.entity === 'py_method') by[c.name] = c;
    }
    const structural: [string, string][] = [
      ['__init__', 'CONSTRUCTOR'], ['__new__', 'ALLOCATOR'], ['__repr__', 'DUNDER_METHOD'],
      ['plain', 'INSTANCE_METHOD'], ['gen', 'GENERATOR'], ['coro', 'ASYNC_FUNCTION'],
      ['agen', 'ASYNC_GENERATOR'], ['top', 'FUNCTION'], ['inner', 'NESTED_FUNCTION'],
    ];
    for (const [n, k] of structural) {
      check(`methodKind ${n} = ${k}`, by[n]?.tier1?.methodKind === k,
        String(by[n]?.tier1?.methodKind));
    }
    // decorated cases must be handed on, NOT guessed
    check('@staticmethod is deferred as residue, not resolved by ast',
      (by['st']?.residue ?? '').includes('staticmethod'), String(by['st']?.residue));
    check('unrecognised decorator is deferred as residue',
      (by['weird']?.residue ?? '').includes('unknown_deco'), String(by['weird']?.residue));
    check('STATIC_METHOD is labelled tier 2',
      tierFor('methodKind', 'STATIC_METHOD') === 'TIER_2_INTROSPECTION');
    check('CONSTRUCTOR is labelled tier 1',
      tierFor('methodKind', 'CONSTRUCTOR') === 'TIER_1_AST');
  },
});

cases.push({
  name: 'tier 1: typeModifier emits ONLY what has no runtime trace',
  run: () => {
    const o = load(
      'import typing\n@typing.final\nclass F:\n    __slots__ = ("a",)\n' +
      'class Plain: pass\n',
      'tmods');
    const by: Record<string, { tier1: { typeModifier: string[] } }> = {};
    for (const c of (o as unknown as { classifications: { entity: string; name: string;
        tier1: { typeModifier: string[] } }[] }).classifications) {
      if (c.entity === 'py_type') by[c.name] = c;
    }
    check('FINAL emitted from ast (no runtime trace on 3.10)',
      by['F']?.tier1?.typeModifier.includes('FINAL'), JSON.stringify(by['F']?.tier1));
    check('SLOTS emitted from ast', by['F']?.tier1?.typeModifier.includes('SLOTS'));
    check('plain class gets no ast modifiers', by['Plain']?.tier1?.typeModifier.length === 0);
    check('ABSTRACT is NOT emitted by tier 1 (it is tier 2)',
      !by['F']?.tier1?.typeModifier.includes('ABSTRACT'));
    check('FINAL is labelled tier 1', tierFor('typeModifier', 'FINAL') === 'TIER_1_AST');
    check('FROZEN is labelled tier 2',
      tierFor('typeModifier', 'FROZEN') === 'TIER_2_INTROSPECTION');
  },
});

cases.push({
  name: 'tier 2: introspection is stdlib-scoped and refuses third-party',
  run: () => {
    const sc = introspectionSelfCheck();
    check('introspection self-check passes', sc.ok, sc.problems.join(' | '));
    // the capability gaps that FORCED these values into tier 1
    check('typing.get_overloads absent on 3.10 (so OVERLOAD_STUB cannot be tier 2)',
      sc.capabilityGaps['typing.get_overloads'] === false);
    check('typing.final leaves no attribute on 3.10 (so FINAL cannot be tier 2)',
      sc.capabilityGaps['typing.final sets __final__'] === false);

    const refused = introspectModule('pip') as { refused?: string };
    check('third-party module is REFUSED', typeof refused.refused === 'string',
      JSON.stringify(refused).slice(0, 120));
    check('refusal names the reason',
      (refused.refused ?? '').includes('third-party') || (refused.refused ?? '').includes('REFUSED'),
      String(refused.refused));
  },
});

cases.push({
  name: 'tier 2: typeCategory / typeModifier / methodKind from descriptors',
  run: () => {
    const rows = introspectModule('json.decoder') as IntrospectedRow[];
    check('json.decoder yields classes', Array.isArray(rows) && rows.length > 0);
    const err = rows.find((r) => r.class === 'JSONDecodeError');
    check('JSONDecodeError detected as an exception',
      err?.typeCategoryCandidates.includes('EXCEPTION_CLASS_TYPE') === true,
      JSON.stringify(err?.typeCategoryCandidates));

    // collisions are REPORTED, never silently resolved
    const proto = introspectModule('typing') as IntrospectedRow[];
    const collisions = proto.filter((r) => r.categoryCollision);
    check('typing has category collisions and they are flagged', collisions.length > 0,
      String(collisions.length));
    const p = collisions.find((r) => r.class === 'Protocol');
    check('Protocol reports ALL applicable categories, not a winner',
      (p?.typeCategoryCandidates.length ?? 0) >= 2,
      JSON.stringify(p?.typeCategoryCandidates));
    check('a collision is therefore a tier-3 question',
      tierFor('typeCategory') === 'TIER_2_INTROSPECTION');
  },
});

// ==========================================================================

function main(): number {
  console.log('Python oracle — semantics tests');
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
  console.log('all oracle semantics tests passed');
  return 0;
}

if (require.main === module) process.exit(main());

export { main as runOracleSemanticsTests };
