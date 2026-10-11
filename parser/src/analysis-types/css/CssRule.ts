import { WEB_TEXT_LIMIT } from '@/constants/web-constants';
import { CssRuleKind } from '@/enums/css/CssRuleKind';

import { WebRow, boundedText, num, text } from '../web/web-row';

/**
 * A style rule or an at-rule, in the tree the stylesheet writes them in.
 *
 * `parentRuleLinkHash` is the enclosing `@media` / `@supports` / `@layer` block, or the
 * style rule a nested rule sits in; empty at the top level. `position` is the ordinal
 * among its siblings, and (parent, position) is the key, so two identical `.a {}` rules
 * in one block are two rows. `name` is the thing an at-rule declares where it declares
 * one — the `@keyframes` name, the `@layer` name, the `@container` name, the `@property`
 * name, a `@font-face`'s `font-family` — the column a reference joins on.
 */
export class CssRule extends WebRow {
  static readonly COLUMNS = [
    'ruleKind', 'atRuleName', 'name', 'preludeText', 'selectorCount', 'declarationCount',
    'childRuleCount', 'nestingDepth', 'position', 'startLine', 'startColumn', 'endLine', 'endColumn',
    'parentRuleLinkHash', 'stylesheetLinkHash', 'serviceVersionLinkHash', 'cssRuleUniqueHash',
  ] as const;

  readonly relation = 'css_rule';
  readonly columns = CssRule.COLUMNS;

  readonly ruleKind: CssRuleKind;
  readonly atRuleName: string;
  readonly preludeText: string;
  readonly nestingDepth: number;
  readonly position: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly parentRuleLinkHash: string;
  readonly stylesheetLinkHash: string;
  readonly serviceVersionLinkHash: string;

  private name: string;
  private selectorCount = 0;
  private declarationCount = 0;
  private childRuleCount = 0;

  constructor(props: {
    ruleKind: CssRuleKind; atRuleName: string; name: string; preludeText: string; nestingDepth: number;
    position: number; startLine: number; startColumn: number; endLine: number; endColumn: number;
    parentRuleLinkHash: string; stylesheetLinkHash: string; serviceVersionLinkHash: string;
  }) {
    super();
    this.ruleKind = props.ruleKind;
    this.atRuleName = props.atRuleName;
    this.name = props.name;
    this.preludeText = props.preludeText;
    this.nestingDepth = props.nestingDepth;
    this.position = props.position;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.endLine = props.endLine;
    this.endColumn = props.endColumn;
    this.parentRuleLinkHash = props.parentRuleLinkHash;
    this.stylesheetLinkHash = props.stylesheetLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `CSS_RULE_md5(stylesheetLinkHash ‖ parentRuleLinkHash ‖ position)`. */
  generateHash(): void {
    this.hash = WebRow.key('CSS_RULE', this.stylesheetLinkHash, this.parentRuleLinkHash, this.position);
  }

  setCounts(counts: { selectorCount: number; declarationCount: number; childRuleCount: number }): void {
    this.selectorCount = counts.selectorCount;
    this.declarationCount = counts.declarationCount;
    this.childRuleCount = counts.childRuleCount;
  }

  /** A `@font-face` learns its name from its `font-family` declaration, after its block is read. */
  setName(name: string): void {
    this.name = name;
  }

  getName(): string { return this.name; }
  getSelectorCount(): number { return this.selectorCount; }
  getDeclarationCount(): number { return this.declarationCount; }
  getChildRuleCount(): number { return this.childRuleCount; }

  protected values(): string[] {
    return [
      this.ruleKind, text(this.atRuleName), text(this.name), boundedText(this.preludeText, WEB_TEXT_LIMIT),
      num(this.selectorCount), num(this.declarationCount), num(this.childRuleCount), num(this.nestingDepth),
      num(this.position), num(this.startLine), num(this.startColumn), num(this.endLine), num(this.endColumn),
      this.parentRuleLinkHash, this.stylesheetLinkHash, this.serviceVersionLinkHash, this.hash,
    ];
  }
}
