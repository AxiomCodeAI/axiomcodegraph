#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ANOTHER OVERLOAD OF THE SAME CALLABLE IS NOT A WRONG ANSWER.
#
# `score.py` already has the rule, and its own comment states it: "TypeScript overloads
# are compile-time only: N signatures, ONE implementation, so a call that reaches any of
# them reaches the same code." `_same_group` implemented that by comparing
# `declarationGroupKey` — which the parser populates for FUNCTION_DECLARATION and for
# NOTHING ELSE. Measured on one project's own code and the standard library it stages:
#
#     FUNCTION_DECLARATION   243 populated / 0 empty      149 populated / 0 empty
#     METHOD_DECLARATION       0 populated / 3272 empty
#     METHOD_SIGNATURE         0 populated /  209 empty   3922 empty
#     CONSTRUCT_SIGNATURE                                  143 empty
#
# So an overloaded class METHOD and every signature kind were invisible to the credit,
# and two corpus rows read as the engine naming a target the compiler disagrees with when
# it had named another overload of the same thing: `addSelect` (three overloads of one
# method in one class) and `new Set` (two construct signatures of SetConstructor, which
# the standard library declares in one file and REOPENS in another). WRONG 11 -> 9, and
# the development set to zero. See issue #310.
#
# ── WHY THE MERGED SYMBOL AND NOT A NAME OR AN OWNER ────────────────────────
# Joining on (owner, name) is the shortcut this scorer is careful never to take: any
# unrelated `addSelect` or `SetConstructor` would satisfy it, which manufactures the
# agreement the verdict exists to measure. `getSymbolAtLocation` returns the MERGED
# symbol, whose declarations are exactly the set the language treats as one entity.
# Checks 3 and 4 are that distinction and are the reason this is safe.
#
# A `new` or bare call signature has NO NAME NODE, so it gets no symbol that way at all;
# for those the merged entity is the INTERFACE, whose symbol spans every file it is
# reopened in. Check 2 is that path, and it is the one #310 is actually about.
#
# SYNTHESISED PROJECT, asserted against the emitter's own output — no engine, no solver,
# no work directory. It does need a TypeScript, because the claim under test is a claim
# about what the compiler answers; a stub would only restate the belief. Says SKIP loudly
# if none is found.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

find_ts() {
  local c
  for c in "${TS_MODULE_PATH:-}" "$HERE/../../../node_modules/typescript" \
           "${AXIOM_PARSER:+$(dirname "$(dirname "$AXIOM_PARSER")")/node_modules/typescript}" \
           "$HOME/.cache/axiom-ts-corpus/immer/node_modules/typescript"; do
    [ -n "$c" ] && [ -f "$c/package.json" ] && { echo "$c"; return 0; }
  done
  return 1
}
TS_DIR="$(find_ts)" || {
  echo "  SKIP  overload-sibling: no typescript module found (set TS_MODULE_PATH)"
  exit 0
}
export TS_MODULE_PATH="$TS_DIR"

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${OVERLOAD_SIBLING_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

EMIT="$HERE/../ground-truth/overload-siblings.mjs"
if [ ! -f "$EMIT" ]; then
  echo "  FAIL  ground-truth/overload-siblings.mjs is missing"
  echo "        The 'grouped nothing' controls below would pass vacuously. Stopping here."
  echo "overload-sibling: FAILED (1 check)"
  exit 1
fi

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src"
cat > "$W/tsconfig.json" <<'EOF'
{ "compilerOptions": { "target": "es2020", "lib": ["ES2020"], "types": [],
    "strict": false, "moduleResolution": "node", "module": "commonjs" },
  "include": ["src"] }
EOF

# (1) an overloaded class METHOD — the kind with 3,272 keyless rows
# (2) an interface REOPENED in another file, adding a construct signature — the #310 shape
# (3) two unrelated methods that merely share a name, in different classes — the control
cat > "$W/src/a.ts" <<'EOF'
export class Builder {
  addSelect(selection: string, alias?: string): this;
  addSelect(selection: string[]): this;
  addSelect(selection: any, alias?: string): this { return this; }
}

export class Unrelated {
  addSelect(selection: string): this { return this; }
}

export interface Maker {
  new (values?: string[]): Maker;
}
EOF
cat > "$W/src/b.ts" <<'EOF'
import { Maker } from './a';
// The SAME interface, reopened: one merged symbol, two construct signatures.
declare module './a' {
  interface Maker {
    new (iterable?: Iterable<string>): Maker;
  }
}
export type Keep = Maker;
EOF

OUT="$W/siblings.tsv"
if ! node "$EMIT" "$W" "$OUT" > "$W/emit.log" 2>&1; then
  echo "  FAIL  the emitter exited non-zero"
  sed 's/^/        /' "$W/emit.log"
  echo "overload-sibling: FAILED (1 check)"
  exit 1
fi

grp() { awk -F'\t' -v f="$1" -v l="$2" 'index($1,f)>0 && $2==l {print $4; exit}' "$OUT"; }
count_in() { awk -F'\t' -v g="$1" '$4==g' "$OUT" | wc -l | tr -d ' '; }

# ── 1. the three overloads of one method share one group ────────────────────
g1=$(grp 'a.ts' 2); g2=$(grp 'a.ts' 3); g3=$(grp 'a.ts' 4)
if [ -n "$g1" ] && [ "$g1" = "$g2" ] && [ "$g1" = "$g3" ]; then
  ok "an overloaded class method: all three declarations share a group"
else
  bad "the three overloads of addSelect are grouped [$g1] [$g2] [$g3], expected one shared group — declarationGroupKey is empty for METHOD_DECLARATION, so this is the whole credit (#310)"
fi

# ── 2. a REOPENED interface's construct signatures share one group ──────────
# The shape #310 is about, and the one a name lookup cannot reach: a construct
# signature has no name node at all.
c1=$(grp 'a.ts' 12); c2=$(grp 'b.ts' 5)
if [ -n "$c1" ] && [ "$c1" = "$c2" ]; then
  ok "a reopened interface: construct signatures across two files share a group"
else
  bad "the two construct signatures of the reopened interface are grouped [$c1] [$c2], expected one shared group across the two files — this is the SetConstructor shape (#310)"
fi

# ── 3. CONTROL: a same-NAME method on an unrelated class is NOT a sibling ───
u=$(grp 'a.ts' 8)
if [ -z "$u" ]; then
  ok "control: an unrelated same-named method is in no group at all"
elif [ "$u" != "$g1" ]; then
  ok "control: an unrelated same-named method is in a DIFFERENT group"
else
  bad "Unrelated#addSelect shares a group with Builder#addSelect — the grouping is matching on NAME, which lets any declaration of that name answer for the verdict and manufactures agreement"
fi

# ── 4. CONTROL: a lone declaration earns no row ─────────────────────────────
# It has no sibling, so a row could only ever match itself, which `otarget in eng`
# already covers. A row here would mean the emitter groups things with nothing.
lone=$(awk -F'\t' 'index($1,"a.ts")>0 && $2==8' "$OUT" | wc -l | tr -d ' ')
if [ "$lone" = "0" ]; then
  ok "control: a declaration with no sibling is not emitted"
else
  bad "a lone declaration was emitted ($lone rows), so the file claims groups that are not groups"
fi

if [ "$fail" != "0" ]; then
  echo "overload-sibling: FAILED ($checks checks)"
  exit 1
fi
echo "overload-sibling: ok ($checks checks)"
