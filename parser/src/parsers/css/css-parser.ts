import Parser from 'tree-sitter';
import Css from 'tree-sitter-css';

import { CssComment } from '@/analysis-types/css/CssComment';
import { CssDeclaration } from '@/analysis-types/css/CssDeclaration';
import { CssParseGap } from '@/analysis-types/css/CssParseGap';
import { CssRule } from '@/analysis-types/css/CssRule';
import { CssSelector } from '@/analysis-types/css/CssSelector';
import { CssSelectorPart } from '@/analysis-types/css/CssSelectorPart';
import { CssStylesheet } from '@/analysis-types/css/CssStylesheet';
import { CssValueReference } from '@/analysis-types/css/CssValueReference';
import { WEB_COMMENT_TEXT_LIMIT, WEB_PARSE_GAP_LIMIT } from '@/constants/web-constants';
import { CssParseGapKind } from '@/enums/css/CssParseGapKind';
import { CssRuleKind } from '@/enums/css/CssRuleKind';
import { CssCombinator, CssSelectorPartKind } from '@/enums/css/CssSelectorPartKind';
import { CssValueReferenceKind } from '@/enums/css/CssValueReferenceKind';
import { WebUrlKind } from '@/enums/web/WebUrlKind';
import { LineIndex, mapEmbeddedPosition } from '@/utils/web/line-index';
import { parseWithTreeSitter } from '@/utils/web/tree-sitter-parse';
import { applyBase, BaseUrl, classifyUrl, resolveUrlToFile } from '@/utils/web/url-reference';

type SyntaxNode = Parser.SyntaxNode;
type Pos = { line: number; column: number };

/** Where a stylesheet's text sits, so every position lands in the host file. */
export interface CssOrigin {
  /** The row every CSS row of this text chains off. */
  readonly stylesheet: CssStylesheet;
  /** 1-based line and column of the text's first character in the host file. */
  readonly line: number;
  readonly column: number;
  /** The file a relative `url()` resolves against, and the project root for a root-relative one. */
  readonly filePath: string;
  readonly projectRoot: string;
  readonly serviceVersionLinkHash: string;
  /** The page's `<base href>`, when the CSS sits in a page that has one: relative URLs resolve against it, as in a browser. */
  readonly baseHref?: BaseUrl;
}

/** Where a `style="…"` attribute's declaration list sits. */
export interface CssDeclarationListOrigin {
  readonly htmlAttributeLinkHash: string;
  readonly line: number;
  readonly column: number;
  readonly baseHref?: BaseUrl;
  readonly filePath: string;
  readonly projectRoot: string;
  readonly serviceVersionLinkHash: string;
}

/** Everything one stylesheet text produces. The stylesheet row itself is the caller's. */
export interface CssExtraction {
  rules: CssRule[];
  selectors: CssSelector[];
  selectorParts: CssSelectorPart[];
  declarations: CssDeclaration[];
  valueReferences: CssValueReference[];
  comments: CssComment[];
  parseGaps: CssParseGap[];
}

/** What a `style` attribute produces. A syntax error is the caller's to record, against the page. */
export interface CssDeclarationListExtraction {
  declarations: CssDeclaration[];
  valueReferences: CssValueReference[];
  errors: { message: string; line: number; column: number }[];
}

/** `font-family` values that name a generic family, never a `@font-face`. */
const GENERIC_FONT_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif',
  'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', 'inherit', 'initial', 'unset', 'revert',
  'revert-layer',
]);

/** Identifiers of the `animation` shorthand that are keywords, not a `@keyframes` name. */
const ANIMATION_KEYWORDS = new Set([
  'none', 'infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'forwards', 'backwards',
  'both', 'running', 'paused', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'step-start',
  'step-end', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'auto', 'replace', 'add',
  'accumulate',
]);

/** Single-colon pseudo-elements the Selectors specification still admits. */
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);

/** Functional pseudo-classes whose specificity is that of their most specific argument. */
const SPECIFICITY_OF_ARGUMENT = new Set(['is', 'not', 'has', 'matches', '-webkit-any', '-moz-any', 'host', 'host-context']);

/** Functional pseudo-classes whose argument is a selector list (plus `nth-*`'s `of S`, handled apart). */
const SELECTOR_ARGUMENT_PSEUDOS = new Set(['is', 'not', 'where', 'has', 'matches', '-webkit-any', '-moz-any', 'host', 'host-context', 'slotted']);

/** Preprocessor syntax that cannot be CSS. Each is a (name, pattern) so the gap names what it saw. */
const PREPROCESSOR_MARKERS: ReadonlyArray<readonly [string, RegExp]> = [
  ['sass variable', /(^|[\s;{])\$[A-Za-z_][\w-]*\s*:/m],
  ['sass directive', /@(mixin|include|extend|function|return|each|while|use|forward)\b/],
  // An at-rule name followed by a colon is a Less variable only when it is not a CSS at-rule
  // (`@page :first` is one), and Less writes no space before the colon.
  ['less variable', /^\s*@(?!(?:page|media|import|charset|namespace|supports|font-face|keyframes|layer|container|property|scope|counter-style|font-feature-values|font-palette-values|position-try|view-transition|starting-style|document|viewport|-[a-z]+-[a-z-]+)\b)[A-Za-z_][\w-]*:/m],
  ['less mixin call', /^\s*\.[A-Za-z_][\w-]*\s*\([^)]*\)\s*;/m],
];

/**
 * A CSS escape: a backslash and up to six hex digits with an optional trailing space, or a
 * backslash and any other character. Tailwind writes `.md\:flex` and `.w-1\/2`; a hand
 * written sheet writes `#\31 23` for an id starting with a digit.
 */
const CSS_ESCAPE = /\\(?:[0-9a-fA-F]{1,6} ?|[^\n0-9a-fA-F])/g;

/**
 * The text the GRAMMAR is handed, same length as the source so every offset is the source's.
 *
 * tree-sitter-css has no rule for an escape in an identifier: `.md\:flex` ends the class at
 * `\` and the rest is an error that can swallow the next rule whole. Each escape is replaced
 * by underscores of the same length, which the grammar reads as part of the identifier, and
 * every name is then read from the ORIGINAL text at the node's offsets and unescaped. A
 * dotted `@layer a.b` is sanitised the same way: the grammar reads `.b` as a class selector
 * and starts a rule, so the dots of a layer name become underscores for the grammar only.
 */
function sanitiseForGrammar(text: string): string {
  // A COMMENT THAT HOLDS A BRACE (#1909): theme builders write `border:1px solid #ddd/*{borderColor}*/;` inside a
  // declaration value, and the grammar, which takes a comment there for the start of a nested rule, turned every
  // declaration after it into a bogus nested "rule" (`font-family: Arial` read as a selector) and dropped them.
  // The braces inside a comment are blanked for the grammar only; a comment row reads its text from the source.
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => (/[{}]/.test(m) ? m.replace(/[{}]/g, ' ') : m));
  out = out.replace(CSS_ESCAPE, (m) => '_'.repeat(m.length));
  // A non-ASCII character in an identifier (`.日本語`, `.emoji-🚀`) is legal CSS the grammar
  // rejects; every code unit above ASCII becomes an underscore of the same length.
  out = out.replace(/[^\x00-\x7f]/g, '_');
  out = out.replace(/@layer\s+[\w.-]+(?:\s*,\s*[\w.-]+)*|\blayer\(\s*[\w.-]+\s*\)/g, (m) => m.replace(/\./g, '_'));
  // `<!--` and `-->` around a stylesheet (the old way of hiding CSS from a browser without
  // `<style>`) are tokens CSS ignores at the top level; the grammar does not know them.
  out = out.replace(/(^|\s)(<!--|-->)(?=\s|$)/g, (_m, lead: string, token: string) => lead + ' '.repeat(token.length));
  // A single-quoted string inside `:not([a*='x'])` is an error to the grammar where the
  // double-quoted one is not; a single-quoted string holding no `"` is requoted for it.
  out = out.replace(/'([^'"\n\\]*)'/g, (_m, inner: string) => `"${inner}"`);
  // `!IMPORTANT` is important (CSS keywords are case-insensitive); the grammar knows the lowercase spelling only.
  out = out.replace(/!\s*important\b/gi, (m) => m.toLowerCase());
  return out;
}

/** The text with every comment's inside blanked, same length, for scans that must not read comments. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => '/*' + ' '.repeat(m.length - 4) + '*/');
}

/** An identifier as written, with its CSS escapes decoded: `md\:flex` is `md:flex`, `\31 23` is `123`. */
function unescapeCss(text: string): string {
  return text.replace(CSS_ESCAPE, (m) => {
    const hex = /^\\([0-9a-fA-F]{1,6}) ?$/.exec(m);
    if (hex !== null) {
      const code = parseInt(hex[1]!, 16);
      return code === 0 || code > 0x10ffff ? '\ufffd' : String.fromCodePoint(code);
    }
    return m.slice(1);
  });
}

/** The grammar's at-rule statement node types; `at_rule` is the generic one. */
const AT_RULE_TYPES = new Set([
  'media_statement', 'supports_statement', 'keyframes_statement', 'import_statement', 'charset_statement',
  'namespace_statement', 'at_rule', 'postcss_statement',
]);

/** The grammar's combinator node types, each binary: left selector, operator, right selector. */
const COMBINATOR_TYPES: Record<string, CssCombinator> = {
  descendant_selector: CssCombinator.DESCENDANT,
  child_selector: CssCombinator.CHILD,
  adjacent_sibling_selector: CssCombinator.NEXT_SIBLING,
  sibling_selector: CssCombinator.SUBSEQUENT_SIBLING,
};

