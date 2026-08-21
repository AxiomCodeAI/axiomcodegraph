import { PK_INDEX, SYMBOL_PREDICATES } from './constants';
import { col } from './row';
import { Disagreement, FactSet, KindScore, OraclePayload } from './types';

/**
 * Set-equality comparison, per entity kind, with every disagreement CLASSIFIED.
 *
 * The comparison key is deliberately NOT the primary hash: the parser computing
 * a different hash for the same entity is one of the bugs we are hunting, and
 * keying on the hash would hide it as a simultaneous MISSING + SPURIOUS pair
 * with no indication they are the same entity. We key on the natural identity
 * (scope path, name) and report hash divergence as a FIELD_MISMATCH.
 */

function scoreOf(entityKind: string, expected: number, actual: number, tp: number): KindScore {
  const precision = actual === 0 ? (expected === 0 ? 1 : 0) : tp / actual;
  const recall = expected === 0 ? (actual === 0 ? 1 : 0) : tp / expected;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { entityKind, expected, actual, truePositives: tp, precision, recall, f1 };
}

/** Stable, human-readable identity for a scope, independent of hashing. */
function scopeKey(qualifiedName: string, kind: string, line: number, col: number): string {
  return `${kind}|${qualifiedName}|${line}:${col}`;
}

export interface ComparisonInput {
  oracle: OraclePayload;
  facts: FactSet;
  /** Maps a parser py_scope row to its natural key. Injected so the harness
   *  does not hard-code column positions in two places. */
  scopeKeyOf?: (row: string[]) => string;
  bindingKeyOf?: (row: string[], scopePkToKey: Map<string, string>) => string;
}

export interface ComparisonOutput {
  scores: KindScore[];
  disagreements: Disagreement[];
}

