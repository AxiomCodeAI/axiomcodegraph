import { CssSourceProvenance, CssStylesheetSource } from '@/enums/css/CssStylesheetSource';

import { stableRootId } from '../stable-root-id';
import { WebRow, num, text } from '../web/web-row';

/**
 * One stylesheet — the root of every CSS key.
 *
 * A `.css` file is keyed on its path from the root (portable, as the HTML document is).
 * A `<style>` element's sheet is keyed on the HTML ELEMENT that holds it, so the same
 * text in two pages is two sheets and a page with two `<style>` blocks has two rows
 * at two positions; `filePath` is then the page's and `startLine` is where the CSS
 * begins inside it. The counts are back-patched after extraction.
 */
export class CssStylesheet extends WebRow {
  static readonly COLUMNS = [
    'name', 'fileName', 'filePath', 'baseMservPath', 'relativePath', 'sourceKind', 'sourceProvenance',
    'ownerHtmlElementLinkHash', 'htmlDocumentLinkHash', 'startLine', 'startColumn', 'endLine',
    'ruleCount', 'declarationCount', 'parseGapCount', 'serviceVersionLinkHash', 'cssStylesheetUniqueHash',
  ] as const;

  readonly relation = 'css_stylesheet';
  readonly columns = CssStylesheet.COLUMNS;

  readonly name: string;
  readonly fileName: string;
  readonly filePath: string;
  readonly baseMservPath: string;
  readonly relativePath: string;
  readonly sourceKind: CssStylesheetSource;
  readonly sourceProvenance: CssSourceProvenance;
  readonly ownerHtmlElementLinkHash: string;
  readonly htmlDocumentLinkHash: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly serviceVersionLinkHash: string;

  private ruleCount = 0;
  private declarationCount = 0;
  private parseGapCount = 0;

  constructor(props: {
    name: string; fileName: string; filePath: string; baseMservPath: string; relativePath: string;
    sourceKind: CssStylesheetSource; sourceProvenance: CssSourceProvenance; ownerHtmlElementLinkHash: string;
    htmlDocumentLinkHash: string; startLine: number; startColumn: number; endLine: number;
    serviceVersionLinkHash: string;
  }) {
    super();
    this.name = props.name;
    this.fileName = props.fileName;
    this.filePath = props.filePath;
    this.baseMservPath = props.baseMservPath;
    this.relativePath = props.relativePath;
    this.sourceKind = props.sourceKind;
    this.sourceProvenance = props.sourceProvenance;
    this.ownerHtmlElementLinkHash = props.ownerHtmlElementLinkHash;
    this.htmlDocumentLinkHash = props.htmlDocumentLinkHash;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.endLine = props.endLine;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** a file: `CSS_STYLESHEET_md5(FILE ‖ relativePath ‖ rootId ‖ serviceVersionLinkHash)`;
   * a `<style>` element: `CSS_STYLESHEET_md5(HTML_STYLE_ELEMENT ‖ ownerHtmlElementLinkHash)`.
   */
  generateHash(): void {
    this.hash = this.sourceKind === CssStylesheetSource.FILE
      ? WebRow.key('CSS_STYLESHEET', this.sourceKind, this.relativePath, stableRootId(this.baseMservPath), this.serviceVersionLinkHash)
      : WebRow.key('CSS_STYLESHEET', this.sourceKind, this.ownerHtmlElementLinkHash);
  }

  setCounts(counts: { ruleCount: number; declarationCount: number; parseGapCount: number }): void {
    this.ruleCount = counts.ruleCount;
    this.declarationCount = counts.declarationCount;
    this.parseGapCount = counts.parseGapCount;
  }

  getRuleCount(): number { return this.ruleCount; }
  getDeclarationCount(): number { return this.declarationCount; }
  getParseGapCount(): number { return this.parseGapCount; }

  protected values(): string[] {
    return [
      text(this.name), text(this.fileName), text(this.filePath), text(this.baseMservPath),
      text(this.relativePath), this.sourceKind, this.sourceProvenance, this.ownerHtmlElementLinkHash,
      this.htmlDocumentLinkHash, num(this.startLine), num(this.startColumn), num(this.endLine),
      num(this.ruleCount), num(this.declarationCount), num(this.parseGapCount),
      this.serviceVersionLinkHash, this.hash,
    ];
  }
}
