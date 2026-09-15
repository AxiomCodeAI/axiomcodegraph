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
# --lib=<ir-dir> (repeatable) with --root=<project-dir>: a library method's id is its package
# root relative to the project plus its file — `node_modules/express/lib/router/index.js:L:C`.
lib_dirs = [a.split('=', 1)[1] for a in sys.argv if a.startswith('--lib=')]
root = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--root=')), None)
known_path = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--known=')), None)

def read(path):
    with open(path, newline='') as fh:
        rows = list(csv.reader(fh, delimiter='\t'))
    return rows[0], [r for r in rows[1:] if len(r) == len(rows[0])]

h, methods = read(os.path.join(ir, 'all-javascript-methods.csv'))
i = {c: h.index(c) for c in ('jsMethodUniqueHash', 'filePath', 'startLine', 'startColumn', 'name', 'methodKind')}
ident = {}; name_of = {}; kind_of = {}
# A module's initializer is keyed `<file>:0:0`, as the tracer records it, so it never
# shares a key with a function that starts at the file's first token.
def key_of(file, line, col, kind):
    return '%s:0:0' % file if kind == 'MODULE_INITIALIZER' else '%s:%s:%s' % (file, line, col)
for r in methods:
    k = key_of(r[i['filePath']], r[i['startLine']], r[i['startColumn']], r[i['methodKind']])
    ident[r[i['jsMethodUniqueHash']]] = k; name_of[k] = r[i['name']]; kind_of[k] = r[i['methodKind']]

for d in lib_dirs:
    h, lm = read(os.path.join(d, 'all-javascript-methods.csv'))
    j = {c: h.index(c) for c in ('jsMethodUniqueHash', 'filePath', 'startLine', 'startColumn', 'name', 'methodKind', 'baseMservPath')}
    for r in lm:
        base = os.path.relpath(os.path.realpath(r[j['baseMservPath']]), os.path.realpath(root)) if root else r[j['baseMservPath']]
        k = key_of(base + '/' + r[j['filePath']], r[j['startLine']], r[j['startColumn']], r[j['methodKind']])
        ident[r[j['jsMethodUniqueHash']]] = k; name_of[k] = r[j['name']]; kind_of[k] = r[j['methodKind']]
is_lib = lambda k: k.startswith('node_modules/')

eng = defaultdict(set)   # caller id -> {callee id}
status = {}
with open(os.path.join(raw, 'call-chain-edges.csv')) as fh:
    for line in fh:
        f = line.rstrip('\n').split('\t')
        if len(f) < 7 or f[3] == '-':
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
for d in lib_dirs:
    h2, mods = read(os.path.join(d, 'all-javascript-modules.csv'))
    for r in mods:
        base = os.path.relpath(os.path.realpath(r[h2.index('baseMservPath')]), os.path.realpath(root)) if root else r[h2.index('baseMservPath')]
        mod_file[r[h2.index('jsModuleUniqueHash')]] = base + '/' + r[h2.index('filePath')]
h3, imps = read(os.path.join(ir, 'all-javascript-imports.csv'))
imp_owner = {r[h3.index('jsImportUniqueHash')]: r[h3.index('ownerModuleLinkHash')] for r in imps}
with open(os.path.join(raw, 'import-module.csv')) as fh:
    for line in fh:
        f = line.rstrip('\n').split('\t')
        if len(f) >= 2 and f[0] in imp_owner and f[1] in mod_file:
            imports.add((mod_file[imp_owner[f[0]]] + ':0:0', mod_file[f[1]] + ':0:0'))

