import * as ts from 'typescript';

import { JS_COMMENT_TEXT_LIMIT } from '@/constants/javascript-constants';
import { JsCommentRegistry } from '@/analysis-types/javascript/JsCommentRegistry';
import {
  JsCommentAttachmentKind,
  JsCommentKind,
  JsDirectiveKind,
} from '@/enums/javascript/comments';
import { EntityUtils } from '@/utils/entity-utils';
import { pointAtOffset } from '@/utils/javascript';

/**
 * `js_comment` — schema §3.15.
 *
 * ## In this language a comment can be a DECLARATION
 *
 * That is the reason this relation is not decoration. 1,825 `@typedef` and 103
 * `@callback` tags declare **types with no declaration syntax anywhere**, so a
 * `js_type` row can carry `evidenceKind = COMMENT_ONLY` and a `startLine` inside
 * a comment. `declaresType` is the corroborating column, and the gate asserts
 * the two relations agree — every `COMMENT_ONLY` type points at a comment whose
 * `declaresType` is true — so neither can assert it alone.
 *
 * More broadly: **37.9% of parameters get their declared type from a JSDoc tag
 * and 0.165% from syntax.** A schema that treats JSDoc as trivia has no declared
 * type channel at all.
 *
 * ## Comments are scanned, not walked
 *
 * A comment is trivia: not in the AST, and no `forEachChild` reaches one.
 * Scanning the full text is the only way to see them all, including the ones
 * attached to nothing — a licence header, a trailing block at end of file, a
 * suppression above a statement the extractor does not model.
 */
export interface CommentExtractionOptions {
  readonly sourceFile: ts.SourceFile;
  readonly moduleHash: string;
  readonly serviceVersionLinkHash: string;
  /**
   * Byte offset of a declaration's start -> its row and kind.
   *
   * Keyed on the START OFFSET because that is what a trivia scan knows about the
   * node a comment precedes. Recorded first-wins, because several nodes begin at
   * one offset — a declaration and its own name — and the **outermost** is the
   * one a preceding comment documents.
   */
  readonly ownerByStart: ReadonlyMap<
    number, { kind: JsCommentAttachmentKind; hash: string }
  >;
}

export interface CommentExtractionResult {
  readonly comments: readonly JsCommentRegistry[];
  /** Comment row by its start offset, so a `@typedef` type can cite its evidence. */
  readonly commentByStart: ReadonlyMap<number, JsCommentRegistry>;
}

