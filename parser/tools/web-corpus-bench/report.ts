import * as fs from 'fs';
import * as path from 'path';

const R = path.resolve(__dirname, 'results');
type Rec = Record<string, any>;
const load = (prefix: string): Rec[] => fs.readdirSync(R).filter((f) => f.startsWith(prefix) && f.endsWith('.jsonl')).sort()
  .flatMap((f) => fs.readFileSync(path.join(R, f), 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Rec));

type Agg = Map<string, { n: number; files: Set<string> }>;
const agg = (): Agg => new Map();
function add(a: Agg, key: string, n: number, file: string): void {
  let e = a.get(key); if (e === undefined) { e = { n: 0, files: new Set() }; a.set(key, e); } e.n += n; if (e.files.size < 3) e.files.add(file);
}
function top(a: Agg, k = 25, sign: 1 | -1 = 1): string[] {
  return [...a.entries()].filter(([, v]) => Math.sign(v.n) === sign).sort((x, y) => Math.abs(y[1].n) - Math.abs(x[1].n)).slice(0, k)
    .map(([key, v]) => `| \`${key.replace(/\|/g, '\\|').slice(0, 90)}\` | ${Math.abs(v.n)} | ${[...v.files].join(', ').slice(0, 120)} |`);
}
const pct = (a: number, b: number): string => b === 0 ? 'n/a' : `${((100 * a) / b).toFixed(2)}%`;
const sum = (rs: Rec[], f: (r: Rec) => number): number => rs.reduce((p, r) => p + (f(r) || 0), 0);
const lines: string[] = [];
const out = (s = ''): void => { lines.push(s); };
const table = (rows: string[], header: string): void => { if (rows.length === 0) { out('_none_'); out(); return; } out(header); out('|---|---:|---|'); rows.forEach(out); out(); };

// ───────────────────────────── HTML ─────────────────────────────
const html = load('html-');
out('# AxiomCode web front end vs reference parsers');
out();
out(`Generated ${new Date().toISOString().slice(0, 10)}. HTML reference: parse5 (WHATWG tree construction, written elements only) and htmlparser2; CSS reference: css-tree 3 + postcss 8 + @bramus/specificity.`);
out();
out('## HTML');
out();
out('| corpus | files | crashes | ref crashes | ax total ms | ref total ms | slowest file (ms) | elements ref / ax / htmlparser2 | files with element count = ref |');
out('|---|---:|---:|---:|---:|---:|---|---|---:|');
const byCorpus = new Map<string, Rec[]>();
for (const r of html) { const l = byCorpus.get(r.corpus) ?? []; l.push(r); byCorpus.set(r.corpus, l); }
for (const [c, rs] of byCorpus) {
  const ok = rs.filter((r) => r.elements);
  const slow = [...ok].sort((a, b) => b.axMs - a.axMs)[0];
  out(`| ${c} | ${rs.length} | ${rs.filter((r) => r.crash).length} | ${rs.filter((r) => r.refCrash).length} | ${sum(ok, (r) => r.axMs)} | ${sum(ok, (r) => r.refMs)} | ${slow ? `${slow.id.slice(0, 40)} (${slow.axMs})` : ''} | ${sum(ok, (r) => r.elements[0])} / ${sum(ok, (r) => r.elements[1])} / ${sum(ok, (r) => r.elements[2])} | ${ok.filter((r) => r.elements[0] === r.elements[1]).length} |`);
}
out();
const crashes = html.filter((r) => r.crash);
if (crashes.length > 0) { out('### Crashes'); out(); for (const r of crashes.slice(0, 20)) out(`- \`${r.corpus}/${r.id}\`: ${r.crash.split('\n')[0]}`); out(); }
const slow = html.filter((r) => r.axMs > 3000).sort((a, b) => b.axMs - a.axMs);
if (slow.length > 0) { out('### Slow files (> 3 s in axiom)'); out(); for (const r of slow.slice(0, 15)) out(`- \`${r.corpus}/${r.id}\` ${r.bytes} bytes: axiom ${r.axMs} ms, parse5 ${r.refMs} ms`); out(); }

