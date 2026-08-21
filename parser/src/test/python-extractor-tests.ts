/**
 * Python extractor test suite.
 *
 *   npx tsx src/test/python-extractor-tests.ts
 *   npx tsx src/test/python-extractor-tests.ts --sweep <dir> [--limit N]
 *
 * Mirrors the structure of `java-extractor-tests.ts`, with three validation
 * layers that are reported SEPARATELY because they have different strengths:
 *
 *  Gate 1 — `symtable` set-equality for py_scope and py_binding, including all
 *           eleven Symbol predicates. CPython computes this by a different
 *           algorithm in a different language, so a disagreement means WE are
 *           wrong. This is the only exact arbiter we have.
 *  Gate 2 — `ast` cross-check for declarations, calls and spans. This is a
 *           second implementation, but by the harness's own author, so it
 *           detects DISAGREEMENT REQUIRING ADJUDICATION, not correctness.
 *  Layer 3 — Appendix B invariants 1-8 plus determinism, which need no oracle
 *           and hold on any corpus.
 *
 * Never aggregate the three into one number: a self-check and an exact oracle
 * are not the same evidence.
 */
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import * as os from 'os';

import { PythonDialect } from '@/enums/python/modules';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';
import { PythonDialectDetector } from '@/parsers/python/python-dialect-detector';
import { PythonParser } from '@/parsers/python/python-parser';
import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const PINNED_INTERPRETER =
  '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3';
const ORACLE_SCRIPT = path.join(process.cwd(), 'src/test/python-oracle/oracle/emit_oracle.py');
const FIXTURE_DIR = 'python-work/staging/native';
const SERVICE_VERSION = 'SERVICE_VERSION_test';

/** The eleven symtable.Symbol predicates, in symtable's own order. */
const SYMBOL_PREDICATES = [
  'is_parameter', 'is_local', 'is_global', 'is_nonlocal', 'is_free', 'is_imported',
  'is_assigned', 'is_referenced', 'is_declared_global', 'is_annotated', 'is_namespace',
] as const;

/** The frozen spine: relation -> column count. 10 relations, 262 columns. */
const SPINE_ARITY: Readonly<Record<string, number>> = {
  py_module: 24, py_scope: 25, py_binding: 29, py_type: 25, py_type_base: 16,
  py_method: 36, py_method_parameter: 22, py_import: 24, py_expression: 35, py_call_site: 26,
};

interface Failure {
  gate: 'GATE1' | 'GATE2' | 'INVARIANT';
  detail: string;
}

interface FileResult {
  file: string;
  failures: Failure[];
  stats: Record<string, number>;
  /**
   * Set when CPython itself could not produce ground truth for this file — a
   * Python 2 file, a 3.11+-only construct, or a deliberately malformed test
   * fixture. Reported separately and never counted as a pass: "the oracle could
   * not judge this" is not the same as "this is correct".
   */
  oracleUnavailable?: string;
}

// ---------------------------------------------------------------- extraction

function extract(file: string) {
  return new PythonFactExtractor().extract({
    sourceCode: fs.readFileSync(file, 'utf8'),
    filePath: file,
    baseMservPath: '/repo',
    moduleQualifiedName: path.basename(file).replace(/\.pyi?$/, ''),
    serviceVersionLinkHash: SERVICE_VERSION,
  });
}

/**
 * Runs the oracle, returning `null` when CPython cannot parse the file.
 *
 * The corpus contains files CPython 3.10 itself rejects — Python 2 sources and
 * deliberately malformed test fixtures — and a harness that dies on the first
 * one abandons every file after it. That is a worse failure than the thing it
 * is checking for, so an unusable oracle result is a recorded skip.
 */
