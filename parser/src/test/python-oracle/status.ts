/**
 * SHARED STATUS BOARD — one command, the whole picture, no human relay.
 *
 * The coordination channel already exists but is PASSIVE: rows accumulate in
 * six JSONL files and nothing tells anyone they are there. 47 open items sat in
 * findings-audit while both A0 and A3 asked the human what the other was doing.
 *
 * Run this at the start of every session:
 *
 *     npx tsx src/test/python-oracle/status.ts            # everything
 *     npx tsx src/test/python-oracle/status.ts --for A3   # only my items
 *
 * The convention that makes routing work: put `"owner": "A3"` on a row you are
 * handing to someone, and `"status": "open"` until they close it. A row with no
 * owner is informational and is not anyone's queue.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const COORD = path.resolve(__dirname, '..', '..', '..', 'python-work', 'coordination');

interface Row {
  ts?: string;
  agent?: string;
  kind?: string;
  construct?: string;
  owner?: string;
  severity?: string;
  status?: string;
  note?: string;
  detail?: string;
  subject?: string;
  [k: string]: unknown;
}

function readChannel(): { file: string; rows: Row[] }[] {
  if (!fs.existsSync(COORD)) return [];
  return fs
    .readdirSync(COORD)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .map((f) => {
      const rows: Row[] = [];
      for (const line of fs.readFileSync(path.join(COORD, f), 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        try {
          rows.push(JSON.parse(line) as Row);
        } catch {
          rows.push({ kind: 'MALFORMED', note: line.slice(0, 80) });
        }
      }
      return { file: f, rows };
    });
}

function text(r: Row): string {
  return String(r.note ?? r.detail ?? r.subject ?? '').replace(/\s+/g, ' ');
}

function main(): number {
  const argv = process.argv.slice(2);
  const forAgent = argv.includes('--for') ? argv[argv.indexOf('--for') + 1] : undefined;
  const channels = readChannel();
  const all = channels.flatMap((c) => c.rows.map((r) => ({ ...r, _file: c.file })));

  console.log('='.repeat(78));
  console.log('PYTHON PARSER — SHARED STATUS' + (forAgent ? `  (filtered for ${forAgent})` : ''));
  console.log('='.repeat(78));

  // ---- open items, routed -------------------------------------------------
  const open = all.filter((r) => r.status === 'open');
  const byOwner = new Map<string, Row[]>();
  for (const r of open) {
    const owner = (r.owner as string) ?? 'unassigned';
    (byOwner.get(owner) ?? byOwner.set(owner, []).get(owner)!).push(r);
  }
  console.log('\nOPEN ITEMS BY OWNER');
  if (!open.length) console.log('  (none)');
  for (const [owner, rows] of [...byOwner].sort((a, b) => b[1].length - a[1].length)) {
    if (forAgent && owner !== forAgent) continue;
    const high = rows.filter((r) => r.severity === 'high').length;
    console.log(`\n  ${owner}  —  ${rows.length} open${high ? `, ${high} HIGH` : ''}`);
    for (const r of rows.slice(0, forAgent ? 50 : 6)) {
      const sev = r.severity === 'high' ? '!' : ' ';
      console.log(`   ${sev} [${r.agent ?? '?'} -> ${owner}] ${r.construct ?? r.kind}`);
      console.log(`       ${text(r).slice(0, 150)}`);
    }
    if (!forAgent && rows.length > 6) console.log(`     … ${rows.length - 6} more`);
  }

  // ---- who has said what, recently ---------------------------------------
  if (!forAgent) {
    console.log('\nCHANNEL VOLUME');
    for (const c of channels) {
      const o = c.rows.filter((r) => r.status === 'open').length;
      console.log(`  ${c.file.padEnd(30)} ${String(c.rows.length).padStart(4)} rows, ${o} open`);
    }
    // Row `ts` fields are SELF-REPORTED by each agent and are not wall-clock —
    // verified: rows claiming 12:00 were written at 01:09. Ordering by them is
    // meaningless, so recency comes from file mtime, which the OS controls.
    console.log('\nCHANNEL ACTIVITY (file mtime — the only trustworthy clock here)');
    const stamped = channels
      .map((c) => ({ file: c.file, mtime: fs.statSync(path.join(COORD, c.file)).mtime }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    for (const s of stamped) {
      const mins = Math.round((Date.now() - s.mtime.getTime()) / 60000);
      console.log(`  ${s.file.padEnd(30)} ${mins < 1 ? 'just now' : mins + 'm ago'}`);
    }
  }

  // ---- the one number nobody should assert -------------------------------
  console.log('\nADJUDICATION COVERAGE');
  try {
    const out = execFileSync('npx', ['tsx', path.join(__dirname, 'coverage.ts')], {
      encoding: 'utf-8', cwd: path.resolve(__dirname, '..', '..', '..'),
    });
    const line = out.split('\n').find((l) => l.startsWith('PROJECT TOTAL'));
    console.log('  ' + (line ?? '(coverage meter produced no total)'));
    console.log('  full table: npx tsx src/test/python-oracle/coverage.ts');
  } catch (e) {
    console.log('  coverage meter failed: ' + (e as Error).message.split('\n')[0]);
  }

  console.log('\nGATES');
  console.log('  A0 oracle self-test : npx tsx src/test/python-oracle/run.ts --self-test');
  console.log('  A0 oracle sweep     : npx tsx src/test/python-oracle/run.ts --sweep <dir>');
  console.log('  A3 parser + gates   : npx tsx src/test/python-extractor-tests.ts');
  console.log('  closed-world bench  : src/test-data/python/closed-world  (ceiling is 100%)');
  console.log('');
  return 0;
}

if (require.main === module) process.exit(main());
export { main as printStatus };
