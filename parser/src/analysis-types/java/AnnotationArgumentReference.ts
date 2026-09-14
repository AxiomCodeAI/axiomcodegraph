import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { ArgumentValueType } from '@/enums/java/annotations/ArgumentValueType';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a reference to an annotation argument value.
 * 
 * Similar to TypeReference, this tracks individual annotation arguments
 * as separate entities for relationship analysis and querying.
 *
 * ## Examples
 *
 * ```java
 * @Table(
 *     name = "users",                         // ← AnnotationArgumentReference
 *     schema = "public"                       // ← AnnotationArgumentReference
 * )
 * 
 * @EntityListeners(AuditListener.class)      // ← AnnotationArgumentReference (CLASS_REFERENCE)
 * 
 * @Retention(RetentionPolicy.RUNTIME)        // ← AnnotationArgumentReference (ENUM_CONSTANT)
 * 
 * @Target({ ElementType.TYPE, ElementType.METHOD })  // ← AnnotationArgumentReference (ARRAY)
 * ```
 */
export class AnnotationArgumentReference implements EntityIdentifiable {
  private argumentName: string;
  private argumentValue: string;
  private valueType: ArgumentValueType;
  private position: number;
  private parentAnnotationHash: string;
  private referencedTypeHash?: string;
  private nestedAnnotationHash?: string;
  private arrayIndex?: number;
  private startLine?: number;
  private endLine?: number;
  private annotationArgumentReferenceUniqueHash: string = '';

  constructor(builder: AnnotationArgumentReferenceBuilder) {
    this.argumentName = builder.argumentName;
    this.argumentValue = builder.argumentValue;
    this.valueType = builder.valueType;
    this.position = builder.position;
    this.parentAnnotationHash = builder.parentAnnotationHash;
    this.referencedTypeHash = builder.referencedTypeHash;
    this.nestedAnnotationHash = builder.nestedAnnotationHash;
    this.arrayIndex = builder.arrayIndex;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
  }

  getArgumentName(): string {
    return this.argumentName;
  }

  getArgumentValue(): string {
    return this.argumentValue;
  }

  getValueType(): ArgumentValueType {
    return this.valueType;
  }

  getPosition(): number {
    return this.position;
  }

  getParentAnnotationHash(): string {
    return this.parentAnnotationHash;
  }

  getReferencedTypeHash(): string | undefined {
    return this.referencedTypeHash;
  }

  getNestedAnnotationHash(): string | undefined {
    return this.nestedAnnotationHash;
  }

  getArrayIndex(): number | undefined {
    return this.arrayIndex;
  }

  getStartLine(): number | undefined {
    return this.startLine;
  }

  getEndLine(): number | undefined {
    return this.endLine;
  }

  getHash(): string {
    return this.annotationArgumentReferenceUniqueHash;
  }

  generateHash(): void {
    const content =
      this.argumentName +
      '||' +
      this.argumentValue +
      '||' +
      this.valueType +
      '||' +
      this.position +
      '||' +
      this.parentAnnotationHash +
      '||' +
      (this.referencedTypeHash ? this.referencedTypeHash + '||' : '') +
      (this.nestedAnnotationHash ? this.nestedAnnotationHash + '||' : '') +
      (this.arrayIndex !== undefined ? this.arrayIndex + '||' : '') +
      (this.startLine !== undefined ? this.startLine + '||' : '') +
      (this.endLine !== undefined ? this.endLine : '');

    this.annotationArgumentReferenceUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.ANNOTATION_ARGUMENT_REFERENCE,
      content
    );
  }

  getHashFieldName(): string {
    return 'annotationArgumentReferenceUniqueHash';
  }

  getEntryCombined(): string {
    const locationInfo =
      this.startLine !== undefined && this.endLine !== undefined
        ? `${this.startLine}:${this.endLine}`
        : '';
    return `${this.argumentName}=${this.argumentValue} [${this.valueType}] @${locationInfo}`;
  }

  toCsv(): string {
    return [
      this.argumentName,
      EntityUtils.escapeTsv(this.argumentValue),
      this.valueType,
      this.position,
      this.parentAnnotationHash,
      this.referencedTypeHash || '',
      this.nestedAnnotationHash || '',
      this.arrayIndex !== undefined ? this.arrayIndex : '',
      this.startLine !== undefined ? this.startLine : '',
      this.endLine !== undefined ? this.endLine : '',
      this.annotationArgumentReferenceUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'argumentName',
      'argumentValue',
      'valueType',
      'position',
      'parentAnnotationHash',
      'referencedTypeHash',
      'nestedAnnotationHash',
      'arrayIndex',
      'startLine',
      'endLine',
      'annotationArgumentReferenceUniqueHash',
    ].join('\t');
  }

  static builder(
    argumentName: string,
    argumentValue: string,
    valueType: ArgumentValueType,
    position: number,
    parentAnnotationHash: string
  ): AnnotationArgumentReferenceBuilder {
    return new AnnotationArgumentReferenceBuilder(
      argumentName,
      argumentValue,
      valueType,
      position,
      parentAnnotationHash
    );
  }
}

/**
 * Builder for AnnotationArgumentReference with validation.
 */
export class AnnotationArgumentReferenceBuilder {
  argumentName: string;
  argumentValue: string;
  valueType: ArgumentValueType;
  position: number;
  parentAnnotationHash: string;
  referencedTypeHash?: string;
  nestedAnnotationHash?: string;
  arrayIndex?: number;
  startLine?: number;
  endLine?: number;

  constructor(
    argumentName: string,
    argumentValue: string,
    valueType: ArgumentValueType,
    position: number,
    parentAnnotationHash: string
  ) {
    this.argumentName = argumentName;
    this.argumentValue = argumentValue;
    this.valueType = valueType;
    this.position = position;
    this.parentAnnotationHash = parentAnnotationHash;
  }

  referencedType(typeHash: string): this {
    this.referencedTypeHash = typeHash;
    return this;
  }

  nestedAnnotation(annotationHash: string): this {
    this.nestedAnnotationHash = annotationHash;
    return this;
  }

  arrayPosition(index: number): this {
    this.arrayIndex = index;
    return this;
  }

  location(startLine: number, endLine: number): this {
    this.startLine = startLine;
    this.endLine = endLine;
    return this;
  }

  build(): AnnotationArgumentReference {
    this.validate();
    const arg = new AnnotationArgumentReference(this);
    arg.generateHash();
    return arg;
  }

  private validate(): void {
    if (!this.argumentName || this.argumentName.trim().length === 0) {
      throw new Error('argumentName is required');
    }
    if (!this.argumentValue || this.argumentValue.trim().length === 0) {
      throw new Error('argumentValue is required');
    }
    if (!this.valueType) {
      throw new Error('valueType is required');
    }
    if (this.position < 0) {
      throw new Error('position must be >= 0');
    }
    if (!this.parentAnnotationHash || this.parentAnnotationHash.trim().length === 0) {
      throw new Error('parentAnnotationHash is required');
    }
  }
}
