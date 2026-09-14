import Parser from 'tree-sitter';

import { EnumConstant } from '@/analysis-types/java/EnumConstant';
import { ExpressionReference } from '@/analysis-types/java/ExpressionReference';
import { AnnotationArgumentReference } from '@/analysis-types/java/AnnotationArgumentReference';
import { TypeAnnotation } from '@/analysis-types/java/TypeAnnotation';
import { TypeReference } from '@/analysis-types/java/TypeReference';
import { AnnotationExtractor } from '@/parsers/java/extractors/annotation-extractor';
import { ExpressionReferenceExtractor, AnonymousClassInfo } from '@/parsers/java/extractors/expression-reference-extractor';

/**
 * Extracts EnumConstant entities from Java enum bodies using tree-sitter
 *
 * Handles extraction of:
 * - Enum constant names
 * - Enum constant arguments (constructor parameters)
 * - Enum constant annotations
 * - Detection of anonymous class bodies on enum constants
 *
 * ## Tree-sitter Node Structure
 *
 * For an enum like:
 * ```java
 * public enum Status {
 *     @Deprecated
 *     ACTIVE("Active", 1),
 *     INACTIVE,
 *     PENDING("Pending", 2) {
 *         @Override
 *         public boolean isTransient() { return true; }
 *     };
 * }
 * ```
 *
 * The tree-sitter structure is:
 * - enum_declaration
 *   - enum_body
 *     - enum_constant (ACTIVE)
 *       - modifiers (contains @Deprecated annotation)
 *       - identifier: "ACTIVE"
 *       - argument_list: ("Active", 1)
 *     - enum_constant (INACTIVE)
 *       - identifier: "INACTIVE"
 *     - enum_constant (PENDING)
 *       - identifier: "PENDING"
 *       - argument_list: ("Pending", 2)
 *       - class_body (anonymous class with method overrides)
 *
 * ## Reusing AnnotationExtractor
 *
 * This extractor reuses the AnnotationExtractor to extract annotations
 * on enum constants. Annotations are linked to the enum constant via
 * the enumConstantUniqueHash.
 */
export class EnumConstantExtractor {
  private annotationExtractor: AnnotationExtractor;
  private expressionExtractor: ExpressionReferenceExtractor;
  private extractedAnnotations: TypeAnnotation[] = [];
  private extractedAnnotationArguments: AnnotationArgumentReference[] = [];
  private extractedExpressions: ExpressionReference[] = [];
  private extractedTypeReferences: TypeReference[] = [];
  private extractedAnonymousClasses: AnonymousClassInfo[] = [];

  constructor() {
    this.annotationExtractor = new AnnotationExtractor();
    this.expressionExtractor = new ExpressionReferenceExtractor();
  }

  /**
   * Returns all annotations extracted during the last extraction
   */
  getExtractedAnnotations(): TypeAnnotation[] {
    return this.extractedAnnotations;
  }

  /**
   * Returns all annotation arguments extracted during the last extraction
   */
  getExtractedAnnotationArguments(): AnnotationArgumentReference[] {
    return this.extractedAnnotationArguments;
  }

  /**
   * Returns all expressions extracted during the last extraction
   */
  getExtractedExpressions(): ExpressionReference[] {
    return this.extractedExpressions;
  }

  /**
   * Returns all type references extracted during the last extraction
   */
  getExtractedTypeReferences(): TypeReference[] {
    return this.extractedTypeReferences;
  }

  /**
   * Returns all anonymous classes extracted during the last extraction
   */
  getExtractedAnonymousClasses(): AnonymousClassInfo[] {
    return this.extractedAnonymousClasses;
  }

  /**
   * Extracts enum constants from an enum declaration node
   */
  extractFromEnum(
    enumNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    packageName: string | null = null,
    importMap: Map<string, string> = new Map(),
    hasStarImports: boolean = false
  ): EnumConstant[] {
    // Reset extracted collections
    this.extractedAnnotations = [];
    this.extractedAnnotationArguments = [];
    this.extractedExpressions = [];
    this.extractedTypeReferences = [];
    this.extractedAnonymousClasses = [];

    const enumConstants: EnumConstant[] = [];

    // Find the enum_body
    const enumBody = enumNode.children.find(child => child.type === 'enum_body');
    if (!enumBody) {
      return enumConstants;
    }

    let ordinal = 0;

    for (const child of enumBody.children) {
      if (child.type === 'enum_constant') {
        const enumConstant = this.extractEnumConstant(
          child,
          filePath,
          typeRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          serviceVersionHash,
          ordinal
        );

        if (enumConstant) {
          enumConstants.push(enumConstant);

          // Extract annotations for this enum constant
          this.extractEnumConstantAnnotations(
            child,
            typeRegistryHash,
            enumConstant.getEnumConstantUniqueHash()
          );

          // Extract expressions from enum constant arguments
          this.extractEnumConstantArgumentExpressions(
            child,
            typeRegistryHash,
            enumConstant.getEnumConstantUniqueHash(),
            packageName,
            importMap,
            hasStarImports
          );

          ordinal++;
        }
      }
    }

    return enumConstants;
  }

