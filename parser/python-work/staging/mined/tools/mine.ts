/**
 * A4 corpus miner — node-type coverage sweep over real Python corpora.
 *
 * Parses every .py file under a root through A3's PythonParser (never
 * tree-sitter directly: PythonParser owns the 32,767-char parse ceiling, and
 * bypassing it silently drops the largest file in every package).
 *
 * Parse failure is detected via rootNode.hasError, NOT via a thrown exception:
 * tree-sitter recovers from syntax errors and returns a tree with ERROR nodes.
 *
 * Usage:
 *   npx tsx python-work/staging/mined/tools/mine.ts --corpus <name> --root <dir> \
 *        --out <file.jsonl> [--limit N] [--exclude a,b,c]
 */
import * as fs from 'fs';
import * as path from 'path';

import { PythonParser } from '@/parsers/python/python-parser';

function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const corpus = arg('corpus', 'unnamed')!;
const roots = (arg('root') ?? '').split(',').filter(Boolean);
const out = arg('out')!;
const limit = Number(arg('limit', String(Number.MAX_SAFE_INTEGER)));
const exclude = new Set((arg('exclude', '__pycache__,.git,node_modules,.tox,.venv') ?? '').split(',').filter(Boolean));

function walk(dir: string, acc: string[]): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (!exclude.has(e.name)) walk(p, acc);
    } else if (e.isFile() && e.name.endsWith('.py')) {
      acc.push(p);
    }
  }
  return acc;
}

const parser = new PythonParser();
// The whole sweep is one synchronous loop, so an async write stream would
// buffer everything in memory and flush only at exit -- no progress, and a
// killed run leaves nothing. Batch synchronous appends instead.
fs.writeFileSync(out, '');
let pending: string[] = [];
function emit(rec: unknown): void {
  pending.push(JSON.stringify(rec));
  if (pending.length >= 200) flush();
}
function flush(): void {
  if (pending.length === 0) return;
  fs.appendFileSync(out, pending.join('\n') + '\n');
  pending = [];
}

let files: string[] = [];
for (const r of roots) {
  const st = fs.statSync(r);
  if (st.isDirectory()) walk(r, files);
  else files.push(r);
}
files.sort();
if (files.length > limit) files = files.slice(0, limit);

let nOk = 0;
let nErr = 0;
let nThrow = 0;
let nSeen = 0;

for (const f of files) {
  let src: string;
  try {
    src = fs.readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  if (src.length === 0) {
    emit({ corpus, file: f, chars: 0, empty: true, types: {} });
    continue;
  }
  const rec: Record<string, unknown> = { corpus, file: f, chars: src.length, bytes: Buffer.byteLength(src) };
  try {
    const tree = parser.parse(src);
    const root = tree.rootNode;
    const types: Record<string, number> = {};
    const firstAt: Record<string, number> = {};
    const errors: Array<{ type: string; line: number }> = [];
    // Iterative cursor walk; recursion blows the stack on deeply-nested reals.
    const cursor = root.walk();
    let done = false;
    while (!done) {
      const n = cursor.currentNode;
      if (n.isNamed) {
        const t = n.type;
        types[t] = (types[t] ?? 0) + 1;
        if (firstAt[t] === undefined) firstAt[t] = n.startPosition.row + 1;
      }
      if (n.type === 'ERROR' || n.isMissing) {
        if (errors.length < 5) errors.push({ type: n.isMissing ? 'MISSING:' + n.type : 'ERROR', line: n.startPosition.row + 1 });
      }
      if (cursor.gotoFirstChild()) continue;
      for (;;) {
        if (cursor.gotoNextSibling()) break;
        if (!cursor.gotoParent()) { done = true; break; }
      }
    }
    rec.hasError = root.hasError;
    rec.types = types;
    rec.firstAt = firstAt;
    if (root.hasError) { rec.errors = errors; nErr++; } else nOk++;
  } catch (e) {
    rec.threw = String((e as Error).message).slice(0, 200);
    rec.types = {};
    nThrow++;
  }
  emit(rec);
  if (++nSeen % 500 === 0) fs.writeSync(2, `[${corpus}] ${nSeen}/${files.length}\n`);
}
flush();
fs.writeSync(2, `[${corpus}] files=${files.length} clean=${nOk} hasError=${nErr} threw=${nThrow}\n`);
// The tree-sitter native binding keeps a handle open, so the process does not
// exit on its own after a large sweep.  Everything is flushed by here.
process.exit(0);
