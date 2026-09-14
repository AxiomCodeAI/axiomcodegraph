import * as YAML from 'yaml';

import { YamlProperty } from '@/analysis-types/yaml/YamlProperty';
import { YamlValueSegment } from '@/analysis-types/yaml/YamlValueSegment';
import { LARGE_FILE_LINE_THRESHOLD } from '@/constants/consts';
import { YamlValueSegmentType } from '@/enums/yaml/YamlValueSegmentType';
import { YamlValueType } from '@/enums/yaml/YamlValueType';

/**
 * Parser for YAML files (.yml / .yaml).
 *
 * Uses the `yaml` npm package (v2) which provides a full document model
 * with source position tracking via character offsets.
 *
 * Two-pass approach (same as properties parser):
 * 1. Parse all YAML keys to build a set of known property names
 * 2. Parse all values, classifying ${...} references as PROPERTY_REFERENCE
 *    when the name matches a known key, or ENV_VARIABLE otherwise
 */
export class YamlParser {
  private knownKeys: Set<string> = new Set();
  private lineOffsets: number[] = [];
  private keyHashMap: Map<string, string> = new Map();

  /**
   * Parses a YAML file and returns YamlProperty and YamlValueSegment entities.
   *
   * @param content File content
   * @param filePath Absolute path to the file
   * @param baseMservPath Project root path
   * @param serviceVersionLinkHash Service version hash
   * @returns Tuple of [YamlProperty[], YamlValueSegment[]]
   */
  // Files between CHUNK and SKIP thresholds use chunked parsing.
  // Files above SKIP threshold are too large and are skipped entirely.
  private static readonly CHUNK_LINE_THRESHOLD = 10_000;

  parse(
    content: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionLinkHash: string
  ): [YamlProperty[], YamlValueSegment[]] {
    const lineCount = content.split('\n').length;
    if (lineCount > LARGE_FILE_LINE_THRESHOLD) {
      console.log(`   ⏭️  Skipping very large file (${lineCount} lines): ${filePath}`);
      return [[], []];
    }
    if (lineCount > YamlParser.CHUNK_LINE_THRESHOLD) {
      console.log(`   ⚠️  Large file (${lineCount} lines), using chunked parse: ${filePath}`);
      return this.parseChunked(content, filePath, baseMservPath, serviceVersionLinkHash);
    }
    return this.parseInternal(content, filePath, baseMservPath, serviceVersionLinkHash);
  }

  /**
   * Standard single-pass parse for normal-sized YAML files.
   */
  private parseInternal(
    content: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionLinkHash: string
  ): [YamlProperty[], YamlValueSegment[]] {
    this.buildLineOffsets(content);

    const documents = YAML.parseAllDocuments(content, { merge: false });
    const allProperties: YamlProperty[] = [];
    const allSegments: YamlValueSegment[] = [];

    // Pass 1: Collect all known keys across all documents
    this.knownKeys = new Set<string>();
    for (let docIdx = 0; docIdx < documents.length; docIdx++) {
      const doc = documents[docIdx];
      if (doc && doc.contents) {
        this.collectKeys(doc.contents, '', this.knownKeys);
      }
    }

    // Pass 2: Extract YamlProperty and YamlValueSegment entities
    this.keyHashMap = new Map();
    for (let docIdx = 0; docIdx < documents.length; docIdx++) {
      const doc = documents[docIdx];
      if (doc && doc.contents) {
        this.extractProperties(
          doc.contents,
          '',
          0,
          docIdx,
          filePath,
          baseMservPath,
          serviceVersionLinkHash,
          allProperties,
          allSegments
        );
      }
    }

    return [allProperties, allSegments];
  }

