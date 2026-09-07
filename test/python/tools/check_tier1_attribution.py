#!/usr/bin/env python3
"""TIER-1 CALLEE ATTRIBUTION — assert the ground truth names the right callee.

WHY THIS EXISTS AND WHY IT IS SEPARATE FROM check_vendor.py. check_vendor asserts
the vendored copies are IDENTICAL to the harness. It cannot say whether either is
CORRECT, and tier 1 is the ground truth every other Python check is scored
against: `dis` decides what a call site is and who it calls. A defect here is not
an engine bug that a golden catches, it is a wrong expectation that every golden
then agrees with.

THE DEFECT THIS PINS. tier1_sites walks instructions LINEARLY and models the stack
with dis.stack_effect. Called without `jump=`, stack_effect returns the MAXIMAL
effect over both branches of a conditional jump, and for the short-circuit opcodes
the two differ:

    JUMP_IF_TRUE_OR_POP    jump path 0   fall-through -1   maximal 0
    JUMP_IF_FALSE_OR_POP   jump path 0   fall-through -1   maximal 0

A linear walk follows the fall-through, so the maximal effect leaves one extra
value on the modelled stack per `or` / `and` operand, and `stack[-consumed]` then
reads an ARGUMENT instead of the callee. Measured on two open-source projects
before the fix: 1,898 of 35,853 sites (5.29%) and 1,101 of 28,719 (3.83%) named
the wrong callee. `bool(self.a or self.b or self.c)` reported `b`.

IT MATTERED MOST WHERE IT WAS HARDEST TO SEE. callchain_oracle/build.py gates the
tier-3-vs-tier-4 cross-check on the callee name agreeing, and `continue`s when it
does not — so a misattributed name makes the oracle SKIP its own self-check, the
one bin/freeze.py refuses to freeze a lock past. The site COUNT was always right
(sites == CALL opcodes, exactly), so conservation never noticed.

WHY NO FIXTURE CAUGHT IT: none of the twelve cases, neither whole-project fixture
and none of the torture families contains a short-circuit operator inside a call's
argument list. The frozen locks are unchanged by the fix, which is the proof.

INTERPRETER-DEPENDENT, AND IT MUST NOT PASS VACUOUSLY. JUMP_IF_TRUE_OR_POP and
JUMP_IF_FALSE_OR_POP were REMOVED in 3.12, where `a or b` compiles to
COPY / POP_JUMP_IF_TRUE / POP_TOP whose stack effects are unconditional. So this
check cannot fail on 3.12 — running it there and reporting "ok" would be a green
tick for a defect that is live on the interpreter the oracle is PINNED to. The
first version of this file did exactly that: it passed against the unfixed copy
under python3.12 and only reproduced under python3.10, 5 of 7 sites wrong. It now
refuses rather than passes when the opcodes are absent, and run-tests.sh invokes
it with $PY (AXIOM_PY_PYTHON, default python3.10).

  usage: check_tier1_attribution.py      (needs only the vendored copy)
"""
from __future__ import annotations
import opcode
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vendor.normalize import Normalizer                       # noqa: E402
from vendor.tier1_sites import sites_for_tree                 # noqa: E402

# Each source line holds exactly ONE call, and its callee is `target`. Anything
# else tier 1 names for these lines is a misattribution.
SOURCE = '''\
def target(x):
    return x


class H:
    def __init__(self):
        self.a = 1
        self.b = 2
        self.c = 3

    def one_or(self):
        return target(self.a or self.b)

    def two_or(self):
        return target(self.a or self.b or self.c)

    def one_and(self):
        return target(self.a and self.b)

    def mixed(self):
        return target(self.a or self.b and self.c)

    def nested_in_args(self):
        return target(target(self.a or self.b))

    def plain(self):
        return target(self.a)
'''
EXPECT_CALLS = {
    'one_or': 1, 'two_or': 1, 'one_and': 1, 'mixed': 1,
    'nested_in_args': 2, 'plain': 1,
}


# The opcodes whose two branches differ in stack effect. Absent -> this check
# proves nothing on this interpreter and says so instead of reporting ok.
SHORT_CIRCUIT_POP = ('JUMP_IF_TRUE_OR_POP', 'JUMP_IF_FALSE_OR_POP')

