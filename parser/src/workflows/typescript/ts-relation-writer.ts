import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';

import { TS_CSV_CHUNK_SIZE } from '../../constants/typescript-constants';

/** The minimum a row must do to be written. Matches `CsvRow` without importing it. */
interface WritableRow {
  getCsvHeader(): string;
  toCsv(): string;
}

/**
 * One relation, written as extraction proceeds instead of at the end.
 *
 * The extractor used to hold every row of every relation until the last file
 * was parsed, then serialise. That is a ceiling rather than a cost: a large
 * single-tree project exhausted a 12 GB heap after ~17 minutes with
 * mark-compact pauses reaching 49 s, so it was thrashing long before it died.
 * Rows are the weight -- expressions alone are over half the output -- and a
 * row is finished the moment its file is.
 *
 * The atomicity guarantees are the ones the whole-file writer already made,
 * and none of them are weakened by streaming:
 *
 *   UNIQUE TEMP NAME  a fixed `<file>.partial` is shared by every writer aimed
 *                     at one output directory, so two of them interleave and
 *                     the published file begins mid-value.
 *   FSYNC BEFORE      a crash must not leave the destination naming a file
 *   RENAME            whose bytes never reached the disk.
 *   READ-BACK         a torn row loads cleanly and counts wrong, so the check
 *                     that it did not happen belongs here and not in a gate
 *                     over the parser's own fixtures.
 *
 * The read-back is now STREAMED. Reading a finished relation into one string
 * reintroduced the ceiling at the point of checking it: a large relation
 * exceeds V8's maximum string length, and that failure is a throw on a file
 * which is in fact well formed.
 */
export class TsRelationWriter {
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
    if (this.buffer.length >= TS_CSV_CHUNK_SIZE) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.handle === undefined || this.buffer.length === 0) {
      return;
    }
    // One write per flush rather than one per row: the join is what makes
    // streaming cost the same as the whole-file writer did.
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
      // from "the parser never ran".
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
 * well formed and the reader called torn -- the worst available disagreement,
 * because the parser certified an artefact it could not read the same way as
 * its consumer.
 */
const CONSUMER_LINE_BREAKS = /[\u000A\u000B\u000C\u000D\u001C\u001D\u001E\u0085\u2028\u2029]/;

/**
 * Every row has exactly the header's field count, checked without holding the
 * file in memory.
 */
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
            throw new Error(`${name}: line ${line + 1} has ${got} field(s) where the header has `
              + `${width} — the row is torn: ${JSON.stringify(candidate.slice(0, 60))}`);
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
