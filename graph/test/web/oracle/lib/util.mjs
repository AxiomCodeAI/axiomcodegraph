// Shared helpers for the web oracle: file walk, position maps, row escaping, URL resolution.
// The oracle never imports the axiom parser; every rule here is written from the HTML/CSS
// specifications and SPEC.md, so a disagreement with the engine is a finding, not an echo.
import fs from 'node:fs';
import path from 'node:path';

// Directories the parser's walk skips by name (SPEC 1.1). The oracle walks EVERYTHING but
// node_modules/.git/dot-dirs by default (--walk=all) and tags what the parser would skip, so a
// recall number can be split into "parser walk" and "everything on disk".
export const PARSER_EXCLUDED = new Set(['node_modules', '.git', '.idea', '.vscode', 'dist', 'build', 'target',
  'out', '__pycache__', '.pytest_cache', 'venv', 'env']);
// .shtml/.shtm: server-side-include pages (G21, SPEC §11.1): HTML to the browser once the server has included them
export const HTML_EXT = new Set(['.html', '.htm', '.xhtml', '.shtml', '.shtm']);
export const CSS_EXT = new Set(['.css']);
export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_LINES = 55000;

// The parser's WEB walk has its own skip list since #1909: it reads dist/, build/ and out/ (a client hands over
// compiled CSS there).
export const PARSER_WEB_EXCLUDED = new Set([...PARSER_EXCLUDED].filter((d) => d !== 'dist' && d !== 'build' && d !== 'out'));

/** Walk `root`; returns [{rel, abs, ext, parserWalk}] sorted by rel; mode 'parser' keeps what the web walk reads. */
export function walk(root, mode) {
  const out = [];
  const rec = (dir, relDir, inWeb) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const abs = path.join(dir, e.name);
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
        const w = inWeb && !PARSER_WEB_EXCLUDED.has(e.name);
        if (mode === 'parser' && !w) continue;
        rec(abs, rel, w);
      } else if (e.isFile()) {
        out.push({ rel, abs, ext: path.extname(e.name).toLowerCase(), parserWalk: inWeb });
      }
    }
  };
  rec(root, '', true);
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return out;
}

/** Escape a field for a TSV row: no raw tab/newline/backslash. Empty becomes '-'. */
export function esc(v) {
  if (v === undefined || v === null || v === '') return '-';
  return String(v).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}
export const row = (...f) => f.map(esc).join('\t');

/** Offset -> {line, col} (1-based, col in UTF-16 code units, CR LF counts as one line break). */
export class LineMap {
  constructor(text) {
    this.starts = [0];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 10) this.starts.push(i + 1);
      else if (c === 13) { if (text.charCodeAt(i + 1) === 10) i++; this.starts.push(i + 1); }
    }
  }
  pos(off) {
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.starts[m] <= off) lo = m; else hi = m - 1; }
    return { line: lo + 1, col: off - this.starts[lo] + 1 };
  }
}

export function isMinifiedText(text, rel) {
  if (/\.min\.(css|js|html)$/i.test(rel)) return true;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text.charCodeAt(i) === 10) { if (i - start > 5000) return true; start = i + 1; }
  }
  return false;
}

export const VENDOR_RE = /(^|\/)(vendors?|plugins|bower_components|lib)\//;
export const isVendor = (rel) => VENDOR_RE.test(rel) || /\.min\.css$/i.test(rel);

/**
 * Classify and resolve a URL as written. Returns {kind, target}:
 *  kind: local | external | data | template | fragment | scheme | empty
 *  target: repo-relative posix path (no query/fragment) for local URLs that stay inside root.
 */
export function resolveUrl(raw, fromRel, baseHref) {
  const u = (raw ?? '').trim();
  if (u === '') return { kind: 'empty' };
  if (/\{\{|\{%|<%|\$\{|\{\$|@\{|\[\[/.test(u)) return { kind: 'template' };
  if (u.startsWith('#')) return { kind: 'fragment', fragment: u.slice(1) };
  if (/^data:/i.test(u)) return { kind: 'data' };
  if (/^(https?:)?\/\//i.test(u)) return { kind: 'external' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return { kind: 'scheme' };
  let p = u; let fragment = '';
  const h = p.indexOf('#'); if (h >= 0) { fragment = p.slice(h + 1); p = p.slice(0, h); }
  const q = p.indexOf('?'); if (q >= 0) p = p.slice(0, q);
  try { p = decodeURIComponent(p); } catch { /* keep as written */ }
  let baseDir = path.posix.dirname(fromRel);
  if (baseHref) {
    const b = resolveUrl(baseHref, fromRel, null);
    if (b.kind === 'external' || b.kind === 'scheme') return { kind: 'external' };
    if (b.kind === 'local') {
      if (b.target === null) return { kind: 'local', target: null, fragment };
      // <base href="../"> names a directory: the URL resolves inside it, not next to its index.html
      baseDir = path.posix.dirname(b.target);
    }
  }
  if (p === '') return { kind: 'local', target: fromRel, fragment, selfOnly: true };
  let joined = p.startsWith('/') ? p.slice(1) : path.posix.join(baseDir === '.' ? '' : baseDir, p);
  joined = path.posix.normalize(joined);
  if (joined.startsWith('..')) return { kind: 'local', target: null, fragment };
  if (joined.endsWith('/') || joined === '.') joined = path.posix.join(joined, 'index.html');
  return { kind: 'local', target: joined, fragment };
}
