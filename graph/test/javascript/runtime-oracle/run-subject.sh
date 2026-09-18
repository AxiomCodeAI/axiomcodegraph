#!/bin/bash
# =============================================================================
# One subject, end to end: what the engine says, beside what the program did.
#
#   trace-subject.sh   mirror + instrument + run the project's own suite
#   aggregate.py       per-worker traces -> one answer per call site
#   bin/axiomcode      the ORIGINAL tree (never the mirror) -> graph.sqlite
#   join.py            the two, per site, bucketed
#
# The graph is built from the original checkout on purpose: the mirror carries
# the tracer's own calls, and an engine run over it would be scoring a program
# that does not exist.
#
# Usage: run-subject.sh <project-dir> <work-dir> [<test-command>]
# =============================================================================
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
PROJECT="$(cd "$1" && pwd)"
mkdir -p "$2"; WORK="$(cd "$2" && pwd)"
NAME="$(basename "$PROJECT")"

bash "$HERE/trace-subject.sh" "$PROJECT" "$WORK" ${3+"$3"}
python3 "$HERE/aggregate.py" "$WORK"

echo "▶ $NAME: the engine"
bash "$ROOT/bin/axiomcode" "$PROJECT" "$WORK/graph" --language javascript > "$WORK/engine.log" 2>&1 \
  || { tail -20 "$WORK/engine.log"; exit 1; }
DB="$WORK/graph/javascript/graph.sqlite"
[ -f "$DB" ] || { echo "no graph.sqlite at $DB — see $WORK/engine.log"; exit 1; }

echo "▶ $NAME: the join"
python3 "$HERE/join.py" "$WORK" "$DB" --production | tee "$WORK/join.txt"
