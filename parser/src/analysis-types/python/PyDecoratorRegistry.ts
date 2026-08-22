import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  PythonBuiltinDecoratorKind,
  PythonDecoratorContext,
  PythonDecoratorKind,
} from '@/enums/python/decorators';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One decorator application.
 *
 * This is Python's `java_annotation`: positions 0–3 mirror it, and both project
 * to a shared `annotation_on`. The names differ because §1.1 says the fact layer
 * follows the language, but the shape and the projection are Java's.
 *
 * Where it diverges is semantics, and the divergence is the reason the relation
 * matters. A Java annotation is metadata; a Python decorator is a FUNCTION CALL
 * that replaces the thing it decorates. Two columns carry that:
 *
 * - `applicationOrder` — decorators execute BOTTOM-UP, so the source order a
 *   reader sees is the reverse of the order that runs. `position` records what
 *   is written and `applicationOrder` what happens, because a rule about which
 *   decorator wins needs the second.
 * - `replacesTarget` — `@lru_cache` returns a wrapper, so after decoration the
 *   name no longer refers to the `def`. A call graph that assumes otherwise
 *   follows an edge that does not exist at runtime.
 *
 * ```python
 * @app.route("/admin")     # position 0, applicationOrder 1, ATTRIBUTE_CALL
 * @requires_auth           # position 1, applicationOrder 0, BARE
 * def admin(): ...
 * ```
 *
 * ## Column order (frozen — schema v7 §2.12, 21 columns)
 *
 * **PK** `PY_DECORATOR_md5(ownerHash ‖ position ‖ fullText ‖ startLine)`
 */
export class PyDecoratorRegistry implements EntityIdentifiable {
  private decoratorName: string;
  private kind: PythonDecoratorKind;
  private context: PythonDecoratorContext;
  private ownerHash: string;
  private pyTypeLinkHash: string;
  private pyMethodLinkHash: string;
  private position: number;
  private applicationOrder: number;
  private startLine: number;
  private endLine: number;
  private dottedPath: string;
  private fullText: string;
  private argumentCount: string;
  private pyExpressionLinkHash: string;
  private resolvedTargetHash: string;
  private isKnownBuiltin: boolean;
  private builtinKind: PythonBuiltinDecoratorKind;
  private replacesTarget: boolean;
  private pyModuleLinkHash: string;
  private serviceVersionLinkHash: string;
  private pyDecoratorUniqueHash: string = '';

  private constructor(builder: PyDecoratorRegistryBuilder) {
    this.decoratorName = builder.decoratorName;
    this.kind = builder.kind;
    this.context = builder.context;
    this.ownerHash = builder.ownerHash;
    this.pyTypeLinkHash = builder.pyTypeLinkHash;
    this.pyMethodLinkHash = builder.pyMethodLinkHash;
    this.position = builder.position;
    this.applicationOrder = builder.applicationOrder;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.dottedPath = builder.dottedPath;
    this.fullText = builder.fullText;
    this.argumentCount = builder.argumentCount;
    this.pyExpressionLinkHash = builder.pyExpressionLinkHash;
    this.resolvedTargetHash = builder.resolvedTargetHash;
    this.isKnownBuiltin = builder.isKnownBuiltin;
    this.builtinKind = builder.builtinKind;
    this.replacesTarget = builder.replacesTarget;
    this.pyModuleLinkHash = builder.pyModuleLinkHash;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    decoratorName: string,
    kind: PythonDecoratorKind,
    context: PythonDecoratorContext,
    ownerHash: string,
    fullText: string,
    position: number,
    startLine: number,
    pyModuleLinkHash: string,
    serviceVersionLinkHash: string
  ): PyDecoratorRegistryBuilder {
    return new PyDecoratorRegistryBuilder(
      decoratorName,
      kind,
      context,
      ownerHash,
      fullText,
      position,
      startLine,
      pyModuleLinkHash,
      serviceVersionLinkHash
    );
  }

  getDecoratorName(): string {
    return this.decoratorName;
  }

  getKind(): PythonDecoratorKind {
    return this.kind;
  }

  getContext(): PythonDecoratorContext {
    return this.context;
  }

  getOwnerHash(): string {
    return this.ownerHash;
  }

  /** 0-based source order, top-down — what a reader sees. */
  getPosition(): number {
    return this.position;
  }

  /** 0-based bottom-up — the order decorators actually execute. */
  getApplicationOrder(): number {
    return this.applicationOrder;
  }

  getBuiltinKind(): PythonBuiltinDecoratorKind {
    return this.builtinKind;
  }

  /** True when the decorated name no longer refers to the `def`. */
  getReplacesTarget(): boolean {
    return this.replacesTarget;
  }

  getFullText(): string {
    return this.fullText;
  }

  getDottedPath(): string {
    return this.dottedPath;
  }

  getArgumentCount(): string {
    return this.argumentCount;
  }

  getStartLine(): number {
    return this.startLine;
  }

