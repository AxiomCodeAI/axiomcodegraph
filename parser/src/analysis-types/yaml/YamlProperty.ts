import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { YamlValueType } from '@/enums/yaml/YamlValueType';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a flattened key-value pair extracted from a YAML document.
 *
 * YAML nested structure is flattened into dot-separated paths:
 * ```yaml
 * server:
 *   port: 8080          # key="server.port", value="8080"
 *   hosts:
 *     - localhost        # key="server.hosts[0]", value="localhost"
 *     - remote           # key="server.hosts[1]", value="remote"
 * ```
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. key, value, valueType, depth, isListItem, listIndex
 * 2. anchorName, isAlias, documentIndex
 * 3. filePath, baseMservPath, startLine, endLine
 * 4. parentPropertyHash, serviceVersionLinkHash
 * 5. yamlPropertyUniqueHash (LAST)
 */
export class YamlProperty implements EntityIdentifiable {
  private key: string;
  private value: string;
  private valueType: YamlValueType;
  private depth: number;
  private isListItem: boolean;
  private listIndex: number;
  private anchorName: string;
  private isAlias: boolean;
  private documentIndex: number;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private parentPropertyHash: string;
  private serviceVersionLinkHash: string;
  private yamlPropertyUniqueHash: string = '';

  private constructor(builder: YamlPropertyBuilder) {
    this.key = builder.key;
    this.value = builder.value;
    this.valueType = builder.valueType;
    this.depth = builder.depth;
    this.isListItem = builder.isListItem;
    this.listIndex = builder.listIndex;
    this.anchorName = builder.anchorName;
    this.isAlias = builder.isAlias;
    this.documentIndex = builder.documentIndex;
    this.filePath = builder.filePath;
    this.baseMservPath = builder.baseMservPath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.parentPropertyHash = builder.parentPropertyHash;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    key: string,
    value: string,
    valueType: YamlValueType,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ): YamlPropertyBuilder {
    return new YamlPropertyBuilder(
      key,
      value,
      valueType,
      filePath,
      baseMservPath,
      startLine,
      endLine,
      serviceVersionLinkHash
    );
  }

  getKey(): string {
    return this.key;
  }

  getValue(): string {
    return this.value;
  }

  getValueType(): YamlValueType {
    return this.valueType;
  }

  getDepth(): number {
    return this.depth;
  }

  getIsListItem(): boolean {
    return this.isListItem;
  }

  getListIndex(): number {
    return this.listIndex;
  }

  getAnchorName(): string {
    return this.anchorName;
  }

  getIsAlias(): boolean {
    return this.isAlias;
  }

  getDocumentIndex(): number {
    return this.documentIndex;
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

  getParentPropertyHash(): string {
    return this.parentPropertyHash;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getYamlPropertyUniqueHash(): string {
    return this.yamlPropertyUniqueHash;
  }

  getHash(): string {
    return this.yamlPropertyUniqueHash;
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
      this.key +
      '||' +
      this.filePath +
      '||' +
      this.baseMservPath +
      '||' +
      this.startLine +
      '||' +
      this.documentIndex +
      '||' +
      this.serviceVersionLinkHash;

    this.yamlPropertyUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.YAML_PROPERTY,
      content
    );
  }

  getEntryCombined(): string {
    return `yaml_property[key=${this.key}, type=${this.valueType}, line=${this.startLine}, file=${this.filePath}]`;
  }

  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.key),
      EntityUtils.escapeTsv(this.value),
      this.valueType,
      this.depth.toString(),
      this.isListItem.toString(),
      this.listIndex.toString(),
      this.anchorName,
      this.isAlias.toString(),
      this.documentIndex.toString(),
      this.filePath,
      this.baseMservPath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.parentPropertyHash,
      this.serviceVersionLinkHash,
      this.yamlPropertyUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'key',
      'value',
      'valueType',
      'depth',
      'isListItem',
      'listIndex',
      'anchorName',
      'isAlias',
      'documentIndex',
      'filePath',
      'baseMservPath',
      'startLine',
      'endLine',
      'parentPropertyHash',
      'serviceVersionLinkHash',
      'yamlPropertyUniqueHash',
    ].join('\t');
  }
}

/**
 * Builder for YamlProperty
 */
class YamlPropertyBuilder {
  key: string;
  value: string;
  valueType: YamlValueType;
  depth: number = 0;
  isListItem: boolean = false;
  listIndex: number = -1;
  anchorName: string = '';
  isAlias: boolean = false;
  documentIndex: number = 0;
  filePath: string;
  baseMservPath: string;
  startLine: number;
  endLine: number;
  parentPropertyHash: string = '';
  serviceVersionLinkHash: string;

  constructor(
    key: string,
    value: string,
    valueType: YamlValueType,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ) {
    this.key = key;
    this.value = value;
    this.valueType = valueType;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withDepth(depth: number): YamlPropertyBuilder {
    this.depth = depth;
    return this;
  }

  withIsListItem(isListItem: boolean): YamlPropertyBuilder {
    this.isListItem = isListItem;
    return this;
  }

  withListIndex(listIndex: number): YamlPropertyBuilder {
    this.listIndex = listIndex;
    return this;
  }

  withAnchorName(anchorName: string): YamlPropertyBuilder {
    this.anchorName = anchorName;
    return this;
  }

  withIsAlias(isAlias: boolean): YamlPropertyBuilder {
    this.isAlias = isAlias;
    return this;
  }

  withDocumentIndex(documentIndex: number): YamlPropertyBuilder {
    this.documentIndex = documentIndex;
    return this;
  }

  withParentPropertyHash(hash: string): YamlPropertyBuilder {
    this.parentPropertyHash = hash;
    return this;
  }

  build(): YamlProperty {
    return new (YamlProperty as any)(this);
  }
}
