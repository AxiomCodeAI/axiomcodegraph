/**
 * TORTURE CORPUS — CPython's own adversarial tests, staged for the gates.
 *
 *     npx tsx src/test/python-oracle/torture-corpus.ts --stage
 *     npx tsx src/test/python-oracle/torture-corpus.ts --verify
 *
 * Hand-written edge cases test OUR IMAGINATION. These files were written by the
 * people who implemented the grammar, specifically to break their own parser, and
 * they ship with the pinned interpreter — so the corpus is free, adversarial, and
 * reproducible from a version string rather than from a checked-in copy.
 *
 * The script is committed; the corpus is not. Same standard as vendor-corpus.ts.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT FOR
 *
 *   USE IT for per-node syntactic adjudication — kind, literalValue, isWrite,
 *   isAwaited, isStarred, scopes, bindings. Those facts do not depend on where a
 *   callee lives, so the corpus costs nothing and gives ~167k nodes.
 *
 *   DO NOT quote a RESOLUTION RATE off it unvendored. Measured: self.* is 49.3% of
 *   all calls here, and 79.1% of those target unittest.TestCase, which is outside
 *   the root. The raw linkage ceiling is about 25%, so a low score would be
 *   measuring the corpus, not the parser — the same trap that made ctypes read
 *   7.9% on SELF. Run it through vendor-corpus.ts first if you want that number.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { INTERPRETERS, PINNED_INTERPRETER } from './harness/constants';

const DEST = '/tmp/py-corpus/torture';
const DEST_695 = '/tmp/py-corpus/torture-pep695';

/**
 * PEP 695 lives in the 3.12 stdlib and nowhere else, so it is staged from the
 * PY3_12_PLUS interpreter into its own directory. Keeping it apart from the 3.10
 * corpus is not tidiness: the two regimes produce different scope trees for the
 * same source, so a directory mixing them has no single correct answer.
 */
const PEP695_TESTS = ['test_type_params.py', 'test_type_aliases.py'];

/** Files chosen because they stress the GRAMMAR, not a library. */
const GRAMMAR_TESTS = [
  'test_grammar.py', 'test_patma.py', 'test_scope.py', 'test_syntax.py',
  'test_unpack.py', 'test_unpack_ex.py', 'test_decorators.py', 'test_metaclass.py',
  'test_descr.py', 'test_generators.py', 'test_typing.py', 'test_dataclasses.py',
  'test_enum.py', 'test_fstring.py', 'test_named_expressions.py', 'test_keyword.py',
  'test_coroutines.py', 'test_asyncgen.py', 'test_contextlib.py', 'test_with.py',
  'test_yield_from.py', 'test_exception_group.py', 'test_listcomps.py',
  'test_dictcomps.py', 'test_genexps.py', 'test_slice.py', 'test_string_literals.py',
  'test_bool.py', 'test_class.py', 'test_funcattrs.py', 'test_global.py',
  'test_nonlocal.py', 'test_raise.py', 'test_super.py', 'test_augassign.py',
];

function stdlibDir(): string {
  return execFileSync(PINNED_INTERPRETER,
    ['-c', 'import sysconfig;print(sysconfig.get_paths()["stdlib"])'],
    { encoding: 'utf-8' }).trim();
}

function version(): string {
  return execFileSync(PINNED_INTERPRETER,
    ['-c', 'import sys;print("%d.%d.%d" % sys.version_info[:3])'],
    { encoding: 'utf-8' }).trim();
}

