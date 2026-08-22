"""
Emits CPython's OWN view of the expression tree, for adjudicating py_expression.

Deliberately NOT a second implementation of the parser's rules. Everything here
is READ OFF the ast rather than derived: `Name.ctx` is CPython's own Load/Store/Del
annotation, `Call.args[i]` is CPython's own argument ORDER, and the parent/child
relation is CPython's own tree. A same-author reimplementation would share the
author's blind spots; reading annotations that the interpreter itself computed
does not.

Spans are (line, utf-8 byte column) exactly as ast reports them, which is what
py_expression stores.
"""
import ast
import json
import sys


def span(node):
    return f"{node.lineno}:{node.col_offset}:{node.end_lineno}:{node.end_col_offset}"


def main(path):
    source = open(path, encoding="utf-8", errors="replace").read()
    tree = ast.parse(source)

    names = []          # ctx ground truth
    call_args = []      # argument order + parentage ground truth
    receivers = []      # which node is the RECEIVER of a call
    nesting = []        # parent/child ground truth for calls inside calls

    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            names.append({
                "span": span(node),
                "id": node.id,
                "ctx": type(node.ctx).__name__,   # Load | Store | Del
            })
        if isinstance(node, ast.Call):
            callee = node.func
            # `a.b()` -> the receiver is `a`; `f()` -> no receiver.
            if isinstance(callee, ast.Attribute):
                receivers.append({
                    "callSpan": span(node),
                    "receiverSpan": span(callee.value),
                    "attr": callee.attr,
                })
            for index, argument in enumerate(node.args):
                call_args.append({
                    "callSpan": span(node),
                    "argSpan": span(argument),
                    "position": index,
                    "isStarred": isinstance(argument, ast.Starred),
                })
            for inner in ast.walk(node):
                if isinstance(inner, ast.Call) and inner is not node:
                    nesting.append({"outer": span(node), "inner": span(inner)})

    json.dump(
        {"names": names, "callArgs": call_args, "receivers": receivers, "nesting": nesting},
        sys.stdout,
    )


if __name__ == "__main__":
    main(sys.argv[1])
