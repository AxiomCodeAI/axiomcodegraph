import { ABSENT, bool, commaSet, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  CsBodyKind,
  CsConversionKind,
  CsMethodKind,
  CsMethodModifier,
  CsOwnerMemberKind,
} from '@/enums/csharp/methods';
import { CsTypeAccess } from '@/enums/csharp/types';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A callable — schema §3.6 v1.1, **35 columns**.
 *
 * Methods, constructors, operators, conversion operators, local functions,
 * lambdas, and **every property, indexer and event accessor**.
 *
 * ## `isAccessor` is a column because it is 68% of this relation
 *
 * Measured: 66,449 of the rows here come from accessors, against 97,113 method
 * declarations. **Any count of methods that does not filter `isAccessor` is
 * wrong by two thirds.** That is not a rounding error, and it is invisible
 * unless the column exists.
 *
 * `ownerMemberLinkHash` is **required**: non-empty exactly when `isAccessor` is
 * true, empty otherwise, resolving to a `cs_property` or `cs_event` in the same
 * file. `methodKind` carries the accessor's ROLE (`PROPERTY_GET`, `EVENT_ADD`);
 * `ownerMemberKind` carries what it belongs to.
 *
 * ## Why accessors are here at all
 *
 * IL has them as methods, and an engine resolving a call to `x.P` needs a
 * DECLARED CALLABLE to resolve it to. A property
 * reduced to a field loses two call targets; reduced to two methods it loses the
 * data location. So `cs_property` carries the location and this carries the
 * targets, and the accessor 1:1 gate asserts each declared accessor produced
 * exactly one row — **duplicates DOUBLE, they do not collide.**
 *
 * ## `signature` is a shape, never a resolution
 *
 * It is the parameter TYPE NAMES as written, joined. It is not a resolved
 * signature and cannot be: `List<T>` and `List<int>` are distinct reified types
 * and the parser does not know which `T` is. It exists so two overloads on one
 * type get different primary keys, which is the only job it has.
 */
export class CsMethodRegistry implements EntityIdentifiable {
  static readonly ARITY = 35;
  static readonly RELATION = 'cs_method';

  readonly name: string;
  readonly qualifiedName: string;
  readonly arity: number;
  readonly signature: string;
  readonly methodKind: CsMethodKind;
  readonly returnTypeName: string;
  readonly methodAccess: CsTypeAccess;
  readonly methodModifiers: ReadonlySet<CsMethodModifier>;
  readonly isStatic: boolean;
  readonly isAbstract: boolean;
  readonly isVirtual: boolean;
  readonly isOverride: boolean;
  readonly isSealed: boolean;
  readonly isAsync: boolean;
  readonly isIterator: boolean;
  readonly isExtension: boolean;
  readonly isPartialDefinition: boolean;
  readonly isPartialImplementation: boolean;
  readonly explicitInterfaceName: string;
  readonly operatorToken: string;
  readonly conversionKind: CsConversionKind;
  readonly csModuleLinkHash: string;
  readonly csTypeLinkHash: string;
  readonly isAccessor: boolean;
  readonly ownerMemberLinkHash: string;
  readonly ownerMemberKind: CsOwnerMemberKind;
  readonly parameterCount: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly bodyKind: CsBodyKind;

