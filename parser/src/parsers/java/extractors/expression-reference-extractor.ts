import Parser from 'tree-sitter';

import { ExpressionReference } from '@/analysis-types/java/ExpressionReference';
import { TypeAnnotation } from '@/analysis-types/java/TypeAnnotation';
import { TypeReference } from '@/analysis-types/java/TypeReference';
import {
  ExpressionKind,
  EdgeRole,
  RootContext,
  ExpressionOwnerKind,
  LiteralType,
  UnaryFixity,
  ReferencedEntityKind,
  MethodReferenceKind,
} from '@/enums/java/expressions';
import { AnnotationExtractor } from '@/parsers/java/extractors/annotation-extractor';
import { TypeReferenceExtractor } from '@/parsers/java/extractors/type-reference-extractor';
import { EntityUtils } from '@/utils/entity-utils';
import { resolveTypeQualifiedName } from '@/utils/java/type-resolution-utils';

/**
 * Extracts ExpressionReference entities from Java expression trees.
 * 
 * Built incrementally - currently handles:
 * - LITERAL expressions (integers, floats, strings, booleans, chars, null)
 * - CLASS_LITERAL expressions (String.class, int.class)
 * - UNARY_EXPRESSION (-a, !a, ++a, a++)
 * - BINARY_EXPRESSION (a + b, a && b, a == b)
 * - TERNARY_EXPRESSION (cond ? trueExpr : falseExpr)
 * - PARENTHESIZED (expr) - wraps another expression
 * - FIELD_ACCESS (obj.field, Type.CONST, Math.PI - qualifier extracted as child)
 * - THIS_REFERENCE (this keyword alone)
 * - SUPER_REFERENCE (super keyword alone)
 * - IDENTIFIER_REFERENCE (simple name without dots: a, DEFAULT_TIMEOUT)
 * - FIELD_ACCESS (super.field, this.field, obj.field, getObj().field)
 * - METHOD_INVOCATION (obj.method(), method(), Class.method(), obj.<T>method())
 * - CONSTRUCTOR_INVOCATION (this(), super() - explicit constructor invocation in constructor body)
 */
interface PendingChild {
  node: Parser.SyntaxNode;
  parentHash: string;
  edgeRole: EdgeRole;
  position: number;
  depth: number;
  typeRegistryHash: string;
  ownerHash: string;
  ownerKind: ExpressionOwnerKind;
  rootContext: RootContext;
  /** Lambda parameter names in scope for this expression (for classifying usages) */
  lambdaParamNames?: Set<string>;
  /** Local variable names in scope for this expression (for classifying usages in switch blocks) */
  localVariableNames?: Set<string>;
  /** Pattern binding variable names in scope for this expression (for classifying pattern variable usages) */
  patternBindingNames?: Set<string>;
}

/**
 * Information about an anonymous class encountered during expression extraction.
 * Used to register the anonymous class as a type at a higher level.
 */
export interface AnonymousClassInfo {
  /** The class_body node of the anonymous class */
  classBodyNode: Parser.SyntaxNode;
  /** The full object_creation_expression node */
  creationNode: Parser.SyntaxNode;
  /** Hash of the expression that creates this anonymous class */
  expressionHash: string;
  /** Pre-generated hash for the anonymous type (must be used by TypeRegistryExtractor) */
  anonymousTypeHash: string;
  /** Type being extended/implemented (e.g., "Runnable") */
  baseTypeName: string;
  /** Context info for type resolution */
  typeRegistryHash: string;
  ownerHash: string;
  ownerKind: ExpressionOwnerKind;
  rootContext: RootContext;
  packageName: string | null;
  importMap: Map<string, string>;
  hasStarImports: boolean;
}

export class ExpressionReferenceExtractor {
  private extractedExpressions: ExpressionReference[] = [];
  private extractedTypeReferences: TypeReference[] = [];
  private extractedAnnotations: TypeAnnotation[] = [];
  private extractedAnonymousClasses: AnonymousClassInfo[] = [];
  private pendingChildren: PendingChild[] = [];
  private typeReferenceExtractor: TypeReferenceExtractor;
  private annotationExtractor: AnnotationExtractor;
  
  // Current extraction context
  private currentTypeRegistryHash: string = '';
  private currentOwnerHash: string = '';
  private currentOwnerKind: ExpressionOwnerKind = ExpressionOwnerKind.FIELD;
  private currentRootContext: RootContext = RootContext.FIELD_INITIALIZER;
  
  // Type resolution context
  private currentPackageName: string | null = null;
  private currentImportMap: Map<string, string> = new Map();
  private currentHasStarImports: boolean = false;
  
  // Method parameter names for classifying PARAMETER references
  private currentMethodParamNames: Set<string> = new Set();
  
  // Lambda parameter names in scope for classifying lambda parameter usages
  private currentLambdaParamNames: Set<string> = new Set();
  
  // Local variable names in scope for classifying LOCAL_VARIABLE references
  private currentLocalVariableNames: Set<string> = new Set();
  // Where each local of that name is first declared. A use BEFORE it is not that local: in Java a local's
  // scope starts at its declaration, so a field read that precedes a same-named local is a field read.
  private currentLocalVariableDeclStart: Map<string, number> = new Map();
  
  // Pattern binding variable names in scope for classifying PATTERN_BINDING references
  private currentPatternBindingNames: Set<string> = new Set();

  // Pattern bindings declared in the method body currently being extracted, each with the byte
  // range of the statement that declares it.
  //
  // `currentPatternBindingNames` is set per call and carries the bindings of the expression tree
  // being walked, which is enough for a switch rule whose label and result are one tree. An
  // instanceof binding is used in a DIFFERENT statement from the one that declares it -
  // `if (o instanceof Target a) { a.hit(); }` - and each statement is extracted by its own call,
  // so the binding was out of scope by the time the use site was classified. It then fell through
  // to the naming-convention fallback and was tagged FIELD.
  //
  // The range matters as much as the name. A binding may share a name with a field, which Java
  // permits, and then a use OUTSIDE the declaring statement is the field:
  //
  //     void m(Object o) {
  //         a.hit();                                  // the field
  //         if (o instanceof Target a) { a.hit(); }   // the binding
  //         a.hit();                                  // the field again
  //     }
  //
  // Matching on the name alone would call all three the binding, which trades one wrong answer
  // for another. A use is the binding only when it falls inside the declaring statement.
  private methodPatternBindings: Array<{ name: string; startIndex: number; endIndex: number }> = [];
  
  // Return statement index for distinguishing multiple returns in a method
  private currentReturnStatementIndex?: number;

  constructor() {
    this.typeReferenceExtractor = new TypeReferenceExtractor();
    this.annotationExtractor = new AnnotationExtractor();
  }

  /**
   * Returns all expressions extracted during the last extraction
   */
  getExtractedExpressions(): ExpressionReference[] {
    return this.extractedExpressions;
  }

  /**
   * Returns all type references extracted during the last extraction
   * (from method type arguments like <String> in Collections.<String>emptyList())
   */
  getExtractedTypeReferences(): TypeReference[] {
    return this.extractedTypeReferences;
  }

  /**
   * Returns all type-use annotations extracted during the last extraction
   * (from object/array creation expressions like new @TA Object())
   */
  getExtractedAnnotations(): TypeAnnotation[] {
    return this.extractedAnnotations;
  }

  /**
   * Returns all anonymous classes encountered during the last extraction.
   * These need to be registered as types at a higher level.
   */
  getExtractedAnonymousClasses(): AnonymousClassInfo[] {
    return this.extractedAnonymousClasses;
  }

  /**
   * Extracts expressions from a field initializer
   */
  extractFromFieldInitializer(
    initializerNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    fieldHash: string,
    _serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean
  ): ExpressionReference[] {
    this.extractedExpressions = [];
    this.extractedTypeReferences = [];
    this.extractedAnnotations = [];
    this.extractedAnonymousClasses = [];
    this.pendingChildren = [];
    
    // Set context for child extractions
    this.currentTypeRegistryHash = typeRegistryHash;
    this.currentOwnerHash = fieldHash;
    this.currentOwnerKind = ExpressionOwnerKind.FIELD;
    this.currentRootContext = RootContext.FIELD_INITIALIZER;
    
    // Set type resolution context
    this.currentPackageName = packageName;
    this.currentImportMap = importMap;
    this.currentHasStarImports = hasStarImports;
    
    // Reset scope tracking
    this.currentLambdaParamNames = new Set();
    this.currentPatternBindingNames = new Set();
    
    this.extractExpression(
      initializerNode,
      typeRegistryHash,
      fieldHash,
      ExpressionOwnerKind.FIELD,
      RootContext.FIELD_INITIALIZER,
      EdgeRole.ROOT,
      undefined,
      0,
      0
    );
    
    // Process any pending children (from unary/binary expressions)
    this.processPendingChildren();
    
    return this.extractedExpressions;
  }

  /**
   * Extracts expressions from a local variable initializer
   * @param methodParamNames Names of method parameters for PARAMETER classification
   * @param localVariableNames Names of local variables in scope for LOCAL_VARIABLE classification
   * @param lambdaParamNames Names of lambda parameters in scope for LAMBDA_PARAMETER classification
   * @param patternBindingNames Names of pattern binding variables in scope for PATTERN_BINDING_VARIABLE classification
   */
  extractFromLocalVariableInitializer(
    initializerNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    localVariableHash: string,
    _serviceVersionHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    methodParamNames: Set<string> = new Set(),
    localVariableNames: Set<string> = new Set(),
    lambdaParamNames: Set<string> = new Set(),
    patternBindingNames: Set<string> = new Set()
  ): ExpressionReference[] {
    this.extractedExpressions = [];
    this.extractedTypeReferences = [];
    this.extractedAnnotations = [];
    this.extractedAnonymousClasses = [];
    this.pendingChildren = [];
    
    // Set context for child extractions
    this.currentTypeRegistryHash = typeRegistryHash;
    // Expressions from local variable initializers are owned by the local variable
    // Block context is tracked on the LocalVariableRegistry itself via parentExpressionLinkHash
    this.currentOwnerHash = localVariableHash;
    this.currentOwnerKind = ExpressionOwnerKind.LOCAL_VARIABLE;
    this.currentRootContext = RootContext.LOCAL_VAR_INITIALIZER;
    
    // Set type resolution context
    this.currentPackageName = packageName;
    this.currentImportMap = importMap;
    this.currentHasStarImports = hasStarImports;
    
    // Set method parameter names for PARAMETER classification
    this.currentMethodParamNames = methodParamNames;
    
    // Set local variable names for LOCAL_VARIABLE classification
    this.currentLocalVariableNames = localVariableNames;
    
    // Set lambda parameter names for LAMBDA_PARAMETER classification
    this.currentLambdaParamNames = lambdaParamNames;
    
    // Set pattern binding names for PATTERN_BINDING_VARIABLE classification
    this.currentPatternBindingNames = patternBindingNames;
    
    this.extractExpression(
      initializerNode,
      typeRegistryHash,
      localVariableHash,
      ExpressionOwnerKind.LOCAL_VARIABLE,
      RootContext.LOCAL_VAR_INITIALIZER,
      EdgeRole.ROOT,
      undefined,
      0,
      0
    );
    
    // Process any pending children (from unary/binary expressions)
    this.processPendingChildren();
    
    return this.extractedExpressions;
  }

  /**
   * Extracts expressions from an enum constant argument.
   * 
   * Example: PENDING(computeCode(), "Pending")
   * - computeCode() is a method invocation expression
   * - "Pending" is a literal expression
   * 
   * @param argumentNode The argument expression node
   * @param typeRegistryHash Hash of the enclosing enum type
   * @param enumConstantHash Hash of the enum constant
   * @param packageName Current package name for type resolution
   * @param importMap Import map for type resolution
   * @param hasStarImports Whether star imports are present
   * @param position Position of this argument (0-indexed)
   */
  extractFromEnumConstantArgument(
    argumentNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    enumConstantHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    position: number
  ): ExpressionReference[] {
    this.extractedExpressions = [];
    this.extractedTypeReferences = [];
    this.extractedAnnotations = [];
    this.extractedAnonymousClasses = [];
    this.pendingChildren = [];
    
    // Set context for child extractions
    this.currentTypeRegistryHash = typeRegistryHash;
    this.currentOwnerHash = enumConstantHash;
    this.currentOwnerKind = ExpressionOwnerKind.ENUM_CONSTANT_ARGUMENT;
    this.currentRootContext = RootContext.ENUM_CONSTANT_ARGUMENT;
    
    // Set type resolution context
    this.currentPackageName = packageName;
    this.currentImportMap = importMap;
    this.currentHasStarImports = hasStarImports;
    
    this.extractExpression(
      argumentNode,
      typeRegistryHash,
      enumConstantHash,
      ExpressionOwnerKind.ENUM_CONSTANT_ARGUMENT,
      RootContext.ENUM_CONSTANT_ARGUMENT,
      EdgeRole.ROOT,
      undefined,
      position,  // Use the argument position
      0
    );
    
    // Process any pending children
    this.processPendingChildren();
    
    return this.extractedExpressions;
  }

  /**
   * Extracts expressions from a return statement.
   * 
   * Example: return x * 2;
   * - x * 2 is the return value expression
   * 
   * @param returnNode The return_statement node
   * @param typeRegistryHash Hash of the enclosing type
   * @param methodHash Hash of the method containing this return
   * @param packageName Current package name for type resolution
   * @param importMap Import map for type resolution
   * @param hasStarImports Whether star imports are present
   * @param methodParamNames Names of method parameters for PARAMETER classification
   * @param returnStatementIndex Index of this return statement within the method (0-based)
   * @param localVariableNames Names of local variables in scope for LOCAL_VARIABLE classification
   * @param lambdaParamNames Names of lambda parameters in scope for LAMBDA_PARAMETER classification
   */
  extractFromReturnStatement(
    returnStmtNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    ownerHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    methodParamNames: Set<string> = new Set(),
    returnStatementIndex?: number,
    localVariableNames: Set<string> = new Set(),
    lambdaParamNames: Set<string> = new Set()
  ): ExpressionReference[] {
    this.extractedExpressions = [];
    this.extractedTypeReferences = [];
    this.extractedAnnotations = [];
    this.extractedAnonymousClasses = [];
    this.pendingChildren = [];
    
    // Set context for child extractions
    this.currentTypeRegistryHash = typeRegistryHash;
    this.currentOwnerHash = ownerHash;
    this.currentOwnerKind = ExpressionOwnerKind.RETURN_STATEMENT;
    this.currentRootContext = RootContext.RETURN_VALUE;
    
    // Set type resolution context
    this.currentPackageName = packageName;
    this.currentImportMap = importMap;
    this.currentHasStarImports = hasStarImports;
    
    // Set method parameter names for PARAMETER classification
    this.currentMethodParamNames = methodParamNames;
    
    // Set local variable names for LOCAL_VARIABLE classification
    this.currentLocalVariableNames = localVariableNames;
    
    // Set return statement index for distinguishing multiple returns
    this.currentReturnStatementIndex = returnStatementIndex;
    
    // Set lambda parameter names for LAMBDA_PARAMETER classification
    this.currentLambdaParamNames = lambdaParamNames;
    // Pattern bindings do not survive between statements: each is scoped to the statement that
    // declares it, and cross-statement uses resolve through methodPatternBindings by range.
    this.currentPatternBindingNames = new Set();
    
    // Find the expression inside the return statement
    // return_statement structure: return <expression>? ;
    const returnExpr = ExpressionReferenceExtractor.namedOperands(returnStmtNode)[0];
    
    // If there's no expression (bare "return;"), nothing to extract
    if (!returnExpr) {
      return this.extractedExpressions;
    }
    
    this.extractExpression(
      returnExpr,
      typeRegistryHash,
      ownerHash,
      ExpressionOwnerKind.RETURN_STATEMENT,
      RootContext.RETURN_VALUE,
      EdgeRole.ROOT,
      undefined,
      0,
      0
    );
    
    // Process any pending children
    this.processPendingChildren();
    
    return this.extractedExpressions;
  }

  /**
   * Extracts expressions from a throw statement.
   * 
   * Example: throw new RuntimeException("error");
   * - new RuntimeException("error") is the thrown expression
   * 
   * @param throwStmtNode The throw_statement node
   * @param typeRegistryHash Hash of the enclosing type
   * @param ownerHash Hash of the method/lambda containing this throw
   * @param packageName Current package name for type resolution
   * @param importMap Import map for type resolution
   * @param hasStarImports Whether star imports are present
   * @param methodParamNames Names of method parameters for PARAMETER classification
   * @param throwStatementIndex Index of this throw statement within the method (0-based)
   * @param localVariableNames Names of local variables in scope for LOCAL_VARIABLE classification
   * @param lambdaParamNames Names of lambda parameters in scope for LAMBDA_PARAMETER classification
   */
  extractFromThrowStatement(
    throwStmtNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    ownerHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    methodParamNames: Set<string> = new Set(),
    _throwStatementIndex?: number,
    localVariableNames: Set<string> = new Set(),
    lambdaParamNames: Set<string> = new Set()
  ): ExpressionReference[] {
    this.extractedExpressions = [];
    this.extractedTypeReferences = [];
    this.extractedAnnotations = [];
    this.extractedAnonymousClasses = [];
    this.pendingChildren = [];
    
    // Set context for child extractions
    this.currentTypeRegistryHash = typeRegistryHash;
    this.currentOwnerHash = ownerHash;
    this.currentOwnerKind = ExpressionOwnerKind.THROW_STATEMENT;
    this.currentRootContext = RootContext.THROW_VALUE;
    
    // Set type resolution context
    this.currentPackageName = packageName;
    this.currentImportMap = importMap;
    this.currentHasStarImports = hasStarImports;
    
    // Set method parameter names for PARAMETER classification
    this.currentMethodParamNames = methodParamNames;
    
    // Set local variable names for LOCAL_VARIABLE classification
    this.currentLocalVariableNames = localVariableNames;
    
    // Set lambda parameter names for LAMBDA_PARAMETER classification
    this.currentLambdaParamNames = lambdaParamNames;
    // Pattern bindings do not survive between statements: each is scoped to the statement that
    // declares it, and cross-statement uses resolve through methodPatternBindings by range.
    this.currentPatternBindingNames = new Set();
    
    // Find the expression inside the throw statement
    // throw_statement structure: throw <expression> ;
    const thrownExpr = ExpressionReferenceExtractor.namedOperands(throwStmtNode)[0];
    
    // If there's no expression, nothing to extract
    if (!thrownExpr) {
      return this.extractedExpressions;
    }
    
    this.extractExpression(
      thrownExpr,
      typeRegistryHash,
      ownerHash,
      ExpressionOwnerKind.THROW_STATEMENT,
      RootContext.THROW_VALUE,
      EdgeRole.ROOT,
      undefined,
      0,
      0
    );
    
    // Process any pending children
    this.processPendingChildren();

    return this.extractedExpressions;
  }

