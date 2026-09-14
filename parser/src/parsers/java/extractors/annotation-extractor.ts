import Parser from 'tree-sitter';

import { AnnotationArgumentReference } from '@/analysis-types/java/AnnotationArgumentReference';
import { TypeAnnotation } from '@/analysis-types/java/TypeAnnotation';
import { TypeReference } from '@/analysis-types/java/TypeReference';
import { AnnotationContext, AnnotationKind, ArgumentValueType } from '@/enums';
import { TypeRefKind, TypeRefContext, ReferenceOwnerKind } from '@/enums/java/type-references';
import { BaseExtractor } from '@/parsers/base-extractor';

/**
 * Extracts TypeAnnotation entities from Java annotation usage contexts.
 *
 * Supports all annotation patterns:
 * - Simple marker: @Deprecated, @Nullable
 * - Single value: @Timeout(1000)
 * - Named arguments: @Column(name = "id", nullable = false)
 * - Array arguments: @Target({ ElementType.TYPE, ElementType.METHOD })
 *   (expanded into multiple AnnotationArgumentReference entries with arrayIndex)
 * - Nested: @Something(meta = @Other(x = 1))
 * - Meta-annotations: @Retention on annotation declarations
 * - Type parameter annotations: class Box<@NonNull T> (Java 8+)
 * - Type-use: List<@NonNull String> (not currently extracted)
 *
 * ## Extraction Contexts
 *
 * - **Type declarations**: extractFromTypeDeclaration()
 * - **Field declarations**: extractFromFieldDeclaration()
 * - **Method declarations**: extractFromMethodDeclaration()
 * - **Parameter declarations**: extractFromParameterDeclaration()
 * - **Constructor declarations**: extractFromConstructorDeclaration()
 * - **Type parameters**: extractFromTypeParameter() - Java 8+ type annotations
 *
 * ## Type Parameter Annotation Example
 *
 * ```java
 * class Container<@NonNull T,                             // Marker annotation on type parameter T
 *                 @Validated(validator = SizeValidator.class) U> {  // Parameterized annotation on U
 *     // extractFromTypeParameter() captures these annotations and links them to their type parameters
 *     // Creates TypeAnnotation entries with typeParameterHash set to link to T and U
 *     // Also extracts TypeReferences for types in annotation arguments (e.g., SizeValidator)
 * }
 * ```
 *
 * ## Array Expansion
 *
 * Each array element becomes a separate AnnotationArgumentReference with the same
 * argumentName and position, differentiated by arrayIndex (0, 1, 2, ...).
 *
 * ## Implementation Details
 *
 * - Handles balanced delimiters: (), {}, <>
 * - Parses string literals with special characters
 * - Preserves whitespace and formatting variations
 * - Processes nested annotations at arbitrary depth
 * - Extracts type references from annotation argument values
 */
export class AnnotationExtractor implements BaseExtractor<TypeAnnotation> {
  private extractedArguments: AnnotationArgumentReference[] = [];
  private extractedTypeReferences: TypeReference[] = [];

  /**
   * Returns all annotation arguments extracted during the last extraction
   */
  getExtractedArguments(): AnnotationArgumentReference[] {
    return this.extractedArguments;
  }

  /**
   * Returns all type references extracted from annotation arguments
   */
  getExtractedTypeReferences(): TypeReference[] {
    return this.extractedTypeReferences;
  }

  /**
   * Resets the extracted arguments and type references (called before each extraction)
   */
  resetExtractedArguments(): void {
    this.extractedArguments = [];
    this.extractedTypeReferences = [];
  }

  /**
   * @deprecated Use context-specific extractors instead
   */
  extract(_filePath: string, _fileContent: string, _hash: string): TypeAnnotation[] {
    console.warn('AnnotationExtractor.extract() is deprecated. Use context-specific extractors.');
    return [];
  }

  /**
   * Extract annotations from a type declaration (class, interface, enum, record, annotation).
   *
   * @param typeNode The type declaration syntax node
   * @param typeRegistryHash Hash of the type being declared
   * @param isAnnotationDeclaration Whether this is an @interface declaration
   */
  extractFromTypeDeclaration(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    isAnnotationDeclaration: boolean
  ): TypeAnnotation[] {
    const context = isAnnotationDeclaration
      ? AnnotationContext.ANNOTATION_TYPE_DECLARATION
      : AnnotationContext.TYPE_DECLARATION;

    return this.extractAnnotationsFromNode(typeNode, context, typeRegistryHash, typeRegistryHash, true);
  }

  /**
   * Extract annotations from a field declaration.
   *
   * @param fieldNode The field declaration syntax node
   * @param fieldHash Hash of the field
   * @param typeRegistryHash Hash of the enclosing type
   */
  extractFromFieldDeclaration(
    fieldNode: Parser.SyntaxNode,
    fieldHash: string,
    typeRegistryHash: string
  ): TypeAnnotation[] {
    return this.extractAnnotationsFromNode(
      fieldNode,
      AnnotationContext.FIELD_DECLARATION,
      fieldHash,
      typeRegistryHash,
      false
    );
  }

  /**
   * Extract annotations from a method declaration.
   *
   * @param methodNode The method declaration syntax node
   * @param methodHash Hash of the method
   * @param typeRegistryHash Hash of the enclosing type
   */
  extractFromMethodDeclaration(
    methodNode: Parser.SyntaxNode,
    methodHash: string,
    typeRegistryHash: string
  ): TypeAnnotation[] {
    return this.extractAnnotationsFromNode(
      methodNode,
      AnnotationContext.METHOD_DECLARATION,
      methodHash,
      typeRegistryHash,
      false
    );
  }

  /**
   * Extract annotations from a parameter declaration.
   *
   * @param paramNode The formal parameter syntax node
   * @param paramHash Hash of the parameter
   * @param typeRegistryHash Hash of the enclosing type
   */
  extractFromParameterDeclaration(
    paramNode: Parser.SyntaxNode,
    paramHash: string,
    typeRegistryHash: string
  ): TypeAnnotation[] {
    return this.extractAnnotationsFromNode(
      paramNode,
      AnnotationContext.PARAMETER_DECLARATION,
      paramHash,
      typeRegistryHash,
      false
    );
  }

  /**
   * Extract annotations from an enum constant.
   *
   * @param enumConstantNode The enum_constant syntax node
   * @param enumConstantHash Hash of the enum constant
   * @param typeRegistryHash Hash of the enclosing enum type
   */
  extractFromEnumConstant(
    enumConstantNode: Parser.SyntaxNode,
    enumConstantHash: string,
    typeRegistryHash: string
  ): TypeAnnotation[] {
    return this.extractAnnotationsFromNode(
      enumConstantNode,
      AnnotationContext.ENUM_CONSTANT,
      enumConstantHash,
      typeRegistryHash,
      false
    );
  }