const ok = html.filter((r) => r.elements);
out('### Coverage totals (all corpora, non-crashing files)');
out();
out('| measure | reference | axiom | axiom / reference |');
out('|---|---:|---:|---:|');
const measures: Array<[string, (r: Rec) => number, (r: Rec) => number]> = [
  ['written elements (parse5)', (r) => r.elements[0], (r) => r.elements[1]],
  ['attributes', (r) => r.attrs[0], (r) => r.attrs[1]],
  ['class tokens', (r) => r.classes[0], (r) => r.classes[1]],
  ['ids', (r) => r.ids[0], (r) => r.ids[1]],
  ['URL references', (r) => r.urls[0], (r) => r.urls[1]],
  ['script elements', (r) => r.scripts[0], (r) => r.scripts[1]],
  ['inline scripts', (r) => r.inlineScripts[0], (r) => r.inlineScripts[1]],
  ['inline script text (chars)', (r) => r.scriptText[0], (r) => r.scriptText[1]],
  ['style elements (css)', (r) => r.styles[0], (r) => r.styles[1]],
  ['style attribute declarations', (r) => r.styleAttrDecls[0], (r) => r.styleAttrDecls[1]],
  ['event-handler attributes (ax: attrs with a call or a gap)', (r) => r.handlers[0], (r) => r.handlers[1]],
  ['text (non-ws chars)', (r) => r.text[0], (r) => r.text[1]],
  ['<style> rules+at-rules', (r) => r.styleElements?.ref.rules ?? 0, (r) => r.styleElements?.ax.rules ?? 0],
  ['<style> declarations', (r) => r.styleElements?.ref.decls ?? 0, (r) => r.styleElements?.ax.decls ?? 0],
];
for (const [name, a, b] of measures) { const ra = sum(ok, a); const rb = sum(ok, b); out(`| ${name} | ${ra} | ${rb} | ${pct(rb, ra)} |`); }
out();
out(`Files where axiom's element count differs from parse5's written-element count: ${ok.filter((r) => r.elements[0] !== r.elements[1]).length} / ${ok.length}. `
  + `Files with at least one parent-child edge mismatch: ${ok.filter((r) => r.edgeDiffCount > 0).length}. `
  + `Files where axiom's max depth exceeds parse5's by more than 2: ${ok.filter((r) => r.maxDepth[1] - r.maxDepth[0] > 2).length}.`);
out();

const tagMissing = agg(), tagExtra = agg(), tagH2 = agg(), edgeMissing = agg(), edgeExtra = agg(), attrDiff = agg(), attrValMissing = agg(), attrValExtra = agg(),
  urlMissing = agg(), urlExtra = agg(), urlish = agg(), classDiff = agg(), idDiff = agg(), gapKinds = agg(), refErrKinds = agg(), dialects = agg(), titleBad = agg(), fpGaps = agg(), fnGaps = agg(), styleSamples = agg();
