/**
 * THE CONVERSION LAYER (SPEC §9): what an agent planning a component conversion needs, decided from the HTML/CSS
 * IR only. Each function here is pure over the page model (select.ts El trees) or over declaration text; build.ts
 * feeds it and writes the rows.
 *
 *   structures()   §9.1 shared structures (component candidates, exact and shape level) and §9.8 repeated lists
 *   outline()      §9.7 landmarks and headings
 *   forms()        §9.5 forms and their controls, labelled per the HTML spec
 *   valueTokens()  §9.3 theme tokens in one declaration value
 *   mediaOf()      §9.4 a @media prelude normalised, with its width range
 *   SHORTHANDS     §9.2 the longhand -> shorthands family table
 */
import { createHash } from 'crypto';

import type { El } from '@/bundle/web/select';

export type Sink = (table: string, row: Record<string, string | number | null>) => void;

const md5 = (s: string): string => createHash('md5').update(s).digest('hex');
const isHtmlNs = (e: El): boolean => e.ns === 'HTML' || e.ns === '';

// ── §9.1 / §9.8 shared structures and repeated lists ──────────────────────────────────────────────

export interface StructPage { id: string; file: string; elements: El[] }
export interface StructInput {
  pages: StructPage[];
  /** 1-based line and column of an element's start tag */
  at: (e: El) => [number, number];
  /** the uids of rules with a styles row on this element (for rules_styling_root), cascade order is the caller's */
  rulesOn?: (e: El) => string[];
}
export interface StructResult {
  /** element uid -> component uid of the groups it is an occurrence root of */
  componentsOfElement: Map<string, string[]>;
  /** component uid -> display */
  display: Map<string, string>;
}

const SKIP_ROOT = new Set(['html', 'head', 'body']);

