import Parser from 'tree-sitter';

import { ImportRegistry } from '@/analysis-imports/java/ImportRegistry';
import { EntityUtils } from '@/utils/entity-utils';
import { ImportKind } from '@/enums/java/imports';
import { BaseExtractor } from '@/parsers/base-extractor';
import { JavaParser } from '@/parsers/java/java-parser';

/**
 * Extracts ImportRegistry entities from Java source files using tree-sitter.
 *
 * Supports all 5 Java import types (as of Java 23):
 * - SINGLE_TYPE: import java.util.List;
 * - TYPE_ON_DEMAND: import java.util.*;
 * - SINGLE_STATIC: import static java.lang.Math.PI;
 * - STATIC_ON_DEMAND: import static java.lang.Math.*;
 * - MODULE: import module java.base; (Java 23+)
 *
 * Tree-sitter AST structure for imports:
 * ```
 * (import_declaration
 *   ["static"]?                    ; optional static keyword
 *   (scoped_identifier)            ; package/type path
 *   (identifier)?                  ; final identifier (for single imports)
 *   (asterisk)?                    ; for on-demand imports
 * )
 * ```
 *
 * Note: Module imports (Java 23+) have a different structure:
 * ```
 * (module_import_declaration       ; or similar node type
 *   "module"
 *   (module_name)
 * )
 * ```
 */
export class ImportExtractor implements BaseExtractor<ImportRegistry> {
  private javaParser: JavaParser;

  constructor() {
    this.javaParser = new JavaParser();
  }

