#!/usr/bin/env bash
# ── The client->library half must not quietly stop being tested ──────────────
# Most of what these suites assert is client->client. The client->library hand-off
# is carried by a smaller set of fixtures, and it is the half that disappears
# silently: delete a golden and the case still runs, still passes, and simply
# stops making the claim. Nothing in the suites notices, because a suite can only
# check the assertions it still has.
#
# So this pins the SHAPE of that coverage, and it needs no parser and no solver:
#
#   1. every TypeScript case carrying a lib/ is solved twice, and both goldens
#      exist — the delta between them IS the client->library mapping;
#   2. every Java case carrying a lib-src/ stub library still has its golden;
#   3. the counts never fall. A number here going DOWN is either a deletion that
#      wanted review, or coverage lost by accident.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

fail=0

# Floors, not targets. Raise one when real coverage is added; lowering one is a
# deliberate reduction in what this repository proves, and belongs in a diff.
TS_LIB_FLOOR=23
JAVA_LIB_FLOOR=6
PY_LIB_FLOOR=1

ts_libs=0; ts_missing=()
for d in test/typescript/cases/*/lib; do
  [ -d "$d" ] || continue
  c="$(basename "$(dirname "$d")")"; ts_libs=$((ts_libs+1))
  [ -f "test/typescript/expected/$c.edges" ]     || ts_missing+=("$c.edges")
  [ -f "test/typescript/expected/$c.lib.edges" ] || ts_missing+=("$c.lib.edges")
done

java_libs=0; java_missing=()
for d in test/java/cases/*/lib-src; do
  [ -d "$d" ] || continue
  c="$(basename "$(dirname "$d")")"; java_libs=$((java_libs+1))
  [ -f "test/java/expected/$c.edges" ] || java_missing+=("$c.edges")
done

py_libs=0
[ -d test/python/torture/lib ] && py_libs=1

printf 'client->library coverage: typescript %d (both goldens each), java %d stub libs, python %d torture lib\n' \
  "$ts_libs" "$java_libs" "$py_libs"

if [ ${#ts_missing[@]} -gt 0 ]; then
  echo "  a TypeScript case ships a lib/ but is missing a golden, so its client->library half asserts nothing:"
  printf '    %s\n' "${ts_missing[@]}"; fail=1
fi
if [ ${#java_missing[@]} -gt 0 ]; then
  echo "  a Java case ships a lib-src/ but is missing its golden:"
  printf '    %s\n' "${java_missing[@]}"; fail=1
fi

check_floor() { # name actual floor
  if [ "$2" -lt "$3" ]; then
    echo "  $1 client->library coverage fell: $2, was $3."
    echo "    If that removal was intended, lower the floor in this file in the same commit."
    fail=1
  fi
}
check_floor typescript "$ts_libs"   "$TS_LIB_FLOOR"
check_floor java       "$java_libs" "$JAVA_LIB_FLOOR"
check_floor python     "$py_libs"   "$PY_LIB_FLOOR"

[ "$fail" = 0 ] && echo "  0 violation(s)"
exit $fail
