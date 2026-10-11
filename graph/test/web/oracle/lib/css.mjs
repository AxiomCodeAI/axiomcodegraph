// CSS side of the oracle: postcss (strict, then the safe parser on a syntax error, recorded as a
// gap) + postcss-selector-parser + @bramus/specificity. Positions are converted to the coordinates
// of the FILE on disk (a <style> body or style="" value is offset into its HTML file).
import postcss from 'postcss';
import safeParse from 'postcss-safe-parser';
import selectorParser from 'postcss-selector-parser';
import Specificity from '@bramus/specificity';
const calculate = (s) => Specificity.calculate(s);

// @scope is NOT a condition (SPEC 3.2 [iter1b]): it is exact containment, handled through ctx.scopes
const COND_AT = new Set(['media', 'supports', 'container', 'starting-style', 'document', '-moz-document']);
export const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif',
  'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', 'inherit', 'initial', 'unset', 'revert',
  'revert-layer', '-apple-system', 'blinkmacsystemfont', '-webkit-body', '-webkit-pictograph']); // V1-21: vendor system-font aliases are no reference
const ANIM_KEYWORDS = new Set(['none', 'initial', 'inherit', 'unset', 'revert', 'revert-layer', 'infinite', 'normal', 'reverse',
  'alternate', 'alternate-reverse', 'forwards', 'backwards', 'both', 'running', 'paused', 'linear', 'ease', 'ease-in',
  'ease-out', 'ease-in-out', 'step-start', 'step-end', 'auto', 'replace', 'add', 'accumulate']);

/** Shift a postcss position (relative to the parsed text) into file coordinates. */
const shift = (p, base) => (p.line === 1 ? { line: base.line, col: base.col + p.column - 1 } : { line: base.line + p.line - 1, col: p.column });

export const normSelector = (s) => s.replace(/\s+/g, ' ').trim();

export function specificityOf(sel) {
  try {
    const r = calculate(sel);
    const s = Array.isArray(r) ? r[0] : r;
    const v = s.value ?? s;
    return `${v.a},${v.b},${v.c}`;
  } catch { return null; }
}

/**
 * Parse a stylesheet text. `base` = {line, col} of the text's first character in `file`.
 * Returns a sheet model: { file, root, gap, rules[], decls[], refs[], comments[], imports[], layerStatements[] }.
 */
export function parseSheet(text, file, base, sheetKey) {
  let root; let gap = null;
  try { root = postcss.parse(text, { from: undefined }); } catch (e) {
    gap = `${e.reason ?? e.message} at ${e.line ?? '?'}:${e.column ?? '?'}`;
    try { root = safeParse(text, { from: undefined }); } catch (e2) { root = postcss.root(); gap += `; safe parse failed: ${e2.message}`; }
  }
  const sheet = { file, key: sheetKey, root, gap, rules: [], decls: [], refs: [], comments: [], imports: [] };
  let order = 0;
  const keyOf = (n) => { const p = shift(n.source.start, base); return `${file}:${p.line}:${p.col}`; };
  const visit = (container, ctx) => {
    for (const n of container.nodes ?? []) {
      if (n.type === 'comment') { sheet.comments.push({ key: keyOf(n), text: n.text }); continue; }
      if (n.type === 'decl') { addDecl(sheet, n, keyOf(n), ctx.rule ? ctx.rule.key : null, ctx); continue; }
      if (n.type === 'rule') {
        order += 1;
        const inKf = ctx.keyframes;
        const r = { key: keyOf(n), kind: inKf ? 'keyframe' : 'style', name: '', prelude: normSelector(n.selector), parent: ctx.rule?.key ?? null,
          order, node: n, conds: ctx.conds, layer: ctx.layer, sheet, important: 0, selectors: [], scopes: ctx.scopes ?? [],
          scopeTop: (ctx.scopes ?? []).length > 0 && !ctx.parentSelectors };
        if (!inKf) {
          const parents = ctx.parentSelectors;
          let i = 0;
          for (const raw of splitSelectors(n.selector)) {
            const text = normSelector(raw);
            // inside @scope with no enclosing style rule, `&` is `:scope` (SPEC 3.2 [iter1b])
            const expanded = r.scopeTop ? scopeAmp(text) : expandNesting(text, parents);
            r.selectors.push({ key: `${r.key}/${i}`, index: i, text, expanded, spec: specificityOf(expanded), parts: partsOf(text), rule: r });
            i += 1;
          }
        }
        for (const d of n.nodes ?? []) if (d.type === 'decl' && d.important) r.important += 1;
        sheet.rules.push(r);
        visit(n, { ...ctx, rule: r, parentSelectors: inKf ? ctx.parentSelectors : r.selectors.map((s) => s.expanded) });
        continue;
      }
      if (n.type === 'atrule') {
        order += 1;
        const name = n.name.toLowerCase();
        const r = { key: keyOf(n), kind: `@${name}`, name, prelude: n.params.replace(/\s+/g, ' ').trim(), parent: ctx.rule?.key ?? null,
          order, node: n, conds: ctx.conds, layer: ctx.layer, sheet, important: 0, selectors: [] };
        sheet.rules.push(r);
        atRuleRefs(sheet, r, n);
        const sub = { ...ctx, rule: r };
        if (COND_AT.has(name)) sub.conds = [...ctx.conds, `@${name} ${r.prelude}`.trim()];
        if (name === 'scope') { sub.scopes = [...(ctx.scopes ?? []), { key: r.key, ...scopePrelude(r.prelude) }]; sub.parentSelectors = null; }
        if (name === 'layer' && n.nodes) {
          const nm = r.prelude || `<anon:${r.key.replace(/\./g, "_")}>`;
          sub.layer = ctx.layer ? `${ctx.layer}.${nm}` : nm;
        }
        if (/keyframes$/.test(name)) sub.keyframes = true;
        if (n.nodes) visit(n, sub);
        continue;
      }
    }
  };
  visit(root, { rule: null, conds: [], layer: null, parentSelectors: null, keyframes: false });
  return sheet;
}

