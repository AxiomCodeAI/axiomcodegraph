import Parser from 'tree-sitter';
import { BlockKind } from '@/enums/java/blocks';
import { LocalVariableScopeKind } from '@/enums/java/local-variables';
import { ScopeType } from '@/enums/java/scopes';

// Re-export ScopeType for convenience
export { ScopeType };

/**
 * Represents a single scope level in the hierarchy.
 * 
 * The scope stack tracks the nesting of constructs as we traverse the AST:
 * - method → lambda → try → catch → nested lambda → etc.
 * 
 * Each scope level knows:
 * - Its type (method, lambda, block)
 * - Its unique hash (for linking children)
 * - The appropriate scope kind for local variables declared within it
 */
export interface ScopeLevel {
  /** The type of scope */
  type: ScopeType;
  
  /** Unique hash for this scope (method hash, lambda expression hash, or block hash) */
  hash: string | undefined;
  
  /** The scope kind for local variables declared directly in this scope */
  scopeKind: LocalVariableScopeKind;
  
  /** For block scopes, the block kind */
  blockKind?: BlockKind;
  
  /** Lambda depth at this level (0 = not in lambda) */
  lambdaDepth: number;
  
  /** Block depth at this level (nested blocks within same scope) */
  blockDepth: number;
  
  /** For lambda scopes, whether this lambda is from a local variable initializer */
  isFromLocalVarInitializer?: boolean;
}

/**
 * Mapping from AST node types to their scope behavior.
 * This defines what happens when we encounter each node type during traversal.
 */
export interface NodeScopeRule {
  /** Does this node create a new scope boundary (lambda, method)? */
  createsScopeBoundary: boolean;
  
  /** Does this node create a block within the current scope? */
  createsBlock: boolean;
  
  /** The block kind if this creates a block */
  blockKind?: BlockKind;
  
  /** The scope kind for variables declared in this construct */
  scopeKind?: LocalVariableScopeKind;
  
  /** Does this node extract a catch parameter? */
  extractsCatchParameter?: boolean;
  
  /** Does this node extract pattern bindings? */
  extractsPatternBindings?: boolean;
  
  /** Does this node extract for loop variables? */
  extractsForLoopVariable?: boolean;
  
  /** Does this node extract try-with-resources variables? */
  extractsResourceVariables?: boolean;
}

/**
 * Rules for how each AST node type affects scope tracking.
 * This eliminates the need for manual permutation handling.
 */
