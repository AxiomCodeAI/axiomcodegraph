/**
 * Tab-delimited CSV, read and written the way the parser and the engine produce it.
 *
 * Two dialects meet here, and they differ in exactly one respect:
 *   - the parser IR is RFC 4180 over a tab delimiter — a field holding a quote, a tab or a
 *     newline is wrapped in double quotes with inner quotes doubled, so a row can span lines;
 *   - a Soufflé relation is raw — one row per line, fields split on tab, never quoted.
 * `readRfc4180` handles the first; the second is a plain split and needs no helper.
 *
 * Reading is STREAMED, chunk by chunk, so a multi-GB expression table never has to be held
 * in memory: the caller sees one row at a time and keeps only what it needs.
 */
import * as fs from 'fs';

const TAB = '\t';

/** One RFC 4180 (tab-delimited) file as an async stream of rows. A zero-byte file yields nothing.
 *
 *  A LINE WITH NO QUOTE IN IT IS A WHOLE ROW, and nearly every line is one, so it is split on tabs as it
 *  stands: a quote is the only thing that can make a field hold a tab or a newline. Only a line that holds
 *  a quote, and the lines a quoted field carries it across, goes through the character-by-character reader
 *  (`Rfc4180Row`), which is the definition. Reading every character that way cost most of the bundle's time
 *  on a GB-scale expression table. */
export async function* readRfc4180(path: string, pick?: Pick): AsyncGenerator<string[]> {
  const stream = fs.createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 });
  const slow = new Rfc4180Row();
  let rest = '';
  let first = true; // the first row, a header in a headered file, is never filtered
  for await (const chunk of stream as AsyncIterable<string>) {
    const text = rest.length > 0 ? rest + chunk : chunk;
    let at = 0;
    let quote = text.indexOf('"'); // the next quote at or after `at`, -1 when the chunk holds no more
    for (;;) {
      const nl = text.indexOf('\n', at);
      if (nl < 0) break;
      if (quote >= 0 && quote < at) quote = text.indexOf('"', at);
      if (slow.open || (quote >= 0 && quote < nl)) {
        // the line holds a quote, or a quoted field opened on an earlier line runs on into it
        const row = slow.feed(text, at, nl + 1);
        if (row) yield row;
      } else if (first || !pick || pick.has(fieldAt(text, at, nl, pick.column))) {
        yield splitLine(text, at, nl);
      }
      first = false;
      at = nl + 1;
    }
    rest = text.slice(at);
  }
  // final row without a trailing newline
  if (slow.open || rest.indexOf('"') >= 0) {
    slow.feed(rest, 0, rest.length);
    const row = slow.end();
    if (row) yield row;
  } else if (rest.length > 0 && (first || !pick || pick.has(fieldAt(rest, 0, rest.length, pick.column)))) {
    yield splitLine(rest, 0, rest.length);
  }
}

/** Rows the caller will drop, skipped before they are split: a row is read only when `has` holds for its
 *  `column`th field ('' when the row is shorter, as `row[column] ?? ''` reads it). A row a quote touches is
 *  always returned, so the caller must still test every row it gets; this only saves the split of the rest. */
export interface Pick { column: number; has: (value: string) => boolean }

/** The `col`th tab-separated field of text[a, b), a line holding no quote; a trailing \r on the last field dropped. */
function fieldAt(text: string, a: number, b: number, col: number): string {
  let start = a;
  for (let i = 0; i < col; i++) {
    const t = text.indexOf(TAB, start);
    if (t < 0 || t >= b) return '';
    start = t + 1;
  }
  const t = text.indexOf(TAB, start);
  if (t >= 0 && t < b) return text.slice(start, t);
  const v = text.slice(start, b);
  return v.endsWith('\r') ? v.slice(0, -1) : v;
}

/** text[a, b) — one line holding no quote, without its newline — as a row: split on tabs, a trailing \r dropped. */
function splitLine(text: string, a: number, b: number): string[] {
  const line = text.slice(a, b);
  const row = line.split(TAB);
  const last = row[row.length - 1]!;
  if (last.endsWith('\r')) row[row.length - 1] = last.slice(0, -1);
  return row;
}

