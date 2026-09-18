#!/bin/bash
# =============================================================================
# Trace one project: mirror it, instrument the mirror, run ITS OWN test suite,
# and keep what ran.
#
# THE MIRROR IS THE POINT. Instrumenting in place would leave the corpus checkout
# rewritten, and every later engine run would analyse the tracer's own calls. The
# mirror carries the source and symlinks node_modules, so the install is shared
# and the disk cost is the source tree only.
#
# THE SUITE IS THE DRIVER, not a workload written for this measurement. A trace
# from a workload someone wrote while looking at the engine's output would be
# measuring the author, not the program.
#
# IT IS RUN TWICE. Once untouched, once instrumented, and the two have to report the
# same counts. That is the integrity check the method rests on, and taking only the
# second run made a subject that cannot run look exactly like a rewrite that broke it.
#
# Usage: trace-subject.sh <project-dir> <work-dir> [<test-command>]
# =============================================================================
set -eu
PROJECT="$(cd "$1" && pwd)"
mkdir -p "$2"
WORK="$(cd "$2" && pwd)"
# NO --reporter=basic. vitest 4 removed that reporter, so a subject pinned to it died
# with `Failed to load custom Reporter from basic` before collecting a single test, and
# the harness reported that as `suite exit status 1, 0 trace files` like any other
# failure. The default reporter exists in every version and nothing here parses it.
TEST_CMD="${3:-npx vitest run}"
HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="$(basename "$PROJECT")"

MIRROR="$WORK/mirror"
TABLES="$WORK/tables"
TRACE="$WORK/trace"
rm -rf "$MIRROR" "$TABLES" "$TRACE"
mkdir -p "$MIRROR" "$TABLES" "$TRACE"

echo "▶ $NAME: mirroring"
# -a keeps mtimes so the test runner's own caches stay valid. ONLY node_modules and
# .git are left out, and node_modules is symlinked back in: the mirror has to BE the
# program, and what to instrument is the instrumenter's decision rather than the
# copy's. Leaving `dist` out of the copy costs two koa tests on the JavaScript
# sibling of this script: they load the package by its own name, whose `exports` maps
# that to dist/koa.mjs, so they fail with ERR_MODULE_NOT_FOUND inside the mirror and
# pass in the checkout, and the integrity check cannot tell a missing build product
# from a defect in the rewrite (#925). The instrumenter skips `dist` by name, so the
# artefact is present and untouched.
rsync -a --exclude node_modules --exclude .git \
      "$PROJECT"/ "$MIRROR"/
[ -d "$PROJECT/node_modules" ] && ln -s "$PROJECT/node_modules" "$MIRROR/node_modules"

# ── THE BASELINE, WHICH IS HALF OF THE METHOD ───────────────────────────────
# The claim this harness makes is that the subject's own suite drives the trace AND
# still passes unchanged. Only the second run was ever taken, so `suite exit status 1,
# 0 trace files` meant either "the rewrite broke the suite" or "this subject could
# never run here", and nothing distinguished them. Measured: both corpus subjects were
# the second, and finding that out cost an hour of reading the instrumenter.
#
# Run on the MIRROR, not the checkout, so the comparison is between two states of one
# tree and not between two trees.
echo "▶ $NAME: baseline (uninstrumented)"
set +e
( cd "$MIRROR" && $TEST_CMD ) > "$WORK/baseline-output.txt" 2>&1
BASE_STATUS=$?
set -e
# `Test Files  23 passed (23)` / `Tests  3764 passed | 8 skipped (3772)`. Kept as the
# runner printed them: any normalisation here is a second opinion about what passing
# means, and the point is that the two runs agree LITERALLY.
counts() { grep -E '^[[:space:]]*(Test Files|Tests)[[:space:]]' "$1" 2>/dev/null | sed 's/^[[:space:]]*//'; }
BASE_COUNTS="$(counts "$WORK/baseline-output.txt")"
if [ "$BASE_STATUS" -ne 0 ]; then
  echo "  the subject's OWN suite does not pass, uninstrumented:"
  tail -12 "$WORK/baseline-output.txt" | sed 's/^/    /'
  echo "▶ $NAME: REFUSING. This is a fact about the checkout, not about the tracer."
  echo "  corpus/fetch.sh installs with --ignore-scripts and falls back to npm where the"
  echo "  project ships another lockfile, which leaves peer and platform packages absent."
  echo "  Fix the install, or pass a working test command as the third argument."
  exit 3
