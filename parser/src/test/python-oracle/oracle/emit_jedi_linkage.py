#!/usr/bin/env python3
"""JEDI LINKAGE — a peer adjudicator for the cases CPython's MRO cannot reach.

CPython's MRO (emit_linkage.py) is ground truth, but it can only speak where the
receiver TYPE IS ALREADY KNOWN — `self`, `cls`. That leaves exactly our weakest
receivers unadjudicated: NAME (locals), CALL_RESULT, ATTRIBUTE chains.

jedi covers those. It is not ground truth — it is another static analyser doing the
same inference we are — but it has been VALIDATED against CPython on the subset
CPython can adjudicate: 432/432 self-call sites, zero disagreements. A peer measured
at 100% where truth is available is strong evidence where it is not.

TIER 2 WITH A CAVEAT, never Gate 1. Where jedi and the parser disagree, something
still has to decide which is right; the disagreement is a work item, not a verdict.

Unlike emit_introspection.py this does NOT import the target, so it is safe on any
corpus, not just the stdlib.

Usage:  emit_jedi_linkage.py --file X.py [--root DIR]
"""
import argparse, ast, json, os, sys

try:
    import jedi
except ImportError:
    json.dump({"fatal": "jedi not installed for this interpreter"}, sys.stdout)
    sys.stdout.write("\n"); sys.exit(0)


def receiver_kind(node, self_names):
    b = node.func.value
    if isinstance(b, ast.Name):
        if b.id in self_names: return "SELF", b.id
        if b.id == "cls": return "CLS", b.id
        return "NAME", b.id
    if isinstance(b, ast.Attribute): return "ATTRIBUTE", ast.unparse(b)
    if isinstance(b, ast.Call): return "CALL_RESULT", ast.unparse(b)[:40]
    if isinstance(b, ast.Subscript): return "SUBSCRIPT", ast.unparse(b)[:40]
    if isinstance(b, ast.Constant): return "LITERAL", repr(b.value)[:20]
    return "OTHER", ""


def owning_class(defn):
    p = defn.parent()
    while p is not None:
        if p.type == "class": return p.name
        p = p.parent()
    return None


def run(path, root):
    src = open(path, "rb").read().decode("utf-8", "replace")
    try:
        tree = ast.parse(src, filename=path)
    except SyntaxError as e:
        return {"fatal": "SYNTAX_ERROR", "detail": str(e)}
    project = jedi.Project(root) if root else None
    script = jedi.Script(code=src, path=path, project=project)

    # names bound as the first parameter of a method -> treat as `self`
    self_names = set()
    for c in ast.walk(tree):
        if isinstance(c, ast.ClassDef):
            for m in c.body:
                if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    a = m.args.posonlyargs + m.args.args
                    if a: self_names.add(a[0].arg)

    rows = []
    for n in ast.walk(tree):
        if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)):
            continue
        kind, recv = receiver_kind(n, self_names)
        entry = {
            "line": n.func.end_lineno, "col": n.func.end_col_offset,
            "callLine": n.lineno, "callCol": n.col_offset,
            "callee": n.func.attr, "receiverKind": kind, "receiverText": recv,
        }
        try:
            defs = script.goto(n.func.end_lineno, n.func.end_col_offset - 1,
                               follow_imports=True)
        except Exception as exc:
            entry["jedi"] = None
            entry["jediError"] = type(exc).__name__
            rows.append(entry); continue
        if not defs:
            entry["jedi"] = None
        else:
            d = defs[0]
            entry["jedi"] = {
                "name": d.name,
                "owningClass": owning_class(d),
                "module": d.module_name,
                "modulePath": str(d.module_path) if d.module_path else "",
                "line": d.line,
                "type": d.type,
                # is jedi's answer inside the analysis root?
                "inRoot": bool(root and d.module_path and
                               str(d.module_path).startswith(os.path.realpath(root))),
            }
        rows.append(entry)
    return {"file": path, "rows": rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--root")
    a = ap.parse_args()
    json.dump(run(a.file, a.root), sys.stdout, indent=1, sort_keys=True, default=str)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