  /**
   * Extract annotations from a local variable declaration.
   *
   * @param localVarDeclNode The local_variable_declaration syntax node
   * @param localVariableHash Hash of the local variable
   * @param typeRegistryHash Hash of the enclosing type
   */
  extractFromLocalVariableDeclaration(
    localVarDeclNode: Parser.SyntaxNode,
    localVariableHash: string,
    typeRegistryHash: string
  ): TypeAnnotation[] {
    return this.extractAnnotationsFromNode(
      localVarDeclNode,
      AnnotationContext.LOCAL_VARIABLE,
      localVariableHash,
      typeRegistryHash,
      false
    );
  }

  /**
   * Extract annotations from a type parameter declaration.
   *
   * @param typeParamNode The type_parameter syntax node
   * @param typeParameterHash Hash of the type parameter
   * @param typeRegistryHash Hash of the enclosing type
   */
  extractFromTypeParameter(
    typeParamNode: Parser.SyntaxNode,
    typeParameterHash: string,
    typeRegistryHash: string
  ): TypeAnnotation[] {
    const annotations: TypeAnnotation[] = [];
    let position = 0;

    for (const child of typeParamNode.children) {
      if (child.type === 'marker_annotation') {
        const annotation = this.extractMarkerAnnotation(
          child,
          AnnotationContext.TYPE_PARAMETER,
          typeParameterHash,
          typeRegistryHash,
          0,
          position,
          undefined,
          false,
          typeParameterHash  // Pass typeParameterHash to build correctly the first time
        );
        if (annotation) {
          annotations.push(annotation);
          position++;
        }
      } else if (child.type === 'annotation') {
        const extracted = this.extractParameterizedAnnotation(
          child,
          AnnotationContext.TYPE_PARAMETER,
          typeParameterHash,
          typeRegistryHash,
          0,
          position,
          undefined,
          false,
          typeParameterHash  // Pass typeParameterHash to build correctly the first time
        );
        annotations.push(...extracted);
        position++;
      }
    }

    return annotations;
  }

  /**
   * Extract annotations from type parameter bounds.
   * 
   * Handles annotations on bound types like:
   * - `<T extends @TypeAnno("OnBound") Number>` - annotation on class-level type parameter bound
   * - Method-level: `<T extends @Valid Comparable<T>>` - annotation on method type parameter bound
   * - Multiple bounds: `<T extends @NotNull Serializable & @Valid Comparable<T>>`
   * 
   * @param typeParamNode The type_parameter syntax node containing the bounds
   * @param typeParameterHash Hash of the type parameter (TypeParameter or MethodTypeParameter)
   * @param typeRegistryHash Hash of the enclosing type
   * @param isMethodTypeParam Whether this is a method-level type parameter
   */
  extractFromTypeBound(
    typeParamNode: Parser.SyntaxNode,
    typeParameterHash: string,
    typeRegistryHash: string,
    isMethodTypeParam: boolean = false
  ): TypeAnnotation[] {
    const annotations: TypeAnnotation[] = [];
    let position = 0;

    // Find the type_bound node
    let typeBoundNode: Parser.SyntaxNode | null = null;
    for (const child of typeParamNode.children) {
      if (child.type === 'type_bound') {
        typeBoundNode = child;
        break;
      }
    }

    if (!typeBoundNode) {
      return annotations;
    }

    // Process each child of the type_bound looking for annotated_type nodes
    for (const child of typeBoundNode.children) {
      if (child.type === 'annotated_type') {
        // Extract annotations from this annotated type
        const boundAnnotations = this.extractAnnotationsFromAnnotatedType(
          child,
          isMethodTypeParam ? AnnotationContext.METHOD_TYPE_PARAM_BOUND : AnnotationContext.TYPE_PARAM_BOUND,
          typeParameterHash,
          typeRegistryHash,
          position
        );
        annotations.push(...boundAnnotations);
        position += boundAnnotations.length;
      }
    }

    return annotations;
  }

  /**
   * Extract annotations from an annotated_type node.
   * 
   * An annotated_type contains annotations followed by a type, e.g., `@NonNull String`
   * 
   * @param annotatedTypeNode The annotated_type syntax node
   * @param context The annotation context
   * @param ownerHash Hash of the entity being annotated
   * @param typeRegistryHash Hash of the enclosing type
   * @param startPosition Starting position for annotation numbering
   */
  private extractAnnotationsFromAnnotatedType(
    annotatedTypeNode: Parser.SyntaxNode,
    context: AnnotationContext,
    ownerHash: string,
    typeRegistryHash: string,
    startPosition: number
  ): TypeAnnotation[] {
    const annotations: TypeAnnotation[] = [];
    let position = startPosition;

    for (const child of annotatedTypeNode.children) {
      if (child.type === 'marker_annotation') {
        const annotation = this.extractMarkerAnnotation(
          child,
          context,
          ownerHash,
          typeRegistryHash,
          0,
          position,
          undefined,
          false,
          ownerHash
        );
        if (annotation) {
          annotations.push(annotation);
          position++;
        }
      } else if (child.type === 'annotation') {
        const extracted = this.extractParameterizedAnnotation(
          child,
          context,
          ownerHash,
          typeRegistryHash,
          0,
          position,
          undefined,
          false,
          ownerHash
        );
        annotations.push(...extracted);
        position++;
      }
    }

    return annotations;
  }

  /**
   * Extract TYPE_USE annotations from exception types in a throws clause.
   * 
   * Examples:
   * - `throws @Critical IOException` - Single annotated exception
   * - `throws @Critical IOException, @NonNull SQLException` - Multiple annotated exceptions
   * 
   * @param methodNode The method declaration syntax node
   * @param typeRefHashes Array of TypeReference hashes for each exception type (in order)
   * @param typeRegistryHash Hash of the enclosing type
   */
  extractFromThrowsClause(
    methodNode: Parser.SyntaxNode,
    typeRefHashes: string[],
    typeRegistryHash: string
  ): TypeAnnotation[] {
    const annotations: TypeAnnotation[] = [];
    let position = 0;
    let typeRefIndex = 0;

    // Find the throws node
    let throwsNode: Parser.SyntaxNode | null = null;
    for (const child of methodNode.children) {
      if (child.type === 'throws') {
        throwsNode = child;
        break;
      }
    }

    if (!throwsNode) {
      return annotations;
    }

    // Process each exception type in the throws clause
    for (const child of throwsNode.children) {
      // Skip punctuation
      if (child.type === ',' || child.type === 'throws') {
        continue;
      }
      
      // Get the corresponding TypeReference hash for this exception type
      const ownerHash = typeRefHashes[typeRefIndex] || '';
      
      if (child.type === 'annotated_type') {
        // Extract annotations from this annotated exception type, link to TypeReference
        const exceptionAnnotations = this.extractAnnotationsFromAnnotatedType(
          child,
          AnnotationContext.TYPE_USE,
          ownerHash, // Link to TypeReference hash, not method hash
          typeRegistryHash,
          position
        );
        annotations.push(...exceptionAnnotations);
        position += exceptionAnnotations.length;
      }
      
      // Move to next TypeReference (whether annotated or not)
      typeRefIndex++;
    }

    return annotations;
  }

