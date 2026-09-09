/**
 * Every enum value the schema DECLARES must have code that can produce it.
 *
 * The defect chain so far has been reactive: the engine consumes the IR, gets a
 * wrong answer, and someone traces it back. That process can only find facts
 * that are WRONG. It cannot find facts that are ABSENT, because from the
 * consumer side an absent classification is indistinguishable from one that
 * does not apply. Nobody files an issue about a value they have never seen.
 *
 * So this looks the other way round: for each value declared in an enum under
 * `src/enums/python`, is there any code outside the enum declarations and the
 * tests that constructs it? A value nothing constructs is a promise the schema
 * makes and the parser does not keep. Consumers write rules against the
 * declared surface, so a permanently absent value is a rule that never fires.
 *
 * ## Why this is static and not corpus-driven
 *
 * Running a corpus and collecting the values it happens to emit answers a
 * different and much weaker question, because a value can be missing simply
 * because the corpus lacks the construct. Measured while writing this: of 128
 * values absent from a 124-file stdlib slice, 73 were emitted by code and only
 * absent from that sample -- `STUB` needs a `.pyi`, `FIELD_TYPE` needs a class
 * annotation, `futureImports` needs a `__future__` import. Corpus absence is
 * evidence of nothing. Whether a code path EXISTS is decidable from the source
 * alone, needs no corpus, no interpreter and no network, and cannot drift with
 * whatever files a fixture happens to contain.
 *
 * ## Ratchet, not a pass/fail bar
 *
 * The count is pinned and may fall, never rise. Lowering the bar means deleting
 * a name from the list below, which is a reviewable act. Adding a new enum
 * value with no producer fails immediately, which is the case worth catching:
 * the schema and the parser drifting apart at the moment the schema grows.
 */
import * as fs from 'fs';
import * as path from 'path';

const ENUM_ROOT = 'src/enums/python';
const SOURCE_ROOT = 'src';

/**
 * Values declared with no code that constructs them, as measured today.
 *
 * This is a record of a real gap, not a list of things that are fine. Grouped
 * by cause so that fixing one cause removes a block rather than one line.
 */
const KNOWN_UNPRODUCED: Record<string, string[]> = {
  PythonBaseKind: ['IMPLICIT_OBJECT'],
  PythonBindingTargetKind: ['MODULE', 'TYPE_ALIAS', 'TYPE_VAR', 'VARIABLE'],
  PythonBlockKind: ['COMPREHENSION_BODY', 'LAMBDA_BODY'],
  // Partial classifications: the enum distinguishes cases the emitter does not.
  PythonCallKind: ['BUILTIN_CALL', 'INSTANCE_CALL', 'MODULE_CALL'],
  PythonCommentKind: ['DOCSTRING_ATTRIBUTE'],
  PythonDialect: ['PY_UNKNOWN'],
  PythonEmissionRegime: ['PY3_12_PLUS'],
  PythonExpressionOwnerKind: [
    'BINDING',
    'BLOCK',
    'COMPREHENSION_SCOPE',
    'DECORATOR',
    'FIELD',
    'IMPORT',
  ],

  PythonGrammarUsed: ['UNPARSED'],
  PythonImportKind: ['DYNAMIC'],
  PythonImportTargetKind: ['AMBIGUOUS', 'PACKAGE', 'VARIABLE'],
  PythonInferredTypeKind: ['USER_CLASS'],
  PythonLiteralType: ['COMPLEX'],
  // A directory with no __init__ contributes no name segment, so a namespace
  // package is never recognised as one. Same cause as src/main.py and
  // tests/main.py both being named `main`.
  PythonModuleKind: ['NAMESPACE_PACKAGE', 'SCRIPT'],
  PythonParseGapDisposition: ['SKIPPED'],
  PythonParseGapKind: ['EXEC_COMPLEX_EXPR'],
  PythonReceiverKind: ['MODULE', 'TYPE'],
  // Was the largest single gap: every variable reference came out UNKNOWN, 86%
  // of expression references on a stdlib slice, while py_binding already held
  // the answer at full CPython parity -- computed in one relation and dropped
  // in another. Ten now resolve from the binding. The two that remain name
  // something the binding table does not describe: an attribute belongs to a
  // type, and a module is not a name bound in the referencing scope.
  PythonReferencedEntityKind: ['ATTRIBUTE', 'MODULE'],
  PythonRootContext: ['OTHER_STATEMENT', 'YIELD_VALUE'],
  // PEP 695 annotation scopes now emit and are asserted against CPython 3.12's symtable by
  // the `PEP 695 type parameters` check. ANNOTATION remains: symtable has no scope of that
  // type in 3.12 — type parameters, bounds and aliases are each reported as their own kind —
  // so there is no construct to produce it from until a later version defines one.
  PythonScopeKind: ['ANNOTATION'],
  PythonTypeParameterVariance: ['CONTRAVARIANT', 'COVARIANT', 'INVARIANT'],
  PythonTypeRefContext: [
    'CAST_TARGET',
    'OVERLOAD_SIGNATURE',
    'TYPE_ALIAS',
    'TYPE_COMMENT',
  ],
  // TypeVar now emits with its name and variance, so PythonTypeRefKind and
  // PythonWildcardVariance are fully produced and have left this list.
  // TYPEVAR_BOUND has left this list: the bound is now emitted as a reference
  // owned by the type variable's own binding.
  PythonTypeRefOwnerKind: ['BLOCK', 'DECORATOR'],
};

