import Parser from 'tree-sitter';

import { MethodParameter } from '@/analysis-methods/java/MethodParameter';
import { MethodRegistry } from '@/analysis-methods/java/MethodRegistry';
import { MethodTypeParameter } from '@/analysis-methods/java/MethodTypeParameter';
import { AnnotationArgumentReference } from '@/analysis-types/java/AnnotationArgumentReference';
import { ExpressionReference } from '@/analysis-types/java/ExpressionReference';
import { TypeAnnotation } from '@/analysis-types/java/TypeAnnotation';
import { TypeReference } from '@/analysis-types/java/TypeReference';
import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { MethodAccess, MethodKind, MethodModifier } from '@/enums/java/methods';
import { EdgeRole, ExpressionKind, ExpressionOwnerKind, RootContext } from '@/enums/java/expressions';
import { AnnotationExtractor } from '@/parsers/java/extractors/annotation-extractor';
import { ExpressionReferenceExtractor, AnonymousClassInfo } from '@/parsers/java/extractors/expression-reference-extractor';
import { MethodParameterExtractor } from '@/parsers/java/extractors/method-parameter-extractor';
import { MethodTypeParameterExtractor } from '@/parsers/java/extractors/method-type-parameter-extractor';
import { TypeReferenceExtractor } from '@/parsers/java/extractors/type-reference-extractor';
import { LocalVariableExtractor } from '@/parsers/java/extractors/local-variable-extractor';
import { LocalVariableRegistry } from '@/analysis-types/java/LocalVariableRegistry';
import { BlockRegistry } from '@/analysis-types/java/BlockRegistry';
import { LocalVariableScopeKind } from '@/enums/java/local-variables';
import { BlockKind } from '@/enums/java/blocks';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Information about a statement found inside a method body, including
 * its containing lambda and block (if any) for proper ownership tracking.
 */
interface StatementWithContext {
  node: Parser.SyntaxNode;
  /** Position key of the containing lambda expression (startLine:startCol:endLine:endCol), or null if directly in method body */
  containingLambdaPosition: string | null;
  /** Hash of the innermost containing block (try/catch/for/etc), or null if not in any */
  containingBlockHash: string | null;
  /** Lambda parameter names in scope for this statement */
  lambdaParamNames: Set<string>;
}

/**
 * Extracts MethodRegistry entities from Java type bodies using tree-sitter
 * 
 * Handles extraction of:
 * - Regular methods (instance and static)
 * - Abstract methods
 * - Constructors (regular and compact)
 * - Default interface methods
 * - Static and instance initializers
 * - Annotation elements
 * 
 * ## Signature Generation
 * 
 * Two types of signatures are generated:
 * 
 * **signature** (canonical):
 * - Generics stripped: `List` not `List<User>`
 * - Varargs normalized: `String[]` not `String...`
 * - No parameter names: `method(String,int):void`
 * - Used for method identity and overload resolution
 * 
 * **detailedSignature** (display):
 * - Full generics preserved: `List<User>`
 * - Varargs preserved: `String...`
 * - Parameter names included: `method(String name, int age):void`
 * - Used for display and exact source matching
 */
export class TypeMethodExtractor {
  private methodParameterExtractor: MethodParameterExtractor;
  private methodTypeParameterExtractor: MethodTypeParameterExtractor;
  private annotationExtractor: AnnotationExtractor;
  private typeReferenceExtractor: TypeReferenceExtractor;
  private expressionExtractor: ExpressionReferenceExtractor;
  private localVariableExtractor: LocalVariableExtractor;
  private extractedMethodParameters: MethodParameter[] = [];
  private extractedMethodTypeParameters: MethodTypeParameter[] = [];
  private extractedTypeReferences: TypeReference[] = [];
  private extractedAnnotations: TypeAnnotation[] = [];
  private extractedAnnotationArguments: AnnotationArgumentReference[] = [];
  private extractedExpressions: ExpressionReference[] = [];
  private extractedAnonymousClasses: AnonymousClassInfo[] = [];
  private extractedLocalVariables: LocalVariableRegistry[] = [];
  private extractedBlocks: BlockRegistry[] = [];

  constructor() {
    this.methodParameterExtractor = new MethodParameterExtractor();
    this.methodTypeParameterExtractor = new MethodTypeParameterExtractor();
    this.annotationExtractor = new AnnotationExtractor();
    this.typeReferenceExtractor = new TypeReferenceExtractor();
    this.expressionExtractor = new ExpressionReferenceExtractor();
    this.localVariableExtractor = new LocalVariableExtractor();
  }

  /**
   * Returns all method parameters extracted during the last extraction
   */
  getExtractedMethodParameters(): MethodParameter[] {
    return this.extractedMethodParameters;
  }

  /**
   * Returns all method type parameters extracted during the last extraction
   */
  getExtractedMethodTypeParameters(): MethodTypeParameter[] {
    return this.extractedMethodTypeParameters;
  }

  /**
   * Returns all annotations extracted during the last extraction
   */
  getExtractedAnnotations(): TypeAnnotation[] {
    return this.extractedAnnotations;
  }

  /**
   * Returns all type references extracted from method parameters
   */
  getExtractedTypeReferences(): TypeReference[] {
    return this.extractedTypeReferences;
  }

  /**
   * Returns all annotation arguments extracted during the last extraction
   */
  getExtractedAnnotationArguments(): AnnotationArgumentReference[] {
    return this.extractedAnnotationArguments;
  }

  /**
   * Returns all expressions extracted from method bodies during the last extraction
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
   * Returns all local variables extracted from method bodies during the last extraction
   */
  getExtractedLocalVariables(): LocalVariableRegistry[] {
    return this.extractedLocalVariables;
  }

  /**
   * Returns all blocks extracted from method bodies during the last extraction
   */
  getExtractedBlocks(): BlockRegistry[] {
    return this.extractedBlocks;
  }

  /**
   * Helper to collect type references and anonymous classes after expression extraction.
   * Consolidates the repeated pattern of getting and pushing these collections.
   */
  private collectExpressionExtractorResults(): void {
    const typeRefs = this.expressionExtractor.getExtractedTypeReferences();
    this.extractedTypeReferences.push(...typeRefs);
    
    const anonymousClasses = this.expressionExtractor.getExtractedAnonymousClasses();
    this.extractedAnonymousClasses.push(...anonymousClasses);
  }

  /**
   * Extracts methods from a type body
   * @param typeNode The type declaration node (class_declaration, interface_declaration, etc.)
   * @param typeRegistryHash The hash of the owning type
   * @param serviceVersionHash The hash of the service version
   * @param packageName Package name for import resolution
   * @param importMap Map of simple type names to fully qualified names from imports
   * @param hasStarImports Whether file contains star imports
   */
  extractFromType(
    typeNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean
  ): MethodRegistry[] {
    // Extract class-level type parameters
    const classTypeParams = this.extractClassTypeParameters(typeNode);
    const methods: MethodRegistry[] = [];
    this.extractedMethodParameters = []; // Reset for each type
    this.extractedMethodTypeParameters = []; // Reset for each type
    this.extractedTypeReferences = []; // Reset for each type
    this.extractedAnnotations = []; // Reset for each type
    this.extractedAnnotationArguments = []; // Reset for each type
    this.extractedExpressions = []; // Reset for each type
    this.extractedAnonymousClasses = []; // Reset for each type
    this.extractedLocalVariables = []; // Reset for each type
    this.extractedBlocks = []; // Reset for each type

    // For records, create a canonical constructor from record components
    if (typeNode.type === 'record_declaration') {
      this.processRecordCanonicalConstructor(
        typeNode,
        filePath,
        typeRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        classTypeParams,
        methods
      );
    }

    const bodyNode = this.findTypeBody(typeNode);
    if (!bodyNode) return methods;

    // Process all method declarations in the type body
    this.extractMethodsFromBody(
      bodyNode,
      filePath,
      typeRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      serviceVersionHash,
      packageName,
      importMap,
      hasStarImports,
      classTypeParams,
      methods
    );

    // Synthesised after the body scan, so the type's own declarations are already in `methods`
    // and can suppress the implicit member javac would not declare either.
    if (typeNode.type === 'record_declaration') {
      this.synthesizeRecordImplicitMembers(
        typeNode,
        filePath,
        typeRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        serviceVersionHash,
        methods
      );
    } else if (typeNode.type === 'enum_declaration') {
      this.synthesizeEnumImplicitMembers(
        typeNode,
        filePath,
        typeRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        serviceVersionHash,
        methods
      );
    } else if (typeNode.type === 'class_declaration') {
      this.synthesizeDefaultConstructor(
        typeNode,
        filePath,
        typeRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        serviceVersionHash,
        methods
      );
    }

    return methods;
  }

  /**
   * Extracts methods from an anonymous class body.
   * Used when the class_body node is already available (e.g., from field initializers).
   */
  extractFromAnonymousClassBody(
    classBodyNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean
  ): MethodRegistry[] {
    const methods: MethodRegistry[] = [];
    this.extractedMethodParameters = [];
    this.extractedMethodTypeParameters = [];
    this.extractedTypeReferences = [];
    this.extractedAnnotations = [];
    this.extractedAnnotationArguments = [];
    this.extractedExpressions = [];
    this.extractedAnonymousClasses = [];
    this.extractedLocalVariables = [];
    this.extractedBlocks = [];

    // Anonymous classes don't have their own type parameters
    const classTypeParams = new Set<string>();

    this.extractMethodsFromBody(
      classBodyNode,
      filePath,
      typeRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      serviceVersionHash,
      packageName,
      importMap,
      hasStarImports,
      classTypeParams,
      methods
    );

    return methods;
  }

  /**
   * Recursively extracts methods from a class/interface/enum body
   */
  private extractMethodsFromBody(
    bodyNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    classTypeParams: Set<string>,
    methods: MethodRegistry[],
    isInEnumConstantBody: boolean = false,
    enclosingMemberLinkHash?: string
  ): void {
    for (const child of bodyNode.children) {
      if (this.isMethodDeclaration(child)) {
        this.processMethodDeclaration(
          child,
          filePath,
          typeRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          classTypeParams,
          methods,
          isInEnumConstantBody,
          enclosingMemberLinkHash
        );
      } else if (this.isInitializerBlock(child)) {
        const method = this.createInitializerMethod(
          child,
          filePath,
          typeRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          serviceVersionHash
        );
        if (method) {
          methods.push(method);
          
          // Extract expressions from initializer block body
          const initializerExpressions = this.extractInitializerBlockExpressions(
            child,
            typeRegistryHash,
            method.getHash(),
            packageName,
            importMap,
            hasStarImports,
            filePath
          );
          this.extractedExpressions.push(...initializerExpressions);
          
          // Extract local variables from initializer block
          // For static_initializer, the block is a child; for instance initializer, the node IS the block
          const bodyBlock = child.type === 'static_initializer'
            ? child.children.find(c => c.type === 'block')
            : child;
          
          if (bodyBlock) {
            const isStatic = child.type === 'static_initializer';
            const localVariables = isStatic
              ? this.localVariableExtractor.extractFromStaticInitializer(
                  bodyBlock,
                  filePath,
                  typeRegistryHash,
                  method.getHash(),
                  ownerTypeName,
                  ownerQualifiedName,
                  serviceVersionHash,
                  packageName,
                  importMap,
                  hasStarImports
                )
              : this.localVariableExtractor.extractFromInstanceInitializer(
                  bodyBlock,
                  filePath,
                  typeRegistryHash,
                  method.getHash(),
                  ownerTypeName,
                  ownerQualifiedName,
                  serviceVersionHash,
                  packageName,
                  importMap,
                  hasStarImports
                );
            this.extractedLocalVariables.push(...localVariables);
            
            // Collect expressions from local variable initializers
            const localVarExpressions = this.localVariableExtractor.getExtractedExpressions();
            this.extractedExpressions.push(...localVarExpressions);
            
            // Collect type references from local variable types
            const localVarTypeRefs = this.localVariableExtractor.getExtractedTypeReferences();
            this.extractedTypeReferences.push(...localVarTypeRefs);
            
            // Collect anonymous classes from local variable initializers
            const localVarAnonClasses = this.localVariableExtractor.getExtractedAnonymousClasses();
            this.extractedAnonymousClasses.push(...localVarAnonClasses);
            
            // Collect annotations from local variable declarations
            const localVarAnnotations = this.localVariableExtractor.getExtractedAnnotations();
            this.extractedAnnotations.push(...localVarAnnotations);
            
            // Collect annotation arguments from local variable declarations
            const localVarAnnotationArgs = this.localVariableExtractor.getExtractedAnnotationArguments();
            this.extractedAnnotationArguments.push(...localVarAnnotationArgs);
            
            // Collect blocks from initializer (try/catch/for/if etc inside static{} or {})
            const initializerBlocks = this.localVariableExtractor.getExtractedBlocks();
            this.extractedBlocks.push(...initializerBlocks);
          }
        }
      } else if (child.type === 'enum_body_declarations') {
        // Enum methods are nested inside enum_body_declarations
        this.extractMethodsFromBody(
          child,
          filePath,
          typeRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          classTypeParams,
          methods
        );
      } else if (child.type === 'enum_constant') {
        // Check for anonymous class methods in enum constants
        // Generate enum constant hash for linking
        const constantHash = this.generateEnumConstantHash(child, filePath, typeRegistryHash);
        
        for (const constantChild of child.children) {
          if (constantChild.type === 'class_body') {
            // Extract methods from the anonymous class body (mark as enum constant methods)
            this.extractMethodsFromBody(
              constantChild,
              filePath,
              typeRegistryHash,
              ownerTypeName,
              ownerQualifiedName,
              serviceVersionHash,
              packageName,
              importMap,
              hasStarImports,
              classTypeParams,
              methods,
              true, // isInEnumConstantBody = true
              constantHash // Pass enum constant hash
            );
          }
        }
      }
    }
  }

