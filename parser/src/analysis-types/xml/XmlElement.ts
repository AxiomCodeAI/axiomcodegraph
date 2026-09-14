import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a single XML element node extracted from an XML document.
 *
 * Captures the full structural information of each element:
 * - Tag name and namespace
 * - XPath location within the document
 * - Nesting depth
 * - Direct text content (leaf nodes)
 * - Parent element linkage via hash
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. tagName, namespace, namespacePrefix, xPath, depth, textContent
 * 2. isSelfClosing, childCount
 * 3. filePath, baseMservPath, startLine, endLine
 * 4. parentElementHash, serviceVersionLinkHash
 * 5. xmlElementUniqueHash (LAST)
 */
export class XmlElement implements EntityIdentifiable {
  private tagName: string;
  private namespace: string;
  private namespacePrefix: string;
  private xPath: string;
  private depth: number;
  private textContent: string;
  private isSelfClosing: boolean;
  private childCount: number;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private parentElementHash: string;
  private serviceVersionLinkHash: string;
  private xmlElementUniqueHash: string = '';

  private constructor(builder: XmlElementBuilder) {
    this.tagName = builder.tagName;
    this.namespace = builder.namespace;
    this.namespacePrefix = builder.namespacePrefix;
    this.xPath = builder.xPath;
    this.depth = builder.depth;
    this.textContent = builder.textContent;
    this.isSelfClosing = builder.isSelfClosing;
    this.childCount = builder.childCount;
    this.filePath = builder.filePath;
    this.baseMservPath = builder.baseMservPath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.parentElementHash = builder.parentElementHash;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    tagName: string,
    xPath: string,
    depth: number,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ): XmlElementBuilder {
    return new XmlElementBuilder(
      tagName, xPath, depth, filePath, baseMservPath,
      startLine, endLine, serviceVersionLinkHash
    );
  }

  getTagName(): string { return this.tagName; }
  getNamespace(): string { return this.namespace; }
  getNamespacePrefix(): string { return this.namespacePrefix; }
  getXPath(): string { return this.xPath; }
  getDepth(): number { return this.depth; }
  getTextContent(): string { return this.textContent; }
  getIsSelfClosing(): boolean { return this.isSelfClosing; }
  getChildCount(): number { return this.childCount; }
  getFilePath(): string { return this.filePath; }
  getBaseMservPath(): string { return this.baseMservPath; }
  getStartLine(): number { return this.startLine; }
  getEndLine(): number { return this.endLine; }
  getParentElementHash(): string { return this.parentElementHash; }
  getServiceVersionLinkHash(): string { return this.serviceVersionLinkHash; }

  getHash(): string {
    return this.xmlElementUniqueHash;
  }

  generateHash(): void {
    const content =
      this.tagName +
      '||' + this.xPath +
      '||' + this.filePath +
      '||' + this.baseMservPath +
      '||' + this.startLine +
      '||' + this.serviceVersionLinkHash;

    this.xmlElementUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.XML_ELEMENT,
      content
    );
  }

  getEntryCombined(): string {
    return `xml_element[tag=${this.tagName}, xPath=${this.xPath}, line=${this.startLine}, file=${this.filePath}]`;
  }

  toCsv(): string {
    return [
      this.tagName,
      this.namespace,
      this.namespacePrefix,
      this.xPath,
      this.depth.toString(),
      EntityUtils.escapeTsv(this.textContent),
      this.isSelfClosing.toString(),
      this.childCount.toString(),
      this.filePath,
      this.baseMservPath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.parentElementHash,
      this.serviceVersionLinkHash,
      this.xmlElementUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'tagName',
      'namespace',
      'namespacePrefix',
      'xPath',
      'depth',
      'textContent',
      'isSelfClosing',
      'childCount',
      'filePath',
      'baseMservPath',
      'startLine',
      'endLine',
      'parentElementHash',
      'serviceVersionLinkHash',
      'xmlElementUniqueHash',
    ].join('\t');
  }
}

class XmlElementBuilder {
  tagName: string;
  namespace: string = '';
  namespacePrefix: string = '';
  xPath: string;
  depth: number;
  textContent: string = '';
  isSelfClosing: boolean = false;
  childCount: number = 0;
  filePath: string;
  baseMservPath: string;
  startLine: number;
  endLine: number;
  parentElementHash: string = '';
  serviceVersionLinkHash: string;

  constructor(
    tagName: string,
    xPath: string,
    depth: number,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ) {
    this.tagName = tagName;
    this.xPath = xPath;
    this.depth = depth;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withNamespace(namespace: string): XmlElementBuilder {
    this.namespace = namespace;
    return this;
  }

  withNamespacePrefix(prefix: string): XmlElementBuilder {
    this.namespacePrefix = prefix;
    return this;
  }

  withTextContent(text: string): XmlElementBuilder {
    this.textContent = text;
    return this;
  }

  withIsSelfClosing(isSelfClosing: boolean): XmlElementBuilder {
    this.isSelfClosing = isSelfClosing;
    return this;
  }

  withChildCount(count: number): XmlElementBuilder {
    this.childCount = count;
    return this;
  }

  withParentElementHash(hash: string): XmlElementBuilder {
    this.parentElementHash = hash;
    return this;
  }

  build(): XmlElement {
    return new (XmlElement as any)(this);
  }
}
