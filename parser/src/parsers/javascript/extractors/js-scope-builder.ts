import * as ts from 'typescript';

import { JsModuleSystem } from '@/enums/javascript/modules';
import { JsScopeKind, JsStrictModeSource } from '@/enums/javascript/scopes';
import { JsBindingRegime } from '@/enums/javascript/variables';
import {
  addBinding,
  JsBinding,
  JsScopeNode,
  nearestFunctionScope,
  nodeKey,
} from '@/parsers/javascript/extractors/js-symbol-table';
import { firstRunningFieldInitializer, pointOf } from '@/utils/javascript';

/**
 * Builds the scope tree and every `(scope, name)` binding — the JavaScript
 * counterpart of CPython's two-pass symbol-table construction, over a
 * TypeScript AST.
 *
 * `python-scope-builder.ts` is the model and `ts-binder.ts` is not, and the
 * reason is worth stating once: `ts-binder.ts` computes declaration-MERGE
 * scopes, which is a problem JavaScript does not have. What JavaScript has is
 * the problem CPython's binder solves — *where is this name visible from, given
 * that it is not where it is written* — plus two things Python does not have at
 * all: a temporal dead zone, and a `this` that is rebound by call form.
 *
 * ## Pass 1 declares; pass 2 finds what was never declared
 *
 * Pass 1 ({@link build}) walks the tree, opens a scope at each of the nine forms
 * that introduce one, and records every declaration. Pass 2
 * ({@link bindImplicitGlobals}) walks the assignments and creates a
 * `GLOBAL_IMPLICIT` binding for every sloppy-mode write to a name pass 1 never
 * bound. The second pass cannot be folded into the first: whether `x = 1`
 * declares anything depends on whether `x` is declared *anywhere* in the
 * enclosing chain, including on a line below it.
 *
 * ## The traps, each of which a naive walker falls into
 *
 * **1. Hoisting puts a declaration in a scope it is not written in.** A `var`
 * inside a block belongs to the enclosing function's table. This is the reason
 * {@link JsBinding} carries two scope pointers, and the reason a single "scope"
 * column would be the §3 defect class.
 *
 * **2. A function declaration in a block hoists differently by strict mode.** In
 * strict mode it is block-scoped. In sloppy mode Annex B also binds the name in
 * the enclosing function scope, which is why real code gets away with calling
 * one from outside its block. The strictness is therefore needed *while*
 * binding, not afterwards — so directives are read on entry to each scope.
 *
 * **3. A parameter's default expression is evaluated in the function's OWN
 * scope**, not the enclosing one, so `function f(a, b = a)` works. Python's
 * binder has the opposite rule for defaults and that difference is exactly the
 * kind of thing a port gets wrong by inheritance.
 *
 * **4. A named function expression binds its own name inside itself.**
 * `const f = function g() { return g; }` — `g` is visible in the body and
 * nowhere else. Missing it turns a self-recursive callback into an unresolved
 * free name.
 *
 * **5. A class body is always strict, whatever contains it.** A class in a
 * sloppy CommonJS file has a strict body and strict methods, so an undeclared
 * assignment inside a method throws where the identical line at file level
 * creates a global.
 *
 * **6. The walk must descend into function bodies.** §6: *the worklist stops at
 * function boundaries — descend explicitly.* Here that is structural rather than
 * optional, because a nested `require` (13.6% of them) and a prototype
 * assignment inside an IIFE both live past that boundary.
 */
export interface ScopeBuildOptions {
  readonly sourceFile: ts.SourceFile;
  /**
   * Decides the root scope's strictness, and therefore whether
   * `GLOBAL_IMPLICIT` is possible in this file at all.
   *
   * An ES module is strict with no way to opt out. A CommonJS file is sloppy
   * unless it says `'use strict'`. This is why `moduleSystem` is in
   * `js_module`'s primary key: the same source text binds a global in one
   * answer and throws in the other.
   */
  readonly moduleSystem: JsModuleSystem;
  /** A top-level `import`/`export`, which makes the file strict regardless. */
  readonly hasEsmSyntax: boolean;
}

