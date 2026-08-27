import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  PythonTypeRefContext,
  PythonTypeRefKind,
  PythonTypeRefOwnerKind,
} from '@/enums/python/type-references';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents one **type reference** — a use of a type, linked to the type.
 *
 * Positions 0–16 mirror `java_type_reference` 0–16, so the ~250-line
 * `type-resolution.dl` name→type layer ports with a relation rename.
 *
 * ## Why this is a tree and not one row per annotation
 *
 * This is the whole point of the relation. A composite annotation references
 * several types, and they are **related to each other**, so one row cannot carry
 * it:
 *
 * ```python
 * def f(m: Dict[TypeA, TypeB]): ...
 *
 * depth 0   SUBSCRIPT   typeName=Dict   completeTypeName=Dict[TypeA, TypeB]
 * depth 1     NAME      typeName=TypeA  parent=<Dict ref>  position=0
 * depth 1     NAME      typeName=TypeB  parent=<Dict ref>  position=1
 * ```
 *
 * `parentReferenceHash` + `position` + `depth` are what make nesting
 * navigable, and they compose to any depth:
 *
 * ```python
 * x: Dict[TypeA, List[Optional[TypeB]]]
 *
 * d0 SUBSCRIPT Dict
 * d1   NAME     TypeA     parent=Dict  position=0
 * d1   SUBSCRIPT List     parent=Dict  position=1
 * d2     OPTIONAL Optional parent=List position=0   isOptional=true
 * d3       NAME   TypeB    parent=Optional position=0
 * ```
 *
 * A single `potentialQualifiedName` slot on the parameter cannot express any of
 * that, which is exactly why the relation exists.
 *
 * `depth` is load-bearing beyond navigation: `type-hierarchy.dl` filters on
 * `depth == "0"` to find the outermost reference, so a flattened tree would make
 * that filter select every nested argument as well.
 *
 * ## Column order (frozen — schema v6 §2.6, 25 columns)
 *
 * **PK** `PY_TYPE_REFERENCE_md5(typeReferenceOwnerHash ‖ context ‖
 * parentReferenceHash ‖ position ‖ depth ‖ completeTypeName ‖ startLine)`
 */
export class PyTypeReferenceRegistry implements EntityIdentifiable {
  private kind: PythonTypeRefKind;
  private context: PythonTypeRefContext;
  private pyTypeLinkHash: string;
  private typeParameterLinkHash: string;
  private referencedTypeLinkHash: string;
  private parentReferenceHash: string;
  private position: number;
  private depth: number;
  private typeName: string;
  private completeTypeName: string;
  private typeVariableName: string;
  private arrayDimensions: string;
  private wildcardVariance: string;
  private startLine: number;
  private endLine: number;
  private typeReferenceOwnerHash: string;
  private referenceOwnerKind: PythonTypeRefOwnerKind;
  private pyScopeLinkHash: string;
  private pyModuleLinkHash: string;
  private isStringForwardRef: boolean;
  private isTypeCommentDerived: boolean;
  private isOptional: boolean;
  private pyExpressionLinkHash: string;
  private serviceVersionLinkHash: string;
  private pyTypeReferenceUniqueHash: string = '';

  private constructor(builder: PyTypeReferenceRegistryBuilder) {
    this.kind = builder.kind;
    this.context = builder.context;
    this.pyTypeLinkHash = builder.pyTypeLinkHash;
    this.typeParameterLinkHash = builder.typeParameterLinkHash;
    this.referencedTypeLinkHash = builder.referencedTypeLinkHash;
    this.parentReferenceHash = builder.parentReferenceHash;
    this.position = builder.position;
    this.depth = builder.depth;
    this.typeName = builder.typeName;
    this.completeTypeName = builder.completeTypeName;
    this.typeVariableName = builder.typeVariableName;
    this.arrayDimensions = builder.arrayDimensions;
    this.wildcardVariance = builder.wildcardVariance;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.typeReferenceOwnerHash = builder.typeReferenceOwnerHash;
    this.referenceOwnerKind = builder.referenceOwnerKind;
    this.pyScopeLinkHash = builder.pyScopeLinkHash;
    this.pyModuleLinkHash = builder.pyModuleLinkHash;
    this.isStringForwardRef = builder.isStringForwardRef;
    this.isTypeCommentDerived = builder.isTypeCommentDerived;
    this.isOptional = builder.isOptional;
    this.pyExpressionLinkHash = builder.pyExpressionLinkHash;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    kind: PythonTypeRefKind,
    context: PythonTypeRefContext,
    typeName: string,
    completeTypeName: string,
    typeReferenceOwnerHash: string,
    referenceOwnerKind: PythonTypeRefOwnerKind,
    pyModuleLinkHash: string,
    startLine: number,
    serviceVersionLinkHash: string
  ): PyTypeReferenceRegistryBuilder {
    return new PyTypeReferenceRegistryBuilder(
      kind,
      context,
      typeName,
      completeTypeName,
      typeReferenceOwnerHash,
      referenceOwnerKind,
      pyModuleLinkHash,
      startLine,
      serviceVersionLinkHash
    );
  }

