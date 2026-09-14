/**
 * CORPUS INVARIANTS — run the Gradle front end over a real repository and
 * check the properties that must hold whatever the repository contains.
 *
 *     npx tsx src/test/gradle-gates/corpus-invariants.ts <repo> [<repo> …]
 *
 * ## Why this is separate from the fixture suite
 *
 * The fixture suite compares against expectations written alongside the
 * parser, so it can only catch a change of behaviour, never a wrong premise
 * shared by both. This gate asserts nothing about what a particular build
 * ought to contain. It asserts properties that are true of any correct
 * relational output — every foreign key resolves, no two rows share a key, the
 * block tree terminates, a script reporting OK really produced no gaps — and
 * runs them over builds nobody wrote for this parser.
 *
 * A defect that survives the fixtures because the fixtures encode it does not
 * survive a hundred thousand rows of somebody else's build.
 *
 * It also prints the coverage split, which is the number worth watching:
 * resolvable-but-unresolved is the parser's own gap and should shrink;
 * external is not and is reported separately rather than folded in.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GradleProjectAnalyzer } from '@/workflows/gradle/gradle-project-analyzer';

type Row = Record<string, string>;

function tsv(dir: string, file: string): Row[] {
  const fp = path.join(dir, file);
  if (!fs.existsSync(fp)) return [];
  const lines = fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean);
  if (!lines.length) return [];
  const head = lines[0]!.split('\t');
  return lines.slice(1).map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])) as Row;
  });
}

interface Violation { invariant: string; detail: string }

function checkInvariants(out: string): Violation[] {
  const bad: Violation[] = [];
  const files = fs.readdirSync(out).filter((f) => f.startsWith('all-gradle-'));
  const rowsByFile = new Map(files.map((f) => [f, tsv(out, f)]));

  const keys = new Set<string>();
  for (const rows of rowsByFile.values()) {
    for (const r of rows) {
      for (const [c, v] of Object.entries(r)) {
        if (/UniqueHash$/.test(c) && v) keys.add(v);
      }
    }
  }

  // 1. no duplicate primary keys
  for (const [file, rows] of rowsByFile) {
    if (!rows.length) continue;
    const keyCol = Object.keys(rows[0]!).find((c) => /UniqueHash$/.test(c));
    if (!keyCol) continue;
    const seen = new Set<string>();
    let dupes = 0;
    for (const r of rows) {
      const k = r[keyCol] ?? '';
      if (seen.has(k)) dupes++;
      seen.add(k);
    }
    if (dupes) bad.push({ invariant: 'unique-keys', detail: `${file}: ${dupes} duplicate key(s)` });
  }

  // 2. every non-empty foreign key resolves. An EMPTY one is legal: it is how
  //    the parser says a link could not be decided.
  const NOT_FK = /^(serviceVersionLinkHash|.*UniqueHash)$/;
  let dangling = 0;
  const danglingCols = new Map<string, number>();
  for (const [file, rows] of rowsByFile) {
    for (const r of rows) {
      for (const [c, v] of Object.entries(r)) {
        if (!/Hash$/.test(c) || NOT_FK.test(c) || !v) continue;
        if (!keys.has(v)) {
          dangling++;
          const k = `${file}:${c}`;
          danglingCols.set(k, (danglingCols.get(k) ?? 0) + 1);
        }
      }
    }
  }
  if (dangling) {
    for (const [where, n] of [...danglingCols].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      bad.push({ invariant: 'referential-integrity', detail: `${where}: ${n} dangling` });
    }
  }

  // 3. the block tree terminates
  const blocks = rowsByFile.get('all-gradle-blocks.csv') ?? [];
  const byHash = new Map(blocks.map((b) => [b['gradleBlockUniqueHash'], b]));
  for (const b of blocks) {
    const seen = new Set<string>();
    let cur: string | undefined = b['gradleBlockUniqueHash'];
    let depth = 0;
    while (cur && depth++ < 10_000) {
      if (seen.has(cur)) {
        bad.push({ invariant: 'acyclic-blocks', detail: `cycle at ${b['blockName']} in ${b['filePath']}` });
        break;
      }
      seen.add(cur);
      cur = byHash.get(cur)?.['parentBlockHash'] || undefined;
    }
  }

  // 4. a script reporting OK produced no gaps, so an empty result means empty
  const gapsByScript = new Map<string, number>();
  for (const g of rowsByFile.get('all-gradle-parse-gaps.csv') ?? []) {
    const k = g['scriptHash'] ?? '';
    gapsByScript.set(k, (gapsByScript.get(k) ?? 0) + 1);
  }
  let statusMismatch = 0;
  for (const s of rowsByFile.get('all-gradle-scripts.csv') ?? []) {
    const actual = gapsByScript.get(s['gradleScriptUniqueHash'] ?? '') ?? 0;
    if (Number(s['parseGapCount']) !== actual) statusMismatch++;
    if (s['parseStatus'] === 'OK' && actual > 0) statusMismatch++;
  }
  if (statusMismatch) {
    bad.push({ invariant: 'parse-status-honest', detail: `${statusMismatch} script(s) disagree with their gap rows` });
  }

  // 5. positions are real
  let badPos = 0;
  for (const [, rows] of rowsByFile) {
    for (const r of rows) {
      if (!('startLine' in r)) continue;
      const s = Number(r['startLine']);
      const e = Number(r['endLine']);
      if (!(s >= 1) || !(e >= s)) badPos++;
    }
  }
  if (badPos) bad.push({ invariant: 'positions', detail: `${badPos} row(s) with an impossible line range` });

  // 6. a declaration's parent block must belong to the same script
  const blockScript = new Map(blocks.map((b) => [b['gradleBlockUniqueHash'], b['scriptHash']]));
  let crossed = 0;
  for (const d of rowsByFile.get('all-gradle-declarations.csv') ?? []) {
    const parent = d['parentBlockHash'];
    if (!parent) continue;
    const owner = blockScript.get(parent);
    if (owner && owner !== d['scriptHash']) crossed++;
  }
  if (crossed) bad.push({ invariant: 'block-ownership', detail: `${crossed} declaration(s) parented into another script` });

  return bad;
}

function report(out: string): void {
  const scripts = tsv(out, 'all-gradle-scripts.csv');
  const refs = tsv(out, 'all-gradle-value-references.csv');
  const coords = tsv(out, 'all-gradle-dependency-coordinates.csv');

  const count = (rows: Row[], col: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r[col] ?? '', (m.get(r[col] ?? '') ?? 0) + 1);
    return m;
  };

  const status = count(scripts, 'parseStatus');
  console.log(`  scripts      ${scripts.length} (${[...status].map(([k, v]) => `${k}=${v}`).join(' ')})`);

  const kinds = count(refs, 'resolutionKind');
  const external = kinds.get('EXTERNAL') ?? 0;
  const unresolved = kinds.get('UNRESOLVED_IN_CORPUS') ?? 0;
  const resolved = refs.length - external - unresolved;
  const denominator = resolved + unresolved;

  console.log(`  references   ${refs.length}`);
  console.log(`    resolved                 ${resolved}`);
  console.log(`    unresolved (parser gap)  ${unresolved}`);
  console.log(`    external (excluded)      ${external}`);
  console.log(`    coverage                 ${denominator ? ((resolved / denominator) * 100).toFixed(1) : 'n/a'}%  ← resolved / (resolved + resolvable-but-unresolved)`);

  const sources = count(coords, 'versionSource');
  console.log(`  coordinates  ${coords.length} (${[...sources].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ')})`);

  const gapReasons = count(tsv(out, 'all-gradle-parse-gaps.csv'), 'reason');
  if (gapReasons.size) {
    console.log(`  parse gaps   ${[...gapReasons].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }
}

async function main(): Promise<void> {
  const repos = process.argv.slice(2);
  if (!repos.length) {
    console.error('usage: corpus-invariants.ts <repo> [<repo> …]');
    process.exit(2);
  }

  let violations = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gradle-corpus-'));

  for (const repo of repos) {
    if (!fs.existsSync(repo)) { console.log(`\n▸ ${repo}\n  ⏭️  not found, skipped`); continue; }

    const name = path.basename(repo);
    const out = path.join(tmp, name);
    fs.mkdirSync(out, { recursive: true });

    const silence = console.log;
    console.log = () => {};
    try {
      await new GradleProjectAnalyzer(out).analyzeGradleFiles(
        [{ name, path: repo, language: 'UNKNOWN' as never, hasSourceFiles: false }],
        'corpus-gate'
      );
    } finally {
      console.log = silence;
    }

    console.log(`\n▸ ${name}`);
    report(out);

    const bad = checkInvariants(out);
    violations += bad.length;
    if (!bad.length) {
      console.log('  ✓ all invariants hold');
    } else {
      for (const v of bad) console.log(`  ✗ ${v.invariant}: ${v.detail}`);
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(violations === 0 ? '\n✅ corpus invariants hold' : `\n❌ ${violations} violation(s)`);
  process.exit(violations === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
