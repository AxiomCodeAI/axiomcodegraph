#!/usr/bin/env node
// Web oracle: independent ground truth for the web graph (SPEC.md sections 2-4).
//
//   node oracle.mjs <project-dir> <out-dir> [--walk=all|parser] [--kinds=a,b,...] [--no-styles] [--no-js-files]
//
// Writes <out-dir>/rows.tsv (every row, sorted, first column = row kind), <out-dir>/counts.tsv
// (kind<TAB>count) and <out-dir>/files.tsv (each file and whether the parser's walk reaches it).
// The row vocabulary is the contract graph/test/web/tools/normalize.py maps the engine's tables
// onto; see the header of normalize.py for every row kind and its columns.
//
// Never imports the axiom parser: parse5, postcss, postcss-selector-parser, css-select.
// HTML and CSS only (owner ruling, 2026-10-10): <script> and on* attributes are HTML nodes; no JavaScript is parsed.
import fs from 'node:fs';
import path from 'node:path';
import { walk, row, isMinifiedText, isVendor, resolveUrl, MAX_BYTES, MAX_LINES, HTML_EXT, CSS_EXT, LineMap } from './lib/util.mjs';
import { parsePage, bodyOf, attrValueRaw, DIRECTIVE_RE, TEMPLATE_IN_VALUE } from './lib/html.mjs';
import { handlersOf, pageDialects } from './lib/handlers.mjs';
import { parseSheet, parseStyleAttr, GENERIC_FONTS } from './lib/css.mjs';
import { rewriteSelector, compileQuery, makePseudos, matchAll, dynamicAttrQuery } from './lib/select.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const flag = (n) => args.includes(`--${n}`);
const [projectDir, outDir] = args.filter((a) => !a.startsWith('--'));
if (!projectDir || !outDir) { console.error('usage: oracle.mjs <project-dir> <out-dir> [--walk=all|parser] [--kinds=..]'); process.exit(2); }
const WALK = opt('walk', 'all');
const KINDS = opt('kinds', '') ? new Set(opt('kinds', '').split(',')) : null;
// the matching stage is the expensive one: run it only when a requested kind depends on it
const STYLE_KINDS = ['styles', 'cascade', 'unknown', 'l1', 'var', 'keyframes_use', 'font_use', 'container_use'];
const DO_STYLES = !flag('no-styles') && (!KINDS || STYLE_KINDS.some((k) => KINDS.has(k)));
const root = path.resolve(projectDir);

const rows = [];
const usageInput = []; // styles/unknown rows, kept whatever --kinds selects (the usage pass reads them)
const emit = (kind, ...f) => {
  if (kind === 'styles' || kind === 'unknown') usageInput.push(row(kind, ...f));
  if (!KINDS || KINDS.has(kind)) rows.push(row(kind, ...f));
};
const t0 = Date.now();

// ── walk ──────────────────────────────────────────────────────────────────────────────────────
const files = walk(root, WALK);
const fileSet = new Set(files.map((f) => f.rel));
// a URL 'resolves' when the file is on disk, whether or not the parser's walk reads it
const onDisk = (rel) => { try { return fs.statSync(path.join(root, rel)).isFile(); } catch { return false; } };
const parserWalk = new Map(files.map((f) => [f.rel, f.parserWalk]));
const readText = (f) => { const t = fs.readFileSync(f.abs, 'utf8'); return t.charCodeAt(0) === 0xfeff ? t : t; };
const tooBig = (f, text) => fs.statSync(f.abs).size > MAX_BYTES || text.split('\n').length > MAX_LINES;

const pages = []; const sheets = new Map(); // sheetKey -> sheet
const fileSheetByPath = new Map();
for (const f of files) {
  if (!HTML_EXT.has(f.ext) && !CSS_EXT.has(f.ext)) continue;
  let text = fs.readFileSync(f.abs, 'utf8');
  if (tooBig(f, text)) { emit('skipped_file', f.rel, 'too_large'); continue; }
  if (HTML_EXT.has(f.ext)) pages.push(parsePage(f.rel, text));
  else {
    // a BOM is not content: columns are counted without it, as an editor shows the file (same as HTML)
    const bom = text.charCodeAt(0) === 0xfeff;
    const s = parseSheet(bom ? text.slice(1) : text, f.rel, { line: 1, col: 1 }, f.rel);
    s.source = 'FILE'; s.minified = isMinifiedText(text, f.rel); s.vendor = isVendor(f.rel);
    sheets.set(f.rel, s); fileSheetByPath.set(f.rel, s);
  }
}
const pageByPath = new Map(pages.map((p) => [p.rel, p]));

// ── HTML nodes ────────────────────────────────────────────────────────────────────────────────
const URL_ATTRS = { __proto__: null,
  href: ['a', 'area', 'link', 'base'], src: ['script', 'img', 'iframe', 'frame', 'embed', 'video', 'audio', 'source', 'track', 'input', 'include'],
  srcset: ['img', 'source'], poster: ['video'], action: ['form'], formaction: ['button', 'input'], data: ['object'],
  cite: ['blockquote', 'q', 'del', 'ins'], manifest: ['html'], usemap: ['img', 'input', 'object'], codebase: ['object', 'applet'], profile: ['head'], background: ['body', 'table', 'td', 'th'], longdesc: ['img', 'frame', 'iframe'],
  'hx-get': '*', 'hx-post': '*', 'hx-put': '*', 'hx-patch': '*', 'hx-delete': '*',
};
const ID_REF_ATTRS = new Set(['for', 'list', 'form', 'headers', 'popovertarget', 'commandfor', 'aria-labelledby', 'aria-describedby',
  'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-details', 'aria-errormessage', 'aria-flowto', 'anchor', 'itemref']);
