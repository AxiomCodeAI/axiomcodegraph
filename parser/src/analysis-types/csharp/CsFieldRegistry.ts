import { ABSENT, bool, commaSet, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CsFieldMemberKind, CsFieldModifier } from '@/enums/csharp/fields';
import { CsTypeAccess } from '@/enums/csharp/types';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A field — schema §3.10, **27 columns**.
 *
 * ## `int a, b;` is ONE declaration and TWO fields
 *
 * The declarators are the fields, and they share a type, a modifier set and an
 * owner. Two things keep their keys apart, and it is worth being precise about
 * which does the work: **the row carries the DECLARATOR's position, not the
 * declaration's**, so line and column already separate them. `declarationIndex`
 * is defence in depth, and the schema requires the column regardless because
 * the ordinal is information a consumer wants.
 *
 * That precision is not pedantry — a negative control written on the assumption
 * that the ordinal was load-bearing could not fail, because removing it left the
 * position guarantee intact. Two independent guarantees, and a check that breaks
 * one of them proves nothing.
 *
 * ## Three modifiers became reachable when this relation did
 *
 * `VOLATILE`, `CONST` and `FIXED` were declared on `CsMethodModifier`, where no
 * column could carry them. The enum audit reported all three as never emitted
 * and the cause was structural — there was nowhere to put them. `fieldModifiers`
 * is that place.
 *
 * `isConst` deserves its own note: a `const` field is **inlined at every use
 * site**, so a reference to one may have no runtime read at all. That is the
 * same reachability problem TypeScript's `const enum` has, and an engine that
 * treats a const read as a field access will look for a load that was never
 * emitted.
 */
export class CsFieldRegistry implements EntityIdentifiable {
  static readonly ARITY = 27;
  static readonly RELATION = 'cs_field';

  readonly name: string;
  readonly fieldTypeName: string;
  readonly completeTypeName: string;
  readonly potentialQualifiedName: string;
  readonly isAmbiguous: boolean;
  readonly fieldAccess: CsTypeAccess;
  readonly fieldModifiers: ReadonlySet<CsFieldModifier>;
  readonly isStatic: boolean;
  readonly isReadOnly: boolean;
  readonly isConst: boolean;
  readonly isVolatile: boolean;
  readonly isRequired: boolean;
  readonly isFixedSizeBuffer: boolean;
  readonly isNullableAnnotated: boolean;
  readonly memberKind: CsFieldMemberKind;
  readonly csTypeLinkHash: string;
  readonly csModuleLinkHash: string;
  private typeReferenceLinkHash = ABSENT;
  private initializerExpressionLinkHash = ABSENT;
  readonly declarationIndex: number;
  readonly attributeCount: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csFieldUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    fieldTypeName: string;
    completeTypeName: string;
    potentialQualifiedName: string;
    isAmbiguous: boolean;
    fieldAccess: CsTypeAccess;
    fieldModifiers: ReadonlySet<CsFieldModifier>;
    isStatic: boolean;
    isReadOnly: boolean;
    isConst: boolean;
    isVolatile: boolean;
    isRequired: boolean;
    isFixedSizeBuffer: boolean;
    isNullableAnnotated: boolean;
    memberKind: CsFieldMemberKind;
    csTypeLinkHash: string;
    csModuleLinkHash: string;
    declarationIndex: number;
    attributeCount: number;
    startLine: number;
    endLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.fieldTypeName = props.fieldTypeName;
    this.completeTypeName = props.completeTypeName;
    this.potentialQualifiedName = props.potentialQualifiedName;
    this.isAmbiguous = props.isAmbiguous;
    this.fieldAccess = props.fieldAccess;
    this.fieldModifiers = props.fieldModifiers;
    this.isStatic = props.isStatic;
    this.isReadOnly = props.isReadOnly;
    this.isConst = props.isConst;
    this.isVolatile = props.isVolatile;
    this.isRequired = props.isRequired;
    this.isFixedSizeBuffer = props.isFixedSizeBuffer;
    this.isNullableAnnotated = props.isNullableAnnotated;
    this.memberKind = props.memberKind;
    this.csTypeLinkHash = props.csTypeLinkHash;
    this.csModuleLinkHash = props.csModuleLinkHash;
    this.declarationIndex = props.declarationIndex;
    this.attributeCount = props.attributeCount;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_FIELD_md5(csTypeLinkHash ‖ name ‖ declarationIndex ‖ startLine ‖ startColumn)`
   *
   * Keyed on the DECLARATOR's position, which is what separates `int a, b;`
   * into two rows. `declarationIndex` is in the key as well — belt and braces,
   * and the schema wants the column anyway — but the position is what does the
   * work. See the class comment.
   */
  generateHash(): void {
    this.csFieldUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_FIELD,
      keyOf(
        this.csTypeLinkHash,
        this.name,
        this.declarationIndex,
        this.startLine,
        this.startColumn
      )
    );
  }

  getHash(): string {
    return this.csFieldUniqueHash;
  }

  setTypeReferenceLinkHash(hash: string): void {
    this.typeReferenceLinkHash = hash;
  }

  setInitializerExpressionLinkHash(hash: string): void {
    this.initializerExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return (
      `cs_field[name=${this.name}, type=${this.completeTypeName}, ` +
      `kind=${this.memberKind}, index=${this.declarationIndex}, ` +
      `hash=${this.csFieldUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        text(this.fieldTypeName),
        text(this.completeTypeName),
        text(this.potentialQualifiedName),
        bool(this.isAmbiguous),
        this.fieldAccess,
        commaSet(this.fieldModifiers),
        bool(this.isStatic),
        bool(this.isReadOnly),
        bool(this.isConst),
        bool(this.isVolatile),
        bool(this.isRequired),
        bool(this.isFixedSizeBuffer),
        bool(this.isNullableAnnotated),
        this.memberKind,
        this.csTypeLinkHash,
        this.csModuleLinkHash,
        this.typeReferenceLinkHash,
        this.initializerExpressionLinkHash,
        num(this.declarationIndex),
        num(this.attributeCount),
        num(this.startLine),
        num(this.endLine),
        num(this.startColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csFieldUniqueHash,
      ],
      CsFieldRegistry.ARITY,
      CsFieldRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name', 'fieldTypeName', 'completeTypeName', 'potentialQualifiedName', 'isAmbiguous',
        'fieldAccess', 'fieldModifiers', 'isStatic', 'isReadOnly', 'isConst', 'isVolatile',
        'isRequired', 'isFixedSizeBuffer', 'isNullableAnnotated', 'memberKind',
        'csTypeLinkHash', 'csModuleLinkHash', 'typeReferenceLinkHash',
        'initializerExpressionLinkHash', 'declarationIndex', 'attributeCount', 'startLine',
        'endLine', 'startColumn', 'isExternal', 'serviceVersionLinkHash', 'csFieldUniqueHash',
      ],
      CsFieldRegistry.ARITY,
      CsFieldRegistry.RELATION
    );
  }
}
