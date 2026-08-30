#!/bin/bash
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
WORK="${1:-/tmp/ts-specificity-fixture}"
NM="${2:-/Users/swapnilpaliwal/Documents/AxiomCode/Parser/node_modules}"
rm -rf "$WORK"; mkdir -p "$WORK"
cp -R "$HERE"/. "$WORK/project"
rm -f "$WORK/project/run.sh" "$WORK/project/README.md"
[ -d "$NM" ] && ln -sfn "$NM" "$WORK/project/node_modules"
bash "$REPO/test/typescript/run-evaluation.sh" "$WORK/project" "$WORK/eval"
