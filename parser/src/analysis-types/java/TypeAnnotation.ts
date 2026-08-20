import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { AnnotationContext, AnnotationKind } from '@/enums';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a type annotation in Java source code.
 *
 * TypeAnnotation captures annotation usage across the codebase, including:
 * - Simple marker annotations: @Deprecated, @Nullable
 * - Parameterized annotations: @Something(name = "...", value = 42)
 * - Single-value shorthand: @Timeout(1000)
 * - Array and brace-based values: @Something({ "a", "b" })
 * - Nested annotations: @Something(meta = @Other(x = 1))
 * - Meta-annotations on annotation declarations: @Retention, @Target
 * - Type-use annotations: List<@NonNull String>
 * - Type parameter annotations: class Box<@NonNull T> (Java 8+)
 *
 * ## Examples
 *
 * ```java
 * @Deprecated                              // MARKER, context: TYPE_DECLARATION
 * @Timeout(1000)                           // SINGLE_VALUE, context: METHOD_DECLARATION
 * @Column(name = "id", nullable = false)   // NAMED_ARGUMENTS, context: FIELD_DECLARATION
 * @Target({ ElementType.TYPE })            // NAMED_ARGUMENTS with array, context: ANNOTATION_TYPE_DECLARATION
 * List<@NonNull String> items;            // TYPE_USE (not currently extracted)
 *
 * // Type parameter annotations (Java 8+)
 * class Container<@NonNull T,              // context: TYPE_PARAMETER, typeParameterHash: hash of T
 *                 @Validated(validator = SizeValidator.class) U> {  // Links to type parameter U
 *     // typeParameterHash enables linking annotations to specific type parameters
 * }
 * ```
 *
 * ## Field Links
 *
 * - **typeRegistryHash**: Always links to the enclosing type
 * - **typeParameterHash**: Only set for annotations on type parameters (context: TYPE_PARAMETER)
 * - **parentAnnotationHash**: Set for nested annotations (depth > 0)
 * - **ownerHash**: Links to the specific entity being annotated (type, field, method, parameter, etc.)
 */
export class TypeAnnotation implements EntityIdentifiable {
  private annotationName: string;
  private kind: AnnotationKind;
  private context: AnnotationContext;
  private ownerHash: string;
  private typeRegistryHash?: string;
  private typeParameterHash?: string;
  private parentAnnotationHash?: string;
  private depth: number;
  private position: number;
  private startLine?: number;
  private endLine?: number;
  private isMetaAnnotation: boolean;
  private typeAnnotationUniqueHash: string = '';

  constructor(builder: TypeAnnotationBuilder) {
    this.annotationName = builder.annotationName;
    this.kind = builder.kind;
    this.context = builder.context;
    this.ownerHash = builder.ownerHash;
    this.typeRegistryHash = builder.typeRegistryHash;
    this.typeParameterHash = builder.typeParameterHash;
    this.parentAnnotationHash = builder.parentAnnotationHash;
    this.depth = builder.depth;
    this.position = builder.position;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.isMetaAnnotation = builder.isMetaAnnotation;
  }

  getAnnotationName(): string {
    return this.annotationName;
  }

  getKind(): AnnotationKind {
    return this.kind;
  }

  getContext(): AnnotationContext {
    return this.context;
  }

  getOwnerHash(): string {
    return this.ownerHash;
  }

  getTypeRegistryHash(): string | undefined {
    return this.typeRegistryHash;
  }

  getTypeParameterHash(): string | undefined {
    return this.typeParameterHash;
  }

  getParentAnnotationHash(): string | undefined {
    return this.parentAnnotationHash;
  }

  getDepth(): number {
    return this.depth;
  }

  getPosition(): number {
    return this.position;
  }

  getStartLine(): number | undefined {
    return this.startLine;
  }

  getEndLine(): number | undefined {
    return this.endLine;
  }

  getIsMetaAnnotation(): boolean {
    return this.isMetaAnnotation;
  }

  getTypeAnnotationUniqueHash(): string {
    return this.typeAnnotationUniqueHash;
  }

  getHash(): string {
    return this.typeAnnotationUniqueHash;
  }

