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

# ── the gate ─────────────────────────────────────────────────────────────────
# Until this block existed the fixture only PRINTED: every mechanism below could
# regress to "no answer" and the run still exited 0. These are the sites whose
# resolution is the whole point of a package this fixture ships, so a break here
# names the mechanism that broke rather than moving a corpus percentage.
#
# The list is deliberately (file, callee) and not a full edge golden: an edge golden
# over library declarations moves whenever a vendored .d.ts is edited, and a gate that
# is re-blessed routinely stops being a gate.
MISSED="$WORK/eval/missed.tsv"
SCORE="$WORK/eval/score.txt"
fail=0

require_resolved() {  # <file-fragment> <calleeName> <why>
  if awk -F'\t' -v f="$1" -v c="$2" 'NR>1 && index($1,f) && $5==c {found=1} END{exit !found}' "$MISSED"; then
    echo "FAIL  $1  $2()  — unresolved.  $3"
    fail=1
  fi
}

# Cross-package re-export: @tt/probe reaches @tt/probe-core with `export ... from`
# and never imports it, so the package is discoverable ONLY by scanning export rows,
# and its specifier is linkable ONLY by matching the staged package root.
require_resolved link-crosspkg-reexport.ts probeOf \
  "staging must discover a package named only by a re-export specifier"
require_resolved link-crosspkg-reexport.ts probeCount \
  "export * across a package boundary"
require_resolved link-crosspkg-reexport.ts toBeAssignableTo \
  "a method on a class re-exported across a package boundary"
require_resolved link-crosspkg-reexport.ts probeLocal \
  "the control: declared in the barrel itself"

# `declare const g: typeof import('@tt/probe')['probeOf']` — vitest's globals.d.ts
# shape. Needs the INDEXED_ACCESS annotation read as an export lookup.
require_resolved link-crosspkg-reexport.ts globalProbe \
  "typeof import(M)[K] must bind the const to the exported function"

# Conditional return types. Both branches declare `shared`, so the answer is a
# two-candidate set — the site must be ANSWERED, not blank. `condGuarded` additionally
# proves the descent skips the CHECK and EXTENDS children: if it read all four, the
# interface named in the check position would become a receiver type here.
require_resolved link-conditional.ts shared \
  "a conditional return must resolve to its branches"

# The fixture answers only where it is sure: a WRONG answer here is a rule that
# manufactures confidence, which is worse than the missing edge it replaces.
if ! grep -qE '^WRONG \(engine named, oracle disagrees\)[[:space:]]+0$' "$SCORE"; then
  echo "FAIL  the fixture produced WRONG answers:"
  grep -E '^WRONG' "$SCORE"
  fail=1
fi

[ "$fail" -eq 0 ] && echo "linking fixture: gate ok"
exit $fail
