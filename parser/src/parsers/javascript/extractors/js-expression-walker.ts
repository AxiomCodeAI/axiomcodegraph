import * as ts from 'typescript';

import { JsRootContext } from '@/enums/javascript/expressions';
import { JsExpressionExtractor } from
  '@/parsers/javascript/extractors/js-expression-extractor';
import { nodeKey } from '@/parsers/javascript/extractors/js-symbol-table';

/**
 * Finds every position an expression tree may be rooted at, and nothing else.
 *
 * ## An allowlist, not a tree walk
 *
 * §6 of `BUILDING-A-PARSER.md`: *use an allowlist of expression positions, never
 * a generic tree walk.* A generic walk reaches JSDoc type nodes, binding
 * patterns and type annotations, puts their names into `js_expression`, and
 * type-only constructs then reach the call graph — which the schema forbids and
 * a gate asserts. Every position below is enumerated because a statement form
 * puts an expression there, and the `rootContext` names which.
 *
 * ## The walk descends into function bodies EXPLICITLY
 *
 * The other half of §6. A callable's body is a statement list that belongs to
 * that callable's own `js_method` row, and a walker that treats a function as a
 * leaf emits the function and nothing inside it — which cost 45 of 691 call
 * sites in one TypeScript corpus, with every emitted row correct. There were
 * simply fewer of them, so no count-based check could see it.
 *
 * In JavaScript that boundary is not an edge case. The pre-ES6 module pattern
 * puts an entire file inside an IIFE, and 13.6% of `require()` calls live inside
 * a function body. A walker that stops at the boundary misses the module graph.
 */
export interface ExpressionWalkOptions {
  readonly sourceFile: ts.SourceFile;
  readonly extractor: JsExpressionExtractor;
  /** `nodeKey` of a callable -> its `js_method` hash, from the declaration pass. */
  readonly methodHashByNode: ReadonlyMap<string, string>;
  /** Field declaration node -> the callable its initializer runs inside (#798). */
  readonly fieldInitOwnerByNode: ReadonlyMap<string, string>;
  /** The `<module>` initializer, which owns every top-level expression. */
  readonly moduleInitMethodHash: string;
}

export class JsExpressionWalker {
  private readonly options: ExpressionWalkOptions;

  constructor(options: ExpressionWalkOptions) {
    this.options = options;
  }

  run(): void {
    for (const statement of this.options.sourceFile.statements) {
      this.visitStatement(statement, this.options.moduleInitMethodHash);
    }
  }