for (const r of ok) {
  const id = `${r.corpus}/${r.id}`;
  for (const [k, v] of Object.entries<number>(r.tagDiff ?? {})) add(v > 0 ? tagMissing : tagExtra, k, v, id);
  for (const [k, v] of Object.entries<number>(r.tagDiffH2 ?? {})) add(tagH2, k, v, id);
  for (const [k, v] of Object.entries<number>(r.edgeDiff ?? {})) add(v > 0 ? edgeMissing : edgeExtra, k, v, id);
  for (const [k, v] of Object.entries<number>(r.attrDiff ?? {})) add(attrDiff, k, v, id);
  for (const k of r.attrValueMissing ?? []) add(attrValMissing, k, 1, id);
  for (const k of r.attrValueExtra ?? []) add(attrValExtra, k, 1, id);
  for (const k of r.urlMissing ?? []) add(urlMissing, k, 1, id);
  for (const k of r.urlExtra ?? []) add(urlExtra, k, 1, id);
  for (const [k, v] of Object.entries<number>(r.urlishAttrs ?? {})) add(urlish, k, v, id);
  for (const [k, v] of Object.entries<number>(r.classDiff ?? {})) add(classDiff, k, v, id);
  for (const [k, v] of Object.entries<number>(r.idDiff ?? {})) add(idDiff, k, v, id);
  for (const [k, v] of Object.entries<number>(r.axGapKinds ?? {})) add(gapKinds, k, v, id);
  for (const [k, v] of Object.entries<number>(r.refErrorKinds ?? {})) add(refErrKinds, k, v, id);
  for (const d of r.dialects ?? []) add(dialects, d, 1, id);
  if (r.title[0] !== r.title[1]) add(titleBad, `${JSON.stringify(r.title[0]).slice(0, 50)} vs ${JSON.stringify(r.title[1]).slice(0, 50)}`, 1, id);
  if (r.axGaps > 0 && r.refErrors === 0) for (const g of r.axGapSamples ?? []) add(fpGaps, g.replace(/L\d+: /, '').replace(/[0-9]+/g, '#').slice(0, 70), 1, id);
  if (r.axGaps === 0 && r.refErrors > 0) for (const k of Object.keys(r.refErrorKinds ?? {})) add(fnGaps, k, 1, id);
  for (const s of r.styleElements?.samples ?? []) add(styleSamples, s.slice(0, 140), 1, id);
}
out('### Tags parse5 has that axiom lacks (summed over files)'); out();
table(top(tagMissing), '| tag | missing | examples |');
out('### Tags axiom has that parse5 does not count as written'); out();
table(top(tagExtra, 25, -1), '| tag | extra | examples |');
out('### Tag count differences vs htmlparser2 (positive: htmlparser2 has more)'); out();
table([...top(tagH2, 12), ...top(tagH2, 12, -1)], '| tag | delta | examples |');
out('### Parent>child edges parse5 has that axiom lacks (nesting divergence)'); out();
table(top(edgeMissing, 40), '| edge | missing | examples |');
out('### Parent>child edges axiom has that parse5 lacks'); out();
table(top(edgeExtra, 40, -1), '| edge | extra | examples |');
out('### Attribute (tag@name) count differences (positive: parse5 has more)'); out();
table([...top(attrDiff, 20), ...top(attrDiff, 20, -1)], '| tag@attr | delta | examples |');
out(`### Attribute name=value pairs parse5 has that axiom lacks (${sum(ok, (r) => r.attrValueMissingCount)} total)`); out();
table(top(attrValMissing, 40), '| name=value | files | examples |');
out('### Attribute name=value pairs axiom has that parse5 lacks'); out();
table(top(attrValExtra, 25), '| name=value | files | examples |');
out(`### URLs parse5 sees in URL attributes that axiom has no reference row for (${sum(ok, (r) => r.urlMissingCount)} total)`); out();
table(top(urlMissing, 30), '| url | files | examples |');
out('### URL reference rows axiom has that the reference does not'); out();
table(top(urlExtra, 20), '| url | files | examples |');
out('### Attributes carrying URL-looking values that axiom never references (candidates for URL_ATTRIBUTES)'); out();
table(top(urlish, 40), '| tag@attr | occurrences | examples |');
out('### Class token differences'); out();
table([...top(classDiff, 10), ...top(classDiff, 10, -1)], '| class | delta | examples |');
out('### Id differences'); out();
table([...top(idDiff, 10), ...top(idDiff, 10, -1)], '| id | delta | examples |');
out('### Title mismatches'); out();
table(top(titleBad, 20), '| parse5 vs axiom | files | examples |');
out(`### Parse gaps. Files with axiom gaps: ${ok.filter((r) => r.axGaps > 0).length}; with parse5 errors: ${ok.filter((r) => r.refErrors > 0).length}; axiom gaps where parse5 is clean (false positives): ${ok.filter((r) => r.axGaps > 0 && r.refErrors === 0).length}; parse5 errors with no axiom gap: ${ok.filter((r) => r.axGaps === 0 && r.refErrors > 0).length}`); out();
table(top(gapKinds, 20), '| axiom gap kind/head | count | examples |');
out('#### Gap text where parse5 reports no error (digits replaced by #)'); out();
table(top(fpGaps, 40), '| gap | files | examples |');
out('#### parse5 error codes in files where axiom recorded no gap'); out();
table(top(fnGaps, 30), '| parse5 code | files | examples |');
out('#### parse5 error code histogram'); out();
table(top(refErrKinds, 30), '| code | count | examples |');
out('### Template dialects detected'); out();
table(top(dialects, 20), '| dialect | files | examples |');
out('### Inline <style> mismatches (samples)'); out();
table(top(styleSamples, 25), '| sample | files | examples |');

