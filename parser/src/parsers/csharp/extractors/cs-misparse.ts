/**
 * COHERENT MISPARSES OF THE PUBLISHED GRAMMAR, recognised in one place.
 *
 * `tree-sitter-c-sharp` 0.23.1 fails a set of shapes in two different ways, and
 * the distinction decides what can be done about each:
 *
 *   ERROR     an ERROR node. Rows are lost, and `cs_parse_gap` emits a row
 *             saying so — a consumer can see the file was not fully read and
 *             refuse to trust it. 41 shapes. Nothing here can help: there is no
 *             structure left to read.
 *
 *   MISPARSE  no error, and the WRONG tree. The fact base is well-formed and
 *             wrong, and NOTHING reports it. 7 shapes. This module is for those.
 *
 * Only the second kind is a trust problem, and it is the worse one: a lost row
 * is visible in a count, a wrong row is not. For static analysis a silently
 * wrong edge is worse than a missing one, because it is acted upon.
 *
 * ## Every detector needs a negative control, and that is the hard part
 *
 * A misparse is recognised by the SHAPE the grammar produced, and a shape is
 * not proof of intent. `Local(x) = v` misparses into the same tree a real
 * deconstruction `var (a, b) = e` produces, so a detector keyed only on "a
 * declarator holding a tuple pattern" would rewrite legitimate code and invent
 * calls that the source never wrote. Inventing an edge is worse than losing
 * one.
 *
 * So each detector below states the discriminator it relies on, and each has a
 * control in the suite asserting the legitimate shape is NOT touched.
 */
import Parser from 'tree-sitter';

import { childOfType, namedChildren } from '@/parsers/csharp/extractors/cs-node';

/**
 * `Local(instance) = value;` — an assignment to a REF-RETURNING call, which the
 * published grammar reads as a local declaration.
 *
 * What it produces:
 *
 *     variable_declaration
 *       identifier "Local"              <- read as the TYPE
 *       variable_declarator
 *         tuple_pattern (instance)      <- read as a deconstruction target
 *         identifier "value"            <- read as the initializer
 *
 * which is a declaration of a variable whose type is `Local`, and a phantom
 * local per argument. The call is gone and nothing errors. Measured at ~3,400
 * lost calls across the corpus when the fork's rule for it was absent.
 *
 * THE DISCRIMINATOR is the declared type, and it is exact rather than
 * heuristic. A tuple declarator is only legal C# after `var`:
 *
 *     var (a, b) = e;      implicit_type    -> a REAL deconstruction. Untouched.
 *     (a, b) = e;          no declaration   -> already an assignment. Untouched.
 *     int x = 1;           identifier name  -> not a tuple pattern. Untouched.
 *     Local(x) = v;        identifier type  -> THE MISPARSE.
 *     A.ById(o) = v;       qualified_name   -> THE MISPARSE.
 *
 * Verified in all five directions before this was written, because the first
 * four are the ones a wrong detector would damage.
 */
export function refReturningAssignmentOf(node: Parser.SyntaxNode): {
  readonly calleeNode: Parser.SyntaxNode;
  readonly argumentsNode: Parser.SyntaxNode;
  readonly valueNode: Parser.SyntaxNode | undefined;
} | undefined {
  if (node.type !== 'variable_declaration') {
    return undefined;
  }
  const children = namedChildren(node);
  const typeNode = children[0];
  // `var` is the ONLY type a tuple declarator may legally follow, so it is the
  // whole discriminator. Anything else in that position is the misparse.
  if (
    typeNode === undefined ||
    (typeNode.type !== 'identifier' && typeNode.type !== 'qualified_name')
  ) {
    return undefined;
  }
  const declarators = children.filter((c) => c.type === 'variable_declarator');
  // `T a, b = …` is a real multi-declarator statement; the misparse is always
  // a single one, because the source had a single assignment.
  if (declarators.length !== 1) {
    return undefined;
  }
  const parts = namedChildren(declarators[0]!);
  const tuple = parts[0];
  if (tuple === undefined || tuple.type !== 'tuple_pattern') {
    return undefined;
  }
  return { calleeNode: typeNode, argumentsNode: tuple, valueNode: parts[1] };
}

/**
 * Is this `tuple_pattern` the ARGUMENT LIST of a misparsed ref-returning call?
 *
 * A tuple pattern is reached by descent as well as through its declaration, so
 * refusing the declaration is not enough: the walk arrives at the pattern
 * anyway and mints a local per element. Under the misparse those elements are
 * the call's arguments.
 *
 * The climb is two steps and read-only — pattern to declarator to declaration.
 * Nothing is written to a node: the wrapper cache evicts, so a property set in
 * one traversal is gone by the next, and `.parent` walks would return untagged
 * objects.
 */
export function isMisparsedCallArgumentTuple(node: Parser.SyntaxNode): boolean {
  if (node.type !== 'tuple_pattern') {
    return false;
  }
  const declarator = node.parent;
  if (declarator === null || declarator.type !== 'variable_declarator') {
    return false;
  }
  const declaration = declarator.parent;
  if (declaration === null) {
    return false;
  }
  const misparsed = refReturningAssignmentOf(declaration);
  return misparsed !== undefined && misparsed.argumentsNode.id === node.id;
}

/**
 * `extension(string source)` read as a CONSTRUCTOR.
 *
 * A C# 14 extension block has no rule in the published grammar, so
 * `extension(...)` — a word followed by a parameter list — matches the
 * constructor production. The result is a constructor row on a static class
 * taking one argument, which is not legal C# and resolves to nothing.
 *
 * THE DISCRIMINATOR IS THE NAME, and it is safe because a constructor's name
 * must equal its type's. `extension` can only be a constructor of a type called
 * `extension`, and C# forbids that: `extension` is a contextual keyword in C#
 * 14 and no conforming compiler accepts a type so named. So a constructor
 * called `extension` is always this misparse.
 *
 * The block's MEMBERS are still lost — they are inside an ERROR node and there
 * is no structure to read. That loss is recorded by `cs_parse_gap`. This only
 * stops the parser also asserting a constructor that does not exist, because a
 * wrong row is worse than a missing one: the missing one is visible in a count.
 */
