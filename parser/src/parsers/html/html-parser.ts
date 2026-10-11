import * as path from 'path';

import { decodeHTML, decodeHTMLAttribute } from 'entities';
import Parser from 'tree-sitter';
import Html from 'tree-sitter-html';

import { CssDeclaration } from '@/analysis-types/css/CssDeclaration';
import { CssStylesheet } from '@/analysis-types/css/CssStylesheet';
import { CssValueReference } from '@/analysis-types/css/CssValueReference';
import { HtmlAttribute } from '@/analysis-types/html/HtmlAttribute';
import { HtmlClassReference } from '@/analysis-types/html/HtmlClassReference';
import { HtmlDocument } from '@/analysis-types/html/HtmlDocument';
import { HtmlElement } from '@/analysis-types/html/HtmlElement';
import { HtmlHandlerCall } from '@/analysis-types/html/HtmlHandlerCall';
import { HtmlParseGap } from '@/analysis-types/html/HtmlParseGap';
import { HtmlReference } from '@/analysis-types/html/HtmlReference';
import { HtmlScript } from '@/analysis-types/html/HtmlScript';
import { HtmlTemplateExpression } from '@/analysis-types/html/HtmlTemplateExpression';
import {
  WEB_MINIFIED_LINE_LENGTH_THRESHOLD,
  WEB_MINIFIED_NAME_PATTERN,
  WEB_PARSE_GAP_LIMIT,
} from '@/constants/web-constants';
import { CssSourceProvenance, CssStylesheetSource } from '@/enums/css/CssStylesheetSource';
import { HtmlAttributeKind } from '@/enums/html/HtmlAttributeKind';
import { HtmlDocumentKind } from '@/enums/html/HtmlDocumentKind';
import { HtmlHandlerSource } from '@/enums/html/HtmlHandlerSource';
import { HtmlNamespace } from '@/enums/html/HtmlNamespace';
import { HtmlParseGapKind } from '@/enums/html/HtmlParseGapKind';
import { HtmlReferenceKind } from '@/enums/html/HtmlReferenceKind';
import { HtmlScriptKind, HtmlScriptType } from '@/enums/html/HtmlScriptKind';
import { HtmlTemplateDialect } from '@/enums/html/HtmlTemplateDialect';
import { HtmlTemplateExpressionKind } from '@/enums/html/HtmlTemplateExpressionKind';
import { WebUrlKind } from '@/enums/web/WebUrlKind';
import { CssExtraction, CssParser } from '@/parsers/css/css-parser';
import { handlerCallsOf } from '@/utils/web/handler-calls';
import { LineIndex } from '@/utils/web/line-index';
import {
  DirectiveReading, MEMBER_PATH, TemplateFlavour, names, readDirective, readJsExpression, readLoop, templateFlavourOf,
} from '@/utils/web/template-expressions';
import { namedChildrenThroughErrors, parseWithTreeSitter } from '@/utils/web/tree-sitter-parse';
import { applyBase, ClassifiedUrl, classifyUrl, resolveUrlToFile, TEMPLATE_MARKER } from '@/utils/web/url-reference';

type SyntaxNode = Parser.SyntaxNode;
type Pos = { line: number; column: number };

/** Everything one page produces, its inline CSS included. */
export interface HtmlExtraction {
  document: HtmlDocument;
  elements: HtmlElement[];
  attributes: HtmlAttribute[];
  classReferences: HtmlClassReference[];
  references: HtmlReference[];
  scripts: HtmlScript[];
  handlerCalls: HtmlHandlerCall[];
  templateExpressions: HtmlTemplateExpression[];
  parseGaps: HtmlParseGap[];
  /** One per `<style>` element. */
  stylesheets: CssStylesheet[];
  /** The rows of every `<style>` element and every `style` attribute, together. */
  css: CssExtraction;
}

/** The grammar's three element node types; `script_element` and `style_element` hold raw text. */
const ELEMENT_TYPES = new Set(['element', 'script_element', 'style_element']);

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Elements whose content is text with character references and no markup (RCDATA). */
// `xmp` and `plaintext` hold raw text as `textarea` does: what looks like markup inside them is shown, not built (C-02)
const RCDATA_ELEMENTS = new Set(['title', 'textarea', 'xmp', 'plaintext']);

const URL_ATTRIBUTES = new Set([
  'src', 'href', 'action', 'formaction', 'poster', 'cite', 'manifest', 'ping', 'background', 'longdesc',
  'usemap', 'codebase', 'profile', 'archive',
]);

const ID_REFERENCE_ATTRIBUTES = new Set(['form', 'list', 'headers', 'popovertarget', 'commandfor', 'contextmenu', 'itemref']);

