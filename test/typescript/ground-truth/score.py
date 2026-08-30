#!/usr/bin/env python3
"""
Score the TypeScript engine against the tsc oracle, PER CALL SITE.

── WHY PER SITE AND NOT PER EDGE ────────────────────────────────────────────
An engine can have perfect edge recall while being wrong at individual sites. A
dispatch set of 12 where one target runs scores as 1 agreed plus 11
over-approximations PER EDGE, but it is one site a reader cannot trust.
So the unit here is the call site, and a site with a 12-way fan counts once — as a
SOUND SUPERSET, which is a different and weaker answer than EXACT.

── THE ASYMMETRY IS DELIBERATE ──────────────────────────────────────────────
MISSED is a failure: the compiler named a declaration and the engine found none.
SUPERSET is reported, not failed: where dispatch is genuinely ambiguous the engine
emits a sound set on purpose. WRONG is the serious one — the engine named a target
and the compiler's answer is not among them.

── IDENTITY ─────────────────────────────────────────────────────────────────
A target is identified by (last two path segments, line, column). Not by hash, which
is run-local and cannot cross toolchains; not by full path, because the engine's
library paths are relative to each staged IR root while the oracle's are absolute.
Position is exact in both and is what makes overload-level agreement measurable —
77.6% of overloaded calls resolve to a non-first declaration, so a name-level
comparison would score those as agreements regardless of which overload was picked.

Usage: score.py <ir-dir> <engine-out-dir> <oracle.tsv> [--lib=<ir-dir> ...] [--envelope=<tsv>]
"""
import csv
import os
import sys
from collections import defaultdict

def read_tsv(path, header=True):
    with open(path, newline='', encoding='utf-8', errors='replace') as fh:
        r = csv.reader(fh, delimiter='\t', quoting=csv.QUOTE_NONE)
        rows = list(r)
    if header and rows:
        # A ROW THAT DOES NOT MEET THE HEADER'S FIELD COUNT IS DROPPED, not indexed into.
        # A torn write leaves a short row behind; reading it raises IndexError deep inside a
        # join and takes down a scorer that had nothing to do with the fault. The header is
        # the contract, and a row that breaks it is not data.
        n = len(rows[0])
        return [r for r in rows[1:] if len(r) == n]
    return rows

def base(p):
    """The file's BASENAME. Not the full path and not two segments: a library IR is
    rooted at whatever directory it was extracted from, so the same file is
    `lib/lib.es5.d.ts` to the oracle and `lib.es5.d.ts` to the engine. Basename plus an
    exact line AND column is unique in practice, and it is the only identity both
    sides can compute without agreeing on a root."""
    p = p.replace('\\', '/')
    parts = [x for x in p.split('/') if x]
    return parts[-1] if parts else p

