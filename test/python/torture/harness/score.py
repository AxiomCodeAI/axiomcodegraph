"""Per-FAMILY coverage against tier-4.

Identity: the call site (clientFile, line) -> the callee's (prov, file, defLine).
A line can hold several calls, so a hit means the engine has the true target
somewhere on that line; every fixture line is written to hold one interesting
call so this stays tight.

Verdicts: CONCRETE (exactly the observed target) · SUPERSET (contains it, wider)
· WRONG (answered, target absent) · MISSED (nothing emitted).
`# EXPECT: miss` cases are scored in their own bucket -- a known miss that starts
passing is reported, not silently absorbed.
"""
import csv, json, collections, os, ast, sys, re
csv.field_size_limit(10**9)
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(R, 'out')
gt = json.load(open(os.path.join(R, 'gt-tier4.json')))

def defs_of(base):
    d = {}
    for dp, _, fs in os.walk(base):
        if '__pycache__' in dp: continue
        for fn in fs:
            if not fn.endswith('.py'): continue
            fp = os.path.join(dp, fn); rel = os.path.relpath(fp, base)
            t = ast.parse(open(fp, encoding='utf-8').read())
            for n in ast.walk(t):
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    d[(rel, n.lineno)] = n.name
                    if n.decorator_list:
                        d.setdefault('DEC', {})[(rel, min(x.lineno for x in n.decorator_list))] = n.lineno
    return d
LD = defs_of(os.path.join(R, 'lib')); CD = defs_of(os.path.join(R, 'client'))
DEC = {('lib', k): v for k, v in LD.get('DEC', {}).items()}
DEC.update({('client', k): v for k, v in CD.get('DEC', {}).items()})
# lib IR is rooted at the PACKAGE, so strip the leading tlib/
def canon(prov, f, l):
    l = DEC.get((prov, (f, l)), l)
    if prov == 'lib' and f.startswith('tlib/'): f = f[len('tlib/'):]
    return (prov, f, l)

# EXPECT: miss markers, by (clientFile, enclosing def name)
expect = set()
for dp, _, fs in os.walk(os.path.join(R, 'client')):
    for fn in fs:
        if not fn.endswith('.py'): continue
        src = open(os.path.join(dp, fn), encoding='utf-8').read().split('\n')
        t = ast.parse('\n'.join(src))
        for n in ast.walk(t):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                body = '\n'.join(src[n.lineno - 1:(n.end_lineno or n.lineno)])
                if 'EXPECT: miss' in body: expect.add((fn, n.name))
enc = {}
for dp, _, fs in os.walk(os.path.join(R, 'client')):
    for fn in fs:
        if not fn.endswith('.py'): continue
        t = ast.parse(open(os.path.join(dp, fn), encoding='utf-8').read())
        for n in ast.walk(t):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for ln in range(n.lineno, (n.end_lineno or n.lineno) + 1): enc[(fn, ln)] = n.name

cmod = {r['pyModuleUniqueHash']: r['filePath'] for r in csv.DictReader(open(f'{R}/client-ir/all-python-modules.csv', newline='', encoding='utf-8'), delimiter='\t')}
eline = {r['pyExpressionUniqueHash']: (cmod.get(r['pyModuleLinkHash']), int(r['startLine']))
         for r in csv.DictReader(open(f'{R}/client-ir/all-python-expressions.csv', newline='', encoding='utf-8'), delimiter='\t')
         if r['kind'] in ('CALL', 'NAME_REFERENCE', 'ATTRIBUTE_ACCESS')}
def meths(d, prov):
    return {r['pyMethodUniqueHash']: (prov, r['filePath'], int(r['startLine']))
            for r in csv.DictReader(open(f'{R}/{d}/all-python-methods.csv', newline='', encoding='utf-8'), delimiter='\t')}
M = {}; M.update(meths('client-ir', 'client')); M.update(meths('lib-ir', 'lib'))
byline = collections.defaultdict(set)
for line in open(f'{OUT}/call-chain-edges.csv'):
    f = line.rstrip('\n').split('\t')
    if len(f) < 7: continue
    k = eline.get(f[0])
    if k and f[3] in M: byline[k].add(M[f[3]])

G = collections.defaultdict(set)
for e in gt:
    if e['callerProv'] != 'client': continue
    G[(e['callerFile'], e['callerLine'])].add(canon(e['calleeProv'], e['calleeFile'], e['calleeLine']))
fam = collections.defaultdict(lambda: collections.Counter()); known = collections.Counter(); rows = []
for (cf, cl), true in sorted(G.items()):
    if cf == 'main.py': continue
    S = byline.get((cf, cl), set())
    # A line can hold several calls, so S and true are UNIONS. Distinguish
    # PARTIAL (engine got some, invented nothing) from WRONG (engine named a
    # target that never ran). Collapsing the two overstates error badly.
    if not S: v = 'MISSED'
    elif S == true: v = 'CONCRETE'
    elif true <= S: v = 'SUPERSET'
    elif S <= true: v = 'PARTIAL'
    else: v = 'WRONG'
    f = cf.split('_')[0]
    if (cf, enc.get((cf, cl))) in expect: known[v] += 1
    else: fam[f][v] += 1; rows.append((cf, cl, v, sorted(true), sorted(S)))
print(f"=== per-family coverage (tier-4, {sum(sum(c.values()) for c in fam.values())} scored sites) ===")
names = {'f01':'inheritance & MRO','f02':'callables & closures','f03':'generics','f04':'descriptors',
         'f05':'decorators','f06':'value flow','f07':'imports & re-export','f08':'dynamic'}
tot = collections.Counter()
for f in sorted(fam):
    c = fam[f]; n = sum(c.values()); tot.update(c)
    print(f"  {f} {names.get(f,f):24} n={n:3}  concrete={c['CONCRETE']:3} ({c['CONCRETE']/n:5.1%})  partial={c['PARTIAL']:2}  superset={c['SUPERSET']:2}  WRONG={c['WRONG']:2}  missed={c['MISSED']:2}")
n = sum(tot.values())
print(f"\n  {'TOTAL':29} n={n:3}  concrete={tot['CONCRETE']:3} ({tot['CONCRETE']/n:5.1%})  partial={tot['PARTIAL']:2}  superset={tot['SUPERSET']:2}  WRONG={tot['WRONG']:2}  missed={tot['MISSED']:2}")
ans = n - tot['MISSED']
clean = n - tot['WRONG']
print(f"  recall (fully concrete)      {tot['CONCRETE']}/{n} = {tot['CONCRETE']/n:.1%}")
print(f"  emitted nothing incorrect    {clean}/{n} = {clean/n:.1%}   <- WRONG is the only real error class")
print(f"\n  EXPECTED-MISS cases: {dict(known)}   (a CONCRETE here means a known blind spot closed)")
print("\n--- non-concrete sites ---")
for cf, cl, v, true, S in rows:
    if v != 'CONCRETE': print(f"  {cf}:{cl:<4} {v:9} true={true} engine={S}")
