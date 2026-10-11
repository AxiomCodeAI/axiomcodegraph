// HTML side of the oracle: parse5 (with the htmlparser2 tree adapter, so css-select can walk it).
//
// Two trees per page:
//   browser  parse5's tree exactly as a browser builds it (implied html/head/body/tbody present)
//   written  the same parse with every IMPLIED element spliced out (its children move up), which
//            is the tree a reader of the source text has and what SPEC D5 matches on.
// Element identity is (page, startLine, startColumn) of the start tag (SPEC D4).
import { parse } from 'parse5';
import { adapter } from 'parse5-htmlparser2-tree-adapter';
import { LineMap } from './util.mjs';

const NS = { 'http://www.w3.org/1999/xhtml': 'html', 'http://www.w3.org/2000/svg': 'svg', 'http://www.w3.org/1998/Math/MathML': 'math' };

const isEl = (n) => n && (n.type === 'tag' || n.type === 'script' || n.type === 'style');

function parseTree(text) {
  // scriptingEnabled:false so <noscript> content is elements, as a static reader sees it.
  return parse(text, { treeAdapter: adapter, sourceCodeLocationInfo: true, scriptingEnabled: false });
}

function relink(parent) {
  const ch = parent.children;
  for (let i = 0; i < ch.length; i++) {
    ch[i].parent = parent; ch[i].prev = ch[i - 1] ?? null; ch[i].next = ch[i + 1] ?? null;
  }
}

// <template> content is a separate DocumentFragment in parse5; put it back under the element so
// `template > p` reads like the source. The match is then marked inert (SPEC 3.2).
function flattenTemplates(node) {
  if (!node.children) return;
  if (node.name === 'template' && node.children.length === 1 && node.children[0].type === 'root') {
    node.children = node.children[0].children; relink(node);
  }
  for (const c of node.children) flattenTemplates(c);
}

const keyOfLoc = (page, loc) => `${page}:${loc.startTag.startLine}:${loc.startTag.startCol}`;

/** Splice implied elements (no start tag in the source) and duplicate-keyed clones out of the tree. */
function spliceImplied(node, page, seen) {
  if (!node.children) return;
  let changed = false; const out = [];
  for (const c of node.children) {
    if (isEl(c)) {
      const loc = c.sourceCodeLocation;
      const key = loc && loc.startTag ? keyOfLoc(page, loc) : null;
      if (!key || seen.has(key)) {
        spliceImplied(c, page, seen);
        out.push(...(c.children ?? [])); changed = true; continue;
      }
      seen.add(key);
      c.axKey = key;
      spliceImplied(c, page, seen);
    }
    out.push(c);
  }
  if (changed) { node.children = out; relink(node); }
}

function keyBrowser(node, page, seen) {
  if (!node.children) return;
  for (const c of node.children) {
    if (isEl(c)) {
      const loc = c.sourceCodeLocation;
      const key = loc && loc.startTag ? keyOfLoc(page, loc) : null;
      if (key && !seen.has(key)) { seen.add(key); c.axKey = key; }
    }
    keyBrowser(c, page, seen);
  }
}

