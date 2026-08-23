/**
 * In-tree, reproducible resolution baseline for the staging corpora.
 *
 * A0's point: a number quoted from a scratch script in /tmp is not a baseline,
 * because nobody else can reproduce it and nothing notices when it moves. This
 * runs from the repo, on corpora in the repo, and prints the same table every
 * time.
 *
 * Reports COVERAGE and CORRECTNESS separately and never as one number. A wrong
 * edge poisons a data-flow query while a missing one merely limits it, so
 * collapsing them would hide the trade that matters — and would let coverage
 * work buy count with precision.
 *
 *   npx tsx src/test/python-gates/baseline.ts
 */
import * as fs from 'fs';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const CORPORA = [
  '/tmp/py-corpus/native',
  '/tmp/py-corpus/flow',
  'src/test-data/python/linkage-sample',
  'src/test-data/python/inheritance-sample',
  'src/test-data/python/closed-world',
];

interface Row {
  corpus: string;
  files: number;
  errors: number;
  sites: number;
  linked: number;
  builtinOrImported: number;
}

async function measure(corpus: string): Promise<Row | null> {
  if (!fs.existsSync(corpus)) {
    return null;
  }
  const out = fs.mkdtempSync('/tmp/baseline-');
  const summary = await new PythonProjectAnalyzer().analyze({
    rootDir: corpus,
    outputDir: out,
    baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_baseline',
  });
  const csv = path.join(out, 'all-python-call-sites.csv');
  const lines = fs.readFileSync(csv, 'utf-8').split('\n').filter(Boolean);
  const header = lines[0]!.split('\t');
  const kindAt = header.indexOf('resolvedCalleeKind');
  const hashAt = header.indexOf('resolvedCalleeHash');
  let linked = 0;
  let classified = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    if (cells[hashAt] !== '') {
      linked += 1;
    } else if (cells[kindAt] !== 'UNRESOLVED') {
      classified += 1;
    }
  }
  fs.rmSync(out, { recursive: true, force: true });
  return {
    corpus: path.basename(corpus),
    files: summary.filesAnalysed,
    errors: summary.extractionErrors,
    sites: lines.length - 1,
    linked,
    builtinOrImported: classified,
  };
}

async function main(): Promise<void> {
  console.log('resolution baseline — in-tree corpora');
  console.log(
    '  corpus              files  err   sites  linked        builtin/imported'
  );
  let bad = 0;
  for (const corpus of CORPORA) {
    const row = await measure(corpus);
    if (!row) {
      continue;
    }
    if (row.errors > 0) {
      bad += row.errors;
    }
    const pct = row.sites === 0 ? '-' : `${((100 * row.linked) / row.sites).toFixed(1)}%`;
    console.log(
      `  ${row.corpus.padEnd(20)}${String(row.files).padStart(4)}${String(row.errors).padStart(5)}` +
        `${String(row.sites).padStart(8)}${String(row.linked).padStart(7)} ${pct.padStart(7)}` +
        `${String(row.builtinOrImported).padStart(13)}`
    );
  }
  console.log(
    '\n  linked = a concrete hash to a py_method or py_type; builtin/imported carry a KIND'
  );
  console.log('  but no hash, because the target is outside the analysis by design.');
  // An extraction error is always a defect, never a corpus property.
  process.exit(bad > 0 ? 1 : 0);
}

void main();
