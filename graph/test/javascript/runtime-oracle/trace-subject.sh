#!/bin/bash
# =============================================================================
# Trace one JavaScript project: mirror it, instrument the mirror, run ITS OWN
# test suite, and keep what ran.
#
# THE MIRROR IS THE POINT. Instrumenting in place would leave the checkout
# rewritten, and every later engine run would analyse the tracer's own calls. The
# mirror carries the source and symlinks node_modules, so the install is shared
# and the disk cost is the source tree only.
#
# THE SUITE IS THE DRIVER, not a workload written for this measurement. A trace
# from a workload someone wrote while looking at the engine's output would be
# measuring the author, not the program.
#
# HOW THE TRACER REACHES THE TEST PROCESS
# The rewritten code names `__ax` as a free identifier, so the runtime has to be
# loaded in the same process as the code under test, and a JavaScript project
# picks its own runner. Two mechanisms, applied together:
#   NODE_OPTIONS=--require   reaches mocha, tap, jest workers and `node --test`,
#                            which are all ordinary child processes.
#   a merged vitest config   vitest takes setupFiles from a config file and not
#                            from the command line, and its worker is where the
#                            test actually runs. The project's own config is
#                            MERGED rather than replaced: replacing it drops the
#                            include globs, the environment and the aliases the
#                            suite needs, and the run would then be measuring a
#                            different program.
#
# Usage: trace-subject.sh <project-dir> <work-dir> [<test-command>]
# =============================================================================
set -eu
PROJECT="$(cd "$1" && pwd)"
mkdir -p "$2"
WORK="$(cd "$2" && pwd)"
TEST_CMD="${3:-npm test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="$(basename "$PROJECT")"

MIRROR="$WORK/mirror"
TABLES="$WORK/tables"
TRACE="$WORK/trace"
rm -rf "$MIRROR" "$TABLES" "$TRACE"
mkdir -p "$MIRROR" "$TABLES" "$TRACE"

echo "▶ $NAME: mirroring"
# -a keeps mtimes so the test runner's own caches stay valid; node_modules and
# .git are excluded and node_modules is symlinked back in.
rsync -a --exclude node_modules --exclude .git --exclude coverage --exclude dist \
      "$PROJECT"/ "$MIRROR"/
[ -d "$PROJECT/node_modules" ] && ln -s "$PROJECT/node_modules" "$MIRROR/node_modules"

echo "▶ $NAME: instrumenting"
node "$HERE/instrument.mjs" --src "$MIRROR" --out "$MIRROR" --tables "$TABLES"

cat > "$MIRROR/.ax-setup.cjs" <<EOF
require('$HERE/runtime.cjs')
EOF

AX_CFG=""
case "$TEST_CMD" in
  *vitest*)
    BASE_CFG=""
    for c in vitest.config.js vitest.config.mjs vitest.config.cjs vitest.config.ts vitest.config.mts \
             vite.config.js vite.config.mjs vite.config.cjs vite.config.ts vite.config.mts; do
      [ -f "$MIRROR/$c" ] && { BASE_CFG="$c"; break; }
    done
    AX_CFG="$MIRROR/vitest.ax.config.mjs"
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
    TEST_CMD="$TEST_CMD --config $AX_CFG"
    ;;
esac

echo "▶ $NAME: running the suite under the tracer"
set +e
( cd "$MIRROR" \
  && AX_TRACE_OUT="$TRACE" \
     NODE_OPTIONS="${NODE_OPTIONS:-} --require $MIRROR/.ax-setup.cjs" \
     $TEST_CMD \
) > "$WORK/test-output.txt" 2>&1
STATUS=$?
set -e
tail -8 "$WORK/test-output.txt"
echo "▶ $NAME: suite exit status $STATUS, $(ls "$TRACE" | wc -l | tr -d ' ') trace files"
