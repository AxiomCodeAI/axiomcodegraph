#!/usr/bin/env bash
# parse both halves separately, link with --library, score per family
set -u
R="$(cd "$(dirname "$0")/.." && pwd)"
ENG="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"  # the repository root, found by its marker — no level counting
PARSER="${AXIOM_PARSER:-$ENG/parser/dist/index.js}"
cd "$R"

# ── THE INTERPRETER THE TIER-4 TRACE NEEDS, RESOLVED RATHER THAN ASSUMED ─────
# This harness used to call bare `python3` and throw its stderr away, so any failure
# at all read as the single line "trace failed".
#
# THE FLOOR IS 3.11 AND IT IS NOT THE SUITE'S PIN. `client/f27_with_target.py` does
# `from typing import Self`, added in 3.11, while run-tests.sh pins 3.10 for the tier-1
# opcode model (opcode shapes are not stable across minor versions). Tier 4 observes
# FRAMES, not opcodes, so it is free to use a newer interpreter -- but nothing said so,
# and on any machine whose `python3` is older (stock macOS ships 3.9, and the suite's own
# pinned 3.10 is older too) the only library-linking case in the Python suite failed with
# a message naming neither Python nor a version.
#
# gt-tier4.json is gitignored and regenerated here, so there is no committed ground truth
# to fall back on: without an interpreter this case cannot be scored at all. It is
# therefore a SKIP with a stated reason (exit 77, the convention run-tests.sh already uses
# for a missing parser), never a silent pass and never a misattributed failure.
TORTURE_FLOOR_MAJOR=3
TORTURE_FLOOR_MINOR=11
# The candidate list is DERIVED FROM THE FLOOR rather than written out, so lowering or
# raising TORTURE_FLOOR_MINOR needs one edit and not two. Written out, the list silently
# stopped matching the floor the moment either moved.
#
# EVERY CANDIDATE IS RUN, never merely located. `command -v` succeeds for a DANGLING
# SYMLINK -- this machine has a python3.13 that `ls` and `command -v` both report and
# that cannot exec -- so the version test is what decides, and a broken install is
# skipped rather than chosen.
find_trace_python() {
  local c p m
  for c in "${AXIOM_PY_TORTURE_PYTHON:-}" $(for m in $(seq 20 -1 "$TORTURE_FLOOR_MINOR"); do printf 'python%s.%s ' "$TORTURE_FLOOR_MAJOR" "$m"; done) python3; do
    [ -n "$c" ] || continue
    p="$(command -v "$c" 2>/dev/null)" || continue
    [ -n "$p" ] || continue
    if "$p" -c "import sys; raise SystemExit(0 if sys.version_info >= ($TORTURE_FLOOR_MAJOR, $TORTURE_FLOOR_MINOR) else 1)" 2>/dev/null; then
      printf '%s\n' "$p"; return 0
    fi
  done
  return 1
}
if ! PY="$(find_trace_python)"; then
  echo "SKIP: the tier-4 trace needs Python >= $TORTURE_FLOOR_MAJOR.$TORTURE_FLOOR_MINOR"
  echo "      (client/f27_with_target.py imports typing.Self); none found on PATH."
  echo "      Set AXIOM_PY_TORTURE_PYTHON to one. The suite's pinned 3.10 is for tier 1 and is too old for this."
  exit 77
fi
if ! trace_err="$("$PY" harness/trace.py 2>&1 >/dev/null)"; then
  echo "trace failed under $PY:"
  printf '%s\n' "$trace_err" | tail -12 | sed 's/^/    /'
  exit 1
fi
rm -rf lib-ir client-ir out int
node "$PARSER" lib  torture-lib    false lib-ir    >/dev/null 2>&1
node "$PARSER" client torture-client false client-ir >/dev/null 2>&1
bash "$ENG/graph/pipeline/run-souffle.sh" --debug --language python \
     --client-ir client-ir --library lib-ir --intermediate int --output out 2>&1 | tail -2
# Java's two artifacts, same shape: the golden edge list and the oracle scorecard.
# engine_edges.py is the SUITE'S OWN normalizer (test/python/tools), not a second
# implementation -- the same fold the existing 12 cases use.
"$PY" ../tools/engine_edges.py client-ir out/raw client --library lib-ir --mode golden > actual.edges 2>/dev/null
"$PY" harness/scorecard.py out/raw > actual.oracle 2>&1
for a in edges oracle; do
  if [ -f "expected/torture.$a" ] && ! diff -q "expected/torture.$a" "actual.$a" >/dev/null; then
    echo "FAIL (torture.$a changed):"; diff -u "expected/torture.$a" "actual.$a" | head -20
    rm -f actual.edges actual.oracle; exit 1
  fi