export function structures(inp: StructInput, out: Sink): StructResult {
  const exact = new Map<string, string>(); const shape = new Map<string, string>(); const size = new Map<string, number>();
  const kids = (e: El): El[] => e.children.filter((c) => !c.inert);
  const included = (e: El): boolean => !e.inert && !(isHtmlNs(e) && SKIP_ROOT.has(e.tagLower));
  const tagOf = (e: El): string => (isHtmlNs(e) ? e.tagLower : e.tag);
  const attrNames = (e: El): string[] => [...e.attrs.keys()].filter((n) => n !== 'id' && n !== 'class' && n !== 'style').sort();
  const pageOf = new Map<string, StructPage>();
  // signatures bottom-up (iteratively: deep trees must not overflow the stack)
  for (const p of inp.pages) {
    const order: El[] = [];
    const stack: El[] = p.elements.filter((e) => e.parent === null);
    while (stack.length) { const e = stack.pop()!; order.push(e); for (const c of e.children) stack.push(c); }
    for (let i = order.length - 1; i >= 0; i--) {
      const e = order[i]!; pageOf.set(e.id, p);
      const ch = kids(e);
      const t = tagOf(e);
      exact.set(e.id, md5(`${t}|${[...e.classes].sort().join(' ')}|${attrNames(e).join(' ')}|${ch.map((c) => exact.get(c.id)).join(',')}`));
      shape.set(e.id, md5(`${t}|${ch.map((c) => shape.get(c.id)).join(',')}`));
      size.set(e.id, 1 + ch.reduce((n, c) => n + (size.get(c.id) ?? 1), 0));
    }
  }
  const all: El[] = inp.pages.flatMap((p) => p.elements);
  const res: StructResult = { componentsOfElement: new Map(), display: new Map() };
  const usedDisplay = new Map<string, number>();
  const directText = (e: El): string => (e.text ?? '').replace(/\s+/g, ' ').trim();

  /** slots over aligned occurrences (same shape: pre-order positions align) */
  const slotsOf = (ownerUid: string, roots: El[], level: string): number => {
    const walks = roots.map((r) => {
      const seq: { e: El; path: string }[] = [];
      const go = (e: El, path: string) => { seq.push({ e, path }); kids(e).forEach((c, i) => go(c, path ? `${path}/${i}` : String(i))); };
      go(r, '');
      return seq;
    });
    const n = Math.min(...walks.map((w) => w.length));
    let count = 0;
    const emit = (path: string, kind: string, attr: string | null, values: string[]) => {
      const distinct = [...new Set(values)];
      if (distinct.length < 2) return;
      count++;
      out('web_component_slots', { component_uid: ownerUid, path, kind, attribute_name: attr, distinct_values: distinct.length, samples: JSON.stringify(distinct.slice(0, 5)) });
    };
    for (let i = 0; i < n; i++) {
      const col = walks.map((w) => w[i]!);
      const path = col[0]!.path;
      emit(path, 'text', null, col.map((c) => directText(c.e)));
      const names = new Set<string>(); for (const c of col) for (const k of c.e.attrs.keys()) if (k !== 'class') names.add(k);
      for (const nm of [...names].sort()) emit(path, `attr:${nm}`, nm, col.map((c) => { const a = c.e.attrs.get(nm); return a ? a.value : '\u0000absent'; }));
      if (level === 'shape') emit(path, 'class', null, col.map((c) => [...c.e.classes].sort().join(' ')));
    }
    return count;
  };

  for (const level of ['exact', 'shape'] as const) {
    const sigOf = level === 'exact' ? exact : shape;
    const groups = new Map<string, El[]>();
    for (const e of all) {
      if (!included(e) || (size.get(e.id) ?? 1) < 3) continue;
      const s = sigOf.get(e.id)!; const g = groups.get(s); if (g) g.push(e); else groups.set(s, [e]);
    }
    for (const [s, g] of [...groups]) if (g.length < 2) groups.delete(s);
    const occOf = new Map<string, string>(); // element -> signature of the group it roots
    for (const [s, g] of groups) for (const e of g) occOf.set(e.id, s);
    // maximal: G is only ever a part of P when every occurrence's parent is an occurrence of the one group P and no
    // two occurrences share a parent
    const folded = new Set<string>();
    for (const [s, g] of groups) {
      const parents = g.map((e) => e.parent);
      if (parents.some((p) => p === null)) continue;
      const ps = new Set(parents.map((p) => occOf.get(p!.id) ?? ''));
      if (ps.size !== 1 || ps.has('') || ps.has(s)) continue;
      if (new Set(parents.map((p) => p!.id)).size !== parents.length) continue;
      folded.add(s);
    }
    const uidOf = (s: string) => `WEB_COMPONENT_${level.toUpperCase()}_${s}`;
    const kept = [...groups].filter(([s]) => !folded.has(s))
      .map(([s, g]) => ({ s, g: g.slice().sort((a, b) => (pageOf.get(a.id)!.file < pageOf.get(b.id)!.file ? -1 : pageOf.get(a.id)!.file > pageOf.get(b.id)!.file ? 1 : a.idx - b.idx)) }));
    // display names: exact level first, then shape, in a stable order (pages x size)
    kept.sort((a, b) => (new Set(b.g.map((e) => pageOf.get(e.id)!.id)).size * (size.get(b.g[0]!.id) ?? 0)) - (new Set(a.g.map((e) => pageOf.get(e.id)!.id)).size * (size.get(a.g[0]!.id) ?? 0)) || (a.s < b.s ? -1 : 1));
    const keptSet = new Set(kept.map((k) => k.s));
    for (const { s, g } of kept) {
      const uid = uidOf(s); const root = g[0]!;
      const cls = [...root.classes].sort().slice(0, 3);
      let disp = `${tagOf(root)}${cls.map((c) => '.' + c).join('')}`;
      const n = (usedDisplay.get(disp) ?? 0) + 1; usedDisplay.set(disp, n);
      if (n > 1) disp = `${disp}#${n}`;
      res.display.set(uid, disp);
      // the nearest containing kept group (every occurrence inside an occurrence of the same group)
      let parentComp: string | null = null; let same = true;
      for (const e of g) {
        let p: string | null = null;
        for (let a = e.parent; a; a = a.parent) { const ps = occOf.get(a.id); if (ps && keptSet.has(ps) && ps !== s) { p = ps; break; } }
        if (parentComp === null && p !== null && same) parentComp = p; else if (p !== parentComp) same = false;
      }
      const slotCount = slotsOf(uid, g, level);
      const pages = new Set(g.map((e) => pageOf.get(e.id)!.id)).size;
      out('web_components', { uid, level, signature: s, root_tag: tagOf(root), root_classes: [...root.classes].sort().join(' ') || null, display: disp,
        size: size.get(root.id) ?? 1, occurrences: g.length, pages, parent_component_uid: same && parentComp ? uidOf(parentComp) : null, slot_count: slotCount,
        rules_styling_root: inp.rulesOn ? inp.rulesOn(root).length : null });
      for (const e of g) {
        const p = pageOf.get(e.id)!; const [line, col] = inp.at(e);
        out('web_component_occurrences', { component_uid: uid, element_uid: e.id, page_uid: p.id, file: p.file, line, col });
        const a = res.componentsOfElement.get(e.id); if (a) a.push(uid); else res.componentsOfElement.set(e.id, [uid]);
      }
    }
  }

  // §9.8 repeated lists: maximal runs of >= 3 consecutive siblings with one shape and >= 2 elements per item
  for (const e of all) {
    if (e.inert) continue;
    const ch = kids(e);
    let i = 0;
    while (i < ch.length) {
      let j = i + 1;
      const s = shape.get(ch[i]!.id);
      while (j < ch.length && shape.get(ch[j]!.id) === s) j++;
      const run = ch.slice(i, j);
      if (run.length >= 3 && (size.get(run[0]!.id) ?? 1) >= 2) {
        const first = run[0]!; const p = pageOf.get(first.id)!;
        const uniform = new Set(run.map((x) => exact.get(x.id))).size === 1;
        const uid = `WEB_REPEAT_${first.id}`;
        const comp = (res.componentsOfElement.get(first.id) ?? [])[0] ?? null;
        const slotCount = slotsOf(uid, run, 'shape');
        out('web_repeats', { uid, parent_element_uid: e.id, page_uid: p.id, first_element_uid: first.id, start_position: first.position, count: run.length,
          item_tag: tagOf(first), item_classes: [...first.classes].sort().join(' ') || null, item_size: size.get(first.id) ?? 1, uniform: uniform ? 1 : 0,
          component_uid: comp, slot_count: slotCount });
      }
      i = j;
    }
  }
  return res;
}