  /**
   * Extracts a break statement as a single BREAK_STATEMENT expression entry.
   *
   * break_statement structure:
   *   break ;                  — no named children
   *   break <identifier> ;     — one named child: the label identifier
   *
   * The break statement itself is recorded as the expression (no sub-expression to recurse into).
   * If a label is present its name is stored in literalValue.
   *
   * @param breakStmtNode The break_statement syntax node
   * @param typeRegistryHash Hash of the containing type
   * @param ownerHash Hash of the block (SWITCH_CASE or loop body) containing this statement
   */
  extractFromBreakStatement(
    breakStmtNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    ownerHash: string
  ): ExpressionReference[] {
    const builder = ExpressionReference.builder(
      typeRegistryHash,
      ownerHash,
      ExpressionOwnerKind.BREAK_STATEMENT,
      RootContext.BREAK_STATEMENT,
      ExpressionKind.BREAK_STATEMENT,
      EdgeRole.ROOT
    );
    builder.positionAndDepth(0, 0);
    builder.location(
      breakStmtNode.startPosition.row + 1,
      breakStmtNode.startPosition.column,
      breakStmtNode.endPosition.row + 1,
      breakStmtNode.endPosition.column
    );

    // If the break has a label (e.g. break outer;), store label name in literalValue
    const labelNode = ExpressionReferenceExtractor.namedOperands(breakStmtNode)[0];
    if (labelNode && labelNode.type === 'identifier') {
      builder.classLiteralTypeName(labelNode.text);
    }

    return [builder.build()];
  }

  /**
   * Extracts a continue statement as a single CONTINUE_STATEMENT expression entry.
   *
   * continue_statement structure:
   *   continue ;                  — no named children
   *   continue <identifier> ;     — one named child: the label identifier
   *
   * If a label is present its name is stored in literalValue.
   *
   * @param continueStmtNode The continue_statement syntax node
   * @param typeRegistryHash Hash of the containing type
   * @param ownerHash Hash of the block (loop body) containing this statement
   */
  extractFromContinueStatement(
    continueStmtNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    ownerHash: string
  ): ExpressionReference[] {
    const builder = ExpressionReference.builder(
      typeRegistryHash,
      ownerHash,
      ExpressionOwnerKind.CONTINUE_STATEMENT,
      RootContext.CONTINUE_STATEMENT,
      ExpressionKind.CONTINUE_STATEMENT,
      EdgeRole.ROOT
    );
    builder.positionAndDepth(0, 0);
    builder.location(
      continueStmtNode.startPosition.row + 1,
      continueStmtNode.startPosition.column,
      continueStmtNode.endPosition.row + 1,
      continueStmtNode.endPosition.column
    );

    // If the continue has a label (e.g. continue outer;), store label name in literalValue
    const labelNode = ExpressionReferenceExtractor.namedOperands(continueStmtNode)[0];
    if (labelNode && labelNode.type === 'identifier') {
      builder.classLiteralTypeName(labelNode.text);
    }

    return [builder.build()];
  }

  /**
   * Extracts all expressions from an expression statement (e.g., `this.count = count;`).
   * Expression statements are standalone expressions used as statements, typically:
   * - Assignment expressions: `this.field = value;`
   * - Method calls: `System.out.println("hello");`
   * - Increment/decrement: `count++;`
   * 
   * @param exprStmtNode The expression_statement syntax node
   * @param typeRegistryHash Hash of the containing type
   * @param methodHash Hash of the method containing this statement
   * @param packageName Current package name for type resolution
   * @param importMap Import map for type resolution
   * @param hasStarImports Whether star imports are present
   * @param methodParamNames Names of method parameters for PARAMETER classification
   * @param localVariableNames Names of local variables in scope for LOCAL_VARIABLE classification
   * @param lambdaParamNames Names of lambda parameters in scope for LAMBDA_PARAMETER classification
   */
  extractFromExpressionStatement(
    exprStmtNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    methodHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    methodParamNames: Set<string> = new Set(),
    localVariableNames: Set<string> = new Set(),
    lambdaParamNames: Set<string> = new Set()
  ): ExpressionReference[] {
    this.extractedExpressions = [];
    this.extractedTypeReferences = [];
    this.extractedAnnotations = [];
    this.extractedAnonymousClasses = [];
    this.pendingChildren = [];
    
    // Set context for child extractions
    this.currentTypeRegistryHash = typeRegistryHash;
    this.currentOwnerHash = methodHash;
    this.currentOwnerKind = ExpressionOwnerKind.EXPRESSION_STATEMENT;
    this.currentRootContext = RootContext.EXPRESSION_STATEMENT;
    
    // Set type resolution context
    this.currentPackageName = packageName;
    this.currentImportMap = importMap;
    this.currentHasStarImports = hasStarImports;
    
    // Set method parameter names for PARAMETER classification
    this.currentMethodParamNames = methodParamNames;
    
    // Set local variable names for LOCAL_VARIABLE classification
    this.currentLocalVariableNames = localVariableNames;
    
    // No return statement index for expression statements
    this.currentReturnStatementIndex = undefined;
    
    // Set lambda parameter names for LAMBDA_PARAMETER classification
    this.currentLambdaParamNames = lambdaParamNames;
    // Pattern bindings do not survive between statements: each is scoped to the statement that
    // declares it, and cross-statement uses resolve through methodPatternBindings by range.
    this.currentPatternBindingNames = new Set();
    
    // Find the expression inside the expression statement
    // expression_statement structure: <expression> ;
    const expr = ExpressionReferenceExtractor.namedOperands(exprStmtNode)[0];
    
    // If there's no expression, nothing to extract
    if (!expr) {
      return this.extractedExpressions;
    }
    
    this.extractExpression(
      expr,
      typeRegistryHash,
      methodHash,
      ExpressionOwnerKind.EXPRESSION_STATEMENT,
      RootContext.EXPRESSION_STATEMENT,
      EdgeRole.ROOT,
      undefined,
      0,
      0
    );
    
    // Process any pending children
    this.processPendingChildren();
    
    return this.extractedExpressions;
  }

  /**
   * Extracts all expressions from a control flow condition expression.
   * This handles IF conditions, WHILE conditions, FOR conditions/init/update, DO_WHILE conditions, etc.
   * 
   * @param conditionNode The condition expression syntax node
   * @param typeRegistryHash Hash of the containing type
   * @param ownerHash Hash of the block or method owning this condition
   * @param rootContext The context type (IF_CONDITION, WHILE_CONDITION, etc.)
   * @param packageName Current package name for type resolution
   * @param importMap Import map for type resolution
   * @param hasStarImports Whether star imports are present
   * @param methodParamNames Names of method parameters for PARAMETER classification
   * @param localVariableNames Names of local variables in scope for LOCAL_VARIABLE classification
   * @param lambdaParamNames Names of lambda parameters in scope for LAMBDA_PARAMETER classification
   */
  extractFromConditionExpression(
    conditionNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    ownerHash: string,
    ownerKind: ExpressionOwnerKind,
    rootContext: RootContext,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    methodParamNames: Set<string> = new Set(),
    localVariableNames: Set<string> = new Set(),
    lambdaParamNames: Set<string> = new Set()
  ): ExpressionReference[] {
    this.extractedExpressions = [];
    this.extractedTypeReferences = [];
    this.extractedAnnotations = [];
    this.extractedAnonymousClasses = [];
    this.pendingChildren = [];
    
    // Set context for child extractions
    this.currentTypeRegistryHash = typeRegistryHash;
    this.currentOwnerHash = ownerHash;
    this.currentOwnerKind = ownerKind;
    this.currentRootContext = rootContext;
    
    // Set type resolution context
    this.currentPackageName = packageName;
    this.currentImportMap = importMap;
    this.currentHasStarImports = hasStarImports;
    
    // Set method parameter names for PARAMETER classification
    this.currentMethodParamNames = methodParamNames;
    
    // Set local variable names for LOCAL_VARIABLE classification
    this.currentLocalVariableNames = localVariableNames;
    
    // No return statement index for condition expressions
    this.currentReturnStatementIndex = undefined;
    
    // Set lambda parameter names for LAMBDA_PARAMETER classification
    this.currentLambdaParamNames = lambdaParamNames;
    // Pattern bindings do not survive between statements: each is scoped to the statement that
    // declares it, and cross-statement uses resolve through methodPatternBindings by range.
    this.currentPatternBindingNames = new Set();
    
    // For parenthesized_expression (if conditions are wrapped), get the inner expression
    let expr = conditionNode;
    if (conditionNode.type === 'parenthesized_expression' && ExpressionReferenceExtractor.namedOperands(conditionNode).length > 0) {
      expr = ExpressionReferenceExtractor.namedOperands(conditionNode)[0]!;
    }
    
    this.extractExpression(
      expr,
      typeRegistryHash,
      ownerHash,
      ownerKind,
      rootContext,
      EdgeRole.ROOT,
      undefined,
      0,
      0
    );
    
    // Process any pending children
    this.processPendingChildren();
    
    return this.extractedExpressions;
  }

  /**
   * Extracts all expressions from an explicit constructor invocation (this() or super()).
   * These are special statements that must be the first statement in a constructor body.
   * 
   * @param invocationNode The explicit_constructor_invocation syntax node
   * @param typeRegistryHash Hash of the containing type
   * @param constructorHash Hash of the constructor containing this invocation
   * @param packageName Current package name for type resolution
   * @param importMap Import map for type resolution
   * @param hasStarImports Whether star imports are present
   * @param constructorParamNames Names of constructor parameters for PARAMETER classification
   */
  extractFromConstructorInvocation(
    invocationNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    constructorHash: string,
    packageName: string | null,
    importMap: Map<string, string>,
    hasStarImports: boolean,
    constructorParamNames: Set<string> = new Set()
  ): ExpressionReference[] {
    this.extractedExpressions = [];
    this.extractedTypeReferences = [];
    this.extractedAnnotations = [];
    this.extractedAnonymousClasses = [];
    this.pendingChildren = [];
    
    // Set context for child extractions
    this.currentTypeRegistryHash = typeRegistryHash;
    this.currentOwnerHash = constructorHash;
    this.currentOwnerKind = ExpressionOwnerKind.EXPRESSION_STATEMENT; // Using EXPRESSION_STATEMENT as owner
    this.currentRootContext = RootContext.EXPLICIT_CONSTRUCTOR_INVOCATION;
    
    // Set type resolution context
    this.currentPackageName = packageName;
    this.currentImportMap = importMap;
    this.currentHasStarImports = hasStarImports;
    
    // Set constructor parameter names for PARAMETER classification
    this.currentMethodParamNames = constructorParamNames;
    
    // No return statement index
    this.currentReturnStatementIndex = undefined;
    
    // Reset lambda scope tracking
    this.currentLambdaParamNames = new Set();
    
    // Extract the constructor invocation itself as an expression
    this.extractExpression(
      invocationNode,
      typeRegistryHash,
      constructorHash,
      ExpressionOwnerKind.EXPRESSION_STATEMENT,
      RootContext.EXPLICIT_CONSTRUCTOR_INVOCATION,
      EdgeRole.ROOT,
      undefined,
      0,
      0
    );
    
    // Process any pending children
    this.processPendingChildren();
    
    return this.extractedExpressions;
  }

  /**
   * Process all pending child expressions
   */
  private processPendingChildren(): void {
    while (this.pendingChildren.length > 0) {
      const child = this.pendingChildren.shift()!;
      
      // Set lambda param names in scope for this child
      if (child.lambdaParamNames) {
        this.currentLambdaParamNames = child.lambdaParamNames;
      }
      
      // Set local variable names in scope for this child (for switch block locals)
      if (child.localVariableNames) {
        for (const name of child.localVariableNames) {
          this.currentLocalVariableNames.add(name);
        }
      }
      
      // Set pattern binding names in scope for this child (for switch pattern variables)
      if (child.patternBindingNames) {
        for (const name of child.patternBindingNames) {
          this.currentPatternBindingNames.add(name);
        }
      }
      
      this.extractExpression(
        child.node,
        child.typeRegistryHash,
        child.ownerHash,
        child.ownerKind,
        child.rootContext,
        child.edgeRole,
        child.parentHash,
        child.position,
        child.depth
      );
    }
  }

  /**
   * Core extraction method - extracts an expression node
   */
  private extractExpression(
    node: Parser.SyntaxNode,
    typeRegistryHash: string,
    ownerHash: string,
    ownerKind: ExpressionOwnerKind,
    rootContext: RootContext,
    edgeRole: EdgeRole,
    parentHash: string | undefined,
    position: number,
    depth: number
  ): void {
    const kind = this.determineExpressionKind(node);
    
    // Skip unknown expression types for now
    if (kind === ExpressionKind.UNKNOWN) {
      return;
    }

    const builder = ExpressionReference.builder(
      typeRegistryHash,
      ownerHash,
      ownerKind,
      rootContext,
      kind,
      edgeRole
    );

    // Set position and depth
    builder.positionAndDepth(position, depth);

    // Set parent if not root
    if (parentHash) {
      builder.parent(parentHash);
    }

    // For anonymous class creation, generate and set the anonymous type hash
    // This hash will be used consistently when registering the anonymous type
    if (kind === ExpressionKind.ANONYMOUS_CLASS_CREATION) {
      const anonymousTypeHash = this.generateAnonymousTypeHash(node);
      builder.anonymousType(anonymousTypeHash);
    }

    // Add kind-specific data (literals, operators, etc. - but NOT children yet)
    this.addKindSpecificData(builder, node, kind, edgeRole);

    // Set location (line and column)
    builder.location(
      node.startPosition.row + 1,    // 1-indexed line
      node.startPosition.column,      // 0-indexed column
      node.endPosition.row + 1,       // 1-indexed line
      node.endPosition.column         // 0-indexed column
    );

    // Set return statement index if this is a return statement expression
    if (this.currentReturnStatementIndex !== undefined && rootContext === RootContext.RETURN_VALUE) {
      builder.returnIndex(this.currentReturnStatementIndex);
    }

    const expression = builder.build();
    this.extractedExpressions.push(expression);
    
    // Now queue children using the actual built expression hash
    this.queueChildExpressions(node, kind, expression.getHash(), depth);
  }

  /**
   * Queue child expressions for compound expression types
   */
  private queueChildExpressions(
    node: Parser.SyntaxNode,
    kind: ExpressionKind,
    parentHash: string,
    depth: number
  ): void {
    if (kind === ExpressionKind.UNARY_EXPRESSION) {
      this.queueUnaryOperand(node, parentHash, depth);
    } else if (kind === ExpressionKind.BINARY_EXPRESSION) {
      this.queueBinaryOperands(node, parentHash, depth);
    } else if (kind === ExpressionKind.TERNARY_EXPRESSION) {
      this.queueTernaryOperands(node, parentHash, depth);
    } else if (kind === ExpressionKind.PARENTHESIZED) {
      this.queueParenthesizedChild(node, parentHash, depth);
    } else if (kind === ExpressionKind.FIELD_ACCESS) {
      this.queueFieldAccessObject(node, parentHash, depth);
    } else if (kind === ExpressionKind.METHOD_INVOCATION) {
      this.queueMethodInvocationChildren(node, parentHash, depth);
    } else if (kind === ExpressionKind.INSTANCEOF_EXPRESSION || kind === ExpressionKind.INSTANCEOF_PATTERN) {
      this.queueInstanceofOperand(node, parentHash, depth);
    } else if (kind === ExpressionKind.OBJECT_CREATION || kind === ExpressionKind.ANONYMOUS_CLASS_CREATION) {
      this.queueObjectCreationChildren(node, parentHash, depth);
    } else if (kind === ExpressionKind.ARRAY_CREATION) {
      this.queueArrayCreationChildren(node, parentHash, depth);
    } else if (kind === ExpressionKind.ARRAY_INITIALIZER) {
      this.queueArrayInitializerChildren(node, parentHash, depth);
    } else if (kind === ExpressionKind.CONSTRUCTOR_INVOCATION) {
      this.queueConstructorInvocationArguments(node, parentHash, depth);
    } else if (kind === ExpressionKind.METHOD_REFERENCE) {
      this.queueMethodReferenceQualifier(node, parentHash, depth);
    } else if (kind === ExpressionKind.ASSIGNMENT_EXPRESSION || kind === ExpressionKind.COMPOUND_ASSIGNMENT) {
      this.queueAssignmentOperands(node, parentHash, depth);
    } else if (kind === ExpressionKind.CAST_EXPRESSION) {
      this.queueCastOperand(node, parentHash, depth);
    } else if (kind === ExpressionKind.ARRAY_ACCESS) {
      this.queueArrayAccessChildren(node, parentHash, depth);
    } else if (kind === ExpressionKind.SWITCH_EXPRESSION) {
      this.queueSwitchExpressionChildren(node, parentHash, depth);
    } else if (kind === ExpressionKind.STRING_TEMPLATE) {
      this.queueStringTemplateChildren(node, parentHash, depth);
    } else if (kind === ExpressionKind.RECORD_PATTERN) {
      this.queueRecordPatternChildren(node, parentHash, depth);
    } else if (kind === ExpressionKind.LAMBDA_EXPRESSION) {
      this.queueLambdaChildren(node, parentHash, depth);
    }
  }

