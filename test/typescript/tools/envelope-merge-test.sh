#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# THE DISPATCH ENVELOPE MUST CONTAIN EVERY DECLARATION OF THE SYMBOL IT BOUNDS,
# AND NOTHING THAT IS NOT A BODY.
#
# `tsc-envelope.mjs` adds the resolved symbol's whole declaration set to the bound, so
# that picking a different OVERLOAD of the same function scores as over-approximation
# rather than as a fabrication. It read that set off `sig.declaration.symbol` — the
# symbol local to the declaration the compiler happened to pick — and that symbol
# carries only the declarations in ITS OWN FILE. Measured on a two-file synthetic:
#
#   dual("a")       declared twice in ONE file   both symbols give both declarations
#   ping("hi")      declared in TWO files        declaration-local gives ONE of two
#   theBox.open()   interface reopened           declaration-local gives ONE of two
#
# So same-file overloads were carried and CROSS-FILE MERGING was dropped — which is
# every `lib.*.d.ts` declaration merge there is. An engine edge to the `lib.dom`
# declaration of `setTimeout`, on a project whose `lib` list includes DOM, was scored
# as a demonstrable false positive while being a declaration of the very symbol the
# compiler resolved. See issue #242.
#
# ── AND WHY THE UNION IS FILTERED, WHICH IS THE OTHER HALF ───────────────────
# The merged symbol's declarations are not all callable. Unfiltered, taking the union
# added 16,686 declarations across 15,830 sites on one dev project — 9,989 of them
# `VariableDeclaration` and 5,654 `PropertySignature`. A value declaration is not
# something a call dispatches INTO, and admitting one widens the bound in the
# direction that flatters the engine. Only 56 of those additions were function-like.
#
# Four of the six checks below are CONTROLS for that: the bound must not grow a
# namespace, a value declaration, or an import statement, and the same-file overload
# behaviour that already worked must not change.
#
# SYNTHESISED FIXTURE, written here rather than borrowed from a work dir, so the test
# states the exact declaration relationships rather than implying them.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PYTHON:-python3}"

# ── locate a TypeScript compiler ────────────────────────────────────────────
# The defect is a claim about what the compiler's API returns, so this check cannot be
# written against a stub without merely restating the belief it exists to test. The
# repository declares `typescript` as a devDependency; the parser checkout and the
# corpus both carry one too. If none is present this half reports SKIP loudly and
# non-fatally — the reporting half in envelope_report_test.py needs no compiler and
# always runs.
find_ts() {
  local c
  for c in \
    "${TS_MODULE_PATH:-}" \
    "$HERE/../../../node_modules/typescript" \
    "${AXIOM_PARSER:+$(dirname "$(dirname "$AXIOM_PARSER")")/node_modules/typescript}" \
    "$HOME/.cache/axiom-ts-corpus/immer/node_modules/typescript"
  do
    [ -n "$c" ] && [ -f "$c/package.json" ] && { echo "$c"; return 0; }
  done
  return 1
}
TS_DIR="$(find_ts)" || {
  echo "  SKIP  envelope-merge: no typescript module found (set TS_MODULE_PATH)"
  exit 0
}
export TS_MODULE_PATH="$TS_DIR"

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${ENVELOPE_TEST_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src"

cat > "$W/tsconfig.json" <<'EOF'
{ "compilerOptions": { "target": "es2020", "lib": ["ES2020"], "types": [], "moduleResolution": "node" },
  "include": ["src", "merged-a.d.ts", "merged-b.d.ts", "samefile.d.ts", "nsmerge.d.ts"] }
EOF

# THE POINT OF THE FIXTURE: `ping` and `Box#open` are each declared in TWO files and
# merge into ONE symbol. `handler` is a value whose type is callable — a declaration
# the bound must NOT acquire.
cat > "$W/merged-a.d.ts" <<'EOF'
declare function ping(x: string): void;
interface Box { open(k: string): void; }
declare const theBox: Box;
declare const handler: (x: string) => void;
EOF
cat > "$W/merged-b.d.ts" <<'EOF'
declare function ping(x: number): void;
interface Box { open(k: number): void; }
EOF
# Two overloads in ONE file — the case that already worked, kept as a control.
cat > "$W/samefile.d.ts" <<'EOF'
declare function dual(x: string): void;
declare function dual(x: number): void;
EOF
# A namespace merged onto a function, which is how @types/node declares `setTimeout`.
# The ModuleDeclaration is a declaration of the same symbol and is NOT a body.
cat > "$W/nsmerge.d.ts" <<'EOF'
declare function timer(cb: () => void): number;
declare namespace timer { const version: string; }
EOF
cat > "$W/src/lib.ts" <<'EOF'
export function fromLib(a: string): void {}
EOF
cat > "$W/src/main.ts" <<'EOF'
import { fromLib } from './lib';
ping('hi');
theBox.open('k');
dual('a');
timer(function () {});
fromLib('a');
handler('a');
EOF

if ! ( cd "$W" && node "$HERE/../ground-truth/tsc-envelope.mjs" . "$W/envelope.tsv" ) >"$W/env.log" 2>&1; then
  echo "  FAIL  envelope-merge: tsc-envelope.mjs failed"
  sed 's/^/        /' "$W/env.log"
  exit 1
fi

# ── assertions, read off the emitted TSV ────────────────────────────────────
env_for() { "$PY" - "$W/envelope.tsv" "$1" <<'PYEOF'
import sys
want = sys.argv[2]
with open(sys.argv[1], encoding='utf-8') as fh:
    fh.readline()
    for ln in fh:
        r = ln.rstrip('\n').split('\t')
        if len(r) >= 12 and r[6] == want:
            print(';'.join(sorted(x for x in r[10].split(';') if x)))
            break
PYEOF
}

PING="$(env_for ping)"
OPEN="$(env_for open)"
DUAL="$(env_for dual)"
TIMER="$(env_for timer)"
FROMLIB="$(env_for fromLib)"
HANDLER="$(env_for handler)"

# 1. A GLOBAL DECLARED IN TWO FILES. The whole point. Before the fix the envelope
#    carried merged-a only, so an engine naming merged-b's declaration — the same
#    symbol — was a "demonstrable false positive".
case "$PING" in
  *merged-a.d.ts:1:1*) case "$PING" in
      *merged-b.d.ts:1:1*) ok "merged global: both declarations in the envelope" ;;
      *) bad "merged global: merged-b.d.ts:1:1 missing from the envelope ($PING)" ;;
    esac ;;
  *) bad "merged global: merged-a.d.ts:1:1 missing from the envelope ($PING)" ;;
