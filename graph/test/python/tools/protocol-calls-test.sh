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
ROOT="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"  # the repository root, found by its marker
GUARD="$HERE/coverage_guard.py"
PARSER="${AXIOM_PARSER:-$ROOT/parser/dist/index.js}"

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


def return_inside_with(payload):
    with lock:
        data = payload
        return data


def return_attr_inside_with(obj):
    with lock:
        return obj.value


def continue_inside_with(items):
    for it in items:
        with lock:
            if it:
                continue
    return 0


def return_call_inside_with(obj):
    with lock:
        return helper(obj).name


class Promise:
    pass


class __proxy__(Promise):
    """django's lazy proxy, and the shape that breaks a single-regex demangler.

    CPython strips the class's LEADING underscores only, so `self.__cast()` here
    mangles to `_proxy____cast` -- four underscores in the middle.
    """

    def __cast(self):
        return 1

    def __repr__(self):
        return repr(self.__cast())
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

# 6. THE `__exit__` A `return` PUTS ON THE RETURN LINE (#372). The exit call is compiled
#    onto the statement that leaves the block, so tier 1 names it after whatever that
#    statement loads -- `data` on line 43, `value` on line 48. Neither line holds a call.
if grep -qE 'PARSER GAP \(site\).*(data|value) \(via' "$W/g.txt"; then
  bad 'a `return` inside a `with` leaves the exit call reported as a parser gap' 
else
  ok 'the __exit__ a `return` inside a `with` puts on the return line is not a gap'
fi

# 7. AND THE ONE A `continue` PUTS ON THE ENCLOSING `for`. Same call, a third landing
#    site, and the reason this is keyed on a property rather than a list of shapes: the
#    `for` here ENCLOSES the `with`, so the old header rule -- which collected a `for`
#    only when it was INSIDE a `with` -- did not reach it.
if grep -q 'PARSER GAP (site).*items (via' "$W/g.txt"; then
  bad 'the __exit__ a `continue` puts on the enclosing `for` header is still a gap'
else
  ok 'the __exit__ a `continue` puts on the enclosing `for` header is not a gap'
fi

# 8. THE HELPER MAPS EACH LINE TO THE CALLEE NAMES WRITTEN ON IT. Positive and negative in
#    one assertion: the two real calls in headers are covered (so they stay adjudicable),
#    and the lines the exit call lands on hold no written call of any name.
# The redirect goes ON the command: a bare `2>/dev/null` on its own line after the heredoc
# terminator is a SEPARATE command in the `if` list, so the branch would be taken on ITS
# status (always 0) and the check would pass however the python exits. Verified by running
# this file against a tree without the helper: it reports the ImportError and fails.
if GUARD_DIR="$HERE" "$PY" - "$W/src/pkg/mod.py" 2>/dev/null <<'PYEOF'
import sys, os
sys.path.insert(0, os.environ['GUARD_DIR'])
from coverage_guard import _written_calls_by_line
got = _written_calls_by_line(sys.argv[1])
# line -> the callee NAMES written on it. Covered: 20 `with make_lock():`,
# 36 `for x in sorted(xs):`, 37 `yield helper(x)`. Holding no written call at all:
# 15 the bare `with lock:`, 26 the enclosed `for`, 43 and 48 the return lines, and
# 52 the `for` a `continue` inside a `with` puts the exit call on.
written = {20: 'make_lock', 36: 'sorted', 37: 'helper'}
sys.exit(0 if (got is not None
               and all(n in got.get(ln, ()) for ln, n in written.items())
               and not any(got.get(ln) for ln in (15, 26, 43, 48, 52))) else 1)
PYEOF
then
  ok 'the written-call line set covers the real calls and none of the protocol lines'
else
  bad 'the written-call line set is wrong: a real call is uncovered, or a protocol line is'
fi

# 9. THE EXIT CALL AND A REAL CALL ON THE SAME LINE. `return helper(obj).name` is both:
#    the exit call tier 1 names `name`, and the written `helper(obj)`. Keyed on the line
#    alone the whole line would go unadjudicable and the real call would stop being
#    checked; keyed on the name only the exit call is. So `name` must not be a gap AND
#    `helper` must still be adjudicated -- which check 4 above proves by deleting it.
if grep -q 'PARSER GAP (site).*name (via' "$W/g.txt"; then
  bad 'the exit call on a line that also holds a real call is still reported as a gap'
else
  ok 'an exit call sharing a line with a real call is suppressed and the real call is not'
fi

# 10. A MANGLED PRIVATE CALL IS CREDITED, NOT COUNTED MISSING. tier 1 reports
#     `_proxy____cast` and the parser records `__cast`; they are the same call. A
#     demangler that commits to the first split reads that as `proxy` + `____cast` and
#     credits nothing -- 16 invented gaps on one project from one class.
if grep -qE 'PARSER GAP \(site\).*(_proxy____cast|__cast)' "$W/g.txt"; then
  bad 'a mangled private call is reported as a gap: the demangler committed to one split'
else
  ok 'a mangled private call inside a class with underscores in its name is credited'
fi

# 11. AND THE MANGLED SPELLING IS IN THE WRITTEN SET, so a private call the parser DROPS
#     is still reported rather than falling into the complement and being suppressed.
if GUARD_DIR="$HERE" "$PY" - "$W/src/pkg/mod.py" 2>/dev/null <<'PYEOF'
import sys, os
sys.path.insert(0, os.environ['GUARD_DIR'])
from coverage_guard import _written_calls_by_line
got = _written_calls_by_line(sys.argv[1]) or {}
names = set().union(*got.values()) if got else set()
sys.exit(0 if {'__cast', '_proxy____cast'} <= names else 1)
PYEOF
then
  ok 'the written set carries both spellings of a mangled private call'
else
  bad 'the written set is missing a spelling of a mangled private call'
fi

if [ "$fail" -ne 0 ]; then
  echo "protocol-calls: FAILED ($checks checks)"
  exit 1
fi
echo "protocol-calls: ok ($checks checks)"
