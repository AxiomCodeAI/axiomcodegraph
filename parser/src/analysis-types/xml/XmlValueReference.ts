import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { XmlValueReferenceType } from '@/enums/xml/XmlValueReferenceType';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a ${...} or #{...} value reference found inside XML text content
 * or attribute values.
 *
 * Captures property placeholders, environment variable references, SpEL expressions,
 * and placeholders with default values.
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. referenceExpression, referenceType, defaultValue, rawValue
 * 2. ownerElementHash, ownerAttributeName, depth
 * 3. filePath, baseMservPath, startLine, endLine
 * 4. serviceVersionLinkHash
 * 5. xmlValueReferenceUniqueHash (LAST)
 */
export class XmlValueReference implements EntityIdentifiable {
  private referenceExpression: string;
  private referenceType: XmlValueReferenceType;
  private defaultValue: string;
  private rawValue: string;
  private ownerElementHash: string;
  private ownerAttributeName: string;
  private depth: number;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private serviceVersionLinkHash: string;
  private xmlValueReferenceUniqueHash: string = '';

  private constructor(builder: XmlValueReferenceBuilder) {
    this.referenceExpression = builder.referenceExpression;
    this.referenceType = builder.referenceType;
    this.defaultValue = builder.defaultValue;
    this.rawValue = builder.rawValue;
    this.ownerElementHash = builder.ownerElementHash;
    this.ownerAttributeName = builder.ownerAttributeName;
    this.depth = builder.depth;
    this.filePath = builder.filePath;
    this.baseMservPath = builder.baseMservPath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    referenceExpression: string,
    referenceType: XmlValueReferenceType,
    rawValue: string,
    ownerElementHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ): XmlValueReferenceBuilder {
    return new XmlValueReferenceBuilder(
      referenceExpression, referenceType, rawValue, ownerElementHash,
      filePath, baseMservPath, startLine, endLine, serviceVersionLinkHash
    );
  }

  getReferenceExpression(): string { return this.referenceExpression; }
  getReferenceType(): XmlValueReferenceType { return this.referenceType; }
  getDefaultValue(): string { return this.defaultValue; }
  getRawValue(): string { return this.rawValue; }
  getOwnerElementHash(): string { return this.ownerElementHash; }
  getOwnerAttributeName(): string { return this.ownerAttributeName; }
  getDepth(): number { return this.depth; }
  getFilePath(): string { return this.filePath; }
  getBaseMservPath(): string { return this.baseMservPath; }
  getStartLine(): number { return this.startLine; }
  getEndLine(): number { return this.endLine; }
  getServiceVersionLinkHash(): string { return this.serviceVersionLinkHash; }

  getHash(): string {
    return this.xmlValueReferenceUniqueHash;
  }

  generateHash(): void {
    const content =
      this.referenceExpression +
      '||' + this.referenceType +
      '||' + this.rawValue +
      '||' + this.ownerElementHash +
      '||' + this.ownerAttributeName +
      '||' + this.depth +
      '||' + this.filePath +
      '||' + this.startLine +
      '||' + this.serviceVersionLinkHash;

    this.xmlValueReferenceUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.XML_VALUE_REFERENCE,
      content
    );
  }

  getEntryCombined(): string {
    return `xml_value_ref[expr=${this.referenceExpression}, type=${this.referenceType}, line=${this.startLine}, file=${this.filePath}]`;
  }

  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.referenceExpression),
      this.referenceType,
      EntityUtils.escapeTsv(this.defaultValue),
      EntityUtils.escapeTsv(this.rawValue),
      this.ownerElementHash,
      this.ownerAttributeName,
      this.depth.toString(),
      this.filePath,
      this.baseMservPath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.serviceVersionLinkHash,
      this.xmlValueReferenceUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'referenceExpression',
      'referenceType',
      'defaultValue',
      'rawValue',
      'ownerElementHash',
      'ownerAttributeName',
      'depth',
      'filePath',
      'baseMservPath',
      'startLine',
      'endLine',
      'serviceVersionLinkHash',
      'xmlValueReferenceUniqueHash',
    ].join('\t');
  }
}

class XmlValueReferenceBuilder {
  referenceExpression: string;
  referenceType: XmlValueReferenceType;
  defaultValue: string = '';
  rawValue: string;
  ownerElementHash: string;
  ownerAttributeName: string = '';
  depth: number = 0;
  filePath: string;
  baseMservPath: string;
  startLine: number;
  endLine: number;
  serviceVersionLinkHash: string;

  constructor(
    referenceExpression: string,
    referenceType: XmlValueReferenceType,
    rawValue: string,
    ownerElementHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ) {
    this.referenceExpression = referenceExpression;
    this.referenceType = referenceType;
    this.rawValue = rawValue;
    this.ownerElementHash = ownerElementHash;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withDefaultValue(defaultValue: string): XmlValueReferenceBuilder {
    this.defaultValue = defaultValue;
    return this;
  }

  withOwnerAttributeName(name: string): XmlValueReferenceBuilder {
    this.ownerAttributeName = name;
    return this;
  }

  withDepth(depth: number): XmlValueReferenceBuilder {
    this.depth = depth;
    return this;
  }

  build(): XmlValueReference {
    return new (XmlValueReference as any)(this);
  }
}
