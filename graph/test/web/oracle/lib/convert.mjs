// SPEC §9 [iter2] conversion layer, computed independently from parse5 / postcss / the oracle's own styles rows.
// Each function emits rows of one kind; the row layouts are documented in tools/normalize.py.
import crypto from 'node:crypto';

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const classTokens = (el) => (el.node.attribs?.class ?? '').split(/[\t\n\f\r ]+/).filter(Boolean);
const directText = (el) => (el.node.children ?? []).filter((c) => c.type === 'text').map((c) => c.data).join('').replace(/\s+/g, ' ').trim();
const SKIP_TAGS = new Set(['html', 'head', 'body']);

/** Children map over the conversion element set (written, not inert, not html/head/body). */
function elementSet(pages) {
  const inSet = (el) => !el.inert && !SKIP_TAGS.has(el.tag);
  const kids = new Map();
  const all = [];
  for (const p of pages) for (const el of p.elements) {
    if (!inSet(el)) continue;
    all.push({ el, page: p });
    if (el.parentKey) { if (!kids.has(el.parentKey)) kids.set(el.parentKey, []); kids.get(el.parentKey).push(el); }
  }
  for (const v of kids.values()) v.sort((a, b) => a.line - b.line || a.col - b.col);
  return { all, kids, inSet };
}

/** sig_exact, sig_shape and subtree size for every element in the set (SPEC 9.1). */
export function signatures(pages) {
  const { all, kids, inSet } = elementSet(pages);
  const exact = new Map(); const shape = new Map(); const size = new Map();
  // children before parents without recursion: `all` is in document (pre-)order, so reverse order is post-order-safe
  const visit = (el) => {
    const ch = (kids.get(el.key) ?? []).filter(inSet);
    const names = el.attrs.map((a) => a.name).filter((n) => n !== 'id' && n !== 'class' && n !== 'style').sort();
    exact.set(el.key, md5([el.tag, [...classTokens(el)].sort().join(' '), names.join(' '), ch.map((c) => exact.get(c.key)).join(',')].join('\u0001')));
    shape.set(el.key, md5([el.tag, ch.map((c) => shape.get(c.key)).join(',')].join('\u0001')));
    size.set(el.key, 1 + ch.reduce((n, c) => n + size.get(c.key), 0));
  };
  for (let i = all.length - 1; i >= 0; i--) visit(all[i].el);
  return { all, kids, inSet, exact, shape, size };
}

function slotsOf(occ, kidsOf, level) {
  // align occurrences pre-order; path = child-index path from the root ('.' for the root)
  const walkers = occ.map((root) => {
    const out = []; const stack = [[root, '.']];
    while (stack.length) {
      const [el, path] = stack.pop();
      out.push({ el, path });
      const ch = kidsOf(el);
      for (let i = ch.length - 1; i >= 0; i--) stack.push([ch[i], path === '.' ? `${i}` : `${path}/${i}`]);
    }
    return out;
  });
  const slots = [];
  const n = Math.min(...walkers.map((w) => w.length));
  for (let i = 0; i < n; i++) {
    const nodes = walkers.map((w) => w[i]);
    if (new Set(nodes.map((x) => x.path)).size !== 1) continue;
    const path = nodes[0].path;
    const texts = new Set(nodes.map((x) => directText(x.el)));
    if (texts.size > 1) slots.push([path, 'text', '-', texts.size]);
    const attrNames = new Set(nodes.flatMap((x) => x.el.attrs.map((a) => a.name)).filter((a) => a !== 'class'));
    for (const name of [...attrNames].sort()) {
      const vals = new Set(nodes.map((x) => x.el.node.attribs?.[name] ?? '\u0000absent'));
      if (vals.size > 1) slots.push([path, 'attr', name, vals.size]);
    }
    if (level === 'shape') {
      const cls = new Set(nodes.map((x) => [...classTokens(x.el)].sort().join(' ')));
      if (cls.size > 1) slots.push([path, 'class', '-', cls.size]);
    }
  }
  return slots;
}