export const NODE_SCOPE_RULES: Map<string, NodeScopeRule> = new Map([
  // === Scope Boundaries (reset block context) ===
  ['lambda_expression', {
    createsScopeBoundary: true,
    createsBlock: false,
    scopeKind: LocalVariableScopeKind.LAMBDA_BODY,
  }],
  
  // === Exception Handling Blocks ===
  ['try_statement', {
    createsScopeBoundary: false,
    createsBlock: true,
    blockKind: BlockKind.TRY,
    scopeKind: LocalVariableScopeKind.TRY_BLOCK,
  }],
  ['try_with_resources_statement', {
    createsScopeBoundary: false,
    createsBlock: true,
    blockKind: BlockKind.TRY_WITH_RESOURCES,
    scopeKind: LocalVariableScopeKind.TRY_BLOCK,
    extractsResourceVariables: true,
  }],
  ['catch_clause', {
    createsScopeBoundary: false,
    createsBlock: true,
    blockKind: BlockKind.CATCH,
    scopeKind: LocalVariableScopeKind.CATCH_BLOCK,
    extractsCatchParameter: true,
  }],
  ['finally_clause', {
    createsScopeBoundary: false,
    createsBlock: true,
    blockKind: BlockKind.FINALLY,
    scopeKind: LocalVariableScopeKind.FINALLY_BLOCK,
  }],
  
  // === Loop Blocks ===
  ['for_statement', {
    createsScopeBoundary: false,
    createsBlock: true,
    blockKind: BlockKind.FOR,
    scopeKind: LocalVariableScopeKind.FOR_BLOCK,
    extractsForLoopVariable: true,
  }],
  ['enhanced_for_statement', {
    createsScopeBoundary: false,
    createsBlock: true,
    blockKind: BlockKind.ENHANCED_FOR,
    scopeKind: LocalVariableScopeKind.FOR_BLOCK,
    extractsForLoopVariable: true,
  }],
  ['while_statement', {
    createsScopeBoundary: false,
    createsBlock: true,
    blockKind: BlockKind.WHILE,
    scopeKind: LocalVariableScopeKind.WHILE_BLOCK,
  }],
  ['do_statement', {
    createsScopeBoundary: false,
    createsBlock: true,
    blockKind: BlockKind.DO_WHILE,
    scopeKind: LocalVariableScopeKind.DO_WHILE_BLOCK,
  }],
  
  // === Conditional Blocks ===
  ['if_statement', {
    createsScopeBoundary: false,
    createsBlock: true,
    blockKind: BlockKind.IF,
    scopeKind: LocalVariableScopeKind.IF_BLOCK,
    extractsPatternBindings: true,
  }],
  
  // === Switch Constructs ===
  ['switch_statement', {
    createsScopeBoundary: false,
    createsBlock: true,
    blockKind: BlockKind.SWITCH_CASE,
    scopeKind: LocalVariableScopeKind.SWITCH_BLOCK,
    extractsPatternBindings: true,
  }],
  ['switch_expression', {
    createsScopeBoundary: false,
    createsBlock: true,
    blockKind: BlockKind.SWITCH_EXPRESSION_CASE,
    scopeKind: LocalVariableScopeKind.SWITCH_BLOCK,
    extractsPatternBindings: true,
  }],
  
  // === Synchronization ===
  ['synchronized_statement', {
    createsScopeBoundary: false,
    createsBlock: true,
    blockKind: BlockKind.SYNCHRONIZED,
    scopeKind: LocalVariableScopeKind.SYNCHRONIZED_BLOCK,
  }],
]);

/**
 * Manages scope context as we traverse the AST.
 * 
 * This class maintains a stack of scope levels, automatically handling:
 * - Lambda expressions creating new scope boundaries
 * - Block constructs (try/catch/if/for) creating blocks within scopes
 * - Proper parent hash resolution for variables and expressions
 * 
 * ## Usage
 * 
 * ```typescript
 * const scopeContext = new ScopeContext();
 * 
 * // Enter a method
 * scopeContext.enterMethod(methodHash, LocalVariableScopeKind.METHOD_BODY);
 * 
 * // When encountering any node, check if it needs scope handling
 * const rule = scopeContext.getRuleForNode(node.type);
 * if (rule) {
 *   if (rule.createsScopeBoundary) {
 *     scopeContext.enterLambda(lambdaHash);
 *   } else if (rule.createsBlock) {
 *     scopeContext.enterBlock(blockHash, rule.blockKind!, rule.scopeKind!);
 *   }
 * }
 * 
 * // Get the owner hash for a variable/expression
 * const ownerHash = scopeContext.getCurrentOwnerHash();
 * const scopeKind = scopeContext.getCurrentScopeKind();
 * 
 * // Exit the scope when done
 * scopeContext.exit();
 * ```
 */
export class ScopeContext {
  private stack: ScopeLevel[] = [];
  
  /** Names of variables in scope (for expression classification) */
  private localVariableNames: Set<string> = new Set();
  private lambdaParamNames: Set<string> = new Set();
  private methodParamNames: Set<string> = new Set();
  private patternBindingNames: Set<string> = new Set();
  
  /** Saved variable name sets for restoration on scope exit */
  private savedVariableStates: Array<{
    localVariableNames: Set<string>;
    lambdaParamNames: Set<string>;
    patternBindingNames: Set<string>;
  }> = [];

  /**
   * Get the rule for a given AST node type.
   */
  getRuleForNode(nodeType: string): NodeScopeRule | undefined {
    return NODE_SCOPE_RULES.get(nodeType);
  }

  /**
   * Enter a method scope.
   */
  enterMethod(
    methodHash: string | undefined,
    scopeKind: LocalVariableScopeKind,
    methodParamNames: Set<string> = new Set()
  ): void {
    this.stack.push({
      type: ScopeType.METHOD,
      hash: methodHash,
      scopeKind,
      lambdaDepth: 0,
      blockDepth: 0,
    });
    this.methodParamNames = new Set(methodParamNames);
    this.localVariableNames = new Set();
    this.lambdaParamNames = new Set();
    this.patternBindingNames = new Set();
  }

