/**
 * THE DOM-TOUCH TABLE of a JavaScript (or TypeScript) graph (#1908, SPEC §4.2): every site where script text names
 * the page's markup — a selector, id, class, tag, event, attribute or style property — with the literal it names and
 * the tokens it contains (`.a #b div [data-x]`), so `.btn` is found in `querySelectorAll('nav .btn > a')`.
 *
 * Read from the JavaScript IR (call sites and expressions) rather than derived in the Soufflé rules: it is a lexical
 * table — an API name, a receiver shape, a literal argument — that needs no resolution, and kept out of the rules it
 * costs no recompile of the JavaScript engine (a cold one is the longest compile in the repository). Streamed: only
 * the rows that can belong to a DOM touch are held.
 *
 * A table of the JavaScript graph: no row names a node of the web graph. A non-literal argument (a variable, a
 * concatenation, a template with substitutions) is a row with status non_literal and no literal, never guessed.
 */
import * as fs from 'fs';
import * as path from 'path';

import { readRaw } from '@/bundle/csv';

const COLUMNS = ['site_id', 'method_id', 'module_id', 'file', 'line', 'column', 'api', 'arg_index', 'literal', 'literal_kind', 'tokens', 'status'];

/** method -> [what its arguments name, which 0-based arguments] for a call on any receiver */
const DOM_CALLS: Record<string, [string, number[]]> = {
  querySelector: ['selector', [0]], querySelectorAll: ['selector', [0]], closest: ['selector', [0]], matches: ['selector', [0]],
  getElementById: ['id', [0]], getElementsByClassName: ['class', [0]], getElementsByTagName: ['tag', [0]], getElementsByName: ['name', [0]],
  setAttribute: ['attribute', [0]], getAttribute: ['attribute', [0]], removeAttribute: ['attribute', [0]], toggleAttribute: ['attribute', [0]],
  hasAttribute: ['attribute', [0]], addEventListener: ['event', [0]], removeEventListener: ['event', [0]], insertAdjacentHTML: ['html', [1]],
  createElement: ['tag', [0]],
};
const CLASSLIST: Record<string, number[] | 'all'> = { add: 'all', remove: 'all', toggle: [0], contains: [0], replace: [0, 1] };
const JQ_ANY: Record<string, string> = { addClass: 'class', removeClass: 'class', toggleClass: 'class', hasClass: 'class' };
const JQ_RECV: Record<string, string> = { attr: 'attribute', prop: 'attribute', css: 'css_property', on: 'event', off: 'event', one: 'event', trigger: 'event',
  find: 'selector', closest: 'selector', children: 'selector', parents: 'selector' };
const HTML_PROPS = new Set(['innerHTML', 'outerHTML']);

/** The class, id, tag and attribute tokens a selector names, in written order, each once. */
export function selectorTokens(sel: string): string[] {
  const out: string[] = [];
  const s = sel.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').replace(/\((?:[^()]|\([^()]*\))*\)/g, (m) => m.replace(/[^\s,]/g, (c) => (/[.#\[\]>+~*a-zA-Z0-9_-]/.test(c) ? c : ' ')));
  const re = /([.#])((?:\\.|[\w-])+)|\[\s*([\w:-]+)|(?:^|[\s>+~,(])([a-zA-Z][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[1]) out.push(m[1] + m[2]!.replace(/\\(.)/g, '$1'));
    else if (m[3]) out.push(`[${m[3]}]`);
    else if (m[4]) out.push(m[4].toLowerCase());
  }
  return [...new Set(out)];
}

/** The tags, then the class tokens, then the ids an HTML string names. */
export function htmlTokens(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)/g)) out.push(m[1]!.toLowerCase());
  for (const m of html.matchAll(/\bclass\s*=\s*["']([^"']*)["']/g)) for (const t of m[1]!.split(/\s+/).filter(Boolean)) out.push('.' + t);
  for (const m of html.matchAll(/\bid\s*=\s*["']([^"']*)["']/g)) out.push('#' + m[1]);
  return [...new Set(out)];
}

