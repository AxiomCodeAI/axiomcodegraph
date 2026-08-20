import Parser from 'tree-sitter';

import { ProjectLanguage } from '@/types/ProjectInfo';

/**
 * Generic interface for language-specific tree-sitter parsers
 */
export interface LanguageParser {
  /**
   * The programming language this parser handles
   */
  readonly language: ProjectLanguage;

  /**
   * File extension this parser handles (e.g., '.java', '.py')
   */
  readonly fileExtension: string;

  /**
   * Parses source code into a syntax tree
   * @param sourceCode Source code as string
   * @returns Parsed syntax tree
   */
  parse(sourceCode: string): Parser.Tree;

  /**
   * Gets the root node of a parsed tree
   * @param tree Parsed syntax tree
   * @returns Root syntax node
   */
  getRootNode(tree: Parser.Tree): Parser.SyntaxNode;

  /**
   * Queries the syntax tree using tree-sitter query syntax
   * @param node Starting node for the query
   * @param queryString Tree-sitter query string
   * @returns Query matches
   */
  query(node: Parser.SyntaxNode, queryString: string): Parser.QueryMatch[];
}
