import Parser from 'tree-sitter';

import { CsCallSiteRegistry } from '@/analysis-types/csharp/CsCallSiteRegistry';
import { CsExpressionRegistry } from '@/analysis-types/csharp/CsExpressionRegistry';
import { CsQueryClauseRegistry } from '@/analysis-types/csharp/CsQueryClauseRegistry';
import { CsTypeReferenceRegistry } from '@/analysis-types/csharp/CsTypeReferenceRegistry';
import { CsReferenceOwnerKind, CsTypeRefContext } from '@/enums/csharp/type-references';
import {
  isMisparsedCollectionSpread,
  misparsedAsyncArgumentCallOf,
  misparsedAsyncCallAtCalleeOf,
  isPatternSwallowOf,
  misparsedCollectionExpressionOf,
  relationalPatternSwallowOf,
  misparsedGenericCreationArgumentsOf,
  misparsedGenericCreationRunOf,
  misparsedNullConditionalUnder,
  misparsedTupleGenericCreationOf,
  nullConditionalMisparseInPrimaryChainOf,
  nullConditionalTrueReceiverOf,
  rotatedWrapperUnitOf,
  swallowedConditionalIsPatternOf,
  swallowedIsPatternOf,
} from '@/parsers/csharp/extractors/cs-misparse';
import { extractTypeReferences } from '@/parsers/csharp/extractors/cs-type-reference-extractor';
import { CSHARP_EXPRESSION_MAX_DEPTH } from '@/constants/csharp-constants';
import { CsCallKind, CsReceiverKind } from '@/enums/csharp/call-sites';
import { CsQueryClauseKind } from '@/enums/csharp/query';
import {
  CsEdgeRole,
  CsExpressionKind,
  CsExpressionOwnerKind,
  CsLiteralKind,
  CsMethodReferenceKind,
  CsReferencedEntityKind,
  CsRootContext,
  CsUnaryFixity,
} from '@/enums/csharp/expressions';
import {
  allChildren,
  childOfType,
  namedChildren,
  nodeId,
  startColumn,
  startLine,
} from '@/parsers/csharp/extractors/cs-node';
import { resolvePreprocBranches } from '@/parsers/csharp/extractors/preproc-context';
import { normalizeCSharpIdentifier, simpleNameOf } from '@/utils/csharp';

/**
 * `cs_expression` and `cs_call_site` — the spine.
 *
 * A WORKLIST traversal, ported from `expression-reference-extractor.ts` as it
 * was for Python and TypeScript: a node is turned into a row, its children are
 * enqueued with their roles, and the queue is drained. Recursion would blow the
 * stack on generated code, and a queue makes the depth cap a subtraction rather
 * than a call-frame count.
 *
 * ## Four rules from §6, each of which cost a measured number of rows
 *
 * **1. An allowlist of positions, never a generic walk.** A generic walk puts
 * type names into the expression relation, and type-only constructs then reach
 * the call graph. Every entry point below names the context it is extracting
 * from.
 *
 * **2. A tree rooted at a non-emitting node dies before its children are
 * enqueued.** `return (a && b.c())` cost admin-ui 1,808 expressions and
 * `{t(msg)}` in JSX cost 4,488 of 14,335 call sites — both because a wrapper
 * produced no row and took its subtree with it. Here `PARENTHESIZED` **emits a
 * row**, and unwrapping happens in ONE place, {@link unwrapForRoot}, so no
 * position can be handled for one construct and missed for another.
 *
 * **3. The worklist stops at function boundaries — descend explicitly.** A
 * lambda's body belongs to the lambda's own method row. `return function () { … }`
 * emitted the function and nothing inside it, costing 45 of 691 call sites, and
 * every row that WAS emitted was correct — there were simply fewer.
 *
 * **4. Brace every branch.** A dangling `else` in dispatch-heavy code silently
 * doubles or drops output.
 *
 * ## One wrapper, children parented, variant in a column
 *
 * §3's rule, and the reason `EVENT_SUBSCRIBE` exists: `button.Click += Handler`
 * is a subscription that registers an edge firing later, not a compound
 * assignment. Emitting the parts without the wrapper is the defect class that
 * has recurred in every language here.
 */

export interface CsExpressionContext {
  readonly csModuleLinkHash: string;
  readonly csTypeLinkHash: string;
  readonly ownerKind: CsExpressionOwnerKind;
  readonly ownerHash: string;
  readonly rootContext: CsRootContext;
  readonly serviceVersionLinkHash: string;
  /** The `cs_method` that owns any call sites found here. */
  readonly callerMethodLinkHash: string;
  /** Names bound by the enclosing method's parameters — syntactic and certain. */
  readonly parameterNames: ReadonlySet<string>;
  /** Names bound by enclosing type/method type-parameter lists. */
  readonly typeParameterNames: ReadonlySet<string>;
  /**
   * The same names mapped to their `cs_type_parameter` hashes, for the type
   * references an expression carries: `T` in `new List<T>()` is a type
   * VARIABLE and links to its parameter row, not a type named T.
   */
  readonly typeParametersInScope?: ReadonlyMap<string, string>;
  /**
   * Methods declared on the ENCLOSING TYPE, by name.
   *
   * The only thing that makes `methodReferenceKind` a fact rather than a guess.
   * See {@link isMethodGroupPosition}.
   */
  readonly methodNamesOnType: ReadonlySet<string>;
  /**
   * Events declared on the enclosing type, by name.
   *
   * What makes `EVENT_SUBSCRIBE` a fact rather than a guess — see the
   * assignment case in {@link describeExpression}.
   */
  readonly eventNamesOnType: ReadonlySet<string>;
  /**
   * Fields, properties and events declared on the enclosing type, by name.
   *
   * `handler(x)` invokes a DELEGATE exactly when `handler` names a value and not
   * a method. C# forbids a field and a method sharing a name on one type, so
   * within a file one lookup decides it — the same one-hop discipline that
   * grounds METHOD_GROUP and EVENT_SUBSCRIBE.
   */
  readonly valueMemberNamesOnType: ReadonlySet<string>;
  /** Fields and properties the enclosing type declares IN THIS FILE (v1.8). */
  readonly fieldNamesOnType: ReadonlySet<string>;
  readonly propertyNamesOnType: ReadonlySet<string>;
  /** Local functions declared in the body being walked, by name. */
  readonly localFunctionNames: ReadonlySet<string>;
  /**
   * The LAMBDA's own parameters, apart from the enclosing method's.
   *
   * Both are in scope inside the lambda, and both were merged into one set —
   * so `x` in `xs.Select(x => x + 1)` read as a PARAMETER of the enclosing
   * method, which it is not. Which scope a name comes from is the fact.
   */
  readonly lambdaParameterNames: ReadonlySet<string>;
  /** Names bound by `is T x`, `case T x` and `out var x` anywhere in the body. */
  readonly patternBindingNames: ReadonlySet<string>;
  /** Names bound by `from x`, `let x`, `join x`, `into x` anywhere in the body. */
  readonly queryRangeVariableNames: ReadonlySet<string>;
  /** `using A = B.C;` aliases declared in this file. */
  readonly usingAliasNames: ReadonlySet<string>;
  /**
   * Whether `await` is a KEYWORD where this tree stands: inside an async
   * method, lambda or local function, or in top-level statements. Anywhere
   * else `await` is an ordinary identifier, and the grammar — which cannot
   * know the enclosing callable — still reads `await + 1` as an await
   * expression whose operand is `+1`. Roslyn reads an AddExpression of the
   * local `await` and 1. No ERROR node, no count moves (CS-ORACLE-1); the
   * walk re-reads it here from what the enclosing declaration said.
   */
  readonly awaitIsKeyword: boolean;
  /**
   * The preprocessor symbols in force for this emission — the module's
   * `defineConstants` plus the file's own `#define`s — so a `#if` in
   * EXPRESSION position can take its branch. The grammar has had
   * `preproc_if_in_expression` since upstream and the walk never read it: an
   * argument, an initializer, an arrow body or a declarator whose value was
   * `#if A … #else … #endif` emitted NOTHING — neither branch, no row, no gap.
   * About ninety sites across nine strata.
   */
  readonly activeSymbols: ReadonlySet<string>;
}

/**
 * A reference whose declaration row does not exist yet when the reference is
 * emitted — a local, a pattern binding, a query range variable, a parameter.
 *
 * The expression pass runs BEFORE the block pass that mints `cs_variable`
 * rows (the block pass reads the expression hashes), so the same-file,
 * one-hop link from a reference to its declaration cannot be written at
 * reference time. It is recorded here and resolved once the member's
 * declarations all exist: the declaration is the NEAREST PRECEDING binding
 * of that name and kind in the same member, which is the language's own rule
 * — C# forbids a nested scope from redeclaring an enclosing name, so within
 * one member the textually nearest earlier declaration is the one in scope.
 */
export interface PendingReferenceLink {
  readonly row: CsExpressionRegistry;
  readonly name: string;
  readonly kind: CsReferencedEntityKind;
}

export interface CsExpressionResult {
  readonly expressions: CsExpressionRegistry[];
  readonly callSites: CsCallSiteRegistry[];
  readonly queryClauses: CsQueryClauseRegistry[];
  /** Filled by the expression pass, resolved by the member pass. */
  readonly pendingReferenceLinks?: PendingReferenceLink[];
  /**
   * Type references in EXPRESSION positions — `(Foo)x`, `new Foo()`, `x is
   * Foo f`, `typeof(Foo)`, `M<Foo>()` — keyed off the expression row's hash.
   * Ruling v1.7: a second pass after the row exists, never a
   * reordering of the declaration-position pass.
   */
  readonly typeReferences?: CsTypeReferenceRegistry[];
  /**
   * The hash of the row emitted for each expression ROOT, keyed by `node.id`.
   *
   * A SIDE TABLE, and keyed on `node.id` rather than set as a property on the
   * node: the wrapper cache evicts, so a property written in one traversal is
   * gone by the next and `.parent` walks then return untagged objects. Right on
   * ten files, dropping rows on ten thousand.
   *
   * `node.id` is stable across wrappers — measured: `childForFieldName` and
   * `namedChildren` return different objects for one node with the same id — so
   * a caller holding the condition it read from a field resolves the row the
   * walk emitted from a child list.
   *
   * It exists so `cs_block.conditionExpressionLinkHash` and
   * `cs_variable.initializerExpressionLinkHash` point at the expression the
   * block or declarator actually holds. A structural link within one file, by
   * exact node identity — not a resolution.
   */
  readonly rootHashByNodeId?: Map<number, string>;
  /**
   * EVERY emitted expression, by `node.id` — not only the roots.
   *
   * Filled during the walk and read after it drains, which is the only order
   * that works: a child's hash does not exist until its row is built, and
   * re-deriving the key here instead would duplicate the PK logic and diverge
   * from it the first time either changed.
   */
  readonly hashByNodeId?: Map<number, string>;
  /** The ROW for each emitted expression, by `node.id`, where a caller needs its depth. */
  readonly rowByNodeId?: Map<number, CsExpressionRegistry>;
}

/**
 * A clause link that cannot be filled yet.
 *
 * The expression it names has not been emitted when the clause row is built,
 * and re-deriving its primary key here would duplicate the PK logic and drift
 * from it. Recorded as a NODE and resolved when the walk drains.
 */
interface DeferredClauseLink {
  readonly clause: CsQueryClauseRegistry;
  readonly node: Parser.SyntaxNode;
  readonly role: 'source' | 'body';
}

/** One queued child, with the role it plays in its parent. */
interface PendingChild {
  readonly node: Parser.SyntaxNode;
  readonly parentHash: string;
  readonly role: CsEdgeRole;
  readonly position: number;
  readonly depth: number;
  /** Locals visible here — grows as the walk passes declarations. */
  readonly localNames: ReadonlySet<string>;
  /**
   * This node is the postfix unit a `?.`-after-an-operator rotation MOVED, and
   * it is being visited from its new parent.
   *
   * The only piece of the rotation that cannot be derived from the tree. Every
   * other part — which node is the true receiver, where a rotated span starts
   * and ends — is a pure function of the node, deliberately, because the
   * wrapper cache evicts and a flag written on a node is gone by the next
   * traversal. This one says WHICH VISIT this is, and a visit is not a property
   * of a node: the unit is popped twice, once from above the operator where it
   * must redirect and once from beneath it where it must emit.
   */
  readonly isRotatedUnit?: boolean;
}

/**
 * Node types that carry a value and therefore get a row.
 *
 * An ALLOWLIST. Anything not here emits nothing rather than something wrong,
 * which is what keeps type-only constructs out of the call graph.
 */
const EXPRESSION_NODE_KINDS: ReadonlyMap<string, CsExpressionKind> = new Map([
  ['invocation_expression', CsExpressionKind.INVOCATION],
  // `: base(x)` and `: this(x)`. A CALL EDGE to a constructor, in a position
  // that is neither a statement nor an expression — and it was emitted nowhere.
  ['constructor_initializer', CsExpressionKind.INVOCATION],
  // `record R(int x) : B(x)` — the base ARGUMENT LIST of a positional record
  // is a call to the base constructor, wrapped by the grammar in this node.
  // The class form `class D(int x) : B(x)` has NO wrapper: the type and the
  // argument list are siblings in `base_list`, and the argument list itself
  // stands for the invocation — see {@link isExpressionNode}. cs-corpus
  // counted 2,207 such calls missing across four sweeps, 3.5% of all misses.
  ['primary_constructor_base_type', CsExpressionKind.INVOCATION],
  // `this` and `base` as RECEIVERS. The grammar exposes them through the
  // `expression` field as ANONYMOUS tokens, so a named-children walk never
  // reached them and `this.Foo()` had no receiver row at all.
  ['this_expression', CsExpressionKind.THIS_REFERENCE],
  ['base_expression', CsExpressionKind.BASE_REFERENCE],
  ['this', CsExpressionKind.THIS_REFERENCE],
  ['base', CsExpressionKind.BASE_REFERENCE],
  ['object_creation_expression', CsExpressionKind.OBJECT_CREATION],
  ['implicit_object_creation_expression', CsExpressionKind.OBJECT_CREATION],
  ['member_access_expression', CsExpressionKind.MEMBER_ACCESS],
  ['element_access_expression', CsExpressionKind.ELEMENT_ACCESS],
  ['identifier', CsExpressionKind.NAME_REFERENCE],
  ['qualified_name', CsExpressionKind.MEMBER_ACCESS],
  ['generic_name', CsExpressionKind.NAME_REFERENCE],
  ['assignment_expression', CsExpressionKind.ASSIGNMENT],
  ['binary_expression', CsExpressionKind.BINARY],
  ['prefix_unary_expression', CsExpressionKind.UNARY],
  ['postfix_unary_expression', CsExpressionKind.UNARY],
  ['conditional_expression', CsExpressionKind.CONDITIONAL],
  ['parenthesized_expression', CsExpressionKind.PARENTHESIZED],
  ['cast_expression', CsExpressionKind.CAST],
  ['as_expression', CsExpressionKind.AS_EXPRESSION],
  ['is_expression', CsExpressionKind.IS_PATTERN],
  ['is_pattern_expression', CsExpressionKind.IS_PATTERN],
  ['switch_expression', CsExpressionKind.SWITCH_EXPRESSION],
  ['switch_expression_arm', CsExpressionKind.SWITCH_ARM],
  ['with_expression', CsExpressionKind.WITH_EXPRESSION],
  // `c with { Comparer = Make(t) }` — each `Name = value` is its own node in
  // this grammar, NOT an `assignment_expression` as it is inside `new C { }`.
  // It is the same member initializer and gets the same row: an ASSIGNMENT
  // whose target is a member of the value being built. Without a kind here the
  // wrapper emitted no row and took its subtree with it — nothing inside a
  // with-initializer was walked, 64 calls on one stratum (CS-CORPUS-21).
  ['with_initializer', CsExpressionKind.ASSIGNMENT],
  // The `_` pattern — a switch arm's `_ =>`, `x is _`. The grammar's own
  // discard node; it binds nothing and gets the kind that says so.
  ['discard', CsExpressionKind.DISCARD],
  // The anonymous `await` TOKEN, pushed only by the non-async re-read below:
  // there it is the identifier `await`.
  ['await', CsExpressionKind.NAME_REFERENCE],
  ['range_expression', CsExpressionKind.RANGE],
  ['index_expression', CsExpressionKind.INDEX],
  ['tuple_expression', CsExpressionKind.TUPLE],
  ['spread_element', CsExpressionKind.SPREAD_ELEMENT],
  // `new T[] { … }` and `new[] { … }`. Absent from this list, they emitted no
  // row — and every element inside them died with the parent, which is 129 of
  // the 1,104 object creations in multitarget-A.
  ['array_creation_expression', CsExpressionKind.ARRAY_CREATION],
  ['implicit_array_creation_expression', CsExpressionKind.ARRAY_CREATION],
  // The grammar's names, checked against node-types.json rather than guessed:
  // `stackalloc_expression`, not `stackalloc_array_creation_expression`.
  ['stackalloc_expression', CsExpressionKind.STACKALLOC],
  ['implicit_stackalloc_expression', CsExpressionKind.STACKALLOC],
  ['interpolated_string_expression', CsExpressionKind.INTERPOLATED_STRING],
  ['interpolation', CsExpressionKind.INTERPOLATION],
  ['lambda_expression', CsExpressionKind.LAMBDA],
  ['anonymous_method_expression', CsExpressionKind.ANONYMOUS_METHOD],
  ['anonymous_object_creation_expression', CsExpressionKind.ANONYMOUS_OBJECT],
  ['collection_expression', CsExpressionKind.COLLECTION_EXPRESSION],
  ['query_expression', CsExpressionKind.QUERY],
  ['await_expression', CsExpressionKind.AWAIT],
  ['typeof_expression', CsExpressionKind.TYPEOF],
  ['sizeof_expression', CsExpressionKind.SIZEOF],
  ['stackalloc_expression', CsExpressionKind.STACKALLOC],
  ['default_expression', CsExpressionKind.DEFAULT],
  ['throw_expression', CsExpressionKind.THROW_EXPRESSION],
  ['ref_expression', CsExpressionKind.REF_EXPRESSION],
  ['pointer_indirection_expression', CsExpressionKind.POINTER_INDIRECTION],
  ['checked_expression', CsExpressionKind.CHECKED_EXPRESSION],
  ['conditional_access_expression', CsExpressionKind.MEMBER_ACCESS],
  ['member_binding_expression', CsExpressionKind.MEMBER_ACCESS],
  // Fork rule 14. The node STANDS FOR the taken branch's outermost segment —
  // an invocation, a member access or an element access — and the kind is
  // that segment's, read in emitOne. The placeholder is never emitted: a chain
  // with no taken branch unwraps to its receiver before it gets here.
  ['preproc_chain_expression', CsExpressionKind.MEMBER_ACCESS],
  // Fork rule 14, the operator form: `a\n#if X\n || b\n#endif` is a BINARY
  // whose operator and right operand are in the taken branch.
  ['preproc_operator_expression', CsExpressionKind.BINARY],
  // …and its mirror, `a ||\n#if X\n b ||\n#endif\n c`: the branch holds the
  // left operand AND the operator, the right follows the `#endif`.
  ['preproc_head_expression', CsExpressionKind.BINARY],
  ['element_binding_expression', CsExpressionKind.ELEMENT_ACCESS],
  ['initializer_expression', CsExpressionKind.INITIALIZER],
  ['this_expression', CsExpressionKind.THIS_REFERENCE],
  ['base_expression', CsExpressionKind.BASE_REFERENCE],
  ['predefined_type', CsExpressionKind.NAME_REFERENCE],
]);

