import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { TsExportedEntityKind, TsExportKind } from '@/enums/typescript/exports';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * An export or re-export — schema §4.13, 21 columns. **No Java analogue.**
 *
 * Java visibility is a modifier and there is no re-export, so there is nothing
 * to port. TypeScript needs the relation because **a re-export chain is the only
 * path from an importer to the real declaration**, and the measured corpus has
 * 1,251 export declarations, 86 `export *` and 74 `import x = require()`.
 *
 * Without it, Path 2 stops at the barrel: `import { Thing } from "./index"`
 * resolves to a module that declares nothing and merely forwards.
 *
 * ## `EXPORT_STAR` is a real soundness surface
 *
 * It exports a set this row cannot name — the engine expands it by joining the
 * source module's exports. That is the same shape as Python's `import *`, at 86
 * sites rather than 22, so it is not an edge case here.
 */
export class TsExportRegistry implements EntityIdentifiable {
  static readonly ARITY = 21;

  readonly exportedName: string;
  readonly localName: string;
  readonly exportKind: TsExportKind;
  readonly isTypeOnly: boolean;
  readonly isDefault: boolean;
  readonly isReExport: boolean;
  readonly sourceSpecifier: string;
  readonly tsModuleLinkHash: string;
  private resolvedSourceModuleLinkHash = ABSENT;
  readonly exportedEntityKind: TsExportedEntityKind;
  private exportedEntityLinkHash = ABSENT;
  private exportedGroupKey = ABSENT;
  readonly position: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly isAmbient: boolean;
  private tsExpressionLinkHash = ABSENT;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private tsExportUniqueHash = ABSENT;

  constructor(props: {
    exportedName: string;
    localName: string;
    exportKind: TsExportKind;
    isTypeOnly: boolean;
    isDefault: boolean;
    isReExport: boolean;
    sourceSpecifier: string;
    tsModuleLinkHash: string;
    exportedEntityKind: TsExportedEntityKind;
    position: number;
    startLine: number;
    endLine: number;
    startColumn: number;
    isAmbient: boolean;
    serviceVersionLinkHash: string;
  }) {
    this.exportedName = props.exportedName;
    this.localName = props.localName;
    this.exportKind = props.exportKind;
    this.isTypeOnly = props.isTypeOnly;
    this.isDefault = props.isDefault;
    this.isReExport = props.isReExport;
    this.sourceSpecifier = props.sourceSpecifier;
    this.tsModuleLinkHash = props.tsModuleLinkHash;
    this.exportedEntityKind = props.exportedEntityKind;
    this.position = props.position;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.startColumn = props.startColumn;
    this.isAmbient = props.isAmbient;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `TS_EXPORT_md5(tsModuleLinkHash ‖ exportedName ‖ exportKind ‖ sourceSpecifier ‖ startLine ‖ position)`
   *
   * `exportedName` is `""` for `export *`, which is why `sourceSpecifier` and
   * `position` are both in the key: a module may re-export from several sources
   * on one line.
   */
  generateHash(): void {
    this.tsExportUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_EXPORT,
      keyOf(
        this.tsModuleLinkHash,
        this.exportedName,
        this.exportKind,
        this.sourceSpecifier,
        this.startLine,
        this.position
      )
    );
  }

  getHash(): string {
    return this.tsExportUniqueHash;
  }

  /** Back-patched by the module-graph pass: the source module may be parsed later. */
  setResolvedSourceModuleLinkHash(hash: string): void {
    this.resolvedSourceModuleLinkHash = hash;
  }

  getResolvedSourceModuleLinkHash(): string {
    return this.resolvedSourceModuleLinkHash;
  }

  /**
   * The declaration this export exposes, and its merge group.
   *
   * The group key matters more than the entity hash: an exported interface with
   * three declarations has three rows and one group, and an importer reaching it
   * needs the group or it sees a third of the members.
   */
  setExportedEntity(entityLinkHash: string, groupKey: string): void {
    this.exportedEntityLinkHash = entityLinkHash;
    this.exportedGroupKey = groupKey;
  }

  setTsExpressionLinkHash(hash: string): void {
    this.tsExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return `ts_export[name=${this.exportedName}, kind=${this.exportKind}, from=${this.sourceSpecifier}, hash=${this.tsExportUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.exportedName),
        text(this.localName),
        this.exportKind,
        bool(this.isTypeOnly),
        bool(this.isDefault),
        bool(this.isReExport),
        text(this.sourceSpecifier),
        this.tsModuleLinkHash,
        this.resolvedSourceModuleLinkHash,
        this.exportedEntityKind,
        this.exportedEntityLinkHash,
        this.exportedGroupKey,
        num(this.position),
        num(this.startLine),
        num(this.endLine),
        num(this.startColumn),
        bool(this.isAmbient),
        this.tsExpressionLinkHash,
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.tsExportUniqueHash,
      ],
      TsExportRegistry.ARITY,
      'ts_export'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'exportedName', 'localName', 'exportKind', 'isTypeOnly', 'isDefault', 'isReExport',
        'sourceSpecifier', 'tsModuleLinkHash', 'resolvedSourceModuleLinkHash',
        'exportedEntityKind', 'exportedEntityLinkHash', 'exportedGroupKey', 'position',
        'startLine', 'endLine', 'startColumn', 'isAmbient', 'tsExpressionLinkHash', 'isExternal',
        'serviceVersionLinkHash', 'tsExportUniqueHash',
      ],
      TsExportRegistry.ARITY,
      'ts_export'
    );
  }
}
