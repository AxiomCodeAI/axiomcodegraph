import { ABSENT, bool, commaSet, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CsNullableContext } from '@/enums/csharp/modules';
import {
  CsTypeAccess,
  CsTypeCategory,
  CsTypeModifier,
  CsTypePlacement,
} from '@/enums/csharp/types';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A type DECLARATION SITE — schema §3.2, **30 columns**.
 *
 * Class, struct, interface, enum, record, record struct, or delegate.
 *
 * ## One row per DECLARATION SITE, not per type
 *
 * This is §2.1 and every consumer trips on it: **`name → single entity` is
 * false in C#.** 1,662 `partial` declarations were measured over 897 type
 * identities, with a maximum of 88 parts for one type — linq-heavy-A's generated
 * model.
 *
 * So the primary key is the SITE, and {@link declarationGroupKey} is the merged
 * type's identity. That key is deliberately **not unique**: N parts produce N
 * rows carrying the same group key, and the engine forms the merged type by
 * grouping on it.
 *
 * ## 76.5% of partial identities have exactly ONE part in source
 *
 * 686 of 897. This is the finding that decides the design, and it inverts the
 * obvious gate: a schema that assumed "partial implies N files present" would be
 * wrong three times in four, and a check asserting "every partial group has ≥2
 * parts" would fail on correct output. The missing half is a source-generator
 * output that exists only after a build.
 *
 * ## Why there is no `isPrimaryDeclaration` and no `declarationIndex`
 *
 * Choosing "the" declaration requires seeing all of them, which is cross-file,
 * which a single-file extraction does not do. A column here would be a lie. The
 * engine derives an ordinal by sorting the group on
 * `(filePath, startLine, startColumn)` — total and deterministic.
 *
 * ## Arity is in the identity
 *
 * `Foo<T>` and `Foo<T,U>` are different types and 167 same-name-different-arity
 * collisions were measured. Arity is in both the primary key and the group key,
 * so the two never merge and neither collides.
 *
 * ## Why generics being REIFIED matters here and not only at the reference
 *
 * C# generics are reified: `List<int>` and `List<string>` are distinct runtime
 * types, where Java erases both to `List`. This row is the DECLARATION, so it
 * carries `arity` and not type arguments — but the consequence is that Java's
 * erasure-shaped assumptions do not port silently. Each column was checked
 * rather than assumed, and the one that did not port is `wildcardVariance`:
 * Java's is USE-site (`? extends T` at the reference), C#'s is DECLARATION-site
 * (`in`/`out` on the type parameter), so it moved to `cs_type_parameter`.
 */
export class CsTypeRegistry implements EntityIdentifiable {
  static readonly ARITY = 30;
  static readonly RELATION = 'cs_type';

  readonly name: string;
  readonly qualifiedName: string;
  readonly arity: number;
  readonly typeCategory: CsTypeCategory;
  readonly typeAccess: CsTypeAccess;
  readonly typeModifiers: ReadonlySet<CsTypeModifier>;
  readonly typePlacement: CsTypePlacement;
  readonly declarationScopeKey: string;
  readonly declarationGroupKey: string;
  readonly isPartial: boolean;
  readonly isStatic: boolean;
  readonly isAbstract: boolean;
  readonly isSealed: boolean;
  readonly isReadOnly: boolean;
  readonly isRefLikeStruct: boolean;
  readonly isFileLocal: boolean;
  readonly isRecord: boolean;
  readonly hasPrimaryConstructor: boolean;
  readonly primaryConstructorArity: number;
  readonly nullableContext: CsNullableContext;
  readonly csModuleLinkHash: string;
  readonly containingTypeLinkHash: string;
  readonly csNamespaceName: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;

  /** Back-patched once attributes are extracted. */
  private attributeCount = 0;

  /** Parity slot. Always `false` on parser output. */
  private readonly isExternal = false;

