/**
 * Run Python extraction over a directory and write the fact CSVs plus a
 * human-readable SUMMARY.md next to them.
 *
 *   npx tsx python-work/run-extraction.ts <sourceDir> [outputName]
 *
 * Output goes to analysis-results/python/<outputName>/ (gitignored).
 * Defaults outputName to the basename of sourceDir.
 *
 * This exists because Python is not yet wired into extractProject(); the proper
 * fix is to register it there alongside the Java/XML/YAML/Properties analyzers.
 */
import * as fs from 'fs/promises';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

type Row = Record<string, string>;

async function readCsv(file: string): Promise<Row[]> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf-8');
  } catch {
    return [];
  }
  const lines = text.split('\n').filter(l => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0]!.split('\t');
  return lines.slice(1).map(l => {
    const cells = l.split('\t');
    const row: Row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ''));
    return row;
  });
}

async function main(): Promise<void> {
  const [sourceDir, nameArg] = process.argv.slice(2);
  if (!sourceDir) {
    console.error('usage: npx tsx python-work/run-extraction.ts <sourceDir> [outputName]');
    process.exit(1);
  }
  const root = path.resolve(sourceDir);
  const name = nameArg || path.basename(root);
  const outputDir = path.resolve('analysis-results', 'python', name);
  await fs.mkdir(outputDir, { recursive: true });

  const summary = await new PythonProjectAnalyzer().analyze({
    rootDir: root,
    outputDir,
    baseMservPath: root,
    serviceVersionLinkHash: `svl_${name}`,
  });

  // --- referential integrity, computed from the emitted CSVs themselves ---
  const files = (await fs.readdir(outputDir)).filter(f => f.endsWith('.csv'));
  const byFile = new Map<string, Row[]>();
  for (const f of files) byFile.set(f, await readCsv(path.join(outputDir, f)));

  const primaryKeys = new Set<string>();
  for (const rows of byFile.values())
    for (const r of rows)
      for (const [k, v] of Object.entries(r))
        if (k.endsWith('UniqueHash') && v) primaryKeys.add(v);

  const orphans: Record<string, number> = {};
  let fkChecked = 0;
  for (const [f, rows] of byFile)
    for (const r of rows)
      for (const [k, v] of Object.entries(r))
        if (k.endsWith('LinkHash') && v && !k.startsWith('serviceVersion')) {
          fkChecked++;
          if (!primaryKeys.has(v)) orphans[`${f}:${k}`] = (orphans[`${f}:${k}`] ?? 0) + 1;
        }

  // --- resolution rate per receiverKind ---
  const calls = byFile.get('all-python-call-sites.csv') ?? [];
  const perKind = new Map<string, { resolved: number; total: number }>();
  for (const c of calls) {
    const k = c['receiverKind'] || '(none)';
    const e = perKind.get(k) ?? { resolved: 0, total: 0 };
    e.total++;
    if (c['resolvedCalleeHash']) e.resolved++;
    perKind.set(k, e);
  }
  const bases = byFile.get('all-python-type-bases.csv') ?? [];
  const basesResolved = bases.filter(b => b['resolvedTypeLinkHash']).length;

  const pct = (a: number, b: number) => (b === 0 ? '-' : `${((100 * a) / b).toFixed(1)}%`);
  const lines: string[] = [
    `# Python extraction — ${name}`,
    '',
    `Source: \`${root}\``,
    '',
    '## Files',
    '',
    `| | |`,
    `|---|---|`,
    `| seen | ${summary.filesSeen} |`,
    `| analysed | ${summary.filesAnalysed} |`,
    `| rejected | ${summary.filesRejected} |`,
    '',
    '## Rows per relation',
    '',
    '| relation | rows |',
    '|---|---|',
    ...Object.entries(summary.counts).map(([k, v]) => `| \`${k}\` | ${v} |`),
    '',
    '## Resolution',
    '',
    '| receiverKind | resolved | rate |',
    '|---|---|---|',
    ...[...perKind.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([k, e]) => `| ${k} | ${e.resolved}/${e.total} | ${pct(e.resolved, e.total)} |`),
    `| **all call sites** | **${calls.filter(c => c['resolvedCalleeHash']).length}/${calls.length}** | **${pct(calls.filter(c => c['resolvedCalleeHash']).length, calls.length)}** |`,
    `| \`py_type_base\` | ${basesResolved}/${bases.length} | ${pct(basesResolved, bases.length)} |`,
    '',
    '## Referential integrity',
    '',
    `- primary keys: ${primaryKeys.size}`,
    `- foreign-key references checked: ${fkChecked}`,
    `- orphaned foreign keys: ${Object.keys(orphans).length === 0 ? '**0**' : JSON.stringify(orphans)}`,
    '',
    '## Files written',
    '',
    ...files.sort().map(f => `- \`${f}\` — ${(byFile.get(f) ?? []).length} rows`),
    '',
  ];
  await fs.writeFile(path.join(outputDir, 'SUMMARY.md'), lines.join('\n'), 'utf-8');

  console.log(`\n${outputDir}`);
  console.log(`  ${files.length} CSVs + SUMMARY.md`);
  console.log(`  call sites resolved: ${calls.filter(c => c['resolvedCalleeHash']).length}/${calls.length}`);
  console.log(`  orphaned FKs: ${Object.keys(orphans).length === 0 ? 0 : JSON.stringify(orphans)}`);
}

main().catch(e => {
  console.error('failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
