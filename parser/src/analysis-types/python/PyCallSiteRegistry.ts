import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  PythonCallKind,
  PythonReceiverKind,
  PythonResolvedCalleeKind,
} from '@/enums/python/call-sites';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents one call site, 1:1 with its `CALL` expression.
 *
 * In Java this relation is *derived* in `call-site.dl`. For Python it is a
 * **base** relation, because the call shape is not recoverable from one
 * positional pattern: keyword arguments, `*`/`**` spreading, chained receivers,
 * `super()`, and — the point — the receiver's syntactic shape, which is all we
 * honestly know about a duck-typed receiver.
 *
 * ## Imprecision is recorded, not hidden
 *
 * `argFlowIsPrecise` is false whenever `*args` or `**kwargs` appear at the call
 * site, because positional argument→parameter flow is **provably** unsound
 * there. Making that a fact lets the engine report "unresolvable by
 * construction" instead of silently emitting a wrong edge — which is the whole
 * discipline this schema is organised around, given that naive name-based
 * dispatch yields 24.63 candidate classes per attribute call.
 *
 * ## Examples
 *
 * ```python
 * helper(1)                  # SIMPLE_CALL,  receiverKind=NONE
 * self.save(x)               # SELF_CALL,    receiverKind=SELF
 * super().save(x)            # SUPER_CALL,   receiverKind=SUPER
 * self.repo.get(k)           # METHOD_CALL,  receiverKind=ATTRIBUTE
 * factory().build()          # CHAINED_CALL, receiverKind=CALL_RESULT
 * f(*args, **kwargs)         # argFlowIsPrecise=false
 * ```
 *
 * `pyMethodLinkHash` is **never empty**: a module-level call is owned by the
 * synthetic `<module>` initializer, which is what keeps `expr_ultimate_method`
 * total.
 *
 * ## Column order (frozen — schema v6 §2.16, 26 columns)
 *
 * **PK** `PY_CALL_SITE_md5(pyExpressionLinkHash)` — a pure chain off the parent
 * expression, since the relationship is 1:1.
 */
export class PyCallSiteRegistry implements EntityIdentifiable {
  private callKind: PythonCallKind;
  private calleeName: string;
  private calleeDottedPath: string;
  private receiverText: string;
  private receiverKind: PythonReceiverKind;
  private pyExpressionLinkHash: string;
  private receiverExpressionLinkHash: string;
  private pyScopeLinkHash: string;
  private pyMethodLinkHash: string;
  private pyTypeLinkHash: string;
  private pyModuleLinkHash: string;
  private positionalArgCount: number;
  private keywordArgCount: number;
  private hasStarArgs: boolean;
  private hasDoubleStarArgs: boolean;
  private keywordNames: string[];
  private argFlowIsPrecise: boolean;
  private resolvedCalleeKind: PythonResolvedCalleeKind;
  private resolvedCalleeHash: string;
  private isModuleLevelCall: boolean;
  private isConditional: boolean;
  private startLine: number;
  private startColumn: number;
  private endLine: number;
  private serviceVersionLinkHash: string;
  private pyCallSiteUniqueHash: string = '';

  private constructor(builder: PyCallSiteRegistryBuilder) {
    this.callKind = builder.callKind;
    this.calleeName = builder.calleeName;
    this.calleeDottedPath = builder.calleeDottedPath;
    this.receiverText = builder.receiverText;
    this.receiverKind = builder.receiverKind;
    this.pyExpressionLinkHash = builder.pyExpressionLinkHash;
    this.receiverExpressionLinkHash = builder.receiverExpressionLinkHash;
    this.pyScopeLinkHash = builder.pyScopeLinkHash;
    this.pyMethodLinkHash = builder.pyMethodLinkHash;
    this.pyTypeLinkHash = builder.pyTypeLinkHash;
    this.pyModuleLinkHash = builder.pyModuleLinkHash;
    this.positionalArgCount = builder.positionalArgCount;
    this.keywordArgCount = builder.keywordArgCount;
    this.hasStarArgs = builder.hasStarArgs;
    this.hasDoubleStarArgs = builder.hasDoubleStarArgs;
    this.keywordNames = builder.keywordNames;
    // Derived, never trusted from a caller: the whole point is that it is a
    // mechanical consequence of the call's shape.
    this.argFlowIsPrecise = !builder.hasStarArgs && !builder.hasDoubleStarArgs;
    this.resolvedCalleeKind = builder.resolvedCalleeKind;
    this.resolvedCalleeHash = builder.resolvedCalleeHash;
    this.isModuleLevelCall = builder.isModuleLevelCall;
    this.isConditional = builder.isConditional;
    this.startLine = builder.startLine;
    this.startColumn = builder.startColumn;
    this.endLine = builder.endLine;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    callKind: PythonCallKind,
    calleeName: string,
    pyExpressionLinkHash: string,
    pyScopeLinkHash: string,
    pyMethodLinkHash: string,
    pyModuleLinkHash: string,
    serviceVersionLinkHash: string
  ): PyCallSiteRegistryBuilder {
    return new PyCallSiteRegistryBuilder(
      callKind,
      calleeName,
      pyExpressionLinkHash,
      pyScopeLinkHash,
      pyMethodLinkHash,
      pyModuleLinkHash,
      serviceVersionLinkHash
    );
  }

