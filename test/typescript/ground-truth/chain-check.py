#!/usr/bin/env python3
"""
Chains and the client/library boundary — the two questions a per-site score cannot ask.

── WHY A SECOND CHECKER ─────────────────────────────────────────────────────
`score.py` adjudicates one call site against one declaration. That is the right unit
for accuracy and it is blind to two things a consumer of this engine actually depends
on:

  1. CHAINS. "entryPoint reaches encode in four hops" is a claim about edges joined end
     to end. A run can score 1.000 per site and still lose every chain, because a chain
     needs the CALLER of each site as well as its target, and a site-level score never
     looks at the caller at all.

  2. THE BOUNDARY. The engine splits its edges into client_calls_client and
     client_calls_lib from the provenance of the IR root that declared the target.
     The oracle knows the same fact from a different direction — the declaration's path
     is inside the analysed project or it is not. Those two derivations agree or the
     staging is wrong, and a per-site score cannot tell: it compares targets, and both
     sides have the same target when a file has been staged twice.

── WHERE THE CALLER COMES FROM ──────────────────────────────────────────────
`tsc-oracle.mjs` emits the enclosing function of every call site, so the caller half of
each edge is the COMPILER's answer. Reading containment out of the engine's own IR
instead would make this a check of the engine against itself, which is not a check.

── WHAT IS AND IS NOT A FAILURE ─────────────────────────────────────────────
An engine edge the oracle does not have is a FAN, not an error: where dispatch is
genuinely ambiguous the engine emits a sound set on purpose, and the compiler names one
signature out of it. So engine-only edges are counted and not failed. An oracle edge the
engine lacks IS a failure, and a chain that dies is reported with the hop that killed it,
because "the chain is short" is not actionable and "hop 3 lost stageThree -> encode" is.

Usage: chain-check.py <ir-dir> <engine-out-dir> <oracle.tsv> [--lib=<ir-dir> ...]
"""
import csv
import os
import sys
from collections import defaultdict, deque

SYNTHETIC_TARGET_KINDS = {'synthesized', 'unresolved', 'oracle_error'}


def read_tsv(path, header=True):
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8', errors='replace') as fh:
        rows = list(csv.reader(fh, delimiter='\t', quoting=csv.QUOTE_NONE))
    if header and rows:
        # A ROW THAT DOES NOT MEET THE HEADER'S FIELD COUNT IS DROPPED, not indexed into.
        # A torn write leaves a short row behind; reading it raises IndexError deep inside a
        # join and takes down a scorer that had nothing to do with the fault. The header is
        # the contract, and a row that breaks it is not data.
        n = len(rows[0])
        return [r for r in rows[1:] if len(r) == n]
    return rows


def base(p):
    """Basename plus an exact line and column, the same identity score.py uses. A
    library IR is rooted at whatever directory it was extracted from, so the same file is
    `lib/lib.es5.d.ts` to the oracle and `lib.es5.d.ts` to the engine, and the basename is
    the only identity both sides can compute without agreeing on a root."""
    p = p.replace('\\', '/')
    parts = [x for x in p.split('/') if x]
    return parts[-1] if parts else p


def fmt(node):
    return f'{node[0]}:{node[1]}:{node[2]}'


