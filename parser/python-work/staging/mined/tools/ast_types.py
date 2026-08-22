#!/usr/bin/env python3.10
"""CPython side of the py_type / py_type_base differential.

Key: the class's "line:col_offset" (col_offset is a UTF-8 byte offset, which is
also the parser's convention since fb7d4f0).
Value: the class name, and its bases IN SOURCE ORDER — positional bases first,
then keyword bases as `name=text`, which is the order ast lists them and the
order the MRO consumes them.
"""
import ast, json, sys

def seg(src, node):
    t = ast.get_source_segment(src, node)
    return " ".join(t.split()) if t else ast.dump(node)

def main():
    p = sys.argv[1]
    try:
        src = open(p, encoding="utf-8", errors="surrogateescape").read()
        tree = ast.parse(src)
    except Exception as e:
        print(json.dumps({"error": str(e)[:100]})); return
    classes = {}
    for n in ast.walk(tree):
        if isinstance(n, ast.ClassDef):
            bases = [seg(src, b) for b in n.bases]
            bases += [f"{k.arg}={seg(src, k.value)}" if k.arg else f"**{seg(src, k.value)}" for k in n.keywords]
            classes[f"{n.lineno}"] = {"name": n.name, "bases": bases}
    print(json.dumps({"classes": classes}))

main()
