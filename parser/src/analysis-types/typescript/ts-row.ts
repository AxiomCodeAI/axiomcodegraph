import { EntityUtils } from '@/utils/entity-utils';

/**
 * Shared row plumbing for the TypeScript fact relations.
 *
 * ## Why arity is asserted at runtime and not merely reviewed
 *
 * `decls_base_ts.dl` carries positional `c0..cN` and nothing else, so a column
 * dropped or transposed in a `toCsv()` produces a file that loads cleanly into
 * Souffle and means something different. There is no type error, no parse
 * error, and no failing join — every later column is shifted by one and the
 * relation still has rows. That is the exact failure mode `gen_decls.py --check`
 * exists to prevent on the schema side; this is its counterpart on the emit
 * side.
 *
 * So every relation states its arity as a constant taken from the schema, and
 * every row is built through {@link joinRow}, which refuses to emit a row of the
 * wrong width. The check costs one comparison per row and turns a silent
 * corruption into a loud stop.
 */
export function joinRow(columns: readonly string[], expectedArity: number, relation: string): string {
  if (columns.length !== expectedArity) {
    throw new Error(
      `${relation}: emitted ${columns.length} columns, schema declares ${expectedArity}. ` +
        'Column ORDER is the contract and a shifted column loads without error — ' +
        'fix the toCsv(), never the arity constant.'
    );
  }
  return columns.join('\t');
}

/** Header row, held to the same arity as the data rows for the same reason. */
export function joinHeader(names: readonly string[], expectedArity: number, relation: string): string {
  return joinRow(names, expectedArity, relation);
}

/** Souffle has no nulls: `""` is the legal "absent" value everywhere in this schema. */
export const ABSENT = '';

/** A boolean column. Written as the literal `true`/`false` the `.dl` compares against. */
export function bool(value: boolean): string {
  return value ? 'true' : 'false';
}

/** A numeric column. */
export function num(value: number): string {
  return String(value);
}

/**
 * An optional numeric column: `""` when there is no number, NOT `-1` and NOT `0`.
 *
 * `restParameterIndex` and `spreadArgumentIndex` are both legitimately `0`, so a
 * sentinel would be indistinguishable from the first position.
 */
export function optionalNum(value: number | undefined): string {
  return value === undefined ? ABSENT : String(value);
}

/** Free text bound for TSV: newlines and tabs escaped, quotes doubled. */
export function text(value: string): string {
  return EntityUtils.escapeTsv(value);
}

/** A comma-set column, sorted so the value is independent of source order. */
export function commaSet(values: Iterable<string>): string {
  return Array.from(new Set(values)).sort().join(',');
}

/**
 * The `||` join used by every primary key in this schema.
 *
 * Components go through {@link String} untouched: they are hashes, names,
 * numbers and enum values, and escaping them would make two different keys
 * collide in the escaping rather than in the content.
 */
export function keyOf(...components: (string | number)[]): string {
  return components.map(String).join('||');
}
