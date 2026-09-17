import * as ts from 'typescript';

import { TsCallSiteRegistry } from '@/analysis-types/typescript/TsCallSiteRegistry';
import { TsExpressionRegistry } from '@/analysis-types/typescript/TsExpressionRegistry';
import { TS_EXPRESSION_MAX_DEPTH } from '@/constants/typescript-constants';
import { TsCallKind, TsReceiverKind } from '@/enums/typescript/call-sites';
import {
  TsEdgeRole,
  TsExpressionKind,
  TsExpressionOwnerKind,
  TsLiteralType,
  TsRootContext,
  TsUnaryFixity,
} from '@/enums/typescript/expressions';
import { TsTypeRefContext, TsReferenceOwnerKind } from '@/enums/typescript/type-references';
import { nodeId } from '@/parsers/typescript/extractors/ts-binder';
import { TsTypeReferenceExtractor } from '@/parsers/typescript/extractors/ts-type-reference-extractor';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Emits `ts_expression` and `ts_call_site` — schema §4.14, §4.15.
 *
 * Positions 0–24 of `ts_expression` are byte-for-byte `java_expression` 0–24, so
 * `expr_kind`, `expr_child` and `expr_owner` port as renames.
 *
 * ## Two passes, and the reason is invariant 8
 *
 * Pass one drains a FIFO worklist — the shape ported from
 * `expression-reference-extractor.ts` — emitting one row per expression node and
 * recording node identity to row hash. Pass two walks the recorded nodes and
 * emits one `ts_call_site` per CALL / NEW / TAGGED_TEMPLATE row.
 *
 * Splitting them is what makes invariant 8 — `ts_call_site` count equals the
 * count of `ts_expression` rows of those three kinds — true by construction
 * rather than by agreement between two branches. It also lets a call site name
 * its RECEIVER, which is a grandchild: breadth-first, the receiver row does not
 * exist yet when the call row is built, and back-patching a column that sits in
 * no key would have worked but would have hidden the ordering dependency.
 *
 * ## What is deliberately NOT here
 *
 * No type node ever becomes an expression. `as T` and `satisfies T` put their
 * type on `assertedTypeReferenceLinkHash`, which is a FK into
 * `ts_type_reference` — the ONE expression-to-type edge in the schema, and a
 * type FK precisely so that no call-graph rule can cross it (§3.3).
 *
 * `JSX_COMPONENT_CALL`, `JSX_ELEMENT`, `JSX_SELF_CLOSING`,
 * `JSX_ATTRIBUTE_VALUE` and `JSX_CHILD` are reserved and emitted by nothing.
 * TSX is out of freeze 1, the representation is decided (§4.15.1), and the gate
 * asserts the emptiness so that switching TSX on shows up as a gate failure
 * rather than as new rows appearing unremarked.
 */

/** One enqueued child: the node plus the edge that reaches it. */
interface PendingExpression {
  readonly node: ts.Node;
  readonly edgeRole: TsEdgeRole;
  readonly parentHash: string;
  readonly position: number;
  readonly depth: number;
  readonly owner: ExpressionOwner;
  readonly rootContext: TsRootContext;
}

export interface ExpressionOwner {
  readonly ownerHash: string;
  readonly ownerKind: TsExpressionOwnerKind;
  readonly typeHash: string;
  readonly moduleHash: string;
  /** The enclosing function, for `ts_call_site.callerMethodLinkHash`. */
  readonly callerMethodHash: string;
  readonly callerTypeHash: string;
}

export interface ExpressionExtractorOptions {
  readonly sourceFile: ts.SourceFile;
  readonly serviceVersionLinkHash: string;
  readonly typeReferenceExtractor: TsTypeReferenceExtractor;
}

export class TsExpressionExtractor {
  readonly expressions: TsExpressionRegistry[] = [];
  readonly callSites: TsCallSiteRegistry[] = [];
  /** Node identity -> emitted row, so no later pass re-derives a key. */
  readonly rowByNode = new Map<string, TsExpressionRegistry>();
  /**
   * Every emitted row paired with its node, in emission order.
   *
   * The resolution pass needs to get from a ROW back to its NODE, and a map
   * keyed by node identity cannot do that. Keeping the pair is the alternative
   * to storing state on the node object, which is the failure mode this
   * codebase has already paid for twice: wrapper caches evict and the loss is
   * silent at scale.
   */
  readonly emitted: { node: ts.Node; row: TsExpressionRegistry }[] = [];
  /** Every call-shaped node that produced a row, in emission order. */
  private readonly callNodes: { node: ts.Node; owner: ExpressionOwner }[] = [];
  /** Call node -> the emitted call-site row, so the resolution pass can fill columns 12-18. */
  readonly callSiteByNode = new Map<string, TsCallSiteRegistry>();
  private readonly pending: PendingExpression[] = [];
  private readonly sf: ts.SourceFile;

