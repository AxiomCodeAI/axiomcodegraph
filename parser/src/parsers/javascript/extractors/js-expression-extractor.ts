import * as ts from 'typescript';

import { JS_EXPRESSION_MAX_DEPTH } from '@/constants/javascript-constants';
import { JsCallSiteRegistry } from '@/analysis-types/javascript/JsCallSiteRegistry';
import { JsExpressionRegistry } from '@/analysis-types/javascript/JsExpressionRegistry';
import {
  JsCallKind,
  JsCallResolutionOutcome,
  JsReceiverPosition,
  JsReceiverTypeSource,
} from '@/enums/javascript/call-sites';
import {
  JsBindingResolution,
  JsEdgeRole,
  JsExpressionKind,
  JsLiteralKind,
  JsReferenceKind,
  JsRootContext,
} from '@/enums/javascript/expressions';
import { JsBindingRegime } from '@/enums/javascript/variables';
import { ScopeBuildResult } from '@/parsers/javascript/extractors/js-scope-builder';
import {
  GLOBAL_BUILTIN_NAMES,
  JsScopeNode,
  nodeKey,
  resolveName,
} from '@/parsers/javascript/extractors/js-symbol-table';
import {
  isDynamicImportCall,
  isModuleEdgeCall,
  isNodeBuiltinSpecifier,
  isRequireCall,
  rangeOf,
  bindingPathOf,
} from '@/utils/javascript';

/**
 * `js_expression` and `js_call_site` — the spine.
 *
 * ## Three failures this file is shaped by, all of them silent
 *
 * **1. A tree rooted at a non-emitting node dies before its children are
 * enqueued.** Parentheses produce no row of their own, so
 * `return ( a && b.c() )` lost the *whole* tree — 1,808 expressions on one
 * TypeScript corpus. JSX braces produce no row, so every call inside one
 * vanished: **4,488 of admin-ui's 14,335 call sites.** The fix is not to special
 * case each position but to **unwrap at the root, in one place** — see
 * {@link unwrap} — which fixed every position at once.
 *
 * **2. The worklist stops at function boundaries.** `return function () { … }`
 * emitted the function and nothing inside it. Every row that *was* emitted was
 * correct; there were simply fewer of them, which is why no check caught it.
 * Descent into a callable's body is explicit here.
 *
 * **3. Flat emission invites a repair that manufactures wrong edges.** `x += 1`
 * must be **one** `ASSIGNMENT` row with its target and value parented under
 * `ASSIGNMENT_TARGET`/`ASSIGNMENT_VALUE` and `+=` in `operatorString`. Emitted
 * flat, the engine-side workaround pairs on `(scope, line, rootContext)` and on
 * `a += 1; b += 2` yields four pairs, two of them pairing `a` with `2`. That is
 * worse than dropping the rows.
 *
 * ## An allowlist of positions, never a generic walk
 *
 * §6: a generic tree walk puts JSDoc type names into this relation, and
 * type-only constructs then reach the call graph. The root positions are
 * enumerated in `js-expression-walker.ts`; this file only ever descends from
 * one of them.
 */
export interface ExpressionExtractionOptions {
  readonly sourceFile: ts.SourceFile;
  readonly binder: ScopeBuildResult;
  readonly moduleHash: string;
  readonly serviceVersionLinkHash: string;
  readonly hashOfScope: (scope: JsScopeNode) => string;
  /** `nodeKey` of an assignment -> the declaration it mints. */
  readonly declarationByAssignment: ReadonlyMap<string, string>;
  /** Name -> the `js_variable` hash it binds, for same-file one-hop resolution. */
  readonly variableHashByBindingKey: ReadonlyMap<string, string>;
  /** Parameter row by the key of its ParameterDeclaration node, for c33. */
  readonly parameterHashByNode: ReadonlyMap<string, string>;
  /**
   * Does this file declare a type of that name?
   *
   * Same-file only, and a predicate rather than a lookup: the caller asks "is
   * `Foo` declared here", and reaching into another file to answer would be the
   * cross-file resolution this parser does not do.
   */
  readonly declaresTypeNamed: (name: string) => boolean;
}

/** What the caller supplies about the statement a tree hangs under. */
export interface RootPosition {
  readonly node: ts.Expression;
  readonly rootContext: JsRootContext;
  readonly ownerMethodHash: string;
}

export class JsExpressionExtractor {
  readonly expressions: JsExpressionRegistry[] = [];
  readonly callSites: JsCallSiteRegistry[] = [];

  /** Row by `nodeKey`, for the passes that link against a specific node. */
  readonly rowByNode = new Map<string, JsExpressionRegistry>();
  /** The ROOT row's hash by the root node's key, for declaration back-patching. */
  readonly rootHashByNode = new Map<string, string>();
  /**
   * Every expression that IS a module edge, in source order.
   *
   * The second pass reads exactly these. Kept as a list rather than recomputed
   * by scanning the relation, so gate 7.3.1's "exactly one import/export per
   * module-edge expression" is checkable against what was actually found.
   */
  readonly moduleEdgeNodes: { node: ts.CallExpression; row: JsExpressionRegistry }[] = [];

  private readonly options: ExpressionExtractionOptions;
  private readonly sourceFile: ts.SourceFile;
  /** Guards against emitting one node twice, which would DOUBLE rather than collide. */
  private readonly emitted = new Set<string>();

  constructor(options: ExpressionExtractionOptions) {
    this.options = options;
    this.sourceFile = options.sourceFile;
  }

  /** Emits the tree rooted at one allowlisted position. */
  emitRoot(root: RootPosition): void {
    const unwrapped = unwrap(root.node);
    if (unwrapped === undefined) {
      return;
    }
    const row = this.emit(unwrapped, undefined, JsEdgeRole.OPERAND, 0, 0,
      root.rootContext, root.ownerMethodHash);
    if (row !== undefined) {
      this.rootHashByNode.set(nodeKey(root.node), row.getHash());
      // Also under the UNWRAPPED node's key: a declaration linking to "the
      // initializer expression" may hold either the parenthesis or what is
      // inside it, depending on which pass found it first.
      this.rootHashByNode.set(nodeKey(unwrapped), row.getHash());
    }
  }

  // -------------------------------------------------------------------------

