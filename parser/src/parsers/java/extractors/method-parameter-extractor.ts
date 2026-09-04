import Parser from 'tree-sitter';

import { MethodParameter } from '@/analysis-methods/java/MethodParameter';
import { AnnotationArgumentReference } from '@/analysis-types/java/AnnotationArgumentReference';
import { TypeAnnotation } from '@/analysis-types/java/TypeAnnotation';
import { TypeReference } from '@/analysis-types/java/TypeReference';
import { BaseExtractor } from '@/parsers/base-extractor';
import { AnnotationExtractor } from '@/parsers/java/extractors/annotation-extractor';
import { TypeReferenceExtractor } from '@/parsers/java/extractors/type-reference-extractor';
import { JavaTreeSitterUtils } from '@/utils/java/java-tree-sitter-utils';
import { EntityUtils } from '@/utils/entity-utils';
import { resolveTypeQualifiedName } from '@/utils/java/type-resolution-utils';

/**
 * Extracts MethodParameter entities and their associated TypeReferences from Java method declarations.
 * 
 * Handles all parameter types:
 * - Regular parameters: `String name, int count`
 * - Final parameters: `final User user`
 * - Varargs parameters: `String... messages`
 * - Receiver parameters: `OuterClass.this`
 * - Generic parameters: `List<T> items`
 * - Complex wildcards: `Map<String, List<? extends Number>> data`
 * 
 * ## Strategy
 * 
 * This extractor creates:
 * 1. MethodParameter entities (metadata: name, position, modifiers)
 * 2. TypeReference entities (type structure: wildcards, generics, arrays)
 * 
 * TypeReferences are linked via:
 * - referenceOwnerKind = METHOD_PARAM
 * - typeReferenceOwnerHash = methodParameterHash
 * - context = METHOD_PARAM
 * 
 * ## Example
 * 
 * ```java
 * public void process(final List<? extends Number> numbers, String... messages) { }
 * ```
 * 
 * Creates:
 * - 2 MethodParameter entities (numbers, messages)
 * - Multiple TypeReference entities:
 *   - For `numbers`: List → ? extends Number → Number
 *   - For `messages`: String (with isVarArgs=true on MethodParameter)
 */
export class MethodParameterExtractor implements BaseExtractor<MethodParameter> {
  private typeReferenceExtractor: TypeReferenceExtractor;
  private extractedTypeReferences: TypeReference[] = [];
  private extractedAnnotations: TypeAnnotation[] = [];
  private extractedAnnotationArguments: AnnotationArgumentReference[] = [];

  constructor() {
    this.typeReferenceExtractor = new TypeReferenceExtractor();
  }

