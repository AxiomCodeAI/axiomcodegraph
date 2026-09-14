/**
 * The extended tables: every relation the language's export manifest names, exactly as the
 * rules emit it, plus the documentation that exists for it — the comment block above the
 * rule that derives it. Lifted verbatim, never paraphrased: if the comment is wrong the
 * catalog is wrong in the same way, and fixing the comment fixes both.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface ExtRelation {
  relation: string;
  /** basename in raw/ */
  file: string;
  arity: number;
  /** the doc comment lifted from the rule set, or a fallback naming the file that was searched */
  description: string;
}

/** relation<TAB>file per line; comments and blanks skipped. */
export function readManifest(langDir: string): { relation: string; file: string }[] {
  const p = path.join(langDir, 'souffle', 'export_manifest.tsv');
  const out: { relation: string; file: string }[] = [];
  const seen = new Set<string>();
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    const [relation, file] = line.split('\t');
    if (!relation || !file || seen.has(relation)) continue;
    seen.add(relation);
    out.push({ relation, file });
  }
  return out;
}

/** relation<TAB>basename per line (lib.map / client-ir.map) → basename → relation. */
export function readLibMap(langDir: string): Map<string, string> {
  const p = path.join(langDir, 'templates', 'lib.map');
  const out = new Map<string, string>();
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    const [relation, base] = line.split('\t');
    if (relation && base) out.set(base, relation);
  }
  return out;
}

function dlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...dlFiles(p));
    else if (e.name.endsWith('.dl')) out.push(p);
  }
  return out.sort();
}

/** Arity from `.decl name(c0:…, …)` in the generated declarations. */
function arities(langDir: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of ['decls_all.dl', 'decls_base.dl']) {
    const p = path.join(langDir, 'souffle', f);
    if (!fs.existsSync(p)) continue;
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/^\s*\.decl\s+(\w+)\s*\(([^)]*)\)/gm)) {
      if (!out.has(m[1]!)) out.set(m[1]!, m[2]!.trim() === '' ? 0 : m[2]!.split(',').length);
    }
  }
  return out;
}

/**
 * The comment that documents a relation, lifted verbatim, tried in this order:
 *   1. the `//` block(s) directly above its FIRST rule head in the engine sources — blank
 *      lines between blocks are crossed (banner headers are written that way), code is not;
 *   2. any comment line in the rule set that names the relation with its columns, in the
 *      `── relation(Col, Col…) ──` header style, together with the block it belongs to;
 *   3. the block above its `.decl`.
 * A block that is only a rule of dashes is decoration and is skipped. Nothing here is
 * paraphrased: a wrong comment makes a wrong catalog entry, and fixing the comment fixes both.
 */
function docComment(files: { path: string; lines: string[] }[], relation: string): string | null {
  const isComment = (l: string) => /^\s*\/\//.test(l);
  const strip = (l: string) => l.replace(/^\s*\/\/ ?/, '');
  const decoration = (l: string) => /^[\s=─\-—]*$/.test(l);
  /** the comment block(s) ending at line `at` (exclusive), crossing blank lines but not code */
  const above = (lines: string[], at: number): string | null => {
    const block: string[] = [];
    let i = at - 1;
    for (;;) {
      while (i >= 0 && lines[i]!.trim() === '') i--;
      if (i < 0 || !isComment(lines[i]!)) break;
      const chunk: string[] = [];
      while (i >= 0 && isComment(lines[i]!)) { chunk.unshift(strip(lines[i]!)); i--; }
      block.unshift(...chunk, '');
      if (block.length > 80) break;
    }
    const text = block.filter((l) => !decoration(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return text.length > 0 ? text : null;
  };
  /** the whole contiguous comment block containing line `at` */
  const around = (lines: string[], at: number): string | null => {
    let lo = at, hi = at;
    while (lo > 0 && isComment(lines[lo - 1]!)) lo--;
    while (hi + 1 < lines.length && isComment(lines[hi + 1]!)) hi++;
    const text = lines.slice(lo, hi + 1).map(strip).filter((l) => !decoration(l)).join('\n').trim();
    return text.length > 0 ? text : null;
  };
  const head = new RegExp(`^${relation}\\s*\\(`);
  for (const f of files) {
    const i = f.lines.findIndex((l) => head.test(l));
    if (i < 0) continue;
    const d = above(f.lines, i);
    if (d) return d;
  }
  const header = new RegExp(`^\\s*//.*\\b${relation}\\s*\\(`);
  for (const f of files) {
    const i = f.lines.findIndex((l) => header.test(l));
    if (i >= 0) { const d = around(f.lines, i); if (d) return d; }
  }
  const decl = new RegExp(`^\\s*\\.decl\\s+${relation}\\s*\\(`);
  for (const f of files) {
    const i = f.lines.findIndex((l) => decl.test(l));
    if (i >= 0) { const d = above(f.lines, i); if (d) return d; }
  }
  return null;
}

export function catalogExt(langDir: string): ExtRelation[] {
  const ar = arities(langDir);
  const sources = [...dlFiles(path.join(langDir, 'engine')), ...dlFiles(path.join(langDir, 'engine-ii')),
    path.join(langDir, 'souffle', 'decls_base.dl')]
    .filter((p) => fs.existsSync(p))
    .map((p) => ({ path: p, lines: fs.readFileSync(p, 'utf8').split('\n') }));
  return readManifest(langDir).map(({ relation, file }) => ({
    relation,
    file,
    arity: ar.get(relation) ?? 0,
    description: docComment(sources, relation)
      ?? `(no comment above the rule deriving ${relation} in ${path.basename(langDir)}/engine — read the rule source)`,
  }));
}