  getKind(): PythonTypeRefKind {
    return this.kind;
  }

  getContext(): PythonTypeRefContext {
    return this.context;
  }

  getTypeName(): string {
    return this.typeName;
  }

  getCompleteTypeName(): string {
    return this.completeTypeName;
  }

  getParentReferenceHash(): string {
    return this.parentReferenceHash;
  }

  getPosition(): number {
    return this.position;
  }

  getDepth(): number {
    return this.depth;
  }

  getTypeReferenceOwnerHash(): string {
    return this.typeReferenceOwnerHash;
  }

  getReferenceOwnerKind(): PythonTypeRefOwnerKind {
    return this.referenceOwnerKind;
  }

  getReferencedTypeLinkHash(): string {
    return this.referencedTypeLinkHash;
  }

  getIsOptional(): boolean {
    return this.isOptional;
  }

  getStartLine(): number {
    return this.startLine;
  }

  /** Back-patches the resolved type once name resolution has run. */
  setReferencedTypeLinkHash(referencedTypeLinkHash: string): void {
    this.referencedTypeLinkHash = referencedTypeLinkHash;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getPyTypeReferenceUniqueHash(): string {
    return this.pyTypeReferenceUniqueHash;
  }

  getHash(): string {
    return this.pyTypeReferenceUniqueHash;
  }

  generateHash(): void {
    const content = [
      this.typeReferenceOwnerHash,
      this.context,
      this.parentReferenceHash,
      this.position,
      this.depth,
      this.completeTypeName,
      this.startLine,
    ].join('||');

    this.pyTypeReferenceUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_TYPE_REFERENCE,
      content
    );
  }

