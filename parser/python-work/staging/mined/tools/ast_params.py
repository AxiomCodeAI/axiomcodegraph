#!/usr/bin/env python3.10
"""CPython side of the py_method_parameter differential.

Key is the owning function's "line:col_offset" (col_offset is a UTF-8 byte
offset, which is now also the parser's convention).  Value is the parameter
list as `name:KIND`, kinds spelled to match PythonParameterKind.
"""
import ast, json, sys

def params(node):
    a = node.args
    out = []
    for p in a.posonlyargs: out.append(f"{p.arg}:POSITIONAL_ONLY")
    for p in a.args:        out.append(f"{p.arg}:POSITIONAL_OR_KEYWORD")
    if a.vararg:            out.append(f"{a.vararg.arg}:VAR_POSITIONAL")
    for p in a.kwonlyargs:  out.append(f"{p.arg}:KEYWORD_ONLY")
    if a.kwarg:             out.append(f"{a.kwarg.arg}:VAR_KEYWORD")
    return out

def main():
    p = sys.argv[1]
    try:
        tree = ast.parse(open(p, encoding="utf-8", errors="surrogateescape").read())
    except Exception as e:
        print(json.dumps({"error": str(e)[:100]})); return
    funcs = {}
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            funcs[f"{n.lineno}:{n.col_offset}"] = params(n)
    print(json.dumps({"funcs": funcs}))

main()