// ───────────────────────────── CSS ─────────────────────────────
const css = load('css-');
out('## CSS');
out();
out('| corpus | sheets | crashes | ax total ms | ref total ms | slowest (ms) | style rules ref/ax | at-rules ref/ax | declarations ref/ax | selectors ref/ax |');
out('|---|---:|---:|---:|---:|---|---|---|---|---|');
const cByCorpus = new Map<string, Rec[]>();
for (const r of css) { const l = cByCorpus.get(r.corpus) ?? []; l.push(r); cByCorpus.set(r.corpus, l); }
for (const [c, rs] of cByCorpus) {
  const okc = rs.filter((r) => r.styleRules);
  const sl = [...okc].sort((a, b) => b.axMs - a.axMs)[0];
  out(`| ${c} | ${rs.length} | ${rs.filter((r) => r.crash).length} | ${sum(okc, (r) => r.axMs)} | ${sum(okc, (r) => r.refMs)} | ${sl ? `${sl.id.slice(0, 40)} (${sl.axMs})` : ''} | ${sum(okc, (r) => r.styleRules[0])}/${sum(okc, (r) => r.styleRules[1])} | ${sum(okc, (r) => r.atrules[0])}/${sum(okc, (r) => r.atrules[1])} | ${sum(okc, (r) => r.declarations[0])}/${sum(okc, (r) => r.declarations[1])} | ${sum(okc, (r) => r.selectors[0])}/${sum(okc, (r) => r.selectors[1])} |`);
}
out();
const cc = css.filter((r) => r.crash);
if (cc.length > 0) { out('### Crashes'); out(); for (const r of cc.slice(0, 20)) out(`- \`${r.corpus}/${r.id}\`: ${r.crash.split('\n')[0]}`); out(); }
const okc = css.filter((r) => r.styleRules);
out('### Coverage totals'); out();
out('| measure | reference | axiom | axiom / reference |'); out('|---|---:|---:|---:|');
const cm: Array<[string, (r: Rec) => number, (r: Rec) => number]> = [
  ['style rules (incl. keyframe blocks)', (r) => r.styleRules[0], (r) => r.styleRules[1]],
  ['nested style rules', (r) => r.nestedStyleRules[0], (r) => r.nestedStyleRules[1]],
  ['at-rules', (r) => r.atrules[0], (r) => r.atrules[1]],
  ['selectors', (r) => r.selectors[0], (r) => r.selectors[1]],
  ['declarations', (r) => r.declarations[0], (r) => r.declarations[1]],
  ['custom property declarations', (r) => r.customProps[0], (r) => r.customProps[1]],
  ['var() references', (r) => r.vars[0], (r) => r.vars[1]],
  ['url() references', (r) => r.urls[0], (r) => r.urls[1]],
  ['@import targets', (r) => r.imports[0], (r) => r.imports[1]],
  ['@keyframes names', (r) => r.keyframesNames[0], (r) => r.keyframesNames[1]],
  ['@font-face families', (r) => r.fontFaces[0], (r) => r.fontFaces[1]],
  ['@layer names', (r) => r.layers[0], (r) => r.layers[1]],
  ['@container names', (r) => r.containers[0], (r) => r.containers[1]],
  ['comments', (r) => r.comments[0], (r) => r.comments[1]],
];
for (const [name, a, b] of cm) { const ra = sum(okc, a); const rb = sum(okc, b); out(`| ${name} | ${ra} | ${rb} | ${pct(rb, ra)} |`); }
out();
out(`Selectors matched by text: ref ${sum(okc, (r) => r.selectors[0])}, missing in axiom ${sum(okc, (r) => r.selectorMissingCount)}, extra in axiom ${sum(okc, (r) => r.selectorExtraCount)}. `
  + `Specificity checked ${sum(okc, (r) => r.specChecked)}, mismatched ${sum(okc, (r) => r.specMismatchCount)}. Selector-part kind counts checked ${sum(okc, (r) => r.partsChecked)}, mismatched ${sum(okc, (r) => r.partsBad)}. `
  + `Declarations missing ${sum(okc, (r) => r.declMissingCount)}, extra ${sum(okc, (r) => r.declExtraCount)}.`);