rt = json.load(open(edges_path))
executed = [(e['caller'], e['callee']) for e in rt['edges'] if e['caller'] != '<root>']
# (natural caller, callee) -> registrars: the tracer wrapped the function when it was
# passed as an argument and, when THAT invocation ran, recorded who had passed it beside
# the natural caller. A callback fired by platform I/O (a stream, a socket) runs in the
# async context of the function that CREATED the resource, so its natural caller is not
# the registrar; the engine's edge is from the registrar, and that is what is checked
# when the natural edge is not in the graph. Keyed by the natural caller too, so a direct
# call of the same function from somewhere else is never excused by a registration.
registrations = defaultdict(set)
for e in rt.get('registrations', []):
    if e['registrar'] != '<root>': registrations[(e['caller'], e['callee'])].add(e['registrar'])
unknown_fn = [k for k in rt['functions'] if k not in name_of]
found, missing, accessor = [], [], []
registered = set()   # callbacks the engine says SOME client site hands to a callee
for (a, b), st in status.items():
    if st in ('callback_registered', 'event_dispatch'): registered.add(b)
cat = Counter(); lib_lib = 0; lib_client_found = []
module_edges = []
reordered_loads = []
via_registrar = []   # natural caller absent from the graph; the registrar's edge is
for a, b in executed:
    prov = ('lib' if is_lib(a) else 'client') + '->' + ('lib' if is_lib(b) else 'client')
    if b not in name_of:
        cat['callee has no method row (%s)' % prov] += 1; continue
    if prov == 'lib->lib':
        lib_lib += 1; continue
    if prov == 'lib->client':
        # a library invoking a client function: a callback it was handed. The engine has no
        # edge from INSIDE the library (bodies are not expanded); the claim it makes is the
        # callback_registered edge from the client site that handed it over.
        if kind_of.get(b) == 'MODULE_INITIALIZER': continue
        (found if b in registered or b in eng.get(a, ()) else missing).append((a, b)); cat[prov] += 1; continue
    cat[prov] += 1
    if a.endswith(':0:0') and b.endswith(':0:0') and kind_of.get(b) == 'MODULE_INITIALIZER':
        # An ES module's imports are hoisted and loaded in link order, and a top-level
        # `await` in one module leaves the NEXT module's evaluation in its async context,
        # so the tracer names the awaiting module as the loader. The import edge is still
        # the graph's claim; a load recorded from a module that does not import the callee
        # is accepted when some module does, and counted apart.
        if (a, b) in imports: found.append((a, b))
        elif any(x == b for _, x in imports): found.append((a, b)); reordered_loads.append((a, b))
        else: missing.append((a, b))
        module_edges.append((a, b)); continue
    if kind_of.get(b) in ('GETTER', 'SETTER'):
        accessor.append((a, b)); continue
    if b in eng.get(a, ()): found.append((a, b))
    elif any(b in eng.get(r, ()) for r in registrations.get((a, b), ())): found.append((a, b)); via_registrar.append((a, b))
    else: missing.append((a, b))
static_only = [(a, b) for a, bs in eng.items() for b in bs if (a, b) not in set(executed)]

print('runtime: %d functions entered, %d distinct executed edges (%d into accessors, reported apart; %d lib->lib out of scope)' % (len(rt['functions']), len(executed), len(accessor), lib_lib))
print('  by provenance: %s' % dict(cat))
if unknown_fn:
    print('  ! %d executed function(s) have no js_method row at that position: %s' % (len(unknown_fn), unknown_fn[:5]))
print('EXECUTED_FOUND    %4d  (of which %d module loads matched to import edges%s%s)' % (len(found), sum(1 for e in module_edges if e in found),
      ', %d of them from a module reordered by a top-level await' % len(reordered_loads) if reordered_loads else '',
      '; %d platform callbacks matched through their registrar' % len(via_registrar) if via_registrar else ''))
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
if via_registrar:
    print('\nplatform callbacks matched through their registrar (the tracer named the resource\'s creator as caller):')
    for a, b in via_registrar: print('  %-40s -> %s   registered by %s' % (lab(a), lab(b), ', '.join(sorted(lab(r) for r in registrations[(a, b)] if b in eng.get(r, ())))))
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
