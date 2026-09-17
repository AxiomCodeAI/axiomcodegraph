import Parser from 'tree-sitter';

import { CsRootContext } from '@/enums/csharp/expressions';
import { isExpressionNode } from '@/parsers/csharp/extractors/cs-expression-extractor';
import { childOfType, namedChildren } from '@/parsers/csharp/extractors/cs-node';
import {
  PREPROC_CHAIN_ROOT,
  activeNamedChildren,
  resolvePreprocBranches,
} from '@/parsers/csharp/extractors/preproc-context';

/**
 * Finds the EXPRESSION ROOTS inside a statement body.
 *
 * ## The allowlist governs EXPRESSIONS, not the descent
 *
 * §6 says use an allowlist of expression positions, and that still holds — what
 * becomes a `cs_expression` row is decided by {@link isExpressionNode} and
 * nothing else, so a type name in a statement position emits nothing.
 *
 * But the first version also had an allowlist of STATEMENT CONTAINERS, and that
 * was a mistake with a measured cost. It listed `for_each_statement`; the
 * grammar's node is `foreach_statement`. The name matched nothing, so a
 * `foreach` was neither descended into nor read for expressions — **every
 * expression and every call in every `foreach` body was invisible**, and no
 * count could see it because the enclosing method's other statements were all
 * present. `else_clause` was the same: the grammar has no such node, `if` binds
 * its branches as `consequence` and `alternative` fields.
 *
 * So the descent is now TOTAL. Anything that is not an expression is walked
 * into. An unrecognised statement contributes its expressions instead of
 * swallowing its subtree, which is the same "unwrap in one place" discipline
 * that `PARENTHESIZED` needed — a node that produces no row must not take its
 * children with it.
 *
 * The statement table that remains says only what CONTEXT a position gets, and
 * a statement missing from it still yields its expressions, under
 * `UNKNOWN_CONTEXT`. That value being emitted is a signal, not a defect: it
 * names a position nobody has classified yet.
 *
 * ## Lambda bodies are NOT walked here
 *
 * §6 again: the worklist stops at function boundaries. A lambda's body belongs
 * to the lambda's own `cs_method` row, and walking it with the enclosing method
 * as owner attributes every call inside a callback to whoever created it.
 * {@link collectLambdas} finds them so the caller can give each one an owner.
 */

export interface ExpressionRoot {
  readonly node: Parser.SyntaxNode;
  readonly rootContext: CsRootContext;
  /** Locals declared BEFORE this point in the enclosing block. */
  readonly localNames: ReadonlySet<string>;
  /**
   * The local functions IN SCOPE at this point: those declared directly in
   * the block this root sits in or in any block enclosing it — the whole of
   * each such block, before and after the declaration — and nothing declared
   * in a sibling block, a nested block, or a callable this root is not inside.
   *
   * It was "every local function anywhere in the body", which is wrong in the
   * direction that INVENTS: a local function named `GetOrAdd` nested inside
   * one branch made every `GetOrAdd(…)` in the method a LOCAL_FUNCTION_CALL,
   * including the calls to the static method of that name. cs-corpus counted
   * 69 such calls in one stratum, all ordinary static methods. A positive
   * claim about what a name resolves to requires the declaration in an
   * ENCLOSING scope of the use, not merely in the same file.
   */
  readonly localFunctionNames: ReadonlySet<string>;
}

/**
 * The scope in effect at a nested callable's declaration, so its own body can
 * be walked seeing what the enclosing body saw at that point: `x => scale(x)`
 * is a DELEGATE_INVOKE because `scale` is an enclosing local, and `Inner()`
 * inside a lambda is a LOCAL_FUNCTION_CALL because `Inner` is declared in the
 * block the lambda sits in.
 */
export interface BoundaryScope {
  readonly localNames: ReadonlySet<string>;
  readonly localFunctionNames: ReadonlySet<string>;
}

/**
 * What a body walk inherits from the body it is nested in, and where it
 * records the scope at each root and each function boundary it passes.
 */
export interface WalkScope {
  readonly enclosingLocals?: ReadonlySet<string>;
  readonly enclosingLocalFunctions?: ReadonlySet<string>;
  /**
   * Keyed on `node.id`, never written onto the node: the scope at every root
   * and every `local_function_statement` this walk passes. A lambda is found
   * later by {@link collectLambdas} inside some root's expression, and
   * {@link scopeAt} climbs from it to that root's entry.
   */
  readonly boundaries?: Map<number, BoundaryScope>;
}

