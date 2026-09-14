import { ABSENT, commaSet, joinHeader, joinRow, keyOf, num, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { TsBlockKind } from '@/enums/typescript/blocks';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A statement block — schema §4.16, 21 columns. Positions 0–17 mirror
 * `java_block` 0–17.
 *
 * Blocks earn their relation twice here. Caller attribution, as in Java — and
 * as the **lexical scope of a `let`/`const`**, which is what lets `ts_variable`
 * exist without a `ts_scope` relation. OQ-6 measured that: 34,798 identifier
 * references, and the `ts_block -> ts_method -> ts_type -> ts_module` chain
 * reaches every one of them with zero unreachable. That chain is only unbroken
 * if these rows exist, so emitting them is what makes "no `ts_scope`" true
 * rather than merely asserted.
 *
 * {@link caughtExceptionTypes} is near-always `""` and that is not a gap: a
 * TypeScript `catch` binding is `unknown` (or `any`) and cannot be typed, so
 * unlike Java there is nothing to record. The column is kept for parity, not
 * for information.
 */
export class TsBlockRegistry implements EntityIdentifiable {
  static readonly ARITY = 21;

  readonly blockKind: TsBlockKind;
  readonly order: number;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly nestingDepth: number;
  readonly tsTypeLinkHash: string;
  readonly methodOwnerHash: string;
  readonly parentContainerHash: string;
  readonly tryStatementHash: string;
  readonly resourceCount: number;
  readonly caughtExceptionTypes: ReadonlySet<string>;
  readonly ownerTypeName: string;
  readonly ownerQualifiedName: string;
  readonly ownerMethodName: string;
  private conditionExpressionLinkHash = ABSENT;
  readonly tsModuleLinkHash: string;
  readonly serviceVersionLinkHash: string;
  private tsBlockUniqueHash = ABSENT;

  constructor(props: {
    blockKind: TsBlockKind;
    order: number;
    filePath: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
    nestingDepth: number;
    tsTypeLinkHash: string;
    methodOwnerHash: string;
    parentContainerHash: string;
    tryStatementHash: string;
    resourceCount: number;
    caughtExceptionTypes: ReadonlySet<string>;
    ownerTypeName: string;
    ownerQualifiedName: string;
    ownerMethodName: string;
    tsModuleLinkHash: string;
    serviceVersionLinkHash: string;
  }) {
    this.blockKind = props.blockKind;
    this.order = props.order;
    this.filePath = props.filePath;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.startColumn = props.startColumn;
    this.endColumn = props.endColumn;
    this.nestingDepth = props.nestingDepth;
    this.tsTypeLinkHash = props.tsTypeLinkHash;
    this.methodOwnerHash = props.methodOwnerHash;
    this.parentContainerHash = props.parentContainerHash;
    this.tryStatementHash = props.tryStatementHash;
    this.resourceCount = props.resourceCount;
    this.caughtExceptionTypes = props.caughtExceptionTypes;
    this.ownerTypeName = props.ownerTypeName;
    this.ownerQualifiedName = props.ownerQualifiedName;
    this.ownerMethodName = props.ownerMethodName;
    this.tsModuleLinkHash = props.tsModuleLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `TS_BLOCK_md5(methodOwnerHash ‖ parentContainerHash ‖ blockKind ‖ order ‖ startLine ‖ startColumn)` */
  generateHash(): void {
    this.tsBlockUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_BLOCK,
      keyOf(
        this.methodOwnerHash,
        this.parentContainerHash,
        this.blockKind,
        this.order,
        this.startLine,
        this.startColumn
      )
    );
  }

  getHash(): string {
    return this.tsBlockUniqueHash;
  }

  /**
   * The guard expression, so the engine can narrow on it.
   *
   * `typeof x === "string"`, `x instanceof C` and a type-predicate call (440
   * predicates measured) all reach the receiver through this FK. Back-patched
   * because expressions are extracted after the block tree exists.
   */
  setConditionExpressionLinkHash(hash: string): void {
    this.conditionExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return `ts_block[kind=${this.blockKind}, order=${this.order}, line=${this.startLine}, hash=${this.tsBlockUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        this.blockKind,
        num(this.order),
        text(this.filePath),
        num(this.startLine),
        num(this.endLine),
        num(this.startColumn),
        num(this.endColumn),
        num(this.nestingDepth),
        this.tsTypeLinkHash,
        this.methodOwnerHash,
        this.parentContainerHash,
        this.tryStatementHash,
        num(this.resourceCount),
        commaSet(this.caughtExceptionTypes),
        text(this.ownerTypeName),
        text(this.ownerQualifiedName),
        text(this.ownerMethodName),
        this.conditionExpressionLinkHash,
        this.tsModuleLinkHash,
        this.serviceVersionLinkHash,
        this.tsBlockUniqueHash,
      ],
      TsBlockRegistry.ARITY,
      'ts_block'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'blockKind', 'order', 'filePath', 'startLine', 'endLine', 'startColumn', 'endColumn',
        'nestingDepth', 'tsTypeLinkHash', 'methodOwnerHash', 'parentContainerHash',
        'tryStatementHash', 'resourceCount', 'caughtExceptionTypes', 'ownerTypeName',
        'ownerQualifiedName', 'ownerMethodName', 'conditionExpressionLinkHash',
        'tsModuleLinkHash', 'serviceVersionLinkHash', 'tsBlockUniqueHash',
      ],
      TsBlockRegistry.ARITY,
      'ts_block'
    );
  }
}
