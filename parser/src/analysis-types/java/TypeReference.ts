import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  TypeRefKind,
  TypeRefContext,
  ReferenceOwnerKind,
  WildcardVariance,
} from '@/enums/java/type-references';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityJavaUtils } from '@/utils/java/entity-java-utils';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a type reference in Java source code.
 *
 * TypeReference captures how types are used throughout the codebase, forming a complete
 * graph of type dependencies. It supports nested generics, wildcards, type variables,
 * arrays, and primitives.
 *
 * ## Field Notes
 *
 * - **typeName**: The simple name as it appears in source code (e.g., `Number`, `List`, `String`).
 * - **typeVariableName**: Used only for TYPE_VARIABLE kind (e.g., `T`, `E`, `K`).
 *
 * ## Examples
 *
 * ```java
 * class UserService<T extends BaseEntity>     // TYPE_PARAM_BOUND: BaseEntity
 *        extends AbstractService<User>        // SUPER_TYPE: AbstractService<User>
 *        implements Repository<User, Long> {  // IMPLEMENTS_INTERFACE: Repository<User, Long>
 *
 *     private List<String> names;             // FIELD_TYPE: List<String>
 *     public Optional<T> find(Long id) { }    // METHOD_RETURN: Optional<T>, METHOD_PARAM: Long
 * }
 * ```
 */
export class TypeReference implements EntityIdentifiable {
  private typeRegistryLinkHash: string;
  private typeParameterLinkHash?: string;
  private referencedTypeRegistryLinkHash?: string;
  private kind: TypeRefKind;
  private context: TypeRefContext;
  private wildcardVariance?: WildcardVariance;
  private parentReferenceHash?: string;
  private position: number;
  private depth: number;
  private typeName?: string;
  private completeTypeName?: string;
  private typeVariableName?: string;
  private arrayDimensions?: number;
  private startLine?: number;
  private endLine?: number;
  private typeReferenceOwnerHash: string;
  private referenceOwnerKind: ReferenceOwnerKind;
  private typeReferenceUniqueHash: string = '';

  constructor(builder: TypeReferenceBuilder) {
    this.typeRegistryLinkHash = builder.typeRegistryLinkHash;
    this.typeParameterLinkHash = builder.typeParameterLinkHash;
    this.referencedTypeRegistryLinkHash = builder.referencedTypeRegistryLinkHash;
    this.kind = builder.kind;
    this.context = builder.context;
    this.wildcardVariance = builder.wildcardVariance;
    this.parentReferenceHash = builder.parentReferenceHash;
    this.position = builder.position;
    this.depth = builder.depth;
    this.typeName = builder.typeName;
    this.completeTypeName = builder.completeTypeName;
    this.typeVariableName = builder.typeVariableName;
    this.arrayDimensions = builder.arrayDimensions;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.typeReferenceOwnerHash = builder.typeReferenceOwnerHash;
    this.referenceOwnerKind = builder.referenceOwnerKind;
  }

  getTypeRegistryLinkHash(): string {
    return this.typeRegistryLinkHash;
  }

  getTypeParameterLinkHash(): string | undefined {
    return this.typeParameterLinkHash;
  }

  getReferencedTypeRegistryLinkHash(): string | undefined {
    return this.referencedTypeRegistryLinkHash;
  }

  getKind(): TypeRefKind {
    return this.kind;
  }

  getContext(): TypeRefContext {
    return this.context;
  }

  getWildcardVariance(): WildcardVariance | undefined {
    return this.wildcardVariance;
  }

  getParentReferenceHash(): string | undefined {
    return this.parentReferenceHash;
  }

  getPosition(): number {
    return this.position;
  }

  getDepth(): number {
    return this.depth;
  }

  getTypeName(): string | undefined {
    return this.typeName;
  }

  getCompleteTypeName(): string | undefined {
    return this.completeTypeName;
  }

  getTypeVariableName(): string | undefined {
    return this.typeVariableName;
  }

  getArrayDimensions(): number | undefined {
    return this.arrayDimensions;
  }

  getStartLine(): number | undefined {
    return this.startLine;
  }

  getEndLine(): number | undefined {
    return this.endLine;
  }

  getTypeReferenceOwnerHash(): string {
    return this.typeReferenceOwnerHash;
  }

  getReferenceOwnerKind(): ReferenceOwnerKind {
    return this.referenceOwnerKind;
  }

  getTypeReferenceUniqueHash(): string {
    return this.typeReferenceUniqueHash;
  }

  getHash(): string {
    return this.typeReferenceUniqueHash;
  }

