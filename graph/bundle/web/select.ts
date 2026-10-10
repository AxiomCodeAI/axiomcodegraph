/**
 * SELECTOR -> ELEMENT, decided on the parser's element tree (as written) for one page.
 *
 * Why TypeScript and not Datalog: a match needs right-to-left backtracking over ancestors and
 * siblings, An+B arithmetic, case folding by document mode, attribute operators, CSS nesting
 * (`&` is `:is(<parent selector list>)`), and relative :has() — each a recursive walk keyed on
 * the element tree of ONE page through the sheets THAT page loads. Written as rules, each step
 * is a join on (page, element) pairs whose intermediate relations are the cross product of every
 * selector with every element of every page (the shape that blew up to 82M rows before). Here
 * each selector is tried only against the candidates its rightmost compound can match (by id,
 * class token or tag), per page.
 *
 * A match has three outcomes besides "no": EXACT (decided), COND (true in some state: a dynamic
 * pseudo-class, an initial form state, an inert subtree) and UNKNOWN (cannot be decided from the
 * source: a dynamic class binding, a truncated attribute value, shadow DOM, an unparsed part).
 * An UNKNOWN never becomes a match; it is reported with its reason.
 */

export const NO = 0, UNKNOWN = 1, COND = 2, EXACT = 3;
export interface Res { s: number; r: string }
const R_NO: Res = { s: NO, r: '' };
const R_EXACT: Res = { s: EXACT, r: '' };
const cond = (r: string): Res => ({ s: COND, r });
const unknown = (r: string): Res => ({ s: UNKNOWN, r });

function joinReasons(a: string, b: string): string {
  if (!a) return b; if (!b || a === b) return a;
  const set = new Set([...a.split(','), ...b.split(',')]);
  return [...set].join(',');
}
export function and(a: Res, b: Res): Res {
  if (a.s === NO || b.s === NO) return R_NO;
  if (a.s < b.s) return a; if (b.s < a.s) return b;
  return a.s === EXACT ? R_EXACT : { s: a.s, r: joinReasons(a.r, b.r) };
}
export function or(a: Res, b: Res): Res { return b.s > a.s ? b : a; }

// ── the page model ─────────────────────────────────────────────────────────

export interface El {
  id: string;
  idx: number;
  tag: string;            // as written
  tagLower: string;
  ns: string;             // HTML, SVG, MATHML
  idAttr: string;
  classes: Set<string>;
  classesLower: Set<string>;
  attrs: Map<string, { value: string; hasValue: boolean }>;   // name lowercased for HTML elements
  text: string;
  childCount: number;
  position: number;
  parent: El | null;
  children: El[];         // element children, by position
  inert: string;          // '' or the tag (template/noscript, or iframe_text) of the inert ancestor
  dynamicClass: boolean;
  /** the class tokens a binding can add (SPEC §3.2 R2): a set, '*' for any, null for none */
  dynTokens: Set<string> | '*' | null;
  dynamicId: boolean;
  /** attributes a template binding sets at run time (`:href`, `x-bind:data-k`, `[attr.aria-x]`, a `{{ }}` in a value) */
  dynAttrs: Set<string>;
  lang: string;           // own lang attribute, '' when absent
}

export interface PageCtx {
  elements: El[];
  top: El[];
  quirks: boolean;
  docLang: string;
  hasHtmlRoot: boolean;
  byId: Map<string, El[]>;
  byClass: Map<string, El[]>;
  byTag: Map<string, El[]>;
  dynamicClassEls: El[];
  ids: Set<string>;
  classes: Set<string>;
}

export function pageCtx(elements: El[], quirks: boolean, docLang: string): PageCtx {
  const byId = new Map<string, El[]>(), byClass = new Map<string, El[]>(), byTag = new Map<string, El[]>();
  const push = (m: Map<string, El[]>, k: string, e: El) => { const a = m.get(k); if (a) a.push(e); else m.set(k, [e]); };
  const dyn: El[] = [];
  for (const e of elements) {
    if (e.idAttr) push(byId, quirks ? e.idAttr.toLowerCase() : e.idAttr, e);
    for (const c of quirks ? e.classesLower : e.classes) push(byClass, c, e);
    push(byTag, e.tagLower, e);
    if (e.dynamicClass || e.dynAttrs.size > 0) dyn.push(e);
  }
  const top = elements.filter((e) => e.parent === null);
  return {
    elements, top, quirks, docLang, hasHtmlRoot: top.some((e) => e.tagLower === 'html'),
    byId, byClass, byTag, dynamicClassEls: dyn, ids: new Set(byId.keys()), classes: new Set(byClass.keys()),
  };
}