// ── §9.7 landmarks and headings ──────────────────────────────────────────────────────────────────

const LANDMARK_TAGS = new Set(['header', 'nav', 'main', 'aside', 'footer', 'search', 'section', 'article', 'form']);
const LANDMARK_ROLES = new Set(['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'region', 'search', 'form']);

export function outline(page: StructPage, textOfId: (id: string) => string, out: Sink): void {
  const rows = new Map<string, string>(); // element -> outline uid
  let ordinal = 0;
  const label = (e: El): string | null => {
    const al = e.attrs.get('aria-label'); if (al && al.value.trim()) return al.value.trim();
    const lb = e.attrs.get('aria-labelledby'); if (lb && lb.value.trim()) { const t = lb.value.trim().split(/\s+/).map(textOfId).join(' ').trim(); if (t) return t; }
    return null;
  };
  const headingText = (e: El): string | null => {
    const stack = [...e.children];
    while (stack.length) { const c = stack.shift()!; if (isHtmlNs(c) && /^h[1-6]$/.test(c.tagLower)) return (c.text ?? '').trim() || null; stack.unshift(...c.children); }
    return null;
  };
  for (const e of page.elements) {
    if (e.inert) continue;
    const role = (e.attrs.get('role')?.value ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
    let kind = ''; let name = ''; let level: number | null = null;
    if (role === 'heading') { kind = 'heading'; name = 'heading'; level = Number(e.attrs.get('aria-level')?.value) || 2; }
    else if (isHtmlNs(e) && /^h[1-6]$/.test(e.tagLower)) { kind = 'heading'; name = e.tagLower; level = Number(e.tagLower[1]); }
    else if (role && LANDMARK_ROLES.has(role)) { kind = 'landmark'; name = role; }
    else if (isHtmlNs(e) && LANDMARK_TAGS.has(e.tagLower)) {
      const named = label(e) !== null || !!e.attrs.get('title')?.value.trim();
      if (e.tagLower === 'form' && !named) continue;
      kind = 'landmark'; name = e.tagLower === 'section' && named ? 'region' : e.tagLower;
    } else continue;
    let parent: string | null = null;
    for (let a = e.parent; a; a = a.parent) { const u = rows.get(a.id); if (u) { parent = u; break; } }
    const uid = `WEB_OUTLINE_${e.id}`; rows.set(e.id, uid);
    out('web_outline', { uid, element_uid: e.id, page_uid: page.id, kind, name, level, label: kind === 'landmark' ? (label(e) ?? headingText(e)) : null,
      text: kind === 'heading' ? ((e.text ?? '').trim() || null) : null, parent_outline_uid: parent, ordinal: ++ordinal });
  }
}

// ── §9.5 forms ───────────────────────────────────────────────────────────────────────────────────

const LABELABLE = new Set(['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea']);

export function forms(page: StructPage, resolvePage: (form: El, action: string) => string | null, textOf: (e: El) => string, out: Sink): void {
  const html = page.elements.filter((e) => !e.inert);
  const firstById = new Map<string, El>();
  for (const e of html) if (e.idAttr && !firstById.has(e.idAttr)) firstById.set(e.idAttr, e);
  const isControl = (e: El): boolean => isHtmlNs(e) && (['input', 'select', 'textarea', 'button'].includes(e.tagLower)
    || (e.attrs.has('contenteditable') && (e.attrs.get('contenteditable')!.value.trim().toLowerCase() !== 'false')));
  const labelable = (e: El): boolean => isHtmlNs(e) && LABELABLE.has(e.tagLower) && !(e.tagLower === 'input' && (e.attrs.get('type')?.value ?? '').toLowerCase() === 'hidden');
  const firstLabelable = (l: El): El | null => {
    const stack = [...l.children];
    while (stack.length) { const c = stack.shift()!; if (labelable(c)) return c; stack.unshift(...c.children); }
    return null;
  };
  const labels = html.filter((e) => isHtmlNs(e) && e.tagLower === 'label');
  const controls = html.filter(isControl);
  const ownerOf = (c: El): El | null => {
    const f = c.attrs.get('form')?.value.trim();
    if (f) { const t = firstById.get(f); return t && isHtmlNs(t) && t.tagLower === 'form' ? t : null; }
    for (let a = c.parent; a; a = a.parent) if (isHtmlNs(a) && a.tagLower === 'form') return a;
    return null;
  };
  const perForm = new Map<string, number>();
  for (const c of controls) {
    const f = ownerOf(c); if (f) perForm.set(f.id, (perForm.get(f.id) ?? 0) + 1);
    let via = 'none'; let lab: El | null = null; let text: string | null = null;
    if (labelable(c)) {
      lab = labels.find((l) => { const fr = l.attrs.get('for')?.value; return fr !== undefined && fr !== '' && firstById.get(fr) === c; }) ?? null;
      if (lab) via = 'for';
      else {
        for (let a = c.parent; a; a = a.parent) if (isHtmlNs(a) && a.tagLower === 'label' && !a.attrs.has('for') && firstLabelable(a) === c) { lab = a; via = 'wrap'; break; }
      }
    }
    if (!lab) {
      const lb = c.attrs.get('aria-labelledby')?.value.trim();
      const al = c.attrs.get('aria-label')?.value.trim(); const ti = c.attrs.get('title')?.value.trim();
      if (lb) { const ids = lb.split(/\s+/); const t = firstById.get(ids[0]!); if (t) { lab = t; via = 'aria-labelledby'; text = ids.map((i) => { const x = firstById.get(i); return x ? textOf(x) : ''; }).join(' ').trim() || null; } }
      if (!lab && al) { via = 'aria-label'; text = al; }
      else if (!lab && ti) { via = 'title'; text = ti; }
    } else text = textOf(lab) || null;
    const a = (n: string): string | null => { const v = c.attrs.get(n); return v ? v.value : null; };
    const flag = (n: string): number => (c.attrs.has(n) ? 1 : 0);
    const tag = c.tagLower;
    const type = tag === 'input' ? ((a('type') ?? '').trim().toLowerCase() || 'text') : tag === 'button' ? ((a('type') ?? '').trim().toLowerCase() || 'submit') : null;
    out('web_form_controls', { element_uid: c.id, page_uid: page.id, form_uid: f?.id ?? null, tag, type, name: a('name'), id: c.idAttr || null, required: flag('required'),
      pattern: a('pattern'), min: a('min'), max: a('max'), minlength: a('minlength'), maxlength: a('maxlength'), step: a('step'), placeholder: a('placeholder'),
      value: a('value'), checked: flag('checked'), disabled: flag('disabled'), multiple: flag('multiple'), autocomplete: a('autocomplete'),
      label_uid: lab?.id ?? null, label_via: via, label_text: text });
  }
  for (const f of html.filter((e) => isHtmlNs(e) && e.tagLower === 'form')) {
    const action = f.attrs.get('action')?.value ?? null;
    out('web_forms', { element_uid: f.id, page_uid: page.id, action, action_resolved_page: action ? resolvePage(f, action) : null,
      method: (f.attrs.get('method')?.value ?? '').trim().toLowerCase() || 'get', enctype: f.attrs.get('enctype')?.value ?? null, controls: perForm.get(f.id) ?? 0 });
  }
}

// ── §9.3 theme tokens ────────────────────────────────────────────────────────────────────────────

const NAMED_COLORS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood '
  + 'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey '
  + 'darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey '
  + 'darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite '
  + 'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon '
  + 'lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue '
  + 'lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid '
  + 'mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin '
  + 'navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip '
  + 'peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna '
  + 'silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke '
  + 'yellow yellowgreen transparent currentcolor').split(' '));

const SPACING = /^(margin|padding)(-.+)?$|^(gap|row-gap|column-gap)$|^inset(-.+)?$/;
const LENGTH = /^-?(\d+\.?\d*|\.\d+)(px|em|rem|%|vh|vw|vmin|vmax|ch|ex|pt|pc|cm|mm|in|q|svh|lvh|dvh|svw|lvw|dvw|fr)?$/i;

/** a value's text with strings and url() bodies blanked (same length), and comments removed */
function scrub(v: string): string {
  return v.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/url\([^)]*\)/gi, (m) => ' '.repeat(m.length)).replace(/"[^"]*"|'[^']*'/g, (m) => ' '.repeat(m.length));
}

