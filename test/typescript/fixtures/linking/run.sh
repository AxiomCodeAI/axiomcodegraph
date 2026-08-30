#!/bin/bash
# The linking gate: hand-written packages -> library IR (via the parser CLI, exactly as
# a real dependency is staged) -> engine -> tsc oracle -> per-site score.
#
# WHY node_modules IS BUILT RATHER THAN COMMITTED. The packages live in `vendor/` in the
# repository so they are readable in a diff, and are installed into a scratch copy's
# node_modules at run time. That is not cosmetic: the harness discovers what to stage by
# reading the packageName the PARSER's own module resolution landed in, so a package that
# is not resolvable as a package is never staged, and the fixture would then measure
# nothing while appearing to pass.
#
# `vendor/` is deleted from the scratch copy afterwards. If it stayed, the same
# declarations would be parsed twice — once as client source and once as library IR — and
# a duplicate declaration is scored as a wrong target rather than being harmless.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
WORK="${1:-/tmp/ts-linking-fixture}"
NM="${2:-/Users/swapnilpaliwal/Documents/AxiomCode/Parser/node_modules}"

rm -rf "$WORK"; mkdir -p "$WORK"
cp -R "$HERE"/. "$WORK/project"
rm -f "$WORK/project/run.sh" "$WORK/project/README.md"

# TypeScript itself is symlinked, not copied: the oracle loads the compiler from the
# project under analysis, and the standard library staged as the global scope has to be
# the same bytes the oracle typechecks against.
mkdir -p "$WORK/project/node_modules"
[ -d "$NM/typescript" ] && ln -sfn "$NM/typescript" "$WORK/project/node_modules/typescript"

cp -R "$WORK/project/vendor/." "$WORK/project/node_modules/"
rm -rf "$WORK/project/vendor"

bash "$REPO/test/typescript/run-evaluation.sh" "$WORK/project" "$WORK/eval"
