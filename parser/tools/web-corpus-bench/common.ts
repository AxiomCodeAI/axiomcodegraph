import * as fs from 'fs';
import * as path from 'path';

export interface Case { id: string; file: string; root: string; content: string; corpus: string; fragmentContext?: string; scriptingOff?: boolean }

export type Counter = Map<string, number>;
export const inc = (c: Counter, k: string, n = 1): void => { c.set(k, (c.get(k) ?? 0) + n); };
export const total = (c: Counter): number => { let t = 0; for (const v of c.values()) t += v; return t; };
/** Entries where a and b differ, as {key: a-b}, capped. */
export function diff(a: Counter, b: Counter, cap = 40): Record<string, number> {
  const out: Record<string, number> = {};
  const keys = new Set([...a.keys(), ...b.keys()]);
  let n = 0;
  for (const k of keys) {
    const d = (a.get(k) ?? 0) - (b.get(k) ?? 0);
    if (d !== 0) { out[k] = d; if (++n >= cap) break; }
  }
  return out;
}
export const toObj = (c: Counter): Record<string, number> => Object.fromEntries(c);

export function walkFiles(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, exts, out);
    else if (exts.includes(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

export function* fileCases(corpus: string, root: string, exts: string[], maxBytes = 50_000_000): Generator<Case> {
  for (const file of walkFiles(root, exts).sort()) {
    const st = fs.statSync(file);
    if (st.size > maxBytes) continue;
    let content: string;
    try { content = fs.readFileSync(file, 'utf-8'); } catch { continue; }
    yield { id: path.relative(root, file), file, root, content, corpus };
  }
}

/** html5lib tree-construction .dat files: one case per `#data` section. */
export function* datCases(corpus: string, root: string): Generator<Case> {
  for (const file of walkFiles(root, ['.dat']).sort()) {
    const text = fs.readFileSync(file, 'utf-8');
    const lines = text.split('\n');
    let i = 0;
    while (i < lines.length) {
      if (lines[i] !== '#data') { i += 1; continue; }
      const startLine = i + 1;
      i += 1;
      const data: string[] = [];
      while (i < lines.length && !/^#(errors|new-errors|document|document-fragment|script-on|script-off)$/.test(lines[i]!)) { data.push(lines[i]!); i += 1; }
      let fragmentContext: string | undefined;
      let scriptingOff = false;
      while (i < lines.length && lines[i] !== '#data') {
        if (lines[i] === '#document-fragment') { fragmentContext = lines[i + 1]?.trim(); }
        if (lines[i] === '#script-off') scriptingOff = true;
        i += 1;
      }
      // the data block ends before the newline preceding '#errors'
      const content = data.join('\n');
      yield { id: `${path.relative(root, file)}:${startLine}`, file: `${file}.${startLine}.html`, root, content, corpus, fragmentContext, scriptingOff };
    }
  }
}

export class Jsonl {
  private readonly fd: number;
  constructor(file: string) { fs.mkdirSync(path.dirname(file), { recursive: true }); this.fd = fs.openSync(file, 'w'); }
  write(obj: unknown): void { fs.writeSync(this.fd, JSON.stringify(obj) + '\n'); }
  close(): void { fs.closeSync(this.fd); }
}

export const nonWs = (s: string): number => s.replace(/\s+/g, '').length;
export const sample = <T>(arr: T[], n = 5): T[] => arr.slice(0, n);

export function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
export const flag = (name: string): boolean => process.argv.includes(`--${name}`);
