#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Run one engine regression suite under CI semantics.
#
# The suites are written for a developer laptop, where "the parser isn't built
# yet" is a good reason to step aside: they print SKIP and exit 77. On CI that is
# the one outcome that must never be tolerated. A gate that opens when its input
# is missing is worse than no gate at all — the pull request goes green having
# tested nothing, and the next person reads that green as evidence.
#
# So this wrapper turns every shape of "did not actually run" into a failure:
#
#   1. exit 77 from the suite itself;
#   2. a `SKIP: parser not found` line from a sub-harness (torture, fixtures)
#      that caught its own 77 and carried on;
#   3. a suite that reported zero passing cases, which means the case loop found
#      nothing to do and the exit status is meaningless.
#
# Usage: run-suite.sh <java|python|typescript> [extra args passed to the suite]
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

lang="${1:?usage: run-suite.sh <java|python|typescript> [args...]}"; shift
root="$(cd "$(dirname "$0")/../.." && pwd)"
suite="$root/test/$lang/run-tests.sh"

[ -f "$suite" ] || { echo "::error::no suite at $suite"; exit 1; }

# The suites default AXIOM_PARSER to $ROOT/../Parser/dist/index.js, which is only
# correct for a side-by-side developer layout. CI must be told explicitly, and must
# refuse to start rather than discover the absence halfway through as a SKIP.
if [ -z "${AXIOM_PARSER:-}" ]; then
  echo "::error::AXIOM_PARSER is unset — refusing to run a suite that would skip itself"
  exit 1
fi
if [ ! -f "$AXIOM_PARSER" ]; then
  echo "::error::AXIOM_PARSER=$AXIOM_PARSER does not exist. The parser checkout did not build."
  exit 1
fi

log="$(mktemp)"
echo "── $lang suite ── parser: $AXIOM_PARSER"
bash "$suite" "$@" 2>&1 | tee "$log"
rc="${PIPESTATUS[0]}"

if [ "$rc" -eq 77 ]; then
  echo "::error::the $lang suite skipped itself (exit 77). A skipped suite is a failed gate."
  exit 1
fi

# A sub-harness that swallowed its own 77. The suite's exit status cannot see this:
# it counted the sub-harness as neither a pass nor a failure, so the run is green
# with a whole family unexecuted.
#
# EVERY skip is a failure here, not just the parser ones. The sub-harnesses decline
# for several different reasons — no parser, no javac, a JDK without
# java.lang.classfile (the torture oracle needs 24+), no oracle checkout — and each
# one is a dependency CI is supposed to provide. If a skip is ever legitimate it
# should be an explicit exclusion in this file, visible in a diff, rather than a
# green run that quietly tested less than the last one.
if grep -qE '(^|[[:space:]])SKIP([: (]|PED)' "$log"; then
  echo "::error::a sub-harness in the $lang suite skipped instead of running:"
  grep -nE '(^|[[:space:]])SKIP([: (]|PED)' "$log" | sed 's/^/  /'
  echo "::error::CI must supply what it wanted. Do not relax this check to go green."
  exit 1
fi

# "passed 0" means the case loop matched nothing — a rename or a bad filter, not a
# clean run. Guard it, because exit 0 with zero assertions is the quietest failure
# this harness can produce.
if grep -qE '^passed 0([^0-9]|$)|^passed 0,' "$log"; then
  echo "::error::the $lang suite passed 0 cases — it asserted nothing."
  exit 1
fi

exit "$rc"