  private attributeCount = 0;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csMethodUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    qualifiedName: string;
    arity: number;
    signature: string;
    methodKind: CsMethodKind;
    returnTypeName: string;
    methodAccess: CsTypeAccess;
    methodModifiers: ReadonlySet<CsMethodModifier>;
    isStatic: boolean;
    isAbstract: boolean;
    isVirtual: boolean;
    isOverride: boolean;
    isSealed: boolean;
    isAsync: boolean;
    isIterator: boolean;
    isExtension: boolean;
    isPartialDefinition: boolean;
    isPartialImplementation: boolean;
    explicitInterfaceName: string;
    operatorToken: string;
    conversionKind: CsConversionKind;
    csModuleLinkHash: string;
    csTypeLinkHash: string;
    isAccessor: boolean;
    ownerMemberLinkHash: string;
    ownerMemberKind: CsOwnerMemberKind;
    parameterCount: number;
    startLine: number;
    endLine: number;
    startColumn: number;
    bodyKind: CsBodyKind;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.qualifiedName = props.qualifiedName;
    this.arity = props.arity;
    this.signature = props.signature;
    this.methodKind = props.methodKind;
    this.returnTypeName = props.returnTypeName;
    this.methodAccess = props.methodAccess;
    this.methodModifiers = props.methodModifiers;
    this.isStatic = props.isStatic;
    this.isAbstract = props.isAbstract;
    this.isVirtual = props.isVirtual;
    this.isOverride = props.isOverride;
    this.isSealed = props.isSealed;
    this.isAsync = props.isAsync;
    this.isIterator = props.isIterator;
    this.isExtension = props.isExtension;
    this.isPartialDefinition = props.isPartialDefinition;
    this.isPartialImplementation = props.isPartialImplementation;
    this.explicitInterfaceName = props.explicitInterfaceName;
    this.operatorToken = props.operatorToken;
    this.conversionKind = props.conversionKind;
    this.csModuleLinkHash = props.csModuleLinkHash;
    this.csTypeLinkHash = props.csTypeLinkHash;
    this.isAccessor = props.isAccessor;
    this.ownerMemberLinkHash = props.ownerMemberLinkHash;
    this.ownerMemberKind = props.ownerMemberKind;
    this.parameterCount = props.parameterCount;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.startColumn = props.startColumn;
    this.bodyKind = props.bodyKind;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_METHOD_md5(csModuleLinkHash ‖ csTypeLinkHash ‖ name ‖ arity ‖
   * signature ‖ startLine ‖ startColumn)`
   *
   * `csTypeLinkHash` is the DECLARATION SITE's hash, not the group key. Two
   * parts of one `partial` type declare different members, and keying members
   * off the merged identity would make a member declared in part 1 and one
   * declared in part 2 at the same line collide.
   *
   * `startColumn` is present for the same reason it is on `cs_type`, and for one
   * more: `{ get; set; }` puts both accessors on one line, so line alone cannot
   * separate them.
   */
  generateHash(): void {
    this.csMethodUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_METHOD,
      keyOf(
        this.csModuleLinkHash,
        this.csTypeLinkHash,
        this.name,
        this.arity,
        this.signature,
        this.startLine,
        this.startColumn
      )
    );
  }

  getHash(): string {
    return this.csMethodUniqueHash;
  }

  setAttributeCount(count: number): void {
    this.attributeCount = count;
  }

  getEntryCombined(): string {
    return (
      `cs_method[name=${this.name}, kind=${this.methodKind}, arity=${this.arity}, ` +
      `accessor=${this.isAccessor}, params=${this.parameterCount}, ` +
      `hash=${this.csMethodUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        text(this.qualifiedName),
        num(this.arity),
        text(this.signature),
        this.methodKind,
        text(this.returnTypeName),
        this.methodAccess,
        commaSet(this.methodModifiers),
        bool(this.isStatic),
        bool(this.isAbstract),
        bool(this.isVirtual),
        bool(this.isOverride),
        bool(this.isSealed),
        bool(this.isAsync),
        bool(this.isIterator),
        bool(this.isExtension),
        bool(this.isPartialDefinition),
        bool(this.isPartialImplementation),
        text(this.explicitInterfaceName),
        text(this.operatorToken),
        this.conversionKind,
        this.csModuleLinkHash,
        this.csTypeLinkHash,
        bool(this.isAccessor),
        this.ownerMemberLinkHash,
        this.ownerMemberKind,
        num(this.parameterCount),
        num(this.startLine),
        num(this.endLine),
        num(this.startColumn),
        this.bodyKind,
        num(this.attributeCount),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csMethodUniqueHash,
      ],
      CsMethodRegistry.ARITY,
      CsMethodRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name', 'qualifiedName', 'arity', 'signature', 'methodKind', 'returnTypeName',
        'methodAccess', 'methodModifiers', 'isStatic', 'isAbstract', 'isVirtual',
        'isOverride', 'isSealed', 'isAsync', 'isIterator', 'isExtension',
        'isPartialDefinition', 'isPartialImplementation', 'explicitInterfaceName',
        'operatorToken', 'conversionKind', 'csModuleLinkHash', 'csTypeLinkHash',
        'isAccessor', 'ownerMemberLinkHash', 'ownerMemberKind', 'parameterCount',
        'startLine', 'endLine', 'startColumn', 'bodyKind', 'attributeCount',
        'isExternal', 'serviceVersionLinkHash', 'csMethodUniqueHash',
      ],
      CsMethodRegistry.ARITY,
      CsMethodRegistry.RELATION
    );
  }
}