  generateHash(): void {
    const content =
      this.annotationName +
      '||' +
      this.kind +
      '||' +
      this.context +
      '||' +
      this.ownerHash +
      '||' +
      (this.typeRegistryHash ? this.typeRegistryHash + '||' : '') +
      (this.typeParameterHash ? this.typeParameterHash + '||' : '') +
      (this.parentAnnotationHash ? this.parentAnnotationHash + '||' : '') +
      this.depth +
      '||' +
      this.position +
      '||' +
      (this.startLine !== undefined ? this.startLine + '||' : '') +
      (this.endLine !== undefined ? this.endLine + '||' : '') +
      this.isMetaAnnotation;

    this.typeAnnotationUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TYPE_ANNOTATION,
      content
    );
  }

  getEntryCombined(): string {
    const locationInfo =
      this.startLine !== undefined && this.endLine !== undefined
        ? `lines ${this.startLine}-${this.endLine}`
        : 'location unknown';

    return `java_type_annotation[name=@${this.annotationName}, kind=${this.kind}, context=${this.context}, owner=${this.ownerHash}, depth=${this.depth}, meta=${this.isMetaAnnotation}, ${locationInfo}, hash=${this.typeAnnotationUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.annotationName,
      this.kind,
      this.context,
      this.ownerHash,
      this.typeRegistryHash || '',
      this.typeParameterHash || '',
      this.parentAnnotationHash || '',
      this.depth.toString(),
      this.position.toString(),
      this.startLine !== undefined ? this.startLine.toString() : '',
      this.endLine !== undefined ? this.endLine.toString() : '',
      this.isMetaAnnotation.toString(),
      this.typeAnnotationUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'annotationName',
      'kind',
      'context',
      'ownerHash',
      'typeRegistryHash',
      'typeParameterHash',
      'parentAnnotationHash',
      'depth',
      'position',
      'startLine',
      'endLine',
      'isMetaAnnotation',
      'typeAnnotationUniqueHash',
    ].join('\t');
  }

  static builder(
    annotationName: string,
    kind: AnnotationKind,
    context: AnnotationContext,
    ownerHash: string
  ): TypeAnnotationBuilder {
    return new TypeAnnotationBuilder(annotationName, kind, context, ownerHash);
  }
}

/**
 * Builder for TypeAnnotation with validation.
 */
export class TypeAnnotationBuilder {
  annotationName: string;
  kind: AnnotationKind;
  context: AnnotationContext;
  ownerHash: string;
  typeRegistryHash?: string;
  typeParameterHash?: string;
  parentAnnotationHash?: string;
  depth: number = 0;
  position: number = 0;
  startLine?: number;
  endLine?: number;
  isMetaAnnotation: boolean = false;

  constructor(
    annotationName: string,
    kind: AnnotationKind,
    context: AnnotationContext,
    ownerHash: string
  ) {
    this.annotationName = annotationName;
    this.kind = kind;
    this.context = context;
    this.ownerHash = ownerHash;
  }

  typeRegistry(hash: string): this {
    this.typeRegistryHash = hash;
    return this;
  }

  typeParameter(hash: string): this {
    this.typeParameterHash = hash;
    return this;
  }

  parentAnnotation(hash: string): this {
    this.parentAnnotationHash = hash;
    return this;
  }

  setDepth(depth: number): this {
    this.depth = depth;
    return this;
  }

  setPosition(position: number): this {
    this.position = position;
    return this;
  }

  location(startLine: number, endLine: number): this {
    this.startLine = startLine;
    this.endLine = endLine;
    return this;
  }

  metaAnnotation(isMeta: boolean): this {
    this.isMetaAnnotation = isMeta;
    return this;
  }

  build(): TypeAnnotation {
    this.validate();
    const annotation = new TypeAnnotation(this);
    annotation.generateHash();
    return annotation;
  }

  private validate(): void {
    if (!this.annotationName || this.annotationName.trim().length === 0) {
      throw new Error('annotationName is required');
    }
    if (!this.kind) {
      throw new Error('kind is required');
    }
    if (!this.context) {
      throw new Error('context is required');
    }
    if (!this.ownerHash || this.ownerHash.trim().length === 0) {
      throw new Error('ownerHash is required');
    }
    if (this.depth < 0) {
      throw new Error('depth must be >= 0');
    }
    if (this.position < 0) {
      throw new Error('position must be >= 0');
    }
  }
}