  generateHash(): void {
    const content =
      this.typeRegistryLinkHash +
      '||' +
      (this.typeParameterLinkHash ? this.typeParameterLinkHash + '||' : '') +
      (this.referencedTypeRegistryLinkHash ? this.referencedTypeRegistryLinkHash + '||' : '') +
      this.kind +
      '||' +
      this.context +
      '||' +
      (this.parentReferenceHash ? this.parentReferenceHash + '||' : '') +
      this.position +
      '||' +
      this.depth +
      '||' +
      (this.typeName ? this.typeName + '||' : '') +
      (this.wildcardVariance ? this.wildcardVariance + '||' : '') +
      (this.typeVariableName ? this.typeVariableName + '||' : '') +
      (this.arrayDimensions !== undefined ? this.arrayDimensions + '||' : '') +
      (this.startLine !== undefined ? this.startLine + '||' : '') +
      (this.endLine !== undefined ? this.endLine : '') +
      this.typeReferenceOwnerHash +
      '||' +
      this.referenceOwnerKind;

    this.typeReferenceUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TYPE_REFERENCE,
      content
    );
  }

  getEntryCombined(): string {
    const typeInfo = this.typeName
      ? this.typeName
      : this.typeVariableName
      ? this.typeVariableName
      : this.kind.toString();

    const locationInfo =
      this.startLine !== undefined && this.endLine !== undefined
        ? `lines ${this.startLine}-${this.endLine}`
        : 'location unknown';

    return `java_type_reference[kind=${this.kind}, context=${this.context}, type=${typeInfo}, owner=${this.referenceOwnerKind}, position=${this.position}, depth=${this.depth}, parent=${this.parentReferenceHash ? 'HAS_PARENT' : 'TOP_LEVEL'}, variance=${this.wildcardVariance || 'NONE'}, ${locationInfo}, hash=${this.typeReferenceUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.kind,
      this.context,
      this.typeRegistryLinkHash,
      this.typeParameterLinkHash || '',
      this.referencedTypeRegistryLinkHash || '',
      this.parentReferenceHash || '',
      this.position.toString(),
      this.depth.toString(),
      EntityUtils.escapeTsv(this.typeName || ''),
      EntityUtils.escapeTsv(this.completeTypeName || ''),
      EntityUtils.escapeTsv(this.typeVariableName || ''),
      this.arrayDimensions !== undefined ? this.arrayDimensions.toString() : '',
      this.wildcardVariance || '',
      this.startLine !== undefined ? this.startLine.toString() : '',
      this.endLine !== undefined ? this.endLine.toString() : '',
      this.typeReferenceOwnerHash,
      this.referenceOwnerKind,
      this.typeReferenceUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'kind',
      'context',
      'typeRegistryLinkHash',
      'typeParameterLinkHash',
      'referencedTypeRegistryLinkHash',
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
      'typeReferenceUniqueHash',
    ].join('\t');
  }

  static builder(
    typeRegistryLinkHash: string,
    kind: TypeRefKind,
    context: TypeRefContext,
    referenceOwnerKind: ReferenceOwnerKind,
    typeReferenceOwnerHash: string
  ): TypeReferenceBuilder {
    return new TypeReferenceBuilder(
      typeRegistryLinkHash,
      kind,
      context,
      referenceOwnerKind,
      typeReferenceOwnerHash
    );
  }
}

/**
 * Builder for TypeReference with comprehensive validation.
 */
export class TypeReferenceBuilder {
  typeRegistryLinkHash: string;
  typeParameterLinkHash?: string;
  referencedTypeRegistryLinkHash?: string;
  kind: TypeRefKind;
  context: TypeRefContext;
  wildcardVariance?: WildcardVariance;
  parentReferenceHash?: string;
  position: number = 0;
  depth: number = 0;
  typeName?: string;
  completeTypeName?: string;
  typeVariableName?: string;
  arrayDimensions?: number;
  startLine?: number;
  endLine?: number;
  typeReferenceOwnerHash: string;
  referenceOwnerKind: ReferenceOwnerKind;

  constructor(
    typeRegistryLinkHash: string,
    kind: TypeRefKind,
    context: TypeRefContext,
    referenceOwnerKind: ReferenceOwnerKind,
    typeReferenceOwnerHash: string
  ) {
    this.typeRegistryLinkHash = typeRegistryLinkHash;
    this.kind = kind;
    this.context = context;
    this.referenceOwnerKind = referenceOwnerKind;
    this.typeReferenceOwnerHash = typeReferenceOwnerHash;
  }

  typeParameter(hash: string): this {
    this.typeParameterLinkHash = hash;
    return this;
  }

  referencedType(hash: string): this {
    this.referencedTypeRegistryLinkHash = hash;
    return this;
  }

  wildcard(variance: WildcardVariance): this {
    this.wildcardVariance = variance;
    return this;
  }

  parent(hash: string): this {
    this.parentReferenceHash = hash;
    return this;
  }

  positionAndDepth(position: number, depth: number): this {
    this.position = position;
    this.depth = depth;
    return this;
  }

  setTypeName(name: string): this {
    this.typeName = name;
    return this;
  }

  setCompleteTypeName(name: string): this {
    this.completeTypeName = name;
    return this;
  }

  typeVariable(name: string): this {
    this.typeVariableName = name;
    return this;
  }

  array(dimensions: number): this {
    this.arrayDimensions = dimensions;
    return this;
  }

  location(startLine: number, endLine: number): this {
    this.startLine = startLine;
    this.endLine = endLine;
    return this;
  }

  build(): TypeReference {
    this.validate();
    const ref = new TypeReference(this);
    ref.generateHash();
    return ref;
  }

  private validate(): void {
    this.validateRequiredFields();
    this.validateKindRequirements();
    this.validateContextRequirements();
    this.validateOwnerConsistency();
    this.validateTreeStructure();
  }

  private validateRequiredFields(): void {
    if (!this.typeRegistryLinkHash || this.typeRegistryLinkHash.trim().length === 0) {
      throw new Error('typeRegistryLinkHash is required');
    }
    if (!this.kind) {
      throw new Error('kind is required');
    }
    if (!this.context) {
      throw new Error('context is required');
    }
    if (!this.referenceOwnerKind) {
      throw new Error('referenceOwnerKind is required');
    }
    if (!this.typeReferenceOwnerHash || this.typeReferenceOwnerHash.trim().length === 0) {
      throw new Error('typeReferenceOwnerHash is required');
    }
  }

  /**
   * Checks if this reference is in a bound context (TYPE_PARAM_BOUND or METHOD_TYPE_PARAM_BOUND).
   * In these contexts, wildcardVariance is allowed on TYPE_VARIABLE and CLASS types.
   */
  private isBoundContext(): boolean {
    return this.context === TypeRefContext.TYPE_PARAM_BOUND || 
           this.context === TypeRefContext.METHOD_TYPE_PARAM_BOUND;
  }

  private validateKindRequirements(): void {
    switch (this.kind) {
      case TypeRefKind.CLASS:
      case TypeRefKind.PARAMETERIZED:
        if (!this.typeName || this.typeName.trim().length === 0) {
          throw new Error(`${this.kind} requires a non-empty typeName`);
        }
        if (this.typeVariableName) {
          throw new Error(`${this.kind} cannot have a typeVariableName`);
        }
        // wildcardVariance is allowed for CLASS in bound contexts (TYPE_PARAM_BOUND, METHOD_TYPE_PARAM_BOUND)
        if (this.wildcardVariance && !this.isBoundContext()) {
          throw new Error(`${this.kind} cannot have a wildcardVariance outside of bound contexts`);
        }
        break;

      case TypeRefKind.TYPE_VARIABLE:
        if (!this.typeVariableName || this.typeVariableName.trim().length === 0) {
          throw new Error('TYPE_VARIABLE requires a non-empty typeVariableName');
        }
        // wildcardVariance is allowed for TYPE_VARIABLE in bound contexts (TYPE_PARAM_BOUND, METHOD_TYPE_PARAM_BOUND)
        // e.g., <U extends T> where T is a TYPE_VARIABLE with EXTENDS variance
        if (this.wildcardVariance && !this.isBoundContext()) {
          throw new Error('TYPE_VARIABLE cannot have wildcardVariance outside of bound contexts');
        }
        break;

      case TypeRefKind.WILDCARD:
        if (!this.wildcardVariance) {
          throw new Error('WILDCARD requires a wildcardVariance');
        }
        if (!this.parentReferenceHash) {
          throw new Error('WILDCARD requires a parentReferenceHash');
        }
        if (this.arrayDimensions !== undefined) {
          throw new Error('WILDCARD cannot have arrayDimensions');
        }
        break;

      case TypeRefKind.ARRAY:
        if (this.arrayDimensions === undefined || this.arrayDimensions <= 0) {
          throw new Error('ARRAY requires arrayDimensions > 0');
        }
        if (!this.typeName || this.typeName.trim().length === 0) {
          throw new Error('ARRAY requires typeName for element type');
        }
        if (this.wildcardVariance) {
          throw new Error('ARRAY cannot have wildcardVariance');
        }
        break;

      case TypeRefKind.PRIMITIVE:
        if (!this.typeName || !EntityJavaUtils.isPrimitiveType(this.typeName)) {
          throw new Error('PRIMITIVE requires valid primitive type name');
        }
        if (this.wildcardVariance) {
          throw new Error('PRIMITIVE cannot have wildcardVariance');
        }
        if (this.typeVariableName) {
          throw new Error('PRIMITIVE cannot have typeVariableName');
        }
        break;
    }
  }

  private validateContextRequirements(): void {
    switch (this.context) {
      case TypeRefContext.TYPE_PARAM_BOUND:
        if (!this.typeParameterLinkHash) {
          throw new Error('TYPE_PARAM_BOUND must have a typeParameterLinkHash');
        }
        if (this.referenceOwnerKind !== ReferenceOwnerKind.TYPE) {
          throw new Error('TYPE_PARAM_BOUND must have TYPE owner kind');
        }
        if (this.kind === TypeRefKind.WILDCARD && this.depth === 0) {
          throw new Error('TYPE_PARAM_BOUND cannot be a wildcard at depth 0');
        }
        if (this.kind === TypeRefKind.ARRAY && this.depth === 0) {
          throw new Error('TYPE_PARAM_BOUND cannot be an array at depth 0');
        }
        if (this.kind === TypeRefKind.PRIMITIVE && this.depth === 0) {
          throw new Error('TYPE_PARAM_BOUND cannot be a primitive type at depth 0');
        }
        break;

      case TypeRefContext.SUPER_TYPE:
      case TypeRefContext.IMPLEMENTS_INTERFACE:
      case TypeRefContext.PERMITS:
        if (this.referenceOwnerKind !== ReferenceOwnerKind.TYPE) {
          throw new Error(`${this.context} requires TYPE owner kind`);
        }
        // Only disallow ARRAY/PRIMITIVE at depth=0 (the actual super type)
        // At depth>0, arrays are valid as type arguments (e.g., Callable<String[]>)
        if (this.depth === 0) {
          if (this.kind === TypeRefKind.ARRAY) {
            throw new Error(`ARRAY kind is not allowed in ${this.context} context at depth 0`);
          }
          if (this.kind === TypeRefKind.PRIMITIVE) {
            throw new Error(`PRIMITIVE kind not allowed in ${this.context} context at depth 0`);
          }
        }
        break;

      case TypeRefContext.FIELD_TYPE:
        if (this.referenceOwnerKind !== ReferenceOwnerKind.FIELD) {
          throw new Error('FIELD_TYPE requires FIELD owner kind');
        }
        break;

      case TypeRefContext.METHOD_RETURN:
      case TypeRefContext.THROWS_CLAUSE:
        if (this.referenceOwnerKind !== ReferenceOwnerKind.METHOD) {
          throw new Error(`${this.context} requires METHOD owner kind`);
        }
        break;

      case TypeRefContext.METHOD_PARAM:
        if (this.referenceOwnerKind !== ReferenceOwnerKind.METHOD_PARAM) {
          throw new Error(`${this.context} requires METHOD_PARAM owner kind`);
        }
        break;

      case TypeRefContext.ANNOTATION_PARAM:
        if (this.referenceOwnerKind !== ReferenceOwnerKind.ANNOTATION_ARGUMENT) {
          throw new Error(`${this.context} requires ANNOTATION_ARGUMENT owner kind`);
        }
        break;

      case TypeRefContext.TYPE_PARAMETER_ANNOTATION:
        if (this.referenceOwnerKind !== ReferenceOwnerKind.TYPE_PARAMETER) {
          throw new Error(`${this.context} requires TYPE_PARAMETER owner kind`);
        }
        break;

      case TypeRefContext.CAST_EXPRESSION:
        if (this.referenceOwnerKind !== ReferenceOwnerKind.EXPRESSION) {
          throw new Error(`${this.context} requires EXPRESSION owner kind`);
        }
        break;
    }
  }

  private validateOwnerConsistency(): void {
    if (
      this.referenceOwnerKind === ReferenceOwnerKind.TYPE &&
      this.typeReferenceOwnerHash !== this.typeRegistryLinkHash
    ) {
      throw new Error(
        'TYPE owner requires typeReferenceOwnerHash to match typeRegistryLinkHash'
      );
    }
    if (
      this.referenceOwnerKind !== ReferenceOwnerKind.TYPE &&
      this.typeReferenceOwnerHash === this.typeRegistryLinkHash
    ) {
      throw new Error(
        `${this.referenceOwnerKind} owner should not have typeReferenceOwnerHash matching typeRegistryLinkHash`
      );
    }
  }

  private validateTreeStructure(): void {
    if (this.parentReferenceHash && this.depth === 0) {
      throw new Error('Child nodes must have depth > 0');
    }
    if (!this.parentReferenceHash && this.depth !== 0) {
      throw new Error('Root nodes must have depth = 0');
    }
  }
}
