/**
 * GOLDEN GATE — a regression tripwire other agents can trust.
 *
 *     npx tsx src/test/python-oracle/golden-gate.ts --select   # who qualifies?
 *     npx tsx src/test/python-oracle/golden-gate.ts --promote  # copy into test-data
 *     npx tsx src/test/python-oracle/golden-gate.ts --bless    # freeze the facts
 *     npx tsx src/test/python-oracle/golden-gate.ts            # check (CI default)
 *
 * The point is that when someone changes the parser, the build tells them WHICH
 * FACT MOVED, not just that a number did. A percentage that drifts from 91.2 to
 * 90.8 is unactionable; "services/inheritance.py:14 py_call_site.resolvedCalleeKind
 * METHOD -> UNRESOLVED" is a bug report.
 *
 * ADMISSION RULE — 100% REACHABLE, MEASURED, NEVER JUDGED BY EYE.
 * A file is admitted only if EVERY call site in it either links to a declared
 * entity or is a builtin. That makes the ceiling exactly 100%, so any future
 * unresolved call is a regression rather than an argument about scope. Files that
 * exercise deliberately unresolvable constructs stay in staging where they belong —
 * they are good tests of behaviour and useless as a tripwire.
 *
 * TWO RULES THAT KEEP THIS HONEST
 *
 *   NOBODY HAND-WRITES EXPECTED FACTS. The parser proposes and the golden records.
 *   A hand-written expectation only tests whether its author and the implementer
 *   read the spec the same way.
 *
 *   --bless REFUSES IF THE ORACLE DISAGREES. Freezing unverified output would pin
 *   the bugs in place and make every future fix look like a regression. So CPython
 *   adjudicates the scopes and bindings first, and a disagreement blocks the freeze.
 */
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';
import { PINNED_INTERPRETER } from './harness/constants';

const VERIFIED = 'src/test-data/python/verified';
const GOLDEN = path.join(VERIFIED, '_golden');
const WORK = '.golden-out';

/** Corpora searched for admissible files. */
const CANDIDATES = [
  'python-work/staging/native',
  'python-work/staging/flow',
  'src/test-data/python/closed-world',
];

/** Columns that cannot be compared across runs or machines. */
const VOLATILE = /^(baseMservPath|filePath)$/;

function tsv(dir: string, f: string): Record<string, string>[] {
  const fp = path.join(dir, f);
  if (!fs.existsSync(fp)) return [];
  const L = fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean);
  if (!L.length) return [];
  const h = L[0]!.split('\t');
  return L.slice(1).map((l) => {
    const c = l.split('\t');
    return Object.fromEntries(h.map((k, i) => [k, c[i] ?? ''])) as Record<string, string>;
  });
}

async function analyse(root: string, out: string) {
  fs.rmSync(out, { recursive: true, force: true });
  return new PythonProjectAnalyzer().analyze({
    rootDir: root, outputDir: out, baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });
}

/** Per-file: does every call site link or is it a builtin? */
function admissible(out: string): { file: string; calls: number; why: string[] }[] {
  const calls = tsv(out, 'all-python-call-sites.csv');
  const mods = tsv(out, 'all-python-modules.csv');
  const fileOf = new Map(mods.map((m) => [m['pyModuleUniqueHash']!, m['filePath']!]));
  const per = new Map<string, { calls: number; why: string[] }>();
  for (const m of mods) per.set(m['filePath']!, { calls: 0, why: [] });
  for (const c of calls) {
    const f = fileOf.get(c['pyModuleLinkHash']!) ?? '?';
    const r = per.get(f) ?? per.set(f, { calls: 0, why: [] }).get(f)!;
    r.calls++;
    if (!c['resolvedCalleeHash'] && c['resolvedCalleeKind'] !== 'BUILTIN') {
      r.why.push(`L${c['startLine']} ${c['receiverKind']}.${c['calleeName']}`);
    }
  }
  return [...per].map(([file, v]) => ({ file, ...v }));
}

