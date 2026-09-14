import { EntityUtils } from '@/utils/entity-utils';

/**
 * Shared row plumbing for the JavaScript fact relations.
 *
 * A deliberate near-copy of `ts-row.ts`, and the duplication is the point: the
 * two front ends are separate (schema Q1), so a change to TypeScript's row
 * discipline must not silently reshape JavaScript's output. What they share is
 * the reasoning, restated here because it is what the file exists for.
 *
 * ## Why arity is asserted at runtime and not merely reviewed
 *
 * `decls_base_js.dl` carries positional `c0..cN` and nothing else, so a column
 * dropped or transposed in a `toCsv()` produces a file that loads cleanly into
 * Souffle and means something different. There is no type error, no parse
 * error, and no failing join — every later column is shifted by one and the
 * relation still has rows. That is the exact failure mode `gen_decls.py --check`
 * prevents on the schema side; this is its counterpart on the emit side.
 */
export function joinRow(
  columns: readonly string[],
  expectedArity: number,
  relation: string
): string {
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
export function joinHeader(
  names: readonly string[],
  expectedArity: number,
  relation: string
): string {
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
 * `position` and `childIndex` are both legitimately `0`, so a sentinel would be
 * indistinguishable from the first position.
 */
export function optionalNum(value: number | undefined): string {
  return value === undefined ? ABSENT : String(value);
}

/** Free text bound for TSV: newlines and tabs escaped, quotes doubled. */
export function text(value: string): string {
  return EntityUtils.escapeTsv(value);
}

/**
 * Free text with a length bound, applied BEFORE escaping.
 *
 * Truncating after escaping can cut an escape sequence in half, which produces
 * a cell that is not merely short but malformed.
 */
export function boundedText(value: string, limit: number): string {
  return EntityUtils.escapeTsv(value.length > limit ? value.slice(0, limit) : value);
}

/** A comma-set column, sorted so the value is independent of source order. */
export function commaSet(values: Iterable<string>): string {
  return Array.from(new Set(values)).sort().join(',');
}

/**
 * A comma-LIST column, order preserved.
 *
 * `js_comment.jsdocTagNames` is `param,param,returns` — the repetition and the
 * order are both information, so this is not {@link commaSet}.
 */
export function commaList(values: Iterable<string>): string {
  return Array.from(values).join(',');
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
