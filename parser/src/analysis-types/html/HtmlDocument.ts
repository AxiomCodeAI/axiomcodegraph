import { CssSourceProvenance } from '@/enums/css/CssStylesheetSource';
import { HtmlDocumentKind } from '@/enums/html/HtmlDocumentKind';
import { HtmlTemplateDialect } from '@/enums/html/HtmlTemplateDialect';

import { stableRootId } from '../stable-root-id';
import { WebRow, commaSet, num, text } from '../web/web-row';

/**
 * One HTML file — the root of every HTML key.
 *
 * `relativePath` is the file's path from `baseMservPath` with `/` separators, so the
 * key is portable across machines; `filePath` is the absolute path a reader opens.
 * The counts are back-patched once the tree is walked: they describe the document
 * and are not part of its identity.
 */
export class HtmlDocument extends WebRow {
  static readonly COLUMNS = [
    'name', 'fileName', 'filePath', 'baseMservPath', 'relativePath', 'documentKind', 'doctype',
    'lang', 'title', 'templateDialects', 'sourceProvenance', 'elementCount', 'scriptCount',
    'inlineScriptCount', 'stylesheetReferenceCount', 'inlineStyleCount', 'parseGapCount',
    'startLine', 'endLine', 'serviceVersionLinkHash', 'htmlDocumentUniqueHash',
  ] as const;

  readonly relation = 'html_document';
  readonly columns = HtmlDocument.COLUMNS;

  readonly name: string;
  readonly fileName: string;
  readonly filePath: string;
  readonly baseMservPath: string;
  readonly relativePath: string;
  readonly documentKind: HtmlDocumentKind;
  readonly doctype: string;
  readonly lang: string;
  readonly templateDialects: ReadonlySet<HtmlTemplateDialect>;
  readonly sourceProvenance: CssSourceProvenance;
  readonly startLine: number;
  readonly endLine: number;
  readonly serviceVersionLinkHash: string;

  /** Back-patched: the `<title>` is met during the walk, after the row is minted; it is not part of the key. */
  private title: string;
  private elementCount = 0;
  private scriptCount = 0;
  private inlineScriptCount = 0;
  private stylesheetReferenceCount = 0;
  private inlineStyleCount = 0;
  private parseGapCount = 0;

  constructor(props: {
    name: string; fileName: string; filePath: string; baseMservPath: string; relativePath: string;
    documentKind: HtmlDocumentKind; doctype: string; lang: string; title: string;
    templateDialects: ReadonlySet<HtmlTemplateDialect>; sourceProvenance: CssSourceProvenance;
    startLine: number; endLine: number; serviceVersionLinkHash: string;
  }) {
    super();
    this.name = props.name;
    this.fileName = props.fileName;
    this.filePath = props.filePath;
    this.baseMservPath = props.baseMservPath;
    this.relativePath = props.relativePath;
    this.documentKind = props.documentKind;
    this.doctype = props.doctype;
    this.lang = props.lang;
    this.title = props.title;
    this.templateDialects = props.templateDialects;
    this.sourceProvenance = props.sourceProvenance;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `HTML_DOCUMENT_md5(relativePath ‖ rootId ‖ serviceVersionLinkHash)`. */
  generateHash(): void {
    this.hash = WebRow.key('HTML_DOCUMENT', this.relativePath, stableRootId(this.baseMservPath), this.serviceVersionLinkHash);
  }

  setCounts(counts: {
    elementCount: number; scriptCount: number; inlineScriptCount: number;
    stylesheetReferenceCount: number; inlineStyleCount: number; parseGapCount: number;
  }): void {
    this.elementCount = counts.elementCount;
    this.scriptCount = counts.scriptCount;
    this.inlineScriptCount = counts.inlineScriptCount;
    this.stylesheetReferenceCount = counts.stylesheetReferenceCount;
    this.inlineStyleCount = counts.inlineStyleCount;
    this.parseGapCount = counts.parseGapCount;
  }

  setTitle(title: string): void {
    this.title = title;
  }

  getTitle(): string { return this.title; }
  getElementCount(): number { return this.elementCount; }
  getParseGapCount(): number { return this.parseGapCount; }

  protected values(): string[] {
    return [
      text(this.name), text(this.fileName), text(this.filePath), text(this.baseMservPath),
      text(this.relativePath), this.documentKind, text(this.doctype), text(this.lang),
      text(this.title), commaSet(this.templateDialects), this.sourceProvenance,
      num(this.elementCount), num(this.scriptCount), num(this.inlineScriptCount),
      num(this.stylesheetReferenceCount), num(this.inlineStyleCount), num(this.parseGapCount),
      num(this.startLine), num(this.endLine), this.serviceVersionLinkHash, this.hash,
    ];
  }
}


