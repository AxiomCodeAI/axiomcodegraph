/**
 * WEB (HTML + CSS) TESTS — one file, mirroring services-tests.ts.
 *
 *     npx tsx src/test/web-tests.ts            # everything
 *     npx tsx src/test/web-tests.ts --list     # what runs, and what it proves
 *     npx tsx src/test/web-tests.ts --bless    # rewrite the goldens
 *
 * NO BROWSER, NO NETWORK. Every check runs the parser and compares the result
 * with expectations in this file or checked into src/test-data/web.
 *
 * ## What this suite can and cannot do
 *
 * The golden is drift detection: it was produced by this parser and agrees with
 * whatever the parser currently does, mistakes included.
 *
 * The format checks are the part that can find a defect. Each is written from
 * the HTML or CSS specification (the parsing algorithm, the Selectors specificity
 * rules, the URL syntax) rather than from parser output, and each names the
 * plausible wrong implementation it rules out — a reader that splits `class` on
 * spaces only, a specificity that counts `:where()`, a resolver that follows
 * `../..` out of the project. A check no plausible implementation fails proves
 * nothing, so the `rules out` line is part of the check.
 *
 * The structural checks — primary-key uniqueness, foreign-key integrity across
 * the sixteen relations, arity against the frozen schema, enum domains, and
 * determinism across two runs — are the ones that catch what a fixture cannot
 * foresee.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CssStylesheet } from '@/analysis-types/css/CssStylesheet';
import { WEB_CSV_FILES, WEB_PARSE_GAP_LIMIT } from '@/constants/web-constants';
import { CssSourceProvenance, CssStylesheetSource } from '@/enums/css/CssStylesheetSource';
import { CssParseGapKind } from '@/enums/css/CssParseGapKind';
import { CssSelectorPartKind, CssCombinator } from '@/enums/css/CssSelectorPartKind';
import { CssValueReferenceKind } from '@/enums/css/CssValueReferenceKind';
import { HtmlAttributeKind } from '@/enums/html/HtmlAttributeKind';
import { HtmlDocumentKind } from '@/enums/html/HtmlDocumentKind';
import { HtmlHandlerSource } from '@/enums/html/HtmlHandlerSource';
import { HtmlNamespace } from '@/enums/html/HtmlNamespace';
import { HtmlParseGapKind } from '@/enums/html/HtmlParseGapKind';
import { HtmlScriptKind, HtmlScriptType } from '@/enums/html/HtmlScriptKind';
import { HtmlTemplateDialect } from '@/enums/html/HtmlTemplateDialect';
import { WebUrlKind } from '@/enums/web/WebUrlKind';
import * as CssEnums from '@/enums/css';
import * as HtmlEnums from '@/enums/html';
import * as WebEnums from '@/enums/web';
import { CssExtraction, CssParser } from '@/parsers/css/css-parser';
import { HtmlExtraction, HtmlParser } from '@/parsers/html/html-parser';
import { WebProjectAnalyzer } from '@/workflows/web/web-project-analyzer';

const DATA = 'src/test-data/web';
const GOLDEN = path.join(DATA, '_golden');
const SCHEMA = JSON.parse(fs.readFileSync('src/schema/web/schema.json', 'utf-8')) as {
  relations: Record<string, { columns: string[]; domains?: Record<string, string[]>; commaSets?: string[] }>;
};

/** The values a cell holds: one, or every member of a comma-set column. */
function cellValues(relation: string, column: string, cell: string): string[] {
  if (cell === '') return [];
  return (SCHEMA.relations[relation]?.commaSets ?? []).includes(column) ? cell.split(',') : [cell];
}
const BLESS = process.argv.includes('--bless');

/** Columns that cannot be compared across machines: absolute paths. */
const VOLATILE = /^(baseMservPath|filePath|resolvedFilePath)$/;
const HASH_COLUMN = /(Hash|hash)$/;

type Row = Record<string, string>;

const fail = (m: string): number => { console.log('  ✗ ' + m); return 1; };

// ---------------------------------------------------------------------------
// format checks — from the specifications, in memory, no fixture tree
// ---------------------------------------------------------------------------

/** A throwaway directory for checks that need real files to resolve against. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-web-'));
function file(rel: string, content = ''): string {
  const p = path.join(TMP, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function parseHtml(content: string, rel = 'site/page.html'): HtmlExtraction {
  const p = file(rel, content);
  return new HtmlParser().parse(content, p, path.join(TMP, 'site'), 'WEB_FIXTURE_VERSION');
}

function parseCss(content: string, rel = 'site/css/x.css', origin = { line: 1, column: 1 }): CssExtraction & { sheet: CssStylesheet } {
  const p = file(rel, content);
  const sheet = new CssStylesheet({
    name: 'x', fileName: path.basename(p), filePath: p, baseMservPath: path.join(TMP, 'site'), relativePath: rel,
    sourceKind: CssStylesheetSource.FILE, sourceProvenance: CssSourceProvenance.PROJECT, ownerHtmlElementLinkHash: '',
    htmlDocumentLinkHash: '', startLine: 1, startColumn: 1, endLine: 1, serviceVersionLinkHash: 'WEB_FIXTURE_VERSION',
  });
  const x = new CssParser().parseStylesheet(content, {
    stylesheet: sheet, line: origin.line, column: origin.column, filePath: p, projectRoot: path.join(TMP, 'site'),
    serviceVersionLinkHash: 'WEB_FIXTURE_VERSION',
  });
  return { ...x, sheet };
}

/** (a,b,c) of the first selector of the first rule. */
function specificity(selector: string): string {
  const s = parseCss(`${selector} { color: red }`).selectors[0]!;
  return `${s.specificityA},${s.specificityB},${s.specificityC}`;
}

function col(text: string, needle: string, occurrence = 1): { line: number; column: number } {
  let from = 0;
  let at = -1;
  for (let i = 0; i < occurrence; i += 1) {
    at = text.indexOf(needle, from);
    from = at + 1;
  }
  const before = text.slice(0, at);
  const line = before.split('\n').length;
  const column = at - (before.lastIndexOf('\n') + 1) + 1;
  return { line, column };
}

interface FormatCheck {
  name: string;
  /** The clause of the specification this check comes from. */
  spec: string;
  /** The plausible wrong implementation this check fails. */
  rulesOut: string;
  run: () => number;
}

