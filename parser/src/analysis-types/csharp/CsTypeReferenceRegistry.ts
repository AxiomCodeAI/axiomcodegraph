import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  CsReferenceOwnerKind,
  CsTypeRefContext,
  CsTypeRefKind,
} from '@/enums/csharp/type-references';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One node in a type-reference TREE — schema §3.5, **22 columns**.
 *
 * A tree and not a row: `Dictionary<string, List<int>>` is four references, and
 * `parentReferenceHash` plus `position` plus `depth` are what reconstruct the
 * nesting.
 *
 * ## Why the tree matters more in C# than in Java
 *
 * C# generics are **reified**. `List<int>` and `List<string>` are distinct
 * runtime types with distinct method tables; Java erases both to `List`. So the
 * type-argument subtree is part of the type's IDENTITY rather than decoration
 * the compiler discards, and flattening it loses which type a value actually is
 * at runtime — not merely how it was written.
 *
 * That is also why both `typeName` and `completeTypeName` are carried:
 * `List` is what a `using` scope resolves, `List<int>` is what the value IS.
 *
 * ## There is NO `referencedTypeRegistryLinkHash`
 *
 * Java's is populated 0 times out of 67,938 by design. A C# column that Roslyn
 * *could* fill is exactly the resolved-link column the schema constraints
 * forbid — the parser emits IR and the engine resolves. What an engine needs is
 * the name AS WRITTEN, the module, and that module's `using` set, and all three
 * are present.
 *
 * ## `wildcardVariance` does not port
 *
 * Java's variance is USE-site and belongs on the reference. C#'s is
 * DECLARATION-site and lives on `cs_type_parameter.varianceModifier`. Porting
 * the column would have produced one that is empty on 100% of rows.
 */
export class CsTypeReferenceRegistry implements EntityIdentifiable {
  static readonly ARITY = 22;
  static readonly RELATION = 'cs_type_reference';

  readonly kind: CsTypeRefKind;
  readonly context: CsTypeRefContext;
  readonly ownerLinkHash: string;
  readonly referenceOwnerKind: CsReferenceOwnerKind;
  readonly parentReferenceHash: string;
  readonly position: number;
  readonly depth: number;
  readonly typeName: string;
  readonly completeTypeName: string;
  readonly typeArgumentCount: number;
  readonly arrayRank: number;
  readonly isNullableAnnotated: boolean;
  readonly isPointer: boolean;
  readonly isTuple: boolean;
  readonly tupleElementCount: number;

  /**
   * The `cs_type_parameter` this reference resolves to, when it is a `T` bound
   * by the SAME declaration.
   *
   * A same-file, one-hop, purely syntactic link — the only kind the IR rule
   * permits. It is not a link to a type declaration and never becomes one.
   */
  private typeParameterLinkHash = ABSENT;

  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csTypeReferenceUniqueHash = ABSENT;

  constructor(props: {
    kind: CsTypeRefKind;
    context: CsTypeRefContext;
    ownerLinkHash: string;
    referenceOwnerKind: CsReferenceOwnerKind;
    parentReferenceHash: string;
    position: number;
    depth: number;
    typeName: string;
    completeTypeName: string;
    typeArgumentCount: number;
    arrayRank: number;
    isNullableAnnotated: boolean;
    isPointer: boolean;
    isTuple: boolean;
    tupleElementCount: number;
    startLine: number;
    endLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.kind = props.kind;
    this.context = props.context;
    this.ownerLinkHash = props.ownerLinkHash;
    this.referenceOwnerKind = props.referenceOwnerKind;
    this.parentReferenceHash = props.parentReferenceHash;
    this.position = props.position;
    this.depth = props.depth;
    this.typeName = props.typeName;
    this.completeTypeName = props.completeTypeName;
    this.typeArgumentCount = props.typeArgumentCount;
    this.arrayRank = props.arrayRank;
    this.isNullableAnnotated = props.isNullableAnnotated;
    this.isPointer = props.isPointer;
    this.isTuple = props.isTuple;
    this.tupleElementCount = props.tupleElementCount;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_TYPE_REFERENCE_md5(ownerLinkHash ‖ parentReferenceHash ‖ position
   * ‖ depth ‖ startLine ‖ startColumn)`
   *
   * Chained off the PARENT reference, not off a re-derived name. In
   * `Dictionary<int, int>` the two `int` references have the same name, the same
   * depth, the same owner and the same context; only their POSITION and column
   * separate them, and a name-derived key would collide on exactly the shape
   * this relation exists to represent.
   */
  generateHash(): void {
    this.csTypeReferenceUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_TYPE_REFERENCE,
      keyOf(
        this.ownerLinkHash,
        this.parentReferenceHash,
        this.position,
        this.depth,
        this.startLine,
        this.startColumn
      )
    );
  }

  getHash(): string {
    return this.csTypeReferenceUniqueHash;
  }

  setTypeParameterLinkHash(hash: string): void {
    this.typeParameterLinkHash = hash;
  }

  getEntryCombined(): string {
    return (
      `cs_type_reference[name=${this.completeTypeName}, kind=${this.kind}, ` +
      `context=${this.context}, depth=${this.depth}, position=${this.position}, ` +
      `hash=${this.csTypeReferenceUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        this.kind,
        this.context,
        this.ownerLinkHash,
        this.referenceOwnerKind,
        this.parentReferenceHash,
        num(this.position),
        num(this.depth),
        text(this.typeName),
        text(this.completeTypeName),
        num(this.typeArgumentCount),
        num(this.arrayRank),
        bool(this.isNullableAnnotated),
        bool(this.isPointer),
        bool(this.isTuple),
        num(this.tupleElementCount),
        this.typeParameterLinkHash,
        num(this.startLine),
        num(this.endLine),
        num(this.startColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csTypeReferenceUniqueHash,
      ],
      CsTypeReferenceRegistry.ARITY,
      CsTypeReferenceRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'kind', 'context', 'ownerLinkHash', 'referenceOwnerKind', 'parentReferenceHash',
        'position', 'depth', 'typeName', 'completeTypeName', 'typeArgumentCount',
        'arrayRank', 'isNullableAnnotated', 'isPointer', 'isTuple', 'tupleElementCount',
        'typeParameterLinkHash', 'startLine', 'endLine', 'startColumn', 'isExternal',
        'serviceVersionLinkHash', 'csTypeReferenceUniqueHash',
      ],
      CsTypeReferenceRegistry.ARITY,
      CsTypeReferenceRegistry.RELATION
    );
  }
}
