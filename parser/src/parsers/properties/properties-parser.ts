import { PropertyKey } from '@/analysis-types/properties/PropertyKey';
import { PropertyValueSegment } from '@/analysis-types/properties/PropertyValueSegment';
import { PropertyDelimiter } from '@/enums/properties/PropertyDelimiter';
import { PropertyValueSegmentType } from '@/enums/properties/PropertyValueSegmentType';

/**
 * Parsed result from a single property line (may span multiple lines with \ continuation).
 */
interface ParsedProperty {
  key: string;
  rawKey: string;
  value: string;
  delimiter: PropertyDelimiter;
  hasValue: boolean;
  isMultiLineKey: boolean;
  isMultiLineValue: boolean;
  startLine: number;
  endLine: number;
  keyStartCol: number;
  keyEndCol: number;
  valueStartCol: number;
  valueEndCol: number;
}

/**
 * Parser for Java .properties files.
 *
 * Handles all standard .properties syntax:
 * - `=`, `:`, and whitespace delimiters
 * - `#` and `!` comments
 * - `\` line continuations for both keys and values
 * - Unicode escapes (`\uXXXX`)
 * - Escaped special characters (`\=`, `\:`, `\!`, `\#`, `\\`, `\n`, `\t`, `\r`)
 * - No-value keys (value defaults to empty string)
 * - Leading whitespace stripping on keys
 * - Leading whitespace stripping on continuation lines
 *
 * Two-pass approach:
 * 1. Parse all keys to build a set of known property names
 * 2. Parse all values, classifying ${...} references as PROPERTY_REFERENCE
 *    when the name matches a known key, or ENV_VARIABLE otherwise
 */
export class PropertiesParser {
  private knownKeys: Set<string> = new Set();

  /**
   * Parses a .properties file and returns PropertyKey and PropertyValueSegment entities.
   *
   * @param content File content
   * @param filePath Absolute path to the file
   * @param baseMservPath Project root path
   * @param serviceVersionLinkHash Service version hash
   * @returns Tuple of [PropertyKey[], PropertyValueSegment[]]
   */
  parse(
    content: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionLinkHash: string
  ): [PropertyKey[], PropertyValueSegment[]] {
    const lines = content.split('\n');

    // Pass 1: Parse all properties to collect known keys
    const parsedProperties = this.parseAllProperties(lines);
    this.knownKeys = new Set(parsedProperties.map(p => p.key));

    // Pass 2: Build PropertyKey and PropertyValueSegment entities
    const propertyKeys: PropertyKey[] = [];
    const valueSegments: PropertyValueSegment[] = [];

    for (const parsed of parsedProperties) {
      const propertyKey = PropertyKey.builder(
        parsed.key,
        filePath,
        baseMservPath,
        parsed.startLine,
        parsed.endLine,
        parsed.keyStartCol,
        parsed.keyEndCol,
        parsed.delimiter,
        serviceVersionLinkHash
      )
        .withRawKey(parsed.rawKey)
        .withHasValue(parsed.hasValue)
        .withIsMultiLineKey(parsed.isMultiLineKey)
        .withIsMultiLineValue(parsed.isMultiLineValue)
        .build();

      propertyKeys.push(propertyKey);

      // Parse value segments
      if (!parsed.hasValue || parsed.value.length === 0) {
        // EMPTY segment
        const segment = PropertyValueSegment.builder(
          '',
          PropertyValueSegmentType.EMPTY,
          0,
          0,
          propertyKey.getHash(),
          parsed.startLine,
          parsed.endLine,
          parsed.valueStartCol,
          parsed.valueEndCol
        ).build();
        valueSegments.push(segment);
      } else {
        const segments = this.parseValueSegments(
          parsed.value,
          propertyKey.getHash(),
          parsed.startLine,
          parsed.valueStartCol,
          0, // depth
          ''  // no parent
        );
        valueSegments.push(...segments);
      }
    }

    return [propertyKeys, valueSegments];
  }

  /**
   * Parse all property lines from the file content, handling comments,
   * blank lines, and line continuations.
   */
  private parseAllProperties(lines: string[]): ParsedProperty[] {
    const properties: ParsedProperty[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i]!;
      const trimmed = line.trimStart();

      // Skip blank lines and comments
      if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith('!')) {
        i++;
        continue;
      }

      // Collect the full logical line (handling \ continuations)
      const startLine = i + 1; // 1-indexed
      let fullLine = line;
      let endLine = startLine;

