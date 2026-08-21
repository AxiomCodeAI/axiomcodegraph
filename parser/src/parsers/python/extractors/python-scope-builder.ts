import Parser from 'tree-sitter';

import {
  PYTHON_LAMBDA_SCOPE_NAME,
  PYTHON_LOCALS_MARKER,
  PYTHON_MODULE_SCOPE_NAME,
  PYTHON_SYNTHETIC_ITERATOR,
} from '@/constants/python-constants';
import { PythonBindingOrigin } from '@/enums/python/bindings';
import { PythonNameContext } from '@/enums/python/expressions';
import { PythonScopeKind, SymbolBlockType } from '@/enums/python/scopes';
import {
  addSymbolFlags,
  createSymbolBlock,
  SymbolFlags,
} from '@/parsers/python/extractors/python-symbol-table';
import { SymbolBlock } from '@/types/python';

/** tree-sitter node types that introduce a new scope. Exactly eight forms. */
const SCOPE_NODE_TYPES: ReadonlySet<string> = new Set([
  'function_definition',
  'class_definition',
  'lambda',
  'list_comprehension',
  'set_comprehension',
  'dictionary_comprehension',
  'generator_expression',
]);

/** Comprehension forms, which all take the synthetic `.0` iterator parameter. */
const COMPREHENSION_NODE_TYPES: ReadonlySet<string> = new Set([
  'list_comprehension',
  'set_comprehension',
  'dictionary_comprehension',
  'generator_expression',
]);

/**
 * Builds the scope tree and every `(scope, name)` flag set — pass 1 of CPython's
 * two-pass symbol-table construction, over a tree-sitter tree.
 *
 * ## What makes this hard, and where the traps are
 *
 * **1. Some parts of a scope-introducing node are evaluated in the ENCLOSING
 * scope.** This is the single most common way a naive walker goes wrong, because
 * the resulting scope is a *sibling* rather than a child:
 *
 * ```python
 * def f(x=lambda: 1): ...        # the lambda is a child of f's PARENT
 * @deco(lambda: 1)               # likewise
 * def g(): ...
 * def h(x: C[lambda: 1]): ...    # likewise — annotations too
 * class K(Base(lambda: 1)): ...  # likewise — base expressions too
 * [y for y in <iterable>]        # the OUTERMOST iterable is evaluated outside
 * ```
 *
 * Defaults, decorators, annotations, return annotations, class bases and class
 * keywords are therefore visited in the current block, and only the body and
 * parameter *names* go into the child block.
 *
 * **2. A walrus inside a comprehension binds outside it.**
 *
 * ```python
 * filtered = [y for y in values if (last_seen := y) > 0]
 * ```
 *
 * `last_seen` is a local of the enclosing function, not of the listcomp — while
 * the listcomp records it as `DEF_LOCAL | DEF_NONLOCAL`, which pass 2 resolves
 * to `FREE`. Both halves are required; either alone gives the wrong answer.
 *
 * **3. Augmented assignment binds without referencing.** `x += 1` sets
 * `DEF_LOCAL` and **not** `USE`, so `is_referenced` stays false. Verified
 * against CPython rather than assumed.
 *
 * **4. A bare annotation still binds.** On the 3.10 target `x: int` with no
 * value sets `DEF_ANNOT | DEF_LOCAL`, so `is_assigned` is true. This differs
 * from what the syntax suggests and is exactly the kind of thing the oracle
 * settles.
 *
 * ## State discipline
 *
 * Nothing is ever stored on a tree-sitter node. node-tree-sitter hands out
 * transient wrappers whose cache evicts entries, so a property set in one
 * traversal is gone by the next and `.parent` walks return untagged objects —
 * silent at scale. All state lives in {@link SymbolBlock}, keyed by `node.id`.
 */
export class PythonScopeBuilder {
  private blocksByNodeId = new Map<number, SymbolBlock>();

  /**
   * The module block, kept so a `global` statement anywhere can reach it.
   */
  private moduleBlock: SymbolBlock | null = null;

  /**
   * Whether `from __future__ import annotations` (PEP 563) is in force.
   *
   * When it is, annotations are never evaluated, and CPython's symbol table does
   * **not** visit them — so a name used only in an annotation is not
   * `is_referenced`. Verified against CPython both ways: with the future import
   * a type used only in a signature loses its `referenced` predicate, without it
   * it keeps it. Getting this wrong misreports every `TYPE_CHECKING` import.
   */
  private futureAnnotations = false;

  /**
   * Builds the complete block tree for a module.
   *
   * @param rootNode the `module` node
   * @param moduleQualifiedName dotted module name, used as the root qualname
   * @param sourceLineCount total lines, for the module block's end position
   * @returns the module block, with children sorted into source order
   */
  build(
    rootNode: Parser.SyntaxNode,
    moduleQualifiedName: string,
    sourceLineCount: number,
    lastLineLength: number
  ): SymbolBlock {
    this.blocksByNodeId = new Map();
    this.futureAnnotations = this.hasFutureAnnotations(rootNode);

    const moduleBlock = createSymbolBlock({
      nodeId: rootNode.id,
      blockType: SymbolBlockType.MODULE,
      scopeKind: PythonScopeKind.MODULE,
      // symtable calls the module scope `top`, and the harness compares the name.
      name: PYTHON_MODULE_SCOPE_NAME,
      qualifiedName: moduleQualifiedName,
      parent: null,
      startLine: 0,
      startColumn: 0,
      endLine: sourceLineCount,
      endColumn: lastLineLength,
      nestingDepth: 0,
      privateNamePrefix: '',
    });
    this.blocksByNodeId.set(rootNode.id, moduleBlock);
    this.moduleBlock = moduleBlock;

    this.visitBody(moduleBlock, rootNode);
    this.finalizeOrdinals(moduleBlock);
    return moduleBlock;
  }

  /** Every block that was created, keyed by the id of its introducing node. */
  getBlocksByNodeId(): Map<number, SymbolBlock> {
    return this.blocksByNodeId;
  }

  // ------------------------------------------------------------------ blocks

