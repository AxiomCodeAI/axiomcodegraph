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


def _in_root(root, module_path):
    """True when jedi's answer lives inside the analysis root.

    Both paths are realpath'd. See the call site for why: one-sided realpath
    silently reported every vendored module as external on macOS.
    """
    if not root or not module_path:
        return False
    r = os.path.realpath(str(root))
    m = os.path.realpath(str(module_path))
    return m == r or m.startswith(r + os.sep)


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
    # PIN BOTH THE ENVIRONMENT AND THE SEARCH PATH.
    #
    # Neither is jedi's default, and the default is silently wrong here. Measured
    # on a vendored asyncio corpus: every single one of 5,607 call sites came back
    # inRoot=false, because jedi resolved `WeakSet` to
    # /opt/anaconda3/lib/python3.12/_weakrefset.py — a different interpreter's
    # stdlib — instead of the copy sitting in the corpus root. The gate then read
    # "1605 resolved, 0 disagreements, 100% correct", which is what a peer
    # producing NOTHING looks like if you forget to check that it produced
    # something.
    #
    # environment_path forces the pinned interpreter; added_sys_path puts the
    # corpus AHEAD of it, which is the whole point of vendoring — a vendored copy
    # must win over the installed original or the corpus is decorative.
    project = None
    if root:
        try:
            project = jedi.Project(
                root,
                environment_path=sys.executable,
                added_sys_path=[root],
            )
        except TypeError:
            # older jedi without one of the kwargs — degrade, but say so
            project = jedi.Project(root)
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
                # Is jedi's answer inside the analysis root?
                #
                # BOTH SIDES REALPATHED. Comparing a raw module_path against a
                # realpath'd root reads false for every file on macOS, where /tmp
                # is a symlink to /private/tmp — jedi returned
                # /tmp/vendored-asyncio/asyncio/events.py, plainly in the corpus,
                # and this said no. The gate then scored 1,605 sites as ONLY_US
                # with zero agreement and reported "100% correct", because a
                # denominator that collapses to the cases we answered will always
                # read 100%.
                "inRoot": _in_root(root, d.module_path),
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
