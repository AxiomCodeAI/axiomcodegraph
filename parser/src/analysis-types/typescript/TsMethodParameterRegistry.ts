import { ABSENT, bool, commaSet, joinHeader, joinRow, keyOf, num, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  TsDefaultValueKind,
  TsParamKind,
  TsParameterPropertyModifier,
} from '@/enums/typescript/method-parameters';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';
import { TsBindingSourceKind } from '@/enums/typescript/variables/TsBindingSourceKind';

/**
 * A formal parameter — schema §4.7, 27 columns. Positions 0–11 mirror
 * `java_method_parameter` 0–11.
 *
 * ## This relation is why TypeScript needs no binder to be useful
 *
 * **85.3%** of project parameters and **99.998%** of ambient parameters carry a
 * type annotation. That is the exact inverse of Python, where 68.2% had none and
 * argument flow had to carry the whole load of receiver typing. Here the
 * declared type is written at the declaration site, so Path 1 — receiver
 * expression to declaration to annotation to type — is a syntax-directed walk,
 * which is why this schema is Java-shaped rather than Python-shaped.
 *
 * Two columns are load-bearing beyond their apparent size:
 *
 * - {@link isOptional} changes **arity matching**. A call with two arguments can
 *   legally target a three-parameter signature whose third is optional, so
 *   overload selection that compares counts without this column selects wrongly.
 * - {@link isParameterProperty}: `constructor(private x: T)` means one parameter
 *   also DECLARES A FIELD. That has no Java or Python analogue. It is recorded
 *   as a cross-FK to the field row ({@link declaredFieldLinkHash}), never as a
 *   duplicated row, so the field is counted once in the type's shape.
 */
export class TsMethodParameterRegistry implements EntityIdentifiable {
  static readonly ARITY = 29;

  readonly paramName: string;
  readonly position: number;
  readonly tsMethodLinkHash: string;
  readonly parameterBaseType: string;
  readonly parameterTypeName: string;
  readonly potentialQualifiedName: string;
  readonly isAmbiguous: boolean;
  /** Parity slot with `java_method_parameter` 7; TypeScript has no `final`. */
  private readonly isFinal = false;
  readonly isVarArgs: boolean;
  readonly isReceiverParameter: boolean;
  readonly startLine: number;
  readonly endLine: number;
  readonly paramKind: TsParamKind;
  readonly isOptional: boolean;
  readonly hasDefault: boolean;
  readonly defaultValueText: string;
  readonly defaultValueKind: TsDefaultValueKind;
  readonly isParameterProperty: boolean;
  readonly parameterPropertyModifiers: ReadonlySet<TsParameterPropertyModifier>;
  private declaredFieldLinkHash = ABSENT;
  readonly bindingPatternText: string;
  readonly bindingSourceKind: TsBindingSourceKind;
  readonly bindingSource: string;
  private typeReferenceLinkHash = ABSENT;
  private tsExpressionLinkHash = ABSENT;
  readonly decoratorCount: number;
  readonly startColumn: number;
  readonly serviceVersionLinkHash: string;
  private tsMethodParameterUniqueHash = ABSENT;