export function compare(input: ComparisonInput): ComparisonOutput {
  const { oracle, facts } = input;
  const disagreements: Disagreement[] = [];
  const scores: KindScore[] = [];

  // ---------------------------------------------------------------- scopes
  const expectedScopes = new Map<string, (typeof oracle.scopes)[number]>();
  for (const s of oracle.scopes) {
    const k = scopeKey(s.qualifiedName, s.scopeKind, s.startLine, s.startColumn);
    if (expectedScopes.has(k)) {
      disagreements.push({
        entityKind: 'py_scope',
        klass: 'ORACLE_INTERNAL',
        key: k,
        detail: 'oracle produced two scopes with one natural key — harness bug until proven otherwise',
      });
    }
    expectedScopes.set(k, s);
  }

  const scopeRows = facts['py_scope'] ?? [];
  const scopePkIdx = PK_INDEX('py_scope');
  const keyOf =
    input.scopeKeyOf ??
    ((r: string[]) => scopeKey(col(r, 2), col(r, 0), Number(col(r, 18)), Number(col(r, 19))));

  const actualScopes = new Map<string, string[]>();
  const scopePkToKey = new Map<string, string>();
  for (const r of scopeRows) {
    const k = keyOf(r);
    if (actualScopes.has(k)) {
      disagreements.push({
        entityKind: 'py_scope',
        klass: 'KEY_COLLISION',
        key: k,
        detail: `two py_scope rows share the natural key; PKs ${col(actualScopes.get(k)!, scopePkIdx)} and ${col(r, scopePkIdx)}`,
      });
    }
    actualScopes.set(k, r);
    scopePkToKey.set(col(r, scopePkIdx), k);
  }

  let scopeTp = 0;
  for (const [k, exp] of expectedScopes) {
    const act = actualScopes.get(k);
    if (!act) {
      disagreements.push({ entityKind: 'py_scope', klass: 'MISSING', key: k });
      continue;
    }
    scopeTp++;
    const fieldChecks: [string, unknown, unknown][] = [
      ['scopeKind', exp.scopeKind, col(act, 0)],
      ['name', exp.name, col(act, 1)],
      ['qualifiedName', exp.qualifiedName, col(act, 2)],
      ['nestingDepth', String(exp.nestingDepth), col(act, 3)],
      ['isNested', String(exp.isNested), col(act, 8)],
      ['isOptimized', String(exp.isOptimized), col(act, 9)],
      ['hasChildren', String(exp.hasChildren), col(act, 10)],
      ['startLine', String(exp.startLine), col(act, 18)],
      ['startColumn', String(exp.startColumn), col(act, 19)],
      ['scopeOrdinal', String(exp.scopeOrdinal), col(act, 22)],
    ];
    for (const [field, e, a] of fieldChecks) {
      if (String(e) !== String(a)) {
        disagreements.push({
          entityKind: 'py_scope',
          klass: 'FIELD_MISMATCH',
          key: k,
          field,
          expected: e,
          actual: a,
        });
      }
    }
  }
  for (const k of actualScopes.keys()) {
    if (!expectedScopes.has(k)) {
      disagreements.push({ entityKind: 'py_scope', klass: 'SPURIOUS', key: k });
    }
  }
  scores.push(scoreOf('py_scope', expectedScopes.size, actualScopes.size, scopeTp));

  // -------------------------------------------------------------- bindings
  const oracleScopeIdToKey = new Map<string, string>();
  for (const s of oracle.scopes) {
    oracleScopeIdToKey.set(
      s.scopeId,
      scopeKey(s.qualifiedName, s.scopeKind, s.startLine, s.startColumn)
    );
  }

  const expectedBindings = new Map<string, (typeof oracle.bindings)[number]>();
  for (const b of oracle.bindings) {
    const sk = oracleScopeIdToKey.get(b.scopeId) ?? b.scopeId;
    expectedBindings.set(`${sk}::${b.name}`, b);
  }

  const bindRows = facts['py_binding'] ?? [];
  const actualBindings = new Map<string, string[]>();
  for (const r of bindRows) {
    const sk = scopePkToKey.get(col(r, 1)) ?? `<unresolved-scope:${col(r, 1)}>`;
    const k = `${sk}::${col(r, 0)}`;
    if (actualBindings.has(k)) {
      disagreements.push({
        entityKind: 'py_binding',
        klass: 'KEY_COLLISION',
        key: k,
        detail: 'two bindings for one (scope, name) — symtable guarantees this cannot happen',
      });
    }
    actualBindings.set(k, r);
  }

  let bindTp = 0;
  for (const [k, exp] of expectedBindings) {
    const act = actualBindings.get(k);
    if (!act) {
      disagreements.push({ entityKind: 'py_binding', klass: 'MISSING', key: k });
      continue;
    }
    bindTp++;
    // predicates occupy py_binding c4..c14, in symtable's own order
    for (let i = 0; i < SYMBOL_PREDICATES.length; i++) {
      const pred = SYMBOL_PREDICATES[i]!;
      const e = String(exp[pred]);
      const a = col(act, 4 + i);
      if (e !== a) {
        disagreements.push({
          entityKind: 'py_binding',
          klass: 'PREDICATE_MISMATCH',
          key: k,
          field: `${pred} (c${4 + i})`,
          expected: e,
          actual: a,
        });
      }
    }
  }
  for (const k of actualBindings.keys()) {
    if (!expectedBindings.has(k)) {
      disagreements.push({ entityKind: 'py_binding', klass: 'SPURIOUS', key: k });
    }
  }
  scores.push(scoreOf('py_binding', expectedBindings.size, actualBindings.size, bindTp));

  return { scores, disagreements };
}

/** Compact, greppable summary — the number the coordination log carries. */
export function summarise(scores: KindScore[], disagreements: Disagreement[]): string {
  const byClass: Record<string, number> = {};
  for (const d of disagreements) byClass[d.klass] = (byClass[d.klass] ?? 0) + 1;
  const parts = scores.map(
    (s) =>
      `${s.entityKind} P=${(s.precision * 100).toFixed(2)}% R=${(s.recall * 100).toFixed(2)}% ` +
      `(exp ${s.expected}, got ${s.actual}, tp ${s.truePositives})`
  );
  const cls = Object.entries(byClass)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  return parts.join('\n') + (cls ? `\ndisagreements: ${cls}` : '\ndisagreements: none');
}