/** SPEC 9.1 components: groups (occ >= 2, size >= 3), maximality, slots. */
export function components(pages, emit, sig) {
  const { all, kids, inSet, size } = sig;
  const kidsOf = (el) => (kids.get(el.key) ?? []).filter(inSet);
  const byKey = new Map(all.map((x) => [x.el.key, x]));
  for (const level of ['exact', 'shape']) {
    const sigOf = level === 'exact' ? sig.exact : sig.shape;
    const groups = new Map();
    for (const { el } of all) {
      if (size.get(el.key) < 3) continue;
      const g = sigOf.get(el.key);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(el);
    }
    const kept = [...groups.entries()].filter(([, occ]) => occ.length >= 2);
    const occOf = new Map(); // element key -> group signature
    for (const [g, occ] of kept) for (const el of occ) occOf.set(el.key, g);
    for (const [g, occ] of kept) {
      // maximal: dropped when every occurrence's parent is an occurrence of ONE other group and no two share a parent
      const parents = occ.map((el) => el.parentKey);
      const pg = new Set(parents.map((pk) => (pk && byKey.has(pk) ? occOf.get(pk) : null)));
      const distinctParents = new Set(parents).size === parents.length;
      if (pg.size === 1 && [...pg][0] && [...pg][0] !== g && distinctParents) continue;
      const keys = occ.map((el) => el.key).sort();
      const pagesN = new Set(occ.map((el) => byKey.get(el.key).page.rel)).size;
      emit('component', level, keys.join(','), size.get(occ[0].key), occ.length, pagesN);
      const ordered = [...occ].sort((a, b) => (a.key < b.key ? -1 : 1));
      for (const [path, kind, attr, distinct] of slotsOf(ordered, kidsOf, level)) emit('component_slot', level, keys[0], path, kind, attr, distinct);
    }
  }
}

/** SPEC 9.8 repeats: runs of >= 3 consecutive siblings with one sig_shape and item size >= 2. */
export function repeats(pages, emit, sig) {
  const { kids, inSet, size } = sig;
  for (const [parentKey, chAll] of kids) {
    const ch = chAll.filter(inSet);
    let i = 0;
    while (i < ch.length) {
      let j = i + 1;
      while (j < ch.length && sig.shape.get(ch[j].key) === sig.shape.get(ch[i].key)) j++;
      const run = ch.slice(i, j);
      if (run.length >= 3 && size.get(run[0].key) >= 2) {
        const uniform = new Set(run.map((e) => sig.exact.get(e.key))).size === 1;
        emit('repeat', parentKey, run[0].key, chAll.indexOf(run[0]), run.length, run[0].tag, size.get(run[0].key), uniform ? 1 : 0);
      }
      i = j;
    }
  }
}

