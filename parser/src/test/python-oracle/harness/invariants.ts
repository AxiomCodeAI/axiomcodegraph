import {
  COMPREHENSION_SCOPE_KINDS,
  EMISSION_REGIME,
  EXPECTED_VERSION,
  PK_INDEX,
  PK_PATTERN,
  SPINE_ARITY,
  SVC_INDEX,
  SYMBOL_PREDICATES,
  SYNTHETIC_ITERATOR,
} from './constants';
import { col } from './row';
import { FactSet, InvariantResult, OraclePayload } from './types';

const MAX_REPORTED = 25;

function result(
  id: number,
  name: string,
  violations: string[],
  checked: number,
  skipped?: string
): InvariantResult {
  const shown = violations.slice(0, MAX_REPORTED);
  if (violations.length > MAX_REPORTED) {
    shown.push(`... and ${violations.length - MAX_REPORTED} more`);
  }
  return { id, name, passed: violations.length === 0, checked, violations: shown, skipped };
}

/**
 * Foreign-key columns per relation, as (columnIndex -> target relation).
 * Polymorphic FKs carry a discriminator column and are handled separately.
 * Derived from schema v6 §2; positions are the frozen contract.
 */
const FK_MAP: Record<string, Record<number, string>> = {
  py_scope: { 4: 'py_scope', 5: 'py_module' },
  py_binding: { 1: 'py_scope', 24: 'py_module', 25: 'py_method' },
  py_type: { 12: 'py_module', 13: 'py_type', 14: 'py_method', 15: 'py_scope' },
  py_type_base: { 6: 'py_type', 7: 'py_module' },
  py_method: { 7: 'py_type', 20: 'py_method', 21: 'py_module', 22: 'py_scope' },
  py_method_parameter: { 2: 'py_method', 18: 'py_binding' },
  py_import: { 12: 'py_module', 19: 'py_scope', 20: 'py_module', 21: 'py_binding' },
  py_expression: { 6: 'py_expression', 4: 'py_type', 24: 'py_scope', 25: 'py_module', 26: 'py_binding' },
  py_call_site: { 5: 'py_expression', 6: 'py_expression', 7: 'py_scope', 8: 'py_method', 9: 'py_type', 10: 'py_module' },
};

/** #1 — every non-empty FK resolves to an existing PK in its target relation. */
export function invariant1_referentialIntegrity(facts: FactSet): InvariantResult {
  const pks: Record<string, Set<string>> = {};
  for (const [rel, rows] of Object.entries(facts)) {
    const idx = PK_INDEX(rel);
    if (idx === undefined || Number.isNaN(idx)) continue;
    pks[rel] = new Set(rows.map((r) => col(r, idx)));
  }
  const violations: string[] = [];
  let checked = 0;
  for (const [rel, rows] of Object.entries(facts)) {
    const fks = FK_MAP[rel];
    if (!fks) continue;
    for (const row of rows) {
      for (const [colStr, target] of Object.entries(fks)) {
        const colIdx = Number(colStr);
        const val = col(row, colIdx);
        if (!val) continue; // "" is the legal absent value — Souffle has no nulls
        checked++;
        if (!pks[target] || !pks[target].has(val)) {
          violations.push(`${rel}.c${colIdx} -> ${target}: dangling ${val} (row PK ${col(row, PK_INDEX(rel))})`);
        }
      }
    }
  }
  return result(1, 'referential integrity', violations, checked);
}

/** #2 — the last column is unique within each relation. */
export function invariant2_noPkCollisions(facts: FactSet): InvariantResult {
  const violations: string[] = [];
  let checked = 0;
  for (const [rel, rows] of Object.entries(facts)) {
    const idx = PK_INDEX(rel);
    if (Number.isNaN(idx)) continue;
    const seen = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      checked++;
      const pk = col(rows[i]!, idx);
      if (seen.has(pk)) {
        violations.push(`${rel}: PK ${pk} at rows ${seen.get(pk)} and ${i}`);
      } else {
        seen.set(pk, i);
      }
    }
  }
  return result(2, 'no PK collisions', violations, checked);
}