  /**
   * Queue the operand of a unary expression
   */
  private queueUnaryOperand(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    const { operand } = this.parseUnaryExpression(node);
    
    this.pendingChildren.push({
      node: operand,
      parentHash,
      edgeRole: EdgeRole.UNARY_OPERAND,
      position: 0,
      depth: depth + 1,
      typeRegistryHash: this.currentTypeRegistryHash,
      ownerHash: this.currentOwnerHash,
      ownerKind: this.currentOwnerKind,
      rootContext: this.currentRootContext,
    });
  }

  /**
   * Queue the operands of a binary expression
   */
  private queueBinaryOperands(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    const { left, right } = this.parseBinaryExpression(node);
    
    this.pendingChildren.push({
      node: left,
      parentHash,
      edgeRole: EdgeRole.LEFT_OPERAND,
      position: 0,
      depth: depth + 1,
      typeRegistryHash: this.currentTypeRegistryHash,
      ownerHash: this.currentOwnerHash,
      ownerKind: this.currentOwnerKind,
      rootContext: this.currentRootContext,
    });

    this.pendingChildren.push({
      node: right,
      parentHash,
      edgeRole: EdgeRole.RIGHT_OPERAND,
      position: 1,
      depth: depth + 1,
      typeRegistryHash: this.currentTypeRegistryHash,
      ownerHash: this.currentOwnerHash,
      ownerKind: this.currentOwnerKind,
      rootContext: this.currentRootContext,
    });
  }

  /**
   * Queue the operands of an assignment expression (target and value)
   */
  private queueAssignmentOperands(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    const { left, right } = this.parseAssignmentExpression(node);
    
    this.pendingChildren.push({
      node: left,
      parentHash,
      edgeRole: EdgeRole.ASSIGNMENT_TARGET,
      position: 0,
      depth: depth + 1,
      typeRegistryHash: this.currentTypeRegistryHash,
      ownerHash: this.currentOwnerHash,
      ownerKind: this.currentOwnerKind,
      rootContext: this.currentRootContext,
    });

    this.pendingChildren.push({
      node: right,
      parentHash,
      edgeRole: EdgeRole.ASSIGNMENT_VALUE,
      position: 1,
      depth: depth + 1,
      typeRegistryHash: this.currentTypeRegistryHash,
      ownerHash: this.currentOwnerHash,
      ownerKind: this.currentOwnerKind,
      rootContext: this.currentRootContext,
    });
  }

  /**
   * Parse an assignment expression into its left (target), operator, and right (value) parts
   */
  private parseAssignmentExpression(node: Parser.SyntaxNode): {
    left: Parser.SyntaxNode;
    right: Parser.SyntaxNode;
    operator: string;
  } {
    // Tree-sitter Java assignment_expression has named fields 'left' and 'right'
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    const operator = this.extractAssignmentOperator(node);

    if (!left || !right) {
      throw new Error(`Malformed assignment expression: missing left or right operand`);
    }

    return { left, right, operator };
  }

  /**
   * Queue the operands of a ternary expression (condition, trueExpr, falseExpr)
   */
  private queueTernaryOperands(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    const { condition, trueExpr, falseExpr } = this.parseTernaryExpression(node);
    
    this.pendingChildren.push({
      node: condition,
      parentHash,
      edgeRole: EdgeRole.TERNARY_CONDITION,
      position: 0,
      depth: depth + 1,
      typeRegistryHash: this.currentTypeRegistryHash,
      ownerHash: this.currentOwnerHash,
      ownerKind: this.currentOwnerKind,
      rootContext: this.currentRootContext,
    });

    this.pendingChildren.push({
      node: trueExpr,
      parentHash,
      edgeRole: EdgeRole.TERNARY_TRUE,
      position: 1,
      depth: depth + 1,
      typeRegistryHash: this.currentTypeRegistryHash,
      ownerHash: this.currentOwnerHash,
      ownerKind: this.currentOwnerKind,
      rootContext: this.currentRootContext,
    });

    this.pendingChildren.push({
      node: falseExpr,
      parentHash,
      edgeRole: EdgeRole.TERNARY_FALSE,
      position: 2,
      depth: depth + 1,
      typeRegistryHash: this.currentTypeRegistryHash,
      ownerHash: this.currentOwnerHash,
      ownerKind: this.currentOwnerKind,
      rootContext: this.currentRootContext,
    });
  }

  /**
   * Queue the inner expression of a parenthesized expression
   */
  private queueParenthesizedChild(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    // Parenthesized expression has one named child - the inner expression
    const innerExpr = ExpressionReferenceExtractor.namedOperands(node)[0];
    if (innerExpr) {
      this.pendingChildren.push({
        node: innerExpr,
        parentHash,
        edgeRole: EdgeRole.PARENTHESIZED_INNER,
        position: 0,
        depth: depth + 1,
        typeRegistryHash: this.currentTypeRegistryHash,
        ownerHash: this.currentOwnerHash,
        ownerKind: this.currentOwnerKind,
        rootContext: this.currentRootContext,
      });
    }
  }

  /**
   * Queue the object expression of a field access (super.field, this.field, obj.field)
   */
  private queueFieldAccessObject(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    // field_access structure: object "." field
    const object = node.childForFieldName('object');
    if (object) {
      this.pendingChildren.push({
        node: object,
        parentHash,
        edgeRole: EdgeRole.QUALIFIER,
        position: 0,
        depth: depth + 1,
        typeRegistryHash: this.currentTypeRegistryHash,
        ownerHash: this.currentOwnerHash,
        ownerKind: this.currentOwnerKind,
        rootContext: this.currentRootContext,
      });
    }
  }

  /**
   * Queue children of a method invocation (receiver and arguments)
   * method_invocation structure:
   * - object (optional): receiver expression (obj in obj.method())
   * - name: method name identifier
   * - arguments: argument list
   * - type_arguments (optional): generic type arguments (<String> in obj.<String>method())
   */
  private queueMethodInvocationChildren(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    // Queue the receiver/object if present (obj in obj.method())
    const object = node.childForFieldName('object');
    if (object) {
      this.pendingChildren.push({
        node: object,
        parentHash,
        edgeRole: EdgeRole.RECEIVER,
        position: 0,
        depth: depth + 1,
        typeRegistryHash: this.currentTypeRegistryHash,
        ownerHash: this.currentOwnerHash,
        ownerKind: this.currentOwnerKind,
        rootContext: this.currentRootContext,
      });
    }

    // Queue all arguments
    const args = node.childForFieldName('arguments');
    if (args) {
      let position = 0;
      for (const arg of ExpressionReferenceExtractor.namedOperands(args)) {
        this.pendingChildren.push({
          node: arg,
          parentHash,
          edgeRole: EdgeRole.ARGUMENT,
          position,
          depth: depth + 1,
          typeRegistryHash: this.currentTypeRegistryHash,
          ownerHash: this.currentOwnerHash,
          ownerKind: this.currentOwnerKind,
          rootContext: this.currentRootContext,
        });
        position++;
      }
    }

    // Extract type arguments using reusable helper (e.g., <String> in Collections.<String>emptyList())
    this.extractTypeArgumentsIfPresent(node, parentHash, true); // useMethodExtractor=true
  }

  /**
   * Queue the operand of an instanceof expression and extract type reference
   *
   * instanceof_expression structure:
   * - Basic: left instanceof type
   * - Pattern (Java 16+): left instanceof type varName
   * - Record pattern (Java 21+): left instanceof record_pattern
   *
   * Named children (basic/pattern):
   * [0] = left: expression being tested (obj in obj instanceof String)
   * [1] = type: type being tested against (String in obj instanceof String)
   * [2] = varName: pattern variable (s in obj instanceof String s) - only for patterns
   * 
   * For record patterns:
   * [left] = operand
   * [pattern] = record_pattern node
   */
  private queueInstanceofOperand(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    const namedChildren = ExpressionReferenceExtractor.namedOperands(node);

    // Queue the left operand (expression being tested)
    const leftOperand = node.childForFieldName('left');
    if (leftOperand) {
      this.pendingChildren.push({
        node: leftOperand,
        parentHash,
        edgeRole: EdgeRole.INSTANCEOF_OPERAND,
        position: 0,
        depth: depth + 1,
        typeRegistryHash: this.currentTypeRegistryHash,
        ownerHash: this.currentOwnerHash,
        ownerKind: this.currentOwnerKind,
        rootContext: this.currentRootContext,
      });
    }

    // Check for record pattern (Java 21+)
    const patternNode = node.childForFieldName('pattern');
    if (patternNode && patternNode.type === 'record_pattern') {
      // Queue the record pattern as a child expression
      this.pendingChildren.push({
        node: patternNode,
        parentHash,
        edgeRole: EdgeRole.PATTERN_VARIABLE, // Record pattern acts like a pattern variable
        position: 1,
        depth: depth + 1,
        typeRegistryHash: this.currentTypeRegistryHash,
        ownerHash: this.currentOwnerHash,
        ownerKind: this.currentOwnerKind,
        rootContext: this.currentRootContext,
      });
      return; // Record patterns handle their own type extraction
    }

    // Extract type reference for the type being tested (basic instanceof)
    // The type is the second named child (after the operand)
    if (namedChildren.length >= 2) {
      const typeNode = namedChildren[1]!;
      const typeRefs = this.typeReferenceExtractor.extractFromInstanceof(
        typeNode,
        this.currentTypeRegistryHash,
        parentHash, // expression hash as the owner
        this.currentPackageName
      );
      this.extractedTypeReferences.push(...typeRefs);
    }

    // Queue the pattern variable if present (Java 16+ pattern matching)
    // The pattern variable is the 3rd named child (identifier after the type)
    if (namedChildren.length >= 3) {
      const patternVar = namedChildren[2]!;
      if (patternVar.type === 'identifier') {
        // Track pattern binding name so later references are classified as PATTERN_BINDING_VARIABLE
        this.currentPatternBindingNames.add(patternVar.text);
        
        this.pendingChildren.push({
          node: patternVar,
          parentHash,
          edgeRole: EdgeRole.PATTERN_VARIABLE,
          position: 1,
          depth: depth + 1,
          typeRegistryHash: this.currentTypeRegistryHash,
          ownerHash: this.currentOwnerHash,
          ownerKind: this.currentOwnerKind,
          rootContext: this.currentRootContext,
        });
      }
    }
  }

  /**
   * Queue the operand of a cast expression and extract the cast type reference.
   * 
   * cast_expression structure: (type) value
   * - type: the target type being cast to (may be intersection type with multiple types)
   * - value: the expression being cast
   * 
   * Example: (String) obj -> queue 'obj' as CAST_OPERAND, extract String type reference
   * Example: (List<String>) items -> queue 'items', extract List<String> type reference
   * Example: (Serializable & Comparable<?>) obj -> extract both Serializable and Comparable<?>
   */
  private queueCastOperand(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    // cast_expression has named fields 'type' and 'value'
    const valueNode = node.childForFieldName('value');
    if (valueNode) {
      this.pendingChildren.push({
        node: valueNode,
        parentHash,
        edgeRole: EdgeRole.CAST_OPERAND,
        position: 0,
        depth: depth + 1,
        typeRegistryHash: this.currentTypeRegistryHash,
        ownerHash: this.currentOwnerHash,
        ownerKind: this.currentOwnerKind,
        rootContext: this.currentRootContext,
      });
    }

    // Extract type references for the cast type(s)
    // For intersection types (Java 8+), there may be multiple type nodes
    // e.g., (Serializable & Comparable<?>) has type_identifier and generic_type as siblings
    const typeNodes = this.getCastTypeNodes(node);
    let position = 0;
    for (const typeNode of typeNodes) {
      const typeRefs = this.typeReferenceExtractor.extractFromCast(
        typeNode,
        this.currentTypeRegistryHash,
        parentHash, // expression hash as the owner
        this.currentPackageName,
        new Set(), // declaredTypeParams
        position // position for intersection types
      );
      this.extractedTypeReferences.push(...typeRefs);

      // Build typeRefHashMap for linking TYPE_USE annotations to type references
      const typeRefHashMap = new Map<string, string>();
      for (const ref of typeRefs) {
        const positionKey = `${ref.getDepth()}.${ref.getPosition()}`;
        typeRefHashMap.set(positionKey, ref.getHash());
      }

      // Extract TYPE_USE annotations from annotated types in cast (e.g., (@TA String), (String @TA []))
      const typeUseAnnotations = this.annotationExtractor.extractFromFieldType(
        typeNode,
        typeRefHashMap,
        this.currentTypeRegistryHash
      );
      this.extractedAnnotations.push(...typeUseAnnotations);

      position++;
    }
  }

  /**
   * Get all type nodes from a cast expression.
   * For simple casts: returns single type node
   * For intersection types: returns all type nodes (Serializable & Comparable<?> -> [Serializable, Comparable<?>])
   */
  private getCastTypeNodes(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const typeNodes: Parser.SyntaxNode[] = [];
    const typeNodeTypes = new Set([
      'type_identifier',
      'generic_type',
      'scoped_type_identifier',
      'array_type',
      'integral_type',
      'floating_point_type',
      'boolean_type',
      'void_type',
      'annotated_type', // For TYPE_USE annotations like (@TA String), (String @TA [])
    ]);

    for (const child of ExpressionReferenceExtractor.namedOperands(node)) {
      if (typeNodeTypes.has(child.type)) {
        typeNodes.push(child);
      }
    }

    return typeNodes;
  }

  /**
   * Queue children of an array access expression.
   * 
   * array_access structure: array[index]
   * - array: the expression being indexed (QUALIFIER)
   * - index: the index expression (ARRAY_INDEX)
   * 
   * Example: arr[0] -> queue 'arr' as QUALIFIER, '0' as ARRAY_INDEX
   * Example: matrix[i][j] -> queue 'matrix[i]' as QUALIFIER, 'j' as ARRAY_INDEX
   */
  private queueArrayAccessChildren(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    // array_access has named fields 'array' and 'index'
    const arrayNode = node.childForFieldName('array');
    if (arrayNode) {
      this.pendingChildren.push({
        node: arrayNode,
        parentHash,
        edgeRole: EdgeRole.QUALIFIER,
        position: 0,
        depth: depth + 1,
        typeRegistryHash: this.currentTypeRegistryHash,
        ownerHash: this.currentOwnerHash,
        ownerKind: this.currentOwnerKind,
        rootContext: this.currentRootContext,
      });
    }

    const indexNode = node.childForFieldName('index');
    if (indexNode) {
      this.pendingChildren.push({
        node: indexNode,
        parentHash,
        edgeRole: EdgeRole.ARRAY_INDEX,
        position: 0,
        depth: depth + 1,
        typeRegistryHash: this.currentTypeRegistryHash,
        ownerHash: this.currentOwnerHash,
        ownerKind: this.currentOwnerKind,
        rootContext: this.currentRootContext,
      });
    }
  }

  /**
   * Queue children of a switch expression (Java 14+).
   * 
   * switch_expression structure:
   * - condition field: parenthesized_expression containing the selector
   * - body field: switch_block containing switch_rule nodes
   * 
   * Each switch_rule contains:
   * - switch_label: case labels (constants or default)
   * - expression_statement or block: the result expression
   * 
   * Children queued:
   * - SWITCH_SELECTOR: the selector expression inside parentheses
   * - SWITCH_CASE_LABEL: each constant in case labels (position tracks within case)
   * - SWITCH_CASE_RESULT: each case result expression
   */
  private queueSwitchExpressionChildren(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    // Queue the selector expression (inside parenthesized_expression)
    const condition = node.childForFieldName('condition');
    if (condition) {
      // The condition is a parenthesized_expression, get the inner expression
      const selector = ExpressionReferenceExtractor.namedOperands(condition)[0];
      if (selector) {
        this.pendingChildren.push({
          node: selector,
          parentHash,
          edgeRole: EdgeRole.SWITCH_SELECTOR,
          position: 0,
          depth: depth + 1,
          typeRegistryHash: this.currentTypeRegistryHash,
          ownerHash: this.currentOwnerHash,
          ownerKind: this.currentOwnerKind,
          rootContext: this.currentRootContext,
        });
      }
    }

    // Queue case labels and results from switch_block
    // Use casePosition for both labels and results so they can be linked
    const body = node.childForFieldName('body');
    if (body) {
      let casePosition = 0;
      
      for (const child of ExpressionReferenceExtractor.namedOperands(body)) {
        // Handle arrow syntax (switch_rule)
        if (child.type === 'switch_rule') {
          this.extractSwitchRule(child, parentHash, depth, casePosition);
          casePosition++;
        }
        // Handle colon syntax (switch_block_statement_group)
        else if (child.type === 'switch_block_statement_group') {
          this.extractSwitchBlockStatementGroup(child, parentHash, depth, casePosition);
          casePosition++;
        }
      }
    }
  }

