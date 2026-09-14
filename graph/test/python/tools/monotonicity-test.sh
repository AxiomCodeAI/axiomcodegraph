#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# THE LIBRARY INVARIANT HAS TWO CLAUSES AND ONLY ONE WAS CHECKED.
#
# `library_monotonicity.py` states that staging a library can only move a site "from
# unresolved to resolved, OR FROM A NAMED BOUNDARY TO A CONCRETE TARGET". It compared
# bucket membership — `resolved_sites(empty) - resolved_sites(real)` over a RESOLVED set
# collapsing `known_edge`, `multi_inferred` and `boundary_lib` — so every movement WITHIN
# that set was invisible, including movement in the forbidden direction. Measured on three
# library configurations, it printed `library monotonicity ok` while:
#
#     external:Model.save      ->  lib:m.save         (the client's own parameter)
#     external:Engine.connect  ->  lib:e.connect      (the client's own local)
#     external:build_cache.get ->  lib:get            (qualifier dropped)
#     external:make_engine     ->  PY_METHOD_<hash>   (a .pyi declaration, bodyIsStub)
#
# All four stayed `boundary_lib`, so `lost` was empty. See issue #313.
#
# ── WHY THE CONTROLS ARE THE LOAD-BEARING HALF ──────────────────────────────
# This tightens a gate, and the failure mode of tightening one is a false red on ordinary
# work. The torture set moves 88 sites on a HEALTHY run — every one an upgrade — so an
# over-eager rank would fail the suite immediately. FOUR of the nine checks are that, and
# they hold both before and after this change: an upgrade passes, a lateral move passes, an
# unchanged run passes, and clause 1 still fires.
#
# The rank is deliberately coarse for the same reason. It cannot catch
# `external:Model.save -> lib:m.save`, which is qualified on both sides; telling a type
# from a parameter needs the IR's type names, not a prefix. That is an engine defect and
# is filed as one — asserted here as a KNOWN LIMIT so nobody assumes coverage it does not
# have.
#
# SYNTHESISED EXPORTS — two TSV files and a methods CSV. No parser, no engine, no solver.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOL="$HERE/library_monotonicity.py"

if [ ! -f "$TOOL" ]; then
  echo "  FAIL  tools/library_monotonicity.py is missing; the 'passes' checks below would"
  echo "        all pass vacuously against a tool that cannot run"
  echo "monotonicity: FAILED (1 check)"
  exit 1
