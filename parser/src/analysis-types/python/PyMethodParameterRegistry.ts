import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { PythonDefaultValueKind, PythonParameterKind } from '@/enums/python/methods';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents one parameter of a `def`, `async def`, or `lambda`.
 *
 * Positions 0–11 mirror `java_method_parameter` 0–11, with the hash moved to the
 * end.
 *
 * This relation is the **primary typing mechanism** for Python, not a secondary
 * one. 68.2% of parameters carry no annotation (30,745 of 45,092 measured), so
 * declared-type receiver typing — Java's main lever — covers under a third of
 * the language. Types arrive instead by flowing arguments into parameters, which
 * requires knowing each parameter's kind and position exactly.
 *
 * ## Examples
 *
 * ```python
 * def f(self, a, /, b=1, *args, c, **kwargs): ...
 * #     ^0    ^1    ^2    ^3     ^4  ^5
 * #     receiver    POSITIONAL_OR_KEYWORD, hasDefault=True
 * #           POSITIONAL_ONLY
 * #                       VAR_POSITIONAL
 * #                              KEYWORD_ONLY
 * #                                  VAR_KEYWORD
 *
 * def g(items=[]): ...   # isMutableDefault=True — one list shared by all calls
 * def h(x: "Node"): ...  # annotationIsString=True — a forward reference
 * ```
 *
 * The bare `/` and `*` markers get rows with an empty `paramName`, because they
 * occupy a position in the signature and shift the meaning of every parameter
 * after them.
 *
 * ## Column order (frozen — schema v6 §2.8, 22 columns)
 *
 * **PK** `PY_METHOD_PARAMETER_md5(pyMethodLinkHash ‖ position ‖ paramName ‖ paramKind)`
 */
export class PyMethodParameterRegistry implements EntityIdentifiable {
  private paramName: string;
  private position: number;
  private pyMethodLinkHash: string;
  private parameterBaseType: string;
  private parameterTypeName: string;
  private potentialQualifiedName: string;
  private isAmbiguous: boolean;
  private isFinal: boolean;
  private isVarArgs: boolean;
  private isReceiverParameter: boolean;
  private startLine: number;
  private endLine: number;
  private paramKind: PythonParameterKind;
  private hasDefault: boolean;
  private defaultValueText: string;
  private defaultValueKind: PythonDefaultValueKind;
  private isMutableDefault: boolean;
  private annotationIsString: boolean;
  private bindingLinkHash: string;
  private pyExpressionLinkHash: string;
  private serviceVersionLinkHash: string;
  private pyMethodParameterUniqueHash: string = '';

  private constructor(builder: PyMethodParameterRegistryBuilder) {
    this.paramName = builder.paramName;
    this.position = builder.position;
    this.pyMethodLinkHash = builder.pyMethodLinkHash;
    this.parameterBaseType = builder.parameterBaseType;
    this.parameterTypeName = builder.parameterTypeName;
    this.potentialQualifiedName = builder.potentialQualifiedName;
    this.isAmbiguous = builder.isAmbiguous;
    this.isFinal = builder.isFinal;
    this.isVarArgs = builder.isVarArgs;
    this.isReceiverParameter = builder.isReceiverParameter;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.paramKind = builder.paramKind;
    this.hasDefault = builder.hasDefault;
    this.defaultValueText = builder.defaultValueText;
    this.defaultValueKind = builder.defaultValueKind;
    this.isMutableDefault = builder.isMutableDefault;
    this.annotationIsString = builder.annotationIsString;
    this.bindingLinkHash = builder.bindingLinkHash;
    this.pyExpressionLinkHash = builder.pyExpressionLinkHash;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    paramName: string,
    position: number,
    pyMethodLinkHash: string,
    paramKind: PythonParameterKind,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ): PyMethodParameterRegistryBuilder {
    return new PyMethodParameterRegistryBuilder(
      paramName,
      position,
      pyMethodLinkHash,
      paramKind,
      startLine,
      endLine,
      serviceVersionLinkHash
    );
  }

  getParamName(): string {
    return this.paramName;
  }

  getPosition(): number {
    return this.position;
  }

  getParamKind(): PythonParameterKind {
    return this.paramKind;
  }

  getPyMethodLinkHash(): string {
    return this.pyMethodLinkHash;
  }

  getParameterTypeName(): string {
    return this.parameterTypeName;
  }

  getIsReceiverParameter(): boolean {
    return this.isReceiverParameter;
  }

  getIsMutableDefault(): boolean {
    return this.isMutableDefault;
  }

  /** Back-patches the FK to this parameter's binding in the function scope. */
  setBindingLinkHash(bindingLinkHash: string): void {
    this.bindingLinkHash = bindingLinkHash;
  }

  /**
   * Back-patches the FK to the default value's expression root.
   *
   * The parameter row is minted by the declaration stage and the default's
   * expression tree by the expression stage, so the two are joined afterwards on
   * the default's byte range.
   */
  setPyExpressionLinkHash(pyExpressionLinkHash: string): void {
    this.pyExpressionLinkHash = pyExpressionLinkHash;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getPyMethodParameterUniqueHash(): string {
    return this.pyMethodParameterUniqueHash;
  }

  getHash(): string {
    return this.pyMethodParameterUniqueHash;
  }

  generateHash(): void {
    const content =
      this.pyMethodLinkHash +
      '||' +
      this.position +
      '||' +
      this.paramName +
      '||' +
      this.paramKind;

    this.pyMethodParameterUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_METHOD_PARAMETER,
      content
    );
  }

