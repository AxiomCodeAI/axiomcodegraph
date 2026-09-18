import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CsSetterKind } from '@/enums/csharp/properties';
import { CsTypeAccess } from '@/enums/csharp/types';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A property or an indexer — schema §3.8, **26 columns as listed**.
 *
 * > The schema heading says 22 and the column list beneath it has 26. The LIST
 * > is taken as the contract, because the order is the contract and only the
 * > list states one. Reported to cs-oracle and still open.
 *
 * ## Neither a field nor a method, and both reductions lose something
 *
 * **39,239 properties** against 97,113 methods. A property is a data LOCATION
 * with up to two CALL TARGETS, and in IL it is two methods plus a hidden backing
 * field. Reduce it to a field and the engine loses two call targets per
 * property; reduce it to two methods and it loses the data location. So it gets
 * its own relation, and each accessor ALSO gets a `cs_method` row pointing back
 * here through `ownerMemberLinkHash`.
 *
 * ## An indexer is a property with parameters
 *
 * `this[int i]` — 218 measured. It carries `isIndexer = true` rather than
 * getting its own relation, because every other column means the same thing.
 * What differs is invocation shape (`x[i]` not `x.P`), and that is on the
 * accessor's `cs_method.methodKind` as `INDEXER_GET`/`INDEXER_SET`.
 *
 * ## Accessor accessibility is asymmetric, and separately recorded
 *
 * `{ get; private set; }` — **581 sites**. One accessibility column would have
 * to pick one of the two and would be wrong about the other, which is the
 * difference between "anyone may write this" and "only the declaring type may".
 */
export class CsPropertyRegistry implements EntityIdentifiable {
  static readonly ARITY = 27;
  static readonly RELATION = 'cs_property';

  readonly name: string;
  readonly isIndexer: boolean;
  readonly propertyTypeName: string;
  readonly completeTypeName: string;
  readonly isNullableAnnotated: boolean;
  readonly propertyAccess: CsTypeAccess;
  readonly getAccessorAccess: CsTypeAccess | '';
  readonly setAccessorAccess: CsTypeAccess | '';
  readonly hasGetter: boolean;
  readonly hasSetter: boolean;
  readonly setterKind: CsSetterKind;
  readonly isRequired: boolean;
  readonly isStatic: boolean;
  readonly isAbstract: boolean;
  readonly isVirtual: boolean;
  readonly isOverride: boolean;
  /**
   * Declared in a C# 14 EXTENSION BLOCK.
   *
   * The counterpart of `cs_method.isExtension`, and the column whose absence
   * made an extension property indistinguishable from an ordinary property of
   * the static class that holds it. The RECEIVER is not here: it lives as
   * parameter 0 of each accessor, which is the static method the compiler
   * emits, so the C# 13 and C# 14 forms are the same fact in the IR.
   */
  readonly isExtension: boolean;
  readonly explicitInterfaceName: string;
  private initializerExpressionLinkHash = ABSENT;
  readonly csTypeLinkHash: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  private attributeCount = 0;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csPropertyUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    isIndexer: boolean;
    propertyTypeName: string;
    completeTypeName: string;
    isNullableAnnotated: boolean;
    propertyAccess: CsTypeAccess;
    getAccessorAccess: CsTypeAccess | '';
    setAccessorAccess: CsTypeAccess | '';
    hasGetter: boolean;
    hasSetter: boolean;
    setterKind: CsSetterKind;
    isRequired: boolean;
    isStatic: boolean;
    isAbstract: boolean;
    isVirtual: boolean;
    isOverride: boolean;
    isExtension: boolean;
    explicitInterfaceName: string;
    csTypeLinkHash: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    attributeCount: number;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.isIndexer = props.isIndexer;
    this.propertyTypeName = props.propertyTypeName;
    this.completeTypeName = props.completeTypeName;
    this.isNullableAnnotated = props.isNullableAnnotated;
    this.propertyAccess = props.propertyAccess;
    this.getAccessorAccess = props.getAccessorAccess;
    this.setAccessorAccess = props.setAccessorAccess;
    this.hasGetter = props.hasGetter;
    this.hasSetter = props.hasSetter;
    this.setterKind = props.setterKind;
    this.isRequired = props.isRequired;
    this.isStatic = props.isStatic;
    this.isAbstract = props.isAbstract;
    this.isVirtual = props.isVirtual;
    this.isOverride = props.isOverride;
    this.isExtension = props.isExtension;
    this.explicitInterfaceName = props.explicitInterfaceName;
    this.csTypeLinkHash = props.csTypeLinkHash;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.startColumn = props.startColumn;
    this.attributeCount = props.attributeCount;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_PROPERTY_md5(csTypeLinkHash ‖ name ‖ isIndexer ‖ startLine ‖ startColumn)`
   *
   * `isIndexer` is in the key because every indexer on a type has the SAME name
   * — the schema's `name` for one is `this[]`, not an identifier — and a type may
   * declare several with different parameter lists. Without it, two indexers
   * would differ only by position, which line and column already provide but
   * which reads as accidental rather than intended.
   */
  generateHash(): void {
    this.csPropertyUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_PROPERTY,
      keyOf(this.csTypeLinkHash, this.name, this.isIndexer, this.startLine, this.startColumn)
    );
  }

  getHash(): string {
    return this.csPropertyUniqueHash;
  }

  setInitializerExpressionLinkHash(hash: string): void {
    this.initializerExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return (
      `cs_property[name=${this.name}, indexer=${this.isIndexer}, ` +
      `type=${this.completeTypeName}, get=${this.hasGetter}, set=${this.setterKind}, ` +
      `hash=${this.csPropertyUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        bool(this.isIndexer),
        text(this.propertyTypeName),
        text(this.completeTypeName),
        bool(this.isNullableAnnotated),
        this.propertyAccess,
        this.getAccessorAccess,
        this.setAccessorAccess,
        bool(this.hasGetter),
        bool(this.hasSetter),
        this.setterKind,
        bool(this.isRequired),
        bool(this.isStatic),
        bool(this.isAbstract),
        bool(this.isVirtual),
        bool(this.isOverride),
        text(this.explicitInterfaceName),
        this.initializerExpressionLinkHash,
        this.csTypeLinkHash,
        num(this.startLine),
        num(this.endLine),
        num(this.startColumn),
        num(this.attributeCount),
        // APPENDED, not inserted. The schema's contract is that new columns go
        // immediately before the trailing isExternal / serviceVersionLinkHash /
        // hash triple: column ORDER is what the engine joins on, so inserting
        // this next to the other modifier flags — where it reads better —
        // would shift six columns and load into Souffle without an error.
        bool(this.isExtension),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csPropertyUniqueHash,
      ],
      CsPropertyRegistry.ARITY,
      CsPropertyRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name', 'isIndexer', 'propertyTypeName', 'completeTypeName', 'isNullableAnnotated',
        'propertyAccess', 'getAccessorAccess', 'setAccessorAccess', 'hasGetter',
        'hasSetter', 'setterKind', 'isRequired', 'isStatic', 'isAbstract', 'isVirtual',
        'isOverride', 'explicitInterfaceName', 'initializerExpressionLinkHash',
        'csTypeLinkHash', 'startLine', 'endLine', 'startColumn', 'attributeCount',
        'isExtension',
        'isExternal', 'serviceVersionLinkHash', 'csPropertyUniqueHash',
      ],
      CsPropertyRegistry.ARITY,
      CsPropertyRegistry.RELATION
    );
  }
}
