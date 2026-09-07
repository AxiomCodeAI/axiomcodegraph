import Parser from 'tree-sitter';

import { AnnotationArgumentReference } from '@/analysis-types/java/AnnotationArgumentReference';
import { BlockRegistry } from '@/analysis-types/java/BlockRegistry';
import { ExpressionReference } from '@/analysis-types/java/ExpressionReference';
import { LocalVariableRegistry } from '@/analysis-types/java/LocalVariableRegistry';
import { TypeAnnotation } from '@/analysis-types/java/TypeAnnotation';
import { TypeReference } from '@/analysis-types/java/TypeReference';
import { BlockKind } from '@/enums/java/blocks';
import { LocalVariableScopeKind } from '@/enums/java/local-variables';
import { AnnotationExtractor } from '@/parsers/java/extractors/annotation-extractor';
import { ExpressionReferenceExtractor, AnonymousClassInfo } from '@/parsers/java/extractors/expression-reference-extractor';
import { ScopeContext, extractLambdaParameterNames } from '@/parsers/java/extractors/scope-context';
import { TypeReferenceExtractor } from '@/parsers/java/extractors/type-reference-extractor';
import { EntityUtils } from '@/utils/entity-utils';
import { JavaTreeSitterUtils } from '@/utils/java/java-tree-sitter-utils';
import { resolveTypeQualifiedName } from '@/utils/java/type-resolution-utils';

/**
 * Extracts LocalVariableRegistry entities from Java method bodies using tree-sitter.
 *
 * Handles extraction of:
 * - Local variable declarations in method bodies
 * - Variables in lambda expressions (including nested lambdas)
 * - Variables in static/instance initializer blocks
 * - For loop and enhanced-for loop variables
 * - Try-with-resources variables
 * - Catch clause exception variables
 * - Pattern binding variables (instanceof, switch, record patterns)
 *
 * ## Tree-sitter Node Structure
 *
 * For a method like:
 * ```java
 * public void method() {
 *     int count = 10;              // local_variable_declaration
 *     final String name = "test";  // with final modifier
 *     var inferred = 42;           // var inference
 *     
 *     for (int i = 0; i < 10; i++) { ... }  // for_statement
 *     for (String item : items) { ... }     // enhanced_for_statement
 *     
 *     try (var reader = new FileReader(...)) { ... }  // try_with_resources
 *     catch (IOException e) { ... }                   // catch_clause
 *     
 *     Supplier<Integer> s = () -> {
 *         int lambdaVar = 5;       // nested in lambda
 *         return lambdaVar;
 *     };
 *     
 *     if (obj instanceof String s) { ... }  // instanceof pattern
 * }
 * ```
 */
export class LocalVariableExtractor {
  private expressionExtractor: ExpressionReferenceExtractor;
  private typeReferenceExtractor: TypeReferenceExtractor;
  private annotationExtractor: AnnotationExtractor;
  private extractedTypeReferences: TypeReference[] = [];
  private extractedExpressions: ExpressionReference[] = [];
  private extractedAnnotations: TypeAnnotation[] = [];
  private extractedAnnotationArguments: AnnotationArgumentReference[] = [];
  private extractedAnonymousClasses: AnonymousClassInfo[] = [];
  private extractedBlocks: BlockRegistry[] = [];
  
  // Unified scope context for tracking hierarchy (method → lambda → block)
  private scopeContext: ScopeContext = new ScopeContext();
  
  // Method parameter names for PARAMETER classification in expressions
  private currentMethodParamNames: Set<string> = new Set();
  // Local variable names seen so far for LOCAL_VARIABLE classification in expressions
  private currentLocalVariableNames: Set<string> = new Set();
  // Pattern binding variable names for PATTERN_BINDING_VARIABLE classification in expressions
  private currentPatternBindingNames: Set<string> = new Set();
  // Expressions for lambda hash lookup (separate from extractedExpressions to avoid duplicates)
  private expressionsForHashLookup: ExpressionReference[] = [];
  
  // When true, BlockRegistry entries are created in extractFrom*Statement methods.
  // True for method bodies (Phase 2) and field initializer lambdas.
  // False for static/instance initializers (no block extraction there).
  private shouldCreateBlockEntries: boolean = false;
  // When true, we're extracting from field initializer lambdas (no TypeMethodExtractor involvement).
  // Statements already extracted by extractLambdaBodyStatementExpressions, keyed by byte range.
  //
  // A brace-less control-flow body is reached twice: once as the body itself, and once through
  // the child loop's recursion that looks for nested lambdas. Extracting a statement is
  // idempotent here rather than relying on every caller knowing which path it is on, because
  // getting that wrong duplicates a call site rather than dropping one, and a duplicate is the
  // harder failure to notice.
  private extractedLambdaStatements: Set<string> = new Set();

  // Controls expression extraction bypass in extractLambdaBodyStatementExpressions.
  // Separate from shouldCreateBlockEntries which only controls block creation.
  private isFieldInitializerContext: boolean = false;
  // The hash to use for block hash computation (methodRegistryHash for methods, fieldHash for field lambdas)
  // Separate from methodRegistryHash parameter which is used for local variable method linkage
  private blockMethodHash: string = '';
  // Tracks actual block nesting depth for BlockRegistry entries.
  // Incremented when entering a block scope (for/if/try/etc), NOT for lambdas.
  private blockNestingDepth: number = 0;