// ── 9.2 resolved style ──────────────────────────────────────────────────────────────────────────
const SHORTHANDS = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  inset: ['top', 'right', 'bottom', 'left'],
  border: ['border-width', 'border-style', 'border-color', 'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-right-style',
    'border-bottom-style', 'border-left-style', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  'border-top': ['border-top-width', 'border-top-style', 'border-top-color'],
  'border-right': ['border-right-width', 'border-right-style', 'border-right-color'],
  'border-bottom': ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'],
  'border-left': ['border-left-width', 'border-left-style', 'border-left-color'],
  'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  'border-style': ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
  'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  background: ['background-color', 'background-image', 'background-repeat', 'background-position', 'background-size', 'background-attachment', 'background-origin', 'background-clip'],
  font: ['font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-size', 'line-height', 'font-family'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  'flex-flow': ['flex-direction', 'flex-wrap'],
  gap: ['row-gap', 'column-gap'],
  'grid-template': ['grid-template-rows', 'grid-template-columns', 'grid-template-areas'],
  'grid-area': ['grid-row-start', 'grid-column-start', 'grid-row-end', 'grid-column-end'],
  overflow: ['overflow-x', 'overflow-y'],
  transition: ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay'],
  animation: ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state'],
  'list-style': ['list-style-type', 'list-style-position', 'list-style-image'],
  outline: ['outline-color', 'outline-style', 'outline-width'],
  'text-decoration': ['text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-decoration-thickness'],
  'place-items': ['align-items', 'justify-items'],
  'place-content': ['align-content', 'justify-content'],
};
const SHORTHAND_OF = new Map();
for (const [sh, longs] of Object.entries(SHORTHANDS)) for (const l of longs) { if (!SHORTHAND_OF.has(l)) SHORTHAND_OF.set(l, []); SHORTHAND_OF.get(l).push(sh); }

const posKey = (k) => { const m = /:(\d+):(\d+)$/.exec(k); return m ? Number(m[1]) * 1e6 + Number(m[2]) : 0; };

/**
 * SPEC 9.2: one `computed` row per (element, pseudo, property) with >= 1 contender, and `cascade_entry` rows (the
 * web_cascade view) for every contender with outcome and lost_reason.
 */
export function computed(pages, emit, contenderLoads, unlayeredRank) {
  const byEl = new Map();
  const ruleDecls = new Map();
  const declsOf = (rule) => {
    if (!ruleDecls.has(rule)) ruleDecls.set(rule, rule.sheet.decls.filter((d) => d.rule === rule));
    return ruleDecls.get(rule);
  };
  for (const c of contenderLoads) {
    for (const d of declsOf(c.rule)) {
      const k = `${c.el}\u0000${c.pseudo}\u0000${d.prop}`;
      if (!byEl.has(k)) byEl.set(k, []);
      const [a, b, cc] = (c.spec ?? '0,0,0').split(',').map(Number);
      byEl.get(k).push({ decl: d, status: c.status, conds: c.conds, imp: d.important ? 1 : 0, inline: 0, layer: c.lr, a, b, c: cc, so: c.so, ro: c.rule.order, pos: posKey(d.key) });
    }
  }
  for (const p of pages) for (const el of p.elements) for (const d of el.styleDecls ?? []) {
    const k = `${el.key}\u0000\u0000${d.prop}`;
    if (!byEl.has(k)) byEl.set(k, []);
    byEl.get(k).push({ decl: d, status: 'match', conds: [], imp: d.important ? 1 : 0, inline: 1, layer: Infinity, a: 0, b: 0, c: 0, so: 0, ro: 0, pos: posKey(d.key) });
  }
  // sort key, best first: importance, origin (inline), layer (normal: higher rank wins; important: lower wins),
  // specificity, sheet order, rule order, declaration position
  const cmp = (x, y) => (y.imp - x.imp) || (y.inline - x.inline) || (x.imp ? x.layer - y.layer : y.layer - x.layer)
    || (y.a - x.a) || (y.b - x.b) || (y.c - x.c) || (y.so - x.so) || (y.ro - x.ro) || (y.pos - x.pos);
  const reasonVs = (w, l) => (w.imp !== l.imp ? 'importance' : w.inline !== l.inline ? 'origin' : w.layer !== l.layer ? 'layer'
    : (w.a !== l.a || w.b !== l.b || w.c !== l.c) ? 'specificity' : 'source_order');
  const winners = new Map();
  for (const [k, list] of byEl) {
    list.sort(cmp);
    const winner = list.find((x) => x.status === 'match');
    winners.set(k, { winner, list });
  }
  for (const [k, { winner, list }] of winners) {
    const [elKey, pseudo, prop] = k.split('\u0000');
    let status = winner ? 'match' : list.some((x) => x.status === 'conditional') ? 'conditional_only' : 'unknown';
    let override = null;
    if (winner) {
      // a shorthand of this property whose winner sorts above this winner (L5: values not expanded)
      for (const sh of SHORTHAND_OF.get(prop) ?? []) {
        const o = winners.get(`${elKey}\u0000${pseudo}\u0000${sh}`)?.winner;
        if (o && cmp(o, winner) < 0 && (!override || cmp(o, override) < 0)) override = o;
      }
      if (override) status = 'shorthand_override';
    }
    const condAbove = winner ? list.filter((x) => x.status === 'conditional' && cmp(x, winner) < 0).length : list.filter((x) => x.status === 'conditional').length;
    emit('computed', elKey, pseudo, prop, winner ? winner.decl.key : '-', status, list.length, condAbove, override ? override.decl.key : '-');
    for (const x of list) {
      const outcome = x === winner ? 'won' : x.status === 'conditional' && (!winner || cmp(x, winner) < 0) ? 'conditional' : 'lost';
      const reason = outcome !== 'lost' ? '-' : override && x !== override ? reasonVs(winner, x) : winner ? reasonVs(winner, x) : '-';
      emit('cascade_entry', elKey, pseudo, prop, x.decl.key, outcome, reason);
    }
  }
}

// ── 9.3 theme tokens ────────────────────────────────────────────────────────────────────────────
const NAMED = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent currentcolor').split(' '));
const LENGTH = /^-?(\d+\.?\d*|\.\d+)(px|em|rem|%|vh|vw|vmin|vmax|ch|ex|pt|pc|cm|mm|in|q|svh|lvh|dvh|svw|lvw|dvw|cqw|cqh|fr)$/i;

export function tokensOfDecl(prop, value) {
  const out = [];
  const v = value.replace(/!important\s*$/i, '').trim();
  if (prop.startsWith('--')) out.push(['custom_property', prop]);
  const noVar = v.replace(/var\([^()]*(\([^()]*\))*[^()]*\)/g, ' ');
  for (const m of noVar.matchAll(/#([0-9a-f]{3,8})\b|\b(rgba?|hsla?)\([^)]*\)|\b([a-z]+)\b/gi)) {
    if (m[1]) {
      const h = m[1].toLowerCase();
      if (![3, 4, 6, 8].includes(h.length)) continue;
      out.push(['color', `#${h.length <= 4 ? [...h].map((c) => c + c).join('') : h}`]);
    } else if (m[2]) out.push(['color', m[0].toLowerCase().replace(/\s+/g, '')]);
    else if (NAMED.has(m[3].toLowerCase()) && !/^(font-family|font|animation|animation-name|transition|transition-property|content|grid-area|grid-template-areas)$/.test(prop)) out.push(['color', m[3].toLowerCase()]);
  }
  if (prop === 'font-family') out.push(['font_family', v.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '').toLowerCase()).join(', ')]);
  if (prop === 'font-size') out.push(['font_size', v.toLowerCase().replace(/\s+/g, ' ')]);
  if (/^(margin|padding|inset)(-|$)|^(row-|column-)?gap$/.test(prop)) for (const t of v.split(/\s+/)) if (LENGTH.test(t) || t === '0') out.push(['spacing', t.toLowerCase()]);
  if (/^border(-[a-z]+)*-radius$/.test(prop)) out.push(['radius', v.toLowerCase().replace(/\s+/g, ' ')]);
  if (prop === 'box-shadow' || prop === 'text-shadow') out.push(['shadow', v.toLowerCase().replace(/\s+/g, ' ')]);
  if (prop === 'z-index') out.push(['z_index', v]);
  return out;
}