  private emit(
    node: ts.Expression,
    parent: JsExpressionRegistry | undefined,
    edgeRole: JsEdgeRole,
    childIndex: number,
    depth: number,
    rootContext: JsRootContext,
    ownerMethodHash: string
  ): JsExpressionRegistry | undefined {
    const identity = nodeKey(node);
    if (this.emitted.has(identity)) {
      // Reached twice. Emitting again would mint an identical primary key and
      // DOUBLE the row rather than colliding — the failure §2 names, where
      // nothing looks wrong and the count is quietly twice what it should be.
      return this.rowByNode.get(identity);
    }

    if (depth > JS_EXPRESSION_MAX_DEPTH) {
      // The cap is 32, not TypeScript's effective 20: the corpus reaches depth
      // 67 with a p99 of 26. The parent is marked rather than the subtree
      // silently vanishing.
      parent?.setIsTruncated();
      return undefined;
    }

    const kind = expressionKindOf(node);
    if (kind === undefined) {
      return undefined;
    }

    const at = this.positionOf(node);
    const scope = this.scopeAt(node);
    const row = new JsExpressionRegistry({
      expressionKind: kind,
      text: node.getText(this.sourceFile),
      name: nameOf(node),
      isComputedName: ts.isElementAccessExpression(node),
      operatorString: operatorOf(node),
      depth,
      parentExpressionLinkHash: parent?.getHash() ?? '',
      edgeRole,
      childIndex,
      rootContext,
      // A private name in reference position (`#brand in o`) is a reference
      // too, spelled with its `#` — a resolution with no name would be a row
      // that says "resolved" and not what.
      referencedName: ts.isIdentifier(node) || ts.isPrivateIdentifier(node)
        ? node.text
        : ts.isMetaProperty(node)
          ? `${ts.tokenToString(node.keywordToken) ?? ''}.${node.name.text}`
          : '',
      // `delete obj.x` and `typeof obj.x` operate on a PROPERTY ACCESS, not on
      // an identifier, so restricting this to identifiers left DELETE declared
      // and never emitted — and a delete recorded as a READ says the property is
      // consulted when in fact it is removed.
      referenceKind: ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)
        || ts.isElementAccessExpression(node)
        ? referenceKindOf(node)
        : '',
      // Must be false in every row; the gate asserts it. A type-only construct
      // reaching this relation is how a `@typedef` becomes a call target.
      isTypeOnlyReachable: false,
      literalKind: literalKindOf(node),
      ownerScopeLinkHash: this.options.hashOfScope(scope),
      ownerMethodLinkHash: ownerMethodHash,
      ownerModuleLinkHash: this.options.moduleHash,
      startLine: at.startLine,
      startColumn: at.startColumn,
      endLine: at.endLine,
      endColumn: at.endColumn,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.expressions.push(row);
    this.emitted.add(identity);
    this.rowByNode.set(identity, row);

    if (ts.isIdentifier(node)) {
      this.resolveIdentifier(node, row, scope);
    } else if (ts.isPrivateIdentifier(node)) {
      // `#brand in obj` — a class-private name in a reference position, and
      // the only way one gets here (`this.#x` is a property access whose NAME
      // is private, and never reaches this branch). No scope chain resolves a
      // private name: it is a slot on the class whose body encloses the
      // reference. CLASS_PRIVATE is the one honest value (§3.10.1); the 17 rows
      // carried an empty c18 until it existed.
      row.setBindingResolution(JsBindingResolution.CLASS_PRIVATE);
    }
    if (isModuleEdgeCall(node) && ts.isCallExpression(node)) {
      // Recorded for the second pass, which is what SETS `isModuleEdge` — the
      // flag belongs to the pass that mints the edge row, so gate 7.3.1's
      // one-edge-per-flagged-expression holds by construction.
      this.moduleEdgeNodes.push({ node, row });
    }
    // An assignment that DECLARES a member points at the declaration it mints,
    // and the declaration points back. Gate 7.3.7 asserts the round trip.
    const declaration = this.options.declarationByAssignment.get(identity);
    if (declaration !== undefined) {
      row.setIsDeclarationBearing(true);
      row.setDeclarationLinkHash(declaration);
    }

    this.emitChildren(node, row, depth, rootContext, ownerMethodHash);

    // `require('x')` gets NO call-site row: it is a module edge by ruling, and
    // counting its 9,055 sites as unresolved calls is what made the raw
    // resolution figure look worse than it is. `import('x')` gets BOTH, because
    // unlike `require` it is a genuine expression whose promise flows somewhere
    // — the call really happens and its result is used.
    if (isCallLike(node) && (!isModuleEdgeCall(node) || isDynamicImportCall(node))) {
      this.emitCallSite(node, row, scope, ownerMethodHash);
    }
    return row;
  }

  /**
   * Enqueues a node's children with their edge roles.
   *
   * Every branch is braced and every child goes through {@link emitChild}, which
   * unwraps. A child enqueued without unwrapping is the failure this file opens
   * with, and it is invisible: the parent row is present and correct, and the
   * subtree simply is not there.
   */
  private emitChildren(
    node: ts.Expression,
    row: JsExpressionRegistry,
    depth: number,
    rootContext: JsRootContext,
    ownerMethodHash: string
  ): void {
    const next = depth + 1;
    const child = (target: ts.Expression | undefined, role: JsEdgeRole, index: number): void => {
      if (target === undefined) {
        return;
      }
      this.emitChild(target, row, role, index, next, rootContext, ownerMethodHash);
    };

    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        child(node.left, JsEdgeRole.ELEMENT, 0);
        child(node.right, JsEdgeRole.ELEMENT, 1);
        return;
      }
      if (isAssignmentOperator(node.operatorToken.kind)) {
        // ONE wrapper, two labelled children, the operator in a column. `=`,
        // `+=`, `??=`, `||=` and every other compound form share this path.
        child(node.left, JsEdgeRole.ASSIGNMENT_TARGET, 0);
        child(node.right, JsEdgeRole.ASSIGNMENT_VALUE, 1);
        return;
      }
      child(node.left, JsEdgeRole.OPERAND, 0);
      child(node.right, JsEdgeRole.OPERAND, 1);
      return;
    }
    if (ts.isCallExpression(node)) {
      this.emitCallChildren(node, row, next, rootContext, ownerMethodHash);
      return;
    }
    if (ts.isNewExpression(node)) {
      // The SAME labels a call gets. `new ueberDB.Database()` names its receiver
      // exactly as `ueberDB.Database()` does, and the call site row links
      // `receiverExpressionLinkHash` at it either way — but this branch emitted
      // the callee whole and let the generic descent label `ueberDB` as an
      // ACCESS_TARGET, so the link pointed at a row whose role said it was not
      // a receiver. 445 constructor calls over the corpus, found by asserting
      // what the link column MEANS rather than that it resolves.
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        child(callee.expression, JsEdgeRole.RECEIVER, 0);
        if (ts.isElementAccessExpression(callee)) {
          child(callee.argumentExpression, JsEdgeRole.COMPUTED_KEY, 1);
        }
      } else {
        child(callee, JsEdgeRole.CALLEE, 0);
      }
      const args = node.arguments ?? [];
      const first = ts.isElementAccessExpression(callee) ? 2 : 1;
      for (let i = 0; i < args.length; i += 1) {
        child(args[i]!, JsEdgeRole.ARGUMENT, first + i);
      }
      return;
    }
    if (ts.isTaggedTemplateExpression(node)) {
      // The same labels a call gets. `String.raw\`…\`` names its receiver as
      // `String.raw(…)` does, and the call site links receiverExpressionLinkHash
      // at it — but the tag was emitted whole as CALLEE, so `String` became an
      // ACCESS_TARGET under it and the link pointed at a row whose role said it
      // was not a receiver. The `new` branch above had the identical defect
      // (445 sites); this one was found by the call-forms torture script.
      const tag = node.tag;
      if (ts.isPropertyAccessExpression(tag) || ts.isElementAccessExpression(tag)) {
        child(tag.expression, JsEdgeRole.RECEIVER, 0);
        if (ts.isElementAccessExpression(tag)) {
          child(tag.argumentExpression, JsEdgeRole.COMPUTED_KEY, 1);
        }
        child(node.template, JsEdgeRole.ARGUMENT, ts.isElementAccessExpression(tag) ? 2 : 1);
      } else {
        child(tag, JsEdgeRole.CALLEE, 0);
        child(node.template, JsEdgeRole.ARGUMENT, 1);
      }
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      child(node.expression, JsEdgeRole.ACCESS_TARGET, 0);
      return;
    }
    if (ts.isElementAccessExpression(node)) {
      child(node.expression, JsEdgeRole.ACCESS_TARGET, 0);
      child(node.argumentExpression, JsEdgeRole.COMPUTED_KEY, 1);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      child(node.condition, JsEdgeRole.CONDITION, 0);
      child(node.whenTrue, JsEdgeRole.OPERAND, 1);
      child(node.whenFalse, JsEdgeRole.OPERAND, 2);
      return;
    }
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      child(node.operand, JsEdgeRole.OPERAND, 0);
      return;
    }
    if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node)
      || ts.isDeleteExpression(node) || ts.isAwaitExpression(node)) {
      child(node.expression, JsEdgeRole.OPERAND, 0);
      return;
    }
    if (ts.isYieldExpression(node)) {
      child(node.expression, JsEdgeRole.OPERAND, 0);
      return;
    }
    if (ts.isSpreadElement(node)) {
      child(node.expression, JsEdgeRole.SPREAD_OPERAND, 0);
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (let i = 0; i < node.elements.length; i += 1) {
        child(node.elements[i]!, JsEdgeRole.ELEMENT, i);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      this.emitObjectLiteralMembers(node, row, next, rootContext, ownerMethodHash);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      for (let i = 0; i < node.templateSpans.length; i += 1) {
        child(node.templateSpans[i]!.expression, JsEdgeRole.TEMPLATE_SUBSTITUTION, i);
      }
      return;
    }
    if (ts.isParenthesizedExpression(node)) {
      // Cannot be reached: unwrap() removes these before a row is ever minted.
      // Kept as a branch so a future change that stops unwrapping fails loudly
      // rather than dropping the subtree.
      child(node.expression, JsEdgeRole.OPERAND, 0);
      return;
    }
    if (ts.isCommaListExpression(node)) {
      for (let i = 0; i < node.elements.length; i += 1) {
        child(node.elements[i]!, JsEdgeRole.ELEMENT, i);
      }
      return;
    }
    if (isJsxNode(node)) {
      this.emitJsxChildren(node, row, next, ownerMethodHash);
      return;
    }
    // A callable in expression position. Its BODY belongs to its own method
    // row, so nothing is enqueued here — the declaration walk owns it. What
    // this row does is keep the expression tree unbroken around it.
  }

  private emitCallChildren(
    node: ts.CallExpression,
    row: JsExpressionRegistry,
    depth: number,
    rootContext: JsRootContext,
    ownerMethodHash: string
  ): void {
    const callee = node.expression;
    // The RECEIVER is labelled as such wherever it sits. For `obj.m()` that is
    // the member expression's object; for `f.call(obj, …)` it is argument 0, and
    // `receiverPosition = FIRST_ARGUMENT` on the call site agrees.
    const displaced = displacedReceiverKind(node);
    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
      if (displaced === undefined) {
        this.emitChild(callee.expression, row, JsEdgeRole.RECEIVER, 0, depth,
          rootContext, ownerMethodHash);
      } else {
        // `f` in `f.call(obj)` is the FUNCTION being invoked, not the receiver.
        this.emitChild(callee.expression, row, JsEdgeRole.CALLEE, 0, depth,
          rootContext, ownerMethodHash);
      }
    } else {
      this.emitChild(callee, row, JsEdgeRole.CALLEE, 0, depth, rootContext,
        ownerMethodHash);
    }
    // THE INDEX EXPRESSION OF `obj[expr](args)`.
    //
    // It was dropped. The receiver was emitted and the arguments were emitted
    // and `expr` — which is ordinary code that can contain anything — was
    // enqueued by nobody, so `obj[getName()]()` lost `getName()` entirely and
    // `obj[a ? b() : c()]()` lost both.
    //
    // What makes it a plain oversight rather than a decision: an element access
    // that is NOT a callee already emits its key as a COMPUTED_KEY child. The
    // machinery is the same three lines; it just was not reached on this path.
    //
    // Ordered between the receiver and the arguments because that is the
    // evaluation order — `obj` then `expr` then the arguments — and childIndex
    // is what an engine reconstructs order from.
    let nextIndex = 1;
    if (ts.isElementAccessExpression(callee)) {
      this.emitChild(callee.argumentExpression, row, JsEdgeRole.COMPUTED_KEY,
        nextIndex, depth, rootContext, ownerMethodHash);
      nextIndex += 1;
    }
    for (let i = 0; i < node.arguments.length; i += 1) {
      const role = displaced !== undefined && i === 0
        ? JsEdgeRole.RECEIVER
        : JsEdgeRole.ARGUMENT;
      this.emitChild(node.arguments[i]!, row, role, nextIndex + i, depth, rootContext,
        ownerMethodHash);
    }
  }

  /**
   * An object literal's members, keys included.
   *
   * The key gets its own row. TypeScript's audit found that omitting it made a
   * literal's shape unrecoverable — a consumer could see the values and not
   * which name each belonged to — and a computed key is emitted with
   * `isComputedName` rather than a guessed name.
   */
  private emitObjectLiteralMembers(
    node: ts.ObjectLiteralExpression,
    row: JsExpressionRegistry,
    depth: number,
    rootContext: JsRootContext,
    ownerMethodHash: string
  ): void {
    let index = 0;
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        if (ts.isComputedPropertyName(property.name)) {
          this.emitChild(property.name.expression, row, JsEdgeRole.COMPUTED_KEY,
            index, depth, rootContext, ownerMethodHash);
        } else {
          // The KEY gets its own row. Without it a literal's shape is
          // unrecoverable — a consumer sees the values and not which name each
          // belongs to — and the pre-ES6 module pattern is exactly an object
          // literal of functions, so the key is the method name.
          this.emitPropertyKey(property.name, row, index, depth, rootContext,
            ownerMethodHash);
        }
        this.emitChild(property.initializer, row, JsEdgeRole.PROPERTY_VALUE,
          index, depth, rootContext, ownerMethodHash);
        index += 1;
        continue;
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        // `{ value }` — the name is both key and value, and the VALUE is what a
        // consumer follows, so the identifier is emitted as a property value.
        this.emitChild(property.name, row, JsEdgeRole.PROPERTY_VALUE, index,
          depth, rootContext, ownerMethodHash);
        // `({ buffer = Buffer.alloc(16384) } = params)` — a DEFAULT inside a
        // destructuring ASSIGNMENT.
        //
        // The target of an assignment is parsed as an object LITERAL, not a
        // binding pattern, and a default on it lands on
        // `objectAssignmentInitializer` — a property nothing here read. So the
        // expression was never emitted and any call inside it never existed.
        //
        // Found by AST recall rather than by any row count: 2 of 195,781 call
        // sites and 28 of 75,349 variables, all of them this one shape, all in
        // the platform runtime's own library. The DECLARATION forms beside it — `const {a = mk()} = s`,
        // `function f({b = mk()} = {})`, `const [c = mk()] = arr` — were all
        // walked correctly, which is what says it is this node and not a policy.
        if (property.objectAssignmentInitializer !== undefined) {
          this.emitChild(property.objectAssignmentInitializer, row,
            JsEdgeRole.PROPERTY_VALUE, index, depth, rootContext, ownerMethodHash);
        }
        index += 1;
        continue;
      }
      if (ts.isSpreadAssignment(property)) {
        this.emitChild(property.expression, row, JsEdgeRole.SPREAD_OPERAND, index,
          depth, rootContext, ownerMethodHash);
        index += 1;
        continue;
      }
      // A method or accessor in a literal. Its body belongs to its own method
      // row; the literal's shape is what this relation records.
      index += 1;
    }
  }

  /**
   * JSX children, with the **brace** unwrapped.
   *
   * `{t(msg)}` is a `JsxExpression` that produces no row of its own, so a
   * subtree rooted at it dies — and that cost TypeScript 4,488 of 14,335 call
   * sites. {@link unwrap} handles it, and this method exists to reach the
   * containers in the first place.
   */
  private emitJsxChildren(
    node: ts.Expression,
    row: JsExpressionRegistry,
    depth: number,
    ownerMethodHash: string
  ): void {
    // No `rootContext` parameter: everything inside JSX gets
    // `JSX_EXPRESSION` regardless of the statement the markup hangs under,
    // because markup-embedded code is not the enclosing statement's value.
    let index = 0;
    // THE TAG NAME FIRST, as child 0, when it references something (§2.5a).
    // `<Foo/>` reads the binding `Foo`; `<widgets.panel/>` is a property
    // access whose root identifier falls out of the subtree. An intrinsic tag
    // emits nothing here. The closing tag is skipped below: it repeats the
    // same reference and would double it.
    const tag = jsxTagReference(node);
    if (tag !== undefined) {
      this.emitChild(tag, row, JsEdgeRole.JSX_TAG_NAME, index, depth,
        JsRootContext.JSX_EXPRESSION, ownerMethodHash);
      index += 1;
    }
    const visitJsx = (current: ts.Node, parentRow: JsExpressionRegistry,
      currentDepth: number): void => {
      if (ts.isJsxClosingElement(current) || current === tag) {
        return;
      }
      // An ATTRIBUTE is a wrapper: a name and a value. Without a row for it the
      // fact base holds `cls` with no record that the prop is called
      // `className` — the §3 defect class, parts emitted and structure absent.
      // `onClick={handler}` hands a function to a component, and which prop it
      // was handed as is the whole content of the edge.
      if (ts.isJsxAttribute(current) && current.initializer !== undefined) {
        const attributeRow = this.emitJsxAttribute(current, parentRow, index,
          currentDepth, ownerMethodHash);
        index += 1;
        if (attributeRow !== undefined) {
          if (ts.isStringLiteralLike(current.initializer)) {
            this.emitChild(current.initializer, attributeRow,
              JsEdgeRole.PROPERTY_VALUE, 0, currentDepth + 1,
              JsRootContext.JSX_EXPRESSION, ownerMethodHash);
          } else {
            // The INITIALIZER itself, not its children. Descending into a
            // `JsxExpression`'s children reaches the expression as a bare node
            // that no branch here claims, so the value was dropped and the
            // attribute row came out childless — the same subtree-death this
            // file exists to prevent, reintroduced one level down.
            this.emitAttributeValue(current.initializer, attributeRow,
              currentDepth + 1, ownerMethodHash);
          }
        }
        return;
      }
      // A SPREAD ATTRIBUTE — `<C {...props} />` — hands a whole object to the
      // component. It is neither an attribute with an initializer nor a brace
      // container, so the generic descent reached its expression as a bare
      // node no branch claimed: `sequence[0]`, `this.props`, `Theme.Consumer`
      // were 24 expressions missing from the tree on the development corpus,
      // found by the AST recall's residue once the by-rule exclusions were
      // named. The same edge a spread argument gets.
      if (ts.isJsxSpreadAttribute(current)) {
        this.emitChild(current.expression, parentRow, JsEdgeRole.SPREAD_OPERAND,
          index, currentDepth, JsRootContext.JSX_EXPRESSION, ownerMethodHash);
        index += 1;
        return;
      }
      // A NESTED JSX ELEMENT gets its own row, and becomes the parent of its
      // own children.
      //
      // Without this it was walked THROUGH: attributes and the calls inside
      // them were emitted, correctly, and hung off the outermost element — so
      // the parts were all present and the structure was absent, which is §3's
      // defect class exactly. An engine asking what a component renders saw the
      // root tag and nothing below it.
      //
      // `emitChild` re-enters the main path, which dispatches JSX nodes back
      // into this method with the new row as parent, so the recursion is the
      // ordinary one and the depth cap applies as everywhere else.
      if (isJsxNode(current) && current !== node) {
        this.emitChild(current as ts.Expression, parentRow, JsEdgeRole.JSX_CHILD,
          index, currentDepth, JsRootContext.JSX_EXPRESSION, ownerMethodHash);
        index += 1;
        return;
      }
      if (ts.isJsxExpression(current)) {
        if (current.expression !== undefined) {
          // JSX_EXPRESSION as the root context for everything inside a brace:
          // markup-embedded code is not the enclosing statement's return value,
          // and a consumer that cannot tell them apart reads a render callback
          // as a returned expression.
          this.emitChild(current.expression, parentRow, JsEdgeRole.OPERAND,
            index, currentDepth, JsRootContext.JSX_EXPRESSION, ownerMethodHash);
          index += 1;
        }
        return;
      }
      ts.forEachChild(current, (child) => {
        visitJsx(child, parentRow, currentDepth);
      });
    };
    ts.forEachChild(node, (child) => {
      visitJsx(child, row, depth);
    });
  }

  /**
   * A property key, as its own row.
   *
   * Never bound as a scope reference: `{ x: 1 }` mentions `x` and refers to
   * nothing — treating the key as an identifier reference would resolve it
   * against whatever `x` happens to be in scope and invent an edge. So the row
   * is `PROPERTY_KEY` with `referencedName` empty, and only its `name` carries
   * the text.
   */
  private emitPropertyKey(
    name: ts.PropertyName,
    parent: JsExpressionRegistry,
    childIndex: number,
    depth: number,
    rootContext: JsRootContext,
    ownerMethodHash: string
  ): void {
    const identity = nodeKey(name);
    if (this.emitted.has(identity)) {
      return;
    }
    const at = this.positionOf(name);
    const row = new JsExpressionRegistry({
      expressionKind: JsExpressionKind.PROPERTY_KEY,
      text: name.getText(this.sourceFile),
      name: propertyKeyText(name),
      isComputedName: false,
      operatorString: '',
      depth,
      parentExpressionLinkHash: parent.getHash(),
      edgeRole: JsEdgeRole.PROPERTY_KEY,
      childIndex,
      rootContext,
      referencedName: '',
      referenceKind: '',
      isTypeOnlyReachable: false,
      literalKind: ts.isStringLiteral(name)
        ? JsLiteralKind.STRING
        : ts.isNumericLiteral(name) ? JsLiteralKind.NUMBER : JsLiteralKind.NONE,
      ownerScopeLinkHash: this.options.hashOfScope(this.scopeAt(name)),
      ownerMethodLinkHash: ownerMethodHash,
      ownerModuleLinkHash: this.options.moduleHash,
      startLine: at.startLine,
      startColumn: at.startColumn,
      endLine: at.endLine,
      endColumn: at.endColumn,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.expressions.push(row);
    this.emitted.add(identity);
    this.rowByNode.set(identity, row);
  }

  /**
   * An attribute's value, under its attribute row.
   *
   * `unwrap` removes the JSX brace, which produces no row of its own — the
   * wrapper that cost TypeScript 4,488 of 14,335 call sites when a subtree
   * rooted at one died before its children were enqueued.
   */
  private emitAttributeValue(
    initializer: ts.Node,
    attributeRow: JsExpressionRegistry,
    depth: number,
    ownerMethodHash: string
  ): void {
    if (!ts.isJsxExpression(initializer) && !ts.isJsxElement(initializer)
      && !ts.isJsxSelfClosingElement(initializer) && !ts.isJsxFragment(initializer)) {
      return;
    }
    this.emitChild(initializer as ts.Expression, attributeRow,
      JsEdgeRole.PROPERTY_VALUE, 0, depth, JsRootContext.JSX_EXPRESSION,
      ownerMethodHash);
  }

  /**
   * A JSX attribute, as a wrapper row carrying the prop's NAME.
   *
   * The value is parented to it under `PROPERTY_VALUE`, so `onClick={handler}`
   * says which prop `handler` was passed as. Emitting the value alone is the §3
   * defect class: the parts are there and the structure is not.
   */
  private emitJsxAttribute(
    attribute: ts.JsxAttribute,
    parent: JsExpressionRegistry,
    childIndex: number,
    depth: number,
    ownerMethodHash: string
  ): JsExpressionRegistry | undefined {
    const identity = nodeKey(attribute);
    if (this.emitted.has(identity)) {
      return this.rowByNode.get(identity);
    }
    const at = this.positionOf(attribute);
    const row = new JsExpressionRegistry({
      expressionKind: JsExpressionKind.JSX_ATTRIBUTE_VALUE,
      text: attribute.getText(this.sourceFile),
      name: attribute.name.getText(this.sourceFile),
      isComputedName: false,
      operatorString: '',
      depth,
      parentExpressionLinkHash: parent.getHash(),
      edgeRole: JsEdgeRole.PROPERTY_KEY,
      childIndex,
      rootContext: JsRootContext.JSX_EXPRESSION,
      referencedName: '',
      referenceKind: '',
      isTypeOnlyReachable: false,
      literalKind: JsLiteralKind.NONE,
      ownerScopeLinkHash: this.options.hashOfScope(this.scopeAt(attribute)),
      ownerMethodLinkHash: ownerMethodHash,
      ownerModuleLinkHash: this.options.moduleHash,
      startLine: at.startLine,
      startColumn: at.startColumn,
      endLine: at.endLine,
      endColumn: at.endColumn,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.expressions.push(row);
    this.emitted.add(identity);
    this.rowByNode.set(identity, row);
    return row;
  }

  /** Unwraps, then emits. The single place a child is enqueued. */
  private emitChild(
    node: ts.Expression,
    parent: JsExpressionRegistry,
    role: JsEdgeRole,
    childIndex: number,
    depth: number,
    rootContext: JsRootContext,
    ownerMethodHash: string
  ): void {
    const unwrapped = unwrap(node);
    if (unwrapped === undefined) {
      return;
    }
    this.emit(unwrapped, parent, role, childIndex, depth, rootContext, ownerMethodHash);
  }

  // -------------------------------------------------------------------------
  // call sites
  // -------------------------------------------------------------------------

  private emitCallSite(
    node: ts.Expression,
    expression: JsExpressionRegistry,
    scope: JsScopeNode,
    ownerMethodHash: string
  ): void {
    const at = this.positionOf(node);
    const kind = callKindOf(node);
    const callee = ts.isTaggedTemplateExpression(node)
      ? node.tag
      : (node as ts.CallExpression | ts.NewExpression).expression;
    const args = ts.isTaggedTemplateExpression(node)
      ? ([] as readonly ts.Expression[])
      : ((node as ts.CallExpression | ts.NewExpression).arguments ?? []);
    const displaced = ts.isCallExpression(node) ? displacedReceiverKind(node) : undefined;

    // The receiver, wherever it actually is. For `.call`/`.apply` it is argument
    // 0, and reading the syntactic receiver instead yields
    // `Function.prototype.call` as the target with the real receiver never
    // consulted — a WRONG edge, not a missing one.
    const receiver = displaced !== undefined
      ? args[0]
      : (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
        ? callee.expression
        : undefined;
    const receiverPosition = displaced !== undefined
      ? JsReceiverPosition.FIRST_ARGUMENT
      : receiver !== undefined ? JsReceiverPosition.SYNTACTIC : JsReceiverPosition.NONE;

    const calleeName = displaced !== undefined
      ? nameOfCallee((callee as ts.PropertyAccessExpression).expression)
      : nameOfCallee(callee);

    const receiverSource = this.receiverTypeSourceFor(receiver, scope);
    // The receiver's DECLARED type, when JSDoc supplies one. One of the three
    // things §0 says makes a row complete, and the only one this language has a
    // declaration-site channel for at all — 37.9% of parameters carry a JSDoc
    // type against 0.165% carrying a syntactic one.
    const declaredReceiverTypeName = receiverSource === JsReceiverTypeSource.JSDOC
      && receiver !== undefined && ts.isIdentifier(receiver)
      ? this.declaredTypeNameFor(receiver, scope)
      : '';
    // When there is no receiver there is still a CALLEE, and what the callee
    // resolves to decides just as much: `helper()` calling a function declared
    // in this file is SAME_FILE_RESOLVED, and `new Date()` targets the ambient
    // population. Reporting RECEIVER_UNTYPED for both would say the parser knows
    // nothing about either, which is false for the first and misleading for the
    // second.
    const calleeSource = receiver === undefined
      ? this.calleeTypeSourceFor(callee, scope)
      : JsReceiverTypeSource.NONE;
    const row = new JsCallSiteRegistry({
      callKind: kind,
      calleeText: callee.getText(this.sourceFile),
      calleeName,
      receiverText: receiver?.getText(this.sourceFile) ?? '',
      receiverPosition,
      argumentCount: args.length,
      hasSpreadArgument: args.some((argument) => ts.isSpreadElement(argument)),
      // ASKED OF THE CALL, not derived from the callee's kind.
      //
      // It was `kind === OPTIONAL_CALL`, and OPTIONAL_CALL is only ever returned
      // for a PROPERTY-ACCESS callee. So the optional token was read off the
      // member access and never off the call, and four shapes came out asserting
      // the opposite of the truth while their control passed in the same file:
      //
      //   maybe?.get?.('/f')   true   (control — a property-access callee)
      //   callback?.()         FALSE  — the call's own `?.(`, no member at all
      //   maybe?.[method]?.()  FALSE  — element access AND an optional call
      //   (fn)?.()             FALSE  — parenthesised callee
      //   obj?.[key]()         FALSE  — the RECEIVER short-circuits, so the call
      //                                 is conditional though it has no `?.`
      //
      // 13 of 127 optional call sites corpus-wide, 10% of the construct. It
      // loses nothing and is the §4 defect class at its worst: this is a
      // REACHABILITY column, the one thing telling an engine the edge is
      // conditional on the callee not being nullish. `false` there is not a
      // weaker answer, it is a wrong one — and recall, completeness and oracle
      // adjudication are all green either way.
      //
      // `ts.isOptionalChain` is the compiler's own answer and it is exact: the
      // OptionalChain flag propagates to every node after a `?.`, so it is true
      // for `a?.b.c()` — where the call short-circuits with no token of its own
      // — and false for `a.b()`. Verified over all eight shapes.
      //
      // `callKind` is deliberately NOT changed. It classifies the callee's
      // SHAPE, and whether OPTIONAL_CALL should displace COMPUTED_CALL for
      // `maybe?.[m]?.()` is a vocabulary question, not mine. Raised, not
      // improvised; the two columns are now orthogonal and both true.
      isOptionalCall: ts.isOptionalChain(node),
      // The 52.6% ceiling made explicit: the parser will not name the target for
      // roughly half of all calls, and this column says how much the engine has.
      declaredReceiverTypeName,
      receiverTypeSource: receiverSource,
      resolutionOutcome: resolutionOutcomeFor(kind, receiverSource, calleeSource),
      isDynamicCode: kind === JsCallKind.DYNAMIC_CODE_CALL,
      enclosingMethodLinkHash: ownerMethodHash,
      expressionLinkHash: expression.getHash(),
      ownerScopeLinkHash: this.options.hashOfScope(scope),
      ownerModuleLinkHash: this.options.moduleHash,
      startLine: at.startLine,
      startColumn: at.startColumn,
      // Must be false in every row; the gate asserts it.
      isTypeOnlyTarget: false,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.callSites.push(row);
    expression.setCallSiteLinkHash(row.getHash());
    if (receiver !== undefined) {
      const receiverRow = this.rowByNode.get(nodeKey(unwrap(receiver) ?? receiver));
      if (receiverRow !== undefined) {
        row.setReceiverExpressionLinkHash(receiverRow.getHash());
      }
    }
  }

  /**
   * How much type information the receiver carries, from syntax alone.
   *
   * `IMPORT_ALIAS` is the one that matters: `const x = require('y'); x.foo()` is
   * 34.4% of all oracle declines — the largest single cause — and every one is
   * *reconstructable* rather than unresolvable, because the binding names an
   * import and the import row carries `resolvedFilePath`.
   */
  private receiverTypeSourceFor(
    receiver: ts.Expression | undefined,
    scope: JsScopeNode
  ): JsReceiverTypeSource {
    if (receiver === undefined || !ts.isIdentifier(receiver)) {
      return JsReceiverTypeSource.NONE;
    }
    const resolution = resolveName(scope, receiver.text);
    if (resolution === undefined) {
      return GLOBAL_BUILTIN_NAMES.has(receiver.text)
        ? JsReceiverTypeSource.NODE_BUILTIN
        : JsReceiverTypeSource.NONE;
    }
    if (resolution.binding.regime === JsBindingRegime.IMPORT_BINDING) {
      return this.importSourceFor(resolution.binding.declarationNode);
    }
    if (resolution.binding.regime === JsBindingRegime.CLASS_TDZ) {
      return JsReceiverTypeSource.LOCAL_CLASS;
    }
    if (resolution.binding.regime === JsBindingRegime.GLOBAL_IMPLICIT) {
      return JsReceiverTypeSource.NONE;
    }
    // A `const x = require('y')` binding. The declaration extractor recorded
    // `initializerKind = REQUIRE_CALL` on the variable; the module-edge pass
    // fills `importLinkHash` on both rows, which is the hop the engine walks.
    if (isRequireBound(resolution.binding.declarationNode)) {
      return this.importSourceFor(resolution.binding.declarationNode);
    }
    // `const x = new Foo(); x.m()` — the receiver's type is a class declared in
    // THIS file, which is the one case the parser can very nearly finish and the
    // whole reason `SAME_FILE_RESOLVED` exists. Matching only on the receiver
    // BEING the class name missed every instance of one, which is the common
    // shape by a wide margin.
    const constructed = constructedTypeNameOf(resolution.binding.declarationNode);
    if (constructed !== undefined && this.options.declaresTypeNamed(constructed)) {
      return JsReceiverTypeSource.LOCAL_CLASS;
    }
    // A JSDoc `@type {Foo}` on the binding. The only declared-type channel the
    // language has, and it carries 37.9% of parameters — so a receiver typed by
    // one is a genuinely different report from one typed by nothing, and
    // folding them together says the parser knows less than it does.
    if (hasJsDocType(resolution.binding.declarationNode)) {
      return JsReceiverTypeSource.JSDOC;
    }
    return JsReceiverTypeSource.NONE;
  }

  /**
   * The JSDoc-declared type of a name, as written.
   *
   * Without type arguments, so a scope lookup needs no string surgery:
   * `@type {Array<Foo>}` names `Array`, and `Foo` is a child row in
   * `js_type_reference`.
   */
  private declaredTypeNameFor(name: ts.Identifier, scope: JsScopeNode): string {
    const resolution = resolveName(scope, name.text);
    const declaration = resolution?.binding.declarationNode ?? null;
    if (declaration === null) {
      return '';
    }
    let current: ts.Node | undefined = declaration;
    while (current !== undefined && !ts.isSourceFile(current)) {
      const tag = ts.getJSDocTypeTag(current);
      const type = tag?.typeExpression?.type;
      if (type !== undefined) {
        return ts.isTypeReferenceNode(type)
          ? type.typeName.getText(this.sourceFile)
          : type.getText(this.sourceFile);
      }
      if (ts.isStatement(current)) {
        break;
      }
      current = current.parent;
    }
    return '';
  }

  /**
   * An imported name, split by WHERE the module resolved to.
   *
   * `require('path')` and `require('./router')` are both import aliases and are
   * not the same report: the first targets the `lib_*` population, which is not
   * in this project and which no import hop reaches, and the second targets a
   * file the engine can open. Calling both `IMPORT_ALIAS` made every builtin
   * look like an import hop the parser had failed to complete — 739 of them on
   * one corpus, all of them correct and all counted as a gap.
   */
  private importSourceFor(declarationNode: ts.Node | null): JsReceiverTypeSource {
    const specifier = requireSpecifierOf(declarationNode);
    if (specifier !== undefined && isNodeBuiltinSpecifier(specifier)) {
      return JsReceiverTypeSource.NODE_BUILTIN;
    }
    return JsReceiverTypeSource.IMPORT_ALIAS;
  }

  /**
   * What the CALLEE resolves to, for a call with no receiver.
   *
   * Same-file one hop, and nothing more. A bare `fn()` whose name is bound by a
   * function declaration in this file has a target the parser really can name —
   * which is the one case `SAME_FILE_RESOLVED` exists for. Everything else
   * reports the channel and stops.
   */
  private calleeTypeSourceFor(
    callee: ts.Expression,
    scope: JsScopeNode
  ): JsReceiverTypeSource {
    const unwrapped = unwrap(callee) ?? callee;
    if (!ts.isIdentifier(unwrapped)) {
      return JsReceiverTypeSource.NONE;
    }
    const resolution = resolveName(scope, unwrapped.text);
    if (resolution === undefined) {
      return GLOBAL_BUILTIN_NAMES.has(unwrapped.text)
        ? JsReceiverTypeSource.NODE_BUILTIN
        : JsReceiverTypeSource.NONE;
    }
    const regime = resolution.binding.regime;
    if (regime === JsBindingRegime.IMPORT_BINDING) {
      return JsReceiverTypeSource.IMPORT_ALIAS;
    }
    if (isRequireBound(resolution.binding.declarationNode)) {
      return JsReceiverTypeSource.IMPORT_ALIAS;
    }
    if (regime === JsBindingRegime.CLASS_TDZ
      || regime === JsBindingRegime.FUNCTION_DECLARATION_HOISTED) {
      return JsReceiverTypeSource.LOCAL_CLASS;
    }
    return JsReceiverTypeSource.NONE;
  }

  // -------------------------------------------------------------------------
  // name resolution — SAME FILE, ONE HOP
  // -------------------------------------------------------------------------

  /**
   * Resolves an identifier against the binder, and never across a file.
   *
   * `bindingResolution` records **which scope** the name came from, which is a
   * different fact from *which row*: a name found in the current scope and the
   * same name found three closures up point at one `js_variable` row and mean
   * very different things about the code — the second says the value outlives
   * its frame.
   *
   * `resolvedBindingLinkHash` is tier 2 and **same-file one-hop only**. Following
   * an import to the declaring file is `type-resolution.dl` rewritten in
   * TypeScript, which was written once and then deleted.
   */
  private resolveIdentifier(
    node: ts.Identifier,
    row: JsExpressionRegistry,
    scope: JsScopeNode
  ): void {
    const resolution = resolveName(scope, node.text);
    if (resolution === undefined) {
      row.setBindingResolution(
        GLOBAL_BUILTIN_NAMES.has(node.text)
          ? JsBindingResolution.GLOBAL_BUILTIN
          : JsBindingResolution.UNRESOLVED_FREE
      );
      return;
    }
    const binding = resolution.binding;
    const where = binding.regime === JsBindingRegime.IMPORT_BINDING
      ? JsBindingResolution.IMPORTED
      : resolution.foundIn === this.options.binder.globalScope
        ? JsBindingResolution.GLOBAL_BUILTIN
        : resolution.foundIn === this.options.binder.moduleScope
          ? JsBindingResolution.MODULE
          : resolution.functionBoundariesCrossed > 0
            ? JsBindingResolution.CLOSURE
            : JsBindingResolution.LOCAL;
    row.setBindingResolution(where);
    if (binding.declarationNode === null) {
      return;
    }
    if (binding.regime === JsBindingRegime.PARAMETER) {
      // c33/c34. A parameter has no js_variable row — its name, position and
      // default belong to js_method_parameter, and minting a second row would
      // be one construct on two paths — so c17 could never carry this. The
      // binding's declaration node is the bound NAME, possibly deep inside a
      // destructuring pattern; the parameter row is keyed on the
      // ParameterDeclaration above it, and the path between the two is c34.
      const located = parameterOfBoundName(binding.declarationNode);
      if (located !== undefined) {
        const hash = this.options.parameterHashByNode.get(nodeKey(located.parameter));
        if (hash !== undefined) {
          row.setResolvedParameterLinkHash(hash, located.path);
        }
      }
      return;
    }
    const hash = this.options.variableHashByBindingKey.get(nodeKey(binding.declarationNode));
    if (hash !== undefined) {
      row.setResolvedBindingLinkHash(hash);
    }
  }

  /**
   * The innermost scope containing a node.
   *
   * The binder recorded one for every node it visited; a node it did not visit —
   * a binding pattern's inner name, say — walks up to the nearest ancestor that
   * has one. Never by comparing positions: two scopes beginning at the same
   * offset is the normal case in JavaScript, not an edge case.
   */
  private scopeAt(node: ts.Node): JsScopeNode {
    let current: ts.Node | undefined = node;
    while (current !== undefined) {
      const scope = this.options.binder.enclosingScopeOf.get(nodeKey(current));
      if (scope !== undefined) {
        return scope;
      }
      current = current.parent;
    }
    return this.options.binder.moduleScope;
  }

  private positionOf(node: ts.Node): {
    startLine: number; startColumn: number; endLine: number; endColumn: number;
  } {
    return rangeOf(node, this.sourceFile);
  }
}

/**
 * Removes every wrapper that produces no row, in ONE place.
 *
 * This is the fix for §6's most expensive failure, and the reason it is one
 * function rather than a check at each call site: *unwrapping at the root fixed
 * every position at once*, taking one TypeScript corpus from 55,683 to 57,491
 * expressions.
 *
 * Four wrappers, and the list is deliberately closed:
 *
 * - **Parentheses.** `( a && b.c() )` — the tree died entirely.
 * - **JSX expression containers.** `{t(msg)}` — 4,488 of 14,335 call sites.
 * - **Non-null assertions** and **type assertions.** TypeScript syntax that
 *   `ts.createSourceFile` will happily parse out of a `.js` file carrying Flow,
 *   and a wrapper either way.
 *
 * Returns `undefined` for an empty JSX brace — `{}` wraps nothing, so there is
 * no expression to emit and no subtree to lose.
 */
function unwrap(node: ts.Expression): ts.Expression | undefined {
  let current: ts.Expression = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isJsxExpression(current)) {
      if (current.expression === undefined) {
        return undefined;
      }
      current = current.expression;
      continue;
    }
    return current;
  }
}

/**
 * The expression kinds this relation emits, as an allowlist.
 *
 * `undefined` means the node is not an expression position this schema records.
 * An allowlist rather than a default case, because a default case is how JSDoc
 * type names end up in the expression relation and type-only constructs reach
 * the call graph.
 */
function expressionKindOf(node: ts.Expression): JsExpressionKind | undefined {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
    return JsExpressionKind.IDENTIFIER;
  }
  if (node.kind === ts.SyntaxKind.ThisKeyword) {
    return JsExpressionKind.THIS;
  }
  if (node.kind === ts.SyntaxKind.SuperKeyword) {
    return JsExpressionKind.SUPER;
  }
  if (ts.isMetaProperty(node)) {
    return JsExpressionKind.META_PROPERTY;
  }
  if (isModuleEdgeCall(node)) {
    return JsExpressionKind.MODULE_EDGE_CALL;
  }
  if (ts.isCallExpression(node)) {
    return JsExpressionKind.CALL;
  }
  if (ts.isNewExpression(node)) {
    return JsExpressionKind.NEW;
  }
  if (ts.isTaggedTemplateExpression(node)) {
    return JsExpressionKind.TAGGED_TEMPLATE;
  }
  if (ts.isPropertyAccessExpression(node)) {
    return node.questionDotToken !== undefined
      ? JsExpressionKind.OPTIONAL_ACCESS
      : JsExpressionKind.PROPERTY_ACCESS;
  }
  if (ts.isElementAccessExpression(node)) {
    return node.questionDotToken !== undefined
      ? JsExpressionKind.OPTIONAL_ACCESS
      : JsExpressionKind.ELEMENT_ACCESS;
  }
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      return JsExpressionKind.SEQUENCE;
    }
    return isAssignmentOperator(node.operatorToken.kind)
      ? JsExpressionKind.ASSIGNMENT
      : JsExpressionKind.BINARY;
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)
    || ts.isTypeOfExpression(node) || ts.isVoidExpression(node)
    || ts.isDeleteExpression(node)) {
    return JsExpressionKind.UNARY;
  }
  if (ts.isConditionalExpression(node)) {
    return JsExpressionKind.CONDITIONAL;
  }
  if (ts.isCommaListExpression(node)) {
    return JsExpressionKind.SEQUENCE;
  }
  // `ts.CommaListExpression` is a node the TRANSFORMER creates; the parser emits
  // `a, b` as a BinaryExpression whose operator is a comma. Checking only the
  // former is why SEQUENCE was declared and never emitted — and a comma operator
  // classified as BINARY reads as an arithmetic operation, when what it actually
  // does is evaluate the left operand and discard it.
  if (ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return JsExpressionKind.SEQUENCE;
  }
  if (ts.isObjectLiteralExpression(node)) {
    return JsExpressionKind.OBJECT_LITERAL;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return JsExpressionKind.ARRAY_LITERAL;
  }
  if (ts.isSpreadElement(node)) {
    return JsExpressionKind.SPREAD;
  }
  if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return JsExpressionKind.TEMPLATE;
  }
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isClassExpression(node)) {
    return JsExpressionKind.FUNCTION_EXPRESSION;
  }
  if (ts.isAwaitExpression(node)) {
    return JsExpressionKind.AWAIT;
  }
  if (ts.isYieldExpression(node)) {
    return JsExpressionKind.YIELD;
  }
  if (isJsxNode(node)) {
    return jsxTagReference(node) === undefined
      ? JsExpressionKind.JSX_INTRINSIC_ELEMENT
      : JsExpressionKind.JSX_ELEMENT;
  }
  if (isLiteral(node)) {
    return JsExpressionKind.LITERAL;
  }
  if (ts.isRegularExpressionLiteral(node)) {
    return JsExpressionKind.LITERAL;
  }
  return undefined;
}

