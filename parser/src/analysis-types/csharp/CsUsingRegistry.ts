import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CsUsingKind } from '@/enums/csharp/imports';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One `using` — schema §3.13, **15 columns as listed**.
 *
 * > The schema heading says 16 and the list beneath it has 15. The LIST is
 * > taken as the contract. Reported to cs-oracle and still open.
 *
 * ## This relation has rows no file-walking extractor can produce
 *
 * `IMPLICIT` usings are injected by the SDK when a project sets
 * `<ImplicitUsings>enable</ImplicitUsings>` — 59 projects in the measured
 * corpus. They appear in **no file anywhere**, and they put `System`,
 * `System.Linq` and `System.Collections.Generic` in scope for every file of the
 * project. `startLine = 0`, `originFile = ''`, supplied as a parser input.
 *
 * ## Why this relation is engine-critical rather than bookkeeping
 *
 * **Extension-method visibility is decided by the `using` set in scope.**
 * `xs.Count()` is a call on `IEnumerable<T>` whose target is declared on a
 * static class the receiver has never heard of, and whether that method is even
 * visible depends on which namespaces are imported at the call site. The three
 * facts an engine needs are the `this`-parameter marker, the declaring static
 * class, and this — and without any one of them the edge is unreconstructable.
 *
 * The parser emits all three and **resolves none of them**.
 */
export class CsUsingRegistry implements EntityIdentifiable {
  static readonly ARITY = 15;
  static readonly RELATION = 'cs_using';

  readonly usingKind: CsUsingKind;
  readonly namespaceOrTypeName: string;
  readonly aliasName: string;
  readonly aliasTargetText: string;
  readonly isGlobal: boolean;
  readonly isStatic: boolean;
  readonly isImplicit: boolean;
  readonly originFile: string;
  readonly csModuleLinkHash: string;
  readonly position: number;
  readonly startLine: number;
  readonly startColumn: number;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csUsingUniqueHash = ABSENT;

  constructor(props: {
    usingKind: CsUsingKind;
    namespaceOrTypeName: string;
    aliasName: string;
    aliasTargetText: string;
    isGlobal: boolean;
    isStatic: boolean;
    isImplicit: boolean;
    originFile: string;
    csModuleLinkHash: string;
    position: number;
    startLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.usingKind = props.usingKind;
    this.namespaceOrTypeName = props.namespaceOrTypeName;
    this.aliasName = props.aliasName;
    this.aliasTargetText = props.aliasTargetText;
    this.isGlobal = props.isGlobal;
    this.isStatic = props.isStatic;
    this.isImplicit = props.isImplicit;
    this.originFile = props.originFile;
    this.csModuleLinkHash = props.csModuleLinkHash;
    this.position = props.position;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_USING_md5(csModuleLinkHash ‖ usingKind ‖ namespaceOrTypeName ‖
   * aliasName ‖ position ‖ startLine)`
   *
   * `position` and `startLine` are both present because an IMPLICIT using has
   * `startLine = 0` for all of them — there is no line to distinguish them by,
   * so ordinal is the only separator. And a file may legally repeat `using
   * System;` twice, which is a warning and not an error, so the name alone is
   * not unique either.
   */
  generateHash(): void {
    this.csUsingUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_USING,
      keyOf(
        this.csModuleLinkHash,
        this.usingKind,
        this.namespaceOrTypeName,
        this.aliasName,
        this.position,
        this.startLine
      )
    );
  }

  getHash(): string {
    return this.csUsingUniqueHash;
  }

  getEntryCombined(): string {
    return (
      `cs_using[kind=${this.usingKind}, name=${this.namespaceOrTypeName}, ` +
      `alias=${this.aliasName}, hash=${this.csUsingUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        this.usingKind,
        text(this.namespaceOrTypeName),
        text(this.aliasName),
        text(this.aliasTargetText),
        bool(this.isGlobal),
        bool(this.isStatic),
        bool(this.isImplicit),
        text(this.originFile),
        this.csModuleLinkHash,
        num(this.position),
        num(this.startLine),
        num(this.startColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csUsingUniqueHash,
      ],
      CsUsingRegistry.ARITY,
      CsUsingRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'usingKind', 'namespaceOrTypeName', 'aliasName', 'aliasTargetText', 'isGlobal',
        'isStatic', 'isImplicit', 'originFile', 'csModuleLinkHash', 'position',
        'startLine', 'startColumn', 'isExternal', 'serviceVersionLinkHash',
        'csUsingUniqueHash',
      ],
      CsUsingRegistry.ARITY,
      CsUsingRegistry.RELATION
    );
  }
}
