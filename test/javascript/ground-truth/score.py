#!/usr/bin/env python3
"""
Score the JavaScript engine against the tsc oracle, PER CALL SITE.

── THE UNIT IS THE SITE ─────────────────────────────────────────────────────
A dispatch set of 12 where one target runs is one site a reader cannot trust, not
1 agreement and 11 over-approximations. So a site with several targets counts once,
as SOUND_SUPERSET, which is a weaker answer than EXACT.

── THE ASYMMETRY IS DELIBERATE ──────────────────────────────────────────────
MISSED is a failure: the compiler named a declaration and the engine found none.
SUPERSET is reported, not failed. WRONG is the serious one — the engine named
targets and the compiler's is not among them.

── WHAT THE ORACLE CANNOT DECIDE IS NOT A TRUTH ─────────────────────────────
JavaScript types are inferred, and the checker gives up on a callee of type `any`
— roughly half of all sites on the parser's own corpus. Those sites are reported
under UNDECIDED, split by what the engine said about them, and enter NO rate: an
engine target there is neither confirmed nor refuted. Scoring them as correct would
reward guessing; scoring them as wrong would punish resolving what tsc could not.

── TARGET IDENTITY ──────────────────────────────────────────────────────────
(file, line, column) of the declaration, relative to the project root on both
sides. Not by hash (run-local), not by name (a name-level score hides which of two
same-named functions was picked). The oracle starts a declaration at the same
token the parser does — `function`, the arrow's parameter list, the member name —
which is what makes the join exact.

Sites the oracle resolves to a `.d.ts` (the standard library, `@types`) are LIB
targets: with no library IR staged the engine cannot name them, and they are
scored as `ambient_terminal` correct when the engine classified the site as an
ambient terminal, else as LIB_MISSED — kept apart from MISSED because the fix is
staging, not a rule.

Usage: score.py <ir-dir> <engine-out-dir> <oracle.tsv> [--production] [--dump=<tsv>]
"""
import csv
csv.field_size_limit(10**9)
import os
import re
import sys
from collections import Counter, defaultdict

def read_tsv(path):
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return [], []
    with open(path, newline='', encoding='utf-8', errors='replace') as fh:
        rows = list(csv.reader(fh, delimiter='\t'))
    if not rows:
        return [], []
    n = len(rows[0])
    return rows[0], [r for r in rows[1:] if len(r) == n]

TEST_PATH = re.compile(
    r'(^|/)(test|tests|__tests__|__mocks__|spec|specs|benchmark|benchmarks|e2e'
    r'|example|examples|docs|doc|website|scripts|fixtures)(/|$)'
    r'|\.(test|spec|bench)(-[a-z0-9]+)?\.(js|mjs|cjs|jsx)$')

