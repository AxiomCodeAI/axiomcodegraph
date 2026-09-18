import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CsCallKind, CsReceiverKind } from '@/enums/csharp/call-sites';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One call — schema §3.17, **22 columns**.
 *
 * ## A pure 1:1 chain off `cs_expression`
 *
 * `csExpressionLinkHash` is the ONLY key component, because **a call site IS an
 * expression** seen from a different angle. That is a gate as well as a design:
 * §8 asserts 1:1 between call sites and their expression rows, and a key with
 * anything else in it could satisfy the count while pointing somewhere else.
 *
 * ## `isExtensionCallSyntax` was DELETED — schema v1.4
 *
 * It recorded the SHAPE `a.B()`, and cs-corpus measured it across 782,388 call
 * sites: that is `callKind == METHOD_CALL`, information an existing column
 * already carries. A column that cannot vary is worse than absent, because a
 * consumer reads it as evidence. The half the engine actually joins against is
 * `cs_method.isExtension` on the callee; `EXTENSION_REDUCED_CALL` stays
 * reserved because whether the reduction applies is resolution.
 *
 * Deleting a column reorders every column after it, which is the one thing the
 * freeze forbids — so this was taken by ruling before any golden file exists,
 * and the relation is **21 columns** from here on.
 *
 * ## `outArgumentCount` is dataflow, not bookkeeping
 *
 * An `out` argument is a **second return channel**. `int.TryParse(s, out var n)`
 * returns a bool and produces an int, and an engine modelling only return values
 * loses that edge. `TryParse` is in every C# codebase written.
 */
export class CsCallSiteRegistry implements EntityIdentifiable {
  static readonly ARITY = 21;
  static readonly RELATION = 'cs_call_site';

  readonly callKind: CsCallKind;
  readonly calleeName: string;
  readonly receiverKind: CsReceiverKind;
  private receiverExpressionLinkHash: string;
  readonly receiverTypeName: string;
  readonly csExpressionLinkHash: string;
  readonly csModuleLinkHash: string;
  readonly callerMethodLinkHash: string;
  readonly callerTypeLinkHash: string;
  readonly argumentCount: number;
  readonly namedArgumentCount: number;
  readonly typeArgumentCount: number;
  readonly refArgumentCount: number;
  readonly outArgumentCount: number;
  readonly isConditional: boolean;
  readonly isQueryDesugarCandidate: boolean;
  readonly startLine: number;
  readonly startColumn: number;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csCallSiteUniqueHash = ABSENT;

  constructor(props: {
    callKind: CsCallKind;
    calleeName: string;
    receiverKind: CsReceiverKind;
    receiverExpressionLinkHash: string;
    receiverTypeName: string;
    csExpressionLinkHash: string;
    csModuleLinkHash: string;
    callerMethodLinkHash: string;
    callerTypeLinkHash: string;
    argumentCount: number;
    namedArgumentCount: number;
    typeArgumentCount: number;
    refArgumentCount: number;
    outArgumentCount: number;
    isConditional: boolean;
    isQueryDesugarCandidate: boolean;
    startLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.callKind = props.callKind;
    this.calleeName = props.calleeName;
    this.receiverKind = props.receiverKind;
    this.receiverExpressionLinkHash = props.receiverExpressionLinkHash;
    this.receiverTypeName = props.receiverTypeName;
    this.csExpressionLinkHash = props.csExpressionLinkHash;
    this.csModuleLinkHash = props.csModuleLinkHash;
    this.callerMethodLinkHash = props.callerMethodLinkHash;
    this.callerTypeLinkHash = props.callerTypeLinkHash;
    this.argumentCount = props.argumentCount;
    this.namedArgumentCount = props.namedArgumentCount;
    this.typeArgumentCount = props.typeArgumentCount;
    this.refArgumentCount = props.refArgumentCount;
    this.outArgumentCount = props.outArgumentCount;
    this.isConditional = props.isConditional;
    this.isQueryDesugarCandidate = props.isQueryDesugarCandidate;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_CALL_SITE_md5(csExpressionLinkHash)` — a pure chain.
   *
   * Nothing else is in it, deliberately. A call site is an expression, so its
   * identity IS the expression's, and adding a component would let the 1:1 gate
   * pass while the two relations disagreed about which expression a call is.
   */
  generateHash(): void {
    this.csCallSiteUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_CALL_SITE,
      keyOf(this.csExpressionLinkHash)
    );
  }

  getHash(): string {
    return this.csCallSiteUniqueHash;
  }

  /**
   * The RECEIVER child's row, set once that row exists. The call site is
   * minted with its invocation row, before the invocation's children are
   * walked, so the receiver's hash is a second-pass fill keyed off the
   * expression — it was left empty for exactly that reason, and then never
   * filled: a declared hop nobody wrote.
   */
  setReceiverExpressionLinkHash(hash: string): void {
    this.receiverExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return (
      `cs_call_site[kind=${this.callKind}, callee=${this.calleeName}, ` +
      `receiver=${this.receiverKind}, args=${this.argumentCount}, ` +
      `hash=${this.csCallSiteUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        this.callKind,
        text(this.calleeName),
        this.receiverKind,
        this.receiverExpressionLinkHash,
        text(this.receiverTypeName),
        this.csExpressionLinkHash,
        this.csModuleLinkHash,
        this.callerMethodLinkHash,
        this.callerTypeLinkHash,
        num(this.argumentCount),
        num(this.namedArgumentCount),
        num(this.typeArgumentCount),
        num(this.refArgumentCount),
        num(this.outArgumentCount),
        bool(this.isConditional),
        bool(this.isQueryDesugarCandidate),
        num(this.startLine),
        num(this.startColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csCallSiteUniqueHash,
      ],
      CsCallSiteRegistry.ARITY,
      CsCallSiteRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'callKind', 'calleeName', 'receiverKind', 'receiverExpressionLinkHash',
        'receiverTypeName', 'csExpressionLinkHash', 'csModuleLinkHash',
        'callerMethodLinkHash', 'callerTypeLinkHash', 'argumentCount',
        'namedArgumentCount', 'typeArgumentCount', 'refArgumentCount', 'outArgumentCount',
        'isConditional', 'isQueryDesugarCandidate', 'startLine',
        'startColumn', 'isExternal', 'serviceVersionLinkHash', 'csCallSiteUniqueHash',
      ],
      CsCallSiteRegistry.ARITY,
      CsCallSiteRegistry.RELATION
    );
  }
}
