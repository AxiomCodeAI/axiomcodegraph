#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# THE TWO SIDES OF THE PER-CASE COMPARISON MUST SPELL A DECLARATION THE SAME WAY.
#
# `const step = (x: number) => x + 1` is named `step` by the compiler side and was named
# `<arrow@1>` by normalize_edges, so every call to it read as one MISSING plus one extra — and
# MISSING is the suite's failure verdict. It also polluted known-missing files: an entry added
# for this reason records a gap that does not exist, and the "a listed gap that starts working
# also fails" rule then locks it in.
#
# THE CAUSE WAS A MISREAD COLUMN, not a convention disagreement. A variable's
# `tsMethodLinkHash` is its ENCLOSING method; the function it binds is `boundFunctionLinkHash`.
# Keying on the former was wrong in both directions at once:
#
#   * the arrow was never found, so it fell back to `<arrow@line>`; and
#   * the ENCLOSING scope took the variable's name — a module-level call came out
#     `m#step() -> m#plain(...)`, attributing it to an unrelated arrow. Cases 12 and 13 had
#     committed goldens recording the module initializer as `<arrow@1>`.
#
# See issue #236.
#
# SYNTHESISED IR, so this needs neither the parser nor the solver and cannot skip. normalize_edges
# reads CSVs and one edge file; those are written here directly, which also lets the test state
# the exact column relationship that was misread — the thing a fixture would only imply.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PYTHON:-python3}"

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${ARROW_NAMING_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/ir" "$W/out"

M_MOD=TS_METHOD_MODULEINIT; M_ARROW=TS_METHOD_BOUNDARROW
M_LOOSE=TS_METHOD_LOOSEARROW; M_FN=TS_METHOD_PLAINFN
MODH=TS_MODULE_M

printf 'tsModuleUniqueHash\tqualifiedName\tfilePath\n' > "$W/ir/all-typescript-modules.csv"
printf '%s\tm\tm.ts\n' "$MODH" >> "$W/ir/all-typescript-modules.csv"

printf 'name\tmethodKind\tstartLine\townerTypeName\ttsModuleLinkHash\ttsMethodUniqueHash\n' \
  > "$W/ir/all-typescript-methods.csv"
{
  printf '<module>\tMODULE_INITIALIZER\t1\t\t%s\t%s\n' "$MODH" "$M_MOD"
  printf '<arrow>\tARROW_FUNCTION\t1\t\t%s\t%s\n'      "$MODH" "$M_ARROW"
  printf '<arrow>\tARROW_FUNCTION\t7\t\t%s\t%s\n'      "$MODH" "$M_LOOSE"
  printf 'plain\tFUNCTION_DECLARATION\t3\t\t%s\t%s\n'  "$MODH" "$M_FN"
} >> "$W/ir/all-typescript-methods.csv"

# THE POINT OF THE FIXTURE: tsMethodLinkHash is the ENCLOSING method (the module initializer),
# boundFunctionLinkHash is the arrow the const actually binds. They are different hashes, and
# reading the wrong one is the defect.
printf 'name\ttsMethodLinkHash\tboundFunctionLinkHash\tinitializerKind\tstartLine\n' \
  > "$W/ir/all-typescript-variables.csv"
printf 'step\t%s\t%s\tARROW\t1\n' "$M_MOD" "$M_ARROW" >> "$W/ir/all-typescript-variables.csv"

printf 'tsMethodLinkHash\tposition\tparameterTypeName\n' > "$W/ir/all-typescript-method-parameters.csv"
printf '%s\t0\tnumber\n' "$M_ARROW" >> "$W/ir/all-typescript-method-parameters.csv"

# site, caller, ?, callee, ?, status, kind  — 7 fields, tab separated
{
  printf 'S1\t%s\tx\t%s\tx\tknown_edge\tFUNCTION_CALL\n' "$M_FN"  "$M_ARROW"
  printf 'S2\t%s\tx\t%s\tx\tknown_edge\tFUNCTION_CALL\n' "$M_MOD" "$M_FN"
  printf 'S3\t%s\tx\t%s\tx\tknown_edge\tFUNCTION_CALL\n' "$M_FN"  "$M_LOOSE"
} > "$W/out/call-chain-edges.csv"

got="$("$PY" "$HERE/normalize_edges.py" "$W/ir" "$W/out" --client-pairs 2>&1 | sort)"

want_arrow='m#plain() -> m#step(number)'
printf '%s\n' "$got" | grep -qxF "$want_arrow" \
  && ok "an arrow bound to a const is named by the const" \
  || bad "expected '$want_arrow'; got:$(printf '\n%s' "$got" | sed 's/^/          /')"

printf '%s\n' "$got" | grep -q '<arrow@1>' \
  && bad "the bound arrow is still labelled <arrow@1>:$(printf '\n%s' "$got" | sed 's/^/          /')" \
  || ok "the bound arrow is not labelled <arrow@line>"

want_mod='m#<module-init>() -> m#plain()'
printf '%s\n' "$got" | grep -qxF "$want_mod" \
  && ok "the module initializer is <module-init>, matching the compiler side" \
  || bad "expected '$want_mod'; got:$(printf '\n%s' "$got" | sed 's/^/          /')"

# The enclosing scope must NOT take the variable's name — the second, worse symptom.
printf '%s\n' "$got" | grep -q 'm#step() ->' \
  && bad "the ENCLOSING scope was named after the variable:$(printf '\n%s' "$got" | sed 's/^/          /')" \
  || ok "the enclosing scope is not named after a variable it merely contains"

# An arrow bound to NOTHING keeps the positional label; that agrees with the compiler side too,
# and is what a class field holding an arrow relies on.
printf '%s\n' "$got" | grep -qxF 'm#plain() -> m#<arrow@7>()' \
  && ok "an unbound arrow keeps <arrow@line>" \
  || bad "an unbound arrow lost its positional label:$(printf '\n%s' "$got" | sed 's/^/          /')"

[ "$fail" = 0 ] && echo "arrow-naming: ok ($checks checks)" || echo "arrow-naming: FAILED"
exit "$fail"