export function isMisparsedExtensionBlockHeader(node: Parser.SyntaxNode): boolean {
  if (node.type !== 'constructor_declaration') {
    return false;
  }
  const name = node.childForFieldName('name');
  return name !== null && name.text === 'extension';
}

/**
 * Expression forms the grammar hangs a `?.` off that C# never can.
 *
 * `?.` takes a PRIMARY expression on its left — a name, a member access, an
 * invocation, a parenthesised expression. It cannot take an operator
 * expression, because `?.` binds tighter than every operator: `a || b?.M()` is
 * `a || (b?.M())` in every conforming compiler, and `(a || b)?.M()` has to be
 * written with the parentheses. If the parentheses ARE written the grammar
 * gives a `parenthesized_expression` here, so this set never overlaps the legal
 * form.
 *
 * Each entry is therefore proof, not a heuristic: a conditional access whose
 * condition is one of these is a shape valid C# cannot produce.
 */
const NON_PRIMARY_RECEIVER_WRAPPERS: ReadonlySet<string> = new Set([
  // `a || b?.M()`, `a ?? b?.Name`, `a == b?.C`. `??` is a binary_expression
  // here too, and coalescing before a `?.` is the commonest spelling of all.
  'binary_expression',
  // `!b?.Any()`, `-b?.Count`.
  'prefix_unary_expression',
  // `(string)b?.Name` — read as `((string)b)?.Name`, which also makes the cast
  // look like the operand's parent when it is its sibling.
  'cast_expression',
  // `await b?.M()` — read as `(await b)?.M()`, so the awaited value is the
  // receiver rather than the call's result.
  'await_expression',
]);

/** Postfix forms built ON a primary: the chain a `?.` misparse sits under. */
const POSTFIX_PRIMARY_FIELDS: ReadonlyMap<string, string> = new Map([
  ['invocation_expression', 'function'],
  ['member_access_expression', 'expression'],
  ['element_access_expression', 'expression'],
]);

/**
 * `a || b?.M()` read as `(a || b)?.M()` — the RECEIVER of every `?.` that
 * follows an operator.
 *
 * What the grammar produces:
 *
 *     conditional_access_expression        <- spans `a || b?.M`
 *       binary_expression  `a || b`        <- read as the RECEIVER
 *       member_binding_expression `.M`
 *
 * so the receiver of the call is an OPERATOR EXPRESSION. Not a missing fact: a
 * present and wrong one. An engine reads `(a || b).M()`, looks for `M` on the
 * type of a boolean, and either drops the edge or binds it somewhere else. The
 * true receiver is `b`, and it is recoverable exactly — the wrapper's last
 * operand, down through nested wrappers:
 *
 *     a || b && c?.M()   -> c        (binary inside binary)
 *     !(x) ...           -> the parenthesised form is legal and never here
 *     (T)b?.Name         -> b        (cast)
 *     await b?.M()       -> b        (await)
 *
 * Measured at 481 sites across five codebases — modern-app 6, library-A 3, desktop-A 21,
 * linq-heavy 451, old-style-A 0 — so it is the most frequent MISPARSE of the seven and
 * the only one whose repair recovers a receiver rather than merely suppressing
 * an invention.
 *
 * WHAT THIS DOES NOT FIX, stated because the residue is real: when a single
 * operator chain contains more than one `?.`, the operator NESTING the grammar
 * produced is left as it is. `x?.T == y?.T && x?.B == y?.B` comes out with each
 * receiver right and each operator's operands right, but `==` at the root where
 * `&&` belongs. Correcting that means re-deciding precedence over a flattened
 * operand sequence — re-parsing the expression, not repairing a node — and a
 * parser that re-parses its own input has two grammars to keep in agreement.
 * The torture fixture asserts both halves: the receiver recovered, the nesting
 * not.
 */
export function nullConditionalWrapperOf(
  node: Parser.SyntaxNode
): Parser.SyntaxNode | undefined {
  if (node.type !== 'conditional_access_expression') {
    return undefined;
  }
  // The `condition` FIELD, with NO positional fallback: every
  // `conditional_access_expression` the grammar builds has it, and a positional
  // read here would answer for a node shape this function is not about.
  const condition = node.childForFieldName('condition');
  if (condition === null) {
    return undefined;
  }
  return NON_PRIMARY_RECEIVER_WRAPPERS.has(condition.type) ? condition : undefined;
}

/** The last operand of a wrapper — its innermost, through nested wrappers. */
function innermostOperandOf(wrapper: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  let cur: Parser.SyntaxNode | undefined = wrapper;
  for (let guard = 0; guard < 64 && cur !== undefined; guard += 1) {
    if (!NON_PRIMARY_RECEIVER_WRAPPERS.has(cur.type)) {
      return cur;
    }
    // The LAST named child in every one of the four forms: the right operand of
    // a binary, the operand of a unary or an await, the value of a cast. Read
    // positionally because `binary_expression` is the only one of the four with
    // a `right` field, and a field read that returns null on three of four
    // types reads as "no receiver" rather than as the wrong receiver.
    const children = namedChildren(cur);
    cur = children[children.length - 1];
  }
  return undefined;
}

/** The true receiver of a misparsed `?.`, or nothing when it is not one. */
export function nullConditionalTrueReceiverOf(
  node: Parser.SyntaxNode
): Parser.SyntaxNode | undefined {
  const wrapper = nullConditionalWrapperOf(node);
  return wrapper === undefined ? undefined : innermostOperandOf(wrapper);
}

/**
 * The whole postfix expression built on a misparsed `?.`.
 *
 * `a || b?.M().Length` gives `member_access(invocation(conditional_access(…)))`
 * — three nodes, one unit. The unit is what moves onto the operator's right
 * operand when the tree is rotated, and its END is where the rotated operator
 * truly ends. Rotating the conditional access alone would leave `.M().Length`
 * spanning text its new parent does not cover, and a child span outside its
 * parent's is the one shape the span gate cannot repair after the fact.
 */
