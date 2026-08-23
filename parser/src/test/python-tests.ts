/**
 * PYTHON TEST SUITE — one entry point, mirroring java-extractor-tests.ts.
 *
 *     npx tsx src/test/python-tests.ts            # everything
 *     npx tsx src/test/python-tests.ts --fast     # skip the corpus sweeps
 *     npx tsx src/test/python-tests.ts --list     # what runs, and what it proves
 *
 * Python accumulated seven entry points where Java has one, and the cost was not
 * tidiness: nobody could say what "the tests pass" meant, because no single
 * command ran them all. This is that command.
 *
 * The suites are ORDERED BY WHAT THEY PROVE, strongest evidence first, because a
 * failure in an early suite makes later ones uninterpretable — if the oracle
 * disagrees with CPython there is no point asking whether the parser agrees with
 * the oracle.
 *
 *   1 ORACLE SELF-TEST     is the arbiter itself correct?           (mutation-tested)
 *   2 SCHEMA GUARD         do doc, .dl and enums still agree?
 *   3 GOLDEN               has any frozen fact moved?               (names the fact)
 *   4 CLOSED-WORLD         does everything resolve where it must?   (ceiling 100%)
 *   5 PEP 695              do type parameters match CPython 3.12?
 *   6 ORACLE SWEEP         does the oracle survive adversarial source?
 *
 * Suites 1 and 2 gate the rest: if the instrument is wrong, every number below it
 * is decoration.
 */
import { execFileSync } from 'child_process';
import * as path from 'path';

interface Suite {
  name: string;
  proves: string;
  cmd: string[];
  slow?: boolean;
}

const HERE = path.resolve(__dirname);

const SUITES: Suite[] = [
  {
    name: 'oracle self-test',
    proves: 'the arbiter is correct — 81 harness + 174 semantics assertions',
    cmd: ['tsx', path.join(HERE, 'python-oracle/run.ts'), '--self-test'],
  },
  {
    name: 'schema guard',
    proves: 'PYTHON-FACT-SCHEMA.md, decls_base_py.dl and every enum still agree',
    cmd: ['tsx', path.join(HERE, 'python-oracle/schema-check.ts')],
  },
  {
    name: 'golden facts',
    proves: 'no frozen fact moved; a failure names the row and the column',
    cmd: ['tsx', path.join(HERE, 'python-oracle/golden-gate.ts')],
  },
  {
    name: 'closed-world resolution',
    proves: 'every call links or is a builtin on a corpus whose ceiling is 100%',
    cmd: ['tsx', path.join(HERE, 'python-oracle/closed-world-gate.ts')],
  },
  {
    name: 'PEP 695 type parameters',
    proves: 'py_type_parameter matches CPython 3.12 on name, position, bound, owner',
    cmd: ['tsx', path.join(HERE, 'python-oracle/pep695-gate.ts')],
  },
  {
    name: 'oracle sweep (torture)',
    proves: 'the oracle is internally consistent on CPython\'s own grammar tests',
    cmd: ['tsx', path.join(HERE, 'python-oracle/run.ts'), '--sweep', 'python-work/staging/torture'],
    slow: true,
  },
];

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    console.log('PYTHON SUITES\n');
    for (const s of SUITES) {
      console.log(`  ${s.name}${s.slow ? '  [slow]' : ''}`);
      console.log(`      proves: ${s.proves}`);
    }
    return 0;
  }
  const fast = argv.includes('--fast');
  const run = SUITES.filter((s) => !(fast && s.slow));

  console.log('='.repeat(78));
  console.log(`PYTHON TESTS — ${run.length} suite(s)${fast ? ', --fast' : ''}`);
  console.log('='.repeat(78));

  const results: { s: Suite; ok: boolean; ms: number; tail: string }[] = [];
  for (const s of run) {
    const t0 = Date.now();
    let ok = true;
    let out = '';
    try {
      out = execFileSync('npx', s.cmd, { encoding: 'utf-8', maxBuffer: 1 << 28 });
    } catch (e) {
      ok = false;
      out = String((e as { stdout?: string }).stdout ?? '') + String((e as Error).message ?? '');
    }
    const ms = Date.now() - t0;
    const tail = out.trim().split('\n').filter(Boolean).slice(-1)[0] ?? '';
    results.push({ s, ok, ms, tail });
    console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${s.name}  (${(ms / 1000).toFixed(1)}s)`);
    console.log(`      ${s.proves}`);
    if (!ok) {
      // Print enough of a failing suite to act on, not the whole log.
      for (const l of out.trim().split('\n').slice(-14)) console.log('      ' + l);
    } else if (tail) {
      console.log(`      ${tail}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(78));
  console.log(`${results.length - failed.length}/${results.length} suites passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  - ${f.s.name}`);
    console.log('\nSuites are ordered by what they prove. Fix the FIRST failure before');
    console.log('reading the others: if the arbiter or the schema is wrong, everything');
    console.log('below it is measuring against a broken reference.');
  }
  console.log('='.repeat(78));
  return failed.length ? 1 : 0;
}

if (require.main === module) process.exit(main());
