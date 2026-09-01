import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  TsReferenceOwnerKind,
  TsTypeRefContext,
  TsTypeRefKind,
} from '@/enums/typescript/type-references';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * The TYPE-NODE TREE — schema §4.5, 30 columns.
 *
 * Positions 0–16 mirror `java_type_reference` 0–16, so the whole name-to-type
 * resolution layer ports as a relation rename.
 *
 * ## This relation is a containment guarantee, not just a table
 *
 * Every type-level construct lives here and **nowhere else**: conditional,
 * mapped, template-literal, `infer`, `keyof`, `typeof`, indexed access — 10,436
 * such nodes measured, none with a Java or Python analogue. Because there is no
 * other relation for them to be in, no call-graph rule can reach them. §3.3 is
 * enforced structurally rather than by a filter someone has to remember.
 *
 * ## A union is N ROWS, never one row with a list
 *
 * `A | B | C` is one parent row with `childCount = 3` plus three child rows
 * carrying `position` and `parentReferenceHash` — the same tree Java already
 * uses for `Map<K, V>`. The measurement killed the comma-set alternative three
 * times over: max arity is **208**, members are arbitrary nested type nodes
 * rather than names, and 45 nodes nest.
 *
 * {@link position} is **source** order and {@link childCount} is **source**
 * arity. The checker normalises `boolean` into `true | false` and reorders by
 * type id, so an oracle comparing member-wise against the checker would fail on
 * correct output. Type-node trees are what is compared; `typeToString` is for
 * reporting only.
 */
export class TsTypeReferenceRegistry implements EntityIdentifiable {
  static readonly ARITY = 31;

  readonly kind: TsTypeRefKind;
  readonly context: TsTypeRefContext;
  readonly tsTypeLinkHash: string;
  private typeParameterLinkHash = ABSENT;
  private referencedTypeLinkHash = ABSENT;
  readonly parentReferenceHash: string;
  readonly position: number;
  readonly depth: number;
  readonly typeName: string;
  readonly completeTypeName: string;
  readonly entityName: string;
  readonly typeVariableName: string;
  readonly arrayDimensions: string;
  readonly wildcardVariance: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly typeReferenceOwnerHash: string;
  readonly referenceOwnerKind: TsReferenceOwnerKind;
  readonly tsModuleLinkHash: string;
  readonly childCount: number;
  readonly isTypeOnlyPosition: boolean;
  private resolvedGroupKey = ABSENT;
  private isResolvedLocally = false;
  readonly importSpecifier: string;
  readonly isOptionalElement: boolean;
  readonly isRestElement: boolean;
  readonly literalValue: string;
  readonly isTruncated: boolean;
  readonly startColumn: number;
  readonly serviceVersionLinkHash: string;
  private tsTypeReferenceUniqueHash = ABSENT;

