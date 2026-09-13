"""Shipped-source vs test/spec tables, decline classes, stratum overlap.

    python3 tools/javascript/stratified-report-tables.py <work-dir>

<work-dir> is the directory holding the sweep artefacts:
    <work-dir>/out/<pkg>/all-javascript-*.csv   parser output, one dir per corpus member
    <work-dir>/oracle/<pkg>.json                 oracle-adjudicate.mjs output
    <work-dir>/perfile.json                      written by stratified-report.py, read by -tables.py

Nothing here is an expectation. Every figure is a property of the CORPUS.
"""
import json, glob, collections, os, re, sys

if len(sys.argv) < 2:
    sys.exit(__doc__)
WORK = sys.argv[1].rstrip("/")
OUT, ORACLE = WORK + "/out", WORK + "/oracle"
for d in (OUT, ORACLE):
    if not os.path.isdir(d):
        sys.exit(f"missing {d} — see the docstring for the expected layout")
rows=json.load(open(WORK+"/perfile.json"))
TESTRE=re.compile(r'(^|/)(__tests__|__mocks__|test|tests|spec)(/|$)|[-.](test|spec)\.[cm]?jsx?$')
for r in rows: r["isTest"]=bool(TESTRE.search(r["file"]))
def agg(rs):
    a=collections.Counter()
    for r in rs:
        for k,v in r["t"].items(): a[k]+=v
        a["files"]+=1
    return a
HDR=f"{'':<18}{'files':>6}{'calls':>9}{'RESOLVED':>9}{'SYNTH':>7}{'DECLINED':>9}{'decidable':>10}{'recall miss':>12}{'requires':>9}{'req miss':>9}"
def line(name,a):
    c=a["call_sites_oracle"]; d=a["RESOLVED"]+a["SYNTHESIZED"]
    print(f"{name:<18}{a['files']:>6}{c:>9}{a['RESOLVED']:>9}{a['SYNTHESIZED']:>7}{a['ANY_SIGNATURE']:>9}"
          f"{(100*d/c if c else 0):>9.1f}% {a['RECALL_MISS']:>6} {(100*a['RECALL_MISS']/c if c else 0):>4.2f}%{a['require_module_edge']:>9}{a['require_MISSING_IMPORT_ROW']:>9}")
def sect(title, rs):
    print("\n"+title); print(HDR)
    s=collections.defaultdict(list)
    for r in rs: s[r["stratum"]].append(r)
    for k in ["cjs-prototype","esm","jsdoc-typed","jsx-in-js"]:
        if s[k]: line(k,agg(s[k]))
    line("— total —",agg(rs))
prod=[r for r in rows if not r["isTest"]]; test=[r for r in rows if r["isTest"]]
# The stratum is assigned in report.py and read here. That split made a patch to
# report2's OWN stratum function a silent no-op — it has none — and the flow
# stratum printed as absent while 242 flow files sat in the data. Assert it.
# FLOW IS NO LONGER A RESOLUTION STRATUM. Under the out-of-scope ruling a Flow
# file emits one js_module row with sourceProvenance = FLOW_EXCLUDED and nothing
# else, so it has no calls to resolve and cannot appear here. The old assertion
# ("some file must be in the flow stratum") was right for the sweep before the
# ruling and is wrong after it — it asserted a condition the ruling removed.
# The value was renamed FLOW_EXCLUDED -> FLOW_REJECTED on 2026-09-13 (schema
# §3.1.1: it is a rejection, BUNDLED is a label). Both spellings are accepted so
# the script measures whichever parser commit produced the output; a rename must
# not read as "0 declined".
FLOW_VALUES = {"FLOW_EXCLUDED", "FLOW_REJECTED"}
#
# What replaces it is a DETECTION measure, printed below and read from the module
# relation rather than from the oracle: how many files were declined, and how many
# SYNTACTIC_FLOW rows survived — each of those being a file whose Flow-ness was
# NOT detected, i.e. a detection MISS.
assert not any(r["stratum"] == "flow" for r in rows), \
    ("a Flow file reached the resolution tables; under the out-of-scope ruling it should have "
     "emitted one module row and nothing else, so either the ruling regressed or this report is "
     "reading a pre-ruling fact base")
