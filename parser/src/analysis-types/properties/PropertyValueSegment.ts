import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { PropertyValueSegmentType } from '@/enums/properties/PropertyValueSegmentType';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a single segment within a property value expression.
 *
 * Property values are decomposed into segments to capture the structure of
 * references, defaults, and literal text. Each `${...}` reference, SpEL
 * expression, or literal chunk gets its own row.
 *
 * ## Nesting via depth + parentSegmentLinkHash
 *
 * For `${PRIMARY:${SECONDARY:${TERTIARY:fallback}}}`:
 * - depth=0: PRIMARY (ENV_VARIABLE)
 * - depth=1: SECONDARY (ENV_VARIABLE), parent → PRIMARY segment
 * - depth=2: TERTIARY (ENV_WITH_DEFAULT, defaultValue="fallback"), parent → SECONDARY segment
 *
 * ## Mixed Nested Example
 *
 * For `jdbc:postgresql://${DB_HOST:${FALLBACK:127.0.0.1}}:${DB_PORT:5432}`:
 * - pos=0, depth=0: LITERAL "jdbc:postgresql://"
 * - pos=1, depth=0: ENV_VARIABLE "DB_HOST"
 *   - pos=0, depth=1: ENV_WITH_DEFAULT "FALLBACK", default="127.0.0.1", parent → DB_HOST
 * - pos=2, depth=0: LITERAL ":"
 * - pos=3, depth=0: ENV_WITH_DEFAULT "DB_PORT", default="5432"
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. segmentValue, segmentType, defaultValue, position, depth
 * 2. parentSegmentLinkHash, propertyKeyLinkHash
 * 3. startLine, endLine, startCol, endCol
 * 4. propertyValueSegmentUniqueHash (LAST)
 */
export class PropertyValueSegment implements EntityIdentifiable {
  private segmentValue: string;
  private segmentType: PropertyValueSegmentType;
  private defaultValue: string;
  private position: number;
  private depth: number;
  private parentSegmentLinkHash: string;
  private propertyKeyLinkHash: string;
  private startLine: number;
  private endLine: number;
  private startCol: number;
  private endCol: number;
  private propertyValueSegmentUniqueHash: string = '';

  private constructor(builder: PropertyValueSegmentBuilder) {
    this.segmentValue = builder.segmentValue;
    this.segmentType = builder.segmentType;
    this.defaultValue = builder.defaultValue;
    this.position = builder.position;
    this.depth = builder.depth;
    this.parentSegmentLinkHash = builder.parentSegmentLinkHash;
    this.propertyKeyLinkHash = builder.propertyKeyLinkHash;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.startCol = builder.startCol;
    this.endCol = builder.endCol;

    this.generateHash();
  }

  static builder(
    segmentValue: string,
    segmentType: PropertyValueSegmentType,
    position: number,
    depth: number,
    propertyKeyLinkHash: string,
    startLine: number,
    endLine: number,
    startCol: number,
    endCol: number
  ): PropertyValueSegmentBuilder {
    return new PropertyValueSegmentBuilder(
      segmentValue,
      segmentType,
      position,
      depth,
      propertyKeyLinkHash,
      startLine,
      endLine,
      startCol,
      endCol
    );
  }

  getSegmentValue(): string {
    return this.segmentValue;
  }

  getSegmentType(): PropertyValueSegmentType {
    return this.segmentType;
  }

  getDefaultValue(): string {
    return this.defaultValue;
  }

  getPosition(): number {
    return this.position;
  }

  getDepth(): number {
    return this.depth;
  }

  getParentSegmentLinkHash(): string {
    return this.parentSegmentLinkHash;
  }

  getPropertyKeyLinkHash(): string {
    return this.propertyKeyLinkHash;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getEndLine(): number {
    return this.endLine;
  }

  getStartCol(): number {
    return this.startCol;
  }

  getEndCol(): number {
    return this.endCol;
  }

  getPropertyValueSegmentUniqueHash(): string {
    return this.propertyValueSegmentUniqueHash;
  }

  getHash(): string {
    return this.propertyValueSegmentUniqueHash;
  }

  generateHash(): void {
    const content =
      this.propertyKeyLinkHash +
      '||' +
      this.segmentValue +
      '||' +
      this.segmentType +
      '||' +
      this.position +
      '||' +
      this.depth +
      '||' +
      this.parentSegmentLinkHash +
      '||' +
      this.startLine +
      '||' +
      this.startCol;

    this.propertyValueSegmentUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PROPERTY_VALUE_SEGMENT,
      content
    );
  }

  getEntryCombined(): string {
    return `property_value_segment[value=${this.segmentValue}, type=${this.segmentType}, pos=${this.position}, depth=${this.depth}, line=${this.startLine}]`;
  }

  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.segmentValue),
      this.segmentType,
      EntityUtils.escapeTsv(this.defaultValue),
      this.position.toString(),
      this.depth.toString(),
      this.parentSegmentLinkHash,
      this.propertyKeyLinkHash,
      this.startLine.toString(),
      this.endLine.toString(),
      this.startCol.toString(),
      this.endCol.toString(),
      this.propertyValueSegmentUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'segmentValue',
      'segmentType',
      'defaultValue',
      'position',
      'depth',
      'parentSegmentLinkHash',
      'propertyKeyLinkHash',
      'startLine',
      'endLine',
      'startCol',
      'endCol',
      'propertyValueSegmentUniqueHash',
    ].join('\t');
  }
}

/**
 * Builder for PropertyValueSegment
 */
class PropertyValueSegmentBuilder {
  segmentValue: string;
  segmentType: PropertyValueSegmentType;
  defaultValue: string = '';
  position: number;
  depth: number;
  parentSegmentLinkHash: string = '';
  propertyKeyLinkHash: string;
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;

  constructor(
    segmentValue: string,
    segmentType: PropertyValueSegmentType,
    position: number,
    depth: number,
    propertyKeyLinkHash: string,
    startLine: number,
    endLine: number,
    startCol: number,
    endCol: number
  ) {
    this.segmentValue = segmentValue;
    this.segmentType = segmentType;
    this.position = position;
    this.depth = depth;
    this.propertyKeyLinkHash = propertyKeyLinkHash;
    this.startLine = startLine;
    this.endLine = endLine;
    this.startCol = startCol;
    this.endCol = endCol;
  }

  withDefaultValue(defaultValue: string): PropertyValueSegmentBuilder {
    this.defaultValue = defaultValue;
    return this;
  }

  withParentSegmentLinkHash(hash: string): PropertyValueSegmentBuilder {
    this.parentSegmentLinkHash = hash;
    return this;
  }

  build(): PropertyValueSegment {
    return new (PropertyValueSegment as any)(this);
  }
}