const formatChecks: FormatCheck[] = [
  // ── HTML: the tree ──────────────────────────────────────────────────────
  {
    name: 'a-fragment-is-the-elements-written-and-nothing-implied',
    spec: 'the grammar builds the elements written; the html, head and body a browser implies are not in the source',
    rulesOut: 'a reader that invents wrapper rows, or that calls a snippet a whole page',
    run: () => {
      const x = parseHtml('<p>only a paragraph</p>');
      let bad = 0;
      const tags = x.elements.map((e) => e.tagName).join(' ');
      if (tags !== 'p') bad += fail(`elements=${tags}, expected p alone`);
      if (x.document.documentKind !== HtmlDocumentKind.FRAGMENT) bad += fail(`documentKind=${x.document.documentKind}`);
      const p = x.elements[0]!;
      if (p.parentElementLinkHash !== '' || p.path !== '/p[1]' || p.depth !== 0) bad += fail(`a top-level element reads as ${p.path} at depth ${p.depth} with parent ${JSON.stringify(p.parentElementLinkHash)}`);
      const whole = parseHtml('<!DOCTYPE html><html><body><p>x</p></body></html>');
      if (whole.document.documentKind !== HtmlDocumentKind.DOCUMENT || whole.document.doctype !== 'html') {
        bad += fail(`a full document reads as ${whole.document.documentKind} with doctype ${JSON.stringify(whole.document.doctype)}`);
      }
      if (whole.elements.map((e) => e.path).join(' ') !== '/html[1] /html[1]/body[1] /html[1]/body[1]/p[1]') bad += fail(`paths=${whole.elements.map((e) => e.path).join(' ')}`);
      const noDoctype = parseHtml('<html><body></body></html>');
      if (noDoctype.document.documentKind !== HtmlDocumentKind.DOCUMENT) bad += fail('a page with <html> and no doctype reads as a fragment');
      return bad;
    },
  },
  {
    name: 'a-paragraph-is-closed-by-the-next-one',
    spec: 'a p element\'s end tag may be omitted if it is immediately followed by another p',
    rulesOut: 'a reader that nests the second p inside the first',
    run: () => {
      const text = '<div>\n<p>one\n<p>two\n</div>';
      const x = parseHtml(text);
      const ps = x.elements.filter((e) => e.tagName === 'p');
      let bad = 0;
      if (ps.length !== 2) return fail(`${ps.length} p elements, expected 2`);
      if (ps[0]!.path !== '/div[1]/p[1]' || ps[1]!.path !== '/div[1]/p[2]') {
        bad += fail(`paths ${ps.map((p) => p.path).join(' ')}: the second p is a sibling, not a child`);
      }
      if (ps[0]!.endLine !== 3) bad += fail(`first p ends on line ${ps[0]!.endLine}, expected 3 where the second opens`);
      if (ps[0]!.textContent !== 'one' || ps[1]!.textContent !== 'two') bad += fail('text content crossed the implicit close');
      if (ps[0]!.position !== 0 || ps[1]!.position !== 1) bad += fail('positions are not the sibling ordinals');
      return bad;
    },
  },
  {
    name: 'template-content-is-walked',
    spec: 'a template element\'s contents are a DocumentFragment, not children of the element',
    rulesOut: 'a walker that reads childNodes and finds the template empty',
    run: () => {
      const x = parseHtml('<template><span class="tpl">t</span></template>');
      const span = x.elements.find((e) => e.tagName === 'span');
      if (span === undefined) return fail('no span inside the template');
      let bad = 0;
      if (span.path !== '/template[1]/span[1]') bad += fail(`path=${span.path}`);
      if (!x.classReferences.some((c) => c.className === 'tpl')) bad += fail('the class inside the template was not read');
      return bad;
    },
  },
  {
    name: 'a-void-element-has-no-end-tag-and-no-children',
    spec: 'void elements have no end tag and never have contents',
    rulesOut: 'a reader that swallows the following text into the img',
    run: () => {
      const x = parseHtml('<p><img src="a.png">after</p>');
      const img = x.elements.find((e) => e.tagName === 'img')!;
      const p = x.elements.find((e) => e.tagName === 'p')!;
      let bad = 0;
      if (!img.isVoid) bad += fail('img is not void');
      const expectedEnd = '<p><img src="a.png">'.length + 1;
      if (img.endColumn !== expectedEnd) bad += fail(`img ends at column ${img.endColumn}, expected ${expectedEnd} (just past its start tag)`);
      if (p.textContent !== 'after') bad += fail(`p text=${JSON.stringify(p.textContent)}`);
      return bad;
    },
  },
  {
    name: 'foreign-content-keeps-its-namespace-and-prefixed-attributes',
    spec: 'svg and MathML elements are in their own namespaces; xlink:href is a prefixed attribute',
    rulesOut: 'a reader that lowercases viewBox or loses the xlink prefix',
    run: () => {
      const x = parseHtml('<svg viewBox="0 0 1 1"><use xlink:href="#a"/><image href="pic.png"/></svg>');
      const svg = x.elements.find((e) => e.tagName === 'svg')!;
      let bad = 0;
      if (svg.namespace !== HtmlNamespace.SVG) bad += fail(`svg namespace=${svg.namespace}`);
      if (!x.attributes.some((a) => a.name === 'viewBox')) bad += fail('viewBox lost its case');
      const xlink = x.attributes.find((a) => a.prefix === 'xlink');
      if (xlink === undefined || xlink.name !== 'href' || xlink.attributeKind !== HtmlAttributeKind.URL) {
        bad += fail('xlink:href is not a prefixed URL attribute');
      }
      const ref = x.references.find((r) => r.attributeName === 'xlink:href');
      if (ref === undefined || ref.urlKind !== WebUrlKind.FRAGMENT || ref.fragment !== 'a') bad += fail('xlink:href="#a" is not a FRAGMENT reference to a');
      return bad;
    },
  },
  // ── HTML: attributes ────────────────────────────────────────────────────
  {
    name: 'a-value-less-attribute-is-distinguished-from-an-empty-one',
    spec: 'an attribute without a value has the empty string as its value',
    rulesOut: 'a reader that records both as value="" and cannot tell disabled from disabled=""',
    run: () => {
      const x = parseHtml('<input disabled required="" value=\'\' data-x = "y">');
      const by = Object.fromEntries(x.attributes.map((a) => [a.name, a]));
      let bad = 0;
      if (by['disabled']?.hasValue !== false) bad += fail('disabled reports a value');
      if (by['required']?.hasValue !== true) bad += fail('required="" reports no value');
      if (by['value']?.hasValue !== true) bad += fail("value='' reports no value");
      if (by['data-x']?.value !== 'y' || by['data-x']?.attributeKind !== HtmlAttributeKind.DATA) bad += fail('data-x = "y" with spaces around = was misread');
      return bad;
    },
  },
  {
    name: 'a-duplicate-attribute-keeps-the-first-and-records-a-gap',
    spec: 'the first attribute with a name wins; a repeat is a parse error',
    rulesOut: 'a reader that emits two rows for one attribute name and collides their keys (the grammar reports no duplicate)',
    run: () => {
      const x = parseHtml('<div id="a" id="b"></div>');
      const ids = x.attributes.filter((a) => a.name === 'id');
      let bad = 0;
      if (ids.length !== 1 || ids[0]!.value !== 'a') bad += fail(`id rows=${ids.map((a) => a.value).join(',')}, expected the first, a`);
      if (!x.parseGaps.some((g) => g.gapKind === HtmlParseGapKind.PARSE_ERROR && g.detail === 'duplicate-attribute')) {
        bad += fail('no duplicate-attribute gap');
      }
      if (x.elements.find((e) => e.tagName === 'div')!.id !== 'a') bad += fail('element id is not the first');
      return bad;
    },
  },
  {
    name: 'class-tokens-split-on-ascii-whitespace-and-keep-repeats',
    spec: 'the class attribute is a set of space-separated tokens; the tokenizer splits on space, tab, LF, FF, CR',
    rulesOut: 'a reader that splits on a single space or deduplicates',
    run: () => {
      const x = parseHtml('<div class=" a\tb\n\n c  a ">');
      const got = x.classReferences.map((c) => `${c.position}:${c.className}`).join(' ');
      let bad = 0;
      if (got !== '0:a 1:b 2:c 3:a') bad += fail(`tokens=${got}`);
      if (new Set(x.classReferences.map((c) => c.getHash())).size !== 4) bad += fail('two occurrences of one class share a key');
      const div = x.elements.find((e) => e.tagName === 'div')!;
      if (div.toCsv().split('\t')[5] !== 'a,b,c,a') bad += fail(`classNames column=${div.toCsv().split('\t')[5]}`);
      return bad;
    },
  },
  {
    name: 'attribute-kinds-follow-the-name',
    spec: 'on* attributes are event handler content attributes; data-* and aria-* are reserved prefixes',
    rulesOut: 'a classifier that calls a Vue @click or an Alpine x-on an event handler',
    run: () => {
      const x = parseHtml('<div onclick="a()" @click="b" v-if="c" x-data="{}" hx-get="/x" th:text="t" data-q="1" aria-hidden="true" role="x" for="i" form="f" rel="x" type="t" name="n" style="" ng-if="y" [prop]="z" (ev)="w"></div>');
      const by = Object.fromEntries(x.attributes.map((a) => [a.name, a.attributeKind]));
      const want: Record<string, HtmlAttributeKind> = {
        onclick: HtmlAttributeKind.EVENT_HANDLER, '@click': HtmlAttributeKind.TEMPLATE_DIRECTIVE, 'v-if': HtmlAttributeKind.TEMPLATE_DIRECTIVE,
        'x-data': HtmlAttributeKind.TEMPLATE_DIRECTIVE, 'hx-get': HtmlAttributeKind.TEMPLATE_DIRECTIVE, 'th:text': HtmlAttributeKind.TEMPLATE_DIRECTIVE,
        'data-q': HtmlAttributeKind.DATA, 'aria-hidden': HtmlAttributeKind.ARIA, role: HtmlAttributeKind.ARIA, for: HtmlAttributeKind.FOR,
        form: HtmlAttributeKind.ID_REFERENCE, rel: HtmlAttributeKind.REL, type: HtmlAttributeKind.TYPE, name: HtmlAttributeKind.NAME,
        style: HtmlAttributeKind.STYLE, 'ng-if': HtmlAttributeKind.TEMPLATE_DIRECTIVE, '[prop]': HtmlAttributeKind.TEMPLATE_DIRECTIVE,
        '(ev)': HtmlAttributeKind.TEMPLATE_DIRECTIVE,
      };
      let bad = 0;
      for (const [name, kind] of Object.entries(want)) {
        if (by[name] !== kind) bad += fail(`${name}: ${by[name]}, expected ${kind}`);
      }
      // `@click="b"` is a template event: Vue calls the handler it names, and the row says so by its source.
      const b = x.handlerCalls.find((h) => h.calleeName === 'b');
      if (b === undefined || b.handlerSource !== HtmlHandlerSource.TEMPLATE_EVENT || b.argumentCount !== 0) bad += fail('a template event directive is not a TEMPLATE_EVENT handler call');
      if (x.handlerCalls.some((h) => h.handlerSource === HtmlHandlerSource.EVENT_ATTRIBUTE && h.calleeName !== 'a')) bad += fail('a template directive was read as an on* handler');
      const dialects = [...x.document.templateDialects].sort().join(',');
      if (!dialects.includes('ALPINE') || !dialects.includes('HTMX') || !dialects.includes('THYMELEAF') || !dialects.includes('VUE') || !dialects.includes('ANGULAR')) {
        bad += fail(`dialects=${dialects}`);
      }
      return bad;
    },
  },
  // ── HTML: URLs ──────────────────────────────────────────────────────────
  {
    name: 'url-kinds-are-decided-from-the-text',
    spec: 'URL parsing: scheme, host-relative, path-absolute, path-relative and fragment-only forms',
    rulesOut: 'a classifier that treats mailto: as a relative path or #x as a file',
    run: () => {
      const cases: Array<[string, WebUrlKind, string?]> = [
        ['a/b.css', WebUrlKind.RELATIVE], ['./a.js', WebUrlKind.RELATIVE], ['../x', WebUrlKind.RELATIVE],
        ['/static/a.js', WebUrlKind.ROOT_RELATIVE], ['https://h/x.js', WebUrlKind.ABSOLUTE], ['HTTP://h/x', WebUrlKind.ABSOLUTE],
        ['//cdn/x.js', WebUrlKind.PROTOCOL_RELATIVE], ['#team', WebUrlKind.FRAGMENT, 'team'], ['data:image/png;base64,AAA', WebUrlKind.DATA_URI],
        ['javascript:go()', WebUrlKind.JAVASCRIPT_URI], ['mailto:a@b', WebUrlKind.OTHER_SCHEME], ['tel:123', WebUrlKind.OTHER_SCHEME],
        ['{{ url_for("x") }}', WebUrlKind.TEMPLATE_EXPRESSION], ['/static/{{ name }}.js', WebUrlKind.TEMPLATE_EXPRESSION],
        ['<%= path %>', WebUrlKind.TEMPLATE_EXPRESSION], ['${ctx}/x', WebUrlKind.TEMPLATE_EXPRESSION], ['', WebUrlKind.EMPTY],
        ['  ', WebUrlKind.EMPTY],
      ];
      let bad = 0;
      for (const [url, kind, fragment] of cases) {
        const x = parseHtml(`<a href="${url.replace(/"/g, '&quot;')}">x</a>`);
        const r = x.references[0];
        if (r === undefined) { bad += fail(`${JSON.stringify(url)}: no reference`); continue; }
        if (r.urlKind !== kind) bad += fail(`${JSON.stringify(url)}: ${r.urlKind}, expected ${kind}`);
        if (fragment !== undefined && r.fragment !== fragment) bad += fail(`${JSON.stringify(url)}: fragment=${r.fragment}`);
      }
      const split = parseHtml('<a href="page.html?x=1&y=2#top">x</a>').references[0]!;
      if (split.path !== 'page.html' || split.query !== 'x=1&y=2' || split.fragment !== 'top') {
        bad += fail(`split: path=${split.path} query=${split.query} fragment=${split.fragment}`);
      }
      return bad;
    },
  },
  {
    name: 'a-relative-url-resolves-against-the-file-and-never-outside-the-root',
    spec: 'a relative reference resolves against the base URL, which defaults to the document\'s',
    rulesOut: 'a resolver that follows ../.. out of the project, or resolves to a file that is not there',
    run: () => {
      file('site/css/present.css', 'a{}');
      file('outside.css', 'b{}');
      const x = parseHtml('<link rel="stylesheet" href="css/present.css"><link rel="stylesheet" href="css/absent.css"><link rel="stylesheet" href="../outside.css">', 'site/page.html');
      const by = Object.fromEntries(x.references.map((r) => [r.urlAsWritten, r]));
      let bad = 0;
      if (by['css/present.css']?.resolvedFilePath !== path.join(TMP, 'site/css/present.css') || !by['css/present.css']?.isResolved) {
        bad += fail('a present file was not resolved');
      }
      if (by['css/absent.css']?.isResolved !== false) bad += fail('an absent file reads as resolved');
      if (by['../outside.css']?.isResolved !== false) bad += fail('a file outside the project root was resolved');
      if (x.document.toCsv().split('\t')[14] !== '3') bad += fail(`stylesheetReferenceCount=${x.document.toCsv().split('\t')[14]}, expected 3`);
      return bad;
    },
  },
  {
    name: 'a-root-relative-url-resolves-only-when-one-served-root-holds-it',
    spec: 'a path-absolute URL resolves against the origin, which the repository does not record',
    rulesOut: 'a resolver that guesses between two candidate roots, or never resolves /static/x',
    run: () => {
      file('app/public/static/one.js', '');
      file('app/pages/deep/page.html', '');
      file('app/public/static/two.js', '');
      file('app/pages/static/two.js', '');
      const content = '<script src="/static/one.js"></script><script src="/static/two.js"></script><script src="/static/none.js"></script>';
      const p = file('app/pages/deep/page.html', content);
      const x = new HtmlParser().parse(content, p, path.join(TMP, 'app'), 'V');
      const by = Object.fromEntries(x.references.map((r) => [r.urlAsWritten, r]));
      let bad = 0;
      if (by['/static/one.js']?.resolvedFilePath !== path.join(TMP, 'app/public/static/one.js')) {
        bad += fail(`one candidate: resolved to ${JSON.stringify(by['/static/one.js']?.resolvedFilePath)}`);
      }
      if (by['/static/two.js']?.isResolved !== false) bad += fail('two candidates were not refused');
      if (by['/static/none.js']?.isResolved !== false) bad += fail('no candidate reads as resolved');
      const script = x.scripts.find((s) => s.src === '/static/one.js')!;
      if (script.resolvedFilePath !== by['/static/one.js']!.resolvedFilePath || script.referenceLinkHash !== by['/static/one.js']!.getHash()) {
        bad += fail('the script row does not carry its reference\'s resolution');
      }
      return bad;
    },
  },
  {
    name: 'reference-kinds-follow-the-element',
    spec: 'link rel=stylesheet is a stylesheet, source in picture is an image, elsewhere media',
    rulesOut: 'a classifier that keys on the attribute name alone',
    run: () => {
      const x = parseHtml(
        '<link rel="stylesheet" href="a.css"><link rel="icon" href="i.png"><link rel="preload stylesheet" href="b.css">'
        + '<picture><source srcset="p.webp"><img src="p.png"></picture><video src="v.mp4" poster="v.png"><source src="v.webm"></video>'
        + '<input type="image" src="btn.png"><input type="text" src="x"><form action="/f"><button formaction="/g">b</button></form>'
        + '<iframe src="f.html"></iframe><object data="o.swf"></object><base href="/"><a href="l"></a><area href="m">'
        + '<meta http-equiv="refresh" content="0; url=next.html">'
      );
      const got = x.references.map((r) => `${r.referenceKind}:${r.urlAsWritten}`).sort().join(' ');
      const want = [
        'STYLESHEET:a.css', 'LINK_RESOURCE:i.png', 'STYLESHEET:b.css', 'IMAGE:p.webp', 'IMAGE:p.png', 'MEDIA:v.mp4', 'MEDIA:v.png',
        'MEDIA:v.webm', 'IMAGE:btn.png', 'OTHER:x', 'FORM_ACTION:/f', 'FORM_ACTION:/g', 'FRAME:f.html', 'FRAME:o.swf', 'BASE:/',
        'ANCHOR:l', 'ANCHOR:m', 'META_REFRESH:next.html',
      ].sort().join(' ');
      return got === want ? 0 : fail(`got  ${got}\n      want ${want}`);
    },
  },
  {
    name: 'srcset-candidates-are-separate-references',
    spec: 'a srcset is a comma-separated list of candidates, each a URL and an optional descriptor',
    rulesOut: 'a reader that records the whole attribute as one URL',
    run: () => {
      const x = parseHtml('<img srcset="a.png 1x, b.png 2x,c.png 100w" src="d.png">');
      const got = x.references.map((r) => `${r.position}:${r.urlAsWritten}`).join(' ');
      return got === '0:a.png 1:b.png 2:c.png 0:d.png' ? 0 : fail(`got ${got}`);
    },
  },
  // ── HTML: handlers and scripts ──────────────────────────────────────────
  {
    name: 'every-call-in-a-handler-is-a-row-at-its-column',
    spec: 'an event handler content attribute\'s value is a FunctionBody',
    rulesOut: 'a reader that keeps the first call only, or cites the attribute instead of the call',
    run: () => {
      const text = '<p>\n  <a href="javascript:toggle()" onclick="track(\'nav\', this); if (confirm(\'?\')) app.ui.remove(1); new Audio(\'x\')">x</a>';
      const x = parseHtml(text);
      const got = x.handlerCalls.map((h) => `${h.handlerSource === 'JAVASCRIPT_URL' ? 'url' : h.eventName}:${h.calleeText}/${h.calleeName}/${h.receiverText}/${h.argumentCount}${h.isNew ? '/new' : ''}`).join(' ');
      const want = 'url:toggle/toggle//0 click:track/track//2 click:confirm/confirm//1 click:app.ui.remove/remove/app.ui/1 click:Audio/Audio//1/new';
      let bad = 0;
      if (got !== want) bad += fail(`got  ${got}\n      want ${want}`);
      const remove = x.handlerCalls.find((h) => h.calleeName === 'remove')!;
      const at = col(text, 'app.ui.remove');
      if (remove.startLine !== at.line || remove.startColumn !== at.column) {
        bad += fail(`remove cited at ${remove.startLine}:${remove.startColumn}, written at ${at.line}:${at.column}`);
      }
      const toggle = x.handlerCalls.find((h) => h.calleeName === 'toggle')!;
      const tat = col(text, 'toggle()');
      if (toggle.startLine !== tat.line || toggle.startColumn !== tat.column) bad += fail(`toggle cited at ${toggle.startLine}:${toggle.startColumn}, written at ${tat.line}:${tat.column}`);
      if (x.parseGaps.length !== 0) bad += fail(`gaps on well-formed handlers: ${x.parseGaps.map((g) => g.detail).join('; ')}`);
      return bad;
    },
  },
  {
    name: 'a-handler-that-is-not-javascript-is-a-gap-not-a-call',
    spec: 'a template placeholder in a handler is not a FunctionBody until rendered',
    rulesOut: 'a reader that silently drops the attribute, or invents a call named handler',
    run: () => {
      const x = parseHtml('<button onclick="{{ handler }}">x</button><button onclick="save(">y</button>');
      let bad = 0;
      const gaps = x.parseGaps.filter((g) => g.gapKind === HtmlParseGapKind.HANDLER_SYNTAX);
      if (gaps.length !== 2) bad += fail(`${gaps.length} handler gaps, expected 2: ${x.parseGaps.map((g) => g.detail).join('; ')}`);
      if (x.handlerCalls.some((h) => h.calleeName === 'handler')) bad += fail('a placeholder became a call');
      if (!x.handlerCalls.some((h) => h.calleeName === 'save')) bad += fail('the call the recovered tree still holds was dropped');
      return bad;
    },
  },
  {
    name: 'script-type-decides-what-the-browser-does-with-the-body',
    spec: 'the type attribute: absent or a JavaScript MIME type runs; module; importmap; anything else is a data block',
    rulesOut: 'a reader that runs every script or none',
    run: () => {
      const types: Array<[string, HtmlScriptType]> = [
        ['', HtmlScriptType.CLASSIC], ['text/javascript', HtmlScriptType.CLASSIC], ['application/javascript', HtmlScriptType.CLASSIC],
        ['module', HtmlScriptType.MODULE], ['importmap', HtmlScriptType.IMPORTMAP], ['speculationrules', HtmlScriptType.SPECULATION_RULES],
        ['application/json', HtmlScriptType.JSON], ['application/ld+json', HtmlScriptType.JSON], ['text/x-template', HtmlScriptType.TEMPLATE],
        ['text/x-handlebars-template', HtmlScriptType.TEMPLATE], ['text/babel', HtmlScriptType.TRANSPILED], ['text/x-mathjax-config', HtmlScriptType.DATA_BLOCK],
      ];
      let bad = 0;
      for (const [type, want] of types) {
        const x = parseHtml(`<script${type === '' ? '' : ` type="${type}"`}>1</script>`);
        if (x.scripts[0]?.scriptType !== want) bad += fail(`type=${JSON.stringify(type)}: ${x.scripts[0]?.scriptType}, expected ${want}`);
      }
      return bad;
    },
  },
  {
    name: 'an-inline-script-body-is-located-exactly',
    spec: 'script content is raw text between the start tag and the end tag',
    rulesOut: 'a reader that trims the body or counts from the start tag',
    run: () => {
      const text = '<html>\n<body>\n  <script defer>\n    init();\n  </script>\n<script src="a.js">ignored()</script></body></html>';
      const x = parseHtml(text);
      const [inline, external] = x.scripts;
      let bad = 0;
      if (inline === undefined || external === undefined) return fail(`${x.scripts.length} scripts`);
      if (inline.scriptKind !== HtmlScriptKind.INLINE || !inline.isDefer) bad += fail('inline/defer misread');
      const bodyStart = text.indexOf('<script defer>') + '<script defer>'.length;
      const bodyEnd = text.indexOf('</script>');
      const s = col(text, text.slice(bodyStart, bodyEnd));
      if (inline.bodyStartLine !== s.line || inline.bodyStartColumn !== s.column) bad += fail(`body starts ${inline.bodyStartLine}:${inline.bodyStartColumn}, expected ${s.line}:${s.column}`);
      if (inline.bodyLength !== bodyEnd - bodyStart) bad += fail(`bodyLength=${inline.bodyLength}, expected ${bodyEnd - bodyStart}`);
      if (inline.bodyEndLine !== 5 || inline.bodyEndColumn !== 3) bad += fail(`body ends ${inline.bodyEndLine}:${inline.bodyEndColumn}, expected 5:3`);
      if (external.scriptKind !== HtmlScriptKind.EXTERNAL || external.bodyLength !== 0) bad += fail('an external script\'s body was read');
      if (x.document.toCsv().split('\t')[12] !== '2' || x.document.toCsv().split('\t')[13] !== '1') bad += fail('script counts are wrong');
      return bad;
    },
  },
  // ── HTML: inline CSS ────────────────────────────────────────────────────
  {
    name: 'a-style-element-is-a-stylesheet-at-the-page-s-lines',
    spec: 'a style element\'s content is a CSS stylesheet',
    rulesOut: 'a reader that cites line 1 of the CSS for a rule on line 4 of the page',
    run: () => {
      const text = '<head>\n  <style>\n    .a { color: red }\n    .b { gap: var(--g) }\n  </style>\n</head>';
      const x = parseHtml(text);
      let bad = 0;
      if (x.stylesheets.length !== 1) return fail(`${x.stylesheets.length} stylesheets`);
      const sheet = x.stylesheets[0]!;
      const style = x.elements.find((e) => e.tagName === 'style')!;
      if (sheet.sourceKind !== CssStylesheetSource.HTML_STYLE_ELEMENT || sheet.ownerHtmlElementLinkHash !== style.getHash()) bad += fail('the sheet does not chain to its element');
      if (sheet.startLine !== 2 || sheet.startColumn !== 10 || sheet.endLine !== 5) bad += fail(`sheet spans ${sheet.startLine}:${sheet.startColumn}-${sheet.endLine}`);
      const b = x.css.rules.find((r) => r.preludeText === '.b')!;
      if (b.startLine !== 4 || b.startColumn !== 5) bad += fail(`.b at ${b.startLine}:${b.startColumn}, expected 4:5`);
      const gap = x.css.declarations.find((d) => d.property === 'gap')!;
      if (gap.startLine !== 4 || gap.startColumn !== 10 || gap.stylesheetLinkHash !== sheet.getHash()) bad += fail(`gap at ${gap.startLine}:${gap.startColumn}`);
      if (!x.css.valueReferences.some((v) => v.name === '--g' && v.startLine === 4)) bad += fail('var(--g) not read from the inline sheet');
      if (sheet.getRuleCount() !== 2 || sheet.getDeclarationCount() !== 2) bad += fail('counts not back-patched');
      const other = parseHtml('<style type="text/less">.a { .b; }</style>');
      if (other.stylesheets.length !== 0) bad += fail('a non-CSS style type was parsed as CSS');
      return bad;
    },
  },
  {
    name: 'a-style-attribute-is-a-declaration-list-owned-by-the-attribute',
    spec: 'the style attribute\'s value is a <declaration-list>',
    rulesOut: 'a reader that needs a rule to own a declaration, or drops the good half of a bad list',
    run: () => {
      const text = '<div style="color: red; margin:0"><span style="color: ; top: 1px">x</span></div>';
      const x = parseHtml(text);
      const div = x.attributes.find((a) => a.name === 'style' && a.value.startsWith('color: red'))!;
      const mine = x.css.declarations.filter((d) => d.htmlAttributeLinkHash === div.getHash());
      let bad = 0;
      if (mine.map((d) => `${d.property}=${d.valueText}`).join(' ') !== 'color=red margin=0') bad += fail(`declarations=${mine.map((d) => d.property).join(',')}`);
      if (mine.some((d) => d.ruleLinkHash !== '' || d.stylesheetLinkHash !== '')) bad += fail('a style attribute declaration claims a rule or a sheet');
      const at = col(text, 'margin');
      if (mine[1]!.startLine !== at.line || mine[1]!.startColumn !== at.column) bad += fail(`margin at ${mine[1]!.startLine}:${mine[1]!.startColumn}, written at ${at.line}:${at.column}`);
      if (!x.css.declarations.some((d) => d.property === 'top')) bad += fail('the readable declaration after a bad one was dropped');
      if (!x.parseGaps.some((g) => g.gapKind === HtmlParseGapKind.STYLE_ATTRIBUTE_SYNTAX)) bad += fail('no STYLE_ATTRIBUTE_SYNTAX gap');
      return bad;
    },
  },
  {
    name: 'template-dialects-are-read-from-their-markers',
    spec: 'the file is a template of the family whose delimiters it uses',
    rulesOut: 'a detector keyed on the file extension, which is .html for all of them',
    run: () => {
      const cases: Array<[string, HtmlTemplateDialect[]]> = [
        ['<p>{{ a }}</p>', [HtmlTemplateDialect.MUSTACHE]],
        ['{% if a %}<p>{{ a }}</p>{% endif %}', [HtmlTemplateDialect.JINJA, HtmlTemplateDialect.MUSTACHE]],
        ['{{#each items}}<li>{{this}}</li>{{/each}}', [HtmlTemplateDialect.HANDLEBARS, HtmlTemplateDialect.MUSTACHE]],
        ['<% if (u) { %><p><%= u %></p><% } %>', [HtmlTemplateDialect.ERB]],
        ['<?php echo $x; ?>', [HtmlTemplateDialect.PHP]],
        ['@model Foo\n<p>@Model.Name</p>', [HtmlTemplateDialect.RAZOR]],
        ['<p>${name}</p>', [HtmlTemplateDialect.DOLLAR_BRACE]],
        ['<p th:text="${x}">x</p>', [HtmlTemplateDialect.DOLLAR_BRACE, HtmlTemplateDialect.THYMELEAF]],
        ['<p>plain</p>', []],
      ];
      let bad = 0;
      for (const [text, want] of cases) {
        const got = [...parseHtml(text).document.templateDialects].sort().join(',');
        if (got !== [...want].sort().join(',')) bad += fail(`${JSON.stringify(text)}: ${got || '(none)'}, expected ${want.join(',') || '(none)'}`);
      }
      return bad;
    },
  },
  {
    name: 'gaps-are-capped-with-a-count-of-the-rest',
    spec: 'a parse error per attribute on a file with thousands of them is a count, not a table',
    rulesOut: 'an extractor that emits ten thousand gap rows, or drops them with no trace',
    run: () => {
      const attrs = Array.from({ length: WEB_PARSE_GAP_LIMIT + 50 }, (_, i) => `a${i}="1" a${i}="2"`).join(' ');
      const x = parseHtml(`<div ${attrs}></div>`);
      const limit = x.parseGaps.find((g) => g.gapKind === HtmlParseGapKind.GAP_LIMIT_REACHED);
      let bad = 0;
      if (x.parseGaps.length !== WEB_PARSE_GAP_LIMIT + 1) bad += fail(`${x.parseGaps.length} gaps, expected ${WEB_PARSE_GAP_LIMIT} + 1`);
      if (limit === undefined || !limit.detail.startsWith('50 ')) bad += fail(`limit row=${limit?.detail}`);
      if (x.document.getParseGapCount() !== x.parseGaps.length) bad += fail('document gap count disagrees');
      return bad;
    },
  },
  // ── CSS: selectors ──────────────────────────────────────────────────────
  {
    name: 'specificity-follows-selectors-level-4',
    spec: 'count ids (a); classes, attributes and pseudo-classes (b); types and pseudo-elements (c); :where() adds nothing; :is()/:not()/:has() add their most specific argument',
    rulesOut: 'a counter that counts :where(), ignores :not()\'s argument, or counts *',
    run: () => {
      const cases: Array<[string, string]> = [
        ['#a .b c::before', '1,1,2'], ['*', '0,0,0'], ['ul li', '0,0,2'], [':root', '0,1,0'],
        [':is(#x, .y) p', '1,0,1'], [':where(.x) p', '0,0,1'], ['div:not(.a .b)', '0,2,1'], [':has(> img)', '0,0,1'],
        ['li:nth-child(2n of .x)', '0,2,1'], ['a:hover', '0,1,1'], ['a:before', '0,0,2'], ['input[type="text"]', '0,1,1'],
        [':host(.a)', '0,2,0'], ['.a.b.c', '0,3,0'], ['svg|rect', '0,0,1'], ['&:hover', '0,1,0'],
      ];
      let bad = 0;
      for (const [selector, want] of cases) {
        const got = specificity(selector);
        if (got !== want) bad += fail(`${selector}: ${got}, expected ${want}`);
      }
      return bad;
    },
  },
  {
    name: 'selector-parts-keep-compounds-combinators-and-nesting',
    spec: 'a complex selector is compounds separated by combinators; a functional pseudo-class takes selectors as arguments',
    rulesOut: 'a flattener that loses which compound a class is in, or whether it was negated',
    run: () => {
      const x = parseCss('.nav > li.item:not(.hidden) + a[href^="http" i] ~ b::before, #x { color: red }');
      const got = x.selectorParts.map((p) => `${p.position}:${p.partKind}:${p.name}${p.value ? '=' + p.value : ''}${p.attributeMatcher}${p.attributeFlags}@${p.compoundIndex}${p.combinatorBefore === CssCombinator.NONE ? '' : '<' + p.combinatorBefore}${p.depth ? '^' + p.depth : ''}`).join(' ');
      const want = '0:CLASS:nav@0 1:TYPE:li@1<CHILD 2:CLASS:item@1 3:PSEUDO_CLASS:not=.hidden@1 4:CLASS:hidden@0^1 5:TYPE:a@2<NEXT_SIBLING 6:ATTRIBUTE:href=http^=i@2 7:TYPE:b@3<SUBSEQUENT_SIBLING 8:PSEUDO_ELEMENT:before@3 0:ID:x@0';
      let bad = 0;
      if (got !== want) bad += fail(`got  ${got}\n      want ${want}`);
      const hidden = x.selectorParts.find((p) => p.name === 'hidden')!;
      const not = x.selectorParts.find((p) => p.name === 'not')!;
      if (hidden.parentPartLinkHash !== not.getHash()) bad += fail('the negated class does not chain to its :not');
      if (x.selectors.length !== 2) bad += fail('two selectors expected');
      if (x.selectors[0]!.compoundCount !== 4 || !x.selectors[0]!.hasPseudoElement) bad += fail('compoundCount / hasPseudoElement wrong');
      if (x.selectorParts.some((p) => p.selectorLinkHash !== x.selectors[p.name === 'x' ? 1 : 0]!.getHash())) bad += fail('a part chains to the wrong selector');
      return bad;
    },
  },
  {
    name: 'nested-rules-are-children-of-their-rule',
    spec: 'CSS Nesting: a style rule may contain style rules and at-rules; & is the parent selector',
    rulesOut: 'a reader that drops a nested rule, or loses the & the grammar rejects after a compound',
    run: () => {
      const text = '.card {\n  color: blue;\n  &:hover { color: red }\n  .title & { font-weight: bold }\n  @media (width > 40em) { padding: 1rem }\n}\n.after { x: y }';
      const x = parseCss(text);
      const card = x.rules.find((r) => r.preludeText === '.card')!;
      const children = x.rules.filter((r) => r.parentRuleLinkHash === card.getHash());
      let bad = 0;
      if (children.map((r) => `${r.position}:${r.preludeText}`).join(' ') !== '0:&:hover 1:.title & 2:(width > 40em)') {
        bad += fail(`children=${children.map((r) => r.preludeText).join(' | ')}`);
      }
      if (children.some((r) => r.nestingDepth !== 1)) bad += fail('nested rules are not at depth 1');
      if (card.getDeclarationCount() !== 1) bad += fail(`card declarations=${card.getDeclarationCount()}, expected 1`);
      const hover = children[0]!;
      if (hover.startLine !== 3 || hover.startColumn !== 3) bad += fail(`&:hover at ${hover.startLine}:${hover.startColumn}, expected 3:3`);
      const red = x.declarations.find((d) => d.ruleLinkHash === hover.getHash());
      if (red === undefined || red.valueText !== 'red' || red.startLine !== 3) bad += fail('the nested rule\'s declaration is missing or misplaced');
      if (!x.selectors.find((s) => s.selectorText === '&:hover')?.hasNesting) bad += fail('&:hover is not flagged hasNesting');
      const title = x.selectors.find((s) => s.selectorText === '.title &');
      if (title === undefined || !title.hasNesting) bad += fail('`.title &` lost its nesting selector');
      if (!x.selectorParts.some((p) => p.partKind === CssSelectorPartKind.NESTING && p.selectorLinkHash === title?.getHash())) bad += fail('the & after a compound is not a NESTING part');
      // The grammar rejects a range media query; the rule still stands and the gap says where.
      if (x.parseGaps.some((g) => g.gapKind !== CssParseGapKind.PARSE_ERROR)) bad += fail(`unexpected gap kinds: ${x.parseGaps.map((g) => g.gapKind).join(', ')}`);
      if (x.parseGaps.some((g) => g.detail.includes('&'))) bad += fail('a recovered & is still reported as a gap');
      if (!x.rules.some((r) => r.preludeText === '.after' && r.parentRuleLinkHash === '')) bad += fail('the rule after the nested block was lost');
      return bad;
    },
  },
  {
    name: 'at-rules-declare-names-and-nest-their-rules',
    spec: '@keyframes, @layer, @container, @property and @font-face name something; @media and @supports wrap rules',
    rulesOut: 'a reader that treats every at-rule as an opaque block',
    run: () => {
      const x = parseCss('@media (min-width: 1px) { .a { x: 1 } }\n@keyframes spin { from { x: 0 } 50% { x: 1 } to { x: 2 } }\n@font-face { font-family: "Inter"; src: url(a.woff2) }\n@layer base;\n@layer a, b;\n@container card (min-width: 1px) { .b { y: 2 } }\n@property --p { syntax: "<length>" }\n@import "x.css" layer(l);');
      const at = (name: string, index = 0): typeof x.rules[number] => x.rules.filter((r) => r.atRuleName === name)[index]!;
      let bad = 0;
      if (at('keyframes').getName() !== 'spin') bad += fail(`keyframes name=${at('keyframes').getName()}`);
      if (at('font-face').getName() !== 'Inter') bad += fail(`font-face name=${at('font-face').getName()}`);
      if (at('layer', 0).getName() !== 'base' || at('layer', 1).getName() !== '') bad += fail('layer names: a single name is the rule\'s, a list is not');
      if (at('container').getName() !== 'card') bad += fail(`container name=${at('container').getName()}`);
      if (at('property').getName() !== '--p') bad += fail(`property name=${at('property').getName()}`);
      const media = at('media');
      const a = x.rules.find((r) => r.preludeText === '.a')!;
      if (a.parentRuleLinkHash !== media.getHash() || media.preludeText !== '(min-width: 1px)') bad += fail('the rule inside @media does not chain to it');
      const frames = x.rules.filter((r) => r.parentRuleLinkHash === at('keyframes').getHash());
      if (frames.map((r) => r.preludeText).join(' ') !== 'from 50% to') bad += fail(`keyframe selectors=${frames.map((r) => r.preludeText).join(' ')}`);
      if (x.selectorParts.some((p) => p.ruleLinkHash === frames[1]!.getHash())) bad += fail('a keyframe selector emitted element parts');
      const refs = x.valueReferences.map((v) => `${v.referenceKind}:${v.name}`);
      for (const want of ['LAYER:base', 'LAYER:a', 'LAYER:b', 'CONTAINER:card', 'IMPORT:x.css', 'LAYER:l', 'FONT_FAMILY:Inter', 'URL:a.woff2']) {
        if (!refs.includes(want)) bad += fail(`missing reference ${want} in ${refs.join(' ')}`);
      }
      return bad;
    },
  },
  // ── CSS: declarations and values ────────────────────────────────────────
  {
    name: 'declarations-keep-importance-custom-properties-prefixes-and-text-as-written',
    spec: '!important, custom property names, vendor prefixes; the value is the text between the colon and the end',
    rulesOut: 'a serialiser that writes url(x)no-repeat, or lowercases --Custom',
    run: () => {
      const x = parseCss(':root { --Brand: #09f; -webkit-font-smoothing: antialiased; background: url(a.png)   no-repeat !important; color: RED }');
      const got = x.declarations.map((d) => `${d.position}:${d.property}=${d.valueText}${d.isImportant ? '!' : ''}${d.isCustomProperty ? '~' : ''}${d.vendorPrefix ? '(' + d.vendorPrefix + ')' : ''}`).join(' ');
      const want = '0:--Brand=#09f~ 1:-webkit-font-smoothing=antialiased(-webkit-) 2:background=url(a.png) no-repeat! 3:color=RED';
      return got === want ? 0 : fail(`got  ${got}\n      want ${want}`);
    },
  },
  {
    name: 'value-references-name-what-a-value-reaches',
    spec: 'var() refers to a custom property with an optional fallback; url() to a resource; animation-name to a @keyframes; font-family to a family',
    rulesOut: 'a reader that takes the keyword linear for an animation name, or sans-serif for a font',
    run: () => {
      file('site/css/img/bg.png', '');
      const x = parseCss('.a { color: var(--c, var(--d, red)); background: url("img/bg.png"); animation: 1s linear infinite spin, fade .5s; font-family: Segoe UI, "Inter", sans-serif; container: side / inline-size; --x: url(img/bg.png) }');
      const got = x.valueReferences.map((v) => `${v.referenceKind}:${v.name}${v.fallbackText ? '[' + v.fallbackText + ']' : ''}${v.isResolved ? '+' : ''}`).join(' ');
      const want = 'VARIABLE:--c[var(--d, red)] VARIABLE:--d[red] URL:img/bg.png+ KEYFRAMES:spin KEYFRAMES:fade FONT_FAMILY:Segoe UI FONT_FAMILY:Inter CONTAINER:side URL:img/bg.png+';
      let bad = 0;
      if (got !== want) bad += fail(`got  ${got}\n      want ${want}`);
      const first = x.valueReferences[0]!;
      const owner = x.declarations.find((d) => d.property === 'color')!;
      if (first.ownerDeclarationLinkHash !== owner.getHash() || first.ownerRuleLinkHash !== '') bad += fail('a var() does not chain to its declaration');
      if (x.valueReferences.some((v) => v.referenceKind === CssValueReferenceKind.URL && v.urlKind !== WebUrlKind.RELATIVE)) bad += fail('url kind wrong');
      return bad;
    },
  },
  {
    name: 'what-the-grammar-cannot-read-is-a-gap-and-the-rest-stands',
    spec: 'error recovery: a bad declaration ends at the next semicolon; a bad rule at its block',
    rulesOut: 'a parser that fails the file, drops the bad region silently, or loses the declaration the grammar folded into the bad one',
    run: () => {
      const x = parseCss('.a { color: ; top: 1px }\n.b { x: 1 }\n$primary: red;\n@mixin m { }');
      let bad = 0;
      const kinds = x.parseGaps.map((g) => g.gapKind);
      if (!kinds.includes(CssParseGapKind.PARSE_ERROR)) bad += fail('no PARSE_ERROR for `color: ;`');
      if (!kinds.includes(CssParseGapKind.PREPROCESSOR_SYNTAX)) bad += fail('no PREPROCESSOR_SYNTAX for $primary');
      const top = x.declarations.find((d) => d.property === 'top');
      if (top === undefined || top.valueText !== '1px' || top.startLine !== 1 || top.startColumn !== 15) bad += fail(`the declaration after the bad one: ${top === undefined ? 'lost' : `${top.valueText} at ${top.startLine}:${top.startColumn}`}`);
      if (!x.rules.some((r) => r.preludeText === '.b')) bad += fail('the rule after the bad one was lost');
      if (x.sheet.getParseGapCount() !== x.parseGaps.length) bad += fail('gap count not back-patched');
      const y = parseCss('/* c1 */ .a { }\n/* two\nlines */');
      if (y.comments.map((c) => `${c.text}@${c.startLine}:${c.startColumn}-${c.endLine}:${c.endColumn}`).join(' ') !== ' c1 @1:1-1:9  two\nlines @2:1-3:9') {
        bad += fail(`comments=${y.comments.map((c) => JSON.stringify(c.text) + '@' + c.startLine + ':' + c.startColumn + '-' + c.endLine + ':' + c.endColumn).join(' ')}`);
      }
      return bad;
    },
  },
  {
    name: 'embedded-css-positions-are-offset-on-the-first-line-only',
    spec: 'a <style> body begins mid-line; its second line begins at column 1 of the next page line',
    rulesOut: 'a mapper that adds the host column to every line, or the host line to none',
    run: () => {
      const x = parseCss('.a { x: 1 }\n.b { y: 2 }', 'site/css/e.css', { line: 10, column: 12 });
      const [a, b] = x.rules;
      let bad = 0;
      if (a!.startLine !== 10 || a!.startColumn !== 12) bad += fail(`.a at ${a!.startLine}:${a!.startColumn}, expected 10:12`);
      if (b!.startLine !== 11 || b!.startColumn !== 1) bad += fail(`.b at ${b!.startLine}:${b!.startColumn}, expected 11:1`);
      return bad;
    },
  },
  {
    name: 'keys-are-content-addressed-and-never-collide-on-a-name',
    spec: 'every row has its own key; two rules spelled the same are two rules',
    rulesOut: 'a key derived from the selector text or the class name',
    run: () => {
      const x = parseCss('.a { x: 1 }\n.a { x: 1 }\n@media (a) { .a { x: 1 } }');
      let bad = 0;
      const keys = new Set(x.rules.map((r) => r.getHash()));
      if (keys.size !== 4) bad += fail(`${keys.size} distinct rule keys for 4 rules`);
      if (new Set(x.selectors.map((s) => s.getHash())).size !== 3) bad += fail('identical selectors in different rules share a key');
      if (new Set(x.declarations.map((d) => d.getHash())).size !== 3) bad += fail('identical declarations in different rules share a key');
      const again = parseCss('.a { x: 1 }\n.a { x: 1 }\n@media (a) { .a { x: 1 } }');
      if (again.rules.map((r) => r.getHash()).join() !== x.rules.map((r) => r.getHash()).join()) bad += fail('keys differ across two parses of one text');
      const h1 = parseHtml('<style>.a{}</style>', 'site/one.html').stylesheets[0]!.getHash();
      const h2 = parseHtml('<style>.a{}</style>', 'site/two.html').stylesheets[0]!.getHash();
      if (h1 === h2) bad += fail('the same inline CSS in two pages shares a stylesheet key');
      return bad;
    },
  },
];

