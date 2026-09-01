import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  PythonMethodAccess,
  PythonMethodKind,
  PythonMethodModifier,
} from '@/enums/python/methods';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a `def`, `async def`, `lambda`, or one of the two synthetic
 * initializers.
 *
 * **Positions 0–20 are byte-for-byte `java_method` 0–20**, so `method_decl`,
 * `method_owner` and `method_kind` port as literal renames.
 *
 * ## Examples
 *
 * ```python
 * def get_user(self, user_id): ...    # signature = "get_user(self, user_id)"
 * async def fetch(url): ...          # ASYNC modifier, ASYNC_FUNCTION kind
 * def gen(): yield 1                 # GENERATOR modifier, isGenerator=true
 * f = lambda x: x                    # name = <lambda>
 * @overload
 * def g(x: int) -> int: ...          # bodyIsStub=true — NEVER a call target
 * ```
 *
 * ## The two synthetic methods
 *
 * `ownership.dl`'s `expr_ultimate_method` requires every expression to reach a
 * method, or call attribution fails. Python allows code outside any function —
 * 3,006 executable module-level statements across 826 measured files — so a
 * synthetic `<module>` method (`MODULE_INITIALIZER`) and a `<classbody>` method
 * (`CLASS_INITIALIZER`) are minted per module and per class. Every module-level
 * block, expression and call site takes one as owner, which is why
 * `py_call_site.pyMethodLinkHash` is **never** empty. This mirrors what the Java
 * parser already does with `<clinit>` / `<init>`, so the entire call-chain layer
 * works with zero new rules.
 *
 * ## Why the key needs both `startLine` and `startColumn`
 *
 * `__qualname__` alone is not unique: `@overload` stubs repeat name and
 * signature, and `if X: def f() else: def f()` redefines it. `startColumn` is
 * needed on top of that because of lambdas — `g = (lambda: 1, lambda: 2)`
 * produces two rows whose qualifiedName, signature and startLine are all
 * identical, and the previous key merged them into one. Two `def`s cannot share
 * a line, so this is a lambda-only hazard, but lambdas are 369 rows in the
 * corpus and the failure is silent.
 *
 * ## Column order (frozen — schema v6 §2.7, 36 columns)
 *
 * **PK** `PY_METHOD_md5(pyModuleLinkHash ‖ pyTypeLinkHash ‖ qualifiedName ‖ signature ‖ startLine ‖ startColumn)`
 */
export class PyMethodRegistry implements EntityIdentifiable {
  private name: string;
  private signature: string;
  private detailedSignature: string;
  private qualifiedName: string;
  private filePath: string;
  private startLine: number;
  private endLine: number;
  private pyTypeLinkHash: string;
  private ownerTypeName: string;
  private ownerQualifiedName: string;
  private methodAccess: PythonMethodAccess;
  private modifiers: Set<PythonMethodModifier>;
  private returnTypeName: string;
  private isVarArgs: boolean;
  private hasReceiverParameter: boolean;
  private defaultValueExpression: string;
  private methodKind: PythonMethodKind;
  private parameterCount: number;
  private hasTypeParameters: boolean;
  private throwsExceptions: string[];
  private enclosingMemberLinkHash: string;
  private pyModuleLinkHash: string;
  private scopeLinkHash: string;
  private declaringBindingLinkHash: string;
  private posOnlyCount: number;
  private kwOnlyCount: number;
  private hasKwArgs: boolean;
  private isArgsKwargsPassthrough: boolean;
  private isAsync: boolean;
  private isGenerator: boolean;
  private decoratorCount: number;
  private bodyIsStub: boolean;
  private startColumn: number;
  private endColumn: number;
  private serviceVersionLinkHash: string;
  private pyMethodUniqueHash: string = '';