/**
 * The context an expression gets from the statement it sits in.
 *
 * Node names verified against the grammar's own `node-types.json` and declared
 * in `extractor-grammar-reads.json`, so a rename is a NAMED gate failure rather
 * than a statement that silently stops contributing.
 */
const STATEMENT_ROOT_CONTEXT: ReadonlyMap<string, CsRootContext> = new Map([
  ['expression_statement', CsRootContext.EXPRESSION_STATEMENT],
  ['return_statement', CsRootContext.RETURN_VALUE],
  ['throw_statement', CsRootContext.THROW_VALUE],
  ['yield_statement', CsRootContext.YIELD_VALUE],
  ['if_statement', CsRootContext.CONDITION],
  ['while_statement', CsRootContext.CONDITION],
  ['do_statement', CsRootContext.CONDITION],
  ['switch_statement', CsRootContext.SWITCH_SUBJECT],
  ['switch_section', CsRootContext.CASE_LABEL],
  // Fork rule 21's label form: a stacked `case X:` under a `#if`, the
  // section's statements after the `#endif`. The label is its own node
  // inside the `preproc_if`, and its expression is a case label like any.
  ['switch_label', CsRootContext.CASE_LABEL],
  ['lock_statement', CsRootContext.LOCK_SUBJECT],
  ['using_statement', CsRootContext.USING_RESOURCE],
  ['fixed_statement', CsRootContext.USING_RESOURCE],
  ['for_statement', CsRootContext.LOOP_HEADER],
  // `foreach_statement`, and the underscore matters — see the class comment.
  ['foreach_statement', CsRootContext.LOOP_HEADER],
  ['goto_statement', CsRootContext.EXPRESSION_STATEMENT],
]);

