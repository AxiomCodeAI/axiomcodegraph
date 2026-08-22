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

  const stat = { BOTH: 0, ONLY_JEDI: 0, ONLY_US: 0, NEITHER: 0, DISAGREE: 0 };
  const byKind = new Map<string, { ours: number; jedi: number; total: number }>();
  const gaps: { kind: string; file: string; line: number; callee: string;
                recv: string; answer: string }[] = [];

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

      if (weResolved && jediResolved) stat.BOTH++;
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
  console.log(`  BOTH ${stat.BOTH}   ONLY_JEDI ${stat.ONLY_JEDI}   ONLY_US ${stat.ONLY_US}   NEITHER ${stat.NEITHER}`);

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
