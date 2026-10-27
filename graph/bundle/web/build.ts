/**
 * THE WEB GRAPH (HTML + CSS): the parser's 17 web relations and the engine's resolution relations
 * (graph/web/engine -> raw/) become the named tables of web/schema.ts.
 *
 * The engine decides what is a join: which sheet a <link> loads, what an @import pulls in, which page an anchor
 * reaches, which declarations define a custom property. This stage does what needs order or a tree walk: the
 * cascade order of a page's sheets (an @import'ed sheet before the importing sheet's own rules, depth first), the
 * layer ranks, the selector -> element match on each page (select.ts), the page-scoped var(), @keyframes,
 * @font-face and @container resolution, and the id references of one page. Every reference that lands nowhere is
 * a row with a reason; nothing is guessed.
 *
 * No row here names a JavaScript node. A script's resolved file, an inline script's module path
 * (`<page>#script-<n>`) and a handler's callee name are COLUMNS: per-language join keys.
 *
 * Every `file` is the path relative to the source directory (run.source_dir), never the parser's relativePath,
 * which is relative to the nearest sub-project (SPEC §3.6 G14).
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';


import { readRaw } from '@/bundle/csv';
import type { Row } from '@/bundle/build';
import {
  COND, compileParts, EXACT, Matcher, NO, pageCtx, parseSelectorList, pseudoElementOf, requiredTokens, resolveNesting, specificity, staticReasons, unknownOf, UNKNOWN, usesRoot,
  type Complex, type El, type PartRow,
} from '@/bundle/web/select';
import { forms as formsOf, mediaRange, normMedia, outline as outlineOf, SHORTHANDS, structures, valueTokens } from '@/bundle/web/convert';

/** Where the rows go: one call per row, written as they are made (the largest project would not fit in memory twice). */
export type WebSink = (table: string, row: Record<string, string | number | null>) => void;

// ── reading ────────────────────────────────────────────────────────────────

interface Table { col: (name: string) => number; rows: string[][]; base: string; dropped: number }

/**
 * One web IR relation. The web tables never hold a raw tab or newline (EntityUtils.escapeTsv writes them as \t and
 * \n), so a row is a line and a field is a tab-split piece, quoted (inner quotes doubled) only when it holds a quote.
 * Read by line, not by character: the character reader builds every field by concatenation, and on the largest
 * corpus project (600k selector parts) that alone exhausted a 4 GB heap.
 */
async function readIr(dir: string, base: string): Promise<Table> {
  const file = path.join(dir, `${base}.csv`);
  const rows: string[][] = [];
  let header: string[] | null = null; let dropped = 0;
  const unq = (f: string): string => (f.length >= 2 && f.charCodeAt(0) === 34 && f.charCodeAt(f.length - 1) === 34 ? f.slice(1, -1).replace(/""/g, '"') : f);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    for await (const r of readRaw(file)) {
      const row = r.map(unq);
      if (row.length > 0 && row[row.length - 1]!.endsWith('\r')) row[row.length - 1] = row[row.length - 1]!.slice(0, -1);
      if (header === null) { header = row; continue; }
      // review #20: a row with the wrong field count (a raw tab the parser failed to escape) is not read; it is counted, and
      // the build declares it (web_unknown ir_row_dropped), never loses it silently
      if (row.length === header.length) rows.push(row.map((x) => (x.length > 96 ? x : flat(x)))); else dropped++;
    }
  }
  const idx = new Map((header ?? []).map((n, i) => [n, i]));
  return {
    rows, base, dropped,
    col: (name: string) => {
      const i = idx.get(name);
      if (i === undefined) {
        if (header === null) return -1; // an absent relation: every read yields ''
        throw new Error(`column "${name}" is not in ${file}`);
      }
      return i;
    },
  };
}

/**
 * A copy of a short string that does not keep the 1 MB chunk it was sliced from alive, shared with every equal one.
 * An IR hash (a kind prefix and 32 hex digits, 41-96 characters) is the field most repeated across rows and tables: on
 * the largest dev project 6.8M such fields hold 1.7M distinct values, so interning up to 96 characters keeps one copy
 * of each (about 2M distinct strings in all, under the cap).
 */
const internTable = new Map<string, string>();
function flat(x: string): string {
  if (x.length <= 96) {
    const hit = internTable.get(x);
    if (hit !== undefined) return hit;
    const c = (' ' + x).slice(1);
    if (internTable.size < 4_000_000) internTable.set(c, c);
    return c;
  }
  return (' ' + x).slice(1);
}

async function readRawRel(dir: string, file: string): Promise<string[][]> {
  const out: string[][] = [];
  for await (const r of readRaw(path.join(dir, file))) out.push(r);
  return out;
}

