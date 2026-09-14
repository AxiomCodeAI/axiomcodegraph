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
                [--production]
"""
import csv
csv.field_size_limit(10**9)   # an IR literalValue can be a base64 asset; see test/tools/csv-limit-test.sh
import os
import re
import sys
from collections import defaultdict

def read_tsv(path, header=True):
    with open(path, newline='', encoding='utf-8', errors='replace') as fh:
        # rfc4180, MATCHING SOUFFLE. The engine loads these same files with
        # `rfc4180=true`, so a string-literal type reaches a rule as `"close"` while a
        # QUOTE_NONE reader here sees the raw field `"""close"""`. Measured on three
        # projects: 6,193 values across 10 tables differ between the two readings,
        # including parameterTypeName, returnTypeName, ownerTypeName and completeTypeName.
        # Reading them differently on the two sides manufactures label mismatches that
        # look exactly like engine defects.
        r = csv.reader(fh, delimiter='\t')
        rows = list(r)
    if header and rows:
        # A ROW THAT DOES NOT MEET THE HEADER'S FIELD COUNT IS DROPPED, not indexed into.
        # A torn write leaves a short row behind; reading it raises IndexError deep inside a
        # join and takes down a scorer that had nothing to do with the fault. The header is
        # the contract, and a row that breaks it is not data.
        n = len(rows[0])
        return [r for r in rows[1:] if len(r) == n]
    return rows

# ── PRODUCTION vs TEST code ─────────────────────────────────────────────────
# A repository's test tree is usually LARGER than the library it tests, and it is not
# the code anyone runs a call graph over: typeorm carries 70,534 test call sites against
# 17,062 production ones, remeda 11,193 against 11,818. Folding them together does two
# things, both bad.
#
# It moves every rate toward whatever the test tree happens to exercise -- 80% of one
# project's "accuracy" would be a statement about its fixtures. And it hides extraction
# defects behind an average: typeorm's conservation loss is 11.58% over test code and
# 0.04% over production code, so the project reads as 9.3% lost -- above the threshold
# at which no rate below should be believed -- because of a subtree nobody is measuring
# on purpose.
#
# Anchored to a PATH SEGMENT, not a substring, so `src/testing/` (nest ships a testing
# package as product) is not silently discarded while `test/` is. `docs`/`examples` go
# too: they are compiled by the tsconfig, are not shipped, and typecheck loosely.
TEST_PATH = re.compile(
    r'(^|/)(test|tests|__tests__|__mocks__|spec|specs|benchmark|benchmarks|e2e'
    r'|example|examples|docs|doc|website|scripts)(/|$)'
    # A SUFFIXED test extension counts too. `.test.ts` was matched and `.test-d.ts` was
    # not, so a library whose type tests outnumber its source 17:1 had 94.5% of its
    # "production" sites be test files — 11,055 of 11,818 — and it is 86% of the
    # development set, so the headline development rate was largely a statement about
    # somebody's type tests. Covers .test-d.ts, .test-prop.ts, .spec-x.ts, .bench.ts.
    # The hyphenated part is required to be alphanumeric so `latest.ts` cannot match.
    r'|\.(spec|test|bench)(-[a-z0-9]+)*\.[cm]?[jt]sx?$')


def is_test_path(p):
    return bool(TEST_PATH.search(p))


def base(p):
    """The file's basename. DISPLAY ONLY — see resolved_ident for the comparison key."""
    p = p.replace('\\', '/')
    parts = [x for x in p.split('/') if x]
    return parts[-1] if parts else p


_RP = {}


def rp(path):
    """Resolved absolute path, memoised.

    Both sides name the same file differently and only the filesystem can reconcile
    them. On macOS `/tmp` is a symlink to `/private/tmp`, and under pnpm a package is
    reached through `.pnpm/<name>@<ver>/node_modules/<pkg>` — so the engine's staged root
    `/tmp/x/node_modules/typescript/lib` and the oracle's
    `/private/tmp/x/node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib`
    are one directory under two names. realpath collapses both.
    """
    if not path:
        return path
    v = _RP.get(path)
    if v is None:
        v = os.path.realpath(path)
        _RP[path] = v
    return v