  /**
   * Extracts a single enum constant from an enum_constant node
   */
  private extractEnumConstant(
    constantNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    ordinal: number
  ): EnumConstant | null {
    // Extract name from identifier
    const identifierNode = constantNode.children.find(child => child.type === 'identifier');
    if (!identifierNode) {
      return null;
    }

    const name = identifierNode.text;
    const qualifiedName = `${ownerQualifiedName}.${name}`;

    // Extract arguments from argument_list
    const args = this.extractArguments(constantNode);

    // Check for anonymous class body
    const hasBody = constantNode.children.some(child => child.type === 'class_body');

    const startLine = constantNode.startPosition.row + 1;
    const endLine = constantNode.endPosition.row + 1;

    return new EnumConstant(
      name,
      qualifiedName,
      ordinal,
      args,
      hasBody,
      filePath,
      startLine,
      endLine,
      typeRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      serviceVersionHash
    );
  }

  /**
   * Extracts constructor arguments from an enum constant
   */
  private extractArguments(constantNode: Parser.SyntaxNode): string[] {
    const args: string[] = [];

    const argumentList = constantNode.children.find(child => child.type === 'argument_list');
    if (!argumentList) {
      return args;
    }

    for (const child of argumentList.children) {
      // Skip parentheses and commas
      if (child.type === '(' || child.type === ')' || child.type === ',') {
        continue;
      }

      // Capture the full text of each argument expression
      args.push(child.text);
    }

    return args;
  }

  /**
   * Extracts annotations from an enum constant node
   * Reuses the AnnotationExtractor with ENUM_CONSTANT context
   */
  private extractEnumConstantAnnotations(
    constantNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    enumConstantHash: string
  ): void {
    // Reset annotation extractor for this enum constant
    this.annotationExtractor.resetExtractedArguments();

    // Use the public extractFromEnumConstant method
    const annotations = this.annotationExtractor.extractFromEnumConstant(
      constantNode,
      enumConstantHash,
      typeRegistryHash
    );

    this.extractedAnnotations.push(...annotations);

    // Collect annotation arguments
    const annotationArgs = this.annotationExtractor.getExtractedArguments();
    this.extractedAnnotationArguments.push(...annotationArgs);
  }

  /**
   * Extracts expressions from enum constant arguments.
   * 
   * Example: PENDING(computeCode(), "Pending")
   * - computeCode() is extracted as a METHOD_INVOCATION expression
   * - "Pending" is extracted as a LITERAL expression
   * 
   * Each argument expression is linked to the enum constant via enumConstantHash.
   */
  private extractEnumConstantArgumentExpressions(
    constantNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    enumConstantHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean
  ): void {
    const argumentList = constantNode.children.find(child => child.type === 'argument_list');
    if (!argumentList) {
      return;
    }

    let position = 0;
    for (const child of argumentList.children) {
      // Skip parentheses and commas
      if (child.type === '(' || child.type === ')' || child.type === ',') {
        continue;
      }

      // Extract expressions from this argument
      const expressions = this.expressionExtractor.extractFromEnumConstantArgument(
        child,
        typeRegistryHash,
        enumConstantHash,
        packageName,
        importMap,
        hasStarImports,
        position
      );
      this.extractedExpressions.push(...expressions);

      // Collect type references from expressions
      const typeRefs = this.expressionExtractor.getExtractedTypeReferences();
      this.extractedTypeReferences.push(...typeRefs);

      // Collect annotations from expressions (e.g., type-use annotations in object creation)
      const annotations = this.expressionExtractor.getExtractedAnnotations();
      this.extractedAnnotations.push(...annotations);

      // Collect anonymous classes from expressions
      const anonymousClasses = this.expressionExtractor.getExtractedAnonymousClasses();
      this.extractedAnonymousClasses.push(...anonymousClasses);

      position++;
    }
  }
}
