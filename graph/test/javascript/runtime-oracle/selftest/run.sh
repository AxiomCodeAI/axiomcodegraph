#!/bin/bash
# =============================================================================
# The tracer's own regression test: instrument selftest/src and run it.
#
# src/main.js asserts the invariants the REWRITE could break, each beside the
# control that was never at risk. It passes uninstrumented by construction, so the
# only thing this run can fail on is the instrumentation.
#
# Usage: selftest/run.sh [work-dir]
# =============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ORACLE="$(cd "$HERE/.." && pwd)"
W="${1:-$HERE/.work}"
rm -rf "$W"; mkdir -p "$W/mirror" "$W/tables" "$W/trace"
cp -R "$HERE/src/." "$W/mirror/"

node "$HERE/../instrument.mjs" --src "$W/mirror" --out "$W/mirror" --tables "$W/tables" || exit 1

echo "── uninstrumented"
node "$HERE/src/main.js" || { echo "the fixture does not pass on its own"; exit 1; }

echo "── instrumented"
AX_TRACE_OUT="$W/trace" node --require "$ORACLE/runtime.cjs" "$W/mirror/main.js" || {
  echo "the fixture fails once instrumented: the rewrite changed what the program does"
  exit 1
}

# The trace has to be non-empty, or a rewrite that instruments NOTHING would pass
# every assertion above and look identical to a correct one.
pairs="$(cat "$W"/trace/* 2>/dev/null | grep -c . || true)"
[ "${pairs:-0}" -gt 0 ] || { echo "no pairs recorded: the rewrite instrumented nothing"; exit 1; }
sites="$(($(wc -l < "$W/tables/sites.tsv") - 1))"
decls="$(($(wc -l < "$W/tables/decls.tsv") - 1))"
echo "ok — $sites sites, $decls declarations, $pairs trace lines"