// ---------------------------------------------------------------------------
// fixture-tree machinery
// ---------------------------------------------------------------------------

function tsv(dir: string, f: string): Row[] {
  const fp = path.join(dir, f);
  if (!fs.existsSync(fp)) return [];
  const lines = fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean);
  if (!lines.length) return [];
  const head = lines[0]!.split('\t');
  return lines.slice(1).map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])) as Row;
  });
}

const RELATION_FILES = Object.entries(WEB_CSV_FILES)
  .filter(([k]) => !k.startsWith('SKIPPED'))
  .map(([, f]) => f);

/** CSV file name → relation name, through the schema's `all-html-x-ys.csv` ↔ `html_x_y` convention. */
const RELATION_OF: Record<string, string> = {
  'all-html-documents.csv': 'html_document', 'all-html-elements.csv': 'html_element', 'all-html-attributes.csv': 'html_attribute',
  'all-html-class-references.csv': 'html_class_reference', 'all-html-references.csv': 'html_reference', 'all-html-scripts.csv': 'html_script',
  'all-html-handler-calls.csv': 'html_handler_call', 'all-html-template-expressions.csv': 'html_template_expression',
  'all-html-parse-gaps.csv': 'html_parse_gap', 'all-css-stylesheets.csv': 'css_stylesheet',
  'all-css-rules.csv': 'css_rule', 'all-css-selectors.csv': 'css_selector', 'all-css-selector-parts.csv': 'css_selector_part',
  'all-css-declarations.csv': 'css_declaration', 'all-css-value-references.csv': 'css_value_reference', 'all-css-comments.csv': 'css_comment',
  'all-css-parse-gaps.csv': 'css_parse_gap',
};

