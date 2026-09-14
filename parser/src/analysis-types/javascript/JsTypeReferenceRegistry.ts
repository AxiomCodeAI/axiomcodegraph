import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  JsTypeReferenceContextKind,
  JsTypeReferenceKind,
  JsTypeReferenceOwnerKind,
} from '@/enums/javascript/type-references';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A node in a JSDoc type expression — schema §3.14, 23 columns.
 *
 * **This is the JavaScript type system in its entirety, and it lives in
 * comments.** 37.9% of parameters are typed by JSDoc against effectively none by syntax,
 * so a schema that treats JSDoc as trivia has no declared-type channel at all.
 *
 * `Array<Object<string, number>>` is **three rows**, not a string — the same
 * parent-FK tree shape `ts_type_reference` uses, capped at depth 32. A consumer
 * that has to re-parse a string to find a generic argument is one that will get
 * it wrong on the first nested union.
 *
 * ## `isTypeOnly` is `true` in every row, and the gate asserts it
 *
 * No call-graph rule may traverse this relation. A `@typedef` naming a function
 * shape is **not a call target**, and `@callback` — 103 measured — is exactly
 * the row most likely to be mistaken for one.
 *
 * ## `UNKNOWN_SYNTAX` is deliberate and expected to be non-empty
 *
 * JSDoc type syntax is not standardised; Closure, TypeScript and jsdoc.app all
 * differ. A type expression the parser cannot decompose gets **one row with its
 * text preserved**, rather than a guess or a dropped tag.
 */
export class JsTypeReferenceRegistry implements EntityIdentifiable {
  static readonly ARITY = 23;

  readonly typeName: string;
  readonly referenceKind: JsTypeReferenceKind;
  readonly parentReferenceLinkHash: string;
  readonly depth: number;
  readonly childIndex: number;
  private childCount = 0;
  private isTruncated = false;
  readonly contextKind: JsTypeReferenceContextKind;
  readonly tagName: string;
  readonly ownerKind: JsTypeReferenceOwnerKind;
  readonly ownerLinkHash: string;
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
  /** **Always `true`.** No call-graph rule may traverse this relation. */
  readonly isTypeOnly: boolean;
  readonly isBuiltinType: boolean;
  readonly commentLinkHash: string;
  readonly ownerModuleLinkHash: string;
  /** Line **within the comment**. */
  readonly startLine: number;
  readonly startColumn: number;

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsTypeReferenceUniqueHash = ABSENT;

  constructor(props: {
    typeName: string;
    referenceKind: JsTypeReferenceKind;
    parentReferenceLinkHash: string;
    depth: number;
    childIndex: number;
    contextKind: JsTypeReferenceContextKind;
    tagName: string;
    ownerKind: JsTypeReferenceOwnerKind;
    ownerLinkHash: string;
    isTypeOnly: boolean;
    isBuiltinType: boolean;
    commentLinkHash: string;
    ownerModuleLinkHash: string;
    startLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.typeName = props.typeName;
    this.referenceKind = props.referenceKind;
    this.parentReferenceLinkHash = props.parentReferenceLinkHash;
    this.depth = props.depth;
    this.childIndex = props.childIndex;
    this.contextKind = props.contextKind;
    this.tagName = props.tagName;
    this.ownerKind = props.ownerKind;
    this.ownerLinkHash = props.ownerLinkHash;
    this.isTypeOnly = props.isTypeOnly;
    this.isBuiltinType = props.isBuiltinType;
    this.commentLinkHash = props.commentLinkHash;
    this.ownerModuleLinkHash = props.ownerModuleLinkHash;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  generateHash(): void {
    this.jsTypeReferenceUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_TYPE_REFERENCE,
      keyOf(this.ownerLinkHash, this.contextKind, this.depth, this.childIndex, this.startLine, this.startColumn)
    );
  }

  getHash(): string {
    return this.jsTypeReferenceUniqueHash;
  }

  setChildCount(value: number): void {
    this.childCount = value;
  }
  setIsTruncated(value = true): void {
    this.isTruncated = value;
  }
  /** Read by the parse-gap pass, which derives its rows from the fact base. */
  wasTruncated(): boolean {
    return this.isTruncated;
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

  getEntryCombined(): string {
    return `js_type_reference[hash=${this.jsTypeReferenceUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.typeName),
        this.referenceKind,
        this.parentReferenceLinkHash,
        num(this.depth),
        num(this.childIndex),
        num(this.childCount),
        bool(this.isTruncated),
        this.contextKind,
        text(this.tagName),
        this.ownerKind,
        this.ownerLinkHash,
        this.resolvedTypeLinkHash,
        this.resolvedFilePath,
        this.importLinkHash,
        bool(this.isTypeOnly),
        bool(this.isBuiltinType),
        this.commentLinkHash,
        this.ownerModuleLinkHash,
        num(this.startLine),
        num(this.startColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsTypeReferenceUniqueHash,
      ],
      JsTypeReferenceRegistry.ARITY,
      'js_type_reference'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'typeName',
        'referenceKind',
        'parentReferenceLinkHash',
        'depth',
        'childIndex',
        'childCount',
        'isTruncated',
        'contextKind',
        'tagName',
        'ownerKind',
        'ownerLinkHash',
        'resolvedTypeLinkHash',
        'resolvedFilePath',
        'importLinkHash',
        'isTypeOnly',
        'isBuiltinType',
        'commentLinkHash',
        'ownerModuleLinkHash',
        'startLine',
        'startColumn',
        'isExternal',
        'serviceVersionLinkHash',
        'jsTypeReferenceUniqueHash',
      ],
      JsTypeReferenceRegistry.ARITY,
      'js_type_reference'
    );
  }
}
