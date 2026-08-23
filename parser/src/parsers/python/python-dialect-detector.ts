import Parser from 'tree-sitter';

import { PythonDialect } from '@/enums/python/modules';
import { DialectDetectionResult, Python2Finding } from '@/parsers/python/types';
import { PythonSourcePositions } from '@/utils/python';

/**
 * Node types that exist **only** in Python 2 and are first-class in
 * `tree-sitter-python@0.21.0`'s grammar. Tier 1.
 */
const PY2_ONLY_NODE_TYPES: ReadonlySet<string> = new Set([
  'print_statement',
  'exec_statement',
  'chevron',
]);

/**
 * Detects Python 2 source that `tree-sitter-python` parses **without erroring**.
 *
 * ## Why this exists
 *
 * Python 2 is out of scope, and "out of scope" is not the same as "unsupported".
 * `tree-sitter-python@0.21.0` still carries the Python 2 grammar, so
 * `print "x"` parses **cleanly** — `hasError` is `false`, no ERROR node, no
 * MISSING node — and a full, confident, plausible-looking fact set comes out
 * the other side, computed under Python 3 scoping rules that do not apply to it.
 * That is a silent wrong answer, so Python 2 must be **rejected explicitly**.
 *
 * ## Three tiers, because one is not enough
 *
 * **Tier 1 — Py2-only node types.** `print_statement`, `exec_statement`,
 * `chevron`. Unambiguous: none can occur in valid Python 3.
 *
 * ```python
 * print "x"                  # print_statement
 * print >>sys.stderr, "x"    # chevron
 * exec "code"                # exec_statement
 * ```
 *
 * **Tier 2 — Py2-only *shapes* of node types that are legal in Python 3.** The
 * node type alone proves nothing here; the shape does.
 *
 * ```python
 * except ValueError, e:      # except_clause with a direct `,` child.
 *                            # Python 3 requires `as`, which parses to an
 *                            # as_pattern instead — so the comma is decisive.
 * def f((a, b)): ...         # tuple_pattern whose parent is `parameters`.
 *                            # tuple_pattern is perfectly legal Python 3
 *                            # elsewhere — `(a, b) = x` is a tuple_pattern
 *                            # under `assignment` — so the PARENT is what
 *                            # distinguishes them, not the type.
 * ```
 *
 * **Tier 3 — undetectable from the tree at all.** Backtick repr parses to
 * `(string (string_start) (string_content) (string_end))` with
 * `hasError === false`, structurally **indistinguishable from a real string
 * literal**. No tree query can find it, so this tier scans raw source, skipping
 * string and comment spans so that a backtick inside a docstring or a Markdown
 * comment is not a false positive.
 *
 * ```python
 * x = `repr(y)`              # BACKTICK_REPR — raw-source scan only
 * ```
 */
export class PythonDialectDetector {
  /**
   * Runs all three tiers over an already-built tree plus its source.
   *
   * Detection is a node-type and shape test on an existing tree, so tiers 1 and
   * 2 cost one pass and no new dependency.
   *
   * @param rootNode Root of the parsed tree
   * @param sourceCode The original source, required for tier 3
   * @returns The dialect and every finding, in source order
   */
  detect(rootNode: Parser.SyntaxNode, sourceCode: string): DialectDetectionResult {
    // Positions are reported in CPython's convention (UTF-8 byte columns) so a
    // recorded rejection can be compared against ast output directly.
    const positions = new PythonSourcePositions(sourceCode);
    const findings: Python2Finding[] = [
      ...this.scanTree(rootNode, positions),
      ...this.scanRawSourceForBackticks(sourceCode, positions),
    ];

    findings.sort(
      (a, b) => a.startLine - b.startLine || a.startColumn - b.startColumn ||
        a.construct.localeCompare(b.construct)
    );

    return {
      dialect: findings.length > 0 ? PythonDialect.PY2_DETECTED_REJECTED : PythonDialect.PY3,
      findings,
    };
  }

