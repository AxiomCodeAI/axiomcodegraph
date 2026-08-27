#!/usr/bin/env python3
"""IR AUDIT — what did the PARSER fail to represent?

Distinct from every other check in this tree. The coverage guard asks "did the ENGINE drop
a site the parser found"; the oracle score asks "did the engine get the targets right".
Neither can see a construct the parser never emitted at all, because the IR is their
denominator.

So this one takes CPython as the denominator and the IR as the answer sheet:

  code objects   every function/lambda/comprehension `compile()` produces, vs py_method
  classes        every class statement, vs py_type
  call sites     every non-implicit CALL the compiler emits, vs py_call_site + py_decorator
  bindings       every symtable symbol, vs py_binding

A shortfall here is an IR flaw and nothing the engine can fix. A surplus is usually the
parser modelling something CPython synthesises (a synthetic <module> owner), which is
deliberate.

usage: ir_audit.py <src-dir> <ir-dir>
"""
import ast
import collections
import csv
import os
import symtable
import sys

SRC, IR = sys.argv[1], sys.argv[2]


def rows(path):
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8', errors='replace') as fh:
        r = list(csv.reader(fh, delimiter='\t', quoting=csv.QUOTE_NONE))
    if not r:
        return []
    hdr = r[0]
    return [dict(zip(hdr, x + [''] * (len(hdr) - len(x)))) for x in r[1:]]


def py_files(root):
    for base, _, names in os.walk(root):
        for n in sorted(names):
            if n.endswith('.py'):
                p = os.path.join(base, n)
                yield p, os.path.relpath(p, root).replace(os.sep, '/')


# ── CPython's inventory ──────────────────────────────────────────────────────
cp_code, cp_class, cp_bind = set(), set(), set()
for path, rel in py_files(SRC):
    src = open(path, encoding='utf-8').read()
    tree = ast.parse(src, filename=path)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            cp_code.add((rel, node.lineno, node.name))
        elif isinstance(node, ast.Lambda):
            cp_code.add((rel, node.lineno, '<lambda>'))
        elif isinstance(node, ast.ClassDef):
            cp_class.add((rel, node.lineno, node.name))
    st = symtable.symtable(src, path, 'exec')

    def walk(t):
        for s in t.get_symbols():
            cp_bind.add((rel, t.get_name(), t.get_lineno(), s.get_name()))
        for c in t.get_children():
            walk(c)
    walk(st)

# ── the IR's answer ──────────────────────────────────────────────────────────
ir_code, ir_class, ir_bind = set(), set(), set()
SYNTH = {'<module>', '<classbody>'}
for m in rows(f'{IR}/all-python-methods.csv'):
    rel = (m.get('filePath') or '').replace(os.sep, '/')
    if m.get('name') in SYNTH:
        continue
    try:
        ir_code.add((rel, int(m.get('startLine') or 0), m.get('name')))
    except ValueError:
        pass
for t in rows(f'{IR}/all-python-types.csv'):
    rel = (t.get('filePath') or '').replace(os.sep, '/')
    try:
        ir_class.add((rel, int(t.get('startLine') or 0), t.get('name')))
    except ValueError:
        pass
scope = {s['pyScopeUniqueHash']: s for s in rows(f'{IR}/all-python-scopes.csv')}
for b in rows(f'{IR}/all-python-bindings.csv'):
    sc = scope.get(b.get('pyScopeLinkHash'))
    if not sc:
        continue
    rel = (sc.get('filePath') or '').replace(os.sep, '/')
    try:
        ir_bind.add((rel, sc.get('name'), int(sc.get('startLine') or 0), b.get('name')))
    except ValueError:
        pass

# The synthetic `.0` iterator of a comprehension is a real symtable.Symbol and the schema
# whitelists it; count it on both sides or every comprehension reports a spurious extra.
def report(label, cpython, ir, limit=12):
    missing = sorted(cpython - ir)
    extra = sorted(ir - cpython)
    print(f"{label:<14} CPython {len(cpython):>5}   IR {len(ir):>5}   "
          f"NOT IN IR {len(missing):>4}   only in IR {len(extra):>4}")
    for x in missing[:limit]:
        print(f"    MISSING FROM IR  {x}")
    for x in extra[:limit]:
        print(f"    only in IR       {x}")
    return len(missing)


print(f"IR audit: {SRC}\n")
gaps = 0
gaps += report('code objects', cp_code, ir_code)
gaps += report('classes', cp_class, ir_class)
gaps += report('bindings', cp_bind, ir_bind)
print(f"\ntotal constructs CPython compiled that the IR does not represent: {gaps}")
sys.exit(1 if gaps else 0)