  /**
   * Assigns `scopeOrdinal` in **evaluation order**, which is creation order here.
   *
   * This is emphatically *not* source order, and assuming it was is a mistake
   * that survives every small test and then disagrees with CPython on real code.
   * symtable orders a block's children by the order it *constructed* them, and
   * parts of a signature are evaluated before the function body exists:
   *
   * ```python
   * class SpecLoaderAdapter:
   *     def __init__(self, spec=lambda: 1): ...
   * #       ^ column 4                ^ column 37
   * ```
   *
   * The lambda is a *sibling* of `__init__` and is built **first** — ordinal 0
   * for the lambda, 1 for the method — even though the `def` starts earlier on
   * the line. Sorting by (line, column) inverts them.
   *
   * The traversal therefore visits each construct in exactly CPython's order
   * (defaults, then kw-defaults, then annotations, then decorators, then the
   * body) and this pass simply numbers what that produced.
   */
  private finalizeOrdinals(block: SymbolBlock): void {
    block.children.forEach((child, index) => {
      child.scopeOrdinal = index;
      this.finalizeOrdinals(child);
    });
  }

  private createChildBlock(
    parent: SymbolBlock,
    node: Parser.SyntaxNode,
    blockType: SymbolBlockType,
    scopeKind: PythonScopeKind,
    name: string
  ): SymbolBlock {
    const child = createSymbolBlock({
      nodeId: node.id,
      blockType,
      scopeKind,
      name,
      qualifiedName: this.buildQualifiedName(parent, name),
      parent,
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column,
      nestingDepth: parent.nestingDepth + 1,
      // A class body sets the mangling prefix for itself and everything nested
      // inside it; any other block simply inherits whatever was in force.
      privateNamePrefix:
        blockType === SymbolBlockType.CLASS
          ? this.manglePrefixFor(name)
          : parent.privateNamePrefix,
    });
    parent.children.push(child);
    this.blocksByNodeId.set(node.id, child);
    return child;
  }

  /**
   * CPython `__qualname__` semantics, including the `<locals>` marker.
   *
   * A function's nested entities live in its `<locals>`; a class's do not. So
   * `Outer.method.<locals>.inner` but `Outer.method`.
   */
  private buildQualifiedName(parent: SymbolBlock, name: string): string {
    const parentIsFunctionLike =
      parent.scopeKind === PythonScopeKind.FUNCTION ||
      parent.scopeKind === PythonScopeKind.LAMBDA ||
      parent.scopeKind === PythonScopeKind.COMPREHENSION_LIST ||
      parent.scopeKind === PythonScopeKind.COMPREHENSION_SET ||
      parent.scopeKind === PythonScopeKind.COMPREHENSION_DICT ||
      parent.scopeKind === PythonScopeKind.GENERATOR_EXPRESSION;

    return parentIsFunctionLike
      ? `${parent.qualifiedName}.${PYTHON_LOCALS_MARKER}.${name}`
      : `${parent.qualifiedName}.${name}`;
  }

  // ------------------------------------------------------------------ defs

  /**
   * CPython's `_Py_Mangle`, applied at the two choke points where a name enters
   * a symbol table.
   *
   * Inside a class, `__x` becomes `_ClassName__x`. The exact conditions matter,
   * and all three exclusions are real:
   *
   * ```python
   * class Outer:
   *     __secret        -> _Outer__secret    # mangled
   *     __init__        -> __init__          # NOT: ends with two underscores
   *     __one_trailing_ -> _Outer__one_trailing_   # IS: only one trailing
   *     _single         -> _single           # NOT: only one leading underscore
   *
   * class ___:          # a class name of only underscores mangles nothing
   * ```
   *
   * This is applied to bindings *and* references, and it reaches into every
   * nested scope, including comprehensions inside methods.
   */
  private mangleName(block: SymbolBlock, name: string): string {
    if (!block.privateNamePrefix) {
      return name;
    }
    if (!name.startsWith('__')) {
      return name;
    }
    if (name.endsWith('__')) {
      return name;
    }
    if (name.includes('.')) {
      return name;
    }
    return block.privateNamePrefix + name;
  }

  /**
   * The prefix a class contributes: `_` plus the class name with leading
   * underscores stripped. A name consisting only of underscores contributes
   * nothing, which disables mangling inside it entirely.
   */
  private manglePrefixFor(className: string): string {
    const stripped = className.replace(/^_+/, '');
    if (stripped.length === 0) {
      return '';
    }
    return `_${stripped}`;
  }

  private addDef(
    block: SymbolBlock,
    rawName: string,
    flags: number,
    origin: PythonBindingOrigin | null,
    node: Parser.SyntaxNode
  ): void {
    if (!rawName) {
      return;
    }
    const name = this.mangleName(block, rawName);
    addSymbolFlags(block, name, flags);

    // A `global` declaration in ANY block also marks the name global in the
    // module's own symbol table. CPython does this by writing through to
    // `st->st_global`, which is why a module-level `counter = 0` reports
    // is_declared_global=true when a nested function declares `global counter`.
    // Without this the module row silently disagrees with CPython.
    if ((flags & SymbolFlags.DEF_GLOBAL) !== 0 && this.moduleBlock !== null && block !== this.moduleBlock) {
      addSymbolFlags(this.moduleBlock, name, SymbolFlags.DEF_GLOBAL);
    }

    if (origin === null) {
      return;
    }
    const line = node.startPosition.row + 1;
    const existing = block.origins.get(name);
    if (existing) {
      existing.origins.add(origin);
      existing.firstLine = Math.min(existing.firstLine, line);
      existing.lastLine = Math.max(existing.lastLine, line);
      existing.bindingCount += 1;
      return;
    }
    block.origins.set(name, {
      origins: new Set([origin]),
      firstLine: line,
      lastLine: line,
      bindingCount: 1,
      declaredTypeName: '',
    });
  }

  private addUse(block: SymbolBlock, rawName: string): void {
    if (!rawName) {
      return;
    }
    const name = this.mangleName(block, rawName);
    addSymbolFlags(block, name, SymbolFlags.USE);

    // Reading the name `super` inside a function counts as a use of
    // `__class__`, because zero-argument `super()` needs the implicit class
    // cell. CPython special-cases exactly this, and without it every method
    // that calls `super()` is missing a `__class__` binding.
    if (
      rawName === 'super' &&
      block.blockType === SymbolBlockType.FUNCTION
    ) {
      addSymbolFlags(block, '__class__', SymbolFlags.USE);
    }
  }

