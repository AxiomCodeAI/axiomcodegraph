import Parser from 'tree-sitter';

import { WEB_CALLBACK_PARSE_THRESHOLD, WEB_PARSE_CHUNK_SIZE } from '@/constants/web-constants';
import { withRetry } from '@/utils/retry-decorator';

/**
 * Parses `text` with a tree-sitter parser, streaming it in chunks past the runtime's
 * single-buffer ceiling, exactly as the Java and Python parsers do. The web front end
 * meets the ceiling routinely: a minified stylesheet is one line of hundreds of
 * kilobytes, and a generated page is larger still.
 *
 * Positions on the returned tree are UTF-16 code-unit offsets into `text`, the same
 * units `String.prototype.indexOf` uses, so `LineIndex` maps them without conversion.
 */
export function parseWithTreeSitter(parser: Parser, text: string): Parser.Tree {
  const parse = withRetry(
    (code: string): Parser.Tree => {
      if (code.length <= WEB_CALLBACK_PARSE_THRESHOLD) {
        return parser.parse(code);
      }
      return parser.parse((index: number) => (index >= code.length
        ? null
        : code.substring(index, Math.min(index + WEB_PARSE_CHUNK_SIZE, code.length))));
    },
    { maxAttempts: 3, delayMs: 100, exponentialBackoff: true }
  );
  return parse(text);
}

/** The named children of a node, with an ERROR node's own named children lifted into the list. */
export function namedChildrenThroughErrors(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  const visit = (n: Parser.SyntaxNode): void => {
    for (const child of n.namedChildren) {
      if (child.type === 'ERROR') {
        visit(child);
      } else {
        out.push(child);
      }
    }
  };
  visit(node);
  return out;
}
