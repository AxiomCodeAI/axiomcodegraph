import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';

import { FILE_EXTENSIONS } from '@/constants/consts';
import {
  PYTHON_CALLBACK_PARSE_THRESHOLD,
  PYTHON_PARSE_CHUNK_SIZE,
} from '@/constants/python-constants';
import { LanguageParser } from '@/parsers/language-parser';
import { ProjectLanguage } from '@/types/ProjectInfo';
import { withRetry } from '@/utils/retry-decorator';

/**
 * Python-specific tree-sitter parser implementation.
 *
 * ## The 32,767-character parse limit
 *
 * tree-sitter cannot parse a buffer longer than **32,767 characters**
 * (2^15 - 1) in one shot. This parser owns the workaround so that every
 * consumer inherits it, rather than each extractor rediscovering it: three of
 * five stdlib packages fail to parse without the callback path, so this is the
 * common path for real Python, not an edge case.
 *
 * Two properties of the limit are worth stating because both are easy to get
 * wrong:
 *
 * - **Characters, not bytes.** 29k characters of CJK is 62KB of UTF-8 and
 *   parses fine. A byte-length guard is wrong in both directions.
 * - **The callback's returned chunk carries the same ceiling.** Streaming does
 *   not lift the limit, it only keeps each buffer under it, so a 65536-byte
 *   chunk throws exactly as a direct parse would. Hence the 8KB chunk size.
 *
 * ## Why the file is never split
 *
 * Splitting the source and parsing the halves would produce two roots with no
 * module containment between them, and counts that look plausible while the
 * scope forest is silently wrong — the failure mode this parser is organised
 * against. The callback streams one logical parse over one tree instead.
 */
export class PythonParser implements LanguageParser {
  readonly language = ProjectLanguage.PYTHON;
  readonly fileExtension = FILE_EXTENSIONS.PYTHON;

  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Python);
  }

  /**
   * Parses Python source code into a syntax tree.
   *
   * Uses callback-based streaming above {@link PYTHON_CALLBACK_PARSE_THRESHOLD}
   * characters to stay under tree-sitter's internal buffer ceiling.
   *
   * @param sourceCode Python source code as string
   * @returns Parsed syntax tree
   * @throws Error if sourceCode is invalid
   */
  parse(sourceCode: string): Parser.Tree {
    if (typeof sourceCode !== 'string') {
      throw new Error('Invalid source code: must be a string');
    }
    // An EMPTY file is deliberately accepted. `__init__.py` is empty in 438 of
    // the 10,769 files in the local stdlib and site-packages, and every one of
    // them is a legal module with a real module scope and an empty binding set.
    // Rejecting them would drop a fact set that CPython produces happily.
    if (sourceCode.length === 0) {
      return this.parser.parse('');
    }

    // Measured in CHARACTERS, matching the limit's own unit. `.length` is UTF-16
    // code units, which is the conservative direction: it never under-counts
    // relative to tree-sitter's accounting for the BMP text Python source is.
    const useCallbackParsing = sourceCode.length > PYTHON_CALLBACK_PARSE_THRESHOLD;

    const parseWithRetry = withRetry(
      (code: string) => {
        if (useCallbackParsing) {
          // Callback-based streaming parser (works for large files)
          return this.parser.parse((index: number) => {
            if (index >= code.length) {
              return null;
            }
            // Each returned chunk is itself subject to the 32,767-char ceiling,
            // so the chunk size is a hard requirement, not a tuning knob.
            return code.substring(index, Math.min(index + PYTHON_PARSE_CHUNK_SIZE, code.length));
          });
        } else {
          // Direct string parsing (faster for small files)
          return this.parser.parse(code);
        }
      },
      {
        maxAttempts: 3,
        delayMs: 1500,
        exponentialBackoff: true,
        onRetry: (attempt, error) => {
          console.warn(`[PythonParser] Parse attempt ${attempt} failed: ${error.message}, retrying...`);
        },
      }
    );

    return parseWithRetry(sourceCode);
  }

  /**
   * Gets the root node of a parsed tree
   * @param tree Parsed syntax tree
   * @returns Root syntax node
   */
  getRootNode(tree: Parser.Tree): Parser.SyntaxNode {
    return tree.rootNode;
  }

  /**
   * Queries the syntax tree using tree-sitter query syntax
   * @param node Starting node for the query
   * @param queryString Tree-sitter query string
   * @returns Query matches
   */
  query(node: Parser.SyntaxNode, queryString: string): Parser.QueryMatch[] {
    const query = this.parser.getLanguage().query(queryString);
    return query.matches(node);
  }
}
