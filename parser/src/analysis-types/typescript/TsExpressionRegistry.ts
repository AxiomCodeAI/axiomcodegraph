import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  TsEdgeRole,
  TsExpressionKind,
  TsExpressionOwnerKind,
  TsReferencedEntityKind,
  TsRootContext,
} from '@/enums/typescript/expressions';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * An expression AST node — schema §4.14, 34 columns. The spine of call resolution.
 *
 * Positions 0–24 are byte-for-byte `java_expression` 0–24, so `expr_kind`,
 * `expr_child`, `expr_owner` and the whole call-resolution projection port as
 * renames. The appended columns carry what TypeScript adds: optional chaining,
 * `as`/`satisfies`, spread, and per-reference resolution.
 *
 * ## Three columns that exist to stop a specific wrong answer
 *
 * {@link assertedTypeReferenceLinkHash} is the ONLY expression-to-type edge in
 * the schema, and it is deliberately a **type** FK: `x as Foo` mentions a type
 * from a value position, and if that edge landed in the call graph every
 * assertion would become a phantom call target. Because it points into
 * `ts_type_reference`, no call-graph rule can cross it.
 *
 * {@link isSpread} marks where positional argument flow is **provably**
 * imprecise. `f(...args)` does not have knowable argument positions, and a
 * fact base that silently renumbers the remaining arguments is wrong in a way
 * nothing downstream can detect. Marking it converts a silent error into a
 * known limit.
 *
 * {@link isTypeOnlyReachable} should always be `false`. It is a tripwire for
 * §3.3, not a feature: a `true` row means a type-only construct produced an
 * expression, and the gate fails on it by name.
 */
export class TsExpressionRegistry implements EntityIdentifiable {
  static readonly ARITY = 34;

  readonly kind: TsExpressionKind;
  readonly edgeRole: TsEdgeRole;
  readonly rootContext: TsRootContext;
  readonly expressionOwnerKind: TsExpressionOwnerKind;
  readonly tsTypeLinkHash: string;
  readonly expressionOwnerHash: string;
  readonly parentExpressionHash: string;
  readonly position: number;
  readonly depth: number;
  readonly literalType: string;
  readonly literalValue: string;
  /** Parity slot with `java_expression` 11; TypeScript has no method reference `::`. */
  private readonly methodReferenceKind = ABSENT;
  readonly unaryFixity: string;
  readonly operatorString: string;
  private referencedEntityKind: TsReferencedEntityKind = TsReferencedEntityKind.UNKNOWN;
  private referencedEntityHash = ABSENT;
  private anonymousDeclarationHash = ABSENT;
  private potentialQualifiedName = ABSENT;
  private isAmbiguous = false;
  readonly returnStatementIndex: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly tsModuleLinkHash: string;
  readonly isOptionalChain: boolean;
  readonly isNonNullAsserted: boolean;
  private assertedTypeReferenceLinkHash = ABSENT;
  readonly isSpread: boolean;
  readonly argumentCount: number;
  readonly typeArgumentCount: number;
  readonly isTypeOnlyReachable: boolean;
  readonly serviceVersionLinkHash: string;
  private tsExpressionUniqueHash = ABSENT;

  constructor(props: {
    kind: TsExpressionKind;
    edgeRole: TsEdgeRole;
    rootContext: TsRootContext;
    expressionOwnerKind: TsExpressionOwnerKind;
    tsTypeLinkHash: string;
    expressionOwnerHash: string;
    parentExpressionHash: string;
    position: number;
    depth: number;
    literalType: string;
    literalValue: string;
    unaryFixity: string;
    operatorString: string;
    returnStatementIndex: number;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    tsModuleLinkHash: string;
    isOptionalChain: boolean;
    isNonNullAsserted: boolean;
    isSpread: boolean;
    argumentCount: number;
    typeArgumentCount: number;
    isTypeOnlyReachable: boolean;
    serviceVersionLinkHash: string;
  }) {
    this.kind = props.kind;
    this.edgeRole = props.edgeRole;
    this.rootContext = props.rootContext;
    this.expressionOwnerKind = props.expressionOwnerKind;
    this.tsTypeLinkHash = props.tsTypeLinkHash;
    this.expressionOwnerHash = props.expressionOwnerHash;
    this.parentExpressionHash = props.parentExpressionHash;
    this.position = props.position;
    this.depth = props.depth;
    this.literalType = props.literalType;
    this.literalValue = props.literalValue;
    this.unaryFixity = props.unaryFixity;
    this.operatorString = props.operatorString;
    this.returnStatementIndex = props.returnStatementIndex;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.endLine = props.endLine;
    this.endColumn = props.endColumn;
    this.tsModuleLinkHash = props.tsModuleLinkHash;
    this.isOptionalChain = props.isOptionalChain;
    this.isNonNullAsserted = props.isNonNullAsserted;
    this.isSpread = props.isSpread;
    this.argumentCount = props.argumentCount;
    this.typeArgumentCount = props.typeArgumentCount;
    this.isTypeOnlyReachable = props.isTypeOnlyReachable;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `TS_EXPRESSION_md5(tsModuleLinkHash ‖ expressionOwnerHash ‖ parentExpressionHash ‖ edgeRole ‖ position ‖ startLine ‖ startColumn)`
   *
   * `edgeRole` is in the key alongside `position` because two children of one
   * parent can share an index in different roles — a binary node's left operand
   * and right operand are both position 0 of their own role.
   */
  generateHash(): void {
    this.tsExpressionUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_EXPRESSION,
      keyOf(
        this.tsModuleLinkHash,
        this.expressionOwnerHash,
        this.parentExpressionHash,
        this.edgeRole,
        this.position,
        this.startLine,
        this.startColumn
      )
    );
  }