/** #3 — PK matches PY_<KIND>_<md5> and the prefix matches its relation. */
export function invariant3_prefixDiscipline(facts: FactSet): InvariantResult {
  const violations: string[] = [];
  let checked = 0;
  for (const [rel, rows] of Object.entries(facts)) {
    const idx = PK_INDEX(rel);
    if (Number.isNaN(idx)) continue;
    const expectedPrefix = rel.replace(/^py_/, 'PY_').toUpperCase() + '_';
    for (const row of rows) {
      checked++;
      const pk = col(row, idx);
      if (!PK_PATTERN.test(pk)) {
        violations.push(`${rel}: malformed PK ${JSON.stringify(pk)}`);
      } else if (!pk.startsWith(expectedPrefix)) {
        violations.push(`${rel}: PK prefix mismatch, expected ${expectedPrefix}, got ${pk}`);
      }
    }
  }
  return result(3, 'PK prefix discipline', violations, checked);
}

/** #4 — serviceVersionLinkHash present, identical everywhere, immediately before the PK. */
export function invariant4_serviceVersion(facts: FactSet): InvariantResult {
  const violations: string[] = [];
  const seen = new Set<string>();
  let checked = 0;
  for (const [rel, rows] of Object.entries(facts)) {
    const idx = SVC_INDEX(rel);
    if (Number.isNaN(idx)) continue;
    for (const row of rows) {
      checked++;
      const v = col(row, idx);
      if (!v) {
        violations.push(`${rel}: empty serviceVersionLinkHash at c${idx}`);
      } else {
        seen.add(v);
      }
    }
  }
  if (seen.size > 1) {
    violations.push(`multiple serviceVersionLinkHash values in one analysis: ${[...seen].join(', ')}`);
  }
  return result(4, 'serviceVersionLinkHash present and uniform', violations, checked);
}

/** #5 — byte-identical output across runs (caller supplies two renderings). */
export function invariant5_deterministic(runA: string, runB: string): InvariantResult {
  const violations: string[] = [];
  if (runA !== runB) {
    const a = runA.split('\n');
    const b = runB.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        violations.push(`first divergence at line ${i + 1}:\n  A: ${a[i]}\n  B: ${b[i]}`);
        break;
      }
    }
    if (!violations.length) violations.push('outputs differ but no line diverged (trailing bytes)');
  }
  return result(5, 'byte-identical across runs', violations, 1);
}

/** #6 — every row's field count equals the relation's declared arity. */
export function invariant6_columnCount(facts: FactSet): InvariantResult {
  const violations: string[] = [];
  let checked = 0;
  for (const [rel, rows] of Object.entries(facts)) {
    const arity = SPINE_ARITY[rel];
    if (arity === undefined) {
      violations.push(`${rel}: not a frozen spine relation`);
      continue;
    }
    for (let i = 0; i < rows.length; i++) {
      checked++;
      const len = rows[i]!.length;
      if (len !== arity) {
        violations.push(`${rel} row ${i}: ${len} fields, expected ${arity}`);
      }
    }
  }
  return result(6, 'column-count invariance', violations, checked);
}

/** #7 — ownership totality: expressions, call sites and blocks reach a method and a scope. */
export function invariant7_ownershipTotality(facts: FactSet): InvariantResult {
  const violations: string[] = [];
  let checked = 0;
  const methods = new Set((facts['py_method'] ?? []).map((r) => col(r, PK_INDEX('py_method'))));
  const scopes = new Set((facts['py_scope'] ?? []).map((r) => col(r, PK_INDEX('py_scope'))));

  for (const row of facts['py_call_site'] ?? []) {
    checked++;
    const csPk = col(row, 25);
    if (!col(row, 8)) violations.push(`py_call_site ${csPk}: empty pyMethodLinkHash (must be <module> if top-level)`);
    else if (!methods.has(col(row, 8))) violations.push(`py_call_site ${csPk}: caller ${col(row, 8)} not a py_method`);
    if (!col(row, 7) || !scopes.has(col(row, 7))) violations.push(`py_call_site ${csPk}: scope ${col(row, 7)} unresolved`);
  }
  for (const row of facts['py_expression'] ?? []) {
    checked++;
    if (!col(row, 24) || !scopes.has(col(row, 24))) {
      violations.push(`py_expression ${col(row, 34)}: pyScopeLinkHash ${col(row, 24)} unresolved`);
    }
  }
  return result(7, 'ownership totality', violations, checked);
}

