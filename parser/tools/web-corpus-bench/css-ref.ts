/** Reference-side CSS extraction (css-tree + postcss + @bramus/specificity) and the axiom-side read, as comparable shapes. */
import * as csstree from 'css-tree';
import postcss from 'postcss';
import Specificity from '@bramus/specificity';

import { Counter, inc, toObj, diff, total } from './common';

const P = require('path').resolve(__dirname, '../../src');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CssParser } = require(`${P}/parsers/css/css-parser`);
const { CssStylesheet } = require(`${P}/analysis-types/css/CssStylesheet`);
const { CssSourceProvenance, CssStylesheetSource } = require(`${P}/enums/css/CssStylesheetSource`);

export const axiomCss = new CssParser();

export interface CssShape {
  styleRules: number;
  atrules: Counter;            // name -> count
  selectors: Counter;          // normalised selector text -> count
  specificity: Map<string, string>;   // normalised selector -> "a,b,c" (first seen)
  parts: Map<string, Counter>;        // normalised selector -> kind counter
  declarations: Counter;       // prop|value|imp
  customProps: number;
  vars: Counter; urls: Counter; imports: Counter; keyframesNames: Counter; fontFaceFamilies: Counter;
  layers: Counter; containers: Counter;
  comments: number;
  nestedStyleRules: number;    // style rules whose parent is a style rule
  errors: string[];
  ms: number;
}

export function normSel(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/\s*([>+~,|])\s*/g, '$1').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
    .replace(/\s*=\s*/g, '=').replace(/\s*\|\|\s*/g, '||').trim();
}
export function normVal(s: string): string { return s.replace(/\s+/g, '').toLowerCase(); }

