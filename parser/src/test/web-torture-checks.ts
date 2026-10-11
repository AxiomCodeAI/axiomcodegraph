/**
 * The torture checks. Each one names a construct in `src/test-data/web/torture`, the
 * rows it must have produced, and the verdict when it did not. See web-torture.ts.
 *
 * Line numbers below are the fixture's; a fixture edit moves them, and the check then
 * says so by failing to find the row rather than by passing vacuously (every lookup
 * that comes back empty is a failure).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CssStylesheet } from '@/analysis-types/css/CssStylesheet';
import { CssSourceProvenance, CssStylesheetSource } from '@/enums/css/CssStylesheetSource';
import { CssExtraction, CssParser } from '@/parsers/css/css-parser';
import { HtmlExtraction, HtmlParser } from '@/parsers/html/html-parser';

import { Check, Ir, Row } from './web-torture-ir';

type Fail = (message: string) => void;

const names = (rows: Row[], col = 'name'): string[] => rows.map((r) => r[col]!);
const same = (got: string[], want: string[]): boolean => got.length === want.length && got.every((g, i) => g === want[i]);
function expectList(fail: Fail, what: string, got: string[], want: string[]): void {
  if (!same(got, want)) fail(`${what}: got [${got.join(', ')}], want [${want.join(', ')}]`);
}
type Cell = string | number | boolean | undefined;
function expectEq(fail: Fail, what: string, got: Cell, want: Cell): void {
  if (got !== want) fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
function expectRow(fail: Fail, what: string, row: Row | undefined): row is Row {
  if (row === undefined) fail(`${what}: no row`);
  return row !== undefined;
}
function refSummary(decl: Row, ir: Ir): string[] {
  return ir.refsOfDecl(decl).map((v) => `${v['referenceKind']}:${v['name']}${v['fallbackText'] ? `[${v['fallbackText']}]` : ''}`);
}

// ===========================================================================
// the checks
// ===========================================================================

export const CHECKS: Check[] = [
  // ── integrity of the whole output ─────────────────────────────────────────
  {
    name: 'integrity: every key unique, every link lands on a row of the right relation, one owner per declaration',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const TARGET: Record<string, string> = {
        documentLinkHash: 'HTML_DOCUMENTS', htmlDocumentLinkHash: 'HTML_DOCUMENTS', ownerElementLinkHash: 'HTML_ELEMENTS',
        parentElementLinkHash: 'HTML_ELEMENTS', relatedElementLinkHash: 'HTML_ELEMENTS', ownerHtmlElementLinkHash: 'HTML_ELEMENTS',
        attributeLinkHash: 'HTML_ATTRIBUTES', htmlAttributeLinkHash: 'HTML_ATTRIBUTES', referenceLinkHash: 'HTML_REFERENCES',
        stylesheetLinkHash: 'CSS_STYLESHEETS', ruleLinkHash: 'CSS_RULES', parentRuleLinkHash: 'CSS_RULES', relatedRuleLinkHash: 'CSS_RULES',
        ownerRuleLinkHash: 'CSS_RULES', selectorLinkHash: 'CSS_SELECTORS', parentPartLinkHash: 'CSS_SELECTOR_PARTS', ownerDeclarationLinkHash: 'CSS_DECLARATIONS',
      };
      const keys = new Map<string, Set<string>>();
      for (const [table, rows] of Object.entries(ir.tables)) {
        if (table.startsWith('SKIPPED') || rows.length === 0) continue;
        const keyCol = Object.keys(rows[0]!).find((c) => c.endsWith('UniqueHash'))!;
        const seen = new Set<string>();
        for (const r of rows) {
          if (seen.has(r[keyCol]!)) fail(`${table}: duplicate key ${r[keyCol]}`);
          seen.add(r[keyCol]!);
        }
        keys.set(table, seen);
      }
      for (const [table, rows] of Object.entries(ir.tables)) {
        if (table.startsWith('SKIPPED') || rows.length === 0) continue;
        for (const col of Object.keys(rows[0]!)) {
          const target = TARGET[col];
          if (target === undefined) continue;
          const dangling = rows.filter((r) => r[col] !== '' && !(keys.get(target) ?? new Set()).has(r[col]!)).length;
          if (dangling > 0) fail(`${table}.${col}: ${dangling} link(s) to no ${target} row`);
        }
      }
      for (const d of ir.declarations) {
        if ((d['ruleLinkHash'] === '') === (d['htmlAttributeLinkHash'] === '')) { fail('a css_declaration has zero or two owners'); break; }
      }
      for (const v of ir.valueRefs) {
        if ((v['ownerDeclarationLinkHash'] === '') === (v['ownerRuleLinkHash'] === '')) { fail('a css_value_reference has zero or two owners'); break; }
      }
      if (ir.documents.length !== 9) fail(`${ir.documents.length} documents, expected 9`);
      if (ir.stylesheets.filter((s) => s['sourceKind'] === 'FILE').length !== 24) fail(`${ir.stylesheets.filter((s) => s['sourceKind'] === 'FILE').length} css files, expected 24`);
    },
  },

  // ── documents ─────────────────────────────────────────────────────────────
  {
    name: 'documents: kind, doctype, lang, title and dialect set per page',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const index = ir.doc('index.html');
      expectEq(fail, 'index kind', index['documentKind'], 'DOCUMENT');
      expectEq(fail, 'index lang', index['lang'], 'en');
      expectEq(fail, 'index title', index['title'], 'Torture: the main page');
      for (const d of ['ALPINE', 'ANGULAR', 'HANDLEBARS', 'MUSTACHE', 'VUE', 'HTMX', 'ERB', 'DOLLAR_BRACE']) {
        if (!index['templateDialects']!.split(',').includes(d)) fail(`index dialects lack ${d}: ${index['templateDialects']}`);
      }
      expectEq(fail, 'jinja kind', ir.doc('templates/jinja.html')['documentKind'], 'FRAGMENT');
      expectEq(fail, 'jinja dialects', ir.doc('templates/jinja.html')['templateDialects'], 'JINJA,MUSTACHE');
      expectEq(fail, 'tailwind kind', ir.doc('templates/tailwind.html')['documentKind'], 'FRAGMENT');
      expectEq(fail, 'mixed kind (has <html>)', ir.doc('templates/mixed.html')['documentKind'], 'DOCUMENT');
      for (const d of ['THYMELEAF', 'RAZOR', 'PHP', 'ANGULAR', 'VUE', 'ALPINE', 'HTMX', 'ERB']) {
        if (!ir.doc('templates/mixed.html')['templateDialects']!.split(',').includes(d)) fail(`mixed dialects lack ${d}`);
      }
      const xhtml = ir.doc('xhtml/page.xhtml');
      if (!xhtml['doctype']!.startsWith('html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"')) fail(`xhtml doctype ${xhtml['doctype']}`);
      expectEq(fail, 'xhtml lang', xhtml['lang'], 'en');
      expectEq(fail, 'svg page title is the HTML <title>, not the SVG one', ir.doc('svg.html')['title'], 'Torture: foreign content');
      expectEq(fail, 'quirks (BOM, CRLF) title', ir.doc('quirks.html')['title'], 'Quirks');
      expectEq(fail, 'index inline style count (text/less skipped, empty kept)', ir.doc('index.html')['inlineStyleCount'], '5');
      expectEq(fail, 'index stylesheet link count', ir.doc('index.html')['stylesheetReferenceCount'], '9');
    },
  },
  {
    name: 'documents: a Razor URL helper in an attribute marks the page RAZOR',
    verdict: 'GAP',
    note: 'The RAZOR marker needs whitespace or > before @; `href="@Url.Action(...)"` has a quote. Widen the marker to attribute-value starts.',
    run: (ir, fail) => {
      if (!ir.doc('index.html')['templateDialects']!.split(',').includes('RAZOR')) fail('index.html has @Url.Action("Index") and no RAZOR dialect');
      expectEq(fail, '@Url.Action url kind', ir.ref('index.html', '@Url.Action("Index")')?.['urlKind'], 'TEMPLATE_EXPRESSION');
    },
  },

  // ── page → stylesheet ─────────────────────────────────────────────────────
  {
    name: 'page→sheet: a resolved <link rel=stylesheet> carries the css_stylesheet.filePath join key',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const r = ir.ref('forms.html', 'css/app.css');
      if (!expectRow(fail, 'forms.html link', r)) return;
      expectEq(fail, 'kind', r['referenceKind'], 'STYLESHEET');
      expectEq(fail, 'resolved', r['isResolved'], 'true');
      expectEq(fail, 'resolvedFilePath = css_stylesheet.filePath', r['resolvedFilePath'], ir.sheet('css/app.css')['filePath']);
      const other = ir.ref('shadow/shadow.html', '../css/app.css');
      expectEq(fail, 'shadow/../css/app.css resolved', other?.['resolvedFilePath'], ir.sheet('css/app.css')['filePath']);
      expectEq(fail, 'xhtml link resolved', ir.ref('xhtml/page.xhtml', '../css/app.css')?.['isResolved'], 'true');
      expectEq(fail, 'quirks (CRLF+BOM) link resolved', ir.ref('quirks.html', 'css/app.css')?.['isResolved'], 'true');
    },
  },
  {
    name: 'page→sheet: <base href="/static/"> re-roots every relative URL on the page (href, src, srcset, @import, url())',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      expectEq(fail, 'base recorded', ir.ref('index.html', '/static/')?.['referenceKind'], 'BASE');
      expectEq(fail, 'css/app.css under base does NOT resolve (static/css/app.css is absent)', ir.ref('index.html', 'css/app.css')?.['isResolved'], 'false');
      expectEq(fail, '../css/app.css under base resolves to /css/app.css', ir.ref('index.html', '../css/app.css')?.['resolvedFilePath'], ir.sheet('css/app.css')['filePath']);
      expectEq(fail, 'js/vendor.js under base unresolved', ir.ref('index.html', 'js/vendor.js')?.['isResolved'], 'false');
      expectEq(fail, 'img/logo.png under base unresolved', ir.ref('index.html', 'img/logo.png', 'src')?.['isResolved'], 'false');
    },
  },
  {
    name: 'page→sheet: <base href> applies to the CSS written in the page too (a <style> @import and a style="url()" resolve against the base, as in a browser)',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const imp = ir.valueRefsOfSheet('index.html#style4', 'IMPORT')[0];
      expectEq(fail, '<style> @import "css/imported-by-style.css" under base', imp?.['isResolved'], 'false');
      const bg = ir.styleAttrDeclsAtLine('index.html', 100)[0];
      const url = bg === undefined ? undefined : ir.refsOfDecl(bg)[0];
      expectEq(fail, 'style="background: url(img/bg.png)" under base (href on the same page is unresolved, this is resolved)', url?.['isResolved'], 'false');
    },
  },
  {
    name: 'page→sheet: link variants — query/fragment stripped, alternate/print/disabled still STYLESHEET, no-rel and preload are LINK_RESOURCE, REL is case-insensitive',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const q = ir.ref('index.html', 'css/base.css?v=abc123#frag');
      if (expectRow(fail, 'query link', q)) {
        expectEq(fail, 'path', q['path'], 'css/base.css');
        expectEq(fail, 'query', q['query'], 'v=abc123');
        expectEq(fail, 'fragment', q['fragment'], 'frag');
        expectEq(fail, 'kind', q['referenceKind'], 'STYLESHEET');
      }
      expectEq(fail, 'alternate', ir.ref('index.html', 'css/alt.css')?.['referenceKind'], 'STYLESHEET');
      const altLink = ir.element('index.html', '/head[1]/link[2]');
      expectEq(fail, 'alternate rel attribute kept for the engine to exclude', altLink && ir.attr(altLink, 'rel')?.['value'], 'alternate stylesheet');
      expectEq(fail, 'print media link', ir.ref('index.html', 'css/print.css')?.['referenceKind'], 'STYLESHEET');
      const printLink = ir.element('index.html', '/head[1]/link[3]');
      expectEq(fail, 'media attribute kept', printLink && ir.attr(printLink, 'media')?.['value'], 'print');
      expectEq(fail, 'disabled link', ir.ref('index.html', 'css/disabled.css')?.['referenceKind'], 'STYLESHEET');
      expectEq(fail, 'preload as=style', ir.ref('index.html', 'css/base.css', 'href')?.['referenceKind'], 'LINK_RESOURCE');
      expectEq(fail, 'no rel', ir.ref('index.html', 'css/norel.css')?.['referenceKind'], 'LINK_RESOURCE');
      expectEq(fail, 'REL="StyleSheet"', ir.ref('index.html', 'css/upper.css')?.['referenceKind'], 'STYLESHEET');
      expectEq(fail, 'icon', ir.ref('index.html', 'img/favicon.ico')?.['referenceKind'], 'LINK_RESOURCE');
      expectEq(fail, 'modulepreload', ir.ref('index.html', 'js/module.js', 'href')?.['referenceKind'], 'LINK_RESOURCE');
      expectEq(fail, '<link> inside <noscript> is read', ir.ref('index.html', 'css/noscript.css')?.['referenceKind'], 'STYLESHEET');
      if (ir.ref('index.html', 'css/ie.css') !== undefined) fail('a <link> inside a conditional comment produced a reference');
    },
  },
  {
    name: 'page→sheet: an ambiguous root-relative URL (two candidate web roots) is left unresolved',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const r = ir.ref('index.html', '/css/dup.css');
      expectEq(fail, 'kind', r?.['urlKind'], 'ROOT_RELATIVE');
      expectEq(fail, 'unresolved', r?.['isResolved'], 'false');
      if (ir.stylesheets.filter((s) => s['fileName'] === 'dup.css').length !== 2) fail('both dup.css files should be stylesheet rows');
    },
  },
  {
    name: 'page→sheet: @import closure — every import of app.css is a value reference whose resolvedFilePath is a css_stylesheet.filePath',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const imports = ir.valueRefsOfSheet('css/app.css', 'IMPORT');
      expectList(fail, 'import targets in order', names(imports),
        ['tokens.css', 'layers.css', 'nested.css', 'missing.css', 'https://fonts.example.com/inter.css', 'strings.css', 'fonts.css', 'selectors.css', 'gaps.css', 'app.css']);
      for (const v of imports) {
        const expectResolved = v['name'] !== 'missing.css' && v['urlKind'] === 'RELATIVE';
        expectEq(fail, `${v['name']} resolved`, v['isResolved'], expectResolved ? 'true' : 'false');
        if (expectResolved) expectEq(fail, `${v['name']} joins a sheet`, v['resolvedFilePath'], ir.sheet(`css/${v['name']}`)['filePath']);
        if (v['ownerRuleLinkHash'] === '' || ir.row(v['ownerRuleLinkHash'])?.['atRuleName'] !== 'import') fail(`${v['name']} is not owned by an @import rule`);
      }
      expectEq(fail, 'absolute import kind', imports.find((v) => v['name']!.startsWith('https'))?.['urlKind'], 'ABSOLUTE');
      // The layer of an import is a LAYER reference on the same rule, after the target.
      const first = ir.row(imports[0]!['ownerRuleLinkHash']!)!;
      expectList(fail, '@import url("tokens.css") layer(tokens) references', ir.refsOfRule(first).map((v) => `${v['referenceKind']}:${v['name']}`), ['IMPORT:tokens.css', 'LAYER:tokens']);
      expectEq(fail, 'tokens → theme', ir.valueRefsOfSheet('css/tokens.css', 'IMPORT')[0]?.['resolvedFilePath'], ir.sheet('css/theme.css')['filePath']);
      expectEq(fail, 'theme → tokens (cycle, still a fact)', ir.valueRefsOfSheet('css/theme.css', 'IMPORT')[0]?.['resolvedFilePath'], ir.sheet('css/tokens.css')['filePath']);
      expectEq(fail, '@import after rules (gaps.css "late.css") still recorded', ir.valueRefsOfSheet('css/gaps.css', 'IMPORT')[0]?.['name'], 'late.css');
      const layered = ir.valueRefsOfSheet('css/layers.css').filter((v) => v['referenceKind'] === 'IMPORT' || (v['referenceKind'] === 'LAYER' && v['name'] === 'print-layer'));
      expectList(fail, 'layers.css imports with layer()', layered.map((v) => `${v['referenceKind']}:${v['name']}`), ['IMPORT:print.css', 'LAYER:print-layer', 'IMPORT:alt.css']);
    },
  },
  {
    name: 'page→sheet: inline <style> elements — one sheet per element, owner link, host-file positions, type/media attributes',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const s1 = ir.sheet('index.html#style1');
      expectEq(fail, 'style1 start line', s1['startLine'], '36');
      expectEq(fail, 'style1 start column (after <style>)', s1['startColumn'], '10');
      expectEq(fail, 'style1 owner is the <style> element', ir.row(s1['ownerHtmlElementLinkHash'])?.['path'], '/html[1]/head[1]/style[1]');
      expectEq(fail, 'style1 document link', s1['htmlDocumentLinkHash'], ir.doc('index.html')['htmlDocumentUniqueHash']);
      expectEq(fail, 'first declaration cited on the host line', ir.declAtLine('index.html#style1', 37, 'color')?.['valueText'], 'red');
      expectEq(fail, 'print <style media>', ir.row(ir.sheet('index.html#style2')['ownerHtmlElementLinkHash']) && ir.attr(ir.row(ir.sheet('index.html#style2')['ownerHtmlElementLinkHash'])!, 'media')?.['value'], 'print');
      expectEq(fail, 'empty <style> is a sheet with 0 rules', ir.sheet('index.html#style3')['ruleCount'], '0');
      if (ir.stylesheets.some((s) => s['sourceKind'] === 'HTML_STYLE_ELEMENT' && ir.row(s['ownerHtmlElementLinkHash'])?.['startLine'] === '46')) fail('<style type="text/less"> became a sheet');
      expectEq(fail, '<style> inside <template> is a sheet (owner path says it is inert)', ir.row(ir.sheet('index.html#style5')['ownerHtmlElementLinkHash'])?.['path'], '/html[1]/body[1]/div[10]/template[1]/div[1]/style[1]');
      // shadow roots: seven inline sheets, each owned by a style whose ancestry an engine can read
      expectEq(fail, 'shadow.html inline sheets', ir.doc('shadow/shadow.html')['inlineStyleCount'], '7');
      expectEq(fail, 'shadow style owner inside the declarative template', ir.row(ir.sheet('shadow/shadow.html#style2')['ownerHtmlElementLinkHash'])?.['path'], '/html[1]/body[1]/my-card[1]/template[1]/style[1]');
      const shadowTemplates = ir.ofDoc(ir.attributes, 'shadow/shadow.html').filter((a) => a['name'] === 'shadowrootmode');
      expectList(fail, 'shadowrootmode attributes (the scope key)', shadowTemplates.map((a) => `${a['value']}@${ir.row(a['ownerElementLinkHash'])?.['path']}`),
        ['open@/html[1]/body[1]/my-card[1]/template[1]', 'closed@/html[1]/body[1]/my-card[2]/template[1]', 'open@/html[1]/body[1]/outer-el[1]/template[1]', 'open@/html[1]/body[1]/outer-el[1]/template[1]/inner-el[1]/template[1]']);
    },
  },
  {
    name: 'page→sheet: <style> and <script> inside inline <svg> produce sheet and script rows (browsers apply and run them)',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const svgStyle = ir.element('svg.html', '/svg[1]/style[1]');
      if (!ir.stylesheets.some((s) => s['ownerHtmlElementLinkHash'] === svgStyle?.['htmlElementUniqueHash'])) fail('svg.html <svg><style> has no css_stylesheet row');
      if (!ir.ofDoc(ir.scripts, 'svg.html').some((s) => s['scriptKind'] === 'INLINE')) fail('svg.html <svg><script> has no html_script row');
    },
  },
  {
    name: 'page→sheet: a <style> wrapped in <![CDATA[ ]]> (XHTML) still yields its rule',
    verdict: 'GAP',
    note: 'Strip CDATA markers from <style> and <script> bodies of .xhtml files before handing them on.',
    run: (ir, fail) => {
      expectEq(fail, 'page.xhtml#style1 rules', ir.sheet('xhtml/page.xhtml#style1')['ruleCount'], '1');
    },
  },
  {
    name: 'page→sheet: provenance and bulk — 93KB sheet read in full, one-line sheet MINIFIED, BOM stripped, gap caps reached',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      expectEq(fail, 'big.css rules', ir.sheet('css/big.css')['ruleCount'], '1500');
      expectEq(fail, 'big.css declarations', ir.sheet('css/big.css')['declarationCount'], '3000');
      expectEq(fail, 'long-line.css provenance', ir.sheet('css/long-line.css')['sourceProvenance'], 'MINIFIED');
      expectEq(fail, 'vendor.min.css provenance', ir.sheet('css/vendor.min.css')['sourceProvenance'], 'MINIFIED');
      expectEq(fail, 'bom.css rule read (BOM stripped)', ir.sheet('css/bom.css')['ruleCount'], '1');
      expectEq(fail, 'bom.css first selector column', ir.selector('css/bom.css', '.bom-class')?.['startColumn'], '1');
      const capped = ir.cssGapsOf('css/gaps-many.css');
      expectEq(fail, 'gaps-many.css gap rows (200 + 1 summary)', capped.length, 201);
      expectEq(fail, 'gaps-many.css summary row', capped.filter((g) => g['gapKind'] === 'GAP_LIMIT_REACHED').length, 1);
      const quirks = ir.ofDoc(ir.htmlGaps, 'quirks.html');
      expectEq(fail, 'quirks.html gap rows', quirks.length, 201);
      expectEq(fail, 'quirks.html summary row', quirks.filter((g) => g['gapKind'] === 'GAP_LIMIT_REACHED').length, 1);
      expectEq(fail, 'quirks.html CRLF line numbers (first div)', ir.element('quirks.html', '/body[1]/div[1]')?.['startLine'], '7');
      expectEq(fail, 'quirks.html element after 250 stray tags', ir.element('quirks.html', '/body[1]/p[1]')?.['startLine'], '260');
      expectEq(fail, 'sassy.css flagged PREPROCESSOR_SYNTAX', ir.cssGapsOf('css/sassy.css').some((g) => g['gapKind'] === 'PREPROCESSOR_SYNTAX'), true);
    },
  },

  // ── class / id / tag join keys ────────────────────────────────────────────
  {
    name: 'class keys: class attribute tokenised on ASCII whitespace, entities decoded, case kept, duplicates kept, valueless and empty yield none',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      expectList(fail, 'line 52 (spaces, tab entity, newline, dup)', ir.classesAtLine('index.html', 52), ['spaced', 'tabbed', 'multi-line', 'dup', 'dup']);
      expectList(fail, 'line 54 valueless', ir.classesAtLine('index.html', 54), []);
      expectList(fail, 'line 55 empty', ir.classesAtLine('index.html', 55), []);
      expectList(fail, 'line 56 entities', ir.classesAtLine('index.html', 56), ['a&b', '<c>', '"q"']);
      expectList(fail, 'line 57 case', ir.classesAtLine('index.html', 57), ['Upper', 'lower', 'MIXED']);
      expectList(fail, 'line 58 CLASS= on <DIV>', ir.classesAtLine('index.html', 58), ['SHOUT']);
      expectList(fail, 'line 59 duplicate class attribute: first wins', ir.classesAtLine('index.html', 59), ['first']);
      if (!ir.ofDoc(ir.htmlGaps, 'index.html').some((g) => g['startLine'] === '59' && g['detail'] === 'duplicate-attribute')) fail('no duplicate-attribute gap on line 59');
      const el = ir.elementsAtLine('index.html', 58)[0];
      expectEq(fail, '<DIV> tag lowercased', el?.['tagName'], 'div');
      expectEq(fail, 'ID="LOUD" kept', el?.['id'], 'LOUD');
      expectEq(fail, 'id="  padded-id  " trimmed on the element', ir.elementsAtLine('index.html', 52)[0]?.['id'], 'padded-id');
      expectEq(fail, 'id attribute value raw', ir.attr(ir.elementsAtLine('index.html', 52)[0]!, 'id')?.['value'], '  padded-id  ');
      expectEq(fail, 'classNames column agrees with the tokens', ir.elementsAtLine('index.html', 52)[0]?.['classNames'], 'spaced,tabbed,multi-line,dup,dup');
    },
  },
  {
    name: 'class keys: template-bearing class attributes keep the static tokens and drop the template parts',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      expectList(fail, 'jinja line 8', ir.classesAtLine('templates/jinja.html', 8), ['card', 'is-active']);
      expectList(fail, 'jinja line 12 ({{ … }} only)', ir.classesAtLine('templates/jinja.html', 12), []);
      expectList(fail, 'index line 86 ({{ cls }} static-class)', ir.classesAtLine('index.html', 86), ['static-class']);
      expectList(fail, 'mixed line 14 (<%= cls %>)', ir.classesAtLine('templates/mixed.html', 14), []);
      expectList(fail, 'mixed line 15 (<?= $cls ?>)', ir.classesAtLine('templates/mixed.html', 15), []);
    },
  },
  {
    name: 'class keys: CSS escapes are decoded so .md\\:flex joins class="md:flex" — every Tailwind token has a CLASS part',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const tokens = ir.ofDoc(ir.classRefs, 'templates/tailwind.html').map((c) => c['className']!);
      const parts = new Set([...ir.partsOfSheet('templates/tailwind.html#style1'), ...ir.partsOfSheet('index.html#style1'), ...ir.partsOfSheet('css/selectors.css')]
        .filter((p) => p['partKind'] === 'CLASS').map((p) => p['name']!));
      for (const t of tokens) if (!parts.has(t)) fail(`class token ${JSON.stringify(t)} has no CLASS selector part`);
      const sel = names(ir.partsOfSheet('css/selectors.css').filter((p) => p['partKind'] === 'CLASS'));
      for (const want of ['md:flex', 'w-1/2', '123', '10', '-mt-2', 'a b', '@media', '#hash', '.dot', '\\backslash', 'café', 'a,b', 'a>b', 'a&b', '!font-bold', '2xl:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]']) {
        if (!sel.includes(want)) fail(`selectors.css lacks decoded CLASS ${JSON.stringify(want)}`);
      }
      expectEq(fail, '\\3A and \\00003A both decode to md:flex', sel.filter((n) => n === 'md:flex').length, 3);
      expectEq(fail, '#\\31 23 decodes', ir.partsOfSheet('css/selectors.css').find((p) => p['partKind'] === 'ID' && p['name'] === '123') !== undefined, true);
      expectEq(fail, '[data-x\\:y] decodes', ir.partsOfSheet('css/selectors.css').find((p) => p['partKind'] === 'ATTRIBUTE' && p['name'] === 'data-x:y') !== undefined, true);
    },
  },
  {
    name: 'class keys: non-ASCII identifiers (.日本語, .🚀, .emoji-🚀) are read as class selectors, not as parse errors that leak the next property name as a CLASS part',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const idx = names(ir.partsOfSheet('index.html#style1').filter((p) => p['partKind'] === 'CLASS'));
      if (!idx.includes('日本語')) fail(`index#style1 has no CLASS 日本語: ${idx.join(', ')}`);
      if (!idx.includes('emoji-🚀')) fail(`index#style1 has no CLASS emoji-🚀: ${idx.join(', ')}`);
      if (idx.includes('font-weight')) fail('index#style1 has a false CLASS part "font-weight" (the property after the unreadable selector)');
      const sel = names(ir.partsOfSheet('css/selectors.css').filter((p) => p['partKind'] === 'CLASS'));
      if (sel.includes('color')) fail('selectors.css has a false CLASS part "color" after .🚀');
      if (!sel.includes('🚀')) fail('selectors.css lacks CLASS 🚀 written literally');
    },
  },
  {
    name: 'id/tag keys: ids and tags of foreign content — SVG tag names keep their case, classes on SVG elements are class references, MathML is its own namespace',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      expectEq(fail, 'foreignObject tag case kept', ir.element('svg.html', '/svg[1]/foreignObject[1]')?.['namespace'], 'SVG');
      expectEq(fail, 'div inside foreignObject is HTML again', ir.element('svg.html', '/foreignObject[1]/div[1]')?.['namespace'], 'HTML');
      expectEq(fail, 'svg inside foreignObject is SVG again', ir.element('svg.html', '/foreignObject[1]/svg[1]')?.['namespace'], 'SVG');
      // The HTML tokenizer lowercases attribute names in foreign content too (only an .xhtml
      // document is case-sensitive), so `CLASS=` and `ID=` on an SVG <rect> are its class and id.
      expectEq(fail, 'ID="…" on an SVG element in an HTML document is the id', ir.element('svg.html', '/svg[1]/rect[1]')?.['id'], 'Case-Kept-Id');
      expectEq(fail, 'math namespace', ir.element('svg.html', '/math[1]')?.['namespace'], 'MATHML');
      expectEq(fail, 'annotation-xml child is HTML', ir.element('svg.html', '/annotation-xml[1]/div[1]')?.['namespace'], 'HTML');
      expectList(fail, 'svg.html class tokens', ir.ofDoc(ir.classRefs, 'svg.html').map((c) => c['className']!),
        ['icon', 'symbol-class', 'svg-rect', 'use-class', 'Case-Kept', 'in-foreign', 'nested-svg', 'nested-rect', 'uses-gradient', 'math-class', 'in-annotation', 'icon']);
      expectEq(fail, 'xlink:href prefix split in SVG', ir.ofDoc(ir.attributes, 'svg.html').find((a) => a['prefix'] === 'xlink' && a['name'] === 'href')?.['attributeKind'], 'URL');
      expectEq(fail, 'xmlns:xlink is NAMESPACE', ir.ofDoc(ir.attributes, 'svg.html').find((a) => a['prefix'] === 'xmlns')?.['attributeKind'], 'NAMESPACE');
    },
  },
  {
    name: 'id/tag keys: a namespaced or camelCase type selector carries a join key an element row can match',
    verdict: 'GAP',
    note: 'TYPE parts are lowercased (`foreignobject`) while element rows keep foreign case (`foreignObject`), and a browser matches type selectors against foreign elements case-sensitively. Keep a lowercase join form on the element, or compare case-insensitively for foreign elements.',
    run: (ir, fail) => {
      const parts = ir.partsOfSheet('svg.html#style1');
      const ns = parts.find((p) => p['partKind'] === 'TYPE' && p['name']!.includes('|'));
      if (ns !== undefined) fail(`TYPE part name ${JSON.stringify(ns['name'])} is not an html_element.tagName`);
      const fo = parts.find((p) => p['partKind'] === 'TYPE' && p['name'] === 'foreignobject');
      if (fo !== undefined && !ir.elements.some((e) => e['tagName'] === 'foreignobject')) fail('TYPE part "foreignobject" matches no element row (elements keep "foreignObject")');
    },
  },
  {
    name: 'selector keys: a class after a namespaced type (svg|rect.svg-rect) is its own CLASS part, and the prefix is the type part\'s value',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const sel = ir.selector('css/app.css', 'svg|rect.svg-rect');
      if (!expectRow(fail, 'selector', sel)) return;
      expectList(fail, 'parts', ir.partsOf(sel).map((p) => `${p['partKind']}:${p['name']}`), ['TYPE:rect', 'CLASS:svg-rect']);
      expectEq(fail, 'namespace prefix as the type part\'s value', ir.partsOf(sel)[0]?.['value'], 'svg|');
    },
  },

  // ── selectors ─────────────────────────────────────────────────────────────
  {
    name: 'selectors: combinators land on the first part of the compound they precede, for every combinator and across whitespace shapes',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const combs = (text: string): string[] => {
        const s = ir.selector('css/app.css', text);
        return s === undefined ? ['<no selector>'] : ir.partsOf(s).map((p) => `${p['combinatorBefore']}@${p['compoundIndex']}:${p['name']}`);
      };
      expectList(fail, '.a>.b+.c~.d', combs('.a>.b+.c~.d'), ['NONE@0:a', 'CHILD@1:b', 'NEXT_SIBLING@2:c', 'SUBSEQUENT_SIBLING@3:d']);
      expectList(fail, 'h2 + p ~ em > b', combs('h2 + p ~ em > b'), ['NONE@0:h2', 'NEXT_SIBLING@1:p', 'SUBSEQUENT_SIBLING@2:em', 'CHILD@3:b']);
      expectList(fail, '.a .b .c .d (spaces, tab, newline)', combs('.a .b .c .d'), ['NONE@0:a', 'DESCENDANT@1:b', 'DESCENDANT@2:c', 'DESCENDANT@3:d']);
      expectList(fail, 'comment inside a compound', combs('.card/* comment in a selector */.is-active'), ['NONE@0:card', 'NONE@0:is-active']);
      expectEq(fail, 'a a', ir.selector('css/app.css', 'a a')?.['compoundCount'], '2');
    },
  },
  {
    name: 'selectors: functional pseudo-classes nest their argument selectors as child parts with depth and parent link',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const tree = (sheet: string, text: string): string[] => {
        const s = ir.selector(sheet, text);
        return s === undefined ? ['<no selector>'] : ir.partsOf(s).map((p) => `${'  '.repeat(Number(p['depth']))}${p['partKind']}:${p['name']}@${p['compoundIndex']}${p['parentPartLinkHash'] === '' ? '' : '^' + ir.row(p['parentPartLinkHash'])?.['name']}`);
      };
      expectList(fail, ':is(.card, .nav) .item', tree('css/app.css', ':is(.card, .nav) .item'), ['PSEUDO_CLASS:is@0', '  CLASS:card@0^is', '  CLASS:nav@0^is', 'CLASS:item@1']);
      expectList(fail, '.card:not(.is-active, #section-one)', tree('css/app.css', '.card:not(.is-active, #section-one)'), ['CLASS:card@0', 'PSEUDO_CLASS:not@0', '  CLASS:is-active@0^not', '  ID:section-one@0^not']);
      expectList(fail, ':not(:is(.a, .b))', tree('css/app.css', ':not(:is(.a, .b))'), ['PSEUDO_CLASS:not@0', '  PSEUDO_CLASS:is@0^not', '    CLASS:a@0^is', '    CLASS:b@0^is']);
      expectList(fail, '::slotted(.slotted-item)', tree('css/app.css', '::slotted(.slotted-item)'), ['PSEUDO_ELEMENT:slotted@0', '  CLASS:slotted-item@0^slotted']);
      expectList(fail, ':host(.featured)', tree('css/app.css', ':host(.featured)'), ['PSEUDO_CLASS:host@0', '  CLASS:featured@0^host']);
      expectList(fail, 'my-card::part(title)', tree('css/app.css', 'my-card::part(title)'), ['TYPE:my-card@0', 'PSEUDO_ELEMENT:part@0']);
      expectEq(fail, '::part(title) value', ir.partsOf(ir.selector('css/app.css', 'my-card::part(title)')!)[1]?.['value'], 'title');
      expectList(fail, ':lang(en) takes a keyword, not a selector', tree('css/app.css', ':lang(en)'), ['PSEUDO_CLASS:lang@0']);
      expectList(fail, '.card:has(> .item:hover, + .nav)', tree('css/app.css', '.card:has(> .item:hover, + .nav)'), ['CLASS:card@0', 'PSEUDO_CLASS:has@0', '  CLASS:item@0^has', '  PSEUDO_CLASS:hover@0^has', '  CLASS:nav@1^has']);
    },
  },
  {
    name: 'selectors: the selector after `of` in :nth-child(An+B of S) is read with its own names and positions',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const s = ir.selector('css/app.css', 'li:nth-child(2n + 1 of .li-one, .li-two)');
      if (!expectRow(fail, 'selector', s)) return;
      const args = ir.partsOf(s).filter((p) => Number(p['depth']) === 1);
      expectList(fail, 'argument parts', args.map((p) => `${p['partKind']}:${p['name']}`), ['CLASS:li-one', 'CLASS:li-two']);
      for (const p of args) if (p['startLine'] !== '57') fail(`argument part ${p['name']} cited at line ${p['startLine']}, the selector is on 57`);
    },
  },
  {
    name: 'selectors: attribute parts carry name, matcher, unquoted value and flag; namespaced attribute names keep the prefix',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const attr = (text: string): string => {
        const p = ir.partsOf(ir.selector('css/app.css', text)!).find((x) => x['partKind'] === 'ATTRIBUTE');
        return p === undefined ? '<none>' : `${p['name']}|${p['attributeMatcher']}|${p['value']}|${p['attributeFlags']}`;
      };
      expectEq(fail, '[data-page]', attr('[data-page]'), 'data-page|||');
      expectEq(fail, '[data-page="index"]', attr('[data-page="index"]'), 'data-page|=|index|');
      expectEq(fail, '[data-page=index]', attr('[data-page=index]'), 'data-page|=|index|');
      expectEq(fail, '[class~="card"]', attr('[class~="card"]'), 'class|~=|card|');
      expectEq(fail, '[class$="wide" i]', attr('[class$="wide" i]'), 'class|$=|wide|i');
      expectEq(fail, '[class$="wide" s]', attr('[class$="wide" s]'), 'class|$=|wide|s');
      expectEq(fail, '[id|="section"]', attr('[id|="section"]'), 'id||=|section|');
      expectEq(fail, '[xlink|href]', attr('[xlink|href]'), 'xlink|href|||');
      expectEq(fail, 'input[type="IMAGE" i]', attr('input[type="IMAGE" i]'), 'type|=|IMAGE|i');
      expectEq(fail, '[style*="var("]', attr('[style*="var("]'), 'style|*=|var(|');
      expectEq(fail, '[data-x="a\\"b"] (selectors.css)', ir.partsOfSheet('css/selectors.css').find((p) => p['partKind'] === 'ATTRIBUTE' && p['name'] === 'data-x')?.['value'], 'a"b');
    },
  },
  {
    name: 'selectors: specificity per Selectors 4 (:where 0, :is/:not by argument, nth-child(of) counts itself, pseudo-elements, legacy single colon)',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const spec = (text: string): string => {
        const s = ir.selector('css/app.css', text);
        return s === undefined ? '<none>' : `${s['specificityA']},${s['specificityB']},${s['specificityC']}`;
      };
      expectEq(fail, '#section-one', spec('#section-one'), '1,0,0');
      expectEq(fail, '.card.card--wide.is-active', spec('.card.card--wide.is-active'), '0,3,0');
      expectEq(fail, ':where(…)', spec(':where(.card.card--wide.is-active#section-one)'), '0,0,0');
      expectEq(fail, ':is(#section-one, .card)', spec(':is(#section-one, .card)'), '1,0,0');
      expectEq(fail, '.card:not(#nope)', spec('.card:not(#nope)'), '1,1,0');
      expectEq(fail, 'li:nth-child(2n + 1 of .li-one, .li-two)', spec('li:nth-child(2n + 1 of .li-one, .li-two)'), '0,2,1');
      expectEq(fail, ':host(.featured)', spec(':host(.featured)'), '0,2,0');
      expectEq(fail, 'div#b.c[x]:hover::before', spec('div#b.c[x]:hover::before'), '1,3,2');
      expectEq(fail, 'DIV.Card:HOVER::BEFORE', spec('DIV.Card:HOVER::BEFORE'), '0,2,2');
      expectEq(fail, ':after (legacy) is a pseudo-element', spec(':after'), '0,0,1');
      expectEq(fail, ':first-letter (legacy)', spec(':first-letter'), '0,0,1');
      expectEq(fail, 'a a', spec('a a'), '0,0,2');
      expectEq(fail, '.a.b.c.d.e.f.g.h.i.j.k', spec('.a.b.c.d.e.f.g.h.i.j.k'), '0,11,0');
      expectEq(fail, 'hasPseudoElement on ::before', ir.selector('css/app.css', 'div#b.c[x]:hover::before')?.['hasPseudoElement'], 'true');
      expectEq(fail, 'DIV lowercased in the TYPE part', ir.partsOf(ir.selector('css/app.css', 'DIV.Card:HOVER::BEFORE')!)[0]?.['name'], 'div');
      expectEq(fail, '.Card keeps its case', ir.partsOf(ir.selector('css/app.css', 'DIV.Card:HOVER::BEFORE')!)[1]?.['name'], 'Card');
    },
  },
  {
    name: 'selectors: a selector list keeps one row per selector, without the comma, even beside a stray comma or an inline comment',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const r100 = ir.ruleAtLine('css/app.css', 100);
      if (expectRow(fail, 'rule on line 100', r100)) expectList(fail, 'line 100 (.card, /* c */ .nav, {)', names(ir.selectorsOf(r100), 'selectorText'), ['.card', '.nav']);
      const r101 = ir.ruleAtLine('css/app.css', 101);
      if (expectRow(fail, 'rule on line 101', r101)) expectList(fail, 'line 101 (.card,, .nav)', names(ir.selectorsOf(r101), 'selectorText'), ['.card', '.nav']);
    },
  },
  {
    name: 'selectors: an invalid selector (.123, #1digit, .card . broken) does not leak the next token as a CLASS/ID join key',
    verdict: 'GAP',
    note: 'tree-sitter-css reads `.123 { color: red }` as an error and `.-valid-dash` as the continuation; the recovered parts name `color` as a class and `digit` as an id. Both are gap-marked, but an engine joining on names sees false keys. Drop parts that come out of an ERROR region whose text does not start with the part\'s sigil.',
    run: (ir, fail) => {
      const parts = ir.partsOfSheet('css/app.css');
      if (parts.some((p) => p['partKind'] === 'CLASS' && p['name'] === 'color')) fail('CLASS part "color" from `.123 { color: red }`');
      if (parts.some((p) => p['partKind'] === 'ID' && p['name'] === 'digit')) fail('ID part "digit" from `#1digit`');
      if (!parts.some((p) => p['partKind'] === 'CLASS' && p['name'] === '-valid-dash' && p['combinatorBefore'] === 'NONE')) fail('.-valid-dash should be a selector of its own, not a descendant of the broken one');
    },
  },
  {
    name: 'nesting: nested rules chain to their parent through at-rules, to any depth, and carry the written selector with its &',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const card = ir.ruleAtLine('css/nested.css', 2, '.card');
      if (!expectRow(fail, '.card', card)) return;
      const kids = ir.rules.filter((r) => r['parentRuleLinkHash'] === card['cssRuleUniqueHash']);
      expectEq(fail, '.card child rules', kids.length, Number(card['childRuleCount']));
      for (const [line, text] of [[4, '&:hover'], [5, '& .item'], [6, '.item &'], [7, '& + &'], [8, '&.is-active'], [9, '&#section-one'], [16, '.a &, .b &'], [20, '.parent & .child']] as const) {
        const r = ir.ruleAtLine('css/nested.css', line);
        expectEq(fail, `line ${line} prelude`, r?.['preludeText'], text);
        if (r !== undefined && r['parentRuleLinkHash'] !== card['cssRuleUniqueHash']) fail(`line ${line} is not a child of .card`);
        if (r !== undefined && !ir.selectorsOf(r).every((s) => s['hasNesting'] === 'true')) fail(`line ${line} selector lacks hasNesting`);
      }
      expectList(fail, '& + & parts', ir.partsOf(ir.selectorsOf(ir.ruleAtLine('css/nested.css', 7)!)[0]!).map((p) => `${p['partKind']}:${p['combinatorBefore']}`), ['NESTING:NONE', 'NESTING:NEXT_SIBLING']);
      const deepest = ir.ruleAtLine('css/nested.css', 30, '.deepest');
      if (expectRow(fail, '.deepest', deepest)) {
        expectEq(fail, '.deepest depth', deepest['nestingDepth'], '3');
        const chain: string[] = [];
        for (let r: Row | undefined = deepest; r !== undefined; r = ir.row(r['parentRuleLinkHash'])) chain.push(r['preludeText']!);
        expectList(fail, '.deepest ancestry', chain, ['.deepest', '.deeper', '.deep', '.card']);
      }
      const inMedia = ir.ruleAtLine('css/nested.css', 23, '& .item');
      if (expectRow(fail, '& .item in @media', inMedia)) {
        const media = ir.row(inMedia['parentRuleLinkHash']);
        expectEq(fail, 'parent is the nested @media', media?.['atRuleName'], 'media');
        expectEq(fail, '@media parent is .card', media && ir.row(media['parentRuleLinkHash'])?.['preludeText'], '.card');
        expectEq(fail, 'bare declaration inside the nested @media is owned by it', media?.['declarationCount'], '1');
      }
      expectEq(fail, '.a, .b { & .c } fans out from a two-selector parent', ir.selectorsOf(ir.ruleAtLine('css/nested.css', 38, '.a, .b')!).length, 2);
      expectEq(fail, '@nest .parent & is an at-rule with the declaration', ir.ruleAtLine('css/nested.css', 34)?.['declarationCount'], '1');
      expectEq(fail, 'declaration after nested rules still belongs to .card', card['declarationCount'], '3');
    },
  },
  {
    name: 'nesting: a relative nested selector keeps its leading combinator (`> .direct`), and `& &` keeps both compounds',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      for (const [line, text, comb] of [[12, '> .direct', 'CHILD'], [13, '+ .sib', 'NEXT_SIBLING'], [14, '~ .gen', 'SUBSEQUENT_SIBLING']] as const) {
        const r = ir.ruleAtLine('css/nested.css', line);
        if (!expectRow(fail, `line ${line}`, r)) continue;
        const sel = ir.selectorsOf(r)[0];
        const first = sel === undefined ? undefined : ir.partsOf(sel)[0];
        if (sel?.['selectorText'] !== text && first?.['combinatorBefore'] !== comb) {
          fail(`line ${line}: selectorText=${JSON.stringify(sel?.['selectorText'])} first part combinator=${first?.['combinatorBefore']}; the leading ${comb} is lost, so an engine reads a descendant`);
        }
      }
      const amp = ir.ruleAtLine('css/nested.css', 22);
      if (amp !== undefined && ir.partsOf(ir.selectorsOf(amp)[0]!).length !== 2) fail(`line 22 "& &" has ${ir.partsOf(ir.selectorsOf(amp)[0]!).length} part(s), expected 2 (a descendant of itself)`);
    },
  },
  {
    name: 'layers: @layer statements, blocks, nesting, dotted names, anonymous blocks and import layer() are all facts an engine can compose',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const stmt = ir.ruleAtLine('css/layers.css', 2);
      if (expectRow(fail, '@layer statement', stmt)) {
        expectEq(fail, 'statement has no single name', stmt['name'], '');
        expectList(fail, 'statement LAYER refs', names(ir.refsOfRule(stmt)), ['reset', 'base', 'components.buttons', 'components.cards', 'utilities']);
      }
      expectEq(fail, '@layer base {} name', ir.ruleAtLine('css/layers.css', 4, 'base')?.['name'], 'base');
      const typography = ir.rulesOf('css/layers.css').find((r) => r['name'] === 'typography');
      expectEq(fail, 'nested @layer typography parent is base', typography && ir.row(typography['parentRuleLinkHash'])?.['name'], 'base');
      expectEq(fail, 'dotted block name', ir.ruleAtLine('css/layers.css', 6)?.['name'], 'components.cards');
      expectEq(fail, 'anonymous block name empty', ir.ruleAtLine('css/layers.css', 8)?.['name'], '');
      expectEq(fail, '@layer inside @media', ir.rulesOf('css/layers.css').find((r) => r['startLine'] === '9' && r['atRuleName'] === 'layer')?.['nestingDepth'], '1');
      expectList(fail, '@layer a, b, a; keeps repetition and order', names(ir.refsOfRule(ir.ruleAtLine('css/layers.css', 14)!)), ['a', 'b', 'a']);
      expectList(fail, '@layer    spaced   ,   names   ;', names(ir.refsOfRule(ir.ruleAtLine('css/layers.css', 16)!)), ['spaced', 'names']);
      expectEq(fail, '`@import "alt.css" layer;` (anonymous) has no LAYER ref', ir.refsOfRule(ir.ruleAtLine('css/layers.css', 12)!).filter((v) => v['referenceKind'] === 'LAYER').length, 0);
      const deep = ir.rulesOf('css/app.css').find((r) => r['startLine'] === '145' && r['atRuleName'] === 'layer');
      expectEq(fail, '@media > @supports > @layer components depth', deep?.['nestingDepth'], '2');
    },
  },
  {
    name: 'at-rules: the declared name of every named at-rule (keyframes, vendor keyframes, container, property, counter-style, position-try, font-feature-values, font-face via font-family)',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const named = (sheet: string, at: string): string[] => ir.rulesOf(sheet).filter((r) => r['atRuleName'] === at).map((r) => r['name']!);
      expectList(fail, 'theme.css @keyframes', named('css/theme.css', 'keyframes'), ['fade', 'spin', 'spin', 'quoted-name', 'ease', 'none', 'slide', 'var-inside']);
      expectList(fail, 'theme.css @-webkit-keyframes', named('css/theme.css', '-webkit-keyframes'), ['spin']);
      expectList(fail, 'app.css @-webkit-keyframes', named('css/app.css', '-webkit-keyframes'), ['vendor-spin']);
      expectList(fail, '@container', named('css/app.css', 'container'), ['sidebar']);
      expectList(fail, '@property', named('css/tokens.css', 'property'), ['--brand', '--registered-never-used']);
      expectList(fail, '@counter-style', named('css/app.css', 'counter-style'), ['thumbs']);
      expectList(fail, '@position-try', named('css/app.css', 'position-try'), ['--fallback']);
      expectList(fail, '@font-feature-values', named('css/app.css', 'font-feature-values'), ['Inter']);
      expectList(fail, '@font-face names (quoted, bare, nameless, var)', named('css/fonts.css', 'font-face'), ['Inter', 'Inter', 'Roboto Mono', 'Unused Face', '', 'var(--font)', 'Segoe UI']);
      expectEq(fail, '@page :first prelude', ir.rulesOf('css/app.css').find((r) => r['atRuleName'] === 'page')?.['preludeText'], ':first');
      expectEq(fail, '@media range syntax rule still holds its child', ir.ruleAtLine('css/app.css', 133)?.['childRuleCount'], '1');
      expectEq(fail, '@-moz-document child', ir.ruleAtLine('css/app.css', 143)?.['childRuleCount'], '1');
      expectEq(fail, '@starting-style child', ir.rulesOf('css/app.css').find((r) => r['atRuleName'] === 'starting-style')?.['childRuleCount'], '1');
    },
  },
  {
    name: 'at-rules: a quoted @keyframes name ("quoted-name") is a rule, and keyframe selector lists (0%, 50%) are blocks',
    verdict: 'GAP',
    note: 'tree-sitter-css rejects a string as a keyframes name and a comma list as a keyframe selector; `animation: "quoted-name" 1s` then has nothing to join. Read the @keyframes prelude from text as the other at-rules are.',
    run: (ir, fail) => {
      if (!ir.rulesOf('css/theme.css').some((r) => r['name'] === 'quoted-name')) fail('@keyframes "quoted-name" has no rule row');
      const slide = ir.rulesOf('css/theme.css').find((r) => r['name'] === 'slide');
      if (slide !== undefined && slide['childRuleCount'] !== '4') fail(`@keyframes slide has ${slide['childRuleCount']} blocks, the source has 4`);
      if (ir.cssGapsOf('css/theme.css').some((g) => g['detail']!.includes('0%,'))) fail('`0%, 50% { }` is a parse gap');
    },
  },

  // ── declarations and value references ─────────────────────────────────────
  {
    name: 'declarations: custom properties, vendor prefixes, !important variants, uppercase names, empty values and duplicates',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const props = ir.ruleAtLine('css/app.css', 148, '.props');
      if (!expectRow(fail, '.props', props)) return;
      const d = (line: number): Row | undefined => ir.declsOf(props).find((x) => x['startLine'] === String(line));
      expectEq(fail, '--Brand custom', d(149)?.['isCustomProperty'], 'true');
      expectEq(fail, '--Brand case kept', d(149)?.['property'], '--Brand');
      expectEq(fail, '--empty value', d(151)?.['valueText'], '');
      expectEq(fail, '--json value', d(153)?.['valueText'], '[1, 2, 3]');
      expectEq(fail, '-webkit- prefix', d(158)?.['vendorPrefix'], '-webkit-');
      expectEq(fail, '-ms-filter prefix', d(160)?.['vendorPrefix'], '-ms-');
      expectEq(fail, 'custom property has no vendor prefix', d(149)?.['vendorPrefix'], '');
      expectEq(fail, '_height hack kept', d(163)?.['property'], '_height');
      expectEq(fail, 'margin: 0 ! important', d(166)?.['isImportant'], 'true');
      expectEq(fail, 'padding: 0!important', d(167)?.['isImportant'], 'true');
      expectEq(fail, 'color: red;; keeps the declaration', d(169)?.['valueText'], 'red');
      expectEq(fail, 'color: ; is an empty value', d(170)?.['valueText'], '');
      if (!ir.cssGapsOf('css/app.css').some((g) => g['detail'] === 'empty value for color')) fail('no gap for `color: ;`');
      expectEq(fail, 'positions are consecutive', ir.declsOf(props).every((x, i) => x['position'] === String(i)), true);
      expectEq(fail, 'uppercase property kept as written in a style attribute', ir.styleAttrDeclsAtLine('index.html', 109).map((x) => x['property']).join(','), 'COLOR,Background-Color');
    },
  },
  {
    name: 'declarations: `color: red !IMPORTANT` is important (the flag is case-insensitive)',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      expectEq(fail, 'line 168', ir.declAtLine('css/app.css', 168, 'color')?.['isImportant'], 'true');
    },
  },
  {
    name: 'declarations: one malformed declaration (`color red;`) loses only itself, not the rest of the block',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const props = ir.ruleAtLine('css/app.css', 148, '.props')!;
      const lines = ir.declsOf(props).map((x) => Number(x['startLine']));
      for (const want of [173, 174, 175, 176, 177, 178, 179]) if (!lines.includes(want)) fail(`declaration on line ${want} lost after \`color red;\` on 172`);
      expectEq(fail, 'style="color red; margin: 0" keeps margin', ir.styleAttrDeclsAtLine('index.html', 104).map((x) => x['property']).join(','), 'margin');
    },
  },
  {
    name: 'declarations: a custom property whose value is a {} block (`--with-brace: { a: b }`) is one declaration',
    verdict: 'GAP',
    note: 'The grammar reads the block as a nested rule; the declaration vanishes and `a: b` appears as a declaration. Rare outside Polymer-era mixins.',
    run: (ir, fail) => {
      if (ir.declAtLine('css/app.css', 152, '--with-brace') === undefined) fail('--with-brace has no declaration row');
    },
  },
  {
    name: 'value refs: url() in every shape — quoted, unquoted, spaced, query/fragment, data:, //, root, ../, #, empty, list, nested in image-set, uppercase URL()',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const props = ir.ruleAtLine('css/app.css', 148, '.props')!;
      const at = (line: number): string[] => {
        const d = ir.declsOf(props).find((x) => x['startLine'] === String(line));
        return d === undefined ? ['<no decl>'] : ir.refsOfDecl(d).map((v) => `${v['name']}(${v['urlKind']}${v['isResolved'] === 'true' ? '✓' : ''})`);
      };
      // app.css sits in css/: `img/…` is css/img/… (absent), `../img/…` and `/img/…` exist.
      expectList(fail, "url('img/bg.png?v=1#frag')", at(180), ['img/bg.png?v=1#frag(RELATIVE)']);
      expectList(fail, 'url(img/bg.png?v=1#frag)', at(181), ['img/bg.png?v=1#frag(RELATIVE)']);
      expectList(fail, 'url(  img/bg.png  )', at(182), ['img/bg.png(RELATIVE)']);
      expectList(fail, 'url("img/space name.png")', at(183), ['img/space name.png(RELATIVE)']);
      expectList(fail, 'url(data:…)', at(185), ['data:image/png;base64,iVBORw0KGgo=(DATA_URI)']);
      expectList(fail, 'url(//cdn…)', at(186), ['//cdn.example.com/x.png(PROTOCOL_RELATIVE)']);
      expectList(fail, 'url(/img/bg.png) root-relative resolves', at(187), ['/img/bg.png(ROOT_RELATIVE✓)']);
      expectList(fail, 'url(../img/bg.png) from css/ resolves', at(188), ['../img/bg.png(RELATIVE✓)']);
      expectList(fail, 'url(#inline-ref)', at(189), ['#inline-ref(FRAGMENT)']);
      expectList(fail, 'url()', at(190), ['(EMPTY)']);
      expectList(fail, 'url(""), url(img/bg.png), url(img/missing.png)', at(191), ['(EMPTY)', 'img/bg.png(RELATIVE)', 'img/missing.png(RELATIVE)']);
      expectList(fail, '-webkit-image-set(url(…))', at(193), ['img/hero.png(RELATIVE)']);
      expectList(fail, 'cursor list', at(196), ['img/cursor.cur(RELATIVE)', 'img/cursor.cur(RELATIVE)']);
      expectList(fail, 'mask: url(img/sprite.svg#mask)', at(195), ['img/sprite.svg#mask(RELATIVE)']);
      expectList(fail, 'fonts.css ../fonts/inter.woff2 resolves', ir.valueRefsOfSheet('css/fonts.css', 'URL').slice(0, 1).map((v) => `${v['name']}(${v['urlKind']}${v['isResolved'] === 'true' ? '✓' : ''})`), ['../fonts/inter.woff2(RELATIVE✓)']);
      expectList(fail, 'theme.css url relative to css/ (img/ is one level up)', ir.valueRefsOfSheet('css/theme.css', 'URL').map((v) => v['isResolved']!), ['false']);
    },
  },
  {
    name: 'value refs: URL(img/bg.png) in uppercase is a url() reference',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      expectEq(fail, 'line 199', ir.refsOfDecl(ir.declAtLine('css/app.css', 199, 'background')!).length, 1);
    },
  },
  {
    name: 'value refs: url(a\\)b.png) with an escaped paren is one URL',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      expectEq(fail, 'strings.css .s17', ir.refsOfDecl(ir.declAtLine('css/strings.css', 19, 'background')!)[0]?.['name'], 'a)b.png');
    },
  },
  {
    name: 'value refs: image-set("a.png" 1x) and src("a.png") name URLs',
    verdict: 'GAP',
    note: 'Only var() and url() are scanned; image-set() strings and src() are URL references too.',
    run: (ir, fail) => {
      expectEq(fail, 'image-set refs', ir.refsOfDecl(ir.declAtLine('css/app.css', 192, 'background')!).length, 2);
      expectEq(fail, 'src() refs', ir.refsOfDecl(ir.declAtLine('css/app.css', 194, 'background')!).length, 1);
    },
  },
  {
    name: 'value refs: text inside a string is not a reference ("url(not.png)", "var(--not)", "var(--brand)")',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      expectEq(fail, 'strings.css .s6 content: "url(not.png)"', ir.refsOfDecl(ir.declAtLine('css/strings.css', 7, 'content')!).length, 0);
      expectEq(fail, "strings.css .s7 content: 'var(--not)'", ir.refsOfDecl(ir.declAtLine('css/strings.css', 8, 'content')!).length, 0);
      expectEq(fail, 'tokens.css .var-in-string', ir.refsOfDecl(ir.declAtLine('css/tokens.css', 30, 'content')!).length, 0);
    },
  },
  {
    name: 'value refs: var() — nested fallbacks are references of their own, fallback text kept, whitespace and case as written, non-variables ignored',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const nested = ir.declAtLine('css/app.css', 155, '--nested');
      if (expectRow(fail, '--nested', nested)) expectList(fail, '--nested refs', refSummary(nested, ir), ['VARIABLE:--brand[var(--Brand, var(--missing, red))]', 'VARIABLE:--Brand[var(--missing, red)]', 'VARIABLE:--missing[red]']);
      const cases = ir.declsOfSheet('css/tokens.css').filter((d) => d['startLine'] === '25');
      const all = cases.flatMap((d) => refSummary(d, ir));
      expectList(fail, '.var-name-cases', all, ['VARIABLE:--BRAND', 'VARIABLE:--brand', 'VARIABLE:--brand', 'VARIABLE:--brand[1px 2px]', 'VARIABLE:--brand[url(img/bg.png)]', 'URL:img/bg.png', 'VARIABLE:--brand[var(--gap)]', 'VARIABLE:--gap']);
      expectEq(fail, '.var-not-a-var yields nothing', ir.declsOfSheet('css/tokens.css').filter((d) => d['startLine'] === '26').flatMap((d) => ir.refsOfDecl(d)).length, 0);
      expectList(fail, 'calc(100% - var(--gap, 8px) * 2)', refSummary(ir.declAtLine('css/app.css', 201, 'width')!, ir), ['VARIABLE:--gap[8px]']);
      expectList(fail, 'env(…, var(--pad))', refSummary(ir.declAtLine('css/app.css', 202, 'padding')!, ir), ['VARIABLE:--pad']);
      expectList(fail, 'color-mix', refSummary(ir.declAtLine('css/app.css', 200, 'color')!, ir), ['VARIABLE:--brand', 'VARIABLE:--Brand']);
      expectList(fail, 'a custom property defined from another (--alias: var(--brand))', refSummary(ir.declAtLine('css/tokens.css', 32, '--alias')!, ir), ['VARIABLE:--brand']);
      expectList(fail, 'var() inside @keyframes block', refSummary(ir.declAtLine('css/theme.css', 12, 'color')!, ir), ['VARIABLE:--brand']);
      expectEq(fail, 'a var() in a comment is not a reference', ir.declsOfSheet('css/tokens.css').filter((d) => d['startLine'] === '31').flatMap((d) => ir.refsOfDecl(d)).length, 0);
    },
  },
  {
    name: 'value refs: style attributes — declarations owned by the attribute, host positions, custom properties, url/var/animation/font/container refs',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const l98 = ir.styleAttrDeclsAtLine('index.html', 98);
      expectList(fail, 'line 98 properties', names(l98, 'property'), ['color', 'margin']);
      expectEq(fail, 'line 98 first column', l98[0]?.['startColumn'], '15');
      expectEq(fail, 'line 98 second column', l98[1]?.['startColumn'], '36');
      expectEq(fail, 'attribute-owned declarations have no rule', l98[0]?.['ruleLinkHash'], '');
      expectEq(fail, 'owner attribute is the style attribute', ir.row(l98[0]?.['htmlAttributeLinkHash'])?.['attributeKind'], 'STYLE');
      expectEq(fail, '--local custom in a style attribute', ir.styleAttrDeclsAtLine('index.html', 99)[0]?.['isCustomProperty'], 'true');
      expectList(fail, 'padding: var(--local)', refSummary(ir.styleAttrDeclsAtLine('index.html', 99)[1]!, ir), ['VARIABLE:--local']);
      expectEq(fail, 'color: red !important in an attribute', ir.styleAttrDeclsAtLine('index.html', 102)[0]?.['isImportant'], 'true');
      expectList(fail, 'line 107 refs', ir.styleAttrDeclsAtLine('index.html', 107).flatMap((d) => refSummary(d, ir)), ['KEYFRAMES:spin', 'FONT_FAMILY:Inter', 'CONTAINER:sidebar']);
      expectList(fail, 'style="color: red; } .injected {…" keeps the first declaration only', names(ir.styleAttrDeclsAtLine('index.html', 108), 'property'), ['color']);
      expectList(fail, 'style=".x { color: red }" yields no declaration and a gap', names(ir.styleAttrDeclsAtLine('index.html', 105), 'property'), []);
      if (!ir.ofDoc(ir.htmlGaps, 'index.html').some((g) => g['startLine'] === '105' && g['gapKind'] === 'STYLE_ATTRIBUTE_SYNTAX')) fail('no STYLE_ATTRIBUTE_SYNTAX gap on line 105');
      if (!ir.ofDoc(ir.htmlGaps, 'index.html').some((g) => g['startLine'] === '103' && g['detail']!.includes('template'))) fail('no template gap for style="color: {{ color }}"');
      expectList(fail, 'SVG rect style attribute', ir.styleAttrDeclsAtLine('svg.html', 30).flatMap((d) => refSummary(d, ir)), ['VARIABLE:--brand']);
      expectList(fail, 'CRLF page style attribute', ir.styleAttrDeclsAtLine('quirks.html', 7).flatMap((d) => refSummary(d, ir)), ['VARIABLE:--brand']);
    },
  },
  {
    name: 'value refs: keyframes names from animation shorthands (any position, steps() skipped, keywords skipped, quoted) and animation-name lists',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const k = (line: number): string[] => ir.refsOfDecl(ir.declAtLine('css/app.css', line)!).filter((v) => v['referenceKind'] === 'KEYFRAMES').map((v) => v['name']!);
      expectList(fail, 'spin 1s linear infinite, fade 2s', k(210), ['spin', 'fade']);
      expectList(fail, '1s ease-in-out infinite reverse spin', k(211), ['spin']);
      expectList(fail, '2s steps(4, end) slide', k(212), ['slide']);
      expectList(fail, '"quoted-name" 1s', k(213), ['quoted-name']);
      expectList(fail, 'none', k(214), []);
      expectList(fail, 'linear 1s', k(215), []);
      expectList(fail, 'var(--anim) 1s has no keyframes ref', k(216), []);
      expectList(fail, 'animation-name list', k(217), ['spin', 'fade', 'missing-keyframes', 'vendor-spin']);
      expectList(fail, 'animation-name: none', k(218), []);
    },
  },
  {
    name: 'value refs: `animation-name: ease` names a keyframes rule (keywords are reserved only in the shorthand)',
    verdict: 'GAP',
    note: 'The longhand excludes the shorthand keyword set; @keyframes ease { } in theme.css is then unjoinable. Apply ANIMATION_KEYWORDS to the shorthand only.',
    run: (ir, fail) => {
      expectEq(fail, 'line 219', ir.refsOfDecl(ir.declAtLine('css/app.css', 219)!).length, 1);
    },
  },
  {
    name: 'value refs: font families from font-family (quoted, unquoted multi-word, generics skipped) and the @font-face join',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const f = (sheet: string, line: number): string[] => ir.refsOfDecl(ir.declAtLine(sheet, line, 'font-family')!).filter((v) => v['referenceKind'] === 'FONT_FAMILY').map((v) => v['name']!);
      expectList(fail, '"Inter", \'Roboto Mono\', Segoe UI, ui-sans-serif, sans-serif', f('css/app.css', 207), ['Inter', 'Roboto Mono', 'Segoe UI']);
      expectList(fail, 'inherit', f('css/app.css', 208), []);
      expectList(fail, 'var(--font) is a variable only', f('css/app.css', 209), []);
      expectList(fail, 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto', f('css/fonts.css', 30), ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto']);
      expectList(fail, '"Font; Name"', f('css/strings.css', 20), ['Font; Name']);
      expectList(fail, '"Font } Name"', f('css/strings.css', 21), ['Font } Name']);
      expectList(fail, 'Inter !important', f('css/fonts.css', 32), ['Inter']);
      expectEq(fail, '@font-face src urls resolve against the sheet', ir.valueRefsOfSheet('css/fonts.css', 'URL').filter((v) => v['isResolved'] === 'true').length, 3);
      expectEq(fail, '@font-face rule name joins font-family refs', ir.rulesOf('css/fonts.css').filter((r) => r['name'] === 'Inter').length, 2);
    },
  },
  {
    name: 'value refs: the `font` shorthand names families too (font: 12px Inter)',
    verdict: 'GAP',
    note: 'Only `font-family` is scanned. `font: italic bold 12px/30px Inter, "Segoe UI", serif` and `font: 12px Inter` produce no FONT_FAMILY row; a face used only through the shorthand reads as unused. Scan the segment after the size (and `/line-height`) of the shorthand.',
    run: (ir, fail) => {
      expectEq(fail, 'font: italic bold 12px/30px Inter, "Segoe UI", serif', ir.refsOfDecl(ir.declAtLine('css/app.css', 203, 'font')!).length, 2);
      expectEq(fail, 'font: 12px Inter (fonts.css)', ir.refsOfDecl(ir.declAtLine('css/fonts.css', 26, 'font')!).length, 1);
      expectEq(fail, 'style="font: 12px/1.5 Inter, serif"', ir.refsOfDecl(ir.styleAttrDeclsAtLine('index.html', 102)[1]!).length, 1);
    },
  },
  {
    name: 'value refs: container names from container / container-name, and the @container join',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const c = (line: number): string[] => ir.refsOfDecl(ir.declAtLine('css/app.css', line)!).map((v) => v['name']!);
      expectList(fail, 'container: sidebar / inline-size', c(220), ['sidebar']);
      expectList(fail, 'container: a b / size', c(221), ['a', 'b']);
      expectList(fail, 'container-name: sidebar other', c(222), ['sidebar', 'other']);
      expectList(fail, 'container-name: none', c(223), []);
      expectList(fail, 'container-type is not a name', c(224), []);
      const q = ir.rulesOf('css/app.css').find((r) => r['atRuleName'] === 'container');
      expectList(fail, '@container prelude ref', q ? ir.refsOfRule(q).map((v) => `${v['referenceKind']}:${v['name']}`) : [], ['CONTAINER:sidebar']);
    },
  },
  {
    name: 'value refs: dashed-ident and custom-ident references to other at-rules (position-try-fallbacks, anchor-name, view-transition-name, grid-area, counter())',
    verdict: 'GAP',
    note: 'These name @position-try, anchors, view transitions, grid-template-areas and counters. No CssValueReferenceKind covers them yet; `position-try-fallbacks: --fallback` cannot reach `@position-try --fallback`.',
    run: (ir, fail) => {
      for (const [line, prop] of [[229, 'position-try-fallbacks'], [230, 'anchor-name'], [232, 'view-transition-name'], [228, 'grid-area']] as const) {
        if (ir.refsOfDecl(ir.declAtLine('css/app.css', line, prop)!).length === 0) fail(`${prop} produces no reference`);
      }
    },
  },
  {
    name: 'gaps: every unreadable region is a gap and the readable rest stands (strings.css, gaps.css, sassy.css, jinja <style>)',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const strings = names(ir.rulesOf('css/strings.css'), 'preludeText');
      for (const want of ['.s1', '.s3', '.s4', '.s5', '.s6', '.s14', '.s15', '.s16', '.s17', '.s18', '.s19', '.s20', '.s23', '.s24', '.s25', '.s26']) if (!strings.includes(want)) fail(`strings.css lost rule ${want}`);
      expectEq(fail, 'strings.css .s14 content with an escaped quote', ir.declAtLine('css/strings.css', 16, 'content')?.['valueText'], '"\\"; } .injected { color: red }"');
      const gaps = names(ir.rulesOf('css/gaps.css'), 'preludeText');
      for (const want of ['.before-gaps', '.g3', '.g4', '.g5', '.g8', '.g12', '.g13', '.g14', '.g15', '.g18', '.g19', '.g20', '.g21', '.g22', '.g23']) if (!gaps.includes(want)) fail(`gaps.css lost rule ${want}`);
      expectEq(fail, 'gaps.css unknown statement is PREPROCESSOR_SYNTAX', ir.cssGapsOf('css/gaps.css').some((g) => g['detail']!.startsWith('postcss statement')), true);
      // V1-03: `.g28 { color: red` at EOF is closed there as a browser does (it was a declaration outside a rule); the
      // block the end of file closed is an UNCLOSED_BLOCK gap
      expectEq(fail, 'gaps.css block open at EOF is an UNCLOSED_BLOCK gap', ir.cssGapsOf('css/gaps.css').some((g) => g['gapKind'] === 'UNCLOSED_BLOCK'), true);
      expectEq(fail, 'gaps.css .g28 closed at EOF is a rule', names(ir.rulesOf('css/gaps.css'), 'preludeText').includes('.g28'), true);
      expectEq(fail, 'sassy.css $var at top level is UNPARSED_FRAGMENT', ir.cssGapsOf('css/sassy.css').some((g) => g['gapKind'] === 'UNPARSED_FRAGMENT'), true);
      expectEq(fail, 'sassy.css line comment flagged', ir.cssGapsOf('css/sassy.css').some((g) => g['detail']!.startsWith('line comment')), true);
      expectEq(fail, 'jinja <style> keeps .item rule', ir.rulesOf('templates/jinja.html#style1').some((r) => r['preludeText'] === '.item'), true);
      for (const g of ir.cssGaps) if (g['stylesheetLinkHash'] === '' || ir.row(g['stylesheetLinkHash']) === undefined) { fail('a css_parse_gap has no stylesheet'); break; }
    },
  },
  {
    name: 'gaps: a string containing `{` (content: "{") or left unterminated (content: "x }) does not swallow the next rule',
    verdict: 'GAP',
    note: 'tree-sitter-css reads the brace inside the string as a block, and runs an unterminated string past the newline where CSS ends it. Recoverable by re-reading the error text with a string-aware splitter.',
    run: (ir, fail) => {
      if (!names(ir.rulesOf('css/strings.css'), 'preludeText').includes('.s2')) fail('.s2 { content: "{" } has no rule row');
      if (!names(ir.rulesOf('css/gaps.css'), 'preludeText').includes('.g25')) fail('.g25 after `.g24 { content: "x }` has no rule row');
    },
  },

  // ── references ────────────────────────────────────────────────────────────
  {
    name: 'references: URL classification by text — schemes, case, protocol-relative, fragment, empty, javascript:, templates, Windows path',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const kind = (url: string): string => ir.ref('index.html', url)?.['urlKind'] ?? '<none>';
      expectEq(fail, 'tel:', kind('tel:+1-555-0100'), 'OTHER_SCHEME');
      expectEq(fail, 'sms: query split', ir.ref('index.html', 'sms:+15550100?body=hi')?.['query'], 'body=hi');
      expectEq(fail, 'file:', kind('file:///etc/hosts'), 'OTHER_SCHEME');
      expectEq(fail, 'C:\\ path', kind('C:\\Users\\x\\page.html'), 'OTHER_SCHEME');
      expectEq(fail, '//cdn', kind('//cdn.example.com/lib.js'), 'PROTOCOL_RELATIVE');
      expectEq(fail, 'HTTPS:// uppercase', kind('HTTPS://EXAMPLE.COM/A'), 'ABSOLUTE');
      expectEq(fail, 'javascript:void(0)', kind('javascript:void(0)'), 'JAVASCRIPT_URI');
      expectEq(fail, 'JavaScript: mixed case', kind("JavaScript:toggle('nav')"), 'JAVASCRIPT_URI');
      expectEq(fail, 'javascript:;', kind('javascript:;'), 'JAVASCRIPT_URI');
      expectEq(fail, 'javascript:{{ handler }}', kind('javascript:{{ handler }}'), 'TEMPLATE_EXPRESSION');
      expectEq(fail, '{{ url_for }}', kind("{{ url_for('home') }}"), 'TEMPLATE_EXPRESSION');
      expectEq(fail, '/static/{{ name }}.js', kind('/static/{{ name }}.js'), 'TEMPLATE_EXPRESSION');
      expectEq(fail, '${ctx}/x.html', kind('${ctx}/x.html'), 'TEMPLATE_EXPRESSION');
      expectEq(fail, '<%= path %>', kind('<%= path %>'), 'TEMPLATE_EXPRESSION');
      expectEq(fail, 'empty href', ir.refsAtLine('index.html', 68)[0]?.['urlKind'], 'EMPTY');
      expectEq(fail, 'padded href trimmed', ir.refsAtLine('index.html', 69)[0]?.['urlAsWritten'], 'index.html');
      expectEq(fail, '#section-one', kind('#section-one'), 'FRAGMENT');
      expectEq(fail, '#section-one fragment column', ir.ref('index.html', '#section-one')?.['fragment'], 'section-one');
      expectEq(fail, 'bare # (forms)', ir.ref('forms.html', '#')?.['urlKind'], 'FRAGMENT');
      expectEq(fail, './ unresolved', ir.ref('index.html', './')?.['isResolved'], 'false');
      expectEq(fail, 'css/ directory unresolved', ir.ref('index.html', 'css/')?.['isResolved'], 'false');
      expectEq(fail, '../outside.html unresolved', ir.ref('index.html', '../outside.html')?.['isResolved'], 'false');
    },
  },
  {
    name: 'references: reference kinds by element and attribute — image/media/frame/form/meta-refresh/cite/background/usemap/input type',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const k = (line: number): string[] => ir.refsAtLine('index.html', line).map((r) => `${r['referenceKind']}/${r['attributeName']}`);
      expectList(fail, 'img src+srcset', k(164), ['IMAGE/src', 'IMAGE/srcset', 'IMAGE/srcset']);
      expectList(fail, 'img src#frag + usemap', k(166), ['IMAGE/src', 'OTHER/usemap']);
      expectEq(fail, 'usemap fragment', ir.refsAtLine('index.html', 166)[1]?.['fragment'], 'site-map');
      expectList(fail, 'area href', k(167), ['ANCHOR/href']);
      expectList(fail, 'picture sources + img', k(168), ['IMAGE/srcset', 'IMAGE/srcset', 'IMAGE/src']);
      expectList(fail, 'video src poster source track', k(169), ['MEDIA/src', 'MEDIA/poster', 'MEDIA/src', 'MEDIA/src']);
      expectList(fail, 'audio source', k(170), ['MEDIA/src']);
      expectList(fail, 'input type=image', k(171), ['IMAGE/src']);
      expectList(fail, 'input type=IMAGE', k(172), ['IMAGE/src']);
      expectList(fail, 'input type=text src', k(173), ['OTHER/src']);
      expectList(fail, 'iframe', k(174), ['FRAME/src']);
      expectList(fail, 'embed', k(176), ['FRAME/src']);
      expectList(fail, 'object data (param value is not a URL attribute)', k(177), ['FRAME/data']);
      expectList(fail, 'blockquote cite', k(178), ['OTHER/cite']);
      expectList(fail, 'body background', k(179), ['OTHER/background']);
      expectList(fail, 'meta refresh with quoted URL', k(181), ['META_REFRESH/content']);
      expectEq(fail, 'meta refresh URL', ir.refsAtLine('index.html', 181)[0]?.['urlAsWritten'], 'forms.html');
      expectList(fail, 'meta Refresh (case) absolute', k(182), ['META_REFRESH/content']);
      expectList(fail, 'script srcs: external module, src with ignored body, empty src, blank src', [153, 154, 155, 156].flatMap(k), ['SCRIPT/src', 'SCRIPT/src', 'SCRIPT/src', 'SCRIPT/src']);
      expectList(fail, 'forms: action/formaction', ir.ofDoc(ir.references, 'forms.html').filter((r) => r['referenceKind'] === 'FORM_ACTION').map((r) => r['urlAsWritten']!), ['/submit', '/alt']);
      expectList(fail, 'svg: use/image/a hrefs with and without xlink', ir.ofDoc(ir.references, 'svg.html').map((r) => `${r['referenceKind']}/${r['attributeName']}`),
        ['STYLESHEET/href', 'OTHER/href', 'OTHER/xlink:href', 'OTHER/href', 'OTHER/xlink:href', 'OTHER/href', 'OTHER/xlink:href', 'ANCHOR/href', 'OTHER/xlink:href']);
      expectEq(fail, 'svg sprite fragment kept with the resolved file', ir.ref('svg.html', 'img/sprite.svg#external-icon', 'href')?.['fragment'], 'external-icon');
      expectEq(fail, 'htmx hx-get is a REQUEST reference', ir.ref('templates/mixed.html', '/items')?.['referenceKind'], 'REQUEST');
    },
  },
  {
    name: 'references: a srcset URL containing a comma (a.png?x=1,2 100w) is one candidate',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      expectList(fail, 'line 165 srcset', ir.refsAtLine('index.html', 165).map((r) => r['urlAsWritten']!), ['img/hero.webp?w=100,200', 'img/hero.png']);
    },
  },
  {
    name: 'references: ping="/ping1 /ping2" is a space-separated set of URLs',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      expectList(fail, 'ping refs', ir.refsAtLine('index.html', 91).filter((r) => r['attributeName'] === 'ping').map((r) => r['urlAsWritten']!), ['/ping1', '/ping2']);
    },
  },
  {
    name: 'references: URLs inside non-URL attributes and bodies (meta og:image content, param value, iframe srcdoc, SVG fill="url(#grad)") are not references',
    verdict: 'LIMIT',
    note: 'og:image and param value need per-vocabulary knowledge; srcdoc is a nested document; fill="url(#grad)" is a presentation attribute whose value is CSS. The html_attribute rows carry the text for an engine that wants them.',
    run: (ir, fail) => {
      if (ir.ref('index.html', 'img/hero.png', 'content') === undefined) fail('og:image content is not a reference (expected)');
      if (!ir.attributes.some((a) => a['name'] === 'fill' && a['value'] === 'url(#grad)')) fail('fill attribute row missing');
      else fail('fill="url(#grad)" has no reference row; the id join to <linearGradient id="grad"> is left to the engine');
    },
  },
  {
    name: 'references: cross-page fragments carry both the resolved document path and the fragment, and the target id exists as an element',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const r = ir.ref('forms.html', 'index.html#section-one');
      if (!expectRow(fail, 'forms→index#section-one', r)) return;
      expectEq(fail, 'resolvedFilePath = html_document.filePath', r['resolvedFilePath'], ir.doc('index.html')['filePath']);
      expectEq(fail, 'fragment', r['fragment'], 'section-one');
      expectEq(fail, 'target elements with that id (duplicate id, both rows)', ir.ofDoc(ir.elements, 'index.html').filter((e) => e['id'] === 'section-one').length, 2);
      expectEq(fail, '#LOUD target keeps case', ir.ofDoc(ir.elements, 'index.html').some((e) => e['id'] === 'LOUD'), true);
      expectEq(fail, 'forms.html#the-form from index (under base) still has path and fragment', ir.ref('index.html', 'forms.html#the-form')?.['fragment'], 'the-form');
      expectEq(fail, '<use href="#sym-icon"> target id exists', ir.ofDoc(ir.elements, 'svg.html').some((e) => e['id'] === 'sym-icon'), true);
    },
  },
  {
    name: 'idrefs: for/form/list/headers/popovertarget/commandfor/itemref/contextmenu/aria-* carry kind and raw value; name attributes carry NAME; target is OTHER',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const kinds = ir.ofDoc(ir.attributes, 'forms.html').filter((a) => ['FOR', 'ID_REFERENCE', 'ARIA', 'NAME'].includes(a['attributeKind']!)).map((a) => `${a['name']}=${a['value']}:${a['attributeKind']}`);
      for (const want of ['for=q:FOR', 'for=  q  :FOR', 'for=Q:FOR', 'list=choices:ID_REFERENCE', 'form=the-form:ID_REFERENCE', 'popovertarget=pop:ID_REFERENCE', 'for=q pick:FOR',
        'headers=h-name h-age h-missing:ID_REFERENCE', 'name=site-map:NAME', 'name=legacy-anchor:NAME', 'name=frame-b:NAME', 'aria-labelledby=h-name h-age:ARIA', 'aria-owns=pop choices:ARIA',
        'aria-activedescendant=q:ARIA', 'itemref=h-name h-age:ID_REFERENCE', 'contextmenu=ctx:ID_REFERENCE', 'commandfor=pop:ID_REFERENCE']) {
        if (!kinds.includes(want)) fail(`forms.html lacks ${want}`);
      }
      expectEq(fail, 'target kind', ir.ofDoc(ir.attributes, 'forms.html').find((a) => a['name'] === 'target')?.['attributeKind'], 'OTHER');
      for (const id of ['q', 'choices', 'the-form', 'pop', 'h-name', 'h-age', 'ctx', 'site-map-id']) if (!ir.ofDoc(ir.elements, 'forms.html').some((e) => e['id'] === id)) fail(`forms.html has no element with id ${id}`);
      expectEq(fail, 'duplicate id q has two element rows', ir.ofDoc(ir.elements, 'forms.html').filter((e) => e['id'] === 'q').length, 2);
      expectEq(fail, 'popover boolean attribute', ir.ofDoc(ir.attributes, 'forms.html').find((a) => a['name'] === 'popover')?.['hasValue'], 'false');
    },
  },

  // ── scripts and handlers ──────────────────────────────────────────────────
  {
    name: 'scripts: kind and type for every <script> shape, body ranges for inline, src and resolution for external',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const s = ir.ofDoc(ir.scripts, 'index.html');
      const types = s.map((x, i) => (i === 7 ? '*' : `${x['scriptKind']}:${x['scriptType']}`)); // #7 is the parameterised MIME type, checked on its own
      expectList(fail, 'index.html scripts', types, [
        'EXTERNAL:CLASSIC', 'EXTERNAL:MODULE', 'EXTERNAL:CLASSIC', 'INLINE:IMPORTMAP', 'INLINE:CLASSIC',
        'INLINE:CLASSIC', 'INLINE:CLASSIC', '*', 'INLINE:MODULE', 'INLINE:TEMPLATE', 'INLINE:TEMPLATE', 'INLINE:TEMPLATE', 'INLINE:JSON', 'INLINE:JSON',
        'INLINE:SPECULATION_RULES', 'INLINE:TRANSPILED', 'INLINE:TRANSPILED', 'INLINE:DATA_BLOCK', 'EXTERNAL:MODULE', 'EXTERNAL:CLASSIC', 'INLINE:CLASSIC', 'INLINE:CLASSIC', 'INLINE:CLASSIC', 'INLINE:CLASSIC', 'INLINE:CLASSIC']);
      expectEq(fail, 'defer', s[0]?.['isDefer'], 'true');
      expectEq(fail, 'nomodule', s[2]?.['isNoModule'], 'true');
      expectEq(fail, 'first inline body range', `${s[4]?.['bodyStartLine']}:${s[4]?.['bodyStartColumn']}-${s[4]?.['bodyEndLine']}:${s[4]?.['bodyEndColumn']}`, '28:11-34:3');
      expectEq(fail, 'external script links its reference row', ir.row(s[0]?.['referenceLinkHash'])?.['urlAsWritten'], 'js/vendor.js');
      expectEq(fail, 'src="" is inline', s[20]?.['scriptKind'], 'INLINE');
      expectEq(fail, 'src="   " is inline', s[21]?.['scriptKind'], 'INLINE');
      expectEq(fail, '"<\\/script>" in a string does not end the body', s[22]?.['bodyEndLine'], '160');
      expectEq(fail, '"</script>" in a string ends the body (as in a browser)', s[23]?.['bodyLength'], '19');
      expectEq(fail, 'mixed.html ../js/app.js resolved', ir.ofDoc(ir.scripts, 'templates/mixed.html')[0]?.['resolvedFilePath'], ir.abs('js/app.js'));
      expectEq(fail, 'jinja {% static %} src is a template expression', ir.ofDoc(ir.references, 'templates/jinja.html').find((r) => r['referenceKind'] === 'SCRIPT')?.['urlKind'], 'TEMPLATE_EXPRESSION');
      expectEq(fail, 'template <script> inside <template> counted', s.length, Number(ir.doc('index.html')['scriptCount']));
    },
  },
  {
    name: 'scripts: a JavaScript MIME type with parameters (application/javascript;charset=utf-8) is CLASSIC',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      expectEq(fail, 'line 142', ir.ofDoc(ir.scripts, 'index.html').find((x) => x['typeAsWritten'] === 'application/javascript;charset=utf-8')?.['scriptType'], 'CLASSIC');
    },
  },
  {
    name: 'handlers: every call shape in on* attributes and javascript: URLs — callee, receiver, arguments, new, nesting order, entities, case, SVG, CRLF, XHTML',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const h = (line: number): string[] => ir.handlersAtLine('index.html', line).map((x) => `${x['receiverText'] ? x['receiverText'] + '.' : ''}${x['calleeName']}(${x['argumentCount']})${x['isNew'] === 'true' ? ' new' : ''}`);
      expectList(fail, 'body onload', h(50), ['track(2)']);
      expectEq(fail, 'onload event name', ir.handlersAtLine('index.html', 50)[0]?.['eventName'], 'load');
      expectList(fail, 'javascript:void(0) + onclick', h(82), ['go(1)']);
      expectList(fail, "JavaScript:toggle('nav')", h(83), ['toggle(1)']);
      expectEq(fail, 'javascript: source', ir.handlersAtLine('index.html', 83)[0]?.['handlerSource'], 'JAVASCRIPT_URL');
      expectList(fail, 'save()', h(113), ['save(0)']);
      expectList(fail, 'app.submit(event)', h(114), ['app.submit(1)']);
      expectList(fail, 'a.b.c.d(1,2,3)', h(115), ['a.b.c.d(3)']);
      expectList(fail, "window['save']()", h(116), ['window.(0)']);
      expectList(fail, 'new Widget(this).open()', h(117), ['new Widget(this).open(0)', 'Widget(1) new']);
      expectList(fail, 'if/else three calls', h(118), ['confirm(1)', 'remove(1)', 'keep(0)']);
      expectList(fail, 'iife', h(119), ['(0)', 'inner(0)']);
      expectList(fail, 'bare identifier', h(120), []);
      expectList(fail, 'return false', h(121), []);
      expectList(fail, 'empty', h(122), []);
      expectList(fail, 'entities in arguments', h(123), ['save(2)']);
      expectList(fail, 'unbalanced still yields the call', h(124), ['save(2)']);
      if (!ir.ofDoc(ir.htmlGaps, 'index.html').some((g) => g['startLine'] === '124' && g['gapKind'] === 'HANDLER_SYNTAX')) fail('no HANDLER_SYNTAX gap on line 124');
      expectList(fail, "this.classList.toggle('open')", h(125), ['this.classList.toggle(1)']);
      expectList(fail, 'ONCLICK', h(127), ['shout(0)']);
      expectList(fail, 'onClick', h(128), ['camel(0)']);
      expectList(fail, '{{ handler }} yields no call', h(130), []);
      expectList(fail, 'ondblclick three positions', h(132), ['save(0)', 'save(0)', 'save(0)']);
      expectList(fail, 'javascript: label inside a handler', h(133), ['hover(0)']);
      expectList(fail, 'save?.()', h(134), ['save(0)']);
      expectList(fail, 'await save()', h(135), ['save(0)']);
      expectList(fail, 'save(...args)', h(136), ['save(1)']);
      expectList(fail, 'tagged template is not a call', h(137), []);
      expectEq(fail, 'svg rect onclick', ir.handlersAtLine('svg.html', 30)[0]?.['calleeName'], 'svgClick');
      expectEq(fail, 'foreignObject ONCLICK', ir.handlersAtLine('svg.html', 32)[0]?.['calleeName'], 'backInHtml');
      expectEq(fail, 'CRLF page handler', ir.handlersAtLine('quirks.html', 8)[0]?.['calleeName'], 'crlf');
      expectEq(fail, 'xhtml onload', ir.handlersAtLine('xhtml/page.xhtml', 14)[0]?.['calleeName'], 'cdata');
      const framework = ir.handlersAtLine('index.html', 129);
      expectList(fail, 'framework event directives are TEMPLATE_EVENT, never EVENT_ATTRIBUTE', framework.map((x) => `${x['handlerSource']}:${x['calleeName']}`), ['TEMPLATE_EVENT:vue', 'TEMPLATE_EVENT:angular', 'TEMPLATE_EVENT:vueLong', 'TEMPLATE_EVENT:alpine']);
    },
  },
  {
    name: 'handlers: Svelte on:click and htmx hx-on:click are recorded as template events',
    verdict: 'GAP',
    note: 'Neither matches an on* attribute nor a known directive family; the calls (svelte(), htmx()) are not rows anywhere.',
    run: (ir, fail) => {
      const callees = ir.handlersAtLine('index.html', 129).map((x) => x['calleeName']);
      if (!callees.includes('svelte')) fail('on:click="svelte()" produced no handler call');
      if (!callees.includes('htmx')) fail('hx-on:click="htmx()" produced no handler call');
    },
  },
  {
    name: 'handlers: classes and ids named only inside script text are not class references (the JavaScript front end owns those strings)',
    verdict: 'LIMIT',
    note: "classList.add('js-ready'), getElementById('late-id'), classList.toggle('open') and querySelector('#late-id .card') are string literals in JS; the join is js_string_literal ↔ css_selector_part, made by the engine once both IRs are loaded.",
    run: (ir, fail) => {
      if (ir.ofDoc(ir.classRefs, 'index.html').some((c) => c['className'] === 'js-ready' || c['className'] === 'open')) fail('a script string became a class reference');
      else fail('.js-ready / .open / #late-id are only in script text; nothing in the web IR joins them');
    },
  },

  // ── the element tree ──────────────────────────────────────────────────────
  {
    name: 'tree: implicit closes the grammar knows (p by div, li by li, dt/dd), template contents walked, noscript walked, comments hidden, void elements lift their trailing content',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      expectEq(fail, '<p>a <div> closes the p', ir.element('index.html', '/body[1]/div[9]')?.['classNames'], 'div-in-p');
      expectEq(fail, 'p text before the div', ir.element('index.html', '/body[1]/p[1]')?.['textContent'], 'a');
      expectList(fail, 'li siblings', ir.ofDoc(ir.elements, 'index.html').filter((e) => e['path']!.startsWith('/html[1]/body[1]/ul[1]/')).map((e) => e['path']!), ['/html[1]/body[1]/ul[1]/li[1]', '/html[1]/body[1]/ul[1]/li[2]']);
      expectList(fail, 'dl children', ir.ofDoc(ir.elements, 'index.html').filter((e) => e['path']!.startsWith('/html[1]/body[1]/dl[1]/')).map((e) => e['tagName']!), ['dt', 'dd', 'dt']);
      expectEq(fail, 'template contents walked', ir.element('index.html', '/template[1]/div[1]')?.['classNames'], 'in-template');
      expectEq(fail, 'noscript contents walked', ir.element('index.html', '/noscript[1]/div[1]')?.['classNames'], 'noscript-class');
      if (ir.classRefs.some((c) => c['className'] === 'commented-out' || c['className'] === 'ie-only')) fail('a class inside an HTML comment became a reference');
      expectEq(fail, 'entities in text decoded, unknown kept', ir.element('index.html', '/div[10]/p[1]')?.['textContent'], "entities: & < tag > ' ' &unknown; ©");
      expectEq(fail, 'img is void', ir.element('index.html', '/body[1]/img[1]')?.['isVoid'], 'true');
      expectEq(fail, 'map holds its area', ir.element('index.html', '/map[1]/area[1]') !== undefined, true);
      expectEq(fail, 'custom element and slot', ir.element('index.html', '/custom-element[1]/slot[1]') !== undefined, true);
      expectEq(fail, 'is="x-foo" attribute kept', ir.attr(ir.element('index.html', '/div[10]/div[1]')!, 'is')?.['value'], 'x-foo');
      expectEq(fail, 'duplicate attributes: four gaps on lines 205-206', ir.ofDoc(ir.htmlGaps, 'index.html').filter((g) => g['detail'] === 'duplicate-attribute' && ['205', '206'].includes(g['startLine']!)).length, 4);
      expectEq(fail, 'duplicate attribute gap names its element', ir.row(ir.ofDoc(ir.htmlGaps, 'index.html').find((g) => g['startLine'] === '205')?.['relatedElementLinkHash'])?.['classNames'], 'dup-attr');
      expectEq(fail, 'quirks unterminated quote swallows to the next quote (as a browser does)', ir.element('quirks.html', '/body[1]/p[3]')?.['classNames'], 'unterminated>,<div,class=');
    },
  },
  {
    name: 'tree: browser tree-construction repairs the grammar does not do — <div/> stays open, <option> closes <option>, nested <a> closes <a>, a second <body> merges, tbody is implied',
    verdict: 'GAP',
    note: 'tree-sitter-html builds the tree as written. An engine comparing selectors like `table > tbody > tr` or paths after a self-closing non-void tag needs these repairs; either the parser runs the HTML tree-construction rules (adding isImplied rows) or the engine does.',
    run: (ir, fail) => {
      if (ir.element('index.html', '/body[1]/span[1]') !== undefined) fail('<div/> followed by <span>: span is a sibling, a browser makes it a child');
      if (ir.element('index.html', '/option[1]/option[1]') !== undefined) fail('<option>one<option>two: the second option is nested, a browser closes the first');
      if (ir.element('index.html', '/a[1]/a[1]') !== undefined) fail('<a><a>: nested, a browser closes the outer anchor');
      if (ir.element('index.html', '/body[1]/body[1]') !== undefined) fail('<body background> inside body: a second body element, a browser merges the attribute');
      if (!ir.elements.some((e) => e['tagName'] === 'tbody')) fail('no tbody anywhere: `table > tbody > tr` can never match the written tree');
    },
  },
  {
    name: 'tree: id-less, class-less wrappers still have rows and parents the matcher can walk',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const td = ir.element('index.html', '/table[1]/tr[1]/td[1]');
      if (!expectRow(fail, 'td', td)) return;
      const chain: string[] = [];
      for (let e: Row | undefined = td; e !== undefined; e = ir.row(e['parentElementLinkHash'])) chain.push(e['tagName']!);
      expectList(fail, 'td ancestry', chain, ['td', 'tr', 'table', 'body', 'html']);
      expectEq(fail, 'td depth', td['depth'], '4');
      expectEq(fail, 'table childElementCount', ir.element('index.html', '/body[1]/table[1]')?.['childElementCount'], '1');
      expectEq(fail, 'sibling positions', ir.element('index.html', '/ul[1]/li[2]')?.['position'], '1');
    },
  },
  {
    name: 'template expressions: directives and interpolations of every dialect are rows with their callee names',
    verdict: 'DEFECT',
    run: (ir, fail) => {
      const mixed = ir.ofDoc(ir.templateExpressions, 'templates/mixed.html');
      const kinds = new Set(mixed.map((t) => `${t['dialect']}:${t['expressionKind']}`));
      for (const want of ['THYMELEAF:BINDING', 'ANGULAR:CONDITION', 'ANGULAR:EVENT_HANDLER', 'ANGULAR:MODEL', 'VUE:CONDITION', 'VUE:BINDING', 'VUE:EVENT_HANDLER', 'ALPINE:EVENT_HANDLER', 'HTMX:REQUEST', 'ERB:INTERPOLATION', 'PHP:DIRECTIVE']) {
        if (!kinds.has(want)) fail(`mixed.html lacks ${want}`);
      }
      expectEq(fail, '(click)="toggle()" callee', mixed.find((t) => t['directive'] === '(click)')?.['calleeNames'], 'toggle');
      expectEq(fail, 'jinja has JINJA directives', ir.ofDoc(ir.templateExpressions, 'templates/jinja.html').filter((t) => t['dialect'] === 'JINJA').length > 10, true);
    },
  },
];