esac

# 2. AN INTERFACE REOPENED IN ANOTHER FILE. `String#replace` is this shape.
case "$OPEN" in
  *merged-a.d.ts:2:17*) case "$OPEN" in
      *merged-b.d.ts:2:17*) ok "reopened interface: both member declarations in the envelope" ;;
      *) bad "reopened interface: merged-b.d.ts:2:17 missing from the envelope ($OPEN)" ;;
    esac ;;
  *) bad "reopened interface: merged-a.d.ts:2:17 missing from the envelope ($OPEN)" ;;
esac

# 3. CONTROL — same-file overloads already worked and must keep working. This is the
#    `new Error(msg)` case the envelope was widened for in the first place.
case "$DUAL" in
  *samefile.d.ts:1:1*) case "$DUAL" in
      *samefile.d.ts:2:1*) ok "control: same-file overloads still both present" ;;
      *) bad "control: same-file overload samefile.d.ts:2:1 was DROPPED ($DUAL)" ;;
    esac ;;
  *) bad "control: same-file overload samefile.d.ts:1:1 was DROPPED ($DUAL)" ;;
esac

# 4. CONTROL — a namespace merged onto the function is a declaration of the same
#    symbol and is not a body. It must not be in a bound of bodies.
case "$TIMER" in
  *nsmerge.d.ts:2:1*) bad "control: the merged NAMESPACE is in the envelope ($TIMER)" ;;
  *nsmerge.d.ts:1:1*) ok "control: merged namespace excluded, function kept" ;;
  *) bad "control: the function declaration nsmerge.d.ts:1:1 is missing ($TIMER)" ;;
esac

# 5. CONTROL — an import alias is resolved THROUGH. Its own declaration is the
#    `import` statement at main.ts:1:10, which is not a body either.
case "$FROMLIB" in
  *main.ts:1:10*) bad "control: the IMPORT STATEMENT is in the envelope ($FROMLIB)" ;;
  *lib.ts:1:1*)   ok "control: alias resolved to the function, import statement excluded" ;;
  *) bad "control: the aliased function lib.ts:1:1 is missing ($FROMLIB)" ;;
esac

# 6. CONTROL — the over-widening guard. `handler` is a const whose TYPE is callable;
#    its VariableDeclaration is a value declaration. Dropping the function-like filter
#    would admit it, and admitting its class on a real project added ~10k declarations.
case "$HANDLER" in
  *merged-a.d.ts:4:15*) bad "control: a VALUE declaration is in the envelope ($HANDLER)" ;;
  *) ok "control: value declaration of a callable const excluded" ;;
esac

if [ "$fail" -ne 0 ]; then
  echo "envelope-merge: FAILED ($checks checks)"
  exit 1
fi
echo "envelope-merge: ok ($checks checks)"
