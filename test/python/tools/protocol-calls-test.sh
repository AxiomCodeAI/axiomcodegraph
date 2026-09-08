#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A CALL THE SOURCE DOES NOT CONTAIN IS NOT A PARSER GAP.
#
# `with obj:` and `for x in xs:` hold no call expression, but CPython compiles them to
# `__enter__` / `__exit__` / `__iter__`. Tier 1 reads bytecode so it sees them; the parser
# correctly mints no `py_call_site` for a call the author never wrote; and check 2 counted
# the difference as a gap. Measured on five projects: 123 invented gaps, the guard red on
# all five while the parser's inventory was complete. See issue #304.
#
# ── MEASURED, BECAUSE THE ISSUE AND ITS VERIFICATION DISAGREED ──────────────
# Run against the vendored tier 1 on the pinned interpreter, the shapes are:
#
#     with lock:            callee `lock`  via GLOBAL      ON THE HEADER LINE
#     with make_lock():     callee `make_lock` — a REAL call — plus `<call-result>`
#     with lock: (on exit)  EMPTY callee, via UNKNOWN      already filtered
#     for x in xs:          no site at all, when NOT inside a `with`
#     for x in xs:          callee `xs` via LOCAL, when INSIDE a `with`
#     for x in sorted(xs):  callee `sorted` — a REAL call
#
# So `__exit__` was never a gap source, `__enter__` lands on the header line, and the
# `for` clause is NOT dead: a plain `for` mints nothing, but a `for` enclosed by a `with`
# mints a named site. Through the real guard, origin/main invents exactly two gaps here —
# `mod.py:15 lock` and `mod.py:26 xs` — and the second is the one that removing the `for`
# clause, as proposed, would have left uncovered. Check 2 below is that case.
#
# ── THE CONTROLS ARE THE POINT ──────────────────────────────────────────────
# This SUPPRESSES gaps, so the risk is suppressing a real one. Three of the six checks are
# that: the real call in a `with` header is still adjudicated, the real call in a `for`
# header is still adjudicated, and a genuinely missing call site is still reported. The
# suppression is keyed on the header line AND requires the IR to have nothing of that name
# there, which is why the first two survive it.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD="$HERE/coverage_guard.py"
PARSER="${AXIOM_PARSER:-$HERE/../../../Parser/dist/index.js}"

if [ ! -f "$GUARD" ]; then
  echo "  FAIL  tools/coverage_guard.py is missing; the 'no longer a gap' checks below"
  echo "        would pass vacuously"
  echo "protocol-calls: FAILED (1 check)"
  exit 1
fi
PINNED="$(sed -n 's/^PINNED = (\([0-9]*\), \([0-9]*\))$/\1.\2/p' "$HERE/vendor/tier1_sites.py" | head -1)"
[ -n "$PINNED" ] || PINNED=3.10
PY=""
for c in "${AXIOM_PY_PINNED:-}" "python$PINNED" "/usr/local/bin/python$PINNED" \
         "/opt/homebrew/bin/python$PINNED"; do
  [ -n "$c" ] && command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }
done
if [ -z "$PY" ]; then
  echo "  SKIP  protocol-calls: CPython $PINNED not found; check 2 is pinned to it"
  exit 0
fi
if [ ! -f "$PARSER" ]; then
  echo "  SKIP  protocol-calls: parser not found at $PARSER (set AXIOM_PARSER)"
  exit 0
