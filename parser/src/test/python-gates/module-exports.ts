/**
 * `__all__`, and the asymmetry that makes `dunderAllIsStatic` load-bearing.
 *
 * A consumer restricting a wildcard re-export reads these three columns: it
 * trusts `dunderAllNames` when `dunderAllIsStatic` is true, and falls back to
 * the underscore rule when it is false. The two errors are therefore not
 * equally bad.
 *
 *   isStatic FALSE when it could be true   over-approximates. Extra names cross
 *                                          that should not. Noise.
 *   isStatic TRUE with an incomplete list  UNDER-approximates. A name the
 *                                          language really does export looks
 *                                          unexported, and a reference to it
 *                                          resolves to nothing.
 *
 * The second is the confident-wrong shape, so every case here that cannot be
 * read literally must report `false`, and the gate treats a wrong `true` as the
 * failure worth naming.
 *
 * Two shapes produced exactly that before this was written, and both are
 * common in real packages:
 *
 *   __all__ = ["base"]        the reader returned on the first top-level
 *   __all__ += ["extra"]      assignment and never saw the mutation, so it
 *                             reported static with `extra` missing
 *
 *   if sys.platform == ...:   the reader scanned only direct children of the
 *       __all__ = [...]       module, so this reported NO __all__ at all
 *
 * These columns had no consumer when this was written, which is why nothing had
 * ever checked them. They are about to have one.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

/** module -> [source, present, isStatic, names] */
const CASES: Record<string, [string, boolean, boolean, string]> = {
  static_list: ['__all__ = ["PublicThing", "other"]\nclass PublicThing: ...\n', true, true, 'PublicThing,other'],
  static_tuple: ['__all__ = ("A", "B")\n', true, true, 'A,B'],
  // Mutated after assignment: the literal list is INCOMPLETE, so it must not
  // be offered as one.
  augmented: ['__all__ = ["base"]\n__all__ += ["extra"]\n', true, false, ''],
  appended: ['__all__ = ["base"]\n__all__.append("extra")\n', true, false, ''],
  extended: ['__all__ = ["base"]\n__all__.extend(["extra"])\n', true, false, ''],
  // Assigned twice: the last one wins at runtime, and picking either statically
  // is a guess.
  reassigned: ['__all__ = ["first"]\n__all__ = ["second"]\n', true, false, ''],
  // Present, but not where a scan of the module body would find it.
  conditional: ['import sys\nif sys.platform == "win32":\n    __all__ = ["w"]\nelse:\n    __all__ = ["p"]\n', true, false, ''],
  // Built at runtime: present, never literal.
  computed: ['import os\n__all__ = [n for n in dir(os) if not n.startswith("_")]\n', true, false, ''],
  concatenated: ['from other import __all__ as base\n__all__ = base + ["extra"]\n', true, false, ''],
  // A list holding something that is not a string literal cannot be read.
  non_literal: ['NAME = "x"\n__all__ = ["a", NAME]\n', true, false, ''],
  absent: ['class Thing: ...\nclass _Private: ...\n', false, false, ''],
};

export async function moduleExports(): Promise<number> {
  const problems: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'py-exports-'));
  const source = path.join(root, 'src');
  fs.mkdirSync(source, { recursive: true });
  for (const [name, [body]] of Object.entries(CASES)) {
    fs.writeFileSync(path.join(source, `${name}.py`), body);
  }

  const outputDir = path.join(root, 'out');
  await new PythonProjectAnalyzer().analyze({
    rootDir: source,
    outputDir,
    baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });

  const lines = fs
    .readFileSync(path.join(outputDir, 'all-python-modules.csv'), 'utf-8')
    .split('\n')
    .filter(Boolean);
  const header = lines[0]!.split('\t');
  const at = (column: string): number => header.indexOf(column);
  const seen = new Map<string, [string, string, string]>();
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    seen.set(cells[at('name')]!, [
      cells[at('hasDunderAll')] ?? '',
      cells[at('dunderAllIsStatic')] ?? '',
      cells[at('dunderAllNames')] ?? '',
    ]);
  }

  for (const [name, [, present, isStatic, names]] of Object.entries(CASES)) {
    const row = seen.get(name);
    if (!row) {
      problems.push(`${name}: no module row emitted`);
      continue;
    }
    const [gotPresent, gotStatic, gotNames] = row;
    if (gotPresent !== String(present)) {
      problems.push(`${name}: hasDunderAll is ${gotPresent}, expected ${present}`);
    }
    if (gotStatic !== String(isStatic)) {
      // Name the direction, because only one of them is dangerous.
      const direction = gotStatic === 'true'
        ? 'a wrong TRUE makes an exported name look unexported'
        : 'a wrong FALSE only loses precision';
      problems.push(
        `${name}: dunderAllIsStatic is ${gotStatic}, expected ${isStatic} — ${direction}`
      );
    }
    if (gotNames !== names) {
      problems.push(`${name}: dunderAllNames is "${gotNames}", expected "${names}"`);
    }
    // The invariant that matters regardless of the cases above: names may only
    // be offered when they can be trusted.
    if (gotStatic !== 'true' && gotNames !== '') {
      problems.push(`${name}: names "${gotNames}" offered while isStatic is ${gotStatic}`);
    }
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`  ${Object.keys(CASES).length} __all__ shapes checked`);
  for (const problem of problems) {
    console.log(`  FAIL  ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}
