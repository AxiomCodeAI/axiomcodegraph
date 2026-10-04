/**
 * Python's one-pass plain-JS mirror of the tree-sitter tree. The machinery
 * and the reasoning live in `../mirror-tree`; this module only pins the
 * language's `extras`: tree-sitter-python's are exactly `comment` and
 * `line_continuation` (whitespace produces no node).
 */
import type Parser from 'tree-sitter';

import { MirrorNode, materializeTree } from '@/parsers/mirror-tree';

const PY_EXTRA_TYPES: ReadonlySet<string> = new Set(['comment', 'line_continuation']);

export type PyMirrorNode = MirrorNode;

export function materializePyTree(tree: Parser.Tree, source: string): MirrorNode {
  return materializeTree(tree, source, PY_EXTRA_TYPES);
}
