import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  JsHeritageForm,
} from '@/enums/javascript/heritage';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One inheritance edge — schema §3.3, 16 columns.
 *
 * A relation separate from `js_type` because **in JavaScript an `extends` edge
 * can be a function call.** `util.inherits(Child, Parent)` emits trivially as a
 * call site with two identifier arguments; what it *is* is an inheritance edge,
 * and an extractor that only sees the call emits no inheritance at all.
 *
 * That is §3 of `BUILDING-A-PARSER.md` in its purest form — the parts emit
 * trivially and the structure is entirely absent — and the consequence is not a
 * degraded answer but an absent one: **the engine sees no inheritance in any
 * pre-ES6 codebase.**
 *
 * ## Columns 3, 8 and 9 are what make a row complete
 *
 * `superTypeName` as written, `resolvedFilePath`, and `importLinkHash`. Those
 * are the three things §0 says an engine needs, and
 * `resolvedTypeLinkHash` is **tier 3 and stays empty** — the parser emits the
 * name and the hop, and the engine resolves.
 *
 * `inheritsMembers` is always `true`: JavaScript has no `implements`, so
 * TypeScript's extends/implements distinction collapses. Recorded rather than
 * dropped, so the always-true column reads as parity and not as a bug.
 */
export class JsTypeHeritageRegistry implements EntityIdentifiable {
  static readonly ARITY = 16;

  readonly ownerTypeLinkHash: string;
  /** Always 0 — JavaScript is single-inheritance. */
  readonly position: number;
  readonly heritageForm: JsHeritageForm;
  /** The name **as written** — `EventEmitter`, or `require("events").EventEmitter`. */
  readonly superTypeName: string;
  readonly superTypeExpressionText: string;
  /** `class X extends mixin(Y)` — syntax does not fix the name. */
  readonly isComputedSuperclass: boolean;
  /** Always `true`: JavaScript has no `implements`, so TypeScript's distinction collapses. */
  readonly inheritsMembers: boolean;
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
  private readonly resolvedTypeLinkHash = ABSENT;
  private resolvedFilePath = ABSENT;
  private importLinkHash = ABSENT;
  private sourceExpressionLinkHash = ABSENT;
  readonly startLine: number;
  readonly ownerModuleLinkHash: string;

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsTypeHeritageUniqueHash = ABSENT;

  constructor(props: {
    ownerTypeLinkHash: string;
    position: number;
    heritageForm: JsHeritageForm;
    superTypeName: string;
    superTypeExpressionText: string;
    isComputedSuperclass: boolean;
    inheritsMembers: boolean;
    startLine: number;
    ownerModuleLinkHash: string;
    serviceVersionLinkHash: string;
  }) {
    this.ownerTypeLinkHash = props.ownerTypeLinkHash;
    this.position = props.position;
    this.heritageForm = props.heritageForm;
    this.superTypeName = props.superTypeName;
    this.superTypeExpressionText = props.superTypeExpressionText;
    this.isComputedSuperclass = props.isComputedSuperclass;
    this.inheritsMembers = props.inheritsMembers;
    this.startLine = props.startLine;
    this.ownerModuleLinkHash = props.ownerModuleLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  generateHash(): void {
    this.jsTypeHeritageUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_TYPE_HERITAGE,
      keyOf(this.ownerTypeLinkHash, this.position, this.heritageForm, this.superTypeName, this.startLine)
    );
  }

  getHash(): string {
    return this.jsTypeHeritageUniqueHash;
  }

  setResolvedFilePath(hash: string): void {
    this.resolvedFilePath = hash;
  }
  setImportLinkHash(hash: string): void {
    this.importLinkHash = hash;
  }
  /** Read by the IR-completeness measure, which asks whether the hop is present. */
  importLinkHashValue(): string {
    return this.importLinkHash;
  }
  setSourceExpressionLinkHash(hash: string): void {
    this.sourceExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return `js_type_heritage[hash=${this.jsTypeHeritageUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        this.ownerTypeLinkHash,
        num(this.position),
        this.heritageForm,
        text(this.superTypeName),
        text(this.superTypeExpressionText),
        bool(this.isComputedSuperclass),
        bool(this.inheritsMembers),
        this.resolvedTypeLinkHash,
        this.resolvedFilePath,
        this.importLinkHash,
        this.sourceExpressionLinkHash,
        num(this.startLine),
        this.ownerModuleLinkHash,
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsTypeHeritageUniqueHash,
      ],
      JsTypeHeritageRegistry.ARITY,
      'js_type_heritage'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'ownerTypeLinkHash',
        'position',
        'heritageForm',
        'superTypeName',
        'superTypeExpressionText',
        'isComputedSuperclass',
        'inheritsMembers',
        'resolvedTypeLinkHash',
        'resolvedFilePath',
        'importLinkHash',
        'sourceExpressionLinkHash',
        'startLine',
        'ownerModuleLinkHash',
        'isExternal',
        'serviceVersionLinkHash',
        'jsTypeHeritageUniqueHash',
      ],
      JsTypeHeritageRegistry.ARITY,
      'js_type_heritage'
    );
  }
}
