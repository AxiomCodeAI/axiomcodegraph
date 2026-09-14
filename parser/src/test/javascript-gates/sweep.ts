/**
 * Run the parser over every corpus member, one at a time, into one dir per member.
 *
 *     npx tsx src/test/javascript-gates/sweep.ts <corpus-root> <out-dir> [name-filter]
 *
 * Run from the checkout being MEASURED (a pushed js-impl commit), not from this
 * one — `@/` resolves against the cwd's tsconfig.
 *
 * ## Why per member and not one run
 *
 * §10 of BUILDING-A-PARSER.md: the fact base is held in memory until the run
 * ends, ~190x the source size. One run over 4,500 files needs tens of GB. Per
 * member also gives row attribution for free, which is what every stratum table
 * downstream is built on.
 *
 * ## This is checked in because losing it cost a sweep
 *
 * It lived in a session scratchpad, and `/tmp` was cleared by another agent
 * recovering from ENOSPC. The analysis tools beside it survived because they were
 * checked in; the driver did not, and the sweep could not start.
 */
import * as fs from 'fs';
import * as path from 'path';
import { JavaScriptProjectAnalyzer } from '@/workflows/javascript/javascript-project-analyzer';

const [, , ROOT, OUT, only] = process.argv;
if (!ROOT || !OUT) {
  console.error('usage: sweep.ts <corpus-root> <out-dir> [name-filter]');
  process.exit(1);
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT!, { recursive: true });
  const members: string[] = [];
  for (const d of fs.readdirSync(ROOT!).sort()) {
    const dd = path.join(ROOT!, d);
    if (!fs.statSync(dd).isDirectory()) { continue; }
    for (const p of fs.readdirSync(dd).sort()) {
      if (fs.statSync(path.join(dd, p)).isDirectory()) { members.push(`${d}/${p}`); }
    }
  }
  if (members.length === 0) {
    console.error(`no <stratum>/<package> directories under ${ROOT} — the sweep would report a clean `
      + 'run over nothing, which is the most expensive kind of null result');
    process.exit(1);
  }
  const summaries: Record<string, unknown> = {};
  for (const m of members) {
    if (only !== undefined && !m.includes(only)) { continue; }
    const outDir = path.join(OUT!, m.replace('/', '__'));
    fs.mkdirSync(outDir, { recursive: true });
    const t0 = Date.now();
    let summary: unknown;
    try {
      summary = await new JavaScriptProjectAnalyzer().analyze({
        rootDir: path.join(ROOT!, m),
        outputDir: outDir,
        baseMservPath: path.join(ROOT!, m),
        serviceVersionLink: 'sweep',
      });
    } catch (error) {
      summary = { THREW: (error as Error).message, stack: (error as Error).stack?.split('\n').slice(0, 6) };
    }
    const s = summary as Record<string, unknown> & { counts?: Record<string, number> };
    summaries[m] = summary;
    const rows = s.counts ? Object.values(s.counts).reduce((a, b) => a + b, 0) : (s.THREW ?? '-');
    console.log(`${m.padEnd(22)} files=${s.filesAnalysed ?? '-'}/${s.filesSeen ?? '-'} `
      + `bundled=${s.bundledFilesExcluded ?? '-'} err=${s.extractionErrors ?? '-'} `
      + `rows=${rows} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  fs.writeFileSync(path.join(OUT!, '_summaries.json'), JSON.stringify(summaries, null, 1));
}
void main();