  constructor(private readonly options: ExpressionExtractorOptions) {
    this.sf = options.sourceFile;
  }

  /** Starts a new expression tree at `node` and drains the worklist. */
  extractRoot(node: ts.Expression, owner: ExpressionOwner, rootContext: TsRootContext): string {
    const rootHash = this.emit({
      node,
      edgeRole: TsEdgeRole.ROOT,
      parentHash: '',
      position: 0,
      depth: 0,
      owner,
      rootContext,
    });
    this.drain();
    return rootHash;
  }

  private drain(): void {
    while (this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next) {
        continue;
      }
      this.emit(next);
    }
  }

  private emit(item: PendingExpression): string {
    const kind = expressionKindOf(item.node);
    if (kind === undefined) {
      return '';
    }
    const start = item.node.getStart(this.sf);
    const startPos = this.sf.getLineAndCharacterOfPosition(start);
    const endPos = this.sf.getLineAndCharacterOfPosition(item.node.end);
    const literal = literalOf(item.node, this.sf);
    const argumentsList = argumentsOf(item.node);

    const row = new TsExpressionRegistry({
      kind,
      edgeRole: item.edgeRole,
      rootContext: item.rootContext,
      expressionOwnerKind: item.owner.ownerKind,
      tsTypeLinkHash: item.owner.typeHash,
      expressionOwnerHash: item.owner.ownerHash,
      parentExpressionHash: item.parentHash,
      position: item.position,
      depth: item.depth,
      literalType: literal.type,
      literalValue: literal.value,
      unaryFixity: unaryFixityOf(item.node),
      operatorString: operatorOf(item.node, this.sf),
      returnStatementIndex: 0,
      startLine: startPos.line + 1,
      startColumn: startPos.character + 1,
      endLine: endPos.line + 1,
      endColumn: endPos.character + 1,
      tsModuleLinkHash: item.owner.moduleHash,
      isOptionalChain: isOptionalChainNode(item.node),
      isNonNullAsserted: ts.isNonNullExpression(item.node),
      // Marks where positional argument flow is PROVABLY imprecise. A fact base
      // that silently renumbers the arguments after a spread is wrong in a way
      // nothing downstream can detect.
      isSpread: ts.isSpreadElement(item.node) || ts.isSpreadAssignment(item.node),
      argumentCount: argumentsList.length,
      typeArgumentCount: typeArgumentsOf(item.node)?.length ?? 0,
      // §3.3's tripwire. Always false on this path: a type node has no route
      // into this relation, so a `true` row would mean the containment broke.
      isTypeOnlyReachable: false,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.expressions.push(row);
    this.rowByNode.set(nodeId(item.node, this.sf), row);
    this.emitted.push({ node: item.node, row });
    if (kind === TsExpressionKind.CALL_EXPRESSION || kind === TsExpressionKind.NEW_EXPRESSION
      || kind === TsExpressionKind.TAGGED_TEMPLATE) {
      this.callNodes.push({ node: item.node, owner: item.owner });
    }

    // `as T` / `satisfies T` / `<T>x` — the one place a type node hangs off an
    // expression, and it hangs off it as a TYPE FK.
    const asserted = assertedTypeOf(item.node);
    if (asserted) {
      row.setAssertedTypeReferenceLinkHash(
        this.options.typeReferenceExtractor.extract(
          asserted.type,
          asserted.context,
          {
            ownerHash: row.getHash(),
            ownerKind: TsReferenceOwnerKind.EXPRESSION,
            tsTypeLinkHash: item.owner.typeHash,
            tsModuleLinkHash: item.owner.moduleHash,
          }
        )
      );
    }
    // ---- type references written in VALUE positions -----------------------
    //
    // Java emits all of these and an earlier version of this parser emitted
    // none, which was a recall gap rather than a design choice: `new Repo()`,
    // `x instanceof Widget` and `makeList<string>()` all NAME A TYPE, and the
    // name is evaluated at runtime. They are the only contexts for which
    // `isTypeOnlyPosition` is false.
    const owner = {
      ownerHash: row.getHash(),
      ownerKind: TsReferenceOwnerKind.EXPRESSION,
      tsTypeLinkHash: item.owner.typeHash,
      tsModuleLinkHash: item.owner.moduleHash,
    };

    // `makeList<string>()` — Java's METHOD_TYPE_ARGUMENT, distinguished from a
    // type argument in a TYPE position because this one appears in an expression.
    //
    // NUMBERED, as the Java extractor numbers them
    // (parsers/java/extractors/type-reference-extractor.ts:666). These are siblings
    // with no parent row to carry their order, so the index is the only record of it
    // and it is what the engine's positional binding reads. Emitted at 0 for every
    // argument, `two<A, B>()` bound the first type parameter to BOTH A and B (#587).
    let typeArgumentPosition = 0;
    for (const typeArgument of typeArgumentsOf(item.node) ?? []) {
      this.options.typeReferenceExtractor.extract(
        typeArgument,
        TsTypeRefContext.METHOD_TYPE_ARGUMENT,
        owner,
        false,
        typeArgumentPosition
      );
      typeArgumentPosition += 1;
    }

    // `new Repo()` — Java's OBJECT_CREATION_TYPE. The constructed type is named
    // in the source, so it is a type reference AND a value reference. Without it
    // the type graph has no edge for the single most common way a class is used.
    if (ts.isNewExpression(item.node)) {
      const constructed = constructedTypeNodeOf(item.node);
      if (constructed) {
        this.options.typeReferenceExtractor.extract(
          constructed,
          TsTypeRefContext.OBJECT_CREATION_TYPE,
          owner,
          false
        );
      }
    }

    // `x instanceof Widget` — Java's INSTANCEOF_TYPE, and the main narrowing
    // lever the engine has. The right operand is a VALUE expression in the
    // grammar (a constructor), and it names a type; both facts are recorded.
    if (ts.isBinaryExpression(item.node)
      && item.node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
      const tested = instanceofTypeNodeOf(item.node);
      if (tested) {
        this.options.typeReferenceExtractor.extract(
          tested,
          TsTypeRefContext.INSTANCEOF_TYPE,
          owner,
          false
        );
      }
    }

    if (item.depth >= TS_EXPRESSION_MAX_DEPTH) {
      return row.getHash();
    }
    for (const child of childEdgesOf(item.node)) {
      this.pending.push({
        node: child.node,
        edgeRole: child.edgeRole,
        parentHash: row.getHash(),
        position: child.position,
        depth: item.depth + 1,
        owner: item.owner,
        rootContext: item.rootContext,
      });
    }
    return row.getHash();
  }

  /**
   * Pass two: one `ts_call_site` per call-shaped expression row.
   *
   * Runs after every expression row exists, so a call site can name its
   * receiver — which is its callee's child, and therefore its own grandchild.
   */
  emitCallSites(): void {
    for (const entry of this.callNodes) {
      const row = this.rowByNode.get(nodeId(entry.node, this.sf));
      if (!row) {
        continue;
      }
      const callee = calleeOf(entry.node);
      const receiverNode = receiverNodeOf(callee);
      const receiverRow = receiverNode
        ? this.rowByNode.get(nodeId(receiverNode, this.sf))
        : undefined;
      const argumentsList = argumentsOf(entry.node);
      const spreadIndex = argumentsList.findIndex((a) => ts.isSpreadElement(a));
      const startPos = this.sf.getLineAndCharacterOfPosition(entry.node.getStart(this.sf));

      const callSite = new TsCallSiteRegistry({
        callKind: callKindOf(entry.node, callee),
        calleeName: calleeNameOf(callee),
        receiverKind: receiverKindOf(callee, receiverNode),
        receiverExpressionLinkHash: receiverRow?.getHash() ?? '',
        // Filled by the resolution pass, which is the only place that can say
        // what a receiver's DECLARED type is.
        receiverTypeName: '',
        tsExpressionLinkHash: row.getHash(),
        tsModuleLinkHash: entry.owner.moduleHash,
        callerMethodLinkHash: entry.owner.callerMethodHash,
        callerTypeLinkHash: entry.owner.callerTypeHash,
        argumentCount: argumentsList.length,
        // Where this is set, positional argument flow is provably imprecise.
        spreadArgumentIndex: spreadIndex >= 0 ? spreadIndex : undefined,
        typeArgumentCount: typeArgumentsOf(entry.node)?.length ?? 0,
        // MUST always be false. A true row means a type-only construct reached
        // the call graph, and the gate fails on it by name.
        isTypeOnlyTarget: false,
        startLine: startPos.line + 1,
        startColumn: startPos.character + 1,
        serviceVersionLinkHash: this.options.serviceVersionLinkHash,
      });
      this.callSites.push(callSite);
      this.callSiteByNode.set(nodeId(entry.node, this.sf), callSite);
    }
  }

  /** The call-shaped nodes, so the resolution pass can revisit them in emission order. */
  getCallNodes(): readonly { node: ts.Node; owner: ExpressionOwner }[] {
    return this.callNodes;
  }
}

// ---------------------------------------------------------------------------
// node classification
// ---------------------------------------------------------------------------

/**
 * `undefined` means "not an expression this relation represents".
 *
 * Returning `undefined` rather than an `UNKNOWN` member is deliberate: an
 * UNKNOWN row is a row, and rows are what rules join on. A node the schema does
 * not model should produce nothing, not a row that means nothing.
 */
export function expressionKindOf(node: ts.Node): TsExpressionKind | undefined {
  switch (node.kind) {
    case ts.SyntaxKind.CallExpression: {
      return TsExpressionKind.CALL_EXPRESSION;
    }
    case ts.SyntaxKind.NewExpression: {
      return TsExpressionKind.NEW_EXPRESSION;
    }
    case ts.SyntaxKind.PropertyAccessExpression: {
      return TsExpressionKind.PROPERTY_ACCESS;
    }
    case ts.SyntaxKind.ElementAccessExpression: {
      return TsExpressionKind.ELEMENT_ACCESS;
    }
    case ts.SyntaxKind.Identifier:
    case ts.SyntaxKind.PrivateIdentifier: {
      return TsExpressionKind.IDENTIFIER_REFERENCE;
    }
    case ts.SyntaxKind.ThisKeyword: {
      return TsExpressionKind.THIS_REFERENCE;
    }
    case ts.SyntaxKind.SuperKeyword: {
      return TsExpressionKind.SUPER_REFERENCE;
    }
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.BigIntLiteral:
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.NullKeyword:
    case ts.SyntaxKind.RegularExpressionLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral: {
      return TsExpressionKind.LITERAL;
    }
    case ts.SyntaxKind.TemplateExpression: {
      return TsExpressionKind.TEMPLATE_EXPRESSION;
    }
    case ts.SyntaxKind.TaggedTemplateExpression: {
      return TsExpressionKind.TAGGED_TEMPLATE;
    }
    case ts.SyntaxKind.ArrowFunction: {
      return TsExpressionKind.ARROW_FUNCTION;
    }
    case ts.SyntaxKind.FunctionExpression: {
      return TsExpressionKind.FUNCTION_EXPRESSION;
    }
    case ts.SyntaxKind.ClassExpression: {
      return TsExpressionKind.CLASS_EXPRESSION;
    }
    case ts.SyntaxKind.ObjectLiteralExpression: {
      return TsExpressionKind.OBJECT_LITERAL;
    }
    case ts.SyntaxKind.ArrayLiteralExpression: {
      return TsExpressionKind.ARRAY_LITERAL;
    }
    case ts.SyntaxKind.BinaryExpression: {
      const operator = (node as ts.BinaryExpression).operatorToken.kind;
      if (operator === ts.SyntaxKind.EqualsToken) {
        return TsExpressionKind.ASSIGNMENT_EXPRESSION;
      }
      if (COMPOUND_ASSIGNMENT_OPERATORS.has(operator)) {
        return TsExpressionKind.COMPOUND_ASSIGNMENT;
      }
      if (operator === ts.SyntaxKind.CommaToken) {
        return TsExpressionKind.SEQUENCE_EXPRESSION;
      }
      return TsExpressionKind.BINARY_EXPRESSION;
    }
    case ts.SyntaxKind.PrefixUnaryExpression:
    case ts.SyntaxKind.PostfixUnaryExpression: {
      return TsExpressionKind.UNARY_EXPRESSION;
    }
    case ts.SyntaxKind.ConditionalExpression: {
      return TsExpressionKind.TERNARY_EXPRESSION;
    }
    case ts.SyntaxKind.AsExpression: {
      return TsExpressionKind.AS_EXPRESSION;
    }
    case ts.SyntaxKind.SatisfiesExpression: {
      return TsExpressionKind.SATISFIES_EXPRESSION;
    }
    case ts.SyntaxKind.TypeAssertionExpression: {
      return TsExpressionKind.TYPE_ASSERTION;
    }
    case ts.SyntaxKind.NonNullExpression: {
      return TsExpressionKind.NON_NULL_EXPRESSION;
    }
    case ts.SyntaxKind.AwaitExpression: {
      return TsExpressionKind.AWAIT_EXPRESSION;
    }
    case ts.SyntaxKind.YieldExpression: {
      return TsExpressionKind.YIELD_EXPRESSION;
    }
    case ts.SyntaxKind.SpreadElement:
    case ts.SyntaxKind.SpreadAssignment: {
      return TsExpressionKind.SPREAD_ELEMENT;
    }
    case ts.SyntaxKind.DeleteExpression:
    case ts.SyntaxKind.TypeOfExpression:
    case ts.SyntaxKind.VoidExpression: {
      return TsExpressionKind.DELETE_TYPEOF_VOID;
    }
    case ts.SyntaxKind.ParenthesizedExpression: {
      // A parenthesised expression is not a fact — it is punctuation. Emitting
      // a row for it would put a node between a call and its receiver that no
      // resolution rule expects, so it is transparent and its operand takes
      // its place.
      return undefined;
    }
    default: {
      return undefined;
    }
  }
}

const COMPOUND_ASSIGNMENT_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken, ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken, ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

interface ChildEdge {
  readonly node: ts.Node;
  readonly edgeRole: TsEdgeRole;
  readonly position: number;
}

/**
 * The child edges of an expression, in SOURCE order with their roles.
 *
 * Parentheses are unwrapped on the way through, so `(a).b()` has the same shape
 * as `a.b()`. That is not cosmetic: `receiverKind` dispatches on the receiver's
 * shape, and a `PARENTHESIZED` receiver that is really an identifier would fall
 * out of the resolvable set for no semantic reason.
 */
function childEdgesOf(node: ts.Node): ChildEdge[] {
  const out: ChildEdge[] = [];
  const push = (child: ts.Node | undefined, edgeRole: TsEdgeRole, position: number): void => {
    if (child) {
      out.push({ node: unwrapParentheses(child), edgeRole, position });
    }
  };

  if (ts.isCallExpression(node)) {
    push(node.expression, TsEdgeRole.METHOD_NAME, 0);
    let index = 0;
    for (const argument of node.arguments) {
      push(argument, TsEdgeRole.ARGUMENT, index);
      index += 1;
    }
    return out;
  }
  if (ts.isNewExpression(node)) {
    push(node.expression, TsEdgeRole.METHOD_NAME, 0);
    let index = 0;
    for (const argument of node.arguments ?? []) {
      push(argument, TsEdgeRole.ARGUMENT, index);
      index += 1;
    }
    return out;
  }
  if (ts.isTaggedTemplateExpression(node)) {
    push(node.tag, TsEdgeRole.TAG_EXPRESSION, 0);
    if (ts.isTemplateExpression(node.template)) {
      let index = 0;
      for (const span of node.template.templateSpans) {
        push(span.expression, TsEdgeRole.TEMPLATE_SPAN, index);
        index += 1;
      }
    }
    return out;
  }
  if (ts.isPropertyAccessExpression(node)) {
    push(node.expression, TsEdgeRole.RECEIVER, 0);
    push(node.name, TsEdgeRole.PROPERTY_NAME, 0);
    return out;
  }
  if (ts.isElementAccessExpression(node)) {
    push(node.expression, TsEdgeRole.RECEIVER, 0);
    push(node.argumentExpression, TsEdgeRole.INDEX_ARGUMENT, 0);
    return out;
  }
  if (ts.isBinaryExpression(node)) {
    push(node.left, TsEdgeRole.LEFT_OPERAND, 0);
    push(node.right, TsEdgeRole.RIGHT_OPERAND, 0);
    return out;
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    push(node.operand, TsEdgeRole.UNARY_OPERAND, 0);
    return out;
  }
  if (ts.isConditionalExpression(node)) {
    push(node.condition, TsEdgeRole.TERNARY_CONDITION, 0);
    push(node.whenTrue, TsEdgeRole.TERNARY_THEN, 0);
    push(node.whenFalse, TsEdgeRole.TERNARY_ELSE, 0);
    return out;
  }
  if (ts.isAsExpression(node)) {
    push(node.expression, TsEdgeRole.AS_OPERAND, 0);
    return out;
  }
  if (ts.isSatisfiesExpression(node)) {
    push(node.expression, TsEdgeRole.SATISFIES_OPERAND, 0);
    return out;
  }
  if (ts.isTypeAssertionExpression(node)) {
    push(node.expression, TsEdgeRole.AS_OPERAND, 0);
    return out;
  }
  if (ts.isNonNullExpression(node) || ts.isAwaitExpression(node) || ts.isYieldExpression(node)
    || ts.isDeleteExpression(node) || ts.isTypeOfExpression(node) || ts.isVoidExpression(node)) {
    push((node as { expression?: ts.Expression }).expression, TsEdgeRole.UNARY_OPERAND, 0);
    return out;
  }
  if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) {
    push(node.expression, TsEdgeRole.SPREAD_OPERAND, 0);
    return out;
  }
  if (ts.isTemplateExpression(node)) {
    let index = 0;
    for (const span of node.templateSpans) {
      push(span.expression, TsEdgeRole.TEMPLATE_SPAN, index);
      index += 1;
    }
    return out;
  }
  if (ts.isArrayLiteralExpression(node)) {
    let index = 0;
    for (const element of node.elements) {
      if (!ts.isOmittedExpression(element)) {
        push(element, TsEdgeRole.ARRAY_ELEMENT, index);
      }
      index += 1;
    }
    return out;
  }
  /**
   * The key of an object-literal property, when syntax alone names it.
   *
   * A COMPUTED key is skipped rather than guessed: `{ [k]: 1 }` needs the value
   * of `k`, and the walker already reaches that expression through
   * `COMPUTED_PROPERTY_NAME`. Emitting nothing leaves the value row standing
   * alone at its position, which is how a consumer sees "dynamic" rather than
   * "absent".
   */
  const pushStaticKey = (name: ts.PropertyName, index: number): void => {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      push(name, TsEdgeRole.OBJECT_PROPERTY_KEY, index);
    }
  };

  if (ts.isObjectLiteralExpression(node)) {
    let index = 0;
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        pushStaticKey(property.name, index);
        push(property.initializer, TsEdgeRole.OBJECT_PROPERTY_VALUE, index);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        // `{ method }` is a key AND a value reference. Both rows, same
        // position: the value binds to the variable, the key does not.
        pushStaticKey(property.name, index);
        push(property.name, TsEdgeRole.OBJECT_PROPERTY_VALUE, index);
      } else if (ts.isSpreadAssignment(property)) {
        push(property, TsEdgeRole.SPREAD_OPERAND, index);
      }
      index += 1;
    }
    return out;
  }
  // Arrow and function expressions have a `ts_method` row of their own, and
  // their bodies are extracted under that owner. Descending here would emit
  // every statement of the body twice, attributed to the wrong owner.
  return out;
}

