"""
CPython's own view of the block structure, for adjudicating py_block.

py_block has SEVENTEEN adjudicable columns and nothing checking any of them. It
is also the youngest relation and the one data flow depends on, which is the
worst combination available: newest code, highest consequence, zero verification.

ast is the right authority because control flow is pure syntax. Every block is a
statement with a body, and the body's extent, the condition, the handler's caught
types and the try it belongs to are all things ast states outright rather than
things a reader infers.

Emits one record per block, keyed on the BODY's span, which is what py_block
stores — deliberately the body rather than the statement, so `if x:` and its
body are not confused.
"""
import ast
import json
import sys


def body_span(body):
    """The span of a statement list, first statement to last."""
    if not body:
        return None
    first, last = body[0], body[-1]
    return f"{first.lineno}:{first.col_offset}:{last.end_lineno}:{last.end_col_offset}"


def condition_text(source, node):
    segment = ast.get_source_segment(source, node)
    return " ".join(segment.split()) if segment else ""


def exception_names(handler):
    """Every type a handler catches — a tuple form catches several."""
    if handler.type is None:
        return []
    if isinstance(handler.type, ast.Tuple):
        return [ast.unparse(e) for e in handler.type.elts]
    return [ast.unparse(handler.type)]


def main(path):
    source = open(path, encoding="utf-8", errors="replace").read()
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        json.dump({"error": str(error), "blocks": []}, sys.stdout)
        return

    blocks = []

    def add(kind, body, **extra):
        span = body_span(body)
        if span:
            blocks.append({"kind": kind, "span": span, **extra})

    for node in ast.walk(tree):
        if isinstance(node, ast.If):
            # ast has no ELIF: `elif` is an If nested in the parent's orelse, and
            # the parser reports it as its own kind at the SAME depth. So an
            # orelse holding exactly one If, positioned where the elif keyword
            # would be, is an elif rather than an else.
            is_elif = (
                len(node.orelse) == 1
                and isinstance(node.orelse[0], ast.If)
                and node.orelse[0].col_offset == node.col_offset
            )
            add("IF", node.body, condition=condition_text(source, node.test),
                hasElse=bool(node.orelse) and not is_elif)
            if node.orelse and not is_elif:
                add("ELSE", node.orelse)
        elif isinstance(node, (ast.For, ast.AsyncFor)):
            add("ASYNC_FOR" if isinstance(node, ast.AsyncFor) else "FOR",
                node.body, hasElse=bool(node.orelse))
            if node.orelse:
                add("ELSE", node.orelse)
        elif isinstance(node, ast.While):
            add("WHILE", node.body, condition=condition_text(source, node.test),
                hasElse=bool(node.orelse))
            if node.orelse:
                add("ELSE", node.orelse)
        elif isinstance(node, (ast.With, ast.AsyncWith)):
            add("ASYNC_WITH" if isinstance(node, ast.AsyncWith) else "WITH",
                node.body, resourceCount=len(node.items))
        elif isinstance(node, (ast.Try, getattr(ast, "TryStar", ast.Try))):
            star = type(node).__name__ == "TryStar"
            add("TRY", node.body, hasElse=bool(node.orelse))
            for handler in node.handlers:
                add("EXCEPT_STAR" if star else "EXCEPT", handler.body,
                    caught=",".join(exception_names(handler)),
                    target=handler.name or "")
            if node.orelse:
                add("ELSE", node.orelse)
            if node.finalbody:
                add("FINALLY", node.finalbody)
        elif isinstance(node, ast.Match):
            add("MATCH", [c.body[0] for c in node.cases if c.body] or node.cases[0].body)
            for case in node.cases:
                add("CASE", case.body)
        elif isinstance(node, ast.ClassDef):
            add("CLASS_BODY", node.body)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            add("FUNCTION_BODY", node.body)

    json.dump({"error": "", "blocks": blocks}, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1])
