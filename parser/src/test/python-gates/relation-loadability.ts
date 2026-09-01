/**
 * Every emitted relation must survive a STRICT RFC4180 reader.
 *
 * A relation either loads or it does not. Souffle rejects the whole fact file
 * on the first malformed cell, so ONE bad value anywhere in a project removes
 * every fact of that relation from the solve. The failure is total, and it is
 * silent in the worst way: field typing simply stops existing for the entire
 * codebase because one annotation somewhere was a forward reference.
 *
 * That is what makes this different from an accuracy bug. A wrong value costs
 * one fact. An unquoted value costs the relation.
 *
 * The trigger was `fieldBaseType`. It is derived by cutting the annotation at
 * the first `[`, and a PEP 484 forward reference carries its quotes in the
 * annotation TEXT, so `value: "Union[str, bytes]"` produced `"Union` -- a cell
 * beginning with a quote and not quoted as a whole, which is invalid CSV. The
 * reader treats the leading quote as opening a quoted field and fails at the
 * next separator.
 *
 * Two things are therefore asserted, because fixing either one alone leaves the
 * other live:
 *
 *   1. the value is SEMANTICALLY right -- `Union`, not `"Union`, since nothing
 *      downstream can match a type whose name contains a quote;
 *   2. the file is STRUCTURALLY loadable -- every cell that needs quoting has
 *      it, so a value that can begin with a quote cannot tear the relation.
 *
 * The reader below is deliberately strict and hand-written rather than lenient:
 * a forgiving parser would accept files Souffle rejects, which is precisely the
 * failure this exists to catch.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

/**
 * Source chosen so that a quote can reach as many columns as possible: forward
 * references in a field, a parameter and a return; a quote inside a string
 * literal; a subscript callee; a decorator; and an aliased import.
 */
const ADVERSARIAL = `from typing import Optional as Opt


def deco(fn):
    return fn


class Bar:
    pass


def takes(x: "Bar") -> "Opt[Bar]":
    return None


class Uses:
    attr: "Bar"
    generic: "Opt[Bar]"
    plain: Bar

    @deco
    def go(self, handlers) -> "Bar":
        handlers["key"]()
        note = "a literal with a \\" quote and a \\t tab"
        return takes(note)
`;

/** Strict RFC4180: a quote may only appear inside a quoted field, doubled. */
function parseStrict(text: string, delimiter = '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  let atCellStart = true;

  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        // After a closing quote only a separator or a line end may follow.
        const next = text[i];
        if (next !== undefined && next !== delimiter && next !== '\n' && next !== '\r') {
          throw new Error(
            `separator expected immediately after quoted field, got ${JSON.stringify(next)} ` +
            `at offset ${i} (row ${rows.length + 1})`
          );
        }
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (!atCellStart) {
        throw new Error(
          `bare quote inside an unquoted field at offset ${i} (row ${rows.length + 1})`
        );
      }
      quoted = true;
      atCellStart = false;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = '';
      atCellStart = true;
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      atCellStart = true;
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += ch;
    atCellStart = false;
    i += 1;
  }
  if (quoted) {
    throw new Error('file ends inside a quoted field');
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export async function relationLoadability(): Promise<number> {
  const problems: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'py-loadability-'));
  const source = path.join(root, 'src');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'adversarial.py'), ADVERSARIAL);

  const outputDir = path.join(root, 'out');
  await new PythonProjectAnalyzer().analyze({
    rootDir: source,
    outputDir,
    baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });

  let checked = 0;
  for (const file of fs.readdirSync(outputDir).sort()) {
    if (!file.endsWith('.csv')) {
      continue;
    }
    const text = fs.readFileSync(path.join(outputDir, file), 'utf-8');
    if (text.trim() === '') {
      continue;
    }
    let rows: string[][];
    try {
      rows = parseStrict(text);
    } catch (error) {
      problems.push(`${file}: does not load — ${(error as Error).message}`);
      continue;
    }
    checked += 1;
    const width = rows[0]!.length;
    for (let index = 1; index < rows.length; index += 1) {
      if (rows[index]!.length !== width) {
        problems.push(
          `${file}: row ${index + 1} has ${rows[index]!.length} cells, header has ${width}`
        );
        break;
      }
    }
  }

  // Structurally loadable is not enough: a quote must never have been part of
  // the NAME in the first place, or the relation loads and links to nothing.
  const fieldsFile = path.join(outputDir, 'all-python-fields.csv');
  // Guarded: when the loadability defect is live this file does not parse, and
  // an unguarded call here would throw out of the gate. A check that crashes
  // reports worse than one that fails, since the message names the exception
  // instead of the defect.
  let fieldRows: string[][] | null = null;
  if (fs.existsSync(fieldsFile)) {
    try {
      fieldRows = parseStrict(fs.readFileSync(fieldsFile, 'utf-8'));
    } catch {
      fieldRows = null;
    }
  }
  if (fieldRows !== null) {
    const rows = fieldRows;
    const header = rows[0]!;
    const nameAt = header.indexOf('name');
    const baseAt = header.indexOf('fieldBaseType');
    const seen = new Map<string, string>();
    for (const row of rows.slice(1)) {
      seen.set(row[nameAt]!, row[baseAt]!);
      if ((row[baseAt] ?? '').includes('"')) {
        problems.push(
          `py_field.fieldBaseType for "${row[nameAt]}" is ${JSON.stringify(row[baseAt])}; ` +
          'a forward reference must be unwrapped before the base type is taken'
        );
      }
    }
    // The quoted and unquoted spellings of one annotation must agree.
    for (const [field, expected] of [['attr', 'Bar'], ['plain', 'Bar'], ['generic', 'Opt']]) {
      const actual = seen.get(field!);
      if (actual !== undefined && actual !== expected) {
        problems.push(`py_field.fieldBaseType for "${field}" is "${actual}", expected "${expected}"`);
      }
    }
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`  ${checked} relations parsed under a strict RFC4180 reader`);
  for (const problem of problems) {
    console.log(`  FAIL  ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}
