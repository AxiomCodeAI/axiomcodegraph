import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a single attribute on an XML element.
 *
 * Captures every attribute found on every element in an XML document,
 * linked back to the owning element via parentElementHash.
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. name, value, namespace
 * 2. filePath, baseMservPath, startLine, endLine
 * 3. parentElementHash, serviceVersionLinkHash
 * 4. xmlAttributeUniqueHash (LAST)
 */
export class XmlAttribute implements EntityIdentifiable {
  private name: string;
  private value: string;
  private namespace: string;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private parentElementHash: string;
  private serviceVersionLinkHash: string;
  private xmlAttributeUniqueHash: string = '';

  private constructor(builder: XmlAttributeBuilder) {
    this.name = builder.name;
    this.value = builder.value;
    this.namespace = builder.namespace;
    this.filePath = builder.filePath;
    this.baseMservPath = builder.baseMservPath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.parentElementHash = builder.parentElementHash;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    name: string,
    value: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    parentElementHash: string,
    serviceVersionLinkHash: string
  ): XmlAttributeBuilder {
    return new XmlAttributeBuilder(
      name, value, filePath, baseMservPath,
      startLine, endLine, parentElementHash, serviceVersionLinkHash
    );
  }

  getName(): string { return this.name; }
  getValue(): string { return this.value; }
  getNamespace(): string { return this.namespace; }
  getFilePath(): string { return this.filePath; }
  getBaseMservPath(): string { return this.baseMservPath; }
  getStartLine(): number { return this.startLine; }
  getEndLine(): number { return this.endLine; }
  getParentElementHash(): string { return this.parentElementHash; }
  getServiceVersionLinkHash(): string { return this.serviceVersionLinkHash; }

  getHash(): string {
    return this.xmlAttributeUniqueHash;
  }

  generateHash(): void {
    const content =
      this.name +
      '||' + this.value +
      '||' + this.parentElementHash +
      '||' + this.filePath +
      '||' + this.startLine +
      '||' + this.serviceVersionLinkHash;

    this.xmlAttributeUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.XML_ATTRIBUTE,
      content
    );
  }

  getEntryCombined(): string {
    return `xml_attribute[name=${this.name}, value=${this.value}, line=${this.startLine}, file=${this.filePath}]`;
  }

  toCsv(): string {
    return [
      this.name,
      EntityUtils.escapeTsv(this.value),
      this.namespace,
      this.filePath,
      this.baseMservPath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.parentElementHash,
      this.serviceVersionLinkHash,
      this.xmlAttributeUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'name',
      'value',
      'namespace',
      'filePath',
      'baseMservPath',
      'startLine',
      'endLine',
      'parentElementHash',
      'serviceVersionLinkHash',
      'xmlAttributeUniqueHash',
    ].join('\t');
  }
}

class XmlAttributeBuilder {
  name: string;
  value: string;
  namespace: string = '';
  filePath: string;
  baseMservPath: string;
  startLine: number;
  endLine: number;
  parentElementHash: string;
  serviceVersionLinkHash: string;

  constructor(
    name: string,
    value: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    parentElementHash: string,
    serviceVersionLinkHash: string
  ) {
    this.name = name;
    this.value = value;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.parentElementHash = parentElementHash;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withNamespace(namespace: string): XmlAttributeBuilder {
    this.namespace = namespace;
    return this;
  }

  build(): XmlAttribute {
    return new (XmlAttribute as any)(this);
  }
}
