#!/usr/bin/env python3
"""
The three-way ledger: what the COMPILER saw, what the PARSER emitted, what the ENGINE
resolved — and a declaration identity that is a full path rather than a basename.

── WHY A THIRD COLUMN ───────────────────────────────────────────────────────
`score.py` compares two things: the engine's answer and the compiler's. Everything the
parser failed to emit is folded into a single `adjudicable` count, so a site that never
reached the IR and a site the engine could not resolve are indistinguishable in the
number that matters. They need different people to fix them. This report keeps the three
columns apart and, for the parser column, prints the sites themselves rather than a
total, so "these call sites exist and you did not emit them" is a list someone can act on.

── WHY FULL PATHS ───────────────────────────────────────────────────────────
A library IR records file paths RELATIVE to the directory it was extracted from; the
oracle reports absolute paths. Lacking a way to reconcile them, `score.py` identifies a
declaration by (basename, line, column) — and a basename is not unique. Measured across
this corpus: 21.5% of nest's identity keys and 25.5% of trpc's are shared by more than one
file. Almost all of those are `file:1:1` module initialisers that no oracle target names,
and at real declaration positions the join is sound on four of five projects — but axios
is not one of them. It ships two `index.d.ts` files whose declarations share positions,
and 17% of its adjudicated targets land on a key both of them own. Its accuracy number was
never trustworthy and nothing in the score said so.

run-evaluation.sh now writes `.source-root` beside every staged IR, so a relative path can
be made absolute again and the identity is exact. Where that file is absent this falls
back to the basename and SAYS SO, with the collision count, rather than reporting a number
whose soundness it cannot vouch for.

Usage: three-way.py <eval-dir> [--list-missing=N] [--csv=<out.csv>]
"""
import csv
import os
import sys
from collections import defaultdict


JSX_KINDS = {'JSX_COMPONENT_CALL'}


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


def source_root(d):
    p = os.path.join(d, '.source-root')
    if os.path.exists(p):
        with open(p, encoding='utf-8') as fh:
            r = fh.read().strip()
            if r:
                return r
    return None