// ── compiled selectors ─────────────────────────────────────────────────────

export interface Simple {
  kind: string;           // TYPE UNIVERSAL CLASS ID ATTRIBUTE PSEUDO_CLASS PSEUDO_ELEMENT NESTING RAW ANCHOR
  name: string;
  value: string;
  matcher: string;
  flags: string;
  args: Complex[] | null; // selector arguments (:not :is :where :has :nth-child(of S) …)
}
export interface Compound { comb: string; simples: Simple[] }
export type Complex = Compound[];

export interface PartRow {
  id: string; kind: string; name: string; value: string; matcher: string; flags: string; comb: string;
  compound: number; position: number; argIndex: number; parent: string;
}

/** Group a selector's part rows into complex selectors: the top level, and each pseudo-class's arguments. */
export function compileParts(parts: PartRow[]): Complex {
  const byParent = new Map<string, PartRow[]>();
  for (const p of parts) { const a = byParent.get(p.parent); if (a) a.push(p); else byParent.set(p.parent, [p]); }
  const list = (parent: string): Complex[] => {
    const rows = byParent.get(parent) ?? [];
    const byArg = new Map<number, PartRow[]>();
    for (const r of rows) { const a = byArg.get(r.argIndex); if (a) a.push(r); else byArg.set(r.argIndex, [r]); }
    return [...byArg.keys()].sort((x, y) => x - y).map((k) => complexOf(byArg.get(k)!));
  };
  const complexOf = (rows: PartRow[]): Complex => {
    rows.sort((a, b) => a.position - b.position);
    const byCompound = new Map<number, PartRow[]>();
    for (const r of rows) { const a = byCompound.get(r.compound); if (a) a.push(r); else byCompound.set(r.compound, [r]); }
    return [...byCompound.keys()].sort((x, y) => x - y).map((k) => {
      const rs = byCompound.get(k)!;
      return {
        comb: rs[0]!.comb || 'NONE',
        simples: rs.map((r) => ({
          kind: r.kind, name: r.name, value: r.value, matcher: r.matcher, flags: r.flags,
          args: byParent.has(r.id) ? list(r.id) : null,
        })),
      };
    });
  };
  const top = list('');
  return top[0] ?? [];
}

/** Resolve CSS nesting: `&` becomes :is(parent list); a selector with no `&` is a descendant of the parent list. */
export function resolveNesting(cx: Complex, parent: Complex[] | null): Complex {
  if (parent === null) {
    // a top-level `&` is :scope, which outside @scope is :root
    const top = (c: Complex): Complex => c.map((comp) => ({ comb: comp.comb, simples: comp.simples.map((s) => s.kind === 'NESTING'
      ? { kind: 'PSEUDO_CLASS', name: 'scope', value: '', matcher: '', flags: '', args: null } : s.args ? { ...s, args: s.args.map(top) } : s) }));
    return top(cx);
  }
  const nestingSimple = (): Simple => ({ kind: 'NESTING', name: '&', value: '', matcher: '', flags: '', args: parent });
  const replace = (c: Complex): Complex => c.map((comp) => ({
    comb: comp.comb,
    simples: comp.simples.map((s) => s.kind === 'NESTING' ? nestingSimple()
      : s.args ? { ...s, args: s.args.map(replace) } : s),
  }));
  const hasNesting = (c: Complex): boolean => c.some((comp) => comp.simples.some((s) => s.kind === 'NESTING' || (s.args?.some(hasNesting) ?? false)));
  if (hasNesting(cx)) return replace(cx);
  if (cx.length === 0) return cx;
  const first = cx[0]!;
  const comb = first.comb !== 'NONE' ? first.comb : 'DESCENDANT';
  return [{ comb: 'NONE', simples: [nestingSimple()] }, { comb, simples: first.simples }, ...cx.slice(1)];
}