/** Which relation each link column points at. */
const LINK_TARGET: Record<string, string> = {
  documentLinkHash: 'html_document', htmlDocumentLinkHash: 'html_document',
  ownerElementLinkHash: 'html_element', parentElementLinkHash: 'html_element', relatedElementLinkHash: 'html_element', ownerHtmlElementLinkHash: 'html_element',
  attributeLinkHash: 'html_attribute', htmlAttributeLinkHash: 'html_attribute', referenceLinkHash: 'html_reference',
  stylesheetLinkHash: 'css_stylesheet', ruleLinkHash: 'css_rule', parentRuleLinkHash: 'css_rule', relatedRuleLinkHash: 'css_rule', ownerRuleLinkHash: 'css_rule',
  selectorLinkHash: 'css_selector', parentPartLinkHash: 'css_selector_part', ownerDeclarationLinkHash: 'css_declaration',
};

async function analyse(rootDir: string, outputDir: string, order: 'root-first' | 'root-last' = 'root-first'): Promise<string> {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const subs = [path.join(rootDir, 'site'), path.join(rootDir, 'app')];
  const targets = (order === 'root-first' ? [rootDir, ...subs] : [...subs, rootDir]).map((p) => ({
    name: path.basename(p), path: p, language: 'UNKNOWN' as never, hasSourceFiles: false,
  }));
  const silence = console.log;
  console.log = () => {};
  try {
    await new WebProjectAnalyzer(outputDir).analyzeWebFiles(targets, 'WEB_FIXTURE_VERSION');
  } finally {
    console.log = silence;
  }
  return outputDir;
}

