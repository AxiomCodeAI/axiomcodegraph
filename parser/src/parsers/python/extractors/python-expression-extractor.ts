import Parser from 'tree-sitter';

import {
  PyCallSiteRegistry,
  PyExpressionRegistry,
  PyModuleRegistry,
} from '@/analysis-types/python';
import {
  PythonCallKind,
  PythonReceiverKind,
} from '@/enums/python/call-sites';
import {
  PythonComprehensionKind,
  PythonEdgeRole,
  PythonExpressionKind,
  PythonExpressionOwnerKind,
  PythonLiteralType,
  PythonNameContext,
  PythonReferencedEntityKind,
  PythonRootContext,
  PythonUnaryFixity,
} from '@/enums/python/expressions';
import { EntityUtils } from '@/utils/entity-utils';
import { PythonSourcePositions } from '@/utils/python';

/** What the expression stage produces for one module. */
export interface PythonExpressionExtraction {
  expressions: PyExpressionRegistry[];
  callSites: PyCallSiteRegistry[];
  /**
   * `startIndex:endIndex` -> the PK of the expression emitted for that byte
   * range, for EVERY expression rather than only tree roots.
   *
   * Keyed on the byte range because that is what identifies a node: a start
   * offset alone collides for nested calls. Lets a later stage join to an
   * expression it did not create — a parameter's default-value root, say —
   * without re-walking the tree or guessing from spans.
   *
   * Not restricted to roots: a lambda's parameter default is emitted as a CHILD
   * of the lambda expression, so a roots-only index silently fails to link it.
   */
  expressionByByteRange: Map<string, string>;
}

export interface PythonExpressionInput {
  module: PyModuleRegistry;
  rootNode: Parser.SyntaxNode;
  serviceVersionLinkHash: string;
  /** Scope-introducing `node.id` -> `py_scope` PK. */
  scopeHashByNodeId: Map<number, string>;
  /** `(scopeHash, name)` -> `py_binding` PK. */
  bindingHashByScopeAndName: Map<string, string>;
  /** Scope-introducing `node.id` -> owning `py_method` PK. */
  methodHashByNodeId: Map<number, string>;
  /** Class `node.id` -> `py_type` PK. */
  typeHashByNodeId: Map<number, string>;
  /** The synthetic `<module>` method PK — the fallback owner. */
  moduleMethodHash: string;
  /** Class `node.id` -> its `<classbody>` method PK. */
  classInitHashByNodeId: Map<number, string>;
  /** Converts tree-sitter character columns to CPython UTF-8 byte columns. */
  positions: PythonSourcePositions;
  /** `lambda` node id -> its `py_method` PK, so a lambda body owns its own facts. */
  lambdaMethodByNodeId: Map<number, string>;
}

/**
 * One queued expression node, carrying **all** of its context explicitly.
 *
 * This mirrors `expression-reference-extractor.ts`'s `PendingChild`, and the
 * reason it carries context rather than looking it up is the same: nothing may
 * be stored on a tree-sitter node. node-tree-sitter's wrapper cache evicts
 * entries, so a property written while descending is gone by the time the parent
 * is revisited, and `.parent` walks then return untagged objects. It works on
 * small files and fails silently at scale.
 */
interface PendingExpression {
  node: Parser.SyntaxNode;
  parentHash: string;
  edgeRole: PythonEdgeRole;
  position: number;
  depth: number;
  scopeHash: string;
  ownerHash: string;
  ownerKind: PythonExpressionOwnerKind;
  rootContext: PythonRootContext;
  nameContext: PythonNameContext;
  argumentKeywordName: string;
  isAwaited: boolean;
  isStarred: boolean;
  /** The enclosing method, never empty — `<module>` at worst. */
  methodHash: string;
  /** The enclosing class, or `''`. */
  typeHash: string;
  isModuleLevelCall: boolean;
  isConditional: boolean;
  /** The enclosing method's receiver parameter name, for classifying `self`. */
  receiverName: string;
  /** True when the enclosing method is a classmethod, so the receiver is `cls`. */
  receiverIsClass: boolean;
}

/** Statement-level context threaded through the statement walk. */
interface StatementContext {
  scopeHash: string;
  ownerHash: string;
  ownerKind: PythonExpressionOwnerKind;
  methodHash: string;
  typeHash: string;
  isModuleLevel: boolean;
  isConditional: boolean;
  receiverName: string;
  receiverIsClass: boolean;
  /** Where a bare expression statement sits, for `rootContext`. */
  statementRootContext: PythonRootContext;
}

/**
 * Emits `py_expression` and `py_call_site`.
 *
 * Stage 3 of the build order. It unlocks attribute chains (18.8% of receivers
 * are depth-2) and argument flow, which is the primary typing mechanism given
 * that 68.2% of parameters carry no annotation.
 *
 * ## Traversal
 *
 * A FIFO worklist, exactly as the Java expression extractor uses. Each queued
 * item carries its own parent hash, edge role, position, depth and scope, so the
 * traversal needs no ambient state and no node tagging. Breadth-first ordering
 * also makes the output stable: siblings are emitted together in position order,
 * which is what makes byte-identical output achievable.
 *
 * ## Node identity is the byte RANGE
 *
 * The expression key includes `startLine`, `startColumn`, `endLine` and
 * `endColumn`. A start offset alone collides: in `super().f()` the outer call
 * and the inner `super()` share a start position, and two writes to the same
 * target in one statement share one too.
 */
export class PythonExpressionExtractor {
  private input!: PythonExpressionInput;
  private expressions: PyExpressionRegistry[] = [];
  private callSites: PyCallSiteRegistry[] = [];
  private worklist: PendingExpression[] = [];
  /** Call-site PK -> the byte range of its receiver, resolved after the walk. */
  private pendingReceiverLinks: { callSite: PyCallSiteRegistry; range: string }[] = [];
  /** Byte range -> PK, for every expression emitted. */
  private expressionByByteRange = new Map<string, string>();

  extract(input: PythonExpressionInput): PythonExpressionExtraction {
    this.input = input;
    this.expressions = [];
    this.callSites = [];
    this.worklist = [];
    this.expressionByByteRange = new Map();
    this.pendingReceiverLinks = [];

    const moduleScopeHash = input.scopeHashByNodeId.get(input.rootNode.id) ?? '';
    this.visitStatements(input.rootNode, {
      scopeHash: moduleScopeHash,
      ownerHash: input.moduleMethodHash,
      ownerKind: PythonExpressionOwnerKind.METHOD,
      methodHash: input.moduleMethodHash,
      typeHash: '',
      isModuleLevel: true,
      isConditional: false,
      receiverName: '',
      receiverIsClass: false,
      statementRootContext: PythonRootContext.MODULE_LEVEL_STATEMENT,
    });

    // The receiver's PK does not exist when its call site is minted, so the FK
    // is resolved here, once every expression has been emitted.
    for (const link of this.pendingReceiverLinks) {
      const hash = this.expressionByByteRange.get(link.range);
      if (hash) {
        link.callSite.setReceiverExpressionLinkHash(hash);
      }
    }

    return {
      expressions: this.expressions,
      callSites: this.callSites,
      expressionByByteRange: this.expressionByByteRange,
    };
  }

  // ---------------------------------------------------------- statement walk

