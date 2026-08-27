import { ABSENT, bool, joinHeader, joinRow, keyOf, num, optionalNum, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  TsCallKind,
  TsReceiverKind,
  TsResolutionEvidence,
  TsResolvedTargetKind,
} from '@/enums/typescript/call-sites';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A call site — schema §4.15, 25 columns. 1:1 with its CALL / NEW /
 * TAGGED_TEMPLATE expression, so the key is a pure chain off `ts_expression`.
 *
 * ## The flagship gate lives on this relation
 *
 * 9,627 of 9,627 measured call sites have a `getResolvedSignature` answer, so
 * the closed-world ceiling here is a real 100% and every link is checkable
 * against the reference implementation. Python's 51% receiver-typing gap has no
 * analogue.
 *
 * ## The parser fills columns 12–18 only where resolution is SYNTACTICALLY decidable
 *
 * A call to an imported name with a single signature; a call on a receiver whose
 * declared type is a locally declared class with one method of that name; a
 * `super.m()`. Everything else is left `""` / `UNRESOLVED` for the engine, and
 * that is a deliberate asymmetry rather than modesty: a parser-filled value that
 * disagrees with `getResolvedSignature` is a hard failure, while an unfilled one
 * becomes a measured rate. The parser never guesses, and the guess it declines
 * to make turns into a number rather than a silence.
 *
 * {@link resolvedSignatureLinkHash} points at ONE SIGNATURE, never at a name.
 * 77.6% of overloaded calls resolve to a non-first declaration, so a
 * name-shaped answer is wrong four times in five.
 *
 * {@link isTypeOnlyTarget} must **always** be `false`. A `true` row means a
 * type-only construct reached the call graph, and the gate fails on it by name.
 */
export class TsCallSiteRegistry implements EntityIdentifiable {
  static readonly ARITY = 25;

  readonly callKind: TsCallKind;
  readonly calleeName: string;
  readonly receiverKind: TsReceiverKind;
  readonly receiverExpressionLinkHash: string;
  readonly receiverTypeName: string;
  readonly tsExpressionLinkHash: string;
  readonly tsModuleLinkHash: string;
  readonly callerMethodLinkHash: string;
  readonly callerTypeLinkHash: string;
  readonly argumentCount: number;
  readonly spreadArgumentIndex: number | undefined;
  readonly typeArgumentCount: number;

  private resolvedSignatureLinkHash = ABSENT;
  private resolvedGroupKey = ABSENT;
  private resolvedTargetKind: TsResolvedTargetKind = TsResolvedTargetKind.UNRESOLVED;
  private resolvedOverloadIndex: number | undefined = undefined;
  private overloadCandidateCount = 0;
  private isOverloadResolved = false;
  private resolutionEvidence: TsResolutionEvidence = TsResolutionEvidence.NONE;
  private isAmbientTarget = false;

  readonly isTypeOnlyTarget: boolean;
  readonly startLine: number;
  readonly startColumn: number;
  readonly serviceVersionLinkHash: string;
  private tsCallSiteUniqueHash = ABSENT;

