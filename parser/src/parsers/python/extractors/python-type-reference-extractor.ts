import Parser from 'tree-sitter';

import { PyTypeReferenceRegistry } from '@/analysis-types/python';
import {
  PythonTypeRefContext,
  PythonTypeRefKind,
  PythonTypeRefOwnerKind,
} from '@/enums/python/type-references';
import { EntityUtils } from '@/utils/entity-utils';

/** One type position to walk: a node plus who owns it and in what role. */
export interface TypePositionInput {
  node: Parser.SyntaxNode;
  context: PythonTypeRefContext;
  ownerHash: string;
  ownerKind: PythonTypeRefOwnerKind;
  /** Enclosing class, or `''`. */
  enclosingTypeHash: string;
  /** The scope the annotation is evaluated in. */
  scopeHash: string;
}

export interface TypeReferenceInput {
  positions: TypePositionInput[];
  pyModuleLinkHash: string;
  serviceVersionLinkHash: string;
}

/** `Optional[X]` admits None; `Union[..., None]` does too. */
const OPTIONAL_NAMES: ReadonlySet<string> = new Set(['Optional']);
const UNION_NAMES: ReadonlySet<string> = new Set(['Union']);
const CALLABLE_NAMES: ReadonlySet<string> = new Set(['Callable']);
const TUPLE_NAMES: ReadonlySet<string> = new Set(['Tuple', 'tuple']);
const LITERAL_NAMES: ReadonlySet<string> = new Set(['Literal']);
const ANY_NAMES: ReadonlySet<string> = new Set(['Any']);

/**
 * Builds the `py_type_reference` tree for every type position in a module.
 *
 * ## The shape, and why it is a tree
 *
 * A composite annotation references several types that are **related to each
 * other**, so one row per annotation cannot carry it. Each reference gets its own
 * row, and `parentReferenceHash` + `position` + `depth` link them:
 *
 * ```python
 * def f(m: Dict[TypeA, TypeB]): ...
 *
 * d0  SUBSCRIPT  Dict    complete=Dict[TypeA, TypeB]
 * d1    NAME     TypeA   parent=<Dict>  position=0
 * d1    NAME     TypeB   parent=<Dict>  position=1
 * ```
 *
 * Note the shape differs deliberately from the `py_expression` tree for the same
 * text. There, `SUBSCRIPT` is a node and `Dict` is its first child. Here `Dict`
 * **is** the depth-0 reference and the subscript arguments are its children —
 * which is what `java_type_reference` does, and what makes "the type being
 * parameterised" and "its parameters" a parent/child pair rather than siblings.
 *
 * Nesting composes to any depth:
 *
 * ```python
 * x: Dict[TypeA, List[Optional[TypeB]]]
 *
 * d0  SUBSCRIPT Dict
 * d1    NAME      TypeA     parent=Dict      position=0
 * d1    SUBSCRIPT List      parent=Dict      position=1
 * d2      OPTIONAL Optional parent=List      position=0  isOptional
 * d3        NAME   TypeB    parent=Optional  position=0
 * ```
 */
export class PythonTypeReferenceExtractor {
  private references: PyTypeReferenceRegistry[] = [];
  private input!: TypeReferenceInput;

  extract(input: TypeReferenceInput): PyTypeReferenceRegistry[] {
    this.input = input;
    this.references = [];

    for (const position of input.positions) {
      const node = this.unwrap(position.node);
      if (node) {
        this.emit(node, position, position.context, '', 0, 0);
      }
    }
    return this.references;
  }

  /**
   * Strips the wrappers that carry no type of their own: the grammar's `type`
   * node and redundant parentheses.
   */
  private unwrap(node: Parser.SyntaxNode | null): Parser.SyntaxNode | null {
    let current = node;
    while (
      current &&
      (current.type === 'type' || current.type === 'parenthesized_expression')
    ) {
      current = current.namedChild(0);
    }
    return current;
  }

  /**
   * Emits one reference and recurses into its arguments.
   *
   * `context` is `GENERIC_ARGUMENT` for anything nested, so a query can tell "the
   * declared type of this parameter" from "a type mentioned inside it".
   */
  private emit(
    node: Parser.SyntaxNode,
    position: TypePositionInput,
    context: PythonTypeRefContext,
    parentHash: string,
    index: number,
    depth: number
  ): PyTypeReferenceRegistry | null {
    if (depth > 12) {
      // Annotations nest a few levels in practice; this only guards pathological
      // or malformed input.
      return null;
    }

    const base = this.subscriptBase(node);
    const kind = this.kindOf(node, base);
    const typeName = this.simpleNameOf(base ?? node);
    const complete = EntityUtils.normalizeWhitespace(node.text)
      .replace(/\[\s+/g, '[')
      .replace(/\s+\]/g, ']')
      .replace(/\s+,/g, ',');

    const reference = PyTypeReferenceRegistry.builder(
      kind,
      context,
      typeName,
      complete,
      position.ownerHash,
      position.ownerKind,
      this.input.pyModuleLinkHash,
      node.startPosition.row + 1,
      this.input.serviceVersionLinkHash
    )
      .withNesting(parentHash, index, depth)
      .withEnclosingType(position.enclosingTypeHash)
      .withScope(position.scopeHash)
      .withSpan(node.startPosition.row + 1, node.endPosition.row + 1)
      .withFlags({
        isStringForwardRef: kind === PythonTypeRefKind.STRING_FORWARD_REF,
        isOptional: this.admitsNone(node, kind),
      })
      .build();

    this.references.push(reference);

    // Children: subscript arguments, or the operands of a PEP 604 union.
    const children = this.argumentsOf(node);
    children.forEach((child, childIndex) => {
      const inner = this.unwrap(child);
      if (inner) {
        this.emit(
          inner,
          position,
          PythonTypeRefContext.GENERIC_ARGUMENT,
          reference.getHash(),
          childIndex,
          depth + 1
        );
      }
    });

    return reference;
  }