# Roots that could not be resolved, so their rows fall back to a basename identity.
# Reported, never silent: the fallback is exactly the collision this replaced.
_WEAK_ROOTS = []

# Roots recorded in a form this runtime resolves to a path that does not exist. Fatal,
# not weak: every declaration under such a root is unjoinable. See source_root.
_BAD_ROOTS = []


def source_root(d):
    """The directory an IR root was extracted from, per its `.source-root` marker."""
    marker = os.path.join(d, '.source-root')
    if not os.path.exists(marker):
        _WEAK_ROOTS.append(d)
        return ''
    with open(marker, encoding='utf-8', errors='replace') as fh:
        raw = fh.read().strip()
    resolved = rp(raw)
    # A ROOT THE FILESYSTEM DOES NOT HAVE IS NOT A ROOT. `.source-root` is written by the
    # shell and read here; where the shell's path form is not one this runtime resolves,
    # `os.path.realpath` does not fail -- it returns a DIFFERENT, nonexistent absolute
    # path, every staged declaration lands under it, and the join with the oracle's
    # absolute targets silently produces the empty set. That was reported not as a
    # failure but as `TARGET NOT STAGED 85.95%`, naming the client's OWN source files as
    # unstaged, with a verdict of EXACT 0 / WRONG 93. #342.
    if not os.path.isdir(resolved):
        _BAD_ROOTS.append((d, raw, resolved))
        _WEAK_ROOTS.append(d)
        return ''
    return resolved


def resolved_ident(root, f, line, col):
    """The identity BOTH SIDES compare on: resolved absolute path, line, column.

    This used to be (basename, line, column), with a docstring asserting that was
    "unique in practice". Measured on this corpus, it is not: 581 (basename, line, col)
    keys in trpc map to more than one distinct file, 317 in nest, 110 in zustand, 41 in
    remeda. A monorepo has many `index.ts`, and when the engine named one file and the
    compiler named another that happened to share a basename, line and column, the site
    scored EXACT. The error was in the direction of flattering the engine, which is the
    worst direction for a number nobody can check.
    """
    if root and f and not os.path.isabs(f):
        return (rp(os.path.join(root, f)), line, col)
    return (rp(f) if os.path.isabs(f or '') else base(f), line, col)

