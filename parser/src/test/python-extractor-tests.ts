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
import { diffExpr } from '@/test/python-gates/diff-expr';

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

/**
 * The frozen spine: relation -> column count. 10 relations, 266 columns.
 *
 * `py_expression` is 39, not 35, as of schema v7: the deleted
 * `py_type_inference` relation folded into four appended columns (c33-c36). The
 * append is safe by construction rather than by inspection — the PK is built from
 * c0-c32 only, so no hash moves, and `serviceVersionLinkHash`/PK shift to c37/c38
 * exactly as the "append only, hash last" convention does every time.
 */
const SPINE_ARITY: Readonly<Record<string, number>> = {
  py_module: 24, py_scope: 25, py_binding: 29, py_type: 25, py_type_base: 16,
  py_method: 36, py_method_parameter: 22, py_import: 24, py_expression: 39, py_call_site: 26,
};

/**
 * Relations emitted from the DEFERRED set, with their own arities.
 *
 * Kept separate from {@link SPINE_ARITY} deliberately. The frozen spine is 10
 * relations and 266 columns, and that number must keep verifying against the
 * schema document — folding a deferred relation into it would make the document
 * check report 287 and read as schema drift, when in fact the spine is untouched
 * and an extra relation is being emitted alongside it.
 *
 * `py_type_reference` is emitted on explicit direction: a composite annotation
 * like `Dict[TypeA, TypeB]` references three related types, and no single spine
 * column can carry N of them.
 */
const DEFERRED_ARITY: Readonly<Record<string, number>> = {
  py_type_reference: 25,
  // Un-deferred because a call graph cannot be built without it: `self.x.m()`
  // needs the type of `x`, and no other relation carries it. It was 0/2,537
  // resolved before this existed.
  py_field: 29,
  py_field_position: 3,
  // Un-deferred on direction: decorators are Java's annotation relation in the
  // same slot, and @staticmethod/@classmethod shift every positional parameter,
  // so py_method_parameter.position cannot be adjudicated without them.
  py_decorator: 21,
  py_decorator_argument: 15,
  // Needed for data flow: reachability, and the isinstance narrowing that turns
  // a wide receiver fan into one candidate.
  py_block: 27,
  // The relation whose ABSENCE is invisible: a region the parser could not read
  // produces silence, and silence looks identical to "there was nothing there".
  py_parse_gap: 10,
  // Mostly DIRECTIVES rather than prose: an encoding cookie, a `# type:`
  // annotation, a `# noqa`. Docstrings appear here AND in py_expression, which
  // §2.17 makes intentional — a recall check must whitelist the duplication.
  py_comment: 15,
  // PEP 695 syntax only. A pre-3.12 TypeVar is a runtime ASSIGNMENT and lands in
  // py_binding with targetEntityKind=TYPE_VAR instead — a different fact.
  py_type_parameter: 14,
};

/** Every relation the parser emits, for the per-row arity check. */
const EMITTED_ARITY: Readonly<Record<string, number>> = {
  ...SPINE_ARITY,
  ...DEFERRED_ARITY,
};

interface Failure {
  gate: 'GATE1' | 'GATE2' | 'INVARIANT';
  detail: string;
}

