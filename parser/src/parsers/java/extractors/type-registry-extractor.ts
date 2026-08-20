import * as path from 'path';

import Parser from 'tree-sitter';

import { MethodParameter } from '@/analysis-methods/java/MethodParameter';
import { MethodRegistry } from '@/analysis-methods/java/MethodRegistry';
import { MethodTypeParameter } from '@/analysis-methods/java/MethodTypeParameter';
import { AnnotationArgumentReference } from '@/analysis-types/java/AnnotationArgumentReference';
import { EnumConstant } from '@/analysis-types/java/EnumConstant';
import { ExpressionReference } from '@/analysis-types/java/ExpressionReference';
import { FieldRegistry } from '@/analysis-types/java/FieldRegistry';
import { LocalVariableRegistry } from '@/analysis-types/java/LocalVariableRegistry';
import { BlockRegistry } from '@/analysis-types/java/BlockRegistry';
import { CommentRegistry } from '@/analysis-types/java/CommentRegistry';
import { TypeAnnotation } from '@/analysis-types/java/TypeAnnotation';
import { TypeParameter } from '@/analysis-types/java/TypeParameter';
import { TypeReference } from '@/analysis-types/java/TypeReference';
import { TypeRegistry } from '@/analysis-types/java/TypeRegistry';
import { TypeAccess, TypeCategory, TypeModifier, TypePlacement } from '@/enums';
import { BaseExtractor } from '@/parsers/base-extractor';
import { AnnotationExtractor } from '@/parsers/java/extractors/annotation-extractor';
import { EnumConstantExtractor } from '@/parsers/java/extractors/enum-constant-extractor';
import { FieldExtractor } from '@/parsers/java/extractors/field-extractor';
import { AnonymousClassInfo } from '@/parsers/java/extractors/expression-reference-extractor';
import { TypeMethodExtractor } from '@/parsers/java/extractors/type-method-extractor';
import { TypeParameterExtractor } from '@/parsers/java/extractors/type-parameter-extractor';
import { CommentExtractor } from '@/parsers/java/extractors/comment-extractor';
import { JavaParser } from '@/parsers/java/java-parser';

/**
 * Extracts TypeRegistry entities from Java source files using tree-sitter
 */
export class TypeRegistryExtractor implements BaseExtractor<TypeRegistry> {
  private javaParser: JavaParser;
  private typeParameterExtractor: TypeParameterExtractor;
  private annotationExtractor: AnnotationExtractor;
  private methodExtractor: TypeMethodExtractor;
  private enumConstantExtractor: EnumConstantExtractor;
  private fieldExtractor: FieldExtractor;
  private extractedTypeParameters: TypeParameter[] = [];
  private extractedTypeReferences: TypeReference[] = [];
  private extractedAnnotations: TypeAnnotation[] = [];
  private extractedAnnotationArguments: AnnotationArgumentReference[] = [];
  private extractedMethods: MethodRegistry[] = [];
  private extractedMethodParameters: MethodParameter[] = [];
  private extractedMethodTypeParameters: MethodTypeParameter[] = [];
  private extractedEnumConstants: EnumConstant[] = [];
  private extractedFields: FieldRegistry[] = [];
  private extractedExpressions: ExpressionReference[] = [];
  private extractedLocalVariables: LocalVariableRegistry[] = [];
  private extractedBlocks: BlockRegistry[] = [];
  private extractedComments: CommentRegistry[] = [];
  private commentExtractor: CommentExtractor;

  constructor() {
    this.javaParser = new JavaParser();
    this.typeParameterExtractor = new TypeParameterExtractor();
    this.annotationExtractor = new AnnotationExtractor();
    this.methodExtractor = new TypeMethodExtractor();
    this.enumConstantExtractor = new EnumConstantExtractor();
    this.fieldExtractor = new FieldExtractor();
    this.commentExtractor = new CommentExtractor();
  }

  /**
   * Returns all type parameters extracted during the last extract() call
   */
  getExtractedTypeParameters(): TypeParameter[] {
    return this.extractedTypeParameters;
  }

  /**
   * Returns all type references extracted during the last extract() call
   */
  getExtractedTypeReferences(): TypeReference[] {
    return this.extractedTypeReferences;
  }

  /**
   * Returns all annotations extracted during the last extract() call
   */
  getExtractedAnnotations(): TypeAnnotation[] {
    return this.extractedAnnotations;
  }

