#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# JAVA TORTURE — ten families of construct, graded against the class-file oracle.
#
# The 30-odd cases in test/java/cases each pin ONE rule. This asks a different question: given a
# project written to use everything the language offers at once, how much of it does the graph
# actually contain, and WHICH construct is the gap. A single percentage cannot answer the second
# half, so every file is one family and the score is per family.
#
# Ground truth is the client's own compiled bytecode, read with java.lang.classfile — the same
# reader the corpus-scale harness uses. The client is compiled AGAINST the stub library rather than
# with it, so `dep.*` is genuinely external and the client->library hand-off is a boundary.
#
#   AXIOM_PARSER=/path/to/parser/dist/index.js harness/run.sh [--bless]
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"
ENG="$(cd "$R/../../.." && pwd)"
TOOLS="$ENG/test/java/tools"
SHARED="$ENG/test/tools"   # language-independent checks live here (compare_runs, check_staging)
PARSER="${AXIOM_PARSER:-$ENG/../Parser/dist/index.js}"
BLESS=0; [ "${1:-}" = "--bless" ] && BLESS=1
cd "$R"
[ -f "$PARSER" ] || { echo "SKIP: no parser at $PARSER (set AXIOM_PARSER)"; exit 77; }
command -v javac >/dev/null || { echo "SKIP: no javac"; exit 77; }

rm -rf .work && mkdir -p .work/{lib-classes,client-classes,oracle-classes,emptylib}
javac -g -d .work/lib-classes $(find lib -name '*.java') 2>.work/javac.log || { echo "FAIL (javac lib)"; cat .work/javac.log; exit 1; }
javac -g -d .work/client-classes -cp .work/lib-classes $(find client -name '*.java') 2>>.work/javac.log || { echo "FAIL (javac client)"; cat .work/javac.log; exit 1; }
javac -d .work/oracle-classes "$TOOLS/ClassFileOracle.java" 2>>.work/javac.log || { echo "SKIP: ClassFileOracle needs a JDK with java.lang.classfile"; exit 77; }

# ── IR: the two halves are parsed SEPARATELY, which is what makes dep.* a library ──────────────
node "$PARSER" lib    torture-lib    false .work/lib-ir    >.work/parse-lib.log 2>&1 || { echo "FAIL (parse lib)"; exit 1; }
node "$PARSER" client torture-client false .work/client-ir >.work/parse-client.log 2>&1 || { echo "FAIL (parse client)"; exit 1; }