export function nullConditionalUnitOf(node: Parser.SyntaxNode): Parser.SyntaxNode {
  let unit = node;
  for (let guard = 0; guard < 64; guard += 1) {
    const parent = unit.parent;
    if (parent === null) {
      return unit;
    }
    const field = POSTFIX_PRIMARY_FIELDS.get(parent.type);
    if (field === undefined) {
      return unit;
    }
    const primary = parent.childForFieldName(field);
    if (primary === null || primary.id !== unit.id) {
      return unit;
    }
    unit = parent;
  }
  return unit;
}

/**
 * The misparse under a postfix unit, when this node is the TOP of that unit.
 *
 * Asked of every node the expression walk pops, so it answers for the outermost
 * node of the unit only. Two nodes of one unit both claiming the rotation would
 * emit the operator twice, and duplicate keys do not collide — they DOUBLE.
 */
export interface NullConditionalMisparse {
  readonly condacc: Parser.SyntaxNode;
  readonly wrapper: Parser.SyntaxNode;
  readonly receiver: Parser.SyntaxNode;
}

/**
 * The misparse anywhere down this node's primary chain, top or not.
 *
 * Every node from the unit's top down to the conditional access itself spans
 * text that belongs to the operator — `a || b?.M()` gives the invocation the
 * span of the whole line — so all of them start at the true receiver once the
 * tree is rotated, not just the one that carries the rotation.
 */
export function nullConditionalMisparseInPrimaryChainOf(
  node: Parser.SyntaxNode
): NullConditionalMisparse | undefined {
  let cur: Parser.SyntaxNode | undefined = node;
  for (let guard = 0; guard < 64 && cur !== undefined; guard += 1) {
    if (cur.type === 'conditional_access_expression') {
      const wrapper = nullConditionalWrapperOf(cur);
      const receiver = wrapper === undefined ? undefined : innermostOperandOf(wrapper);
      return wrapper === undefined || receiver === undefined
        ? undefined
        : { condacc: cur, wrapper, receiver };
    }
    const field = POSTFIX_PRIMARY_FIELDS.get(cur.type);
    if (field === undefined) {
      return undefined;
    }
    cur = cur.childForFieldName(field) ?? undefined;
  }
  return undefined;
}

export function misparsedNullConditionalUnder(
  node: Parser.SyntaxNode
): NullConditionalMisparse | undefined {
  const found = nullConditionalMisparseInPrimaryChainOf(node);
  return found !== undefined && nullConditionalUnitOf(found.condacc).id === node.id
    ? found
    : undefined;
}

/**
 * Is this node a wrapper the rotation moved a postfix unit onto?
 *
 * Answered by climbing, so it is a pure function of the tree rather than a flag
 * carried through the walk — the wrapper cache evicts, so a flag on a node is
 * gone by the next traversal, and this question is asked in three passes.
 */
export function rotatedWrapperUnitOf(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  if (!NON_PRIMARY_RECEIVER_WRAPPERS.has(node.type)) {
    return undefined;
  }
  let cur = node;
  for (let guard = 0; guard < 64; guard += 1) {
    const parent = cur.parent;
    if (parent === null) {
      return undefined;
    }
    if (parent.type === 'conditional_access_expression') {
      // The wrapper is this conditional access's condition — the rotation's
      // pivot. Its unit is what the wrapper now ends at.
      return nullConditionalWrapperOf(parent)?.id === cur.id
        ? nullConditionalUnitOf(parent)
        : undefined;
    }
    if (!NON_PRIMARY_RECEIVER_WRAPPERS.has(parent.type)) {
      return undefined;
    }
    // Only the LAST operand is on the path to the pivot. A left operand of a
    // rotated binary keeps its own span: `a || b?.M()` ends `a` at `a`.
    const children = namedChildren(parent);
    if (children[children.length - 1]?.id !== cur.id) {
      return undefined;
    }
    cur = parent;
  }
  return undefined;
}

/**
 * `new HashSet<(string Name, string? Schema)>(src)` read as two comparisons.
 *
 * What the grammar produces:
 *
 *     binary_expression  `>`
 *       binary_expression  `<`
 *         object_creation_expression   `new HashSet`   <- no arguments at all
 *         tuple_expression  `(string Name, string? Schema)`
 *       parenthesized_expression  `(src)`              <- the ARGUMENT LIST
 *
 * No error. The creation row stops at its type name, the constructor call is
 * lost, the type arguments become a tuple of `declaration_expression`s — which
 * mint a PHANTOM LOCAL PER TUPLE ELEMENT, so `Name` and `Schema` enter the fact
 * base as variables the program never declares — and the arguments become the
 * right operand of a comparison.
 *
 * THE TRIGGER IS NARROW, and it is worth stating because it decides how much
 * this can be trusted. Only when EVERY tuple element is named AND the creation
 * has arguments or an initializer:
 *
 *     new List<(int X, string Y)>()        parses      (no arguments)
 *     new List<(int X, string)>(src)       parses      (one element unnamed)
 *     new HashSet<(string, string)>(src)   parses      (none named)
 *     new Dictionary<string, (int X, …)>() parses      (tuple not the first arg)
 *     new HashSet<(string N, string S)>(s) MISPARSES
 *
 * because `(int X, string Y)` is the only spelling that is also a legal tuple of
 * declaration expressions, and the trailing `(` or `{` is what makes the
 * comparison reading complete. Four sites in linq-heavy, zero in modern-app, old-style-A,
 * library-A and desktop-A.
 *
 * THE DISCRIMINATOR is the argument-less creation, and it is exact: `new T`
 * with neither an argument list nor an initializer is not an expression C#
 * accepts. `new()` is `implicit_object_creation_expression`, a different node,
 * and `new int[4]` is an array creation. So an `object_creation_expression`
 * with a type and nothing else can only be this misparse — no comparison of a
 * newly created object can produce it, because there is no object yet.
 */
