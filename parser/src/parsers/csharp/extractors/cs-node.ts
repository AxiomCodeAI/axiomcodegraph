import Parser from 'tree-sitter';

/**
 * Node identity, and the one place side tables are allowed to live.
 *
 * ## Never store state on a tree-sitter node object
 *
 * This has cost time in three languages and it fails silently. `tree-sitter`'s
 * JavaScript binding hands out **wrapper objects from an evicting cache**: a
 * property set during one traversal is gone by the next, and a `.parent` walk
 * returns freshly-minted wrappers with nothing on them. The result is right on
 * ten files and drops rows on ten thousand, with no error anywhere.
 *
 * So every per-node fact goes in a `Map` keyed on {@link Parser.SyntaxNode.id},
 * which IS stable for the lifetime of a tree.
 *
 * ## Identity is the byte RANGE, not the start offset
 *
 * Two nodes share a start offset constantly in C#: an `invocation_expression`
 * and its `member_access_expression` callee, an `attribute_list` and its first
 * `attribute`, a `record_declaration` and its `modifier`. `${type}:${start}` is
 * not unique; `${type}:${start}:${end}` is the minimum that is.
 */
export function nodeKey(node: Parser.SyntaxNode): string {
  return `${node.type}:${node.startIndex}:${node.endIndex}`;
}

/** The stable per-tree id every side table keys on. */
export function nodeId(node: Parser.SyntaxNode): number {
  return node.id;
}

/** Named children only, as an array. The grammar's anonymous tokens are noise here. */
/**
 * The named children, WITHOUT comments.
 *
 * A comment is a named node in this grammar and tree-sitter places it wherever
 * it lies — which means it appears in the child list of whatever it happens to
 * sit inside, and SHIFTS EVERY POSITIONAL INDEX after it.
 *
 * ```csharp
 * var x = cond ?
 *     a() :
 *     // a comment
 *     new B();
 * ```
 *
 * There, `namedChildren(conditional)[2]` is the COMMENT, not the alternative,
 * so the alternative is dropped and the comment is read as an expression. Every
 * positional read in every extractor has this exposure, and a comment can be
 * written between any two tokens in the language.
 *
 * Filtering here rather than at each read is the same discipline as unwrapping
 * in one place: there are hundreds of reads and the next one added would have
 * had the hole too. {@link namedChildrenWithTrivia} exists for the one consumer
 * that WANTS comments — the comment extractor.
 */
export function namedChildren(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child !== null && !TRIVIA_NODE_TYPES.has(child.type)) {
      out.push(child);
    }
  }
  return out;
}

/**
 * The grammar's `extras` — the nodes tree-sitter places wherever they lie.
 *
 * A comment is one; so is every NON-CONDITIONAL directive. `#pragma warning
 * disable` between the operands of `&&` is a named child of the
 * `binary_expression`, at index 1, and a positional read of the right operand
 * then finds the pragma and drops the call after it — 5 calls in three
 * methods of one fixture, everything after the directive to the end of the
 * expression (CS-CORPUS-24). The conditional directives (`#if` and its chain)
 * are NOT here: they are structure the walks resolve through
 * `activeNamedChildren`, and filtering them would drop whole branches.
 */
export const TRIVIA_NODE_TYPES: ReadonlySet<string> = new Set([
  'comment',
  'preproc_region',
  'preproc_endregion',
  'preproc_line',
  'preproc_pragma',
  'preproc_nullable',
  'preproc_error',
  'preproc_warning',
  'preproc_define',
  'preproc_undef',
  'shebang_directive',
]);

/**
 * The named children WITHOUT comments but WITH directives — for the two
 * consumers that read directives as facts: the branch resolver, whose bodies
 * must keep a `#define` written under `#else`, and the file-level symbol
 * walk that applies it.
 */
export function namedChildrenWithDirectives(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child !== null && child.type !== 'comment') {
      out.push(child);
    }
  }
  return out;
}

/**
 * The named children INCLUDING comments.
 *
 * Only `cs-comment-extractor` should want this: it is looking for the trivia
 * everything else has to ignore.
 */
export function namedChildrenWithTrivia(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child !== null) {
      out.push(child);
    }
  }
  return out;
}

/** Every child, named and anonymous. Modifier keywords like `ref` are anonymous. */
export function allChildren(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (child !== null) {
      out.push(child);
    }
  }
  return out;
}

/** First direct child of the given type, or `undefined`. */
export function childOfType(
  node: Parser.SyntaxNode,
  type: string
): Parser.SyntaxNode | undefined {
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (child !== null && child.type === type) {
      return child;
    }
  }
  return undefined;
}

/** Every direct child of the given type. */
export function childrenOfType(
  node: Parser.SyntaxNode,
  type: string
): Parser.SyntaxNode[] {
  return allChildren(node).filter((c) => c.type === type);
}

/**
 * Whether a direct ANONYMOUS token of this text is present.
 *
 * `ref struct` and `record struct` put `ref`, `record` and `struct` in the tree
 * as anonymous tokens rather than as `modifier` nodes, so a `modifier`-only scan
 * misses exactly the two forms whose value semantics matter most.
 */
export function hasAnonymousToken(node: Parser.SyntaxNode, token: string): boolean {
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (child !== null && !child.isNamed && child.type === token) {
      return true;
    }
  }
  return false;
}

/** 1-based line, matching every other front end in this repo. */
export function startLine(node: Parser.SyntaxNode): number {
  return node.startPosition.row + 1;
}

/** 1-based line of the last character. */
export function endLine(node: Parser.SyntaxNode): number {
  return node.endPosition.row + 1;
}

/** 0-based column, matching `ts_type.startColumn` and `py_*`. */
export function startColumn(node: Parser.SyntaxNode): number {
  return node.startPosition.column;
}