/** An attribute name that is a template dialect's, read as written (the dialects are case-sensitive). */
const TEMPLATE_DIRECTIVE = /^(th:|v-|x-|hx-|ng-|wire:|phx-|sec:|data-bind$|_$|[:@*[(#])/;

const JAVASCRIPT_MIME = /^(text\/(javascript|ecmascript|jscript|livescript|x-ecmascript|x-javascript|javascript1\.\d)|application\/(javascript|ecmascript|x-ecmascript|x-javascript))$/;

/** Attribute prefixes that are namespace plumbing in foreign content. */
const FOREIGN_ATTRIBUTE_PREFIXES = new Set(['xlink', 'xml', 'xmlns']);

/**
 * The SVG attributes whose case the HTML tree builder restores after the tokenizer has
 * lowercased them ("adjust SVG attributes" in the HTML specification), by lowercase name.
 */
const SVG_ADJUSTED_ATTRIBUTES = new Map([
  'attributeName', 'attributeType', 'baseFrequency', 'baseProfile', 'calcMode', 'clipPathUnits',
  'diffuseConstant', 'edgeMode', 'filterUnits', 'glyphRef', 'gradientTransform', 'gradientUnits',
  'kernelMatrix', 'kernelUnitLength', 'keyPoints', 'keySplines', 'keyTimes', 'lengthAdjust',
  'limitingConeAngle', 'markerHeight', 'markerUnits', 'markerWidth', 'maskContentUnits',
  'maskUnits', 'numOctaves', 'pathLength', 'patternContentUnits', 'patternTransform',
  'patternUnits', 'pointsAtX', 'pointsAtY', 'pointsAtZ', 'preserveAlpha', 'preserveAspectRatio',
  'primitiveUnits', 'refX', 'refY', 'repeatCount', 'repeatDur', 'requiredExtensions',
  'requiredFeatures', 'specularConstant', 'specularExponent', 'spreadMethod', 'startOffset',
  'stdDeviation', 'stitchTiles', 'surfaceScale', 'systemLanguage', 'tableValues', 'targetX',
  'targetY', 'textLength', 'viewBox', 'viewTarget', 'xChannelSelector', 'yChannelSelector',
  'zoomAndPan',
].map((name) => [name.toLowerCase(), name]));

/**
 * A server-side template TAG, which may sit anywhere in a page including inside a start tag:
 * Jinja/Django/Twig `{% %}` and `{{ }}`, ERB/EJS/JSP `<% %>`, Jinja comments `{# #}`, PHP `<? ?>`.
 */
const TEMPLATE_TAG = /\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}|<%[\s\S]*?%>|\{#[\s\S]*?#\}|<\?[\s\S]*?\?>/g;

/** Text-level template markers, each naming the family it belongs to. */
/** An SSI directive: a comment whose first character is `#` followed by a directive name (G23). */
const SSI_DIRECTIVE_MARKER = /<!--#\s*(?:include|set|echo|if|elif|else|endif|config|exec|fsize|flastmod|printenv)\b/i;

const TEXT_DIALECTS: ReadonlyArray<readonly [HtmlTemplateDialect, RegExp]> = [
  [HtmlTemplateDialect.HANDLEBARS, /\{\{[#/>^]/],
  [HtmlTemplateDialect.MUSTACHE, /\{\{(?![#/>^!])/],
  [HtmlTemplateDialect.JINJA, /\{%/],
  [HtmlTemplateDialect.ERB, /<%[=\-#@]?[\s\S]*?%>/],
  [HtmlTemplateDialect.PHP, /<\?php\b|<\?=/],
  [HtmlTemplateDialect.RAZOR, /(^|[\s>])@(model|using|inherits|page|section|if|foreach|for|while|switch|Html\.|Url\.|Model\b|\{)/m],
  [HtmlTemplateDialect.DOLLAR_BRACE, /\$\{[^}]*\}/],
  [HtmlTemplateDialect.SSI, SSI_DIRECTIVE_MARKER],
];

/**
 * The HTML front end: tree-sitter-html's tree, read into rows.
 *
 * ## What the grammar decides and what this file decides
 *
 * tree-sitter-html tokenises and builds the tree, with an external scanner that knows the
 * HTML rules a tokenizer alone cannot: raw text inside `<script>` and `<style>`, void
 * elements without an end tag, and the implicit end tags (`<p>` closed by the next `<p>`,
 * `<li>` by the next `<li>`). It does NOT run the browser's tree-construction stage: no
 * `html`, `head` or `body` is implied, and a stray end tag is an error rather than a
 * recovery. So the rows are the elements WRITTEN, and what a browser would add is left to
 * the consumer, which the document's `documentKind` makes decidable.
 *
 * The grammar is also narrower than HTML in four places this file reads around, each
 * measured on real corpora: it matches end tags case-sensitively (`<p>…</P>` is an error
 * to it), so tag names are lowercased in the copy it is handed and every name is read
 * from the original; it reads RCDATA (`<title>`, `<textarea>`) as markup, so those are
 * read as text; a bare `>` or `&` in text is an error to it, so an error region holding
 * no `<` is text; and a server-side template tag inside a start tag (`<div {% if x %}
 * class="a"{% endif %}>`) breaks its attribute list, so a start tag holding one is
 * re-read from its text with the template tags set aside as directives.
 *
 * ## What a template is to this parser
 *
 * An `.html` file is often Jinja, Thymeleaf, Vue or Handlebars around HTML. The markup is
 * read as HTML and the file is labelled with the dialects its markers show. Each
 * directive's value and each `{{ }}` interpolation is an `html_template_expression` row;
 * for the JavaScript-shaped dialects (Vue, Alpine, Angular) the names it calls and reads
 * are extracted, and an event directive's handler is an `html_handler_call` exactly as an
 * `onclick` is. Nothing is rendered or rewritten.
 */
export class HtmlParser {
  private readonly parser: Parser;

  constructor(private readonly css: CssParser = new CssParser()) {
    this.parser = new Parser();
    this.parser.setLanguage(Html);
  }

  parse(content: string, filePath: string, baseMservPath: string, serviceVersionLinkHash: string, repoRoot: string = baseMservPath): HtmlExtraction {
    const lines = new LineIndex(content);
    const root = parseWithTreeSitter(this.parser, sanitiseForGrammar(content)).rootNode;
    const top = namedChildrenThroughErrors(root);
    const src = (n: SyntaxNode): string => content.slice(n.startIndex, n.endIndex);
    const doctypeNode = top.find((n) => n.type === 'doctype');
    const htmlNode = top.find((n) => n.type === 'element' && tagNameOf(n, content)?.toLowerCase() === 'html');

    const fileName = path.basename(filePath);
    const relativePath = path.relative(baseMservPath, filePath).split(path.sep).join('/');
    const dialects = new Set<HtmlTemplateDialect>();
    for (const [dialect, pattern] of TEXT_DIALECTS) {
      if (pattern.test(content)) {
        dialects.add(dialect);
      }
    }
    const flavour = templateFlavourOf(content);
    const langAttribute = htmlNode === undefined ? undefined
      : readAttributes(htmlNode, content, flavour).find((a) => a.name.toLowerCase() === 'lang');
    const document = new HtmlDocument({
      name: fileName.replace(/\.[^.]+$/, ''),
      fileName,
      filePath,
      baseMservPath,
      relativePath,
      documentKind: htmlNode !== undefined || doctypeNode !== undefined ? HtmlDocumentKind.DOCUMENT : HtmlDocumentKind.FRAGMENT,
      doctype: doctypeNode === undefined ? '' : doctypeText(src(doctypeNode)),
      lang: langAttribute?.value ?? '',
      title: '',
      templateDialects: dialects,
      sourceProvenance: WEB_MINIFIED_NAME_PATTERN.test(fileName) || lines.longestLine > WEB_MINIFIED_LINE_LENGTH_THRESHOLD
        ? CssSourceProvenance.MINIFIED : CssSourceProvenance.PROJECT,
      startLine: 1,
      endLine: Math.max(1, lines.lineCount),
      serviceVersionLinkHash,
    });

    const walk = new Walk(this.css, content, lines, document, filePath, baseMservPath, serviceVersionLinkHash, dialects, flavour, repoRoot);
    const roots = new Map<string, number>();
    top.filter((n) => ELEMENT_TYPES.has(n.type)).forEach((child, index) => walk.element(child, '', '', 0, roots, index, HtmlNamespace.HTML));
    walk.recordSyntaxErrors(root);
    walk.includesAndSsi();
    walk.finish();
    return walk.result();
  }
}

/**
 * The text the GRAMMAR is handed, same length as the source so every offset is the source's.
 * HTML tag names are case-insensitive and the grammar's end-tag matching is not, so
 * `<P>…</P>` and `<p>…</P>` would both be errors to it; every tag name is lowercased for
 * the grammar only, and names are read from the original text at the node's offsets.
 */
function sanitiseForGrammar(text: string): string {
  // A `<` THAT OPENS NOTHING (C-01, #1909): in HTML a `<` is a tag only before a letter, `/`, `!` or `?`; anywhere else
  // (`v < list.length` in a code sample shown as text) it is text. `<%` is left alone: a template tag the walk reads. The grammar took `< cur` for a start tag, which then
  // swallowed the next real tag's attributes and lost it (79 elements on one documentation page). Such a `<` becomes
  // U+2039 for the grammar only, one code unit as `<` is; text is read from the source.
  return text.replace(/<\/?([A-Za-z][^\s/>]*)/g, (m) => m.toLowerCase()).replace(/<(?![A-Za-z/!?%])/g, '\u2039');
}

/** One attribute as written: its name, its decoded value, and where it sits. */
interface ReadAttribute {
  readonly name: string;
  readonly value: string;
  readonly hasValue: boolean;
  /** 0-based offset of the attribute's name, and of the end of the attribute. */
  readonly start: number;
  readonly end: number;
  /** 0-based offset of the value's first character, or undefined for a value-less attribute. */
  readonly valueStart: number | undefined;
  /** A template TAG that sat in the start tag (`{% if x %}`), not an attribute at all. */
  readonly templateTag: boolean;
}

/** The state of one page's walk. */
class Walk {
  private readonly out: HtmlExtraction;
  private readonly attributeDialects = new Set<HtmlTemplateDialect>();
  private title: string | undefined;
  private baseHref: ClassifiedUrl | undefined;
  private readonly xml: boolean;
  private scriptCount = 0;
  private inlineScriptCount = 0;
  private stylesheetReferenceCount = 0;
  private readonly gapKeys = new Set<string>();
  private readonly recovered: Array<[number, number]> = [];
  private gapOverflow = 0;
  /** Every element's source range, in walk order: the owner of a directive written in text is the innermost one. */
  private readonly spans: Array<{ start: number; end: number; row: HtmlElement }> = [];
  /** `<include src>` elements (posthtml-include): the element is replaced by the fragment at build time. */
  private readonly includeElements: Array<{ offset: number; url: string; row: HtmlElement }> = [];

  constructor(
    private readonly css: CssParser,
    private readonly content: string,
    private readonly lines: LineIndex,
    document: HtmlDocument,
    private readonly filePath: string,
    private readonly projectRoot: string,
    private readonly version: string,
    private readonly dialects: Set<HtmlTemplateDialect>,
    private readonly flavour: TemplateFlavour,
    private readonly repoRoot: string
  ) {
    // An XML document (`.xhtml`) keeps every name as written; an HTML document's tokenizer
    // lowercases tag and attribute names, foreign content included.
    this.xml = /\.xht(?:ml)?$/i.test(filePath);
    this.out = {
      document, elements: [], attributes: [], classReferences: [], references: [], scripts: [], handlerCalls: [],
      templateExpressions: [], parseGaps: [], stylesheets: [],
      css: { rules: [], selectors: [], selectorParts: [], declarations: [], valueReferences: [], comments: [], parseGaps: [] },
    };
  }

  result(): HtmlExtraction {
    return this.out;
  }

  finish(): void {
    for (const d of this.attributeDialects) {
      this.dialects.add(d);
    }
    if (this.gapOverflow > 0) {
      this.out.parseGaps.push(new HtmlParseGap({
        gapKind: HtmlParseGapKind.GAP_LIMIT_REACHED, detail: `${this.gapOverflow} further gap(s) not recorded`,
        startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, relatedElementLinkHash: '',
        documentLinkHash: this.out.document.getHash(), serviceVersionLinkHash: this.version,
      }));
    }
    this.out.document.setCounts({
      elementCount: this.out.elements.length,
      scriptCount: this.scriptCount,
      inlineScriptCount: this.inlineScriptCount,
      stylesheetReferenceCount: this.stylesheetReferenceCount,
      inlineStyleCount: this.out.stylesheets.length,
      parseGapCount: this.out.parseGaps.length,
    });
    if (this.title !== undefined) {
      this.out.document.setTitle(this.title);
    }
  }

  private src(node: SyntaxNode): string {
    return this.content.slice(node.startIndex, node.endIndex);
  }

  // ── elements ──────────────────────────────────────────────────────────────

  /**
   * Walks `node` and everything under it, pre-order, with an explicit stack: a generated
   * page or one with thousands of unclosed tags nests as deep as it is long, and the only
   * recursion limit here would have been this walker's.
   */
  element(
    node: SyntaxNode,
    parentHash: string,
    parentPath: string,
    depth: number,
    siblingCounts: Map<string, number>,
    position: number,
    namespace: HtmlNamespace
  ): void {
    const stack: Array<{
      node: SyntaxNode; parentHash: string; parentPath: string; depth: number;
      siblingCounts: Map<string, number>; position: number; namespace: HtmlNamespace; open: OpenElements;
    }> = [{ node, parentHash, parentPath, depth, siblingCounts, position, namespace, open: new Map() }];
    while (stack.length > 0) {
      const frame = stack.pop()!;
      const result = this.oneElement(frame.node, frame.parentHash, frame.parentPath, frame.depth, frame.siblingCounts, frame.position, frame.namespace, frame.open);
      if (result === undefined) {
        continue;
      }
      const counts = new Map<string, number>();
      for (let i = result.children.length - 1; i >= 0; i -= 1) {
        stack.push({
          node: result.children[i]!, parentHash: result.row.getHash(), parentPath: result.row.path, depth: frame.depth + 1,
          siblingCounts: counts, position: i, namespace: result.childNamespace, open: result.childOpen,
        });
      }
    }
  }

  /** One element's rows; returns the row and the element children still to walk, or nothing for a tagless node. */
  private oneElement(
    node: SyntaxNode,
    parentHash: string,
    parentPath: string,
    depth: number,
    siblingCounts: Map<string, number>,
    position: number,
    namespace: HtmlNamespace,
    open: OpenElements = new Map()
  ): { row: HtmlElement; children: SyntaxNode[]; childNamespace: HtmlNamespace; childOpen: OpenElements } | undefined {
    const tagNode = openingTagOf(node);
    const rawTag = tagNode === undefined ? undefined : tagNameOf(node, this.content);
    if (tagNode === undefined || rawTag === undefined) {
      return undefined;
    }
    // The browser lowercases HTML tag names and keeps foreign ones as written (`foreignObject`).
    const tag = namespace === HtmlNamespace.HTML ? rawTag.toLowerCase() : rawTag;
    const ownNamespace = namespace === HtmlNamespace.HTML && tag === 'svg' ? HtmlNamespace.SVG
      : namespace === HtmlNamespace.HTML && tag === 'math' ? HtmlNamespace.MATHML : namespace;
    const lower = tag.toLowerCase();
    const childNamespace = (ownNamespace === HtmlNamespace.SVG && lower === 'foreignobject')
      || (ownNamespace === HtmlNamespace.MATHML && lower === 'annotation-xml') ? HtmlNamespace.HTML : ownNamespace;
    const isVoid = ownNamespace === HtmlNamespace.HTML && VOID_ELEMENTS.has(tag);
    const isRcdata = ownNamespace === HtmlNamespace.HTML && RCDATA_ELEMENTS.has(tag);

    const ordinal = (siblingCounts.get(tag) ?? 0) + 1;
    siblingCounts.set(tag, ordinal);
    const pathHere = `${parentPath}/${tag}[${ordinal}]`;
    // A void element has no contents: what the grammar's implicit close left under it belongs
    // to its parent, so a void child's children are lifted beside it and a void element keeps
    // none. An RCDATA element's contents are text, whatever the grammar made of them.
    const tagEnd = startTagEnd(this.content, tagNode);
    const children = isVoid || isRcdata ? [] : contentChildren(node, childNamespace, this.content).filter((c) => c.startIndex >= tagEnd);
    // the ancestors whose open element makes a later start tag of theirs ignored (V1-19); a template's contents are a
    // document fragment of their own, with no form open
    const childOpen: OpenElements = lower === 'template' ? new Map() : ownNamespace === HtmlNamespace.HTML && IGNORED_WHEN_OPEN_TAGS.has(lower) ? new Map(open) : open;
    const openTags = new Set(childOpen.keys());
    if (lower !== 'template' && ownNamespace === HtmlNamespace.HTML && IGNORED_WHEN_OPEN_TAGS.has(lower)) openTags.add(lower);
    const lifted = childNamespace === HtmlNamespace.HTML
      ? this.withoutIgnoredStartTags(children.filter((c) => ELEMENT_TYPES.has(c.type)), openTags)
      : { elements: children.filter((c) => ELEMENT_TYPES.has(c.type)), ignored: [] };
    const elementChildren = this.treeConstructionRepairs(node, lower, ownNamespace, lifted.elements);
    const start = this.lines.positionOf(node.startIndex);
    const end = this.lines.positionOf(isVoid ? tagNode.endIndex : node.endIndex);
    const attributes = readAttributes(node, this.content, this.flavour);
    const own = (name: string): ReadAttribute | undefined => attributes.find((a) => !a.templateTag && splitAttributeName(a.name, ownNamespace, this.xml).name === name);
    const textContent = isRcdata ? this.rcdataText(node, tagNode) : node.type === 'element' ? this.directText(children) : '';
    const row = new HtmlElement({
      tagName: tag,
      namespace: ownNamespace,
      path: pathHere,
      depth,
      id: own('id')?.value.trim() ?? '',
      classNames: classTokens(own('class')?.value ?? ''),
      textContent,
      isVoid,
      childElementCount: elementChildren.length,
      attributeCount: attributes.filter((a) => !a.templateTag).length,
      position,
      startLine: start.line,
      startColumn: start.column,
      endLine: end.line,
      endColumn: end.column,
      parentElementLinkHash: parentHash,
      documentLinkHash: this.out.document.getHash(),
      serviceVersionLinkHash: this.version,
    });
    this.out.elements.push(row);
    this.spans.push({ start: node.startIndex, end: isVoid ? tagNode.endIndex : node.endIndex, row });
    if (lower === 'include' && ownNamespace === HtmlNamespace.HTML) {
      const src = own('src');
      if (src !== undefined && src.value.trim() !== '') this.includeElements.push({ offset: node.startIndex, url: src.value, row });
    }
    if (lower !== 'template' && ownNamespace === HtmlNamespace.HTML && IGNORED_WHEN_OPEN_TAGS.has(lower)) {
      (childOpen as Map<string, OpenElement>).set(lower, { row, names: new Set(attributes.filter((a) => !a.templateTag).map((a) => a.name.toLowerCase())) });
    }
    // a second <body> or <html> adds the attributes the open one lacks to it, as a browser does; a nested <form>'s are dropped
    for (const { node: ignoredNode, tag: ignoredTag } of lifted.ignored) {
      const host = childOpen.get(ignoredTag);
      const ignoredTagNode = openingTagOf(ignoredNode);
      if (host === undefined || ignoredTagNode === undefined || (ignoredTag !== 'body' && ignoredTag !== 'html')) continue;
      const added = readAttributes(ignoredNode, this.content, this.flavour).filter((a) => !a.templateTag && !host.names.has(a.name.toLowerCase()));
      for (const a of added) host.names.add(a.name.toLowerCase());
      if (added.length > 0) this.attributes(ignoredNode, host.row, added, HtmlNamespace.HTML, ignoredTagNode);
    }
    if (tag === 'title' && this.title === undefined && ownNamespace === HtmlNamespace.HTML) {
      this.title = textContent;
    }
    if (isRcdata) {
      // The grammar built elements out of RCDATA; their regions are text, not errors.
      this.recovered.push([tagNode.endIndex, node.endIndex]);
    }

    const attributeRows = this.attributes(node, row, attributes, ownNamespace, tagNode);
    this.textExpressions(children, row);
    // A <script> or <style> inside inline <svg> is run and applied by the browser as the
    // page's, so both namespaces are read; MathML has neither.
    if (node.type === 'script_element' && ownNamespace !== HtmlNamespace.MATHML) {
      this.script(node, row, attributes, attributeRows, tagNode);
    } else if (node.type === 'style_element' && ownNamespace !== HtmlNamespace.MATHML) {
      this.style(node, row, attributes, tagNode);
    }
    return { row, children: elementChildren, childNamespace, childOpen };
  }

  /** An `<a>`'s element children are cut at this many (C-03): the rest were moved out to follow it. Keyed by start offset. */
  private readonly anchorCut = new Map<number, number>();
  /** Elements written after `</body>` that a browser puts at the end of the body (C-03). Keyed by the body's start offset. */
  private readonly bodyTail = new Map<number, SyntaxNode[]>();

  /**
   * BROWSER TREE CONSTRUCTION, THE REPAIRS THAT MATTER FOR MATCHING (C-03, G4, #1909). tree-sitter-html builds the tree
   * as written; a browser does not, and a selector is matched against the browser's tree.
   * - An `<a>` start tag while an `<a>` is open closes the open one: `<a><a class="in">x</a></a>` is two sibling
   *   anchors. When a child `<a>` holds a direct child `<a>`, the outer one keeps the children before it, and the inner
   *   one with everything after it follows the outer one in the same parent.
   * - What is written after `</body>` (a late `<script>`) is put at the end of the body.
   * The repairs the walk does not make (implied `tbody`, `<p>` closed by a block, misnested formatting elements) stay
   * declared as G4.
   */
  private treeConstructionRepairs(node: SyntaxNode, lower: string, namespace: HtmlNamespace, children: SyntaxNode[]): SyntaxNode[] {
    if (namespace !== HtmlNamespace.HTML) return children;
    let out = children;
    const cut = this.anchorCut.get(node.startIndex);
    if (cut !== undefined) out = out.slice(0, cut);
    const tail = this.bodyTail.get(node.startIndex);
    if (tail !== undefined) out = [...out, ...tail];
    if (lower === 'html') {
      const b = out.findIndex((c) => tagNameOf(c, this.content)?.toLowerCase() === 'body');
      if (b >= 0 && b < out.length - 1) {
        const after = out.slice(b + 1).filter((c) => tagNameOf(c, this.content)?.toLowerCase() !== 'head');
        if (after.length > 0) {
          this.bodyTail.set(out[b]!.startIndex, [...(this.bodyTail.get(out[b]!.startIndex) ?? []), ...after]);
          out = out.filter((c) => !after.includes(c));
        }
      }
    }
    const result: SyntaxNode[] = [];
    for (const c of out) {
      result.push(c);
      if (tagNameOf(c, this.content)?.toLowerCase() !== 'a') continue;
      const tagNode = openingTagOf(c); if (tagNode === undefined) continue;
      const tagEnd = startTagEnd(this.content, tagNode);
      const kids = contentChildren(c, HtmlNamespace.HTML, this.content).filter((x) => x.startIndex >= tagEnd && ELEMENT_TYPES.has(x.type));
      const k = kids.findIndex((x) => tagNameOf(x, this.content)?.toLowerCase() === 'a');
      if (k < 0) continue;
      this.anchorCut.set(c.startIndex, k);
      result.push(...kids.slice(k));
    }
    return result;
  }

  /**
   * A START TAG THE BROWSER IGNORES (V1-19, #1909): `<form>` while a form is open, `<body>` or `<html>` inside its own
   * kind, `<head>` once the head or body is open. The grammar keeps each as an element; a browser drops the tag and its
   * attributes, and what it held becomes its parent's. So such an element is not an element row: its element children
   * take its place among the parent's, in order (and are themselves checked).
   */
  private withoutIgnoredStartTags(elements: readonly SyntaxNode[], open: ReadonlySet<string>): { elements: SyntaxNode[]; ignored: Array<{ node: SyntaxNode; tag: string }> } {
    const out: SyntaxNode[] = [];
    const ignoredNodes: Array<{ node: SyntaxNode; tag: string }> = [];
    const visit = (list: readonly SyntaxNode[]): void => {
      for (const c of list) {
        const tagNode = openingTagOf(c);
        const t = tagNode === undefined ? undefined : tagNameOf(c, this.content)?.toLowerCase();
        const ignored = t !== undefined && (t === 'head' ? open.has('head') || open.has('body') : IGNORED_WHEN_OPEN_TAGS.has(t) && open.has(t));
        if (!ignored || tagNode === undefined) { out.push(c); continue; }
        ignoredNodes.push({ node: c, tag: t });
        const tagEnd = startTagEnd(this.content, tagNode);
        visit(contentChildren(c, HtmlNamespace.HTML, this.content).filter((x) => x.startIndex >= tagEnd && ELEMENT_TYPES.has(x.type)));
      }
    };
    visit(elements);
    return { elements: out, ignored: ignoredNodes };
  }

  /** The text and entity children of an element, decoded, whitespace-normalised; an error region without markup is text too. */
  private directText(children: readonly SyntaxNode[]): string {
    return children
      .filter((c) => c.type === 'text' || c.type === 'entity' || (c.type === 'ERROR' && isTextError(this.src(c))))
      .map((c) => decodeHTML(this.src(c)))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** `<title>` and `<textarea>` hold text with character references and no markup, whatever the grammar built. */
  private rcdataText(node: SyntaxNode, tagNode: SyntaxNode): string {
    const endTag = node.namedChildren.find((c) => c.type === 'end_tag');
    const inner = this.content.slice(tagNode.endIndex, endTag?.startIndex ?? node.endIndex);
    return decodeHTML(inner).replace(/\s+/g, ' ').trim();
  }

  // ── attributes ────────────────────────────────────────────────────────────

  private attributes(node: SyntaxNode, element: HtmlElement, attributes: readonly ReadAttribute[], namespace: HtmlNamespace, tagNode: SyntaxNode): Map<string, HtmlAttribute> {
    const rows = new Map<string, HtmlAttribute>();
    const tag = element.tagName;
    const typeAttr = attributes.find((a) => !a.templateTag && a.name.toLowerCase() === 'type')?.value.trim().toLowerCase() ?? '';
    const relAttr = attributes.find((a) => !a.templateTag && a.name.toLowerCase() === 'rel')?.value.toLowerCase() ?? '';
    if (attributes.some((a) => a.templateTag) || tagNode.hasError) {
      // The start tag was re-read from its text (a template tag or a grammar error sat in it);
      // what the grammar reported inside it is covered by that reading.
      this.recovered.push([tagNode.startIndex, tagNode.endIndex]);
    }
    let expressionPosition = 0;
    for (const attr of attributes) {
      const at = this.lines.positionOf(attr.start);
      if (attr.templateTag) {
        // `{% if x %}` inside a start tag: a directive of the template's, not an attribute.
        const key = `template:${attr.start}`;
        const row = new HtmlAttribute({
          name: attr.name, prefix: '', value: '', attributeKind: HtmlAttributeKind.TEMPLATE_DIRECTIVE, hasValue: false,
          startLine: at.line, startColumn: at.column, ownerElementLinkHash: element.getHash(),
          documentLinkHash: this.out.document.getHash(), serviceVersionLinkHash: this.version,
        });
        this.out.attributes.push(row);
        rows.set(key, row);
        this.templateExpression(row, element, textDialect(attr.name, this.flavour), HtmlTemplateExpressionKind.DIRECTIVE, attr.name, '', [], attr.name, expressionPosition++, at, false);
        continue;
      }
      const { prefix, name } = splitAttributeName(attr.name, namespace, this.xml);
      const key = prefix === '' ? name : `${prefix}:${name}`;
      // The first attribute with a name wins and a repeat is a parse error, as in a browser.
      if (rows.has(key)) {
        this.gap(HtmlParseGapKind.PARSE_ERROR, 'duplicate-attribute', at, this.lines.positionOf(attr.end), element.getHash());
        continue;
      }
      const directive = readDirective(attr.name, this.flavour);
      const kind = this.attributeKind(name, prefix, tag, directive !== undefined, attr.hasValue);
      this.noteDialect(name, prefix, directive);
      const row = new HtmlAttribute({
        name, prefix, value: attr.value, attributeKind: kind, hasValue: attr.hasValue,
        startLine: at.line, startColumn: at.column, ownerElementLinkHash: element.getHash(),
        documentLinkHash: this.out.document.getHash(), serviceVersionLinkHash: this.version,
      });
      this.out.attributes.push(row);
      rows.set(key, row);
      const valueAt = attr.valueStart === undefined ? at : this.lines.positionOf(attr.valueStart);
      if (directive === undefined && attr.hasValue) {
        this.valueExpressions(attr, row, element, expressionPosition);
        expressionPosition += [...attr.value.matchAll(TEMPLATE_TAG)].length;
      }
      switch (kind) {
        case HtmlAttributeKind.CLASS:
          classTokens(attr.value).forEach((className, index) => {
            this.out.classReferences.push(new HtmlClassReference({
              className, position: index, startLine: at.line, ownerElementLinkHash: element.getHash(),
              attributeLinkHash: row.getHash(), documentLinkHash: this.out.document.getHash(),
              serviceVersionLinkHash: this.version,
            }));
          });
          break;
        case HtmlAttributeKind.STYLE:
          this.styleAttribute(attr.value, row, element, valueAt);
          break;
        case HtmlAttributeKind.EVENT_HANDLER:
          this.handler(attr.value, HtmlHandlerSource.EVENT_ATTRIBUTE, name.slice(2), row, element, attr.valueStart, valueAt);
          break;
        case HtmlAttributeKind.URL: {
          const referenceKind = this.referenceKind(tag, name, prefix, typeAttr, relAttr, node);
          // `ping` holds a set of URLs separated by whitespace; every other URL attribute holds one.
          const urls = name === 'ping' ? attr.value.split(/[ \t\n\f\r]+/).filter((u) => u !== '') : [attr.value];
          urls.forEach((url, index) => this.reference(url, index, referenceKind, row, element, valueAt));
          if (classifyUrl(attr.value).kind === WebUrlKind.JAVASCRIPT_URI) {
            const script = attr.value.trim().slice('javascript:'.length);
            const offset = attr.valueStart === undefined ? undefined : attr.valueStart + attr.value.indexOf(script);
            this.handler(script, HtmlHandlerSource.JAVASCRIPT_URL, '', row, element, offset, valueAt);
          }
          break;
        }
        case HtmlAttributeKind.SRCSET: {
          const referenceKind = this.referenceKind(tag, name, prefix, typeAttr, relAttr, node);
          srcsetCandidates(attr.value).forEach((url, index) => this.reference(url, index, referenceKind, row, element, valueAt));
          break;
        }
        case HtmlAttributeKind.TEMPLATE_DIRECTIVE:
          if (directive !== undefined) {
            this.directiveExpression(directive, attr, row, element, expressionPosition++, valueAt);
          }
          break;
        default:
          break;
      }
      if (tag === 'meta' && name === 'content' && prefix === '') {
        const httpEquiv = attributes.find((a) => !a.templateTag && a.name.toLowerCase() === 'http-equiv')?.value.trim().toLowerCase();
        const m = httpEquiv === 'refresh' ? /url\s*=\s*['"]?([^'"\s;]+)/i.exec(attr.value) : null;
        if (m !== null) {
          this.reference(m[1]!, 0, HtmlReferenceKind.META_REFRESH, row, element, valueAt);
        }
      }
    }
    return rows;
  }

  private attributeKind(name: string, prefix: string, tag: string, isDirective: boolean, hasValue = true): HtmlAttributeKind {
    if (prefix === 'xmlns' || prefix === 'xml' || name === 'xmlns' || name.startsWith('xmlns:') || name.startsWith('xml:')) {
      return HtmlAttributeKind.NAMESPACE;
    }
    if (prefix === 'xlink' && name === 'href') {
      return HtmlAttributeKind.URL;
    }
    if (prefix !== '') {
      return HtmlAttributeKind.OTHER;
    }
    if (isDirective || TEMPLATE_DIRECTIVE.test(name)) {
      return HtmlAttributeKind.TEMPLATE_DIRECTIVE;
    }
    // An event handler is an on* attribute WITH a value: a bare `once` (a framework's boolean flag) runs nothing.
    // Any case: in an XHTML page names keep their case (`onClick` is its own attribute there), and a handler it is.
    if (/^on[a-z]/i.test(name) && hasValue) {
      return HtmlAttributeKind.EVENT_HANDLER;
    }
    if (name.startsWith('data-')) {
      return HtmlAttributeKind.DATA;
    }
    if (name.startsWith('aria-') || name === 'role') {
      return HtmlAttributeKind.ARIA;
    }
    switch (name) {
      case 'id': return HtmlAttributeKind.ID;
      case 'class': return HtmlAttributeKind.CLASS;
      case 'style': return HtmlAttributeKind.STYLE;
      case 'for': return HtmlAttributeKind.FOR;
      case 'name': return HtmlAttributeKind.NAME;
      case 'type': return HtmlAttributeKind.TYPE;
      case 'rel': return HtmlAttributeKind.REL;
      case 'srcset':
      case 'imagesrcset':
        return HtmlAttributeKind.SRCSET;
      case 'data':
        return tag === 'object' ? HtmlAttributeKind.URL : HtmlAttributeKind.OTHER;
      default:
        break;
    }
    if (URL_ATTRIBUTES.has(name)) {
      return HtmlAttributeKind.URL;
    }
    if (ID_REFERENCE_ATTRIBUTES.has(name)) {
      return HtmlAttributeKind.ID_REFERENCE;
    }
    return HtmlAttributeKind.OTHER;
  }

  private noteDialect(name: string, prefix: string, directive: DirectiveReading | undefined): void {
    if (directive !== undefined) {
      this.attributeDialects.add(directive.dialect);
      return;
    }
    const full = prefix === '' ? name : `${prefix}:${name}`;
    if (full.startsWith('th:')) this.attributeDialects.add(HtmlTemplateDialect.THYMELEAF);
    if (/^(\*ng|ng-|\[|\()/.test(full)) this.attributeDialects.add(HtmlTemplateDialect.ANGULAR);
    if (full.startsWith('hx-')) this.attributeDialects.add(HtmlTemplateDialect.HTMX);
    if (full.startsWith('v-') || full.startsWith(':')) this.attributeDialects.add(HtmlTemplateDialect.VUE);
  }

  // ── template expressions ──────────────────────────────────────────────────

  /** A directive attribute's value as an expression row, and, for an event, as handler calls. */
  private directiveExpression(directive: DirectiveReading, attr: ReadAttribute, row: HtmlAttribute, element: HtmlElement, position: number, at: Pos): void {
    const text = attr.value;
    let declares: string[] = [];
    let source = text;
    if (directive.kind === HtmlTemplateExpressionKind.LOOP) {
      const loop = readLoop(directive.dialect, text);
      declares = loop.declares;
      source = loop.source;
    } else if (directive.kind === HtmlTemplateExpressionKind.SLOT) {
      declares = names(text);
      source = '';
    }
    const expression = this.templateExpression(row, element, directive.dialect, directive.kind, attr.name, directive.argument, directive.modifiers, text, position, at, directive.javascript && source !== '', source, declares);
    if (directive.kind === HtmlTemplateExpressionKind.EVENT_HANDLER && directive.javascript && text.trim() !== '') {
      this.templateHandler(text, directive.argument, row, element, attr.valueStart, at);
    }
    if (directive.kind === HtmlTemplateExpressionKind.REQUEST && text.trim() !== '') {
      this.reference(text, 0, HtmlReferenceKind.REQUEST, row, element, at);
    }
    void expression;
  }

  /** The template tags inside a plain attribute's value: `href="{{ url_for('home') }}"`, `class="btn {{ cls }}"`. */
  private valueExpressions(attr: ReadAttribute, row: HtmlAttribute, element: HtmlElement, firstPosition: number): void {
    let position = firstPosition;
    for (const m of attr.value.matchAll(TEMPLATE_TAG)) {
      const tag = m[0];
      const at = attr.valueStart === undefined ? this.lines.positionOf(attr.start) : this.lines.positionOf(attr.valueStart + m.index);
      const dialect = textDialect(tag, this.flavour);
      const interpolation = tag.startsWith('{{') ? !/^\{\{[#/>^!]/.test(tag) : /^<%[=-]/.test(tag) || tag.startsWith('<?=');
      const inner = tag.startsWith('{{') ? tag.slice(2, -2) : tag.startsWith('<%') ? tag.slice(2, -2).replace(/^[=\-#@]/, '') : tag.slice(2, -2);
      const javascript = interpolation && (dialect === HtmlTemplateDialect.VUE || dialect === HtmlTemplateDialect.ANGULAR);
      this.templateExpression(row, element, dialect, interpolation ? HtmlTemplateExpressionKind.INTERPOLATION : HtmlTemplateExpressionKind.DIRECTIVE, row.name, row.name, [], inner.trim(), position++, at, javascript);
    }
  }

  /** The `{{ }}` interpolations and `{% %}` / `<% %>` tags in an element's own text. */
  private textExpressions(children: readonly SyntaxNode[], element: HtmlElement): void {
    let position = 0;
    for (const child of children) {
      if (child.type !== 'text' && child.type !== 'ERROR') {
        continue;
      }
      const text = this.src(child);
      if (!TEMPLATE_MARKER.test(text)) {
        continue;
      }
      // An error region made of a template tag (`<%= name %>`, `<?php … ?>`) is the template's, not a gap.
      if (child.type === 'ERROR') {
        this.recovered.push([child.startIndex, child.endIndex]);
      }
      for (const m of text.matchAll(TEMPLATE_TAG)) {
        const tag = m[0];
        const at = this.lines.positionOf(child.startIndex + m.index);
        const dialect = textDialect(tag, this.flavour);
        const interpolation = tag.startsWith('{{') ? !/^\{\{[#/>^!]/.test(tag) : /^<%[=-]/.test(tag) || tag.startsWith('<?=');
        const inner = tag.startsWith('{{') ? tag.slice(2, -2) : tag.startsWith('<%') ? tag.slice(2, -2).replace(/^[=\-#@]/, '') : tag.slice(2, -2);
        const javascript = interpolation && (dialect === HtmlTemplateDialect.VUE || dialect === HtmlTemplateDialect.ANGULAR);
        this.templateExpression(undefined, element, dialect, interpolation ? HtmlTemplateExpressionKind.INTERPOLATION : HtmlTemplateExpressionKind.DIRECTIVE, '', '', [], inner.trim(), position++, at, javascript);
      }
    }
  }

  private templateExpression(
    attribute: HtmlAttribute | undefined,
    element: HtmlElement,
    dialect: HtmlTemplateDialect,
    kind: HtmlTemplateExpressionKind,
    directive: string,
    argument: string,
    modifiers: readonly string[],
    text: string,
    position: number,
    at: Pos,
    javascript: boolean,
    source = text,
    declares: string[] = []
  ): HtmlTemplateExpression {
    let callees = new Set<string>();
    let identifiers = new Set<string>();
    if (javascript && source.trim() !== '') {
      const shape = kind === HtmlTemplateExpressionKind.EVENT_HANDLER ? 'statements' : 'expression';
      // Angular and Vue 2 pipes (`name | uppercase`) are the one common non-JavaScript shape;
      // the expression before the first pipe is JavaScript and is what is read.
      const read = readJsExpression(shape === 'expression' ? source.split(/\s\|\s/)[0]! : source, shape);
      callees = read.callees;
      identifiers = read.identifiers;
    }
    for (const d of declares) {
      identifiers.delete(d);
    }
    const row = new HtmlTemplateExpression({
      dialect, expressionKind: kind, directive, argument, modifiers, expressionText: text, calleeNames: callees,
      identifiers, declares, position, startLine: at.line, startColumn: at.column,
      ownerElementLinkHash: element.getHash(), attributeLinkHash: attribute?.getHash() ?? '',
      documentLinkHash: this.out.document.getHash(), serviceVersionLinkHash: this.version,
    });
    this.out.templateExpressions.push(row);
    return row;
  }

  /**
   * A template event directive's handler as calls. A bare name or member path is the
   * handler the framework CALLS (`@click="save"` runs `save`), so it is one call with no
   * arguments; anything else is the statement the framework runs, read as a handler is.
   */
  private templateHandler(text: string, eventName: string, attribute: HtmlAttribute, element: HtmlElement, offset: number | undefined, fallbackAt: Pos): void {
    if (MEMBER_PATH.test(text)) {
      const callee = text.trim();
      const dot = callee.lastIndexOf('.');
      this.out.handlerCalls.push(new HtmlHandlerCall({
        handlerSource: HtmlHandlerSource.TEMPLATE_EVENT, eventName, calleeName: dot < 0 ? callee : callee.slice(dot + 1).trim(),
        receiverText: dot < 0 ? '' : callee.slice(0, dot).trim(), calleeText: callee, argumentCount: 0, isNew: false, position: 0,
        startLine: fallbackAt.line, startColumn: fallbackAt.column, ownerElementLinkHash: element.getHash(),
        attributeLinkHash: attribute.getHash(), documentLinkHash: this.out.document.getHash(), serviceVersionLinkHash: this.version,
      }));
      return;
    }
    this.handler(text, HtmlHandlerSource.TEMPLATE_EVENT, eventName, attribute, element, offset, fallbackAt);
  }

  // ── references ────────────────────────────────────────────────────────────

  private referenceKind(tag: string, attr: string, prefix: string, type: string, rel: string, node: SyntaxNode): HtmlReferenceKind {
    if (prefix === 'xlink') {
      return HtmlReferenceKind.OTHER;
    }
    switch (tag) {
      case 'script': return attr === 'src' ? HtmlReferenceKind.SCRIPT : HtmlReferenceKind.OTHER;
      case 'link':
        if (attr !== 'href' && attr !== 'imagesrcset') return HtmlReferenceKind.OTHER;
        return rel.split(/\s+/).includes('stylesheet') ? HtmlReferenceKind.STYLESHEET : HtmlReferenceKind.LINK_RESOURCE;
      case 'a':
      case 'area':
        return attr === 'href' ? HtmlReferenceKind.ANCHOR : HtmlReferenceKind.OTHER;
      case 'img':
        return attr === 'src' || attr === 'srcset' ? HtmlReferenceKind.IMAGE : HtmlReferenceKind.OTHER;
      case 'input':
        if (attr === 'formaction') return HtmlReferenceKind.FORM_ACTION;
        return attr === 'src' && type === 'image' ? HtmlReferenceKind.IMAGE : HtmlReferenceKind.OTHER;
      case 'button':
        return attr === 'formaction' ? HtmlReferenceKind.FORM_ACTION : HtmlReferenceKind.OTHER;
      case 'source': {
        const parent = node.parent;
        const inPicture = parent !== null && ELEMENT_TYPES.has(parent.type) && tagNameOf(parent, this.content)?.toLowerCase() === 'picture';
        if (attr !== 'src' && attr !== 'srcset') return HtmlReferenceKind.OTHER;
        return inPicture ? HtmlReferenceKind.IMAGE : HtmlReferenceKind.MEDIA;
      }
      case 'video':
      case 'audio':
      case 'track':
        return attr === 'src' || attr === 'poster' ? HtmlReferenceKind.MEDIA : HtmlReferenceKind.OTHER;
      case 'iframe':
      case 'frame':
      case 'embed':
        return attr === 'src' ? HtmlReferenceKind.FRAME : HtmlReferenceKind.OTHER;
      case 'object':
        return attr === 'data' ? HtmlReferenceKind.FRAME : HtmlReferenceKind.OTHER;
      case 'form':
        return attr === 'action' ? HtmlReferenceKind.FORM_ACTION : HtmlReferenceKind.OTHER;
      case 'base':
        return attr === 'href' ? HtmlReferenceKind.BASE : HtmlReferenceKind.OTHER;
      default:
        return HtmlReferenceKind.OTHER;
    }
  }

  private reference(url: string, position: number, kind: HtmlReferenceKind, attribute: HtmlAttribute, element: HtmlElement, at: Pos): void {
    const classified = classifyUrl(url);
    if (kind === HtmlReferenceKind.BASE && this.baseHref === undefined && (classified.kind === WebUrlKind.RELATIVE || classified.kind === WebUrlKind.ROOT_RELATIVE)) {
      this.baseHref = classified;
    }
    // A `<base href>` is what every later relative URL resolves against, as in a browser.
    const effective = kind === HtmlReferenceKind.BASE ? classified : applyBase(classified, this.baseHref);
    const resolved = resolveUrlToFile(effective, this.filePath, this.projectRoot, this.repoRoot);
    if (kind === HtmlReferenceKind.STYLESHEET) {
      this.stylesheetReferenceCount += 1;
    }
    this.out.references.push(new HtmlReference({
      referenceKind: kind, urlAsWritten: url.trim(), urlKind: classified.kind, path: classified.path,
      query: classified.query, fragment: classified.fragment, resolvedFilePath: resolved, isResolved: resolved !== '',
      position, attributeName: attribute.prefix === '' ? attribute.name : `${attribute.prefix}:${attribute.name}`,
      startLine: at.line, startColumn: at.column, ownerElementLinkHash: element.getHash(),
      attributeLinkHash: attribute.getHash(), documentLinkHash: this.out.document.getHash(),
      serviceVersionLinkHash: this.version,
    }));
  }

  // ── handlers ──────────────────────────────────────────────────────────────

  private handler(text: string, source: HtmlHandlerSource, eventName: string, attribute: HtmlAttribute, element: HtmlElement, offset: number | undefined, fallbackAt: Pos): void {
    if (text.trim() === '') {
      return;
    }
    if (TEMPLATE_MARKER.test(text)) {
      // `onclick="{{ handler }}"` is a FunctionBody only once rendered. `{{ x }}` even parses
      // as JavaScript (two nested blocks), so a gap is recorded on the marker, not on a
      // syntax error, and no call is read: the calls in there are the template's.
      this.gap(HtmlParseGapKind.HANDLER_SYNTAX, `${attribute.name}: template expression in handler`, fallbackAt, fallbackAt, element.getHash());
      return;
    }
    const parsed = handlerCallsOf(text);
    parsed.calls.forEach((call, index) => {
      const at = offset === undefined ? fallbackAt : this.lines.positionOf(offset + call.offset);
      this.out.handlerCalls.push(new HtmlHandlerCall({
        handlerSource: source, eventName, calleeName: call.calleeName, receiverText: call.receiverText,
        calleeText: call.calleeText, argumentCount: call.argumentCount, isNew: call.isNew, position: index,
        startLine: at.line, startColumn: at.column, ownerElementLinkHash: element.getHash(),
        attributeLinkHash: attribute.getHash(), documentLinkHash: this.out.document.getHash(),
        serviceVersionLinkHash: this.version,
      }));
    });
    if (parsed.error !== undefined) {
      const at = offset === undefined ? fallbackAt : this.lines.positionOf(offset + parsed.error.offset);
      this.gap(HtmlParseGapKind.HANDLER_SYNTAX, `${attribute.name}: ${parsed.error.message}`, at, at, element.getHash());
    }
  }

  // ── scripts ───────────────────────────────────────────────────────────────

  private script(node: SyntaxNode, element: HtmlElement, attributes: readonly ReadAttribute[], rows: Map<string, HtmlAttribute>, tagNode: SyntaxNode): void {
    this.scriptCount += 1;
    const attr = (name: string): ReadAttribute | undefined => attributes.find((a) => !a.templateTag && a.name.toLowerCase() === name);
    const src = attr('src')?.value;
    const typeAsWritten = attr('type')?.value.trim() ?? '';
    const external = src !== undefined && src.trim() !== '';
    const body = this.bodyRange(node, tagNode);
    if (!external) {
      this.inlineScriptCount += 1;
    }
    const srcAttribute = rows.get('src');
    const reference = srcAttribute === undefined ? undefined
      : this.out.references.find((r) => r.attributeLinkHash === srcAttribute.getHash() && r.position === 0);
    this.out.scripts.push(new HtmlScript({
      scriptKind: external ? HtmlScriptKind.EXTERNAL : HtmlScriptKind.INLINE,
      scriptType: scriptType(typeAsWritten),
      typeAsWritten,
      src: src?.trim() ?? '',
      resolvedFilePath: reference?.resolvedFilePath ?? '',
      isAsync: attr('async') !== undefined,
      isDefer: attr('defer') !== undefined,
      isNoModule: attr('nomodule') !== undefined,
      bodyStartLine: external ? 0 : body.start.line,
      bodyStartColumn: external ? 0 : body.start.column,
      bodyEndLine: external ? 0 : body.end.line,
      bodyEndColumn: external ? 0 : body.end.column,
      bodyLength: external ? 0 : body.length,
      ownerElementLinkHash: element.getHash(),
      referenceLinkHash: reference?.getHash() ?? '',
      documentLinkHash: this.out.document.getHash(),
      serviceVersionLinkHash: this.version,
    }));
  }

  /** The raw text between an element's start tag and its end tag: the `raw_text` node, or the empty span after the start tag. */
  private bodyRange(node: SyntaxNode, tagNode: SyntaxNode): { start: Pos; end: Pos; text: string; length: number } {
    const raw = node.namedChildren.find((c) => c.type === 'raw_text');
    const startOffset = raw?.startIndex ?? tagNode.endIndex;
    const endOffset = raw?.endIndex ?? tagNode.endIndex;
    const text = this.content.slice(startOffset, endOffset);
    return { start: this.lines.positionOf(startOffset), end: this.lines.positionOf(endOffset), text, length: text.length };
  }

  // ── styles ────────────────────────────────────────────────────────────────

  private style(node: SyntaxNode, element: HtmlElement, attributes: readonly ReadAttribute[], tagNode: SyntaxNode): void {
    const type = attributes.find((a) => !a.templateTag && a.name.toLowerCase() === 'type')?.value.trim().toLowerCase() ?? '';
    if (type !== '' && type !== 'text/css') {
      return;
    }
    const body = this.bodyRange(node, tagNode);
    const sheet = new CssStylesheet({
      name: `${this.out.document.name}#style${this.out.stylesheets.length + 1}`,
      fileName: this.out.document.fileName,
      filePath: this.filePath,
      baseMservPath: this.out.document.baseMservPath,
      relativePath: this.out.document.relativePath,
      sourceKind: CssStylesheetSource.HTML_STYLE_ELEMENT,
      sourceProvenance: this.out.document.sourceProvenance,
      ownerHtmlElementLinkHash: element.getHash(),
      htmlDocumentLinkHash: this.out.document.getHash(),
      startLine: body.start.line,
      startColumn: body.start.column,
      endLine: body.end.line,
      serviceVersionLinkHash: this.version,
    });
    this.out.stylesheets.push(sheet);
    const extracted = this.css.parseStylesheet(body.text, {
      stylesheet: sheet, line: body.start.line, column: body.start.column, filePath: this.filePath,
      projectRoot: this.projectRoot, repoRoot: this.repoRoot, serviceVersionLinkHash: this.version, baseHref: this.baseHref,
    });
    // Loops, not `push(...rows)`: a spread passes every row as an argument and overflows
    // the stack on a <style> of tens of thousands of rules.
    for (const r of extracted.rules) this.out.css.rules.push(r);
    for (const r of extracted.selectors) this.out.css.selectors.push(r);
    for (const r of extracted.selectorParts) this.out.css.selectorParts.push(r);
    for (const r of extracted.declarations) this.out.css.declarations.push(r);
    for (const r of extracted.valueReferences) this.out.css.valueReferences.push(r);
    for (const r of extracted.comments) this.out.css.comments.push(r);
    for (const r of extracted.parseGaps) this.out.css.parseGaps.push(r);
  }

  private styleAttribute(value: string, attribute: HtmlAttribute, element: HtmlElement, at: Pos): void {
    if (value.trim() === '') {
      return;
    }
    if (TEMPLATE_MARKER.test(value)) {
      // `style="width: {{ w }}px"` is a declaration list only once rendered.
      this.gap(HtmlParseGapKind.STYLE_ATTRIBUTE_SYNTAX, 'template expression in style attribute', at, at, element.getHash());
      return;
    }
    const extracted = this.css.parseDeclarationList(value, {
      htmlAttributeLinkHash: attribute.getHash(), line: at.line, column: at.column, filePath: this.filePath,
      projectRoot: this.projectRoot, repoRoot: this.repoRoot, serviceVersionLinkHash: this.version, baseHref: this.baseHref,
    });
    for (const d of extracted.declarations as CssDeclaration[]) this.out.css.declarations.push(d);
    for (const v of extracted.valueReferences as CssValueReference[]) this.out.css.valueReferences.push(v);
    for (const error of extracted.errors) {
      const where = { line: error.line, column: error.column };
      this.gap(HtmlParseGapKind.STYLE_ATTRIBUTE_SYNTAX, error.message, where, where, element.getHash());
    }
  }

  // ── gaps ──────────────────────────────────────────────────────────────────

  /**
   * Every place the grammar could not read as HTML: an `ERROR` region, a token it had to
   * invent (`MISSING`), and an end tag with no open element. Not reported: an error region
   * that is text (a bare `>` or `&`), a construct HTML defines as a comment (`<?xml …?>`,
   * `<![CDATA[…]]>`), and a region a text-level reading has covered.
   */
  recordSyntaxErrors(root: SyntaxNode): void {
    const stack: SyntaxNode[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.type === 'ERROR' || node.isMissing || node.type === 'erroneous_end_tag') {
        if (this.recovered.some(([a, b]) => node.startIndex >= a && node.endIndex <= b)) {
          continue;
        }
        const text = this.src(node);
        if (node.type === 'ERROR' && (isTextError(text) || /^<\?[\s\S]*\?>$/.test(text) || /^<!\[CDATA\[/.test(text) || TEMPLATE_MARKER.test(text))) {
          continue;
        }
        const detail = node.isMissing ? `missing-token: ${node.type}`
          : node.type === 'erroneous_end_tag' ? `erroneous-end-tag: ${snippet(text)}` : `syntax-error: ${snippet(text)}`;
        this.gap(HtmlParseGapKind.PARSE_ERROR, detail, this.lines.positionOf(node.startIndex), this.lines.positionOf(node.endIndex), '');
        continue;
      }
      if (!node.hasError) {
        continue;
      }
      const children = node.children;
      for (let i = children.length - 1; i >= 0; i -= 1) {
        stack.push(children[i]!);
      }
    }
  }

  /**
   * INCLUDE REFERENCES (G22) AND SSI DIRECTIVES (G23), read from the page text, since each kind lives where the tree
   * does not look: an SSI directive is a comment, a Jinja tag or a gulp `@@include` is text. Each include is a reference
   * of kind INCLUDE whose `attributeName` names its flavour (`ssi:virtual`, `ssi:file`, `posthtml:include`,
   * `gulp:@@include`, `jinja:include`, `jinja:extends`, `jinja:import`). Its owner is the innermost element the directive
   * sits in (none at the top level), or for `<include src>` the include element itself, which the fragment replaces.
   * Paths relative to the page (`ssi:file`, posthtml, gulp) are resolved here; `ssi:virtual` (site root) and Jinja
   * (template directories) are resolved by the engine, which sees every page. A path that is a template expression
   * (`{% include name %}`) has url kind TEMPLATE_EXPRESSION. Every SSI directive is also a template expression of
   * dialect SSI, with the directive's name and its arguments as written.
   */
  includesAndSsi(): void {
    const text = this.content;
    const found: Array<{ offset: number; flavour: string; url: string; expression: boolean; owner: HtmlElement | undefined }> = [];
    const ownerAt = (offset: number): HtmlElement | undefined => {
      let best: { start: number; end: number; row: HtmlElement } | undefined;
      for (const sp of this.spans) if (sp.start <= offset && offset < sp.end && (best === undefined || sp.start >= best.start)) best = sp;
      return best?.row;
    };
    for (const m of text.matchAll(/<!--#\s*([a-z]+)\b([\s\S]*?)-->/gi)) {
      const name = m[1]!.toLowerCase();
      const args = m[2]!.trim();
      const owner = ownerAt(m.index);
      if (name === 'include') {
        const a = /\b(virtual|file)\s*=\s*(["'])([\s\S]*?)\2/i.exec(args);
        if (a !== null) found.push({ offset: m.index, flavour: `ssi:${a[1]!.toLowerCase()}`, url: a[3]!, expression: /\$\{?\w/.test(a[3]!), owner });
      }
      const kind = name === 'echo' ? HtmlTemplateExpressionKind.INTERPOLATION : name === 'set' ? HtmlTemplateExpressionKind.BINDING
        : ['if', 'elif', 'else', 'endif'].includes(name) ? HtmlTemplateExpressionKind.CONDITION
          : name === 'include' ? HtmlTemplateExpressionKind.REFERENCE : HtmlTemplateExpressionKind.DIRECTIVE;
      if (owner !== undefined && SSI_DIRECTIVE_MARKER.test(m[0])) {
        this.dialects.add(HtmlTemplateDialect.SSI);
        this.templateExpression(undefined, owner, HtmlTemplateDialect.SSI, kind, name, '', [], args, m.index, this.lines.positionOf(m.index), false);
      }
    }
    for (const m of text.matchAll(/@@include\(\s*(["'])([^"'\n]*)\1/g)) {
      found.push({ offset: m.index, flavour: 'gulp:@@include', url: m[2]!, expression: false, owner: ownerAt(m.index) });
    }
    for (const m of text.matchAll(/\{%-?\s*(include|extends|import|from)\s+([\s\S]*?)\s*-?%\}/g)) {
      const verb = m[1] === 'from' ? 'import' : m[1]!;
      const q = /^(["'])([^"'\n]*)\1/.exec(m[2]!);
      const url = q !== null ? q[2]! : m[2]!.split(/\s+(?:with|without|ignore|import|as|only)\b/)[0]!.trim();
      found.push({ offset: m.index, flavour: `jinja:${verb}`, url, expression: q === null, owner: ownerAt(m.index) });
    }
    for (const inc of this.includeElements) found.push({ offset: inc.offset, flavour: 'posthtml:include', url: inc.url, expression: false, owner: inc.row });
    found.sort((a, b) => a.offset - b.offset);
    found.forEach((f, position) => {
      const at = this.lines.positionOf(f.offset);
      const classified = classifyUrl(f.url);
      const pageRelative = f.flavour === 'ssi:file' || f.flavour === 'posthtml:include' || f.flavour === 'gulp:@@include';
      const resolved = !f.expression && pageRelative ? resolveUrlToFile(classified, this.filePath, this.projectRoot, this.repoRoot) : '';
      this.out.references.push(new HtmlReference({
        referenceKind: HtmlReferenceKind.INCLUDE, urlAsWritten: f.url.trim(), urlKind: f.expression ? WebUrlKind.TEMPLATE_EXPRESSION : classified.kind,
        path: f.expression ? '' : classified.path, query: f.expression ? '' : classified.query, fragment: f.expression ? '' : classified.fragment,
        resolvedFilePath: resolved, isResolved: resolved !== '', position, attributeName: f.flavour, startLine: at.line, startColumn: at.column,
        ownerElementLinkHash: f.owner?.getHash() ?? '', attributeLinkHash: '', documentLinkHash: this.out.document.getHash(),
        serviceVersionLinkHash: this.version,
      }));
    });
  }

  private gap(kind: HtmlParseGapKind, detail: string, start: Pos, end: Pos, related: string): void {
    const key = `${kind}|${start.line}|${start.column}|${detail}`;
    if (this.gapKeys.has(key)) {
      return;
    }
    this.gapKeys.add(key);
    if (this.out.parseGaps.length >= WEB_PARSE_GAP_LIMIT) {
      this.gapOverflow += 1;
      return;
    }
    this.out.parseGaps.push(new HtmlParseGap({
      gapKind: kind, detail, startLine: start.line, startColumn: start.column, endLine: end.line,
      endColumn: end.column, relatedElementLinkHash: related, documentLinkHash: this.out.document.getHash(),
      serviceVersionLinkHash: this.version,
    }));
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** An error region that holds no `<`: a bare `>`, `&` or `=` in text, which HTML reads as characters. */
/** An open element whose later start tag of the same kind is ignored, and the attribute names it already has. */
interface OpenElement { row: HtmlElement; names: Set<string> }
type OpenElements = ReadonlyMap<string, OpenElement>;

/** Tags whose start tag is ignored while an element of the same kind is open (`head` also once `body` is). */
const IGNORED_WHEN_OPEN_TAGS = new Set(['form', 'body', 'html', 'head']);

function isTextError(text: string): boolean {
  return !text.includes('<');
}

/** The dialect a text-level template tag belongs to, decided by its delimiters and the page's company. */
function textDialect(tag: string, flavour: TemplateFlavour): HtmlTemplateDialect {
  if (tag.startsWith('<?')) return HtmlTemplateDialect.PHP;
  if (tag.startsWith('<%')) return HtmlTemplateDialect.ERB;
  if (tag.startsWith('{%') || tag.startsWith('{#')) return HtmlTemplateDialect.JINJA;
  if (/^\{\{[#/>^]/.test(tag) || flavour.handlebars) return HtmlTemplateDialect.HANDLEBARS;
  if (flavour.jinja) return HtmlTemplateDialect.JINJA;
  if (flavour.angular && !flavour.vue) return HtmlTemplateDialect.ANGULAR;
  if (flavour.vue) return HtmlTemplateDialect.VUE;
  return HtmlTemplateDialect.MUSTACHE;
}

/**
 * The content children of an element: its named children except the tags, with a VOID
 * child's own children lifted up beside it, since a void element cannot hold them.
 */
function contentChildren(node: SyntaxNode, namespace: HtmlNamespace, content: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const visit = (parent: SyntaxNode): void => {
    for (const child of parent.namedChildren) {
      if (child.type.endsWith('_tag')) {
        continue;
      }
      if (child.type === 'ERROR') {
        // An error region: its elements are the parent's, and its text is text.
        out.push(child);
        for (const inner of child.namedChildren) {
          if (ELEMENT_TYPES.has(inner.type) || inner.type === 'text' || inner.type === 'entity') {
            out.push(inner);
          }
        }
        continue;
      }
      out.push(child);
      if (namespace === HtmlNamespace.HTML && ELEMENT_TYPES.has(child.type)) {
        const tag = tagNameOf(child, content)?.toLowerCase();
        if (tag !== undefined && VOID_ELEMENTS.has(tag)) {
          visit(child);
        }
      }
    }
  };
  visit(node);
  return out;
}

/** An element's `start_tag` or `self_closing_tag` node. */
function openingTagOf(node: SyntaxNode): SyntaxNode | undefined {
  return node.namedChildren.find((c) => c.type === 'start_tag' || c.type === 'self_closing_tag');
}

function tagNameOf(node: SyntaxNode, content: string): string | undefined {
  const name = openingTagOf(node)?.namedChildren.find((c) => c.type === 'tag_name');
  return name === undefined ? undefined : content.slice(name.startIndex, name.endIndex);
}

/**
 * An element's attributes. From the grammar's nodes when the start tag parsed cleanly and
 * holds no template tag; from the start tag's TEXT otherwise, because a template tag
 * (`{% if x %}class="a"{% endif %}`) or an unquoted value the grammar rejects (`href=a?b=1`)
 * breaks the grammar's attribute list, and the text still says what was written.
 */
function readAttributes(node: SyntaxNode, content: string, flavour: TemplateFlavour): ReadAttribute[] {
  void flavour;
  const tagNode = openingTagOf(node);
  if (tagNode === undefined) {
    return [];
  }
  const tagEnd = startTagEnd(content, tagNode);
  const tagText = content.slice(tagNode.startIndex, tagEnd);
  if (tagNode.hasError || TEMPLATE_TAG.test(tagText)) {
    TEMPLATE_TAG.lastIndex = 0;
    return rawAttributes(tagText, tagNode.startIndex);
  }
  TEMPLATE_TAG.lastIndex = 0;
  return tagNode.namedChildren.filter((c) => c.type === 'attribute').map((attr) => {
    const nameNode = attr.namedChildren.find((c) => c.type === 'attribute_name');
    const hasValue = attr.children.some((c) => !c.isNamed && c.type === '=');
    const quoted = attr.namedChildren.find((c) => c.type === 'quoted_attribute_value');
    const inner = quoted?.namedChildren.find((c) => c.type === 'attribute_value')
      ?? attr.namedChildren.find((c) => c.type === 'attribute_value');
    const valueStart = !hasValue ? undefined : inner?.startIndex ?? (quoted === undefined ? undefined : quoted.startIndex + 1);
    return {
      name: nameNode === undefined ? '' : content.slice(nameNode.startIndex, nameNode.endIndex),
      value: decodeHTMLAttribute(inner === undefined ? '' : content.slice(inner.startIndex, inner.endIndex)),
      hasValue,
      start: attr.startIndex,
      end: attr.endIndex,
      valueStart,
      templateTag: false,
    };
  }).filter((a) => a.name !== '');
}

/**
 * Where a start tag really ends: the grammar's node, or, when the grammar gave up inside it
 * (a template tag broke its attribute list), the first `>` outside quotes and template tags.
 */
export function startTagEnd(content: string, tagNode: SyntaxNode): number {
  if (!tagNode.hasError) {
    return tagNode.endIndex;
  }
  let i = tagNode.startIndex + 1;
  let quote = '';
  while (i < content.length) {
    const ch = content[i]!;
    if (quote !== '') {
      if (ch === quote) quote = '';
      i += 1;
      continue;
    }
    TEMPLATE_TAG.lastIndex = i;
    const m = TEMPLATE_TAG.exec(content);
    if (m !== null && m.index === i) {
      i += m[0].length;
      continue;
    }
    if (ch === '"' || ch === '\'') {
      quote = ch;
    } else if (ch === '>') {
      TEMPLATE_TAG.lastIndex = 0;
      return i + 1;
    } else if (ch === '<' && i > tagNode.startIndex + 1 && /[A-Za-z/!]/.test(content[i + 1] ?? '')) {
      // The next tag began: this one never closed.
      TEMPLATE_TAG.lastIndex = 0;
      return Math.max(tagNode.endIndex, i);
    }
    i += 1;
  }
  TEMPLATE_TAG.lastIndex = 0;
  return tagNode.endIndex;
}

/**
 * A start tag's attributes read from its text: template tags set aside (each becomes a
 * TEMPLATE_DIRECTIVE pseudo-attribute), then `name`, `name=value`, `name="value"` and
 * `name='value'` in what remains, with values taken from the ORIGINAL text so a template
 * tag inside a quoted value survives whole.
 */
function rawAttributes(tagText: string, tagStart: number): ReadAttribute[] {
  const open = /^<[^\s/>]+/.exec(tagText);
  const from = open === null ? 1 : open[0].length;
  const closing = tagText.endsWith('/>') ? 2 : tagText.endsWith('>') ? 1 : 0;
  const body = tagText.slice(from, tagText.length - closing);
  const out: ReadAttribute[] = [];
  let masked = body;
  const tags: Array<{ start: number; end: number; text: string }> = [];
  for (const m of body.matchAll(TEMPLATE_TAG)) {
    tags.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    masked = masked.slice(0, m.index) + ' '.repeat(m[0].length) + masked.slice(m.index + m[0].length);
  }
  const attribute = /([^\s"'=<>/]+)(\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"'][^\s>]*)))?/g;
  for (const m of masked.matchAll(attribute)) {
    const name = m[1]!;
    const hasValue = m[2] !== undefined;
    let valueStart: number | undefined;
    let rawValue = '';
    if (hasValue) {
      const eq = m[0].indexOf('=');
      const afterEq = m[0].slice(eq + 1);
      const quote = afterEq.trimStart()[0];
      const valueOffsetInMatch = eq + 1 + (afterEq.length - afterEq.trimStart().length) + (quote === '"' || quote === '\'' ? 1 : 0);
      const length = m[3]?.length ?? m[4]?.length ?? m[5]?.length ?? 0;
      valueStart = tagStart + from + m.index + valueOffsetInMatch;
      rawValue = body.slice(m.index + valueOffsetInMatch, m.index + valueOffsetInMatch + length);
    }
    out.push({ name, value: decodeHTMLAttribute(rawValue), hasValue, start: tagStart + from + m.index, end: tagStart + from + m.index + m[0].length, valueStart, templateTag: false });
  }
  // A template tag standing between attributes is a directive of the template's; one inside
  // an attribute's value is that attribute's expression and is read with the attribute.
  for (const tag of tags) {
    const inside = out.some((a) => a.valueStart !== undefined && tagStart + from + tag.start >= a.valueStart && tagStart + from + tag.end <= a.end);
    if (!inside) {
      out.push({ name: tag.text.replace(/\s+/g, ' ').trim(), value: '', hasValue: false, start: tagStart + from + tag.start, end: tagStart + from + tag.end, valueStart: undefined, templateTag: true });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * `xlink:href` on an SVG element is a prefixed attribute; `xmlns:th` on an HTML element
 * is one attribute whose name has a colon in it. The split follows the browser's: only in
 * foreign content, and only for the three namespace prefixes it knows. A template
 * dialect's attribute keeps its case (`*ngIf`); every other name is lowercased, as the HTML
 * tokenizer does in foreign content too (`<rect ID="x">` has the id `x`), with the SVG
 * attributes the tree builder re-cases (`viewBox`) restored. In an XML document (`xml`)
 * names are case-sensitive and kept as written.
 */
function splitAttributeName(raw: string, namespace: HtmlNamespace, xml: boolean): { prefix: string; name: string } {
  if (namespace !== HtmlNamespace.HTML) {
    const name = xml || TEMPLATE_DIRECTIVE.test(raw) ? raw : raw.toLowerCase();
    const colon = name.indexOf(':');
    if (colon > 0 && FOREIGN_ATTRIBUTE_PREFIXES.has(name.slice(0, colon))) {
      return { prefix: name.slice(0, colon), name: name.slice(colon + 1) };
    }
    return { prefix: '', name: xml ? name : SVG_ADJUSTED_ATTRIBUTES.get(name) ?? name };
  }
  // An XML document (.xhtml) keeps every attribute name as written: `onclick` and `onClick` are two attributes there,
  // not a duplicate (an HTML document lowercases them, and the second is then a duplicate and a parse gap).
  return { prefix: '', name: xml || TEMPLATE_DIRECTIVE.test(raw) ? raw : raw.toLowerCase() };
}

/** The class tokens of a value, with any template tag in it set aside: `btn {{ cls }}` is one class and a template's. */
function classTokens(value: string): string[] {
  return value.replace(TEMPLATE_TAG, ' ').split(/[ \t\n\f\r]+/).filter((t) => t !== '');
}

/** `<!DOCTYPE html PUBLIC "…" "…">` as `html PUBLIC "…" "…"`, whitespace-normalised. */
function doctypeText(raw: string): string {
  const m = /^<!\s*doctype\s*([\s\S]*?)\s*>$/i.exec(raw.trim());
  return (m?.[1] ?? '').replace(/\s+/g, ' ').trim();
}

function snippet(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

/**
 * The URLs of a `srcset`, per the HTML specification's parsing algorithm: a URL runs to the
 * next whitespace, so a comma inside it (`a.png?x=1,2 100w`) does not split; a URL ending in
 * commas ends its candidate there, otherwise the descriptors run to the next comma outside
 * parentheses.
 */
function srcsetCandidates(value: string): string[] {
  const urls: string[] = [];
  const space = /[ \t\n\f\r]/;
  let i = 0;
  while (i < value.length) {
    while (i < value.length && (space.test(value[i]!) || value[i] === ',')) i += 1;
    if (i >= value.length) break;
    const start = i;
    while (i < value.length && !space.test(value[i]!)) i += 1;
    let url = value.slice(start, i);
    const endedByComma = url.endsWith(',');
    url = url.replace(/,+$/, '');
    if (url !== '') urls.push(url);
    if (!endedByComma) {
      let depth = 0;
      while (i < value.length) {
        const ch = value[i]!;
        i += 1;
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        else if (ch === ',' && depth <= 0) break;
      }
    }
  }
  return urls;
}

function scriptType(type: string): HtmlScriptType {
  // A MIME type's parameters (`;charset=utf-8`) do not change what it is.
  const t = type.toLowerCase().split(';')[0]!.trim();
  if (t === '' || JAVASCRIPT_MIME.test(t)) return HtmlScriptType.CLASSIC;
  if (t === 'module') return HtmlScriptType.MODULE;
  if (t === 'importmap') return HtmlScriptType.IMPORTMAP;
  if (t === 'speculationrules') return HtmlScriptType.SPECULATION_RULES;
  if (/json$/.test(t)) return HtmlScriptType.JSON;
  if (/template|text\/html|handlebars|mustache|x-tmpl|jsrender|jquery-tmpl|x-dot/.test(t)) return HtmlScriptType.TEMPLATE;
  if (/babel|jsx|typescript|coffeescript|tsx|x-ts/.test(t)) return HtmlScriptType.TRANSPILED;
  return HtmlScriptType.DATA_BLOCK;
}