  /**
   * Chunked parsing for files that blow the call stack in YAML.parseAllDocuments.
   *
   * Splits the file at top-level key boundaries (lines starting at column 0),
   * groups them into chunks, and parses each chunk as a standalone YAML document.
   * Line numbers are adjusted so entity positions are correct in the original file.
   */
  private parseChunked(
    content: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionLinkHash: string
  ): [YamlProperty[], YamlValueSegment[]] {
    const allProperties: YamlProperty[] = [];
    const allSegments: YamlValueSegment[] = [];

    const chunks = this.splitIntoTopLevelChunks(content);
    console.log(`   📦 Split into ${chunks.length} chunk(s)`);

    // Pass 1: Collect all known keys across all chunks
    this.knownKeys = new Set<string>();
    for (const chunk of chunks) {
      try {
        const docs = YAML.parseAllDocuments(chunk.text, { merge: false });
        for (const doc of docs) {
          if (doc && doc.contents) {
            this.collectKeys(doc.contents, '', this.knownKeys);
          }
        }
      } catch {
        // Skip chunks that still fail (extremely deeply nested single keys)
      }
    }

    // Pass 2: Extract entities from each chunk
    this.keyHashMap = new Map();
    for (const chunk of chunks) {
      try {
        this.buildLineOffsets(chunk.text);
        const docs = YAML.parseAllDocuments(chunk.text, { merge: false });

        for (let docIdx = 0; docIdx < docs.length; docIdx++) {
          const doc = docs[docIdx];
          if (doc && doc.contents) {
            const chunkProperties: YamlProperty[] = [];
            const chunkSegments: YamlValueSegment[] = [];

            this.extractProperties(
              doc.contents,
              '',
              0,
              docIdx,
              filePath,
              baseMservPath,
              serviceVersionLinkHash,
              chunkProperties,
              chunkSegments
            );

            // Adjust line numbers: shift by the chunk's starting line offset
            for (const prop of chunkProperties) {
              prop.adjustLineNumbers(chunk.startLine);
            }
            for (const seg of chunkSegments) {
              seg.adjustLineNumbers(chunk.startLine);
            }

            allProperties.push(...chunkProperties);
            allSegments.push(...chunkSegments);
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`   ❌ Chunk at line ${chunk.startLine + 1} failed: ${msg}`);
      }
    }

    return [allProperties, allSegments];
  }

  /**
   * Splits YAML content at top-level key boundaries into chunks.
   * A top-level boundary is a line that starts at column 0 with a non-whitespace,
   * non-comment character (i.e., a top-level mapping key or document marker).
   *
   * Groups consecutive top-level keys into chunks of ~CHUNK_KEY_COUNT keys each.
   */
  private splitIntoTopLevelChunks(
    content: string
  ): { text: string; startLine: number }[] {
    const CHUNK_KEY_COUNT = 200;
    const lines = content.split('\n');

    // Find top-level key boundary line indices
    const boundaries: number[] = [0]; // always start at line 0
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.length === 0) continue;
      const ch = line[0]!;
      // Top-level key: starts at column 0, not whitespace, not comment, not doc marker
      if (ch !== ' ' && ch !== '\t' && ch !== '#' && ch !== '-' && ch !== '.' && ch !== '\r') {
        boundaries.push(i);
      }
    }

    // Group boundaries into chunks
    const chunks: { text: string; startLine: number }[] = [];
    for (let i = 0; i < boundaries.length; i += CHUNK_KEY_COUNT) {
      const startIdx = boundaries[i]!;
      const endIdx = i + CHUNK_KEY_COUNT < boundaries.length
        ? boundaries[i + CHUNK_KEY_COUNT]!
        : lines.length;
      const chunkLines = lines.slice(startIdx, endIdx);
      chunks.push({
        text: chunkLines.join('\n'),
        startLine: startIdx  // 0-indexed line offset in original file
      });
    }