const TOKEN_LIST_ID_ATTRS = new Set(['headers', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-flowto', 'itemref', 'aria-details']);
const JS_TYPES = (t) => {
  const v = (t ?? '').trim().toLowerCase();
  if (v === '' || /^(text|application)\/(x-)?(java|ecma)script$/.test(v) || /^text\/(javascript1\.\d|jscript|livescript)$/.test(v)) return 'CLASSIC';
  if (v === 'module') return 'MODULE';
  if (v === 'importmap') return 'IMPORTMAP';
  if (v === 'speculationrules') return 'SPECULATION_RULES';
  if (/json/.test(v)) return 'JSON';
  if (/template|^text\/html$|x-tmpl|handlebars|mustache|underscore|ng-template|x-jsrender|x-jquery-tmpl|x-kendo-template/.test(v)) return 'TEMPLATE';
  if (/babel|jsx|typescript|coffeescript|livescript-|traceur/.test(v)) return 'TRANSPILED';
  return 'DATA_BLOCK';
};

const pageLoads = new Map(); // page.rel -> [{sheetKey|null, url, via, order, depth, status, reason, media, layer, disabled, conds, importLayer}]

for (const page of pages) {
  emit('page', page.rel, page.isFragment ? 'FRAGMENT' : 'DOCUMENT');
  const docHtml = page.elements.find((e) => e.tag === 'html' && e.parentKey === null);
  page.docLang = docHtml ? docHtml.node.attribs?.lang : undefined;
  const idCount = new Map();
  let scriptOrder = 0;
  const dialects = pageDialects(page);
  for (const el of page.elements) {
    const cls = (el.node.attribs?.class ?? '').split(/[\t\n\f\r ]+/).filter(Boolean);
    const id = el.node.attribs?.id ?? '';
    emit('element', el.key, el.tag, id, cls.join(' '));
    emit('contains', el.parentKey ?? page.rel, el.key);
    if (id !== '') idCount.set(id, [...(idCount.get(id) ?? []), el]);
    cls.forEach((c, i) => emit('class_token', el.key, i, c));
    for (const a of el.attrs) {
      emit('attribute', el.key, a.name, a.value);
      const lname = a.name.toLowerCase();
      // references
      const tags = URL_ATTRS[lname];
      if (tags && (tags === '*' || tags.includes(el.tag))) {
        if (lname === 'srcset') {
          for (const cand of a.value.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean)) emitRef(page, el, lname, cand);
        } else emitRef(page, el, lname, a.value);
      }
      if (el.tag === 'meta' && lname === 'content' && /refresh/i.test(el.node.attribs?.['http-equiv'] ?? '')) {
        const m = /url\s*=\s*['"]?([^'"]+)/i.exec(a.value); if (m) emitRef(page, el, 'content', m[1].trim());
      }
      if ((el.tag === 'use' || el.tag === 'image') && el.ns === 'svg' && (lname === 'href' || lname === 'xlink:href')) emitRef(page, el, lname, a.value);
      // template dialect directives and interpolations in attribute values
      if (DIRECTIVE_RE.test(a.name)) {
        emit('template_expr', el.key, a.name, a.value.trim());
      } else if (TEMPLATE_IN_VALUE.test(a.value)) {
        for (const m of a.value.matchAll(/\{\{([\s\S]*?)\}\}|\{%([\s\S]*?)%\}|<%=?([\s\S]*?)%>|\$\{([^}]*)\}/g)) emit('template_expr', el.key, a.name, (m[1] ?? m[2] ?? m[3] ?? m[4]).trim());
      }
      // id references
      if (ID_REF_ATTRS.has(lname) && !(lname === 'for' && el.tag !== 'label' && el.tag !== 'output') && !(lname === 'form' && el.tag === 'form')) {
        const ids = TOKEN_LIST_ID_ATTRS.has(lname) || lname === 'for' && el.tag === 'output' ? a.value.split(/\s+/).filter(Boolean) : [a.value.trim()];
        for (const idv of ids) if (idv) page.idRefs = [...(page.idRefs ?? []), { el, attr: a.name, id: idv }];
      }
    }
    // event handlers as HTML (lib/handlers.mjs), read from the start tag as written: name as written, event,
    // modifiers, dialect, known_event, code verbatim. An .xhtml page is XML: names keep their case and onclick /
    // onClick are two attributes. An HTML page keeps the FIRST of a case-duplicate (the tokenizer drops the rest)
    // and records a duplicate-attribute parse gap for each dropped one.
    {
      const scanned = startTagAttrs(page, el);
      const seen = new Set();
      for (const at of scanned) {
        const k = page.xml ? at.name : at.name.toLowerCase();
        if (seen.has(k)) { if (!page.xml) emit('html_gap', el.key, 'PARSE_ERROR', 'duplicate-attribute'); continue; }
        seen.add(k);
        for (const h of handlersOf(page, el, at.name, at.raw, dialects)) {
          emit('handler', el.key, h.written, h.event, h.modifiers, h.kind, Buffer.byteLength(h.code, 'utf8'), `|${h.code}`);
        }
      }
    }
    // text interpolations (direct text children)
    for (const c of el.node.children ?? []) {
      if (c.type === 'text' && TEMPLATE_IN_VALUE.test(c.data) && el.tag !== 'script' && el.tag !== 'style') {
        for (const m of c.data.matchAll(/\{\{([\s\S]*?)\}\}|\{%([\s\S]*?)%\}|<%=?([\s\S]*?)%>/g)) emit('template_expr', el.key, '#text', (m[1] ?? m[2] ?? m[3]).trim());
      }
    }
    // scripts (HTML and SVG), SPEC §10: ordinal on the page, type as written, every attribute as written (JSON),
    // src resolution, and the inline body as the exact source text between the tags
    if (el.tag === 'script' && (el.ns === 'html' || el.ns === 'svg')) {
      scriptOrder += 1;
      const at = el.node.attribs ?? {};
      const attrsJson = JSON.stringify(Object.fromEntries(startTagAttrs(page, el).map((x) => [x.name, x.raw]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))));
      const src = el.ns === 'svg' ? (at.href ?? at['xlink:href'] ?? at.src) : at.src;
      const type = JS_TYPES(at.type);
      if (src !== undefined) {
        const r = resolveUrl(src, page.rel, page.baseHref);
        emit('script', el.key, scriptOrder, 'external', type, at.type, attrsJson, r.kind === 'local' && r.target && onDisk(r.target) ? r.target : '-', '-');
      } else {
        // body range: first char after the start tag .. the `<` of `</script>` (exclusive)
        const b = bodyOf(page, el);
        const e = page.lines.pos(b.startOffset + b.text.length);
        emit('script', el.key, scriptOrder, 'inline', type, at.type, attrsJson, '-', `${b.line}:${b.col}-${e.line}:${e.col}`);
        // body_lines: line breaks (CRLF, LF or CR) + 1, 0 for an empty body
        const lines = b.text === '' ? 0 : b.text.split(/\r\n|\r|\n/).length;
        emit('script_body', el.key, Buffer.byteLength(b.text, 'utf8'), lines, `|${b.text}`);
      }
    }
  }
  for (const [id, els] of idCount) emit('id', page.rel, id, els.length);
  page.idCount = idCount;
}