export function tokens(sheets, pages, emit, sheetIsProject) {
  const tok = new Map(); // kind\0value -> {uses:Set(decl), proj:Set(decl)}
  const add = (kind, value, d, project) => {
    const k = `${kind}\u0000${value}`;
    if (!tok.has(k)) tok.set(k, { uses: new Set(), proj: new Set() });
    tok.get(k).uses.add(d.key);
    if (project) tok.get(k).proj.add(d.key);
  };
  for (const s of sheets.values()) for (const d of s.decls) for (const [k, v] of tokensOfDecl(d.prop, d.value)) add(k, v, d, sheetIsProject(s));
  for (const p of pages) for (const el of p.elements) for (const d of el.styleDecls ?? []) for (const [k, v] of tokensOfDecl(d.prop, d.value)) add(k, v, d, true);
  for (const [k, t] of tok) { const [kind, value] = k.split('\u0000'); emit('token', kind, value, t.uses.size, t.proj.size); }
}

// ── 9.4 breakpoints ─────────────────────────────────────────────────────────────────────────────
export function normMedia(p) {
  return p.toLowerCase().replace(/\s+/g, ' ').trim().replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s*:\s*/g, ':').replace(/\s*,\s*/g, ',');
}
function mediaBounds(m) {
  let min = null; let max = null; let unit = 'px';
  const px = (n, u) => { if (u === 'em' || u === 'rem') { unit = u; return `${Number(n) * 16}`; } return n; };
  for (const x of m.matchAll(/\((min|max)-width:([\d.]+)(px|em|rem)\)/g)) { if (x[1] === 'min') min = px(x[2], x[3]); else max = px(x[2], x[3]); }
  for (const x of m.matchAll(/width\s*(>=|>|<=|<)\s*([\d.]+)(px|em|rem)/g)) { if (x[1][0] === '>') min = px(x[2], x[3]); else max = px(x[2], x[3]); }
  for (const x of m.matchAll(/([\d.]+)(px|em|rem)\s*(<=|<)\s*width/g)) min = px(x[1], x[2]);
  return { min, max, unit };
}
export function breakpoints(sheets, pages, emit, pageLoads) {
  const bp = new Map(); // media -> {rules:Set, sheets:Set}
  const touch = (media, ruleKey, sheetKey, depth) => {
    if (!bp.has(media)) bp.set(media, { rules: new Set(), sheets: new Set() });
    bp.get(media).rules.add(ruleKey); bp.get(media).sheets.add(sheetKey);
    emit('rule_breakpoint', ruleKey, media, depth);
  };
  for (const s of sheets.values()) {
    const parentOf = new Map(s.rules.map((r) => [r.key, r.parent]));
    const byKey = new Map(s.rules.map((r) => [r.key, r]));
    for (const r of s.rules) {
      let depth = 0;
      for (let pk = r.parent; pk; pk = parentOf.get(pk)) {
        depth += 1;
        const pr = byKey.get(pk);
        if (pr && pr.name === 'media') touch(normMedia(pr.prelude), r.key, s.key, depth);
      }
    }
  }
  // sheets loaded with a media attribute / @import media list: all their rules, depth 0
  const seen = new Set();
  for (const loads of pageLoads.values()) for (const l of loads) for (const c of l.conds ?? []) {
    if (!c.startsWith('@media ')) continue;
    const media = normMedia(c.slice(7));
    const k = `${l.sheet.key}\u0000${media}`;
    if (seen.has(k)) continue; seen.add(k);
    for (const r of l.sheet.rules) touch(media, r.key, l.sheet.key, 0);
  }
  for (const [media, b] of bp) { const { min, max, unit } = mediaBounds(media); emit('breakpoint', media, min ?? '-', max ?? '-', min || max ? unit : '-', b.rules.size, b.sheets.size); }
}