export function tokensOf(literal: string | null, kind: string): string {
  if (literal === null) return '';
  switch (kind) {
    case 'class': return literal.split(/\s+/).filter(Boolean).map((t) => '.' + t).join(',');
    case 'id': return '#' + literal;
    case 'tag': return literal.toLowerCase();
    case 'selector': return selectorTokens(literal).join(',');
    case 'html': return htmlTokens(literal).join(',');
    default: return literal;
  }
}

/** a string literal's text, quotes removed; a template literal with no substitution likewise; else null */
function literalOf(kind: string, text: string, literalKind: string): string | null {
  if (kind === 'LITERAL' && literalKind === 'STRING' && text.length >= 2) return unescapeJs(text.slice(1, -1));
  if (kind === 'TEMPLATE' && !text.includes('${') && text.length >= 2) return unescapeJs(text.slice(1, -1));
  return null;
}
function unescapeJs(s: string): string {
  return s.includes('\\') ? s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_m, e: string) => {
    if (e[0] === 'u') return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16));
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    return ({ n: '\n', t: '\t', r: '\r' } as Record<string, string>)[e] ?? e;
  }) : s;
}

/** `$(…)`, `jQuery(…)` or a `$name` variable at the root of a receiver, through chained calls */
function isJqReceiver(recv: string): boolean {
  const r = recv.trim();
  return /^(\$|jQuery)\s*\(/.test(r) || /^\$[\w$]*(\s*[.(\[]|$)/.test(r);
}

async function* rows(file: string): AsyncGenerator<{ h: Map<string, number>; r: string[] }> {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) return;
  let h: Map<string, number> | null = null;
  const unq = (f: string) => (f.length >= 2 && f[0] === '"' && f[f.length - 1] === '"' ? f.slice(1, -1).replace(/""/g, '"') : f);
  for await (const raw of readRaw(file)) {
    const r = raw.map(unq);
    if (h === null) { h = new Map(r.map((n, i) => [n, i])); continue; }
    yield { h, r };
  }
}

export interface DomTouch {
  site: string; method: string; module: string; file: string; line: number; column: number;
  api: string; argIndex: number; literal: string | null; kind: string;
}

/** Every DOM touch in a JavaScript IR directory. */
export async function domTouches(irDir: string): Promise<DomTouch[]> {
  const f = (n: string) => path.join(irDir, `all-javascript-${n}.csv`);
  // modules: their file
  const fileOf = new Map<string, string>();
  // a bundled or minified file is a build's output, not text a person wrote: its touches are not listed (SPEC §4.2)
  for await (const { h, r } of rows(f('modules'))) {
    if (h.has('sourceProvenance') && r[h.get('sourceProvenance')!] !== 'PROJECT') continue;
    fileOf.set(r[h.get('jsModuleUniqueHash')!]!, r[h.get('filePath')!]!);
  }
  // call sites whose callee name can be a DOM API
  interface Call { site: string; name: string; recv: string; expr: string; method: string; module: string; line: number; col: number }
  const calls: Call[] = []; const callByExpr = new Map<string, Call>();
  const wanted = new Set([...Object.keys(DOM_CALLS), ...Object.keys(CLASSLIST), ...Object.keys(JQ_ANY), ...Object.keys(JQ_RECV), '$', 'jQuery', 'setProperty']);
  for await (const { h, r } of rows(f('call-sites'))) {
    const name = r[h.get('calleeName')!]!;
    if (!wanted.has(name)) continue;
    const c: Call = { site: r[h.get('jsCallSiteUniqueHash')!]!, name, recv: r[h.get('receiverText')!] ?? '', expr: r[h.get('expressionLinkHash')!]!,
      method: r[h.get('enclosingMethodLinkHash')!] ?? '', module: r[h.get('ownerModuleLinkHash')!]!, line: Number(r[h.get('startLine')!]), col: Number(r[h.get('startColumn')!]) };
    calls.push(c); callByExpr.set(c.expr, c);
  }
  // expressions: arguments of those calls; assignments to a property; `x.dataset.k`
  interface Arg { kind: string; text: string; lit: string }
  const args = new Map<string, Map<number, Arg>>();
  interface Assign { id: string; method: string; module: string; line: number; col: number }
  const assigns = new Map<string, Assign>();
  const targets = new Map<string, { prop: string; id: string }>(); // assignment -> its PROPERTY_ACCESS target
  const values = new Map<string, Arg>(); // assignment -> value
  const accessName = new Map<string, string>(); // a PROPERTY_ACCESS that is an assignment target's or a member's object: its own name, by its parent
  const datasetParents = new Set<string>();
  const propAccess = new Map<string, { name: string; method: string; module: string; line: number; col: number }>();
  const C = (h: Map<string, number>, r: string[], n: string) => r[h.get(n)!] ?? '';
  for await (const { h, r } of rows(f('expressions'))) {
    const kind = C(h, r, 'expressionKind'), role = C(h, r, 'edgeRole'), parent = C(h, r, 'parentExpressionLinkHash'), id = C(h, r, 'jsExpressionUniqueHash');
    if (role === 'ARGUMENT' && callByExpr.has(parent)) {
      let m = args.get(parent); if (!m) { m = new Map(); args.set(parent, m); }
      m.set(Number(C(h, r, 'childIndex')) - 1, { kind, text: C(h, r, 'text'), lit: C(h, r, 'literalKind') });
    }
    if (kind === 'ASSIGNMENT') assigns.set(id, { id, method: C(h, r, 'ownerMethodLinkHash'), module: C(h, r, 'ownerModuleLinkHash'), line: Number(C(h, r, 'startLine')), col: Number(C(h, r, 'startColumn')) });
    if (role === 'ASSIGNMENT_TARGET' && kind === 'PROPERTY_ACCESS') targets.set(parent, { prop: C(h, r, 'name'), id });
    if (role === 'ASSIGNMENT_VALUE') values.set(parent, { kind, text: C(h, r, 'text'), lit: C(h, r, 'literalKind') });
    if (role === 'ACCESS_TARGET' && kind === 'PROPERTY_ACCESS') {
      accessName.set(parent, C(h, r, 'name'));
      if (C(h, r, 'name') === 'dataset') datasetParents.add(parent);
    }
    if (kind === 'PROPERTY_ACCESS') propAccess.set(id, { name: C(h, r, 'name'), method: C(h, r, 'ownerMethodLinkHash'), module: C(h, r, 'ownerModuleLinkHash'),
      line: Number(C(h, r, 'startLine')), col: Number(C(h, r, 'startColumn')) });
  }
  const out: DomTouch[] = [];
  const push = (site: string, method: string, module: string, line: number, column: number, api: string, argIndex: number, literal: string | null, kind: string) =>
    fileOf.has(module) && out.push({ site, method, module, file: fileOf.get(module) ?? '', line, column, api, argIndex, literal, kind });
  const arg = (c: Call, i: number): string | null => { const a = args.get(c.expr)?.get(i); return a ? literalOf(a.kind, a.text, a.lit) : null; };
  const isFn = (c: Call, i: number): boolean => { const a = args.get(c.expr)?.get(i); return !!a && /FUNCTION|ARROW/.test(a.kind); };
  for (const c of calls) {
    const P = (api: string, i: number, kind: string) => push(c.site, c.method, c.module, c.line, c.col, api, i, arg(c, i), kind);
    const recvTail = c.recv.replace(/\s+/g, '').split('.').pop() ?? '';
    if ((c.name === '$' || c.name === 'jQuery') && c.recv === '') {
      if (!args.get(c.expr)?.has(0) || isFn(c, 0)) continue;
      const s = arg(c, 0);
      P(`jquery:${c.name}()`, 0, s !== null && /^\s*</.test(s) ? 'html' : 'selector');
      continue;
    }
    if (recvTail === 'classList' && CLASSLIST[c.name]) {
      const spec = CLASSLIST[c.name]!;
      const n = args.get(c.expr)?.size ?? 0;
      const idx = spec === 'all' ? Array.from({ length: Math.max(n, 1) }, (_, i) => i) : spec;
      for (const i of idx) P(`classList.${c.name}`, i, 'class');
      continue;
    }
    if (recvTail === 'style' && c.name === 'setProperty') { P('style.setProperty', 0, 'css_property'); continue; }
    if (JQ_RECV[c.name] && isJqReceiver(c.recv)) {
      P(`jquery:${c.name}`, 0, JQ_RECV[c.name]!);
      if ((c.name === 'on' || c.name === 'off' || c.name === 'one') && arg(c, 1) !== null) P(`jquery:${c.name}`, 1, 'selector');
      continue;
    }
    if (DOM_CALLS[c.name] && c.recv !== '') { const [kind, idx] = DOM_CALLS[c.name]!; for (const i of idx) P(c.name, i, kind); continue; }
    if (JQ_ANY[c.name] && c.recv !== '') { P(`jquery:${c.name}`, 0, JQ_ANY[c.name]!); continue; }
  }
  for (const [aid, a] of assigns) {
    const t = targets.get(aid); if (!t) continue;
    const v = values.get(aid);
    const lit = v ? literalOf(v.kind, v.text, v.lit) : null;
    const P = (api: string, literal: string | null, kind: string) => push(aid, a.method, a.module, a.line, a.col, api, 0, literal, kind);
    if (t.prop === 'className') P('className=', lit, 'class');
    else if (HTML_PROPS.has(t.prop)) P(`${t.prop}=`, lit, 'html');
    else if (t.prop === 'textContent') P('textContent=', null, 'html');
    else if (/^on[a-z]+$/.test(t.prop)) P('on<event>=', t.prop.slice(2), 'event');
    else if (accessName.get(t.id) === 'style') P('style.<prop>=', t.prop, 'css_property');
  }
  for (const id of datasetParents) {
    const e = propAccess.get(id); if (!e) continue;
    push(id, e.method, e.module, e.line, e.col, 'dataset', 0, e.name, 'attribute');
  }
  return out;
}

/** The table `ext_dom_touch` in a JavaScript graph, from the IR the graph was built from. */
export async function writeDomTouch(dbPath: string, irDir: string, log: (s: string) => void): Promise<void> {
  const touches = await domTouches(irDir);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('BEGIN;');
    db.exec('DROP TABLE IF EXISTS ext_dom_touch;');
    db.exec(`CREATE TABLE ext_dom_touch (${COLUMNS.map((c) => `"${c}" ${c === 'line' || c === 'column' || c === 'arg_index' ? 'INTEGER' : 'TEXT'}`).join(', ')});`);
    const ins = db.prepare(`INSERT INTO ext_dom_touch VALUES (${COLUMNS.map(() => '?').join(', ')})`);
    for (const t of touches) {
      ins.run(t.site, t.method || null, t.module, t.file || null, t.line, t.column, t.api, t.argIndex, t.literal, t.kind, t.literal === null ? null : tokensOf(t.literal, t.kind), t.literal === null ? 'non_literal' : 'literal');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_dom_touch_file ON ext_dom_touch(file, line); CREATE INDEX IF NOT EXISTS idx_dom_touch_literal ON ext_dom_touch(literal);');
    db.prepare('INSERT INTO schema_tables VALUES (?, ?, ?, ?)').run('ext_dom_touch', 'ext', null,
      'Where script text names the page\'s markup (SPEC §4.2): the API (querySelector, getElementById, classList.add, addEventListener, style.<prop>=, innerHTML=, jquery:$() …), the 0-based argument, the literal as written, what it names (selector, id, class, tag, name, event, attribute, css_property, html) and the tokens it contains (`.a,#b,div,[data-x]`). status literal | non_literal (a variable or concatenation: listed, never guessed). A table of this language\'s graph; it points at no node of another graph.');
    db.exec('COMMIT;');
    log(`  sqlite ext_dom_touch: ${touches.length} rows`);
  } finally {
    db.close();
  }
}
