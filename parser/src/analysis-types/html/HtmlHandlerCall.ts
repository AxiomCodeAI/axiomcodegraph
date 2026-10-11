import { WEB_TEXT_LIMIT } from '@/constants/web-constants';
import { HtmlHandlerSource } from '@/enums/html/HtmlHandlerSource';

import { WebRow, bool, boundedText, num, text } from '../web/web-row';

/**
 * One call written inside an event-handler attribute or a `javascript:` URL.
 *
 * `onclick="save(this); tracker.log('x')"` is two rows. The callee is kept three ways —
 * `calleeName` is the last identifier (`log`), `receiverText` what it is called on
 * (`tracker`, or empty), `calleeText` the whole callee as written — because a global
 * function from a classic `<script src>` resolves by `calleeName` alone and a member
 * call needs its receiver. Every call in the text is a row, nested ones too:
 * `if (confirm('?')) remove()` reaches both. Resolution is the engine's, exactly as
 * for a JavaScript call site: the row carries the name, not a target.
 */
export class HtmlHandlerCall extends WebRow {
  static readonly COLUMNS = [
    'handlerSource', 'eventName', 'calleeName', 'receiverText', 'calleeText', 'argumentCount',
    'isNew', 'position', 'startLine', 'startColumn', 'ownerElementLinkHash', 'attributeLinkHash',
    'documentLinkHash', 'serviceVersionLinkHash', 'htmlHandlerCallUniqueHash',
  ] as const;

  readonly relation = 'html_handler_call';
  readonly columns = HtmlHandlerCall.COLUMNS;

  readonly handlerSource: HtmlHandlerSource;
  readonly eventName: string;
  readonly calleeName: string;
  readonly receiverText: string;
  readonly calleeText: string;
  readonly argumentCount: number;
  readonly isNew: boolean;
  readonly position: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly ownerElementLinkHash: string;
  readonly attributeLinkHash: string;
  readonly documentLinkHash: string;
  readonly serviceVersionLinkHash: string;

  constructor(props: {
    handlerSource: HtmlHandlerSource; eventName: string; calleeName: string; receiverText: string;
    calleeText: string; argumentCount: number; isNew: boolean; position: number; startLine: number;
    startColumn: number; ownerElementLinkHash: string; attributeLinkHash: string;
    documentLinkHash: string; serviceVersionLinkHash: string;
  }) {
    super();
    this.handlerSource = props.handlerSource;
    this.eventName = props.eventName;
    this.calleeName = props.calleeName;
    this.receiverText = props.receiverText;
    this.calleeText = props.calleeText;
    this.argumentCount = props.argumentCount;
    this.isNew = props.isNew;
    this.position = props.position;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.ownerElementLinkHash = props.ownerElementLinkHash;
    this.attributeLinkHash = props.attributeLinkHash;
    this.documentLinkHash = props.documentLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `HTML_HANDLER_CALL_md5(attributeLinkHash ‖ position)`. */
  generateHash(): void {
    this.hash = WebRow.key('HTML_HANDLER_CALL', this.attributeLinkHash, this.position);
  }

  protected values(): string[] {
    return [
      this.handlerSource, text(this.eventName), text(this.calleeName),
      boundedText(this.receiverText, WEB_TEXT_LIMIT), boundedText(this.calleeText, WEB_TEXT_LIMIT),
      num(this.argumentCount), bool(this.isNew), num(this.position), num(this.startLine),
      num(this.startColumn), this.ownerElementLinkHash, this.attributeLinkHash,
      this.documentLinkHash, this.serviceVersionLinkHash, this.hash,
    ];
  }
}
