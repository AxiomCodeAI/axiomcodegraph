import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  CsTypeParameterOwnerKind,
  CsVarianceModifier,
} from '@/enums/csharp/type-parameters';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One generic parameter, on a type or a method — schema §3.4, **16 columns** (v1.15).
 *
 * ## `varianceModifier` is here and not on the reference
 *
 * Java's `wildcardVariance` lives on `java_type_reference` because Java has
 * **use-site** variance: `List<? extends Number>` annotates the reference. C#
 * has **declaration-site** variance and no wildcards — `interface IEnumerable
 * <out T>` annotates the parameter once, and every reference inherits it.
 *
 * Same information, different relation. Porting the column onto
 * `cs_type_reference` would have produced a column empty on 100% of rows while
 * the variance sat unrecorded on the declaration.
 *
 * ## The constraints are flags AND text, on purpose
 *
 * `where T : class, IDisposable, new()` carries three different kinds of claim:
 * a reference-type constraint, an interface constraint, and a constructor
 * constraint. The flags let a rule ask "is this a value type" without parsing;
 * `constraintText` keeps what was written, because an interface constraint names
 * a TYPE and resolving it is the engine's job, not a boolean's.
 *
 * `constraintTypeCount` is the number of TYPE constraints specifically —
 * `class`, `struct`, `notnull`, `unmanaged`, `new()` and `allows ref struct`
 * are not types and are not counted.
 *
 * ## `hasUnmanagedConstraint` sits INSIDE the boolean run — v1.15, CS-ORACLE-6
 *
 * `unmanaged` was excluded from the count as a keyword and given no boolean as
 * a keyword, so it fell between the two and every structured column read
 * "unconstrained". It is column 12, after `hasAllowRefStructConstraint` and
 * before `constraintTypeCount`, so a reader scanning the constraint block does
 * not have to know one member lives elsewhere. `hasStructConstraint` is ALSO
 * true for it — unmanaged implies struct — and that is two questions, not
 * redundancy: "is T a value type?" and "may T be used with `fixed`, pointer
 * types and `stackalloc`?". The hash reads no constraint column, so nothing
 * moves but the arity.
 */
export class CsTypeParameterRegistry implements EntityIdentifiable {
  static readonly ARITY = 16;
  static readonly RELATION = 'cs_type_parameter';

  readonly ownerLinkHash: string;
  readonly ownerKind: CsTypeParameterOwnerKind;
  readonly position: number;
  readonly name: string;
  readonly varianceModifier: CsVarianceModifier;

  private constraintText = ABSENT;
  private hasStructConstraint = false;
  private hasClassConstraint = false;
  private hasNotNullConstraint = false;
  private hasConstructorConstraint = false;
  private hasAllowRefStructConstraint = false;
  private hasUnmanagedConstraint = false;
  private constraintTypeCount = 0;

  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csTypeParameterUniqueHash = ABSENT;

  constructor(props: {
    ownerLinkHash: string;
    ownerKind: CsTypeParameterOwnerKind;
    position: number;
    name: string;
    varianceModifier: CsVarianceModifier;
    serviceVersionLinkHash: string;
  }) {
    this.ownerLinkHash = props.ownerLinkHash;
    this.ownerKind = props.ownerKind;
    this.position = props.position;
    this.name = props.name;
    this.varianceModifier = props.varianceModifier;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_TYPE_PARAMETER_md5(ownerLinkHash ‖ position ‖ name)`
   *
   * Position AND name. Either alone would do for well-formed source, and both
   * are kept because a `partial` type may repeat its parameter list — C#
   * requires the names to match, and a key on position alone would then be
   * indistinguishable between the two declaration sites' parameters if the owner
   * hash were ever the group key rather than the site.
   */
  generateHash(): void {
    this.csTypeParameterUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_TYPE_PARAMETER,
      keyOf(this.ownerLinkHash, this.position, this.name)
    );
  }

  getHash(): string {
    return this.csTypeParameterUniqueHash;
  }

  /**
   * Records the `where` clause that governs this parameter, if any.
   *
   * Separate from the constructor because the clause is written AFTER the
   * parameter list and may not exist. Constructing the row without it and
   * back-patching keeps the hash independent of a value that arrives later.
   */
  setConstraints(constraints: {
    constraintText: string;
    hasStructConstraint: boolean;
    hasClassConstraint: boolean;
    hasNotNullConstraint: boolean;
    hasConstructorConstraint: boolean;
    hasAllowRefStructConstraint: boolean;
    hasUnmanagedConstraint: boolean;
    constraintTypeCount: number;
  }): void {
    this.constraintText = constraints.constraintText;
    this.hasStructConstraint = constraints.hasStructConstraint;
    this.hasClassConstraint = constraints.hasClassConstraint;
    this.hasNotNullConstraint = constraints.hasNotNullConstraint;
    this.hasConstructorConstraint = constraints.hasConstructorConstraint;
    this.hasAllowRefStructConstraint = constraints.hasAllowRefStructConstraint;
    this.hasUnmanagedConstraint = constraints.hasUnmanagedConstraint;
    this.constraintTypeCount = constraints.constraintTypeCount;
  }

  getEntryCombined(): string {
    return (
      `cs_type_parameter[name=${this.name}, position=${this.position}, ` +
      `variance=${this.varianceModifier}, owner=${this.ownerKind}, ` +
      `hash=${this.csTypeParameterUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        this.ownerLinkHash,
        this.ownerKind,
        num(this.position),
        text(this.name),
        this.varianceModifier,
        text(this.constraintText),
        bool(this.hasStructConstraint),
        bool(this.hasClassConstraint),
        bool(this.hasNotNullConstraint),
        bool(this.hasConstructorConstraint),
        bool(this.hasAllowRefStructConstraint),
        bool(this.hasUnmanagedConstraint),
        num(this.constraintTypeCount),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csTypeParameterUniqueHash,
      ],
      CsTypeParameterRegistry.ARITY,
      CsTypeParameterRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'ownerLinkHash', 'ownerKind', 'position', 'name', 'varianceModifier',
        'constraintText', 'hasStructConstraint', 'hasClassConstraint',
        'hasNotNullConstraint', 'hasConstructorConstraint', 'hasAllowRefStructConstraint',
        'hasUnmanagedConstraint', 'constraintTypeCount', 'isExternal', 'serviceVersionLinkHash',
        'csTypeParameterUniqueHash',
      ],
      CsTypeParameterRegistry.ARITY,
      CsTypeParameterRegistry.RELATION
    );
  }
}