/** Parentheses are punctuation, not structure. */
export function unwrapParentheses(node: ts.Node): ts.Node {
  let current = node;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function argumentsOf(node: ts.Node): readonly ts.Expression[] {
  if (ts.isCallExpression(node)) {
    return node.arguments;
  }
  if (ts.isNewExpression(node)) {
    return node.arguments ?? [];
  }
  return [];
}

/**
 * The type node a `new` expression constructs, synthesised from its callee.
 *
 * `new Repo()` has no `TypeNode` in the tree — the callee is an EXPRESSION, and
 * `ts.factory` is the only way to obtain a type node for it. The synthesised node
 * is given the callee's position so the emitted row points at the source text
 * that named the type, not at a position of nothing.
 *
 * Returns nothing for a computed callee (`new registry[name]()`): there is no
 * name to record, and inventing one would be a claim about a value the parser
 * cannot read.
 */
function constructedTypeNodeOf(node: ts.NewExpression): ts.TypeNode | undefined {
  const callee = unwrapParentheses(node.expression);
  if (!ts.isIdentifier(callee) && !ts.isPropertyAccessExpression(callee)) {
    return undefined;
  }
  return synthesiseTypeReference(callee);
}

/** The type node tested by `x instanceof C`, synthesised from the right operand. */
function instanceofTypeNodeOf(node: ts.BinaryExpression): ts.TypeNode | undefined {
  const right = unwrapParentheses(node.right);
  if (!ts.isIdentifier(right) && !ts.isPropertyAccessExpression(right)) {
    return undefined;
  }
  return synthesiseTypeReference(right);
}

/**
 * Builds a `TypeReferenceNode` over an existing name expression.
 *
 * The synthesised node borrows the source node's `pos`/`end` and parent so that
 * `getStart`, `getText` and `getLineAndCharacterOfPosition` all answer about the
 * REAL source range. Without that the row would carry position 0 and text `""`,
 * which is worse than not emitting it: a row that names nothing still joins.
 */
function synthesiseTypeReference(
  name: ts.Identifier | ts.PropertyAccessExpression
): ts.TypeNode | undefined {
  const entityName = toEntityName(name);
  if (!entityName) {
    return undefined;
  }
  const node = ts.factory.createTypeReferenceNode(entityName, undefined) as ts.TypeNode & {
    pos: number; end: number; parent: ts.Node;
  };
  node.pos = name.pos;
  node.end = name.end;
  node.parent = name.parent;
  return node;
}

/** `a.b.C` as an entity name, reusing the ORIGINAL identifier nodes so text survives. */
function toEntityName(
  expression: ts.Identifier | ts.PropertyAccessExpression
): ts.EntityName | undefined {
  if (ts.isIdentifier(expression)) {
    return expression;
  }
  const left = unwrapParentheses(expression.expression);
  if (!ts.isIdentifier(left) && !ts.isPropertyAccessExpression(left)) {
    return undefined;
  }
  const qualifier = toEntityName(left);
  if (!qualifier || ts.isPrivateIdentifier(expression.name)) {
    return undefined;
  }
  const qualified = ts.factory.createQualifiedName(qualifier, expression.name) as
    ts.QualifiedName & { pos: number; end: number; parent: ts.Node };
  qualified.pos = expression.pos;
  qualified.end = expression.end;
  qualified.parent = expression.parent;
  return qualified;
}

function typeArgumentsOf(node: ts.Node): readonly ts.TypeNode[] | undefined {
  if (ts.isCallExpression(node) || ts.isNewExpression(node)
    || ts.isTaggedTemplateExpression(node)) {
    return node.typeArguments;
  }
  return undefined;
}

function assertedTypeOf(
  node: ts.Node
): { type: ts.TypeNode; context: TsTypeRefContext } | undefined {
  if (ts.isAsExpression(node)) {
    return { type: node.type, context: TsTypeRefContext.AS_TARGET };
  }
  if (ts.isSatisfiesExpression(node)) {
    return { type: node.type, context: TsTypeRefContext.SATISFIES_TARGET };
  }
  if (ts.isTypeAssertionExpression(node)) {
    return { type: node.type, context: TsTypeRefContext.TYPE_ASSERTION };
  }
  return undefined;
}

function isOptionalChainNode(node: ts.Node): boolean {
  const questionDot = (node as { questionDotToken?: ts.QuestionDotToken }).questionDotToken;
  return questionDot !== undefined;
}

function literalOf(node: ts.Node, sourceFile: ts.SourceFile): { type: string; value: string } {
  switch (node.kind) {
    case ts.SyntaxKind.StringLiteral: {
      return { type: TsLiteralType.STRING, value: (node as ts.StringLiteral).text };
    }
    case ts.SyntaxKind.NumericLiteral: {
      return { type: TsLiteralType.NUMBER, value: (node as ts.NumericLiteral).text };
    }
    case ts.SyntaxKind.BigIntLiteral: {
      return { type: TsLiteralType.BIGINT, value: (node as ts.BigIntLiteral).text };
    }
    case ts.SyntaxKind.TrueKeyword: {
      return { type: TsLiteralType.BOOLEAN, value: 'true' };
    }
    case ts.SyntaxKind.FalseKeyword: {
      return { type: TsLiteralType.BOOLEAN, value: 'false' };
    }
    case ts.SyntaxKind.NullKeyword: {
      return { type: TsLiteralType.NULL, value: 'null' };
    }
    case ts.SyntaxKind.RegularExpressionLiteral: {
      return {
        type: TsLiteralType.REGEX,
        value: (node as ts.RegularExpressionLiteral).text,
      };
    }
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral: {
      return {
        type: TsLiteralType.NO_SUBSTITUTION_TEMPLATE,
        value: (node as ts.NoSubstitutionTemplateLiteral).text,
      };
    }
    case ts.SyntaxKind.TemplateExpression: {
      return {
        type: TsLiteralType.TEMPLATE,
        value: EntityUtils.normalizeWhitespace(node.getText(sourceFile)),
      };
    }
    case ts.SyntaxKind.Identifier: {
      // `undefined` is an identifier in the grammar and a literal in practice.
      // Recording it as a literal is what lets an optionality rule see it.
      return (node as ts.Identifier).text === 'undefined'
        ? { type: TsLiteralType.UNDEFINED, value: 'undefined' }
        : { type: '', value: (node as ts.Identifier).text };
    }
    case ts.SyntaxKind.PrivateIdentifier: {
      return { type: '', value: (node as ts.PrivateIdentifier).text };
    }
    default: {
      return { type: '', value: '' };
    }
  }
}

function unaryFixityOf(node: ts.Node): string {
  if (ts.isPrefixUnaryExpression(node)) {
    return TsUnaryFixity.PREFIX;
  }
  if (ts.isPostfixUnaryExpression(node)) {
    return TsUnaryFixity.POSTFIX;
  }
  return '';
}

function operatorOf(node: ts.Node, sourceFile: ts.SourceFile): string {
  if (ts.isBinaryExpression(node)) {
    return node.operatorToken.getText(sourceFile);
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    return ts.tokenToString(node.operator) ?? '';
  }
  if (ts.isDeleteExpression(node)) {
    return 'delete';
  }
  if (ts.isTypeOfExpression(node)) {
    return 'typeof';
  }
  if (ts.isVoidExpression(node)) {
    return 'void';
  }
  return '';
}

// ---------------------------------------------------------------------------
// call-site shape
// ---------------------------------------------------------------------------

/** The callee of a call-shaped node, parentheses unwrapped. */
export function calleeOf(node: ts.Node): ts.Node | undefined {
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    return unwrapParentheses(node.expression);
  }
  if (ts.isTaggedTemplateExpression(node)) {
    return unwrapParentheses(node.tag);
  }
  return undefined;
}

