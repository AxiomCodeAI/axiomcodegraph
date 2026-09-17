import Parser from 'tree-sitter';

import { CsPreprocRegionRegistry } from '@/analysis-types/csharp/CsPreprocRegionRegistry';
import {
  CsActivationSource,
  CsPreprocRegionKind,
  CsRegionShape,
} from '@/enums/csharp/preproc';
import { endLine, namedChildren, startLine } from '@/parsers/csharp/extractors/cs-node';
import {
  PREPROC_CHAIN_ROOT,
  resolvePreprocBranches,
} from '@/parsers/csharp/extractors/preproc-context';

/**
 * `cs_preproc_region` — the audit trail for which branch this emission took.
 *
 * ## Every other relation records what was emitted; this records what FROM
 *
 * A `#if NET8_0` chain means one branch is in the program and the others are
 * not — their calls are not edges and their types are not declared. That is the
 * right answer, and without a row saying which branch was taken and WHY it is
 * unfalsifiable: `isActive = false` has three unrelated causes that look
 * identical in the data.
 *
 * `activationSource` separates them. `UNEVALUATED` is the only one that is a
 * limitation of this parser, and naming it is what makes the cost countable
 * rather than a percentage nobody can act on.
 *
 * ## The chain NESTS, and treating it as siblings duplicates the subtree
 *
 * `#elif` is a CHILD of the `#if`, and `#else` a child of the last `#elif`. A
 * walker that read them as siblings would descend into the `#else` body while
 * believing it was still in the `#if` — §6's "tree rooted at a non-emitting
 * node" with the sign flipped, and duplicates DOUBLE.
 */

export interface CsPreprocRegionExtractionInput {
  readonly root: Parser.SyntaxNode;
  readonly csModuleLinkHash: string;
  readonly activeSymbols: ReadonlySet<string>;
  readonly serviceVersionLinkHash: string;
}

export function extractPreprocRegions(
  input: CsPreprocRegionExtractionInput
): CsPreprocRegionRegistry[] {
  const rows: CsPreprocRegionRegistry[] = [];

  const walk = (node: Parser.SyntaxNode, parentRegionHash: string): void => {
    // `preproc_if_in_attribute_list` is the one chain root the grammar does
    // not alias to `preproc_if` (its `_attribute_list` choice names it). It
    // is a `#if` all the same, and the trail that claims to record every
    // `#if` recorded none of these — found when a fixture's chain count came
    // up one short.
    if (node.type !== PREPROC_CHAIN_ROOT && node.type !== 'preproc_if_in_attribute_list') {
      for (const child of namedChildren(node)) {
        walk(child, parentRegionHash);
      }
      return;
    }

    const { branches, bodies } = resolvePreprocBranches(node, input.activeSymbols);
    let anyEarlierTaken = false;
    for (const branch of branches) {
      const body = bodies.get(branch.branchIndex) ?? [];
      const isElse = branch.node.type === 'preproc_else';

      const row = new CsPreprocRegionRegistry({
        csModuleLinkHash: input.csModuleLinkHash,
        regionKind: regionKindOf(branch.node),
        conditionText: branch.conditionText,
        conditionSymbols: branch.conditionSymbols,
        isActive: branch.isActive,
        regionShape: shapeOf(body),
        branchIndex: branch.branchIndex,
        branchCount: branches.length,
        activationSource: activationSourceOf(
          branch.isActive,
          isElse,
          anyEarlierTaken,
          branch.evaluated
        ),
        parentRegionLinkHash: parentRegionHash,
        startLine: startLine(branch.node),
        endLine: endLine(branch.node),
        serviceVersionLinkHash: input.serviceVersionLinkHash,
      });
      rows.push(row);
      if (branch.isActive) {
        anyEarlierTaken = true;
      }

      // A nested `#if` inside a branch is a CHILD region, and only the branch
      // bodies are descended into — descending the branch NODE would walk the
      // `#elif` continuation a second time, once as a sibling and once as this
      // chain's own next branch.
      for (const child of body) {
        walk(child, row.getHash());
      }
    }
  };

  walk(input.root, '');
  return rows;
}

function regionKindOf(node: Parser.SyntaxNode): CsPreprocRegionKind {
  switch (node.type) {
    case 'preproc_elif':
      return CsPreprocRegionKind.ELIF;
    case 'preproc_else':
      return CsPreprocRegionKind.ELSE;
    default:
      return CsPreprocRegionKind.IF;
  }
}