  /**
   * The arguments of a composite type, in source order.
   *
   * Three shapes, each nesting differently: a subscript's indices, a PEP 604
   * union's operands, and `Callable[[A, B], R]` where the parameter list is a
   * LIST one level deeper — its elements are flattened in so `A` and `B` are
   * arguments of `Callable` rather than of an anonymous list.
   */
  private argumentsOf(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const out: Parser.SyntaxNode[] = [];

    if (node.type === 'binary_operator') {
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (left) {
        out.push(left);
      }
      if (right) {
        out.push(right);
      }
      return out;
    }

    if (node.type === 'generic_type') {
      for (let i = 1; i < node.namedChildCount; i++) {
        const parameterList = node.namedChild(i);
        if (parameterList?.type !== 'type_parameter') {
          continue;
        }
        for (let j = 0; j < parameterList.namedChildCount; j++) {
          const argument = parameterList.namedChild(j);
          if (argument && !argument.isExtra) {
            out.push(...this.flattenCallableList(argument));
          }
        }
      }
      return out;
    }

    if (node.type === 'subscript') {
      const value = node.childForFieldName('value');
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (!child || child.id === value?.id || child.isExtra) {
          continue;
        }
        out.push(...this.flattenCallableList(child));
      }
      return out;
    }

    return out;
  }

  /** `Callable[[A, B], R]` — the bracketed parameter list is not itself a type. */
  private flattenCallableList(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const inner = this.unwrap(node);
    if (!inner || inner.type !== 'list') {
      return inner ? [inner] : [];
    }
    const out: Parser.SyntaxNode[] = [];
    for (let i = 0; i < inner.namedChildCount; i++) {
      const element = inner.namedChild(i);
      if (element && !element.isExtra) {
        out.push(element);
      }
    }
    return out;
  }

  /** The base of a subscript: the `Dict` in `Dict[str, int]`. */
  private subscriptBase(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (node.type === 'generic_type') {
      return node.namedChild(0);
    }
    if (node.type === 'subscript') {
      return node.childForFieldName('value') ?? node.namedChild(0);
    }
    return null;
  }

  private kindOf(
    node: Parser.SyntaxNode,
    base: Parser.SyntaxNode | null
  ): PythonTypeRefKind {
    if (node.type === 'binary_operator') {
      return PythonTypeRefKind.UNION_PEP604;
    }
    if (node.type === 'string' || node.type === 'concatenated_string') {
      return PythonTypeRefKind.STRING_FORWARD_REF;
    }
    if (node.type === 'none') {
      return PythonTypeRefKind.NONE_TYPE;
    }
    if (node.type === 'ellipsis') {
      return PythonTypeRefKind.ELLIPSIS_TYPE;
    }

    if (base !== null) {
      const name = this.simpleNameOf(base);
      if (OPTIONAL_NAMES.has(name)) {
        return PythonTypeRefKind.OPTIONAL;
      }
      if (UNION_NAMES.has(name)) {
        return PythonTypeRefKind.UNION_PEP604;
      }
      if (CALLABLE_NAMES.has(name)) {
        return PythonTypeRefKind.CALLABLE;
      }
      if (TUPLE_NAMES.has(name)) {
        return PythonTypeRefKind.TUPLE_TYPE;
      }
      if (LITERAL_NAMES.has(name)) {
        return PythonTypeRefKind.LITERAL_TYPE;
      }
      return PythonTypeRefKind.SUBSCRIPT;
    }

    if (node.type === 'identifier') {
      return ANY_NAMES.has(node.text) ? PythonTypeRefKind.ANY : PythonTypeRefKind.NAME;
    }
    if (node.type === 'attribute' || node.type === 'member_type') {
      return PythonTypeRefKind.DOTTED_NAME;
    }
    return PythonTypeRefKind.UNKNOWN;
  }

  /**
   * Whether this reference admits `None`.
   *
   * `Optional[X]` by definition, and `Union[..., None]` or `X | None` by having a
   * `None` member. `isOptional` is the #1 subscript in the corpus at 3,517
   * occurrences, so it earns a column rather than being re-derived.
   */
  private admitsNone(node: Parser.SyntaxNode, kind: PythonTypeRefKind): boolean {
    if (kind === PythonTypeRefKind.OPTIONAL) {
      return true;
    }
    if (kind !== PythonTypeRefKind.UNION_PEP604) {
      return false;
    }
    return this.argumentsOf(node).some(argument => {
      const inner = this.unwrap(argument);
      return inner?.type === 'none';
    });
  }

  private simpleNameOf(node: Parser.SyntaxNode): string {
    switch (node.type) {
      case 'identifier': {
        return node.text;
      }
      case 'attribute': {
        return node.childForFieldName('attribute')?.text ?? '';
      }
      case 'member_type': {
        return node.namedChild(node.namedChildCount - 1)?.text ?? '';
      }
      case 'dotted_name': {
        return node.namedChild(node.namedChildCount - 1)?.text ?? '';
      }
      case 'string':
      case 'concatenated_string': {
        for (let i = 0; i < node.namedChildCount; i++) {
          const part = node.namedChild(i);
          if (part?.type === 'string_content') {
            // A forward reference names a type; the quotes are not part of it.
            return part.text.split('[')[0]!.trim();
          }
        }
        return '';
      }
      case 'none': {
        return 'None';
      }
      case 'generic_type':
      case 'subscript': {
        const base = this.subscriptBase(node);
        return base ? this.simpleNameOf(base) : '';
      }
      default: {
        return '';
      }
    }
  }
}
