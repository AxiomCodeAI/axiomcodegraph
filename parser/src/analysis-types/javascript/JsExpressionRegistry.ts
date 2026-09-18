import { ABSENT, bool, boundedText, joinHeader, joinRow, keyOf, num, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { JS_EXPRESSION_TEXT_LIMIT } from '@/constants/javascript-constants';
import {
  JsBindingResolution,
  JsExpressionKind,
  JsLiteralKind,
  JsRootContext,
} from '@/enums/javascript/expressions';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * The spine — schema §3.10, 32 columns.
 *
 * Every expression reached by an **allowlist of expression positions**, never a
 * generic tree walk: a generic walk puts JSDoc type names into this relation and
 * type-only constructs then reach the call graph.
 *
 * ## Wrapper nodes are mandatory
 *
 * `x += 1` emits **one** `ASSIGNMENT` row with the target and value parented to
 * it under `ASSIGNMENT_TARGET`/`ASSIGNMENT_VALUE`, and `+=` in
 * `operatorString`. Flat emission fails on `a += 1; b += 2`: the engine-side
 * workaround pairs on `(scope, line, rootContext)` and yields four pairs, two of
 * them **inventing value flow that does not exist**. That is worse than dropping
 * the rows, which is why the operator is a column and not a kind.
 *
 * ## Two ways a subtree dies silently
 *
 * **A tree rooted at a non-emitting node dies before its children are
 * enqueued.** Parentheses produce no row, and `return ( a && b.c() )` lost the
 * whole tree — 1,808 expressions on one TypeScript corpus. JSX braces produce no
 * row, and every call inside one vanished — **4,488 of admin-ui's 14,335 call
 * sites.** Unwrapped at the root, in one place, so every position is fixed at
 * once.
 *
 * **The worklist stops at function boundaries.** `return function () { … }`
 * emitted the function and nothing inside it. Descent is explicit.
 *
 * ## `isModuleEdge` and `isDeclarationBearing` are where JavaScript diverges
 *
 * An expression here can *be* an import (`require`), *be* an export
 * (`module.exports =`), or *declare a method* (`Foo.prototype.bar = function`).
 * Those three flags and their link columns are how a row in this relation
 * announces that it is also a row somewhere else.
 *
 * Identity is the **byte range**: `endLine` and `endColumn` are in the key,
 * because a call and its callee share a start offset constantly.
 */
export class JsExpressionRegistry implements EntityIdentifiable {
  static readonly ARITY = 36;

  readonly expressionKind: JsExpressionKind;
  readonly text: string;
  readonly name: string;
  readonly isComputedName: boolean;
  /** `+=`, `??=`, `?.` — **the operator is a column, not a kind**, per Java's precedent. */
  readonly operatorString: string;
  readonly depth: number;
  readonly parentExpressionLinkHash: string;
  readonly edgeRole: string;
  readonly childIndex: number;
  readonly rootContext: JsRootContext;
  /** This expression IS an import or export edge. The second pass reads exactly these rows. */
  private isModuleEdge = false;
  private moduleEdgeLinkHash = ABSENT;
  /** This assignment DECLARES a member: `Foo.prototype.bar = function () {}`. */
  private isDeclarationBearing = false;
  private declarationLinkHash = ABSENT;
  private callSiteLinkHash = ABSENT;
  readonly referencedName: string;
  readonly referenceKind: string;
  private resolvedBindingLinkHash = ABSENT;
  private bindingResolution: JsBindingResolution | '' = ABSENT;
  /** Must be `false` in every row; the gate asserts it. */
  readonly isTypeOnlyReachable: boolean;
  readonly literalKind: JsLiteralKind;
  /** The depth cap of 32 was reached. Max observed depth is 67. */
  private isTruncated = false;
  readonly ownerScopeLinkHash: string;
  readonly ownerMethodLinkHash: string;
  readonly ownerModuleLinkHash: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  /** **In the primary key** — identity is the byte range, never the start offset. */
  readonly endColumn: number;
  /**
   * FK->`js_method`: **the callable this expression IS**.
   *
   * Set on every `ARROW`, `FUNCTION_EXPRESSION` and `CLASS_EXPRESSION`
   * row. Appended AFTER the primary key, because column order is frozen
   * and inserting it in place would shift `jsExpressionUniqueHash` from
   * c31 to c32 -- every consumer reading c31 as the expression hash would
   * silently read something else, misbinding every FK in the fact base.
   *
   * The consequence to know: this is the ONE relation whose PK is not its
   * last column. A check that finds a primary key positionally is wrong
   * here and must find it by name.
   */
  private introducesDeclarationLinkHash = ABSENT;
  /**
   * c33: FK→`js_method_parameter`, the sibling of c17 for a reference that
   * resolves to a PARAMETER — the case c17, FK→`js_variable`, could not hold.
   *
   * The binder resolved these correctly all along (`bindingResolution` LOCAL or
   * CLOSURE) and had nowhere to write the answer: 137,960 references naming a
   * parameter of their own method, 15,382 more one scope up, 58,483 parameter
   * rows reachable from nothing. A parameter is where data ENTERS a function.
   * Appended after the PK, like c32; a widened c17 would be a polymorphic FK,
   * which defeats the integrity gate.
   */
  private resolvedParameterLinkHash = ABSENT;
  /**
   * c34: the path within a destructuring pattern, AS WRITTEN. `a` for `{a, b}`,
   * `b.c` for `{b: {c}}`, `0` for `[x]`, `1.name` for `[, {name}]`; `""` when
   * the binding is not destructured. c33 names the parameter; this says which
   * property of the argument the bound name reads, which the engine could
   * otherwise learn only by re-parsing the source.
   */
  private bindingPath = '';
  /**
   * c35, FK->js_expression: for a REFERENCE to a binding declared inside a
   * destructuring pattern with a default (`({ mapper = twice } = {})`,
   * `const { a = f } = o`), the root of that default's expression. The binding's
   * value is what its path reaches PLUS this; without the link the default was
   * rooted as a free PARAMETER_DEFAULT and the reference saw only what callers
   * passed, which committed a known_edge to the wrong function (#673, PD-JS-5).
   */
  private bindingDefaultLinkHash = '';

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsExpressionUniqueHash = ABSENT;

  constructor(props: {
    expressionKind: JsExpressionKind;
    text: string;
    name: string;
    isComputedName: boolean;
    operatorString: string;
    depth: number;
    parentExpressionLinkHash: string;
    edgeRole: string;
    childIndex: number;
    rootContext: JsRootContext;
    referencedName: string;
    referenceKind: string;
    isTypeOnlyReachable: boolean;
    literalKind: JsLiteralKind;
    ownerScopeLinkHash: string;
    ownerMethodLinkHash: string;
    ownerModuleLinkHash: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.expressionKind = props.expressionKind;
    this.text = props.text;
    this.name = props.name;
    this.isComputedName = props.isComputedName;
    this.operatorString = props.operatorString;
    this.depth = props.depth;
    this.parentExpressionLinkHash = props.parentExpressionLinkHash;
    this.edgeRole = props.edgeRole;
    this.childIndex = props.childIndex;
    this.rootContext = props.rootContext;
    this.referencedName = props.referencedName;
    this.referenceKind = props.referenceKind;
    this.isTypeOnlyReachable = props.isTypeOnlyReachable;
    this.literalKind = props.literalKind;
    this.ownerScopeLinkHash = props.ownerScopeLinkHash;
    this.ownerMethodLinkHash = props.ownerMethodLinkHash;
    this.ownerModuleLinkHash = props.ownerModuleLinkHash;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.endLine = props.endLine;
    this.endColumn = props.endColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  generateHash(): void {
    this.jsExpressionUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_EXPRESSION,
      keyOf(this.ownerModuleLinkHash, this.expressionKind, this.startLine, this.startColumn, this.endLine, this.endColumn)
    );
  }

  getHash(): string {
    return this.jsExpressionUniqueHash;
  }

  setIsModuleEdge(value = true): void {
    this.isModuleEdge = value;
  }
  setModuleEdgeLinkHash(hash: string): void {
    this.moduleEdgeLinkHash = hash;
  }
  setIsDeclarationBearing(value = true): void {
    this.isDeclarationBearing = value;
  }
  setDeclarationLinkHash(hash: string): void {
    this.declarationLinkHash = hash;
  }
  setCallSiteLinkHash(hash: string): void {
    this.callSiteLinkHash = hash;
  }
  setResolvedBindingLinkHash(hash: string): void {
    this.resolvedBindingLinkHash = hash;
  }
  setBindingResolution(value: JsBindingResolution): void {
    this.bindingResolution = value;
  }
  setIsTruncated(value = true): void {
    this.isTruncated = value;
  }
  /** Read by the parse-gap pass, which derives its rows from the fact base. */
  wasTruncated(): boolean {
    return this.isTruncated;
  }
  setIntroducesDeclarationLinkHash(hash: string): void {
    this.introducesDeclarationLinkHash = hash;
  }
  setResolvedParameterLinkHash(hash: string, path: string): void {
    this.resolvedParameterLinkHash = hash;
    this.bindingPath = path;
  }

  setBindingDefaultLinkHash(hash: string): void {
    this.bindingDefaultLinkHash = hash;
  }

  getBindingDefaultLinkHash(): string {
    return this.bindingDefaultLinkHash;
  }

  getEntryCombined(): string {
    return `js_expression[hash=${this.jsExpressionUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        this.expressionKind,
        boundedText(this.text, JS_EXPRESSION_TEXT_LIMIT),
        text(this.name),
        bool(this.isComputedName),
        text(this.operatorString),
        num(this.depth),
        this.parentExpressionLinkHash,
        text(this.edgeRole),
        num(this.childIndex),
        this.rootContext,
        bool(this.isModuleEdge),
        this.moduleEdgeLinkHash,
        bool(this.isDeclarationBearing),
        this.declarationLinkHash,
        this.callSiteLinkHash,
        text(this.referencedName),
        text(this.referenceKind),
        this.resolvedBindingLinkHash,
        this.bindingResolution,
        bool(this.isTypeOnlyReachable),
        this.literalKind,
        bool(this.isTruncated),
        this.ownerScopeLinkHash,
        this.ownerMethodLinkHash,
        this.ownerModuleLinkHash,
        num(this.startLine),
        num(this.startColumn),
        num(this.endLine),
        num(this.endColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsExpressionUniqueHash,
        this.introducesDeclarationLinkHash,
        this.resolvedParameterLinkHash,
        text(this.bindingPath),
        this.bindingDefaultLinkHash,
      ],
      JsExpressionRegistry.ARITY,
      'js_expression'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'expressionKind',
        'text',
        'name',
        'isComputedName',
        'operatorString',
        'depth',
        'parentExpressionLinkHash',
        'edgeRole',
        'childIndex',
        'rootContext',
        'isModuleEdge',
        'moduleEdgeLinkHash',
        'isDeclarationBearing',
        'declarationLinkHash',
        'callSiteLinkHash',
        'referencedName',
        'referenceKind',
        'resolvedBindingLinkHash',
        'bindingResolution',
        'isTypeOnlyReachable',
        'literalKind',
        'isTruncated',
        'ownerScopeLinkHash',
        'ownerMethodLinkHash',
        'ownerModuleLinkHash',
        'startLine',
        'startColumn',
        'endLine',
        'endColumn',
        'isExternal',
        'serviceVersionLinkHash',
        'jsExpressionUniqueHash',
        'introducesDeclarationLinkHash',
        'resolvedParameterLinkHash',
        'bindingPath',
        'bindingDefaultLinkHash',
      ],
      JsExpressionRegistry.ARITY,
      'js_expression'
    );
  }
}