/**
 * WHY the branch was or was not taken.
 *
 * The distinction that costs something: a branch whose condition held but whose
 * predecessor already won is not the same fact as a branch whose condition
 * failed, and both read `isActive = false`.
 */
function activationSourceOf(
  isActive: boolean,
  isElse: boolean,
  anyEarlierTaken: boolean,
  evaluated: boolean
): CsActivationSource {
  if (isActive) {
    return isElse ? CsActivationSource.ELSE_FALLBACK : CsActivationSource.CONDITION_TRUE;
  }
  if (anyEarlierTaken) {
    return CsActivationSource.EARLIER_BRANCH_TAKEN;
  }
  // BEFORE reporting the condition false. A condition the evaluator does not
  // implement returns false, and calling that CONDITION_FALSE is the parser
  // asserting a fact it did not establish.
  if (!evaluated) {
    return CsActivationSource.UNEVALUATED;
  }
  return CsActivationSource.CONDITION_FALSE;
}

/** Node types that say what a region's body IS. */
const SHAPE_BY_NODE: ReadonlyMap<string, CsRegionShape> = new Map([
  ['class_declaration', CsRegionShape.DECLARATION],
  ['struct_declaration', CsRegionShape.DECLARATION],
  ['interface_declaration', CsRegionShape.DECLARATION],
  ['enum_declaration', CsRegionShape.DECLARATION],
  ['record_declaration', CsRegionShape.DECLARATION],
  ['record_struct_declaration', CsRegionShape.DECLARATION],
  ['delegate_declaration', CsRegionShape.DECLARATION],
  ['namespace_declaration', CsRegionShape.DECLARATION],
  ['file_scoped_namespace_declaration', CsRegionShape.DECLARATION],
  ['using_directive', CsRegionShape.DECLARATION],
  ['extern_alias_directive', CsRegionShape.DECLARATION],
  ['global_attribute', CsRegionShape.DECLARATION],
  ['method_declaration', CsRegionShape.TYPE_LEVEL],
  ['constructor_declaration', CsRegionShape.TYPE_LEVEL],
  ['destructor_declaration', CsRegionShape.TYPE_LEVEL],
  ['operator_declaration', CsRegionShape.TYPE_LEVEL],
  ['conversion_operator_declaration', CsRegionShape.TYPE_LEVEL],
  ['property_declaration', CsRegionShape.TYPE_LEVEL],
  ['indexer_declaration', CsRegionShape.TYPE_LEVEL],
  ['event_declaration', CsRegionShape.TYPE_LEVEL],
  ['event_field_declaration', CsRegionShape.TYPE_LEVEL],
  ['field_declaration', CsRegionShape.TYPE_LEVEL],
  ['enum_member_declaration', CsRegionShape.ENUM_MEMBERS],
]);

/**
 * What the branch body contains.
 *
 * `FRAGMENT` is the honest terminal and 16.9% of regions in a real corpus: a
 * region splitting a base list, an `else` chain or a parameter list holds no
 * construct that can be parsed on its own. Recording it with no child rows says
 * so; silence would be indistinguishable from an empty region.
 */
function shapeOf(body: readonly Parser.SyntaxNode[]): CsRegionShape {
  if (body.length === 0) {
    return CsRegionShape.EMPTY;
  }
  const shapes = new Set<CsRegionShape>();
  for (const node of body) {
    const known = SHAPE_BY_NODE.get(node.type);
    if (known !== undefined) {
      shapes.add(known);
      continue;
    }
    if (node.type.endsWith('_statement') || node.type === 'block') {
      shapes.add(CsRegionShape.STATEMENT);
      continue;
    }
    shapes.add(CsRegionShape.FRAGMENT);
  }
  if (shapes.has(CsRegionShape.FRAGMENT)) {
    // A body that is PARTLY unparseable is unparseable. Reporting the
    // parseable half's shape would say the region is something it is not.
    return CsRegionShape.FRAGMENT;
  }
  if (shapes.size === 1) {
    return [...shapes][0]!;
  }
  // Several kinds at once — a region holding both a field and a method, say.
  // TYPE_LEVEL is the containing context both are in.
  return shapes.has(CsRegionShape.DECLARATION)
    ? CsRegionShape.DECLARATION
    : CsRegionShape.TYPE_LEVEL;
}