/** Total pinned today. May fall, never rise. */
const UNPRODUCED_BAR = Object.values(KNOWN_UNPRODUCED).reduce((n, v) => n + v.length, 0);

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** enum name -> declared member names, read from the declarations themselves. */
function declaredEnums(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of walk(ENUM_ROOT)) {
    const text = fs.readFileSync(file, 'utf-8');
    const named = /export enum (\w+)\s*\{([^}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = named.exec(text)) !== null) {
      const members = [...match[2]!.matchAll(/^\s*([A-Za-z0-9_]+)\s*=/gm)].map((m) => m[1]!);
      if (members.length > 0) {
        found.set(match[1]!, members);
      }
    }
  }
  return found;
}

export async function enumEmission(): Promise<number> {
  const problems: string[] = [];
  const enums = declaredEnums();

  // Producing code only: the declarations themselves and the tests do not count,
  // or every value would look produced by the file that declares it.
  const producers = walk(SOURCE_ROOT).filter(
    (f) => !f.includes(`${path.sep}enums${path.sep}`) && !f.includes(`${path.sep}test${path.sep}`)
  );
  const corpus = producers.map((f) => fs.readFileSync(f, 'utf-8')).join('\n');

  const unproduced = new Map<string, string[]>();
  let declaredCount = 0;
  for (const [name, members] of enums) {
    const missing: string[] = [];
    for (const member of members) {
      declaredCount += 1;
      if (!corpus.includes(`${name}.${member}`)) {
        missing.push(member);
      }
    }
    if (missing.length > 0) {
      unproduced.set(name, missing.sort());
    }
  }

  const total = [...unproduced.values()].reduce((n, v) => n + v.length, 0);

  // A value that started being produced should be removed from the list, and a
  // value that STOPPED being produced is a regression, so both directions are
  // reported rather than only the count.
  for (const [name, members] of unproduced) {
    const known = KNOWN_UNPRODUCED[name] ?? [];
    for (const member of members) {
      if (!known.includes(member)) {
        problems.push(`${name}.${member} is declared but nothing constructs it, and it is not pinned`);
      }
    }
  }
  const nowProduced: string[] = [];
  for (const [name, members] of Object.entries(KNOWN_UNPRODUCED)) {
    const stillMissing = unproduced.get(name) ?? [];
    for (const member of members) {
      if (!stillMissing.includes(member)) {
        nowProduced.push(`${name}.${member}`);
      }
    }
  }

  console.log(`  ${enums.size} enums, ${declaredCount} declared values, ${total} with no producer`);
  if (total > UNPRODUCED_BAR) {
    problems.push(`values with no producer rose to ${total}, bar is ${UNPRODUCED_BAR}`);
  }
  if (nowProduced.length > 0) {
    console.log(
      `  NOTE   ${nowProduced.length} pinned value(s) now produced; remove from ` +
      `KNOWN_UNPRODUCED to lock the gain: ${nowProduced.slice(0, 6).join(', ')}`
    );
  }
  for (const problem of problems) {
    console.log(`  FAIL  ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}