fi

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${MONOTONICITY_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

# edges <dir> <site>:<target> ...   — field 4 is the target, field 6 the status
edges() {
  local d="$W/$1"; shift
  mkdir -p "$d"
  : > "$d/call-chain-edges.csv"
  local pair site tgt
  for pair in "$@"; do
    site="${pair%%:*}"; tgt="${pair#*:}"
    printf '%s\tCALLER\tTE\t%s\tprov\tboundary_lib\tSIMPLE_CALL\n' "$site" "$tgt" >> "$d/call-chain-edges.csv"
  done
}
# an IR whose only content is the bodyIsStub column the tool reads
ir_with_stub() {
  local d="$W/$1" stubhash="$2"
  mkdir -p "$d"
  printf 'name\tbodyIsStub\tpyMethodUniqueHash\n' > "$d/all-python-methods.csv"
  printf 'concrete\tfalse\tPY_METHOD_aaa\n'       >> "$d/all-python-methods.csv"
  [ -n "$stubhash" ] && printf 'declared\ttrue\t%s\n' "$stubhash" >> "$d/all-python-methods.csv"
}
run() { python3 "$TOOL" "$W/$1" "$W/$2" ${3:+"$W/$3"} > "$W/out.txt" 2>&1; echo $?; }

# ── 1. A DOWNGRADE FAILS. concrete method -> a bare name. ───────────────────
edges d1a S1:PY_METHOD_aaa
edges d1b S1:external:save
if [ "$(run d1a d1b)" != "0" ] && grep -q 'LESS identifiable' "$W/out.txt"; then
  ok 'a concrete target degrading to a name fails'
else
  bad "a concrete -> name downgrade passed: $(head -2 "$W/out.txt" | tr '\n' ' ')"
fi

# ── 2. A QUALIFIER BEING DROPPED FAILS. external:X.y -> external:y ──────────
edges d2a S1:external:build_cache.get
edges d2b S1:external:get
if [ "$(run d2a d2b)" != "0" ] && grep -q 'LESS identifiable' "$W/out.txt"; then
  ok 'a qualified name degrading to a bare name fails'
else
  bad 'dropping the qualifier passed'
fi

# ── 3. ACQUIRING A BODYLESS TARGET FAILS, even though the rank goes UP. ─────
# `external:make_engine` -> a .pyi declaration is rank 1 -> 3, so the rank alone calls it
# an upgrade; the bodyIsStub clause is the only thing that catches it.
ir_with_stub ir1 PY_METHOD_stub
edges d3a S1:external:make_engine
edges d3b S1:PY_METHOD_stub
if [ "$(run d3a d3b ir1)" != "0" ] && grep -q 'body is `...`' "$W/out.txt"; then
  ok 'acquiring a target whose body is `...` fails despite the rank rising'
else
  bad "a stub-bodied target was accepted: $(head -2 "$W/out.txt" | tr '\n' ' ')"
fi

# ── 4. CONTROL — AN UPGRADE PASSES. The torture set does this 88 times. ─────
edges d4a S1:external:Leaf.via_super
edges d4b S1:PY_METHOD_aaa
if [ "$(run d4a d4b ir1)" = "0" ]; then
  ok 'control: a name resolving to a concrete method passes'
else
  bad "control: an ordinary UPGRADE was failed — this reddens the suite: $(head -2 "$W/out.txt" | tr '\n' ' ')"
fi

# ── 5. CONTROL — A LATERAL MOVE PASSES. Same rank, different string. The ────
# target convention is not written down, so a lateral move must not be a verdict.
edges d5a S1:external:tlib.NotExported
edges d5b S1:lib:tlib.NotExported
if [ "$(run d5a d5b ir1)" = "0" ]; then
  ok 'control: a lateral move at the same rank passes'
else
  bad 'control: a lateral move was failed — the rank is asserting an unstated convention'
fi

# ── 6. CONTROL — CLAUSE 1 STILL FIRES. A site losing its answer entirely. ───
edges d6a S1:PY_METHOD_aaa S2:PY_METHOD_aaa
edges d6b S1:PY_METHOD_aaa
if [ "$(run d6a d6b ir1)" != "0" ] && grep -q 'became unresolved' "$W/out.txt"; then
  ok 'control: a site losing its answer still fails (clause 1)'
else
  bad 'control: clause 1 stopped working while clause 2 was added'
fi

# ── 7. CONTROL — NO MOVEMENT PASSES QUIETLY. ───────────────────────────────
edges d7a S1:PY_METHOD_aaa
edges d7b S1:PY_METHOD_aaa
if [ "$(run d7a d7b ir1)" = "0" ]; then
  ok 'control: an unchanged run passes'
else
  bad 'control: an unchanged run was failed'
fi
# And it SAYS nothing moved. Separate from the control above on purpose: passing an
# unchanged run is behaviour that must not change, whereas naming the movement count is
# new output, and folding the two together would have made this look like a control
# failing on origin/main when the behaviour there is in fact correct.
if grep -q '0 moved' "$W/out.txt"; then
  ok 'the report names the movement count'
else
  bad 'the report does not name how many sites moved'
fi

# ── 8. THE bodyIsStub CLAUSE CANNOT SKIP IN SILENCE. Without an IR it has ───
# nothing to check, and that has to be said or the gate looks stronger than it is.
edges d8a S1:external:make_engine
edges d8b S1:PY_METHOD_stub
if [ "$(run d8a d8b)" = "0" ] && grep -q 'bodyIsStub clause was NOT checked' "$W/out.txt"; then
  ok 'with no IR given, the bodyIsStub clause says it was skipped'
else
  bad 'the bodyIsStub clause skipped without saying so'
fi

if [ "$fail" -ne 0 ]; then
  echo "monotonicity: FAILED ($checks checks)"
  exit 1
fi
echo "monotonicity: ok ($checks checks)"
