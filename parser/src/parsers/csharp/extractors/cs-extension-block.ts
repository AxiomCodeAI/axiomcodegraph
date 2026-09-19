/**
 * C# 14's EXTENSION BLOCK, flattened into its enclosing static class before the
 * grammar ever sees it.
 *
 * ```csharp
 * public static class Ext
 * {
 *     extension(string source)
 *     {
 *         public string Slug() => source.Trim();
 *         public bool IsBlank => source.Length == 0;
 *     }
 * }
 * ```
 *
 * `extension` is a contextual keyword the published grammar has no rule for.
 * What it recovers is a CONSTRUCTOR of the static class named `extension`,
 * taking one argument, whose body holds the members as STATEMENTS:
 *
 *   - `public string Slug() => source.Trim();` becomes a
 *     `local_function_statement`
 *   - `public bool IsBlank => source.Length == 0;` becomes a
 *     `local_declaration_statement` plus a sibling `ERROR` holding the arrow
 *     and the expression
 *
 * Neither is a member, so `extractMembers` — which walks a `declaration_list`
 * — never sees them, and `isMisparsedExtensionBlockHeader` then suppresses the
 * constructor so the parser does not assert a member that does not exist.
 * Correct, and it leaves the whole block empty: MEASURED on the shape in the
 * issue, 0 methods and 0 properties where 2 and 1 belong.
 *
 * ## Why this is a blanking pass and not a tree repair
 *
 * A tree repair would have to reconstruct each member FORM from the statement
 * the recovery produced — an expression-bodied property out of a declaration
 * plus an `ERROR`, an accessor list out of a block, an indexer, an event, an
 * operator, attributes, each with its own shape. Blanking the three tokens that
 * confuse the grammar — the header and the block's two braces — hands it
 * ORDINARY C# instead, and every member form inside parses as the member it is,
 * with no per-form code at all. It is the rule the `#if` pass already follows.
 *
 * The blanking is LENGTH-PRESERVING to the character: the header becomes
 * spaces, each brace becomes one space, and newlines are kept. Every line,
 * column and offset in the file is unchanged, so every span still points at
 * real source — unlike the semicolon-body pass, which adds a character and
 * argues that the character is unobservable.
 *
 * ## What blanking costs, and how it is paid
 *
 * The receiver's `parameter` node goes with the header, and the receiver is the
 * whole semantics of an extension member. So it is captured BEFORE blanking and
 * returned in a side table keyed by the block's BODY RANGE — not set on a node,
 * because the node-wrapper cache evicts and a property written during one
 * traversal is gone by the next. A member is in the block when its start offset
 * falls inside that range, which survives because blanking moves nothing.
 *
 * ## Detection is tree-directed, never textual
 *
 * `extension(` appears in ordinary code — a call, a local function, a method
 * named `extension`. Only the grammar can say the token opens a block, so the
 * text is parsed and the constructor-named-`extension` shape looked for. A
 * A cheap text probe gates that parse, so a file with no such token — all but
 * two of the corpus's ~16,400 — pays nothing.
 *
 * ## Measured
 *
 * Both corpus files that use the construct flatten completely, and both were
 * incomplete before: one lost a property and its accessor and carried two
 * parse gaps, the other produced NO methods at all from a file whose entire
 * content is one extension block. 0 gaps in both now.
 */

import Parser from 'tree-sitter';

/**
 * The receiver an extension block gives its instance members.
 *
 * Positions are in the ORIGINAL text, which is also the blanked text: the pass
 * preserves length, so the receiver's recorded span still points at the source
 * that declared it even though the grammar can no longer see it.
 */
export interface CsExtensionReceiver {
  readonly name: string;
  readonly typeText: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly typeStartIndex: number;
  readonly typeEndIndex: number;
}

/** One flattened block: the range its members now sit in, and their receiver. */
export interface CsExtensionBlock {
  /** First offset INSIDE the block's braces. */
  readonly bodyStartIndex: number;
  /** One past the last offset inside the block's braces. */
  readonly bodyEndIndex: number;
  /**
   * `undefined` for a TYPE-ONLY receiver — `extension(string)` declares static
   * extension members, which take no receiver value. The block is still an
   * extension block and its members are still extension members.
   */
  readonly receiver: CsExtensionReceiver | undefined;
}

export interface CsExtensionFlattenResult {
  readonly text: string;
  readonly blocks: readonly CsExtensionBlock[];
}