  /**
   * Extract children from a switch_rule (arrow syntax: case X -> result).
   * 
   * Handles:
   * - expression_statement: direct expression result
   * - block: look for yield_statement inside
   * - throw_statement: extract throw expression
   * - guard: extract guard expression (when clause)
   */
  private extractSwitchRule(
    ruleNode: Parser.SyntaxNode,
    parentHash: string,
    depth: number,
    casePosition: number
  ): void {
    const switchLabel = ruleNode.children.find(c => c.type === 'switch_label');
    
    // Extract pattern binding names from the switch label to pass to result expressions
    let patternBindingNames: Set<string> | undefined;
    if (switchLabel) {
      patternBindingNames = this.extractPatternBindingNames(switchLabel);
      this.extractSwitchLabelChildren(switchLabel, parentHash, depth, casePosition);
    }

    // Find the result node (after the arrow)
    const resultNode = ruleNode.children.find(c => 
      c.type === 'expression_statement' || 
      c.type === 'block' || 
      c.type === 'throw_statement'
    );

    if (resultNode) {
      if (resultNode.type === 'expression_statement') {
        // Direct expression result
        const expr = ExpressionReferenceExtractor.namedOperands(resultNode)[0];
        if (expr) {
          this.pendingChildren.push({
            node: expr,
            parentHash,
            edgeRole: EdgeRole.SWITCH_CASE_RESULT,
            position: casePosition,
            depth: depth + 1,
            typeRegistryHash: this.currentTypeRegistryHash,
            ownerHash: this.currentOwnerHash,
            ownerKind: this.currentOwnerKind,
            rootContext: this.currentRootContext,
            patternBindingNames: patternBindingNames && patternBindingNames.size > 0 ? patternBindingNames : undefined,
          });
        }
      } else if (resultNode.type === 'block') {
        // Block with yield - find yield_statement and extract its expression
        this.extractYieldFromBlock(resultNode, parentHash, depth, casePosition, patternBindingNames);
      } else if (resultNode.type === 'throw_statement') {
        // Throw statement - extract the thrown expression
        const thrownExpr = ExpressionReferenceExtractor.namedOperands(resultNode)[0];
        if (thrownExpr) {
          this.pendingChildren.push({
            node: thrownExpr,
            parentHash,
            edgeRole: EdgeRole.SWITCH_CASE_RESULT,
            position: casePosition,
            depth: depth + 1,
            typeRegistryHash: this.currentTypeRegistryHash,
            ownerHash: this.currentOwnerHash,
            ownerKind: this.currentOwnerKind,
            rootContext: this.currentRootContext,
            patternBindingNames: patternBindingNames && patternBindingNames.size > 0 ? patternBindingNames : undefined,
          });
        }
      }
    }
  }

  /**
   * Extract children from a switch_block_statement_group (colon syntax: case X: result).
   * 
   * Handles:
   * - case X: yield expr;  (yield_statement)
   * - case X: expr;        (expression_statement - implicit yield)
   * - case X: { ... }      (block containing yield)
   */
  private extractSwitchBlockStatementGroup(
    groupNode: Parser.SyntaxNode,
    parentHash: string,
    depth: number,
    casePosition: number
  ): void {
    // First, collect pattern binding names from all switch labels in this group
    let patternBindingNames: Set<string> | undefined;
    for (const child of groupNode.children) {
      if (child.type === 'switch_label') {
        const labelBindings = this.extractPatternBindingNames(child);
        if (labelBindings.size > 0) {
          if (!patternBindingNames) {
            patternBindingNames = new Set<string>();
          }
          for (const name of labelBindings) {
            patternBindingNames.add(name);
          }
        }
      }
    }

    // Extract labels and results from all children
    for (const child of groupNode.children) {
      if (child.type === 'switch_label') {
        this.extractSwitchLabelChildren(child, parentHash, depth, casePosition);
      }
      // Handle yield_statement (explicit yield)
      else if (child.type === 'yield_statement') {
        const yieldExpr = ExpressionReferenceExtractor.namedOperands(child)[0];
        if (yieldExpr) {
          this.pendingChildren.push({
            node: yieldExpr,
            parentHash,
            edgeRole: EdgeRole.SWITCH_CASE_RESULT,
            position: casePosition,
            depth: depth + 1,
            typeRegistryHash: this.currentTypeRegistryHash,
            ownerHash: this.currentOwnerHash,
            ownerKind: this.currentOwnerKind,
            rootContext: this.currentRootContext,
            patternBindingNames: patternBindingNames && patternBindingNames.size > 0 ? patternBindingNames : undefined,
          });
        }
      }
      // Note: expression_statement nodes in colon-syntax switch cases are regular statements
      // (e.g., someRandom.forEach(...)), NOT implicit yields. Only yield_statement produces
      // a result. These expression statements are extracted by TypeMethodExtractor.
      // Handle block (case X: { ... yield ... })
      else if (child.type === 'block') {
        this.extractYieldFromBlock(child, parentHash, depth, casePosition, patternBindingNames);
      }
    }
  }

  /**
   * Extract children from a switch_label (case constants, patterns, guards).
   * 
   * Handles:
   * - Constant expressions (literals, enum constants)
   * - Type patterns (case String s)
   * - Guards (when clause)
   * - Default case (no expression, just "default" keyword)
   */
  private extractSwitchLabelChildren(
    labelNode: Parser.SyntaxNode,
    parentHash: string,
    depth: number,
    casePosition: number
  ): void {
    // Check if this is a default case (no named children and text contains "default")
    if (ExpressionReferenceExtractor.namedOperands(labelNode).length === 0 && labelNode.text.includes('default')) {
      // Create an IDENTIFIER_REFERENCE for the default keyword
      // This ensures the default case has a SWITCH_CASE_LABEL entry
      const defaultKeyword = labelNode.children.find(c => c.type === 'default');
      if (defaultKeyword) {
        const builder = ExpressionReference.builder(
          this.currentTypeRegistryHash,
          this.currentOwnerHash,
          this.currentOwnerKind,
          this.currentRootContext,
          ExpressionKind.IDENTIFIER_REFERENCE,
          EdgeRole.SWITCH_CASE_LABEL
        );
        builder.positionAndDepth(casePosition, depth + 1);
        builder.parent(parentHash);
        builder.classLiteralTypeName('default'); // Store 'default' as the identifier name
        builder.location(
          defaultKeyword.startPosition.row + 1,
          defaultKeyword.startPosition.column,
          defaultKeyword.endPosition.row + 1,
          defaultKeyword.endPosition.column
        );
        this.extractedExpressions.push(builder.build());
      }
      return;
    }

    for (const labelChild of ExpressionReferenceExtractor.namedOperands(labelNode)) {
      if (labelChild.type === 'guard') {
        // Extract guard expression (when clause) - e.g., "when s.length() > 5"
        // The guard node contains the expression after 'when'
        const guardExpr = ExpressionReferenceExtractor.namedOperands(labelChild)[0];
        if (guardExpr) {
          this.pendingChildren.push({
            node: guardExpr,
            parentHash,
            edgeRole: EdgeRole.SWITCH_GUARD,
            position: casePosition,
            depth: depth + 1,
            typeRegistryHash: this.currentTypeRegistryHash,
            ownerHash: this.currentOwnerHash,
            ownerKind: this.currentOwnerKind,
            rootContext: this.currentRootContext,
          });
        }
      } else if (labelChild.type === 'pattern') {
        // Pattern wrapper node - extract type_pattern or record_pattern inside
        const typePattern = ExpressionReferenceExtractor.namedOperands(labelChild).find(c => c.type === 'type_pattern');
        const recordPattern = ExpressionReferenceExtractor.namedOperands(labelChild).find(c => c.type === 'record_pattern');
        if (typePattern) {
          this.extractTypePattern(typePattern, parentHash, depth, casePosition);
        } else if (recordPattern) {
          this.pendingChildren.push({
            node: recordPattern,
            parentHash,
            edgeRole: EdgeRole.SWITCH_CASE_LABEL,
            position: casePosition,
            depth: depth + 1,
            typeRegistryHash: this.currentTypeRegistryHash,
            ownerHash: this.currentOwnerHash,
            ownerKind: this.currentOwnerKind,
            rootContext: this.currentRootContext,
          });
        }
      } else if (labelChild.type === 'type_pattern') {
        // Direct type_pattern node (case String s)
        this.extractTypePattern(labelChild, parentHash, depth, casePosition);
      } else if (labelChild.type === 'record_pattern') {
        // Record pattern in switch case (case Customer(String name, Address addr) ->)
        this.pendingChildren.push({
          node: labelChild,
          parentHash,
          edgeRole: EdgeRole.SWITCH_CASE_LABEL,
          position: casePosition,
          depth: depth + 1,
          typeRegistryHash: this.currentTypeRegistryHash,
          ownerHash: this.currentOwnerHash,
          ownerKind: this.currentOwnerKind,
          rootContext: this.currentRootContext,
        });
      } else {
        // Regular case label constant (literal, identifier, etc.)
        this.pendingChildren.push({
          node: labelChild,
          parentHash,
          edgeRole: EdgeRole.SWITCH_CASE_LABEL,
          position: casePosition,
          depth: depth + 1,
          typeRegistryHash: this.currentTypeRegistryHash,
          ownerHash: this.currentOwnerHash,
          ownerKind: this.currentOwnerKind,
          rootContext: this.currentRootContext,
        });
      }
    }
  }

  /**
   * Extract type pattern from switch case (case String s -> ...).
   * Extracts the pattern variable as SWITCH_TYPE_PATTERN.
   * The type (String) is extracted as a type reference.
   * 
   * Tree structure:
   *   type_pattern
   *     ├── type_identifier "String"
   *     └── identifier "s"
   */
  private extractTypePattern(
    typePatternNode: Parser.SyntaxNode,
    parentHash: string,
    depth: number,
    casePosition: number
  ): void {
    // Find the pattern variable identifier (the 's' in 'String s')
    const variableIdentifier = ExpressionReferenceExtractor.namedOperands(typePatternNode).find(
      c => c.type === 'identifier'
    );
    
    if (variableIdentifier) {
      this.pendingChildren.push({
        node: variableIdentifier,
        parentHash,
        edgeRole: EdgeRole.SWITCH_TYPE_PATTERN,
        position: casePosition,
        depth: depth + 1,
        typeRegistryHash: this.currentTypeRegistryHash,
        ownerHash: this.currentOwnerHash,
        ownerKind: this.currentOwnerKind,
        rootContext: this.currentRootContext,
      });
    }

    // Extract type reference from the type node (type_identifier, generic_type, array_type, etc.)
    const typeIdentifier = ExpressionReferenceExtractor.namedOperands(typePatternNode).find(
      c => c.type === 'type_identifier' || c.type === 'generic_type' || c.type === 'scoped_type_identifier' || c.type === 'array_type'
    );
    
    if (typeIdentifier) {
      const typeRefs = this.typeReferenceExtractor.extractFromSwitchTypePattern(
        typeIdentifier,
        this.currentTypeRegistryHash,
        parentHash, // expression hash as the owner
        this.currentPackageName,
        casePosition // pass case position for linking with pattern binding
      );
      this.extractedTypeReferences.push(...typeRefs);
    }
  }

  /**
   * Extract pattern binding variable names from a switch label.
   * Used to pass pattern variable names into scope for switch case results.
   * 
   * @param labelNode The switch_label node to extract pattern bindings from
   * @returns Set of pattern binding variable names found in the label
   */
  private extractPatternBindingNames(labelNode: Parser.SyntaxNode): Set<string> {
    const names = new Set<string>();
    
    for (const labelChild of ExpressionReferenceExtractor.namedOperands(labelNode)) {
      if (labelChild.type === 'pattern') {
        // Pattern wrapper node - look for type_pattern or record_pattern inside
        const typePattern = ExpressionReferenceExtractor.namedOperands(labelChild).find(c => c.type === 'type_pattern');
        const recordPattern = ExpressionReferenceExtractor.namedOperands(labelChild).find(c => c.type === 'record_pattern');
        if (typePattern) {
          const varId = ExpressionReferenceExtractor.namedOperands(typePattern).find(c => c.type === 'identifier');
          if (varId) names.add(varId.text);
        } else if (recordPattern) {
          this.collectRecordPatternBindingNames(recordPattern, names);
        }
      } else if (labelChild.type === 'type_pattern') {
        // Direct type_pattern node (case String s)
        const varId = ExpressionReferenceExtractor.namedOperands(labelChild).find(c => c.type === 'identifier');
        if (varId) names.add(varId.text);
      } else if (labelChild.type === 'record_pattern') {
        // Record pattern in switch case
        this.collectRecordPatternBindingNames(labelChild, names);
      }
    }
    
    return names;
  }

  /**
   * Recursively collect pattern binding names from a record pattern.
   * Record patterns can be nested: case Point(int x, int y) or case Pair(Point(int x, int y), String s)
   * 
   * AST structure:
   *   record_pattern
   *     -> identifier (type name, e.g., "Point" - NOT a binding!)
   *     -> record_pattern_body
   *        -> record_pattern_component (e.g., "int x")
   *           -> type (integral_type or type_identifier)
   *           -> identifier (binding name, e.g., "x")
   *        -> record_pattern_component (e.g., "int y")
   *           -> type
   *           -> identifier (binding name, e.g., "y")
   */
  private collectRecordPatternBindingNames(recordPatternNode: Parser.SyntaxNode, names: Set<string>): void {
    // Find record_pattern_body which contains the actual pattern components
    const body = ExpressionReferenceExtractor.namedOperands(recordPatternNode).find(c => c.type === 'record_pattern_body');
    if (body) {
      for (const component of ExpressionReferenceExtractor.namedOperands(body)) {
        if (component.type === 'record_pattern_component') {
          // Each component has a type and an identifier (the binding variable)
          const bindingId = ExpressionReferenceExtractor.namedOperands(component).find(c => c.type === 'identifier');
          if (bindingId) {
            names.add(bindingId.text);
          }
          // Check for nested record patterns within the component
          const nestedRecordPattern = ExpressionReferenceExtractor.namedOperands(component).find(c => c.type === 'record_pattern');
          if (nestedRecordPattern) {
            this.collectRecordPatternBindingNames(nestedRecordPattern, names);
          }
          // Check for type patterns within the component
          const typePattern = ExpressionReferenceExtractor.namedOperands(component).find(c => c.type === 'type_pattern');
          if (typePattern) {
            const varId = ExpressionReferenceExtractor.namedOperands(typePattern).find(c => c.type === 'identifier');
            if (varId) names.add(varId.text);
          }
        } else if (component.type === 'record_pattern') {
          // Nested record pattern directly in body (rare but possible)
          this.collectRecordPatternBindingNames(component, names);
        }
      }
    }
  }

  /**
   * Extract yield expressions from a block in a switch arm.
   * Finds all yield_statement nodes and extracts their expressions.
   * Pre-scans the block for local variable declarations to correctly classify identifiers.
   */
  private extractYieldFromBlock(
    blockNode: Parser.SyntaxNode,
    parentHash: string,
    depth: number,
    casePosition: number,
    patternBindingNames?: Set<string>
  ): void {
    // Pre-scan block for local variable declarations to add to currentLocalVariableNames
    // This ensures identifiers in yield expressions are correctly classified
    const blockLocalVarNames = this.findLocalVariableNamesInBlock(blockNode);
    const previousLocalVarNames = new Set(this.currentLocalVariableNames);
    for (const name of blockLocalVarNames) {
      this.currentLocalVariableNames.add(name);
    }

    // Find yield_statement recursively (could be nested in if/else)
    const findYields = (node: Parser.SyntaxNode): Parser.SyntaxNode[] => {
      const yields: Parser.SyntaxNode[] = [];
      if (node.type === 'yield_statement') {
        yields.push(node);
      }
      for (const child of ExpressionReferenceExtractor.namedOperands(node)) {
        yields.push(...findYields(child));
      }
      return yields;
    };

    const yieldStatements = findYields(blockNode);
    for (const yieldStmt of yieldStatements) {
      const yieldExpr = ExpressionReferenceExtractor.namedOperands(yieldStmt)[0];
      if (yieldExpr) {
        this.pendingChildren.push({
          node: yieldExpr,
          parentHash,
          edgeRole: EdgeRole.SWITCH_CASE_RESULT,
          position: casePosition,
          depth: depth + 1,
          typeRegistryHash: this.currentTypeRegistryHash,
          ownerHash: this.currentOwnerHash,
          ownerKind: this.currentOwnerKind,
          rootContext: this.currentRootContext,
          localVariableNames: new Set(this.currentLocalVariableNames),
          patternBindingNames: patternBindingNames && patternBindingNames.size > 0 ? patternBindingNames : undefined,
        });
      }
    }

    // Restore previous local variable names
    this.currentLocalVariableNames = previousLocalVarNames;
  }

