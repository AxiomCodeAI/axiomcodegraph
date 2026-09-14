/**
 * A reader for Gradle version catalog TOML.
 *
 * ## Why this is hand written rather than a TOML library
 *
 * A catalog is not arbitrary TOML. Gradle validates it against a fixed shape:
 * four known tables, aliases matching a documented pattern, and values that
 * are either a string, a string array, or an inline table with a known key
 * set. Anything else is a build failure, not a document this parser has to
 * understand. Pulling in a general TOML parser would buy support for
 * multi-line arrays of tables, datetimes and nested dotted sections that a
 * catalog cannot contain, and would still leave the whole classification job —
 * which notation is this, is the version a ref or a literal, is it rich —
 * to be written by hand afterwards.
 *
 * What a general parser WOULD buy is a second opinion, and the test suite gets
 * that instead: the catalog gate parses the same fixtures with an independent
 * TOML implementation and compares. That keeps the oracle outside this file,
 * where a shared premise cannot make both sides agree on the same mistake.
 *
 * ## What it deliberately does not do
 *
 * It does not evaluate. `version.ref = "spring"` is recorded as a ref, and
 * resolving it against `[versions]` is a separate pass, so an entry whose ref
 * points at nothing keeps an empty version rather than the ref's own name.
 *
 * ## Supported shapes
 *
 * ```toml
 * [versions]
 * spring = "6.1.3"
 * groovy = { strictly = "[3.0, 4.0[", prefer = "3.0.5" }
 *
 * [libraries]
 * a = "com.example:lib:1.0"
 * b = { module = "com.example:lib", version = "1.0" }
 * c = { module = "com.example:lib", version.ref = "spring" }
 * d = { group = "com.example", name = "lib", version.ref = "spring" }
 * e = { module = "com.example:lib" }
 *
 * [bundles]
 * both = ["a", "b"]
 *
 * [plugins]
 * boot = { id = "org.springframework.boot", version = "3.2.2" }
 * kts  = "org.jetbrains.kotlin.jvm:1.9.22"
 * ```
 */

/** One raw entry, before any classification or resolution. */
export interface RawCatalogEntry {
  table: CatalogTable;
  alias: string;
  /** Present when the entry is `alias = "..."`. */
  stringValue?: string;
  /** Present when the entry is `alias = ["a", "b"]`. */
  arrayValue?: string[];
  /** Present when the entry is `alias = { ... }`; dotted keys kept flat. */
  inlineTable?: Record<string, string>;
  startLine: number;
  endLine: number;
}

export type CatalogTable = 'versions' | 'libraries' | 'bundles' | 'plugins';

export interface CatalogParseResult {
  entries: RawCatalogEntry[];
  /** Lines that sit inside a known table but matched no entry shape. */
  unparsedLines: { line: number; text: string }[];
}

const KNOWN_TABLES: ReadonlySet<string> = new Set([
  'versions', 'libraries', 'bundles', 'plugins',
]);

export class VersionCatalogParser {
  /**
   * Parses catalog TOML into raw entries.
   *
   * Never throws. A malformed line becomes an entry in `unparsedLines`, which
   * the extractor turns into a parse-gap row — the same contract the rest of
   * the Gradle front end keeps, where a region that could not be read is
   * visible rather than silently absent.
   */
  static parse(source: string): CatalogParseResult {
    const entries: RawCatalogEntry[] = [];
    const unparsedLines: { line: number; text: string }[] = [];
    const lines = source.split('\n');

    let table: CatalogTable | null = null;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] ?? '';
      const line = this.stripComment(raw).trim();
      if (!line) continue;

      // [libraries] — a table header. Unknown tables switch `table` to null so
      // their contents are skipped rather than misfiled into the last known one.
      const header = /^\[\s*([A-Za-z0-9_.-]+)\s*\]$/.exec(line);
      if (header) {
        const name = (header[1] ?? '').toLowerCase();
        table = KNOWN_TABLES.has(name) ? (name as CatalogTable) : null;
        continue;
      }

      if (!table) continue;

      const eq = this.splitOnFirstEquals(line);
      if (!eq) {
        unparsedLines.push({ line: i + 1, text: raw.trim() });
        continue;
      }

      // A bare alias (`spring-core = ...`) is the normal form; a quoted one
    // (`"spring-core" = ...`) is legal TOML and appears when an alias would
    // otherwise need escaping.
    const rawKey = eq.key.trim();
    const alias = this.unquote(rawKey) ?? rawKey;
      let valueText = eq.value.trim();
      const startLine = i + 1;
      let endLine = i + 1;

      // An inline table or array may wrap. Gradle's own catalogs do this
      // constantly once entries carry both a module and a version ref.
      if (this.isUnbalanced(valueText)) {
        let j = i;
        while (j + 1 < lines.length && this.isUnbalanced(valueText)) {
          j++;
          valueText += ' ' + this.stripComment(lines[j] ?? '').trim();
        }
        endLine = j + 1;
        i = j;
      }