def main():
    if len(sys.argv) < 4:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    ir_dir, out_dir, oracle_path = sys.argv[1], sys.argv[2], sys.argv[3]
    lib_dirs = [a[len('--lib='):] for a in sys.argv[4:] if a.startswith('--lib=')]

    # ── the engine's side ────────────────────────────────────────────────────
    # A method hash is only a position once the IR that declared it is loaded, and the
    # client and every staged library root each declare their own.
    meth = {}
    def load_methods(d, prov):
        mf = {r[26]: r[3] for r in read_tsv(os.path.join(d, 'all-typescript-modules.csv'))}
        for r in read_tsv(os.path.join(d, 'all-typescript-methods.csv')):
            meth[r[42]] = ((base(r[4] or mf.get(r[21], '')), r[5], r[39]), r[0], prov)
    load_methods(ir_dir, 'client')
    for d in lib_dirs:
        load_methods(d, 'lib')

    engine_edges = set()
    engine_out = defaultdict(set)
    engine_site_targets = defaultdict(set)
    unlocatable = 0
    for r in read_tsv(os.path.join(out_dir, 'call-chain-edges.csv'), header=False):
        ce, caller, _to_expr, target = r[0], r[1], r[2], r[3]
        if target == '-':
            continue
        if caller not in meth or target not in meth:
            unlocatable += 1
            continue
        a, b = meth[caller][0], meth[target][0]
        engine_edges.add((a, b))
        engine_out[a].add(b)
        engine_site_targets[ce].add(b)

    # The engine's OWN boundary answer, per call site, from provenance.
    engine_side = defaultdict(set)
    for name, side in (('client-to-client-calls.csv', 'client'), ('client-to-lib-calls.csv', 'lib')):
        for r in read_tsv(os.path.join(out_dir, name), header=False):
            if len(r) >= 4:
                engine_side[r[1]].add(side)

    # ── the join: oracle position -> the engine's call-expression hash ───────
    mod_file = {r[26]: r[3] for r in read_tsv(os.path.join(ir_dir, 'all-typescript-modules.csv'))}
    span = {r[33]: (r[20], r[21], r[22], r[23])
            for r in read_tsv(os.path.join(ir_dir, 'all-typescript-expressions.csv'))}
    key_of_ce = {}
    for r in read_tsv(os.path.join(ir_dir, 'all-typescript-call-sites.csv')):
        sp = span.get(r[5])
        if sp:
            key_of_ce[(mod_file.get(r[6], ''), sp[0], sp[1], sp[2], sp[3])] = r[5]

    # The set of files the ANALYSED PROJECT declares. The oracle reports project files
    # by a path relative to the project root and everything else absolutely, which is the
    # boundary as the compiler sees it — derived independently of the engine's provenance.
    client_files = {base(f) for f in mod_file.values()}

    # ── the oracle's graph ───────────────────────────────────────────────────
    oracle_edges = set()
    oracle_out = defaultdict(set)
    oracle_decl_name = {}
    site_rows = []
    for r in read_tsv(oracle_path):
        if len(r) < 17:
            print('oracle.tsv has no enclosing-declaration columns — re-run tsc-oracle.mjs',
                  file=sys.stderr)
            return 2
        call_file, cl, cc, el, ec = r[0], r[1], r[2], r[3], r[4]
        tfile, tline, tcol, tname, tkind = r[7], r[8], r[9], r[10], r[11]
        encl_line, encl_col, encl_name = r[14], r[15], r[16]
        if tkind in SYNTHETIC_TARGET_KINDS or not tline:
            continue
        caller = (base(call_file), encl_line, encl_col)
        target = (base(tfile), tline, tcol)
        oracle_decl_name[caller] = encl_name
        oracle_decl_name[target] = tname
        oracle_edges.add((caller, target))
        oracle_out[caller].add(target)
        site_rows.append(((call_file, cl, cc, el, ec), caller, target,
                          'client' if base(tfile) in client_files else 'lib'))

    # ── 1. boundary classification ───────────────────────────────────────────
    agree = defaultdict(int)
    disagree = []
    unjoined = 0
    for key, _caller, target, oracle_sd in site_rows:
        ce = key_of_ce.get(key)
        if ce is None:
            unjoined += 1
            continue
        sides = engine_side.get(ce)
        if not sides:
            continue                      # the engine resolved nothing here; score.py's MISSED
        if sides == {oracle_sd}:
            agree[oracle_sd] += 1
        elif oracle_sd in sides:
            agree[f'{oracle_sd} (+other)'] += 1
        else:
            disagree.append((key, target, oracle_sd, '/'.join(sorted(sides))))

    print('── client/library boundary (compiler\'s path vs engine\'s provenance) ──')
    print(f'  sites adjudicable            {sum(agree.values()) + len(disagree)}')
    print(f'  agree  client -> client      {agree["client"]}')
    print(f'  agree  client -> library     {agree["lib"]}')
    mixed = agree['client (+other)'] + agree['lib (+other)']
    if mixed:
        print(f'  right side, plus another     {mixed}   (a fan that crosses the boundary)')
    print(f'  MISCLASSIFIED                {len(disagree)}')
    for key, target, want, got in disagree[:15]:
        print(f'    {key[0]}:{key[1]}  -> {fmt(target)}   oracle={want} engine={got}')
    if unjoined:
        print(f'  (oracle sites the IR does not carry: {unjoined})')
    if unlocatable:
        print(f'  (engine edges whose method position the IR does not carry: {unlocatable})')

    # ── 2. edges ─────────────────────────────────────────────────────────────
    have = oracle_edges & engine_edges
    lost = oracle_edges - engine_edges
    print()
    print('── call-graph edges (caller declaration -> target declaration) ──')
    print(f'  oracle edges                 {len(oracle_edges)}')
    print(f'  engine has                   {len(have)}   '
          f'{len(have) / len(oracle_edges):.3f}' if oracle_edges else '  oracle edges 0')
    print(f'  oracle edges MISSING         {len(lost)}')
    print(f'  engine-only (the fan)        {len(engine_edges - oracle_edges)}')

    # ── 3. chains ────────────────────────────────────────────────────────────
    # A ROOT is a client declaration nothing in the project calls: an entry point by
    # construction rather than by annotation. Reachability from a root is what a consumer
    # asking "what does this touch" actually receives.
    def reach(graph, start):
        seen, q = set(), deque([start])
        depth = {start: 0}
        while q:
            n = q.popleft()
            for m in graph.get(n, ()):
                if m not in seen:
                    seen.add(m)
                    depth[m] = depth[n] + 1
                    q.append(m)
        return seen, depth

    called = {t for _, t in oracle_edges}
    roots = sorted({c for c, _ in oracle_edges
                    if c not in called and c[0] in client_files},
                   key=lambda n: (n[0], int(n[1])))

    print()
    print('── chains from every uncalled client declaration ──')
    print(f'  roots                        {len(roots)}')
    tot_o = tot_e = 0
    broken = []
    deepest_o = deepest_e = 0
    for r in roots:
        o_set, o_depth = reach(oracle_out, r)
        e_set, _ = reach(engine_out, r)
        tot_o += len(o_set)
        tot_e += len(o_set & e_set)
        deepest_o = max([deepest_o] + list(o_depth.values()))
        deepest_e = max([deepest_e] + [d for n, d in o_depth.items() if n in e_set])
        for n in sorted(o_set - e_set, key=lambda x: o_depth[x]):
            broken.append((r, n, o_depth[n]))
    if tot_o:
        print(f'  oracle-reachable declarations {tot_o}')
        print(f'  engine reaches                {tot_e}   {tot_e / tot_o:.3f}')
    print(f'  deepest oracle hop            {deepest_o}')
    print(f'  deepest hop the engine holds  {deepest_e}')
    if broken:
        print(f'  UNREACHED (root, lost declaration, hop):  {len(broken)}')
        seen_pairs = set()
        for r, n, d in sorted(broken, key=lambda x: x[2])[:20]:
            k = (r, n)
            if k in seen_pairs:
                continue
            seen_pairs.add(k)
            rn = oracle_decl_name.get(r, '')
            nn = oracle_decl_name.get(n, '')
            print(f'    hop {d}  {fmt(r)} {rn}  cannot reach  {fmt(n)} {nn}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