    return chunks;
  }

  /**
   * Build character offset → line number lookup table.
   */
  private buildLineOffsets(content: string): void {
    this.lineOffsets = [0]; // line 1 starts at offset 0
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '\n') {
        this.lineOffsets.push(i + 1);
      }
    }
  }

  /**
   * Convert a character offset to a 1-indexed line number.
   */
  private offsetToLine(offset: number): number {
    if (offset < 0) return 1;
    // Binary search for the line
    let lo = 0;
    let hi = this.lineOffsets.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.lineOffsets[mid]! <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo + 1; // 1-indexed
  }

  /**
   * Convert a character offset to a 0-indexed column number.
   */
  private offsetToCol(offset: number): number {
    if (offset < 0) return 0;
    const line = this.offsetToLine(offset);
    const lineStart = this.lineOffsets[line - 1] ?? 0;
    return offset - lineStart;
  }

  /**
   * Pass 1: Iteratively collect all flattened key paths (including container keys).
   * Uses an explicit stack to avoid call-stack overflow on deeply nested files.
   */
  private collectKeys(node: unknown, prefix: string, keys: Set<string>): void {
    const stack: { node: unknown; prefix: string }[] = [{ node, prefix }];

    while (stack.length > 0) {
      const frame = stack.pop()!;
      const currentNode = frame.node;
      const currentPrefix = frame.prefix;

      if (this.isYAMLMap(currentNode)) {
        for (const pair of (currentNode as any).items) {
          const key = this.getScalarValue(pair.key);
          if (key === null) continue;
          const fullKey = currentPrefix ? `${currentPrefix}.${key}` : key;
          keys.add(fullKey);
          if (this.isYAMLMap(pair.value) || this.isYAMLSeq(pair.value)) {
            stack.push({ node: pair.value, prefix: fullKey });
          }
        }
      } else if (this.isYAMLSeq(currentNode)) {
        const items = (currentNode as any).items;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const indexedKey = `${currentPrefix}[${i}]`;
          keys.add(indexedKey);
          if (this.isYAMLMap(item) || this.isYAMLSeq(item)) {
            stack.push({ node: item, prefix: indexedKey });
          }
        }
      }
    }
  }

  /**
   * Pass 2: Iteratively extract YamlProperty and YamlValueSegment entities.
   * Uses an explicit stack to avoid call-stack overflow on deeply nested files.
   */
  private extractProperties(
    node: unknown,
    prefix: string,
    depth: number,
    docIdx: number,
    filePath: string,
    baseMservPath: string,
    serviceVersionHash: string,
    properties: YamlProperty[],
    segments: YamlValueSegment[]
  ): void {
    const stack: { node: unknown; prefix: string; depth: number }[] =
      [{ node, prefix, depth }];

    while (stack.length > 0) {
      const frame = stack.pop()!;
      const currentNode = frame.node;
      const currentPrefix = frame.prefix;
      const currentDepth = frame.depth;
      const parentHash = this.lookupParentHash(currentPrefix, docIdx);

      if (this.isYAMLMap(currentNode)) {
        for (const pair of (currentNode as any).items) {
          const key = this.getScalarValue(pair.key);
          if (key === null) continue;
          const fullKey = currentPrefix ? `${currentPrefix}.${key}` : key;

          if (this.isYAMLMap(pair.value) || this.isYAMLSeq(pair.value)) {
            // Register container key as a MAP or SEQUENCE property
            this.createContainerProperty(
              pair,
              fullKey,
              currentDepth,
              false,
              -1,
              docIdx,
              parentHash,
              filePath,
              baseMservPath,
              serviceVersionHash,
              properties
            );
            stack.push({ node: pair.value, prefix: fullKey, depth: currentDepth + 1 });
          } else if (this.isAliasNode(pair.value)) {
            // Alias value (e.g., <<: *db-defaults) — register with alias info
            this.createAliasProperty(
              pair,
              fullKey,
              currentDepth,
              false,
              -1,
              docIdx,
              parentHash,
              filePath,
              baseMservPath,
              serviceVersionHash,
              properties
            );
          } else {
            // Leaf scalar value
            this.createPropertyAndSegments(
              pair,
              fullKey,
              currentDepth,
              false,
              -1,
              docIdx,
              parentHash,
              filePath,
              baseMservPath,
              serviceVersionHash,
              properties,
              segments
            );
          }
        }
      } else if (this.isYAMLSeq(currentNode)) {
        const items = (currentNode as any).items;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const indexedKey = `${currentPrefix}[${i}]`;

          if (this.isYAMLMap(item) || this.isYAMLSeq(item)) {
            // Register container list item as a MAP or SEQUENCE property
            this.createContainerProperty(
              { key: null, value: item },
              indexedKey,
              currentDepth,
              true,
              i,
              docIdx,
              parentHash,
              filePath,
              baseMservPath,
              serviceVersionHash,
              properties
            );
            stack.push({ node: item, prefix: indexedKey, depth: currentDepth + 1 });
          } else if (this.isAliasNode(item)) {
            // Alias in a list
            this.createAliasProperty(
              { key: null, value: item },
              indexedKey,
              currentDepth,
              true,
              i,
              docIdx,
              parentHash,
              filePath,
              baseMservPath,
              serviceVersionHash,
              properties
            );
          } else {
            // Leaf scalar in a list
            this.createLeafProperty(
              item,
              indexedKey,
              currentDepth,
              true,
              i,
              docIdx,
              parentHash,
              filePath,
              baseMservPath,
              serviceVersionHash,
              properties,
              segments
            );
          }
        }
      }
    }
  }

  /**
   * Lookup the parent property hash from the key-hash map.
   * Root-level properties (prefix='') have no parent.
   */
  private lookupParentHash(prefix: string, docIdx: number): string {
    if (!prefix) return '';
    return this.keyHashMap.get(`${docIdx}||${prefix}`) ?? '';
  }

  /**
   * Register a property's hash in the key-hash map for child lookup.
   */
  private registerPropertyHash(fullKey: string, docIdx: number, hash: string): void {
    this.keyHashMap.set(`${docIdx}||${fullKey}`, hash);
  }

  /**
   * Create a YamlProperty (and its value segments) from a Pair node.
   */
  private createPropertyAndSegments(
    pair: any,
    fullKey: string,
    depth: number,
    isListItem: boolean,
    listIndex: number,
    docIdx: number,
    parentHash: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionHash: string,
    properties: YamlProperty[],
    segments: YamlValueSegment[]
  ): void {
    const valueNode = pair.value;
    const rawValue = this.getNodeStringValue(valueNode);
    const valueType = this.classifyValueType(valueNode, rawValue);

    const startLine = this.getNodeLine(pair.key ?? pair.value ?? pair);
    const endLine = this.getNodeEndLine(valueNode) || startLine;

    const anchorName = this.getAnchorName(valueNode);
    const isAlias = this.isAliasNode(valueNode);

    const property = YamlProperty.builder(
      fullKey,
      rawValue,
      valueType,
      filePath,
      baseMservPath,
      startLine,
      endLine,
      serviceVersionHash
    )
      .withDepth(depth)
      .withIsListItem(isListItem)
      .withListIndex(listIndex)
      .withAnchorName(anchorName)
      .withIsAlias(isAlias)
      .withDocumentIndex(docIdx)
      .withParentPropertyHash(parentHash)
      .build();

    properties.push(property);
    this.registerPropertyHash(fullKey, docIdx, property.getHash());

    // Parse value segments
    this.extractValueSegments(
      rawValue,
      valueType,
      property,
      startLine,
      this.getValueStartCol(valueNode),
      segments
    );
  }

  /**
   * Create a YamlProperty for a leaf scalar inside a sequence.
   */
  private createLeafProperty(
    valueNode: any,
    fullKey: string,
    depth: number,
    isListItem: boolean,
    listIndex: number,
    docIdx: number,
    parentHash: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionHash: string,
    properties: YamlProperty[],
    segments: YamlValueSegment[]
  ): void {
    const rawValue = this.getNodeStringValue(valueNode);
    const valueType = this.classifyValueType(valueNode, rawValue);

    const startLine = this.getNodeLine(valueNode);
    const endLine = this.getNodeEndLine(valueNode) || startLine;

    const anchorName = this.getAnchorName(valueNode);
    const isAlias = this.isAliasNode(valueNode);

    const property = YamlProperty.builder(
      fullKey,
      rawValue,
      valueType,
      filePath,
      baseMservPath,
      startLine,
      endLine,
      serviceVersionHash
    )
      .withDepth(depth)
      .withIsListItem(isListItem)
      .withListIndex(listIndex)
      .withAnchorName(anchorName)
      .withIsAlias(isAlias)
      .withDocumentIndex(docIdx)
      .withParentPropertyHash(parentHash)
      .build();

    properties.push(property);
    this.registerPropertyHash(fullKey, docIdx, property.getHash());

    this.extractValueSegments(
      rawValue,
      valueType,
      property,
      startLine,
      this.getValueStartCol(valueNode),
      segments
    );
  }

  /**
   * Create a YamlProperty for a container key (MAP or SEQUENCE).
   * No value segments are created — only the property itself.
   */
  private createContainerProperty(
    pair: any,
    fullKey: string,
    depth: number,
    isListItem: boolean,
    listIndex: number,
    docIdx: number,
    parentHash: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionHash: string,
    properties: YamlProperty[]
  ): void {
    const valueNode = pair.value;
    const valueType = this.isYAMLSeq(valueNode)
      ? YamlValueType.SEQUENCE
      : YamlValueType.MAP;

    const startLine = this.getNodeLine(pair.key ?? valueNode);
    const endLine = this.getNodeEndLine(valueNode) || startLine;

    const anchorName = this.getAnchorName(valueNode);

    const property = YamlProperty.builder(
      fullKey,
      '',
      valueType,
      filePath,
      baseMservPath,
      startLine,
      endLine,
      serviceVersionHash
    )
      .withDepth(depth)
      .withIsListItem(isListItem)
      .withListIndex(listIndex)
      .withAnchorName(anchorName)
      .withIsAlias(false)
      .withDocumentIndex(docIdx)
      .withParentPropertyHash(parentHash)
      .build();

    properties.push(property);
    this.registerPropertyHash(fullKey, docIdx, property.getHash());
  }

  /**
   * Create a YamlProperty for an alias reference (e.g., <<: *db-defaults).
   * Records the alias source anchor name in the value field.
   */
  private createAliasProperty(
    pair: any,
    fullKey: string,
    depth: number,
    isListItem: boolean,
    listIndex: number,
    docIdx: number,
    parentHash: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionHash: string,
    properties: YamlProperty[]
  ): void {
    const aliasNode = pair.value;
    const aliasSource = (aliasNode as any).source ?? '';
    const aliasAnchorName = typeof aliasSource === 'string'
      ? aliasSource
      : this.getAnchorName(aliasSource) || String(aliasSource);

    const startLine = this.getNodeLine(pair.key ?? aliasNode);
    const endLine = startLine;

    const property = YamlProperty.builder(
      fullKey,
      `*${aliasAnchorName}`,
      YamlValueType.STRING,
      filePath,
      baseMservPath,
      startLine,
      endLine,
      serviceVersionHash
    )
      .withDepth(depth)
      .withIsListItem(isListItem)
      .withListIndex(listIndex)
      .withAnchorName('')
      .withIsAlias(true)
      .withDocumentIndex(docIdx)
      .withParentPropertyHash(parentHash)
      .build();

    properties.push(property);
    this.registerPropertyHash(fullKey, docIdx, property.getHash());
  }

  /**
   * Extract value segments (LITERAL, ENV_VARIABLE, etc.) from a scalar value.
   */
  private extractValueSegments(
    rawValue: string,
    valueType: YamlValueType,
    property: YamlProperty,
    baseLine: number,
    baseCol: number,
    segments: YamlValueSegment[]
  ): void {
    if (valueType === YamlValueType.EMPTY || valueType === YamlValueType.NULL) {
      const segment = YamlValueSegment.builder(
        rawValue,
        YamlValueSegmentType.EMPTY,
        0,
        0,
        property.getHash(),
        baseLine,
        baseLine,
        baseCol,
        baseCol
      ).build();
      segments.push(segment);
      return;
    }

    // Check if value contains any ${...} references
    if (!rawValue.includes('${')) {
      // Pure literal — split on commas for queryability
      const litSegments = this.createLiteralSegments(
        rawValue, 0, 0, property.getHash(), '', baseLine, baseCol
      );
      segments.push(...litSegments);
      return;
    }

    // Parse mixed value into segments
    const parsed = this.parseValueSegments(
      rawValue,
      property.getHash(),
      baseLine,
      baseCol,
      0,
      ''
    );
    segments.push(...parsed);
  }

  /**
   * Parse a value string into segments, recursively handling nested ${...} references.
   * Same algorithm as the properties parser.
   */
  private parseValueSegments(
    value: string,
    yamlPropertyLinkHash: string,
    baseLine: number,
    baseCol: number,
    depth: number,
    parentSegmentHash: string
  ): YamlValueSegment[] {
    const segments: YamlValueSegment[] = [];
    let pos = 0;
    let position = 0;
    let literalStart = 0;

    while (pos < value.length) {
      // Check for ${...} placeholder
      if (value[pos] === '$' && pos + 1 < value.length && value[pos + 1] === '{') {
        if (pos > literalStart) {
          const litText = value.substring(literalStart, pos);
          const litSegs = this.createLiteralSegments(
            litText, position, depth, yamlPropertyLinkHash, parentSegmentHash,
            baseLine, baseCol + literalStart
          );
          segments.push(...litSegs);
          position += litSegs.length;
        }

        const refStart = pos;
        const refEnd = this.findMatchingBrace(value, pos + 1);
        const refContent = value.substring(pos + 2, refEnd);

        const refSegments = this.parseReference(
          refContent,
          position,
          depth,
          yamlPropertyLinkHash,
          parentSegmentHash,
          baseLine,
          baseCol + refStart,
          baseCol + refEnd + 1
        );
        segments.push(...refSegments);

        position++;
        pos = refEnd + 1;
        literalStart = pos;
        continue;
      }

      pos++;
    }

    // Flush trailing literal
    if (literalStart < value.length) {
      const litText = value.substring(literalStart);
      const litSegs = this.createLiteralSegments(
        litText, position, depth, yamlPropertyLinkHash, parentSegmentHash,
        baseLine, baseCol + literalStart
      );
      segments.push(...litSegs);
    }

    return segments;
  }

  /**
   * Parse a reference content (inside ${...}) into segments.
   */
  private parseReference(
    content: string,
    position: number,
    depth: number,
    yamlPropertyLinkHash: string,
    parentSegmentHash: string,
    baseLine: number,
    startCol: number,
    endCol: number
  ): YamlValueSegment[] {
    const segments: YamlValueSegment[] = [];

    const colonPos = this.findTopLevelColon(content);

    let name: string;
    let defaultText: string | undefined;

    if (colonPos === -1) {
      name = content;
    } else {
      name = content.substring(0, colonPos);
      defaultText = content.substring(colonPos + 1);
    }

    // Determine segment type
    let segmentType: YamlValueSegmentType;
    if (defaultText !== undefined) {
      if (this.knownKeys.has(name)) {
        segmentType = YamlValueSegmentType.PROPERTY_REF_WITH_DEFAULT;
      } else {
        segmentType = YamlValueSegmentType.ENV_WITH_DEFAULT;
      }
    } else {
      if (this.knownKeys.has(name)) {
        segmentType = YamlValueSegmentType.PROPERTY_REFERENCE;
      } else {
        segmentType = YamlValueSegmentType.ENV_VARIABLE;
      }
    }

    const plainDefault = defaultText !== undefined ? defaultText : '';

    const refSegment = YamlValueSegment.builder(
      name,
      segmentType,
      position,
      depth,
      yamlPropertyLinkHash,
      baseLine,
      baseLine,
      startCol,
      endCol
    )
      .withDefaultValue(plainDefault)
      .withParentSegmentLinkHash(parentSegmentHash)
      .build();
    segments.push(refSegment);

    // If default contains nested ${...}, recursively parse children
    if (defaultText !== undefined && defaultText.includes('${')) {
      const childSegments = this.parseValueSegments(
        defaultText,
        yamlPropertyLinkHash,
        baseLine,
        startCol + 2 + name.length + 1,
        depth + 1,
        refSegment.getHash()
      );
      segments.push(...childSegments);
    }

    return segments;
  }

  /**
   * Find the first colon at top level (not inside nested ${...}).
   */
  private findTopLevelColon(content: string): number {
    let braceDepth = 0;
    for (let i = 0; i < content.length; i++) {
      const ch = content[i]!;
      if (ch === '$' && i + 1 < content.length && content[i + 1] === '{') {
        braceDepth++;
        i++;
      } else if (ch === '#' && i + 1 < content.length && content[i + 1] === '{') {
        braceDepth++;
        i++;
      } else if (ch === '}') {
        if (braceDepth > 0) braceDepth--;
      } else if (ch === ':' && braceDepth === 0) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Find matching closing brace for an opening { at position pos.
   */
  private findMatchingBrace(value: string, openBracePos: number): number {
    let depth = 1;
    let pos = openBracePos + 1;

    while (pos < value.length && depth > 0) {
      const ch = value[pos]!;
      if ((ch === '$' || ch === '#') && pos + 1 < value.length && value[pos + 1] === '{') {
        depth++;
        pos++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return pos;
        }
      }
      pos++;
    }

    return value.length - 1;
  }

  /**
   * Create LITERAL segment(s), splitting on commas for queryability.
   * If the text contains commas, each comma-delimited part becomes its own segment.
   */
  private createLiteralSegments(
    text: string,
    startPosition: number,
    depth: number,
    yamlPropertyLinkHash: string,
    parentSegmentHash: string,
    baseLine: number,
    startCol: number
  ): YamlValueSegment[] {
    const parts = text.split(',');

    // No commas — return single segment
    if (parts.length <= 1) {
      return [YamlValueSegment.builder(
        text,
        YamlValueSegmentType.LITERAL,
        startPosition,
        depth,
        yamlPropertyLinkHash,
        baseLine,
        baseLine,
        startCol,
        startCol + text.length
      )
        .withParentSegmentLinkHash(parentSegmentHash)
        .build()];
    }

    // Split on commas — each non-empty part becomes its own LITERAL segment
    const segments: YamlValueSegment[] = [];
    let colOffset = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const trimmed = part.trim();
      if (trimmed.length > 0) {
        const trimStart = part.indexOf(trimmed[0]!);
        segments.push(YamlValueSegment.builder(
          trimmed,
          YamlValueSegmentType.LITERAL,
          startPosition + segments.length,
          depth,
          yamlPropertyLinkHash,
          baseLine,
          baseLine,
          startCol + colOffset + trimStart,
          startCol + colOffset + trimStart + trimmed.length
        )
          .withParentSegmentLinkHash(parentSegmentHash)
          .build());
      }
      colOffset += part.length + 1; // +1 for the comma
    }
    return segments;
  }

  // =========================================================================
  // YAML node type guards and utility methods
  // =========================================================================

  private isYAMLMap(node: unknown): boolean {
    return node != null && typeof node === 'object' && (node as any).constructor?.name === 'YAMLMap';
  }

  private isYAMLSeq(node: unknown): boolean {
    return node != null && typeof node === 'object' && (node as any).constructor?.name === 'YAMLSeq';
  }

  private isAliasNode(node: unknown): boolean {
    return node != null && typeof node === 'object' && (node as any).constructor?.name === 'Alias';
  }

  private getScalarValue(node: unknown): string | null {
    if (node == null) return null;
    if (typeof node === 'object' && 'value' in (node as any)) {
      const val = (node as any).value;
      return val != null ? String(val) : null;
    }
    return typeof node === 'string' ? node : null;
  }

  private getNodeStringValue(node: unknown): string {
    if (node == null) return '';
    if (typeof node === 'object' && 'value' in (node as any)) {
      const val = (node as any).value;
      if (val == null) return '';
      // Handle binary data (!!binary tag) - keep as base64
      if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
        return '[binary:' + Buffer.from(val).toString('base64') + ']';
      }
      return String(val);
    }
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      return String(node);
    }
    return '';
  }

  private classifyValueType(node: unknown, rawValue: string): YamlValueType {
    if (node == null) return YamlValueType.EMPTY;

    const val = typeof node === 'object' && 'value' in (node as any) ? (node as any).value : node;

    if (val === null || val === undefined) return YamlValueType.NULL;
    if (rawValue === '' || rawValue === '~') return rawValue === '~' ? YamlValueType.NULL : YamlValueType.EMPTY;

    if (typeof val === 'boolean') return YamlValueType.BOOLEAN;
    if (typeof val === 'number') {
      return Number.isInteger(val) ? YamlValueType.INTEGER : YamlValueType.FLOAT;
    }

    // Check string value for boolean-like patterns the yaml parser may have kept as strings
    const lower = rawValue.toLowerCase();
    if (['true', 'false', 'yes', 'no', 'on', 'off'].includes(lower)) {
      return YamlValueType.BOOLEAN;
    }

    // Check for integer pattern
    if (/^-?\d+$/.test(rawValue)) return YamlValueType.INTEGER;
    // Check for float pattern
    if (/^-?\d+\.\d+$/.test(rawValue)) return YamlValueType.FLOAT;

    return YamlValueType.STRING;
  }

  private getNodeLine(node: unknown): number {
    if (node == null) return 1;
    const range = (node as any).range;
    if (Array.isArray(range) && range.length > 0) {
      return this.offsetToLine(range[0]);
    }
    return 1;
  }

  private getNodeEndLine(node: unknown): number {
    if (node == null) return 1;
    const range = (node as any).range;
    if (Array.isArray(range) && range.length > 1) {
      return this.offsetToLine(range[1] - 1);
    }
    return this.getNodeLine(node);
  }

  private getValueStartCol(node: unknown): number {
    if (node == null) return 0;
    const range = (node as any).range;
    if (Array.isArray(range) && range.length > 0) {
      return this.offsetToCol(range[0]);
    }
    return 0;
  }

  private getAnchorName(node: unknown): string {
    if (node == null) return '';
    const anchor = (node as any).anchor;
    return typeof anchor === 'string' ? anchor : '';
  }
}