export interface ScopeBuildResult {
  /** The ambient scope. `parentScopeLinkHash` is `""` for exactly this one. */
  readonly globalScope: JsScopeNode;
  /** The file's own top-level scope, and `js_module.moduleScopeLinkHash`. */
  readonly moduleScope: JsScopeNode;
  /** Every scope, in a deterministic pre-order. */
  readonly scopes: readonly JsScopeNode[];
  /**
   * The scope a node OPENS, by the node's key alone.
   *
   * ## The other map answered a different question, and three readers asked it
   * the wrong one
   *
   * `enclosingScopeOf` is the scope a node is IN — recorded at the moment the binder
   * visits the node, before dispatching to whatever opens a child. For a
   * function declaration that is the scope the function is declared in, not the
   * one its body runs in. `visitFunctionLike` read it as the body scope, so
   * **every js_method.bodyScopeLinkHash was the enclosing scope**, every
   * FUNCTION_BODY block linked to the wrong scope, `visitClass` took the
   * enclosing scope for the class scope, and `mintConstructorFunctionType` —
   * expecting the function's own scope and taking `.parent` to reach the
   * enclosing one — overshot to GLOBAL on every constructor function.
   *
   * Populated and wrong, in link columns the engine needs to know where a
   * method's locals live. Nothing counted it because every value was a valid
   * scope hash. Found by an @type-over-assignment resolving from the wrong
   * scope inside a function body.
   *
   * The builder's internal index held the answer under `${kind}:${nodeKey}`;
   * this is the same index keyed on the node alone, because a caller holding a
   * node does not know which kind of scope it opened. The internal one is no
   * longer exported: two public spellings of "the scope this node opens" is the
   * trap this rename exists to close, and nothing outside the builder read it.
   */
  readonly scopeOpenedBy: ReadonlyMap<string, JsScopeNode>;
  /**
   * The innermost scope ENCLOSING each node, for every node the binder visited.
   *
   * ## Named as the opposite of `scopeOpenedBy`, because the old pair invited
   * the biggest defect this front end has had
   *
   * It was `scopeOfNode`, beside `scopeByNode` — two accessors differing by one
   * preposition, with opposite meanings, and the declaration walk read this one
   * as "the scope the node opens" in four places. Every method's body scope was
   * its enclosing scope on every row since the first commit. A fix that left
   * the trap in place would have been the .gitignore-trailing-slash shape: the
   * next reader, moving fast, would have made the same substitution.
   *
   * So the pair now reads as two sentences that cannot be swapped:
   * `enclosingScopeOf(node)` — the scope the node sits IN;
   * `scopeOpenedBy(node)` — the scope the node OPENS. A function declaration
   * has both, and they are different scopes.
   *
   * Built during the walk rather than by comparing positions afterwards.
   * Position comparison picks the wrong scope whenever two of them begin at the
   * same offset, which in JavaScript is constant: an IIFE's parenthesis, its
   * function and its call all start together.
   */
  readonly enclosingScopeOf: ReadonlyMap<string, JsScopeNode>;
  /** Every binding, in declaration order, for `js_variable`. */
  readonly bindings: readonly JsBinding[];
}

export function buildScopes(options: ScopeBuildOptions): ScopeBuildResult {
  const builder = new JsScopeBuilder(options);
  return builder.build();
}

class JsScopeBuilder {
  private readonly sourceFile: ts.SourceFile;
  private readonly options: ScopeBuildOptions;
  private readonly scopes: JsScopeNode[] = [];
  private readonly scopeByNode = new Map<string, JsScopeNode>();
  private readonly enclosingScopeOf = new Map<string, JsScopeNode>();
  private readonly bindings: JsBinding[] = [];
  private globalScope!: JsScopeNode;
  private moduleScope!: JsScopeNode;

  constructor(options: ScopeBuildOptions) {
    this.options = options;
    this.sourceFile = options.sourceFile;
  }

  build(): ScopeBuildResult {
    // The root pair. GLOBAL is the only scope with no parent, and MODULE is its
    // only child — see JsScopeKind.GLOBAL for why the ambient scope is a row
    // rather than an absence.
    this.globalScope = this.openScope({
      node: this.sourceFile,
      kind: JsScopeKind.GLOBAL,
      parent: null,
      isFunctionScope: true,
      bindsThis: true,
      bindsArguments: false,
      isStrictMode: false,
      strictModeSource: JsStrictModeSource.SLOPPY,
      ownerNode: null,
    });

    // An ES module is strict with no opt-out. A CommonJS file is sloppy unless a
    // directive says otherwise, and `hasEsmSyntax` is consulted too because a
    // file with top-level `import` is an ES module by syntax even where its
    // `package.json` says CommonJS — that is the 6.2% contradiction class, and
    // those files really are strict when a bundler runs them.
    const esm = this.options.moduleSystem === JsModuleSystem.ESM
      || this.options.hasEsmSyntax;
    const directive = hasUseStrictDirective(this.sourceFile.statements);
    this.moduleScope = this.openScope({
      node: this.sourceFile,
      kind: JsScopeKind.MODULE,
      parent: this.globalScope,
      isFunctionScope: true,
      bindsThis: true,
      bindsArguments: false,
      isStrictMode: esm || directive,
      strictModeSource: esm
        ? JsStrictModeSource.ESM_IMPLICIT
        : directive
          ? JsStrictModeSource.USE_STRICT_DIRECTIVE
          : JsStrictModeSource.SLOPPY,
      ownerNode: null,
    });

    for (const statement of this.sourceFile.statements) {
      this.visit(statement, this.moduleScope);
    }

    this.bindImplicitGlobals();

    const scopeOpenedBy = new Map<string, JsScopeNode>();
    for (const scope of this.scopes) {
      if (scope.ownerNode !== null) {
        scopeOpenedBy.set(nodeKey(scope.ownerNode), scope);
      }
    }
    return {
      globalScope: this.globalScope,
      moduleScope: this.moduleScope,
      scopes: this.scopes,
      enclosingScopeOf: this.enclosingScopeOf,
      scopeOpenedBy,
      bindings: this.bindings,
    };
  }