/** Every __init__.py under a root, relative — package markers, not test subjects. */
function listInits(root: string): string[] {
  const out: string[] = [];
  (function walk(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '__pycache__') walk(p); }
      else if (e.name === '__init__.py') out.push(path.relative(root, p));
    }
  })(root);
  return out;
}

async function select(promote: boolean): Promise<number> {
  const admitted: { root: string; file: string; calls: number }[] = [];
  for (const root of CANDIDATES) {
    if (!fs.existsSync(root)) continue;
    await analyse(root, WORK);
    for (const r of admissible(WORK)) {
      if (r.why.length === 0 && r.calls > 0) admitted.push({ root, file: r.file, calls: r.calls });
    }
  }
  console.log(`ADMISSIBLE (every call links or is a builtin): ${admitted.length} file(s)\n`);
  for (const a of admitted) console.log(`  ${String(a.calls).padStart(4)} calls  ${a.root}/${a.file}`);

  if (!promote) {
    console.log('\n  --promote copies these into ' + VERIFIED);
    return 0;
  }
  fs.rmSync(VERIFIED, { recursive: true, force: true });
  const manifest: Record<string, string> = {};
  // PRESERVE PACKAGE STRUCTURE. Flattening core/base.py to a single name breaks
  // `from .base import ...`, which would silently change what resolves — the
  // corpus would still pass its own goldens while testing different code. Each
  // corpus keeps its own subtree, and __init__.py files come along even though
  // they contain no calls, because without them the package does not exist.
  const roots = new Set(admitted.map((a) => a.root));
  for (const a of admitted) {
    const dest = path.join(VERIFIED, path.basename(a.root), a.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(a.root, a.file), dest);
    manifest[path.join(path.basename(a.root), a.file)] = `${a.root}/${a.file}`;
  }
  for (const root of roots) {
    for (const init of listInits(root)) {
      const dest = path.join(VERIFIED, path.basename(root), init);
      if (fs.existsSync(dest)) continue;
      const src = path.join(root, init);
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      manifest[path.join(path.basename(root), init)] = `${root}/${init} (package marker)`;
    }
  }
  fs.writeFileSync(path.join(VERIFIED, 'MANIFEST.json'), JSON.stringify({
    admittedBy: 'A0 golden-gate.ts --promote',
    rule: 'every call site links to a declared entity or is a builtin; ceiling is exactly 100%',
    files: manifest,
  }, null, 1) + '\n');
  console.log(`\npromoted ${admitted.length} file(s) -> ${VERIFIED}`);
  return 0;
}

/** CPython adjudicates scopes and bindings before anything is frozen. */
function oracleAgrees(): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const f of fs.readdirSync(VERIFIED).filter((x) => x.endsWith('.py'))) {
    const out = execFileSync(PINNED_INTERPRETER,
      [path.join(__dirname, 'oracle', 'emit_oracle.py'), '--file', path.join(VERIFIED, f)],
      { encoding: 'utf-8', maxBuffer: 1 << 28 });
    const d = JSON.parse(out) as { errors?: { kind: string; detail: string }[] };
    for (const e of d.errors ?? []) problems.push(`${f}: ${e.kind} ${e.detail}`);
  }
  return { ok: problems.length === 0, problems };
}

/** The frozen form: every relation, sorted, volatile columns dropped. */
function snapshot(out: string): Map<string, string[]> {
  const snap = new Map<string, string[]>();
  for (const f of fs.readdirSync(out).filter((x) => x.startsWith('all-python-'))) {
    const rows = tsv(out, f);
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]!).filter((c) => !VOLATILE.test(c));
    const lines = rows
      .map((r) => cols.map((c) => `${c}=${r[c] ?? ''}`).join('\t'))
      .sort();                       // row order is not a contract; content is
    snap.set(f.replace('all-python-', '').replace('.csv', ''), lines);
  }
  return snap;
}

