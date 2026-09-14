#!/bin/bash
# The type-flow gate: parser IR -> engine -> tsc oracle -> per-site score and chains.
#
# This fixture is CLIENT-ONLY except for the standard library, which it uses heavily on
# purpose: `Array.map`, `Promise.then` and `Map.get` are where a type argument has to be
# substituted into a library signature before the client's own receiver comes back out,
# and that is the same machinery a real dependency needs.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"  # the repository root, found by its marker — no level counting
WORK="${1:-/tmp/ts-typeflow-fixture}"
# Discovered, not hardcoded: this default used to be an absolute path inside one
# developer's home directory, so the symlink below was silently skipped anywhere else
# and the gate failed as though native resolution were broken (#331).
NM="${2:-$(bash "$HERE/../../tools/find-node-modules.sh")}"

rm -rf "$WORK"; mkdir -p "$WORK"
cp -R "$HERE"/. "$WORK/project"
rm -f "$WORK/project/run.sh" "$WORK/project/README.md"
[ -d "$NM" ] && ln -sfn "$NM" "$WORK/project/node_modules"

bash "$REPO/graph/test/typescript/run-evaluation.sh" "$WORK/project" "$WORK/eval"