/** The receiver of a callee, or `undefined` for an unqualified call. */
export function receiverNodeOf(callee: ts.Node | undefined): ts.Node | undefined {
  if (!callee) {
    return undefined;
  }
  if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
    return unwrapParentheses(callee.expression);
  }
  return undefined;
}

export function calleeNameOf(callee: ts.Node | undefined): string {
  if (!callee) {
    return '';
  }
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return ts.isPrivateIdentifier(callee.name) ? callee.name.text : callee.name.text;
  }
  if (ts.isElementAccessExpression(callee)) {
    // A computed callee has no simple name unless the index is a string
    // literal. Guessing one from the source text would make `""` — the honest
    // "computed callee" marker — indistinguishable from a real name.
    const argument = callee.argumentExpression;
    return ts.isStringLiteral(argument) ? argument.text : '';
  }
  if (callee.kind === ts.SyntaxKind.SuperKeyword) {
    return 'super';
  }
  return '';
}

/**
 * Whether this call IS the decorator, rather than a call inside one.
 *
 * `@Get("/x")` runs at class-definition time, which is the fact the kind
 * carries; `@Foo(bar())` contains an ordinary call as an argument, and that one
 * is not a decorator call. So only the IMMEDIATE parent counts -- parentheses
 * unwrapped, since `@(record("x"))` has been legal since TypeScript 5.0.
 */
