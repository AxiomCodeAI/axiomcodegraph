/**
 * A plain-JS mirror of a tree-sitter tree, built in ONE cursor pass — the
 * shared machinery behind each language's `materialize<Lang>Tree`.
 *
 * Tree-sitter still parses every file; what this removes is the reading cost.
 * Every property access on a tree-sitter SyntaxNode crosses the JS↔C++
 * boundary and re-marshals the node handle, and the extraction stages each
 * walk the same tree, so one node's properties are fetched once per stage.
 * The mirror pays the boundary once per node, during the cursor walk, and
 * every later read is a JS property.
 *
 * The surface is the union of what the tree-sitter-reading stages use
 * (verified by grep per language): type, text, children/namedChildren,
 * child(i)/namedChild(i), childForFieldName, fieldNameForChild, counts,
 * spans, parent, named siblings, id, isNamed/isMissing/isExtra/hasError.
 * Anything outside it throws at the call site rather than answering wrongly.
 *
 * `text` is sliced lazily from the one source string, so the mirror holds no
 * copies. `isExtra` is derived from the node type against the language's own
 * `extras` set, with one exception read from the real node (see constructor).
 * `hasError` is computed bottom-up with tree-sitter's meaning — an ERROR or
 * missing node anywhere in the subtree — and the ROOT's flag is copied from
 * tree-sitter itself, because an error can live in a HIDDEN node that no
 * visible child betrays.
 */
import type Parser from 'tree-sitter';

/** Never reset: `<stage>HashByNodeId` maps must not collide across files. */
let nextId = 1;

export class MirrorNode {
  readonly id: number;
  readonly type: string;
  readonly isNamed: boolean;
  readonly isMissing: boolean;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: Parser.Point;
  readonly endPosition: Parser.Point;
  parent: MirrorNode | null = null;
  readonly children: MirrorNode[] = [];
  namedChildren: MirrorNode[] = [];
  /** First child per field name — the pick childForFieldName makes. */
  private fields: Map<string, MirrorNode> | null = null;
  /** Field name per child index, for fieldNameForChild; null when none has one. */
  private childFields: (string | null)[] | null = null;
  /** Index within parent.children, for the named-sibling getters. */
  private childIndex = -1;
  private errorInSubtree = false;
  /** Set at build time only for ERROR nodes — see the constructor. */
  private extraOverride: boolean | null = null;
  private readonly source: string;
  private readonly extraTypes: ReadonlySet<string>;

  constructor(cursor: Parser.TreeCursor, source: string, extraTypes: ReadonlySet<string>) {
    this.id = nextId++;
    this.type = cursor.nodeType;
    // An ERROR node can be either: tree-sitter marks an ERROR it absorbed
    // during recovery as EXTRA (siblings' named counts then skip it), while a
    // plain ERROR is not. The type cannot tell them apart, so this is the one
    // place the real node is consulted — ERROR nodes exist only in files that
    // failed to parse, so the boundary crossing stays off the healthy path.
    if (this.type === 'ERROR') {
      this.extraOverride = cursor.currentNode.isExtra;
    }
    this.isNamed = cursor.nodeIsNamed;
    this.isMissing = cursor.nodeIsMissing;
    this.startIndex = cursor.startIndex;
    this.endIndex = cursor.endIndex;
    this.startPosition = cursor.startPosition;
    this.endPosition = cursor.endPosition;
    this.source = source;
    this.extraTypes = extraTypes;
  }

  get text(): string {
    return this.source.slice(this.startIndex, this.endIndex);
  }

