#!/usr/bin/env python3.10
"""CPython 3.10.4 ast side of the coarse construct-count differential.

For every path on stdin emit one JSON line of ast construct counts, keyed by a
name shared with the tree-sitter side (see MAP in diffcounts.py).  Only
constructs whose ast and tree-sitter spellings are *countably* equivalent are
included; anything where the two grammars legitimately disagree on node count
(chained BoolOp, elif chains, implicit string concatenation) is either
normalised here or left out.

Files CPython refuses to compile are emitted with syntaxError -- those are
inputs outside the 3.10.4 language, not divergences.
"""
import ast, json, sys

def counts(tree, lines):
    c = {}
    def bump(k, n=1):
        if n: c[k] = c.get(k, 0) + n
    for n in ast.walk(tree):
        t = type(n).__name__
        if t == "Call": bump("call")
        elif t in ("FunctionDef", "AsyncFunctionDef"):
            bump("function_definition"); bump("decorator", len(n.decorator_list))
        elif t == "ClassDef":
            bump("class_definition"); bump("decorator", len(n.decorator_list))
        elif t == "Lambda": bump("lambda")
        elif t == "Attribute": bump("attribute")
        elif t == "Subscript": bump("subscript")
        elif t == "Await": bump("await")
        elif t in ("Yield", "YieldFrom"): bump("yield")
        elif t == "ListComp": bump("list_comprehension")
        elif t == "SetComp": bump("set_comprehension")
        elif t == "DictComp":
            # tree-sitter gives a dict comprehension a `pair` child; ast does not.
            bump("dictionary_comprehension"); bump("pair")
        elif t == "GeneratorExp": bump("generator_expression")
        elif t == "NamedExpr": bump("named_expression")
        elif t == "Match": bump("match_statement")
        elif t == "match_case": bump("case_clause")
        elif t == "Global": bump("global_statement")
        elif t == "Nonlocal": bump("nonlocal_statement")
        elif t == "Assert": bump("assert_statement")
        elif t == "Delete": bump("delete_statement")
        elif t == "Raise": bump("raise_statement")
        elif t == "Return": bump("return_statement")
        elif t == "IfExp": bump("conditional_expression")
        elif t == "BinOp": bump("binary_operator")
        # `a and b and c` is ONE BoolOp with three values in ast and a *nested*
        # pair of boolean_operator nodes in tree-sitter: normalise to n-1.
        elif t == "BoolOp": bump("boolean_operator", len(n.values) - 1)
        elif t == "Compare": bump("comparison_operator")
        elif t == "UnaryOp":
            bump("not_operator" if isinstance(n.op, ast.Not) else "unary_operator")
        elif t == "If": bump("if_or_elif")
        elif t in ("For", "AsyncFor"): bump("for_statement")
        elif t == "While": bump("while_statement")
        elif t in ("With", "AsyncWith"):
            bump("with_statement"); bump("with_item", len(n.items))
        elif t == "Try":
            bump("try_statement"); bump("finally_clause", 1 if n.finalbody else 0)
        elif t == "ExceptHandler": bump("except_clause")
        elif t == "Pass": bump("pass_statement")
        elif t == "Break": bump("break_statement")
        elif t == "Continue": bump("continue_statement")
        elif t == "Dict":
            bump("dictionary")
            bump("dictionary_splat", sum(1 for k in n.keys if k is None))
            bump("pair", sum(1 for k in n.keys if k is not None))
        elif t == "List":
            # a list in Store context is an unpacking TARGET: tree-sitter gives
            # it its own node type (list_pattern), CPython reuses List.
            bump("list_pattern" if isinstance(n.ctx, ast.Store) else "list")
        elif t == "MatchSingleton":
            # `case None:` is MatchSingleton, not Constant, so the Constant arm
            # below never sees it; tree-sitter just emits none/true/false.
            v = n.value
            bump("true" if v is True else "false" if v is False else "none")
        elif t == "Set": bump("set")
        elif t == "Slice": bump("slice")
        elif t == "Import": bump("import_statement")
        elif t == "ImportFrom":
            # `from __future__ import x` is its own tree-sitter node type.
            bump("future_import_statement" if n.module == "__future__" and n.level == 0
                 else "import_from_statement")
        elif t == "keyword":
            bump("keyword_argument" if n.arg is not None else "dictionary_splat")
        elif t == "Constant":
            v = n.value
            if v is True: bump("true")
            elif v is False: bump("false")
            elif v is None: bump("none")
            elif v is Ellipsis: bump("ellipsis")
            elif isinstance(v, float): bump("float")
            elif isinstance(v, complex):
                # tree-sitter types a complex literal by its mantissa spelling:
                # `1j` is an `integer`, `1.5j` a `float`.  Recover the spelling.
                seg = lines[n.lineno - 1][n.col_offset:n.end_col_offset] if n.lineno <= len(lines) else ""
                bump("float" if ("." in seg or "e" in seg.lower().replace("e+", "e")) else "integer")
            elif isinstance(v, int): bump("integer")
    return c

for line in sys.stdin:
    p = line.strip()
    if not p: continue
    try:
        src = open(p, "r", encoding="utf-8", errors="surrogateescape").read()
    except Exception as e:
        print(json.dumps({"file": p, "readError": str(e)[:120]})); continue
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        print(json.dumps({"file": p, "syntaxError": f"{e.msg} @{e.lineno}"})); continue
    except Exception as e:
        print(json.dumps({"file": p, "syntaxError": str(e)[:120]})); continue
    print(json.dumps({"file": p, "ast": counts(tree, src.splitlines())}))