/** Every fact, sorted, volatile and hash columns dropped. Row order is not a contract. */
function snapshot(out: string): Map<string, string[]> {
  const snap = new Map<string, string[]>();
  for (const f of RELATION_FILES) {
    const rows = tsv(out, f);
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]!).filter((c) => !VOLATILE.test(c) && !HASH_COLUMN.test(c));
    snap.set(f.replace('all-', '').replace('.csv', ''), rows.map((r) => cols.map((c) => `${c}=${r[c] ?? ''}`).join('\t')).sort());
  }
  return snap;
}

function goldenCheck(out: string): number {
  const snap = snapshot(out);
  if (BLESS) {
    fs.rmSync(GOLDEN, { recursive: true, force: true });
    fs.mkdirSync(GOLDEN, { recursive: true });
    for (const [rel, rows] of snap) fs.writeFileSync(path.join(GOLDEN, rel + '.txt'), rows.join('\n') + '\n');
    console.log(`  ✎ blessed ${snap.size} relation(s)`);
    return 0;
  }
  if (!fs.existsSync(GOLDEN)) return fail('no golden; run --bless');
  let bad = 0;
  const expected = new Set(fs.readdirSync(GOLDEN).map((f) => f.replace('.txt', '')));
  for (const rel of expected) if (!snap.has(rel)) bad += fail(`relation ${rel} vanished`);
  for (const [rel, rows] of snap) {
    if (!expected.has(rel)) { bad += fail(`relation ${rel} appeared unexpectedly`); continue; }
    const want = fs.readFileSync(path.join(GOLDEN, rel + '.txt'), 'utf-8').split('\n').filter(Boolean);
    if (want.length !== rows.length) bad += fail(`${rel}: ${rows.length} rows, expected ${want.length}`);
    for (let i = 0; i < Math.min(want.length, rows.length); i++) {
      if (want[i] !== rows[i]) { bad += fail(`${rel} row ${i}\n      want ${want[i]}\n      got  ${rows[i]}`); break; }
    }
  }
  return bad;
}

