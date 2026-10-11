import * as ts from 'typescript';

/** One call found in an event-handler attribute's text. */
export interface HandlerCall {
  readonly calleeName: string;
  readonly receiverText: string;
  readonly calleeText: string;
  readonly argumentCount: number;
  readonly isNew: boolean;
  /** 0-based offset of the call's first token, within the handler text. */
  readonly offset: number;
}

export interface HandlerParse {
  readonly calls: HandlerCall[];
  /** The first syntax error's message and offset, when the text is not a script. */
  readonly error?: { message: string; offset: number };
}

/**
 * Every call written in a handler's text, read by the TypeScript compiler's syntax
 * layer as a JavaScript script — the same reader the JavaScript front end uses, so
 * `onclick="a.b(c)"` is read exactly as `a.b(c)` in a `.js` file would be.
 *
 * Every call is reported, nested ones too, in source order: `if (ok()) go()` is two.
 * A text that does not parse still reports the calls the recovered tree holds, with
 * `error` set so the caller can record the gap; a template placeholder in a handler
 * (`onclick="{{ fn }}"`) is the common case.
 */
export function handlerCallsOf(text: string): HandlerParse {
  const sf = ts.createSourceFile('handler.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const calls: HandlerCall[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression;
      let calleeName = '';
      let receiverText = '';
      if (ts.isIdentifier(callee)) {
        calleeName = callee.text;
      } else if (ts.isPropertyAccessExpression(callee)) {
        calleeName = callee.name.text;
        receiverText = callee.expression.getText(sf);
      } else if (ts.isElementAccessExpression(callee)) {
        receiverText = callee.expression.getText(sf);
      }
      calls.push({
        calleeName,
        receiverText,
        calleeText: callee.getText(sf),
        argumentCount: node.arguments?.length ?? 0,
        isNew: ts.isNewExpression(node),
        offset: node.getStart(sf),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const diagnostics = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  const first = diagnostics[0];
  return first === undefined
    ? { calls }
    : {
      calls,
      error: {
        message: ts.flattenDiagnosticMessageText(first.messageText, ' '),
        offset: first.start ?? 0,
      },
    };
}