/** Specificity of a compiled (nesting-resolved) selector, per Selectors 4. */
export function specificity(cx: Complex): [number, number, number] {
  let a = 0, b = 0, c = 0;
  const maxOf = (list: Complex[] | null): [number, number, number] => {
    let best: [number, number, number] = [0, 0, 0];
    for (const x of list ?? []) {
      const s = specificity(x);
      if (s[0] > best[0] || (s[0] === best[0] && (s[1] > best[1] || (s[1] === best[1] && s[2] > best[2])))) best = s;
    }
    return best;
  };
  for (const comp of cx) for (const s of comp.simples) {
    switch (s.kind) {
      case 'ID': a++; break;
      case 'CLASS': case 'ATTRIBUTE': b++; break;
      case 'TYPE': c++; break;
      case 'PSEUDO_ELEMENT': c++; break;
      case 'NESTING': { const m = maxOf(s.args); a += m[0]; b += m[1]; c += m[2]; break; }
      case 'PSEUDO_CLASS': {
        const n = s.name.toLowerCase();
        if (n === 'where') break;
        if (n === 'is' || n === 'not' || n === 'has' || n === 'matches' || n === '-webkit-any' || n === '-moz-any') {
          const m = maxOf(s.args); a += m[0]; b += m[1]; c += m[2]; break;
        }
        b++;
        if ((n === 'nth-child' || n === 'nth-last-child') && s.args) { const m = maxOf(s.args); a += m[0]; b += m[1]; c += m[2]; }
        break;
      }
      default: break;
    }
  }
  return [a, b, c];
}

/** The class and id tokens EVERY match of the selector needs (top level only, never inside :not()). */
export function requiredTokens(cx: Complex): { classes: string[]; ids: string[] } {
  const classes: string[] = [], ids: string[] = [];
  for (const comp of cx) for (const s of comp.simples) {
    if (s.kind === 'CLASS') classes.push(s.name);
    else if (s.kind === 'ID') ids.push(s.name);
  }
  return { classes, ids };
}

export function pseudoElementOf(cx: Complex): string {
  const last = cx[cx.length - 1];
  const pe = last?.simples.find((s) => s.kind === 'PSEUDO_ELEMENT');
  return pe ? pe.name.toLowerCase() : '';
}

// ── matching ───────────────────────────────────────────────────────────────

const INITIAL = new Set(['checked', 'disabled', 'enabled', 'required', 'optional', 'read-only', 'read-write', 'placeholder-shown',
  'default', 'indeterminate', 'open', 'closed']);
const SHADOW = new Set(['host', 'host-context', 'part', 'slotted']);
const LOGICAL = new Set(['not', 'is', 'where', 'has', 'matches', '-webkit-any', '-moz-any']);
const STRUCTURAL = new Set(['first-child', 'last-child', 'only-child', 'nth-child', 'nth-last-child', 'first-of-type', 'last-of-type',
  'only-of-type', 'nth-of-type', 'nth-last-of-type']);
const DECIDED = new Set(['root', 'scope', 'link', 'any-link', 'empty', 'lang', 'defined', ...LOGICAL, ...STRUCTURAL]);
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);

/**
 * Why a selector cannot be decided on any page, or '' when it can: a shadow-DOM part, a column combinator, a
 * pseudo-element inside :not()/:is(), an unparsed part. Decided once per selector; the selector then has an
 * `unknown` row per page and no styles rows (SPEC §3.2).
 */
export function unknownOf(cx: Complex, inLogical = false): string {
  if (cx.length === 0) return 'selector_unparsed';
  for (const comp of cx) {
    if (comp.comb === 'COLUMN') return 'column_combinator';
    for (const s of comp.simples) {
      const n = s.name.toLowerCase();
      if (s.kind === 'RAW') return 'selector_unparsed';
      if ((s.kind === 'PSEUDO_ELEMENT' || s.kind === 'PSEUDO_CLASS') && SHADOW.has(n)) return 'shadow_dom';
      if (s.kind === 'PSEUDO_ELEMENT' || (s.kind === 'PSEUDO_CLASS' && LEGACY_PSEUDO_ELEMENTS.has(n))) { if (inLogical) return 'selector_unparsed'; continue; }
      // `:not(type="x")`: an argument the parser could not read as a selector list
      if (s.kind === 'PSEUDO_CLASS' && LOGICAL.has(n) && (!s.args || s.args.length === 0) && s.value.trim() !== '') return 'selector_unparsed';
      if (s.args && s.kind !== 'NESTING') {
        for (const a of s.args) { const u = unknownOf(a, inLogical || LOGICAL.has(n)); if (u) return u; }
      } else if (s.args) for (const a of s.args) { const u = unknownOf(a, inLogical); if (u) return u; }
    }
  }
  return '';
}

