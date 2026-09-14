import Parser from 'tree-sitter';

import { TypeAnnotation } from '@/analysis-types/java/TypeAnnotation';
import { TypeParameter } from '@/analysis-types/java/TypeParameter';
import { TypeReference } from '@/analysis-types/java/TypeReference';
import { BaseExtractor } from '@/parsers/base-extractor';
import { AnnotationExtractor } from '@/parsers/java/extractors/annotation-extractor';
import { TypeReferenceExtractor } from '@/parsers/java/extractors/type-reference-extractor';

/**
 * Extracts TypeParameter entities from Java type declarations.
 * 
 * Handles:
 * - Simple type parameters: `<T>`, `<E>`, `<K, V>`
 * - Bounded type parameters: `<T extends Number>`, `<T extends Comparable<T>>`
 * - Multiple bounds: `<T extends Number & Serializable>`
 * - Annotations on type parameters: `<@NonNull T>` (Java 8+)
 * - Recursive bounds: `<T extends Comparable<T>>`
 * 
 * ## Extraction Flow
 * 
 * For each type parameter declaration:
 * 1. Create TypeParameter entity with name, position, and owner information
 * 2. Extract annotations on the type parameter (e.g., `@NonNull`, `@Validated`)
 * 3. Extract type references from annotation arguments (if annotations have arguments)
 * 4. Extract type references from bounds (e.g., `extends BaseEntity & Auditable`)
 * 
 * ## Complete Example
 * 
 * ```java
 * public class Container<
 *     @NonNull T extends Serializable,                    // Extracts: @NonNull annotation, Serializable bound
 *     @Validated(validator = SizeValidator.class) U,      // Extracts: @Validated annotation, SizeValidator type reference
 *     V extends Comparable<V> & Cloneable                 // Extracts: Comparable<V>, Cloneable bounds
 * > { }
 * ```
 * 
 * **Results in:**
 * - 3 TypeParameter entries (T, U, V with positions 0, 1, 2)
 * - 2 TypeAnnotation entries (@NonNull on T, @Validated on U)
 * - 1 AnnotationArgumentReference (validator = SizeValidator.class)
 * - 4 TypeReference entries:
 *   - SizeValidator (context: TYPE_PARAMETER_ANNOTATION, owned by U)
 *   - Serializable (context: TYPE_PARAM_BOUND, owned by T)
 *   - Comparable<V> (context: TYPE_PARAM_BOUND, owned by V)
 *   - Cloneable (context: TYPE_PARAM_BOUND, owned by V)
 * 
 * ## Getters for Extracted Data
 * 
 * - `getExtractedAnnotations()` - Returns annotations on type parameters
 * - `getExtractedTypeReferences()` - Returns type references from bounds AND annotation arguments
 * - `getAnnotationExtractor()` - Direct access to annotation extractor for argument data
 */
export class TypeParameterExtractor implements BaseExtractor<TypeParameter> {
  private typeReferenceExtractor: TypeReferenceExtractor;
  private annotationExtractor: AnnotationExtractor;
  private extractedTypeReferences: TypeReference[] = [];
  private extractedAnnotations: TypeAnnotation[] = [];

  constructor() {
    this.typeReferenceExtractor = new TypeReferenceExtractor();
    this.annotationExtractor = new AnnotationExtractor();
  }

  /**
   * Returns all type references extracted during the last extractFromNode() call
   */
  getExtractedTypeReferences(): TypeReference[] {
    return this.extractedTypeReferences;
  }

  /**
   * Returns all annotations extracted from type parameters during the last extractFromNode() call
   */
  getExtractedAnnotations(): TypeAnnotation[] {
    return this.extractedAnnotations;
  }

  /**
   * Returns the TypeReferenceExtractor instance for direct extraction
   */
  getTypeReferenceExtractor(): TypeReferenceExtractor {
    return this.typeReferenceExtractor;
  }

  /**
   * Returns the AnnotationExtractor instance for direct extraction
   */
  getAnnotationExtractor(): AnnotationExtractor {
    return this.annotationExtractor;
  }

