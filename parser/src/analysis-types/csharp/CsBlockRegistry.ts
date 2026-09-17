import { ABSENT, bool, commaList, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CsBlockKind } from '@/enums/csharp/blocks';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A block — schema §3.19, **23 columns**.
 *
 * ## A block is where a LOCAL lives
 *
 * Scope is what decides whether two `x`s are one binding, and without blocks the
 * parser can say a variable exists but not where it is visible. Shadowing then
 * becomes unanswerable, and an engine either merges two locals or splits one.
 *
 * ## `LABELED` exists because its absence was measured
 *
 * TypeScript emitted `FOR` for `outer: for (…)` and dropped the label. The loop
 * was present, so no count saw it; the ENUM AUDIT found it, because the value
 * was declared and never emitted. `goto outer` then had no target to name.
 *
 * ## `catchTypeNames` is an exception EDGE, as written
 *
 * A `catch (IOException e)` says which exceptions stop here. The parser records
 * the names and resolves none of them — whether `IOException` is the type an
 * engine thinks it is depends on the `using` set, and that is the engine's.
 */
export class CsBlockRegistry implements EntityIdentifiable {
  static readonly ARITY = 23;
  static readonly RELATION = 'cs_block';

  readonly blockKind: CsBlockKind;
  readonly order: number;
  readonly nestingDepth: number;
  readonly csTypeLinkHash: string;
  readonly csMethodLinkHash: string;
  readonly csModuleLinkHash: string;
  readonly methodOwnerHash: string;
  readonly parentContainerHash: string;
  private tryStatementHash = ABSENT;
  readonly catchTypeNames: readonly string[];
  readonly resourceCount: number;
  private conditionExpressionLinkHash = ABSENT;
  readonly switchSectionIndex: number;
  readonly labelName: string;
  readonly isUnsafe: boolean;
  readonly isChecked: boolean;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly endColumn: number;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csBlockUniqueHash = ABSENT;

  constructor(props: {
    blockKind: CsBlockKind;
    order: number;
    nestingDepth: number;
    csTypeLinkHash: string;
    csMethodLinkHash: string;
    csModuleLinkHash: string;
    methodOwnerHash: string;
    parentContainerHash: string;
    catchTypeNames: readonly string[];
    resourceCount: number;
    switchSectionIndex: number;
    labelName: string;
    isUnsafe: boolean;
    isChecked: boolean;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.blockKind = props.blockKind;
    this.order = props.order;
    this.nestingDepth = props.nestingDepth;
    this.csTypeLinkHash = props.csTypeLinkHash;
    this.csMethodLinkHash = props.csMethodLinkHash;
    this.csModuleLinkHash = props.csModuleLinkHash;
    this.methodOwnerHash = props.methodOwnerHash;
    this.parentContainerHash = props.parentContainerHash;
    this.catchTypeNames = props.catchTypeNames;
    this.resourceCount = props.resourceCount;
    this.switchSectionIndex = props.switchSectionIndex;
    this.labelName = props.labelName;
    this.isUnsafe = props.isUnsafe;
    this.isChecked = props.isChecked;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.startColumn = props.startColumn;
    this.endColumn = props.endColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_BLOCK_md5(csMethodLinkHash ‖ order ‖ blockKind ‖ startLine ‖ startColumn)`
   *
   * `order` is the visit ordinal within the owning method. `if (a) { } else { }`
   * puts two blocks on one line at different columns; `while (x) { }` in a loop
   * body reached twice is one block. Both need the ordinal to be stable, so it
   * is a walk counter and not a source position.
   */
  /**
   * The owning method's hash, always. Top-level statements once had no
   * method — the compiler's `Program.<Main>$` was thought to exist in no
   * source file — so this fell back to the module hash to keep two
   * `Program.cs` files apart (duplicates measured at 6 per relation across
   * 5,773 files of one stratum). Ruling v1.6 §4.0.3 answered it: `<Main>$` IS
   * a method row, positioned at the compilation unit, so every block and
   * local has a method owner and the fallback is gone. An empty owner here is
   * a defect upstream, and the integrity check is what finds it.
   */
  private ownerKeyComponent(): string {
    return this.csMethodLinkHash;
  }

  generateHash(): void {
    this.csBlockUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_BLOCK,
      keyOf(
        this.ownerKeyComponent(),
        this.order,
        this.blockKind,
        this.startLine,
        this.startColumn
      )
    );
  }

  getHash(): string {
    return this.csBlockUniqueHash;
  }

  setTryStatementHash(hash: string): void {
    this.tryStatementHash = hash;
  }

  setConditionExpressionLinkHash(hash: string): void {
    this.conditionExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return (
      `cs_block[kind=${this.blockKind}, order=${this.order}, depth=${this.nestingDepth}, ` +
      `label=${this.labelName}, hash=${this.csBlockUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        this.blockKind,
        num(this.order),
        num(this.nestingDepth),
        this.csTypeLinkHash,
        this.csMethodLinkHash,
        this.csModuleLinkHash,
        this.methodOwnerHash,
        this.parentContainerHash,
        this.tryStatementHash,
        // A LIST, not a set: `catch (A) catch (B)` is ordered, and the FIRST
        // match wins at runtime. Sorting them would lose which one catches.
        text(commaList(this.catchTypeNames)),
        num(this.resourceCount),
        this.conditionExpressionLinkHash,
        num(this.switchSectionIndex),
        text(this.labelName),
        bool(this.isUnsafe),
        bool(this.isChecked),
        num(this.startLine),
        num(this.endLine),
        num(this.startColumn),
        num(this.endColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csBlockUniqueHash,
      ],
      CsBlockRegistry.ARITY,
      CsBlockRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'blockKind', 'order', 'nestingDepth', 'csTypeLinkHash', 'csMethodLinkHash',
        'csModuleLinkHash', 'methodOwnerHash', 'parentContainerHash', 'tryStatementHash',
        'catchTypeNames', 'resourceCount', 'conditionExpressionLinkHash',
        'switchSectionIndex', 'labelName', 'isUnsafe', 'isChecked', 'startLine', 'endLine',
        'startColumn', 'endColumn', 'isExternal', 'serviceVersionLinkHash',
        'csBlockUniqueHash',
      ],
      CsBlockRegistry.ARITY,
      CsBlockRegistry.RELATION
    );
  }
}
