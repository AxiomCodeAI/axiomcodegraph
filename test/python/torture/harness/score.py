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

# ── SCORED PER LINK THAT ACTUALLY RAN ────────────────────────────────────────
# Two earlier keyings were both incoherent and it is worth recording why.
#   (file,line) on BOTH sides -- collapses `a() + b()` into one site. MEASURED: 16 of 51
#       lines here hold more than one callee, hiding 27% of the work from the score.
#   (file,line,calleeName) for TRUTH but (file,line) for the ENGINE -- compares one
#       site's true target against the union of every engine answer on the line, so a
#       three-call line reports three SUPERSETs and `get`'s answer is judged against
#       `tag`'s truth as WRONG. Pure artifact; it read 50.0% where nothing had changed.
# Per-SITE matching on both sides is not available: the engine names a site by what the
# SOURCE WRITES (`Point` for a construction, the attribute for a callable instance,
# nothing at all for a property read) while the trace names it by the runtime __name__.
# Those do not correspond without a mapping layer that would itself be a defect source.
# So ask the question that IS well posed on both sides: for each link that actually ran,
# did the engine emit it? Same quantity harness/scorecard.py reports in aggregate,
# broken down per construct family. Over-claims are counted separately.
G = collections.defaultdict(set)
for e in gt:
    if e['callerProv'] != 'client' or e['callerFile'] == 'main.py': continue
    G[(e['callerFile'], e['callerLine'])].add(canon(e['calleeProv'], e['calleeFile'], e['calleeLine']))
fam = collections.defaultdict(lambda: collections.Counter()); known = collections.Counter(); rows = []
for (cf, cl), true in sorted(G.items()):
    S = byline.get((cf, cl), set()); f = cf.split('_')[0]
    exp = (cf, enc.get((cf, cl))) in expect
    for t in sorted(true):
        v = 'FOUND' if t in S else 'MISSED'
        if exp: known[v] += 1
        else:
            fam[f][v] += 1
            if v == 'MISSED': rows.append((cf, cl, v, [t], sorted(S)))
    # An engine target that did not run is only a DEFECT if the engine claimed it was
    # certain. Where the engine emitted a SET -- more than one target for the site --
    # a member that did not execute on this run is sound over-approximation, which the
    # design prefers to an honest blank. Counting the two together made a correct fix
    # (gating a rebound attribute so it yields the union rather than one arbitrary
    # write) look like it had changed nothing.
    extra = sorted(S - true)
    for x in extra:
        kind = 'WIDE' if len(S) > 1 else 'OVERCLAIM'
        if exp: known[kind] += 1
        else: fam[f][kind] += 1; rows.append((cf, cl, kind, sorted(true), [x]))
print(f"=== per-family coverage (tier-4, {sum(sum(c.values()) for c in fam.values())} scored sites) ===")
names = {'f01':'inheritance & MRO','f02':'callables & closures','f03':'generics','f04':'descriptors',
         'f05':'decorators','f06':'value flow','f07':'imports & re-export','f08':'dynamic','f09':'adversarial'}
tot = collections.Counter()
for f in sorted(fam):
    c = fam[f]; n = sum(c.values()); tot.update(c)
    ran = c['FOUND'] + c['MISSED']
    print(f"  {f} {names.get(f,f):24} links={ran:3}  found={c['FOUND']:3} ({(c['FOUND']/ran if ran else 0):5.1%})  missed={c['MISSED']:2}  wide={c['WIDE']:2}  WRONG={c['OVERCLAIM']:2}")
ran = tot['FOUND'] + tot['MISSED']
print(f"\n  {'TOTAL':29} links={ran:3}  found={tot['FOUND']:3} ({tot['FOUND']/ran:5.1%})  missed={tot['MISSED']:2}  wide={tot['WIDE']:2}  WRONG={tot['OVERCLAIM']:2}")
print(f"  recall      {tot['FOUND']}/{ran} = {tot['FOUND']/ran:.1%}  of the links that actually ran")
print(f"  wide  {tot['WIDE']}   a member of a SOUND SET that did not run on this pass")
print(f"  WRONG {tot['OVERCLAIM']}   a single target asserted as certain that never ran")
print(f"\n  EXPECTED-MISS cases: {dict(known)}   (a CONCRETE here means a known blind spot closed)")
print("\n--- non-concrete sites ---")
for cf, cl, v, true, S in rows:
    print(f"  {cf}:{cl:<4} {v:10} true={true} engine={S}")
