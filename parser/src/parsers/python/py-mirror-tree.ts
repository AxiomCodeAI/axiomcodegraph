/**
 * A plain-JS mirror of a tree-sitter tree, built in ONE cursor pass.
 *
 * Tree-sitter still parses every file; what this removes is the reading cost.
 * Every property access on a tree-sitter SyntaxNode crosses the JS↔C++
 * boundary and re-marshals the node handle, and the Python extraction stages
 * each walk the same tree, so one node's properties are fetched once per
 * stage. The mirror pays the boundary once per node, during the cursor walk,
 * and every later read is a JS property.
 *
 * The surface is exactly what the Python stages use (verified by grep over
 * extractors, detector and soft-keywords): type, text, children/namedChildren,
 * child(i)/namedChild(i), childForFieldName, counts, spans, parent, id,
 * isNamed/isMissing/isExtra/hasError. Anything outside it throws at the call
 * site rather than answering wrongly.
 *
 * `text` is sliced lazily from the one source string, so the mirror holds no
 * copies. `isExtra` is derived from the node type: tree-sitter-python's extras
 * are exactly `comment` and `line_continuation` (whitespace produces no node).
 * `hasError` is computed bottom-up with tree-sitter's own meaning: an ERROR or
 * missing node anywhere in the subtree.
 */
import type Parser from 'tree-sitter';

/** tree-sitter-python `extras`: the only node types that parse as extra. */
const PY_EXTRA_TYPES = new Set(['comment', 'line_continuation']);

/** Never reset: `<stage>HashByNodeId` maps must not collide across files. */
let nextId = 1;

export class PyMirrorNode {
  readonly id: number;
  readonly type: string;
  readonly isNamed: boolean;
  readonly isMissing: boolean;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: Parser.Point;
  readonly endPosition: Parser.Point;
  parent: PyMirrorNode | null = null;
  readonly children: PyMirrorNode[] = [];
  namedChildren: PyMirrorNode[] = [];
  /** First child per field name — the pick childForFieldName makes. */
  private fields: Map<string, PyMirrorNode> | null = null;
  private errorInSubtree = false;
  private readonly source: string;

  constructor(cursor: Parser.TreeCursor, source: string) {
    this.id = nextId++;
    this.type = cursor.nodeType;
    // An ERROR node can be either: tree-sitter marks an ERROR it absorbed
    // during recovery as EXTRA (siblings' named counts then skip it), while a
    // plain ERROR is not. The type cannot tell them apart, so this is the one
    // place the real node is consulted — ERROR nodes exist only in files that
    // failed to parse, so the boundary crossing stays off the healthy path.
    if (this.type === 'ERROR') {
      this._extraOverride = cursor.currentNode.isExtra;
    }
    this.isNamed = cursor.nodeIsNamed;
    this.isMissing = cursor.nodeIsMissing;
    this.startIndex = cursor.startIndex;
    this.endIndex = cursor.endIndex;
    this.startPosition = cursor.startPosition;
    this.endPosition = cursor.endPosition;
    this.source = source;
  }

  get text(): string {
    return this.source.slice(this.startIndex, this.endIndex);
  }

  /** Set at build time only for ERROR nodes — see materializePyTree. */
  _extraOverride: boolean | null = null;

  get isExtra(): boolean {
    if (this._extraOverride !== null) {
      return this._extraOverride;
    }
    return PY_EXTRA_TYPES.has(this.type);
  }

  get hasError(): boolean {
    return this.errorInSubtree;
  }

  get childCount(): number {
    return this.children.length;
  }

  get namedChildCount(): number {
    return this.namedChildren.length;
  }

  child(index: number): PyMirrorNode | null {
    return this.children[index] ?? null;
  }

  namedChild(index: number): PyMirrorNode | null {
    return this.namedChildren[index] ?? null;
  }

  /**
   * First IMMEDIATE child carrying the field, which is what every extractor
   * asks for. Tree-sitter's own lookup additionally pierces one visible level
   * on `match_statement` (its `alternative` case clauses sit inside the match
   * `block`), a quirk nothing in the Python stages uses: the match consumers
   * iterate the block's namedChildren by type instead (block-extractor,
   * expression-extractor), and `alternative` is read only on if/for/while,
   * where it is an immediate child.
   */
  childForFieldName(fieldName: string): PyMirrorNode | null {
    return this.fields?.get(fieldName) ?? null;
  }

  /** @internal build-time wiring, called only by materializePyTree. */
  _addChild(child: PyMirrorNode, fieldName: string | null): void {
    child.parent = this;
    this.children.push(child);
    if (child.isNamed) {
      this.namedChildren.push(child);
    }
    if (fieldName !== null && fieldName !== '') {
      if (this.fields === null) {
        this.fields = new Map();
      }
      if (!this.fields.has(fieldName)) {
        this.fields.set(fieldName, child);
      }
    }
  }

  /** @internal */
  _markError(): void {
    this.errorInSubtree = true;
  }
}

/**
 * One depth-first cursor pass over the freshly parsed tree.
 *
 * The result is handed to the stages as a `Parser.SyntaxNode`: the stages are
 * typed against tree-sitter's interface and use only the mirrored subset, so
 * the cast is confined to the one call site that builds the mirror.
 */
export function materializePyTree(tree: Parser.Tree, source: string): PyMirrorNode {
  const cursor = tree.walk();
  const root = new PyMirrorNode(cursor, source);
  // hasError at the ROOT is read from tree-sitter itself (one boundary call per
  // file): an error can live in a HIDDEN node — a file whose syntax error is
  // swallowed shows no visible ERROR/missing child anywhere, yet
  // ts_node_has_error is true, and the module row's grammar column
  // (TS_PYTHON3_PARTIAL) depends on exactly that. The bottom-up propagation
  // below still covers every VISIBLE error for the deeper nodes.
  if (tree.rootNode.hasError) {
    root._markError();
  }
  const stack: PyMirrorNode[] = [root];
  let current = root;

  // gotoFirstChild / gotoNextSibling / gotoParent, no recursion: a deeply
  // nested file must not overflow the JS stack when the C parser handled it.
  let descending = true;
  for (;;) {
    if (descending && cursor.gotoFirstChild()) {
      const child = new PyMirrorNode(cursor, source);
      current._addChild(child, cursor.currentFieldName);
      stack.push(child);
      current = child;
      continue;
    }
    // finishing `current`: fold its error state into the parent
    if (
      current.type === 'ERROR' ||
      current.isMissing ||
      current.hasError
    ) {
      const parent = stack[stack.length - 2];
      if (parent !== undefined) {
        parent._markError();
      }
      current._markError();
    }
    if (cursor.gotoNextSibling()) {
      stack.pop();
      const parent = stack[stack.length - 1];
      if (parent === undefined) {
        // the root has no siblings; the cursor cannot get here
        return root;
      }
      const sibling = new PyMirrorNode(cursor, source);
      parent._addChild(sibling, cursor.currentFieldName);
      stack.push(sibling);
      current = sibling;
      descending = true;
      continue;
    }
    stack.pop();
    const above = stack[stack.length - 1];
    if (!cursor.gotoParent() || above === undefined) {
      return root;
    }
    current = above;
    descending = false;
  }
}
