import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  JsBlockKind,
} from '@/enums/javascript/blocks';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A lexical block — schema §3.12, 17 columns.
 *
 * ## Distinct from `js_scope`: a block is SYNTAX, a scope is BINDING
 *
 * They are not in 1:1 correspondence. A bare `{}` containing only `var`
 * declarations opens **no scope**; one scope may span several blocks. `opensScope`
 * and `scopeLinkHash` carry the join, and a `""` there is a real answer rather
 * than a missing one.
 *
 * ## Every block form gets a row, including the ones that emit nothing else
 *
 * TypeScript's enum audit found `NAMESPACE_BODY` and `MODULE_BODY` producing **no
 * block row at all**, on two separate early-return paths, and nothing else caught
 * it because no row was misplaced — there simply were none.
 *
 * `label` is the other half of that lesson: `outer: for (…)` emitted the `FOR`
 * and **dropped the label**, so a `break outer` named a target nothing in the
 * fact base identified. This column is why that cannot happen here.
 */
export class JsBlockRegistry implements EntityIdentifiable {
  static readonly ARITY = 17;

  readonly blockKind: JsBlockKind;
  /** `outer:`. TypeScript emitted the loop and DROPPED the label; this column is why that cannot happen here. */
  readonly label: string;
  readonly parentBlockLinkHash: string;
  readonly depth: number;
  readonly childIndex: number;
  readonly scopeLinkHash: string;
  /** False for a block that binds nothing — a bare `{}` holding only `var` declarations. */
  readonly opensScope: boolean;
  private conditionExpressionLinkHash = ABSENT;
  readonly ownerMethodLinkHash: string;
  readonly ownerModuleLinkHash: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsBlockUniqueHash = ABSENT;

  constructor(props: {
    blockKind: JsBlockKind;
    label: string;
    parentBlockLinkHash: string;
    depth: number;
    childIndex: number;
    scopeLinkHash: string;
    opensScope: boolean;
    ownerMethodLinkHash: string;
    ownerModuleLinkHash: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.blockKind = props.blockKind;
    this.label = props.label;
    this.parentBlockLinkHash = props.parentBlockLinkHash;
    this.depth = props.depth;
    this.childIndex = props.childIndex;
    this.scopeLinkHash = props.scopeLinkHash;
    this.opensScope = props.opensScope;
    this.ownerMethodLinkHash = props.ownerMethodLinkHash;
    this.ownerModuleLinkHash = props.ownerModuleLinkHash;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.endLine = props.endLine;
    this.endColumn = props.endColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  generateHash(): void {
    this.jsBlockUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_BLOCK,
      keyOf(this.ownerModuleLinkHash, this.blockKind, this.startLine, this.startColumn, this.endLine, this.endColumn)
    );
  }

  getHash(): string {
    return this.jsBlockUniqueHash;
  }

  setConditionExpressionLinkHash(hash: string): void {
    this.conditionExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return `js_block[hash=${this.jsBlockUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        this.blockKind,
        text(this.label),
        this.parentBlockLinkHash,
        num(this.depth),
        num(this.childIndex),
        this.scopeLinkHash,
        bool(this.opensScope),
        this.conditionExpressionLinkHash,
        this.ownerMethodLinkHash,
        this.ownerModuleLinkHash,
        num(this.startLine),
        num(this.startColumn),
        num(this.endLine),
        num(this.endColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsBlockUniqueHash,
      ],
      JsBlockRegistry.ARITY,
      'js_block'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'blockKind',
        'label',
        'parentBlockLinkHash',
        'depth',
        'childIndex',
        'scopeLinkHash',
        'opensScope',
        'conditionExpressionLinkHash',
        'ownerMethodLinkHash',
        'ownerModuleLinkHash',
        'startLine',
        'startColumn',
        'endLine',
        'endColumn',
        'isExternal',
        'serviceVersionLinkHash',
        'jsBlockUniqueHash',
      ],
      JsBlockRegistry.ARITY,
      'js_block'
    );
  }
}