function stage(): number {
  const testDir = path.join(stdlibDir(), 'test');
  if (!fs.existsSync(testDir)) {
    console.log(`FAIL no Lib/test under ${testDir}`);
    return 1;
  }
  fs.rmSync(DEST, { recursive: true, force: true });
  fs.mkdirSync(DEST, { recursive: true });

  const staged: string[] = [];
  const missing: string[] = [];
  let parses = 0;
  let refuses = 0;
  for (const f of GRAMMAR_TESTS) {
    const src = path.join(testDir, f);
    if (!fs.existsSync(src)) { missing.push(f); continue; }
    fs.copyFileSync(src, path.join(DEST, f));
    staged.push(f);
  }

  // Files that DELIBERATELY do not parse are ground truth for py_parse_gap, which
  // today has no emitter — so an unparseable file fails silently. Staged into a
  // sibling directory rather than mixed in, because a gate that expects success on
  // every file and a gate that expects failure on every file are different gates.
  const gapDir = path.join(DEST, '..', 'torture-parse-gap');
  fs.rmSync(gapDir, { recursive: true, force: true });
  fs.mkdirSync(gapDir, { recursive: true });
  for (const f of fs.readdirSync(testDir).filter((x) => x.endsWith('.py'))) {
    const p = path.join(testDir, f);
    try {
      execFileSync(PINNED_INTERPRETER, ['-c',
        'import ast,sys;ast.parse(open(sys.argv[1],encoding="utf-8",errors="replace").read())', p],
        { stdio: 'ignore' });
      parses++;
    } catch {
      fs.copyFileSync(p, path.join(gapDir, f));
      refuses++;
    }
  }

  const manifest = {
    stagedBy: 'A0 torture-corpus.ts',
    interpreter: PINNED_INTERPRETER,
    pythonVersion: version(),
    stdlibTestDir: testDir,
    files: staged,
    missing,
    parseGapFiles: fs.readdirSync(gapDir),
    note: 'Regenerate with --stage. Do NOT quote a resolution rate on this corpus ' +
          'unvendored: 79% of self.* calls target unittest.TestCase, which is out of root.',
  };
  fs.writeFileSync(path.join(DEST, 'MANIFEST.json'), JSON.stringify(manifest, null, 1) + '\n');

  console.log(`staged ${staged.length}/${GRAMMAR_TESTS.length} grammar files -> ${DEST}`);
  if (missing.length) console.log(`  not in this stdlib (${missing.length}): ${missing.join(', ')}`);
  console.log(`Lib/test overall: ${parses} parse, ${refuses} do not`);
  console.log(`  ${refuses} unparseable file(s) -> ${gapDir}  (py_parse_gap ground truth)`);
  console.log(`interpreter ${manifest.pythonVersion} at ${PINNED_INTERPRETER}`);

  // ---- PEP 695, from the 3.12 interpreter ----------------------------------
  const py312 = INTERPRETERS.PY3_12_PLUS;
  if (fs.existsSync(py312)) {
    const dir312 = path.join(
      execFileSync(py312, ['-c', 'import sysconfig;print(sysconfig.get_paths()["stdlib"])'],
        { encoding: 'utf-8' }).trim(), 'test');
    fs.rmSync(DEST_695, { recursive: true, force: true });
    fs.mkdirSync(DEST_695, { recursive: true });
    const got: string[] = [];
    for (const f of PEP695_TESTS) {
      const src = path.join(dir312, f);
      if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(DEST_695, f)); got.push(f); }
    }
    const v312 = execFileSync(py312,
      ['-c', 'import sys;print("%d.%d.%d" % sys.version_info[:3])'], { encoding: 'utf-8' }).trim();
    fs.writeFileSync(path.join(DEST_695, 'MANIFEST.json'), JSON.stringify({
      stagedBy: 'A0 torture-corpus.ts', interpreter: py312, pythonVersion: v312,
      emissionRegime: 'PY3_12_PLUS', files: got,
      note: 'PEP 695 ground truth for py_type_parameter. MUST be adjudicated under ' +
            'PY3_12_PLUS; running it against a 3.10 oracle is a category error, not a test.',
    }, null, 1) + '\n');
    console.log(`staged ${got.length} PEP 695 file(s) -> ${DEST_695}  (CPython ${v312})`);
  } else {
    console.log(`no 3.12 interpreter at ${py312} — PEP 695 corpus NOT staged`);
  }
  return 0;
}

function verify(): number {
  const mf = path.join(DEST, 'MANIFEST.json');
  if (!fs.existsSync(mf)) { console.log('FAIL not staged — run --stage'); return 1; }
  const m = JSON.parse(fs.readFileSync(mf, 'utf-8'));
  if (m.pythonVersion !== version()) {
    console.log(`FAIL staged from ${m.pythonVersion}, interpreter is now ${version()}`);
    return 1;
  }
  const onDisk = fs.readdirSync(DEST).filter((f) => f.endsWith('.py')).sort();
  const expect = [...m.files].sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(expect)) {
    console.log(`FAIL corpus differs from manifest (${onDisk.length} on disk, ${expect.length} listed)`);
    return 1;
  }
  console.log(`ok — ${onDisk.length} files, staged from CPython ${m.pythonVersion}`);
  return 0;
}

if (require.main === module) {
  const a = process.argv.slice(2);
  process.exit(a.includes('--verify') ? verify() : a.includes('--stage') ? stage() : (
    console.log('usage: torture-corpus.ts --stage | --verify'), 2));
}
export { stage, verify };
