import Parser from 'tree-sitter';

import { MethodTypeParameter } from '@/analysis-methods/java/MethodTypeParameter';
import { TypeAnnotation } from '@/analysis-types/java/TypeAnnotation';
import { TypeReference } from '@/analysis-types/java/TypeReference';
import { BaseExtractor } from '@/parsers/base-extractor';
import { AnnotationExtractor } from '@/parsers/java/extractors/annotation-extractor';
import { TypeReferenceExtractor } from '@/parsers/java/extractors/type-reference-extractor';

/**
 * Extracts MethodTypeParameter entities from Java method declarations.
 * 
 * Handles:
 * - Simple method type parameters: `<T>`, `<E>`, `<K, V>`
 * - Bounded method type parameters: `<T extends Shape>`, `<T extends Comparable<T>>`
 * - Multiple bounds: `<T extends Number & Serializable>`
 * - Annotations on method type parameters: `<@NonNull T>` (Java 8+)
 * - Recursive bounds: `<T extends Comparable<T>>`
 * 
 * ## Extraction Flow
 * 
 * For each method type parameter declaration:
 * 1. Create MethodTypeParameter entity with name, position, and owner method information
 * 2. Extract annotations on the type parameter (e.g., `@NonNull`, `@Validated`)
 * 3. Extract type references from annotation arguments (if annotations have arguments)
 * 4. Extract type references from bounds using METHOD_TYPE_PARAM_BOUND context
 * 
 * ## Complete Example
 * 
 * ```java
 * public class Service {
 *     // Simple unbounded method type parameter
 *     public <T> T process(T item) { }
 *     
 *     // Single bounded type parameter
 *     public static <T extends Shape> double totalArea(List<T> shapes) { }
 *     
 *     // Multiple type parameters with bounds
 *     public <T extends Number, U extends Comparable<U>> void compare(T t, U u) { }
 *     
 *     // Multiple bounds (intersection types)
 *     public <T extends Runnable & Closeable> void execute(T task) { }
 *     
 *     // With annotations
 *     public <@NonNull T extends Serializable> void save(T data) { }
 * }
 * ```
 * 
 * **Results for `<T extends Shape> double totalArea(List<T> shapes)`:**
 * - 1 MethodTypeParameter entry (T with hasBounds=true, position=0)
 * - 1 TypeReference entry:
 *   - Shape (context: METHOD_TYPE_PARAM_BOUND, owned by METHOD_TYPE_PARAM)
 * 
 * ## Difference from TypeParameterExtractor
 * 
 * - **TypeParameterExtractor**: Extracts class/interface-level type parameters
 *   - Context: `TYPE_PARAM_BOUND`
 *   - Links to: `typeRegistryLinkHash`
 * 
 * - **MethodTypeParameterExtractor**: Extracts method-level type parameters
 *   - Context: `METHOD_TYPE_PARAM_BOUND`
 *   - Links to: `methodRegistryLinkHash`
 * 
 * ## Getters for Extracted Data
 * 
 * - `getExtractedAnnotations()` - Returns annotations on method type parameters
 * - `getExtractedTypeReferences()` - Returns type references from bounds AND annotation arguments
 * - `getAnnotationExtractor()` - Direct access to annotation extractor for argument data
 */
export class MethodTypeParameterExtractor implements BaseExtractor<MethodTypeParameter> {
  private typeReferenceExtractor: TypeReferenceExtractor;
  private annotationExtractor: AnnotationExtractor;
  private extractedTypeReferences: TypeReference[] = [];
  private extractedAnnotations: TypeAnnotation[] = [];

  constructor() {
    this.typeReferenceExtractor = new TypeReferenceExtractor();
    this.annotationExtractor = new AnnotationExtractor();
  }

  /**
   * Returns all type references extracted during the last extractFromMethod() call
   */
  getExtractedTypeReferences(): TypeReference[] {
    return this.extractedTypeReferences;
  }

