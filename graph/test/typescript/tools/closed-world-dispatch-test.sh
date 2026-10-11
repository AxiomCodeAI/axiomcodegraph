#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# `--closed-world on` NARROWS THE DISPATCH FAN, AND SAYS SO (#473).
#
# By default an interface-typed call fans to every declared implementor (CHA). With the
# flag the fan is narrowed to the implementors a value the program can build could run
# (RTA), and every edge the premise removed is exported as a
# dispatch_assumes_closed_world row. The default is pinned by the ordinary golden of case
# 83-closed-world-dispatch; this solves the same case with the flag on and checks:
#
#   dropped   Unused (named only as a type), Orphan (a subclass nobody constructs),
#             TypeOnly (imported into another module, but named there only as a type)
#   KEPT      Built (a `new`), Registered (handed to a registry as a class VALUE — the
#             DI/factory shape), Base (never constructed, but its body runs on a Leaf),
#             Provided (imported into another module and handed over as `useClass:` —
#             the container shape, where the value is an import binding, not the class)
#   and the assumption file names exactly the three dropped targets, while the flag-off
#   run writes none.
# The four kept targets are the controls: each is a way a class is built without the
# engine seeing a typed `new` of it, and losing any one would be a wrong narrowing.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"  # the repository root, found by its marker
PARSER="${AXIOM_PARSER:-$ROOT/parser/dist/index.js}"
CASE="$HERE/../cases/83-closed-world-dispatch"

fail=0; checks=0
ok(){  checks=$((checks+1)); return 0; }
bad(){ checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/ir" "$W/empty"
if ! node "$PARSER" "$CASE/src" cw false "$W/ir" >"$W/parse.log" 2>&1; then
  echo "  FAIL  parse — see the log below"; sed 's/^/        /' "$W/parse.log" | tail -20
  echo "closed-world-dispatch: FAILED"; exit 1
fi
for mode in off on; do
  if ! bash "$ROOT/graph/pipeline/run-souffle.sh" --debug --language typescript --closed-world "$mode" \
       --client-ir "$W/ir" --library "$W/empty" --intermediate "$W/$mode/int" --output "$W/$mode/out" \
       >"$W/$mode.log" 2>&1; then
    echo "  FAIL  solve ($mode)"; tail -20 "$W/$mode.log" | sed 's/^/        /'
    echo "closed-world-dispatch: FAILED"; exit 1
  fi
  python3 "$HERE/normalize_edges.py" "$W/ir" "$W/$mode/out/raw" > "$W/$mode.edges"
done

site='handlers#dispatch(Handler,string) @L42 -> '
has(){ grep -qF "multi_inferred	METHOD_CALL	$site$2" "$W/$1.edges"; }

kept='Built#handle(string) Registered#handle(string) Base#handle(string) Provided#handle(string)'
dropped='Unused#handle(string) Orphan#handle(string) TypeOnly#handle(string)'
for t in $kept $dropped; do
  has off "$t" && ok || bad "flag off: the CHA fan lost $t — the default must not move"
done
for t in $kept; do
  has on "$t" && ok || bad "flag on: $t was narrowed away, but the program can build a value that runs it"
done
for t in $dropped; do
  has on "$t" && bad "flag on: $t is still in the fan, though nothing constructs it" || ok
done

gone="$(comm -23 <(sort "$W/off.edges") <(sort "$W/on.edges") | wc -l | tr -d ' ')"
added="$(comm -13 <(sort "$W/off.edges") <(sort "$W/on.edges") | wc -l | tr -d ' ')"
[ "$gone" = 3 ] && [ "$added" = 0 ] && ok || bad "flag on moved $gone edge(s) out and $added in; expected exactly the 3 dropped fan edges"

aoff="$W/off/out/raw/assumption-dispatch-closed-world.csv"
aon="$W/on/out/raw/assumption-dispatch-closed-world.csv"
[ -f "$aoff" ] && [ ! -s "$aoff" ] && ok || bad "flag off wrote assumption rows (or no file): the default makes no closed-world step"
n="$(wc -l < "$aon" 2>/dev/null | tr -d ' ')"
[ "${n:-0}" = 3 ] && ok || bad "flag on wrote ${n:-no} assumption row(s); expected one per dropped edge (3)"
grep -q "dispatch closed world = on" "$W/on.log" && ok || bad "the solve log does not report the closed-world mode"

if [ "$fail" != 0 ]; then echo "closed-world-dispatch: FAILED ($checks checks)"; exit 1; fi
echo "closed-world-dispatch: ok ($checks checks)"
