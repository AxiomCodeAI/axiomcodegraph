import { WEB_TEXT_LIMIT } from '@/constants/web-constants';
import { HtmlTemplateDialect } from '@/enums/html/HtmlTemplateDialect';
import { HtmlTemplateExpressionKind } from '@/enums/html/HtmlTemplateExpressionKind';

import { WebRow, boundedText, commaList, commaSet, num, text } from '../web/web-row';

/**
 * One expression a template dialect evaluates: a directive's value or a `{{ }}` interpolation.
 *
 * Owned by the attribute that carries it, or, for an interpolation, by the element whose
 * text holds it; exactly one of the two links is set, and `position` orders the expressions
 * of one owner. `directive` is the attribute name as written (`@click`, `v-bind:href`,
 * `*ngIf`), `argument` what it was applied to (`click`, `href`), `modifiers` the dotted
 * suffixes (`enter,prevent`). For a JavaScript-shaped dialect (Vue, Alpine, Angular) the
 * expression is read by the TypeScript syntax layer: `calleeNames` are the functions it
 * calls and `identifiers` the free names it reads, which is what resolves `select(item)`
 * to a method of the component and `item` to the `v-for` that declared it (`declares`).
 * For the others (Jinja, Thymeleaf, Handlebars) the text is kept and the name columns are
 * empty: their expression languages are not JavaScript, and a guess would be a wrong edge.
 */
export class HtmlTemplateExpression extends WebRow {
  static readonly COLUMNS = [
    'dialect', 'expressionKind', 'directive', 'argument', 'modifiers', 'expressionText', 'calleeNames',
    'identifiers', 'declares', 'position', 'startLine', 'startColumn', 'ownerElementLinkHash',
    'attributeLinkHash', 'documentLinkHash', 'serviceVersionLinkHash', 'htmlTemplateExpressionUniqueHash',
  ] as const;

  readonly relation = 'html_template_expression';
  readonly columns = HtmlTemplateExpression.COLUMNS;

  readonly dialect: HtmlTemplateDialect;
  readonly expressionKind: HtmlTemplateExpressionKind;
  readonly directive: string;
  readonly argument: string;
  readonly modifiers: readonly string[];
  readonly expressionText: string;
  readonly calleeNames: ReadonlySet<string>;
  readonly identifiers: ReadonlySet<string>;
  readonly declares: readonly string[];
  readonly position: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly ownerElementLinkHash: string;
  readonly attributeLinkHash: string;
  readonly documentLinkHash: string;
  readonly serviceVersionLinkHash: string;

  constructor(props: {
    dialect: HtmlTemplateDialect; expressionKind: HtmlTemplateExpressionKind; directive: string; argument: string;
    modifiers: readonly string[]; expressionText: string; calleeNames: ReadonlySet<string>; identifiers: ReadonlySet<string>;
    declares: readonly string[]; position: number; startLine: number; startColumn: number; ownerElementLinkHash: string;
    attributeLinkHash: string; documentLinkHash: string; serviceVersionLinkHash: string;
  }) {
    super();
    this.dialect = props.dialect;
    this.expressionKind = props.expressionKind;
    this.directive = props.directive;
    this.argument = props.argument;
    this.modifiers = props.modifiers;
    this.expressionText = props.expressionText;
    this.calleeNames = props.calleeNames;
    this.identifiers = props.identifiers;
    this.declares = props.declares;
    this.position = props.position;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.ownerElementLinkHash = props.ownerElementLinkHash;
    this.attributeLinkHash = props.attributeLinkHash;
    this.documentLinkHash = props.documentLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `HTML_TEMPLATE_EXPRESSION_md5(attributeLinkHash ‖ ownerElementLinkHash ‖ position)`. */
  generateHash(): void {
    this.hash = WebRow.key('HTML_TEMPLATE_EXPRESSION', this.attributeLinkHash, this.ownerElementLinkHash, this.position);
  }

  protected values(): string[] {
    return [
      this.dialect, this.expressionKind, text(this.directive), text(this.argument), text(commaList(this.modifiers)),
      boundedText(this.expressionText, WEB_TEXT_LIMIT), text(commaSet(this.calleeNames)), text(commaSet(this.identifiers)),
      text(commaList(this.declares)), num(this.position), num(this.startLine), num(this.startColumn),
      this.ownerElementLinkHash, this.attributeLinkHash, this.documentLinkHash, this.serviceVersionLinkHash, this.hash,
    ];
  }
}
