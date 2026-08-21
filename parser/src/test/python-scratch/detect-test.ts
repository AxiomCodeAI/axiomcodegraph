import { PythonParser } from '@/parsers/python/python-parser';
import { PythonDialectDetector } from '@/parsers/python/python-dialect-detector';

const parser = new PythonParser();
const detector = new PythonDialectDetector();

const cases: [string, string][] = [
  ['py2 print', 'print "x"\n'],
  ['py2 chevron', 'print >>sys.stderr, "x"\n'],
  ['py2 exec', 'exec "code"\n'],
  ['py2 except comma', 'try:\n    pass\nexcept E, e:\n    pass\n'],
  ['py2 tuple param', 'def f((a, b)):\n    return a\n'],
  ['py2 backtick', 'x = `repr(y)`\n'],
  ['py3 print call', 'print("x")\n'],
  ['py3 tuple assign', '(a, b) = x\n'],
  ['py3 except as', 'try:\n    pass\nexcept E as e:\n    pass\n'],
  ['py3 tuple except', 'try:\n    pass\nexcept (A, B):\n    pass\n'],
  ['py3 backtick in docstring', '"""see `foo` for details"""\nx = 1\n'],
  ['py3 backtick in comment', '# use `x` here\nx = 1\n'],
  ['py3 for tuple target', 'for (a, b) in items:\n    pass\n'],
  ['py3 lambda', 'f = lambda a, b: a\n'],
  ['py3 except star', 'try:\n    pass\nexcept* E:\n    pass\n'],
];

let fails = 0;
for (const [name, src] of cases) {
  const tree = parser.parse(src);
  const res = detector.detect(tree.rootNode, src);
  const expectRejected = name.startsWith('py2');
  const rejected = res.dialect === 'PY2_DETECTED_REJECTED';
  const ok = rejected === expectRejected;
  if (!ok) fails++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} ${res.dialect.padEnd(24)} ` +
      res.findings.map(f => `${f.construct}@${f.startLine}:${f.startColumn}(t${f.tier})`).join(' ')
  );
}
console.log(fails === 0 ? '\nall detector cases pass' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
