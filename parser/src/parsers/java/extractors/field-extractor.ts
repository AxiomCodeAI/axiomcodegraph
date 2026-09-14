import Parser from 'tree-sitter';

import { BlockRegistry } from '@/analysis-types/java/BlockRegistry';
import { ExpressionReference } from '@/analysis-types/java/ExpressionReference';
import { FieldRegistry } from '@/analysis-types/java/FieldRegistry';
import { AnnotationArgumentReference } from '@/analysis-types/java/AnnotationArgumentReference';
import { TypeAnnotation } from '@/analysis-types/java/TypeAnnotation';
import { TypeReference } from '@/analysis-types/java/TypeReference';
import { FieldModifier } from '@/enums/java/fields';
import { TypeAccess } from '@/enums/java/types';
import { TypeRefKind, TypeRefContext, ReferenceOwnerKind } from '@/enums/java/type-references';
import { AnnotationExtractor } from '@/parsers/java/extractors/annotation-extractor';
import { ExpressionReferenceExtractor, AnonymousClassInfo } from '@/parsers/java/extractors/expression-reference-extractor';
import { LocalVariableExtractor } from '@/parsers/java/extractors/local-variable-extractor';
import { TypeReferenceExtractor } from '@/parsers/java/extractors/type-reference-extractor';
import { EntityUtils } from '@/utils/entity-utils';
import { LocalVariableRegistry } from '@/analysis-types/java/LocalVariableRegistry';
import { resolveTypeQualifiedName } from '@/utils/java/type-resolution-utils';

/**
 * Extracts FieldRegistry entities from Java type bodies using tree-sitter.
 *
 * Handles extraction of:
 * - Field names and types
 * - Access modifiers (public, protected, private, package)
 * - Field modifiers (static, final, volatile, transient)
 * - Generic and wildcard types
 * - Array types
 * - Field annotations
 * - Multi-declaration statements (int x, y, z)
 *
 * ## Tree-sitter Node Structure
 *
 * For a class like:
 * ```java
 * public class Example {
 *     private String name;
 *     public static final int COUNT = 10;
 *     private volatile boolean running;
 *     private List<String> items;
 *     private int x, y, z;
 * }
 * ```
 *
 * The tree-sitter structure is:
 * - class_declaration
 *   - class_body
 *     - field_declaration
 *       - modifiers (private)
 *       - type_identifier (String)
 *       - variable_declarator
 *         - identifier (name)
 *     - field_declaration
 *       - modifiers (public static final)
 *       - integral_type (int)
 *       - variable_declarator
 *         - identifier (COUNT)
 *         - = (equals)
 *         - decimal_integer_literal (10)
 */
export class FieldExtractor {
  private annotationExtractor: AnnotationExtractor;
  private typeReferenceExtractor: TypeReferenceExtractor;
  private expressionExtractor: ExpressionReferenceExtractor;
  private localVariableExtractor: LocalVariableExtractor;
  private extractedAnnotations: TypeAnnotation[] = [];
  private extractedAnnotationArguments: AnnotationArgumentReference[] = [];
  private extractedTypeReferences: TypeReference[] = [];
  private extractedExpressions: ExpressionReference[] = [];
  private extractedAnonymousClasses: AnonymousClassInfo[] = [];
  private extractedLocalVariables: LocalVariableRegistry[] = [];
  private extractedBlocks: BlockRegistry[] = [];