/** Split a selector list on top-level commas (postcss Rule.selectors does the same). */
function splitSelectors(sel) {
  return postcss.list.comma(sel);
}

/** `(A) to (B)` -> {start, end}; either may be null (prelude-less @scope). */
export function scopePrelude(p) {
  const out = { start: null, end: null };
  let i = 0; const t = p.trim();
  const group = () => {
    while (t[i] === ' ') i++;
    if (t[i] !== '(') return null;
    let d = 0; const s0 = i + 1;
    for (; i < t.length; i++) { if (t[i] === '(') d++; else if (t[i] === ')') { d--; if (d === 0) break; } }
    const g = t.slice(s0, i).trim(); i++; return g;
  };
  out.start = group();
  while (t[i] === ' ') i++;
  if (t.slice(i, i + 2).toLowerCase() === 'to') { i += 2; out.end = group(); }
  return out;
}

/** `&` -> `:scope` (top-level rule inside @scope). */
function scopeAmp(text) {
  const amps = [];
  try { selectorParser((root) => { root.walkNesting((n) => { amps.push(n.sourceIndex); }); }).processSync(text); } catch { return text; }
  let out = text;
  for (const i of amps.sort((a, b) => b - a)) out = `${out.slice(0, i)}:scope${out.slice(i + 1)}`;
  return out;
}

/** Expand CSS nesting: `&` becomes the parent list (as :is() when it is more than one simple compound). */
export function expandNesting(text, parents) {
  if (!parents || parents.length === 0) return text;
  const P = parents.length === 1 && !/[\s>+~,]/.test(parents[0]) ? parents[0] : `:is(${parents.join(', ')})`;
  const amps = [];
  try {
    selectorParser((root) => { root.walkNesting((n) => { amps.push(n.sourceIndex); }); }).processSync(text);
  } catch { /* unparsable: fall through to the textual form */ }
  if (amps.length) {
    let out = text;
    for (const i of amps.sort((a, b) => b - a)) out = out.slice(0, i) + P + out.slice(i + 1);
    return out;
  }
  return /^[>+~]/.test(text) ? `${P} ${text}` : `${P} ${text}`;
}