export function misparsedTupleGenericCreationOf(node: Parser.SyntaxNode):
  | {
      readonly creation: Parser.SyntaxNode;
      readonly typeTuple: Parser.SyntaxNode;
      readonly argumentsNode: Parser.SyntaxNode;
    }
  | undefined {
  // The `operator`, `left` and `right` FIELDS. Positions 0, 1 and 2 are right
  // until a comment sits between the operands — `a /* why */ < b` — and then
  // position 1 is the COMMENT and the operator test silently stops matching.
  if (node.type !== 'binary_expression' || operatorTextOf(node) !== '>') {
    return undefined;
  }
  const inner = node.childForFieldName('left');
  const argumentsNode = node.childForFieldName('right');
  if (
    inner === null ||
    argumentsNode === null ||
    inner.type !== 'binary_expression' ||
    operatorTextOf(inner) !== '<'
  ) {
    return undefined;
  }
  const creation = inner.childForFieldName('left');
  const typeTuple = inner.childForFieldName('right');
  if (
    creation === null ||
    typeTuple === null ||
    creation.type !== 'object_creation_expression' ||
    typeTuple.type !== 'tuple_expression' ||
    // An argument-less creation: the whole discriminator. Read as the ABSENCE
    // of both children rather than by counting, because `new T` and `new T()`
    // differ by one node and the count would be the same on a type whose name
    // the grammar split.
    childOfType(creation, 'argument_list') !== undefined ||
    childOfType(creation, 'initializer_expression') !== undefined
  ) {
    return undefined;
  }
  // The trailing node is the argument list or the initializer. A creation with
  // neither is `new T` followed by a real comparison of something else, and
  // there is no such expression — but it is tested rather than assumed.
  if (
    argumentsNode.type !== 'parenthesized_expression' &&
    argumentsNode.type !== 'tuple_expression' &&
    argumentsNode.type !== 'initializer_expression'
  ) {
    return undefined;
  }
  return { creation, typeTuple, argumentsNode };
}

/**
 * `Take(new D<K, V>(args) { ... })` -- a generic creation WITH constructor
 * arguments AND an initializer, in ARGUMENT POSITION -- read as two comparisons.
 *
 * The `<` ambiguity again, but a different shape from the one above and not
 * reachable by it: that one requires the creation to have NEITHER arguments nor
 * an initializer, and this one requires BOTH. The grammar splits the expression
 * across SIBLING `argument` nodes of one `argument_list`, so there is no single
 * node to test; the run is what has to be recognised.
 *
 * Measured tree for `Take(new Dictionary<Key, Val>(snap) { { k, v } })`:
 *
 *     argument_list
 *       argument -> binary_expression `<`
 *                     left  = object_creation_expression   (type only, no args)
 *                     right = identifier `Key`             <- a TYPE ARGUMENT
 *       argument -> binary_expression `>`
 *                     left  = identifier `Val`             <- a TYPE ARGUMENT
 *                     right = cast_expression
 *                               type  = `snap`             <- the REAL arguments
 *                               value = initializer_expression
 *
 * Three things are wrong and all three come from this one run: two fabricated
 * comparisons and a fabricated cast; the type arguments emitted as VALUE
 * references, so a resolver looks for values named `Key` and `Val`; and the
 * call's argumentCount, which counts the run rather than the one argument the
 * source writes.
 *
 * A creation with more than two type arguments puts plain identifiers between
 * the two binaries -- `new D<A, B, C>(x) { }` is three arguments -- so the
 * middle of the run is required to be exactly that and nothing else.
 *
 * THE DISCRIMINATOR is that the `<` operand is an `object_creation_expression`
 * whose own `new` sits inside the supposed comparison, which no comparison a
 * programmer writes can produce. `a < b, c > d` as genuine arguments has no
 * creation in it and is not matched.
 */
export function misparsedGenericCreationRunOf(
  list: Parser.SyntaxNode
): | {
      readonly start: number;
      readonly length: number;
      readonly creation: Parser.SyntaxNode;
      readonly typeArguments: readonly Parser.SyntaxNode[];
      readonly constructorArguments: Parser.SyntaxNode | undefined;
      readonly initializer: Parser.SyntaxNode | undefined;
    }
  | undefined {
  if (list.type !== 'argument_list') {
    return undefined;
  }
  const args = namedChildrenOfType(list, 'argument');
  for (let i = 0; i < args.length; i += 1) {
    const open = onlyExpressionOf(args[i]!);
    if (
      open === undefined ||
      open.type !== 'binary_expression' ||
      operatorTextOf(open) !== '<'
    ) {
      continue;
    }
    const creation = open.childForFieldName('left');
    const firstTypeArgument = open.childForFieldName('right');
    if (
      creation === null ||
      firstTypeArgument === null ||
      creation.type !== 'object_creation_expression' ||
      // The creation the grammar stopped at its type name: the `(args)` and the
      // `{ ... }` are downstream, inside the closing argument's cast.
      childOfType(creation, 'argument_list') !== undefined ||
      childOfType(creation, 'initializer_expression') !== undefined
    ) {
      continue;
    }
    for (let j = i + 1; j < args.length; j += 1) {
      const close = onlyExpressionOf(args[j]!);
      if (close === undefined) {
        break;
      }
      // Between the two binaries every argument is a bare type-argument name.
      if (close.type === 'identifier') {
        continue;
      }
      if (close.type !== 'binary_expression' || operatorTextOf(close) !== '>') {
        break;
      }
      const lastTypeArgument = close.childForFieldName('left');
      const tail = close.childForFieldName('right');
      if (lastTypeArgument === null || tail === null) {
        break;
      }
      const middle = args
        .slice(i + 1, j)
        .map((a) => onlyExpressionOf(a))
        .filter((n): n is Parser.SyntaxNode => n !== undefined);
      // The tail is the creation's own `(args) { ... }`, which the grammar read
      // as a cast whose TYPE is the parenthesised arguments. A creation with an
      // initializer and no arguments does not reach here -- it parses correctly,
      // which is one of the issue's controls.
      if (tail.type !== 'cast_expression') {
        break;
      }
      return {
        start: i,
        length: j - i + 1,
        creation,
        typeArguments: [firstTypeArgument, ...middle, lastTypeArgument],
        constructorArguments: tail.childForFieldName('type') ?? undefined,
        initializer: tail.childForFieldName('value') ?? undefined,
      };
    }
  }
  return undefined;
}

