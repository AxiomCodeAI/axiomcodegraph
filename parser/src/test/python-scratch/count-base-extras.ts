import * as fs from 'fs';
import * as path from 'path';
import { PythonParser } from '@/parsers/python/python-parser';
function walk(d: string, out: string[]): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['__pycache__','.git','node_modules'].includes(e.name)) walk(p, out); }
    else if (e.name.endsWith('.py')) out.push(p);
  }
  return out;
}
const parser = new PythonParser();
const files = walk(process.argv[2]!, []).sort();
let filesHit = 0, sites = 0;
const examples: string[] = [];
for (const f of files) {
  let tree;
  try { tree = parser.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  let hit = false;
  const stack = [tree.rootNode];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === 'argument_list' && n.parent?.type === 'class_definition') {
      for (let i = 0; i < n.namedChildCount; i++) {
        if (n.namedChild(i)?.isExtra) {
          sites++; hit = true;
          if (examples.length < 5) examples.push(`${path.relative(process.argv[2]!, f)}:${n.startPosition.row + 1}`);
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i)!);
  }
  if (hit) filesHit++;
}
console.log(`files with an extra inside a base list: ${filesHit} of ${files.length}   sites: ${sites}`);
examples.forEach(e => console.log('  ' + e));
