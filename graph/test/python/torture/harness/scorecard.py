"""Java's `.oracle` artifact, for Python: one line comparing the ENGINE's client->lib
and client->client edges against CPython tier-4 (what actually ran).

Java's bytecode oracle and this are the same idea at the same granularity -- an edge
between two definitions -- so the artifact is deliberately the same shape:
    oracle=N engine=N agree=N missing=N extra=N
`extra` counts edges the engine claims from a caller the trace OBSERVED, which the
trace never saw: the fixture is straight-line, so for an executed caller the trace is
complete and an unobserved edge is a false positive.
"""
import csv, json, collections, os, ast, sys
csv.field_size_limit(10**9)
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(R, 'out', 'raw')
gt = json.load(open(os.path.join(R, 'gt-tier4.json')))
DEC = {}
BYFILE = collections.defaultdict(lambda: collections.defaultdict(list))
def defs_of(base, tag):
    d = {}
    for dp, _, fs in os.walk(base):
        if '__pycache__' in dp: continue
        for fn in fs:
            if not fn.endswith('.py'): continue
            fp = os.path.join(dp, fn); rel = os.path.relpath(fp, base)
            for n in ast.walk(ast.parse(open(fp, encoding='utf-8').read())):
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    d[(rel, n.lineno)] = n.name
                    BYFILE[tag][rel].append(n.lineno)
                    if n.decorator_list:
                        DEC[(tag, rel, min(x.lineno for x in n.decorator_list))] = n.lineno
    for f in BYFILE[tag]: BYFILE[tag][f].sort()
    return d
defs_of(os.path.join(R, 'lib'), 'lib'); defs_of(os.path.join(R, 'client'), 'client')
# strip_pkg is applied to EVERY side, and that is the whole point. A library file is
# `tlib/shapes.py` when walked on disk and when traced at runtime; the IR reported it as
# `shapes.py` while the parser dropped the package prefix, and now reports the prefix
# too. Stripping on only some sides does not fail loudly -- it renames one side's files,
# so every client->lib edge simply stops matching and the scorecard reads as though the
# engine lost most of its answers. Normalising all sides makes this insensitive to which
# convention the parser emits, in either direction.
def strip_pkg(prov, f):
    return f[len('tlib/'):] if prov == 'lib' and f.startswith('tlib/') else f
def canon(prov, f, l):
    l = DEC.get((prov, f, l), l)
    return (prov, strip_pkg(prov, f), l)
def meths(d, prov):
    # strip_pkg here as well: the IR side has to name a file exactly as the disk and
    # trace sides do. DEC is keyed on the un-stripped path, so canon cannot be reused.
    return {r['pyMethodUniqueHash']: (prov, strip_pkg(prov, r['filePath']), int(r['startLine']))
            for r in csv.DictReader(open(f'{R}/{d}/all-python-methods.csv', newline='', encoding='utf-8'), delimiter='\t')}
M = {}; M.update(meths('client-ir', 'client')); M.update(meths('lib-ir', 'lib'))
ENG = set()
for line in open(f'{OUT}/call-chain-edges.csv'):
    f = line.rstrip('\n').split('\t')
    if len(f) >= 7 and f[1] in M and f[3] in M: ENG.add((M[f[1]], M[f[3]]))
TRUE = set(); CALLERS = set()
def enclosing(prov, rel, line):
    """The trace reports the CALL line; the engine anchors a caller on its `def` line.
    Walking back to the enclosing def is what makes the two coordinate systems join --
    without it every edge misses and the scorecard reads engine=0."""
    lst = BYFILE[prov].get(rel, [])
    best = 0
    for x in lst:
        if x <= line: best = x
        else: break
    return (prov, strip_pkg(prov, rel), best)
for e in gt:
    src = enclosing(e['callerProv'], e['callerFile'], e['callerLine'])
    tgt = canon(e['calleeProv'], e['calleeFile'], e['calleeLine'])
    TRUE.add((src, tgt))
for (s, _t) in TRUE: CALLERS.add(s)
eng = {e for e in ENG if e[0] in {c for c in CALLERS}}
agree = len(eng & TRUE); missing = len(TRUE - eng); extra = len(eng - TRUE)
print(f"oracle={len(TRUE)} engine={len(eng)} agree={agree} missing={missing} extra={extra}")