  /** Detects `from __future__ import annotations` (PEP 563). */
  private hasFutureAnnotations(rootNode: Parser.SyntaxNode): boolean {
    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const child = rootNode.namedChild(i);
      if (child?.type !== 'future_import_statement') {
        continue;
      }
      for (let j = 0; j < child.namedChildCount; j++) {
        if (child.namedChild(j)?.text === 'annotations') {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Visits an annotation expression, unless PEP 563 is in force.
   *
   * Under `from __future__ import annotations` the annotation is never
   * evaluated, so CPython does not visit it and names appearing only there are
   * not referenced.
   */
  private visitAnnotation(block: SymbolBlock, node: Parser.SyntaxNode): void {
    if (this.futureAnnotations) {
      return;
    }
    this.visitExpression(block, node, PythonNameContext.LOAD);
  }

  // ------------------------------------------------------------------ walk

  /** Visits every statement in a block's body. */
  private visitBody(block: SymbolBlock, node: Parser.SyntaxNode): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) {
        this.visitStatement(block, child);
      }
    }
  }

  private visitStatement(block: SymbolBlock, node: Parser.SyntaxNode): void {
    switch (node.type) {
      case 'decorated_definition': {
        // Decorators are evaluated in the CURRENT scope, so a lambda inside one
        // is a sibling of the definition it wraps. They are NOT visited here,
        // though: CPython visits defaults and annotations BEFORE decorators, so
        // the decorator list is handed down and visited at the right point.
        // Emitting them here instead misorders scopeOrdinal on any decorated
        // function with a lambda in its signature.
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
        if (definition?.type === 'function_definition') {
          this.visitFunctionDefinition(block, definition, decorators);
          return;
        }
        if (definition?.type === 'class_definition') {
          this.visitClassDefinition(block, definition, decorators);
          return;
        }
        if (definition) {
          this.visitStatement(block, definition);
        }
        return;
      }

      case 'function_definition': {
        this.visitFunctionDefinition(block, node);
        return;
      }

      case 'class_definition': {
        this.visitClassDefinition(block, node);
        return;
      }

      case 'global_statement': {
        block.declaresGlobal = true;
        for (let i = 0; i < node.namedChildCount; i++) {
          const name = node.namedChild(i);
          if (name?.type === 'identifier') {
            this.addDef(
              block,
              name.text,
              SymbolFlags.DEF_GLOBAL,
              PythonBindingOrigin.GLOBAL_STMT,
              name
            );
          }
        }
        return;
      }

      case 'nonlocal_statement': {
        block.declaresNonlocal = true;
        for (let i = 0; i < node.namedChildCount; i++) {
          const name = node.namedChild(i);
          if (name?.type === 'identifier') {
            this.addDef(
              block,
              name.text,
              SymbolFlags.DEF_NONLOCAL,
              PythonBindingOrigin.NONLOCAL_STMT,
              name
            );
          }
        }
        return;
      }

      case 'import_statement':
      case 'import_from_statement':
      case 'future_import_statement': {
        // `from __future__ import annotations` is its own node type in this
        // grammar, NOT an import_from_statement. Missing it means `annotations`
        // is recorded as a read of an undefined name instead of an import
        // binding.
        this.visitImport(block, node);
        return;
      }

      case 'delete_statement': {
        for (let i = 0; i < node.namedChildCount; i++) {
          const target = node.namedChild(i);
          if (target) {
            this.visitTarget(block, target, PythonBindingOrigin.DEL, PythonNameContext.DEL);
          }
        }
        return;
      }

      case 'for_statement': {
        this.visitForStatement(block, node);
        return;
      }

      case 'with_statement': {
        this.visitWithStatement(block, node);
        return;
      }

      case 'try_statement': {
        this.visitTryStatement(block, node);
        return;
      }

      case 'if_statement':
      case 'while_statement':
      case 'match_statement':
      case 'block':
      case 'expression_statement':
      case 'return_statement':
      case 'raise_statement':
      case 'assert_statement':
      case 'elif_clause':
      case 'else_clause':
      case 'finally_clause':
      case 'case_clause':
      case 'try_clause':
      case 'with_clause':
      case 'print_statement':
      case 'exec_statement':
      default: {
        this.visitGenericStatement(block, node);
        return;
      }
    }
  }