/** The run-time conditions a selector names, wherever they sit (`state:hover`, `state:initial-checked`), sorted. */
export function staticReasons(cx: Complex): string[] {
  const out = new Set<string>();
  const walk = (c: Complex) => {
    for (const comp of c) for (const s of comp.simples) {
      if (s.kind === 'PSEUDO_CLASS') {
        const n = s.name.toLowerCase();
        if (INITIAL.has(n)) out.add(`state:initial-${n}`);
        else if (!DECIDED.has(n) && !LEGACY_PSEUDO_ELEMENTS.has(n) && !SHADOW.has(n)) out.add(`state:${n}`);
      }
      if (s.args) s.args.forEach(walk);
    }
  };
  walk(cx);
  return [...out].sort();
}

/** True when the selector needs the document's root element (:root, :scope, a top-level `&`), anywhere. */
export function usesRoot(cx: Complex): boolean {
  return cx.some((comp) => comp.simples.some((s) => (s.kind === 'PSEUDO_CLASS' && /^(root|scope)$/i.test(s.name)) || (s.kind !== 'NESTING' && (s.args?.some(usesRoot) ?? false))));
}



const CI_ATTRIBUTES = new Set(['accept', 'accept-charset', 'align', 'alink', 'axis', 'bgcolor', 'charset', 'checked', 'clear', 'codetype', 'color',
  'compact', 'declare', 'defer', 'dir', 'direction', 'disabled', 'enctype', 'face', 'frame', 'hreflang', 'http-equiv', 'lang', 'language', 'link',
  'media', 'method', 'multiple', 'nohref', 'noresize', 'noshade', 'nowrap', 'readonly', 'rel', 'rev', 'rules', 'scope', 'scrolling', 'selected',
  'shape', 'target', 'text', 'type', 'valign', 'valuetype', 'vlink']);
const FORM_ELEMENTS = new Set(['button', 'input', 'select', 'textarea', 'optgroup', 'option', 'fieldset']);

/** An+B, with `odd`/`even`; null when it does not parse. */
export function parseAnB(text: string): { a: number; b: number } | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  if (t === 'odd') return { a: 2, b: 1 };
  if (t === 'even') return { a: 2, b: 0 };
  let m = /^([+-]?\d*)n([+-]\d+)?$/.exec(t);
  if (m) {
    const as = m[1]!;
    const a = as === '' || as === '+' ? 1 : as === '-' ? -1 : parseInt(as, 10);
    return { a, b: m[2] ? parseInt(m[2], 10) : 0 };
  }
  m = /^([+-]?\d+)$/.exec(t);
  return m ? { a: 0, b: parseInt(m[1]!, 10) } : null;
}
function anbMatches(ab: { a: number; b: number }, index1: number): boolean {
  if (ab.a === 0) return index1 === ab.b;
  const n = (index1 - ab.b) / ab.a;
  return Number.isInteger(n) && n >= 0;
}

export class Matcher {
  /** set for the duration of one :has() evaluation */
  private anchor: El | null = null;
  private memo = new Map<Complex, Map<number, Res>[]>();
  /** :has() arguments as anchored complexes, built once per argument */
  private relative = new Map<Complex, Complex>();

  /** `dynamic`: an element's class binding counts as carrying the tokens it can add (the dynamic_class pass) */
  /** inside @scope: the scope root `:scope` (and a nested `&`) stands for */
  scopeRoot: El | null = null;

  constructor(readonly page: PageCtx, readonly dynamic = false) {}

  /** Match one complex selector against one element. */
  match(cx: Complex, e: El): Res {
    if (cx.length === 0) return unknown('selector_unparsed');
    return this.at(cx, cx.length - 1, e);
  }

  private at(cx: Complex, k: number, e: El): Res {
    let perK = this.memo.get(cx);
    if (perK === undefined) { perK = []; this.memo.set(cx, perK); }
    let m = perK[k];
    if (m === undefined) { m = new Map(); perK[k] = m; }
    const key = this.anchor === null ? e.idx : e.idx * 1_000_003 + this.anchor.idx + 1;
    const hit = m.get(key);
    if (hit !== undefined) return hit;
    const r = this.atUncached(cx, k, e);
    m.set(key, r);
    return r;
  }