  get isExtra(): boolean {
    if (this.extraOverride !== null) {
      return this.extraOverride;
    }
    return this.extraTypes.has(this.type);
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

  child(index: number): MirrorNode | null {
    return this.children[index] ?? null;
  }

  namedChild(index: number): MirrorNode | null {
    return this.namedChildren[index] ?? null;
  }

  // The named-sibling getters answer from ANY node, anonymous ones included
  // (tree-sitter scans the parent's children positionally), so they scan from
  // this node's position rather than indexing namedChildren. They are read a
  // handful of times per file (comment attachment), never in a hot loop.
  get previousNamedSibling(): MirrorNode | null {
    if (this.parent === null) {
      return null;
    }
    for (let i = this.childIndex - 1; i >= 0; i--) {
      const sibling = this.parent.children[i];
      if (sibling !== undefined && sibling.isNamed) {
        return sibling;
      }
    }
    return null;
  }

  get nextNamedSibling(): MirrorNode | null {
    if (this.parent === null) {
      return null;
    }
    for (let i = this.childIndex + 1; i < this.parent.children.length; i++) {
      const sibling = this.parent.children[i];
      if (sibling !== undefined && sibling.isNamed) {
        return sibling;
      }
    }
    return null;
  }

  /**
   * First IMMEDIATE child carrying the field, which is what every extractor
   * asks for. Tree-sitter's own lookup can additionally pierce one visible
   * level where a grammar attaches a field inside a hidden rule (Python's
   * `match_statement` reaches its case clauses' `alternative` through the
   * match block), a quirk no stage uses: the consumers iterate those children
   * by type instead.
   */
  childForFieldName(fieldName: string): MirrorNode | null {
    return this.fields?.get(fieldName) ?? null;
  }

  fieldNameForChild(index: number): string | null {
    return this.childFields?.[index] ?? null;
  }

  /** @internal set when any direct child is an extra — see _repairFieldsFrom. */
  _needsFieldRepair = false;

  /** @internal build-time wiring, called only by materializeTree. */
  _addChild(child: MirrorNode, fieldName: string | null): void {
    child.parent = this;
    child.childIndex = this.children.length;
    this.children.push(child);
    if (child.isNamed) {
      this.namedChildren.push(child);
    }
    if (child.isExtra) {
      this._needsFieldRepair = true;
    }
    if (fieldName !== null && fieldName !== '' && fieldName !== undefined) {
      if (this.fields === null) {
        this.fields = new Map();
      }
      if (!this.fields.has(fieldName)) {
        this.fields.set(fieldName, child);
      }
      if (this.childFields === null) {
        this.childFields = [];
      }
      this.childFields[this.children.length - 1] = fieldName;
    }
  }

  /**
   * @internal Re-reads this node's field layout from the real node.
   *
   * Around an EXTRA child (a comment inside the construct) the cursor's field
   * reporting diverges from the node API in two ways: on a chunk-parsed file
   * (over tree-sitter's string-length ceiling) the field of the sibling after
   * the extra can come back empty, and the node API itself labels the extra
   * with the preceding field. A node with an extra child therefore copies the
   * layout wholesale — these are only the comment-bearing nodes, so the
   * boundary crossings stay rare.
   */
  _repairFieldsFrom(real: Parser.SyntaxNode): void {
    this.fields = null;
    this.childFields = null;
    for (let i = 0; i < this.children.length; i++) {
      const fieldName = real.fieldNameForChild(i) ?? null;
      if (fieldName === null || fieldName === '') {
        continue;
      }
      const child = this.children[i];
      if (child === undefined) {
        continue;
      }
      // The two node APIs disagree around extras, and the mirror keeps both
      // behaviours: fieldNameForChild labels an extra sitting on a field
      // position, while childForFieldName SKIPS extras and answers the first
      // non-extra carrier.
      if (!child.isExtra) {
        if (this.fields === null) {
          this.fields = new Map();
        }
        if (!this.fields.has(fieldName)) {
          this.fields.set(fieldName, child);
        }
      }
      if (this.childFields === null) {
        this.childFields = [];
      }
      this.childFields[i] = fieldName;
    }
  }

  /** @internal */
  _markError(): void {
    this.errorInSubtree = true;
  }
}

/** One depth-first cursor pass over the freshly parsed tree. */
export function materializeTree(
  tree: Parser.Tree,
  source: string,
  extraTypes: ReadonlySet<string>
): MirrorNode {
  const cursor = tree.walk();
  const root = new MirrorNode(cursor, source, extraTypes);
  // hasError at the ROOT is read from tree-sitter itself (one boundary call
  // per file): an error can live in a HIDDEN node — a file whose syntax error
  // is swallowed shows no visible ERROR/missing child anywhere, yet
  // ts_node_has_error is true, and module-level "partial grammar" columns
  // depend on exactly that. When the root does carry an error, every node's
  // flag is read from the real node instead of propagated bottom-up: the
  // parse-gap stages walk for the DEEPEST hasError node, and a node can
  // report it on itself with no visible ERROR child (a bare preproc_pragma
  // does). The per-node boundary crossings are confined to the files that
  // failed to parse; a healthy file pays one.
  const exactErrors = tree.rootNode.hasError;
  if (exactErrors) {
    root._markError();
  }
  const stack: MirrorNode[] = [root];
  let current = root;

  // gotoFirstChild / gotoNextSibling / gotoParent, no recursion: a deeply
  // nested file must not overflow the JS stack when the C parser handled it.
  let descending = true;
  for (;;) {
    if (descending && cursor.gotoFirstChild()) {
      const child = new MirrorNode(cursor, source, extraTypes);
      if (exactErrors && cursor.currentNode.hasError) {
        child._markError();
      }
      current._addChild(child, cursor.currentFieldName);
      stack.push(child);
      current = child;
      continue;
    }
    // finishing `current`: the cursor sits on it, so repair its fields here
    // if an extra child made the cursor's reporting untrustworthy…
    if (current._needsFieldRepair) {
      current._repairFieldsFrom(cursor.currentNode);
      current._needsFieldRepair = false;
    }
    // …and fold its error state into the parent
    if (current.type === 'ERROR' || current.isMissing || current.hasError) {
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
      const sibling = new MirrorNode(cursor, source, extraTypes);
      if (exactErrors && cursor.currentNode.hasError) {
        sibling._markError();
      }
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