  /**
   * Extracts all import declarations from a Java source file
   */
  extract(filePath: string, fileContent: string, serviceVersionHash: string): ImportRegistry[] {
    const imports: ImportRegistry[] = [];

    try {
      if (!fileContent || typeof fileContent !== 'string') {
        console.warn(`Skipping ${filePath}: invalid content`);
        return imports;
      }

      const tree = this.javaParser.parse(fileContent);
      const rootNode = this.javaParser.getRootNode(tree);

      this.extractImportsFromRoot(rootNode, filePath, serviceVersionHash, imports);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to parse imports from ${filePath}: ${errorMessage}`);
    }

    return imports;
  }

  /**
   * Extracts imports directly from a pre-parsed root node.
   * Use this when you already have a parsed tree (e.g., from TypeRegistryExtractor).
   */
  extractFromRootNode(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    serviceVersionHash: string
  ): ImportRegistry[] {
    const imports: ImportRegistry[] = [];
    this.extractImportsFromRoot(rootNode, filePath, serviceVersionHash, imports);
    return imports;
  }

  /**
   * Internal method to extract imports from the root node
   */
  private extractImportsFromRoot(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    serviceVersionHash: string,
    imports: ImportRegistry[]
  ): void {
    for (const child of rootNode.children) {
      // A module import is checked first, and the two branches are exclusive: a declaration that
      // is a module import must not also be recorded as a single-type import of the same text.
      if (child.type === 'module_import_declaration' ||
          (child.type === 'import_declaration' && this.isModuleImport(child))) {
        const moduleImport = this.createModuleImportRegistry(child, filePath, serviceVersionHash);
        if (moduleImport) {
          imports.push(moduleImport);
        }
      } else if (child.type === 'import_declaration') {
        const importRegistry = this.createImportRegistry(child, filePath, serviceVersionHash);
        if (importRegistry) {
          imports.push(importRegistry);
        }
      }
    }
  }

  /**
   * Creates an ImportRegistry from an import_declaration node
   */
  private createImportRegistry(
    node: Parser.SyntaxNode,
    filePath: string,
    serviceVersionHash: string
  ): ImportRegistry | null {
    const lineNumber = node.startPosition.row + 1;
    
    // Determine if static import
    const isStatic = this.hasStaticKeyword(node);
    
    // Determine if on-demand (wildcard) import
    const isOnDemand = this.hasAsterisk(node);
    
    // Extract the import path
    const importedPath = this.extractImportPath(node);
    if (!importedPath) {
      return null;
    }

    // Determine import kind
    const importKind = this.determineImportKind(isStatic, isOnDemand);

    // Extract package/type name and simple name
    const { packageOrTypeName, simpleName } = this.parseImportPath(importedPath, isStatic, isOnDemand);

    return new ImportRegistry(
      importKind,
      importedPath,
      packageOrTypeName,
      simpleName,
      filePath,
      lineNumber,
      isStatic,
      isOnDemand,
      false, // isModuleImport
      serviceVersionHash
    );
  }

  /**
   * Creates an ImportRegistry for module imports (Java 23+)
   */
  private createModuleImportRegistry(
    node: Parser.SyntaxNode,
    filePath: string,
    serviceVersionHash: string
  ): ImportRegistry | null {
    const lineNumber = node.startPosition.row + 1;
    
    // Extract module name
    const moduleName = this.extractModuleName(node);
    if (!moduleName) {
      return null;
    }

    return new ImportRegistry(
      ImportKind.MODULE,
      moduleName,
      '', // packageOrTypeName not applicable for module imports
      moduleName, // simpleName is the module name
      filePath,
      lineNumber,
      false, // isStatic
      false, // isOnDemand (module imports are effectively "super wildcards" but classified separately)
      true,  // isModuleImport
      serviceVersionHash
    );
  }

  /**
   * Checks if the import declaration has the 'static' keyword
   */
  private hasStaticKeyword(node: Parser.SyntaxNode): boolean {
    for (const child of node.children) {
      if (child.type === 'static') {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if the import declaration has an asterisk (on-demand import)
   */
  private hasAsterisk(node: Parser.SyntaxNode): boolean {
    for (const child of node.children) {
      if (child.type === 'asterisk') {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if this is a module import (Java 23+)
   */
  private isModuleImport(node: Parser.SyntaxNode): boolean {
    // No tree-sitter-java release parses `import module M;` (checked through 0.23.5). What it
    // produces is a malformed import_declaration, with `module` swallowed into the qualified
    // name and an ERROR beside it:
    //
    //   import_declaration
    //     import
    //     scoped_identifier          <- text is "module java.base"
    //       identifier = "module"
    //       ERROR
    //         identifier = "java"
    //       .
    //       identifier = "base"
    //
    // Read as a normal import that is a single-type import of a type named `base`, in a package
    // named `module java`. Nothing else in Java produces a qualified name whose first segment is
    // the identifier `module`, because `module` is a restricted keyword there, so this shape
    // identifies a module import declaration unambiguously.
    for (const child of node.children) {
      if (child.type === 'module' || child.text === 'module') {
        return true;
      }
      if (child.type === 'scoped_identifier') {
        const first = child.children[0];
        if (first?.type === 'identifier' && first.text === 'module') {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Extracts the full import path from an import_declaration node
   */
  private extractImportPath(node: Parser.SyntaxNode): string | null {
    let path = '';

    for (const child of node.children) {
      if (child.type === 'scoped_identifier') {
        path = this.normalizeQualifiedName(child.text);
      } else if (child.type === 'identifier' && child.text !== 'import' && child.text !== 'static') {
        if (path) {
          path += '.' + child.text;
        } else {
          path = child.text;
        }
      } else if (child.type === 'asterisk') {
        if (path) {
          path += '.*';
        } else {
          path = '*';
        }
      }
    }

    return path || null;
  }

  /**
   * Collapses the whitespace a qualified name is allowed to contain.
   *
   * JLS 3.6 permits whitespace, including a line terminator, between the identifiers and dots of
   * a qualified name, so this is legal and compiles:
   *
   *     import java.util.
   *     Optional;
   *
   * The name is `java.util.Optional`. Taking the node text verbatim keeps the line break inside
   * the value, which is wrong before it ever reaches a writer.
   *
   * Only whitespace adjacent to a dot is removed, rather than all whitespace, because the space
   * in `module java.base` separates two tokens and is not part of the name. Any run that survives
   * is collapsed to a single space so a value can never carry a line terminator.
   */
  private normalizeQualifiedName(text: string): string {
    return text
      .replace(/\s*\.\s*/g, '.')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extracts module name from a module import declaration
   */
  private extractModuleName(node: Parser.SyntaxNode): string | null {
    for (const child of node.children) {
      if (child.type === 'module_name') {
        return child.text;
      }
      if (child.type === 'scoped_identifier' || child.type === 'identifier') {
        if (child.text === 'import' || child.text === 'module') {
          continue;
        }
        // On the malformed shape the `module` keyword is the first segment of the qualified
        // name, so it is dropped here rather than reported as part of the module name.
        const name = EntityUtils.normalizeWhitespace(child.text).replace(/^module\s+/, '');
        return name.length > 0 ? name : null;
      }
    }
    return null;
  }

  /**
   * Determines the ImportKind based on static and on-demand flags
   */
  private determineImportKind(isStatic: boolean, isOnDemand: boolean): ImportKind {
    if (isStatic) {
      return isOnDemand ? ImportKind.STATIC_ON_DEMAND : ImportKind.SINGLE_STATIC;
    }
    return isOnDemand ? ImportKind.TYPE_ON_DEMAND : ImportKind.SINGLE_TYPE;
  }

  /**
   * Parses the import path to extract packageOrTypeName and simpleName
   *
   * Examples:
   * - "java.util.List" → { packageOrTypeName: "java.util", simpleName: "List" }
   * - "java.util.*" → { packageOrTypeName: "java.util", simpleName: "*" }
   * - "java.lang.Math.PI" (static) → { packageOrTypeName: "java.lang.Math", simpleName: "PI" }
   * - "java.lang.Math.*" (static) → { packageOrTypeName: "java.lang.Math", simpleName: "*" }
   */
  private parseImportPath(
    importedPath: string,
    _isStatic: boolean,
    isOnDemand: boolean
  ): { packageOrTypeName: string; simpleName: string } {
    if (isOnDemand) {
      // Remove trailing ".*" to get package/type name
      const packageOrTypeName = importedPath.replace(/\.\*$/, '');
      return { packageOrTypeName, simpleName: '*' };
    }

    // Split on last dot to separate package from simple name
    const lastDotIndex = importedPath.lastIndexOf('.');
    if (lastDotIndex === -1) {
      // Single identifier (rare case)
      return { packageOrTypeName: '', simpleName: importedPath };
    }

    const packageOrTypeName = importedPath.substring(0, lastDotIndex);
    const simpleName = importedPath.substring(lastDotIndex + 1);

    return { packageOrTypeName, simpleName };
  }
}