function isCallLike(node: ts.Expression): boolean {
  return ts.isCallExpression(node) || ts.isNewExpression(node)
    || ts.isTaggedTemplateExpression(node);
}

/**
 * The call kind, from syntax and nothing else.
 *
 * Every value here is readable from the expression in front of you. The five
 * that are not — `INDEX_CALL`, `GETTER_INVOCATION`, `SETTER_INVOCATION`,
 * `PROXY_TRAP_CALL`, `GENERATOR_RESUME` — are reserved with a zero-row
 * assertion, because each is a fact about a value's runtime identity and
 * guessing is wrong more often than right.
 */
function callKindOf(node: ts.Expression): JsCallKind {
  if (ts.isTaggedTemplateExpression(node)) {
    return JsCallKind.TAGGED_TEMPLATE_CALL;
  }
  if (ts.isNewExpression(node)) {
    return JsCallKind.CONSTRUCTOR_CALL;
  }
  const call = node as ts.CallExpression;
  // Unwrapped: `(function () { … })()` puts a parenthesis between the call and
  // its function, so a check against the raw callee sees a wrapper and reports
  // FUNCTION_CALL with no name. The call, the parenthesis and the function all
  // begin at the same offset, which is why this is the one place it matters.
  const callee = unwrap(call.expression) ?? call.expression;
  if (callee.kind === ts.SyntaxKind.SuperKeyword) {
    return JsCallKind.SUPER_CALL;
  }
  if (callee.kind === ts.SyntaxKind.ImportKeyword) {
    return JsCallKind.DYNAMIC_IMPORT_CALL;
  }
  const displaced = displacedReceiverKind(call);
  if (displaced !== undefined) {
    return displaced;
  }
  if (ts.isIdentifier(callee)) {
    if (callee.text === 'eval') {
      return JsCallKind.DYNAMIC_CODE_CALL;
    }
    return JsCallKind.FUNCTION_CALL;
  }
  if (ts.isElementAccessExpression(callee)) {
    // `obj[expr]()`. The name is NOT fixed by syntax, so `calleeName` is `""`.
    // That is an honest terminal rather than a gap — the IR-completeness gate
    // treats it as complete *because* it says so.
    return JsCallKind.COMPUTED_CALL;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return call.questionDotToken !== undefined || callee.questionDotToken !== undefined
      ? JsCallKind.OPTIONAL_CALL
      : JsCallKind.METHOD_CALL;
  }
  if (ts.isFunctionExpression(callee) || ts.isArrowFunction(callee)) {
    // An IIFE. The pre-ES6 module pattern, and the reason unwrap() matters: the
    // call, the parenthesis and the function all begin at the same offset.
    return JsCallKind.IIFE_CALL;
  }
  return JsCallKind.FUNCTION_CALL;
}

