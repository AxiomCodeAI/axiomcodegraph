#!/usr/bin/env bash
# The torture projects, three ways: the engine, the compiler, and EXECUTION.
#   parse -> solve -> (a) tsc per-site score, GATED on known-compiler.txt
#                  -> (b) instrument + run -> executed edges vs the graph, GATED on known-missing.txt
# Two programs: `project/` (CommonJS) and `esm/` (an ES module package: every export and
# re-export form, a default-exported class, dynamic import(), top-level await, CommonJS
# interop through a default import and createRequire). Each carries its own known lists.
# Usage: run.sh [work-dir] [--dump]
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
PARSER="${AXIOM_PARSER:-$ROOT/parser/dist/index.js}"
WBASE="${1:-$HERE/.work}"; case "$WBASE" in --*) WBASE="$HERE/.work";; esac
rc=0
run_one() {
  local name="$1" W="$WBASE/$1"
  echo "══ $name"
  rm -rf "$W"; mkdir -p "$W/ir" "$W/int" "$W/out" "$W/.empty-library"
  node "$PARSER" "$HERE/$name" "torture-$name" false "$W/ir" > "$W/parse.log" 2>&1 || { tail -3 "$W/parse.log"; return 1; }
  bash "$ROOT/graph/pipeline/run-souffle.sh" --debug --language javascript --client-ir "$W/ir" --library "$W/.empty-library" \
    --intermediate "$W/int" --output "$W/out" > "$W/solve.log" 2>&1 || { tail -5 "$W/solve.log"; return 1; }
  python3 "$HERE/../tools/coverage_guard.py" "$W/ir" "$W/out/raw" || return 1
  echo "── compiler (per site)"
  node "$HERE/../ground-truth/tsc-oracle.mjs" "$HERE/$name" "$W/oracle.tsv" > "$W/oracle.log" 2>&1
  python3 "$HERE/../ground-truth/score.py" "$W/ir" "$W/out/raw" "$W/oracle.tsv" --dump="$W/score-rows.tsv" | sed -n '2,7p'
  # The compiler's verdicts GATE the run, as they do per case in run-tests.sh: a MISSED or
  # WRONG site not listed in known-compiler.txt fails, and a listed one that starts agreeing
  # fails too. Before this the verdicts were printed and the run passed whatever they said.
  python3 "$HERE/../tools/oracle_diff.py" "$W/ir" "$W/out/raw" "$W/oracle.tsv" "$W/score-rows.tsv" > "$W/actual.oracle"
  python3 "$HERE/../tools/oracle_gate.py" "$W/actual.oracle" "$HERE/$name.known-compiler.txt" || return 1
  echo "── execution (per function->function edge)"
  node "$HERE/instrument.mjs" "$HERE/$name" "$W/instrumented" "$W/edges.json" > "$W/instrument.log" 2>&1 || { cat "$W/instrument.log"; return 1; }
  (cd "$W/instrumented" && node main.js > "$W/run.log" 2>&1) || { echo "the $name project did not run cleanly:"; tail -5 "$W/run.log"; return 1; }
  python3 "$HERE/score_runtime.py" "$W/ir" "$W/out/raw" "$W/edges.json" --known="$HERE/$name.known-missing.txt" "${@:2}"
}
run_one project "${@:2}" || rc=1
run_one esm "${@:2}" || rc=1
exit $rc
