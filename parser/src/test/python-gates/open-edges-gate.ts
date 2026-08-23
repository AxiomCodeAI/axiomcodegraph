/**
 * OPEN-EDGES RATCHET — the backlog as an executable test.
 *
 *     npx tsx src/test/python-oracle/open-edges-gate.ts          # check
 *     npx tsx src/test/python-oracle/open-edges-gate.ts --accept # lower the bar
 *
 * `categories/edge-cases/OPEN_*.py` holds shapes that are locally resolvable IN
 * PRINCIPLE — every callee is declared in the same file — and that we do not
 * resolve yet. They cannot go in the golden corpus, which demands zero unresolved
 * calls, and deleting them would lose the only executable record of what is left
 * to build.
 *
 * So they get a ratchet. The expected count may FALL and never RISE:
 *
 *   fewer unresolved   the gate tells you to run --accept and lock the gain in
 *   more unresolved    a regression, and it names the call that stopped resolving
 *
 * A ratchet is worth more than a percentage here because the remaining work is
 * enumerable. Each line is one inference rule someone has not written yet, and
 * when the count reaches zero the file moves to resolution_edges.py and joins the
 * goldens.
 */
import * as fs from 'fs';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const CORPUS = 'src/test-data/python/categories/edge-cases';
const BAR = path.join(CORPUS, 'EXPECTED_UNRESOLVED.json');
const OUT = '.open-edges-out';

interface Bar { count: number; note: string; cases: string[] }

function tsv(f: string): Record<string, string>[] {
  const fp = path.join(OUT, f);
  if (!fs.existsSync(fp)) return [];
  const L = fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean);
  if (!L.length) return [];
  const h = L[0]!.split('\t');
  return L.slice(1).map((l) => {
    const c = l.split('\t');
    return Object.fromEntries(h.map((k, i) => [k, c[i] ?? ''])) as Record<string, string>;
  });
}

export async function runOpenEdgesGate(accept = false): Promise<number> {
  fs.rmSync(OUT, { recursive: true, force: true });
  await new PythonProjectAnalyzer().analyze({
    rootDir: CORPUS, outputDir: OUT, baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });
  const mods = tsv('all-python-modules.csv');
  const fileOf = new Map(mods.map((m) => [m['pyModuleUniqueHash']!, m['filePath']!]));
  const open = tsv('all-python-call-sites.csv').filter((c) => {
    const f = fileOf.get(c['pyModuleLinkHash']!) ?? '';
    return f.includes('OPEN_') && !c['resolvedCalleeHash'] && c['resolvedCalleeKind'] !== 'BUILTIN';
  });
  const cases = open
    .map((c) => `L${c['startLine']} ${c['receiverKind']}.${c['calleeName']}()  recv=${c['receiverText']}`)
    .sort();

  if (accept || !fs.existsSync(BAR)) {
    fs.writeFileSync(BAR, JSON.stringify({
      count: cases.length,
      note: 'Locally resolvable in principle, not resolved yet. May fall, never rise. ' +
            'When a case starts resolving, move it to resolution_edges.py.',
      cases,
    } satisfies Bar, null, 1) + '\n');
    console.log(`bar set at ${cases.length} unresolved`);
    for (const c of cases) console.log('  ' + c);
    return 0;
  }

  const bar = JSON.parse(fs.readFileSync(BAR, 'utf-8')) as Bar;
  console.log(`open-edges ratchet — ${cases.length} unresolved, bar is ${bar.count}`);
  if (cases.length > bar.count) {
    const gained = cases.filter((c) => !bar.cases.includes(c));
    console.log('FAIL  REGRESSION — these stopped resolving:');
    for (const g of gained) console.log('  + ' + g);
    return 1;
  }
  if (cases.length < bar.count) {
    const fixed = bar.cases.filter((c) => !cases.includes(c));
    console.log('IMPROVED — these now resolve:');
    for (const f of fixed) console.log('  - ' + f);
    console.log('\nRun --accept to lower the bar and lock it in.');
    return 0;
  }
  console.log('PASS  unchanged');
  for (const c of cases) console.log('  still open: ' + c);
  return 0;
}

if (require.main === module) {
  runOpenEdgesGate(process.argv.includes('--accept')).then((c) => process.exit(c));
}