fi
printf '  %s\n' "$BASE_COUNTS"

echo "▶ $NAME: instrumenting"
node "$HERE/instrument.mjs" --src "$MIRROR" --out "$MIRROR" --tables "$TABLES"

# The rewritten code names `__ax` as a free identifier. Vitest loads a setup file
# in the same context as the test, which is where the tracer has to live: a
# --require on the parent process does not reach a worker's global.
cat > "$MIRROR/.ax-setup.cjs" <<EOF
require('$HERE/runtime.cjs')
EOF

# Vitest takes setupFiles from a config file, not from the command line, so the
# project's own config is MERGED with ours rather than replaced: replacing it
# would drop the include globs, the environment and the aliases the suite needs,
# and the run would then be measuring a different program.
BASE_CFG=""
for c in vitest.config.ts vitest.config.mts vitest.config.js vitest.config.mjs \
         vite.config.ts vite.config.mts vite.config.js vite.config.mjs; do
  [ -f "$MIRROR/$c" ] && { BASE_CFG="$c"; break; }
done
AX_CFG="$MIRROR/vitest.ax.config.mts"
if [ -n "$BASE_CFG" ]; then
  cat > "$AX_CFG" <<EOF
import {mergeConfig} from 'vitest/config'
import base from './${BASE_CFG}'
export default mergeConfig(base, {
  test: {setupFiles: ['$MIRROR/.ax-setup.cjs'], pool: 'forks', testTimeout: 120000, hookTimeout: 120000},
})
EOF
  echo "  merging with $BASE_CFG"
else
  cat > "$AX_CFG" <<EOF
import {defineConfig} from 'vitest/config'
export default defineConfig({
  test: {setupFiles: ['$MIRROR/.ax-setup.cjs'], pool: 'forks', testTimeout: 120000, hookTimeout: 120000},
})
EOF
  echo "  no project config found; using a bare one"
fi
cat > "$MIRROR/.ax-globals.d.ts" <<'EOF'
declare const __ax: {
  s(site: number): number
  e<T>(depth: number, value: T): T
  enter(decl: number): void
  aux(decl: number): void
}
EOF

echo "▶ $NAME: running the suite under the tracer"
set +e
( cd "$MIRROR" \
  && AX_TRACE_OUT="$TRACE" \
     VITEST_SETUP_AX="$MIRROR/.ax-setup.cjs" \
     $TEST_CMD --config "$AX_CFG" \
) > "$WORK/test-output.txt" 2>&1
STATUS=$?
set -e
tail -8 "$WORK/test-output.txt"
echo "▶ $NAME: suite exit status $STATUS, $(ls "$TRACE" | wc -l | tr -d ' ') trace files"

# ── THE INTEGRITY CHECK, RUN RATHER THAN ASSERTED ───────────────────────────
# A rewrite that changes what the suite reports has changed the program, and every
# number downstream is then about a different program. This was done by eye before.
TRACED_COUNTS="$(counts "$WORK/test-output.txt")"
if [ "$STATUS" -eq 0 ] && [ "$TRACED_COUNTS" = "$BASE_COUNTS" ]; then
  echo "▶ $NAME: integrity ok, identical to baseline"
  printf '  %s\n' "$BASE_COUNTS"
else
  echo "▶ $NAME: INTEGRITY FAILED. The baseline passes and the instrumented run does not"
  echo "  match it, so the rewrite changed the program and the trace describes something"
  echo "  other than the subject."
  echo "  baseline:"; printf '    %s\n' "$BASE_COUNTS"
  echo "  instrumented:"; printf '    %s\n' "${TRACED_COUNTS:-(no counts; the run did not get that far)}"
  exit 4
fi
