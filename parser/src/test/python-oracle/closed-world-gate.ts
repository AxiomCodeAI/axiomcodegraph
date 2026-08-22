/**
 * CLOSED-WORLD RESOLUTION GATE
 *
 *     npx tsx src/test/python-oracle/closed-world-gate.ts
 *
 * Asserts that every call site in `src/test-data/python/closed-world` either
 * links to a declared entity or is a builtin. **The ceiling on that corpus is
 * exactly 100% by construction** — every callee is declared inside the directory,
 * there are no stdlib imports and no builtin receivers — so any unresolved call
 * is a parser defect, not a corpus artifact.
 *
 * That property is why this gate is worth having. On real code, a resolution rate
 * mostly reports what fraction of callees happen to live inside the analysis root:
 * `ctypes` scored 7.9% on SELF because 1,303 of its calls target
 * `unittest.TestCase`. A number like that cannot fail, because it was never a
 * claim about the parser.
 *
 * This gate exists as a gate rather than a written finding because a message has
 * to be read and a red build does not. See python-work/AGENT-PROTOCOL.md rule 3.
 */
import * as fs from 'fs';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const CORPUS = 'src/test-data/python/closed-world';
const OUT = path.join(process.cwd(), '.closed-world-out');

interface CallRow {
  receiverKind: string;
  calleeName: string;
  resolvedCalleeKind: string;
  resolvedCalleeHash: string;
  startLine: string;
  receiverText: string;
  [k: string]: string;
}

function readTsv(file: string): Record<string, string>[] {
  const raw = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  const hdr = raw[0]!.split('\t');
  return raw.slice(1).map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(hdr.map((h, i) => [h, cells[i] ?? '']));
  });
}

export async function runClosedWorldGate(): Promise<number> {
  fs.rmSync(OUT, { recursive: true, force: true });
  const summary = await new PythonProjectAnalyzer().analyze({
    rootDir: CORPUS,
    outputDir: OUT,
    baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });

  const failures: string[] = [];

  // An extractor crash is always a defect, never a decision.
  if (summary.extractionErrors > 0) {
    failures.push(`${summary.extractionErrors} file(s) threw in the extractor`);
  }
  if (summary.filesRejected > 0) {
    failures.push(`${summary.filesRejected} file(s) rejected — this corpus is all valid 3.10`);
  }

  const csv = path.join(OUT, 'all-python-call-sites.csv');
  if (!fs.existsSync(csv)) {
    console.log('FAIL closed-world gate: no call-site output produced');
    return 1;
  }
  const calls = readTsv(csv) as unknown as CallRow[];

  const unresolved = calls.filter(
    (c) => !c.resolvedCalleeHash && c.resolvedCalleeKind !== 'BUILTIN'
  );
  const linked = calls.filter((c) => c.resolvedCalleeHash).length;
  const builtin = calls.filter((c) => c.resolvedCalleeKind === 'BUILTIN').length;

  console.log('closed-world resolution gate  (ceiling is exactly 100%)');
  console.log(`  files      : ${summary.filesAnalysed} analysed, ${summary.extractionErrors} errors`);
  console.log(`  call sites : ${calls.length}`);
  console.log(`  linked     : ${linked} (${((100 * linked) / calls.length).toFixed(1)}%)`);
  console.log(`  builtin    : ${builtin}  (correctly unlinkable)`);
  console.log(`  UNRESOLVED : ${unresolved.length}`);

  if (unresolved.length) {
    // group by the mechanism that would fix them, so the output is a work list
    const byMechanism = new Map<string, CallRow[]>();
    for (const c of unresolved) {
      const m =
        c.receiverKind === 'NAME' ? 'local-variable typing'
        : c.receiverKind === 'CALL_RESULT' ? 'return-type flow'
        : c.receiverKind === 'ATTRIBUTE' ? 'attribute typing (often behind a local)'
        : c.receiverKind === 'NONE' && c.calleeName === 'cls' ? 'constructor-through-cls'
        : `${c.receiverKind} receiver`;
      (byMechanism.get(m) ?? byMechanism.set(m, []).get(m)!).push(c);
    }
    console.log('\n  every unresolved call is a parser defect here. Grouped by fix:');
    for (const [m, rows] of [...byMechanism].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n    ${m}  (${rows.length})`);
      for (const r of rows) {
        console.log(
          `      line ${String(r.startLine).padStart(3)}  ${r.receiverKind.padEnd(12)} ` +
            `${r.calleeName.padEnd(18)} recv=${JSON.stringify(r.receiverText).slice(0, 30)}`
        );
      }
    }
    failures.push(`${unresolved.length} unresolved call site(s)`);
  }

  console.log('');
  if (failures.length) {
    console.log('FAIL  ' + failures.join('; '));
    return 1;
  }
  console.log('PASS  every call site linked or correctly classified as builtin');
  return 0;
}

if (require.main === module) {
  runClosedWorldGate().then((c) => process.exit(c));
}