def is_test_path(p):
    return bool(TEST_PATH.search(p))

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opts = [a for a in sys.argv[1:] if a.startswith('--')]
    if len(args) != 3:
        print(__doc__); sys.exit(2)
    ir, out, oracle_path = args
    production = '--production' in opts
    dump_path = next((o.split('=', 1)[1] for o in opts if o.startswith('--dump=')), None)

    # ── IR: sites and methods ────────────────────────────────────────────────
    h, mods = read_tsv(os.path.join(ir, 'all-javascript-modules.csv'))
    mod_file = {r[h.index('jsModuleUniqueHash')]: r[h.index('filePath')] for r in mods}
    h, exprs = read_tsv(os.path.join(ir, 'all-javascript-expressions.csv'))
    ih, isl, isc, iel, iec = (h.index(c) for c in ('jsExpressionUniqueHash', 'startLine', 'startColumn', 'endLine', 'endColumn'))
    expr_span = {r[ih]: (r[isl], r[isc], r[iel], r[iec]) for r in exprs}
    h, sites = read_tsv(os.path.join(ir, 'all-javascript-call-sites.csv'))
    ie, im, ik, iname = (h.index(c) for c in ('expressionLinkHash', 'ownerModuleLinkHash', 'callKind', 'calleeName'))
    site_key = {}      # expr hash -> (file, line, col, endLine, endCol)
    site_meta = {}
    for r in sites:
        f = mod_file.get(r[im], '')
        sp = expr_span.get(r[ie])
        if not sp:
            continue
        key = (f,) + sp
        site_key[r[ie]] = key
        site_meta[key] = (r[ik], r[iname])
    h, methods = read_tsv(os.path.join(ir, 'all-javascript-methods.csv'))
    mh, mf, ml, mc, mn = (h.index(c) for c in ('jsMethodUniqueHash', 'filePath', 'startLine', 'startColumn', 'name'))
    method_ident = {r[mh]: (r[mf], r[ml], r[mc]) for r in methods}
    method_name = {r[mh]: r[mn] for r in methods}

    # ── engine output ────────────────────────────────────────────────────────
    h, edges = read_tsv(os.path.join(out, 'call-chain-edges.csv'))
    if not h:
        # souffle writes no header; read raw
        with open(os.path.join(out, 'call-chain-edges.csv')) as fh:
            edges = [l.rstrip('\n').split('\t') for l in fh if l.strip()]
    else:
        edges = [h] + edges
    eng_targets = defaultdict(set)   # site key -> set of (file, line, col)
    eng_class = {}
    eng_seen = set()
    for r in edges:
        if len(r) < 7:
            continue
        ce, caller, _, callee, prov, cls, kind = r[:7]
        key = site_key.get(ce)
        if key is None:
            continue
        eng_seen.add(key)
        eng_class[key] = cls
        if callee != '-' and prov == 'client' and callee in method_ident:
            eng_targets[key].add(method_ident[callee])
        elif callee != '-' and prov == 'lib':
            eng_targets[key].add(('<lib>', '', ''))

    # ── oracle ───────────────────────────────────────────────────────────────
    h, orows = read_tsv(oracle_path)
    col = {c: h.index(c) for c in h}
    buckets = Counter()
    undecided = Counter()
    rows_out = []
    conservation_missing = 0
    oracle_sites = 0
    per_kind = defaultdict(Counter)
    for r in orows:
        f = r[col['callFile']]
        if production and is_test_path(f):
            continue
        key = (f, r[col['callLine']], r[col['callCol']], r[col['callEndLine']], r[col['callEndCol']])
        oracle_sites += 1
        tk = r[col['targetKind']]
        ckind = r[col['callKind']]
        if key not in site_meta:
            conservation_missing += 1
            continue
        if key not in eng_seen:
            buckets['ENGINE_DROPPED'] += 1
            rows_out.append((key, ckind, r[col['calleeName']], tk, 'ENGINE_DROPPED', '', ''))
            continue
        cls = eng_class.get(key, '')
        targets = eng_targets.get(key, set())
        otarget = (r[col['targetFile']], r[col['targetLine']], r[col['targetCol']])
        if tk == 'any' or tk == 'oracle_error' or tk == 'unresolved':
            undecided['resolved' if targets else cls] += 1
            rows_out.append((key, ckind, r[col['calleeName']], tk, 'UNDECIDED', cls, ';'.join('%s:%s:%s' % t for t in sorted(targets))))
            continue
        if tk == 'bodiless' and (otarget[0].endswith('.d.ts')):
            if cls == 'ambient_terminal':
                b = 'LIB_AMBIENT_OK'
            elif targets:
                b = 'LIB_WRONG'
            else:
                b = 'LIB_MISSED'
        elif tk == 'synthesized':
            if cls == 'implicit_constructor':
                b = 'SYNTHESIZED_OK'
            elif targets:
                b = 'SYNTHESIZED_OVER'
            else:
                b = 'SYNTHESIZED_MISSED'
        else:
            if not targets:
                b = 'MISSED'
            elif otarget in targets:
                b = 'EXACT' if len(targets) == 1 else 'SOUND_SUPERSET'
            else:
                b = 'WRONG'
        buckets[b] += 1
        per_kind[ckind][b] += 1
        rows_out.append((key, ckind, r[col['calleeName']], tk, b, cls,
                         '%s:%s:%s' % otarget + ' | ' + ';'.join('%s:%s:%s' % t for t in sorted(targets))))

    decided = sum(buckets[b] for b in ('EXACT', 'SOUND_SUPERSET', 'WRONG', 'MISSED'))
    total_scored = sum(buckets.values())
    print('sites: oracle=%d ir=%d engine-rows=%d conservation-missing=%d (%.1f%%)' % (
        oracle_sites, len(site_meta), len(eng_seen), conservation_missing,
        100.0 * conservation_missing / max(1, oracle_sites)))
    if conservation_missing > 0.5 * max(1, oracle_sites):
        print('REFUSING: more than half the oracle sites have no IR site — the two sides are not talking about the same tree')
        sys.exit(3)
    print('client->client decided by the compiler: %d' % decided)
    for b in ('EXACT', 'SOUND_SUPERSET', 'WRONG', 'MISSED'):
        print('  %-16s %6d  %.3f' % (b, buckets[b], buckets[b] / max(1, decided)))
    resolved = buckets['EXACT'] + buckets['SOUND_SUPERSET'] + buckets['WRONG']
    print('  exact=%.3f recall=%.3f precision=%.3f' % (
        buckets['EXACT'] / max(1, decided),
        (buckets['EXACT'] + buckets['SOUND_SUPERSET']) / max(1, decided),
        (buckets['EXACT'] + buckets['SOUND_SUPERSET']) / max(1, resolved)))
    print('other:')
    for b in ('SYNTHESIZED_OK', 'SYNTHESIZED_OVER', 'SYNTHESIZED_MISSED', 'LIB_AMBIENT_OK', 'LIB_WRONG', 'LIB_MISSED', 'ENGINE_DROPPED'):
        if buckets[b]:
            print('  %-18s %6d' % (b, buckets[b]))
    print('undecided by the compiler (any): %d' % sum(undecided.values()))
    for k, v in undecided.most_common():
        print('  %-20s %6d' % (k, v))
    print('by call kind (decided):')
    for k, c in sorted(per_kind.items(), key=lambda kv: -sum(kv[1].values())):
        d = sum(c[b] for b in ('EXACT', 'SOUND_SUPERSET', 'WRONG', 'MISSED'))
        if d:
            print('  %-22s n=%-5d exact=%.3f wrong=%d missed=%d' % (k, d, c['EXACT'] / d, c['WRONG'], c['MISSED']))
    if dump_path:
        with open(dump_path, 'w') as fh:
            fh.write('file\tline\tcol\tendLine\tendCol\tcallKind\tcallee\toracleKind\tbucket\tengineClass\ttargets\n')
            for key, ck, cn, tk, b, cls, t in rows_out:
                fh.write('\t'.join(list(key) + [ck, cn, tk, b, cls, t]) + '\n')

if __name__ == '__main__':
    main()