fi

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${PROTOCOL_CALLS_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src/pkg"
: > "$W/src/pkg/__init__.py"
cat > "$W/src/pkg/mod.py" <<'EOF'
import threading

lock = threading.Lock()


def make_lock():
    return lock


def helper(x):
    return x


def bare_with():
    with lock:
        return 1


def call_result_with():
    with make_lock():
        return 2


def with_loop_inside(xs):
    with lock:
        for x in xs:
            return x


def plain_for(xs):
    for x in xs:
        yield x


def real_call_in_for(xs):
    for x in sorted(xs):
        yield helper(x)
EOF

mkdir -p "$W/ir" "$W/out"
if ! node "$PARSER" "$W/src" p304 false "$W/ir" > "$W/parse.log" 2>&1; then
  echo "  FAIL  protocol-calls: the parser failed on the fixture"
  sed 's/^/        /' "$W/parse.log" | tail -3
  exit 1
fi
: > "$W/out/call-chain-edges.csv"
guard() { ( cd "$HERE/.." && "$PY" "$GUARD" "$W/ir" "$W/out" "$W/src" ) > "$W/g.txt" 2>&1; }
guard

# 1. THE BARE `with` HEADER is no longer a gap.
if grep -q 'PARSER GAP (site).*lock (via' "$W/g.txt"; then
  bad "the bare `with` header is still a gap: $(grep 'PARSER GAP (site)' "$W/g.txt" | head -1)"
else
  ok 'a bare `with obj:` header is not a parser gap'
fi

# 2. NOR IS A `for` ENCLOSED BY A `with`. The shape the proposed fix would have dropped.
if grep -q 'PARSER GAP (site).*xs (via' "$W/g.txt"; then
  bad 'a `for` inside a `with` is still a gap — the clause the issue called dead'
else
  ok 'a `for` header inside a `with` is not a parser gap'
fi

# 3. CONTROL — THE REAL CALL IN A `with` HEADER IS STILL ADJUDICATED. Suppressing by
#    line alone would have swallowed this one, which is why the IR has to agree.
if grep -qE 'tier-1 parser check: [1-9][0-9]*/[1-9]' "$W/g.txt"; then
  ok 'control: adjudicable sites remain — the real calls were not swallowed'
else
  bad "control: every site became unadjudicable — the suppression is too wide: $(grep 'tier-1 parser check' "$W/g.txt")"
fi

# 4. CONTROL — A GENUINELY MISSING CALL SITE IS STILL REPORTED. Drop `helper` from the
#    IR's call-site inventory and the guard must notice; otherwise this gate is off.
python3 - "$W/ir/all-python-call-sites.csv" <<'PYEOF'
import sys
p = sys.argv[1]
lines = open(p, encoding='utf-8').read().split('\n')
hdr = lines[0].split('\t')
i = hdr.index('calleeName')
out = [lines[0]] + [l for l in lines[1:] if not (l and l.split('\t')[i] == 'helper')]
open(p, 'w', encoding='utf-8').write('\n'.join(out))
PYEOF
guard
if grep -q 'PARSER GAP (site).*helper' "$W/g.txt"; then
  ok 'control: a genuinely missing call site is still reported'
else
  bad 'control: a REAL parser gap was suppressed — this gate no longer gates'
fi

# 5. CONTROL — and it is reported on the line it is on, not folded into a header. The
#    `helper(x)` call sits in a `for` BODY, one line below a suppressed `for` header.
if grep -qE 'PARSER GAP \(site\)  pkg/mod\.py:3[0-9] helper' "$W/g.txt"; then
  ok 'control: the real gap is reported at its own line, not at the header above it'
else
  bad "control: the gap line is wrong: $(grep 'PARSER GAP (site)' "$W/g.txt" | head -1)"
fi

# 6. THE HELPER ONLY COLLECTS HEADERS IT SHOULD. A plain `for` is not suppressed —
#    it mints no site, so adding its line would widen the rule for no benefit.
if GUARD_DIR="$HERE" "$PY" - "$W/src/pkg/mod.py" <<'PYEOF'
import sys, os
sys.path.insert(0, os.environ['GUARD_DIR'])
from coverage_guard import _protocol_header_lines
got = _protocol_header_lines(sys.argv[1])
# 15 = `with lock:`, 20 = `with make_lock():`, 25 = `with lock:`, 26 = `for` inside it
# 30 = a PLAIN `for`, which must NOT be collected
sys.exit(0 if (15 in got and 26 in got and 30 not in got) else 1)
PYEOF
     2>/dev/null
then
  ok 'the header set holds both `with` kinds and the enclosed `for`, and not a plain `for`'
else
  bad 'the header set is wrong: a plain `for` is collected, or a `with` header is not'
fi

if [ "$fail" -ne 0 ]; then
  echo "protocol-calls: FAILED ($checks checks)"
  exit 1
fi
echo "protocol-calls: ok ($checks checks)"
