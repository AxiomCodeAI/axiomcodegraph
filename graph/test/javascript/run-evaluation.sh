#!/bin/bash
# =============================================================================
# JavaScript engine evaluation — one project, end to end, reproducible.
#
#   parser IR  ->  engine  ->  tsc oracle (allowJs/checkJs)  ->  per-site score
#
# The oracle and the parser run over the SAME directory, so every position in the
# comparison is relative to one root. No library IR is staged: a JavaScript
# dependency is a package parsed from source, and which packages to stage is a
# separate decision from whether the client->client graph is right. Sites whose
# compiler answer is a `.d.ts` declaration are reported as LIB_*, apart from the
# client->client rates.
#
# Usage: run-evaluation.sh <project-dir> <work-dir> [--production]
# Env:   AXIOM_PARSER  path to the parser entrypoint
#                      (default parser/dist/index.js in this repository)
#        AXIOM_LIBRARY comma-separated library IR roots (default: none)
# =============================================================================
set -e
PROJECT="$(cd "$1" && pwd)"
mkdir -p "$2"
WORK="$(cd "$2" && pwd)"
PROD=""
case "${3:-}" in --production) PROD="--production";; esac
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
PARSER="${AXIOM_PARSER:-$REPO/parser/dist/index.js}"
[ -f "$PARSER" ] || { echo "parser not found at $PARSER (set AXIOM_PARSER)"; exit 77; }
NAME="$(basename "$PROJECT")"
LIB="${AXIOM_LIBRARY:-$WORK/.empty-library}"
mkdir -p "$WORK/ir" "$WORK/int" "$WORK/out" "$WORK/.empty-library"

echo "▶ project: $PROJECT"
echo "▶ parse"
node "$PARSER" "$PROJECT" "$NAME" false "$WORK/ir" > "$WORK/parse.log" 2>&1 || { tail -5 "$WORK/parse.log"; exit 1; }
[ -s "$WORK/ir/all-javascript-call-sites.csv" ] || { echo "no JavaScript call sites extracted — see $WORK/parse.log"; exit 1; }
echo "   $(($(wc -l < "$WORK/ir/all-javascript-call-sites.csv") - 1)) call sites, $(($(wc -l < "$WORK/ir/all-javascript-modules.csv") - 1)) modules"

echo "▶ solve"
bash "$REPO/graph/pipeline/run-souffle.sh" --debug --language javascript \
  --client-ir "$WORK/ir" --library "$LIB" --intermediate "$WORK/int" --output "$WORK/out" \
  > "$WORK/solve.log" 2>&1 || { tail -20 "$WORK/solve.log"; exit 1; }
grep -E "^Elapsed" "$WORK/solve.log" | sed 's/^/   /'

echo "▶ oracle"
node "$HERE/ground-truth/tsc-oracle.mjs" "$PROJECT" "$WORK/oracle.tsv" 2>&1 | sed 's/^/   /'

echo "▶ score $PROD"
python3 "$HERE/ground-truth/score.py" "$WORK/ir" "$WORK/out/raw" "$WORK/oracle.tsv" $PROD --dump="$WORK/score-rows.tsv" | tee "$WORK/score.txt"