/** Attributes of an element's start tag as written: [{name, raw}] in source order, duplicates included. */
function startTagAttrs(page, el) {
  const t = el.loc.startTag;
  const src = page.text.slice(t.startOffset, t.endOffset).replace(/^<[^\s/>]+/, '').replace(/\/?>$/, '');
  const out = [];
  for (const m of src.matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) out.push({ name: m[1], raw: m[2] ?? m[3] ?? m[4] ?? '' });
  return out;
}

function emitRef(page, el, attr, url) {
  const r = resolveUrl(url, page.rel, el.tag === 'base' ? null : page.baseHref);
  const resolved = r.kind === 'local' && r.target && onDisk(r.target) ? r.target : '-';
  emit('reference', el.key, attr, url, r.kind, resolved);
  (page.refs ??= []).push({ el, attr, url, r, resolved });
}

// ── <style> sheets and style="" declarations ─────────────────────────────────────────────────
for (const page of pages) {
  let styleN = 0;
  for (const el of page.elements) {
    if (el.tag === 'style' && el.ns === 'html') {
      const b = bodyOf(page, el);
      styleN += 1;
      const key = `style@${el.key}`;
      const s = parseSheet(b.text, page.rel, { line: b.line, col: b.col }, key);
      s.source = 'STYLE'; s.page = page; s.el = el; s.minified = false; s.vendor = false;
      sheets.set(key, s);
    }
    for (const a of el.attrs) {
      if (a.name !== 'style') continue;
      const raw = attrValueRaw(page, a);
      const useRaw = raw && raw.text === a.value;
      const s = parseStyleAttr(a.value, page.rel, useRaw ? { line: raw.line, col: raw.col } : { line: a.line, col: a.col }, `attr@${el.key}`);
      el.styleDecls = s.decls; el.styleRefs = s.refs;
      for (const d of s.decls) emit('declaration', d.key, `attr@${el.key}`, d.prop, d.value, d.important ? 1 : 0);
      for (const r of s.refs) emitValueRef(r, page.rel);
    }
  }
}