const LITERAL_NODE_KINDS: ReadonlyMap<string, CsLiteralKind> = new Map([
  ['integer_literal', CsLiteralKind.INTEGER],
  ['real_literal', CsLiteralKind.REAL],
  ['character_literal', CsLiteralKind.CHARACTER],
  ['string_literal', CsLiteralKind.STRING],
  ['verbatim_string_literal', CsLiteralKind.VERBATIM_STRING],
  ['raw_string_literal', CsLiteralKind.RAW_STRING],
  ['boolean_literal', CsLiteralKind.BOOLEAN],
  ['null_literal', CsLiteralKind.NULL],
]);

/**
 * Node types whose bodies belong to their OWN method row.
 *
 * §6: the worklist stops at function boundaries. A lambda gets an expression row
 * — it is a value — but its body is the lambda's, not the enclosing method's,
 * and walking into it here would attribute every call inside a callback to the
 * method that created it.
 */
const FUNCTION_BOUNDARY_KINDS = new Set([
  'lambda_expression',
  'anonymous_method_expression',
]);

/**
 * Whether a node would produce an expression row.
 *
 * Exported so the statement walker can tell an EXPRESSION from a STATEMENT
 * without keeping a second copy of the allowlist — a second copy is a second
 * place for it to be wrong, and the statement walker's own node-name table had
 * already drifted from the grammar once.
 */
export function isExpressionNode(node: Parser.SyntaxNode): boolean {
  return (
    EXPRESSION_NODE_KINDS.has(node.type) ||
    LITERAL_NODE_KINDS.has(node.type) ||
    isPrimaryBaseArgumentList(node)
  );
}

/**
 * `class D(int x) : B(x)` — the argument list in a class's base list, which
 * the grammar leaves as a bare sibling of the base type. It is the only node
 * that stands for the base-constructor invocation, so it is the invocation.
 * An `argument_list` anywhere else is a part of its parent and never a row.
 */
function isPrimaryBaseArgumentList(node: Parser.SyntaxNode): boolean {
  return node.type === 'argument_list' && node.parent?.type === 'base_list';
}

/**
 * The node named as the base TYPE of a primary-constructor base invocation:
 * the `type` field on the record wrapper, or the sibling just before the
 * argument list in a class's base list.
 */
function primaryBaseCalleeOf(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  if (node.type === 'primary_constructor_base_type') {
    return node.childForFieldName('type') ?? undefined;
  }
  const siblings = namedChildren(node.parent!);
  const index = siblings.findIndex((c) => c.id === node.id);
  return index > 0 ? siblings[index - 1] : undefined;
}

/** `A.B<T>` → `B`: the identifier a type name ends in, without its arguments. */
function typeSimpleNameOf(type: Parser.SyntaxNode): string {
  if (type.type === 'qualified_name' || type.type === 'alias_qualified_name') {
    const name = type.childForFieldName('name');
    return name === null ? normalizeCSharpIdentifier(simpleNameOf(type.text)) : typeSimpleNameOf(name);
  }
  if (type.type === 'generic_name') {
    const identifier = namedChildren(type).find((c) => c.type === 'identifier');
    return identifier === undefined ? normalizeCSharpIdentifier(simpleNameOf(type.text)) : normalizeCSharpIdentifier(identifier.text);
  }
  return normalizeCSharpIdentifier(simpleNameOf(type.text));
}

/**
 * The argument list of a primary-constructor base invocation: inside the
 * record wrapper, or the bare list itself in a class's base list — and
 * `undefined` for anything else.
 *
 * It returned the NODE ITSELF for anything that was not the wrapper. For a
 * `constructor_initializer` that node is the initializer, whose one named
 * child is the real `argument_list`; pushed as an ARGUMENT it is no
 * expression and died with every call inside it. `: base(M())` kept the base
 * call and lost `M()` — 455 calls on the corpus, every call inside every
 * constructor initializer's argument list (CS-CORPUS-19), introduced by the
 * commit that fixed CS-CORPUS-6 and invisible to its gate, whose fixture's
 * initializers carried no calls.
 */
function primaryBaseArgumentListOf(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  if (node.type === 'primary_constructor_base_type') {
    return childOfType(node, 'argument_list');
  }
  return isPrimaryBaseArgumentList(node) ? node : undefined;
}

export function extractExpressionTree(
  root: Parser.SyntaxNode,
  context: CsExpressionContext,
  result: CsExpressionResult,
  rootPosition = 0,
  /**
   * Locals declared TEXTUALLY EARLIER in an enclosing block.
   *
   * `collectExpressionRoots` has computed this all along and no caller passed
   * it, so every walk seeded an empty set and `LOCAL_VARIABLE` was emitted zero
   * times in 2,965,349 expressions. The column was implemented, the value was
   * declared, and nothing connected them — which is exactly what the enum audit
   * exists to catch and could not, because the enum was not in its list.
   */
  localNames: ReadonlySet<string> = new Set(),
  /**
   * A parent for the tree's root, when it has one in ANOTHER owner's tree.
   *
   * An expression-bodied lambda's body is owned by the lambda's own method row
   * — its calls belong to the callback, not to whoever created it — but it is
   * also, by ruling (schema v1.3), a CHILD of the `LAMBDA` expression with
   * `edgeRole = LAMBDA_BODY`. One row, both links: `expressionOwnerHash` says
   * whose code it is, `parentExpressionHash` says where it sits. Emitting it
   * twice to get both would DOUBLE every lambda body in the corpus.
   */
  attachTo?: { readonly parent: CsExpressionRegistry; readonly role: CsEdgeRole }
): void {
  // §6, ONE PLACE. A wrapper that produces no row must not take its subtree
  // with it, and doing this at every call site is how one position gets handled
  // and another does not.
  const start = unwrapForRoot(root, context.activeSymbols);
  if (start === undefined) {
    return;
  }

  const deferred: DeferredClauseLink[] = [];
  const before = result.expressions.length;
  const queue: PendingChild[] = [
    {
      node: start,
      parentHash: attachTo === undefined ? '' : attachTo.parent.getHash(),
      role: attachTo === undefined ? CsEdgeRole.ROOT : attachTo.role,
      position: rootPosition,
      depth: attachTo === undefined ? 0 : attachTo.parent.depth + 1,
      localNames,
    },
  ];

  const hashByNodeId = result.hashByNodeId ?? new Map<number, string>();
  const walkResult: CsExpressionResult = { ...result, hashByNodeId };
  // The call site minted for each invocation row, so the RECEIVER child —
  // emitted later in the same walk — can hand its hash back.
  const callSiteByParentHash = new Map<string, CsCallSiteRegistry>();
  while (queue.length > 0) {
    const pending = queue.shift()!;
    emitOne(pending, context, walkResult, queue, deferred, callSiteByParentHash);
  }

  // AFTER the walk. A clause's `sourceExpressionLinkHash` and
  // `bodyExpressionLinkHash` name rows that did not exist while the clause row
  // was being built, so they are recorded as NODES and resolved here.
  //
  // Both columns were declared, documented as the hop an engine needs to
  // desugar a query, and EMPTY on every row in the corpus. The clause rows
  // carried a position and a kind and pointed at nothing — an opaque blob with
  // an ordering. Found by strengthening the LINQ check to assert through these
  // links instead of "the query has at least one child expression", which was
  // passing for the wrong reason.
  for (const link of deferred) {
    const hash = hashByNodeId.get(nodeId(link.node));
    if (hash === undefined) {
      continue;
    }
    if (link.role === 'source') {
      link.clause.setSourceExpressionLinkHash(hash);
      continue;
    }
    link.clause.setBodyExpressionLinkHash(hash);
  }

  // The walk is BREADTH-FIRST from a single seed, so the first row it pushed is
  // the root's. Recorded under BOTH the node handed in and the node the unwrap
  // landed on: a caller holding an `equals_value_clause` and a caller holding
  // the expression inside it are asking about the same row.
  const map = result.rootHashByNodeId;
  if (map !== undefined && result.expressions.length > before) {
    const rootHash = result.expressions[before]!.getHash();
    // Under BOTH the node handed in and the node the unwrap landed on: a caller
    // holding an `arrow_expression_clause` and one holding the expression inside
    // it are asking about the same row.
    map.set(nodeId(root), rootHash);
    map.set(nodeId(start), rootHash);
  }
}

/**
 * Unwraps the nodes that are not expressions but CONTAIN one.
 *
 * Statement wrappers, `equals_value_clause`, `arrow_expression_clause`,
 * `argument`. Each produces no row of its own, and a walk that started at one
 * would find no expression and emit nothing for the whole tree.
 *
 * Parentheses are NOT unwrapped here — they get a row of their own and their
 * operand is enqueued as a child. That is the fix for the 1,808-expression loss,
 * and it keeps `(a).M()` distinguishable from `a.M()`.
 */
