"""Per-stratum, per-module-system and per-receiver-shape report.

    python3 src/test/javascript-gates/stratified-report.py <work-dir>

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
# jsdoc tag counts per module, from the parser output
jsdoc={}
for d in sorted(os.listdir(OUT)):
    dd=os.path.join(OUT,d)
    if not os.path.isdir(dd): continue
    mp={}
    f=os.path.join(dd,"all-javascript-modules.csv")
    if not os.path.exists(f) or os.path.getsize(f)==0: continue
    with open(f) as fh:
        h=fh.readline().rstrip("\n").split("\t"); iH=h.index("jsModuleUniqueHash"); iP=h.index("filePath")
        for l in fh:
            c=l.rstrip("\n").split("\t"); mp[c[iH]]=c[iP]
    f=os.path.join(dd,"all-javascript-comments.csv")
    if os.path.exists(f) and os.path.getsize(f)>0:
        with open(f) as fh:
            h=fh.readline().rstrip("\n").split("\t"); iM=h.index("ownerModuleLinkHash"); iJ=h.index("isJsdoc"); iT=h.index("jsdocTagCount")
            for l in fh:
                c=l.rstrip("\n").split("\t")
                if len(c)>max(iM,iJ,iT) and c[iJ]=="true":
                    k=(d,mp.get(c[iM],""));  jsdoc[k]=jsdoc.get(k,0)+int(c[iT] or 0)

rows=[]
for f in sorted(glob.glob(ORACLE+"/*.json")):
    d=json.load(open(f)); lab=d["label"]; pk=os.path.basename(f)[:-5]
    mf=d.get("moduleFacts",{})
    for rel,t in d.get("perFile",{}).items():
        m=mf.get(rel,{})
        rows.append(dict(pkg=lab,outdir=pk,file=rel,t=t,
            moduleSystem=m.get("moduleSystem"),contradiction=m.get("contradiction"),
            hasJsx=m.get("hasJsx")=="true",hasFlow=m.get("hasFlow")=="true",
            scriptKind=m.get("scriptKind"), jsdocTags=jsdoc.get((pk,rel),0)))

def stratum(r):
    # FLOW FIRST, and the priority is the finding rather than bookkeeping. Flow is
    # a property of the GRAMMAR a file is written in; jsx-in-js and jsdoc-typed are
    # properties of what it contains. A file can be all three, and when it is, the
    # grammar decides whether it parses at all: 0 of 248 @flow files parse cleanly.
    # Burying them inside jsx-in-js is what hid them for a whole sweep. The overlap
    # is cross-tabbed in report2 rather than resolved away.
    if r["hasFlow"]: return "flow"
    if r["hasJsx"]: return "jsx-in-js"
    if r["jsdocTags"]>=10: return "jsdoc-typed"
    esm = r["moduleSystem"]=="ESM" or r["contradiction"]=="ESM_SYNTAX_UNDER_COMMONJS"
    return "esm" if esm else "cjs-prototype"
for r in rows: r["stratum"]=stratum(r)

def agg(rs):
    a=collections.Counter()
    for r in rs:
        for k,v in r["t"].items(): a[k]+=v
        a["files"]+=1
    return a
def line(name, a):
    calls=a["call_sites_oracle"]; dec=a["RESOLVED"]+a["SYNTHESIZED"]
    print(f"{name:<16} {a['files']:>6} {calls:>9} {a['RESOLVED']:>9} {a['SYNTHESIZED']:>7} {a['ANY_SIGNATURE']:>9} "
          f"{(100*dec/calls if calls else 0):>7.1f}% {a['RECALL_MISS']:>7} {(100*a['RECALL_MISS']/calls if calls else 0):>6.2f}% "
          f"{a['require_module_edge']:>7} {a['require_MISSING_IMPORT_ROW']:>6}")

print("PER STRATUM — bundled excluded by the parser's own sourceProvenance")
print(f"{'stratum':<16} {'files':>6} {'calls':>9} {'RESOLVED':>9} {'SYNTH':>7} {'DECLINED':>9} {'decidable':>8} {'recallX':>7} {'':>7} {'reqs':>7} {'reqX':>6}")
strata=collections.defaultdict(list)
for r in rows: strata[r["stratum"]].append(r)
for s in ["cjs-prototype","esm","jsdoc-typed","jsx-in-js","flow"]:
    if strata[s]: line(s, agg(strata[s]))
line("ALL", agg(rows))

print("\nPER MODULE SYSTEM")
ms=collections.defaultdict(list)
for r in rows: ms[r["moduleSystem"]].append(r)
for k,v in sorted(ms.items()): line(k or "?", agg(v))

print("\nPER PACKAGE")
pk=collections.defaultdict(list)
for r in rows: pk[r["pkg"]].append(r)
for k in sorted(pk): line(k, agg(pk[k]))

print("\nRESOLUTION PER RECEIVER SHAPE")
A=agg(rows)
# the per-file tallies carry only SHAPE__<x>; the resolved/declined split is on the
# PACKAGE-level tally, so read those, excluding bundled packages by name.
G=collections.Counter()
for f in sorted(glob.glob(ORACLE+"/*.json")):
    d=json.load(open(f))
    if d["label"].startswith("bundled/"): continue
    for k,v in d["tally"].items():
        if k.startswith("SHAPE_"): G[k]+=v
A_shape=G
shapes=sorted({k.split('__',1)[1] for k in G if k.startswith('SHAPE_')})
print(f"{'receiver shape':<22} {'calls':>9} {'decidable':>9} {'rate':>7}")
for sh in shapes:
    r=G[f'SHAPE_RESOLVED__{sh}']+G[f'SHAPE_SYNTH__{sh}']; tot=r+G[f'SHAPE_ANY__{sh}']
    print(f"{sh:<22} {tot:>9} {r:>9} {(100*r/tot if tot else 0):>6.1f}%")
# the check must be able to return BOTH 0% and 100%: SUPER resolves always, NO_SYMBOL never.
assert any(G[f'SHAPE_RESOLVED__{s}']>0 for s in shapes) and any(G[f'SHAPE_ANY__{s}']>0 for s in shapes), \
    'shape table cannot distinguish resolved from declined — it would read 0% for everything'

print("\nDECLINE CAUSES (the oracle's competence boundary, classified)")
tot=A["ANY_SIGNATURE"]
for k,v in sorted(((k[len('DECLINE__'):],v) for k,v in A.items() if k.startswith('DECLINE__')), key=lambda x:-x[1]):
    print(f"  {v:>7} {100*v/tot:>5.1f}%  {k}")

print("\nJSDOC DENSITY BAND vs decidable rate (monotonicity is NOT asserted)")
def band(r):
    if r["jsdocTags"]==0: return "0 tags"
    if r["jsdocTags"]<5: return "1-4"
    if r["jsdocTags"]<15: return "5-14"
    if r["jsdocTags"]<40: return "15-39"
    return "40+"
bb=collections.defaultdict(list)
for r in rows: bb[band(r)].append(r)
for k in ["0 tags","1-4","5-14","15-39","40+"]:
    a=agg(bb[k]); c=a["call_sites_oracle"]
    print(f"  {k:<8} files={a['files']:>5} calls={c:>8} decidable={(100*(a['RESOLVED']+a['SYNTHESIZED'])/c if c else 0):>5.1f}%")
json.dump(rows, open(WORK+"/perfile.json","w"))