  // -------------------------------------------------------------------------
  // scope construction
  // -------------------------------------------------------------------------

  private openScope(init: {
    node: ts.Node;
    kind: JsScopeKind;
    parent: JsScopeNode | null;
    isFunctionScope: boolean;
    bindsThis: boolean;
    bindsArguments: boolean;
    isStrictMode: boolean;
    strictModeSource: JsStrictModeSource;
    ownerNode: ts.Node | null;
  }): JsScopeNode {
    const at = pointOf(init.node, this.sourceFile);
    const scope: JsScopeNode = {
      key: `${init.kind}:${nodeKey(init.node)}`,
      kind: init.kind,
      parent: init.parent,
      depth: init.parent === null ? 0 : init.parent.depth + 1,
      isFunctionScope: init.isFunctionScope,
      bindsThis: init.bindsThis,
      bindsArguments: init.bindsArguments,
      isStrictMode: init.isStrictMode,
      strictModeSource: init.strictModeSource,
      // Inherited, so a scope opened anywhere inside a `with` body carries it.
      // See visitWithStatement for why this direction and not the other.
      hasWithStatement: init.parent?.hasWithStatement ?? false,
      startLine: at.startLine,
      startColumn: at.startColumn,
      children: [],
      bindings: new Map(),
      ownerNode: init.ownerNode,
    };
    init.parent?.children.push(scope);
    this.scopes.push(scope);
    this.scopeByNode.set(scope.key, scope);
    return scope;
  }

  /**
   * Strictness is inherited unless something in this scope overrides it.
   *
   * Three overrides, in order of authority: a class body is strict
   * unconditionally; a `'use strict'` directive at the top of a function body
   * makes that function and everything in it strict; and otherwise the parent's
   * answer stands. Strictness only ever goes one way — there is no directive
   * that turns it off — which is what makes inheritance the right default.
   */
  private strictnessFor(
    parent: JsScopeNode,
    kind: JsScopeKind,
    body: ts.Node | undefined
  ): { isStrictMode: boolean; strictModeSource: JsStrictModeSource } {
    if (kind === JsScopeKind.CLASS || kind === JsScopeKind.CLASS_STATIC_BLOCK) {
      return {
        isStrictMode: true,
        strictModeSource: parent.isStrictMode
          ? parent.strictModeSource
          : JsStrictModeSource.CLASS_BODY_IMPLICIT,
      };
    }
    if (!parent.isStrictMode && body !== undefined && ts.isBlock(body)
      && hasUseStrictDirective(body.statements)) {
      return {
        isStrictMode: true,
        strictModeSource: JsStrictModeSource.USE_STRICT_DIRECTIVE,
      };
    }
    return {
      isStrictMode: parent.isStrictMode,
      strictModeSource: parent.strictModeSource,
    };
  }

  // -------------------------------------------------------------------------
  // pass 1 — the walk
  // -------------------------------------------------------------------------