  /**
   * Enter a static initializer scope.
   */
  enterStaticInitializer(typeHash: string): void {
    this.stack.push({
      type: ScopeType.STATIC_INITIALIZER,
      hash: typeHash,
      scopeKind: LocalVariableScopeKind.STATIC_INITIALIZER,
      lambdaDepth: 0,
      blockDepth: 0,
    });
    this.localVariableNames = new Set();
    this.lambdaParamNames = new Set();
    this.patternBindingNames = new Set();
  }

  /**
   * Enter an instance initializer scope.
   */
  enterInstanceInitializer(typeHash: string): void {
    this.stack.push({
      type: ScopeType.INSTANCE_INITIALIZER,
      hash: typeHash,
      scopeKind: LocalVariableScopeKind.INSTANCE_INITIALIZER,
      lambdaDepth: 0,
      blockDepth: 0,
    });
    this.localVariableNames = new Set();
    this.lambdaParamNames = new Set();
    this.patternBindingNames = new Set();
  }

  /**
   * Enter a lambda expression scope.
   * This creates a scope boundary - block context is reset.
   * @param isFromLocalVarInitializer Whether this lambda is from a local variable initializer
   *        (affects whether LocalVariableExtractor should extract return/expression statements)
   */
  enterLambda(
    lambdaHash: string | undefined,
    lambdaParamNames: Set<string> = new Set(),
    isFromLocalVarInitializer: boolean = false
  ): void {
    // Save current variable state
    this.savedVariableStates.push({
      localVariableNames: new Set(this.localVariableNames),
      lambdaParamNames: new Set(this.lambdaParamNames),
      patternBindingNames: new Set(this.patternBindingNames),
    });

    const currentDepth = this.getCurrentLambdaDepth();
    
    this.stack.push({
      type: ScopeType.LAMBDA,
      hash: lambdaHash,
      scopeKind: LocalVariableScopeKind.LAMBDA_BODY,
      lambdaDepth: currentDepth + 1,
      blockDepth: 0, // Reset block depth for lambda
      isFromLocalVarInitializer,
    });

    // Add lambda params to tracking
    for (const name of lambdaParamNames) {
      this.lambdaParamNames.add(name);
    }
    // Reset pattern bindings for new lambda scope
    this.patternBindingNames = new Set();
  }

  /**
   * Enter a block scope (try, catch, if, for, while, etc.)
   */
  enterBlock(
    blockHash: string | undefined,
    blockKind: BlockKind,
    scopeKind: LocalVariableScopeKind
  ): void {
    const current = this.getCurrentLevel();
    const currentBlockDepth = current?.blockDepth ?? 0;
    const currentLambdaDepth = current?.lambdaDepth ?? 0;

    this.stack.push({
      type: ScopeType.BLOCK,
      hash: blockHash,
      scopeKind,
      blockKind,
      lambdaDepth: currentLambdaDepth,
      blockDepth: currentBlockDepth + 1,
    });
  }

  /**
   * Exit the current scope level.
   */
  exit(): void {
    const exited = this.stack.pop();
    
    // Restore variable state if exiting a lambda
    if (exited?.type === ScopeType.LAMBDA && this.savedVariableStates.length > 0) {
      const saved = this.savedVariableStates.pop()!;
      this.localVariableNames = saved.localVariableNames;
      this.lambdaParamNames = saved.lambdaParamNames;
      this.patternBindingNames = saved.patternBindingNames;
    }
  }

  /**
   * Get the current scope level (top of stack).
   */
  getCurrentLevel(): ScopeLevel | undefined {
    return this.stack[this.stack.length - 1];
  }

