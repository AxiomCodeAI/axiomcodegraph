import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { TsClauseToken, TsHeritageKind } from '@/enums/typescript/heritage';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One `extends` / `implements` clause entry — schema §4.3, 20 columns.
 *
 * ## This relation records SYNTAX. It is not a subtyping edge.
 *
 * That distinction does not exist in Java, where both clauses are authoritative,
 * and getting it wrong here is the single most consequential porting error
 * available. Measured: **60.4% of classes declare no `implements` at all**,
 * **21.5%** of assignable (class, interface) pairs appear in no syntax anywhere,
 * and **15.4%** are mutually assignable — which is not identity.
 *
 * {@link inheritsMembers} is the column that keeps it honest: `true` for
 * `extends`, which really does inherit members, and `false` for `implements`,
 * which is a compile-time assertion inheriting nothing. Path 4 of the resolution
 * layer walks supertype members through this relation, and walking an
 * `IMPLEMENTS_CLAUSE` row there is correct in Java and **wrong** here.
 *
 * For actual subtyping the engine derives `ts_type_satisfies` and the oracle
 * adjudicates it with `isTypeAssignableTo`. The parser has no checker and must
 * not pretend: a parser-emitted satisfaction row would be a guess dressed as a
 * fact.
 *
 * Every entry also mints a `ts_type_reference` twin ({@link tsTypeReferenceLinkHash}),
 * so heritage names resolve through the existing name-to-type machinery with no
 * new rules.
 */
export class TsTypeHeritageRegistry implements EntityIdentifiable {
  static readonly ARITY = 20;

  readonly heritageKind: TsHeritageKind;
  readonly clauseToken: TsClauseToken;
  readonly position: number;
  readonly heritageText: string;
  readonly heritageSimpleName: string;
  readonly heritageQualifiedPath: string;
  readonly typeArgumentCount: number;
  readonly inheritsMembers: boolean;
  readonly tsTypeLinkHash: string;
  readonly tsModuleLinkHash: string;
  private tsExpressionLinkHash = ABSENT;
  private tsTypeReferenceLinkHash = ABSENT;
  private resolvedTypeLinkHash = ABSENT;
  private resolvedGroupKey = ABSENT;
  private isResolvedLocally = false;
  readonly isDynamic: boolean;
  readonly startLine: number;
  readonly startColumn: number;
  readonly serviceVersionLinkHash: string;
  private tsTypeHeritageUniqueHash = ABSENT;

  constructor(props: {
    heritageKind: TsHeritageKind;
    clauseToken: TsClauseToken;
    position: number;
    heritageText: string;
    heritageSimpleName: string;
    heritageQualifiedPath: string;
    typeArgumentCount: number;
    inheritsMembers: boolean;
    tsTypeLinkHash: string;
    tsModuleLinkHash: string;
    isDynamic: boolean;
    startLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.heritageKind = props.heritageKind;
    this.clauseToken = props.clauseToken;
    this.position = props.position;
    this.heritageText = props.heritageText;
    this.heritageSimpleName = props.heritageSimpleName;
    this.heritageQualifiedPath = props.heritageQualifiedPath;
    this.typeArgumentCount = props.typeArgumentCount;
    this.inheritsMembers = props.inheritsMembers;
    this.tsTypeLinkHash = props.tsTypeLinkHash;
    this.tsModuleLinkHash = props.tsModuleLinkHash;
    this.isDynamic = props.isDynamic;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `TS_TYPE_HERITAGE_md5(tsTypeLinkHash ‖ clauseToken ‖ position ‖ heritageText ‖ startLine)`
   *
   * `clauseToken` is in the key rather than derived from `heritageKind`, because
   * `class C extends B implements B` is legal and the two rows must not collide.
   */
  generateHash(): void {
    this.tsTypeHeritageUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_TYPE_HERITAGE,
      keyOf(
        this.tsTypeLinkHash,
        this.clauseToken,
        this.position,
        this.heritageText,
        this.startLine
      )
    );
  }

  getHash(): string {
    return this.tsTypeHeritageUniqueHash;
  }

  setTsExpressionLinkHash(hash: string): void {
    this.tsExpressionLinkHash = hash;
  }

  setTsTypeReferenceLinkHash(hash: string): void {
    this.tsTypeReferenceLinkHash = hash;
  }

  setResolution(resolvedTypeLinkHash: string, resolvedGroupKey: string): void {
    this.resolvedTypeLinkHash = resolvedTypeLinkHash;
    this.resolvedGroupKey = resolvedGroupKey;
    this.isResolvedLocally = resolvedTypeLinkHash !== ABSENT;
  }

  getEntryCombined(): string {
    return `ts_type_heritage[kind=${this.heritageKind}, text=${this.heritageText}, inherits=${this.inheritsMembers}, hash=${this.tsTypeHeritageUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        this.heritageKind,
        this.clauseToken,
        num(this.position),
        text(this.heritageText),
        text(this.heritageSimpleName),
        text(this.heritageQualifiedPath),
        num(this.typeArgumentCount),
        bool(this.inheritsMembers),
        this.tsTypeLinkHash,
        this.tsModuleLinkHash,
        this.tsExpressionLinkHash,
        this.tsTypeReferenceLinkHash,
        this.resolvedTypeLinkHash,
        this.resolvedGroupKey,
        bool(this.isResolvedLocally),
        bool(this.isDynamic),
        num(this.startLine),
        num(this.startColumn),
        this.serviceVersionLinkHash,
        this.tsTypeHeritageUniqueHash,
      ],
      TsTypeHeritageRegistry.ARITY,
      'ts_type_heritage'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'heritageKind', 'clauseToken', 'position', 'heritageText', 'heritageSimpleName',
        'heritageQualifiedPath', 'typeArgumentCount', 'inheritsMembers', 'tsTypeLinkHash',
        'tsModuleLinkHash', 'tsExpressionLinkHash', 'tsTypeReferenceLinkHash',
        'resolvedTypeLinkHash', 'resolvedGroupKey', 'isResolvedLocally', 'isDynamic',
        'startLine', 'startColumn', 'serviceVersionLinkHash', 'tsTypeHeritageUniqueHash',
      ],
      TsTypeHeritageRegistry.ARITY,
      'ts_type_heritage'
    );
  }
}
