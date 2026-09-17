import * as ts from 'typescript';

/**
 * Node-shape predicates shared by the JavaScript extractors.
 *
 * The counterpart of `java-tree-sitter-utils.ts`: questions about what a node
 * *is*, kept apart from what any relation does with the answer.
 *
 * ## Every function here answers a question more than one extractor asks
 *
 * That is the bar for being in this file. `unwrap` is deliberately **not** here
 * — it is about what the expression relation emits, not about node shape, and
 * §6's lesson is that unwrapping must happen in exactly one place, which is the
 * place that enqueues children.
 */

/**
 * `require(<something>)` with `require` as a bare identifier.
 *
 * ## One spelling, because there were four
 *
 * The module extractor asked it to set `hasRequireCall`, the declaration
 * extractor to classify an initializer, the expression extractor to decide
 * `isModuleEdge`, and the module-edge extractor to mint the row. Four
 * predicates that must agree — and if they stop agreeing, an expression is
 * flagged as a module edge with no edge row pointing at it, which is precisely
 * what gate 7.3.1 exists to catch after the fact.
 *
 * ## Bare identifier only, and that is a decision
 *
 * `mod.require(x)` is a method call on something else, and treating it as a
 * module edge would invent one. A **non-literal argument still counts**: the
 * edge exists and its target is unknowable, which the row records as
 * `specifierKind = NON_LITERAL` rather than guessing — 17 measured, and a
 * guessed module edge is worse than an absent one because nothing downstream
 * can tell it from a real one.
 */
// Plain `boolean`, not a type predicate. A predicate narrows the NEGATIVE branch
// too, so a caller whose parameter is already a `ts.CallExpression` gets `never`
// in its `else` and a compile error on any property access. These are asked of
// `ts.Node` and of `ts.CallExpression` alike, and every caller that needs the
// narrowing already has it.
export function isRequireCall(node: ts.Node): boolean {
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'require'
    && node.arguments.length >= 1;
}

/**
 * `import('x')`.
 *
 * A module edge **and** a real call, unlike `require`: its result is a promise
 * that flows somewhere, so it mints a `js_call_site` row as well. `require`
 * mints none, because counting its 9,055 measured sites as unresolved calls is
 * what made the raw resolution figure look worse than it is.
 */