  /**
   * Find all local variable names declared in a block (non-recursively into nested blocks).
   */
  private findLocalVariableNamesInBlock(blockNode: Parser.SyntaxNode): Set<string> {
    const names = new Set<string>();
    
    const scanForDeclarations = (node: Parser.SyntaxNode): void => {
      if (node.type === 'local_variable_declaration') {
        // Find variable declarators
        for (const child of ExpressionReferenceExtractor.namedOperands(node)) {
          if (child.type === 'variable_declarator') {
            const nameNode = ExpressionReferenceExtractor.namedOperands(child).find(c => c.type === 'identifier');
            if (nameNode) {
              names.add(nameNode.text);
            }
          }
        }
      }
      // Don't recurse into nested blocks, lambdas, or anonymous classes
      if (node.type !== 'block' && node.type !== 'lambda_expression' && 
          node.type !== 'class_body' && node.type !== 'anonymous_class_body') {
        for (const child of ExpressionReferenceExtractor.namedOperands(node)) {
          scanForDeclarations(child);
        }
      }
    };

    // Scan the block's direct children
    for (const child of ExpressionReferenceExtractor.namedOperands(blockNode)) {
      scanForDeclarations(child);
    }

    return names;
  }

  /**
   * Queue children of a string template expression (Java 21+ preview).
   * 
   * AST structure:
   *   template_expression
   *   ├── identifier: "STR" (processor)
   *   ├── .: "."
   *   └── string_literal
   *       ├── string_fragment: "Hello, "
   *       ├── string_interpolation
   *       │   ├── \{
   *       │   ├── [expression]
   *       │   └── }
   *       └── string_fragment: "!"
   * 
   * Extracts:
   * - TEMPLATE_LITERAL: The full template string (as LITERAL) with placeholders
   * - TEMPLATE_EMBEDDED: Each embedded expression in \{...}, with position index
   * 
   * Additional data stored:
   * - templateProcessor: The processor name (STR, FMT, RAW, or custom)
   */
  private queueStringTemplateChildren(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    // Find the string_literal child which contains the template
    const stringLiteral = ExpressionReferenceExtractor.namedOperands(node).find(c => c.type === 'string_literal');
    if (!stringLiteral) return;

    // Create a synthetic LITERAL for the full template text
    // This allows reconstruction of the template structure
    this.createTemplateLiteralExpression(stringLiteral, parentHash, depth);

    // Find all string_interpolation nodes (embedded expressions)
    let embeddedPosition = 0;
    for (const child of stringLiteral.children) {
      if (child.type === 'string_interpolation') {
        // Find the actual expression inside the interpolation
        // Structure: \{ + expression + }
        for (const interpChild of ExpressionReferenceExtractor.namedOperands(child)) {
          // Skip punctuation, find the actual expression
          if (interpChild.type !== '\\{' && interpChild.type !== '}') {
            this.pendingChildren.push({
              node: interpChild,
              parentHash,
              edgeRole: EdgeRole.TEMPLATE_EMBEDDED,
              position: embeddedPosition,
              depth: depth + 1,
              typeRegistryHash: this.currentTypeRegistryHash,
              ownerHash: this.currentOwnerHash,
              ownerKind: this.currentOwnerKind,
              rootContext: this.currentRootContext,
            });
          }
        }
        embeddedPosition++;
      }
    }
  }

  /**
   * Creates a synthetic LITERAL expression for the full template string.
   * The literal value contains the template with \{...} placeholders preserved.
   */
  private createTemplateLiteralExpression(
    stringLiteral: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    // Get the full template text and strip quotes (like other string literals)
    const rawText = stringLiteral.text;
    let templateText = rawText;
    
    // Strip surrounding quotes: """...""" for text blocks, "..." for regular strings
    if (rawText.startsWith('"""') && rawText.endsWith('"""')) {
      templateText = rawText.slice(3, -3);
    } else if (rawText.startsWith('"') && rawText.endsWith('"')) {
      templateText = rawText.slice(1, -1);
    }
    
    const builder = ExpressionReference.builder(
      this.currentTypeRegistryHash,
      this.currentOwnerHash,
      this.currentOwnerKind,
      this.currentRootContext,
      ExpressionKind.LITERAL,
      EdgeRole.TEMPLATE_LITERAL
    );
    builder.parent(parentHash);
    builder.positionAndDepth(0, depth + 1);
    builder.literal(LiteralType.STRING, templateText);
    builder.location(
      stringLiteral.startPosition.row + 1,
      stringLiteral.startPosition.column,
      stringLiteral.endPosition.row + 1,
      stringLiteral.endPosition.column
    );

    this.extractedExpressions.push(builder.build());
  }

  /**
   * Queue children of a record pattern (Java 21+).
   * 
   * AST structure:
   *   record_pattern
   *   ├── identifier: "Person" (record type name)
   *   └── record_pattern_body
   *       ├── record_pattern_component: "String n"
   *       │   ├── type_identifier: "String"
   *       │   └── identifier: "n"
   *       └── record_pattern (nested, for nested patterns)
   * 
   * Extracts:
   * - Type reference for the record type (Person, Employee, etc.)
   * - RECORD_PATTERN_BINDING for each pattern variable binding
   * - Nested RECORD_PATTERN for nested record patterns
   */
  private queueRecordPatternChildren(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    // Extract the record type name and create a type reference
    // Handle both simple identifiers (Point) and generic types (Pair<Object, Object>)
    const recordTypeNode = ExpressionReferenceExtractor.namedOperands(node).find(c => 
      c.type === 'identifier' || c.type === 'generic_type'
    );
    if (recordTypeNode) {
      const typeRefs = this.typeReferenceExtractor.extractFromRecordPattern(
        recordTypeNode,
        this.currentTypeRegistryHash,
        parentHash,
        this.currentPackageName
      );
      this.extractedTypeReferences.push(...typeRefs);
    }

    // Find the record_pattern_body
    const patternBody = ExpressionReferenceExtractor.namedOperands(node).find(c => c.type === 'record_pattern_body');
    if (!patternBody) return;

    // Extract each component from the pattern body
    let position = 0;
    for (const child of ExpressionReferenceExtractor.namedOperands(patternBody)) {
      if (child.type === 'record_pattern_component') {
        // Extract the binding variable (identifier) and its type
        const bindingVar = ExpressionReferenceExtractor.namedOperands(child).find(c => c.type === 'identifier');
        const typeNode = ExpressionReferenceExtractor.namedOperands(child).find(c => 
          c.type === 'type_identifier' || c.type === 'integral_type' || 
          c.type === 'floating_point_type' || c.type === 'boolean_type' ||
          c.type === 'generic_type' || c.type === 'array_type' ||
          c.type === 'scoped_type_identifier'  // For fully qualified types like java.io.Serializable
        );

        // Extract type reference for the component type (pattern binding type)
        if (typeNode) {
          const typeRefs = this.typeReferenceExtractor.extractFromPatternBinding(
            typeNode,
            this.currentTypeRegistryHash,
            parentHash,
            this.currentPackageName
          );
          this.extractedTypeReferences.push(...typeRefs);
        }

        // Queue the binding variable as an expression
        if (bindingVar) {
          // Track pattern binding name so later references are classified as PATTERN_BINDING_VARIABLE
          this.currentPatternBindingNames.add(bindingVar.text);
          
          this.pendingChildren.push({
            node: bindingVar,
            parentHash,
            edgeRole: EdgeRole.RECORD_PATTERN_BINDING,
            position: position,
            depth: depth + 1,
            typeRegistryHash: this.currentTypeRegistryHash,
            ownerHash: this.currentOwnerHash,
            ownerKind: this.currentOwnerKind,
            rootContext: this.currentRootContext,
          });
        }
        position++;
      } else if (child.type === 'record_pattern') {
        // Nested record pattern - queue it as a child
        this.pendingChildren.push({
          node: child,
          parentHash,
          edgeRole: EdgeRole.RECORD_PATTERN_BINDING, // Nested pattern at this position
          position: position,
          depth: depth + 1,
          typeRegistryHash: this.currentTypeRegistryHash,
          ownerHash: this.currentOwnerHash,
          ownerKind: this.currentOwnerKind,
          rootContext: this.currentRootContext,
        });
        position++;
      }
    }
  }

  /**
   * Queue children of a lambda expression.
   * 
   * Lambda AST structure:
   *   lambda_expression
   *   ├── identifier (single param without parens): x
   *   │   OR formal_parameters: (int x, int y)
   *   │   OR inferred_parameters: (x, y)
   *   ├── -> (arrow)
   *   └── body: expression OR block
   * 
   * Examples:
   * - x -> x * 2                    (identifier param, expression body)
   * - (x, y) -> x + y               (inferred params, expression body)
   * - (int x) -> x * 2              (formal params, expression body)
   * - x -> { return x * 2; }        (identifier param, block body)
   * 
   * We extract:
   * - Lambda parameters as LAMBDA_PARAMETER children
   * - The body expression (with LAMBDA_BODY edge role)
   * 
   * Note: Block bodies (statement lambdas) are not extracted as they require
   * method body extraction which is not yet implemented.
   */
  private queueLambdaChildren(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    let paramPosition = 0;
    let bodyPosition = 0;
    
    // Collect lambda parameter names for scope tracking
    const lambdaParamNames = new Set<string>();

    // Check if there are any formal_parameters or inferred_parameters
    // If so, an identifier child is the body, not a parameter
    const hasParamList = ExpressionReferenceExtractor.namedOperands(node).some(child => 
      child.type === 'formal_parameters' || child.type === 'inferred_parameters'
    );

    // Extract lambda parameters as expression children
    for (const child of ExpressionReferenceExtractor.namedOperands(node)) {
      if (child.type === 'identifier' && !hasParamList) {
        // Single parameter without parentheses: x -> x * 2
        // Only treat as parameter if there's no formal_parameters or inferred_parameters
        lambdaParamNames.add(child.text);
        this.pendingChildren.push({
          node: child,
          parentHash,
          edgeRole: EdgeRole.LAMBDA_PARAMETER,
          position: paramPosition++,
          depth: depth + 1,
          typeRegistryHash: this.currentTypeRegistryHash,
          ownerHash: this.currentOwnerHash,
          ownerKind: this.currentOwnerKind,
          rootContext: this.currentRootContext,
        });
      } else if (child.type === 'inferred_parameters') {
        // Inferred parameters: (x, y) -> x + y
        for (const param of ExpressionReferenceExtractor.namedOperands(child)) {
          if (param.type === 'identifier') {
            lambdaParamNames.add(param.text);
            this.pendingChildren.push({
              node: param,
              parentHash,
              edgeRole: EdgeRole.LAMBDA_PARAMETER,
              position: paramPosition++,
              depth: depth + 1,
              typeRegistryHash: this.currentTypeRegistryHash,
              ownerHash: this.currentOwnerHash,
              ownerKind: this.currentOwnerKind,
              rootContext: this.currentRootContext,
            });
          }
        }
      } else if (child.type === 'formal_parameters') {
        // Formal parameters: (int x, int y) -> x + y
        // Also handles: (String s) -> s.length(), (var x) -> x * 2
        let typePosition = 0;
        for (const param of ExpressionReferenceExtractor.namedOperands(child)) {
          if (param.type === 'formal_parameter' || param.type === 'spread_parameter') {
            // Extract the parameter type reference
            const typeNode = ExpressionReferenceExtractor.namedOperands(param).find(n => 
              n.type === 'type_identifier' || 
              n.type === 'integral_type' || 
              n.type === 'floating_point_type' || 
              n.type === 'boolean_type' ||
              n.type === 'generic_type' || 
              n.type === 'array_type' ||
              n.type === 'scoped_type_identifier'
            );
            if (typeNode) {
              const typeRefs = this.typeReferenceExtractor.extractFromLambdaParameter(
                typeNode,
                this.currentTypeRegistryHash,
                parentHash,
                this.currentPackageName,
                typePosition++
              );
              this.extractedTypeReferences.push(...typeRefs);
            }

            // Extract the parameter name
            const nameNode = ExpressionReferenceExtractor.namedOperands(param).find(n => n.type === 'identifier');
            if (nameNode) {
              lambdaParamNames.add(nameNode.text);
              this.pendingChildren.push({
                node: nameNode,
                parentHash,
                edgeRole: EdgeRole.LAMBDA_PARAMETER,
                position: paramPosition++,
                depth: depth + 1,
                typeRegistryHash: this.currentTypeRegistryHash,
                ownerHash: this.currentOwnerHash,
                ownerKind: this.currentOwnerKind,
                rootContext: this.currentRootContext,
              });
            }
          }
        }
      }
    }

    // Find and queue the lambda body
    // If hasParamList is true, an identifier can be the body (e.g., () -> capturedValue)
    // If hasParamList is false, the identifier is the parameter, so body is something else
    const bodyNode = ExpressionReferenceExtractor.namedOperands(node).find(child => 
      child.type !== 'formal_parameters' && 
      child.type !== 'inferred_parameters' &&
      (hasParamList || child.type !== 'identifier')
    );

    if (bodyNode) {
      // For expression bodies, queue the expression directly
      // For block bodies, we skip (requires method body extraction)
      if (bodyNode.type !== 'block') {
        // Merge current lambda params with any outer lambda params
        const mergedLambdaParams = new Set([...this.currentLambdaParamNames, ...lambdaParamNames]);
        this.pendingChildren.push({
          node: bodyNode,
          parentHash,
          edgeRole: EdgeRole.LAMBDA_BODY,
          position: bodyPosition,
          depth: depth + 1,
          typeRegistryHash: this.currentTypeRegistryHash,
          ownerHash: this.currentOwnerHash,
          ownerKind: this.currentOwnerKind,
          rootContext: this.currentRootContext,
          lambdaParamNames: mergedLambdaParams,
        });
      }
    }
  }

  /**
   * Queue children of an object creation expression and extract type reference.
   * 
   * Handles:
   * - Simple: new Object()
   * - Generic: new ArrayList<String>()
   * - Diamond: new ArrayList<>()
   * - Qualified inner: outer.new Inner()
   * - Anonymous: new Runnable() { ... }
   * - Generic constructor: new <String>GenericCtor()
   * 
   * Children:
   * - ENCLOSING_INSTANCE: qualifier in outer.new Inner()
   * - ARGUMENT: constructor arguments
   */
  private queueObjectCreationChildren(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    // Check for qualified inner class creation (outer.new Inner)
    // First named child would be the enclosing instance (not type-related)
    const firstNamedChild = ExpressionReferenceExtractor.namedOperands(node)[0];
    if (firstNamedChild && 
        firstNamedChild.type !== 'type_identifier' && 
        firstNamedChild.type !== 'generic_type' &&
        firstNamedChild.type !== 'scoped_type_identifier' &&
        firstNamedChild.type !== 'type_arguments' &&
        firstNamedChild.type !== 'annotated_type') {
      // This is the enclosing instance (qualifier)
      this.pendingChildren.push({
        node: firstNamedChild,
        parentHash,
        edgeRole: EdgeRole.ENCLOSING_INSTANCE,
        position: 0,
        depth: depth + 1,
        typeRegistryHash: this.currentTypeRegistryHash,
        ownerHash: this.currentOwnerHash,
        ownerKind: this.currentOwnerKind,
        rootContext: this.currentRootContext,
      });
    }

    // Queue constructor arguments
    const argsNode = node.childForFieldName('arguments');
    if (argsNode) {
      let position = 0;
      for (const child of ExpressionReferenceExtractor.namedOperands(argsNode)) {
        this.pendingChildren.push({
          node: child,
          parentHash,
          edgeRole: EdgeRole.ARGUMENT,
          position,
          depth: depth + 1,
          typeRegistryHash: this.currentTypeRegistryHash,
          ownerHash: this.currentOwnerHash,
          ownerKind: this.currentOwnerKind,
          rootContext: this.currentRootContext,
        });
        position++;
      }
    }

    // Extract type reference for the type being instantiated
    const typeNode = node.childForFieldName('type');
    if (typeNode) {
      const typeRefs = this.typeReferenceExtractor.extractFromObjectCreation(
        typeNode,
        this.currentTypeRegistryHash,
        parentHash, // expression hash as the owner
        this.currentPackageName
      );
      this.extractedTypeReferences.push(...typeRefs);
    }

    // Handle generic constructor type arguments (new <String>GenericCtor())
    // These are separate from the type's own type arguments
    this.extractTypeArgumentsIfPresent(node, parentHash);

    // Extract type-use annotations (new @TA Object())
    const annotations = this.annotationExtractor.extractFromCreationExpression(
      node,
      parentHash,
      this.currentTypeRegistryHash
    );
    this.extractedAnnotations.push(...annotations);

    // Collect anonymous class info if this is an anonymous class creation
    const classBodyNode = node.children.find(c => c.type === 'class_body');
    if (classBodyNode && typeNode) {
      const baseTypeName = this.extractBaseTypeName(typeNode);
      const anonymousTypeHash = this.generateAnonymousTypeHash(node);
      this.extractedAnonymousClasses.push({
        classBodyNode,
        creationNode: node,
        expressionHash: parentHash,
        anonymousTypeHash,
        baseTypeName,
        typeRegistryHash: this.currentTypeRegistryHash,
        ownerHash: this.currentOwnerHash,
        ownerKind: this.currentOwnerKind,
        rootContext: this.currentRootContext,
        packageName: this.currentPackageName,
        importMap: new Map(this.currentImportMap),
        hasStarImports: this.currentHasStarImports,
      });
    }
  }

