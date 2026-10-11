// Fragment hosts (SPEC §11.2 [iter3]): include directives, their resolution, and the composed tree a host page has
// once its includes are expanded. Written from SPEC §11.2 and the include tools' documented behaviour, never from the
// engine: SSI (`<!--#include virtual|file="…" -->`), posthtml-include (`<include src="…">`), gulp-file-include
// (`@@include('…', {…})`) and Jinja (`{% include %}`, `{% extends %}` + `{% block %}`, `{% import %}`).
//
// Readings this file fixes (each one a choice SPEC §11.2 leaves open; reported in the iteration-3 torture report):
//  - a directive in text or a comment sits in the innermost WRITTEN element whose content holds its offset;
//    `position` = how many element children of that parent start before it (0-based). `<include>` is itself the
//    parent's child at that index and is replaced by the fragment's top-level nodes.
//  - directives inside a start tag or a <script>/<style> body are not includes.
//  - `ssi:virtual` resolves against the nearest ancestor directory of the page (the page's own first) that holds the
//    path (a leading `/` is dropped first), else the repository root; `ssi:file`, posthtml and gulp against the
//    page's directory; Jinja against every directory named `templates` (2+ holding it: one `ambiguous` row each).
//  - a path with a template expression (`{{`, `{%`, `${`, an SSI `$var`, or a bare Jinja name) is unknown template_url.
//  - a target on disk that is not a page (e.g. `.inc`) is unknown not_indexed; nothing on disk is unresolved_url.
//  - `jinja:import` is listed (a row) but never composed and does not give its target a host.
//  - a cycle is cut where it closes on the expansion stack, starting from every DOCUMENT page (then from every
//    fragment nothing includes); the cut row is `unknown include_cycle` (its fragment column still names the target).
//    Depth beyond 8 is cut as `unknown include_depth`.
import fs from 'node:fs';
import path from 'node:path';
import { resolveUrl } from './util.mjs';