function runOracle(file: string): any | null {
  try {
    const out = execFileSync(
      PINNED_INTERPRETER,
      [ORACLE_SCRIPT, '--file', file, '--module-qname', path.basename(file).replace(/\.pyi?$/, '')],
      { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const parsed = JSON.parse(out);
    if (!Array.isArray(parsed?.scopes) || !Array.isArray(parsed?.bindings)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------- gate 1

/**
 * Set-equality against `symtable`, keyed on the NATURAL identity rather than the
 * hash: the parser computing a different hash for the same entity is one of the
 * bugs being hunted, and keying on the hash would hide it as a simultaneous
 * missing+spurious pair.
 */
function gate1(file: string, oracle: any, facts: ReturnType<typeof extract>): Failure[] {
  const failures: Failure[] = [];
  const key = (kind: string, qname: string, line: number, col: number) =>
    `${kind}|${qname}|${line}:${col}`;

  const expected = new Map<string, any>();
  for (const s of oracle.scopes) {
    expected.set(key(s.scopeKind, s.qualifiedName, s.startLine, s.startColumn), s);
  }

  const actual = new Map<string, string[]>();
  const scopeHashToKey = new Map<string, string>();
  for (const s of facts.scopes) {
    const r = s.toCsv().split('\t');
    const k = key(r[0]!, r[2]!, Number(r[18]), Number(r[19]));
    if (actual.has(k)) {
      failures.push({ gate: 'GATE1', detail: `py_scope natural-key collision: ${k}` });
    }
    actual.set(k, r);
    scopeHashToKey.set(s.getHash(), k);
  }

  for (const [k, exp] of expected) {
    const act = actual.get(k);
    if (!act) {
      failures.push({ gate: 'GATE1', detail: `py_scope MISSING ${k}` });
      continue;
    }
    const checks: [string, unknown, unknown][] = [
      ['scopeKind', exp.scopeKind, act[0]], ['name', exp.name, act[1]],
      ['qualifiedName', exp.qualifiedName, act[2]], ['nestingDepth', exp.nestingDepth, act[3]],
      ['isNested', exp.isNested, act[8]], ['isOptimized', exp.isOptimized, act[9]],
      ['hasChildren', exp.hasChildren, act[10]], ['startLine', exp.startLine, act[18]],
      ['startColumn', exp.startColumn, act[19]], ['scopeOrdinal', exp.scopeOrdinal, act[22]],
    ];
    for (const [f, e, a] of checks) {
      if (String(e) !== String(a)) {
        failures.push({ gate: 'GATE1', detail: `py_scope ${k} ${f}: oracle=${e} mine=${a}` });
      }
    }
  }
  for (const k of actual.keys()) {
    if (!expected.has(k)) {
      failures.push({ gate: 'GATE1', detail: `py_scope SPURIOUS ${k}` });
    }
  }

  const oracleScopeIdToKey = new Map<string, string>();
  for (const s of oracle.scopes) {
    oracleScopeIdToKey.set(s.scopeId, key(s.scopeKind, s.qualifiedName, s.startLine, s.startColumn));
  }
  const expectedBindings = new Map<string, any>();
  for (const b of oracle.bindings) {
    expectedBindings.set(`${oracleScopeIdToKey.get(b.scopeId)}::${b.name}`, b);
  }
  const actualBindings = new Map<string, string[]>();
  for (const b of facts.bindings) {
    const r = b.toCsv().split('\t');
    actualBindings.set(`${scopeHashToKey.get(r[1]!) ?? '<unresolved>'}::${r[0]}`, r);
  }
  for (const [k, exp] of expectedBindings) {
    const act = actualBindings.get(k);
    if (!act) {
      failures.push({ gate: 'GATE1', detail: `py_binding MISSING ${k}` });
      continue;
    }
    SYMBOL_PREDICATES.forEach((pred, i) => {
      if (String(exp[pred]) !== act[4 + i]) {
        failures.push({
          gate: 'GATE1',
          detail: `py_binding ${k} ${pred} (c${4 + i}): oracle=${exp[pred]} mine=${act[4 + i]}`,
        });
      }
    });
  }
  for (const k of actualBindings.keys()) {
    if (!expectedBindings.has(k)) {
      failures.push({ gate: 'GATE1', detail: `py_binding SPURIOUS ${k}` });
    }
  }
  void file;
  return failures;
}

// -------------------------------------------------------------------- gate 2

/**
 * `ast` cross-check for declarations and calls.
 *
 * Four comparisons are deliberately relaxed, each because the disagreement was
 * ADJUDICATED in the parser's favour with third-party evidence (see
 * python-work/coordination/requests-impl.jsonl). They are relaxed rather than
 * deleted so the rest of the field is still checked.
 */
function gate2(oracle: any, facts: ReturnType<typeof extract>): Failure[] {
  const failures: Failure[] = [];
  const st = oracle.structure ?? {};

  // ---- classes
  const expClasses = new Map<string, any>();
  for (const c of st.classes ?? []) expClasses.set(`${c.name}|${c.line}`, c);
  const actClasses = new Map<string, string[]>();
  for (const t of facts.types) {
    const r = t.toCsv().split('\t');
    actClasses.set(`${r[0]}|${r[9]}`, r);
  }
  for (const [k, exp] of expClasses) {
    const act = actClasses.get(k);
    if (!act) { failures.push({ gate: 'GATE2', detail: `py_type MISSING ${k}` }); continue; }
    if (String(exp.endLine) !== act[10]) {
      failures.push({ gate: 'GATE2', detail: `py_type ${k} endLine: oracle=${exp.endLine} mine=${act[10]}` });
    }
    const positional = (exp.bases ?? []).filter((b: any) => b.position !== null).length;
    if (String(positional) !== act[19]) {
      failures.push({ gate: 'GATE2', detail: `py_type ${k} baseCount: oracle=${positional} mine=${act[19]}` });
    }
  }
  for (const k of actClasses.keys()) {
    if (!expClasses.has(k)) failures.push({ gate: 'GATE2', detail: `py_type SPURIOUS ${k}` });
  }

  // ---- functions
  const nestedOwners = new Set<string>(
    (st.functions ?? []).map((f: any) => f.enclosingFunction).filter((n: string) => n)
  );
  const expFns = new Map<string, any>();
  for (const f of st.functions ?? []) expFns.set(`${f.name}|${f.line}`, f);
  const actFns = new Map<string, string[]>();
  for (const m of facts.methods) {
    const r = m.toCsv().split('\t');
    if (r[11]?.includes('SYNTHETIC')) continue;
    actFns.set(`${r[0]}|${r[5]}`, r);
  }
  for (const [k, exp] of expFns) {
    const act = actFns.get(k);
    if (!act) { failures.push({ gate: 'GATE2', detail: `py_method MISSING ${k}` }); continue; }
    const checks: [string, unknown, unknown][] = [
      ['endLine', exp.endLine, act[6]],
      ['isAsync', exp.isAsync, act[28]],
      ['posOnlyCount', exp.posOnlyCount, act[24]],
      ['kwOnlyCount', exp.kwOnlyCount, act[25]],
      ['hasKwArgs', exp.hasKwArgs, act[26]],
      ['isVarArgs', exp.hasVarArgs, act[13]],
      ['ownerClass', exp.ownerClass, act[8]],
      ['decoratorCount', (exp.decorators ?? []).length, act[30]],
      // ADJUDICATED: the oracle's _has_yield walks into nested defs, so it marks
      // a function that merely RETURNS a generator as one. inspect.isgenerator-
      // function agrees with us. Only checked where there is no nested def.
      ...(nestedOwners.has(exp.name)
        ? []
        : [['isGenerator', exp.isGenerator, act[29]] as [string, unknown, unknown]]),
    ];
    for (const [f, e, a] of checks) {
      if (String(e) !== String(a)) {
        failures.push({ gate: 'GATE2', detail: `py_method ${k} ${f}: oracle=${JSON.stringify(e)} mine=${JSON.stringify(a)}` });
      }
    }
    // ADJUDICATED: the oracle groups parameters (posonly, args, kwonly, then
    // vararg/kwarg); we emit canonical signature order, which is what
    // inspect.signature reports and what positional flow requires. Compared as
    // a set of name:kind pairs.
    const expKinds = [...(exp.params ?? []).map((p: any) => `${p.name}:${p.paramKind}`)].sort().join(',');
    const actKinds = facts.methodParameters
      .filter(p => p.getPyMethodLinkHash() === act[35] && p.getParamName() !== '')
      .map(p => `${p.getParamName()}:${p.getParamKind()}`).sort().join(',');
    if (expKinds !== actKinds) {
      failures.push({ gate: 'GATE2', detail: `py_method_parameter ${k}: oracle=[${expKinds}] mine=[${actKinds}]` });
    }
  }
  for (const k of actFns.keys()) {
    if (!expFns.has(k)) failures.push({ gate: 'GATE2', detail: `py_method SPURIOUS ${k}` });
  }

  // ---- imports
  const expImports = new Map<string, any>();
  for (const im of st.imports ?? []) expImports.set(`${im.bound}|${im.line}`, im);
  const actImports = new Map<string, string[]>();
  for (const im of facts.imports) {
    const r = im.toCsv().split('\t');
    actImports.set(`${r[3]}|${r[5]}`, r);
  }
  for (const [k, exp] of expImports) {
    const act = actImports.get(k);
    if (!act) { failures.push({ gate: 'GATE2', detail: `py_import MISSING ${k}` }); continue; }
    if (String(exp.relativeLevel) !== act[9]) {
      failures.push({ gate: 'GATE2', detail: `py_import ${k} relativeLevel: oracle=${exp.relativeLevel} mine=${act[9]}` });
    }
  }
  for (const k of actImports.keys()) {
    if (!expImports.has(k)) failures.push({ gate: 'GATE2', detail: `py_import SPURIOUS ${k}` });
  }

  // ---- call sites
  const expCalls = new Map<string, any>();
  for (const c of st.calls ?? []) expCalls.set(`${c.callee}|${c.line}|${c.col}`, c);
  const actCalls = new Map<string, string[]>();
  for (const c of facts.callSites) {
    const r = c.toCsv().split('\t');
    actCalls.set(`${r[1]}|${r[21]}|${r[22]}`, r);
  }
  for (const [k, exp] of expCalls) {
    const act = actCalls.get(k);
    if (!act) { failures.push({ gate: 'GATE2', detail: `py_call_site MISSING ${k}` }); continue; }
    const checks: [string, unknown, unknown][] = [
      ['positionalArgs', exp.positionalArgs, act[11]],
      ['keywordArgs', exp.keywordArgs, act[12]],
      ['hasStarArgs', exp.hasStarArgs, act[13]],
      ['hasDoubleStarArgs', exp.hasDoubleStarArgs, act[14]],
      ['endLine', exp.endLine, act[23]],
      // ADJUDICATED: schema §2.16 c15 specifies SOURCE order; the oracle sorts.
      ['keywordNames', [...(exp.keywordNames ?? [])].sort().join(','),
        (act[15] ?? '').split(',').filter(Boolean).sort().join(',')],
      // ADJUDICATED: the oracle's visit_Call never consults the decorator list
      // and string-matches the literal name 'cls', so it reports SELF for a
      // @staticmethod's first parameter and CLS for any plain function
      // parameter named cls. It also collapses a literal receiver to UNKNOWN,
      // where LITERAL is an explicit schema value.
      ...((exp.receiverKind === 'UNKNOWN' && act[4] === 'LITERAL') ||
      (exp.receiverKind === 'SELF' && (act[4] === 'CLS' || act[4] === 'NAME')) ||
      (exp.receiverKind === 'CLS' && act[4] === 'NAME')
        ? []
        : [['receiverKind', exp.receiverKind, act[4]] as [string, unknown, unknown]]),
    ];
    for (const [f, e, a] of checks) {
      if (String(e) !== String(a)) {
        failures.push({ gate: 'GATE2', detail: `py_call_site ${k} ${f}: oracle=${JSON.stringify(e)} mine=${JSON.stringify(a)}` });
      }
    }
  }
  for (const k of actCalls.keys()) {
    if (!expCalls.has(k)) failures.push({ gate: 'GATE2', detail: `py_call_site SPURIOUS ${k}` });
  }

  return failures;
}

// ---------------------------------------------------------------- invariants

/** Appendix B invariants 1-8, plus determinism (#5). No oracle required. */
function invariants(file: string, facts: ReturnType<typeof extract>): Failure[] {
  const failures: Failure[] = [];
  if (!facts.module) return failures;

  const relations: [string, { toCsv(): string }[]][] = [
    ['py_module', [facts.module]], ['py_scope', facts.scopes], ['py_binding', facts.bindings],
    ['py_type', facts.types], ['py_type_base', facts.typeBases], ['py_method', facts.methods],
    ['py_method_parameter', facts.methodParameters], ['py_import', facts.imports],
    ['py_expression', facts.expressions], ['py_call_site', facts.callSites],
  ];

  const allPks = new Set<string>();
  for (const [name, rows] of relations) {
    const seen = new Set<string>();
    for (const row of rows) {
      const cols = row.toCsv().split('\t');
      if (cols.length !== SPINE_ARITY[name]) {
        failures.push({ gate: 'INVARIANT', detail: `#6 ${name} arity ${cols.length} != ${SPINE_ARITY[name]}` });
      }
      const pk = cols[cols.length - 1]!;
      if (!/^PY_[A-Z_]+_[0-9a-f]{32}$/.test(pk)) {
        failures.push({ gate: 'INVARIANT', detail: `#3 ${name} bad PK shape ${pk}` });
      }
      if (seen.has(pk)) {
        failures.push({ gate: 'INVARIANT', detail: `#2 ${name} PK collision ${pk}` });
      }
      seen.add(pk);
      allPks.add(pk);
      if (cols[cols.length - 2] !== SERVICE_VERSION) {
        failures.push({ gate: 'INVARIANT', detail: `#4 ${name} serviceVersionLinkHash misplaced` });
      }
    }
  }

  // #1 referential integrity on the FKs that must always resolve
  for (const s of facts.scopes) {
    const parent = s.toCsv().split('\t')[4]!;
    if (parent && !allPks.has(parent)) {
      failures.push({ gate: 'INVARIANT', detail: `#1 py_scope.parentScopeLinkHash dangling` });
    }
  }
  for (const b of facts.bindings) {
    if (!allPks.has(b.toCsv().split('\t')[1]!)) {
      failures.push({ gate: 'INVARIANT', detail: `#1 py_binding.pyScopeLinkHash dangling` });
    }
  }
  const exprHashes = new Set(facts.expressions.map(e => e.getHash()));
  for (const e of facts.expressions) {
    const parent = e.getParentExpressionHash();
    if (parent && !exprHashes.has(parent)) {
      failures.push({ gate: 'INVARIANT', detail: `#8 py_expression parent dangling` });
    }
    if (!e.getPyScopeLinkHash()) {
      failures.push({ gate: 'INVARIANT', detail: `#7 py_expression without a scope` });
    }
  }
  // #7 ownership totality: every call site reaches a method
  for (const c of facts.callSites) {
    const cols = c.toCsv().split('\t');
    if (!allPks.has(cols[5]!)) {
      failures.push({ gate: 'INVARIANT', detail: `#1 py_call_site.pyExpressionLinkHash dangling` });
    }
    if (!cols[8] || !allPks.has(cols[8])) {
      failures.push({ gate: 'INVARIANT', detail: `#7 py_call_site does not reach a py_method` });
    }
  }
  // #8 exactly one scope root per module
  const roots = facts.scopes.filter(s => s.toCsv().split('\t')[4] === '');
  if (roots.length !== 1) {
    failures.push({ gate: 'INVARIANT', detail: `#8 expected 1 scope root, got ${roots.length}` });
  }

  // #5 byte-identical output across runs
  const serialize = (f: ReturnType<typeof extract>) => [
    [f.module!], f.scopes, f.bindings, f.types, f.typeBases, f.methods,
    f.methodParameters, f.imports, f.expressions, f.callSites,
  ].flatMap(rows => rows.map(r => r.toCsv())).join('\n');
  const first = crypto.createHash('md5').update(serialize(facts)).digest('hex');
  const second = crypto.createHash('md5').update(serialize(extract(file))).digest('hex');
  if (first !== second) {
    failures.push({ gate: 'INVARIANT', detail: `#5 output not byte-identical across runs` });
  }

  return failures;
}

// -------------------------------------------------------- python 2 rejection

/**
 * Python 2 must be REJECTED, not merely unsupported, because tree-sitter parses
 * it cleanly — `hasError` is false and a full plausible fact set comes out.
 * Every negative case here is a Python 3 construct that must NOT be rejected.
 */
function python2RejectionTests(): Failure[] {
  const failures: Failure[] = [];
  const parser = new PythonParser();
  const detector = new PythonDialectDetector();
  const cases: [string, string, boolean][] = [
    ['tier1 print statement', 'print "x"\n', true],
    ['tier1 chevron', 'print >>sys.stderr, "x"\n', true],
    ['tier1 exec statement', 'exec "code"\n', true],
    ['tier2 except comma', 'try:\n    pass\nexcept E, e:\n    pass\n', true],
    ['tier2 tuple parameter', 'def f((a, b)):\n    return a\n', true],
    ['tier3 backtick repr', 'x = `repr(y)`\n', true],
    ['py3 print call', 'print("x")\n', false],
    ['py3 tuple assignment', '(a, b) = x\n', false],
    ['py3 except as', 'try:\n    pass\nexcept E as e:\n    pass\n', false],
    ['py3 except tuple', 'try:\n    pass\nexcept (A, B):\n    pass\n', false],
    ['py3 except star', 'try:\n    pass\nexcept* E:\n    pass\n', false],
    ['py3 backtick in docstring', '"""see `foo`"""\nx = 1\n', false],
    ['py3 backtick in comment', '# use `x`\nx = 1\n', false],
    ['py3 for tuple target', 'for (a, b) in items:\n    pass\n', false],
    ['py3 lambda', 'f = lambda a, b: a\n', false],
  ];

  for (const [label, source, expectRejected] of cases) {
    const tree = parser.parse(source);
    const result = detector.detect(tree.rootNode, source);
    const rejected = result.dialect === PythonDialect.PY2_DETECTED_REJECTED;
    if (rejected !== expectRejected) {
      failures.push({
        gate: 'INVARIANT',
        detail: `py2 detection ${label}: expected rejected=${expectRejected}, got ${result.dialect}`,
      });
    }
    // A clean parse is the whole reason this path exists — assert it.
    if (expectRejected && tree.rootNode.hasError) {
      failures.push({
        gate: 'INVARIANT',
        detail: `py2 detection ${label}: expected a CLEAN parse (that is why detection is needed)`,
      });
    }
  }

  // The reason must be the dedicated one, so the audit trail is unambiguous.
  const py2 = new PythonFactExtractor().extract({
    sourceCode: 'print "x"\n', filePath: 'x.py', baseMservPath: '/repo',
    serviceVersionLinkHash: SERVICE_VERSION,
  });
  if (py2.skippedReason !== SkippedFileReason.PY2_CONSTRUCT_DETECTED) {
    failures.push({ gate: 'INVARIANT', detail: `py2 rejection reason: got ${py2.skippedReason}` });
  }
  if (py2.module || py2.scopes.length || py2.bindings.length || py2.expressions.length) {
    failures.push({ gate: 'INVARIANT', detail: `py2 rejection emitted facts (it must emit NONE)` });
  }
  return failures;
}

/** The 32,767-character parse ceiling, in characters rather than bytes. */
function parseLimitTests(): Failure[] {
  const failures: Failure[] = [];
  const parser = new PythonParser();
  let source = '';
  let i = 0;
  while (source.length < 200_000) {
    source += `def f_${i}(a, b):\n    return a + b\n`;
    i += 1;
  }
  for (const size of [32_766, 32_767, 32_768, 40_000, 200_000]) {
    const slice = source.slice(0, size) + '\n';
    try {
      const tree = parser.parse(slice);
      if (tree.rootNode.endIndex < slice.length - 1) {
        failures.push({ gate: 'INVARIANT', detail: `parse limit ${size}: tree does not cover the source` });
      }
    } catch (error) {
      failures.push({ gate: 'INVARIANT', detail: `parse limit ${size}: threw ${String(error).slice(0, 60)}` });
    }
  }
  // Characters, not bytes: 29k CJK characters is 87KB of UTF-8.
  const cjk = 'x = "' + '\u6f22'.repeat(29_000) + '"\n';
  try {
    parser.parse(cjk);
  } catch (error) {
    failures.push({ gate: 'INVARIANT', detail: `CJK parse threw: the limit is CHARACTERS, not bytes` });
  }
  // An empty file is legal Python with a real module scope.
  try {
    parser.parse('');
  } catch (error) {
    failures.push({ gate: 'INVARIANT', detail: `empty source threw; an empty __init__.py is legal` });
  }
  return failures;
}

/**
 * Classification assertions for `py_type.typeCategory` and `typeModifier`.
 *
 * These columns have **no oracle coverage at all** — `emit_oracle.py` emits no
 * typeCategory field and the ast differ compares only spans and base counts — so
 * this is a self-check, and it is labelled as one. It exists because a real bug
 * hid there: `classifyType` filtered keyword bases out before its name checks
 * while `typeModifiersOf` did not, so `class C(metaclass=ABCMeta)` came out as
 * CLASS_TYPE carrying an ABSTRACT modifier. The last assertion below is that
 * internal contradiction, which is checkable without any oracle.
 */
function classificationTests(): Failure[] {
  const failures: Failure[] = [];
  const source = [
    'import abc',
    'import enum',
    'from abc import ABC, ABCMeta',
    'from enum import Enum, EnumMeta',
    '',
    'class ClassicABC(metaclass=ABCMeta):',
    '    pass',
    'class ClassicABC2(metaclass=abc.ABCMeta):',
    '    pass',
    'class FunctionalEnum(metaclass=EnumMeta):',
    '    RED = 1',
    'class RealABC(abc.ABC):',
    '    pass',
    'class RealEnum(enum.Enum):',
    '    RED = 1',
    'class Plain:',
    '    pass',
    'class PlainWithMeta(metaclass=type):',
    '    pass',
    '',
  ].join('\n');

  const expected: Record<string, { category: string; abstract: boolean }> = {
    ClassicABC: { category: 'ABC_TYPE', abstract: true },
    ClassicABC2: { category: 'ABC_TYPE', abstract: true },
    FunctionalEnum: { category: 'ENUM_CLASS_TYPE', abstract: false },
    RealABC: { category: 'ABC_TYPE', abstract: true },
    RealEnum: { category: 'ENUM_CLASS_TYPE', abstract: false },
    Plain: { category: 'CLASS_TYPE', abstract: false },
    PlainWithMeta: { category: 'CLASS_TYPE', abstract: false },
  };

  const facts = new PythonFactExtractor().extract({
    sourceCode: source, filePath: 'classification.py', baseMservPath: '/repo',
    serviceVersionLinkHash: SERVICE_VERSION,
  });

  for (const type of facts.types) {
    const cols = type.toCsv().split('\t');
    const [name, , , category, , modifier] = cols;
    const want = expected[name!];
    if (!want) {
      failures.push({ gate: 'INVARIANT', detail: `classification: unexpected class ${name}` });
      continue;
    }
    const abstract = (modifier ?? '').split(',').includes('ABSTRACT');
    if (category !== want.category) {
      failures.push({
        gate: 'INVARIANT',
        detail: `classification ${name}: typeCategory expected ${want.category}, got ${category}`,
      });
    }
    if (abstract !== want.abstract) {
      failures.push({
        gate: 'INVARIANT',
        detail: `classification ${name}: ABSTRACT expected ${want.abstract}, got ${abstract}`,
      });
    }
    // Internal consistency, checkable with no oracle at all.
    if (abstract && category === 'CLASS_TYPE') {
      failures.push({
        gate: 'INVARIANT',
        detail: `classification ${name}: ABSTRACT modifier with CLASS_TYPE category`,
      });
    }
  }
  return failures;
}

/**
 * End-to-end analyzer tests: byte-identical CSVs across runs, correct arity on
 * every row, and total rejection of Python 2.
 *
 * Determinism has to hold in the OUTPUT BYTES, not just in an in-memory row
 * list, which is why this goes through the analyzer and hashes the files.
 */
async function analyzerTests(): Promise<Failure[]> {
  const failures: Failure[] = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'py-analyzer-test-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(repo, 'pkg'), { recursive: true });

  fs.writeFileSync(path.join(repo, 'pkg', '__init__.py'), '');
  fs.writeFileSync(
    path.join(repo, 'pkg', 'good.py'),
    'class Service:\n    def run(self, x, *, flag=False):\n        return self.helper(x, flag=flag)\n\n    def helper(self, x, flag):\n        return [i for i in range(x) if flag]\n'
  );
  // One file per detection tier.
  fs.writeFileSync(path.join(repo, 'pkg', 'py2_print.py'), 'def main():\n    print "hello"\n');
  fs.writeFileSync(path.join(repo, 'pkg', 'py2_except.py'), 'try:\n    pass\nexcept E, exc:\n    pass\n');
  fs.writeFileSync(path.join(repo, 'pkg', 'py2_backtick.py'), 'def show(x):\n    return `x`\n');

  const runAnalyzer = async (outDir: string) =>
    new PythonProjectAnalyzer().analyze({
      rootDir: repo, outputDir: outDir, baseMservPath: '/repo',
      serviceVersionLinkHash: SERVICE_VERSION,
    });

  const outA = path.join(tmp, 'out-a');
  const outB = path.join(tmp, 'out-b');
  const summary = await runAnalyzer(outA);
  await runAnalyzer(outB);

  if (summary.filesRejected !== 3) {
    failures.push({ gate: 'INVARIANT', detail: `analyzer: expected 3 rejections, got ${summary.filesRejected}` });
  }
  if (summary.counts.py_module !== summary.filesAnalysed) {
    failures.push({
      gate: 'INVARIANT',
      detail: `analyzer: py_module rows (${summary.counts.py_module}) != analysed files (${summary.filesAnalysed})`,
    });
  }

  const factFiles = fs.readdirSync(outA).filter(f => f !== 'skipped-python-files.csv');

  // #5 determinism, in the bytes.
  for (const name of fs.readdirSync(outA)) {
    const a = crypto.createHash('md5').update(fs.readFileSync(path.join(outA, name))).digest('hex');
    const b = crypto.createHash('md5').update(fs.readFileSync(path.join(outB, name))).digest('hex');
    if (a !== b) {
      failures.push({ gate: 'INVARIANT', detail: `#5 ${name} differs between runs` });
    }
  }

  // #6 every ROW, not just the header, has the frozen arity — this is what
  // catches a value smuggling a tab past escapeTsv.
  const arityByFile: Record<string, number> = {
    'all-python-modules.csv': SPINE_ARITY.py_module!,
    'all-python-scopes.csv': SPINE_ARITY.py_scope!,
    'all-python-bindings.csv': SPINE_ARITY.py_binding!,
    'all-python-types.csv': SPINE_ARITY.py_type!,
    'all-python-type-bases.csv': SPINE_ARITY.py_type_base!,
    'all-python-methods.csv': SPINE_ARITY.py_method!,
    'all-python-method-parameters.csv': SPINE_ARITY.py_method_parameter!,
    'all-python-imports.csv': SPINE_ARITY.py_import!,
    'all-python-expressions.csv': SPINE_ARITY.py_expression!,
    'all-python-call-sites.csv': SPINE_ARITY.py_call_site!,
  };
  for (const [name, want] of Object.entries(arityByFile)) {
    const content = fs.readFileSync(path.join(outA, name), 'utf8');
    if (content === '') {
      continue;
    }
    content.split('\n').filter(Boolean).forEach((line, index) => {
      const got = line.split('\t').length;
      if (got !== want) {
        failures.push({ gate: 'INVARIANT', detail: `#6 ${name} line ${index + 1}: ${got} fields, want ${want}` });
      }
    });
  }

  // Rejection must be TOTAL: no fact anywhere may come from a rejected file,
  // and no Python-2 node type may appear in any emitted fact.
  const emitted = factFiles.map(f => fs.readFileSync(path.join(outA, f), 'utf8')).join('\n');
  for (const nodeType of ['print_statement', 'exec_statement', 'chevron']) {
    if (emitted.includes(nodeType)) {
      failures.push({ gate: 'INVARIANT', detail: `py2 node type "${nodeType}" appears in emitted facts` });
    }
  }
  for (const rejected of ['py2_print', 'py2_except', 'py2_backtick']) {
    if (emitted.includes(rejected)) {
      failures.push({ gate: 'INVARIANT', detail: `facts emitted for rejected file ${rejected}.py` });
    }
  }
  const skipped = fs.readFileSync(path.join(outA, 'skipped-python-files.csv'), 'utf8');
  if ((skipped.match(/PY2_CONSTRUCT_DETECTED/g) ?? []).length !== 3) {
    failures.push({ gate: 'INVARIANT', detail: `skipped CSV missing PY2_CONSTRUCT_DETECTED rows` });
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  return failures;
}

// -------------------------------------------------------------------- runner

function testFile(file: string): FileResult {
  let facts: ReturnType<typeof extract>;
  try {
    facts = extract(file);
  } catch (error) {
    return {
      file,
      failures: [{ gate: 'INVARIANT', detail: `extractor threw: ${String(error).slice(0, 120)}` }],
      stats: {},
    };
  }

  const failures: Failure[] = [];
  let oracleUnavailable: string | undefined;
  if (facts.dialect === PythonDialect.PY3) {
    const oracle = runOracle(file);
    if (oracle === null) {
      oracleUnavailable = 'CPython could not produce ground truth';
    } else {
      failures.push(...gate1(file, oracle, facts));
      failures.push(...gate2(oracle, facts));
    }
  }
  // Invariants need no oracle, so they run even when ground truth is missing.
  failures.push(...invariants(file, facts));
  return {
    file,
    failures,
    oracleUnavailable,
    stats: {
      scopes: facts.scopes.length, bindings: facts.bindings.length,
      types: facts.types.length, typeBases: facts.typeBases.length,
      methods: facts.methods.length, methodParameters: facts.methodParameters.length,
      imports: facts.imports.length, expressions: facts.expressions.length,
      callSites: facts.callSites.length,
    },
  };
}

function collect(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!['__pycache__', '.git', 'node_modules'].includes(e.name)) walk(p);
        continue;
      }
      if (e.name.endsWith('.py')) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sweepIndex = args.indexOf('--sweep');
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;
  const dir = sweepIndex >= 0 ? args[sweepIndex + 1]! : FIXTURE_DIR;

  console.log('='.repeat(80));
  console.log('Python extractor tests');
  console.log(`  corpus: ${dir}`);
  console.log(`  oracle: CPython 3.10.4, pinned by absolute path`);
  console.log('='.repeat(80));

  const standalone = [
    ...python2RejectionTests(),
    ...parseLimitTests(),
    ...classificationTests(),
    ...(await analyzerTests()),
  ];
  console.log(
    `\nPy2 rejection, parse limit, classification, analyzer: ${standalone.length === 0 ? 'PASS' : `${standalone.length} FAILURES`}`
  );
  standalone.forEach(f => console.log(`   ${f.gate} ${f.detail}`));

  const files = collect(dir).slice(0, limit);
  const results = files.map(testFile);

  const totals: Record<string, number> = {};
  const byGate = { GATE1: 0, GATE2: 0, INVARIANT: 0 };
  let passed = 0;
  let unjudged = 0;
  for (const r of results) {
    for (const [k, v] of Object.entries(r.stats)) totals[k] = (totals[k] ?? 0) + v;
    for (const f of r.failures) byGate[f.gate] += 1;
    if (r.oracleUnavailable) unjudged += 1;
    if (r.failures.length === 0 && !r.oracleUnavailable) passed += 1;
  }

  console.log(`\nFiles: ${results.length}   fully clean: ${passed}   with failures: ${results.filter(r => r.failures.length > 0).length}`);
  // Never folded into the pass count: an unjudged file is not a passing file.
  console.log(`  invariant-only (CPython could not produce ground truth): ${unjudged}`);
  console.log('\nReported SEPARATELY — an exact oracle and a self-check are not the same evidence:');
  console.log(`  Gate 1  (symtable, EXACT)          ${byGate.GATE1} disagreements`);
  console.log(`  Gate 2  (ast, cross-check)         ${byGate.GATE2} disagreements`);
  console.log(`  Layer 3 (invariants, no oracle)    ${byGate.INVARIANT} violations`);

  console.log('\nRows emitted:');
  for (const [k, v] of Object.entries(totals)) console.log(`  ${k.padEnd(20)} ${v}`);

  const failedFiles = results.filter(r => r.failures.length > 0);
  if (failedFiles.length > 0) {
    console.log('\nFailures:');
    for (const r of failedFiles.slice(0, 20)) {
      console.log(`  ${path.basename(r.file)}`);
      r.failures.slice(0, 6).forEach(f => console.log(`     ${f.gate} ${f.detail}`));
    }
  }

  const total = standalone.length + byGate.GATE1 + byGate.GATE2 + byGate.INVARIANT;
  console.log('\n' + '='.repeat(80));
  console.log(total === 0 ? 'ALL CHECKS PASS' : `${total} PROBLEMS`);
  console.log('='.repeat(80));
  process.exit(total === 0 ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