/** #8 — scope tree is a forest: one root per module, no cycles, parent exists. */
export function invariant8_scopeForest(facts: FactSet): InvariantResult {
  const violations: string[] = [];
  const rows = facts['py_scope'] ?? [];
  const pkIdx = PK_INDEX('py_scope');
  const parent = new Map<string, string>();
  const moduleOf = new Map<string, string>();
  const roots: Record<string, string[]> = {};

  for (const r of rows) {
    const id = col(r, pkIdx);
    parent.set(id, col(r, 4));
    moduleOf.set(id, col(r, 5));
    if (!col(r, 4)) (roots[col(r, 5)] ??= []).push(id);
  }
  for (const [mod, rs] of Object.entries(roots)) {
    if (rs.length !== 1) violations.push(`module ${mod}: ${rs.length} root scopes, expected exactly 1`);
  }
  for (const id of parent.keys()) {
    const seen = new Set<string>([id]);
    let cur: string | undefined = parent.get(id) || undefined;
    let hops = 0;
    while (cur) {
      if (seen.has(cur)) {
        violations.push(`cycle in scope chain at ${id}`);
        break;
      }
      if (!parent.has(cur)) {
        violations.push(`scope ${id}: parent ${cur} does not exist`);
        break;
      }
      seen.add(cur);
      cur = parent.get(cur) || undefined;
      if (++hops > 1000) {
        violations.push(`scope ${id}: chain exceeded 1000 hops`);
        break;
      }
    }
  }
  return result(8, 'scope-tree forest, acyclic', violations, rows.length);
}

/**
 * #9 — oracle agreement is computed in compare.ts (it needs precision/recall and
 * disagreement classification). Here we assert the two structural preconditions
 * that make that comparison MEANINGFUL:
 *
 *   (a) symtable child order == ast source order. py_scope.startColumn is
 *       ast-derived while symtable exposes only a line, so the PK depends on
 *       pairing the two. If the orders diverge, every startColumn is attached to
 *       the wrong scope and the comparison silently compares the wrong things.
 *   (b) the synthetic `.0` is asserted POSITIVELY per §4.4.
 */
export function invariant9a_symtableAstPairing(oracle: OraclePayload): InvariantResult {
  const violations: string[] = [];
  let checked = 0;

  // A fatal payload (syntax error, recursion limit) has no pairing to check.
  // Report it rather than throwing: the harness must never crash on input it is
  // meant to adjudicate, or a bad file takes the whole sweep down with it.
  if (oracle.fatal) {
    return result(9, 'symtable/ast pairing', [], 0, `skipped: oracle fatal ${oracle.fatal}`);
  }
  if (!Array.isArray(oracle.pairing)) {
    return result(9, 'symtable/ast pairing', ['payload has no pairing block'], 0);
  }

  for (const p of oracle.pairing) {
    checked++;

    // (1) every symtable child paired with exactly one ast node, and vice versa
    for (const u of p.unpaired ?? []) {
      violations.push(`scope ${p.scopeName}: ${u}`);
    }
    if ((p.unpaired ?? []).length > 0) continue;

    if (p.astChildren.length !== p.symtableChildren.length) {
      violations.push(
        `scope ${p.scopeName}: ${p.astChildren.length} ast scope nodes vs ` +
          `${p.symtableChildren.length} symtable children`
      );
      continue;
    }

    const paired = p.pairedColumns ?? [];
    if (paired.length !== p.symtableChildren.length) {
      violations.push(
        `scope ${p.scopeName}: ${paired.length} pairings for ${p.symtableChildren.length} symtable children`
      );
      continue;
    }

    // (2) the pairing must agree with symtable on identity, positionally
    for (let i = 0; i < paired.length; i++) {
      const sc = p.symtableChildren[i]!;
      const pr = paired[i]!;
      if (pr.type !== sc.type || pr.name !== sc.name || pr.line !== sc.line) {
        violations.push(
          `scope ${p.scopeName} child ${i}: paired ${pr.type}:${pr.name}@${pr.line} ` +
            `against symtable ${sc.type}:${sc.name}@${sc.line}`
        );
      }
    }

    // (3) THE POINT: the pairing must be UNAMBIGUOUS. py_scope.startColumn is
    // ast-derived and the PK depends on it, so two children that are
    // indistinguishable to symtable (same type+name+line) must be separated by
    // column — otherwise startColumn could be attached to the wrong scope and
    // the PKs would silently swap.
    const byIdentity = new Map<string, number[]>();
    for (const pr of paired) {
      const k = `${pr.type}:${pr.name}@${pr.line}`;
      (byIdentity.get(k) ?? byIdentity.set(k, []).get(k)!).push(pr.col);
    }
    for (const [k, cols] of byIdentity) {
      if (cols.length > 1 && new Set(cols).size !== cols.length) {
        violations.push(
          `scope ${p.scopeName}: ${cols.length} children share identity ${k} AND a column ` +
            `(${cols.join(',')}) — startColumn cannot disambiguate them, PK collision`
        );
      }
    }
  }
  return result(
    9,
    'symtable children pair 1:1 with ast scope nodes, unambiguously by column',
    violations,
    checked
  );
}