/**
 * The misparsed run read from the CREATION, the node that carries the row.
 *
 * The walk arrives at the creation, not at the argument list, so the pieces it
 * needs -- the real constructor arguments and the initializer, both of which the
 * grammar filed inside a fabricated cast two arguments later -- have to be
 * reachable from it. The climb is creation to `<` binary to `argument` to
 * `argument_list`, and the run is then matched to confirm THIS creation heads it.
 */
export function misparsedGenericCreationRunAtCreationOf(
  creation: Parser.SyntaxNode
): | {
      readonly constructorArguments: Parser.SyntaxNode | undefined;
      readonly initializer: Parser.SyntaxNode | undefined;
      readonly typeArguments: readonly Parser.SyntaxNode[];
      readonly end: Parser.SyntaxNode;
    }
  | undefined {
  const list = creation.parent?.parent?.parent;
  if (list === undefined || list === null) {
    return undefined;
  }
  const run = misparsedGenericCreationRunOf(list);
  if (run === undefined || run.creation.id !== creation.id) {
    return undefined;
  }
  const args = namedChildrenOfType(list, 'argument');
  return {
    constructorArguments: run.constructorArguments,
    initializer: run.initializer,
    typeArguments: run.typeArguments,
    // The LAST argument of the run, which is where the expression the source
    // wrote actually ends. The creation node itself stops at its type name.
    end: args[run.start + run.length - 1] ?? creation,
  };
}

/** Named children of one type, in order. */
function namedChildrenOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child !== null && child.type === type) {
      out.push(child);
    }
  }
  return out;
}

/** The misparse read from the CREATION, the node that carries its row. */
export function misparsedGenericCreationArgumentsOf(
  creation: Parser.SyntaxNode
): { readonly argumentsNode: Parser.SyntaxNode; readonly typeTuple: Parser.SyntaxNode } | undefined {
  const inner = creation.parent;
  const outer = inner?.parent;
  if (inner == null || outer == null) {
    return undefined;
  }
  const found = misparsedTupleGenericCreationOf(outer);
  return found === undefined || found.creation.id !== creation.id
    ? undefined
    : { argumentsNode: found.argumentsNode, typeTuple: found.typeTuple };
}

/**
 * Is this `declaration_expression` an element of a misread TUPLE TYPE?
 *
 * `(string Name, string? Schema)` as a type argument is read as a tuple of
 * declaration expressions, and a declaration expression binds a name. So the
 * type's element names arrive as local variables — two per site, in the fact
 * base, declared nowhere in the program. Suppressed here because a wrong row
 * is worse than a missing one: an engine can see that a call is absent, and
 * cannot see that a local is fictional.
 */
export function isMisparsedTupleTypeElement(node: Parser.SyntaxNode): boolean {
  if (node.type !== 'declaration_expression') {
    return false;
  }
  const argument = node.parent;
  const tuple = argument?.parent;
  const inner = tuple?.parent;
  const outer = inner?.parent;
  if (tuple == null || outer == null) {
    return false;
  }
  const found = misparsedTupleGenericCreationOf(outer);
  return found !== undefined && found.typeTuple.id === tuple.id;
}

/**
 * The single expression a one-expression wrapper holds.
 *
 * `constant_pattern`, `relational_pattern` and `argument` declare NO fields at
 * all in node-types.json for this — the first is a bare expression, the second
 * an operator token and an expression, and an `argument`'s only field is the
 * NAME of a named argument, never the value — so position is the only read the
 * grammar offers, and this is the one place that says so.
 */
function onlyExpressionOf(pattern: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  return namedChildren(pattern)[0];
}

/** The operator TOKEN's text, by field rather than by position. */
function operatorTextOf(binary: Parser.SyntaxNode): string {
  return binary.childForFieldName('operator')?.text ?? '';
}

/**
 * The operators that cannot appear in a constant pattern in practice.
 *
 * A constant pattern is a CONSTANT EXPRESSION, so `x is 1 + 2` is legal and
 * arithmetic is not evidence of anything. `&&` and `||` are different: their
 * operands are booleans, so the only legal reading of `x is A && B` as one
 * pattern needs `A` to be a bool constant and `B` a bool constant — `b is true
 * && false`, which nothing writes. Every real occurrence is `(x is A) && B`.
 *
 * `==` and `!=` are deliberately NOT here. `ex is Foo == flag` is six sites in
 * five codebases against `&&`/`||`'s 401, and `x is 1 == 2` is a legal constant
 * pattern of the same shape — so the operator alone does not decide it, and a
 * rotation that can be wrong on a shape it cannot distinguish is worse than the
 * absence it would replace.
 */
const SWALLOWED_TAIL_OPERATORS: ReadonlySet<string> = new Set(['&&', '||']);

/** Pattern forms that combine other patterns rather than matching anything. */
const PATTERN_COMBINATORS: ReadonlySet<string> = new Set([
  'negated_pattern',
  'and_pattern',
  'or_pattern',
  'parenthesized_pattern',
]);

/**
 * The LAST pattern a combinator chain ends in.
 *
 * A swallow happens at the end of the pattern — that is where the grammar was
 * still reading when the operator arrived — so `s is not null && f(s)` puts the
 * swallowing binary under the `not`, and `s is not null and not "" && f(s)`
 * two combinators down. Reading only a direct `constant_pattern` child found
 * the second of two identical calls in the gate corpus and missed the first,
 * which is exactly the sort of half-repair a count cannot distinguish from a
 * half-broken grammar.
 *
 * Rightmost by POSITION, which is what "last" means here: `and_pattern` and
 * `or_pattern` name `left` and `right`, `negated_pattern` and
 * `parenthesized_pattern` name nothing and hold one child, and the rightmost
 * named child is the correct answer in all four.
 */