# ── THE LIBRARY ROOT: the stub AND the platform IR ────────────────────────────────────────────
# Staging the stub alone is not a smaller version of a real run, it is a different question. Half
# these families call java.util.List, Map and the functional interfaces; with the platform absent
# those receivers cannot be typed by ANY rule, and every one of them scores as an engine gap. That
# is the same fault the corpus harness had (#163), and it manufactures exactly the same fake
# backlog, so the platform IR is staged here too and its absence is stated rather than absorbed.
LIBROOT=".work/libroot"; mkdir -p "$LIBROOT"; ln -sfn "$(cd .work/lib-ir && pwd)" "$LIBROOT/torture-stub"
JDK_IR="${AXIOM_JDK_IR:-/Users/swapnilpaliwal/Documents/AxiomCode/jdk}"
jdk_mods=0
if [ -d "$JDK_IR" ]; then
  for d in "$JDK_IR"/*/; do
    [ -f "$d/all-types.csv" ] || continue
    ln -sfn "${d%/}" "$LIBROOT/$(basename "${d%/}")"; jdk_mods=$((jdk_mods+1))
  done
fi
if [ "$jdk_mods" = 0 ]; then
  echo "!! no platform IR at $JDK_IR — java.util.List, Map and the functional interfaces are NOT"
  echo "   staged, so every receiver typed through one of them is unresolvable by construction and"
  echo "   this score measures the staging, not the rules. Set AXIOM_JDK_IR."
fi

bash "$ENG/src/pipeline/run-souffle.sh" --client-ir .work/client-ir --library "$LIBROOT" \
     --intermediate .work/int --output .work/out >.work/solve.log 2>&1 || { echo "FAIL (solve)"; tail -5 .work/solve.log; exit 1; }

# ── no call site may vanish ────────────────────────────────────────────────────────────────────
python3 "$TOOLS/coverage_guard.py" .work/client-ir .work/out >.work/coverage.txt 2>&1 || {
  echo "FAIL (silent drop)"; sed 's/^/    /' .work/coverage.txt; exit 1; }

# ── ground truth, and the score ────────────────────────────────────────────────────────────────
java -cp .work/oracle-classes ClassFileOracle --app .work/client-classes --app-only \
     > .work/oracle.edges 2>/dev/null
python3 "$TOOLS/normalize_edges.py" .work/client-ir .work/out --client-pairs > .work/engine.pairs 2>/dev/null
python3 "$TOOLS/normalize_edges.py" .work/client-ir .work/out "$LIBROOT" > .work/actual.edges 2>/dev/null
python3 harness/score.py .work/client-ir .work/out .work/engine.pairs .work/oracle.edges > .work/actual.txt 2>&1

# ── THE SCALE SCORER, ON A PROJECT WHOSE ANSWER IS KNOWN ──────────────────────────────────────
# tools/score_scale.py produces the corpus recall figures and had no test of its own. Two defects
# lived in it undetected: it dropped constructor targets from the engine's answer while keeping
# them in the oracle's, and it decided scope by matching an ABSOLUTE path, so a checkout under a
# directory named `fixtures` scored zero. Both are invisible at corpus scale — a wrong denominator
# among tens of thousands reads exactly like a right one. Here the answer is known, so the report
# is a golden.
java -cp .work/oracle-classes ClassFileOracle --app .work/client-classes --app-only \
     > .work/scale-lb.txt 2>/dev/null
java -cp .work/oracle-classes ClassFileOracle --app .work/client-classes --app-only --envelope \
     > .work/scale-ub.txt 2>/dev/null
python3 "$TOOLS/score_scale.py" .work/client-ir .work/out .work/scale-lb.txt .work/scale-ub.txt \
     > .work/actual.scale 2>&1

# ── INVARIANT: staging a library must never REMOVE an answer ───────────────────────────────────
# Nothing else here can catch that, because every other assertion fixes the library input; a site
# that loses its answer only shows up when the two runs are compared to each other.
bash "$ENG/src/pipeline/run-souffle.sh" --client-ir .work/client-ir --library .work/emptylib \
     --intermediate .work/int-nolib --output .work/out-nolib >/dev/null 2>&1
if ! python3 "$SHARED/compare_runs.py" .work/out-nolib .work/out --top 5 > .work/monotonicity.txt 2>&1; then
  echo "FAIL (library monotonicity: staging the stub library removed an answer)"
  sed 's/^/    /' .work/monotonicity.txt | head -20; exit 1
fi

fail=0
for a in edges txt scale; do
  exp="expected/torture.$a"; [ "$a" = txt ] && exp="expected/coverage.txt"
  [ "$a" = scale ] && exp="expected/scale.txt"
  if [ "$BLESS" = 1 ]; then cp ".work/actual.$a" "$exp"; continue; fi
  if [ ! -f "$exp" ]; then echo "FAIL (no golden $exp — run with --bless)"; fail=1; continue; fi
  if ! diff -q "$exp" ".work/actual.$a" >/dev/null; then
    echo "FAIL ($exp changed):"; diff -u "$exp" ".work/actual.$a" | head -40; fail=1
  fi
done
[ "$BLESS" = 1 ] && { echo "BLESSED"; exit 0; }
[ "$fail" = 0 ] || exit 1
head -13 .work/actual.txt
echo "  library root: torture stub + $jdk_mods platform modules"
echo "  library monotonicity: $(grep -E 'had an answer, now has none' .work/monotonicity.txt | tr -s ' ')"
