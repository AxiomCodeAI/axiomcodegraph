import Parser from 'tree-sitter';

import { PyBlockRegistry, PyMethodRegistry, PyModuleRegistry, PyTypeRegistry } from '@/analysis-types/python';
import { PythonBlockKind } from '@/enums/python/blocks';
import { PythonSourcePositions } from '@/utils/python/python-position-utils';

/** Everything the block stage produces for one module. */
export interface PythonBlockExtraction {
  blocks: PyBlockRegistry[];
  /** `py_block` PK -> the condition expression's `startIndex:endIndex`. */
  conditionRangeByBlock: Map<string, string>;
}

export interface PythonBlockInput {
  module: PyModuleRegistry;
  rootNode: Parser.SyntaxNode;
  filePath: string;
  serviceVersionLinkHash: string;
  types: PyTypeRegistry[];
  methods: PyMethodRegistry[];
  typeHashByNodeId: Map<number, string>;
  methodHashByNodeId: Map<number, string>;
  classInitHashByNodeId: Map<number, string>;
  scopeHashByNodeId: Map<number, string>;
  moduleMethodHash: string;
  positions: PythonSourcePositions;
}

/** Lexical state threaded through the walk. */
interface BlockContext {
  methodOwnerHash: string;
  pyTypeLinkHash: string;
  ownerTypeName: string;
  ownerQualifiedName: string;
  ownerMethodName: string;
  scopeHash: string;
  parentHash: string;
  depth: number;
  isModuleLevel: boolean;
}

/**
 * Extracts `py_block` — the control-flow structure the engine needs for
 * reachability and narrowing.
 *
 * Containment is by SPAN, not by a foreign key on every expression. That is how
 * `java_block` works and the reason is the same: an expression is inside a block
 * when its span is, and putting a block FK on the largest relation in the schema
 * would cost a column per row to encode what the positions already state.
 *
 * The link that DOES exist runs the other way — `conditionExpressionLinkHash`
 * points from the block at its test — because the test is one expression per
 * block rather than one per row, and because narrowing is the thing this relation
 * exists to enable:
 *
 * ```python
 * if isinstance(x, Foo):
 *     x.method()          # x is a Foo here and nowhere else
 * ```
 *
 * Python-specific care, each verified against the grammar rather than assumed:
 *
 * - `elif` is its OWN kind, not a nested `if`. tree-sitter models it as an
 *   `elif_clause` sibling, matching CPython's grammar, and flattening it into a
 *   nested `if` would inflate `nestingDepth` for every chain.
 * - an `except`/`else`/`finally` carries `tryStatementHash` back to its `try`,
 *   because a handler is meaningless without knowing what it guards.
 * - `if TYPE_CHECKING:` is flagged: its imports exist for a type checker and
 *   never execute, so a rule treating them as runtime imports is wrong about
 *   every one of them.
 */
export class PythonBlockExtractor {
  private input!: PythonBlockInput;
  private blocks: PyBlockRegistry[] = [];
  private conditionRangeByBlock = new Map<string, string>();
  private order = 0;

  extract(input: PythonBlockInput): PythonBlockExtraction {
    this.input = input;
    this.blocks = [];
    this.conditionRangeByBlock = new Map();
    this.order = 0;

    const moduleBlock = this.emit(
      input.rootNode,
      PythonBlockKind.MODULE_BODY,
      {
        methodOwnerHash: input.moduleMethodHash,
        pyTypeLinkHash: '',
        ownerTypeName: '',
        ownerQualifiedName: input.module.getQualifiedName(),
        ownerMethodName: '<module>',
        scopeHash: input.scopeHashByNodeId.get(input.rootNode.id) ?? '',
        parentHash: input.module.getHash(),
        depth: 0,
        isModuleLevel: true,
      },
      null
    );

    this.walk(input.rootNode, {
      methodOwnerHash: input.moduleMethodHash,
      pyTypeLinkHash: '',
      ownerTypeName: '',
      ownerQualifiedName: input.module.getQualifiedName(),
      ownerMethodName: '<module>',
      scopeHash: input.scopeHashByNodeId.get(input.rootNode.id) ?? '',
      parentHash: moduleBlock.getHash(),
      depth: 1,
      isModuleLevel: true,
    });

    return { blocks: this.blocks, conditionRangeByBlock: this.conditionRangeByBlock };
  }

  private walk(node: Parser.SyntaxNode, context: BlockContext): void {
    for (let index = 0; index < node.namedChildCount; index += 1) {
      const child = node.namedChild(index);
      if (!child || child.isExtra) {
        continue;
      }
      this.visit(child, context);
    }
  }