  constructor(props: {
    kind: TsTypeRefKind;
    context: TsTypeRefContext;
    tsTypeLinkHash: string;
    parentReferenceHash: string;
    position: number;
    depth: number;
    typeName: string;
    completeTypeName: string;
    entityName?: string;
    typeVariableName: string;
    arrayDimensions: string;
    wildcardVariance: string;
    startLine: number;
    endLine: number;
    typeReferenceOwnerHash: string;
    referenceOwnerKind: TsReferenceOwnerKind;
    tsModuleLinkHash: string;
    childCount: number;
    isTypeOnlyPosition: boolean;
    importSpecifier: string;
    isOptionalElement: boolean;
    isRestElement: boolean;
    literalValue: string;
    isTruncated: boolean;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.kind = props.kind;
    this.context = props.context;
    this.tsTypeLinkHash = props.tsTypeLinkHash;
    this.parentReferenceHash = props.parentReferenceHash;
    this.position = props.position;
    this.depth = props.depth;
    this.typeName = props.typeName;
    this.completeTypeName = props.completeTypeName;
    this.entityName = props.entityName ?? '';
    this.typeVariableName = props.typeVariableName;
    this.arrayDimensions = props.arrayDimensions;
    this.wildcardVariance = props.wildcardVariance;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.typeReferenceOwnerHash = props.typeReferenceOwnerHash;
    this.referenceOwnerKind = props.referenceOwnerKind;
    this.tsModuleLinkHash = props.tsModuleLinkHash;
    this.childCount = props.childCount;
    this.isTypeOnlyPosition = props.isTypeOnlyPosition;
    this.importSpecifier = props.importSpecifier;
    this.isOptionalElement = props.isOptionalElement;
    this.isRestElement = props.isRestElement;
    this.literalValue = props.literalValue;
    this.isTruncated = props.isTruncated;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `TS_TYPE_REFERENCE_md5(typeReferenceOwnerHash ‖ context ‖ parentReferenceHash ‖ position ‖ depth ‖ completeTypeName ‖ startLine ‖ startColumn)`
   *
   * Invariant 7 depends on `depth = 0` being exactly the rows with an empty
   * `parentReferenceHash`, so the root of every tree is minted with both.
   */
  generateHash(): void {
    this.tsTypeReferenceUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_TYPE_REFERENCE,
      keyOf(
        this.typeReferenceOwnerHash,
        this.context,
        this.parentReferenceHash,
        this.position,
        this.depth,
        this.completeTypeName,
        this.startLine,
        this.startColumn
      )
    );
  }

  getHash(): string {
    return this.tsTypeReferenceUniqueHash;
  }

  setTypeParameterLinkHash(hash: string): void {
    this.typeParameterLinkHash = hash;
  }

  /**
   * Records a resolution the PARSER could make from syntax alone.
   *
   * Left empty otherwise. An unfilled FK is a measured gap the engine closes;
   * a filled wrong one is a fact nothing downstream can question.
   */
  setResolution(referencedTypeLinkHash: string, resolvedGroupKey: string): void {
    this.referencedTypeLinkHash = referencedTypeLinkHash;
    this.resolvedGroupKey = resolvedGroupKey;
    this.isResolvedLocally = referencedTypeLinkHash !== ABSENT;
  }

  getResolvedGroupKey(): string {
    return this.resolvedGroupKey;
  }

  getEntryCombined(): string {
    return `ts_type_reference[kind=${this.kind}, ctx=${this.context}, name=${this.completeTypeName}, depth=${this.depth}, hash=${this.tsTypeReferenceUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        this.kind,
        this.context,
        this.tsTypeLinkHash,
        this.typeParameterLinkHash,
        this.referencedTypeLinkHash,
        this.parentReferenceHash,
        num(this.position),
        num(this.depth),
        text(this.typeName),
        text(this.completeTypeName),
        text(this.entityName),
        text(this.typeVariableName),
        text(this.arrayDimensions),
        this.wildcardVariance,
        num(this.startLine),
        num(this.endLine),
        this.typeReferenceOwnerHash,
        this.referenceOwnerKind,
        this.tsModuleLinkHash,
        num(this.childCount),
        bool(this.isTypeOnlyPosition),
        this.resolvedGroupKey,
        bool(this.isResolvedLocally),
        text(this.importSpecifier),
        bool(this.isOptionalElement),
        bool(this.isRestElement),
        text(this.literalValue),
        bool(this.isTruncated),
        num(this.startColumn),
        this.serviceVersionLinkHash,
        this.tsTypeReferenceUniqueHash,
      ],
      TsTypeReferenceRegistry.ARITY,
      'ts_type_reference'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'kind', 'context', 'tsTypeLinkHash', 'typeParameterLinkHash', 'referencedTypeLinkHash',
        'parentReferenceHash', 'position', 'depth', 'typeName', 'completeTypeName', 'entityName',
        'typeVariableName', 'arrayDimensions', 'wildcardVariance', 'startLine', 'endLine',
        'typeReferenceOwnerHash', 'referenceOwnerKind', 'tsModuleLinkHash', 'childCount',
        'isTypeOnlyPosition', 'resolvedGroupKey', 'isResolvedLocally', 'importSpecifier',
        'isOptionalElement', 'isRestElement', 'literalValue', 'isTruncated', 'startColumn',
        'serviceVersionLinkHash', 'tsTypeReferenceUniqueHash',
      ],
      TsTypeReferenceRegistry.ARITY,
      'ts_type_reference'
    );
  }
}
