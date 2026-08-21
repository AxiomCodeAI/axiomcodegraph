/**
 * End-to-end: run the analyzer twice over a real package and require the CSV
 * bytes to be identical. This is Appendix B invariant #5 at the FILE level,
 * which is where it actually has to hold.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

async function run(outDir: string, rootDir: string) {
  fs.rmSync(outDir, { recursive: true, force: true });
  const summary = await new PythonProjectAnalyzer().analyze({
    rootDir, outputDir: outDir, baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_test',
  });
  return summary;
}

function digestDir(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of fs.readdirSync(dir).sort()) {
    const buf = fs.readFileSync(path.join(dir, f));
    out.set(f, crypto.createHash('md5').update(buf).digest('hex') + ` (${buf.length}b)`);
  }
  return out;
}

(async () => {
  const rootDir = process.argv[2] ?? 'python-work/staging/native';
  const a = await run('/tmp/pyout-a', rootDir);
  const b = await run('/tmp/pyout-b', rootDir);

  console.log(`files seen ${a.filesSeen}, analysed ${a.filesAnalysed}, rejected ${a.filesRejected}`);
  console.log('\nrow counts:');
  for (const [k, v] of Object.entries(a.counts)) console.log(`  ${k.padEnd(22)} ${v}`);

  const da = digestDir('/tmp/pyout-a'), db = digestDir('/tmp/pyout-b');
  console.log('\nCSV digests:');
  let diverged = 0;
  for (const [f, h] of da) {
    const same = db.get(f) === h;
    if (!same) diverged++;
    console.log(`  ${same ? 'IDENTICAL' : 'DIVERGED '} ${f.padEnd(34)} ${h}`);
  }
  // Header count must equal the frozen arity on every file.
  const arity: Record<string, number> = {
    'all-python-modules.csv': 24, 'all-python-scopes.csv': 25, 'all-python-bindings.csv': 29,
    'all-python-types.csv': 25, 'all-python-type-bases.csv': 16, 'all-python-methods.csv': 36,
    'all-python-method-parameters.csv': 22, 'all-python-imports.csv': 24,
    'all-python-expressions.csv': 35, 'all-python-call-sites.csv': 26,
  };
  console.log('\nheader arity:');
  for (const [f, want] of Object.entries(arity)) {
    const content = fs.readFileSync(path.join('/tmp/pyout-a', f), 'utf8');
    const cols = content.split('\n')[0]!.split('\t').length;
    const ok = content === '' || cols === want;
    if (!ok) diverged++;
    console.log(`  ${ok ? 'OK  ' : 'BAD '} ${f.padEnd(34)} ${cols} cols (want ${want})`);
  }
  console.log(diverged === 0 ? '\nbyte-identical and arity-correct' : `\n${diverged} PROBLEMS`);
  process.exit(diverged === 0 ? 0 : 1);
})();
