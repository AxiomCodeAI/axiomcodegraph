#!/usr/bin/env bash
# A REAL APPLICATION with its REAL DEPENDENCIES, three ways.
#
# An HTTP service on express (routes, a param handler, middleware, an error handler, an
# EventEmitter-backed store, async handlers, lodash, debug). `npm ci` installs the pinned
# dependency tree; every package under node_modules is parsed IN PLACE and staged as
# --library; the app is then exercised end to end under the runtime tracer with
# node_modules instrumented too, so the edges FROM express INTO the app's handlers are
# recorded and scored — the indirection a framework hides is exactly what this checks.
#
# Usage: run.sh [work-dir] [--dump]     (needs network for `npm ci` on first use)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
PARSER="${AXIOM_PARSER:-$ROOT/parser/dist/index.js}"
W="${1:-$HERE/.work}"; case "$W" in --*) W="$HERE/.work";; esac
rm -rf "$W"; mkdir -p "$W/ir" "$W/libir" "$W/int" "$W/out"
if [ ! -d "$HERE/node_modules/express" ]; then
  (cd "$HERE" && npm ci --no-audit --no-fund > "$W/npm.log" 2>&1) || { echo "SKIP: npm ci failed (offline?) — see $W/npm.log"; exit 77; }
fi
node "$PARSER" "$HERE" realapp false "$W/ir" > "$W/parse.log" 2>&1 || { tail -3 "$W/parse.log"; exit 1; }
LIBS=""; n=0
for pkg in $(ls "$HERE/node_modules" | grep -v '^\.'); do
  d="$HERE/node_modules/$pkg"; [ -f "$d/package.json" ] || continue
  node "$PARSER" "$d" "lib-$pkg" false "$W/libir/$pkg" > /dev/null 2>&1 || true
  [ -s "$W/libir/$pkg/all-javascript-modules.csv" ] && { LIBS="$LIBS,$W/libir/$pkg"; n=$((n+1)); }
done
LIBS="${LIBS#,}"
echo "app: $(($(wc -l < "$W/ir/all-javascript-call-sites.csv")-1)) sites; $n packages staged as --library"
bash "$ROOT/graph/pipeline/run-souffle.sh" --debug --language javascript --client-ir "$W/ir" --library "$LIBS" \
  --intermediate "$W/int" --output "$W/out" > "$W/solve.log" 2>&1 || { tail -5 "$W/solve.log"; exit 1; }
grep -E "^Elapsed" "$W/solve.log"
python3 "$HERE/../tools/coverage_guard.py" "$W/ir" "$W/out/raw" || exit 1
echo "── compiler (per site; node_modules present, so tsc follows into the packages)"
node "$HERE/../ground-truth/tsc-oracle.mjs" "$HERE" "$W/oracle.tsv" > "$W/oracle.log" 2>&1
python3 "$HERE/../ground-truth/score.py" "$W/ir" "$W/out/raw" "$W/oracle.tsv" --dump="$W/score-rows.tsv" | sed -n '2,7p'
echo "── execution (per function->function edge; node_modules instrumented)"
node "$HERE/../torture/instrument.mjs" "$HERE" "$W/instrumented" "$W/edges.json" --node-modules > "$W/instrument.log" 2>&1 || { cat "$W/instrument.log"; exit 1; }
(cd "$W/instrumented" && node exercise.js > "$W/run.log" 2>&1) || { echo "the app did not run cleanly under instrumentation:"; tail -8 "$W/run.log"; exit 1; }
LIBARGS=(); for d in "$W"/libir/*/; do LIBARGS+=("--lib=${d%/}"); done
python3 "$HERE/../torture/score_runtime.py" "$W/ir" "$W/out/raw" "$W/edges.json" --root="$HERE" "${LIBARGS[@]}" --known="$HERE/known-missing.txt" "${@:2}"