  /**
   * Processes a single method declaration and extracts its metadata
   */
  private processMethodDeclaration(
    methodNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    classTypeParams: Set<string>,
    methods: MethodRegistry[],
    isInEnumConstantBody: boolean = false,
    enclosingMemberLinkHash?: string
  ): void {
    const method = this.createMethodRegistry(
      methodNode,
      filePath,
      typeRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      serviceVersionHash,
      isInEnumConstantBody,
      enclosingMemberLinkHash
    );
    if (method) {
      methods.push(method);
      
      // Extract method annotations
      this.annotationExtractor.resetExtractedArguments();
      const methodAnnotations = this.annotationExtractor.extractFromMethodDeclaration(
        methodNode,
        method.getHash(),
        typeRegistryHash
      );
      this.extractedAnnotations.push(...methodAnnotations);
      
      // Collect annotation arguments from method annotations
      const methodAnnotationArgs = this.annotationExtractor.getExtractedArguments();
      this.extractedAnnotationArguments.push(...methodAnnotationArgs);
      
      // Collect type references from method annotation arguments
      const methodAnnotationTypeRefs = this.annotationExtractor.getExtractedTypeReferences();
      this.extractedTypeReferences.push(...methodAnnotationTypeRefs);
      
      // Extract method-level type parameters and combine with class-level
      const methodTypeParams = this.extractMethodTypeParameters(methodNode);
      const allTypeParams = new Set([...classTypeParams, ...methodTypeParams]);

      // Extract MethodTypeParameter entities with bounds
      const methodTypeParameters = this.methodTypeParameterExtractor.extractFromMethod(
        methodNode,
        method.getHash(),
        method.getName(),
        method.getSignature(),
        method.getQualifiedName(),
        filePath,
        method.getStartLine(),
        typeRegistryHash,
        packageName,
        classTypeParams
      );
      this.extractedMethodTypeParameters.push(...methodTypeParameters);
      
      // Collect annotations from method type parameters
      const methodTypeParamAnnotations = this.methodTypeParameterExtractor.getExtractedAnnotations();
      this.extractedAnnotations.push(...methodTypeParamAnnotations);
      
      // Collect annotation arguments from method type parameter annotations (including bound annotations)
      const methodTypeParamAnnotationArgs = this.methodTypeParameterExtractor.getAnnotationExtractor().getExtractedArguments();
      this.extractedAnnotationArguments.push(...methodTypeParamAnnotationArgs);
      
      // Collect type references from method type parameter bounds and annotation arguments
      const methodTypeParamBounds = this.methodTypeParameterExtractor.getExtractedTypeReferences();
      this.extractedTypeReferences.push(...methodTypeParamBounds);
      
      // Collect type references from method type parameter annotation arguments
      const methodTypeParamAnnotationTypeRefs = this.methodTypeParameterExtractor.getAnnotationExtractor().getExtractedTypeReferences();
      this.extractedTypeReferences.push(...methodTypeParamAnnotationTypeRefs);

      // Extract parameters for this method
      const parameters = this.methodParameterExtractor.extractFromMethod(
        methodNode,
        method.getHash(),
        typeRegistryHash,
        packageName,
        importMap,
        hasStarImports,
        allTypeParams,
        this.annotationExtractor
      );
      this.extractedMethodParameters.push(...parameters);
      
      // Collect annotations from parameters
      const paramAnnotations = this.methodParameterExtractor.getExtractedAnnotations();
      this.extractedAnnotations.push(...paramAnnotations);
      
      // Collect annotation arguments from parameter annotations
      const paramAnnotationArgs = this.methodParameterExtractor.getExtractedAnnotationArguments();
      this.extractedAnnotationArguments.push(...paramAnnotationArgs);
      
      // Collect type references from parameters
      const paramTypeRefs = this.methodParameterExtractor.getExtractedTypeReferences();
      this.extractedTypeReferences.push(...paramTypeRefs);
      
      // Extract return type references for non-constructor methods
      const returnTypeRefs = this.extractReturnTypeReferences(
        methodNode,
        method.getHash(),
        typeRegistryHash,
        packageName,
        allTypeParams
      );
      this.extractedTypeReferences.push(...returnTypeRefs);
      
      // Extract throws clause type references
      const throwsClauseRefs = this.typeReferenceExtractor.extractFromThrowsClause(
        methodNode,
        typeRegistryHash,
        method.getHash(),
        packageName,
        allTypeParams
      );
      this.extractedTypeReferences.push(...throwsClauseRefs);
      
      // Extract TYPE_USE annotations from throws clause exception types (e.g., throws @Critical IOException)
      // Pass the TypeReference hashes so annotations link to them instead of the method
      const throwsTypeRefHashes = throwsClauseRefs
        .filter(ref => ref.getDepth() === 0) // Only top-level exception types
        .map(ref => ref.getHash());
      const throwsAnnotations = this.annotationExtractor.extractFromThrowsClause(
        methodNode,
        throwsTypeRefHashes,
        typeRegistryHash
      );
      this.extractedAnnotations.push(...throwsAnnotations);
      
      // Build position-to-hash map from AST for block ownership lookups in expression extraction.
      // This lightweight traversal replaces duplicated BlockRegistry.computeHash() calls in
      // findExpressionStatements, findThrowStatements, and findReturnStatementsAtLevel.
      // Find the method body block for map building
      const methodBodyBlock = methodNode.children.find(child =>
        child.type === 'block' || child.type === 'constructor_body'
      );
      const blockPositionToHash = methodBodyBlock
        ? this.buildBlockPositionMapFromAST(methodBodyBlock, typeRegistryHash, method.getHash(), filePath)
        : undefined;

      // Extract expressions from method body (return statements, throw statements, expression statements)
      const bodyExpressions = this.extractMethodBodyExpressions(
        methodNode,
        typeRegistryHash,
        method.getHash(),
        packageName,
        importMap,
        hasStarImports,
        filePath,
        blockPositionToHash
      );
      this.extractedExpressions.push(...bodyExpressions);
      // Note: Type references and anonymous classes are collected inside extractMethodBodyExpressions
      // for each expression statement and constructor invocation, so we don't collect them here again.

      // Extract local variables from method body
      const localVariables = this.extractMethodBodyLocalVariables(
        methodNode,
        filePath,
        typeRegistryHash,
        method.getHash(),
        ownerTypeName,
        ownerQualifiedName,
        method.getName(),
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports
      );
      this.extractedLocalVariables.push(...localVariables);

      // Collect blocks created by LocalVariableExtractor during extractFromMethodBody
      // Only collect if the method had a body (extractFromMethodBody was actually called),
      // otherwise getExtractedBlocks() returns stale blocks from a previous method
      const bodyBlock = methodNode.children.find(child =>
        child.type === 'block' || child.type === 'constructor_body'
      );
      if (bodyBlock) {
        const localVarBlocks = this.localVariableExtractor.getExtractedBlocks();
        this.extractedBlocks.push(...localVarBlocks);
      }
    }
  }
  
  /**
   * Extracts expressions from a method body.
   * Currently extracts return statement expressions.
   */
  private extractMethodBodyExpressions(
    methodNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    methodHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    filePath: string,
    blockPositionToHash?: Map<string, string>
  ): ExpressionReference[] {
    const expressions: ExpressionReference[] = [];
    
    // Find the method body (block or constructor_body)
    const bodyBlock = methodNode.children.find(child => 
      child.type === 'block' || child.type === 'constructor_body'
    );
    if (!bodyBlock) {
      return expressions; // Abstract methods, interface methods without body
    }
    
    // Extract method parameter names for PARAMETER classification
    const methodParamNames = this.extractMethodParameterNames(methodNode);
    
    // Collect local variable names from the method body for LOCAL_VARIABLE classification
    const localVariableNames = this.collectLocalVariableNames(bodyBlock);

    // A pattern binding is declared in one statement and used in another, so the extractor is
    // told the whole body's bindings once rather than per statement.
    this.expressionExtractor.setMethodPatternBindingNames(this.collectPatternBindingNames(bodyBlock));
    
    // IMPORTANT: Extract expression statements FIRST to get actual lambda hashes,
    // then use those hashes when processing return statements inside those lambdas.
    // This ensures return statements inside expression_statement lambdas have the correct owner hash.
    
    // Find all expression statements in the method body (with containing lambda and block tracking)
    const expressionStatements = this.findExpressionStatements(bodyBlock, typeRegistryHash, methodHash, filePath, blockPositionToHash);
    
    // Build a map of lambda position -> actual expressionUniqueHash
    // This will be populated as we extract expression statements containing lambdas
    const lambdaPositionToHash = new Map<string, string>();
    
    // Two-pass extraction for expression statements:
    // Pass 1: Extract statements NOT inside lambdas (to collect lambda hashes)
    // Pass 2: Extract statements inside lambdas (using resolved actual hashes)
    
    const statementsNotInLambda = expressionStatements.filter(s => !s.containingLambdaPosition);
    const statementsInLambda = expressionStatements.filter(s => s.containingLambdaPosition);
    
    // Pass 1: Extract statements not inside lambdas
    for (const exprStmtCtx of statementsNotInLambda) {
      const ownerHash = exprStmtCtx.containingBlockHash || methodHash;
      const exprStmtExpressions = this.expressionExtractor.extractFromExpressionStatement(
        exprStmtCtx.node,
        typeRegistryHash,
        ownerHash,
        packageName,
        importMap,
        hasStarImports,
        methodParamNames,
        localVariableNames,
        exprStmtCtx.lambdaParamNames
      );
      expressions.push(...exprStmtExpressions);
      this.collectExpressionExtractorResults();
      
      // Collect lambda hashes for position-based lookup
      for (const expr of exprStmtExpressions) {
        if (expr.getKind().toString() === 'LAMBDA_EXPRESSION') {
          const startLine = expr.getStartLine();
          const startCol = expr.getStartColumn();
          const endLine = expr.getEndLine();
          const endCol = expr.getEndColumn();
          if (startLine !== undefined && startCol !== undefined && 
              endLine !== undefined && endCol !== undefined) {
            const posKey = `${startLine}:${startCol}:${endLine}:${endCol}`;
            lambdaPositionToHash.set(posKey, expr.getHash());
          }
        }
      }
    }
    
    // Pass 2: Extract statements inside lambdas (resolve actual hash from position)
    for (const exprStmtCtx of statementsInLambda) {
      // Resolve actual lambda hash from position key
      const actualLambdaHash = exprStmtCtx.containingLambdaPosition 
        ? lambdaPositionToHash.get(exprStmtCtx.containingLambdaPosition) 
        : null;
      const ownerHash = exprStmtCtx.containingBlockHash || actualLambdaHash || methodHash;
      const exprStmtExpressions = this.expressionExtractor.extractFromExpressionStatement(
        exprStmtCtx.node,
        typeRegistryHash,
        ownerHash,
        packageName,
        importMap,
        hasStarImports,
        methodParamNames,
        localVariableNames,
        exprStmtCtx.lambdaParamNames
      );
      expressions.push(...exprStmtExpressions);
      this.collectExpressionExtractorResults();
      
      // Collect any nested lambda hashes
      for (const expr of exprStmtExpressions) {
        if (expr.getKind().toString() === 'LAMBDA_EXPRESSION') {
          const startLine = expr.getStartLine();
          const startCol = expr.getStartColumn();
          const endLine = expr.getEndLine();
          const endCol = expr.getEndColumn();
          if (startLine !== undefined && startCol !== undefined && 
              endLine !== undefined && endCol !== undefined) {
            const posKey = `${startLine}:${startCol}:${endLine}:${endCol}`;
            lambdaPositionToHash.set(posKey, expr.getHash());
          }
        }
      }
    }
    
    // Extract return statements iteratively to handle nested lambdas correctly.
    // We must extract returns wave by wave because lambdas inside return statements
    // need to be extracted FIRST before we can get their actual hash for nested returns.
    let returnIndex = 0;
    const processedLambdaPositions = new Set<string>();
    
    // Helper to collect lambda hashes from extracted expressions
    const collectLambdaHashes = (exprs: ExpressionReference[]): void => {
      for (const expr of exprs) {
        if (expr.getKind() === ExpressionKind.LAMBDA_EXPRESSION) {
          const sl = expr.getStartLine();
          const sc = expr.getStartColumn();
          const el = expr.getEndLine();
          const ec = expr.getEndColumn();
          if (sl !== undefined && sc !== undefined && el !== undefined && ec !== undefined) {
            const posKey = `${sl}:${sc}:${el}:${ec}`;
            lambdaPositionToHash.set(posKey, expr.getHash());
          }
        }
      }
    };
    
    // Wave 1: Extract returns at method level (not inside lambdas)
    const topLevelReturns = this.findReturnStatementsAtLevel(bodyBlock, typeRegistryHash, methodHash, filePath, null, new Set(), blockPositionToHash);
    for (const returnStmtCtx of topLevelReturns) {
      const ownerHash = returnStmtCtx.containingBlockHash || methodHash;
      const returnExpressions = this.expressionExtractor.extractFromReturnStatement(
        returnStmtCtx.node,
        typeRegistryHash,
        ownerHash,
        packageName,
        importMap,
        hasStarImports,
        methodParamNames,
        returnIndex++,
        localVariableNames
      );
      expressions.push(...returnExpressions);
      this.collectExpressionExtractorResults();
      collectLambdaHashes(returnExpressions);
    }
    
    // Wave 2+: Process returns inside lambdas iteratively
    let hasNewLambdas = true;
    while (hasNewLambdas) {
      hasNewLambdas = false;
      const lambdasToProcess: Array<{posKey: string, hash: string}> = [];
      
      for (const [posKey, hash] of lambdaPositionToHash.entries()) {
        if (!processedLambdaPositions.has(posKey)) {
          lambdasToProcess.push({posKey, hash});
          processedLambdaPositions.add(posKey);
        }
      }
      
      if (lambdasToProcess.length === 0) break;
      
      for (const {posKey, hash: lambdaHash} of lambdasToProcess) {
        const [startLine, startCol, endLine, endCol] = posKey.split(':').map(Number);
        const lambdaNode = this.findLambdaNodeByPosition(bodyBlock, startLine!, startCol!, endLine!, endCol!);
        if (!lambdaNode) continue;
        
        const lambdaBody = lambdaNode.children.find((c: Parser.SyntaxNode) => c.type === 'block');
        if (!lambdaBody) continue;
        
        const lambdaReturns = this.findReturnStatementsAtLevel(lambdaBody, typeRegistryHash, methodHash, filePath, lambdaHash, new Set(), blockPositionToHash);
        for (const returnStmtCtx of lambdaReturns) {
          const ownerHash = returnStmtCtx.containingBlockHash || lambdaHash;
          const returnExpressions = this.expressionExtractor.extractFromReturnStatement(
            returnStmtCtx.node,
            typeRegistryHash,
            ownerHash,
            packageName,
            importMap,
            hasStarImports,
            methodParamNames,
            returnIndex++,
            localVariableNames
          );
          expressions.push(...returnExpressions);
          this.collectExpressionExtractorResults();
          
          // Check for new lambdas
          for (const expr of returnExpressions) {
            if (expr.getKind() === ExpressionKind.LAMBDA_EXPRESSION) {
              const sl = expr.getStartLine();
              const sc = expr.getStartColumn();
              const el = expr.getEndLine();
              const ec = expr.getEndColumn();
              if (sl !== undefined && sc !== undefined && el !== undefined && ec !== undefined) {
                const newPosKey = `${sl}:${sc}:${el}:${ec}`;
                if (!lambdaPositionToHash.has(newPosKey)) {
                  lambdaPositionToHash.set(newPosKey, expr.getHash());
                  hasNewLambdas = true;
                }
              }
            }
          }
        }
      }
    }
    
    // Find all throw statements in the method body (with containing lambda and block tracking)
    const throwStatements = this.findThrowStatements(bodyBlock, typeRegistryHash, methodHash, filePath, blockPositionToHash);
    
    for (let throwIndex = 0; throwIndex < throwStatements.length; throwIndex++) {
      const throwStmtCtx = throwStatements[throwIndex]!;
      // Owner hierarchy: block > lambda > method
      // Resolve actual lambda hash from position key
      const actualLambdaHash = throwStmtCtx.containingLambdaPosition 
        ? lambdaPositionToHash.get(throwStmtCtx.containingLambdaPosition) 
        : null;
      const ownerHash = throwStmtCtx.containingBlockHash || actualLambdaHash || methodHash;
      const throwExpressions = this.expressionExtractor.extractFromThrowStatement(
        throwStmtCtx.node,
        typeRegistryHash,
        ownerHash,
        packageName,
        importMap,
        hasStarImports,
        methodParamNames,
        throwIndex,
        localVariableNames,
        throwStmtCtx.lambdaParamNames
      );
      expressions.push(...throwExpressions);
      this.collectExpressionExtractorResults();
    }
    
    // Find all break statements in the method body
    const breakStatements = this.findBreakStatements(bodyBlock, blockPositionToHash);
    for (const breakStmtCtx of breakStatements) {
      const ownerHash = breakStmtCtx.containingBlockHash || methodHash;
      const breakExpressions = this.expressionExtractor.extractFromBreakStatement(
        breakStmtCtx.node,
        typeRegistryHash,
        ownerHash
      );
      expressions.push(...breakExpressions);
    }

    // Find all continue statements in the method body
    const continueStatements = this.findContinueStatements(bodyBlock, blockPositionToHash);
    for (const continueStmtCtx of continueStatements) {
      const ownerHash = continueStmtCtx.containingBlockHash || methodHash;
      const continueExpressions = this.expressionExtractor.extractFromContinueStatement(
        continueStmtCtx.node,
        typeRegistryHash,
        ownerHash
      );
      expressions.push(...continueExpressions);
    }

    // Extract control flow condition expressions (IF, WHILE, FOR, etc.)
    const conditionExpressions = this.extractConditionExpressions(
      bodyBlock,
      typeRegistryHash,
      methodHash,
      filePath,
      packageName,
      importMap,
      hasStarImports,
      methodParamNames,
      localVariableNames,
      blockPositionToHash
    );
    expressions.push(...conditionExpressions);
    
    // Find explicit constructor invocations (this() or super() calls)
    const constructorInvocations = this.findConstructorInvocations(bodyBlock);
    
    for (const invocation of constructorInvocations) {
      const invocationExpressions = this.expressionExtractor.extractFromConstructorInvocation(
        invocation,
        typeRegistryHash,
        methodHash,
        packageName,
        importMap,
        hasStarImports,
        methodParamNames
      );
      expressions.push(...invocationExpressions);
      this.collectExpressionExtractorResults();
    }
    
    return expressions;
  }