  private visit(node: Parser.SyntaxNode, context: BlockContext): void {
    switch (node.type) {
      case 'class_definition': {
        this.visitClass(node, context);
        return;
      }
      case 'function_definition': {
        this.visitFunction(node, context);
        return;
      }
      case 'decorated_definition': {
        const definition = node.childForFieldName('definition');
        if (definition) {
          this.visit(definition, context);
        }
        return;
      }
      case 'if_statement': {
        this.visitIf(node, context);
        return;
      }
      case 'while_statement': {
        this.visitLoop(node, context, PythonBlockKind.WHILE, true);
        return;
      }
      case 'for_statement': {
        this.visitLoop(
          node,
          context,
          this.isAsync(node) ? PythonBlockKind.ASYNC_FOR : PythonBlockKind.FOR,
          false
        );
        return;
      }
      case 'with_statement': {
        this.visitWith(node, context);
        return;
      }
      case 'try_statement': {
        this.visitTry(node, context);
        return;
      }
      case 'match_statement': {
        this.visitMatch(node, context);
        return;
      }
      default: {
        // Any other statement can still CONTAIN a block, so the walk continues
        // rather than stopping at nodes this switch does not name.
        this.walk(node, context);
      }
    }
  }

  private visitClass(node: Parser.SyntaxNode, context: BlockContext): void {
    const body = node.childForFieldName('body');
    if (!body) {
      return;
    }
    const typeHash = this.input.typeHashByNodeId.get(node.id) ?? '';
    const type = this.input.types.find(candidate => candidate.getHash() === typeHash);
    const inner: BlockContext = {
      ...context,
      pyTypeLinkHash: typeHash,
      ownerTypeName: type?.getName() ?? '',
      ownerQualifiedName: type?.getQualifiedName() ?? context.ownerQualifiedName,
      ownerMethodName: '<classbody>',
      methodOwnerHash: this.input.classInitHashByNodeId.get(node.id) ?? context.methodOwnerHash,
      scopeHash: this.input.scopeHashByNodeId.get(node.id) ?? context.scopeHash,
      isModuleLevel: false,
    };
    const block = this.emit(body, PythonBlockKind.CLASS_BODY, inner, null);
    this.walk(body, { ...inner, parentHash: block.getHash(), depth: inner.depth + 1 });
  }

  private visitFunction(node: Parser.SyntaxNode, context: BlockContext): void {
    const body = node.childForFieldName('body');
    if (!body) {
      return;
    }
    const methodHash = this.input.methodHashByNodeId.get(node.id) ?? context.methodOwnerHash;
    const method = this.input.methods.find(candidate => candidate.getHash() === methodHash);
    const inner: BlockContext = {
      ...context,
      methodOwnerHash: methodHash,
      ownerMethodName: method?.getName() ?? node.childForFieldName('name')?.text ?? '',
      scopeHash: this.input.scopeHashByNodeId.get(node.id) ?? context.scopeHash,
      isModuleLevel: false,
    };
    const block = this.emit(body, PythonBlockKind.FUNCTION_BODY, inner, null);
    this.walk(body, { ...inner, parentHash: block.getHash(), depth: inner.depth + 1 });
  }

  /**
   * `if` / `elif` / `else`.
   *
   * `elif` is emitted as its own block at the SAME depth as the `if`, because
   * that is what CPython's grammar and tree-sitter both model — an
   * `elif_clause` sibling, not a nested statement. Treating it as a nested `if`
   * would make a five-branch chain report depth five.
   */
  private visitIf(node: Parser.SyntaxNode, context: BlockContext): void {
    const condition = node.childForFieldName('condition');
    const consequence = node.childForFieldName('consequence');
    let hasElse = false;
    for (let index = 0; index < node.namedChildCount; index += 1) {
      if (node.namedChild(index)?.type === 'else_clause') {
        hasElse = true;
      }
    }
    if (consequence) {
      const block = this.emit(consequence, PythonBlockKind.IF, context, condition, hasElse);
      this.walk(consequence, {
        ...context,
        parentHash: block.getHash(),
        depth: context.depth + 1,
      });
    }
    for (let index = 0; index < node.namedChildCount; index += 1) {
      const clause = node.namedChild(index);
      if (!clause) {
        continue;
      }
      if (clause.type === 'elif_clause') {
        const elifCondition = clause.childForFieldName('condition');
        const elifBody = clause.childForFieldName('consequence');
        if (elifBody) {
          const block = this.emit(elifBody, PythonBlockKind.ELIF, context, elifCondition);
          this.walk(elifBody, {
            ...context,
            parentHash: block.getHash(),
            depth: context.depth + 1,
          });
        }
        continue;
      }
      if (clause.type === 'else_clause') {
        const elseBody = clause.childForFieldName('body') ?? clause.namedChild(0);
        if (elseBody) {
          const block = this.emit(elseBody, PythonBlockKind.ELSE, context, null);
          this.walk(elseBody, {
            ...context,
            parentHash: block.getHash(),
            depth: context.depth + 1,
          });
        }
      }
    }
  }

