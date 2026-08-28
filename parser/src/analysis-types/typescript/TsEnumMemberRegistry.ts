import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { TsEnumMemberValueKind } from '@/enums/typescript/enum-members';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * An enum member — schema §4.10, 18 columns. Positions 0–11 mirror
 * `java_enum_constant` 0–11.
 *
 * TypeScript enums differ from Java's in two ways that need columns, and both
 * change what a reference to a member MEANS:
 *
 * **A member may be COMPUTED.** `Runtime = compute()` has no statically known
 * value, so `constantValue` is `""` and no rule may treat it as a constant.
 *
 * **A `const enum` member is INLINED at use sites.** A reference to one has no
 * runtime member to link to — the compiler substitutes the literal — so
 * `isConstEnumMember` is what stops a rule looking for a member access that the
 * emit does not contain.
 *
 * `hasBody` is a parity slot, always `false`: a Java enum constant may carry a
 * class body and a TypeScript member may not.
 */
export class TsEnumMemberRegistry implements EntityIdentifiable {
  static readonly ARITY = 18;

  readonly name: string;
  readonly qualifiedName: string;
  readonly ordinal: number;
  readonly initializerText: string;
  readonly hasInitializer: boolean;
  /** Parity slot with `java_enum_constant` 5. TypeScript members carry no body. */
  private readonly hasBody = false;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly tsTypeLinkHash: string;
  readonly ownerTypeName: string;
  readonly ownerQualifiedName: string;
  readonly valueKind: TsEnumMemberValueKind;
  readonly constantValue: string;
  readonly isConstEnumMember: boolean;
  private tsExpressionLinkHash = ABSENT;
  readonly serviceVersionLinkHash: string;
  private tsEnumMemberUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    qualifiedName: string;
    ordinal: number;
    initializerText: string;
    filePath: string;
    startLine: number;
    endLine: number;
    tsTypeLinkHash: string;
    ownerTypeName: string;
    ownerQualifiedName: string;
    valueKind: TsEnumMemberValueKind;
    constantValue: string;
    isConstEnumMember: boolean;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.qualifiedName = props.qualifiedName;
    this.ordinal = props.ordinal;
    this.initializerText = props.initializerText;
    this.hasInitializer = props.initializerText !== '';
    this.filePath = props.filePath;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.tsTypeLinkHash = props.tsTypeLinkHash;
    this.ownerTypeName = props.ownerTypeName;
    this.ownerQualifiedName = props.ownerQualifiedName;
    this.valueKind = props.valueKind;
    this.constantValue = props.constantValue;
    this.isConstEnumMember = props.isConstEnumMember;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `TS_ENUM_MEMBER_md5(tsTypeLinkHash ‖ name ‖ ordinal)` — chained off the enum. */
  generateHash(): void {
    this.tsEnumMemberUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_ENUM_MEMBER,
      keyOf(this.tsTypeLinkHash, this.name, this.ordinal)
    );
  }

  getHash(): string {
    return this.tsEnumMemberUniqueHash;
  }

  setTsExpressionLinkHash(hash: string): void {
    this.tsExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return `ts_enum_member[name=${this.name}, ordinal=${this.ordinal}, kind=${this.valueKind}, value=${this.constantValue}, hash=${this.tsEnumMemberUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        text(this.qualifiedName),
        num(this.ordinal),
        text(this.initializerText),
        bool(this.hasInitializer),
        bool(this.hasBody),
        text(this.filePath),
        num(this.startLine),
        num(this.endLine),
        this.tsTypeLinkHash,
        text(this.ownerTypeName),
        text(this.ownerQualifiedName),
        this.valueKind,
        text(this.constantValue),
        bool(this.isConstEnumMember),
        this.tsExpressionLinkHash,
        this.serviceVersionLinkHash,
        this.tsEnumMemberUniqueHash,
      ],
      TsEnumMemberRegistry.ARITY,
      'ts_enum_member'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name', 'qualifiedName', 'ordinal', 'initializerText', 'hasInitializer', 'hasBody',
        'filePath', 'startLine', 'endLine', 'tsTypeLinkHash', 'ownerTypeName',
        'ownerQualifiedName', 'valueKind', 'constantValue', 'isConstEnumMember',
        'tsExpressionLinkHash', 'serviceVersionLinkHash', 'tsEnumMemberUniqueHash',
      ],
      TsEnumMemberRegistry.ARITY,
      'ts_enum_member'
    );
  }
}