print("="*110)
print("SHIPPED (non-test) SOURCE — the population the parser is for")
sect("per stratum:",prod)
print("="*110)
print("TEST / SPEC FILES — real JavaScript, CLASSIFIED not excluded. 64.8% of their declines are")
print("test-framework globals with no ambient declaration, so they set any rate they are mixed into.")
sect("per stratum:",test)
# ---- FLOW: a DETECTION rate, not a resolution rate -------------------------
import csv as _csv
prov = collections.Counter(); flowFiles = []; syntacticFlow = collections.Counter()
for d in sorted(os.listdir(OUT)):
    dd = os.path.join(OUT, d)
    if not os.path.isdir(dd): continue
    mf = os.path.join(dd, "all-javascript-modules.csv")
    if not os.path.exists(mf) or os.path.getsize(mf) == 0: continue
    with open(mf) as fh:
        h = fh.readline().rstrip("\n").split("\t")
        iP, iF, iPr = h.index("filePath"), h.index("hasFlowPragma"), h.index("sourceProvenance")
        for l in fh:
            c = l.rstrip("\n").split("\t")
            prov[c[iPr]] += 1
            if c[iPr] in FLOW_VALUES: flowFiles.append(f"{d}/{c[iP]}")
    pf = os.path.join(dd, "all-javascript-method-parameters.csv")
    if os.path.exists(pf) and os.path.getsize(pf) > 0:
        with open(pf) as fh:
            h = fh.readline().rstrip("\n").split("\t"); i = h.index("declaredTypeSource")
            for l in fh:
                c = l.rstrip("\n").split("\t")
                if len(c) > i and c[i] == "SYNTACTIC_FLOW": syntacticFlow[d] += 1
print("\n" + "="*110)
print("FLOW — a DETECTION measure now, not a resolution one")
print("  A declined file emits one js_module row and nothing else, so it has no calls to resolve.")
print("  What can be wrong is DETECTION, in two directions, and only one of them is visible here.")
flowDeclined = sum(prov[v] for v in FLOW_VALUES)
print(f"  declined (sourceProvenance in {sorted(v for v in FLOW_VALUES if prov[v])}) : {flowDeclined}")
print(f"  DETECTION MISSES (SYNTACTIC_FLOW rows that survived): {sum(syntacticFlow.values())}"
      + (f"  in {dict(syntacticFlow)}" if syntacticFlow else ""))
print("  Each surviving SYNTACTIC_FLOW row names a file whose Flow-ness the detector did not catch.")
print("  THE OTHER DIRECTION IS INVISIBLE TO THIS CORPUS: a Flow file with no pragma and no")
print("  .js.flow name is not detected AND emits no SYNTACTIC_FLOW row if its annotations happen")
print("  to sit outside parameters. This corpus cannot size that, because it identified its own")
print("  Flow population by pragma in the first place.")
print("\n  sourceProvenance overall: " + ", ".join(f"{k}={v}" for k, v in prov.most_common()))

print("\n"+"="*110)
print("STRATUM OVERLAP — the priority order above assigns one stratum per file; this does not")
ov=collections.Counter()
for r in rows:
    tags=[]
    if r["hasFlow"]: tags.append("flow")
    if r["hasJsx"]: tags.append("jsx")
    if r["jsdocTags"]>=10: tags.append("jsdoc")
    ov[" + ".join(tags) or "none of the three"]+=1
for k,v in ov.most_common(): print(f"  {v:>5}  {k}")