def main():
    if len(sys.argv) < 2:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    ev = sys.argv[1]
    list_missing = 0
    csv_out = None
    for a in sys.argv[2:]:
        if a.startswith('--list-missing='):
            list_missing = int(a.split('=', 1)[1])
        elif a.startswith('--csv='):
            csv_out = a.split('=', 1)[1]

    ir = os.path.join(ev, 'ir')
    out = os.path.join(ev, 'out')

    # ── declaration identity, full path where the root is known ─────────────
    exact_identity = True
    decl_of_hash = {}
    holders = defaultdict(set)

    def load(d):
        nonlocal exact_identity
        root = source_root(d)
        if root is None:
            exact_identity = False
        mods = {r[26]: r[3] for r in read_tsv(os.path.join(d, 'all-typescript-modules.csv'))}
        for r in read_tsv(os.path.join(d, 'all-typescript-methods.csv')):
            rel = r[4] or mods.get(r[21], '')
            key = os.path.realpath(os.path.join(root, rel)) if root else os.path.basename(
                rel.replace('\\', '/'))
            ident = (key, r[5], r[39])
            decl_of_hash[r[42]] = ident
            holders[ident].add(rel)

    load(ir)
    libdir = os.path.join(ev, 'libir')
    if os.path.isdir(libdir):
        for d in sorted(os.listdir(libdir)):
            load(os.path.join(libdir, d))

    ambiguous = {k for k, v in holders.items() if len(v) > 1}
    staged_files = {k for k, _, _ in holders}

    # ── what the PARSER emitted: call sites, keyed by span ──────────────────
    mod_file = {r[26]: r[3] for r in read_tsv(os.path.join(ir, 'all-typescript-modules.csv'))}
    span = {r[33]: (r[20], r[21], r[22], r[23])
            for r in read_tsv(os.path.join(ir, 'all-typescript-expressions.csv'))}
    parser_site = {}
    for r in read_tsv(os.path.join(ir, 'all-typescript-call-sites.csv')):
        sp = span.get(r[5])
        if sp:
            parser_site[(mod_file.get(r[6], ''), sp[0], sp[1], sp[2], sp[3])] = r[5]

    # ── what the ENGINE resolved ────────────────────────────────────────────
    engine = defaultdict(set)
    for r in read_tsv(os.path.join(out, 'call-chain-edges.csv'), header=False):
        if r[3] != '-' and r[3] in decl_of_hash:
            engine[r[0]].add(decl_of_hash[r[3]])

    # ── the compiler's universe ─────────────────────────────────────────────
    client_root = source_root(ir)
    n = defaultdict(int)
    missing_by_file = defaultdict(int)
    missing_rows = []
    rows_out = []
    for r in read_tsv(os.path.join(ev, 'oracle.tsv')):
        n['compiler saw'] += 1
        key = (r[0], r[1], r[2], r[3], r[4])
        ce = parser_site.get(key)
        if ce is None:
            # SPLIT BY CAUSE. A JSX element is a call to its component to the compiler and
            # a RESERVED enum value carrying zero rows to the parser, which is what the
            # schema specifies until TSX is switched on — the two are measuring different
            # things, not disagreeing. Merging that with a file the parser never saw makes
            # a compliant parser look broken and hides the gap that is real. Measured on
            # zustand: of 146, 144 are JSX and the remainder is noise.
            if r[5] in JSX_KINDS:
                n['PARSER did not emit — JSX, reserved until TSX is on'] += 1
                rows_out.append((r[0], r[1], r[2], r[5], r[6], 'jsx_reserved', '', ''))
            else:
                n['PARSER did not emit — NOT IN THE ANALYSED PROGRAM'] += 1
                missing_by_file[r[0]] += 1
                missing_rows.append((r[0], r[1], r[2], r[5], r[6]))
                rows_out.append((r[0], r[1], r[2], r[5], r[6], 'parser_gap', '', ''))
            continue
        n['parser emitted'] += 1
        if r[11] in ('synthesized', 'unresolved', 'oracle_error') or not r[8]:
            n['  not adjudicable (compiler names no declaration)'] += 1
            rows_out.append((r[0], r[1], r[2], r[5], r[6], 'not_adjudicable', '', ''))
            continue
        # A target the run never staged cannot be adjudicated. The compiler names a
        # declaration in a file that is not in ANY staged IR — nest's own
        # `shared.utils.ts`, an rxjs operator we did not stage — so the engine had no
        # way to name it and scoring the site as WRONG attributes a staging or discovery
        # gap to the resolution rules. Measured on nest: 889 of 899 "wrong" answers are
        # this, and only 10 are the engine choosing badly among declarations it HAD.
        # Same reasoning as a synthesized signature: neither side can be right about it.
        if os.path.realpath(r[7]) not in staged_files and exact_identity:
            n['  target NOT STAGED (staging / discovery gap)'] += 1
            rows_out.append((r[0], r[1], r[2], r[5], r[6], 'target_not_staged', r[7], r[8]))
            continue
        n['  adjudicable'] += 1
        want = (os.path.realpath(r[7]) if client_root or True else r[7], r[8], r[9])
        if not exact_identity:
            want = (os.path.basename(r[7].replace('\\', '/')), r[8], r[9])
        got = engine.get(ce, set())
        if not got:
            n['    ENGINE resolved nothing'] += 1
            verdict = 'engine_missed'
        elif want in got:
            n['    engine exact' if len(got) == 1 else '    engine sound superset'] += 1
            verdict = 'exact' if len(got) == 1 else 'superset'
        else:
            n['    ENGINE wrong'] += 1
            verdict = 'wrong'
        if want in ambiguous:
            n['    (target identity ambiguous — unsound row)'] += 1
        rows_out.append((r[0], r[1], r[2], r[5], r[6], verdict, r[7], r[8]))

    print(f'== {os.path.basename(os.path.abspath(ev))}')
    print(f'   declaration identity: {"FULL PATH (exact)" if exact_identity else "BASENAME (approximate)"}'
          f'   ambiguous keys: {len(ambiguous)}')
    for k in ['compiler saw', 'PARSER did not emit — JSX, reserved until TSX is on',
              'PARSER did not emit — NOT IN THE ANALYSED PROGRAM', 'parser emitted',
              '  not adjudicable (compiler names no declaration)',
              '  target NOT STAGED (staging / discovery gap)', '  adjudicable',
              '    engine exact', '    engine sound superset', '    ENGINE wrong',
              '    ENGINE resolved nothing', '    (target identity ambiguous — unsound row)']:
        if n[k]:
            print(f'   {k:<52} {n[k]:6d}')
    a = n['  adjudicable']
    if a:
        print(f'   {"exact":<52} {n["    engine exact"] / a:6.3f}')
        print(f'   {"in the engine set":<52} '
              f'{(n["    engine exact"] + n["    engine sound superset"]) / a:6.3f}')

    if list_missing and missing_by_file:
        print(f'\n   CALL SITES THE COMPILER FOUND AND THE PARSER DID NOT — top files')
        for f, c in sorted(missing_by_file.items(), key=lambda x: -x[1])[:list_missing]:
            print(f'     {c:6d}  {f}')
        print(f'     ({len(missing_by_file)} files affected, {n["PARSER did not emit"]} sites)')

    if csv_out:
        with open(csv_out, 'w', newline='', encoding='utf-8') as fh:
            w = csv.writer(fh, delimiter='\t')
            w.writerow(['callFile', 'callLine', 'callCol', 'callKind', 'calleeName',
                        'verdict', 'oracleTargetFile', 'oracleTargetLine'])
            w.writerows(rows_out)
        print(f'\n   per-site ledger -> {csv_out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
