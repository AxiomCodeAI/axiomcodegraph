/**
 * Extract ONE directory. The unit every repro and every fixture tree is run through.
 *
 *     npx tsx tools/javascript/sweep-one.ts <dir> <out-dir>
 *
 * Run from the checkout being MEASURED.
 */
import { JavaScriptProjectAnalyzer } from '@/workflows/javascript/javascript-project-analyzer';

const [, , root, out] = process.argv;
if (!root || !out) {
  console.error('usage: sweep-one.ts <dir> <out-dir>');
  process.exit(1);
}
void new JavaScriptProjectAnalyzer()
  .analyze({ rootDir: root, outputDir: out, baseMservPath: root, serviceVersionLink: 'repro' })
  .then((s) => console.log(JSON.stringify({
    files: s.filesAnalysed, seen: s.filesSeen, bundled: s.bundledFilesExcluded,
    err: s.extractionErrors, counts: s.counts,
  }, null, 1)));