  /**
   * Extracts type parameters from a specific type declaration node
   * @param typeDeclarationNode The specific type declaration node (class/interface/record)
   * @param ownerTypeName Name of the owner type
   * @param ownerQualifiedName Qualified name of the owner type
   * @param filePath Path to the Java file
   * @param startLine Start line of the type declaration
   * @param typeRegistryHash Hash of the parent type (class/interface/etc)
   */
  extractFromNode(
    typeDeclarationNode: Parser.SyntaxNode,
    ownerTypeName: string,
    ownerQualifiedName: string,
    filePath: string,
    startLine: number,
    typeRegistryHash: string,
    packageName: string | null
  ): TypeParameter[] {
    const typeParameters: TypeParameter[] = [];
    this.extractedTypeReferences = []; // Reset for each extraction
    this.extractedAnnotations = []; // Reset for each extraction
    this.annotationExtractor.resetExtractedArguments(); // Reset annotation arguments for each type declaration

    const typeParamsNode = typeDeclarationNode.childForFieldName('type_parameters');
    if (typeParamsNode) {
      this.processTypeParametersList(
        typeParamsNode,
        ownerTypeName,
        ownerQualifiedName,
        filePath,
        startLine,
        typeRegistryHash,
        packageName,
        typeParameters
      );
    }

    return typeParameters;
  }

  /**
   * @deprecated Use extractFromNode instead - this method is kept for interface compatibility
   */
  extract(_filePath: string, _fileContent: string, _typeRegistryHash: string): TypeParameter[] {
    console.warn('TypeParameterExtractor.extract() is deprecated. Use extractFromNode() instead.');
    return [];
  }

  /**
   * Process type_parameters node and extract individual type parameter
   * Example: <T> or <K, V> or <T extends Comparable<T>>
   */
  private processTypeParametersList(
    typeParamsNode: Parser.SyntaxNode,
    ownerTypeName: string,
    ownerQualifiedName: string,
    filePath: string,
    startLine: number,
    typeRegistryHash: string,
    packageName: string | null,
    typeParameters: TypeParameter[]
  ): void {
    // First pass: collect all type parameter names
    const declaredTypeParams = new Set<string>();
    for (const child of typeParamsNode.children) {
      if (child.type === 'type_parameter') {
        const name = this.extractTypeParameterName(child);
        if (name) {
          declaredTypeParams.add(name);
        }
      }
    }

    // Second pass: create TypeParameter entities and extract bounds
    let position = 0;
    for (const child of typeParamsNode.children) {
      if (child.type === 'type_parameter') {
        const name = this.extractTypeParameterName(child);
        if (name) {
          const typeParam = new TypeParameter(
            name,
            position,
            ownerTypeName,
            ownerQualifiedName,
            filePath,
            startLine,
            typeRegistryHash
          );
          typeParam.generateHash();
          typeParameters.push(typeParam);

          // Extract annotations from type parameter (e.g., class Box<@NonNull T>)
          const annotations = this.annotationExtractor.extractFromTypeParameter(
            child,
            typeParam.getHash(),
            typeRegistryHash
          );
          this.extractedAnnotations.push(...annotations);

          // Extract annotations from type parameter bounds (e.g., <T extends @NonNull Number>)
          const boundAnnotations = this.annotationExtractor.extractFromTypeBound(
            child,
            typeParam.getHash(),
            typeRegistryHash,
            false  // isMethodTypeParam = false for class-level type parameters
          );
          this.extractedAnnotations.push(...boundAnnotations);

          // Note: Type references from annotation arguments are collected by TypeRegistryExtractor
          // to avoid duplication. Only collect type references from bounds here.

          // Extract TypeReferences from bounds (if any)
          const boundRefs = this.typeReferenceExtractor.extractFromBounds(
            child,
            typeRegistryHash,
            typeParam.getHash(),
            packageName,
            declaredTypeParams
          );
          this.extractedTypeReferences.push(...boundRefs);

          position++;
        }
      }
    }
  }

  /**
   * Extract the name of a type parameter
   * Example: In <T extends Comparable<T>>, extracts "T"
   */
  private extractTypeParameterName(node: Parser.SyntaxNode): string | null {
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      return nameNode.text;
    }

    // Fallback: look for type_identifier child
    for (const child of node.children) {
      if (child.type === 'type_identifier') {
        return child.text;
      }
    }

    return null;
  }
}
