import { ABSENT, joinHeader, joinRow, keyOf, num, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { TsDecoratorArgumentValueType } from '@/enums/typescript/decorators';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A decorator argument — schema §4.19, 13 columns. Positions 0–10 mirror
 * `java_annotation_argument` 0–10.
 *
 * This is where framework routes and DI tokens live: `@Get("/users/:id")`,
 * `@Inject(UserRepository)`, `@Column({ type: "varchar" })`. It is the direct
 * analogue of the Java relation that CWE detection already keys on for
 * `@RequestMapping` and `@RequestParam`, which is why {@link valueType} carries
 * `CLASS_REFERENCE` as a distinct member rather than folding it into
 * `IDENTIFIER`.
 */
export class TsDecoratorArgumentRegistry implements EntityIdentifiable {
  static readonly ARITY = 13;

  readonly argumentName: string;
  readonly argumentValue: string;
  readonly valueType: TsDecoratorArgumentValueType;
  readonly position: number;
  readonly parentDecoratorHash: string;
  private referencedTypeHash = ABSENT;
  readonly nestedObjectHash: string;
  readonly arrayIndex: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly tsExpressionLinkHash: string;
  readonly serviceVersionLinkHash: string;
  private tsDecoratorArgumentUniqueHash = ABSENT;

  constructor(props: {
    argumentName: string;
    argumentValue: string;
    valueType: TsDecoratorArgumentValueType;
    position: number;
    parentDecoratorHash: string;
    nestedObjectHash: string;
    arrayIndex: number;
    startLine: number;
    endLine: number;
    tsExpressionLinkHash: string;
    serviceVersionLinkHash: string;
  }) {
    this.argumentName = props.argumentName;
    this.argumentValue = props.argumentValue;
    this.valueType = props.valueType;
    this.position = props.position;
    this.parentDecoratorHash = props.parentDecoratorHash;
    this.nestedObjectHash = props.nestedObjectHash;
    this.arrayIndex = props.arrayIndex;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.tsExpressionLinkHash = props.tsExpressionLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `TS_DECORATOR_ARGUMENT_md5(parentDecoratorHash ‖ position ‖ argumentName ‖ arrayIndex)` */
  generateHash(): void {
    this.tsDecoratorArgumentUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_DECORATOR_ARGUMENT,
      keyOf(this.parentDecoratorHash, this.position, this.argumentName, this.arrayIndex)
    );
  }

  getHash(): string {
    return this.tsDecoratorArgumentUniqueHash;
  }

  /** The class named as a DI token — the pattern this relation exists to capture. */
  setReferencedTypeHash(hash: string): void {
    this.referencedTypeHash = hash;
  }

  getEntryCombined(): string {
    return `ts_decorator_argument[name=${this.argumentName}, value=${this.argumentValue}, type=${this.valueType}, hash=${this.tsDecoratorArgumentUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.argumentName),
        text(this.argumentValue),
        this.valueType,
        num(this.position),
        this.parentDecoratorHash,
        this.referencedTypeHash,
        this.nestedObjectHash,
        num(this.arrayIndex),
        num(this.startLine),
        num(this.endLine),
        this.tsExpressionLinkHash,
        this.serviceVersionLinkHash,
        this.tsDecoratorArgumentUniqueHash,
      ],
      TsDecoratorArgumentRegistry.ARITY,
      'ts_decorator_argument'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'argumentName', 'argumentValue', 'valueType', 'position', 'parentDecoratorHash',
        'referencedTypeHash', 'nestedObjectHash', 'arrayIndex', 'startLine', 'endLine',
        'tsExpressionLinkHash', 'serviceVersionLinkHash', 'tsDecoratorArgumentUniqueHash',
      ],
      TsDecoratorArgumentRegistry.ARITY,
      'ts_decorator_argument'
    );
  }
}
