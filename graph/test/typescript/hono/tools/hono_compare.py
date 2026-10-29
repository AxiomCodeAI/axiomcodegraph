#!/usr/bin/env python3
"""Compare the engine's Hono relations against a hand-reviewed expected TSV.

usage: hono_compare.py --lang typescript|javascript --ir IR --raw OUT/raw --manifest export_manifest.tsv
                       --relations relations.tsv --expected CASE.tsv --entries CASE.entries
                       [--known-missing CASE.known-missing] --variant bare|lib

Every engine row is normalised to the expected file's vocabulary: a function is
`<path relative to the parsed root>:<line>:<col>` of its declaration (the IR's own filePath,
startLine, startColumn); a function that is not in the client IR (a library declaration) is `lib`.
A `lib:<spec>@<site>` key in the expected file compares as `lib` too.

Compared projections (relations.tsv says which engine file and columns feed each one, so a
column rename in SPEC.md is a one-line edit there, never a change here):
  route   VERB FULLPATH HANDLER @APP    <- route(Handler, Verb, FullPath, App, Order); App is compared (SPEC R16a)
  mw      MW HANDLER ORDER              <- middleware_applies(Mw, Handler, Order)
  ctx     SETTER READER KEY             <- ctx_key_flow(Setter, Reader, Key)
  mwp     MW HANDLER VERB ORDER     <- middleware_applies rows of a partial-only handler (path, app dropped)
  ppath   HANDLER VERB KNOWNPATH    <- http_route_partial(Handler, Verb, KnownPath); only when the golden has ppath rows
  rpc / request  FROM HANDLER [CONF]    <- remote_edge(From, To, .., Confidence): class base_unknown | method_unknown | known
  entry   FN                            <- entry_point(Fn, "http")
  unknown FN                            <- remote_undetermined(Fn, ...)  (expected col 4)
  mount   PATH                          <- a route row ALL PATH (any handler)
  absent  FN                            <- FN must appear in NO row above (negative controls)

Verdicts: MISSING (expected, not produced), EXTRA (produced, not expected), NOW-FIXED (a
known-missing row that is produced). Any of them fails. Exits 3 when a relation the expected
file needs is not exported at all, so the runner can say so instead of reporting a diff.
Prints `compared=<n>`; n is the number of expected rows checked, and the runner requires n >= 1.
"""
import argparse
import re
import csv
import os
import sys

csv.field_size_limit(10**9)


def read_tsv(p):
    if not os.path.exists(p) or os.path.getsize(p) == 0:
        return []
    with open(p, newline='') as fh:
        return [r for r in csv.reader(fh, delimiter='\t')]


def ir_methods(ir, lang):
    f = 'all-typescript-methods.csv' if lang == 'typescript' else 'all-javascript-methods.csv'
    hcol = 'tsMethodUniqueHash' if lang == 'typescript' else 'jsMethodUniqueHash'
    rows = read_tsv(os.path.join(ir, f))
    if not rows:
        return {}
    hdr = rows[0]
    ix = {c: i for i, c in enumerate(hdr)}
    out = {}
    for r in rows[1:]:
        r = r + [''] * (len(hdr) - len(r))
        out[r[ix[hcol]]] = f"{r[ix['filePath']].replace(os.sep, '/')}:{r[ix['startLine']]}:{r[ix['startColumn']]}"
    return out


def ir_vars(ir, lang):
    """variable hash -> `<file>:<line>:<col>` of its name (a schema declaration, SPEC 3.9)."""
    t = 'typescript' if lang == 'typescript' else 'javascript'
    pre = 'ts' if lang == 'typescript' else 'js'
    rows = read_tsv(os.path.join(ir, f'all-{t}-variables.csv'))
    if not rows:
        return {}
    ix = {c: i for i, c in enumerate(rows[0])}
    hk = f'{pre}VariableUniqueHash'
    if hk not in ix or not {'startColumn', 'startLine', 'filePath'} <= set(ix):
        return {}  # the JavaScript IR's variables carry no filePath: schemas are a TypeScript row for now
    out = {}
    # TypeScript variables carry filePath; JavaScript ones only their module, joined like expressions
    mk = next((c for c in rows[0] if c.endswith('ModuleLinkHash')), None)
    mpath = module_paths(ir, t) if 'filePath' not in ix else {}
    for r in rows[1:]:
        r = r + [''] * (len(rows[0]) - len(r))
        fp = r[ix['filePath']] if 'filePath' in ix else mpath.get(r[ix[mk]], '?') if mk else '?'
        out[r[ix[hk]]] = f"{fp.replace(os.sep, '/')}:{r[ix['startLine']]}:{r[ix['startColumn']]}"
    return out