  private constructor(builder: PyMethodRegistryBuilder) {
    this.name = builder.name;
    this.signature = builder.signature;
    this.detailedSignature = builder.detailedSignature;
    this.qualifiedName = builder.qualifiedName;
    this.filePath = builder.filePath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.pyTypeLinkHash = builder.pyTypeLinkHash;
    this.ownerTypeName = builder.ownerTypeName;
    this.ownerQualifiedName = builder.ownerQualifiedName;
    this.methodAccess = builder.methodAccess;
    this.modifiers = builder.modifiers;
    this.returnTypeName = builder.returnTypeName;
    this.isVarArgs = builder.isVarArgs;
    this.hasReceiverParameter = builder.hasReceiverParameter;
    this.defaultValueExpression = builder.defaultValueExpression;
    this.methodKind = builder.methodKind;
    this.parameterCount = builder.parameterCount;
    this.hasTypeParameters = builder.hasTypeParameters;
    this.throwsExceptions = builder.throwsExceptions;
    this.enclosingMemberLinkHash = builder.enclosingMemberLinkHash;
    this.pyModuleLinkHash = builder.pyModuleLinkHash;
    this.scopeLinkHash = builder.scopeLinkHash;
    this.declaringBindingLinkHash = builder.declaringBindingLinkHash;
    this.posOnlyCount = builder.posOnlyCount;
    this.kwOnlyCount = builder.kwOnlyCount;
    this.hasKwArgs = builder.hasKwArgs;
    this.isArgsKwargsPassthrough = builder.isArgsKwargsPassthrough;
    this.isAsync = builder.isAsync;
    this.isGenerator = builder.isGenerator;
    this.decoratorCount = builder.decoratorCount;
    this.bodyIsStub = builder.bodyIsStub;
    this.startColumn = builder.startColumn;
    this.endColumn = builder.endColumn;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    name: string,
    signature: string,
    qualifiedName: string,
    filePath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    pyModuleLinkHash: string,
    serviceVersionLinkHash: string
  ): PyMethodRegistryBuilder {
    return new PyMethodRegistryBuilder(
      name,
      signature,
      qualifiedName,
      filePath,
      startLine,
      endLine,
      startColumn,
      pyModuleLinkHash,
      serviceVersionLinkHash
    );
  }

  getName(): string {
    return this.name;
  }

  /** The `-> T` annotation text, or `''`. */
  getReturnTypeName(): string {
    return this.returnTypeName;
  }

  getSignature(): string {
    return this.signature;
  }

  getQualifiedName(): string {
    return this.qualifiedName;
  }

  getMethodKind(): PythonMethodKind {
    return this.methodKind;
  }

  getPyTypeLinkHash(): string {
    return this.pyTypeLinkHash;
  }

  getPyModuleLinkHash(): string {
    return this.pyModuleLinkHash;
  }

