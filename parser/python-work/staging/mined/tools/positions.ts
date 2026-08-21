/**
 * Position-level differential, one level finer than the count differential:
 * emits the (row, column) of every node of a chosen type, so a misparse that
 * preserves counts but moves or re-nests a construct still shows up.
 *
 * Columns are byte offsets on both sides (tree-sitter Point.column and
 * CPython's col_offset are both byte-based), so non-ASCII source compares
 * correctly.
 *
 * Usage: npx tsx positions.ts --files <list.txt> --out <out.jsonl>
 */
import * as fs from 'fs';

import { PythonParser } from '@/parsers/python/python-parser';

const WANT = new Set([
  'call', 'function_definition', 'class_definition', 'lambda', 'attribute',
  'subscript', 'decorator', 'keyword_argument', 'await', 'named_expression',
  'list_comprehension', 'set_comprehension', 'dictionary_comprehension',
  'generator_expression', 'return_statement', 'raise_statement', 'assert_statement',
  'global_statement', 'nonlocal_statement', 'delete_statement',
]);

function arg(n: string): string | undefined {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const files = fs.readFileSync(arg('files')!, 'utf8').split('\n').filter(Boolean);
const out = arg('out')!;
const parser = new PythonParser();
fs.writeFileSync(out, '');
let buf: string[] = [];
let n = 0;

for (const f of files) {
  let src: string;
  try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (!src) continue;
  let root;
  try { root = parser.parse(src).rootNode; } catch { continue; }
  if (root.hasError) continue;
  const pos: Record<string, number[][]> = {};
  const cur = root.walk();
  let done = false;
  while (!done) {
    const node = cur.currentNode;
    // isNamed matters: tree-sitter types an anonymous keyword token by its own
    // text, so the `await` and `lambda` KEYWORDS have node.type 'await' and
    // 'lambda' too.  Filtering on type alone double-counts every one of them.
    if (node.isNamed && WANT.has(node.type)) {
      (pos[node.type] ??= []).push([node.startPosition.row, node.startPosition.column]);
    }
    if (cur.gotoFirstChild()) continue;
    for (;;) {
      if (cur.gotoNextSibling()) break;
      if (!cur.gotoParent()) { done = true; break; }
    }
  }
  buf.push(JSON.stringify({ file: f, pos }));
  if (++n % 100 === 0) { fs.appendFileSync(out, buf.join('\n') + '\n'); buf = []; }
}
if (buf.length) fs.appendFileSync(out, buf.join('\n') + '\n');
fs.writeSync(2, `positions: ${n} files\n`);
process.exit(0);
