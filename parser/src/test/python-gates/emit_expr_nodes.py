"""
Every EXPRESSION NODE CPython's ast produces, with its span and class name.

The existing expression gate checks five columns — nameContext, position,
parentage, nesting, edgeRole — against ground truth. That is five of thirty-nine,
and it says nothing about whether the tree is COMPLETE. A parser that silently
dropped every dict value, or emitted two rows for one node, would pass it.

This is the completeness half: one row per ast expression node, so a comparison
can ask three questions the other gate cannot.

  MISSING   — ast has an expression here and we emitted none. Lost fact.
  SPURIOUS  — we emitted one where ast has no expression. Invented fact.
  KIND      — both agree a node exists and disagree about what it is.

`ast` is the right authority for this specifically because it normalises away
the things that are NOT expressions: a parenthesised expression is just its
inner node, and there is no node for a `Load`/`Store` context object. So the set
it produces is exactly "the expressions a Python program contains", which is what
py_expression claims to enumerate.

Compiles only; never imports.
"""
import ast
import json
import sys


def main(path: str) -> None:
    source = open(path, encoding="utf-8", errors="replace").read()
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        json.dump({"error": str(error), "nodes": []}, sys.stdout)
        return

    nodes = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.expr):
            continue
        # An f-string's JoinedStr wraps FormattedValue and Constant parts that
        # share spans with it in some versions; they are still real nodes, so
        # they are emitted and the comparison decides what to do with them.
        nodes.append(
            {
                "span": f"{node.lineno}:{node.col_offset}:{node.end_lineno}:{node.end_col_offset}",
                "type": type(node).__name__,
            }
        )
    json.dump({"error": "", "nodes": nodes}, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1])