  /**
   * One statement, in the method that owns it.
   *
   * `ownerMethodHash` is threaded rather than derived, because deriving it would
   * mean walking ancestors at every expression — and an IIFE's parenthesis, its
   * function and its call all begin at the same offset, so an ancestor walk that
   * compares positions picks the wrong owner constantly.
   */
  private visitStatement(node: ts.Node, ownerMethodHash: string): void {
    // Every branch braced: a dangling `else` in dispatch-heavy extractor code is
    // nearly invisible and silently doubles or drops output.
    if (ts.isExpressionStatement(node)) {
      this.root(node.expression, JsRootContext.EXPRESSION_STATEMENT, ownerMethodHash);
      return;
    }
    if (ts.isVariableStatement(node)) {
      this.visitVariableDeclarationList(node.declarationList, ownerMethodHash);
      return;
    }
    if (ts.isReturnStatement(node)) {
      this.root(node.expression, JsRootContext.RETURN, ownerMethodHash);
      return;
    }
    if (ts.isThrowStatement(node)) {
      this.root(node.expression, JsRootContext.THROW, ownerMethodHash);
      return;
    }
    if (ts.isIfStatement(node)) {
      this.root(node.expression, JsRootContext.CONDITION, ownerMethodHash);
      this.visitStatement(node.thenStatement, ownerMethodHash);
      if (node.elseStatement !== undefined) {
        this.visitStatement(node.elseStatement, ownerMethodHash);
      }
      return;
    }
    if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      this.root(node.expression, JsRootContext.CONDITION, ownerMethodHash);
      this.visitStatement(node.statement, ownerMethodHash);
      return;
    }
    if (ts.isForStatement(node)) {
      if (node.initializer !== undefined) {
        if (ts.isVariableDeclarationList(node.initializer)) {
          this.visitVariableDeclarationList(node.initializer, ownerMethodHash);
        } else {
          this.root(node.initializer, JsRootContext.FOR_HEADER, ownerMethodHash);
        }
      }
      this.root(node.condition, JsRootContext.FOR_HEADER, ownerMethodHash);
      this.root(node.incrementor, JsRootContext.FOR_HEADER, ownerMethodHash);
      this.visitStatement(node.statement, ownerMethodHash);
      return;
    }
    if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      if (ts.isVariableDeclarationList(node.initializer)) {
        this.visitVariableDeclarationList(node.initializer, ownerMethodHash);
      } else {
        this.root(node.initializer, JsRootContext.FOR_HEADER, ownerMethodHash);
      }
      this.root(node.expression, JsRootContext.ITERABLE, ownerMethodHash);
      this.visitStatement(node.statement, ownerMethodHash);
      return;
    }
    if (ts.isSwitchStatement(node)) {
      this.root(node.expression, JsRootContext.CONDITION, ownerMethodHash);
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause)) {
          this.root(clause.expression, JsRootContext.SWITCH_CASE_TEST, ownerMethodHash);
        }
        for (const statement of clause.statements) {
          this.visitStatement(statement, ownerMethodHash);
        }
      }
      return;
    }
    if (ts.isBlock(node)) {
      for (const statement of node.statements) {
        this.visitStatement(statement, ownerMethodHash);
      }
      return;
    }
    if (ts.isTryStatement(node)) {
      this.visitStatement(node.tryBlock, ownerMethodHash);
      if (node.catchClause !== undefined) {
        this.visitStatement(node.catchClause.block, ownerMethodHash);
      }
      if (node.finallyBlock !== undefined) {
        this.visitStatement(node.finallyBlock, ownerMethodHash);
      }
      return;
    }
    if (ts.isLabeledStatement(node)) {
      this.visitStatement(node.statement, ownerMethodHash);
      return;
    }
    if (ts.isWithStatement(node)) {
      this.root(node.expression, JsRootContext.WITH_TARGET, ownerMethodHash);
      this.visitStatement(node.statement, ownerMethodHash);
      return;
    }
    if (ts.isFunctionDeclaration(node)) {
      this.visitCallable(node);
      return;
    }
    if (ts.isClassDeclaration(node)) {
      this.visitClass(node, ownerMethodHash);
      return;
    }
    if (ts.isExportAssignment(node)) {
      this.root(node.expression, JsRootContext.EXPORT_VALUE, ownerMethodHash);
      return;
    }
    if (ts.isExportDeclaration(node)) {
      // `export { a as b }` binds no expression: the names are declarations
      // elsewhere and the specifier is a module edge. Nothing to root.
      return;
    }
    if (ts.isImportDeclaration(node)) {
      return;
    }
    // A statement form with no expression of its own — `break`, `continue`,
    // `debugger`, an empty statement. Descending generically here is what would
    // turn this into a tree walk, so it deliberately does not.
  }

  private visitVariableDeclarationList(
    list: ts.VariableDeclarationList,
    ownerMethodHash: string
  ): void {
    for (const declaration of list.declarations) {
      this.root(declaration.initializer, JsRootContext.VARIABLE_INITIALIZER,
        ownerMethodHash);
      // A binding pattern's DEFAULTS are expressions that run: `const { a = f() }
      // = o` calls `f`. The pattern's NAMES are declarations and deliberately
      // never enter this relation.
      this.rootPatternDefaults(declaration.name, ownerMethodHash);
    }
  }

  private rootPatternDefaults(name: ts.BindingName, ownerMethodHash: string): void {
    if (ts.isIdentifier(name)) {
      return;
    }
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) {
        continue;
      }
      if (element.initializer !== undefined) {
        this.root(element.initializer, JsRootContext.PARAMETER_DEFAULT, ownerMethodHash);
      }
      if (element.propertyName !== undefined
        && ts.isComputedPropertyName(element.propertyName)) {
        this.root(element.propertyName.expression, JsRootContext.COMPUTED_NAME,
          ownerMethodHash);
      }
      this.rootPatternDefaults(element.name, ownerMethodHash);
    }
  }

  private visitClass(node: ts.ClassLikeDeclaration, ownerMethodHash: string): void {
    // A heritage clause is an EXPRESSION that runs: `class X extends mixin(Y)`
    // calls `mixin` at class-definition time. Emitting the class and dropping
    // this loses a real call site.
    for (const clause of node.heritageClauses ?? []) {
      for (const type of clause.types) {
        this.root(type.expression, JsRootContext.HERITAGE, ownerMethodHash);
      }
    }
    for (const member of node.members) {
      if (member.name !== undefined && ts.isComputedPropertyName(member.name)) {
        this.root(member.name.expression, JsRootContext.COMPUTED_NAME, ownerMethodHash);
      }
      if (ts.isPropertyDeclaration(member)) {
        // A field initializer runs inside the class's initialization callable, not inside
        // whatever encloses the class (#798): the module used to own it, so `this` had no
        // value and the call was attributed to the module rather than to the constructor.
        const owner = this.options.fieldInitOwnerByNode.get(nodeKey(member)) ?? ownerMethodHash;
        this.root(member.initializer, JsRootContext.FIELD_INITIALIZER, owner);
        continue;
      }
      if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)
        || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
        this.visitCallable(member);
        continue;
      }
      if (ts.isClassStaticBlockDeclaration(member)) {
        const hash = this.methodHashFor(member, ownerMethodHash);
        for (const statement of member.body.statements) {
          this.visitStatement(statement, hash);
        }
        continue;
      }
    }
  }

  /**
   * A callable's own body, under its own method row.
   *
   * The explicit descent §6 demands. A parameter default is rooted here too and
   * belongs to the callable's own method, because it is evaluated at call time
   * in the callable's own scope — `function f(a, b = a)` resolves `a` to the
   * parameter, not to anything outside.
   */
  private visitCallable(node: ts.FunctionLikeDeclaration): void {
    const hash = this.methodHashFor(node, this.options.moduleInitMethodHash);
    for (const parameter of node.parameters) {
      if (parameter.initializer !== undefined) {
        this.root(parameter.initializer, JsRootContext.PARAMETER_DEFAULT, hash);
      }
      this.rootPatternDefaults(parameter.name, hash);
    }
    const body = node.body;
    if (body === undefined) {
      return;
    }
    if (ts.isBlock(body)) {
      for (const statement of body.statements) {
        this.visitStatement(statement, hash);
      }
      return;
    }
    // A concise arrow: `x => x * 2`. The body IS the returned expression, so it
    // is rooted as a RETURN — an extractor looking for a ReturnStatement finds
    // none and reports a function that returns nothing.
    this.root(body, JsRootContext.RETURN, hash);
  }

  /**
   * Roots one expression, descending into any callable it contains.
   *
   * The descent is the subtle part. A function expression inside an expression —
   * `arr.map(function (x) { return f(x); })` — gets a `js_expression` row for
   * the function itself, and its BODY belongs to its own method row. So after
   * emitting the tree, every callable within it is visited as a callable.
   * Without that, `return function () { … }` emits the function and nothing
   * inside it.
   */
  private root(
    node: ts.Expression | undefined,
    rootContext: JsRootContext,
    ownerMethodHash: string
  ): void {
    if (node === undefined) {
      return;
    }
    this.options.extractor.emitRoot({ node, rootContext, ownerMethodHash });
    this.descendIntoCallables(node, ownerMethodHash);
  }

  /**
   * Visits every callable inside an expression tree, as a callable.
   *
   * **Stops at each one, and the recursion is single-path.** `visitCallable`
   * reaches whatever is nested deeper through the statements of its own body,
   * under its own method hash, so descending past a callable here would visit an
   * inner function's body twice — once under the outer method and once under its
   * own — and a construct visited on two paths **doubles** its rows rather than
   * colliding.
   *
   * An earlier shape did exactly that: it walked the children first, then
   * checked whether the node itself was a callable, so a `return function () {
   * … }` inside a function expression was reached along both paths. The
   * extractor's own guard absorbed the duplicate rows, which is precisely why it
   * would not have been noticed.
   *
   * The root itself may BE a callable: `const f = function () { … }` roots at
   * the function directly, and `(function () { … })()` unwraps to a call whose
   * callee is one.
   */
  private descendIntoCallables(node: ts.Node, ownerMethodHash: string): void {
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      this.visitCallable(node);
      return;
    }
    // An object literal's METHOD or ACCESSOR is a callable too, and this walker
    // did not know it. `{ m(x) { f(); } }` reached `f()` through `forEachChild`
    // — which looks only for callables and roots no expression — so the call
    // was never emitted at all. 3,210 of 3,264 recall misses corpus-wide.
    //
    // A CLASS member does not arrive here: `visitClass` handles those directly,
    // which is why `{ m() {} }` was broken while `class C { m() {} }` was fine.
    if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)
      || ts.isSetAccessorDeclaration(node)) {
      if (ts.isComputedPropertyName(node.name)) {
        this.root(node.name.expression, JsRootContext.COMPUTED_NAME, ownerMethodHash);
      }
      this.visitCallable(node);
      return;
    }
    // A CLASS EXPRESSION's heritage clause runs where the class is WRITTEN, so it
    // belongs to the callable that encloses it, not to the module (#730). Passing
    // the module initializer here gave `static extend() { return class extends
    // this {}; }` a `this` looked up against the module, so the returned class had
    // no superclass and the whole hierarchy under a class-system factory
    // disconnected. The class's own BODY is unaffected: visitClass gives each
    // member its own hash.
    if (ts.isClassExpression(node)) {
      this.visitClass(node, ownerMethodHash);
      return;
    }
    ts.forEachChild(node, (child) => {
      this.descendIntoCallables(child, ownerMethodHash);
    });
  }

  private methodHashFor(node: ts.Node, fallback: string): string {
    return this.options.methodHashByNode.get(nodeKey(node)) ?? fallback;
  }
}