  /**
   * Collects all local variable names from a method body for LOCAL_VARIABLE classification.
   * This includes variables from local_variable_declaration, for loops, enhanced for loops,
   * try-with-resources, and catch clauses.
   */
  /**
   * Collects every pattern binding declared in a method body: `o instanceof Target a`,
   * `case String s`, and the components of a record pattern.
   *
   * These are gathered for the whole body for the same reason local variable names are - a use
   * site is classified against a set of names, and the declaration is in a different statement
   * from the use. Java scoping is narrower than this (a binding is in scope only where the
   * pattern definitely matched), but the set is used solely to classify what KIND of entity a
   * name refers to, and a name that is a pattern binding somewhere in the method is not a field
   * reference anywhere in it - shadowing a field is exactly the case that made this wrong.
   */
  private collectPatternBindingNames(bodyBlock: Parser.SyntaxNode): Set<string> {
    const names = new Set<string>();

    const walk = (node: Parser.SyntaxNode): void => {
      if (node.type === 'type_pattern' || node.type === 'instanceof_expression') {
        // `x instanceof Type name` - the binding is the trailing identifier.
        const named = node.namedChildren;
        const last = named[named.length - 1];
        if (last?.type === 'identifier' && named.length >= 2) {
          names.add(last.text);
        }
      }

      if (node.type === 'pattern' || node.type === 'record_pattern_component') {
        for (const child of node.namedChildren) {
          if (child.type === 'identifier') names.add(child.text);
        }
      }

      node.children.forEach(walk);
    };

    walk(bodyBlock);
    return names;
  }

  private collectLocalVariableNames(bodyBlock: Parser.SyntaxNode): Set<string> {
    const names = new Set<string>();
    this.collectLocalVariableNamesRecursive(bodyBlock, names);
    return names;
  }

