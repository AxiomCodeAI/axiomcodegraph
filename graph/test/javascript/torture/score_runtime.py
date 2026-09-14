#!/usr/bin/env python3
"""
Score the engine's method->method graph against EXECUTED edges.

Runtime edges (instrument.mjs) are (caller function, callee function) at function
granularity, keyed "file:line:col" — the same token a js_method row starts at. The
engine side is method_call_edge rolled up from call-chain-edges.csv, including the
callback_registered and event_dispatch rows, since a callback that ran from a forEach
inside f is recorded as f -> callback at runtime too.

  EXECUTED_FOUND    an executed edge the engine has                       (recall numerator)
  EXECUTED_MISSING  an executed edge the engine lacks                     (the defects)
  STATIC_ONLY       an engine edge that did not execute — not wrong per se: a may-edge
                    on a path the entry script did not take, or an over-approximation.
                    Listed so width is visible.

Edges INTO a getter/setter are reported apart: a property read is not a call site in
the parser's universe (GETTER_INVOCATION is a reserved kind with zero rows), so the
engine cannot have them and they are a known, counted gap rather than a defect.

Usage: score_runtime.py <ir-dir> <raw-out-dir> <edges.json> [--dump]
"""
import csv, json, os, sys
csv.field_size_limit(10**9)
from collections import Counter, defaultdict

ir, raw, edges_path = sys.argv[1:4]
dump = '--dump' in sys.argv
known_path = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--known=')), None)

def read(path):
    with open(path, newline='') as fh:
        rows = list(csv.reader(fh, delimiter='\t'))
    return rows[0], [r for r in rows[1:] if len(r) == len(rows[0])]

h, methods = read(os.path.join(ir, 'all-javascript-methods.csv'))
i = {c: h.index(c) for c in ('jsMethodUniqueHash', 'filePath', 'startLine', 'startColumn', 'name', 'methodKind')}
ident = {}; name_of = {}; kind_of = {}
for r in methods:
    k = '%s:%s:%s' % (r[i['filePath']], r[i['startLine']], r[i['startColumn']])
    ident[r[i['jsMethodUniqueHash']]] = k; name_of[k] = r[i['name']]; kind_of[k] = r[i['methodKind']]

eng = defaultdict(set)   # caller id -> {callee id}
status = {}
with open(os.path.join(raw, 'call-chain-edges.csv')) as fh:
    for line in fh:
        f = line.rstrip('\n').split('\t')
        if len(f) < 7 or f[3] == '-' or f[4] != 'client':
            continue
        a, b = ident.get(f[1]), ident.get(f[3])
        if a and b:
            eng[a].add(b); status[(a, b)] = f[5]

# A module's top level entered from another module's top level is a `require` — a module
# edge by the parser's ruling, never a call site. Matched against the engine's import graph.
imports = set()
mod_file = {}
h2, mods = read(os.path.join(ir, 'all-javascript-modules.csv'))
for r in mods:
    mod_file[r[h2.index('jsModuleUniqueHash')]] = r[h2.index('filePath')]
h3, imps = read(os.path.join(ir, 'all-javascript-imports.csv'))
imp_owner = {r[h3.index('jsImportUniqueHash')]: r[h3.index('ownerModuleLinkHash')] for r in imps}
with open(os.path.join(raw, 'import-module.csv')) as fh:
    for line in fh:
        f = line.rstrip('\n').split('\t')
        if len(f) >= 2 and f[0] in imp_owner and f[1] in mod_file:
            imports.add((mod_file[imp_owner[f[0]]] + ':1:1', mod_file[f[1]] + ':1:1'))

rt = json.load(open(edges_path))
executed = [(e['caller'], e['callee']) for e in rt['edges'] if e['caller'] != '<root>']
unknown_fn = [k for k in rt['functions'] if k not in name_of]
found, missing, accessor = [], [], []
module_edges = []
for a, b in executed:
    if a.endswith(':1:1') and b.endswith(':1:1') and kind_of.get(b) == 'MODULE_INITIALIZER':
        (found if (a, b) in imports else missing).append((a, b)); module_edges.append((a, b)); continue
    if kind_of.get(b) in ('GETTER', 'SETTER'):
        accessor.append((a, b)); continue
    (found if b in eng.get(a, ()) else missing).append((a, b))
static_only = [(a, b) for a, bs in eng.items() for b in bs if (a, b) not in set(executed)]

print('runtime: %d functions entered, %d distinct executed edges (%d into accessors, reported apart)' % (len(rt['functions']), len(executed), len(accessor)))
if unknown_fn:
    print('  ! %d executed function(s) have no js_method row at that position: %s' % (len(unknown_fn), unknown_fn[:5]))
print('EXECUTED_FOUND    %4d  (of which %d module loads matched to import edges)' % (len(found), sum(1 for e in module_edges if e in found)))
print('EXECUTED_MISSING  %4d' % len(missing))
print('STATIC_ONLY       %4d  (engine edges the entry script did not execute)' % len(static_only))
print('recall vs runtime: %.3f' % (len(found) / max(1, len(found) + len(missing))))
lab = lambda k: '%s %s' % (k, name_of.get(k, '?'))
if missing:
    print('\nmissing (caller -> callee):')
    for a, b in missing: print('  %-40s -> %s' % (lab(a), lab(b)))
if accessor:
    print('\naccessor reads (no site in the parser universe):')
    for a, b in accessor: print('  %-40s -> %s' % (lab(a), lab(b)))
if dump:
    print('\nstatic-only:')
    for a, b in sorted(static_only): print('  %-40s -> %s  [%s]' % (lab(a), lab(b), status[(a, b)]))
# ── the debt list: a missing edge not listed fails; a listed edge that now resolves fails too ──
if known_path:
    known = set()
    for line in open(known_path):
        line = line.split('#', 1)[0].strip()
        if line:
            a, b = line.split()[:2]; known.add((a, b))
    new = [e for e in missing if e not in known]
    fixed = [e for e in known if e not in set(missing)]
    if new:
        print('\nFAIL: executed edges the engine lacks and %s does not list:' % os.path.basename(known_path))
        for a, b in new: print('  %s %s' % (a, b))
    if fixed:
        print('\nFAIL: listed gaps that now resolve — remove them from %s:' % os.path.basename(known_path))
        for a, b in fixed: print('  %s %s' % (a, b))
    sys.exit(1 if new or fixed else 0)
sys.exit(1 if missing else 0)