  /**
   * Extract TYPE_USE annotations from object/array creation expressions.
   * 
   * Handles type-use annotations on the instantiated type:
   * - `new @TA Object()` - Annotation on object creation
   * - `new @TA int[3]` - Annotation on array creation
   * - `new @TA ArrayList<String>()` - Annotation on generic type creation
   * 
   * In tree-sitter, these annotations are direct children of the creation expression,
   * appearing before the type node.
   * 
   * @param creationNode The object_creation_expression or array_creation_expression node
   * @param expressionHash Hash of the ExpressionReference (owner of the annotation)
   * @param typeRegistryHash Hash of the enclosing type
   */
  extractFromCreationExpression(
    creationNode: Parser.SyntaxNode,
    expressionHash: string,
    typeRegistryHash: string
  ): TypeAnnotation[] {
    const annotations: TypeAnnotation[] = [];
    let position = 0;

    for (const child of creationNode.children) {
      if (child.type === 'marker_annotation') {
        const annotation = this.extractMarkerAnnotation(
          child,
          AnnotationContext.TYPE_USE,
          expressionHash,
          typeRegistryHash,
          0,
          position,
          undefined,
          false,
          expressionHash
        );
        if (annotation) {
          annotations.push(annotation);
          position++;
        }
      } else if (child.type === 'annotation') {
        const extracted = this.extractParameterizedAnnotation(
          child,
          AnnotationContext.TYPE_USE,
          expressionHash,
          typeRegistryHash,
          0,
          position,
          undefined,
          false,
          expressionHash
        );
        annotations.push(...extracted);
        position++;
      }
    }

    return annotations;
  }

  /**
   * Extract TYPE_USE annotations from field type nodes recursively.
   * 
   * Handles nested generic type arguments with annotations:
   * - `List<@NonNull String>` - Annotation on type argument
   * - `Map<@NonNull String, @Nullable Integer>` - Multiple annotated type args
   * - `List<Map<@NonNull String, @Nullable Integer>>` - Nested annotated generics
   * 
   * @param typeNode The field type syntax node (generic_type, array_type, etc.)
   * @param typeRefHashMap Map of type argument positions to TypeReference hashes
   * @param typeRegistryHash Hash of the enclosing type
   */
  extractFromFieldType(
    typeNode: Parser.SyntaxNode,
    typeRefHashMap: Map<string, string>,
    typeRegistryHash: string
  ): TypeAnnotation[] {
    const annotations: TypeAnnotation[] = [];
    this.extractTypeUseAnnotationsRecursive(
      typeNode,
      typeRefHashMap,
      typeRegistryHash,
      annotations,
      0, // depth
      0  // position
    );
    return annotations;
  }

  /**
   * Recursively extracts TYPE_USE annotations from type nodes.
   * Walks through generic type arguments and nested structures.
   * 
   * Position keys match TypeReference format: "${depth}.${position}"
   * Example for List<Map<@NonNull String, @Nullable Integer>>:
   * - List: depth=0, position=0, key="0.0"
   * - Map: depth=1, position=0, key="1.0"
   * - String: depth=2, position=0, key="2.0"
   * - Integer: depth=2, position=1, key="2.1"
   */
  private extractTypeUseAnnotationsRecursive(
    typeNode: Parser.SyntaxNode,
    typeRefHashMap: Map<string, string>,
    typeRegistryHash: string,
    annotations: TypeAnnotation[],
    depth: number,
    position: number
  ): void {
    // If this is an annotated_type, extract the annotation
    if (typeNode.type === 'annotated_type') {
      // Build position key matching TypeReference format: depth.position
      const positionKey = `${depth}.${position}`;
      const ownerHash = typeRefHashMap.get(positionKey) || '';
      
      if (ownerHash) {
        const typeAnnotations = this.extractAnnotationsFromAnnotatedType(
          typeNode,
          AnnotationContext.TYPE_USE,
          ownerHash,
          typeRegistryHash,
          annotations.length
        );
        annotations.push(...typeAnnotations);
      }
    }

    // For generic types, recurse into type_arguments
    const actualType = typeNode.type === 'annotated_type' 
      ? this.unwrapAnnotatedTypeNode(typeNode)
      : typeNode;

    if (actualType.type === 'generic_type') {
      const typeArgsNode = actualType.children.find(c => c.type === 'type_arguments');
      if (typeArgsNode) {
        let argPosition = 0;
        for (const child of typeArgsNode.children) {
          if (this.isTypeArgumentNode(child)) {
            this.extractTypeUseAnnotationsRecursive(
              child,
              typeRefHashMap,
              typeRegistryHash,
              annotations,
              depth + 1,
              argPosition
            );
            argPosition++;
          }
        }
      }
    }

    // For array types, recurse into element type
    if (actualType.type === 'array_type') {
      const elementType = actualType.childForFieldName('element');
      if (elementType) {
        this.extractTypeUseAnnotationsRecursive(
          elementType,
          typeRefHashMap,
          typeRegistryHash,
          annotations,
          depth,
          position
        );
      }
    }

    // For wildcard types, recurse into bound
    if (actualType.type === 'wildcard') {
      let boundPosition = 0;
      for (const child of actualType.children) {
        if (this.isTypeArgumentNode(child)) {
          this.extractTypeUseAnnotationsRecursive(
            child,
            typeRefHashMap,
            typeRegistryHash,
            annotations,
            depth + 1,
            boundPosition
          );
          boundPosition++;
        }
      }
    }
  }

  /**
   * Unwraps an annotated_type node to get the underlying type.
   */
  private unwrapAnnotatedTypeNode(node: Parser.SyntaxNode): Parser.SyntaxNode {
    if (node.type === 'annotated_type') {
      for (const child of node.children) {
        if (this.isTypeArgumentNode(child) && child.type !== 'annotated_type') {
          return child;
        }
        if (child.type === 'annotated_type') {
          return this.unwrapAnnotatedTypeNode(child);
        }
      }
    }
    return node;
  }

  /**
   * Checks if a node is a type argument node.
   */
  private isTypeArgumentNode(node: Parser.SyntaxNode): boolean {
    return [
      'type_identifier',
      'generic_type',
      'scoped_type_identifier',
      'array_type',
      'annotated_type',
      'wildcard',
      'integral_type',
      'floating_point_type',
      'boolean_type',
    ].includes(node.type);
  }

  /**
   * Extract annotations from a constructor declaration.
   *
   * @param constructorNode The constructor declaration syntax node
   * @param constructorHash Hash of the constructor
   * @param typeRegistryHash Hash of the enclosing type
   */
  extractFromConstructorDeclaration(
    constructorNode: Parser.SyntaxNode,
    constructorHash: string,
    typeRegistryHash: string
  ): TypeAnnotation[] {
    return this.extractAnnotationsFromNode(
      constructorNode,
      AnnotationContext.CONSTRUCTOR_DECLARATION,
      constructorHash,
      typeRegistryHash,
      false
    );
  }

