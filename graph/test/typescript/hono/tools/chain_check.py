#!/usr/bin/env python3
"""chains/ suite (SPEC R18-R21): check a case's `.chains` golden against BOTH halves of the truth, or draft one.

  --cc     the compiler call-chain oracle's output (truth/cc-oracle.mjs: fn / edge / unres rows)
  --hono   the Hono oracle's output (truth/hono-oracle.mjs: its `mw` rows, and a partial route's `mwp` rows,
           give the middleware hops)
  --rt     the runtime trace's observed edges (truth/chain-runtime.mjs --edges: `rtedge FROM TO`)
  --golden the reviewed `.chains` file             --draft OUT  write the oracle rows (no chain rows) to OUT

Truth, in the golden's vocabulary:
  fn    every function with a body (the compiler oracle's fn rows, modules excluded)
  edge  every compiler edge between two such functions, plus `rt` edges: observed at run time, not seen by the
        compiler (a function value the compiler types only as a signature), and not a middleware hop
  chain each hop is a truth edge or a middleware hop (the Hono oracle's chain order: middleware -> next middleware
        of the same handler's chain -> the handler)
  ccunknown  the function holds a call the compiler cannot resolve (`unres` row) and that no run-time edge covers
Exit 1 with the differences listed; prints `chains ok <n>` otherwise.
"""
import argparse
import sys


def tsv(p):
    with open(p) as fh:
        return [l.rstrip('\n').split('\t') for l in fh if l.strip() and not l.startswith('#')]


def main():
    a = argparse.ArgumentParser()
    a.add_argument('--cc', required=True)
    a.add_argument('--hono', required=True)
    a.add_argument('--rt', required=True)
    a.add_argument('--golden', default='')
    a.add_argument('--draft', default='')
    o = a.parse_args()
    cc = tsv(o.cc)
    fns = {r[1] for r in cc if r[0] == 'fn' and r[2] != 'MODULE'}
    static = {(r[1], r[2]) for r in cc if r[0] == 'edge' and r[1] in fns and r[2] in fns}
    unres = {r[1] for r in cc if r[0] == 'unres'}
    unres_sites = {r[2] for r in cc if r[0] == 'unres'}
    chain_of = {}
    for r in tsv(o.hono):
        if r[0] == 'mw':
            chain_of.setdefault((r[2], r[6] if len(r) > 6 else ''), []).append((int(r[5]), r[1]))
        elif r[0] == 'mwp':
            # a PARTIAL route's decidable chain (`mwp MW HANDLER VERB ORDER`): its hops are middleware hops too
            chain_of.setdefault((r[2], 'partial ' + r[3]), []).append((int(r[4]), r[1]))
    mwhops = set()
    for (h, _), ms in chain_of.items():
        ms.sort()
        for (p, m) in ms:
            mwhops.add((m, h))  # a middleware reaches the handler through the rest of the chain
            for (q, n) in ms:
                if q == p + 1:
                    mwhops.add((m, n))
    # a run-time edge counts only at a call site the compiler could not resolve: a callback a library invokes is
    # attributed by the tracer to whatever site is open (its documented limit), which is never such a site
    rt = {(r[1], r[2]) for r in tsv(o.rt) if r[0] == 'rtedge' and r[1] in fns and r[2] in fns and len(r) > 3 and r[3] in unres_sites}
    rt_only = rt - static - mwhops
    if o.draft:
        with open(o.draft, 'w') as fh:
            for f in sorted(fns):
                fh.write(f'fn\t{f}\n')
            for e in sorted(static):
                fh.write(f'edge\t{e[0]}\t{e[1]}\n')
            for e in sorted(rt_only):
                fh.write(f'edge\t{e[0]}\t{e[1]}\trt\n')
            for u in sorted(unres & fns):
                fh.write(f'# unres in {u} (write a ccunknown row when no rt edge covers it)\n')
        print(f'drafted {len(fns)} fn, {len(static)} static + {len(rt_only)} rt edges')
        return 0
    g = tsv(o.golden)
    bad = []
    gf = {r[1] for r in g if r[0] == 'fn'}
    gs = {(r[1], r[2]) for r in g if r[0] == 'edge' and len(r) < 4}
    gr = {(r[1], r[2]) for r in g if r[0] == 'edge' and len(r) >= 4 and r[3] == 'rt'}
    for x in sorted(gf ^ fns):
        bad.append(f'fn {x}: ' + ('golden only' if x in gf else 'oracle only'))
    for e in sorted(gs ^ static):
        bad.append(f'edge {e[0]} -> {e[1]}: ' + ('golden only' if e in gs else 'compiler only'))
    for e in sorted(gr ^ rt_only):
        bad.append(f'rt edge {e[0]} -> {e[1]}: ' + ('golden only (not observed, or the compiler has it)' if e in gr else 'observed at run time, not in the golden'))
    truth = static | rt_only | mwhops
    chains = [r for r in g if r[0] == 'chain']
    for r in chains:
        f = r[4:]
        if len(f) < 2:
            bad.append(f'chain {r[1]} has fewer than two functions')
        for i in range(len(f) - 1):
            if (f[i], f[i + 1]) not in truth:
                bad.append(f'chain {r[1]} hop {i + 1}: {f[i]} -> {f[i + 1]} is no truth edge or middleware hop')
    for r in g:
        if r[0] == 'ccunknown' and r[1] not in unres:
            bad.append(f'ccunknown {r[1]}: the compiler resolves every call in it')
    if not chains:
        bad.append('no chain row: a chains case must assert at least one whole chain')
    for b in bad:
        print('CHAIN-ORACLE ' + b)
    if bad:
        return 1
    print(f'chains ok {len(chains)} chains, {len(gs)} + {len(gr)} rt edges')
    return 0


if __name__ == '__main__':
    sys.exit(main())