const num = (s: string | undefined): number | null => { if (s === undefined || s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const nz = (s: string | undefined | null): string | null => (s === undefined || s === null || s === '' ? null : s);
const bool = (s: string | undefined): number => (s === 'true' ? 1 : 0);
/** The parser escapes a newline in a value as the two characters \n (EntityUtils.escapeTsv). */
const unesc = (s: string): string => (s.includes('\\') ? s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r') : s);
/** A value or prelude as stored (V4-05 ruling): comments removed, edges trimmed, inner whitespace as written; null if empty. */
const storedText = (s: string): string | null => nz(unesc(s).replace(/\/\*[\s\S]*?\*\//g, '').trim());
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };

const CONDITION_AT = new Set(['media', 'supports', 'container', 'starting-style', 'document', '-moz-document']);
const GROUPING_AT = new Set([...CONDITION_AT, 'layer', 'scope']);
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif',
  'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', 'inherit', 'initial', 'unset', 'revert', 'revert-layer']);
/** vendor aliases for the platform UI font: like a generic family they name no font file (V1-21) */
const SYSTEM_FONT_ALIASES = new Set(['-apple-system', 'blinkmacsystemfont', '-webkit-body', '-webkit-pictograph']);
const ID_REF_ATTRS = new Set(['for', 'list', 'form', 'headers', 'popovertarget', 'commandfor', 'aria-labelledby', 'aria-describedby',
  'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-details', 'aria-errormessage', 'aria-flowto', 'anchor', 'itemref']);
const TOKEN_LIST_ID_ATTRS = new Set(['headers', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-flowto', 'itemref', 'aria-details']);
/** which attribute of which element is a page link (the oracle's LINK_ATTRS) */
const LINK_ATTRS: Record<string, string> = { a: 'href', area: 'href', form: 'action', iframe: 'src', frame: 'src', button: 'formaction', input: 'formaction', meta: 'content' };
/** SPEC D3's vendor path list, exactly (the `vendor` flag and project_uses): vendor(s)/, plugins/, bower_components/, lib/ */
const D3_VENDOR = /(^|\/)(vendors?|plugins|bower_components|lib)\//;
const DYNAMIC_CLASS_ATTR = /^(:class|v-bind:class|x-bind:class|\[class(\.[^\]]+)?\]|\[ngclass\]|ng-class|th:class|th:classappend|bind:class|class:.+)$/i;
const DYNAMIC_ID_ATTR = /^(:id|v-bind:id|x-bind:id|\[id\]|\[attr\.id\]|th:id|bind:id)$/i;
const TEMPLATE_IN_VALUE = /\{\{|\{%|<%|\$\{|\{\$|@\{|\[\[/;
const HTML_EXT = /\.(html?|xhtml|shtml?)$/i;
/** WHATWG GlobalEventHandlers, WindowEventHandlers and DocumentAndElementEventHandlers, plus touch* and mousewheel */
const KNOWN_EVENTS = new Set(('abort auxclick beforeinput beforematch beforetoggle blur cancel canplay canplaythrough change click close contextlost '
  + 'contextmenu contextrestored copy cuechange cut dblclick drag dragend dragenter dragleave dragover dragstart drop durationchange emptied ended error '
  + 'focus formdata input invalid keydown keypress keyup load loadeddata loadedmetadata loadstart mousedown mouseenter mouseleave mousemove mouseout '
  + 'mouseover mouseup paste pause play playing progress ratechange reset resize scroll scrollend securitypolicyviolation seeked seeking select '
  + 'slotchange stalled submit suspend timeupdate toggle volumechange waiting webkitanimationend webkitanimationiteration webkitanimationstart '
  + 'webkittransitionend wheel afterprint beforeprint beforeunload hashchange languagechange message messageerror offline online pagehide pagereveal '
  + 'pageshow pageswap popstate rejectionhandled storage unhandledrejection unload animationstart animationiteration animationend animationcancel '
  + 'transitionrun transitionstart transitionend transitioncancel pointerdown pointerup pointermove pointerover pointerout pointerenter pointerleave '
  + 'pointercancel gotpointercapture lostpointercapture selectstart selectionchange focusin focusout readystatechange visibilitychange fullscreenchange '
  + 'fullscreenerror touchstart touchend touchmove touchcancel mousewheel').split(/\s+/));
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'keygen', 'command', 'basefont', 'bgsound', 'frame', 'image']);
/** animation shorthand words that are not a keyframes name (CSS Animations 1 §3.13) */
const ANIMATION_KEYWORDS = new Set(['none', 'infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'forwards', 'backwards', 'both',
  'running', 'paused', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'step-start', 'step-end', 'initial', 'inherit', 'unset', 'revert',
  'revert-layer', 'auto', 'replace', 'add', 'accumulate']);

/**
 * The class tokens a dynamic class binding can add: the tokens its text spells, or '*' (any). SPEC §3.2 R2.
 *
 * A LEXICAL SCAN, NOT A JAVASCRIPT PARSE (owner ruling, review #16: nothing in the web layer is parsed as JS). The value of
 * `:class`, `x-bind:class`, `[ngClass]`, `ng-class`, `th:classappend`… is read as tokens: every string literal outside an
 * object value is a class list, and every key of an object literal (`{active: on, 'is-open': x}`) is a class. Anything
 * the scan cannot see the result of makes the binding `*`: an identifier, member or call in value position (`cls`,
 * `'btn-' + size`, `classes()`), a template literal with `${}`, a spread, a computed key, unbalanced brackets. An
 * identifier is a CONDITION, not a value, before `?`, `&&` or a comparison, after a comparison or `!`, or inside an
 * object value; `true`, `false`, `null` and `undefined` give no class.
 */
export function dynamicTokens(name: string, value: string): Set<string> | '*' {
  const n = name.toLowerCase();
  const m = /^\[class\.([^\]]+)\]$/.exec(n) || /^class:(.+)$/.exec(n);
  if (m) return new Set([m[1]!]);
  if (n === 'class') return '*';
  type Tok = { k: 'str' | 'id' | 'num' | 'p'; v: string };
  const toks: Tok[] = [];
  const v = value;
  for (let i = 0; i < v.length;) {
    const c = v[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1; let text = '';
      for (; j < v.length && v[j] !== c; j++) {
        if (v[j] === '\\') { text += v[j + 1] ?? ''; j++; continue; }
        if (c === '`' && v[j] === '$' && v[j + 1] === '{') return '*';
        text += v[j];
      }
      if (j >= v.length) return '*';
      toks.push({ k: 'str', v: text }); i = j + 1; continue;
    }
    const id = /^[A-Za-z_$][\w$]*(?:\s*(?:\?\.|\.)\s*[A-Za-z_$][\w$]*)*/.exec(v.slice(i));
    if (id) { toks.push({ k: 'id', v: id[0] }); i += id[0].length; continue; }
    const num = /^\d[\w.]*/.exec(v.slice(i));
    if (num) { toks.push({ k: 'num', v: num[0] }); i += num[0].length; continue; }
    const op = /^(?:===|!==|==|!=|<=|>=|&&|\|\||\?\?|\.\.\.|[{}[\]():,?!<>+\-*/%])/.exec(v.slice(i));
    if (!op) return '*';
    toks.push({ k: 'p', v: op[0] }); i += op[0].length;
  }
  const out = new Set<string>();
  const add = (t: string) => { for (const x of t.split(/\s+/).filter(Boolean)) out.add(x); };
  const CMP = new Set(['===', '!==', '==', '!=', '<', '>', '<=', '>=']);
  const LIT = new Set(['true', 'false', 'null', 'undefined']);
  // a stack of open brackets; for an object, whether the scan is at a key (after `{` or `,`) or in a value (after `:`)
  const stack: { b: string; inValue: boolean }[] = [];
  const inObjValue = () => stack.some((f) => f.b === '{' && f.inValue);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!; const prev = toks[i - 1]; const next = toks[i + 1];
    const top = stack[stack.length - 1];
    if (t.k === 'p') {
      if (t.v === '{' || t.v === '[' || t.v === '(') {
        // a call: an identifier right before `(` was already judged; a computed key `{[x]: …}` is unknowable
        if (t.v === '[' && top?.b === '{' && !top.inValue) return '*';
        stack.push({ b: t.v, inValue: false }); continue;
      }
      if (t.v === '}' || t.v === ']' || t.v === ')') {
        const f = stack.pop(); if (!f || { '}': '{', ']': '[', ')': '(' }[t.v] !== f.b) return '*'; continue;
      }
      if (top?.b === '{' && t.v === ':' && !top.inValue) { top.inValue = true; continue; }
      if (top?.b === '{' && t.v === ',') { top.inValue = false; continue; }
      if (t.v === '...' && !inObjValue()) return '*';
      continue;
    }
    // an object key: right after `{` or `,` in an object, before `:`
    if (top?.b === '{' && !top.inValue) {
      if (next?.v !== ':' && next?.v !== ',' && next?.v !== '}') return '*';
      if (t.k === 'str' || t.k === 'id' || t.k === 'num') add(t.v);
      continue;
    }
    if (inObjValue()) continue; // a condition
    if (t.k === 'str') { if (!(next && CMP.has(next.v)) && !(prev && CMP.has(prev.v))) add(t.v); continue; }
    if (t.k === 'num' || LIT.has(t.v)) continue;
    // an identifier: a condition, or a value whose classes the scan cannot see
    const condition = (next && (next.v === '?' || next.v === '&&' || CMP.has(next.v))) || (prev && (prev.v === '!' || CMP.has(prev.v)));
    if (!condition) return '*';
  }
  if (stack.length) return '*';
  return out;
}

/** The names an animation / animation-name value gives (vendor forms included, SPEC §3.4 G10). */
export function animationNames(value: string, shorthand: boolean): string[] {
  const out: string[] = [];
  for (const part of value.split(',')) {
    const words = part.trim().replace(/\b[a-z-]+\([^)]*\)/gi, ' ').split(/\s+/).filter(Boolean);
    for (const w0 of words) {
      const w = w0.replace(/^["']|["']$/g, '');
      if (!shorthand) { if (w && !ANIMATION_KEYWORDS.has(w.toLowerCase())) out.push(w); break; }
      if (/^[-+]?[\d.]/.test(w) || ANIMATION_KEYWORDS.has(w.toLowerCase()) || w === '!important') continue;
      out.push(w); break;
    }
  }
  return out;
}

/** media, supports and layer() of an @import prelude */
function importParts(prelude: string): { media: string; supports: string; layer: string | null } {
  let p = prelude.trim().replace(/^url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/i, '').replace(/^("[^"]*"|'[^']*')/, '').trim();
  let layer: string | null = null; let supports = '';
  const lm = /^layer(?:\(\s*([^)]*?)\s*\))?/i.exec(p);
  if (lm) { layer = lm[1] ?? `<anon-import>`; p = p.slice(lm[0].length).trim(); }
  const sm = /^supports\(((?:[^()]|\([^()]*\))*)\)/i.exec(p);
  if (sm) { supports = sm[1]!.trim(); p = p.slice(sm[0].length).trim(); }
  return { media: p.replace(/;$/, '').trim(), supports, layer };
}

export interface WebBuildInputs { clientIrDir: string; rawDir: string; sourceDir?: string; log: (s: string) => void; sink: WebSink }

export async function buildWeb(inp: WebBuildInputs): Promise<{ skipped: Row[] }> {
  const { clientIrDir: dir, rawDir, log } = inp;
  const T = {
    doc: await readIr(dir, 'all-html-documents'), el: await readIr(dir, 'all-html-elements'), attr: await readIr(dir, 'all-html-attributes'),
    cls: await readIr(dir, 'all-html-class-references'), ref: await readIr(dir, 'all-html-references'), script: await readIr(dir, 'all-html-scripts'),
    handler: await readIr(dir, 'all-html-handler-calls'), tpl: await readIr(dir, 'all-html-template-expressions'), hgap: await readIr(dir, 'all-html-parse-gaps'),
    sheet: await readIr(dir, 'all-css-stylesheets'), rule: await readIr(dir, 'all-css-rules'), sel: await readIr(dir, 'all-css-selectors'),
    part: await readIr(dir, 'all-css-selector-parts'), decl: await readIr(dir, 'all-css-declarations'), vref: await readIr(dir, 'all-css-value-references'),
    comment: await readIr(dir, 'all-css-comments'), cgap: await readIr(dir, 'all-css-parse-gaps'),
    skH: await readIr(dir, 'skipped-html-files'), skC: await readIr(dir, 'skipped-css-files'),
  };
  const g = (t: Table, r: string[], name: string): string => { const i = t.col(name); return i < 0 ? '' : (r[i] ?? ''); };
  const out = (table: string) => ({ push: (row: Record<string, string | number | null>) => inp.sink(table, row) });

  // ── the source directory every `file` is relative to (G14) ──
  let root = inp.sourceDir && fs.existsSync(inp.sourceDir) ? path.resolve(inp.sourceDir) : '';
  if (!root) {
    const bases = [...T.doc.rows.map((r) => g(T.doc, r, 'baseMservPath')), ...T.sheet.rows.map((r) => g(T.sheet, r, 'baseMservPath'))].filter(Boolean);
    root = bases.sort((a, b) => a.length - b.length)[0] ?? '';
  }
  const rootReal = root && fs.existsSync(root) ? fs.realpathSync(root) : root;
  const rel = (abs: string): string => {
    if (!abs) return '';
    if (!path.isAbsolute(abs)) return abs.split(path.sep).join('/');
    for (const r of [root, rootReal]) if (r && (abs === r || abs.startsWith(r + path.sep))) return path.relative(r, abs).split(path.sep).join('/');
    return abs.split(path.sep).join('/');
  };
  const isDir = (abs: string): boolean => { try { return fs.statSync(abs).isDirectory(); } catch { return false; } };
  /** an unresolved local URL whose file IS on disk was not read by the walk (a skipped directory): not_indexed */
  const onDiskReason = (reason: string, fromAbs: string, urlPath: string, urlKind: string): string => {
    if (reason !== 'unresolved_url' || !urlPath || !fromAbs || (urlKind !== 'RELATIVE' && urlKind !== 'ROOT_RELATIVE')) return reason;
    const p0 = urlPath.split(/[?#]/)[0]!;
    const cand = urlKind === 'ROOT_RELATIVE' ? rootRelative(fromAbs, p0) : path.join(path.dirname(fromAbs), p0);
    return onDisk(cand) ? 'not_indexed' : reason;
  };
  /** a root-relative path against the nearest ancestor of the referring file that holds it (file or directory), else the root (V3-01) */
  const rootRelative = (fromAbs: string, p0: string): string => {
    const rp = p0.replace(/^\/+/, '');
    if (fromAbs) {
      for (let d = path.dirname(fromAbs); d === root || d === rootReal || d.startsWith(root + path.sep) || d.startsWith(rootReal + path.sep); d = path.dirname(d)) {
        const c = path.join(d, rp);
        try { fs.statSync(c); return c; } catch { /* not here */ }
        if (d === root || d === rootReal || d === path.dirname(d)) break;
      }
    }
    return path.join(root, rp);
  };
  const onDisk = (abs: string): boolean => { try { return abs !== '' && fs.statSync(abs).isFile(); } catch { return false; } };
  const unknownRow = (kind: string, node: string | null, page: string | null, reason: string, detail: string | null, file: string | null, line: number | null) =>
    out('web_unknown').push({ kind, node_uid: node, page_uid: page, reason, detail, file, line });

  for (const t of Object.values(T)) if (t.dropped > 0) {
    log(`web: ${t.dropped} row(s) of ${t.base}.csv have the wrong field count and were not read`);
    unknownRow('ir_row_dropped', null, null, 'ir_row_dropped', `${t.dropped} row(s) of ${t.base}.csv with the wrong field count`, null, null);
  }

  // ── pages ──
  interface Page { id: string; file: string; abs: string; kind: string; quirks: boolean; lang: string; elements: El[]; rows: string[][]; hasHtml: boolean }
  const pages = new Map<string, Page>();
  for (const r of T.doc.rows) {
    const id = g(T.doc, r, 'htmlDocumentUniqueHash');
    const abs = g(T.doc, r, 'filePath');
    const file = rel(abs) || g(T.doc, r, 'relativePath');
    const doctype = g(T.doc, r, 'doctype');
    const quirks = doctype.trim() === '';
    pages.set(id, { id, file, abs, kind: g(T.doc, r, 'documentKind'), quirks, lang: g(T.doc, r, 'lang'), elements: [], rows: [], hasHtml: false });
    out('web_pages').push({ uid: id, file, name: g(T.doc, r, 'name'), document_kind: g(T.doc, r, 'documentKind'), doctype: nz(doctype), quirks: quirks ? 1 : 0,
      lang: nz(g(T.doc, r, 'lang')), title: nz(g(T.doc, r, 'title')), template_dialects: nz(g(T.doc, r, 'templateDialects')),
      minified: g(T.doc, r, 'sourceProvenance') === 'MINIFIED' ? 1 : 0, element_count: num(g(T.doc, r, 'elementCount')),
      script_count: num(g(T.doc, r, 'scriptCount')), inline_script_count: num(g(T.doc, r, 'inlineScriptCount')),
      line: num(g(T.doc, r, 'startLine')), end_line: num(g(T.doc, r, 'endLine')) });
  }
  const fileOfPage = (id: string): string | null => pages.get(id)?.file ?? null;
  const pageByAbs = new Map<string, Page>(); for (const p of pages.values()) pageByAbs.set(p.abs, p);

  // ── attributes, grouped by element ──
  const attrsOf = new Map<string, string[][]>();
  for (const r of T.attr.rows) push(attrsOf, g(T.attr, r, 'ownerElementLinkHash'), r);
  const attrRow = new Map<string, string[]>(); for (const r of T.attr.rows) attrRow.set(g(T.attr, r, 'htmlAttributeUniqueHash'), r);

  // the class tokens of each element, in attribute order (html_element.classNames is a comma set)
  const tokensOf = new Map<string, { pos: number; name: string }[]>();
  for (const r of T.cls.rows) push(tokensOf, g(T.cls, r, 'ownerElementLinkHash'), { pos: num(g(T.cls, r, 'position')) ?? 0, name: g(T.cls, r, 'className') });
  for (const a of tokensOf.values()) a.sort((x, y) => x.pos - y.pos);

  // ── elements ──
  const elById = new Map<string, El>();
  const elRow = new Map<string, string[]>();
  const elPage = new Map<string, Page>();
  for (const r of T.el.rows) {
    const id = g(T.el, r, 'htmlElementUniqueHash');
    const attrs = new Map<string, { value: string; hasValue: boolean; raw: string | null }>();
    const ns = g(T.el, r, 'namespace');
    const html = ns === 'HTML' || ns === '';
    let dyn: Set<string> | '*' | null = null; let dynId = false; const dynAttrs = new Set<string>();
    for (const a of attrsOf.get(id) ?? []) {
      const name = g(T.attr, a, 'name'), prefix = g(T.attr, a, 'prefix');
      const full = prefix ? `${prefix}:${name}` : name;
      const v = { value: unesc(g(T.attr, a, 'value')), hasValue: g(T.attr, a, 'hasValue') === 'true', raw: nz(unesc(g(T.attr, a, 'valueRaw'))) as string | null };
      attrs.set(html ? full.toLowerCase() : full, v);
      if (prefix) attrs.set(html ? name.toLowerCase() : name, v);
      if (DYNAMIC_CLASS_ATTR.test(full) || (full.toLowerCase() === 'class' && TEMPLATE_IN_VALUE.test(v.value))) {
        const t = dynamicTokens(full, v.value);
        dyn = dyn === '*' || t === '*' ? '*' : new Set([...(dyn ?? []), ...t]);
      }
      if (DYNAMIC_ID_ATTR.test(full) || (full.toLowerCase() === 'id' && TEMPLATE_IN_VALUE.test(v.value))) dynId = true;
      // an attribute a binding sets (`:href`, `x-bind:data-k`, `[attr.aria-x]`) or whose value holds a template marker
      const bound = /^(?::|v-bind:|x-bind:|bind:)([\w-]+)$/i.exec(full) ?? /^\[(?:attr\.)?([\w-]+)\]$/i.exec(full);
      if (bound && bound[1]!.toLowerCase() !== 'class' && bound[1]!.toLowerCase() !== 'style' && bound[1]!.toLowerCase() !== 'ngclass') dynAttrs.add(bound[1]!.toLowerCase());
      else if (!bound && full.toLowerCase() !== 'class' && TEMPLATE_IN_VALUE.test(v.value) && !DYNAMIC_CLASS_ATTR.test(full)) dynAttrs.add(full.toLowerCase());
    }
    const tokenList = (tokensOf.get(id) ?? []).map((t) => t.name);
    const classes = new Set(tokenList);
    const tag = g(T.el, r, 'tagName');
    const e: El = {
      id, idx: 0, tag, tagLower: tag.toLowerCase(), ns, idAttr: g(T.el, r, 'id'), classes,
      classesLower: new Set([...classes].map((c) => c.toLowerCase())), attrs, text: unesc(g(T.el, r, 'textContent')),
      childCount: num(g(T.el, r, 'childElementCount')) ?? 0, position: num(g(T.el, r, 'position')) ?? 0,
      parent: null, children: [], inert: '', dynamicClass: dyn !== null, dynTokens: dyn, dynamicId: dynId, dynAttrs, lang: attrs.get('lang')?.value ?? attrs.get('xml:lang')?.value ?? '',
    };
    if (e.childCount === 0 && e.text === '' && g(T.el, r, 'isVoid') !== 'true') {
      const doc = g(T.el, r, 'documentLinkHash');
      const at = [num(g(T.el, r, 'startLine')), num(g(T.el, r, 'startColumn')), num(g(T.el, r, 'endLine')), num(g(T.el, r, 'endColumn'))];
      e.blankText = () => {
        const pt = textOfPage(doc);
        if (!pt || at.some((x) => x === null)) return false;
        return whitespaceBetweenTags(pt.text.slice(offsetOf(pt, at[0]!, at[1]!), offsetOf(pt, at[2]!, at[3]!)), e.tagLower);
      };
    }
    elById.set(id, e); elRow.set(id, r);
    const p = pages.get(g(T.el, r, 'documentLinkHash'));
    if (p) { p.elements.push(e); p.rows.push(r); elPage.set(id, p); }
  }
  for (const [id, e] of elById) {
    const par = g(T.el, elRow.get(id)!, 'parentElementLinkHash');
    if (par) { const pe = elById.get(par); if (pe) { e.parent = pe; pe.children.push(e); } }
  }
  const startOf = (elId: string): [number, number] => {
    const r = elRow.get(elId); return r ? [num(g(T.el, r, 'startLine')) ?? 0, num(g(T.el, r, 'startColumn')) ?? 0] : [0, 0];
  };
  for (const p of pages.values()) {
    const order = p.elements.map((e, i) => ({ e, r: p.rows[i]! }))
      .sort((x, y) => (num(g(T.el, x.r, 'startLine'))! - num(g(T.el, y.r, 'startLine'))!) || (num(g(T.el, x.r, 'startColumn'))! - num(g(T.el, y.r, 'startColumn'))!));
    p.elements = order.map((o) => o.e); p.rows = order.map((o) => o.r);
    p.elements.forEach((e, i) => { e.idx = i; });
    p.hasHtml = p.elements.some((e) => e.parent === null && e.tagLower === 'html');
  }
  // `<div/>` IS AN OPEN TAG in HTML: the trailing slash is ignored on a non-void HTML element, so what follows it in
  // the same parent is its content until the parent closes. The parser closes it at the slash; the tree is mended
  // here (one page text read per page that has such an element).
  const depthOf = new Map<string, number>();
  const mendedPages = new Set<string>();
  for (const p of pages.values()) {
    let lines: string[] | null = null;
    const textOf = (id: string): string => {
      if (lines === null) { try { let t = fs.readFileSync(p.abs, 'utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); lines = t.split(/\r\n|\r|\n/); } catch { lines = []; } }
      const r = elRow.get(id)!; const sl = num(g(T.el, r, 'startLine'))!, sc = num(g(T.el, r, 'startColumn'))!, el = num(g(T.el, r, 'endLine'))!, ec = num(g(T.el, r, 'endColumn'))!;
      // the parser's columns are 1-based and the end column is exclusive (review #8: `ec` read one character past `<div/>`)
      if (sl === el) return (lines[sl - 1] ?? '').slice(sc - 1, ec - 1);
      return [(lines[sl - 1] ?? '').slice(sc - 1), ...lines.slice(sl, el - 1), (lines[el - 1] ?? '').slice(0, ec - 1)].join('\n');
    };
    let mended = false;
    for (const e of p.elements) {
      if (!(e.ns === 'HTML' || e.ns === '') || VOID_ELEMENTS.has(e.tagLower) || e.children.length > 0 || e.childCount > 0) continue;
      // V4-02: `<include src="x" />` is a build-time directive the include tool closes where it is written, and the
      // fragment replaces it: it never holds what follows (holding it hid every later include's composition)
      if (e.tagLower === 'include') continue;
      const src = textOf(e.id);
      if (!/\/\s*>\s*$/.test(src) || src.includes('</')) continue;
      const sibs = (e.parent ? e.parent.children : p.elements.filter((x) => x.parent === null)).slice().sort((a, b) => a.position - b.position);
      const later = sibs.filter((x) => x.position > e.position);
      if (later.length === 0) continue;
      if (e.parent) e.parent.children = e.parent.children.filter((x) => !later.includes(x));
      later.forEach((x, i) => { x.parent = e; x.position = i; });
      e.children = later; e.childCount = later.length;
      mended = true;
    }
    if (mended) {
      mendedPages.add(p.id);
      const walk = (x: El, d: number) => { depthOf.set(x.id, d); for (const c of x.children) walk(c, d + 1); };
      for (const x of p.elements) if (x.parent === null) walk(x, 0);
    }
  }
  for (const e of elById.values()) {
    e.children.sort((a, b) => a.position - b.position);
    // the markup inside an <iframe> is text to a browser (G11): kept as nodes, never styled, never a carrier
    for (let a = e.parent; a !== null; a = a.parent) {
      if (a.tagLower === 'iframe' && (a.ns === 'HTML' || a.ns === '')) { e.inert = 'iframe_text'; break; }
      if (!e.inert && (a.tagLower === 'template' || a.tagLower === 'noscript') && (a.ns === 'HTML' || a.ns === '')) e.inert = a.tagLower;
    }
  }
  for (const p of pages.values()) {
    for (let i = 0; i < p.elements.length; i++) {
      const e = p.elements[i]!, r = p.rows[i]!;
      const nth = /\[(\d+)\]$/.exec(g(T.el, r, 'path'));
      out('web_elements').push({ uid: e.id, page_uid: p.id, parent_uid: e.parent?.id ?? null, file: p.file,
        line: num(g(T.el, r, 'startLine')), col: num(g(T.el, r, 'startColumn')), end_line: num(g(T.el, r, 'endLine')), end_col: num(g(T.el, r, 'endColumn')),
        tag_name: e.tag, namespace: nz(e.ns), depth: depthOf.get(e.id) ?? num(g(T.el, r, 'depth')), position: e.position, nth_of_type: nth ? Number(nth[1]) : null,
        html_id: nz(e.idAttr), class_names: nz((tokensOf.get(e.id) ?? []).map((t) => t.name).join(' ')), child_count: e.childCount, text: nz(e.text), inert: nz(e.inert),
        dynamic_class: e.dynamicClass ? 1 : 0, display: `${e.tagLower}${e.idAttr ? '#' + e.idAttr : ''}${[...e.classes].map((c) => '.' + c).join('')}` });
    }
  }

  // attributes; on* attributes numbered per page in document order (handler_index)
  const onIndex = new Map<string, number>();
  {
    const byPage = new Map<string, string[][]>();
    for (const r of T.attr.rows) {
      const d = g(T.attr, r, 'documentLinkHash');
      out('web_attributes').push({ uid: g(T.attr, r, 'htmlAttributeUniqueHash'), element_uid: g(T.attr, r, 'ownerElementLinkHash'), page_uid: d, file: fileOfPage(d),
        line: num(g(T.attr, r, 'startLine')), col: num(g(T.attr, r, 'startColumn')), name: g(T.attr, r, 'name'), prefix: nz(g(T.attr, r, 'prefix')),
        value: unesc(g(T.attr, r, 'value')), value_raw: nz(unesc(g(T.attr, r, 'valueRaw'))), kind: g(T.attr, r, 'attributeKind'), has_value: bool(g(T.attr, r, 'hasValue')) });
      if (g(T.attr, r, 'attributeKind') === 'EVENT_HANDLER') push(byPage, d, r);
    }
    for (const rows of byPage.values()) {
      rows.sort((a, b) => (num(g(T.attr, a, 'startLine'))! - num(g(T.attr, b, 'startLine'))!) || (num(g(T.attr, a, 'startColumn'))! - num(g(T.attr, b, 'startColumn'))!));
      rows.forEach((r, i) => onIndex.set(g(T.attr, r, 'htmlAttributeUniqueHash'), i + 1));
    }
  }
  for (const r of T.cls.rows) {
    const d = g(T.cls, r, 'documentLinkHash');
    out('web_class_tokens').push({ uid: g(T.cls, r, 'htmlClassReferenceUniqueHash'), element_uid: g(T.cls, r, 'ownerElementLinkHash'), page_uid: d, file: fileOfPage(d),
      line: num(g(T.cls, r, 'startLine')), position: num(g(T.cls, r, 'position')), class_name: g(T.cls, r, 'className'), dynamic: TEMPLATE_IN_VALUE.test(g(T.cls, r, 'className')) || /<\?/.test(g(T.cls, r, 'className')) ? 1 : 0 });
  }
  const refById = new Map<string, string[]>();
  const refsOfPage = new Map<string, string[][]>();
  for (const r of T.ref.rows) {
    const d = g(T.ref, r, 'documentLinkHash');
    const id = g(T.ref, r, 'htmlReferenceUniqueHash');
    refById.set(id, r); push(refsOfPage, d, r);
    if (g(T.ref, r, 'referenceKind') === 'INCLUDE') continue; // written once its include is resolved (§11)
    let abs = g(T.ref, r, 'resolvedFilePath');
    // `?p=1.1.1` (a query, no path) names the page itself (V1-06): the reference resolves to it, as its link does
    if (!abs && g(T.ref, r, 'urlKind') === 'RELATIVE' && !g(T.ref, r, 'path') && g(T.ref, r, 'query')) abs = pages.get(d)?.abs ?? '';
    out('web_references').push({ uid: id, element_uid: g(T.ref, r, 'ownerElementLinkHash'), page_uid: d, file: fileOfPage(d),
      line: num(g(T.ref, r, 'startLine')), col: num(g(T.ref, r, 'startColumn')), reference_kind: g(T.ref, r, 'referenceKind'), attribute_name: nz(g(T.ref, r, 'attributeName')),
      url_as_written: g(T.ref, r, 'urlAsWritten'), url_kind: g(T.ref, r, 'urlKind'), path: nz(g(T.ref, r, 'path')), query: nz(g(T.ref, r, 'query')),
      fragment: nz(g(T.ref, r, 'fragment')), resolved_file: onDisk(abs) ? rel(abs) : null, is_resolved: bool(g(T.ref, r, 'isResolved')) });
  }
  // ── the page text, read once per page that needs a slice (script bodies, handler code as written) ──
  const pageText = new Map<string, { text: string; starts: number[] } | null>();
  const textOfPage = (pageId: string): { text: string; starts: number[] } | null => {
    if (!pageText.has(pageId)) {
      const p = pages.get(pageId);
      let v: { text: string; starts: number[] } | null = null;
      try {
        let t = p ? fs.readFileSync(p.abs, 'utf8') : '';
        if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); // the parser's positions are counted without the BOM
        const starts = [0];
        // line starts as the parser counts them: LF, CRLF and a lone CR each end a line (V2-18)
        for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); if (c === 10 || (c === 13 && t.charCodeAt(i + 1) !== 10)) starts.push(i + 1); }
        v = p ? { text: t, starts } : null;
      } catch { v = null; }
      pageText.set(pageId, v);
    }
    return pageText.get(pageId)!;
  };
  /** the 0-based offset of a 1-based (line, column) in the page text */
  const offsetOf = (pt: { starts: number[] }, line: number, col: number): number => (pt.starts[line - 1] ?? 0) + col - 1;

  // ── §11 fragment hosts: includes (G22), resolved and composed ──
  // A page that includes a fragment is styled as the browser sees it after the include: the fragment's top-level elements
  // stand where the include is, inside the host's tree and under the host's sheets. Each such composition is matched
  // again below (runPage with a composed tree), and only the fragment's elements get rows from it, with host_page_uid.
  interface Insert { hostEl: El | null; at: [number, number]; position: number; frag: string; elems: El[] | null; removes: Set<string>; ref: string | null }
  const includeInserts = new Map<string, Insert[]>(); // host page -> what goes into it (includes, asserted includes)
  const extendsComps: { layout: string; child: string; inserts: Insert[] }[] = [];
  const hosted = new Set<string>();
  const hostsOfFragment = new Map<string, { host: string; hostEl: El | null; line: number; col: number }[]>(); // included (not extends/import)
  const posOf = (e: El): [number, number] => startOf(e.id);
  const before = (a: [number, number], b: [number, number]): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const topOf = (pageId: string): El[] => (pages.get(pageId)?.elements ?? []).filter((e) => e.parent === null).sort((a, b) => a.position - b.position);
  const positionAt = (pageId: string, hostEl: El | null, at: [number, number]): number =>
    (hostEl ? hostEl.children : topOf(pageId)).filter((c) => before(posOf(c), at)).length;
  // the page paths are as the walk wrote them, which may be the root's real path (a symlinked temporary directory)
  const underRoot = (d: string): boolean => d === root || d === rootReal || d.startsWith(root + path.sep) || d.startsWith(rootReal + path.sep);
  // Jinja resolves a template name against its template directories: every directory named `templates` under the root
  const templateRoots = (() => {
    const set = new Set<string>();
    for (const p of pages.values()) {
      for (let d = path.dirname(p.abs); underRoot(d) && d !== path.dirname(d); d = path.dirname(d)) {
        if (path.basename(d) === 'templates') set.add(d);
        if (d === root || d === rootReal) break;
      }
    }
    return [...set].sort();
  })();
  const resolveInclude = (page: Page, r: string[], flavour: string): { targets: string[]; status: string; reason: string | null } => {
    const uk = g(T.ref, r, 'urlKind'); const url = g(T.ref, r, 'urlAsWritten');
    const p0 = (g(T.ref, r, 'path') || url).split(/[?#]/)[0]!;
    if (uk === 'TEMPLATE_EXPRESSION') return { targets: [], status: 'unknown', reason: 'template_url' };
    if (uk === 'ABSOLUTE' || uk === 'PROTOCOL_RELATIVE' || !p0) return { targets: [], status: 'unknown', reason: 'external_url' };
    let cands: string[];
    if (flavour.startsWith('jinja:')) {
      cands = templateRoots.length ? templateRoots.map((d) => path.join(d, p0)) : [path.join(root, p0)];
    } else if (flavour === 'ssi:virtual') {
      // the site root is the nearest ancestor directory of the page that holds the path; else the repository root
      const rp = p0.replace(/^\/+/, ''); cands = [path.join(root, rp)];
      for (let d = path.dirname(page.abs); underRoot(d); d = path.dirname(d)) {
        if (onDisk(path.join(d, rp))) { cands = [path.join(d, rp)]; break; }
        if (d === root || d === rootReal || d === path.dirname(d)) break;
      }
    } else {
      const abs = g(T.ref, r, 'resolvedFilePath');
      cands = [abs || (uk === 'ROOT_RELATIVE' ? rootRelative(page.abs, p0) : path.join(path.dirname(page.abs), p0))];
    }
    const hits = [...new Set(cands)].filter((c) => pageByAbs.has(c));
    if (hits.length === 1) return { targets: [pageByAbs.get(hits[0]!)!.id], status: 'match', reason: null };
    if (hits.length > 1) return { targets: hits.map((h) => pageByAbs.get(h)!.id), status: 'ambiguous', reason: 'ambiguous_template_root' };
    return { targets: [], status: 'unknown', reason: cands.some(onDisk) ? 'not_indexed' : 'unresolved_url' };
  };
  // `{% block name %}` … `{% endblock %}` ranges of a page, as text offsets
  const blocksOf = (pageId: string): Map<string, [number, number]> => {
    const out2 = new Map<string, [number, number]>(); const pt = textOfPage(pageId); if (!pt) return out2;
    const stack: { name: string; start: number }[] = [];
    for (const m of pt.text.matchAll(/\{%-?\s*(block|endblock)\b\s*([\w.]*)[\s\S]*?%\}/g)) {
      if (m[1] === 'block') stack.push({ name: m[2]!, start: m.index });
      else { const b = stack.pop(); if (b && !out2.has(b.name)) out2.set(b.name, [b.start, m.index + m[0].length]); }
    }
    return out2;
  };
  const offsetOfEl = (e: El): number => { const pt = textOfPage(elPage.get(e.id)?.id ?? ''); const [l, c] = posOf(e); return pt ? offsetOf(pt, l, c) : -1; };
  const innermostAt = (pageId: string, off: number, strict = false): El | null => {
    let best: El | null = null; let bestStart = -1;
    const pt = textOfPage(pageId); if (!pt) return null;
    for (const e of pages.get(pageId)?.elements ?? []) {
      const r = elRow.get(e.id)!; const s0 = offsetOf(pt, num(g(T.el, r, 'startLine')) ?? 0, num(g(T.el, r, 'startColumn')) ?? 0);
      const e0 = offsetOf(pt, num(g(T.el, r, 'endLine')) ?? 0, num(g(T.el, r, 'endColumn')) ?? 0);
      if ((strict ? s0 < off : s0 <= off) && off < e0 && s0 >= bestStart && !VOID_ELEMENTS.has(e.tagLower)) { best = e; bestStart = s0; }
    }
    return best;
  };
  const includeRow = (host: string, frag: string | null, kind: string, hostEl: El | null, position: number | null, refId: string | null, url: string, line: number | null,
    col: number | null, args: string | null, status: string, reason: string | null) => {
    out('web_includes').push({ host_page_uid: host, fragment_page_uid: frag, kind, host_element_uid: hostEl?.id ?? null, position, reference_uid: refId, url_as_written: url,
      file: fileOfPage(host), line, col, args, status, reason });
  };
  // the args an include passes, as written: gulp's second argument, posthtml's `locals`
  const includeArgs = (page: Page, r: string[], flavour: string, owner: El | null): string | null => {
    if (flavour === 'posthtml:include') return owner?.attrs.get('locals')?.value || null;
    if (flavour !== 'gulp:@@include') return null;
    const pt = textOfPage(page.id); if (!pt) return null;
    const off = offsetOf(pt, num(g(T.ref, r, 'startLine')) ?? 0, num(g(T.ref, r, 'startColumn')) ?? 0);
    const m = /^@@include\(\s*(?:"[^"]*"|'[^']*')/.exec(pt.text.slice(off)); if (!m) return null;
    let depth = 0; let q = ''; let j = off + m[0].length;
    for (; j < pt.text.length; j++) {
      const c = pt.text[j]!;
      if (q) { if (c === '\\') { j++; continue; } if (c === q) q = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '{' || c === '[' || c === '(') depth++; else if (c === '}' || c === ']') depth--;
      else if (c === ')') { if (depth === 0) break; depth--; }
    }
    const a = /^\s*,([\s\S]*)$/.exec(pt.text.slice(off + m[0].length, j));
    return a ? a[1]!.trim() || null : null;
  };
  // phase 1: every include reference resolved; the composing ones (match, not import/extends) kept as edges
  interface Edge { host: string; frag: string; flavour: string; refId: string; url: string; at: [number, number]; hostEl: El | null; position: number; args: string | null; replaced: El | null; cut: string }
  const edges: Edge[] = [];
  const extendsPending: { page: Page; layout: string; refId: string; url: string; at: [number, number] }[] = [];
  const includeResolved = new Map<string, string>(); // reference -> the page file it resolved to (web_references.resolved_file)
  for (const page of pages.values()) {
    for (const r of refsOfPage.get(page.id) ?? []) {
      if (g(T.ref, r, 'referenceKind') !== 'INCLUDE') continue;
      const flavour = g(T.ref, r, 'attributeName'); const refId = g(T.ref, r, 'htmlReferenceUniqueHash'); const url = g(T.ref, r, 'urlAsWritten');
      const at: [number, number] = [num(g(T.ref, r, 'startLine')) ?? 0, num(g(T.ref, r, 'startColumn')) ?? 0];
      const owner = elById.get(g(T.ref, r, 'ownerElementLinkHash')) ?? null;
      const res = resolveInclude(page, r, flavour);
      if (res.status === 'match') includeResolved.set(refId, pages.get(res.targets[0]!)!.abs);
      if (flavour === 'jinja:extends') {
        // the extending page (this one) is the fragment; the layout it names is the host its blocks are matched in. The
        // row sits where the extends tag is written, in the extending page.
        if (res.status === 'match') { extendsPending.push({ page, layout: res.targets[0]!, refId, url, at }); continue; }
        for (const layout of res.targets.length ? res.targets : [null]) {
          out('web_includes').push({ host_page_uid: layout, fragment_page_uid: page.id, kind: flavour, host_element_uid: null, position: null, reference_uid: refId,
            url_as_written: url, file: page.file, line: at[0], col: at[1], args: null, status: res.status, reason: res.reason });
        }
        unknownRow('include', refId, page.id, res.reason ?? res.status, url, page.file, at[0]);
        continue;
      }
      // `<include src>` is replaced by the fragment: the include element's parent hosts it, at the include element's place
      const replaced = flavour === 'posthtml:include' && owner && owner.tagLower === 'include' ? owner : null;
      const hostEl = replaced ? replaced.parent : owner;
      const position = replaced ? (replaced.parent ? replaced.parent.children : topOf(page.id)).indexOf(replaced) : positionAt(page.id, hostEl, at);
      const args = includeArgs(page, r, flavour, owner);
      if (res.targets.length === 0) { includeRow(page.id, null, flavour, hostEl, position, refId, url, at[0], at[1], args, res.status, res.reason); unknownRow('include', refId, page.id, res.reason!, url, page.file, at[0]); continue; }
      // a macro import is a reference only (ruling): no web_includes row, no host (it imports macros, not markup)
      if (flavour === 'jinja:import') continue;
      if (res.status !== 'match') {
        // listed, never composed: an ambiguous name (one row per candidate)
        for (const frag of res.targets) includeRow(page.id, frag, flavour, hostEl, position, refId, url, at[0], at[1], args, res.status, res.reason);
        if (res.status === 'ambiguous') unknownRow('include', refId, page.id, res.reason!, url, page.file, at[0]);
        continue;
      }
      edges.push({ host: page.id, frag: res.targets[0]!, flavour, refId, url, at, hostEl, position, args, replaced, cut: '' });
    }
  }
  // phase 2: cycles and over-deep chains are cut where they close on the expansion stack, walking from every document
  // page and then from every fragment nothing includes, includes in source order; the cut include is unknown
  {
    const out2 = new Map<string, Edge[]>(); for (const e of edges) push(out2, e.host, e);
    for (const es of out2.values()) es.sort((a, b) => (a.at[0] - b.at[0]) || (a.at[1] - b.at[1]));
    const targeted = new Set(edges.map((e) => e.frag));
    const roots = [...pages.values()].filter((p) => p.kind !== 'FRAGMENT').concat([...pages.values()].filter((p) => p.kind === 'FRAGMENT' && !targeted.has(p.id)))
      .map((p) => p.id);
    const dfs = (pid: string, stack: string[]) => {
      for (const e of out2.get(pid) ?? []) {
        if (e.cut) continue;
        if (stack.includes(e.frag)) { e.cut = 'include_cycle'; continue; }
        if (stack.length > 8) { e.cut = 'include_depth'; continue; }
        dfs(e.frag, [...stack, e.frag]);
      }
    };
    for (const r0 of roots) dfs(r0, [r0]);
    // a cycle no root reaches (fragments that only include each other) is cut from its first page in file order
    for (const p of [...pages.values()].sort((a, b) => (a.file < b.file ? -1 : 1))) dfs(p.id, [p.id]);
  }
  // phase 3: the rows, and what each host composes
  for (const e of edges) {
    if (e.cut) {
      includeRow(e.host, e.frag, e.flavour, e.hostEl, e.position, e.refId, e.url, e.at[0], e.at[1], e.args, 'unknown', e.cut);
      unknownRow('include', e.refId, e.host, e.cut, e.url, fileOfPage(e.host), e.at[0]);
      continue;
    }
    includeRow(e.host, e.frag, e.flavour, e.hostEl, e.position, e.refId, e.url, e.at[0], e.at[1], e.args, 'match', null);
    hosted.add(e.frag);
    push(hostsOfFragment, e.frag, { host: e.host, hostEl: e.hostEl, line: e.at[0], col: e.at[1] });
    const ins = includeInserts.get(e.host) ?? []; includeInserts.set(e.host, ins);
    ins.push({ hostEl: e.hostEl, at: e.at, position: e.position, frag: e.frag, elems: null, removes: new Set(e.replaced ? [e.replaced.id] : []), ref: e.refId });
  }
  for (const r of T.ref.rows) {
    if (g(T.ref, r, 'referenceKind') !== 'INCLUDE') continue;
    const d = g(T.ref, r, 'documentLinkHash'); const id = g(T.ref, r, 'htmlReferenceUniqueHash');
    const abs = includeResolved.get(id) ?? g(T.ref, r, 'resolvedFilePath');
    out('web_references').push({ uid: id, element_uid: nz(g(T.ref, r, 'ownerElementLinkHash')), page_uid: d, file: fileOfPage(d),
      line: num(g(T.ref, r, 'startLine')), col: num(g(T.ref, r, 'startColumn')), reference_kind: 'INCLUDE', attribute_name: nz(g(T.ref, r, 'attributeName')),
      url_as_written: g(T.ref, r, 'urlAsWritten'), url_kind: g(T.ref, r, 'urlKind'), path: nz(g(T.ref, r, 'path')), query: nz(g(T.ref, r, 'query')),
      fragment: nz(g(T.ref, r, 'fragment')), resolved_file: onDisk(abs) ? rel(abs) : null, is_resolved: abs ? 1 : 0 });
  }
  for (const x of extendsPending) {
    const { page, layout } = x;
    out('web_includes').push({ host_page_uid: layout, fragment_page_uid: page.id, kind: 'jinja:extends', host_element_uid: null, position: null, reference_uid: x.refId,
      url_as_written: x.url, file: page.file, line: x.at[0], col: x.at[1], args: null, status: 'match', reason: null });
    hosted.add(page.id);
    const lb = blocksOf(layout); const cb = blocksOf(page.id); const inserts: Insert[] = [];
    for (const [name, [cs, ce]] of cb) {
      const span = lb.get(name); if (!span) continue;
      const hostEl = innermostAt(layout, span[0]);
      const lpt = textOfPage(layout)!;
      const removes = new Set((hostEl ? hostEl.children : topOf(layout)).filter((e) => { const o = offsetOfEl(e); return o > span[0] && o < span[1]; }).map((e) => e.id));
      const blockAt = lpt ? (() => { const lineIdx = lpt.starts.findIndex((_st0, i) => (lpt.starts[i + 1] ?? Infinity) > span[0]); return [lineIdx + 1, span[0] - lpt.starts[lineIdx]! + 1] as [number, number]; })() : x.at;
      const elems = (pages.get(page.id)?.elements ?? []).filter((e) => { const o = offsetOfEl(e); if (o <= cs || o >= ce) return false; const po = e.parent ? offsetOfEl(e.parent) : -1; return !e.parent || po <= cs || po >= ce; })
        .sort((a, b) => offsetOfEl(a) - offsetOfEl(b));
      inserts.push({ hostEl, at: blockAt, position: (hostEl ? hostEl.children : topOf(layout)).filter((c) => before(posOf(c), blockAt)).length, frag: page.id, elems, removes, ref: null });
    }
    extendsComps.push({ layout, child: page.id, inserts });
  }
  // ASSERTED INCLUDES (`axiomcode link <fragment>:1 <host>:<line>`, SPEC §11.2): where no include reference exists or it
  // does not resolve, the agent says where the fragment goes. They are read from axiomcode-web-links.tsv (the source
  // directory or the nearest ancestor holding one; paths relative to that file), kind and status `asserted`, the element
  // the line sits in being the host element. One that names no page, or a line the host does not have, is a row with
  // status unknown and its reason, never applied.
  {
    let linksFile = process.env.AXIOMCODE_WEB_LINKS || '';
    // review #23: from the source directory up to the repository it is in (the first ancestor holding .git or .axiomcode),
    // never above it: a links file in a home directory applies to no build under it
    if (!linksFile && root) for (let d = root; ; d = path.dirname(d)) {
      const f = path.join(d, 'axiomcode-web-links.tsv'); if (onDisk(f)) { linksFile = f; break; }
      if (fs.existsSync(path.join(d, '.git')) || fs.existsSync(path.join(d, '.axiomcode')) || d === path.dirname(d)) break;
    }
    let lines: string[] = [];
    try { lines = linksFile ? fs.readFileSync(linksFile, 'utf8').split('\n') : []; } catch { lines = []; }
    const base = linksFile ? path.dirname(linksFile) : root;
    for (const raw of lines) {
      if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
      const [fragRel = '', hostRel = '', lineText = ''] = raw.split('\t');
      const frag = pageByAbs.get(path.resolve(base, fragRel)); const host = pageByAbs.get(path.resolve(base, hostRel));
      const line = Number(lineText.trim());
      const reject = (reason: string) => out('web_includes').push({ host_page_uid: host?.id ?? null, fragment_page_uid: frag?.id ?? null, kind: 'asserted', host_element_uid: null,
        position: null, reference_uid: null, url_as_written: fragRel, file: host ? host.file : hostRel, line: Number.isFinite(line) ? line : null, col: null, args: null, status: 'unknown', reason });
      if (!frag) { reject('fragment_not_a_page'); continue; }
      if (!host) { reject('host_not_a_page'); continue; }
      if (frag.id === host.id) { reject('fragment_is_host'); continue; }
      const pt = textOfPage(host.id);
      if (!pt || !Number.isInteger(line) || line < 1 || line > pt.starts.length) { reject('no_such_line'); continue; }
      // the element the line sits in: one that STARTS on the line is the included content's sibling, not its host
      const hostEl = innermostAt(host.id, pt.starts[line - 1]! + ((/^\s*/.exec(pt.text.slice(pt.starts[line - 1]!, pt.starts[line] ?? pt.text.length))?.[0].length) ?? 0), true);
      const at: [number, number] = [line, 1];
      const position = positionAt(host.id, hostEl, at);
      includeRow(host.id, frag.id, 'asserted', hostEl, position, null, fragRel, line, 1, null, 'asserted', null);
      hosted.add(frag.id);
      push(hostsOfFragment, frag.id, { host: host.id, hostEl, line, col: 1 });
      const ins = includeInserts.get(host.id) ?? []; includeInserts.set(host.id, ins);
      ins.push({ hostEl, at, position, frag: frag.id, elems: null, removes: new Set(), ref: null });
    }
  }
  for (const p of pages.values()) {
    if (p.kind === 'FRAGMENT' && !hosted.has(p.id)) unknownRow('fragment_no_host', p.id, p.id, 'fragment_no_host', 'a fragment page is matched only in a host page that includes it', p.file, 1);
  }
  // the composed tree of a host: its elements cloned, each fragment's (composed in turn) inserted where it is included
  type CEl = El & { origId: string; origPage: string; viaExtends?: boolean };
  let cloneSeq = 0;
  const cycleSeen = new Set<string>();
  const compose = (rootPage: string, extra: Insert[]): CEl[] => {
    const insertsOf = (pageId: string, depthPages: string[]): Insert[] => [...(includeInserts.get(pageId) ?? []), ...(depthPages.length === 1 ? extra : [])];
    const clone = (e: El, pageId: string, parent: CEl | null, stack: string[], viaExtends = false): CEl => {
      // an element placed under a <template>/<noscript> (or inside an inert subtree) of its host is inert there too
      const hostInert = parent ? (parent.inert || ((parent.tagLower === 'template' || parent.tagLower === 'noscript') && (parent.ns === 'HTML' || parent.ns === '') ? parent.tagLower : '')) : '';
      const c: CEl = { ...e, id: `${e.id}@${++cloneSeq}`, origId: e.id, origPage: pageId, parent: parent as El | null, children: [], idx: 0,
        inert: e.inert || hostInert, viaExtends: viaExtends || parent?.viaExtends || false };
      c.children = place(e.children, e, pageId, c, stack);
      c.childCount = c.children.length;
      return c;
    };
    const place = (list: El[], hostEl: El | null, pageId: string, parent: CEl | null, stack: string[]): CEl[] => {
      const ins = insertsOf(pageId, stack).filter((x) => x.hostEl === hostEl);
      const removes = new Set(ins.flatMap((x) => [...x.removes]));
      const orig = [...list].sort((a, b) => a.position - b.position);
      const kept = orig.filter((e) => !removes.has(e.id));
      // an insert's position counts the children as written; where removed ones (a replaced `<include>`, a layout block's
      // default content) stood before it, it moves up by as many
      const at = (x: Insert): number => orig.slice(0, x.position).filter((e) => !removes.has(e.id)).length;
      const out2: CEl[] = [];
      const addFrag = (x: Insert) => {
        if (x.elems) { for (const e of x.elems) out2.push(clone(e, x.frag, parent, [...stack, x.frag], true)); return; }
        if (stack.includes(x.frag) || stack.length > 8) {
          const k = `${stack[stack.length - 1]}>${x.frag}`;
          if (!cycleSeen.has(k)) { cycleSeen.add(k); unknownRow('include', x.frag, stack[stack.length - 1]!, 'include_cycle', stack.map((s0) => fileOfPage(s0)).join(' > '), fileOfPage(stack[stack.length - 1]!), x.at[0]); }
          return;
        }
        for (const e of topOf(x.frag)) out2.push(clone(e, x.frag, parent, [...stack, x.frag]));
      };
      kept.forEach((e, i) => {
        for (const x of ins) if (at(x) === i) addFrag(x);
        out2.push(clone(e, pageId, parent, stack));
      });
      for (const x of ins) if (at(x) >= kept.length) addFrag(x);
      out2.forEach((c, i) => { c.position = i; });
      return out2;
    };
    const top = place(topOf(rootPage), null, rootPage, null, [rootPage]);
    const flat: CEl[] = [];
    const walk = (c: CEl) => { c.idx = flat.length; flat.push(c); for (const k of c.children) walk(k as CEl); };
    for (const c of top) walk(c);
    return flat;
  };

  // scripts: every <script>, in page order, with its type and attributes, and an inline one's body as written
  // (sliced from the file by the parser's body range: CRLF kept, nothing trimmed). Nothing reads it as JavaScript.
  {
    const byPage = new Map<string, string[][]>();
    for (const r of T.script.rows) push(byPage, g(T.script, r, 'documentLinkHash'), r);
    for (const [d, rows] of byPage) {
      rows.sort((a, b) => { const sa = startOf(g(T.script, a, 'ownerElementLinkHash')), sb = startOf(g(T.script, b, 'ownerElementLinkHash')); return (sa[0] - sb[0]) || (sa[1] - sb[1]); });
      let inlineN = 0;
      rows.forEach((r, i) => {
        const id = g(T.script, r, 'htmlScriptUniqueHash');
        let kind = g(T.script, r, 'scriptKind');
        let abs = g(T.script, r, 'resolvedFilePath');
        const owner = g(T.script, r, 'ownerElementLinkHash');
        // an SVG <script href="…"> (or xlink:href) is an external script: the parser reads only src
        const ownerAttrs = elById.get(owner)?.attrs;
        const svgHref = !g(T.script, r, 'src') ? (ownerAttrs?.get('href') ?? ownerAttrs?.get('xlink:href')) : undefined;
        let srcText = g(T.script, r, 'src');
        if (svgHref && svgHref.hasValue && svgHref.value.trim() !== '') {
          kind = 'EXTERNAL'; srcText = svgHref.value.trim();
          if (root && !/^[a-z][\w+.-]*:|^\/\//i.test(srcText)) {
            const pagePath = path.join(root, fileOfPage(d) ?? '');
            const p0 = srcText.split(/[?#]/)[0]!;
            abs = p0.startsWith('/') ? path.join(root, p0) : path.resolve(path.dirname(pagePath), p0);
          }
        }
        const resolved = onDisk(abs) ? rel(abs) : null;
        const sl = num(g(T.script, r, 'bodyStartLine')), sc = num(g(T.script, r, 'bodyStartColumn')), el = num(g(T.script, r, 'bodyEndLine')), ec = num(g(T.script, r, 'bodyEndColumn'));
        let body: string | null = null;
        if (kind === 'INLINE' && sl !== null && sc !== null && el !== null && ec !== null && sl > 0) {
          const pt = textOfPage(d);
          // an empty body is "" (0 lines); NULL means only stale_source
          if (pt) body = pt.text.slice(offsetOf(pt, sl, sc), offsetOf(pt, el, ec));
          // the file changed since it was parsed: the range no longer holds the body
          const want = num(g(T.script, r, 'bodyLength'));
          if (body !== null && want !== null && body.length !== want) { unknownRow('stale_source', id, d, 'stale_source', 'the page changed since it was parsed', fileOfPage(d), sl); body = null; }
        }
        const inlineIndex = kind === 'INLINE' ? ++inlineN : null;
        out('web_scripts').push({ uid: id, element_uid: owner, page_uid: d, file: fileOfPage(d), line: startOf(owner)[0] || null, col: startOf(owner)[1] || null,
          order_on_page: i + 1, script_kind: kind, script_type: g(T.script, r, 'scriptType'), type_as_written: nz(g(T.script, r, 'typeAsWritten')),
          src: nz(srcText), resolved_file: resolved,
          is_module: g(T.script, r, 'scriptType') === 'MODULE' ? 1 : 0, is_async: bool(g(T.script, r, 'isAsync')), is_defer: bool(g(T.script, r, 'isDefer')),
          is_nomodule: bool(g(T.script, r, 'isNoModule')), body_start_line: sl, body_start_col: sc, body_end_line: el, body_end_col: ec,
          attributes: JSON.stringify(Object.fromEntries([...(elById.get(owner)?.attrs ?? new Map())].map(([k, v]) => [k, v.hasValue ? v.value : '']))),
          // V3-10a: the attributes as written, only when entity decoding changed one of them
          attributes_raw: [...(elById.get(owner)?.attrs ?? new Map()).values()].some((v) => v.raw !== null)
            ? JSON.stringify(Object.fromEntries([...(elById.get(owner)?.attrs ?? new Map())].map(([k, v]) => [k, v.hasValue ? (v.raw ?? v.value) : '']))) : null,
          body_length: num(g(T.script, r, 'bodyLength')), body_lines: body === null ? null : body === '' ? 0 : body.split(/\r\n|\r|\n/).length,
          body_bytes: body === null ? null : Buffer.byteLength(body, 'utf8'), body, inline_index: inlineIndex });
      });
    }
  }
  // handlers (SPEC §10): one row per handler-bearing attribute or javascript: URL on an HTML tag, the code as the
  // attribute value reads (entities decoded, nothing else); no JavaScript is parsed. The decision rules and the
  // look-alikes that are NOT handlers (data-on*, onboarding/once, @ on a page with no Vue/Alpine, ng-if, data-action
  // without a # descriptor) are the SPEC's table, applied to the attribute name as written, case-insensitively.
  {
    const ANGULARJS = /^(?:data-)?ng-(click|dblclick|submit|change|blur|focus|keydown|keyup|keypress|mousedown|mouseup|mouseenter|mouseleave|mouseover|mousemove|copy|cut|paste)$/i;
    const dialectsOf = new Map<string, Set<string>>();
    // a page's Vue/Alpine dialect, from its template expressions other than bare `@x` attributes: a stray `@media="…"` must not
    // make its own page a Vue page (SPEC §10 look-alikes)
    const atAttr = new Set<string>();
    for (const r of T.attr.rows) if (g(T.attr, r, 'name').startsWith('@')) atAttr.add(g(T.attr, r, 'htmlAttributeUniqueHash'));
    for (const r of T.tpl.rows) {
      const a = g(T.tpl, r, 'attributeLinkHash'); if (a && atAttr.has(a)) continue;
      const d = g(T.tpl, r, 'documentLinkHash'); let ds = dialectsOf.get(d); if (!ds) { ds = new Set(); dialectsOf.set(d, ds); }
      ds.add(g(T.tpl, r, 'dialect').toUpperCase());
    }
    const hostDialects = (page: string): Set<string> | null => {
      const hs = hostsOfFragment.get(page); if (!hs) return null;
      const set = new Set<string>(); for (const h of hs) for (const d of dialectsOf.get(h.host) ?? []) if (d === 'VUE' || d === 'ALPINE') set.add(d);
      return set.size ? set : null;
    };
    const alpineScope = (e: El | undefined): boolean => { for (let a = e ?? null; a; a = a.parent) if (a.attrs.has('x-data')) return true; return false; };
    const mods = (s: string, sep: string): string => s.split(sep).filter(Boolean).join(',');
    interface H { kind: string; event: string; modifiers: string; code?: string; source?: string }
    // Stimulus's default event per tag (SPEC §10 ruling): used when a descriptor names none; event_source says so
    const stimulusDefault = (e: El | undefined): string | null => {
      const t = e?.tagLower ?? ''; const type = (e?.attrs.get('type')?.value ?? '').toLowerCase();
      if (t === 'a' || t === 'button') return 'click';
      if (t === 'input') return ['submit', 'button', 'reset'].includes(type) ? 'click' : 'input';
      return ({ textarea: 'input', select: 'change', form: 'submit', details: 'toggle' } as Record<string, string>)[t] ?? null;
    };
    const classify = (written: string, value: string, e: El | undefined, page: string): H[] => {
      // match on the lowercased name, read events and modifiers from the name as written (same length, same positions)
      const n = written.toLowerCase();
      const W = (re: RegExp): RegExpExecArray | null => (re.exec(n) ? re.exec(written) : null);
      let m: RegExpExecArray | null;
      // a fragment included somewhere takes its hosts' Vue/Alpine dialect, not its own guess (SPEC §11.2)
      const hostDial = hostDialects(page);
      const dial = hostDial ?? dialectsOf.get(page) ?? new Set<string>();
      if ((m = /^on([a-z][a-z0-9]*)$/.exec(n))) return KNOWN_EVENTS.has(m[1]!) ? [{ kind: 'on_attribute', event: m[1]!, modifiers: '' }] : [];
      const ev = (x: string): string => (x.startsWith('[') ? x : x.toLowerCase());
      if ((m = W(/^v-on:([\w-]+(?::[\w-]+)?|\[[^\]]+\])((?:\.[\w-]+)*)$/i))) return [{ kind: 'vue', event: ev(m[1]!), modifiers: mods(m[2]!, '.') }];
      if ((m = W(/^x-on:([\w-]+(?::[\w-]+)?|\[[^\]]+\])((?:\.[\w-]+)*)$/i))) return [{ kind: 'alpine', event: ev(m[1]!), modifiers: mods(m[2]!, '.') }];
      if ((m = W(/^@([\w-]+(?::[\w-]+)?|\[[^\]]+\])((?:\.[\w-]+)*)$/i))) {
        const vue = dial.has('VUE'), alpine = dial.has('ALPINE');
        if (!vue && !alpine) return [];
        return [{ kind: vue && alpine ? (alpineScope(e) ? 'alpine' : 'vue') : alpine ? 'alpine' : 'vue', event: ev(m[1]!), modifiers: mods(m[2]!, '.') }];
      }
      if ((m = W(/^\(([\w-]+)((?:\.[\w-]+)*)\)$/i))) return [{ kind: 'angular', event: ev(m[1]!), modifiers: mods(m[2]!, '.') }];
      if ((m = /^on-([a-z][\w-]*)$/.exec(n))) return KNOWN_EVENTS.has(m[1]!) ? [{ kind: 'angular', event: m[1]!, modifiers: '' }] : [];
      if ((m = ANGULARJS.exec(n))) return [{ kind: 'angularjs', event: m[1]!.toLowerCase(), modifiers: '' }];
      if ((m = W(/^on:([\w-]+)((?:\|[\w-]+)*)$/i))) return [{ kind: 'svelte', event: ev(m[1]!), modifiers: mods(m[2]!, '|') }];
      if ((m = /^hx-on::([\w:.-]+)$/.exec(n))) return [{ kind: 'htmx', event: `htmx:${m[1]}`, modifiers: '' }];
      if ((m = /^hx-on:([\w:.-]+)$/.exec(n)) || (m = /^hx-on-([\w-]+)$/.exec(n))) return [{ kind: 'htmx', event: m[1]!, modifiers: '' }];
      if (n === 'data-action' && value.includes('#')) {
        return value.trim().split(/\s+/).filter((d) => d.includes('#')).map((d) => {
          const dm = /^(?:([\w:.@-]+)->)?(.+)$/.exec(d)!;
          // the event as written, else the tag's default (event_source stimulus_default / _unknown);
          // `keydown.esc@window` -> event keydown, modifiers esc,@window
          const evw = dm[1];
          if (!evw) { const dflt = stimulusDefault(e); return { kind: 'stimulus', event: dflt ?? '', modifiers: '', code: dm[2]!, source: dflt ? 'stimulus_default' : 'stimulus_default_unknown' }; }
          const at = evw.indexOf('@'); const head = at >= 0 ? evw.slice(0, at) : evw; const glob = at >= 0 ? evw.slice(at) : '';
          const evParts = head.split('.');
          return { kind: 'stimulus', event: evParts[0]!.toLowerCase(), modifiers: [...evParts.slice(1), ...(glob ? [glob] : [])].filter(Boolean).join(','), code: dm[2]! };
        });
      }
      return [];
    };
    /** the attribute name as written in the source (the IR lowercases an HTML attribute's name) */
    const writtenName = (pageId: string, line: number | null, col: number | null, fallback: string): string => {
      const pt = line !== null && col !== null ? textOfPage(pageId) : null;
      if (!pt) return fallback;
      const at = offsetOf(pt, line!, col!);
      const got = pt.text.slice(at, at + fallback.length);
      return got.toLowerCase() === fallback.toLowerCase() ? got : fallback;
    };
    const handlersByPage = new Map<string, Record<string, string | number | null>[]>();
    for (const r of T.attr.rows) {
      const prefix = g(T.attr, r, 'prefix'), name0 = g(T.attr, r, 'name');
      const name = prefix ? `${prefix}:${name0}` : name0;
      if (g(T.attr, r, 'hasValue') !== 'true') continue;
      const elId = g(T.attr, r, 'ownerElementLinkHash'); const e = elById.get(elId);
      if (e?.inert === 'iframe_text') continue;
      const d = g(T.attr, r, 'documentLinkHash');
      const value = unesc(g(T.attr, r, 'value')); const raw = nz(unesc(g(T.attr, r, 'valueRaw')));
      const line = num(g(T.attr, r, 'startLine')), col = num(g(T.attr, r, 'startColumn'));
      if (!/^(?:on|v-on:|x-on:|@|\(|(?:data-)?ng-|hx-on|data-action$)/i.test(name)) continue;
      const written = writtenName(d, line, col, name);
      const hs = classify(written, value, e, d);
      if (hs.length === 0) continue;
      hs.forEach((h, i) => {
        const code = h.code ?? value;
        push(handlersByPage, d, { uid: hs.length > 1 ? `${g(T.attr, r, 'htmlAttributeUniqueHash')}#${i + 1}` : g(T.attr, r, 'htmlAttributeUniqueHash'),
          element_uid: elId, attribute_uid: g(T.attr, r, 'htmlAttributeUniqueHash'), page_uid: d, file: fileOfPage(d), tag: e?.tag ?? null, attr_as_written: written,
          event: h.event, event_source: h.source ?? 'written', modifiers: h.modifiers, source_kind: h.kind, code, code_raw: h.code === undefined ? raw : null, code_bytes: Buffer.byteLength(code, 'utf8'), line, col, handler_index: null,
          known_event: KNOWN_EVENTS.has(h.event) ? 1 : 0 });
      });
    }
    for (const r of T.ref.rows) {
      if (g(T.ref, r, 'urlKind') !== 'JAVASCRIPT_URI') continue;
      const attr = g(T.ref, r, 'attributeName');
      if (!['href', 'src', 'action', 'formaction', 'xlink:href'].includes(attr.toLowerCase())) continue;
      const d = g(T.ref, r, 'documentLinkHash'); const elId = g(T.ref, r, 'ownerElementLinkHash');
      if (elById.get(elId)?.inert === 'iframe_text') continue;
      const code = g(T.ref, r, 'urlAsWritten').replace(/^\s*javascript:/i, '');
      // V4-03 ruling: `javascript:`, `javascript:;`, `javascript:void(0)` / `void 0` run nothing: a no-op link, no handler
      if (/^\s*(?:;|void\s*\(\s*0\s*\)|void\s+0)?\s*;?\s*$/i.test(code)) continue;
      const rawAttr = attrRow.get(g(T.ref, r, 'attributeLinkHash')); const raw = rawAttr ? nz(unesc(g(T.attr, rawAttr, 'valueRaw'))) : null;
      const line = num(g(T.ref, r, 'startLine')), col = num(g(T.ref, r, 'startColumn'));
      push(handlersByPage, d, { uid: g(T.ref, r, 'htmlReferenceUniqueHash'), element_uid: elId, attribute_uid: nz(g(T.ref, r, 'attributeLinkHash')), page_uid: d,
        file: fileOfPage(d), tag: elById.get(elId)?.tag ?? null, attr_as_written: writtenName(d, line, col, attr), event: 'navigate', event_source: 'written', modifiers: '',
        source_kind: 'javascript_url', code, code_raw: raw === null ? null : raw.replace(/^\s*javascript:/i, ''), code_bytes: Buffer.byteLength(code, 'utf8'), line, col, handler_index: null, known_event: null });
    }
    for (const rows of handlersByPage.values()) {
      rows.sort((a, b) => ((a.line as number) - (b.line as number)) || ((a.col as number) - (b.col as number)));
      rows.forEach((row, i) => { row.handler_index = i + 1; out('web_handlers').push(row); });
    }
  }
  for (const r of T.handler.rows) {
    // a call with no name (an IIFE in an on* body) is no join key; the calls inside it are rows of their own
    if (!g(T.handler, r, 'calleeName')) continue;
    const d = g(T.handler, r, 'documentLinkHash');
    const attrId = g(T.handler, r, 'attributeLinkHash');
    const src = g(T.handler, r, 'handlerSource');
    const n = onIndex.get(attrId);
    out('web_handler_calls').push({ uid: g(T.handler, r, 'htmlHandlerCallUniqueHash'), element_uid: g(T.handler, r, 'ownerElementLinkHash'), attribute_uid: nz(attrId),
      page_uid: d, file: fileOfPage(d), line: num(g(T.handler, r, 'startLine')), col: num(g(T.handler, r, 'startColumn')), handler_source: src,
      event: nz(g(T.handler, r, 'eventName')), callee_name: nz(g(T.handler, r, 'calleeName')), receiver: nz(g(T.handler, r, 'receiverText')),
      callee_text: nz(g(T.handler, r, 'calleeText')), argument_count: num(g(T.handler, r, 'argumentCount')), is_new: bool(g(T.handler, r, 'isNew')),
      handler_index: src === 'EVENT_ATTRIBUTE' && n !== undefined ? n : null });
  }
  /** an SSI directive as written, `<!--#…-->`, sliced from the page */
  const ssiText = (pageId: string, line: number | null, col: number | null): string | null => {
    const pt = line !== null && col !== null ? textOfPage(pageId) : null; if (!pt) return null;
    const at = offsetOf(pt, line!, col!); const end = pt.text.indexOf('-->', at);
    return pt.text.startsWith('<!--', at) && end >= 0 ? pt.text.slice(at, end + 3) : null;
  };
  for (const r of T.tpl.rows) {
    const d = g(T.tpl, r, 'documentLinkHash');
    // V3-10b: an SSI directive is not a template expression. `#include` is an INCLUDE reference (web_includes); the rest
    // (#set, #echo, #if, #config, ...) are web_ssi_directives rows
    if (g(T.tpl, r, 'dialect') === 'SSI') {
      if (g(T.tpl, r, 'directive') !== 'include') {
        out('web_ssi_directives').push({ uid: g(T.tpl, r, 'htmlTemplateExpressionUniqueHash'), element_uid: nz(g(T.tpl, r, 'ownerElementLinkHash')), page_uid: d,
          file: fileOfPage(d), line: num(g(T.tpl, r, 'startLine')), col: num(g(T.tpl, r, 'startColumn')), directive: g(T.tpl, r, 'directive'),
          expression_kind: g(T.tpl, r, 'expressionKind'), args: nz(unesc(g(T.tpl, r, 'expressionText'))), text: ssiText(d, num(g(T.tpl, r, 'startLine')), num(g(T.tpl, r, 'startColumn'))) });
      }
      continue;
    }
    out('web_template_exprs').push({ uid: g(T.tpl, r, 'htmlTemplateExpressionUniqueHash'), element_uid: nz(g(T.tpl, r, 'ownerElementLinkHash')),
      attribute_uid: nz(g(T.tpl, r, 'attributeLinkHash')), page_uid: d, file: fileOfPage(d), line: num(g(T.tpl, r, 'startLine')), col: num(g(T.tpl, r, 'startColumn')),
      dialect: g(T.tpl, r, 'dialect'), expression_kind: g(T.tpl, r, 'expressionKind'), directive: nz(g(T.tpl, r, 'directive')), argument: nz(g(T.tpl, r, 'argument')),
      modifiers: nz(g(T.tpl, r, 'modifiers')), expression_text: nz(unesc(g(T.tpl, r, 'expressionText'))), callee_names: nz(g(T.tpl, r, 'calleeNames')),
      identifiers: nz(g(T.tpl, r, 'identifiers')), declares: nz(g(T.tpl, r, 'declares')) });
  }
  for (const r of T.hgap.rows) {
    const d = g(T.hgap, r, 'documentLinkHash');
    out('web_gaps').push({ uid: g(T.hgap, r, 'htmlParseGapUniqueHash'), lang: 'html', gap_kind: g(T.hgap, r, 'gapKind'), detail: nz(g(T.hgap, r, 'detail')), owner_uid: d,
      related_uid: nz(g(T.hgap, r, 'relatedElementLinkHash')), element_uid: nz(g(T.hgap, r, 'relatedElementLinkHash')), file: fileOfPage(d), line: num(g(T.hgap, r, 'startLine')), col: num(g(T.hgap, r, 'startColumn')),
      end_line: num(g(T.hgap, r, 'endLine')), end_col: num(g(T.hgap, r, 'endColumn')) });
  }

  // ── stylesheets ──
  interface RuleN {
    id: string; sheet: string; parent: string; kind: string; at: string; name: string; prelude: string; line: number; col: number;
    order: number; layer: string; conditions: string[]; condNames: string[]; matchable: boolean; inKeyframes: boolean; inScope: boolean; important: number;
    import?: { to: string | null; vref: string; media: string; supports: string; layer: string | null; url: string; reason: string | null };
  }
  interface Sheet { id: string; file: string; abs: string; kind: string; page: string; owner: string; display: string; rules: RuleN[] }
  const sheets = new Map<string, Sheet>();
  const styleNo = new Map<string, number>();
  {
    const stylesByPage = new Map<string, string[][]>();
    for (const r of T.sheet.rows) if (g(T.sheet, r, 'sourceKind') === 'HTML_STYLE_ELEMENT') push(stylesByPage, g(T.sheet, r, 'htmlDocumentLinkHash'), r);
    for (const rows of stylesByPage.values()) {
      rows.sort((a, b) => (num(g(T.sheet, a, 'startLine'))! - num(g(T.sheet, b, 'startLine'))!) || (num(g(T.sheet, a, 'startColumn'))! - num(g(T.sheet, b, 'startColumn'))!));
      rows.forEach((r, i) => styleNo.set(g(T.sheet, r, 'cssStylesheetUniqueHash'), i + 1));
    }
  }
  for (const r of T.sheet.rows) {
    const id = g(T.sheet, r, 'cssStylesheetUniqueHash');
    const kind = g(T.sheet, r, 'sourceKind');
    const page = g(T.sheet, r, 'htmlDocumentLinkHash');
    const abs = g(T.sheet, r, 'filePath');
    const file = kind === 'FILE' ? (rel(abs) || g(T.sheet, r, 'relativePath')) : (fileOfPage(page) ?? rel(abs));
    sheets.set(id, { id, file, abs, kind, page, owner: g(T.sheet, r, 'ownerHtmlElementLinkHash'), display: kind === 'FILE' ? file : `${file}<style#${styleNo.get(id) ?? 1}>`, rules: [] });
  }
  const sheetFile = (id: string): string | null => sheets.get(id)?.file ?? null;

  const rules = new Map<string, RuleN>();
  const ruleRow = new Map<string, string[]>();
  for (const r of T.rule.rows) {
    const id = g(T.rule, r, 'cssRuleUniqueHash');
    const n: RuleN = {
      id, sheet: g(T.rule, r, 'stylesheetLinkHash'), parent: g(T.rule, r, 'parentRuleLinkHash'), kind: g(T.rule, r, 'ruleKind'),
      at: g(T.rule, r, 'atRuleName').toLowerCase(), name: g(T.rule, r, 'name'), prelude: unesc(g(T.rule, r, 'preludeText')),
      line: num(g(T.rule, r, 'startLine')) ?? 0, col: num(g(T.rule, r, 'startColumn')) ?? 0, order: 0, layer: '', conditions: [], condNames: [],
      matchable: true, inKeyframes: false, inScope: false, important: 0,
    };
    rules.set(id, n); ruleRow.set(id, r);
    sheets.get(n.sheet)?.rules.push(n);
  }
  const resolved = new Set<string>();
  const resolveRule = (n: RuleN): void => {
    if (resolved.has(n.id)) return;
    resolved.add(n.id);
    const p = n.parent ? rules.get(n.parent) : undefined;
    if (!p) return;
    resolveRule(p);
    n.conditions = [...p.conditions]; n.condNames = [...p.condNames]; n.layer = p.layer; n.matchable = p.matchable; n.inKeyframes = p.inKeyframes; n.inScope = p.inScope;
    if (p.kind !== 'AT_RULE') return;
    if (CONDITION_AT.has(p.at)) { n.conditions.push(`@${p.at} ${p.prelude}`.trim()); n.condNames.push(p.at); }
    else if (p.at === 'layer') { const ln = p.prelude.trim() || `<anon:${p.id}>`; n.layer = n.layer ? `${n.layer}.${ln}` : ln; }
    else if (p.at === 'scope') n.inScope = true;
    else if (!GROUPING_AT.has(p.at)) { n.matchable = false; if (p.at.endsWith('keyframes')) n.inKeyframes = true; }
  };
  for (const n of rules.values()) resolveRule(n);
  for (const s of sheets.values()) {
    s.rules.sort((a, b) => (a.line - b.line) || (a.col - b.col));
    s.rules.forEach((n, i) => { n.order = i + 1; });
  }

  // declarations
  const declsOfRule = new Map<string, string[][]>();
  const declById = new Map<string, string[]>();
  for (const r of T.decl.rows) {
    const id = g(T.decl, r, 'cssDeclarationUniqueHash');
    declById.set(id, r);
    const ruleId = g(T.decl, r, 'ruleLinkHash');
    if (ruleId) { push(declsOfRule, ruleId, r); if (g(T.decl, r, 'isImportant') === 'true') { const n = rules.get(ruleId); if (n) n.important++; } }
  }
  const attrOwner = new Map<string, string>(); const attrPage = new Map<string, string>();
  for (const r of T.attr.rows) { attrOwner.set(g(T.attr, r, 'htmlAttributeUniqueHash'), g(T.attr, r, 'ownerElementLinkHash')); attrPage.set(g(T.attr, r, 'htmlAttributeUniqueHash'), g(T.attr, r, 'documentLinkHash')); }
  const declPage = (d: string[]): string | null => {
    const a = g(T.decl, d, 'htmlAttributeLinkHash'); if (a) return attrPage.get(a) ?? null;
    const s = sheets.get(g(T.decl, d, 'stylesheetLinkHash')); return s && s.kind === 'HTML_STYLE_ELEMENT' ? s.page : null;
  };
  for (const r of T.decl.rows) {
    const attrId = g(T.decl, r, 'htmlAttributeLinkHash'), sheetId = g(T.decl, r, 'stylesheetLinkHash');
    const page = declPage(r);
    out('web_declarations').push({ uid: g(T.decl, r, 'cssDeclarationUniqueHash'), rule_uid: nz(g(T.decl, r, 'ruleLinkHash')), attribute_uid: nz(attrId),
      element_uid: attrId ? attrOwner.get(attrId) ?? null : null, stylesheet_uid: nz(sheetId), page_uid: page, file: attrId ? (page ? fileOfPage(page) : null) : sheetFile(sheetId),
      line: num(g(T.decl, r, 'startLine')), col: num(g(T.decl, r, 'startColumn')), end_line: num(g(T.decl, r, 'endLine')), end_col: num(g(T.decl, r, 'endColumn')),
      property: g(T.decl, r, 'property'), value_text: storedText(g(T.decl, r, 'valueText')), is_important: bool(g(T.decl, r, 'isImportant')),
      is_custom: bool(g(T.decl, r, 'isCustomProperty')), vendor_prefix: nz(g(T.decl, r, 'vendorPrefix')), position: num(g(T.decl, r, 'position')),
      // V4-05 ruling: value_bytes is exactly the UTF-8 length of value_text as stored (comments removed, edges trimmed); a
      // value cut at 64 KiB (V2-12) keeps the length of the whole value written, which is what the cut lost
      value_bytes: g(T.decl, r, 'valueTruncated') === 'true' ? num(g(T.decl, r, 'valueBytes')) : Buffer.byteLength(storedText(g(T.decl, r, 'valueText')) ?? '', 'utf8'),
      value_truncated: bool(g(T.decl, r, 'valueTruncated')) });
    // V2-12: a value over 64 KiB is cut, a listed LIMIT
    if (g(T.decl, r, 'valueTruncated') === 'true') unknownRow('limit', g(T.decl, r, 'cssDeclarationUniqueHash'), page || null, 'value_truncated',
      `${g(T.decl, r, 'property')}: ${g(T.decl, r, 'valueBytes')} bytes`, attrId ? (page ? fileOfPage(page) : null) : sheetFile(sheetId), num(g(T.decl, r, 'startLine')));
  }

  // value references; the vendor system-font aliases name no font (V1-21 ruling): no value_ref, no font_use
  {
    const keep = T.vref.rows.filter((r) => !(g(T.vref, r, 'referenceKind') === 'FONT_FAMILY'
      && SYSTEM_FONT_ALIASES.has(g(T.vref, r, 'name').trim().replace(/^["']|["']$/g, '').toLowerCase())));
    T.vref.rows.length = 0; for (const r of keep) T.vref.rows.push(r);
  }
  const vrefRow = new Map<string, string[]>();
  const vrefsOfRule = new Map<string, string[][]>();
  for (const r of T.vref.rows) {
    const id = g(T.vref, r, 'cssValueReferenceUniqueHash');
    vrefRow.set(id, r);
    const sheetId = g(T.vref, r, 'stylesheetLinkHash'), declId = g(T.vref, r, 'ownerDeclarationLinkHash'), ruleId = g(T.vref, r, 'ownerRuleLinkHash');
    if (ruleId) push(vrefsOfRule, ruleId, r);
    let file = sheetFile(sheetId);
    if (!file && declId) { const d = declById.get(declId); const p = d ? declPage(d) : null; file = p ? fileOfPage(p) : null; }
    const abs = g(T.vref, r, 'resolvedFilePath');
    out('web_value_refs').push({ uid: id, declaration_uid: nz(declId), rule_uid: nz(ruleId), stylesheet_uid: nz(sheetId), file,
      line: num(g(T.vref, r, 'startLine')), col: num(g(T.vref, r, 'startColumn')), reference_kind: g(T.vref, r, 'referenceKind'), name: nz(g(T.vref, r, 'name')),
      fallback_text: nz(unesc(g(T.vref, r, 'fallbackText'))), url_kind: nz(g(T.vref, r, 'urlKind')), resolved_file: onDisk(abs) ? rel(abs) : null,
      is_resolved: bool(g(T.vref, r, 'isResolved')) });
  }
  for (const r of T.comment.rows) {
    const s = g(T.comment, r, 'stylesheetLinkHash');
    out('web_comments').push({ uid: g(T.comment, r, 'cssCommentUniqueHash'), stylesheet_uid: s, file: sheetFile(s), line: num(g(T.comment, r, 'startLine')),
      col: num(g(T.comment, r, 'startColumn')), end_line: num(g(T.comment, r, 'endLine')), end_col: num(g(T.comment, r, 'endColumn')), text: nz(unesc(g(T.comment, r, 'text'))) });
  }
  const gapRules = new Set<string>();
  for (const r of T.cgap.rows) {
    const s = g(T.cgap, r, 'stylesheetLinkHash');
    if (g(T.cgap, r, 'relatedRuleLinkHash')) gapRules.add(g(T.cgap, r, 'relatedRuleLinkHash'));
    out('web_gaps').push({ uid: g(T.cgap, r, 'cssParseGapUniqueHash'), lang: 'css', gap_kind: g(T.cgap, r, 'gapKind'), detail: nz(g(T.cgap, r, 'detail')), owner_uid: s,
      related_uid: nz(g(T.cgap, r, 'relatedRuleLinkHash')), file: sheetFile(s), line: num(g(T.cgap, r, 'startLine')), col: num(g(T.cgap, r, 'startColumn')),
      end_line: num(g(T.cgap, r, 'endLine')), end_col: num(g(T.cgap, r, 'endColumn')) });
  }

  // ── the engine's relations ──
  const R = {
    linkSheet: await readRawRel(rawDir, 'web-link-sheet.csv'), linkUnknown: await readRawRel(rawDir, 'web-link-sheet-unknown.csv'),
    imp: await readRawRel(rawDir, 'web-import.csv'), impUnknown: await readRawRel(rawDir, 'web-import-unknown.csv'),
    links: await readRawRel(rawDir, 'web-links-to.csv'),
    defVar: await readRawRel(rawDir, 'web-defines-var.csv'), useVar: await readRawRel(rawDir, 'web-uses-var.csv'),
  };
  // the engine's structural selector matches (match.dl): page -> selector -> elements, for the selectors it supports
  const engineMatch = new Map<string, Map<string, string[]>>();
  for await (const [sel, page, el] of readRaw(path.join(rawDir, 'web-selector-match.csv'))) {
    let bySel = engineMatch.get(page!); if (!bySel) { bySel = new Map(); engineMatch.set(page!, bySel); }
    const els = bySel.get(sel!); if (els) els.push(el!); else bySel.set(sel!, [el!]);
  }
  const engineSupported = new Set<string>();
  for await (const [sel] of readRaw(path.join(rawDir, 'web-selector-supported.csv'))) engineSupported.add(sel!);
  const sheetOfRef = new Map<string, string>(); for (const [, sheet, ref] of R.linkSheet) sheetOfRef.set(ref!, sheet!);
  const linkUnknownOf = new Map<string, string>(); for (const [, ref, reason] of R.linkUnknown) linkUnknownOf.set(ref!, reason!);
  const importTo = new Map<string, string>(); for (const [, to, vref] of R.imp) importTo.set(vref!, to!);
  const importUnknown = new Map<string, string>(); for (const [, vref, reason] of R.impUnknown) importUnknown.set(vref!, reason!);
  // each @import rule: its target, media, supports and layer()
  for (const s of sheets.values()) for (const n of s.rules) {
    if (n.at !== 'import') continue;
    const vr = (vrefsOfRule.get(n.id) ?? []).find((v) => g(T.vref, v, 'referenceKind') === 'IMPORT');
    const parts = importParts(n.prelude);
    const vid = vr ? g(T.vref, vr, 'cssValueReferenceUniqueHash') : '';
    // review #3: `@import url(x) layer;` opens an anonymous layer of its own, one per @import rule
    n.import = { to: importTo.get(vid) ?? null, vref: vid, media: parts.media, supports: parts.supports, layer: parts.layer === '<anon-import>' ? `<anon:${n.id}>` : parts.layer,
      url: vr ? g(T.vref, vr, 'name') : n.prelude, reason: importTo.has(vid) ? null : onDiskReason(importUnknown.get(vid) ?? 'unresolved_url', s.abs, vr ? g(T.vref, vr, 'name') : '', vr ? g(T.vref, vr, 'urlKind') : '') };
    out('web_imports').push({ from_stylesheet_uid: s.id, to_stylesheet_uid: n.import.to, value_ref_uid: nz(vid), url_as_written: n.import.url,
      status: n.import.to ? 'match' : 'unknown', reason: n.import.to ? null : n.import.reason });
  }

  // ── per page: what it loads, in cascade order (SPEC §3.1, §3.3) ──
  interface Load { sheet: string; via: string; viaId: string; depth: number; order: number; conds: string[]; layer: string | null; disabled: string }
  const loadsOf = new Map<string, Load[]>();
  const loadedBy = new Map<string, Set<string>>();
  const joinLayer = (a: string | null, b: string | null): string | null => (a && b ? `${a}.${b}` : a || b || null);
  const mediaCond = (m: string): string[] => (m && !/^all$/i.test(m.trim()) ? [`@media ${m.trim()}`] : []);
  const sheetByAbs = new Map<string, string>(); for (const sh of sheets.values()) if (sh.kind === 'FILE' && sh.abs) sheetByAbs.set(path.normalize(sh.abs), sh.id);
  for (const page of pages.values()) {
    const loads: Load[] = []; let order = 0;
    const rows: Record<string, string | number | null>[] = [];
    const pushSheet = (sid: string, via: string, viaId: string, depth: number, conds: string[], layer: string | null, disabled: string, stack: Set<string>, viaInc: string | null) => {
      const s = sheets.get(sid)!;
      for (const n of s.rules) {
        if (!n.import) continue;
        const c = [...conds, ...mediaCond(n.import.media), ...(n.import.supports ? [`@supports ${n.import.supports}`] : [])];
        const lay = n.import.layer ? joinLayer(layer, n.import.layer) : layer;
        if (n.import.to && !stack.has(n.import.to)) pushSheet(n.import.to, 'import', s.id, depth + 1, c, lay, disabled, new Set([...stack, n.import.to]), viaInc);
        else if (!n.import.to) rows.push({ page_uid: page.id, stylesheet_uid: null, url_as_written: n.import.url, via: 'import', via_uid: s.id, load_order: null, import_depth: depth + 1,
          media: nz(n.import.media), layer: null, status: 'unknown', reason: n.import.reason, via_include: viaInc });
      }
      order += 1;
      loads.push({ sheet: sid, via, viaId, depth, order, conds, layer, disabled });
      rows.push({ page_uid: page.id, stylesheet_uid: sid, url_as_written: via === 'style' ? null : (s.kind === 'FILE' ? s.file : null), via, via_uid: viaId, load_order: order,
        import_depth: depth, media: conds.length ? conds.join(' && ') : null, layer, status: disabled ? 'conditional' : 'match', reason: disabled || null, via_include: viaInc });
    };
    /**
     * A page's <style> and <link> sheets in document order; at each include site, the included fragment's, loaded by THIS
     * page (iter4 ruling: a fragment loads nothing by itself; each host loads its sheets where it includes it, flagged
     * via_include with the host's include reference). A relative URL written in a fragment resolves against the host's
     * location (iter4 ruling), as the served page asks for it.
     */
    const walkPage = (pg: Page, viaInc: string | null, stack: string[]): void => {
      const styleSheetOf = new Map<string, string>();
      for (const s of sheets.values()) if (s.kind === 'HTML_STYLE_ELEMENT' && s.page === pg.id) styleSheetOf.set(s.owner, s.id);
      const linkRefs = new Map<string, string[]>();
      for (const r of refsOfPage.get(pg.id) ?? []) if (g(T.ref, r, 'referenceKind') === 'STYLESHEET') linkRefs.set(g(T.ref, r, 'ownerElementLinkHash'), r);
      const preloadRefs = new Map<string, string[]>();
      for (const r of refsOfPage.get(pg.id) ?? []) if (g(T.ref, r, 'referenceKind') !== 'STYLESHEET' && (g(T.ref, r, 'attributeName') || '').toLowerCase() === 'href') preloadRefs.set(g(T.ref, r, 'ownerElementLinkHash'), r);
      const ins = page.kind === 'FRAGMENT' && pg.id === page.id ? [] : [...(includeInserts.get(pg.id) ?? [])].sort((a, b) => (before(a.at, b.at) ? -1 : before(b.at, a.at) ? 1 : 0));
      let k = 0;
      const flush = (upTo: [number, number] | null) => {
        while (k < ins.length && (upTo === null || before(ins[k]!.at, upTo))) {
          const x = ins[k++]!; const f = pages.get(x.frag);
          if (f && !stack.includes(x.frag)) walkPage(f, viaInc ?? x.ref, [...stack, x.frag]);
        }
      };
      for (const e of pg.elements) {
        flush(posOf(e));
        if (e.inert === 'template' || e.inert === 'iframe_text') continue;
        if (e.tagLower === 'style' && (e.ns === 'HTML' || e.ns === '')) {
          const sid = styleSheetOf.get(e.id); if (!sid) continue;
          pushSheet(sid, 'style', e.id, 0, mediaCond(e.attrs.get('media')?.value ?? ''), null, e.inert === 'noscript' ? 'inert:noscript' : '', new Set([sid]), viaInc);
        } else if (e.tagLower === 'link' && (e.ns === 'HTML' || e.ns === '')) {
          const relAttr = (e.attrs.get('rel')?.value ?? '').toLowerCase().split(/\s+/);
          // review #24: `<link rel=preload as=style onload="this.rel='stylesheet'">` (the async-stylesheet pattern) is applied
          // once a script swaps it in: a conditional load, reason preload_as_style
          const preload = relAttr.includes('preload') && (e.attrs.get('as')?.value ?? '').trim().toLowerCase() === 'style';
          if (!relAttr.includes('stylesheet') && !preload) continue;
          const r = linkRefs.get(e.id) ?? (preload ? preloadRefs.get(e.id) : undefined); if (!r) continue;
          const refId = g(T.ref, r, 'htmlReferenceUniqueHash');
          // a sheet the page may not apply: an alternate or disabled <link>, or one inside <noscript> (review #5: a browser
          // with scripting on does not load it), is a conditional load whose rows carry the reason
          const disabled = relAttr.includes('alternate') || e.attrs.has('disabled') ? 'alternate_sheet' : e.inert === 'noscript' ? 'inert:noscript' : preload && !relAttr.includes('stylesheet') ? 'preload_as_style' : '';
          let sid = sheetOfRef.get(refId); let reason = linkUnknownOf.get(refId) ?? 'unresolved_url';
          // a preload's reference is a link resource, not a stylesheet one: its sheet is the file it resolves to
          if (!sid && preload) sid = sheetByAbs.get(path.normalize(g(T.ref, r, 'resolvedFilePath') || '-'));
          const urlKind = g(T.ref, r, 'urlKind'); const p0 = g(T.ref, r, 'path').split(/[?#]/)[0]!;
          if (pg.id !== page.id && p0 && (urlKind === 'RELATIVE' || urlKind === 'ROOT_RELATIVE')) {
            const cand = path.normalize(urlKind === 'ROOT_RELATIVE' ? rootRelative(page.abs, p0) : path.join(path.dirname(page.abs), p0));
            sid = sheetByAbs.get(cand); reason = 'unresolved_url';
          }
          if (sid) pushSheet(sid, 'link', e.id, 0, mediaCond(e.attrs.get('media')?.value ?? ''), null, disabled, new Set([sid]), viaInc);
          else rows.push({ page_uid: page.id, stylesheet_uid: null, url_as_written: g(T.ref, r, 'urlAsWritten'), via: 'link', via_uid: e.id, load_order: null, import_depth: 0,
            media: nz(e.attrs.get('media')?.value ?? ''), layer: null, status: 'unknown', reason: onDiskReason(reason, page.abs, g(T.ref, r, 'path'), urlKind), via_include: viaInc });
        }
      }
      flush(null);
    };
    walkPage(page, null, [page.id]);
    loadsOf.set(page.id, loads);
    // a fragment loads nothing by itself (its hosts do): no rows, and it keeps no sheet from being an orphan
    if (page.kind === 'FRAGMENT') continue;
    for (const row of rows) out('web_loads').push(row);
    for (const l of loads) { const set = loadedBy.get(l.sheet) ?? new Set<string>(); set.add(page.id); loadedBy.set(l.sheet, set); }
  }
  for (const s of sheets.values()) {
    if (!loadedBy.has(s.id)) unknownRow('orphan_sheet', s.id, null, 'orphan_sheet', 'loaded by no page (no <link>, no @import chain from a loaded sheet)', s.file, 1);
  }
  for (const r of T.sheet.rows) {
    const id = g(T.sheet, r, 'cssStylesheetUniqueHash'); const s = sheets.get(id)!;
    out('web_stylesheets').push({ uid: id, file: s.file, name: g(T.sheet, r, 'name'), source_kind: s.kind, owner_element_uid: nz(s.owner), page_uid: nz(s.page),
      minified: g(T.sheet, r, 'sourceProvenance') === 'MINIFIED' ? 1 : 0, vendor: s.kind === 'FILE' && (D3_VENDOR.test(s.file) || /\.min\.css$/i.test(s.file)) ? 1 : 0,
      rule_count: num(g(T.sheet, r, 'ruleCount')), declaration_count: num(g(T.sheet, r, 'declarationCount')), gap_count: num(g(T.sheet, r, 'parseGapCount')),
      line: num(g(T.sheet, r, 'startLine')), end_line: num(g(T.sheet, r, 'endLine')), display: s.display, loaded_by_pages: loadedBy.get(id)?.size ?? 0 });
  }

  // ── rules, selectors, parts ──
  for (const n of rules.values()) {
    const r = ruleRow.get(n.id)!;
    out('web_rules').push({ uid: n.id, stylesheet_uid: n.sheet, parent_uid: nz(n.parent), file: sheetFile(n.sheet), line: n.line, col: n.col,
      end_line: num(g(T.rule, r, 'endLine')), end_col: num(g(T.rule, r, 'endColumn')), rule_kind: n.kind, at_rule_name: nz(n.at), name: nz(n.name), prelude_text: storedText(n.prelude),
      nesting_depth: num(g(T.rule, r, 'nestingDepth')), position: num(g(T.rule, r, 'position')), rule_order: n.order, layer: nz(n.layer),
      conditions: n.conditions.length ? n.conditions.join(' && ') : null, in_keyframes: n.matchable ? 0 : 1, important_count: n.important,
      prelude_bytes: g(T.rule, r, 'preludeTruncated') === 'true' ? num(g(T.rule, r, 'preludeBytes')) : Buffer.byteLength(storedText(n.prelude) ?? '', 'utf8'),
      prelude_truncated: bool(g(T.rule, r, 'preludeTruncated')) });
    if (g(T.rule, r, 'preludeTruncated') === 'true') unknownRow('limit', n.id, null, 'prelude_truncated', `${g(T.rule, r, 'preludeBytes')} bytes`, sheetFile(n.sheet), n.line);
  }
  const partsOf = new Map<string, PartRow[]>();
  const partRaw = new Map<PartRow, string[]>();
  for (const r of T.part.rows) {
    const sid = g(T.part, r, 'selectorLinkHash');
    const p: PartRow = {
      id: g(T.part, r, 'cssSelectorPartUniqueHash'), kind: g(T.part, r, 'partKind'), name: g(T.part, r, 'name'), value: unesc(g(T.part, r, 'value')),
      matcher: g(T.part, r, 'attributeMatcher'), flags: g(T.part, r, 'attributeFlags'), comb: g(T.part, r, 'combinatorBefore'),
      compound: num(g(T.part, r, 'compoundIndex')) ?? 0, position: num(g(T.part, r, 'position')) ?? 0, argIndex: num(g(T.part, r, 'argumentIndex')) ?? 0,
      parent: g(T.part, r, 'parentPartLinkHash'),
    };
    push(partsOf, sid, p); partRaw.set(p, r);
  }
  interface SelN { id: string; rule: string; cx: Complex; spec: [number, number, number]; pe: string; req: { classes: string[]; ids: string[] }; unknown: string; root: boolean; reasons: string[]; row: string[]; classNamed: string[] }
  const selsOfRule = new Map<string, SelN[]>();
  const selById = new Map<string, SelN>();
  for (const r of T.sel.rows) {
    const id = g(T.sel, r, 'cssSelectorUniqueHash'), rule = g(T.sel, r, 'ruleLinkHash');
    const parts = partsOf.get(id) ?? [];
    writtenTypeNames(parts, unesc(g(T.sel, r, 'selectorText')));
    for (const p of parts) {
      const pr = partRaw.get(p)!;
      out('web_selector_parts').push({ uid: p.id, selector_uid: id, rule_uid: g(T.part, pr, 'ruleLinkHash'), line: num(g(T.part, pr, 'startLine')), col: num(g(T.part, pr, 'startColumn')),
        part_kind: p.kind, name: nz(p.name), value: nz(p.value), matcher: nz(p.matcher), flags: nz(p.flags), combinator: nz(p.comb), compound_index: p.compound,
        position: p.position, depth: num(g(T.part, pr, 'depth')), argument_index: p.argIndex, parent_uid: nz(p.parent) });
    }
    const s: SelN = { id, rule, cx: compileParts(parts), spec: [num(g(T.sel, r, 'specificityA')) ?? 0, num(g(T.sel, r, 'specificityB')) ?? 0, num(g(T.sel, r, 'specificityC')) ?? 0],
      pe: '', classNamed: [...new Set(parts.filter((p) => p.kind === 'CLASS' && p.name).map((p) => p.name))], req: { classes: [], ids: [] }, unknown: parts.length === 0 || gapRules.has(rule) ? 'selector_unparsed' : '', root: false, reasons: [], row: r };
    selById.set(id, s); push(selsOfRule, rule, s);
  }
  for (const a of selsOfRule.values()) a.sort((x, y) => (num(g(T.sel, x.row, 'position')) ?? 0) - (num(g(T.sel, y.row, 'position')) ?? 0));
  // the selector parts are read only here: released now, not at the end of the build (on a dev project with 872k parts
  // they held ~0.4 GB through style matching, the peak; V1-23)
  partsOf.clear(); partRaw.clear(); T.part.rows.length = 0;
  // nesting: a style rule nested in a style rule (possibly through @media/@layer) is relative to the nearest style-rule ancestor
  const nestedDone = new Set<string>();
  const nearestStyleParent = (n: RuleN): RuleN | undefined => {
    for (let p = n.parent ? rules.get(n.parent) : undefined; p; p = p.parent ? rules.get(p.parent) : undefined) if (p.kind === 'STYLE_RULE') return p;
    return undefined;
  };
  const resolveSelectors = (n: RuleN): Complex[] => {
    const own = selsOfRule.get(n.id) ?? [];
    if (!nestedDone.has(n.id)) {
      nestedDone.add(n.id);
      const sp = nearestStyleParent(n);
      const parentList = sp ? resolveSelectors(sp) : null;
      for (const s of own) {
        s.cx = resolveNesting(s.cx, parentList);
        s.spec = specificity(s.cx);
        s.pe = pseudoElementOf(s.cx); s.req = requiredTokens(s.cx);
        if (!s.unknown) s.unknown = unknownOf(s.cx);
        s.root = usesRoot(s.cx);
        s.reasons = staticReasons(s.cx);
      }
    }
    return own.map((s) => s.cx);
  };
  for (const n of rules.values()) if (n.kind === 'STYLE_RULE' && n.matchable) resolveSelectors(n);
  // per selector over every page (SPEC §3.5 [iter2] grain, §9.9 usage): pages loading it, pages with any styles row, pages with
  // none (and no whole-selector unknown), pages where a required class/id has no static carrier; statuses seen
  type SelStat = { loading: number; matched: number; elements: number; unmatched: number; missing: number; wholeUnk: number; m: number; c: number; u: number; ur: string };
  const selStats = new Map<string, SelStat>();
  const newSelStat = (): SelStat => ({ loading: 0, matched: 0, elements: 0, unmatched: 0, missing: 0, wholeUnk: 0, m: 0, c: 0, u: 0, ur: '' });

  // layer ranks of one page (SPEC §3.3 R7): first declaration, walking the page's sheets in load order and each
  // in source order (into an @import where it is written); a layer's sublayers rank before its own rules
  const layerRanks = (loads: Load[]): ((layer: string | null) => number) => {
    const order: string[] = []; const seen = new Set<string>();
    const add = (name: string | null) => {
      if (!name) return; const parts = name.split('.');
      for (let i = 1; i <= parts.length; i++) { const nm = parts.slice(0, i).join('.'); if (!seen.has(nm)) { seen.add(nm); order.push(nm); } }
    };
    const walk = (sid: string, prefix: string | null, stack: Set<string>) => {
      for (const n of sheets.get(sid)?.rules ?? []) {
        if (n.at === 'layer') {
          const p = n.parent ? rules.get(n.parent) : undefined;
          const base = joinLayer(prefix, p ? (p.at === 'layer' ? (p.layer ? `${p.layer}.${p.prelude.trim() || `<anon:${p.id}>`}` : p.prelude.trim() || `<anon:${p.id}>`) : p.layer || null) : null);
          if (isBlock(n)) add(joinLayer(base, n.prelude.trim() || `<anon:${n.id}>`));
          else for (const nm of n.prelude.split(',').map((x) => x.trim()).filter(Boolean)) add(joinLayer(base, nm));
        }
        if (n.import) {
          const lay = n.import.layer ? joinLayer(prefix, n.import.layer) : prefix;
          if (n.import.layer) add(lay);
          if (n.import.to && !stack.has(n.import.to)) walk(n.import.to, lay, new Set([...stack, n.import.to]));
        }
      }
    };
    for (const l of loads) if (l.via !== 'import') walk(l.sheet, null, new Set([l.sheet]));
    const children = new Map<string, string[]>([['', []]]);
    for (const nm of order) {
      const p = nm.includes('.') ? nm.slice(0, nm.lastIndexOf('.')) : '';
      if (!children.has(p)) children.set(p, []);
      children.get(p)!.push(nm);
      if (!children.has(nm)) children.set(nm, []);
    }
    const rank = new Map<string, number>(); let i = 0;
    const post = (nm: string) => { for (const c of children.get(nm) ?? []) post(c); if (nm !== '') rank.set(nm, ++i); };
    post('');
    const unlayered = i + 1;
    return (layer) => (layer ? rank.get(layer) ?? unlayered : unlayered);
  };
  const childCountOf = new Map<string, number>();
  for (const n of rules.values()) if (n.parent) childCountOf.set(n.parent, (childCountOf.get(n.parent) ?? 0) + 1);
  /** `@layer a {}` (a block, possibly empty) vs `@layer a, b;` (a statement): a block has children, or its source span ends in `}` */
  function isBlock(n: RuleN): boolean {
    const r = ruleRow.get(n.id)!;
    if ((childCountOf.get(n.id) ?? 0) > 0 || (num(g(T.rule, r, 'childRuleCount')) ?? 0) > 0 || (num(g(T.rule, r, 'declarationCount')) ?? 0) > 0) return true;
    const el = num(g(T.rule, r, 'endLine')), ec = num(g(T.rule, r, 'endColumn'));
    const sh = sheets.get(n.sheet); if (!sh || el === null || ec === null) return false;
    const text = sheetText(sh); if (text === null) return false;
    const line = text[el - 1] ?? '';
    return line.slice(0, ec).trimEnd().endsWith('}');
  }
  const textCache = new Map<string, string[] | null>();
  function sheetText(s: Sheet): string[] | null {
    if (!textCache.has(s.abs)) { try { textCache.set(s.abs, fs.readFileSync(s.abs, 'utf8').split(/\r\n|\r|\n/)); } catch { textCache.set(s.abs, null); } }
    return textCache.get(s.abs)!;
  }

  // ── selector -> element, per page (SPEC §3.2) ──
  // @scope: the rule's nearest @scope ancestor, its root and limit selectors (parsed from the prelude: no part rows)
  interface ScopeSpec { roots: Complex[] | null; limits: Complex[] | null; unknown: string; reasons: string[]; implicitRoot: boolean }
  const scopeSpecs = new Map<string, ScopeSpec>();
  const scopeOf = (n: RuleN): { rule: RuleN; spec: ScopeSpec } | null => {
    for (let p = n.parent ? rules.get(n.parent) : undefined; p; p = p.parent ? rules.get(p.parent) : undefined) {
      if (p.at !== 'scope') continue;
      let sp = scopeSpecs.get(p.id);
      if (!sp) {
        const m = /^\s*(?:\(((?:[^()]|\([^()]*\))*)\))?\s*(?:to\s*\(((?:[^()]|\([^()]*\))*)\))?\s*$/i.exec(p.prelude);
        const roots = m && m[1] !== undefined ? parseSelectorList(m[1]) : null;
        const limits = m && m[2] !== undefined ? parseSelectorList(m[2]) : null;
        let unknown = !m || (m[1] !== undefined && roots === null) || (m[2] !== undefined && limits === null) ? 'scope_bound:selector_unparsed' : '';
        if (!unknown) for (const c of [...(roots ?? []), ...(limits ?? [])]) { const u = unknownOf(c); if (u) { unknown = `scope_bound:${u}`; break; } }
        const reasons = [...new Set([...(roots ?? []), ...(limits ?? [])].flatMap(staticReasons))].map((r) => `scope_bound:${r}`);
        sp = { roots, limits, unknown, reasons, implicitRoot: !m || m[1] === undefined };
        scopeSpecs.set(p.id, sp);
      }
      return { rule: p, spec: sp };
    }
    return null;
  };
  // ── §9.2 resolved style: contenders, the cascade key, winners ──
  interface Cand { pe: string; rule: string; st: number; a: number; b: number; c: number; px: number; so: number; ro: number; lr: number }
  /** a declaration of a rule whose selector the engine cannot decide on the page, with the cascade key it would have */
  interface Undecided { key: string; reason: string }
  const cmpCand = (x: Cand, y: Cand): number => (x.a - y.a) || (x.b - y.b) || (x.c - y.c) || (x.px - y.px) || (x.so - y.so) || (x.ro - y.ro) || (x.lr - y.lr);
  /** scope proximity as a cascade field, higher wins: 9999 - hops to the scope root, 0 outside any @scope (review #4) */
  const pxField = (prox: number | null): number => (prox === null ? 0 : 9999 - Math.min(prox, 9999));
  const classSel = new Set<string>(); const styledClass = new Set<string>();
  const inlineDecls = new Map<string, string[][]>(); // element -> its style attribute's declarations
  for (const r of T.decl.rows) { const a = g(T.decl, r, 'htmlAttributeLinkHash'); const el = a ? attrOwner.get(a) : undefined; if (el) push(inlineDecls, el, r); }
  /** a standard property is case-insensitive; a custom property's name is case-sensitive (V2-04) */
  const propKey = (p: string): string => (p.startsWith('--') ? p : p.toLowerCase());
  const pad = (n: number, w: number): string => String(Math.max(0, Math.trunc(n))).padStart(w, '0');
  /** the cascade sort key as text (web_cascade recomputes it in SQL with the same layout): higher wins */
  const keyOf = (imp: number, inline: boolean, lr: number, a: number, b: number, c: number, px: number, so: number, ro: number, pos: number): string =>
    `${imp}|${pad(inline ? 2000000000 : imp ? 1000000000 - lr : lr, 10)}|${pad(a, 4)}|${pad(b, 4)}|${pad(c, 4)}|${pad(px, 4)}|${pad(so, 6)}|${pad(ro, 7)}|${pad(pos, 5)}`;
  let computedRows = 0;
  const computedOf = (pageId: string, cands: Map<string, Map<string, Cand>>, composed?: { host: string; els: string[] }, undecided?: Map<string, Undecided[]>) => {
    const els = new Set<string>([...cands.keys()]);
    if (composed) { for (const id of composed.els) if (inlineDecls.has(id)) els.add(id); }
    else for (const e of pages.get(pageId)?.elements ?? []) if (inlineDecls.has(e.id) && e.inert !== 'iframe_text') els.add(e.id);
    for (const elId of els) {
      interface K { decl: string; prop: string; key: string; st: number; inline: boolean; imp: number; value: string }
      const byPe = new Map<string, Map<string, K[]>>();
      const add = (pe: string, k: K) => { let m = byPe.get(pe); if (!m) { m = new Map(); byPe.set(pe, m); } const a = m.get(k.prop); if (a) a.push(k); else m.set(k.prop, [k]); };
      for (const c of cands.get(elId)?.values() ?? []) {
        for (const d of declsOfRule.get(c.rule) ?? []) {
          const imp = g(T.decl, d, 'isImportant') === 'true' ? 1 : 0;
          add(c.pe, { decl: g(T.decl, d, 'cssDeclarationUniqueHash'), prop: propKey(g(T.decl, d, 'property')), st: c.st, inline: false, imp,
            key: keyOf(imp, false, c.lr, c.a, c.b, c.c, c.px, c.so, c.ro, num(g(T.decl, d, 'position')) ?? 0), value: g(T.decl, d, 'valueText') });
        }
      }
      for (const d of inlineDecls.get(elId) ?? []) {
        const imp = g(T.decl, d, 'isImportant') === 'true' ? 1 : 0;
        add('', { decl: g(T.decl, d, 'cssDeclarationUniqueHash'), prop: propKey(g(T.decl, d, 'property')), st: 0, inline: true, imp,
          key: keyOf(imp, true, 0, 0, 0, 0, 0, 0, 0, num(g(T.decl, d, 'position')) ?? 0), value: g(T.decl, d, 'valueText') });
      }
      for (const [pe, props] of byPe) {
        for (const ks of props.values()) ks.sort((x, y) => (x.key < y.key ? 1 : x.key > y.key ? -1 : 0));
        for (const [prop, ks] of props) {
          // the winner is the best UNCONDITIONAL contender (V2-03); a property set only under a condition (:hover,
          // @media) has no winner for the unconditional state, and its conditional declarations are the overrides
          const wi = ks.findIndex((k) => k.st === 0);
          let status = 'match';
          if (wi < 0) status = ks.some((k) => k.st === 1) ? 'conditional_only' : 'unknown';
          const w = wi >= 0 ? ks[wi]! : null;
          const above = wi >= 0 ? ks.slice(0, wi) : ks;
          // V2-13 ruling: contenders = every declaration of the property that applies (any condition, the winner
          // included); conditional_overrides = the conditional ones among them
          const condOver = ks.filter((k) => k.st === 1).length;
          let unknownReason: string | null = null;
          if (status === 'match' && above.some((k) => k.st === 2)) { status = 'unknown'; unknownReason = 'unknown_contender'; }
          // review P1 #2: a rule the engine cannot decide on the page (an unparsed selector, a rule with a parse gap, :root
          // where <html> is implied) is still a contender; one that would outrank the winner leaves it unknown, never a match
          if (status === 'match' && w && undecided) {
            const u = (undecided.get(`${pe}|${prop}`) ?? []).find((x) => x.key > w.key);
            if (u) { status = 'unknown'; unknownReason = `undecidable_contender:${u.reason}`; }
          }
          let override: K | null = null;
          if (w) for (const sh of SHORTHANDS.get(prop) ?? []) for (const k of props.get(sh) ?? []) if (k.st === 0 && k.key > w.key && (!override || k.key > override.key)) override = k;
          if (override && status === 'match') status = 'shorthand_override';
          computedRows++;
          out('web_computed').push({ element_uid: elId, page_uid: pageId, host_page_uid: composed?.host ?? null, pseudo: pe || null, property: prop, winner_decl_uid: w?.decl ?? null,
            winner_origin: w ? (w.inline ? 'inline' : 'rule') : null, winner_status: status, value_text: w ? unesc(w.value).replace(/\/\*[\s\S]*?\*\//g, '').trim() || null : null,
            important: w?.imp ?? 0, contenders: ks.length, conditional_overrides: condOver, override_decl_uid: override?.decl ?? null, winner_key: w?.key ?? null,
            unknown_reason: status === 'unknown' ? (unknownReason ?? 'unknown_contender') : null });
        }
      }
    }
  };
  const pageMatches = new Map<string, Map<string, Map<string, number>>>(); // page -> rule -> element -> best status
  let styleRows = 0;
  const t0 = Date.now();
  // page-level tallies per (selector, page), merged over the runs of a page matched more than once: a layout that an
  // extending page is matched in (its own run, then each extends run). Every other page is counted at once.
  const multiRun = new Set(extendsComps.map((x) => x.layout));
  const pageTally = new Map<string, Map<string, { any: boolean; missing: boolean; unk: boolean }>>();
  const emittedComposed = new Set<string>(); // a fragment's row is written once, whichever composition reached it
  /**
   * One page's selector -> element rows. With `comp` the tree is a host's composed one (§11):
   * - mode `host`: the host is matched only in this form, its own elements with no host, the fragments' with
   *   host_page_uid (page_uid their own page); the host's tallies and resolved style come from this run;
   * - mode `extends`: the layout's tree with an extending page's blocks; only the extending page's elements (and what it
   *   includes) get rows, the layout having its own.
   */
  // THE SHEET'S SELECTOR INDEX, by a class or id each selector requires (a browser's rule hash). A selector that requires a
  // token the page does not carry matches nothing there, and its only effect on that page is a tally (loading, unmatched,
  // missing). A plain page (one run, no composition, no dynamic class binding) visits just the selectors whose key it
  // carries plus those with no key, in sheet order, so the match costs what the page can match rather than pages x
  // selectors; the skipped ones are tallied in bulk after the pages (skipTally).
  type SheetIdx = { entries: { n: RuleN; s: SelN }[]; always: number[]; keyOf: (string | null)[]; byKey: Map<string, number[]>; byKeyLc: Map<string, number[]> | null; gated: number[] };
  const sheetIdx = new Map<string, SheetIdx>();
  const idxOf = (sheetId: string, lc: boolean): SheetIdx & { keys: Map<string, number[]> } => {
    let x = sheetIdx.get(sheetId);
    if (!x) {
      x = { entries: [], always: [], keyOf: [], byKey: new Map(), byKeyLc: null, gated: [] };
      for (const n of sheets.get(sheetId)!.rules) {
        if (n.kind !== 'STYLE_RULE' || !n.matchable) continue;
        for (const s of selsOfRule.get(n.id) ?? []) {
          const i = x.entries.length; x.entries.push({ n, s });
          // never skipped: an undecidable selector, `:root`, an @scope rule (each writes unknown rows or depends on more than tokens)
          const k = n.inScope || s.unknown || s.root ? null
            : s.req.ids.length ? `i\u0000${s.req.ids[0]}` : s.req.classes.length ? `c\u0000${s.req.classes[0]}` : null;
          x.keyOf.push(k);
          if (k === null) x.always.push(i); else { push(x.byKey, k, i); x.gated.push(i); }
        }
      }
      sheetIdx.set(sheetId, x);
    }
    if (lc && !x.byKeyLc) { x.byKeyLc = new Map(); for (const i of x.gated) push(x.byKeyLc, x.keyOf[i]!.toLowerCase(), i); }
    return { ...x, keys: lc ? x.byKeyLc! : x.byKey };
  };
  const plainLoads = new Map<string, number>(); // sheet -> plain pages loading it
  const plainSeen = new Map<string, number>(); // selector -> plain pages that visited it
  const runPage = (pageId: string, loads: Load[], comp?: { live: CEl[]; mode: 'host' | 'extends' }): void => {
    const page = pages.get(pageId)!;
    const cands = new Map<string, Map<string, Cand>>();
    if (!comp && (page.kind === 'FRAGMENT' || page.elements.length === 0)) {
      // not matched on its own, but a style attribute still resolves (V2-02): a fragment no host composes keeps its
      // inline declarations' rows (a hosted one gets them, with its host, from the composition)
      if (!hosted.has(pageId)) computedOf(pageId, new Map());
      return;
    }
    const live: El[] = comp ? comp.live.filter((e) => e.inert !== 'iframe_text') : page.elements.filter((e) => e.inert !== 'iframe_text');
    const ctx = pageCtx(live, page.quirks, page.lang);
    const m = new Matcher(ctx, false);
    const md = ctx.dynamicClassEls.length ? new Matcher(ctx, true) : null;
    const ruleEls = pageMatches.get(pageId) ?? new Map<string, Map<string, number>>();
    if (!comp || comp.mode === 'host') pageMatches.set(pageId, ruleEls);
    // the element a row is for, its page, and the host it was matched in (null: its own page)
    const targetOf = (e: El): { el: string; page: string; host: string | null } | null => {
      if (!comp) return { el: e.id, page: pageId, host: null };
      const c = e as CEl;
      if (comp.mode === 'extends' && !c.viaExtends) return null;
      return c.origPage === pageId ? { el: c.origId, page: pageId, host: null } : { el: c.origId, page: c.origPage, host: pageId };
    };
    const candsByPage = new Map<string, Map<string, Map<string, Cand>>>();
    const stylesBuf = new Map<string, { row: Record<string, string | number | null>; orders: number[] }>();
    const rank = layerRanks(loads);
    const seen = new Set<string>();
    const unmatched = new Map<string, { any: boolean; missing: boolean }>();
    const fold = (x: string) => (page.quirks ? x.toLowerCase() : x);
    // review P1 #2: the declarations of unconditional rules whose selector is undecidable here, by (pseudo, property)
    const undecided = new Map<string, Undecided[]>();
    const noteUndecided = (s: SelN, n: RuleN, l: Load, layerRank: number, reason: string, conditional: boolean): void => {
      if (conditional) return;
      // a token the selector requires that the page does not carry: it matches nothing here
      if (s.req.classes.some((c) => !ctx.classes.has(fold(c))) || s.req.ids.some((c) => !ctx.ids.has(fold(c)))) return;
      // `:root` as the subject is the implied <html> itself, which has no row and no computed style here
      const subject = s.cx[s.cx.length - 1];
      if (reason === 'implied_element' && subject?.simples.some((x) => x.kind === 'PSEUDO_CLASS' && x.name.toLowerCase() === 'root')) return;
      // a selector with no parts has no known specificity: it may outrank any winner
      const sp = s.cx.length === 0 ? [9999, 9999, 9999] : s.spec;
      for (const d of declsOfRule.get(n.id) ?? []) {
        const imp = g(T.decl, d, 'isImportant') === 'true' ? 1 : 0;
        push(undecided, `${s.pe}|${propKey(g(T.decl, d, 'property'))}`, {
          key: keyOf(imp, false, layerRank, sp[0]!, sp[1]!, sp[2]!, 0, l.order, n.order, num(g(T.decl, d, 'position')) ?? 0), reason });
      }
    };
    const plain = !comp && !multiRun.has(pageId) && !md;
    // the engine's matches stand for the matcher's on a plain page whose tree is the parser's and whose comparisons are
    // exact: no quirks mode (case folding), no mended `<div/>`, no upper-case HTML tag
    const engineEls = plain && !page.quirks && !mendedPages.has(pageId)
      && page.elements.every((e) => !(e.ns === 'HTML' || e.ns === '') || e.tag === e.tagLower)
      ? (engineMatch.get(pageId) ?? new Map<string, string[]>()) : null;
    const liveSet = engineEls ? new Set(live) : null;
    // an SVG or MathML element: the engine cannot decide a type part on it (see match.dl)
    const foreign = engineEls !== null && page.elements.some((e) => !(e.ns === 'HTML' || e.ns === ''));
    const plainSheets = new Set<string>();
    for (const l of loads) {
      const x = idxOf(l.sheet, page.quirks);
      let visit: number[] | null = null; // null: every selector of the sheet
      if (plain) {
        if (!plainSheets.has(l.sheet)) { plainSheets.add(l.sheet); plainLoads.set(l.sheet, (plainLoads.get(l.sheet) ?? 0) + 1); }
        visit = [...x.always];
        for (const c of ctx.classes) { const b = x.keys.get(`c\u0000${c}`); if (b) for (const i of b) visit.push(i); }
        for (const c of ctx.ids) { const b = x.keys.get(`i\u0000${c}`); if (b) for (const i of b) visit.push(i); }
        visit.sort((a, b) => a - b);
      }
      // the rule-level values, computed once per rule as its selectors come up in order
      let cur: RuleN | null = null;
      let curConds: string[] = [], curRank = 0, curConditions: string | null = null, curScope: ReturnType<typeof scopeOf> | null = null;
      const count = visit ? visit.length : x.entries.length;
      for (let vi = 0; vi < count; vi++) {
        const ei = visit ? visit[vi]! : vi;
        const { n, s } = x.entries[ei]!;
        if (n !== cur) {
          cur = n;
          curConds = [...l.conds, ...n.conditions];
          curRank = rank(joinLayer(l.layer, n.layer || null));
          curConditions = curConds.length ? curConds.join(' && ') : null;
          curScope = n.inScope ? scopeOf(n) : null;
        }
        const atConds = curConds, layerRank = curRank, conditions = curConditions, scope = curScope;
        {
          let st = selStats.get(s.id);
          if (!st) { st = newSelStat(); selStats.set(s.id, st); }
          const tallies = !comp || comp.mode === 'host';
          if (!seen.has(`l|${s.id}`)) { seen.add(`l|${s.id}`); if (tallies) st.loading++; if (plain && x.keyOf[ei] !== null) plainSeen.set(s.id, (plainSeen.get(s.id) ?? 0) + 1); }
          const unk = s.unknown || scope?.spec.unknown || '';
          if (unk) noteUndecided(s, n, l, layerRank, unk, atConds.length > 0 || !!l.disabled);
          if (s.root && !page.hasHtml && !scope && !unk) noteUndecided(s, n, l, layerRank, 'implied_element', atConds.length > 0 || !!l.disabled);
          if (unk) { if (tallies && !seen.has(`u|${s.id}`)) { seen.add(`u|${s.id}`); st.wholeUnk++; st.ur ||= unk; unknownRow(unk, s.id, pageId, unk, null, sheetFile(l.sheet), null); } continue; }
          if (s.root && !page.hasHtml && !scope) { if (tallies && !seen.has(`u|${s.id}`)) { seen.add(`u|${s.id}`); st.wholeUnk++; st.ur ||= 'implied_element'; unknownRow('implied_element', s.id, pageId, 'implied_element', null, sheetFile(l.sheet), null); } continue; }
          const base = new Set(s.reasons);
          for (const c of atConds) base.add(`at_rule:${c.split(/\s/)[0]!.slice(1).toLowerCase()}`);
          if (l.disabled) base.add(l.disabled);
          if (scope) for (const r of scope.spec.reasons) base.add(r);
          let u = unmatched.get(s.id); if (!u) { u = { any: false, missing: false }; unmatched.set(s.id, u); }
          const missing = s.req.classes.some((c) => !ctx.classes.has(fold(c))) || s.req.ids.some((c) => !ctx.ids.has(fold(c)));
          const W = new Set<string>();
          const emit = (e: El, status: string, reason: string, root: El | null) => {
            const tg = targetOf(e); if (!tg) return;
            const eid = tg.el;
            const sc = status === 'match' ? EXACT : status === 'conditional' ? COND : UNKNOWN;
            if (sc !== UNKNOWN || reason !== 'lang_unknown') {
              let pm = ruleEls;
              if (tg.page !== pageId) { pm = pageMatches.get(tg.page) ?? new Map(); pageMatches.set(tg.page, pm); }
              let re = pm.get(n.id); if (!re) { re = new Map(); pm.set(n.id, re); }
              if ((re.get(eid) ?? NO) < sc) re.set(eid, sc);
            }
            u!.any = true;
            // §9.2 contenders: per (element, pseudo, rule) the best styles row (status, then the cascade key)
            {
              const cmap = tg.host ? (candsByPage.get(tg.page) ?? (candsByPage.set(tg.page, new Map()), candsByPage.get(tg.page)!)) : cands;
              const ck = `${s.pe}|${n.id}`; let em = cmap.get(eid); if (!em) { em = new Map(); cmap.set(eid, em); }
              const prev = em.get(ck); const stc = status === 'match' ? 0 : status === 'conditional' ? 1 : 2;
              let px0: number | null = null;
              if (root) { px0 = 0; for (let a: El | null = e; a && a !== root; a = a.parent) px0++; }
              const cand = { pe: s.pe, rule: n.id, st: stc, a: s.spec[0], b: s.spec[1], c: s.spec[2], px: pxField(px0), so: l.order, ro: n.order, lr: layerRank };
              if (!prev || stc < prev.st || (stc === prev.st && cmpCand(cand, prev) > 0)) em.set(ck, cand);
              for (const c of s.classNamed) { classSel.add(s.id); if (e.classes.has(c)) styledClass.add(c); }
            }
            // one row per LOAD (V1-07): a sheet linked twice is in the cascade twice, the later load's sheet_order winning
            if (seen.has(`s|${s.id}|${eid}|${l.order}`)) return;
            seen.add(`s|${s.id}|${eid}|${l.order}`);
            if (tg.host) { const k = `${s.id}|${eid}|${tg.host}|${l.order}`; if (emittedComposed.has(k)) return; emittedComposed.add(k); }
            if (!seen.has(`s|${s.id}|${eid}|${status}`)) {
              seen.add(`s|${s.id}|${eid}|${status}`);
              if (status === 'match') { st!.elements++; st!.m++; } else if (status === 'conditional') st!.c++; else { st!.u++; st!.ur ||= reason; }
            }
            let prox: number | null = null;
            if (root) { prox = 0; for (let a: El | null = e; a && a !== root; a = a.parent) prox++; }
            // ONE ROW PER (selector, element, page) (V2-22): a sheet loaded twice is one row whose cascade position is the
            // later load's sheet_order; every load's order is listed in `loads`
            const row = { selector_uid: s.id, rule_uid: n.id, stylesheet_uid: l.sheet, element_uid: eid, page_uid: tg.page, status, reason: reason || null,
              conditions, pseudo_element: nz(s.pe), spec_a: s.spec[0], spec_b: s.spec[1], spec_c: s.spec[2], layer_rank: layerRank,
              sheet_order: l.order, rule_order: n.order, important_count: n.important, scope_root: root ? ((root as CEl).origId ?? root.id) : null, scope_proximity: prox,
              host_page_uid: tg.host, loads: null as string | null };
            const bk = `${s.id}|${eid}|${tg.host ?? ''}`;
            const prev = stylesBuf.get(bk);
            if (!prev) { stylesBuf.set(bk, { row, orders: [l.order] }); return; }
            prev.orders.push(l.order);
            if (l.order > (prev.row.sheet_order as number)) prev.row = row;
          };
          const statusOf = (rs: { s: number; r: string }, e: El): [string, string] => {
            const reasons = new Set(base);
            if (e.inert) reasons.add(`inert:${e.inert}`);
            if (rs.s === UNKNOWN) return ['unknown', rs.r];
            // a conditional result carries its own reason (review #6: a negation a class binding can flip)
            if (rs.s === COND && rs.r) reasons.add(rs.r);
            return [reasons.size ? 'conditional' : 'match', [...reasons].sort().join(';')];
          };
          if (scope) {
            // @scope (SPEC §3.2): the subject is a descendant-or-self of a root matching A (the <style>'s parent when
            // there is no prelude) and not inside a limit B below that root; a bare selector is `:scope <sel>`
            const cx: Complex = s.root ? s.cx
              : [{ comb: 'NONE', simples: [{ kind: 'PSEUDO_CLASS', name: 'scope', value: '', matcher: '', flags: '', args: null }] }, { ...s.cx[0]!, comb: s.cx[0]!.comb === 'NONE' ? 'DESCENDANT' : s.cx[0]!.comb }, ...s.cx.slice(1)];
            const isRoot = (a: El): boolean => {
              if (scope.spec.implicitRoot) { const sh2 = sheets.get(scope.rule.sheet); const owner = sh2 ? elById.get(sh2.owner) : undefined; return !!owner && owner.parent === a; }
              return (scope.spec.roots ?? []).some((c) => m.match(c, a).s !== NO);
            };
            const limited = (root: El, e: El): boolean => {
              if (!scope.spec.limits) return false;
              for (let b: El | null = e; b && b !== root; b = b.parent) if (scope.spec.limits.some((c) => m.match(c, b!).s !== NO)) return true;
              return false;
            };
            for (const e of live) {
              for (let a: El | null = e; a; a = a.parent) {
                if (!isRoot(a) || limited(a, e)) continue;
                const ms = new Matcher(ctx, false); ms.scopeRoot = a;
                const r = ms.match(cx, e);
                if (r.s === NO) continue;
                W.add(e.id);
                const [status, reason] = statusOf(r, e);
                emit(e, status, reason, a);
                break;
              }
            }
            continue;
          }
          if (!missing && engineEls && engineSupported.has(s.id) && !(foreign && s.cx.some((c) => c.simples.some((x) => x.kind === 'TYPE')))) {
            const els: El[] = [];
            for (const id of engineEls.get(s.id) ?? []) { const e = elById.get(id); if (e && liveSet!.has(e)) els.push(e); }
            els.sort((a, b) => a.idx - b.idx);
            for (const e of els) {
              W.add(e.id);
              const [status, reason] = statusOf({ s: EXACT, r: '' }, e);
              emit(e, status, reason, null);
            }
          } else if (!missing) {
            for (const e of m.candidates(s.cx)) {
              const r = m.match(s.cx, e);
              if (r.s === NO) continue;
              W.add(e.id);
              const [status, reason] = statusOf(r, e);
              emit(e, status, reason, null);
            }
          }
          // a dynamic class or attribute binding: elements that would match with what their bindings can set (never a match)
          if (md) {
            for (const e of md.candidates(s.cx)) {
              if (W.has(e.id)) continue;
              const r = md.match(s.cx, e);
              if (r.s === NO) continue;
              const why = [...new Set(r.r.split(',').filter((x) => x.startsWith('dynamic_')))].sort().join(';');
              if (!why) continue;
              emit(e, 'unknown', why, null);
            }
          }
          if (missing) u.missing = true;
        }
      }
    }
    for (const { row, orders } of stylesBuf.values()) {
      if (orders.length > 1) row.loads = [...new Set(orders)].sort((a, b) => a - b).join(',');
      out('web_styles').push(row); styleRows++;
    }
    stylesBuf.clear();
    // the fragments' resolved style, as matched in this host (one set of web_computed rows per host)
    // V3-05: a composed fragment no rule matches still has its style attributes' rows, per host
    const fragPages = new Set(candsByPage.keys());
    if (comp?.mode === 'host') for (const e of comp.live) if (e.origPage !== pageId && inlineDecls.has(e.origId)) fragPages.add(e.origPage);
    for (const fp of fragPages) computedOf(fp, candsByPage.get(fp) ?? new Map(), { host: pageId, els: (comp?.live ?? []).filter((e) => e.origPage === fp).map((e) => e.origId) }, undecided);
    // [iter2 grain] no per-(selector, page) unknown row: counted on the selector row; the page list is the view
    // web_selector_unmatched_pages. A page in several runs (its own composition, a layout an extending page is
    // matched in) is matched when any run matched; a token is missing only when every run missed it.
    for (const [sid, u] of unmatched) {
      if (!multiRun.has(pageId)) {
        // one run for this page (the common case): counted at once, never held per (selector, page)
        const st = selStats.get(sid); if (!st) continue;
        if (u.any) st.matched++; else if (!seen.has(`u|${sid}`)) { st.unmatched++; if (u.missing) st.missing++; }
        continue;
      }
      let byPage = pageTally.get(sid); if (!byPage) { byPage = new Map(); pageTally.set(sid, byPage); }
      const t = byPage.get(pageId);
      const unk = seen.has(`u|${sid}`);
      if (!t) byPage.set(pageId, { any: u.any, missing: u.missing, unk });
      else { t.any ||= u.any; t.missing &&= u.missing; t.unk ||= unk; }
    }
    if (!comp || comp.mode === 'host') computedOf(pageId, cands, undefined, undecided);
  };
  // V2-08: each page's carried tokens, its own and its included fragments' (transitively), for the per-page view
  {
    const own = (pid: string): string[] => {
      const out2: string[] = [];
      for (const e of pages.get(pid)?.elements ?? []) {
        if (e.inert === 'iframe_text') continue;
        if (e.idAttr) out2.push(`id\u0000${e.idAttr}`);
        for (const c of e.classes) out2.push(`class\u0000${c}`);
      }
      return out2;
    };
    for (const p of pages.values()) {
      const set = new Set<string>(); const seenP = new Set<string>(); const stack = [p.id];
      while (stack.length) {
        const q = stack.pop()!; if (seenP.has(q)) continue; seenP.add(q);
        for (const k of own(q)) set.add(k);
        for (const x of includeInserts.get(q) ?? []) stack.push(x.frag);
      }
      for (const k of set) { const [kind, token] = k.split('\u0000') as [string, string]; out('web_page_carriers').push({ page_uid: p.id, kind, token, token_lc: token.toLowerCase() }); }
    }
  }
  // §11: a page whose includes resolve is matched only as composed (below), as the browser sees it
  const targetedPages = new Set([...includeInserts.values()].flatMap((xs) => xs.map((x) => x.frag)));
  const composedRoots = [...includeInserts.keys()].filter((h) => pages.get(h)!.kind !== 'FRAGMENT' || !targetedPages.has(h)).filter((h) => pages.get(h)!.kind !== 'FRAGMENT');
  const composedRootSet = new Set(composedRoots);
  for (const [pageId, loads] of loadsOf) if (!composedRootSet.has(pageId)) runPage(pageId, loads);
  // §11 compositions: every host with resolved includes, and every (layout, extending page) pair; the sheets are the
  // host's, then those the fragments load themselves
  const composedLoads = (host: string, frags: string[]): Load[] => {
    const ls = [...(loadsOf.get(host) ?? [])]; let order = ls.reduce((a, l) => Math.max(a, l.order), 0);
    for (const f of frags) for (const l of loadsOf.get(f) ?? []) if (!ls.some((x) => x.sheet === l.sheet)) ls.push({ ...l, order: ++order });
    return ls;
  };
  let composedRuns = 0;
  for (const host of composedRoots) {
    const live = compose(host, []);
    runPage(host, composedLoads(host, [...new Set(live.map((e) => e.origPage))].filter((p) => p !== host)), { live, mode: 'host' }); composedRuns++;
  }
  for (const x of extendsComps) {
    const live = compose(x.layout, x.inserts);
    if (!live.some((e) => e.viaExtends)) continue;
    runPage(x.layout, composedLoads(x.layout, [...new Set(live.map((e) => e.origPage))].filter((p) => p !== x.layout)), { live, mode: 'extends' }); composedRuns++;
  }
  // skipTally: a keyed selector a plain page did not visit requires a token that page does not carry, so on that page
  // it loads, matches nothing and is missing a token: the tallies runPage would have made, in bulk
  for (const [sheet, k] of plainLoads) {
    const x = sheetIdx.get(sheet); if (!x) continue;
    for (const i of x.gated) {
      const s = x.entries[i]!.s;
      const skipped = k - (plainSeen.get(s.id) ?? 0);
      if (skipped <= 0) continue;
      let st = selStats.get(s.id); if (!st) { st = newSelStat(); selStats.set(s.id, st); }
      st.loading += skipped; st.unmatched += skipped; st.missing += skipped;
    }
  }
  for (const [sid, byPage] of pageTally) {
    const st = selStats.get(sid); if (!st) continue;
    for (const t of byPage.values()) { if (t.any) st.matched++; else if (!t.unk) { st.unmatched++; if (t.missing) st.missing++; } }
  }
  for (const pageId of pages.keys()) if (!loadsOf.has(pageId)) computedOf(pageId, new Map());
  log(`  web styles: ${styleRows} selector->element rows over ${loadsOf.size} page(s)${composedRuns ? ` and ${composedRuns} composed host(s)` : ''} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const s of selById.values()) {
    const r = s.row; const st = selStats.get(s.id); const n = rules.get(s.rule);
    const dec = !n || !n.matchable ? { d: 'none', r: n?.inKeyframes ? 'keyframe_selector' : 'not_an_element_selector' }
      : s.unknown ? { d: 'unknown', r: s.unknown }
      : (s.reasons.length || (n.condNames.length > 0)) ? { d: 'conditional', r: [...s.reasons, ...n.condNames.map((c) => `at_rule:${c}`)].join(';') } : { d: 'exact', r: null };
    // a selector in a sheet no page loads is not_loaded even under an at-rule the matcher does not take (`@utility`,
    // V2-19); only a keyframe selector (`from`, `50%`) has no usage at all
    const usage = dec.d === 'none' && (n?.inKeyframes || (st && st.loading > 0)) ? null : !st || st.loading === 0 ? 'not_loaded' : dec.d === 'none' ? null
      : st.m > 0 ? 'matched' : st.c > 0 ? 'conditional_only'
      : st.u > 0 || st.wholeUnk > 0 ? 'unknown_only' : 'unmatched_static';
    // ruling (c): unknown_reason explains the selector's own usage label — unmatched_static: no_static_carrier (a
    // required class/id has no carrier on some page) else no_element_matches; unknown_only: the styles/unknown reason;
    // NULL otherwise (a matched selector's carrier-less pages are still in web_selector_unmatched_pages)
    const unknownReason = usage === 'unmatched_static' ? (st!.missing > 0 ? 'no_static_carrier' : null)
      : usage === 'unknown_only' ? (st!.ur || null) : null;
    if (st && st.missing > 0) {
      for (const c of new Set(s.req.classes)) out('web_selector_required').push({ selector_uid: s.id, kind: 'class', token: c });
      for (const c of new Set(s.req.ids)) out('web_selector_required').push({ selector_uid: s.id, kind: 'id', token: c });
    }
    out('web_selectors').push({ uid: s.id, rule_uid: s.rule, stylesheet_uid: g(T.sel, r, 'stylesheetLinkHash'), file: sheetFile(g(T.sel, r, 'stylesheetLinkHash')),
      line: num(g(T.sel, r, 'startLine')), col: num(g(T.sel, r, 'startColumn')), position: num(g(T.sel, r, 'position')), selector_text: unesc(g(T.sel, r, 'selectorText')),
      spec_a: s.spec[0], spec_b: s.spec[1], spec_c: s.spec[2], compound_count: num(g(T.sel, r, 'compoundCount')), has_nesting: bool(g(T.sel, r, 'hasNesting')),
      has_pseudo_element: bool(g(T.sel, r, 'hasPseudoElement')), decidability: dec.d, reason: dec.r, pages_loading: st?.loading ?? 0, pages_matched: st?.matched ?? 0,
      elements_matched: st?.elements ?? 0, pages_unmatched: st?.unmatched ?? 0, unknown_reason: unknownReason, usage });
  }

  // ── value-level edges per page: var, keyframes, fonts, containers (SPEC §3.4, §3.4a) ──
  const declRule = (id: string): string => { const d = declById.get(id); return d ? g(T.decl, d, 'ruleLinkHash') : ''; };
  const declAttr = (id: string): string => { const d = declById.get(id); return d ? g(T.decl, d, 'htmlAttributeLinkHash') : ''; };
  const declSheet = (id: string): string => { const d = declById.get(id); return d ? g(T.decl, d, 'stylesheetLinkHash') : ''; };
  for (const [decl, name] of R.defVar) {
    out('web_defines_var').push({ declaration_uid: decl!, name: name! });
    const a = declAttr(decl!);
    out('web_var_def').push({ def_uid: decl!, name: name!, rule_uid: nz(declRule(decl!)), attribute_uid: nz(a), element_uid: a ? attrOwner.get(a) ?? null : null, stylesheet_uid: nz(declSheet(decl!)) });
  }
  const propertyRules: RuleN[] = [];
  for (const n of rules.values()) if (n.at === 'property' && n.prelude.trim().startsWith('--')) {
    propertyRules.push(n);
    out('web_var_def').push({ def_uid: n.id, name: n.prelude.trim(), rule_uid: n.id, attribute_uid: null, element_uid: null, stylesheet_uid: n.sheet });
  }
  for (const [vref, name, decl] of R.useVar) out('web_uses_var').push({ value_ref_uid: vref!, name: name!, declaration_uid: decl! });
  {
    // the page-independent visibility (web_var_visible) and the per-element inheritance roots (web_var_scope);
    // the per-page view web_var is SQL over them (write.ts), never materialized (SPEC §3.4a)
    const defsByName = new Map<string, string[]>(); for (const [decl, name] of R.defVar) push(defsByName, name!, decl!);
    for (const n of propertyRules) push(defsByName, n.prelude.trim(), n.id);
    const defSheetOrPage = (d: string): { sheet: string; page: string } => {
      const a = declAttr(d); if (a) return { sheet: '', page: attrPage.get(a) ?? '' };
      return { sheet: rules.has(d) ? rules.get(d)!.sheet : declSheet(d), page: '' };
    };
    const pagesLoading = (sheet: string): Set<string> => loadedBy.get(sheet) ?? new Set();
    // a name's definitions grouped by OWNER once (first-definition order, each owner's defs in definition order): a use
    // then walks the owners, not every definition, so the cost is uses x owners rather than uses x definitions
    type Owner = { owner: string; kind: string; page: string; sheet: string; defs: string[] };
    const ownersByName = new Map<string, Owner[]>();
    const ownersOf = (name: string): Owner[] => {
      let os = ownersByName.get(name);
      if (os) return os;
      const byKey = new Map<string, Owner>(); os = [];
      for (const d of defsByName.get(name) ?? []) {
        const w = defSheetOrPage(d);
        const owner = w.page ? w.page : w.sheet;
        let o = byKey.get(owner);
        if (!o) { o = { owner, kind: w.page ? 'page' : 'sheet', page: w.page, sheet: w.sheet, defs: [] }; byKey.set(owner, o); os.push(o); }
        o.defs.push(d);
      }
      ownersByName.set(name, os);
      return os;
    };
    // does any page of `a` load `sheet`: walk the smaller set. A use in a sheet asks it once per (use sheet, def sheet)
    const meetsMemo = new Map<string, boolean>();
    const meets = (a: Set<string>, sheet: string, useSheet: string | null): boolean => {
      const mk = useSheet === null ? null : `${useSheet}\u0000${sheet}`;
      if (mk !== null) { const hit = meetsMemo.get(mk); if (hit !== undefined) return hit; }
      const b = pagesLoading(sheet);
      const [small, big] = a.size <= b.size ? [a, b] : [b, a];
      let r = false;
      for (const p of small) if (big.has(p)) { r = true; break; }
      if (mk !== null) meetsMemo.set(mk, r);
      return r;
    };
    const visible = new Set<string>();
    for (const [vref, name, decl] of R.useVar) {
      const a = declAttr(decl!);
      const useSheet = a ? null : declSheet(decl!);
      const usePages = useSheet === null ? new Set([attrPage.get(a) ?? '']) : pagesLoading(useSheet);
      const fb = g(T.vref, vrefRow.get(vref!) ?? [], 'fallbackText');
      // V1-22 grain: one row per (use, def OWNER) — the sheet or the page (style attribute) holding the definitions — not
      // per (use, def): a name defined in every theme sheet made the use x def product 8.5x the budget. Lossless: the
      // per-definition rows are the view web_var_visible_defs (web_var_def by name and owner).
      const byOwner = new Map<string, { kind: string; defs: string[] }>();
      for (const o of ownersOf(name!)) {
        const ok = o.page ? usePages.has(o.page) : meets(usePages, o.sheet, useSheet);
        if (ok) byOwner.set(o.owner, o);
      }
      for (const [owner, o] of byOwner) {
        const k = `${vref}|${owner}`; if (visible.has(k)) continue; visible.add(k);
        out('web_var_visible').push({ use_uid: decl!, value_ref_uid: vref!, name: name!, def_owner_uid: owner, def_owner_kind: o.kind, defs: o.defs.length,
          def_uid: o.defs.length === 1 ? o.defs[0]! : null, status: 'match', reason: null });
      }
      if (byOwner.size === 0) out('web_var_visible').push({ use_uid: decl!, value_ref_uid: vref!, name: name!, def_owner_uid: null, def_owner_kind: null, defs: 0,
        def_uid: null, status: 'unknown', reason: fb ? 'fallback_only' : 'no_definition_in_scope' });
    }
    // scope rows: (page, element styled by a var-using rule, name) -> nearest ancestor-or-self styled by a defining rule
    const usingRules = new Map<string, Set<string>>(); // rule -> names used
    for (const [, name, decl] of R.useVar) { const r = declRule(decl!); if (r) { const s = usingRules.get(r) ?? new Set(); s.add(name!); usingRules.set(r, s); } }
    const definingRules = new Map<string, Set<string>>(); // name -> rules
    for (const [decl, name] of R.defVar) { const r = declRule(decl!); if (r) { const s = definingRules.get(name!) ?? new Set(); s.add(r); definingRules.set(name!, s); } }
    // style attributes: an element whose style="" defines --x is an exact inheritance root for --x; one whose style=""
    // uses --x is styled by a var-using declaration (SPEC §3.4a: "a rule or style attr")
    const attrDefEls = new Map<string, Set<string>>(); // name -> elements
    for (const [decl, name] of R.defVar) { const a = declAttr(decl!); const el = a ? attrOwner.get(a) : undefined; if (el) { const s2 = attrDefEls.get(name!) ?? new Set(); s2.add(el); attrDefEls.set(name!, s2); } }
    const attrUses = new Map<string, Map<string, Set<string>>>(); // page -> element -> names
    for (const [, name, decl] of R.useVar) {
      const a = declAttr(decl!); const el = a ? attrOwner.get(a) : undefined; const pg = a ? attrPage.get(a) : undefined;
      if (!el || !pg) continue;
      let m = attrUses.get(pg); if (!m) { m = new Map(); attrUses.set(pg, m); }
      let ns = m.get(el); if (!ns) { ns = new Set(); m.set(el, ns); } ns.add(name!);
    }
    // a var defined ONLY by @property: one scope row, root NULL, reason property_initial (its initial-value applies)
    const propertyNames = new Set(propertyRules.map((n) => n.prelude.trim()));
    // V1-12: exactly one row per (page, element, name)
    const scopeSeen = new Set<string>();
    const scopeRow = (pageId: string, ruleEls: Map<string, Map<string, number>>, elId: string, name: string) => {
      const propOnly = propertyNames.has(name) && !definingRules.has(name) && !attrDefEls.has(name);
      const sk = `${pageId}|${elId}|${name}`; if (scopeSeen.has(sk)) return; scopeSeen.add(sk);
      // nothing defines it anywhere (set by script): still one row, unknown no_definition_in_scope (V2-16)
      if (!definingRules.has(name) && !attrDefEls.has(name) && !propOnly) {
        out('web_var_scope').push({ page_uid: pageId, element_uid: elId, name, root_uid: null, root_exact_uid: null, status: 'unknown', reason: 'no_definition_in_scope' });
        return;
      }
      const attrDefs = attrDefEls.get(name);
      const walk = (start: El | null, rels: Map<string, Map<string, number>>) => {
        const defRules = [...(definingRules.get(name) ?? [])].filter((r) => rels.has(r));
        let root: string | null = null, rootSt = NO, rootExact: string | null = null;
        for (let a: El | null = start; a; a = a.parent) {
          let best = attrDefs?.has(a.id) ? EXACT : NO;
          for (const dr of defRules) best = Math.max(best, rels.get(dr)!.get(a.id) ?? NO);
          if (best === UNKNOWN) best = NO;
          if (best > NO && root === null) { root = a.id; rootSt = best; }
          if (best === EXACT) { rootExact = a.id; break; }
        }
        return { root, rootSt, rootExact, defs: defRules.length };
      };
      const own = walk(elById.get(elId) ?? null, ruleEls);
      let { root, rootSt, rootExact } = own;
      let defCount = own.defs;
      // review #7: above an included fragment's top element the tree is its host's, from the include site up, matched in
      // the host (`:root{--gap}` on the host's <html>); with several hosts the row is a match only when every host has one
      if (rootExact === null) {
        const hosts = hostsOfFragment.get(pageId) ?? [];
        const hr = hosts.map((h) => walk(h.hostEl, pageMatches.get(h.host) ?? new Map()));
        defCount += hr.reduce((n, x) => n + x.defs, 0);
        const found = hr.filter((x) => x.root !== null);
        if (root === null && found.length > 0) {
          const all = found.length === hr.length && found.every((x) => x.rootSt === EXACT);
          root = found[0]!.root; rootSt = all ? EXACT : COND; rootExact = all ? found[0]!.rootExact : null;
        }
      }
      out('web_var_scope').push({ page_uid: pageId, element_uid: elId, name, root_uid: root, root_exact_uid: rootExact !== root ? rootExact : null,
        status: root ? (rootSt === EXACT ? 'match' : 'conditional') : 'unknown',
        reason: root ? null : propOnly ? 'property_initial' : (defCount || attrDefs ? 'not_inherited' : 'no_definition_in_scope') });
    };
    for (const [pageId, ruleEls] of pageMatches) {
      for (const [ruleId, names] of usingRules) {
        const els = ruleEls.get(ruleId); if (!els) continue;
        for (const name of names) for (const [elId] of els) scopeRow(pageId, ruleEls, elId, name);
      }
      for (const [elId, names] of attrUses.get(pageId) ?? []) for (const name of names) scopeRow(pageId, ruleEls, elId, name);
    }
  }
  // keyframes, fonts, containers: per page, through the sheets the page loads
  const kfByName = new Map<string, RuleN[]>(); const ffByName = new Map<string, RuleN[]>(); const cnDecl = new Map<string, string[][]>();
  for (const n of rules.values()) {
    if (n.at.endsWith('keyframes')) push(kfByName, n.prelude.trim().replace(/^["']|["']$/g, '') || n.name, n);
    if (n.at === 'font-face') {
      const fam = (declsOfRule.get(n.id) ?? []).find((d) => g(T.decl, d, 'property').toLowerCase() === 'font-family');
      if (fam) push(ffByName, unesc(g(T.decl, fam, 'valueText')).trim().replace(/^["']|["']$/g, '').toLowerCase(), n);
    }
  }
  for (const r of T.vref.rows) if (g(T.vref, r, 'referenceKind') === 'CONTAINER' && g(T.vref, r, 'ownerDeclarationLinkHash')) push(cnDecl, g(T.vref, r, 'name'), r);
  // uses: (use uid, value ref uid, kind, name, sheet or page owning it)
  interface Use { use: string; vref: string | null; kind: string; name: string; sheet: string; page: string }
  const uses: Use[] = [];
  const irKeyframeDecls = new Set<string>();
  for (const r of T.vref.rows) {
    const kind = g(T.vref, r, 'referenceKind'); const declId = g(T.vref, r, 'ownerDeclarationLinkHash'), ruleId = g(T.vref, r, 'ownerRuleLinkHash');
    const vid = g(T.vref, r, 'cssValueReferenceUniqueHash'); const name = g(T.vref, r, 'name');
    const d = declById.get(declId);
    const sheet = g(T.vref, r, 'stylesheetLinkHash') || (d ? g(T.decl, d, 'stylesheetLinkHash') : '');
    const page = d && g(T.decl, d, 'htmlAttributeLinkHash') ? attrPage.get(g(T.decl, d, 'htmlAttributeLinkHash')) ?? '' : '';
    if (kind === 'KEYFRAMES') {
      if (d) irKeyframeDecls.add(declId);
      uses.push({ use: declId || ruleId, vref: vid, kind, name, sheet, page });
    } else if (kind === 'FONT_FAMILY') {
      const owner = rules.get(ruleId) ?? (d ? rules.get(g(T.decl, d, 'ruleLinkHash')) : undefined);
      if (owner?.at === 'font-face') continue; // the descriptor DEFINES the family (G13)
      { const nm = name.trim().replace(/^["']|["']$/g, '').toLowerCase(); if (GENERIC_FONTS.has(nm) || SYSTEM_FONT_ALIASES.has(nm)) continue; } // a generic family / system alias is no use (G13, V1-21)
      uses.push({ use: declId || ruleId, vref: vid, kind, name, sheet, page });
    } else if (kind === 'CONTAINER' && !declId) uses.push({ use: ruleId, vref: vid, kind, name, sheet, page });
  }
  // G10: the vendor animation declarations (-webkit-animation …) the IR gives no KEYFRAMES reference: the names are
  // read from the value and stand as value references of their own (synthetic uid), like the IR's for `animation`
  for (const d of T.decl.rows) {
    const p = g(T.decl, d, 'property');
    const m = /^-(webkit|moz|o|ms)-animation(-name)?$/i.exec(p); if (!m) continue;
    const declId = g(T.decl, d, 'cssDeclarationUniqueHash');
    if (irKeyframeDecls.has(declId)) continue; // the IR read this one itself
    const attr = g(T.decl, d, 'htmlAttributeLinkHash');
    const page = attr ? attrPage.get(attr) ?? '' : '';
    const sheet = g(T.decl, d, 'stylesheetLinkHash');
    animationNames(unesc(g(T.decl, d, 'valueText')), !m[2]).forEach((nm, i) => {
      const vid = `CSS_VALUE_REFERENCE_G10_${declId.replace(/^CSS_DECLARATION_/, '')}_${i}`;
      out('web_value_refs').push({ uid: vid, declaration_uid: declId, rule_uid: nz(g(T.decl, d, 'ruleLinkHash')), stylesheet_uid: nz(sheet),
        file: attr ? (page ? fileOfPage(page) : null) : sheetFile(sheet), line: num(g(T.decl, d, 'startLine')), col: num(g(T.decl, d, 'startColumn')),
        reference_kind: 'KEYFRAMES', name: nm, fallback_text: null, url_kind: null, resolved_file: null, is_resolved: 0 });
      uses.push({ use: declId, vref: vid, kind: 'KEYFRAMES', name: nm, sheet, page });
    });
  }
  for (const page of pages.values()) {
    const loads = loadsOf.get(page.id) ?? [];
    const inScope = new Set(loads.map((l) => l.sheet));
    for (const u of uses) {
      if (u.page ? u.page !== page.id : !inScope.has(u.sheet)) continue;
      if (u.kind === 'KEYFRAMES') {
        const ts_ = (kfByName.get(u.name.replace(/^["']|["']$/g, '')) ?? []).filter((k) => inScope.has(k.sheet));
        if (u.name === 'none') continue;
        if (!ts_.length) out('web_keyframes_use').push({ use_uid: u.use, value_ref_uid: u.vref, name: u.name, target_uid: null, page_uid: page.id, status: 'unknown', reason: 'no_such_keyframes' });
        for (const k of ts_) out('web_keyframes_use').push({ use_uid: u.use, value_ref_uid: u.vref, name: u.name, target_uid: k.id, page_uid: page.id, status: 'match', reason: null });
      } else if (u.kind === 'FONT_FAMILY') {
        const ts_ = (ffByName.get(u.name.trim().replace(/^["']|["']$/g, '').toLowerCase()) ?? []).filter((k) => inScope.has(k.sheet));
        if (!ts_.length) out('web_font_use').push({ use_uid: u.use, value_ref_uid: u.vref, name: u.name, target_uid: null, page_uid: page.id, status: 'unknown', reason: 'system_or_external_font' });
        for (const k of ts_) out('web_font_use').push({ use_uid: u.use, value_ref_uid: u.vref, name: u.name, target_uid: k.id, page_uid: page.id, status: 'match', reason: null });
      } else if (u.kind === 'CONTAINER') {
        const ts_ = (cnDecl.get(u.name) ?? []).filter((r) => inScope.has(g(T.vref, r, 'stylesheetLinkHash')));
        if (!ts_.length) out('web_container_use').push({ use_uid: u.use, name: u.name, target_uid: null, page_uid: page.id, status: 'unknown', reason: 'no_such_container' });
        for (const r of ts_) out('web_container_use').push({ use_uid: u.use, name: u.name, target_uid: g(T.vref, r, 'ownerDeclarationLinkHash'), page_uid: page.id, status: 'match', reason: null });
      }
    }
  }

  // ── links between pages, and the same page's id references ──
  const idsOnPage = new Map<string, Map<string, El[]>>();
  for (const p of pages.values()) {
    const m = new Map<string, El[]>();
    for (const e of p.elements) if (e.idAttr && e.inert !== 'iframe_text') push(m, e.idAttr, e);
    idsOnPage.set(p.id, m);
  }
  const linked = new Set<string>(); for (const [, , , ref] of R.links) linked.add(ref!);
  const idRef = (from: string, page: string, attr: string, value: string) => {
    const carriers = idsOnPage.get(page)?.get(value) ?? [];
    if (carriers.length === 0) {
      out('web_id_refs').push({ from_element_uid: from, page_uid: page, attribute_name: attr, id_value: value, to_element_uid: null, status: 'unknown', reason: 'no_such_id' });
    } else for (const c of carriers) out('web_id_refs').push({ from_element_uid: from, page_uid: page, attribute_name: attr, id_value: value, to_element_uid: c.id,
      status: carriers.length > 1 ? 'ambiguous' : 'match', reason: carriers.length > 1 ? 'duplicate_id' : null });
  };
  // css url() -> file. The owner is what the URL resolves against: a stylesheet file for its own url()s, the page for a
  // <style> or style attribute it holds. iter4 ruling: a relative url() in an included fragment's <style> or style
  // attribute resolves against each HOST's location, as the browser loads the composed markup at the host's URL: one row
  // per host, owned by that host, in place of the fragment-relative one (the same as a fragment's element src).
  for (const r of T.vref.rows) {
    if (g(T.vref, r, 'referenceKind') !== 'URL') continue;
    const uk = g(T.vref, r, 'urlKind'); const url = g(T.vref, r, 'name');
    if (uk === 'DATA_URI' || uk === 'FRAGMENT' || uk === 'JAVASCRIPT_URI' || !url) continue;
    const declId = g(T.vref, r, 'ownerDeclarationLinkHash'); const d = declId ? declById.get(declId) : undefined;
    const from = declId ? { from_uid: declId, from_kind: 'declaration' } : { from_uid: g(T.vref, r, 'ownerRuleLinkHash'), from_kind: 'rule' };
    const sh = sheets.get(g(T.vref, r, 'stylesheetLinkHash') || (d ? g(T.decl, d, 'stylesheetLinkHash') : ''));
    const page = d ? declPage(d) : sh && sh.kind === 'HTML_STYLE_ELEMENT' ? sh.page : null;
    const owner = page ?? sh?.id ?? null;
    const why = (ex: boolean) => (ex ? null : (uk === 'ABSOLUTE' || uk === 'PROTOCOL_RELATIVE' || uk === 'OTHER_SCHEME' ? 'external_url' : uk === 'TEMPLATE_EXPRESSION' ? 'template_url' : 'unresolved_url'));
    let p0 = url.split(/[?#]/)[0]!; try { p0 = decodeURIComponent(p0); } catch { /* a bare % stays as written */ }
    const hosts = page && pages.get(page)?.kind === 'FRAGMENT' && p0 && (uk === 'RELATIVE' || uk === 'ROOT_RELATIVE') ? hostsOfFragment.get(page) ?? [] : [];
    if (hosts.length) {
      for (const h of new Map(hosts.map((x) => [x.host, x])).values()) {
        const hp = pages.get(h.host)!; const abs = uk === 'ROOT_RELATIVE' ? rootRelative(hp.abs, p0) : path.join(path.dirname(hp.abs), p0); const ex = onDisk(abs);
        out('web_resources').push({ ...from, owner_uid: h.host, kind: 'URL', url, file: ex ? rel(abs) : null, file_exists: ex ? 1 : 0, status: ex ? 'match' : 'unknown', reason: why(ex) });
      }
    } else {
      const abs = g(T.vref, r, 'resolvedFilePath'); const ex = onDisk(abs);
      out('web_resources').push({ ...from, owner_uid: owner, kind: 'URL', url, file: ex ? rel(abs) : null, file_exists: ex ? 1 : 0, status: ex ? 'match' : 'unknown', reason: why(ex) });
    }
  }
  for (const r of T.ref.rows) {
    const page = g(T.ref, r, 'documentLinkHash'); const elId = g(T.ref, r, 'ownerElementLinkHash'); const e = elById.get(elId);
    const attr = g(T.ref, r, 'attributeName'); const uk = g(T.ref, r, 'urlKind'); const url = g(T.ref, r, 'urlAsWritten'); const id = g(T.ref, r, 'htmlReferenceUniqueHash');
    const kind = g(T.ref, r, 'referenceKind');
    if (['IMAGE', 'MEDIA', 'LINK_RESOURCE', 'SCRIPT', 'OTHER', 'REQUEST'].includes(kind) && uk !== 'DATA_URI' && uk !== 'JAVASCRIPT_URI' && uk !== 'FRAGMENT') {
      const why = (ex: boolean) => (ex ? null : (uk === 'ABSOLUTE' || uk === 'PROTOCOL_RELATIVE' || uk === 'OTHER_SCHEME' ? 'external_url' : uk === 'TEMPLATE_EXPRESSION' ? 'template_url' : 'unresolved_url'));
      // iter4 ruling: a relative URL in an included fragment resolves against each HOST's location (the browser loads the
      // composed markup at the host's URL): one row per host, owned by that host, in place of the fragment-relative one
      const p0 = g(T.ref, r, 'path').split(/[?#]/)[0]!;
      const hosts = pages.get(page)?.kind === 'FRAGMENT' && p0 && (uk === 'RELATIVE' || uk === 'ROOT_RELATIVE') ? hostsOfFragment.get(page) ?? [] : [];
      if (hosts.length) {
        for (const h of new Map(hosts.map((x) => [x.host, x])).values()) {
          const hp = pages.get(h.host)!; const abs = uk === 'ROOT_RELATIVE' ? rootRelative(hp.abs, p0) : path.join(path.dirname(hp.abs), p0); const ex = onDisk(abs);
          out('web_resources').push({ from_uid: elId, from_kind: 'element', owner_uid: h.host, kind, url, file: ex ? rel(abs) : null, file_exists: ex ? 1 : 0, status: ex ? 'match' : 'unknown', reason: why(ex) });
        }
      } else {
        const abs = g(T.ref, r, 'resolvedFilePath'); const ex = onDisk(abs);
        out('web_resources').push({ from_uid: elId, from_kind: 'element', owner_uid: page, kind, url, file: ex ? rel(abs) : null, file_exists: ex ? 1 : 0, status: ex ? 'match' : 'unknown', reason: why(ex) });
      }
    }
    if (!e || LINK_ATTRS[e.tagLower] !== attr.toLowerCase()) continue;
    if (e.inert === 'iframe_text') continue; // V3-08: markup inside <iframe> is text (G11): no link
    if (uk === 'FRAGMENT') { const f = g(T.ref, r, 'fragment') || url.replace(/^#/, ''); if (f) idRef(elId, page, attr, decodeSafe(f)); continue; }
    if (uk === 'EMPTY' || uk === 'DATA_URI' || uk === 'JAVASCRIPT_URI' || uk === 'OTHER_SCHEME') continue;
    if (uk === 'ABSOLUTE' || uk === 'PROTOCOL_RELATIVE' || uk === 'TEMPLATE_EXPRESSION') {
      out('web_links').push({ from_element_uid: elId, page_uid: page, attribute_name: attr, to_page_uid: null, to_element_uid: null, kind, reference_uid: id, url_as_written: url,
        fragment: null, status: 'unknown', reason: uk === 'TEMPLATE_EXPRESSION' ? 'template_url' : 'external_url' });
      continue;
    }
    let absRaw = g(T.ref, r, 'resolvedFilePath');
    if (!absRaw && (uk === 'RELATIVE' || uk === 'ROOT_RELATIVE') && g(T.ref, r, 'path')) {
      const pg = pages.get(page);
      const cand = uk === 'ROOT_RELATIVE' ? rootRelative(pg?.abs ?? '', g(T.ref, r, 'path')) : pg ? path.join(path.dirname(pg.abs), g(T.ref, r, 'path')) : '';
      if (cand && isDir(cand)) absRaw = cand;
    }
    // `?p=1` (a query with no path) is the page itself with other parameters (V1-06)
    if (!absRaw && uk === 'RELATIVE' && !g(T.ref, r, 'path') && g(T.ref, r, 'query')) absRaw = pages.get(page)?.abs ?? '';
    // a URL naming a directory (`docs/`) serves its index page
    const abs = absRaw && !pageByAbs.has(absRaw) && isDir(absRaw) ? (['index.html', 'index.htm', 'index.shtml', 'default.htm'].map((f) => path.join(absRaw, f)).find((f) => pageByAbs.has(f)) ?? absRaw) : absRaw;
    const target = abs ? pageByAbs.get(abs) : undefined;
    if (!target) {
      const exists = onDisk(abs);
      if (exists && !HTML_EXT.test(abs)) continue; // a link to a file that is not a page (a PDF, an image) is a resource
      out('web_links').push({ from_element_uid: elId, page_uid: page, attribute_name: attr, to_page_uid: null, to_element_uid: null, kind, reference_uid: id, url_as_written: url,
        fragment: nz(g(T.ref, r, 'fragment')), status: 'unknown', reason: exists ? 'not_indexed' : 'unresolved_url' });
      continue;
    }
    const frag = g(T.ref, r, 'fragment');
    if (frag) {
      const carriers = idsOnPage.get(target.id)?.get(decodeSafe(frag)) ?? [];
      if (carriers.length === 0) out('web_links').push({ from_element_uid: elId, page_uid: page, attribute_name: attr, to_page_uid: target.id, to_element_uid: null, kind, reference_uid: id,
        url_as_written: url, fragment: frag, status: 'unknown', reason: 'no_such_id' });
      else for (const c of carriers) out('web_links').push({ from_element_uid: elId, page_uid: page, attribute_name: attr, to_page_uid: target.id, to_element_uid: c.id, kind, reference_uid: id,
        url_as_written: url, fragment: frag, status: carriers.length > 1 ? 'ambiguous' : 'match', reason: carriers.length > 1 ? 'duplicate_id' : null });
    } else out('web_links').push({ from_element_uid: elId, page_uid: page, attribute_name: attr, to_page_uid: target.id, to_element_uid: null, kind, reference_uid: id,
      url_as_written: url, fragment: null, status: 'match', reason: null });
  }
  for (const r of T.attr.rows) {
    const name = g(T.attr, r, 'name').toLowerCase();
    if (!ID_REF_ATTRS.has(name)) continue;
    const elId = g(T.attr, r, 'ownerElementLinkHash'); const e = elById.get(elId); if (!e) continue;
    if (name === 'for' && e.tagLower !== 'label' && e.tagLower !== 'output') continue;
    if (name === 'form' && e.tagLower === 'form') continue;
    const value = unesc(g(T.attr, r, 'value'));
    const ids = TOKEN_LIST_ID_ATTRS.has(name) || (name === 'for' && e.tagLower === 'output') ? value.split(/\s+/).filter(Boolean) : [value.trim()];
    for (const v of ids) if (v) idRef(elId, g(T.attr, r, 'documentLinkHash'), g(T.attr, r, 'name'), v);
  }

  // ── [iter2] SPEC §9 conversion layer ──
  {
    const t9 = Date.now();
    const sink = (table: string, row: Record<string, string | number | null>) => out(table).push(row);
    const deepText = (e: El): string => { const parts: string[] = []; const go = (x: El) => { if (x.text) parts.push(x.text); for (const c of x.children) go(c); }; go(e); return parts.join(' ').replace(/\s+/g, ' ').trim(); };
    const pageList = [...pages.values()].filter((p) => p.kind !== 'FRAGMENT' || true).map((p) => ({ id: p.id, file: p.file, elements: p.elements }));
    // §9.1 / §9.8
    const st = structures({ pages: pageList, at: (e) => startOf(e.id), rulesOn: (e) => {
      const pm = pageMatches.get(elPage.get(e.id)?.id ?? ''); const out2: string[] = [];
      if (pm) for (const [ruleId, m] of pm) if ((m.get(e.id) ?? NO) >= COND) out2.push(ruleId);
      return out2;
    } }, sink);
    void st;
    // §11: a fragment included by >= 2 hosts is a component candidate of kind include; an occurrence is an include site
    for (const [frag, hs] of hostsOfFragment) {
      const hostPages = new Set(hs.map((h) => h.host));
      if (hostPages.size < 2) continue;
      const fp = pages.get(frag)!; const top = topOf(frag); const root0 = top[0];
      const uid = `WEB_COMPONENT_INCLUDE_${frag.replace(/^HTML_DOCUMENT_/, '')}`;
      out('web_components').push({ uid, level: 'include', signature: `include:${fp.file}`, root_tag: root0?.tagLower ?? null,
        root_classes: root0 ? [...root0.classes].sort().join(' ') || null : null, display: `include:${fp.file}`, size: fp.elements.length, occurrences: hs.length,
        pages: hostPages.size, parent_component_uid: null, slot_count: 0, rules_styling_root: null });
      // V3-07: an include at the top level (outside any element) names the host's root element, flagged at_top_level
      for (const h of hs) out('web_component_occurrences').push({ component_uid: uid, element_uid: h.hostEl?.id ?? topOf(h.host)[0]?.id ?? null, page_uid: h.host,
        file: fileOfPage(h.host), line: h.line, col: h.col, at_top_level: h.hostEl ? 0 : 1 });
    }
    // §9.7 / §9.5
    const actionRef = new Map<string, string>(); // form element -> resolved abs path of its action
    for (const r of T.ref.rows) if (g(T.ref, r, 'attributeName').toLowerCase() === 'action') actionRef.set(g(T.ref, r, 'ownerElementLinkHash'), g(T.ref, r, 'resolvedFilePath'));
    for (const p of pageList) {
      const firstById = new Map<string, El>(); for (const e of p.elements) if (e.idAttr && !firstById.has(e.idAttr)) firstById.set(e.idAttr, e);
      outlineOf(p, (id) => { const e = firstById.get(id); return e ? deepText(e) : ''; }, sink);
      formsOf(p, (f) => { const abs = actionRef.get(f.id); return abs ? pageByAbs.get(abs)?.id ?? null : null; }, deepText, sink);
    }
    // §9.3 tokens
    const sheetFiles = new Set([...sheets.values()].filter((x) => x.kind === 'FILE').map((x) => x.file));
    const notProject = (sheetId: string): boolean => {
      // D3 / V3-09: a <style> element is the project's; a file sheet is vendor by the D3 path list or as a .min.css
      const sh = sheets.get(sheetId); if (!sh || sh.kind !== 'FILE') return false;
      if (D3_VENDOR.test(sh.file) || /\.min\.css$/i.test(sh.file)) return true;
      const twin = sh.file.replace(/\.min\.css$/i, '.css');
      return twin !== sh.file && sheetFiles.has(twin);
    };
    interface Tok { uid: string; kind: string; value: string; decls: Set<string>; proj: Set<string>; sheets: Set<string>; rules: Set<string>; vars: Set<string> }
    const toks = new Map<string, Tok>();
    for (const r of T.decl.rows) {
      const did = g(T.decl, r, 'cssDeclarationUniqueHash'); const prop = g(T.decl, r, 'property');
      const sheet = g(T.decl, r, 'stylesheetLinkHash'); const rule = g(T.decl, r, 'ruleLinkHash');
      // every declared custom property is a token, used or not (V2-06): its declaration defines it, no use
      if (prop.startsWith('--')) {
        const k = `custom_property\u0000${prop}`;
        if (!toks.has(k)) toks.set(k, { uid: `WEB_TOKEN_${createHash('md5').update(k).digest('hex')}`, kind: 'custom_property', value: prop, decls: new Set(), proj: new Set(), sheets: new Set(), rules: new Set(), vars: new Set() });
        const t = toks.get(k)!; if (sheet) t.sheets.add(sheet); if (rule) t.rules.add(rule);
      }
      for (const tk of valueTokens(prop, unesc(g(T.decl, r, 'valueText')))) {
        const k = `${tk.kind}\u0000${tk.value}`;
        let t = toks.get(k);
        if (!t) { t = { uid: `WEB_TOKEN_${createHash('md5').update(k).digest('hex')}`, kind: tk.kind, value: tk.value, decls: new Set(), proj: new Set(), sheets: new Set(), rules: new Set(), vars: new Set() }; toks.set(k, t); }
        t.decls.add(did); if (!(sheet && notProject(sheet))) t.proj.add(did);
        if (sheet) t.sheets.add(sheet); if (rule) t.rules.add(rule);
        if (prop.startsWith('--') && tk.kind !== 'custom_property') t.vars.add(prop);
      }
    }
    for (const t of toks.values()) {
      out('web_tokens').push({ uid: t.uid, kind: t.kind, value: t.value, uses: t.decls.size, project_uses: t.proj.size, sheets: t.sheets.size, rules: t.rules.size,
        vars: t.vars.size ? [...t.vars].sort().join(' ') : null, unused: t.decls.size === 0 ? 1 : 0 });
      for (const d of t.decls) out('web_token_uses').push({ token_uid: t.uid, declaration_uid: d });
    }
    toks.clear();
    // §9.4 breakpoints
    interface Bp { uid: string; media: string; rules: Map<string, number>; sheets: Set<string> }
    const bps = new Map<string, Bp>();
    const bpOf = (media: string): Bp => { let b = bps.get(media); if (!b) { b = { uid: `WEB_BREAKPOINT_${createHash('md5').update(media).digest('hex')}`, media, rules: new Map(), sheets: new Set() }; bps.set(media, b); } return b; };
    for (const n of rules.values()) {
      let d = 0;
      for (let a = n.parent ? rules.get(n.parent) : undefined; a; a = a.parent ? rules.get(a.parent) : undefined) {
        d++;
        if (a.at === 'media') { const b = bpOf(normMedia(a.prelude)); if (!b.rules.has(n.id)) b.rules.set(n.id, d); b.sheets.add(n.sheet); }
      }
    }
    for (const loads of loadsOf.values()) for (const l of loads) for (const c of l.conds) {
      if (!c.startsWith('@media ')) continue;
      const b = bpOf(normMedia(c.slice(7)));
      b.sheets.add(l.sheet);
      for (const n of sheets.get(l.sheet)?.rules ?? []) if (!b.rules.has(n.id)) b.rules.set(n.id, 0);
    }
    for (const b of bps.values()) {
      const rg = mediaRange(b.media);
      const els = new Set<string>(); const pgs = new Set<string>();
      for (const [pid, pm] of pageMatches) for (const ruleId of b.rules.keys()) { const m = pm.get(ruleId); if (m && m.size) { pgs.add(pid); for (const e of m.keys()) els.add(e); } }
      out('web_breakpoints').push({ uid: b.uid, media: b.media, min_px: rg.min, max_px: rg.max, unit: rg.unit, features: rg.features, rules: b.rules.size, sheets: b.sheets.size,
        elements: els.size, pages: pgs.size });
      for (const [ruleId, d] of b.rules) out('web_rule_breakpoints').push({ rule_uid: ruleId, breakpoint_uid: b.uid, depth: d });
    }
    // §9.6 icon classes and font faces
    const carriers = new Map<string, El[]>(); // class -> elements carrying it (not iframe text)
    for (const e of elById.values()) if (e.inert !== 'iframe_text') for (const c of e.classes) push(carriers, c, e);
    const declOf = (ruleId: string, prop: string): string[] | undefined => {
      const ds = (declsOfRule.get(ruleId) ?? []).filter((d) => g(T.decl, d, 'property').toLowerCase() === prop); return ds[ds.length - 1];
    };
    const oneClass = (cx: Complex): { cls: string; pe: string } | null => {
      if (cx.length !== 1) return null;
      let cls: string | null = null; let pe = '';
      for (const sp of cx[0]!.simples) {
        if (sp.kind === 'CLASS') { if (cls !== null) return null; cls = sp.name; }
        else if (sp.kind === 'TYPE' || sp.kind === 'UNIVERSAL') continue;
        else if ((sp.kind === 'PSEUDO_ELEMENT' || sp.kind === 'PSEUDO_CLASS') && /^(before|after)$/i.test(sp.name.replace(/^:+/, ''))) pe = sp.name;
        else return null;
      }
      return cls ? { cls, pe } : null;
    };
    const fontRules = new Map<string, string>(); // class -> font-family value of a one-class rule (no pseudo)
    for (const s of selById.values()) {
      const oc = oneClass(s.cx); if (!oc || oc.pe) continue;
      const ff = declOf(s.rule, 'font-family'); if (ff && !fontRules.has(oc.cls)) fontRules.set(oc.cls, unesc(g(T.decl, ff, 'valueText')).trim());
    }
    const icons = new Set<string>();
    for (const s of selById.values()) {
      const oc = oneClass(s.cx); if (!oc || !oc.pe) continue;
      const ct = declOf(s.rule, 'content'); if (!ct) continue;
      const v = unesc(g(T.decl, ct, 'valueText')).trim();
      const m = /^(["'])(.*)\1$/s.exec(v); if (!m) continue;
      const inner = m[2]!;
      // ruling: <= 2 characters or exactly one CSS escape, as written; an empty string is no icon
      // an empty or whitespace-only string (a clearfix's " ") is no icon (V2-17)
      if (inner.trim() === '' || !(/^\\[0-9a-fA-F]{1,6} ?$/.test(inner) || [...inner].length <= 2)) continue;
      let ff: string | null = null;
      const own = declOf(s.rule, 'font-family'); if (own) ff = unesc(g(T.decl, own, 'valueText')).trim();
      const els = carriers.get(oc.cls) ?? [];
      // else the font of a class EVERY carrier also has (V2-17): one carrier's extra class says nothing of the others
      if (!ff && els.length) {
        const common = [...els[0]!.classes].filter((c) => c !== oc.cls && fontRules.has(c) && els.every((e) => e.classes.has(c))).sort();
        if (common.length) ff = fontRules.get(common[0]!)!;
      }
      icons.add(oc.cls);
      out('web_icon_classes').push({ class_name: oc.cls, rule_uid: s.rule, content: v, font_family: ff, used_elements: els.length });
    }
    const familyUses = new Map<string, number>();
    for (const r of T.decl.rows) if (g(T.decl, r, 'property').toLowerCase() === 'font-family' && g(T.decl, r, 'ruleLinkHash') && rules.get(g(T.decl, r, 'ruleLinkHash'))?.at !== 'font-face') {
      for (const f of unesc(g(T.decl, r, 'valueText')).split(',')) { const k = f.trim().replace(/^["']|["']$/g, '').toLowerCase(); familyUses.set(k, (familyUses.get(k) ?? 0) + 1); }
    }
    for (const n of rules.values()) if (n.at === 'font-face') {
      const fam = declOf(n.id, 'font-family'); const family = fam ? unesc(g(T.decl, fam, 'valueText')).trim().replace(/^["']|["']$/g, '') : null;
      const files = new Set<string>();
      for (const d of declsOfRule.get(n.id) ?? []) if (g(T.decl, d, 'property').toLowerCase() === 'src') {
        for (const vr of T.vref.rows) if (g(T.vref, vr, 'ownerDeclarationLinkHash') === g(T.decl, d, 'cssDeclarationUniqueHash') && g(T.vref, vr, 'referenceKind') === 'URL') {
          const abs = g(T.vref, vr, 'resolvedFilePath'); files.add(onDisk(abs) ? rel(abs) : g(T.vref, vr, 'name'));
        }
      }
      const w = declOf(n.id, 'font-weight'); const sty = declOf(n.id, 'font-style');
      out('web_font_faces').push({ rule_uid: n.id, family, src_files: files.size ? [...files].join(' ') : null, weight: w ? unesc(g(T.decl, w, 'valueText')).trim() : null,
        style: sty ? unesc(g(T.decl, sty, 'valueText')).trim() : null, used_rules: family ? familyUses.get(family.toLowerCase()) ?? 0 : 0 });
    }
    // §9.9 classes
    const naming = new Map<string, Set<string>>();
    for (const s of selById.values()) for (const c of s.classNamed) { let x = naming.get(c); if (!x) { x = new Set(); naming.set(c, x); } x.add(s.id); }
    for (const [c, els] of carriers) {
      const nm = naming.get(c) ?? new Set<string>();
      out('web_classes').push({ class_name: c, elements: els.length, pages: new Set(els.map((e) => elPage.get(e.id)?.id)).size, selectors_naming: nm.size,
        selectors_matching: [...nm].filter((x) => classSel.has(x)).length, styled: styledClass.has(c) ? 1 : 0, icon: icons.has(c) ? 1 : 0 });
    }
    log(`  web conversion layer (§9): ${computedRows} computed rows; components, tokens, breakpoints, forms, outline in ${((Date.now() - t9) / 1000).toFixed(1)}s`);
  }

  // ── skipped files ──
  const skipped: Row[] = [];
  for (const t of [T.skH, T.skC]) for (const r of t.rows) skipped.push([rel(g(t, r, 'filePath')), g(t, r, 'reason'), null, null, null, null]);
  return { skipped };
}

function decodeSafe(s: string): string { try { return decodeURIComponent(s); } catch { return s; } }


/**
 * The parser lowercases a TYPE part's name (`linearGradient` -> `lineargradient`); an SVG or MathML element's name is
 * case-sensitive, so the name is taken back from the selector text as written, part by part in source order.
 */
/**
 * Whether an element's source holds whitespace text between its start and end tag, comments aside: `<b> </b>` and
 * `<b><!-- x --> </b>` do, `<b></b>` and `<b><!-- x --></b>` do not. Without an end tag as written (an implied close),
 * no: what the browser puts in the element is not read here.
 */
export function whitespaceBetweenTags(src: string, tagLower: string): boolean {
  const end = new RegExp(`</${tagLower.replace(/[^\w-]/g, '')}\\s*>\\s*$`, 'i').exec(src);
  if (!end) return false;
  let s = src.slice(0, end.index); let ws = false;
  for (;;) {
    if (s.endsWith('-->')) { const c = s.lastIndexOf('<!--'); if (c < 0) return false; s = s.slice(0, c); continue; }
    const t = s.replace(/\s+$/, '');
    if (t.length === s.length) break;
    ws = true; s = t;
  }
  return ws && s.endsWith('>');
}

function writtenTypeNames(parts: PartRow[], text: string): void {
  let cursor = 0;
  for (const p of [...parts].sort((a, b) => a.position - b.position)) {
    if (p.kind !== 'TYPE' || !p.name) continue;
    const bare = p.name.includes('|') ? p.name.slice(p.name.indexOf('|') + 1) : p.name;
    const re = new RegExp(`(?<![\\w.#:-])${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'ig');
    re.lastIndex = cursor;
    const m = re.exec(text);
    if (m) { p.name = p.name.slice(0, p.name.length - bare.length) + m[0]; cursor = m.index + m[0].length; }
  }
}
