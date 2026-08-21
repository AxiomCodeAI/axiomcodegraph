import * as fs from 'fs';
import * as path from 'path';
import { diffFile } from './diff-oracle';

function walk(dir: string, out: string[]): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['__pycache__','.git','node_modules','test','tests','lib2to3'].includes(e.name)) walk(p, out); }
    else if (e.name.endsWith('.py')) out.push(p);
  }
  return out;
}
const filter = process.argv[3] ?? '';
const files = walk(process.argv[2]!, []).sort();
const hits: string[] = [];
for (const f of files) {
  try {
    const r = diffFile(f);
    for (const p of r.problems) if (!filter || p.includes(filter)) hits.push(`${f}: ${p}`);
  } catch { /* counted elsewhere */ }
  if (hits.length > 30) break;
}
hits.slice(0, 30).forEach(h => console.log(h));