export function isDynamicImportCall(node: ts.Node): boolean {
  return ts.isCallExpression(node)
    && node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

/** Either form of expression-borne module edge — 83.6% of all edges. */
export function isModuleEdgeCall(node: ts.Node): boolean {
  return isRequireCall(node) || isDynamicImportCall(node);
}

/**
 * The four forms that open a scope binding `this` and `arguments`.
 *
 * An arrow is deliberately absent: it opens a scope for `var`, and binds
 * neither `this` nor `arguments`. That single difference is the whole of lexical
 * `this`, and it is why `JsScopeKind` has `ARROW` as its own kind rather than a
 * flag on `FUNCTION`.
 */
export function opensThisScope(node: ts.Node): boolean {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isClassStaticBlockDeclaration(node);
}

/**
 * Any callable boundary, **arrows included**.
 *
 * ## Not the same question as {@link opensThisScope}, and the difference bites
 *
 * `opensThisScope` answers *does this rebind `this` and `arguments`*, and an
 * arrow does not — that is the whole of lexical `this`. This answers *is code
 * inside this node still at the top level*, and an arrow very much ends the top
 * level: `const f = async () => { await x; };` has no top-level await.
 *
 * The two were briefly one function when these utils were extracted, and the
 * byte-identity check on the refactor caught it: `hasTopLevelAwait` flipped to
 * true on **33 of 816 real files**, every one of them an `await` inside an async
 * arrow. A shared predicate whose name fits one call site and not the other is
 * the failure mode extracting a util invites, and it produced a wrong column in
 * a relation nothing else would have questioned.
 */
export function opensFunctionBoundary(node: ts.Node): boolean {
  return opensThisScope(node) || ts.isArrowFunction(node);
}

/** A function expression or arrow — a callable in expression position. */
export function isCallableExpression(node: ts.Node): boolean {
  return ts.isFunctionExpression(node) || ts.isArrowFunction(node);
}

/**
 * Does a class field initializer RUN anything? A `this`, a call, a `new` or a tagged
 * template is code whose owner matters (#798): it runs at class evaluation or during
 * construction, not where the class is written. A literal, an identifier read or an array
 * of literals is not, and minting a callable for it would add a member row to every class
 * in the corpus that has a plain field.
 *
 * Shared by the scope builder and the declaration extractor so the scope that is opened
 * and the method row that points at it are decided by ONE predicate. Two copies would
 * drift, and the failure would be a method row whose body scope does not exist.
 */
export function initializerRunsCode(node: ts.Expression): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) {
      return;
    }
    if (n.kind === ts.SyntaxKind.ThisKeyword || ts.isCallExpression(n)
      || ts.isNewExpression(n) || ts.isTaggedTemplateExpression(n)) {
      found = true;
      return;
    }
    // A nested callable has its own owner; what it does inside is not this initializer
    // running code, it is a function being defined.
    if (isCallableExpression(n) || ts.isClassLike(n)) {
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * The field whose initializer opens the class's static or instance initialization scope:
 * the FIRST one that runs code, in source order. One scope and one callable per class per
 * staticness, and both sides pick it the same way (#798).
 */
export function firstRunningFieldInitializer(
  node: ts.ClassLikeDeclaration, isStatic: boolean,
): ts.PropertyDeclaration | undefined {
  for (const member of node.members) {
    if (!ts.isPropertyDeclaration(member) || member.initializer === undefined) {
      continue;
    }
    if (isCallableExpression(member.initializer) || !initializerRunsCode(member.initializer)) {
      continue;
    }
    const memberIsStatic = (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) !== 0;
    if (memberIsStatic === isStatic) {
      return member;
    }
  }
  return undefined;
}

/**
 * The nearest ancestor satisfying a predicate, `node` itself included.
 *
 * ## Why a primitive rather than fifteen hand-rolled loops
 *
 * There were fifteen ancestor walks across the extractors, and their **stop
 * conditions differed on purpose** — one stops at the enclosing statement, one
 * at the enclosing function, one at the source file. Merging them into a single
 * opinionated helper would have been wrong; leaving fifteen loops means fifteen
 * chances to write `current.parent` where `current` was meant.
 *
 * So the walk is one function and the *stopping* stays at the call site, where
 * it is a visible argument rather than a loop condition someone has to read.
 *
 * `stopAfter` is inclusive: the predicate is tested on a node that satisfies it
 * before the walk halts, so `enclosingStatement` can ask for "a statement" and
 * "stop at a statement" in one call.
 */
export function nearestAncestor(
  node: ts.Node,
  matches: (candidate: ts.Node) => boolean,
  stopAfter?: (candidate: ts.Node) => boolean
): ts.Node | undefined {
  let current: ts.Node | undefined = node;
  while (current !== undefined) {
    if (matches(current)) {
      return current;
    }
    if (ts.isSourceFile(current) || stopAfter?.(current) === true) {
      return undefined;
    }
    current = current.parent;
  }
  return undefined;
}

/**
 * The statement a node sits in.
 *
 * What a leading comment precedes, and where a JSDoc block attaches. A
 * variable's row is keyed on its **identifier**, several tokens past where the
 * comment sits, which is why a comment scan that looks only at declaration
 * offsets finds no owner for any annotated variable.
 */
export function enclosingStatement(node: ts.Node): ts.Node | undefined {
  return nearestAncestor(node, (candidate) => ts.isStatement(candidate));
}

/**
 * The `VariableDeclaration` a node initialises, if it does.
 *
 * Only a property access may sit between: `require('x').Thing` is how CommonJS
 * pulls one export out. Anything else between the call and the declaration means
 * the result is being *used* rather than *bound*, so there is no binding to name
 * — and reporting one would attribute a module alias to a name that does not
 * hold the module.
 */
export function enclosingVariableDeclaration(
  node: ts.Node
): ts.VariableDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isVariableDeclaration(current)) {
      return current;
    }
    if (!ts.isPropertyAccessExpression(current)) {
      return undefined;
    }
    current = current.parent;
  }
  return undefined;
}