/**
 * `.call` / `.apply` / `.bind` — the three that move the receiver into an
 * argument.
 *
 * 1,048 sites measured. Recognised by the member name plus a call shape, which
 * is all syntax offers: whether `x.call(…)` is `Function.prototype.call` or a
 * method named `call` on some object is a fact about `x`. The schema accepts
 * that: naming the receiver's real position is strictly better than reading
 * `Function.prototype.call` as the target, and the cases where an object has its
 * own `call` method are rare enough that the trade is stated rather than hidden.
 */
function displacedReceiverKind(call: ts.CallExpression): JsCallKind | undefined {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) {
    return undefined;
  }
  if (callee.name.text === 'call' && call.arguments.length >= 1) {
    return JsCallKind.FUNCTION_CALL_CALL;
  }
  if (callee.name.text === 'apply' && call.arguments.length >= 1) {
    return JsCallKind.FUNCTION_CALL_APPLY;
  }
  if (callee.name.text === 'bind' && call.arguments.length >= 1) {
    // Produces a function; does not invoke one. An engine treating it as an
    // invocation of the target reports an edge that does not happen here.
    return JsCallKind.FUNCTION_CALL_BIND;
  }
  return undefined;
}

/**
 * What the engine will have to do with this call site.
 *
 * The receiver decides when there is one; the callee decides when there is not.
 * `COMPUTED_NAME` and `DYNAMIC_CODE` win over both, because a row that says the
 * name is not fixed by syntax is **complete because it says so** — the
 * IR-completeness gate treats those as honest terminals rather than misses.
 */