  getHash(): string {
    return this.tsExpressionUniqueHash;
  }

  /**
   * Records what this identifier reference resolved to.
   *
   * The oracle checks this against `getSymbolAtLocation`, so an unfilled row is
   * a measured gap and a wrongly filled one is a hard failure. Those are not the
   * same cost, which is why the parser fills it only from syntax it can defend.
   */
  setReference(kind: TsReferencedEntityKind, hash: string, potentialQualifiedName: string): void {
    this.referencedEntityKind = kind;
    this.referencedEntityHash = hash;
    this.potentialQualifiedName = potentialQualifiedName;
  }

  getReferencedEntityHash(): string {
    return this.referencedEntityHash;
  }

  getReferencedEntityKind(): TsReferencedEntityKind {
    return this.referencedEntityKind;
  }

  /** Two candidate declarations matched and syntax cannot choose. Reported, never guessed. */
  markAmbiguous(): void {
    this.isAmbiguous = true;
  }

  /**
   * The DECLARATION this expression introduces — c16, polymorphic on {@link kind}.
   *
   * `ts_type` for a `CLASS_EXPRESSION`; `ts_method` for an `ARROW_FUNCTION` or a
   * `FUNCTION_EXPRESSION`. Widened from Java's `anonymousTypeHash`, which covered
   * only the class case: an arrow had a `ts_method` row and an expression row
   * with no FK between them, so an IIFE's target was reachable only by matching
   * positions — and a position match is exactly the kind of join that breaks
   * silently when two nodes share an offset.
   */
  setAnonymousDeclarationHash(hash: string): void {
    this.anonymousDeclarationHash = hash;
  }

  getAnonymousDeclarationHash(): string {
    return this.anonymousDeclarationHash;
  }

  setAssertedTypeReferenceLinkHash(hash: string): void {
    this.assertedTypeReferenceLinkHash = hash;
  }

  getEntryCombined(): string {
    return `ts_expression[kind=${this.kind}, role=${this.edgeRole}, pos=${this.position}, line=${this.startLine}, hash=${this.tsExpressionUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        this.kind,
        this.edgeRole,
        this.rootContext,
        this.expressionOwnerKind,
        this.tsTypeLinkHash,
        this.expressionOwnerHash,
        this.parentExpressionHash,
        num(this.position),
        num(this.depth),
        this.literalType,
        text(this.literalValue),
        this.methodReferenceKind,
        this.unaryFixity,
        text(this.operatorString),
        this.referencedEntityKind,
        this.referencedEntityHash,
        this.anonymousDeclarationHash,
        text(this.potentialQualifiedName),
        bool(this.isAmbiguous),
        num(this.returnStatementIndex),
        num(this.startLine),
        num(this.startColumn),
        num(this.endLine),
        num(this.endColumn),
        this.tsModuleLinkHash,
        bool(this.isOptionalChain),
        bool(this.isNonNullAsserted),
        this.assertedTypeReferenceLinkHash,
        bool(this.isSpread),
        num(this.argumentCount),
        num(this.typeArgumentCount),
        bool(this.isTypeOnlyReachable),
        this.serviceVersionLinkHash,
        this.tsExpressionUniqueHash,
      ],
      TsExpressionRegistry.ARITY,
      'ts_expression'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'kind', 'edgeRole', 'rootContext', 'expressionOwnerKind', 'tsTypeLinkHash',
        'expressionOwnerHash', 'parentExpressionHash', 'position', 'depth', 'literalType',
        'literalValue', 'methodReferenceKind', 'unaryFixity', 'operatorString',
        'referencedEntityKind', 'referencedEntityHash', 'anonymousDeclarationHash',
        'potentialQualifiedName', 'isAmbiguous', 'returnStatementIndex', 'startLine',
        'startColumn', 'endLine', 'endColumn', 'tsModuleLinkHash', 'isOptionalChain',
        'isNonNullAsserted', 'assertedTypeReferenceLinkHash', 'isSpread', 'argumentCount',
        'typeArgumentCount', 'isTypeOnlyReachable', 'serviceVersionLinkHash',
        'tsExpressionUniqueHash',
      ],
      TsExpressionRegistry.ARITY,
      'ts_expression'
    );
  }
}
