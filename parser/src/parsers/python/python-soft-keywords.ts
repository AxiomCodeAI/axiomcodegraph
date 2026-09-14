/**
 * Corrections for tree-sitter-python's handling of Python's SOFT keywords.
 *
 * A soft keyword is only a keyword where the grammar cannot read it as an
 * ordinary name. tree-sitter resolves that ambiguity greedily in at least one
 * place, and the result is not a parse error — it is a clean parse of the wrong
 * statement, which is the failure mode that costs the most to find later.
 */
import type Parser from 'tree-sitter';

/**
 * True when a `type_alias_statement` node is really an ASSIGNMENT that the
 * grammar mistook for a PEP 695 type alias.
 *
 * `type(obj).attr = value` — the ordinary idiom for setting an attribute on an
 * object's class — parses as `type_alias_statement`, because the grammar takes
 * the leading `type` as the soft keyword and then accepts `(obj).attr` as the
 * alias name. The whole statement is then modelled wrongly:
 *
 *   type_alias_statement
 *     type -> attribute -> parenthesized_expression -> identifier "obj"
 *                       -> identifier "attr"
 *     type -> integer "1"
 *
 * The call node is GONE, so `type` is never recorded as a name, `obj` looks
 * like a parenthesised expression rather than an argument, and the assigned
 * value is presented as a type. CPython disagrees on every count: symtable
 * lists `type` as a global reference in the enclosing scope.
 *
 * A genuine alias names itself with a bare `identifier` (`type X = int`) or a
 * `generic_type` when it carries type parameters (`type X[T] = list[T]`).
 * Anything else in that position — `attribute` for both `type(o).x` and
 * `type[o].x` — means the soft keyword was applied where it should not have
 * been. Note that `type = 5` and `x.type(o).y = 1` already parse correctly as
 * expression statements, so this is specifically the leading-`type`-plus-
 * trailing-attribute shape.
 */
export function isMisparsedTypeAlias(node: Parser.SyntaxNode): boolean {
  if (node.type !== 'type_alias_statement') {
    return false;
  }
  const left = node.namedChild(0);
  if (left === null || left.type !== 'type') {
    return false;
  }
  const target = left.namedChild(0);
  if (target === null) {
    return false;
  }
  return target.type !== 'identifier' && target.type !== 'generic_type';
}

/**
 * The three real parts of a misparsed `type(obj).attr[: ann] = value`.
 *
 * Kept in one place so the scope builder, the expression extractor and the
 * parse-gap extractor cannot drift: each one has to dig through the same two or
 * three layers of `type` wrapper nodes, and an annotated target adds a
 * `constrained_type` in the middle because `x: y` is also PEP 695's bound
 * syntax. Picking the wrong layer marks the ANNOTATION as an assignment target,
 * which is what happened before this existed.
 */
export interface MisparsedTypeAliasParts {
  /** The real assignment target: an `attribute` or `subscript`. */
  target: Parser.SyntaxNode | null;
  /** The annotation, when the statement was `type(o).a: ann = v`. */
  annotation: Parser.SyntaxNode | null;
  /** The assigned value. */
  value: Parser.SyntaxNode | null;
}

export function decomposeMisparsedTypeAlias(
  node: Parser.SyntaxNode
): MisparsedTypeAliasParts {
  const unwrap = (wrapper: Parser.SyntaxNode | null): Parser.SyntaxNode | null =>
    wrapper !== null && wrapper.type === 'type' ? wrapper.namedChild(0) : wrapper;

  const left = unwrap(node.namedChild(0));
  const value = unwrap(node.namedChild(1));
  if (left !== null && left.type === 'constrained_type') {
    return {
      target: unwrap(left.namedChild(0)),
      annotation: unwrap(left.namedChild(1)),
      value,
    };
  }
  return { target: left, annotation: null, value };
}
