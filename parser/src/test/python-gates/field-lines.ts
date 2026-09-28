/**
 * A field row carries the line its write is ON, 1-based like every other Python relation.
 *
 * The field extractor copied tree-sitter's 0-based `row` straight into `startLine`,
 * `endLine` and `firstWriteLine`, while methods, types, comments and blocks all add 1. So
 * every field sat one line above its write: the first field of a nested `class Meta:` was
 * recorded AT the `class Meta:` line, and a query by `file:line` or a diff hunk on the
 * write landed on the field above it, or on nothing.
 *
 * The frozen golden could not see it: it had frozen the 0-based values. This gate names
 * the expected line of each write form, so a wrong value is red even when it is stable.
 *
 * Near-miss controls: the declaration lines of the classes and of `__init__` must not move
 * (they were already 1-based), and no field may sit on a `class` line.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const SOURCE = `class Form:
    name = "form"

    class Meta:
        csrf = True
        fields = (
            "a",
            "b",
        )

    def __init__(self):
        self.count = 0
        setattr(self, "dynamic", 1)


class Slotted:
    __slots__ = ("x",)
`;

/** field name -> [startLine, endLine] of its (first) write, 1-based. */
const FIELDS: ReadonlyArray<readonly [string, number, number, string]> = [
  ['name', 2, 2, 'a top-level class-body assignment'],
  ['csrf', 5, 5, 'the first field of a nested class: NOT the `class Meta:` line (4)'],
  ['fields', 6, 9, 'a multi-line class-body assignment spans its value'],
  ['count', 12, 12, 'self.x = ... in __init__'],
  ['dynamic', 13, 13, 'setattr(self, "name", v)'],
  ['x', 17, 17, 'a __slots__ entry'],
];

/** control: declarations that were already 1-based keep their line. */
const DECLS: ReadonlyArray<readonly [string, string, number]> = [
  ['all-python-types.csv', 'Form', 1],
  ['all-python-types.csv', 'Meta', 4],
  ['all-python-types.csv', 'Slotted', 16],
  ['all-python-methods.csv', '__init__', 11],
];

export async function fieldLines(): Promise<number> {
  const problems: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'py-fieldlines-'));
  const source = path.join(root, 'src');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'forms.py'), SOURCE);

  const outputDir = path.join(root, 'out');
  await new PythonProjectAnalyzer().analyze({
    rootDir: source,
    outputDir,
    baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });

  const tsv = (file: string): Record<string, string>[] => {
    const lines = fs.readFileSync(path.join(outputDir, file), 'utf-8').split('\n').filter(Boolean);
    const header = lines[0]!.split('\t');
    return lines.slice(1).map((l) => {
      const cells = l.split('\t');
      return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
    });
  };

  const fields = tsv('all-python-fields.csv');
  for (const [name, start, end, why] of FIELDS) {
    const row = fields.find((f) => f.name === name);
    if (!row) {
      problems.push(`${name} (${why}): no field row`);
      continue;
    }
    const got = [Number(row.startLine), Number(row.endLine), Number(row.firstWriteLine)];
    if (got[0] !== start || got[1] !== end || got[2] !== start) {
      problems.push(`${name} (${why}): expected start=${start} end=${end} firstWrite=${start}, ` +
        `got start=${got[0]} end=${got[1]} firstWrite=${got[2]}`);
    }
  }

  const classLines = new Set<number>();
  for (const [file, name, line] of DECLS) {
    const row = tsv(file).find((r) => r.name === name);
    const got = row ? Number(row.startLine) : NaN;
    if (got !== line) problems.push(`control: ${name} in ${file} expected line ${line}, got ${got}`);
    if (file === 'all-python-types.csv') classLines.add(line);
  }
  for (const f of fields) {
    if (classLines.has(Number(f.startLine))) {
      problems.push(`control: field ${f.name} sits on a class line (${f.startLine})`);
    }
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`  ${FIELDS.length} write forms checked for 1-based lines; ` +
    `${DECLS.length} declaration lines and the no-field-on-a-class-line rule as controls`);
  for (const problem of problems) {
    console.log(`  FAIL  ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}
