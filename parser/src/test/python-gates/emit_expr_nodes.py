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

    # Which nodes sit inside an `await`, and which are starred. Both are FLAGS
    # on our side rather than nodes, so they have to be attributed to the child
    # the flag describes.
    awaited = set()
    starred = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Await) and isinstance(node.value, ast.expr):
            awaited.add(id(node.value))
        if isinstance(node, ast.Starred) and isinstance(node.value, ast.expr):
            starred.add(id(node.value))
        # `**kwargs` is NOT an ast.Starred — it is a `keyword` with arg=None.
        # Missing that made the gate report a false disagreement on every
        # dictionary-splat argument, blaming the parser for being right.
        if isinstance(node, ast.Call):
            for keyword in node.keywords:
                if keyword.arg is None and isinstance(keyword.value, ast.expr):
                    starred.add(id(keyword.value))

    nodes = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.expr):
            continue
        # An f-string's JoinedStr wraps FormattedValue and Constant parts that
        # share spans with it in some versions; they are still real nodes, so
        # they are emitted and the comparison decides what to do with them.
        record = {
            "span": f"{node.lineno}:{node.col_offset}:{node.end_lineno}:{node.end_col_offset}",
            "type": type(node).__name__,
            # The NAME SLOT: what our `literalValue` column should carry for
            # this node. ast names it differently per class, which is exactly
            # why comparing it is worth doing.
            "name": "",
            # Store/Del is a WRITE; Load is not. ast records it on the node.
            "isWrite": False,
            "isAwaited": id(node) in awaited,
            "isStarred": id(node) in starred,
        }
        if isinstance(node, ast.Name):
            record["name"] = node.id
            record["isWrite"] = not isinstance(node.ctx, ast.Load)
        elif isinstance(node, ast.Attribute):
            record["name"] = node.attr
            record["isWrite"] = not isinstance(node.ctx, ast.Load)
        elif isinstance(node, ast.Call):
            callee = node.func
            if isinstance(callee, ast.Name):
                record["name"] = callee.id
            elif isinstance(callee, ast.Attribute):
                record["name"] = callee.attr
        elif isinstance(node, ast.Constant):
            # Whitespace-normalised, because our literalValue is: a TSV cell
            # cannot hold a raw newline, so a multi-line docstring must collapse.
            # Comparing raw against normalised blamed the parser for a choice the
            # format forces.
            raw = "" if node.value is None else str(node.value)
            record["name"] = " ".join(raw.split())
        elif isinstance(node, (ast.Subscript, ast.List, ast.Tuple, ast.Set, ast.Dict)):
            record["isWrite"] = not isinstance(
                getattr(node, "ctx", ast.Load()), ast.Load
            )
        nodes.append(record)
    json.dump({"error": "", "nodes": nodes}, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1])
