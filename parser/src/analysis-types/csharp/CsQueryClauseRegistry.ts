import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CsQueryClauseKind } from '@/enums/csharp/query';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One LINQ query clause — schema §3.18, **14 columns**.
 *
 * ## Why this relation exists instead of synthesized calls
 *
 * `from x in xs where p select f` has **no call syntax in the source** and two
 * to five calls in the semantics. Synthesizing `xs.Where(p).Select(f)` was
 * proposed and withdrawn, because every part of that rewrite is a resolution:
 * which overload, on which receiver type, through which extension method, in
 * which `using` scope. A parser doing it would be guessing four times and
 * recording the guesses as facts.
 *
 * So the parser emits what it can see — the clauses, their range variables,
 * their source expressions and their bodies — and the engine rewrites. That is
 * the same division `cs_type_reference` makes by carrying a name and no resolved
 * link.
 *
 * **Silence was the third option and is the only one that is definitely wrong.**
 * It produces a fact base in which LINQ-heavy code appears to call nothing.
 *
 * ## The hops an engine needs, and they are all here
 *
 * To rewrite `from x in xs where p select f` it needs: the ORDER of the clauses
 * (`position`), the range variable each introduces (`identifierName`), what each
 * ranges over (`sourceExpressionLinkHash`), and the expression each evaluates
 * (`bodyExpressionLinkHash`). Given those four it can build the chain without
 * the parser having guessed at any of it.
 */
export class CsQueryClauseRegistry implements EntityIdentifiable {
  static readonly ARITY = 14;
  static readonly RELATION = 'cs_query_clause';

  readonly csExpressionLinkHash: string;
  readonly parentQueryLinkHash: string;
  readonly position: number;
  readonly clauseKind: CsQueryClauseKind;
  readonly identifierName: string;
  private sourceExpressionLinkHash = ABSENT;
  private bodyExpressionLinkHash = ABSENT;
  readonly intoIdentifier: string;
  readonly isDescending: boolean;
  readonly startLine: number;
  readonly startColumn: number;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csQueryClauseUniqueHash = ABSENT;

  constructor(props: {
    csExpressionLinkHash: string;
    parentQueryLinkHash: string;
    position: number;
    clauseKind: CsQueryClauseKind;
    identifierName: string;
    intoIdentifier: string;
    isDescending: boolean;
    startLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.csExpressionLinkHash = props.csExpressionLinkHash;
    this.parentQueryLinkHash = props.parentQueryLinkHash;
    this.position = props.position;
    this.clauseKind = props.clauseKind;
    this.identifierName = props.identifierName;
    this.intoIdentifier = props.intoIdentifier;
    this.isDescending = props.isDescending;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_QUERY_CLAUSE_md5(csExpressionLinkHash ‖ position ‖ clauseKind)`
   *
   * Position is load-bearing and not decoration: `where a where b` is legal, and
   * the two clauses differ in nothing but order. Order is also the whole content
   * of the rewrite — `Where().Select()` and `Select().Where()` compute different
   * things — so losing it would make the relation unusable for the one job it
   * has.
   */
  generateHash(): void {
    this.csQueryClauseUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_QUERY_CLAUSE,
      keyOf(this.csExpressionLinkHash, this.position, this.clauseKind)
    );
  }

  getHash(): string {
    return this.csQueryClauseUniqueHash;
  }

  /** What the clause ranges over — `xs` in `from x in xs`. */
  setSourceExpressionLinkHash(hash: string): void {
    this.sourceExpressionLinkHash = hash;
  }

  /** What the clause evaluates — `p` in `where p`. */
  setBodyExpressionLinkHash(hash: string): void {
    this.bodyExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return (
      `cs_query_clause[kind=${this.clauseKind}, position=${this.position}, ` +
      `identifier=${this.identifierName}, hash=${this.csQueryClauseUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        this.csExpressionLinkHash,
        this.parentQueryLinkHash,
        num(this.position),
        this.clauseKind,
        text(this.identifierName),
        this.sourceExpressionLinkHash,
        this.bodyExpressionLinkHash,
        text(this.intoIdentifier),
        bool(this.isDescending),
        num(this.startLine),
        num(this.startColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csQueryClauseUniqueHash,
      ],
      CsQueryClauseRegistry.ARITY,
      CsQueryClauseRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'csExpressionLinkHash', 'parentQueryLinkHash', 'position', 'clauseKind',
        'identifierName', 'sourceExpressionLinkHash', 'bodyExpressionLinkHash',
        'intoIdentifier', 'isDescending', 'startLine', 'startColumn', 'isExternal',
        'serviceVersionLinkHash', 'csQueryClauseUniqueHash',
      ],
      CsQueryClauseRegistry.ARITY,
      CsQueryClauseRegistry.RELATION
    );
  }
}
