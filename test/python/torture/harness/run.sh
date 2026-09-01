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
