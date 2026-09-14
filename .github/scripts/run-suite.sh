#!/usr/bin/env bash
# Run one regression suite for CI and turn every way a suite can quietly not test into a
# failure: a suite that skips itself (exit 77), a sub-harness that prints SKIP, a suite that
# passed 0 cases. CI must supply what a suite wants; do not relax this to go green.
#   run-suite.sh <java|typescript|python|javascript|parser> [suite args...]
set -uo pipefail
lang="${1:?usage: run-suite.sh <java|typescript|python|javascript|parser> [args...]}"; shift
root="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$root/parser/dist/index.js" ] || { echo "::error::parser/dist/index.js is missing — npm run build did not run, and every suite would skip itself"; exit 1; }
log="$(mktemp)"
echo "── $lang suite"
"$root/bin/axiomcode" test "$lang" "$@" 2>&1 | tee "$log"
rc="${PIPESTATUS[0]}"
if [ "$rc" -eq 77 ]; then
  echo "::error::the $lang suite skipped itself (exit 77). A skipped suite is a failed gate."; exit 1
fi
if grep -qE '(^|[[:space:]])SKIP([: (]|PED)' "$log"; then
  echo "::error::a sub-harness in the $lang suite skipped instead of running:"
  grep -nE '(^|[[:space:]])SKIP([: (]|PED)' "$log" | sed 's/^/  /'
  exit 1
fi
if [ "$lang" != parser ] && grep -qE '^passed 0([^0-9]|$)|^passed 0,' "$log"; then
  echo "::error::the $lang suite passed 0 cases — it asserted nothing."; exit 1
fi
exit "$rc"
