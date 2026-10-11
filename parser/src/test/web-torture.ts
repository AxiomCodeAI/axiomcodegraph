/**
 * WEB TORTURE — is the HTML/CSS IR valid, correct, and does it carry the join keys?
 *
 *     npx tsx src/test/web-torture.ts            # run every check, exit 1 on a DEFECT
 *     npx tsx src/test/web-torture.ts --keep     # keep the IR directory for inspection
 *     npx tsx src/test/web-torture.ts --only css # run the checks whose name contains "css"
 *
 * The parser's contract is "emit facts an engine can join". This suite is the fact-side
 * half of that contract: it runs the real analyzer over `src/test-data/web/torture`, a
 * tree written to hold every edge case a web project throws at a static reader, loads
 * the relations back, and asserts — in plain TypeScript, no engine — that each case
 * produced the rows, columns and keys the documented joins need:
 *
 *   html_reference.resolvedFilePath  = css_stylesheet.filePath / html_document.filePath
 *   css_value_reference (IMPORT)     = css_stylesheet.filePath            (the @import closure)
 *   html_class_reference.className   = css_selector_part.name (CLASS)     (escapes decoded)
 *   html_element.id / tagName        = css_selector_part.name (ID / TYPE)
 *   css_value_reference.name         = css_declaration.property / css_rule.name
 *   html_attribute (FOR, ID_REFERENCE, ARIA, NAME, fragment hrefs) = html_element.id
 *
 * Every check carries a verdict for when it fails:
 *   DEFECT  the IR is wrong or missing something the parser could have read — fails the run
 *   GAP     the IR cannot yet express it (a grammar limit or an unmodelled construct) — reported
 *   LIMIT   nothing static can know this — reported, so the list of impossibles is explicit
 *
 * `web-tests.ts` is the specification suite with its golden; this file is the adversary.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { WEB_CSV_FILES } from '@/constants/web-constants';
import { WebProjectAnalyzer } from '@/workflows/web/web-project-analyzer';

import { CHECKS, PROBES } from './web-torture-checks';
import { Check, Ir, Row, Verdict } from './web-torture-ir';

const ROOT = path.resolve('src/test-data/web/torture');
const KEEP = process.argv.includes('--keep');
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] ?? '' : '';

async function analyse(outputDir: string): Promise<void> {
  const silence = console.log;
  console.log = () => {};
  try {
    await new WebProjectAnalyzer(outputDir).analyzeWebFiles(
      [{ name: 'torture', path: ROOT, language: 'UNKNOWN' as never, hasSourceFiles: false }],
      'WEB_TORTURE_VERSION'
    );
  } finally {
    console.log = silence;
  }
}

function tsv(fp: string): Row[] {
  if (!fs.existsSync(fp)) return [];
  const lines = fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean);
  if (lines.length === 0) return [];
  const head = lines[0]!.split('\t');
  return lines.slice(1).map((l) => {
    const cells = l.split('\t').map(unquote);
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])) as Row;
  });
}

/** The parser quotes a cell holding a quote and doubles the inner ones (RFC 4180). */
function unquote(cell: string): string {
  return cell.length >= 2 && cell.startsWith('"') && cell.endsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
}

async function main(): Promise<number> {
  const irDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-web-torture-'));
  const t0 = Date.now();
  await analyse(irDir);
  console.log(`── analyzer: ${((Date.now() - t0) / 1000).toFixed(2)}s over ${path.relative(process.cwd(), ROOT)}`);
  const tables: Record<string, Row[]> = {};
  for (const [key, file] of Object.entries(WEB_CSV_FILES)) {
    tables[key] = tsv(path.join(irDir, file));
    if (tables[key]!.length > 0) console.log(`   ${file.padEnd(36)} ${String(tables[key]!.length).padStart(6)} rows`);
  }
  const ir = new Ir(ROOT, tables);

  let defects = 0;
  let ran = 0;
  const findings: Array<{ verdict: Verdict; name: string; detail: string; note?: string }> = [];
  const run = (label: string, checks: Check[]): void => {
    console.log(`\n── ${label}`);
    for (const c of checks) {
      if (ONLY !== '' && !c.name.includes(ONLY)) continue;
      ran += 1;
      const failures: string[] = [];
      try {
        c.run(ir, (m) => failures.push(m));
      } catch (e) {
        failures.push(`threw ${e instanceof Error ? e.message : String(e)}`);
      }
      if (failures.length === 0) {
        console.log(`  ✓ ${c.name}`);
        continue;
      }
      if (c.verdict === 'DEFECT') {
        defects += 1;
        console.log(`  ✗ ${c.name}`);
        for (const f of failures) console.log(`      ${f}`);
      } else {
        console.log(`  ${c.verdict === 'GAP' ? '◌' : '○'} ${c.name}  [${c.verdict}]`);
        findings.push({ verdict: c.verdict, name: c.name, detail: failures.join('; '), note: c.note });
      }
    }
  };
  run('IR over the torture tree', CHECKS);
  run('probes (the parsers on micro-inputs)', PROBES);

  if (findings.length > 0) {
    console.log('\n── findings: what the IR does not yet carry (GAP) or no static reader can (LIMIT)');
    for (const f of findings) {
      console.log(`  [${f.verdict}] ${f.name}\n      ${f.detail}${f.note ? `\n      → ${f.note}` : ''}`);
    }
  }
  if (KEEP) console.log(`\nIR kept at ${irDir}`);
  else fs.rmSync(irDir, { recursive: true, force: true });
  console.log(defects === 0 ? `\nOK  ${ran} check(s), ${findings.length} finding(s)` : `\nFAIL  ${defects} defect(s) in ${ran} check(s), ${findings.length} finding(s)`);
  return defects === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(2); });