function rightmostPatternLeafOf(pattern: Parser.SyntaxNode): Parser.SyntaxNode {
  let cur = pattern;
  for (let guard = 0; guard < 64; guard += 1) {
    if (!PATTERN_COMBINATORS.has(cur.type)) {
      return cur;
    }
    const children = namedChildren(cur);
    const next = children[children.length - 1];
    if (next === undefined) {
      return cur;
    }
    cur = next;
  }
  return cur;
}

/**
 * `x is null || data.Length == 0` read as `x is (null || data.Length == 0)`.
 *
 * What the grammar produces:
 *
 *     is_pattern_expression                  <- spans the WHOLE expression
 *       identifier `x`
 *       constant_pattern
 *         binary_expression  `null || data.Length == 0`
 *
 * The pattern swallows the rest of the boolean expression. And because a
 * pattern's own subtree is not an expression — patterns carry no expression
 * rows — everything after the operator is not merely misplaced, it is GONE:
 * calls, member accesses and references in the tail have no rows at all.
 * `x is Limit.Max && Q(x)` recorded no call to `Q`.
 *
 * Measured at 401 sites across five codebases (`&&` 280, `||` 121): modern-app,
 * old-style-A, library-A, desktop-A and linq-heavy. The commonest single spelling is `x is null
 * || …`, which is idiomatic C# rather than an unusual construction.
 *
 * The repair is the same rotation the `?.` misparse gets: the operator becomes
 * the parent, the is-expression becomes its left operand ending where the
 * pattern really ends, and the tail becomes the right operand — with its rows,
 * because it is an expression again.
 */
export function isPatternSwallowOf(node: Parser.SyntaxNode):
  | { readonly spineRoot: Parser.SyntaxNode; readonly innerLeft: Parser.SyntaxNode }
  | undefined {
  if (node.type !== 'is_pattern_expression') {
    return undefined;
  }
  const pattern = node.childForFieldName('pattern');
  if (pattern === null) {
    return undefined;
  }
  const leaf = rightmostPatternLeafOf(pattern);
  if (leaf.type !== 'constant_pattern') {
    return undefined;
  }
  const spineRoot = onlyExpressionOf(leaf);
  if (
    spineRoot === undefined ||
    spineRoot.type !== 'binary_expression' ||
    !SWALLOWED_TAIL_OPERATORS.has(operatorTextOf(spineRoot))
  ) {
    return undefined;
  }
  // `o is A && b && c` nests to the LEFT, so the pattern's true constant is the
  // innermost left operand and every binary on that spine belongs to the
  // rotated expression. Descending the whole spine rather than one level is
  // what keeps `A` — and not `A && b` — as the pattern.
  let innerLeft: Parser.SyntaxNode = spineRoot;
  for (let guard = 0; guard < 64; guard += 1) {
    const left = innerLeft.childForFieldName('left');
    if (
      left === null ||
      innerLeft.type !== 'binary_expression' ||
      !SWALLOWED_TAIL_OPERATORS.has(operatorTextOf(innerLeft))
    ) {
      break;
    }
    innerLeft = left;
  }
  return innerLeft.id === spineRoot.id ? undefined : { spineRoot, innerLeft };
}

/**
 * The is-expression a swallowed tail's operator belongs to, or nothing.
 *
 * Climbs the LEFT spine only: in `o is A && b && c` both operators are part of
 * the rotated expression and both start where `o` starts, while the RIGHT
 * operands are ordinary expressions that keep their own spans.
 */
export function swallowedIsPatternOf(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  if (node.type !== 'binary_expression' || !SWALLOWED_TAIL_OPERATORS.has(operatorTextOf(node))) {
    return undefined;
  }
  let cur = node;
  for (let guard = 0; guard < 64; guard += 1) {
    const parent = cur.parent;
    if (parent === null) {
      return undefined;
    }
    if (parent.type === 'constant_pattern') {
      const isPattern = parent.parent;
      return isPattern !== null &&
        isPattern.type === 'is_pattern_expression' &&
        isPatternSwallowOf(isPattern) !== undefined
        ? isPattern
        : undefined;
    }
    if (
      parent.type !== 'binary_expression' ||
      !SWALLOWED_TAIL_OPERATORS.has(operatorTextOf(parent)) ||
      parent.childForFieldName('left')?.id !== cur.id
    ) {
      return undefined;
    }
    cur = parent;
  }
  return undefined;
}

/**
 * `n is < -1 ? throw new ArgumentOutOfRangeException(nameof(n)) : Store(n)`
 * read as a relational pattern against a conditional expression.
 *
 * What the grammar produces:
 *
 *     is_pattern_expression                    <- spans the WHOLE expression
 *       identifier `n`
 *       relational_pattern  `< -1 ? … : …`
 *         conditional_expression
 *           prefix_unary_expression  `-1`      <- the pattern's real constant
 *           throw_expression                  <- the true consequence
 *           invocation_expression              <- the true alternative
 *
 * so both arms of the conditional are inside a PATTERN, and a pattern's subtree
 * carries no expression rows: the `throw`, the creation, the `nameof` and the
 * call in the other arm all vanish. This is the argument-validation idiom, and
 * every one of its sites loses a creation and a call — 20 across five
 * codebases, concentrated in two linq-heavy types.
 *
 * THE DISCRIMINATOR is exact. A relational pattern is `< constant`, and `a ? b
 * : c` is not a constant expression — `is < (a ? b : c)` has to be written with
 * the parentheses, and then the operand is a `parenthesized_expression`. A
 * relational pattern holding a bare conditional is a shape C# cannot produce.
 *
 * Only RELATIONAL patterns do this: `n is 3 ? 1 : 2` parses correctly, because
 * a constant pattern is complete at `3` and the grammar has no reason to keep
 * reading. The relational operator is what leaves it expecting an expression.
 */
