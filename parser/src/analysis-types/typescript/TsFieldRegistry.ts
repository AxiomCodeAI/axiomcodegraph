import { ABSENT, bool, commaSet, joinHeader, joinRow, keyOf, num, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { TsFieldAccess, TsFieldModifier, TsMemberKind } from '@/enums/typescript/fields';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A member with a value shape — schema §4.8, 29 columns.
 *
 * Class properties, interface property signatures, index signatures,
 * auto-accessors, parameter properties, and object-literal properties.
 * Positions 0–12 mirror `java_field` 0–12.
 *
 * ## The key chains off the OWNER HASH, exactly as `FieldRegistry` does
 *
 * `FieldRegistry.ts` builds its hash from `typeRegistryLinkHash` and never from
 * a re-derived qualified name, and that discipline is inherited here for a
 * sharper reason than in Java: with declaration merging, two declarations of one
 * interface share a qualified name **by design**, so a qualified-name key would
 * collide on the exact construct this schema exists to model.
 *
 * {@link memberGroupKey} is the separate, deliberately non-unique key that says
 * "this member and that one are the same member of a merged owner" — so a
 * property declared in a module augmentation joins the same member as one
 * declared in the original interface.
 *
 * {@link isOptional} is not cosmetic: an absent optional member does not break
 * assignability, so §3.2's structural satisfaction depends on this column to
 * avoid rejecting a class that legitimately satisfies an interface.
 */
export class TsFieldRegistry implements EntityIdentifiable {
  static readonly ARITY = 29;

  readonly name: string;
  readonly fieldTypeName: string;
  readonly fieldBaseType: string;
  readonly potentialQualifiedName: string;
  readonly isAmbiguous: boolean;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly tsTypeLinkHash: string;
  readonly ownerTypeName: string;
  readonly ownerQualifiedName: string;
  readonly fieldAccess: TsFieldAccess;
  readonly fieldModifiers: ReadonlySet<TsFieldModifier>;
  readonly memberKind: TsMemberKind;
  readonly tsModuleLinkHash: string;
  readonly isOptional: boolean;
  readonly hasDefiniteAssignment: boolean;
  readonly isReadonly: boolean;
  readonly isStatic: boolean;
  readonly indexKeyTypeName: string;
  readonly isTypeOnly: boolean;
  private typeReferenceLinkHash = ABSENT;
  private initializerExpressionLinkHash = ABSENT;
  private originParameterLinkHash = ABSENT;
  readonly memberGroupKey: string;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly serviceVersionLinkHash: string;
  private tsFieldUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    fieldTypeName: string;
    fieldBaseType: string;
    potentialQualifiedName: string;
    isAmbiguous: boolean;
    filePath: string;
    startLine: number;
    endLine: number;
    tsTypeLinkHash: string;
    ownerTypeName: string;
    ownerQualifiedName: string;
    fieldAccess: TsFieldAccess;
    fieldModifiers: ReadonlySet<TsFieldModifier>;
    memberKind: TsMemberKind;
    tsModuleLinkHash: string;
    isOptional: boolean;
    hasDefiniteAssignment: boolean;
    isReadonly: boolean;
    isStatic: boolean;
    indexKeyTypeName: string;
    isTypeOnly: boolean;
    memberGroupKey: string;
    startColumn: number;
    endColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.fieldTypeName = props.fieldTypeName;
    this.fieldBaseType = props.fieldBaseType;
    this.potentialQualifiedName = props.potentialQualifiedName;
    this.isAmbiguous = props.isAmbiguous;
    this.filePath = props.filePath;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.tsTypeLinkHash = props.tsTypeLinkHash;
    this.ownerTypeName = props.ownerTypeName;
    this.ownerQualifiedName = props.ownerQualifiedName;
    this.fieldAccess = props.fieldAccess;
    this.fieldModifiers = props.fieldModifiers;
    this.memberKind = props.memberKind;
    this.tsModuleLinkHash = props.tsModuleLinkHash;
    this.isOptional = props.isOptional;
    this.hasDefiniteAssignment = props.hasDefiniteAssignment;
    this.isReadonly = props.isReadonly;
    this.isStatic = props.isStatic;
    this.indexKeyTypeName = props.indexKeyTypeName;
    this.isTypeOnly = props.isTypeOnly;
    this.memberGroupKey = props.memberGroupKey;
    this.startColumn = props.startColumn;
    this.endColumn = props.endColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `TS_FIELD_md5(filePath ‖ tsTypeLinkHash ‖ name ‖ fieldTypeName ‖ startLine ‖ startColumn)` */
  generateHash(): void {
    this.tsFieldUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_FIELD,
      keyOf(
        this.filePath,
        this.tsTypeLinkHash,
        this.name,
        this.fieldTypeName,
        this.startLine,
        this.startColumn
      )
    );
  }

  getHash(): string {
    return this.tsFieldUniqueHash;
  }

  setTypeReferenceLinkHash(hash: string): void {
    this.typeReferenceLinkHash = hash;
  }

  setInitializerExpressionLinkHash(hash: string): void {
    this.initializerExpressionLinkHash = hash;
  }

  /** Set when this field was declared by a `constructor(private x: T)` parameter. */
  setOriginParameterLinkHash(hash: string): void {
    this.originParameterLinkHash = hash;
  }

  getEntryCombined(): string {
    return `ts_field[name=${this.name}, type=${this.fieldTypeName}, kind=${this.memberKind}, hash=${this.tsFieldUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        text(this.fieldTypeName),
        text(this.fieldBaseType),
        text(this.potentialQualifiedName),
        bool(this.isAmbiguous),
        text(this.filePath),
        num(this.startLine),
        num(this.endLine),
        this.tsTypeLinkHash,
        text(this.ownerTypeName),
        text(this.ownerQualifiedName),
        this.fieldAccess,
        commaSet(this.fieldModifiers),
        this.memberKind,
        this.tsModuleLinkHash,
        bool(this.isOptional),
        bool(this.hasDefiniteAssignment),
        bool(this.isReadonly),
        bool(this.isStatic),
        text(this.indexKeyTypeName),
        bool(this.isTypeOnly),
        this.typeReferenceLinkHash,
        this.initializerExpressionLinkHash,
        this.originParameterLinkHash,
        this.memberGroupKey,
        num(this.startColumn),
        num(this.endColumn),
        this.serviceVersionLinkHash,
        this.tsFieldUniqueHash,
      ],
      TsFieldRegistry.ARITY,
      'ts_field'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name', 'fieldTypeName', 'fieldBaseType', 'potentialQualifiedName', 'isAmbiguous',
        'filePath', 'startLine', 'endLine', 'tsTypeLinkHash', 'ownerTypeName',
        'ownerQualifiedName', 'fieldAccess', 'fieldModifier', 'memberKind', 'tsModuleLinkHash',
        'isOptional', 'hasDefiniteAssignment', 'isReadonly', 'isStatic', 'indexKeyTypeName',
        'isTypeOnly', 'typeReferenceLinkHash', 'initializerExpressionLinkHash',
        'originParameterLinkHash', 'memberGroupKey', 'startColumn', 'endColumn',
        'serviceVersionLinkHash', 'tsFieldUniqueHash',
      ],
      TsFieldRegistry.ARITY,
      'ts_field'
    );
  }
}
