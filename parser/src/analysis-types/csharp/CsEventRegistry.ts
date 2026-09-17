import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CsEventKind } from '@/enums/csharp/events';
import { CsTypeAccess } from '@/enums/csharp/types';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * An event — schema §3.9, **17 columns as listed**.
 *
 * > The schema heading says 15 and the column list beneath it has 17. The LIST
 * > is taken as the contract. Reported to cs-oracle and still open.
 *
 * ## `+=` on an event is a SUBSCRIPTION, not an assignment
 *
 * `button.Click += Handler` calls the `add` accessor and registers a call edge
 * that fires later, from a stack the subscriber never appears on. Modelling it
 * as a compound assignment is §3's defect class exactly — the parts are right,
 * the structure is absent, and the engine loses the edge. `cs_expression` gives
 * it a wrapper node with `EVENT_SUBSCRIBE`, not `COMPOUND_ASSIGNMENT` with an
 * operator in a column.
 *
 * ## A field-like event's accessors have no declaration syntax
 *
 * 130 field-like against 67 with explicit accessors. The field-like form
 * synthesizes `add` and `remove`, so they are call targets that exist in IL and
 * appear nowhere in the source — which is why `eventKind` is recorded rather
 * than inferred from whether accessors were found.
 */
export class CsEventRegistry implements EntityIdentifiable {
  static readonly ARITY = 17;
  static readonly RELATION = 'cs_event';

  readonly name: string;
  readonly eventTypeName: string;
  readonly completeTypeName: string;
  readonly eventKind: CsEventKind;
  readonly eventAccess: CsTypeAccess;
  readonly isStatic: boolean;
  readonly isVirtual: boolean;
  readonly isOverride: boolean;
  readonly explicitInterfaceName: string;
  readonly csTypeLinkHash: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  private attributeCount = 0;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csEventUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    eventTypeName: string;
    completeTypeName: string;
    eventKind: CsEventKind;
    eventAccess: CsTypeAccess;
    isStatic: boolean;
    isVirtual: boolean;
    isOverride: boolean;
    explicitInterfaceName: string;
    csTypeLinkHash: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    attributeCount: number;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.eventTypeName = props.eventTypeName;
    this.completeTypeName = props.completeTypeName;
    this.eventKind = props.eventKind;
    this.eventAccess = props.eventAccess;
    this.isStatic = props.isStatic;
    this.isVirtual = props.isVirtual;
    this.isOverride = props.isOverride;
    this.explicitInterfaceName = props.explicitInterfaceName;
    this.csTypeLinkHash = props.csTypeLinkHash;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.startColumn = props.startColumn;
    this.attributeCount = props.attributeCount;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_EVENT_md5(csTypeLinkHash ‖ name ‖ startLine ‖ startColumn)`
   *
   * `startColumn` matters here more than it looks: `event EventHandler A, B;`
   * declares TWO events on one line, and only the column separates them.
   */
  generateHash(): void {
    this.csEventUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_EVENT,
      keyOf(this.csTypeLinkHash, this.name, this.startLine, this.startColumn)
    );
  }

  getHash(): string {
    return this.csEventUniqueHash;
  }

  getEntryCombined(): string {
    return (
      `cs_event[name=${this.name}, kind=${this.eventKind}, ` +
      `type=${this.completeTypeName}, hash=${this.csEventUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        text(this.eventTypeName),
        text(this.completeTypeName),
        this.eventKind,
        this.eventAccess,
        bool(this.isStatic),
        bool(this.isVirtual),
        bool(this.isOverride),
        text(this.explicitInterfaceName),
        this.csTypeLinkHash,
        num(this.startLine),
        num(this.endLine),
        num(this.startColumn),
        num(this.attributeCount),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csEventUniqueHash,
      ],
      CsEventRegistry.ARITY,
      CsEventRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name', 'eventTypeName', 'completeTypeName', 'eventKind', 'eventAccess',
        'isStatic', 'isVirtual', 'isOverride', 'explicitInterfaceName', 'csTypeLinkHash',
        'startLine', 'endLine', 'startColumn', 'attributeCount', 'isExternal',
        'serviceVersionLinkHash', 'csEventUniqueHash',
      ],
      CsEventRegistry.ARITY,
      CsEventRegistry.RELATION
    );
  }
}
