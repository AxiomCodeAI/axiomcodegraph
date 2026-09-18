import Parser from 'tree-sitter';

import { CsParseGapRegistry } from '@/analysis-types/csharp/CsParseGapRegistry';
import { isEmptyCollectionInsertedNode } from '@/parsers/csharp/extractors/cs-misparse';
import { CsParseGapKind } from '@/enums/csharp/parse-gaps';
import {
  allChildren,
  endLine,
  startColumn,
  startLine,
} from '@/parsers/csharp/extractors/cs-node';

/**
 * `cs_parse_gap` — every place the parser could not read, as rows.
 *
 * ## Why rows and not a counter
 *
 * 3.01% of files in the measured corpus carry a parse error. As a percentage
 * that is a fact nobody can act on: which files, which constructs, how much of
 * each file. And a regression from 3.01% to 5% would surface as slightly fewer
 * rows everywhere and nothing else — §7's broken measurement reporting success.
 *
 * With rows it is a query. The 1.41% named grammar residue and the 1.60% `#if`
 * irreducible become distinguishable, and the day a grammar bump fixes one of
 * the four named constructs, the rows for it disappear and the fact is visible.
 *
 * ## The maximal ERROR node is the unit
 *
 * Descending into an `ERROR` and emitting a row per broken child would count the
 * same bytes at every level and inflate `coveragePercent` past 100%. The
 * outermost error is the gap; what is inside it is not separately knowable.
 */

export interface CsParseGapExtractionOptions {
  readonly root: Parser.SyntaxNode;
  readonly csModuleLinkHash: string;
  readonly sourceLength: number;
  readonly serviceVersionLinkHash: string;
}

/**
 * The validated bucket thresholds, as a fraction of the FILE.
 *
 * TIER 3 — authored, not derived. cs-oracle validated that they are monotonic
 * against Roslyn's declaration counts (98.0% / 50.6% / 22.7% recovery), which
 * says the buckets mean what they say; it does not say 5 and 50 are the only
 * numbers that would. Stating that is the point.
 */
const TRUNCATING_THRESHOLD = 50;
const PARTIAL_THRESHOLD = 5;

export function extractParseGaps(
  options: CsParseGapExtractionOptions
): CsParseGapRegistry[] {
  if (!options.root.hasError) {
    return [];
  }

  const rows: CsParseGapRegistry[] = [];
  // Zero-width nodes the parser READS — the identifier inserted for `[]`. They
  // are why `hasError` is set, and they are not gaps. Counted so the fallback
  // below can tell "no gap was found" from "the only gap was a shape we read":
  // without it, suppressing the row here just moved it to the fallback, and 594
  // holdout files still reported a hole in a file that has none.
  let readShapes = 0;
  const stack: Parser.SyntaxNode[] = [options.root];
  // The deepest node that reports `hasError`, kept in case nothing locatable is
  // found. See the fallback below.
  let deepest: { node: Parser.SyntaxNode; depth: number } | undefined;
  const depths = new Map<number, number>([[options.root.id, 0]]);

  while (stack.length > 0) {
    const node = stack.pop()!;
    const depth = depths.get(node.id) ?? 0;
    if (node.hasError && node.type !== 'compilation_unit') {
      if (deepest === undefined || depth > deepest.depth) {
        deepest = { node, depth };
      }
    }

    // THE EMPTY COLLECTION EXPRESSION IS READ, so it is not a gap. `[]` makes
    // the grammar insert a zero-width identifier, and the extractor reads the
    // shape as the empty collection it is — see
    // misparsedCollectionExpressionOf. A gap row here would tell a consumer
    // that 1,368 files of the corpus could not be read when every row in them
    // is present and right. The GRAMMAR's failure is recorded where failures of
    // the grammar belong: the torture corpus and KNOWN_GRAMMAR_LIMITATIONS.
    if (isEmptyCollectionInsertedNode(node)) {
      readShapes += 1;
      continue;
    }

    if (isInsertedNode(node)) {
      // A node tree-sitter INSERTED to recover — a brace, a semicolon or an
      // identifier that was not there. Zero width, and the surrounding tree is
      // usable, which is why it is a different kind from an ERROR rather than a
      // small one.
      rows.push(gap(node, CsParseGapKind.INSERTED_NODE, 0, 0, options));
      continue;
    }

    if (node.type === 'ERROR') {
      const byteLength = node.endIndex - node.startIndex;
      // A `#if` chain the grammar could not nest leaves its directives behind as
      // bare ERROR siblings — `#else` and `#endif` inside an accessor list, a
      // base list or a parameter list. That is not a grammar defect and not a
      // broken program: it is the 1.60% irreducible for ANY both-branches
      // parser, and calling it ERROR_LOCAL would file it with the 1.41% that IS
      // a grammar gap. The two need different actions, so they get different
      // kinds.
      if (node.text.trimStart().startsWith('#')) {
        rows.push(
          gap(node, CsParseGapKind.PREPROC_FRAGMENT, byteLength, 0, options)
        );
        continue;
      }
      const coveragePercent =
        options.sourceLength === 0
          ? 0
          : Math.round((byteLength / options.sourceLength) * 10000) / 100;
      rows.push(gap(node, bucketFor(coveragePercent), byteLength, coveragePercent, options));
      // The MAXIMAL error is the unit. Descending would count these bytes again
      // at every level below and push coveragePercent over 100%.
      continue;
    }

    // EVERY child, and NO pruning on `hasError`.
    //
    // Both halves were wrong before and both were measured:
    //
    // 1. A named-only walk can never reach a MISSING node, because an inserted
    //    `}` or `;` is an anonymous token. `MISSING_NODE` was then a declared
    //    value that was structurally impossible to emit, which the enum audit
    //    reported as never emitted.
    //
    // 2. `hasError` DOES NOT PROPAGATE RELIABLY. On
    //    `System.Private.CoreLib/src/System/Math.cs` the zero-width identifier
    //    at line 219 has `hasError = true` and its PARENT has `hasError = false`
    //    — so pruning on it stopped the walk one level above the defect. 27 of
    //    the 280 files with a parse error produced no gap row at all: 9.6% of
    //    exactly the population this relation exists to describe.
    //
    // The cost is bounded and small. This function returns immediately unless
    // the ROOT has an error, which is 2.9% of files.
    for (const child of allChildren(node)) {
      depths.set(child.id, depth + 1);
      stack.push(child);
    }
  }

  // THE FALLBACK, and it exists because there are THREE ways this grammar
  // signals a parse problem and only one of them is an `ERROR` node.
  //
  // Measured over 9,607 files: 280 report `hasError` on the root. 254 contain
  // an ERROR or an inserted node. The remaining **26 contain neither** — in
  // one multitarget-B test file the whole defect is a `preproc_pragma` node at the
  // end of the file that reports `hasError` on ITSELF, with no ERROR anywhere
  // and no zero-width child.
  //
  // Without this, 9.3% of the files that have a parse error produce no row in
  // the relation whose entire purpose is to say where the losses are. A gap
  // relation that is silent about a tenth of the gaps is the §7 failure exactly:
  // it reports clean because it cannot see.
  //
  // The node type IS the diagnosis. `preproc_pragma` names the construct even
  // though the span is approximate.
  if (rows.length === 0 && readShapes > 0) {
    // `hasError` IS EXPLAINED. Every zero-width node in this file was a shape
    // the extractors read, so there is nothing left to report — and reporting
    // the enclosing node instead would be the fallback describing a file that
    // parsed.
    return rows;
  }
  if (rows.length === 0 && deepest !== undefined) {
    const node = deepest.node;
    const byteLength = node.endIndex - node.startIndex;
    const coveragePercent =
      options.sourceLength === 0
        ? 0
        : Math.round((byteLength / options.sourceLength) * 10000) / 100;
    // SELF_REPORTING_NODE, not a byte-fraction bucket. Filing it as ERROR_LOCAL
    // would put it with the shape whose 98.0% declaration recovery was measured,
    // and this shape's recovery has not been measured at all.
    rows.push(
      gap(node, CsParseGapKind.SELF_REPORTING_NODE, byteLength, coveragePercent, options)
    );
  }

  // Sorted by position. `readdir` order is not the source order, and a fact base
  // that is not byte-identical between two runs fails the determinism gate for a
  // reason that has nothing to do with parsing.
  rows.sort((a, b) =>
    a.startLine !== b.startLine ? a.startLine - b.startLine : a.startColumn - b.startColumn
  );
  return rows;
}

