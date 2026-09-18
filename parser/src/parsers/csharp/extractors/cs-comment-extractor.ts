import Parser from 'tree-sitter';

import { CsCommentRegistry } from '@/analysis-types/csharp/CsCommentRegistry';
import { CsCommentKind } from '@/enums/csharp/comments';
import { CsDeclarationOwnerKind } from '@/enums/csharp/owners';
import {
  DeclarationOwner,
  DeclarationOwners,
} from '@/parsers/csharp/extractors/cs-attribute-extractor';
import {
  endLine,
  namedChildrenWithTrivia,
  startColumn,
  startLine,
} from '@/parsers/csharp/extractors/cs-node';

/**
 * `cs_comment`.
 *
 * ## Ownership is "the declaration this comment is ABOUT", and it is positional
 *
 * A comment is trivia: the grammar attaches it wherever it lies, and a doc
 * comment before a class is a child of the COMPILATION UNIT, not of the class.
 * So the owner is the next declaration that starts after the comment ends and
 * is not separated from it by another declaration — which is exactly what a
 * reader means by "the docs on this method".
 *
 * When there is no such declaration — a trailing comment at the end of a file,
 * a licence header above the usings — the owner is the MODULE. That is not a
 * fallback for failure: the file is genuinely what the comment belongs to, and
 * every comment gets an owner so a consumer never has to handle an empty one.
 *
 * ## XML doc is NOT a type channel here
 *
 * The JavaScript port does not carry. JSDoc is the only place a type is written
 * in JS; C# has declaration-site types, so `<param name="x">` documents a
 * parameter whose type is already a fact. `xmlDocTags` therefore carries tag
 * NAMES only — enough for "is this documented" and "does it inherit its docs",
 * and not pretending to be a second, weaker type source that a consumer would
 * have to reconcile with the first.
 */

export interface CsCommentExtractionInput {
  readonly root: Parser.SyntaxNode;
  readonly csModuleLinkHash: string;
  readonly serviceVersionLinkHash: string;
  readonly declarationOwners: DeclarationOwners;
  readonly serviceVersionLink?: string;
}

/** Node types that a comment can be documentation FOR. */
const DECLARATION_NODES = new Set([
  'class_declaration',
  'struct_declaration',
  'interface_declaration',
  'enum_declaration',
  'record_declaration',
  'record_struct_declaration',
  'delegate_declaration',
  'method_declaration',
  'constructor_declaration',
  'destructor_declaration',
  'operator_declaration',
  'conversion_operator_declaration',
  'property_declaration',
  'indexer_declaration',
  'event_declaration',
  'event_field_declaration',
  'field_declaration',
  'enum_member_declaration',
  'local_function_statement',
  'parameter',
  'type_parameter',
]);

export function extractComments(input: CsCommentExtractionInput): CsCommentRegistry[] {
  const rows: CsCommentRegistry[] = [];
  // In SOURCE ORDER, because `commentIndex` is the file ordinal and two
  // identical `// TODO` lines are separated by nothing else.
  const comments: Parser.SyntaxNode[] = [];
  const declarations: Parser.SyntaxNode[] = [];

  const walk = (node: Parser.SyntaxNode): void => {
    if (node.type === 'comment') {
      comments.push(node);
      // A comment has no children worth walking, and it is not a declaration.
      return;
    }
    if (DECLARATION_NODES.has(node.type)) {
      declarations.push(node);
    }
    // WITH trivia, because comments are what this is looking for — everything
    // else filters them out so a comment cannot shift a positional index.
    for (const child of namedChildrenWithTrivia(node)) {
      walk(child);
    }
  };
  walk(input.root);

  // Sorted by start offset, so "the next declaration after this comment" is a
  // scan rather than a tree question. The walk is depth-first and a nested
  // declaration therefore arrives before its later siblings, which is not
  // source order.
  declarations.sort((a, b) => a.startIndex - b.startIndex);
  comments.sort((a, b) => a.startIndex - b.startIndex);

  let index = 0;
  for (const comment of comments) {
    const owner = ownerOf(comment, declarations, input);
    const text = comment.text;
    const kind = commentKindOf(text);
    rows.push(
      new CsCommentRegistry({
        commentKind: kind,
        commentText: text,
        ownerHash: owner.hash,
        ownerKind: owner.kind,
        commentIndex: index,
        csModuleLinkHash: input.csModuleLinkHash,
        xmlDocTags: xmlDocTagsOf(text),
        isDocumentation:
          kind === CsCommentKind.XML_DOC_LINE || kind === CsCommentKind.XML_DOC_BLOCK,
        startLine: startLine(comment),
        endLine: endLine(comment),
        startColumn: startColumn(comment),
        endColumn: comment.endPosition.column,
        serviceVersionLinkHash: input.serviceVersionLinkHash,
      })
    );
    index += 1;
  }

  return rows;
}

/**
 * The declaration a comment documents.
 *
 * The FIRST declaration starting after the comment ends, and only if nothing
 * but whitespace, other comments and attributes lie between — which here means
 * only that no OTHER declaration starts in between, since a declaration that
 * did would be the closer one anyway.
 *
 * A declaration whose own range CONTAINS the comment is not the answer: a
 * comment inside a method body is not documentation for the method, and
 * treating it as such would attribute every inline note to the enclosing
 * member. The module owns those.
 */
function ownerOf(
  comment: Parser.SyntaxNode,
  declarations: readonly Parser.SyntaxNode[],
  input: CsCommentExtractionInput
): DeclarationOwner {
  const moduleOwner: DeclarationOwner = {
    hash: input.csModuleLinkHash,
    kind: CsDeclarationOwnerKind.MODULE,
  };

  for (const declaration of declarations) {
    if (declaration.startIndex < comment.endIndex) {
      continue;
    }
    // The FIRST owner of that node. `[Obsolete] int a, b;` produces two field
    // symbols and one comment above it documents the declaration; attributing
    // it to both would emit the comment twice, and duplicates DOUBLE.
    const owner = input.declarationOwners.get(declaration.id)?.[0];
    // If the declaration produced no row — a shape no member extractor emits —
    // the comment belongs to the FILE rather than to a hash resolving to
    // nothing.
    return owner ?? moduleOwner;
  }
  return moduleOwner;
}

function commentKindOf(text: string): CsCommentKind {
  if (text.startsWith('///')) {
    return CsCommentKind.XML_DOC_LINE;
  }
  if (text.startsWith('/**')) {
    // `/**/` is an empty BLOCK comment, not documentation. The three-character
    // prefix matches it, so the length check is what keeps it out.
    return text.length > 4 ? CsCommentKind.XML_DOC_BLOCK : CsCommentKind.BLOCK;
  }
  if (text.startsWith('/*')) {
    return CsCommentKind.BLOCK;
  }
  return CsCommentKind.LINE;
}

/**
 * The XML tag NAMES in a doc comment.
 *
 * Opening tags only, self-closing included — `<inheritdoc/>` is the one tag
 * with semantics worth recording. Attributes inside the tag are skipped: this
 * answers "which tags are present", not "what do they say", and the second
 * question needs prose parsing that would be a second type source.
 */
function xmlDocTagsOf(text: string): Set<string> {
  const tags = new Set<string>();
  if (!text.startsWith('///') && !text.startsWith('/**')) {
    return tags;
  }
  const pattern = /<([A-Za-z][A-Za-z0-9_]*)[\s/>]/g;
  let match = pattern.exec(text);
  while (match !== null) {
    tags.add(match[1]!);
    match = pattern.exec(text);
  }
  return tags;
}
