import * as sax from 'sax';

import { XmlAttribute } from '@/analysis-types/xml/XmlAttribute';
import { XmlElement } from '@/analysis-types/xml/XmlElement';
import { XmlValueReference } from '@/analysis-types/xml/XmlValueReference';
import { XmlValueReferenceType } from '@/enums/xml/XmlValueReferenceType';

/**
 * Internal state for tracking an open element during SAX parsing.
 */
interface ElementState {
  tagName: string;
  localName: string;
  prefix: string;
  namespace: string;
  xPath: string;
  depth: number;
  startLine: number;
  childCount: number;
  textContent: string;
  parentHash: string;
  elementHash: string;
}

/**
 * Universal XML parser using SAX streaming.
 *
 * Extracts three entity types from any XML document:
 * - XmlElement: every element node with tag, namespace, xPath, depth, text, parent link
 * - XmlAttribute: every attribute on every element, linked to its parent element
 * - XmlValueReference: every ${...} and #{...} placeholder found in text content or attribute values
 */
export class XmlParser {
  /**
   * Parses an XML document and returns all extracted entities.
   *
   * @param content XML file content as string
   * @param filePath Absolute path to the XML file
   * @param baseMservPath Project root path
   * @param serviceVersionLinkHash Service version hash
   * @returns Tuple of [XmlElement[], XmlAttribute[], XmlValueReference[]]
   */
  parse(
    content: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionLinkHash: string
  ): [XmlElement[], XmlAttribute[], XmlValueReference[]] {
    const elements: XmlElement[] = [];
    const attributes: XmlAttribute[] = [];
    const valueReferences: XmlValueReference[] = [];

    const parser = sax.parser(true, {
      xmlns: false,
      trim: false,
      normalize: false,
      position: true,
    });

    // XPath tracking: stack of tag name counts at each level for sibling indexing
    const elementStack: ElementState[] = [];
    const xPathCounters: Map<string, number>[] = [];

    // Manual namespace prefix -> URI tracking (xmlns:false means we do this ourselves)
    const nsMap = new Map<string, string>();

    parser.onopentag = (node: sax.Tag) => {
      const currentDepth = elementStack.length + 1;
      const startLine = parser.line + 1; // sax uses 0-indexed lines

      // Manually parse prefix and local name from tag name
      const colonIdx = node.name.indexOf(':');
      const prefix = colonIdx > 0 ? node.name.substring(0, colonIdx) : '';
      const localName = colonIdx > 0 ? node.name.substring(colonIdx + 1) : node.name;

      // Collect xmlns declarations from attributes before processing
      for (const [attrName, attrValue] of Object.entries(node.attributes)) {
        if (attrName === 'xmlns') {
          nsMap.set('', attrValue as string);
        } else if (attrName.startsWith('xmlns:')) {
          nsMap.set(attrName.substring(6), attrValue as string);
        }
      }

      // Re-resolve namespace after collecting xmlns declarations
      const resolvedUri = prefix ? (nsMap.get(prefix) || '') : (nsMap.get('') || '');

      // Build xPath
      const parentXPath = elementStack.length > 0
        ? elementStack[elementStack.length - 1]!.xPath
        : '';

      // Track sibling count for xPath indexing
      if (xPathCounters.length < currentDepth) {
        xPathCounters.push(new Map());
      }
      const levelCounters = xPathCounters[currentDepth - 1]!;
      const tagCount = (levelCounters.get(localName) || 0) + 1;
      levelCounters.set(localName, tagCount);

      const xPath = `${parentXPath}/${localName}[${tagCount}]`;

      // Increment parent's child count
      if (elementStack.length > 0) {
        elementStack[elementStack.length - 1]!.childCount++;
      }

      // Create a temporary element to get its hash for linking attributes
      const tempElement = XmlElement.builder(
        localName,
        xPath,
        currentDepth,
        filePath,
        baseMservPath,
        startLine,
        startLine, // endLine updated on close
        serviceVersionLinkHash
      )
        .withNamespace(resolvedUri)
        .withNamespacePrefix(prefix)
        .withParentElementHash(
          elementStack.length > 0
            ? elementStack[elementStack.length - 1]!.elementHash
            : ''
        )
        .build();

      const elementHash = tempElement.getHash();

      // Push state onto stack
      const state: ElementState = {
        tagName: localName,
        localName,
        prefix,
        namespace: resolvedUri,
        xPath,
        depth: currentDepth,
        startLine,
        childCount: 0,
        textContent: '',
        parentHash: elementStack.length > 0
          ? elementStack[elementStack.length - 1]!.elementHash
          : '',
        elementHash,
      };
      elementStack.push(state);

      // Reset child-level counters (new children start fresh)
      if (xPathCounters.length > currentDepth) {
        xPathCounters[currentDepth] = new Map();
      }

      // Extract attributes (including xmlns declarations)
      for (const [attrName, attrValue] of Object.entries(node.attributes)) {
        const value = attrValue as string;
        // Resolve attribute namespace prefix
        const attrColonIdx = attrName.indexOf(':');
        const attrNsUri = attrColonIdx > 0
          ? (nsMap.get(attrName.substring(0, attrColonIdx)) || '')
          : '';

        const xmlAttr = XmlAttribute.builder(
          attrName,
          value,
          filePath,
          baseMservPath,
          startLine,
          startLine,
          elementHash,
          serviceVersionLinkHash
        )
          .withNamespace(attrNsUri)
          .build();

        attributes.push(xmlAttr);

        // Extract value references from attribute values
        const attrRefs = this.extractValueReferences(
          value,
          elementHash,
          attrName,
          filePath,
          baseMservPath,
          startLine,
          startLine,
          serviceVersionLinkHash
        );
        valueReferences.push(...attrRefs);
      }
    };

    parser.ontext = (text: string) => {
      if (elementStack.length > 0) {
        elementStack[elementStack.length - 1]!.textContent += text;
      }
    };

    parser.oncdata = (cdata: string) => {
      if (elementStack.length > 0) {
        elementStack[elementStack.length - 1]!.textContent += cdata;
      }
    };

    parser.onclosetag = () => {
      const state = elementStack.pop();
      if (!state) return;

      const endLine = parser.line + 1;
      const trimmedText = state.textContent.trim();
      const isSelfClosing = state.childCount === 0 && trimmedText.length === 0;

      // Build the final element with endLine and text
      const xmlElement = XmlElement.builder(
        state.tagName,
        state.xPath,
        state.depth,
        filePath,
        baseMservPath,
        state.startLine,
        endLine,
        serviceVersionLinkHash
      )
        .withNamespace(state.namespace)
        .withNamespacePrefix(state.prefix)
        .withTextContent(trimmedText)
        .withIsSelfClosing(isSelfClosing)
        .withChildCount(state.childCount)
        .withParentElementHash(state.parentHash)
        .build();

      elements.push(xmlElement);

      // Extract value references from text content
      if (trimmedText.length > 0) {
        const textRefs = this.extractValueReferences(
          trimmedText,
          state.elementHash,
          '', // no attribute name — this is text content
          filePath,
          baseMservPath,
          state.startLine,
          endLine,
          serviceVersionLinkHash
        );
        valueReferences.push(...textRefs);
      }

      // Trim the xPath counters stack
      while (xPathCounters.length > state.depth) {
        xPathCounters.pop();
      }
    };

    parser.onerror = (err: Error) => {
      // Reset parser on error and continue — we want best-effort extraction
      console.warn(`XML parse warning in ${filePath}: ${err.message}`);
      parser.resume();
    };

    parser.write(content).close();

    return [elements, attributes, valueReferences];
  }