function resolutionOutcomeFor(
  kind: JsCallKind,
  receiverSource: JsReceiverTypeSource,
  calleeSource: JsReceiverTypeSource
): JsCallResolutionOutcome {
  if (kind === JsCallKind.COMPUTED_CALL) {
    return JsCallResolutionOutcome.COMPUTED_NAME;
  }
  if (kind === JsCallKind.DYNAMIC_CODE_CALL) {
    return JsCallResolutionOutcome.DYNAMIC_CODE;
  }
  const source = receiverSource === JsReceiverTypeSource.NONE
    ? calleeSource
    : receiverSource;
  if (source === JsReceiverTypeSource.IMPORT_ALIAS) {
    return JsCallResolutionOutcome.IMPORT_HOP_AVAILABLE;
  }
  if (source === JsReceiverTypeSource.LOCAL_CLASS) {
    return JsCallResolutionOutcome.SAME_FILE_RESOLVED;
  }
  if (source === JsReceiverTypeSource.NODE_BUILTIN) {
    return JsCallResolutionOutcome.AMBIENT_BUILTIN_TARGET;
  }
  return JsCallResolutionOutcome.RECEIVER_UNTYPED;
}

function nameOfCallee(callee: ts.Expression): string {
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }
  // An element-access callee: the name is not fixed by syntax.
  return '';
}