/** Nothing else in C# spells this, and no rule in the grammar produces it. */
const EXTENSION_PROBE = /\bextension\s*[<(]/;

/**
 * Every place a block HEADER could be, counted from the text.
 *
 * Anchored at the start of a line because that is where a member declaration
 * begins, which excludes `extension(x)` written as a call or an argument. It
 * deliberately over-counts rather than under-counts: it is used to decide
 * whether the tree accounted for ALL of a file's blocks, and a header this
 * misses is a header the guard would wrongly believe was handled.
 */
const EXTENSION_HEADER_LINE = /^[ \t]*extension[ \t]*[<(]/gm;

/** Spaces for everything but the line breaks, which hold every later position. */
function blankOf(text: string): string {
  return text.replace(/[^\r\n]/g, ' ');
}

function blankRange(text: string, start: number, end: number): string {
  if (start >= end || start < 0 || end > text.length) {
    return text;
  }
  return text.slice(0, start) + blankOf(text.slice(start, end)) + text.slice(end);
}

function childOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | undefined {
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child !== null && child.type === type) {
      return child;
    }
  }
  return undefined;
}

/**
 * The `constructor_declaration` named `extension` that is really a block.
 *
 * A constructor is named after its TYPE, so a constructor named `extension`
 * inside a type not called `extension` is a shape legal C# cannot produce —
 * proof, not a heuristic. The enclosing type is checked for exactly that
 * reason: `class extension { extension() {} }` is a real constructor.
 */
function isExtensionBlockNode(node: Parser.SyntaxNode): boolean {
  if (node.type !== 'constructor_declaration') {
    return false;
  }
  const name = node.childForFieldName('name');
  if (name === null || name.text !== 'extension') {
    return false;
  }
  const owner = enclosingTypeName(node);
  return owner !== 'extension';
}

function enclosingTypeName(node: Parser.SyntaxNode): string {
  let current: Parser.SyntaxNode | null = node.parent;
  while (current !== null) {
    if (/_declaration$/.test(current.type) && current.type !== 'constructor_declaration') {
      const name = current.childForFieldName('name');
      if (name !== null) {
        return name.text;
      }
    }
    current = current.parent;
  }
  return '';
}

function receiverOf(block: Parser.SyntaxNode): CsExtensionReceiver | undefined {
  const list = childOfType(block, 'parameter_list');
  if (list === undefined) {
    return undefined;
  }
  const parameter = childOfType(list, 'parameter');
  if (parameter === undefined) {
    return undefined;
  }
  const name = parameter.childForFieldName('name');
  const type = parameter.childForFieldName('type');
  // TYPE-ONLY — `extension(string)`. The grammar gives a `parameter` with a
  // type and no name, which is a static-only block.
  if (name === null || type === null) {
    return undefined;
  }
  return {
    name: name.text,
    typeText: type.text,
    startLine: parameter.startPosition.row + 1,
    startColumn: parameter.startPosition.column,
    typeStartIndex: type.startIndex,
    typeEndIndex: type.endIndex,
  };
}

/**
 * Every `extension(` header the TEXT has, as the offset of its `e`.
 *
 * The same anchor EXTENSION_HEADER_LINE uses, but returning positions rather
 * than a count, because a header the tree did not present has to be located
 * before it can be blanked.
 */
function extensionHeaderOffsets(text: string): number[] {
  const re = new RegExp(EXTENSION_HEADER_LINE.source, 'gm');
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m.index + m[0].indexOf('extension'));
  }
  return out;
}

/**
 * Walk `text` from `i`, returning the index just past whatever non-code run
 * starts there, or `i` when code starts there.
 *
 * A brace counter that does not know these will match a `{` inside a string or
 * a comment, and blank from the wrong place. Every C# string form is handled:
 * raw (`"""`), verbatim (`@"`), ordinary, and character literals, plus both
 * comment forms. Interpolation holes are NOT tracked -- a `{` inside one is a
 * brace the counter would see, but it is balanced within the literal, so the
 * count returns to where it started.
 */
function skipNonCode(text: string, i: number): number {
  if (text.startsWith('//', i)) {
    const nl = text.indexOf('\n', i);
    return nl === -1 ? text.length : nl;
  }
  if (text.startsWith('/*', i)) {
    const end = text.indexOf('*/', i + 2);
    return end === -1 ? text.length : end + 2;
  }
  // Raw string: three or more quotes, closed by the same number.
  const raw = /^"{3,}/.exec(text.slice(i, i + 32));
  if (raw !== null) {
    const fence = raw[0];
    const end = text.indexOf(fence, i + fence.length);
    return end === -1 ? text.length : end + fence.length;
  }
  if (text.startsWith('@"', i)) {
    let j = i + 2;
    while (j < text.length) {
      if (text[j] === '"') {
        if (text[j + 1] === '"') {
          j += 2;      // "" is an escaped quote inside a verbatim string
          continue;
        }
        return j + 1;
      }
      j += 1;
    }
    return text.length;
  }
  if (text[i] === '"' || text[i] === "'") {
    const quote = text[i];
    let j = i + 1;
    while (j < text.length) {
      if (text[j] === '\\') {
        j += 2;
        continue;
      }
      if (text[j] === quote) {
        return j + 1;
      }
      if (text[j] === '\n') {
        return j;      // unterminated: do not run past the line
      }
      j += 1;
    }
    return text.length;
  }
  return i;
}

