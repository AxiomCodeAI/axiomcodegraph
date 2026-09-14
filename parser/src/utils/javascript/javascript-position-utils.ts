import * as ts from 'typescript';

/**
 * Source positions for the JavaScript front end.
 *
 * ## Why this is a util and not three private methods
 *
 * `startLine` and `startColumn` are in the **primary key** of `js_module`,
 * `js_type`, `js_method`, `js_scope`, `js_variable`, `js_field`, `js_import`,
 * `js_export`, `js_block`, `js_expression`, `js_type_reference`, `js_comment`
 * and `js_parse_gap` — thirteen of sixteen relations. Two extractors computing a
 * position slightly differently do not produce a wrong column; they produce a
 * **different hash for the same entity**, which lands as a dangling foreign key
 * in one relation and an orphan row in another.
 *
 * There were three private `positionOf` implementations before this file. They
 * agreed, and nothing would have told anyone if they had stopped.
 *
 * ## The decision it carries: `getStart` and not `.pos`
 *
 * `node.pos` is where the node's **leading trivia** begins — the whitespace and
 * comments before it. `node.getStart(sourceFile)` is where the node's first
 * token begins. For a documented declaration those differ by the whole JSDoc
 * block:
 *
 * ```js
 * /** @type {Foo} *\/
 * const x = 1;
 * //    ^ getStart      ^ this is the identifier
 * // ^ pos is up here, at the start of the comment
 * ```
 *
 * Keying on `.pos` would move a declaration's identity when a comment above it
 * is edited, and would make two declarations collide when one has no comment.
 * `getStart` is the contract, everywhere, without exception.
 *
 * ## Columns are 1-based, and lines are too
 *
 * `getLineAndCharacterOfPosition` is 0-based on both axes. Every column in this
 * schema is 1-based, matching Java's and Python's. The `+ 1` lives here once
 * rather than at thirty call sites, each of which is a chance to forget it.
 *
 * ## No conversion, unlike Python's
 *
 * `python-position-utils.ts` converts tree-sitter's character columns to
 * CPython's UTF-8 byte columns, because the two disagree the moment a line
 * contains a non-ASCII character and `startColumn` is in a primary key. Here
 * both the parser and the oracle are the same TypeScript compiler reading the
 * same `getLineAndCharacterOfPosition`, so there is no second convention to
 * reconcile — and that absence is worth writing down, so the next person does
 * not add a conversion that would break every key.
 */

/** A node's extent, 1-based on both axes. */
export interface JsSourceRange {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/** A node's start, 1-based. For the rows that key on a start and nothing else. */
export interface JsSourcePoint {
  readonly startLine: number;
  readonly startColumn: number;
}

/**
 * The full extent of a node, from its first token to its end.
 *
 * `js_expression` and `js_block` key on all four values, because identity is the
 * **byte range** and not the start offset — a call and its callee share a start
 * offset constantly, and so do a parenthesis and what it wraps.
 */
export function rangeOf(node: ts.Node, sourceFile: ts.SourceFile): JsSourceRange {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.end);
  return {
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

/** Where a node begins, 1-based. */
export function pointOf(node: ts.Node, sourceFile: ts.SourceFile): JsSourcePoint {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { startLine: start.line + 1, startColumn: start.character + 1 };
}

/**
 * A position from a raw OFFSET rather than a node.
 *
 * For the two things that are not nodes: a comment range, which is trivia the
 * AST does not contain, and a parse diagnostic, whose construct may never have
 * become a node at all.
 */
export function pointAtOffset(offset: number, sourceFile: ts.SourceFile): JsSourcePoint {
  const at = sourceFile.getLineAndCharacterOfPosition(offset);
  return { startLine: at.line + 1, startColumn: at.character + 1 };
}

/**
 * The file's last line, 1-based.
 *
 * Computed from the end offset rather than by counting newlines, so a file with
 * a trailing newline and one without do not differ by a line.
 */
export function lastLineOf(sourceFile: ts.SourceFile): number {
  return sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line + 1;
}
