import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { YamlValueSegmentType } from '@/enums/yaml/YamlValueSegmentType';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a single segment within a YAML property value expression.
 *
 * YAML values are decomposed into segments to capture the structure of
 * references, defaults, and literal text — identical to properties parsing.
 *
 * ## Nesting via depth + parentSegmentLinkHash
 *
 * For `${PRIMARY:${SECONDARY:fallback}}`:
 * - depth=0: PRIMARY (ENV_VARIABLE)
 * - depth=1: SECONDARY (ENV_WITH_DEFAULT, defaultValue="fallback"), parent # PRIMARY
 *
 * ## Mixed Example
 *
 * For `jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${db.name}`:
 * - pos=0, depth=0: LITERAL "jdbc:postgresql://"
 * - pos=1, depth=0: ENV_WITH_DEFAULT "DB_HOST", default="localhost"
 * - pos=2, depth=0: LITERAL ":"
 * - pos=3, depth=0: ENV_WITH_DEFAULT "DB_PORT", default="5432"
 * - pos=4, depth=0: LITERAL "/"
 * - pos=5, depth=0: PROPERTY_REFERENCE "db.name"
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. segmentValue, segmentType, defaultValue, position, depth
 * 2. parentSegmentLinkHash, yamlPropertyLinkHash
 * 3. startLine, endLine, startCol, endCol
 * 4. yamlValueSegmentUniqueHash (LAST)
 */
export class YamlValueSegment implements EntityIdentifiable {
  private segmentValue: string;
  private segmentType: YamlValueSegmentType;
  private defaultValue: string;
  private position: number;
  private depth: number;
  private parentSegmentLinkHash: string;
  private yamlPropertyLinkHash: string;
  private startLine: number;
  private endLine: number;
  private startCol: number;
  private endCol: number;
  private yamlValueSegmentUniqueHash: string = '';

  private constructor(builder: YamlValueSegmentBuilder) {
    this.segmentValue = builder.segmentValue;
    this.segmentType = builder.segmentType;
    this.defaultValue = builder.defaultValue;
    this.position = builder.position;
    this.depth = builder.depth;
    this.parentSegmentLinkHash = builder.parentSegmentLinkHash;
    this.yamlPropertyLinkHash = builder.yamlPropertyLinkHash;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.startCol = builder.startCol;
    this.endCol = builder.endCol;

    this.generateHash();
  }

  static builder(
    segmentValue: string,
    segmentType: YamlValueSegmentType,
    position: number,
    depth: number,
    yamlPropertyLinkHash: string,
    startLine: number,
    endLine: number,
    startCol: number,
    endCol: number
  ): YamlValueSegmentBuilder {
    return new YamlValueSegmentBuilder(
      segmentValue,
      segmentType,
      position,
      depth,
      yamlPropertyLinkHash,
      startLine,
      endLine,
      startCol,
      endCol
    );
  }

  getSegmentValue(): string {
    return this.segmentValue;
  }

  getSegmentType(): YamlValueSegmentType {
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

  getYamlPropertyLinkHash(): string {
    return this.yamlPropertyLinkHash;
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

  getYamlValueSegmentUniqueHash(): string {
    return this.yamlValueSegmentUniqueHash;
  }

  getHash(): string {
    return this.yamlValueSegmentUniqueHash;
  }

  /**
   * Adjusts line numbers by adding an offset. Used when parsing chunked YAML
   * files where each chunk's lines are relative to the chunk start.
   * Regenerates the hash since startLine is part of it.
   */
  adjustLineNumbers(lineOffset: number): void {
    this.startLine += lineOffset;
    this.endLine += lineOffset;
    this.generateHash();
  }

  generateHash(): void {
    const content =
      this.yamlPropertyLinkHash +
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

    this.yamlValueSegmentUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.YAML_VALUE_SEGMENT,
      content
    );
  }

  getEntryCombined(): string {
    return `yaml_value_segment[value=${this.segmentValue}, type=${this.segmentType}, pos=${this.position}, depth=${this.depth}, line=${this.startLine}]`;
  }

  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.segmentValue),
      this.segmentType,
      EntityUtils.escapeTsv(this.defaultValue),
      this.position.toString(),
      this.depth.toString(),
      this.parentSegmentLinkHash,
      this.yamlPropertyLinkHash,
      this.startLine.toString(),
      this.endLine.toString(),
      this.startCol.toString(),
      this.endCol.toString(),
      this.yamlValueSegmentUniqueHash,
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
      'yamlPropertyLinkHash',
      'startLine',
      'endLine',
      'startCol',
      'endCol',
      'yamlValueSegmentUniqueHash',
    ].join('\t');
  }
}

/**
 * Builder for YamlValueSegment
 */
class YamlValueSegmentBuilder {
  segmentValue: string;
  segmentType: YamlValueSegmentType;
  defaultValue: string = '';
  position: number;
  depth: number;
  parentSegmentLinkHash: string = '';
  yamlPropertyLinkHash: string;
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;

  constructor(
    segmentValue: string,
    segmentType: YamlValueSegmentType,
    position: number,
    depth: number,
    yamlPropertyLinkHash: string,
    startLine: number,
    endLine: number,
    startCol: number,
    endCol: number
  ) {
    this.segmentValue = segmentValue;
    this.segmentType = segmentType;
    this.position = position;
    this.depth = depth;
    this.yamlPropertyLinkHash = yamlPropertyLinkHash;
    this.startLine = startLine;
    this.endLine = endLine;
    this.startCol = startCol;
    this.endCol = endCol;
  }

  withDefaultValue(defaultValue: string): YamlValueSegmentBuilder {
    this.defaultValue = defaultValue;
    return this;
  }

  withParentSegmentLinkHash(hash: string): YamlValueSegmentBuilder {
    this.parentSegmentLinkHash = hash;
    return this;
  }

  build(): YamlValueSegment {
    return new (YamlValueSegment as any)(this);
  }
}