export function collectExpressionRoots(
  body: Parser.SyntaxNode | readonly Parser.SyntaxNode[],
  /**
   * The symbols this emission compiles under.
   *
   * THIS WAS `new Set()`. Every `#if` inside every method body was therefore
   * resolved against an EMPTY symbol set: the `#if` branch was never taken and
   * the `#else` always was, in every file, regardless of the configuration the
   * module row names. Not a shortfall — an INVERSION. The fact base described
   * the program that was not selected, and a multi-targeting repository read
   * entirely backwards below the declaration level.
   *
   * The type, member, using, attribute and region walks all threaded the set
   * correctly; this one call did not, and no gate compared them. It is required
   * rather than defaulted for that reason: a default is what let it be omitted.
   */
  activeSymbols: ReadonlySet<string>,
  scope: WalkScope = {}
): ExpressionRoot[] {
  const roots: ExpressionRoot[] = [];
  const boundaries = scope.boundaries;
  // Locals accumulate as the walk passes declarations, so a reference can be
  // classified LOCAL_VARIABLE without a binder. Purely syntactic: the name was
  // declared textually earlier in an enclosing block.
  // ONE shared table of every local the body declares, each with the ORDINAL
  // at which it was declared. A root sees a local if the local's ordinal is
  // below the count of declarations before the root — so a root costs one
  // integer, not a copy of the set.
  //
  // It was a copy per root. A body of N declaring statements copied a set of
  // size up to N, N times: a second quadratic hiding behind the first, visible
  // only once the first was gone (4,000 statements: 6.5 s; 8,000: 13.6 s).
  const declaredAt = new Map<string, number>();
  const locals = {
    add: (name: string): void => {
      // The FIRST declaration's ordinal is the one that matters: a name
      // re-declared in a sibling block later is still visible from the point
      // it was first declared, as far as a textual "declared earlier" rule
      // can say.
      if (!declaredAt.has(name)) {
        declaredAt.set(name, declaredAt.size);
      }
    },
    get size(): number {
      return declaredAt.size;
    },
  };
  const ownSnapshot = (): ReadonlySet<string> => new VisibleNames(declaredAt, declaredAt.size);
  const enclosingLocals = scope.enclosingLocals;
  const currentSnapshot = (): ReadonlySet<string> =>
    enclosingLocals === undefined ? ownSnapshot() : new ScopeChain(ownSnapshot(), enclosingLocals);

  // The local-function scope is a CHAIN of blocks, not a table with ordinals:
  // a local function is visible throughout the block that declares it, before
  // its declaration as well as after, and in every block nested inside — so
  // entering a block that declares any pushes a frame and leaving it pops.
  // Nothing is copied per root; a root holds the frame it was reached under.
  const rootFunctionScope: ReadonlySet<string> = scope.enclosingLocalFunctions ?? EMPTY_NAMES;

  const record = (node: Parser.SyntaxNode, functionScope: ReadonlySet<string>): void => {
    if (boundaries !== undefined) {
      boundaries.set(node.id, { localNames: currentSnapshot(), localFunctionNames: functionScope });
    }
  };
  const pushRoot = (
    node: Parser.SyntaxNode,
    rootContext: CsRootContext,
    functionScope: ReadonlySet<string>
  ): void => {
    roots.push({ node, rootContext, localNames: currentSnapshot(), localFunctionNames: functionScope });
    record(node, functionScope);
  };

  const visit = (
    node: Parser.SyntaxNode,
    inherited: CsRootContext,
    functionScope: ReadonlySet<string>
  ): void => {
    // A `#if` inside a body selects statements the same way it selects members:
    // a statement in an inactive branch is not in the program, and its calls
    // are not edges.
    if (node.type === PREPROC_CHAIN_ROOT) {
      const { branches, bodies } = resolvePreprocBranches(node, activeSymbols);
      for (const branch of branches) {
        if (branch.isActive) {
          for (const child of bodies.get(branch.branchIndex) ?? []) {
            visit(child, inherited, functionScope);
          }
        }
      }
      return;
    }

    // An EXPRESSION handed to the walk directly is a root. The only path here
    // is a `#if` whose taken branch holds an expression rather than a
    // statement — `return\n#if A\n T(o)\n#else\n S(o)\n#endif\n;` — and the
    // loop below pushes CHILDREN as roots, so the invocation itself was never
    // one: it was descended into, and its callee identifier came out as a bare
    // NAME_REFERENCE root while the call vanished. A right-looking row, the
    // wrong kind, and no call site.
    if (isExpressionNode(node)) {
      pushRoot(node, inherited, functionScope);
      return;
    }

    // A FUNCTION BOUNDARY. Its body is its own method's, and descending here
    // would attribute a callback's calls to whoever created it. The scope at
    // the boundary is recorded so that body can be walked seeing it.
    if (
      node.type === 'lambda_expression' ||
      node.type === 'anonymous_method_expression' ||
      node.type === 'local_function_statement'
    ) {
      record(node, functionScope);
      return;
    }

    if (node.type === 'local_declaration_statement') {
      collectDeclarators(node, locals, (initializer) =>
        pushRoot(initializer, CsRootContext.VARIABLE_INITIALIZER, functionScope)
      );
      return;
    }

    // A BLOCK SCOPE. The local functions it declares directly are visible in
    // all of it and in everything nested under it.
    let scopeHere = functionScope;
    if (DECLARING_SCOPES.has(node.type)) {
      const declared = directLocalFunctionNames(node, activeSymbols);
      if (declared.size > 0) {
        scopeHere = new ScopeChain(declared, functionScope);
      }
    }

    const context = STATEMENT_ROOT_CONTEXT.get(node.type) ?? inherited;

    for (const child of namedChildren(node)) {
      // An EXPRESSION becomes a root; anything else is descended into. The
      // descent is total on purpose: a statement type nobody listed must not
      // swallow its subtree.
      if (isExpressionNode(child)) {
        pushRoot(child, context, scopeHere);
        continue;
      }
      visit(child, context, scopeHere);
    }
  };

  // A body's own statements have no inherited context until a statement gives
  // them one. `UNKNOWN_CONTEXT` is a declared value and emitting it is a
  // SIGNAL: it names a position nobody has classified.
  // A LIST of statements shares one locals table: the top-level statements
  // of a `Program.cs` are siblings under the compilation unit rather than
  // children of one body, and walking them one at a time gave each a fresh
  // scope — so `var scale = …` on line 5 was invisible to `scale(n)` on line
  // 37, which Roslyn adjudicates as a DELEGATE_INVOKE and the parser filed as
  // a FUNCTION_CALL.
  if (Array.isArray(body)) {
    // The statement LIST is itself the declaring scope of its local functions.
    const statements = body as readonly Parser.SyntaxNode[];
    const declared = new Set<string>();
    for (const statement of statements) {
      for (const name of directLocalFunctionNamesAmong([statement], activeSymbols)) {
        declared.add(name);
      }
    }
    const listScope = declared.size > 0 ? new ScopeChain(declared, rootFunctionScope) : rootFunctionScope;
    for (const statement of statements) {
      visit(statement, CsRootContext.UNKNOWN_CONTEXT, listScope);
    }
    return roots;
  }
  visit(body as Parser.SyntaxNode, CsRootContext.UNKNOWN_CONTEXT, rootFunctionScope);
  return roots;
}