  private visitStatements(node: Parser.SyntaxNode, context: StatementContext): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) {
        this.visitStatement(child, context);
      }
    }
  }

  private visitStatement(node: Parser.SyntaxNode, context: StatementContext): void {
    switch (node.type) {
      case 'decorated_definition': {
        this.visitDecoratedDefinition(node, context);
        return;
      }

      case 'class_definition': {
        this.visitClassDefinition(node, context, []);
        return;
      }

      case 'function_definition': {
        this.visitFunctionDefinition(node, context, []);
        return;
      }

      case 'expression_statement': {
        for (let i = 0; i < node.namedChildCount; i++) {
          const inner = node.namedChild(i);
          if (inner) {
            this.visitStatementExpression(inner, context);
          }
        }
        return;
      }

      case 'return_statement': {
        this.enqueueRoots(node, context, PythonRootContext.RETURN_VALUE, PythonEdgeRole.RETURN_VALUE);
        return;
      }

      case 'if_statement':
      case 'elif_clause': {
        const condition = node.childForFieldName('condition');
        if (condition) {
          this.enqueueRoot(condition, context, PythonRootContext.IF_CONDITION, PythonEdgeRole.CONDITION);
        }
        this.visitChildBlocks(node, { ...context, isConditional: true }, condition);
        return;
      }

      case 'while_statement': {
        const condition = node.childForFieldName('condition');
        if (condition) {
          this.enqueueRoot(condition, context, PythonRootContext.WHILE_CONDITION, PythonEdgeRole.CONDITION);
        }
        this.visitChildBlocks(node, { ...context, isConditional: true }, condition);
        return;
      }

      case 'for_statement': {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (right) {
          this.enqueueRoot(right, context, PythonRootContext.FOR_ITERABLE, PythonEdgeRole.ROOT);
        }
        if (left) {
          this.enqueueRoot(
            left,
            context,
            PythonRootContext.FOR_TARGET,
            PythonEdgeRole.ROOT,
            PythonNameContext.STORE
          );
        }
        this.visitChildBlocks(node, { ...context, isConditional: true }, left, right);
        return;
      }

      case 'with_statement': {
        this.visitWithStatement(node, context);
        return;
      }

      case 'raise_statement': {
        this.enqueueRoots(node, context, PythonRootContext.RAISE_VALUE, PythonEdgeRole.RAISE_EXC);
        return;
      }

      case 'assert_statement': {
        for (let i = 0; i < node.namedChildCount; i++) {
          const part = node.namedChild(i);
          if (!part) {
            continue;
          }
          this.enqueueRoot(
            part,
            context,
            i === 0 ? PythonRootContext.ASSERT_CONDITION : PythonRootContext.ASSERT_MESSAGE,
            i === 0 ? PythonEdgeRole.CONDITION : PythonEdgeRole.ARGUMENT
          );
        }
        return;
      }

      case 'delete_statement': {
        this.enqueueRoots(
          node,
          context,
          PythonRootContext.DELETE_TARGET,
          PythonEdgeRole.ROOT,
          PythonNameContext.DEL
        );
        return;
      }

      case 'try_statement': {
        this.visitTryStatement(node, context);
        return;
      }

      case 'match_statement': {
        this.visitMatchStatement(node, context);
        return;
      }

      // Imports bind names but contain no expressions to model; global and
      // nonlocal are declarations, not reads.
      case 'import_statement':
      case 'import_from_statement':
      case 'future_import_statement':
      case 'global_statement':
      case 'nonlocal_statement':
      case 'pass_statement':
      case 'break_statement':
      case 'continue_statement': {
        return;
      }

      default: {
        this.visitStatements(node, context);
        return;
      }
    }
  }

  /** A bare expression statement, or an assignment in one. */
  private visitStatementExpression(node: Parser.SyntaxNode, context: StatementContext): void {
    if (node.type === 'assignment') {
      const left = node.childForFieldName('left');
      const type = node.childForFieldName('type');
      const right = node.childForFieldName('right');
      const rootContext = type
        ? PythonRootContext.ANNOTATED_ASSIGNMENT
        : PythonRootContext.ASSIGNMENT_VALUE;

      if (right) {
        this.enqueueRoot(right, context, rootContext, PythonEdgeRole.ASSIGNMENT_VALUE);
      }
      if (type) {
        this.enqueueRoot(type, context, PythonRootContext.ANNOTATION, PythonEdgeRole.ANNOTATION);
      }
      if (left) {
        this.enqueueRoot(
          left,
          context,
          PythonRootContext.ASSIGNMENT_TARGET,
          PythonEdgeRole.ASSIGNMENT_TARGET,
          PythonNameContext.STORE
        );
      }
      return;
    }

    if (node.type === 'augmented_assignment') {
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (right) {
        this.enqueueRoot(
          right,
          context,
          PythonRootContext.AUGMENTED_ASSIGNMENT,
          PythonEdgeRole.ASSIGNMENT_VALUE
        );
      }
      if (left) {
        this.enqueueRoot(
          left,
          context,
          PythonRootContext.AUGMENTED_ASSIGNMENT,
          PythonEdgeRole.ASSIGNMENT_TARGET,
          PythonNameContext.STORE
        );
      }
      return;
    }

    this.enqueueRoot(node, context, context.statementRootContext, PythonEdgeRole.ROOT);
  }

  private visitWithStatement(node: Parser.SyntaxNode, context: StatementContext): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) {
        continue;
      }
      if (child.type === 'with_clause') {
        for (let j = 0; j < child.namedChildCount; j++) {
          const item = child.namedChild(j);
          if (item?.type !== 'with_item') {
            continue;
          }
          const value = item.childForFieldName('value') ?? item.namedChild(0);
          if (!value) {
            continue;
          }
          if (value.type === 'as_pattern') {
            const source = value.namedChild(0);
            if (source) {
              this.enqueueRoot(
                source,
                context,
                PythonRootContext.WITH_CONTEXT,
                PythonEdgeRole.WITH_CONTEXT
              );
            }
            const target = value.namedChild(1);
            if (target) {
              this.enqueueRoot(
                target,
                context,
                PythonRootContext.WITH_TARGET,
                PythonEdgeRole.WITH_TARGET,
                PythonNameContext.STORE
              );
            }
            continue;
          }
          this.enqueueRoot(value, context, PythonRootContext.WITH_CONTEXT, PythonEdgeRole.WITH_CONTEXT);
        }
        continue;
      }
      this.visitStatement(child, context);
    }
  }

  private visitTryStatement(node: Parser.SyntaxNode, context: StatementContext): void {
    const nested: StatementContext = { ...context, isConditional: true };
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) {
        continue;
      }
      if (child.type === 'except_clause' || child.type === 'except_group_clause') {
        for (let j = 0; j < child.namedChildCount; j++) {
          const part = child.namedChild(j);
          if (!part) {
            continue;
          }
          if (part.type === 'block') {
            this.visitStatement(part, nested);
            continue;
          }
          if (part.type === 'as_pattern') {
            const source = part.namedChild(0);
            if (source) {
              this.enqueueRoot(
                source,
                nested,
                PythonRootContext.EXCEPT_TYPE,
                PythonEdgeRole.EXCEPT_TYPE
              );
            }
            const target = part.namedChild(1);
            if (target) {
              this.enqueueRoot(
                target,
                nested,
                PythonRootContext.EXCEPT_TYPE,
                PythonEdgeRole.EXCEPT_TARGET,
                PythonNameContext.STORE
              );
            }
            continue;
          }
          this.enqueueRoot(part, nested, PythonRootContext.EXCEPT_TYPE, PythonEdgeRole.EXCEPT_TYPE);
        }
        continue;
      }
      this.visitStatement(child, nested);
    }
  }

  private visitMatchStatement(node: Parser.SyntaxNode, context: StatementContext): void {
    const subject = node.namedChild(0);
    if (subject && subject.type !== 'block') {
      this.enqueueRoot(
        subject,
        context,
        PythonRootContext.MATCH_SUBJECT,
        PythonEdgeRole.MATCH_SUBJECT
      );
    }
    const nested: StatementContext = { ...context, isConditional: true };
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child || child.id === subject?.id) {
        continue;
      }
      if (child.type === 'block') {
        for (let j = 0; j < child.namedChildCount; j++) {
          const clause = child.namedChild(j);
          if (clause?.type === 'case_clause') {
            this.visitCaseClause(clause, nested);
            continue;
          }
          if (clause) {
            this.visitStatement(clause, nested);
          }
        }
        continue;
      }
      this.visitStatements(child, nested);
    }
  }

  /**
   * One `case` clause: pattern, optional guard, body.
   *
   * The guard needs handling in its own right rather than falling through to the
   * generic statement walk, because it is an **expression** and can contain
   * calls and walrus bindings that the generic walk would silently drop:
   *
   * ```python
   * case [head, *tail] if (n := len(tail)) > 0:
   * #                          ^ this call is lost without an explicit guard root
   * ```
   */
  private visitCaseClause(node: Parser.SyntaxNode, context: StatementContext): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) {
        continue;
      }
      if (child.type === 'case_pattern') {
        this.enqueueRoot(
          child,
          context,
          PythonRootContext.CASE_PATTERN,
          PythonEdgeRole.MATCH_PATTERN
        );
        continue;
      }
      if (child.type === 'if_clause') {
        const guard = child.namedChild(0);
        if (guard) {
          this.enqueueRoot(
            guard,
            context,
            PythonRootContext.CASE_GUARD,
            PythonEdgeRole.CONDITION
          );
        }
        continue;
      }
      this.visitStatement(child, context);
    }
  }

  /** Visits a compound statement's blocks, skipping nodes already handled. */
  private visitChildBlocks(
    node: Parser.SyntaxNode,
    context: StatementContext,
    ...handled: (Parser.SyntaxNode | null)[]
  ): void {
    const handledIds = new Set(handled.filter(n => n !== null).map(n => n!.id));
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child || handledIds.has(child.id)) {
        continue;
      }
      this.visitStatement(child, context);
    }
  }

  // ------------------------------------------------------------ definitions

  private visitDecoratedDefinition(
    node: Parser.SyntaxNode,
    context: StatementContext
  ): void {
    const decorators: Parser.SyntaxNode[] = [];
    let definition: Parser.SyntaxNode | null = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) {
        continue;
      }
      if (child.type === 'decorator') {
        decorators.push(child);
        continue;
      }
      definition = child;
    }
    if (definition?.type === 'class_definition') {
      this.visitClassDefinition(definition, context, decorators);
      return;
    }
    if (definition?.type === 'function_definition') {
      this.visitFunctionDefinition(definition, context, decorators);
      return;
    }
    if (definition) {
      this.visitStatement(definition, context);
    }
  }

  private visitClassDefinition(
    node: Parser.SyntaxNode,
    context: StatementContext,
    decorators: Parser.SyntaxNode[]
  ): void {
    // Decorators and bases are evaluated in the ENCLOSING scope.
    for (const decorator of decorators) {
      const inner = decorator.namedChild(0);
      if (inner) {
        this.enqueueRoot(inner, context, PythonRootContext.DECORATOR, PythonEdgeRole.DECORATOR_EXPR);
      }
    }
    const argumentsNode = node.childForFieldName('superclasses');
    if (argumentsNode) {
      for (let i = 0; i < argumentsNode.namedChildCount; i++) {
        const base = argumentsNode.namedChild(i);
        if (base) {
          this.enqueueRoot(
            base,
            context,
            PythonRootContext.BASE_CLASS_LIST,
            PythonEdgeRole.BASE_CLASS,
            PythonNameContext.LOAD,
            i
          );
        }
      }
    }

    const bodyNode = node.childForFieldName('body');
    if (!bodyNode) {
      return;
    }
    const typeHash = this.input.typeHashByNodeId.get(node.id) ?? '';
    const classInitHash =
      this.input.classInitHashByNodeId.get(node.id) ?? context.methodHash;

    this.visitStatements(bodyNode, {
      ...context,
      scopeHash: this.input.scopeHashByNodeId.get(node.id) ?? context.scopeHash,
      ownerHash: classInitHash,
      ownerKind: PythonExpressionOwnerKind.METHOD,
      methodHash: classInitHash,
      typeHash,
      isModuleLevel: false,
      receiverName: '',
      receiverIsClass: false,
      statementRootContext: PythonRootContext.CLASS_BODY_STATEMENT,
    });
  }

  private visitFunctionDefinition(
    node: Parser.SyntaxNode,
    context: StatementContext,
    decorators: Parser.SyntaxNode[]
  ): void {
    // Decorators, defaults and annotations are evaluated in the ENCLOSING scope.
    for (const decorator of decorators) {
      const inner = decorator.namedChild(0);
      if (inner) {
        this.enqueueRoot(inner, context, PythonRootContext.DECORATOR, PythonEdgeRole.DECORATOR_EXPR);
      }
    }
    const parametersNode = node.childForFieldName('parameters');
    if (parametersNode) {
      for (let i = 0; i < parametersNode.namedChildCount; i++) {
        const param = parametersNode.namedChild(i);
        if (!param || param.isExtra) {
          continue;
        }
        const value = param.childForFieldName('value');
        if (value) {
          this.enqueueRoot(
            value,
            context,
            PythonRootContext.DEFAULT_VALUE,
            PythonEdgeRole.DEFAULT_VALUE,
            PythonNameContext.LOAD,
            i
          );
        }
        const type = param.childForFieldName('type');
        if (type) {
          this.enqueueRoot(
            type,
            context,
            PythonRootContext.ANNOTATION,
            PythonEdgeRole.ANNOTATION,
            PythonNameContext.LOAD,
            i
          );
        }
      }
    }
    const returnType = node.childForFieldName('return_type');
    if (returnType) {
      this.enqueueRoot(returnType, context, PythonRootContext.ANNOTATION, PythonEdgeRole.ANNOTATION);
    }

    const bodyNode = node.childForFieldName('body');
    if (!bodyNode) {
      return;
    }
    const methodHash = this.input.methodHashByNodeId.get(node.id) ?? context.methodHash;
    const decoratorText = decorators.map(d => d.text).join(' ');
    const isClassMethod = /@\s*classmethod/.test(decoratorText);
    const isStaticMethod = /@\s*staticmethod/.test(decoratorText);
    const receiverName =
      context.typeHash !== '' && !isStaticMethod
        ? this.firstParameterName(parametersNode)
        : '';

    this.visitStatements(bodyNode, {
      ...context,
      scopeHash: this.input.scopeHashByNodeId.get(node.id) ?? context.scopeHash,
      ownerHash: methodHash,
      ownerKind: PythonExpressionOwnerKind.METHOD,
      methodHash,
      isModuleLevel: false,
      receiverName,
      receiverIsClass: isClassMethod,
      statementRootContext: PythonRootContext.EXPRESSION_STATEMENT,
    });
  }

  /**
   * The first parameter's name — the actual receiver, which is `self` only by
   * convention. Code that names it `s` or `this` still has a receiver.
   */
  private firstParameterName(parametersNode: Parser.SyntaxNode | null): string {
    if (!parametersNode) {
      return '';
    }
    // Skip any leading grammar extra, so a comment before the first parameter
    // does not make the method look like it has no receiver.
    let first: Parser.SyntaxNode | null = null;
    for (let i = 0; i < parametersNode.namedChildCount; i++) {
      const candidate = parametersNode.namedChild(i);
      if (candidate && !candidate.isExtra) {
        first = candidate;
        break;
      }
    }
    if (!first) {
      return '';
    }
    if (first.type === 'identifier') {
      return first.text;
    }
    const named = first.childForFieldName('name') ?? first.namedChild(0);
    return named?.type === 'identifier' ? named.text : '';
  }

  // ----------------------------------------------------------- enqueue roots

  private enqueueRoots(
    node: Parser.SyntaxNode,
    context: StatementContext,
    rootContext: PythonRootContext,
    edgeRole: PythonEdgeRole,
    nameContext: PythonNameContext = PythonNameContext.LOAD
  ): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child && child.type !== 'block') {
        this.enqueueRoot(child, context, rootContext, edgeRole, nameContext, i);
      }
    }
  }

  private enqueueRoot(
    node: Parser.SyntaxNode,
    context: StatementContext,
    rootContext: PythonRootContext,
    edgeRole: PythonEdgeRole,
    nameContext: PythonNameContext = PythonNameContext.LOAD,
    position = 0
  ): void {
    this.worklist.push({
      node,
      parentHash: '',
      edgeRole,
      position,
      depth: 0,
      scopeHash: context.scopeHash,
      ownerHash: context.ownerHash,
      ownerKind: context.ownerKind,
      rootContext,
      nameContext,
      argumentKeywordName: '',
      isAwaited: false,
      isStarred: false,
      methodHash: context.methodHash,
      typeHash: context.typeHash,
      isModuleLevelCall: context.isModuleLevel,
      isConditional: context.isConditional,
      receiverName: context.receiverName,
      receiverIsClass: context.receiverIsClass,
    });
    this.drain();
  }

  /**
   * Processes the worklist FIFO, so siblings are emitted together in position
   * order and output is stable run to run.
   */
  private drain(): void {
    while (this.worklist.length > 0) {
      const pending = this.worklist.shift();
      if (pending) {
        this.emitExpression(pending);
      }
    }
  }

  // ------------------------------------------------------------- expressions

  private emitExpression(pending: PendingExpression): void {
    const node = pending.node;

    // Transparent wrappers contribute no row of their own; the inner expression
    // takes the parent's role directly. Emitting them would add a node the
    // source does not contain and break `depth` for every descendant.
    //
    // `pair` matters here: a dict literal's children are `pair` nodes, so
    // dropping them loses every key AND value in the dict — including calls, as
    // in `{'A': self.__seqToRE(...)}` from _strptime.py.
    if (
      node.type === 'parenthesized_expression' ||
      node.type === 'expression_list' ||
      node.type === 'pair'
    ) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const inner = node.namedChild(i);
        if (inner) {
          this.worklist.push({ ...pending, node: inner, position: i });
        }
      }
      return;
    }

    const kind = this.expressionKindOf(node, pending);
    if (kind === null) {
      // An unrecognised node is treated as TRANSPARENT, never dropped. Dropping
      // it would silently discard its whole subtree — which is how a dict's
      // `pair` nodes took every call in the dict with them. Being transparent
      // means the worst case is a flatter tree than ideal, not a missing fact.
      if (!this.isLeafToken(node)) {
        for (let i = 0; i < node.namedChildCount; i++) {
          const inner = node.namedChild(i);
          if (inner && !inner.isExtra) {
            this.worklist.push({ ...pending, node: inner });
          }
        }
      }
      return;
    }

    const builder = PyExpressionRegistry.builder(
      kind,
      pending.edgeRole,
      pending.rootContext,
      pending.ownerKind,
      pending.ownerHash,
      pending.scopeHash,
      this.input.module.getHash(),
      this.input.serviceVersionLinkHash
    )
      .withParent(pending.parentHash, pending.position, pending.depth)
      .withSpan(
        node.startPosition.row + 1,
        this.input.positions.byteColumn(node.startPosition.row, node.startPosition.column),
        node.endPosition.row + 1,
        this.input.positions.byteColumn(node.endPosition.row, node.endPosition.column)
      )
      .withNameContext(pending.nameContext)
      .withArgumentKeywordName(pending.argumentKeywordName)
      .withFlags({ isAwaited: pending.isAwaited, isStarred: pending.isStarred })
      .withPyTypeLinkHash(pending.typeHash);

    this.applyKindSpecificFields(builder, node, kind, pending);

    const expression = builder.build();
    this.expressions.push(expression);

    this.expressionByByteRange.set(
      `${node.startIndex}:${node.endIndex}`,
      expression.getHash()
    );

    if (kind === PythonExpressionKind.CALL) {
      this.emitCallSite(node, expression, pending);
    }

    // Leaves have no sub-expressions. A string's string_start/string_content
    // parts are not expressions, and descending into them would emit noise.
    if (!this.isLeafKind(kind, node)) {
      this.enqueueChildren(node, kind, expression, pending);
    }
  }

  /**
   * Fills the fields whose meaning depends on the node kind, most importantly
   * `literalValue` — the shared **name slot** that carries a callee name, an
   * attribute name, an identifier, or a literal's text, exactly as Java's
   * column 10 does.
   */
  private applyKindSpecificFields(
    builder: ReturnType<typeof PyExpressionRegistry.builder>,
    node: Parser.SyntaxNode,
    kind: PythonExpressionKind,
    pending: PendingExpression
  ): void {
    switch (kind) {
      case PythonExpressionKind.NAME_REFERENCE:
      case PythonExpressionKind.SELF_REFERENCE:
      case PythonExpressionKind.CLS_REFERENCE: {
        builder.withName(node.text);
        builder.withReferencedEntity(this.referencedEntityKindOf(node.text, kind), '');
        const bindingHash = this.input.bindingHashByScopeAndName.get(
          `${pending.scopeHash}::${node.text}`
        );
        if (bindingHash) {
          builder.withBindingLinkHash(bindingHash);
        }
        return;
      }

      case PythonExpressionKind.ATTRIBUTE_ACCESS: {
        const attribute = node.childForFieldName('attribute');
        builder.withName(attribute?.text ?? '');
        builder.withDottedPath(this.dottedPathOf(node));
        return;
      }

      case PythonExpressionKind.CALL: {
        const fn = node.childForFieldName('function');
        builder.withName(fn ? this.calleeNameOf(fn) : '');
        if (fn) {
          builder.withDottedPath(this.dottedPathOf(fn));
        }
        return;
      }

      case PythonExpressionKind.LITERAL: {
        builder.withLiteral(this.literalTypeOf(node), this.literalTextOf(node));
        return;
      }

      case PythonExpressionKind.BINARY_OPERATION:
      case PythonExpressionKind.COMPARISON:
      case PythonExpressionKind.BOOLEAN_OPERATION: {
        builder.withOperator(this.binaryOperatorOf(node), PythonUnaryFixity.NONE);
        return;
      }

      case PythonExpressionKind.UNARY_OPERATION: {
        const operator = node.child(0);
        builder.withOperator(operator?.text ?? '', PythonUnaryFixity.PREFIX);
        return;
      }

      case PythonExpressionKind.ASSIGNMENT_EXPRESSION: {
        builder.withOperator(':=', PythonUnaryFixity.NONE);
        const target = node.childForFieldName('name') ?? node.namedChild(0);
        builder.withName(target?.text ?? '');
        return;
      }

      case PythonExpressionKind.LAMBDA: {
        builder.withLambdaScopeHash(this.input.scopeHashByNodeId.get(node.id) ?? '');
        return;
      }

      case PythonExpressionKind.LIST_COMPREHENSION:
      case PythonExpressionKind.SET_COMPREHENSION:
      case PythonExpressionKind.DICT_COMPREHENSION:
      case PythonExpressionKind.GENERATOR_EXPRESSION: {
        builder.withLambdaScopeHash(this.input.scopeHashByNodeId.get(node.id) ?? '');
        builder.withComprehensionKind(this.comprehensionKindOf(node));
        return;
      }

      case PythonExpressionKind.FSTRING:
      case PythonExpressionKind.FSTRING_INTERPOLATION: {
        builder.withLiteral(PythonLiteralType.FSTRING, '');
        return;
      }

      default: {
        return;
      }
    }
  }

  /**
   * Queues an expression's children with their edge roles.
   *
   * The roles are what make the tree queryable: a rule asking for a call's
   * receiver looks for `RECEIVER`, and one asking for its keyword arguments
   * looks for `KEYWORD_ARGUMENT` plus `argumentKeywordName`.
   */
  private enqueueChildren(
    node: Parser.SyntaxNode,
    kind: PythonExpressionKind,
    expression: PyExpressionRegistry,
    pending: PendingExpression
  ): void {
    const base: PendingExpression = {
      ...pending,
      parentHash: expression.getHash(),
      depth: pending.depth + 1,
      argumentKeywordName: '',
      isAwaited: false,
      isStarred: false,
      // Only the node itself is a write target; its sub-expressions are reads.
      // `self.x = 1` writes the attribute but READS `self`.
      nameContext:
        kind === PythonExpressionKind.NAME_REFERENCE
          ? pending.nameContext
          : PythonNameContext.LOAD,
    };

    switch (kind) {
      case PythonExpressionKind.CALL: {
        const fn = node.childForFieldName('function');
        const args = node.childForFieldName('arguments');
        if (fn) {
          // The callee of a method call is an attribute whose object is the
          // receiver; RECEIVER is used on the callee itself so that the Java
          // `call-site.dl` pattern ports unchanged.
          this.worklist.push({
            ...base,
            node: fn,
            edgeRole:
              fn.type === 'attribute' ? PythonEdgeRole.RECEIVER : PythonEdgeRole.CALLEE,
            position: 0,
          });
        }
        if (args) {
          this.enqueueArguments(args, base);
        }
        return;
      }

      case PythonExpressionKind.ATTRIBUTE_ACCESS: {
        const object = node.childForFieldName('object');
        if (object) {
          this.worklist.push({
            ...base,
            node: object,
            edgeRole: PythonEdgeRole.ATTRIBUTE_OBJECT,
            position: 0,
          });
        }
        return;
      }

      case PythonExpressionKind.SUBSCRIPT: {
        if (node.type === 'generic_type') {
          // `generic_type` = base name + a `type_parameter` holding the args.
          const genericBase = node.namedChild(0);
          if (genericBase) {
            this.worklist.push({
              ...base,
              node: genericBase,
              edgeRole: PythonEdgeRole.SUBSCRIPT_OBJECT,
              position: 0,
            });
          }
          let argIndex = 1;
          for (let i = 1; i < node.namedChildCount; i++) {
            const parameterList = node.namedChild(i);
            if (parameterList?.type !== 'type_parameter') {
              continue;
            }
            for (let j = 0; j < parameterList.namedChildCount; j++) {
              const arg = parameterList.namedChild(j);
              if (!arg || arg.isExtra) {
                continue;
              }
              this.worklist.push({
                ...base,
                node: arg,
                edgeRole: PythonEdgeRole.SUBSCRIPT_INDEX,
                position: argIndex++,
              });
            }
          }
          return;
        }
        const value = node.childForFieldName('value');
        if (value) {
          this.worklist.push({
            ...base,
            node: value,
            edgeRole: PythonEdgeRole.SUBSCRIPT_OBJECT,
            position: 0,
          });
        }
        // `d[a, b, c]` has THREE `subscript` field children, and
        // childForFieldName returns only the first — so indexing by field alone
        // silently drops every index after the first, including any calls in
        // them. dataclasses.py depends on this: `_hash_action[bool(a), bool(b),
        // bool(c), d]` loses three of its four calls.
        let index = 1;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (!child || child.id === value?.id) {
            continue;
          }
          this.worklist.push({
            ...base,
            node: child,
            edgeRole: PythonEdgeRole.SUBSCRIPT_INDEX,
            position: index++,
          });
        }
        return;
      }

      case PythonExpressionKind.SLICE: {
        const roles = [
          PythonEdgeRole.SLICE_LOWER,
          PythonEdgeRole.SLICE_UPPER,
          PythonEdgeRole.SLICE_STEP,
        ];
        let index = 0;
        for (let i = 0; i < node.namedChildCount; i++) {
          const part = node.namedChild(i);
          if (!part) {
            continue;
          }
          this.worklist.push({
            ...base,
            node: part,
            edgeRole: roles[Math.min(index, roles.length - 1)]!,
            position: index,
          });
          index += 1;
        }
        return;
      }

      case PythonExpressionKind.BINARY_OPERATION:
      case PythonExpressionKind.COMPARISON:
      case PythonExpressionKind.BOOLEAN_OPERATION: {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (left) {
          this.worklist.push({
            ...base,
            node: left,
            edgeRole: PythonEdgeRole.OPERAND_LEFT,
            position: 0,
          });
        }
        if (right) {
          this.worklist.push({
            ...base,
            node: right,
            edgeRole: PythonEdgeRole.OPERAND_RIGHT,
            position: 1,
          });
        }
        if (!left && !right) {
          // Chained comparisons such as `a < b < c` have no left/right fields.
          let position = 0;
          for (let i = 0; i < node.namedChildCount; i++) {
            const part = node.namedChild(i);
            if (part) {
              this.worklist.push({
                ...base,
                node: part,
                edgeRole:
                  position === 0 ? PythonEdgeRole.OPERAND_LEFT : PythonEdgeRole.OPERAND_RIGHT,
                position: position++,
              });
            }
          }
        }
        return;
      }

      case PythonExpressionKind.UNARY_OPERATION: {
        const argument = node.childForFieldName('argument') ?? node.namedChild(0);
        if (argument) {
          this.worklist.push({
            ...base,
            node: argument,
            edgeRole: PythonEdgeRole.UNARY_OPERAND,
            position: 0,
          });
        }
        return;
      }

      case PythonExpressionKind.CONDITIONAL_EXPRESSION: {
        // `a if cond else b` — body, condition, orelse, in source order.
        const roles = [PythonEdgeRole.BODY, PythonEdgeRole.CONDITION, PythonEdgeRole.ORELSE];
        let index = 0;
        for (let i = 0; i < node.namedChildCount; i++) {
          const part = node.namedChild(i);
          if (part) {
            this.worklist.push({
              ...base,
              node: part,
              edgeRole: roles[Math.min(index, roles.length - 1)]!,
              position: index,
            });
            index += 1;
          }
        }
        return;
      }

      case PythonExpressionKind.AWAIT: {
        const inner = node.namedChild(0);
        if (inner) {
          this.worklist.push({
            ...base,
            node: inner,
            edgeRole: PythonEdgeRole.AWAIT_OPERAND,
            position: 0,
            isAwaited: true,
          });
        }
        return;
      }

      case PythonExpressionKind.YIELD:
      case PythonExpressionKind.YIELD_FROM: {
        for (let i = 0; i < node.namedChildCount; i++) {
          const part = node.namedChild(i);
          if (part) {
            this.worklist.push({
              ...base,
              node: part,
              edgeRole: PythonEdgeRole.YIELD_VALUE,
              position: i,
            });
          }
        }
        return;
      }

      case PythonExpressionKind.STARRED:
      case PythonExpressionKind.DOUBLE_STARRED: {
        const inner = node.namedChild(0);
        if (inner) {
          this.worklist.push({
            ...base,
            node: inner,
            edgeRole: pending.edgeRole,
            position: 0,
            isStarred: true,
          });
        }
        return;
      }

      case PythonExpressionKind.ASSIGNMENT_EXPRESSION: {
        const target = node.childForFieldName('name') ?? node.namedChild(0);
        const value = node.childForFieldName('value') ?? node.namedChild(1);
        if (value) {
          this.worklist.push({
            ...base,
            node: value,
            edgeRole: PythonEdgeRole.ASSIGNMENT_VALUE,
            position: 1,
          });
        }
        if (target) {
          this.worklist.push({
            ...base,
            node: target,
            edgeRole: PythonEdgeRole.ASSIGNMENT_TARGET,
            position: 0,
            nameContext: PythonNameContext.STORE,
          });
        }
        return;
      }

      case PythonExpressionKind.LAMBDA: {
        // Parameter defaults are evaluated in the ENCLOSING scope, at the moment
        // the lambda is created — the same rule as for a `def`. Walking only the
        // body loses them: `CFUNCTYPE(None)(lambda x=Nasty(): None)` from the
        // stdlib test suite hides a real call in a lambda default.
        const parameters = node.childForFieldName('parameters');
        if (parameters) {
          for (let i = 0; i < parameters.namedChildCount; i++) {
            const param = parameters.namedChild(i);
            if (param?.isExtra) {
              continue;
            }
            const value = param?.childForFieldName('value');
            if (value) {
              this.worklist.push({
                ...base,
                node: value,
                edgeRole: PythonEdgeRole.DEFAULT_VALUE,
                position: i,
              });
            }
          }
        }
        // The body evaluates in the LAMBDA's own scope AND is owned by the
        // lambda's own py_method — not by the function the lambda sits in.
        // Attributing a call inside a lambda to the enclosing function is a real
        // call-graph error: the lambda is a separate callable that may be invoked
        // from anywhere it is passed to.
        const body = node.childForFieldName('body');
        const lambdaScope = this.input.scopeHashByNodeId.get(node.id);
        const lambdaMethod = this.input.lambdaMethodByNodeId.get(node.id);
        if (body && lambdaScope) {
          this.worklist.push({
            ...base,
            node: body,
            edgeRole: PythonEdgeRole.LAMBDA_BODY,
            position: 0,
            scopeHash: lambdaScope,
            rootContext: PythonRootContext.LAMBDA_BODY,
            ...(lambdaMethod
              ? {
                  ownerHash: lambdaMethod,
                  ownerKind: PythonExpressionOwnerKind.LAMBDA,
                  methodHash: lambdaMethod,
                  // A lambda body is not module-level code even when the lambda
                  // itself is written at module level.
                  isModuleLevelCall: false,
                }
              : {}),
          });
        }
        return;
      }

      case PythonExpressionKind.LIST_COMPREHENSION:
      case PythonExpressionKind.SET_COMPREHENSION:
      case PythonExpressionKind.DICT_COMPREHENSION:
      case PythonExpressionKind.GENERATOR_EXPRESSION: {
        this.enqueueComprehensionChildren(node, base);
        return;
      }

      case PythonExpressionKind.TUPLE:
      case PythonExpressionKind.LIST:
      case PythonExpressionKind.SET:
      case PythonExpressionKind.DICT:
      case PythonExpressionKind.FSTRING:
      case PythonExpressionKind.FSTRING_INTERPOLATION:
      default: {
        const role =
          kind === PythonExpressionKind.FSTRING ||
          kind === PythonExpressionKind.FSTRING_INTERPOLATION
            ? PythonEdgeRole.FSTRING_EXPRESSION
            : PythonEdgeRole.ARGUMENT;
        let position = 0;
        for (let i = 0; i < node.namedChildCount; i++) {
          const part = node.namedChild(i);
          if (!part || part.type === 'block' || part.isExtra) {
            continue;
          }
          this.worklist.push({ ...base, node: part, edgeRole: role, position: position++ });
        }
        return;
      }
    }
  }

  /**
   * Queues call arguments, distinguishing the four kinds that argument flow
   * needs to tell apart.
   *
   * Keyword arguments carry their name in `argumentKeywordName`. Without it,
   * argument→parameter linking can only work positionally and silently loses
   * 12,000 measured keyword arguments.
   */
  private enqueueArguments(args: Parser.SyntaxNode, base: PendingExpression): void {
    // A sole generator expression is passed WITHOUT an argument_list wrapper:
    // `tuple(x for x in y)` puts the generator_expression directly in the
    // `arguments` field. Iterating its children as if it were an argument list
    // counts the element and each for-clause as separate arguments and loses any
    // call inside the clause entirely.
    if (args.type !== 'argument_list') {
      this.worklist.push({
        ...base,
        node: args,
        edgeRole: PythonEdgeRole.ARGUMENT,
        position: 0,
      });
      return;
    }

    let positional = 0;
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i);
      if (!arg || arg.isExtra) {
        continue;
      }

      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')?.text ?? '';
        const value = arg.childForFieldName('value');
        if (value) {
          this.worklist.push({
            ...base,
            node: value,
            edgeRole: PythonEdgeRole.KEYWORD_ARGUMENT,
            position: positional,
            argumentKeywordName: name,
          });
        }
        continue;
      }

      if (arg.type === 'list_splat') {
        const inner = arg.namedChild(0);
        if (inner) {
          this.worklist.push({
            ...base,
            node: inner,
            edgeRole: PythonEdgeRole.STAR_ARGUMENT,
            position: positional++,
            isStarred: true,
          });
        }
        continue;
      }

      if (arg.type === 'dictionary_splat') {
        const inner = arg.namedChild(0);
        if (inner) {
          this.worklist.push({
            ...base,
            node: inner,
            edgeRole: PythonEdgeRole.DOUBLE_STAR_ARGUMENT,
            position: positional,
            isStarred: true,
          });
        }
        continue;
      }

      this.worklist.push({
        ...base,
        node: arg,
        edgeRole: PythonEdgeRole.ARGUMENT,
        position: positional++,
      });
    }
  }

  /**
   * Queues a comprehension's parts.
   *
   * The **outermost iterable is evaluated in the enclosing scope** while
   * everything else evaluates inside the comprehension's own scope. Assigning
   * them all the inner scope would make the outer iterable's names resolve
   * against the wrong binding set.
   */
  private enqueueComprehensionChildren(
    node: Parser.SyntaxNode,
    base: PendingExpression
  ): void {
    const innerScope = this.input.scopeHashByNodeId.get(node.id) ?? base.scopeHash;
    const clauses: Parser.SyntaxNode[] = [];
    const elements: Parser.SyntaxNode[] = [];

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) {
        continue;
      }
      if (child.type === 'for_in_clause') {
        clauses.push(child);
        continue;
      }
      if (child.type === 'if_clause') {
        elements.push(child);
        continue;
      }
      elements.push(child);
    }

    clauses.forEach((clause, index) => {
      const target = clause.childForFieldName('left');
      const iterable = clause.childForFieldName('right');
      if (iterable) {
        this.worklist.push({
          ...base,
          node: iterable,
          edgeRole: PythonEdgeRole.COMPREHENSION_ITERABLE,
          position: index,
          // Only the FIRST iterable is evaluated outside.
          scopeHash: index === 0 ? base.scopeHash : innerScope,
          rootContext: index === 0 ? base.rootContext : PythonRootContext.COMPREHENSION,
        });
      }
      if (target) {
        this.worklist.push({
          ...base,
          node: target,
          edgeRole: PythonEdgeRole.COMPREHENSION_TARGET,
          position: index,
          scopeHash: innerScope,
          rootContext: PythonRootContext.COMPREHENSION,
          nameContext: PythonNameContext.STORE,
        });
      }
    });

    elements.forEach((element, index) => {
      const isCondition = element.type === 'if_clause';
      const target = isCondition ? (element.namedChild(0) ?? element) : element;
      this.worklist.push({
        ...base,
        node: target,
        edgeRole: isCondition
          ? PythonEdgeRole.COMPREHENSION_CONDITION
          : PythonEdgeRole.COMPREHENSION_ELEMENT,
        position: index,
        scopeHash: innerScope,
        rootContext: PythonRootContext.COMPREHENSION,
      });
    });
  }

  // ------------------------------------------------------------- call sites

  private emitCallSite(
    node: Parser.SyntaxNode,
    expression: PyExpressionRegistry,
    pending: PendingExpression
  ): void {
    const fn = node.childForFieldName('function');
    const args = node.childForFieldName('arguments');
    const argumentSummary = this.summarizeArguments(args);
    const receiver = this.classifyReceiver(fn, pending);

    const callSite = PyCallSiteRegistry.builder(
      this.callKindOf(fn, receiver.kind, pending),
      fn ? this.calleeNameOf(fn) : '',
      expression.getHash(),
      pending.scopeHash,
      pending.methodHash,
      this.input.module.getHash(),
      this.input.serviceVersionLinkHash
    )
      .withCallee(fn ? this.dottedPathOf(fn) : '')
      .withReceiver(receiver.kind, receiver.text, '')
      .withPyTypeLinkHash(pending.typeHash)
      .withArguments(argumentSummary)
      .withFlags({
        isModuleLevelCall: pending.isModuleLevelCall,
        isConditional: pending.isConditional,
      })
      .withSpan(
        node.startPosition.row + 1,
        this.input.positions.byteColumn(node.startPosition.row, node.startPosition.column),
        node.endPosition.row + 1
      )
      .build();

    this.callSites.push(callSite);
    if (receiver.node) {
      this.pendingReceiverLinks.push({
        callSite,
        range: `${receiver.node.startIndex}:${receiver.node.endIndex}`,
      });
    }
  }

  private summarizeArguments(args: Parser.SyntaxNode | null): {
    positionalArgCount: number;
    keywordArgCount: number;
    hasStarArgs: boolean;
    hasDoubleStarArgs: boolean;
    keywordNames: string[];
  } {
    const summary = {
      positionalArgCount: 0,
      keywordArgCount: 0,
      hasStarArgs: false,
      hasDoubleStarArgs: false,
      keywordNames: [] as string[],
    };
    if (!args) {
      return summary;
    }
    // See enqueueArguments: a bare generator expression is one argument, not a
    // list of its parts.
    if (args.type !== 'argument_list') {
      summary.positionalArgCount = 1;
      return summary;
    }
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i);
      if (!arg) {
        continue;
      }
      // Grammar EXTRAS — comments and line-continuation backslashes — are
      // NAMED nodes that can sit between arguments, so counting named children
      // blindly inflates positionalArgCount. Both occur in real multi-line
      // calls (ftplib.py:975 uses a continuation, argparse uses comments).
      // `isExtra` is the grammar's own answer to "is this syntactically
      // incidental", which beats maintaining a blacklist of node types.
      if (arg.isExtra) {
        continue;
      }
      if (arg.type === 'keyword_argument') {
        summary.keywordArgCount += 1;
        summary.keywordNames.push(arg.childForFieldName('name')?.text ?? '');
        continue;
      }
      if (arg.type === 'list_splat') {
        summary.hasStarArgs = true;
        continue;
      }
      if (arg.type === 'dictionary_splat') {
        summary.hasDoubleStarArgs = true;
        continue;
      }
      summary.positionalArgCount += 1;
    }
    return summary;
  }

  /**
   * Classifies the receiver by its **syntactic shape**, which is all that is
   * honestly knowable about a duck-typed receiver.
   *
   * `self` is recognised by comparing against the enclosing method's actual
   * first parameter name rather than the literal string `self`, because the name
   * is a convention: a method whose receiver is named `s` still has a receiver.
   */
  private classifyReceiver(
    fn: Parser.SyntaxNode | null,
    pending: PendingExpression
  ): { kind: PythonReceiverKind; text: string; node: Parser.SyntaxNode | null } {
    if (!fn) {
      return { kind: PythonReceiverKind.UNKNOWN, text: '', node: null };
    }
    if (fn.type !== 'attribute') {
      return { kind: PythonReceiverKind.NONE, text: '', node: null };
    }
    let object = fn.childForFieldName('object');
    if (!object) {
      return { kind: PythonReceiverKind.UNKNOWN, text: '', node: null };
    }
    const text = EntityUtils.normalizeWhitespace(object.text);
    // A parenthesised receiver is the same receiver. Multi-line string
    // construction makes this common: `("a" "b").format(x)`.
    while (object.type === 'parenthesized_expression') {
      const inner = object.namedChild(0);
      if (!inner) {
        break;
      }
      object = inner;
    }

    switch (object.type) {
      case 'identifier': {
        if (pending.receiverName !== '' && object.text === pending.receiverName) {
          return {
            kind: pending.receiverIsClass ? PythonReceiverKind.CLS : PythonReceiverKind.SELF,
            text,
            node: object,
          };
        }
        return { kind: PythonReceiverKind.NAME, text, node: object };
      }
      case 'attribute': {
        return { kind: PythonReceiverKind.ATTRIBUTE, text, node: object };
      }
      case 'call': {
        // `super()` is a call result, but a special one: it is an MRO-ordered
        // lookup sliced after the enclosing class, not virtual dispatch.
        const inner = object.childForFieldName('function');
        if (inner?.text === 'super') {
          return { kind: PythonReceiverKind.SUPER, text, node: object };
        }
        return { kind: PythonReceiverKind.CALL_RESULT, text, node: object };
      }
      case 'subscript': {
        return { kind: PythonReceiverKind.SUBSCRIPT, text, node: object };
      }
      case 'string':
      case 'concatenated_string':
      case 'integer':
      case 'float':
      case 'true':
      case 'false':
      case 'none':
      case 'list':
      case 'dictionary':
      case 'set':
      case 'tuple': {
        return { kind: PythonReceiverKind.LITERAL, text, node: object };
      }
      default: {
        return { kind: PythonReceiverKind.UNKNOWN, text, node: object };
      }
    }
  }

  private callKindOf(
    fn: Parser.SyntaxNode | null,
    receiverKind: PythonReceiverKind,
    pending: PendingExpression
  ): PythonCallKind {
    if (pending.rootContext === PythonRootContext.DECORATOR) {
      return PythonCallKind.DECORATOR_CALL;
    }
    switch (receiverKind) {
      case PythonReceiverKind.SUPER: {
        return PythonCallKind.SUPER_CALL;
      }
      case PythonReceiverKind.SELF: {
        return PythonCallKind.SELF_CALL;
      }
      case PythonReceiverKind.CLS: {
        return PythonCallKind.CLS_CALL;
      }
      case PythonReceiverKind.CALL_RESULT: {
        return PythonCallKind.CHAINED_CALL;
      }
      case PythonReceiverKind.SUBSCRIPT: {
        return PythonCallKind.SUBSCRIPT_CALL;
      }
      case PythonReceiverKind.ATTRIBUTE:
      case PythonReceiverKind.NAME:
      case PythonReceiverKind.LITERAL: {
        return PythonCallKind.METHOD_CALL;
      }
      case PythonReceiverKind.NONE: {
        if (fn?.type === 'identifier') {
          return PythonCallKind.SIMPLE_CALL;
        }
        return PythonCallKind.DYNAMIC_CALL;
      }
      default: {
        return PythonCallKind.UNKNOWN_CALLEE_CALL;
      }
    }
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Maps a tree-sitter node type to an expression kind, or `null` for a node
   * that produces no row of its own.
   *
   * **This function is pure.** It must never enqueue work, and the rule is worth
   * stating because breaking it fails silently: an earlier version enqueued the
   * inner node for an annotation wrapper *and* returned `null`, so the
   * transparent fallback enqueued it a second time and every annotation
   * sub-expression was emitted twice with an identical primary key. Classify
   * here; enqueue in `enqueueChildren` and the fallback, nowhere else.
   */
  private expressionKindOf(
    node: Parser.SyntaxNode,
    pending: PendingExpression
  ): PythonExpressionKind | null {
    switch (node.type) {
      case 'call': {
        return PythonExpressionKind.CALL;
      }
      case 'attribute': {
        return PythonExpressionKind.ATTRIBUTE_ACCESS;
      }
      case 'subscript':
      // A subscripted annotation is spelled `generic_type` by this grammar, but
      // it is the same construct as `d[k]` and must produce the same shape.
      // Falling through to the transparent fallback flattened
      // `Optional[Dict[str, int]]` into four siblings all at depth 0 — and
      // `depth` is a frozen spine column that `type-hierarchy.dl` filters on to
      // find the OUTERMOST type reference.
      case 'generic_type': {
        return PythonExpressionKind.SUBSCRIPT;
      }
      case 'slice': {
        return PythonExpressionKind.SLICE;
      }
      case 'identifier': {
        if (pending.receiverName !== '' && node.text === pending.receiverName) {
          return pending.receiverIsClass
            ? PythonExpressionKind.CLS_REFERENCE
            : PythonExpressionKind.SELF_REFERENCE;
        }
        return PythonExpressionKind.NAME_REFERENCE;
      }
      case 'string':
      case 'concatenated_string': {
        return this.isFormatString(node)
          ? PythonExpressionKind.FSTRING
          : PythonExpressionKind.LITERAL;
      }
      case 'interpolation': {
        return PythonExpressionKind.FSTRING_INTERPOLATION;
      }
      case 'integer':
      case 'float':
      case 'true':
      case 'false':
      case 'none': {
        return PythonExpressionKind.LITERAL;
      }
      case 'ellipsis': {
        return PythonExpressionKind.ELLIPSIS;
      }
      case 'tuple':
      case 'pattern_list': {
        return PythonExpressionKind.TUPLE;
      }
      case 'list': {
        return PythonExpressionKind.LIST;
      }
      case 'set': {
        return PythonExpressionKind.SET;
      }
      case 'dictionary': {
        return PythonExpressionKind.DICT;
      }
      case 'list_comprehension': {
        return PythonExpressionKind.LIST_COMPREHENSION;
      }
      case 'set_comprehension': {
        return PythonExpressionKind.SET_COMPREHENSION;
      }
      case 'dictionary_comprehension': {
        return PythonExpressionKind.DICT_COMPREHENSION;
      }
      case 'generator_expression': {
        return PythonExpressionKind.GENERATOR_EXPRESSION;
      }
      case 'lambda': {
        return PythonExpressionKind.LAMBDA;
      }
      case 'conditional_expression': {
        return PythonExpressionKind.CONDITIONAL_EXPRESSION;
      }
      case 'binary_operator': {
        return PythonExpressionKind.BINARY_OPERATION;
      }
      case 'unary_operator':
      case 'not_operator': {
        return PythonExpressionKind.UNARY_OPERATION;
      }
      case 'boolean_operator': {
        return PythonExpressionKind.BOOLEAN_OPERATION;
      }
      case 'comparison_operator': {
        return PythonExpressionKind.COMPARISON;
      }
      case 'named_expression': {
        return PythonExpressionKind.ASSIGNMENT_EXPRESSION;
      }
      case 'list_splat':
      case 'list_splat_pattern': {
        return PythonExpressionKind.STARRED;
      }
      case 'dictionary_splat':
      case 'dictionary_splat_pattern': {
        return PythonExpressionKind.DOUBLE_STARRED;
      }
      case 'await': {
        return PythonExpressionKind.AWAIT;
      }
      case 'yield': {
        return this.isYieldFrom(node)
          ? PythonExpressionKind.YIELD_FROM
          : PythonExpressionKind.YIELD;
      }
      case 'assignment': {
        return PythonExpressionKind.ASSIGNMENT;
      }
      case 'augmented_assignment': {
        return PythonExpressionKind.AUGMENTED_ASSIGNMENT;
      }
      case 'case_pattern': {
        return PythonExpressionKind.MATCH_PATTERN;
      }
      default: {
        // Including `type`, `generic_type` and `type_parameter`: annotation
        // wrappers with no expression of their own, handled by the transparent
        // fallback in emitExpression.
        return null;
      }
    }
  }

  /**
   * Kinds with no sub-expressions worth emitting.
   *
   * An **implicitly concatenated** string is the exception, and it is a trap:
   *
   * ```python
   * raise TypeError(f'{type(self).__name__}() is deprecated '
   *                 'and will be removed')
   * ```
   *
   * That is one `concatenated_string` whose parts include an f-string, so
   * treating it as a plain literal leaf silently discards the `type(self)` call
   * inside it. Implicit concatenation across lines is extremely common in
   * error-message construction, so this is not a corner case.
   */
  private isLeafKind(kind: PythonExpressionKind, node: Parser.SyntaxNode): boolean {
    if (node.type === 'concatenated_string') {
      return false;
    }
    return (
      kind === PythonExpressionKind.NAME_REFERENCE ||
      kind === PythonExpressionKind.SELF_REFERENCE ||
      kind === PythonExpressionKind.CLS_REFERENCE ||
      kind === PythonExpressionKind.LITERAL ||
      kind === PythonExpressionKind.ELLIPSIS
    );
  }

  /**
   * Token-ish nodes that cannot contain an expression.
   *
   * Grammar extras (comments, line continuations) are handled by `isExtra` at
   * the enqueue sites; this covers string internals, which are named children
   * of a literal but are not expressions.
   */
  private isLeafToken(node: Parser.SyntaxNode): boolean {
    if (node.isExtra) {
      return true;
    }
    switch (node.type) {
      case 'string_start':
      case 'string_content':
      case 'string_end':
      case 'escape_sequence':
      case 'type_conversion':
      case 'positional_separator':
      case 'keyword_separator': {
        return true;
      }
      default: {
        return false;
      }
    }
  }

  /**
   * Whether a string node is an f-string, looking through implicit
   * concatenation: `'a' f'{b}'` is one concatenated_string and IS formatted.
   */
  private isFormatString(node: Parser.SyntaxNode): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type === 'interpolation') {
        return true;
      }
      if (child?.type === 'string' && this.isFormatString(child)) {
        return true;
      }
    }
    const start = node.child(0);
    return start?.type === 'string_start' && /^[a-zA-Z]*f/i.test(start.text);
  }

  private isYieldFrom(node: Parser.SyntaxNode): boolean {
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i)?.type === 'from') {
        return true;
      }
    }
    return false;
  }

  private literalTypeOf(node: Parser.SyntaxNode): PythonLiteralType {
    switch (node.type) {
      case 'integer': {
        return PythonLiteralType.INTEGER;
      }
      case 'float': {
        return PythonLiteralType.FLOAT;
      }
      case 'true':
      case 'false': {
        return PythonLiteralType.BOOLEAN;
      }
      case 'none': {
        return PythonLiteralType.NONE;
      }
      case 'ellipsis': {
        return PythonLiteralType.ELLIPSIS;
      }
      default: {
        const start = node.child(0);
        const prefix = start?.type === 'string_start' ? start.text.toLowerCase() : '';
        if (prefix.includes('b')) {
          return PythonLiteralType.BYTES;
        }
        if (prefix.includes('r')) {
          return PythonLiteralType.RAW_STRING;
        }
        return PythonLiteralType.STRING;
      }
    }
  }

  private literalTextOf(node: Parser.SyntaxNode): string {
    if (node.type !== 'string' && node.type !== 'concatenated_string') {
      return node.text;
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const part = node.namedChild(i);
      if (part?.type === 'string_content') {
        return EntityUtils.normalizeWhitespace(part.text);
      }
    }
    return '';
  }

  private binaryOperatorOf(node: Parser.SyntaxNode): string {
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    const parts: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child || child.isNamed) {
        continue;
      }
      if (child.id === left?.id || child.id === right?.id) {
        continue;
      }
      parts.push(child.text);
    }
    if (parts.length > 0) {
      return parts.join(' ');
    }
    // `is not` and `not in` are two tokens; collect any operator keywords.
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && !child.isNamed) {
        parts.push(child.text);
      }
    }
    return parts.join(' ');
  }

  private comprehensionKindOf(node: Parser.SyntaxNode): PythonComprehensionKind {
    const isAsync = this.hasAsyncClause(node);
    switch (node.type) {
      case 'set_comprehension': {
        return isAsync ? PythonComprehensionKind.ASYNC_SET : PythonComprehensionKind.SET;
      }
      case 'dictionary_comprehension': {
        return isAsync ? PythonComprehensionKind.ASYNC_DICT : PythonComprehensionKind.DICT;
      }
      case 'generator_expression': {
        return isAsync
          ? PythonComprehensionKind.ASYNC_GENERATOR
          : PythonComprehensionKind.GENERATOR;
      }
      default: {
        return isAsync ? PythonComprehensionKind.ASYNC_LIST : PythonComprehensionKind.LIST;
      }
    }
  }

  private hasAsyncClause(node: Parser.SyntaxNode): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const clause = node.namedChild(i);
      if (clause?.type !== 'for_in_clause') {
        continue;
      }
      for (let j = 0; j < clause.childCount; j++) {
        if (clause.child(j)?.type === 'async') {
          return true;
        }
      }
    }
    return false;
  }

  private referencedEntityKindOf(
    name: string,
    kind: PythonExpressionKind
  ): PythonReferencedEntityKind {
    if (kind === PythonExpressionKind.SELF_REFERENCE) {
      return PythonReferencedEntityKind.SELF;
    }
    if (kind === PythonExpressionKind.CLS_REFERENCE) {
      return PythonReferencedEntityKind.CLS;
    }
    if (name === 'super') {
      return PythonReferencedEntityKind.SUPER;
    }
    // Anything more specific requires the binding table, which the engine joins
    // through `bindingLinkHash`. Claiming a kind here would be a guess.
    return PythonReferencedEntityKind.UNKNOWN;
  }

  /**
   * The callee's simple name, or `''` when the callee has no name.
   *
   * A call whose callee is itself a call or a subscript has **no callee name**,
   * and saying otherwise is actively misleading:
   *
   * ```python
   * functools.wraps(f)(g)   # calls the RESULT of wraps(f), not wraps
   * handlers[key](event)    # calls whatever the dict holds
   * ```
   *
   * Returning `wraps` for the first would let a rule conclude that `wraps` is
   * the target, when the target is its return value. `''` plus
   * `callKind=CHAINED_CALL`/`SUBSCRIPT_CALL` is the honest description, and it
   * is what CPython's own `ast` view reports.
   */
  private calleeNameOf(fn: Parser.SyntaxNode): string {
    switch (fn.type) {
      case 'identifier': {
        return fn.text;
      }
      case 'attribute': {
        return fn.childForFieldName('attribute')?.text ?? '';
      }
      default: {
        return '';
      }
    }
  }

  /** The full written path of an attribute chain, or `''` if not name-shaped. */
  private dottedPathOf(node: Parser.SyntaxNode): string {
    if (node.type === 'identifier') {
      return node.text;
    }
    if (node.type === 'attribute') {
      const object = node.childForFieldName('object');
      const attribute = node.childForFieldName('attribute')?.text ?? '';
      if (!object) {
        return attribute;
      }
      const prefix = this.dottedPathOf(object);
      return prefix === '' ? attribute : `${prefix}.${attribute}`;
    }
    return '';
  }
}
