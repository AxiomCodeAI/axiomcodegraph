import { WEB_TEXT_LIMIT } from '@/constants/web-constants';
import { HtmlNamespace } from '@/enums/html/HtmlNamespace';

import { WebRow, bool, boundedText, commaList, num, text } from '../web/web-row';

/**
 * One element of a page.
 *
 * `path` is an XPath-like address with sibling indexes (`/html[1]/body[1]/div[2]/a[1]`),
 * unique within a document, and it is what the key chains on: two `<a>` on one line are
 * two elements. `id` and `classNames` are repeated here from the attributes because they
 * are the two columns a consumer joins CSS and script references on; the attribute rows
 * still exist and carry the position.
 *
 * Only elements WRITTEN in the source are rows: the grammar does not insert the `html`,
 * `head` and `body` a browser would imply, so a fragment's top-level elements have no
 * parent and chain straight to the document.
 */
export class HtmlElement extends WebRow {
  static readonly COLUMNS = [
    'tagName', 'namespace', 'path', 'depth', 'id', 'classNames', 'textContent', 'isVoid', 'childElementCount', 'attributeCount', 'position', 'startLine', 'startColumn',
    'endLine', 'endColumn', 'parentElementLinkHash', 'documentLinkHash',
    'serviceVersionLinkHash', 'htmlElementUniqueHash',
  ] as const;

  readonly relation = 'html_element';
  readonly columns = HtmlElement.COLUMNS;

  readonly tagName: string;
  readonly namespace: HtmlNamespace;
  readonly path: string;
  readonly depth: number;
  readonly id: string;
  readonly classNames: readonly string[];
  readonly textContent: string;
  readonly isVoid: boolean;
  readonly childElementCount: number;
  readonly attributeCount: number;
  readonly position: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly parentElementLinkHash: string;
  readonly documentLinkHash: string;
  readonly serviceVersionLinkHash: string;

  constructor(props: {
    tagName: string; namespace: HtmlNamespace; path: string; depth: number; id: string;
    classNames: readonly string[]; textContent: string; isVoid: boolean;
    childElementCount: number; attributeCount: number; position: number; startLine: number;
    startColumn: number; endLine: number; endColumn: number; parentElementLinkHash: string;
    documentLinkHash: string; serviceVersionLinkHash: string;
  }) {
    super();
    this.tagName = props.tagName;
    this.namespace = props.namespace;
    this.path = props.path;
    this.depth = props.depth;
    this.id = props.id;
    this.classNames = props.classNames;
    this.textContent = props.textContent;
    this.isVoid = props.isVoid;
    this.childElementCount = props.childElementCount;
    this.attributeCount = props.attributeCount;
    this.position = props.position;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.endLine = props.endLine;
    this.endColumn = props.endColumn;
    this.parentElementLinkHash = props.parentElementLinkHash;
    this.documentLinkHash = props.documentLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `HTML_ELEMENT_md5(documentLinkHash ‖ path)`. */
  generateHash(): void {
    this.hash = WebRow.key('HTML_ELEMENT', this.documentLinkHash, this.path);
  }

  protected values(): string[] {
    return [
      text(this.tagName), this.namespace, text(this.path), num(this.depth), text(this.id),
      text(commaList(this.classNames)), boundedText(this.textContent, WEB_TEXT_LIMIT),
      bool(this.isVoid), num(this.childElementCount),
      num(this.attributeCount), num(this.position), num(this.startLine), num(this.startColumn),
      num(this.endLine), num(this.endColumn), this.parentElementLinkHash, this.documentLinkHash,
      this.serviceVersionLinkHash, this.hash,
    ];
  }
}