/** Arity against the frozen schema, the key last, and every enum column inside its domain. */
function schemaCheck(out: string): number {
  let bad = 0;
  for (const f of RELATION_FILES) {
    const fp = path.join(out, f);
    const relation = RELATION_OF[f]!;
    const spec = SCHEMA.relations[relation];
    if (spec === undefined) { bad += fail(`${relation} is not in schema.json`); continue; }
    if (!fs.existsSync(fp)) { bad += fail(`${f} was not written by the fixture`); continue; }
    const lines = fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean);
    const header = lines[0]!.split('\t');
    if (header.join(',') !== spec.columns.join(',')) bad += fail(`${f}: header ${header.join(',')}\n      schema ${spec.columns.join(',')}`);
    if (!/UniqueHash$/.test(header[header.length - 1]!)) bad += fail(`${f}: last column is not the row's own key`);
    lines.slice(1).forEach((line, i) => {
      const n = line.split('\t').length;
      if (n !== header.length) bad += fail(`${f} row ${i}: ${n} fields, header has ${header.length}`);
    });
    const rows = tsv(out, f);
    for (const [column, domain] of Object.entries(spec.domains ?? {})) {
      const allowed = new Set(domain);
      for (const r of rows) {
        const outside = cellValues(relation, column, r[column] ?? '').find((v) => !allowed.has(v));
        if (outside !== undefined) { bad += fail(`${f}: ${column}=${outside} is outside its domain`); break; }
      }
    }
  }
  return bad;
}