# ── THE SECOND DEFECT: A SENTINEL, NOT A CONTAINER ───────────────────────────
# BINARY_SUBSCR consumes two slots and pushes one, but the generic fallback applied only the NET
# effect, so the CONTAINER survived in the callee slot: `TABLE["d"](n)` was attributed to `TABLE`.
# The control is one opcode away and was always right, which is what isolated it.
#
# What makes this worth a gate rather than a cosmetic label: UNKNOWN has to mean "attribution
# failed". A container name in the callee slot is neither a real callee nor an admission of
# defeat, so a consumer cannot tell "statically unnameable by construction" from "the walk
# drifted" -- and the registry-dispatch idiom is exactly where a call graph most needs to say
# which it is. The CALL_OPS path already had the answer (<call-result> / <super>); subscript now
# uses it too.
#
# PINNED, like the half above, and for a measured reason rather than a guessed one. It is tempting
# to call this interpreter-independent because BINARY_SUBSCR exists everywhere the harness supports
# — but on 3.12 the walk misattributes BOTH `TABLE["d"](n)` and the `TABLE.get("d")(n)` CONTROL,
# and the control has nothing to do with this fix. 3.11 changed LOAD_GLOBAL to push a NULL beside
# the global, so the whole slot arithmetic differs off-pin. tier 1 is simply not accurate there,
# which is what the harness means by "opcode shapes differ; numbers are not comparable" — the locks
# are 3.10. So this runs only where it means something, and says so otherwise.
SENTINEL_SOURCE = '''\
def target(x):
    return x


TABLE = {"d": target}


def via_subscript(n):
    return TABLE["d"](n)


def via_call_result(n):
    return TABLE.get("d")(n)
'''
# scope -> (the (callee, via) that MUST be present, a callee that must NOT be)
EXPECT_SENTINEL = {
    'via_subscript':   (('<subscript-result>', 'SUBSCRIPT_RESULT'), 'TABLE'),
    'via_call_result': (('<call-result>', 'CALL_RESULT'), None),
}


def check_sentinels() -> list:
    """-> list of failure strings; empty when tier 1 names a sentinel, not the container."""
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'sub.py')
        with open(p, 'w', encoding='utf-8') as fh:
            fh.write(SENTINEL_SOURCE)
        sites = [s for s in sites_for_tree(d, Normalizer(d)) if not s.implicit]
    by_scope: dict[str, list] = {}
    for s in sites:
        by_scope.setdefault(s.raw_scope, []).append(s)
    out = []
    for scope, (need, forbid) in EXPECT_SENTINEL.items():
        got = by_scope.get(scope, [])
        pairs = {(s.callee_name, s.via) for s in got}
        if need not in pairs:
            out.append(f'{scope}: expected a {need[0]} callee (via {need[1]}), tier 1 reported '
                       + ', '.join(f'{c!r} (via {v})' for c, v in sorted(pairs)))
        if forbid is not None and any(c == forbid for c, _ in pairs):
            out.append(f'{scope}: tier 1 named the CONTAINER {forbid!r} as the callee — '
                       f'BINARY_SUBSCR must pop 2 and push a named sentinel')
    return out


def main() -> int:
    if not any(o in opcode.opmap for o in SHORT_CIRCUIT_POP):
        v = sys.version_info
        print(f'tier-1 attribution: CANNOT CHECK on Python {v[0]}.{v[1]} — none of '
              f'{", ".join(SHORT_CIRCUIT_POP)} exists here, so the drift this pins is '
              f'unreachable. Run it on the interpreter the oracle pins (3.10).')
        # 77, not 1: "I could not check" and "the ground truth is wrong" must be
        # distinguishable, or a machine without 3.10 cannot run the suite at all.
        # The same code the suite already uses for a skip.
        return 77
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'sc.py')
        with open(p, 'w', encoding='utf-8') as fh:
            fh.write(SOURCE)
        sites = [s for s in sites_for_tree(d, Normalizer(d)) if not s.implicit]

    by_scope: dict[str, list] = {}
    for s in sites:
        by_scope.setdefault(s.raw_scope, []).append(s)

    bad = []
    for scope, n in EXPECT_CALLS.items():
        got = by_scope.get(scope, [])
        if len(got) != n:
            bad.append(f'{scope}: expected {n} call site(s), tier 1 reported {len(got)}')
        for s in got:
            if s.callee_name != 'target':
                bad.append(f'{scope}: callee should be "target", tier 1 says '
                           f'{s.callee_name!r} (via {s.via}) — the modelled stack drifted')

    sentinel_bad = check_sentinels()

    if bad or sentinel_bad:
        print('tier-1 attribution: FAIL — the ground truth names the wrong callee')
        for b in bad + sentinel_bad:
            print(f'   {b}')
        # Name the fix that matches the failure, rather than one hint for two defects.
        if bad:
            print('   dis.stack_effect must be called with jump=False; see this file\'s docstring.')
        if sentinel_bad:
            print('   BINARY_SUBSCR must pop the two consumed slots and push a named sentinel,')
            print('   the way CALL_OPS already does; see this file\'s docstring.')
        return 1
    print(f'tier-1 attribution ok ({len(sites)} sites, callee correct on every '
          f'short-circuit shape, and a subscript callee is a sentinel not its container)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
