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

/** One RFC 4180 (tab-delimited) file as an async stream of rows. A zero-byte file yields nothing. */
export async function* readRfc4180(path: string): AsyncGenerator<string[]> {
  const stream = fs.createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 });
  let field = '';
  let row: string[] = [];
  let quoted = false; // inside a quoted field
  let afterQuote = false; // just saw a quote inside a quoted field — next char decides
  let atFieldStart = true;
  for await (const chunk of stream as AsyncIterable<string>) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]!;
      if (quoted) {
        if (afterQuote) {
          afterQuote = false;
          if (ch === '"') { field += '"'; continue; } // doubled quote → literal quote
          quoted = false; // the closing quote — fall through to unquoted handling
        } else {
          if (ch === '"') afterQuote = true; else field += ch;
          continue;
        }
      }
      if (ch === '"' && atFieldStart) { quoted = true; atFieldStart = false; continue; }
      atFieldStart = false;
      if (ch === TAB) { row.push(field); field = ''; atFieldStart = true; continue; }
      if (ch === '\n') {
        row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
        field = ''; atFieldStart = true;
        yield row; row = [];
        continue;
      }
      field += ch;
    }
  }
  // final row without a trailing newline
  if (field.length > 0 || row.length > 0) {
    row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
    yield row;
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