      const entry = this.buildEntry(table, alias, valueText, startLine, endLine);
      if (entry) {
        entries.push(entry);
      } else {
        unparsedLines.push({ line: startLine, text: raw.trim() });
      }
    }

    return { entries, unparsedLines };
  }

  private static buildEntry(
    table: CatalogTable,
    alias: string,
    valueText: string,
    startLine: number,
    endLine: number
  ): RawCatalogEntry | null {
    if (!alias) return null;

    if (valueText.startsWith('{')) {
      const inlineTable = this.parseInlineTable(valueText);
      if (!inlineTable) return null;
      return { table, alias, inlineTable, startLine, endLine };
    }

    if (valueText.startsWith('[')) {
      const arrayValue = this.parseStringArray(valueText);
      if (!arrayValue) return null;
      return { table, alias, arrayValue, startLine, endLine };
    }

    const stringValue = this.unquote(valueText);
    if (stringValue === null) return null;
    return { table, alias, stringValue, startLine, endLine };
  }

  /**
   * `{ module = "a:b", version.ref = "c" }` becomes
   * `{ module: 'a:b', 'version.ref': 'c' }`.
   *
   * Dotted keys are kept flat rather than nested. `version.ref` and
   * `version.require` are the only nesting a catalog uses, and flattening
   * keeps the classification step a lookup instead of a tree walk. Nested
   * rich versions — `version = { strictly = "..." }` — are flattened the same
   * way, to `version.strictly`.
   */
  private static parseInlineTable(text: string): Record<string, string> | null {
    const body = this.stripOuter(text, '{', '}');
    if (body === null) return null;

    const out: Record<string, string> = {};
    for (const part of this.splitTopLevel(body, ',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = this.splitOnFirstEquals(trimmed);
      if (!eq) return null;

      const key = this.unquote(eq.key.trim()) ?? eq.key.trim();
      const rawValue = eq.value.trim();

      if (rawValue.startsWith('{')) {
        // version = { strictly = "…", prefer = "…" } → version.strictly, version.prefer
        const nested = this.parseInlineTable(rawValue);
        if (!nested) return null;
        for (const [nk, nv] of Object.entries(nested)) out[`${key}.${nk}`] = nv;
        continue;
      }

      if (rawValue.startsWith('[')) {
        const arr = this.parseStringArray(rawValue);
        if (!arr) return null;
        out[key] = arr.join(',');
        continue;
      }

      const value = this.unquote(rawValue);
      if (value === null) return null;
      out[key] = value;
    }
    return out;
  }

  private static parseStringArray(text: string): string[] | null {
    const body = this.stripOuter(text, '[', ']');
    if (body === null) return null;
    const out: string[] = [];
    for (const part of this.splitTopLevel(body, ',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const value = this.unquote(trimmed);
      if (value === null) return null;
      out.push(value);
    }
    return out;
  }

  /**
   * Splits on the first `=` that is not inside a string. Naive indexOf breaks
   * on `a = "x=y"`, which is legal and appears in real catalogs whenever a
   * version carries a range.
   */
  private static splitOnFirstEquals(line: string): { key: string; value: string } | null {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === '=' && !inSingle && !inDouble) {
        return { key: line.slice(0, i), value: line.slice(i + 1) };
      }
    }
    return null;
  }

  /** Splits on a separator at nesting depth zero and outside strings. */
  private static splitTopLevel(text: string, sep: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let start = 0;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (!inSingle && !inDouble) {
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') depth--;
        else if (ch === sep && depth === 0) {
          out.push(text.slice(start, i));
          start = i + 1;
        }
      }
    }
    out.push(text.slice(start));
    return out;
  }

  private static stripOuter(text: string, open: string, close: string): string | null {
    const t = text.trim();
    if (!t.startsWith(open) || !t.endsWith(close)) return null;
    return t.slice(1, -1);
  }

  /**
   * Removes a `#` comment that is not inside a string. A bare indexOf('#')
   * would truncate `version = "1.0#build"`, which is unusual but legal.
   */
  private static stripComment(line: string): string {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === '#' && !inSingle && !inDouble) return line.slice(0, i);
    }
    return line;
  }

  /** Returns null when the text is not a quoted string, so callers can reject it. */
  private static unquote(text: string): string | null {
    const t = text.trim();
    if (t.length >= 2) {
      if (t.startsWith('"""') && t.endsWith('"""') && t.length >= 6) return t.slice(3, -3);
      if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
      }
    }
    // Bare tokens are not valid catalog values; every one is a quoted string.
    return null;
  }

  private static isUnbalanced(text: string): boolean {
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (!inSingle && !inDouble) {
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') depth--;
      }
    }
    return depth > 0;
  }
}
