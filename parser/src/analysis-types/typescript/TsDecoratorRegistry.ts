import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  TsDecoratorContext,
  TsDecoratorKind,
  TsDecoratorSemantics,
  TsDecoratorSystem,
} from '@/enums/typescript/decorators';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A decorator — schema §4.18, 21 columns. Positions 0–12 mirror
 * `java_annotation` 0–12, so the `annotation_on` projection is shared.
 *
 * ## It is not an annotation, and the difference is the whole relation
 *
 * A Java annotation is inert metadata. A decorator is an EXPRESSION THAT RUNS at
 * class-definition time and may REPLACE the entity it decorates. That is why it
 * carries {@link tsExpressionLinkHash} into the call graph and why
 * `@Component({...})` is a call site like any other.
 *
 * ## `decoratorSystem` — and why it may never be a run-wide constant
 *
 * TypeScript has TWO decorator systems and they are not interchangeable:
 * standard TC39 (TS 5.0) and legacy `experimentalDecorators`. They differ in
 * evaluation ORDER, in what the decorator function RECEIVES, and in whether
 * parameter decorators are legal at all. Without this column a fact base mixes
 * two evaluation semantics under one relation and no rule can tell them apart.
 *
 * The value comes from the tsconfig that actually GOVERNS the file, resolved per
 * file. In this repository's own fixture corpus that is load-bearing:
 * `annotations/legacy/` compiles under its own config with
 * `experimentalDecorators: true`, and its facts legitimately differ from the
 * standard-decorator fixtures three directories up. A parser assuming one system
 * per run is wrong for exactly the repositories that matter — the ones migrating
 * between the two.
 */
export class TsDecoratorRegistry implements EntityIdentifiable {
  static readonly ARITY = 21;

  readonly decoratorName: string;
  readonly kind: TsDecoratorKind;
  readonly context: TsDecoratorContext;
  readonly ownerHash: string;
  readonly tsTypeLinkHash: string;
  /** Parity slot with `java_annotation` 5. */
  private readonly typeParameterHash = ABSENT;
  /** Parity slot with `java_annotation` 6 — TypeScript decorators do not nest. */
  private readonly parentDecoratorHash = ABSENT;
  private readonly depth = 0;
  readonly position: number;
  readonly startLine: number;
  readonly endLine: number;
  /** Parity slot with `java_annotation` 11 — no TypeScript analogue of a meta-annotation. */
  private readonly isMetaDecorator = false;
  readonly argumentCount: number;
  readonly decoratorSystem: TsDecoratorSystem;
  readonly decoratorSemantics: TsDecoratorSemantics;
  readonly tsExpressionLinkHash: string;
  private resolvedDecoratorMethodLinkHash = ABSENT;
  readonly tsModuleLinkHash: string;
  readonly startColumn: number;
  readonly serviceVersionLinkHash: string;
  private tsDecoratorUniqueHash = ABSENT;

  constructor(props: {
    decoratorName: string;
    kind: TsDecoratorKind;
    context: TsDecoratorContext;
    ownerHash: string;
    tsTypeLinkHash: string;
    position: number;
    startLine: number;
    endLine: number;
    argumentCount: number;
    decoratorSystem: TsDecoratorSystem;
    decoratorSemantics: TsDecoratorSemantics;
    tsExpressionLinkHash: string;
    tsModuleLinkHash: string;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.decoratorName = props.decoratorName;
    this.kind = props.kind;
    this.context = props.context;
    this.ownerHash = props.ownerHash;
    this.tsTypeLinkHash = props.tsTypeLinkHash;
    this.position = props.position;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.argumentCount = props.argumentCount;
    this.decoratorSystem = props.decoratorSystem;
    this.decoratorSemantics = props.decoratorSemantics;
    this.tsExpressionLinkHash = props.tsExpressionLinkHash;
    this.tsModuleLinkHash = props.tsModuleLinkHash;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `TS_DECORATOR_md5(ownerHash ‖ decoratorName ‖ position ‖ startLine ‖ startColumn)`
   *
   * `position` is in the key because stacking is legal and ORDER MATTERS —
   * standard decorators apply bottom-up — so `@a @b` and `@b @a` are different
   * facts about the same owner.
   */
  generateHash(): void {
    this.tsDecoratorUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_DECORATOR,
      keyOf(this.ownerHash, this.decoratorName, this.position, this.startLine, this.startColumn)
    );
  }

  getHash(): string {
    return this.tsDecoratorUniqueHash;
  }

  setResolvedDecoratorMethodLinkHash(hash: string): void {
    this.resolvedDecoratorMethodLinkHash = hash;
  }

  getEntryCombined(): string {
    return `ts_decorator[name=${this.decoratorName}, kind=${this.kind}, context=${this.context}, system=${this.decoratorSystem}, hash=${this.tsDecoratorUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.decoratorName),
        this.kind,
        this.context,
        this.ownerHash,
        this.tsTypeLinkHash,
        this.typeParameterHash,
        this.parentDecoratorHash,
        num(this.depth),
        num(this.position),
        num(this.startLine),
        num(this.endLine),
        bool(this.isMetaDecorator),
        num(this.argumentCount),
        this.decoratorSystem,
        this.decoratorSemantics,
        this.tsExpressionLinkHash,
        this.resolvedDecoratorMethodLinkHash,
        this.tsModuleLinkHash,
        num(this.startColumn),
        this.serviceVersionLinkHash,
        this.tsDecoratorUniqueHash,
      ],
      TsDecoratorRegistry.ARITY,
      'ts_decorator'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'decoratorName', 'kind', 'context', 'ownerHash', 'tsTypeLinkHash', 'typeParameterHash',
        'parentDecoratorHash', 'depth', 'position', 'startLine', 'endLine', 'isMetaDecorator',
        'argumentCount', 'decoratorSystem', 'decoratorSemantics', 'tsExpressionLinkHash',
        'resolvedDecoratorMethodLinkHash', 'tsModuleLinkHash', 'startColumn',
        'serviceVersionLinkHash', 'tsDecoratorUniqueHash',
      ],
      TsDecoratorRegistry.ARITY,
      'ts_decorator'
    );
  }
}