export function extractComments(
  options: CommentExtractionOptions
): CommentExtractionResult {
  const sourceFile = options.sourceFile;
  const text = sourceFile.getFullText();
  const comments: JsCommentRegistry[] = [];
  const commentByStart = new Map<number, JsCommentRegistry>();
  const seen = new Set<string>();
  // Where the file's own code begins. A comment ENTIRELY above it documents the
  // MODULE — that is the enum's own definition of the value: "a file-level
  // comment: a licence header, a `@flow` pragma, a shebang".
  //
  // All three were emitting `attachedToKind = NONE`, so MODULE was 0 rows on a
  // 4,529-file corpus while every file that had a licence header had one. NONE
  // means "attached to nothing", and a licence header is not attached to
  // nothing — it is attached to the file. An engine asking "what documents this
  // module" got an empty answer that looked like an answer.
  //
  // Measured from the first STATEMENT, not from the first node: a shebang at
  // offset 0 is trivia, and `sourceFile.getStart()` skips past it, which would
  // exclude the one case the enum names first.
  const firstStatementStart = sourceFile.statements.length > 0
    ? sourceFile.statements[0]!.getStart(sourceFile)
    : sourceFile.end;

  const emitRange = (range: ts.CommentRange, ownerStart: number | undefined): void => {
    const key = `${range.pos}:${range.end}`;
    if (seen.has(key)) {
      // A comment between two declarations is BOTH the leading trivia of one and
      // the trailing trivia of the other, so the scan reaches it twice. The
      // primary key would be identical, and a duplicate key **doubles** a count
      // rather than colliding.
      return;
    }
    seen.add(key);
    const body = text.slice(range.pos, range.end);
    const start = pointAtOffset(range.pos, sourceFile);
    const end = pointAtOffset(range.end, sourceFile);
    const tags = jsdocTagsOf(body);
    const isJsdoc = body.startsWith('/**');
    const owner = ownerStart === undefined
      ? undefined
      : options.ownerByStart.get(ownerStart);
    const row = new JsCommentRegistry({
      commentKind: commentKindOf(body, range),
      text: EntityUtils.normalizeWhitespace(body).slice(0, JS_COMMENT_TEXT_LIMIT),
      isJsdoc,
      // A comma LIST, ordered and with repeats — `param,param,returns`. The
      // repetition and the order are both information, so this is not a set.
      jsdocTagNames: tags.join(','),
      jsdocTagCount: tags.length,
      // The column that makes "a comment can be a declaration" checkable.
      declaresType: tags.includes('typedef') || tags.includes('callback'),
      directiveKind: directiveKindOf(body),
      attachedToKind: owner?.kind
        ?? (range.end <= firstStatementStart
          ? JsCommentAttachmentKind.MODULE
          : JsCommentAttachmentKind.NONE),
      ownerModuleLinkHash: options.moduleHash,
      startLine: start.startLine,
      startColumn: start.startColumn,
      endLine: end.startLine,
      serviceVersionLinkHash: options.serviceVersionLinkHash,
    });
    if (owner !== undefined) {
      row.setAttachedToLinkHash(owner.hash);
    }
    comments.push(row);
    commentByStart.set(range.pos, row);
  };

  // A shebang is legal only on line 1 and is not a comment to the grammar, so
  // no comment scan reaches it. Emitted anyway: it decides whether the file is
  // an executable entry point, which nothing else in the fact base records.
  if (text.startsWith('#!')) {
    const end = text.indexOf('\n');
    emitRange(
      { pos: 0, end: end < 0 ? text.length : end, kind: ts.SyntaxKind.SingleLineCommentTrivia },
      undefined
    );
  }

  const visit = (node: ts.Node): void => {
    const start = node.getFullStart();
    for (const range of ts.getLeadingCommentRanges(text, start) ?? []) {
      emitRange(range, node.getStart(sourceFile));
    }
    for (const range of ts.getTrailingCommentRanges(text, node.end) ?? []) {
      emitRange(range, undefined);
    }
    // AFTER A SEPARATOR, which belongs to no node.
    //
    // `1, // note` in an array, `x: 1, // note` in an object literal, `p, //
    // note` in a parameter list: 2,211 of 64,157 comments emitted no row, with
    // the identical comment after a STATEMENT emitting fine beside them. The
    // comma is not part of the element, so the comment is not the element's
    // trailing trivia — and the compiler does not collect a same-line comment
    // as the NEXT element's leading trivia either. It is the trailing trivia of
    // the comma token, and a walk over nodes never visits a token.
    //
    // A statement is unaffected because its `;` is inside the statement node.
    // The `seen` set makes this safe against double emission when the same
    // range is reached from two directions.
    if (text[node.end] === ',') {
      for (const range of ts.getTrailingCommentRanges(text, node.end + 1) ?? []) {
        emitRange(range, undefined);
      }
    }
    // AFTER ANY OTHER TOKEN, for the same reason. The comma was one instance
    // of a class: `f(/* why */ 60)` sits after `(`, `case 403: // forbidden`
    // after the `:`, `{ // opening` after the brace, `x = // note` after `=`.
    // None is a node's trailing trivia, and the compiler does not collect a
    // same-line comment as the next node's leading trivia. The parser's own
    // token children — `getChildren()` includes punctuation the AST walk
    // skips — are visited here, so regexes and templates are already decided
    // by the parser and no second scanner is needed. 87 of 14,935 comments on
    // the development corpus, 9 on the holdout, all of this class.
    //
    // AFTER the children, so a comment that is also some node's leading trivia
    // is emitted by that node's visit, WITH its attachment; the token pass
    // catches only what no node claimed (`seen` makes the order the whole rule).
    ts.forEachChild(node, visit);
    for (const child of node.getChildren(sourceFile)) {
      if (child.kind >= ts.SyntaxKind.FirstNode) {
        continue;
      }
      for (const range of ts.getTrailingCommentRanges(text, child.end) ?? []) {
        emitRange(range, undefined);
      }
      for (const range of ts.getLeadingCommentRanges(text, child.getFullStart()) ?? []) {
        emitRange(range, undefined);
      }
    }
  };
  ts.forEachChild(sourceFile, visit);
  // The end of the file is not the trailing trivia of any node, so a comment
  // there is reached by neither loop above.
  for (const range of ts.getLeadingCommentRanges(text, sourceFile.endOfFileToken.getFullStart())
    ?? []) {
    emitRange(range, undefined);
  }

  // Source order, so two runs are byte-identical: `forEachChild` order is
  // deterministic but is not source order once trailing trivia is involved.
  comments.sort((a, b) => a.startLine - b.startLine || a.startColumn - b.startColumn);
  return { comments, commentByStart };
}

