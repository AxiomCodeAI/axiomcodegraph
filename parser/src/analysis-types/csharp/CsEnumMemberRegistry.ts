import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CsEnumValueKind } from '@/enums/csharp/enum-members';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One enum member — schema §3.11, **18 columns**.
 *
 * ## `constantValue` is filled only for a LITERAL, and the absence is the point
 *
 * `C = A | B` has a value, and computing it is **evaluation, not parsing**. A
 * parser that folded it would be doing the compiler's arithmetic, and would be
 * wrong the first time an initializer referenced a constant declared in another
 * file. So a `COMPUTED` member carries `csExpressionLinkHash` and an empty
 * `constantValue`, and the engine decides.
 *
 * `IMPLICIT` is the third case and the easiest to get wrong: `enum E { A, B }`
 * gives `A = 0` and `B = 1`, and those values depend on every preceding member
 * — including on whether one of them had an explicit initializer. `ordinal`
 * carries the position; the value is the engine's for the same reason.
 */
export class CsEnumMemberRegistry implements EntityIdentifiable {
  static readonly ARITY = 18;
  static readonly RELATION = 'cs_enum_member';

  readonly name: string;
  readonly qualifiedName: string;
  readonly ordinal: number;
  readonly hasInitializer: boolean;
  readonly initializerText: string;
  readonly constantValue: string;
  readonly valueKind: CsEnumValueKind;
  readonly csTypeLinkHash: string;
  readonly csModuleLinkHash: string;
  readonly ownerTypeName: string;
  private csExpressionLinkHash = ABSENT;
  readonly attributeCount: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csEnumMemberUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    qualifiedName: string;
    ordinal: number;
    hasInitializer: boolean;
    initializerText: string;
    constantValue: string;
    valueKind: CsEnumValueKind;
    csTypeLinkHash: string;
    csModuleLinkHash: string;
    ownerTypeName: string;
    attributeCount: number;
    startLine: number;
    endLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.qualifiedName = props.qualifiedName;
    this.ordinal = props.ordinal;
    this.hasInitializer = props.hasInitializer;
    this.initializerText = props.initializerText;
    this.constantValue = props.constantValue;
    this.valueKind = props.valueKind;
    this.csTypeLinkHash = props.csTypeLinkHash;
    this.csModuleLinkHash = props.csModuleLinkHash;
    this.ownerTypeName = props.ownerTypeName;
    this.attributeCount = props.attributeCount;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `CS_ENUM_MEMBER_md5(csTypeLinkHash ‖ name ‖ ordinal)` */
  generateHash(): void {
    this.csEnumMemberUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_ENUM_MEMBER,
      keyOf(this.csTypeLinkHash, this.name, this.ordinal)
    );
  }

  getHash(): string {
    return this.csEnumMemberUniqueHash;
  }

  setExpressionLinkHash(hash: string): void {
    this.csExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return (
      `cs_enum_member[name=${this.name}, ordinal=${this.ordinal}, ` +
      `valueKind=${this.valueKind}, value=${this.constantValue}, ` +
      `hash=${this.csEnumMemberUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        text(this.qualifiedName),
        num(this.ordinal),
        bool(this.hasInitializer),
        text(this.initializerText),
        text(this.constantValue),
        this.valueKind,
        this.csTypeLinkHash,
        this.csModuleLinkHash,
        text(this.ownerTypeName),
        this.csExpressionLinkHash,
        num(this.attributeCount),
        num(this.startLine),
        num(this.endLine),
        num(this.startColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csEnumMemberUniqueHash,
      ],
      CsEnumMemberRegistry.ARITY,
      CsEnumMemberRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name', 'qualifiedName', 'ordinal', 'hasInitializer', 'initializerText',
        'constantValue', 'valueKind', 'csTypeLinkHash', 'csModuleLinkHash', 'ownerTypeName',
        'csExpressionLinkHash', 'attributeCount', 'startLine', 'endLine', 'startColumn',
        'isExternal', 'serviceVersionLinkHash', 'csEnumMemberUniqueHash',
      ],
      CsEnumMemberRegistry.ARITY,
      CsEnumMemberRegistry.RELATION
    );
  }
}
