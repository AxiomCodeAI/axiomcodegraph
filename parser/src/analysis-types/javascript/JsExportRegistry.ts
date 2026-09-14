import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  JsExportForm,
  JsExportTargetKind,
  JsExportedValueKind,
} from '@/enums/javascript/exports';
import { JsEdgeBearer } from '@/enums/javascript/imports';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One module edge OUT — schema §3.9, 22 columns.
 *
 * `module.exports = X` (2,102), `module.exports.x =` (380), `exports.x =`
 * (118), `Object.defineProperty(exports, …)`, plus every ESM `export` form.
 *
 * ## `overwritesPreviousExport`, and why it is not a runtime conclusion
 *
 * ```js
 * exports.a = 1;
 * module.exports = { b };   // exports ONLY b. `a` is gone.
 * ```
 *
 * A fact base recording both edges with no ordering tells the engine this module
 * exports `a`, which is false. Suppressing the earlier row loses the fact that
 * the assignment executed. The flag keeps both and lets the engine decide.
 *
 * **It is only set when the overwrite is unconditional.** `if (x) module.exports
 * = {}` *may* overwrite, and a boolean that collapses those two cases is
 * asserting a runtime conclusion from syntax — the thing this schema is most
 * careful not to do. `isConditional` is the column that keeps them apart.
 *
 * ## `isReExport`: one line, two relations
 *
 * `module.exports = require('./y')` — 81 measured — is **simultaneously an
 * import and an export**. It mints a row in each, joined by
 * `reExportImportLinkHash`, because dropping either half loses a real edge.
 */
export class JsExportRegistry implements EntityIdentifiable {
  static readonly ARITY = 22;

  readonly exportedName: string;
  readonly localName: string;
  readonly edgeBearer: JsEdgeBearer;
  readonly exportForm: JsExportForm;
  readonly exportedValueKind: JsExportedValueKind;
  /** `module.exports = require("./y")` — 81 measured; an import and an export in one line. */
  readonly isReExport: boolean;
  readonly reExportSpecifier: string;
  private reExportImportLinkHash = ABSENT;
  readonly isTopLevel: boolean;
  readonly isConditional: boolean;
  private targetKind: JsExportTargetKind;
  private targetLinkHash = ABSENT;
  private sourceExpressionLinkHash = ABSENT;
  /** Set only when the overwrite is UNCONDITIONAL; `isConditional` keeps `if (x) module.exports = {}` apart. */
  private overwritesPreviousExport = false;
  readonly ownerScopeLinkHash: string;
  readonly ownerMethodLinkHash: string;
  readonly ownerModuleLinkHash: string;
  readonly startLine: number;
  readonly startColumn: number;

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsExportUniqueHash = ABSENT;

  constructor(props: {
    exportedName: string;
    localName: string;
    edgeBearer: JsEdgeBearer;
    exportForm: JsExportForm;
    exportedValueKind: JsExportedValueKind;
    isReExport: boolean;
    reExportSpecifier: string;
    isTopLevel: boolean;
    isConditional: boolean;
    targetKind: JsExportTargetKind;
    ownerScopeLinkHash: string;
    ownerMethodLinkHash: string;
    ownerModuleLinkHash: string;
    startLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.exportedName = props.exportedName;
    this.localName = props.localName;
    this.edgeBearer = props.edgeBearer;
    this.exportForm = props.exportForm;
    this.exportedValueKind = props.exportedValueKind;
    this.isReExport = props.isReExport;
    this.reExportSpecifier = props.reExportSpecifier;
    this.isTopLevel = props.isTopLevel;
    this.isConditional = props.isConditional;
    this.targetKind = props.targetKind;
    this.ownerScopeLinkHash = props.ownerScopeLinkHash;
    this.ownerMethodLinkHash = props.ownerMethodLinkHash;
    this.ownerModuleLinkHash = props.ownerModuleLinkHash;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  generateHash(): void {
    this.jsExportUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_EXPORT,
      keyOf(this.ownerModuleLinkHash, this.exportedName, this.exportForm, this.startLine, this.startColumn)
    );
  }

  getHash(): string {
    return this.jsExportUniqueHash;
  }

  setReExportImportLinkHash(hash: string): void {
    this.reExportImportLinkHash = hash;
  }
  setTargetKind(value: JsExportTargetKind): void {
    this.targetKind = value;
  }
  setTargetLinkHash(hash: string): void {
    this.targetLinkHash = hash;
  }
  setSourceExpressionLinkHash(hash: string): void {
    this.sourceExpressionLinkHash = hash;
  }
  setOverwritesPreviousExport(value = true): void {
    this.overwritesPreviousExport = value;
  }

  getEntryCombined(): string {
    return `js_export[hash=${this.jsExportUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.exportedName),
        text(this.localName),
        this.edgeBearer,
        this.exportForm,
        this.exportedValueKind,
        bool(this.isReExport),
        text(this.reExportSpecifier),
        this.reExportImportLinkHash,
        bool(this.isTopLevel),
        bool(this.isConditional),
        this.targetKind,
        this.targetLinkHash,
        this.sourceExpressionLinkHash,
        bool(this.overwritesPreviousExport),
        this.ownerScopeLinkHash,
        this.ownerMethodLinkHash,
        this.ownerModuleLinkHash,
        num(this.startLine),
        num(this.startColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsExportUniqueHash,
      ],
      JsExportRegistry.ARITY,
      'js_export'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'exportedName',
        'localName',
        'edgeBearer',
        'exportForm',
        'exportedValueKind',
        'isReExport',
        'reExportSpecifier',
        'reExportImportLinkHash',
        'isTopLevel',
        'isConditional',
        'targetKind',
        'targetLinkHash',
        'sourceExpressionLinkHash',
        'overwritesPreviousExport',
        'ownerScopeLinkHash',
        'ownerMethodLinkHash',
        'ownerModuleLinkHash',
        'startLine',
        'startColumn',
        'isExternal',
        'serviceVersionLinkHash',
        'jsExportUniqueHash',
      ],
      JsExportRegistry.ARITY,
      'js_export'
    );
  }
}
