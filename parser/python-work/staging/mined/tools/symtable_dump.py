#!/usr/bin/env python3.10
"""Independent symtable dump: scopes and the 11 Symbol predicates.

Deliberately NOT A0's emit_oracle.py -- an independent mapping is the point,
so that a shared blind spot between the parser and the harness cannot hide a
disagreement.
"""
import json, sys, symtable

def kind_of(t):
    return {"module": "MODULE", "class": "CLASS", "function": "FUNCTION"}[t.get_type()]

def walk(block, qual, scopes, bindings):
    name = block.get_name()
    if block.get_type() == "function" and name == "lambda":
        kind = "LAMBDA"
    elif block.get_type() == "function" and name in ("listcomp", "setcomp", "dictcomp", "genexpr"):
        kind = "COMPREHENSION"
    else:
        kind = kind_of(block)
    key = f"{kind}|{name}|{block.get_lineno()}"
    scopes.append({"kind": kind, "name": name, "line": block.get_lineno(), "qual": qual})
    for s in block.get_symbols():
        bindings.append({"scope": key, "name": s.get_name(), "p": [
            s.is_parameter(), s.is_local(), s.is_global(), s.is_nonlocal(), s.is_free(),
            s.is_imported(), s.is_assigned(), s.is_referenced(), s.is_declared_global(),
            s.is_annotated(), s.is_namespace(),
        ]})
    for c in block.get_children():
        walk(c, qual + "." + name, scopes, bindings)

def main():
    p = sys.argv[1]
    try:
        src = open(p, encoding="utf-8", errors="surrogateescape").read()
        st = symtable.symtable(src, p, "exec")
    except Exception as e:
        print(json.dumps({"error": f"{type(e).__name__}: {str(e)[:100]}"})); return
    scopes, bindings = [], []
    walk(st, "", scopes, bindings)
    print(json.dumps({"scopes": scopes, "bindings": bindings}))

main()
