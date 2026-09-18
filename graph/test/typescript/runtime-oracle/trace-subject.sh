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
# Usage: trace-subject.sh <project-dir> <work-dir> [<test-command>]
# =============================================================================
set -eu
PROJECT="$(cd "$1" && pwd)"
mkdir -p "$2"
WORK="$(cd "$2" && pwd)"
TEST_CMD="${3:-npx vitest run --reporter=basic}"
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