const IDENTIFIER = /^-?[A-Za-z_][\w-]*$/;

/** Words a `@container` prelude may begin with that are not a container's name. */
const CONTAINER_QUERY_KEYWORDS = new Set(['not', 'and', 'or', 'style', 'scroll-state']);

/**
 * A second parser for selector TEXT the grammar left raw inside an argument: `:nth-child(2n of
 * .x)` is an `ERROR` to it, and the selector after `of` is read here as a rule of its own.
 */
let selectorTextParser: Parser | undefined;
function selectorNodesFromText(text: string): SyntaxNode[] {
  if (selectorTextParser === undefined) {
    selectorTextParser = new Parser();
    selectorTextParser.setLanguage(Css);
  }
  const root = selectorTextParser.parse(sanitiseForGrammar(`${text}{}`)).rootNode;
  const selectors = root.namedChildren.find((c) => c.type === 'rule_set')?.namedChildren.find((c) => c.type === 'selectors');
  return selectors === undefined ? [] : selectors.namedChildren.filter((c) => c.type !== 'ERROR' && c.type !== 'comment');
}

/** One simple selector as the grammar and this file read it. */
interface Part {
  kind: CssSelectorPartKind;
  name: string;
  value: string;
  matcher: string;
  flags: string;
  offset: number;
  /** The selector roots inside a functional pseudo-class's parentheses. */
  args: SyntaxNode[];
  /** When `args` were read from text (`of S`): that text and the sheet offset it begins at, so its parts are cited where S sits. */
  argument?: { text: string; offset: number };
  /** A region the grammar rejected that the text read: its error is not a gap. */
  recovered?: [number, number];
}

/** One compound: the parts between two combinators, and the combinator written before it. */
interface Compound {
  combinator: CssCombinator;
  parts: Part[];
}

/** The text being read and where it sits, shared by every method of one parse. */
interface Sheet {
  readonly text: string;
  readonly lines: LineIndex;
  readonly host: Pos;
  readonly filePath: string;
  readonly projectRoot: string;
  readonly version: string;
  readonly stylesheetLinkHash: string;
  /** The host page's `<base href>`, for CSS written in a page. */
  readonly baseHref?: BaseUrl;
  /**
   * For a VIEW over a wrapper text (`*{ … }` around a fragment): the sheet the fragment
   * came from and the function taking a wrapper offset to that sheet's offset. Positions
   * resolve through the chain, so a row read from the wrapper is cited in the real file.
   */
  readonly base?: Sheet;
  readonly toBase?: (offset: number) => number;
}

/** An offset of a sheet (or a wrapper view) as an offset of the base sheet. */
function baseOffset(sheet: Sheet, offset: number): number {
  return sheet.base !== undefined && sheet.toBase !== undefined ? baseOffset(sheet.base, sheet.toBase(offset)) : offset;
}

/** The host-file position of an offset in a sheet, through any wrapper views. */
function locate(sheet: Sheet, offset: number): Pos {
  if (sheet.base !== undefined && sheet.toBase !== undefined) {
    return locate(sheet.base, sheet.toBase(offset));
  }
  return mapEmbeddedPosition(sheet.host, sheet.lines.positionOf(offset));
}

/** A view over `*{ text }` whose fragment sits at `offset` of `sheet`. */
function wrapperView(sheet: Sheet, wrapped: string, offset: number): Sheet {
  return {
    ...sheet,
    text: wrapped,
    lines: new LineIndex(wrapped),
    base: sheet,
    toBase: (o: number) => Math.max(0, o - 2) + offset,
  };
}

/**
 * The CSS front end: tree-sitter-css's tree, read into rows.
 *
 * ## What the grammar decides and what this file decides
 *
 * tree-sitter-css tokenises and builds the tree, tolerantly: a construct it does not know
 * becomes an `ERROR` node and parsing resumes at the next rule or declaration. It knows
 * selectors as a nested binary tree (`a > b c` is `descendant(child(a, b), c)`), rules
 * nested in rules, the common at-rules, and `call_expression` values. It does not know
 * every shape this file meets — an unquoted `url(../x)`, an attribute selector's `i` flag,
 * `@container`'s name, a range media query — so where the tree is broken the text is read
 * directly: every value reference (`var()`, `url()`, a keyframes or font name) is scanned
 * from the declaration's text rather than its nodes, and a prelude is a source slice.
 * Each `ERROR` is still a recorded gap, so a consumer knows where the tree was weak.
 *
 * ## Positions are the host file's
 *
 * A `<style>` block's CSS begins at some (line, column) of a page; every offset is mapped
 * through `mapEmbeddedPosition` so a reader opening `page.html:41` sees the declaration.
 * A `.css` file is the degenerate case with an origin of (1, 1).
 */
