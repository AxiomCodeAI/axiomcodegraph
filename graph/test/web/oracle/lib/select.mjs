// Selector -> element matching for the oracle (SPEC 3.2), with css-select doing the tree walk.
//
// A selector is first REWRITTEN (postcss-selector-parser) into something css-select decides
// exactly, recording what was taken out:
//   pseudo-elements      removed; the match is on the originating element (pseudo column)
//   run-time state       :hover, :focus, vendor and unknown pseudo-classes -> removed, `conditional state:<name>`
//   initial state        :checked :disabled ... -> evaluated from attributes, `conditional state:initial-<name>`
//   shadow DOM, ||        the whole selector is `unknown`
//   type selectors       -> :-ax-tag(T): HTML elements case-insensitive, SVG/MathML case-sensitive
// css-select then runs on the WRITTEN tree (implied elements spliced out, SPEC D5).
import selectorParser from 'postcss-selector-parser';
import { compile } from 'css-select';

const STATE = new Set(['hover', 'focus', 'focus-visible', 'focus-within', 'active', 'target', 'target-within', 'valid', 'invalid',
  'user-valid', 'user-invalid', 'in-range', 'out-of-range', 'popover-open', 'fullscreen', 'modal', 'playing', 'paused',
  'autofill', 'current', 'past', 'future', 'visited', 'local-link', 'picture-in-picture', 'buffering', 'muted', 'seeking',
  'stalled', 'volume-locked', 'blank', 'dir', 'focus-ring', 'drop', 'user-error', 'state', 'has-slotted', 'xr-overlay']);
const INITIAL = new Set(['checked', 'disabled', 'enabled', 'required', 'optional', 'read-only', 'read-write', 'placeholder-shown',
  'default', 'indeterminate', 'open', 'closed']);
const PSEUDO_EL_LEGACY = new Set(['before', 'after', 'first-line', 'first-letter']);
const SHADOW = new Set(['host', 'host-context', 'part', 'slotted']);
const STRUCTURAL = new Set(['first-child', 'last-child', 'only-child', 'nth-child', 'nth-last-child', 'first-of-type', 'last-of-type',
  'only-of-type', 'nth-of-type', 'nth-last-of-type']);
const LOGICAL = new Set(['not', 'is', 'where', 'has', 'matches', '-webkit-any', '-moz-any']);

const FORM = new Set(['button', 'input', 'select', 'textarea', 'optgroup', 'option', 'fieldset']);
const attr = (e, n) => (e.attribs && Object.prototype.hasOwnProperty.call(e.attribs, n) ? e.attribs[n] : undefined);
const has = (e, n) => attr(e, n) !== undefined;
const isHtml = (e) => !e.namespace || e.namespace === 'http://www.w3.org/1999/xhtml';
const typeOf = (e) => (attr(e, 'type') ?? '').toLowerCase();

function langOf(e) {
  for (let n = e; n && n.type !== 'root'; n = n.parent) {
    const l = attr(n, 'lang') ?? attr(n, 'xml:lang');
    if (l !== undefined) return l;
  }
  return undefined;
}

