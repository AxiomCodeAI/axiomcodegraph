#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AN ANONYMOUS SHAPE IS NOT AN OWNER, AND BOTH SIDES MUST AGREE ON WHAT IS.
#
# `{ run(n: number): string }#run` was the engine's label for a member of an anonymous
# type literal — the literal's own SOURCE TEXT, truncated at 120 characters and moving
# whenever any member of the shape is edited — where the compiler side said `members#run`.
# In the OTHER direction, an arrow that is an interface property's type was
# `members#<arrow@39>` here and `Holder#<arrow@39>` there. Same declaration, same line,
# two names: one MISSING plus one extra, per call, charged against accuracy the engine
# had already got right, and three such lines sat in a known-missing file as accepted
# gaps that were never gaps. Same class as #236 and #299. See issue #322.
#
# THE RULE, and it is one rule and not two patches: the compiler side names the nearest
# ENCLOSING NAMED declaration and the module otherwise. A shape has no name, so the
# engine side asks what the shape is the TYPE OF — a method's `tsTypeLinkHash` points at
# its own `ts_type_reference` row, which records the entity the type was written for.
# A FIELD owner yields that field's declaring type; a TYPE owner is a type ALIAS, which the
# compiler side does not treat as an owner either, so it falls through to the module. A
# METHOD_PARAM owner is an inline annotation, and the compiler side walks PAST it to the
# method: a member of a named interface or class takes that type (`run(fn: () => number)`
# in `interface Pool` is `Pool`), a free function's parameter takes the module (#1208).
#
# FIVE OF THE TWELVE CHECKS ARE CONTROLS. Four assert a label that must NOT move (an
# ordinary declaring type, a type alias, a free function's parameter, a nameless literal
# method's parameter), because a rule that reaches for an owner too eagerly is as wrong as
# one that never reaches, and would show up as a NEW disagreement rather than as a fixed
# one. The fifth removes the relation the rule reads and asserts the answer DEGRADES to the module rather than
# crashing or staying right, which is what says the CSV is where the answer comes from.
#
# SYNTHESISED IR, so this needs neither the parser nor the solver and cannot skip.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PYTHON:-python3}"

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${SHAPE_OWNER_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

# ── THE RULE UNDER TEST MUST EXIST ───────────────────────────────────────────
# A missing rule also "answers no": every check below that expects the MODULE would pass
# against a normalize_edges.py that never learned to look for an owner at all. Five of
# nine checks in an earlier test passed exactly that way, so this is asserted first.
[ -f "$HERE/normalize_edges.py" ] \
  || { echo "shape-owner: FAILED (no normalize_edges.py to test)"; exit 1; }
if grep -q 'def enclosing_owner' "$HERE/normalize_edges.py"; then
  ok "normalize_edges resolves an anonymous shape's owner (def enclosing_owner)"
else
  bad "normalize_edges has no enclosing_owner: the module-owner checks below would pass vacuously"
fi

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/ir" "$W/out"

MODH=TS_MODULE_M
M_MOD=TS_METHOD_MODULEINIT;         M_CALLER=TS_METHOD_CALLER
M_IFACE_ARROW=TS_METHOD_IFACEARROW; M_ALIAS_ARROW=TS_METHOD_ALIASARROW
M_PARAM_ARROW=TS_METHOD_PARAMARROW
M_LIT_METHOD=TS_METHOD_LITRUN;      M_NESTED=TS_METHOD_NESTEDDEEP
M_LIT_IN_LIT=TS_METHOD_LITINLIT;    M_CLASS=TS_METHOD_CLASSGO
M_FREE_F=TS_METHOD_FREEF;           M_POOL_RUN=TS_METHOD_POOLRUN
M_MEMBER_ARROW=TS_METHOD_MEMBERARROW; M_LITPARAM_ARROW=TS_METHOD_LITPARAMARROW
M_LIT_SIG=TS_METHOD_LITSIG

R_IFACE=TS_TYPE_REFERENCE_IFACE;    R_ALIAS=TS_TYPE_REFERENCE_ALIAS
R_PARAM=TS_TYPE_REFERENCE_PARAM;    R_LIT=TS_TYPE_REFERENCE_LIT
R_NESTED=TS_TYPE_REFERENCE_NESTED;  R_LITINLIT=TS_TYPE_REFERENCE_LITINLIT
R_MEMBER=TS_TYPE_REFERENCE_MEMBERPARAM; R_LITPARAM=TS_TYPE_REFERENCE_LITPARAM

F_IFACE=TS_FIELD_HOLDERRUN;  F_OUTER=TS_FIELD_OUTERDEEP;  F_LITPROP=TS_FIELD_LITPROP

printf 'tsModuleUniqueHash\tqualifiedName\tfilePath\n' > "$W/ir/all-typescript-modules.csv"
printf '%s\tm\tm.ts\n' "$MODH" >> "$W/ir/all-typescript-modules.csv"

printf 'name\tmethodKind\tstartLine\townerTypeName\ttsTypeLinkHash\ttsModuleLinkHash\ttsMethodUniqueHash\n' \
  > "$W/ir/all-typescript-methods.csv"
{
  printf '<module>\tMODULE_INITIALIZER\t1\t\t\t%s\t%s\n' "$MODH" "$M_MOD"
  printf 'caller\tFUNCTION_DECLARATION\t2\t\t\t%s\t%s\n' "$MODH" "$M_CALLER"
  # `run: (n: number) => string` inside `interface Holder` — the interface is the owner.
  printf '<function-type>\tFUNCTION_TYPE_SIGNATURE\t5\t\t%s\t%s\t%s\n'  "$R_IFACE" "$MODH" "$M_IFACE_ARROW"
  # `type Alias = { run: (n) => string }` — an alias is NOT an owner, on either side.
  printf '<function-type>\tFUNCTION_TYPE_SIGNATURE\t9\t\t%s\t%s\t%s\n'  "$R_ALIAS" "$MODH" "$M_ALIAS_ARROW"
  # `f(p: (n) => string)` — an inline annotation owns nothing.
  printf '<function-type>\tFUNCTION_TYPE_SIGNATURE\t20\t\t%s\t%s\t%s\n' "$R_PARAM" "$MODH" "$M_PARAM_ARROW"
  # A METHOD of an anonymous literal. `ownerTypeName` is the literal's TEXT, which is the
  # half of the defect that reads as an extra rather than as a miss.
  printf 'run\tTYPE_LITERAL_METHOD_SIGNATURE\t12\t{ run(n: number): string }\t%s\t%s\t%s\n' \
      "$R_LIT" "$MODH" "$M_LIT_METHOD"
  # The same literal nested in an INTERFACE property: the interface is the owner.
  printf 'deep\tTYPE_LITERAL_METHOD_SIGNATURE\t15\t{ deep(): void }\t%s\t%s\t%s\n' \
      "$R_NESTED" "$MODH" "$M_NESTED"
  # A literal inside a literal: the outer field is nameless too, so neither can own.
  printf 'inner\tTYPE_LITERAL_METHOD_SIGNATURE\t17\t{ inner(): void }\t%s\t%s\t%s\n' \
      "$R_LITINLIT" "$MODH" "$M_LIT_IN_LIT"
  printf 'go\tMETHOD_DECLARATION\t25\tC\t\t%s\t%s\n' "$MODH" "$M_CLASS"
  # The owners of the parameters below: a free function, a member of `interface Pool`, and
  # a method of an anonymous literal, whose own owner is the literal's text and so no name.
  printf 'f\tFUNCTION_DECLARATION\t19\t\t\t%s\t%s\n' "$MODH" "$M_FREE_F"
  printf 'run\tMETHOD_SIGNATURE\t29\tPool\t\t%s\t%s\n' "$MODH" "$M_POOL_RUN"
  printf 'go\tTYPE_LITERAL_METHOD_SIGNATURE\t31\t{ go(fn: () => void): void }\t\t%s\t%s\n' "$MODH" "$M_LIT_SIG"
  # `run(fn: () => number)` in `interface Pool`: the parameter's type is owned by Pool.
  printf '<function-type>\tFUNCTION_TYPE_SIGNATURE\t30\t\t%s\t%s\t%s\n' "$R_MEMBER" "$MODH" "$M_MEMBER_ARROW"
  # `{ go(fn: () => void): void }`: a nameless literal's method owns nothing.
  printf '<function-type>\tFUNCTION_TYPE_SIGNATURE\t32\t\t%s\t%s\t%s\n' "$R_LITPARAM" "$MODH" "$M_LITPARAM_ARROW"
} >> "$W/ir/all-typescript-methods.csv"

printf 'referenceOwnerKind\ttypeReferenceOwnerHash\ttsTypeReferenceUniqueHash\n' \
  > "$W/ir/all-typescript-type-references.csv"
{
  printf 'FIELD\t%s\t%s\n'                          "$F_IFACE"   "$R_IFACE"
  printf 'TYPE\tTS_TYPE_ALIAS1\t%s\n'                            "$R_ALIAS"
  printf 'METHOD_PARAM\tTS_METHOD_PARAMETER_P\t%s\n'             "$R_PARAM"
  printf 'TYPE\tTS_TYPE_ALIAS2\t%s\n'                            "$R_LIT"
  printf 'FIELD\t%s\t%s\n'                          "$F_OUTER"   "$R_NESTED"
  printf 'FIELD\t%s\t%s\n'                          "$F_LITPROP" "$R_LITINLIT"
  printf 'METHOD_PARAM\tTS_METHOD_PARAMETER_Q\t%s\n'             "$R_MEMBER"
  printf 'METHOD_PARAM\tTS_METHOD_PARAMETER_R\t%s\n'             "$R_LITPARAM"
} >> "$W/ir/all-typescript-type-references.csv"

printf 'name\tposition\ttsMethodLinkHash\ttsMethodParameterUniqueHash\n' > "$W/ir/all-typescript-method-parameters.csv"
{
  printf 'p\t0\t%s\tTS_METHOD_PARAMETER_P\n' "$M_FREE_F"
  printf 'fn\t0\t%s\tTS_METHOD_PARAMETER_Q\n' "$M_POOL_RUN"
  printf 'fn\t0\t%s\tTS_METHOD_PARAMETER_R\n' "$M_LIT_SIG"
} >> "$W/ir/all-typescript-method-parameters.csv"

printf 'name\tmemberKind\townerTypeName\ttsFieldUniqueHash\n' > "$W/ir/all-typescript-fields.csv"
{
  printf 'run\tPROPERTY_SIGNATURE\tHolder\t%s\n'                     "$F_IFACE"
  printf 'deep\tPROPERTY_SIGNATURE\tOuter\t%s\n'                     "$F_OUTER"
  printf 'inner\tTYPE_LITERAL_PROPERTY\t{ inner: () => void }\t%s\n' "$F_LITPROP"
} >> "$W/ir/all-typescript-fields.csv"

for t in "$M_IFACE_ARROW" "$M_ALIAS_ARROW" "$M_PARAM_ARROW" \
         "$M_LIT_METHOD" "$M_NESTED" "$M_LIT_IN_LIT" "$M_CLASS" \
         "$M_MEMBER_ARROW" "$M_LITPARAM_ARROW"; do
  printf 'S\t%s\tx\t%s\tx\tknown_edge\tFUNCTION_CALL\n' "$M_CALLER" "$t"
done > "$W/out/call-chain-edges.csv"

got="$("$PY" "$HERE/normalize_edges.py" "$W/ir" "$W/out" --client-pairs 2>&1 | sort)"
show(){ printf '\n%s' "$got" | sed 's/^/          /'; }
want(){
  if printf '%s\n' "$got" | grep -qxF "m#caller() -> $1"; then ok "$2"
  else bad "$2 — expected '$1'; got:$(show)"; fi
}

# ── THE DEFECT, in both of its directions ────────────────────────────────────
want 'Holder#<arrow@5>()' "an arrow that is an interface property's type is owned by the interface"
want 'm#run()'            "a method of an anonymous literal is owned by the module, not by the literal's text"
want 'Outer#deep()'       "a literal nested in an interface property takes the interface"
want 'm#inner()'          "a literal inside a literal falls through: a nameless field owns nothing"
want 'Pool#<arrow@30>()'  "a function type that is a PARAMETER's type takes the method's declaring type (#1208)"

# ── CONTROLS: labels that must NOT move ──────────────────────────────────────
want 'C#go()'             "CONTROL: a real declaring type is untouched"
want 'm#<arrow@9>()'      "CONTROL: a type ALIAS is not an owner, on either side"
want 'm#<arrow@20>()'     "CONTROL: a free function's parameter annotation is owned by the module"
want 'm#<arrow@32>()'     "CONTROL: a parameter of a nameless literal's method is owned by the module"

if printf '%s\n' "$got" | grep -q '{'; then
  bad "a label still carries an anonymous shape's source text:$(show)"
else
  ok "no label is owned by a type literal's source text"
fi

# ── THE ANSWER COMES FROM THE RELATION, not from somewhere else ──────────────
# Without the type references there is no route from a shape to a declaration, so the
# interface case must fall back to the module. Right for the wrong reason is still a rule
# that is not being exercised, and this is what tells the two apart; it also asserts that
# a relation the parser did not emit is survivable rather than a traceback.
rm -f "$W/ir/all-typescript-type-references.csv"
degraded="$("$PY" "$HERE/normalize_edges.py" "$W/ir" "$W/out" --client-pairs 2>&1 | sort)"
if printf '%s\n' "$degraded" | grep -qxF 'm#caller() -> m#<arrow@5>()'; then
  ok "with no type references the owner degrades to the module, so the relation IS the source"
else
  bad "expected 'm#<arrow@5>()' without the type-reference relation; got:$(printf '\n%s' "$degraded" | sed 's/^/          /')"
fi

[ "$fail" = 0 ] && echo "shape-owner: ok ($checks checks)" || echo "shape-owner: FAILED"
exit "$fail"
