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
bash "$ENG/graph/pipeline/run-souffle.sh" --debug --language python \
     --client-ir client-ir --library lib-ir --intermediate int --output out 2>&1 | tail -2
# Java's two artifacts, same shape: the golden edge list and the oracle scorecard.
# engine_edges.py is the SUITE'S OWN normalizer (test/python/tools), not a second
# implementation -- the same fold the existing 12 cases use.
python3 ../tools/engine_edges.py client-ir out/raw client --library lib-ir --mode golden > actual.edges 2>/dev/null
python3 harness/scorecard.py out/raw > actual.oracle 2>&1
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
if ! mono=$(python3 ../tools/library_monotonicity.py out-nolib/raw out/raw client-ir lib-ir 2>&1); then
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
  if ! mono=$(python3 ../tools/library_monotonicity.py out-nolib2/raw out-stub/raw \
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
python3 harness/reasons.py out/raw > actual.reasons 2>&1
if [ -f expected/reasons.txt ] && ! diff -q expected/reasons.txt actual.reasons >/dev/null; then
  echo "FAIL (reasons.txt changed):"; diff -u expected/reasons.txt actual.reasons | head -30
  echo; echo "If the change is intended: cp actual.reasons expected/reasons.txt"
  rm -f actual.reasons; exit 1
fi
echo "reasons ok ($(grep -c . actual.reasons) lines, no_rule $(grep -o 'no_rule = [0-9]*' actual.reasons | head -1 | awk '{print $3}'))"
rm -f actual.reasons

python3 harness/score.py out/raw > actual.txt 2>&1
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