function scanRefs(value: string, shape: CssShape): void {
  const re = /\b(var|url)\(\s*(?:(["'])([\s\S]*?)\2|([^)\s,]*))/g;
  for (let m = re.exec(value); m !== null; m = re.exec(value)) {
    const inner = (m[3] ?? m[4] ?? '').trim();
    if (m[1] === 'var') { if (/^--/.test(inner)) inc(shape.vars, inner); }
    else inc(shape.urls, inner);
  }
}

function emptyShape(): CssShape {
  return {
    styleRules: 0, atrules: new Map(), selectors: new Map(), specificity: new Map(), parts: new Map(), declarations: new Map(),
    customProps: 0, vars: new Map(), urls: new Map(), imports: new Map(), keyframesNames: new Map(), fontFaceFamilies: new Map(),
    layers: new Map(), containers: new Map(), comments: 0, nestedStyleRules: 0, errors: [], ms: 0,
  };
}

const PART_KIND: Record<string, string> = {
  TypeSelector: 'TYPE', ClassSelector: 'CLASS', IdSelector: 'ID', AttributeSelector: 'ATTRIBUTE',
  PseudoClassSelector: 'PSEUDO_CLASS', PseudoElementSelector: 'PSEUDO_ELEMENT', NestingSelector: 'NESTING',
};

export function refStylesheet(text: string): CssShape {
  const shape = emptyShape();
  const t0 = performance.now();
  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(text, { positions: true, parseValue: false, parseCustomProperty: false, onParseError: (e) => { shape.errors.push(e.message); } });
  } catch (e) { shape.errors.push('THROW ' + String(e)); shape.ms = performance.now() - t0; return shape; }
  csstree.walk(ast, {
    enter(node: any) {
      const atrule: any = (this as any).atrule;
      const rule: any = (this as any).rule;
      switch (node.type) {
        case 'Rule': {
          shape.styleRules += 1;
          if (rule !== null && rule !== node) shape.nestedStyleRules += 1;
          const inKeyframes = atrule !== null && /keyframes$/.test(String(atrule.name).toLowerCase());
          if (node.prelude.type === 'SelectorList') {
            node.prelude.children.forEach((sel: any) => {
              const txt = normSel(csstree.generate(sel));
              inc(shape.selectors, txt);
              if (inKeyframes) return;
              const kinds: Counter = new Map();
              csstree.walk(sel, (n: any) => {
                const k = PART_KIND[n.type];
                if (k === undefined) return;
                if (n.type === 'TypeSelector' && n.name === '*') inc(kinds, 'UNIVERSAL');
                else if (n.type === 'PseudoClassSelector' && /^(before|after|first-line|first-letter)$/i.test(n.name)) inc(kinds, 'PSEUDO_ELEMENT');
                else inc(kinds, k);
              });
              if (!shape.parts.has(txt)) shape.parts.set(txt, kinds);
              if (!shape.specificity.has(txt)) {
                try { const Spec: any = (Specificity as any).calculate ? Specificity : (Specificity as any).default; const s: any = Spec.calculate(csstree.generate(sel))[0]; const o: any = s?.asObject ?? s?.value ?? (typeof s?.toJSON === "function" ? s.toJSON().asObject : undefined); if (o) shape.specificity.set(txt, `${o.a},${o.b},${o.c}`); } catch { /* selector the library cannot read */ }
              }
            });
          } else {
            inc(shape.selectors, normSel(csstree.generate(node.prelude)));
          }
          break;
        }
        case 'Atrule': {
          const name = String(node.name).toLowerCase();
          inc(shape.atrules, name);
          const prelude = node.prelude ? csstree.generate(node.prelude) : '';
          if (name === 'import') {
            const m = /^\s*(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')/.exec(prelude);
            const target = m?.[1] ?? m?.[2] ?? m?.[3] ?? m?.[4] ?? m?.[5];
            if (target !== undefined) inc(shape.imports, target);
          } else if (/keyframes$/.test(name)) {
            inc(shape.keyframesNames, prelude.trim().replace(/^["']|["']$/g, ''));
          } else if (name === 'layer') {
            for (const p of prelude.split(',')) if (p.trim()) inc(shape.layers, p.trim());
          } else if (name === 'container') {
            const m = /^\s*([A-Za-z_-][\w-]*)\s*(?:\(|$)/.exec(prelude);
            if (m !== null && m[1] !== 'not') inc(shape.containers, m[1]!);
          }
          break;
        }
        case 'Declaration': {
          if (rule === null && atrule === null) break;
          const prop = String(node.property).toLowerCase();
          const raw = node.value.type === 'Raw' ? node.value.value : csstree.generate(node.value);
          inc(shape.declarations, `${prop}|${normVal(raw)}|${node.important ? '!' : ''}`);
          if (prop.startsWith('--')) shape.customProps += 1;
          scanRefs(raw, shape);
          if (atrule !== null && String(atrule.name).toLowerCase().replace(/^-[a-z]+-/, '') === 'font-face' && prop === 'font-family' && rule === null) {
            inc(shape.fontFaceFamilies, raw.trim().replace(/^["']|["']$/g, ''));
          }
          break;
        }
        case 'Comment': shape.comments += 1; break;
        default: break;
      }
    },
  });
  shape.ms = performance.now() - t0;
  return shape;
}

export function postcssThrows(text: string): string {
  try { postcss.parse(text); return ''; } catch (e: any) { return String(e.reason ?? e.message ?? e).slice(0, 120); }
}

export function refDeclarationList(text: string): number {
  let n = 0;
  try {
    const ast = csstree.parse(text, { context: 'declarationList', parseValue: false, parseCustomProperty: false, onParseError: () => {} });
    csstree.walk(ast, (node) => { if (node.type === 'Declaration') n += 1; });
  } catch { /* count stays */ }
  return n;
}

export interface AxiomCssResult extends CssShape { gaps: Counter; gapSamples: string[]; preprocessor: boolean; raw: any }

export function axiomStylesheet(text: string, file: string, root: string): AxiomCssResult {
  const sheet = new CssStylesheet({
    name: 'x', fileName: file.split('/').pop(), filePath: file, baseMservPath: root, relativePath: file.slice(root.length + 1),
    sourceKind: CssStylesheetSource.FILE, sourceProvenance: CssSourceProvenance.PROJECT, ownerHtmlElementLinkHash: '',
    htmlDocumentLinkHash: '', startLine: 1, startColumn: 1, endLine: 1, serviceVersionLinkHash: 'V',
  });
  const t0 = performance.now();
  const x = axiomCss.parseStylesheet(text, { stylesheet: sheet, line: 1, column: 1, filePath: file, projectRoot: root, serviceVersionLinkHash: 'V' });
  const ms = performance.now() - t0;
  return { ...axiomShape(x, ms), raw: x };
}

export function axiomShape(x: any, ms: number): AxiomCssResult {
  const shape = emptyShape() as AxiomCssResult;
  shape.ms = ms;
  shape.gaps = new Map(); shape.gapSamples = []; shape.preprocessor = false;
  const ruleByHash = new Map<string, any>();
  for (const r of x.rules) ruleByHash.set(r.getHash(), r);
  for (const r of x.rules) {
    if (r.ruleKind === 'STYLE_RULE') {
      shape.styleRules += 1;
      const parent = ruleByHash.get(r.parentRuleLinkHash);
      if (parent !== undefined && parent.ruleKind === 'STYLE_RULE') shape.nestedStyleRules += 1;
    } else {
      inc(shape.atrules, r.atRuleName);
      if (/keyframes$/.test(r.atRuleName)) inc(shape.keyframesNames, r.name);
      if (r.atRuleName.replace(/^-[a-z]+-/, '') === 'font-face' && r.name !== '') inc(shape.fontFaceFamilies, r.name);
    }
  }
  const partsBySel = new Map<string, Counter>();
  for (const p of x.selectorParts) {
    let c = partsBySel.get(p.selectorLinkHash);
    if (c === undefined) { c = new Map(); partsBySel.set(p.selectorLinkHash, c); }
    inc(c, p.partKind);
  }
  for (const s of x.selectors) {
    const txt = normSel(s.selectorText);
    inc(shape.selectors, txt);
    if (!shape.specificity.has(txt)) shape.specificity.set(txt, `${s.specificityA},${s.specificityB},${s.specificityC}`);
    if (!shape.parts.has(txt)) shape.parts.set(txt, partsBySel.get(s.getHash()) ?? new Map());
  }
  for (const d of x.declarations) {
    inc(shape.declarations, `${d.property.toLowerCase()}|${normVal(d.valueText)}|${d.isImportant ? '!' : ''}`);
    if (d.isCustomProperty) shape.customProps += 1;
  }
  for (const v of x.valueReferences) {
    switch (v.referenceKind) {
      case 'VARIABLE': inc(shape.vars, v.name); break;
      case 'URL': inc(shape.urls, v.name); break;
      case 'IMPORT': inc(shape.imports, v.name); break;
      case 'LAYER': inc(shape.layers, v.name); break;
      case 'CONTAINER': if (v.ownerRuleLinkHash !== '') inc(shape.containers, v.name); break;
      default: break;
    }
  }
  shape.comments = x.comments.length;
  for (const g of x.parseGaps) {
    inc(shape.gaps, g.gapKind);
    if (g.gapKind === 'PREPROCESSOR_SYNTAX') shape.preprocessor = true;
    if (shape.gapSamples.length < 8) shape.gapSamples.push(`${g.gapKind} L${g.startLine}: ${g.detail.slice(0, 100)}`);
  }
  return shape;
}

/** The comparison record for one stylesheet text. */
export function compareCss(ref: CssShape, ax: AxiomCssResult, text: string): Record<string, unknown> {
  const selMissing = diff(ref.selectors, ax.selectors, 1000);
  const specMismatch: string[] = [];
  const partsMismatch: string[] = [];
  for (const [sel, spec] of ref.specificity) {
    const a = ax.specificity.get(sel);
    if (a !== undefined && a !== spec && specMismatch.length < 10) specMismatch.push(`${sel} ref=${spec} ax=${a}`);
  }
  let partsChecked = 0, partsBad = 0;
  for (const [sel, kinds] of ref.parts) {
    const a = ax.parts.get(sel);
    if (a === undefined) continue;
    partsChecked += 1;
    const d = diff(kinds, a);
    if (Object.keys(d).length > 0) { partsBad += 1; if (partsMismatch.length < 10) partsMismatch.push(`${sel} ${JSON.stringify(d)}`); }
  }
  const declDiff = diff(ref.declarations, ax.declarations, 2000);
  const declMissing = Object.entries(declDiff).filter(([, v]) => v > 0);
  const declExtra = Object.entries(declDiff).filter(([, v]) => v < 0);
  const refErrs = ref.errors.length;
  const axGaps = total(ax.gaps) - (ax.gaps.get('PREPROCESSOR_SYNTAX') ?? 0);
  return {
    bytes: text.length, refMs: Math.round(ref.ms), axMs: Math.round(ax.ms),
    styleRules: [ref.styleRules, ax.styleRules], nestedStyleRules: [ref.nestedStyleRules, ax.nestedStyleRules],
    atrules: [total(ref.atrules), total(ax.atrules)], atruleDiff: diff(ref.atrules, ax.atrules),
    selectors: [total(ref.selectors), total(ax.selectors)],
    selectorMissingCount: Object.values(selMissing).filter((v) => v > 0).reduce((a, b) => a + b, 0),
    selectorExtraCount: -Object.values(selMissing).filter((v) => v < 0).reduce((a, b) => a + b, 0),
    selectorMissing: Object.entries(selMissing).filter(([, v]) => v > 0).slice(0, 12).map(([k]) => k),
    selectorExtra: Object.entries(selMissing).filter(([, v]) => v < 0).slice(0, 12).map(([k]) => k),
    specChecked: ref.specificity.size, specMismatchCount: [...ref.specificity].filter(([s, v]) => ax.specificity.has(s) && ax.specificity.get(s) !== v).length,
    specMismatch,
    partsChecked, partsBad, partsMismatch,
    declarations: [total(ref.declarations), total(ax.declarations)], customProps: [ref.customProps, ax.customProps],
    declMissingCount: declMissing.reduce((a, [, v]) => a + v, 0), declExtraCount: -declExtra.reduce((a, [, v]) => a + v, 0),
    declMissing: declMissing.slice(0, 12).map(([k]) => k), declExtra: declExtra.slice(0, 12).map(([k]) => k),
    vars: [total(ref.vars), total(ax.vars)], varDiff: diff(ref.vars, ax.vars, 10),
    urls: [total(ref.urls), total(ax.urls)], urlDiff: diff(ref.urls, ax.urls, 10),
    imports: [total(ref.imports), total(ax.imports)], importDiff: diff(ref.imports, ax.imports, 10),
    keyframesNames: [total(ref.keyframesNames), total(ax.keyframesNames)], keyframesDiff: diff(ref.keyframesNames, ax.keyframesNames, 10),
    fontFaces: [total(ref.fontFaceFamilies), total(ax.fontFaceFamilies)], fontFaceDiff: diff(ref.fontFaceFamilies, ax.fontFaceFamilies, 10),
    layers: [total(ref.layers), total(ax.layers)], containers: [total(ref.containers), total(ax.containers)],
    comments: [ref.comments, ax.comments],
    refErrors: refErrs, refErrorSamples: ref.errors.slice(0, 5), axGaps, axGapKinds: toObj(ax.gaps), axGapSamples: ax.gapSamples,
    preprocessor: ax.preprocessor,
  };
}