  private atUncached(cx: Complex, k: number, e: El): Res {
    const comp = cx[k]!;
    const r = this.compound(comp, e);
    if (r.s === NO || k === 0) return r;
    let best = R_NO;
    switch (comp.comb) {
      case 'DESCENDANT': case 'NONE':
        for (let a = e.parent; a !== null; a = a.parent) { best = or(best, this.at(cx, k - 1, a)); if (best.s === EXACT) break; }
        break;
      case 'CHILD':
        if (e.parent !== null) best = this.at(cx, k - 1, e.parent);
        break;
      case 'NEXT_SIBLING': {
        const sib = this.siblings(e); const i = sib.indexOf(e);
        if (i > 0) best = this.at(cx, k - 1, sib[i - 1]!);
        break;
      }
      case 'SUBSEQUENT_SIBLING': {
        const sib = this.siblings(e); const i = sib.indexOf(e);
        for (let j = i - 1; j >= 0; j--) { best = or(best, this.at(cx, k - 1, sib[j]!)); if (best.s === EXACT) break; }
        break;
      }
      case 'COLUMN': return and(r, unknown('column_combinator'));
      default: return and(r, unknown(`combinator:${comp.comb}`));
    }
    return and(r, best);
  }

  private siblings(e: El): El[] { return e.parent === null ? this.page.top : e.parent.children; }

  private compound(comp: Compound, e: El): Res {
    let r = R_EXACT;
    for (const s of comp.simples) {
      r = and(r, this.simple(s, e));
      if (r.s === NO) return R_NO;
    }
    return r;
  }

  private list(args: Complex[] | null, e: El): Res {
    let best = R_NO;
    for (const a of args ?? []) { best = or(best, this.match(a, e)); if (best.s === EXACT) break; }
    return best;
  }

  private simple(s: Simple, e: El): Res {
    const q = this.page.quirks;
    switch (s.kind) {
      case 'UNIVERSAL': return R_EXACT;
      case 'TYPE': {
        let name = s.name; const bar = name.indexOf('|'); if (bar >= 0) name = name.slice(bar + 1);
        if (name === '*') return R_EXACT;
        return (e.ns === 'HTML' || e.ns === '' ? e.tagLower === name.toLowerCase() : e.tag === name) ? R_EXACT : R_NO;
      }
      case 'CLASS': {
        const has = q ? e.classesLower.has(s.name.toLowerCase()) : e.classes.has(s.name);
        if (has) return R_EXACT;
        if (this.dynamic && e.dynTokens !== null && (e.dynTokens === '*' || e.dynTokens.has(s.name))) return cond('dynamic_class');
        return R_NO;
      }
      case 'ID':
        if (q ? e.idAttr.toLowerCase() === s.name.toLowerCase() : e.idAttr === s.name) return R_EXACT;
        return this.dynamic && e.dynAttrs.has('id') ? cond('dynamic_attribute') : R_NO;
      case 'ATTRIBUTE': return this.attribute(s, e);
      case 'PSEUDO_ELEMENT': {
        const n = s.name.toLowerCase();
        if (n === 'part' || n === 'slotted') return unknown('shadow_dom');
        return R_EXACT;
      }
      case 'NESTING': return this.list(s.args, e);
      case 'ANCHOR': return this.anchor === e ? R_EXACT : R_NO;
      case 'PSEUDO_CLASS': return this.pseudo(s, e);
      case 'RAW': return unknown('selector_unparsed');
      default: return unknown(`part:${s.kind}`);
    }
  }

  private attribute(s: Simple, e: El): Res {
    const html = e.ns === 'HTML' || e.ns === '';
    let name = s.name; const bar = name.indexOf('|'); if (bar >= 0) name = name.slice(bar + 1);
    const a = e.attrs.get(html ? name.toLowerCase() : name) ?? (html ? undefined : e.attrs.get(name.toLowerCase()));
    if (this.dynamic && e.dynAttrs.has(name.toLowerCase())) return cond('dynamic_attribute');
    if (a === undefined) {
      return R_NO;
    }
    const m = s.matcher;
    if (m === '' ) return R_EXACT;
    if (a.value.length >= 4096) return unknown('value_truncated');
    // HTML says the values of these attributes compare ASCII case-insensitively unless the selector says `s`
    const ci = s.flags.toLowerCase() === 'i' || (s.flags.toLowerCase() !== 's' && html && CI_ATTRIBUTES.has(name.toLowerCase()));
    const v = ci ? a.value.toLowerCase() : a.value;
    const want = ci ? s.value.toLowerCase() : s.value;
    let ok: boolean;
    switch (m) {
      case '=': ok = v === want; break;
      case '~=': ok = want !== '' && !/\s/.test(want) && v.split(/[ \t\n\f\r]+/).includes(want); break;
      case '|=': ok = v === want || v.startsWith(want + '-'); break;
      case '^=': ok = want !== '' && v.startsWith(want); break;
      case '$=': ok = want !== '' && v.endsWith(want); break;
      case '*=': ok = want !== '' && v.includes(want); break;
      default: return unknown(`attribute_matcher:${m}`);
    }
    return ok ? R_EXACT : R_NO;
  }

