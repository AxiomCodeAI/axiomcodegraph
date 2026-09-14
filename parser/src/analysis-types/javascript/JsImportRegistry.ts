import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  JsEdgeBearer,
  JsImportBindingForm,
  JsImportForm,
  JsImportResolutionOutcome,
  JsSpecifierKind,
} from '@/enums/javascript/imports';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One module edge IN — schema §3.8, 23 columns.
 *
 * ## 83.6% of these rows are minted from expressions, in a second pass
 *
 * `require('./x')` is a call and `module.exports = X` is an assignment, so the
 * module graph lives in the expression relation. This relation is therefore
 * built **after** `js_expression`, inverting §1's build order for its last step,
 * and `sourceExpressionLinkHash` points back at the expression each row was
 * minted from — which is what makes the second pass auditable. Gate 7.3.1:
 * every expression with `isModuleEdge` is pointed at by **exactly one** edge
 * row, because a second pass that double-mints **doubles** the edge count rather
 * than colliding.
 *
 * ## `isTopLevel` is false for 13.6% of requires, and that is the whole reason
 * the extractor cannot walk the statement list
 *
 * 1,227 of 9,055 measured `require()` calls are not top-level — 1,048 inside a
 * function body, 179 inside a block. Every TypeScript module-edge extractor
 * walks `sourceFile.statements`, because every TypeScript module edge is a
 * top-level declaration. Doing that here misses one require in seven.
 *
 * ## Recorded as written; nothing reaches through it
 *
 * `specifier` as it appears in source, `specifierKind`, and `resolvedFilePath`
 * from `ts.resolveModuleName` — a pure function needing no Program. Nothing in
 * this relation names what `./router` exports. `resolvedModuleLinkHash` is
 * **tier 3 and stays empty**: `resolvedFilePath` is a path string the parser
 * computed, and turning it into a link is cross-file following.
 *
 * `startColumn` is in the key because `const { a, b } = require('x')` produces
 * two rows on one line with one specifier.
 */
export class JsImportRegistry implements EntityIdentifiable {
  static readonly ARITY = 23;

  readonly specifier: string;
  readonly specifierKind: JsSpecifierKind;
  readonly edgeBearer: JsEdgeBearer;
  readonly importForm: JsImportForm;
  /** **False for 13.6%** of requires — 1,048 in a function body, 179 in a block. */
  readonly isTopLevel: boolean;
  /** Inside an `if` or `try` — a module edge that may never execute. */
  readonly isConditional: boolean;
  readonly bindingForm: JsImportBindingForm;
  readonly importedName: string;
  readonly localName: string;
  /** **The hop the engine needs.** From `ts.resolveModuleName`, which needs no Program. */
  readonly resolvedFilePath: string;
  readonly resolutionOutcome: JsImportResolutionOutcome;
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
  private readonly resolvedModuleLinkHash = ABSENT;
  /** Parity slot, always `false` — JavaScript has no `import type`. */
  readonly isTypeOnly: boolean;
  private sourceExpressionLinkHash = ABSENT;
  private boundVariableLinkHash = ABSENT;
  readonly ownerScopeLinkHash: string;
  readonly ownerMethodLinkHash: string;
  readonly ownerModuleLinkHash: string;
  readonly startLine: number;
  readonly startColumn: number;

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsImportUniqueHash = ABSENT;

  constructor(props: {
    specifier: string;
    specifierKind: JsSpecifierKind;
    edgeBearer: JsEdgeBearer;
    importForm: JsImportForm;
    isTopLevel: boolean;
    isConditional: boolean;
    bindingForm: JsImportBindingForm;
    importedName: string;
    localName: string;
    resolvedFilePath: string;
    resolutionOutcome: JsImportResolutionOutcome;
    isTypeOnly: boolean;
    ownerScopeLinkHash: string;
    ownerMethodLinkHash: string;
    ownerModuleLinkHash: string;
    startLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.specifier = props.specifier;
    this.specifierKind = props.specifierKind;
    this.edgeBearer = props.edgeBearer;
    this.importForm = props.importForm;
    this.isTopLevel = props.isTopLevel;
    this.isConditional = props.isConditional;
    this.bindingForm = props.bindingForm;
    this.importedName = props.importedName;
    this.localName = props.localName;
    this.resolvedFilePath = props.resolvedFilePath;
    this.resolutionOutcome = props.resolutionOutcome;
    this.isTypeOnly = props.isTypeOnly;
    this.ownerScopeLinkHash = props.ownerScopeLinkHash;
    this.ownerMethodLinkHash = props.ownerMethodLinkHash;
    this.ownerModuleLinkHash = props.ownerModuleLinkHash;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  generateHash(): void {
    this.jsImportUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_IMPORT,
      keyOf(this.ownerModuleLinkHash, this.specifier, this.localName, this.startLine, this.startColumn)
    );
  }

  getHash(): string {
    return this.jsImportUniqueHash;
  }

  setSourceExpressionLinkHash(hash: string): void {
    this.sourceExpressionLinkHash = hash;
  }
  setBoundVariableLinkHash(hash: string): void {
    this.boundVariableLinkHash = hash;
  }

  getEntryCombined(): string {
    return `js_import[hash=${this.jsImportUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.specifier),
        this.specifierKind,
        this.edgeBearer,
        this.importForm,
        bool(this.isTopLevel),
        bool(this.isConditional),
        this.bindingForm,
        text(this.importedName),
        text(this.localName),
        text(this.resolvedFilePath),
        this.resolutionOutcome,
        this.resolvedModuleLinkHash,
        bool(this.isTypeOnly),
        this.sourceExpressionLinkHash,
        this.boundVariableLinkHash,
        this.ownerScopeLinkHash,
        this.ownerMethodLinkHash,
        this.ownerModuleLinkHash,
        num(this.startLine),
        num(this.startColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsImportUniqueHash,
      ],
      JsImportRegistry.ARITY,
      'js_import'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'specifier',
        'specifierKind',
        'edgeBearer',
        'importForm',
        'isTopLevel',
        'isConditional',
        'bindingForm',
        'importedName',
        'localName',
        'resolvedFilePath',
        'resolutionOutcome',
        'resolvedModuleLinkHash',
        'isTypeOnly',
        'sourceExpressionLinkHash',
        'boundVariableLinkHash',
        'ownerScopeLinkHash',
        'ownerMethodLinkHash',
        'ownerModuleLinkHash',
        'startLine',
        'startColumn',
        'isExternal',
        'serviceVersionLinkHash',
        'jsImportUniqueHash',
      ],
      JsImportRegistry.ARITY,
      'js_import'
    );
  }
}