  /**
   * Recursively collects local variable names from a node and its children.
   */
  private collectLocalVariableNamesRecursive(node: Parser.SyntaxNode, names: Set<string>): void {
    // Local variable declarations: int x = 1, y = 2;
    if (node.type === 'local_variable_declaration') {
      for (const child of node.children) {
        if (child.type === 'variable_declarator') {
          const nameNode = child.childForFieldName('name');
          if (nameNode) {
            names.add(nameNode.text);
          }
        }
      }
    }
    // For loop variables: for (int i = 0; ...)
    else if (node.type === 'for_statement') {
      const init = node.childForFieldName('init');
      if (init && init.type === 'local_variable_declaration') {
        for (const child of init.children) {
          if (child.type === 'variable_declarator') {
            const nameNode = child.childForFieldName('name');
            if (nameNode) {
              names.add(nameNode.text);
            }
          }
        }
      }
    }
    // Enhanced for loop: for (String s : list)
    else if (node.type === 'enhanced_for_statement') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        names.add(nameNode.text);
      }
    }
    // Catch clause: catch (Exception e)
    else if (node.type === 'catch_clause') {
      const formalParam = node.children.find(c => c.type === 'catch_formal_parameter');
      if (formalParam) {
        const nameNode = formalParam.childForFieldName('name');
        if (nameNode) {
          names.add(nameNode.text);
        }
      }
    }
    // Try-with-resources: try (Resource r = ...)
    else if (node.type === 'try_with_resources_statement') {
      const resources = node.children.find(c => c.type === 'resource_specification');
      if (resources) {
        for (const resource of resources.children) {
          if (resource.type === 'resource') {
            const nameNode = resource.childForFieldName('name');
            if (nameNode) {
              names.add(nameNode.text);
            }
          }
        }
      }
    }

    // Don't recurse into nested class bodies or lambda bodies (they have separate scope)
    if (node.type === 'class_body') {
      return;
    }

    // Recurse into children
    for (const child of node.children) {
      this.collectLocalVariableNamesRecursive(child, names);
    }
  }

  /**
   * Extracts local variables from a method body.
   */
  private extractMethodBodyLocalVariables(
    methodNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    methodName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean
  ): LocalVariableRegistry[] {
    // Find the method body (block or constructor_body)
    const bodyBlock = methodNode.children.find(child => 
      child.type === 'block' || child.type === 'constructor_body'
    );
    if (!bodyBlock) {
      return []; // Abstract methods, interface methods without body
    }

    // Determine scope kind based on method type
    let scopeKind = LocalVariableScopeKind.METHOD_BODY;
    const methodKind = this.determineMethodKind(methodNode);
    if (methodKind === MethodKind.CONSTRUCTOR || methodKind === MethodKind.COMPACT_CONSTRUCTOR) {
      scopeKind = LocalVariableScopeKind.CONSTRUCTOR_BODY;
    }

    // Extract method parameter names for PARAMETER classification in expressions
    const methodParamNames = this.extractMethodParameterNames(methodNode);

    // Extract local variables from the method body
    // Pass extracted expressions for hash lookup (switch expressions, lambdas, etc.)
    const localVariables = this.localVariableExtractor.extractFromMethodBody(
      bodyBlock,
      filePath,
      typeRegistryHash,
      methodHash,
      ownerTypeName,
      ownerQualifiedName,
      methodName,
      serviceVersionHash,
      packageName,
      importMap,
      hasStarImports,
      scopeKind,
      methodParamNames,
      this.extractedExpressions
    );

    // Collect expressions from local variable initializers
    const localVarExpressions = this.localVariableExtractor.getExtractedExpressions();
    this.extractedExpressions.push(...localVarExpressions);

    // Collect type references from local variable types
    const localVarTypeRefs = this.localVariableExtractor.getExtractedTypeReferences();
    this.extractedTypeReferences.push(...localVarTypeRefs);

    // Collect anonymous classes from local variable initializers
    const localVarAnonClasses = this.localVariableExtractor.getExtractedAnonymousClasses();
    this.extractedAnonymousClasses.push(...localVarAnonClasses);

    // Collect annotations from local variable declarations
    const localVarAnnotations = this.localVariableExtractor.getExtractedAnnotations();
    this.extractedAnnotations.push(...localVarAnnotations);

    // Collect annotation arguments from local variable declarations
    const localVarAnnotationArgs = this.localVariableExtractor.getExtractedAnnotationArguments();
    this.extractedAnnotationArguments.push(...localVarAnnotationArgs);

    return localVariables;
  }
  
  /**
   * Extracts expressions from an initializer block (static or instance).
   * Initializer blocks can contain expression statements like assignments, method calls, etc.
   */
  private extractInitializerBlockExpressions(
    initializerNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    methodHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    filePath: string
  ): ExpressionReference[] {
    const expressions: ExpressionReference[] = [];
    
    // For static_initializer, the block is a child; for instance initializer, the node IS the block
    const bodyBlock = initializerNode.type === 'static_initializer'
      ? initializerNode.children.find(child => child.type === 'block')
      : initializerNode;
    
    if (!bodyBlock) {
      return expressions;
    }
    
    // Initializers have no parameters
    const methodParamNames = new Set<string>();
    
    // Collect local variable names from the initializer block for LOCAL_VARIABLE classification
    const localVariableNames = this.collectLocalVariableNames(bodyBlock);

    // A pattern binding is declared in one statement and used in another, so the extractor is
    // told the whole body's bindings once rather than per statement.
    this.expressionExtractor.setMethodPatternBindingNames(this.collectPatternBindingNames(bodyBlock));
    
    // Build position-to-hash map for block ownership lookups in initializer expression extraction
    const blockPositionToHash = this.buildBlockPositionMapFromAST(bodyBlock, typeRegistryHash, methodHash, filePath);
    
    // Find all expression statements in the initializer block (with containing lambda and block tracking)
    const expressionStatements = this.findExpressionStatements(bodyBlock, typeRegistryHash, methodHash, filePath, blockPositionToHash);
    
    // Build lambda position to hash map for initializer block
    const lambdaPositionToHash = new Map<string, string>();
    
    // Two-pass extraction for expression statements in initializer
    const statementsNotInLambda = expressionStatements.filter(s => !s.containingLambdaPosition);
    const statementsInLambda = expressionStatements.filter(s => s.containingLambdaPosition);
    
    // Pass 1: Extract statements not inside lambdas
    for (const exprStmtCtx of statementsNotInLambda) {
      const ownerHash = exprStmtCtx.containingBlockHash || methodHash;
      const exprStmtExpressions = this.expressionExtractor.extractFromExpressionStatement(
        exprStmtCtx.node,
        typeRegistryHash,
        ownerHash,
        packageName,
        importMap,
        hasStarImports,
        methodParamNames,
        localVariableNames,
        exprStmtCtx.lambdaParamNames
      );
      expressions.push(...exprStmtExpressions);
      this.collectExpressionExtractorResults();
      
      // Collect lambda hashes for position-based lookup
      for (const expr of exprStmtExpressions) {
        if (expr.getKind().toString() === 'LAMBDA_EXPRESSION') {
          const startLine = expr.getStartLine();
          const startCol = expr.getStartColumn();
          const endLine = expr.getEndLine();
          const endCol = expr.getEndColumn();
          if (startLine !== undefined && startCol !== undefined && 
              endLine !== undefined && endCol !== undefined) {
            const posKey = `${startLine}:${startCol}:${endLine}:${endCol}`;
            lambdaPositionToHash.set(posKey, expr.getHash());
          }
        }
      }
    }
    
    // Pass 2: Extract statements inside lambdas (resolve actual hash from position)
    for (const exprStmtCtx of statementsInLambda) {
      const actualLambdaHash = exprStmtCtx.containingLambdaPosition 
        ? lambdaPositionToHash.get(exprStmtCtx.containingLambdaPosition) 
        : null;
      const ownerHash = exprStmtCtx.containingBlockHash || actualLambdaHash || methodHash;
      const exprStmtExpressions = this.expressionExtractor.extractFromExpressionStatement(
        exprStmtCtx.node,
        typeRegistryHash,
        ownerHash,
        packageName,
        importMap,
        hasStarImports,
        methodParamNames,
        localVariableNames,
        exprStmtCtx.lambdaParamNames
      );
      expressions.push(...exprStmtExpressions);
      this.collectExpressionExtractorResults();
    }
    
    // Throw, break and continue statements, as a method body gets them.
    //
    // `return` is deliberately not among them: JLS 8.6 and 8.7 forbid a return statement in an
    // initializer, so there is nothing to extract.
    const throwStatements = this.findThrowStatements(bodyBlock, typeRegistryHash, methodHash, filePath, blockPositionToHash);
    for (let throwIndex = 0; throwIndex < throwStatements.length; throwIndex++) {
      const throwStmtCtx = throwStatements[throwIndex]!;
      const actualLambdaHash = throwStmtCtx.containingLambdaPosition
        ? lambdaPositionToHash.get(throwStmtCtx.containingLambdaPosition)
        : null;
      const ownerHash = throwStmtCtx.containingBlockHash || actualLambdaHash || methodHash;
      const throwExpressions = this.expressionExtractor.extractFromThrowStatement(
        throwStmtCtx.node,
        typeRegistryHash,
        ownerHash,
        packageName,
        importMap,
        hasStarImports,
        methodParamNames,
        throwIndex,
        localVariableNames,
        throwStmtCtx.lambdaParamNames
      );
      expressions.push(...throwExpressions);
      this.collectExpressionExtractorResults();
    }

    const breakStatements = this.findBreakStatements(bodyBlock, blockPositionToHash);
    for (const breakStmtCtx of breakStatements) {
      expressions.push(...this.expressionExtractor.extractFromBreakStatement(
        breakStmtCtx.node,
        typeRegistryHash,
        breakStmtCtx.containingBlockHash || methodHash
      ));
    }

    const continueStatements = this.findContinueStatements(bodyBlock, blockPositionToHash);
    for (const continueStmtCtx of continueStatements) {
      expressions.push(...this.expressionExtractor.extractFromContinueStatement(
        continueStmtCtx.node,
        typeRegistryHash,
        continueStmtCtx.containingBlockHash || methodHash
      ));
    }


    // Control-flow condition expressions, exactly as a method body gets them.
    //
    // Only expression statements were extracted here, so every expression in a control-flow
    // POSITION was dropped: an if or while condition, an enhanced-for iterable, a throw value.
    // The bodies of those statements survived, because their contents are expression statements
    // in their own right, which is why an initializer reached the fact set looking like a
    // straight-line block rather than an empty one.
    //
    // An initializer body is an ordinary block, so the same walk applies unchanged; only the
    // owner differs, and it is the initializer's own method hash.
    const conditionExpressions = this.extractConditionExpressions(
      bodyBlock,
      typeRegistryHash,
      methodHash,
      filePath,
      packageName,
      importMap,
      hasStarImports,
      methodParamNames,
      localVariableNames,
      blockPositionToHash
    );
    expressions.push(...conditionExpressions);

    return expressions;
  }
  
  /**
   * Extracts parameter names from a method declaration.
   */
  private extractMethodParameterNames(methodNode: Parser.SyntaxNode): Set<string> {
    const paramNames = new Set<string>();
    
    // Find formal_parameters node
    const formalParams = methodNode.children.find(child => child.type === 'formal_parameters');
    if (!formalParams) {
      return paramNames;
    }
    
    // Iterate through parameters
    for (const child of formalParams.namedChildren) {
      if (child.type === 'formal_parameter') {
        // Find the identifier (parameter name)
        const nameNode = child.childForFieldName('name');
        if (nameNode) {
          paramNames.add(nameNode.text);
        }
      } else if (child.type === 'spread_parameter') {
        // Varargs parameter: spread_parameter -> variable_declarator -> identifier
        const varDecl = child.children.find(c => c.type === 'variable_declarator');
        if (varDecl) {
          const nameNode = varDecl.childForFieldName('name');
          if (nameNode) {
            paramNames.add(nameNode.text);
          }
        }
      }
    }
    
    return paramNames;
  }

  /**
   * Builds a position-to-hash map by traversing a block AST once.
   * Finds all control flow block bodies and computes their hashes.
   * This consolidates hash computation that was previously duplicated
   * in findExpressionStatements, findThrowStatements, and findReturnStatementsAtLevel.
   * Works for both method bodies and initializer blocks.
   */
  private buildBlockPositionMapFromAST(
    bodyBlock: Parser.SyntaxNode,
    typeRegistryHash: string,
    methodHash: string,
    filePath: string
  ): Map<string, string> {
    const map = new Map<string, string>();
    
    const addBlock = (kind: BlockKind, blockNode: Parser.SyntaxNode): void => {
      const hash = BlockRegistry.computeHash(
        kind, filePath,
        blockNode.startPosition.row + 1, blockNode.endPosition.row + 1,
        blockNode.startPosition.column, blockNode.endPosition.column,
        typeRegistryHash, methodHash
      );
      map.set(TypeMethodExtractor.blockPosKey(blockNode), hash);
    };

    // processNode handles a single node by dispatching to the appropriate control
    // flow handler using field names. This ensures correct handling even when a
    // brace-less body IS itself a control flow statement (e.g., for(...) if(...) X; else if(...) Y;).
    // After handling the node's own structure, it recurses into body/consequence nodes.
    const processNode = (node: Parser.SyntaxNode): void => {
      if (node.type === 'class_body') return;

      if (node.type === 'if_statement') {
        const consequence = node.childForFieldName('consequence');
        if (consequence) {
          addBlock(BlockKind.IF, consequence);
          processNode(consequence);
        }
        // Handle else-if chains and else
        let alt = node.childForFieldName('alternative');
        while (alt) {
          if (alt.type === 'if_statement') {
            const elseIfCons = alt.childForFieldName('consequence');
            if (elseIfCons) {
              addBlock(BlockKind.ELSE_IF, elseIfCons);
              processNode(elseIfCons);
            }
            alt = alt.childForFieldName('alternative');
          } else {
            addBlock(BlockKind.ELSE, alt);
            processNode(alt);
            alt = null;
          }
        }
      } else if (node.type === 'for_statement') {
        const body = node.childForFieldName('body');
        if (body) { addBlock(BlockKind.FOR, body); processNode(body); }
      } else if (node.type === 'enhanced_for_statement') {
        const body = node.childForFieldName('body');
        if (body) { addBlock(BlockKind.ENHANCED_FOR, body); processNode(body); }
      } else if (node.type === 'while_statement') {
        const body = node.childForFieldName('body');
        if (body) { addBlock(BlockKind.WHILE, body); processNode(body); }
      } else if (node.type === 'do_statement') {
        const body = node.childForFieldName('body');
        if (body) { addBlock(BlockKind.DO_WHILE, body); processNode(body); }
      } else if (node.type === 'try_statement' || node.type === 'try_with_resources_statement') {
        const isTryWithResources = node.type === 'try_with_resources_statement';
        const kind = isTryWithResources ? BlockKind.TRY_WITH_RESOURCES : BlockKind.TRY;
        const tryBody = node.children.find(c => c.type === 'block');
        if (tryBody) {
          addBlock(kind, tryBody);
          traverseChildren(tryBody);
        }
        for (const clause of node.children) {
          if (clause.type === 'catch_clause') {
            const catchBody = clause.children.find(c => c.type === 'block');
            if (catchBody) { addBlock(BlockKind.CATCH, catchBody); traverseChildren(catchBody); }
          } else if (clause.type === 'finally_clause') {
            const finallyBody = clause.children.find(c => c.type === 'block');
            if (finallyBody) { addBlock(BlockKind.FINALLY, finallyBody); traverseChildren(finallyBody); }
          }
        }
      } else if (node.type === 'synchronized_statement') {
        const body = node.childForFieldName('body');
        if (body && body.type === 'block') { addBlock(BlockKind.SYNCHRONIZED, body); traverseChildren(body); }
      } else if (node.type === 'switch_expression' || node.type === 'switch_statement') {
        // Handle switch cases: both colon syntax (switch_block_statement_group) and arrow syntax (switch_rule)
        const switchBlock = node.children.find(c => c.type === 'switch_block');
        if (switchBlock) {
          for (const caseChild of switchBlock.children) {
            if (caseChild.type === 'switch_block_statement_group') {
              // Traditional colon syntax: use group node position for SWITCH_CASE
              addBlock(BlockKind.SWITCH_CASE, caseChild);
              traverseChildren(caseChild);
            } else if (caseChild.type === 'switch_rule') {
              // Arrow syntax: use block child position for SWITCH_EXPRESSION_CASE
              const ruleBlock = caseChild.children.find(c => c.type === 'block');
              if (ruleBlock) {
                addBlock(BlockKind.SWITCH_EXPRESSION_CASE, ruleBlock);
                traverseChildren(ruleBlock);
              } else {
                traverseChildren(caseChild);
              }
            }
          }
        } else {
          traverseChildren(node);
        }
      } else {
        // Default: not a recognized control flow node, iterate children
        traverseChildren(node);
      }
    };

    // traverseChildren iterates a node's children and dispatches each via processNode
    const traverseChildren = (n: Parser.SyntaxNode): void => {
      for (const child of n.children) {
        if (child.type === 'class_body') continue;
        if (child.type === 'lambda_expression') {
          // Traverse into lambda bodies to find nested blocks
          traverseChildren(child);
        } else {
          processNode(child);
        }
      }
    };
    
    traverseChildren(bodyBlock);
    return map;
  }

  /**
   * Looks up a block hash from the position map for a given AST node.
   * Returns the hash if the node's position matches a known block, null otherwise.
   */
  private static blockPosKey(node: Parser.SyntaxNode): string {
    return `${node.startPosition.row + 1}:${node.startPosition.column}:${node.endPosition.row + 1}:${node.endPosition.column}`;
  }

  /**
   * Finds return statements at a single level, NOT traversing into lambdas.
   * Used for iterative return extraction where we process lambdas wave by wave.
   */
  private findReturnStatementsAtLevel(
    node: Parser.SyntaxNode,
    _typeRegistryHash: string,
    _methodHash: string,
    _filePath: string,
    containingLambdaPosition: string | null,
    lambdaParamNames: Set<string> = new Set(),
    blockPositionToHash?: Map<string, string>
  ): StatementWithContext[] {
    const returns: StatementWithContext[] = [];
    
    const lookupHash = (blockNode: Parser.SyntaxNode): string | null => {
      if (!blockPositionToHash) return null;
      return blockPositionToHash.get(TypeMethodExtractor.blockPosKey(blockNode)) || null;
    };
    
    const traverse = (n: Parser.SyntaxNode, currentBlockHash: string | null, inLocalVarDecl: boolean): void => {
      // Collect return statements (skip those in local var decl lambdas - handled by LocalVariableExtractor)
      if (n.type === 'return_statement' && !(containingLambdaPosition && inLocalVarDecl)) {
        returns.push({ node: n, containingLambdaPosition, containingBlockHash: currentBlockHash, lambdaParamNames });
      }
      // Don't traverse into class bodies or lambda expressions (lambdas handled in separate waves)
      if (n.type !== 'class_body' && n.type !== 'lambda_expression') {
        const isLocalVarDecl = n.type === 'local_variable_declaration' || n.type === 'resource';
        for (const child of n.children) {
          if (child.type === 'try_statement' || child.type === 'try_with_resources_statement') {
            // Only try/catch/finally blocks update block hash context for return statements
            const tryBody = child.children.find((c: Parser.SyntaxNode) => c.type === 'block');
            if (tryBody) {
              traverse(tryBody, lookupHash(tryBody) || currentBlockHash, inLocalVarDecl || isLocalVarDecl);
            }
            for (const clause of child.children) {
              if (clause.type === 'catch_clause') {
                const catchBody = clause.children.find((c: Parser.SyntaxNode) => c.type === 'block');
                if (catchBody) traverse(catchBody, lookupHash(catchBody) || currentBlockHash, inLocalVarDecl || isLocalVarDecl);
              } else if (clause.type === 'finally_clause') {
                const finallyBody = clause.children.find((c: Parser.SyntaxNode) => c.type === 'block');
                if (finallyBody) traverse(finallyBody, lookupHash(finallyBody) || currentBlockHash, inLocalVarDecl || isLocalVarDecl);
              }
            }
          } else if (child.type !== 'lambda_expression') {
            // Look up block hash from pre-computed map for any node that corresponds to a control flow body
            const childBlockHash = lookupHash(child) || currentBlockHash;
            traverse(child, childBlockHash, inLocalVarDecl || isLocalVarDecl);
          }
        }
      }
    };
    
    traverse(node, null, false);
    return returns;
  }

  /**
   * Finds a lambda expression node by its position in the AST.
   */
  private findLambdaNodeByPosition(
    root: Parser.SyntaxNode,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number
  ): Parser.SyntaxNode | null {
    const search = (n: Parser.SyntaxNode): Parser.SyntaxNode | null => {
      if (n.type === 'lambda_expression') {
        const sl = n.startPosition.row + 1;
        const sc = n.startPosition.column;
        const el = n.endPosition.row + 1;
        const ec = n.endPosition.column;
        if (sl === startLine && sc === startCol && el === endLine && ec === endCol) {
          return n;
        }
      }
      for (const child of n.children) {
        const found = search(child);
        if (found) return found;
      }
      return null;
    };
    return search(root);
  }

  /**
   * Recursively finds all throw_statement nodes in a block.
   * Traverses into nested blocks (try/catch/finally) and lambda bodies.
   * Tracks the containing lambda and block (if any) for each throw statement.
   * 
   * @param node The block to search
   * @param typeRegistryHash Hash of the containing type (for lambda hash generation)
   */
  private findThrowStatements(
    node: Parser.SyntaxNode,
    _typeRegistryHash: string,
    _methodHash: string,
    _filePath: string,
    blockPositionToHash?: Map<string, string>
  ): StatementWithContext[] {
    const throws: StatementWithContext[] = [];
    
    const traverse = (n: Parser.SyntaxNode, currentLambdaPosition: string | null, currentBlockHash: string | null, inLocalVarDecl: boolean, currentLambdaParams: Set<string>): void => {
      // Skip throw statements inside lambdas that are in local variable declarations
      // Those are handled by LocalVariableExtractor with proper local variable linking
      if (n.type === 'throw_statement'
          && !(currentLambdaPosition && inLocalVarDecl)
          && !TypeMethodExtractor.isValueProducingSwitchArm(n)) {
        throws.push({ node: n, containingLambdaPosition: currentLambdaPosition, containingBlockHash: currentBlockHash, lambdaParamNames: currentLambdaParams });
      }
      // Don't traverse into nested class bodies (anonymous classes have separate methods)
      // DO traverse into lambda bodies to extract their throw statements
      if (n.type !== 'class_body') {
        const isLocalVarDecl = n.type === 'local_variable_declaration' || n.type === 'resource';
        for (const child of n.children) {
          if (child.type === 'lambda_expression') {
            const lambdaPosKey = TypeMethodExtractor.blockPosKey(child);
            const lambdaParams = this.extractLambdaParameterNames(child);
            const mergedParams = new Set([...currentLambdaParams, ...lambdaParams]);
            // When entering lambda, reset block and local var decl context (lambda body is new scope)
            traverse(child, lambdaPosKey, null, false, mergedParams);
          } else {
            // Look up block hash from pre-computed map for any node that corresponds to a control flow body
            let childBlockHash = currentBlockHash;
            if (blockPositionToHash) {
              const mapped = blockPositionToHash.get(TypeMethodExtractor.blockPosKey(child));
              if (mapped) childBlockHash = mapped;
            }
            traverse(child, currentLambdaPosition, childBlockHash, inLocalVarDecl || isLocalVarDecl, currentLambdaParams);
          }
        }
      }
    };
    
    traverse(node, null, null, false, new Set());
    return throws;
  }

  /**
   * Finds all continue_statement nodes in a method body, tracking their containing block hash.
   * Continue statements appear in loops. Lambda boundaries are respected.
   */
  private findContinueStatements(
    node: Parser.SyntaxNode,
    blockPositionToHash?: Map<string, string>
  ): StatementWithContext[] {
    const continues: StatementWithContext[] = [];

    const traverse = (n: Parser.SyntaxNode, currentBlockHash: string | null): void => {
      if (n.type === 'continue_statement') {
        continues.push({ node: n, containingLambdaPosition: null, containingBlockHash: currentBlockHash, lambdaParamNames: new Set() });
      }
      if (n.type !== 'class_body' && n.type !== 'lambda_expression') {
        for (const child of n.children) {
          let childBlockHash = currentBlockHash;
          if (blockPositionToHash) {
            const mapped = blockPositionToHash.get(TypeMethodExtractor.blockPosKey(child));
            if (mapped) childBlockHash = mapped;
          }
          traverse(child, childBlockHash);
        }
      }
    };

    traverse(node, null);
    return continues;
  }

  /**
   * Finds all break_statement nodes in a method body, tracking their containing block hash.
   * Break statements appear in switch cases and loops. Lambda boundaries are respected.
   */
  private findBreakStatements(
    node: Parser.SyntaxNode,
    blockPositionToHash?: Map<string, string>
  ): StatementWithContext[] {
    const breaks: StatementWithContext[] = [];

    const traverse = (n: Parser.SyntaxNode, currentBlockHash: string | null): void => {
      if (n.type === 'break_statement') {
        breaks.push({ node: n, containingLambdaPosition: null, containingBlockHash: currentBlockHash, lambdaParamNames: new Set() });
      }
      if (n.type !== 'class_body' && n.type !== 'lambda_expression') {
        for (const child of n.children) {
          let childBlockHash = currentBlockHash;
          if (blockPositionToHash) {
            const mapped = blockPositionToHash.get(TypeMethodExtractor.blockPosKey(child));
            if (mapped) childBlockHash = mapped;
          }
          traverse(child, childBlockHash);
        }
      }
    };

    traverse(node, null);
    return breaks;
  }

  /**
   * Extracts lambda parameter names from a lambda expression node.
   */
  private extractLambdaParameterNames(lambdaNode: Parser.SyntaxNode): Set<string> {
    const paramNames = new Set<string>();
    
    for (const child of lambdaNode.children) {
      if (child.type === 'identifier') {
        // Single parameter without parentheses: x -> ...
        // Check if this is before the arrow (parameter) vs after (body)
        const arrow = lambdaNode.children.find(c => c.type === '->');
        if (arrow && child.startPosition.column < arrow.startPosition.column) {
          paramNames.add(child.text);
        }
      } else if (child.type === 'inferred_parameters') {
        // Inferred parameters: (x, y) -> ...
        for (const param of child.namedChildren) {
          if (param.type === 'identifier') {
            paramNames.add(param.text);
          }
        }
      } else if (child.type === 'formal_parameters') {
        // Formal parameters: (String x, int y) -> ...
        for (const param of child.namedChildren) {
          if (param.type === 'formal_parameter') {
            const nameNode = param.childForFieldName('name');
            if (nameNode) {
              paramNames.add(nameNode.text);
            }
          }
        }
      }
    }
    
    return paramNames;
  }
  
  /**
   * Recursively finds all expression_statement nodes in a block.
   * Expression statements are standalone expressions like assignments, method calls, increments.
   * Traverses into lambda block bodies to find nested expression statements.
   * Tracks the containing lambda (if any) for each expression statement.
   * 
   * @param node The block to search
   * @param typeRegistryHash Hash of the containing type (for lambda hash generation)
   */
  /**
   * True when this statement is the body of an arrow arm belonging to a switch used as a VALUE.
   *
   * `case 1 -> t();` is written as an expression_statement, and `case 1 -> throw e;` as a
   * throw_statement, whichever form the switch takes, so
   * collecting every expression_statement picked the arm up a second time. The arm's value is the
   * switch's value, not a statement in the enclosing method, so the second row asserted a root
   * context the source does not have and turned one written call site into two.
   *
   * The two forms are distinguished by what the switch is attached to. tree-sitter models both as
   * `switch_expression`; a switch used as a statement sits directly in a `block`, while one used
   * as a value sits under whatever consumes it - a return, a variable_declarator, an
   * argument_list, an assignment. So a `block` parent means statement, and anything else means
   * value.
   *
   * A statement switch is left alone: there the arm really is a statement, and its single row is
   * correct.
   */
  private static isValueProducingSwitchArm(node: Parser.SyntaxNode): boolean {
    if (node.parent?.type !== 'switch_rule') return false;

    const switchExpression = node.parent.parent?.parent;
    if (switchExpression?.type !== 'switch_expression') return false;

    return switchExpression.parent?.type !== 'block';
  }

  private findExpressionStatements(
    node: Parser.SyntaxNode,
    _typeRegistryHash: string,
    _methodHash: string,
    _filePath: string,
    blockPositionToHash?: Map<string, string>
  ): StatementWithContext[] {
    const statements: StatementWithContext[] = [];
    
    const traverse = (n: Parser.SyntaxNode, currentLambdaPosition: string | null, currentBlockHash: string | null, inLocalVarDecl: boolean, currentLambdaParams: Set<string>): void => {
      // Skip expression statements inside lambdas that are in local variable declarations
      // Those are handled by LocalVariableExtractor with proper local variable linking
      if (n.type === 'expression_statement'
          && !(currentLambdaPosition && inLocalVarDecl)
          && !TypeMethodExtractor.isValueProducingSwitchArm(n)) {
        statements.push({ node: n, containingLambdaPosition: currentLambdaPosition, containingBlockHash: currentBlockHash, lambdaParamNames: currentLambdaParams });
      }
      // Don't traverse into nested class bodies (anonymous classes have separate methods)
      // DO traverse into lambda bodies to extract their expression statements
      if (n.type !== 'class_body') {
        const isLocalVarDecl = n.type === 'local_variable_declaration' || n.type === 'resource';
        for (const child of n.children) {
          if (child.type === 'lambda_expression') {
            const lambdaPosKey = TypeMethodExtractor.blockPosKey(child);
            const lambdaParams = this.extractLambdaParameterNames(child);
            const mergedParams = new Set([...currentLambdaParams, ...lambdaParams]);
            // When entering lambda, reset block context but preserve inLocalVarDecl if this lambda is in a local var decl
            // or try-with-resources resource (expression/return statements inside those lambdas are handled by LocalVariableExtractor)
            traverse(child, lambdaPosKey, null, inLocalVarDecl || isLocalVarDecl, mergedParams);
          } else {
            // Look up block hash from pre-computed map for any node that corresponds to a control flow body
            let childBlockHash = currentBlockHash;
            if (blockPositionToHash) {
              const mapped = blockPositionToHash.get(TypeMethodExtractor.blockPosKey(child));
              if (mapped) childBlockHash = mapped;
            }
            traverse(child, currentLambdaPosition, childBlockHash, inLocalVarDecl || isLocalVarDecl, currentLambdaParams);
          }
        }
      }
    };
    
    traverse(node, null, null, false, new Set());
    return statements;
  }
  
  /**
   * Finds explicit constructor invocations (this() or super() calls) in a block.
   * These are special statements that can only appear as the first statement in a constructor.
   */
  private findConstructorInvocations(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const invocations: Parser.SyntaxNode[] = [];
    
    const traverse = (n: Parser.SyntaxNode): void => {
      if (n.type === 'explicit_constructor_invocation') {
        invocations.push(n);
      }
      // Don't traverse into nested class/lambda bodies - they have their own scope
      if (n.type !== 'class_body' && n.type !== 'lambda_expression') {
        for (const child of n.children) {
          traverse(child);
        }
      }
    };
    
    traverse(node);
    return invocations;
  }

  /**
   * Extracts condition expressions from control flow statements (IF, WHILE, FOR, DO_WHILE, SWITCH, SYNCHRONIZED).
   * These are expressions in the condition/selector positions of control flow statements.
   */
  private extractConditionExpressions(
    bodyBlock: Parser.SyntaxNode,
    typeRegistryHash: string,
    methodHash: string,
    filePath: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    methodParamNames: Set<string>,
    localVariableNames: Set<string>,
    blockPositionToHash?: Map<string, string>
  ): ExpressionReference[] {
    const expressions: ExpressionReference[] = [];

    // handleIfStatement: extracts conditions from an if_statement and its else-if chain,
    // then traverses into body nodes only (not the entire if_statement node, which would
    // cause alternatives to be re-processed as standalone IFs).
    const handleIfStatement = (ifNode: Parser.SyntaxNode, currentLambdaParams: Set<string>, insideLambda: boolean, currentBlockHash: string): void => {
      const condition = ifNode.childForFieldName('condition');
      if (condition) {
        const consequence = ifNode.childForFieldName('consequence');
        let ownerHash = currentBlockHash;
        if (consequence) {
          ownerHash = BlockRegistry.computeHash(
            BlockKind.IF, filePath,
            consequence.startPosition.row + 1, consequence.endPosition.row + 1,
            consequence.startPosition.column, consequence.endPosition.column,
            typeRegistryHash, methodHash
          );
        }
        const condExprs = this.expressionExtractor.extractFromConditionExpression(
          condition,
          typeRegistryHash,
          ownerHash,
          ExpressionOwnerKind.IF_STATEMENT,
          RootContext.IF_CONDITION,
          packageName,
          importMap,
          hasStarImports,
          methodParamNames,
          localVariableNames,
          currentLambdaParams
        );
        expressions.push(...condExprs);
        this.collectExpressionExtractorResults();
      }

      // Handle else-if conditions and traverse their bodies (not the if_statement nodes to avoid duplication)
      let currentAlt: Parser.SyntaxNode | null = ifNode.childForFieldName('alternative');
      while (currentAlt && currentAlt.type === 'if_statement') {
        const elseIfCondition = currentAlt.childForFieldName('condition');
        if (elseIfCondition) {
          const elseIfConsequence = currentAlt.childForFieldName('consequence');
          let elseIfOwnerHash = currentBlockHash;
          if (elseIfConsequence) {
            elseIfOwnerHash = BlockRegistry.computeHash(
              BlockKind.ELSE_IF, filePath,
              elseIfConsequence.startPosition.row + 1, elseIfConsequence.endPosition.row + 1,
              elseIfConsequence.startPosition.column, elseIfConsequence.endPosition.column,
              typeRegistryHash, methodHash
            );
          }
          const elseIfCondExprs = this.expressionExtractor.extractFromConditionExpression(
            elseIfCondition,
            typeRegistryHash,
            elseIfOwnerHash,
            ExpressionOwnerKind.IF_STATEMENT,
            RootContext.IF_CONDITION,
            packageName,
            importMap,
            hasStarImports,
            methodParamNames,
            localVariableNames,
            currentLambdaParams
          );
          expressions.push(...elseIfCondExprs);
          this.collectExpressionExtractorResults();

          // Traverse the else-if body (consequence), not the if_statement node
          if (elseIfConsequence) {
            traverse(elseIfConsequence, currentLambdaParams, insideLambda, currentBlockHash);
          }
        }

        // Move to next alternative
        const nextAlt = currentAlt.childForFieldName('alternative');
        if (nextAlt && nextAlt.type === 'if_statement') {
          currentAlt = nextAlt;
        } else {
          // Final else or end of chain - traverse if it's a block
          if (nextAlt) {
            traverse(nextAlt, currentLambdaParams, insideLambda, currentBlockHash);
          }
          currentAlt = null;
        }
      }

      // Recurse into if body only (else-if chain already handled above)
      const ifConsequence = ifNode.childForFieldName('consequence');
      if (ifConsequence) {
        traverse(ifConsequence, currentLambdaParams, insideLambda, currentBlockHash);
      }
      // Handle direct else (when alternative is not if_statement)
      const ifAlternative = ifNode.childForFieldName('alternative');
      if (ifAlternative && ifAlternative.type !== 'if_statement') {
        traverse(ifAlternative, currentLambdaParams, insideLambda, currentBlockHash);
      }
    };

    const traverse = (node: Parser.SyntaxNode, currentLambdaParams: Set<string>, insideLambda: boolean, currentBlockHash: string): void => {
      // When entering a block with a known hash, update the fallback for descendant control flow.
      // This ensures brace-less control flow inside try/catch/if/for blocks uses the block hash
      // as owner instead of the outer method hash.
      if ((node.type === 'block' || node.type === 'switch_block_statement_group') && blockPositionToHash) {
        const blockHash = blockPositionToHash.get(TypeMethodExtractor.blockPosKey(node));
        if (blockHash) currentBlockHash = blockHash;
      }

      // Self-dispatch: if this node IS an if_statement (happens when a brace-less
      // body is an if_statement), handle it via the dedicated handler to correctly
      // walk else-if chains instead of iterating children blindly.
      if (node.type === 'if_statement') {
        handleIfStatement(node, currentLambdaParams, insideLambda, currentBlockHash);
        return;
      }

      for (const child of node.children) {
        // Skip class bodies (anonymous classes have their own extraction)
        if (child.type === 'class_body') continue;

        // Handle lambda expressions - collect their params and traverse body.
        // Block hashes inside lambdas are computed with methodHash, which matches
        // both buildBlockPositionMapFromAST and LVE's this.blockMethodHash.
        if (child.type === 'lambda_expression') {
          const lambdaParams = this.extractLambdaParameterNames(child);
          const mergedParams = new Set([...currentLambdaParams, ...lambdaParams]);
          traverse(child, mergedParams, true, methodHash);
          continue;
        }

        // IF statement condition (and else-if conditions)
        if (child.type === 'if_statement') {
          handleIfStatement(child, currentLambdaParams, insideLambda, currentBlockHash);
          continue;
        }

        // ASSERT statement condition and detail message
        if (child.type === 'assert_statement') {
          // `assert cond;` and `assert cond : detail;`. The node has no field names, so the
          // named children carry the two halves in order: the first is always the condition,
          // the second, when present, is the detail message.
          const named = child.children.filter(c => c.isNamed);
          const contexts = [RootContext.ASSERT_CONDITION, RootContext.ASSERT_MESSAGE];

          named.slice(0, 2).forEach((part, index) => {
            const assertExprs = this.expressionExtractor.extractFromConditionExpression(
              part,
              typeRegistryHash,
              currentBlockHash,
              ExpressionOwnerKind.ASSERT_STATEMENT,
              contexts[index]!,
              packageName,
              importMap,
              hasStarImports,
              methodParamNames,
              localVariableNames,
              currentLambdaParams
            );
            expressions.push(...assertExprs);
            this.collectExpressionExtractorResults();
          });

          // An assert has no body of its own, so there is nothing further to descend into:
          // both halves are expressions and were just handled.
          continue;
        }

        // WHILE statement condition
        if (child.type === 'while_statement') {
          const condition = child.childForFieldName('condition');
          if (condition) {
            const body = child.childForFieldName('body');
            let ownerHash = currentBlockHash;
            if (body) {
              ownerHash = BlockRegistry.computeHash(
                BlockKind.WHILE, filePath,
                body.startPosition.row + 1, body.endPosition.row + 1,
                body.startPosition.column, body.endPosition.column,
                typeRegistryHash, methodHash
              );
            }
            const condExprs = this.expressionExtractor.extractFromConditionExpression(
              condition,
              typeRegistryHash,
              ownerHash,
              ExpressionOwnerKind.WHILE_STATEMENT,
              RootContext.WHILE_CONDITION,
              packageName,
              importMap,
              hasStarImports,
              methodParamNames,
              localVariableNames,
              currentLambdaParams
            );
            expressions.push(...condExprs);
            this.collectExpressionExtractorResults();
          }
          traverse(child, currentLambdaParams, insideLambda, currentBlockHash);
          continue;
        }

        // DO-WHILE statement condition
        if (child.type === 'do_statement') {
          const condition = child.childForFieldName('condition');
          if (condition) {
            const body = child.childForFieldName('body');
            let ownerHash = currentBlockHash;
            if (body) {
              ownerHash = BlockRegistry.computeHash(
                BlockKind.DO_WHILE, filePath,
                body.startPosition.row + 1, body.endPosition.row + 1,
                body.startPosition.column, body.endPosition.column,
                typeRegistryHash, methodHash
              );
            }
            const condExprs = this.expressionExtractor.extractFromConditionExpression(
              condition,
              typeRegistryHash,
              ownerHash,
              ExpressionOwnerKind.DO_WHILE_STATEMENT,
              RootContext.DO_WHILE_CONDITION,
              packageName,
              importMap,
              hasStarImports,
              methodParamNames,
              localVariableNames,
              currentLambdaParams
            );
            expressions.push(...condExprs);
            this.collectExpressionExtractorResults();
          }
          traverse(child, currentLambdaParams, insideLambda, currentBlockHash);
          continue;
        }

        // FOR statement - init, condition, update
        if (child.type === 'for_statement') {
          const body = child.childForFieldName('body');
          let ownerHash = currentBlockHash;
          if (body) {
            ownerHash = BlockRegistry.computeHash(
              BlockKind.FOR, filePath,
              body.startPosition.row + 1, body.endPosition.row + 1,
              body.startPosition.column, body.endPosition.column,
              typeRegistryHash, methodHash
            );
          }

          // FOR condition
          const condition = child.childForFieldName('condition');
          if (condition) {
            const condExprs = this.expressionExtractor.extractFromConditionExpression(
              condition,
              typeRegistryHash,
              ownerHash,
              ExpressionOwnerKind.FOR_STATEMENT,
              RootContext.FOR_CONDITION,
              packageName,
              importMap,
              hasStarImports,
              methodParamNames,
              localVariableNames,
              currentLambdaParams
            );
            expressions.push(...condExprs);
            this.collectExpressionExtractorResults();
          }

          // FOR init and update clauses, read by FIELD rather than by node type.
          //
          // Matching on node type scanned every child of the for_statement, so a condition that
          // happened to be a method_invocation, a unary or an assignment matched the update set
          // as well and was emitted a second time with FOR_UPDATE. An expression init clause
          // matched too, so `for (init(); cond(); step())` produced three FOR_UPDATE rows for one
          // update clause, and the once-per-loop call in the init clause was reported in the
          // clause that runs every iteration.
          //
          // The grammar labels these: `init`, `condition` and `update` are field names on
          // for_statement, and a clause may repeat (`for (i = 0, j = 1; …; i++, j--)`), so every
          // child carrying the field is taken rather than the first.
          for (let clauseIndex = 0; clauseIndex < child.childCount; clauseIndex++) {
            const clause = child.child(clauseIndex);
            if (!clause) continue;

            const fieldName = child.fieldNameForChild(clauseIndex);
            if (fieldName !== 'init' && fieldName !== 'update') continue;

            // A declaration init clause (`for (int i = 0; …)`) belongs to the local variable:
            // its initializer is already extracted as LOCAL_VAR_INITIALIZER, and re-reading it
            // here would duplicate the row under a second context.
            if (fieldName === 'init' && clause.type === 'local_variable_declaration') continue;

            const clauseExprs = this.expressionExtractor.extractFromConditionExpression(
              clause,
              typeRegistryHash,
              ownerHash,
              ExpressionOwnerKind.FOR_STATEMENT,
              fieldName === 'init' ? RootContext.FOR_INIT : RootContext.FOR_UPDATE,
              packageName,
              importMap,
              hasStarImports,
              methodParamNames,
              localVariableNames,
              currentLambdaParams
            );
            expressions.push(...clauseExprs);
            this.collectExpressionExtractorResults();
          }

          traverse(child, currentLambdaParams, insideLambda, currentBlockHash);
          continue;
        }

        // ENHANCED FOR - iterable expression
        if (child.type === 'enhanced_for_statement') {
          const value = child.childForFieldName('value');
          if (value) {
            const body = child.childForFieldName('body');
            let ownerHash = currentBlockHash;
            if (body) {
              ownerHash = BlockRegistry.computeHash(
                BlockKind.ENHANCED_FOR, filePath,
                body.startPosition.row + 1, body.endPosition.row + 1,
                body.startPosition.column, body.endPosition.column,
                typeRegistryHash, methodHash
              );
            }
            const iterExprs = this.expressionExtractor.extractFromConditionExpression(
              value,
              typeRegistryHash,
              ownerHash,
              ExpressionOwnerKind.ENHANCED_FOR_STATEMENT,
              RootContext.ENHANCED_FOR_ITERABLE,
              packageName,
              importMap,
              hasStarImports,
              methodParamNames,
              localVariableNames,
              currentLambdaParams
            );
            expressions.push(...iterExprs);
            this.collectExpressionExtractorResults();
          }
          traverse(child, currentLambdaParams, insideLambda, currentBlockHash);
          continue;
        }

        // SYNCHRONIZED - lock expression
        if (child.type === 'synchronized_statement') {
          // The lock expression is in parentheses after 'synchronized'
          const parenExpr = child.children.find(c => c.type === 'parenthesized_expression');
          if (parenExpr) {
            const body = child.childForFieldName('body');
            let ownerHash = currentBlockHash;
            if (body) {
              ownerHash = BlockRegistry.computeHash(
                BlockKind.SYNCHRONIZED, filePath,
                body.startPosition.row + 1, body.endPosition.row + 1,
                body.startPosition.column, body.endPosition.column,
                typeRegistryHash, methodHash
              );
            }
            const lockExprs = this.expressionExtractor.extractFromConditionExpression(
              parenExpr,
              typeRegistryHash,
              ownerHash,
              ExpressionOwnerKind.SYNCHRONIZED_STATEMENT,
              RootContext.SYNCHRONIZED_LOCK,
              packageName,
              importMap,
              hasStarImports,
              methodParamNames,
              localVariableNames,
              currentLambdaParams
            );
            expressions.push(...lockExprs);
            this.collectExpressionExtractorResults();
          }
          traverse(child, currentLambdaParams, insideLambda, currentBlockHash);
          continue;
        }

        // SWITCH statement - selector expression + case labels
        // Only extract for statement switches (parent is a block-level container).
        // Expression switches (in local var initializers, return statements, etc.)
        // have their selector/labels extracted by the expression-reference-extractor.
        if (child.type === 'switch_expression' || child.type === 'switch_statement') {
          const parentType = child.parent?.type;
          const isStatementSwitch = !parentType ||
            parentType === 'block' ||
            parentType === 'constructor_body' ||
            parentType === 'switch_block_statement_group' ||
            parentType === 'labeled_statement';

          if (isStatementSwitch) {
            // Extract selector expression (e.g., 'value' in 'switch (value)')
            const condition = child.childForFieldName('condition');
            if (condition) {
              const condExprs = this.expressionExtractor.extractFromConditionExpression(
                condition,
                typeRegistryHash,
                currentBlockHash,
                ExpressionOwnerKind.SWITCH_STATEMENT,
                RootContext.SWITCH_SELECTOR,
                packageName,
                importMap,
                hasStarImports,
                methodParamNames,
                localVariableNames,
                currentLambdaParams
              );
              expressions.push(...condExprs);
              this.collectExpressionExtractorResults();
            }

            // Extract case label constants, linked to their SWITCH_CASE block hash
            const switchBlock = child.childForFieldName('body');
            if (switchBlock) {
              for (const caseChild of switchBlock.namedChildren) {
                let caseBlockHash = currentBlockHash;

                if (caseChild.type === 'switch_block_statement_group') {
                  // Colon syntax: use group node position for SWITCH_CASE hash
                  if (!insideLambda) {
                    caseBlockHash = BlockRegistry.computeHash(
                      BlockKind.SWITCH_CASE, filePath,
                      caseChild.startPosition.row + 1, caseChild.endPosition.row + 1,
                      caseChild.startPosition.column, caseChild.endPosition.column,
                      typeRegistryHash, methodHash
                    );
                  }
                } else if (caseChild.type === 'switch_rule') {
                  // Arrow syntax: use block child position for SWITCH_EXPRESSION_CASE hash
                  if (!insideLambda) {
                    const ruleBlock = caseChild.children.find(c => c.type === 'block');
                    if (ruleBlock) {
                      caseBlockHash = BlockRegistry.computeHash(
                        BlockKind.SWITCH_EXPRESSION_CASE, filePath,
                        ruleBlock.startPosition.row + 1, ruleBlock.endPosition.row + 1,
                        ruleBlock.startPosition.column, ruleBlock.endPosition.column,
                        typeRegistryHash, methodHash
                      );
                    }
                  }
                } else {
                  continue;
                }

                // Find switch_label(s) in this case and extract each label constant
                for (const labelOrStmt of caseChild.children) {
                  if (labelOrStmt.type !== 'switch_label') continue;

                  // Handle default case (no named children, just "default" keyword)
                  if (labelOrStmt.namedChildren.length === 0 && labelOrStmt.text.includes('default')) {
                    const defaultKeyword = labelOrStmt.children.find(c => c.type === 'default');
                    if (defaultKeyword) {
                      const builder = ExpressionReference.builder(
                        typeRegistryHash,
                        caseBlockHash,
                        ExpressionOwnerKind.SWITCH_STATEMENT,
                        RootContext.SWITCH_CASE_LABEL,
                        ExpressionKind.IDENTIFIER_REFERENCE,
                        EdgeRole.ROOT
                      );
                      builder.positionAndDepth(0, 0);
                      builder.classLiteralTypeName('default');
                      builder.location(
                        defaultKeyword.startPosition.row + 1,
                        defaultKeyword.startPosition.column,
                        defaultKeyword.endPosition.row + 1,
                        defaultKeyword.endPosition.column
                      );
                      expressions.push(builder.build());
                    }
                    continue;
                  }

                  for (const labelChild of labelOrStmt.namedChildren) {
                    if (labelChild.type === 'guard') continue; // skip 'when' clauses
                    const labelExprs = this.expressionExtractor.extractFromConditionExpression(
                      labelChild,
                      typeRegistryHash,
                      caseBlockHash,
                      ExpressionOwnerKind.SWITCH_STATEMENT,
                      RootContext.SWITCH_CASE_LABEL,
                      packageName,
                      importMap,
                      hasStarImports,
                      methodParamNames,
                      localVariableNames,
                      currentLambdaParams
                    );
                    expressions.push(...labelExprs);
                    this.collectExpressionExtractorResults();
                  }
                }
              }
            }
          }
          traverse(child, currentLambdaParams, insideLambda, currentBlockHash);
          continue;
        }

        // Recurse into other nodes
        traverse(child, currentLambdaParams, insideLambda, currentBlockHash);
      }
    };

    traverse(bodyBlock, new Set(), false, methodHash);
    return expressions;
  }
  
  /**
   * Extracts TypeReference entries for a method's return type
   */
  private extractReturnTypeReferences(
    methodNode: Parser.SyntaxNode,
    methodHash: string,
    typeRegistryHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string>
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    // Find the return type node
    // For method_declaration, the type comes before the method name
    // For constructor_declaration and compact_constructor_declaration, there is no return type
    if (methodNode.type === 'constructor_declaration' || 
        methodNode.type === 'compact_constructor_declaration') {
      return references; // Constructors don't have return types
    }
    
    // Find the type node (return type)
    let returnTypeNode: Parser.SyntaxNode | null = null;
    for (const child of methodNode.children) {
      // The return type is typically before the identifier (method name)
      // It can be: void, primitive, class type, generic type, array type, etc.
      if (child.type === 'void_type' || 
          child.type === 'integral_type' ||
          child.type === 'floating_point_type' ||
          child.type === 'boolean_type' ||
          child.type === 'type_identifier' ||
          child.type === 'generic_type' ||
          child.type === 'array_type' ||
          child.type === 'scoped_type_identifier') {
        returnTypeNode = child;
        break;
      }
    }
    
    if (!returnTypeNode) {
      return references;
    }
    
    // Use TypeReferenceExtractor to extract the return type and any nested types (including void)
    const returnTypeRefs = this.typeReferenceExtractor.extractFromMethodReturnType(
      returnTypeNode,
      typeRegistryHash,
      methodHash,
      packageName,
      declaredTypeParams
    );
    
    references.push(...returnTypeRefs);
    return references;
  }

  /**
   * Extracts class-level type parameter names (e.g., <T, U> from class Foo<T, U>)
   */
  private extractClassTypeParameters(typeNode: Parser.SyntaxNode): Set<string> {
    const typeParams = new Set<string>();
    
    // Try to find type_parameters child
    for (const child of typeNode.children) {
      if (child.type === 'type_parameters') {
        // Extract all type parameter identifiers
        for (const paramChild of child.children) {
          if (paramChild.type === 'type_parameter') {
            // The first child is the type_identifier with the name
            const identifierNode = paramChild.children.find(c => c.type === 'type_identifier');
            if (identifierNode) {
              typeParams.add(identifierNode.text);
            }
          }
        }
      }
    }
    
    return typeParams;
  }

  /**
   * Extracts method-level type parameter names (e.g., <T, U> from <T, U> void foo())
   */
  private extractMethodTypeParameters(methodNode: Parser.SyntaxNode): Set<string> {
    const typeParams = new Set<string>();
    
    // Try to find type_parameters child
    for (const child of methodNode.children) {
      if (child.type === 'type_parameters') {
        // Extract all type parameter identifiers
        for (const paramChild of child.children) {
          if (paramChild.type === 'type_parameter') {
            // The first child is the type_identifier with the name
            const identifierNode = paramChild.children.find(c => c.type === 'type_identifier');
            if (identifierNode) {
              typeParams.add(identifierNode.text);
            }
          }
        }
      }
    }
    
    return typeParams;
  }

  /**
   * Finds the body node of a type declaration
   */
  private findTypeBody(typeNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
    for (const child of typeNode.children) {
      if (child.type === 'class_body' || 
          child.type === 'interface_body' ||
          child.type === 'enum_body' ||
          child.type === 'annotation_type_body' ||
          child.type === 'record_declaration') {
        return child;
      }
    }
    return null;
  }

  /**
   * Checks if a node represents a method declaration (including constructors and annotation elements)
   */
  private isMethodDeclaration(node: Parser.SyntaxNode): boolean {
    return [
      'method_declaration',
      'constructor_declaration',
      'compact_constructor_declaration',
      'annotation_type_element_declaration',
    ].includes(node.type);
  }

  /**
   * Checks if a node is an initializer block
   */
  private isInitializerBlock(node: Parser.SyntaxNode): boolean {
    if (node.type === 'static_initializer') return true;
    // Instance initializer is just a block in class body
    if (node.type === 'block') {
      // Check if it's a direct child of class_body (not in a method)
      return node.parent?.type === 'class_body';
    }
    return false;
  }

  /**
   * Generates an enum constant hash for linking methods to their owning enum constant.
   * Uses the same hash generation logic as EnumConstant entity.
   */
  private generateEnumConstantHash(
    enumConstantNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string
  ): string {
    // Extract the constant name from the identifier child
    const identifierNode = enumConstantNode.children.find(child => child.type === 'identifier');
    const name = identifierNode?.text || '';
    
    // Count ordinal by finding position among sibling enum constants
    let ordinal = 0;
    if (enumConstantNode.parent) {
      for (const sibling of enumConstantNode.parent.children) {
        if (sibling === enumConstantNode) break;
        if (sibling.type === 'enum_constant') ordinal++;
      }
    }
    
    const startLine = enumConstantNode.startPosition.row + 1;
    const endLine = enumConstantNode.endPosition.row + 1;
    
    const content =
      filePath +
      '||' +
      typeRegistryHash +
      '||' +
      name +
      '||' +
      ordinal +
      '||' +
      startLine +
      '||' +
      endLine;

    return EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.ENUM_CONSTANT,
      content
    );
  }

  /**
   * Creates a MethodRegistry instance from a method declaration node
   */
  private createMethodRegistry(
    node: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    isInEnumConstantBody: boolean = false,
    enclosingMemberLinkHash?: string
  ): MethodRegistry | null {
    const name = this.extractMethodName(node);
    if (!name) return null;

    const methodKind = this.determineMethodKind(node, isInEnumConstantBody);
    const methodAccess = this.extractMethodAccess(node, methodKind);
    const signature = this.buildSignature(node, name);
    const detailedSignature = this.buildDetailedSignature(node, name);
    const qualifiedName = `${ownerQualifiedName}.${name}`;
    
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // Extract all optional fields
    const modifiers = this.extractMethodModifiers(node);
    const returnType = this.extractReturnType(node) ?? undefined;
    const hasVarArgs = this.hasVarArgs(node);
    const hasReceiver = this.hasReceiverParameter(node);
    const paramCount = this.countParameters(node);
    const hasTypeParams = this.hasTypeParameters(node);
    const hasThrows = this.hasThrowsClause(node);
    
    let defaultValue: string | undefined;
    if (node.type === 'annotation_type_element_declaration') {
      const extracted = this.extractDefaultValue(node);
      defaultValue = extracted ?? undefined;
    }

    return new MethodRegistry(
      name,
      signature,
      detailedSignature,
      qualifiedName,
      filePath,
      startLine,
      endLine,
      typeRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      methodAccess,
      methodKind,
      serviceVersionHash,
      paramCount,
      hasVarArgs,
      hasReceiver,
      hasTypeParams,
      hasThrows,
      modifiers,
      returnType,
      defaultValue,
      enclosingMemberLinkHash
    );
  }

  /**
   * Creates a MethodRegistry for initializer blocks
   */
  private createInitializerMethod(
    node: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string
  ): MethodRegistry | null {
    const isStatic = node.type === 'static_initializer';
    const methodKind = isStatic ? MethodKind.STATIC_INITIALIZER : MethodKind.INSTANCE_INITIALIZER;
    const name = isStatic ? '<clinit>' : '<init_block>';
    const signature = `${name}():void`;
    const qualifiedName = `${ownerQualifiedName}.${name}`;
    
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    return new MethodRegistry(
      name,
      signature,
      signature, // detailedSignature same as signature for initializers
      qualifiedName,
      filePath,
      startLine,
      endLine,
      typeRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      MethodAccess.PACKAGE, // Initializers have no explicit access modifier
      methodKind,
      serviceVersionHash,
      0, // parameterCount
      false, // isVarArgs
      false, // hasReceiverParameter
      false, // hasTypeParameters
      false, // throwsExceptions
      undefined, // methodModifier
      'void', // returnTypeName
      undefined // defaultValueExpression
    );
  }

  /**
   * Processes the canonical constructor for a record declaration.
   * 
   * Records in Java have an implicit canonical constructor that takes all record components
   * as parameters. This method creates a MethodRegistry for that constructor and extracts
   * the record components as MethodParameters.
   * 
   * Example: `record Point(int x, int y)` creates a canonical constructor `Point(int, int)`
   */
  private processRecordCanonicalConstructor(
    recordNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    classTypeParams: Set<string>,
    methods: MethodRegistry[]
  ): void {
    // Find formal_parameters (record components) directly on record_declaration
    let formalParamsNode: Parser.SyntaxNode | null = null;
    for (const child of recordNode.children) {
      if (child.type === 'formal_parameters') {
        formalParamsNode = child;
        break;
      }
    }

    // JLS 8.10.4: a record has exactly ONE canonical constructor, and it is implicitly declared
    // only when the record declares neither an explicit canonical constructor nor a compact one.
    // Synthesising unconditionally produced a second constructor row for the one real constructor.
    if (this.declaresCanonicalConstructor(recordNode, formalParamsNode)) {
      return;
    }

    // Create the canonical constructor MethodRegistry
    const method = this.createRecordCanonicalConstructor(
      recordNode,
      formalParamsNode,
      filePath,
      typeRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      serviceVersionHash
    );

    if (method) {
      methods.push(method);

      // Extract annotations from the canonical constructor (from record modifiers)
      this.annotationExtractor.resetExtractedArguments();
      // Note: Record-level annotations are handled by the type extractor, not here
      
      // Extract parameters from record components
      if (formalParamsNode) {
        const parameters = this.extractRecordComponentParameters(
          formalParamsNode,
          method.getHash(),
          typeRegistryHash,
          packageName,
          importMap,
          hasStarImports,
          classTypeParams
        );
        this.extractedMethodParameters.push(...parameters);
        
        // Collect annotations from parameters
        const paramAnnotations = this.methodParameterExtractor.getExtractedAnnotations();
        this.extractedAnnotations.push(...paramAnnotations);
        
        // Collect annotation arguments from parameter annotations
        const paramAnnotationArgs = this.methodParameterExtractor.getExtractedAnnotationArguments();
        this.extractedAnnotationArguments.push(...paramAnnotationArgs);
        
        // Collect type references from parameters
        const paramTypeRefs = this.methodParameterExtractor.getExtractedTypeReferences();
        this.extractedTypeReferences.push(...paramTypeRefs);
      }
    }
  }

  /**
   * True when the record declares its canonical constructor itself, in either form.
   *
   * A compact constructor always IS the canonical constructor. An explicit constructor is the
   * canonical one when its parameter types match the record's component types (JLS 8.10.4) -
   * parameter NAMES need not match, so only the types are compared. Any other constructor is a
   * non-canonical one that delegates via this(...), and does not suppress the implicit member.
   */
  private declaresCanonicalConstructor(
    recordNode: Parser.SyntaxNode,
    formalParamsNode: Parser.SyntaxNode | null
  ): boolean {
    const body = this.findTypeBody(recordNode);
    if (!body) return false;

    const componentTypes = this.recordComponentTypes(formalParamsNode);

    for (const child of body.children) {
      if (child.type === 'compact_constructor_declaration') {
        return true;
      }
      if (child.type === 'constructor_declaration') {
        const params = this.findFormalParameters(child);
        const paramTypes = this.recordComponentTypes(params);
        if (paramTypes.length === componentTypes.length &&
            paramTypes.every((t, i) => t === componentTypes[i])) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * The erased type text of each entry in a formal_parameters node, in declaration order.
   */
  private recordComponentTypes(formalParamsNode: Parser.SyntaxNode | null): string[] {
    if (!formalParamsNode) return [];

    const types: string[] = [];
    for (const child of formalParamsNode.children) {
      if (child.type === 'formal_parameter' || child.type === 'spread_parameter') {
        const t = this.extractParameterType(child, false);
        if (t) types.push(t);
      }
    }
    return types;
  }

  /**
   * Synthesises the members JLS 8.10.3 declares implicitly on a record: one accessor per
   * component, plus equals/hashCode/toString.
   *
   * javac declares each of these only if the record does not declare it, so this mirrors that
   * rule against the members already extracted from the body. `alreadyDeclared` therefore reads
   * the real declarations rather than a second scan of the tree.
   */
  private synthesizeRecordImplicitMembers(
    recordNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    methods: MethodRegistry[]
  ): void {
    let formalParamsNode: Parser.SyntaxNode | null = null;
    for (const child of recordNode.children) {
      if (child.type === 'formal_parameters') {
        formalParamsNode = child;
        break;
      }
    }

    // Names of members the record declares itself, keyed name/arity.
    const declared = new Set(
      methods
        .filter(m => m.getTypeRegistryLinkHash() === typeRegistryHash)
        .map(m => `${m.getName()}/${m.getParameterCount()}`)
    );

    const recordLine = recordNode.startPosition.row + 1;

    // One accessor per component.
    if (formalParamsNode) {
      for (const child of formalParamsNode.children) {
        if (child.type !== 'formal_parameter' && child.type !== 'spread_parameter') continue;

        const componentName = this.extractParameterName(child);
        if (!componentName || declared.has(`${componentName}/0`)) continue;

        // The accessor returns the component's declared type. For a varargs component the
        // component type is the array type, which extractParameterTypeNameFull already yields.
        const componentType = this.extractParameterTypeNameFull(child);
        if (!componentType) continue;
        const returnType = child.type === 'spread_parameter' ? `${componentType}[]` : componentType;

        methods.push(this.createImplicitMethod(
          componentName, returnType, [], MethodKind.RECORD_ACCESSOR, MethodAccess.PUBLIC,
          filePath, child.startPosition.row + 1, typeRegistryHash,
          ownerTypeName, ownerQualifiedName, serviceVersionHash
        ));
      }
    }

    // equals / hashCode / toString.
    const objectMethods: Array<[string, string, string[], MethodKind]> = [
      ['equals', 'boolean', ['Object'], MethodKind.RECORD_EQUALS],
      ['hashCode', 'int', [], MethodKind.RECORD_HASH_CODE],
      ['toString', 'String', [], MethodKind.RECORD_TO_STRING],
    ];

    for (const [name, returnType, paramTypes, kind] of objectMethods) {
      if (declared.has(`${name}/${paramTypes.length}`)) continue;

      const method = this.createImplicitMethod(
        name, returnType, paramTypes, kind, MethodAccess.PUBLIC,
        filePath, recordLine, typeRegistryHash,
        ownerTypeName, ownerQualifiedName, serviceVersionHash
      );
      methods.push(method);

      // Keep parameterCount and the emitted parameter rows in agreement.
      paramTypes.forEach((paramType, index) => {
        this.extractedMethodParameters.push(new MethodParameter(
          'o', index, method.getHash(), paramType, paramType,
          `java.lang.${paramType}`, false, false, false, false,
          recordLine, recordLine
        ));
      });
    }
  }

  /**
   * Builds one implicitly declared member. These have no declaration node, so position is the
   * construct that induces them - the component for a record accessor, the type header otherwise.
   *
   * None of them can be generic, varargs, or declare a throws clause, so those flags are fixed.
   */
  private createImplicitMethod(
    name: string,
    returnType: string,
    paramTypes: string[],
    methodKind: MethodKind,
    methodAccess: MethodAccess,
    filePath: string,
    line: number,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    methodModifier?: MethodModifier
  ): MethodRegistry {
    const signature = `${name}(${paramTypes.join(',')}):${returnType}`;
    return new MethodRegistry(
      name,
      signature,
      signature,
      `${ownerQualifiedName}.${name}`,
      filePath,
      line,
      line,
      typeRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      methodAccess,
      methodKind,
      serviceVersionHash,
      paramTypes.length,
      false, // isVarArgs
      false, // hasReceiverParameter
      false, // hasTypeParameters
      false, // throwsExceptions
      methodModifier,
      returnType
    );
  }

  /**
   * Synthesises the members JLS 8.9 declares implicitly on an enum: `values()`, `valueOf(String)`
   * and, when the enum declares no constructor, a private default constructor.
   *
   * `values()` and `valueOf(String)` differ from a record's implicit members in that they can
   * never be written by hand - declaring either in an enum body is a compile error - so they are
   * unconditional. The declared-member check is kept anyway so that source which does not compile
   * cannot produce two rows for one name.
   *
   * The compiler artifacts `$VALUES` and `$values()` are deliberately NOT emitted: they are
   * class-file implementation details, not members the language declares.
   */
  private synthesizeEnumImplicitMembers(
    enumNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    methods: MethodRegistry[]
  ): void {
    const declared = this.declaredMemberKeys(methods, typeRegistryHash);
    const line = enumNode.startPosition.row + 1;

    if (!declared.has('values/0')) {
      methods.push(this.createImplicitMethod(
        'values', `${ownerTypeName}[]`, [], MethodKind.ENUM_VALUES, MethodAccess.PUBLIC,
        filePath, line, typeRegistryHash, ownerTypeName, ownerQualifiedName, serviceVersionHash,
        MethodModifier.STATIC_MODIFIER
      ));
    }

    if (!declared.has('valueOf/1')) {
      const valueOf = this.createImplicitMethod(
        'valueOf', ownerTypeName, ['String'], MethodKind.ENUM_VALUE_OF, MethodAccess.PUBLIC,
        filePath, line, typeRegistryHash, ownerTypeName, ownerQualifiedName, serviceVersionHash,
        MethodModifier.STATIC_MODIFIER
      );
      methods.push(valueOf);
      this.extractedMethodParameters.push(new MethodParameter(
        'name', 0, valueOf.getHash(), 'String', 'String',
        'java.lang.String', false, false, false, false, line, line
      ));
    }

    // JLS 8.9.2: an enum with no declared constructor gets a private one.
    if (!this.declaresAnyConstructor(enumNode)) {
      methods.push(this.createImplicitMethod(
        ownerTypeName, 'void', [], MethodKind.DEFAULT_CONSTRUCTOR, MethodAccess.PRIVATE,
        filePath, line, typeRegistryHash, ownerTypeName, ownerQualifiedName, serviceVersionHash
      ));
    }
  }

  /**
   * Synthesises the default constructor JLS 8.8.9 declares on a class that declares none.
   *
   * The default constructor takes the access of the class itself, so a package-private class does
   * not get a public constructor. Interfaces and annotation types are excluded because they have
   * no constructors at all; records and enums are handled by their own rules.
   *
   * Anonymous classes are deliberately excluded, and this is a known gap rather than an
   * oversight. JLS 15.9.5.1 does declare an anonymous constructor implicitly, and javac emits it
   * without ACC_SYNTHETIC - but its parameter list is chosen by the compiler, not written in the
   * source: it carries the enclosing instance and every captured local, neither of which is
   * recoverable here. Emitting a guessed signature would be worse than emitting nothing, because
   * a wrong arity resolves to the wrong constructor rather than to none. An anonymous class is
   * reached through its OBJECT_CREATION expression regardless, so nothing else keys on this.
   */
  private synthesizeDefaultConstructor(
    classNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    methods: MethodRegistry[]
  ): void {
    if (this.declaresAnyConstructor(classNode)) return;

    methods.push(this.createImplicitMethod(
      ownerTypeName, 'void', [], MethodKind.DEFAULT_CONSTRUCTOR,
      this.extractRecordAccess(classNode), // same rule: the type's own access modifier
      filePath, classNode.startPosition.row + 1, typeRegistryHash,
      ownerTypeName, ownerQualifiedName, serviceVersionHash
    ));
  }

  /**
   * True when the type body declares a constructor in any form.
   *
   * An enum body holds its members one level down, under `enum_body_declarations`, after the
   * constant list - so a direct-children scan would miss an enum's constructor and wrongly
   * conclude the default one is implicitly declared.
   */
  private declaresAnyConstructor(typeNode: Parser.SyntaxNode): boolean {
    const body = this.findTypeBody(typeNode);
    if (!body) return false;

    const isConstructor = (node: Parser.SyntaxNode) =>
      node.type === 'constructor_declaration' || node.type === 'compact_constructor_declaration';

    for (const child of body.children) {
      if (isConstructor(child)) return true;
      if (child.type === 'enum_body_declarations' && child.children.some(isConstructor)) {
        return true;
      }
    }
    return false;
  }

  /**
   * The name/arity keys of the members already extracted for this type.
   */
  private declaredMemberKeys(methods: MethodRegistry[], typeRegistryHash: string): Set<string> {
    return new Set(
      methods
        .filter(m => m.getTypeRegistryLinkHash() === typeRegistryHash)
        .map(m => `${m.getName()}/${m.getParameterCount()}`)
    );
  }

  /**
   * Creates a MethodRegistry for a record's canonical constructor.
   */
  private createRecordCanonicalConstructor(
    recordNode: Parser.SyntaxNode,
    formalParamsNode: Parser.SyntaxNode | null,
    filePath: string,
    typeRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string
  ): MethodRegistry | null {
    // Record constructor name is the record name
    const name = ownerTypeName;
    
    // Build signature from record components
    const signature = this.buildRecordConstructorSignature(formalParamsNode, name);
    const detailedSignature = this.buildRecordConstructorDetailedSignature(formalParamsNode, name);
    const qualifiedName = `${ownerQualifiedName}.${name}`;
    
    // Use the record declaration's position
    const startLine = recordNode.startPosition.row + 1;
    const endLine = recordNode.startPosition.row + 1; // Constructor is implicit, use record line

    // Count parameters from record components
    const paramCount = this.countRecordComponents(formalParamsNode);
    const hasVarArgs = this.hasRecordVarArgs(formalParamsNode);

    // Extract access modifier from record declaration
    const recordAccess = this.extractRecordAccess(recordNode);

    return new MethodRegistry(
      name,
      signature,
      detailedSignature,
      qualifiedName,
      filePath,
      startLine,
      endLine,
      typeRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      recordAccess, // Canonical constructor has same access as record
      MethodKind.CONSTRUCTOR, // Canonical constructor is a regular constructor
      serviceVersionHash,
      paramCount,
      hasVarArgs,
      false, // hasReceiverParameter - records don't have receiver params
      false, // hasTypeParameters - canonical constructor doesn't have its own type params
      false, // throwsExceptions - canonical constructor doesn't throw
      undefined, // methodModifier
      undefined, // returnTypeName - constructors have no return type
      undefined // defaultValueExpression
    );
  }

  /**
   * Builds the canonical signature for a record constructor
   */
  private buildRecordConstructorSignature(formalParamsNode: Parser.SyntaxNode | null, name: string): string {
    if (!formalParamsNode) {
      return `${name}():void`;
    }

    const params: string[] = [];
    for (const child of formalParamsNode.children) {
      if (child.type === 'formal_parameter' || child.type === 'spread_parameter') {
        const paramType = this.extractParameterType(child, false);
        if (paramType) {
          params.push(paramType);
        }
      }
    }

    return `${name}(${params.join(',')}):void`;
  }

  /**
   * Builds the detailed signature for a record constructor (with full type info and names)
   */
  private buildRecordConstructorDetailedSignature(formalParamsNode: Parser.SyntaxNode | null, name: string): string {
    if (!formalParamsNode) {
      return `${name}():void`;
    }

    const params: string[] = [];
    for (const child of formalParamsNode.children) {
      if (child.type === 'formal_parameter' || child.type === 'spread_parameter') {
        const paramType = this.extractParameterTypeNameFull(child);
        const paramName = this.extractParameterName(child);
        
        if (paramType && paramName) {
          let finalType = paramType;
          if (child.type === 'spread_parameter') {
            finalType = paramType + '...';
          }
          params.push(`${finalType} ${paramName}`);
        }
      }
    }

    return `${name}(${params.join(', ')}):void`;
  }

  /**
   * Counts the number of record components
   */
  private countRecordComponents(formalParamsNode: Parser.SyntaxNode | null): number {
    if (!formalParamsNode) return 0;

    let count = 0;
    for (const child of formalParamsNode.children) {
      if (child.type === 'formal_parameter' || child.type === 'spread_parameter') {
        count++;
      }
    }
    return count;
  }

  /**
   * Checks if record has varargs component
   */
  private hasRecordVarArgs(formalParamsNode: Parser.SyntaxNode | null): boolean {
    if (!formalParamsNode) return false;

    for (const child of formalParamsNode.children) {
      if (child.type === 'spread_parameter') {
        return true;
      }
    }
    return false;
  }

  /**
   * Extracts access modifier from record declaration
   */
  private extractRecordAccess(recordNode: Parser.SyntaxNode): MethodAccess {
    const modifiers = this.getModifierList(recordNode);

    if (modifiers.includes('public')) return MethodAccess.PUBLIC;
    if (modifiers.includes('private')) return MethodAccess.PRIVATE;
    if (modifiers.includes('protected')) return MethodAccess.PROTECTED;

    return MethodAccess.PACKAGE;
  }

  /**
   * Extracts method parameters from record components (formal_parameters node on record_declaration)
   */
  private extractRecordComponentParameters(
    formalParamsNode: Parser.SyntaxNode,
    methodRegistryHash: string,
    typeRegistryHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    declaredTypeParams: Set<string>
  ): MethodParameter[] {
    // Use the existing MethodParameterExtractor but pass the record's formal_parameters node
    // We create a synthetic "method node" wrapper that contains the formal_parameters
    // Actually, we can directly use extractFromMethod since it looks for formal_parameters child
    
    // Create a wrapper object that mimics a method node with children containing formal_parameters
    const syntheticMethodNode = {
      children: [formalParamsNode],
      type: 'constructor_declaration'
    } as unknown as Parser.SyntaxNode;
    
    return this.methodParameterExtractor.extractFromMethod(
      syntheticMethodNode,
      methodRegistryHash,
      typeRegistryHash,
      packageName,
      importMap,
      hasStarImports,
      declaredTypeParams,
      this.annotationExtractor
    );
  }

  /**
   * Determines the MethodKind based on AST node type and modifiers
   */
  private determineMethodKind(node: Parser.SyntaxNode, isInEnumConstantBody: boolean = false): MethodKind {
    // 1. Special AST node types (highest priority)
    if (node.type === 'constructor_declaration') return MethodKind.CONSTRUCTOR;
    if (node.type === 'compact_constructor_declaration') return MethodKind.COMPACT_CONSTRUCTOR;
    if (node.type === 'annotation_type_element_declaration') return MethodKind.ANNOTATION_ELEMENT;

    // 2. Check if this is a method in an enum constant's anonymous class body
    if (isInEnumConstantBody) return MethodKind.ENUM_CONSTANT_METHOD;

    // 3. Check for abstract (no method body) - BUT NOT if native!
    const hasBody = this.hasMethodBody(node);
    const modifiers = this.getModifierList(node);
    const isNative = modifiers.includes('native');
    
    if (!hasBody && !isNative) return MethodKind.ABSTRACT_METHOD;

    // 4. Check for default modifier (interface default methods)
    if (modifiers.includes('default')) return MethodKind.DEFAULT_METHOD;

    // 5. Check for static modifier
    if (modifiers.includes('static')) return MethodKind.STATIC_METHOD;

    // 6. Fallback: instance method
    return MethodKind.INSTANCE_METHOD;
  }

  /**
   * Extracts method access level
   */
  private extractMethodAccess(node: Parser.SyntaxNode, methodKind: MethodKind): MethodAccess {
    const modifiers = this.getModifierList(node);

    if (modifiers.includes('public')) return MethodAccess.PUBLIC;
    if (modifiers.includes('private')) return MethodAccess.PRIVATE;
    if (modifiers.includes('protected')) return MethodAccess.PROTECTED;

    // Handle implicit access modifiers
    if (methodKind === MethodKind.ANNOTATION_ELEMENT) {
      return MethodAccess.PUBLIC; // Annotation elements are always public
    }

    // Check if in interface
    if (this.isInInterface(node)) {
      return MethodAccess.PUBLIC; // Interface methods default to public
    }

    // Check if enum constructor
    if (methodKind === MethodKind.CONSTRUCTOR && this.isInEnum(node)) {
      return MethodAccess.PRIVATE; // Enum constructors are always private
    }

    return MethodAccess.PACKAGE; // Default: package-private
  }

  /**
   * Extracts method modifiers as comma-separated string
   */
  private extractMethodModifiers(node: Parser.SyntaxNode): string | undefined {
    const modifiers = this.getModifierList(node);
    const methodModifiers: string[] = [];

    if (modifiers.includes('static')) methodModifiers.push(MethodModifier.STATIC_MODIFIER);
    if (modifiers.includes('abstract')) methodModifiers.push(MethodModifier.ABSTRACT_MODIFIER);
    if (modifiers.includes('final')) methodModifiers.push(MethodModifier.FINAL_MODIFIER);
    if (modifiers.includes('synchronized')) methodModifiers.push(MethodModifier.SYNCHRONIZED_MODIFIER);
    if (modifiers.includes('native')) methodModifiers.push(MethodModifier.NATIVE_MODIFIER);
    if (modifiers.includes('strictfp')) methodModifiers.push(MethodModifier.STRICTFP_MODIFIER);
    if (modifiers.includes('default')) methodModifiers.push(MethodModifier.DEFAULT_MODIFIER);

    return methodModifiers.length > 0 ? methodModifiers.join(',') : undefined;
  }

  /**
   * Gets list of modifier keywords from node
   */
  private getModifierList(node: Parser.SyntaxNode): string[] {
    const modifiers: string[] = [];
    
    for (const child of node.children) {
      if (child.type === 'modifiers') {
        for (const modifier of child.children) {
          if (modifier.text) {
            modifiers.push(modifier.text);
          }
        }
      }
    }
    
    return modifiers;
  }

  /**
   * Extracts method name
   */
  private extractMethodName(node: Parser.SyntaxNode): string | null {
    for (const child of node.children) {
      if (child.type === 'identifier') {
        return child.text;
      }
    }
    return null;
  }

  /**
   * Extracts return type name
   */
  private extractReturnType(node: Parser.SyntaxNode): string | null {
    // Constructors have no return type
    if (node.type === 'constructor_declaration' || 
        node.type === 'compact_constructor_declaration') {
      return null;
    }

    for (const child of node.children) {
      if (child.type === 'void_type') {
        return 'void';
      }
      if (this.isTypeNode(child)) {
        return EntityUtils.normalizeWhitespace(child.text);
      }
    }
    return null;
  }

  /**
   * Checks if node represents a type
   */
  private isTypeNode(node: Parser.SyntaxNode): boolean {
    return [
      'type_identifier',
      'generic_type',
      'array_type',
      'integral_type',
      'floating_point_type',
      'boolean_type',
      'scoped_type_identifier',
    ].includes(node.type);
  }

  /**
   * Builds canonical signature (generics stripped, varargs normalized)
   */
  private buildSignature(node: Parser.SyntaxNode, methodName: string): string {
    const params = this.extractParameterTypesForSignature(node, false);
    const returnType = this.extractReturnType(node) || 'void';
    return `${methodName}(${params.join(',')}):${returnType}`;
  }

  /**
   * Builds detailed signature with full type information and parameter names
   * Example: "process(List<User> users, String... args):Map<String, Result>"
   * - Preserves generics: List<User>
   * - Preserves varargs: String...
   * - Includes parameter names: users, args
   */
  private buildDetailedSignature(node: Parser.SyntaxNode, methodName: string): string {
    const params = this.extractParametersWithNames(node);
    const returnType = this.extractReturnType(node) || 'void';
    return `${methodName}(${params.join(', ')}):${returnType}`;
  }

  /**
   * Extracts parameters with names for detailed signature (e.g., "String name, int age")
   */
  private extractParametersWithNames(node: Parser.SyntaxNode): string[] {
    const params: string[] = [];
    const formalParams = this.findFormalParameters(node);
    
    if (!formalParams) return params;

    for (const child of formalParams.children) {
      if (child.type === 'formal_parameter' || child.type === 'spread_parameter') {
        const paramType = this.extractParameterTypeNameFull(child);
        const paramName = this.extractParameterName(child);
        
        if (paramType && paramName) {
          // Handle varargs: add ... suffix for spread_parameter
          let finalType = paramType;
          if (child.type === 'spread_parameter') {
            // Type is already without [], just add ...
            finalType = paramType + '...';
          }
          params.push(`${finalType} ${paramName}`);
        }
      }
      // Skip receiver parameters in detailed signature
    }

    return params;
  }

  /**
   * Extracts parameter types for signature building
   */
  private extractParameterTypesForSignature(node: Parser.SyntaxNode, preserveGenerics: boolean): string[] {
    const params: string[] = [];
    const formalParams = this.findFormalParameters(node);
    
    if (!formalParams) return params;

    for (const child of formalParams.children) {
      if (child.type === 'formal_parameter' || child.type === 'spread_parameter') {
        const paramType = this.extractParameterType(child, preserveGenerics);
        if (paramType) {
          params.push(paramType);
        }
      }
    }

    return params;
  }

  /**
   * Extracts parameter type from formal_parameter node
   */
  private extractParameterType(paramNode: Parser.SyntaxNode, preserveGenerics: boolean): string | null {
    for (const child of paramNode.children) {
      if (this.isTypeNode(child)) {
        let typeText = EntityUtils.normalizeWhitespace(child.text);
        
        // Strip generics if not preserving
        if (!preserveGenerics && typeText.includes('<')) {
          typeText = typeText.substring(0, typeText.indexOf('<'));
        }
        
        return typeText;
      }
    }
    return null;
  }

  /**
   * Finds formal_parameters node.
   *
   * A compact constructor has no parameter list of its own, but it IS the record's canonical
   * constructor (JLS 8.10.4) and its parameters are the record's components. Reading them off
   * the enclosing record here keeps signature, detailedSignature, parameterCount and isVarArgs
   * consistent for every caller, instead of each reporting arity 0.
   */
  private findFormalParameters(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    const source = node.type === 'compact_constructor_declaration'
      ? this.findEnclosingRecord(node) ?? node
      : node;

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
   * Checks if method has a body
   */
  private hasMethodBody(node: Parser.SyntaxNode): boolean {
    for (const child of node.children) {
      if (child.type === 'block') {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if method has varargs parameters
   */
  private hasVarArgs(node: Parser.SyntaxNode): boolean {
    const formalParams = this.findFormalParameters(node);
    if (!formalParams) return false;

    for (const child of formalParams.children) {
      if (child.type === 'spread_parameter') {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if method has receiver parameter
   */
  private hasReceiverParameter(node: Parser.SyntaxNode): boolean {
    const formalParams = this.findFormalParameters(node);
    if (!formalParams) return false;

    for (const child of formalParams.children) {
      if (child.type === 'receiver_parameter') {
        return true;
      }
    }
    return false;
  }

  /**
   * Extracts default value for annotation elements
   */
  private extractDefaultValue(node: Parser.SyntaxNode): string | null {
    for (const child of node.children) {
      if (child.type === 'default_value') {
        // Get the value after 'default' keyword
        for (const valueChild of child.children) {
          if (valueChild.type !== 'default') {
            return valueChild.text;
          }
        }
      }
    }
    return null;
  }

  /**
   * Counts the number of parameters (excluding receiver parameters)
   */
  private countParameters(node: Parser.SyntaxNode): number {
    const formalParams = this.findFormalParameters(node);
    if (!formalParams) return 0;

    let count = 0;
    for (const child of formalParams.children) {
      if (child.type === 'formal_parameter' || child.type === 'spread_parameter') {
        count++;
      }
      // Exclude receiver_parameter from count
    }
    return count;
  }

  /**
   * Checks if method has type parameters
   */
  private hasTypeParameters(node: Parser.SyntaxNode): boolean {
    for (const child of node.children) {
      if (child.type === 'type_parameters') {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if method has throws clause
   */
  private hasThrowsClause(node: Parser.SyntaxNode): boolean {
    for (const child of node.children) {
      if (child.type === 'throws') {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if node is in an interface
   */
  private isInInterface(node: Parser.SyntaxNode): boolean {
    let current = node.parent;
    while (current) {
      if (current.type === 'interface_declaration' || current.type === 'annotation_type_declaration') {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  /**
   * Checks if node is in an enum
   */
  private isInEnum(node: Parser.SyntaxNode): boolean {
    let current = node.parent;
    while (current) {
      if (current.type === 'enum_declaration') {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  /**
   * Extracts parameter name (used for detailedSignature)
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
   * Extracts full parameter type name (preserving generics, used for detailedSignature)
   */
  private extractParameterTypeNameFull(paramNode: Parser.SyntaxNode): string | null {
    for (const child of paramNode.children) {
      if (this.isTypeNode(child)) {
        return EntityUtils.normalizeWhitespace(child.text);
      }
    }
    return null;
  }

}