/**
 * The scope a nested callable was declared under, from the table a body walk
 * filled: the callable's own entry if the walk passed it as a statement, else
 * the entry of the root whose expression it sits inside, found by climbing.
 * `undefined` when the walk never reached it — the caller then falls back to
 * the enclosing body's own scope rather than inventing one.
 */
export function scopeAt(
  node: Parser.SyntaxNode,
  boundaries: ReadonlyMap<number, BoundaryScope>,
  stopAt: Parser.SyntaxNode | readonly Parser.SyntaxNode[]
): BoundaryScope | undefined {
  const stopIds = new Set(
    Array.isArray(stopAt) ? (stopAt as readonly Parser.SyntaxNode[]).map((n) => n.id) : [(stopAt as Parser.SyntaxNode).id]
  );
  let current: Parser.SyntaxNode | null = node;
  while (current !== null) {
    const found = boundaries.get(current.id);
    if (found !== undefined) {
      return found;
    }
    if (stopIds.has(current.id)) {
      return undefined;
    }
    current = current.parent;
  }
  return undefined;
}

/** Node types whose DIRECT statements are in one declaring scope. */
const DECLARING_SCOPES: ReadonlySet<string> = new Set(['block', 'switch_section']);

const EMPTY_NAMES: ReadonlySet<string> = new Set();

/**
 * The names of the local functions a scope declares DIRECTLY — through an
 * active `#if` branch or a label, but not inside a nested block.
 */
function directLocalFunctionNames(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): ReadonlySet<string> {
  return directLocalFunctionNamesAmong(activeNamedChildren(node, activeSymbols), activeSymbols);
}

function directLocalFunctionNamesAmong(
  statements: readonly Parser.SyntaxNode[],
  activeSymbols: ReadonlySet<string>
): ReadonlySet<string> {
  const names = new Set<string>();
  const stack = [...statements];
  while (stack.length > 0) {
    const statement = stack.pop()!;
    if (statement.type === 'local_function_statement') {
      const nameNode = statement.childForFieldName('name');
      if (nameNode !== null) {
        names.add(nameNode.text);
      }
      continue;
    }
    // A `#if` around statements and a label in front of one are transparent
    // to scope; nothing else is.
    if (statement.type === PREPROC_CHAIN_ROOT || statement.type === 'labeled_statement') {
      stack.push(...activeNamedChildren(statement, activeSymbols));
    }
  }
  return names;
}

function collectDeclarators(
  node: Parser.SyntaxNode,
  locals: { add(name: string): void; readonly size: number },
  pushInitializer: (initializer: Parser.SyntaxNode) => void
): void {
  const declaration = childOfType(node, 'variable_declaration');
  if (declaration === undefined) {
    return;
  }
  for (const declarator of namedChildren(declaration)) {
    if (declarator.type !== 'variable_declarator') {
      continue;
    }
    const nameNode = declarator.childForFieldName('name');
    // The initializer is a DIRECT CHILD of the declarator, not wrapped in an
    // `equals_value_clause` — that form is used for parameter defaults. Looking
    // for the wrapper found nothing, so every local's initializer was silently
    // dropped: `var ok = (A() && B())` produced no expression and no call site.
    const initializer = namedChildren(declarator).find(
      (child) =>
        (nameNode === null || child.id !== nameNode.id) &&
        child.type !== 'bracketed_argument_list' &&
        // `var (a, b) = CreateLogger();` has NO name field, so the first named
        // child is the TUPLE PATTERN and a naive "first non-name child" takes
        // the pattern as the initializer. The call on the right is then never
        // walked, and deconstruction is common enough to notice.
        child.type !== 'tuple_pattern'
    );
    if (initializer !== undefined) {
      pushInitializer(initializer);
    }
    // Added AFTER its own initializer is recorded: `var x = x` refers to an
    // outer `x`, and adding the name first would classify the reference as
    // pointing at the variable being declared.
    if (nameNode !== null) {
      locals.add(nameNode.text);
    }
  }
}