  getCallKind(): PythonCallKind {
    return this.callKind;
  }

  getCalleeName(): string {
    return this.calleeName;
  }

  getCalleeDottedPath(): string {
    return this.calleeDottedPath;
  }

  getReceiverKind(): PythonReceiverKind {
    return this.receiverKind;
  }

  getReceiverText(): string {
    return this.receiverText;
  }

  getPyExpressionLinkHash(): string {
    return this.pyExpressionLinkHash;
  }

  getPyMethodLinkHash(): string {
    return this.pyMethodLinkHash;
  }

  getPositionalArgCount(): number {
    return this.positionalArgCount;
  }

  getKeywordArgCount(): number {
    return this.keywordArgCount;
  }

  getArgFlowIsPrecise(): boolean {
    return this.argFlowIsPrecise;
  }

  /** Comma-set of keyword argument names, in source order. */
  getKeywordNamesValue(): string {
    return this.keywordNames.join(',');
  }

  getStartLine(): number {
    return this.startLine;
  }

  /** Back-patches parser-local callee resolution. */
  setResolvedCallee(
    resolvedCalleeKind: PythonResolvedCalleeKind,
    resolvedCalleeHash: string
  ): void {
    this.resolvedCalleeKind = resolvedCalleeKind;
    this.resolvedCalleeHash = resolvedCalleeHash;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getPyCallSiteUniqueHash(): string {
    return this.pyCallSiteUniqueHash;
  }

  getHash(): string {
    return this.pyCallSiteUniqueHash;
  }

  generateHash(): void {
    this.pyCallSiteUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_CALL_SITE,
      this.pyExpressionLinkHash
    );
  }

