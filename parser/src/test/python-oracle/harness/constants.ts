import * as path from 'path';

/**
 * Pinned interpreter. Appendix B invariant #10.
 *
 * ABSOLUTE PATH, never `python3` and never ambient PATH. This is not fussiness:
 * a conda-activated shell on this machine resolves `python3` to 3.12.4, which
 * inlines comprehensions (PEP 709) and therefore produces a structurally
 * DIFFERENT scope tree from the frozen PY3_0_11 regime. Resolving by name once
 * produced exactly that error during schema work.
 */
export const PINNED_INTERPRETER =
  '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3';

/** The frozen emission regime for freeze-1 (schema v6 §2.1 c11). */
export const EMISSION_REGIME = 'PY3_0_11';

/** Expected interpreter major/minor. Patch is recorded, not enforced. */
export const EXPECTED_VERSION: readonly [number, number] = [3, 10];

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
