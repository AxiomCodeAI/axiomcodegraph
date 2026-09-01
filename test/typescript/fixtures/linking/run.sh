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

# A NON-FLAT (pnpm) INSTALL, built by hand because it cannot be expressed by copying a
# directory. @tt/shallow is hoisted; @tt/deep is reachable ONLY from inside the store,
# exactly as pnpm lays out a transitive dependency. Copying both to the top level would
# make the fixture pass for the wrong reason, so @tt/deep must never appear there.
NM="$WORK/project/node_modules"
PS="$NM/.pnpm"
mkdir -p "$PS/@tt+shallow@1.0.0/node_modules/@tt" "$PS/@tt+deep@1.0.0/node_modules/@tt"
cp -R "$WORK/project/pnpm-vendor/@tt/shallow" "$PS/@tt+shallow@1.0.0/node_modules/@tt/shallow"
cp -R "$WORK/project/pnpm-vendor/@tt/deep"    "$PS/@tt+deep@1.0.0/node_modules/@tt/deep"
# the dependent sees its dependency; the project sees only the dependent
ln -sfn "$PS/@tt+deep@1.0.0/node_modules/@tt/deep" "$PS/@tt+shallow@1.0.0/node_modules/@tt/deep"
mkdir -p "$NM/@tt"
ln -sfn "$PS/@tt+shallow@1.0.0/node_modules/@tt/shallow" "$NM/@tt/shallow"
rm -rf "$WORK/project/pnpm-vendor"

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
SITES="$WORK/eval/sites.tsv"
SCORE="$WORK/eval/score.txt"
fail=0

# Assert on the SITE dump, not the missed list. A check that only reads missed.tsv
# passes VACUOUSLY when the call site does not exist at all — delete the fixture file
# and every assertion about it goes green, which is the precise failure this gate was
# added to prevent. So existence is asserted first, and separately.
require_resolved() {  # <file-fragment> <calleeName> <why>
  present=$(awk -F'\t' -v f="$1" -v c="$2" 'NR>1 && index($2,f) && $6==c {n++} END{print n+0}' "$SITES")
  if [ "$present" -eq 0 ]; then
    echo "FAIL  $1  $2()  — NO SUCH CALL SITE. The fixture that exercised this is gone"
    echo "      or renamed, so the check was passing without testing anything.  $3"
    fail=1; return
  fi
  bad=$(awk -F'\t' -v f="$1" -v c="$2" 'NR>1 && index($2,f) && $6==c && $1=="MISSED" {n++} END{print n+0}' "$SITES")
  if [ "$bad" -gt 0 ]; then
    echo "FAIL  $1  $2()  — $bad of $present unresolved.  $3"
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

# A signature declared inside a TYPE carries no return reference, so the result type
# of `make(...)` has to come off the FUNCTION_TYPE reference's METHOD_RETURN child.
# `finish` is the second hop and is unreachable without it.
require_resolved link-conditional.ts finish \
  "a function-typed member's return must type the chained call"

# A transitive dependency that exists ONLY in a pnpm store. `deepCall` and
# `deepStatic` are unreachable unless the package is resolved from the DEPENDENT's
# real directory; `shallowLocal` is the hoisted control and must keep resolving.
require_resolved link-pnpm-store.ts deepCall \
  "a non-hoisted transitive package must be resolved from the dependent's directory"
require_resolved link-pnpm-store.ts deepStatic \
  "a const whose type carries the call signature is callable"
require_resolved link-pnpm-store.ts extend \
  "a member on a callable const"
require_resolved link-pnpm-store.ts shallowLocal \
  "the control: declared in the hoisted package"

# A `typeof Qualified.member` alias to a native static. The qualifier is only present
# as text in completeTypeName, so a regression here means the string split or the
# global-value lookup broke.
require_resolved link-conditional.ts isArrayAlias \
  "typeof Array.isArray must reach the native static"
require_resolved link-conditional.ts assignAlias \
  "the same through a different global"

# A destructuring-pattern PARAMETER. The bound names exist only as parser rows; if the
# binding rules regress these become unresolvable, and nothing else in the suite covers
# a name that has no declaration of its own.
require_resolved link-conditional.ts emitOne \
  "a method member reached through a destructured parameter"
require_resolved link-conditional.ts deeper \
  "a field member reached through a destructured parameter"

# The fixture answers only where it is sure: a WRONG answer here is a rule that
# manufactures confidence, which is worse than the missing edge it replaces.
if ! grep -qE '^WRONG \(engine named, oracle disagrees\)[[:space:]]+0$' "$SCORE"; then
  echo "FAIL  the fixture produced WRONG answers:"
  grep -E '^WRONG' "$SCORE"
  fail=1
fi

[ "$fail" -eq 0 ] && echo "linking fixture: gate ok"
exit $fail