export function normColor(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hex) {
    const h = hex[1]!;
    if (h.length === 3 || h.length === 4) return '#' + [...h].map((c) => c + c).join('');
    if (h.length === 6 || h.length === 8) return '#' + h;
    return null;
  }
  if (/^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/.test(v)) return v.replace(/\s+/g, '');
  return NAMED_COLORS.has(v) ? v : null;
}

/** every (kind, value) token of one declaration; `var(--x)` is a use of the custom_property token --x */
export function valueTokens(property: string, value: string): { kind: string; value: string }[] {
  const prop = property.trim().toLowerCase();
  const out: { kind: string; value: string }[] = [];
  const add = (kind: string, v: string) => { if (v && !out.some((t) => t.kind === kind && t.value === v)) out.push({ kind, value: v }); };
  const val = value.replace(/!\s*important\s*$/i, '').trim();
  const s = scrub(val);
  for (const m of s.matchAll(/var\(\s*(--[\w-]+)/g)) add('custom_property', m[1]!);
  if (prop === 'font-family') {
    add('font_family', val.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '').toLowerCase()).filter(Boolean).join(', '));
    return out;
  }
  if (prop === 'font') return out;
  // colours: hex, colour functions (whole), named colours as whole identifiers
  const noVar = s.replace(/var\([^()]*(\([^()]*\)[^()]*)*\)/g, (m) => ' '.repeat(m.length));
  for (const m of noVar.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|(?<![\w-])[a-zA-Z]+(?![\w-(])/g)) {
    const c = normColor(m[0]); if (c) add('color', c);
  }
  if (prop === 'font-size') add('font_size', val.replace(/\s+/g, ' ').toLowerCase());
  else if (/^border(-[a-z]+)*-radius$/.test(prop)) add('radius', val.replace(/\s+/g, ' ').toLowerCase());
  else if (prop === 'box-shadow' || prop === 'text-shadow') add('shadow', val.replace(/\s+/g, ' ').replace(/\(\s*([^()]*?)\s*\)/g, (_m, x: string) => `(${x.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ')})`).toLowerCase());
  else if (prop === 'z-index') add('z_index', val.trim());
  else if (SPACING.test(prop)) {
    for (const t of noVar.split(/[\s,/]+/)) if (t && LENGTH.test(t) && !/^\(/.test(t)) add('spacing', t.toLowerCase());
  }
  return out;
}