export function relationalPatternSwallowOf(node: Parser.SyntaxNode):
  | { readonly conditional: Parser.SyntaxNode; readonly constant: Parser.SyntaxNode }
  | undefined {
  if (node.type !== 'is_pattern_expression') {
    return undefined;
  }
  const pattern = node.childForFieldName('pattern');
  if (pattern === null) {
    return undefined;
  }
  // The relational pattern can be nested under `not` and `and`: `q is not null
  // and < 0 ? … : …` puts it two levels down, and that is the commonest
  // spelling of the idiom. The swallow is always at the END of the pattern, so
  // the same rightmost-leaf walk finds it — and it never descends into an
  // expression, which would find a conditional that is somebody else's.
  const leaf = rightmostPatternLeafOf(pattern);
  if (leaf.type !== 'relational_pattern') {
    return undefined;
  }
  const operand = onlyExpressionOf(leaf);
  if (operand?.type !== 'conditional_expression') {
    return undefined;
  }
  const constant = operand.childForFieldName('condition');
  return constant === null ? undefined : { conditional: operand, constant };
}

/** The is-expression whose pattern swallowed this conditional, or nothing. */
export function swallowedConditionalIsPatternOf(
  node: Parser.SyntaxNode
): Parser.SyntaxNode | undefined {
  if (node.type !== 'conditional_expression') {
    return undefined;
  }
  let cur: Parser.SyntaxNode = node;
  for (let guard = 0; guard < 64; guard += 1) {
    const parent = cur.parent;
    if (parent === null) {
      return undefined;
    }
    if (parent.type === 'is_pattern_expression') {
      return relationalPatternSwallowOf(parent)?.conditional.id === node.id ? parent : undefined;
    }
    cur = parent;
  }
  return undefined;
}

/**
 * C# 12's COLLECTION EXPRESSION, read as an index binding.
 *
 * `tree-sitter-c-sharp` 0.23.1 has NO `collection_expression` rule at all —
 * node-types.json declares none — so every `[…]` in a value position is read as
 * `element_binding_expression`, the node for the `?.[i]` form of an index
 * access:
 *
 *     int[] a = [1, 2];
 *       element_binding_expression        <- read as an INDEX ACCESS
 *         argument > integer_literal 1    <- read as an INDEX
 *         argument > integer_literal 2
 *
 *     int[] a = [];
 *       element_binding_expression
 *         argument > identifier ""        <- ZERO WIDTH: inserted by recovery
 *
 *     int[] a = [.. xs];
 *       element_binding_expression
 *         argument > range_expression     <- the spread read as a RANGE
 *
 * The fact base gains an element access the source does not contain — with the
 * elements filed as INDEX_ARGUMENTs — and loses every collection. The empty
 * form additionally emits a reference to a name that is the empty string, and
 * is the only one of the three that sets `hasError`, so the other two are
 * silent.
 *
 * THE DISCRIMINATOR IS THE ABSENT RECEIVER. `element_binding_expression` exists
 * in C# only inside a conditional access — `a?[0]` — where the grammar makes it
 * a child of the `conditional_access_expression`. A standalone one has no
 * receiver to index, which no C# expression can mean. So the parent decides it,
 * exactly.
 *
 * Measured over the eight corpora: 4,013 EMPTY collection expressions alone
 * (linq-heavy 2,438, the holdout 1,037, desktop-A 185, framework-bcl 154, library-A 126, source-generator-B
 * 61, modern-app 12, old-style-A 0). The non-empty forms parse without an error and were
 * therefore invisible to every gap measurement.
 */
export function misparsedCollectionExpressionOf(
  node: Parser.SyntaxNode
): { readonly elements: readonly Parser.SyntaxNode[] } | undefined {
  if (node.type !== 'element_binding_expression') {
    return undefined;
  }
  if (node.parent?.type === 'conditional_access_expression') {
    // `a?[0]` — the one legal use of this node. Untouched.
    return undefined;
  }
  const elements = namedChildren(node).filter((child) => {
    if (child.type !== 'argument') {
      return false;
    }
    const inner = onlyExpressionOf(child);
    // THE INSERTED NODE IS NOT AN ELEMENT. `[]` has no elements, and the
    // identifier the recovery put there is zero width — `isMissing` is false on
    // it, which is why the test is the width and not the flag. A zero-width
    // element counted as one would make every empty collection a one-element
    // collection of nothing.
    return inner !== undefined && inner.startIndex !== inner.endIndex;
  });
  return { elements };
}

/**
 * Is this zero-width node part of the `[]` the recovery filled in?
 *
 * BOTH the `argument` and the `identifier` inside it are zero width, and the
 * gap walk reaches whichever it reaches first — so the climb is two levels
 * rather than one. Checking only the identifier left the gap row on the
 * argument, and 1,368 files still reported a gap for a shape that is read.
 */