  /**
   * Queue arguments for explicit constructor invocation (this() or super()).
   * Also extracts type arguments if present (e.g., <Integer, String>super(x, "value")).
   * 
   * Example: this(value, null) -> queue 'value' and 'null' as ARGUMENT children
   * Example: super(items.size(), items) -> queue method invocation and identifier as ARGUMENT children
   * Example: <String>super("test") -> extract String as type reference
   */
  private queueConstructorInvocationArguments(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    // Get the arguments from the argument_list field
    const argsNode = node.childForFieldName('arguments');
    if (argsNode) {
      let position = 0;
      for (const child of ExpressionReferenceExtractor.namedOperands(argsNode)) {
        this.pendingChildren.push({
          node: child,
          parentHash,
          edgeRole: EdgeRole.ARGUMENT,
          position,
          depth: depth + 1,
          typeRegistryHash: this.currentTypeRegistryHash,
          ownerHash: this.currentOwnerHash,
          ownerKind: this.currentOwnerKind,
          rootContext: this.currentRootContext,
        });
        position++;
      }
    }

    // Extract type arguments if present (e.g., <Integer, String> in <Integer, String>super(x, y))
    this.extractTypeArgumentsIfPresent(node, parentHash);
  }

  /**
   * Queue the qualifier expression of a method reference.
   * The qualifier is the expression before the :: token.
   * 
   * Examples:
   * - String::length -> qualifier is type identifier "String" (not queued - not an expression)
   * - prefix::concat -> qualifier is identifier "prefix" (queued)
   * - this::method -> qualifier is "this" (queued)
   * - super::method -> qualifier is "super" (queued)
   * - helpers[0]::process -> qualifier is array access (queued)
   * - getHelper()::process -> qualifier is method invocation (queued)
   * - (obj)::method -> qualifier is parenthesized expression (queued)
   * - new Helper()::process -> qualifier is object creation (queued)
   * 
   * Note: Type identifiers (String, Integer) and array types (int[]) are NOT expression nodes
   * and are handled differently - they produce type references, not expression children.
   * This is modular: if we add support for cast_expression later, the qualifier will
   * automatically be extracted when it appears in a method reference like ((Helper) obj)::process
   */
  private queueMethodReferenceQualifier(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    // Find the qualifier - it's the first child before ::
    // Structure: [qualifier] :: [type_arguments?] [method_name | new]
    const colonColonIndex = node.children.findIndex(c => c.type === '::');
    if (colonColonIndex <= 0) {
      return; // No valid qualifier found
    }

    const qualifier = node.children[0];
    if (!qualifier) {
      return;
    }

    // Only queue expression-type qualifiers, not type identifiers
    // Type identifiers (for static refs) are handled by type reference extraction
    const expressionQualifierTypes = [
      'identifier',           // variable reference: prefix::concat
      'this',                 // this::method
      'super',                // super::method
      'field_access',         // qualified this: Outer.this::method, or this.field::method
      'array_access',         // array element: helpers[0]::process
      'method_invocation',    // method result: getHelper()::process
      'parenthesized_expression', // parenthesized: (obj)::method, ((Helper) obj)::method
      'object_creation_expression', // new expression: new Helper()::process
      // Future: These will work automatically once we add their support:
      // 'cast_expression',     // cast: ((Type) obj)::method - currently returns UNKNOWN
      // 'lambda_expression',   // rare but valid: ((Supplier<Helper>) (() -> new Helper())).get()::process
    ];

    if (expressionQualifierTypes.includes(qualifier.type)) {
      this.pendingChildren.push({
        node: qualifier,
        parentHash,
        edgeRole: EdgeRole.QUALIFIER,
        position: 0,
        depth: depth + 1,
        typeRegistryHash: this.currentTypeRegistryHash,
        ownerHash: this.currentOwnerHash,
        ownerKind: this.currentOwnerKind,
        rootContext: this.currentRootContext,
      });

      // For field_access qualifiers that represent type access (e.g., Type1.Type2::staticMethod),
      // also extract type references for consistency with type-based qualifiers.
      // The expression extraction captures the structure, but we also need type references
      // to link to the actual types in the type-references output.
      if (qualifier.type === 'field_access') {
        this.extractTypeReferencesFromFieldAccessQualifier(qualifier, parentHash);
      }
    }

    // Extract type references for type-based qualifiers
    // These are not expression nodes but type nodes: String::valueOf, String[]::new, List<String>::new
    const typeQualifierTypes = [
      'type_identifier',         // Simple types: String::valueOf, Integer::sum
      'array_type',              // Array types: String[]::new, int[]::new
      'generic_type',            // Generic types: List<String>::new, Map<K,V>::new
      'scoped_type_identifier',  // Scoped types: Map.Entry::comparingByKey, Outer.Inner::new
    ];

    if (typeQualifierTypes.includes(qualifier.type)) {
      // For qualified super references (Child.super::method, Outer.Inner.super::method),
      // extract the qualifying type(s) but not 'super' itself
      let qualifierToExtract = qualifier;
      if (qualifier.type === 'scoped_type_identifier') {
        const lastChild = qualifier.children[qualifier.children.length - 1];
        if (lastChild && lastChild.type === 'type_identifier' && lastChild.text === 'super') {
          // Extract the qualifying type (everything before .super)
          // For Child.super, extract Child; for Outer.Inner.super, extract Outer.Inner
          const qualifyingType = qualifier.children.find(
            c => c.type === 'type_identifier' || c.type === 'scoped_type_identifier'
          );
          if (qualifyingType) {
            qualifierToExtract = qualifyingType;
          } else {
            qualifierToExtract = null as any; // No qualifying type to extract
          }
        }
      }

      if (qualifierToExtract) {
        const typeRefs = this.typeReferenceExtractor.extractFromMethodReferenceQualifier(
          qualifierToExtract,
          this.currentTypeRegistryHash,
          parentHash,
          this.currentPackageName
        );
        this.extractedTypeReferences.push(...typeRefs);
      }
    }

    // Extract type arguments if present (e.g., Collections::<String>emptyList)
    const typeArgs = node.children.find(c => c.type === 'type_arguments');
    if (typeArgs) {
      const typeRefs = this.typeReferenceExtractor.extractFromMethodTypeArguments(
        typeArgs,
        this.currentTypeRegistryHash,
        parentHash,
        this.currentPackageName
      );
      this.extractedTypeReferences.push(...typeRefs);
    }
  }

  /**
   * Extracts type arguments from a node's 'type_arguments' field if present.
   * Reusable helper for method invocation, object creation, and constructor invocation.
   * 
   * Example: <String, Integer> in Collections.<String>emptyList() or <String>super("test")
   * 
   * @param node The expression node that may have type_arguments
   * @param parentHash The expression hash to link type references to
   * @param useMethodExtractor Whether to use extractFromMethodTypeArguments (true) or extractFromConstructorTypeArguments (false)
   */
  private extractTypeArgumentsIfPresent(
    node: Parser.SyntaxNode,
    parentHash: string,
    useMethodExtractor: boolean = false
  ): void {
    const typeArgs = node.childForFieldName('type_arguments');
    if (typeArgs) {
      const typeRefs = useMethodExtractor
        ? this.typeReferenceExtractor.extractFromMethodTypeArguments(
            typeArgs,
            this.currentTypeRegistryHash,
            parentHash,
            this.currentPackageName
          )
        : this.typeReferenceExtractor.extractFromConstructorTypeArguments(
            typeArgs,
            this.currentTypeRegistryHash,
            parentHash,
            this.currentPackageName
          );
      this.extractedTypeReferences.push(...typeRefs);
    }
  }

  /**
   * Generates a consistent hash for an anonymous type based on its location.
   * This hash is used both in the expression and when registering the type.
   */
  private generateAnonymousTypeHash(node: Parser.SyntaxNode): string {
    const hashInput = `${this.currentTypeRegistryHash}_${node.startPosition.row}_${node.startPosition.column}`;
    return EntityUtils.generateEntityHash('ANONYMOUS_TYPE', hashInput);
  }

  /**
   * Extracts the base type name from a type node (for anonymous class info)
   */
  private extractBaseTypeName(typeNode: Parser.SyntaxNode): string {
    if (typeNode.type === 'type_identifier') {
      return typeNode.text;
    } else if (typeNode.type === 'generic_type') {
      const baseType = typeNode.children.find(c => c.type === 'type_identifier');
      return baseType?.text ?? typeNode.text;
    } else if (typeNode.type === 'scoped_type_identifier') {
      return typeNode.text;
    }
    return typeNode.text;
  }

  /**
   * Queue children of an array creation expression and extract type reference.
   * 
   * Handles:
   * - new int[3] - primitive array with size
   * - new String[5] - reference array with size
   * - new int[] { 1, 2, 3 } - array with initializer
   * - new int[2][3] - multi-dimensional
   * 
   * Children:
   * - ARRAY_DIMENSION: size expressions (3 in new int[3])
   * - ARRAY_ELEMENT: elements in initializer (via nested array_initializer)
   */
  private queueArrayCreationChildren(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    // Queue dimension size expressions (new int[size1][size2])
    let dimPosition = 0;
    for (const child of node.children) {
      if (child.type === 'dimensions_expr') {
        // The size expression is inside dimensions_expr
        for (const dimChild of ExpressionReferenceExtractor.namedOperands(child)) {
          this.pendingChildren.push({
            node: dimChild,
            parentHash,
            edgeRole: EdgeRole.ARRAY_DIMENSION,
            position: dimPosition,
            depth: depth + 1,
            typeRegistryHash: this.currentTypeRegistryHash,
            ownerHash: this.currentOwnerHash,
            ownerKind: this.currentOwnerKind,
            rootContext: this.currentRootContext,
          });
        }
        dimPosition++;
      }
    }

    // Queue array initializer if present (new int[] { 1, 2, 3 })
    const initNode = node.childForFieldName('value');
    if (initNode && initNode.type === 'array_initializer') {
      let elemPosition = 0;
      for (const elem of ExpressionReferenceExtractor.namedOperands(initNode)) {
        this.pendingChildren.push({
          node: elem,
          parentHash,
          edgeRole: EdgeRole.ARRAY_ELEMENT,
          position: elemPosition,
          depth: depth + 1,
          typeRegistryHash: this.currentTypeRegistryHash,
          ownerHash: this.currentOwnerHash,
          ownerKind: this.currentOwnerKind,
          rootContext: this.currentRootContext,
        });
        elemPosition++;
      }
    }

    // Extract type reference for the element type
    const typeNode = node.childForFieldName('type');
    if (typeNode) {
      const typeRefs = this.typeReferenceExtractor.extractFromArrayCreation(
        typeNode,
        this.currentTypeRegistryHash,
        parentHash,
        this.currentPackageName
      );
      this.extractedTypeReferences.push(...typeRefs);
    }

    // Extract type-use annotations (new @TA int[3])
    const annotations = this.annotationExtractor.extractFromCreationExpression(
      node,
      parentHash,
      this.currentTypeRegistryHash
    );
    this.extractedAnnotations.push(...annotations);
  }

  /**
   * Queue children of a standalone array initializer ({ 1, 2, 3 }).
   * 
   * Children:
   * - ARRAY_ELEMENT: each element in the initializer
   */
  private queueArrayInitializerChildren(
    node: Parser.SyntaxNode,
    parentHash: string,
    depth: number
  ): void {
    let position = 0;
    for (const elem of ExpressionReferenceExtractor.namedOperands(node)) {
      this.pendingChildren.push({
        node: elem,
        parentHash,
        edgeRole: EdgeRole.ARRAY_ELEMENT,
        position,
        depth: depth + 1,
        typeRegistryHash: this.currentTypeRegistryHash,
        ownerHash: this.currentOwnerHash,
        ownerKind: this.currentOwnerKind,
        rootContext: this.currentRootContext,
      });
      position++;
    }
  }

  /**
   * Parses a ternary expression to extract condition, trueExpr, and falseExpr.
   *
   * Read through the grammar's `condition` / `consequence` / `alternative` fields, never by
   * position. `line_comment` and `block_comment` are NAMED nodes in tree-sitter-java, so any
   * comment inside the ternary shifts `namedChildren` — an end-of-line `//` before the `?`
   * used to hand back the condition, the true branch and the comment as the three operands,
   * which emitted the true branch under TERNARY_FALSE and dropped the false branch entirely.
   * A field read is immune to the shift because the grammar assigns the field, not the index.
   */
  /**
   * The named children of a node with comments removed.
   *
   * tree-sitter models a comment as a NAMED child, so any read that indexes into namedChildren
   * shifts when a comment appears. That is not a corner case: `return /* c *\/ f();`,
   * `if (/* c *\/ cond)`, `throw /* c *\/ new E()` and `o /* c *\/ instanceof T t` each moved the
   * operand out of the slot being read, and the expression was then dropped entirely - a call
   * site with no row, which nothing downstream can distinguish from code that makes no call.
   *
   * A comment is never an operand in any position this extractor reads, so filtering here is
   * always correct and is applied wherever named children are indexed.
   */
  private static namedOperands(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    return node.namedChildren.filter(
      c => c.type !== 'line_comment' && c.type !== 'block_comment' && c.type !== 'comment'
    );
  }

