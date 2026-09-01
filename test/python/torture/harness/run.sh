#!/usr/bin/env bash
# parse both halves separately, link with --library, score per family
set -u
R="$(cd "$(dirname "$0")/.." && pwd)"
ENG="$(cd "$R/../../.." && pwd)"
PARSER="${AXIOM_PARSER:-$ENG/../Parser/dist/index.js}"
cd "$R"
python3 harness/trace.py >/dev/null 2>&1 || { echo "trace failed"; exit 1; }
rm -rf lib-ir client-ir out int
node "$PARSER" lib  torture-lib    false lib-ir    >/dev/null 2>&1
node "$PARSER" client torture-client false client-ir >/dev/null 2>&1
bash "$ENG/src/pipeline/run-souffle.sh" --language python \
     --client-ir client-ir --library lib-ir --intermediate int --output out 2>&1 | tail -2
# Java's two artifacts, same shape: the golden edge list and the oracle scorecard.
# engine_edges.py is the SUITE'S OWN normalizer (test/python/tools), not a second
# implementation -- the same fold the existing 12 cases use.
python3 ../tools/engine_edges.py client-ir out client --library lib-ir --mode golden > actual.edges 2>/dev/null
python3 harness/scorecard.py out > actual.oracle 2>&1
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
bash "$ENG/src/pipeline/run-souffle.sh" --language python \
     --client-ir client-ir --library emptylib --intermediate int-nolib --output out-nolib >/dev/null 2>&1
if ! python3 ../tools/library_monotonicity.py out-nolib out; then
  echo "FAIL (library monotonicity)"; rm -rf out-nolib int-nolib emptylib; exit 1
fi
python3 ../tools/library_monotonicity.py out-nolib out
rm -rf out-nolib int-nolib emptylib

# ── the SAME invariant against a STUB library ────────────────────────────────
# The first version of this guard ran only against a source-parsed library, and that is
# how the construction hole in the floor survived: the classes involved are C-implemented,
# so a source parse omits them, they stay external, and they keep their name. A stub
# library declares them, which is what exposes the gap. One library input does not
# exercise the boundary logic; two do.
if [ -d "${AXIOM_STUB_IR:-}" ]; then
  bash "$ENG/src/pipeline/run-souffle.sh" --language python \
       --client-ir client-ir --library "$AXIOM_STUB_IR" \
       --intermediate int-stub --output out-stub >/dev/null 2>&1
  if ! python3 ../tools/library_monotonicity.py out-nolib-stub out-stub 2>/dev/null; then :; fi
  mkdir -p emptylib2
  bash "$ENG/src/pipeline/run-souffle.sh" --language python \
       --client-ir client-ir --library emptylib2 \
       --intermediate int-nolib2 --output out-nolib2 >/dev/null 2>&1
  if ! python3 ../tools/library_monotonicity.py out-nolib2 out-stub; then
    echo "FAIL (library monotonicity, stub library)"; rm -rf out-stub int-stub out-nolib2 int-nolib2 emptylib2; exit 1
  fi
  python3 ../tools/library_monotonicity.py out-nolib2 out-stub
  rm -rf out-stub int-stub out-nolib2 int-nolib2 emptylib2
fi

python3 harness/score.py out > actual.txt 2>&1
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
