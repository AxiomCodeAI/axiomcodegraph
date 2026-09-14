"""TIER-4 ground truth: what actually ran. Coordinates are (file, def line), which
join directly to py_expression.startLine and py_method.startLine."""
import sys, os, json, collections
H = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(H)
LIB, CLI = os.path.join(ROOT, 'lib'), os.path.join(ROOT, 'client')
sys.path.insert(0, LIB); sys.path.insert(0, CLI)
edges = collections.Counter()
def rel(p):
    p = os.path.abspath(p)
    for base, tag in ((LIB, 'lib'), (CLI, 'client')):
        if p.startswith(base + os.sep): return tag, os.path.relpath(p, base)
    return None, p
def prof(frame, event, arg):
    if event != 'call': return
    c = frame.f_code; tt, tf = rel(c.co_filename)
    if tt is None: return
    b = frame.f_back
    if b is None: return
    st, sf = rel(b.f_code.co_filename)
    if st is None: return
    edges[((st, sf, b.f_lineno), (tt, tf, c.co_firstlineno, c.co_name))] += 1
import main as m
sys.setprofile(prof)
try: m.main()
finally: sys.setprofile(None)
out = [{'callerProv': k[0][0], 'callerFile': k[0][1], 'callerLine': k[0][2],
        'calleeProv': k[1][0], 'calleeFile': k[1][1], 'calleeLine': k[1][2],
        'calleeName': k[1][3], 'count': v} for k, v in edges.items()]
json.dump(out, open(os.path.join(ROOT, 'gt-tier4.json'), 'w'), indent=1)
print(f"observed {len(out)} distinct call-site -> callee edges")
print("  client-caller edges:", sum(1 for e in out if e['callerProv'] == 'client'))

# ── COVERAGE ASSERTION ───────────────────────────────────────────────────────
# Tier-4 records only what EXECUTED, so a case main.py stops calling does not fail --
# it silently leaves the ground truth, and the engine then gets neither credit nor
# blame for it. A fixture function that quietly stopped running would make its whole
# family look perfect.
#
# The TypeScript harness hit the same failure mode from a different direction: a broken
# module mirror meant tsc could not resolve those calls either, so they were marked
# unadjudicable rather than wrong. Same shape -- the harness silently shrinking what it
# is willing to judge. This makes that loud here.
import ast as _ast
_declared = set()
for _dp, _dn, _fs in os.walk(CLI):
    _dn[:] = [d for d in _dn if d != '__pycache__']
    for _fn in _fs:
        if not _fn.endswith('.py') or _fn == 'main.py': continue
        _rel = os.path.relpath(os.path.join(_dp, _fn), CLI)
        for _n in _ast.walk(_ast.parse(open(os.path.join(_dp, _fn), encoding='utf-8').read())):
            if isinstance(_n, (_ast.FunctionDef, _ast.AsyncFunctionDef)) and not _n.name.startswith('_'):
                _declared.add((_rel, _n.name))
_ran = {(e['calleeFile'], e['calleeName']) for e in out if e['calleeProv'] == 'client'}
_never = sorted(_declared - _ran)
if _never:
    print(f"\nERROR: {len(_never)} fixture function(s) never executed -- they contribute NO")
    print("ground truth, so their construct is silently unscored. Call them from main.py:")
    for _f, _nm in _never: print(f"    {_f}::{_nm}")
    sys.exit(1)
print(f"  coverage: all {len(_declared)} fixture functions executed")
