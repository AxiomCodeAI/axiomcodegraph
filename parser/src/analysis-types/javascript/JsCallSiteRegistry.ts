import { ABSENT, bool, boundedText, joinHeader, joinRow, keyOf, num, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { JS_EXPRESSION_TEXT_LIMIT } from '@/constants/javascript-constants';
import {
  JsCallKind,
  JsCallResolutionOutcome,
  JsReceiverPosition,
  JsReceiverTypeSource,
} from '@/enums/javascript/call-sites';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Exactly one row per call-like expression — schema §3.11, 25 columns.
 *
 * **`require()` is not here.** It is a module edge by ruling, and counting its
 * 9,055 sites as unresolved calls is what made the raw resolution figure look
 * worse than it is — they were listed as declines in a table whose denominator
 * the next paragraph removed them from.
 *
 * ## The primary key is derived from the expression, which makes the 1:1
 * structural rather than asserted
 *
 * `JS_CALL_SITE_md5(expressionLinkHash)`. A second call-site row for one
 * expression is impossible by construction rather than by a check that might not
 * run.
 *
 * ## `receiverPosition` exists for 1,048 sites and prevents a WRONG edge
 *
 * `f.call(obj, a)` and `f.apply(obj, args)` move the receiver into an
 * **argument**. An engine reading the syntactic receiver resolves `.call` and
 * gets `Function.prototype.call` as the target, with the real receiver never
 * consulted. `receiverExpressionLinkHash` points at the real receiver wherever
 * it sits.
 *
 * ## Columns 9-11 exist because of the 52.6% measurement
 *
 * The oracle itself — tsc with `checkJs` — decides only 52.6% of call sites.
 * The parser will not name the target for roughly half of all calls, and
 * pretending otherwise produces a confidently wrong fact base. What it can
 * always emit is the name as written, the receiver's declared type when JSDoc
 * supplies one, and the import hop — and those three let the engine finish.
 *
 * `resolvedMethodLinkHash` is **tier 3 and stays empty.**
 */
export class JsCallSiteRegistry implements EntityIdentifiable {
  static readonly ARITY = 25;

  readonly callKind: JsCallKind;
  readonly calleeText: string;
  readonly calleeName: string;
  readonly receiverText: string;
  /** Without this the engine reads `Function.prototype.call` as the target of `f.call(obj)`. */
  readonly receiverPosition: JsReceiverPosition;
  /** Points at the **real** receiver, wherever it sits — including argument 0. */
  private receiverExpressionLinkHash = ABSENT;
  readonly argumentCount: number;
  /** 1,301 spreads measured; the count is not the arity. */
  readonly hasSpreadArgument: boolean;
  readonly isOptionalCall: boolean;
  readonly declaredReceiverTypeName: string;
  readonly receiverTypeSource: JsReceiverTypeSource;
  private importLinkHash = ABSENT;
  /**
   * **TIER 3 — declared, never staged.** Always `""`, and there is
   * deliberately no setter.
   *
   * Java is the precedent: `referencedTypeRegistryLinkHash` is populated 0
   * times in 67,938 rows and that is the design, not an oversight.
   * Cross-file resolution is the engine's work, and a parser that fills
   * this column is `type-resolution.dl` rewritten in TypeScript — which was
   * written once and then deleted. The gate asserts zero populated rows.
   */
  private readonly resolvedMethodLinkHash = ABSENT;
  readonly resolutionOutcome: JsCallResolutionOutcome;
  readonly isDynamicCode: boolean;
  readonly enclosingMethodLinkHash: string;
  /** FK→`js_expression`, and the PK is derived from it — the 1:1 is structural. */
  readonly expressionLinkHash: string;
  readonly ownerScopeLinkHash: string;
  readonly ownerModuleLinkHash: string;
  readonly startLine: number;
  readonly startColumn: number;
  /** Must be `false` in every row; the gate asserts it. */
  readonly isTypeOnlyTarget: boolean;

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsCallSiteUniqueHash = ABSENT;

  constructor(props: {
    callKind: JsCallKind;
    calleeText: string;
    calleeName: string;
    receiverText: string;
    receiverPosition: JsReceiverPosition;
    argumentCount: number;
    hasSpreadArgument: boolean;
    isOptionalCall: boolean;
    declaredReceiverTypeName: string;
    receiverTypeSource: JsReceiverTypeSource;
    resolutionOutcome: JsCallResolutionOutcome;
    isDynamicCode: boolean;
    enclosingMethodLinkHash: string;
    expressionLinkHash: string;
    ownerScopeLinkHash: string;
    ownerModuleLinkHash: string;
    startLine: number;
    startColumn: number;
    isTypeOnlyTarget: boolean;
    serviceVersionLinkHash: string;
  }) {
    this.callKind = props.callKind;
    this.calleeText = props.calleeText;
    this.calleeName = props.calleeName;
    this.receiverText = props.receiverText;
    this.receiverPosition = props.receiverPosition;
    this.argumentCount = props.argumentCount;
    this.hasSpreadArgument = props.hasSpreadArgument;
    this.isOptionalCall = props.isOptionalCall;
    this.declaredReceiverTypeName = props.declaredReceiverTypeName;
    this.receiverTypeSource = props.receiverTypeSource;
    this.resolutionOutcome = props.resolutionOutcome;
    this.isDynamicCode = props.isDynamicCode;
    this.enclosingMethodLinkHash = props.enclosingMethodLinkHash;
    this.expressionLinkHash = props.expressionLinkHash;
    this.ownerScopeLinkHash = props.ownerScopeLinkHash;
    this.ownerModuleLinkHash = props.ownerModuleLinkHash;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.isTypeOnlyTarget = props.isTypeOnlyTarget;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  generateHash(): void {
    this.jsCallSiteUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_CALL_SITE,
      keyOf(this.expressionLinkHash)
    );
  }

  getHash(): string {
    return this.jsCallSiteUniqueHash;
  }

  setReceiverExpressionLinkHash(hash: string): void {
    this.receiverExpressionLinkHash = hash;
  }
  setImportLinkHash(hash: string): void {
    this.importLinkHash = hash;
  }
  /** Read by the IR-completeness measure, which asks whether the hop is present. */
  importLinkHashValue(): string {
    return this.importLinkHash;
  }

  getEntryCombined(): string {
    return `js_call_site[hash=${this.jsCallSiteUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        this.callKind,
        boundedText(this.calleeText, JS_EXPRESSION_TEXT_LIMIT),
        text(this.calleeName),
        boundedText(this.receiverText, JS_EXPRESSION_TEXT_LIMIT),
        this.receiverPosition,
        this.receiverExpressionLinkHash,
        num(this.argumentCount),
        bool(this.hasSpreadArgument),
        bool(this.isOptionalCall),
        text(this.declaredReceiverTypeName),
        this.receiverTypeSource,
        this.importLinkHash,
        this.resolvedMethodLinkHash,
        this.resolutionOutcome,
        bool(this.isDynamicCode),
        this.enclosingMethodLinkHash,
        this.expressionLinkHash,
        this.ownerScopeLinkHash,
        this.ownerModuleLinkHash,
        num(this.startLine),
        num(this.startColumn),
        bool(this.isTypeOnlyTarget),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsCallSiteUniqueHash,
      ],
      JsCallSiteRegistry.ARITY,
      'js_call_site'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'callKind',
        'calleeText',
        'calleeName',
        'receiverText',
        'receiverPosition',
        'receiverExpressionLinkHash',
        'argumentCount',
        'hasSpreadArgument',
        'isOptionalCall',
        'declaredReceiverTypeName',
        'receiverTypeSource',
        'importLinkHash',
        'resolvedMethodLinkHash',
        'resolutionOutcome',
        'isDynamicCode',
        'enclosingMethodLinkHash',
        'expressionLinkHash',
        'ownerScopeLinkHash',
        'ownerModuleLinkHash',
        'startLine',
        'startColumn',
        'isTypeOnlyTarget',
        'isExternal',
        'serviceVersionLinkHash',
        'jsCallSiteUniqueHash',
      ],
      JsCallSiteRegistry.ARITY,
      'js_call_site'
    );
  }
}