/** Primary keys unique within a relation; every link resolves to a row of the right relation. */
function integrityCheck(out: string): number {
  let bad = 0;
  const keys = new Map<string, Set<string>>();
  for (const f of RELATION_FILES) {
    const rows = tsv(out, f);
    const relation = RELATION_OF[f]!;
    const keyColumn = SCHEMA.relations[relation]!.columns.slice(-1)[0]!;
    const seen = new Set<string>();
    for (const r of rows) {
      const k = r[keyColumn] ?? '';
      if (k === '') bad += fail(`${f}: a row has no key`);
      if (seen.has(k)) bad += fail(`${f}: duplicate key ${k}`);
      seen.add(k);
    }
    keys.set(relation, seen);
  }
  for (const f of RELATION_FILES) {
    const rows = tsv(out, f);
    if (!rows.length) continue;
    for (const column of Object.keys(rows[0]!)) {
      const target = LINK_TARGET[column];
      if (target === undefined) continue;
      const pool = keys.get(target) ?? new Set<string>();
      let dangling = 0;
      for (const r of rows) {
        const v = r[column] ?? '';
        if (v !== '' && !pool.has(v)) dangling += 1;
      }
      if (dangling > 0) bad += fail(`${f}.${column}: ${dangling} link(s) to no ${target} row`);
    }
  }
  // Every declaration has exactly one owner.
  for (const r of tsv(out, WEB_CSV_FILES.CSS_DECLARATIONS)) {
    if ((r['ruleLinkHash'] === '') === (r['htmlAttributeLinkHash'] === '')) { bad += fail('a css_declaration has zero or two owners'); break; }
  }
  for (const r of tsv(out, WEB_CSV_FILES.CSS_VALUE_REFERENCES)) {
    if ((r['ownerDeclarationLinkHash'] === '') === (r['ownerRuleLinkHash'] === '')) { bad += fail('a css_value_reference has zero or two owners'); break; }
  }
  return bad;
}

// ---------------------------------------------------------------------------
// the enum-emission audit
// ---------------------------------------------------------------------------

/**
 * Reserved values, scoped `Enum.VALUE`, split by WHY they are reserved — the JavaScript
 * suite's rule. A value that is merely unobserved in this fixture is not one that cannot
 * occur, and asserting zero rows on it would be a gate that passes because the fixture is
 * small. So only UNREACHABLE_BY_CONSTRUCTION is asserted at zero rows; MERELY_UNOBSERVED
 * is reported, and a row appearing there is news rather than a failure.
 */
const UNREACHABLE_BY_CONSTRUCTION: Readonly<Record<string, string>> = {};

const MERELY_UNOBSERVED: Readonly<Record<string, string>> = {
  'HtmlParseGapKind.GAP_LIMIT_REACHED': 'needs 200+ errors in one page; the format check gaps-are-capped produces it',
  'CssParseGapKind.GAP_LIMIT_REACHED': 'needs 200+ gaps in one stylesheet; the HTML cap check covers the collector shape',
  'CssParseGapKind.UNCLOSED_BLOCK': 'the fixture sheets all close their blocks; web-plumbing-tests unclosed-eof and the torture gaps.css produce it',
  'CssSelectorPartKind.RAW': 'a selector node of a kind this reader does not classify; the grammar\'s own node set is covered, so the fixture produces none',
  'HtmlNamespace.MATHML': 'no fixture page holds <math>; the namespace is decided from context exactly as SVG is',
};

/**
 * Every declared enum value of the web front end is emitted somewhere in the fixture
 * output, or is reserved above with a reason.
 *
 * The column each enum binds to is read from schema.json's domains: a column whose domain
 * is exactly the enum's value set carries that enum, so a value is scored against the
 * columns that declare it and never against a free-text column that happens to hold the
 * same word. A correctly positioned row with the wrong kind is invisible to every count
 * and integrity check above; this is the one that sees it.
 */
