#!/bin/bash
# Does library staging tell a lost sibling program from a dual-format build? (#230)
#
# Both shapes make the parser analyse more files than it publishes. Only one is a defect:
#   dep/   sibling programs, each with its own manifest -> genuinely lost, stage them
#   dual/  esm + cjs of the same declarations, no manifest -> publishing one is CORRECT
#
# Getting that backwards trades a silent gap for wrong answers, because staging the same
# declarations twice sends every site multi_inferred and scores the copy the compiler did
# not name as WRONG. So both directions are asserted.
#
# Usage: run.sh [<work-dir>] [<parser-dist>]
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TS="$(cd "$HERE/../.." && pwd)"
WORK="${1:-/tmp/ts-multi-program}"
PARSER="${2:-${AXIOM_PARSER:-}}"
[ -n "$PARSER" ] && [ -f "$PARSER" ] || { echo "SKIP: no parser (set AXIOM_PARSER)"; exit 77; }

# shellcheck source=../../tools/lib-staging.sh
. "$TS/tools/lib-staging.sh"

fail=0
rm -rf "$WORK"; mkdir -p "$WORK"
cp -R "$HERE/dep" "$HERE/dual" "$WORK/"

# ── 1. the predicate: sibling manifests are programs, esm/cjs are not ───────
sib="$(lib_programs "$WORK/dep" | sort | tr '\n' ' ')"
case "$sib" in
  *alpha*beta*) ;;
  *) echo "FAIL  lib_programs on sibling packages gave '$sib', expected alpha and beta"; fail=1 ;;
esac
dual="$(lib_programs "$WORK/dual" | tr -d '[:space:]')"
if [ -n "$dual" ]; then
  echo "FAIL  lib_programs on a dual-format build gave '$dual', expected nothing"
  echo "      staging esm and cjs separately duplicates every declaration"
  fail=1
fi

# ── 2. the defect is real: one invocation publishes one program ─────────────
node "$PARSER" "$WORK/dep" mp false "$WORK/ir-dep" >"$WORK/dep.parser.log" 2>&1 || true
pub=$(awk -F'\t' 'NR>1{print $4}' "$WORK/ir-dep/all-typescript-modules.csv" 2>/dev/null | wc -l | tr -d ' ')
if [ "$pub" -ne 1 ]; then
  echo "FAIL  one invocation over sibling packages published $pub modules, expected 1"
  echo "      the fixture is no longer reproducing the defect it exists for"
  fail=1
fi

# ── 3. and the shortfall is DETECTED rather than silent ────────────────────
sf="$(lib_shortfall "$WORK/ir-dep" "$WORK/dep.parser.log")"
if [ -z "$sf" ]; then
  echo "FAIL  lib_shortfall reported nothing; the parser's own count is not being read"
  fail=1
else
  set -- $sf
  if [ "$1" -le "$2" ]; then
    echo "FAIL  lib_shortfall says analysed=$1 published=$2 — no shortfall seen"
    fail=1
  fi
fi

# ── 4. staging each sibling separately recovers both declarations ──────────
for s in alpha beta; do
  node "$PARSER" "$WORK/dep/$s" "mp-$s" false "$WORK/ir-$s" >/dev/null 2>&1 || true
  if ! grep -q "from_$s" "$WORK/ir-$s/all-typescript-methods.csv" 2>/dev/null; then
    echo "FAIL  staging dep/$s did not publish its own declaration from_$s"
    fail=1
  fi
done

[ "$fail" -eq 0 ] && echo "multi-program fixture: gate ok (siblings staged, dual-format not, shortfall detected)"
exit $fail
