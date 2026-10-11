import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Shared row plumbing for the HTML and CSS relations.
 *
 * The same discipline as `js-row.ts` and `ts-row.ts`, restated for this front end
 * rather than imported from one of them: the front ends are separate by ruling, so a
 * change to one language's row rules must not silently reshape another's output.
 *
 * ## Why arity is asserted at runtime
 *
 * The Soufflé declarations carry positional `c0..cN` and nothing else, so a column
 * dropped or transposed in a `values()` produces a file that loads cleanly and means
 * something different: every later column is shifted by one and the relation still has
 * rows. There is no type error, no parse error and no failing join. The assertion here
 * is the emit-side half of the schema check; `web-tests.ts` holds the other half, which
 * compares every header against `schema/web/schema.json`.
 */
export abstract class WebRow implements EntityIdentifiable {
  /** The relation's name, as the Soufflé declaration spells it. */
  abstract readonly relation: string;
  /** The header, in column order. Every row class exposes it as a static `COLUMNS` too. */
  abstract readonly columns: readonly string[];

  protected hash = ABSENT;

  /** The row's values, in column order. The last one is the row's own key. */
  protected abstract values(): string[];

  abstract generateHash(): void;

  getHash(): string {
    return this.hash;
  }

  getEntryCombined(): string {
    return `${this.relation}[hash=${this.hash}]`;
  }

  toCsv(): string {
    return joinRow(this.values(), this.columns.length, this.relation);
  }

  getCsvHeader(): string {
    return joinRow(this.columns, this.columns.length, this.relation);
  }

  /** A content-addressed key under the given prefix. */
  protected static key(prefix: keyof typeof ENTITY_IDENTIFIERS, ...components: (string | number | boolean)[]): string {
    return EntityUtils.generateEntityHash(ENTITY_IDENTIFIERS[prefix], keyOf(...components));
  }
}

export function joinRow(columns: readonly string[], expectedArity: number, relation: string): string {
  if (columns.length !== expectedArity) {
    throw new Error(
      `${relation}: emitted ${columns.length} columns, the header declares ${expectedArity}. `
        + 'Column ORDER is the contract and a shifted column loads without error — fix values(), never the header.'
    );
  }
  return columns.join('\t');
}

/** Soufflé has no nulls: `""` is the legal "absent" value everywhere in this schema. */
export const ABSENT = '';

/** A boolean column, written as the literal `true`/`false` the rules compare against. */
export function bool(value: boolean): string {
  return value ? 'true' : 'false';
}

/** A numeric column. */
export function num(value: number): string {
  return String(value);
}

/** Free text bound for TSV: newlines and tabs escaped, quotes doubled. */
export function text(value: string): string {
  return EntityUtils.escapeTsv(value);
}

/**
 * Free text with a length bound, applied BEFORE escaping: truncating after escaping can
 * cut an escape sequence in half, which produces a cell that is malformed rather than short.
 */
export function boundedText(value: string, limit: number): string {
  return EntityUtils.escapeTsv(value.length > limit ? value.slice(0, limit) : value);
}

/** A comma-LIST column, order preserved: `a,b,a` keeps both the repetition and the order. */
export function commaList(values: Iterable<string>): string {
  return Array.from(values).map((v) => v.replace(/,/g, '\\,')).join(',');
}

/** A comma-SET column, sorted, so the value is independent of source order. */
export function commaSet(values: Iterable<string>): string {
  return Array.from(new Set(values)).sort().join(',');
}

/**
 * The `||` join used by every primary key in this schema. Components go through
 * `String` untouched: they are hashes, names, numbers and enum values, and escaping
 * them would make two different keys collide in the escaping rather than in the content.
 */
export function keyOf(...components: (string | number | boolean)[]): string {
  return components.map(String).join('||');
}