// ── CSS nodes ─────────────────────────────────────────────────────────────────────────────────
const customProps = new Map(); const keyframes = new Map(); const fontFaces = new Map(); const layers = new Set(); const containers = new Set();
for (const s of sheets.values()) {
  emit('stylesheet', s.key, s.source);
  if (s.gap) emit('css_gap', s.key, s.gap);
  for (const r of s.rules) {
    emit('rule', r.key, r.kind, r.prelude, r.parent);
    for (const sel of r.selectors) {
      emit('selector', sel.key, sel.text, sel.spec);
      for (const [k, n] of sel.parts) emit('selector_part', sel.key, k, n);
    }
    if (/keyframes$/.test(r.name)) { emit('keyframes', r.key, r.prelude.replace(/^["']|["']$/g, '')); }
    if (r.name === 'font-face') {
      const fam = (r.node.nodes ?? []).find((d) => d.type === 'decl' && d.prop.toLowerCase() === 'font-family');
      emit('font_face', r.key, fam ? fam.value.trim().replace(/^["']|["']$/g, '') : '-');
    }
    if (r.name === 'property' && r.prelude.startsWith('--')) customProps.set(r.prelude, true);
  }
  for (const d of s.decls) {
    emit('declaration', d.key, d.owner, d.prop, d.value, d.important ? 1 : 0);
    if (d.custom) customProps.set(d.prop, true);
  }
  for (const r of s.refs) {
    emitValueRef(r, s.file);
    if (r.kind === 'CONTAINER') containers.add(r.name);
  }
  // layer nodes: every name an @layer rule (block or statement) declares, dotted through the
  // @layer blocks around it, and every @import layer(x) name
  for (const r of s.rules) {
    if (r.name !== 'layer') continue;
    const names = r.node.nodes ? (r.prelude ? [r.prelude] : []) : r.prelude.split(',').map((x) => x.trim()).filter(Boolean);
    for (const n of names) layers.add(r.layer && !r.layer.includes('<anon') ? `${r.layer}.${n}` : n);
  }
  for (const imp of s.imports) if (imp.layer && !imp.layer.startsWith('<anon')) layers.add(imp.layer);
  for (const c of s.comments) emit('comment', c.key);
}
for (const n of customProps.keys()) emit('custom_property', n);
for (const n of layers) if (n && !n.includes('<anon')) emit('layer', n);
for (const n of containers) emit('container', n);

function emitValueRef(r, file) {
  let resolved = '-'; let urlKind = '-';
  if (r.kind === 'URL' || r.kind === 'IMPORT') {
    const u = resolveUrl(r.name, file, null); urlKind = u.kind;
    if (u.kind === 'local' && u.target && onDisk(u.target)) resolved = u.target;
  }
  emit('value_ref', r.owner, r.kind, r.name, r.kind === 'VARIABLE' ? r.fallback || '-' : urlKind, resolved);
}

// ── @import edges, once per sheet (page-independent) ──────────────────────────────────────────
for (const s of sheets.values()) for (const imp of s.imports) {
  const u = resolveUrl(imp.url, s.file, null);
  const target = u.kind === 'local' && u.target ? fileSheetByPath.get(u.target) : null;
  if (target) emit('imports', s.key, target.key, 'match', '-');
  else emit('imports', s.key, imp.url, 'unknown', u.kind === 'external' ? 'external_url'
    : u.kind === 'local' && u.target && fs.existsSync(path.join(root, u.target)) ? 'not_indexed' : 'unresolved_url');
}

// ── loading: link / style / @import closure, in cascade order (SPEC 3.1, 3.3) ────────────────
const loadedBy = new Map(); // sheetKey -> Set(page)
for (const page of pages) {
  const loads = []; let order = 0;
  const pushSheet = (s, via, depth, ctx, stack) => {
    // @import first, depth-first, at the import's position
    for (const imp of s.imports) {
      const u = resolveUrl(imp.url, s.file, null);
      const conds = [...ctx.conds];
      if (imp.media && !/^all$/i.test(imp.media)) conds.push(`@media ${imp.media}`);
      if (imp.supports) conds.push(`@supports ${imp.supports}`);
      const layer = imp.layer ? (ctx.layer ? `${ctx.layer}.${imp.layer}` : imp.layer) : ctx.layer;
      const target = u.kind === 'local' && u.target ? fileSheetByPath.get(u.target) : null;
      if (target && !stack.has(target.key)) {
        pushSheet(target, 'import', depth + 1, { ...ctx, conds, layer }, new Set([...stack, target.key]));
      } else if (target) {
        // an @import cycle: the browser loads each sheet once; the edge is in `imports` already
      } else {
        const reason = u.kind === 'external' ? 'external_url' : u.kind === 'local' && u.target && fs.existsSync(path.join(root, u.target)) ? 'not_indexed' : 'unresolved_url';
        loads.push({ sheet: null, url: imp.url, via: 'import', depth: depth + 1, status: 'unknown', reason });
      }
    }
    order += 1;
    loads.push({ sheet: s, via, depth, order, status: ctx.disabled ? 'conditional' : 'match', reason: ctx.disabled ? 'alternate_sheet' : '-', conds: ctx.conds, layer: ctx.layer, disabled: ctx.disabled });
  };
  for (const el of page.elements) {
    if (el.inert === 'template') continue;
    if (el.tag === 'style' && el.ns === 'html') {
      const t = (el.node.attribs?.type ?? '').trim().toLowerCase();
      if (t && t !== 'text/css') continue;
      const s = sheets.get(`style@${el.key}`);
      const media = el.node.attribs?.media?.trim();
      pushSheet(s, 'style', 0, { conds: media && !/^all$/i.test(media) ? [`@media ${media}`] : [], layer: null, disabled: false }, new Set([s.key]));
    }
    if (el.tag === 'link' && el.ns === 'html') {
      const rel = (el.node.attribs?.rel ?? '').toLowerCase().split(/\s+/);
      if (!rel.includes('stylesheet')) continue;
      const href = el.node.attribs?.href; if (href === undefined) continue;
      const u = resolveUrl(href, page.rel, page.baseHref);
      const media = el.node.attribs?.media?.trim();
      const disabled = rel.includes('alternate') || el.node.attribs?.disabled !== undefined;
      const s = u.kind === 'local' && u.target ? fileSheetByPath.get(u.target) : null;
      if (s) pushSheet(s, 'link', 0, { conds: media && !/^all$/i.test(media) ? [`@media ${media}`] : [], layer: null, disabled }, new Set([s.key]));
      else {
        const reason = u.kind === 'external' ? 'external_url' : u.kind === 'template' ? 'template_url'
          : u.kind === 'local' && u.target && fs.existsSync(path.join(root, u.target)) ? 'not_indexed' : 'unresolved_url';
        loads.push({ sheet: null, url: href, via: 'link', depth: 0, status: 'unknown', reason });
      }
    }
  }
  for (const l of loads) {
    if (l.sheet) {
      emit('loads_sheet', page.rel, l.sheet.key, l.via, l.order, l.depth, l.status, l.reason);
      if (!loadedBy.has(l.sheet.key)) loadedBy.set(l.sheet.key, new Set());
      loadedBy.get(l.sheet.key).add(page.rel);
    } else emit('loads_sheet', page.rel, l.url, l.via, '-', l.depth, l.status, l.reason);
  }
  pageLoads.set(page.rel, loads.filter((l) => l.sheet));
}
for (const s of sheets.values()) if (!loadedBy.has(s.key)) emit('unknown', 'orphan_sheet', s.key, '-');

// ── links and id references ───────────────────────────────────────────────────────────────────
const LINK_ATTRS = { __proto__: null, a: 'href', area: 'href', form: 'action', iframe: 'src', frame: 'src', button: 'formaction', input: 'formaction', meta: 'content' };
for (const page of pages) {
  for (const { el, attr, url, r } of page.refs ?? []) {
    if (LINK_ATTRS[el.tag] !== attr.toLowerCase()) continue;
    if (r.kind === 'fragment') { if (r.fragment) (page.idRefs ??= []).push({ el, attr, id: decodeFrag(r.fragment) }); continue; }
    if (r.kind === 'empty' || r.kind === 'data') continue;
    if (r.kind === 'scheme') continue; // mailto:, tel:, javascript: (a handler_call)
    if (r.kind === 'external' || r.kind === 'template') { emit('links_to', el.key, attr, url, '-', 'unknown', r.kind === 'external' ? 'external_url' : 'template_url'); continue; }
    const target = r.target && pageByPath.get(r.target);
    if (!target) {
      const reason = r.target && fs.existsSync(path.join(root, r.target)) ? (HTML_EXT.has(path.extname(r.target).toLowerCase()) ? 'not_indexed' : 'not_a_page') : 'unresolved_url';
      if (reason !== 'not_a_page') emit('links_to', el.key, attr, url, '-', 'unknown', reason);
      continue;
    }
    if (r.fragment) {
      const carriers = target.idCount.get(decodeFrag(r.fragment)) ?? [];
      if (carriers.length === 0) emit('links_to', el.key, attr, target.rel, '-', 'unknown', 'no_such_id');
      else for (const c of carriers) emit('links_to', el.key, attr, target.rel, c.key, carriers.length > 1 ? 'ambiguous' : 'match', carriers.length > 1 ? 'duplicate_id' : '-');
    } else emit('links_to', el.key, attr, target.rel, '-', 'match', '-');
  }
  for (const ref of page.idRefs ?? []) {
    const carriers = page.idCount.get(ref.id) ?? [];
    if (carriers.length === 0) emit('id_ref', ref.el.key, ref.attr, ref.id, '-', 'unknown', 'no_such_id');
    else for (const c of carriers) emit('id_ref', ref.el.key, ref.attr, ref.id, c.key, carriers.length > 1 ? 'ambiguous' : 'match', carriers.length > 1 ? 'duplicate_id' : '-');
  }
}
function decodeFrag(f) { try { return decodeURIComponent(f); } catch { return f; } }

// ── selector -> element (SPEC 3.2) and cascade rows (SPEC 3.3) ────────────────────────────────
const rewriteCache = new Map();
const rewrite = (t, scoped = false) => { const k = `${scoped ? 'S' : 'U'}${t}`; let r = rewriteCache.get(k); if (!r) { r = rewriteSelector(t, scoped); rewriteCache.set(k, r); } return r; };
let l1Count = 0; let stylesCount = 0;
const pageMatches = new Map();
const carrierMiss = new Set(); // selectors with no static carrier on some page (SPEC 3.5 iter2 grain) // page -> Map(selKey -> {elems:Map(elemKey->status), ...})

if (DO_STYLES) for (const page of pages) {
  const loads = pageLoads.get(page.rel) ?? [];
  // a fragment is styled by whatever page includes it; with no host known, nothing is matched
  if (page.isFragment) { emit('unknown', 'fragment_no_host', page.rel, page.rel); continue; }
  if (loads.length === 0) continue;
  const side = { langUnknown: new Set() };
  const pseudos = makePseudos(page, side);
  const compiled = new Map();
  const comp = (q) => { if (!compiled.has(q)) compiled.set(q, compileQuery(q, pseudos, page.quirks)); return compiled.get(q); };
  // layer ranks over this page's sheet order (SPEC 3.3)
  const layerRank = layerRanks(loads);
  const staticClasses = new Set(); const staticIds = new Set();
  for (const el of page.elements) {
    for (const c of (el.node.attribs?.class ?? '').split(/\s+/).filter(Boolean)) staticClasses.add(page.quirks ? c.toLowerCase() : c);
    if (el.node.attribs?.id) staticIds.add(page.quirks ? el.node.attribs.id.toLowerCase() : el.node.attribs.id);
  }
  const dyn = [...page.dynamicKeys].map((k) => page.byKey.get(k));
  const dynAttrNames = new Set([...page.dynamicAttrKeys].flatMap((k) => [...page.byKey.get(k).dynAttrs]));
  const matchesHere = new Map(); pageMatches.set(page.rel, matchesHere);
  const seenStyles = new Set();
  for (const load of loads) {
    const s = load.sheet;
    for (const r of s.rules) {
      if (r.kind !== 'style' || r.selectors.length === 0) continue;
      const atConds = [...(load.conds ?? []), ...r.conds];
      const layer = joinLayer(load.layer, r.layer);
      for (const sel of r.selectors) {
        const scoped = r.scopes.length > 0;
        const rw = rewrite(sel.expanded, scoped);
        if (rw.unknown) { emitOnce(seenStyles, `u|${sel.key}`, () => emit('unknown', rw.unknown, sel.key, page.rel)); continue; }
        if (rw.usesRoot && !page.hasHtmlTag) { emitOnce(seenStyles, `u|${sel.key}`, () => emit('unknown', 'implied_element', sel.key, page.rel)); continue; }
        const fn = comp(rw.query);
        if (!fn) { emitOnce(seenStyles, `u|${sel.key}`, () => emit('unknown', 'selector_unparsed', sel.key, page.rel)); continue; }
        side.langUnknown.clear();
        let got; let scopeOf = null; const scopeReasons = new Set();
        if (scoped) {
          const sc = scopedMatch(page, s, r.scopes[r.scopes.length - 1], fn, side, comp);
          if (sc.unknown) { emitOnce(seenStyles, `u|${sel.key}`, () => emit('unknown', `scope_bound:${sc.unknown}`, sel.key, page.rel)); continue; }
          got = sc.nodes; scopeOf = sc.scopeOf; sc.reasons.forEach((x) => scopeReasons.add(`scope_bound:${x}`));
        } else got = matchAll(fn, page.writtenRoot);
        const reasonsBase = new Set([...rw.reasons, ...scopeReasons]);
        for (const c of atConds) reasonsBase.add(`at_rule:${c.split(/\s/)[0].slice(1).toLowerCase()}`);
        if (load.disabled) reasonsBase.add('alternate_sheet');
        const selEntry = matchesHere.get(sel.key) ?? { sel, elems: new Map() }; matchesHere.set(sel.key, selEntry);
        for (const n of got) {
          const el = page.byKey.get(n.axKey);
          const reasons = new Set(reasonsBase);
          if (el.inert) reasons.add(`inert:${el.inert}`);
          let status = reasons.size ? 'conditional' : 'match';
          if (side.langUnknown.has(n)) { status = 'unknown'; reasons.clear(); reasons.add('lang_unknown'); }
          const rs = [...reasons].sort().join(';') || '-';
          if (!selEntry.elems.has(el.key) || selEntry.elems.get(el.key) === 'conditional' && status === 'match') selEntry.elems.set(el.key, status);
          emitOnce(seenStyles, `s|${sel.key}|${el.key}`, () => {
            emit('styles', sel.key, el.key, status, rs, rw.pseudoElement); stylesCount += 1;
            if (scopeOf) { const so = scopeOf.get(n); emit('scope', sel.key, el.key, so.root, so.prox); }
          });
          if (status !== 'unknown') emit('cascade', page.rel, sel.key, el.key, load.order, r.order, layerRank(layer), sel.spec ?? '-', r.important, atConds.join(' && ') || '-');
        }
        // L1: what the browser tree (implied elements present) decides differently
        const gotB = new Set(scoped ? got.map((n) => n.axKey) : matchAll(fn, page.browserRoot).map((n) => n.axKey));
        const gotW = new Set(got.map((n) => n.axKey));
        for (const k of gotB) if (!gotW.has(k)) { emitOnce(seenStyles, `l|${sel.key}|${k}`, () => { emit('l1', sel.key, k, 'browser_only'); l1Count += 1; }); }
        for (const k of gotW) if (!gotB.has(k)) { emitOnce(seenStyles, `l|${sel.key}|${k}`, () => { emit('l1', sel.key, k, 'written_only'); l1Count += 1; }); }
        // dynamic class: elements that would match if they carried the selector's class tokens their
        // binding can add (all of them for a wildcard binding); never a match, one unknown row each
        if (!scoped && dyn.length && /\./.test(sel.expanded)) {
          const toks = [...sel.expanded.matchAll(/\.(-?[_a-zA-Z\u00a0-\uffff][\w\-\u00a0-\uffff]*)/g)].map((m) => m[1]);
          const saved = dyn.map((e) => e.node.attribs.class);
          dyn.forEach((e) => {
            const add = e.dynTokens === '*' ? toks : toks.filter((t) => e.dynTokens.has(t));
            if (add.length) e.node.attribs.class = `${e.node.attribs.class ?? ''} ${add.join(' ')}`.trim();
          });
          const gotD = matchAll(fn, page.writtenRoot);
          dyn.forEach((e, i) => { if (saved[i] === undefined) delete e.node.attribs.class; else e.node.attribs.class = saved[i]; });
          for (const n of gotD) if (!gotW.has(n.axKey)) {
            emitOnce(seenStyles, `s|${sel.key}|${n.axKey}`, () => emit('styles', sel.key, n.axKey, 'unknown', 'dynamic_class', rw.pseudoElement));
            selEntry.elems.set(n.axKey, selEntry.elems.get(n.axKey) ?? 'unknown');
          }
        }
        // dynamic attribute/id bindings: one unknown dynamic_attribute row per (selector, element) the binding may complete
        if (!scoped && dynAttrNames.size) {
          const q = dynamicAttrQuery(rw.query, dynAttrNames, side, pseudos, page.quirks, (e, name) => page.byKey.get(e.axKey)?.dynAttrs?.has(name) ?? false);
          const fA = q && compileQuery(q, pseudos, page.quirks);
          if (fA) {
            const attrOnly = new Set(matchAll(fA, page.writtenRoot).map((n) => n.axKey));
            // with the class bindings applied too: a selector needing both kinds of binding
            const saved = dyn.map((e) => e.node.attribs.class);
            const toks = [...sel.expanded.matchAll(/\.(-?[_a-zA-Z\u00a0-\uffff][\w\-\u00a0-\uffff]*)/g)].map((m) => m[1]);
            dyn.forEach((e) => { const add = e.dynTokens === '*' ? toks : toks.filter((t) => e.dynTokens.has(t)); if (add.length) e.node.attribs.class = `${e.node.attribs.class ?? ''} ${add.join(' ')}`.trim(); });
            const both = matchAll(fA, page.writtenRoot);
            dyn.forEach((e, i) => { if (saved[i] === undefined) delete e.node.attribs.class; else e.node.attribs.class = saved[i]; });
            for (const n of both) if (!gotW.has(n.axKey)) {
              const reason = attrOnly.has(n.axKey) ? 'dynamic_attribute' : 'dynamic_attribute;dynamic_class';
              emitOnce(seenStyles, `s|${sel.key}|${n.axKey}`, () => emit('styles', sel.key, n.axKey, 'unknown', reason, rw.pseudoElement));
              selEntry.elems.set(n.axKey, selEntry.elems.get(n.axKey) ?? 'unknown');
            }
          }
        }
        if (selEntry.elems.size === 0) {
          const missing = rw.required.filter((t) => (t[0] === '.' ? !staticClasses.has(page.quirks ? t.slice(1).toLowerCase() : t.slice(1)) : !staticIds.has(page.quirks ? t.slice(1).toLowerCase() : t.slice(1))));
          if (missing.length) selEntry.unmatched = 'no_static_carrier';
        }
      }
    }
  }
  for (const [k, e] of matchesHere) if (e.elems.size === 0 && e.unmatched) carrierMiss.add(k);
}

/**
 * @scope (A) to (B): subjects are descendants-or-self of a root matching A and not inside a limit
 * matching B below that root. Returns the matched nodes, each with its nearest root and proximity.
 */
function scopedMatch(page, sheet, scope, fn, side, comp) {
  const reasons = new Set();
  const evalBound = (text) => {
    const rw = rewriteSelector(text, false);
    if (rw.unknown) return { unknown: rw.unknown };
    const f = comp(rw.query);
    if (!f) return { unknown: 'selector_unparsed' };
    rw.reasons.forEach((x) => reasons.add(x));
    return { nodes: matchAll(f, page.writtenRoot) };
  };
  let roots;
  if (scope.start) { const b = evalBound(scope.start); if (b.unknown) return { unknown: b.unknown }; roots = b.nodes; }
  else if (sheet.source === 'STYLE' && sheet.el.parentKey) roots = [page.byKey.get(sheet.el.parentKey).node];
  else { const h = page.elements.find((e) => e.tag === 'html' && e.parentKey === null); roots = h ? [h.node] : []; }
  let limits = [];
  if (scope.end) { const b = evalBound(scope.end); if (b.unknown) return { unknown: b.unknown }; limits = b.nodes; }
  const depthBelow = (n, anc) => { let d = 0; for (let x = n; x; x = x.parent, d++) if (x === anc) return d; return -1; };
  const scopeOf = new Map(); const nodes = [];
  for (const R of roots) {
    side.scopeRoot = R;
    const lim = limits.filter((L) => L !== R && depthBelow(L, R) > 0);
    for (const n of matchAll(fn, page.writtenRoot)) {
      const prox = depthBelow(n, R);
      if (prox < 0 || lim.some((L) => depthBelow(n, L) >= 0)) continue;
      const prev = scopeOf.get(n);
      if (!prev) { nodes.push(n); scopeOf.set(n, { root: R.axKey, prox }); } else if (prox < prev.prox) scopeOf.set(n, { root: R.axKey, prox });
    }
  }
  side.scopeRoot = null;
  return { nodes, scopeOf, reasons };
}

function emitOnce(seen, k, f) { if (!seen.has(k)) { seen.add(k); f(); } }
function joinLayer(a, b) { return a && b ? `${a}.${b}` : a || b || null; }
function layerRanks(loads) {
  // order of first declaration, walking each top-level sheet in SOURCE order and descending into an
  // @import where it is written (an `@layer a, b;` before the @import declares a and b first);
  // a parent's own rules come after its sublayers; unlayered rules rank highest (last)
  const order = []; const seen = new Set();
  const add = (name) => { if (!name) return; const parts = name.split('.'); for (let i = 1; i <= parts.length; i++) { const n = parts.slice(0, i).join('.'); if (!seen.has(n)) { seen.add(n); order.push(n); } } };
  const walkSheet = (sheet, prefix, stack) => {
    for (const r of sheet.rules) {
      if (r.name === 'layer') {
        const base = joinLayer(prefix, r.layer);
        if (r.node.nodes) add(joinLayer(base, r.prelude || `<anon:${r.key.replace(/\./g, "_")}>`));
        else for (const n of r.prelude.split(',').map((x) => x.trim()).filter(Boolean)) add(joinLayer(base, n));
      }
      if (r.name === 'import') {
        const imp = sheet.imports.find((i) => i.rule === r); if (!imp) continue;
        const lay = imp.layer ? joinLayer(prefix, imp.layer) : prefix;
        if (imp.layer) add(lay);
        const u = resolveUrl(imp.url, sheet.file, null);
        const t = u.kind === 'local' && u.target ? fileSheetByPath.get(u.target) : null;
        if (t && !stack.has(t.key)) walkSheet(t, lay, new Set([...stack, t.key]));
      }
    }
  };
  for (const l of loads) if (l.via !== 'import') walkSheet(l.sheet, null, new Set([l.sheet.key]));
  // post-order: children before parent, siblings in first-declaration order
  const children = new Map([['', []]]);
  for (const n of order) { const p = n.includes('.') ? n.slice(0, n.lastIndexOf('.')) : ''; if (!children.has(p)) children.set(p, []); children.get(p).push(n); if (!children.has(n)) children.set(n, []); }
  const rank = new Map(); let i = 0;
  const post = (n) => { for (const c of children.get(n) ?? []) post(c); if (n !== '') rank.set(n, ++i); };
  post('');
  const unlayered = i + 1;
  return (layer) => (layer ? rank.get(layer) ?? '?' : unlayered);
}

// ── value-level edges per page: var, keyframes, fonts, containers (SPEC 3.4) ──────────────────
if (DO_STYLES) for (const page of pages) {
  const loads = pageLoads.get(page.rel) ?? [];
  const pageSheets = [...new Set(loads.map((l) => l.sheet))];
  const styleAttrDecls = page.elements.flatMap((e) => (e.styleDecls ?? []).map((d) => ({ d, el: e })));
  if (pageSheets.length === 0 && styleAttrDecls.length === 0) continue;
  const matches = pageMatches.get(page.rel) ?? new Map();
  // element keys a rule matches (any selector), by status
  const ruleElems = (rule) => {
    const m = new Map();
    for (const sel of rule.selectors) for (const [k, st] of matches.get(sel.key)?.elems ?? []) if (st !== 'unknown' && (!m.has(k) || st === 'match')) m.set(k, st);
    return m;
  };
  const defs = new Map(); // --x -> [{decl, rule|null, el|null}]
  const kf = new Map(); const ff = new Map(); const cn = new Map();
  for (const s of pageSheets) {
    for (const d of s.decls) if (d.custom) defs.set(d.prop, [...(defs.get(d.prop) ?? []), { d, rule: d.rule }]);
    for (const r of s.rules) {
      if (/keyframes$/.test(r.name)) { const n = r.prelude.replace(/^["']|["']$/g, ''); kf.set(n, [...(kf.get(n) ?? []), r]); }
      if (r.name === 'font-face') {
        const fam = (r.node.nodes ?? []).find((d) => d.type === 'decl' && d.prop.toLowerCase() === 'font-family');
        if (fam) { const n = fam.value.trim().replace(/^["']|["']$/g, '').toLowerCase(); ff.set(n, [...(ff.get(n) ?? []), r]); }
      }
      if (r.name === 'property' && r.prelude.startsWith('--')) defs.set(r.prelude, [...(defs.get(r.prelude) ?? []), { d: null, rule: r, property: true }]);
    }
    for (const ref of s.refs) if (ref.kind === 'CONTAINER' && ref.ownerDecl) cn.set(ref.name, [...(cn.get(ref.name) ?? []), ref.ownerDecl]);
  }
  for (const { d, el } of styleAttrDecls) if (d.custom) defs.set(d.prop, [...(defs.get(d.prop) ?? []), { d, rule: null, el }]);
  const ancestorsOrSelf = (k) => { const out = []; for (let e = page.byKey.get(k); e; e = e.parentKey ? page.byKey.get(e.parentKey) : null) out.push(e.key); return out; };
  const uses = [];
  for (const s of pageSheets) for (const ref of s.refs) uses.push({ ref, useEls: ref.ownerDecl?.rule ? ruleElems(ref.ownerDecl.rule) : new Map() });
  for (const { el } of styleAttrDecls.filter((x, i, a) => a.findIndex((y) => y.el === x.el) === i)) for (const ref of el.styleRefs ?? []) uses.push({ ref, useEls: new Map([[el.key, 'match']]) });
  // web_var_scope (SPEC 3.4a, V1-12): ONE row per (page, element, name) for every element styled (any status) by a
  // rule or style attribute that USES --name; root = nearest ancestor-or-self styled by a rule / style attribute
  // DEFINING --name (status of that styles row, match preferred over conditional at the same element); root_exact =
  // nearest exact root when the nearest is conditional
  {
    const anyElems = (rule) => {
      const m = new Map();
      for (const sel of rule.selectors) for (const [k, st] of matches.get(sel.key)?.elems ?? []) if (!m.has(k) || st === 'match' || (st === 'conditional' && m.get(k) === 'unknown')) m.set(k, st);
      return m;
    };
    const defAt = new Map(); // name -> Map(elemKey -> best status)
    for (const [name, ds] of defs) {
      const m = new Map();
      for (const d of ds) {
        if (d.property) continue;
        const em = d.el ? new Map([[d.el.key, 'match']]) : d.rule && d.rule.kind === 'style' ? ruleElems(d.rule) : new Map();
        for (const [k, st] of em) if (!m.has(k) || st === 'match') m.set(k, st);
      }
      defAt.set(name, m);
    }
    const scopeKeys = new Set();
    for (const { ref, useEls: _u } of uses) {
      if (ref.kind !== 'VARIABLE') continue;
      const els = ref.ownerDecl?.rule ? anyElems(ref.ownerDecl.rule) : _u;
      for (const k of els.keys()) {
        const sk = `${k}\u0000${ref.name}`;
        if (scopeKeys.has(sk)) continue;
        scopeKeys.add(sk);
        const m = defAt.get(ref.name) ?? new Map();
        let root = null; let rootSt = null; let exact = null;
        for (const a of ancestorsOrSelf(k)) {
          const st = m.get(a);
          if (!st) continue;
          if (!root) { root = a; rootSt = st; }
          if (st === 'match') { exact = a; break; }
        }
        const reason = root ? '-' : (defs.get(ref.name)?.length ? 'not_inherited' : 'no_definition_in_scope');
        emit('var_scope', page.rel, k, ref.name, root ?? '-', root ? rootSt : 'unknown', reason, exact && exact !== root ? exact : '-');
      }
    }
  }
  for (const { ref, useEls } of uses) {
    if (ref.kind === 'VARIABLE') {
      const ds = defs.get(ref.name) ?? [];
      if (ds.length === 0) { emit('var', ref.owner, ref.name, '-', page.rel, 'unknown', ref.fallback ? 'fallback_only' : 'no_definition_in_scope'); continue; }
      for (const def of ds) {
        let status = 'unknown';
        if (def.property) status = 'match';
        else {
          const defEls = def.el ? new Map([[def.el.key, 'match']]) : def.rule && def.rule.kind === 'style' ? ruleElems(def.rule) : new Map();
          for (const [u, ust] of useEls) {
            for (const a of ancestorsOrSelf(u)) {
              const dst = defEls.get(a);
              if (!dst) continue;
              const st = ust === 'match' && dst === 'match' ? 'match' : 'conditional';
              if (st === 'match') { status = 'match'; break; }
              status = 'conditional';
            }
            if (status === 'match') break;
          }
        }
        emit('var', ref.owner, ref.name, def.d ? def.d.key : def.rule.key, page.rel, status, status === 'unknown' ? 'not_inherited' : '-');
      }
    } else if (ref.kind === 'KEYFRAMES') {
      const ts = kf.get(ref.name) ?? [];
      if (!ts.length) emit('keyframes_use', ref.owner, ref.name, '-', page.rel, 'unknown', 'no_such_keyframes');
      for (const t of ts) emit('keyframes_use', ref.owner, ref.name, t.key, page.rel, 'match', '-');
    } else if (ref.kind === 'FONT_FAMILY') {
      const ts = ff.get(ref.name.toLowerCase()) ?? [];
      if (!ts.length) emit('font_use', ref.owner, ref.name, '-', page.rel, 'unknown', 'system_or_external_font');
      for (const t of ts) emit('font_use', ref.owner, ref.name, t.key, page.rel, 'match', '-');
    } else if (ref.kind === 'CONTAINER' && !ref.ownerDecl) {
      const ts = cn.get(ref.name) ?? [];
      if (!ts.length) emit('container_use', ref.owner, ref.name, '-', page.rel, 'unknown', 'no_such_container');
      for (const t of ts) emit('container_use', ref.owner, ref.name, t.key, page.rel, 'match', '-');
    }
  }
}

// ── selector / rule usage at the SELECTOR grain (SPEC 3.5 [iter2], 9.9) ──────────────────────────────
if (DO_STYLES) {
  const RANK = { matched: 4, conditional_only: 3, unknown_only: 2, unmatched_static: 1, not_loaded: 0 };
  const st = new Map(); // sel -> {match, cond, unk, pages:Set, unkReason}
  const get = (k) => { let v = st.get(k); if (!v) { v = { match: false, cond: false, unk: false, pages: new Set(), unkReason: null }; st.set(k, v); } return v; };
  for (const r of usageInput) {
    const f = r.split('\t');
    if (f[0] === 'styles') { const v = get(f[1]); v.pages.add(f[2].replace(/:\d+:\d+$/, '')); if (f[3] === 'match') v.match = true; else if (f[3] === 'conditional') v.cond = true; else { v.unk = true; v.unkReason = v.unkReason ?? f[4]; } }
    if (f[0] === 'unknown' && f[3] !== '-' && /\/\d+$/.test(f[2])) { const v = get(f[2]); v.unk = true; v.unkReason = v.unkReason ?? f[1]; }
  }
  for (const s of sheets.values()) {
    const loading = [...(loadedBy.get(s.key) ?? [])].filter((p) => !pageByPath.get(p)?.isFragment);
    for (const r of s.rules) {
      if (r.kind !== 'style') continue;
      let best = 'not_loaded';
      for (const sel of r.selectors) {
        const v = st.get(sel.key) ?? { match: false, cond: false, unk: false, pages: new Set(), unkReason: null };
        const usage = v.match ? 'matched' : v.cond ? 'conditional_only' : v.unk ? 'unknown_only' : loading.length ? 'unmatched_static' : 'not_loaded';
        const reason = usage === 'unmatched_static' && carrierMiss.has(sel.key) ? 'no_static_carrier' : usage === 'unknown_only' ? (v.unkReason ?? '-') : '-';
        const unmatchedPages = loading.filter((p) => !v.pages.has(p));
        emit('usage', sel.key, usage, reason, loading.length, loading.length - unmatchedPages.length, unmatchedPages.length);
        // the per-page list (view web_selector_unmatched_pages) for the no_static_carrier reason
        if (reason === 'no_static_carrier') for (const p of unmatchedPages) emit('unknown', 'no_static_carrier', sel.key, p);
        if (RANK[usage] > RANK[best]) best = usage;
      }
      emit('rule_usage', r.key, best);
    }
  }
}

// ── write ─────────────────────────────────────────────────────────────────────────────────────
fs.mkdirSync(outDir, { recursive: true });
rows.sort();
fs.writeFileSync(path.join(outDir, 'rows.tsv'), rows.length ? `${rows.join('\n')}\n` : '');
const counts = new Map();
for (const r of rows) { const k = r.slice(0, r.indexOf('\t')); counts.set(k, (counts.get(k) ?? 0) + 1); }
fs.writeFileSync(path.join(outDir, 'counts.tsv'), [...counts].sort().map(([k, v]) => `${k}\t${v}`).join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'files.tsv'), files.filter((f) => HTML_EXT.has(f.ext) || CSS_EXT.has(f.ext)).map((f) => `${f.rel}\t${f.parserWalk ? 'parser_walk' : 'parser_skips'}`).join('\n') + '\n');
console.error(`oracle: ${pages.length} pages, ${sheets.size} sheets, ${rows.length} rows, ${stylesCount} styles, ${l1Count} l1, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