async function bless(): Promise<number> {
  const v = oracleAgrees();
  if (!v.ok) {
    console.log('REFUSING TO BLESS — CPython disagrees with the parser on these files:');
    for (const p of v.problems.slice(0, 20)) console.log('  ' + p);
    console.log('\nFreezing this would pin the bug and make the fix look like a regression.');
    return 1;
  }
  await analyse(VERIFIED, WORK);
  fs.rmSync(GOLDEN, { recursive: true, force: true });
  fs.mkdirSync(GOLDEN, { recursive: true });
  const snap = snapshot(WORK);
  let rows = 0;
  for (const [rel, lines] of snap) {
    fs.writeFileSync(path.join(GOLDEN, `${rel}.golden`), lines.join('\n') + '\n');
    rows += lines.length;
  }
  const sha = crypto.createHash('sha256')
    .update([...snap].map(([k, v]) => k + v.join('')).sort().join('')).digest('hex');
  fs.writeFileSync(path.join(GOLDEN, 'SHA256'), sha + '\n');
  console.log(`blessed ${snap.size} relations, ${rows} rows  (oracle: 0 disagreements)`);
  console.log(`  sha256 ${sha.slice(0, 16)}`);
  return 0;
}

async function check(): Promise<number> {
  if (!fs.existsSync(GOLDEN)) {
    console.log('FAIL no goldens — run --promote then --bless');
    return 1;
  }
  await analyse(VERIFIED, WORK);
  const now = snapshot(WORK);
  const failures: string[] = [];
  const files = fs.readdirSync(GOLDEN).filter((f) => f.endsWith('.golden'));
  let compared = 0;
  for (const g of files) {
    const rel = g.replace('.golden', '');
    const want = fs.readFileSync(path.join(GOLDEN, g), 'utf-8').split('\n').filter(Boolean);
    const got = now.get(rel) ?? [];
    compared += want.length;
    const wantSet = new Set(want), gotSet = new Set(got);
    const lost = want.filter((l) => !gotSet.has(l));
    const gained = got.filter((l) => !wantSet.has(l));
    if (!lost.length && !gained.length) continue;
    failures.push(`${rel}: ${lost.length} fact(s) gone, ${gained.length} new`);
    // Render WITHOUT hash columns. Renaming one method moved four scope hashes and
    // every row that referenced them, so the raw diff was 150 characters of hex
    // with the actual change truncated off the end. Hashes still take part in the
    // COMPARISON — PK stability is the contract — they just do not take part in
    // the explanation.
    const readable = (l: string) => l.split('\t')
      .filter((kv) => !/Hash=/.test(kv))
      .join('  ');
    for (const l of lost.slice(0, 5)) console.log(`  - ${rel}  ${readable(l).slice(0, 140)}`);
    for (const l of gained.slice(0, 5)) console.log(`  + ${rel}  ${readable(l).slice(0, 140)}`);
    const hashOnly = lost.length === gained.length &&
      lost.every((l, i) => readable(l) === readable(gained[i] ?? ''));
    if (hashOnly) console.log(`    (all ${lost.length} differ only in hash columns — a key cascaded)`);
  }
  for (const rel of now.keys()) {
    if (!files.includes(`${rel}.golden`)) failures.push(`${rel}: relation is NEW since blessing`);
  }
  console.log(`\ngolden gate — ${files.length} relations, ${compared} frozen facts`);
  if (!failures.length) { console.log('PASS  every frozen fact still holds'); return 0; }
  console.log('FAIL');
  for (const f of failures) console.log('  ' + f);
  console.log('\nIf the change is CORRECT, re-bless. --bless re-runs the oracle first,');
  console.log('so a fix that CPython disagrees with cannot be frozen into place.');
  return 1;
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  if (a.includes('--select')) return select(false);
  if (a.includes('--promote')) return select(true);
  if (a.includes('--bless')) return bless();
  return check();
}
if (require.main === module) main().then((c) => process.exit(c));
export { main as goldenGate };
