#!/usr/bin/env bash
# The torture project, three ways: the engine, the compiler, and EXECUTION.
#   parse -> solve -> (a) tsc per-site score  (b) instrument + run -> executed edges vs the graph
# Usage: run.sh [work-dir]
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
PARSER="${AXIOM_PARSER:-$ROOT/parser/dist/index.js}"
W="${1:-$HERE/.work}"; rm -rf "$W"; mkdir -p "$W/ir" "$W/int" "$W/out" "$W/.empty-library"
node "$PARSER" "$HERE/project" torture false "$W/ir" > "$W/parse.log" 2>&1 || { tail -3 "$W/parse.log"; exit 1; }
bash "$ROOT/graph/pipeline/run-souffle.sh" --debug --language javascript --client-ir "$W/ir" --library "$W/.empty-library" \
  --intermediate "$W/int" --output "$W/out" > "$W/solve.log" 2>&1 || { tail -5 "$W/solve.log"; exit 1; }
python3 "$HERE/../tools/coverage_guard.py" "$W/ir" "$W/out/raw" || exit 1
echo "── compiler (per site)"
node "$HERE/../ground-truth/tsc-oracle.mjs" "$HERE/project" "$W/oracle.tsv" > "$W/oracle.log" 2>&1
python3 "$HERE/../ground-truth/score.py" "$W/ir" "$W/out/raw" "$W/oracle.tsv" --dump="$W/score-rows.tsv" | sed -n '2,7p'
echo "── execution (per function->function edge)"
node "$HERE/instrument.mjs" "$HERE/project" "$W/instrumented" "$W/edges.json" > "$W/instrument.log" 2>&1 || { cat "$W/instrument.log"; exit 1; }
(cd "$W/instrumented" && node main.js > "$W/run.log" 2>&1) || { echo "the torture project did not run cleanly:"; tail -5 "$W/run.log"; exit 1; }
python3 "$HERE/score_runtime.py" "$W/ir" "$W/out/raw" "$W/edges.json" --known="$HERE/known-missing.txt" "${@:2}"