  constructor() {
    this.expressionExtractor = new ExpressionReferenceExtractor();
    this.typeReferenceExtractor = new TypeReferenceExtractor();
    this.annotationExtractor = new AnnotationExtractor();
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
   * Returns all anonymous classes encountered during the last extraction
   */
  getExtractedAnonymousClasses(): AnonymousClassInfo[] {
    return this.extractedAnonymousClasses;
  }

  /**
   * Returns all blocks extracted during the last extraction (from field initializer lambdas)
   */
  getExtractedBlocks(): BlockRegistry[] {
    return this.extractedBlocks;
  }

  /**
   * Resets all extracted collections
   */
  resetExtractedCollections(): void {
    this.extractedTypeReferences = [];
    this.extractedExpressions = [];
    this.extractedAnnotations = [];
    this.extractedAnnotationArguments = [];
    this.extractedAnonymousClasses = [];
    this.extractedBlocks = [];
    this.blockNestingDepth = 0;
    this.extractedLambdaStatements.clear();
  }

  /**
   * Extracts local variables from a method body
   * @param methodParamNames Names of method parameters for PARAMETER classification in expressions
   * @param extractedExpressions Expressions extracted from method body for hash lookup
   */
  extractFromMethodBody(
    bodyNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    scopeKind: LocalVariableScopeKind = LocalVariableScopeKind.METHOD_BODY,
    methodParamNames: Set<string> = new Set(),
    extractedExpressions: ExpressionReference[] = []
  ): LocalVariableRegistry[] {
    this.resetExtractedCollections();
    this.shouldCreateBlockEntries = true;
    this.isFieldInitializerContext = false;
    this.blockMethodHash = methodRegistryHash;
    
    // Store extracted expressions for hash lookup (switch expressions, lambdas, etc.)
    this.expressionsForHashLookup = extractedExpressions;
    
    // Set method parameters for expression classification
    this.currentMethodParamNames = methodParamNames;
    // Reset local variable names - will be populated as we extract
    this.currentLocalVariableNames = new Set();
    
    const variables: LocalVariableRegistry[] = [];
    const lambdaDepth = scopeKind === LocalVariableScopeKind.LAMBDA_BODY ? 1 : 0;

    this.extractFromBlock(
      bodyNode,
      filePath,
      typeRegistryHash,
      methodRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      ownerMethodName,
      serviceVersionHash,
      packageName,
      importMap,
      hasStarImports,
      scopeKind,
      lambdaDepth,
      variables
    );

    return variables;
  }

  /**
   * Extracts local variables and return statements from lambda block bodies in field initializers
   * @param extractedExpressions Already extracted expressions from the field initializer (to find lambda hashes)
   */
  extractFromFieldInitializerLambdas(
    initializerNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    fieldHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    extractedExpressions: ExpressionReference[]
  ): LocalVariableRegistry[] {
    this.resetExtractedCollections();
    this.shouldCreateBlockEntries = true;
    this.isFieldInitializerContext = true;
    this.blockMethodHash = fieldHash;
    // Field initializer lambdas start at nesting depth 1 to match legacy lambdaDepth behavior
    // (method bodies start at 0; the lambda entry itself counts as one level for field initializers)
    this.blockNestingDepth = 1;
    
    // Store extracted expressions for lambda hash lookup (separate from extractedExpressions to avoid duplicates)
    this.expressionsForHashLookup = extractedExpressions;
    
    // Reset tracking sets
    this.currentMethodParamNames = new Set();
    this.currentLocalVariableNames = new Set();
    // ScopeContext handles lambda params and hash tracking
    
    const variables: LocalVariableRegistry[] = [];

    // Recursively find and process lambda expressions in the initializer
    this.extractLambdasFromFieldInitializer(
      initializerNode,
      filePath,
      typeRegistryHash,
      fieldHash,
      ownerTypeName,
      ownerQualifiedName,
      serviceVersionHash,
      packageName,
      importMap,
      hasStarImports,
      1, // lambdaDepth starts at 1 for field lambdas
      variables
    );

    return variables;
  }

  /**
   * Recursively finds and extracts local variables from lambda block bodies in a field initializer
   */
  private extractLambdasFromFieldInitializer(
    node: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    fieldHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    if (node.type === 'lambda_expression') {
      // Process this lambda's block body using the unified extractFromLambdaExpression path
      // (shouldCreateBlockEntries + blockMethodHash are set at entry point, so block entries
      // and expression extraction will be handled correctly for the field context)
      this.extractFromLambdaExpression(
        node,
        filePath,
        typeRegistryHash,
        undefined, // no method for field lambdas
        ownerTypeName,
        ownerQualifiedName,
        undefined, // no method name
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        lambdaDepth,
        variables
      );
    } else if (node.type === 'switch_expression') {
      // Process switch expression blocks (case -> { ... yield ... })
      this.extractFromFieldSwitchExpressionBlocks(
        node,
        filePath,
        typeRegistryHash,
        fieldHash,
        ownerTypeName,
        ownerQualifiedName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        lambdaDepth,
        variables
      );
    } else {
      // Recursively search children for lambda expressions and switch expressions
      for (const child of node.children) {
        this.extractLambdasFromFieldInitializer(
          child,
          filePath,
          typeRegistryHash,
          fieldHash,
          ownerTypeName,
          ownerQualifiedName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          lambdaDepth,
          variables
        );
      }
    }
  }


  /**
   * Extracts local variables from a static initializer block
   */
  extractFromStaticInitializer(
    bodyNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean
  ): LocalVariableRegistry[] {
    this.resetExtractedCollections();
    this.shouldCreateBlockEntries = true;
    this.blockMethodHash = methodRegistryHash;
    
    const variables: LocalVariableRegistry[] = [];

    this.extractFromBlock(
      bodyNode,
      filePath,
      typeRegistryHash,
      methodRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      '<clinit>',
      serviceVersionHash,
      packageName,
      importMap,
      hasStarImports,
      LocalVariableScopeKind.STATIC_INITIALIZER,
      0,
      variables,
      0,
      methodRegistryHash // parentExpressionLinkHash for initializer blocks
    );

    return variables;
  }

  /**
   * Extracts local variables from an instance initializer block
   */
  extractFromInstanceInitializer(
    bodyNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean
  ): LocalVariableRegistry[] {
    this.resetExtractedCollections();
    this.shouldCreateBlockEntries = true;
    this.blockMethodHash = methodRegistryHash;
    
    const variables: LocalVariableRegistry[] = [];

    this.extractFromBlock(
      bodyNode,
      filePath,
      typeRegistryHash,
      methodRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      '<init_block>',
      serviceVersionHash,
      packageName,
      importMap,
      hasStarImports,
      LocalVariableScopeKind.INSTANCE_INITIALIZER,
      0,
      variables,
      0,
      methodRegistryHash // parentExpressionLinkHash for initializer blocks
    );

    return variables;
  }

  /**
   * Recursively extracts local variables from a block and its nested statements
   * @param parentExpressionLinkHash - Optional hash to use for parentExpressionLinkHash when ScopeContext is not set up (e.g., initializer blocks)
   */
  private extractFromBlock(
    node: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    scopeKind: LocalVariableScopeKind,
    lambdaDepth: number,
    variables: LocalVariableRegistry[],
    blockDepth: number = 0,
    parentExpressionLinkHash?: string
  ): void {
    // A brace-less control-flow body IS the statement, not a `block` wrapping it: `if (c) x();`
    // hands this method the `expression_statement` itself. These statement types used to be
    // recognised only where they appeared as a CHILD of a block, so a lambda that initializes a
    // local variable or a field lost every statement in an unbraced `if` / `for` / `while` /
    // `do` body — no row at all, which a consumer cannot tell from a lambda body that really is
    // empty. The same lambda passed as an ARGUMENT was always extracted, which is what made
    // this easy to miss.
    //
    // Handled here rather than only in the child walk, and the child walk below now delegates
    // to this one path, so a statement is extracted exactly once however it was reached.
    // Execution falls through to that walk afterwards, which is what finds lambdas nested
    // inside the statement.
    if (node.type === 'expression_statement' || node.type === 'return_statement' ||
        node.type === 'yield_statement' || node.type === 'throw_statement') {
      this.extractLambdaBodyStatementExpressions(
        node, typeRegistryHash, serviceVersionHash, packageName, importMap, hasStarImports);
    }

    // When called on a non-block statement node (e.g., a while_statement that is
    // the brace-less body of a for loop), dispatch to its dedicated handler so it
    // creates the proper block entry and processes its contents correctly.
    switch (node.type) {
      case 'if_statement':
        this.extractPatternsFromStatement(node, filePath, typeRegistryHash, methodRegistryHash, ownerTypeName, ownerQualifiedName, ownerMethodName, serviceVersionHash, packageName, importMap, hasStarImports, lambdaDepth, variables);
        this.extractFromIfStatement(node, filePath, typeRegistryHash, methodRegistryHash, ownerTypeName, ownerQualifiedName, ownerMethodName, serviceVersionHash, packageName, importMap, hasStarImports, scopeKind, lambdaDepth, variables);
        return;
      case 'for_statement':
        this.extractPatternsFromStatement(node, filePath, typeRegistryHash, methodRegistryHash, ownerTypeName, ownerQualifiedName, ownerMethodName, serviceVersionHash, packageName, importMap, hasStarImports, lambdaDepth, variables);
        this.extractFromForStatement(node, filePath, typeRegistryHash, methodRegistryHash, ownerTypeName, ownerQualifiedName, ownerMethodName, serviceVersionHash, packageName, importMap, hasStarImports, scopeKind, lambdaDepth, variables);
        return;
      case 'enhanced_for_statement':
        this.extractFromEnhancedForStatement(node, filePath, typeRegistryHash, methodRegistryHash, ownerTypeName, ownerQualifiedName, ownerMethodName, serviceVersionHash, packageName, importMap, hasStarImports, scopeKind, lambdaDepth, variables);
        return;
      case 'while_statement':
      case 'do_statement':
        this.extractPatternsFromStatement(node, filePath, typeRegistryHash, methodRegistryHash, ownerTypeName, ownerQualifiedName, ownerMethodName, serviceVersionHash, packageName, importMap, hasStarImports, lambdaDepth, variables);
        this.extractFromWhileStatement(node, filePath, typeRegistryHash, methodRegistryHash, ownerTypeName, ownerQualifiedName, ownerMethodName, serviceVersionHash, packageName, importMap, hasStarImports, scopeKind, lambdaDepth, variables);
        return;
      case 'try_statement':
      case 'try_with_resources_statement':
        this.extractFromTryStatement(node, filePath, typeRegistryHash, methodRegistryHash, ownerTypeName, ownerQualifiedName, ownerMethodName, serviceVersionHash, packageName, importMap, hasStarImports, scopeKind, lambdaDepth, variables);
        return;
      case 'switch_expression':
      case 'switch_statement':
        this.extractFromSwitchStatement(node, filePath, typeRegistryHash, methodRegistryHash, ownerTypeName, ownerQualifiedName, ownerMethodName, serviceVersionHash, packageName, importMap, hasStarImports, scopeKind, lambdaDepth, variables);
        return;
      case 'synchronized_statement':
        this.extractPatternsFromStatement(node, filePath, typeRegistryHash, methodRegistryHash, ownerTypeName, ownerQualifiedName, ownerMethodName, serviceVersionHash, packageName, importMap, hasStarImports, lambdaDepth, variables);
        this.extractFromSynchronizedStatement(node, filePath, typeRegistryHash, methodRegistryHash, ownerTypeName, ownerQualifiedName, ownerMethodName, serviceVersionHash, packageName, importMap, hasStarImports, scopeKind, lambdaDepth, variables);
        return;
    }

    for (const child of node.children) {
      switch (child.type) {
        case 'local_variable_declaration':
          this.extractLocalVariableDeclaration(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            scopeKind,
            lambdaDepth,
            variables,
            blockDepth,
            parentExpressionLinkHash
          );
          break;

        case 'for_statement':
          this.extractFromForStatement(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            scopeKind,
            lambdaDepth,
            variables
          );
          break;

        case 'enhanced_for_statement':
          this.extractFromEnhancedForStatement(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            scopeKind,
            lambdaDepth,
            variables
          );
          break;

        case 'try_statement':
        case 'try_with_resources_statement':
          this.extractFromTryStatement(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            scopeKind,
            lambdaDepth,
            variables
          );
          break;

        case 'catch_clause':
          this.extractFromCatchClause(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            lambdaDepth,
            variables
          );
          break;

        case 'lambda_expression':
          this.extractFromLambdaExpression(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            lambdaDepth + 1,
            variables
          );
          break;

        case 'if_statement':
          // Check for instanceof pattern in condition
          this.extractPatternsFromStatement(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            lambdaDepth,
            variables
          );
          // Handle IF block with proper scope context
          this.extractFromIfStatement(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            scopeKind,
            lambdaDepth,
            variables
          );
          break;

        case 'while_statement':
        case 'do_statement':
          // Check for instanceof pattern in condition
          this.extractPatternsFromStatement(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            lambdaDepth,
            variables
          );
          // Handle WHILE/DO_WHILE block with proper scope context
          this.extractFromWhileStatement(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            scopeKind,
            lambdaDepth,
            variables
          );
          break;

        case 'switch_expression':
        case 'switch_statement':
          // Use dedicated method with proper block scope tracking
          this.extractFromSwitchStatement(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            scopeKind,
            lambdaDepth,
            variables
          );
          break;

        case 'synchronized_statement':
          // Check for instanceof pattern in condition
          this.extractPatternsFromStatement(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            lambdaDepth,
            variables
          );
          // Handle synchronized block with proper scope context
          this.extractFromSynchronizedStatement(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            scopeKind,
            lambdaDepth,
            variables
          );
          break;

        case 'block':
          // Recurse into nested blocks with incremented block depth
          this.extractFromBlock(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            scopeKind,
            lambdaDepth,
            variables,
            blockDepth + 1
          );
          break;

        case 'return_statement':
        case 'expression_statement':
        case 'throw_statement':
        case 'yield_statement':
          // Recurse into the single path at the top of this method, which extracts the
          // statement's own expressions and then descends for nested lambdas (e.g.
          // `return y -> { int sum = ...; }`). Extracting here as well would double every row.
          this.extractFromBlock(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            scopeKind,
            lambdaDepth,
            variables
          );
          break;

        case 'class_body': {
          // Anonymous class bodies (parent is object_creation_expression) are
          // fully handled by TypeMethodExtractor.extractFromAnonymousClassBody,
          // which extracts methods, local variables, blocks, and expressions
          // with the correct anonymous-class method hash. Recursing here would
          // produce duplicates linked to the OUTER method with phantom block hashes.
          //
          // Local class bodies (parent is class_declaration) are NOT handled
          // elsewhere, so we must recurse to extract their variables/expressions.
          const isAnonymousClassBody = child.parent?.type === 'object_creation_expression';
          if (!isAnonymousClassBody) {
            const savedCreateBlocks = this.shouldCreateBlockEntries;
            this.shouldCreateBlockEntries = false;
            this.extractFromBlock(
              child,
              filePath,
              typeRegistryHash,
              methodRegistryHash,
              ownerTypeName,
              ownerQualifiedName,
              ownerMethodName,
              serviceVersionHash,
              packageName,
              importMap,
              hasStarImports,
              scopeKind,
              lambdaDepth,
              variables
            );
            this.shouldCreateBlockEntries = savedCreateBlocks;
          }
          break;
        }

        case 'method_declaration':
        case 'constructor_declaration':
          // Method/constructor declarations inside class bodies are fully handled
          // by TypeMethodExtractor. Recursing here would create duplicate local
          // variables linked to the OUTER method with phantom block hashes.
          // These nodes only appear as children of class_body during local class
          // recursion — never directly inside a method body block.
          break;

        default:
          // For other statement types, recurse to find nested declarations
          if (child.children.length > 0) {
            this.extractFromBlock(
              child,
              filePath,
              typeRegistryHash,
              methodRegistryHash,
              ownerTypeName,
              ownerQualifiedName,
              ownerMethodName,
              serviceVersionHash,
              packageName,
              importMap,
              hasStarImports,
              scopeKind,
              lambdaDepth,
              variables
            );
          }
          break;
      }
    }
  }

  /**
   * Extracts a local variable declaration
   * Handles multi-declaration: int x, y, z;
   * @param fallbackParentExpressionLinkHash - Optional hash to use for parentExpressionLinkHash when ScopeContext is not set up
   */
  private extractLocalVariableDeclaration(
    declNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    scopeKind: LocalVariableScopeKind,
    lambdaDepth: number,
    variables: LocalVariableRegistry[],
    blockDepth: number = 0,
    fallbackParentExpressionLinkHash?: string
  ): void {
    // Check for final modifier
    const isFinal = this.hasFinalModifier(declNode);

    // Extract the type node
    const typeNode = this.findTypeNode(declNode);
    if (!typeNode) return;

    // Check for var inference
    const isVarInferred = typeNode.type === 'type_identifier' && typeNode.text === 'var';

    // Get the full type name as written
    const variableTypeName = EntityUtils.normalizeWhitespace(typeNode.text);
    const variableBaseType = this.extractBaseType(variableTypeName);

    // Resolve qualified name (skip for var - type is inferred)
    let potentialQualifiedName: string | undefined;
    let isAmbiguous = false;
    if (!isVarInferred) {
      const resolved = resolveTypeQualifiedName(
        variableBaseType,
        packageName,
        importMap,
        hasStarImports
      );
      potentialQualifiedName = resolved.potentialQualifiedName ?? undefined;
      isAmbiguous = resolved.isAmbiguous;
    }

    // Find all variable declarators
    const declarators = declNode.children.filter(
      child => child.type === 'variable_declarator'
    );

    for (const declarator of declarators) {
      const nameNode = declarator.children.find(c => c.type === 'identifier');
      if (!nameNode) continue;

      const varName = nameNode.text;
      const startLine = declarator.startPosition.row + 1;
      const endLine = declarator.endPosition.row + 1;

      // Handle C-style array declarations
      const cStyleDimensions = declarator.children.find(c => c.type === 'dimensions');
      let actualTypeName = variableTypeName;
      let actualBaseType = variableBaseType;
      if (cStyleDimensions) {
        actualTypeName = variableTypeName + cStyleDimensions.text;
        actualBaseType = this.extractBaseType(actualTypeName);
      }

      // Determine effective scope kind using ScopeContext
      const scopeContextKind = this.scopeContext.getCurrentScopeKind();
      let effectiveScopeKind: LocalVariableScopeKind;
      
      // Check if the passed scopeKind is an explicit loop/special scope that should be preserved
      const isExplicitLoopScope = scopeKind === LocalVariableScopeKind.FOR_LOOP || 
                                   scopeKind === LocalVariableScopeKind.ENHANCED_FOR_LOOP ||
                                   scopeKind === LocalVariableScopeKind.TRY_WITH_RESOURCES;
      
      if (isExplicitLoopScope) {
        // For loop variables and try-with-resources - use the explicitly passed scope kind
        effectiveScopeKind = scopeKind;
      } else if (this.scopeContext.isInsideBlock()) {
        // Inside a block (try/catch/finally/if/for/etc.) - use block scope kind from ScopeContext
        effectiveScopeKind = scopeContextKind;
      } else if (lambdaDepth > 0) {
        // Inside lambda but not in a block within lambda
        effectiveScopeKind = LocalVariableScopeKind.LAMBDA_BODY;
      } else {
        // Use the passed scope kind (METHOD_BODY, etc.)
        effectiveScopeKind = scopeKind;
      }

      // Build the local variable entity
      const varBuilder = LocalVariableRegistry.builder(
        varName,
        actualTypeName,
        actualBaseType,
        filePath,
        startLine,
        endLine,
        effectiveScopeKind,
        typeRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        serviceVersionHash
      );

      if (potentialQualifiedName) {
        varBuilder.withPotentialQualifiedName(potentialQualifiedName);
      }
      varBuilder.withIsAmbiguous(isAmbiguous);
      varBuilder.withScopeDepth(lambdaDepth + blockDepth);
      varBuilder.withIsFinal(isFinal);
      varBuilder.withIsVarInferred(isVarInferred);

      if (methodRegistryHash) {
        varBuilder.withMethodRegistryLinkHash(methodRegistryHash);
      }
      if (ownerMethodName) {
        varBuilder.withOwnerMethodName(ownerMethodName);
      }
      // Link to containing scope (block > lambda > method) using ScopeContext
      // For explicit loop scopes (FOR_LOOP, ENHANCED_FOR_LOOP), prefer the explicitly passed block hash
      // Fall back to ScopeContext for regular variables, or explicit hash for initializer blocks
      let ownerHash: string | undefined;
      if (isExplicitLoopScope && fallbackParentExpressionLinkHash) {
        // Loop variables should be linked to their loop block, not the containing lambda
        ownerHash = fallbackParentExpressionLinkHash;
      } else {
        ownerHash = this.scopeContext.getCurrentOwnerHash() || fallbackParentExpressionLinkHash;
      }
      if (ownerHash) {
        varBuilder.withParentExpressionLinkHash(ownerHash);
      }

      const localVar = varBuilder.build();
      variables.push(localVar);
      
      // Add variable name to tracking set for expression classification
      this.currentLocalVariableNames.add(varName);

      // Extract annotations from the local variable declaration
      this.extractLocalVariableAnnotations(
        declNode,
        typeRegistryHash,
        localVar.getHash()
      );

      // Extract type references for the variable type
      this.extractVariableTypeReferences(
        typeNode,
        typeRegistryHash,
        localVar.getHash(),
        packageName
      );

      // Extract expressions from variable initializer (if present)
      // Skip comment nodes (line_comment, block_comment) that may appear between = and the actual initializer
      // e.g.: List<Predicate> verifiers = // comment\n   new ArrayList<>(...);
      const equalsIndex = declarator.children.findIndex(c => c.type === '=');
      if (equalsIndex >= 0 && equalsIndex < declarator.children.length - 1) {
        const initializerNode = declarator.children.slice(equalsIndex + 1)
          .find(c => c.type !== 'line_comment' && c.type !== 'block_comment');
        if (initializerNode) {
          this.extractInitializerExpressions(
            initializerNode,
            typeRegistryHash,
            localVar.getHash(),
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports
          );

          // Extract local variables from lambda block bodies in the initializer
          this.extractLambdasFromInitializer(
            initializerNode,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            lambdaDepth,
            variables,
            localVar.getHash()
          );
        }
      }
    }
  }

  /**
   * Extracts variables from a for statement
   * Example: for (int i = 0; i < 10; i++)
   */
  private extractFromForStatement(
    forNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    _parentScopeKind: LocalVariableScopeKind,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    // Compute block hash for the for loop body (both braced and brace-less)
    const forBody = forNode.childForFieldName('body');
    let forBlockHash: string | null = null;
    if (forBody && this.blockMethodHash) {
      forBlockHash = BlockRegistry.computeHash(
        BlockKind.FOR,
        filePath,
        forBody.startPosition.row + 1,
        forBody.endPosition.row + 1,
        forBody.startPosition.column,
        forBody.endPosition.column,
        typeRegistryHash,
        this.blockMethodHash
      );

      // Create BlockRegistry entry when block creation is enabled
      if (this.shouldCreateBlockEntries) {
        const blockEntry = BlockRegistry.builder(
          BlockKind.FOR, this.extractedBlocks.length, filePath,
          forBody.startPosition.row + 1, forBody.endPosition.row + 1,
          forBody.startPosition.column, forBody.endPosition.column,
          typeRegistryHash, this.blockMethodHash,
          ownerTypeName, ownerQualifiedName, ownerMethodName || ''
        )
          .withNestingDepth(this.blockNestingDepth);
        const parentHash = this.scopeContext.getCurrentOwnerHash();
        if (parentHash) blockEntry.withParentContainerHash(parentHash);
        this.extractedBlocks.push(blockEntry.build());
      }
    }

    // Find the init part of for loop (local_variable_declaration)
    for (const child of forNode.children) {
      if (child.type === 'local_variable_declaration') {
        // For loop variable declaration - use FOR_LOOP scope and link to FOR block
        this.extractLocalVariableDeclaration(
          child,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          LocalVariableScopeKind.FOR_LOOP,
          lambdaDepth,
          variables,
          0, // blockDepth
          forBlockHash ?? undefined // Link for loop variable to FOR block
        );
      }
    }

    // Recurse into the loop body
    const body = forNode.childForFieldName('body');
    if (body && body.type === 'block') {
      // Enter FOR block scope before recursing
      if (forBlockHash) {
        if (!this.isFieldInitializerContext) this.blockNestingDepth++;
        this.scopeContext.enterBlock(forBlockHash, BlockKind.FOR, LocalVariableScopeKind.FOR_BLOCK);
      }
      this.extractFromBlock(
        body,
        filePath,
        typeRegistryHash,
        methodRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        ownerMethodName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        LocalVariableScopeKind.FOR_BLOCK,
        lambdaDepth,
        variables
      );
      if (forBlockHash) {
        this.scopeContext.exit();
        if (!this.isFieldInitializerContext) this.blockNestingDepth--;
      }
    } else if (body) {
      // Non-block body (single statement) - still enter FOR scope so expressions link to FOR block hash
      if (forBlockHash) {
        if (!this.isFieldInitializerContext) this.blockNestingDepth++;
        this.scopeContext.enterBlock(forBlockHash, BlockKind.FOR, LocalVariableScopeKind.FOR_BLOCK);
      }
      this.extractFromBlock(
        body,
        filePath,
        typeRegistryHash,
        methodRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        ownerMethodName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        LocalVariableScopeKind.FOR_BLOCK,
        lambdaDepth,
        variables
      );
      if (forBlockHash) {
        this.scopeContext.exit();
        if (!this.isFieldInitializerContext) this.blockNestingDepth--;
      }
    }
  }

  /**
   * Extracts variables from an if statement with proper block scope tracking
   */
  private extractFromIfStatement(
    ifNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    parentScopeKind: LocalVariableScopeKind,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    // Handle consequence (then branch) - both braced and brace-less
    const consequence = ifNode.childForFieldName('consequence');
    if (consequence && this.blockMethodHash) {
      const ifBlockHash = BlockRegistry.computeHash(
        BlockKind.IF,
        filePath,
        consequence.startPosition.row + 1,
        consequence.endPosition.row + 1,
        consequence.startPosition.column,
        consequence.endPosition.column,
        typeRegistryHash,
        this.blockMethodHash
      );
      if (this.shouldCreateBlockEntries) {
        const blockEntry = BlockRegistry.builder(
          BlockKind.IF, this.extractedBlocks.length, filePath,
          consequence.startPosition.row + 1, consequence.endPosition.row + 1,
          consequence.startPosition.column, consequence.endPosition.column,
          typeRegistryHash, this.blockMethodHash,
          ownerTypeName, ownerQualifiedName, ownerMethodName || ''
        )
          .withNestingDepth(this.blockNestingDepth);
        const parentHash = this.scopeContext.getCurrentOwnerHash();
        if (parentHash) blockEntry.withParentContainerHash(parentHash);
        this.extractedBlocks.push(blockEntry.build());
      }
      if (!this.isFieldInitializerContext) this.blockNestingDepth++;
      this.scopeContext.enterBlock(ifBlockHash, BlockKind.IF, LocalVariableScopeKind.IF_BLOCK);
      this.extractFromBlock(
        consequence,
        filePath,
        typeRegistryHash,
        methodRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        ownerMethodName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        LocalVariableScopeKind.IF_BLOCK,
        lambdaDepth,
        variables
      );
      this.scopeContext.exit();
      if (!this.isFieldInitializerContext) this.blockNestingDepth--;
    } else if (consequence) {
      // No blockMethodHash available - still recurse without scope tracking
      this.extractFromBlock(
        consequence,
        filePath,
        typeRegistryHash,
        methodRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        ownerMethodName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        parentScopeKind,
        lambdaDepth,
        variables
      );
    }

    // Handle alternative (else branch) - use while loop to iterate through all else-ifs
    let currentAlt = ifNode.childForFieldName('alternative');
    while (currentAlt && currentAlt.type === 'if_statement') {
      // else if - handle with ELSE_IF block kind
      const elseIfConsequence = currentAlt.childForFieldName('consequence');
      if (elseIfConsequence && this.blockMethodHash) {
        const elseIfBlockHash = BlockRegistry.computeHash(
          BlockKind.ELSE_IF,
          filePath,
          elseIfConsequence.startPosition.row + 1,
          elseIfConsequence.endPosition.row + 1,
          elseIfConsequence.startPosition.column,
          elseIfConsequence.endPosition.column,
          typeRegistryHash,
          this.blockMethodHash
        );
        if (this.shouldCreateBlockEntries) {
          const blockEntry = BlockRegistry.builder(
            BlockKind.ELSE_IF, this.extractedBlocks.length, filePath,
            elseIfConsequence.startPosition.row + 1, elseIfConsequence.endPosition.row + 1,
            elseIfConsequence.startPosition.column, elseIfConsequence.endPosition.column,
            typeRegistryHash, this.blockMethodHash,
            ownerTypeName, ownerQualifiedName, ownerMethodName || ''
          )
            .withNestingDepth(this.blockNestingDepth);
          const parentHash = this.scopeContext.getCurrentOwnerHash();
          if (parentHash) blockEntry.withParentContainerHash(parentHash);
          this.extractedBlocks.push(blockEntry.build());
        }
        if (!this.isFieldInitializerContext) this.blockNestingDepth++;
        this.scopeContext.enterBlock(elseIfBlockHash, BlockKind.ELSE_IF, LocalVariableScopeKind.IF_BLOCK);
        this.extractFromBlock(
          elseIfConsequence,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          LocalVariableScopeKind.IF_BLOCK,
          lambdaDepth,
          variables
        );
        this.scopeContext.exit();
        if (!this.isFieldInitializerContext) this.blockNestingDepth--;
      } else if (elseIfConsequence) {
        // No blockMethodHash available - still recurse without scope tracking
        this.extractFromBlock(
          elseIfConsequence,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          parentScopeKind,
          lambdaDepth,
          variables
        );
      }

      // Move to the next alternative in the chain
      const nextAlt = currentAlt.childForFieldName('alternative');
      if (nextAlt && nextAlt.type === 'if_statement') {
        currentAlt = nextAlt;
      } else if (nextAlt && this.blockMethodHash) {
        // Final else (braced or brace-less)
        const elseBlockHash = BlockRegistry.computeHash(
          BlockKind.ELSE,
          filePath,
          nextAlt.startPosition.row + 1,
          nextAlt.endPosition.row + 1,
          nextAlt.startPosition.column,
          nextAlt.endPosition.column,
          typeRegistryHash,
          this.blockMethodHash
        );
        if (this.shouldCreateBlockEntries) {
          const blockEntry = BlockRegistry.builder(
            BlockKind.ELSE, this.extractedBlocks.length, filePath,
            nextAlt.startPosition.row + 1, nextAlt.endPosition.row + 1,
            nextAlt.startPosition.column, nextAlt.endPosition.column,
            typeRegistryHash, this.blockMethodHash,
            ownerTypeName, ownerQualifiedName, ownerMethodName || ''
          )
            .withNestingDepth(this.blockNestingDepth);
          const parentHash = this.scopeContext.getCurrentOwnerHash();
          if (parentHash) blockEntry.withParentContainerHash(parentHash);
          this.extractedBlocks.push(blockEntry.build());
        }
        if (!this.isFieldInitializerContext) this.blockNestingDepth++;
        this.scopeContext.enterBlock(elseBlockHash, BlockKind.ELSE, LocalVariableScopeKind.ELSE_BLOCK);
        this.extractFromBlock(
          nextAlt,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          LocalVariableScopeKind.ELSE_BLOCK,
          lambdaDepth,
          variables
        );
        this.scopeContext.exit();
        if (!this.isFieldInitializerContext) this.blockNestingDepth--;
        currentAlt = null;
      } else if (nextAlt) {
        // No blockMethodHash available - still recurse without scope tracking
        this.extractFromBlock(
          nextAlt,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          parentScopeKind,
          lambdaDepth,
          variables
        );
        currentAlt = null;
      } else {
        currentAlt = null;
      }
    }

    // Handle direct else only if alternative is NOT an if_statement (else-if chain handles that case)
    const directAlt = ifNode.childForFieldName('alternative');
    if (directAlt && directAlt.type !== 'if_statement') {
      if (this.blockMethodHash) {
        const elseBlockHash = BlockRegistry.computeHash(
          BlockKind.ELSE,
          filePath,
          directAlt.startPosition.row + 1,
          directAlt.endPosition.row + 1,
          directAlt.startPosition.column,
          directAlt.endPosition.column,
          typeRegistryHash,
          this.blockMethodHash
        );
        if (this.shouldCreateBlockEntries) {
          const blockEntry = BlockRegistry.builder(
            BlockKind.ELSE, this.extractedBlocks.length, filePath,
            directAlt.startPosition.row + 1, directAlt.endPosition.row + 1,
            directAlt.startPosition.column, directAlt.endPosition.column,
            typeRegistryHash, this.blockMethodHash,
            ownerTypeName, ownerQualifiedName, ownerMethodName || ''
          )
            .withNestingDepth(this.blockNestingDepth);
          const parentHash = this.scopeContext.getCurrentOwnerHash();
          if (parentHash) blockEntry.withParentContainerHash(parentHash);
          this.extractedBlocks.push(blockEntry.build());
        }
        if (!this.isFieldInitializerContext) this.blockNestingDepth++;
        this.scopeContext.enterBlock(elseBlockHash, BlockKind.ELSE, LocalVariableScopeKind.ELSE_BLOCK);
        this.extractFromBlock(
          directAlt,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          LocalVariableScopeKind.ELSE_BLOCK,
          lambdaDepth,
          variables
        );
        this.scopeContext.exit();
        if (!this.isFieldInitializerContext) this.blockNestingDepth--;
      } else {
        // No blockMethodHash available - still recurse without scope tracking
        this.extractFromBlock(
          directAlt,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          parentScopeKind,
          lambdaDepth,
          variables
        );
      }
    }
  }

  /**
   * Extracts variables from a while/do-while statement with proper block scope tracking
   */
  private extractFromWhileStatement(
    whileNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    parentScopeKind: LocalVariableScopeKind,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    const isDoWhile = whileNode.type === 'do_statement';
    const blockKind = isDoWhile ? BlockKind.DO_WHILE : BlockKind.WHILE;
    const scopeKind = isDoWhile ? LocalVariableScopeKind.DO_WHILE_BLOCK : LocalVariableScopeKind.WHILE_BLOCK;

    const body = whileNode.childForFieldName('body');
    if (body && this.blockMethodHash) {
      const blockHash = BlockRegistry.computeHash(
        blockKind,
        filePath,
        body.startPosition.row + 1,
        body.endPosition.row + 1,
        body.startPosition.column,
        body.endPosition.column,
        typeRegistryHash,
        this.blockMethodHash
      );
      if (this.shouldCreateBlockEntries) {
        const blockEntry = BlockRegistry.builder(
          blockKind, this.extractedBlocks.length, filePath,
          body.startPosition.row + 1, body.endPosition.row + 1,
          body.startPosition.column, body.endPosition.column,
          typeRegistryHash, this.blockMethodHash,
          ownerTypeName, ownerQualifiedName, ownerMethodName || ''
        )
          .withNestingDepth(this.blockNestingDepth);
        const whileParentHash = this.scopeContext.getCurrentOwnerHash();
        if (whileParentHash) blockEntry.withParentContainerHash(whileParentHash);
        this.extractedBlocks.push(blockEntry.build());
      }
      if (!this.isFieldInitializerContext) this.blockNestingDepth++;
      this.scopeContext.enterBlock(blockHash, blockKind, scopeKind);
      this.extractFromBlock(
        body,
        filePath,
        typeRegistryHash,
        methodRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        ownerMethodName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        scopeKind,
        lambdaDepth,
        variables
      );
      this.scopeContext.exit();
      if (!this.isFieldInitializerContext) this.blockNestingDepth--;
    } else if (body) {
      // No blockMethodHash available - still recurse without scope tracking
      this.extractFromBlock(
        body,
        filePath,
        typeRegistryHash,
        methodRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        ownerMethodName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        parentScopeKind,
        lambdaDepth,
        variables
      );
    }
  }

  /**
   * Extracts variables from a synchronized statement with proper block scope tracking
   */
  private extractFromSynchronizedStatement(
    syncNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    parentScopeKind: LocalVariableScopeKind,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    const body = syncNode.childForFieldName('body');
    if (body && body.type === 'block' && this.blockMethodHash) {
      const blockHash = BlockRegistry.computeHash(
        BlockKind.SYNCHRONIZED,
        filePath,
        body.startPosition.row + 1,
        body.endPosition.row + 1,
        body.startPosition.column,
        body.endPosition.column,
        typeRegistryHash,
        this.blockMethodHash
      );
      if (this.shouldCreateBlockEntries) {
        const blockEntry = BlockRegistry.builder(
          BlockKind.SYNCHRONIZED, this.extractedBlocks.length, filePath,
          body.startPosition.row + 1, body.endPosition.row + 1,
          body.startPosition.column, body.endPosition.column,
          typeRegistryHash, this.blockMethodHash,
          ownerTypeName, ownerQualifiedName, ownerMethodName || ''
        )
          .withNestingDepth(this.blockNestingDepth);
        const syncParentHash2 = this.scopeContext.getCurrentOwnerHash();
        if (syncParentHash2) blockEntry.withParentContainerHash(syncParentHash2);
        this.extractedBlocks.push(blockEntry.build());
      }
      if (!this.isFieldInitializerContext) this.blockNestingDepth++;
      this.scopeContext.enterBlock(blockHash, BlockKind.SYNCHRONIZED, LocalVariableScopeKind.SYNCHRONIZED_BLOCK);
      this.extractFromBlock(
        body,
        filePath,
        typeRegistryHash,
        methodRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        ownerMethodName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        LocalVariableScopeKind.SYNCHRONIZED_BLOCK,
        lambdaDepth,
        variables
      );
      this.scopeContext.exit();
      if (!this.isFieldInitializerContext) this.blockNestingDepth--;
    } else if (body) {
      // Single statement without braces - use parent scope kind
      this.extractFromBlock(
        body,
        filePath,
        typeRegistryHash,
        methodRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        ownerMethodName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        parentScopeKind,
        lambdaDepth,
        variables
      );
    }
  }

  /**
   * Extracts variables from a switch statement/expression with proper block scope tracking.
   * 
   * Handles both syntaxes:
   * - Colon syntax: switch_block_statement_group nodes → SWITCH_CASE blocks
   * - Arrow syntax: switch_rule nodes with block body → SWITCH_EXPRESSION_CASE blocks
   * 
   * Each case group/rule gets its own BlockRegistry entry so that local variables
   * and expressions inside it link to the case block, not the method directly.
   */
  private extractFromSwitchStatement(
    switchNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    parentScopeKind: LocalVariableScopeKind,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    // Extract patterns from switch (e.g., case Integer i ->)
    this.extractPatternsFromStatement(
      switchNode,
      filePath,
      typeRegistryHash,
      methodRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      ownerMethodName,
      serviceVersionHash,
      packageName,
      importMap,
      hasStarImports,
      lambdaDepth,
      variables
    );

    // Find the switch_block containing case groups or rules
    const switchBlock = switchNode.children.find(c => c.type === 'switch_block');
    if (!switchBlock) {
      // Fallback: recurse generically if no switch_block found
      this.extractFromBlock(
        switchNode,
        filePath,
        typeRegistryHash,
        methodRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        ownerMethodName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        parentScopeKind,
        lambdaDepth,
        variables
      );
      return;
    }

    for (const child of switchBlock.children) {
      if (child.type === 'switch_block_statement_group') {
        // Traditional colon syntax: case 1: ... break;
        // Use the entire group node position for the SWITCH_CASE block
        this.extractFromSwitchCaseGroup(
          child,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          parentScopeKind,
          lambdaDepth,
          variables
        );
      } else if (child.type === 'switch_rule') {
        // Arrow syntax: case 1 -> { ... } or case 1 -> expr;
        this.extractFromSwitchRule(
          child,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          parentScopeKind,
          lambdaDepth,
          variables
        );
      }
    }
  }

  /**
   * Extracts variables from a traditional switch case group (colon syntax).
   * Creates a SWITCH_CASE BlockRegistry entry for the group.
   * 
   * AST structure:
   *   switch_block_statement_group
   *     switch_label ("case 1")
   *     : (colon)
   *     local_variable_declaration / expression_statement / break_statement ...
   */
  private extractFromSwitchCaseGroup(
    groupNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    _parentScopeKind: LocalVariableScopeKind,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    let caseBlockHash: string | null = null;

    if (this.blockMethodHash) {
      caseBlockHash = BlockRegistry.computeHash(
        BlockKind.SWITCH_CASE,
        filePath,
        groupNode.startPosition.row + 1,
        groupNode.endPosition.row + 1,
        groupNode.startPosition.column,
        groupNode.endPosition.column,
        typeRegistryHash,
        this.blockMethodHash
      );

      if (this.shouldCreateBlockEntries) {
        const blockEntry = BlockRegistry.builder(
          BlockKind.SWITCH_CASE, this.extractedBlocks.length, filePath,
          groupNode.startPosition.row + 1, groupNode.endPosition.row + 1,
          groupNode.startPosition.column, groupNode.endPosition.column,
          typeRegistryHash, this.blockMethodHash,
          ownerTypeName, ownerQualifiedName, ownerMethodName || ''
        )
          .withNestingDepth(this.blockNestingDepth);
        const parentHash = this.scopeContext.getCurrentOwnerHash();
        if (parentHash) blockEntry.withParentContainerHash(parentHash);
        this.extractedBlocks.push(blockEntry.build());
      }
    }

    // Enter SWITCH_CASE scope
    if (caseBlockHash) {
      if (!this.isFieldInitializerContext) this.blockNestingDepth++;
      this.scopeContext.enterBlock(caseBlockHash, BlockKind.SWITCH_CASE, LocalVariableScopeKind.SWITCH_BLOCK);
    }

    // Extract patterns from the case group (e.g., case Integer i:)
    this.extractPatternsFromStatement(
      groupNode,
      filePath,
      typeRegistryHash,
      methodRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      ownerMethodName,
      serviceVersionHash,
      packageName,
      importMap,
      hasStarImports,
      lambdaDepth,
      variables
    );

    // Process statements within the case group
    this.extractFromBlock(
      groupNode,
      filePath,
      typeRegistryHash,
      methodRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      ownerMethodName,
      serviceVersionHash,
      packageName,
      importMap,
      hasStarImports,
      LocalVariableScopeKind.SWITCH_BLOCK,
      lambdaDepth,
      variables
    );

    // Exit SWITCH_CASE scope
    if (caseBlockHash) {
      this.scopeContext.exit();
      if (!this.isFieldInitializerContext) this.blockNestingDepth--;
    }
  }

  /**
   * Extracts variables from a switch expression rule (arrow syntax).
   * Creates a SWITCH_EXPRESSION_CASE BlockRegistry entry when the rule has a block body.
   * 
   * AST structure:
   *   switch_rule
   *     switch_label ("case 2")
   *     -> (arrow)
   *     block { ... } / expression_statement "expr;"
   */
  private extractFromSwitchRule(
    ruleNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    parentScopeKind: LocalVariableScopeKind,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    const block = ruleNode.children.find(c => c.type === 'block');
    if (!block) {
      // No block body (e.g., case 1 -> "one";) — recurse generically for lambdas
      this.extractFromBlock(
        ruleNode,
        filePath,
        typeRegistryHash,
        methodRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        ownerMethodName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        parentScopeKind,
        lambdaDepth,
        variables
      );
      return;
    }

    // Block body: case 2 -> { ... yield ...; }
    let caseBlockHash: string | null = null;

    if (this.blockMethodHash) {
      caseBlockHash = BlockRegistry.computeHash(
        BlockKind.SWITCH_EXPRESSION_CASE,
        filePath,
        block.startPosition.row + 1,
        block.endPosition.row + 1,
        block.startPosition.column,
        block.endPosition.column,
        typeRegistryHash,
        this.blockMethodHash
      );

      if (this.shouldCreateBlockEntries) {
        const blockEntry = BlockRegistry.builder(
          BlockKind.SWITCH_EXPRESSION_CASE, this.extractedBlocks.length, filePath,
          block.startPosition.row + 1, block.endPosition.row + 1,
          block.startPosition.column, block.endPosition.column,
          typeRegistryHash, this.blockMethodHash,
          ownerTypeName, ownerQualifiedName, ownerMethodName || ''
        )
          .withNestingDepth(this.blockNestingDepth);
        const parentHash = this.scopeContext.getCurrentOwnerHash();
        if (parentHash) blockEntry.withParentContainerHash(parentHash);
        this.extractedBlocks.push(blockEntry.build());
      }
    }

    // Enter SWITCH_EXPRESSION_CASE scope
    if (caseBlockHash) {
      if (!this.isFieldInitializerContext) this.blockNestingDepth++;
      this.scopeContext.enterBlock(caseBlockHash, BlockKind.SWITCH_EXPRESSION_CASE, LocalVariableScopeKind.SWITCH_BLOCK);
    }

    // Extract and add pattern binding names from this switch rule
    const patternBindingNames = this.extractSwitchRulePatternBindingNames(ruleNode);
    for (const name of patternBindingNames) {
      this.currentPatternBindingNames.add(name);
    }

    // Process the block body
    this.extractFromBlock(
      block,
      filePath,
      typeRegistryHash,
      methodRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      ownerMethodName,
      serviceVersionHash,
      packageName,
      importMap,
      hasStarImports,
      LocalVariableScopeKind.SWITCH_BLOCK,
      lambdaDepth,
      variables
    );

    // Remove this rule's pattern bindings after processing
    for (const name of patternBindingNames) {
      this.currentPatternBindingNames.delete(name);
    }

    // Exit SWITCH_EXPRESSION_CASE scope
    if (caseBlockHash) {
      this.scopeContext.exit();
      if (!this.isFieldInitializerContext) this.blockNestingDepth--;
    }
  }

  /**
   * Extracts variables from an enhanced for statement
   * Example: for (String item : items)
   */
  private extractFromEnhancedForStatement(
    forNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    _parentScopeKind: LocalVariableScopeKind,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    // Enhanced for has structure: for ( [modifiers] type identifier : expression ) statement
    const typeNode = this.findTypeNode(forNode);
    const nameNode = forNode.children.find(c => c.type === 'identifier');

    // Compute block hash for enhanced_for body FIRST so we can link the loop variable to it
    // Works for both braced and brace-less bodies
    const body = forNode.childForFieldName('body');
    let enhancedForBlockHash: string | null = null;
    if (body && this.blockMethodHash) {
      enhancedForBlockHash = BlockRegistry.computeHash(
        BlockKind.ENHANCED_FOR,
        filePath,
        body.startPosition.row + 1,
        body.endPosition.row + 1,
        body.startPosition.column,
        body.endPosition.column,
        typeRegistryHash,
        this.blockMethodHash
      );

      if (this.shouldCreateBlockEntries) {
        const blockEntry = BlockRegistry.builder(
          BlockKind.ENHANCED_FOR, this.extractedBlocks.length, filePath,
          body.startPosition.row + 1, body.endPosition.row + 1,
          body.startPosition.column, body.endPosition.column,
          typeRegistryHash, this.blockMethodHash,
          ownerTypeName, ownerQualifiedName, ownerMethodName || ''
        )
          .withNestingDepth(this.blockNestingDepth);
        const enhForParentHash = this.scopeContext.getCurrentOwnerHash();
        if (enhForParentHash) blockEntry.withParentContainerHash(enhForParentHash);
        this.extractedBlocks.push(blockEntry.build());
      }
    }

    if (typeNode && nameNode) {
      const isFinal = this.hasFinalModifier(forNode);
      const isVarInferred = typeNode.type === 'type_identifier' && typeNode.text === 'var';

      const variableTypeName = EntityUtils.normalizeWhitespace(typeNode.text);
      const variableBaseType = this.extractBaseType(variableTypeName);

      let potentialQualifiedName: string | undefined;
      let isAmbiguous = false;
      if (!isVarInferred) {
        const resolved = resolveTypeQualifiedName(
          variableBaseType,
          packageName,
          importMap,
          hasStarImports
        );
        potentialQualifiedName = resolved.potentialQualifiedName ?? undefined;
        isAmbiguous = resolved.isAmbiguous;
      }

      const startLine = nameNode.startPosition.row + 1;
      const endLine = nameNode.endPosition.row + 1;

      const varBuilder = LocalVariableRegistry.builder(
        nameNode.text,
        variableTypeName,
        variableBaseType,
        filePath,
        startLine,
        endLine,
        LocalVariableScopeKind.ENHANCED_FOR_LOOP,
        typeRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        serviceVersionHash
      );

      if (potentialQualifiedName) {
        varBuilder.withPotentialQualifiedName(potentialQualifiedName);
      }
      varBuilder.withIsAmbiguous(isAmbiguous);
      varBuilder.withScopeDepth(lambdaDepth);
      varBuilder.withIsFinal(isFinal);
      varBuilder.withIsVarInferred(isVarInferred);

      if (methodRegistryHash) {
        varBuilder.withMethodRegistryLinkHash(methodRegistryHash);
      }
      if (ownerMethodName) {
        varBuilder.withOwnerMethodName(ownerMethodName);
      }
      // Link enhanced_for loop variable to its block
      if (enhancedForBlockHash) {
        varBuilder.withParentExpressionLinkHash(enhancedForBlockHash);
      }

      const localVar = varBuilder.build();
      variables.push(localVar);

      // Add enhanced for-loop variable name to tracking set for expression classification
      this.currentLocalVariableNames.add(nameNode.text);

      // Extract type references
      this.extractVariableTypeReferences(
        typeNode,
        typeRegistryHash,
        localVar.getHash(),
        packageName
      );
    }

    // Recurse into the loop body
    const enhForBody = forNode.childForFieldName('body');
    if (enhForBody && enhForBody.type === 'block') {
      // Enter ENHANCED_FOR block scope before recursing
      if (enhancedForBlockHash) {
        if (!this.isFieldInitializerContext) this.blockNestingDepth++;
        this.scopeContext.enterBlock(enhancedForBlockHash, BlockKind.ENHANCED_FOR, LocalVariableScopeKind.FOR_BLOCK);
      }
      this.extractFromBlock(
        enhForBody,
        filePath,
        typeRegistryHash,
        methodRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        ownerMethodName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        LocalVariableScopeKind.FOR_BLOCK,
        lambdaDepth,
        variables
      );
      if (enhancedForBlockHash) {
        this.scopeContext.exit();
        if (!this.isFieldInitializerContext) this.blockNestingDepth--;
      }
    } else if (enhForBody) {
      // Non-block body (single statement) - still enter ENHANCED_FOR scope so expressions link to block hash
      if (enhancedForBlockHash) {
        if (!this.isFieldInitializerContext) this.blockNestingDepth++;
        this.scopeContext.enterBlock(enhancedForBlockHash, BlockKind.ENHANCED_FOR, LocalVariableScopeKind.FOR_BLOCK);
      }
      this.extractFromBlock(
        enhForBody,
        filePath,
        typeRegistryHash,
        methodRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        ownerMethodName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        LocalVariableScopeKind.FOR_BLOCK,
        lambdaDepth,
        variables
      );
      if (enhancedForBlockHash) {
        this.scopeContext.exit();
        if (!this.isFieldInitializerContext) this.blockNestingDepth--;
      }
    }
  }

  /**
   * Extracts variables from a try statement (including try-with-resources)
   */
  private extractFromTryStatement(
    tryNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    parentScopeKind: LocalVariableScopeKind,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    // Determine block kind and compute hash for try block
    const isTryWithResources = tryNode.type === 'try_with_resources_statement';
    const tryKind = isTryWithResources ? BlockKind.TRY_WITH_RESOURCES : BlockKind.TRY;
    
    // Find the try body block to compute its hash
    const tryBodyBlock = tryNode.children.find(c => c.type === 'block');
    let tryBlockHash: string | undefined;
    if (tryBodyBlock && this.blockMethodHash) {
      tryBlockHash = BlockRegistry.computeHash(
        tryKind, filePath,
        tryBodyBlock.startPosition.row + 1, tryBodyBlock.endPosition.row + 1,
        tryBodyBlock.startPosition.column, tryBodyBlock.endPosition.column,
        typeRegistryHash, this.blockMethodHash
      );

      if (this.shouldCreateBlockEntries) {
        const tryBlockBuilder = BlockRegistry.builder(
          tryKind, this.extractedBlocks.length, filePath,
          tryBodyBlock.startPosition.row + 1, tryBodyBlock.endPosition.row + 1,
          tryBodyBlock.startPosition.column, tryBodyBlock.endPosition.column,
          typeRegistryHash, this.blockMethodHash,
          ownerTypeName, ownerQualifiedName, ownerMethodName || ''
        )
          .withNestingDepth(this.blockNestingDepth)
          .withTryStatementHash(tryBlockHash);
        const tryParentHash = this.scopeContext.getCurrentOwnerHash();
        if (tryParentHash) tryBlockBuilder.withParentContainerHash(tryParentHash);

        // Count resources for try-with-resources
        if (isTryWithResources) {
          const resourceSpec = tryNode.children.find(c => c.type === 'resource_specification');
          if (resourceSpec) {
            const resourceCount = resourceSpec.children.filter(c => c.type === 'resource').length;
            tryBlockBuilder.withResourceCount(resourceCount);
          }
        }

        this.extractedBlocks.push(tryBlockBuilder.build());
      }
    }
    
    for (const child of tryNode.children) {
      // Resource specification in try-with-resources
      if (child.type === 'resource_specification') {
        // Enter try block scope using ScopeContext
        if (tryBlockHash) {
          if (!this.isFieldInitializerContext) this.blockNestingDepth++;
          this.scopeContext.enterBlock(tryBlockHash, tryKind, LocalVariableScopeKind.TRY_BLOCK);
        }
        this.extractFromResourceSpecification(
          child,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          lambdaDepth,
          variables
        );
        // Exit resource spec scope
        if (tryBlockHash) {
          this.scopeContext.exit();
          if (!this.isFieldInitializerContext) this.blockNestingDepth--;
        }
      }
      // Try body block
      else if (child.type === 'block') {
        // Enter try block scope using ScopeContext
        if (tryBlockHash) {
          if (!this.isFieldInitializerContext) this.blockNestingDepth++;
          this.scopeContext.enterBlock(tryBlockHash, tryKind, LocalVariableScopeKind.TRY_BLOCK);
        }
        this.extractFromBlock(
          child,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          parentScopeKind,
          lambdaDepth,
          variables
        );
        // Exit try block scope
        if (tryBlockHash) {
          this.scopeContext.exit();
          if (!this.isFieldInitializerContext) this.blockNestingDepth--;
        }
      }
      // Catch clauses
      else if (child.type === 'catch_clause') {
        // Compute catch block hash
        const catchBody = child.children.find(c => c.type === 'block');
        let catchBlockHash: string | undefined;
        if (catchBody && this.blockMethodHash) {
          catchBlockHash = BlockRegistry.computeHash(
            BlockKind.CATCH, filePath,
            catchBody.startPosition.row + 1, catchBody.endPosition.row + 1,
            catchBody.startPosition.column, catchBody.endPosition.column,
            typeRegistryHash, this.blockMethodHash
          );

          if (this.shouldCreateBlockEntries) {
            const catchFormalParam = child.children.find(c => c.type === 'catch_formal_parameter');
            let caughtTypes = '';
            if (catchFormalParam) {
              const catchType = catchFormalParam.children.find(c => c.type === 'catch_type' || c.type === 'type_identifier');
              if (catchType) caughtTypes = EntityUtils.normalizeWhitespace(catchType.text);
            }
            const catchBlockBuilder = BlockRegistry.builder(
              BlockKind.CATCH, this.extractedBlocks.length, filePath,
              catchBody.startPosition.row + 1, catchBody.endPosition.row + 1,
              catchBody.startPosition.column, catchBody.endPosition.column,
              typeRegistryHash, this.blockMethodHash,
              ownerTypeName, ownerQualifiedName, ownerMethodName || ''
            )
              .withNestingDepth(this.blockNestingDepth);
            const catchParentHash = this.scopeContext.getCurrentOwnerHash();
            if (catchParentHash) catchBlockBuilder.withParentContainerHash(catchParentHash);
            if (tryBlockHash) catchBlockBuilder.withTryStatementHash(tryBlockHash);
            if (caughtTypes) catchBlockBuilder.withCaughtExceptionTypes(caughtTypes);
            this.extractedBlocks.push(catchBlockBuilder.build());
          }

          // Enter catch block scope using ScopeContext
          if (!this.isFieldInitializerContext) this.blockNestingDepth++;
          this.scopeContext.enterBlock(catchBlockHash, BlockKind.CATCH, LocalVariableScopeKind.CATCH_BLOCK);
        }
        this.extractFromCatchClause(
          child,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          lambdaDepth,
          variables
        );
        // Exit catch block scope
        if (catchBlockHash) {
          this.scopeContext.exit();
          if (!this.isFieldInitializerContext) this.blockNestingDepth--;
        }
      }
      // Finally block
      else if (child.type === 'finally_clause') {
        const finallyBlock = child.children.find(c => c.type === 'block');
        if (finallyBlock) {
          // Compute finally block hash
          const finallyBlockHash = this.blockMethodHash ? BlockRegistry.computeHash(
            BlockKind.FINALLY, filePath,
            finallyBlock.startPosition.row + 1, finallyBlock.endPosition.row + 1,
            finallyBlock.startPosition.column, finallyBlock.endPosition.column,
            typeRegistryHash, this.blockMethodHash
          ) : undefined;

          if (this.shouldCreateBlockEntries && finallyBlockHash) {
            const finallyBlockBuilder = BlockRegistry.builder(
              BlockKind.FINALLY, this.extractedBlocks.length, filePath,
              finallyBlock.startPosition.row + 1, finallyBlock.endPosition.row + 1,
              finallyBlock.startPosition.column, finallyBlock.endPosition.column,
              typeRegistryHash, this.blockMethodHash,
              ownerTypeName, ownerQualifiedName, ownerMethodName || ''
            )
              .withNestingDepth(this.blockNestingDepth);
            const finallyParentHash = this.scopeContext.getCurrentOwnerHash();
            if (finallyParentHash) finallyBlockBuilder.withParentContainerHash(finallyParentHash);
            if (tryBlockHash) finallyBlockBuilder.withTryStatementHash(tryBlockHash);
            this.extractedBlocks.push(finallyBlockBuilder.build());
          }

          // Enter finally block scope using ScopeContext
          if (finallyBlockHash) {
            if (!this.isFieldInitializerContext) this.blockNestingDepth++;
            this.scopeContext.enterBlock(finallyBlockHash, BlockKind.FINALLY, LocalVariableScopeKind.FINALLY_BLOCK);
          }
          this.extractFromBlock(
            finallyBlock,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            parentScopeKind,
            lambdaDepth,
            variables
          );
          // Exit finally block scope
          this.scopeContext.exit();
          if (finallyBlockHash) {
            if (!this.isFieldInitializerContext) this.blockNestingDepth--;
          }
        }
      }
    }
  }

  /**
   * Extracts variables from try-with-resources specification
   * Example: try (var reader = new BufferedReader(...))
   */
  private extractFromResourceSpecification(
    resourceSpec: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    for (const child of resourceSpec.children) {
      if (child.type === 'resource') {
        // Resource has structure: [final] type identifier = expression
        const typeNode = this.findTypeNode(child);
        const nameNode = child.children.find(c => c.type === 'identifier');

        if (typeNode && nameNode) {
          const isFinal = this.hasFinalModifier(child);
          const isVarInferred = typeNode.type === 'type_identifier' && typeNode.text === 'var';

          const variableTypeName = typeNode.text;
          const variableBaseType = this.extractBaseType(variableTypeName);

          let potentialQualifiedName: string | undefined;
          let isAmbiguous = false;
          if (!isVarInferred) {
            const resolved = resolveTypeQualifiedName(
              variableBaseType,
              packageName,
              importMap,
              hasStarImports
            );
            potentialQualifiedName = resolved.potentialQualifiedName ?? undefined;
            isAmbiguous = resolved.isAmbiguous;
          }

          const startLine = nameNode.startPosition.row + 1;
          const endLine = nameNode.endPosition.row + 1;

          const varBuilder = LocalVariableRegistry.builder(
            nameNode.text,
            variableTypeName,
            variableBaseType,
            filePath,
            startLine,
            endLine,
            LocalVariableScopeKind.TRY_WITH_RESOURCES,
            typeRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            serviceVersionHash
          );

          if (potentialQualifiedName) {
            varBuilder.withPotentialQualifiedName(potentialQualifiedName);
          }
          varBuilder.withIsAmbiguous(isAmbiguous);
          varBuilder.withScopeDepth(lambdaDepth);
          varBuilder.withIsFinal(isFinal || true); // Resources are effectively final
          varBuilder.withIsVarInferred(isVarInferred);

          if (methodRegistryHash) {
            varBuilder.withMethodRegistryLinkHash(methodRegistryHash);
          }
          if (ownerMethodName) {
            varBuilder.withOwnerMethodName(ownerMethodName);
          }
          // Link to containing try block using ScopeContext
          const ownerHash = this.scopeContext.getCurrentOwnerHash();
          if (ownerHash) {
            varBuilder.withParentExpressionLinkHash(ownerHash);
          }

          const localVar = varBuilder.build();
          variables.push(localVar);

          // Add resource variable name to tracking set for expression classification
          this.currentLocalVariableNames.add(nameNode.text);

          // Extract type references
          this.extractVariableTypeReferences(
            typeNode,
            typeRegistryHash,
            localVar.getHash(),
            packageName
          );

          // Extract initializer expressions
          const equalsIndex = child.children.findIndex(c => c.type === '=');
          if (equalsIndex >= 0 && equalsIndex < child.children.length - 1) {
            const initializerNode = child.children[equalsIndex + 1];
            if (initializerNode) {
              this.extractInitializerExpressions(
                initializerNode,
                typeRegistryHash,
                localVar.getHash(),
                serviceVersionHash,
                packageName,
                importMap,
                hasStarImports
              );

              // Extract local variables from lambda block bodies in the initializer
              this.extractLambdasFromInitializer(
                initializerNode,
                filePath,
                typeRegistryHash,
                methodRegistryHash,
                ownerTypeName,
                ownerQualifiedName,
                ownerMethodName,
                serviceVersionHash,
                packageName,
                importMap,
                hasStarImports,
                lambdaDepth,
                variables,
                localVar.getHash()
              );
            }
          }
        }
      }
    }
  }

  /**
   * Extracts the exception variable from a catch clause
   * Example: catch (IOException e)
   */
  private extractFromCatchClause(
    catchNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    // Find catch_formal_parameter
    const catchParam = catchNode.children.find(c => c.type === 'catch_formal_parameter');
    if (catchParam) {
      // Can be single type or multi-catch: IOException | SQLException
      const catchType = catchParam.children.find(c => 
        c.type === 'catch_type' || 
        c.type === 'type_identifier' ||
        c.type === 'scoped_type_identifier'
      );
      const nameNode = catchParam.children.find(c => c.type === 'identifier');

      if (catchType && nameNode) {
        // For multi-catch, type could be "IOException | SQLException"
        const variableTypeName = EntityUtils.normalizeWhitespace(catchType.text);
        const variableBaseType = this.extractBaseType((variableTypeName.split('|')[0] ?? '').trim());

        const resolved = resolveTypeQualifiedName(
          variableBaseType,
          packageName,
          importMap,
          hasStarImports
        );

        const startLine = nameNode.startPosition.row + 1;
        const endLine = nameNode.endPosition.row + 1;

        const varBuilder = LocalVariableRegistry.builder(
          nameNode.text,
          variableTypeName,
          variableBaseType,
          filePath,
          startLine,
          endLine,
          LocalVariableScopeKind.CATCH_CLAUSE,
          typeRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          serviceVersionHash
        );

        if (resolved.potentialQualifiedName) {
          varBuilder.withPotentialQualifiedName(resolved.potentialQualifiedName);
        }
        varBuilder.withIsAmbiguous(resolved.isAmbiguous);
        varBuilder.withScopeDepth(lambdaDepth);
        varBuilder.withIsFinal(true); // Catch variables are effectively final

        if (methodRegistryHash) {
          varBuilder.withMethodRegistryLinkHash(methodRegistryHash);
        }
        if (ownerMethodName) {
          varBuilder.withOwnerMethodName(ownerMethodName);
        }
        // Link to containing catch block using ScopeContext
        const ownerHash = this.scopeContext.getCurrentOwnerHash();
        if (ownerHash) {
          varBuilder.withParentExpressionLinkHash(ownerHash);
        }

        const localVar = varBuilder.build();
        variables.push(localVar);

        // Add exception variable name to tracking set for expression classification
        this.currentLocalVariableNames.add(nameNode.text);

        // Extract type references for the exception type(s)
        if (catchType.type === 'catch_type') {
          // Multi-catch: extract a type reference for each exception type
          let pos = 0;
          for (const typeChild of catchType.children) {
            if (typeChild.type === 'type_identifier' || typeChild.type === 'scoped_type_identifier' || typeChild.type === 'annotated_type') {
              const typeRefs = this.typeReferenceExtractor.extractFromLocalVariable(
                typeChild,
                typeRegistryHash,
                localVar.getHash(),
                packageName,
                new Set(),
                pos
              );
              this.extractedTypeReferences.push(...typeRefs);
              pos++;
            }
          }
        } else {
          // Single catch type
          this.extractVariableTypeReferences(
            catchType,
            typeRegistryHash,
            localVar.getHash(),
            packageName
          );
        }
      }
    }

    // Extract from catch block body
    const catchBody = catchNode.children.find(c => c.type === 'block');
    if (catchBody) {
      this.extractFromBlock(
        catchBody,
        filePath,
        typeRegistryHash,
        methodRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        ownerMethodName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        LocalVariableScopeKind.METHOD_BODY,
        lambdaDepth,
        variables
      );
    }
  }

  /**
   * Extracts variables from a lambda expression body
   */
  private extractFromLambdaExpression(
    lambdaNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    // Extract lambda parameter names for LAMBDA_PARAMETER classification
    const lambdaParamNames = extractLambdaParameterNames(lambdaNode);

    // Find the lambda expression hash from already-extracted expressions
    // Match by position (startLine, startColumn, endLine, endColumn)
    const lambdaStartLine = lambdaNode.startPosition.row + 1;
    const lambdaStartCol = lambdaNode.startPosition.column;
    const lambdaEndLine = lambdaNode.endPosition.row + 1;
    const lambdaEndCol = lambdaNode.endPosition.column;
    
    // Search in expressionsForHashLookup (passed from parent extractor) first,
    // then in extractedExpressions (from local variable initializers in current extraction)
    let lambdaExpression = this.expressionsForHashLookup.find(expr => 
      expr.getStartLine() === lambdaStartLine &&
      expr.getStartColumn() === lambdaStartCol &&
      expr.getEndLine() === lambdaEndLine &&
      expr.getEndColumn() === lambdaEndCol
    );
    // If not found in parent's array, search in our own extracted expressions
    // (lambdas from local variable initializers are added here)
    if (!lambdaExpression) {
      lambdaExpression = this.extractedExpressions.find(expr => 
        expr.getStartLine() === lambdaStartLine &&
        expr.getStartColumn() === lambdaStartCol &&
        expr.getEndLine() === lambdaEndLine &&
        expr.getEndColumn() === lambdaEndCol
      );
    }
    const lambdaHash = lambdaExpression?.getHash();

    // Check if this lambda is inside a local_variable_declaration by walking up AST
    // This determines if we should extract return/expression statements
    // (TypeMethodExtractor skips lambdas in local var declarations)
    const isFromLocalVarInitializer = this.isLambdaInLocalVarDeclaration(lambdaNode);

    // Use ScopeContext to enter lambda - this automatically:
    // 1. Saves and restores lambda params
    // 2. Resets block context (lambda creates scope boundary)
    // 3. Tracks the lambda hash for child variable/expression linking
    // 4. Tracks if this is a local var initializer lambda (for statement extraction)
    this.scopeContext.enterLambda(lambdaHash, lambdaParamNames, isFromLocalVarInitializer);

    // Lambda has structure: parameters -> body
    // Body can be block or expression
    for (const child of lambdaNode.children) {
      if (child.type === 'block') {
        this.extractFromBlock(
          child,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          LocalVariableScopeKind.LAMBDA_BODY,
          lambdaDepth,
          variables
        );
      } else if (child.type === 'lambda_expression') {
        // Nested lambda
        this.extractFromLambdaExpression(
          child,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          lambdaDepth + 1,
          variables
        );
      } else if (child.type !== '->' && child.type !== 'formal_parameters' &&
                 child.type !== 'inferred_parameters' && child.type !== 'identifier') {
        // Expression-body lambda (no {}): the body is an arbitrary expression that may
        // contain nested block lambdas or control flow. Recurse via extractFromBlock so
        // nested lambdas, blocks, and local variables are properly discovered.
        // e.g.: list.forEach(x -> otherList.removeIf(y -> { if (...) { ... } }))
        this.extractFromBlock(
          child,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          LocalVariableScopeKind.LAMBDA_BODY,
          lambdaDepth,
          variables
        );
      }
    }

    // Exit lambda scope - ScopeContext restores previous state
    this.scopeContext.exit();
  }

  /**
   * Extracts pattern binding variables from instanceof and switch patterns
   */
  private extractPatternsFromStatement(
    statementNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    // Recursively search for instanceof_expression with pattern
    this.findAndExtractPatterns(
      statementNode,
      filePath,
      typeRegistryHash,
      methodRegistryHash,
      ownerTypeName,
      ownerQualifiedName,
      ownerMethodName,
      serviceVersionHash,
      packageName,
      importMap,
      hasStarImports,
      lambdaDepth,
      variables
    );
  }

  /**
   * Recursively finds and extracts pattern bindings
   */
  private findAndExtractPatterns(
    node: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    if (node.type === 'instanceof_expression') {
      // Check for pattern: obj instanceof String s
      // Pattern is typically a type_pattern or record_pattern child
      for (const child of node.children) {
        if (child.type === 'type_pattern' || child.type === 'binding_pattern') {
          this.extractPatternBinding(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            lambdaDepth,
            LocalVariableScopeKind.INSTANCEOF_PATTERN,
            variables
          );
        } else if (child.type === 'record_pattern') {
          this.extractRecordPatternBindings(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            lambdaDepth,
            variables
          );
        }
      }
    } else if (node.type === 'switch_label') {
      // Check for case patterns in switch
      // Tree-sitter wraps patterns in a 'pattern' node: switch_label -> pattern -> type_pattern/record_pattern
      for (const child of node.children) {
        if (child.type === 'pattern') {
          // Unwrap the pattern node
          for (const patternChild of child.children) {
            if (patternChild.type === 'type_pattern' || patternChild.type === 'binding_pattern') {
              this.extractPatternBinding(
                patternChild,
                filePath,
                typeRegistryHash,
                methodRegistryHash,
                ownerTypeName,
                ownerQualifiedName,
                ownerMethodName,
                serviceVersionHash,
                packageName,
                importMap,
                hasStarImports,
                lambdaDepth,
                LocalVariableScopeKind.SWITCH_PATTERN,
                variables
              );
            } else if (patternChild.type === 'record_pattern') {
              this.extractRecordPatternBindings(
                patternChild,
                filePath,
                typeRegistryHash,
                methodRegistryHash,
                ownerTypeName,
                ownerQualifiedName,
                ownerMethodName,
                serviceVersionHash,
                packageName,
                importMap,
                hasStarImports,
                lambdaDepth,
                variables
              );
            }
          }
        } else if (child.type === 'type_pattern' || child.type === 'binding_pattern') {
          // Direct pattern (fallback for older tree-sitter versions)
          this.extractPatternBinding(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            lambdaDepth,
            LocalVariableScopeKind.SWITCH_PATTERN,
            variables
          );
        } else if (child.type === 'record_pattern') {
          this.extractRecordPatternBindings(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            lambdaDepth,
            variables
          );
        }
      }
    }

    // Recurse into children
    for (const child of node.children) {
      this.findAndExtractPatterns(
        child,
        filePath,
        typeRegistryHash,
        methodRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        ownerMethodName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        lambdaDepth,
        variables
      );
    }
  }

  /**
   * Extracts a single pattern binding variable
   */
  private extractPatternBinding(
    patternNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    lambdaDepth: number,
    scopeKind: LocalVariableScopeKind,
    variables: LocalVariableRegistry[]
  ): void {
    const typeNode = this.findTypeNode(patternNode);
    const nameNode = patternNode.children.find(c => c.type === 'identifier');

    if (typeNode && nameNode) {
      const variableTypeName = EntityUtils.normalizeWhitespace(typeNode.text);
      const variableBaseType = this.extractBaseType(variableTypeName);

      const resolved = resolveTypeQualifiedName(
        variableBaseType,
        packageName,
        importMap,
        hasStarImports
      );

      const startLine = nameNode.startPosition.row + 1;
      const endLine = nameNode.endPosition.row + 1;

      const varBuilder = LocalVariableRegistry.builder(
        nameNode.text,
        variableTypeName,
        variableBaseType,
        filePath,
        startLine,
        endLine,
        scopeKind,
        typeRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        serviceVersionHash
      );

      if (resolved.potentialQualifiedName) {
        varBuilder.withPotentialQualifiedName(resolved.potentialQualifiedName);
      }
      varBuilder.withIsAmbiguous(resolved.isAmbiguous);
      varBuilder.withScopeDepth(lambdaDepth);
      varBuilder.withIsFinal(true); // Pattern bindings are effectively final

      if (methodRegistryHash) {
        varBuilder.withMethodRegistryLinkHash(methodRegistryHash);
      }
      if (ownerMethodName) {
        varBuilder.withOwnerMethodName(ownerMethodName);
      }

      const localVar = varBuilder.build();
      variables.push(localVar);
    }
  }

  /**
   * Extracts bindings from record patterns (deconstruction)
   * Example: if (obj instanceof Point(int x, int y) p)
   * 
   * Tree-sitter AST structure:
   * record_pattern
   *   identifier: "Point"
   *   record_pattern_body
   *     record_pattern_component
   *       integral_type / type_identifier
   *       identifier: "x"
   *     record_pattern_component
   *       integral_type / type_identifier
   *       identifier: "y"
   */
  private extractRecordPatternBindings(
    recordPatternNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    // Record pattern: RecordType(pattern1, pattern2, ...) [identifier]
    for (const child of recordPatternNode.children) {
      if (child.type === 'record_pattern_body') {
        // Extract components from the record pattern body
        for (const component of child.children) {
          if (component.type === 'record_pattern_component') {
            this.extractRecordPatternComponent(
              component,
              filePath,
              typeRegistryHash,
              methodRegistryHash,
              ownerTypeName,
              ownerQualifiedName,
              ownerMethodName,
              serviceVersionHash,
              packageName,
              importMap,
              hasStarImports,
              lambdaDepth,
              variables
            );
          } else if (component.type === 'record_pattern') {
            // A component that is itself a deconstruction, as in
            // `Pair(Pair(Leaf x, Node i2), Node i3)`.
            //
            // The nested pattern is a direct child of the record_pattern_body, not wrapped in a
            // record_pattern_component, so a loop that matched only components skipped it and
            // every binding below the top level was recorded by nothing. There was a recursive
            // branch already, but on the children of record_pattern rather than of its body,
            // where a nested pattern never appears.
            //
            // Matching a shape more than one level deep is the point of JEP 440, so this is the
            // ordinary case rather than an edge one.
            this.extractRecordPatternBindings(
              component,
              filePath,
              typeRegistryHash,
              methodRegistryHash,
              ownerTypeName,
              ownerQualifiedName,
              ownerMethodName,
              serviceVersionHash,
              packageName,
              importMap,
              hasStarImports,
              lambdaDepth,
              variables
            );
          }
        }
      } else if (child.type === 'type_pattern' || child.type === 'binding_pattern') {
        this.extractPatternBinding(
          child,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          lambdaDepth,
          LocalVariableScopeKind.RECORD_PATTERN,
          variables
        );
      } else if (child.type === 'record_pattern') {
        // Nested record pattern
        this.extractRecordPatternBindings(
          child,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          lambdaDepth,
          variables
        );
      } else if (child.type === 'identifier') {
        // The outer binding name (e.g., 'p' in Point(int x, int y) p)
        // Need to get the record type from earlier sibling
        const typeNode = recordPatternNode.children.find(c => 
          c.type === 'type_identifier' || 
          c.type === 'scoped_type_identifier' ||
          c.type === 'generic_type'
        );
        
        if (typeNode) {
          const variableTypeName = EntityUtils.normalizeWhitespace(typeNode.text);
          const variableBaseType = this.extractBaseType(variableTypeName);

          const resolved = resolveTypeQualifiedName(
            variableBaseType,
            packageName,
            importMap,
            hasStarImports
          );

          const startLine = child.startPosition.row + 1;
          const endLine = child.endPosition.row + 1;

          const varBuilder = LocalVariableRegistry.builder(
            child.text,
            variableTypeName,
            variableBaseType,
            filePath,
            startLine,
            endLine,
            LocalVariableScopeKind.RECORD_PATTERN,
            typeRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            serviceVersionHash
          );

          if (resolved.potentialQualifiedName) {
            varBuilder.withPotentialQualifiedName(resolved.potentialQualifiedName);
          }
          varBuilder.withIsAmbiguous(resolved.isAmbiguous);
          varBuilder.withScopeDepth(lambdaDepth);
          varBuilder.withIsFinal(true);

          if (methodRegistryHash) {
            varBuilder.withMethodRegistryLinkHash(methodRegistryHash);
          }
          if (ownerMethodName) {
            varBuilder.withOwnerMethodName(ownerMethodName);
          }

          const localVar = varBuilder.build();
          variables.push(localVar);
        }
      }
    }
  }

  /**
   * Extracts a single binding from a record_pattern_component
   * Structure: record_pattern_component -> type (integral_type/type_identifier) + identifier
   */
  private extractRecordPatternComponent(
    componentNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    lambdaDepth: number,
    variables: LocalVariableRegistry[]
  ): void {
    const typeNode = this.findTypeNode(componentNode);
    const nameNode = componentNode.children.find(c => c.type === 'identifier');

    if (typeNode && nameNode) {
      const variableTypeName = EntityUtils.normalizeWhitespace(typeNode.text);
      const variableBaseType = this.extractBaseType(variableTypeName);

      const resolved = resolveTypeQualifiedName(
        variableBaseType,
        packageName,
        importMap,
        hasStarImports
      );

      const startLine = nameNode.startPosition.row + 1;
      const endLine = nameNode.endPosition.row + 1;

      const varBuilder = LocalVariableRegistry.builder(
        nameNode.text,
        variableTypeName,
        variableBaseType,
        filePath,
        startLine,
        endLine,
        LocalVariableScopeKind.RECORD_PATTERN,
        typeRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        serviceVersionHash
      );

      if (resolved.potentialQualifiedName) {
        varBuilder.withPotentialQualifiedName(resolved.potentialQualifiedName);
      }
      varBuilder.withIsAmbiguous(resolved.isAmbiguous);
      varBuilder.withScopeDepth(lambdaDepth);
      varBuilder.withIsFinal(true); // Pattern bindings are effectively final

      if (methodRegistryHash) {
        varBuilder.withMethodRegistryLinkHash(methodRegistryHash);
      }
      if (ownerMethodName) {
        varBuilder.withOwnerMethodName(ownerMethodName);
      }

      const localVar = varBuilder.build();
      variables.push(localVar);
    }
  }

  // === Helper Methods ===

  /**
   * Checks if a declaration has a final modifier
   */
  private hasFinalModifier(declNode: Parser.SyntaxNode): boolean {
    const modifiersNode = declNode.children.find(c => c.type === 'modifiers');
    if (!modifiersNode) return false;

    return modifiersNode.children.some(c => c.type === 'final');
  }

  /**
   * Finds the type node in a declaration
   */
  private findTypeNode(declNode: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
    const typeNodeTypes = [
      'type_identifier',
      'scoped_type_identifier',
      'generic_type',
      'array_type',
      'integral_type',
      'floating_point_type',
      'boolean_type',
    ];

    for (const child of declNode.children) {
      if (typeNodeTypes.includes(child.type)) {
        return child;
      }
    }

    return undefined;
  }

  /**
   * Checks if a lambda node is inside a local_variable_declaration by walking up the AST.
   * This is more robust than tracking where the lambda was found during extraction.
   * Stops at method body boundary (block that's a direct child of method/constructor).
   */
  private isLambdaInLocalVarDeclaration(lambdaNode: Parser.SyntaxNode): boolean {
    let current: Parser.SyntaxNode | null = lambdaNode.parent;
    while (current) {
      // Found a local variable declaration or resource (try-with-resources) - this lambda is in a local var initializer
      if (current.type === 'local_variable_declaration' || current.type === 'resource') {
        return true;
      }
      // Stop at method body boundary
      if (current.type === 'block' && current.parent && 
          (current.parent.type === 'method_declaration' || 
           current.parent.type === 'constructor_declaration' ||
           current.parent.type === 'lambda_expression')) {
        return false;
      }
      current = current.parent;
    }
    return false;
  }

  /**
   * Extracts the base type from a full type name
   */
  private extractBaseType(fullTypeName: string): string {
    let baseType = fullTypeName;
    
    // Strip array brackets
    baseType = baseType.replace(/(\s*@\w+\s*)?\[\]/g, '');
    
    // Strip generics
    const genericStart = baseType.indexOf('<');
    if (genericStart !== -1) {
      baseType = baseType.substring(0, genericStart);
    }
    
    // Strip annotations
    baseType = baseType.replace(/@\w+\s*/g, '');
    
    return baseType.trim();
  }

  /**
   * Extracts type references from a variable type node
   */
  private extractVariableTypeReferences(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    localVariableHash: string,
    packageName: string | null
  ): void {
    // Skip 'var' inferred types - no type reference to extract
    if (typeNode.type === 'var') {
      return;
    }
    
    // Extract type references for the variable type (handles generics, nested types)
    const typeRefs = this.typeReferenceExtractor.extractFromLocalVariable(
      typeNode,
      typeRegistryHash,
      localVariableHash,
      packageName
    );
    this.extractedTypeReferences.push(...typeRefs);
  }

  /**
   * Extracts expressions from a variable initializer
   */
  private extractInitializerExpressions(
    initializerNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    localVariableHash: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean
  ): void {
    const expressions = this.expressionExtractor.extractFromLocalVariableInitializer(
      initializerNode,
      typeRegistryHash,
      localVariableHash,
      serviceVersionHash,
      packageName,
      importMap,
      hasStarImports,
      this.currentMethodParamNames,
      this.currentLocalVariableNames,
      this.scopeContext.getLambdaParamNames(),
      this.currentPatternBindingNames
    );
    this.extractedExpressions.push(...expressions);
    // Note: Lambdas from local variable initializers are now found by searching
    // extractedExpressions in extractFromLambdaExpression, so no need to add to
    // expressionsForHashLookup (which would cause duplicates when collected later)

    // Collect type references from expressions
    const expressionTypeRefs = this.expressionExtractor.getExtractedTypeReferences();
    this.extractedTypeReferences.push(...expressionTypeRefs);

    // Collect annotations from expressions
    const expressionAnnotations = this.expressionExtractor.getExtractedAnnotations();
    this.extractedAnnotations.push(...expressionAnnotations);

    // Collect anonymous classes from expressions
    const anonymousClasses = this.expressionExtractor.getExtractedAnonymousClasses();
    this.extractedAnonymousClasses.push(...anonymousClasses);
  }

  /**
   * Extracts annotations from a local variable declaration
   */
  private extractLocalVariableAnnotations(
    declNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    localVariableHash: string
  ): void {
    const modifiersNode = declNode.children.find(c => c.type === 'modifiers');
    if (!modifiersNode) return;

    // Reset annotation extractor to avoid duplicate arguments
    this.annotationExtractor.resetExtractedArguments();

    for (const child of modifiersNode.children) {
      if (child.type === 'marker_annotation' || child.type === 'annotation') {
        const annotations = this.annotationExtractor.extractFromLocalVariableDeclaration(
          declNode,
          localVariableHash,
          typeRegistryHash
        );
        this.extractedAnnotations.push(...annotations);

        // Collect annotation arguments
        const args = this.annotationExtractor.getExtractedArguments();
        this.extractedAnnotationArguments.push(...args);
        break; // extractFromLocalVariableDeclaration handles all annotations
      }
    }
  }

  /**
   * Extracts expressions from return/expression/yield statements inside METHOD BODY lambda bodies.
   * This handles lambdas inside local variable declarations which TypeMethodExtractor skips
   * (TypeMethodExtractor only handles lambdas at expression_statement level, not in local var initializers).
   */
  private extractLambdaBodyStatementExpressions(
    statementNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    _serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean
  ): void {
    // Must be inside a lambda to extract these statements
    const lambdaHash = this.scopeContext.getCurrentLambdaHash();
    if (!lambdaHash) return;

    // An arrow arm of a switch used as a VALUE is not a statement of the enclosing body, even
    // though it is written as one. The method walk already declines to collect these; a field
    // initializer is walked here instead, and without the same guard every arm of a switch inside
    // an initializer lambda was emitted a second time under EXPRESSION_STATEMENT/ROOT - a root
    // context the source does not have.
    if (JavaTreeSitterUtils.isValueProducingSwitchArm(statementNode)) return;

    const statementKey = `${statementNode.startIndex}:${statementNode.endIndex}`;
    if (this.extractedLambdaStatements.has(statementKey)) return;
    this.extractedLambdaStatements.add(statementKey);

    // In field initializer context, extract ALL lambda statements (no TypeMethodExtractor involvement).
    // In method body context, only extract for lambdas from local var initializers
    // (TypeMethodExtractor handles lambdas at expression_statement level).
    if (!this.isFieldInitializerContext && !this.scopeContext.isCurrentLambdaFromLocalVarInitializer()) return;

    // Use ScopeContext to get the correct owner hash (block > lambda)
    const ownerHash = this.scopeContext.getCurrentOwnerHash();
    if (!ownerHash) return;

    let expressions: ExpressionReference[];
    
    if (statementNode.type === 'return_statement') {
      // Extract return statement expressions - TypeMethodExtractor skips lambdas in local var decls
      expressions = this.expressionExtractor.extractFromReturnStatement(
        statementNode,
        typeRegistryHash,
        ownerHash,
        packageName,
        importMap,
        hasStarImports,
        this.currentMethodParamNames,
        undefined, // returnStatementIndex - not tracked for local var lambda returns
        this.currentLocalVariableNames,
        this.scopeContext.getLambdaParamNames()
      );
    } else if (statementNode.type === 'expression_statement') {
      // Extract expression statement expressions - TypeMethodExtractor skips lambdas in local var decls
      expressions = this.expressionExtractor.extractFromExpressionStatement(
        statementNode,
        typeRegistryHash,
        ownerHash,
        packageName,
        importMap,
        hasStarImports,
        this.currentMethodParamNames,
        this.currentLocalVariableNames,
        this.scopeContext.getLambdaParamNames()
      );
    } else if (statementNode.type === 'throw_statement') {
      // A `throw`-only lambda is the standard "disabled implementation" constant on an
      // interface, and in a FIELD initializer nothing else extracts it: TypeMethodExtractor's
      // throw walk covers method bodies, including lambdas inside a local-variable
      // declaration, but never reaches a field initializer. Restricted to that context for
      // exactly that reason — running it for a method-body lambda would emit every throw twice.
      if (!this.isFieldInitializerContext) return;
      expressions = this.expressionExtractor.extractFromThrowStatement(
        statementNode,
        typeRegistryHash,
        ownerHash,
        packageName,
        importMap,
        hasStarImports,
        this.currentMethodParamNames,
        undefined, // throwStatementIndex - not tracked for field initializer lambdas
        this.currentLocalVariableNames,
        this.scopeContext.getLambdaParamNames()
      );
    } else if (statementNode.type === 'yield_statement') {
      // yield statements in switch expression blocks are extracted by
      // ExpressionReferenceExtractor as SWITCH_CASE_RESULT - skip here to avoid duplication
      return;
    } else {
      return;
    }

    this.extractedExpressions.push(...expressions);

    // Collect type references from expressions
    const expressionTypeRefs = this.expressionExtractor.getExtractedTypeReferences();
    this.extractedTypeReferences.push(...expressionTypeRefs);

    // Collect annotations from expressions
    const expressionAnnotations = this.expressionExtractor.getExtractedAnnotations();
    this.extractedAnnotations.push(...expressionAnnotations);
  }


  /**
   * Recursively finds and extracts local variables from lambda block bodies 
   * and switch expression yield blocks in an initializer
   */
  private extractLambdasFromInitializer(
    node: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    lambdaDepth: number,
    variables: LocalVariableRegistry[],
    parentContainerHash?: string
  ): void {
    if (node.type === 'lambda_expression') {
      // Process this lambda's block body if it has one
      this.extractFromLambdaExpression(
        node,
        filePath,
        typeRegistryHash,
        methodRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        ownerMethodName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        lambdaDepth + 1,
        variables
      );
    } else if (node.type === 'switch_expression') {
      // Process switch expression blocks (case -> { ... yield ... })
      this.extractFromSwitchExpressionBlocks(
        node,
        filePath,
        typeRegistryHash,
        methodRegistryHash,
        ownerTypeName,
        ownerQualifiedName,
        ownerMethodName,
        serviceVersionHash,
        packageName,
        importMap,
        hasStarImports,
        lambdaDepth + 1,
        variables,
        parentContainerHash
      );
    } else {
      // Recursively search children for lambda expressions and switch expressions
      for (const child of node.children) {
        // An anonymous class body is extracted separately, as the anonymous class's own methods,
        // with the correct method hash. Descending into one here found the lambdas inside its
        // methods a second time, so every local declared in such a lambda was recorded twice:
        // once under the anonymous method and once under the enclosing method's initializer walk.
        //
        // `extractFromBlock` already declines to cross this boundary for the same reason. Only
        // locals INSIDE a lambda duplicated, because the plain locals of an anonymous method are
        // not reached by this initializer search at all.
        //
        // A local class body is not skipped: it is not extracted anywhere else.
        if (child.type === 'class_body' && child.parent?.type === 'object_creation_expression') {
          continue;
        }

        this.extractLambdasFromInitializer(
          child,
          filePath,
          typeRegistryHash,
          methodRegistryHash,
          ownerTypeName,
          ownerQualifiedName,
          ownerMethodName,
          serviceVersionHash,
          packageName,
          importMap,
          hasStarImports,
          lambdaDepth,
          variables,
          parentContainerHash
        );
      }
    }
  }

  /**
   * Extracts local variables and yield expressions from switch expression blocks
   */
  private extractFromSwitchExpressionBlocks(
    switchExprNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    methodRegistryHash: string | undefined,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string | undefined,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    lambdaDepth: number,
    variables: LocalVariableRegistry[],
    parentContainerHash?: string
  ): void {
    // Save previous pattern binding names
    const previousPatternBindingNames = new Set(this.currentPatternBindingNames);

    // Find switch_block containing switch_rule or switch_block_statement_group nodes
    const switchBlock = switchExprNode.children.find(c => c.type === 'switch_block');
    if (switchBlock) {
      for (const child of switchBlock.children) {
        if (child.type === 'switch_rule') {
          // Arrow syntax: case X -> { ... } or case X -> expr;
          const block = child.children.find(c => c.type === 'block');
          if (block) {
            // Compute BlockRegistry hash for SWITCH_EXPRESSION_CASE
            let caseBlockHash: string | null = null;
            if (this.blockMethodHash) {
              caseBlockHash = BlockRegistry.computeHash(
                BlockKind.SWITCH_EXPRESSION_CASE,
                filePath,
                block.startPosition.row + 1,
                block.endPosition.row + 1,
                block.startPosition.column,
                block.endPosition.column,
                typeRegistryHash,
                this.blockMethodHash
              );

              if (this.shouldCreateBlockEntries) {
                const blockEntry = BlockRegistry.builder(
                  BlockKind.SWITCH_EXPRESSION_CASE, this.extractedBlocks.length, filePath,
                  block.startPosition.row + 1, block.endPosition.row + 1,
                  block.startPosition.column, block.endPosition.column,
                  typeRegistryHash, this.blockMethodHash,
                  ownerTypeName, ownerQualifiedName, ownerMethodName || ''
                )
                  .withNestingDepth(this.blockNestingDepth);
                // Use explicit parentContainerHash (from local variable) if provided,
                // otherwise fall back to scope context (for non-initializer contexts)
                const resolvedParentHash = parentContainerHash || this.scopeContext.getCurrentOwnerHash();
                if (resolvedParentHash) blockEntry.withParentContainerHash(resolvedParentHash);
                this.extractedBlocks.push(blockEntry.build());
              }
            }

            // Enter SWITCH_EXPRESSION_CASE scope
            if (caseBlockHash) {
              if (!this.isFieldInitializerContext) this.blockNestingDepth++;
              this.scopeContext.enterBlock(caseBlockHash, BlockKind.SWITCH_EXPRESSION_CASE, LocalVariableScopeKind.SWITCH_BLOCK);
            }
            
            // Extract and add pattern binding names from this switch rule
            const patternBindingNames = this.extractSwitchRulePatternBindingNames(child);
            for (const name of patternBindingNames) {
              this.currentPatternBindingNames.add(name);
            }
            
            this.extractFromBlock(
              block,
              filePath,
              typeRegistryHash,
              methodRegistryHash,
              ownerTypeName,
              ownerQualifiedName,
              ownerMethodName,
              serviceVersionHash,
              packageName,
              importMap,
              hasStarImports,
              LocalVariableScopeKind.SWITCH_BLOCK,
              lambdaDepth,
              variables
            );
            
            // Remove this rule's pattern bindings after processing
            for (const name of patternBindingNames) {
              this.currentPatternBindingNames.delete(name);
            }
            
            // Exit SWITCH_EXPRESSION_CASE scope
            if (caseBlockHash) {
              this.scopeContext.exit();
              if (!this.isFieldInitializerContext) this.blockNestingDepth--;
            }
          }
        } else if (child.type === 'switch_block_statement_group') {
          // Colon syntax: case X: ... yield ...;
          let caseBlockHash: string | null = null;
          if (this.blockMethodHash) {
            caseBlockHash = BlockRegistry.computeHash(
              BlockKind.SWITCH_CASE,
              filePath,
              child.startPosition.row + 1,
              child.endPosition.row + 1,
              child.startPosition.column,
              child.endPosition.column,
              typeRegistryHash,
              this.blockMethodHash
            );

            if (this.shouldCreateBlockEntries) {
              const blockEntry = BlockRegistry.builder(
                BlockKind.SWITCH_CASE, this.extractedBlocks.length, filePath,
                child.startPosition.row + 1, child.endPosition.row + 1,
                child.startPosition.column, child.endPosition.column,
                typeRegistryHash, this.blockMethodHash,
                ownerTypeName, ownerQualifiedName, ownerMethodName || ''
              )
                .withNestingDepth(this.blockNestingDepth);
              // Use explicit parentContainerHash (from local variable) if provided,
              // otherwise fall back to scope context (for non-initializer contexts)
              const resolvedParentHash = parentContainerHash || this.scopeContext.getCurrentOwnerHash();
              if (resolvedParentHash) blockEntry.withParentContainerHash(resolvedParentHash);
              this.extractedBlocks.push(blockEntry.build());
            }
          }

          // Enter SWITCH_CASE scope
          if (caseBlockHash) {
            if (!this.isFieldInitializerContext) this.blockNestingDepth++;
            this.scopeContext.enterBlock(caseBlockHash, BlockKind.SWITCH_CASE, LocalVariableScopeKind.SWITCH_BLOCK);
          }

          // Extract and add pattern binding names
          const patternBindingNames = this.extractSwitchRulePatternBindingNames(child);
          for (const name of patternBindingNames) {
            this.currentPatternBindingNames.add(name);
          }

          this.extractFromBlock(
            child,
            filePath,
            typeRegistryHash,
            methodRegistryHash,
            ownerTypeName,
            ownerQualifiedName,
            ownerMethodName,
            serviceVersionHash,
            packageName,
            importMap,
            hasStarImports,
            LocalVariableScopeKind.SWITCH_BLOCK,
            lambdaDepth,
            variables
          );

          // Remove pattern bindings after processing
          for (const name of patternBindingNames) {
            this.currentPatternBindingNames.delete(name);
          }

          // Exit SWITCH_CASE scope
          if (caseBlockHash) {
            this.scopeContext.exit();
            if (!this.isFieldInitializerContext) this.blockNestingDepth--;
          }
        }
      }
    }

    // Restore previous pattern binding names
    this.currentPatternBindingNames = previousPatternBindingNames;
  }

  /**
   * Finds the expression hash for a switch rule/case arm.
   * Looks for the pattern binding expression (e.g., 's' in 'case String s')
   * or the first expression in the case label.
   */
  private findSwitchRuleExpressionHash(switchRuleNode: Parser.SyntaxNode): string | undefined {
    // Find the switch_label child
    const switchLabel = switchRuleNode.children.find(c => c.type === 'switch_label');
    if (!switchLabel) return undefined;

    // Look for a pattern (type_pattern, record_pattern) in the switch_label
    // Structure: switch_label -> pattern -> type_pattern/record_pattern
    for (const child of switchLabel.children) {
      if (child.type === 'pattern') {
        // Find the pattern variable identifier inside
        const patternNode = child.children.find(c => 
          c.type === 'type_pattern' || c.type === 'record_pattern' || c.type === 'binding_pattern'
        );
        if (patternNode) {
          // For type_pattern (case String s), find the identifier
          const identifier = patternNode.children.find(c => c.type === 'identifier');
          if (identifier) {
            // Look up the expression for this pattern binding
            const startLine = identifier.startPosition.row + 1;
            const startCol = identifier.startPosition.column;
            const endLine = identifier.endPosition.row + 1;
            const endCol = identifier.endPosition.column;

            // Search in both expression sources
            let patternExpr = this.expressionsForHashLookup.find(expr =>
              expr.getStartLine() === startLine &&
              expr.getStartColumn() === startCol &&
              expr.getEndLine() === endLine &&
              expr.getEndColumn() === endCol
            );
            if (!patternExpr) {
              patternExpr = this.extractedExpressions.find(expr =>
                expr.getStartLine() === startLine &&
                expr.getStartColumn() === startCol &&
                expr.getEndLine() === endLine &&
                expr.getEndColumn() === endCol
              );
            }
            if (patternExpr) {
              return patternExpr.getHash();
            }
          }
          
          // For record_pattern (case Point(int x, int y)), use the record pattern expression
          if (patternNode.type === 'record_pattern') {
            const startLine = patternNode.startPosition.row + 1;
            const startCol = patternNode.startPosition.column;
            const endLine = patternNode.endPosition.row + 1;
            const endCol = patternNode.endPosition.column;

            let recordExpr = this.expressionsForHashLookup.find(expr =>
              expr.getStartLine() === startLine &&
              expr.getStartColumn() === startCol &&
              expr.getEndLine() === endLine &&
              expr.getEndColumn() === endCol
            );
            if (!recordExpr) {
              recordExpr = this.extractedExpressions.find(expr =>
                expr.getStartLine() === startLine &&
                expr.getStartColumn() === startCol &&
                expr.getEndLine() === endLine &&
                expr.getEndColumn() === endCol
              );
            }
            if (recordExpr) {
              return recordExpr.getHash();
            }
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Extracts pattern binding variable names from a switch rule.
   * E.g., for 'case String s -> { ... }' returns ['s']
   * For 'case Point(int x, int y) -> { ... }' returns ['x', 'y']
   */
  private extractSwitchRulePatternBindingNames(switchRuleNode: Parser.SyntaxNode): Set<string> {
    const names = new Set<string>();
    
    // Find the switch_label child
    const switchLabel = switchRuleNode.children.find(c => c.type === 'switch_label');
    if (!switchLabel) return names;

    // Look for patterns in the switch_label
    for (const child of switchLabel.children) {
      if (child.type === 'pattern') {
        this.extractPatternBindingNamesRecursive(child, names);
      }
    }

    return names;
  }

  /**
   * Recursively extracts pattern binding variable names from a pattern node.
   * Handles type_pattern, record_pattern, and nested patterns.
   */
  private extractPatternBindingNamesRecursive(node: Parser.SyntaxNode, names: Set<string>): void {
    if (node.type === 'type_pattern' || node.type === 'binding_pattern') {
      // For type_pattern (case String s), find the identifier
      const identifier = node.children.find(c => c.type === 'identifier');
      if (identifier) {
        names.add(identifier.text);
      }
    } else if (node.type === 'record_pattern') {
      // For record_pattern (case Point(int x, int y)), extract nested bindings
      for (const child of node.children) {
        if (child.type === 'record_pattern_body') {
          for (const bodyChild of child.children) {
            if (bodyChild.type === 'pattern') {
              this.extractPatternBindingNamesRecursive(bodyChild, names);
            } else if (bodyChild.type === 'type_pattern' || bodyChild.type === 'binding_pattern') {
              this.extractPatternBindingNamesRecursive(bodyChild, names);
            } else if (bodyChild.type === 'record_pattern') {
              this.extractPatternBindingNamesRecursive(bodyChild, names);
            }
          }
        }
      }
    } else if (node.type === 'pattern') {
      // Unwrap pattern node
      for (const child of node.children) {
        this.extractPatternBindingNamesRecursive(child, names);
      }
    }
  }

  /**
   * Extracts local variables from switch expression blocks in field initializers
   */
  private extractFromFieldSwitchExpressionBlocks(
    switchExprNode: Parser.SyntaxNode,
    filePath: string,
    typeRegistryHash: string,
    _fieldHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    lambdaDepth: number,
    variables: LocalVariableRegistry[],
    blockDepth: number = 0
  ): void {
    // Save previous pattern binding names
    const previousPatternBindingNames = new Set(this.currentPatternBindingNames);

    // Find switch_block containing switch_rule or switch_block_statement_group nodes
    const switchBlock = switchExprNode.children.find(c => c.type === 'switch_block');
    if (switchBlock) {
      for (const child of switchBlock.children) {
        // Handle both arrow syntax (switch_rule) and colon syntax (switch_block_statement_group)
        if (child.type === 'switch_rule' || child.type === 'switch_block_statement_group') {
          const block = child.children.find(c => c.type === 'block');
          if (block) {
            // Find the switch_label for this case arm to link local variables to the specific case
            const switchRuleExpressionHash = this.findSwitchRuleExpressionHash(child);
            
            // Enter switch block scope using ScopeContext
            if (switchRuleExpressionHash) {
              this.scopeContext.enterBlock(switchRuleExpressionHash, BlockKind.SWITCH_EXPRESSION_CASE, LocalVariableScopeKind.SWITCH_BLOCK);
            }
            
            // Extract and add pattern binding names from this switch rule
            const patternBindingNames = this.extractSwitchRulePatternBindingNames(child);
            for (const name of patternBindingNames) {
              this.currentPatternBindingNames.add(name);
            }
            
            this.extractFromBlock(
              block,
              filePath,
              typeRegistryHash,
              undefined, // No methodRegistryHash for field initializers
              ownerTypeName,
              ownerQualifiedName,
              undefined, // No ownerMethodName for field initializers
              serviceVersionHash,
              packageName,
              importMap,
              hasStarImports,
              LocalVariableScopeKind.LAMBDA_BODY,
              lambdaDepth,
              variables,
              blockDepth
            );
            
            // Remove this rule's pattern bindings after processing
            for (const name of patternBindingNames) {
              this.currentPatternBindingNames.delete(name);
            }
            
            // Exit switch block scope
            if (switchRuleExpressionHash) {
              this.scopeContext.exit();
            }
          }
        }
      }
    }

    // Restore previous pattern binding names
    this.currentPatternBindingNames = previousPatternBindingNames;
  }

}
