import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  TsTypeParameterOwnerKind,
  TsVarianceAnnotation,
} from '@/enums/typescript/type-parameters';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A generic type parameter — schema §4.4, 20 columns.
 *
 * Positions 0–6 mirror `java_type_parameter` 0–6.
 *
 * ## One relation where Java has two
 *
 * Java splits `java_type_parameter` from `java_method_type_parameter` because
 * types and methods are its only owners. TypeScript attaches type parameters to
 * **nine** kinds of declaration — including mapped types (`[K in keyof T]`) and
 * conditional types (`infer U`), which have no Java analogue at all — so N
 * relations would multiply without adding information. {@link ownerKind} plus the
 * polymorphic {@link ownerLinkHash} carries it instead.
 *
 * The cost is exact and worth stating: the `method_type_parameter` projection
 * ports as a rename plus a filter on `ownerKind`. Nothing else changes.
 *
 * ## Bounds stay separated even though the rows do not
 *
 * The BOUND is a `ts_type_reference` row, and its `context` distinguishes
 * `TYPE_PARAM_BOUND` (a class, interface or type-alias parameter) from
 * `METHOD_TYPE_PARAM_BOUND` (a function, method or signature parameter) exactly
 * as Java does. So "every bound on a method type parameter" is still one
 * predicate, and the Java query translates directly.
 *
 * ## Measured, so none of these columns is speculative
 *
 * 42,032 type parameters in one ecosystem corpus: 7,697 constrained, 2,014
 * defaulted, **562 variance-annotated** (`in`/`out`, TS 4.7) and **87 `const`**
 * (TS 5.0). Both of the last two occur in the wild, so both get a column.
 */
export class TsTypeParameterRegistry implements EntityIdentifiable {
  static readonly ARITY = 20;

  readonly paramName: string;
  readonly position: number;
  readonly ownerTypeName: string;
  readonly ownerQualifiedName: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly tsTypeLinkHash: string;
  readonly ownerKind: TsTypeParameterOwnerKind;
  readonly ownerLinkHash: string;
  private constraintReferenceLinkHash = ABSENT;
  readonly constraintText: string;
  private defaultReferenceLinkHash = ABSENT;
  readonly defaultText: string;
  readonly varianceAnnotation: TsVarianceAnnotation | '';
  readonly isConst: boolean;
  readonly hasConstraint: boolean;
  readonly hasDefault: boolean;
  readonly startColumn: number;
  readonly serviceVersionLinkHash: string;
  private tsTypeParameterUniqueHash = ABSENT;

  constructor(props: {
    paramName: string;
    position: number;
    ownerTypeName: string;
    ownerQualifiedName: string;
    filePath: string;
    startLine: number;
    tsTypeLinkHash: string;
    ownerKind: TsTypeParameterOwnerKind;
    ownerLinkHash: string;
    constraintText: string;
    defaultText: string;
    varianceAnnotation: TsVarianceAnnotation | '';
    isConst: boolean;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.paramName = props.paramName;
    this.position = props.position;
    this.ownerTypeName = props.ownerTypeName;
    this.ownerQualifiedName = props.ownerQualifiedName;
    this.filePath = props.filePath;
    this.startLine = props.startLine;
    this.tsTypeLinkHash = props.tsTypeLinkHash;
    this.ownerKind = props.ownerKind;
    this.ownerLinkHash = props.ownerLinkHash;
    this.constraintText = props.constraintText;
    this.defaultText = props.defaultText;
    this.varianceAnnotation = props.varianceAnnotation;
    this.isConst = props.isConst;
    // Derived from the TEXT rather than accepted as an argument, so the boolean
    // and the text can never disagree — a caller that set one and forgot the
    // other would produce a row claiming a constraint with nothing to join to.
    this.hasConstraint = props.constraintText !== '';
    this.hasDefault = props.defaultText !== '';
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `TS_TYPE_PARAMETER_md5(ownerLinkHash ‖ position ‖ paramName)`
   *
   * Chains off the owner. `position` and `paramName` are both present because a
   * mapped type and its enclosing alias can declare parameters of the same name
   * at different positions, and `infer U` can appear more than once in one
   * conditional.
   */
  generateHash(): void {
    this.tsTypeParameterUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_TYPE_PARAMETER,
      keyOf(this.ownerLinkHash, this.position, this.paramName)
    );
  }

  getHash(): string {
    return this.tsTypeParameterUniqueHash;
  }

  /** The bound's `ts_type_reference` root — `TYPE_PARAM_BOUND` or `METHOD_TYPE_PARAM_BOUND`. */
  setConstraintReferenceLinkHash(hash: string): void {
    this.constraintReferenceLinkHash = hash;
  }

  /** The default's `ts_type_reference` root — `TYPE_PARAM_DEFAULT`. */
  setDefaultReferenceLinkHash(hash: string): void {
    this.defaultReferenceLinkHash = hash;
  }

  getEntryCombined(): string {
    return `ts_type_parameter[name=${this.paramName}, pos=${this.position}, owner=${this.ownerKind}, constraint=${this.constraintText}, hash=${this.tsTypeParameterUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.paramName),
        num(this.position),
        text(this.ownerTypeName),
        text(this.ownerQualifiedName),
        text(this.filePath),
        num(this.startLine),
        this.tsTypeLinkHash,
        this.ownerKind,
        this.ownerLinkHash,
        this.constraintReferenceLinkHash,
        text(this.constraintText),
        this.defaultReferenceLinkHash,
        text(this.defaultText),
        this.varianceAnnotation,
        bool(this.isConst),
        bool(this.hasConstraint),
        bool(this.hasDefault),
        num(this.startColumn),
        this.serviceVersionLinkHash,
        this.tsTypeParameterUniqueHash,
      ],
      TsTypeParameterRegistry.ARITY,
      'ts_type_parameter'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'paramName', 'position', 'ownerTypeName', 'ownerQualifiedName', 'filePath', 'startLine',
        'tsTypeLinkHash', 'ownerKind', 'ownerLinkHash', 'constraintReferenceLinkHash',
        'constraintText', 'defaultReferenceLinkHash', 'defaultText', 'varianceAnnotation',
        'isConst', 'hasConstraint', 'hasDefault', 'startColumn', 'serviceVersionLinkHash',
        'tsTypeParameterUniqueHash',
      ],
      TsTypeParameterRegistry.ARITY,
      'ts_type_parameter'
    );
  }
}