/**
 * The JSDoc block a tag belongs to.
 *
 * A tag's parent chain reaches the block; the block's parent is the node the
 * comment documents. Asking the **tag** rather than walking down from a
 * declaration is the only way to reach a block at end of file, which attaches to
 * the EOF token and documents no declaration at all — three `@template`
 * parameters lived there in one fixture corpus.
 */
export function jsDocContainerOf(tag: ts.Node): ts.Node | undefined {
  return nearestAncestor(tag, (candidate) => candidate.kind === ts.SyntaxKind.JSDoc);
}

/**
 * Every JSDoc tag on a node, across ALL its attached blocks.
 *
 * ## `ts.getJSDocTags` is wrong in both directions
 *
 * It returns **only the last attached block's** tags, so a file opening with two
 * `@typedef` comments above its first statement loses both — measured: three
 * blocks in, one block's tags out. And its results **inherit to child nodes**,
 * so a walk that calls it on every node counts a function's `@param` again on
 * the parameter.
 *
 * `js-oracle` shipped both errors and corrected its published counts after the
 * first was reported: `@typedef` 677 -> 1,825, `@type` 18,674 -> 8,869. Its
 * standing instruction is to read `node.jsDoc[].tags` and never
 * `ts.getJSDocTags` for counting, and this is that instruction as a function.
 *
 * A `JSDoc` **block** passed directly returns its own tags, because a block at
 * end of file has no owning node to ask.
 */
/** The tags of the LAST block attached to `node` — the block the compiler types from. */
export function jsDocTagsOfLastBlock(node: ts.Node): readonly ts.JSDocTag[] {
  const blocks = (node as { jsDoc?: ts.JSDoc[] }).jsDoc;
  const last = blocks?.[blocks.length - 1];
  return last === undefined ? [] : [...(last.tags ?? [])];
}

export function jsDocTagsOfAllBlocks(node: ts.Node): readonly ts.JSDocTag[] {
  if (node.kind === ts.SyntaxKind.JSDoc) {
    return [...((node as ts.JSDoc).tags ?? [])];
  }
  const blocks = (node as { jsDoc?: ts.JSDoc[] }).jsDoc;
  if (blocks === undefined) {
    return [];
  }
  const out: ts.JSDocTag[] = [];
  for (const block of blocks) {
    for (const tag of block.tags ?? []) {
      out.push(tag);
    }
  }
  return out;
}

/**
 * Parse diagnostics, without a `ts.Program`.
 *
 * `ts.createSourceFile` records syntactic diagnostics on the source file itself,
 * under an internal property. Reading it is the only way to see them without a
 * Program — and the alternative, reporting no gaps ever, makes `js_parse_gap` a
 * decoration rather than a signal.
 */
export function parseDiagnosticsOf(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  return (sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] })
    .parseDiagnostics ?? [];
}

/**
 * The `@param` tag describing THIS parameter, by name then by position.
 *
 * ## One selection, because there were two and they disagreed
 *
 * `declaredTypeName` was produced by one implementation and the
 * `js_type_reference` TREE by another. Both answer "what type does this
 * parameter declare", and over a real corpus they disagreed 300 times — 300
 * positions with a type NAME and no tree, an internally inconsistent pair that
 * says "this is a `DependencyTemplateContext`" and offers nothing to join on.
 *
 * Twelve of those were worse than inconsistent. The name path used
 * `ts.getJSDocParameterTags(parameter)[0]` and landed raw tag text in the
 * column: `declaredTypeName` read
 * `@param {object} ctx.model - Model that is being used`, which is not a type
 * name and joins against nothing.
 *
 * ## Two rules the naive version gets wrong
 *
 * - **All blocks.** `ts.getJSDocTags` returns only the LAST attached block's
 *   tags and inherits its results to children. `jsDocTagsOfAllBlocks` exists
 *   for exactly this and was already the standing instruction.
 * - **A QUALIFIED name is not a parameter.** `@param {object} ctx.model`
 *   describes a PROPERTY of `ctx`. Counting it positionally shifts every tag
 *   after it onto the wrong argument, which is how the raw text got there.
 *
 * Matched by NAME first because that is what the author wrote, and by POSITION
 * only as a fallback — a destructured parameter has no name of its own, so
 * position is the only thing left.
 */