function nameOf(node: ts.Expression): string {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }
  return '';
}

function operatorOf(node: ts.Expression): string {
  if (ts.isBinaryExpression(node)) {
    return ts.tokenToString(node.operatorToken.kind) ?? '';
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    return ts.tokenToString(node.operator) ?? '';
  }
  if (ts.isTypeOfExpression(node)) {
    return 'typeof';
  }
  if (ts.isVoidExpression(node)) {
    return 'void';
  }
  if (ts.isDeleteExpression(node)) {
    return 'delete';
  }
  if (ts.isPropertyAccessExpression(node) && node.questionDotToken !== undefined) {
    return '?.';
  }
  if (ts.isElementAccessExpression(node) && node.questionDotToken !== undefined) {
    return '?.';
  }
  return '';
}

/**
 * What is being done to this name.
 *
 * `READ_WRITE` for `x += 1` and `x++`, which do both: collapsing it into `WRITE`
 * loses the read a data-flow analysis needs and collapsing it into `READ` loses
 * the write.
 */
function referenceKindOf(node: ts.Expression): string {
  const parent = node.parent;
  if (parent === undefined) {
    return JsReferenceKind.READ;
  }
  if (ts.isBinaryExpression(parent) && parent.left === node
    && isAssignmentOperator(parent.operatorToken.kind)) {
    return parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ? JsReferenceKind.WRITE
      : JsReferenceKind.READ_WRITE;
  }
  if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
    && (parent.operator === ts.SyntaxKind.PlusPlusToken
      || parent.operator === ts.SyntaxKind.MinusMinusToken)) {
    return JsReferenceKind.READ_WRITE;
  }
  if (ts.isDeleteExpression(parent)) {
    return JsReferenceKind.DELETE;
  }
  if (ts.isTypeOfExpression(parent)) {
    // The one reference form that tolerates an unbound name, so an unresolved
    // TYPEOF is not evidence of a missing binding.
    return JsReferenceKind.TYPEOF;
  }
  return JsReferenceKind.READ;
}

