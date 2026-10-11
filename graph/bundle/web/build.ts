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

import * as ts from 'typescript';

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

interface Table { col: (name: string) => number; rows: string[][] }

/**
 * One web IR relation. The web tables never hold a raw tab or newline (EntityUtils.escapeTsv writes them as \t and
 * \n), so a row is a line and a field is a tab-split piece, quoted (inner quotes doubled) only when it holds a quote.
 * Read by line, not by character: the character reader builds every field by concatenation, and on the largest
 * corpus project (600k selector parts) that alone exhausted a 4 GB heap.
 */
async function readIr(dir: string, base: string): Promise<Table> {
  const file = path.join(dir, `${base}.csv`);
  const rows: string[][] = [];
  let header: string[] | null = null;
  const unq = (f: string): string => (f.length >= 2 && f.charCodeAt(0) === 34 && f.charCodeAt(f.length - 1) === 34 ? f.slice(1, -1).replace(/""/g, '"') : f);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    for await (const r of readRaw(file)) {
      const row = r.map(unq);
      if (row.length > 0 && row[row.length - 1]!.endsWith('\r')) row[row.length - 1] = row[row.length - 1]!.slice(0, -1);
      if (header === null) { header = row; continue; }
      if (row.length === header.length) rows.push(row.map((x) => (x.length > 64 ? x : flat(x))));
    }
  }
  const idx = new Map((header ?? []).map((n, i) => [n, i]));
  return {
    rows,
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

/** A copy of a short string that does not keep the 1 MB chunk it was sliced from alive. */
const internTable = new Map<string, string>();
function flat(x: string): string {
  if (x.length <= 40) {
    const hit = internTable.get(x);
    if (hit !== undefined) return hit;
    const c = (' ' + x).slice(1);
    if (internTable.size < 2_000_000) internTable.set(c, c);
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
const unesc = (s: string): string => (s.includes('\\') ? s.replace(/\\n/g, '\n').replace(/\\t/g, '\t') : s);
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
const VENDOR_PATH = /(^|\/)(vendors?|plugins|bower_components|node_modules|lib|libs|third[-_]party)\//i;
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

/** The class tokens a dynamic class binding can add: the tokens its text spells, or '*' (any). SPEC §3.2 R2. */
export function dynamicTokens(name: string, value: string): Set<string> | '*' {
  const n = name.toLowerCase();
  const m = /^\[class\.([^\]]+)\]$/.exec(n) || /^class:(.+)$/.exec(n);
  if (m) return new Set([m[1]!]);
  if (n === 'class') return '*';
  const sf = ts.createSourceFile('x.ts', `(${value});`, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const st = sf.statements[0];
  if (!st || !ts.isExpressionStatement(st) || (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics?.length) return '*';
  const out = new Set<string>(); let wild = false;
  const str = (s: string) => { for (const t of s.split(/\s+/).filter(Boolean)) out.add(t); };
  const val = (e: ts.Expression): void => {
    if (ts.isParenthesizedExpression(e)) return val(e.expression);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) { str(e.text); return; }
    if (e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return;
    if (ts.isObjectLiteralExpression(e)) {
      for (const p of e.properties) {
        if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) { wild = true; continue; }
        const k = p.name;
        if (ts.isIdentifier(k)) out.add(k.text); else if (ts.isStringLiteral(k) || ts.isNumericLiteral(k)) str(k.text); else wild = true;
      }
      return;
    }
    if (ts.isArrayLiteralExpression(e)) { e.elements.forEach((x) => val(x)); return; }
    if (ts.isConditionalExpression(e)) { val(e.whenTrue); val(e.whenFalse); return; }
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) { val(e.right); return; }
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.PlusToken) { val(e.left); val(e.right); return; }
    }
    wild = true;
  };
  val(st.expression);
  return wild ? '*' : out;
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
    const cand = urlKind === 'ROOT_RELATIVE' ? path.join(root, p0) : path.join(path.dirname(fromAbs), p0);
    return onDisk(cand) ? 'not_indexed' : reason;
  };
  const onDisk = (abs: string): boolean => { try { return abs !== '' && fs.statSync(abs).isFile(); } catch { return false; } };
  const unknownRow = (kind: string, node: string | null, page: string | null, reason: string, detail: string | null, file: string | null, line: number | null) =>
    out('web_unknown').push({ kind, node_uid: node, page_uid: page, reason, detail, file, line });

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
    const attrs = new Map<string, { value: string; hasValue: boolean }>();
    const ns = g(T.el, r, 'namespace');
    const html = ns === 'HTML' || ns === '';
    let dyn: Set<string> | '*' | null = null; let dynId = false; const dynAttrs = new Set<string>();
    for (const a of attrsOf.get(id) ?? []) {
      const name = g(T.attr, a, 'name'), prefix = g(T.attr, a, 'prefix');
      const full = prefix ? `${prefix}:${name}` : name;
      const v = { value: unesc(g(T.attr, a, 'value')), hasValue: g(T.attr, a, 'hasValue') === 'true' };
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
  for (const p of pages.values()) {
    let lines: string[] | null = null;
    const textOf = (id: string): string => {
      if (lines === null) { try { let t = fs.readFileSync(p.abs, 'utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); lines = t.split('\n'); } catch { lines = []; } }
      const r = elRow.get(id)!; const sl = num(g(T.el, r, 'startLine'))!, sc = num(g(T.el, r, 'startColumn'))!, el = num(g(T.el, r, 'endLine'))!, ec = num(g(T.el, r, 'endColumn'))!;
      if (sl === el) return (lines[sl - 1] ?? '').slice(sc - 1, ec);
      return [(lines[sl - 1] ?? '').slice(sc - 1), ...lines.slice(sl, el - 1), (lines[el - 1] ?? '').slice(0, ec)].join('\n');
    };
    let mended = false;
    for (const e of p.elements) {
      if (!(e.ns === 'HTML' || e.ns === '') || VOID_ELEMENTS.has(e.tagLower) || e.children.length > 0 || e.childCount > 0) continue;
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
    if (p.kind === 'FRAGMENT') unknownRow('fragment_no_host', p.id, p.id, 'fragment_no_host', 'a fragment page is matched only in a host page that includes it', p.file, 1);
  }

  // attributes; on* attributes numbered per page in document order (handler_index)
  const onIndex = new Map<string, number>();
  {
    const byPage = new Map<string, string[][]>();
    for (const r of T.attr.rows) {
      const d = g(T.attr, r, 'documentLinkHash');
      out('web_attributes').push({ uid: g(T.attr, r, 'htmlAttributeUniqueHash'), element_uid: g(T.attr, r, 'ownerElementLinkHash'), page_uid: d, file: fileOfPage(d),
        line: num(g(T.attr, r, 'startLine')), col: num(g(T.attr, r, 'startColumn')), name: g(T.attr, r, 'name'), prefix: nz(g(T.attr, r, 'prefix')),
        value: unesc(g(T.attr, r, 'value')), kind: g(T.attr, r, 'attributeKind'), has_value: bool(g(T.attr, r, 'hasValue')) });
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
      line: num(g(T.cls, r, 'startLine')), position: num(g(T.cls, r, 'position')), class_name: g(T.cls, r, 'className') });
  }
  const refById = new Map<string, string[]>();
  const refsOfPage = new Map<string, string[][]>();
  for (const r of T.ref.rows) {
    const d = g(T.ref, r, 'documentLinkHash');
    const id = g(T.ref, r, 'htmlReferenceUniqueHash');
    refById.set(id, r); push(refsOfPage, d, r);
    const abs = g(T.ref, r, 'resolvedFilePath');
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
        for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) starts.push(i + 1);
        v = p ? { text: t, starts } : null;
      } catch { v = null; }
      pageText.set(pageId, v);
    }
    return pageText.get(pageId)!;
  };
  /** the 0-based offset of a 1-based (line, column) in the page text */
  const offsetOf = (pt: { starts: number[] }, line: number, col: number): number => (pt.starts[line - 1] ?? 0) + col - 1;

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
          body_length: num(g(T.script, r, 'bodyLength')), body_lines: body === null ? null : body === '' ? 0 : body.split('\n').length,
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
      const dial = dialectsOf.get(page) ?? new Set<string>();
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
      const value = unesc(g(T.attr, r, 'value'));
      const line = num(g(T.attr, r, 'startLine')), col = num(g(T.attr, r, 'startColumn'));
      if (!/^(?:on|v-on:|x-on:|@|\(|(?:data-)?ng-|hx-on|data-action$)/i.test(name)) continue;
      const written = writtenName(d, line, col, name);
      const hs = classify(written, value, e, d);
      if (hs.length === 0) continue;
      hs.forEach((h, i) => {
        const code = h.code ?? value;
        push(handlersByPage, d, { uid: hs.length > 1 ? `${g(T.attr, r, 'htmlAttributeUniqueHash')}#${i + 1}` : g(T.attr, r, 'htmlAttributeUniqueHash'),
          element_uid: elId, attribute_uid: g(T.attr, r, 'htmlAttributeUniqueHash'), page_uid: d, file: fileOfPage(d), tag: e?.tag ?? null, attr_as_written: written,
          event: h.event, event_source: h.source ?? 'written', modifiers: h.modifiers, source_kind: h.kind, code, code_bytes: Buffer.byteLength(code, 'utf8'), line, col, handler_index: null,
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
      const line = num(g(T.ref, r, 'startLine')), col = num(g(T.ref, r, 'startColumn'));
      push(handlersByPage, d, { uid: g(T.ref, r, 'htmlReferenceUniqueHash'), element_uid: elId, attribute_uid: nz(g(T.ref, r, 'attributeLinkHash')), page_uid: d,
        file: fileOfPage(d), tag: elById.get(elId)?.tag ?? null, attr_as_written: writtenName(d, line, col, attr), event: 'navigate', event_source: 'written', modifiers: '',
        source_kind: 'javascript_url', code, code_bytes: Buffer.byteLength(code, 'utf8'), line, col, handler_index: null, known_event: null });
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
  for (const r of T.tpl.rows) {
    const d = g(T.tpl, r, 'documentLinkHash');
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
      property: g(T.decl, r, 'property'), value_text: nz(unesc(g(T.decl, r, 'valueText')).replace(/\/\*[\s\S]*?\*\//g, '').trim()), is_important: bool(g(T.decl, r, 'isImportant')),
      is_custom: bool(g(T.decl, r, 'isCustomProperty')), vendor_prefix: nz(g(T.decl, r, 'vendorPrefix')), position: num(g(T.decl, r, 'position')) });
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
    n.import = { to: importTo.get(vid) ?? null, vref: vid, media: parts.media, supports: parts.supports, layer: parts.layer,
      url: vr ? g(T.vref, vr, 'name') : n.prelude, reason: importTo.has(vid) ? null : onDiskReason(importUnknown.get(vid) ?? 'unresolved_url', s.abs, vr ? g(T.vref, vr, 'name') : '', vr ? g(T.vref, vr, 'urlKind') : '') };
    out('web_imports').push({ from_stylesheet_uid: s.id, to_stylesheet_uid: n.import.to, value_ref_uid: nz(vid), url_as_written: n.import.url,
      status: n.import.to ? 'match' : 'unknown', reason: n.import.to ? null : n.import.reason });
  }

  // ── per page: what it loads, in cascade order (SPEC §3.1, §3.3) ──
  interface Load { sheet: string; via: string; viaId: string; depth: number; order: number; conds: string[]; layer: string | null; disabled: boolean }
  const loadsOf = new Map<string, Load[]>();
  const loadedBy = new Map<string, Set<string>>();
  const joinLayer = (a: string | null, b: string | null): string | null => (a && b ? `${a}.${b}` : a || b || null);
  const mediaCond = (m: string): string[] => (m && !/^all$/i.test(m.trim()) ? [`@media ${m.trim()}`] : []);
  for (const page of pages.values()) {
    const loads: Load[] = []; let order = 0;
    const rows: Record<string, string | number | null>[] = [];
    const pushSheet = (sid: string, via: string, viaId: string, depth: number, conds: string[], layer: string | null, disabled: boolean, stack: Set<string>) => {
      const s = sheets.get(sid)!;
      for (const n of s.rules) {
        if (!n.import) continue;
        const c = [...conds, ...mediaCond(n.import.media), ...(n.import.supports ? [`@supports ${n.import.supports}`] : [])];
        const lay = n.import.layer ? joinLayer(layer, n.import.layer) : layer;
        if (n.import.to && !stack.has(n.import.to)) pushSheet(n.import.to, 'import', s.id, depth + 1, c, lay, disabled, new Set([...stack, n.import.to]));
        else if (!n.import.to) rows.push({ page_uid: page.id, stylesheet_uid: null, url_as_written: n.import.url, via: 'import', via_uid: s.id, load_order: null, import_depth: depth + 1,
          media: nz(n.import.media), layer: null, status: 'unknown', reason: n.import.reason });
      }
      order += 1;
      loads.push({ sheet: sid, via, viaId, depth, order, conds, layer, disabled });
      rows.push({ page_uid: page.id, stylesheet_uid: sid, url_as_written: via === 'style' ? null : (s.kind === 'FILE' ? s.file : null), via, via_uid: viaId, load_order: order,
        import_depth: depth, media: conds.length ? conds.join(' && ') : null, layer, status: disabled ? 'conditional' : 'match', reason: disabled ? 'alternate_sheet' : null });
    };
    const styleSheetOf = new Map<string, string>();
    for (const s of sheets.values()) if (s.kind === 'HTML_STYLE_ELEMENT' && s.page === page.id) styleSheetOf.set(s.owner, s.id);
    const linkRefs = new Map<string, string[]>();
    for (const r of refsOfPage.get(page.id) ?? []) if (g(T.ref, r, 'referenceKind') === 'STYLESHEET') linkRefs.set(g(T.ref, r, 'ownerElementLinkHash'), r);
    for (const e of page.elements) {
      if (e.inert === 'template' || e.inert === 'iframe_text') continue;
      if (e.tagLower === 'style' && (e.ns === 'HTML' || e.ns === '')) {
        const sid = styleSheetOf.get(e.id); if (!sid) continue;
        pushSheet(sid, 'style', e.id, 0, mediaCond(e.attrs.get('media')?.value ?? ''), null, false, new Set([sid]));
      } else if (e.tagLower === 'link' && (e.ns === 'HTML' || e.ns === '')) {
        const relAttr = (e.attrs.get('rel')?.value ?? '').toLowerCase().split(/\s+/);
        if (!relAttr.includes('stylesheet')) continue;
        const r = linkRefs.get(e.id); if (!r) continue;
        const refId = g(T.ref, r, 'htmlReferenceUniqueHash');
        const disabled = relAttr.includes('alternate') || e.attrs.has('disabled');
        const sid = sheetOfRef.get(refId);
        if (sid) pushSheet(sid, 'link', e.id, 0, mediaCond(e.attrs.get('media')?.value ?? ''), null, disabled, new Set([sid]));
        else rows.push({ page_uid: page.id, stylesheet_uid: null, url_as_written: g(T.ref, r, 'urlAsWritten'), via: 'link', via_uid: e.id, load_order: null, import_depth: 0,
          media: nz(e.attrs.get('media')?.value ?? ''), layer: null, status: 'unknown', reason: onDiskReason(linkUnknownOf.get(refId) ?? 'unresolved_url', page.abs, g(T.ref, r, 'path'), g(T.ref, r, 'urlKind')) });
      }
    }
    for (const row of rows) {
      out('web_loads').push(row);
    }
    loadsOf.set(page.id, loads);
    for (const l of loads) { const set = loadedBy.get(l.sheet) ?? new Set<string>(); set.add(page.id); loadedBy.set(l.sheet, set); }
  }
  for (const s of sheets.values()) {
    if (!loadedBy.has(s.id)) unknownRow('orphan_sheet', s.id, null, 'orphan_sheet', 'loaded by no page (no <link>, no @import chain from a loaded sheet)', s.file, 1);
  }
  for (const r of T.sheet.rows) {
    const id = g(T.sheet, r, 'cssStylesheetUniqueHash'); const s = sheets.get(id)!;
    out('web_stylesheets').push({ uid: id, file: s.file, name: g(T.sheet, r, 'name'), source_kind: s.kind, owner_element_uid: nz(s.owner), page_uid: nz(s.page),
      minified: g(T.sheet, r, 'sourceProvenance') === 'MINIFIED' ? 1 : 0, vendor: s.kind === 'FILE' && (VENDOR_PATH.test(s.file) || /\.min\.css$/i.test(s.file)) ? 1 : 0,
      rule_count: num(g(T.sheet, r, 'ruleCount')), declaration_count: num(g(T.sheet, r, 'declarationCount')), gap_count: num(g(T.sheet, r, 'parseGapCount')),
      line: num(g(T.sheet, r, 'startLine')), end_line: num(g(T.sheet, r, 'endLine')), display: s.display, loaded_by_pages: loadedBy.get(id)?.size ?? 0 });
  }

  // ── rules, selectors, parts ──
  for (const n of rules.values()) {
    const r = ruleRow.get(n.id)!;
    out('web_rules').push({ uid: n.id, stylesheet_uid: n.sheet, parent_uid: nz(n.parent), file: sheetFile(n.sheet), line: n.line, col: n.col,
      end_line: num(g(T.rule, r, 'endLine')), end_col: num(g(T.rule, r, 'endColumn')), rule_kind: n.kind, at_rule_name: nz(n.at), name: nz(n.name), prelude_text: nz(n.prelude),
      nesting_depth: num(g(T.rule, r, 'nestingDepth')), position: num(g(T.rule, r, 'position')), rule_order: n.order, layer: nz(n.layer),
      conditions: n.conditions.length ? n.conditions.join(' && ') : null, in_keyframes: n.matchable ? 0 : 1, important_count: n.important });
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
    if (!textCache.has(s.abs)) { try { textCache.set(s.abs, fs.readFileSync(s.abs, 'utf8').split('\n')); } catch { textCache.set(s.abs, null); } }
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
  interface Cand { pe: string; rule: string; st: number; a: number; b: number; c: number; so: number; ro: number; lr: number }
  const cmpCand = (x: Cand, y: Cand): number => (x.a - y.a) || (x.b - y.b) || (x.c - y.c) || (x.so - y.so) || (x.ro - y.ro) || (x.lr - y.lr);
  const classSel = new Set<string>(); const styledClass = new Set<string>();
  const inlineDecls = new Map<string, string[][]>(); // element -> its style attribute's declarations
  for (const r of T.decl.rows) { const a = g(T.decl, r, 'htmlAttributeLinkHash'); const el = a ? attrOwner.get(a) : undefined; if (el) push(inlineDecls, el, r); }
  const pad = (n: number, w: number): string => String(Math.max(0, Math.trunc(n))).padStart(w, '0');
  /** the cascade sort key as text (web_cascade recomputes it in SQL with the same layout): higher wins */
  const keyOf = (imp: number, inline: boolean, lr: number, a: number, b: number, c: number, so: number, ro: number, pos: number): string =>
    `${imp}|${pad(inline ? 2000000000 : imp ? 1000000000 - lr : lr, 10)}|${pad(a, 4)}|${pad(b, 4)}|${pad(c, 4)}|${pad(so, 6)}|${pad(ro, 7)}|${pad(pos, 5)}`;
  let computedRows = 0;
  const computedOf = (pageId: string, cands: Map<string, Map<string, Cand>>) => {
    const els = new Set<string>([...cands.keys()]);
    for (const e of pages.get(pageId)?.elements ?? []) if (inlineDecls.has(e.id) && e.inert !== 'iframe_text') els.add(e.id);
    for (const elId of els) {
      interface K { decl: string; prop: string; key: string; st: number; inline: boolean; imp: number; value: string }
      const byPe = new Map<string, Map<string, K[]>>();
      const add = (pe: string, k: K) => { let m = byPe.get(pe); if (!m) { m = new Map(); byPe.set(pe, m); } const a = m.get(k.prop); if (a) a.push(k); else m.set(k.prop, [k]); };
      for (const c of cands.get(elId)?.values() ?? []) {
        for (const d of declsOfRule.get(c.rule) ?? []) {
          const imp = g(T.decl, d, 'isImportant') === 'true' ? 1 : 0;
          add(c.pe, { decl: g(T.decl, d, 'cssDeclarationUniqueHash'), prop: g(T.decl, d, 'property').toLowerCase(), st: c.st, inline: false, imp,
            key: keyOf(imp, false, c.lr, c.a, c.b, c.c, c.so, c.ro, num(g(T.decl, d, 'position')) ?? 0), value: g(T.decl, d, 'valueText') });
        }
      }
      for (const d of inlineDecls.get(elId) ?? []) {
        const imp = g(T.decl, d, 'isImportant') === 'true' ? 1 : 0;
        add('', { decl: g(T.decl, d, 'cssDeclarationUniqueHash'), prop: g(T.decl, d, 'property').toLowerCase(), st: 0, inline: true, imp,
          key: keyOf(imp, true, 0, 0, 0, 0, 0, 0, num(g(T.decl, d, 'position')) ?? 0), value: g(T.decl, d, 'valueText') });
      }
      for (const [pe, props] of byPe) {
        for (const ks of props.values()) ks.sort((x, y) => (x.key < y.key ? 1 : x.key > y.key ? -1 : 0));
        for (const [prop, ks] of props) {
          let wi = ks.findIndex((k) => k.st === 0);
          let status = 'match';
          if (wi < 0) { wi = ks.findIndex((k) => k.st === 1); status = 'conditional_only'; }
          if (wi < 0) { wi = 0; status = 'unknown'; }
          const w = ks[wi]!;
          const above = ks.slice(0, wi);
          const condOver = above.filter((k) => k.st === 1).length;
          if (status === 'match' && above.some((k) => k.st === 2)) status = 'unknown';
          let override: K | null = null;
          for (const sh of SHORTHANDS.get(prop) ?? []) for (const k of props.get(sh) ?? []) if (k.st === 0 && k.key > w.key && (!override || k.key > override.key)) override = k;
          if (override && status === 'match') status = 'shorthand_override';
          computedRows++;
          out('web_computed').push({ element_uid: elId, page_uid: pageId, pseudo: pe || null, property: prop, winner_decl_uid: w.decl, winner_origin: w.inline ? 'inline' : 'rule',
            winner_status: status, value_text: unesc(w.value).replace(/\/\*[\s\S]*?\*\//g, '').trim() || null, important: w.imp, contenders: ks.length, conditional_overrides: condOver,
            override_decl_uid: override?.decl ?? null, winner_key: w.key });
        }
      }
    }
  };
  const pageMatches = new Map<string, Map<string, Map<string, number>>>(); // page -> rule -> element -> best status
  let styleRows = 0;
  const t0 = Date.now();
  for (const [pageId, loads] of loadsOf) {
    const page = pages.get(pageId)!;
    const cands = new Map<string, Map<string, Cand>>();
    if (page.kind === 'FRAGMENT' || page.elements.length === 0) continue;
    const live = page.elements.filter((e) => e.inert !== 'iframe_text');
    const ctx = pageCtx(live, page.quirks, page.lang);
    const m = new Matcher(ctx, false);
    const md = ctx.dynamicClassEls.length ? new Matcher(ctx, true) : null;
    const ruleEls = new Map<string, Map<string, number>>();
    pageMatches.set(pageId, ruleEls);
    const rank = layerRanks(loads);
    const seen = new Set<string>();
    const unmatched = new Map<string, { any: boolean; missing: boolean }>();
    const fold = (x: string) => (page.quirks ? x.toLowerCase() : x);
    for (const l of loads) {
      const sh = sheets.get(l.sheet)!;
      for (const n of sh.rules) {
        if (n.kind !== 'STYLE_RULE' || !n.matchable) continue;
        const sels = selsOfRule.get(n.id) ?? [];
        if (sels.length === 0) continue;
        const atConds = [...l.conds, ...n.conditions];
        const layerRank = rank(joinLayer(l.layer, n.layer || null));
        const conditions = atConds.length ? atConds.join(' && ') : null;
        const scope = n.inScope ? scopeOf(n) : null;
        for (const s of sels) {
          let st = selStats.get(s.id);
          if (!st) { st = { loading: 0, matched: 0, elements: 0, unmatched: 0, missing: 0, wholeUnk: 0, m: 0, c: 0, u: 0, ur: '' }; selStats.set(s.id, st); }
          if (!seen.has(`l|${s.id}`)) { seen.add(`l|${s.id}`); st.loading++; }
          const unk = s.unknown || scope?.spec.unknown || '';
          if (unk) { if (!seen.has(`u|${s.id}`)) { seen.add(`u|${s.id}`); st.wholeUnk++; st.ur ||= unk; unknownRow(unk, s.id, pageId, unk, null, sheetFile(l.sheet), null); } continue; }
          if (s.root && !page.hasHtml && !scope) { if (!seen.has(`u|${s.id}`)) { seen.add(`u|${s.id}`); st.wholeUnk++; st.ur ||= 'implied_element'; unknownRow('implied_element', s.id, pageId, 'implied_element', null, sheetFile(l.sheet), null); } continue; }
          const base = new Set(s.reasons);
          for (const c of atConds) base.add(`at_rule:${c.split(/\s/)[0]!.slice(1).toLowerCase()}`);
          if (l.disabled) base.add('alternate_sheet');
          if (scope) for (const r of scope.spec.reasons) base.add(r);
          let u = unmatched.get(s.id); if (!u) { u = { any: false, missing: false }; unmatched.set(s.id, u); }
          const missing = s.req.classes.some((c) => !ctx.classes.has(fold(c))) || s.req.ids.some((c) => !ctx.ids.has(fold(c)));
          const W = new Set<string>();
          const emit = (e: El, status: string, reason: string, root: El | null) => {
            const sc = status === 'match' ? EXACT : status === 'conditional' ? COND : UNKNOWN;
            if (sc !== UNKNOWN || reason !== 'lang_unknown') {
              let re = ruleEls.get(n.id); if (!re) { re = new Map(); ruleEls.set(n.id, re); }
              if ((re.get(e.id) ?? NO) < sc) re.set(e.id, sc);
            }
            u!.any = true;
            // §9.2 contenders: per (element, pseudo, rule) the best styles row (status, then the cascade key)
            {
              const ck = `${s.pe}|${n.id}`; let em = cands.get(e.id); if (!em) { em = new Map(); cands.set(e.id, em); }
              const prev = em.get(ck); const stc = status === 'match' ? 0 : status === 'conditional' ? 1 : 2;
              const cand = { pe: s.pe, rule: n.id, st: stc, a: s.spec[0], b: s.spec[1], c: s.spec[2], so: l.order, ro: n.order, lr: layerRank };
              if (!prev || stc < prev.st || (stc === prev.st && cmpCand(cand, prev) > 0)) em.set(ck, cand);
              for (const c of s.classNamed) { classSel.add(s.id); if (e.classes.has(c)) styledClass.add(c); }
            }
            // one row per LOAD (V1-07): a sheet linked twice is in the cascade twice, the later load's sheet_order winning
            if (seen.has(`s|${s.id}|${e.id}|${l.order}`)) return;
            seen.add(`s|${s.id}|${e.id}|${l.order}`); styleRows++;
            if (!seen.has(`s|${s.id}|${e.id}|${status}`)) {
              seen.add(`s|${s.id}|${e.id}|${status}`);
              if (status === 'match') { st!.elements++; st!.m++; } else if (status === 'conditional') st!.c++; else { st!.u++; st!.ur ||= reason; }
            }
            let prox: number | null = null;
            if (root) { prox = 0; for (let a: El | null = e; a && a !== root; a = a.parent) prox++; }
            out('web_styles').push({ selector_uid: s.id, rule_uid: n.id, stylesheet_uid: l.sheet, element_uid: e.id, page_uid: pageId, status, reason: reason || null,
              conditions, pseudo_element: nz(s.pe), spec_a: s.spec[0], spec_b: s.spec[1], spec_c: s.spec[2], layer_rank: layerRank,
              sheet_order: l.order, rule_order: n.order, important_count: n.important, scope_root: root?.id ?? null, scope_proximity: prox });
          };
          const statusOf = (rs: { s: number; r: string }, e: El): [string, string] => {
            const reasons = new Set(base);
            if (e.inert) reasons.add(`inert:${e.inert}`);
            if (rs.s === UNKNOWN) return ['unknown', rs.r];
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
          if (!missing) {
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
    for (const [sid, u] of unmatched) {
      if (u.any) { const st = selStats.get(sid); if (st) st.matched++; continue; }
      // [iter2 grain] no per-(selector, page) unknown row: counted on the selector row; the page list is the view
      // web_selector_unmatched_pages
      const st = selStats.get(sid); if (!st || seen.has(`u|${sid}`)) continue;
      st.unmatched++; if (u.missing) st.missing++;
    }
    computedOf(pageId, cands);
  }
  for (const pageId of pages.keys()) if (!loadsOf.has(pageId)) computedOf(pageId, new Map());
  log(`  web styles: ${styleRows} selector->element rows over ${loadsOf.size} page(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const s of selById.values()) {
    const r = s.row; const st = selStats.get(s.id); const n = rules.get(s.rule);
    const dec = !n || !n.matchable ? { d: 'none', r: n?.inKeyframes ? 'keyframe_selector' : 'not_an_element_selector' }
      : s.unknown ? { d: 'unknown', r: s.unknown }
      : (s.reasons.length || (n.condNames.length > 0)) ? { d: 'conditional', r: [...s.reasons, ...n.condNames.map((c) => `at_rule:${c}`)].join(';') } : { d: 'exact', r: null };
    const usage = dec.d === 'none' ? null : !st || st.loading === 0 ? 'not_loaded' : st.m > 0 ? 'matched' : st.c > 0 ? 'conditional_only'
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
    const visible = new Set<string>();
    for (const [vref, name, decl] of R.useVar) {
      const a = declAttr(decl!);
      const usePages = a ? new Set([attrPage.get(a) ?? '']) : pagesLoading(declSheet(decl!));
      const fb = g(T.vref, vrefRow.get(vref!) ?? [], 'fallbackText');
      // V1-22 grain: one row per (use, def OWNER) — the sheet or the page (style attribute) holding the definitions — not
      // per (use, def): a name defined in every theme sheet made the use x def product 8.5x the budget. Lossless: the
      // per-definition rows are the view web_var_visible_defs (web_var_def by name and owner).
      const byOwner = new Map<string, { kind: string; defs: string[] }>();
      const okOwner = new Map<string, boolean>();
      for (const d of defsByName.get(name!) ?? []) {
        const w = defSheetOrPage(d);
        const owner = w.page ? w.page : w.sheet; const kind = w.page ? 'page' : 'sheet';
        let ok = okOwner.get(owner);
        if (ok === undefined) { ok = [...usePages].some((p) => (w.page ? w.page === p : pagesLoading(w.sheet).has(p))); okOwner.set(owner, ok); }
        if (!ok) continue;
        let o = byOwner.get(owner); if (!o) { o = { kind, defs: [] }; byOwner.set(owner, o); }
        o.defs.push(d);
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
      if (!definingRules.has(name) && !attrDefEls.has(name) && !propOnly) return; // nothing defines it anywhere: web_var_visible says so, once per use
      const sk = `${pageId}|${elId}|${name}`; if (scopeSeen.has(sk)) return; scopeSeen.add(sk);
      const defRules = [...(definingRules.get(name) ?? [])].filter((r) => ruleEls.has(r));
      const attrDefs = attrDefEls.get(name);
      let root: string | null = null, rootSt = NO, rootExact: string | null = null;
      for (let a: El | null = elById.get(elId) ?? null; a; a = a.parent) {
        let best = attrDefs?.has(a.id) ? EXACT : NO;
        for (const dr of defRules) best = Math.max(best, ruleEls.get(dr)!.get(a.id) ?? NO);
        if (best === UNKNOWN) best = NO;
        if (best > NO && root === null) { root = a.id; rootSt = best; }
        if (best === EXACT) { rootExact = a.id; break; }
      }
      out('web_var_scope').push({ page_uid: pageId, element_uid: elId, name, root_uid: root, root_exact_uid: rootExact !== root ? rootExact : null,
        status: root ? (rootSt === EXACT ? 'match' : 'conditional') : 'unknown',
        reason: root ? null : propOnly ? 'property_initial' : (defRules.length || attrDefs ? 'not_inherited' : 'no_definition_in_scope') });
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
  for (const r of T.ref.rows) {
    const page = g(T.ref, r, 'documentLinkHash'); const elId = g(T.ref, r, 'ownerElementLinkHash'); const e = elById.get(elId);
    const attr = g(T.ref, r, 'attributeName'); const uk = g(T.ref, r, 'urlKind'); const url = g(T.ref, r, 'urlAsWritten'); const id = g(T.ref, r, 'htmlReferenceUniqueHash');
    const kind = g(T.ref, r, 'referenceKind');
    if (['IMAGE', 'MEDIA', 'LINK_RESOURCE', 'SCRIPT', 'OTHER', 'REQUEST'].includes(kind) && uk !== 'DATA_URI' && uk !== 'JAVASCRIPT_URI' && uk !== 'FRAGMENT') {
      const abs = g(T.ref, r, 'resolvedFilePath'); const ex = onDisk(abs);
      out('web_resources').push({ from_uid: elId, from_kind: 'element', owner_uid: page, kind, url, file: ex ? rel(abs) : null, file_exists: ex ? 1 : 0, status: ex ? 'match' : 'unknown',
        reason: ex ? null : (uk === 'ABSOLUTE' || uk === 'PROTOCOL_RELATIVE' || uk === 'OTHER_SCHEME' ? 'external_url' : uk === 'TEMPLATE_EXPRESSION' ? 'template_url' : 'unresolved_url') });
    }
    if (!e || LINK_ATTRS[e.tagLower] !== attr.toLowerCase()) continue;
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
      const cand = uk === 'ROOT_RELATIVE' ? path.join(root, g(T.ref, r, 'path')) : pg ? path.join(path.dirname(pg.abs), g(T.ref, r, 'path')) : '';
      if (cand && isDir(cand)) absRaw = cand;
    }
    // `?p=1` (a query with no path) is the page itself with other parameters (V1-06)
    if (!absRaw && uk === 'RELATIVE' && !g(T.ref, r, 'path') && g(T.ref, r, 'query')) absRaw = pages.get(page)?.abs ?? '';
    // a URL naming a directory (`docs/`) serves its index page
    const abs = absRaw && !pageByAbs.has(absRaw) && isDir(absRaw) ? (['index.html', 'index.htm'].map((f) => path.join(absRaw, f)).find((f) => pageByAbs.has(f)) ?? absRaw) : absRaw;
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
      const sh = sheets.get(sheetId); if (!sh) return false;
      if (VENDOR_PATH.test(sh.file)) return true;
      const twin = sh.file.replace(/\.min\.css$/i, '.css');
      return twin !== sh.file && sheetFiles.has(twin);
    };
    interface Tok { uid: string; kind: string; value: string; decls: Set<string>; proj: Set<string>; sheets: Set<string>; rules: Set<string>; vars: Set<string> }
    const toks = new Map<string, Tok>();
    for (const r of T.decl.rows) {
      const did = g(T.decl, r, 'cssDeclarationUniqueHash'); const prop = g(T.decl, r, 'property');
      const sheet = g(T.decl, r, 'stylesheetLinkHash'); const rule = g(T.decl, r, 'ruleLinkHash');
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
        vars: t.vars.size ? [...t.vars].sort().join(' ') : null });
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
      if (inner === '' || !(/^\\[0-9a-fA-F]{1,6} ?$/.test(inner) || [...inner].length <= 2)) continue;
      let ff: string | null = null;
      const own = declOf(s.rule, 'font-family'); if (own) ff = unesc(g(T.decl, own, 'valueText')).trim();
      const els = carriers.get(oc.cls) ?? [];
      if (!ff) for (const e of els) { for (const c of e.classes) if (c !== oc.cls && fontRules.has(c)) { ff = fontRules.get(c)!; break; } if (ff) break; }
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