  constructor(props: {
    callKind: TsCallKind;
    calleeName: string;
    receiverKind: TsReceiverKind;
    receiverExpressionLinkHash: string;
    receiverTypeName: string;
    tsExpressionLinkHash: string;
    tsModuleLinkHash: string;
    callerMethodLinkHash: string;
    callerTypeLinkHash: string;
    argumentCount: number;
    spreadArgumentIndex: number | undefined;
    typeArgumentCount: number;
    isTypeOnlyTarget: boolean;
    startLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.callKind = props.callKind;
    this.calleeName = props.calleeName;
    this.receiverKind = props.receiverKind;
    this.receiverExpressionLinkHash = props.receiverExpressionLinkHash;
    this.receiverTypeName = props.receiverTypeName;
    this.tsExpressionLinkHash = props.tsExpressionLinkHash;
    this.tsModuleLinkHash = props.tsModuleLinkHash;
    this.callerMethodLinkHash = props.callerMethodLinkHash;
    this.callerTypeLinkHash = props.callerTypeLinkHash;
    this.argumentCount = props.argumentCount;
    this.spreadArgumentIndex = props.spreadArgumentIndex;
    this.typeArgumentCount = props.typeArgumentCount;
    this.isTypeOnlyTarget = props.isTypeOnlyTarget;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `TS_CALL_SITE_md5(tsExpressionLinkHash)` — a pure chain; a call site IS an expression. */
  generateHash(): void {
    this.tsCallSiteUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_CALL_SITE,
      keyOf(this.tsExpressionLinkHash)
    );
  }

  getHash(): string {
    return this.tsCallSiteUniqueHash;
  }

  /**
   * Records a target the parser can defend from syntax.
   *
   * `overloadCandidateCount` is the size of the set that was CONSIDERED, so a
   * count of 1 with a filled target means there was nothing to choose between —
   * and a count above 1 with `isOverloadResolved = false` means the parser saw
   * a real overload set and declined to pick, which is the honest outcome when
   * choosing needs argument types.
   */
  setResolution(props: {
    resolvedSignatureLinkHash: string;
    resolvedGroupKey: string;
    resolvedTargetKind: TsResolvedTargetKind;
    resolvedOverloadIndex: number | undefined;
    overloadCandidateCount: number;
    isOverloadResolved: boolean;
    resolutionEvidence: TsResolutionEvidence;
    isAmbientTarget: boolean;
  }): void {
    this.resolvedSignatureLinkHash = props.resolvedSignatureLinkHash;
    this.resolvedGroupKey = props.resolvedGroupKey;
    this.resolvedTargetKind = props.resolvedTargetKind;
    this.resolvedOverloadIndex = props.resolvedOverloadIndex;
    this.overloadCandidateCount = props.overloadCandidateCount;
    this.isOverloadResolved = props.isOverloadResolved;
    this.resolutionEvidence = props.resolutionEvidence;
    this.isAmbientTarget = props.isAmbientTarget;
  }

  /**
   * Records that the target is knowably outside this analysis.
   *
   * Distinct from leaving the row `UNRESOLVED`: `LIB_SIGNATURE` says the call
   * has a target and it lives in `lib_ts_*`, which the closed-world gate counts
   * as CLOSED. `UNRESOLVED` says the parser does not know, which it does not.
   */
  setExternalTarget(kind: TsResolvedTargetKind, evidence: TsResolutionEvidence): void {
    this.resolvedTargetKind = kind;
    this.resolutionEvidence = evidence;
    this.isAmbientTarget = true;
  }

  getResolvedTargetKind(): TsResolvedTargetKind {
    return this.resolvedTargetKind;
  }

  getResolvedSignatureLinkHash(): string {
    return this.resolvedSignatureLinkHash;
  }

  getEntryCombined(): string {
    return `ts_call_site[kind=${this.callKind}, callee=${this.calleeName}, receiver=${this.receiverKind}, target=${this.resolvedTargetKind}, hash=${this.tsCallSiteUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        this.callKind,
        text(this.calleeName),
        this.receiverKind,
        this.receiverExpressionLinkHash,
        text(this.receiverTypeName),
        this.tsExpressionLinkHash,
        this.tsModuleLinkHash,
        this.callerMethodLinkHash,
        this.callerTypeLinkHash,
        num(this.argumentCount),
        optionalNum(this.spreadArgumentIndex),
        num(this.typeArgumentCount),
        this.resolvedSignatureLinkHash,
        this.resolvedGroupKey,
        this.resolvedTargetKind,
        optionalNum(this.resolvedOverloadIndex),
        num(this.overloadCandidateCount),
        bool(this.isOverloadResolved),
        this.resolutionEvidence,
        bool(this.isTypeOnlyTarget),
        bool(this.isAmbientTarget),
        num(this.startLine),
        num(this.startColumn),
        this.serviceVersionLinkHash,
        this.tsCallSiteUniqueHash,
      ],
      TsCallSiteRegistry.ARITY,
      'ts_call_site'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'callKind', 'calleeName', 'receiverKind', 'receiverExpressionLinkHash',
        'receiverTypeName', 'tsExpressionLinkHash', 'tsModuleLinkHash', 'callerMethodLinkHash',
        'callerTypeLinkHash', 'argumentCount', 'spreadArgumentIndex', 'typeArgumentCount',
        'resolvedSignatureLinkHash', 'resolvedGroupKey', 'resolvedTargetKind',
        'resolvedOverloadIndex', 'overloadCandidateCount', 'isOverloadResolved',
        'resolutionEvidence', 'isTypeOnlyTarget', 'isAmbientTarget', 'startLine', 'startColumn',
        'serviceVersionLinkHash', 'tsCallSiteUniqueHash',
      ],
      TsCallSiteRegistry.ARITY,
      'ts_call_site'
    );
  }
}