  /**
   * Returns all type references extracted during the last extraction
   */
  getExtractedTypeReferences(): TypeReference[] {
    return this.extractedTypeReferences;
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
   * @deprecated Use extractFromMethod instead
   */
  extract(_filePath: string, _fileContent: string, _hash: string): MethodParameter[] {
    console.warn('MethodParameterExtractor.extract() is deprecated. Use extractFromMethod() instead.');
    return [];
  }

  /**
   * Extracts method parameters from a method declaration node.
   * 
   * @param methodNode Method, constructor, or compact constructor declaration node
   * @param methodRegistryHash Hash of the owning method
   * @param typeRegistryHash Hash of the owning type (for TypeReference linkage)
   * @param packageName Package name for type resolution
   * @param declaredTypeParams Set of all type parameter names (class-level + method-level)
   * @param annotationExtractor Extractor for parameter annotations
   */
  extractFromMethod(
    methodNode: Parser.SyntaxNode,
    methodRegistryHash: string,
    typeRegistryHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    declaredTypeParams: Set<string>,
    annotationExtractor: AnnotationExtractor
  ): MethodParameter[] {
    const parameters: MethodParameter[] = [];
    this.extractedTypeReferences = []; // Reset for each method
    this.extractedAnnotations = []; // Reset for each method
    this.extractedAnnotationArguments = []; // Reset for each method

    // Find formal_parameters node
    const formalParamsNode = this.findFormalParameters(methodNode);
    if (!formalParamsNode) {
      return parameters;
    }

    let position = 0;
    for (const child of formalParamsNode.children) {
      if (child.type === 'formal_parameter' || 
          child.type === 'spread_parameter' || 
          child.type === 'receiver_parameter') {
        
        const param = this.createMethodParameter(
          child,
          annotationExtractor,
          position++,
          methodRegistryHash,
          typeRegistryHash,
          packageName,
          importMap,
          hasStarImports,
          declaredTypeParams
        );
        
        if (param) {
          parameters.push(param);
        }
      }
    }

    return parameters;
  }

  /**
   * Finds the formal_parameters node in a method declaration
   */
  private findFormalParameters(methodNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
    // A compact constructor declares no parameter list, but it IS the record's canonical
    // constructor and its parameters are the record's components (JLS 8.10.4). Without this it
    // reports a parameterCount taken from the components and no parameter rows to match.
    const source = methodNode.type === 'compact_constructor_declaration'
      ? this.findEnclosingRecord(methodNode) ?? methodNode
      : methodNode;

    for (const child of source.children) {
      if (child.type === 'formal_parameters') {
        return child;
      }
    }
    return null;
  }

  /**
   * Walks up to the record_declaration a compact constructor belongs to.
   */
  private findEnclosingRecord(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    let current = node.parent;
    while (current) {
      if (current.type === 'record_declaration') return current;
      current = current.parent;
    }
    return null;
  }

  /**
   * Creates a MethodParameter entity and extracts its TypeReferences and annotations
   */
  private createMethodParameter(
    paramNode: Parser.SyntaxNode,
    annotationExtractor: AnnotationExtractor,
    position: number,
    methodRegistryHash: string,
    typeRegistryHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    declaredTypeParams: Set<string>
  ): MethodParameter | null {
    // Extract parameter name
    const paramName = this.extractParameterName(paramNode);
    if (!paramName) return null;

    // Extract modifiers first (needed for type adjustment)
    const isFinal = this.isParameterFinal(paramNode);
    const isVarArgs = paramNode.type === 'spread_parameter';
    const isReceiver = paramNode.type === 'receiver_parameter';

    // Extract parameter type names
    const paramTypeNode = this.extractParameterTypeNode(paramNode);
    let parameterTypeName = paramTypeNode ? EntityUtils.normalizeWhitespace(paramTypeNode.text) : 'Unknown';
    
    // Handle C-style array declarations (int values[] vs int[] values)
    // C-style puts dimensions in the formal_parameter, not the type node
    const cStyleDimensions = paramNode.children.find(c => c.type === 'dimensions');
    if (cStyleDimensions) {
      parameterTypeName = parameterTypeName + cStyleDimensions.text;
    }
    
    // For varargs (String... args), the underlying type is actually String[]
    // Append [] to make the type accurate
    if (isVarArgs && !parameterTypeName.endsWith('[]')) {
      parameterTypeName = parameterTypeName + '[]';
    }
    
    const parameterBaseType = this.extractBaseType(parameterTypeName);

    // Resolve qualified name from imports
    const { potentialQualifiedName, isAmbiguous } = resolveTypeQualifiedName(
      parameterBaseType,
      packageName,
      importMap,
      hasStarImports,
      declaredTypeParams
    );

    // Get line numbers
    const startLine = paramNode.startPosition.row + 1;
    const endLine = paramNode.endPosition.row + 1;

    // Create MethodParameter entity
    const methodParameter = new MethodParameter(
      paramName,
      position,
      methodRegistryHash,
      parameterBaseType,
      parameterTypeName,
      potentialQualifiedName,
      isAmbiguous,
      isFinal,
      isVarArgs,
      isReceiver,
      startLine,
      endLine
    );

    // Extract annotations for this parameter
    annotationExtractor.resetExtractedArguments();
    const paramAnnotations = annotationExtractor.extractFromParameterDeclaration(
      paramNode,
      methodParameter.getHash(),
      typeRegistryHash
    );
    this.extractedAnnotations.push(...paramAnnotations);
    
    // Collect annotation arguments from parameter annotations
    const paramAnnotationArgs = annotationExtractor.getExtractedArguments();
    this.extractedAnnotationArguments.push(...paramAnnotationArgs);
    
    // Collect type references from parameter annotation arguments
    const paramAnnotationTypeRefs = annotationExtractor.getExtractedTypeReferences();
    this.extractedTypeReferences.push(...paramAnnotationTypeRefs);

    // Extract TypeReferences for this parameter's type (reuse paramTypeNode from above)
    if (paramTypeNode) {
      const typeRefs = this.typeReferenceExtractor.extractFromMethodParameter(
        paramTypeNode,
        typeRegistryHash,
        methodParameter.getHash(), // Link TypeReferences to this MethodParameter
        packageName,
        declaredTypeParams
      );
      this.extractedTypeReferences.push(...typeRefs);
    }

    return methodParameter;
  }

  /**
   * Extracts parameter name from parameter node
   */
  private extractParameterName(paramNode: Parser.SyntaxNode): string | null {
    for (const child of paramNode.children) {
      if (child.type === 'identifier') {
        return child.text;
      }
      // For receiver parameters, it's always 'this'
      if (child.type === 'this') {
        return 'this';
      }
      // For varargs (spread_parameter), name is inside variable_declarator
      if (child.type === 'variable_declarator') {
        const identifierNode = child.childForFieldName('name');
        if (identifierNode) {
          return identifierNode.text;
        }
      }
    }
    return null;
  }

  /**
   * Checks if parameter has 'final' modifier
   */
  private isParameterFinal(paramNode: Parser.SyntaxNode): boolean {
    for (const child of paramNode.children) {
      if (child.type === 'modifiers') {
        for (const modifier of child.children) {
          if (modifier.text === 'final') {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Extracts the type node from a parameter node
   */
  private extractParameterTypeNode(paramNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
    for (const child of paramNode.children) {
      if (JavaTreeSitterUtils.isTypeNode(child)) {
        return child;
      }
    }
    return null;
  }

  /**
   * Extracts base type by stripping generics
   * Examples:
   * - "List<String>" → "List"
   * - "Map<K, V>" → "Map"
   * - "List<? extends Number>" → "List"
   * - "String" → "String"
   * - "int[]" → "int[]"
   */
  private extractBaseType(fullTypeName: string): string {
    // Find first '<' to strip generics
    const genericStart = fullTypeName.indexOf('<');
    if (genericStart === -1) {
      return fullTypeName; // No generics
    }
    return fullTypeName.substring(0, genericStart);
  }
}
