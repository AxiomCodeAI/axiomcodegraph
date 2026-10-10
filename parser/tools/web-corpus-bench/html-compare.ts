import * as path from 'path';
import * as parse5 from 'parse5';
import { parseDocument } from 'htmlparser2';
import { Counter, Case, Jsonl, arg, datCases, diff, fileCases, inc, nonWs, toObj, total } from './common';
import { axiomCss, axiomShape, compareCss, refDeclarationList, refStylesheet } from './css-ref';

const P = require('path').resolve(__dirname, '../../src');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HtmlParser } = require(`${P}/parsers/html/html-parser`);

const corpus = arg('corpus')!;
const root = arg('root')!;
const mode = arg('mode', 'files');
const out = new Jsonl(arg('out', path.resolve(__dirname, `results/html-${corpus}.jsonl`))!);
const html = new HtmlParser(axiomCss);

const URL_ATTRS = new Set(['src', 'href', 'action', 'formaction', 'poster', 'cite', 'manifest', 'ping', 'background', 'longdesc', 'usemap', 'codebase', 'profile', 'archive', 'xlink:href', 'srcset', 'imagesrcset']);
const URLISH = /^(https?:)?\/\/|^\.{0,2}\/|^#.|\.(css|js|png|jpe?g|svg|gif|webp|woff2?|ico|json|html?)(\?|#|$)|^(mailto|tel|data|javascript):/i;

interface RefShape {
  elements: number; tags: Counter; edges: Counter; attrs: Counter; attrValues: Counter; classes: Counter; ids: Counter;
  urls: Counter; urlishAttrs: Counter; scripts: number; inlineScripts: number; scriptText: number; styles: number;
  styleText: string[]; styleAttrs: string[]; handlers: number; text: number; title: string; doctype: boolean; errors: Counter;
  maxDepth: number; ms: number;
}
function emptyRef(): RefShape {
  return { elements: 0, tags: new Map(), edges: new Map(), attrs: new Map(), attrValues: new Map(), classes: new Map(), ids: new Map(),
    urls: new Map(), urlishAttrs: new Map(), scripts: 0, inlineScripts: 0, scriptText: 0, styles: 0, styleText: [], styleAttrs: [],
    handlers: 0, text: 0, title: '', doctype: false, errors: new Map(), maxDepth: 0, ms: 0 };
}