  getEntryCombined(): string {
    return `py_type_reference[kind=${this.kind}, context=${this.context}, name=${this.typeName}, depth=${this.depth}, position=${this.position}, parent=${this.parentReferenceHash || '-'}, hash=${this.pyTypeReferenceUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.kind,
      this.context,
      this.pyTypeLinkHash,
      this.typeParameterLinkHash,
      this.referencedTypeLinkHash,
      this.parentReferenceHash,
      this.position.toString(),
      this.depth.toString(),
      this.typeName,
      EntityUtils.escapeTsv(this.completeTypeName),
      this.typeVariableName,
      this.arrayDimensions,
      this.wildcardVariance,
      this.startLine.toString(),
      this.endLine.toString(),
      this.typeReferenceOwnerHash,
      this.referenceOwnerKind,
      this.pyScopeLinkHash,
      this.pyModuleLinkHash,
      this.isStringForwardRef.toString(),
      this.isTypeCommentDerived.toString(),
      this.isOptional.toString(),
      this.pyExpressionLinkHash,
      this.serviceVersionLinkHash,
      this.pyTypeReferenceUniqueHash,
    ].join('\t');
  }

  /** Set by the fact extractor once the expression stage has minted rows. */
  setPyExpressionLinkHash(pyExpressionLinkHash: string): void {
    this.pyExpressionLinkHash = pyExpressionLinkHash;
  }

  getCsvHeader(): string {
    return [
      'kind',
      'context',
      'pyTypeLinkHash',
      'typeParameterLinkHash',
      'referencedTypeLinkHash',
      'parentReferenceHash',
      'position',
      'depth',
      'typeName',
      'completeTypeName',
      'typeVariableName',
      'arrayDimensions',
      'wildcardVariance',
      'startLine',
      'endLine',
      'typeReferenceOwnerHash',
      'referenceOwnerKind',
      'pyScopeLinkHash',
      'pyModuleLinkHash',
      'isStringForwardRef',
      'isTypeCommentDerived',
      'isOptional',
      'pyExpressionLinkHash',
      'serviceVersionLinkHash',
      'pyTypeReferenceUniqueHash',
    ].join('\t');
  }
}

/**
 * Builder for PyTypeReferenceRegistry.
 *
 * `arrayDimensions` has no setter: Python has no array types, so it is a parity
 * slot held at `''` to keep Java's column positions aligned.
 */
export class PyTypeReferenceRegistryBuilder {
  kind: PythonTypeRefKind;
  context: PythonTypeRefContext;
  pyTypeLinkHash: string = '';
  typeParameterLinkHash: string = '';
  referencedTypeLinkHash: string = '';
  parentReferenceHash: string = '';
  position: number = 0;
  depth: number = 0;
  typeName: string;
  completeTypeName: string;
  typeVariableName: string = '';
  readonly arrayDimensions: string = '';
  wildcardVariance: string = '';
  startLine: number;
  endLine: number = 0;
  typeReferenceOwnerHash: string;
  referenceOwnerKind: PythonTypeRefOwnerKind;
  pyScopeLinkHash: string = '';
  pyModuleLinkHash: string;
  isStringForwardRef: boolean = false;
  isTypeCommentDerived: boolean = false;
  isOptional: boolean = false;
  pyExpressionLinkHash: string = '';
  serviceVersionLinkHash: string;

  constructor(
    kind: PythonTypeRefKind,
    context: PythonTypeRefContext,
    typeName: string,
    completeTypeName: string,
    typeReferenceOwnerHash: string,
    referenceOwnerKind: PythonTypeRefOwnerKind,
    pyModuleLinkHash: string,
    startLine: number,
    serviceVersionLinkHash: string
  ) {
    if (!typeReferenceOwnerHash || typeReferenceOwnerHash.trim().length === 0) {
      throw new Error('typeReferenceOwnerHash is required');
    }
    if (!serviceVersionLinkHash || serviceVersionLinkHash.trim().length === 0) {
      throw new Error('serviceVersionLinkHash is required');
    }

    this.kind = kind;
    this.context = context;
    this.typeName = typeName;
    this.completeTypeName = completeTypeName;
    this.typeReferenceOwnerHash = typeReferenceOwnerHash;
    this.referenceOwnerKind = referenceOwnerKind;
    this.pyModuleLinkHash = pyModuleLinkHash;
    this.startLine = startLine;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  /** The nesting link: parent reference, index among siblings, and depth. */
  withNesting(parentReferenceHash: string, position: number, depth: number): this {
    this.parentReferenceHash = parentReferenceHash;
    this.position = position;
    this.depth = depth;
    return this;
  }

  withEnclosingType(pyTypeLinkHash: string): this {
    this.pyTypeLinkHash = pyTypeLinkHash;
    return this;
  }

  withScope(pyScopeLinkHash: string): this {
    this.pyScopeLinkHash = pyScopeLinkHash;
    return this;
  }

  withSpan(startLine: number, endLine: number): this {
    this.startLine = startLine;
    this.endLine = endLine;
    return this;
  }

  withFlags(flags: {
    isStringForwardRef?: boolean;
    isTypeCommentDerived?: boolean;
    isOptional?: boolean;
  }): this {
    this.isStringForwardRef = flags.isStringForwardRef ?? this.isStringForwardRef;
    this.isTypeCommentDerived = flags.isTypeCommentDerived ?? this.isTypeCommentDerived;
    this.isOptional = flags.isOptional ?? this.isOptional;
    return this;
  }

  withTypeVariable(typeVariableName: string, wildcardVariance: string): this {
    this.typeVariableName = typeVariableName;
    this.wildcardVariance = wildcardVariance;
    return this;
  }

  withPyExpressionLinkHash(pyExpressionLinkHash: string): this {
    this.pyExpressionLinkHash = pyExpressionLinkHash;
    return this;
  }

  withReferencedTypeLinkHash(referencedTypeLinkHash: string): this {
    this.referencedTypeLinkHash = referencedTypeLinkHash;
    return this;
  }

  build(): PyTypeReferenceRegistry {
    return new (PyTypeReferenceRegistry as unknown as {
      new (builder: PyTypeReferenceRegistryBuilder): PyTypeReferenceRegistry;
    })(this);
  }
}
