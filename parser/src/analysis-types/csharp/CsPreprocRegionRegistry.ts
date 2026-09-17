import { ABSENT, bool, commaList, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  CsActivationSource,
  CsPreprocRegionKind,
  CsRegionShape,
} from '@/enums/csharp/preproc';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A conditional-compilation region — schema §3.22, **15 columns**.
 *
 * ## The audit trail for a decision the fact base cannot otherwise justify
 *
 * Every other relation records what the parser EMITTED. This one records what
 * it emitted FROM. A `#if NET8_0` chain means one emission takes one branch and
 * the other branches are not in the program — their calls are not edges, their
 * types are not declared. That is the right answer and it is unfalsifiable
 * without a row saying which branch was taken and why.
 *
 * `activationSource` is what makes it auditable rather than merely recorded.
 * `isActive = false` has three unrelated causes that look identical in the
 * data: the symbol was not defined, an earlier branch already won, or the
 * condition could not be evaluated at all. Only the third is a limitation of
 * this parser, and nothing else lets an auditor count it.
 *
 * ## `FRAGMENT` is 16.9% of regions and gets a row with no children
 *
 * A region splitting a base list, an `else` chain or a parameter list holds no
 * independently parseable construct. Recording it as `FRAGMENT` with no child
 * rows is the honest terminal; silence would be indistinguishable from an empty
 * region, and a sixth of all regions is not a rounding error.
 */
export class CsPreprocRegionRegistry implements EntityIdentifiable {
  static readonly ARITY = 15;
  static readonly RELATION = 'cs_preproc_region';

  readonly csModuleLinkHash: string;
  readonly regionKind: CsPreprocRegionKind;
  readonly conditionText: string;
  readonly conditionSymbols: readonly string[];
  readonly isActive: boolean;
  readonly regionShape: CsRegionShape;
  readonly branchIndex: number;
  readonly branchCount: number;
  readonly activationSource: CsActivationSource;
  readonly parentRegionLinkHash: string;
  readonly startLine: number;
  readonly endLine: number;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csPreprocRegionUniqueHash = ABSENT;

  constructor(props: {
    csModuleLinkHash: string;
    regionKind: CsPreprocRegionKind;
    conditionText: string;
    conditionSymbols: readonly string[];
    isActive: boolean;
    regionShape: CsRegionShape;
    branchIndex: number;
    branchCount: number;
    activationSource: CsActivationSource;
    parentRegionLinkHash: string;
    startLine: number;
    endLine: number;
    serviceVersionLinkHash: string;
  }) {
    this.csModuleLinkHash = props.csModuleLinkHash;
    this.regionKind = props.regionKind;
    this.conditionText = props.conditionText;
    this.conditionSymbols = props.conditionSymbols;
    this.isActive = props.isActive;
    this.regionShape = props.regionShape;
    this.branchIndex = props.branchIndex;
    this.branchCount = props.branchCount;
    this.activationSource = props.activationSource;
    this.parentRegionLinkHash = props.parentRegionLinkHash;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_PREPROC_REGION_md5(csModuleLinkHash ‖ startLine ‖ endLine ‖
   * conditionText)` — schema §1.
   *
   * The module hash carries the target framework and the resolved symbol set,
   * so ONE `#if` chain under two frameworks is two sets of region rows with
   * different keys and different `isActive`. That is the point: the branch
   * taken is a property of the emission, not of the file.
   */
  generateHash(): void {
    this.csPreprocRegionUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_PREPROC_REGION,
      keyOf(this.csModuleLinkHash, this.startLine, this.endLine, this.conditionText)
    );
  }

  getHash(): string {
    return this.csPreprocRegionUniqueHash;
  }

  getEntryCombined(): string {
    return (
      `cs_preproc_region[kind=${this.regionKind}, active=${this.isActive}, ` +
      `shape=${this.regionShape}, why=${this.activationSource}, ` +
      `branch=${this.branchIndex}/${this.branchCount}, ` +
      `hash=${this.csPreprocRegionUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        this.csModuleLinkHash,
        this.regionKind,
        text(this.conditionText),
        // A LIST, in the order they are written. `A && B` and `B && A` are the
        // same condition, but the text column already carries the spelling and
        // reordering here would make the two columns disagree about one thing.
        text(commaList(this.conditionSymbols)),
        bool(this.isActive),
        this.regionShape,
        num(this.branchIndex),
        num(this.branchCount),
        this.activationSource,
        this.parentRegionLinkHash,
        num(this.startLine),
        num(this.endLine),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csPreprocRegionUniqueHash,
      ],
      CsPreprocRegionRegistry.ARITY,
      CsPreprocRegionRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'csModuleLinkHash', 'regionKind', 'conditionText', 'conditionSymbols', 'isActive',
        'regionShape', 'branchIndex', 'branchCount', 'activationSource',
        'parentRegionLinkHash', 'startLine', 'endLine',
        'isExternal', 'serviceVersionLinkHash', 'csPreprocRegionUniqueHash',
      ],
      CsPreprocRegionRegistry.ARITY,
      CsPreprocRegionRegistry.RELATION
    );
  }
}
