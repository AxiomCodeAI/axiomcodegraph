/**
 * HOLDOUT GATE — the generalisation estimate, usable once.
 *
 *     npx tsx src/test/python-oracle/holdout-gate.ts --seal     # A0 only, once
 *     npx tsx src/test/python-oracle/holdout-gate.ts --verify   # tamper check
 *     npx tsx src/test/python-oracle/holdout-gate.ts --run      # spends the holdout
 *
 * Every other corpus here is one the parser has been iterated against, which makes
 * them training data: a score on them says how well the parser fits the defects we
 * already found. `src/test-data/python/_holdout` is the control — closed-world like
 * `closed-world/` so its ceiling is exactly 100%, but written in different idioms
 * and without reference to any known defect.
 *
 * WHY IT IS SEALED. The value of a holdout is entirely in nobody having optimised
 * against it, and that value cannot be restored once spent. So:
 *
 *   - `--run` prints a SCORE and the failing MECHANISMS, never the file or line.
 *     Enough to know whether the parser generalises; not enough to patch case by
 *     case, which is the behaviour that would destroy it.
 *   - `--verify` recomputes the seal. A changed hash means the corpus was edited,
 *     at which point its result means nothing and it must be REPLACED, not repaired.
 *
 * This is a norm, not a lock — anyone can read the directory. The seal makes
 * tampering detectable, which in a fleet that reports its own numbers is the part
 * that matters.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const CORPUS = 'src/test-data/python/_holdout';
const SEAL = path.join(CORPUS, 'SEAL.json');
const OUT = path.join(process.cwd(), '.holdout-out');

interface Seal {
  sealedBy: string;
  note: string;
  files: Record<string, string>;
}

function pyFiles(): string[] {
  const out: string[] = [];
  (function walk(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== '__pycache__') walk(p);
      } else if (e.name.endsWith('.py')) out.push(p);
    }
  })(CORPUS);
  return out.sort();
}

function hashes(): Record<string, string> {
  const h: Record<string, string> = {};
  for (const f of pyFiles()) {
    h[path.relative(CORPUS, f)] = crypto
      .createHash('sha256')
      .update(fs.readFileSync(f))
      .digest('hex');
  }
  return h;
}

function seal(): number {
  const s: Seal = {
    sealedBy: 'A0',
    note:
      'Holdout corpus. Do not read, tune against, or extend. A changed hash means ' +
      'the result is void and the corpus must be replaced, not repaired.',
    files: hashes(),
  };
  fs.writeFileSync(SEAL, JSON.stringify(s, null, 1) + '\n');
  console.log(`sealed ${Object.keys(s.files).length} files`);
  return 0;
}

function verify(): number {
  if (!fs.existsSync(SEAL)) {
    console.log('FAIL no seal — run --seal first');
    return 1;
  }
  const s = JSON.parse(fs.readFileSync(SEAL, 'utf-8')) as Seal;
  const now = hashes();
  const problems: string[] = [];
  for (const [f, h] of Object.entries(s.files)) {
    if (!(f in now)) problems.push(`REMOVED ${f}`);
    else if (now[f] !== h) problems.push(`MODIFIED ${f}`);
  }
  for (const f of Object.keys(now)) if (!(f in s.files)) problems.push(`ADDED ${f}`);

  if (problems.length) {
    console.log('SEAL BROKEN — this corpus is no longer a holdout:');
    for (const p of problems) console.log('  ' + p);
    console.log('\nReplace it with fresh unseen code. Do not repair it: whoever');
    console.log('changed it has now seen it, so its result cannot be trusted again.');
    return 1;
  }
  console.log(`seal intact — ${Object.keys(s.files).length} files unchanged`);
  return 0;
}

async function run(): Promise<number> {
  if (verify() !== 0) return 1;

  fs.rmSync(OUT, { recursive: true, force: true });
  const summary = await new PythonProjectAnalyzer().analyze({
    rootDir: CORPUS,
    outputDir: OUT,
    baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });

  const csv = path.join(OUT, 'all-python-call-sites.csv');
  if (!fs.existsSync(csv)) {
    console.log('FAIL holdout produced no call sites');
    return 1;
  }
  const lines = fs.readFileSync(csv, 'utf-8').split('\n').filter(Boolean);
  const hdr = lines[0]!.split('\t');
  const rows = lines.slice(1).map((l) => {
    const c = l.split('\t');
    return Object.fromEntries(hdr.map((h, i) => [h, c[i] ?? ''])) as Record<string, string>;
  });

  const linked = rows.filter((r) => r.resolvedCalleeHash).length;
  const builtin = rows.filter((r) => r.resolvedCalleeKind === 'BUILTIN').length;
  const unresolved = rows.filter(
    (r) => !r.resolvedCalleeHash && r.resolvedCalleeKind !== 'BUILTIN'
  );

  // Mechanisms only. Naming the file and line would let the holdout be patched
  // case by case, which is exactly the behaviour that voids it.
  const mech = new Map<string, number>();
  for (const r of unresolved) {
    const m =
      r.receiverKind === 'NAME' ? 'local-variable typing'
      : r.receiverKind === 'CALL_RESULT' ? 'return-type flow'
      : r.receiverKind === 'ATTRIBUTE' ? 'attribute typing'
      : r.receiverKind === 'SELF' ? 'self dispatch'
      : r.receiverKind === 'SUPER' ? 'MRO / super'
      : `${r.receiverKind} receiver`;
    mech.set(m, (mech.get(m) ?? 0) + 1);
  }

  console.log('\nHOLDOUT RESULT  (ceiling is exactly 100%; corpus never tuned against)');
  console.log(`  files analysed : ${summary.filesAnalysed}, extraction errors ${summary.extractionErrors}`);
  console.log(`  call sites     : ${rows.length}`);
  console.log(`  linked         : ${linked}  (${((100 * linked) / rows.length).toFixed(1)}%)`);
  console.log(`  builtin        : ${builtin}`);
  console.log(`  UNRESOLVED     : ${unresolved.length}`);
  console.log('\n  failing mechanisms (no file or line, by design):');
  for (const [m, n] of [...mech].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(3)}  ${m}`);
  }
  console.log(
    '\n  Compare against closed-world/. A materially lower score here is the size\n' +
    '  of the overfit, and is the only honest generalisation estimate available.'
  );
  return unresolved.length === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  if (a.includes('--seal')) return seal();
  if (a.includes('--verify')) return verify();
  if (a.includes('--run')) return run();
  console.log('usage: holdout-gate.ts --seal | --verify | --run');
  console.log('  --run SPENDS the holdout. Only when the visible corpora are near ceiling.');
  return 2;
}

if (require.main === module) main().then((c) => process.exit(c));
export { main as holdoutGate };
