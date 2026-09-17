import Parser from 'tree-sitter';
// The FORKED grammar, not the published one. See vendor/tree-sitter-c-sharp/README.md
// and the gate below: installing the published package costs 6.44% of declarations
// and raises no error at all.
import CSharp from 'tree-sitter-c-sharp-fork';

import { FILE_EXTENSIONS } from '@/constants/consts';
import {
  CSHARP_CALLBACK_PARSE_THRESHOLD,
  CSHARP_PARSE_CHUNK_SIZE,
} from '@/constants/csharp-constants';
import { assertPatchedGrammar } from '@/parsers/csharp/grammar-gate';
import { LanguageParser } from '@/parsers/language-parser';
import { ProjectLanguage } from '@/types/ProjectInfo';
import { withRetry } from '@/utils/retry-decorator';

/**
 * C#-specific tree-sitter parser.
 *
 * ## The 32,767-character parse limit
 *
 * tree-sitter cannot parse a buffer longer than 32,767 characters in one shot.
 * This parser owns the workaround so every consumer inherits it, rather than
 * each extractor rediscovering it — the same reason `java-parser.ts` and
 * `python-parser.ts` own theirs. C# files run long: measured on the 9,568-file
 * corpus, the limit is the common path for real code and not an edge case, and
 * the failure is a throw rather than a silent truncation.
 *
 * ## The grammar gate
 *
 * The constructor asserts the installed grammar is the patched fork. It is a
 * constructor check and not a comment because the failure mode of the wrong
 * grammar is that **nothing throws** — 6% of declarations simply are not there.
 * See {@link assertPatchedGrammar}.
 *
 * ## The byte-order mark
 *
 * A UTF-8 BOM is an ENCODING PREAMBLE, not the first character of the program.
 * Roslyn's `SourceText` decodes it away, so every position Roslyn reports is
 * into text that never contained it. Left in place it is a character of line 1,
 * and every column on line 1 is one too far right — silently, because the file
 * still parses and every row is still there. 457 of modern-app-A's 547 files carry
 * one; the only rows that moved were the ones with a call on line 1, which is
 * why nine sites read as nine lost rows and nine phantom ones rather than as
 * the single encoding fact it is.
 *
 * It is stripped HERE, next to the 32,767-character workaround and for the
 * same reason: one place, so every consumer inherits it rather than each
 * extractor rediscovering it. {@link stripUtf8Bom} is exported so a caller
 * that also needs the source text can normalise the SAME string it hands in —
 * a tree built from stripped text and a length measured on unstripped text
 * disagree by three bytes, and the parse-gap rows are computed from that
 * length.
 *
 * ## Why the file is never split
 *
 * Splitting the source and parsing the halves would produce two roots with no
 * containment between them, and counts that look plausible while the scope
 * forest is silently wrong. The callback streams one logical parse over one
 * tree instead.
 */
/**
 * U+FEFF at the start of a decoded UTF-8 stream — the byte-order mark.
 *
 * Only at the START. A U+FEFF anywhere else is a zero-width no-break space and
 * a legal character of the program, so `replace` would be wrong; the preamble
 * is a property of position 0 alone.
 */
const UTF8_BOM = '\uFEFF';

/**
 * Removes a leading UTF-8 BOM, and nothing else.
 *
 * Idempotent: a string with no BOM is returned unchanged, so calling it on a
 * value that has already been normalised is safe and a caller does not have to
 * track whether it has.
 */
export function stripUtf8Bom(sourceCode: string): string {
  return sourceCode.startsWith(UTF8_BOM) ? sourceCode.slice(UTF8_BOM.length) : sourceCode;
}

export class CSharpParser implements LanguageParser {
  readonly language = ProjectLanguage.CSHARP;
  readonly fileExtension = FILE_EXTENSIONS.CSHARP;

  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(CSharp);
    assertPatchedGrammar(this.parser);
  }

  /**
   * Parses C# source into a syntax tree.
   *
   * @param sourceCode C# source as a string
   * @returns the parsed tree
   * @throws if `sourceCode` is not a string
   */
  parse(sourceCode: string): Parser.Tree {
    if (typeof sourceCode !== 'string') {
      throw new Error('Invalid source code: must be a string');
    }
    // Before the length is measured, because a file that is nothing but a BOM
    // is an EMPTY compilation unit and must take the empty path below.
    const source = stripUtf8Bom(sourceCode);
    // An EMPTY file is deliberately accepted. A C# file containing nothing but
    // a `global using` that was stripped, or an empty partial placeholder, is a
    // legal compilation unit and still needs its cs_module row.
    if (source.length === 0) {
      return this.parser.parse('');
    }

    // Measured in CHARACTERS, matching the limit's own unit.
    const useCallbackParsing = source.length > CSHARP_CALLBACK_PARSE_THRESHOLD;

    const parseWithRetry = withRetry(
      (code: string) => {
        if (useCallbackParsing) {
          return this.parser.parse((index: number) => {
            if (index >= code.length) {
              return null;
            }
            return code.substring(index, Math.min(index + CSHARP_PARSE_CHUNK_SIZE, code.length));
          });
        }
        return this.parser.parse(code);
      },
      {
        maxAttempts: 3,
        delayMs: 1500,
        exponentialBackoff: true,
        onRetry: (attempt, error) => {
          console.warn(`[CSharpParser] Parse attempt ${attempt} failed: ${error.message}, retrying...`);
        },
      }
    );

    return parseWithRetry(source);
  }

  getRootNode(tree: Parser.Tree): Parser.SyntaxNode {
    return tree.rootNode;
  }

  query(node: Parser.SyntaxNode, queryString: string): Parser.QueryMatch[] {
    const query = this.parser.getLanguage().query(queryString);
    return query.matches(node);
  }
}