  /**
   * Core extraction method that processes annotation nodes from a parent node.
   *
   * @param parentNode The parent syntax node that may contain annotations
   * @param context The context where annotations appear
   * @param ownerHash Hash of the entity being annotated
   * @param typeRegistryHash Hash of the enclosing type
   * @param checkMetaAnnotations Whether to mark annotations as meta-annotations
   */
  private extractAnnotationsFromNode(
    parentNode: Parser.SyntaxNode,
    context: AnnotationContext,
    ownerHash: string,
    typeRegistryHash: string,
    checkMetaAnnotations: boolean
  ): TypeAnnotation[] {
    const annotations: TypeAnnotation[] = [];
    let position = 0;

    for (const child of parentNode.children) {
      if (child.type === 'marker_annotation') {
        const annotation = this.extractMarkerAnnotation(
          child,
          context,
          ownerHash,
          typeRegistryHash,
          0,
          position,
          undefined,
          checkMetaAnnotations
        );
        if (annotation) {
          annotations.push(annotation);
          position++;
        }
      } else if (child.type === 'annotation') {
        const extracted = this.extractParameterizedAnnotation(
          child,
          context,
          ownerHash,
          typeRegistryHash,
          0,
          position,
          undefined,
          checkMetaAnnotations
        );
        annotations.push(...extracted);
        position++;
      } else if (child.type === 'modifiers') {
        const modifierAnnotations = this.extractAnnotationsFromNode(
          child,
          context,
          ownerHash,
          typeRegistryHash,
          checkMetaAnnotations
        );
        annotations.push(...modifierAnnotations);
      }
    }

    return annotations;
  }

  /**
   * Extract a marker annotation (no arguments).
   *
   * Example: @Deprecated, @Nullable
   */
  private extractMarkerAnnotation(
    annotationNode: Parser.SyntaxNode,
    context: AnnotationContext,
    ownerHash: string,
    typeRegistryHash: string,
    depth: number,
    position: number,
    parentAnnotationHash: string | undefined,
    checkMetaAnnotations: boolean,
    typeParameterHash?: string
  ): TypeAnnotation | null {
    const nameNode = this.findAnnotationName(annotationNode);
    if (!nameNode) return null;

    const name = this.extractAnnotationName(nameNode);
    if (!name) return null;

    const isMeta = checkMetaAnnotations && this.isMetaAnnotation(name);

    const builder = TypeAnnotation.builder(name, AnnotationKind.MARKER, context, ownerHash)
      .typeRegistry(typeRegistryHash)
      .setDepth(depth)
      .setPosition(position)
      .metaAnnotation(isMeta);

    if (parentAnnotationHash) {
      builder.parentAnnotation(parentAnnotationHash);
    }

    if (typeParameterHash) {
      builder.typeParameter(typeParameterHash);
    }

    const startLine = annotationNode.startPosition.row + 1;
    const endLine = annotationNode.endPosition.row + 1;
    builder.location(startLine, endLine);

    const annotation = builder.build();

    // Create TypeReference for the annotation type itself
    this.createAnnotationTypeReference(annotationNode, annotation.getHash(), typeRegistryHash, nameNode);

    return annotation;
  }

  /**
   * Extract a parameterized annotation (with arguments).
   *
   * Examples:
   * - @Timeout(1000)
   * - @Column(name = "id", nullable = false)
   * - @Target({ ElementType.TYPE })
   * - @Something(meta = @Other(x = 1))
   */
  private extractParameterizedAnnotation(
    annotationNode: Parser.SyntaxNode,
    context: AnnotationContext,
    ownerHash: string,
    typeRegistryHash: string,
    depth: number,
    position: number,
    parentAnnotationHash: string | undefined,
    checkMetaAnnotations: boolean,
    typeParameterHash?: string
  ): TypeAnnotation[] {
    const annotations: TypeAnnotation[] = [];

    const nameNode = this.findAnnotationName(annotationNode);
    if (!nameNode) return annotations;

    const name = this.extractAnnotationName(nameNode);
    if (!name) return annotations;

    const argsNode = this.findAnnotationArgumentReferences(annotationNode);
    const argumentsRaw = argsNode ? this.extractArgumentsRaw(argsNode) : undefined;

    const kind = this.determineAnnotationKind(argumentsRaw);
    const isMeta = checkMetaAnnotations && this.isMetaAnnotation(name);

    const builder = TypeAnnotation.builder(name, kind, context, ownerHash)
      .typeRegistry(typeRegistryHash)
      .setDepth(depth)
      .setPosition(position)
      .metaAnnotation(isMeta);

    if (parentAnnotationHash) {
      builder.parentAnnotation(parentAnnotationHash);
    }

    if (typeParameterHash) {
      builder.typeParameter(typeParameterHash);
    }

    const startLine = annotationNode.startPosition.row + 1;
    const endLine = annotationNode.endPosition.row + 1;
    builder.location(startLine, endLine);

    const mainAnnotation = builder.build();
    annotations.push(mainAnnotation);

    // Create TypeReference for the annotation type itself
    this.createAnnotationTypeReference(annotationNode, mainAnnotation.getHash(), typeRegistryHash, nameNode);

    if (argsNode) {
      // First, extract nested annotations and build a map from their nodes to hashes
      const nestedAnnotationMap = new Map<Parser.SyntaxNode, string>();
      const nestedAnnotations = this.extractNestedAnnotations(
        argsNode,
        context,
        ownerHash,
        typeRegistryHash,
        depth + 1,
        mainAnnotation.getHash(),
        false,
        nestedAnnotationMap
      );
      annotations.push(...nestedAnnotations);

      // Extract individual arguments, using the map to link NESTED_ANNOTATION arguments
      const extractedArgs = this.extractArguments(argsNode, mainAnnotation.getHash(), nestedAnnotationMap, context, typeRegistryHash);
      this.extractedArguments.push(...extractedArgs);
    }

    return annotations;
  }