  getEntryCombined(): string {
    return `py_method_parameter[name=${this.paramName || '<marker>'}, position=${this.position}, kind=${this.paramKind}, type=${this.parameterTypeName || '-'}, hash=${this.pyMethodParameterUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.paramName,
      this.position.toString(),
      this.pyMethodLinkHash,
      EntityUtils.escapeTsv(this.parameterBaseType),
      EntityUtils.escapeTsv(this.parameterTypeName),
      EntityUtils.escapeTsv(this.potentialQualifiedName),
      this.isAmbiguous.toString(),
      this.isFinal.toString(),
      this.isVarArgs.toString(),
      this.isReceiverParameter.toString(),
      this.startLine.toString(),
      this.endLine.toString(),
      this.paramKind,
      this.hasDefault.toString(),
      EntityUtils.escapeTsv(this.defaultValueText),
      this.defaultValueKind,
      this.isMutableDefault.toString(),
      this.annotationIsString.toString(),
      this.bindingLinkHash,
      this.pyExpressionLinkHash,
      this.serviceVersionLinkHash,
      this.pyMethodParameterUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'paramName',
      'position',
      'pyMethodLinkHash',
      'parameterBaseType',
      'parameterTypeName',
      'potentialQualifiedName',
      'isAmbiguous',
      'isFinal',
      'isVarArgs',
      'isReceiverParameter',
      'startLine',
      'endLine',
      'paramKind',
      'hasDefault',
      'defaultValueText',
      'defaultValueKind',
      'isMutableDefault',
      'annotationIsString',
      'bindingLinkHash',
      'pyExpressionLinkHash',
      'serviceVersionLinkHash',
      'pyMethodParameterUniqueHash',
    ].join('\t');
  }
}

/** Builder for PyMethodParameterRegistry. `isFinal` is a parity slot, always false. */
export class PyMethodParameterRegistryBuilder {
  paramName: string;
  position: number;
  pyMethodLinkHash: string;
  parameterBaseType: string = '';
  parameterTypeName: string = '';
  potentialQualifiedName: string = '';
  isAmbiguous: boolean = false;
  readonly isFinal: boolean = false;
  isVarArgs: boolean = false;
  isReceiverParameter: boolean = false;
  startLine: number;
  endLine: number;
  paramKind: PythonParameterKind;
  hasDefault: boolean = false;
  defaultValueText: string = '';
  defaultValueKind: PythonDefaultValueKind = PythonDefaultValueKind.NONE;
  isMutableDefault: boolean = false;
  annotationIsString: boolean = false;
  bindingLinkHash: string = '';
  pyExpressionLinkHash: string = '';
  serviceVersionLinkHash: string;

  constructor(
    paramName: string,
    position: number,
    pyMethodLinkHash: string,
    paramKind: PythonParameterKind,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ) {
    if (!pyMethodLinkHash || pyMethodLinkHash.trim().length === 0) {
      throw new Error('pyMethodLinkHash is required');
    }
    if (!serviceVersionLinkHash || serviceVersionLinkHash.trim().length === 0) {
      throw new Error('serviceVersionLinkHash is required');
    }
    if (position < 0) {
      throw new Error('position must be >= 0');
    }

    this.paramName = paramName;
    this.position = position;
    this.pyMethodLinkHash = pyMethodLinkHash;
    this.paramKind = paramKind;
    this.startLine = startLine;
    this.endLine = endLine;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
    this.isVarArgs = paramKind === PythonParameterKind.VAR_POSITIONAL;
  }

  withAnnotation(
    parameterTypeName: string,
    parameterBaseType: string,
    annotationIsString: boolean
  ): this {
    this.parameterTypeName = parameterTypeName;
    this.parameterBaseType = parameterBaseType;
    this.annotationIsString = annotationIsString;
    return this;
  }

  withPotentialQualifiedName(potentialQualifiedName: string, isAmbiguous: boolean): this {
    this.potentialQualifiedName = potentialQualifiedName;
    this.isAmbiguous = isAmbiguous;
    return this;
  }

  withIsReceiverParameter(isReceiverParameter: boolean): this {
    this.isReceiverParameter = isReceiverParameter;
    return this;
  }

  /**
   * Records the default value.
   *
   * `isMutableDefault` is derived here rather than trusted from a caller,
   * because the whole point is that it is a mechanical property of the default's
   * shape: a list, dict, set or call default is evaluated **once**, at definition
   * time, and shared by every call.
   */
  withDefault(defaultValueText: string, defaultValueKind: PythonDefaultValueKind): this {
    this.hasDefault = true;
    this.defaultValueText = defaultValueText;
    this.defaultValueKind = defaultValueKind;
    this.isMutableDefault =
      defaultValueKind === PythonDefaultValueKind.LIST ||
      defaultValueKind === PythonDefaultValueKind.DICT ||
      defaultValueKind === PythonDefaultValueKind.SET ||
      defaultValueKind === PythonDefaultValueKind.CALL;
    return this;
  }

  withBindingLinkHash(bindingLinkHash: string): this {
    this.bindingLinkHash = bindingLinkHash;
    return this;
  }

  withPyExpressionLinkHash(pyExpressionLinkHash: string): this {
    this.pyExpressionLinkHash = pyExpressionLinkHash;
    return this;
  }

  build(): PyMethodParameterRegistry {
    return new (PyMethodParameterRegistry as unknown as {
      new (builder: PyMethodParameterRegistryBuilder): PyMethodParameterRegistry;
    })(this);
  }
}