  private parseTernaryExpression(node: Parser.SyntaxNode): {
    condition: Parser.SyntaxNode;
    trueExpr: Parser.SyntaxNode;
    falseExpr: Parser.SyntaxNode;
  } {
    // The grammar labels the three operands `condition`, `consequence` and `alternative`.
    //
    // Reading namedChildren[0..2] positionally instead assumed the operands are the only named
    // children, and a comment is one. tree-sitter attaches a comment to the field it follows, so
    // `c // \n ? a() : b()` yields named children [c, comment, a(), b()]: the true branch was read
    // as the comment, `a()` was emitted under TERNARY_FALSE, and `b()` was never read at all.
    //
    // A field can hold several children for that reason, so the operand is the first child of the
    // field that is not a comment rather than simply the first.
    const operandOfField = (fieldName: string): Parser.SyntaxNode | null => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child || !child.isNamed) continue;
        if (node.fieldNameForChild(i) !== fieldName) continue;
        if (child.type === 'line_comment' || child.type === 'block_comment' || child.type === 'comment') continue;
        return child;
      }
      return null;
    };

    const condition = operandOfField('condition');
    const trueExpr = operandOfField('consequence');
    const falseExpr = operandOfField('alternative');

    if (condition && trueExpr && falseExpr) {
      return { condition, trueExpr, falseExpr };
    }

    // Fallback for a malformed ternary, where a field may be absent entirely.
    const named = ExpressionReferenceExtractor.namedOperands(node).filter(
      c => c.type !== 'line_comment' && c.type !== 'block_comment' && c.type !== 'comment'
    );
    return {
      condition: condition ?? named[0] ?? node,
      trueExpr: trueExpr ?? named[1] ?? node,
      falseExpr: falseExpr ?? named[2] ?? node,
    };
  }

  /**
   * Determines the ExpressionKind from a tree-sitter node
   * Currently only handles LITERAL types
   */
  private determineExpressionKind(node: Parser.SyntaxNode): ExpressionKind {
    switch (node.type) {
      // Integer literals
      case 'decimal_integer_literal':
      case 'hex_integer_literal':
      case 'octal_integer_literal':
      case 'binary_integer_literal':
        return ExpressionKind.LITERAL;

      // Floating point literals
      case 'decimal_floating_point_literal':
      case 'hex_floating_point_literal':
        return ExpressionKind.LITERAL;

      // String literals
      case 'string_literal':
        return ExpressionKind.LITERAL;

      // Character literal
      case 'character_literal':
        return ExpressionKind.LITERAL;

      // Boolean literals
      case 'true':
      case 'false':
        return ExpressionKind.LITERAL;

      // Null literal
      case 'null_literal':
        return ExpressionKind.LITERAL;

      // Class literal (String.class, int.class)
      case 'class_literal':
        return ExpressionKind.CLASS_LITERAL;

      // Unary expressions
      case 'unary_expression':
      case 'update_expression': // ++x, x++, --x, x--
        return ExpressionKind.UNARY_EXPRESSION;

      // Binary expressions
      case 'binary_expression':
        return ExpressionKind.BINARY_EXPRESSION;

      // Ternary expressions
      case 'ternary_expression':
        return ExpressionKind.TERNARY_EXPRESSION;

      // Parenthesized expressions
      case 'parenthesized_expression':
        return ExpressionKind.PARENTHESIZED;

      // This reference
      case 'this':
        return ExpressionKind.THIS_REFERENCE;

      // Super reference
      case 'super':
        return ExpressionKind.SUPER_REFERENCE;

      // Simple identifier (variable/field/constant name without dots)
      case 'identifier':
        return ExpressionKind.IDENTIFIER_REFERENCE;

      // Field access - all field_access nodes are treated as FIELD_ACCESS
      // The object part (qualifier) will be recursively extracted as a child expression
      case 'field_access':
        return ExpressionKind.FIELD_ACCESS;

      // Method invocation
      case 'method_invocation':
        return ExpressionKind.METHOD_INVOCATION;

      // Instanceof expression - check for pattern variable (Java 16+)
      case 'instanceof_expression':
        return this.determineInstanceofExpressionKind(node);

      // Object creation expression
      case 'object_creation_expression':
        // Distinguish between regular object creation and anonymous class
        // Anonymous classes have a class_body child
        // NOTE: Anonymous class creation requires anonymousTypeHash which needs
        // separate type registry entry - skip for now and return UNKNOWN
        if (node.children.some(c => c.type === 'class_body')) {
          return ExpressionKind.ANONYMOUS_CLASS_CREATION;
        }
        return ExpressionKind.OBJECT_CREATION;

      // Array creation expression (new int[3], new String[] { ... })
      case 'array_creation_expression':
        return ExpressionKind.ARRAY_CREATION;

      // Array initializer without explicit new ({ 1, 2, 3 })
      case 'array_initializer':
        return ExpressionKind.ARRAY_INITIALIZER;

      // Explicit constructor invocation (this() or super() in constructor body)
      case 'explicit_constructor_invocation':
        return ExpressionKind.CONSTRUCTOR_INVOCATION;

      // Method reference (Type::method, obj::method, Type::new)
      case 'method_reference':
        return ExpressionKind.METHOD_REFERENCE;

      // Assignment expression (x = y, x += y, etc.)
      case 'assignment_expression':
        return this.determineAssignmentExpressionKind(node);

      // Cast expression ((Type) expr)
      case 'cast_expression':
        return ExpressionKind.CAST_EXPRESSION;

      // Array access (arr[index])
      case 'array_access':
        return ExpressionKind.ARRAY_ACCESS;

      // Switch expression (Java 14+)
      case 'switch_expression':
        return ExpressionKind.SWITCH_EXPRESSION;

      // String template (Java 21+ preview)
      case 'template_expression':
        return ExpressionKind.STRING_TEMPLATE;

      // Record pattern (Java 21+) - used in instanceof and switch
      case 'record_pattern':
        return ExpressionKind.RECORD_PATTERN;

      // Lambda expression (x -> x * 2, (a, b) -> a + b)
      case 'lambda_expression':
        return ExpressionKind.LAMBDA_EXPRESSION;

      default:
        return ExpressionKind.UNKNOWN;
    }
  }

  /**
   * Determines if an assignment expression is simple (=) or compound (+=, -=, etc.)
   */
  private determineAssignmentExpressionKind(node: Parser.SyntaxNode): ExpressionKind {
    const operator = this.extractAssignmentOperator(node);
    if (operator === '=') {
      return ExpressionKind.ASSIGNMENT_EXPRESSION;
    }
    return ExpressionKind.COMPOUND_ASSIGNMENT;
  }

  /**
   * Determines if an instanceof expression is basic, has a pattern variable, or uses a record pattern.
   * 
   * Basic: obj instanceof String              -> INSTANCEOF_EXPRESSION
   * Pattern: obj instanceof String s          -> INSTANCEOF_PATTERN
   * Record: obj instanceof Person(String n)   -> INSTANCEOF_EXPRESSION (record_pattern is a child)
   * 
   * Note: When a record_pattern is present, it appears in the [pattern] field.
   * The record_pattern itself is extracted as a separate RECORD_PATTERN expression.
   */
  private determineInstanceofExpressionKind(node: Parser.SyntaxNode): ExpressionKind {
    // instanceof_expression structure varies:
    // - Basic: [left] instanceof [type]
    // - Pattern (Java 16+): [left] instanceof [type] [identifier]  
    // - Record pattern (Java 21+): [left] instanceof [pattern: record_pattern]
    const namedChildren = ExpressionReferenceExtractor.namedOperands(node);
    
    // Check for record_pattern in the pattern field
    const patternNode = node.childForFieldName('pattern');
    if (patternNode && patternNode.type === 'record_pattern') {
      // Record pattern is handled separately - instanceof stays INSTANCEOF_EXPRESSION
      return ExpressionKind.INSTANCEOF_EXPRESSION;
    }
    
    // If there are 3 or more named children, the 3rd is the pattern variable
    if (namedChildren.length >= 3) {
      const thirdChild = namedChildren[2];
      // The pattern variable is an identifier
      if (thirdChild && thirdChild.type === 'identifier') {
        return ExpressionKind.INSTANCEOF_PATTERN;
      }
    }
    
    return ExpressionKind.INSTANCEOF_EXPRESSION;
  }

  /**
   * Extracts the operator from an assignment expression
   */
  private extractAssignmentOperator(node: Parser.SyntaxNode): string {
    // Assignment expression structure: left operator right
    // Operators: =, +=, -=, *=, /=, %=, &=, |=, ^=, <<=, >>=, >>>=
    for (const child of node.children) {
      if (!child.isNamed) {
        const text = child.text.trim();
        if (text.endsWith('=') && text.length >= 1) {
          return text;
        }
      }
    }
    return '=';
  }

  /**
   * Adds kind-specific data to the builder
   * Currently only handles LITERAL
   */
  private addKindSpecificData(
    builder: ReturnType<typeof ExpressionReference.builder>,
    node: Parser.SyntaxNode,
    kind: ExpressionKind,
    edgeRole: EdgeRole
  ): void {
    if (kind === ExpressionKind.LITERAL) {
      this.addLiteralData(builder, node);
    } else if (kind === ExpressionKind.CLASS_LITERAL) {
      this.addClassLiteralData(builder, node);
    } else if (kind === ExpressionKind.UNARY_EXPRESSION) {
      this.addUnaryData(builder, node);
    } else if (kind === ExpressionKind.BINARY_EXPRESSION) {
      this.addBinaryData(builder, node);
    } else if (kind === ExpressionKind.IDENTIFIER_REFERENCE) {
      this.addIdentifierReferenceData(builder, node, edgeRole);
    } else if (kind === ExpressionKind.FIELD_ACCESS) {
      this.addFieldAccessData(builder, node);
    } else if (kind === ExpressionKind.METHOD_INVOCATION) {
      this.addMethodInvocationData(builder, node);
    } else if (kind === ExpressionKind.OBJECT_CREATION || kind === ExpressionKind.ANONYMOUS_CLASS_CREATION) {
      this.addObjectCreationData(builder, node);
    } else if (kind === ExpressionKind.CONSTRUCTOR_INVOCATION) {
      this.addConstructorInvocationData(builder, node);
    } else if (kind === ExpressionKind.METHOD_REFERENCE) {
      this.addMethodReferenceData(builder, node);
    } else if (kind === ExpressionKind.ASSIGNMENT_EXPRESSION || kind === ExpressionKind.COMPOUND_ASSIGNMENT) {
      this.addAssignmentData(builder, node);
    } else if (kind === ExpressionKind.STRING_TEMPLATE) {
      this.addStringTemplateData(builder, node);
    } else if (kind === ExpressionKind.RECORD_PATTERN) {
      this.addRecordPatternData(builder, node);
    } else if (kind === ExpressionKind.LAMBDA_EXPRESSION) {
      this.addLambdaData(builder, node);
    }
    // THIS_REFERENCE, SUPER_REFERENCE, TERNARY_EXPRESSION, INSTANCEOF_EXPRESSION and PARENTHESIZED have no additional data fields - just structure
  }

  /**
   * Adds literal-specific data (literalType and literalValue)
   */
  private addLiteralData(
    builder: ReturnType<typeof ExpressionReference.builder>,
    node: Parser.SyntaxNode
  ): void {
    const literalType = this.determineLiteralType(node);
    const literalValue = this.extractLiteralValue(node, literalType);
    builder.literal(literalType, literalValue);
  }

  /**
   * Extracts the actual value from a literal node, stripping quotes for strings/chars
   */
  private extractLiteralValue(node: Parser.SyntaxNode, literalType: LiteralType): string {
    const text = node.text;

    switch (literalType) {
      case LiteralType.STRING:
        // Strip surrounding double quotes: "value" -> value
        if (text.startsWith('"') && text.endsWith('"')) {
          return text.slice(1, -1);
        }
        return text;

      case LiteralType.TEXT_BLOCK:
        // Strip surrounding triple quotes: """value""" -> value
        if (text.startsWith('"""') && text.endsWith('"""')) {
          return text.slice(3, -3);
        }
        return text;

      case LiteralType.CHARACTER:
        // Strip surrounding single quotes: 'a' -> a
        if (text.startsWith("'") && text.endsWith("'")) {
          return text.slice(1, -1);
        }
        return text;

      default:
        // For numbers, booleans, null - return as-is
        return text;
    }
  }

  /**
   * Determines the LiteralType from a tree-sitter node
   */
  private determineLiteralType(node: Parser.SyntaxNode): LiteralType {
    const text = node.text;

    switch (node.type) {
      case 'decimal_integer_literal':
      case 'hex_integer_literal':
      case 'octal_integer_literal':
      case 'binary_integer_literal':
        // Check for L/l suffix for LONG
        if (text.endsWith('L') || text.endsWith('l')) {
          return LiteralType.LONG;
        }
        return LiteralType.INTEGER;

      case 'decimal_floating_point_literal':
      case 'hex_floating_point_literal':
        // Check for f/F suffix for FLOAT, otherwise DOUBLE
        if (text.endsWith('f') || text.endsWith('F')) {
          return LiteralType.FLOAT;
        }
        return LiteralType.DOUBLE;

      case 'string_literal':
        // Check for text block (triple quotes)
        if (text.startsWith('"""')) {
          return LiteralType.TEXT_BLOCK;
        }
        return LiteralType.STRING;

      case 'character_literal':
        return LiteralType.CHARACTER;

      case 'true':
      case 'false':
        return LiteralType.BOOLEAN;

      case 'null_literal':
        return LiteralType.NULL;

      default:
        return LiteralType.STRING; // Fallback
    }
  }

  /**
   * Adds class literal specific data (the type name)
   * For String.class -> stores "String"
   * For int.class -> stores "int"
   */
  private addClassLiteralData(
    builder: ReturnType<typeof ExpressionReference.builder>,
    node: Parser.SyntaxNode
  ): void {
    // class_literal structure: type + "." + "class"
    // Extract the type part (everything before .class)
    const typeName = this.extractClassLiteralTypeName(node);
    // Store in literalValue field using dedicated method
    builder.classLiteralTypeName(typeName);
    
    // Extract base type (remove array brackets) for qualified name resolution
    // e.g., "String[]" -> "String", "int[][]" -> "int"
    const baseType = this.extractBaseType(typeName);
    
    // Resolve potential qualified name for the base type
    const { potentialQualifiedName, isAmbiguous } = resolveTypeQualifiedName(
      baseType,
      this.currentPackageName,
      this.currentImportMap,
      this.currentHasStarImports
    );
    
    if (potentialQualifiedName) {
      builder.qualifiedName(potentialQualifiedName, isAmbiguous);
    }
  }
  
  /**
   * Extracts the base type from a type name by removing array brackets
   */
  private extractBaseType(typeName: string): string {
    // Remove all array dimension brackets
    return typeName.replace(/\[\]/g, '').trim();
  }

  /**
   * Extracts the type name from a class literal node
   */
  private extractClassLiteralTypeName(node: Parser.SyntaxNode): string {
    // The class_literal node contains the type as first child
    // e.g., "String.class" -> type_identifier "String"
    // e.g., "int.class" -> integral_type "int"
    for (const child of node.children) {
      // Skip the "." and "class" tokens
      if (child.type !== '.' && child.type !== 'class') {
        return child.text;
      }
    }
    // Fallback: extract from full text by removing ".class"
    const text = node.text;
    if (text.endsWith('.class')) {
      return text.slice(0, -6);
    }
    return text;
  }

  /**
   * Adds unary expression data (operator, fixity)
   */
  private addUnaryData(
    builder: ReturnType<typeof ExpressionReference.builder>,
    node: Parser.SyntaxNode
  ): void {
    const { operator, fixity } = this.parseUnaryExpression(node);
    builder.operator(operator);
    builder.unary(fixity);
  }

  /**
   * Parses a unary expression to extract operator, fixity, and operand
   */
  private parseUnaryExpression(node: Parser.SyntaxNode): {
    operator: string;
    fixity: UnaryFixity;
    operand: Parser.SyntaxNode;
  } {
    // unary_expression can be:
    // - prefix: operator + operand (e.g., -x, !x, ++x, --x)
    // - postfix: operand + operator (e.g., x++, x--)
    // In tree-sitter Java, update_expression handles ++/--
    
    const children = node.children.filter(c => !c.type.match(/^\s*$/));
    
    if (children.length >= 2) {
      const first = children[0]!;
      const last = children[children.length - 1]!;
      
      // Check if first child is operator (prefix)
      if (this.isUnaryOperator(first.type) || this.isUnaryOperator(first.text)) {
        return {
          operator: first.text,
          fixity: UnaryFixity.PREFIX,
          operand: last,
        };
      }
      
      // Check if last child is operator (postfix)
      if (this.isUnaryOperator(last.type) || this.isUnaryOperator(last.text)) {
        return {
          operator: last.text,
          fixity: UnaryFixity.POSTFIX,
          operand: first,
        };
      }
    }

    // Fallback: use named children
    const operand = ExpressionReferenceExtractor.namedOperands(node)[0];
    const operatorText = node.children.find(c => this.isUnaryOperator(c.text))?.text || '?';
    
    return {
      operator: operatorText,
      fixity: UnaryFixity.PREFIX,
      operand: operand ?? node,
    };
  }

  private isUnaryOperator(text: string): boolean {
    return ['-', '+', '!', '~', '++', '--'].includes(text);
  }

  /**
   * Adds identifier reference data (simple name without dots)
   * For IDENTIFIER_REFERENCE like "a", "DEFAULT_TIMEOUT", "count"
   * 
   * We store the identifier name and mark it as potentially referencing a field or type.
   * Without full semantic analysis, we can't always determine if it's a local variable,
   * parameter, or field - but in field initializer context, it's likely a field.
   * 
   * NOTE: We intentionally do NOT set potentialQualifiedName here because:
   * - We can't resolve a simple name to a qualified name without knowing all fields in scope
   * - The identifier could be from the same class, inherited, or even a local variable
   * - Linking to field hashes would require a second pass after field extraction
   */
  private addIdentifierReferenceData(
    builder: ReturnType<typeof ExpressionReference.builder>,
    node: Parser.SyntaxNode,
    edgeRole: EdgeRole
  ): void {
    // Store the identifier name in literalValue field
    const identifierName = node.text;
    builder.classLiteralTypeName(identifierName);
    
    // Pattern binding variables (Java 16+) get special classification
    // - RECORD_PATTERN_BINDING: variables in record patterns like Point(int x, int y)
    // - PATTERN_VARIABLE: variables in instanceof patterns like obj instanceof String s
    // - SWITCH_TYPE_PATTERN: variables in switch type patterns like case String s
    if (edgeRole === EdgeRole.RECORD_PATTERN_BINDING || 
        edgeRole === EdgeRole.PATTERN_VARIABLE ||
        edgeRole === EdgeRole.SWITCH_TYPE_PATTERN) {
      builder.referencesEntity(ReferencedEntityKind.PATTERN_BINDING);
      return;
    }

    // Lambda parameter declarations (x -> ..., (a, b) -> ...)
    if (edgeRole === EdgeRole.LAMBDA_PARAMETER) {
      builder.referencesEntity(ReferencedEntityKind.LAMBDA_PARAMETER);
      return;
    }
    
    // A constant in a case label. Without types the parser cannot tell an enum constant from another
    // compile-time constant, and both are fields of some type, so one kind is used for every arm rather
    // than TYPE for the PascalCase ones and FIELD for the ALL_CAPS one.
    const inCaseLabel = (() => {
      let p = node.parent;
      for (let i = 0; p && i < 4; i += 1, p = p.parent) if (p.type === 'switch_label') return true;
      return false;
    })();
    if ((edgeRole === EdgeRole.SWITCH_CASE_LABEL || inCaseLabel) && !this.currentLocalVariableNames.has(identifierName)
        && !this.currentMethodParamNames.has(identifierName) && !this.currentLambdaParamNames.has(identifierName)) {
      builder.referencesEntity(ReferencedEntityKind.FIELD);
      return;
    }

    // Lambda parameter usage (identifier in lambda body matching a lambda param)
    if (this.currentLambdaParamNames.has(identifierName)) {
      builder.referencesEntity(ReferencedEntityKind.LAMBDA_PARAMETER);
      return;
    }
    
    // Method parameter references (identifiers matching method param names)
    if (this.currentMethodParamNames.has(identifierName)) {
      builder.referencesEntity(ReferencedEntityKind.PARAMETER);
      return;
    }
    
    // Local variable references (identifiers matching local variable names in scope)
    if (this.currentLocalVariableNames.has(identifierName)) {
      const declStart = this.currentLocalVariableDeclStart.get(identifierName);
      if (declStart === undefined || node.startIndex >= declStart) {
        builder.referencesEntity(ReferencedEntityKind.LOCAL_VARIABLE);
        return;
      }
      // falls through: this use precedes every local of that name, so it is the field
    }
    
    // Pattern binding variable usage (identifier matching a pattern variable from instanceof/switch)
    if (this.currentPatternBindingNames.has(identifierName)
        || this.isInsidePatternBindingScope(identifierName, node)) {
      builder.referencesEntity(ReferencedEntityKind.PATTERN_BINDING_VARIABLE);
      return;
    }
    
    // Use shared naming convention logic for other identifiers
    this.classifyByNamingConvention(builder, identifierName);
  }

  /**
   * Records the pattern bindings declared anywhere in the method body about to be extracted.
   *
   * Set once per method, before its statements are walked, because a binding's declaration and
   * its uses are in different statements and therefore different extraction calls.
   */
  setMethodPatternBindings(bindings: Array<{ name: string; startIndex: number; endIndex: number }>): void {
    this.methodPatternBindings = bindings;
  }

  /**
   * Set once per method body: the source offset where each local name is first declared, so a use that
   * precedes the declaration is not classified as that local.
   */
  setLocalVariableDeclStarts(starts: Map<string, number>): void {
    this.currentLocalVariableDeclStart = starts;
  }

  /**
   * True when this identifier falls inside the statement that declares a binding of the same name.
   *
   * The range test is what keeps a field of the same name correct outside that statement. It is
   * narrower than Java's own rule, which extends a binding to wherever the pattern definitely
   * matched - `if (!(o instanceof T a)) return; a.foo();` puts the binding in scope after the if.
   * Such a use falls back to the naming convention, which is the behaviour before any of this,
   * so the approximation only declines to improve a case rather than making one worse.
   */
  private isInsidePatternBindingScope(identifierName: string, node: Parser.SyntaxNode): boolean {
    return this.methodPatternBindings.some(
      binding => binding.name === identifierName
        && node.startIndex >= binding.startIndex
        && node.endIndex <= binding.endIndex
    );
  }

  /**
   * Adds object creation data (type name and references entity kind)
   * For new ClassName(), new ArrayList<String>(), new Runnable() { ... }
   */
  private addObjectCreationData(
    builder: ReturnType<typeof ExpressionReference.builder>,
    node: Parser.SyntaxNode
  ): void {
    // Mark as referencing a constructor
    builder.referencesEntity(ReferencedEntityKind.CONSTRUCTOR);
    
    // Extract the type name
    const typeNode = node.childForFieldName('type');
    if (typeNode) {
      // Get simple type name (for generic_type, get the base type)
      let typeName = typeNode.text;
      if (typeNode.type === 'generic_type') {
        const baseType = typeNode.children.find(c => c.type === 'type_identifier');
        if (baseType) {
          typeName = baseType.text;
        }
      } else if (typeNode.type === 'scoped_type_identifier') {
        // For qualified names like java.util.Date, get the full name
        typeName = typeNode.text;
      }
      
      // Store type name (using classLiteralTypeName field for consistency)
      builder.classLiteralTypeName(typeName);
    }
  }

  /**
   * Adds constructor invocation data for this() and super() calls.
   * 
   * Sets referencedEntityKind to THIS for this() or SUPER for super().
   */
  private addConstructorInvocationData(
    builder: ReturnType<typeof ExpressionReference.builder>,
    node: Parser.SyntaxNode
  ): void {
    // The 'constructor' field contains either 'this' or 'super' node
    const constructorNode = node.childForFieldName('constructor');
    if (constructorNode) {
      if (constructorNode.type === 'this') {
        builder.referencesEntity(ReferencedEntityKind.THIS);
      } else if (constructorNode.type === 'super') {
        builder.referencesEntity(ReferencedEntityKind.SUPER);
      }
    }
  }

  /**
   * Adds method reference data (methodReferenceKind and referenced entity).
   * 
   * Method Reference Structure:
   *   [qualifier] :: [type_arguments?] [method_name | new]
   * 
   * Examples:
   * - String::length     -> UNBOUND (or STATIC, requires semantic analysis)
   * - prefix::concat     -> BOUND
   * - this::method       -> BOUND
   * - super::method      -> SUPER
   * - ArrayList::new     -> CONSTRUCTOR
   * - int[]::new         -> ARRAY_CONSTRUCTOR
   * 
   * Note: Distinguishing STATIC vs UNBOUND requires knowing if the method is static,
   * which we don't have at parse time. We use heuristics based on qualifier type.
   */
  private addMethodReferenceData(
    builder: ReturnType<typeof ExpressionReference.builder>,
    node: Parser.SyntaxNode
  ): void {
    const kind = this.determineMethodReferenceKind(node);
    builder.methodReference(kind);

    // Store the method name (or 'new' for constructor refs)
    // Note: Must cache node.children — tree-sitter creates new wrapper objects on each
    // .children access, so indexOf() with a reference from a different access always returns -1.
    const children = node.children;
    const colonIdx = children.findIndex(c => c.type === '::');
    const methodNameNode = colonIdx >= 0
      ? children.slice(colonIdx + 1).find(c => c.type === 'identifier')
      : undefined;
    const isConstructorRef = children.some(c => c.type === 'new');
    
    if (isConstructorRef) {
      builder.classLiteralTypeName('new');
      builder.referencesEntity(ReferencedEntityKind.CONSTRUCTOR);
    } else if (methodNameNode) {
      builder.classLiteralTypeName(methodNameNode.text);
      builder.referencesEntity(ReferencedEntityKind.METHOD);
    }
  }

  /**
   * Determines the MethodReferenceKind based on the qualifier type.
   * 
   * Heuristics (without full semantic analysis):
   * - super::method, Child.super::method -> SUPER
   * - Type[]::new -> ARRAY_CONSTRUCTOR
   * - Type::new -> CONSTRUCTOR
   * - All other qualifier::method patterns -> QUALIFIED_METHOD
   */
  private determineMethodReferenceKind(node: Parser.SyntaxNode): MethodReferenceKind {
    const qualifier = node.children[0];
    if (!qualifier) {
      return MethodReferenceKind.QUALIFIED_METHOD; // fallback
    }

    const isConstructorRef = node.children.some(c => c.type === 'new');

    // Check for array constructor reference first: int[]::new, String[]::new
    if (qualifier.type === 'array_type' && isConstructorRef) {
      return MethodReferenceKind.ARRAY_CONSTRUCTOR;
    }

    // Check for constructor reference: ArrayList::new, StringBuilder::new
    if (isConstructorRef) {
      return MethodReferenceKind.CONSTRUCTOR;
    }

    // super::method -> SUPER
    if (qualifier.type === 'super') {
      return MethodReferenceKind.SUPER;
    }

    // scoped_type_identifier ending with 'super': Child.super::method -> SUPER
    if (qualifier.type === 'scoped_type_identifier') {
      const lastChild = qualifier.children[qualifier.children.length - 1];
      if (lastChild && lastChild.type === 'type_identifier' && lastChild.text === 'super') {
        return MethodReferenceKind.SUPER;
      }
    }

    // All other method references are QUALIFIED_METHOD
    // We cannot reliably distinguish between:
    // - STATIC (Math::abs) vs UNBOUND (String::length) - requires knowing if method is static
    // - BOUND (prefix::length) vs UNBOUND (String::length) - requires knowing if qualifier is variable or type
    return MethodReferenceKind.QUALIFIED_METHOD;
  }

  /**
   * Adds field access data (field name and references entity kind)
   * For super.field, this.field, obj.field patterns
   * 
   * Special case: For qualified this expressions (e.g., OuterClass.this),
   * the "field" is actually "this" keyword, so we use ReferencedEntityKind.THIS
   */
  private addFieldAccessData(
    builder: ReturnType<typeof ExpressionReference.builder>,
    node: Parser.SyntaxNode
  ): void {
    // Extract the field name (right side of the dot)
    const field = node.childForFieldName('field');
    if (field) {
      const fieldName = field.text;
      // Store the field name in literalValue
      builder.classLiteralTypeName(fieldName);
      
      // Check if this is a qualified this expression (e.g., OuterClass.this)
      // In this case, the "field" is the 'this' keyword, not an actual field
      if (fieldName === 'this') {
        builder.referencesEntity(ReferencedEntityKind.THIS);
        return;
      }

      // Use shared naming convention logic
      this.classifyByNamingConvention(builder, fieldName);
      return;
    }
    
    // Fallback: Mark as referencing a field
    builder.referencesEntity(ReferencedEntityKind.FIELD);
  }

  /**
   * Classifies an identifier as TYPE or FIELD based on Java naming conventions,
   * and attempts type resolution for PascalCase names.
   * 
   * Used by both addIdentifierReferenceData and addFieldAccessData.
   * 
   * - ALL_CAPS with underscores = FIELD (STATIC_FINAL, MAX_VALUE, DEFAULT_TIMEOUT)
   * - PascalCase (Uppercase first letter, mixed case) = TYPE (String, Math, Entry in Map.Entry)
   * - camelCase (lowercase first letter) = FIELD (count, name, myField)
   */
  private classifyByNamingConvention(
    builder: ReturnType<typeof ExpressionReference.builder>,
    name: string
  ): void {
    const firstChar = name.charAt(0);
    const startsWithUppercase = firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase();
    
    // Check if identifier is ALL_CAPS (constant naming convention)
    // Pattern: all uppercase letters, digits, and underscores (e.g., STATIC_FINAL, MAX_VALUE, PI)
    const isAllCaps = /^[A-Z][A-Z0-9_]*$/.test(name);
    
    if (isAllCaps) {
      // ALL_CAPS = likely a constant field (STATIC_FINAL, MAX_VALUE, etc.)
      builder.referencesEntity(ReferencedEntityKind.FIELD);
    } else if (startsWithUppercase) {
      // PascalCase = likely a type reference
      builder.referencesEntity(ReferencedEntityKind.TYPE);
      
      // Attempt type resolution (e.g., String -> java.lang.String, Entry -> Map.Entry)
      const { potentialQualifiedName, isAmbiguous } = resolveTypeQualifiedName(
        name,
        this.currentPackageName,
        this.currentImportMap,
        this.currentHasStarImports
      );
      
      if (potentialQualifiedName) {
        builder.qualifiedName(potentialQualifiedName, isAmbiguous);
      }
    } else {
      // Lowercase = likely a field or variable reference
      builder.referencesEntity(ReferencedEntityKind.FIELD);
    }
  }

  /**
   * Adds method invocation data (method name, type arguments if present)
   * For obj.method(), method(), Class.method() patterns
   */
  private addMethodInvocationData(
    builder: ReturnType<typeof ExpressionReference.builder>,
    node: Parser.SyntaxNode
  ): void {
    // Extract the method name
    const name = node.childForFieldName('name');
    if (name) {
      // Store the method name (reusing classLiteralTypeName field for now)
      builder.classLiteralTypeName(name.text);
    }

    // Note: Type arguments (e.g., <String> in obj.<String>method()) are intentionally NOT stored.
    // They are compile-time generic hints, not dependencies we need to track.
    // The actual dependency is captured via the receiver (e.g., Collections -> java.util.Collections).

    // Mark as referencing a method
    builder.referencesEntity(ReferencedEntityKind.METHOD);
  }

  /**
   * Adds binary expression data (operator)
   */
  private addBinaryData(
    builder: ReturnType<typeof ExpressionReference.builder>,
    node: Parser.SyntaxNode
  ): void {
    const { operator } = this.parseBinaryExpression(node);
    builder.operator(operator);
  }

  /**
   * Adds assignment expression data (operator: =, +=, -=, etc.)
   */
  private addAssignmentData(
    builder: ReturnType<typeof ExpressionReference.builder>,
    node: Parser.SyntaxNode
  ): void {
    const operator = this.extractAssignmentOperator(node);
    builder.operator(operator);
  }

  /**
   * Adds string template data (processor name: STR, FMT, RAW, or custom).
   * Uses operatorString field to store the processor name.
   * 
   * AST structure:
   *   template_expression
   *   ├── identifier: "STR" (processor)
   *   ├── .: "."
   *   └── string_literal (template content)
   */
  private addStringTemplateData(
    builder: ReturnType<typeof ExpressionReference.builder>,
    node: Parser.SyntaxNode
  ): void {
    // First child should be the processor identifier (STR, FMT, RAW, etc.)
    const processorNode = ExpressionReferenceExtractor.namedOperands(node).find(c => c.type === 'identifier');
    const processor = processorNode?.text || 'STR';
    builder.operator(processor);
  }

  /**
   * Adds record pattern data (record type name).
   * Uses classLiteralTypeName field to store the record type being matched.
   * 
   * AST structure:
   *   record_pattern
   *   ├── identifier: "Person" (record type name)
   *   └── record_pattern_body: (String n, int a)
   */
  private addRecordPatternData(
    builder: ReturnType<typeof ExpressionReference.builder>,
    node: Parser.SyntaxNode
  ): void {
    // First identifier or generic_type child is the record type name
    // For simple: Point(int x, int y) -> identifier "Point"
    // For generic: Pair<Object, Object>(Object f, Object s) -> generic_type with identifier "Pair"
    const recordTypeNode = ExpressionReferenceExtractor.namedOperands(node).find(c => 
      c.type === 'identifier' || c.type === 'generic_type'
    );
    if (recordTypeNode) {
      if (recordTypeNode.type === 'generic_type') {
        // Extract the base type name from generic_type (e.g., "Pair" from "Pair<Object, Object>")
        const baseTypeNode = ExpressionReferenceExtractor.namedOperands(recordTypeNode).find(c => c.type === 'type_identifier');
        if (baseTypeNode) {
          builder.classLiteralTypeName(baseTypeNode.text);
        }
      } else {
        builder.classLiteralTypeName(recordTypeNode.text);
      }
    }
  }

  /**
   * Adds lambda expression data (parameter names).
   * Uses operator field to store comma-separated parameter names.
   * 
   * Lambda parameter forms:
   * - Single identifier: x -> x * 2
   * - Inferred parameters: (x, y) -> x + y
   * - Formal parameters: (int x, int y) -> x + y
   */
  private addLambdaData(
    builder: ReturnType<typeof ExpressionReference.builder>,
    node: Parser.SyntaxNode
  ): void {
    const paramNames: string[] = [];

    // Check if there are any formal_parameters or inferred_parameters
    // If so, an identifier child is the body, not a parameter
    const hasParamList = ExpressionReferenceExtractor.namedOperands(node).some(child => 
      child.type === 'formal_parameters' || child.type === 'inferred_parameters'
    );

    for (const child of ExpressionReferenceExtractor.namedOperands(node)) {
      if (child.type === 'identifier' && !hasParamList) {
        // Single parameter without parentheses: x -> x * 2
        // Only treat as parameter if there's no formal_parameters or inferred_parameters
        paramNames.push(child.text);
      } else if (child.type === 'inferred_parameters') {
        // Inferred parameters: (x, y) -> x + y
        for (const param of ExpressionReferenceExtractor.namedOperands(child)) {
          if (param.type === 'identifier') {
            paramNames.push(param.text);
          }
        }
      } else if (child.type === 'formal_parameters') {
        // Formal parameters: (int x, int y) -> x + y
        for (const param of ExpressionReferenceExtractor.namedOperands(child)) {
          if (param.type === 'formal_parameter' || param.type === 'spread_parameter') {
            const nameNode = ExpressionReferenceExtractor.namedOperands(param).find(n => n.type === 'identifier');
            if (nameNode) {
              paramNames.push(nameNode.text);
            }
          }
        }
      }
    }

    // Store parameter names in operator field (comma-separated)
    if (paramNames.length > 0) {
      builder.operator(paramNames.join(','));
    }
  }

  /**
   * Parses a binary expression to extract operator and operands
   */
  private parseBinaryExpression(node: Parser.SyntaxNode): {
    operator: string;
    left: Parser.SyntaxNode;
    right: Parser.SyntaxNode;
  } {
    // binary_expression structure: left operator right
    const namedChildren = ExpressionReferenceExtractor.namedOperands(node);
    
    if (namedChildren.length >= 2) {
      const left = namedChildren[0]!;
      const right = namedChildren[namedChildren.length - 1]!;
      
      // Find operator between left and right
      let operator = '?';
      for (const child of node.children) {
        if (child.startIndex >= left.endIndex && child.endIndex <= right.startIndex) {
          if (!child.isNamed && child.text.trim().length > 0) {
            operator = child.text;
            break;
          }
        }
      }
      
      return { operator, left, right };
    }

    // Fallback
    return {
      operator: '?',
      left: node,
      right: node,
    };
  }

  /**
   * Extracts type references from a field_access qualifier that represents type access.
   * 
   * For method references like Type1.Type2::staticMethod, the qualifier is parsed as
   * a field_access node (not scoped_type_identifier). We need to extract type references
   * for each type component to ensure they appear in the type-references output.
   * 
   * This method recursively processes the field_access chain:
   * - Type1.Type2 -> extracts Type2, then recursively processes Type1
   * - Type1.Type2.Type3 -> extracts Type3, Type2, Type1
   * 
   * Only extracts types (names starting with uppercase) to avoid false positives
   * on actual field access like obj.field::method.
   * 
   * @param fieldAccessNode The field_access node representing the qualifier
   * @param expressionHash The hash of the method reference expression
   */
  private extractTypeReferencesFromFieldAccessQualifier(
    fieldAccessNode: Parser.SyntaxNode,
    expressionHash: string
  ): void {
    // Get the field name (the part after the dot)
    const fieldNode = fieldAccessNode.childForFieldName('field');
    if (!fieldNode) {
      return;
    }

    const fieldName = fieldNode.text;
    const firstChar = fieldName[0];
    
    // Only process if the field name looks like a type (starts with uppercase)
    // This distinguishes Type1.Type2::method from obj.field::method
    if (fieldName.length === 0 || !firstChar || firstChar !== firstChar.toUpperCase()) {
      return;
    }

    // Extract type reference for this type component
    const typeRefs = this.typeReferenceExtractor.extractFromMethodReferenceQualifier(
      fieldNode,
      this.currentTypeRegistryHash,
      expressionHash,
      this.currentPackageName
    );
    this.extractedTypeReferences.push(...typeRefs);

    // Recursively process the object part (the part before the dot)
    const objectNode = fieldAccessNode.childForFieldName('object');
    if (objectNode) {
      if (objectNode.type === 'field_access') {
        // Nested field access: Type1.Type2.Type3 -> process Type1.Type2
        this.extractTypeReferencesFromFieldAccessQualifier(objectNode, expressionHash);
      } else if (objectNode.type === 'identifier') {
        // Base case: simple identifier like Type1
        const objectName = objectNode.text;
        const objectFirstChar = objectName[0];
        // Only process if it looks like a type
        if (objectName.length > 0 && objectFirstChar && objectFirstChar === objectFirstChar.toUpperCase()) {
          const baseTypeRefs = this.typeReferenceExtractor.extractFromMethodReferenceQualifier(
            objectNode,
            this.currentTypeRegistryHash,
            expressionHash,
            this.currentPackageName
          );
          this.extractedTypeReferences.push(...baseTypeRefs);
        }
      }
    }
  }
}