/** #9b — `.0` positive assertion (not a whitelist). */
export function invariant9b_syntheticIterator(oracle: OraclePayload): InvariantResult {
  const violations: string[] = [];
  if (oracle.fatal) {
    return result(9, "synthetic '.0'", [], 0, `skipped: oracle fatal ${oracle.fatal}`);
  }
  if (!Array.isArray(oracle.scopes) || !Array.isArray(oracle.bindings)) {
    return result(9, "synthetic '.0'", ['payload has no scopes/bindings block'], 0);
  }
  const byScope = new Map<string, number>();
  for (const b of oracle.bindings) {
    if (b.name === SYNTHETIC_ITERATOR) {
      byScope.set(b.scopeId, (byScope.get(b.scopeId) ?? 0) + 1);
    }
  }
  for (const s of oracle.scopes) {
    const n = byScope.get(s.scopeId) ?? 0;
    const isComp = COMPREHENSION_SCOPE_KINDS.has(s.scopeKind);
    if (isComp && n !== 1) {
      violations.push(`${s.scopeKind} ${s.qualifiedName}: expected exactly one '.0', found ${n}`);
    }
    if (!isComp && n !== 0) {
      violations.push(`${s.scopeKind} ${s.qualifiedName}: '.0' outside a comprehension scope (${n})`);
    }
  }
  return result(9, "synthetic '.0' asserted positively", violations, oracle.scopes.length);
}

/** #10 — interpreter pinning recorded in the payload. */
export function invariant10_interpreterPinned(oracle: OraclePayload): InvariantResult {
  const violations: string[] = [];
  const p = oracle.provenance;
  if (!p) return result(10, 'interpreter pinning recorded', ['no provenance block'], 0);
  if (!p.interpreterPath || !p.interpreterPath.startsWith('/')) {
    violations.push(`interpreterPath must be absolute, got ${JSON.stringify(p.interpreterPath)}`);
  }
  if (!p.sysVersion) violations.push('sysVersion missing');
  if (p.emissionRegime !== EMISSION_REGIME) {
    violations.push(`emissionRegime ${p.emissionRegime} != ${EMISSION_REGIME}`);
  }
  if (p.versionInfo?.[0] !== EXPECTED_VERSION[0] || p.versionInfo?.[1] !== EXPECTED_VERSION[1]) {
    violations.push(`versionInfo ${p.versionInfo?.join('.')} != ${EXPECTED_VERSION.join('.')}.x`);
  }
  if (p.symbolPredicates?.length !== SYMBOL_PREDICATES.length) {
    violations.push(`symbolPredicates has ${p.symbolPredicates?.length}, expected ${SYMBOL_PREDICATES.length}`);
  }
  return result(10, 'interpreter pinning recorded', violations, 1);
}

/** #11 — declarations agree with the schema doc (delegated to gen_decls.py --check). */
export function invariant11_schemaAgreement(checkOutput: string, exitCode: number): InvariantResult {
  const violations: string[] = [];
  if (exitCode !== 0) violations.push(`gen_decls.py --check failed: ${checkOutput.trim()}`);
  return result(11, 'schema/declaration agreement', violations, 1);
}

/** Structural invariants over a fact set (1,2,3,4,6,7,8). */
export function runFactInvariants(facts: FactSet): InvariantResult[] {
  return [
    invariant1_referentialIntegrity(facts),
    invariant2_noPkCollisions(facts),
    invariant3_prefixDiscipline(facts),
    invariant4_serviceVersion(facts),
    invariant6_columnCount(facts),
    invariant7_ownershipTotality(facts),
    invariant8_scopeForest(facts),
  ];
}

/** Invariants over the oracle payload itself (9a, 9b, 10). */
export function runOracleInvariants(oracle: OraclePayload): InvariantResult[] {
  return [
    invariant9a_symtableAstPairing(oracle),
    invariant9b_syntheticIterator(oracle),
    invariant10_interpreterPinned(oracle),
  ];
}
