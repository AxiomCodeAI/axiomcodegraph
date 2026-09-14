import { ABSENT, bool, joinHeader, joinRow, keyOf, num } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { JsScopeKind, JsStrictModeSource } from '@/enums/javascript/scopes';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A lexical scope — schema §3.13, 17 columns.
 *
 * **The relation with no `ts_*` analogue**, and the substantive difference
 * between the JavaScript spine and the TypeScript one. TypeScript needs no scope
 * relation because declared types carry resolution; here the oracle itself
 * decides only 52.6% of call sites, so the binder *is* the resolution mechanism
 * and a spine without it cannot answer what a name refers to.
 *
 * ## Four columns that are semantics, not bookkeeping
 *
 * - **`isFunctionScope`** is what makes hoisting representable: `var` hoists to
 *   the nearest one, `let` stops at the nearest block. Gate 7.3.3 asserts every
 *   `VAR_*` binding's declaration scope has it set.
 * - **`bindsThis`** is false for `ARROW`. That is the whole of lexical `this`,
 *   and 33,189 `this` references depend on getting it right.
 * - **`isStrictMode`** decides whether an assignment to an undeclared name
 *   *creates a global* or *throws*. The same source line is a binding in one
 *   file and an error in another.
 * - **`hasWithStatement`** marks a scope in which no name is statically
 *   resolvable. Rare, and the honest answer is to say so rather than emit
 *   confident bindings that may all be wrong.
 */
export class JsScopeRegistry implements EntityIdentifiable {
  static readonly ARITY = 17;

  readonly scopeKind: JsScopeKind;
  readonly parentScopeLinkHash: string;
  readonly depth: number;
  readonly isFunctionScope: boolean;
  readonly bindsThis: boolean;
  readonly bindsArguments: boolean;
  readonly isStrictMode: boolean;
  readonly strictModeSource: JsStrictModeSource;
  /** Filled after the binder's second pass, when implicit globals are known. */
  private declaredBindingCount = 0;
  readonly hasWithStatement: boolean;
  /**
   * FK→`js_method`. Back-patched: a scope is minted during the binder pass,
   * which runs BEFORE declarations, so the method that owns it does not exist
   * yet — and cannot, because a method's `bodyScopeLinkHash` points back here.
   */
  private ownerMethodLinkHash = ABSENT;
  readonly ownerModuleLinkHash: string;
  readonly startLine: number;
  readonly startColumn: number;
  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsScopeUniqueHash = ABSENT;

  constructor(props: {
    scopeKind: JsScopeKind;
    parentScopeLinkHash: string;
    depth: number;
    isFunctionScope: boolean;
    bindsThis: boolean;
    bindsArguments: boolean;
    isStrictMode: boolean;
    strictModeSource: JsStrictModeSource;
    hasWithStatement: boolean;
    ownerModuleLinkHash: string;
    startLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.scopeKind = props.scopeKind;
    this.parentScopeLinkHash = props.parentScopeLinkHash;
    this.depth = props.depth;
    this.isFunctionScope = props.isFunctionScope;
    this.bindsThis = props.bindsThis;
    this.bindsArguments = props.bindsArguments;
    this.isStrictMode = props.isStrictMode;
    this.strictModeSource = props.strictModeSource;
    this.hasWithStatement = props.hasWithStatement;
    this.ownerModuleLinkHash = props.ownerModuleLinkHash;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `JS_SCOPE_md5(ownerModuleLinkHash ‖ scopeKind ‖ startLine ‖ startColumn)`
   *
   * `scopeKind` is in the key and is doing real work, not disambiguating for
   * neatness. Three pairs of scopes legitimately begin at the same position:
   * `GLOBAL` and `MODULE` both start at line 1 column 1; a function and the
   * `BLOCK` of its body can share a position when the body is the function's
   * only extent; and a class expression's `CLASS` scope starts where the
   * expression does. Without the kind those collapse into one row — and a
   * collapsed PK **doubles** rather than erroring.
   */
  generateHash(): void {
    this.jsScopeUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_SCOPE,
      keyOf(this.ownerModuleLinkHash, this.scopeKind, this.startLine, this.startColumn)
    );
  }

  getHash(): string {
    return this.jsScopeUniqueHash;
  }

  setOwnerMethodLinkHash(hash: string): void {
    this.ownerMethodLinkHash = hash;
  }

  setDeclaredBindingCount(count: number): void {
    this.declaredBindingCount = count;
  }

  getEntryCombined(): string {
    return `js_scope[kind=${this.scopeKind}, depth=${this.depth}, line=${this.startLine}, `
      + `hash=${this.jsScopeUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        this.scopeKind,
        this.parentScopeLinkHash,
        num(this.depth),
        bool(this.isFunctionScope),
        bool(this.bindsThis),
        bool(this.bindsArguments),
        bool(this.isStrictMode),
        this.strictModeSource,
        num(this.declaredBindingCount),
        bool(this.hasWithStatement),
        this.ownerMethodLinkHash,
        this.ownerModuleLinkHash,
        num(this.startLine),
        num(this.startColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsScopeUniqueHash,
      ],
      JsScopeRegistry.ARITY,
      'js_scope'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'scopeKind', 'parentScopeLinkHash', 'depth', 'isFunctionScope', 'bindsThis',
        'bindsArguments', 'isStrictMode', 'strictModeSource', 'declaredBindingCount',
        'hasWithStatement', 'ownerMethodLinkHash', 'ownerModuleLinkHash', 'startLine',
        'startColumn', 'isExternal', 'serviceVersionLinkHash', 'jsScopeUniqueHash',
      ],
      JsScopeRegistry.ARITY,
      'js_scope'
    );
  }
}