  /**
   * Get the owner hash for linking variables/expressions.
   * Returns the hash of the most specific containing scope (block > lambda > method).
   */
  getCurrentOwnerHash(): string | undefined {
    // Walk up the stack to find the most specific owner
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const level = this.stack[i];
      if (level && level.hash) {
        return level.hash;
      }
    }
    return undefined;
  }

  /**
   * Get the block hash if currently inside a block, otherwise undefined.
   */
  getCurrentBlockHash(): string | undefined {
    const current = this.getCurrentLevel();
    if (current?.type === ScopeType.BLOCK) {
      return current.hash;
    }
    return undefined;
  }

  /**
   * Get the lambda expression hash if currently inside a lambda.
   */
  getCurrentLambdaHash(): string | undefined {
    // Find the nearest lambda in the stack
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const level = this.stack[i];
      if (level && level.type === ScopeType.LAMBDA) {
        return level.hash;
      }
    }
    return undefined;
  }

  /**
   * Check if the current lambda is from a local variable initializer.
   * Used to determine if LocalVariableExtractor should extract return/expression statements
   * (TypeMethodExtractor skips lambdas in local var initializers).
   */
  isCurrentLambdaFromLocalVarInitializer(): boolean {
    // Find the nearest lambda in the stack
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const level = this.stack[i];
      if (level && level.type === ScopeType.LAMBDA) {
        return level.isFromLocalVarInitializer ?? false;
      }
    }
    return false;
  }

  /**
   * Get the appropriate scope kind for variables declared at the current level.
   */
  getCurrentScopeKind(): LocalVariableScopeKind {
    const current = this.getCurrentLevel();
    return current?.scopeKind ?? LocalVariableScopeKind.METHOD_BODY;
  }

  /**
   * Get the current lambda depth (0 = not in lambda).
   */
  getCurrentLambdaDepth(): number {
    const current = this.getCurrentLevel();
    return current?.lambdaDepth ?? 0;
  }

  /**
   * Get the current block depth.
   */
  getCurrentBlockDepth(): number {
    const current = this.getCurrentLevel();
    return current?.blockDepth ?? 0;
  }

  /**
   * Get the total scope depth (lambda + block).
   */
  getCurrentScopeDepth(): number {
    return this.getCurrentLambdaDepth() + this.getCurrentBlockDepth();
  }

  /**
   * Check if we're currently inside a lambda.
   */
  isInsideLambda(): boolean {
    return this.getCurrentLambdaDepth() > 0;
  }

  /**
   * Check if we're currently inside a block (try/catch/if/for/etc.)
   */
  isInsideBlock(): boolean {
    const current = this.getCurrentLevel();
    return current?.type === ScopeType.BLOCK;
  }

  // === Variable Name Tracking ===

  /**
   * Add a local variable name to the current scope.
   */
  addLocalVariableName(name: string): void {
    this.localVariableNames.add(name);
  }

  /**
   * Add a pattern binding name to the current scope.
   */
  addPatternBindingName(name: string): void {
    this.patternBindingNames.add(name);
  }

  /**
   * Get all local variable names in scope.
   */
  getLocalVariableNames(): Set<string> {
    return this.localVariableNames;
  }

  /**
   * Get all lambda parameter names in scope.
   */
  getLambdaParamNames(): Set<string> {
    return this.lambdaParamNames;
  }

  /**
   * Get all method parameter names.
   */
  getMethodParamNames(): Set<string> {
    return this.methodParamNames;
  }

  /**
   * Get all pattern binding names in scope.
   */
  getPatternBindingNames(): Set<string> {
    return this.patternBindingNames;
  }

  /**
   * Check if a name is a local variable.
   */
  isLocalVariable(name: string): boolean {
    return this.localVariableNames.has(name);
  }

  /**
   * Check if a name is a lambda parameter.
   */
  isLambdaParam(name: string): boolean {
    return this.lambdaParamNames.has(name);
  }

  /**
   * Check if a name is a method parameter.
   */
  isMethodParam(name: string): boolean {
    return this.methodParamNames.has(name);
  }

  /**
   * Check if a name is a pattern binding.
   */
  isPatternBinding(name: string): boolean {
    return this.patternBindingNames.has(name);
  }

  /**
   * Get the parent container hash for creating blocks.
   * This is the hash of the containing scope (lambda expression or outer block).
   */
  getParentContainerHash(): string | undefined {
    // Skip the current level and find the parent
    for (let i = this.stack.length - 2; i >= 0; i--) {
      const level = this.stack[i];
      if (level && level.hash) {
        return level.hash;
      }
    }
    return undefined;
  }

  /**
   * Clear all state (for reuse).
   */
  reset(): void {
    this.stack = [];
    this.localVariableNames = new Set();
    this.lambdaParamNames = new Set();
    this.methodParamNames = new Set();
    this.patternBindingNames = new Set();
    this.savedVariableStates = [];
  }

  /**
   * Get a debug string representation of the current stack.
   */
  debugStack(): string {
    return this.stack.map((level, i) => 
      `${i}: ${level.type} (${level.scopeKind}) hash=${level.hash?.substring(0, 20)}...`
    ).join('\n');
  }
}