  constructor(props: {
    paramName: string;
    position: number;
    tsMethodLinkHash: string;
    parameterBaseType: string;
    parameterTypeName: string;
    potentialQualifiedName: string;
    isAmbiguous: boolean;
    isVarArgs: boolean;
    isReceiverParameter: boolean;
    startLine: number;
    endLine: number;
    paramKind: TsParamKind;
    isOptional: boolean;
    hasDefault: boolean;
    defaultValueText: string;
    defaultValueKind: TsDefaultValueKind;
    isParameterProperty: boolean;
    parameterPropertyModifiers: ReadonlySet<TsParameterPropertyModifier>;
    bindingPatternText: string;
    bindingSourceKind?: TsBindingSourceKind;
    bindingSource?: string;
    decoratorCount: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.paramName = props.paramName;
    this.position = props.position;
    this.tsMethodLinkHash = props.tsMethodLinkHash;
    this.parameterBaseType = props.parameterBaseType;
    this.parameterTypeName = props.parameterTypeName;
    this.potentialQualifiedName = props.potentialQualifiedName;
    this.isAmbiguous = props.isAmbiguous;
    this.isVarArgs = props.isVarArgs;
    this.isReceiverParameter = props.isReceiverParameter;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.paramKind = props.paramKind;
    this.isOptional = props.isOptional;
    this.hasDefault = props.hasDefault;
    this.defaultValueText = props.defaultValueText;
    this.defaultValueKind = props.defaultValueKind;
    this.isParameterProperty = props.isParameterProperty;
    this.parameterPropertyModifiers = props.parameterPropertyModifiers;
    this.bindingPatternText = props.bindingPatternText;
    this.bindingSourceKind = props.bindingSourceKind ?? TsBindingSourceKind.NONE;
    this.bindingSource = props.bindingSource ?? '';
    this.decoratorCount = props.decoratorCount;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `TS_METHOD_PARAMETER_md5(tsMethodLinkHash ‖ position ‖ paramName ‖ paramKind)`
   *
   * Chained off the method hash. `paramName` is `""` for a destructured
   * parameter, which is why `position` and `paramKind` are both in the key —
   * `function f({a}, [b])` has two nameless parameters that differ only in kind.
   */
  generateHash(): void {
    this.tsMethodParameterUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_METHOD_PARAMETER,
      keyOf(this.tsMethodLinkHash, this.position, this.paramName, this.paramKind)
    );
  }

  getHash(): string {
    return this.tsMethodParameterUniqueHash;
  }

  /** The field a parameter property declares. A cross-FK, never a duplicated row. */
  setDeclaredFieldLinkHash(hash: string): void {
    this.declaredFieldLinkHash = hash;
  }

  getTypeReferenceLinkHash(): string {
    return this.typeReferenceLinkHash;
  }

  setTypeReferenceLinkHash(hash: string): void {
    this.typeReferenceLinkHash = hash;
  }

  setTsExpressionLinkHash(hash: string): void {
    this.tsExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return `ts_method_parameter[name=${this.paramName}, pos=${this.position}, kind=${this.paramKind}, hash=${this.tsMethodParameterUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.paramName),
        num(this.position),
        this.tsMethodLinkHash,
        text(this.parameterBaseType),
        text(this.parameterTypeName),
        text(this.potentialQualifiedName),
        bool(this.isAmbiguous),
        bool(this.isFinal),
        bool(this.isVarArgs),
        bool(this.isReceiverParameter),
        num(this.startLine),
        num(this.endLine),
        this.paramKind,
        bool(this.isOptional),
        bool(this.hasDefault),
        text(this.defaultValueText),
        this.defaultValueKind,
        bool(this.isParameterProperty),
        commaSet(this.parameterPropertyModifiers),
        this.declaredFieldLinkHash,
        text(this.bindingPatternText),
        this.bindingSourceKind,
        text(this.bindingSource),
        this.typeReferenceLinkHash,
        this.tsExpressionLinkHash,
        num(this.decoratorCount),
        num(this.startColumn),
        this.serviceVersionLinkHash,
        this.tsMethodParameterUniqueHash,
      ],
      TsMethodParameterRegistry.ARITY,
      'ts_method_parameter'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'paramName', 'position', 'tsMethodLinkHash', 'parameterBaseType', 'parameterTypeName',
        'potentialQualifiedName', 'isAmbiguous', 'isFinal', 'isVarArgs', 'isReceiverParameter',
        'startLine', 'endLine', 'paramKind', 'isOptional', 'hasDefault', 'defaultValueText',
        'defaultValueKind', 'isParameterProperty', 'parameterPropertyModifier',
        'declaredFieldLinkHash', 'bindingPatternText', 'bindingSourceKind', 'bindingSource', 'typeReferenceLinkHash',
        'tsExpressionLinkHash', 'decoratorCount', 'startColumn', 'serviceVersionLinkHash',
        'tsMethodParameterUniqueHash',
      ],
      TsMethodParameterRegistry.ARITY,
      'ts_method_parameter'
    );
  }
}
