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


def receiver_names(tree):
    """Map each function node to the name of its receiver parameter, or None.

    Needed to DISCRIMINATE `self` from an ordinary variable. Both are ast.Name,
    so an admissible-set check that allows either gates nothing — a parser that
    always says NAME_REFERENCE would pass. The receiver is the first positional
    parameter of a method that is not a @staticmethod, which is a fact ast has
    and the set-membership check throws away.
    """
    receivers = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        for item in node.body:
            if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            decorators = {
                d.id if isinstance(d, ast.Name) else getattr(d, "attr", "")
                for d in item.decorator_list
            }
            if "staticmethod" in decorators:
                continue
            positional = item.args.posonlyargs + item.args.args
            if not positional:
                continue
            kind = "CLS" if "classmethod" in decorators else "SELF"
            receivers[id(item)] = (positional[0].arg, kind)
    return receivers


def enclosing_receiver(tree, receivers):
    """Every expression node -> the (name, kind) of its enclosing receiver."""
    owner = {}

    def walk(node, current):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            current = receivers.get(id(node), current)
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.expr):
                owner[id(child)] = current
            walk(child, current)

    walk(tree, None)
    return owner


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

    receivers = receiver_names(tree)
    owner_receiver = enclosing_receiver(tree, receivers)

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
            # The DISCRIMINATOR for ast.Name: `self`/`cls` versus any other
            # identifier. Without it, an admissible set containing both
            # NAME_REFERENCE and SELF_REFERENCE accepts a parser that never
            # distinguishes them.
            "nameRole": "",
        }
        if isinstance(node, ast.Name):
            receiver = owner_receiver.get(id(node))
            if receiver and node.id == receiver[0]:
                record["nameRole"] = receiver[1]
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
            # The SURFACE form, not the interpreted value. ast.get_source_segment
            # returns exactly what our literalValue stores — `0x0010` stays
            # `0x0010`, `1_000` stays `1_000`, and an implicit concatenation comes
            # back as written — so the 5,402 string and bytes nodes previously
            # excluded can be compared EXACTLY rather than skipped.
            #
            # Still whitespace-normalised on both sides, because a TSV cell
            # cannot hold a raw newline and a multi-line docstring must collapse.
            segment = ast.get_source_segment(source, node)
            raw = segment if segment is not None else (
                "" if node.value is None else str(node.value)
            )
            record["name"] = " ".join(raw.split())
        elif isinstance(node, (ast.Subscript, ast.List, ast.Tuple, ast.Set, ast.Dict)):
            record["isWrite"] = not isinstance(
                getattr(node, "ctx", ast.Load()), ast.Load
            )
        nodes.append(record)
    json.dump({"error": "", "nodes": nodes}, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1])