  /**
   * Extracts ${...} and #{...} value references from a string.
   *
   * @param value The string to scan for references
   * @param ownerElementHash Hash of the element owning this value
   * @param ownerAttributeName Attribute name (empty string if text content)
   * @param filePath Absolute file path
   * @param baseMservPath Project root path
   * @param startLine Start line of the value
   * @param endLine End line of the value
   * @param serviceVersionLinkHash Service version hash
   * @returns Array of XmlValueReference entities
   */
  private extractValueReferences(
    value: string,
    ownerElementHash: string,
    ownerAttributeName: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ): XmlValueReference[] {
    const references: XmlValueReference[] = [];
    let pos = 0;

    while (pos < value.length) {
      // Check for #{...} SpEL
      if (value[pos] === '#' && pos + 1 < value.length && value[pos + 1] === '{') {
        const closePos = this.findMatchingBrace(value, pos + 1);
        const expression = value.substring(pos + 2, closePos);
        const rawFragment = value.substring(pos, closePos + 1);

        const ref = XmlValueReference.builder(
          expression,
          XmlValueReferenceType.SPEL_EXPRESSION,
          rawFragment,
          ownerElementHash,
          filePath,
          baseMservPath,
          startLine,
          endLine,
          serviceVersionLinkHash
        )
          .withOwnerAttributeName(ownerAttributeName)
          .build();

        references.push(ref);
        pos = closePos + 1;
        continue;
      }

      // Check for ${...} placeholder
      if (value[pos] === '$' && pos + 1 < value.length && value[pos + 1] === '{') {
        const closePos = this.findMatchingBrace(value, pos + 1);
        const innerContent = value.substring(pos + 2, closePos);
        const rawFragment = value.substring(pos, closePos + 1);

        // Check for default: ${name:default}
        const colonPos = this.findTopLevelColon(innerContent);
        let expression: string;
        let defaultValue = '';
        let refType: XmlValueReferenceType;

        if (colonPos === -1) {
          expression = innerContent;
          refType = XmlValueReferenceType.PROPERTY_PLACEHOLDER;
        } else {
          expression = innerContent.substring(0, colonPos);
          defaultValue = innerContent.substring(colonPos + 1);
          refType = XmlValueReferenceType.PLACEHOLDER_WITH_DEFAULT;
        }

        const refBuilder = XmlValueReference.builder(
          expression,
          refType,
          rawFragment,
          ownerElementHash,
          filePath,
          baseMservPath,
          startLine,
          endLine,
          serviceVersionLinkHash
        )
          .withOwnerAttributeName(ownerAttributeName)
          .withDefaultValue(defaultValue);

        references.push(refBuilder.build());

        // Recursively extract nested refs from the default value
        if (defaultValue && (defaultValue.includes('${') || defaultValue.includes('#{'))) {
          const nestedRefs = this.extractValueReferences(
            defaultValue,
            ownerElementHash,
            ownerAttributeName,
            filePath,
            baseMservPath,
            startLine,
            endLine,
            serviceVersionLinkHash
          );
          // Set depth on nested refs
          for (const nested of nestedRefs) {
            const nestedWithDepth = XmlValueReference.builder(
              nested.getReferenceExpression(),
              nested.getReferenceType(),
              nested.getRawValue(),
              ownerElementHash,
              filePath,
              baseMservPath,
              startLine,
              endLine,
              serviceVersionLinkHash
            )
              .withOwnerAttributeName(ownerAttributeName)
              .withDefaultValue(nested.getDefaultValue())
              .withDepth(nested.getDepth() + 1)
              .build();
            references.push(nestedWithDepth);
          }
        }

        pos = closePos + 1;
        continue;
      }

      pos++;
    }

    return references;
  }

  /**
   * Find the matching closing brace for an opening { at position pos.
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
        if (depth === 0) return pos;
      }
      pos++;
    }

    return value.length - 1;
  }

  /**
   * Find the first colon not inside a nested ${...} or #{...}.
   */
  private findTopLevelColon(content: string): number {
    let braceDepth = 0;
    for (let i = 0; i < content.length; i++) {
      const ch = content[i]!;
      if ((ch === '$' || ch === '#') && i + 1 < content.length && content[i + 1] === '{') {
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
}
