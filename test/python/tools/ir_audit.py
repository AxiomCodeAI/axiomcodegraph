#!/usr/bin/env python3
"""IR AUDIT — what did the PARSER fail to represent?

Distinct from every other check in this tree. The coverage guard asks "did the ENGINE drop
a site the parser found"; the oracle score asks "did the engine get the targets right".
Neither can see a construct the parser never emitted at all, because the IR is their
denominator.

So this one takes CPython as the denominator and the IR as the answer sheet:

  code objects   every function/lambda/comprehension `compile()` produces, vs py_method
  classes        every class statement, vs py_type
  (call sites    NOT here. `every non-implicit CALL the compiler emits, vs
                 py_call_site + py_decorator` was advertised on this line and never
                 implemented — this tool opens neither CSV. That invariant lives in
                 tools/coverage_guard.py, whose check 2 does exactly it and, since
                 #224, actually runs and can fail. Recorded rather than deleted so a
                 reader who came here looking for it is sent to the right place.)
  bindings       every symtable symbol, vs py_binding

A shortfall here is an IR flaw and nothing the engine can fix. A surplus is usually the
parser modelling something CPython synthesises (a synthetic <module> owner), which is
deliberate.

usage: ir_audit.py <src-dir> <ir-dir>
"""
import ast
import collections
import csv
csv.field_size_limit(10**9)   # an IR literalValue can be a base64 asset; see test/tools/csv-limit-test.sh
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


# Directories the IR build deliberately excludes (build-stdlib-ir.sh: "the test tree is
# ~a third of Lib/ and is not library surface"). Counting them made six stdlib shards look
# catastrophically incomplete -- unittest 2,186 "missing" code objects, ctypes 525,
# lib2to3 845 -- when EVERY one was under a test/ tree the build never fed the parser.
# The denominator has to match the build's own policy or the audit invents defects.
EXCLUDED_DIRS = {'test', 'tests', 'idle_test', '__pycache__', 'site-packages'}


def py_files(root):
    for base, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]
        for n in sorted(names):
            if n.endswith('.py'):
                p = os.path.join(base, n)
                yield p, os.path.relpath(p, root).replace(os.sep, '/')


# ── CPython's inventory ──────────────────────────────────────────────────────
cp_code, cp_class, cp_bind = set(), set(), set()
unparseable = []
for path, rel in py_files(SRC):
    try:
        src = open(path, encoding='utf-8').read()
        tree = ast.parse(src, filename=path)
    except (SyntaxError, UnicodeDecodeError) as exc:
        # CPython itself cannot compile this file, so it is not a parser gap -- the stdlib
        # ships deliberately-broken fixtures (lib2to3 grammar tests, encoding samples).
        # Recorded so the denominator is honest rather than silently smaller.
        unparseable.append((rel, type(exc).__name__))
        continue
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            cp_code.add((rel, node.lineno, node.name))
        elif isinstance(node, ast.Lambda):
            cp_code.add((rel, node.lineno, '<lambda>'))
        elif isinstance(node, ast.ClassDef):
            cp_class.add((rel, node.lineno, node.name))
    try:
        st = symtable.symtable(src, path, 'exec')
    except (SyntaxError, ValueError):
        continue

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


print(f"IR audit: {SRC}")
if unparseable:
    print(f"  ({len(unparseable)} file(s) CPython itself cannot compile, excluded from the "
          f"denominator: {', '.join(r for r, _ in unparseable[:4])}"
          f"{' …' if len(unparseable) > 4 else ''})")
print()
gaps = 0
gaps += report('code objects', cp_code, ir_code)
gaps += report('classes', cp_class, ir_class)
gaps += report('bindings', cp_bind, ir_bind)
print(f"\ntotal constructs CPython compiled that the IR does not represent: {gaps}")
sys.exit(1 if gaps else 0)
