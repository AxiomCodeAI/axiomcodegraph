import Parser from 'tree-sitter';

import { CommentRegistry } from '@/analysis-types/java/CommentRegistry';
import { CommentKind } from '@/enums/java/comments';

/**
 * Extracts comments from Java source code and associates them with
 * the nearest code entity (type, method, field, variable, expression, annotation).
 *
 * ## Association Strategy
 *
 * Uses tree-sitter AST sibling relationships:
 * 1. **Next sibling**: Comment directly precedes an entity → linked to that entity
 * 2. **Previous sibling (same line)**: End-of-line comment → linked to entity on same line
 * 3. **Parent fallback**: Orphan comments → linked to containing entity
 *
 * ## Comment Grouping
 *
 * Multiple consecutive comments before the same entity are grouped with
 * ascending `commentIndex` values (0, 1, 2, ...).
 */
export class CommentExtractor {
  /**
   * Extracts all comments from a parsed Java file and links them to entities.
   *
   * @param rootNode The root AST node of the parsed file
   * @param filePath Path of the source file
   * @param positionToHash Map of "startLine:startColumn" → entity hash
   *                       for all extracted entities (types, methods, fields, etc.)
   * @returns Array of CommentRegistry entries
   */
  extract(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    positionToHash: Map<string, string>
  ): CommentRegistry[] {
    // Collect all comment nodes from the AST
    const commentNodes = this.collectCommentNodes(rootNode);

    if (commentNodes.length === 0) {
      return [];
    }

    // Build a sorted list of entity positions for closest-entity lookup
    const entityPositions = this.buildSortedEntityPositions(positionToHash);

    // Track comment groups: consecutive comments before the same entity
    const results: CommentRegistry[] = [];
    let lastOwnerHash: string | null = null;
    let commentIndex = 0;

    for (const commentNode of commentNodes) {
      const kind = this.classifyComment(commentNode);
      const text = commentNode.text;
      const startLine = commentNode.startPosition.row + 1;
      const startColumn = commentNode.startPosition.column;
      const endLine = commentNode.endPosition.row + 1;
      const endColumn = commentNode.endPosition.column;

      // Determine the owner entity hash
      const ownerHash = this.findOwnerHash(
        commentNode,
        positionToHash,
        entityPositions
      );

      if (!ownerHash) {
        // No entity found to link this comment to — skip
        continue;
      }

      // Track comment grouping index
      if (ownerHash === lastOwnerHash) {
        commentIndex++;
      } else {
        commentIndex = 0;
        lastOwnerHash = ownerHash;
      }

      const comment = CommentRegistry.builder(
        kind,
        text,
        filePath,
        startLine,
        startColumn,
        endLine,
        endColumn,
        ownerHash,
        commentIndex
      ).build();

      results.push(comment);
    }

    return results;
  }

  /**
   * Recursively collects all comment nodes from the AST, in source order.
   */
  private collectCommentNodes(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const comments: Parser.SyntaxNode[] = [];
    const visit = (n: Parser.SyntaxNode) => {
      if (n.type === 'line_comment' || n.type === 'block_comment') {
        comments.push(n);
        return; // Comments don't have meaningful children
      }
      for (const child of n.children) {
        visit(child);
      }
    };
    visit(node);
    return comments;
  }

  /**
   * Classifies a comment node into LINE_COMMENT, BLOCK_COMMENT, or JAVADOC.
   */
  private classifyComment(node: Parser.SyntaxNode): CommentKind {
    if (node.type === 'line_comment') {
      return CommentKind.LINE_COMMENT;
    }
    // block_comment: check if it starts with /** (Javadoc)
    if (node.text.startsWith('/**')) {
      return CommentKind.JAVADOC;
    }
    return CommentKind.BLOCK_COMMENT;
  }

  /**
   * Finds the entity hash that should own this comment.
   *
   * Strategy:
   * 1. Look at nextNamedSibling — if it maps to an entity, use that
   * 2. If comment is on the same line as previousNamedSibling end, use that (end-of-line)
   * 3. Fall back to the closest entity starting after this comment's end
   * 4. Fall back to parent entity
   */
  private findOwnerHash(
    commentNode: Parser.SyntaxNode,
    positionToHash: Map<string, string>,
    entityPositions: { line: number; col: number; hash: string }[]
  ): string | null {
    // Strategy 1: Next named sibling
    const nextSibling = commentNode.nextNamedSibling;
    if (nextSibling) {
      const hash = this.lookupHash(nextSibling, positionToHash);
      if (hash) return hash;
    }

    // Strategy 2: End-of-line comment — previous sibling on same line
    const prevSibling = commentNode.previousNamedSibling;
    if (prevSibling) {
      const commentStartLine = commentNode.startPosition.row;
      const prevEndLine = prevSibling.endPosition.row;
      if (commentStartLine === prevEndLine) {
        const hash = this.lookupHash(prevSibling, positionToHash);
        if (hash) return hash;
      }
    }

    // Strategy 3: Find closest entity starting after this comment
    const commentEndLine = commentNode.endPosition.row + 1;
    const commentEndCol = commentNode.endPosition.column;
    const closest = this.findClosestEntityAfter(
      entityPositions,
      commentEndLine,
      commentEndCol
    );
    if (closest) return closest;

    // Strategy 4: Walk up parents until we find a mapped entity
    let parent = commentNode.parent;
    while (parent) {
      const hash = this.lookupHash(parent, positionToHash);
      if (hash) return hash;
      parent = parent.parent;
    }

    return null;
  }

  /**
   * Looks up an AST node's position in the entity hash map.
   * Tries the node itself and, for declarations with modifiers/annotations,
   * tries the declaration keyword child (e.g., class name identifier).
   */
  private lookupHash(
    node: Parser.SyntaxNode,
    positionToHash: Map<string, string>
  ): string | null {
    // Direct position lookup
    const key = `${node.startPosition.row + 1}:${node.startPosition.column}`;
    const hash = positionToHash.get(key);
    if (hash) return hash;

    // For annotated declarations, the entity start position may be the
    // declaration node itself (which includes annotations/modifiers),
    // so also try child named nodes
    for (const child of node.namedChildren) {
      if (child.type === 'line_comment' || child.type === 'block_comment') continue;
      const childKey = `${child.startPosition.row + 1}:${child.startPosition.column}`;
      const childHash = positionToHash.get(childKey);
      if (childHash) return childHash;
    }

    return null;
  }

  /**
   * Builds a sorted array of entity positions for binary search.
   */
  private buildSortedEntityPositions(
    positionToHash: Map<string, string>
  ): { line: number; col: number; hash: string }[] {
    const positions: { line: number; col: number; hash: string }[] = [];
    for (const [key, hash] of positionToHash) {
      const [lineStr, colStr] = key.split(':');
      positions.push({
        line: parseInt(lineStr!, 10),
        col: parseInt(colStr!, 10),
        hash,
      });
    }
    positions.sort((a, b) => a.line - b.line || a.col - b.col);
    return positions;
  }

  /**
   * Binary search for the closest entity starting at or after the given position.
   */
  private findClosestEntityAfter(
    positions: { line: number; col: number; hash: string }[],
    line: number,
    col: number
  ): string | null {
    let lo = 0;
    let hi = positions.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const pos = positions[mid]!;
      if (pos.line < line || (pos.line === line && pos.col < col)) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (lo < positions.length) {
      return positions[lo]!.hash;
    }
    return null;
  }
}
