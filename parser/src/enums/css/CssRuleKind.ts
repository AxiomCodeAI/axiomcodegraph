/** The two shapes a rule can have. */
export enum CssRuleKind {
  /** `selector-list { declarations }` — a qualified (style) rule, possibly nested. */
  STYLE_RULE = 'STYLE_RULE',

  /** `@name prelude;` or `@name prelude { … }` — `atRuleName` carries the name. */
  AT_RULE = 'AT_RULE',
}