/**
 * Configuration for AST traversal with scope tracking.
 */
export interface TraversalConfig {
  /** Called when entering a node. Return false to skip children. */
  onEnter?: (node: Parser.SyntaxNode, context: ScopeContext) => boolean | void;
  
  /** Called when exiting a node (after children processed). */
  onExit?: (node: Parser.SyntaxNode, context: ScopeContext) => void;
  
  /** Function to resolve a lambda expression hash from position. */
  resolveLambdaHash?: (node: Parser.SyntaxNode) => string | undefined;
  
  /** Function to resolve a block hash from position. */
  resolveBlockHash?: (node: Parser.SyntaxNode, blockKind: BlockKind) => string | undefined;
  
  /** Function to extract lambda parameter names. */
  extractLambdaParams?: (node: Parser.SyntaxNode) => Set<string>;
}

/**
 * Traverses an AST node tree with automatic scope management.
 * 
 * This function walks the AST and automatically pushes/pops scope context
 * based on the NODE_SCOPE_RULES mapping. Extractors can use the callbacks
 * to perform their extraction logic without worrying about scope management.
 * 
 * ## Example
 * 
 * ```typescript
 * const context = new ScopeContext();
 * context.enterMethod(methodHash, LocalVariableScopeKind.METHOD_BODY);
 * 
 * traverseWithScope(methodBody, context, {
 *   onEnter: (node, ctx) => {
 *     if (node.type === 'local_variable_declaration') {
 *       // Extract variable with correct owner from ctx.getCurrentOwnerHash()
 *     }
 *   },
 *   resolveLambdaHash: (node) => findLambdaExpressionHash(node),
 *   resolveBlockHash: (node, kind) => createBlockHash(node, kind),
 * });
 * ```
 */
export function traverseWithScope(
  node: Parser.SyntaxNode,
  context: ScopeContext,
  config: TraversalConfig
): void {
  const rule = context.getRuleForNode(node.type);
  let scopePushed = false;

  // Handle scope entry based on node type
  if (rule) {
    if (rule.createsScopeBoundary) {
      // Lambda expression - creates new scope boundary
      const lambdaHash = config.resolveLambdaHash?.(node);
      const lambdaParams = config.extractLambdaParams?.(node) ?? new Set<string>();
      context.enterLambda(lambdaHash, lambdaParams);
      scopePushed = true;
    } else if (rule.createsBlock && rule.blockKind && rule.scopeKind) {
      // Block construct (try, catch, if, for, etc.)
      const blockHash = config.resolveBlockHash?.(node, rule.blockKind);
      context.enterBlock(blockHash, rule.blockKind, rule.scopeKind);
      scopePushed = true;
    }
  }

  // Call onEnter callback
  const shouldProcessChildren = config.onEnter?.(node, context) !== false;

  // Process children if allowed
  if (shouldProcessChildren) {
    for (const child of node.children) {
      traverseWithScope(child, context, config);
    }
  }

  // Call onExit callback
  config.onExit?.(node, context);

  // Exit scope if we pushed one
  if (scopePushed) {
    context.exit();
  }
}

/**
 * Gets the body node for a given construct (lambda, try, if, etc.)
 */
export function getBodyNode(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  switch (node.type) {
    case 'lambda_expression':
      return node.children.find(c => c.type === 'block' || !['identifier', 'inferred_parameters', 'formal_parameters', '->'].includes(c.type));
    
    case 'try_statement':
    case 'try_with_resources_statement':
      return node.children.find(c => c.type === 'block');
    
    case 'catch_clause':
      return node.children.find(c => c.type === 'block');
    
    case 'finally_clause':
      return node.children.find(c => c.type === 'block');
    
    case 'if_statement':
      return node.children.find(c => c.type === 'block' || c.type === 'expression_statement');
    
    case 'for_statement':
    case 'enhanced_for_statement':
    case 'while_statement':
    case 'do_statement':
      return node.children.find(c => c.type === 'block');
    
    case 'synchronized_statement':
      return node.children.find(c => c.type === 'block');
    
    default:
      return undefined;
  }
}