  private visitLoop(
    node: Parser.SyntaxNode,
    context: BlockContext,
    kind: PythonBlockKind,
    conditionIsTest: boolean
  ): void {
    const body = node.childForFieldName('body');
    const condition = conditionIsTest ? node.childForFieldName('condition') : null;
    let hasElse = false;
    for (let index = 0; index < node.namedChildCount; index += 1) {
      if (node.namedChild(index)?.type === 'else_clause') {
        hasElse = true;
      }
    }
    if (body) {
      const block = this.emit(body, kind, context, condition, hasElse);
      this.walk(body, { ...context, parentHash: block.getHash(), depth: context.depth + 1 });
    }
    for (let index = 0; index < node.namedChildCount; index += 1) {
      const clause = node.namedChild(index);
      if (clause?.type === 'else_clause') {
        const elseBody = clause.childForFieldName('body') ?? clause.namedChild(0);
        if (elseBody) {
          const block = this.emit(elseBody, PythonBlockKind.ELSE, context, null);
          this.walk(elseBody, {
            ...context,
            parentHash: block.getHash(),
            depth: context.depth + 1,
          });
        }
      }
    }
  }

  private visitWith(node: Parser.SyntaxNode, context: BlockContext): void {
    const body = node.childForFieldName('body');
    if (!body) {
      return;
    }
    const kind = this.isAsync(node) ? PythonBlockKind.ASYNC_WITH : PythonBlockKind.WITH;
    let resources = 0;
    for (let index = 0; index < node.namedChildCount; index += 1) {
      const clause = node.namedChild(index);
      if (clause?.type === 'with_clause') {
        for (let inner = 0; inner < clause.namedChildCount; inner += 1) {
          if (clause.namedChild(inner)?.type === 'with_item') {
            resources += 1;
          }
        }
      }
    }
    const block = this.emit(body, kind, context, null, false, resources);
    this.walk(body, { ...context, parentHash: block.getHash(), depth: context.depth + 1 });
  }

  /**
   * `try` with its handlers.
   *
   * Every handler, `else` and `finally` carries `tryStatementHash` back to the
   * `try` it belongs to. A handler read in isolation says nothing — what matters
   * is which body it guards.
   */
  private visitTry(node: Parser.SyntaxNode, context: BlockContext): void {
    const body = node.childForFieldName('body');
    if (!body) {
      return;
    }
    let hasElse = false;
    for (let index = 0; index < node.namedChildCount; index += 1) {
      if (node.namedChild(index)?.type === 'else_clause') {
        hasElse = true;
      }
    }
    const tryBlock = this.emit(body, PythonBlockKind.TRY, context, null, hasElse);
    this.walk(body, { ...context, parentHash: tryBlock.getHash(), depth: context.depth + 1 });

    for (let index = 0; index < node.namedChildCount; index += 1) {
      const clause = node.namedChild(index);
      if (!clause || clause.id === body.id) {
        continue;
      }
      const isExcept = clause.type === 'except_clause';
      const isExceptStar = clause.type === 'except_group_clause';
      const isFinally = clause.type === 'finally_clause';
      const isElse = clause.type === 'else_clause';
      if (!isExcept && !isExceptStar && !isFinally && !isElse) {
        continue;
      }
      const clauseBody = clause.childForFieldName('body') ?? this.lastBlockChild(clause);
      if (!clauseBody) {
        continue;
      }
      const kind = isExcept
        ? PythonBlockKind.EXCEPT
        : isExceptStar
          ? PythonBlockKind.EXCEPT_STAR
          : isFinally
            ? PythonBlockKind.FINALLY
            : PythonBlockKind.ELSE;
      const handler = this.handlerDetail(clause, isExcept || isExceptStar);
      const block = this.emit(
        clauseBody,
        kind,
        context,
        null,
        false,
        undefined,
        tryBlock.getHash(),
        handler
      );
      this.walk(clauseBody, {
        ...context,
        parentHash: block.getHash(),
        depth: context.depth + 1,
      });
    }
  }

  private visitMatch(node: Parser.SyntaxNode, context: BlockContext): void {
    const subject = node.childForFieldName('subject');
    const body = this.lastBlockChild(node);
    if (!body) {
      return;
    }
    const matchBlock = this.emit(body, PythonBlockKind.MATCH, context, subject);
    const inner = { ...context, parentHash: matchBlock.getHash(), depth: context.depth + 1 };
    for (let index = 0; index < body.namedChildCount; index += 1) {
      const clause = body.namedChild(index);
      if (clause?.type !== 'case_clause') {
        if (clause) {
          this.visit(clause, inner);
        }
        continue;
      }
      const caseBody = this.lastBlockChild(clause);
      if (!caseBody) {
        continue;
      }
      const block = this.emit(caseBody, PythonBlockKind.CASE, inner, null);
      this.walk(caseBody, { ...inner, parentHash: block.getHash(), depth: inner.depth + 1 });
    }
  }

