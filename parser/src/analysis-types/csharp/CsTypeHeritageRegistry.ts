import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CsHeritageKind } from '@/enums/csharp/heritage';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One entry in a type's base list — schema §3.3, **13 columns**.
 *
 * ## The parser does not decide which entry is the base class
 *
 * `class C : A, IB` writes a base class and an interface into one
 * comma-separated list with no keyword between them. C# has no `extends` and no
 * `implements`, so Java's `JavaHeritageKind` split does not port and
 * {@link CsHeritageKind.BASE_OR_INTERFACE} is the honest answer for a class.
 *
 * Position does not rescue it either. A base class must come first *if it is
 * present*, but `class C : IFoo` is legal and has no base class at all, so
 * "entry 0 is the base" is wrong on every type that implements an interface and
 * derives from nothing — which is most of them.
 *
 * Where the LANGUAGE decides, the parser says so: a struct, a record struct and
 * an interface cannot have a base class, so their entries are
 * `INTERFACE_ONLY`. That is syntax, not resolution.
 *
 * ## No resolved link
 *
 * There is deliberately no `referencedTypeRegistryLinkHash`. Java's is populated
 * 0 times out of 67,938 by design, and a C# column that Roslyn *could* fill is
 * precisely the resolved-link column the schema constraints forbid. What an
 * engine needs is the NAME as written, its arity, and the module's using set —
 * all present.
 */
export class CsTypeHeritageRegistry implements EntityIdentifiable {
  static readonly ARITY = 13;
  static readonly RELATION = 'cs_type_heritage';

  readonly csTypeLinkHash: string;
  readonly position: number;
  readonly heritageText: string;
  readonly baseTypeName: string;
  readonly baseTypeArity: number;
  readonly heritageKind: CsHeritageKind;
  readonly hasPrimaryConstructorArguments: boolean;
  readonly startLine: number;
  readonly startColumn: number;

  /**
   * The `cs_type_reference` row for this entry's type, when one exists.
   *
   * A same-file one-hop link, which is what the IR rule permits. It is NOT a
   * link to the declaration of the base type — that is cross-file and the
   * engine's.
   */
  private csTypeReferenceLinkHash = ABSENT;

  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csTypeHeritageUniqueHash = ABSENT;

  constructor(props: {
    csTypeLinkHash: string;
    position: number;
    heritageText: string;
    baseTypeName: string;
    baseTypeArity: number;
    heritageKind: CsHeritageKind;
    hasPrimaryConstructorArguments: boolean;
    startLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.csTypeLinkHash = props.csTypeLinkHash;
    this.position = props.position;
    this.heritageText = props.heritageText;
    this.baseTypeName = props.baseTypeName;
    this.baseTypeArity = props.baseTypeArity;
    this.heritageKind = props.heritageKind;
    this.hasPrimaryConstructorArguments = props.hasPrimaryConstructorArguments;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_TYPE_HERITAGE_md5(csTypeLinkHash ‖ position ‖ heritageText ‖ startLine)`
   *
   * Chained off the DECLARATION SITE's hash, not off the group key. Two parts of
   * one `partial` type may each carry a base list — C# requires them to agree,
   * but they are two pieces of syntax at two positions and each gets its own
   * row. Keying off the group key would collapse them and lose one.
   */
  generateHash(): void {
    this.csTypeHeritageUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_TYPE_HERITAGE,
      keyOf(this.csTypeLinkHash, this.position, this.heritageText, this.startLine)
    );
  }

  getHash(): string {
    return this.csTypeHeritageUniqueHash;
  }

  setTypeReferenceLinkHash(hash: string): void {
    this.csTypeReferenceLinkHash = hash;
  }

  getTypeReferenceLinkHash(): string {
    return this.csTypeReferenceLinkHash;
  }

  getEntryCombined(): string {
    return (
      `cs_type_heritage[base=${this.baseTypeName}\`${this.baseTypeArity}, ` +
      `kind=${this.heritageKind}, position=${this.position}, hash=${this.csTypeHeritageUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        this.csTypeLinkHash,
        num(this.position),
        text(this.heritageText),
        text(this.baseTypeName),
        num(this.baseTypeArity),
        this.heritageKind,
        bool(this.hasPrimaryConstructorArguments),
        num(this.startLine),
        num(this.startColumn),
        this.csTypeReferenceLinkHash,
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csTypeHeritageUniqueHash,
      ],
      CsTypeHeritageRegistry.ARITY,
      CsTypeHeritageRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'csTypeLinkHash', 'position', 'heritageText', 'baseTypeName', 'baseTypeArity',
        'heritageKind', 'hasPrimaryConstructorArguments', 'startLine', 'startColumn',
        'csTypeReferenceLinkHash', 'isExternal', 'serviceVersionLinkHash',
        'csTypeHeritageUniqueHash',
      ],
      CsTypeHeritageRegistry.ARITY,
      CsTypeHeritageRegistry.RELATION
    );
  }
}