/**
 * Extracts catch parameter info from a catch clause.
 */
export function extractCatchParameter(catchClause: Parser.SyntaxNode): {
  name: string;
  types: string[];
  node: Parser.SyntaxNode;
} | undefined {
  const catchFormalParam = catchClause.children.find(c => c.type === 'catch_formal_parameter');
  if (!catchFormalParam) return undefined;

  const nameNode = catchFormalParam.children.find(c => c.type === 'identifier');
  if (!nameNode) return undefined;

  const types: string[] = [];
  const catchType = catchFormalParam.children.find(c => c.type === 'catch_type');
  if (catchType) {
    for (const child of catchType.children) {
      if (child.type === 'type_identifier' || child.type === 'scoped_type_identifier') {
        types.push(child.text);
      }
    }
  }

  return {
    name: nameNode.text,
    types,
    node: catchFormalParam,
  };
}

/**
 * Extracts for loop variable info.
 */
export function extractForLoopVariable(forStatement: Parser.SyntaxNode): {
  name: string;
  type: string;
  node: Parser.SyntaxNode;
} | undefined {
  if (forStatement.type === 'enhanced_for_statement') {
    const typeNode = forStatement.children.find(c => 
      c.type === 'type_identifier' || c.type === 'generic_type' || c.type === 'array_type'
    );
    const nameNode = forStatement.children.find(c => c.type === 'identifier');
    
    if (typeNode && nameNode) {
      return {
        name: nameNode.text,
        type: typeNode.text,
        node: forStatement,
      };
    }
  } else if (forStatement.type === 'for_statement') {
    const init = forStatement.children.find(c => c.type === 'local_variable_declaration');
    if (init) {
      const typeNode = init.children.find(c => 
        c.type === 'type_identifier' || c.type === 'generic_type' || c.type === 'integral_type'
      );
      const declarator = init.children.find(c => c.type === 'variable_declarator');
      const nameNode = declarator?.children.find(c => c.type === 'identifier');
      
      if (typeNode && nameNode) {
        return {
          name: nameNode.text,
          type: typeNode.text,
          node: init,
        };
      }
    }
  }
  return undefined;
}

/**
 * Extracts try-with-resources variable info.
 */
export function extractResourceVariables(tryStatement: Parser.SyntaxNode): Array<{
  name: string;
  type: string;
  node: Parser.SyntaxNode;
}> {
  const resources: Array<{ name: string; type: string; node: Parser.SyntaxNode }> = [];
  
  const resourceSpec = tryStatement.children.find(c => c.type === 'resource_specification');
  if (!resourceSpec) return resources;

  for (const child of resourceSpec.children) {
    if (child.type === 'resource') {
      const typeNode = child.children.find(c => 
        c.type === 'type_identifier' || c.type === 'generic_type'
      );
      const nameNode = child.children.find(c => c.type === 'identifier');
      
      if (typeNode && nameNode) {
        resources.push({
          name: nameNode.text,
          type: typeNode.text,
          node: child,
        });
      }
    }
  }
  
  return resources;
}

/**
 * Extracts lambda parameter names from a lambda expression.
 */
export function extractLambdaParameterNames(lambdaNode: Parser.SyntaxNode): Set<string> {
  const names = new Set<string>();
  
  for (const child of lambdaNode.children) {
    if (child.type === 'identifier') {
      names.add(child.text);
    } else if (child.type === 'inferred_parameters') {
      for (const param of child.children) {
        if (param.type === 'identifier') {
          names.add(param.text);
        }
      }
    } else if (child.type === 'formal_parameters') {
      for (const param of child.children) {
        if (param.type === 'formal_parameter') {
          const nameNode = param.children.find(c => c.type === 'identifier');
          if (nameNode) {
            names.add(nameNode.text);
          }
        }
      }
    }
  }
  
  return names;
}