  /**
   * Tiers 1 and 2, in a single explicit worklist traversal.
   *
   * An explicit stack rather than recursion: Python files in the wild nest
   * deeply enough that a recursive walk risks the call stack on the largest
   * inputs, and this walk must complete for rejection to be trustworthy.
   */
  private scanTree(
    rootNode: Parser.SyntaxNode,
    positions: PythonSourcePositions
  ): Python2Finding[] {
    const findings: Python2Finding[] = [];
    const worklist: Parser.SyntaxNode[] = [rootNode];

    while (worklist.length > 0) {
      const node = worklist.pop();
      if (!node) {
        continue;
      }

      // ---- Tier 1: node types that only Python 2 has ----------------------
      if (PY2_ONLY_NODE_TYPES.has(node.type)) {
        findings.push(this.toFinding(node, node.type, 1, positions));
      }

      // ---- Tier 2: Python-2-only shapes of legal Python 3 node types ------
      if (node.type === 'except_clause' && this.hasDirectCommaChild(node)) {
        findings.push(this.toFinding(node, 'except_clause_comma_target', 2, positions));
      }
      if (node.type === 'tuple_pattern' && this.isInParameterPosition(node)) {
        findings.push(this.toFinding(node, 'tuple_pattern_parameter', 2, positions));
      }

      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i);
        if (child) {
          worklist.push(child);
        }
      }
    }

    return findings;
  }

  /**
   * `except E, e:` — a direct `,` token under the clause.
   *
   * Python 3's `except E as e:` parses the target into an `as_pattern`, and
   * `except (A, B):` wraps the alternatives in a `tuple` node, so neither
   * produces a comma at this level. Checked on the **direct** children only:
   * a comma nested inside a tuple or a call argument list is irrelevant.
   */
  private hasDirectCommaChild(exceptClause: Parser.SyntaxNode): boolean {
    for (let i = 0; i < exceptClause.childCount; i++) {
      if (exceptClause.child(i)?.type === ',') {
        return true;
      }
    }
    return false;
  }

  /**
   * `def f((a, b)):` / `lambda (a, b): ...` — a tuple_pattern directly under a
   * parameter list.
   *
   * The parent is the whole test. `(a, b) = x` is also a `tuple_pattern` and is
   * valid Python 3; its parent is an `assignment`. Reading only the node type
   * here would reject correct Python 3.
   */
  private isInParameterPosition(tuplePattern: Parser.SyntaxNode): boolean {
    const parentType = tuplePattern.parent?.type;
    return parentType === 'parameters' || parentType === 'lambda_parameters';
  }

  /**
   * Tier 3: backtick repr, which no tree query can find.
   *
   * `x = ` + '`repr`' + ` parses to a string node with `hasError === false`, so the
   * only evidence is the raw byte. The scan tracks string and comment state so
   * a backtick inside a docstring — common in reStructuredText and Markdown —
   * does not reject a perfectly good Python 3 file.
   */
  private scanRawSourceForBackticks(
    sourceCode: string,
    positions: PythonSourcePositions
  ): Python2Finding[] {
    const findings: Python2Finding[] = [];
    let line = 1;
    let column = 0;
    let index = 0;
    let inComment = false;
    let stringDelimiter: string | null = null;

    while (index < sourceCode.length) {
      const char = sourceCode[index];

      if (char === '\n') {
        line += 1;
        column = 0;
        index += 1;
        inComment = false;
        // A newline terminates a single-quoted string; triple-quoted strings
        // survive it, which is exactly why the delimiter is tracked verbatim.
        if (stringDelimiter !== null && stringDelimiter.length === 1) {
          stringDelimiter = null;
        }
        continue;
      }

      if (inComment) {
        index += 1;
        column += 1;
        continue;
      }

      if (stringDelimiter !== null) {
        if (char === '\\') {
          index += 2;
          column += 2;
          continue;
        }
        if (sourceCode.startsWith(stringDelimiter, index)) {
          column += stringDelimiter.length;
          index += stringDelimiter.length;
          stringDelimiter = null;
          continue;
        }
        index += 1;
        column += 1;
        continue;
      }

      if (char === '#') {
        inComment = true;
        index += 1;
        column += 1;
        continue;
      }

      if (char === '"' || char === "'") {
        const triple = char.repeat(3);
        stringDelimiter = sourceCode.startsWith(triple, index) ? triple : char;
        column += stringDelimiter.length;
        index += stringDelimiter.length;
        continue;
      }

      if (char === '`') {
        const byteColumn = positions.byteColumn(line - 1, column);
        findings.push({
          construct: 'backtick_repr',
          tier: 3,
          startLine: line,
          startColumn: byteColumn,
          endLine: line,
          endColumn: byteColumn + 1,
          sourceText: '`',
        });
      }

      index += 1;
      column += 1;
    }

    return findings;
  }

  private toFinding(
    node: Parser.SyntaxNode,
    construct: string,
    tier: 1 | 2 | 3,
    positions: PythonSourcePositions
  ): Python2Finding {
    return {
      construct,
      tier,
      startLine: node.startPosition.row + 1,
      startColumn: positions.byteColumn(node.startPosition.row, node.startPosition.column),
      endLine: node.endPosition.row + 1,
      endColumn: positions.byteColumn(node.endPosition.row, node.endPosition.column),
      sourceText: node.text.replace(/\s+/g, ' ').trim(),
    };
  }
}
