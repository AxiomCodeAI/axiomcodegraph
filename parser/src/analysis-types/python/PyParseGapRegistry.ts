import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  PythonParseGapDisposition,
  PythonParseGapKind,
} from '@/enums/python/parse-gaps';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One construct the grammar could not represent.
 *
 * The relation whose ABSENCE is invisible, which is exactly why it has to exist.
 * Every other gap in this schema shows up as a missing row somewhere a consumer
 * is already looking; a region the parser could not read produces silence, and
 * silence is indistinguishable from "there was nothing there". A rule that finds
 * no `eval` call cannot tell a clean file from one where the parser gave up on
 * the block containing it.
 *
 * Zero rows is the expected state for ~99.6% of modules, Python 2 included. A
 * non-empty table names exactly what could not be represented and where.
 *
 * ## Column order (frozen — schema v7 §2.19, 10 columns)
 *
 * **PK** `PY_PARSE_GAP_md5(pyModuleLinkHash ‖ startLine ‖ startColumn ‖ endLine ‖ endColumn ‖ constructKind)`
 */
export class PyParseGapRegistry implements EntityIdentifiable {
  private pyModuleLinkHash: string;
  private constructKind: PythonParseGapKind;
  private disposition: PythonParseGapDisposition;
  private startLine: number;
  private startColumn: number;
  private endLine: number;
  private endColumn: number;
  private sourceText: string;
  private serviceVersionLinkHash: string;
  private pyParseGapUniqueHash: string = '';

  constructor(
    pyModuleLinkHash: string,
    constructKind: PythonParseGapKind,
    disposition: PythonParseGapDisposition,
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
    sourceText: string,
    serviceVersionLinkHash: string
  ) {
    this.pyModuleLinkHash = pyModuleLinkHash;
    this.constructKind = constructKind;
    this.disposition = disposition;
    this.startLine = startLine;
    this.startColumn = startColumn;
    this.endLine = endLine;
    this.endColumn = endColumn;
    this.sourceText = sourceText;
    this.serviceVersionLinkHash = serviceVersionLinkHash;

    this.generateHash();
  }

  getConstructKind(): PythonParseGapKind {
    return this.constructKind;
  }

  getDisposition(): PythonParseGapDisposition {
    return this.disposition;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getSourceText(): string {
    return this.sourceText;
  }

  getHash(): string {
    return this.pyParseGapUniqueHash;
  }

  generateHash(): void {
    const content =
      this.pyModuleLinkHash +
      '||' +
      this.startLine +
      '||' +
      this.startColumn +
      '||' +
      this.endLine +
      '||' +
      this.endColumn +
      '||' +
      this.constructKind;

    this.pyParseGapUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_PARSE_GAP,
      content
    );
  }

  getEntryCombined(): string {
    return `py_parse_gap[kind=${this.constructKind}, disposition=${this.disposition}, line=${this.startLine}]`;
  }

  toCsv(): string {
    return [
      this.pyModuleLinkHash,
      this.constructKind,
      this.disposition,
      this.startLine,
      this.startColumn,
      this.endLine,
      this.endColumn,
      EntityUtils.escapeTsv(this.sourceText),
      this.serviceVersionLinkHash,
      this.pyParseGapUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'pyModuleLinkHash',
      'constructKind',
      'disposition',
      'startLine',
      'startColumn',
      'endLine',
      'endColumn',
      'sourceText',
      'serviceVersionLinkHash',
      'pyParseGapUniqueHash',
    ].join('\t');
  }
}