  /**
   * Returns all annotations extracted from method type parameters during the last extractFromMethod() call
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
   * Extracts method type parameters from a specific method declaration node
   * @param methodNode The method declaration node
   * @param methodRegistryHash Hash of the owner method
   * @param ownerMethodName Name of the owner method
   * @param ownerMethodSignature Signature of the owner method
   * @param ownerQualifiedMethodName Qualified name of the owner method
   * @param filePath Path to the Java file
   * @param startLine Start line of the method declaration
   * @param typeRegistryHash Hash of the type containing this method
   * @param packageName Package name for import resolution
   * @param classTypeParams Set of class-level type parameter names (for context)
   */
  extractFromMethod(
    methodNode: Parser.SyntaxNode,
    methodRegistryHash: string,
    ownerMethodName: string,
    ownerMethodSignature: string,
    ownerQualifiedMethodName: string,
    filePath: string,
    startLine: number,
    typeRegistryHash: string,
    packageName: string | null,
    classTypeParams: Set<string>
  ): MethodTypeParameter[] {
    const methodTypeParameters: MethodTypeParameter[] = [];
    this.extractedTypeReferences = []; // Reset for each extraction
    this.extractedAnnotations = []; // Reset for each extraction
    this.annotationExtractor.resetExtractedArguments(); // Reset annotation arguments

    const typeParamsNode = methodNode.childForFieldName('type_parameters');
    if (typeParamsNode) {
      this.processMethodTypeParametersList(
        typeParamsNode,
        methodRegistryHash,
        ownerMethodName,
        ownerMethodSignature,
        ownerQualifiedMethodName,
        filePath,
        startLine,
        typeRegistryHash,
        packageName,
        classTypeParams,
        methodTypeParameters
      );
    }

    return methodTypeParameters;
  }

  /**
   * @deprecated Use extractFromMethod instead - this method is kept for interface compatibility
   */
  extract(_filePath: string, _fileContent: string, _methodRegistryHash: string): MethodTypeParameter[] {
    console.warn('MethodTypeParameterExtractor.extract() is deprecated. Use extractFromMethod() instead.');
    return [];
  }

  /**
   * Process type_parameters node and extract individual method type parameters
   * Example: <T> or <K, V> or <T extends Shape>
   */
  private processMethodTypeParametersList(
    typeParamsNode: Parser.SyntaxNode,
    methodRegistryHash: string,
    ownerMethodName: string,
    ownerMethodSignature: string,
    ownerQualifiedMethodName: string,
    filePath: string,
    startLine: number,
    typeRegistryHash: string,
    packageName: string | null,
    classTypeParams: Set<string>,
    methodTypeParameters: MethodTypeParameter[]
  ): void {
    // First pass: collect all method type parameter names
    const declaredMethodTypeParams = new Set<string>();
    for (const child of typeParamsNode.children) {
      if (child.type === 'type_parameter') {
        const name = this.extractTypeParameterName(child);
        if (name) {
          declaredMethodTypeParams.add(name);
        }
      }
    }

    // Combine with class-level type parameters for bound resolution
    const allTypeParams = new Set([...classTypeParams, ...declaredMethodTypeParams]);

    // Second pass: create MethodTypeParameter entities and extract bounds
    let position = 0;
    for (const child of typeParamsNode.children) {
      if (child.type === 'type_parameter') {
        const name = this.extractTypeParameterName(child);
        if (name) {
          // Check if this type parameter has bounds
          const hasBounds = this.hasTypeBounds(child);

          const methodTypeParam = new MethodTypeParameter(
            name,
            position,
            ownerMethodName,
            ownerMethodSignature,
            ownerQualifiedMethodName,
            filePath,
            startLine,
            methodRegistryHash,
            hasBounds
          );
          methodTypeParam.generateHash();
          methodTypeParameters.push(methodTypeParam);

          // Extract annotations from method type parameter (e.g., <@NonNull T>)
          const annotations = this.annotationExtractor.extractFromTypeParameter(
            child,
            methodTypeParam.getHash(),
            typeRegistryHash
          );
          this.extractedAnnotations.push(...annotations);

          // Extract annotations from method type parameter bounds (e.g., <T extends @NonNull Number>)
          const boundAnnotations = this.annotationExtractor.extractFromTypeBound(
            child,
            methodTypeParam.getHash(),
            typeRegistryHash,
            true  // isMethodTypeParam = true for method-level type parameters
          );
          this.extractedAnnotations.push(...boundAnnotations);

          // Extract TypeReferences from bounds (if any) with METHOD_TYPE_PARAM_BOUND context
          const boundRefs = this.typeReferenceExtractor.extractFromMethodTypeParameterBounds(
            child,
            typeRegistryHash,
            methodRegistryHash,
            methodTypeParam.getHash(),
            packageName,
            allTypeParams
          );
          this.extractedTypeReferences.push(...boundRefs);

          position++;
        }
      }
    }
  }

  /**
   * Extract the name of a method type parameter
   * Example: In <T extends Shape>, extracts "T"
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

  /**
   * Check if a type parameter has bounds (extends clause)
   */
  private hasTypeBounds(node: Parser.SyntaxNode): boolean {
    for (const child of node.children) {
      if (child.type === 'type_bound') {
        return true;
      }
    }
    return false;
  }
}