interface FileResult {
  file: string;
  failures: Failure[];
  /** Resolved / total call sites, per receiverKind, so a regression is visible. */
  resolution: Map<string, { resolved: number; total: number }>;
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

/**
 * Compares the oracle's tier-1 classification verdicts.
 *
 * `oracle.classifications` carries `importKind`, `methodKind`, `typeModifier`
 * and `typeCategoryEvidence` computed independently of this parser. Until now it
 * was emitted and never read, which left those columns guarded only by
 * self-tests sharing an author with the code — good for catching regressions,
 * useless for catching a wrong premise.
 *
 * Keyed on `(name, line)`. A verdict the oracle does not state is not checked:
 * the tier-1 set is a SUBSET of each enum, so absence means "no opinion", not
 * "empty".
 */

/**
 * Gate 2 for the expression TREE, against CPython's own ast.
 *
 * Promoted out of scratch tooling, which is where it should never have stayed:
 * it found three real defects — 1,472 unpacking targets recorded as reads, 57
 * chained-assignment targets, 4 parenthesised arguments at the wrong position —
 * and none of them was visible to any other check, because every existing
 * py_expression assertion is SELF-consistent. Invert every edgeRole and
 * `depth === parent.depth + 1` still holds. Left unwired, all three could
 * regress in silence.
 */
function gate2Expressions(file: string): Failure[] {
  return diffExpr(file).problems.map(detail => ({ gate: 'GATE2' as const, detail }));
}

function gate2Classifications(oracle: any, facts: ReturnType<typeof extract>): Failure[] {
  const failures: Failure[] = [];
  const entries: any[] = oracle.classifications ?? [];
  if (entries.length === 0) {
    return failures;
  }

  const importsByKey = new Map<string, string[]>();
  for (const im of facts.imports) {
    const r = im.toCsv().split('\t');
    importsByKey.set(`${r[3]}|${r[5]}`, r);
  }
  const methodsByKey = new Map<string, string[]>();
  for (const m of facts.methods) {
    const r = m.toCsv().split('\t');
    methodsByKey.set(`${r[0]}|${r[5]}`, r);
  }
  const typesByKey = new Map<string, string[]>();
  for (const t of facts.types) {
    const r = t.toCsv().split('\t');
    typesByKey.set(`${r[0]}|${r[9]}`, r);
  }

  for (const entry of entries) {
    const key = `${entry.name}|${entry.line}`;
    const tier1 = entry.tier1 ?? {};
    // `residue` is the oracle DECLINING to classify. A decorated method carries
    // `methodKind: INSTANCE_METHOD` with `residue: "DECORATED:property"`, which
    // means "the decorator puts this outside my tier-1 set", not "it is an
    // instance method". Comparing against a declined verdict would have made the
    // parser wrong for being MORE specific than the oracle chose to be.
    const declined = String(entry.residue ?? '') !== '';

    if (entry.entity === 'py_import' && tier1.importKind !== undefined && !declined) {
      const row = importsByKey.get(key);
      if (row && row[0] !== tier1.importKind) {
        failures.push({
          gate: 'GATE2',
          detail: `py_import ${key} importKind: oracle=${tier1.importKind} mine=${row[0]}`,
        });
      }
    }

    // ADJUDICATED, oracle defect: a `def` inside a CLASS that is itself inside a
    // function is reported NESTED_FUNCTION, because the oracle tests "inside
    // another def" before "inside a class". CPython disagrees —
    // `outer.<locals>.Counter.increment` binds through an instance
    // (`inspect.ismethod(C().increment)` is True), so it is an instance method.
    // Recorded in requests-impl.jsonl rather than matched.
    if (
      entry.entity === 'py_method' &&
      tier1.methodKind !== undefined &&
      !declined &&
      tier1.methodKind !== 'NESTED_FUNCTION'
    ) {
      const row = methodsByKey.get(key);
      if (row && row[16] !== tier1.methodKind) {
        failures.push({
          gate: 'GATE2',
          detail: `py_method ${key} methodKind: oracle=${tier1.methodKind} mine=${row[16]}`,
        });
      }
    }

    if (entry.entity === 'py_type' && tier1.typeModifier !== undefined) {
      const row = typesByKey.get(key);
      // A comma-set: the oracle states the modifiers it is SURE of, so this
      // asserts containment rather than equality.
      if (row) {
        const mine = new Set((row[5] ?? '').split(',').filter(Boolean));
        for (const modifier of String(tier1.typeModifier).split(',').filter(Boolean)) {
          if (!mine.has(modifier)) {
            failures.push({
              gate: 'GATE2',
              detail: `py_type ${key} typeModifier: oracle has ${modifier}, mine=[${[...mine].join(',')}]`,
            });
          }
        }
      }
    }
  }
  return failures;
}

/**
 * Compares `py_field` against `oracle.attributeWrites`.
 *
 * The oracle enumerates writes; `py_field` MERGES them into one row per
 * attribute, so this checks that every write the oracle sees reaches a field
 * with the same owner, origin and receiver. It deliberately does not compare
 * counts the other way: a field can exist with no write the oracle lists, such
 * as a `__slots__` entry.
 */
function gate2AttributeWrites(oracle: any, facts: ReturnType<typeof extract>): Failure[] {
  const failures: Failure[] = [];
  const writes: any[] = oracle.attributeWrites ?? [];
  if (writes.length === 0) {
    return failures;
  }
  const byOwnerAndName = new Map<string, string[]>();
  for (const field of facts.fields) {
    const r = field.toCsv().split('\t');
    byOwnerAndName.set(`${r[9]}|${r[0]}|${r[13]}`, r);
  }
  // The parser MANGLES a private attribute name, matching CPython: `self.__x`
  // inside `class C` stores `_C__x`, which is the runtime `__dict__` key. The
  // oracle reports the SOURCE spelling, so the comparison mangles before
  // joining rather than treating the difference as a disagreement.
  const mangle = (owner: string, name: string): string => {
    if (!name.startsWith('__') || name.endsWith('__')) {
      return name;
    }
    const stripped = owner.replace(/^_+/, '');
    return stripped === '' ? name : `_${stripped}${name}`;
  };
  // The oracle also reports writes through a receiver that is NOT the method's
  // own — `other.attr = x`. Those are attributes of a different object and are
  // not `py_field` rows of this class, which is why the schema's fieldOrigin has
  // no value for them.
  const schemaOrigins = new Set([
    'CLASS_BODY_ASSIGN', 'CLASS_BODY_ANNOTATION_ONLY', 'SELF_ASSIGN',
    'SELF_AUGASSIGN', 'SLOTS_ENTRY', 'DATACLASS_FIELD', 'NAMEDTUPLE_FIELD',
    'TYPEDDICT_KEY', 'ENUM_MEMBER', 'SETATTR_DYNAMIC',
  ]);
  for (const write of writes) {
    if (!schemaOrigins.has(String(write.origin))) {
      continue;
    }
    const key = `${write.ownerClass}|${mangle(write.ownerClass, write.attribute)}|${write.origin}`;
    const row = byOwnerAndName.get(key);
    if (!row) {
      failures.push({
        gate: 'GATE2',
        detail: `py_field MISSING ${key} (oracle write at ${write.line}:${write.col})`,
      });
      continue;
    }
    if (row[15] !== write.receiverName) {
      failures.push({
        gate: 'GATE2',
        detail: `py_field ${key} receiverName: oracle=${write.receiverName} mine=${row[15]}`,
      });
    }
  }
  return failures;
}

/**
 * Compares `py_type_base` against the ast base list.
 *
 * `position` is the column that matters: C3 linearisation rides on base ORDER,
 * so a scrambled position silently changes which method an inherited call
 * reaches. A keyword base such as `metaclass=` has position `null` in the oracle
 * and `''` here, and both mean "not in the MRO".
 */
function gate2Bases(oracle: any, facts: ReturnType<typeof extract>): Failure[] {
  const failures: Failure[] = [];
  const classes: any[] = oracle.structure?.classes ?? [];
  const typeByKey = new Map<string, string>();
  for (const t of facts.types) {
    const r = t.toCsv().split('\t');
    typeByKey.set(`${r[0]}|${r[9]}`, r[24] ?? '');
  }
  const basesByType = new Map<string, string[][]>();
  for (const base of facts.typeBases) {
    const r = base.toCsv().split('\t');
    const list = basesByType.get(r[6]) ?? [];
    list.push(r);
    basesByType.set(r[6], list);
  }
  for (const cls of classes) {
    const typeHash = typeByKey.get(`${cls.name}|${cls.line}`);
    if (!typeHash) {
      continue;
    }
    const mine = basesByType.get(typeHash) ?? [];
    for (const base of cls.bases ?? []) {
      const expectedPosition = base.position === null ? '' : String(base.position);
      const match = mine.find(r => r[2] === base.text && r[5] === (base.keyword ?? ''));
      if (!match) {
        failures.push({
          gate: 'GATE2',
          detail: `py_type_base MISSING ${cls.name} base ${base.text}`,
        });
        continue;
      }
      if (match[1] !== expectedPosition) {
        failures.push({
          gate: 'GATE2',
          detail: `py_type_base ${cls.name}.${base.text} position: oracle=${expectedPosition} mine=${match[1]}`,
        });
      }
    }
  }
  return failures;
}

/** Compares `py_module` against the oracle's module block. */
function gate2Module(oracle: any, facts: ReturnType<typeof extract>): Failure[] {
  const failures: Failure[] = [];
  const expected = oracle.module;
  if (!expected || !facts.module) {
    return failures;
  }
  const row = facts.module.toCsv().split('\t');
  const checks: [string, unknown, unknown][] = [
    ['qualifiedName', expected.qualifiedName, row[1]],
    ['hasDunderAll', expected.hasDunderAll, row[16]],
    ['dunderAllIsStatic', expected.dunderAllIsStatic, row[17]],
    ['dunderAllNames', (expected.dunderAllNames ?? []).join(','), row[18]],
    ['emissionRegime', expected.emissionRegime, row[11]],
  ];
  for (const [field, exp, act] of checks) {
    if (String(exp) !== String(act)) {
      failures.push({
        gate: 'GATE2',
        detail: `py_module ${field}: oracle=${JSON.stringify(exp)} mine=${JSON.stringify(act)}`,
      });
    }
  }
  return failures;
}

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
    // The oracle's ast dump visits FunctionDef and AsyncFunctionDef only, so it
    // lists neither the synthetic initializers nor LAMBDAS. Schema §2.7 puts both
    // in py_method, so they are excluded here rather than reported as spurious —
    // a comparison has to be symmetric about what each side claims to enumerate.
    // Lambdas are covered instead by the invariant asserting that every LAMBDA
    // scope has exactly one LAMBDA method.
    if (r[11]?.includes('SYNTHETIC') || r[16] === 'LAMBDA') continue;
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