  readonly serviceVersionLinkHash: string;
  private csTypeUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    qualifiedName: string;
    arity: number;
    typeCategory: CsTypeCategory;
    typeAccess: CsTypeAccess;
    typeModifiers: ReadonlySet<CsTypeModifier>;
    typePlacement: CsTypePlacement;
    declarationScopeKey: string;
    declarationGroupKey: string;
    isPartial: boolean;
    isStatic: boolean;
    isAbstract: boolean;
    isSealed: boolean;
    isReadOnly: boolean;
    isRefLikeStruct: boolean;
    isFileLocal: boolean;
    isRecord: boolean;
    hasPrimaryConstructor: boolean;
    primaryConstructorArity: number;
    nullableContext: CsNullableContext;
    csModuleLinkHash: string;
    containingTypeLinkHash: string;
    csNamespaceName: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.qualifiedName = props.qualifiedName;
    this.arity = props.arity;
    this.typeCategory = props.typeCategory;
    this.typeAccess = props.typeAccess;
    this.typeModifiers = props.typeModifiers;
    this.typePlacement = props.typePlacement;
    this.declarationScopeKey = props.declarationScopeKey;
    this.declarationGroupKey = props.declarationGroupKey;
    this.isPartial = props.isPartial;
    this.isStatic = props.isStatic;
    this.isAbstract = props.isAbstract;
    this.isSealed = props.isSealed;
    this.isReadOnly = props.isReadOnly;
    this.isRefLikeStruct = props.isRefLikeStruct;
    this.isFileLocal = props.isFileLocal;
    this.isRecord = props.isRecord;
    this.hasPrimaryConstructor = props.hasPrimaryConstructor;
    this.primaryConstructorArity = props.primaryConstructorArity;
    this.nullableContext = props.nullableContext;
    this.csModuleLinkHash = props.csModuleLinkHash;
    this.containingTypeLinkHash = props.containingTypeLinkHash;
    this.csNamespaceName = props.csNamespaceName;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_TYPE_md5(csModuleLinkHash ‖ name ‖ arity ‖ declarationScopeKey ‖
   * startLine ‖ startColumn)`
   *
   * Chained off the module hash and never off a re-derived qualified name — and
   * here that is not stylistic. Two parts of one `partial` type share a
   * qualified name **by design**, so a qualified-name key would collide on
   * precisely the construct this relation exists to represent.
   *
   * `startColumn` is present because `class A { } class B { }` on one line is
   * legal, and so is a nested type on the same line as its parent's brace.
   */
  generateHash(): void {
    this.csTypeUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_TYPE,
      keyOf(
        this.csModuleLinkHash,
        this.name,
        this.arity,
        this.declarationScopeKey,
        this.startLine,
        this.startColumn
      )
    );
  }

  getHash(): string {
    return this.csTypeUniqueHash;
  }

  setAttributeCount(count: number): void {
    this.attributeCount = count;
  }

  getEntryCombined(): string {
    return (
      `cs_type[name=${this.name}, arity=${this.arity}, category=${this.typeCategory}, ` +
      `group=${this.declarationGroupKey}, partial=${this.isPartial}, hash=${this.csTypeUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        text(this.qualifiedName),
        num(this.arity),
        this.typeCategory,
        this.typeAccess,
        commaSet(this.typeModifiers),
        this.typePlacement,
        text(this.declarationScopeKey),
        this.declarationGroupKey,
        bool(this.isPartial),
        bool(this.isStatic),
        bool(this.isAbstract),
        bool(this.isSealed),
        bool(this.isReadOnly),
        bool(this.isRefLikeStruct),
        bool(this.isFileLocal),
        bool(this.isRecord),
        bool(this.hasPrimaryConstructor),
        num(this.primaryConstructorArity),
        this.nullableContext,
        this.csModuleLinkHash,
        this.containingTypeLinkHash,
        text(this.csNamespaceName),
        num(this.startLine),
        num(this.endLine),
        num(this.startColumn),
        num(this.attributeCount),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csTypeUniqueHash,
      ],
      CsTypeRegistry.ARITY,
      CsTypeRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name', 'qualifiedName', 'arity', 'typeCategory', 'typeAccess', 'typeModifiers',
        'typePlacement', 'declarationScopeKey', 'declarationGroupKey', 'isPartial',
        'isStatic', 'isAbstract', 'isSealed', 'isReadOnly', 'isRefLikeStruct',
        'isFileLocal', 'isRecord', 'hasPrimaryConstructor', 'primaryConstructorArity',
        'nullableContext', 'csModuleLinkHash', 'containingTypeLinkHash', 'csNamespaceName',
        'startLine', 'endLine', 'startColumn', 'attributeCount', 'isExternal',
        'serviceVersionLinkHash', 'csTypeUniqueHash',
      ],
      CsTypeRegistry.ARITY,
      CsTypeRegistry.RELATION
    );
  }
}