function isDecoratorCall(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined && ts.isParenthesizedExpression(current)) {
    current = current.parent;
  }
  return current !== undefined && ts.isDecorator(current);
}

function callKindOf(node: ts.Node, callee: ts.Node | undefined): TsCallKind {
  if (ts.isNewExpression(node)) {
    return TsCallKind.CONSTRUCTOR_CALL;
  }
  // Checked before the callee shape, because `@a.b.Get("/x")` is a decorator
  // call first and a property-access callee second. Which one wins decides
  // whether an engine sees a call that happens at class-definition time.
  if (isDecoratorCall(node)) {
    return TsCallKind.DECORATOR_CALL;
  }
  if (ts.isTaggedTemplateExpression(node)) {
    return TsCallKind.TAGGED_TEMPLATE_CALL;
  }
  if (callee && callee.kind === ts.SyntaxKind.SuperKeyword) {
    return TsCallKind.SUPER_CALL;
  }
  if (callee && callee.kind === ts.SyntaxKind.ImportKeyword) {
    return TsCallKind.DYNAMIC_IMPORT_CALL;
  }
  // Optional-call is its own kind rather than a flag, because `a?.b()` and
  // `a.b()` differ in nullability but NOT in target, and a rule that treats
  // them alike is right about the target and wrong about reachability.
  if (isOptionalChainNode(node)) {
    return TsCallKind.OPTIONAL_CALL;
  }
  // An element-access callee is still a METHOD CALL: `ops[name](a, b)` calls a
  // member, and the only thing the brackets change is that the member name is
  // computed. INDEX_CALL is reserved for a call THROUGH AN INDEX SIGNATURE,
  // which is a fact about the receiver's TYPE and therefore a resolution
  // outcome — syntax cannot tell the two apart, so syntax does not try.
  if (callee && (ts.isPropertyAccessExpression(callee)
    || ts.isElementAccessExpression(callee))) {
    return TsCallKind.METHOD_CALL;
  }
  return TsCallKind.FUNCTION_CALL;
}