  /**
   * Returns all annotation arguments extracted during the last extract() call
   */
  getExtractedAnnotationArguments(): AnnotationArgumentReference[] {
    return this.extractedAnnotationArguments;
  }

  /**
   * Returns all methods extracted during the last extract() call
   */
  getExtractedMethods(): MethodRegistry[] {
    return this.extractedMethods;
  }

  /**
   * Returns all method parameters extracted during the last extract() call
   */
  getExtractedMethodParameters(): MethodParameter[] {
    return this.extractedMethodParameters;
  }

  /**
   * Returns all method type parameters extracted during the last extract() call
   */
  getExtractedMethodTypeParameters(): MethodTypeParameter[] {
    return this.extractedMethodTypeParameters;
  }

  /**
   * Returns all enum constants extracted during the last extract() call
   */
  getExtractedEnumConstants(): EnumConstant[] {
    return this.extractedEnumConstants;
  }

  /**
   * Returns all fields extracted during the last extract() call
   */
  getExtractedFields(): FieldRegistry[] {
    return this.extractedFields;
  }

  /**
   * Returns all expressions extracted during the last extract() call
   */
  getExtractedExpressions(): ExpressionReference[] {
    return this.extractedExpressions;
  }

  /**
   * Returns all local variables extracted during the last extract() call
   */
  getExtractedLocalVariables(): LocalVariableRegistry[] {
    return this.extractedLocalVariables;
  }

  /**
   * Returns all blocks extracted during the last extract() call
   */
  getExtractedBlocks(): BlockRegistry[] {
    return this.extractedBlocks;
  }

  /**
   * Returns all comments extracted during the last extract() call
   */
  getExtractedComments(): CommentRegistry[] {
    return this.extractedComments;
  }

