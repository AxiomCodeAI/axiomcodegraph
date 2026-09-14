import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { PropertyDelimiter } from '@/enums/properties/PropertyDelimiter';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a key in a .properties file.
 *
 * PropertyKey captures property key declarations, including:
 * - Simple keys: `app.name=value`
 * - Keys with different delimiters: `=`, `:`, whitespace, or none
 * - Unicode-escaped keys: `\u0041pp.key=value`
 * - Multi-line keys: `app.multi\\\n  .line.key=value`
 * - No-value keys: `some.flag` (value defaults to empty string)
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. key, rawKey, delimiter, hasValue, isMultiLineKey, isMultiLineValue
 * 2. filePath, baseMservPath, startLine, endLine, startCol, endCol
 * 3. serviceVersionLinkHash
 * 4. propertyKeyUniqueHash (LAST)
 */
export class PropertyKey implements EntityIdentifiable {
  private key: string;
  private rawKey: string;
  private delimiter: PropertyDelimiter;
  private hasValue: boolean;
  private isMultiLineKey: boolean;
  private isMultiLineValue: boolean;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private startCol: number;
  private endCol: number;
  private serviceVersionLinkHash: string;
  private propertyKeyUniqueHash: string = '';

  private constructor(builder: PropertyKeyBuilder) {
    this.key = builder.key;
    this.rawKey = builder.rawKey;
    this.delimiter = builder.delimiter;
    this.hasValue = builder.hasValue;
    this.isMultiLineKey = builder.isMultiLineKey;
    this.isMultiLineValue = builder.isMultiLineValue;
    this.filePath = builder.filePath;
    this.baseMservPath = builder.baseMservPath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.startCol = builder.startCol;
    this.endCol = builder.endCol;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    key: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startCol: number,
    endCol: number,
    delimiter: PropertyDelimiter,
    serviceVersionLinkHash: string
  ): PropertyKeyBuilder {
    return new PropertyKeyBuilder(
      key,
      filePath,
      baseMservPath,
      startLine,
      endLine,
      startCol,
      endCol,
      delimiter,
      serviceVersionLinkHash
    );
  }

  getKey(): string {
    return this.key;
  }

  getRawKey(): string {
    return this.rawKey;
  }

  getDelimiter(): PropertyDelimiter {
    return this.delimiter;
  }

  getHasValue(): boolean {
    return this.hasValue;
  }

  getIsMultiLineKey(): boolean {
    return this.isMultiLineKey;
  }

  getIsMultiLineValue(): boolean {
    return this.isMultiLineValue;
  }

  getFilePath(): string {
    return this.filePath;
  }

  getBaseMservPath(): string {
    return this.baseMservPath;
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

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getPropertyKeyUniqueHash(): string {
    return this.propertyKeyUniqueHash;
  }

  getHash(): string {
    return this.propertyKeyUniqueHash;
  }

  generateHash(): void {
    const content =
      this.key +
      '||' +
      this.filePath +
      '||' +
      this.baseMservPath +
      '||' +
      this.startLine +
      '||' +
      this.serviceVersionLinkHash;

    this.propertyKeyUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PROPERTY_KEY,
      content
    );
  }

  getEntryCombined(): string {
    return `property_key[key=${this.key}, delimiter=${this.delimiter}, line=${this.startLine}, file=${this.filePath}]`;
  }

  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.key),
      EntityUtils.escapeTsv(this.rawKey),
      this.delimiter,
      this.hasValue.toString(),
      this.isMultiLineKey.toString(),
      this.isMultiLineValue.toString(),
      this.filePath,
      this.baseMservPath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.startCol.toString(),
      this.endCol.toString(),
      this.serviceVersionLinkHash,
      this.propertyKeyUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'key',
      'rawKey',
      'delimiter',
      'hasValue',
      'isMultiLineKey',
      'isMultiLineValue',
      'filePath',
      'baseMservPath',
      'startLine',
      'endLine',
      'startCol',
      'endCol',
      'serviceVersionLinkHash',
      'propertyKeyUniqueHash',
    ].join('\t');
  }
}

/**
 * Builder for PropertyKey
 */
class PropertyKeyBuilder {
  key: string;
  rawKey: string;
  filePath: string;
  baseMservPath: string;
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
  delimiter: PropertyDelimiter;
  hasValue: boolean = true;
  isMultiLineKey: boolean = false;
  isMultiLineValue: boolean = false;
  serviceVersionLinkHash: string;

  constructor(
    key: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startCol: number,
    endCol: number,
    delimiter: PropertyDelimiter,
    serviceVersionLinkHash: string
  ) {
    this.key = key;
    this.rawKey = key;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.startCol = startCol;
    this.endCol = endCol;
    this.delimiter = delimiter;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withRawKey(rawKey: string): PropertyKeyBuilder {
    this.rawKey = rawKey;
    return this;
  }

  withHasValue(hasValue: boolean): PropertyKeyBuilder {
    this.hasValue = hasValue;
    return this;
  }

  withIsMultiLineKey(isMultiLineKey: boolean): PropertyKeyBuilder {
    this.isMultiLineKey = isMultiLineKey;
    return this;
  }

  withIsMultiLineValue(isMultiLineValue: boolean): PropertyKeyBuilder {
    this.isMultiLineValue = isMultiLineValue;
    return this;
  }

  build(): PropertyKey {
    return new (PropertyKey as any)(this);
  }
}
