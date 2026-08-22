import * as path from 'path';

/**
 * Pinned interpreters, ONE PER EMISSION REGIME. Appendix B invariant #10.
 *
 * ABSOLUTE PATHS, never `python3` and never ambient PATH. This is not fussiness:
 * a conda-activated shell on this machine resolves `python3` to 3.12.4, which
 * inlines comprehensions (PEP 709) and therefore produces a structurally
 * DIFFERENT scope tree. Resolving by name once produced exactly that error.
 *
 * TWO REGIMES, NOT A MIGRATION. Schema §2.1 c11 always allowed both, and
 * emissionRegime sits inside py_module's PK precisely so they can coexist. The
 * difference is measured, not stylistic:
 *
 *   PY3_0_11    def f(): [x for x in r]  ->  f -> listcomp{'.0','x'}
 *   PY3_12_PLUS def f(): [x for x in r]  ->  f{'x','r'}        (inlined, no scope)
 *
 * Generator expressions keep their scope and their '.0' under both. So a fact set
 * from one regime is not comparable with the other at all — they answer different
 * questions, and treating a difference between them as a disagreement would be a
 * category error, not a defect.
 *
 * 3.12 exists here because PEP 695 (`class C[T]`) cannot be adjudicated by an
 * interpreter with no concept of a type parameter, which blocked py_type_parameter.
 */
export const INTERPRETERS = {
  PY3_0_11: '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3',
  PY3_12_PLUS: '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
} as const;

export type EmissionRegime = keyof typeof INTERPRETERS;

/** Major/minor each regime requires. The emitter refuses a mismatch. */
export const REGIME_VERSION: Record<EmissionRegime, readonly [number, number]> = {
  PY3_0_11: [3, 10],
  PY3_12_PLUS: [3, 12],
};

/**
 * The DEFAULT regime — still 3.10. Unchanged deliberately: every golden file and
 * every corpus measurement to date was produced under it, and flipping the default
 * would invalidate all of them at once for a feature only one relation needs.
 * Callers that want PEP 695 ask for it by name.
 */
export const EMISSION_REGIME: EmissionRegime = 'PY3_0_11';

/** Back-compatible alias for the default regime's interpreter. */
export const PINNED_INTERPRETER = INTERPRETERS[EMISSION_REGIME];

/** Expected interpreter major/minor for the default regime. */
export const EXPECTED_VERSION: readonly [number, number] = REGIME_VERSION[EMISSION_REGIME];

/** Resolve an interpreter by regime, refusing anything unknown. */
export function interpreterFor(regime: EmissionRegime): string {
  const p = INTERPRETERS[regime];
  if (!p) throw new Error(`no pinned interpreter for regime ${regime}`);
  return p;
}

export const ORACLE_SCRIPT = path.join(__dirname, '..', 'oracle', 'emit_oracle.py');

/**
 * The 11 symtable.Symbol predicates, in symtable's own declaration order.
 * py_binding columns 4..14 mirror this exactly. Order matters: the harness
 * compares positionally as well as by name.
 */
export const SYMBOL_PREDICATES = [
  'is_parameter',
  'is_local',
  'is_global',
  'is_nonlocal',
  'is_free',
  'is_imported',
  'is_assigned',
  'is_referenced',
  'is_declared_global',
  'is_annotated',
  'is_namespace',
] as const;

/** Synthetic comprehension iterator. Asserted positively, never whitelisted. */
export const SYNTHETIC_ITERATOR = '.0';

export const COMPREHENSION_SCOPE_KINDS = new Set([
  'COMPREHENSION_LIST',
  'COMPREHENSION_SET',
  'COMPREHENSION_DICT',
  'GENERATOR_EXPRESSION',
]);

/** PK shape: PREFIX_<md5hex>. */
export const PK_PATTERN = /^PY_[A-Z_]+_[0-9a-f]{32}$/;

/**
 * The frozen spine. Relation -> column count (schema v6, 10 relations / 262 cols).
 * Used by invariant #6 (column-count invariance) and #11 (schema agreement).
 */
export const SPINE_ARITY: Readonly<Record<string, number>> = {
  py_module: 24,
  py_scope: 25,
  py_binding: 29,
  py_type: 25,
  py_type_base: 16,
  py_method: 36,
  py_method_parameter: 22,
  py_import: 24,
  py_expression: 35,
  py_call_site: 26,
};

/** Every relation's last column is its PK; svLinkHash is immediately before. */
export const PK_INDEX = (relation: string): number => (SPINE_ARITY[relation] ?? NaN) - 1;
export const SVC_INDEX = (relation: string): number => (SPINE_ARITY[relation] ?? NaN) - 2;
