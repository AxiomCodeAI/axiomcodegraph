import { WEB_ATTRIBUTE_VALUE_LIMIT } from '@/constants/web-constants';
import { HtmlScriptKind, HtmlScriptType } from '@/enums/html/HtmlScriptKind';

import { WebRow, bool, boundedText, num, text } from '../web/web-row';

/**
 * One `<script>` element, 1:1 with its `html_element` row.
 *
 * For an INLINE script the body range locates the code in the page, line and column,
 * so a script front end can read it at its own offsets; the body itself is not copied
 * into the relation. For an EXTERNAL one `referenceLinkHash` is the `html_reference`
 * row that resolves the `src`.
 */
export class HtmlScript extends WebRow {
  static readonly COLUMNS = [
    'scriptKind', 'scriptType', 'typeAsWritten', 'src', 'resolvedFilePath', 'isAsync', 'isDefer',
    'isNoModule', 'bodyStartLine', 'bodyStartColumn', 'bodyEndLine', 'bodyEndColumn', 'bodyLength',
    'ownerElementLinkHash', 'referenceLinkHash', 'documentLinkHash', 'serviceVersionLinkHash',
    'htmlScriptUniqueHash',
  ] as const;

  readonly relation = 'html_script';
  readonly columns = HtmlScript.COLUMNS;

  readonly scriptKind: HtmlScriptKind;
  readonly scriptType: HtmlScriptType;
  readonly typeAsWritten: string;
  readonly src: string;
  readonly resolvedFilePath: string;
  readonly isAsync: boolean;
  readonly isDefer: boolean;
  readonly isNoModule: boolean;
  readonly bodyStartLine: number;
  readonly bodyStartColumn: number;
  readonly bodyEndLine: number;
  readonly bodyEndColumn: number;
  readonly bodyLength: number;
  readonly ownerElementLinkHash: string;
  readonly referenceLinkHash: string;
  readonly documentLinkHash: string;
  readonly serviceVersionLinkHash: string;

  constructor(props: {
    scriptKind: HtmlScriptKind; scriptType: HtmlScriptType; typeAsWritten: string; src: string;
    resolvedFilePath: string; isAsync: boolean; isDefer: boolean; isNoModule: boolean;
    bodyStartLine: number; bodyStartColumn: number; bodyEndLine: number; bodyEndColumn: number;
    bodyLength: number; ownerElementLinkHash: string; referenceLinkHash: string;
    documentLinkHash: string; serviceVersionLinkHash: string;
  }) {
    super();
    this.scriptKind = props.scriptKind;
    this.scriptType = props.scriptType;
    this.typeAsWritten = props.typeAsWritten;
    this.src = props.src;
    this.resolvedFilePath = props.resolvedFilePath;
    this.isAsync = props.isAsync;
    this.isDefer = props.isDefer;
    this.isNoModule = props.isNoModule;
    this.bodyStartLine = props.bodyStartLine;
    this.bodyStartColumn = props.bodyStartColumn;
    this.bodyEndLine = props.bodyEndLine;
    this.bodyEndColumn = props.bodyEndColumn;
    this.bodyLength = props.bodyLength;
    this.ownerElementLinkHash = props.ownerElementLinkHash;
    this.referenceLinkHash = props.referenceLinkHash;
    this.documentLinkHash = props.documentLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `HTML_SCRIPT_md5(ownerElementLinkHash)` — a pure 1:1 chain off the element. */
  generateHash(): void {
    this.hash = WebRow.key('HTML_SCRIPT', this.ownerElementLinkHash);
  }

  protected values(): string[] {
    return [
      this.scriptKind, this.scriptType, text(this.typeAsWritten),
      boundedText(this.src, WEB_ATTRIBUTE_VALUE_LIMIT), text(this.resolvedFilePath),
      bool(this.isAsync), bool(this.isDefer), bool(this.isNoModule), num(this.bodyStartLine),
      num(this.bodyStartColumn), num(this.bodyEndLine), num(this.bodyEndColumn), num(this.bodyLength),
      this.ownerElementLinkHash, this.referenceLinkHash, this.documentLinkHash,
      this.serviceVersionLinkHash, this.hash,
    ];
  }
}