export function jsDocParameterTagFor(
  parameter: ts.ParameterDeclaration
): ts.JSDocParameterTag | ts.JSDocTypeTag | undefined {
  // THE HOST NODE FIRST. `function g(/** @type {string} */ p)` attaches a block
  // to the parameter itself; the compiler's `getJSDocType(p)` reads it and
  // `getJSDocParameterTags(p)` returns nothing for it — so a selection keyed on
  // the tag name misclassifies the shape and one keyed on the host does not
  // (§3.14.3). It wins over a `@param` for the same parameter because that is
  // the compiler's order too: the node's own `@type` is consulted before the
  // function's tags.
  const own = jsDocTagsOfLastBlock(parameter)
    .find((tag): tag is ts.JSDocTypeTag => ts.isJSDocTypeTag(tag));
  if (own?.typeExpression !== undefined) {
    return own;
  }
  const fn = parameter.parent;
  if (fn === undefined || !ts.isFunctionLike(fn)) {
    return undefined;
  }
  // THE LAST BLOCK of each host, as the compiler reads it. Two blocks above
  // one function — an older one left in place, a newer one written below it —
  // are common, and `getJSDocParameterTags` sees only the last: measured,
  // `getJSDocTags(fn)` returns 1 tag for a function under two one-tag blocks.
  // Reading every block typed a parameter from the STALE block on 13
  // parameters of the development corpus. (Counting comments into rows is a
  // different question and still reads every block; typing follows tsc.)
  const tags = jsDocHostsOf(fn)
    .flatMap((host) => jsDocTagsOfLastBlock(host))
    .filter((tag): tag is ts.JSDocParameterTag => ts.isJSDocParameterTag(tag))
    .filter((tag) => ts.isIdentifier(tag.name));
  if (ts.isIdentifier(parameter.name)) {
    // The first same-name tag WITH a type, then the first at all — the
    // compiler's own order in getJSDocType. A block that documents `padID`
    // twice, prose first (`@param padID identifies…`) and typed later
    // (`@param {String} padID`), typed nothing when the first tag won.
    const sameName = tags.filter((tag) => tag.name.getText() === parameter.name.getText());
    const byName = sameName.find((tag) => tag.typeExpression !== undefined) ?? sameName[0];
    if (byName !== undefined) {
      return byName;
    }
  }
  // POSITION, but only for a tag that names no parameter of this function.
  // The fallback exists for destructured parameters, which have no name to
  // match; taken unconditionally it handed `instance` (index 2, undocumented)
  // the tag written for `not_equal` (index 4) because that tag happened to be
  // third — two parameters typed from one tag, invisible until the import-type
  // row keyed on the tag's position collided. A tag claimed by name belongs to
  // the parameter it names, whatever its position.
  const index = fn.parameters.indexOf(parameter);
  const candidate = index < 0 ? undefined : tags[index];
  if (candidate === undefined) {
    return undefined;
  }
  const declaredNames = new Set(fn.parameters
    .map((p) => (ts.isIdentifier(p.name) ? p.name.text : undefined))
    .filter((name): name is string => name !== undefined));
  return declaredNames.has(candidate.name.getText()) ? undefined : candidate;
}