  /**
   * Extracts type definitions (classes, interfaces, enums, annotations) from Java source
   */
  extract(filePath: string, fileContent: string, serviceVersionHash: string): TypeRegistry[] {
    const types: TypeRegistry[] = [];
    this.extractedTypeParameters = []; // Reset for each file
    this.extractedTypeReferences = []; // Reset for each file
    this.extractedAnnotations = []; // Reset for each file
    this.extractedAnnotationArguments = []; // Reset for each file
    this.extractedMethods = []; // Reset for each file
    this.extractedMethodParameters = []; // Reset for each file
    this.extractedMethodTypeParameters = []; // Reset for each file
    this.extractedEnumConstants = []; // Reset for each file
    this.extractedFields = []; // Reset for each file
    this.extractedExpressions = []; // Reset for each file
    this.extractedLocalVariables = []; // Reset for each file
    this.extractedBlocks = []; // Reset for each file
    this.extractedComments = []; // Reset for each file
    
    try {
      if (!fileContent || typeof fileContent !== 'string') {
        console.warn(`Skipping ${filePath}: invalid content`);
        return types;
      }
      
      const tree = this.javaParser.parse(fileContent);
      const rootNode = this.javaParser.getRootNode(tree);

      const basePath = this.extractBasePath(filePath);
      const fileName = path.basename(filePath);

      // Extract imports and package at file level
      const { importMap, hasStarImports } = this.extractImports(rootNode);
      const packageName = this.extractPackageDeclaration(rootNode);

      this.extractTypes(rootNode, filePath, basePath, fileName, serviceVersionHash, packageName, importMap, hasStarImports, types);

      // Extract comments after all entities are available for position mapping
      const positionToHash = this.buildPositionToHashMap(types);
      const comments = this.commentExtractor.extract(rootNode, filePath, positionToHash);
      this.extractedComments.push(...comments);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to parse ${filePath}: ${errorMessage}`);
    }

    return types;
  }

  /**
   * Recursively extracts type definitions from syntax nodes
   */
  private extractTypes(
    node: Parser.SyntaxNode,
    filePath: string,
    basePath: string,
    fileName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    types: TypeRegistry[]
  ): void {
    if (this.isTypeDeclaration(node)) {
      const typeRegistry = this.createTypeRegistry(
        node,
        filePath,
        basePath,
        fileName,
        serviceVersionHash
      );
      if (typeRegistry) {
        types.push(typeRegistry);
        
        // Package name already extracted at file level
        
        // Extract annotations from this type declaration
        // Reset the extractor's argument array before each type to prevent accumulation
        this.annotationExtractor.resetExtractedArguments();
        
        const isAnnotationDeclaration = node.type === 'annotation_type_declaration';
        const annotations = this.annotationExtractor.extractFromTypeDeclaration(
          node,
          typeRegistry.getHash(),
          isAnnotationDeclaration
        );
        this.extractedAnnotations.push(...annotations);
        
        // Collect annotation arguments from the extractor
        const annotationArgs = this.annotationExtractor.getExtractedArguments();
        this.extractedAnnotationArguments.push(...annotationArgs);
        
        // Collect type references from annotation arguments
        const annotationTypeRefs = this.annotationExtractor.getExtractedTypeReferences();
        this.extractedTypeReferences.push(...annotationTypeRefs);
        
        // Extract type parameters from this specific type declaration node
        const typeParams = this.typeParameterExtractor.extractFromNode(
          node,
          typeRegistry.getName(),
          typeRegistry.getQualifiedName(),
          typeRegistry.getFilePath(),
          typeRegistry.getStartLine(),
          typeRegistry.getHash(),
          packageName
        );
        this.extractedTypeParameters.push(...typeParams);
        
        // Collect annotations from type parameters
        const typeParamAnnotations = this.typeParameterExtractor.getExtractedAnnotations();
        this.extractedAnnotations.push(...typeParamAnnotations);
        
        // Collect type references from type parameter bounds
        const typeRefs = this.typeParameterExtractor.getExtractedTypeReferences();
        this.extractedTypeReferences.push(...typeRefs);
        
        // Collect type references from type parameter annotation arguments
        const typeParamAnnotationTypeRefs = this.typeParameterExtractor.getAnnotationExtractor().getExtractedTypeReferences();
        this.extractedTypeReferences.push(...typeParamAnnotationTypeRefs);
        
        // Collect annotation arguments from type parameter annotations
        const typeParamAnnotationArgs = this.typeParameterExtractor.getAnnotationExtractor().getExtractedArguments();
        this.extractedAnnotationArguments.push(...typeParamAnnotationArgs);
        
        // Collect declared type parameter names for proper classification
        const declaredTypeParams = new Set(typeParams.map(tp => tp.getName()));
        
        const typeRefExtractor = this.typeParameterExtractor.getTypeReferenceExtractor();
        
        // Extract type references based on type category
        if (node.type === 'interface_declaration') {
          // For interfaces: extract from extends clause (interface extending other interfaces)
          const interfaceExtensionRefs = typeRefExtractor.extractFromInterfaceExtension(
            node,
            typeRegistry.getHash(),
            packageName,
            declaredTypeParams
          );
          this.extractedTypeReferences.push(...interfaceExtensionRefs);
        } else {
          // For classes: extract from superclass (extends clause)
          const superRefs = typeRefExtractor.extractFromSuperclass(
            node,
            typeRegistry.getHash(),
            packageName,
            declaredTypeParams
          );
          this.extractedTypeReferences.push(...superRefs);
          
          // For classes: extract from interfaces (implements clause)
          const interfaceRefs = typeRefExtractor.extractFromInterfaces(
            node,
            typeRegistry.getHash(),
            packageName,
            declaredTypeParams
          );
          this.extractedTypeReferences.push(...interfaceRefs);
        }
        
        // Extract permits clause (for sealed types - both classes and interfaces)
        const permitsRefs = typeRefExtractor.extractFromPermits(
          node,
          typeRegistry.getHash(),
          packageName,
          declaredTypeParams
        );
        this.extractedTypeReferences.push(...permitsRefs);
        
        // Extract methods from this type
        const methods = this.methodExtractor.extractFromType(
          node,
          filePath,
          typeRegistry.getHash(),
          typeRegistry.getName(),
          typeRegistry.getQualifiedName(),
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports
        );
        this.extractedMethods.push(...methods);
        
        // Collect method parameters extracted during method extraction
        const methodParams = this.methodExtractor.getExtractedMethodParameters();
        this.extractedMethodParameters.push(...methodParams);
        
        // Collect method type parameters extracted during method extraction
        const methodTypeParams = this.methodExtractor.getExtractedMethodTypeParameters();
        this.extractedMethodTypeParameters.push(...methodTypeParams);
        
        // Collect annotations from methods and parameters
        const methodAnnotations = this.methodExtractor.getExtractedAnnotations();
        this.extractedAnnotations.push(...methodAnnotations);
        
        // Collect annotation arguments from method and parameter annotations
        const methodAnnotationArgs = this.methodExtractor.getExtractedAnnotationArguments();
        this.extractedAnnotationArguments.push(...methodAnnotationArgs);
        
        // Collect type references from method parameters
        const paramTypeRefs = this.methodExtractor.getExtractedTypeReferences();
        this.extractedTypeReferences.push(...paramTypeRefs);
        
        // Collect expressions from method bodies (return statements, etc.)
        const methodBodyExpressions = this.methodExtractor.getExtractedExpressions();
        this.extractedExpressions.push(...methodBodyExpressions);
        
        // Collect local variables from method bodies
        const methodLocalVariables = this.methodExtractor.getExtractedLocalVariables();
        this.extractedLocalVariables.push(...methodLocalVariables);
        
        // Collect blocks from method bodies
        const methodBlocks = this.methodExtractor.getExtractedBlocks();
        this.extractedBlocks.push(...methodBlocks);
        
        // Collect anonymous classes from method body expressions
        const methodBodyAnonymousClasses = this.methodExtractor.getExtractedAnonymousClasses();
        
        // Extract enum constants if this is an enum declaration
        if (node.type === 'enum_declaration') {
          const enumConstants = this.enumConstantExtractor.extractFromEnum(
            node,
            filePath,
            typeRegistry.getHash(),
            typeRegistry.getName(),
            typeRegistry.getQualifiedName(),
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports
          );
          this.extractedEnumConstants.push(...enumConstants);
          
          // Collect annotations from enum constants
          const enumConstantAnnotations = this.enumConstantExtractor.getExtractedAnnotations();
          this.extractedAnnotations.push(...enumConstantAnnotations);
          
          // Collect annotation arguments from enum constant annotations
          const enumConstantAnnotationArgs = this.enumConstantExtractor.getExtractedAnnotationArguments();
          this.extractedAnnotationArguments.push(...enumConstantAnnotationArgs);
          
          // Collect expressions from enum constant arguments
          const enumConstantExpressions = this.enumConstantExtractor.getExtractedExpressions();
          this.extractedExpressions.push(...enumConstantExpressions);
          
          // Collect type references from enum constant argument expressions
          const enumConstantTypeRefs = this.enumConstantExtractor.getExtractedTypeReferences();
          this.extractedTypeReferences.push(...enumConstantTypeRefs);
        }
        
        // Extract fields from the type body
        const bodyNode = this.findTypeBody(node);
        if (bodyNode) {
          const isInterface = node.type === 'interface_declaration';
          const fields = this.fieldExtractor.extractFromTypeBody(
            bodyNode,
            filePath,
            typeRegistry.getHash(),
            typeRegistry.getName(),
            typeRegistry.getQualifiedName(),
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            isInterface
          );
          this.extractedFields.push(...fields);
          
          // Collect annotations from fields
          const fieldAnnotations = this.fieldExtractor.getExtractedAnnotations();
          this.extractedAnnotations.push(...fieldAnnotations);
          
          // Collect annotation arguments from field annotations
          const fieldAnnotationArgs = this.fieldExtractor.getExtractedAnnotationArguments();
          this.extractedAnnotationArguments.push(...fieldAnnotationArgs);
          
          // Collect type references from field types
          const fieldTypeRefs = this.fieldExtractor.getExtractedTypeReferences();
          this.extractedTypeReferences.push(...fieldTypeRefs);
          
          // Collect expressions from field initializers
          const fieldExpressions = this.fieldExtractor.getExtractedExpressions();
          this.extractedExpressions.push(...fieldExpressions);
          
          // Collect local variables from lambda block bodies in field initializers
          const fieldLocalVariables = this.fieldExtractor.getExtractedLocalVariables();
          this.extractedLocalVariables.push(...fieldLocalVariables);
          
          // Collect blocks from lambda block bodies in field initializers
          const fieldBlocks = this.fieldExtractor.getExtractedBlocks();
          this.extractedBlocks.push(...fieldBlocks);

          // Process anonymous classes from field initializers, enum constant arguments, and method bodies
          // Use index-based loop to handle nested anonymous classes added during iteration
          const anonymousClasses = [
            ...this.fieldExtractor.getExtractedAnonymousClasses(),
            ...this.enumConstantExtractor.getExtractedAnonymousClasses(),
            ...methodBodyAnonymousClasses
          ];
          // Track processed anonymous class nodes by their position to prevent infinite loops
          const processedAnonPositions = new Set<string>();
          let anonIndex = 0;
          while (anonIndex < anonymousClasses.length) {
            const anonClass = anonymousClasses[anonIndex]!;
            anonIndex++;
            
            // Generate unique position key for this anonymous class node
            const posKey = `${anonClass.classBodyNode.startPosition.row}:${anonClass.classBodyNode.startPosition.column}:${anonClass.classBodyNode.endPosition.row}:${anonClass.classBodyNode.endPosition.column}`;
            if (processedAnonPositions.has(posKey)) {
              // Skip already processed anonymous class
              continue;
            }
            processedAnonPositions.add(posKey);
            
            const anonymousType = this.createAnonymousTypeRegistry(
              anonClass,
              filePath,
              basePath,
              fileName,
              serviceVersionHash,
              typeRegistry.getQualifiedName(),
              types.length // Use as index for naming
            );
            if (anonymousType) {
              types.push(anonymousType);
              
              // Extract type reference for the base type (extends/implements)
              // This links the anonymous type to what it extends/implements
              const typeRefExtractor = this.typeParameterExtractor.getTypeReferenceExtractor();
              const baseTypeRefs = typeRefExtractor.extractFromAnonymousClassBase(
                anonClass.creationNode,
                anonymousType.getHash(),
                packageName
              );
              this.extractedTypeReferences.push(...baseTypeRefs);
              
              // Extract methods from anonymous class body
              const anonMethods = this.methodExtractor.extractFromAnonymousClassBody(
                anonClass.classBodyNode,
                filePath,
                anonymousType.getHash(),
                anonymousType.getName(),
                anonymousType.getQualifiedName(),
                serviceVersionHash,
                packageName,
                importMap,
                hasStarImports
              );
              this.extractedMethods.push(...anonMethods);
              
              // Collect method parameters
              const anonMethodParams = this.methodExtractor.getExtractedMethodParameters();
              this.extractedMethodParameters.push(...anonMethodParams);
              
              // Collect method type parameters
              const anonMethodTypeParams = this.methodExtractor.getExtractedMethodTypeParameters();
              this.extractedMethodTypeParameters.push(...anonMethodTypeParams);
              
              // Collect annotations from methods
              const anonMethodAnnotations = this.methodExtractor.getExtractedAnnotations();
              this.extractedAnnotations.push(...anonMethodAnnotations);
              
              // Collect type references from methods
              const anonMethodTypeRefs = this.methodExtractor.getExtractedTypeReferences();
              this.extractedTypeReferences.push(...anonMethodTypeRefs);
              
              // Collect expressions from anonymous class method bodies
              const anonMethodExpressions = this.methodExtractor.getExtractedExpressions();
              this.extractedExpressions.push(...anonMethodExpressions);
              
              // Collect local variables from anonymous class method bodies
              const anonMethodLocalVariables = this.methodExtractor.getExtractedLocalVariables();
              this.extractedLocalVariables.push(...anonMethodLocalVariables);
              
              // Collect blocks from anonymous class method bodies
              const anonMethodBlocks = this.methodExtractor.getExtractedBlocks();
              this.extractedBlocks.push(...anonMethodBlocks);
              
              // Collect nested anonymous classes from anonymous class method bodies
              // These get added to the queue for processing in subsequent iterations
              const nestedAnonClasses = this.methodExtractor.getExtractedAnonymousClasses();
              anonymousClasses.push(...nestedAnonClasses);
              
              // Extract fields from anonymous class body
              const anonFields = this.fieldExtractor.extractFromAnonymousClassBody(
                anonClass.classBodyNode,
                filePath,
                anonymousType.getHash(),
                anonymousType.getName(),
                anonymousType.getQualifiedName(),
                serviceVersionHash,
                packageName,
                importMap,
                hasStarImports
              );
              this.extractedFields.push(...anonFields);
              
              // Collect field annotations
              const anonFieldAnnotations = this.fieldExtractor.getExtractedAnnotations();
              this.extractedAnnotations.push(...anonFieldAnnotations);
              
              // Collect field type references
              const anonFieldTypeRefs = this.fieldExtractor.getExtractedTypeReferences();
              this.extractedTypeReferences.push(...anonFieldTypeRefs);
              
              // Collect field expressions (initializers)
              const anonFieldExpressions = this.fieldExtractor.getExtractedExpressions();
              this.extractedExpressions.push(...anonFieldExpressions);
              
              // Collect local variables from lambda block bodies in anonymous class field initializers
              const anonFieldLocalVars = this.fieldExtractor.getExtractedLocalVariables();
              this.extractedLocalVariables.push(...anonFieldLocalVars);
              
              // Collect nested anonymous classes from anonymous class field initializers
              const nestedFieldAnonClasses = this.fieldExtractor.getExtractedAnonymousClasses();
              anonymousClasses.push(...nestedFieldAnonClasses);
            }
          }
        }
      }
    }

    for (const child of node.children) {
      this.extractTypes(child, filePath, basePath, fileName, serviceVersionHash, packageName, importMap, hasStarImports, types);
    }
  }

  /**
   * Extracts imports from the file and builds an import map
   * Returns map of simple type names to fully qualified names and whether star imports exist
   */
  private extractImports(rootNode: Parser.SyntaxNode): {
    importMap: Map<string, string>;
    hasStarImports: boolean;
  } {
    const importMap = new Map<string, string>();
    let hasStarImports = false;

    for (const child of rootNode.children) {
      if (child.type === 'import_declaration') {
        const importPath = this.extractImportPath(child);
        if (importPath) {
          // Check if star import
          if (importPath.endsWith('.*')) {
            hasStarImports = true;
          } else {
            // Extract simple name from qualified import
            // e.g., "org.keycloak.models.User" -> "User"
            const parts = importPath.split('.');
            const simpleName = parts[parts.length - 1];
            if (simpleName) {
              importMap.set(simpleName, importPath);
            }
          }
        }
      }
    }

    return { importMap, hasStarImports };
  }

  /**
   * Extracts the import path from an import_declaration node
   * Handles: import java.util.List; → "java.util.List"
   * Handles: import java.util.*; → "java.util.*"
   */
  private extractImportPath(importNode: Parser.SyntaxNode): string | null {
    // Build the full path from all relevant children
    let path = '';
    
    for (const child of importNode.children) {
      if (child.type === 'scoped_identifier') {
        // This is the package part (e.g., "java.util")
        path = child.text;
      } else if (child.type === 'identifier') {
        // This is the class name (e.g., "List")
        // Append to existing path
        if (path) {
          path += '.' + child.text;
        } else {
          path = child.text;
        }
      } else if (child.type === 'asterisk') {
        // Star import
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
   * Extracts package declaration from root node
   */
  private extractPackageDeclaration(rootNode: Parser.SyntaxNode): string | null {
    for (const child of rootNode.children) {
      if (child.type === 'package_declaration') {
        // Find scoped_identifier child
        for (const pkgChild of child.children) {
          if (pkgChild.type === 'scoped_identifier' || pkgChild.type === 'identifier') {
            return pkgChild.text;
          }
        }
      }
    }
    return null;
  }

  /**
   * Checks if a node is a type declaration
   */
  private isTypeDeclaration(node: Parser.SyntaxNode): boolean {
    return [
      'class_declaration',
      'interface_declaration',
      'enum_declaration',
      'annotation_type_declaration',
      'record_declaration',
    ].includes(node.type);
  }

  /**
   * Creates a TypeRegistry instance from a type declaration node
   */
  private createTypeRegistry(
    node: Parser.SyntaxNode,
    filePath: string,
    basePath: string,
    fileName: string,
    serviceVersionHash: string
  ): TypeRegistry | null {
    const name = this.extractTypeName(node);
    if (!name) return null;

    const qualifiedName = this.extractQualifiedName(node);
    const typeCategory = this.extractTypeCategory(node);
    const typeAccess = this.extractTypeAccess(node);
    const typePlacement = this.extractTypePlacement(node);
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const isExternal = false;

    const typeRegistry = new TypeRegistry(
      name,
      qualifiedName,
      fileName,
      typeCategory,
      typeAccess,
      typePlacement,
      filePath,
      basePath,
      startLine,
      endLine,
      isExternal,
      serviceVersionHash
    );

    const modifiers = this.extractModifiers(node);
    modifiers.forEach((modifier) => typeRegistry.addModifier(modifier));

    typeRegistry.generateHash();

    return typeRegistry;
  }

  /**
   * Creates a TypeRegistry instance for an anonymous class
   */
  private createAnonymousTypeRegistry(
    anonClass: AnonymousClassInfo,
    filePath: string,
    basePath: string,
    fileName: string,
    serviceVersionHash: string,
    enclosingQualifiedName: string,
    index: number
  ): TypeRegistry | null {
    // Generate anonymous class name like OuterClass$1, OuterClass$2, etc.
    const name = `${enclosingQualifiedName.split('.').pop() || 'Anonymous'}$${index + 1}`;
    const qualifiedName = `${enclosingQualifiedName}$${index + 1}`;
    
    const startLine = anonClass.creationNode.startPosition.row + 1;
    const endLine = anonClass.creationNode.endPosition.row + 1;

    const typeRegistry = new TypeRegistry(
      name,
      qualifiedName,
      fileName,
      TypeCategory.CLASS_TYPE,
      TypeAccess.PACKAGE_ACCESS, // Anonymous classes have no explicit access modifier
      TypePlacement.ANONYMOUS_PLACEMENT,
      filePath,
      basePath,
      startLine,
      endLine,
      false, // isExternal
      serviceVersionHash
    );

    // Use the pre-generated hash from the expression extractor for consistency
    typeRegistry.setHash(anonClass.anonymousTypeHash);

    return typeRegistry;
  }

  /**
   * Extracts the type name from a declaration node
   */
  private extractTypeName(node: Parser.SyntaxNode): string | null {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  }

  /**
   * Extracts the fully qualified name of a type
   */
  private extractQualifiedName(node: Parser.SyntaxNode): string {
    const packageName = this.extractPackageName(node);
    const typeName = this.extractTypeName(node) || 'Unknown';
    return packageName ? `${packageName}.${typeName}` : typeName;
  }

  /**
   * Extracts the package name from the file
   */
  private extractPackageName(node: Parser.SyntaxNode): string | null {
    // Traverse to the root node
    let current = node;
    while (current.parent) {
      current = current.parent;
    }

    // Look for package_declaration in root's children
    for (const child of current.children) {
      if (child.type === 'package_declaration') {
        // Try field name first (some versions use this)
        const packageNode = child.childForFieldName('name');
        if (packageNode) {
          return packageNode.text;
        }
        
        // Otherwise, look for scoped_identifier or identifier child
        for (const pkgChild of child.children) {
          if (pkgChild.type === 'scoped_identifier' || pkgChild.type === 'identifier') {
            return pkgChild.text;
          }
        }
      }
    }

    return null;
  }

  /**
   * Determines the type category based on node type
   */
  private extractTypeCategory(node: Parser.SyntaxNode): TypeCategory {
    switch (node.type) {
      case 'class_declaration':
        return TypeCategory.CLASS_TYPE;
      case 'interface_declaration':
        return TypeCategory.INTERFACE_TYPE;
      case 'enum_declaration':
        return TypeCategory.ENUM_TYPE;
      case 'annotation_type_declaration':
        // Check if the annotation declaration contains @interface syntax
        if (node.text.includes('@interface')) {
          return TypeCategory.ANNOTATION_INTERFACE_TYPE;
        }
        return TypeCategory.ANNOTATION_TYPE;
      case 'record_declaration':
        return TypeCategory.RECORD_TYPE;
      default:
        return TypeCategory.CLASS_TYPE;
    }
  }

  /**
   * Extracts the access modifier (public, private, etc.)
   */
  private extractTypeAccess(node: Parser.SyntaxNode): TypeAccess {
    const modifiers = this.extractModifierTexts(node);
    
    if (modifiers.includes('public')) return TypeAccess.PUBLIC_ACCESS;
    if (modifiers.includes('private')) return TypeAccess.PRIVATE_ACCESS;
    if (modifiers.includes('protected')) return TypeAccess.PROTECTED_ACCESS;
    
    return TypeAccess.PACKAGE_ACCESS;
  }

  /**
   * Extracts modifier text values from a node
   */
  private extractModifierTexts(node: Parser.SyntaxNode): string[] {
    const modifierTexts: string[] = [];
    
    for (const child of node.children) {
      if (child.type === 'modifiers') {
        for (const mod of child.children) {
          if (mod.type === 'marker_annotation' || mod.type === 'annotation') continue;
          modifierTexts.push(mod.text);
        }
      }
    }
    
    return modifierTexts;
  }

  /**
   * Extracts type modifiers (abstract, final, static, etc.)
   */
  private extractModifiers(node: Parser.SyntaxNode): TypeModifier[] {
    const modifiers: TypeModifier[] = [];
    const modifierTexts = this.extractModifierTexts(node);

    for (const modText of modifierTexts) {
      switch (modText) {
        case 'abstract':
          modifiers.push(TypeModifier.ABSTRACT_MODIFIER);
          break;
        case 'final':
          modifiers.push(TypeModifier.FINAL_MODIFIER);
          break;
        case 'static':
          modifiers.push(TypeModifier.STATIC_MODIFIER);
          break;
        case 'strictfp':
          modifiers.push(TypeModifier.STRICTFP_MODIFIER);
          break;
        case 'sealed':
          modifiers.push(TypeModifier.SEALED_MODIFIER);
          break;
        case 'non-sealed':
          modifiers.push(TypeModifier.NON_SEALED_MODIFIER);
          break;
        case 'deprecated':
          modifiers.push(TypeModifier.DEPRECATED_MODIFIER);
          break;
      }
    }

    return modifiers;
  }

  /**
   * Determines type placement (top-level, nested, etc.)
   */
  private extractTypePlacement(node: Parser.SyntaxNode): TypePlacement {
    let parent = node.parent;
    while (parent) {
      if (this.isTypeDeclaration(parent)) {
        const modifierTexts = this.extractModifierTexts(node);
        // Explicit static modifier
        if (modifierTexts.includes('static')) {
          return TypePlacement.STATIC_NESTED_PLACEMENT;
        }
        // Records, interfaces, and enums are implicitly static when nested
        if (node.type === 'record_declaration' || 
            node.type === 'interface_declaration' || 
            node.type === 'enum_declaration') {
          return TypePlacement.STATIC_NESTED_PLACEMENT;
        }
        return TypePlacement.INNER_PLACEMENT;
      }
      parent = parent.parent;
    }
    return TypePlacement.TOP_LEVEL_PLACEMENT;
  }

  /**
   * Extracts the base path (project root) from file path
   */
  private extractBasePath(filePath: string): string {
    const srcIndex = filePath.indexOf('/src/');
    if (srcIndex !== -1) {
      return filePath.substring(0, srcIndex);
    }
    return path.dirname(filePath);
  }

  /**
   * Finds the body node for a type declaration
   */
  /**
   * Builds a map of "startLine:startColumn" → entity hash from all extracted entities.
   * Used by the CommentExtractor to associate comments with their nearest entity.
   */
  private buildPositionToHashMap(types: TypeRegistry[]): Map<string, string> {
    const map = new Map<string, string>();

    // Types
    for (const t of types) {
      map.set(`${t.getStartLine()}:0`, t.getHash());
    }

    // Methods
    for (const m of this.extractedMethods) {
      map.set(`${m.getStartLine()}:0`, m.getHash());
    }

    // Fields
    for (const f of this.extractedFields) {
      map.set(`${f.getStartLine()}:0`, f.getHash());
    }

    // Local variables
    for (const lv of this.extractedLocalVariables) {
      map.set(`${lv.getStartLine()}:0`, lv.getHash());
    }

    // Annotations
    for (const a of this.extractedAnnotations) {
      const line = a.getStartLine();
      if (line !== undefined) {
        map.set(`${line}:0`, a.getHash());
      }
    }

    // Expressions (ROOT only — expression statements)
    for (const e of this.extractedExpressions) {
      if (e.getEdgeRole().toString() === 'ROOT') {
        const startLine = e.getStartLine();
        const startCol = e.getStartColumn();
        if (startLine !== undefined && startCol !== undefined) {
          map.set(`${startLine}:${startCol}`, e.getHash());
        }
      }
    }

    return map;
  }

  private findTypeBody(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
    const bodyTypes = ['class_body', 'interface_body', 'enum_body', 'annotation_type_body', 'record_body'];
    for (const child of node.children) {
      if (bodyTypes.includes(child.type)) {
        return child;
      }
    }
    return undefined;
  }

}