  /** `except ValueError as e` / `except (A, B)` / `except* X`. */
  private handlerDetail(
    clause: Parser.SyntaxNode,
    isExcept: boolean
  ): { types: string; target: string } | undefined {
    if (!isExcept) {
      return undefined;
    }
    const types: string[] = [];
    let target = '';
    for (let index = 0; index < clause.namedChildCount; index += 1) {
      const child = clause.namedChild(index);
      if (!child || child.type === 'block' || child.isExtra) {
        continue;
      }
      if (child.type === 'as_pattern') {
        const caught = child.namedChild(0);
        if (caught) {
          types.push(...this.exceptionNames(caught));
        }
        // The alias is a bare identifier, not an `as_pattern_target`.
        const alias = child.namedChild(child.namedChildCount - 1);
        if (alias && alias.id !== caught?.id) {
          target = alias.text.replace(/^as\s+/, '').trim();
        }
        continue;
      }
      types.push(...this.exceptionNames(child));
    }
    return { types: types.join(','), target };
  }

  /** A single caught type, or every member of a tuple form. */
  private exceptionNames(node: Parser.SyntaxNode): string[] {
    if (node.type === 'tuple' || node.type === 'expression_list') {
      const names: string[] = [];
      for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index);
        if (child && !child.isExtra) {
          names.push(child.text.trim());
        }
      }
      return names;
    }
    return [node.text.trim()];
  }

  private emit(
    body: Parser.SyntaxNode,
    kind: PythonBlockKind,
    context: BlockContext,
    condition: Parser.SyntaxNode | null,
    hasElseClause = false,
    resourceCount?: number,
    tryStatementHash?: string,
    handler?: { types: string; target: string }
  ): PyBlockRegistry {
    const conditionText = condition ? condition.text.replace(/\s+/g, ' ').trim() : '';
    const builder = PyBlockRegistry.builder(
      kind,
      this.input.filePath,
      body.startPosition.row + 1,
      this.input.positions.byteColumn(body.startPosition.row, body.startPosition.column),
      body.endPosition.row + 1,
      this.input.positions.byteColumn(body.endPosition.row, body.endPosition.column),
      context.methodOwnerHash,
      this.input.module.getHash(),
      this.input.serviceVersionLinkHash
    )
      .withOrder(this.order++, context.depth)
      .withOwner(
        context.pyTypeLinkHash,
        context.ownerTypeName,
        context.ownerQualifiedName,
        context.ownerMethodName
      )
      .withContainer(context.parentHash, context.scopeHash)
      .withCondition(conditionText, this.isTypeCheckingGuard(conditionText))
      .withFlags(hasElseClause, context.isModuleLevel);

    if (resourceCount !== undefined) {
      builder.withResourceCount(resourceCount);
    }
    if (tryStatementHash) {
      builder.withTryStatement(tryStatementHash);
    }
    if (handler) {
      builder.withHandler(handler.types, handler.target);
    }

    const block = builder.build();
    this.blocks.push(block);
    if (condition) {
      // A PARENTHESISED condition — `if (a and b):` — has no expression row of
      // its own, because parentheses are pure grouping and the expression stage
      // treats them as transparent, exactly as ast does. Joining on the outer
      // span therefore found nothing and left the FK empty on 73 blocks. Unwrap
      // to the node that actually carries a row.
      let joinable = condition;
      while (joinable.type === 'parenthesized_expression') {
        const inner = joinable.namedChild(0);
        if (!inner) {
          break;
        }
        joinable = inner;
      }
      this.conditionRangeByBlock.set(
        block.getHash(),
        `${joinable.startIndex}:${joinable.endIndex}`
      );
    }
    return block;
  }

  /**
   * `if TYPE_CHECKING:` and its `typing.TYPE_CHECKING` spelling.
   *
   * These blocks hold imports that a type checker sees and the runtime never
   * executes, so a rule treating them as runtime imports is wrong about all 338
   * of them in the measured corpus.
   */
  private isTypeCheckingGuard(conditionText: string): boolean {
    const normalized = conditionText.replace(/\s+/g, '');
    return normalized === 'TYPE_CHECKING' || normalized.endsWith('.TYPE_CHECKING');
  }

  private isAsync(node: Parser.SyntaxNode): boolean {
    const first = node.child(0);
    return first?.text === 'async';
  }

  private lastBlockChild(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    for (let index = node.namedChildCount - 1; index >= 0; index -= 1) {
      const child = node.namedChild(index);
      if (child?.type === 'block') {
        return child;
      }
    }
    return null;
  }
}