  // ---- classifications: the oracle's own tier-1 verdicts
  //
  // These were emitted and never read. `importKind`, `methodKind` and
  // `typeModifier` are the columns most at risk of a wrong PREMISE rather than a
  // regression — a self-test written by the author of the code agrees with it by
  // construction — so an independent verdict is worth more here than anywhere
  // else in the schema.
  failures.push(...gate2Classifications(oracle, facts));

  // ---- py_field against oracle.attributeWrites
  failures.push(...gate2AttributeWrites(oracle, facts));

  // ---- py_type_base against the ast base list
  failures.push(...gate2Bases(oracle, facts));

  // ---- py_module
  failures.push(...gate2Module(oracle, facts));

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

/**
 * C3 MRO resolution, with targets verified against CPython's own `__mro__`.
 *
 * These are hard expectations rather than a consistency check, because the
 * resolution gate cannot catch this class of defect: the gate only asserts when
 * exactly ONE class in the closure declares the name, and every case here has
 * two, which is precisely what makes the MRO ORDER decide the answer.
 *
 * The second case is the one that matters. Depth-first through `B` reaches
 * `A.m` and stops; CPython's MRO is `D, B, C, A`, so the answer is `C.m` — `A`
 * cannot come before `C` because it sits in `C`'s tail. An earlier version of
 * the resolver was depth-first and got exactly this wrong while looking right on
 * the simpler case above it.
 */
function mroResolutionTests(): Failure[] {
  const failures: Failure[] = [];
  const source = [
    'class Base:',
    '    def describe(self): return "base"',
    'class Child(Base):',
    '    def describe(self): return "child"',
    'class Sibling:',
    '    def describe(self): return "sibling"',
    'class Mixed(Child, Sibling):',
    '    def describe(self): return super().describe()',
    'class A:',
    '    def m(self): return "A"',
    'class B(A):',
    '    pass',
    'class C(A):',
    '    def m(self): return "C"',
    'class D(B, C):',
    '    def m(self): return super().m()',
    '',
  ].join('\n');

  const facts = new PythonFactExtractor().extract({
    sourceCode: source, filePath: 'mro.py', baseMservPath: '/repo',
    serviceVersionLinkHash: SERVICE_VERSION,
  });
  const methodByHash = new Map(facts.methods.map(m => [m.getHash(), m.getQualifiedName()]));

  // Verified with CPython: Mixed.__mro__ is (Mixed, Child, Base, Sibling, object)
  // and D.__mro__ is (D, B, C, A, object).
  const expected: Record<string, string> = {
    describe: 'mro.Child.describe',
    m: 'mro.C.m',
  };
  for (const [name, want] of Object.entries(expected)) {
    const site = facts.callSites.find(
      c => c.getReceiverKind() === 'SUPER' && c.getCalleeName() === name
    );
    if (!site) {
      failures.push({ gate: 'INVARIANT', detail: `mro: no SUPER call site for ${name}` });
      continue;
    }
    const got = methodByHash.get(site.getResolvedCalleeHash());
    if (got !== want) {
      failures.push({
        gate: 'INVARIANT',
        detail: `mro: super().${name}() must resolve to ${want} per CPython __mro__, got ${got ?? site.getResolvedCalleeKind()}`,
      });
    }
  }
  return failures;
}

/**
 * A composite annotation must yield ONE LINKED ENTRY PER REFERENCED TYPE,
 * enumerable from the parameter row.
 *
 * `py_method_parameter` has a single `potentialQualifiedName` slot, so
 * `Dict[TypeA, TypeB]` cannot be expressed there at all — it resolves the BASE,
 * `Dict`, which is external. The N types live in the annotation's py_expression
 * subtree, one `referencedEntityHash` each, and the subtree is owned by the
 * PARAMETER (`expressionOwnerKind=METHOD_PARAMETER`) so it can be enumerated
 * without matching text or spans.
 *
 * Covers the forms that each nest differently: multi-argument generics, nested
 * generics, `Union`, PEP 604 `A | B` (a BINARY_OPERATION, not a subscript), and
 * `Callable[[A, B], C]` where the arguments sit inside a LIST one level deeper.
 */
function annotationTypeLinkTests(): Failure[] {
  const failures: Failure[] = [];
  const source = [
    'from typing import Callable, Dict, List, Optional, Union',
    'class TypeA: pass',
    'class TypeB: pass',
    'class TypeC: pass',
    'def multi(m: Dict[TypeA, TypeB]): pass',
    'def nested(x: Dict[TypeA, List[Optional[TypeB]]]): pass',
    'def union_old(y: Union[TypeA, TypeB]): pass',
    'def union_new(z: TypeA | TypeB): pass',
    'def callables(f: Callable[[TypeA, TypeB], TypeC]): pass',
    '',
  ].join('\n');

  const facts = new PythonFactExtractor().extract({
    sourceCode: source, filePath: 'ann.py', baseMservPath: '/repo',
    serviceVersionLinkHash: SERVICE_VERSION,
  });
  const typeName = new Map(facts.types.map(t => [t.getHash(), t.getName()]));

  const expected: Record<string, string[]> = {
    m: ['TypeA', 'TypeB'],
    x: ['TypeA', 'TypeB'],
    y: ['TypeA', 'TypeB'],
    z: ['TypeA', 'TypeB'],
    f: ['TypeA', 'TypeB', 'TypeC'],
  };

  for (const [paramName, want] of Object.entries(expected)) {
    const parameter = facts.methodParameters.find(p => p.getParamName() === paramName);
    if (!parameter) {
      failures.push({ gate: 'INVARIANT', detail: `annotation link: no parameter ${paramName}` });
      continue;
    }
    const referenced = facts.expressions
      .filter(e => {
        const cols = e.toCsv().split('\t');
        return cols[5] === parameter.getHash() && cols[3] === 'METHOD_PARAMETER';
      })
      .map(e => typeName.get(e.getReferencedEntityHash()))
      .filter((n): n is string => n !== undefined)
      .sort();
    if (referenced.join(',') !== [...want].sort().join(',')) {
      failures.push({
        gate: 'INVARIANT',
        detail:
          `annotation link: parameter ${paramName} should reference [${want.join(', ')}] ` +
          `through its owned annotation subtree, got [${referenced.join(', ')}]`,
      });
    }
  }
  return failures;
}

/**
 * `py_type_reference` must be a TREE, with each nested type its own row linked to
 * its parent by hash and position.
 *
 * This is the shape `java_type_reference` uses, and it is the only way to express
 * a composite annotation: `Dict[TypeA, TypeB]` references three types that are
 * related to each other, and a single `potentialQualifiedName` slot on the
 * parameter can carry exactly one of them.
 *
 * Note the tree differs deliberately from the `py_expression` tree over the same
 * text. There, SUBSCRIPT is a node and `Dict` is its first child; here `Dict` IS
 * the depth-0 reference and the arguments are its children — so "the type being
 * parameterised" and "its parameters" are a parent/child pair rather than
 * siblings.
 */
function typeReferenceTreeTests(): Failure[] {
  const failures: Failure[] = [];
  const source = [
    'from typing import Callable, Dict, List, Optional, Union',
    'class TypeA: pass',
    'class TypeB: pass',
    'def f(m: Dict[TypeA, List[Optional[TypeB]]]): pass',
    'def g(z: TypeA | None): pass',
    'def h(c: Callable[[TypeA, TypeB], TypeA]): pass',
    '',
  ].join('\n');

  const facts = new PythonFactExtractor().extract({
    sourceCode: source, filePath: 'tr.py', baseMservPath: '/repo',
    serviceVersionLinkHash: SERVICE_VERSION,
  });
  const refs = facts.typeReferences;
  const byHash = new Map(refs.map(r => [r.getHash(), r]));

  // Structural integrity: a parent hash must resolve, and only depth 0 is a root.
  for (const reference of refs) {
    const parent = reference.getParentReferenceHash();
    if (parent === '') {
      if (reference.getDepth() !== 0) {
        failures.push({
          gate: 'INVARIANT',
          detail: `type reference: depth ${reference.getDepth()} with no parent`,
        });
      }
      continue;
    }
    const parentRef = byHash.get(parent);
    if (!parentRef) {
      failures.push({ gate: 'INVARIANT', detail: `type reference: dangling parentReferenceHash` });
      continue;
    }
    if (reference.getDepth() !== parentRef.getDepth() + 1) {
      failures.push({
        gate: 'INVARIANT',
        detail: `type reference: depth ${reference.getDepth()} under parent at depth ${parentRef.getDepth()}`,
      });
    }
  }

  /** The chain of typeNames from a reference up to its root. */
  const pathOf = (reference: (typeof refs)[number]): string => {
    const names: string[] = [];
    let current: (typeof refs)[number] | undefined = reference;
    let guard = 0;
    while (current && guard++ < 20) {
      names.unshift(current.getTypeName() || '|');
      current = byHash.get(current.getParentReferenceHash());
    }
    return names.join(' > ');
  };

  // Dict[TypeA, List[Optional[TypeB]]] — TypeB is four levels down.
  const deepB = refs.find(r => r.getTypeName() === 'TypeB' && r.getDepth() === 3);
  if (!deepB) {
    failures.push({ gate: 'INVARIANT', detail: 'type reference: TypeB not found at depth 3' });
  } else if (pathOf(deepB) !== 'Dict > List > Optional > TypeB') {
    failures.push({
      gate: 'INVARIANT',
      detail: `type reference: expected path Dict > List > Optional > TypeB, got ${pathOf(deepB)}`,
    });
  }

  // Positions must distinguish siblings: TypeA is argument 0 of Dict.
  const dictArgs = refs
    .filter(r => byHash.get(r.getParentReferenceHash())?.getTypeName() === 'Dict')
    .sort((a, b) => a.getPosition() - b.getPosition());
  if (dictArgs.length !== 2 || dictArgs[0]!.getTypeName() !== 'TypeA') {
    failures.push({
      gate: 'INVARIANT',
      detail: `type reference: Dict should have 2 args with TypeA at position 0, got ` +
        dictArgs.map(r => `${r.getPosition()}:${r.getTypeName()}`).join(','),
    });
  }

  // `TypeA | None` must be marked optional, and Optional[...] likewise.
  const union = refs.find(r => r.getKind() === 'UNION_PEP604' && r.getDepth() === 0);
  if (!union?.getIsOptional()) {
    failures.push({ gate: 'INVARIANT', detail: 'type reference: `TypeA | None` should be isOptional' });
  }
  const optional = refs.find(r => r.getKind() === 'OPTIONAL');
  if (!optional?.getIsOptional()) {
    failures.push({ gate: 'INVARIANT', detail: 'type reference: Optional[...] should be isOptional' });
  }

  // Callable[[A, B], R] — the bracketed parameter list is not a type, so its
  // members are arguments of Callable rather than of an anonymous list.
  const callableArgs = refs.filter(
    r => byHash.get(r.getParentReferenceHash())?.getKind() === 'CALLABLE'
  );
  if (callableArgs.length !== 3) {
    failures.push({
      gate: 'INVARIANT',
      detail: `type reference: Callable[[A, B], R] should have 3 argument refs, got ${callableArgs.length}`,
    });
  }

  // Context must separate the declared type from types mentioned inside it.
  const roots = refs.filter(r => r.getDepth() === 0);
  if (!roots.every(r => r.getContext() === 'METHOD_PARAM')) {
    failures.push({ gate: 'INVARIANT', detail: 'type reference: depth-0 refs should carry their real context' });
  }
  if (!refs.filter(r => r.getDepth() > 0).every(r => r.getContext() === 'GENERIC_ARGUMENT')) {
    failures.push({ gate: 'INVARIANT', detail: 'type reference: nested refs should be GENERIC_ARGUMENT' });
  }

  return failures;
}

/**
 * The RESOLUTION gate — a consistency invariant, not an oracle question.
 *
 * This exists because neither existing gate can see resolution at all. Gate 1
 * compares scopes and bindings, which are byte-identical whether resolution runs
 * or not. Gate 2 checks call-site structure, which was already correct. So 0%
 * resolution showed green on both, and reached a hand-written sample before
 * anything caught it.
 *
 * The check is self-contained because BOTH sides of the implication are
 * relations the parser emits. Expectations are recomputed here from `py_binding`,
 * `py_type_base` and `py_method` — deliberately NOT from the linker — so this
 * cannot be satisfied by the linker agreeing with itself:
 *
 *   receiverKind=NONE calling N in scope S
 *     if py_binding binds N in S's scope chain to a def/class D
 *     then resolvedCalleeHash == D
 *
 *   receiverKind=SELF calling N inside class T
 *     if T or T's resolved base closure declares a method N
 *     then resolvedCalleeHash == that method
 *
 *   py_type_base whose baseSimpleName names a py_type in the same module
 *     then resolvedTypeLinkHash == that type AND isResolvedLocally
 *
 * Under-resolution fails it. Over-resolution to the WRONG target fails it too,
 * since it asserts equality with the independently derived answer rather than
 * merely "something non-empty".
 */
function resolutionGate(facts: ReturnType<typeof extract>): Failure[] {
  const failures: Failure[] = [];
  if (!facts.module) {
    return failures;
  }

  const parentScopeOf = new Map<string, string>();
  for (const scope of facts.scopes) {
    parentScopeOf.set(scope.getHash(), scope.getParentScopeLinkHash());
  }
  const bindingAt = new Map<string, ReturnType<typeof facts.bindings.at>>();
  for (const binding of facts.bindings) {
    bindingAt.set(`${binding.getPyScopeLinkHash()}::${binding.getName()}`, binding);
  }
  const entityByBinding = new Map<string, string>();
  for (const method of facts.methods) {
    if (method.getDeclaringBindingLinkHash() !== '') {
      entityByBinding.set(method.getDeclaringBindingLinkHash(), method.getHash());
    }
  }
  for (const type of facts.types) {
    if (type.getDeclaringBindingLinkHash() !== '') {
      entityByBinding.set(type.getDeclaringBindingLinkHash(), type.getHash());
    }
  }

  // ---- rule 1: a bare name bound in the scope chain to a def or class
  for (const callSite of facts.callSites) {
    if (callSite.getReceiverKind() !== 'NONE') {
      continue;
    }
    let scope: string | undefined = callSite.getPyScopeLinkHash();
    let expected: string | null = null;
    let guard = 0;
    while (scope !== undefined && scope !== '' && guard++ < 200) {
      const binding = bindingAt.get(`${scope}::${callSite.getCalleeName()}`);
      if (binding?.isBound()) {
        expected = entityByBinding.get(binding.getHash()) ?? null;
        break;
      }
      scope = parentScopeOf.get(scope);
    }
    if (expected === null) {
      continue;
    }
    if (callSite.getResolvedCalleeHash() !== expected) {
      failures.push({
        gate: 'INVARIANT',
        detail:
          `resolution: ${callSite.getCalleeName()}() at line ${callSite.getStartLine()} is bound ` +
          `in its scope chain to a def/class, so resolvedCalleeHash must equal it ` +
          `(got ${callSite.getResolvedCalleeHash() || 'UNRESOLVED'})`,
      });
    }
  }

  // ---- rule 2: self.N where the class or its resolved bases declare N
  const basesOf = new Map<string, string[]>();
  for (const base of facts.typeBases) {
    if (base.getKeywordName() !== '' || !base.getIsResolvedLocally()) {
      continue;
    }
    const list = basesOf.get(base.getPyTypeLinkHash()) ?? [];
    list.push(base.getResolvedTypeLinkHash());
    basesOf.set(base.getPyTypeLinkHash(), list);
  }
  const typeByHash = new Map(facts.types.map(t => [t.getHash(), t]));
  const methodOn = (typeHash: string, name: string): string[] => {
    const hits = facts.methods.filter(
      m =>
        m.getPyTypeLinkHash() === typeHash &&
        m.getName() === name &&
        m.isClassBodyMember() &&
        m.getMethodKind() !== 'OVERLOAD_STUB' &&
        !m.getBodyIsStub()
    );
    return hits.map(m => m.getHash());
  };
  const closureLookup = (typeHash: string, name: string, seen: Set<string>): string[] => {
    if (seen.has(typeHash)) {
      return [];
    }
    seen.add(typeHash);
    const own = methodOn(typeHash, name);
    if (own.length > 0) {
      return own;
    }
    // Only claim an inherited target when EVERY base resolved; an unresolved
    // base means an unseen method might exist and the answer is not provable.
    const declared = facts.typeBases.filter(
      b => b.getPyTypeLinkHash() === typeHash && b.getKeywordName() === ''
    );
    if (!declared.every(b => b.getIsResolvedLocally())) {
      return [];
    }
    const out: string[] = [];
    for (const base of basesOf.get(typeHash) ?? []) {
      out.push(...closureLookup(base, name, seen));
    }
    return out;
  };

  for (const callSite of facts.callSites) {
    if (callSite.getReceiverKind() !== 'SELF' && callSite.getReceiverKind() !== 'CLS') {
      continue;
    }
    const owner = callSite.getPyTypeLinkHash();
    if (owner === '') {
      continue;
    }
    // A class with __getattr__ can answer for names that appear nowhere, so
    // absence proves nothing there and neither does presence.
    const ownerType = typeByHash.get(owner);
    const hatch = ownerType
      ? [...ownerType.getModifiers()].some(m => m === 'HAS_GETATTR' || m === 'HAS_SETATTR')
      : false;
    if (hatch) {
      continue;
    }
    const candidates = new Set(closureLookup(owner, callSite.getCalleeName(), new Set()));
    if (candidates.size !== 1) {
      continue;
    }
    const [expected] = candidates;
    if (callSite.getResolvedCalleeHash() !== expected) {
      failures.push({
        gate: 'INVARIANT',
        detail:
          `resolution: self.${callSite.getCalleeName()}() at line ${callSite.getStartLine()} has ` +
          `exactly one declared target on its class closure, so resolvedCalleeHash must equal it ` +
          `(got ${callSite.getResolvedCalleeHash() || 'UNRESOLVED'})`,
      });
    }
  }

  // ---- rule 4: every base that NAMES A TYPE must be linked to its twin
  // py_type_reference. This is the assertion class that FK integrity cannot
  // make: an empty FK is skipped by orphan checking, so a designed-but-never-
  // populated link reports 0 orphans and looks healthy. §2.5 c9 is what
  // type-hierarchy.dl traverses (base -> type_reference), so a Java rule ported
  // across finds nothing without it.
  const referenceByHash = new Map(facts.typeReferences.map(r => [r.getHash(), r]));
  for (const base of facts.typeBases) {
    const keyword = base.getKeywordName();
    // A non-metaclass keyword such as `total=False` names a VALUE, not a type,
    // so it correctly has no twin.
    if (keyword !== '' && keyword !== 'metaclass') {
      continue;
    }
    const twinHash = base.getPyTypeReferenceLinkHash();
    if (twinHash === '') {
      failures.push({
        gate: 'INVARIANT',
        detail: `py_type_base ${base.getBaseSimpleName() || base.getBaseText()} has no pyTypeReferenceLinkHash`,
      });
      continue;
    }
    const twin = referenceByHash.get(twinHash);
    if (!twin) {
      failures.push({
        gate: 'INVARIANT',
        detail: `py_type_base.pyTypeReferenceLinkHash does not resolve to a py_type_reference`,
      });
      continue;
    }
    const expectedContext = keyword === 'metaclass' ? 'METACLASS' : 'BASE_CLASS';
    if (twin.getContext() !== expectedContext) {
      failures.push({
        gate: 'INVARIANT',
        detail: `py_type_base twin has context ${twin.getContext()}, expected ${expectedContext}`,
      });
    }
    if (base.getBaseSimpleName() !== '' && twin.getTypeName() !== base.getBaseSimpleName()) {
      failures.push({
        gate: 'INVARIANT',
        detail:
          `py_type_base twin typeName ${twin.getTypeName()} != baseSimpleName ${base.getBaseSimpleName()}`,
      });
    }
    if (twin.getTypeReferenceOwnerHash() !== base.getHash()) {
      failures.push({
        gate: 'INVARIANT',
        detail: `py_type_base twin does not point back at this base row`,
      });
    }
  }

  // ---- rule 3: a base naming a class this module can REACH must be resolved
  // to it. Reachable means the same module, or through this module's own
  // py_import rows — which is the shape that was silently at 0%: 43 of 43
  // cross-module bases unresolved while the same-module check passed, so the
  // gate itself could not see the gap it was supposed to guard.
  const typeByName = new Map<string, string | null>();
  for (const type of facts.types) {
    typeByName.set(type.getName(), typeByName.has(type.getName()) ? null : type.getHash());
  }
  for (const base of facts.typeBases) {
    if (base.getKeywordName() !== '' || base.getIsDynamic()) {
      continue;
    }
    if (base.getBaseDottedPath().includes('.')) {
      continue;
    }
    const expected = typeByName.get(base.getBaseSimpleName());
    if (!expected || expected === base.getPyTypeLinkHash()) {
      continue;
    }
    if (base.getResolvedTypeLinkHash() !== expected || !base.getIsResolvedLocally()) {
      failures.push({
        gate: 'INVARIANT',
        detail:
          `resolution: base ${base.getBaseSimpleName()} names a class in the same module, so ` +
          `resolvedTypeLinkHash must be that class and isResolvedLocally must be true`,
      });
    }
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
    ['py_type_reference', facts.typeReferences],
  ];

  const allPks = new Set<string>();
  for (const [name, rows] of relations) {
    const seen = new Set<string>();
    for (const row of rows) {
      const cols = row.toCsv().split('\t');
      if (cols.length !== EMITTED_ARITY[name]) {
        failures.push({
          gate: 'INVARIANT',
          detail: `#6 ${name} arity ${cols.length} != ${EMITTED_ARITY[name]}`,
        });
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
  // #7 TRACEABILITY, which is what the deferral strategy rests on. Every one of
  // the eleven deferred relations points INTO the spine — py_decorator carries
  // ownerHash, pyMethodLinkHash, pyExpressionLinkHash and pyModuleLinkHash — so
  // they can only ever attach if the chain from any expression up to its owning
  // method is unbroken, with the polymorphic owner resolved in the relation its
  // discriminator names.
  const moduleInitHash = facts.module.toCsv().split('\t')[19]!;
  const typesByPk = new Map(facts.types.map(t => [t.getHash(), t.toCsv().split('\t')]));
  const methodsByPk = new Map(facts.methods.map(m => [m.getHash(), m.toCsv().split('\t')]));
  const parameterOwner = new Map(
    facts.methodParameters.map(p => [p.getHash(), p.getPyMethodLinkHash()])
  );
  const ownerToMethod = (kind: string, hash: string): string | null => {
    switch (kind) {
      case 'METHOD':
      case 'LAMBDA': {
        return methodsByPk.has(hash) ? hash : null;
      }
      case 'METHOD_PARAMETER': {
        // A parameter's annotation subtree is owned by the parameter, which
        // reaches a method through its own FK.
        const owningMethod = parameterOwner.get(hash);
        return owningMethod && methodsByPk.has(owningMethod) ? owningMethod : null;
      }
      case 'TYPE': {
        // Class-body code is owned by the synthetic <classbody> method.
        const type = typesByPk.get(hash);
        return type && methodsByPk.has(type[16]!) ? type[16]! : null;
      }
      case 'MODULE': {
        return hash === facts.module.getHash() && methodsByPk.has(moduleInitHash)
          ? moduleInitHash
          : null;
      }
      default: {
        return null;
      }
    }
  };
  for (const expression of facts.expressions) {
    const cols = expression.toCsv().split('\t');
    const owningMethod = ownerToMethod(cols[3]!, cols[5]!);
    if (owningMethod === null) {
      failures.push({
        gate: 'INVARIANT',
        detail: `#7 py_expression cannot reach a py_method: ownerKind=${cols[3]} kind=${cols[0]} line ${cols[20]}`,
      });
      continue;
    }
    if (methodsByPk.get(owningMethod)![21] !== facts.module.getHash()) {
      failures.push({ gate: 'INVARIANT', detail: `#7 py_method does not reach its py_module` });
    }
  }

  // #8 exactly one scope root per module
  const roots = facts.scopes.filter(s => s.toCsv().split('\t')[4] === '');
  if (roots.length !== 1) {
    failures.push({ gate: 'INVARIANT', detail: `#8 expected 1 scope root, got ${roots.length}` });
  }

  // #1, strengthened: an FK that is back-patched must be present exactly when
  // its discriminator says it should be. A silently-empty FK is worse than a
  // dangling one, because integrity checks skip empty values — so "always
  // empty" passes invariant #1 while breaking every join that needs it.
  //
  // And a polymorphic FK must resolve in the relation its DISCRIMINATOR names,
  // not merely somewhere. Checking only non-emptiness let a LAMBDA scope point
  // at a py_module PK: present, non-dangling against the union of all keys, and
  // wrong. That is what invariant #1 actually says.
  const modulePks = new Set(facts.module ? [facts.module.getHash()] : []);
  const typePks = new Set(facts.types.map(t => t.getHash()));
  const methodPks = new Set(facts.methods.map(m => m.getHash()));
  const ownerRelationFor: Record<string, Set<string>> = {
    MODULE: modulePks,
    TYPE: typePks,
    METHOD: methodPks,
    LAMBDA: methodPks,
    COMPREHENSION: methodPks,
  };
  for (const scope of facts.scopes) {
    const cols = scope.toCsv().split('\t');
    const ownerKind = cols[6]!;
    const ownerHash = cols[7]!;
    if (ownerHash === '') {
      failures.push({ gate: 'INVARIANT', detail: `#1 py_scope.ownerHash empty (discriminator claims ${ownerKind})` });
      continue;
    }
    const expected = ownerRelationFor[ownerKind];
    if (expected && !expected.has(ownerHash)) {
      failures.push({
        gate: 'INVARIANT',
        detail: `#1 py_scope ownerKind=${ownerKind} but ownerHash does not resolve in that relation`,
      });
    }
  }
  // Every lambda scope must have a py_method of kind LAMBDA — schema §2.7 lists
  // `lambda` alongside `def`, and the startColumn in the py_method key exists
  // precisely because two lambdas can share a line.
  const lambdaScopes = facts.scopes.filter(s => s.toCsv().split('\t')[0] === 'LAMBDA').length;
  const lambdaMethods = facts.methods.filter(m => m.toCsv().split('\t')[16] === 'LAMBDA').length;
  if (lambdaScopes !== lambdaMethods) {
    failures.push({
      gate: 'INVARIANT',
      detail: `#7 ${lambdaScopes} LAMBDA scopes but ${lambdaMethods} LAMBDA methods`,
    });
  }
  for (const binding of facts.bindings) {
    if (binding.toCsv().split('\t')[25] === '') {
      failures.push({
        gate: 'INVARIANT',
        detail: `#1 py_binding.pyMethodLinkHash empty — local-flow.dl ports through this column`,
      });
    }
  }
  for (const call of facts.callSites) {
    const cols = call.toCsv().split('\t');
    if ((cols[4] !== 'NONE') !== (cols[6] !== '')) {
      failures.push({
        gate: 'INVARIANT',
        detail: `#1 py_call_site receiverKind=${cols[4]} but receiverExpressionLinkHash ${cols[6] ? 'set' : 'empty'}`,
      });
    }
  }
  for (const parameter of facts.methodParameters) {
    const cols = parameter.toCsv().split('\t');
    if ((cols[13] === 'true') !== (cols[19] !== '')) {
      failures.push({
        gate: 'INVARIANT',
        detail: `#1 py_method_parameter hasDefault=${cols[13]} but pyExpressionLinkHash ${cols[19] ? 'set' : 'empty'}`,
      });
    }
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
    // NOTE: `class X(metaclass=EnumMeta): RED = 1` does NOT run — it raises
    // TypeError, because the Enum machinery needs its own base. The runtime
    // adjudicator caught this fixture asserting about impossible code. The one
    // real occurrence of metaclass=EnumMeta as the sole enum signal is
    // `enum.Enum` itself, which is memberless, so that is what is modelled.
    'class FunctionalEnum(metaclass=EnumMeta):',
    '    pass',
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
    'all-python-fields.csv': DEFERRED_ARITY.py_field!,
    'all-python-field-positions.csv': DEFERRED_ARITY.py_field_position!,
    'all-python-blocks.csv': DEFERRED_ARITY.py_block!,
    'all-python-parse-gaps.csv': DEFERRED_ARITY.py_parse_gap!,
    'all-python-comments.csv': DEFERRED_ARITY.py_comment!,
    'all-python-type-parameters.csv': DEFERRED_ARITY.py_type_parameter!,
    'all-python-decorators.csv': DEFERRED_ARITY.py_decorator!,
    'all-python-decorator-arguments.csv': DEFERRED_ARITY.py_decorator_argument!,
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

/**
 * Grammar EXTRAS must never become entities, at any of the three sites where a
 * comma-separated list occurs.
 *
 * A comment or line-continuation backslash is a NAMED tree-sitter node, so
 * iterating named children counts it. This has now bitten in three separate
 * places — argument lists, parameter lists, and base lists — and the base-list
 * case is the worst of the three because a base carries an **MRO position**:
 * `class C(A,  # comment\n B)` put the comment at position 1 and pushed `B` to 2,
 * silently corrupting C3 linearisation. Reported by A4 as a4-037, on sqlalchemy
 * and tensorflow.
 */
function extraNodeTests(): Failure[] {
  const failures: Failure[] = [];
  const check = (label: string, actual: unknown, expected: unknown) => {
    if (String(actual) !== String(expected)) {
      failures.push({
        gate: 'INVARIANT',
        detail: `extras ${label}: expected ${expected}, got ${actual}`,
      });
    }
  };

  // Base list with a comment between bases.
  const bases = new PythonFactExtractor().extract({
    sourceCode: 'class C(A,  # comment\n        B):\n    pass\n',
    filePath: 'bases.py', baseMservPath: '/repo', serviceVersionLinkHash: SERVICE_VERSION,
  });
  check('base count', bases.typeBases.length, 2);
  check('py_type.baseCount', bases.types[0]?.toCsv().split('\t')[19], '2');
  const positions = bases.typeBases.map(b => b.toCsv().split('\t')[1]).join(',');
  check('MRO positions', positions, '0,1');
  const names = bases.typeBases.map(b => b.toCsv().split('\t')[3]).join(',');
  check('base names', names, 'A,B');

  // Argument list with a comment, and with a line continuation.
  const args = new PythonFactExtractor().extract({
    sourceCode: 'f(a,  # why\n  b, \\\n  c)\n',
    filePath: 'args.py', baseMservPath: '/repo', serviceVersionLinkHash: SERVICE_VERSION,
  });
  check('positional arg count', args.callSites[0]?.getPositionalArgCount(), 3);

  // Parameter list with a trailing comment.
  const params = new PythonFactExtractor().extract({
    sourceCode: 'def g(*, a=1, b=2):  # note\n    return a\n',
    filePath: 'params.py', baseMservPath: '/repo', serviceVersionLinkHash: SERVICE_VERSION,
  });
  const g = params.methods.find(m => m.getName() === 'g');
  check('kwOnlyCount', g?.toCsv().split('\t')[25], '2');

  return failures;
}

/**
 * A dotted name in TYPE position is `member_type`, not `attribute`.
 *
 * `def f(v: A[int].Inner)` — the grammar gives the dotted type its own node, so
 * the generic walk visited its trailing identifier and invented a module binding
 * for `Inner` that CPython does not have. Reported by A4 as a4-035. The trailing
 * name is an attribute label, exactly as in an ordinary attribute access.
 */
function memberTypeTests(): Failure[] {
  const failures: Failure[] = [];
  const facts = new PythonFactExtractor().extract({
    sourceCode: 'def f(v: A[int].Inner):\n    return v\n',
    filePath: 'membertype.py', baseMservPath: '/repo', serviceVersionLinkHash: SERVICE_VERSION,
  });
  const moduleScope = facts.scopes.find(s => s.toCsv().split('\t')[0] === 'MODULE');
  const moduleBindings = facts.bindings
    .filter(b => b.getPyScopeLinkHash() === moduleScope?.getHash())
    .map(b => b.getName())
    .sort();
  // CPython's symtable: ['A', 'f', 'int'] — `Inner` is an attribute label.
  if (moduleBindings.join(',') !== 'A,f,int') {
    failures.push({
      gate: 'INVARIANT',
      detail: `member_type: module bindings should be A,f,int — got ${moduleBindings.join(',')}`,
    });
  }
  return failures;
}

/**
 * Column units: CPython reports `col_offset` in **UTF-8 bytes**, tree-sitter in
 * characters.
 *
 * This test exists because the difference is invisible on ASCII-only code — and
 * so is invisible on almost every fixture — while being wrong on any line
 * containing a non-ASCII character before the node. It is not cosmetic:
 * `startColumn` is in the primary key of py_scope, py_method and py_expression,
 * so the two conventions mint DIFFERENT HASHES for the same entity, and the
 * schema states that startColumn is ast-derived.
 *
 * Found in the wild in jina/logging/profile.py: `f'memory Δ {get_readable_size(n)}'`
 * shifts every column after the delta by one.
 */
function columnUnitTests(): Failure[] {
  const failures: Failure[] = [];
  // A one-character, two-byte delta before a call on the same line.
  const source = "x = f'a \u0394 {foo(1)}'\ny = foo(2)\n";
  const facts = new PythonFactExtractor().extract({
    sourceCode: source, filePath: 'units.py', baseMservPath: '/repo',
    serviceVersionLinkHash: SERVICE_VERSION,
  });

  // `foo(1)` sits after the delta: 11 characters in, 12 UTF-8 bytes in.
  const shifted = facts.callSites.find(c => c.getStartLine() === 1);
  if (!shifted) {
    failures.push({ gate: 'INVARIANT', detail: 'column units: expected a call on line 1' });
  } else {
    const column = Number(shifted.toCsv().split('\t')[22]);
    if (column !== 12) {
      failures.push({
        gate: 'INVARIANT',
        detail: `column units: call after a 2-byte character should report byte column 12 (ast), got ${column}`,
      });
    }
  }
  // The ASCII line must be unaffected, so the conversion is not over-applied.
  const ascii = facts.callSites.find(c => c.getStartLine() === 2);
  if (ascii) {
    const column = Number(ascii.toCsv().split('\t')[22]);
    if (column !== 4) {
      failures.push({
        gate: 'INVARIANT',
        detail: `column units: ASCII-only line should report column 4, got ${column}`,
      });
    }
  }
  return failures;
}

/**
 * Checks the code's column counts against the **schema document itself**.
 *
 * This is Appendix B invariant #11 in spirit: the document says 10 relations and
 * 266 columns, and that claim is worth nothing unless something executes it. The
 * document's own §2 section headers state an arity, and each has a numbered
 * column table under it, so all three can be cross-checked — header count,
 * actual table rows, and the `getCsvHeader()` the parser emits. A column-order
 * or column-count error is silent and invalidates every golden file, which is
 * precisely why the schema is frozen.
 */
function schemaDocumentTests(): Failure[] {
  const failures: Failure[] = [];
  const docPath = 'python-work/PYTHON-FACT-SCHEMA.md';
  if (!fs.existsSync(docPath)) {
    // The doc is not owned by the parser, so its absence is not a parser failure.
    return failures;
  }
  const doc = fs.readFileSync(docPath, 'utf8');

  const src = 'import os\nclass K(Base, metaclass=M):\n    def m(self, x=1):\n        return self.m(x)\n';
  const facts = new PythonFactExtractor().extract({
    sourceCode: src, filePath: 'a.py', baseMservPath: '/repo',
    serviceVersionLinkHash: SERVICE_VERSION,
  });
  const headers: Record<string, string | undefined> = {
    py_module: facts.module?.getCsvHeader(),
    py_scope: facts.scopes[0]?.getCsvHeader(),
    py_binding: facts.bindings[0]?.getCsvHeader(),
    py_type: facts.types[0]?.getCsvHeader(),
    py_type_base: facts.typeBases[0]?.getCsvHeader(),
    py_method: facts.methods[0]?.getCsvHeader(),
    py_method_parameter: facts.methodParameters[0]?.getCsvHeader(),
    py_import: facts.imports[0]?.getCsvHeader(),
    py_expression: facts.expressions[0]?.getCsvHeader(),
    py_call_site: facts.callSites[0]?.getCsvHeader(),
  };

  let documentTotal = 0;
  for (const section of doc.split('\n### ')) {
    const match = /^2\.\d+ `(py_\w+)` \/ `lib_py_\w+` — (\d+) columns/.exec(section);
    if (!match) {
      continue;
    }
    const relation = match[1]!;
    const stated = Number(match[2]);
    if (!(relation in SPINE_ARITY)) {
      continue;
    }
    documentTotal += stated;

    if (stated !== SPINE_ARITY[relation]) {
      failures.push({
        gate: 'INVARIANT',
        detail: `#11 ${relation}: document says ${stated} columns, harness constant says ${SPINE_ARITY[relation]}`,
      });
    }
    // The document's numbered column rows must match its own stated arity.
    const body = section.split('\n## ')[0]!;
    const rows = body.match(/^\| \d+ \| `[^`]+`/gm) ?? [];
    if (rows.length > 0 && rows.length !== stated) {
      failures.push({
        gate: 'INVARIANT',
        detail: `#11 ${relation}: document header says ${stated} columns but lists ${rows.length}`,
      });
    }
    // And the emitted header must match too.
    const header = headers[relation];
    if (header !== undefined) {
      const emitted = header.split('\t').length;
      if (emitted !== stated) {
        failures.push({
          gate: 'INVARIANT',
          detail: `#11 ${relation}: document says ${stated} columns, parser emits ${emitted}`,
        });
      }
    }
  }

  // 266 as of schema v7, up from 262: `py_type_inference` was deleted and folded
  // into four appended `py_expression` columns. This constant is the ratchet —
  // it caught the change on the first run after the append, which is what it is
  // for. Bumping it is a deliberate act recording an approved amendment, not
  // maintenance.
  const FROZEN_SPINE_COLUMNS = 266;
  if (documentTotal !== FROZEN_SPINE_COLUMNS) {
    failures.push({
      gate: 'INVARIANT',
      detail: `#11 spine total: document sums to ${documentTotal}, expected ${FROZEN_SPINE_COLUMNS}`,
    });
  }
  return failures;
}

/** Resolution rate per receiverKind — reported so a regression is visible. */
function countResolution(
  facts: ReturnType<typeof extract>
): Map<string, { resolved: number; total: number }> {
  const out = new Map<string, { resolved: number; total: number }>();
  for (const callSite of facts.callSites) {
    const key = callSite.getReceiverKind();
    const entry = out.get(key) ?? { resolved: 0, total: 0 };
    entry.total += 1;
    if (callSite.getResolvedCalleeKind() !== 'UNRESOLVED') {
      entry.resolved += 1;
    }
    out.set(key, entry);
  }
  return out;
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
      resolution: new Map(),
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
      failures.push(...gate2Expressions(file));
    }
  }
  // Invariants need no oracle, so they run even when ground truth is missing.
  failures.push(...invariants(file, facts));
  failures.push(...resolutionGate(facts));
  return {
    file,
    failures,
    oracleUnavailable,
    resolution: countResolution(facts),
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
    ...columnUnitTests(),
    ...extraNodeTests(),
    ...memberTypeTests(),
    ...mroResolutionTests(),
    ...annotationTypeLinkTests(),
    ...typeReferenceTreeTests(),
    ...schemaDocumentTests(),
    ...(await analyzerTests()),
  ];
  console.log(
    `\nPy2 rejection, parse limit, classification, column units, extras, member_type, C3 MRO, annotation links, type-ref tree, schema arity, analyzer: ${standalone.length === 0 ? 'PASS' : `${standalone.length} FAILURES`}`
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

  const resolution = new Map<string, { resolved: number; total: number }>();
  for (const r of results) {
    for (const [kind, counts] of r.resolution) {
      const entry = resolution.get(kind) ?? { resolved: 0, total: 0 };
      entry.resolved += counts.resolved;
      entry.total += counts.total;
      resolution.set(kind, entry);
    }
  }
  const totalResolved = [...resolution.values()].reduce((a, c) => a + c.resolved, 0);
  const totalCalls = [...resolution.values()].reduce((a, c) => a + c.total, 0);
  console.log(`\nCall-site resolution: ${totalResolved}/${totalCalls}` +
    (totalCalls > 0 ? ` (${((totalResolved / totalCalls) * 100).toFixed(1)}%)` : ''));
  for (const kind of [...resolution.keys()].sort()) {
    const c = resolution.get(kind)!;
    console.log(`  ${kind.padEnd(12)} ${c.resolved}/${c.total}`);
  }

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