done
echo "torture.edges ok ($(wc -l < actual.edges | tr -d ' ') edges)  torture.oracle ok ($(cat actual.oracle))"
rm -f actual.edges actual.oracle
# ── INVARIANT: supplying a library must never REMOVE an answer ───────────────
# Solve the SAME client again with an EMPTY library and compare. Nothing else in the
# suite can catch a regression here, because every other case fixes the library input;
# a site losing its answer only shows up when the two runs are compared to each other.
mkdir -p emptylib
bash "$ENG/graph/pipeline/run-souffle.sh" --debug --language python \
     --client-ir client-ir --library emptylib --intermediate int-nolib --output out-nolib >/dev/null 2>&1
# Run ONCE and reuse the output: this used to run twice, discarding the first result and
# printing the second, which doubled the report. The IR directories are passed so the
# bodyIsStub clause has something to read — without them it skips, and says so (#313).
if ! mono=$("$PY" ../tools/library_monotonicity.py out-nolib/raw out/raw client-ir lib-ir 2>&1); then
  echo "FAIL (library monotonicity)"; echo "$mono"
  rm -rf out-nolib int-nolib emptylib; exit 1
fi
echo "$mono"
rm -rf out-nolib int-nolib emptylib

# ── the SAME invariant against a STUB library ────────────────────────────────
# The first version of this guard ran only against a source-parsed library, and that is
# how the construction hole in the floor survived: the classes involved are C-implemented,
# so a source parse omits them, they stay external, and they keep their name. A stub
# library declares them, which is what exposes the gap. One library input does not
# exercise the boundary logic; two do.
if [ -d "${AXIOM_STUB_IR:-}" ]; then
  bash "$ENG/graph/pipeline/run-souffle.sh" --debug --language python \
       --client-ir client-ir --library "$AXIOM_STUB_IR" \
       --intermediate int-stub --output out-stub >/dev/null 2>&1
  # A call comparing against `out-nolib-stub` stood here. Nothing ever created that
  # directory, and its status was discarded (`2>/dev/null; then :; fi`), so it opened a
  # missing file and was swallowed on every run — a check that could not fail. The real
  # comparison is out-nolib2 vs out-stub below; removed rather than left to look like
  # coverage. Found while fixing #313.
  mkdir -p emptylib2
  bash "$ENG/graph/pipeline/run-souffle.sh" --debug --language python \
       --client-ir client-ir --library emptylib2 \
       --intermediate int-nolib2 --output out-nolib2 >/dev/null 2>&1
  if ! mono=$("$PY" ../tools/library_monotonicity.py out-nolib2/raw out-stub/raw \
                client-ir "$AXIOM_STUB_IR" 2>&1); then
    echo "FAIL (library monotonicity, stub library)"; echo "$mono"
    rm -rf out-stub int-stub out-nolib2 int-nolib2 emptylib2; exit 1
  fi
  echo "$mono"
  rm -rf out-stub int-stub out-nolib2 int-nolib2 emptylib2
fi

# ── THE REASON DISTRIBUTION ──────────────────────────────────────────────────
# Every other golden here is an edge list, so a change that alters no EDGE — which is
# what a diagnosis change is — is invisible to all of them. See harness/reasons.py.
"$PY" harness/reasons.py out/raw > actual.reasons 2>&1
if [ -f expected/reasons.txt ] && ! diff -q expected/reasons.txt actual.reasons >/dev/null; then
  echo "FAIL (reasons.txt changed):"; diff -u expected/reasons.txt actual.reasons | head -30
  echo; echo "If the change is intended: cp actual.reasons expected/reasons.txt"
  rm -f actual.reasons; exit 1
fi
echo "reasons ok ($(grep -c . actual.reasons) lines, no_rule $(grep -o 'no_rule = [0-9]*' actual.reasons | head -1 | awk '{print $3}'))"
rm -f actual.reasons

"$PY" harness/score.py out/raw > actual.txt 2>&1
cat actual.txt
if [ -f expected/coverage.txt ]; then
  if diff -u expected/coverage.txt actual.txt > /dev/null; then
    echo; echo "MATCHES expected/coverage.txt"
  else
    echo; echo "DIFFERS from expected/coverage.txt:"; diff -u expected/coverage.txt actual.txt || true
    echo; echo "If the change is intended: cp actual.txt expected/coverage.txt"
    rm -f actual.txt; exit 1
  fi
fi
rm -f actual.txt