function literalKindOf(node: ts.Expression): JsLiteralKind {
  if (ts.isStringLiteral(node)) {
    return JsLiteralKind.STRING;
  }
  if (ts.isNumericLiteral(node)) {
    return JsLiteralKind.NUMBER;
  }
  if (ts.isBigIntLiteral(node)) {
    return JsLiteralKind.BIGINT;
  }
  if (ts.isRegularExpressionLiteral(node)) {
    return JsLiteralKind.REGEX;
  }
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
    return JsLiteralKind.TEMPLATE;
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return JsLiteralKind.NULL;
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    return JsLiteralKind.BOOLEAN;
  }
  // `undefined` is an identifier in the grammar, not a literal. Recorded as one
  // because every consumer wants it to be, and nothing is lost: the IDENTIFIER
  // row it also produces carries bindingResolution = GLOBAL_BUILTIN.
  if (ts.isIdentifier(node) && node.text === 'undefined') {
    return JsLiteralKind.UNDEFINED;
  }
  return JsLiteralKind.NONE;
}

function isLiteral(node: ts.Expression): boolean {
  return ts.isStringLiteral(node) || ts.isNumericLiteral(node)
    || ts.isBigIntLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    || node.kind === ts.SyntaxKind.NullKeyword
    || node.kind === ts.SyntaxKind.TrueKeyword
    || node.kind === ts.SyntaxKind.FalseKeyword;
}

