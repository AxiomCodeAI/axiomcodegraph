import { ABSENT, joinHeader, joinRow, keyOf, num } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A field's declaration order within its type — schema §4.9, 3 columns.
 * Parity with `java_field_position`, unchanged.
 *
 * Three columns is the whole relation, and it is load-bearing for one reason
 * TypeScript has and Java does not: a class's field order determines a
 * PARAMETER-PROPERTY constructor's positional shape.
 *
 * ```ts
 * class Service {
 *     constructor(
 *         private readonly repo: Repo,   // position 0
 *         private readonly log: Logger,  // position 1
 *     ) { }
 * }
 * new Service(repo, log);                // argument 0 -> repo, 1 -> log
 * ```
 *
 * Both fields are declared by parameters, so their ORDER is the constructor's
 * signature. Recovering it from `startLine` would work until two are written on
 * one line.
 */
export class TsFieldPositionRegistry implements EntityIdentifiable {
  static readonly ARITY = 3;

  readonly tsFieldLinkHash: string;
  readonly position: number;
  private tsFieldPositionUniqueHash = ABSENT;

  constructor(props: { tsFieldLinkHash: string; position: number }) {
    this.tsFieldLinkHash = props.tsFieldLinkHash;
    this.position = props.position;
    this.generateHash();
  }

  /** **PK** `TS_FIELD_POSITION_md5(tsFieldLinkHash ‖ position)` — a pure chain off the field. */
  generateHash(): void {
    this.tsFieldPositionUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_FIELD_POSITION,
      keyOf(this.tsFieldLinkHash, this.position)
    );
  }

  getHash(): string {
    return this.tsFieldPositionUniqueHash;
  }

  getEntryCombined(): string {
    return `ts_field_position[field=${this.tsFieldLinkHash}, position=${this.position}]`;
  }

  toCsv(): string {
    return joinRow(
      [this.tsFieldLinkHash, num(this.position), this.tsFieldPositionUniqueHash],
      TsFieldPositionRegistry.ARITY,
      'ts_field_position'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      ['tsFieldLinkHash', 'position', 'tsFieldPositionUniqueHash'],
      TsFieldPositionRegistry.ARITY,
      'ts_field_position'
    );
  }
}
