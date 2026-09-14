import Parser from 'tree-sitter';

import {
  PyCommentRegistry,
  PyMethodRegistry,
  PyModuleRegistry,
  PyTypeRegistry,
} from '@/analysis-types/python';
import { PythonCommentKind } from '@/enums/python/comments';
import { PythonExpressionOwnerKind } from '@/enums/python/expressions';
import { PythonSourcePositions } from '@/utils/python/python-position-utils';

export interface PythonCommentInput {
  module: PyModuleRegistry;
  rootNode: Parser.SyntaxNode;
  filePath: string;
  serviceVersionLinkHash: string;
  types: PyTypeRegistry[];
  methods: PyMethodRegistry[];
  typeHashByNodeId: Map<number, string>;
  methodHashByNodeId: Map<number, string>;
  moduleMethodHash: string;
  positions: PythonSourcePositions;
}

/** `# noqa`, `# type: ignore`, `# pylint: disable=…` and friends. */
const SUPPRESSION = /^#\s*(noqa|type:\s*ignore|pylint\s*:|flake8\s*:|mypy\s*:)/i;
/** `# pragma: no cover` and similar. */
const PRAGMA = /^#\s*pragma\s*:/i;
/** PEP 484 `# type: List[int]`, but NOT `# type: ignore`. */
const TYPE_COMMENT = /^#\s*type\s*:\s*(?!ignore)(.+)$/;
/** PEP 263, valid on the first two lines only. */
const ENCODING = /coding[:=]\s*([-\w.]+)/;

/**
 * Extracts `py_comment`, including docstrings.
 *
 * Most of what this collects is not commentary. An encoding cookie decides how
 * the file decodes, a `# type:` comment carries an annotation `ast` will parse,
 * and a `# noqa` is an explicit decision that a rule reporting the suppressed
 * finding is arguing with. Emitting them all as `LINE_COMMENT` would keep the
 * text and lose every instruction in it.
 *
 * Docstrings are emitted here AND remain `py_expression` LITERAL rows. §2.17
 * requires that: a docstring genuinely is a string expression and `ast` agrees,
 * so the duplication is intentional and a recall check must whitelist it rather
 * than report it forever.
 *
 * Consecutive line comments become one `BLOCK_COMMENT_RUN`, because a six-line
 * explanation is one comment to a reader and six rows would make it look like
 * six unrelated remarks.
 */
export class PythonCommentExtractor {
  private input!: PythonCommentInput;
  private comments: PyCommentRegistry[] = [];
  private index = 0;

  extract(input: PythonCommentInput): PyCommentRegistry[] {
    this.input = input;
    this.comments = [];
    this.index = 0;

    this.collectDocstrings(input.rootNode);
    this.collectComments(input.rootNode);

    // Source order, so `commentIndex` means something to a reader comparing
    // against the file.
    this.comments.sort((left, right) => left.getStartLine() - right.getStartLine());
    return this.comments;
  }

  // ---- docstrings ------------------------------------------------------