function refParse5(c: Case): RefShape {
  const s = emptyRef();
  const t0 = performance.now();
  const opts: parse5.ParserOptions<parse5.DefaultTreeAdapterMap> = { sourceCodeLocationInfo: true, scriptingEnabled: !c.scriptingOff, onParseError: (e) => inc(s.errors, e.code) };
  let rootNode: any;
  if (c.fragmentContext !== undefined) {
    const [a, b] = c.fragmentContext.split(/\s+/);
    const ns = b === undefined ? parse5.html.NS.HTML : a === 'svg' ? parse5.html.NS.SVG : parse5.html.NS.MATHML;
    const ctx = parse5.defaultTreeAdapter.createElement(b ?? a!, ns as any, []);
    rootNode = parse5.parseFragment(ctx, c.content, opts);
  } else {
    rootNode = parse5.parse(c.content, opts);
  }
  const visit = (node: any, writtenParent: string, depth: number): void => {
    const kids: any[] = node.childNodes ?? [];
    if (node.nodeName === 'template' && node.content) kids.push(...(node.content.childNodes ?? []));
    for (const k of kids) {
      if (k.nodeName === '#documentType') { s.doctype = true; continue; }
      if (k.nodeName === '#text') {
        if (writtenParent !== '' && !/^(script|style)$/.test(node.tagName ?? '')) s.text += nonWs(k.value);
        if (node.tagName === 'title' && s.title === '') s.title = k.value.replace(/\s+/g, ' ').trim();
        continue;
      }
      if (k.tagName === undefined) continue;
      const written = k.sourceCodeLocation !== null && k.sourceCodeLocation !== undefined;
      const tag = k.namespaceURI === parse5.html.NS.HTML ? k.tagName.toLowerCase() : k.tagName;
      if (!written) { visit(k, writtenParent, depth); continue; }
      s.elements += 1;
      if (depth > s.maxDepth) s.maxDepth = depth;
      inc(s.tags, tag);
      inc(s.edges, `${writtenParent}>${tag}`);
      for (const a of k.attrs) {
        const name = (a.prefix ? `${a.prefix}:${a.name}` : a.name).toLowerCase();
        inc(s.attrs, `${tag}@${name}`);
        inc(s.attrValues, `${name}=${a.value}`);
        if (name === 'class') for (const t of a.value.split(/[ \t\n\f\r]+/)) if (t !== '') inc(s.classes, t);
        if (name === 'id') inc(s.ids, a.value.trim());
        if (/^on[a-z]/.test(name) && a.value.trim() !== '') s.handlers += 1;
        if (name === 'style' && a.value.trim() !== '') s.styleAttrs.push(a.value);
        if (name === 'srcset' || name === 'imagesrcset') {
          for (const cand of a.value.split(/,(?=\s*\S)/)) { const u = cand.trim().split(/\s+/)[0] ?? ''; if (u !== '') inc(s.urls, u); }
        } else if (URL_ATTRS.has(name) || (name === 'data' && tag === 'object')) {
          inc(s.urls, a.value.trim());
        } else if (URLISH.test(a.value.trim()) && !/^(class|id|style|type|rel|name|for|lang|title|alt|content)$/.test(name)) {
          inc(s.urlishAttrs, `${tag}@${name}`);
        }
        if (tag === 'meta' && name === 'content') {
          const he = k.attrs.find((x: any) => x.name === 'http-equiv')?.value?.trim().toLowerCase();
          const m = he === 'refresh' ? /url\s*=\s*['"]?([^'"\s;]+)/i.exec(a.value) : null;
          if (m !== null) inc(s.urls, m[1]!);
        }
      }
      if (tag === 'script' && k.namespaceURI === parse5.html.NS.HTML) {
        s.scripts += 1;
        const src = k.attrs.find((x: any) => x.name === 'src')?.value;
        if (src === undefined || src.trim() === '') { s.inlineScripts += 1; for (const t of k.childNodes) if (t.nodeName === '#text') s.scriptText += t.value.length; }
      }
      if (tag === 'style' && k.namespaceURI === parse5.html.NS.HTML) {
        const type = k.attrs.find((x: any) => x.name === 'type')?.value?.trim().toLowerCase() ?? '';
        if (type === '' || type === 'text/css') { s.styles += 1; s.styleText.push(k.childNodes.filter((t: any) => t.nodeName === '#text').map((t: any) => t.value).join('')); }
      }
      visit(k, tag, depth + 1);
    }
  };
  visit(rootNode, '', 0);
  s.ms = performance.now() - t0;
  return s;
}

function refHtmlparser2(content: string): { elements: number; tags: Counter } {
  const tags: Counter = new Map();
  let elements = 0;
  const doc = parseDocument(content, { lowerCaseTags: true, lowerCaseAttributeNames: true });
  const visit = (n: any): void => {
    for (const k of n.children ?? []) {
      if (k.type === 'tag' || k.type === 'script' || k.type === 'style') { elements += 1; inc(tags, k.name); }
      visit(k);
    }
  };
  visit(doc);
  return { elements, tags };
}

function axiomParse(c: Case): { shape: RefShape; x: any; gaps: Counter; gapSamples: string[]; dialects: string[]; cssInline: Record<string, unknown> } {
  const s = emptyRef();
  const t0 = performance.now();
  const x = html.parse(c.content, c.file, c.root, 'V');
  s.ms = performance.now() - t0;
  const byHash = new Map<string, any>();
  for (const e of x.elements) byHash.set(e.getHash(), e);
  s.elements = x.elements.length;
  for (const e of x.elements) {
    inc(s.tags, e.tagName);
    const parent = byHash.get(e.parentElementLinkHash);
    inc(s.edges, `${parent?.tagName ?? ''}>${e.tagName}`);
    if (e.depth > s.maxDepth) s.maxDepth = e.depth;
    if (e.id !== '') inc(s.ids, e.id);
    s.text += nonWs(e.textContent);
  }
  for (const a of x.attributes) {
    const owner = byHash.get(a.ownerElementLinkHash);
    const name = (a.prefix === '' ? a.name : `${a.prefix}:${a.name}`).toLowerCase();
    inc(s.attrs, `${owner?.tagName}@${name}`);
    inc(s.attrValues, `${name}=${a.value}`);
  }
  for (const cr of x.classReferences) inc(s.classes, cr.className);
  for (const r of x.references) inc(s.urls, r.urlAsWritten);
  s.scripts = x.scripts.length;
  s.inlineScripts = x.scripts.filter((sc: any) => sc.scriptKind === 'INLINE').length;
  for (const sc of x.scripts) s.scriptText += sc.bodyLength;
  s.styles = x.stylesheets.length;
  s.title = x.document.title;
  s.doctype = x.document.doctype !== '';
  const handlerAttrs = new Set<string>();
  for (const h of x.handlerCalls) handlerAttrs.add(h.attributeLinkHash);
  const gaps: Counter = new Map();
  const gapSamples: string[] = [];
  for (const g of x.parseGaps) {
    const head = g.detail.split(':')[0];
    inc(gaps, `${g.gapKind}/${head}`);
    if (g.gapKind === 'HANDLER_SYNTAX') handlerAttrs.add(`${g.startLine}:${g.startColumn}`);
    if (gapSamples.length < 6) gapSamples.push(`${g.gapKind} L${g.startLine}: ${g.detail.slice(0, 100)}`);
  }
  s.handlers = handlerAttrs.size;
  // inline CSS: every <style> body against css-tree, every style attribute's declaration count
  const cssInline: Record<string, unknown> = {};
  if (x.stylesheets.length > 0) {
    const refAll = { rules: 0, decls: 0, errors: 0 };
    const axAll = { rules: 0, decls: 0, gaps: 0 };
    const samples: string[] = [];
    for (const sheet of x.stylesheets) {
      const i = x.stylesheets.indexOf(sheet);
      const text = (c as any).styleTexts?.[i];
      if (text === undefined) continue;
      const ref = refStylesheet(text);
      const sub = {
        rules: x.css.rules.filter((r: any) => r.stylesheetLinkHash === sheet.getHash()),
        selectors: x.css.selectors.filter((r: any) => r.stylesheetLinkHash === sheet.getHash()),
        selectorParts: x.css.selectorParts.filter((r: any) => x.css.rules.some((q: any) => q.getHash() === r.ruleLinkHash && q.stylesheetLinkHash === sheet.getHash())),
        declarations: x.css.declarations.filter((r: any) => r.stylesheetLinkHash === sheet.getHash()),
        valueReferences: x.css.valueReferences.filter((r: any) => r.stylesheetLinkHash === sheet.getHash()),
        comments: x.css.comments.filter((r: any) => r.stylesheetLinkHash === sheet.getHash()),
        parseGaps: x.css.parseGaps.filter((r: any) => r.stylesheetLinkHash === sheet.getHash()),
      };
      const ax = axiomShape(sub, 0);
      const cmp = compareCss(ref, ax, text) as any;
      refAll.rules += ref.styleRules + total(ref.atrules); refAll.decls += total(ref.declarations); refAll.errors += ref.errors.length;
      axAll.rules += ax.styleRules + total(ax.atrules); axAll.decls += total(ax.declarations); axAll.gaps += cmp.axGaps;
      if (samples.length < 4 && (cmp.selectorMissingCount > 0 || cmp.declMissingCount > 0 || cmp.axGaps > 0)) {
        samples.push(JSON.stringify({ selMissing: cmp.selectorMissing.slice(0, 4), declMissing: cmp.declMissing.slice(0, 4), gaps: cmp.axGapSamples.slice(0, 3) }));
      }
    }
    cssInline.styleElements = { ref: refAll, ax: axAll, samples };
  }
  return { shape: s, x, gaps, gapSamples, dialects: [...x.document.templateDialects], cssInline };
}

const cases = mode === 'dat' ? datCases(corpus, root) : fileCases(corpus, root, ['.html', '.htm', '.xhtml']);
let n = 0;
for (const c of cases) {
  n += 1;
  if (n % 200 === 0) process.stderr.write(`${corpus}: ${n}\n`);
  const rec: Record<string, unknown> = { corpus, id: c.id, bytes: c.content.length, fragment: c.fragmentContext ?? '' };
  if (c.content.length < 300) rec.source = c.content;
  let ref: RefShape;
  try { ref = refParse5(c); } catch (e: any) { rec.refCrash = String(e?.message ?? e).slice(0, 200); out.write(rec); continue; }
  (c as any).styleTexts = ref.styleText;
  let h2: { elements: number; tags: Counter } = { elements: 0, tags: new Map() };
  try { h2 = refHtmlparser2(c.content); } catch { /* ignore */ }
  rec.refMs = Math.round(ref.ms);
  try {
    const ax = axiomParse(c);
    const a = ax.shape;
    const styleAttrRef = ref.styleAttrs.reduce((acc, v) => acc + refDeclarationList(v), 0);
    const styleAttrAx = ax.x.css.declarations.filter((d: any) => d.htmlAttributeLinkHash !== '').length;
    const edgeDiff = diff(ref.edges, a.edges, 30);
    const attrValueDiff = diff(ref.attrValues, a.attrValues, 400);
    const urlDiff = diff(ref.urls, a.urls, 200);
    Object.assign(rec, {
      axMs: Math.round(a.ms),
      elements: [ref.elements, a.elements, h2.elements],
      tagDiff: diff(ref.tags, a.tags, 30), tagDiffH2: diff(h2.tags, a.tags, 30),
      edgeDiffCount: Object.values(edgeDiff).filter((v) => v > 0).reduce((p, v) => p + v, 0), edgeDiff,
      maxDepth: [ref.maxDepth, a.maxDepth],
      attrs: [total(ref.attrs), total(a.attrs)], attrDiff: diff(ref.attrs, a.attrs, 20),
      attrValueMissingCount: Object.values(attrValueDiff).filter((v) => v > 0).reduce((p, v) => p + v, 0),
      attrValueMissing: Object.entries(attrValueDiff).filter(([, v]) => v > 0).slice(0, 8).map(([k]) => k.slice(0, 160)),
      attrValueExtra: Object.entries(attrValueDiff).filter(([, v]) => v < 0).slice(0, 8).map(([k]) => k.slice(0, 160)),
      classes: [total(ref.classes), total(a.classes)], classDiff: diff(ref.classes, a.classes, 10),
      ids: [total(ref.ids), total(a.ids)], idDiff: diff(ref.ids, a.ids, 10),
      urls: [total(ref.urls), total(a.urls)],
      urlMissingCount: Object.values(urlDiff).filter((v) => v > 0).reduce((p, v) => p + v, 0),
      urlMissing: Object.entries(urlDiff).filter(([, v]) => v > 0).slice(0, 8).map(([k]) => k.slice(0, 160)),
      urlExtra: Object.entries(urlDiff).filter(([, v]) => v < 0).slice(0, 8).map(([k]) => k.slice(0, 160)),
      urlishAttrs: toObj(ref.urlishAttrs),
      scripts: [ref.scripts, a.scripts], inlineScripts: [ref.inlineScripts, a.inlineScripts], scriptText: [ref.scriptText, a.scriptText],
      styles: [ref.styles, a.styles], styleAttrDecls: [styleAttrRef, styleAttrAx],
      handlers: [ref.handlers, a.handlers], handlerCalls: ax.x.handlerCalls.length,
      text: [ref.text, a.text], title: [ref.title, a.title], doctype: [ref.doctype, a.doctype],
      refErrors: total(ref.errors), refErrorKinds: toObj(ref.errors), axGaps: total(ax.gaps), axGapKinds: toObj(ax.gaps), axGapSamples: ax.gapSamples,
      dialects: ax.dialects, ...ax.cssInline,
    });
  } catch (e: any) {
    rec.crash = String(e?.stack ?? e).slice(0, 500);
  }
  out.write(rec);
}
out.close();
process.stderr.write(`${corpus}: done ${n}\n`);