function enumEmissionAudit(out: string): number {
  let bad = 0;
  const declared = new Map<string, string[]>();
  for (const bundle of [HtmlEnums, CssEnums, WebEnums]) {
    for (const [name, enumObject] of Object.entries(bundle as unknown as Record<string, unknown>)) {
      if (typeof enumObject !== 'object' || enumObject === null || Array.isArray(enumObject)) continue;
      const values = Object.values(enumObject as Record<string, unknown>).filter((v): v is string => typeof v === 'string');
      if (values.length > 0) declared.set(name, values);
    }
  }
  if (declared.size < 10) return fail(`only ${declared.size} enums discovered — the audit cannot be trusted`);
  for (const key of [...Object.keys(UNREACHABLE_BY_CONSTRUCTION), ...Object.keys(MERELY_UNOBSERVED)]) {
    const [enumName, value] = key.split('.');
    if (!(declared.get(enumName ?? '') ?? []).includes(value ?? '')) bad += fail(`allowlist key ${key} names no declared Enum.VALUE`);
  }
  // Which (relation, column) carries which enum: by exact domain match against schema.json.
  const columnsByEnum = new Map<string, Array<[string, string]>>();
  for (const [relation, spec] of Object.entries(SCHEMA.relations)) {
    for (const [column, domain] of Object.entries(spec.domains ?? {})) {
      const want = [...domain].sort().join('|');
      for (const [enumName, values] of declared) {
        if ([...values].sort().join('|') === want) columnsByEnum.set(enumName, [...(columnsByEnum.get(enumName) ?? []), [relation, column]]);
      }
    }
  }
  const fileOf = Object.fromEntries(Object.entries(RELATION_OF).map(([f, r]) => [r, f]));
  const unbound = [...declared.keys()].filter((e) => !columnsByEnum.has(e));
  if (unbound.length > 0) bad += fail(`enum(s) with no column declaring them in schema.json: ${unbound.join(', ')}`);
  const unemitted: string[] = [];
  for (const [enumName, values] of declared) {
    const emitted = new Set<string>();
    for (const [relation, column] of columnsByEnum.get(enumName) ?? []) {
      for (const r of tsv(out, fileOf[relation]!)) for (const v of cellValues(relation, column, r[column] ?? '')) emitted.add(v);
    }
    for (const value of values) {
      const scoped = `${enumName}.${value}`;
      if (emitted.has(value)) {
        if (scoped in UNREACHABLE_BY_CONSTRUCTION) bad += fail(`${scoped} is reserved as unreachable and was emitted`);
        continue;
      }
      if (scoped in UNREACHABLE_BY_CONSTRUCTION || scoped in MERELY_UNOBSERVED) continue;
      unemitted.push(scoped);
    }
  }
  if (unemitted.length > 0) {
    bad += fail(`${unemitted.length} enum value(s) neither emitted by the fixture nor reserved: ${unemitted.join(', ')}`);
  }
  console.log(`    ${declared.size} enums, ${Object.keys(MERELY_UNOBSERVED).length} merely unobserved, ${Object.keys(UNREACHABLE_BY_CONSTRUCTION).length} unreachable`);
  return bad;
}

function fixtureChecks(out: string, root: string): number {
  let bad = 0;
  const docs = tsv(out, WEB_CSV_FILES.HTML_DOCUMENTS);
  const rel = docs.map((d) => d['relativePath']).sort();
  const want = ['index.html', 'page.html', 'partials/frame.html', 'templates/fragment.html', 'templates/layout.html', 'templates/mixed.html'];
  if (rel.join(' ') !== want.join(' ')) bad += fail(`documents=${rel.join(' ')}\n      expected ${want.join(' ')}`);
  // Attribution: a page under site/ belongs to site/, never to the root target that also reaches it.
  for (const d of docs) {
    const owner = path.basename(d['baseMservPath']!);
    const expectedOwner = d['relativePath']!.startsWith('templates/') ? 'app' : 'site';
    if (owner !== expectedOwner) bad += fail(`${d['relativePath']} attributed to ${owner}, expected ${expectedOwner}`);
  }
  if (docs.some((d) => d['filePath']!.includes('apidocs'))) bad += fail('a javadoc output page was analysed');
  const sheets = tsv(out, WEB_CSV_FILES.CSS_STYLESHEETS);
  const files = sheets.filter((s) => s['sourceKind'] === 'FILE').map((s) => s['relativePath']).sort().join(' ');
  if (files !== 'static/css/app.css static/css/base.css static/css/vendor.min.css vendor/sassy.css') bad += fail(`css files=${files}`);
  if (sheets.find((s) => s['fileName'] === 'vendor.min.css')?.['sourceProvenance'] !== 'MINIFIED') bad += fail('vendor.min.css is not MINIFIED');
  if (sheets.filter((s) => s['sourceKind'] === 'HTML_STYLE_ELEMENT').length !== 1) bad += fail('one inline stylesheet expected');
  const skipped = tsv(out, WEB_CSV_FILES.SKIPPED_CSS_FILES);
  if (!skipped.some((s) => s['filePath']!.endsWith('empty.css') && s['reason'] === 'EMPTY_CONTENT')) bad += fail('empty.css is not a recorded skip');
  const refs = tsv(out, WEB_CSV_FILES.HTML_REFERENCES);
  const resolvedStylesheet = refs.find((r) => r['referenceKind'] === 'STYLESHEET' && r['isResolved'] === 'true');
  if (resolvedStylesheet === undefined || !sheets.some((s) => s['filePath'] === resolvedStylesheet['resolvedFilePath'])) {
    bad += fail('a resolved stylesheet reference does not name a css_stylesheet row\'s filePath');
  }
  const mainJs = refs.find((r) => r['urlAsWritten'] === '/assets/main.js');
  if (mainJs?.['resolvedFilePath'] !== path.join(root, 'app/public/assets/main.js')) bad += fail(`/assets/main.js resolved to ${mainJs?.['resolvedFilePath']}`);
  const gaps = tsv(out, WEB_CSV_FILES.CSS_PARSE_GAPS);
  if (!gaps.some((g) => g['gapKind'] === 'PREPROCESSOR_SYNTAX')) bad += fail('sassy.css raised no PREPROCESSOR_SYNTAX gap');
  const parts = tsv(out, WEB_CSV_FILES.CSS_SELECTOR_PARTS);
  const classRefs = tsv(out, WEB_CSV_FILES.HTML_CLASS_REFERENCES);
  const styled = new Set(parts.filter((p) => p['partKind'] === CssSelectorPartKind.CLASS).map((p) => p['name']));
  const joined = classRefs.filter((c) => styled.has(c['className']!)).length;
  if (joined < 5) bad += fail(`only ${joined} class references join a CSS class selector; the fixture has more`);
  return bad;
}

async function fixtureSuite(): Promise<number> {
  const root = path.resolve(DATA, 'fixture');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-web-fixture-'));
  let bad = 0;
  try {
    const a = await analyse(root, path.join(tmp, 'a'));
    bad += goldenCheck(a);
    bad += schemaCheck(a);
    bad += integrityCheck(a);
    bad += enumEmissionAudit(a);
    bad += fixtureChecks(a, root);
    const b = await analyse(root, path.join(tmp, 'b'));
    for (const f of [...RELATION_FILES, WEB_CSV_FILES.SKIPPED_CSS_FILES]) {
      const x = fs.existsSync(path.join(a, f)) ? fs.readFileSync(path.join(a, f), 'utf-8') : '';
      const y = fs.existsSync(path.join(b, f)) ? fs.readFileSync(path.join(b, f), 'utf-8') : '';
      if (x !== y) bad += fail(`${f} differs between two runs — extraction is not deterministic`);
    }
    const c = await analyse(root, path.join(tmp, 'c'), 'root-last');
    const sa = snapshot(a);
    const sc = snapshot(c);
    for (const [rel, rows] of sa) {
      if ((sc.get(rel) ?? []).join('\n') !== rows.join('\n')) bad += fail(`${rel}: attribution depends on target order`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return bad;
}

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  if (process.argv.includes('--list')) {
    for (const c of formatChecks) {
      console.log(`${c.name}\n    spec:      ${c.spec}\n    rules out: ${c.rulesOut}`);
    }
    console.log('fixture-tree\n    golden, schema arity and domains, key uniqueness, foreign keys, enum-emission audit, attribution, determinism');
    return 0;
  }
  let bad = 0;
  let ran = 0;
  console.log('── format checks');
  for (const c of formatChecks) {
    ran += 1;
    let r: number;
    try {
      r = c.run();
    } catch (e) {
      r = fail(`${c.name}: threw ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
    console.log(`  ${r === 0 ? '✓' : '✗'} ${c.name}`);
    bad += r;
  }
  console.log('── fixture tree');
  ran += 1;
  const f = await fixtureSuite();
  console.log(`  ${f === 0 ? '✓' : '✗'} fixture-tree`);
  bad += f;
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(bad === 0 ? `\nOK  ${ran} check(s)` : `\nFAIL  ${bad} problem(s) in ${ran} check(s)`);
  return bad === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(2); });
