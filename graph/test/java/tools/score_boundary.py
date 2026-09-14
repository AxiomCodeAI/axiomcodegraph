#!/usr/bin/env python3
"""Score the engine's client->LIBRARY hand-off against the library's own class-file ground truth.

score_scale.py answers "does the engine get the client's own calls right". This answers the
other half: when a client call leaves for the JDK, does the engine name the EXACTLY CORRECT
library method?

Ground truth is the invoke instruction in the client's compiled bytecode: its constant-pool
entry names owner, method and descriptor, so the JDK mapping is read from the artifact rather
than inferred. Both sides are keyed by (caller, source line).

A SITE THE ENGINE CANNOT BE RESPONSIBLE FOR IS NOT SCORED AGAINST IT. Two ways that happens, and
both were previously charged as engine misses — together more than half of everything this scorer
reported as unresolved, which is a very efficient way to spend a week fixing nothing:

  * the receiver can only be typed through a library that is NOT STAGED. Scoring a project against
    the platform IR alone leaves its real dependencies absent, so `dep.getThings().stream()` has an
    untypable receiver however good the rules are. Detected from the ground truth itself: the same
    source line also calls a type present in neither the client IR nor the staged library.
  * the caller is a CONSTRUCTOR. The engine keys a constructor body — and a field initializer, which
    javac compiles into one — by its owning TYPE, while bytecode names it `<init>`. The two never
    matched, so every call written in a constructor was scored unresolved.

TWO CHECKS THE SCORER CARRIES ITSELF, because neither can be left to memory:
  * a ground-truth callee whose type is absent from the staged library IR is reported as
    LIB IR LACKS THE TYPE, never as an engine miss — that is version skew between the compiled
    client and the library source, and it must be visible as its own number.
  * an engine answer naming the SAME signature on a type related to the bytecode owner by
    inheritance is reported separately, and split by direction. Bytecode names the receiver's
    STATIC type, so `Map<K,V> m = new HashMap<>(); m.put(..)` is recorded as java.util.Map#put.
    An engine that flow-typed the variable to its allocated type answers java.util.HashMap#put
    — the method that actually runs. Neither is an error, and folding them into either EXACT or
    WRONG TARGET would decide a convention question by accident, so:
        MORE PRECISE      engine named a SUBTYPE of the bytecode owner (the runtime target)
        DECLARING ANCESTOR engine named a SUPERTYPE (where the method is declared)

usage: score_boundary.py <client-IR> <engine-OUT> <ground-truth> --library R1[,R2...]
                         [--prefix java.,javax.,jdk.] [--census N]
"""
import csv, os, re, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score_scale import Names, rows, simple
from lib_names import resolve

