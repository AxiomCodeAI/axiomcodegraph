import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import { PythonParser } from '@/parsers/python/python-parser';

const raw = new Parser();
raw.setLanguage(Python);
const ours = new PythonParser();

function gen(chars: number): string {
  let s = '';
  let i = 0;
  while (s.length < chars) { s += `def f_${i}(a, b):\n    return a + b\n`; i++; }
  return s.slice(0, chars);
}

for (const n of [32766, 32767, 32768, 40000, 200000]) {
  const src = gen(n) + '\n';
  let direct = 'ok';
  try {
    const t = raw.parse(src);
    direct = `ok(rootEnd=${t.rootNode.endIndex})`;
  } catch (e: any) { direct = 'THROW: ' + e.message.slice(0, 40); }

  let viaOurs = 'ok';
  try {
    const t = ours.parse(src);
    const covered = t.rootNode.endIndex >= src.length - 1;
    viaOurs = `ok(covers=${covered}, defs=${t.rootNode.namedChildCount})`;
  } catch (e: any) { viaOurs = 'THROW: ' + e.message.slice(0, 40); }

  console.log(`len=${String(src.length).padEnd(7)} direct=${direct.padEnd(28)} PythonParser=${viaOurs}`);
}

// CJK: characters vs bytes — 29k chars is 87k UTF-8 bytes and must still parse.
const cjk = 'x = "' + '漢'.repeat(29000) + '"\n';
const bytes = Buffer.byteLength(cjk, 'utf8');
const t = ours.parse(cjk);
console.log(`\nCJK chars=${cjk.length} bytes=${bytes} parsed hasError=${t.rootNode.hasError}`);
