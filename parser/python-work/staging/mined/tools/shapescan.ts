/**
 * Parent-relationship scan: tree shapes that a node-count differential cannot
 * see because the counts are identical and only the NESTING differs.
 *
 *  - inverted-splat: a `list_splat`/`dictionary_splat` nested INSIDE the
 *    attribute/call/subscript it should wrap.  CPython always makes Starred the
 *    outermost node of a starred postfix expression.
 *  - tier1/tier2: the shapes A3's Python-2 rejection keys on, so that a hit in
 *    a CPython-valid file is a false rejection.
 *
 * Usage: npx tsx shapescan.ts --files <list.txt> --out <out.jsonl>
 */
import * as fs from 'fs';

import { PythonParser } from '@/parsers/python/python-parser';

function arg(n: string): string | undefined {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const files = fs.readFileSync(arg('files')!, 'utf8').split('\n').filter(Boolean);
const out = arg('out')!;
const WRAPPERS = new Set(['attribute', 'call', 'subscript']);
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
  const hits: Array<{ rule: string; line: number; text: string }> = [];
  const cur = root.walk();
  let done = false;
  while (!done) {
    const node = cur.currentNode;
    const t = node.type;
    if (node.isNamed) {
      if ((t === 'list_splat' || t === 'dictionary_splat') && node.parent && WRAPPERS.has(node.parent.type)) {
        hits.push({ rule: 'inverted-splat', line: node.startPosition.row + 1, text: node.parent.text.slice(0, 60) });
      } else if (t === 'print_statement' || t === 'exec_statement' || t === 'chevron') {
        hits.push({ rule: 'tier1:' + t, line: node.startPosition.row + 1, text: node.text.slice(0, 60) });
      } else if (t === 'tuple_pattern' && node.parent && node.parent.type === 'parameters') {
        hits.push({ rule: 'tier2:tuple_pattern_in_parameters', line: node.startPosition.row + 1, text: node.text.slice(0, 60) });
      } else if (t === 'except_clause') {
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)!;
          if (c.type === ':') break;
          if (c.type === ',') { hits.push({ rule: 'tier2:except_comma_target', line: node.startPosition.row + 1, text: node.text.slice(0, 60) }); break; }
        }
      }
    }
    if (cur.gotoFirstChild()) continue;
    for (;;) {
      if (cur.gotoNextSibling()) break;
      if (!cur.gotoParent()) { done = true; break; }
    }
  }
  if (hits.length) buf.push(JSON.stringify({ file: f, nHits: hits.length, hits: hits.slice(0, 4) }));
  if (++n % 500 === 0) { fs.appendFileSync(out, buf.join('\n') + (buf.length ? '\n' : '')); buf = []; fs.writeSync(2, `${n}/${files.length}\n`); }
}
fs.appendFileSync(out, buf.join('\n') + (buf.length ? '\n' : ''));
fs.writeSync(2, `shapescan: ${n} files\n`);
process.exit(0);