  getScopeLinkHash(): string {
    return this.scopeLinkHash;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getParameterCount(): number {
    return this.parameterCount;
  }

  getModifiers(): Set<PythonMethodModifier> {
    return this.modifiers;
  }

  /** Comma-separated modifiers for CSV output; `''` when none. */
  getMethodModifier(): string {
    if (this.modifiers.size === 0) {
      return '';
    }
    return Array.from(this.modifiers).join(',');
  }

  /**
   * Comma-set of `raise X` type names found in the body.
   *
   * **Inferred, not declared** — Python has no `throws` clause, so this is a
   * body scan and is honestly incomplete: it cannot see exceptions raised by
   * callees. It is useful as a lower bound, never as a guarantee.
   */
  getThrowsExceptionsValue(): string {
    return this.throwsExceptions.join(',');
  }

  getBodyIsStub(): boolean {
    return this.bodyIsStub;
  }

  getDeclaringBindingLinkHash(): string {
    return this.declaringBindingLinkHash;
  }

  getEnclosingMemberLinkHash(): string {
    return this.enclosingMemberLinkHash;
  }

  /**
   * Whether this is a member of its class BODY, as opposed to a function nested
   * inside one of its methods.
   *
   * A nested `def` carries the enclosing class in `pyTypeLinkHash`, so a naive
   * "methods of this type" lookup would offer `run.<locals>.inner` as a
   * candidate for `self.inner()` — a target that is not reachable that way.
   */
  isClassBodyMember(): boolean {
    return this.pyTypeLinkHash !== '' && this.enclosingMemberLinkHash === '';
  }

  getScopeLinkHashValue(): string {
    return this.scopeLinkHash;
  }

  /** Back-patches the FK to the binding this def creates; `''` for lambdas. */
  setDeclaringBindingLinkHash(declaringBindingLinkHash: string): void {
    this.declaringBindingLinkHash = declaringBindingLinkHash;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getPyMethodUniqueHash(): string {
    return this.pyMethodUniqueHash;
  }

  getHash(): string {
    return this.pyMethodUniqueHash;
  }

  generateHash(): void {
    const content =
      this.pyModuleLinkHash +
      '||' +
      this.pyTypeLinkHash +
      '||' +
      this.qualifiedName +
      '||' +
      this.signature +
      '||' +
      this.startLine +
      '||' +
      this.startColumn;

    this.pyMethodUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_METHOD,
      content
    );
  }

  getEntryCombined(): string {
    return `py_method[name=${this.name}, signature=${this.signature}, kind=${this.methodKind}, owner=${this.ownerTypeName || '<module>'}, line ${this.startLine}:${this.startColumn}, hash=${this.pyMethodUniqueHash}]`;
  }

  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.name),
      EntityUtils.escapeTsv(this.signature),
      EntityUtils.escapeTsv(this.detailedSignature),
      EntityUtils.escapeTsv(this.qualifiedName),
      EntityUtils.escapeTsv(this.filePath),
      this.startLine.toString(),
      this.endLine.toString(),
      this.pyTypeLinkHash,
      EntityUtils.escapeTsv(this.ownerTypeName),
      EntityUtils.escapeTsv(this.ownerQualifiedName),
      this.methodAccess,
      this.getMethodModifier(),
      EntityUtils.escapeTsv(this.returnTypeName),
      this.isVarArgs.toString(),
      this.hasReceiverParameter.toString(),
      EntityUtils.escapeTsv(this.defaultValueExpression),
      this.methodKind,
      this.parameterCount.toString(),
      this.hasTypeParameters.toString(),
      EntityUtils.escapeTsv(this.getThrowsExceptionsValue()),
      this.enclosingMemberLinkHash,
      this.pyModuleLinkHash,
      this.scopeLinkHash,
      this.declaringBindingLinkHash,
      this.posOnlyCount.toString(),
      this.kwOnlyCount.toString(),
      this.hasKwArgs.toString(),
      this.isArgsKwargsPassthrough.toString(),
      this.isAsync.toString(),
      this.isGenerator.toString(),
      this.decoratorCount.toString(),
      this.bodyIsStub.toString(),
      this.startColumn.toString(),
      this.endColumn.toString(),
      this.serviceVersionLinkHash,
      this.pyMethodUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'name',
      'signature',
      'detailedSignature',
      'qualifiedName',
      'filePath',
      'startLine',
      'endLine',
      'pyTypeLinkHash',
      'ownerTypeName',
      'ownerQualifiedName',
      'methodAccess',
      'methodModifier',
      'returnTypeName',
      'isVarArgs',
      'hasReceiverParameter',
      'defaultValueExpression',
      'methodKind',
      'parameterCount',
      'hasTypeParameters',
      'throwsExceptions',
      'enclosingMemberLinkHash',
      'pyModuleLinkHash',
      'scopeLinkHash',
      'declaringBindingLinkHash',
      'posOnlyCount',
      'kwOnlyCount',
      'hasKwArgs',
      'isArgsKwargsPassthrough',
      'isAsync',
      'isGenerator',
      'decoratorCount',
      'bodyIsStub',
      'startColumn',
      'endColumn',
      'serviceVersionLinkHash',
      'pyMethodUniqueHash',
    ].join('\t');
  }
}

/**
 * Builder for PyMethodRegistry.
 *
 * `defaultValueExpression` and `hasTypeParameters` are parity slots: the former
 * is unused in Python (defaults live on the parameter, not the method), the
 * latter stays false until PEP 695 is un-deferred.
 */
export class PyMethodRegistryBuilder {
  name: string;
  signature: string;
  detailedSignature: string = '';
  qualifiedName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  pyTypeLinkHash: string = '';
  ownerTypeName: string = '';
  ownerQualifiedName: string = '';
  methodAccess: PythonMethodAccess = PythonMethodAccess.PUBLIC_ACCESS;
  modifiers: Set<PythonMethodModifier> = new Set();
  returnTypeName: string = '';
  isVarArgs: boolean = false;
  hasReceiverParameter: boolean = false;
  readonly defaultValueExpression: string = '';
  methodKind: PythonMethodKind = PythonMethodKind.FUNCTION;
  parameterCount: number = 0;
  hasTypeParameters: boolean = false;
  throwsExceptions: string[] = [];
  enclosingMemberLinkHash: string = '';
  pyModuleLinkHash: string;
  scopeLinkHash: string = '';
  declaringBindingLinkHash: string = '';
  posOnlyCount: number = 0;
  kwOnlyCount: number = 0;
  hasKwArgs: boolean = false;
  isArgsKwargsPassthrough: boolean = false;
  isAsync: boolean = false;
  isGenerator: boolean = false;
  decoratorCount: number = 0;
  bodyIsStub: boolean = false;
  startColumn: number;
  endColumn: number = 0;
  serviceVersionLinkHash: string;