/**
 * The spans to blank for a header the TREE did not present: the header itself
 * and its body's two braces, found by scanning the text.
 *
 * WHY THIS EXISTS. `extension(double)` -- a static extension block on a
 * PREDEFINED TYPE -- is not a `constructor_declaration` in the tree at all. It
 * recovers as an ERROR holding a `variable_declaration`, so no filter over
 * `found` can reach it, and the all-or-nothing guard below then refuses the
 * WHOLE file: measured, a two-block file where one receiver is a keyword
 * emitted one of its two methods and no gap row at the lost one.
 *
 * Blanking is a text operation already, so a header the tree missed can still
 * be blanked as long as its extent is known. That is what this finds.
 */
function textualBlockSpan(
  text: string,
  headerStart: number
): { headerEnd: number; open: number; close: number } | undefined {
  // `extension` then an optional generic list then the receiver parens.
  let i = headerStart + 'extension'.length;
  while (i < text.length && /\s/.test(text[i]!)) i += 1;
  if (text[i] === '<') {
    let depth = 0;
    while (i < text.length) {
      const skipped = skipNonCode(text, i);
      if (skipped !== i) { i = skipped; continue; }
      if (text[i] === '<') depth += 1;
      else if (text[i] === '>') { depth -= 1; if (depth === 0) { i += 1; break; } }
      i += 1;
    }
    while (i < text.length && /\s/.test(text[i]!)) i += 1;
  }
  if (text[i] !== '(') return undefined;
  let depth = 0;
  while (i < text.length) {
    const skipped = skipNonCode(text, i);
    if (skipped !== i) { i = skipped; continue; }
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') { depth -= 1; if (depth === 0) { i += 1; break; } }
    i += 1;
  }
  if (depth !== 0) return undefined;
  const headerEnd = i;
  while (i < text.length && /\s/.test(text[i]!)) i += 1;
  if (text[i] !== '{') return undefined;
  const open = i;
  depth = 0;
  while (i < text.length) {
    const skipped = skipNonCode(text, i);
    if (skipped !== i) { i = skipped; continue; }
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') { depth -= 1; if (depth === 0) return { headerEnd, open, close: i }; }
    i += 1;
  }
  return undefined;
}

/**
 * Flattens every extension block in the text, and says where each one's members
 * now live.
 *
 * `parse` is injected rather than imported so this pass carries no dependency
 * on the parser that owns the 32,767-character workaround — it is handed a
 * parse function and stays a pure text-to-text pass.
 */