// ── 9.5 forms ───────────────────────────────────────────────────────────────────────────────────
const LABELABLE = new Set(['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea']);
export function forms(pages, emit, resolveUrl, pageByPath) {
  for (const p of pages) {
    const firstById = new Map();
    for (const el of p.elements) { const id = el.node.attribs?.id; if (id !== undefined && !firstById.has(id)) firstById.set(id, el); }
    const anc = (el) => { const out = []; for (let e = el.parentKey ? p.byKey.get(el.parentKey) : null; e; e = e.parentKey ? p.byKey.get(e.parentKey) : null) out.push(e); return out; };
    const isLabelable = (el) => LABELABLE.has(el.tag) && !(el.tag === 'input' && (el.node.attribs?.type ?? '').toLowerCase() === 'hidden');
    const firstLabelableIn = (lab) => p.elements.find((e) => isLabelable(e) && anc(e).includes(lab));
    const controlsOf = new Map();
    for (const el of p.elements) {
      if (el.inert) continue;
      const at = el.node.attribs ?? {};
      const isControl = ['input', 'select', 'textarea', 'button'].includes(el.tag) || (at.contenteditable !== undefined && at.contenteditable !== 'false');
      if (!isControl) continue;
      let form = null;
      if (at.form !== undefined) { const f = firstById.get(at.form); form = f && f.tag === 'form' ? f : null; } else form = anc(el).find((e) => e.tag === 'form') ?? null;
      let label = null; let via = 'none';
      const id = at.id;
      if (id !== undefined && firstById.get(id) === el) {
        label = p.elements.find((e) => e.tag === 'label' && e.node.attribs?.for === id) ?? null;
        if (label) via = 'for';
      }
      if (!label && isLabelable(el)) { const wrap = anc(el).find((e) => e.tag === 'label'); if (wrap && firstLabelableIn(wrap) === el && wrap.node.attribs?.for === undefined) { label = wrap; via = 'wrap'; } }
      if (!label && at['aria-labelledby'] !== undefined) {
        const ref = at['aria-labelledby'].split(/\s+/).map((x) => firstById.get(x)).find(Boolean);
        if (ref) { label = ref; via = 'aria-labelledby'; }
      }
      if (!label && via === 'none') { if (at['aria-label'] !== undefined) via = 'aria-label'; else if (at.title !== undefined) via = 'title'; }
      const type = el.tag === 'input' ? (at.type ?? 'text').toLowerCase() : el.tag === 'button' ? (at.type ?? 'submit').toLowerCase() : '-';
      emit('form_control', el.key, form ? form.key : '-', el.tag, type, at.name ?? '-', at.required !== undefined ? 1 : 0, label ? label.key : '-', via);
      if (form) controlsOf.set(form.key, (controlsOf.get(form.key) ?? 0) + 1);
    }
    for (const el of p.elements) {
      if (el.tag !== 'form' || el.inert) continue;
      const at = el.node.attribs ?? {};
      const r = at.action !== undefined ? resolveUrl(at.action, p.rel, p.baseHref) : null;
      const target = r && r.kind === 'local' && r.target && pageByPath.has(r.target) ? r.target : '-';
      emit('form', el.key, at.action ?? '-', target, (at.method ?? 'get').toLowerCase(), controlsOf.get(el.key) ?? 0);
    }
  }
}