  /**
   * Statements with no binding rules of their own: recurse into children,
   * dispatching each to the statement or expression visitor as appropriate.
   *
   * Every branch is braced. In dispatch-heavy code a dangling `else` is nearly
   * invisible when read and silently doubles or drops output.
   */
  private visitGenericStatement(block: SymbolBlock, node: Parser.SyntaxNode): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) {
        continue;
      }
      if (child.type === 'except_clause' || child.type === 'except_group_clause') {
        this.visitExceptClause(block, child);
        continue;
      }
      if (child.type === 'case_pattern') {
        this.visitCasePattern(block, child);
        continue;
      }
      if (this.isStatementLike(child)) {
        this.visitStatement(block, child);
        continue;
      }
      this.visitExpression(block, child, PythonNameContext.LOAD);
    }
  }

  private isStatementLike(node: Parser.SyntaxNode): boolean {
    return (
      node.type.endsWith('_statement') ||
      node.type.endsWith('_clause') ||
      node.type === 'block' ||
      node.type === 'decorated_definition'
    );
  }

  // -------------------------------------------------------------- functions

  /**
   * A `def` / `async def`, in CPython's exact visit order.
   *
   * The order is the specification, because it determines `scopeOrdinal` for
   * every scope hidden in the signature. `symtable.c` does:
   *
   * ```
   * add the function's own name
   * defaults          (positional and positional-or-keyword)
   * kw_defaults       (keyword-only)
   * annotations       (posonly, args, vararg, kwarg, kwonly, THEN returns)
   * decorators
   * enter block -> parameters, then body
   * ```
   *
   * Two details are counter-intuitive and taken straight from CPython:
   * decorators come **after** annotations, and the `*args` / `**kwargs`
   * annotations are visited **before** the keyword-only ones.
   */
  private visitFunctionDefinition(
    block: SymbolBlock,
    node: Parser.SyntaxNode,
    decorators: Parser.SyntaxNode[] = []
  ): void {
    const nameNode = node.childForFieldName('name');
    const parametersNode = node.childForFieldName('parameters');
    const returnTypeNode = node.childForFieldName('return_type');
    const bodyNode = node.childForFieldName('body');
    const functionName = nameNode?.text ?? '';

    // The def binds its own name in the enclosing scope.
    this.addDef(
      block,
      functionName,
      SymbolFlags.DEF_LOCAL,
      PythonBindingOrigin.FUNCTION_DEF,
      nameNode ?? node
    );

    // Defaults, annotations and decorators are all evaluated in the ENCLOSING
    // scope, so any scope they contain is a sibling of this function.
    if (parametersNode) {
      this.visitParameterDefaults(block, parametersNode);
      this.visitParameterAnnotations(block, parametersNode);
    }
    if (returnTypeNode) {
      this.visitAnnotation(block, returnTypeNode);
    }
    for (const decorator of decorators) {
      this.visitExpressionChildren(block, decorator, PythonNameContext.LOAD);
    }

    const child = this.createChildBlock(
      block,
      node,
      SymbolBlockType.FUNCTION,
      PythonScopeKind.FUNCTION,
      functionName
    );
    child.isCoroutine = this.hasAsyncPrefix(node);

    if (parametersNode) {
      this.visitParameterNames(child, parametersNode, PythonBindingOrigin.PARAMETER);
    }
    if (bodyNode) {
      this.visitBody(child, bodyNode);
      child.isGenerator = this.containsYield(bodyNode);
    }
  }

  /**
   * A `class` statement, in CPython's exact visit order: bases, then keyword
   * arguments such as `metaclass=`, then decorators, then the body.
   */
  private visitClassDefinition(
    block: SymbolBlock,
    node: Parser.SyntaxNode,
    decorators: Parser.SyntaxNode[] = []
  ): void {
    const nameNode = node.childForFieldName('name');
    const argumentsNode = node.childForFieldName('superclasses');
    const bodyNode = node.childForFieldName('body');
    const className = nameNode?.text ?? '';

    this.addDef(
      block,
      className,
      SymbolFlags.DEF_LOCAL,
      PythonBindingOrigin.CLASS_DEF,
      nameNode ?? node
    );

    // Bases and keyword arguments are evaluated in the enclosing scope — the
    // class body does not exist yet when they run.
    if (argumentsNode) {
      this.visitExpressionChildren(block, argumentsNode, PythonNameContext.LOAD);
    }
    for (const decorator of decorators) {
      this.visitExpressionChildren(block, decorator, PythonNameContext.LOAD);
    }

    const child = this.createChildBlock(
      block,
      node,
      SymbolBlockType.CLASS,
      PythonScopeKind.CLASS,
      className
    );
    if (bodyNode) {
      this.visitBody(child, bodyNode);
    }
  }

  private hasAsyncPrefix(node: Parser.SyntaxNode): boolean {
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i)?.type === 'async') {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether a body contains `yield` without crossing into a nested scope.
   *
   * A `yield` inside a nested `def` belongs to that def, not to this one, so the
   * walk stops at every scope boundary.
   */
  private containsYield(bodyNode: Parser.SyntaxNode): boolean {
    const worklist: Parser.SyntaxNode[] = [bodyNode];
    while (worklist.length > 0) {
      const node = worklist.pop();
      if (!node) {
        continue;
      }
      if (node.type === 'yield') {
        return true;
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        // Lambdas and comprehensions can legally contain a yield that belongs
        // to the enclosing function, but a nested def owns its own.
        if (child && child.type !== 'function_definition' && child.type !== 'class_definition') {
          worklist.push(child);
        }
      }
    }
    return false;
  }

  // ------------------------------------------------------------- parameters

  /**
   * Pass one over a parameter list: **default values only**, in source order.
   *
   * Defaults are evaluated once, at definition time, in the enclosing scope —
   * which is what makes a mutable default shared across calls, and what makes a
   * lambda in a default a sibling scope.
   */
  private visitParameterDefaults(
    block: SymbolBlock,
    parametersNode: Parser.SyntaxNode
  ): void {
    for (let i = 0; i < parametersNode.namedChildCount; i++) {
      const param = parametersNode.namedChild(i);
      if (!param) {
        continue;
      }
      if (param.type !== 'default_parameter' && param.type !== 'typed_default_parameter') {
        continue;
      }
      const valueNode = param.childForFieldName('value');
      if (valueNode) {
        this.visitExpression(block, valueNode, PythonNameContext.LOAD);
      }
    }
  }

  /**
   * Pass two: **annotations only**, in CPython's order.
   *
   * CPython visits positional-only, then positional-or-keyword, then the
   * `*args` annotation, then the `**kwargs` annotation, and only then the
   * keyword-only annotations. That ordering is observable through
   * `scopeOrdinal` whenever an annotation contains a lambda, so it is
   * reproduced rather than approximated.
   */
  private visitParameterAnnotations(
    block: SymbolBlock,
    parametersNode: Parser.SyntaxNode
  ): void {
    const positional: Parser.SyntaxNode[] = [];
    const splats: Parser.SyntaxNode[] = [];
    const keywordOnly: Parser.SyntaxNode[] = [];
    let seenKeywordSeparator = false;

    for (let i = 0; i < parametersNode.namedChildCount; i++) {
      const param = parametersNode.namedChild(i);
      if (!param) {
        continue;
      }
      if (param.type === 'keyword_separator') {
        seenKeywordSeparator = true;
        continue;
      }
      if (param.type === 'list_splat_pattern') {
        // A bare `*args` also opens the keyword-only section.
        seenKeywordSeparator = true;
        continue;
      }
      const typeNode = param.childForFieldName('type');
      if (!typeNode) {
        continue;
      }
      if (this.isSplatParameter(param)) {
        splats.push(typeNode);
        // An annotated `*args` opens the keyword-only section too.
        if (this.splatKind(param) === 'list') {
          seenKeywordSeparator = true;
        }
        continue;
      }
      if (seenKeywordSeparator) {
        keywordOnly.push(typeNode);
        continue;
      }
      positional.push(typeNode);
    }

    for (const annotation of [...positional, ...splats, ...keywordOnly]) {
      this.visitAnnotation(block, annotation);
    }
  }

  /** Whether a `typed_parameter` wraps a `*args` / `**kwargs` splat. */
  private isSplatParameter(param: Parser.SyntaxNode): boolean {
    return this.splatKind(param) !== null;
  }

  private splatKind(param: Parser.SyntaxNode): 'list' | 'dictionary' | null {
    for (let i = 0; i < param.namedChildCount; i++) {
      const child = param.namedChild(i);
      if (child?.type === 'list_splat_pattern') {
        return 'list';
      }
      if (child?.type === 'dictionary_splat_pattern') {
        return 'dictionary';
      }
    }
    return null;
  }

  /** Binds the parameter *names* in the function's own scope. */
  private visitParameterNames(
    block: SymbolBlock,
    parametersNode: Parser.SyntaxNode,
    origin: PythonBindingOrigin
  ): void {
    for (let i = 0; i < parametersNode.namedChildCount; i++) {
      const param = parametersNode.namedChild(i);
      if (!param) {
        continue;
      }
      this.bindParameter(block, param, origin);
    }
  }

  private bindParameter(
    block: SymbolBlock,
    param: Parser.SyntaxNode,
    origin: PythonBindingOrigin
  ): void {
    switch (param.type) {
      case 'identifier': {
        this.addDef(block, param.text, SymbolFlags.DEF_PARAM, origin, param);
        return;
      }
      case 'default_parameter':
      case 'typed_default_parameter':
      case 'typed_parameter': {
        const nameNode = param.childForFieldName('name') ?? param.namedChild(0);
        if (nameNode?.type === 'identifier') {
          this.addDef(block, nameNode.text, SymbolFlags.DEF_PARAM, origin, nameNode);
          return;
        }
        // An ANNOTATED splat wraps its name one level deeper:
        // `**kwargs: Any` is typed_parameter > dictionary_splat_pattern >
        // identifier, where bare `**kwargs` is the splat pattern directly.
        // Reading only the first named child silently loses the parameter, so
        // `is_parameter` comes back false for every annotated *args/**kwargs.
        if (
          nameNode?.type === 'list_splat_pattern' ||
          nameNode?.type === 'dictionary_splat_pattern'
        ) {
          const inner = nameNode.namedChild(0);
          if (inner?.type === 'identifier') {
            this.addDef(block, inner.text, SymbolFlags.DEF_PARAM, origin, inner);
          }
        }
        return;
      }
      case 'list_splat_pattern':
      case 'dictionary_splat_pattern': {
        const nameNode = param.namedChild(0);
        if (nameNode?.type === 'identifier') {
          this.addDef(block, nameNode.text, SymbolFlags.DEF_PARAM, origin, nameNode);
        }
        return;
      }
      // `/` and `*` markers bind nothing.
      case 'positional_separator':
      case 'keyword_separator': {
        return;
      }
      default: {
        return;
      }
    }
  }

  // ---------------------------------------------------------------- imports

  /**
   * Import binding rules, which are about the **bound name** and nothing else.
   *
   * ```python
   * import a.b.c            # binds `a` only
   * import a.b as ab        # binds `ab`
   * from m import x, y as z # binds `x` and `z`
   * from m import *         # binds nothing statically; marks the scope
   * ```
   */
  private visitImport(block: SymbolBlock, node: Parser.SyntaxNode): void {
    const isFromImport =
      node.type === 'import_from_statement' || node.type === 'future_import_statement';
    const moduleNameNode = node.childForFieldName('module_name');

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) {
        continue;
      }

      // In a from-import the module part is not a binding.
      if (isFromImport && child.id === moduleNameNode?.id) {
        continue;
      }

      if (child.type === 'wildcard_import') {
        // `import *` binds names we cannot enumerate. Recorded as a soundness
        // hole on the scope rather than guessed at.
        block.usesWildcardImport = true;
        continue;
      }

      if (child.type === 'aliased_import') {
        const aliasNode = child.childForFieldName('alias');
        if (aliasNode?.type === 'identifier') {
          this.addDef(
            block,
            aliasNode.text,
            SymbolFlags.DEF_IMPORT,
            PythonBindingOrigin.IMPORT,
            aliasNode
          );
        }
        continue;
      }

      if (child.type === 'dotted_name') {
        const firstSegment = child.namedChild(0);
        if (!firstSegment) {
          continue;
        }
        // `import a.b.c` binds `a`; `from m import name` binds `name`.
        const boundNode = isFromImport
          ? (child.namedChild(child.namedChildCount - 1) ?? firstSegment)
          : firstSegment;
        this.addDef(
          block,
          boundNode.text,
          SymbolFlags.DEF_IMPORT,
          PythonBindingOrigin.IMPORT,
          boundNode
        );
        continue;
      }

      if (child.type === 'relative_import') {
        // `from . import x` — the dots bind nothing; the members are separate
        // named children handled by the dotted_name branch above.
        continue;
      }
    }
  }

  // ------------------------------------------------------- loops and blocks

  private visitForStatement(block: SymbolBlock, node: Parser.SyntaxNode): void {
    const leftNode = node.childForFieldName('left');
    const rightNode = node.childForFieldName('right');
    const bodyNode = node.childForFieldName('body');
    const elseNode = node.childForFieldName('alternative');

    if (rightNode) {
      this.visitExpression(block, rightNode, PythonNameContext.LOAD);
    }
    if (leftNode) {
      this.visitTarget(block, leftNode, PythonBindingOrigin.FOR_TARGET, PythonNameContext.STORE);
    }
    if (bodyNode) {
      this.visitStatement(block, bodyNode);
    }
    if (elseNode) {
      this.visitStatement(block, elseNode);
    }
  }

  private visitWithStatement(block: SymbolBlock, node: Parser.SyntaxNode): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) {
        continue;
      }
      if (child.type === 'with_clause') {
        for (let j = 0; j < child.namedChildCount; j++) {
          const item = child.namedChild(j);
          if (item?.type === 'with_item') {
            this.visitWithItem(block, item);
          }
        }
        continue;
      }
      this.visitStatement(block, child);
    }
  }

  private visitWithItem(block: SymbolBlock, item: Parser.SyntaxNode): void {
    const valueNode = item.childForFieldName('value') ?? item.namedChild(0);
    if (!valueNode) {
      return;
    }
    if (valueNode.type === 'as_pattern') {
      this.visitAsPattern(block, valueNode, PythonBindingOrigin.WITH_TARGET);
      return;
    }
    this.visitExpression(block, valueNode, PythonNameContext.LOAD);
  }

  /**
   * A `try` statement, in symtable's order — which is **not** source order.
   *
   * CPython's symbol table visits `body`, then the `else` clause, then the
   * `except` handlers, then `finally`. The compiler does not use that order, and
   * source order does not either, but it is observable through `scopeOrdinal`:
   *
   * ```python
   * try:
   *     CODESET
   * except NameError:
   *     def getpreferredencoding(...): ...   # source line 652, ordinal 30
   * else:
   *     def getpreferredencoding(...): ...   # source line 657, ordinal 29
   * ```
   *
   * The `else` definition is constructed first despite appearing later. This is
   * from `locale.py` in the standard library, so it is load-bearing on real code
   * rather than a curiosity.
   */
  private visitTryStatement(block: SymbolBlock, node: Parser.SyntaxNode): void {
    const handlers: Parser.SyntaxNode[] = [];
    const elseClauses: Parser.SyntaxNode[] = [];
    const finallyClauses: Parser.SyntaxNode[] = [];
    const body: Parser.SyntaxNode[] = [];

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) {
        continue;
      }
      if (child.type === 'except_clause' || child.type === 'except_group_clause') {
        handlers.push(child);
        continue;
      }
      if (child.type === 'else_clause') {
        elseClauses.push(child);
        continue;
      }
      if (child.type === 'finally_clause') {
        finallyClauses.push(child);
        continue;
      }
      body.push(child);
    }

    for (const part of body) {
      this.visitStatement(block, part);
    }
    for (const part of elseClauses) {
      this.visitStatement(block, part);
    }
    for (const handler of handlers) {
      this.visitExceptClause(block, handler);
    }
    for (const part of finallyClauses) {
      this.visitStatement(block, part);
    }
  }

  /**
   * `except E as exc:` binds `exc`. `except E, exc:` is Python 2 and never
   * reaches this code — the file is rejected before extraction.
   */
  private visitExceptClause(block: SymbolBlock, node: Parser.SyntaxNode): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) {
        continue;
      }
      if (child.type === 'as_pattern') {
        this.visitAsPattern(block, child, PythonBindingOrigin.EXCEPT_TARGET);
        continue;
      }
      if (child.type === 'block') {
        this.visitStatement(block, child);
        continue;
      }
      this.visitExpression(block, child, PythonNameContext.LOAD);
    }
  }

  private visitAsPattern(
    block: SymbolBlock,
    node: Parser.SyntaxNode,
    origin: PythonBindingOrigin
  ): void {
    const valueNode = node.namedChild(0);
    if (valueNode) {
      this.visitExpression(block, valueNode, PythonNameContext.LOAD);
    }
    for (let i = 1; i < node.namedChildCount; i++) {
      const target = node.namedChild(i);
      if (target?.type === 'as_pattern_target') {
        const inner = target.namedChild(0);
        if (inner) {
          this.visitTarget(block, inner, origin, PythonNameContext.STORE);
        }
        continue;
      }
      if (target) {
        this.visitTarget(block, target, origin, PythonNameContext.STORE);
      }
    }
  }

  /**
   * `match` / `case` patterns.
   *
   * The trap here is that a capture and a class name look identical in the
   * grammar — both are `dotted_name` under `case_pattern`:
   *
   * ```python
   * case Point(x=px):   # `Point` is a LOAD, `x` is an attribute name that binds
   *                     # nothing, and only `px` is a capture
   * case [a, *rest]:    # `a` and `rest` are captures
   * ```
   */
  private visitCasePattern(block: SymbolBlock, node: Parser.SyntaxNode): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) {
        this.visitPatternNode(block, child);
      }
    }
  }

  private visitPatternNode(block: SymbolBlock, node: Parser.SyntaxNode): void {
    switch (node.type) {
      case 'dotted_name': {
        // A single bare identifier is a capture; a dotted path is a value load.
        if (node.namedChildCount === 1) {
          const nameNode = node.namedChild(0);
          if (nameNode && nameNode.text !== '_') {
            this.addDef(
              block,
              nameNode.text,
              SymbolFlags.DEF_LOCAL,
              PythonBindingOrigin.MATCH_CAPTURE,
              nameNode
            );
          }
          return;
        }
        const firstSegment = node.namedChild(0);
        if (firstSegment) {
          this.addUse(block, firstSegment.text);
        }
        return;
      }

      case 'class_pattern': {
        // The first child names the class and is a load; the rest are patterns.
        const classNameNode = node.namedChild(0);
        if (classNameNode?.type === 'dotted_name') {
          const firstSegment = classNameNode.namedChild(0);
          if (firstSegment) {
            this.addUse(block, firstSegment.text);
          }
        }
        for (let i = 1; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            this.visitPatternNode(block, child);
          }
        }
        return;
      }

      case 'keyword_pattern': {
        // `x=px` — `x` is the attribute being matched and binds nothing.
        for (let i = 1; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            this.visitPatternNode(block, child);
          }
        }
        return;
      }

      case 'splat_pattern': {
        const nameNode = node.namedChild(0);
        if (nameNode && nameNode.text !== '_') {
          this.addDef(
            block,
            nameNode.text,
            SymbolFlags.DEF_LOCAL,
            PythonBindingOrigin.MATCH_CAPTURE,
            nameNode
          );
        }
        return;
      }

      case 'as_pattern': {
        // `case Event(kind=k) as e:` — the wrapped pattern binds its own
        // captures, and the trailing bare identifier is a capture too. Note the
        // alias here is a plain `identifier`, NOT the `as_pattern_target` that
        // `with` and `except` produce.
        const wrapped = node.namedChild(0);
        if (wrapped) {
          this.visitPatternNode(block, wrapped);
        }
        for (let i = 1; i < node.namedChildCount; i++) {
          const alias = node.namedChild(i);
          if (!alias) {
            continue;
          }
          const aliasName =
            alias.type === 'as_pattern_target' ? alias.namedChild(0) : alias;
          if (aliasName?.type === 'identifier' && aliasName.text !== '_') {
            this.addDef(
              block,
              aliasName.text,
              SymbolFlags.DEF_LOCAL,
              PythonBindingOrigin.MATCH_CAPTURE,
              aliasName
            );
          }
        }
        return;
      }

      case 'case_pattern':
      case 'list_pattern':
      case 'tuple_pattern':
      case 'dict_pattern':
      case 'union_pattern': {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            this.visitPatternNode(block, child);
          }
        }
        return;
      }

      default: {
        // Literals and value patterns: any identifier in them is a load.
        this.visitExpression(block, node, PythonNameContext.LOAD);
        return;
      }
    }
  }

  // ------------------------------------------------------------- assignment

  private visitAssignment(block: SymbolBlock, node: Parser.SyntaxNode): void {
    const leftNode = node.childForFieldName('left');
    const typeNode = node.childForFieldName('type');
    const rightNode = node.childForFieldName('right');

    // The value is evaluated before the target is bound.
    if (rightNode) {
      this.visitExpression(block, rightNode, PythonNameContext.LOAD);
    }
    if (typeNode) {
      this.visitAnnotation(block, typeNode);
    }
    if (!leftNode) {
      return;
    }

    if (typeNode) {
      // An annotated target. A *simple* name gets DEF_ANNOT | DEF_LOCAL even
      // with no value, which is why `x: int` alone reports is_assigned=true.
      if (leftNode.type === 'identifier') {
        this.addDef(
          block,
          leftNode.text,
          SymbolFlags.DEF_ANNOT | SymbolFlags.DEF_LOCAL,
          rightNode
            ? PythonBindingOrigin.ANNOTATED_ASSIGNMENT
            : PythonBindingOrigin.ANNOTATION_ONLY,
          leftNode
        );
        const record = block.origins.get(leftNode.text);
        if (record && !record.declaredTypeName) {
          record.declaredTypeName = typeNode.text;
        }
        return;
      }
      // `obj.attr: int = 1` binds nothing; the target is still evaluated.
      this.visitTarget(block, leftNode, PythonBindingOrigin.ANNOTATED_ASSIGNMENT, PythonNameContext.STORE);
      return;
    }

    this.visitTarget(block, leftNode, PythonBindingOrigin.ASSIGNMENT, PythonNameContext.STORE);
  }

  /**
   * Augmented assignment: `x += 1`.
   *
   * CPython sets `DEF_LOCAL` and **not** `USE` for the target, so
   * `is_referenced` is false even though the operation obviously reads the name.
   * Verified against CPython, not inferred from the semantics.
   */
  private visitAugmentedAssignment(block: SymbolBlock, node: Parser.SyntaxNode): void {
    const leftNode = node.childForFieldName('left');
    const rightNode = node.childForFieldName('right');

    if (rightNode) {
      this.visitExpression(block, rightNode, PythonNameContext.LOAD);
    }
    if (leftNode) {
      this.visitTarget(block, leftNode, PythonBindingOrigin.AUGMENTED_ASSIGNMENT, PythonNameContext.STORE);
    }
  }

  /**
   * Assignment targets, recursively.
   *
   * Only bare names bind. `self.x = 1` and `d[k] = 1` evaluate their object and
   * bind nothing — which is precisely why instance attributes have no binding
   * and need their own relation.
   */
  private visitTarget(
    block: SymbolBlock,
    node: Parser.SyntaxNode,
    origin: PythonBindingOrigin,
    context: PythonNameContext
  ): void {
    switch (node.type) {
      case 'identifier': {
        this.addDef(block, node.text, SymbolFlags.DEF_LOCAL, origin, node);
        return;
      }

      case 'pattern_list':
      case 'expression_list':
      case 'tuple_pattern':
      case 'list_pattern':
      case 'tuple':
      case 'list': {
        const nestedOrigin =
          origin === PythonBindingOrigin.ASSIGNMENT
            ? PythonBindingOrigin.TUPLE_UNPACK_TARGET
            : origin;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            this.visitTarget(block, child, nestedOrigin, context);
          }
        }
        return;
      }

      case 'list_splat_pattern':
      case 'list_splat': {
        const inner = node.namedChild(0);
        if (inner) {
          this.visitTarget(block, inner, PythonBindingOrigin.STAR_TARGET, context);
        }
        return;
      }

      case 'parenthesized_expression': {
        const inner = node.namedChild(0);
        if (inner) {
          this.visitTarget(block, inner, origin, context);
        }
        return;
      }

      case 'attribute':
      case 'subscript': {
        // Binds nothing. Routed through visitExpression rather than straight to
        // the children, because an `attribute`'s second child is the attribute
        // LABEL and reading it as a name invents a binding for every
        // `self.x = ...` in the codebase.
        this.visitExpression(block, node, PythonNameContext.LOAD);
        return;
      }

      default: {
        this.visitExpression(block, node, PythonNameContext.LOAD);
        return;
      }
    }
  }

  // ------------------------------------------------------------ expressions

  /**
   * Visits an expression, recording reads and descending into nested scopes.
   */
  private visitExpression(
    block: SymbolBlock,
    node: Parser.SyntaxNode,
    context: PythonNameContext
  ): void {
    switch (node.type) {
      case 'identifier': {
        if (context === PythonNameContext.LOAD) {
          this.addUse(block, node.text);
          return;
        }
        this.addDef(block, node.text, SymbolFlags.DEF_LOCAL, PythonBindingOrigin.ASSIGNMENT, node);
        return;
      }

      case 'assignment': {
        this.visitAssignment(block, node);
        return;
      }

      case 'augmented_assignment': {
        this.visitAugmentedAssignment(block, node);
        return;
      }

      case 'named_expression': {
        this.visitNamedExpression(block, node);
        return;
      }

      case 'attribute': {
        // Only the object is a name; the attribute label resolves at runtime.
        const objectNode = node.childForFieldName('object') ?? node.namedChild(0);
        if (objectNode) {
          this.visitExpression(block, objectNode, PythonNameContext.LOAD);
        }
        return;
      }

      case 'keyword_argument': {
        // `f(k=v)` — `k` is a parameter name, not a reference.
        const valueNode = node.childForFieldName('value') ?? node.namedChild(1);
        if (valueNode) {
          this.visitExpression(block, valueNode, PythonNameContext.LOAD);
        }
        return;
      }

      case 'function_definition': {
        this.visitFunctionDefinition(block, node);
        return;
      }

      case 'class_definition': {
        this.visitClassDefinition(block, node);
        return;
      }

      case 'lambda': {
        this.visitLambda(block, node);
        return;
      }

      case 'list_comprehension':
      case 'set_comprehension':
      case 'dictionary_comprehension':
      case 'generator_expression': {
        this.visitComprehension(block, node);
        return;
      }

      default: {
        this.visitExpressionChildren(block, node, context);
        return;
      }
    }
  }

  private visitExpressionChildren(
    block: SymbolBlock,
    node: Parser.SyntaxNode,
    context: PythonNameContext
  ): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) {
        continue;
      }
      if (this.isStatementLike(child)) {
        this.visitStatement(block, child);
        continue;
      }
      this.visitExpression(block, child, context);
    }
  }

  private visitLambda(block: SymbolBlock, node: Parser.SyntaxNode): void {
    const parametersNode = node.childForFieldName('parameters');
    const bodyNode = node.childForFieldName('body');

    // Lambda defaults are evaluated in the enclosing scope, as with a def.
    // A lambda cannot carry annotations, so only defaults apply here.
    if (parametersNode) {
      this.visitParameterDefaults(block, parametersNode);
    }

    const child = this.createChildBlock(
      block,
      node,
      SymbolBlockType.FUNCTION,
      PythonScopeKind.LAMBDA,
      PYTHON_LAMBDA_SCOPE_NAME
    );

    if (parametersNode) {
      this.visitParameterNames(child, parametersNode, PythonBindingOrigin.LAMBDA_PARAM);
    }
    if (bodyNode) {
      this.visitExpression(child, bodyNode, PythonNameContext.LOAD);
    }
  }

  /**
   * Comprehensions and generator expressions.
   *
   * Two rules that are easy to miss and both change the answer:
   *
   * 1. **The outermost iterable is evaluated in the enclosing scope.** In
   *    `[i for i in range(3) for j in range(i)]`, `range(3)` runs outside and
   *    `range(i)` runs inside.
   * 2. **A synthetic `.0` parameter holds that iterable.** It is a genuine
   *    `symtable.Symbol`, so it is emitted as a real binding — on the
   *    `PY3_0_11` target that is every comprehension in the corpus.
   */
  private visitComprehension(block: SymbolBlock, node: Parser.SyntaxNode): void {
    const scopeKind = this.comprehensionScopeKind(node.type);
    const scopeName = this.comprehensionScopeName(node.type);

    const clauses: Parser.SyntaxNode[] = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type === 'for_in_clause') {
        clauses.push(child);
      }
    }

    // Rule 1: the first clause's iterable belongs to the enclosing scope.
    const firstClause = clauses[0];
    if (firstClause) {
      const iterable = firstClause.childForFieldName('right');
      if (iterable) {
        this.visitExpression(block, iterable, PythonNameContext.LOAD);
      }
    }

    const child = this.createChildBlock(
      block,
      node,
      SymbolBlockType.FUNCTION,
      scopeKind,
      scopeName
    );

    // Rule 2: the implicit iterator parameter.
    this.addDef(
      child,
      PYTHON_SYNTHETIC_ITERATOR,
      SymbolFlags.DEF_PARAM,
      PythonBindingOrigin.PARAMETER,
      node
    );

    for (let index = 0; index < clauses.length; index++) {
      const clause = clauses[index];
      if (!clause) {
        continue;
      }
      const target = clause.childForFieldName('left');
      const iterable = clause.childForFieldName('right');
      if (target) {
        this.visitTarget(child, target, PythonBindingOrigin.COMPREHENSION_TARGET, PythonNameContext.STORE);
      }
      // Every iterable except the first is evaluated inside the comprehension.
      if (iterable && index > 0) {
        this.visitExpression(child, iterable, PythonNameContext.LOAD);
      }
    }

    // The element/key/value expressions and every `if` clause run inside.
    for (let i = 0; i < node.namedChildCount; i++) {
      const part = node.namedChild(i);
      if (!part || part.type === 'for_in_clause') {
        continue;
      }
      this.visitExpression(child, part, PythonNameContext.LOAD);
    }
  }

  private comprehensionScopeKind(nodeType: string): PythonScopeKind {
    switch (nodeType) {
      case 'set_comprehension': {
        return PythonScopeKind.COMPREHENSION_SET;
      }
      case 'dictionary_comprehension': {
        return PythonScopeKind.COMPREHENSION_DICT;
      }
      case 'generator_expression': {
        return PythonScopeKind.GENERATOR_EXPRESSION;
      }
      case 'list_comprehension':
      default: {
        return PythonScopeKind.COMPREHENSION_LIST;
      }
    }
  }

  private comprehensionScopeName(nodeType: string): string {
    switch (nodeType) {
      case 'set_comprehension': {
        return 'setcomp';
      }
      case 'dictionary_comprehension': {
        return 'dictcomp';
      }
      case 'generator_expression': {
        return 'genexpr';
      }
      case 'list_comprehension':
      default: {
        return 'listcomp';
      }
    }
  }

  /**
   * The walrus operator, `:=`.
   *
   * Inside a comprehension the target binds in the nearest enclosing function or
   * module scope, **not** in the comprehension — while the comprehension itself
   * records the name as `DEF_LOCAL | DEF_NONLOCAL`, which pass 2 resolves to
   * `FREE`. Both halves are needed to match CPython:
   *
   * ```python
   * filtered = [y for y in values if (last_seen := y) > 0]
   * # listcomp scope:  last_seen -> assigned, free, nonlocal
   * # function scope:  last_seen -> assigned, local, referenced
   * ```
   */
  private visitNamedExpression(block: SymbolBlock, node: Parser.SyntaxNode): void {
    const targetNode = node.childForFieldName('name') ?? node.namedChild(0);
    const valueNode = node.childForFieldName('value') ?? node.namedChild(1);

    if (valueNode) {
      this.visitExpression(block, valueNode, PythonNameContext.LOAD);
    }
    if (!targetNode || targetNode.type !== 'identifier') {
      return;
    }

    const isComprehensionBlock = this.isComprehensionScope(block.scopeKind);
    if (isComprehensionBlock) {
      const owner = this.findNamedExpressionOwner(block);
      if (owner) {
        this.addDef(
          owner,
          targetNode.text,
          SymbolFlags.DEF_LOCAL,
          PythonBindingOrigin.WALRUS,
          targetNode
        );
      }
      this.addDef(
        block,
        targetNode.text,
        SymbolFlags.DEF_LOCAL | SymbolFlags.DEF_NONLOCAL,
        PythonBindingOrigin.WALRUS,
        targetNode
      );
      return;
    }

    this.addDef(
      block,
      targetNode.text,
      SymbolFlags.DEF_LOCAL,
      PythonBindingOrigin.WALRUS,
      targetNode
    );
  }

  private isComprehensionScope(scopeKind: PythonScopeKind): boolean {
    return (
      scopeKind === PythonScopeKind.COMPREHENSION_LIST ||
      scopeKind === PythonScopeKind.COMPREHENSION_SET ||
      scopeKind === PythonScopeKind.COMPREHENSION_DICT ||
      scopeKind === PythonScopeKind.GENERATOR_EXPRESSION
    );
  }

  /** Walks out through nested comprehensions to the scope that owns the walrus. */
  private findNamedExpressionOwner(block: SymbolBlock): SymbolBlock | null {
    let candidate = block.parent;
    while (candidate !== null && this.isComprehensionScope(candidate.scopeKind)) {
      candidate = candidate.parent;
    }
    return candidate;
  }
}

/** Exposed for the extractor, which needs the same classification. */
export { COMPREHENSION_NODE_TYPES, SCOPE_NODE_TYPES };
