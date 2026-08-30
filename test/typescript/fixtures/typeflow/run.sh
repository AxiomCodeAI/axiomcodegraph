#!/bin/bash
# The type-flow gate: parser IR -> engine -> tsc oracle -> per-site score and chains.
#
# This fixture is CLIENT-ONLY except for the standard library, which it uses heavily on
# purpose: `Array.map`, `Promise.then` and `Map.get` are where a type argument has to be
# substituted into a library signature before the client's own receiver comes back out,
# and that is the same machinery a real dependency needs.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
WORK="${1:-/tmp/ts-typeflow-fixture}"
NM="${2:-/Users/swapnilpaliwal/Documents/AxiomCode/Parser/node_modules}"

rm -rf "$WORK"; mkdir -p "$WORK"
cp -R "$HERE"/. "$WORK/project"
rm -f "$WORK/project/run.sh" "$WORK/project/README.md"
[ -d "$NM" ] && ln -sfn "$NM" "$WORK/project/node_modules"

bash "$REPO/test/typescript/run-evaluation.sh" "$WORK/project" "$WORK/eval"