  /**
   * Visits one node in `scope`, opening a child scope where the node calls for
   * one.
   *
   * Every branch is braced. §6 of `BUILDING-A-PARSER.md`: a dangling `else` in
   * dispatch-heavy extractor code is nearly invisible and silently doubles or
   * drops output, and this function is the densest dispatch in the front end.
   */
  private visit(node: ts.Node, scope: JsScopeNode): void {
    this.enclosingScopeOf.set(nodeKey(node), scope);

    if (ts.isFunctionDeclaration(node)) {
      this.visitFunctionDeclaration(node, scope);
      return;
    }
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      this.visitFunctionLike(node, scope);
      return;
    }
    if (ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
      || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      this.visitFunctionLike(node, scope);
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      this.visitClass(node, scope);
      return;
    }
    if (ts.isClassStaticBlockDeclaration(node)) {
      this.visitStaticBlock(node, scope);
      return;
    }
    if (ts.isVariableStatement(node)) {
      this.visitVariableDeclarationList(node.declarationList, scope);
      return;
    }
    if (ts.isBlock(node)) {
      this.visitBlockScope(node, scope, node.statements);
      return;
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      this.visitForStatement(node, scope);
      return;
    }
    if (ts.isCatchClause(node)) {
      this.visitCatchClause(node, scope);
      return;
    }
    if (ts.isCaseBlock(node)) {
      // A `switch` body is ONE block scope shared by every clause, not one per
      // clause: `case 1: let x = 1; case 2: x;` is legal and refers to the same
      // binding. Emitting a scope per clause would make the second reference
      // unresolved.
      const child = this.openBlockScope(node, scope);
      for (const clause of node.clauses) {
        for (const statement of clause.statements) {
          this.visit(statement, child);
        }
      }
      return;
    }
    if (ts.isWithStatement(node)) {
      this.visitWithStatement(node, scope);
      return;
    }
    if (ts.isImportDeclaration(node)) {
      this.visitImportDeclaration(node, scope);
      return;
    }
    // Everything else: descend, staying in this scope. The descent is
    // unconditional on purpose — a subtree rooted at a node that opens no scope
    // still contains declarations, and §6's parenthesis and JSX-brace failures
    // were both a subtree dying before its children were enqueued.
    ts.forEachChild(node, (child) => {
      this.visit(child, scope);
    });
  }

  /**
   * `function f() {}` — the name hoists, and where to depends on strict mode.
   *
   * In strict mode a function declaration in a block is block-scoped. In sloppy
   * mode Annex B's web-compatibility semantics *also* bind the name as a `var`
   * in the enclosing function scope, which is why real pre-ES6 code calls one
   * from outside the `if` that declares it and works.
   *
   * Modelled as: the declaration scope is the current scope when strict, and the
   * nearest function scope when sloppy. At function or module level the two are
   * the same scope and the distinction does not arise — which is 5,271 of the
   * measured declarations.
   */
  private visitFunctionDeclaration(node: ts.FunctionDeclaration, scope: JsScopeNode): void {
    if (node.name !== undefined) {
      this.declare({
        name: node.name.text,
        regime: JsBindingRegime.FUNCTION_DECLARATION_HOISTED,
        declarationScope: scope.isStrictMode ? scope : nearestFunctionScope(scope),
        syntacticScope: scope,
        declarationNode: node.name,
        hasTemporalDeadZone: false,
      });
    }
    this.visitFunctionLike(node, scope);
  }

  /**
   * Opens a function or arrow scope, binds its parameters, and descends.
   *
   * Three things happen in a deliberate order:
   *
   * 1. **Parameters are bound in the function's own scope**, before the body, so
   *    a default expression can refer to an earlier parameter.
   * 2. **The body is descended into.** Explicitly, because the worklist stopping
   *    at a function boundary is how `return function () { … }` emitted the
   *    function and nothing inside it.
   * 3. **A named function expression binds its own name inside itself, last.**
   *    `function g() { return g; }` assigned to `f` — `g` is visible in the body
   *    and nowhere else, and a parameter or declaration of the same name in the
   *    function shadows it, which is what the runtime does (#682).
   */
  private visitFunctionLike(
    node: ts.FunctionLikeDeclaration,
    scope: JsScopeNode
  ): void {
    const isArrow = ts.isArrowFunction(node);
    const kind = isArrow ? JsScopeKind.ARROW : JsScopeKind.FUNCTION;
    const strictness = this.strictnessFor(scope, kind, node.body);
    const child = this.openScope({
      node,
      kind,
      parent: scope,
      isFunctionScope: true,
      // An arrow binds neither `this` nor `arguments`; it inherits both from
      // where it was written. That single fact is what makes `this` usable in a
      // callback, and it is why ARROW is a scope kind rather than a flag.
      bindsThis: !isArrow,
      bindsArguments: !isArrow,
      isStrictMode: strictness.isStrictMode,
      strictModeSource: strictness.strictModeSource,
      ownerNode: node,
    });

    for (const parameter of node.parameters) {
      // The PARAMETER NODE sits in the function's own scope. Its name is
      // bound there and its default is visited there, but the node itself was
      // never keyed — so a walk up from anything inside it (a JSDoc
      // `/** @type {import('./x').T} */ p`) fell through to the function
      // node, whose enclosing scope is the OUTER one, and the import's owner
      // scope named a scope its owner method does not own. 2 rows of 23,834,
      // both `@type` on a parameter, found by js-corpus's link-meaning sweep.
      this.enclosingScopeOf.set(nodeKey(parameter), child);
      this.bindPattern(parameter.name, child, child, JsBindingRegime.PARAMETER, false);
      if (parameter.initializer !== undefined) {
        // Evaluated in the function's OWN scope, so `(a, b = a)` resolves.
        this.visit(parameter.initializer, child);
      }
    }
    // Decorators and computed member names sit OUTSIDE the function's scope —
    // they are evaluated where the declaration is written. Visiting them in the
    // child would make a name they reference resolve against the parameters,
    // which is Python's trap 1 in its JavaScript form.
    if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)
      || ts.isSetAccessorDeclaration(node)) {
      if (node.name !== undefined && ts.isComputedPropertyName(node.name)) {
        this.visit(node.name.expression, scope);
      }
    }
    if (node.body !== undefined) {
      if (ts.isBlock(node.body)) {
        // The body's statements go directly in the function scope: a function
        // body is not a separate block scope, so `var` and `let` at the top of
        // one are both function-scope-visible.
        for (const statement of node.body.statements) {
          this.visit(statement, child);
        }
      } else {
        // A concise arrow body: `x => x * 2`. One expression, same scope.
        this.visit(node.body, child);
      }
    }
    // The own name of a named function expression, bound LAST (#682). At runtime
    // it lives in a scope of its own between the outer scope and the function's,
    // so a parameter, `var`, `let` or `const` of the same name in the function
    // shadows it: `Model.aggregate = function aggregate() { const aggregate =
    // new Aggregate(); aggregate.model(this); }` reads the instance. The symbol
    // table keeps the first binding of a name in a scope, so binding the name
    // first (as this once did, "so a parameter of the same name shadows it")
    // dropped the parameter and the const instead, and every reference resolved
    // to the function. Bound only when nothing in the function holds the name:
    // that is the intermediate scope without a scope row for it.
    if (ts.isFunctionExpression(node) && node.name !== undefined
      && !child.bindings.has(node.name.text)) {
      this.declare({
        name: node.name.text,
        regime: JsBindingRegime.FUNCTION_DECLARATION_HOISTED,
        declarationScope: child,
        syntacticScope: child,
        declarationNode: node.name,
        hasTemporalDeadZone: false,
      });
    }
  }

  /**
   * A class body: a scope, always strict, binding the class's own name.
   *
   * The heritage clause is evaluated in the ENCLOSING scope — `class X extends
   * mixin(Y)` calls `mixin` before the class exists — so it is visited there and
   * not in the child.
   */
  private visitClass(node: ts.ClassLikeDeclaration, scope: JsScopeNode): void {
    if (ts.isClassDeclaration(node) && node.name !== undefined) {
      this.declare({
        name: node.name.text,
        regime: JsBindingRegime.CLASS_TDZ,
        declarationScope: scope,
        syntacticScope: scope,
        declarationNode: node.name,
        hasTemporalDeadZone: true,
      });
    }
    for (const clause of node.heritageClauses ?? []) {
      for (const type of clause.types) {
        this.visit(type.expression, scope);
      }
    }
    const strictness = this.strictnessFor(scope, JsScopeKind.CLASS, undefined);
    const child = this.openScope({
      node,
      kind: JsScopeKind.CLASS,
      parent: scope,
      isFunctionScope: false,
      bindsThis: true,
      bindsArguments: false,
      isStrictMode: strictness.isStrictMode,
      strictModeSource: strictness.strictModeSource,
      ownerNode: node,
    });
    // The class's own name is bound INSIDE the body too, so a method can reach
    // the class even when the outer binding has been reassigned. This is a
    // separate binding from the one above, in a separate scope, and both are
    // real.
    if (node.name !== undefined) {
      this.declare({
        name: node.name.text,
        regime: JsBindingRegime.CLASS_TDZ,
        declarationScope: child,
        syntacticScope: child,
        declarationNode: node.name,
        hasTemporalDeadZone: true,
      });
    }
    // A field initializer that RUNS code is a body of its own (#798): it executes at class
    // evaluation or during construction, with `this` bound there, not where the class is
    // written. One scope per class per staticness, opened on the first such field, which is
    // the same field the declaration extractor hangs its synthetic callable off.
    for (const isStatic of [true, false]) {
      const field = firstRunningFieldInitializer(node, isStatic);
      if (field === undefined) {
        continue;
      }
      const strictness = this.strictnessFor(child, JsScopeKind.CLASS_STATIC_BLOCK, field);
      this.openScope({
        node: field,
        kind: JsScopeKind.CLASS_STATIC_BLOCK,
        parent: child,
        isFunctionScope: true,
        bindsThis: true,
        bindsArguments: false,
        isStrictMode: strictness.isStrictMode,
        strictModeSource: strictness.strictModeSource,
        ownerNode: field,
      });
    }
    for (const member of node.members) {
      this.visit(member, child);
    }
  }

  private visitStaticBlock(node: ts.ClassStaticBlockDeclaration, scope: JsScopeNode): void {
    const strictness = this.strictnessFor(scope, JsScopeKind.CLASS_STATIC_BLOCK, node.body);
    const child = this.openScope({
      node,
      kind: JsScopeKind.CLASS_STATIC_BLOCK,
      parent: scope,
      isFunctionScope: true,
      bindsThis: true,
      bindsArguments: false,
      isStrictMode: strictness.isStrictMode,
      strictModeSource: strictness.strictModeSource,
      ownerNode: node,
    });
    for (const statement of node.body.statements) {
      this.visit(statement, child);
    }
  }

  private openBlockScope(node: ts.Node, scope: JsScopeNode): JsScopeNode {
    const strictness = this.strictnessFor(scope, JsScopeKind.BLOCK, undefined);
    return this.openScope({
      node,
      kind: JsScopeKind.BLOCK,
      parent: scope,
      isFunctionScope: false,
      bindsThis: scope.bindsThis,
      bindsArguments: scope.bindsArguments,
      isStrictMode: strictness.isStrictMode,
      strictModeSource: strictness.strictModeSource,
      ownerNode: null,
    });
  }

  private visitBlockScope(
    node: ts.Node,
    scope: JsScopeNode,
    statements: ts.NodeArray<ts.Statement>
  ): void {
    const child = this.openBlockScope(node, scope);
    for (const statement of statements) {
      this.visit(statement, child);
    }
  }

  /**
   * A loop head and its body are ONE scope.
   *
   * `for (let i = 0; i < n; i++) { … }` — `i` belongs to a scope the head and
   * the body share, which is what makes each iteration's `i` a distinct binding
   * that a closure can capture. Putting the head in the enclosing scope would
   * make `i` visible after the loop; putting the body in a child of the head
   * would work but adds a scope row for nothing.
   *
   * A `var` in the head still hoists out, because {@link declare} sends it to
   * the nearest function scope — the head being a block scope does not change
   * that, which is the point of having two scope pointers.
   */
  private visitForStatement(
    node: ts.ForStatement | ts.ForInStatement | ts.ForOfStatement,
    scope: JsScopeNode
  ): void {
    const child = this.openBlockScope(node, scope);
    if (ts.isForStatement(node)) {
      if (node.initializer !== undefined) {
        if (ts.isVariableDeclarationList(node.initializer)) {
          this.visitVariableDeclarationList(node.initializer, child);
        } else {
          this.visit(node.initializer, child);
        }
      }
      if (node.condition !== undefined) {
        this.visit(node.condition, child);
      }
      if (node.incrementor !== undefined) {
        this.visit(node.incrementor, child);
      }
    } else {
      if (ts.isVariableDeclarationList(node.initializer)) {
        this.visitVariableDeclarationList(node.initializer, child);
      } else {
        this.visit(node.initializer, child);
      }
      // The iterated expression is evaluated in the ENCLOSING scope — it runs
      // once, before the loop variable exists.
      this.visit(node.expression, scope);
    }
    this.visit(node.statement, child);
  }

  /**
   * `catch (e) { … }` — the parameter gets its own scope.
   *
   * Its own scope and not the block's, because `catch (e) { let e = 1; }` is a
   * legal shadow: the parameter and the block binding are two names in two
   * scopes. A single scope would make that a redeclaration.
   */
  private visitCatchClause(node: ts.CatchClause, scope: JsScopeNode): void {
    const strictness = this.strictnessFor(scope, JsScopeKind.CATCH, node.block);
    const child = this.openScope({
      node,
      kind: JsScopeKind.CATCH,
      parent: scope,
      isFunctionScope: false,
      bindsThis: scope.bindsThis,
      bindsArguments: scope.bindsArguments,
      isStrictMode: strictness.isStrictMode,
      strictModeSource: strictness.strictModeSource,
      ownerNode: null,
    });
    if (node.variableDeclaration !== undefined) {
      this.bindPattern(
        node.variableDeclaration.name,
        child,
        child,
        JsBindingRegime.CATCH_PARAMETER,
        false
      );
    }
    this.visitBlockScope(node.block, child, node.block.statements);
  }

  /**
   * `with (obj) { … }` — a scope in which no name is statically resolvable.
   *
   * ## The flag propagates DOWN, not up
   *
   * Every scope nested inside the body inherits it, because a name written three
   * blocks deep inside a `with` is just as shadowable by the object as one
   * written directly in it. Inheritance happens in {@link openScope}, so a scope
   * created later in the walk gets it too — marking only the `with` scope itself
   * would leave the body's own blocks reading as resolvable.
   *
   * It deliberately does **not** propagate up. An earlier version walked the
   * ancestor chain, on the reasoning that a binding declared outside the `with`
   * is unsafe *when referenced inside it*. That is true and it is not what the
   * column says: the claim is about the scope, and a reference in the module
   * scope *outside* the `with` body resolves perfectly well. Marking the module
   * and global scopes turned a rare local defect into a file-wide one, which is
   * over-claiming in the direction that discards good bindings.
   */
  private visitWithStatement(node: ts.WithStatement, scope: JsScopeNode): void {
    this.visit(node.expression, scope);
    const strictness = this.strictnessFor(scope, JsScopeKind.WITH, undefined);
    const child = this.openScope({
      node,
      kind: JsScopeKind.WITH,
      parent: scope,
      isFunctionScope: false,
      bindsThis: scope.bindsThis,
      bindsArguments: scope.bindsArguments,
      isStrictMode: strictness.isStrictMode,
      strictModeSource: strictness.strictModeSource,
      ownerNode: null,
    });
    child.hasWithStatement = true;
    this.visit(node.statement, child);
  }

  /**
   * `var` / `let` / `const`, including every name a pattern binds.
   *
   * The regime decides the declaration scope, and that is the only place in this
   * file where the two scope columns diverge on purpose.
   */
  private visitVariableDeclarationList(
    list: ts.VariableDeclarationList,
    scope: JsScopeNode
  ): void {
    const isLet = (list.flags & ts.NodeFlags.Let) !== 0;
    const isConst = (list.flags & ts.NodeFlags.Const) !== 0;
    const regime = isConst
      ? JsBindingRegime.CONST_BLOCK_TDZ
      : isLet
        ? JsBindingRegime.LET_BLOCK_TDZ
        : JsBindingRegime.VAR_FUNCTION_SCOPED_HOISTED;
    // THE HOISTING LINE. A `var` is visible from the top of the nearest function
    // scope whatever block it is written in; a `let` stops where it is written.
    const declarationScope = regime === JsBindingRegime.VAR_FUNCTION_SCOPED_HOISTED
      ? nearestFunctionScope(scope)
      : scope;
    for (const declaration of list.declarations) {
      this.bindPattern(
        declaration.name,
        declarationScope,
        scope,
        regime,
        regime !== JsBindingRegime.VAR_FUNCTION_SCOPED_HOISTED
      );
      if (declaration.initializer !== undefined) {
        this.visit(declaration.initializer, scope);
      }
    }
  }

  /**
   * `import { a as b } from 'x'` — every local name it binds.
   *
   * Module-scoped whatever block the declaration is in, because an `import` is
   * only legal at the top level. The specifier itself is a module edge and is
   * the import extractor's business; what happens here is the binding, so a
   * later reference to `b` resolves to `IMPORTED` rather than reading as free.
   */
  private visitImportDeclaration(node: ts.ImportDeclaration, scope: JsScopeNode): void {
    const clause = node.importClause;
    if (clause === undefined) {
      // `import './side-effect.js'` binds nothing. The module edge is still
      // real and is recorded by the import extractor.
      return;
    }
    if (clause.name !== undefined) {
      this.declareImport(clause.name, scope);
    }
    const bindings = clause.namedBindings;
    if (bindings === undefined) {
      return;
    }
    if (ts.isNamespaceImport(bindings)) {
      this.declareImport(bindings.name, scope);
      return;
    }
    for (const element of bindings.elements) {
      this.declareImport(element.name, scope);
    }
  }

  private declareImport(name: ts.Identifier, scope: JsScopeNode): void {
    this.declare({
      name: name.text,
      regime: JsBindingRegime.IMPORT_BINDING,
      declarationScope: this.moduleScope,
      syntacticScope: scope,
      declarationNode: name,
      hasTemporalDeadZone: true,
    });
  }

  /**
   * Binds every name in a binding name, which may be a whole pattern.
   *
   * One call per *name*, so `const { a, b: [c] } = o` produces three bindings.
   * The pattern itself is not a binding — it is the syntax that produces them —
   * and `js_variable.bindingForm` plus `patternRootVariableLinkHash` are what
   * keep the grouping visible.
   */
  private bindPattern(
    name: ts.BindingName,
    declarationScope: JsScopeNode,
    syntacticScope: JsScopeNode,
    regime: JsBindingRegime,
    hasTemporalDeadZone: boolean
  ): void {
    if (ts.isIdentifier(name)) {
      this.declare({
        name: name.text,
        regime,
        declarationScope,
        syntacticScope,
        declarationNode: name,
        hasTemporalDeadZone,
      });
      return;
    }
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) {
        // A hole in an array pattern: `const [, b] = xs`. Binds nothing, and
        // still occupies a position, which the variable extractor records.
        continue;
      }
      this.bindPattern(
        element.name,
        declarationScope,
        syntacticScope,
        regime,
        hasTemporalDeadZone
      );
      if (element.initializer !== undefined) {
        this.visit(element.initializer, syntacticScope);
      }
      if (ts.isBindingElement(element) && element.propertyName !== undefined
        && ts.isComputedPropertyName(element.propertyName)) {
        this.visit(element.propertyName.expression, syntacticScope);
      }
    }
  }

  private declare(init: {
    name: string;
    regime: JsBindingRegime;
    declarationScope: JsScopeNode;
    syntacticScope: JsScopeNode;
    declarationNode: ts.Node | null;
    hasTemporalDeadZone: boolean;
  }): void {
    const binding: JsBinding = { ...init, redeclarationCount: 0 };
    const kept = addBinding(binding);
    if (kept === binding) {
      this.bindings.push(binding);
    }
  }

  // -------------------------------------------------------------------------
  // pass 2 — the bindings nobody declared
  // -------------------------------------------------------------------------

  /**
   * `GLOBAL_IMPLICIT`: a sloppy-mode assignment to a name with no declaration.
   *
   * ## Why this cannot be folded into pass 1
   *
   * Whether `x = 1` declares anything depends on whether `x` is declared
   * *anywhere* in the enclosing chain — including on a line below it, since a
   * `var` hoists and a function declaration hoists with its body. So the
   * question is unanswerable until pass 1 has finished, exactly as CPython's
   * `analyze_block` is a separate top-down walk for the same structural reason.
   *
   * ## Why it is a binding and not a curiosity
   *
   * It is the one binding with **no declaration syntax anywhere**, and it is
   * visible to other files: in sloppy mode `x = 1` creates a property on the
   * global object. Parenting it at the module scope would assert it is
   * module-local, which is the single thing it is not — so it lands in `GLOBAL`.
   *
   * In strict mode the same line throws, so nothing is bound and nothing is
   * emitted. That asymmetry is why `js_scope.isStrictMode` is load-bearing
   * rather than bookkeeping.
   */
  private bindImplicitGlobals(): void {
    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(node.left)) {
        const scope = this.enclosingScopeOf.get(nodeKey(node))
          ?? this.enclosingScopeOf.get(nodeKey(node.left));
        if (scope !== undefined && !scope.isStrictMode) {
          const name = node.left.text;
          if (!this.isBoundAnywhere(scope, name)) {
            this.declare({
              name,
              regime: JsBindingRegime.GLOBAL_IMPLICIT,
              declarationScope: this.globalScope,
              syntacticScope: scope,
              declarationNode: node.left,
              hasTemporalDeadZone: false,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(this.sourceFile, visit);
  }

  private isBoundAnywhere(scope: JsScopeNode, name: string): boolean {
    for (let current: JsScopeNode | null = scope; current !== null;
      current = current.parent) {
      if (current.bindings.has(name)) {
        return true;
      }
    }
    return false;
  }
}

/**
 * A `'use strict'` directive at the top of a statement list.
 *
 * The directive prologue is the run of string-literal expression statements at
 * the very start — so `'use asm'; 'use strict';` counts and
 * `doThing(); 'use strict';` does not. Scanning the whole list would make a
 * string used as a value turn a sloppy function strict, which changes whether
 * every undeclared assignment in it is a binding or a throw.
 */
function hasUseStrictDirective(statements: ts.NodeArray<ts.Statement>): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement)
      || !ts.isStringLiteralLike(statement.expression)) {
      return false;
    }
    if (statement.expression.text === 'use strict') {
      return true;
    }
  }
  return false;
}