  constructor() {
    this.annotationExtractor = new AnnotationExtractor();
    this.typeReferenceExtractor = new TypeReferenceExtractor();
    this.expressionExtractor = new ExpressionReferenceExtractor();
    this.localVariableExtractor = new LocalVariableExtractor();
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
   * Returns all type references extracted during the last extraction
   */
  getExtractedTypeReferences(): TypeReference[] {
    return this.extractedTypeReferences;
  }

  /**
   * Returns all expressions extracted during the last extraction
   */
  getExtractedExpressions(): ExpressionReference[] {
    return this.extractedExpressions;
  }

  /**
   * Returns all anonymous classes encountered during the last extraction.
   * These need to be registered as types at a higher level.
   */
  getExtractedAnonymousClasses(): AnonymousClassInfo[] {
    return this.extractedAnonymousClasses;
  }

  /**
   * Returns all local variables extracted from lambda bodies in field initializers
   */
  getExtractedLocalVariables(): LocalVariableRegistry[] {
    return this.extractedLocalVariables;
  }

  /**
   * Returns all blocks extracted from lambda bodies in field initializers
   */
  getExtractedBlocks(): BlockRegistry[] {
    return this.extractedBlocks;
  }

  /**
   * Extracts fields from a type body (class_body, interface_body, enum_body)
   */
  extractFromTypeBody(
    bodyNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    isInterface: boolean = false
  ): FieldRegistry[] {
    // Reset extracted collections
    this.extractedAnnotations = [];
    this.extractedAnnotationArguments = [];
    this.extractedTypeReferences = [];
    this.extractedExpressions = [];
    this.extractedAnonymousClasses = [];
    this.extractedLocalVariables = [];
    this.extractedBlocks = [];

    const fields: FieldRegistry[] = [];

    // Helper to process field declarations from a node
    const processFieldDeclarations = (node: Parser.SyntaxNode) => {
      for (const child of node.children) {
        // Handle regular field declarations (classes, enums)
        // and constant declarations (interfaces use constant_declaration)
        if (child.type === 'field_declaration' || child.type === 'constant_declaration') {
          const extractedFields = this.extractFieldDeclaration(
            child,
            filePath,
            typeRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            isInterface || child.type === 'constant_declaration'
          );
          fields.push(...extractedFields);
        }
        // Enum bodies have nested enum_body_declarations containing field declarations
        else if (child.type === 'enum_body_declarations') {
          processFieldDeclarations(child);
        }
        // Enum constants may have anonymous class bodies with fields
        else if (child.type === 'enum_constant') {
          for (const constantChild of child.children) {
            if (constantChild.type === 'class_body') {
              // Extract fields from enum constant anonymous body
              const enumConstantFields = this.extractFromEnumConstantBody(
                constantChild,
                filePath,
                typeRegistryHash,
                ownerTypeName,
                ownerQualifiedName,
                serviceVersionHash,
                packageName,
                importMap,
                hasStarImports
              );
              fields.push(...enumConstantFields);
            }
          }
        }
      }
    };

    processFieldDeclarations(bodyNode);

    // JLS 8.10.1: each record component implicitly declares a private final field of the same
    // name and type. The components sit on the record_declaration, not in the body, so nothing
    // in the loop above can see them.
    if (bodyNode.parent?.type === 'record_declaration') {
      fields.push(...this.extractRecordComponentFields(
        bodyNode.parent,
        filePath,
        typeRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        serviceVersionHash,
        packageName
      ));
    }

    return fields;
  }

  /**
   * Builds the private final field each record component implicitly declares.
   *
   * A record cannot declare an instance field of its own (JLS 8.10.1), so there is nothing here
   * to collide with what the body loop already produced.
   */
  private extractRecordComponentFields(
    recordNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    packageName: string | null
  ): FieldRegistry[] {
    const fields: FieldRegistry[] = [];

    const formalParams = recordNode.children.find(c => c.type === 'formal_parameters');
    if (!formalParams) return fields;

    for (const component of formalParams.children) {
      if (component.type !== 'formal_parameter' && component.type !== 'spread_parameter') continue;

      // A spread_parameter carries no `name`/`type` fields - it is
      // <type> "..." <variable_declarator> - so both shapes are read positionally.
      const isVarargs = component.type === 'spread_parameter';
      const typeNode = isVarargs
        ? component.children.find(c => c.type !== '...' && c.type !== 'variable_declarator' && c.type !== 'modifiers')
        : component.childForFieldName('type');
      const nameNode = isVarargs
        ? component.children.find(c => c.type === 'variable_declarator')
        : component.childForFieldName('name');
      if (!nameNode || !typeNode) continue;

      // A varargs component's field type is the array type it erases to.
      const baseTypeName = EntityUtils.normalizeWhitespace(typeNode.text);
      const fieldTypeName = isVarargs ? `${baseTypeName}[]` : baseTypeName;
      const line = component.startPosition.row + 1;

      const field = FieldRegistry.builder(
        EntityUtils.normalizeWhitespace(nameNode.text),
        fieldTypeName,
        this.extractBaseType(fieldTypeName),
        filePath,
        line,
        line,
        typeRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        TypeAccess.PRIVATE_ACCESS,
        serviceVersionHash
      )
        .withModifiers([FieldModifier.FINAL])
        .build();

      fields.push(field);

      this.extractFieldTypeReferences(typeNode, typeRegistryHash, field.getHash(), packageName);
    }

    return fields;
  }

  /**
   * Extracts fields from an enum constant's anonymous class body.
   * Example: enum Status { ACTIVE { private int priority = 1; } }
   */
  extractFromEnumConstantBody(
    classBodyNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean
  ): FieldRegistry[] {
    const fields: FieldRegistry[] = [];

    for (const child of classBodyNode.children) {
      if (child.type === 'field_declaration') {
        const extractedFields = this.extractFieldDeclaration(
          child,
          filePath,
          typeRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          false // enum constant bodies are not interfaces
        );
        fields.push(...extractedFields);
      }
    }

    return fields;
  }

  /**
   * Extracts fields from an anonymous class body.
   * This is a public method specifically for anonymous class field extraction.
   */
  extractFromAnonymousClassBody(
    classBodyNode: Parser.SyntaxNode,
    filePath: string,
    anonymousTypeHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean
  ): FieldRegistry[] {
    // Reset extracted collections for this anonymous class
    this.extractedAnnotations = [];
    this.extractedAnnotationArguments = [];
    this.extractedTypeReferences = [];
    this.extractedExpressions = [];
    this.extractedLocalVariables = [];
    this.extractedBlocks = [];
    // Note: We don't reset extractedAnonymousClasses here to allow nested anonymous classes

    const fields: FieldRegistry[] = [];

    for (const child of classBodyNode.children) {
      if (child.type === 'field_declaration') {
        const extractedFields = this.extractFieldDeclaration(
          child,
          filePath,
          anonymousTypeHash,
          ownerTypeName,
          ownerQualifiedName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          false // anonymous classes are not interfaces
        );
        fields.push(...extractedFields);
      }
    }

    return fields;
  }

  /**
   * Extracts fields from a field_declaration node.
   * Handles multi-declaration statements like: private int x, y, z;
   */
  private extractFieldDeclaration(
    fieldNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    isInterface: boolean
  ): FieldRegistry[] {
    const fields: FieldRegistry[] = [];

    // Extract modifiers
    const { access, modifiers } = this.extractModifiers(fieldNode, isInterface);

    // Extract the type node
    const typeNode = this.findTypeNode(fieldNode);
    if (!typeNode) {
      return fields;
    }

    // Get the full type name as written
    const fieldTypeName = EntityUtils.normalizeWhitespace(typeNode.text);
    const fieldBaseType = this.extractBaseType(fieldTypeName);

    // Resolve qualified name
    const { potentialQualifiedName, isAmbiguous } = resolveTypeQualifiedName(
      fieldBaseType,
      packageName,
      importMap,
      hasStarImports
    );

    // Find all variable declarators (handles multi-declaration: int x, y, z)
    const declarators = fieldNode.children.filter(
      child => child.type === 'variable_declarator'
    );

    for (const declarator of declarators) {
      const nameNode = declarator.children.find(c => c.type === 'identifier');
      if (!nameNode) continue;

      const fieldName = nameNode.text;
      const startLine = declarator.startPosition.row + 1;
      const endLine = declarator.endPosition.row + 1;

      // Handle C-style array declarations (int myArray[] vs int[] myArray)
      // C-style puts dimensions in the variable_declarator, not the type node
      const cStyleDimensions = declarator.children.find(c => c.type === 'dimensions');
      let actualFieldTypeName = fieldTypeName;
      let actualFieldBaseType = fieldBaseType;
      if (cStyleDimensions) {
        // Append C-style dimensions to the type name
        actualFieldTypeName = fieldTypeName + cStyleDimensions.text;
        actualFieldBaseType = this.extractBaseType(actualFieldTypeName);
      }

      // Build the field entity
      const fieldBuilder = FieldRegistry.builder(
        fieldName,
        actualFieldTypeName,
        actualFieldBaseType,
        filePath,
        startLine,
        endLine,
        typeRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        access,
        serviceVersionHash
      );

      if (potentialQualifiedName) {
        fieldBuilder.withPotentialQualifiedName(potentialQualifiedName);
      }
      fieldBuilder.withIsAmbiguous(isAmbiguous);
      fieldBuilder.withModifiers(modifiers);

      const field = fieldBuilder.build();
      fields.push(field);

      // Extract annotations for this field
      this.extractFieldAnnotations(fieldNode, typeRegistryHash, field.getHash());

      // Extract type references for the field type
      // Pass C-style dimensions if present for proper ARRAY type reference creation
      this.extractFieldTypeReferences(
        typeNode,
        typeRegistryHash,
        field.getHash(),
        packageName,
        cStyleDimensions
      );

      // Extract expressions from field initializer (if present)
      const equalsIndex = declarator.children.findIndex(c => c.type === '=');
      if (equalsIndex >= 0 && equalsIndex < declarator.children.length - 1) {
        const initializerNode = declarator.children[equalsIndex + 1];
        if (initializerNode) {
          const expressions = this.expressionExtractor.extractFromFieldInitializer(
            initializerNode,
            typeRegistryHash,
            field.getHash(),
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports
          );
          this.extractedExpressions.push(...expressions);
          
          // Collect type references from method type arguments in expressions
          const expressionTypeRefs = this.expressionExtractor.getExtractedTypeReferences();
          this.extractedTypeReferences.push(...expressionTypeRefs);

          // Collect type-use annotations from object/array creation expressions
          const expressionAnnotations = this.expressionExtractor.getExtractedAnnotations();
          this.extractedAnnotations.push(...expressionAnnotations);

          // Collect anonymous classes from field initializers
          const anonymousClasses = this.expressionExtractor.getExtractedAnonymousClasses();
          this.extractedAnonymousClasses.push(...anonymousClasses);

          // Extract local variables and return statements from lambda block bodies
          const lambdaLocalVars = this.localVariableExtractor.extractFromFieldInitializerLambdas(
            initializerNode,
            filePath,
            typeRegistryHash,
            field.getHash(),
            ownerTypeName,
            ownerQualifiedName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            this.extractedExpressions
          );
          this.extractedLocalVariables.push(...lambdaLocalVars);
          
          // Collect blocks from lambda bodies (try/catch/finally)
          const lambdaBlocks = this.localVariableExtractor.getExtractedBlocks();
          this.extractedBlocks.push(...lambdaBlocks);
          
          // Collect expressions from lambda body statements
          const lambdaExpressions = this.localVariableExtractor.getExtractedExpressions();
          this.extractedExpressions.push(...lambdaExpressions);
          
          // Collect type references from lambda body local variables
          const lambdaTypeRefs = this.localVariableExtractor.getExtractedTypeReferences();
          this.extractedTypeReferences.push(...lambdaTypeRefs);
          
          // Collect annotations from lambda body local variables
          const lambdaAnnotations = this.localVariableExtractor.getExtractedAnnotations();
          this.extractedAnnotations.push(...lambdaAnnotations);
        }
      }

    }

    return fields;
  }

  /**
   * Extracts access and modifier information from a field declaration
   */
  private extractModifiers(
    fieldNode: Parser.SyntaxNode,
    isInterface: boolean
  ): { access: TypeAccess; modifiers: FieldModifier[] } {
    let access = TypeAccess.PACKAGE_ACCESS;
    const modifiers: FieldModifier[] = [];

    // Interface fields are implicitly public static final
    if (isInterface) {
      access = TypeAccess.PUBLIC_ACCESS;
      modifiers.push(FieldModifier.STATIC, FieldModifier.FINAL);
    }

    const modifiersNode = fieldNode.children.find(c => c.type === 'modifiers');
    if (!modifiersNode) {
      return { access, modifiers };
    }

    for (const mod of modifiersNode.children) {
      switch (mod.type) {
        case 'public':
          access = TypeAccess.PUBLIC_ACCESS;
          break;
        case 'protected':
          access = TypeAccess.PROTECTED_ACCESS;
          break;
        case 'private':
          access = TypeAccess.PRIVATE_ACCESS;
          break;
        case 'static':
          if (!modifiers.includes(FieldModifier.STATIC)) {
            modifiers.push(FieldModifier.STATIC);
          }
          break;
        case 'final':
          if (!modifiers.includes(FieldModifier.FINAL)) {
            modifiers.push(FieldModifier.FINAL);
          }
          break;
        case 'volatile':
          modifiers.push(FieldModifier.VOLATILE);
          break;
        case 'transient':
          modifiers.push(FieldModifier.TRANSIENT);
          break;
      }
    }

    return { access, modifiers };
  }

  /**
   * Finds the type node in a field declaration
   */
  private findTypeNode(fieldNode: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
    // Type nodes can be various types depending on the Java type
    const typeNodeTypes = [
      'type_identifier',           // Simple types: String, MyClass
      'scoped_type_identifier',    // Qualified types: java.util.List
      'generic_type',              // Generic types: List<String>
      'array_type',                // Array types: String[], int[][]
      'integral_type',             // int, long, short, byte
      'floating_point_type',       // float, double
      'boolean_type',              // boolean
      'void_type',                 // void (shouldn't appear in fields)
    ];

    for (const child of fieldNode.children) {
      if (typeNodeTypes.includes(child.type)) {
        return child;
      }
    }

    return undefined;
  }

  /**
   * Extracts the base type from a full type name (strips generics and annotations)
   * 
   * Examples:
   * - "List<String>" -> "List"
   * - "String[]" -> "String"
   * - "String @NonNull []" -> "String"
   * - "@NonNull String @NonNull []" -> "String"
   * - "Map<@NonNull String, Integer>" -> "Map"
   */
  private extractBaseType(fullTypeName: string): string {
    // Handle array types first - get the component type
    let baseType = fullTypeName;
    
    // Strip array brackets (with optional annotations before them)
    // Pattern: optional whitespace, optional @annotation, optional whitespace, []
    baseType = baseType.replace(/(\s*@\w+\s*)?\[\]/g, '');
    
    // Strip generics
    const genericStart = baseType.indexOf('<');
    if (genericStart !== -1) {
      baseType = baseType.substring(0, genericStart);
    }
    
    // Strip any remaining annotations (like @NonNull before type name)
    baseType = baseType.replace(/@\w+\s*/g, '');
    
    return baseType.trim();
  }

  /**
   * Counts the number of array dimensions from a dimensions node.
   * For C-style arrays like `int myArray[][]`, the dimensions node contains `[][]`
   */
  private countDimensions(dimensionsNode: Parser.SyntaxNode): number {
    // Count '[' characters in the dimensions text
    const text = dimensionsNode.text;
    let count = 0;
    for (const char of text) {
      if (char === '[') count++;
    }
    return count;
  }

  /**
   * Extracts annotations from a field declaration
   */
  private extractFieldAnnotations(
    fieldNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    fieldHash: string
  ): void {
    const modifiersNode = fieldNode.children.find(c => c.type === 'modifiers');
    if (!modifiersNode) return;

    // Reset annotation extractor
    this.annotationExtractor.resetExtractedArguments();

    for (const child of modifiersNode.children) {
      if (child.type === 'marker_annotation' || child.type === 'annotation') {
        // Extract the annotation - signature is (fieldNode, fieldHash, typeRegistryHash)
        const annotations = this.annotationExtractor.extractFromFieldDeclaration(
          fieldNode,
          fieldHash,
          typeRegistryHash
        );
        this.extractedAnnotations.push(...annotations);

        // Collect annotation arguments
        const args = this.annotationExtractor.getExtractedArguments();
        this.extractedAnnotationArguments.push(...args);
        break; // extractFromFieldDeclaration handles all annotations
      }
    }
  }

  /**
   * Extracts type references from the field type (for generics, wildcards, etc.)
   * 
   * Handles complex types like:
   * - Generic types: List<String>, Map<String, Integer>
   * - Wildcard types: List<? extends Number>, Map<?, ? super String>
   * - Array types: String[], int[][]
   * - Nested generics: Map<String, List<Integer>>
   * - Type-use annotations: List<@NonNull String>, Map<@NonNull String, @Nullable Integer>
   * - C-style arrays: int myArray[] (dimensions in variable_declarator)
   */
  private extractFieldTypeReferences(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    fieldHash: string,
    packageName: string | null,
    cStyleDimensions?: Parser.SyntaxNode
  ): void {
    // Handle C-style array declarations (int myArray[] instead of int[] myArray)
    // For C-style, the typeNode is just the element type, dimensions are separate
    if (cStyleDimensions) {
      const dimensionCount = this.countDimensions(cStyleDimensions);
      const elementTypeName = typeNode.text;
      
      // Create ARRAY type reference for C-style arrays
      const arrayRef = TypeReference.builder(
        typeRegistryHash,
        TypeRefKind.ARRAY,
        TypeRefContext.FIELD_TYPE,
        ReferenceOwnerKind.FIELD,
        fieldHash
      )
        .setTypeName(elementTypeName)
        .setCompleteTypeName(elementTypeName)
        .array(dimensionCount)
        .positionAndDepth(0, 0)
        .build();
      
      this.extractedTypeReferences.push(arrayRef);
      return;
    }
    
    // Extract type references for complex types (generics, arrays, wildcards)
    const typeRefs = this.typeReferenceExtractor.extractFromField(
      typeNode,
      typeRegistryHash,
      fieldHash,
      packageName
    );
    this.extractedTypeReferences.push(...typeRefs);

    // Build a map of position keys to TypeReference hashes for annotation linking
    const typeRefHashMap = new Map<string, string>();
    for (const ref of typeRefs) {
      // Create position key based on depth and position
      const positionKey = `${ref.getDepth()}.${ref.getPosition()}`;
      typeRefHashMap.set(positionKey, ref.getHash());
    }

    // Reset before extracting TYPE_USE annotations to avoid duplicates
    this.annotationExtractor.resetExtractedArguments();

    // Extract TYPE_USE annotations from annotated type arguments (e.g., List<@NonNull String>)
    const typeUseAnnotations = this.annotationExtractor.extractFromFieldType(
      typeNode,
      typeRefHashMap,
      typeRegistryHash
    );
    this.extractedAnnotations.push(...typeUseAnnotations);

    // Collect annotation arguments from TYPE_USE annotations
    const typeUseArgs = this.annotationExtractor.getExtractedArguments();
    this.extractedAnnotationArguments.push(...typeUseArgs);
  }
}