function commentKindOf(body: string, range: ts.CommentRange): JsCommentKind {
  if (body.startsWith('#!')) {
    return JsCommentKind.SHEBANG;
  }
  if (body.startsWith('/**')) {
    // A type annotation, not a comment: the compiler parses these into
    // `node.jsDoc` and uses them for inference under `checkJs`.
    return JsCommentKind.JSDOC;
  }
  if (directiveKindOf(body) !== JsDirectiveKind.NONE) {
    return JsCommentKind.DIRECTIVE;
  }
  return range.kind === ts.SyntaxKind.MultiLineCommentTrivia
    ? JsCommentKind.BLOCK
    : JsCommentKind.LINE;
}

/**
 * The directive a comment carries, if any.
 *
 * `FLOW_PRAGMA` is the one with downstream consequences: it corroborates
 * `declaredTypeSource = SYNTACTIC_FLOW`, and without it a Flow annotation in the
 * AST is indistinguishable from a TypeScript one — which matters because
 * `ts.createSourceFile` parses the overlapping grammar happily and **mis-parses
 * the rest silently**.
 */
function directiveKindOf(body: string): JsDirectiveKind {
  if (/@flow\b/.test(body)) {
    return JsDirectiveKind.FLOW_PRAGMA;
  }
  if (/@ts-nocheck\b/.test(body)) {
    return JsDirectiveKind.TS_NOCHECK;
  }
  if (/@ts-check\b/.test(body)) {
    return JsDirectiveKind.TS_CHECK;
  }
  // ANCHORED at the comment's start, as ESLint itself requires: a directive is
  // `/* eslint-disable */`, `// eslint-disable-next-line x`, `/* eslint rule: 0 */`,
  // `/* eslint-env node */`. The old `\beslint\s` branch matched the WORD
  // followed by a space anywhere, so the prose `…and every eslint config
  // resolver.` was a DIRECTIVE row — found by js-fixtures when scrubbing that
  // sentence made a directive vanish.
  if (/^\/[/*]\s*eslint(-[a-z-]+)?(\s|\*\/|$)/.test(body)) {
    return JsDirectiveKind.ESLINT;
  }
  if (/sourceMappingURL=/.test(body)) {
    return JsDirectiveKind.SOURCE_MAP;
  }
  if (/^\/[/*]\s*['"]use strict['"]/.test(body)) {
    return JsDirectiveKind.USE_STRICT;
  }
  return JsDirectiveKind.NONE;
}

/**
 * Tag names in source order, repeats kept: `param,param,returns`.
 *
 * Matched on "whitespace or a star, then `@`", not on line-start. A single-line
 * `/** @type {Array<string>} *\/` puts its tag straight after the opening
 * delimiter, so a line-anchored pattern misses it entirely — and a one-line
 * `@type` is the normal way to annotate a variable, which made `declaresType`
 * and `jsdocTagCount` silently empty for every one of them.
 *
 * The boundary requirement is what keeps an email address in a description from
 * reading as a tag: `see foo@bar` has no space before the `@`.
 */
function jsdocTagsOf(body: string): string[] {
  if (!body.startsWith('/**')) {
    return [];
  }
  const out: string[] = [];
  const pattern = /(?:^|[\s*])@(\w+)/g;
  let match = pattern.exec(body);
  while (match !== null) {
    out.push(match[1]!);
    match = pattern.exec(body);
  }
  return out;
}