export class CssParser {
  private readonly parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Css);
  }

  /** A whole stylesheet: a `.css` file or a `<style>` body. */
  parseStylesheet(text: string, origin: CssOrigin): CssExtraction {
    const out: CssExtraction = {
      rules: [], selectors: [], selectorParts: [], declarations: [], valueReferences: [], comments: [], parseGaps: [],
    };
    const sheet: Sheet = {
      text, lines: new LineIndex(text), host: { line: origin.line, column: origin.column }, filePath: origin.filePath,
      projectRoot: origin.projectRoot, version: origin.serviceVersionLinkHash, stylesheetLinkHash: origin.stylesheet.getHash(),
      baseHref: origin.baseHref,
    };
    const gaps = new GapCollector(out.parseGaps);
    const root = parseWithTreeSitter(this.parser, sanitiseForGrammar(text)).rootNode;
    this.walkBlock(root, '', 0, sheet, out, gaps, '');
    this.recordSyntaxErrors(root, sheet, gaps);
    const uncommented = withoutComments(text);
    for (const [name, pattern] of PREPROCESSOR_MARKERS) {
      const m = pattern.exec(uncommented);
      if (m !== null) {
        gaps.add(sheet, CssParseGapKind.PREPROCESSOR_SYNTAX, `${name}: ${m[0].trim()}`, m.index, m.index + m[0].length, '');
        break;
      }
    }
    gaps.finish(sheet);
    origin.stylesheet.setCounts({
      ruleCount: out.rules.length,
      declarationCount: out.declarations.length,
      parseGapCount: out.parseGaps.length,
    });
    return out;
  }

  /**
   * A `style="…"` attribute's declaration list. The grammar has no declaration-list entry
   * point, so the text is read inside a throwaway `*{ … }` rule and every offset is shifted
   * back by the two characters of that prefix.
   */
  parseDeclarationList(text: string, origin: CssDeclarationListOrigin): CssDeclarationListExtraction {
    const out: CssDeclarationListExtraction = { declarations: [], valueReferences: [], errors: [] };
    const sheet: Sheet = {
      text, lines: new LineIndex(text), host: { line: origin.line, column: origin.column }, filePath: origin.filePath,
      projectRoot: origin.projectRoot, version: origin.serviceVersionLinkHash, stylesheetLinkHash: '', baseHref: origin.baseHref,
    };
    const collected: CssExtraction = {
      rules: [], selectors: [], selectorParts: [], declarations: [], valueReferences: [], comments: [], parseGaps: [],
    };
    const gaps = new GapCollector(collected.parseGaps);
    this.declarationsFromText(text, 0, '', origin.htmlAttributeLinkHash, sheet, collected, gaps, 0);
    gaps.finish(sheet);
    out.declarations = collected.declarations;
    out.valueReferences = collected.valueReferences;
    out.errors = collected.parseGaps.map((g) => ({ message: g.detail, line: g.startLine, column: g.startColumn }));
    return out;
  }

  // ── blocks ────────────────────────────────────────────────────────────────

  /**
   * The children of a block (or of the stylesheet), in order. `ERROR` nodes are looked
   * into for the rules and declarations they still hold, and reported by the sweep.
   * Returns the counts the owning rule records.
   */
  private walkBlock(
    container: SyntaxNode,
    parentRule: string,
    depth: number,
    sheet: Sheet,
    out: CssExtraction,
    gaps: GapCollector,
    parentAtRule: string,
    declarationPosition = { n: 0 }
  ): { rules: number; declarations: number } {
    let position = 0;
    const counts = { rules: 0, declarations: 0 };
    // The rule a top-level declaration continues: the previous rule, when its block ended
    // on a grammar error. Reset by anything else, since a rule that closed cleanly is done.
    let spilled: { rule: string; positions: { n: number } } | undefined;
    let leadingCombinator: SyntaxNode | undefined;
    for (const node of liftedChildrenKeepingHeaders(container, sheet)) {
      if (node.type === 'declaration') {
        // handled below; the spill context must survive a run of them
      } else if (node.type === 'rule_set' && parentRule === '' && node.hasError && lastBlockUnclosed(node, sheet)) {
        spilled = { rule: '', positions: { n: 0 } };
      } else if (node.type === 'ERROR' && parentRule === '' && isRejectedHeader(sourceOf(sheet, node))) {
        // A rule HEADER the grammar rejected, possibly with the start of its block swallowed
        // (`tag[a="b c"]{--x:1`): the text up to the `{` is the rule, read through the
        // selector reader; the text after it and the declarations that follow are its block.
        const rule = this.ruleFromText(node, position++, depth, sheet, out, gaps);
        counts.rules += 1;
        spilled = { rule: rule.getHash(), positions: { n: 0 } };
        const text = sourceOf(sheet, node);
        const brace = text.indexOf('{');
        if (brace >= 0 && text.slice(brace + 1).trim() !== '') {
          const emitted = this.declarationsFromText(text.slice(brace + 1), node.startIndex + brace + 1, rule.getHash(), '', sheet, out, gaps, 0, spilled.positions);
          counts.declarations += emitted;
        }
        continue;
      } else if (node.type === 'ERROR' && /keyframes$/.test(parentAtRule) && /^[\s\d.%,]*(?:from|to)?[\s\d.%,]*$/.test(sourceOf(sheet, node))) {
        // `10%, 20% { }` or `68.2% { }`: the grammar reads one integer percentage per keyframe
        // block and rejects the rest of the selector; it is the next block's prelude.
        leadingCombinator = node;
        continue;
      } else if (node.type === 'ERROR' && LEADING_SELECTOR_FRAGMENT.test(sourceOf(sheet, node))) {
        // A relative selector's leading combinator (`> .f` in a nested rule), or the first
        // `&` of `& &`, is an ERROR beside the rule it begins; the rule reads it from the text.
        leadingCombinator = node;
        continue;
      } else if (node.type === 'ERROR' && parentRule !== '' && container.type === 'block' && isDeclarationRun(sourceOf(sheet, node))) {
        // `color red; a: b; c: d`: one malformed declaration takes the block's remaining
        // declarations into its ERROR. The text is read again, declaration by declaration;
        // the malformed one is reported from there, so the grammar's whole-run error is not.
        gaps.recover(sheet, node.startIndex, node.endIndex);
        counts.declarations += this.declarationsFromText(sourceOf(sheet, node), node.startIndex, parentRule, '', sheet, out, gaps, declarationPosition.n, declarationPosition);
        continue;
      } else {
        spilled = undefined;
      }
      if (node.type === 'rule_set') {
        const before = out.rules.length;
        this.styleRule(node, parentRule, position++, depth, sheet, out, gaps, parentAtRule, leadingCombinator);
        leadingCombinator = undefined;
        counts.rules += 1;
        if (spilled !== undefined && out.rules.length > before) {
          const rule = out.rules[before]!;
          spilled = { rule: rule.getHash(), positions: { n: rule.getDeclarationCount() } };
        }
      } else if (node.type === 'keyframe_block') {
        this.keyframeBlock(node, parentRule, position++, depth, sheet, out, gaps, leadingCombinator);
        leadingCombinator = undefined;
        counts.rules += 1;
      } else if (AT_RULE_TYPES.has(node.type)) {
        this.atRule(node, parentRule, position++, depth, sheet, out, gaps);
        counts.rules += 1;
      } else if (node.type === 'declaration') {
        if (parentRule === '') {
          // A declaration at the top level of a stylesheet. When the rule before it ended on
          // a grammar error, the grammar closed that rule early and these are the rest of
          // its block (`rgb(0 0 0/10%)` did this to a `:root` block of sixty custom
          // properties): they belong to that rule. Otherwise (`$primary: red;`) CSS allows
          // no declaration here and it is a gap, not a row.
          if (spilled !== undefined) {
            counts.declarations += this.declaration(node, spilled.rule, '', sheet, out, gaps, spilled.positions);
            const owner = out.rules.find((r) => r.getHash() === spilled!.rule);
            if (owner !== undefined) {
              owner.setCounts({ selectorCount: owner.getSelectorCount(), declarationCount: spilled.positions.n, childRuleCount: owner.getChildRuleCount() });
            }
            continue;
          }
          gaps.add(sheet, CssParseGapKind.UNPARSED_FRAGMENT, `declaration outside a rule: ${snippet(sourceOf(sheet, node))}`, node.startIndex, node.endIndex, '');
          continue;
        }
        counts.declarations += this.declaration(node, parentRule, '', sheet, out, gaps, declarationPosition);
      } else if (node.type === 'comment') {
        this.comment(node, sheet, out);
      } else if (node.type === 'js_comment') {
        gaps.add(sheet, CssParseGapKind.PREPROCESSOR_SYNTAX, `line comment: ${snippet(node.text)}`, node.startIndex, node.endIndex, parentRule);
      }
    }
    return counts;
  }

  private styleRule(
    node: SyntaxNode,
    parentRule: string,
    position: number,
    depth: number,
    sheet: Sheet,
    out: CssExtraction,
    gaps: GapCollector,
    parentAtRule: string,
    leadingCombinator?: SyntaxNode
  ): void {
    const selectors = node.namedChildren.find((c) => c.type === 'selectors');
    const block = node.namedChildren.find((c) => c.type === 'block');
    const preludeEnd = block?.startIndex ?? selectors?.endIndex ?? node.endIndex;
    const ruleStart = leadingCombinator?.startIndex ?? node.startIndex;
    const preludeText = collapse(sheet.text.slice(ruleStart, preludeEnd));
    const start = this.at(sheet, ruleStart);
    const end = this.at(sheet, node.endIndex);
    const rule = new CssRule({
      ruleKind: CssRuleKind.STYLE_RULE, atRuleName: '', name: '', preludeText, nestingDepth: depth, position,
      startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column,
      parentRuleLinkHash: parentRule, stylesheetLinkHash: sheet.stylesheetLinkHash, serviceVersionLinkHash: sheet.version,
    });
    out.rules.push(rule);
    let selectorCount = 0;
    if (selectors !== undefined) {
      const keyframes = /keyframes$/.test(parentAtRule);
      const groups = selectorGroups(selectors);
      // What the grammar rejected beside the selector list is an ERROR sibling of it: after
      // the list (`.title &`) it belongs to the last selector written, before it (`> .f`, a
      // relative selector's leading combinator) to the first.
      const first = groups[0];
      const last = groups[groups.length - 1];
      if (leadingCombinator !== undefined && first !== undefined) {
        first.start = leadingCombinator.startIndex;
        gaps.recover(sheet, leadingCombinator.startIndex, leadingCombinator.endIndex);
      }
      for (const sibling of node.children) {
        if (sibling.type !== 'ERROR' || sibling.endIndex > preludeEnd || /^[\s,]*$/.test(sourceOf(sheet, sibling))) {
          continue;
        }
        if (sibling.startIndex >= selectors.endIndex && last !== undefined) {
          last.nodes.push(sibling);
          last.end = sibling.endIndex;
        } else if (sibling.endIndex <= selectors.startIndex && first !== undefined) {
          first.start = sibling.startIndex;
          gaps.recover(sheet, sibling.startIndex, sibling.endIndex);
        }
      }
      for (const group of groups) {
        this.selector(group, selectorCount++, rule, sheet, out, gaps, keyframes);
      }
    }
    const counts = block === undefined ? { rules: 0, declarations: 0 }
      : this.walkBlock(block, rule.getHash(), depth + 1, sheet, out, gaps, parentAtRule);
    rule.setCounts({ selectorCount, declarationCount: counts.declarations, childRuleCount: counts.rules });
  }

  /** A style rule whose header the grammar rejected, read from the header's text; its block is the declarations that follow. */
  private ruleFromText(header: SyntaxNode, position: number, depth: number, sheet: Sheet, out: CssExtraction, gaps: GapCollector): CssRule {
    const text = sourceOf(sheet, header);
    const preludeText = collapse(text.slice(0, text.indexOf('{')));
    const start = this.at(sheet, header.startIndex);
    const end = this.at(sheet, header.endIndex);
    const rule = new CssRule({
      ruleKind: CssRuleKind.STYLE_RULE, atRuleName: '', name: '', preludeText, nestingDepth: depth, position,
      startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column,
      parentRuleLinkHash: '', stylesheetLinkHash: sheet.stylesheetLinkHash, serviceVersionLinkHash: sheet.version,
    });
    out.rules.push(rule);
    gaps.recover(sheet, header.startIndex, header.endIndex);
    gaps.add(sheet, CssParseGapKind.UNPARSED_FRAGMENT, `rule header read from text: ${snippet(preludeText)}`, header.startIndex, header.endIndex, rule.getHash());
    let selectorCount = 0;
    for (const root of selectorNodesFromText(preludeText)) {
      const localSheet: Sheet = { ...sheet, text: `${preludeText}{}` };
      const group: SelectorGroup = { nodes: [root], start: root.startIndex, end: root.endIndex };
      const compounds = flattenGroup(group, localSheet);
      const s = specificity(compounds, localSheet);
      const row = new CssSelector({
        selectorText: collapse(preludeText.slice(root.startIndex, root.endIndex)), position: selectorCount++, specificityA: s.a, specificityB: s.b,
        specificityC: s.c, compoundCount: compounds.length, hasNesting: s.nesting, hasPseudoElement: s.pseudoElement,
        startLine: start.line, startColumn: start.column, endLine: start.line, endColumn: start.column,
        ruleLinkHash: rule.getHash(), stylesheetLinkHash: sheet.stylesheetLinkHash, serviceVersionLinkHash: sheet.version,
      });
      out.selectors.push(row);
      const counter = { position: 0 };
      this.emitParts(compounds, row, rule, '', 0, { ...localSheet, lines: new LineIndex(`${preludeText}{}`), host: start, base: undefined, toBase: undefined }, out, counter);
    }
    rule.setCounts({ selectorCount, declarationCount: 0, childRuleCount: 0 });
    return rule;
  }

  /** `from { … }`, `50% { … }`, `to { … }` inside `@keyframes`: a rule whose selector is a moment, not an element. */
  private keyframeBlock(node: SyntaxNode, parentRule: string, position: number, depth: number, sheet: Sheet, out: CssExtraction, gaps: GapCollector, leading?: SyntaxNode): void {
    const block = node.namedChildren.find((c) => c.type === 'block');
    const ruleStart = leading?.startIndex ?? node.startIndex;
    const preludeText = collapse(sheet.text.slice(ruleStart, block?.startIndex ?? node.endIndex));
    // What the grammar rejected in the selector (`68.2%`, a `10%, 20%` list) the text has read.
    gaps.recover(sheet, ruleStart, block?.startIndex ?? node.endIndex);
    const start = this.at(sheet, ruleStart);
    const end = this.at(sheet, node.endIndex);
    const rule = new CssRule({
      ruleKind: CssRuleKind.STYLE_RULE, atRuleName: '', name: '', preludeText, nestingDepth: depth, position,
      startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column,
      parentRuleLinkHash: parentRule, stylesheetLinkHash: sheet.stylesheetLinkHash, serviceVersionLinkHash: sheet.version,
    });
    out.rules.push(rule);
    const selectorEnd = this.at(sheet, (block?.startIndex ?? node.endIndex));
    out.selectors.push(new CssSelector({
      selectorText: preludeText, position: 0, specificityA: 0, specificityB: 0, specificityC: 0, compoundCount: 0,
      hasNesting: false, hasPseudoElement: false, startLine: start.line, startColumn: start.column,
      endLine: selectorEnd.line, endColumn: selectorEnd.column, ruleLinkHash: rule.getHash(),
      stylesheetLinkHash: sheet.stylesheetLinkHash, serviceVersionLinkHash: sheet.version,
    }));
    const counts = block === undefined ? { rules: 0, declarations: 0 } : this.walkBlock(block, rule.getHash(), depth + 1, sheet, out, gaps, 'keyframes');
    rule.setCounts({ selectorCount: 1, declarationCount: counts.declarations, childRuleCount: counts.rules });
  }

  private atRule(node: SyntaxNode, parentRule: string, position: number, depth: number, sheet: Sheet, out: CssExtraction, gaps: GapCollector): void {
    const keyword = node.children.find((c) => c.text.startsWith('@'));
    const name = (keyword === undefined ? '@' : sourceOf(sheet, keyword)).slice(1).toLowerCase();
    const block = node.namedChildren.find((c) => c.type === 'block' || c.type === 'keyframe_block_list');
    const preludeStart = keyword?.endIndex ?? node.startIndex;
    let preludeEnd = block?.startIndex ?? node.endIndex;
    if (block === undefined && sheet.text[preludeEnd - 1] === ';') {
      preludeEnd -= 1;
    }
    const preludeText = collapse(sheet.text.slice(preludeStart, preludeEnd));
    const start = this.at(sheet, node.startIndex);
    const end = this.at(sheet, node.endIndex);
    const rule = new CssRule({
      ruleKind: CssRuleKind.AT_RULE, atRuleName: name, name: atRuleDeclaredName(name, preludeText), preludeText,
      nestingDepth: depth, position, startLine: start.line, startColumn: start.column, endLine: end.line,
      endColumn: end.column, parentRuleLinkHash: parentRule, stylesheetLinkHash: sheet.stylesheetLinkHash,
      serviceVersionLinkHash: sheet.version,
    });
    out.rules.push(rule);
    if (node.type === 'postcss_statement') {
      gaps.add(sheet, CssParseGapKind.PREPROCESSOR_SYNTAX, `postcss statement: ${snippet(node.text)}`, node.startIndex, node.endIndex, rule.getHash());
    }
    this.preludeReferences(name, preludeText, preludeStart, rule.getHash(), sheet, out, gaps);
    let counts = { rules: 0, declarations: 0 };
    if (block !== undefined) {
      const bare = name.replace(/^-[a-z]+-/, '');
      counts = this.walkBlock(block, rule.getHash(), depth + 1, sheet, out, gaps, bare);
      if (bare === 'font-face') {
        const family = out.declarations.find((d) => d.ruleLinkHash === rule.getHash() && d.property.toLowerCase() === 'font-family');
        if (family !== undefined) {
          rule.setName(family.valueText.replace(/^["']|["']$/g, ''));
        }
      }
    }
    rule.setCounts({ selectorCount: 0, declarationCount: counts.declarations, childRuleCount: counts.rules });
  }

  // ── selectors ─────────────────────────────────────────────────────────────

  private selector(group: SelectorGroup, position: number, rule: CssRule, sheet: Sheet, out: CssExtraction, gaps: GapCollector, keyframes: boolean): void {
    const start = this.at(sheet, group.start);
    const end = this.at(sheet, group.end);
    const selectorText = collapse(sheet.text.slice(group.start, group.end));
    const compounds = keyframes ? [] : flattenGroup(group, sheet);
    for (const compound of compounds) {
      for (const part of compound.parts) {
        if (part.recovered !== undefined) {
          gaps.recover(sheet, part.recovered[0], part.recovered[1]);
        }
      }
    }
    const s = specificity(compounds, sheet);
    const row = new CssSelector({
      selectorText, position, specificityA: s.a, specificityB: s.b, specificityC: s.c, compoundCount: compounds.length,
      hasNesting: s.nesting || /(^|[\s>+~(])&/.test(selectorText), hasPseudoElement: s.pseudoElement,
      startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column,
      ruleLinkHash: rule.getHash(), stylesheetLinkHash: sheet.stylesheetLinkHash, serviceVersionLinkHash: sheet.version,
    });
    out.selectors.push(row);
    const counter = { position: 0 };
    this.emitParts(compounds, row, rule, '', 0, sheet, out, counter);
  }

  private emitParts(
    compounds: readonly Compound[],
    selector: CssSelector,
    rule: CssRule,
    parentPart: string,
    depth: number,
    sheet: Sheet,
    out: CssExtraction,
    counter: { position: number },
    argumentIndex = 0
  ): void {
    compounds.forEach((compound, compoundIndex) => {
      compound.parts.forEach((part, index) => {
        const at = this.at(sheet, part.offset);
        const row = new CssSelectorPart({
          partKind: part.kind, name: part.name, value: part.value, attributeMatcher: part.matcher, attributeFlags: part.flags,
          combinatorBefore: index === 0 ? compound.combinator : CssCombinator.NONE, compoundIndex, position: counter.position++,
          depth, argumentIndex, startLine: at.line, startColumn: at.column, parentPartLinkHash: parentPart, selectorLinkHash: selector.getHash(),
          ruleLinkHash: rule.getHash(), serviceVersionLinkHash: sheet.version,
        });
        out.selectorParts.push(row);
        // `of S` was read from its own text: its nodes carry that text's offsets, so they are
        // read through a view whose origin is where S sits in the sheet.
        const argumentSheet: Sheet = part.argument === undefined ? sheet : {
          ...sheet, text: `${part.argument.text}{}`, lines: new LineIndex(`${part.argument.text}{}`),
          host: this.at(sheet, part.argument.offset), base: undefined, toBase: undefined,
        };
        part.args.forEach((argument, argumentIndex) => {
          this.emitParts(flatten(argument, argumentSheet), selector, rule, row.getHash(), depth + 1, argumentSheet, out, counter, argumentIndex);
        });
      });
    });
  }

  // ── declarations and the names their values refer to ──────────────────────

  /**
   * One declaration node, and the declarations the grammar folded into it after an
   * error: `color: ;` swallows `top: 1px` into its own node, so the text past the error is
   * read again as a declaration list. Returns how many declarations were emitted.
   */
  private declaration(
    node: SyntaxNode,
    ruleLinkHash: string,
    htmlAttributeLinkHash: string,
    sheet: Sheet,
    out: CssExtraction,
    gaps: GapCollector,
    positions: { n: number }
  ): number {
    const propertyNode = node.namedChildren.find((c) => c.type === 'property_name');
    const property = propertyNode === undefined ? '' : unescapeCss(sourceOf(sheet, propertyNode));
    const colon = node.children.find((c) => !c.isNamed && c.type === ':');
    let error = node.children.find((c) => c.type === 'ERROR');
    let important = node.namedChildren.find((c) => c.type === 'important') !== undefined;
    const valueStart = colon?.endIndex ?? node.startIndex;
    let valueEnd = important ? node.namedChildren.find((c) => c.type === 'important')!.startIndex : node.endIndex;
    // `! important` with a space is legal and the grammar rejects it: the `!` and the word
    // become ERROR children. The text says what was meant, and the errors are recovered.
    const spaced = /!\s+important\s*;?\s*$/i.exec(sheet.text.slice(valueStart, node.endIndex));
    if (spaced !== null && error !== undefined && error.startIndex >= valueStart + spaced.index) {
      important = true;
      valueEnd = valueStart + spaced.index;
      gaps.recover(sheet, valueStart + spaced.index, node.endIndex);
      error = undefined;
    }
    if (error !== undefined && error.startIndex < valueEnd) {
      valueEnd = error.startIndex;
    }
    if (sheet.text[valueEnd - 1] === ';') {
      valueEnd -= 1;
    }
    const valueText = collapse(sheet.text.slice(valueStart, Math.max(valueStart, valueEnd)));
    const end = error?.endIndex ?? node.endIndex;
    const declaration = this.declarationRow(property, valueText, important, node.startIndex, end, positions.n++, ruleLinkHash, htmlAttributeLinkHash, sheet);
    out.declarations.push(declaration);
    for (const v of this.valueReferences(sheet.text.slice(valueStart, Math.max(valueStart, valueEnd)), valueStart, property, declaration.getHash(), sheet, gaps)) {
      out.valueReferences.push(v);
    }
    // A custom property may legally be empty (`--bs-nav-link-font-weight: ;` in Bootstrap);
    // any other property with no value is a grammar-level error the grammar does not report.
    if (valueText === '' && !property.startsWith('--')) {
      gaps.add(sheet, CssParseGapKind.PARSE_ERROR, `empty value for ${property}`, node.startIndex, node.endIndex, ruleLinkHash);
    }
    let emitted = 1;
    if (error !== undefined && error.endIndex < node.endIndex) {
      const rest = sheet.text.slice(error.endIndex, node.endIndex);
      emitted += this.declarationsFromText(rest, error.endIndex, ruleLinkHash, htmlAttributeLinkHash, sheet, out, gaps, positions.n, positions);
    }
    return emitted;
  }

  /**
   * Reads `text`, which sits at `offset` of the sheet, as a declaration list through a
   * throwaway `*{ … }` rule. Used for `style` attributes and for the text a broken
   * declaration swallowed. Returns how many declarations were emitted.
   */
  private declarationsFromText(
    text: string,
    offset: number,
    ruleLinkHash: string,
    htmlAttributeLinkHash: string,
    sheet: Sheet,
    out: CssExtraction,
    gaps: GapCollector,
    firstPosition: number,
    positions: { n: number } = { n: firstPosition }
  ): number {
    if (text.trim() === '') {
      return 0;
    }
    const wrapped = `*{${text}}`;
    const root = parseWithTreeSitter(this.parser, sanitiseForGrammar(wrapped)).rootNode;
    const block = root.namedChildren.find((c) => c.type === 'rule_set')?.namedChildren.find((c) => c.type === 'block');
    if (block === undefined) {
      gaps.add(sheet, CssParseGapKind.UNPARSED_FRAGMENT, snippet(text), offset, offset + text.length, ruleLinkHash);
      return 0;
    }
    // The wrapper's nodes carry the wrapper's offsets; the view maps them back to the sheet.
    const view = wrapperView(sheet, wrapped, offset);
    const children = liftedChildren(block);
    if (!children.some((c) => c.type === 'declaration') && !errorNodes(block).next().done) {
      // The grammar rejected the list whole (`color red; a: b`). Each `;`-separated segment
      // is read on its own, so the malformed one is the only loss, and it is the one reported.
      const segments = splitTopLevel(text, ';');
      if (segments.length > 1) {
        let emitted = 0;
        for (const segment of segments) {
          gaps.recover(sheet, offset + segment.offset, offset + segment.offset + segment.text.length);
          const got = this.declarationsFromText(segment.text, offset + segment.offset, ruleLinkHash, htmlAttributeLinkHash, sheet, out, gaps, positions.n, positions);
          if (got === 0) {
            gaps.add(sheet, CssParseGapKind.UNPARSED_FRAGMENT, `declaration not read: ${snippet(segment.text)}`, offset + segment.offset, offset + segment.offset + segment.text.length, ruleLinkHash);
          }
          emitted += got;
        }
        return emitted;
      }
    }
    let emitted = 0;
    for (const child of children) {
      if (child.type === 'declaration') {
        emitted += this.declaration(child, ruleLinkHash, htmlAttributeLinkHash, view, out, gaps, positions);
      } else if (child.type === 'comment') {
        this.comment(child, view, out);
      } else if (child.type === 'rule_set' || AT_RULE_TYPES.has(child.type)) {
        gaps.add(view, CssParseGapKind.UNPARSED_FRAGMENT, snippet(child.text), child.startIndex, child.endIndex, ruleLinkHash);
      }
    }
    for (const node of errorNodes(block)) {
      gaps.add(view, CssParseGapKind.PARSE_ERROR, node.isMissing ? `missing ${node.type}` : `syntax error: ${snippet(node.text)}`, node.startIndex, node.endIndex, ruleLinkHash);
    }
    return emitted;
  }

  private declarationRow(
    property: string,
    valueText: string,
    important: boolean,
    startOffset: number,
    endOffset: number,
    position: number,
    ruleLinkHash: string,
    htmlAttributeLinkHash: string,
    sheet: Sheet
  ): CssDeclaration {
    const start = this.at(sheet, startOffset);
    const end = this.at(sheet, endOffset);
    const custom = property.startsWith('--');
    return new CssDeclaration({
      property, valueText, isImportant: important, isCustomProperty: custom,
      vendorPrefix: custom ? '' : (/^-[a-z]+-/i.exec(property)?.[0] ?? ''), position,
      startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column,
      ruleLinkHash, htmlAttributeLinkHash, stylesheetLinkHash: sheet.stylesheetLinkHash, serviceVersionLinkHash: sheet.version,
    });
  }

  /**
   * The names a value refers to, scanned from the value's TEXT: `var()` and `url()` anywhere,
   * plus what the property's grammar says about bare identifiers. Text rather than nodes,
   * because the grammar breaks on an unquoted path and a reference inside an `ERROR` is a
   * reference still.
   */
  private valueReferences(
    rawValue: string,
    valueStart: number,
    property: string,
    declarationHash: string,
    sheet: Sheet,
    gaps: GapCollector
  ): CssValueReference[] {
    const refs: CssValueReference[] = [];
    const emit = (kind: CssValueReferenceKind, name: string, fallback: string, offset: number, url?: string): void => {
      const at = this.at(sheet, valueStart + offset);
      let urlKind: WebUrlKind | '' = '';
      let resolved = '';
      if (url !== undefined) {
        const written = classifyUrl(url);
        urlKind = written.kind;
        resolved = resolveUrlToFile(applyBase(written, sheet.baseHref), sheet.filePath, sheet.projectRoot);
      }
      refs.push(new CssValueReference({
        referenceKind: kind, name, fallbackText: fallback, urlKind, resolvedFilePath: resolved, isResolved: resolved !== '',
        position: refs.length, startLine: at.line, startColumn: at.column, ownerDeclarationLinkHash: declarationHash,
        ownerRuleLinkHash: '', stylesheetLinkHash: sheet.stylesheetLinkHash, serviceVersionLinkHash: sheet.version,
      }));
    };
    // A string literal's inside is not CSS: `content: "var(--x) url(y.png)"` refers to nothing.
    // The scan runs over the value with every string blanked to spaces, same length.
    const scannable = blankStrings(rawValue);
    const functions = /\b(var|url)\(/gi;
    for (let m = functions.exec(scannable); m !== null; m = functions.exec(scannable)) {
      const open = m.index + m[0].length - 1;
      const close = matchingParen(rawValue, open);
      const inner = rawValue.slice(open + 1, close);
      if (m[1]!.toLowerCase() === 'var') {
        const name = /^\s*(--[\w-]+)/.exec(inner)?.[1];
        if (name !== undefined) {
          const comma = topLevelComma(inner);
          emit(CssValueReferenceKind.VARIABLE, name, comma < 0 ? '' : collapse(inner.slice(comma + 1)), m.index);
        }
      } else {
        // `url(a\)b.png)`: an escape in an unquoted URL (or a string) is decoded as in an identifier.
        const url = unescapeCss(inner.trim().replace(/^(["'])([\s\S]*)\1$/, '$2'));
        emit(CssValueReferenceKind.URL, url, '', m.index, url);
        // The grammar rejects an unquoted path's `../` and `/`; the text read it whole.
        gaps.recover(sheet, valueStart + m.index, valueStart + close + 1);
      }
    }
    const lower = property.toLowerCase();
    if (lower === 'animation-name' || lower === 'animation') {
      for (const segment of commaSegments(rawValue)) {
        const token = tokens(segment.text).find((t) => (IDENTIFIER.test(t.text) && !ANIMATION_KEYWORDS.has(t.text.toLowerCase())) || /^["']/.test(t.text));
        if (token !== undefined) {
          emit(CssValueReferenceKind.KEYFRAMES, unquote(token.text), '', segment.offset + token.offset);
        }
      }
    } else if (lower === 'font-family') {
      for (const segment of commaSegments(rawValue)) {
        const family = familyName(segment.text);
        if (family !== undefined && !GENERIC_FONT_FAMILIES.has(family.toLowerCase())) {
          emit(CssValueReferenceKind.FONT_FAMILY, family, '', segment.offset + (segment.text.length - segment.text.trimStart().length));
        }
      }
    } else if (lower === 'font') {
      // The shorthand: `[style weight variant stretch] size[/line-height] family, family`. The
      // families are everything after the size token; a system keyword (`font: menu`) has none.
      const first = commaSegments(rawValue)[0];
      const sizeToken = first === undefined ? undefined : tokens(first.text).find((t) => /^(\d|\.\d|[a-z-]+\/|[a-z]*\d)/.test(t.text) && /\d|\//.test(t.text) || /^(xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller)$/.test(t.text));
      if (first !== undefined && sizeToken !== undefined) {
        const familyStart = sizeToken.offset + sizeToken.text.length;
        const families = rawValue.slice(familyStart);
        for (const segment of commaSegments(families)) {
          const family = familyName(segment.text);
          if (family !== undefined && !GENERIC_FONT_FAMILIES.has(family.toLowerCase())) {
            emit(CssValueReferenceKind.FONT_FAMILY, family, '', familyStart + segment.offset + (segment.text.length - segment.text.trimStart().length));
          }
        }
      }
    } else if (lower === 'container-name' || lower === 'container') {
      for (const token of tokens(rawValue)) {
        if (token.text === '/') {
          break;
        }
        if (IDENTIFIER.test(token.text) && token.text.toLowerCase() !== 'none') {
          emit(CssValueReferenceKind.CONTAINER, token.text, '', token.offset);
        }
      }
    }
    return refs;
  }

  /** The references an at-rule's PRELUDE makes: `@import`'s target and layer, `@layer`'s names, `@container`'s name. */
  private preludeReferences(name: string, preludeText: string, preludeStart: number, ruleHash: string, sheet: Sheet, out: CssExtraction, gaps: GapCollector): void {
    const at = this.at(sheet, preludeStart);
    let position = 0;
    const emit = (kind: CssValueReferenceKind, value: string, url?: string): void => {
      let urlKind: WebUrlKind | '' = '';
      let resolved = '';
      if (url !== undefined) {
        const written = classifyUrl(url);
        urlKind = written.kind;
        resolved = resolveUrlToFile(applyBase(written, sheet.baseHref), sheet.filePath, sheet.projectRoot);
      }
      out.valueReferences.push(new CssValueReference({
        referenceKind: kind, name: value, fallbackText: '', urlKind, resolvedFilePath: resolved, isResolved: resolved !== '',
        position: position++, startLine: at.line, startColumn: at.column, ownerDeclarationLinkHash: '', ownerRuleLinkHash: ruleHash,
        stylesheetLinkHash: sheet.stylesheetLinkHash, serviceVersionLinkHash: sheet.version,
      }));
    };
    if (name === 'import') {
      const m = /^\s*(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')/i.exec(preludeText);
      const target = m?.[1] ?? m?.[2] ?? m?.[3] ?? m?.[4] ?? m?.[5];
      if (target !== undefined) {
        emit(CssValueReferenceKind.IMPORT, target, target);
      }
      const layer = /\blayer\(\s*([^)]*?)\s*\)/.exec(preludeText);
      if (layer !== null && layer[1] !== '') {
        emit(CssValueReferenceKind.LAYER, layer[1]!);
        gaps.recover(sheet, preludeStart, preludeStart + preludeText.length + 1);
      }
      return;
    }
    if (name === 'layer') {
      for (const part of preludeText.split(',')) {
        const trimmed = part.trim();
        if (trimmed !== '') {
          emit(CssValueReferenceKind.LAYER, trimmed);
        }
      }
      return;
    }
    if (name === 'container') {
      const m = /^\s*([A-Za-z_-][\w-]*)\s*(?:\(|$)/.exec(preludeText);
      if (m !== null && !CONTAINER_QUERY_KEYWORDS.has(m[1]!.toLowerCase())) {
        emit(CssValueReferenceKind.CONTAINER, m[1]!);
        // The grammar has no place for the container's name; the text read it.
        gaps.recover(sheet, preludeStart, preludeStart + preludeText.length + 1);
      }
    }
  }

  // ── comments and errors ───────────────────────────────────────────────────

  private comment(node: SyntaxNode, sheet: Sheet, out: CssExtraction): void {
    const start = this.at(sheet, node.startIndex);
    const end = this.at(sheet, node.endIndex);
    // from the SOURCE, not the node: the grammar read a sanitised copy (braces in a comment blanked, #1909)
    const text = sourceOf(sheet, node).replace(/^\/\*/, '').replace(/\*\/$/, '');
    out.comments.push(new CssComment({
      text: text.length > WEB_COMMENT_TEXT_LIMIT ? text.slice(0, WEB_COMMENT_TEXT_LIMIT) : text,
      startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column,
      stylesheetLinkHash: sheet.stylesheetLinkHash, serviceVersionLinkHash: sheet.version,
    }));
  }

  /** Every `ERROR` region and every token the grammar had to invent, once each. */
  private recordSyntaxErrors(root: SyntaxNode, sheet: Sheet, gaps: GapCollector): void {
    for (const node of errorNodes(root)) {
      // A semicolon alone (`;;`, a `;` after a nested block) is an empty declaration CSS ignores.
      if (!node.isMissing && sourceOf(sheet, node).trim() === ';') {
        continue;
      }
      gaps.add(
        sheet,
        CssParseGapKind.PARSE_ERROR,
        node.isMissing ? `missing ${node.type}` : `syntax error: ${snippet(node.text)}`,
        node.startIndex,
        node.endIndex,
        ''
      );
    }
  }

  // ── positions ─────────────────────────────────────────────────────────────

  private at(sheet: Sheet, offset: number): Pos {
    return locate(sheet, offset);
  }
}

// ── selectors as the grammar writes them ────────────────────────────────────

/** A node's text from the ORIGINAL source (the grammar read a sanitised copy of the same length). */
function sourceOf(sheet: Sheet, node: SyntaxNode): string {
  return sheet.text.slice(node.startIndex, node.endIndex);
}

/** One complex selector of a selector list: the nodes between two commas, and its text span. */
interface SelectorGroup {
  readonly nodes: SyntaxNode[];
  start: number;
  end: number;
}

/**
 * A `selectors` list split at its commas. A group is usually one node; where the grammar
 * rejected part of a selector (`.title &`, `col || td`) it is a node and an `ERROR`, and the
 * group keeps both so the selector's text and its readable parts stay together.
 */
function selectorGroups(selectors: SyntaxNode): SelectorGroup[] {
  const groups: SelectorGroup[] = [];
  let current: SyntaxNode[] = [];
  const close = (): void => {
    if (current.length > 0) {
      groups.push({ nodes: current, start: current[0]!.startIndex, end: current[current.length - 1]!.endIndex });
    }
    current = [];
  };
  for (const child of selectors.children) {
    if (!child.isNamed && child.type === ',') {
      close();
    } else if (child.type === 'ERROR' && /^[\s,]*$/.test(child.text)) {
      // A stray comma (`.card,, .nav`) is a node between two selectors to the grammar. It
      // stays a gap (a browser drops the whole rule) and belongs to neither selector's text.
      close();
    } else if (child.type !== 'comment') {
      current.push(child);
    }
  }
  close();
  return groups;
}

/** A group's compounds: each node flattened, a node after a rejected region joining as a descendant. */
function flattenGroup(group: SelectorGroup, sheet: Sheet): Compound[] {
  const compounds: Compound[] = [];
  for (const node of group.nodes) {
    const more = node.type === 'ERROR' ? node.namedChildren.flatMap((c) => flatten(c, sheet)) : flatten(node, sheet);
    if (node.type === 'ERROR') {
      for (const compound of more) {
        for (const part of compound.parts) {
          part.recovered = [node.startIndex, node.endIndex];
        }
      }
    }
    if (compounds.length > 0 && more.length > 0 && more[0]!.combinator === CssCombinator.NONE) {
      more[0]!.combinator = CssCombinator.DESCENDANT;
    }
    compounds.push(...more);
  }
  // A RELATIVE selector (`> .f`, `+ .g` in a nested rule) begins with a combinator the grammar
  // rejects; the text says which, and the first compound carries it.
  const leading = /^\s*(>|\+|~)/.exec(sheet.text.slice(group.start, group.end));
  if (leading !== null && compounds.length > 0 && compounds[0]!.combinator === CssCombinator.NONE) {
    compounds[0]!.combinator = leading[1] === '>' ? CssCombinator.CHILD : leading[1] === '+' ? CssCombinator.NEXT_SIBLING : CssCombinator.SUBSEQUENT_SIBLING;
    for (const part of compounds[0]!.parts) {
      part.recovered = [group.start, group.start + leading[0].length];
    }
  }
  // `& &`: the grammar rejects the first `&` and keeps the second. The text between the
  // group's start and its first readable node says a nesting part stands there, and the
  // combinator written after it (none: a descendant) is the next compound's.
  const firstNode = group.nodes.find((n) => n.type !== 'ERROR');
  const prefix = firstNode === undefined ? null : /^\s*&\s*([>+~]?)\s*$/.exec(sheet.text.slice(group.start, firstNode.startIndex));
  if (prefix !== null && firstNode !== undefined && compounds.length > 0) {
    compounds[0]!.combinator = prefix[1] === '>' ? CssCombinator.CHILD : prefix[1] === '+' ? CssCombinator.NEXT_SIBLING
      : prefix[1] === '~' ? CssCombinator.SUBSEQUENT_SIBLING : CssCombinator.DESCENDANT;
    compounds.unshift({ combinator: CssCombinator.NONE, parts: [{
      kind: CssSelectorPartKind.NESTING, name: '&', value: '', matcher: '', flags: '', args: [],
      offset: group.start + prefix[0].indexOf('&'), recovered: [group.start, firstNode.startIndex],
    }] });
  }
  return compounds;
}

/**
 * A complex selector as compounds: the grammar nests combinators as binary nodes and
 * chains a compound's parts as nested nodes (`li.item:hover` is `pseudo(class(tag li,
 * item), hover)`), so both are unwound here, left to right.
 */
function flatten(node: SyntaxNode, sheet: Sheet): Compound[] {
  const combinator = COMBINATOR_TYPES[node.type];
  if (combinator !== undefined) {
    const named = node.namedChildren.filter((c) => c.type !== 'comment');
    const left = named[0];
    const right = named[named.length - 1];
    if (left === undefined || right === undefined || left === right) {
      return left === undefined ? [] : flatten(left, sheet);
    }
    const rightCompounds = flatten(right, sheet);
    if (rightCompounds.length > 0) {
      rightCompounds[0]!.combinator = combinator;
    }
    return [...flatten(left, sheet), ...rightCompounds];
  }
  if (node.type === 'ERROR') {
    return [];
  }
  if (node.type === 'namespace_selector') {
    // `svg|rect.svg-rect`: the grammar hangs the whole compound off the `|`. The local side
    // is flattened as a compound of its own, and its type (or universal) part takes the
    // prefix as its value: name `rect`, value `svg|`, so `html_element.tagName` joins the name.
    const bar = node.children.findIndex((c) => !c.isNamed && c.type === '|');
    const prefixNode = node.children.slice(0, bar).find((c) => c.isNamed && c.type !== 'comment');
    const after = node.children.slice(bar + 1);
    const local = after.find((c) => c.isNamed && c.type !== 'comment' && c.type !== 'ERROR');
    if (local === undefined) {
      return [];
    }
    // `col || td` is the column combinator, which the grammar reads as a namespace separator
    // followed by a stray `|`: two compounds, the second joined by COLUMN.
    const secondBar = after.find((c) => c.type === 'ERROR' && c.endIndex <= local.startIndex && sourceOf(sheet, c).trim() === '|');
    if (secondBar !== undefined && prefixNode !== undefined) {
      const left = flatten(prefixNode, sheet);
      const right = flatten(local, sheet);
      if (right.length > 0) {
        right[0]!.combinator = CssCombinator.COLUMN;
        for (const part of right[0]!.parts) {
          part.recovered = [node.children[bar]!.startIndex, secondBar.endIndex];
        }
      }
      return [...left, ...right];
    }
    const compounds = flatten(local, sheet);
    const first = compounds[0]?.parts[0];
    if (first !== undefined && (first.kind === CssSelectorPartKind.TYPE || first.kind === CssSelectorPartKind.UNIVERSAL)) {
      first.value = `${prefixNode === undefined ? '' : unescapeCss(sourceOf(sheet, prefixNode))}|`;
      first.offset = node.startIndex;
    }
    return compounds;
  }
  const own = ownPart(node, sheet);
  if (own === undefined) {
    return [];
  }
  const compounds = own.base === undefined ? [{ combinator: CssCombinator.NONE, parts: [] }] : flatten(own.base, sheet);
  if (compounds.length === 0) {
    compounds.push({ combinator: CssCombinator.NONE, parts: [] });
  }
  if (own.part !== undefined) {
    compounds[compounds.length - 1]!.parts.push(own.part);
  }
  return compounds;
}

/** A compound node's own part and the node it is chained onto (its base), if any. */
function ownPart(node: SyntaxNode, sheet: Sheet): { base: SyntaxNode | undefined; part: Part | undefined } | undefined {
  const part = (kind: CssSelectorPartKind, name: string, value = '', matcher = '', flags = '', offset = node.startIndex, args: SyntaxNode[] = []): Part =>
    ({ kind, name, value, matcher, flags, offset, args });
  const operatorIndex = (symbols: readonly string[]): number => node.children.findIndex((c) => !c.isNamed && symbols.includes(c.type));
  const baseBefore = (index: number): SyntaxNode | undefined => node.children.slice(0, index).find((c) => c.isNamed && c.type !== 'comment');
  const nameOf = (n: SyntaxNode): string => unescapeCss(sourceOf(sheet, n));
  switch (node.type) {
    case 'tag_name':
      return { base: undefined, part: part(CssSelectorPartKind.TYPE, nameOf(node).toLowerCase()) };
    case 'universal_selector':
      return { base: undefined, part: part(CssSelectorPartKind.UNIVERSAL, '*') };
    case 'nesting_selector':
      return { base: undefined, part: part(CssSelectorPartKind.NESTING, '&') };
    case 'class_selector': {
      const op = operatorIndex(['.']);
      const name = node.children.slice(op + 1).find((c) => c.type === 'class_name');
      return { base: baseBefore(op), part: name === undefined ? undefined : part(CssSelectorPartKind.CLASS, nameOf(name), '', '', '', name.startIndex - 1) };
    }
    case 'id_selector': {
      const op = operatorIndex(['#']);
      const name = node.children.slice(op + 1).find((c) => c.type === 'id_name');
      return { base: baseBefore(op), part: name === undefined ? undefined : part(CssSelectorPartKind.ID, nameOf(name), '', '', '', name.startIndex - 1) };
    }
    case 'attribute_selector': {
      const op = operatorIndex(['[']);
      const after = node.children.slice(op + 1);
      const name = after.find((c) => c.type === 'attribute_name');
      const matcher = after.find((c) => !c.isNamed && /^[~|^$*]?=$/.test(c.type));
      const valueNode = matcher === undefined ? undefined : after.find((c) => c.isNamed && c.startIndex >= matcher.endIndex && c.type !== 'ERROR');
      // The `i` / `s` flag is an ERROR to the grammar; it is read back from the text before `]`.
      const flags = /\s([is])\s*\]$/i.exec(sourceOf(sheet, node))?.[1] ?? '';
      const row = name === undefined ? undefined : part(CssSelectorPartKind.ATTRIBUTE, nameOf(name), valueNode === undefined ? '' : unescapeCss(unquote(sourceOf(sheet, valueNode))), matcher?.type ?? '', flags, node.children[op]!.startIndex);
      if (row !== undefined && flags !== '') {
        row.recovered = [node.startIndex, node.endIndex];
      }
      return { base: baseBefore(op), part: row };
    }
    case 'pseudo_class_selector': {
      const op = operatorIndex([':']);
      const after = node.children.slice(op + 1);
      const name = after.find((c) => c.type === 'class_name');
      const args = after.find((c) => c.type === 'arguments');
      if (name === undefined) {
        return { base: baseBefore(op), part: undefined };
      }
      const lower = nameOf(name).toLowerCase();
      const kind = LEGACY_PSEUDO_ELEMENTS.has(lower) ? CssSelectorPartKind.PSEUDO_ELEMENT : CssSelectorPartKind.PSEUDO_CLASS;
      const value = args === undefined ? '' : collapse(sourceOf(sheet, args).slice(1, -1));
      // `:nth-child(2n of S)`: the grammar does not know `of`, so S is read from its own text,
      // and the part remembers where S sits so its parts are cited at their real positions.
      const ofMatch = args !== undefined && lower.startsWith('nth-') ? /\bof\s+(?=\S)/.exec(sourceOf(sheet, args)) : null;
      const ofSelector = ofMatch === null || args === undefined ? undefined : {
        text: sourceOf(sheet, args).slice(ofMatch.index + ofMatch[0].length, -1),
        offset: args.startIndex + ofMatch.index + ofMatch[0].length,
      };
      // Only the pseudo-classes that TAKE selectors have selector arguments: `:nth-child(odd)`,
      // `:lang(en)` and `:dir(rtl)` take keywords, which the grammar reads as type selectors.
      const argumentNodes = ofSelector !== undefined ? selectorNodesFromText(ofSelector.text)
        : args === undefined || !SELECTOR_ARGUMENT_PSEUDOS.has(lower) ? [] : selectorArguments(args);
      const row = part(kind, lower, value, '', '', name.startIndex - 1, argumentNodes);
      if (ofSelector !== undefined && args !== undefined) {
        row.recovered = [args.startIndex, args.endIndex];
        row.argument = ofSelector;
      }
      return { base: baseBefore(op), part: row };
    }
    case 'pseudo_element_selector': {
      const op = operatorIndex(['::']);
      const after = node.children.slice(op + 1);
      const name = after.find((c) => c.type === 'tag_name');
      const args = after.find((c) => c.type === 'arguments');
      const lower = name === undefined ? '' : nameOf(name).toLowerCase();
      return {
        base: baseBefore(op),
        part: name === undefined ? undefined : part(CssSelectorPartKind.PSEUDO_ELEMENT, lower, args === undefined ? '' : collapse(sourceOf(sheet, args).slice(1, -1)), '', '', name.startIndex - 2,
          args !== undefined && lower === 'slotted' ? selectorArguments(args) : []),
      };
    }
    default:
      return { base: undefined, part: part(CssSelectorPartKind.RAW, '', collapse(sourceOf(sheet, node))) };
  }
}

/** The selector roots inside a functional pseudo-class's parentheses: `:not(.a, .b)` has two. */
function selectorArguments(args: SyntaxNode): SyntaxNode[] {
  return args.namedChildren.filter((c) => c.type !== 'comment' && c.type !== 'ERROR' && (c.type in COMBINATOR_TYPES || c.type.endsWith('_selector') || c.type === 'tag_name'));
}

/** Specificity per Selectors Level 4 over the flattened compounds, plus the two flags the selector row carries. */
function specificity(compounds: readonly Compound[], sheet: Sheet): { a: number; b: number; c: number; nesting: boolean; pseudoElement: boolean } {
  let a = 0;
  let b = 0;
  let c = 0;
  let nesting = false;
  let pseudoElement = false;
  for (const compound of compounds) {
    for (const part of compound.parts) {
      switch (part.kind) {
        case CssSelectorPartKind.ID: a += 1; break;
        case CssSelectorPartKind.CLASS:
        case CssSelectorPartKind.ATTRIBUTE: b += 1; break;
        case CssSelectorPartKind.TYPE: c += 1; break;
        case CssSelectorPartKind.PSEUDO_ELEMENT: c += 1; pseudoElement = true; break;
        case CssSelectorPartKind.NESTING: nesting = true; break;
        case CssSelectorPartKind.PSEUDO_CLASS: {
          if (part.name === 'where') break;
          const inner = argumentSpecificity(part.args, sheet);
          if (inner.nesting) nesting = true;
          if (SPECIFICITY_OF_ARGUMENT.has(part.name)) {
            if (part.name === 'host' || part.name === 'host-context') b += 1;
            a += inner.a; b += inner.b; c += inner.c;
          } else if (part.name === 'nth-child' || part.name === 'nth-last-child') {
            b += 1 + inner.b; a += inner.a; c += inner.c;
          } else {
            b += 1;
          }
          break;
        }
        default: break;
      }
    }
  }
  return { a, b, c, nesting, pseudoElement };
}

/** The most specific selector among a functional pseudo-class's arguments. */
function argumentSpecificity(args: readonly SyntaxNode[], sheet: Sheet): { a: number; b: number; c: number; nesting: boolean } {
  let best = { a: 0, b: 0, c: 0, nesting: false };
  for (const argument of args) {
    const s = specificity(flatten(argument, sheet), sheet);
    if (s.a > best.a || (s.a === best.a && (s.b > best.b || (s.b === best.b && s.c > best.c)))) {
      best = { a: s.a, b: s.b, c: s.c, nesting: s.nesting || best.nesting };
    } else if (s.nesting) {
      best = { ...best, nesting: true };
    }
  }
  return best;
}

// ── values as text ──────────────────────────────────────────────────────────

/** The text with every string literal's inside replaced by spaces, same length. */
function blankStrings(text: string): string {
  return text.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => m[0]! + ' '.repeat(Math.max(0, m.length - 2)) + m[m.length - 1]!);
}

/** The index of the `)` matching the `(` at `open`, or the text's end. */
function matchingParen(text: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote !== '') {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === '\'') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

/** The index of the first comma outside parentheses and quotes, or -1. */
function topLevelComma(text: string): number {
  return topLevelIndex(text, ',');
}

/** The index of the first `separator` outside strings and parentheses, or -1. */
function topLevelIndex(text: string, separator: string): number {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote !== '') {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === '\'') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === separator && depth === 0) return i;
  }
  return -1;
}

/** A value split at its top-level commas, each segment with its offset in the value. */
function commaSegments(text: string): Array<{ text: string; offset: number }> {
  return splitTopLevel(text, ',');
}

/** `text` split at every top-level `separator`, blank segments dropped, each with its offset in `text`. */
function splitTopLevel(text: string, separator: string): Array<{ text: string; offset: number }> {
  const segments: Array<{ text: string; offset: number }> = [];
  let start = 0;
  let rest = text;
  for (;;) {
    const at = topLevelIndex(rest, separator);
    if (at < 0) {
      segments.push({ text: rest, offset: start });
      break;
    }
    segments.push({ text: rest.slice(0, at), offset: start });
    start += at + 1;
    rest = rest.slice(at + 1);
  }
  return segments.filter((s) => s.text.trim() !== '');
}

/** The whitespace-separated tokens of a value, quoted strings kept whole, each with its offset. */
function tokens(text: string): Array<{ text: string; offset: number }> {
  const out: Array<{ text: string; offset: number }> = [];
  const pattern = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,]+/g;
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    out.push({ text: m[0], offset: m.index });
  }
  return out;
}

/** `"Segoe UI"` or `Segoe UI` (two identifiers) as one family name. */
function familyName(segment: string): string | undefined {
  const parts = tokens(segment);
  const first = parts[0];
  if (first === undefined) {
    return undefined;
  }
  if (/^["']/.test(first.text)) {
    return unquote(first.text);
  }
  const idents = parts.filter((t) => IDENTIFIER.test(t.text));
  return idents.length === 0 ? undefined : idents.map((t) => t.text).join(' ');
}

function unquote(text: string): string {
  return text.replace(/^(["'])([\s\S]*)\1$/, '$2');
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function snippet(text: string): string {
  const t = collapse(text);
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

/** The name an at-rule declares, read from its prelude text. */
function atRuleDeclaredName(name: string, preludeText: string): string {
  const bare = name.replace(/^-[a-z]+-/, '');
  if (bare === 'keyframes' || bare === 'property' || bare === 'counter-style' || bare === 'font-feature-values'
    || bare === 'font-palette-values' || bare === 'position-try' || bare === 'view-transition' || bare === 'scope') {
    return preludeText.trim();
  }
  if (bare === 'container') {
    const m = /^([A-Za-z_-][\w-]*)\s*(?:\(|$)/.exec(preludeText.trim());
    return m !== null && !CONTAINER_QUERY_KEYWORDS.has(m[1]!.toLowerCase()) ? m[1]! : '';
  }
  if (bare === 'layer') {
    return preludeText.includes(',') ? '' : preludeText.trim();
  }
  return '';
}

// ── the tree ────────────────────────────────────────────────────────────────

/** What may stand rejected before a nested rule's selector list: a relative combinator, or the first `&` of `& &`. */
const LEADING_SELECTOR_FRAGMENT = /^\s*(?:[>+~]|&\s*[>+~]?)\s*$/;

/** An ERROR inside a block that is a run of declarations the grammar rejected whole: `color red; a: b`. A brace inside a string is a string's. */
function isDeclarationRun(text: string): boolean {
  const outside = blankStrings(text);
  return /[:;]/.test(outside) && !/[{}]/.test(outside);
}

/** An ERROR that is a rule header the grammar rejected: selector text, a `{`, and no `}` before it. */
function isRejectedHeader(text: string): boolean {
  const brace = text.indexOf('{');
  if (brace <= 0) {
    return false;
  }
  const header = text.slice(0, brace).trim();
  return header !== '' && !/[;}]/.test(header) && !text.slice(brace).includes('}');
}

/** Whether a rule's block ended on an error rather than its own `}`: the text after the error is the block's. */
function lastBlockUnclosed(rule: SyntaxNode, sheet: Sheet): boolean {
  const block = rule.namedChildren.find((c) => c.type === 'block');
  if (block === undefined) {
    return false;
  }
  const closing = block.children[block.children.length - 1];
  return closing === undefined || closing.type !== '}' || sourceOf(sheet, closing) !== '}';
}

/**
 * `liftedChildren`, except that an `ERROR` which is a rejected rule header (its text ends in
 * `{`) is kept as a node of its own, so the walk can read the rule from the text.
 */
function liftedChildrenKeepingHeaders(node: SyntaxNode, sheet: Sheet): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const visit = (n: SyntaxNode): void => {
    for (const child of n.namedChildren) {
      if (child.type === 'ERROR') {
        const text = sourceOf(sheet, child);
        // A run of declarations the grammar rejected whole is kept too, with whatever
        // declarations it managed to read inside it: the walk re-reads the run from its text.
        if (((isRejectedHeader(text) || LEADING_SELECTOR_FRAGMENT.test(text)) && child.namedChildren.every((c) => c.type !== 'rule_set' && c.type !== 'declaration'))
          || (node.type === 'block' && isDeclarationRun(text) && child.namedChildren.every((c) => c.type !== 'rule_set'))
          // `0%,20%,53%,` before `to{…}` in a keyframe block list: the next block's selector list, read from the text
          || (node.type === 'keyframe_block_list' && /^[\s\d.%,]*(?:from|to)?[\s\d.%,]*$/.test(text))) {
          out.push(child);
        } else {
          visit(child);
        }
      } else {
        out.push(child);
      }
    }
  };
  visit(node);
  return out;
}

/** A block's named children with an `ERROR` node's own named children lifted into the list. */
function liftedChildren(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const visit = (n: SyntaxNode): void => {
    for (const child of n.namedChildren) {
      if (child.type === 'ERROR') {
        visit(child);
      } else {
        out.push(child);
      }
    }
  };
  visit(node);
  return out;
}

/** Every `ERROR` node and every MISSING token under `root`, an `ERROR`'s inside not reported again. */
function* errorNodes(root: SyntaxNode): Generator<SyntaxNode> {
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'ERROR' || node.isMissing) {
      yield node;
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

/** Collects a stylesheet's gaps, deduplicated and capped. */
class GapCollector {
  private readonly seen = new Set<string>();
  private readonly recovered: Array<[number, number]> = [];
  private overflow = 0;

  constructor(private readonly out: CssParseGap[]) {}

  /**
   * Marks `[start, end)` of the sheet as read by a text-level recovery, so the grammar's
   * error inside it is not a gap: an unquoted `url(../x)`, an attribute selector's flag, a
   * `layer()` in `@import`, a `&` after a compound. Offsets are the base sheet's.
   */
  recover(sheet: Sheet, start: number, end: number): void {
    this.recovered.push([baseOffset(sheet, start), baseOffset(sheet, end)]);
  }

  /** Records a gap at offsets of `sheet`, which may be a wrapper view; the position is the host file's. */
  add(sheet: Sheet, kind: CssParseGapKind, detail: string, startOffset: number, endOffset: number, relatedRule: string): void {
    if (kind === CssParseGapKind.PARSE_ERROR) {
      const from = baseOffset(sheet, startOffset);
      const to = baseOffset(sheet, endOffset);
      if (this.recovered.some(([a, b]) => from >= a && to <= b)) {
        return;
      }
    }
    const s = locate(sheet, startOffset);
    const e = locate(sheet, endOffset);
    const bounded = detail.length > WEB_COMMENT_TEXT_LIMIT ? detail.slice(0, WEB_COMMENT_TEXT_LIMIT) : detail;
    const key = `${kind}|${s.line}|${s.column}|${bounded}`;
    if (this.seen.has(key)) {
      return;
    }
    this.seen.add(key);
    if (this.out.length >= WEB_PARSE_GAP_LIMIT) {
      this.overflow += 1;
      return;
    }
    this.out.push(new CssParseGap({
      gapKind: kind, detail: bounded, startLine: s.line, startColumn: s.column, endLine: e.line, endColumn: e.column,
      relatedRuleLinkHash: relatedRule, stylesheetLinkHash: sheet.stylesheetLinkHash, serviceVersionLinkHash: sheet.version,
    }));
  }

  finish(sheet: Sheet): void {
    if (this.overflow > 0) {
      this.out.push(new CssParseGap({
        gapKind: CssParseGapKind.GAP_LIMIT_REACHED, detail: `${this.overflow} further gap(s) not recorded`,
        startLine: sheet.host.line, startColumn: sheet.host.column, endLine: sheet.host.line,
        endColumn: sheet.host.column, relatedRuleLinkHash: '', stylesheetLinkHash: sheet.stylesheetLinkHash,
        serviceVersionLinkHash: sheet.version,
      }));
    }
  }
}