export const MAX_INCLUDE_DEPTH = 8;
const TEMPLATE_PATH = /\{\{|\{%|<%|\$\{|\{\$|@\{|\[\[|\$[A-Za-z_]/;

/** Offset ranges where a directive is not an include: start tags, raw-text bodies. */
function excludedRanges(page) {
  const out = [];
  for (const el of page.elements) {
    const t = el.loc.startTag; out.push([t.startOffset, t.endOffset]);
    if ((el.tag === 'script' || el.tag === 'style') && el.loc.endTag) out.push([t.endOffset, el.loc.endTag.startOffset]);
  }
  return out;
}

/** The innermost written element whose content range holds `off` (null = top level). */
export function containerAt(page, off) {
  let best = null;
  for (const el of page.elements) {
    const s = el.loc.startTag.endOffset;
    const e = el.loc.endTag ? el.loc.endTag.startOffset : el.loc.endOffset;
    if (s <= off && off < e && (!best || el.depth > best.depth)) best = el;
  }
  return best;
}
const positionAt = (page, parentKey, off) => page.elements.filter((e) => e.parentKey === parentKey && e.loc.startTag.startOffset < off).length;

/** Text from `i` (just after the path argument) to the `)` closing @@include, strings and brackets balanced. */
function gulpArgs(text, i) {
  let depth = 0; let q = null; let j = i;
  for (; j < text.length; j++) {
    const c = text[j];
    if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ')') { if (depth === 0) break; depth--; }
  }
  const raw = text.slice(i, j);
  const m = /^\s*,([\s\S]*)$/.exec(raw);
  return { args: m ? m[1].trim() : '', end: j + 1 };
}

/** Every include directive of a page, in source order: [{kind, url, offset, line, col, args, includeEl, hostKey, position}]. */
export function scanIncludes(page) {
  const ex = excludedRanges(page);
  const inEx = (o) => ex.some(([a, b]) => o >= a && o < b);
  const found = [];
  const t = page.text;
  for (const m of t.matchAll(/<!--#include\s+(virtual|file)\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*?-->/gi)) {
    if (inEx(m.index)) continue;
    found.push({ kind: `ssi:${m[1].toLowerCase()}`, url: m[2] ?? m[3], offset: m.index, args: '' });
  }
  for (const m of t.matchAll(/@@include\(\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if (inEx(m.index)) continue;
    const a = gulpArgs(t, m.index + m[0].length);
    found.push({ kind: 'gulp:@@include', url: m[1] ?? m[2], offset: m.index, args: a.args });
  }
  for (const m of t.matchAll(/\{%-?\s*(include|extends|import)\s+(?:"([^"]*)"|'([^']*)'|([^\s%]+))[\s\S]*?-?%\}/g)) {
    if (inEx(m.index)) continue;
    const bare = m[4] !== undefined;
    found.push({ kind: `jinja:${m[1]}`, url: bare ? m[4] : m[2] ?? m[3], offset: m.index, args: '', bareName: bare });
  }
  for (const el of page.elements) {
    if (el.tag !== 'include' || el.ns !== 'html') continue;
    const src = el.node.attribs?.src; if (src === undefined) continue;
    found.push({ kind: 'posthtml:include', url: src, offset: el.loc.startTag.startOffset, args: el.node.attribs?.locals ?? '', includeEl: el });
  }
  found.sort((a, b) => a.offset - b.offset);
  for (const f of found) {
    const p = page.lines.pos(f.offset); f.line = p.line; f.col = p.col;
    if (f.includeEl) { f.hostKey = f.includeEl.parentKey; f.position = positionAt(page, f.hostKey, f.offset); }
    else { const c = containerAt(page, f.offset); f.hostKey = c ? c.key : null; f.position = positionAt(page, f.hostKey, f.offset); }
    f.page = page;
  }
  return found;
}

/**
 * Resolve every include of every page. Returns refs, each with {status, reason, targets:[rel|'-'], urlKind}.
 * status: match | ambiguous | unknown (reasons template_url, unresolved_url, not_indexed; cycles are set later).
 */
export function resolveIncludes(pages, pageByPath, root, allFiles) {
  const templatesDirs = [...new Set(allFiles.flatMap((f) => {
    const parts = f.rel.split('/'); const out = [];
    for (let i = 0; i < parts.length - 1; i++) if (parts[i] === 'templates') out.push(parts.slice(0, i + 1).join('/'));
    return out;
  }))].sort();
  const onDisk = (rel) => { try { return fs.statSync(path.join(root, rel)).isFile(); } catch { return false; } };
  const refs = [];
  for (const page of pages) for (const f of scanIncludes(page)) {
    refs.push(f);
    const u = f.url.trim();
    if (f.bareName || TEMPLATE_PATH.test(u)) { Object.assign(f, { status: 'unknown', reason: 'template_url', targets: ['-'], urlKind: 'template' }); continue; }
    const rk = resolveUrl(u, page.rel, null);
    f.urlKind = rk.kind;
    if (rk.kind === 'external') { Object.assign(f, { status: 'unknown', reason: 'external_url', targets: ['-'] }); continue; }
    let cands = [];
    if (f.kind === 'ssi:virtual') {
      const p = path.posix.normalize(u.replace(/[?#].*$/, '').replace(/^\/+/, ''));
      let dir = path.posix.dirname(page.rel);
      for (;;) {
        const c = path.posix.normalize(dir === '.' ? p : `${dir}/${p}`);
        if (!c.startsWith('..') && onDisk(c)) { cands = [c]; break; }
        if (dir === '.') break;
        dir = path.posix.dirname(dir);
      }
      if (!cands.length && !p.startsWith('..')) cands = [p]; // the repository root: not on disk -> unresolved below
    } else if (f.kind.startsWith('jinja:')) {
      const p = path.posix.normalize(u.replace(/^\/+/, ''));
      cands = templatesDirs.map((d) => `${d}/${p}`).filter(onDisk);
      if (cands.length > 1) {
        Object.assign(f, { status: 'ambiguous', reason: 'ambiguous_template_root', targets: cands }); continue;
      }
    } else if (rk.kind === 'local' && rk.target) cands = [rk.target];
    const t = cands[0];
    if (t && pageByPath.has(t)) Object.assign(f, { status: 'match', reason: '-', targets: [t] });
    else if (t && onDisk(t)) Object.assign(f, { status: 'unknown', reason: 'not_indexed', targets: ['-'] });
    else Object.assign(f, { status: 'unknown', reason: 'unresolved_url', targets: ['-'] });
  }
  return refs;
}

export const composes = (r) => r.status === 'match' && r.kind !== 'jinja:import' && r.kind !== 'jinja:extends';

/** Cut cycles and over-deep chains (see the header); mutates the cut refs' status/reason. */
export function cutCycles(pages, refsByPage) {
  const targeted = new Set();
  for (const rs of refsByPage.values()) for (const r of rs) if (composes(r)) targeted.add(r.targets[0]);
  const roots = [...pages.filter((p) => !p.isFragment), ...pages.filter((p) => p.isFragment && !targeted.has(p.rel))];
  const dfs = (rel, stack, depth) => {
    for (const r of refsByPage.get(rel) ?? []) {
      if (!composes(r)) continue;
      const t = r.targets[0];
      if (stack.includes(t)) { r.status = 'unknown'; r.reason = 'include_cycle'; continue; }
      if (depth + 1 > MAX_INCLUDE_DEPTH) { r.status = 'unknown'; r.reason = 'include_depth'; continue; }
      dfs(t, [...stack, t], depth + 1);
    }
  };
  for (const p of roots) dfs(p.rel, [p.rel], 0);
}

// ── composed trees ─────────────────────────────────────────────────────────────────────────────────────
function relink(parent) {
  const ch = parent.children;
  for (let i = 0; i < ch.length; i++) { ch[i].parent = parent; ch[i].prev = ch[i - 1] ?? null; ch[i].next = ch[i + 1] ?? null; }
}
const isEl = (n) => n && (n.type === 'tag' || n.type === 'script' || n.type === 'style');

/** Deep copy of a written tree; every element copy carries axPage (the page it came from). Iterative. */
function cloneTree(rootNode, rel) {
  const map = new Map();
  const copy = (n) => { const c = { ...n, attribs: n.attribs ? { ...n.attribs } : n.attribs, children: n.children ? [] : n.children, axPage: isEl(n) ? rel : undefined }; map.set(n, c); return c; };
  const root = copy(rootNode);
  const stack = [[rootNode, root]];
  while (stack.length) {
    const [o, c] = stack.pop();
    for (const ch of o.children ?? []) { const cc = copy(ch); c.children.push(cc); stack.push([ch, cc]); }
    if (c.children) relink(c);
  }
  return { root, map };
}

/** Insert `nodes` into `parent` before its `position`-th element child (or replace `replace`). */
function splice(parent, nodes, position, replace) {
  const ch = parent.children;
  let at;
  if (replace) { at = ch.indexOf(replace); if (at < 0) return; ch.splice(at, 1, ...nodes); }
  else {
    let seen = 0; at = ch.length;
    for (let i = 0; i < ch.length; i++) if (isEl(ch[i])) { if (seen === position) { at = i; break; } seen++; }
    ch.splice(at, 0, ...nodes);
  }
  relink(parent);
}

/**
 * The page's written tree with its includes expanded recursively (a fresh copy). Returns {root, members:[{node, el,
 * page}]} where members are every element copy with the element record of the page it came from.
 */
export function composeTree(page, pageByPath, refsByPage) {
  const members = [];
  const build = (pg) => {
    const { root, map } = cloneTree(pg.writtenRoot, pg.rel);
    for (const el of pg.elements) { const c = map.get(el.node); if (c) members.push({ node: c, el, page: pg }); }
    const refs = (refsByPage.get(pg.rel) ?? []).filter(composes);
    // reverse source order: an earlier insertion point is still counted over the parent's ORIGINAL children
    for (const r of [...refs].reverse()) {
      const frag = pageByPath.get(r.targets[0]);
      const sub = build(frag);
      const parent = r.hostKey ? map.get(pg.byKey.get(r.hostKey).node) : root;
      splice(parent, [...sub.children], r.position, r.includeEl ? map.get(r.includeEl.node) : null);
    }
    return root;
  };
  const root = build(page);
  return { root, members };
}

/** `{% block name %}…{% endblock %}` ranges of a page: [{name, open, start, end}] (start/end = content offsets). */
export function jinjaBlocks(page) {
  const out = []; const stack = [];
  for (const m of page.text.matchAll(/\{%-?\s*(block\s+([\w-]+)|endblock(?:\s+[\w-]+)?)\s*-?%\}/g)) {
    if (m[2]) stack.push({ name: m[2], open: m.index, start: m.index + m[0].length });
    else { const b = stack.pop(); if (b) { b.end = m.index; out.push(b); } }
  }
  return out;
}

/**
 * An extends view: the layout's composed tree with each block the child defines replaced by the child's block
 * content (the child's own composed nodes). Returns {root, members} like composeTree; members from the child only
 * are the ones the caller reports.
 */
export function composeExtends(layout, child, pageByPath, refsByPage) {
  const L = composeTree(layout, pageByPath, refsByPage);
  const C = composeTree(child, pageByPath, refsByPage);
  const byOrig = new Map(L.members.filter((m) => m.page === layout).map((m) => [m.el.key, m.node]));
  const childNode = new Map(C.members.filter((m) => m.page === child).map((m) => [m.el.key, m.node]));
  const lb = new Map(jinjaBlocks(layout).map((b) => [b.name, b]));
  for (const cb of jinjaBlocks(child)) {
    const b = lb.get(cb.name); if (!b) continue;
    // the child's top-level elements inside its block (parent outside the block)
    const tops = child.elements.filter((e) => {
      const o = e.loc.startTag.startOffset; if (o < cb.start || o >= cb.end) return false;
      const par = e.parentKey ? child.byKey.get(e.parentKey) : null;
      return !par || par.loc.startTag.startOffset < cb.open;
    }).map((e) => childNode.get(e.key)).filter(Boolean);
    const host = containerAt(layout, b.open);
    const parent = host ? byOrig.get(host.key) : L.root;
    // drop the layout's default content of the block (its elements whose start lies inside the block)
    const defaults = layout.elements.filter((e) => e.parentKey === (host ? host.key : null) && e.loc.startTag.startOffset >= b.start && e.loc.startTag.startOffset < b.end).map((e) => byOrig.get(e.key));
    const position = positionAt(layout, host ? host.key : null, b.open);
    parent.children = parent.children.filter((n) => !defaults.includes(n)); relink(parent);
    splice(parent, tops, position, null);
  }
  const keep = new Set(C.members.map((m) => m.node));
  const members = [...L.members.filter((m) => m.page === layout), ...C.members.filter((m) => keep.has(m.node))];
  return { root: L.root, members };
}