const DIRECTIVE_RE = /^(x-|v-|@|:|ng-|\*ng|\[|\(|hx-|th:|data-bind$|bind:|on:)/;
const DYNAMIC_CLASS_ATTR = /^(:class|v-bind:class|x-bind:class|\[class(\.[^\]]+)?\]|\[ngclass\]|ng-class|th:class|th:classappend|bind:class|class:.+)$/i;
const TEMPLATE_IN_VALUE = /\{\{|\{%|<%|\$\{|\{\$|@\{|\[\[/;

/**
 * Parse one page. Returns { rel, text, lines, quirks, isFragment, hasHtmlTag, elements[], byKey,
 * writtenRoot, browserRoot, baseHref, dynamicKeys }.
 */
export function parsePage(rel, rawText) {
  // A byte-order mark is decoding metadata, not content: a browser strips it before tokenizing.
  // Left in, parse5 reads it as text before the doctype (quirks mode, every written html/head/body
  // becomes implied). Columns on line 1 are then counted without it, as an editor shows them.
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  const written = parseTree(text);
  const browser = parseTree(text);
  flattenTemplates(written); flattenTemplates(browser);
  spliceImplied(written, rel, new Set());
  keyBrowser(browser, rel, new Set());
  const lines = new LineMap(text);
  const quirks = written['x-mode'] === 'quirks';
  const hasDoctype = /^\s*(<!--[\s\S]*?-->\s*)*<!doctype/i.test(text.replace(/^﻿/, ''));
  const elements = []; const byKey = new Map(); const dynamicKeys = new Set(); const dynamicAttrKeys = new Set();
  let baseHref = null; let hasHtmlTag = false;
  const visit = (node, parentKey, depth, inert) => {
    for (const c of node.children ?? []) {
      if (!isEl(c)) continue;
      const loc = c.sourceCodeLocation;
      const tag = c.name; const ns = NS[c.namespace] ?? 'html';
      const attrs = [];
      for (const [name, value] of Object.entries(c.attribs ?? {})) {
        const al = loc.attrs?.[name];
        attrs.push({ name, value, line: al?.startLine ?? 0, col: al?.startCol ?? 0, startOffset: al?.startOffset, endOffset: al?.endOffset });
      }
      const el = { key: c.axKey, tag, ns, line: loc.startTag.startLine, col: loc.startTag.startCol, parentKey, depth, attrs, node: c, inert, loc };
      if (tag === 'html' && parentKey === null) hasHtmlTag = true;
      if (tag === 'base' && baseHref === null && c.attribs?.href !== undefined && !inert) baseHref = c.attribs.href;
      for (const a of attrs) {
        const dynAttr = dynamicAttrName(a);
        if (dynAttr) { (el.dynAttrs ??= new Set()).add(dynAttr); dynamicAttrKeys.add(el.key); }
        if (DYNAMIC_CLASS_ATTR.test(a.name) || (a.name === 'class' && TEMPLATE_IN_VALUE.test(a.value))) {
          dynamicKeys.add(el.key);
          const t = dynamicTokens(a.name, a.value);
          el.dynTokens = el.dynTokens === '*' || t === '*' ? '*' : new Set([...(el.dynTokens ?? []), ...t]);
        }
      }
      elements.push(el); byKey.set(el.key, el);
      const childInert = inert ?? ((tag === 'template' || tag === 'noscript') && ns === 'html' ? tag : null);
      visit(c, el.key, depth + 1, childInert);
    }
  };
  visit(written, null, 0, null);
  // FRAGMENT = neither a doctype nor a written <html> start tag (the parser's rule, from the source).
  const isFragment = !hasDoctype && !hasHtmlTag;
  return { rel, text, lines, quirks, isFragment, hasHtmlTag, elements, byKey, writtenRoot: written, browserRoot: browser, baseHref, dynamicKeys, dynamicAttrKeys };
}

/** Raw source text between an element's start and end tag (style/script bodies), with its start position. */
export function bodyOf(page, el) {
  const loc = el.loc;
  const start = loc.startTag.endOffset;
  const end = loc.endTag ? loc.endTag.startOffset : (loc.endOffset ?? start);
  const p = page.lines.pos(start);
  return { text: page.text.slice(start, end), startOffset: start, line: p.line, col: p.col };
}

/** Raw text of an attribute value as written (inside quotes), with its start position; null if none. */
export function attrValueRaw(page, a) {
  if (a.startOffset === undefined) return null;
  const s = page.text.slice(a.startOffset, a.endOffset);
  const m = /^[^=\s]+\s*=\s*(["']?)/.exec(s);
  if (!m) return null;
  let vs = m[0].length; let ve = s.length;
  if (m[1] && s.endsWith(m[1])) ve -= 1;
  const off = a.startOffset + vs;
  const p = page.lines.pos(off);
  return { text: s.slice(vs, ve), startOffset: off, line: p.line, col: p.col };
}

/**
 * The class tokens a dynamic class binding can add, read from its literal text: object keys
 * (`{ open: isOpen }`), string literals in conditional branches and arrays. Anything that could
 * produce a token the text does not spell (a variable, a call, a template substitution, a
 * server-side template in class="") makes the element a wildcard carrier ('*').
 */
export function dynamicTokens(name, value) {
  const n = name.toLowerCase();
  const m = /^\[class\.([^\]]+)\]$/.exec(n) || /^class:(.+)$/.exec(n);
  if (m) return new Set([m[1]]);
  if (n === 'class') return '*';
  // read as directive TEXT, not as JavaScript: string literals are tokens, object-literal keys are tokens; a name
  // in a value position (after ? : , [ ( || or at the start of a plain expression), `+`, or `${` means the
  // binding can produce a token the text does not spell -> wildcard
  const v = value.trim();
  if (/\$\{|\+/.test(v)) return '*';
  const out = new Set();
  const strings = [];
  const bare = v.replace(/'([^'\\]*)'|"([^"\\]*)"|`([^`\\]*)`/g, (_x, a, b, c) => { strings.push(a ?? b ?? c); return '""'; });
  if (bare.startsWith('{')) {
    if (/[{,]\s*\[/.test(bare)) return '*';
    for (const k of v.matchAll(/(?:^\{|,)\s*(?:'([^']*)'|"([^"]*)"|([\w$-]+))\s*:/g)) (k[1] ?? k[2] ?? k[3]).split(/\s+/).filter(Boolean).forEach((t) => out.add(t));
    return out;
  }
  const ID = /^[A-Za-z_$][\w$.]*(\s*\()?/;
  const valueStarts = [0];
  for (const mm of bare.matchAll(/\?|:|,|\[|\(|\|\|/g)) valueStarts.push(mm.index + mm[0].length);
  const hasCond = /\?|&&/.test(bare);
  for (const i of valueStarts) {
    const rest = bare.slice(i).trimStart();
    if (i === 0 && hasCond) continue; // the condition of a ternary / the left of && is not a value
    if (ID.test(rest) && !/^(true|false|null|undefined)\b/.test(rest)) return '*';
  }
  strings.forEach((s0) => s0.split(/\s+/).filter(Boolean).forEach((t) => out.add(t)));
  return out;
}

/**
 * The attribute a binding sets at run time (SPEC 3.2 [iter1b] dynamic_attribute): `:id`, `v-bind:href`,
 * `x-bind:data-state`, `bind:title`, `[attr.aria-label]`, `[id]`, `th:id`, or a plain attribute whose value holds a
 * template expression (`id="row-{{ n }}"`). class and style bindings are not attribute bindings.
 */
export function dynamicAttrName(a) {
  const n = a.name.toLowerCase();
  let m = /^(?::|v-bind:|x-bind:|bind:|th:)([a-z_][\w.:-]*)$/.exec(n) || /^\[(?:attr\.)?([a-z_][\w.:-]*)\]$/.exec(n);
  let name = m ? m[1] : null;
  if (!name && TEMPLATE_IN_VALUE.test(a.value) && !DIRECTIVE_RE.test(n)) name = n;
  if (!name || name === 'class' || name === 'style' || name.startsWith('class.') || name === 'ngclass' || name === 'ngstyle' || name === 'classappend') return null;
  return name;
}

export { DIRECTIVE_RE, TEMPLATE_IN_VALUE };
