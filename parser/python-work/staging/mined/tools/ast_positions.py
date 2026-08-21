#!/usr/bin/env python3.10
"""CPython side of the position-level differential."""
import ast, json, sys

MAP = {
    "Call": "call", "FunctionDef": "function_definition",
    "AsyncFunctionDef": "function_definition", "ClassDef": "class_definition",
    "Lambda": "lambda", "Attribute": "attribute", "Subscript": "subscript",
    "Await": "await", "NamedExpr": "named_expression",
    "ListComp": "list_comprehension", "SetComp": "set_comprehension",
    "DictComp": "dictionary_comprehension", "GeneratorExp": "generator_expression",
    "Return": "return_statement", "Raise": "raise_statement",
    "Assert": "assert_statement", "Global": "global_statement",
    "Nonlocal": "nonlocal_statement", "Delete": "delete_statement",
}

for line in sys.stdin:
    p = line.strip()
    if not p: continue
    try:
        src = open(p, encoding="utf-8", errors="surrogateescape").read()
        tree = ast.parse(src)
    except Exception as e:
        print(json.dumps({"file": p, "error": str(e)[:80]})); continue
    pos = {}
    # Before 3.12 CPython synthesises the positions of expressions inside an
    # f-string: every node in one interpolation reports the SAME col_offset.
    # tree-sitter reports the real columns, so those positions can never agree
    # and comparing them is chasing a CPython artifact.  Mark them.
    fstring_nodes = set()
    for n in ast.walk(tree):
        if type(n).__name__ == "JoinedStr":
            for d in ast.walk(n):
                fstring_nodes.add(id(d))
    # Nodes inside a match PATTERN: tree-sitter spells a dotted value pattern
    # as dotted_name, not attribute (finding a4-009), so their positions are a
    # known divergence rather than a new one.
    pattern_nodes = set()
    for n in ast.walk(tree):
        if type(n).__name__ == "match_case":
            for d in ast.walk(n.pattern):
                pattern_nodes.add(id(d))
    ppos = {}
    fpos = {}
    for n in ast.walk(tree):
        k = MAP.get(type(n).__name__)
        if k and hasattr(n, "lineno"):
            tgt = fpos if id(n) in fstring_nodes else (ppos if id(n) in pattern_nodes else pos)
            tgt.setdefault(k, []).append([n.lineno - 1, n.col_offset])
        # decorators carry no node of their own: use the expression's position,
        # which tree-sitter reports one column later (after the '@')
        for d in getattr(n, "decorator_list", []) or []:
            tgt = fpos if id(d) in fstring_nodes else pos
            tgt.setdefault("decorator", []).append([d.lineno - 1, d.col_offset - 1])
        for kw in getattr(n, "keywords", []) or []:
            # `keyword` carries its own position from 3.9; kw.value's position
            # is the value, which is not where tree-sitter starts the node.
            if kw.arg is not None:
                tgt = fpos if id(n) in fstring_nodes else pos
                tgt.setdefault("keyword_argument", []).append([kw.lineno - 1, kw.col_offset])
    print(json.dumps({"file": p, "pos": pos, "fstringPos": fpos, "patternPos": ppos}))
