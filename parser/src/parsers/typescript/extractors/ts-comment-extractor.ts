import * as ts from 'typescript';

import { TsCommentRegistry } from '@/analysis-types/typescript/TsCommentRegistry';
import { TsCommentKind, TsDirectiveKind } from '@/enums/typescript/comments';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Emits `ts_comment` rows — schema §4.17.
 *
 * ## Two of the five kinds are not commentary at all
 *
 * A `/// <reference />` is a MODULE EDGE; in ambient code it is frequently the
 * only edge a file has. A `@ts-ignore` SUPPRESSES A DIAGNOSTIC, and
 * `@ts-expect-error` REQUIRES one — a codebase migrating between the two is
 * measurably tightening, and a fact base that folds them cannot see it.
 *
 * Both change what the program means, so both carry a `directiveKind` rather
 * than being recorded as prose.
 *
 * ## Comments are scanned, not walked
 *
 * A comment is TRIVIA: it is not in the AST, and no `forEachChild` reaches it.
 * `ts.getLeadingCommentRanges` over the full text is the only way to see them
 * all, including the ones attached to nothing — a trailing block at end of file,
 * or a suppression above a statement the extractor does not model.
 */
export interface CommentExtractorOptions {
  readonly sourceFile: ts.SourceFile;
  readonly filePath: string;
  readonly tsModuleLinkHash: string;
  readonly serviceVersionLinkHash: string;
  /** Byte offset of a declaration's start -> its row hash, for `ownerHash`. */
  readonly ownerHashByStart: ReadonlyMap<number, string>;
}

export function extractComments(options: CommentExtractorOptions): TsCommentRegistry[] {
  const sf = options.sourceFile;
  const text = sf.getFullText();
  const out: TsCommentRegistry[] = [];
  const seen = new Set<string>();
  let index = 0;

  const emitRange = (range: ts.CommentRange, ownerStart: number | undefined): void => {
    const key = `${range.pos}:${range.end}`;
    if (seen.has(key)) {
      // A comment between two declarations is BOTH the leading trivia of one and
      // the trailing trivia of the other, so the scan reaches it twice. The PK
      // would be identical, and a duplicate key doubles a count rather than
      // colliding.
      return;
    }
    seen.add(key);
    const body = text.slice(range.pos, range.end);
    const start = sf.getLineAndCharacterOfPosition(range.pos);
    const end = sf.getLineAndCharacterOfPosition(range.end);
    const directive = directiveKindOf(body);
    out.push(new TsCommentRegistry({
      commentKind: commentKindOf(body, range, directive),
      commentText: EntityUtils.normalizeWhitespace(body),
      startLine: start.line + 1,
      startColumn: start.character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
      ownerHash: ownerStart === undefined
        ? ''
        : options.ownerHashByStart.get(ownerStart) ?? '',
      commentIndex: index,
      filePath: options.filePath,
      tsModuleLinkHash: options.tsModuleLinkHash,
      jsDocTags: jsDocTagsOf(body),
      directiveKind: directive,
      serviceVersionLinkHash: options.serviceVersionLinkHash,
    }));
    index += 1;
  };

  // Every declaration's leading trivia, so a JSDoc block gets an owner.
  const visit = (node: ts.Node): void => {
    const start = node.getFullStart();
    for (const range of ts.getLeadingCommentRanges(text, start) ?? []) {
      emitRange(range, node.getStart(sf));
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);

  // Then the whole file, so nothing attached to nothing is lost — a suppression
  // above an unmodelled statement, or a trailing block at end of file.
  for (const range of ts.getLeadingCommentRanges(text, 0) ?? []) {
    emitRange(range, undefined);
  }
  // Trailing trivia, at each statement's end rather than at every offset in the
  // file. Scanning every offset works and costs a call per character; the ends
  // are where a trailing comment can actually be.
  const trailingFrom = (node: ts.Node): void => {
    for (const range of ts.getTrailingCommentRanges(text, node.end) ?? []) {
      emitRange(range, undefined);
    }
    ts.forEachChild(node, trailingFrom);
  };
  ts.forEachChild(sf, trailingFrom);
  for (const range of ts.getLeadingCommentRanges(text, sf.endOfFileToken.getFullStart()) ?? []) {
    emitRange(range, undefined);
  }
  return out;
}

function commentKindOf(
  body: string,
  range: ts.CommentRange,
  directive: TsDirectiveKind | ''
): TsCommentKind {
  if (directive === TsDirectiveKind.REFERENCE_PATH
    || directive === TsDirectiveKind.REFERENCE_TYPES
    || directive === TsDirectiveKind.REFERENCE_LIB) {
    return TsCommentKind.TRIPLE_SLASH_DIRECTIVE;
  }
  if (directive !== '') {
    return TsCommentKind.TS_DIRECTIVE;
  }
  if (range.kind === ts.SyntaxKind.SingleLineCommentTrivia) {
    return TsCommentKind.LINE;
  }
  // JSDoc opens with exactly two asterisks. `/***` is a block comment, and
  // treating it as JSDoc would attach tags to something the compiler ignores.
  return body.startsWith('/**') && !body.startsWith('/***')
    ? TsCommentKind.JSDOC
    : TsCommentKind.BLOCK;
}

function directiveKindOf(body: string): TsDirectiveKind | '' {
  if (/^\/\/\/\s*<reference\s+path=/.test(body)) {
    return TsDirectiveKind.REFERENCE_PATH;
  }
  if (/^\/\/\/\s*<reference\s+types=/.test(body)) {
    return TsDirectiveKind.REFERENCE_TYPES;
  }
  if (/^\/\/\/\s*<reference\s+lib=/.test(body)) {
    return TsDirectiveKind.REFERENCE_LIB;
  }
  if (/@ts-expect-error\b/.test(body)) {
    return TsDirectiveKind.TS_EXPECT_ERROR;
  }
  if (/@ts-ignore\b/.test(body)) {
    return TsDirectiveKind.TS_IGNORE;
  }
  if (/@ts-nocheck\b/.test(body)) {
    return TsDirectiveKind.TS_NOCHECK;
  }
  return '';
}

/**
 * The JSDoc tag NAMES present, as a comma-set.
 *
 * Names only, not values: the point is that a rule can filter on `deprecated` or
 * `internal` without re-parsing the text. Anything needing the value reads
 * `commentText`, which is preserved verbatim.
 */
function jsDocTagsOf(body: string): Set<string> {
  const out = new Set<string>();
  if (!body.startsWith('/**')) {
    return out;
  }
  for (const match of body.matchAll(/^\s*\*?\s*@([A-Za-z][A-Za-z0-9-]*)/gm)) {
    const tag = match[1];
    if (tag !== undefined) {
      out.add(tag);
    }
  }
  return out;
}
