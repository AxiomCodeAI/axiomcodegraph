/**
 * Entry point.
 *
 *   npx tsx src/test/python-oracle/run.ts --self-test
 *   npx tsx src/test/python-oracle/run.ts --oracle <file.py>
 *   npx tsx src/test/python-oracle/run.ts --sweep <dir> [--limit N]
 *
 * `--sweep` runs the oracle over a tree and reports internal-consistency
 * failures. It does NOT need a parser: it validates the arbiter against real
 * code, which is the only way to know the arbiter is trustworthy before there
 * is anything to arbitrate.
 */
import * as fs from 'fs';
import * as path from 'path';

import { assertOracleUsable, oracleForFile } from './harness/oracle-runner';
import { invariant9a_symtableAstPairing, invariant9b_syntheticIterator } from './harness/invariants';
import { runHarnessSelfTest } from './self-test/harness-self-test';
import { runOracleSemanticsTests } from './self-test/oracle-semantics-test';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['__pycache__', '.git', 'node_modules'].includes(e.name)) walk(p, out);
    } else if (e.name.endsWith('.py')) out.push(p);
  }
  return out;
}

function sweep(dir: string, limit: number): number {
  const prov = assertOracleUsable();
  console.log(`oracle sweep — ${prov.interpreterPath}`);
  console.log(`regime ${prov.emissionRegime}, ${prov.sysVersion.split(' ')[0]}`);
  const files = walk(dir).slice(0, limit);
  let ok = 0, syntax = 0, bad = 0;
  const kinds: Record<string, number> = {};
  let scopes = 0, bindings = 0, synth = 0;

  for (const f of files) {
    let o;
    try {
      o = oracleForFile(f);
    } catch {
      bad++; kinds['SUBPROCESS_FAILED'] = (kinds['SUBPROCESS_FAILED'] ?? 0) + 1; continue;
    }
    if (o.fatal) {
      if (o.fatal === 'SYNTAX_ERROR') syntax++;
      else { bad++; kinds[o.fatal] = (kinds[o.fatal] ?? 0) + 1; }
      continue;
    }
    const problems = [
      ...o.errors.map((e) => e.kind),
      ...invariant9a_symtableAstPairing(o).violations.map(() => 'PAIRING'),
      ...invariant9b_syntheticIterator(o).violations.map(() => 'SYNTHETIC_ITERATOR'),
    ];
    scopes += o.scopes.length;
    bindings += o.bindings.length;
    synth += o.bindings.filter((b) => b.name === '.0').length;
    if (problems.length === 0) ok++;
    else {
      bad++;
      for (const k of problems) kinds[k] = (kinds[k] ?? 0) + 1;
      if (bad <= 5) console.log(`  FAIL ${f}\n       ${[...new Set(problems)].join(', ')}`);
    }
  }
  console.log(`files=${files.length} clean=${ok} syntaxErrors=${syntax} internallyInconsistent=${bad}`);
  console.log(`scopes=${scopes} bindings=${bindings} synthetic '.0'=${synth}`);
  if (Object.keys(kinds).length) console.log('failure kinds:', kinds);
  return bad === 0 ? 0 : 1;
}

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test') || argv.length === 0) {
    const a = runHarnessSelfTest();
    console.log('');
    const b = runOracleSemanticsTests();
    return a || b;
  }
  const oi = argv.indexOf('--oracle');
  if (oi >= 0) {
    const o = oracleForFile(argv[oi + 1]!);
    console.log(JSON.stringify(o, null, 1));
    return o.errors?.length ? 1 : 0;
  }
  const si = argv.indexOf('--sweep');
  if (si >= 0) {
    const li = argv.indexOf('--limit');
    return sweep(argv[si + 1]!, li >= 0 ? Number(argv[li + 1]) : 100000);
  }
  console.error('usage: run.ts [--self-test | --oracle <file> | --sweep <dir> [--limit N]]');
  return 2;
}

process.exit(main());