  private nth(s: Simple, e: El, fromEnd: boolean, ofType: boolean): Res {
    let text = s.value; let filter: Complex[] | null = null;
    const of = / of /i.exec(text);
    if (of) { text = text.slice(0, of.index); filter = s.args; }
    const ab = parseAnB(text);
    if (ab === null) return unknown(`nth_unparsed:${s.value}`);
    let sib = this.siblings(e);
    let status = R_EXACT;
    if (ofType) sib = sib.filter((x) => x.tagLower === e.tagLower && x.ns === e.ns);
    if (filter) {
      const self = this.list(filter, e);
      if (self.s === NO) return R_NO;
      status = and(status, self);
      const kept: El[] = [];
      for (const x of sib) {
        if (x === e) { kept.push(x); continue; }
        const rx = this.list(filter, x);
        if (rx.s === EXACT) kept.push(x);
        else if (rx.s !== NO) return unknown('nth_of_undecided');
      }
      sib = kept;
    }
    const i = sib.indexOf(e);
    const index1 = fromEnd ? sib.length - i : i + 1;
    return anbMatches(ab, index1) ? status : R_NO;
  }

  private pseudo(s: Simple, e: El): Res {
    const n = s.name.toLowerCase();
    const attr = (k: string) => e.attrs.has(k);
    switch (n) {
      case 'not': {
        const r = this.list(s.args, e);
        return r.s === EXACT ? R_NO : r.s === NO ? R_EXACT : r;
      }
      case 'is': case 'where': case 'matches': case '-webkit-any': case '-moz-any':
        return this.list(s.args, e);
      case 'has': return this.has(s, e);
      case 'scope': case 'root':
        if (n === 'scope' && this.scopeRoot !== null) return this.scopeRoot === e ? R_EXACT : R_NO;
        if (e.parent !== null) return R_NO;
        if (e.tagLower === 'html') return R_EXACT;
        return this.page.hasHtmlRoot ? R_NO : unknown('implied_element');
      case 'first-child': return this.siblings(e)[0] === e ? R_EXACT : R_NO;
      case 'last-child': { const sib = this.siblings(e); return sib[sib.length - 1] === e ? R_EXACT : R_NO; }
      case 'only-child': return this.siblings(e).length === 1 ? R_EXACT : R_NO;
      case 'first-of-type': return this.siblings(e).find((x) => x.tagLower === e.tagLower) === e ? R_EXACT : R_NO;
      case 'last-of-type': { const t = this.siblings(e).filter((x) => x.tagLower === e.tagLower); return t[t.length - 1] === e ? R_EXACT : R_NO; }
      case 'only-of-type': return this.siblings(e).filter((x) => x.tagLower === e.tagLower).length === 1 ? R_EXACT : R_NO;
      case 'nth-child': return this.nth(s, e, false, false);
      case 'nth-last-child': return this.nth(s, e, true, false);
      case 'nth-of-type': return this.nth(s, e, false, true);
      case 'nth-last-of-type': return this.nth(s, e, true, true);
      case 'empty':
        if (e.childCount > 0 || e.text.trim() !== '') return R_NO;
        return e.text.length >= 1024 ? unknown('text_unknown') : R_EXACT;
      case 'link': case 'any-link': case 'visited': case 'local-link':
        return (e.tagLower === 'a' || e.tagLower === 'area') && attr('href') ? R_EXACT : R_NO;
      case 'lang': {
        const want = s.value.split(',')[0]!.trim().replace(/^["']|["']$/g, '').toLowerCase();
        let lang: string | null = null;
        for (let a: El | null = e; a !== null; a = a.parent) if (a.attrs.has('lang') || a.attrs.has('xml:lang')) { lang = a.lang; break; }
        if (lang === null) lang = this.page.docLang;
        if (lang === '') return unknown('lang_unknown');
        const l = lang.toLowerCase();
        return want === '*' || l === want || l.startsWith(want + '-') ? R_EXACT : R_NO;
      }
      case 'defined': return R_EXACT;
      // INITIAL STATE: true when the attributes say so now; the status is conditional (staticReasons)
      case 'checked': {
        const type = e.attrs.get('type')?.value.toLowerCase() ?? '';
        return (e.tagLower === 'input' && (type === 'checkbox' || type === 'radio') && attr('checked')) || (e.tagLower === 'option' && attr('selected')) ? R_EXACT : R_NO;
      }
      case 'default': {
        const type = e.attrs.get('type')?.value.toLowerCase() ?? '';
        return (e.tagLower === 'option' && attr('selected')) || (e.tagLower === 'input' && (type === 'checkbox' || type === 'radio') && attr('checked')) ? R_EXACT : R_NO;
      }
      case 'disabled': return FORM_ELEMENTS.has(e.tagLower) && attr('disabled') ? R_EXACT : R_NO;
      case 'enabled': return FORM_ELEMENTS.has(e.tagLower) && !attr('disabled') ? R_EXACT : R_NO;
      case 'required': return ['input', 'select', 'textarea'].includes(e.tagLower) && attr('required') ? R_EXACT : R_NO;
      case 'optional': return ['input', 'select', 'textarea'].includes(e.tagLower) && !attr('required') ? R_EXACT : R_NO;
      case 'read-write': case 'read-only': {
        const ce = e.attrs.get('contenteditable');
        const rw = ((e.tagLower === 'input' || e.tagLower === 'textarea') && !attr('readonly') && !attr('disabled')) || (ce !== undefined && ce.value !== 'false');
        return (n === 'read-write') === rw ? R_EXACT : R_NO;
      }
      case 'placeholder-shown':
        return (e.tagLower === 'input' || e.tagLower === 'textarea') && attr('placeholder') && !(e.attrs.get('value')?.value ?? '') ? R_EXACT : R_NO;
      case 'indeterminate': return e.tagLower === 'progress' && !attr('value') ? R_EXACT : R_NO;
      case 'open': return (e.tagLower === 'details' || e.tagLower === 'dialog') && attr('open') ? R_EXACT : R_NO;
      case 'closed': return (e.tagLower === 'details' || e.tagLower === 'dialog') && !attr('open') ? R_EXACT : R_NO;
      case 'host': case 'host-context': return unknown('shadow_dom');
      case 'before': case 'after': case 'first-line': case 'first-letter':
        return R_EXACT; // legacy single-colon pseudo-elements: the originating element
      default:
        // run-time state, vendor and unknown pseudo-classes: true in some state (staticReasons names it)
        return cond(`state:${n}`);
    }
  }

  /** :has(<relative selector list>): some element reached from `e` by the argument's leading combinator. */
  private has(s: Simple, e: El): Res {
    let best = R_NO;
    const saved = this.anchor;
    this.anchor = e;
    try {
      const texts = splitTopLevel(s.value);
      for (const [ai, arg] of (s.args ?? []).entries()) {
        if (arg.length === 0) continue;
        // the parser records no combinator on a relative selector's FIRST compound (`:has(> img)` gives `img` with
        // NONE), so the leading combinator is read from the argument's text
        const t = (texts[ai] ?? '').trim();
        const written = t.startsWith('>') ? 'CHILD' : t.startsWith('+') ? 'NEXT_SIBLING' : t.startsWith('~') ? 'SUBSEQUENT_SIBLING' : 'DESCENDANT';
        const lead = arg[0]!.comb === 'NONE' ? written : arg[0]!.comb;
        let rel = this.relative.get(arg);
        if (rel !== undefined && rel[1]!.comb !== lead) rel = undefined;
        if (rel === undefined) {
          rel = [{ comb: 'NONE', simples: [{ kind: 'ANCHOR', name: '', value: '', matcher: '', flags: '', args: null }] },
            { comb: lead, simples: arg[0]!.simples }, ...arg.slice(1)];
          this.relative.set(arg, rel);
        }
        const scope: El[] = [];
        const addSubtree = (x: El) => { scope.push(x); for (const c of x.children) addSubtree(c); };
        if (lead === 'DESCENDANT' || lead === 'CHILD') for (const c of e.children) addSubtree(c);
        else { const sib = this.siblings(e); for (let j = sib.indexOf(e) + 1; j < sib.length; j++) addSubtree(sib[j]!); }
        for (const x of scope) { best = or(best, this.at(rel, rel.length - 1, x)); if (best.s === EXACT) return best; }
      }
    } finally {
      this.anchor = saved;
    }
    return best;
  }

  /** The elements a selector could match, by its rightmost compound: by id, class or tag, else all. */
  candidates(cx: Complex): El[] {
    const last = cx[cx.length - 1];
    if (!last) return [];
    const p = this.page;
    const fold = (x: string) => (p.quirks ? x.toLowerCase() : x);
    const idS = last.simples.find((s) => s.kind === 'ID');
    const withDynamic = (stat: El[]): El[] => {
      if (!this.dynamic || p.dynamicClassEls.length === 0) return stat;
      const set = new Set(stat); for (const d of p.dynamicClassEls) set.add(d);
      return [...set];
    };
    if (idS) return withDynamic(p.byId.get(fold(idS.name)) ?? []);
    const clsS = last.simples.find((s) => s.kind === 'CLASS');
    if (clsS) return withDynamic(p.byClass.get(fold(clsS.name)) ?? []);
    const typeS = last.simples.find((s) => s.kind === 'TYPE');
    if (typeS) {
      let name = typeS.name; const bar = name.indexOf('|'); if (bar >= 0) name = name.slice(bar + 1);
      if (name !== '*') return p.byTag.get(name.toLowerCase()) ?? [];
    }
    return p.elements;
  }
}

/** A selector list split at its top-level commas (not inside parentheses, brackets or quotes). */
export function splitTopLevel(text: string): string[] {
  const out: string[] = []; let depth = 0; let cur = ''; let q = '';
  for (const ch of text) {
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// ── a selector list from text (for an @scope prelude, which has no part rows) ──────────────────

/** Parse a selector list as written into complex selectors; null when it does not read. Enough for @scope preludes. */
export function parseSelectorList(text: string): Complex[] | null {
  const out: Complex[] = [];
  for (const one of splitTopLevel(text)) {
    const cx = parseComplex(one.trim());
    if (cx === null) return null;
    out.push(cx);
  }
  return out.length ? out : null;
}

function parseComplex(t: string): Complex | null {
  if (!t) return null;
  const cx: Complex = []; let i = 0; let comb = 'NONE';
  const simple = (kind: string, name: string, extra: Partial<Simple> = {}): Simple => ({ kind, name, value: '', matcher: '', flags: '', args: null, ...extra });
  while (i < t.length) {
    let ws = false;
    while (i < t.length && /\s/.test(t[i]!)) { i++; ws = true; }
    if (i >= t.length) break;
    const c = t[i]!;
    if (c === '>' || c === '+' || c === '~') { comb = c === '>' ? 'CHILD' : c === '+' ? 'NEXT_SIBLING' : 'SUBSEQUENT_SIBLING'; i++; continue; }
    if (ws && cx.length > 0 && comb === 'NONE') comb = 'DESCENDANT';
    const simples: Simple[] = [];
    while (i < t.length && !/[\s>+~]/.test(t[i]!)) {
      const rest = t.slice(i);
      let m: RegExpExecArray | null;
      if ((m = /^\*/.exec(rest))) simples.push(simple('UNIVERSAL', '*'));
      else if ((m = /^&/.exec(rest))) simples.push(simple('NESTING', '&'));
      else if ((m = /^[a-zA-Z][\w-]*(\|[a-zA-Z*][\w-]*)?/.exec(rest))) simples.push(simple('TYPE', m[0]));
      else if ((m = /^\.(-?[_a-zA-Z -￿][\w\- -￿]*)/.exec(rest))) simples.push(simple('CLASS', m[1]!));
      else if ((m = /^#([\w\- -￿]+)/.exec(rest))) simples.push(simple('ID', m[1]!));
      else if ((m = /^\[\s*([\w:-]+)\s*(?:([~|^$*]?=)\s*("[^"]*"|'[^']*'|[^\s\]]+)\s*([is])?)?\s*\]/i.exec(rest))) {
        simples.push(simple('ATTRIBUTE', m[1]!, { matcher: m[2] ?? '', value: (m[3] ?? '').replace(/^["']|["']$/g, ''), flags: m[4] ?? '' }));
      } else if ((m = /^::?([\w-]+)(?:\(((?:[^()]|\([^()]*\))*)\))?/.exec(rest))) {
        const name = m[1]!; const arg = m[2];
        let args: Complex[] | null = null;
        if (arg !== undefined && /^(not|is|where|has|matches|-webkit-any|-moz-any)$/i.test(name)) { args = parseSelectorList(arg); if (args === null) return null; }
        simples.push(simple(m[0].startsWith('::') ? 'PSEUDO_ELEMENT' : 'PSEUDO_CLASS', name, { value: arg ?? '', args }));
      } else return null;
      i += m[0].length;
    }
    if (simples.length === 0) return null;
    cx.push({ comb: cx.length === 0 ? 'NONE' : comb, simples });
    comb = 'NONE';
  }
  return cx.length ? cx : null;
}