  getEntryCombined(): string {
    return `py_call_site[kind=${this.callKind}, callee=${this.calleeName}, receiver=${this.receiverKind}, args=${this.positionalArgCount}+${this.keywordArgCount}, precise=${this.argFlowIsPrecise}, hash=${this.pyCallSiteUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.callKind,
      this.calleeName,
      EntityUtils.escapeTsv(this.calleeDottedPath),
      EntityUtils.escapeTsv(this.receiverText),
      this.receiverKind,
      this.pyExpressionLinkHash,
      this.receiverExpressionLinkHash,
      this.pyScopeLinkHash,
      this.pyMethodLinkHash,
      this.pyTypeLinkHash,
      this.pyModuleLinkHash,
      this.positionalArgCount.toString(),
      this.keywordArgCount.toString(),
      this.hasStarArgs.toString(),
      this.hasDoubleStarArgs.toString(),
      EntityUtils.escapeTsv(this.getKeywordNamesValue()),
      this.argFlowIsPrecise.toString(),
      this.resolvedCalleeKind,
      this.resolvedCalleeHash,
      this.isModuleLevelCall.toString(),
      this.isConditional.toString(),
      this.startLine.toString(),
      this.startColumn.toString(),
      this.endLine.toString(),
      this.serviceVersionLinkHash,
      this.pyCallSiteUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'callKind',
      'calleeName',
      'calleeDottedPath',
      'receiverText',
      'receiverKind',
      'pyExpressionLinkHash',
      'receiverExpressionLinkHash',
      'pyScopeLinkHash',
      'pyMethodLinkHash',
      'pyTypeLinkHash',
      'pyModuleLinkHash',
      'positionalArgCount',
      'keywordArgCount',
      'hasStarArgs',
      'hasDoubleStarArgs',
      'keywordNames',
      'argFlowIsPrecise',
      'resolvedCalleeKind',
      'resolvedCalleeHash',
      'isModuleLevelCall',
      'isConditional',
      'startLine',
      'startColumn',
      'endLine',
      'serviceVersionLinkHash',
      'pyCallSiteUniqueHash',
    ].join('\t');
  }
}

/** Builder for PyCallSiteRegistry. */
export class PyCallSiteRegistryBuilder {
  callKind: PythonCallKind;
  calleeName: string;
  calleeDottedPath: string = '';
  receiverText: string = '';
  receiverKind: PythonReceiverKind = PythonReceiverKind.NONE;
  pyExpressionLinkHash: string;
  receiverExpressionLinkHash: string = '';
  pyScopeLinkHash: string;
  pyMethodLinkHash: string;
  pyTypeLinkHash: string = '';
  pyModuleLinkHash: string;
  positionalArgCount: number = 0;
  keywordArgCount: number = 0;
  hasStarArgs: boolean = false;
  hasDoubleStarArgs: boolean = false;
  keywordNames: string[] = [];
  resolvedCalleeKind: PythonResolvedCalleeKind = PythonResolvedCalleeKind.UNRESOLVED;
  resolvedCalleeHash: string = '';
  isModuleLevelCall: boolean = false;
  isConditional: boolean = false;
  startLine: number = 0;
  startColumn: number = 0;
  endLine: number = 0;
  serviceVersionLinkHash: string;

  constructor(
    callKind: PythonCallKind,
    calleeName: string,
    pyExpressionLinkHash: string,
    pyScopeLinkHash: string,
    pyMethodLinkHash: string,
    pyModuleLinkHash: string,
    serviceVersionLinkHash: string
  ) {
    if (!pyExpressionLinkHash || pyExpressionLinkHash.trim().length === 0) {
      throw new Error('pyExpressionLinkHash is required');
    }
    if (!pyMethodLinkHash || pyMethodLinkHash.trim().length === 0) {
      // Never empty by construction: module-level calls belong to `<module>`.
      throw new Error('pyMethodLinkHash is required (module-level calls use <module>)');
    }
    if (!serviceVersionLinkHash || serviceVersionLinkHash.trim().length === 0) {
      throw new Error('serviceVersionLinkHash is required');
    }

    this.callKind = callKind;
    this.calleeName = calleeName;
    this.pyExpressionLinkHash = pyExpressionLinkHash;
    this.pyScopeLinkHash = pyScopeLinkHash;
    this.pyMethodLinkHash = pyMethodLinkHash;
    this.pyModuleLinkHash = pyModuleLinkHash;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withCallee(calleeDottedPath: string): this {
    this.calleeDottedPath = calleeDottedPath;
    return this;
  }

  withReceiver(
    receiverKind: PythonReceiverKind,
    receiverText: string,
    receiverExpressionLinkHash: string
  ): this {
    this.receiverKind = receiverKind;
    this.receiverText = receiverText;
    this.receiverExpressionLinkHash = receiverExpressionLinkHash;
    return this;
  }

  withPyTypeLinkHash(pyTypeLinkHash: string): this {
    this.pyTypeLinkHash = pyTypeLinkHash;
    return this;
  }

  withArguments(args: {
    positionalArgCount: number;
    keywordArgCount: number;
    hasStarArgs: boolean;
    hasDoubleStarArgs: boolean;
    keywordNames: string[];
  }): this {
    this.positionalArgCount = args.positionalArgCount;
    this.keywordArgCount = args.keywordArgCount;
    this.hasStarArgs = args.hasStarArgs;
    this.hasDoubleStarArgs = args.hasDoubleStarArgs;
    this.keywordNames = args.keywordNames;
    return this;
  }

  withFlags(flags: { isModuleLevelCall?: boolean; isConditional?: boolean }): this {
    this.isModuleLevelCall = flags.isModuleLevelCall ?? this.isModuleLevelCall;
    this.isConditional = flags.isConditional ?? this.isConditional;
    return this;
  }

  withSpan(startLine: number, startColumn: number, endLine: number): this {
    this.startLine = startLine;
    this.startColumn = startColumn;
    this.endLine = endLine;
    return this;
  }

  withResolvedCallee(
    resolvedCalleeKind: PythonResolvedCalleeKind,
    resolvedCalleeHash: string
  ): this {
    this.resolvedCalleeKind = resolvedCalleeKind;
    this.resolvedCalleeHash = resolvedCalleeHash;
    return this;
  }

  build(): PyCallSiteRegistry {
    return new (PyCallSiteRegistry as unknown as {
      new (builder: PyCallSiteRegistryBuilder): PyCallSiteRegistry;
    })(this);
  }
}