      while (this.endsWithContinuation(fullLine) && i + 1 < lines.length) {
        // Remove trailing backslash
        fullLine = fullLine.substring(0, fullLine.length - 1);
        i++;
        endLine = i + 1;
        // Continuation lines: leading whitespace is stripped
        fullLine += lines[i]!.trimStart();
      }

      // Parse the logical line into key, delimiter, value
      const parsed = this.parseLogicalLine(fullLine, line, startLine, endLine);
      if (parsed) {
        properties.push(parsed);
      }

      i++;
    }

    return properties;
  }

  /**
   * Check if a line ends with an odd number of backslashes (indicating continuation).
   */
  private endsWithContinuation(line: string): boolean {
    let count = 0;
    for (let i = line.length - 1; i >= 0; i--) {
      if (line[i] === '\\') {
        count++;
      } else {
        break;
      }
    }
    // Odd number of trailing backslashes means continuation
    return count > 0 && count % 2 === 1;
  }

  /**
   * Parse a single logical line (after continuation joining) into its key, delimiter, and value.
   */
  private parseLogicalLine(
    logicalLine: string,
    _originalFirstLine: string,
    startLine: number,
    endLine: number
  ): ParsedProperty | null {
    // Skip leading whitespace to find the key start
    let pos = 0;
    while (pos < logicalLine.length && this.isWhitespace(logicalLine[pos]!)) {
      pos++;
    }

    if (pos >= logicalLine.length) {
      return null; // Empty line after trimming
    }

    const keyStartCol = pos;

    // Parse the key (may contain escaped characters)
    const keyResult = this.parseKey(logicalLine, pos);
    const rawKey = logicalLine.substring(keyStartCol, keyResult.endPos);
    const resolvedKey = keyResult.key;
    const keyEndCol = keyResult.endPos;
    const isMultiLineKey = startLine !== endLine && keyResult.endPos < logicalLine.length;

    pos = keyResult.endPos;

    // Skip whitespace between key and delimiter
    while (pos < logicalLine.length && this.isWhitespace(logicalLine[pos]!)) {
      pos++;
    }

    // Determine delimiter
    let delimiter: PropertyDelimiter;
    let hasValue = false;
    let valueStartCol = pos;

    if (pos >= logicalLine.length) {
      // No delimiter, no value — standalone key
      delimiter = PropertyDelimiter.NONE;
      hasValue = false;
      return {
        key: resolvedKey,
        rawKey: rawKey !== resolvedKey ? rawKey : resolvedKey,
        value: '',
        delimiter,
        hasValue,
        isMultiLineKey: false,
        isMultiLineValue: false,
        startLine,
        endLine,
        keyStartCol,
        keyEndCol,
        valueStartCol: keyEndCol,
        valueEndCol: keyEndCol,
      };
    }

    const ch = logicalLine[pos]!;
    if (ch === '=') {
      delimiter = PropertyDelimiter.EQUALS;
      pos++;
    } else if (ch === ':') {
      delimiter = PropertyDelimiter.COLON;
      pos++;
    } else {
      // The delimiter is whitespace (already consumed above)
      delimiter = PropertyDelimiter.SPACE;
    }

    // Skip whitespace after delimiter
    while (pos < logicalLine.length && this.isWhitespace(logicalLine[pos]!)) {
      pos++;
    }

    valueStartCol = pos;
    const value = logicalLine.substring(pos);
    hasValue = true;

    const isMultiLineValue = startLine !== endLine;
    const valueEndCol = logicalLine.length;

    return {
      key: resolvedKey,
      rawKey: rawKey !== resolvedKey ? rawKey : resolvedKey,
      value,
      delimiter,
      hasValue,
      isMultiLineKey: isMultiLineKey && startLine !== endLine,
      isMultiLineValue,
      startLine,
      endLine,
      keyStartCol,
      keyEndCol,
      valueStartCol,
      valueEndCol,
    };
  }

  /**
   * Parse the key portion of a property line, handling escape sequences.
   * Key ends at unescaped `=`, `:`, or whitespace.
   */
  private parseKey(line: string, startPos: number): { key: string; endPos: number } {
    let key = '';
    let pos = startPos;

    while (pos < line.length) {
      const ch = line[pos]!;

      if (ch === '\\' && pos + 1 < line.length) {
        const next = line[pos + 1]!;
        if (next === 'u' && pos + 5 < line.length) {
          // Unicode escape
          const hex = line.substring(pos + 2, pos + 6);
          const codePoint = parseInt(hex, 16);
          if (!isNaN(codePoint)) {
            key += String.fromCharCode(codePoint);
            pos += 6;
            continue;
          }
        }
        // Escaped delimiter or special char in key
        if (next === '=' || next === ':' || next === ' ' || next === '\\' ||
            next === 'n' || next === 't' || next === 'r') {
          key += this.resolveEscape(next);
          pos += 2;
          continue;
        }
        // Unknown escape — keep as-is
        key += ch;
        pos++;
        continue;
      }

      // Unescaped delimiter or whitespace ends the key
      if (ch === '=' || ch === ':' || this.isWhitespace(ch)) {
        break;
      }

      key += ch;
      pos++;
    }

    return { key, endPos: pos };
  }

  /**
   * Resolve a single escape character to its actual value.
   */
  private resolveEscape(ch: string): string {
    switch (ch) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      default: return ch;
    }
  }

  private isWhitespace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\f';
  }

  /**
   * Parse a value string into segments, recursively handling nested ${...} references.
   *
   * @param value The value string to parse
   * @param propertyKeyLinkHash Hash of the owning PropertyKey
   * @param baseLine Line number where the value starts
   * @param baseCol Column offset where the value starts
   * @param depth Current nesting depth (0 = top-level)
   * @param parentSegmentHash Hash of the parent segment (empty at depth 0)
   * @returns Array of PropertyValueSegment entities
   */
  parseValueSegments(
    value: string,
    propertyKeyLinkHash: string,
    baseLine: number,
    baseCol: number,
    depth: number,
    parentSegmentHash: string
  ): PropertyValueSegment[] {
    const segments: PropertyValueSegment[] = [];
    let pos = 0;
    let position = 0; // segment order within this level
    let literalStart = 0;

    while (pos < value.length) {
      // Check for SpEL expression: #{...}
      if (value[pos] === '#' && pos + 1 < value.length && value[pos + 1] === '{') {
        // Flush preceding literal
        if (pos > literalStart) {
          const litText = value.substring(literalStart, pos);
          const seg = this.createLiteralSegment(
            litText, position, depth, propertyKeyLinkHash, parentSegmentHash,
            baseLine, baseCol + literalStart
          );
          segments.push(seg);
          position++;
        }

        // Find matching closing brace
        const spelStart = pos;
        const spelEnd = this.findMatchingBrace(value, pos + 1);
        const spelContent = value.substring(pos + 2, spelEnd);

        const spelSegment = PropertyValueSegment.builder(
          spelContent,
          PropertyValueSegmentType.SPEL_EXPRESSION,
          position,
          depth,
          propertyKeyLinkHash,
          baseLine,
          baseLine,
          baseCol + spelStart,
          baseCol + spelEnd + 1
        )
          .withParentSegmentLinkHash(parentSegmentHash)
          .build();
        segments.push(spelSegment);

        // Parse inner ${...} references within SpEL as children
        const innerRefs = this.parseValueSegments(
          spelContent,
          propertyKeyLinkHash,
          baseLine,
          baseCol + spelStart + 2,
          depth + 1,
          spelSegment.getHash()
        );
        // Only add child segments that are actual references (not the full SpEL literal)
        const refChildren = innerRefs.filter(
          s => s.getSegmentType() !== PropertyValueSegmentType.LITERAL
        );
        segments.push(...refChildren);

        position++;
        pos = spelEnd + 1;
        literalStart = pos;
        continue;
      }

      // Check for ${...} placeholder
      if (value[pos] === '$' && pos + 1 < value.length && value[pos + 1] === '{') {
        // Flush preceding literal
        if (pos > literalStart) {
          const litText = value.substring(literalStart, pos);
          const seg = this.createLiteralSegment(
            litText, position, depth, propertyKeyLinkHash, parentSegmentHash,
            baseLine, baseCol + literalStart
          );
          segments.push(seg);
          position++;
        }

        // Find matching closing brace (handles nested ${...})
        const refStart = pos;
        const refEnd = this.findMatchingBrace(value, pos + 1);
        const refContent = value.substring(pos + 2, refEnd);

        // Parse the reference content: name[:default]
        const refSegments = this.parseReference(
          refContent,
          position,
          depth,
          propertyKeyLinkHash,
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
      const seg = this.createLiteralSegment(
        litText, position, depth, propertyKeyLinkHash, parentSegmentHash,
        baseLine, baseCol + literalStart
      );
      segments.push(seg);
    }

    return segments;
  }

  /**
   * Parse a reference content (inside ${...}) into segments.
   * Handles: name, name:default, random.*, nested defaults like name:${other:val}
   */
  private parseReference(
    content: string,
    position: number,
    depth: number,
    propertyKeyLinkHash: string,
    parentSegmentHash: string,
    baseLine: number,
    startCol: number,
    endCol: number
  ): PropertyValueSegment[] {
    const segments: PropertyValueSegment[] = [];

    // Find the first colon that's not inside a nested ${...}
    const colonPos = this.findTopLevelColon(content);

    let name: string;
    let defaultText: string | undefined;

    if (colonPos === -1) {
      // No default: ${NAME}
      name = content;
    } else {
      // Has default: ${NAME:default}
      name = content.substring(0, colonPos);
      defaultText = content.substring(colonPos + 1);
    }

    // Determine segment type
    let segmentType: PropertyValueSegmentType;
    if (name.startsWith('random.')) {
      segmentType = PropertyValueSegmentType.RANDOM;
    } else if (defaultText !== undefined) {
      if (this.knownKeys.has(name)) {
        segmentType = PropertyValueSegmentType.PROPERTY_REF_WITH_DEFAULT;
      } else {
        segmentType = PropertyValueSegmentType.ENV_WITH_DEFAULT;
      }
    } else {
      if (this.knownKeys.has(name)) {
        segmentType = PropertyValueSegmentType.PROPERTY_REFERENCE;
      } else {
        segmentType = PropertyValueSegmentType.ENV_VARIABLE;
      }
    }

    // Determine the plain default value (without nested ${} resolved)
    const plainDefault = defaultText !== undefined ? defaultText : '';

    const refSegment = PropertyValueSegment.builder(
      name,
      segmentType,
      position,
      depth,
      propertyKeyLinkHash,
      baseLine,
      baseLine,
      startCol,
      endCol
    )
      .withDefaultValue(plainDefault)
      .withParentSegmentLinkHash(parentSegmentHash)
      .build();
    segments.push(refSegment);

    // If the default contains nested ${...} or #{...}, recursively parse children
    if (defaultText !== undefined && (defaultText.includes('${') || defaultText.includes('#{'))) {
      const childSegments = this.parseValueSegments(
        defaultText,
        propertyKeyLinkHash,
        baseLine,
        startCol + 2 + name.length + 1, // ${NAME: offset
        depth + 1,
        refSegment.getHash()
      );
      segments.push(...childSegments);
    }

    return segments;
  }

  /**
   * Find the position of the first colon at the top level (not inside nested ${...}).
   */
  private findTopLevelColon(content: string): number {
    let braceDepth = 0;
    for (let i = 0; i < content.length; i++) {
      const ch = content[i]!;
      if (ch === '$' && i + 1 < content.length && content[i + 1] === '{') {
        braceDepth++;
        i++; // skip {
      } else if (ch === '#' && i + 1 < content.length && content[i + 1] === '{') {
        braceDepth++;
        i++; // skip {
      } else if (ch === '}') {
        if (braceDepth > 0) braceDepth--;
      } else if (ch === ':' && braceDepth === 0) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Find the matching closing brace for an opening { at position pos.
   * Handles nested ${...} and #{...} correctly.
   */
  private findMatchingBrace(value: string, openBracePos: number): number {
    let depth = 1;
    let pos = openBracePos + 1; // skip past the opening {

    while (pos < value.length && depth > 0) {
      const ch = value[pos]!;
      if ((ch === '$' || ch === '#') && pos + 1 < value.length && value[pos + 1] === '{') {
        depth++;
        pos++; // skip past $
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return pos;
        }
      }
      pos++;
    }

    // If no matching brace found, return end of string
    return value.length - 1;
  }

  /**
   * Create a LITERAL segment.
   */
  private createLiteralSegment(
    text: string,
    position: number,
    depth: number,
    propertyKeyLinkHash: string,
    parentSegmentHash: string,
    baseLine: number,
    startCol: number
  ): PropertyValueSegment {
    return PropertyValueSegment.builder(
      text,
      PropertyValueSegmentType.LITERAL,
      position,
      depth,
      propertyKeyLinkHash,
      baseLine,
      baseLine,
      startCol,
      startCol + text.length
    )
      .withParentSegmentLinkHash(parentSegmentHash)
      .build();
  }
}