  /**
   * Extract nested annotations from annotation arguments.
   *
   * Example: @Something(meta = @Other(x = 1))
   * The @Other annotation is nested inside @Something
   */
  private extractNestedAnnotations(
    argsNode: Parser.SyntaxNode,
    context: AnnotationContext,
    ownerHash: string,
    typeRegistryHash: string,
    depth: number,
    parentAnnotationHash: string,
    checkMetaAnnotations: boolean,
    nodeToHashMap?: Map<Parser.SyntaxNode, string>
  ): TypeAnnotation[] {
    const annotations: TypeAnnotation[] = [];
    let position = 0;

    for (const child of argsNode.children) {
      if (child.type === 'marker_annotation') {
        const annotation = this.extractMarkerAnnotation(
          child,
          context,
          ownerHash,
          typeRegistryHash,
          depth,
          position,
          parentAnnotationHash,
          checkMetaAnnotations
        );
        if (annotation && nodeToHashMap) {
          nodeToHashMap.set(child, annotation.getHash());
        }
        if (annotation) {
          annotations.push(annotation);
          position++;
        }
      } else if (child.type === 'annotation') {
        const extracted = this.extractParameterizedAnnotation(
          child,
          context,
          ownerHash,
          typeRegistryHash,
          depth,
          position,
          parentAnnotationHash,
          checkMetaAnnotations
        );
        // Map the first annotation (the main one) to its node
        if (extracted.length > 0 && nodeToHashMap) {
          const firstAnnotation = extracted[0];
          if (firstAnnotation) {
            nodeToHashMap.set(child, firstAnnotation.getHash());
          }
        }
        annotations.push(...extracted);
        position++;
      } else if (child.children) {
        const nested = this.extractNestedAnnotations(
          child,
          context,
          ownerHash,
          typeRegistryHash,
          depth,
          parentAnnotationHash,
          checkMetaAnnotations,
          nodeToHashMap
        );
        annotations.push(...nested);
      }
    }

    return annotations;
  }

  /**
   * Find the annotation name node within an annotation node.
   */
  private findAnnotationName(annotationNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
    for (const child of annotationNode.children) {
      if (child.type === 'identifier' || child.type === 'scoped_identifier') {
        return child;
      }
    }
    return null;
  }

  /**
   * Extract the annotation name from a name node.
   *
   * Handles both simple names (@Deprecated) and qualified names (@javax.annotation.Nullable).
   */
  private extractAnnotationName(nameNode: Parser.SyntaxNode): string | null {
    return nameNode.text || null;
  }

  /**
   * Find the annotation arguments node within an annotation node.
   */
  private findAnnotationArgumentReferences(annotationNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
    for (const child of annotationNode.children) {
      if (child.type === 'annotation_argument_list') {
        return child;
      }
    }
    return null;
  }

  /**
   * Extract the raw arguments string from an annotation_argument_list node.
   *
   * This preserves the exact syntax including:
   * - Nested parentheses and braces
   * - String literals
   * - Nested annotations
   * - Arrays
   */
  private extractArgumentsRaw(argsNode: Parser.SyntaxNode): string {
    return argsNode.text.trim();
  }

  /**
   * Determine the annotation kind based on its arguments.
   *
   * - No arguments → MARKER
   * - Contains nested @annotations → NESTED
   * - Array syntax with {} → ARRAY_VALUE
   * - Named arguments (key = value) → NAMED_ARGUMENTS
   * - Single unnamed value → SINGLE_VALUE
   */
  private determineAnnotationKind(argumentsRaw: string | undefined): AnnotationKind {
    if (!argumentsRaw) {
      return AnnotationKind.MARKER;
    }

    const trimmed = argumentsRaw.replace(/^\(|\)$/g, '').trim();

    // Check for nested annotations
    if (trimmed.includes('@')) {
      return AnnotationKind.NESTED;
    }

    // Check for array syntax
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return AnnotationKind.ARRAY_VALUE;
    }

    // Check for named arguments
    if (trimmed.includes('=')) {
      return AnnotationKind.NAMED_ARGUMENTS;
    }