// ── §9.4 breakpoints ─────────────────────────────────────────────────────────────────────────────

export function normMedia(prelude: string): string {
  return prelude.toLowerCase().replace(/\s+/g, ' ').trim()
    .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s*:\s*/g, ':').replace(/\s*,\s*/g, ',');
}

export function mediaRange(media: string): { min: number | null; max: number | null; unit: string | null; features: string | null } {
  let min: number | null = null, max: number | null = null, unit: string | null = null;
  const px = (n: string, u: string): number => { unit = unit ?? u; return u === 'px' ? Number(n) : Math.round(Number(n) * 16); };
  const features: string[] = [];
  for (const m of media.matchAll(/\(([^()]*)\)/g)) {
    const f = m[1]!.trim();
    let r: RegExpExecArray | null;
    if ((r = /^min-width:([\d.]+)(px|em|rem)$/.exec(f))) min = px(r[1]!, r[2]!);
    else if ((r = /^max-width:([\d.]+)(px|em|rem)$/.exec(f))) max = px(r[1]!, r[2]!);
    else if ((r = /^width\s*(>=|>)\s*([\d.]+)(px|em|rem)$/.exec(f))) min = px(r[2]!, r[3]!);
    else if ((r = /^width\s*(<=|<)\s*([\d.]+)(px|em|rem)$/.exec(f))) max = px(r[2]!, r[3]!);
    else if ((r = /^([\d.]+)(px|em|rem)\s*(<=|<)\s*width$/.exec(f))) min = px(r[1]!, r[2]!);
    else features.push(f);
  }
  return { min, max, unit, features: features.length ? features.join(';') : null };
}