/**
 * The nodes whose JSDoc blocks DOCUMENT a callable: itself, and the statement
 * it is the value of.
 *
 * ## A regression, and the compiler's rule it broke
 *
 * `/** @param {string} ext *\/ app.engine = function engine(ext, fn) {}` — the
 * block is attached to the EXPRESSION STATEMENT, not to the function. Same for
 * `const f = (deps) => {}` (the VariableStatement) and `{ m: function (n) {} }`
 * (the PropertyAssignment). The compiler knows this: `getJSDocReturnTag` walks
 * from the function up through those hosts, which is why `@returns` on the same
 * construct kept working while `@param` — read from `fn.jsDoc` alone after the
 * selection was unified — emitted nothing. 894 references lost in one package.
 *
 * This is the compiler's host walk, written down: from the callable, climb
 * while the parent is a node that merely CARRIES the value — a variable
 * declaration and its list and statement, an assignment and its statement, a
 * property assignment, a parenthesis, a property declaration, an export
 * assignment — and read every block on the way. Stop at anything else, because
 * a block on a containing `if` or function body documents that, not this.
 */
export function jsDocHostsOf(callable: ts.Node): readonly ts.Node[] {
  const hosts: ts.Node[] = [callable];
  let current: ts.Node = callable;
  for (;;) {
    const parent: ts.Node | undefined = current.parent;
    if (parent === undefined) {
      break;
    }
    const carriesValue =
      (ts.isVariableDeclaration(parent) && parent.initializer === current)
      || ts.isVariableDeclarationList(parent)
      || ts.isVariableStatement(parent)
      || (ts.isBinaryExpression(parent) && parent.right === current
        && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken)
      || ts.isExpressionStatement(parent)
      || (ts.isPropertyAssignment(parent) && parent.initializer === current)
      || (ts.isPropertyDeclaration(parent) && parent.initializer === current)
      || ts.isParenthesizedExpression(parent)
      || ts.isExportAssignment(parent);
    if (!carriesValue) {
      break;
    }
    hosts.push(parent);
    current = parent;
  }
  return hosts;
}

/**
 * The route from a destructuring pattern's root to a bound name, and whether
 * the name is a REST binding.
 *
 * `cb` for `{ cb: renamed }`, `inner.deep` for `{ inner: { deep } }`, `0` and
 * `1` for array positions, `a.0.b` mixed — the key route, never the local
 * name, because renaming is how a wire format is adapted to a codebase's
 * naming. A rest binding is written as its position plus `...`: `...` for
 * `{ ...rest }` at the root, `2...` for `[a, b, ...others]`, `opts....` for
 * `{ opts: { ...rest } }` — so the path alone says where the rest starts.
 *
 * Shared by the reference rows (js_expression.bindingPath, for parameters)
 * and the variable rows (js_variable.bindingPath): one walk, one spelling.
 * The root is the Parameter or VariableDeclaration that owns the pattern;
 * `undefined` root means the name is not inside a pattern at all.
 */
export function bindingPathOf(name: ts.Node): {
  root: ts.ParameterDeclaration | ts.VariableDeclaration | undefined;
  path: string;
  isRest: boolean;
} {
  const segments: string[] = [];
  let isRest = false;
  let current: ts.Node = name;
  for (;;) {
    const parent: ts.Node | undefined = current.parent;
    if (parent === undefined) {
      return { root: undefined, path: '', isRest: false };
    }
    if (ts.isParameter(parent) || ts.isVariableDeclaration(parent)) {
      return { root: parent, path: segments.join('.'), isRest };
    }
    if (ts.isBindingElement(parent)) {
      const pattern = parent.parent;
      const rest = parent.dotDotDotToken !== undefined;
      if (current === name && rest) {
        isRest = true;
      }
      if (ts.isArrayBindingPattern(pattern)) {
        const index = String(pattern.elements.indexOf(parent));
        segments.unshift(rest ? `${index}...` : index);
      } else if (ts.isObjectBindingPattern(pattern)) {
        if (rest) {
          segments.unshift('...');
        } else {
          const key = parent.propertyName ?? parent.name;
          segments.unshift(ts.isIdentifier(key) || ts.isStringLiteral(key) || ts.isNumericLiteral(key)
            ? key.text
            : key.getText());
        }
      }
      current = pattern;
      continue;
    }
    if (ts.isObjectBindingPattern(parent) || ts.isArrayBindingPattern(parent)) {
      current = parent;
      continue;
    }
    return { root: undefined, path: '', isRest: false };
  }
}
