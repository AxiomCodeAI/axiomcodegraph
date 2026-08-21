/**
 * End-to-end rejection: a Python 2 file must contribute ZERO facts, and must be
 * named in skipped-python-files.csv with the construct that caused it.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const OUT = '/tmp/pyout-reject';

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const summary = await new PythonProjectAnalyzer().analyze({
    rootDir: '/tmp/pyreject', outputDir: OUT,
    baseMservPath: '/repo', serviceVersionLinkHash: 'SERVICE_VERSION_test',
  });
  console.log(`seen ${summary.filesSeen}  analysed ${summary.filesAnalysed}  rejected ${summary.filesRejected}`);

  let failures = 0;
  const check = (label: string, ok: boolean, extra = '') => {
    if (!ok) failures++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
  };

  check('3 files rejected', summary.filesRejected === 3);
  check('2 files analysed', summary.filesAnalysed === 2);
  check('py_module rows == analysed', summary.counts.py_module === summary.filesAnalysed,
    `${summary.counts.py_module} vs ${summary.filesAnalysed}`);

  const skipped = fs.readFileSync(path.join(OUT, 'skipped-python-files.csv'), 'utf8');
  console.log('\nskipped-python-files.csv:');
  skipped.trim().split('\n').forEach(l => console.log('  ' + l));

  for (const name of ['py2_print.py', 'py2_except.py', 'py2_backtick.py']) {
    check(`${name} recorded as skipped`, skipped.includes(name));
  }
  check('reason is PY2_CONSTRUCT_DETECTED',
    (skipped.match(/PY2_CONSTRUCT_DETECTED/g) ?? []).length === 3);

  // The load-bearing assertion: no Py2 node type may appear in any emitted FACT.
  // The skipped-files CSV is excluded deliberately — naming the offending
  // construct there is the entire point of the audit record, so scanning it too
  // would assert against the feature.
  const all = fs.readdirSync(OUT)
    .filter(f => f !== 'skipped-python-files.csv')
    .map(f => fs.readFileSync(path.join(OUT, f), 'utf8'))
    .join('\n');
  for (const t of ['print_statement', 'exec_statement', 'chevron']) {
    check(`no "${t}" anywhere in emitted facts`, !all.includes(t));
  }
  for (const name of ['py2_print', 'py2_except', 'py2_backtick']) {
    const inFacts = fs.readdirSync(OUT)
      .filter(f => f !== 'skipped-python-files.csv')
      .some(f => fs.readFileSync(path.join(OUT, f), 'utf8').includes(name));
    check(`no fact rows from ${name}.py`, !inFacts);
  }
  console.log(failures === 0 ? '\nall rejection assertions pass' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})();
