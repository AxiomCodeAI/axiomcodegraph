/**
 * JEDI SCORING GATE — where our parser loses to a peer analyser, per receiver kind.
 *
 *     npx tsx src/test/python-oracle/jedi-gate.ts <corpus-dir> [--limit N]
 *
 * CPython's MRO (emit_linkage.py) is ground truth but can only speak where the
 * receiver type is already known — `self`, `cls`. Our weakest receivers (NAME,
 * CALL_RESULT, ATTRIBUTE) are exactly the ones it cannot adjudicate.
 *
 * jedi covers those. It is NOT ground truth — it is a peer running the same kind of
 * inference we are — but it was validated against CPython on 432 self-call sites
 * with zero disagreements, so on the cases CPython cannot reach it is the best
 * evidence available.
 *
 * The output is deliberately a WORK LIST, not a score:
 *
 *   ONLY_JEDI    jedi resolved it and we did not  -> a reachable gap, with the
 *                answer attached, grouped by the mechanism that would close it
 *   ONLY_US      we resolved it and jedi did not  -> we are ahead, or one of us
 *                is wrong; worth a look either way
 *   DISAGREE     both resolved, different answers -> adjudicate, do not assume
 *   BOTH / NEITHER
 *
 * A DISAGREE is never automatically our bug. Two analysers differing means
 * something has to decide, and for SELF receivers that something is
 * emit_linkage.py, which is actual CPython.
 *
 * ADJUDICATION RULE — added after A3 showed this gate was silently biased.
 *
 * It scored EVERY difference against us. But jedi frequently stops at the
 * RECEIVER VARIABLE instead of following through to the callable:
 *
 *     _Row = Row          jedi answers `_row_getter._Row` (the variable)
 *     _Row(...)           we answer `Row` (what the variable holds)
 *
 * The compiler settles it — `LOAD_GLOBAL Row` then `STORE_FAST _Row` — and we are
 * right. Counting that as our error made a correctness improvement read as a
 * four-case regression, which is the worst possible failure for a gate: it
 * punishes the fix. jedi exposes `type` on each definition, so an answer that is a
 * `statement`/`instance` rather than a `function`/`class` is jedi declining to
 * follow, not jedi disagreeing. Those are now ADJUDICATED_OURS and reported apart
 * from genuine disagreements.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';
import { PINNED_INTERPRETER } from './harness/constants';

const JEDI = path.join(__dirname, 'oracle', 'emit_jedi_linkage.py');

interface JediRow {
  callLine: number;
  callCol: number;
  callee: string;
  receiverKind: string;
  receiverText: string;
  jedi: { name: string; owningClass: string | null; module: string; line: number;
          type: string; inRoot: boolean } | null;
}

function pyFiles(root: string, limit: number): string[] {
  const out: string[] = [];
  (function walk(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (out.length >= limit) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!['__pycache__', '.git'].includes(e.name)) walk(p);
      } else if (e.name.endsWith('.py')) out.push(p);
    }
  })(root);
  return out.sort();
}

function tsv(file: string): Record<string, string>[] {
  if (!fs.existsSync(file)) return [];
  const L = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  const h = L[0]!.split('\t');
  return L.slice(1).map((l) => {
    const c = l.split('\t');
    return Object.fromEntries(h.map((k, i) => [k, c[i] ?? '']));
  });
}

export async function runJediGate(root: string, limit = 400): Promise<number> {
  const out = path.join(process.cwd(), '.jedi-gate-out');
  fs.rmSync(out, { recursive: true, force: true });
  const summary = await new PythonProjectAnalyzer().analyze({
    rootDir: root, outputDir: out, baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });

  const calls = tsv(path.join(out, 'all-python-call-sites.csv'));
  const modules = tsv(path.join(out, 'all-python-modules.csv'));
  const methods = tsv(path.join(out, 'all-python-methods.csv'));
  const types = tsv(path.join(out, 'all-python-types.csv'));
  const methodByHash = new Map(methods.map((m) => [m['pyMethodUniqueHash']!, m]));
  const typeByHash = new Map(types.map((t) => [t['pyTypeUniqueHash']!, t]));
  /** Our answer as "OwningClass.name", comparable with jedi's. */
  const ourAnswer = (hash: string): string | null => {
    const m = methodByHash.get(hash);
    if (!m) return null;
    const owner = m['pyTypeLinkHash'] ? typeByHash.get(m['pyTypeLinkHash'])?.['name'] : '';
    return `${owner || m['ownerTypeName'] || ''}.${m['name']}`;
  };
  const fileOf = new Map(modules.map((m) => [m['pyModuleUniqueHash']!, m['filePath']!]));

  // ours, keyed by file|line|col|callee
  // Both sides keyed on a path RELATIVE to the corpus root. Our CSV stores a
  // relative filePath while jedi is given an absolute one; resolving only one
  // side silently produced zero matches and a scoreboard reading "ours 0".
  // Strip the corpus root if present, else take the path as already-relative.
  // pyFiles() yields paths that INCLUDE the root prefix while our CSV stores them
  // already relative to it — normalising only one side matched nothing and the
  // scoreboard read "ours 0" while the underlying line/col/callee agreed exactly.
  const absRoot = path.resolve(root);
  const rel = (p0: string) => {
    const a = path.resolve(p0);
    return a.startsWith(absRoot + path.sep) ? path.relative(absRoot, a) : path.normalize(p0);
  };
  const ours = new Map<string, Record<string, string>>();
  for (const c of calls) {
    const f = fileOf.get(c['pyModuleLinkHash']!) ?? '';
    ours.set(`${rel(f)}|${c['startLine']}|${c['startColumn']}|${c['calleeName']}`, c);
  }

  const stat = { BOTH: 0, ONLY_JEDI: 0, ONLY_US: 0, NEITHER: 0, DISAGREE: 0,
                 ADJUDICATED_OURS: 0 };
  /** jedi definition kinds that name an actual callable, not a variable. */
  const CALLABLE_DEF = new Set(['function', 'class', 'method']);
  const byKind = new Map<string, { ours: number; jedi: number; total: number }>();
  const gaps: { kind: string; file: string; line: number; callee: string;
                recv: string; answer: string }[] = [];
  const disagreements: { file: string; line: number; kind: string; callee: string;
                         ours: string; jedi: string }[] = [];

  for (const f of pyFiles(root, limit)) {
    let payload: { rows?: JediRow[]; fatal?: string };
    try {
      payload = JSON.parse(execFileSync(
        PINNED_INTERPRETER, [JEDI, '--file', f, '--root', path.resolve(root)],
        { encoding: 'utf-8', maxBuffer: 1 << 28, timeout: 120000 }
      ));
    } catch {
      continue;
    }
    if (payload.fatal || !payload.rows) continue;

    for (const r of payload.rows) {
      const k = byKind.get(r.receiverKind) ?? { ours: 0, jedi: 0, total: 0 };
      k.total++;
      const mine = ours.get(`${rel(f)}|${r.callLine}|${r.callCol}|${r.callee}`);
      const weResolved = !!mine?.['resolvedCalleeHash'];
      // only count jedi when its answer is INSIDE the analysis root — otherwise it
      // is resolving into the stdlib, which we deliberately do not attempt
      const jediResolved = !!r.jedi && r.jedi.inRoot;
      if (weResolved) k.ours++;
      if (jediResolved) k.jedi++;
      byKind.set(r.receiverKind, k);

      if (weResolved && jediResolved) {
        // BOTH resolving is not BOTH agreeing. Compare the answers, otherwise the
        // scoreboard silently reports concurrence it never checked.
        const mineAns = ourAnswer(mine!['resolvedCalleeHash']!);
        const jediAns = `${r.jedi!.owningClass ?? r.jedi!.module}.${r.jedi!.name}`;
        // jedi stopped at a variable rather than following to the callable
        if (!CALLABLE_DEF.has(r.jedi!.type)) {
          stat.ADJUDICATED_OURS++;
        } else if (mineAns && mineAns.replace(/^\./, '') === jediAns.split('.').slice(-1)[0] &&
                   mineAns.startsWith('.')) {
          // module-level function: we render ".name", jedi renders "module.name".
          // Same answer, different rendering — my formatting, not a disagreement.
          stat.ADJUDICATED_OURS++;
        } else if (mineAns && mineAns !== jediAns) {
          stat.DISAGREE++;
          if (disagreements.length < 200) {
            disagreements.push({
              file: path.relative(root, f), line: r.callLine, kind: r.receiverKind,
              callee: r.callee, ours: mineAns, jedi: jediAns,
            });
          }
        } else {
          stat.BOTH++;
        }
      }
      else if (jediResolved) {
        stat.ONLY_JEDI++;
        if (gaps.length < 5000) {
          gaps.push({
            kind: r.receiverKind, file: path.relative(root, f), line: r.callLine,
            callee: r.callee, recv: r.receiverText,
            answer: `${r.jedi!.owningClass ?? r.jedi!.module}.${r.jedi!.name}`,
          });
        }
      } else if (weResolved) stat.ONLY_US++;
      else stat.NEITHER++;
    }
  }

  console.log(`jedi scoring gate — ${root}`);
  console.log(`  files analysed : ${summary.filesAnalysed}, extraction errors ${summary.extractionErrors}`);
  console.log('');
  const col = (v: string | number, w: number) => String(v).padStart(w);
  console.log('  ' + 'receiver'.padEnd(14) + col('sites', 7) + col('ours', 8) + col('jedi', 8) + col('gap', 8));
  const order = [...byKind].sort((a, b) => (b[1].jedi - b[1].ours) - (a[1].jedi - a[1].ours));
  for (const [kind, v] of order) {
    console.log('  ' + kind.padEnd(14) + col(v.total, 7) + col(v.ours, 8) +
                col(v.jedi, 8) + col(Math.max(0, v.jedi - v.ours), 8));
  }
  const tot = [...byKind.values()].reduce((a, b) => a + b.total, 0);
  const to = [...byKind.values()].reduce((a, b) => a + b.ours, 0);
  const tj = [...byKind.values()].reduce((a, b) => a + b.jedi, 0);
  console.log('  ' + 'TOTAL'.padEnd(14) + col(tot, 7) + col(to, 8) + col(tj, 8) +
              col(Math.max(0, tj - to), 8));
  console.log('');
  console.log(`  AGREE ${stat.BOTH}   ADJUDICATED_OURS ${stat.ADJUDICATED_OURS}` +
              `   DISAGREE ${stat.DISAGREE}   ONLY_JEDI ${stat.ONLY_JEDI}` +
              `   ONLY_US ${stat.ONLY_US}   NEITHER ${stat.NEITHER}`);

  // SOLVABLE = anything at least one analyser reached in-root. NEITHER is the
  // corpus ceiling, not our backlog, so it must stay out of the denominator.
  const solvable = stat.BOTH + stat.ADJUDICATED_OURS + stat.DISAGREE +
                   stat.ONLY_JEDI + stat.ONLY_US;
  const solved = stat.BOTH + stat.ADJUDICATED_OURS + stat.DISAGREE + stat.ONLY_US;
  const correct = stat.BOTH + stat.ADJUDICATED_OURS + stat.ONLY_US;
  console.log('');

  // REFUSE TO SCORE A SILENT PEER.
  //
  // A correctness figure is a comparison, so it needs the peer to have answered.
  // When jedi resolved nothing — which happened for a whole 66-file corpus because
  // its environment was unpinned and macOS's /tmp symlink defeated the in-root test
  // — every site landed in ONLY_US, the denominator collapsed to exactly the cases
  // we answered, and this printed "100.0% correct". A gate that reports its best
  // possible score when its instrument is broken is worse than no gate.
  const peerAnswered = stat.BOTH + stat.DISAGREE + stat.ONLY_JEDI + stat.ADJUDICATED_OURS;
  if (peerAnswered === 0 || peerAnswered < solvable * 0.05) {
    console.log('  REFUSING TO SCORE — the peer resolved ' +
                `${peerAnswered} of ${solvable} solvable sites.`);
    console.log('  Nothing here was verified against anything. Likely causes, in the');
    console.log('  order they have actually bitten: jedi resolving against a different');
    console.log("  interpreter's stdlib, or the in-root test comparing unrealpath'd paths.");
    console.log(`  ONLY_US ${stat.ONLY_US} is a count of UNVERIFIED answers, not correct ones.`);
    return 1;
  }

  console.log(`  SOLVABLE (either analyser reached it) : ${solvable}`);
  console.log(`    we produced an answer               : ${solved}  (${((100*solved)/Math.max(solvable,1)).toFixed(1)}%)`);
  console.log(`    and it AGREES with jedi             : ${correct}  (${((100*correct)/Math.max(solvable,1)).toFixed(1)}%)`);
  console.log(`  unreachable by either (corpus ceiling): ${stat.NEITHER}`);

  if (disagreements.length) {
    console.log('\n  DISAGREEMENTS — both resolved, different answers. Adjudicate;');
    console.log('  for SELF receivers emit_linkage.py (actual CPython) settles it:\n');
    for (const d of disagreements.slice(0, 12)) {
      console.log(`    ${d.file}:${d.line} ${d.kind} .${d.callee}()`);
      console.log(`        ours=${d.ours}   jedi=${d.jedi}`);
    }
    if (disagreements.length > 12) console.log(`    … ${disagreements.length - 12} more`);
  }

  if (stat.ONLY_US) {
    console.log(`\n  ONLY_US = ${stat.ONLY_US}: we resolved these and jedi did not. Either we are` +
                `\n  ahead, or one of us is wrong. Not automatically a win.`);
  }

  if (gaps.length) {
    const byMech = new Map<string, typeof gaps>();
    for (const g of gaps) {
      const m =
        g.kind === 'NAME' ? 'local-variable typing'
        : g.kind === 'CALL_RESULT' ? 'return-type flow'
        : g.kind === 'ATTRIBUTE' ? 'attribute typing'
        : g.kind === 'SELF' ? 'self dispatch / MRO'
        : `${g.kind} receiver`;
      (byMech.get(m) ?? byMech.set(m, []).get(m)!).push(g);
    }
    console.log('\n  REACHABLE GAPS — jedi resolved these in-root and we did not.');
    console.log('  The answer is attached, so each line is actionable:\n');
    for (const [m, rows] of [...byMech].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`    ${m}  (${rows.length})`);
      for (const g of rows.slice(0, 6)) {
        console.log(`      ${g.file}:${g.line}  ${g.recv}.${g.callee}()  ->  ${g.answer}`);
      }
      if (rows.length > 6) console.log(`      … ${rows.length - 6} more`);
      console.log('');
    }
  }
  // Machine-readable work list. Printing six samples per mechanism is enough to
  // see the shape but not enough to WORK, and a gap you cannot enumerate is a gap
  // that gets estimated instead of fixed.
  const dump = { root, generatedBy: 'A0 jedi-gate', stat, disagreements, gaps };
  fs.writeFileSync('.jedi-gaps.json', JSON.stringify(dump, null, 1) + '\n');
  console.log(`\n  full work list (${gaps.length} gaps, ${disagreements.length} disagreements)`
              + ` written to .jedi-gaps.json`);

  return stat.ONLY_JEDI === 0 ? 0 : 1;
}

if (require.main === module) {
  const root = process.argv[2];
  if (!root) {
    console.log('usage: jedi-gate.ts <corpus-dir> [--limit N]');
    process.exit(2);
  }
  const li = process.argv.indexOf('--limit');
  runJediGate(root, li >= 0 ? Number(process.argv[li + 1]) : 400).then((c) => process.exit(c));
}