def main():
    ir_dir, out_dir, oracle_path = sys.argv[1], sys.argv[2], sys.argv[3]
    lib_dirs = []
    envelope_path = None
    sig_impls_path = None
    sibs_path = None
    production_only = False
    for a in sys.argv[4:]:
        if a.startswith('--lib='):
            lib_dirs.append(a[len('--lib='):])
        elif a.startswith('--envelope='):
            envelope_path = a[len('--envelope='):]
        elif a.startswith('--signature-impls='):
            sig_impls_path = a[len('--signature-impls='):]
        elif a.startswith('--overload-siblings='):
            sibs_path = a[len('--overload-siblings='):]
        elif a == '--production':
            production_only = True

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
    pos_group = {}
    pos_meta = {}
    def load_methods(d):
        root = source_root(d)
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
            meth_pos[h] = (f, row[5], row[39], row[0], root)
            # name + methodKind BY POSITION, so a target the oracle names can be
            # compared against a target we name without going back through hashes.
            if len(row) > 16:
                pos_meta[resolved_ident(root, f, row[5], row[39])] = (row[0], row[16])
            # declarationGroupKey (col 22) — every OVERLOAD SIGNATURE of one function
            # shares it. TypeScript overloads are compile-time only: N signatures, ONE
            # implementation, so a call that reaches any of them reaches the same code.
            # Without this the harness scores "chose signature 3 instead of signature 1"
            # identically to "reached a completely different function", and the two are
            # not remotely the same defect.
            if len(row) > 22 and row[22]:
                pos_group[resolved_ident(root, f, row[5], row[39])] = row[22]
    # ── every FILE present in the client IR or any staged library ──────────────
    # Needed to answer a question the report could not previously ask: is the
    # declaration the compiler named present in this analysis at all? A target in a file
    # nothing staged cannot be resolved by any rule, so charging it to the engine
    # manufactures a defect that does not exist. Borrowed from the Java front end, which
    # found better than half of one project's unresolved sites were this (#161, #163).
    staged_files = set()

    def load_files(d):
        root = source_root(d)
        mp = os.path.join(d, 'all-typescript-modules.csv')
        if not os.path.exists(mp):
            return
        for row in read_tsv(mp):
            fp = row[3]
            if not fp:
                continue
            staged_files.add(rp(os.path.join(root, fp))
                             if root and not os.path.isabs(fp) else rp(fp))

    load_methods(ir_dir)
    load_files(ir_dir)
    for d in lib_dirs:
        load_methods(d)
        load_files(d)

    # ---- engine answer: call site -> set of target identities ----
    engine_targets = defaultdict(set)
    engine_status = {}
    for row in read_tsv(os.path.join(out_dir, 'call-chain-edges.csv'), header=False):
        ce, _caller, _te, to, _prov, status, _kind = row[:7]
        engine_status.setdefault(ce, set()).add(status)
        if to != '-' and to in meth_pos:
            f, line, col, _name, root = meth_pos[to]
            engine_targets[ce].add(resolved_ident(root, f, line, col))

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
        oracle[key] = (rp(tf) if tf else tf, tl, tc, tkind, row[6], row[5], ocount, oidx)

    # ── apply the production filter to BOTH SIDES, before anything is counted ───
    # Both sides or neither. Dropping test rows from the oracle alone would move every
    # surviving IR site into NO_ORACLE_ROW and leave the conservation figure describing
    # a population the report no longer scores.
    if production_only:
        ora_all, ir_all = len(oracle), len(call_pos)
        oracle = {k: v for k, v in oracle.items() if not is_test_path(k[0])}
        call_pos = {c: v for c, v in call_pos.items() if not is_test_path(v[0])}
        print(f'production filter            oracle {ora_all} -> {len(oracle)}   '
              f'IR {ir_all} -> {len(call_pos)}')
        if not oracle:
            print()
            print('REFUSING TO REPORT: the production filter left NO call sites.')
            print('  Every site this project declares is under a test, docs or example '
                  'path, so there is')
            print('  nothing here to measure a call graph over. That is a fact about the '
                  'project, not a score.')
            sys.stdout.flush()
            sys.exit(5)

    # ── which body implements which signature, per the compiler ─────────────
    # `ground-truth/signature-impls.mjs` asks `getContextualType` of every function-like
    # and records the signature declarations that type is made of. So
    #
    #     const setState: Api<S>['setState'] = (...a) => { ... }
    #
    # yields (that arrow) -> (the call signatures in the type literal it is annotated
    # with), across files and through an indexed-access type, which no join over the
    # IR's own type-reference links can follow. Keyed the way every other target here is
    # keyed: resolved path, line, column.
    impl_sigs = defaultdict(set)
    if sig_impls_path and os.path.exists(sig_impls_path):
        for row in read_tsv(sig_impls_path):
            if len(row) < 6:
                continue
            impl_sigs[(rp(row[0]), row[1], row[2])].add((rp(row[3]), row[4], row[5]))

    # ---- overload siblings, from the compiler's MERGED symbol ----
    # `ground-truth/overload-siblings.mjs` groups the declarations the language considers
    # one callable. `declarationGroupKey` cannot: the parser populates it for
    # FUNCTION_DECLARATION and for nothing else, so an overloaded class METHOD (3,272 rows
    # on one project) and every signature kind are invisible to _same_group. #310.
    pos_sibling = {}
    if sibs_path and os.path.exists(sibs_path):
        for row in read_tsv(sibs_path):
            if len(row) < 4:
                continue
            pos_sibling[(rp(row[0]), row[1], row[2])] = row[3]

    # A declaration with NO BODY: it describes a callable, it is not one.
    bodiless_kinds = {
        'METHOD_SIGNATURE', 'TYPE_LITERAL_METHOD_SIGNATURE', 'CALL_SIGNATURE',
        'TYPE_LITERAL_CALL_SIGNATURE', 'FUNCTION_TYPE_SIGNATURE',
        'CONSTRUCT_SIGNATURE', 'TYPE_LITERAL_CONSTRUCT_SIGNATURE',
        'CONSTRUCTOR_TYPE_SIGNATURE',
    }
    implementation_kinds = {
        'OBJECT_LITERAL_METHOD', 'METHOD_DECLARATION', 'FUNCTION_DECLARATION',
        'FUNCTION_EXPRESSION', 'ARROW_FUNCTION', 'GETTER', 'SETTER', 'CONSTRUCTOR',
    }

    def _implements_signature(otarget, eng):
        # ROUTE 1 FIRST, AND WITHOUT CONSULTING pos_meta. The pair comes from the
        # compiler, and `signature-impls.mjs` now emits a pair only when the target
        # declaration HAS NO BODY — the same thing the bodiless_kinds gate below
        # establishes, certified where the AST is in hand rather than inferred from the
        # IR.
        #
        # That matters because the gate cannot be applied to a target the IR DOES NOT
        # CONTAIN, and a monorepo's own package is routinely that case: the harness
        # stages the built .d.ts from node_modules while the compiler names the package
        # SOURCE, so `pos_meta.get(otarget)` is None and the route returned False before
        # it ever looked at the pair. Measured on a held-out member: 3 WRONG rows whose
        # pairs were all present and all discarded here. See #400.
        for t in eng:
            if otarget in impl_sigs.get(t, ()):
                return True
        om = pos_meta.get(otarget)
        if not om or om[1] not in bodiless_kinds:
            return False
        # SAME FILE is required, not merely the same name. A name match alone would let
        # any unrelated `push` or `get` in the program answer for an interface member,
        # which manufactures agreement instead of measuring it. Every case observed in
        # the corpus is same-file, so this costs nothing and cannot over-credit.
        # Route 1 (the compiler said so, #237) is applied above, before the gate.
        # ROUTE 2 — same name, same file. Kept rather than replaced: it credits a
        # class or object-literal member against an interface member, which route 1
        # does not reach (a member's type is not contextual). It fires zero times on
        # every dev corpus member as measured, so there was nothing to gain by
        # disturbing it and something to lose.
        for t in eng:
            em = pos_meta.get(t)
            if em and em[0] == om[0] and em[1] in implementation_kinds and t[0] == otarget[0]:
                return True
        return False

    def _same_group(otarget, eng):
        og = pos_group.get(otarget)
        if og and any(pos_group.get(t) == og for t in eng):
            return True
        # The compiler's own grouping, for every kind the parser leaves keyless. Keyed on
        # the MERGED symbol, never on a name or an owner: joining `SetConstructor` or
        # `addSelect` by name would let any unrelated declaration of that name answer,
        # which manufactures the agreement this verdict exists to measure.
        sg = pos_sibling.get(otarget)
        if sg and any(pos_sibling.get(t) == sg for t in eng):
            return True
        return False

    # ---- join on position ----
    buckets = defaultdict(int)
    by_kind = defaultdict(lambda: defaultdict(int))
    wrong_examples = []
    committed = 0
    committed_wrong = 0
    hedged_wrong = 0
    hedged_sizes = []
    fan = 0
    missed_by_callee = defaultdict(int)
    missed_by_target = defaultdict(int)
    missed_rows = []

    # THE OVERLOAD SLICE. "Did the engine find the right function" and "did it find the
    # right SIGNATURE" are different questions, and only the second is hard: the schema
    # measures 77.6% of overloaded calls resolving to a NON-FIRST declaration, so an
    # engine that always took declaration 0 would score well on names and be wrong three
    # times in four exactly where it matters.
    ov = defaultdict(int)
    site_verdict = {}
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
                missed_by_target[base(o[0])] += 1
                if len(missed_rows) < 200000:
                    missed_rows.append((f, line, col, ckind, cname, base(o[0]), o[1], o[4]))
        elif otarget in eng:
            b = 'EXACT' if len(eng) == 1 else 'SOUND_SUPERSET'
        elif _implements_signature(otarget, eng):
            # tsc named a BODILESS declaration — an interface method signature, which
            # has no body and cannot run — and we named an implementation of the same
            # member. Measured: every instance in the corpus is METHOD_SIGNATURE on an
            # interface against OBJECT_LITERAL_METHOD in a literal annotated with it.
            #
            # For a CALL GRAPH ours is the better answer: the object literal's method is
            # the code that executes; the signature is a type-level assertion about it.
            # Scoring it WRONG penalised the engine for resolving THROUGH to the concrete
            # implementation, which is what a consumer of this graph wants. Kept as its
            # own verdict rather than folded into EXACT, because it remains a real
            # disagreement with the compiler about which declaration is meant.
            b = 'IMPLEMENTATION_OF_SIGNATURE'
        elif _same_group(otarget, eng):
            # Same function, different overload SIGNATURE. A correct call-graph edge
            # and an incorrect signature choice — reported as its own verdict rather
            # than folded into EXACT, because collapsing it would hide a real loss of
            # parameter and return precision that downstream inference depends on.
            b = 'OVERLOAD_SIBLING'
        else:
            b = 'WRONG'
            if len(wrong_examples) < 40:
                wrong_examples.append((f, line, col, ckind, cname, otarget, sorted(eng)[:3]))
        # The DECISIVENESS axis, orthogonal to correctness. A single confident answer
        # and a six-candidate set are both "the truth is in the set", and they are
        # worth very different amounts to anything consuming the graph — so the
        # committed answers are counted separately, right and wrong.
        if eng:
            if len(eng) == 1:
                committed += 1
                if b == 'WRONG':
                    committed_wrong += 1
            else:
                hedged_sizes.append(len(eng))
                if b == 'WRONG':
                    hedged_wrong += 1
            fan += len(eng) - 1
        # ONE verdict, computed once. The per-site dump used to re-derive its own,
        # which drifted: different labels, no OVERLOAD_SIBLING, no MISSED_UNLOCATABLE,
        # and a different synthesized rule — so the dump and the summary disagreed by
        # thousands of sites on the same run, and any analysis built on the dump was
        # measuring something the headline numbers did not.
        site_verdict[ce] = b
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
        buckets[b] for b in ('EXACT', 'SOUND_SUPERSET', 'OVERLOAD_SIBLING',
                             'IMPLEMENTATION_OF_SIGNATURE', 'WRONG',
                             'MISSED', 'MISSED_UNLOCATABLE')
    )
    right = buckets['EXACT'] + buckets['SOUND_SUPERSET']
    exact_rate = buckets['EXACT'] / decidable if decidable else 0.0
    right_rate = right / decidable if decidable else 0.0

    # ── STAGED COVERAGE — reported before any rate that depends on it ──────────
    # The Java front end found every scale figure it had ever quoted was measured
    # against a library IR covering a quarter of what the client called, and "the report
    # never said so" (#163). A site whose target declaration is in no staged file cannot
    # be resolved by any rule; counting it as MISSED charges the engine for the staging,
    # and the resulting backlog is work no rule change can do.
    #
    # This front end is far less exposed than Java's, by construction: library staging is
    # derived from the client IR's own module resolution rather than from a fixed
    # platform IR. Measured, three of four corpus projects are at 0.00-0.01%. It is
    # reported anyway, because the one that is not was at 6.22% and nothing said so.
    unstaged_sites = 0
    unstaged_files = set()
    for (tf, tl, tc, tkind, tname, ckind, oc, oi) in oracle.values():
        if tkind in ('synthesized', 'unresolved') or not tf:
            continue
        if tf not in staged_files:
            unstaged_sites += 1
            unstaged_files.add(tf)
    if unstaged_sites:
        pct = unstaged_sites / len(oracle) if oracle else 0
        print(f'TARGET NOT STAGED           {unstaged_sites:>7}   {pct:.2%} of scored sites '
              f'name a declaration in a file')
        print(f'                                      nothing staged '
              f'({len(unstaged_files)} distinct files). No rule can resolve these.')
        for f in sorted(unstaged_files)[:5]:
            print(f'    {f}')
        if pct >= 0.02:
            print('  ^ above 2%: this is a STAGING gap being charged to the engine. Read '
                  'MISSED below as')
            print('    that much too high, and fix the staging before opening an issue '
                  'against a rule.')

    # ── TARGET IDENTITY, reported because it decides what every rate below means ──
    # Sites are compared on a resolved absolute path. Under the previous basename
    # identity these keys were indistinguishable, and a site whose engine answer and
    # oracle answer merely shared a basename, line and column scored EXACT.
    collide = defaultdict(set)
    for pth, ln, cl in list(pos_meta.keys()):
        collide[(base(pth), ln, cl)].add(pth)
    ambiguous = {k: v for k, v in collide.items() if len(v) > 1}
    if ambiguous:
        print(f'target identity             {len(pos_meta)} declarations; '
              f'{len(ambiguous)} (basename,line,col) keys cover '
              f'{sum(len(v) for v in ambiguous.values())} distinct files')
        print('  ^ these are DISTINGUISHED here and were conflated before; a basename '
              'match is no longer EXACT')
    if _BAD_ROOTS:
        print()
        print(f'! REFUSING to report: {len(_BAD_ROOTS)} IR root(s) record a .source-root '
              'that does not exist.')
        for d, raw, resolved in _BAD_ROOTS[:5]:
            print(f'    {d}')
            print(f'      recorded     {raw!r}')
            print(f'      resolves to  {resolved!r}  (no such directory)')
        print('  Every declaration under such a root is keyed under a path nothing else '
              'names, so the')
        print('  join with the oracle is empty and the buckets above describe nothing. It '
              'reads as')
        print("  TARGET NOT STAGED over the client's own files, which is why this refuses "
              'rather than')
        print('  print a rate.')
        sys.exit(4)
    if _WEAK_ROOTS:
        print(f'! {len(_WEAK_ROOTS)} IR root(s) have no .source-root and fall back to a '
              f'basename identity:')
        for d in _WEAK_ROOTS[:5]:
            print(f'    {d}')
        print('  Targets in those roots can still collide. Every rate below is loose by '
              'that much.')
    print(f'call sites (parser IR)      {len(call_pos)}')
    print(f'call sites (oracle)         {len(oracle)}')
    print(f'joined on position          {matched}')

    # ── CONSERVATION ────────────────────────────────────────────────────────
    # The one invariant a score structurally cannot check: you cannot notice the
    # absence of something that was never recorded. Every rate below is computed over
    # sites the IR CONTAINS, so a site the extraction never emitted is not counted as
    # missed — it is not counted at all, and the accuracy it would have dragged down
    # simply disappears.
    #
    # This is not hypothetical. Measured on the corpus: one project reported 204 call
    # sites where the compiler saw 27,821, and scored 0.326 exact on the 0.7% that
    # survived. Two more were short by 32% and 9%. Nothing failed, because nothing
    # was looking. Borrowed from the Python suite, which gates exactly this.
    lost = len(oracle) - matched
    if lost > 0:
        pct = lost / len(oracle)
        flag = 'CONSERVATION LOSS'
        print(f'{flag:<27} {lost:>7}   {pct:.1%} of the compiler\'s sites are absent '
              f'from the IR and are NOT in any figure below')
        if pct >= 0.02:
            print('  ^ above 2%: treat every rate in this report as unsound until the '
                  'extraction covers the project')
        # PAST A POINT, "unsound" is not a caveat -- it is the absence of a measurement,
        # and printing a page of 0.000 rates below it invites someone to read them as
        # results. Measured cause on the one project that hit this: on a workspace
        # repository the IR's `filePath` is relative to each package with no package
        # qualifier, so two packages' `src/Project.ts` are indistinguishable and nothing
        # joins. That is an extraction defect, not a low score.
        #
        # Same principle as the oracle guards: a missing measurement must not read as a
        # passing one. Exit non-zero so a driver cannot record the run as a success.
        if pct >= 0.5:
            print()
            print(f'REFUSING TO REPORT: {pct:.0%} of the compiler\'s call sites are absent '
                  f'from the IR.')
            print('  Nothing below is a measurement of the engine -- the two sides are not '
                  'describing the same program.')
            print('  On a workspace repository this is usually the IR carrying paths '
                  'relative to each package')
            print('  with no package qualifier, so distinct files collide on one key.')
            sys.stdout.flush()
            sys.exit(4)
    print()
    for b in (
        'EXACT', 'SOUND_SUPERSET', 'OVERLOAD_SIBLING', 'IMPLEMENTATION_OF_SIGNATURE',
        'WRONG', 'MISSED', 'MISSED_UNLOCATABLE',
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

    # ── PRECISION vs RECALL, and the decisiveness split ─────────────────────
    # `target in engine set` above is recall over POSSIBILITIES: it counts a site as
    # answered when the truth is anywhere in the set, however large. That is the right
    # number for "can a consumer find the callee", and the wrong one for "can a
    # consumer trust the callee", so both are reported rather than one standing in for
    # the other.
    answered = (buckets['EXACT'] + buckets['SOUND_SUPERSET']
                + buckets['OVERLOAD_SIBLING'] + buckets['IMPLEMENTATION_OF_SIGNATURE']
                + buckets['WRONG'])
    hedged = len(hedged_sizes)
    committed_right = buckets['EXACT']
    print('precision / recall:')
    print(f'  coverage      (answered / decidable)      {answered:>7}   '
          f'{answered / decidable if decidable else 0:.3f}')
    print(f'  recall-any    (truth anywhere in the set) {right:>7}   '
          f'{right_rate:.3f}')
    print(f'  precision     (truth in set | answered)   {right:>7}   '
          f'{right / answered if answered else 0:.3f}')
    print(f'  decisiveness  (single answer | answered)  {committed:>7}   '
          f'{committed / answered if answered else 0:.3f}')
    # THE TRUST NUMBER. When the engine commits to exactly one target, how often is it
    # right? A rule that converts hedged sets into confident guesses moves recall not
    # at all and moves this sharply, which is the trade the prune-only discipline
    # exists to refuse.
    print(f'  commit-accuracy (right | single answer)   {committed_right:>7}   '
          f'{committed_right / committed if committed else 0:.3f}')
    print(f'    committed and WRONG                     {committed_wrong:>7}')
    print(f'    hedged and wrong                        {hedged_wrong:>7}')
    if hedged_sizes:
        srt = sorted(hedged_sizes)
        mean = sum(srt) / len(srt)
        med = srt[len(srt) // 2]
        p90 = srt[min(len(srt) - 1, int(len(srt) * 0.9))]
        print(f'  ambiguity     (hedged sites)              {hedged:>7}   '
              f'mean {mean:.2f}  median {med}  p90 {p90}  max {srt[-1]}')
    # What a call-graph consumer actually pays: every extra candidate is a false edge.
    print(f'  edge-precision (TP / (TP+FP), FP = extras) {right:>6}   '
          f'{right / (right + fan) if (right + fan) else 0:.3f}')
    print()
    # ── SIGNATURE-level vs EDGE-level ───────────────────────────────────────
    # Every rate above is SIGNATURE-level: it asks whether the engine named the exact
    # declaration the compiler chose. For a CALL GRAPH that is stricter than the truth,
    # because TypeScript overloads are compile-time only — N signatures share ONE
    # implementation, so reaching any sibling reaches the same code. Both are reported
    # because they answer different questions and neither substitutes for the other:
    # signature accuracy governs parameter and return precision, edge accuracy governs
    # whether the call graph points at the right function.
    sib = buckets['OVERLOAD_SIBLING']
    impl = buckets['IMPLEMENTATION_OF_SIGNATURE']
    edge_right = right + sib + impl
    print('signature-level vs edge-level:')
    print(f'  signature-correct (exact declaration)     {right:>7}   '
          f'{right_rate:.3f}')
    print(f'  overload sibling (same function)          {sib:>7}')
    print(f'  implementation of tsc\'s signature        {impl:>7}')
    print(f'  edge-correct      (right function)        {edge_right:>7}   '
          f'{edge_right / decidable if decidable else 0:.3f}')
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
        joined_sites = 0
        cha_total = rta_total = 0
        outside_cha = []
        # ── WHAT AN EDGE OUTSIDE THE ENVELOPE ACTUALLY LICENSES (#242) ──────
        # This line used to read `demonstrable false positives`, and for a receiver
        # whose type is a class that is exactly right: the envelope enumerated every
        # assignable class, so a target outside it cannot be the runtime receiver.
        #
        # For everything else it claims more than the bound can carry. A global has no
        # receiver to enumerate over, and a member on a library interface is bounded
        # only by the declarations of the resolved symbol — so `outside` there means
        # "a declaration this symbol does not have", which is weaker than "fabricated".
        # Measured on a dev project, every outside-envelope edge was one of:
        #
        #   ErrorConstructor's CALL signature where the compiler named its CONSTRUCT
        #   signature; Function#apply where the compiler named CallableFunction#apply.
        #
        # Both are over-approximation within one entity, which SCORING §4 separates
        # from fabrication precisely because the difference is the informative part. A
        # reader taking the old label at face value would have counted them as
        # fabrications, so the decomposition below is printed instead of one total.
        outside_by_verdict = defaultdict(int)
        outside_decl_target = 0
        for ce, (f, line, col, eline, ecol, ckind, cname) in call_pos.items():
            e = env.get((f, line, col, eline, ecol))
            if not e:
                continue
            joined_sites += 1
            cha, rta = e
            eng = {f'{base(t[0])}:{t[1]}:{t[2]}' for t in engine_targets.get(ce, set())}
            if not cha:
                continue
            cha_total += len(cha)
            rta_total += len(rta)
            for t in eng:
                if t in cha:
                    tp_cha += 1
                else:
                    fp_cha += 1
                    verdict = site_verdict.get(ce, 'NO_ORACLE_ROW')
                    outside_by_verdict[verdict] += 1
                    # A `.d.ts` target is a DECLARATION, not a body: the envelope for
                    # one is the resolved symbol's declaration set, never a class set.
                    if t.split(':')[0].endswith('.d.ts'):
                        outside_decl_target += 1
                    if len(outside_cha) < 20:
                        outside_cha.append((f, line, col, cname, t, sorted(cha)[:2], verdict))
                if t in rta:
                    tp_rta += 1
                else:
                    fp_rta += 1
        emitted = tp_cha + fp_cha
        print()
        print('dispatch envelope (edges, not sites):')
        # A BLOCK OF ZEROES IS NOT A RESULT. If the envelope has rows and not one of them
        # joined a call site, every line below reads `0` with `precision 0.000` — which is
        # exactly what a clean split with no false positives looks like. The whole point
        # of this block is to bound false positives, so the one reading nobody can
        # distinguish from its own failure is the one it must not print silently. #341.
        if env and not joined_sites:
            print(f'  ! REFUSING to report: the envelope has {len(env)} rows and NOT ONE '
                  'joined a call site.')
            print('    The two sides are not describing the same program — most often the '
                  'site key,')
            print('    which is compared as a raw string while every target beside it is '
                  'resolved.')
            print('    The numbers below would be zeroes, and a zero here is '
                  'indistinguishable from a')
            print('    clean split. Fix the join before reading them.')
        print(f'  engine edges emitted            {emitted}')
        print(f'  inside CHA envelope             {tp_cha}   precision {tp_cha / emitted if emitted else 0:.3f}')
        print(f'  inside RTA envelope             {tp_rta}   precision {tp_rta / emitted if emitted else 0:.3f}')
        print(f'  CHA envelope size (total)       {cha_total}   recall vs CHA {tp_cha / cha_total if cha_total else 0:.3f}')
        print(f'  RTA envelope size (total)       {rta_total}   recall vs RTA {tp_rta / rta_total if rta_total else 0:.3f}')
        if outside_cha:
            print(f'  edges OUTSIDE the CHA envelope  {fp_cha}')
            print(f'    of those, the target is a .d.ts DECLARATION   {outside_decl_target}'
                  '   (bounded by the resolved symbol, not by a class set)')
            print('    by the verdict of the SITE the edge sits on:')
            for v, n in sorted(outside_by_verdict.items(), key=lambda kv: -kv[1]):
                # An outside-envelope edge on a site that already scores EXACT or
                # SOUND_SUPERSET is a SECOND declaration of an answer that is right;
                # only the WRONG rows are candidates for a fabrication.
                note = '  <- candidate fabrication' if v == 'WRONG' else ''
                print(f'      {n:>6}  {v}{note}')
            for f, line, col, cname, t, sample, verdict in outside_cha[:10]:
                print(f'    [{verdict}] {f}:{line}:{col} {cname}() -> {t}   envelope {sample}')

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
                eng = sorted(f'{base(t[0])}:{t[1]}:{t[2]}' for t in engine_targets.get(ce, set()))
                ot = f'{base(o[0])}:{o[1]}:{o[2]}'
                v = site_verdict.get(ce, 'NO_ORACLE_ROW')
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