def main():
    ir, out, gt = sys.argv[1:4]
    roots = sys.argv[sys.argv.index('--library')+1].split(',')
    prefixes = tuple(sys.argv[sys.argv.index('--prefix')+1].split(',')) if '--prefix' in sys.argv \
               else ('java.', 'javax.', 'jdk.')
    census = int(sys.argv[sys.argv.index('--census')+1]) if '--census' in sys.argv else 20

    n = Names(ir)
    line_of = {}
    for r in rows(f'{ir}/all-expressions.csv'):
        line_of[r['expressionUniqueHash']] = r['startLine']

    # ── engine side ────────────────────────────────────────────────────────────────────
    raw = []
    for line in open(f'{out}/call-chain-edges.csv', encoding='utf-8', errors='replace'):
        f = line.rstrip('\n').split('\t')
        if len(f) >= 7: raw.append(f)
    want = {f[3] for f in raw if f[3].startswith('METHOD_REGISTRY_') and f[3] not in n.m}
    lib = resolve(roots, want)
    # A constructor body, and a field initializer that javac compiles into one, is keyed by the
    # owning TYPE on the engine side and by `<init>` on the bytecode side. Name it the way the
    # oracle does instead of dropping it: 132-409 rows per project were discarded here.
    type_name = {}
    for t in rows(f'{ir}/all-types.csv'):
        q = t['qualifiedName']
        type_name[t['typeRegistryUniqueHash']] = f"{n.anon.get(q, q)}#<init>()"
    eng, eng_caller = collections.defaultdict(set), collections.defaultdict(set)
    for f in raw:
        c = n.m.get(f[1]) or type_name.get(f[1])
        if not c: continue
        tgt = lib.get(f[3])
        if not tgt or not tgt.startswith(prefixes): continue
        cn = re.sub(r'\([^)]*\)$', '', c)
        eng[(cn, line_of.get(f[0], '?'))].add(tgt)
        eng_caller[cn].add(tgt)

    # ── ground truth: library callees only, callers restricted to the client IR ─────────
    client_types = {v.split('#')[0] for v in n.m.values()}
    orc = collections.defaultdict(set)
    on_line = collections.defaultdict(set)        # every callee owner the line calls, library or not
    for line in open(gt, encoding='utf-8', errors='replace'):
        if ' -> ' not in line: continue
        a, b = line.rstrip('\n').split(' -> ', 1)
        m = re.match(r'^(.*)\(([^()]*)\)@(-?\d+)$', a)
        if not m: continue
        on_line[(m.group(1), m.group(3))].add(b.split('#')[0])
        if not b.startswith(prefixes): continue
        if '#<init>(' in b: continue                      # ctor targets excluded on BOTH sides
        if m.group(1).split('#')[0] not in client_types: continue
        orc[(m.group(1), m.group(3))].add(b)

    # ── the two self-checks: which library types exist, and their ancestors ────────────
    lib_types, direct = set(), collections.defaultdict(set)
    mods = []
    for root in roots:
        if os.path.exists(f'{root}/all-types.csv'): mods.append(root); continue
        mods += [f'{root}/{d}' for d in sorted(os.listdir(root))
                 if os.path.isdir(f'{root}/{d}') and os.path.exists(f'{root}/{d}/all-types.csv')]
    byhash = {}
    for m in mods:
        for r in rows(f'{m}/all-types.csv'):
            lib_types.add(r['qualifiedName']); byhash[r['typeRegistryUniqueHash']] = r['qualifiedName']
        # BOTH contexts are needed. SUPER_TYPE carries the extends clause ONLY; an implemented
        # interface is a separate context, so reading SUPER_TYPE alone gives
        # sup[java.util.HashMap] == {AbstractMap} and misses Map entirely — which silently
        # reclassifies every interface-vs-implementation pair as a WRONG TARGET.
        for r in rows(f'{m}/all-type-references.csv'):
            if r.get('context') in ('SUPER_TYPE', 'IMPLEMENTS_INTERFACE') and (r.get('depth') or '0') == '0':
                t = byhash.get(r.get('typeRegistryLinkHash'))
                nm = simple(r.get('typeName'))
                if t and nm: direct[t].add(nm)
    # by SIMPLE name, because a type reference records the name as written, not qualified
    by_simple = collections.defaultdict(set)
    for q in lib_types: by_simple[q.split('.')[-1]].add(q)
    _anc = {}
    def ancestors(q, depth=8):
        # java.lang.Object is an ancestor of every reference type, and no source file says so —
        # the library IR is built from written extends/implements clauses, so this walk cannot
        # reach it either. Without this, an engine answer of `Object#toString()` against a truth
        # of `List#toString()` (the interfaces redeclare it) is filed as a WRONG TARGET rather
        # than as the DECLARING ANCESTOR it is, and the scorer reports a fabricated answer where
        # there is none.
        """Transitive supertypes as SIMPLE names. Bounded: a malformed hierarchy must not hang
        the scorer, and 8 levels covers the deepest JDK chain."""
        if q in _anc: return _anc[q]
        seen, frontier = set(), set(direct.get(q, ()))
        for _ in range(depth):
            if not frontier: break
            seen |= frontier
            nxt = set()
            for nm in frontier:
                for fq in by_simple.get(nm, ()): nxt |= direct.get(fq, set())
            frontier = nxt - seen
        if q != 'java.lang.Object': seen.add('Object')
        _anc[q] = seen
        return seen
    def rel(truth_ty, got_ty):
        """How the two owners of one signature are related: 'precise' (got is a subtype of the
        bytecode owner — the runtime target), 'ancestor' (got is a supertype — the declaration
        site), 'related' (neither, but they share an ancestor, so both are levels of the real
        receiver's hierarchy), or None (genuinely unrelated -> a wrong answer)."""
        if simple(truth_ty) in ancestors(got_ty): return 'precise'
        if simple(got_ty)   in ancestors(truth_ty): return 'ancestor'
        # DELIBERATELY NOT a third case. `Set#addAll` (the static type) vs
        # `AbstractCollection#addAll` (the declaration site) are both levels of the real
        # receiver's hierarchy, so folding them in is tempting — but "the two owners share an
        # ancestor" does NOT express that: String and File share Comparable and Serializable,
        # Integer and String share four such markers. A rule that admits every pair of
        # Serializable types would hide real wrong answers. The sound version is a shared
        # SUBTYPE (or a shared ancestor that declares the signature); until one of those is
        # implemented, such a site is scored AGAINST the engine, which is the safe direction
        # for an evaluation.
        return None

    staged = lib_types | client_types
    v = collections.Counter(); miss = collections.Counter(); wrong = []
    unstaged_owners = collections.Counter()
    for k, truth in orc.items():
        if not any(t.split('#')[0] in lib_types for t in truth):
            v['LIB IR LACKS THE TYPE'] += 1; continue
        got = eng.get(k, set())
        if not got or not (got & truth):
            # THE LINE IS NOT RELIABLE, so it is not the last word. javac's line and the IR's
            # expression line diverge on a multi-line chain, and two distinct calls can share one
            # line. Before recording a miss or a wrong answer, ask the weaker question the graph
            # can actually answer: does this CALLER reach this callee at all?
            if truth <= eng_caller.get(k[0], set()):
                v['FOUND (line differs)'] += 1; continue
        if not got:
            # An unresolved site whose line ALSO calls a type absent from both IRs is not evidence
            # about the rules: the receiver could only have been typed through a library nobody
            # staged. Its own number, never the engine's — the same treatment as a missing callee
            # type above, applied to the missing RECEIVER type.
            foreign = {o for o in on_line.get(k, ()) if o not in staged}
            if foreign:
                v['RECEIVER NEEDS AN UNSTAGED TYPE'] += 1
                for o in foreign: unstaged_owners[o] += 1
                continue
            v['UNRESOLVED']  += 1
            for t in truth: miss[t.split('#')[0]] += 1
        elif got == truth: v['EXACT'] += 1
        elif truth <= got: v['SOUND SUPERSET'] += 1
        elif got & truth:  v['PARTIAL'] += 1
        else:
            kinds = {rel(t.split('#')[0], g.split('#')[0])
                     for t in truth for g in got
                     if t.split('#',1)[1] == g.split('#',1)[1]}
            if 'precise'  in kinds: v['MORE PRECISE'] += 1
            elif 'ancestor' in kinds: v['DECLARING ANCESTOR'] += 1
            else:
                v['WRONG TARGET'] += 1
                if len(wrong) < census: wrong.append((k, sorted(truth), sorted(got)))
    # HOW MUCH OF THE LIBRARY IS EVEN THERE. Every number below is conditional on the staged
    # library containing the types the client calls, and scoring a project against the platform IR
    # alone leaves its real dependencies absent — on one corpus project, staging five of them moved
    # 2,303 call sites from "no answer" to answered without the engine changing at all. A run whose
    # coverage is low is not measuring the rules, and the reader has to be told so before the
    # percentages, not after.
    called = collections.Counter()
    for k, owners in on_line.items():
        if k[0].split('#')[0] not in client_types: continue
        for o in owners:
            if o not in client_types: called[o] += 1
    absent = {o: c for o, c in called.items() if o not in lib_types}
    cov = 100 * (len(called) - len(absent)) / max(len(called), 1)

    d = sum(v.values()) or 1
    exact = (v['EXACT'] + v['SOUND SUPERSET'] + v['DECLARING ANCESTOR'] + v['MORE PRECISE']
             + v['FOUND (line differs)'])
    print(f"staged library covers {cov:.0f}% of the library types this client calls "
          f"({len(called) - len(absent):,} of {len(called):,}; {sum(absent.values()):,} call sites name an absent type)")
    if cov < 90:
        print(f"  ** LOW — the numbers below are bounded by what is staged, not by the rules. "
              f"Stage the client's dependencies (tools/build-lib-ir.sh --coord) before reading them.")
    print(f"boundary sites: {d:,}   (client callers, library callees matching {','.join(prefixes)})")
    for kk in ('EXACT','SOUND SUPERSET','MORE PRECISE','DECLARING ANCESTOR',
               'FOUND (line differs)','PARTIAL','WRONG TARGET','UNRESOLVED',
               'LIB IR LACKS THE TYPE','RECEIVER NEEDS AN UNSTAGED TYPE'):
        if v[kk]: print(f"  {kk:<24}{v[kk]:>7,} ({100*v[kk]/d:5.1f}%)")
    adj = d - v['LIB IR LACKS THE TYPE'] - v['RECEIVER NEEDS AN UNSTAGED TYPE']
    print(f"  ---")
    print(f"  correct METHOD named      {100*exact/d:5.1f}%   ({100*exact/max(adj,1):5.1f}% of the {adj:,} the lib IR can answer)")
    print(f"  wrong library method     {100*v['WRONG TARGET']/d:5.1f}%")
    if absent and cov < 100:
        print(f"\nABSENT from the staged library, by call sites naming them")
        for t, c in sorted(absent.items(), key=lambda x: -x[1])[:census]: print(f"  {c:6,}  {t}")
    if unstaged_owners:
        print(f"\nRECEIVER NEEDS AN UNSTAGED TYPE — stage these to score the sites behind them")
        for t, c in unstaged_owners.most_common(census): print(f"  {c:6,}  {t}")
    if miss:
        print(f"\nUNRESOLVED by library type ({sum(miss.values()):,} callee mentions)")
        for t, c in miss.most_common(census): print(f"  {c:6,}  {t}")
    if wrong:
        print(f"\nWRONG TARGET sample")
        for k, t, g in wrong[:census]: print(f"  {k[0]}@{k[1]}\n     truth {t}\n     got   {g}")
    return v

if __name__ == '__main__': main()
