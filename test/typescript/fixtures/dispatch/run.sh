#!/bin/bash
# The fixture gate: parser IR -> engine -> tsc oracle -> per-site score, with the
# overload slice broken out. Runs from a scratch copy so the fixture directory itself
# stays clean and so node_modules can be a symlink to whatever TypeScript is at hand.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
WORK="${1:-/tmp/ts-dispatch-fixture}"
# Discovered, not hardcoded: this default used to be an absolute path inside one
# developer's home directory, so the symlink below was silently skipped anywhere else
# and the gate failed as though native resolution were broken (#331).
NM="${2:-$(bash "$HERE/../../tools/find-node-modules.sh")}"

rm -rf "$WORK"; mkdir -p "$WORK"
cp -R "$HERE"/. "$WORK/project"
rm -f "$WORK/project/run.sh"
[ -d "$NM" ] && ln -sfn "$NM" "$WORK/project/node_modules"

bash "$REPO/test/typescript/run-evaluation.sh" "$WORK/project" "$WORK/eval"