/** The RFC 4180 reader, a character at a time: fed whole lines, it returns a row when one ends on a newline outside quotes. */
class Rfc4180Row {
  private field = '';
  private row: string[] = [];
  private quoted = false; // inside a quoted field
  private afterQuote = false; // just saw a quote inside a quoted field — next char decides
  private atFieldStart = true;
  /** a row has begun and not ended: a quoted field crossed a newline */
  get open(): boolean { return this.quoted || this.afterQuote || this.row.length > 0 || this.field.length > 0 || !this.atFieldStart; }
  feed(chunk: string, from: number, to: number): string[] | null {
    let out: string[] | null = null;
    for (let i = from; i < to; i++) {
      const ch = chunk[i]!;
      if (this.quoted) {
        if (this.afterQuote) {
          this.afterQuote = false;
          if (ch === '"') { this.field += '"'; continue; } // doubled quote → literal quote
          this.quoted = false; // the closing quote — fall through to unquoted handling
        } else {
          if (ch === '"') this.afterQuote = true; else this.field += ch;
          continue;
        }
      }
      if (ch === '"' && this.atFieldStart) { this.quoted = true; this.atFieldStart = false; continue; }
      this.atFieldStart = false;
      if (ch === TAB) { this.row.push(this.field); this.field = ''; this.atFieldStart = true; continue; }
      if (ch === '\n') {
        this.row.push(this.field.endsWith('\r') ? this.field.slice(0, -1) : this.field);
        this.field = ''; this.atFieldStart = true;
        out = this.row; this.row = [];
        continue;
      }
      this.field += ch;
    }
    return out;
  }
  /** end of input: the row in progress, if any */
  end(): string[] | null {
    if (this.field.length > 0 || this.row.length > 0) {
      this.row.push(this.field.endsWith('\r') ? this.field.slice(0, -1) : this.field);
      const r = this.row; this.row = []; this.field = '';
      return r;
    }
    return null;
  }
}

/** A Soufflé relation dump: raw tab-split lines, no header, no quoting. */
export async function* readRaw(path: string): AsyncGenerator<string[]> {
  if (!fs.existsSync(path)) return;
  const stream = fs.createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 });
  let rest = '';
  for await (const chunk of stream as AsyncIterable<string>) {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) if (line.length > 0) yield line.split(TAB);
  }
  if (rest.length > 0) yield rest.split(TAB);
}

/**
 * A headered table: the first row names the columns. `col(name)` gives the index and throws
 * on a name the file does not have — a column the adapter counts on that has moved is a
 * schema drift, and refusing is the only answer that does not silently misjoin.
 */
export class Header {
  private readonly index = new Map<string, number>();
  constructor(readonly names: readonly string[], readonly source: string) {
    names.forEach((n, i) => this.index.set(n, i));
  }
  col(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) {
      throw new Error(`column "${name}" is not in ${this.source} — header is: ${this.names.join(', ')}`);
    }
    return i;
  }
  has(name: string): boolean { return this.index.has(name); }
}

/** Read only the first row of a headered file; null when the file is absent or zero-byte. */
export async function readHeader(path: string): Promise<Header | null> {
  if (!fs.existsSync(path) || fs.statSync(path).size === 0) return null;
  for await (const row of readRfc4180(path)) return new Header(row, path);
  return null;
}

/** Quote a field RFC 4180-style only when it needs it (tab, newline, quote). */
export function quoteField(v: string | number | null): string {
  if (v === null) return '';
  const s = String(v);
  return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Write a headered tab-delimited table. */
export function writeTable(path: string, header: readonly string[], rows: Iterable<readonly (string | number | null)[]>): number {
  const fd = fs.openSync(path, 'w');
  let n = 0;
  try {
    fs.writeSync(fd, header.join(TAB) + '\n');
    let buf: string[] = [];
    for (const r of rows) {
      buf.push(r.map(quoteField).join(TAB));
      n++;
      if (buf.length >= 4096) { fs.writeSync(fd, buf.join('\n') + '\n'); buf = []; }
    }
    if (buf.length > 0) fs.writeSync(fd, buf.join('\n') + '\n');
  } finally {
    fs.closeSync(fd);
  }
  return n;
}
