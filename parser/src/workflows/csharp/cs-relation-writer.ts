import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

/** Rows are written after this many are buffered. */
const CS_CSV_CHUNK_SIZE = 4096;

/** The minimum a row must do to be written. */
interface WritableRow {
  getCsvHeader(): string;
  toCsv(): string;
}

/**
 * One relation, written as extraction proceeds instead of at the end.
 *
 * Ported from `ts-relation-writer.ts`, whose reasoning applies unchanged: rows
 * are the weight, a row is finished the moment its file is, and holding the
 * whole fact base until the last file exhausted a 12 GB heap on a large tree.
 * §10 measured the same thing from the other side — 2.7 MB of source became
 * 507 MB of resident memory, a 190x amplification, and garbage collection was
 * the single largest line item in the profile at 10.4%.
 *
 * *(The duplication with the TypeScript writer is deliberate for now.
 * `src/utils/` is shared by five front ends and hoisting this is a coordinated
 * change, not one to make on a language branch. Recorded rather than done.)*
 *
 * The atomicity guarantees are the ones a whole-file writer already made:
 *
 *   UNIQUE TEMP NAME  a fixed `<file>.partial` is shared by every writer aimed
 *                     at one output directory, so two interleave and the
 *                     published file begins mid-value.
 *   FSYNC BEFORE      a crash must not leave the destination naming a file
 *   RENAME            whose bytes never reached the disk.
 *   READ-BACK         a torn row loads cleanly and counts wrong, so the check
 *                     that it did not happen belongs here.
 */
export class CsRelationWriter {
  private handle: fsp.FileHandle | undefined;
  private readonly temporaryPath: string;
  private readonly outputPath: string;
  private buffer: string[] = [];
  private header = '';
  private rows = 0;
  private closed = false;

  constructor(outputDir: string, filename: string, uniqueSuffix: string) {
    this.outputPath = path.join(outputDir, filename);
    this.temporaryPath = `${this.outputPath}.${uniqueSuffix}.partial`;
  }

  get rowCount(): number {
    return this.rows;
  }

  get relationPath(): string {
    return this.outputPath;
  }

  /**
   * Appends one file's rows.
   *
   * The header comes from the first row ever written, because a relation that
   * never receives one has no header to ask for and must still produce a file.
   */
  async append(rows: readonly WritableRow[]): Promise<void> {
    if (this.closed) {
      throw new Error(`${path.basename(this.outputPath)}: appended after the file was published`);
    }
    if (rows.length === 0) {
      return;
    }
    if (this.handle === undefined) {
      this.handle = await fsp.open(this.temporaryPath, 'w');
      this.header = rows[0]!.getCsvHeader();
      this.buffer.push(this.header + '\n');
    }
    for (const row of rows) {
      this.buffer.push(row.toCsv() + '\n');
      this.rows += 1;
    }
    if (this.buffer.length >= CS_CSV_CHUNK_SIZE) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.handle === undefined || this.buffer.length === 0) {
      return;
    }
    const text = this.buffer.join('');
    this.buffer = [];
    await this.handle.write(text, null, 'utf-8');
  }

  /** Flushes, verifies, and renames into place. */
  async publish(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.handle === undefined) {
      // An empty relation still gets its file, so a consumer can tell "no rows"
      // from "the parser never ran" — and so the FK gate, which derives its
      // relation list from the OUTPUT DIRECTORY, does not read an absent
      // relation as a set of dangling keys. Adding a relation once made every
      // FK to it read as dangling for exactly this reason.
      await fsp.writeFile(this.outputPath, '');
      return;
    }
    await this.flush();
    await this.handle.sync();
    await this.handle.close();
    this.handle = undefined;
    verifyRelationFileStreaming(this.temporaryPath, this.outputPath, this.header);
    await fsp.rename(this.temporaryPath, this.outputPath);
  }

  /** Removes the temporary file when a run fails, so no `.partial` is left behind. */
  async discard(): Promise<void> {
    this.closed = true;
    if (this.handle !== undefined) {
      try {
        await this.handle.close();
      } catch {
        // The handle is being abandoned; a close error cannot change that.
      }
      this.handle = undefined;
    }
    await fsp.rm(this.temporaryPath, { force: true });
  }
}

/**
 * Every code point a CONSUMER treats as a line break.
 *
 * Python's `str.splitlines()` breaks on all of these; `split('\n')` breaks on
 * one. A value carrying any of the others produced a file the old check called
 * well formed and the reader called torn — the worst available disagreement,
 * because the parser certifies an artefact it cannot read the same way as its
 * consumer does.
 *
 * C# reaches this more easily than the others: a verbatim string literal
 * (`@"..."`) and a raw string literal (`"""..."""`) both carry real line breaks
 * in source, and both end up in `defaultValueText` and `conditionText`.
 */
const CONSUMER_LINE_BREAKS =
  /[\u000A\u000B\u000C\u000D\u001C\u001D\u001E\u0085\u2028\u2029]/;

/** Every row has exactly the header's field count, checked without buffering. */
export function verifyRelationFileStreaming(
  temporaryPath: string,
  outputPath: string,
  header: string
): void {
  const width = header.split('\t').length;
  const name = path.basename(outputPath);
  const descriptor = fs.openSync(temporaryPath, 'r');
  try {
    const size = fs.fstatSync(descriptor).size;
    if (size === 0) {
      return;
    }
    const CHUNK = 1 << 20;
    const chunk = Buffer.allocUnsafe(CHUNK);
    let carry = '';
    let line = 0;
    let lastByte = 0;
    let position = 0;
    for (;;) {
      const read = fs.readSync(descriptor, chunk, 0, CHUNK, position);
      if (read <= 0) {
        break;
      }
      position += read;
      lastByte = chunk[read - 1]!;
      // A multi-byte character can straddle a chunk boundary. Decoding each
      // chunk on its own would corrupt it and report a torn row on a file that
      // is intact, so the undecoded tail is carried into the next decode.
      const text = carry + chunk.toString('utf-8', 0, read);
      const lines = text.split(CONSUMER_LINE_BREAKS);
      carry = lines.pop() ?? '';
      for (const candidate of lines) {
        if (line > 0 && candidate !== '') {
          const got = candidate.split('\t').length;
          if (got !== width) {
            throw new Error(
              `${name}: line ${line + 1} has ${got} field(s) where the header has ` +
                `${width} — the row is torn: ${JSON.stringify(candidate.slice(0, 60))}`
            );
          }
        }
        line += 1;
      }
    }
    if (carry !== '' || lastByte !== 0x0a) {
      throw new Error(`${name}: the write did not end in a newline, so the last row is truncated`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}