out();
const selMiss = agg(), selExtra = agg(), specBad = agg(), partsBad = agg(), declMiss = agg(), declExtra = agg(), atDiff = agg(), varD = agg(), urlD = agg(), impD = agg(), kfD = agg(), ffD = agg(), cgap = agg(), cfp = agg(), cfn = agg(), pre = agg(), refErr = agg();
for (const r of okc) {
  const id = `${r.corpus}/${r.id}`;
  for (const k of r.selectorMissing ?? []) add(selMiss, k, 1, id);
  for (const k of r.selectorExtra ?? []) add(selExtra, k, 1, id);
  for (const k of r.specMismatch ?? []) add(specBad, k, 1, id);
  for (const k of r.partsMismatch ?? []) add(partsBad, k, 1, id);
  for (const k of r.declMissing ?? []) add(declMiss, k, 1, id);
  for (const k of r.declExtra ?? []) add(declExtra, k, 1, id);
  for (const [k, v] of Object.entries<number>(r.atruleDiff ?? {})) add(atDiff, k, v, id);
  for (const [k, v] of Object.entries<number>(r.varDiff ?? {})) add(varD, k, v, id);
  for (const [k, v] of Object.entries<number>(r.urlDiff ?? {})) add(urlD, k, v, id);
  for (const [k, v] of Object.entries<number>(r.importDiff ?? {})) add(impD, k, v, id);
  for (const [k, v] of Object.entries<number>(r.keyframesDiff ?? {})) add(kfD, k, v, id);
  for (const [k, v] of Object.entries<number>(r.fontFaceDiff ?? {})) add(ffD, k, v, id);
  for (const [k, v] of Object.entries<number>(r.axGapKinds ?? {})) add(cgap, k, v, id);
  if (r.axGaps > 0 && r.refErrors === 0 && !r.postcssError) for (const g of r.axGapSamples ?? []) add(cfp, g.replace(/L\d+: /, '').replace(/[0-9]+/g, '#').slice(0, 80), 1, id);
  if (r.axGaps === 0 && (r.refErrors > 0 || r.postcssError)) for (const e of [...(r.refErrorSamples ?? []), r.postcssError].filter(Boolean)) add(cfn, String(e).slice(0, 80), 1, id);
  if (r.preprocessor) add(pre, 'preprocessor flagged', 1, id);
  for (const e of r.refErrorSamples ?? []) add(refErr, String(e).replace(/[0-9]+/g, '#').slice(0, 80), 1, id);
}
out('### Selectors in css-tree that axiom has no selector row for (normalised text)'); out(); table(top(selMiss, 40), '| selector | files | examples |');
out('### Selector rows in axiom with no css-tree counterpart'); out(); table(top(selExtra, 40), '| selector | files | examples |');
out('### Specificity mismatches (ref=@bramus/specificity)'); out(); table(top(specBad, 40), '| selector | files | examples |');
out('### Selector-part kind count mismatches (delta = ref - axiom per kind)'); out(); table(top(partsBad, 40), '| selector and delta | files | examples |');
out('### At-rule count differences (positive: css-tree has more)'); out(); table([...top(atDiff, 20), ...top(atDiff, 20, -1)], '| at-rule | delta | examples |');
out(`### Declarations css-tree has that axiom lacks (prop|value|important)`); out(); table(top(declMiss, 50), '| declaration | files | examples |');
out('### Declarations axiom has that css-tree lacks'); out(); table(top(declExtra, 40), '| declaration | files | examples |');
out('### var() / url() / @import / @keyframes / @font-face differences (positive: reference has more)'); out();
table([...top(varD, 10), ...top(varD, 10, -1)], '| var | delta | examples |');
table([...top(urlD, 15), ...top(urlD, 15, -1)], '| url | delta | examples |');
table([...top(impD, 10), ...top(impD, 10, -1)], '| import | delta | examples |');
table([...top(kfD, 10), ...top(kfD, 10, -1)], '| keyframes | delta | examples |');
table([...top(ffD, 10), ...top(ffD, 10, -1)], '| font-face family | delta | examples |');
out(`### Parse gaps. Sheets with axiom gaps: ${okc.filter((r) => r.axGaps > 0).length}; with css-tree errors: ${okc.filter((r) => r.refErrors > 0).length}; postcss throws: ${okc.filter((r) => r.postcssError).length}; axiom gaps where css-tree and postcss are clean (false positives): ${okc.filter((r) => r.axGaps > 0 && r.refErrors === 0 && !r.postcssError).length}; reference errors with no axiom gap: ${okc.filter((r) => r.axGaps === 0 && (r.refErrors > 0 || r.postcssError)).length}; preprocessor-flagged: ${okc.filter((r) => r.preprocessor).length}`); out();
table(top(cgap, 10), '| gap kind | count | examples |');
out('#### Gap text where css-tree and postcss are clean (digits replaced by #)'); out(); table(top(cfp, 60), '| gap | files | examples |');
out('#### Reference errors where axiom recorded no gap'); out(); table(top(cfn, 30), '| error | files | examples |');
out('#### css-tree error histogram'); out(); table(top(refErr, 30), '| error | files | examples |');
table(top(pre, 5), '| preprocessor | files | examples |');

fs.writeFileSync(path.join(R, 'report.md'), lines.join('\n'));
console.log(`wrote ${path.join(R, 'report.md')} (${lines.length} lines)`);