// ── 9.6 icon classes and font faces ─────────────────────────────────────────────────────────────
export function iconClasses(sheets, pages, emit, selectorParser) {
  const carriers = new Map();
  for (const p of pages) for (const el of p.elements) for (const c of classTokens(el)) carriers.set(c, (carriers.get(c) ?? 0) + 1);
  // font: declared in the icon rule, else in a rule `.D { font-family }` (one compound, only class D, no pseudo)
  // where every element carrying the icon class also carries D
  const elsWith = new Map();
  for (const p of pages) for (const el of p.elements) for (const c of classTokens(el)) { if (!elsWith.has(c)) elsWith.set(c, []); elsWith.get(c).push(el); }
  const classFonts = new Map();
  for (const s of sheets.values()) for (const r of s.rules) {
    if (r.kind !== 'style') continue;
    const f = (r.node.nodes ?? []).find((d) => d.type === 'decl' && d.prop.toLowerCase() === 'font-family');
    if (!f) continue;
    for (const sel of r.selectors) { const m = /^\.([\w-]+)$/.exec(sel.text); if (m && !classFonts.has(m[1])) classFonts.set(m[1], f.value.trim()); }
  }
  const fontFromCarrierClass = (cls) => {
    const els = elsWith.get(cls) ?? [];
    if (!els.length) return '-';
    const cands = [...classFonts.keys()].filter((d) => d !== cls && els.every((e) => classTokens(e).includes(d)));
    return cands.length === 1 ? classFonts.get(cands[0]) : '-';
  };
  const seen = new Set();
  for (const s of sheets.values()) for (const r of s.rules) {
    if (r.kind !== 'style') continue;
    const content = (r.node.nodes ?? []).find((d) => d.type === 'decl' && d.prop.toLowerCase() === 'content');
    if (!content) continue;
    const m = /^\s*(["'])(.*)\1\s*$/s.exec(content.value);
    if (!m) continue;
    const inner = m[2];
    if (!([...inner].length <= 2 || /^\\[0-9a-fA-F]{1,6}\s?$/.test(inner))) continue;
    const font = (r.node.nodes ?? []).find((d) => d.type === 'decl' && d.prop.toLowerCase() === 'font-family');
    for (const sel of r.selectors) {
      let cls = null; let ok = true; let pseudo = false;
      try {
        selectorParser((root) => {
          if (root.nodes.length !== 1) { ok = false; return; }
          for (const n of root.nodes[0].nodes) {
            if (n.type === 'class') { if (cls) ok = false; cls = n.value; } else if (n.type === 'tag') { /* allowed */ } else if (n.type === 'pseudo' && /^::?(before|after)$/i.test(n.value)) pseudo = true; else ok = false;
          }
        }).processSync(sel.text);
      } catch { ok = false; }
      if (!ok || !cls || !pseudo) continue;
      const k = `${cls}\u0000${r.key}`;
      if (seen.has(k)) continue; seen.add(k);
      emit('icon_class', cls, r.key, content.value.trim(), font ? font.value.trim() : fontFromCarrierClass(cls), carriers.get(cls) ?? 0);
    }
  }
}

// ── 9.7 outline ─────────────────────────────────────────────────────────────────────────────────
const LANDMARK_TAGS = new Set(['header', 'nav', 'main', 'aside', 'footer', 'search']);
const LANDMARK_ROLES = new Set(['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'region', 'search', 'form']);
export function outline(pages, emit) {
  for (const p of pages) {
    const rows = new Map(); let ordinal = 0;
    for (const el of p.elements) {
      if (el.inert) continue;
      const at = el.node.attribs ?? {};
      const role = (at.role ?? '').trim().toLowerCase();
      const named = at['aria-label'] !== undefined || at['aria-labelledby'] !== undefined;
      let kind = null; let name = null; let level = '-';
      if (/^h[1-6]$/.test(el.tag)) { kind = 'heading'; name = el.tag; level = el.tag[1]; } else if (role === 'heading') { kind = 'heading'; name = 'heading'; level = at['aria-level'] ?? '2'; } else if (LANDMARK_ROLES.has(role)) { kind = 'landmark'; name = role; } else if (LANDMARK_TAGS.has(el.tag)) { kind = 'landmark'; name = el.tag; } else if (el.tag === 'form' && named) { kind = 'landmark'; name = 'form'; } else if (el.tag === 'section' || el.tag === 'article') { kind = 'landmark'; name = named ? 'region' : el.tag; }
      if (!kind) continue;
      ordinal += 1;
      let parent = '-';
      for (let e = el.parentKey ? p.byKey.get(el.parentKey) : null; e; e = e.parentKey ? p.byKey.get(e.parentKey) : null) if (rows.has(e.key)) { parent = e.key; break; }
      rows.set(el.key, true);
      emit('outline', p.rel, ordinal, el.key, kind, name, level, parent);
    }
  }
}

// ── 9.9 classes ─────────────────────────────────────────────────────────────────────────────────
export function classes(pages, sheets, emit, stylesRows, iconSet) {
  const carriers = new Map(); // class -> {elements:Set, pages:Set}
  for (const p of pages) for (const el of p.elements) for (const c of new Set(classTokens(el))) {
    if (!carriers.has(c)) carriers.set(c, { elements: new Set(), pages: new Set() });
    carriers.get(c).elements.add(el.key); carriers.get(c).pages.add(p.rel);
  }
  const naming = new Map(); // class -> Set(selector keys)
  for (const s of sheets.values()) for (const r of s.rules) for (const sel of r.selectors) for (const [k, n] of sel.parts) if (k === 'CLASS') { if (!naming.has(n)) naming.set(n, new Set()); naming.get(n).add(sel.key); }
  const matchedBy = new Map(); // selector -> Set(element) (match/conditional)
  for (const [sel, el, st] of stylesRows) if (st !== 'unknown') { if (!matchedBy.has(sel)) matchedBy.set(sel, new Set()); matchedBy.get(sel).add(el); }
  for (const [c, car] of carriers) {
    const sels = naming.get(c) ?? new Set();
    const matching = [...sels].filter((s) => matchedBy.has(s));
    const styled = matching.some((s) => [...matchedBy.get(s)].some((e) => car.elements.has(e)));
    emit('class', c, car.elements.size, car.pages.size, sels.size, matching.length, styled ? 1 : 0, iconSet.has(c) ? 1 : 0);
  }
}