    return AnnotationKind.SINGLE_VALUE;
  }

  /**
   * Check if an annotation is a meta-annotation (used on annotation declarations).
   *
   * Common meta-annotations:
   * - @Retention
   * - @Target
   * - @Documented
   * - @Inherited
   * - @Repeatable
   */
  private isMetaAnnotation(name: string): boolean {
    const metaAnnotations = new Set([
      'Retention',
      'Target',
      'Documented',
      'Inherited',
      'Repeatable',
      'Native',
      'java.lang.annotation.Retention',
      'java.lang.annotation.Target',
      'java.lang.annotation.Documented',
      'java.lang.annotation.Inherited',
      'java.lang.annotation.Repeatable',
    ]);

    return metaAnnotations.has(name);
  }

  /**
   * Extract individual arguments from an annotation_argument_list node.
   */
  private extractArguments(
    argsNode: Parser.SyntaxNode,
    parentAnnotationHash: string,
    nestedAnnotationMap?: Map<Parser.SyntaxNode, string>,
    annotationContext?: AnnotationContext,
    typeRegistryHash?: string
  ): AnnotationArgumentReference[] {
    const args: AnnotationArgumentReference[] = [];
    let position = 0;

    for (const child of argsNode.children) {
      if (child.type === 'element_value_pair') {
        // Named argument: name = value
        // Check if this pair contains an array value
        const arrayNode = this.findArrayNode(child);
        if (arrayNode) {
          // Extract argument name from the pair
          const argName = this.extractArgumentNameFromPair(child);
          const arrayElements = this.extractArrayElements(
            argName || 'value',
            arrayNode,
            position,
            parentAnnotationHash,
            nestedAnnotationMap,
            annotationContext,
            typeRegistryHash
          );
          args.push(...arrayElements);
        } else {
          const arg = this.extractElementValuePair(child, position, parentAnnotationHash, nestedAnnotationMap, annotationContext, typeRegistryHash);
          if (arg) {
            args.push(arg);
          }
        }
        position++;
      } else if (this.isValueNode(child)) {
        // Single unnamed value (shorthand)
        if (child.type === 'element_value_array_initializer') {
          // It's an array - expand elements
          const arrayElements = this.extractArrayElements(
            'value',
            child,
            position,
            parentAnnotationHash,
            nestedAnnotationMap,
            annotationContext,
            typeRegistryHash
          );
          args.push(...arrayElements);
        } else {
          const arg = this.extractSingleValue(child, position, parentAnnotationHash, annotationContext, typeRegistryHash);
          if (arg) {
            args.push(arg);
          }
        }
        position++;
      }
    }

    return args;
  }

  /**
   * Extract a named argument pair (name = value).
   */
  private extractElementValuePair(
    pairNode: Parser.SyntaxNode,
    position: number,
    parentAnnotationHash: string,
    nestedAnnotationMap?: Map<Parser.SyntaxNode, string>,
    annotationContext?: AnnotationContext,
    typeRegistryHash?: string
  ): AnnotationArgumentReference | null {
    let argumentName = '';
    let valueNode: Parser.SyntaxNode | null = null;

    for (const child of pairNode.children) {
      if (child.type === 'identifier') {
        argumentName = child.text;
      } else if (this.isValueNode(child)) {
        valueNode = child;
      } else if (child.children && child.children.length > 0) {
        // Value might be wrapped in another node, search children
        for (const grandchild of child.children) {
          if (this.isValueNode(grandchild)) {
            valueNode = grandchild;
            break;
          }
        }
      }
    }

    if (!argumentName || !valueNode) return null;

    // Check if this value node is a nested annotation and get its hash
    const nestedAnnotationHash = nestedAnnotationMap?.get(valueNode);

    return this.createAnnotationArgumentReference(
      argumentName,
      valueNode,
      position,
      parentAnnotationHash,
      nestedAnnotationHash,
      annotationContext,
      typeRegistryHash
    );
  }

  /**
   * Extract a single unnamed value (shorthand syntax)
   */
  private extractSingleValue(
    valueNode: Parser.SyntaxNode,
    position: number,
    parentAnnotationHash: string,
    annotationContext?: AnnotationContext,
    typeRegistryHash?: string
  ): AnnotationArgumentReference | null {
    return this.createAnnotationArgumentReference(
      'value',
      valueNode,
      position,
      parentAnnotationHash,
      undefined,
      annotationContext,
      typeRegistryHash
    );
  }

  /**
   * Create an AnnotationArgumentReference from a value node
   */
  private createAnnotationArgumentReference(
    argumentName: string,
    valueNode: Parser.SyntaxNode,
    position: number,
    parentAnnotationHash: string,
    nestedAnnotationHash?: string,
    annotationContext?: AnnotationContext,
    typeRegistryHash?: string
  ): AnnotationArgumentReference | null {
    let argumentValue = valueNode.text;
    const valueType = this.determineValueType(valueNode);

    // Strip .class suffix for CLASS_REFERENCE arguments
    if (valueType === ArgumentValueType.CLASS_REFERENCE && argumentValue.endsWith('.class')) {
      argumentValue = argumentValue.slice(0, -6); // Remove last 6 characters (".class")
    }

    // Extract just annotation name for NESTED_ANNOTATION arguments
    if (valueType === ArgumentValueType.NESTED_ANNOTATION) {
      const nameNode = this.findAnnotationName(valueNode);
      if (nameNode) {
        argumentValue = this.extractAnnotationName(nameNode) || argumentValue;
      }
    }

    const builder = AnnotationArgumentReference.builder(
      argumentName,
      argumentValue,
      valueType,
      position,
      parentAnnotationHash
    );

    const startLine = valueNode.startPosition.row + 1;
    const endLine = valueNode.endPosition.row + 1;
    builder.location(startLine, endLine);
    
    // Link to nested annotation if this is a NESTED_ANNOTATION type
    if (nestedAnnotationHash && valueType === ArgumentValueType.NESTED_ANNOTATION) {
      builder.nestedAnnotation(nestedAnnotationHash);
    }

    const argumentRef = builder.build();
    
    // Extract type references for type-related argument values
    this.extractTypeReferencesFromArgument(argumentRef, valueNode, annotationContext, typeRegistryHash);

    return argumentRef;
  }

  /**
   * Determine the type of an annotation argument value
   */
  private determineValueType(valueNode: Parser.SyntaxNode): ArgumentValueType {
    const nodeType = valueNode.type;
    const text = valueNode.text;

    // Check for class reference (.class literal)
    if (nodeType === 'class_literal') {
      return ArgumentValueType.CLASS_REFERENCE;
    }

    // Check for character literal
    if (nodeType === 'character_literal') {
      return ArgumentValueType.CHAR_LITERAL;
    }

    // Check for string literal
    if (nodeType === 'string_literal') {
      return ArgumentValueType.STRING_LITERAL;
    }

    // Check for boolean
    if (nodeType === 'true' || nodeType === 'false' || text === 'true' || text === 'false') {
      return ArgumentValueType.BOOLEAN_LITERAL;
    }

    // Check for null
    if (nodeType === 'null_literal' || text === 'null') {
      return ArgumentValueType.NULL;
    }

    // Check for annotation
    if (nodeType === 'annotation' || nodeType === 'marker_annotation') {
      return ArgumentValueType.NESTED_ANNOTATION;
    }

    // Check for constant expressions (binary and unary operators)
    if (nodeType === 'binary_expression') {
      // Arithmetic, bitwise, string concatenation: 60 * 1000, 1 << 3, "a" + "b"
      return ArgumentValueType.CONSTANT_EXPRESSION;
    }

    if (nodeType === 'unary_expression') {
      // Check if it's a simple negation of a number literal (treat as NUMBER_LITERAL)
      // or other unary ops like ~, ! (treat as CONSTANT_EXPRESSION)
      const operator = this.getUnaryOperator(valueNode);
      if (operator === '-' || operator === '+') {
        // Check if operand is a simple number literal
        const operand = this.getUnaryOperand(valueNode);
        if (operand && this.isNumberLiteralType(operand.type)) {
          return ArgumentValueType.NUMBER_LITERAL;
        }
      }
      // For ~, !, or complex operands, classify as expression
      return ArgumentValueType.CONSTANT_EXPRESSION;
    }

    // Check for number literals (must come after unary check)
    if (this.isNumberLiteralType(nodeType)) {
      return ArgumentValueType.NUMBER_LITERAL;
    }

    // Note: Arrays are handled separately via extractArrayElements()
    // If we reach here with an array node, it's an error in the caller logic

    // Check for enum constant or static final field reference
    // Cannot distinguish between enum and constant without type resolution
    // Both use field_access pattern: Type.CONSTANT or just CONSTANT (if imported)
    if (nodeType === 'identifier' || nodeType === 'scoped_identifier' || nodeType === 'field_access') {
      return ArgumentValueType.ENUM_CONSTANT;
    }

    return ArgumentValueType.UNKNOWN;
  }

  /**
   * Check if node type is a number literal
   */
  private isNumberLiteralType(nodeType: string): boolean {
    return nodeType === 'decimal_integer_literal' || 
           nodeType === 'hex_integer_literal' || 
           nodeType === 'octal_integer_literal' ||
           nodeType === 'binary_integer_literal' ||
           nodeType === 'decimal_floating_point_literal' || 
           nodeType === 'hex_floating_point_literal';
  }

  /**
   * Get the operator from a unary_expression node
   */
  private getUnaryOperator(unaryNode: Parser.SyntaxNode): string | null {
    // The first child is usually the operator
    if (unaryNode.children.length > 0) {
      const firstChild = unaryNode.children[0];
      if (firstChild && !firstChild.isNamed) {
        return firstChild.text;
      }
    }
    return null;
  }

  /**
   * Get the operand from a unary_expression node
   */
  private getUnaryOperand(unaryNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
    // The operand is usually the last named child
    const namedChildren = unaryNode.namedChildren;
    if (namedChildren.length > 0) {
      return namedChildren[0] ?? null;
    }
    return null;
  }

  /**
   * Find an array node within a container node
   */
  private findArrayNode(containerNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (containerNode.type === 'element_value_array_initializer') {
      return containerNode;
    }
    
    for (const child of containerNode.children) {
      if (child.type === 'element_value_array_initializer') {
        return child;
      }
      // Recursively search in children
      const found = this.findArrayNode(child);
      if (found) return found;
    }
    
    return null;
  }

  /**
   * Extract argument name from an element_value_pair node
   */
  private extractArgumentNameFromPair(pairNode: Parser.SyntaxNode): string | null {
    for (const child of pairNode.children) {
      if (child.type === 'identifier') {
        return child.text;
      }
    }
    return null;
  }

  /**
   * Extract individual elements from an array argument
   */
  private extractArrayElements(
    argumentName: string,
    containerNode: Parser.SyntaxNode,
    position: number,
    parentAnnotationHash: string,
    nestedAnnotationMap?: Map<Parser.SyntaxNode, string>,
    annotationContext?: AnnotationContext,
    typeRegistryHash?: string
  ): AnnotationArgumentReference[] {
    const elements: AnnotationArgumentReference[] = [];
    
    // Find the element_value_array_initializer node
    let arrayNode: Parser.SyntaxNode | null = null;
    
    if (containerNode.type === 'element_value_array_initializer') {
      arrayNode = containerNode;
    } else {
      // Search in children
      for (const child of containerNode.children) {
        if (child.type === 'element_value_array_initializer') {
          arrayNode = child;
          break;
        }
      }
    }
    
    if (!arrayNode) return elements;
    
    let arrayIndex = 0;
    let hasElements = false;
    
    for (const child of arrayNode.children) {
      if (this.isValueNode(child)) {
        hasElements = true;
        let elementValue = child.text;
        const valueType = this.determineValueType(child);
        
        // Strip .class suffix for CLASS_REFERENCE
        if (valueType === ArgumentValueType.CLASS_REFERENCE && elementValue.endsWith('.class')) {
          elementValue = elementValue.slice(0, -6);
        }
        
        // Extract annotation name for NESTED_ANNOTATION
        if (valueType === ArgumentValueType.NESTED_ANNOTATION) {
          const nameNode = this.findAnnotationName(child);
          if (nameNode) {
            elementValue = this.extractAnnotationName(nameNode) || elementValue;
          }
        }
        
        // Check if this array element is a nested annotation and get its hash
        const nestedAnnotationHash = nestedAnnotationMap?.get(child);
        
        const builder = AnnotationArgumentReference.builder(
          argumentName,
          elementValue,
          valueType,
          position,
          parentAnnotationHash
        );
        
        builder.arrayPosition(arrayIndex);
        
        const startLine = child.startPosition.row + 1;
        const endLine = child.endPosition.row + 1;
        builder.location(startLine, endLine);
        
        // Link to nested annotation if this is a NESTED_ANNOTATION type
        if (nestedAnnotationHash && valueType === ArgumentValueType.NESTED_ANNOTATION) {
          builder.nestedAnnotation(nestedAnnotationHash);
        }
        
        const argumentRef = builder.build();
        elements.push(argumentRef);
        
        // Extract type references from array element values
        this.extractTypeReferencesFromArgument(argumentRef, child, annotationContext, typeRegistryHash);
        arrayIndex++;
      }
    }
    
    // Handle empty arrays: create a marker entry to distinguish from omitted arguments
    // Empty array {} is semantically different from omitted argument (which uses default)
    if (!hasElements && arrayNode.text === '{}') {
      const builder = AnnotationArgumentReference.builder(
        argumentName,
        '[]', // Marker value to represent explicitly empty array
        ArgumentValueType.NULL, // Use NULL type as marker for empty array
        position,
        parentAnnotationHash
      );
      
      builder.arrayPosition(0);
      
      const startLine = arrayNode.startPosition.row + 1;
      const endLine = arrayNode.endPosition.row + 1;
      builder.location(startLine, endLine);
      
      elements.push(builder.build());
    }
    
    return elements;
  }

  /**
   * Check if a node is a value node (can be used as annotation argument value)
   */
  private isValueNode(node: Parser.SyntaxNode): boolean {
    const valueNodeTypes = new Set([
      // Literals
      'character_literal',
      'string_literal',
      'decimal_integer_literal',
      'hex_integer_literal',
      'octal_integer_literal',
      'binary_integer_literal',
      'decimal_floating_point_literal',
      'hex_floating_point_literal',
      'true',
      'false',
      'null_literal',
      // Expressions
      'binary_expression',
      'unary_expression',
      // References
      'identifier',
      'scoped_identifier',
      'field_access',
      'class_literal',
      // Nested annotations
      'annotation',
      'marker_annotation',
      // Arrays
      'element_value_array_initializer',
    ]);

    return valueNodeTypes.has(node.type);
  }

  /**
   * Create a TypeReference for the annotation type itself.
   * E.g., @RequestMapping → TypeReference for "RequestMapping" with ANNOTATION_TYPE context.
   */
  private createAnnotationTypeReference(
    annotationNode: Parser.SyntaxNode,
    annotationHash: string,
    typeRegistryHash: string,
    nameNode: Parser.SyntaxNode
  ): void {
    const fullName = nameNode.text;
    if (!fullName) return;

    // Extract simple name (last segment for qualified names like javax.annotation.Nullable)
    let simpleName = fullName;
    const completeTypeName = fullName;

    if (nameNode.type === 'scoped_identifier') {
      const lastDot = fullName.lastIndexOf('.');
      if (lastDot >= 0) {
        simpleName = fullName.substring(lastDot + 1);
      }
    }

    const typeRef = TypeReference.builder(
      typeRegistryHash,
      TypeRefKind.CLASS,
      TypeRefContext.ANNOTATION_TYPE,
      ReferenceOwnerKind.ANNOTATION,
      annotationHash
    )
      .setTypeName(simpleName)
      .setCompleteTypeName(completeTypeName)
      .positionAndDepth(0, 0)
      .location(annotationNode.startPosition.row + 1, annotationNode.endPosition.row + 1)
      .build();

    this.extractedTypeReferences.push(typeRef);
  }

  /**
   * Extract type references from annotation argument values
   */
  private extractTypeReferencesFromArgument(
    argumentRef: AnnotationArgumentReference,
    valueNode: Parser.SyntaxNode,
    annotationContext?: AnnotationContext,
    typeRegistryHash?: string
  ): void {
    const valueType = argumentRef.getValueType();
    const argumentHash = argumentRef.getHash();
    const typeRefContext = this.mapAnnotationContextToTypeRefContext(annotationContext);

    // Handle CLASS_REFERENCE (e.g., String.class, String[].class)
    if (valueType === ArgumentValueType.CLASS_REFERENCE) {
      this.extractClassReferenceType(valueNode, argumentHash, typeRegistryHash || argumentRef.getParentAnnotationHash(), typeRefContext, annotationContext);
    }
    // Handle ENUM_CONSTANT (e.g., HttpMethod.POST, ElementType.TYPE)
    else if (valueType === ArgumentValueType.ENUM_CONSTANT) {
      this.extractEnumConstantType(valueNode, argumentHash, typeRegistryHash || argumentRef.getParentAnnotationHash(), typeRefContext, annotationContext);
    }
    // Handle CONSTANT_EXPRESSION (e.g., AnnotationTestConstants.MAX_RETRIES * 1000)
    else if (valueType === ArgumentValueType.CONSTANT_EXPRESSION) {
      this.extractConstantExpressionTypes(valueNode, argumentHash, typeRegistryHash || argumentRef.getParentAnnotationHash(), typeRefContext, annotationContext);
    }
  }

  /**
   * Map annotation context to appropriate type reference context
   */
  private mapAnnotationContextToTypeRefContext(annotationContext?: AnnotationContext): TypeRefContext {
    if (annotationContext === AnnotationContext.TYPE_PARAMETER) {
      return TypeRefContext.TYPE_PARAMETER_ANNOTATION;
    }
    // Default for all other annotation contexts (TYPE_DECLARATION, FIELD_DECLARATION, etc.)
    return TypeRefContext.ANNOTATION_PARAM;
  }

  /**
   * Map annotation context to appropriate reference owner kind
   */
  private mapAnnotationContextToOwnerKind(annotationContext?: AnnotationContext): ReferenceOwnerKind {
    if (annotationContext === AnnotationContext.TYPE_PARAMETER) {
      return ReferenceOwnerKind.TYPE_PARAMETER;
    }
    // Default for all other annotation contexts - owned by the annotation argument
    return ReferenceOwnerKind.ANNOTATION_ARGUMENT;
  }

  /**
   * Extract type reference from class literal (e.g., String.class)
   */
  private extractClassReferenceType(
    valueNode: Parser.SyntaxNode,
    argumentHash: string,
    typeRegistryHash: string,
    context: TypeRefContext = TypeRefContext.ANNOTATION_PARAM,
    annotationContext?: AnnotationContext
  ): void {
    // class_literal node structure: type_identifier or qualified_type + ".class"
    const typeNode = valueNode.namedChildren[0];
    if (!typeNode) return;

    const typeName = this.extractTypeNameFromNode(typeNode);
    if (!typeName) return;

    const ownerKind = this.mapAnnotationContextToOwnerKind(annotationContext);
    const typeRef = TypeReference.builder(
      typeRegistryHash,
      TypeRefKind.CLASS,
      context,
      ownerKind,
      argumentHash
    )
      .setTypeName(typeName)
      .setCompleteTypeName(typeName)
      .positionAndDepth(0, 0)
      .location(valueNode.startPosition.row + 1, valueNode.endPosition.row + 1)
      .build();

    this.extractedTypeReferences.push(typeRef);
  }

  /**
   * Extract type reference from enum constant (e.g., HttpMethod.POST)
   */
  private extractEnumConstantType(
    valueNode: Parser.SyntaxNode,
    argumentHash: string,
    typeRegistryHash: string,
    context: TypeRefContext = TypeRefContext.ANNOTATION_PARAM,
    annotationContext?: AnnotationContext
  ): void {
    let enumTypeName: string | null = null;

    // Extract enum type name from qualified reference
    if (valueNode.type === 'field_access') {
      // field_access: object + field
      const objectNode = valueNode.childForFieldName('object');
      if (objectNode) {
        enumTypeName = objectNode.text;
      }
    } else if (valueNode.type === 'scoped_identifier') {
      // scoped_identifier: scope + name
      const scopeNode = valueNode.childForFieldName('scope');
      if (scopeNode) {
        enumTypeName = scopeNode.text;
      }
    }

    if (!enumTypeName) return;

    // Extract simple name (last segment) for typeName; keep full scoped name for completeTypeName
    const completeEnumTypeName = enumTypeName;
    const lastDot = enumTypeName.lastIndexOf('.');
    const simpleEnumTypeName = lastDot >= 0 ? enumTypeName.substring(lastDot + 1) : enumTypeName;

    const ownerKind = this.mapAnnotationContextToOwnerKind(annotationContext);
    const typeRef = TypeReference.builder(
      typeRegistryHash,
      TypeRefKind.CLASS, // Enums are classes in Java
      context,
      ownerKind,
      argumentHash
    )
      .setTypeName(simpleEnumTypeName)
      .setCompleteTypeName(completeEnumTypeName)
      .positionAndDepth(0, 0)
      .location(valueNode.startPosition.row + 1, valueNode.endPosition.row + 1)
      .build();

    this.extractedTypeReferences.push(typeRef);
  }

  /**
   * Extract type references from constant expression
   */
  private extractConstantExpressionTypes(
    valueNode: Parser.SyntaxNode,
    argumentHash: string,
    typeRegistryHash: string,
    context: TypeRefContext = TypeRefContext.ANNOTATION_PARAM,
    annotationContext?: AnnotationContext
  ): void {
    // Recursively find all identifiers and field_access nodes
    this.extractTypesFromExpression(valueNode, argumentHash, typeRegistryHash, context, annotationContext);
  }

  /**
   * Recursively extract type references from expression nodes
   */
  private extractTypesFromExpression(
    node: Parser.SyntaxNode,
    argumentHash: string,
    typeRegistryHash: string,
    context: TypeRefContext = TypeRefContext.ANNOTATION_PARAM,
    annotationContext?: AnnotationContext
  ): void {
    // Handle field_access (e.g., AnnotationTestConstants.MAX_RETRIES)
    if (node.type === 'field_access') {
      const objectNode = node.childForFieldName('object');
      if (objectNode) {
        const completeTypeName = objectNode.text;
        const lastDot = completeTypeName.lastIndexOf('.');
        const typeName = lastDot >= 0 ? completeTypeName.substring(lastDot + 1) : completeTypeName;
        const ownerKind = this.mapAnnotationContextToOwnerKind(annotationContext);
        const typeRef = TypeReference.builder(
          typeRegistryHash,
          TypeRefKind.CLASS,
          context,
          ownerKind,
          argumentHash
        )
          .setTypeName(typeName)
          .setCompleteTypeName(completeTypeName)
          .positionAndDepth(0, 0)
          .location(node.startPosition.row + 1, node.endPosition.row + 1)
          .build();

        this.extractedTypeReferences.push(typeRef);
      }
    }

    // Recurse into children for binary/unary expressions
    for (const child of node.namedChildren) {
      this.extractTypesFromExpression(child, argumentHash, typeRegistryHash, context);
    }
  }

  /**
   * Extract type name from various type nodes
   */
  private extractTypeNameFromNode(node: Parser.SyntaxNode): string | null {
    if (node.type === 'type_identifier') {
      return node.text;
    } else if (node.type === 'scoped_type_identifier') {
      return node.text;
    } else if (node.type === 'generic_type') {
      const typeNode = node.childForFieldName('type');
      return typeNode ? typeNode.text : null;
    } else if (node.type === 'array_type') {
      const elementNode = node.childForFieldName('element');
      return elementNode ? elementNode.text : null;
    }
    return node.text;
  }
}
