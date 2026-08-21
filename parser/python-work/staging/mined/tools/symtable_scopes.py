#!/usr/bin/env python3.10
"""symtable side of the scope-count differential.

CPython 3.10 creates a block for the module, every function, lambda, class and
every comprehension (PEP 709 inlining lands in 3.12, so on 3.10.4 a
comprehension is still its own scope).  The tree-sitter proxy for that count is
1 + function_definition + class_definition + lambda + the four comprehension
node types.  A mismatch means one side is not seeing a binding construct the
other sees -- which is exactly the failure mode a node-count differential over
expressions cannot reach.
"""
import json, symtable, sys

def walk(t):
    n = 1
    for c in t.get_children():
        n += walk(c)
    return n

for line in sys.stdin:
    p = line.strip()
    if not p: continue
    try:
        src = open(p, encoding="utf-8", errors="surrogateescape").read()
        st = symtable.symtable(src, p, "exec")
    except Exception as e:
        print(json.dumps({"file": p, "symtableError": f"{type(e).__name__}: {str(e)[:100]}"})); continue
    print(json.dumps({"file": p, "scopes": walk(st)}))