export function makePseudos(page, side) {
  return {
    '-ax-tag': (e, v) => (isHtml(e) ? e.name.toLowerCase() === v.toLowerCase() : e.name === v),
    '-ax-scope': (e) => e === side.scopeRoot,
    // an attribute/id test that a run-time binding may satisfy (dynamic_attribute pass only)
    '-ax-dyn': (e, v) => side.dynTable[Number(v)](e),
    '-ax-root': (e) => e.name === 'html' && e.parent && e.parent.type === 'root',
    '-ax-link': (e) => (e.name === 'a' || e.name === 'area') && has(e, 'href'),
    '-ax-empty': (e) => (e.children ?? []).every((c) => c.type === 'comment'),
    '-ax-lang': (e, v) => {
      const l = langOf(e) ?? page.docLang;
      if (l === undefined || l === '') { side.langUnknown.add(e); return true; }
      const want = v.replace(/^["']|["']$/g, '').toLowerCase();
      const got = l.toLowerCase();
      return want === '*' || got === want || got.startsWith(`${want}-`);
    },
    '-ax-checked': (e) => (e.name === 'input' && ['checkbox', 'radio'].includes(typeOf(e)) && has(e, 'checked')) || (e.name === 'option' && has(e, 'selected')),
    '-ax-disabled': (e) => FORM.has(e.name) && has(e, 'disabled'),
    '-ax-enabled': (e) => FORM.has(e.name) && !has(e, 'disabled'),
    '-ax-required': (e) => ['input', 'select', 'textarea'].includes(e.name) && has(e, 'required'),
    '-ax-optional': (e) => ['input', 'select', 'textarea'].includes(e.name) && !has(e, 'required'),
    '-ax-read-write': (e) => ((e.name === 'input' || e.name === 'textarea') && !has(e, 'readonly') && !has(e, 'disabled')) || (has(e, 'contenteditable') && attr(e, 'contenteditable') !== 'false'),
    '-ax-read-only': (e) => !(((e.name === 'input' || e.name === 'textarea') && !has(e, 'readonly') && !has(e, 'disabled')) || (has(e, 'contenteditable') && attr(e, 'contenteditable') !== 'false')),
    '-ax-placeholder-shown': (e) => (e.name === 'input' || e.name === 'textarea') && has(e, 'placeholder') && !(attr(e, 'value') ?? ''),
    '-ax-default': (e) => (e.name === 'option' && has(e, 'selected')) || (e.name === 'input' && ['checkbox', 'radio'].includes(typeOf(e)) && has(e, 'checked')),
    '-ax-indeterminate': (e) => e.name === 'progress' && !has(e, 'value'),
    '-ax-open': (e) => (e.name === 'details' || e.name === 'dialog') && has(e, 'open'),
    '-ax-closed': (e) => (e.name === 'details' || e.name === 'dialog') && !has(e, 'open'),
  };
}

/**
 * Rewrite one (nesting-expanded) selector. Returns
 *   { query, reasons:Set, conditional:boolean, pseudoElement, unknown: reason|null, usesRoot, usesLang, requiredTokens }
 */
export function rewriteSelector(text, scoped = false) {
  const res = { query: null, reasons: new Set(), conditional: false, pseudoElement: '', unknown: null, usesRoot: false, usesScope: false, usesLang: false, required: [] };
  const fail = (r) => { if (!res.unknown) res.unknown = r; };
  let out;
  try {
    out = selectorParser((root) => {
      const visit = (container, inNot, inLogical) => {
        container.each((sel) => {
          // sel is a Selector node
          const nodes = [];
          sel.walk((n) => { nodes.push(n); });
          for (const n of [...sel.nodes]) handle(n, sel, inNot, inLogical);
        });
      };
      const handle = (n, sel, inNot, inLogical) => {
        if (n.type === 'combinator' && n.value.trim() === '||') { fail('column_combinator'); return; }
        if (n.type === 'nesting') {
          if (scoped) { n.replaceWith(selectorParser.pseudo({ value: ':-ax-scope' })); res.usesScope = true; return; }
          n.replaceWith(selectorParser.pseudo({ value: ':-ax-root' })); res.usesRoot = true; return;
        }
        if (n.type === 'tag') {
          const name = n.value;
          if (/^\d|^of$/i.test(name)) return; // An+B "of" inside nth-*: not a tag
          n.replaceWith(selectorParser.pseudo({ value: `:-ax-tag(${name})` }));
          return;
        }
        if (n.type === 'universal') { if (n.namespace) n.replaceWith(selectorParser.universal({ value: '*' })); return; }
        if ((n.type === 'class' || n.type === 'id') && !inNot && !inLogical) res.required.push(`${n.type === 'class' ? '.' : '#'}${n.value}`);
        if (n.type !== 'pseudo') return;
        const raw = n.value; const isEl = raw.startsWith('::');
        const name = raw.replace(/^::?/, '').toLowerCase();
        if (SHADOW.has(name)) { fail('shadow_dom'); return; }
        if (isEl || PSEUDO_EL_LEGACY.has(name)) {
          if (!inNot && !inLogical) res.pseudoElement = res.pseudoElement || name;
          else fail('selector_unparsed');
          removeFromCompound(n); return;
        }
        if (LOGICAL.has(name)) {
          if (name === 'matches' || name === '-webkit-any' || name === '-moz-any') n.value = ':is';
          visit(n, inNot || name === 'not', true);
          if (n.nodes.length === 0 || n.nodes.every((s) => s.nodes.length === 0)) removeFromCompound(n);
          return;
        }
        if (STRUCTURAL.has(name)) {
          // An+B stays verbatim (`even`, `-n+2` are not tags); an `of S` list is rewritten on its own
          const arg = n.nodes.map((x) => x.toString()).join(',').trim();
          if (!arg) return;
          const m = /^(.*?)\s+of\s+(.*)$/is.exec(arg);
          if (!m) { n.replaceWith(selectorParser.pseudo({ value: `${raw}(${arg})` })); return; }
          const inner = rewriteSelector(m[2]);
          if (inner.unknown) { fail(inner.unknown); return; }
          for (const r of inner.reasons) res.reasons.add(r);
          if (inner.conditional) res.conditional = true;
          n.replaceWith(selectorParser.pseudo({ value: `${raw}(${m[1].trim()} of ${inner.query})` }));
          return;
        }
        if (name === 'scope' && scoped) { n.replaceWith(selectorParser.pseudo({ value: ':-ax-scope' })); res.usesScope = true; return; }
        if (name === 'root' || name === 'scope') { n.replaceWith(selectorParser.pseudo({ value: ':-ax-root' })); res.usesRoot = true; return; }
        if (name === 'link' || name === 'any-link') { n.replaceWith(selectorParser.pseudo({ value: ':-ax-link' })); return; }
        if (name === 'empty') { n.replaceWith(selectorParser.pseudo({ value: ':-ax-empty' })); return; }
        if (name === 'lang') {
          res.usesLang = true;
          const arg = n.nodes.map((s) => s.toString().trim()).join(',');
          n.replaceWith(selectorParser.pseudo({ value: `:-ax-lang(${arg.split(',')[0]})` })); return;
        }
        if (name === 'defined') { removeFromCompound(n); return; } // every element in a static page is defined
        if (INITIAL.has(name)) {
          res.conditional = true; res.reasons.add(`state:initial-${name}`);
          n.replaceWith(selectorParser.pseudo({ value: `:-ax-${name}` })); return;
        }
        if (name === 'visited' || name === 'local-link') {
          // only a link can be visited: keep the link test, the visited part is run-time state
          res.conditional = true; res.reasons.add(`state:${name}`);
          n.replaceWith(selectorParser.pseudo({ value: ':-ax-link' })); return;
        }
        // run-time state, vendor and unknown pseudo-classes
        res.conditional = true; res.reasons.add(`state:${name}`);
        if (inNot) { dropEnclosingSelector(n); return; }
        removeFromCompound(n);
      };
      const removeFromCompound = (n) => {
        const parent = n.parent; const idx = parent.index(n);
        const prev = parent.at(idx - 1); const next = parent.at(idx + 1);
        const leftIsCompound = prev && prev.type !== 'combinator';
        const rightIsCompound = next && next.type !== 'combinator';
        if (!leftIsCompound && !rightIsCompound) n.replaceWith(selectorParser.universal({ value: '*' }));
        else n.remove();
      };
      const dropEnclosingSelector = (n) => {
        // inside :not(...): the argument that holds a run-time state can be true or false; drop it
        let s = n.parent; while (s && s.type !== 'selector') s = s.parent;
        if (s) s.remove();
      };
      visit(root, false, false);
      // clean :not() left empty
      root.walkPseudos((p) => { if (p.value === ':not' && (p.nodes.length === 0)) removeFromCompound(p); });
    }).processSync(text);
  } catch (e) {
    fail('selector_unparsed');
  }
  res.query = res.unknown ? null : out;
  // a scoped selector without :scope/& is relative to the scope root: `:where(:scope) <sel>`
  // (css-cascade-6), so the root itself is not its subject
  if (res.query && scoped && !res.usesScope) res.query = `:where(:-ax-scope) ${res.query.trim()}`;
  return res;
}

/**
 * Replace every attribute test on a name in `names` (and `#id` when 'id' is in names) by `:-ax-dyn(i)`,
 * where table[i](e) = the element binds that attribute at run time OR the original test holds.
 * Returns null when the query tests none of those names.
 */
export function dynamicAttrQuery(query, names, side, pseudos, quirks, isBound) {
  const table = []; let touched = false;
  const out = selectorParser((root) => {
    root.walk((n) => {
      let name = null;
      if (n.type === 'attribute') name = n.attribute.toLowerCase();
      else if (n.type === 'id') name = 'id';
      if (!name || !names.has(name)) return;
      const orig = compile(n.toString().trim(), { xmlMode: false, quirksMode: quirks, pseudos, cacheResults: false });
      const i = table.length; table.push((e) => isBound(e, name) || orig(e));
      n.replaceWith(selectorParser.pseudo({ value: `:-ax-dyn(${i})` })); touched = true;
    });
  }).processSync(query);
  if (!touched) return null;
  side.dynTable = table;
  return out;
}

/** Compile a rewritten query against a page side (pseudo table). null if css-select refuses it. */
export function compileQuery(query, pseudos, quirks) {
  try {
    return compile(query, { xmlMode: false, quirksMode: quirks, pseudos, cacheResults: false });
  } catch { return null; }
}

/** Every element (written tree) under root matching fn, by DOM order. */
export function matchAll(fn, root) {
  const out = [];
  const rec = (n) => {
    for (const c of n.children ?? []) {
      if (c.type === 'tag' || c.type === 'script' || c.type === 'style') { if (c.axKey && fn(c)) out.push(c); rec(c); }
      else if (c.children) rec(c);
    }
  };
  rec(root);
  return out;
}