  /** FK→`py_expression` — the decorator expression's root node. */
  getPyExpressionLinkHash(): string {
    return this.pyExpressionLinkHash;
  }

  setPyExpressionLinkHash(pyExpressionLinkHash: string): void {
    this.pyExpressionLinkHash = pyExpressionLinkHash;
  }

  /** Parser-local resolution of the decorator to a `py_method`/`py_type`. */
  setResolvedTargetHash(resolvedTargetHash: string): void {
    this.resolvedTargetHash = resolvedTargetHash;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getPyDecoratorUniqueHash(): string {
    return this.pyDecoratorUniqueHash;
  }

  getHash(): string {
    return this.pyDecoratorUniqueHash;
  }

  generateHash(): void {
    const content =
      this.ownerHash + '||' + this.position + '||' + this.fullText + '||' + this.startLine;

    this.pyDecoratorUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_DECORATOR,
      content
    );
  }

  getEntryCombined(): string {
    return `py_decorator[name=${this.decoratorName}, kind=${this.kind}, position=${this.position}, order=${this.applicationOrder}, hash=${this.pyDecoratorUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.decoratorName,
      this.kind,
      this.context,
      this.ownerHash,
      this.pyTypeLinkHash,
      this.pyMethodLinkHash,
      this.position,
      this.applicationOrder,
      this.startLine,
      this.endLine,
      this.dottedPath,
      EntityUtils.escapeTsv(this.fullText),
      this.argumentCount,
      this.pyExpressionLinkHash,
      this.resolvedTargetHash,
      this.isKnownBuiltin,
      this.builtinKind,
      this.replacesTarget,
      this.pyModuleLinkHash,
      this.serviceVersionLinkHash,
      this.pyDecoratorUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'decoratorName',
      'kind',
      'context',
      'ownerHash',
      'pyTypeLinkHash',
      'pyMethodLinkHash',
      'position',
      'applicationOrder',
      'startLine',
      'endLine',
      'dottedPath',
      'fullText',
      'argumentCount',
      'pyExpressionLinkHash',
      'resolvedTargetHash',
      'isKnownBuiltin',
      'builtinKind',
      'replacesTarget',
      'pyModuleLinkHash',
      'serviceVersionLinkHash',
      'pyDecoratorUniqueHash',
    ].join('\t');
  }
}

export class PyDecoratorRegistryBuilder {
  decoratorName: string;
  kind: PythonDecoratorKind;
  context: PythonDecoratorContext;
  ownerHash: string;
  pyTypeLinkHash: string = '';
  pyMethodLinkHash: string = '';
  position: number;
  applicationOrder: number = 0;
  startLine: number;
  endLine: number;
  dottedPath: string = '';
  fullText: string;
  argumentCount: string = '';
  pyExpressionLinkHash: string = '';
  resolvedTargetHash: string = '';
  isKnownBuiltin: boolean = false;
  builtinKind: PythonBuiltinDecoratorKind = PythonBuiltinDecoratorKind.NONE;
  replacesTarget: boolean = false;
  pyModuleLinkHash: string;
  serviceVersionLinkHash: string;

  constructor(
    decoratorName: string,
    kind: PythonDecoratorKind,
    context: PythonDecoratorContext,
    ownerHash: string,
    fullText: string,
    position: number,
    startLine: number,
    pyModuleLinkHash: string,
    serviceVersionLinkHash: string
  ) {
    this.decoratorName = decoratorName;
    this.kind = kind;
    this.context = context;
    this.ownerHash = ownerHash;
    this.fullText = fullText;
    this.position = position;
    this.startLine = startLine;
    this.endLine = startLine;
    this.pyModuleLinkHash = pyModuleLinkHash;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withOwnerLinks(pyTypeLinkHash: string, pyMethodLinkHash: string): this {
    this.pyTypeLinkHash = pyTypeLinkHash;
    this.pyMethodLinkHash = pyMethodLinkHash;
    return this;
  }

  withApplicationOrder(applicationOrder: number): this {
    this.applicationOrder = applicationOrder;
    return this;
  }

  withEndLine(endLine: number): this {
    this.endLine = endLine;
    return this;
  }

  withDottedPath(dottedPath: string): this {
    this.dottedPath = dottedPath;
    return this;
  }

  withArgumentCount(argumentCount: string): this {
    this.argumentCount = argumentCount;
    return this;
  }

  withBuiltin(builtinKind: PythonBuiltinDecoratorKind, replacesTarget: boolean): this {
    this.builtinKind = builtinKind;
    this.isKnownBuiltin = builtinKind !== PythonBuiltinDecoratorKind.NONE;
    this.replacesTarget = replacesTarget;
    return this;
  }

  build(): PyDecoratorRegistry {
    return new (PyDecoratorRegistry as unknown as {
      new (builder: PyDecoratorRegistryBuilder): PyDecoratorRegistry;
    })(this);
  }
}