export function flattenExtensionBlocks(
  text: string,
  parse: (source: string) => Parser.SyntaxNode
): CsExtensionFlattenResult {
  if (!EXTENSION_PROBE.test(text)) {
    return { text, blocks: [] };
  }
  const root = parse(text);
  const found: Parser.SyntaxNode[] = [];
  const queue: Parser.SyntaxNode[] = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (isExtensionBlockNode(node)) {
      found.push(node);
      // Its members are not blocks; nothing nested matters and a block cannot
      // contain another.
      continue;
    }
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) {
        queue.push(child);
      }
    }
  }
  // NOT an early return on `found.length === 0`. When EVERY block in the file
  // has a receiver the grammar cannot present -- a file of `extension(double)`
  // and `extension(int)`, which is exactly the primitive-polyfill shape -- the
  // tree holds no `constructor_declaration` at all, and returning here would
  // skip the textual path below that is the only thing able to read them.
  // EXTENSION_PROBE has already established the text contains a header.

  // ALL OF A FILE'S BLOCKS, OR NONE OF IT.
  //
  // The boundary is NOT the number of blocks. Several flatten perfectly well —
  // measured, two blocks in one class and two across two classes both come out
  // whole. What decides it is what the recovery makes of EACH block, and that
  // is content-dependent:
  //
  //   two or more members    recovers as a constructor holding a `block`, and
  //                          flattens exactly
  //   exactly ONE member     does not, and its presence degrades its
  //                          neighbours' recovery as well
  //   `extension<T>(...)`    a GENERIC block: not recognised at all
  //
  // So a file can hold blocks this pass can read beside blocks it cannot, and
  // blanking only the readable ones is WORSE than blanking nothing: the
  // unflattened block's ERROR debris swallows the tail of the one that was
  // blanked, and a member the file does declare goes MISSING. Measured at
  // `clean=1, headers=2` on a readable-plus-unreadable pair.
  //
  // Unless the tree accounts for every header the TEXT has, this pass
  // therefore does nothing at all, the file behaves exactly as it does without
  // it, and cs_parse_gap still reports it as incomplete. A partial answer that
  // trades one member for another is the one outcome worth refusing.
  const headerOffsets = extensionHeaderOffsets(text);
  const headersInText = headerOffsets.length;
  const clean = found.filter(
    (node) =>
      childOfType(node, 'block') !== undefined &&
      childOfType(node, 'parameter_list') !== undefined &&
      node.childForFieldName('name') !== null
  );

  // A HEADER THE TREE NEVER PRESENTED IS STILL BLANKABLE.
  //
  // `extension(double)` -- the static form on a PREDEFINED TYPE -- does not
  // recover as a `constructor_declaration`; it becomes an ERROR holding a
  // `variable_declaration`, so it is not in `found` and no filter over `found`
  // can reach it. Before this, one such block anywhere in a file drove
  // clean.length < headersInText and the guard below refused the whole file:
  // measured on the two-block reduction, the IR held B and not A, with the two
  // gap rows at lines 10-11 and 14 and NOTHING at line 7.
  //
  // The pass is a text-to-text blanking already, so a header the tree missed
  // can still be blanked once its extent is known. textualBlockSpan finds that
  // by scanning, skipping every string and comment form so a brace inside one
  // cannot be miscounted. Headers a clean node already covers are left to the
  // tree, which is the more precise source.
  const textual: Array<{ headerStart: number; headerEnd: number; open: number; close: number }> = [];
  for (const headerStart of headerOffsets) {
    if (clean.some((node) => node.startIndex <= headerStart && headerStart < node.endIndex)) {
      continue;
    }
    const span = textualBlockSpan(text, headerStart);
    if (span !== undefined) {
      textual.push({ headerStart, ...span });
    }
  }

  // The guard is unchanged in meaning: unless EVERY header the text has is
  // accounted for, the pass does nothing. Only the set of ways a header can be
  // accounted for has grown.
  if (clean.length + textual.length !== headersInText || headersInText === 0) {
    return { text, blocks: [] };
  }

  // Collected before any blanking, because blanking is what removes them.
  const blocks: CsExtensionBlock[] = [];
  const ranges: Array<{ start: number; end: number }> = [];
  for (const span of textual) {
    blocks.push({
      bodyStartIndex: span.open + 1,
      bodyEndIndex: span.close,
      // A textually-located header is one the grammar could not present, which
      // in practice is the TYPE-ONLY static form. receiverOf answers `undefined`
      // for that shape from a clean node too, so this agrees with the tree path
      // rather than inventing a receiver the parameter list does not name.
      receiver: undefined,
    });
    ranges.push({ start: span.headerStart, end: span.headerEnd });
    ranges.push({ start: span.open, end: span.open + 1 });
    ranges.push({ start: span.close, end: span.close + 1 });
  }
  for (const node of clean) {
    // Non-null by the guard above, which is what `clean` means.
    const body = childOfType(node, 'block')!;
    const name = node.childForFieldName('name')!;
    const list = childOfType(node, 'parameter_list')!;
    blocks.push({
      bodyStartIndex: body.startIndex + 1,
      bodyEndIndex: body.endIndex - 1,
      receiver: receiverOf(node),
    });
    // The header — `extension(string source)` — and the two braces. Nothing
    // else: every character of every member is left exactly as written.
    ranges.push({ start: name.startIndex, end: list.endIndex });
    ranges.push({ start: body.startIndex, end: body.startIndex + 1 });
    ranges.push({ start: body.endIndex - 1, end: body.endIndex });
  }

  // Descending, so an earlier blank cannot move a later range's offsets.
  ranges.sort((a, b) => b.start - a.start);
  let out = text;
  for (const range of ranges) {
    out = blankRange(out, range.start, range.end);
  }
  return { text: out, blocks };
}

/** The block a member sits in, or `undefined` when it is an ordinary member. */
export function extensionBlockAt(
  blocks: readonly CsExtensionBlock[],
  startIndex: number
): CsExtensionBlock | undefined {
  return blocks.find((b) => startIndex >= b.bodyStartIndex && startIndex < b.bodyEndIndex);
}