// ===========================================================================
// probes: the parsers on micro-inputs, for cases a fixture file states less sharply
// ===========================================================================

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-web-torture-probe-'));
function probeFile(rel: string, content: string): string {
  const p = path.join(TMP, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}
function css(text: string): CssExtraction {
  const p = probeFile('site/x.css', text);
  const sheet = new CssStylesheet({
    name: 'x', fileName: 'x.css', filePath: p, baseMservPath: path.join(TMP, 'site'), relativePath: 'x.css', sourceKind: CssStylesheetSource.FILE,
    sourceProvenance: CssSourceProvenance.PROJECT, ownerHtmlElementLinkHash: '', htmlDocumentLinkHash: '', startLine: 1, startColumn: 1, endLine: 1, serviceVersionLinkHash: 'V',
  });
  return new CssParser().parseStylesheet(text, { stylesheet: sheet, line: 1, column: 1, filePath: p, projectRoot: path.join(TMP, 'site'), serviceVersionLinkHash: 'V' });
}
function html(text: string, rel = 'site/page.html'): HtmlExtraction {
  const p = probeFile(rel, text);
  return new HtmlParser().parse(text, p, path.join(TMP, 'site'), 'V');
}

export const PROBES: Check[] = [
  {
    name: 'probe: `.x { color red; a: b; c: d }` keeps a and c',
    verdict: 'DEFECT',
    run: (_ir, fail) => {
      expectList(fail, 'declarations', css('.x { color red; a: b; c: d }').declarations.map((d) => d.property), ['a', 'c']);
    },
  },
  {
    name: 'probe: `!IMPORTANT` and `! important` are both important',
    verdict: 'DEFECT',
    run: (_ir, fail) => {
      expectList(fail, 'flags', css('.x { a: 1 !IMPORTANT; b: 2 ! important; c: 3 !Important }').declarations.map((d) => `${d.property}:${d.isImportant}`), ['a:true', 'b:true', 'c:true']);
    },
  },
  {
    name: 'probe: url( "a.png" ) with spaces around a quoted path is the path',
    verdict: 'DEFECT',
    run: (_ir, fail) => {
      expectList(fail, 'refs', css('.x { a: url( "a.png" ); b: url(  b.png  ) }').valueReferences.map((v) => v.name), ['a.png', 'b.png']);
    },
  },
  {
    name: 'probe: `URL(a.png)` and `Url(a.png)` are url() references',
    verdict: 'DEFECT',
    run: (_ir, fail) => {
      expectList(fail, 'refs', css('.x { a: URL(a.png); b: Url("b.png") }').valueReferences.map((v) => v.name), ['a.png', 'b.png']);
    },
  },
  {
    name: 'probe: a string with CSS syntax inside is one value and no reference',
    verdict: 'DEFECT',
    run: (_ir, fail) => {
      const x = css('.x { content: "a; } b { c: d }"; e: f; g: "url(h.png) var(--i)" }');
      expectList(fail, 'declarations', x.declarations.map((d) => d.property), ['content', 'e', 'g']);
      expectEq(fail, 'references', x.valueReferences.length, 0);
    },
  },
  {
    name: 'probe: `:nth-child(2n of .one, .two)` argument parts are named from their own text',
    verdict: 'DEFECT',
    run: (_ir, fail) => {
      const x = css('@charset "utf-8";\nli:nth-child(2n of .one, .two) { a: b }');
      expectList(fail, 'parts', x.selectorParts.map((p) => `${p.partKind}:${p.name}@${p.depth}`), ['TYPE:li@0', 'PSEUDO_CLASS:nth-child@0', 'CLASS:one@1', 'CLASS:two@1']);
    },
  },
  {
    name: 'probe: srcset candidates per the HTML algorithm — a comma inside the URL does not split',
    verdict: 'DEFECT',
    run: (_ir, fail) => {
      const x = html('<img srcset="a.png?x=1,2 100w, b.png 2x,c.png">');
      expectList(fail, 'candidates', x.references.map((r) => r.urlAsWritten), ['a.png?x=1,2', 'b.png', 'c.png']);
    },
  },
  {
    name: 'probe: a percent-encoded relative URL resolves to the decoded file',
    verdict: 'DEFECT',
    run: (_ir, fail) => {
      probeFile('site/img/space name.png', '');
      const x = html('<img src="img/space%20name.png"><img src="img/space name.png">');
      expectList(fail, 'resolved', x.references.map((r) => String(r.isResolved)), ['true', 'true']);
    },
  },
  {
    name: 'probe: resolution is case-sensitive even on a case-insensitive file system (INDEX.HTML must not resolve to index.html)',
    verdict: 'LIMIT',
    note: 'fs.statSync answers yes on macOS and Windows and no on Linux, so the same source yields a different IR per OS. Compare the URL against the directory listing to make resolution portable.',
    run: (_ir, fail) => {
      probeFile('site/index.html', '');
      const x = html('<a href="INDEX.HTML">x</a>', 'site/other.html');
      if (x.references[0]?.isResolved) fail('INDEX.HTML resolved on this file system; it would not on Linux');
    },
  },
  {
    name: 'probe: `<option>one<option>two` are siblings',
    verdict: 'GAP',
    note: 'The grammar\'s implicit-end-tag set lacks option (and optgroup, tr/td/th, thead/tbody). A browser closes them.',
    run: (_ir, fail) => {
      expectList(fail, 'paths', html('<select><option>one<option>two</select>').elements.map((e) => e.path), ['/select[1]', '/select[1]/option[1]', '/select[1]/option[2]']);
    },
  },
  {
    name: 'probe: `<div/>` followed by `<span>` makes the span a child (self-closing is ignored on non-void HTML elements)',
    verdict: 'GAP',
    note: 'tree-sitter-html honours the slash. In a .html file the browser does not; in a .xhtml file it does, so the fix must be per document kind.',
    run: (_ir, fail) => {
      expectList(fail, 'paths', html('<div/><span>s</span>').elements.map((e) => e.path), ['/div[1]', '/div[1]/span[1]']);
    },
  },
  {
    name: 'probe: a nested @media with bare declarations and a nested rule yields both, owned correctly',
    verdict: 'DEFECT',
    run: (_ir, fail) => {
      const x = css('.a { color: red; @media (x) { color: blue; .b { color: green } } }');
      const media = x.rules.find((r) => r.atRuleName === 'media')!;
      expectEq(fail, '@media declaration count', media.getDeclarationCount(), 1);
      expectEq(fail, '@media child rules', media.getChildRuleCount(), 1);
      expectEq(fail, '.b parent is @media', x.rules.find((r) => r.preludeText === '.b')?.parentRuleLinkHash, media.getHash());
      expectEq(fail, '.a declaration count excludes the nested one', x.rules.find((r) => r.preludeText === '.a')?.getDeclarationCount(), 1);
    },
  },
];