/**
 * Every lambda and anonymous method in a body, INCLUDING nested ones.
 *
 * Returned so the caller can mint a `cs_method` row for each and walk its body
 * with that method as owner — which is what makes a call inside a callback
 * belong to the callback.
 */
export function collectLambdas(
  body: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode[] {
  const found: Parser.SyntaxNode[] = [];
  // ACTIVE children only. A lambda in the branch this emission does not take
  // was getting a method row, and cs-oracle's reading of the grammar says why:
  // both branches are descendants of the `preproc_if`, so a walk that simply
  // recurses finds both.
  const stack = activeNamedChildren(body, activeSymbols);
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'local_function_statement') {
      // Its own method row already exists and its lambdas are collected from
      // there. Descending here would emit each of them twice, and duplicates
      // DOUBLE rather than collide.
      continue;
    }
    if (
      node.type === 'lambda_expression' ||
      node.type === 'anonymous_method_expression'
    ) {
      found.push(node);
      // Nested lambdas are collected when THIS one's body is walked, for the
      // same reason.
      continue;
    }
    for (const child of activeNamedChildren(node, activeSymbols)) {
      stack.push(child);
    }
  }
  return found;
}

/**
 * The locals visible at one root: those declared BEFORE it, by ordinal.
 *
 * Implements just enough of `ReadonlySet` for the two consumers that exist —
 * both call `has` — over a table shared by every root in the body. O(1) to
 * create, O(1) to query, and no copy. The remaining members are implemented
 * honestly rather than stubbed so a future consumer that iterates gets the
 * right answer, not a silent empty one.
 */
class VisibleNames implements ReadonlySet<string> {
  constructor(
    private readonly declaredAt: ReadonlyMap<string, number>,
    private readonly visibleCount: number
  ) {}

  has(name: string): boolean {
    const ordinal = this.declaredAt.get(name);
    return ordinal !== undefined && ordinal < this.visibleCount;
  }

  get size(): number {
    return this.visibleCount;
  }

  *entries(): SetIterator<[string, string]> {
    for (const name of this.values()) {
      yield [name, name];
    }
  }

  *keys(): SetIterator<string> {
    yield* this.values();
  }

  *values(): SetIterator<string> {
    for (const [name, ordinal] of this.declaredAt) {
      if (ordinal < this.visibleCount) {
        yield name;
      }
    }
  }

  forEach(fn: (value: string, value2: string, set: ReadonlySet<string>) => void): void {
    for (const name of this.values()) {
      fn(name, name, this);
    }
  }

  [Symbol.iterator](): SetIterator<string> {
    return this.values();
  }

  get [Symbol.toStringTag](): string {
    return 'VisibleNames';
  }
}

/**
 * One scope frame over an enclosing one, read-only and uncopied.
 *
 * `has` is the frame then the parent; the iteration members are honest unions
 * so a consumer that iterates gets every name once. A chain is O(depth) to
 * query and O(1) to build, which is what lets every root hold its own scope
 * without the per-root copy that was the second quadratic.
 */
class ScopeChain implements ReadonlySet<string> {
  constructor(
    private readonly own: ReadonlySet<string>,
    private readonly parent: ReadonlySet<string>
  ) {}

  has(name: string): boolean {
    return this.own.has(name) || this.parent.has(name);
  }

  get size(): number {
    let n = 0;
    for (const _ of this.values()) {
      n += 1;
    }
    return n;
  }

  *entries(): SetIterator<[string, string]> {
    for (const name of this.values()) {
      yield [name, name];
    }
  }

  *keys(): SetIterator<string> {
    yield* this.values();
  }

  *values(): SetIterator<string> {
    const seen = new Set<string>();
    for (const name of this.own) {
      seen.add(name);
      yield name;
    }
    for (const name of this.parent) {
      if (!seen.has(name)) {
        seen.add(name);
        yield name;
      }
    }
  }

  forEach(fn: (value: string, value2: string, set: ReadonlySet<string>) => void): void {
    for (const name of this.values()) {
      fn(name, name, this);
    }
  }

  [Symbol.iterator](): SetIterator<string> {
    return this.values();
  }
}
