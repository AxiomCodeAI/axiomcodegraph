import Parser from 'tree-sitter';
import Java from 'tree-sitter-java';

import { FILE_EXTENSIONS } from '@/constants/consts';
import { LanguageParser } from '@/parsers/language-parser';
import { ProjectLanguage } from '@/types/ProjectInfo';
import { withRetry } from '@/utils/retry-decorator';

/**
 * Java-specific tree-sitter parser implementation
 */
export class JavaParser implements LanguageParser {
  readonly language = ProjectLanguage.JAVA;
  readonly fileExtension = FILE_EXTENSIONS.JAVA;
  
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Java);
  }

  /**
   * Parses Java source code into a syntax tree
   * Uses callback-based parsing for large files to avoid tree-sitter buffer limits
   * @param sourceCode Java source code as string
   * @returns Parsed syntax tree
   * @throws Error if sourceCode is invalid
   */
  parse(sourceCode: string): Parser.Tree {
    if (!sourceCode || typeof sourceCode !== 'string') {
      throw new Error('Invalid source code: must be a non-empty string');
    }
    
    // Use callback-based parsing for files > 30KB to avoid tree-sitter internal buffer limits
    // This is a known limitation: direct string parsing fails around 32-35KB
    const useCallbackParsing = sourceCode.length > 30000;
    
    const parseWithRetry = withRetry(
      (code: string) => {
        if (useCallbackParsing) {
          // Callback-based streaming parser (works for large files)
          return this.parser.parse((index: number) => {
            if (index >= code.length) {
              return null;
            }
            // Return chunks of 8KB for efficient parsing
            const chunkSize = 8192;
            const chunk = code.substring(index, Math.min(index + chunkSize, code.length));
            return chunk;
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
          console.warn(`[JavaParser] Parse attempt ${attempt} failed: ${error.message}, retrying...`);
        }
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