/**
 * Whether a node was INSERTED by error recovery.
 *
 * ## `isMissing` is not reliable in this binding, and that was measured
 *
 * 27 of the 280 files in the corpus that report `hasError` contain **no node
 * for which `isMissing` is true and no `ERROR` node either** — a full cursor
 * walk of `System.Private.CoreLib/src/System/Math.cs` finds 11 nodes with
 * `hasError` set, zero ERRORs and zero missings. The actual defect is a
 * zero-width `identifier` at line 219, inside a parameter list the grammar
 * could not complete.
 *
 * So `isMissing` under-reports, and trusting it made `cs_parse_gap` silently
 * incomplete for **9.6% of the files that have a parse error** — which is worse
 * than not having the relation, because the relation exists to say where the
 * losses are.
 *
 * A ZERO-WIDTH NAMED NODE is the reliable detector. That is what MISSING means:
 * a token the parser inserted because the grammar required one and the source
 * did not have it. No real C# token has zero width, so there is no false
 * positive available.
 *
 * `isMissing` is still consulted first, because when it IS set it is correct and
 * cheaper than a width comparison.
 */
function isInsertedNode(node: Parser.SyntaxNode): boolean {
  if (node.isMissing) {
    return true;
  }
  return node.isNamed && node.startIndex === node.endIndex;
}

function bucketFor(coveragePercent: number): CsParseGapKind {
  if (coveragePercent > TRUNCATING_THRESHOLD) {
    return CsParseGapKind.ERROR_TRUNCATING;
  }
  if (coveragePercent >= PARTIAL_THRESHOLD) {
    return CsParseGapKind.ERROR_PARTIAL;
  }
  return CsParseGapKind.ERROR_LOCAL;
}

function gap(
  node: Parser.SyntaxNode,
  gapKind: CsParseGapKind,
  byteLength: number,
  coveragePercent: number,
  options: CsParseGapExtractionOptions
): CsParseGapRegistry {
  return new CsParseGapRegistry({
    csModuleLinkHash: options.csModuleLinkHash,
    gapKind,
    nodeType: node.type,
    // The parent's type is what says WHAT was being parsed when it failed —
    // `accessor_list` for a `#if` splitting a property, `base_list` for one
    // splitting a heritage clause. Without it a gap is a position and not a
    // diagnosis.
    parentNodeType: node.parent?.type ?? '',
    startLine: startLine(node),
    endLine: endLine(node),
    startColumn: startColumn(node),
    byteLength,
    coveragePercent,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  });
}
