import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CsAttributeTarget } from '@/enums/csharp/attributes';
import { CsDeclarationOwnerKind } from '@/enums/csharp/owners';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * An attribute — schema §3.14, **19 columns**.
 *
 * ## Inert metadata, and that is the whole difference from a decorator
 *
 * A TypeScript decorator RUNS: it can replace the thing it decorates, and the
 * order matters. A C# attribute does nothing at all until something reflects on
 * it. So there is no `decoratorSemantics` analogue and no execution-order
 * column, and porting either from TypeScript would assert a behaviour C# does
 * not have.
 *
 * What an engine actually needs from an attribute is the NAME as written and
 * anything it points at. `[JsonConverter(typeof(MyConverter))]` names a type
 * that is instantiated by a framework, from a stack no source file contains —
 * so the `typeof` argument is a real edge and the only place it exists.
 *
 * ## `attributeTarget` is what it ATTACHES to, not where it is written
 *
 * `[return: NotNull]` attaches to the return value; `[field: NonSerialized]` on
 * an auto-property attaches to a backing field with no declaration syntax
 * anywhere. Both are written on the member and neither is about the member.
 */
export class CsAttributeRegistry implements EntityIdentifiable {
  static readonly ARITY = 19;
  static readonly RELATION = 'cs_attribute';

  readonly attributeName: string;
  readonly qualifiedName: string;
  readonly attributeTarget: CsAttributeTarget;
  readonly ownerHash: string;
  readonly ownerKind: CsDeclarationOwnerKind;
  readonly csTypeLinkHash: string;
  readonly csModuleLinkHash: string;
  readonly attributeListIndex: number;
  readonly position: number;
  readonly argumentCount: number;
  readonly hasNamedArguments: boolean;
  private typeReferenceLinkHash = ABSENT;
  private csExpressionLinkHash = ABSENT;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csAttributeUniqueHash = ABSENT;

  constructor(props: {
    attributeName: string;
    qualifiedName: string;
    attributeTarget: CsAttributeTarget;
    ownerHash: string;
    ownerKind: CsDeclarationOwnerKind;
    csTypeLinkHash: string;
    csModuleLinkHash: string;
    attributeListIndex: number;
    position: number;
    argumentCount: number;
    hasNamedArguments: boolean;
    startLine: number;
    endLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.attributeName = props.attributeName;
    this.qualifiedName = props.qualifiedName;
    this.attributeTarget = props.attributeTarget;
    this.ownerHash = props.ownerHash;
    this.ownerKind = props.ownerKind;
    this.csTypeLinkHash = props.csTypeLinkHash;
    this.csModuleLinkHash = props.csModuleLinkHash;
    this.attributeListIndex = props.attributeListIndex;
    this.position = props.position;
    this.argumentCount = props.argumentCount;
    this.hasNamedArguments = props.hasNamedArguments;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_ATTRIBUTE_md5(ownerHash ‖ ownerKind ‖ position ‖ attributeName ‖
   * startLine)` — schema §1.
   *
   * `position` is the index across ALL of the owner's attribute lists, not
   * within one: `[A][B]` and `[A, B]` are the same two attributes written two
   * ways, and a per-list index would give both `A` and `B` position 0 in the
   * first form. `attributeListIndex` keeps the grouping as a separate fact
   * rather than folding it into the key.
   */
  generateHash(): void {
    this.csAttributeUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_ATTRIBUTE,
      keyOf(
        this.ownerHash,
        this.ownerKind,
        this.position,
        this.attributeName,
        this.startLine
      )
    );
  }

  getHash(): string {
    return this.csAttributeUniqueHash;
  }

  setTypeReferenceLinkHash(hash: string): void {
    this.typeReferenceLinkHash = hash;
  }

  setExpressionLinkHash(hash: string): void {
    this.csExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return (
      `cs_attribute[name=${this.attributeName}, target=${this.attributeTarget}, ` +
      `owner=${this.ownerKind}, args=${this.argumentCount}, ` +
      `hash=${this.csAttributeUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.attributeName),
        text(this.qualifiedName),
        this.attributeTarget,
        this.ownerHash,
        this.ownerKind,
        this.csTypeLinkHash,
        this.csModuleLinkHash,
        num(this.attributeListIndex),
        num(this.position),
        num(this.argumentCount),
        bool(this.hasNamedArguments),
        this.typeReferenceLinkHash,
        this.csExpressionLinkHash,
        num(this.startLine),
        num(this.endLine),
        num(this.startColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csAttributeUniqueHash,
      ],
      CsAttributeRegistry.ARITY,
      CsAttributeRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'attributeName', 'qualifiedName', 'attributeTarget', 'ownerHash', 'ownerKind',
        'csTypeLinkHash', 'csModuleLinkHash', 'attributeListIndex', 'position',
        'argumentCount', 'hasNamedArguments', 'typeReferenceLinkHash',
        'csExpressionLinkHash', 'startLine', 'endLine', 'startColumn',
        'isExternal', 'serviceVersionLinkHash', 'csAttributeUniqueHash',
      ],
      CsAttributeRegistry.ARITY,
      CsAttributeRegistry.RELATION
    );
  }
}
