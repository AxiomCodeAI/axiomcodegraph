import Parser from 'tree-sitter';

import { PyModuleRegistry, PyParseGapRegistry } from '@/analysis-types/python';
import {
  PythonParseGapDisposition,
  PythonParseGapKind,
} from '@/enums/python/parse-gaps';
import { PythonSourcePositions } from '@/utils/python/python-position-utils';
import { isMisparsedTypeAlias } from '@/parsers/python/python-soft-keywords';
import { Python2Finding } from '@/types/python';

export interface PythonParseGapInput {
  module: PyModuleRegistry;
  rootNode: Parser.SyntaxNode;
  serviceVersionLinkHash: string;
  positions: PythonSourcePositions;
  /** Python 2 constructs found by the dialect detector, if any. */
  python2Findings: Python2Finding[];
}

/**
 * Records every region the grammar could not represent.
 *
 * This is the relation whose ABSENCE is invisible, and that is the argument for
 * building it. Every other omission in this schema surfaces as a missing row
 * somewhere a consumer is already looking. A region the parser could not read
 * produces SILENCE, and silence is indistinguishable from "there was nothing
 * there" — a rule that finds no `eval` cannot tell a clean file from one where
 * the parser gave up on the block containing it.
 *
 * Two dispositions, and the distinction is the point:
 *
 * - `ERROR_NODE` — the grammar knew it was lost and said so.
 * - `MISPARSED_SILENTLY` — the grammar produced a plausible but WRONG node and
 *   raised nothing. A Python 2 backtick repr parses cleanly into something that
 *   means something else, so the facts derived from it are confident and wrong.
 *   Only this relation can tell a consumer the difference.
 *
 * Nested errors are NOT reported twice: tree-sitter marks a whole region as one
 * ERROR and may nest more inside it, and emitting each would turn one
 * unreadable construct into a pile of rows suggesting many separate problems.
 */
export class PythonParseGapExtractor {
  extract(input: PythonParseGapInput): PyParseGapRegistry[] {
    const gaps: PyParseGapRegistry[] = [];

    // A Python 2 module is rejected wholesale (§6.2), which means NO `py_module`
    // row exists for it — and every `py_parse_gap` row is keyed on
    // `pyModuleLinkHash` with no `filePath` column to fall back on. So a Py2 gap
    // emitted here would be unattributable: a row pointing at a module that was
    // never written.
    //
    // It is not lost, though. `skipped-python-files.csv` already records the
    // rejection WITH the construct, line, column and a count, which is strictly
    // more than this relation could carry. Emitting a second, unjoinable copy
    // would add noise and no information. Raised with A0 as a modelling question
    // rather than settled here, since the schema does list PY2_CONSTRUCT_DETECTED
    // as a constructKind and only one of the two places can be right.
    for (const finding of input.python2Findings) {
      gaps.push(
        new PyParseGapRegistry(
          input.module.getHash(),
          PythonParseGapKind.PY2_CONSTRUCT_DETECTED,
          // A Py2 construct parses CLEANLY — that is precisely why it needs
          // detecting rather than catching as an error.
          PythonParseGapDisposition.MISPARSED_SILENTLY,
          finding.startLine,
          finding.startColumn,
          finding.startLine,
          finding.startColumn,
          finding.construct,
          input.serviceVersionLinkHash
        )
      );
    }

    this.collectErrors(input, input.rootNode, gaps, false);
    this.collectSoftKeywordMisparses(input, input.rootNode, gaps);
    return gaps;
  }

  /**
   * A soft keyword applied where it should not have been leaves no ERROR node,
   * so nothing above would ever find it.
   */
  private collectSoftKeywordMisparses(
    input: PythonParseGapInput,
    node: Parser.SyntaxNode,
    gaps: PyParseGapRegistry[]
  ): void {
    if (isMisparsedTypeAlias(node)) {
      gaps.push(
        new PyParseGapRegistry(
          input.module.getHash(),
          PythonParseGapKind.SOFT_KEYWORD_MISPARSE,
          PythonParseGapDisposition.MISPARSED_SILENTLY,
          node.startPosition.row + 1,
          input.positions.byteColumn(node.startPosition.row, node.startPosition.column),
          node.endPosition.row + 1,
          input.positions.byteColumn(node.endPosition.row, node.endPosition.column),
          node.text.replace(/\s+/g, ' ').trim().slice(0, 200),
          input.serviceVersionLinkHash
        )
      );
    }
    for (let index = 0; index < node.namedChildCount; index += 1) {
      const child = node.namedChild(index);
      if (child) {
        this.collectSoftKeywordMisparses(input, child, gaps);
      }
    }
  }

  private collectErrors(
    input: PythonParseGapInput,
    node: Parser.SyntaxNode,
    gaps: PyParseGapRegistry[],
    insideError: boolean
  ): void {
    let nowInsideError = insideError;

    if (!insideError && (node.type === 'ERROR' || node.isMissing)) {
      const isMissing = node.isMissing;
      gaps.push(
        new PyParseGapRegistry(
          input.module.getHash(),
          isMissing ? PythonParseGapKind.MISSING_NODE : PythonParseGapKind.ERROR_NODE,
          PythonParseGapDisposition.ERROR_NODE,
          node.startPosition.row + 1,
          input.positions.byteColumn(node.startPosition.row, node.startPosition.column),
          node.endPosition.row + 1,
          input.positions.byteColumn(node.endPosition.row, node.endPosition.column),
          node.text.replace(/\s+/g, ' ').trim().slice(0, 200),
          input.serviceVersionLinkHash
        )
      );
      nowInsideError = true;
    }

    for (let index = 0; index < node.childCount; index += 1) {
      const child = node.child(index);
      if (child) {
        this.collectErrors(input, child, gaps, nowInsideError);
      }
    }
  }
}