export function isEmptyCollectionInsertedNode(node: Parser.SyntaxNode): boolean {
  if (node.startIndex !== node.endIndex) {
    return false;
  }
  let current: Parser.SyntaxNode | null = node.parent;
  for (let guard = 0; guard < 2 && current !== null; guard += 1) {
    if (misparsedCollectionExpressionOf(current) !== undefined) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Is this `range_expression` a SPREAD element of a collection expression?
 *
 * `[.. xs]` spreads; `xs[..5]` and `xs[1..5]` are ranges, and both spellings
 * are common. The two are told apart by POSITION — a spread's parent is an
 * element of a misparsed collection expression, a range index's parent is a
 * bracketed argument list — and by the leading `..`, because `[a..b]` inside a
 * collection expression is one element whose value is a Range.
 */
export function isMisparsedCollectionSpread(node: Parser.SyntaxNode): boolean {
  if (node.type !== 'range_expression' || !node.text.trimStart().startsWith('..')) {
    return false;
  }
  const argument = node.parent;
  const binding = argument?.parent;
  return (
    argument !== null &&
    argument !== undefined &&
    argument.type === 'argument' &&
    binding !== null &&
    binding !== undefined &&
    misparsedCollectionExpressionOf(binding) !== undefined
  );
}

/**
 * `AssertQuery(async, ss => ss.Set<Gear>())` — a call whose first argument is
 * named `async`, read as a LAMBDA.
 *
 * `async` is a contextual keyword, and the published grammar cannot read it as
 * an identifier ANYWHERE: `var x = async;` is an ERROR. In the argument
 * position it does something worse than erroring — it invents a lambda:
 *
 *     lambda_expression                      <- spans the whole call
 *       identifier `AssertQuery`             <- the CALLEE
 *       parameter_list
 *         parameter > identifier `async`     <- an ARGUMENT, read as a parameter
 *         parameter > identifier `ss`        <- the real lambda's parameter
 *       invocation_expression `ss.Set…()`    <- the real lambda's BODY
 *     ERROR `, assertEmpty: true)`           <- the remaining arguments
 *
 * so the fact base gains a lambda whose parameters include the enclosing
 * method's own parameter, and loses the call. 4,783 sites in 143 files of
 * linq-heavy — `AssertQuery` 3,335, `AssertQueryScalar` 602 — and ZERO in modern-app,
 * old-style-A, library-A, desktop-A, multitarget-A, old-style-B, multitarget-B and runtime, because
 * `bool async` as a parameter name is that stratum's test convention rather than a
 * common spelling.
 *
 * THE DISCRIMINATOR is the leading identifier. A lambda begins with its
 * parameters — `x => …` gives `implicit_parameter`, `(a, b) => …` gives
 * `parameter_list`, and `async x => …` gives a `modifier` node — so a
 * `lambda_expression` whose first named child is a bare `identifier` is a shape
 * valid C# cannot produce. Verified against the legal `async`, `static` and
 * multi-parameter forms, which all start with a modifier or a parameter.
 *
 * WHAT IT RECOVERS, and what it refuses. The last "parameter" is the real
 * lambda's parameter and the node after the list is its body, so the call is
 * `callee(earlier parameters…, lambda(last parameter => body))`. Refused when
 * the shape does not fit that exactly — a typed parameter, more than one node
 * after the list, or nothing recognisable in the list — because a call whose
 * arguments were guessed is worse than the lambda it replaces.
 */
export function misparsedAsyncArgumentCallOf(node: Parser.SyntaxNode):
  | {
      readonly callee: Parser.SyntaxNode;
      readonly argumentNodes: readonly Parser.SyntaxNode[];
      readonly lambdaParameter: Parser.SyntaxNode;
      readonly body: Parser.SyntaxNode;
    }
  | undefined {
  if (node.type !== 'lambda_expression') {
    return undefined;
  }
  const children = namedChildren(node);
  const callee = children[0];
  const parameterList = children[1];
  if (
    callee === undefined ||
    callee.type !== 'identifier' ||
    parameterList === undefined ||
    parameterList.type !== 'parameter_list'
  ) {
    return undefined;
  }
  // EXACTLY ONE node after the list. Two means a second lambda argument was
  // read as a sibling — `Q(async, x => y(x), z => w(z))` — and which of them is
  // the body is then a guess.
  const rest = children.slice(2);
  const body = rest[0];
  if (body === undefined || rest.length !== 1) {
    return undefined;
  }
  const parameters = namedChildren(parameterList);
  const lambdaParameter = parameters[parameters.length - 1];
  if (lambdaParameter === undefined || lambdaParameter.type !== 'parameter') {
    return undefined;
  }
  // The last parameter is the lambda's, and it must be an IMPLICIT one — a bare
  // name. A typed parameter in that position is a shape this reading does not
  // describe.
  if (namedChildren(lambdaParameter).length !== 1) {
    return undefined;
  }
  const argumentNodes: Parser.SyntaxNode[] = [];
  for (const parameter of parameters.slice(0, -1)) {
    const inner = namedChildren(parameter);
    if (parameter.type === 'parameter' && inner.length === 1 && inner[0] !== undefined) {
      // `async` and any other bare name before the lambda: an argument.
      argumentNodes.push(inner[0]);
      continue;
    }
    if (parameter.type === 'ERROR' && inner.length === 1 && inner[0] !== undefined) {
      // A non-name argument — `Q(async, 1, ss => …)` puts the `1` in an ERROR
      // inside the parameter list. It is still an argument and still counts,
      // because a call reporting two arguments where three were written is a
      // call an engine cannot match to an overload.
      argumentNodes.push(inner[0]);
      continue;
    }
    return undefined;
  }
  return { callee, argumentNodes, lambdaParameter, body };
}

/** Is this identifier the CALLEE the invented-lambda misparse swallowed? */
export function misparsedAsyncCallAtCalleeOf(node: Parser.SyntaxNode):
  | ReturnType<typeof misparsedAsyncArgumentCallOf>
  | undefined {
  if (node.type !== 'identifier' || node.parent === null) {
    return undefined;
  }
  const found = misparsedAsyncArgumentCallOf(node.parent);
  return found !== undefined && found.callee.id === node.id ? found : undefined;
}

/**
 * The one parameter that is really a parameter, in a lambda the grammar invented.
 *
 * Asked even when {@link misparsedAsyncArgumentCallOf} REFUSES the call — and
 * that is the point. The refusals are shapes whose argument list cannot be
 * reconstructed (two lambda arguments, so which node is the body is a guess),
 * but the leading "parameters" are arguments in every one of them, so leaving
 * them as parameters leaves a FALSE binding: 401 lambda parameters named
 * `async` in linq-heavy survived the call repair because their call was refused.
 *
 * A missing call is a gap a consumer can see. A lambda parameter named after
 * the enclosing method's own parameter is a binding that resolves, wrongly.
 */
export function inventedLambdaParameterOf(
  node: Parser.SyntaxNode
): Parser.SyntaxNode | undefined {
  if (node.type !== 'lambda_expression') {
    return undefined;
  }
  const children = namedChildren(node);
  if (children[0]?.type !== 'identifier' || children[1]?.type !== 'parameter_list') {
    return undefined;
  }
  const parameters = namedChildren(children[1]);
  const last = parameters[parameters.length - 1];
  return last !== undefined && last.type === 'parameter' && namedChildren(last).length === 1
    ? last
    : undefined;
}