function unwrapForRoot(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode | undefined {
  let current: Parser.SyntaxNode | undefined = node;
  const transparent = new Set([
    'expression_statement',
    'equals_value_clause',
    'arrow_expression_clause',
    'argument',
    'return_statement',
    'throw_statement',
    'yield_statement',
    'global_statement',
  ]);
  while (
    current !== undefined &&
    (transparent.has(current.type) ||
      current.type === 'preproc_if' ||
      current.type === 'preproc_chain_expression' ||
      current.type === 'preproc_operator_expression' ||
      current.type === 'preproc_head_expression')
  ) {
    if (current.type === 'preproc_if') {
      current = takenExpressionOf(current, activeSymbols);
      continue;
    }
    if (current.type === 'preproc_chain_expression') {
      // With a taken chain the node is the row (rule 14); without one — no
      // branch holds, or the branch is refused — the chain is its receiver.
      if (takenChainContentOf(current, activeSymbols) !== undefined) {
        break;
      }
      current = current.childForFieldName('expression') ?? undefined;
      continue;
    }
    if (current.type === 'preproc_operator_expression') {
      // The same for the operator form: no taken tail, and it is its left.
      if (takenOperatorTailOf(current, activeSymbols) !== undefined) {
        break;
      }
      current = current.childForFieldName('left') ?? undefined;
      continue;
    }
    if (current.type === 'preproc_head_expression') {
      // And the mirror: no taken head, and it is its right.
      if (takenOperatorHeadOf(current, activeSymbols) !== undefined) {
        break;
      }
      current = current.childForFieldName('right') ?? undefined;
      continue;
    }
    // Skip a `name` field on the way down: a named `argument` at the root —
    // a primary-constructor base argument is one — would otherwise unwrap to
    // its LABEL rather than its value, which is the same defect the child-side
    // unwrap had.
    const label: Parser.SyntaxNode | null = current.childForFieldName('name');
    const inner: Parser.SyntaxNode | undefined = namedChildren(current).find(
      (child) => label === null || child.id !== label.id
    );
    current = inner;
  }
  if (current === undefined) {
    return undefined;
  }
  return isExpressionNode(current) ? current : undefined;
}

// ---------------------------------------------------------------------------
// Fork rule 14 — a `#if` splitting a fluent chain
//
//   builder
//   #if DEBUG
//       .UseX(o => …)
//   #else
//       .UseY()
//   #endif
//       .Build();
//
// parses as `invocation(member_access(preproc_chain_expression(expression:
// builder, preproc_if(…)), Build))`, and each branch holds a RECEIVER-LESS
// chain whose innermost node is a `member_binding_expression` — the shape
// `?.` already gives one. The rows are the rows `builder.UseX(…).Build()`
// would have produced: the chain node IS the row for the taken branch's
// outermost segment (its span already runs from the receiver to `#endif`),
// the binding's receiver is the chain's `expression`, and every inner segment
// starts, for span purposes, where the receiver starts — which is where
// `builder.UseX(…)` starts in the source. Every child then sits inside its
// parent, and the containment invariant holds without an exemption.
// ---------------------------------------------------------------------------

/** The segment kinds a chain branch is built from, outermost to innermost. */
const CHAIN_SEGMENT_TYPES: ReadonlySet<string> = new Set([
  'invocation_expression',
  'member_access_expression',
  'element_access_expression',
  'member_binding_expression',
]);

/**
 * The taken branch's outermost segment of a `preproc_chain_expression`, or
 * nothing — when no branch holds, or the branch is not one clean chain.
 */
function takenChainContentOf(
  chain: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode | undefined {
  const ifNode = childOfType(chain, 'preproc_if');
  if (ifNode === undefined) {
    return undefined;
  }
  const { branches, bodies } = resolvePreprocBranches(ifNode, activeSymbols);
  const taken = branches.findIndex((b) => b.isActive);
  if (taken < 0) {
    return undefined;
  }
  const body = bodies.get(taken) ?? [];
  if (body.some((n) => !isSeparatorDebris(n))) {
    return undefined;
  }
  const segments = body.filter((n) => CHAIN_SEGMENT_TYPES.has(n.type));
  return segments.length === 1 ? segments[0] : undefined;
}

/**
 * An ERROR in a `#if` branch is REFUSED unless it is only a separator.
 *
 * Two kinds of ERROR reach a branch body. A misparse — `a\n#if X\n + b` puts
 * `+ b` in one, and the branch's expression, if any, is then a different
 * program (the `-b` of the other arm read as a unary). Taking it emits a
 * right-looking row of the wrong shape. And debris — an argument's own comma
 * or a declarator's own semicolon written INSIDE each branch, `#if A\n x,\n
 * #else\n y,\n#endif`, which the grammar cannot place and leaves as `(ERROR
 * ,)` beside a content that is exactly right. Refusing those drops fourteen
 * correct argument sites for a comma. The line is drawn at the text: a
 * separator on its own is debris, anything else is a misparse.
 */
function isSeparatorDebris(node: Parser.SyntaxNode): boolean {
  if (node.isMissing) {
    return false;
  }
  if (node.type !== 'ERROR') {
    return true;
  }
  const text = node.text.trim();
  return text === ',' || text === ';';
}

/**
 * The taken branch's `operator_tail` of a `preproc_operator_expression`, or
 * nothing — when no branch holds, or the branch is not one clean tail.
 */
function takenOperatorTailOf(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode | undefined {
  const ifNode = childOfType(node, 'preproc_if');
  if (ifNode === undefined) {
    return undefined;
  }
  const { branches, bodies } = resolvePreprocBranches(ifNode, activeSymbols);
  const taken = branches.findIndex((b) => b.isActive);
  if (taken < 0) {
    return undefined;
  }
  const body = bodies.get(taken) ?? [];
  if (body.some((n) => !isSeparatorDebris(n))) {
    return undefined;
  }
  const tails = body.filter((n) => n.type === 'operator_tail');
  return tails.length === 1 ? tails[0] : undefined;
}

/** The taken branch's `operator_head` of a `preproc_head_expression`, or nothing. */
function takenOperatorHeadOf(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode | undefined {
  const ifNode = childOfType(node, 'preproc_if');
  if (ifNode === undefined) {
    return undefined;
  }
  const { branches, bodies } = resolvePreprocBranches(ifNode, activeSymbols);
  const taken = branches.findIndex((b) => b.isActive);
  if (taken < 0) {
    return undefined;
  }
  const body = bodies.get(taken) ?? [];
  if (body.some((n) => !isSeparatorDebris(n))) {
    return undefined;
  }
  const heads = body.filter((n) => n.type === 'operator_head');
  return heads.length === 1 ? heads[0] : undefined;
}

/**
 * The receiver a chain binding is applied to — the `expression` of the
 * `preproc_chain_expression` above it — or nothing when the binding is not
 * in a chain (a `?.` binding sits under a `conditional_access_expression`
 * and stops the climb at once). The climb follows HEAD positions only: the
 * `function` of an invocation, the `expression` of a member or element
 * access. A lambda in an argument list is not on that path and never climbs.
 */
function chainReceiverOf(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  let current: Parser.SyntaxNode = node;
  for (let guard = 0; guard < 64; guard += 1) {
    const parent = current.parent;
    if (parent === null) {
      return undefined;
    }
    if (parent.type === 'preproc_chain_expression') {
      return parent.childForFieldName('expression') ?? undefined;
    }
    if (parent.type === 'preproc_if' || parent.type === 'preproc_elif' || parent.type === 'preproc_else') {
      current = parent;
      continue;
    }
    if (CHAIN_SEGMENT_TYPES.has(parent.type)) {
      const head = parent.childForFieldName('function') ?? parent.childForFieldName('expression');
      if (head !== null && head.id === current.id) {
        current = parent;
        continue;
      }
    }
    return undefined;
  }
  return undefined;
}

/** The innermost head of a segment — the binding, if the segment is in a chain. */
function chainBindingUnder(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  let current: Parser.SyntaxNode = node;
  for (let guard = 0; guard < 64; guard += 1) {
    if (current.type === 'member_binding_expression') {
      return chainReceiverOf(current) === undefined ? undefined : current;
    }
    if (!CHAIN_SEGMENT_TYPES.has(current.type)) {
      return undefined;
    }
    const head = current.childForFieldName('function') ?? current.childForFieldName('expression');
    if (head === null) {
      return undefined;
    }
    current = head;
  }
  return undefined;
}

/**
 * Where a row's span STARTS. A segment inside a chain branch starts where the
 * chain's receiver starts — `builder.UseX(…)` begins at `builder` — so the
 * receiver row it parents sits inside it. Every other node starts at itself.
 */
function spanStartOf(node: Parser.SyntaxNode): Parser.Point {
  const binding = chainBindingUnder(node);
  if (binding !== undefined) {
    const receiver = chainReceiverOf(binding);
    if (receiver !== undefined) {
      return receiver.startPosition;
    }
  }
  // `a || b?.M()` — the grammar gives the conditional access, and every postfix
  // node above it, a span starting at `a`. After the rotation their parent is
  // the operator, so a span starting at `a` would start OUTSIDE the text its
  // own parent covers — and a child span outside its parent's is the one span
  // defect that cannot be repaired downstream, because there is no longer any
  // way to tell which of the two is wrong. `b?.M()` starts at `b`.
  const misparse = nullConditionalMisparseInPrimaryChainOf(node);
  if (misparse !== undefined) {
    return misparse.receiver.startPosition;
  }
  // The operator of a swallowed tail starts where the is-expression does: `x is
  // null || y` is one expression beginning at `x`, and the grammar started it
  // at `null` because that is where it thought the pattern's constant began.
  const swallowed = swallowedIsPatternOf(node);
  if (swallowed !== undefined) {
    return swallowed.startPosition;
  }
  // `n is < -1 ? a : b` is one conditional expression beginning at `n`; the
  // grammar started it at `-1`, the constant it thought the pattern wanted.
  const swallowedConditional = swallowedConditionalIsPatternOf(node);
  if (swallowedConditional !== undefined) {
    return swallowedConditional.startPosition;
  }
  return node.startPosition;
}

/**
 * The END of a row's span, grafted for the operator a `?.` rotation moved.
 *
 * `a || b?.M()` gives the binary the span of `a || b`, because the grammar
 * stopped it at what it read as the conditional access's receiver. The operator
 * truly ends where the whole postfix unit ends — that IS its right operand —
 * so the graft makes the span true rather than merely consistent.
 */
function spanEndOf(node: Parser.SyntaxNode): Parser.Point {
  // A creation the grammar stopped at its type name ends at its ARGUMENTS —
  // `new HashSet<(string N, string S)>(src)` ends on the `)`, and a creation
  // row ending on a letter is the signature of exactly this misparse.
  const creationArguments = misparsedGenericCreationArgumentsOf(node);
  if (creationArguments !== undefined) {
    return creationArguments.argumentsNode.endPosition;
  }
  // A CALL THE GRAMMAR READ AS A LAMBDA ends where that lambda does. Its row is
  // built from the callee IDENTIFIER, whose own span is just the name — so
  // without this the arguments and the lambda, which are its children, would
  // all lie outside their parent's span.
  const asyncCallee = misparsedAsyncCallAtCalleeOf(node);
  if (asyncCallee !== undefined && node.parent !== null) {
    return node.parent.endPosition;
  }
  // An is-expression whose pattern swallowed a boolean tail ends at the CONSTANT
  // — `x is null` ends on `null`, not at the end of everything the pattern ate.
  const swallow = isPatternSwallowOf(node);
  if (swallow !== undefined) {
    return swallow.innerLeft.endPosition;
  }
  // `n is < -1` ends on the `1`, not at the end of the conditional its pattern
  // swallowed.
  const relational = relationalPatternSwallowOf(node);
  if (relational !== undefined) {
    return relational.constant.endPosition;
  }
  return rotatedWrapperUnitOf(node)?.endPosition ?? node.endPosition;
}

/**
 * The one expression a `#if` in expression position stands for under this
 * emission, or nothing.
 *
 * `x = \n#if A\n F(1)\n#else\n G(2)\n#endif\n;` is `x = F(1)` when A is
 * defined and `x = G(2)` when it is not — one program per emission (schema
 * §2.2 option 3), so the wrapper is transparent to the TAKEN branch and the
 * other branch does not exist. Nothing is taken when no branch holds (`#if
 * false` with no `#else`), which is correct: the expression is not there.
 *
 * REFUSED when the taken branch is not exactly one expression, or holds an
 * ERROR that is more than a separator — see {@link isSeparatorDebris}. Before
 * fork rule 14 the chain form `x\n#if A\n .M()\n#endif\n .N()` was a
 * coherent misparse whose branch held `(ERROR) (invocation M())`, and taking
 * it would have emitted `M()` as a receiver-less FUNCTION_CALL: a
 * correctly-positioned row with the wrong kind and no receiver, the defect
 * class no count can see. The parse-gap extractor records what is refused;
 * silence with a gap row beats a confident wrong row.
 */
function takenExpressionOf(
  ifNode: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode | undefined {
  const { branches, bodies } = resolvePreprocBranches(ifNode, activeSymbols);
  const taken = branches.findIndex((b) => b.isActive);
  if (taken < 0) {
    return undefined;
  }
  const body = bodies.get(taken) ?? [];
  if (body.some((n) => !isSeparatorDebris(n))) {
    return undefined;
  }
  const expressions = body.filter((n) => isExpressionNode(n) || n.type === 'preproc_if');
  if (expressions.length !== 1) {
    return undefined;
  }
  return expressions[0];
}

function emitOne(
  pending: PendingChild,
  context: CsExpressionContext,
  result: CsExpressionResult,
  queue: PendingChild[],
  deferred: DeferredClauseLink[],
  callSiteByParentHash: Map<string, CsCallSiteRegistry>
): void {
  const { node: rowNode, depth } = pending;
  if (depth > CSHARP_EXPRESSION_MAX_DEPTH) {
    // Dropped rather than emitted at a wrong depth. The parent is still present,
    // so the loss is a missing subtree and not a silently reshaped tree.
    return;
  }

  // Rule 14: a chain node is the ROW for its taken branch's outermost
  // segment — that segment decides the kind, the shape, the call site and
  // the children; the chain node decides the span and the identity.
  const node = rowNode.type === 'preproc_chain_expression'
    ? takenChainContentOf(rowNode, context.activeSymbols)
    : rowNode;
  if (node === undefined) {
    return;
  }

  const literalKind = LITERAL_NODE_KINDS.get(node.type);
  const kind = literalKind !== undefined
    ? CsExpressionKind.LITERAL
    : isPrimaryBaseArgumentList(node)
      ? CsExpressionKind.INVOCATION
      : EXPRESSION_NODE_KINDS.get(node.type);
  if (kind === undefined) {
    return;
  }

  // THE ROTATION. `a || b?.M()` is `a || (b?.M())` in C# and the grammar read it
  // as `(a || b)?.M()`, so the postfix unit — the conditional access and every
  // invocation and member access built on it — is emitted as the operator's
  // RIGHT OPERAND rather than as its parent. Redirected here, at the unit's
  // top, by enqueueing the operator in the unit's place; the operator then
  // enqueues the unit back, with the flag that stops this firing twice.
  //
  // The node SET is unchanged: every node that had a row still has exactly one.
  // Only parentage and the two grafted spans differ, which is why the rotation
  // cannot double a row — there is nothing new to double.
  // THE OTHER ROTATION. `new HashSet<(string N, string S)>(src)` is read as
  // `((new HashSet) < (N, S)) > (src)`: two comparisons whose parts are a
  // creation with no arguments, a tuple of declaration expressions and an
  // argument list. The row that belongs here is the CREATION, spanning to the
  // end of its arguments — so the comparison is replaced by it, and the tuple
  // that stood for the type arguments is never walked. It is a TYPE, and a type
  // gets no expression rows.
  if (misparsedTupleGenericCreationOf(node) !== undefined) {
    const creation = misparsedTupleGenericCreationOf(node)!.creation;
    queue.push({
      node: creation,
      parentHash: pending.parentHash,
      role: pending.role,
      position: pending.position,
      depth,
      localNames: pending.localNames,
    });
    return;
  }

  // THE INVENTED LAMBDA. `AssertQuery(async, ss => …)` is a CALL, and the
  // grammar read it as a lambda whose parameters are the call's arguments —
  // `async` among them, which is the enclosing method's own parameter. The row
  // that belongs at this position is the invocation, and its node is the callee
  // identifier the lambda swallowed; the real lambda (the last parameter and the
  // body) is emitted underneath as an argument.
  if (pending.isRotatedUnit !== true && misparsedAsyncArgumentCallOf(node) !== undefined) {
    const call = misparsedAsyncArgumentCallOf(node)!;
    queue.push({
      node: call.callee,
      parentHash: pending.parentHash,
      role: pending.role,
      position: pending.position,
      depth,
      localNames: pending.localNames,
    });
    return;
  }

  // A THIRD ROTATION, same shape as the second. `x is null || data.Length == 0`
  // was read as `x is (null || data.Length == 0)`: the pattern swallowed the
  // rest of the boolean expression, and a pattern's subtree carries no
  // expression rows, so the tail was not misplaced but absent. The operator
  // takes the row; the is-expression becomes its left operand.
  // A FOURTH, the same rotation again: `n is < -1 ? throw … : …` put both arms
  // of the conditional inside the pattern. The conditional takes the row and
  // the is-expression becomes its condition.
  if (pending.isRotatedUnit !== true) {
    const relational = relationalPatternSwallowOf(node);
    if (relational !== undefined) {
      queue.push({
        node: relational.conditional,
        parentHash: pending.parentHash,
        role: pending.role,
        position: pending.position,
        depth,
        localNames: pending.localNames,
      });
      return;
    }
  }

  if (pending.isRotatedUnit !== true) {
    const swallow = isPatternSwallowOf(node);
    if (swallow !== undefined) {
      queue.push({
        node: swallow.spineRoot,
        parentHash: pending.parentHash,
        role: pending.role,
        position: pending.position,
        depth,
        localNames: pending.localNames,
      });
      return;
    }
  }

  if (pending.isRotatedUnit !== true) {
    const rotation = misparsedNullConditionalUnder(node);
    if (rotation !== undefined) {
      queue.push({
        node: rotation.wrapper,
        parentHash: pending.parentHash,
        role: pending.role,
        position: pending.position,
        depth,
        localNames: pending.localNames,
      });
      return;
    }
  }

  const shape = describeExpression(node, kind, context, pending.localNames);
  // `[1, 2]` IS A COLLECTION, not an index access. The published grammar has no
  // `collection_expression` rule at all, so every C# 12 collection expression
  // arrives as `element_binding_expression` — the `a?[i]` node — with its
  // elements filed as INDEX_ARGUMENTs. The kind is corrected here, the elements
  // are pushed as elements below, and a leading `..` element becomes the spread
  // it is rather than a range.
  const collection = misparsedCollectionExpressionOf(node);
  if (collection !== undefined) {
    shape.kind = CsExpressionKind.COLLECTION_EXPRESSION;
    shape.argumentCount = collection.elements.length;
  }
  if (isMisparsedCollectionSpread(node)) {
    shape.kind = CsExpressionKind.SPREAD_ELEMENT;
    shape.isSpread = true;
  }
  const referencedEntityKind = referencedEntityKindOf(node, shape.kind, pending, context);
  const spanStart = spanStartOf(rowNode);
  const spanEnd = spanEndOf(rowNode);

  const row = new CsExpressionRegistry({
    kind: shape.kind,
    edgeRole: pending.role,
    rootContext: context.rootContext,
    expressionOwnerKind: context.ownerKind,
    expressionOwnerHash: context.ownerHash,
    parentExpressionHash: pending.parentHash,
    position: pending.position,
    depth,
    csTypeLinkHash: context.csTypeLinkHash,
    csModuleLinkHash: context.csModuleLinkHash,
    // Bare `default` is a LITERAL whose type is whatever the target wants;
    // `default(T)` is a DEFAULT expression naming its type. Same node, and the
    // absent `type` field is the whole difference.
    literalKind:
      kind === CsExpressionKind.DEFAULT && node.childForFieldName('type') === null
        ? CsLiteralKind.DEFAULT_LITERAL
        : (literalKind ?? CsLiteralKind.NONE),
    literalValue: literalKind !== undefined ? node.text : '',
    operatorString: shape.operatorString,
    unaryFixity: shape.unaryFixity,
    methodReferenceKind: shape.methodReferenceKind,
    referencedEntityKind,
    potentialQualifiedName: shape.potentialQualifiedName,
    // A documented PARITY SLOT, always false — deciding a name is ambiguous
    // needs to know what the using scope contains, which is resolution.
    isAmbiguous: false,
    argumentCount: shape.argumentCount,
    typeArgumentCount: shape.typeArgumentCount,
    isSpread: shape.isSpread,
    isNullConditional: shape.isNullConditional,
    isNullForgiving: shape.isNullForgiving,
    isCheckedContext: shape.kind === CsExpressionKind.CHECKED_EXPRESSION,
    returnStatementIndex: undefined,
    startLine: spanStart.row + 1,
    startColumn: spanStart.column,
    endLine: spanEnd.row + 1,
    endColumn: spanEnd.column,
    serviceVersionLinkHash: context.serviceVersionLinkHash,
  });
  result.expressions.push(row);
  result.hashByNodeId?.set(nodeId(rowNode), row.getHash());
  result.rowByNodeId?.set(nodeId(rowNode), row);
  if (LINKABLE_REFERENCE_KINDS.has(referencedEntityKind)) {
    result.pendingReferenceLinks?.push({
      row,
      name: normalizeCSharpIdentifier(node.text),
      kind: referencedEntityKind,
    });
  }

  emitExpressionTypeReferences(node, row, shape.kind, context, result);
  if (pending.role === CsEdgeRole.RECEIVER) {
    // THE RECEIVER LINK, second pass: the parent's call site was minted
    // before this child existed. Keyed off the child's hash now that it does.
    callSiteByParentHash.get(pending.parentHash)?.setReceiverExpressionLinkHash(row.getHash());
  }
  if (shape.callSite !== undefined) {
    const callSite = buildCallSite(node, row, shape, context);
    callSiteByParentHash.set(row.getHash(), callSite);
    result.callSites.push(callSite);
  }

  // A QUERY gets its clauses as their own rows, and NO synthesized calls. The
  // engine desugars: which overload, on which receiver type, through which
  // extension method, in which using scope is four resolutions, and a parser
  // guessing at them would record the guesses as facts.
  if (shape.kind === CsExpressionKind.QUERY) {
    emitQueryClauses(node, row, context, result, queue, depth, deferred);
  }

  // §6: the worklist STOPS at a function boundary. A lambda is a value and gets
  // its row; its body belongs to the lambda's own method and is walked there.
  if (FUNCTION_BOUNDARY_KINDS.has(node.type)) {
    return;
  }

  let childPosition = 0;
  for (const child of childrenWithRoles(node, shape.kind, context)) {
    queue.push({
      node: child.node,
      parentHash: row.getHash(),
      role: child.role,
      position: childPosition,
      depth: depth + 1,
      localNames: pending.localNames,
      isRotatedUnit: child.isRotatedUnit,
    });
    childPosition += 1;
  }
}

/**
 * The clauses of a query, in ORDER, with their sources and bodies.
 *
 * Order is the whole content of the eventual rewrite — `Where().Select()` and
 * `Select().Where()` compute different things — so `position` is in the primary
 * key rather than beside it.
 *
 * Each clause's sub-expressions are enqueued as children of the QUERY node, so
 * `xs`, `p` and `f` are ordinary expression rows that calls inside them reach
 * normally. That is what stops a LINQ-heavy file appearing to call nothing.
 */
const QUERY_CLAUSE_KINDS: ReadonlyMap<string, CsQueryClauseKind> = new Map([
  ['from_clause', CsQueryClauseKind.FROM],
  ['let_clause', CsQueryClauseKind.LET],
  ['where_clause', CsQueryClauseKind.WHERE],
  ['join_clause', CsQueryClauseKind.JOIN],
  ['order_by_clause', CsQueryClauseKind.ORDER_BY],
  ['group_clause', CsQueryClauseKind.GROUP],
  ['select_clause', CsQueryClauseKind.SELECT],
]);

function emitQueryClauses(
  node: Parser.SyntaxNode,
  query: CsExpressionRegistry,
  context: CsExpressionContext,
  result: CsExpressionResult,
  queue: PendingChild[],
  depth: number,
  deferred: DeferredClauseLink[]
): void {
  let position = 0;
  for (const child of namedChildren(node)) {
    // A bare `identifier` directly under the query is the `into` CONTINUATION.
    // Everything after it is a new query over the previous result, so an engine
    // desugaring the chain has to break there — without a row the two halves
    // look like one flat sequence and the rewrite is wrong.
    if (child.type === 'identifier') {
      result.queryClauses.push(
        new CsQueryClauseRegistry({
          csExpressionLinkHash: query.getHash(),
          parentQueryLinkHash: query.getHash(),
          position,
          clauseKind: CsQueryClauseKind.INTO,
          identifierName: normalizeCSharpIdentifier(child.text),
          intoIdentifier: normalizeCSharpIdentifier(child.text),
          isDescending: false,
          startLine: startLine(child),
          startColumn: startColumn(child),
          serviceVersionLinkHash: context.serviceVersionLinkHash,
        })
      );
      position += 1;
      continue;
    }

    const clauseKind = QUERY_CLAUSE_KINDS.get(child.type);
    if (clauseKind === undefined) {
      continue;
    }

    const joinInto = childOfType(child, 'join_into_clause');

    // `orderby a, b descending` — the grammar gives NO `ordering` node. The
    // keys are flat children and a `descending` token follows the one it
    // applies to. One clause carrying one flag would be wrong about `a`, which
    // sorts ASCENDING, so the clause is a container and each key is its own
    // ORDER_BY_ORDERING row with its own direction.
    if (clauseKind === CsQueryClauseKind.ORDER_BY) {
      result.queryClauses.push(
        new CsQueryClauseRegistry({
          csExpressionLinkHash: query.getHash(),
          parentQueryLinkHash: query.getHash(),
          position,
          clauseKind: CsQueryClauseKind.ORDER_BY,
          // A container introduces no range variable.
          identifierName: '',
          intoIdentifier: '',
          isDescending: false,
          startLine: startLine(child),
          startColumn: startColumn(child),
          serviceVersionLinkHash: context.serviceVersionLinkHash,
        })
      );
      position += 1;
      position = emitOrderings(child, query, context, result, queue, depth, position);
      continue;
    }

    const clause = new CsQueryClauseRegistry({
      csExpressionLinkHash: query.getHash(),
      parentQueryLinkHash: query.getHash(),
      position,
      // `join … into g` is a GROUP JOIN, a different operator from a plain
      // join, so it gets its own kind rather than a flag.
      clauseKind: joinInto === undefined ? clauseKind : CsQueryClauseKind.JOIN_INTO,
      // The RANGE VARIABLE this clause introduces, and only that. `from x`,
      // `let y` and `join z` introduce one; `where`, `group` and `select` do
      // not. Taking the first identifier under any clause put the ORDERING KEY
      // of an `orderby` and the GROUPED EXPRESSION of a `group` in this column,
      // which reads as a variable binding that does not exist.
      identifierName: introducedRangeVariable(child, clauseKind),
      intoIdentifier:
        joinInto === undefined
          ? ''
          : normalizeCSharpIdentifier(childOfType(joinInto, 'identifier')?.text ?? ''),
      isDescending: false,
      startLine: startLine(child),
      startColumn: startColumn(child),
      serviceVersionLinkHash: context.serviceVersionLinkHash,
    });
    result.queryClauses.push(clause);

    // The clause's sub-expressions become ordinary children of the QUERY, so a
    // call inside `where p` is found by the same walk as any other call.
    //
    // MINUS THE NAME THE CLAUSE DECLARES. `x` in `from x in xs` is a bare
    // identifier, and an identifier is an expression node — so it was the
    // clause's FIRST expression: the from-clause's source was linked to its
    // own range variable and `xs` filed as the body; `let y = Scale(x)` had
    // `y` as its body and the call was a stray third child. Every clause that
    // declares a name was one child to the left, and the sufficiency report
    // measured the links as present because they were — pointing at the
    // wrong row. The declaration is a cs_variable row, not a reference.
    const declared = introducedRangeVariableNode(child, clauseKind);
    const expressions = namedChildren(child).filter(
      (c) =>
        c.type !== 'join_into_clause' &&
        (declared === undefined || c.id !== declared.id) &&
        (EXPRESSION_NODE_KINDS.has(c.type) || LITERAL_NODE_KINDS.has(c.type))
    );
    // WHICH expression a clause ranges over and which it evaluates.
    //
    // `from x in xs` and `join z in zs on a equals b` RANGE OVER their first
    // expression — that is the collection the operator is applied to. Every
    // other clause EVALUATES its first expression: the predicate of a `where`,
    // the projection of a `select`, the value of a `let`. A join's remaining
    // expressions are the key selectors and go in the body slot.
    //
    // Deferred because the rows do not exist yet.
    const ranges =
      clauseKind === CsQueryClauseKind.FROM || clauseKind === CsQueryClauseKind.JOIN;
    if (expressions[0] !== undefined) {
      deferred.push({
        clause,
        node: expressions[0],
        role: ranges ? 'source' : 'body',
      });
    }
    if (ranges && expressions[1] !== undefined) {
      deferred.push({ clause, node: expressions[1], role: 'body' });
    }
    for (const expression of expressions) {
      queue.push({
        node: expression,
        parentHash: query.getHash(),
        role: CsEdgeRole.QUERY_CLAUSE,
        position,
        depth: depth + 1,
        localNames: new Set(),
      });
    }
    position += 1;
  }
}

/**
 * The RANGE VARIABLE a clause introduces, or `''`.
 *
 * `from x in xs`, `let y = e` and `join z in zs` each bind a name that later
 * clauses refer to. `where`, `orderby`, `group` and `select` bind nothing — and
 * reading "the first identifier under the clause" put an ordering KEY and a
 * grouped EXPRESSION in this column, which reads as a binding that does not
 * exist and would make an engine look for a variable nothing declares.
 */
function introducedRangeVariable(
  clause: Parser.SyntaxNode,
  clauseKind: CsQueryClauseKind
): string {
  const named = introducedRangeVariableNode(clause, clauseKind);
  return named === undefined ? '' : normalizeCSharpIdentifier(named.text);
}

/** The identifier node a `from`, `let` or `join` clause DECLARES, if any. */
function introducedRangeVariableNode(
  clause: Parser.SyntaxNode,
  clauseKind: CsQueryClauseKind
): Parser.SyntaxNode | undefined {
  if (
    clauseKind !== CsQueryClauseKind.FROM &&
    clauseKind !== CsQueryClauseKind.LET &&
    clauseKind !== CsQueryClauseKind.JOIN
  ) {
    return undefined;
  }
  return clause.childForFieldName('name') ?? childOfType(clause, 'identifier');
}

/**
 * One row per ORDERING KEY, each with its own direction.
 *
 * The grammar produces no `ordering` node: `orderby a, b descending` is a flat
 * run of expressions with `descending` tokens interleaved, and a token applies
 * to the key BEFORE it. So the direction is read by scanning forward from each
 * key to the next comma.
 */
function emitOrderings(
  clause: Parser.SyntaxNode,
  query: CsExpressionRegistry,
  context: CsExpressionContext,
  result: CsExpressionResult,
  queue: PendingChild[],
  depth: number,
  startPosition: number
): number {
  let position = startPosition;
  const children = allChildren(clause);
  for (let index = 0; index < children.length; index += 1) {
    const key = children[index]!;
    if (!key.isNamed) {
      continue;
    }
    let isDescending = false;
    for (let scan = index + 1; scan < children.length; scan += 1) {
      const token = children[scan]!;
      if (token.type === ',') {
        break;
      }
      if (!token.isNamed && token.type === 'descending') {
        isDescending = true;
        break;
      }
    }
    result.queryClauses.push(
      new CsQueryClauseRegistry({
        csExpressionLinkHash: query.getHash(),
        parentQueryLinkHash: query.getHash(),
        position,
        clauseKind: CsQueryClauseKind.ORDER_BY_ORDERING,
        identifierName: '',
        intoIdentifier: '',
        isDescending,
        startLine: startLine(key),
        startColumn: startColumn(key),
        serviceVersionLinkHash: context.serviceVersionLinkHash,
      })
    );
    if (EXPRESSION_NODE_KINDS.has(key.type) || LITERAL_NODE_KINDS.has(key.type)) {
      queue.push({
        node: key,
        parentHash: query.getHash(),
        role: CsEdgeRole.QUERY_CLAUSE,
        position,
        depth: depth + 1,
        localNames: new Set(),
      });
    }
    position += 1;
  }
  return position;
}

interface ExpressionShape {
  kind: CsExpressionKind;
  operatorString: string;
  unaryFixity: CsUnaryFixity;
  methodReferenceKind: CsMethodReferenceKind;
  potentialQualifiedName: string;
  argumentCount: number;
  typeArgumentCount: number;
  isSpread: boolean;
  isNullConditional: boolean;
  isNullForgiving: boolean;
  callSite?: { callKind: CsCallKind; calleeName: string };
}

/**
 * An argument list's named items, through fork rule 18: `F(a,\n#if X\n b,
 * \n#else\n c,\n#endif\n d)` puts each branch's `b,` run under an
 * `argument_fragment` inside a `preproc_if` child of the list, and only the
 * TAKEN branch's arguments are in the program. Before the rule the `#if` was
 * the second argument's expression, each branch's comma an ERROR, and `d` —
 * after the #endif — an ERROR of its own: the call had lost its last argument.
 * A `#if` holding a whole argument with no comma is still the expression
 * path, inside an `argument` node, and is not this list's business.
 */
/**
 * The count every caller takes is `argumentsOf(list).filter(argument).length`,
 * so the ONE place a misparsed generic creation has to be collapsed is here.
 *
 * `Take(new D<K, V>(args) { ... })` is split across sibling `argument` nodes by
 * the `<` ambiguity, and counting them gives the call two arguments where the
 * source writes one. Collapsing the run to its first member leaves the count
 * right for every caller at once -- an invocation, a constructor initializer
 * and a primary base all read this function -- rather than correcting each.
 */
function collapseMisparsedCreationRun(
  list: Parser.SyntaxNode,
  args: Parser.SyntaxNode[]
): Parser.SyntaxNode[] {
  const run = misparsedGenericCreationRunOf(list);
  if (run === undefined) {
    return args;
  }
  const argumentIndexes: number[] = [];
  args.forEach((a, i) => {
    if (a.type === 'argument') {
      argumentIndexes.push(i);
    }
  });
  const drop = new Set(
    argumentIndexes.slice(run.start + 1, run.start + run.length)
  );
  return args.filter((_, i) => !drop.has(i));
}

function argumentsOf(
  list: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  for (const child of namedChildren(list)) {
    if (child.type !== 'preproc_if') {
      out.push(child);
      continue;
    }
    const { branches, bodies } = resolvePreprocBranches(child, activeSymbols);
    for (const branch of branches) {
      if (!branch.isActive) {
        continue;
      }
      for (const body of bodies.get(branch.branchIndex) ?? []) {
        if (body.type === 'argument_fragment' || body.type === 'argument_close_fragment') {
          out.push(...namedChildren(body).filter((c) => c.type === 'argument'));
        }
      }
    }
  }
  return collapseMisparsedCreationRun(list, out);
}

function describeExpression(
  node: Parser.SyntaxNode,
  kind: CsExpressionKind,
  context: CsExpressionContext,
  localNames: ReadonlySet<string>
): ExpressionShape {
  const shape: ExpressionShape = {
    kind,
    operatorString: '',
    unaryFixity: CsUnaryFixity.NONE,
    methodReferenceKind: CsMethodReferenceKind.NONE,
    potentialQualifiedName: '',
    argumentCount: 0,
    typeArgumentCount: 0,
    isSpread: false,
    isNullConditional: false,
    isNullForgiving: false,
  };

  switch (node.type) {
    case 'with_initializer': {
      shape.operatorString = '=';
      break;
    }

    case 'await_expression': {
      if (context.awaitIsKeyword) {
        break;
      }
      // NOT an await. `await + 1` is a BINARY whose left operand is the
      // identifier `await`; `await(x)` is a CALL of it; anything else keeps
      // the identifier and walks the rest as an ordinary operand.
      const operand = namedChildren(node)[0];
      if (operand?.type === 'prefix_unary_expression') {
        shape.kind = CsExpressionKind.BINARY;
        shape.operatorString = operatorTokenOf(operand);
      } else if (operand?.type === 'parenthesized_expression') {
        shape.kind = CsExpressionKind.INVOCATION;
        shape.argumentCount = 1;
        shape.callSite = { callKind: CsCallKind.FUNCTION_CALL, calleeName: 'await' };
      } else {
        shape.kind = CsExpressionKind.NAME_REFERENCE;
        shape.potentialQualifiedName = 'await';
      }
      break;
    }

    case 'assignment_expression': {
      // `(x, y) = t` — a DECONSTRUCTION, not an assignment to a tuple value.
      // Each element receives its own component, and the declaration form is
      // already distinguished in cs_variable; this is the assignment form.
      if (node.childForFieldName('left')?.type === 'tuple_expression') {
        shape.kind = CsExpressionKind.DECONSTRUCTION;
      }
      const operator = operatorTokenOf(node);
      shape.operatorString = operator;
      // §3, and the C#-specific instance of it. `+=` on an EVENT is a
      // SUBSCRIPTION: it calls the `add` accessor and registers an edge that
      // fires later. A COMPOUND_ASSIGNMENT with `+=` in a column gives the
      // engine the parts and loses the edge.
      //
      // BUT THE SHAPE ALONE DOES NOT DECIDE IT. `_x += 1` on an int field and
      // `Clicked += H` on an event are both `identifier += expr`. The first
      // version tested the shape and turned EVERY compound assignment into a
      // subscription — the same guess that made 2,080 identifiers method
      // groups, and wrong in the direction that INVENTS a call edge.
      //
      // What makes it a fact is the same same-file, one-hop lookup: the target
      // must name an EVENT declared on this type. Missed for an inherited event
      // or one on another object, which is the engine's to settle and is the
      // safe direction — a missing edge, not an invented one.
      if (operator === '+=' || operator === '-=') {
        // The `left` FIELD. An assignment's target.
        const target = node.childForFieldName('left') ?? undefined;
        const targetName =
          target === undefined
            ? ''
            : normalizeCSharpIdentifier(simpleNameOf(target.text));
        if (context.eventNamesOnType.has(targetName)) {
          shape.kind =
            operator === '+='
              ? CsExpressionKind.EVENT_SUBSCRIBE
              : CsExpressionKind.EVENT_UNSUBSCRIBE;
          break;
        }
      }
      if (operator !== '=') {
        shape.kind = CsExpressionKind.COMPOUND_ASSIGNMENT;
      }
      break;
    }

    case 'binary_expression':
      shape.operatorString = operatorTokenOf(node);
      break;

    case 'preproc_operator_expression': {
      // Rule 14: the operator is inside the taken branch's tail.
      const tail = takenOperatorTailOf(node, context.activeSymbols);
      shape.operatorString = tail === undefined ? '' : (tail.childForFieldName('operator')?.type ?? '');
      break;
    }

    case 'preproc_head_expression': {
      // Rule 14's mirror: the operator is inside the taken branch's head.
      const head = takenOperatorHeadOf(node, context.activeSymbols);
      shape.operatorString = head === undefined ? '' : (head.childForFieldName('operator')?.type ?? '');
      break;
    }

    case 'prefix_unary_expression':
      shape.operatorString = operatorTokenOf(node);
      shape.unaryFixity = CsUnaryFixity.PREFIX;
      if (shape.operatorString === '&') {
        shape.kind = CsExpressionKind.ADDRESS_OF;
      } else if (shape.operatorString === '*') {
        // `*p` — the MIRROR of `&x`, and it was missing while ADDRESS_OF was
        // present. A dereference is a read through a pointer, not a
        // multiplication with one operand.
        shape.kind = CsExpressionKind.POINTER_INDIRECTION;
      } else if (shape.operatorString === '^') {
        // `^1` — an index from the END. Not a unary operator on a value: it is
        // a System.Index, and `a[^1]` is a different access from `a[1]`.
        shape.kind = CsExpressionKind.INDEX;
      }
      break;

    case 'postfix_unary_expression': {
      shape.operatorString = operatorTokenOf(node);
      shape.unaryFixity = CsUnaryFixity.POSTFIX;
      // `x!` is the null-FORGIVING operator, not an operator on a value: it
      // asserts to the compiler that `x` is not null and produces no code.
      // Grouping it with `++`/`--` would report a mutation that never happens.
      if (shape.operatorString === '!') {
        shape.isNullForgiving = true;
      }
      break;
    }

    case 'constructor_initializer': {
      const argumentList = childOfType(node, 'argument_list');
      shape.argumentCount = argumentList === undefined
        ? 0
        : argumentsOf(argumentList, context.activeSymbols).filter((c) => c.type === 'argument').length;
      // The keyword is an ANONYMOUS token, and it is the whole distinction.
      const isBase = allChildren(node).some((c) => !c.isNamed && c.type === 'base');
      shape.callSite = {
        callKind: isBase
          ? CsCallKind.BASE_CONSTRUCTOR_CALL
          : CsCallKind.THIS_CONSTRUCTOR_CALL,
        // The keyword AS WRITTEN. Which constructor `base` names depends on the
        // base list, which is cs_type_heritage's, and which `this` names
        // depends on overload resolution — both the engine's. A guessed type
        // name here would be a name that resolves to the wrong thing.
        calleeName: isBase ? 'base' : 'this',
      };
      break;
    }

    case 'primary_constructor_base_type':
    case 'argument_list': {
      // A primary constructor's base invocation, in either grammar shape. The
      // callee is a TYPE NAME: `: Base(a)` calls a constructor of `Base`, and
      // the name is written, unlike `: base(a)` where the keyword stands in.
      const argumentList = primaryBaseArgumentListOf(node);
      shape.argumentCount = argumentList === undefined
        ? 0
        : argumentsOf(argumentList, context.activeSymbols).filter((c) => c.type === 'argument').length;
      const callee = primaryBaseCalleeOf(node);
      shape.typeArgumentCount = calleeTypeArgumentCount(callee);
      shape.callSite = {
        callKind: CsCallKind.BASE_CONSTRUCTOR_CALL,
        calleeName: callee === undefined ? '' : typeSimpleNameOf(callee),
      };
      break;
    }

    case 'invocation_expression': {
      // `nameof(x)` PARSES as an invocation of a method called nameof, and it
      // was counted as a call site that calls nothing. It is a compile-time
      // string; the distinction is the callee's spelling and nothing else — an
      // ordinary method cannot be named `nameof`, so the test is exact.
      if (node.childForFieldName('function')?.text === 'nameof') {
        shape.kind = CsExpressionKind.NAMEOF;
        break;
      }
      const argumentList = childOfType(node, 'argument_list');
      shape.argumentCount = argumentList === undefined
        ? 0
        : argumentsOf(argumentList, context.activeSymbols).filter((c) => c.type === 'argument').length;
      // The `function` FIELD. Position 0 was right only because the grammar
      // happens to put the callee first.
      const callee = node.childForFieldName('function') ?? undefined;
      shape.typeArgumentCount = calleeTypeArgumentCount(callee);
      // `a?.M()` — the CALLEE is a `conditional_access_expression`, not the
      // `member_binding_expression` the kind test looked for, so the null-
      // conditional case never fired: zero NULL_CONDITIONAL_CALL rows against
      // 519,647 call sites, while the child expression's `isNullConditional`
      // said otherwise. Two columns for one fact, disagreeing — and an internal
      // contradiction needs no expected value to catch, which is why the gate
      // for it is the cheapest one here.
      if (callee?.type === 'conditional_access_expression') {
        shape.isNullConditional = true;
      }
      shape.callSite = {
        callKind: callKindOf(callee, context, localNames),
        calleeName: calleeNameOf(callee),
      };
      break;
    }

    case 'object_creation_expression':
    case 'implicit_object_creation_expression': {
      const argumentList = childOfType(node, 'argument_list');
      // The misparse's arguments are OUTSIDE the creation node — the grammar
      // put them on the right of a comparison — so the count comes from there
      // or it comes out zero, and a constructor call reporting no arguments
      // reads as a parameterless constructor that may not exist.
      const repaired = misparsedGenericCreationArgumentsOf(node);
      shape.argumentCount = repaired !== undefined
        ? misparsedCreationArgumentNodes(repaired.argumentsNode).length
        : argumentList === undefined
          ? 0
          : argumentsOf(argumentList, context.activeSymbols).filter((c) => c.type === 'argument').length;
      if (repaired !== undefined) {
        // ONE type argument: the tuple. Reified generics — `HashSet<(string,
        // string)>` and `HashSet<string>` are different runtime types — so the
        // arity is a fact about the type and not a spelling detail.
        shape.typeArgumentCount = 1;
      }
      const typeNode = node.childForFieldName('type');
      shape.callSite = {
        callKind: CsCallKind.CONSTRUCTOR_CALL,
        calleeName: typeNode === null ? '' : simpleNameOf(typeNode.text),
      };
      break;
    }

    case 'conditional_access_expression':
      // `a?.M()` differs from `a.M()` in REACHABILITY, not in target.
      shape.isNullConditional = true;
      break;

    case 'qualified_name':
      shape.potentialQualifiedName = node.text;
      break;

    case 'member_binding_expression': {
      // Rule 14: `.Name` in a chain branch names `receiver.Name`. A `?.`
      // binding carries no name here, as before — its access row is the
      // conditional_access_expression above it.
      const chainReceiver = chainReceiverOf(node);
      if (chainReceiver !== undefined) {
        shape.potentialQualifiedName = `${chainReceiver.text}${node.text}`;
      }
      break;
    }

    case 'member_access_expression': {
      // Rule 14: a segment in a chain branch — `.A(1).B` — names
      // `receiver.A(1).B`; the receiver is above the directive.
      const chainBinding = chainBindingUnder(node);
      const chainReceiver = chainBinding === undefined ? undefined : chainReceiverOf(chainBinding);
      shape.potentialQualifiedName = chainReceiver === undefined ? node.text : `${chainReceiver.text}${node.text}`;
      // NO methodReferenceKind here, and the measurement is why.
      //
      // `x.M` in a value position is a method group only if `M` is a method on
      // the RECEIVER's type — which is resolution. Testing it against the
      // ENCLOSING type's methods instead produced 108 rows in multitarget-A, and the
      // first six were `Level.Low`, `.Mid`, `.High`: ENUM
      // MEMBERS, matched because the enclosing class happens to declare methods
      // of those names. The receiver is a different type entirely.
      //
      // §5: a kind that syntax cannot decide must be RESERVED, not guessed.
      // INSTANCE_METHOD_GROUP carries a zero-row assertion.
      break;
    }

    case 'await':
    case 'identifier': {
      // THE CALLEE OF AN INVENTED LAMBDA. `AssertQuery(async, ss => …)` was read
      // as a lambda and this identifier is the callee it swallowed, so the
      // invocation's row is built here — there is no `invocation_expression`
      // node to build it from, and the call is 1:1 with an expression row.
      const asyncCall = misparsedAsyncCallAtCalleeOf(node);
      if (asyncCall !== undefined) {
        shape.kind = CsExpressionKind.INVOCATION;
        // The earlier parameters are arguments and the lambda is one more.
        shape.argumentCount = asyncCall.argumentNodes.length + 1;
        shape.callSite = {
          callKind: callKindOf(node, context, localNames),
          calleeName: normalizeCSharpIdentifier(node.text),
        };
        // NO potentialQualifiedName: this row is the CALL, and the name it
        // would carry is the callee's, which `calleeName` holds.
        break;
      }
      // A simple name is the degenerate qualified name. Without it a
      // NAME_REFERENCE row carried its kind and its link and NOT THE NAME, so
      // an engine (or a gate) reading the row had to go back to the source to
      // learn what was referenced.
      shape.potentialQualifiedName = normalizeCSharpIdentifier(node.text);
      // `_` in a position where the language makes it a DISCARD, unless a
      // `_` is actually declared in scope — then it is that variable.
      if (node.text === '_' && isDiscardPosition(node) && !nameIsDeclared('_', context, localNames)) {
        shape.kind = CsExpressionKind.DISCARD;
        break;
      }
      if (isMethodGroupPosition(node, context)) {
        shape.methodReferenceKind = isDelegateCreationArgument(node)
          ? CsMethodReferenceKind.DELEGATE_CREATION
          : CsMethodReferenceKind.METHOD_GROUP;
      }
      break;
    }

    case 'lambda_expression':
    case 'anonymous_method_expression':
      shape.methodReferenceKind = CsMethodReferenceKind.ANONYMOUS_FUNCTION;
      break;

    case 'generic_name': {
      const argumentList = childOfType(node, 'type_argument_list');
      shape.typeArgumentCount =
        argumentList === undefined ? 0 : namedChildren(argumentList).length;
      break;
    }

    case 'tuple_expression':
      shape.argumentCount = namedChildren(node).length;
      break;

    case 'collection_expression':
      shape.argumentCount = namedChildren(node).length;
      break;

    default:
      break;
  }

  return shape;
}

/**
 * Whether a BARE NAME is a method group — and why neither test alone is enough.
 *
 * ## The first version guessed on position, and was wrong 2,000 times in 216 files
 *
 * "A bare name in a value position, not being called" describes a method group.
 * It also describes every variable, every field, every property and every
 * parameter passed as an argument. Marking all of them produced **2,080
 * METHOD_GROUP rows in multitarget-A alone**, which would tell an engine that two
 * thousand methods are referenced-but-never-called. §5 is explicit: a kind that
 * syntax cannot decide must be RESERVED, not guessed, because guessing is wrong
 * more often than it is right.
 *
 * ## What makes it decidable is a SAME-FILE, ONE-HOP fact
 *
 * The name must also be **declared as a method on the enclosing type**. That is
 * not resolution — it is one lookup in a set the extractor already built, in the
 * same file, with no using scope and no inheritance walked. It is exactly the
 * class of link the IR rule permits.
 *
 * ## And it applies to BARE NAMES ONLY
 *
 * The same test on `x.M` is unsound, because `M` would have to be a method on
 * the RECEIVER's type and this set holds the ENCLOSING type's. Applied there it
 * produced 108 rows in multitarget-A whose first six were `Level.Low`,
 * `.Mid`, `.High` — enum members, matched because the enclosing class
 * declares methods of those names. `INSTANCE_METHOD_GROUP` is therefore
 * RESERVED with a zero-row assertion, and a bare name is the only form filled.
 *
 * Still an over-approximation in one direction: a local or field shadowing a
 * method name reads as a group. And an under-approximation in the other: a
 * group whose target is inherited or an extension is missed. Both are the
 * engine's to settle, and both are far smaller than either test made alone.
 */
/**
 * The positions in which a bare `_` is a discard (C# 7+): the left of an
 * assignment, an element of a tuple on the left of an assignment (at any
 * nesting), and an `out` argument. A `_` lambda parameter, foreach variable
 * or pattern designation is a DECLARATION and is handled where those are.
 */
function isDiscardPosition(node: Parser.SyntaxNode): boolean {
  let current: Parser.SyntaxNode = node;
  let parent = current.parent;
  // Climb through tuple elements: `(_, (a, _)) = t`.
  while (parent !== null && (parent.type === 'argument' || parent.type === 'tuple_expression')) {
    if (parent.type === 'argument') {
      const modifiers = allChildren(parent).filter((c) => !c.isNamed).map((c) => c.type);
      if (modifiers.includes('out')) {
        return true;
      }
    }
    current = parent;
    parent = current.parent;
  }
  return parent !== null && parent.type === 'assignment_expression' && parent.childForFieldName('left')?.id === current.id;
}

function nameIsDeclared(name: string, context: CsExpressionContext, localNames: ReadonlySet<string>): boolean {
  return (
    localNames.has(name) ||
    context.parameterNames.has(name) ||
    context.lambdaParameterNames.has(name) ||
    context.patternBindingNames.has(name)
  );
}

function isMethodGroupPosition(
  node: Parser.SyntaxNode,
  context: CsExpressionContext
): boolean {
  const parent = node.parent;
  if (parent === null) {
    return false;
  }
  // The callee of a call is a CALL, not a group.
  if (
    parent.type === 'invocation_expression' &&
    parent.childForFieldName('function')?.id === node.id
  ) {
    return false;
  }
  // `nameof(M)` names a symbol and evaluates nothing. Its operand is a
  // NAMEOF_OPERAND edge, not a method group conversion — no delegate is made.
  if (
    parent.type === 'argument' &&
    parent.parent?.parent?.childForFieldName('function')?.text === 'nameof'
  ) {
    return false;
  }
  // The left side of `a.B` is a receiver, not a group.
  if (parent.type === 'member_access_expression' && receiverOf(parent)?.id === node.id) {
    return false;
  }
  const inValuePosition =
    parent.type === 'equals_value_clause' ||
    parent.type === 'argument' ||
    parent.type === 'return_statement' ||
    parent.type === 'arrow_expression_clause' ||
    parent.type === 'assignment_expression' ||
    // `Action a = Helper;` — the CANONICAL form, and it was missing. A local's
    // initializer is a direct child of the `variable_declarator`, not of an
    // `equals_value_clause`; that wrapper is used for parameter defaults. The
    // exact-count assertion in the gate is what found it: two event-handler
    // registrations were marked and the textbook case was not.
    parent.type === 'variable_declarator';
  if (!inValuePosition) {
    return false;
  }
  // THE PART THAT MAKES IT A FACT. A BARE name in a value position is a method
  // group only if a method of that name is declared on this type — one lookup,
  // same file, no using scope, no inheritance walked.
  if (node.type !== 'identifier') {
    return false;
  }
  return context.methodNamesOnType.has(normalizeCSharpIdentifier(simpleNameOf(node.text)));
}

/**
 * `new EventHandler(OnClick)` — a method group wrapped in an explicit delegate
 * construction. The same fact as METHOD_GROUP with one more thing known: the
 * delegate type is named. Distinguished by the argument's grandparent being an
 * object creation, which is syntax.
 */
function isDelegateCreationArgument(node: Parser.SyntaxNode): boolean {
  const argument = node.parent;
  const list = argument?.parent;
  const creation = list?.parent;
  return (
    argument?.type === 'argument' &&
    list?.type === 'argument_list' &&
    (creation?.type === 'object_creation_expression' ||
      creation?.type === 'implicit_object_creation_expression')
  );
}

/**
 * The RECEIVER of a member access — `a` in `a.B`.
 *
 * The `expression` FIELD, never `namedChildren[0]`, and the difference is 3.87%
 * of every call site in linq-heavy-A.
 *
 * `this.Foo` and `base.Foo` expose `this`/`base` through the field as an
 * ANONYMOUS token, so they are not named children at all: `namedChildren[0]` is
 * `Foo`, the METHOD NAME. Measured on 512,484 linq-heavy-A call sites — 19,832 of
 * them reported the method's own name as `receiverTypeName`, reported
 * `receiverKind = NAME` instead of THIS or BASE, were marked
 * `isExtensionCallSyntax`, and emitted the method name with edgeRole RECEIVER
 * and no METHOD_NAME edge at all.
 *
 * Every one of those rows was in the right place with the right hash. That is
 * the classification defect exactly: it passes recall, completeness and
 * adjudication alike, and only a column-level assertion can see it.
 */
function receiverOf(memberAccess: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  return memberAccess.childForFieldName('expression') ?? undefined;
}

/** The NAME of a member access — `B` in `a.B`. The `name` field. */
function memberNameOf(memberAccess: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  return memberAccess.childForFieldName('name') ?? undefined;
}

/**
 * `this` and `base` reach the receiver position as ANONYMOUS tokens exposed
 * through a field, so their node types are the bare keywords rather than
 * `this_expression` and `base_expression`. Both spellings are accepted: the
 * standalone expression forms do exist elsewhere, and matching only one of the
 * two is how this was missed.
 */
const THIS_NODE_TYPES = new Set(['this', 'this_expression']);
const BASE_NODE_TYPES = new Set(['base', 'base_expression']);

function calleeTypeArgumentCount(callee: Parser.SyntaxNode | undefined): number {
  if (callee === undefined) {
    return 0;
  }
  const generic =
    callee.type === 'generic_name'
      ? callee
      : namedChildren(callee).find((c) => c.type === 'generic_name');
  if (generic === undefined) {
    return 0;
  }
  const argumentList = childOfType(generic, 'type_argument_list');
  return argumentList === undefined ? 0 : namedChildren(argumentList).length;
}

function calleeNameOf(callee: Parser.SyntaxNode | undefined): string {
  if (callee === undefined) {
    return '';
  }
  if (callee.type === 'conditional_access_expression') {
    // `a?.M()` — the NAME is inside the `member_binding_expression`, and the
    // whole node's text is `a?.M`, so falling through would have named the
    // callee after the receiver.
    const binding = childOfType(callee, 'member_binding_expression');
    return calleeNameOf(binding);
  }
  if (callee.type === 'member_access_expression' || callee.type === 'member_binding_expression') {
    // The `name` FIELD. `namedChildren[last]` is right for `a.B` and right for
    // `this.B` by accident — there is only one named child there and it IS the
    // name — but reading the field says so rather than relying on it.
    const name = callee.childForFieldName('name');
    return normalizeCSharpIdentifier(simpleNameOf(name?.text ?? callee.text));
  }
  return normalizeCSharpIdentifier(simpleNameOf(callee.text));
}

/**
 * The call kind, from SYNTAX ONLY.
 *
 * `METHOD_CALL` when there is a receiver, `FUNCTION_CALL` when there is not.
 * `DYNAMIC_CALL` is never produced: it is a fact about a value's runtime
 * identity and reserved with a zero-row assertion, exactly as TypeScript's
 * `INDEX_CALL` is.
 */
function callKindOf(
  callee: Parser.SyntaxNode | undefined,
  context: CsExpressionContext,
  localNames: ReadonlySet<string>
): CsCallKind {
  if (callee === undefined) {
    return CsCallKind.FUNCTION_CALL;
  }
  // A BARE NAME being called. Three things it can be, and two of them are
  // decidable from names declared in this file — no type, no using scope, no
  // inheritance walked.
  if (callee.type === 'identifier') {
    const name = normalizeCSharpIdentifier(callee.text);
    if (context.localFunctionNames.has(name)) {
      // Same-file, one-hop: the body declares a local function of this name,
      // and a local function shadows a method of the same name for the whole
      // body.
      return CsCallKind.LOCAL_FUNCTION_CALL;
    }
    if (
      localNames.has(name) ||
      context.parameterNames.has(name) ||
      context.lambdaParameterNames.has(name) ||
      context.patternBindingNames.has(name) ||
      context.queryRangeVariableNames.has(name) ||
      (context.valueMemberNamesOnType.has(name) && !context.methodNamesOnType.has(name))
    ) {
      // The callee is a VALUE — a local, a parameter of the method or of the
      // lambda, a pattern binding, a range variable, or a field/property/event
      // on this type — and a value that is invoked is a delegate or the program
      // does not compile. Whether its declared type is `Action` or `Func<…>` is
      // resolution and is not asked; that it is not a method is syntax.
      //
      // Adjudicated against Roslyn out of process: `if (o is Action act) {
      // act(); }` was FUNCTION_CALL because only three of the six binding
      // kinds were consulted. A LOOKUP MISS IS "DON'T KNOW", and the terminal
      // for don't-know is FUNCTION_CALL — never the positive claim.
      return CsCallKind.DELEGATE_INVOKE;
    }
    return CsCallKind.FUNCTION_CALL;
  }
  if (callee.type === 'member_binding_expression' && chainReceiverOf(callee) !== undefined) {
    // Rule 14: a binding in a `#if` chain branch is an ordinary member call
    // on the chain's receiver — nothing conditional about it.
    return CsCallKind.METHOD_CALL;
  }
  if (
    callee.type === 'member_binding_expression' ||
    callee.type === 'conditional_access_expression'
  ) {
    // `a?.M()` differs from `a.M()` in REACHABILITY, not in target: the call
    // does not happen when the receiver is null. Purely syntactic, and it was
    // folded into METHOD_CALL because only the inner binding node was tested.
    return CsCallKind.NULL_CONDITIONAL_CALL;
  }
  if (callee.type === 'member_access_expression') {
    return CsCallKind.METHOD_CALL;
  }
  return CsCallKind.FUNCTION_CALL;
}

function buildCallSite(
  node: Parser.SyntaxNode,
  expression: CsExpressionRegistry,
  shape: ExpressionShape,
  context: CsExpressionContext
): CsCallSiteRegistry {
  const callee =
    node.type === 'constructor_initializer' ||
    node.type === 'primary_constructor_base_type' ||
    isPrimaryBaseArgumentList(node)
      ? undefined
      : (node.childForFieldName('function') ?? undefined);
  const argumentList = isPrimaryBaseArgumentList(node) ? node : childOfType(node, 'argument_list');
  // A creation whose argument list the grammar read as the right operand of a
  // comparison: the arguments are outside the node. Read the same way the
  // expression row reads them, through the same helper — the expression said 1
  // and the call site said 0 while both described the same `new HashSet<(string
  // N, string S)>(src)`, and two columns disagreeing about one call is worse
  // than either answer alone.
  // A call the grammar read as a lambda: its arguments are the invented
  // lambda's leading "parameters", plus the real lambda itself. Counted here as
  // well as on the expression row, through the same detector — the expression
  // said three arguments and the call site said none, because this function
  // looks for an `argument_list` and the callee identifier has none.
  const asyncCall = misparsedAsyncCallAtCalleeOf(node);
  const repairedCreation = misparsedGenericCreationArgumentsOf(node);
  const argumentNodes =
    asyncCall !== undefined
      ? [...asyncCall.argumentNodes, asyncCall.callee.parent!]
      : repairedCreation !== undefined
      ? misparsedCreationArgumentNodes(repairedCreation.argumentsNode).filter(
          (c) => c.type === 'argument' || repairedCreation.argumentsNode.type === 'parenthesized_expression'
        )
      : argumentList === undefined
        ? []
        : argumentsOf(argumentList, context.activeSymbols).filter((c) => c.type === 'argument');

  const receiver =
    callee === undefined
      ? undefined
      : callee.type === 'member_access_expression'
        ? receiverOf(callee)
        : callee.type === 'conditional_access_expression'
          ? // The `condition` FIELD — `a` in `a?.M()`. Without it a null-
            // conditional call reports no receiver at all, which reads exactly
            // like a bare `M()`.
            //
            // And the TRUE receiver first, because on `a || b?.M()` the
            // condition field holds `a || b`: the call reported `receiverKind
            // BINARY` and `receiverTypeName "a || b"`, which is not a receiver
            // any engine can resolve and is not what the source says.
            (nullConditionalTrueReceiverOf(callee) ??
              callee.childForFieldName('condition') ??
              undefined)
          : callee.type === 'member_binding_expression'
            ? // Rule 14: the chain's receiver, above the `#if`.
              chainReceiverOf(callee)
            : undefined;

  return new CsCallSiteRegistry({
    callKind: shape.callSite!.callKind,
    calleeName: shape.callSite!.calleeName,
    receiverKind: receiverKindOf(receiver),
    // A same-file, one-hop link is possible only once the receiver's own row
    // exists, and it is enqueued after this. Left empty rather than guessed.
    receiverExpressionLinkHash: '',
    receiverTypeName: receiver === undefined ? '' : receiver.text,
    csExpressionLinkHash: expression.getHash(),
    csModuleLinkHash: context.csModuleLinkHash,
    callerMethodLinkHash: context.callerMethodLinkHash,
    callerTypeLinkHash: context.csTypeLinkHash,
    argumentCount: argumentNodes.length,
    namedArgumentCount: argumentNodes.filter(
      (a) => a.childForFieldName('name') !== null
    ).length,
    typeArgumentCount: shape.typeArgumentCount,
    // `ref` and `out` at a CALL SITE. An `out` argument is a second return
    // channel, and an engine modelling only returns loses that dataflow —
    // `TryParse` is in every C# codebase written.
    refArgumentCount: argumentNodes.filter((a) => hasArgumentModifier(a, 'ref')).length,
    outArgumentCount: argumentNodes.filter((a) => hasArgumentModifier(a, 'out')).length,
    isConditional: shape.isNullConditional,
    // `isExtensionCallSyntax` was DELETED by ruling (schema v1.4): it recorded
    // the SHAPE `a.B()`, which is `callKind == METHOD_CALL` — information an
    // existing column already carries, and a column that cannot vary is worse
    // than absent because a consumer reads it as evidence.
    isQueryDesugarCandidate: false,
    // FROM THE EXPRESSION ROW, not from the node.
    //
    // A call site IS an expression — `CS_CALL_SITE` is a pure 1:1 chain off
    // `CS_EXPRESSION` — so the two must occupy the same position, and taking
    // one from the row and the other from the node let them disagree.
    //
    // They did, in exactly one shape. Under rule 14 a `#if`-guarded chain
    // segment has its span GRAFTED onto the chain's receiver, because
    // `builder.UseX()` begins at `builder` and that is where Roslyn reports
    // every segment of a chain. The expression row got the graft; the call site
    // read the segment's own position and landed on the `#if` branch's line.
    // The row was right, the call site was three lines down from it, and a
    // comparator anchored on the call site read it as a LOST call.
    startLine: expression.startLine,
    startColumn: expression.startColumn,
    serviceVersionLinkHash: context.serviceVersionLinkHash,
  });
}

function hasArgumentModifier(argument: Parser.SyntaxNode, keyword: string): boolean {
  for (const child of allChildren(argument)) {
    if (!child.isNamed && child.type === keyword) {
      return true;
    }
  }
  return false;
}

function receiverKindOf(receiver: Parser.SyntaxNode | undefined): CsReceiverKind {
  if (receiver === undefined) {
    return CsReceiverKind.NONE;
  }
  if (THIS_NODE_TYPES.has(receiver.type)) {
    return CsReceiverKind.THIS;
  }
  if (BASE_NODE_TYPES.has(receiver.type)) {
    return CsReceiverKind.BASE;
  }
  switch (receiver.type) {
    case 'identifier':
    case 'generic_name':
      return CsReceiverKind.NAME;
    case 'qualified_name':
    case 'member_access_expression':
      return CsReceiverKind.QUALIFIED_NAME;
    case 'invocation_expression':
      return CsReceiverKind.INVOCATION;
    default:
      return CsReceiverKind.EXPRESSION;
  }
}

/**
 * What a name refers to, WHERE SYNTAX DECIDES IT.
 *
 * `UNKNOWN` is the honest majority. Whether a bare `Foo` is a local, a field, a
 * property or a type is name resolution and the engine's. What is certain — a
 * parameter of the enclosing method, `this`, `base`, a type parameter in scope —
 * costs nothing and is filled.
 */
function referencedEntityKindOf(
  node: Parser.SyntaxNode,
  kind: CsExpressionKind,
  pending: PendingChild,
  context: CsExpressionContext
): CsReferencedEntityKind {
  if (kind === CsExpressionKind.THIS_REFERENCE) {
    return CsReferencedEntityKind.THIS;
  }
  if (kind === CsExpressionKind.BASE_REFERENCE) {
    return CsReferencedEntityKind.BASE;
  }
  if ((node.type !== 'identifier' && node.type !== 'await') || kind === CsExpressionKind.DISCARD) {
    // A discard references nothing, by definition.
    return CsReferencedEntityKind.UNKNOWN;
  }
  const name = normalizeCSharpIdentifier(node.text);
  // INNERMOST SCOPE FIRST. A lambda parameter shadows a local, a local shadows
  // a parameter, and every one of them shadows a type parameter and a using
  // alias. The order here is the language's, and a rule that checked the
  // enclosing method's parameters first would misfile every captured name.
  if (context.lambdaParameterNames.has(name)) {
    return CsReferencedEntityKind.LAMBDA_PARAMETER;
  }
  if (pending.localNames.has(name)) {
    return CsReferencedEntityKind.LOCAL_VARIABLE;
  }
  if (context.parameterNames.has(name)) {
    return CsReferencedEntityKind.PARAMETER;
  }
  // The four cs_variable makes one-hop facts: each set is the names a
  // declaration of that kind binds in THIS body or THIS file, and the
  // reference is the same-file link to it.
  if (context.patternBindingNames.has(name)) {
    return CsReferencedEntityKind.PATTERN_BINDING;
  }
  if (context.queryRangeVariableNames.has(name)) {
    return CsReferencedEntityKind.QUERY_RANGE_VARIABLE;
  }
  // A MEMBER THE ENCLOSING TYPE DECLARES IN THIS FILE — ruling v1.8, under
  // its four conditions. Every nearer binding above has been ruled out (1);
  // only the sets built from THIS declaration are consulted, never an
  // inherited member or another file's partial part (2); BARE names only —
  // the name half of `x.Foo` depends on the receiver's type, which is
  // resolution (3); and the three sets cannot overlap, C# forbidding one type
  // two members of one name across them, so one lookup returns one kind or
  // none (4).
  if (pending.role !== CsEdgeRole.MEMBER_NAME) {
    if (context.eventNamesOnType.has(name)) {
      return CsReferencedEntityKind.EVENT;
    }
    if (context.propertyNamesOnType.has(name)) {
      return CsReferencedEntityKind.PROPERTY;
    }
    if (context.fieldNamesOnType.has(name)) {
      return CsReferencedEntityKind.FIELD;
    }
  }
  if (context.typeParameterNames.has(name)) {
    return CsReferencedEntityKind.TYPE_PARAMETER;
  }
  if (context.usingAliasNames.has(name)) {
    return CsReferencedEntityKind.USING_ALIAS;
  }
  return CsReferencedEntityKind.UNKNOWN;
}

/**
 * TYPE REFERENCES IN EXPRESSION POSITIONS — the second pass, keyed off the
 * expression row's hash (ruling v1.7).
 *
 * Declaration-position references — field types, return types, parameters,
 * base lists, constraints — are pass one, emitted with their declarations.
 * These are emitted the moment the expression row that owns them exists, so
 * `ownerLinkHash` points back at that row and a CAST row carries its
 * reference's hash forward: two links, one pair, asserted 1:1 both ways.
 *
 * | expression | node field | context |
 * |---|---|---|
 * | `(Foo)x` | `type` | CAST — and the row's `castTypeReferenceLinkHash` |
 * | `x as Foo` | `right` | AS_TYPE — never CAST: no conversion operator can run |
 * | `new Foo(…)` | `type` | OBJECT_CREATION |
 * | `new Foo[n]` | `type` (the array type) | ARRAY_CREATION |
 * | `typeof(Foo)` | `type` | TYPEOF |
 * | `default(Foo)`, `sizeof(Foo)`, `stackalloc Foo[n]` | `type` | TYPE_OPERAND, the enumerated three |
 * | `x is Foo f`, `x is Foo { … }`, `case Foo:` in a switch EXPRESSION | the pattern's `type` | TYPE_PATTERN |
 * | `M<Foo>(…)`, `x.M<Foo>(…)` | each type argument | METHOD_TYPE_ARGUMENT |
 *
 * NOT `x is Foo` with a bare name: the grammar parses it as a CONSTANT
 * pattern, and whether `Foo` is a type or a constant is resolution. Left
 * unemitted rather than guessed, the same call as DYNAMIC_CALL.
 */
function emitExpressionTypeReferences(
  node: Parser.SyntaxNode,
  row: CsExpressionRegistry,
  kind: CsExpressionKind,
  context: CsExpressionContext,
  result: CsExpressionResult
): void {
  const sink = result.typeReferences;
  if (sink === undefined) {
    return;
  }
  const emit = (typeNode: Parser.SyntaxNode | null | undefined, refContext: CsTypeRefContext, position = 0): CsTypeReferenceRegistry | undefined => {
    const rows = extractTypeReferences({
      typeNode,
      ownerLinkHash: row.getHash(),
      referenceOwnerKind: CsReferenceOwnerKind.EXPRESSION,
      context: refContext,
      serviceVersionLinkHash: context.serviceVersionLinkHash,
      rootPosition: position,
      typeParametersInScope: context.typeParametersInScope,
    });
    sink.push(...rows);
    return rows[0];
  };
  switch (node.type) {
    case 'cast_expression': {
      const root = emit(node.childForFieldName('type'), CsTypeRefContext.CAST);
      if (root !== undefined) {
        row.setCastTypeReferenceLinkHash(root.getHash());
      }
      break;
    }
    case 'as_expression':
      emit(node.childForFieldName('right'), CsTypeRefContext.AS_TYPE);
      break;
    case 'object_creation_expression':
      emit(node.childForFieldName('type'), CsTypeRefContext.OBJECT_CREATION);
      break;
    case 'array_creation_expression':
      emit(node.childForFieldName('type'), CsTypeRefContext.ARRAY_CREATION);
      break;
    case 'typeof_expression':
      emit(node.childForFieldName('type'), CsTypeRefContext.TYPEOF);
      break;
    case 'default_expression':
    case 'sizeof_expression':
    case 'stackalloc_expression':
      emit(node.childForFieldName('type'), CsTypeRefContext.TYPE_OPERAND);
      break;
    case 'is_pattern_expression':
    case 'switch_expression': {
      let position = 0;
      for (const typeNode of patternTypeNodes(node)) {
        emit(typeNode, CsTypeRefContext.TYPE_PATTERN, position);
        position += 1;
      }
      break;
    }
    case 'invocation_expression': {
      if (kind !== CsExpressionKind.INVOCATION) {
        break;
      }
      const callee = node.childForFieldName('function');
      const generic =
        callee?.type === 'generic_name'
          ? callee
          : callee?.type === 'member_access_expression'
            ? memberNameOf(callee)
            : undefined;
      const argumentList = generic?.type === 'generic_name' ? childOfType(generic, 'type_argument_list') : undefined;
      if (argumentList !== undefined) {
        let position = 0;
        for (const argument of namedChildren(argumentList)) {
          emit(argument, CsTypeRefContext.METHOD_TYPE_ARGUMENT, position);
          position += 1;
        }
      }
      break;
    }
    default:
      break;
  }
}

/**
 * The TYPE nodes the patterns under an expression name: a declaration
 * pattern's type, a recursive pattern's type, an explicit type pattern. Walks
 * through `and`/`or`/`not`, parentheses, lists and switch arms; stops at
 * nothing else, because a pattern cannot contain an expression that contains
 * another pattern's type without that expression being its own row.
 */
function patternTypeNodes(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const found: Parser.SyntaxNode[] = [];
  const stack = namedChildren(node);
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (isExpressionNode(current) && current.id !== node.id) {
      // An expression under the pattern (a constant, a `when` guard, an arm's
      // result) is its own row and emits its own references.
      continue;
    }
    if (
      current.type === 'declaration_pattern' ||
      current.type === 'recursive_pattern' ||
      current.type === 'type_pattern'
    ) {
      const typeNode = current.childForFieldName('type') ?? namedChildren(current).find((c) => isTypeNodeType(c.type));
      if (typeNode !== null && typeNode !== undefined) {
        found.push(typeNode);
      }
      // A recursive pattern's sub-patterns can name types too.
      if (current.type !== 'recursive_pattern') {
        continue;
      }
    }
    for (const child of namedChildren(current)) {
      stack.push(child);
    }
  }
  return found.reverse();
}

const TYPE_NODE_TYPES: ReadonlySet<string> = new Set([
  'identifier', 'qualified_name', 'generic_name', 'predefined_type', 'array_type',
  'nullable_type', 'tuple_type', 'pointer_type', 'alias_qualified_name',
]);

function isTypeNodeType(type: string): boolean {
  return TYPE_NODE_TYPES.has(type);
}

/**
 * The reference kinds whose declaration is a ROW in this fact base, reachable
 * one hop away in the same member. `THIS`, `BASE`, `TYPE_PARAMETER` and
 * `USING_ALIAS` are classified but their targets are a type row, a type
 * parameter row and a using row — linked by the member pass through the
 * same pending mechanism when those declarations are in reach; not yet.
 */
const LINKABLE_REFERENCE_KINDS: ReadonlySet<CsReferencedEntityKind> = new Set([
  CsReferencedEntityKind.LOCAL_VARIABLE,
  CsReferencedEntityKind.PATTERN_BINDING,
  CsReferencedEntityKind.QUERY_RANGE_VARIABLE,
  CsReferencedEntityKind.PARAMETER,
  CsReferencedEntityKind.LAMBDA_PARAMETER,
  CsReferencedEntityKind.FIELD,
  CsReferencedEntityKind.PROPERTY,
  CsReferencedEntityKind.EVENT,
]);

/**
 * A node's children WITH THE ROLE each plays in it.
 *
 * §3's other half: a wrapper with children is not enough. Without roles,
 * `a.B(c)` gives an engine three children and no way to say which is the
 * receiver, which is the callee name and which is the argument — the parts are
 * right and the structure is absent.
 */
/**
 * The ARGUMENTS of a creation whose argument list the grammar read as an
 * expression.
 *
 * One argument comes back as a `parenthesized_expression` and two or more as a
 * `tuple_expression`, because that is what `(src)` and `(src, cmp)` are when
 * read as expressions. Both are unwrapped to the argument NODES, so the count
 * and the children agree — a count taken from one shape and children from the
 * other is how a two-argument call came out with one argument row.
 */
function misparsedCreationArgumentNodes(
  argumentsNode: Parser.SyntaxNode
): Parser.SyntaxNode[] {
  if (argumentsNode.type === 'tuple_expression') {
    return namedChildren(argumentsNode).filter((c) => c.type === 'argument');
  }
  if (argumentsNode.type === 'parenthesized_expression') {
    return namedChildren(argumentsNode);
  }
  return [];
}

function childrenWithRoles(
  node: Parser.SyntaxNode,
  kind: CsExpressionKind,
  context: CsExpressionContext
): { node: Parser.SyntaxNode; role: CsEdgeRole; isRotatedUnit?: boolean }[] {
  const children = namedChildren(node);
  const out: { node: Parser.SyntaxNode; role: CsEdgeRole; isRotatedUnit?: boolean }[] = [];

  const push = (child: Parser.SyntaxNode | undefined, role: CsEdgeRole): void => {
    if (child !== undefined) {
      out.push({ node: child, role });
    }
  };

  // THE OTHER HALF OF THE ROTATION. This node is an operator the grammar hung a
  // `?.` off, and its last operand — `b` in `a || b?.M()` — is not its operand
  // at all: the postfix unit `b?.M()` is, and `b` is the unit's receiver. So the
  // operand slot takes the unit, unless the last operand is itself another
  // operator, in which case the unit belongs further down and this node's
  // operand is that operator.
  const rotatedUnit = rotatedWrapperUnitOf(node);
  const pushOperand = (child: Parser.SyntaxNode | undefined, role: CsEdgeRole): void => {
    if (child === undefined) {
      return;
    }
    if (rotatedUnit !== undefined && rotatedWrapperUnitOf(child) === undefined) {
      out.push({ node: rotatedUnit, role, isRotatedUnit: true });
      return;
    }
    push(child, role);
  };

  // THE INVENTED LAMBDA'S CALL, from the callee identifier: the earlier
  // parameters are the earlier ARGUMENTS and the lambda itself is the last one.
  // The lambda is pushed with the visit flag so it emits as the lambda it is
  // instead of redirecting back here.
  const asyncCall = misparsedAsyncCallAtCalleeOf(node);
  if (asyncCall !== undefined) {
    for (const argument of asyncCall.argumentNodes) {
      out.push({ node: argument, role: CsEdgeRole.ARGUMENT });
    }
    out.push({ node: asyncCall.callee.parent!, role: CsEdgeRole.ARGUMENT, isRotatedUnit: true });
    return out;
  }

  // The mirror, for the swallowed-tail rotation: this operator's LEFT operand
  // is the is-expression, and what the grammar put there is the pattern's
  // constant — which belongs to the pattern and gets no row of its own.
  const swallowedIsPattern = swallowedIsPatternOf(node);
  const pushLeftOperand = (child: Parser.SyntaxNode | undefined, role: CsEdgeRole): void => {
    if (
      swallowedIsPattern !== undefined &&
      (child === undefined || swallowedIsPatternOf(child) === undefined)
    ) {
      out.push({ node: swallowedIsPattern, role, isRotatedUnit: true });
      return;
    }
    push(child, role);
  };

  // A non-async `await_expression`, re-read (see describeExpression): the
  // `await` TOKEN is the left operand / the callee / the reference, and the
  // grammar's operand contributes its own children.
  if (node.type === 'await_expression' && !context.awaitIsKeyword) {
    const token = allChildren(node).find((c) => !c.isNamed && c.type === 'await');
    const operand = namedChildren(node)[0];
    if (kind === CsExpressionKind.BINARY) {
      push(token, CsEdgeRole.LEFT_OPERAND);
      push(operand === undefined ? undefined : namedChildren(operand)[0], CsEdgeRole.RIGHT_OPERAND);
    } else if (kind === CsExpressionKind.INVOCATION) {
      push(token, CsEdgeRole.METHOD_NAME);
      push(operand === undefined ? undefined : namedChildren(operand)[0], CsEdgeRole.ARGUMENT);
    } else {
      push(operand, CsEdgeRole.ROOT);
    }
  } else {
  switch (kind) {
    case CsExpressionKind.INVOCATION: {
      if (
        node.type === 'constructor_initializer' ||
        node.type === 'primary_constructor_base_type' ||
        isPrimaryBaseArgumentList(node)
      ) {
        // No callee EXPRESSION exists — the target is a keyword, or a type
        // name that is a type reference and not a value. Only the arguments
        // are children.
        const list = primaryBaseArgumentListOf(node) ?? childOfType(node, 'argument_list');
        if (list !== undefined) {
          for (const argument of argumentsOf(list, context.activeSymbols)) {
            push(argument, CsEdgeRole.ARGUMENT);
          }
        }
        break;
      }
      const callee = node.childForFieldName('function') ?? children[0];
      if (callee?.type === 'member_access_expression') {
        // The RECEIVER and the METHOD NAME are separate roles, so a rule can
        // ask which is which without re-parsing the dotted name — and BY FIELD,
        // because on `this.B()` the only named child is the NAME and the
        // positional read emitted it as the receiver.
        push(receiverOf(callee), CsEdgeRole.RECEIVER);
        push(memberNameOf(callee), CsEdgeRole.METHOD_NAME);
      } else if (callee?.type === 'conditional_access_expression') {
        // `a?.M()` — the receiver is the `condition` field and the name sits
        // in the member binding. Pushing the whole conditional access as the
        // METHOD_NAME left every null-conditional call with no RECEIVER child:
        // 1,469 of 405,300 method calls on one stratum, `handler?.Invoke(x)`
        // the commonest shape among them.
        // The true receiver when the grammar hung the `?.` off an operator —
        // `b`, not `a || b`. The operator is NOT a child here: the rotation
        // made this node the operator's own child, so pushing it would put the
        // same subtree in two places and duplicate keys DOUBLE.
        push(
          nullConditionalTrueReceiverOf(callee) ?? callee.childForFieldName('condition') ?? undefined,
          CsEdgeRole.RECEIVER
        );
        const binding = namedChildren(callee).find((c) => c.type === 'member_binding_expression');
        push(binding?.childForFieldName('name') ?? binding ?? undefined, CsEdgeRole.METHOD_NAME);
      } else if (callee?.type === 'member_binding_expression' && chainReceiverOf(callee) !== undefined) {
        // Rule 14: the innermost segment of a `#if` chain branch. Its receiver
        // is the chain's, above the directive; the row's span starts there too.
        push(chainReceiverOf(callee), CsEdgeRole.RECEIVER);
        push(callee.childForFieldName('name') ?? undefined, CsEdgeRole.METHOD_NAME);
      } else {
        push(callee, CsEdgeRole.METHOD_NAME);
      }
      const argumentList = childOfType(node, 'argument_list');
      if (argumentList !== undefined) {
        for (const argument of argumentsOf(argumentList, context.activeSymbols)) {
          // The `argument` NODE, unwrapped centrally rather than here. This
          // line used to read `namedChildren(argument)[0]`, which is the NAME
          // on a named argument — so `M(label: Scale(n))` pushed `label` and
          // dropped the call. A local unwrap also runs BEFORE the central one
          // can, so having both meant the central fix could not take effect.
          push(argument, CsEdgeRole.ARGUMENT);
        }
      }
      break;
    }

    case CsExpressionKind.ASSIGNMENT:
    case CsExpressionKind.COMPOUND_ASSIGNMENT:
    case CsExpressionKind.EVENT_SUBSCRIBE:
    case CsExpressionKind.EVENT_UNSUBSCRIBE:
      // The roles that make `a += 1; b += 2` pairable. Without them the engine
      // joins on (scope, line) and pairs `a` with `2`.
      //
      // Inside `new C { Field = 1 }` the same node is a MEMBER INITIALIZER:
      // `Field` is a member of the object being built, not a name in scope,
      // and the roles say so.
      if (node.parent?.type === 'initializer_expression') {
        push(node.childForFieldName('left') ?? undefined, CsEdgeRole.INITIALIZER_TARGET);
        push(node.childForFieldName('right') ?? undefined, CsEdgeRole.INITIALIZER_VALUE);
        break;
      }
      // `with { Name = value }` — the same member initializer, with no fields
      // on the node: the identifier then the expression.
      if (node.type === 'with_initializer') {
        push(children[0], CsEdgeRole.INITIALIZER_TARGET);
        push(children[1], CsEdgeRole.INITIALIZER_VALUE);
        break;
      }
      // The `left` and `right` FIELDS. Positions 0 and 1 of the NAMED children
      // are right until the value is `this` — an anonymous token, not a named
      // child — and `x.Owner = this` then has a target and no value.
      push(node.childForFieldName('left') ?? children[0], CsEdgeRole.ASSIGNMENT_TARGET);
      push(node.childForFieldName('right') ?? children[1], CsEdgeRole.ASSIGNMENT_VALUE);
      break;

    case CsExpressionKind.BINARY:
      if (node.type === 'preproc_operator_expression') {
        // Rule 14: the left is the `left` field; the right is inside the
        // taken tail. Positions 0 and 1 would be the left and the preproc_if.
        push(node.childForFieldName('left') ?? undefined, CsEdgeRole.LEFT_OPERAND);
        push(
          takenOperatorTailOf(node, context.activeSymbols)?.childForFieldName('right') ?? undefined,
          CsEdgeRole.RIGHT_OPERAND
        );
        break;
      }
      if (node.type === 'preproc_head_expression') {
        // The mirror: the left is inside the taken head; the right follows.
        push(
          takenOperatorHeadOf(node, context.activeSymbols)?.childForFieldName('left') ?? undefined,
          CsEdgeRole.LEFT_OPERAND
        );
        push(node.childForFieldName('right') ?? undefined, CsEdgeRole.RIGHT_OPERAND);
        break;
      }
      pushLeftOperand(children[0], CsEdgeRole.LEFT_OPERAND);
      pushOperand(children[1], CsEdgeRole.RIGHT_OPERAND);
      break;

    case CsExpressionKind.UNARY:
    case CsExpressionKind.ADDRESS_OF:
    case CsExpressionKind.POINTER_INDIRECTION:
      pushOperand(children[0], CsEdgeRole.UNARY_OPERAND);
      break;

    case CsExpressionKind.CONDITIONAL: {
      // The CONDITION is the is-expression when a relational pattern swallowed
      // this conditional. What the grammar put in the condition slot is the
      // pattern's constant, which belongs to the pattern and gets no row.
      const swallowedBy = swallowedConditionalIsPatternOf(node);
      if (swallowedBy !== undefined) {
        // WITH THE FLAG. Without it the is-expression redirects to this
        // conditional again on the way down, and the pair emits each other
        // until the depth limit stops them: 511 NAMEOF rows where five belong.
        // Duplicate keys do not collide — they DOUBLE, and here they doubled a
        // hundred times over.
        out.push({ node: swallowedBy, role: CsEdgeRole.CONDITION, isRotatedUnit: true });
      } else {
        push(children[0], CsEdgeRole.CONDITION);
      }
      push(children[1], CsEdgeRole.WHEN_TRUE);
      push(children[2], CsEdgeRole.WHEN_FALSE);
      break;
    }

    case CsExpressionKind.PARENTHESIZED:
      push(children[0], CsEdgeRole.PARENTHESIZED_OPERAND);
      break;

    case CsExpressionKind.CAST:
      // The TYPE is not an expression and gets no row here — it is
      // `castTypeReferenceLinkHash`, because a cast that invokes a user-defined
      // conversion is a call edge wearing a type reference's clothes.
      pushOperand(children[children.length - 1], CsEdgeRole.CAST_OPERAND);
      break;

    case CsExpressionKind.AS_EXPRESSION:
    case CsExpressionKind.IS_PATTERN:
      // BY FIELD. `is_pattern_expression` names `expression` and `pattern`;
      // `as_expression` and `is_expression` name `left` and `right`. The
      // positional read was right until the operand was `this` — an ANONYMOUS
      // token, not a named child — and then `children[0]` was the PATTERN, so
      // `this is EntityType && Check()` pushed the pattern as the operand and
      // the swallowed tail inside it became a row parented to the
      // is-expression: 892 rows in linq-heavy lying outside their parent's span,
      // all of them `this is …`.
      //
      // The pattern is NOT pushed. A pattern is not an expression and carries
      // no expression rows; the constants inside one reach the walk through
      // `constant_pattern` being transparent where a pattern sits in an
      // expression position, as in a switch arm.
      // The field returns the `this` token itself — fields reach anonymous
      // children, which is the whole reason a field read fixes this.
      push(
        node.childForFieldName('expression') ?? node.childForFieldName('left') ?? undefined,
        CsEdgeRole.PATTERN_OPERAND
      );
      break;

    case CsExpressionKind.MEMBER_ACCESS:
      if (node.type === 'member_access_expression') {
        // QUALIFIER, not RECEIVER: RECEIVER is the thing a CALL is made on, and
        // `a.B` in a value position is not a call. Two roles for two facts, and
        // QUALIFIER was declared and never emitted.
        //
        // By FIELD, because `this.Seed` has ONE named child and it is the NAME
        // — the positional read emitted the member name as the qualifier and
        // emitted no member name at all.
        push(receiverOf(node), CsEdgeRole.QUALIFIER);
        push(memberNameOf(node), CsEdgeRole.MEMBER_NAME);
        break;
      }
      if (node.type === 'member_binding_expression' && chainReceiverOf(node) !== undefined) {
        // Rule 14: `x\n#if A\n .Name\n#endif` in a value position — the
        // chain's receiver qualifies the name.
        push(chainReceiverOf(node), CsEdgeRole.QUALIFIER);
        push(memberNameOf(node), CsEdgeRole.MEMBER_NAME);
        break;
      }
      if (node.type === 'conditional_access_expression') {
        // `a ?? b?.Name` in a VALUE position — the same misparse as the call
        // form and the same rotation, so the qualifier is `b` and the operator
        // is this node's parent rather than its child.
        const trueReceiver = nullConditionalTrueReceiverOf(node);
        push(trueReceiver ?? children[0], CsEdgeRole.QUALIFIER);
        for (let i = 1; i < children.length; i += 1) {
          push(children[i], CsEdgeRole.MEMBER_NAME);
        }
        break;
      }
      // `qualified_name` — a dotted name with no field structure.
      push(children[0], CsEdgeRole.QUALIFIER);
      for (let i = 1; i < children.length; i += 1) {
        push(children[i], CsEdgeRole.MEMBER_NAME);
      }
      break;

    case CsExpressionKind.ELEMENT_ACCESS: {
      // `a[i]` — the `expression` and `subscript` FIELDS.
      const target = node.childForFieldName('expression') ?? children[0];
      push(target, CsEdgeRole.RECEIVER);
      const subscript = node.childForFieldName('subscript');
      if (subscript !== null && subscript !== undefined) {
        for (const argument of namedChildren(subscript)) {
          push(argument, CsEdgeRole.INDEX_ARGUMENT);
        }
        break;
      }
      for (let i = 1; i < children.length; i += 1) {
        push(children[i], CsEdgeRole.INDEX_ARGUMENT);
      }
      break;
    }

    case CsExpressionKind.AWAIT:
      pushOperand(children[0], CsEdgeRole.AWAIT_OPERAND);
      break;

    case CsExpressionKind.THROW_EXPRESSION:
      push(children[0], CsEdgeRole.THROW_OPERAND);
      break;

    case CsExpressionKind.SWITCH_EXPRESSION:
      push(children[0], CsEdgeRole.SWITCH_GOVERNING);
      for (let i = 1; i < children.length; i += 1) {
        const child = children[i]!;
        if (child.type === 'preproc_if') {
          // Fork rule 18's shape on ARMS: `A => a,\n#if X\n B => b,\n#endif`.
          // The taken branch's `switch_arm_fragment` holds the arms; an
          // untaken branch's are not in the program.
          const { branches, bodies } = resolvePreprocBranches(child, context.activeSymbols);
          for (const branch of branches) {
            if (!branch.isActive) {
              continue;
            }
            for (const body of bodies.get(branch.branchIndex) ?? []) {
              if (body.type === 'switch_arm_fragment') {
                for (const arm of namedChildren(body)) {
                  push(arm, CsEdgeRole.SWITCH_ARM_RESULT);
                }
              }
            }
          }
          continue;
        }
        push(child, CsEdgeRole.SWITCH_ARM_RESULT);
      }
      break;

    case CsExpressionKind.SWITCH_ARM: {
      // `pattern when guard => result`. The pattern is a row only when it is
      // an EXPRESSION — a constant pattern unwraps to its literal; a declaration
      // pattern is a type and a binding and lives in cs_variable. The guard is
      // a `when_clause` wrapper around an ordinary expression.
      for (const child of children) {
        if (child.type === 'when_clause') {
          push(child, CsEdgeRole.SWITCH_ARM_GUARD);
        } else if (child.type.endsWith('_pattern') || child.type === 'discard') {
          push(child, CsEdgeRole.SWITCH_ARM_PATTERN);
        } else {
          push(child, CsEdgeRole.SWITCH_ARM_RESULT);
        }
      }
      break;
    }

    case CsExpressionKind.RANGE: {
      // `a..b`, `a..`, `..b`, `..`. Which side a lone operand is on is decided
      // by the `..` token, not by position: `..b` has one child and it is the
      // END.
      const dots = allChildren(node).find((c) => !c.isNamed && c.type === '..');
      for (const child of children) {
        const isStart = dots === undefined ? true : child.startIndex < dots.startIndex;
        push(child, isStart ? CsEdgeRole.RANGE_START : CsEdgeRole.RANGE_END);
      }
      break;
    }

    case CsExpressionKind.SPREAD_ELEMENT:
      push(children[0], CsEdgeRole.SPREAD_OPERAND);
      break;

    case CsExpressionKind.NAMEOF: {
      // The operand is an argument, and it is a NAME, not a value: `nameof(x)`
      // does not evaluate `x`. It still emits, because a rename that misses it
      // breaks the program, and that is an edge worth having.
      const list = childOfType(node, 'argument_list');
      if (list !== undefined) {
        for (const argument of namedChildren(list)) {
          push(argument, CsEdgeRole.NAMEOF_OPERAND);
        }
      }
      break;
    }

    case CsExpressionKind.WITH_EXPRESSION:
      push(children[0], CsEdgeRole.WITH_OPERAND);
      for (let i = 1; i < children.length; i += 1) {
        push(children[i], CsEdgeRole.INITIALIZER_VALUE);
      }
      break;

    case CsExpressionKind.INTERPOLATED_STRING:
      for (const child of children) {
        push(child, CsEdgeRole.INTERPOLATION_CONTENT);
      }
      break;

    case CsExpressionKind.INTERPOLATION:
      // The contents of a `{…}` hole are ORDINARY EXPRESSIONS and may be calls.
      // JSX's braces produced no row and cost 4,488 of 14,335 call sites; this
      // is the same shape and the same trap. `{x,10}` carries an ALIGNMENT in
      // its own wrapper, and `:N2` a format string that is not an expression.
      for (const child of children) {
        if (child.type === 'interpolation_alignment_clause') {
          push(child, CsEdgeRole.INTERPOLATION_ALIGNMENT);
        } else if (child.type !== 'interpolation_format_clause' && child.type !== 'interpolation_brace') {
          push(child, CsEdgeRole.INTERPOLATION_CONTENT);
        }
      }
      break;

    case CsExpressionKind.TUPLE:
      for (const child of children) {
        push(child, CsEdgeRole.TUPLE_ELEMENT);
      }
      break;

    case CsExpressionKind.COLLECTION_EXPRESSION: {
      // THE ELEMENTS, and only those. A misparsed collection expression holds
      // `argument` nodes — the grammar read it as an index access — and `[]`
      // holds one whose identifier is ZERO WIDTH, inserted by the recovery.
      // That one is not an element: unwrapped and filtered like any other child
      // it became a NAME_REFERENCE to the empty string, in 1,368 files.
      //
      // Through the same central unwrap as every other case, deliberately: a
      // hand-built child list skips both the unwrap and the emitting-node
      // filter, and the elements of `[1]` and `[.. xs]` then died with their
      // `argument` wrapper, which emits no row.
      const elements = misparsedCollectionExpressionOf(node)?.elements ?? children;
      for (const element of elements) {
        push(element, CsEdgeRole.COLLECTION_ELEMENT);
      }
      break;
    }

    case CsExpressionKind.ARRAY_CREATION:
    case CsExpressionKind.STACKALLOC: {
      // THE LENGTH IS NOT BESIDE THE TYPE, IT IS INSIDE IT.
      //
      // `new byte[Len(n)]` is `array_creation_expression > array_type >
      // array_rank_specifier > invocation_expression`. `array_type` is a TYPE,
      // not an expression, so the central filter below dropped it and took the
      // whole rank specifier with it — §7 exactly: a tree rooted at a
      // non-emitting node dies before its children are enqueued. The type
      // reference was emitted all along, so the row count for the creation was
      // right and the call inside it simply was not there.
      //
      // MEASURED: 90 sites in the BCL stratum. `new byte[Math.Min(a, b)]`,
      // `new int[GetPrime(n)]`, `new byte[GetEncodedLength(source.Length)]` —
      // the idiom for every buffer allocation in the framework.
      //
      // One role per DIMENSION, in source order, so `new byte[W(), H()]` says
      // which is which; a jagged `new byte[Len(n)][]` has a second, empty rank
      // specifier and contributes nothing from it.
      const typeNode = node.childForFieldName('type');
      if (typeNode !== null) {
        for (const rank of rankSpecifiersOf(typeNode)) {
          for (const size of namedChildren(rank)) {
            push(size, CsEdgeRole.ARRAY_SIZE);
          }
        }
      }
      // Everything the default branch would have contributed — the initializer
      // of `new byte[] { … }` reaches the walk this way and always did.
      for (const child of children) {
        push(child, CsEdgeRole.ROOT);
      }
      break;
    }

    case CsExpressionKind.OBJECT_CREATION: {
      // The arguments the misparse left outside the creation node. Pushed from
      // here so the subtree survives: the comparison they hung off is not
      // emitted, and a tree rooted at a non-emitting node dies before its
      // children are enqueued — `(src)` would have taken `src` with it.
      const repaired = misparsedGenericCreationArgumentsOf(node);
      if (repaired !== undefined) {
        if (repaired.argumentsNode.type === 'initializer_expression') {
          push(repaired.argumentsNode, CsEdgeRole.INITIALIZER_VALUE);
          break;
        }
        for (const argument of misparsedCreationArgumentNodes(repaired.argumentsNode)) {
          push(argument, CsEdgeRole.ARGUMENT);
        }
        break;
      }
      const argumentList = childOfType(node, 'argument_list');
      if (argumentList !== undefined) {
        for (const argument of argumentsOf(argumentList, context.activeSymbols)) {
          // The `argument` NODE, unwrapped centrally rather than here. This
          // line used to read `namedChildren(argument)[0]`, which is the NAME
          // on a named argument — so `M(label: Scale(n))` pushed `label` and
          // dropped the call. A local unwrap also runs BEFORE the central one
          // can, so having both meant the central fix could not take effect.
          push(argument, CsEdgeRole.ARGUMENT);
        }
      }
      const initializer = childOfType(node, 'initializer_expression');
      push(initializer, CsEdgeRole.INITIALIZER_VALUE);
      break;
    }

    case CsExpressionKind.QUERY:
      // A query's expressions are enqueued by its CLAUSES, each under the
      // QUERY_CLAUSE role with its clause link. The only other named child a
      // query has is the `into` continuation's identifier — a DECLARATION,
      // which the default branch below turned into a reference row naming
      // itself. Nothing to add here.
      break;

    default:
      // Everything else contributes its named children with no distinguished
      // role. Braced deliberately: a dangling branch in dispatch-heavy code is
      // nearly invisible and silently doubles or drops output.
      for (const child of children) {
        push(child, CsEdgeRole.ROOT);
      }
      break;
  }

  }

  // §6, ONE PLACE, ON THE WAY DOWN. A wrapper that produces no row must not
  // take its subtree with it, and `unwrapForRoot` only ever protected the ROOT
  // — every child went through this filter and a wrapper was simply dropped.
  //
  // MEASURED on multitarget-A: 185 of 5,324 call sites, 3.5%, and three unrelated
  // symptoms from one cause. `new IPolicy[] { new A(), … }`
  // lost every element because `array_creation_expression` emitted no row;
  // `(a.B(), new C())` lost the creation because a tuple's elements are
  // `argument` nodes; and `: this(…, new Dictionary<…>(…), …)` lost its
  // argument for the same reason.
  //
  // Doing it here rather than at each case is the point: there are twenty-five
  // cases and the next container added would have had the same hole.
  return out
    .map((child) => ({ ...child, node: unwrapTransparentChild(child.node, context.activeSymbols) }))
    .filter(
      (child): child is { node: Parser.SyntaxNode; role: CsEdgeRole } =>
        child.node !== undefined &&
        (EXPRESSION_NODE_KINDS.has(child.node.type) || LITERAL_NODE_KINDS.has(child.node.type))
    );
}

/**
 * Node types that hold exactly one expression and carry no value themselves.
 *
 * `argument` wraps a tuple element and a call argument alike; the `ref`/`out`
 * modifier lives on it, and `cs_call_site` already records the counts, so the
 * wrapper has nothing left to say.
 */
const TRANSPARENT_CHILD_TYPES = new Set([
  'argument',
  'equals_value_clause',
  'arrow_expression_clause',
  // `[a, b]` wraps each element TWICE — `collection_element` then
  // `expression_element` — and neither carries anything. Unwrapping only one of
  // them still lands on a node that emits no row, which takes the element with
  // it. `spread_element` is NOT here: `..xs` is a fact and keeps its own row,
  // and the unwrap lands on it correctly through `collection_element`.
  'collection_element',
  'expression_element',
  // `when n > 0` and `,10` are wrappers around one expression each.
  'when_clause',
  'interpolation_alignment_clause',
  // `case 0 =>` — a constant pattern IS its expression.
  'constant_pattern',
]);

/**
 * Every `array_rank_specifier` in a type, at any depth.
 *
 * A descent rather than a direct-child read: a jagged array's type nests
 * (`array_type > array_type > array_rank_specifier`), and a rank specifier on
 * an inner type holds a length just as much as one on the outer. Bounded to the
 * TYPE subtree, so it can never reach an expression that some other case is
 * already responsible for — which would DOUBLE the row rather than lose it.
 */
function rankSpecifiersOf(typeNode: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  const stack: Parser.SyntaxNode[] = [typeNode];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.type === 'array_rank_specifier') {
      out.push(current);
      // Its children are LENGTHS, not further types; do not descend.
      continue;
    }
    for (const child of namedChildren(current)) {
      stack.push(child);
    }
  }
  // Source order: the stack reverses, and `new byte[W(), H()]` must say which
  // dimension is which.
  return out.sort((a, b) => a.startIndex - b.startIndex);
}

function unwrapTransparentChild(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode | undefined {
  let current: Parser.SyntaxNode | undefined = node;
  // Bounded: a wrapper chain deeper than this is a grammar shape nobody has
  // seen, and an unbounded loop here would hang on a cycle rather than say so.
  for (let guard = 0; guard < 4 && current !== undefined; guard += 1) {
    // A `#if` in a child position — an argument, an operand, an element — is
    // transparent to its taken branch, exactly as at the root.
    if (current.type === 'preproc_if') {
      current = takenExpressionOf(current, activeSymbols);
      continue;
    }
    if (current.type === 'preproc_chain_expression' && takenChainContentOf(current, activeSymbols) === undefined) {
      current = current.childForFieldName('expression') ?? undefined;
      continue;
    }
    if (current.type === 'preproc_operator_expression' && takenOperatorTailOf(current, activeSymbols) === undefined) {
      current = current.childForFieldName('left') ?? undefined;
      continue;
    }
    if (current.type === 'preproc_head_expression' && takenOperatorHeadOf(current, activeSymbols) === undefined) {
      current = current.childForFieldName('right') ?? undefined;
      continue;
    }
    if (!TRANSPARENT_CHILD_TYPES.has(current.type)) {
      return current;
    }
    // A NAMED ARGUMENT — `M(alignment: new Alignment(…))` — puts the name in
    // the `name` field, and it is a named child. Taking child [0] takes the
    // NAME and drops the value, so a `new` inside a named argument produced no
    // call site at all.
    const label = current.childForFieldName('name');
    const inner: Parser.SyntaxNode | undefined = namedChildren(current).find(
      (child) => label === null || child.id !== label.id
    );
    current = inner;
  }
  return current;
}

function operatorTokenOf(node: Parser.SyntaxNode): string {
  for (const child of allChildren(node)) {
    if (!child.isNamed) {
      return child.type;
    }
  }
  return '';
}