// ── §9.2 shorthands ──────────────────────────────────────────────────────────────────────────────

const SIDES = ['top', 'right', 'bottom', 'left'];
const FAMILY: Record<string, string[]> = {
  margin: SIDES.map((s) => `margin-${s}`), padding: SIDES.map((s) => `padding-${s}`), inset: [...SIDES],
  border: ['border-width', 'border-style', 'border-color', ...SIDES.map((s) => `border-${s}`)],
  'border-width': SIDES.map((s) => `border-${s}-width`), 'border-style': SIDES.map((s) => `border-${s}-style`), 'border-color': SIDES.map((s) => `border-${s}-color`),
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  background: ['background-color', 'background-image', 'background-repeat', 'background-position', 'background-size', 'background-attachment', 'background-origin', 'background-clip'],
  font: ['font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-size', 'line-height', 'font-family'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'], 'flex-flow': ['flex-direction', 'flex-wrap'], gap: ['row-gap', 'column-gap'],
  'grid-template': ['grid-template-rows', 'grid-template-columns', 'grid-template-areas'],
  'grid-area': ['grid-row-start', 'grid-column-start', 'grid-row-end', 'grid-column-end'], overflow: ['overflow-x', 'overflow-y'],
  transition: ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay'],
  animation: ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state'],
  'list-style': ['list-style-type', 'list-style-position', 'list-style-image'], outline: ['outline-color', 'outline-style', 'outline-width'],
  'text-decoration': ['text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness'],
  'place-items': ['align-items', 'justify-items'], 'place-content': ['align-content', 'justify-content'],
};
for (const s of SIDES) FAMILY[`border-${s}`] = [`border-${s}-width`, `border-${s}-style`, `border-${s}-color`];

/** longhand -> every shorthand that sets it, directly or through another shorthand */
export const SHORTHANDS: Map<string, string[]> = (() => {
  const m = new Map<string, Set<string>>();
  const add = (sh: string, l: string) => { let s = m.get(l); if (!s) { s = new Set(); m.set(l, s); } s.add(sh); };
  for (const [sh, ls] of Object.entries(FAMILY)) for (const l of ls) add(sh, l);
  let changed = true;
  while (changed) {
    changed = false;
    for (const shs of m.values()) for (const sh of [...shs]) for (const up of m.get(sh) ?? []) if (!shs.has(up)) { shs.add(up); changed = true; }
  }
  return new Map([...m].map(([k, v]) => [k, [...v]]));
})();
