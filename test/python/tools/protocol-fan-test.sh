#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A WIDE PROTOCOL EDGE IS REPORTED, EVEN THOUGH IT IS KEPT.
#
# dispatch_cap bounds a call site by gating expr_resolves_to_method. The three protocol
# edges — a property read, a context manager, an iteration — reach the output from
# expr_type directly and never pass through it, so one of them can commit past a bound
# every written call obeys. This fixture is that asymmetry in one file: ONE receiver
# widened over 31 constructed subclasses, read twice.
#
#   widened.tag()   refused, dispatch_cap_exceeded, 32 reported in dispatch-dropped-by-cap
#   widened.meta    32 getters emitted, and until #371 reported NOWHERE
#
# 32 and not 31: `same()` DECLARES `-> Base`, so declared_dispatch widens over the 31
# constructed subclasses AND the declared base itself, which is what makes this an
# ordinary widening rather than a contrivance.
#
# The sets are kept, deliberately and on measurement: over five open-source projects the
# call cap refuses NOTHING (0 sites of 490,130 exceed it) while 492 protocol slots do, so
# extending it would import a bound doing no work into the one place it would cost 10,776
# sound edges, all on held-out projects. What was wrong was the SILENCE, and that is what
# this asserts.
#
# THE CONTROLS ARE THE POINT. A narrow protocol read must report nothing, or a relation
# true of everything would pass check 2 just as well; and the call arm must still be
# refused, or the fixture would be measuring nothing about the asymmetry at all.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PARSER="${AXIOM_PARSER:-$ROOT/../Parser/dist/index.js}"
EMPTY_LIB="${AXIOM_EMPTY_LIB:-$(mktemp -d)}"; mkdir -p "$EMPTY_LIB"
[ -f "$PARSER" ] || { echo "  SKIP  protocol-fan: parser not found at $PARSER (set AXIOM_PARSER)"; exit 0; }

fail=0; checks=0
ok(){  checks=$((checks+1)); [ -n "${PROTOCOL_FAN_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){ checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src"

# 31 subclasses: over the default cap of 20, and NARROW is the same shape at 3.
python3 - "$W/src/main.py" <<'PYEOF'
import sys
n = 31
L = ['"""One receiver, widened over 31 constructed subclasses, read two ways."""', '', '',
     'class Base:', '    @property', '    def meta(self):', '        return 0', '',
     '    def tag(self):', '        return "base"', '',
     '    def same(self) -> "Base":', '        return self', '']
for i in range(n):
    L += [f'class S{i}(Base):', '    @property', '    def meta(self):', f'        return {i}', '',
          '    def tag(self):', f'        return "S{i}"', '']
L += ['class Narrow:', '    @property', '    def only(self):', '        return 1', '',
      '    def same(self) -> "Narrow":', '        return self', '', '',
      'def construct_all():', '    return [' + ', '.join(f'S{i}()' for i in range(n)) + ']', '', '',
      'def read_property(b: Base):', '    return b.same().meta', '', '',
      'def call_method(b: Base):', '    return b.same().tag()', '', '',
      'def narrow_property(w: Narrow):', '    return w.same().only', '', '',
      'def main():', '    construct_all()',
      '    print(read_property(S0()), call_method(S0()), narrow_property(Narrow()))', '', '',
      'if __name__ == "__main__":', '    main()', '']
open(sys.argv[1], 'w').write('\n'.join(L))
PYEOF

node "$PARSER" "$W/src" protofan false "$W/ir" > "$W/parse.log" 2>&1 || {
  echo "  FAIL  protocol-fan: the parser failed on the fixture"; sed 's/^/        /' "$W/parse.log" | tail -3
  echo "protocol-fan: FAILED (1 check)"; exit 1; }
bash "$ROOT/src/pipeline/run-souffle.sh" --language python --client-ir "$W/ir" \
     --library "$EMPTY_LIB" --intermediate "$W/int" --output "$W/out" > "$W/solve.log" 2>&1 || {
  echo "  FAIL  protocol-fan: the solve failed"; tail -3 "$W/solve.log" | sed 's/^/        /'
  echo "protocol-fan: FAILED (1 check)"; exit 1; }
O="$W/out"

# 1. THE WIDE PROPERTY READ IS REPORTED, keyed on its SLOT and carrying the count.
if grep -qE '	meta	32$' "$O/protocol-wide-sites.csv" 2>/dev/null; then
  ok 'a property read past the bound is reported, with its slot and its width'
else
  bad "the wide property read is not reported: $(cat "$O/protocol-wide-sites.csv" 2>/dev/null | tr '\n' ' ')"
fi

# 2. CONTROL — THE NARROW ONE IS NOT. Otherwise a relation true of every protocol edge
#    would pass check 1 without meaning anything.
if grep -q '	only	' "$O/protocol-wide-sites.csv" 2>/dev/null; then
  bad 'a one-target property read is reported as wide — the bound is not being applied'
else
  ok 'control: a narrow property read is not reported'
fi

# 3. CONTROL — THE CALL ARM OVER THE SAME RECEIVER IS STILL REFUSED. This is the
#    asymmetry the fixture exists to hold fixed: same width, different treatment.
if grep -qE '	32$' "$O/dispatch-dropped-by-cap.csv" 2>/dev/null; then
  ok 'control: the call arm over the same 32-member receiver is still refused'
else
  bad 'the call arm was not refused — the cap stopped applying to call sites'
fi

# 4. CONTROL — AND THE PROPERTY EDGES ARE KEPT. Reporting must not become refusing by
#    accident; that would delete sound sets no measurement has shown to be harmful.
kept="$(awk -F'\t' '$7=="PROPERTY_READ" && $4!="-" {n[$1]++} END{m=0; for(k in n) if(n[k]>m) m=n[k]; print m+0}' "$O/call-chain-edges.csv" 2>/dev/null)"
if [ "${kept:-0}" -ge 21 ]; then
  ok 'control: the wide property read keeps its edges — this reports, it does not refuse'
else
  bad "the wide property read lost its edges (widest = ${kept:-0}): this reports, it does not refuse"
fi

[ "$fail" -ne 0 ] && { echo "protocol-fan: FAILED ($checks checks)"; exit 1; }
echo "protocol-fan: ok ($checks checks)"