const ANB = /^([+-]?\d*n([+-]\d+)?|[+-]?\d+|even|odd|of|n|[+-]?n)$/i;
function inNthArgument(n) {
  for (let p = n.parent; p; p = p.parent) {
    if (p.type === 'pseudo') {
      if (!/^:nth-/i.test(p.value)) return false;
      // inside :nth-*(): the An+B part is everything before `of`
      const sel = n.parent; const idx = sel.nodes.indexOf(n);
      const ofAt = sel.nodes.findIndex((x) => x.type === 'tag' && x.value.toLowerCase() === 'of');
      return ANB.test(n.value) || ofAt < 0 || idx <= ofAt;
    }
  }
  return false;
}
const PART_KIND = { tag: 'TYPE', universal: 'UNIVERSAL', class: 'CLASS', id: 'ID', attribute: 'ATTRIBUTE', nesting: 'NESTING' };
function partsOf(text) {
  const parts = [];
  try {
    selectorParser((root) => {
      root.walk((n) => {
        if (n.type === 'pseudo') {
          const el = n.value.startsWith('::') || /^:(before|after|first-line|first-letter)$/i.test(n.value);
          parts.push([el ? 'PSEUDO_ELEMENT' : 'PSEUDO_CLASS', n.value.replace(/^::?/, '').toLowerCase()]);
        } else if (n.type === 'tag' && inNthArgument(n)) {
          // An+B (`even`, `2n+1`, `-n+3`) and `of` inside :nth-*() are not type selectors; a tag in `of S` is
        } else if (PART_KIND[n.type]) {
          parts.push([PART_KIND[n.type], n.type === 'attribute' ? n.attribute : n.type === 'nesting' || n.type === 'universal' ? n.value : n.value]);
        }
      });
    }).processSync(text);
  } catch { parts.push(['RAW', text]); }
  return parts;
}

function addDecl(sheet, n, key, ownerKey, ctx) {
  const custom = n.prop.startsWith('--');
  const prop = custom ? n.prop : n.prop.toLowerCase();
  // the value as the browser reads it: a comment inside it (`#333/*{fc}*/`) is not part of the value
  const value = n.value.trim();
  const d = { key, owner: ownerKey, prop, value, important: !!n.important, custom, rule: ctx?.rule ?? null, sheet };
  sheet.decls.push(d);
  // a descriptor inside @font-face DEFINES the family; it is not a use of it
  const inFontFace = ctx?.rule?.name === 'font-face';
  for (const ref of valueRefs(prop, value)) if (!(inFontFace && ref.kind === 'FONT_FAMILY')) sheet.refs.push({ owner: key, ownerDecl: d, ...ref });
  return d;
}

/** Declarations of a style="" attribute value. base = file position of the value's first char. */
export function parseStyleAttr(text, file, base, ownerKey) {
  const sheet = { file, key: ownerKey, rules: [], decls: [], refs: [], comments: [], imports: [], gap: null };
  let root;
  try { root = postcss.parse(text, { from: undefined }); } catch (e) {
    sheet.gap = e.reason ?? e.message;
    try { root = safeParse(text, { from: undefined }); } catch { root = postcss.root(); }
  }
  for (const n of root.nodes ?? []) {
    if (n.type !== 'decl') continue;
    const p = shift(n.source.start, base);
    addDecl(sheet, n, `${file}:${p.line}:${p.col}`, ownerKey, null);
  }
  return sheet;
}

