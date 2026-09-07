#!/usr/bin/env python3
"""FAN REPORT — what a colliding method name costs, and what the engine narrows it to.

The fact schema measures the problem this answers: name-based CHA gives **24.63 candidate
classes per attribute call** and 1.22M candidate edges over 49k sites on the corpus, with
21% of sites fanning wider than 10. A call graph built by matching names is mostly noise.

For one method NAME, this prints per call site:
  naive   how many definitions of that name exist in the project -- the fan a name-keyed
          resolver has to carry, with no way to choose between them
  engine  how many targets this engine emitted
  status  which tier it landed in
  ✓       every target CPython actually EXECUTED at that site is among the engine's

usage: fan_report.py <src> <ir-dir> <out-dir> <method-name>
env:   AXIOM_PY_ORACLE (the callchain-oracle checkout)
"""
import csv, os, sys, collections
csv.field_size_limit(10**9)   # an IR literalValue can be a base64 asset; see test/tools/csv-limit-test.sh
sys.path.insert(0,'test/python/tools')
from oracle_path import harness_root
harness_root()
from callchain_oracle import build
from callchain_oracle.normalize import Anchor, Normalizer, ir_anchor_line

SRC, IR, OUT, NAME = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
def rows(p):
    if not os.path.exists(p): return []
    with open(p, newline='') as f:
        r=list(csv.reader(f,delimiter='\t',quoting=csv.QUOTE_NONE))
    h=r[0]; return [dict(zip(h,x+['']*(len(h)-len(x)))) for x in r[1:]]

meth=rows(f'{IR}/all-python-methods.csv')
qn={m['pyMethodUniqueHash']:m['qualifiedName'] for m in meth}
naive=[m['pyMethodUniqueHash'] for m in meth if m['name']==NAME and m.get('bodyIsStub')!='true']
naive_all=[m['pyMethodUniqueHash'] for m in meth if m['name']==NAME]
mfile={m['pyMethodUniqueHash']:(m.get('filePath') or '').replace(os.sep,'/') for m in meth}
sites={}
for c in rows(f'{IR}/all-python-call-sites.csv'):
    c['_file']=mfile.get(c.get('pyMethodLinkHash'),'?')
    sites[c['pyExpressionLinkHash']]=c

norm=Normalizer(SRC); anchor={}
for m in meth:
    rel=(m.get('filePath') or '').replace(os.sep,'/')
    try: line=int(m.get('startLine') or 0)
    except ValueError: line=0
    anchor[m['pyMethodUniqueHash']]=Anchor(rel, ir_anchor_line(norm.index(os.path.join(SRC,rel)),line,m.get('methodKind','')))

edges=collections.defaultdict(list); status={}
for l in open(f'{OUT}/call-chain-edges.csv'):
    f=l.rstrip('\n').split('\t')
    if len(f)<7: continue
    status[f[0]]=f[5]
    if f[3]!='-': edges[f[0]].append((f[3],f[4]))

o=build(SRC, entry=os.path.join(SRC,'main.py'))
# Only targets that ARE the colliding name. Several calls share a source line
# (`Bus(4).get_distance()` is a constructor AND a method call; journey.py:67 has three
# get_distance calls), and tier 4 anchors by caller LINE, so an unfiltered comparison
# blames one site for another's target.
name_anchors={anchor[m['pyMethodUniqueHash']].key() for m in meth if m['name']==NAME}
executed=collections.defaultdict(set)
for e in o['tier4']['edges']:
    if not e.get('native') and e['callee'] in name_anchors:
        executed[(e['caller'], e['callerLine'])].add(e['callee'])

print(f"{NAME}: {len(naive_all)} definitions in the project "
      f"({len(naive)} with a real body) -> that is the naive name-based fan per site\n")
hdr=f"{'file:line':<26} {'receiver':<34} {'naive':>5} {'engine':>6} {'status':<16} targets"
print(hdr); print('-'*len(hdr)+'-'*30)
tot_naive=tot_eng=0; wrong=0; checked=0
for h,c in sorted(sites.items(), key=lambda kv:(kv[1]['_file'], int(kv[1]['startLine'] or 0))):
    if c['calleeName']!=NAME: continue
    got=[t for t,_ in edges.get(h,[]) if t.startswith('PY_METHOD')]
    st=status.get(h,'ABSENT')
    pos=f"{c['_file']}:{c['startLine']}"
    recv=(c['receiverText'] or '(none)')[:33]
    names=sorted(qn.get(t,t[:18]).replace('metrics.distance.','m.').replace('geometry.shapes.','g.').replace('transit.modes.','t.') for t in got)
    tot_naive+=len(naive); tot_eng+=len(got)
    # correctness: every EXECUTED target at this caller line must be among the engine's
    ca=anchor.get(c['pyMethodLinkHash'])
    exp=set()
    if ca:
        for (caller,line),tgts in executed.items():
            if caller==ca.key() and line==int(c['startLine'] or 0): exp|=tgts
    ok=''
    if exp:
        checked+=1
        eng_anchors={anchor[t].key() for t in got if t in anchor}
        missing=exp-eng_anchors
        if missing: ok=' MISSING:'+','.join(sorted(missing)); wrong+=1
        else: ok=' ✓'
    print(f"{pos:<26} {recv:<34} {len(naive):>5} {len(got):>6} {st:<16} {', '.join(names) or '-'}{ok}")
print(f"\nnaive total {tot_naive}   engine total {tot_eng}   "
      f"reduction {100*(1-tot_eng/tot_naive):.1f}%")

# PER-LINE union. On the pinned 3.10 `dis` carries no column information (co_positions
# arrives in 3.11), so tier 4 can only attribute an executed edge to a caller LINE. Where
# one line holds several calls of the SAME name -- `shape.get_distance() +
# mode.get_distance() + metric.get_distance(a, b)` -- no ground truth can say which of the
# three ran which target, and a per-SITE check blames each for the others'. The honest
# comparison at that granularity is the union.
byline_eng=collections.defaultdict(set)
for h,c in sites.items():
    if c['calleeName']!=NAME: continue
    ca=anchor.get(c['pyMethodLinkHash'])
    if not ca: continue
    key=(ca.key(), int(c['startLine'] or 0))
    for t,_ in edges.get(h,[]):
        if t in anchor: byline_eng[key].add(anchor[t].key())
lines_ok=lines_bad=0; bad=[]
for key,exp in executed.items():
    if key not in byline_eng and not exp: continue
    missing=exp-byline_eng.get(key,set())
    if missing: lines_bad+=1; bad.append((key,missing))
    else: lines_ok+=1
print(f"per-LINE check: {lines_ok} lines exact, {lines_bad} lines with a missed target")
for k,m in bad: print("   ", k, "missing", sorted(m))