def module_paths(ir, t):
    mods = read_tsv(os.path.join(ir, f'all-{t}-modules.csv'))
    out = {}
    if mods:
        ix = {c: i for i, c in enumerate(mods[0])}
        hk = next((c for c in mods[0] if c.endswith('ModuleUniqueHash')), None)
        for r in mods[1:]:
            if hk and 'filePath' in ix and len(r) > max(ix[hk], ix['filePath']):
                out[r[ix[hk]]] = r[ix['filePath']].replace(os.sep, '/')
    return out


def ir_exprs(ir, lang):
    """expression hash -> `<file>:<line>:<col>` (the module's filePath joined through tsModuleLinkHash)."""
    t = 'typescript' if lang == 'typescript' else 'javascript'
    pre = 'ts' if lang == 'typescript' else 'js'
    mods = read_tsv(os.path.join(ir, f'all-{t}-modules.csv'))
    mpath = {}
    if mods:
        ix = {c: i for i, c in enumerate(mods[0])}
        hk = next((c for c in mods[0] if c.endswith('ModuleUniqueHash')), None)
        for r in mods[1:]:
            if hk and 'filePath' in ix and len(r) > max(ix[hk], ix['filePath']):
                mpath[r[ix[hk]]] = r[ix['filePath']].replace(os.sep, '/')
    rows = read_tsv(os.path.join(ir, f'all-{t}-expressions.csv'))
    out = {}
    if not rows:
        return out
    ix = {c: i for i, c in enumerate(rows[0])}
    hk = f'{pre}ExpressionUniqueHash'
    mk = next((c for c in rows[0] if c.endswith('ModuleLinkHash')), None)
    if hk not in ix or not mk:
        return out
    for r in rows[1:]:
        r = r + [''] * (len(rows[0]) - len(r))
        out[r[ix[hk]]] = f"{mpath.get(r[ix[mk]], '?')}:{r[ix['startLine']]}:{r[ix['startColumn']]}"
    return out