  constructor(
    name: string,
    signature: string,
    qualifiedName: string,
    filePath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    pyModuleLinkHash: string,
    serviceVersionLinkHash: string
  ) {
    if (!name || name.trim().length === 0) {
      throw new Error('name is required');
    }
    if (!pyModuleLinkHash || pyModuleLinkHash.trim().length === 0) {
      throw new Error('pyModuleLinkHash is required');
    }
    if (!serviceVersionLinkHash || serviceVersionLinkHash.trim().length === 0) {
      throw new Error('serviceVersionLinkHash is required');
    }
    if (startLine < 0) {
      throw new Error('startLine must be >= 0');
    }
    if (endLine < startLine) {
      throw new Error('endLine must be >= startLine');
    }

    this.name = name;
    this.signature = signature;
    this.qualifiedName = qualifiedName;
    this.filePath = filePath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.startColumn = startColumn;
    this.pyModuleLinkHash = pyModuleLinkHash;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withDetailedSignature(detailedSignature: string): this {
    this.detailedSignature = detailedSignature;
    return this;
  }

  withOwner(
    pyTypeLinkHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string
  ): this {
    this.pyTypeLinkHash = pyTypeLinkHash;
    this.ownerTypeName = ownerTypeName;
    this.ownerQualifiedName = ownerQualifiedName;
    return this;
  }

  withKindAndAccess(
    methodKind: PythonMethodKind,
    methodAccess: PythonMethodAccess
  ): this {
    this.methodKind = methodKind;
    this.methodAccess = methodAccess;
    return this;
  }

  withModifiers(modifiers: PythonMethodModifier[]): this {
    modifiers.forEach(m => this.modifiers.add(m));
    return this;
  }

  withReturnTypeName(returnTypeName: string): this {
    this.returnTypeName = returnTypeName;
    return this;
  }

  /**
   * Records the parameter shape.
   *
   * `isArgsKwargsPassthrough` marks a function taking **both** `*args` and
   * `**kwargs` — 2.8% of functions. It exists because positional
   * argument→parameter flow is *provably* unsound there, so the engine can
   * report the imprecision instead of inventing an answer.
   */
  withParameterShape(shape: {
    parameterCount: number;
    posOnlyCount: number;
    kwOnlyCount: number;
    isVarArgs: boolean;
    hasKwArgs: boolean;
    hasReceiverParameter: boolean;
  }): this {
    this.parameterCount = shape.parameterCount;
    this.posOnlyCount = shape.posOnlyCount;
    this.kwOnlyCount = shape.kwOnlyCount;
    this.isVarArgs = shape.isVarArgs;
    this.hasKwArgs = shape.hasKwArgs;
    this.hasReceiverParameter = shape.hasReceiverParameter;
    this.isArgsKwargsPassthrough = shape.isVarArgs && shape.hasKwArgs;
    return this;
  }

  withBodyFlags(flags: {
    isAsync?: boolean;
    isGenerator?: boolean;
    bodyIsStub?: boolean;
    decoratorCount?: number;
  }): this {
    this.isAsync = flags.isAsync ?? this.isAsync;
    this.isGenerator = flags.isGenerator ?? this.isGenerator;
    this.bodyIsStub = flags.bodyIsStub ?? this.bodyIsStub;
    this.decoratorCount = flags.decoratorCount ?? this.decoratorCount;
    return this;
  }

  withThrowsExceptions(throwsExceptions: string[]): this {
    this.throwsExceptions = throwsExceptions;
    return this;
  }

  withScopeLinkHash(scopeLinkHash: string): this {
    this.scopeLinkHash = scopeLinkHash;
    return this;
  }

  withEnclosingMemberLinkHash(enclosingMemberLinkHash: string): this {
    this.enclosingMemberLinkHash = enclosingMemberLinkHash;
    return this;
  }

  withEndColumn(endColumn: number): this {
    this.endColumn = endColumn;
    return this;
  }

  build(): PyMethodRegistry {
    return new (PyMethodRegistry as unknown as {
      new (builder: PyMethodRegistryBuilder): PyMethodRegistry;
    })(this);
  }
}
