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

# A drive-letter path (`C:/...`, `C:\\...`) as the oracle writes it on Windows. os.path
# on a POSIX host does not consider it absolute, so it is checked by shape as well.
DRIVE_PATH = re.compile(r'^[A-Za-z]:[\\/]')

def is_outside_project(p):
    """An oracle target path that is OUTSIDE the analysed tree.

    tsc-oracle.mjs writes an in-project file relative to the root, with `/`
    separators, and leaves an out-of-project file (the standard library under
    node_modules/typescript/lib, an installed package) absolute and unmodified. So
    "absolute" is the discriminator, and it must be absolute on every platform the
    oracle runs on: `/usr/...` on POSIX, `C:/...` on Windows. A leading-slash test
    sent every standard-library verdict on Windows into the in-project branch (#614).
    """
    return os.path.isabs(p) or bool(DRIVE_PATH.match(p))

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opts = [a for a in sys.argv[1:] if a.startswith('--')]
    if len(args) != 3:
        print(__doc__); sys.exit(2)
    ir, out, oracle_path = args
    production = '--production' in opts
    dump_path = next((o.split('=', 1)[1] for o in opts if o.startswith('--dump=')), None)
    # --lib=<ir-dir> (repeatable): a staged library's methods, identified as the oracle
    # names them — the package root relative to the project (`node_modules/<pkg>`) plus
    # the file — so a client->library edge scores like a client->client one.
    lib_dirs = [o.split('=', 1)[1] for o in opts if o.startswith('--lib=')]

    # ── IR: sites and methods ────────────────────────────────────────────────
    h, mods = read_tsv(os.path.join(ir, 'all-javascript-modules.csv'))
    mod_file = {r[h.index('jsModuleUniqueHash')]: r[h.index('filePath')] for r in mods}
    ir_files = set(mod_file.values())
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
    project_root = os.path.realpath(os.path.dirname(os.path.abspath(oracle_path)))
    for d in lib_dirs:
        lh, lrows = read_tsv(os.path.join(d, 'all-javascript-methods.csv'))
        if not lh:
            continue
        j = {c: lh.index(c) for c in ('jsMethodUniqueHash', 'filePath', 'startLine', 'startColumn', 'name', 'baseMservPath')}
        for r in lrows:
            base = r[j['baseMservPath']]
            # the package root relative to the project: the segment from node_modules on
            k = base.find('/node_modules/')
            rel_base = base[k + 1:] if k >= 0 else os.path.basename(base)
            method_ident[r[j['jsMethodUniqueHash']]] = (rel_base + '/' + r[j['filePath']], r[j['startLine']], r[j['startColumn']])
            method_name[r[j['jsMethodUniqueHash']]] = r[j['name']]
            ir_files.add(rel_base + '/' + r[j['filePath']])

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
    eng_ambient = set()
    eng_hashes = defaultdict(set)
             # sites carrying an ambient_terminal row (alone or as an alternative)
    for r in edges:
        if len(r) < 7:
            continue
        ce, caller, _, callee, prov, cls, kind = r[:7]
        key = site_key.get(ce)
        if key is None:
            continue
        eng_seen.add(key)
        if cls == 'ambient_terminal':
            eng_ambient.add(key)
        # A callback-registration or event-dispatch row names a function the site HANDS
        # OVER or fires, not the site's callee; the compiler's answer is about the callee.
        if cls in ('callback_registered', 'event_dispatch'):
            continue
        if key not in eng_class or cls != 'ambient_terminal':
            eng_class[key] = cls
        if callee != '-' and prov == 'client' and callee in method_ident:
            eng_targets[key].add(method_ident[callee])
            eng_hashes[key].add(callee)
        elif callee != '-' and prov == 'lib':
            eng_targets[key].add(method_ident.get(callee, ('<lib>', '', '')))
            eng_hashes[key].add(callee)

    # ── oracle ───────────────────────────────────────────────────────────────
    h, orows = read_tsv(oracle_path)
    col = {c: h.index(c) for c in h}
    buckets = Counter()
    undecided = Counter()
    rows_out = []
    conservation_missing = 0
    oracle_sites = 0
    # Gate on the gate: an in-project declaration verdict whose target sits under
    # node_modules (the standard library, an installed package) means the platform
    # discriminator misread the path. Independent of that discriminator, and zero on
    # a correct run on every platform.
    decl_target_outside = 0
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
        if tk == 'bodiless' and otarget[0].endswith('.d.ts') and not is_outside_project(otarget[0]):
            # A `.d.ts` INSIDE the project: the compiler prefers the declaration to
            # the JavaScript body beside it. The engine's target is that body, and a
            # name match at the declaration is the agreement available.
            b = 'DECL_IMPL_OK' if any(method_name.get(h, '') == r[col['targetName']] for h in eng_hashes.get(key, ())) else 'DECL_FILE_TARGET'
            if '/node_modules/' in otarget[0].replace('\\', '/'):
                decl_target_outside += 1
        elif tk == 'bodiless' and otarget[0].endswith('.d.ts'):
            if key in eng_ambient:
                b = 'LIB_AMBIENT_OK'
            elif targets:
                b = 'LIB_WRONG'
            else:
                b = 'LIB_MISSED'
        elif tk == 'bodiless' and otarget[0] in ir_files:
            # The compiler's answer is a JSDoc function TYPE — `@type {(n) => void}`
            # on a field or `@param {() => void} cb` — not a body. The engine has
            # nothing to point at; a site it resolved is a value it tracked to a real
            # body, which the compiler cannot confirm or refute.
            b = 'TYPE_ONLY_TARGET'
        elif tk in ('implementation', 'bodiless') and otarget[0] not in ir_files:
            # The compiler followed an import into a file the JavaScript front end
            # never extracted — a `.ts` sibling in a mixed repository, a JSON module.
            # Not reachable by any rule; kept apart from MISSED because the fix is
            # not a rule.
            b = 'TARGET_OUTSIDE_IR'
        elif tk == 'synthesized' and ckind not in ('CONSTRUCTOR_CALL', 'SUPER_CALL'):
            # A signature with no declaration on a plain call: the compiler typed the
            # callee as `Function` or a union and gave up on WHICH. Undecided.
            undecided['resolved' if targets else cls] += 1
            rows_out.append((key, ckind, r[col['calleeName']], tk, 'UNDECIDED', cls, ';'.join('%s:%s:%s' % t for t in sorted(targets))))
            continue
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
    for b in ('SYNTHESIZED_OK', 'SYNTHESIZED_OVER', 'SYNTHESIZED_MISSED', 'LIB_AMBIENT_OK', 'LIB_WRONG', 'LIB_MISSED', 'TARGET_OUTSIDE_IR', 'TYPE_ONLY_TARGET', 'DECL_IMPL_OK', 'DECL_FILE_TARGET', 'ENGINE_DROPPED'):
        if buckets[b]:
            print('  %-18s %6d' % (b, buckets[b]))
    if decl_target_outside:
        print('  SCORER_SELF_CHECK  %6d  DECL_FILE_TARGET rows under node_modules: the in-project test misread a path (#614)' % decl_target_outside)
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