/**
 * The SHAPE of the receiver, which is what resolution dispatches on.
 *
 * Reported precisely rather than collapsed to a boolean, because the resolution
 * rate per receiver shape is the number that tells a working parser from one
 * that resolves only the easy half.
 */
function receiverKindOf(
  callee: ts.Node | undefined,
  receiver: ts.Node | undefined
): TsReceiverKind {
  if (callee && callee.kind === ts.SyntaxKind.SuperKeyword) {
    return TsReceiverKind.SUPER;
  }
  if (!receiver) {
    return TsReceiverKind.NONE;
  }
  if (receiver.kind === ts.SyntaxKind.ThisKeyword) {
    return TsReceiverKind.THIS;
  }
  if (receiver.kind === ts.SyntaxKind.SuperKeyword) {
    return TsReceiverKind.SUPER;
  }
  if (ts.isIdentifier(receiver)) {
    return TsReceiverKind.IDENTIFIER;
  }
  if (ts.isPropertyAccessExpression(receiver)) {
    return TsReceiverKind.PROPERTY_CHAIN;
  }
  if (ts.isCallExpression(receiver) || ts.isNewExpression(receiver)) {
    return TsReceiverKind.CALL_RESULT;
  }
  if (ts.isElementAccessExpression(receiver)) {
    return TsReceiverKind.ELEMENT_ACCESS;
  }
  if (ts.isNonNullExpression(receiver)) {
    return TsReceiverKind.NON_NULL;
  }
  if (ts.isAsExpression(receiver) || ts.isSatisfiesExpression(receiver)
    || ts.isTypeAssertionExpression(receiver)) {
    return TsReceiverKind.AS_EXPRESSION;
  }
  if (ts.isAwaitExpression(receiver)) {
    return TsReceiverKind.AWAIT_RESULT;
  }
  if (ts.isParenthesizedExpression(receiver)) {
    return TsReceiverKind.PARENTHESIZED;
  }
  return TsReceiverKind.UNKNOWN;
}