function propertyKeyText(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  return '';
}

function isJsxNode(node: ts.Node): boolean {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)
    || ts.isJsxFragment(node);
}

/**
 * The tag expression a JSX element REFERENCES, or `undefined` for an intrinsic
 * element and a fragment.
 *
 * Schema §2.5a, stated exactly because the folk rule ("capitalised or dotted")
 * is wrong in both directions: a tag is a reference iff it is a property
 * access, or a simple identifier that is a VALID ECMAScript identifier whose
 * first character is not a lowercase letter. `<Foo-Bar/>` parses as an
 * Identifier and is not one — no `const` can bind it — so it is intrinsic
 * regardless of case (js-fixtures' boundary case). `_` and `$` are not
 * lowercase letters: a lowercase letter CHANGES under `toUpperCase`, and they
 * do not. A namespaced name (`svg:circle`) binds nothing.
 */
function isValidIdentifierText(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  const points = [...text].map((c) => c.codePointAt(0) ?? 0);
  return ts.isIdentifierStart(points[0]!, ts.ScriptTarget.Latest)
    && points.slice(1).every((point) => ts.isIdentifierPart(point, ts.ScriptTarget.Latest));
}

function jsxTagReference(node: ts.Node): ts.Expression | undefined {
  const tagName = ts.isJsxElement(node)
    ? node.openingElement.tagName
    : ts.isJsxSelfClosingElement(node)
      ? node.tagName
      : undefined;
  if (tagName === undefined || ts.isJsxNamespacedName(tagName)) {
    return undefined;
  }
  if (ts.isPropertyAccessExpression(tagName)) {
    return tagName;
  }
  if (ts.isIdentifier(tagName)) {
    const text = tagName.text;
    const first = text.charAt(0);
    const isLowercaseLetter = first.toUpperCase() !== first;
    return isValidIdentifierText(text) && !isLowercaseLetter ? tagName : undefined;
  }
  // `<this.Widget/>` arrives as a property access; a bare `<this/>` is not
  // valid JSX and the compiler reports it. Anything else is unknown syntax
  // and references nothing this parser can name.
  return undefined;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/**
 * The type name a binding was constructed from: `const x = new Foo()` -> `Foo`.
 *
 * Reads the declaration in front of it and follows nothing. `new pkg.Thing()`
 * yields `Thing`, which the caller then checks against this file's own
 * declarations — so a same-file answer is given only when the name really is
 * declared here.
 */
function constructedTypeNameOf(declarationNode: ts.Node | null): string | undefined {
  if (declarationNode === null) {
    return undefined;
  }
  let current: ts.Node | undefined = declarationNode;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isVariableDeclaration(current)) {
      const initializer = current.initializer;
      if (initializer === undefined || !ts.isNewExpression(initializer)) {
        return undefined;
      }
      const callee = initializer.expression;
      if (ts.isIdentifier(callee)) {
        return callee.text;
      }
      if (ts.isPropertyAccessExpression(callee)) {
        return callee.name.text;
      }
      return undefined;
    }
    current = current.parent;
  }
  return undefined;
}

/** Does this binding's declaration carry a JSDoc `@type`? */
function hasJsDocType(declarationNode: ts.Node | null): boolean {
  if (declarationNode === null) {
    return false;
  }
  let current: ts.Node | undefined = declarationNode;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.getJSDocTypeTag(current) !== undefined) {
      return true;
    }
    if (ts.isStatement(current)) {
      break;
    }
    current = current.parent;
  }
  return false;
}

/**
 * The specifier a name was bound from, for `require` and for `import`.
 *
 * Same-file only: it reads the declaration in front of it and follows nothing.
 */
function requireSpecifierOf(declarationNode: ts.Node | null): string | undefined {
  if (declarationNode === null) {
    return undefined;
  }
  let current: ts.Node | undefined = declarationNode;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isImportDeclaration(current)
      && ts.isStringLiteralLike(current.moduleSpecifier)) {
      return current.moduleSpecifier.text;
    }
    if (ts.isVariableDeclaration(current)) {
      const initializer = current.initializer;
      if (initializer === undefined) {
        return undefined;
      }
      const root = ts.isPropertyAccessExpression(initializer)
        ? initializer.expression
        : initializer;
      // `ts.isCallExpression` first, for the NARROWING; `isRequireCall` for the
      // question. The shared predicate returns a plain boolean on purpose — see
      // its comment — so the caller does its own narrowing where it needs one.
      if (ts.isCallExpression(root) && isRequireCall(root)) {
        const first = root.arguments[0];
        if (first !== undefined && ts.isStringLiteralLike(first)) {
          return first.text;
        }
      }
      return undefined;
    }
    current = current.parent;
  }
  return undefined;
}

/** Was this name bound by `const x = require('y')`? */
function isRequireBound(declarationNode: ts.Node | null): boolean {
  if (declarationNode === null) {
    return false;
  }
  let current: ts.Node | undefined = declarationNode;
  while (current !== undefined && !ts.isVariableDeclaration(current)) {
    if (ts.isSourceFile(current)) {
      return false;
    }
    current = current.parent;
  }
  if (current === undefined || !ts.isVariableDeclaration(current)) {
    return false;
  }
  const initializer = current.initializer;
  if (initializer === undefined) {
    return false;
  }
  // `require('x')`, and also `require('x').Thing` — the second is how a named
  // export is pulled out in CommonJS and it is just as much a module alias.
  const root = ts.isPropertyAccessExpression(initializer)
    ? initializer.expression
    : initializer;
  return isRequireCall(root);
}

/**
 * The ParameterDeclaration a bound name belongs to, and the path to it.
 *
 * c34's rule, as ruled: the path within the pattern AS WRITTEN. Walking up from
 * the name Identifier through BindingElements and their patterns to the
 * parameter, each level contributes one segment — the property name for an
 * object pattern (the `propertyName` if the element renames, else the name),
 * the index for an array pattern — and the segments are joined innermost-last:
 *
 *   function f({a, b})        a    -> "a"
 *   function f({b: {c}})      c    -> "b.c"
 *   function f([x])           x    -> "0"
 *   function f([, {name}])    name -> "1.name"
 *   function f(x)             x    -> ""      not destructured
 */
function parameterOfBoundName(
  name: ts.Node
): { parameter: ts.ParameterDeclaration; path: string } | undefined {
  // One walk for every pattern, shared with the variable rows (#487).
  const bound = bindingPathOf(name);
  return bound.root !== undefined && ts.isParameter(bound.root)
    ? { parameter: bound.root, path: bound.path }
    : undefined;
}