  /**
   * The first statement of a module, class or function, when it is a string.
   *
   * That positional rule is the whole definition — Python has no docstring
   * syntax, only a convention the runtime honours by storing `__doc__`. A string
   * anywhere else is an ordinary expression statement and is deliberately not
   * collected.
   */
  private collectDocstrings(root: Parser.SyntaxNode): void {
    const moduleDoc = this.firstStringStatement(root);
    if (moduleDoc) {
      this.push(
        moduleDoc,
        PythonCommentKind.DOCSTRING_MODULE,
        this.input.moduleMethodHash,
        PythonExpressionOwnerKind.MODULE,
        true
      );
    }

    const worklist: Parser.SyntaxNode[] = [root];
    while (worklist.length > 0) {
      const node = worklist.shift()!;
      if (node.type === 'class_definition' || node.type === 'function_definition') {
        const body = node.childForFieldName('body');
        const doc = body ? this.firstStringStatement(body) : null;
        if (doc) {
          const isClass = node.type === 'class_definition';
          this.push(
            doc,
            isClass ? PythonCommentKind.DOCSTRING_CLASS : PythonCommentKind.DOCSTRING_FUNCTION,
            isClass
              ? this.input.typeHashByNodeId.get(node.id) ?? ''
              : this.input.methodHashByNodeId.get(node.id) ?? '',
            isClass ? PythonExpressionOwnerKind.TYPE : PythonExpressionOwnerKind.METHOD,
            true
          );
        }
      }
      for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index);
        if (child && !child.isExtra) {
          worklist.push(child);
        }
      }
    }
  }

  private firstStringStatement(container: Parser.SyntaxNode): Parser.SyntaxNode | null {
    for (let index = 0; index < container.namedChildCount; index += 1) {
      const child = container.namedChild(index);
      if (!child || child.isExtra) {
        continue;
      }
      if (child.type !== 'expression_statement') {
        return null;
      }
      const inner = child.namedChild(0);
      return inner && (inner.type === 'string' || inner.type === 'concatenated_string')
        ? inner
        : null;
    }
    return null;
  }

  // ---- comments --------------------------------------------------------

  private collectComments(root: Parser.SyntaxNode): void {
    const found: Parser.SyntaxNode[] = [];
    const worklist: Parser.SyntaxNode[] = [root];
    while (worklist.length > 0) {
      const node = worklist.shift()!;
      if (node.type === 'comment') {
        found.push(node);
      }
      for (let index = 0; index < node.childCount; index += 1) {
        const child = node.child(index);
        if (child) {
          worklist.push(child);
        }
      }
    }
    found.sort((left, right) => left.startPosition.row - right.startPosition.row);

    // Merge consecutive line comments at the same indent into ONE run. A
    // multi-line explanation is one comment to a reader, and emitting six rows
    // would present it as six unrelated remarks.
    let runStart: Parser.SyntaxNode | null = null;
    let runEnd: Parser.SyntaxNode | null = null;
    const runText: string[] = [];

    const flush = (): void => {
      if (!runStart || !runEnd) {
        return;
      }
      if (runText.length > 1) {
        this.pushRun(runStart, runEnd, runText.join('\n'));
      } else {
        this.pushSingle(runStart);
      }
      runStart = null;
      runEnd = null;
      runText.length = 0;
    };

    for (const comment of found) {
      const kind = this.classify(comment);
      // Only PLAIN comments merge. A directive is a fact in its own right and
      // folding it into a run would bury the instruction.
      if (kind !== PythonCommentKind.LINE_COMMENT) {
        flush();
        this.pushSingle(comment);
        continue;
      }
      const contiguous =
        runEnd !== null &&
        comment.startPosition.row === runEnd.startPosition.row + 1 &&
        comment.startPosition.column === runEnd.startPosition.column;
      if (!contiguous) {
        flush();
        runStart = comment;
      }
      runEnd = comment;
      runText.push(comment.text);
    }
    flush();
  }

  private classify(comment: Parser.SyntaxNode): PythonCommentKind {
    const text = comment.text;
    const row = comment.startPosition.row;
    if (row === 0 && text.startsWith('#!')) {
      return PythonCommentKind.SHEBANG;
    }
    // PEP 263 restricts the cookie to the first two lines; a `coding:` further
    // down is an ordinary comment and honouring it would be wrong.
    if (row <= 1 && ENCODING.test(text)) {
      return PythonCommentKind.ENCODING_COOKIE;
    }
    if (SUPPRESSION.test(text)) {
      return PythonCommentKind.NOQA;
    }
    if (PRAGMA.test(text)) {
      return PythonCommentKind.PRAGMA;
    }
    if (TYPE_COMMENT.test(text)) {
      return PythonCommentKind.TYPE_COMMENT;
    }
    return PythonCommentKind.LINE_COMMENT;
  }

  private pushSingle(comment: Parser.SyntaxNode): void {
    const kind = this.classify(comment);
    const payload = TYPE_COMMENT.exec(comment.text);
    this.push(
      comment,
      kind,
      this.input.moduleMethodHash,
      PythonExpressionOwnerKind.MODULE,
      false,
      kind === PythonCommentKind.TYPE_COMMENT ? (payload?.[1] ?? '').trim() : ''
    );
  }

  private pushRun(start: Parser.SyntaxNode, end: Parser.SyntaxNode, text: string): void {
    this.comments.push(
      new PyCommentRegistry(
        PythonCommentKind.BLOCK_COMMENT_RUN,
        this.normalize(text),
        this.input.filePath,
        start.startPosition.row + 1,
        this.input.positions.byteColumn(start.startPosition.row, start.startPosition.column),
        end.endPosition.row + 1,
        this.input.positions.byteColumn(end.endPosition.row, end.endPosition.column),
        this.input.moduleMethodHash,
        this.index++,
        PythonExpressionOwnerKind.MODULE,
        this.input.module.getHash(),
        '',
        false,
        this.input.serviceVersionLinkHash
      )
    );
  }

  private push(
    node: Parser.SyntaxNode,
    kind: PythonCommentKind,
    ownerHash: string,
    ownerKind: PythonExpressionOwnerKind,
    isDocstring: boolean,
    typeCommentPayload = ''
  ): void {
    this.comments.push(
      new PyCommentRegistry(
        kind,
        this.normalize(node.text),
        this.input.filePath,
        node.startPosition.row + 1,
        this.input.positions.byteColumn(node.startPosition.row, node.startPosition.column),
        node.endPosition.row + 1,
        this.input.positions.byteColumn(node.endPosition.row, node.endPosition.column),
        ownerHash,
        this.index++,
        ownerKind,
        this.input.module.getHash(),
        typeCommentPayload,
        isDocstring,
        this.input.serviceVersionLinkHash
      )
    );
  }

  private normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }
}