def main():
    a = argparse.ArgumentParser()
    for k in ('lang', 'ir', 'raw', 'manifest', 'relations', 'expected', 'entries', 'variant'):
        a.add_argument('--' + k, required=True)
    a.add_argument('--known-missing', default='')
    # the BASELINE engine's raw output on the same IR: an http entry_point row it already produced is
    # pre-existing behaviour (the receiver-blind route-verb rule, which SPEC keeps), not a Hono row
    a.add_argument('--baseline-raw', default='')
    # chains/ suite (SPEC R18-R21): the case's `.chains` golden (fn / edge / chain / ccunknown rows)
    a.add_argument('--chains', default='')
    o = a.parse_args()

    names = ir_methods(o.ir, o.lang)
    exprs = ir_exprs(o.ir, o.lang)
    # a project function is its location; an expression (a library middleware's registering
    # argument, SPEC 4) is `lib@<location>`; anything else (a library declaration) is `lib`
    names.update(ir_vars(o.ir, o.lang))
    fn = lambda h: names.get(h) or (('@' + exprs[h]) if h in exprs else 'lib')
    manifest = {r[0]: r[1] for r in read_tsv(o.manifest) if len(r) >= 2}
    rel = {}
    for r in read_tsv(o.relations):
        if not r or r[0].startswith('#'):
            continue
        rel.setdefault(r[0], []).append((r[1], dict(x.split('=') for x in r[2:])))

    exp = []
    for path in (o.expected, o.entries):
        for r in read_tsv(path):
            if r and r[0] and not r[0].startswith('#'):
                exp.append(r)
    kinds = {r[0] for r in exp}
    proj_of = {'route': {'route'}, 'mw': {'mw'}, 'ctx': {'ctx'}, 'rpc': {'remote'}, 'request': {'remote'},
               'entry': {'entry'}, 'unknown': {'unknown'}, 'partial': {'partial'}, 'submount': {'submount'},
               'unserved': {'unserved'}, 'schema': {'schema'}, 'validread': {'validread'}, 'regby': {'regby'},
               'absent': {'route', 'mw'}, 'mwp': {'mw'}, 'ppath': {'partial'}}
    # an absence is checked against every Hono relation the engine exports; route and mw are required
    # (above), the later ones (ctx, remote, schema) join the check as soon as they are exported
    absent_optional = {'ctx', 'remote', 'schema'}
    need = {'route'}  # even a negative case asserts the route table EXISTS: absence of an
    for k in kinds:    # unexported relation is not absence of rows
        need |= proj_of.get(k, set())
    missing_rel = sorted({f"{p} ({r[0]})" for p in need for r in rel.get(p, [('?', {})]) if r[0] not in manifest})
    if missing_rel:
        print('relation not exported: ' + ', '.join(missing_rel))
        print('compared=0')
        sys.exit(3)

    def engine(proj):
        out = []
        for relname, cols in rel[proj]:
            c = {k: int(v) for k, v in cols.items()}
            rows = read_tsv(os.path.join(o.raw, manifest[relname]))
            short = [k for k, i in c.items() if rows and any(len(r) <= i for r in rows)]
            if short:
                # a column SPEC names that the engine does not write is a missing relation shape, not a diff
                print(f'relation {relname} lacks column(s): {", ".join(short)}')
                print('compared=0')
                sys.exit(3)
            for r in rows:
                g = lambda k: r[c[k]] if k in c and c[k] < len(r) else ''
                if proj == 'route':
                    # SPEC R16a: the App column answers "which app serves this"; a wrong App is a false route (R16)
                    out.append(('route', g('verb').upper(), g('path'), fn(g('handler'))) + ((fn(g('app')),) if 'app' in c else ()))
                elif proj == 'partial':
                    out.append(('partial', fn(g('handler')), g('reason')))
                    # hono-7-05 (opt-in: a case whose golden has ppath rows): the KnownPath of the partial route
                    if 'ppath' in kinds:
                        out.append(('ppath', fn(g('handler')), (g('verb') or '').upper(), g('path')))
                elif proj == 'submount':
                    out.append(('submount', g('prefix')))
                elif proj == 'mw':
                    out.append(('mw', fn(g('mw')), fn(g('handler')), g('verb').upper(), g('path'), str(int(g('position') or -1)))
                               + ((fn(g('app')),) if 'app' in c else ()))
                elif proj == 'ctx':
                    out.append(('ctx', fn(g('setter')), fn(g('reader')), g('key')))
                elif proj == 'remote':
                    # R14: precision is scored per confidence; base_unknown is its own class, the others (exact,
                    # route_shape) one class, as before
                    # R17: method_unknown (a request whose verb is not decidable) is a class of its own too
                    out.append(('remote', fn(g('from')), fn(g('to')), g('conf') if g('conf') in ('base_unknown', 'method_unknown') else 'known'))
                elif proj == 'unserved':
                    out.append(('unserved', fn(g('fn'))))
                elif proj == 'entry':
                    if g('kind') == 'http':
                        out.append(('entry', fn(g('fn'))))
                elif proj == 'unknown':
                    out.append(('unknown', fn(g('fn')), g('reason')))
                elif proj == 'regby':
                    out.append(('regby', fn(g('regmethod')), fn(g('handler')), g('verb').upper(), g('path'), fn(g('app'))))
                elif proj == 'schema':
                    out.append(('schema', fn(g('handler')), g('target'), fn(g('decl'))))
                elif proj == 'validread':
                    out.append(('validread', fn(g('read')), fn(g('handler')), g('target'), fn(g('decl'))))
        return out

    def lib(k):
        # an expression is named by its location: `lib:<spec>.<name>@<site>` and `expr@<loc>` -> `@<loc>`;
        # a bare `lib:...` (a library declaration) -> `lib`
        if k.startswith('expr@'):
            return '@' + k[5:]
        # a library key is `lib` or `lib:<spec>...`; a project path may itself start with lib/ or libs/
        if not (k == 'lib' or k.startswith('lib:')):
            return k
        # the site follows the LAST '@': a scoped package (@hono/zod-validator) has one of its own
        m = re.search(r'@([^@]+:\d+:\d+)$', k)
        return '@' + m.group(1) if m else 'lib'
    mw_app = any('app' in cols for _, cols in rel.get('mw', []))
    route_app = any('app' in cols for _, cols in rel.get('route', []))
    want = set()
    absent = []
    for r in exp:
        k = r[0]
        if k == 'route':
            want.add(('route', r[1], r[2], lib(r[3])) + (('@' + r[4],) if route_app else ()))
        elif k == 'mw':
            want.add(('mw', lib(r[1]), lib(r[2]), r[3], r[4], r[5]) + (('@' + r[6],) if mw_app else ()))
        elif k == 'ctx':
            want.add(('ctx', r[1], r[2], r[3]))
        elif k in ('rpc', 'request'):
            # dest spelling is SPEC-open: not compared; an optional 6th column is the confidence class (R14)
            want.add(('remote', r[1], lib(r[4]), r[5] if len(r) > 5 and r[5] in ('base_unknown', 'method_unknown') else 'known'))
        elif k == 'mwp':
            want.add(('mwp', lib(r[1]), lib(r[2]), r[3], r[4]))
        elif k == 'entry':
            if not (r[1] == 'lib' or r[1].startswith('lib:')):
                want.add(('entry', r[1]))
        elif k == 'unknown':
            want.add(('unknown', r[3], r[2]))
        elif k == 'partial':
            want.add(('partial', lib(r[1]), r[3]))
        elif k == 'ppath':
            want.add(('ppath', lib(r[1]), r[2], r[3]))
        elif k == 'submount':
            want.add(('submount', r[1]))
        elif k == 'unserved':
            want.add(('unserved', r[1]))
        elif k == 'schema':
            want.add(('schema', r[1], r[2], lib(r[3])))
        elif k == 'regby':
            want.add(('regby', r[1], lib(r[2]), r[3], r[4], '@' + r[5]))
        elif k == 'validread':
            want.add(('validread', '@' + r[1], r[2], r[3], lib(r[4])))
        elif k == 'absent':
            absent.append(r[1])
        else:
            print(f'bad expected row kind: {k}')
            sys.exit(2)

    if 'absent' in kinds:
        for p in sorted(absent_optional):
            if all(r[0] in manifest for r in rel.get(p, [('?', {})])):
                need.add(p)
            else:
                print(f'note: absence not yet checked in {p} (not exported)')
    have = set()
    for p in sorted(need):
        have |= set(engine(p))
    # SPEC 3.3: a partial route's chain is compared without its path and app (neither is decidable); a middleware
    # row whose handler is partial-only in the expected truth is projected the same way
    partial_only = {w[1] for w in want if w[0] == 'partial'} - {w[3] for w in want if w[0] == 'route'}
    if partial_only:
        have = {('mwp', h[1], h[2], h[3], h[5]) if h[0] == 'mw' and h[2] in partial_only else h for h in have}

    known = set()
    if o.known_missing and os.path.exists(o.known_missing):
        for r in read_tsv(o.known_missing):
            if not r or r[0].startswith('#'):
                continue
            if r[0] in ('*', o.variant):
                known.add(tuple(r[1:]))

    bad = 0
    for w in sorted(want):
        if w not in have and w not in known:
            print('MISSING  ' + '\t'.join(w)); bad += 1
        elif w in have and w in known:
            print('NOW-FIXED  ' + '\t'.join(w)); bad += 1
    # extras: a row the engine produced that the reviewed truth does not have
    pre = set()
    if o.baseline_raw and 'entry_point' in manifest:
        for r in read_tsv(os.path.join(o.baseline_raw, manifest['entry_point'])):
            if len(r) >= 2 and r[1] == 'http':
                pre.add(('entry', fn(r[0])))
    for h in sorted(have):
        if h in want:
            continue
        if h in pre:
            print('PRE-EXISTING  ' + '\t'.join(h) + '   (the baseline engine already emits it)')
            continue
        print('EXTRA    ' + '\t'.join(h)); bad += 1
    known_fns = set(names.values())
    for f in absent:
        if f not in known_fns:
            # an absence check on a location that is no function is vacuous: it can never fail
            print(f'BAD-ABSENT  {f} names no function in the IR'); bad += 1
            continue
        hits = [h for h in have if f in h[1:] and h not in pre]  # a pre-existing entry row is not a Hono row
        for h in hits:
            print('PRESENT  ' + '\t'.join(h) + f'   (absent {f})'); bad += 1
    nchain = 0
    if o.chains:
        cbad, nchain = compare_chains(o, rel, manifest, fn, read_tsv)
        bad += cbad
    print(f'compared={len(want) + len(absent) + nchain}')
    sys.exit(1 if bad else 0)