/** Scan a value for var(), url(), and the property-specific names (keyframes, fonts, containers). */
export function valueRefs(prop, value) {
  const out = [];
  // var(--x[, fallback]) at any depth, including inside other functions and fallbacks.
  const vre = /var\(\s*(--[A-Za-z0-9_\-\u0080-￿\\]+)\s*/gi;
  for (let m; (m = vre.exec(value));) {
    let fallback = '';
    let i = m.index + m[0].length;
    if (value[i] === ',') {
      let depth = 0; const s = i + 1;
      for (; i < value.length; i++) { const c = value[i]; if (c === '(') depth++; else if (c === ')') { if (depth === 0) break; depth--; } }
      fallback = value.slice(s, i).trim();
    }
    out.push({ kind: 'VARIABLE', name: m[1], fallback });
  }
  const ure = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
  for (let m; (m = ure.exec(value));) out.push({ kind: 'URL', name: m[1] ?? m[2] ?? m[3] ?? '' });
  const stripped = value.replace(/!important/i, '').trim();
  if (/^(-[a-z]+-)?animation-name$/.test(prop)) {
    for (const tok of postcss.list.comma(stripped)) {
      const t = tok.trim().replace(/^["']|["']$/g, '');
      if (t && !ANIM_KEYWORDS.has(t.toLowerCase()) && !/^var\(/.test(t)) out.push({ kind: 'KEYFRAMES', name: t });
    }
  }
  if (/^(-[a-z]+-)?animation$/.test(prop)) {
    for (const layer of postcss.list.comma(stripped)) {
      for (const tok of postcss.list.space(layer)) {
        const t = tok.replace(/^["']|["']$/g, '');
        if (!t || ANIM_KEYWORDS.has(t.toLowerCase())) continue;
        if (/^[-+]?[\d.]/.test(t) || /\(/.test(t)) continue; // durations, counts, timing functions, var()
        out.push({ kind: 'KEYFRAMES', name: t }); break; // the one name per layer
      }
    }
  }
  if (prop === 'font-family') {
    for (const f of postcss.list.comma(stripped)) { const n = f.trim().replace(/^["']|["']$/g, ''); if (n && !/^var\(/.test(n) && !GENERIC_FONTS.has(n.toLowerCase())) out.push({ kind: 'FONT_FAMILY', name: n }); }
  }
  if (prop === 'font') {
    // font: [style variant weight stretch]? size[/line-height] family[, family]*
    const toks = postcss.list.space(stripped);
    const i = toks.findIndex((t) => /^([\d.]+(px|em|rem|%|pt|pc|cm|mm|in|ex|ch|vw|vh|q)|xx?-small|x?-?small|medium|x?x?-large|larger|smaller)(\/.*)?$/i.test(t) || /^(calc|clamp|var)\(/i.test(t));
    if (i >= 0 && i < toks.length - 1) {
      let rest = toks.slice(i + 1).join(' ');
      if (rest.startsWith('/')) rest = rest.replace(/^\/\s*\S+\s*/, '');
      for (const f of postcss.list.comma(rest)) { const n = f.trim().replace(/^["']|["']$/g, ''); if (n && !/^var\(/.test(n) && !GENERIC_FONTS.has(n.toLowerCase())) out.push({ kind: 'FONT_FAMILY', name: n }); }
    }
  }
  if (prop === 'container-name') {
    for (const t of postcss.list.space(stripped)) if (t && t !== 'none') out.push({ kind: 'CONTAINER', name: t });
  }
  if (prop === 'container') {
    const names = stripped.split('/')[0].trim();
    for (const t of postcss.list.space(names)) if (t && t !== 'none') out.push({ kind: 'CONTAINER', name: t });
  }
  return out;
}

function atRuleRefs(sheet, r, n) {
  const name = r.name; const params = n.params.trim();
  if (name === 'import') {
    const m = /^(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')\s*(.*)$/is.exec(params);
    if (m) {
      const url = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
      let rest = (m[6] ?? '').trim(); let layer = null; let supports = null;
      const lm = /^layer(?:\(\s*([^)]*)\s*\))?\s*/i.exec(rest);
      if (lm) { layer = lm[1] ? lm[1].trim() : `<anon:${r.key.replace(/\./g, "_")}>`; rest = rest.slice(lm[0].length); }
      const sm = /^supports\(([^)]*(\([^)]*\))*[^)]*)\)\s*/i.exec(rest);
      if (sm) { supports = sm[1].trim(); rest = rest.slice(sm[0].length); }
      const media = rest.trim();
      sheet.imports.push({ rule: r, url, layer, supports, media });
      sheet.refs.push({ owner: r.key, kind: 'IMPORT', name: url });
      if (layer && !layer.startsWith('<anon')) sheet.refs.push({ owner: r.key, kind: 'LAYER', name: layer });
    }
  } else if (name === 'layer') {
    for (const l of params ? postcss.list.comma(params) : []) sheet.refs.push({ owner: r.key, kind: 'LAYER', name: l.trim() });
  } else if (name === 'container') {
    const m = /^([A-Za-z_-][\w-]*)\s+(?!and\b|or\b|not\b)/.exec(params);
    if (m && !/^(not|style|scroll-state)$/i.test(m[1])) sheet.refs.push({ owner: r.key, kind: 'CONTAINER', name: m[1] });
  }
}