def main():
    ir_dir, out_dir, oracle_path = sys.argv[1], sys.argv[2], sys.argv[3]
    lib_dirs = []
    envelope_path = None
    for a in sys.argv[4:]:
        if a.startswith('--lib='):
            lib_dirs.append(a[len('--lib='):])
        elif a.startswith('--envelope='):
            envelope_path = a[len('--envelope='):]

    # ---- client IR: module hash -> file, call-site expr -> position ----
    mod_file = {}
    for row in read_tsv(os.path.join(ir_dir, 'all-typescript-modules.csv')):
        mod_file[row[26]] = row[3]

    # expression hash -> (startLine, startCol, endLine, endCol). The SPAN, because a
    # chained call and its inner call share a start position: 14,076 sites collapse to
    # 13,271 distinct starts on this corpus, so a start-keyed join silently mixes them.
    expr_span = {}
    for row in read_tsv(os.path.join(ir_dir, 'all-typescript-expressions.csv')):
        expr_span[row[33]] = (row[20], row[21], row[22], row[23])

    # call expression hash -> (file, span..., callKind, calleeName)
    call_pos = {}
    for row in read_tsv(os.path.join(ir_dir, 'all-typescript-call-sites.csv')):
        ce, mod = row[5], row[6]
        sp = expr_span.get(ce)
        if sp is None:
            continue
        call_pos[ce] = (mod_file.get(mod, ''), sp[0], sp[1], sp[2], sp[3], row[0], row[1])

    # ---- method hash -> position, over the client and every staged library ----
    meth_pos = {}
    def load_methods(d):
        mf = {}
        mpath = os.path.join(d, 'all-typescript-modules.csv')
        if os.path.exists(mpath):
            for row in read_tsv(mpath):
                mf[row[26]] = row[3]
        p = os.path.join(d, 'all-typescript-methods.csv')
        if not os.path.exists(p):
            return
        for row in read_tsv(p):
            h = row[42]
            f = row[4] or mf.get(row[21], '')
            meth_pos[h] = (f, row[5], row[39], row[0])
    load_methods(ir_dir)
    for d in lib_dirs:
        load_methods(d)

    # ---- engine answer: call site -> set of target identities ----
    engine_targets = defaultdict(set)
    engine_status = {}
    for row in read_tsv(os.path.join(out_dir, 'call-chain-edges.csv'), header=False):
        ce, _caller, _te, to, _prov, status, _kind = row[:7]
        engine_status.setdefault(ce, set()).add(status)
        if to != '-' and to in meth_pos:
            f, line, col, _name = meth_pos[to]
            engine_targets[ce].add((base(f), line, col))

    # A resolved target whose position the IR does not carry: counted apart, because
    # "the engine resolved and the harness could not locate it" is a harness gap, not
    # an engine one, and silently scoring it as a miss would blame the wrong layer.
    unlocatable = set()
    for row in read_tsv(os.path.join(out_dir, 'call-chain-edges.csv'), header=False):
        ce, to = row[0], row[3]
        if to != '-' and to not in meth_pos:
            unlocatable.add(ce)

    # ---- oracle: (file, line, col) -> target identity ----
    oracle = {}
    for row in read_tsv(oracle_path):
        key = (row[0], row[1], row[2], row[3], row[4])
        tf, tl, tc, tkind = row[7], row[8], row[9], row[11]
        ocount = int(row[12]) if len(row) > 12 and row[12].isdigit() else 1
        oidx = int(row[13]) if len(row) > 13 and row[13].isdigit() else 0
        oracle[key] = (base(tf), tl, tc, tkind, row[6], row[5], ocount, oidx)

    # ---- join on position ----
    buckets = defaultdict(int)
    by_kind = defaultdict(lambda: defaultdict(int))
    wrong_examples = []
    missed_by_callee = defaultdict(int)
    missed_by_target = defaultdict(int)
    missed_rows = []

    # THE OVERLOAD SLICE. "Did the engine find the right function" and "did it find the
    # right SIGNATURE" are different questions, and only the second is hard: the schema
    # measures 77.6% of overloaded calls resolving to a NON-FIRST declaration, so an
    # engine that always took declaration 0 would score well on names and be wrong three
    # times in four exactly where it matters.
    ov = defaultdict(int)
    matched = 0
    for ce, (f, line, col, eline, ecol, ckind, cname) in call_pos.items():
        key = (f, line, col, eline, ecol)
        o = oracle.get(key)
        if o is None:
            buckets['NO_ORACLE_ROW'] += 1
            continue
        matched += 1
        otarget, tkind = (o[0], o[1], o[2]), o[3]
        eng = engine_targets.get(ce, set())

        if tkind == 'synthesized':
            # An implicit constructor: the compiler resolved, and there is nothing to
            # point at. Scored as decidable-and-correct only when the engine also
            # declined to invent a target.
            b = 'SYNTHESIZED_OK' if not eng else 'SYNTHESIZED_EXTRA'
        elif tkind == 'unresolved' or o[1] == '':
            b = 'ORACLE_UNRESOLVED'
        elif not eng:
            b = 'MISSED_UNLOCATABLE' if ce in unlocatable else 'MISSED'
            if b == 'MISSED':
                missed_by_callee[cname] += 1
                missed_by_target[o[0]] += 1
                if len(missed_rows) < 200000:
                    missed_rows.append((f, line, col, ckind, cname, o[0], o[1], o[4]))
        elif otarget in eng:
            b = 'EXACT' if len(eng) == 1 else 'SOUND_SUPERSET'
        else:
            b = 'WRONG'
            if len(wrong_examples) < 40:
                wrong_examples.append((f, line, col, ckind, cname, otarget, sorted(eng)[:3]))
        buckets[b] += 1
        by_kind[ckind][b] += 1
        if len(o) > 6 and o[6] > 1:
            ov['sites'] += 1
            ov[f'bucket:{b}'] += 1
            if o[7] > 0:
                ov['non_first'] += 1
                ov[f'non_first:{b}'] += 1

    total = sum(buckets.values())
    decidable = sum(
        buckets[b] for b in ('EXACT', 'SOUND_SUPERSET', 'WRONG', 'MISSED', 'MISSED_UNLOCATABLE')
    )
    right = buckets['EXACT'] + buckets['SOUND_SUPERSET']
    exact_rate = buckets['EXACT'] / decidable if decidable else 0.0
    right_rate = right / decidable if decidable else 0.0

    print(f'call sites (parser IR)      {len(call_pos)}')
    print(f'call sites (oracle)         {len(oracle)}')
    print(f'joined on position          {matched}')
    print()
    for b in (
        'EXACT', 'SOUND_SUPERSET', 'WRONG', 'MISSED', 'MISSED_UNLOCATABLE',
        'SYNTHESIZED_OK', 'SYNTHESIZED_EXTRA', 'ORACLE_UNRESOLVED', 'NO_ORACLE_ROW',
    ):
        if buckets[b]:
            print(f'{b:<22} {buckets[b]:>7}')
    print()
    print(f'decidable                   {decidable}')
    print(f'EXACT target                {buckets["EXACT"]:>7}   {exact_rate:.3f}')
    print(f'target in engine set        {right:>7}   {right_rate:.3f}')
    print(f'WRONG (engine named, oracle disagrees)  {buckets["WRONG"]}')
    print()
    if ov['sites']:
        dec = ov['bucket:EXACT'] + ov['bucket:SOUND_SUPERSET'] + ov['bucket:WRONG'] + ov['bucket:MISSED']
        print('overload sites (the resolved symbol has more than one declaration):')
        print(f'  sites                       {ov["sites"]}')
        print(f'  of which the compiler chose a NON-FIRST declaration   {ov["non_first"]}')
        print(f'  EXACT                       {ov["bucket:EXACT"]}   '
              f'{ov["bucket:EXACT"] / dec if dec else 0:.3f}')
        print(f'  SOUND_SUPERSET              {ov["bucket:SOUND_SUPERSET"]}')
        print(f'  WRONG                       {ov["bucket:WRONG"]}')
        print(f'  MISSED                      {ov["bucket:MISSED"]}')
        nf = ov['non_first:EXACT'] + ov['non_first:SOUND_SUPERSET'] + ov['non_first:WRONG'] + ov['non_first:MISSED']
        if nf:
            print(f'  on NON-FIRST choices only:  EXACT {ov["non_first:EXACT"]}   '
                  f'{ov["non_first:EXACT"] / nf if nf else 0:.3f}   '
                  f'(WRONG {ov["non_first:WRONG"]}, MISSED {ov["non_first:MISSED"]})')
        print()
    print('by call kind:')
    for k in sorted(by_kind, key=lambda k: -sum(by_kind[k].values())):
        d = by_kind[k]
        dec = d['EXACT'] + d['SOUND_SUPERSET'] + d['WRONG'] + d['MISSED'] + d['MISSED_UNLOCATABLE']
        acc = (d['EXACT'] + d['SOUND_SUPERSET']) / dec if dec else 0.0
        print(
            f'  {k:<22} exact={d["EXACT"]:>6} superset={d["SOUND_SUPERSET"]:>5} '
            f'wrong={d["WRONG"]:>5} missed={d["MISSED"]:>6}  acc={acc:.3f}'
        )
    if missed_by_callee:
        print()
        print('top missed callees:')
        for name, n in sorted(missed_by_callee.items(), key=lambda x: -x[1])[:20]:
            print(f'  {n:>6}  {name}')
    # ── the DISPATCH ENVELOPE, when one was computed ────────────────────────
    # Two bounds, exactly as the JVM harness reports them: MUST (the declaration the
    # compiler named — a miss is undeniable) and POSSIBLE (the CHA / RTA envelope — a
    # target outside it is a demonstrable false positive, not an over-approximation).
    # Reported together because a call graph has two kinds of truth and one number
    # cannot carry both.
    if envelope_path and os.path.exists(envelope_path):
        env = {}
        for row in read_tsv(envelope_path):
            key = (row[0], row[1], row[2], row[3], row[4])
            cha = set(x for x in row[10].split(';') if x)
            rta = set(x for x in row[11].split(';') if x)
            env[key] = (cha, rta)
        tp_cha = fp_cha = 0
        tp_rta = fp_rta = 0
        cha_total = rta_total = 0
        outside_cha = []
        for ce, (f, line, col, eline, ecol, ckind, cname) in call_pos.items():
            e = env.get((f, line, col, eline, ecol))
            if not e:
                continue
            cha, rta = e
            eng = {f'{t[0]}:{t[1]}:{t[2]}' for t in engine_targets.get(ce, set())}
            if not cha:
                continue
            cha_total += len(cha)
            rta_total += len(rta)
            for t in eng:
                if t in cha:
                    tp_cha += 1
                else:
                    fp_cha += 1
                    if len(outside_cha) < 20:
                        outside_cha.append((f, line, col, cname, t, sorted(cha)[:2]))
                if t in rta:
                    tp_rta += 1
                else:
                    fp_rta += 1
        emitted = tp_cha + fp_cha
        print()
        print('dispatch envelope (edges, not sites):')
        print(f'  engine edges emitted            {emitted}')
        print(f'  inside CHA envelope             {tp_cha}   precision {tp_cha / emitted if emitted else 0:.3f}')
        print(f'  inside RTA envelope             {tp_rta}   precision {tp_rta / emitted if emitted else 0:.3f}')
        print(f'  CHA envelope size (total)       {cha_total}   recall vs CHA {tp_cha / cha_total if cha_total else 0:.3f}')
        print(f'  RTA envelope size (total)       {rta_total}   recall vs RTA {tp_rta / rta_total if rta_total else 0:.3f}')
        if outside_cha:
            print('  edges OUTSIDE the CHA envelope (demonstrable false positives):')
            for f, line, col, cname, t, sample in outside_cha[:10]:
                print(f'    {f}:{line}:{col} {cname}() -> {t}   envelope {sample}')

    if missed_by_target:
        print()
        print('top missed by ORACLE TARGET FILE (which declaration family is unreachable):')
        for name, n in sorted(missed_by_target.items(), key=lambda x: -x[1])[:20]:
            print(f'  {n:>6}  {name}')
    site_dump = os.environ.get('SITE_DUMP')
    if site_dump:
        # Every site, with the compiler's answer beside the engine's. On a small
        # fixture this IS the validation — a reader checks 83 rows against the source
        # rather than trusting an aggregate.
        with open(site_dump, 'w', encoding='utf-8') as fh:
            fh.write('verdict\tcallFile\tline\tcol\tkind\tcallee\toverloads\tchosen\toracleTarget\tengineTargets\n')
            for ce, (f, line, col, eline, ecol, ckind, cname) in sorted(
                    call_pos.items(), key=lambda kv: (kv[1][0], int(kv[1][1]), int(kv[1][2]))):
                o = oracle.get((f, line, col, eline, ecol))
                if not o:
                    continue
                eng = sorted(f'{t[0]}:{t[1]}:{t[2]}' for t in engine_targets.get(ce, set()))
                ot = f'{o[0]}:{o[1]}:{o[2]}'
                if o[3] == 'synthesized':
                    v = 'SYNTHESIZED'
                elif not eng:
                    v = 'MISSED'
                elif ot in eng:
                    v = 'EXACT' if len(eng) == 1 else 'SUPERSET'
                else:
                    v = 'WRONG'
                fh.write('\t'.join([v, f, line, col, ckind, cname,
                                    str(o[6]) if len(o) > 6 else '1',
                                    str(o[7]) if len(o) > 7 else '0',
                                    ot, ';'.join(eng)]) + '\n')
        print(f'\nper-site detail written to {site_dump}')

    dump = os.environ.get('MISSED_DUMP')
    if dump and missed_rows:
        with open(dump, 'w', encoding='utf-8') as fh:
            fh.write('callFile\tcallLine\tcallCol\tcallKind\tcalleeName\ttargetFile\ttargetLine\ttargetName\n')
            for r in missed_rows:
                fh.write('\t'.join(str(x) for x in r) + '\n')
        print(f'\nmissed sites dumped to {dump}')
    if wrong_examples:
        print()
        print('WRONG examples (site -> oracle target vs engine set):')
        for f, line, col, ckind, cname, ot, eng in wrong_examples[:15]:
            print(f'  {f}:{line}:{col} {ckind} {cname}()')
            print(f'      oracle {ot}')
            print(f'      engine {eng}')

if __name__ == '__main__':
    main()