def compare_chains(o, rel, manifest, fn, read_tsv):
    """chains/ (SPEC R18-R21). The golden `.chains` holds, from the compiler oracle and the runtime trace:
      fn KEY                      every function with a body in the fixture (the universe edges are scored in)
      edge FROM TO [rt]           a call edge between two of them (`rt`: observed at run time, beyond the compiler)
      chain NAME VERB PATH F0..Fn a WHOLE chain; each hop is a call edge or a middleware hop (A applies to handler H
                                  and the next is H, or the next middleware of H's chain)
      ccunknown FN                FN holds a call whose target is not decidable: the engine must declare it (R21)
    Engine call edges: call_chain_edge (FromMethod -> ToMethod), a declared base widened by
    method_dispatch_candidate, and fn_value_call. Edges are compared both ways inside the fn universe (an edge to a
    same-named method of an unrelated class is EXTRA); a chain is reported once, at its first break."""
    rows = [r for r in read_tsv(o.chains) if r and r[0] and not r[0].startswith('#')]
    fns = {r[1] for r in rows if r[0] == 'fn'}
    want_e = {(r[1], r[2]) for r in rows if r[0] == 'edge'}
    chains = [r for r in rows if r[0] == 'chain']
    want_u = {r[1] for r in rows if r[0] == 'ccunknown'}
    need = ['chainedge', 'dispatch', 'fnvalue', 'ccunknown', 'mw']
    miss = sorted({f'{p} ({r[0]})' for p in need for r in rel.get(p, [('?', {})]) if r[0] not in manifest})
    if miss:
        print('relation not exported: ' + ', '.join(miss))
        # without call edges or middleware rows there is nothing to compare; a missing widening relation (dispatch,
        # fnvalue, ccunknown) still FAILS the case (exit 3 below), but the chains are compared on what IS exported, so
        # the report shows where they break (the JavaScript engine exports neither widening relation)
        if any(m.split(' ')[0] in ('chainedge', 'mw') for m in miss):
            print('compared=0'); sys.exit(3)

    def raw(p):
        out = []
        for relname, cols in rel[p]:
            if relname not in manifest:
                continue
            c = {k: int(v) for k, v in cols.items()}
            for r in read_tsv(os.path.join(o.raw, manifest[relname])):
                out.append({k: (r[i] if i < len(r) else '') for k, i in c.items()})
        return out
    base = {}
    for r in raw('dispatch'):
        base.setdefault(r['base'], set()).add(r['impl'])
    have_e = set()
    for r in raw('chainedge'):
        if r['to'] in ('', '-'):
            continue
        for t in {r['to']} | base.get(r['to'], set()):
            have_e.add((fn(r['from']), fn(t)))
    for r in raw('fnvalue'):
        have_e.add((fn(r['from']), fn(r['to'])))
    have_e = {e for e in have_e if e[0] in fns and e[1] in fns}
    mwpos = {}
    for r in raw('mw'):
        mwpos.setdefault(fn(r['handler']), {})[fn(r['mw'])] = int(r['position'] or -1)
    def mw_hop(a, b):
        for h, ch in mwpos.items():
            if a in ch and (b == h or (b in ch and ch[b] == ch[a] + 1)):
                return True
        return False
    have_u = {fn(r['fn']) for r in raw('ccunknown')}
    bad = 0
    for e in sorted(want_e - have_e):
        print('MISSING  edge\t' + '\t'.join(e)); bad += 1
    for e in sorted(have_e - want_e):
        print('EXTRA    edge\t' + '\t'.join(e)); bad += 1
    for r in chains:
        f = r[4:]
        for i in range(len(f) - 1):
            if (f[i], f[i + 1]) not in have_e and not mw_hop(f[i], f[i + 1]):
                print(f'CHAIN-BROKEN  {r[1]} at hop {i + 1}/{len(f) - 1}\t{f[i]} -> {f[i + 1]}'); bad += 1
                break
    for u in sorted(want_u - have_u):
        print('MISSING  ccunknown\t' + u); bad += 1
    if miss:
        print(f'compared={len(want_e) + len(chains) + len(want_u)}'); sys.exit(3)
    return bad, len(want_e) + len(chains) + len(want_u)


if __name__ == '__main__':
    main()