print("\n"+"="*110)
print("PER MODULE SYSTEM (shipped source only)"); print(HDR)
ms=collections.defaultdict(list)
for r in prod: ms[r["moduleSystem"] or "?"].append(r)
for k in sorted(ms): line(k,agg(ms[k]))
print("\nESM-SYNTAX-UNDER-COMMONJS (bundler input) vs true CommonJS, shipped source only"); print(HDR)
g=collections.defaultdict(list)
for r in prod:
    if r["moduleSystem"]=="ESM": g["ESM (declared)"].append(r)
    elif r["contradiction"]=="ESM_SYNTAX_UNDER_COMMONJS": g["ESM syntax / CJS pkg"].append(r)
    else: g["CommonJS"].append(r)
for k in ["CommonJS","ESM syntax / CJS pkg","ESM (declared)"]:
    if g[k]: line(k,agg(g[k]))
A=agg(prod)
print("\nDECLINE CAUSES — shipped source only. The oracle DECLINED; this is not a defect population.")
tot=A["ANY_SIGNATURE"]
ENVU={"REQUIRED_BINDING__NODE_BUILTIN_NO_TYPES","AMBIENT_GLOBAL_UNDECLARED","REQUIRED_BINDING__NODE_INTERNAL_NAMESPACE"}
ENVF={"REQUIRED_BINDING__PACKAGE_NOT_INSTALLED","ENV__PACKAGE_NOT_INSTALLED","ENV__LOCAL_IMPORT_OUTSIDE_CHECKOUT"}
cls=collections.Counter()
for k,v in A.items():
    if not k.startswith("DECLINE__"): continue
    n=k[9:]
    cls["environmental-but-UNFIXABLE" if n in ENVU else "environmental-and-fixable" if n in ENVF else "language-intrinsic"]+=v
    print(f"  {v:>7} {100*v/tot:>5.1f}%  {n}")
print("\n  rolled up:")
for k,v in cls.most_common(): print(f"  {v:>7} {100*v/tot:>5.1f}%  {k}")
for label, subset in [("shipped source", prod), ("test/spec files", test)]:
    print(f"\nRESOLUTION PER RECEIVER SHAPE — {label}")
    G=collections.Counter()
    for r in subset:
        for k,v in r["t"].items():
            if k.startswith("SHAPE_"): G[k]+=v
    shapes=sorted({k.split('__',1)[1] for k in G})
    assert any(G[f'SHAPE_RESOLVED__{x}'] for x in shapes) and any(G[f'SHAPE_ANY__{x}'] for x in shapes), \
        'shape table cannot distinguish resolved from declined'
    print(f"  {'receiver shape':<22}{'calls':>9}{'decidable':>10}{'rate':>8}")
    for x in shapes:
        r_=G[f'SHAPE_RESOLVED__{x}']+G[f'SHAPE_SYNTH__{x}']; t_=r_+G[f'SHAPE_ANY__{x}']
        print(f"  {x:<22}{t_:>9}{r_:>10}{(100*r_/t_ if t_ else 0):>7.1f}%")
print("\nPER-PACKAGE environmental-but-UNFIXABLE share of declines (shipped source)")
pk=collections.defaultdict(collections.Counter)
for r in prod:
    for k,v in r["t"].items(): pk[r["pkg"]][k]+=v
print(f"  {'package':<18}{'declines':>9}{'nodeBuiltin':>12}{'ambientGlob':>12}{'env-unfix %':>12}")
for k in sorted(pk):
    c=pk[k]; d=c["ANY_SIGNATURE"]
    if not d: continue
    e=(c["DECLINE__REQUIRED_BINDING__NODE_BUILTIN_NO_TYPES"]+c["DECLINE__AMBIENT_GLOBAL_UNDECLARED"]
       +c["DECLINE__REQUIRED_BINDING__NODE_INTERNAL_NAMESPACE"])
    print(f"  {k:<18}{d:>9}{c['DECLINE__REQUIRED_BINDING__NODE_BUILTIN_NO_TYPES']:>12}{c['DECLINE__AMBIENT_GLOBAL_UNDECLARED']:>12}{100*e/d:>11.1f}%")
