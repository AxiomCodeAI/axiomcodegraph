#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A BODY THAT IMPLEMENTS A SIGNATURE IS NOT A WRONG ANSWER.
#
#     const setState: Api<S>['setState'] = (...a) => { ... }
#
# is, to the compiler, the call signature declared inside a type literal in ANOTHER
# file; to the engine it is the arrow. A call through that name scored WRONG because
# `score.py` could not see that these are the same callable:
#
#     oracle  vanilla.ts:2:3      TYPE_LITERAL_METHOD_SIGNATURE
#     engine  devtools.ts:258:59  ARROW_FUNCTION  <arrow>
#
# The credit that already existed could not reach it for TWO independent reasons — the
# declarations are in different files, and the arrow is anonymous so no name is shared.
# Both of its gates fail on the same rows. Measured on a dev corpus member: 9 of its 9
# WRONG rows are this shape, `WRONG` 9 -> 0, `implementation of tsc's signature` 0 -> 9,
# `edge-correct` 0.598 -> 0.641, and every other bucket unchanged. See issue #237.
#
# ── WHY THE CONTEXTUAL TYPE AND NOT ASSIGNABILITY ───────────────────────────
# "Is the body's type assignable to the signature's" is the wrong question:
# `(...a: any[]) => void` is assignable to a great many signatures, so that rule would
# credit unrelated functions and manufacture the agreement it exists to measure. The
# question asked instead is what type the declaration ITSELF gives the body —
# `getContextualType` — which returns nothing for an unannotated function. Checks 3 and
# 4 below are that distinction, and they are the reason this is safe.
#
# SYNTHESISED PROJECT, and the assertions are made against the emitter's own output, so
# this needs no engine, no solver and no work directory. It does need a TypeScript,
# because the claim under test is a claim about what the compiler answers — a stub would
# only restate the belief. It says SKIP loudly if none is found.
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
  echo "  SKIP  signature-impl: no typescript module found (set TS_MODULE_PATH)"
  exit 0
}
export TS_MODULE_PATH="$TS_DIR"

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${SIGNATURE_IMPL_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

# The emitter has to exist before any of this means anything. Without this the run dies
# on a module-not-found stack trace, which is a failure but an illegible one — and
# three of the six checks below are of the form "nothing was credited", which a missing
# emitter satisfies perfectly.
if [ ! -f "$HERE/../ground-truth/signature-impls.mjs" ]; then
  echo "  FAIL  ground-truth/signature-impls.mjs is missing"
  echo "        The 'credited nothing' controls below would pass vacuously. Stopping here."
  echo "signature-impl: FAILED (1 check)"
  exit 1
fi

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src"
cat > "$W/tsconfig.json" <<'EOF'
{ "compilerOptions": { "target": "es2020", "lib": ["ES2020"], "types": [],
    "strict": false, "moduleResolution": "node", "module": "commonjs" },
  "include": ["src"] }
EOF

# THE SHAPE UNDER TEST: an overloaded call signature inside a type literal, reached by
# an indexed access, implemented by an anonymous arrow in a DIFFERENT file. Every
# element of that sentence is load-bearing — remove any one and the old credit works.
cat > "$W/src/vanilla.ts" <<'EOF'
export type SetState<T> = {
  _(partial: Partial<T>, replace?: false): void
  _(state: T, replace: true): void
}['_']
export type Api<T> = { setState: SetState<T> }
EOF
cat > "$W/src/devtools.ts" <<'EOF'
import type { Api } from './vanilla';
export function make<S>(): void {
  const setStateFromDevtools: Api<S>['setState'] = (...a) => {};
  setStateFromDevtools({} as any);
}
EOF
# CONTROL: an arrow with a compatible type and NO annotation. Assignability would
# credit it; the contextual type must not.
cat > "$W/src/unannotated.ts" <<'EOF'
export const looksCompatible = (...a: any[]) => {};
looksCompatible({});
EOF
# CONTROL: an arrow annotated with a DIFFERENT signature. Must map to its own only.
cat > "$W/src/other.ts" <<'EOF'
export type Other = { run(x: number): void }['run']
const runner: Other = (x) => {};
runner(1);
EOF

OUT="$W/pairs.tsv"
if ! ( cd "$W" && node "$HERE/../ground-truth/signature-impls.mjs" . "$OUT" ) >"$W/log" 2>&1; then
  echo "  FAIL  signature-impls.mjs failed"
  sed 's/^/        /' "$W/log"
  exit 1
fi

# pairs, reduced to basenames so the assertions read like the report does
pairs() { awk -F'\t' 'NR>1 {n=split($1,a,"/"); m=split($4,b,"/");
          print a[n]":"$2":"$3" -> "b[m]":"$5":"$6}' "$OUT"; }

# 1. THE ARROW IS CREDITED TO THE SIGNATURE, ACROSS FILES, THROUGH THE INDEXED ACCESS.
if pairs | grep -q '^devtools\.ts:3:[0-9]* -> vanilla\.ts:2:3$'; then
  ok 'the anonymous arrow maps to the type-literal signature in another file'
else
  bad "the arrow was not mapped to vanilla.ts:2:3 — got: $(pairs | grep devtools || echo none)"
fi

# 2. AN OVERLOAD SET YIELDS EVERY SIGNATURE. The body implements both, and the oracle
#    may name either, so crediting only the first would leave half the rows WRONG.
if pairs | grep -q '^devtools\.ts:3:[0-9]* -> vanilla\.ts:3:3$'; then
  ok 'both overloads of the signature are emitted'
else
  bad "the second overload (vanilla.ts:3:3) is missing — a call resolving to it would still read WRONG"
fi

# 3. CONTROL — AN UNANNOTATED ARROW IS CREDITED TO NOTHING. This is the assertion that
#    makes the rule safe: its type IS assignable to the signature, and it must still
#    not be credited, because nothing declared it to be that signature.
if pairs | grep -q '^unannotated\.ts:'; then
  bad "control: an UNANNOTATED arrow was credited — $(pairs | grep '^unannotated' | head -1)"
else
  ok 'control: an unannotated arrow of compatible type is credited to nothing'
fi

# 4. CONTROL — an arrow annotated with a different signature maps to that one, and not
#    to the signature under test. Cross-contamination between two signatures would
#    credit any body for any of them.
if pairs | grep -q '^other\.ts:2:[0-9]* -> vanilla\.ts:'; then
  bad 'control: an arrow annotated with a DIFFERENT signature was credited to this one'
elif pairs | grep -q '^other\.ts:2:[0-9]* -> other\.ts:1:'; then
  ok 'control: an arrow annotated elsewhere maps only to its own signature'
else
  bad "control: the other arrow mapped to nothing at all — $(pairs | grep '^other' || echo none)"
fi

# 5. CONTROL — NO BODY IS ITS OWN SIGNATURE. A function is contextually typed by itself
#    in some positions; crediting that would make every function trivially implement
#    itself and hide real disagreements.
if awk -F'\t' 'NR>1 && $1==$4 && $2==$5 && $3==$6 {found=1} END{exit !found}' "$OUT"; then
  bad 'control: a body was emitted as its own signature'
else
  ok 'control: no body is recorded as implementing itself'
fi

# 6. CONTROL — the output is well formed: six columns, absolute paths on both sides, so
#    it resolves the way every other target in the scorer resolves.
if awk -F'\t' 'NR>1 && (NF!=6 || $1 !~ /^\// || $4 !~ /^\//) {bad=1} END{exit bad+0}' "$OUT"; then
  ok 'every row has six columns and absolute paths on both sides'
else
  bad 'a row is malformed or carries a relative path, which would not join in the scorer'
fi

if [ "$fail" -ne 0 ]; then
  echo "signature-impl: FAILED ($checks checks)"
  exit 1
fi
echo "signature-impl: ok ($checks checks)"
