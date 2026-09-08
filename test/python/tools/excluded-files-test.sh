#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A FILE THE CALLER NEVER HANDED THE PARSER IS NOT A PARSER GAP.
#
# Check 2's file half takes its denominator from `sites_for_tree`, which walks the
# SOURCE tree, and its numerator from the IR. On an `excludeTests=true` extraction those
# are different populations: the parser never SEES an excluded file, so it cannot list it
# in `skipped-python-files.csv` either — that relation records files the parser was handed
# and could not use. Every excluded file therefore became a `PARSER GAP (file)` and the
# check failed BY CONSTRUCTION on the mode the corpus workflow requires, where the
# operator is told a red here is a P0. Reproduced on a package whose tests live inside it,
# one flag the only difference:
#
#     excludeTests=false   4 module rows   0 file gaps
#     excludeTests=true    2 module rows   1 file gap   <- invented
#
# See issue #305. #224 proposed a hardcoded directory list for this and it was correctly
# rejected, because it would hide a real drop on an excludeTests=false run — so the rule
# is DERIVED from per-directory coverage instead.
#
# ── WHAT THE CONTROLS ARE FOR ───────────────────────────────────────────────
# The derivation suppresses a failure, so the whole risk is suppressing too much. TWO of
# the five checks are true controls — they hold both before and after this change: a file
# missing from a directory that HAS module rows is still a gap, and a file the parser DID
# skip is still handled by the pre-existing route. Getting either wrong turns this gate
# off.
#
# A third check — an IR with no module rows at all — is a SAFETY ASSERTION on the new
# path rather than a control. Before this change the question could not arise, because
# there was no derivation to be too permissive; with one, an empty IR would make every
# directory wholesale-absent and the check would pass in silence, which is worse than
# the false failure being fixed.
#
# SYNTHESISED IR — two CSVs and a source tree, no parser and no engine. Check 2 is
# interpreter-pinned by design (tier 1's opcode model is not stable across minor
# versions), so this needs the pinned CPython and says so when it is absent.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD="$HERE/coverage_guard.py"

if [ ! -f "$GUARD" ]; then
  echo "  FAIL  tools/coverage_guard.py is missing; every check below would pass vacuously"
  echo "excluded-files: FAILED (1 check)"
  exit 1
fi

# The pinned interpreter, the same way run-tests.sh resolves it.
PINNED="$(sed -n 's/^PINNED = (\([0-9]*\), \([0-9]*\))$/\1.\2/p' "$HERE/vendor/tier1_sites.py" | head -1)"
[ -n "$PINNED" ] || PINNED=3.10
PY=""
for c in "${AXIOM_PY_PINNED:-}" "python$PINNED" "/usr/local/bin/python$PINNED" \
         "/opt/homebrew/bin/python$PINNED"; do
  [ -n "$c" ] && command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }
done
if [ -z "$PY" ]; then
  echo "  SKIP  excluded-files: CPython $PINNED not found; check 2 is pinned to it and"
  echo "        skips on any other version, so there would be nothing to assert"
  exit 0
fi

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${EXCLUDED_FILES_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

# One source tree, reused by every scenario. `pkg/` holds two modules; `pkg/tests/` is
# the directory a caller would exclude.
mkdir -p "$W/src/pkg/tests"
printf 'def helper(x):\n    return x + 1\n\n\ndef run(x):\n    return helper(x)\n' > "$W/src/pkg/core.py"
printf 'def aux(y):\n    return aux2(y)\n\n\ndef aux2(y):\n    return y\n'         > "$W/src/pkg/helper.py"
printf 'from pkg.core import run\n\n\ndef test_run():\n    assert run(1) == 2\n'   > "$W/src/pkg/tests/test_a.py"

# run <scenario> <module-rows...> ; writes $W/<scenario>.txt
run_guard() {
  local name="$1"; shift
  local ir="$W/ir-$name" out="$W/out-$name"
  rm -rf "$ir" "$out"; mkdir -p "$ir" "$out"
  : > "$out/call-chain-edges.csv"
  printf 'filePath\tqualifiedName\n' > "$ir/all-python-modules.csv"
  local f
  for f in "$@"; do printf '%s\t%s\n' "$f" "${f%.py}" >> "$ir/all-python-modules.csv"; done
  printf 'filePath\treason\n' > "$ir/skipped-python-files.csv"
  [ -n "${SKIPPED_FILE:-}" ] && printf '%s\tunsupported\n' "$SKIPPED_FILE" >> "$ir/skipped-python-files.csv"
  ( cd "$HERE/.." && "$PY" "$GUARD" "$ir" "$out" "$W/src" ) > "$W/$name.txt" 2>&1
  return 0
}
file_gaps() { grep -c 'PARSER GAP (file)' "$W/$1.txt" || true; }

# 1. THE FIX. pkg/tests/ has no module row anywhere in it, so the caller excluded it.
SKIPPED_FILE= run_guard excluded pkg/core.py pkg/helper.py
if [ "$(file_gaps excluded)" = "0" ]; then
  ok 'a wholesale-absent directory is not reported as a parser gap'
else
  bad "the excluded directory is still a file gap: $(grep 'PARSER GAP (file)' "$W/excluded.txt" | head -1)"
fi

# 2. AND IT IS ANNOUNCED, not silently dropped. The derivation cannot tell a
#    caller-excluded directory from the parser losing the only file in one, so the
#    suppression has to stay visible to a reader.
if grep -q 'excluded by the caller  pkg/tests/' "$W/excluded.txt"; then
  ok 'the suppression names the directory and its file count'
else
  bad 'the directory was suppressed with no mention of it in the output'
fi

# 3. CONTROL — A REAL DROP IS STILL A GAP. pkg/helper.py is absent while pkg/core.py in
#    the SAME directory has a row, so the parser saw the directory and lost a file.
SKIPPED_FILE= run_guard mixed pkg/core.py
if grep -q 'PARSER GAP (file)  pkg/helper.py' "$W/mixed.txt"; then
  ok 'control: a file missing from a covered directory is still a gap'
else
  bad 'control: a REAL parser drop was suppressed — this turns the gate off'
fi

# 4. SAFETY ASSERTION on the new path (not a control — the question does not arise
#    without the derivation). With no module rows every directory is wholesale-absent, so
#    the naive rule would pass in silence on an IR containing nothing, which is worse
#    than the false failure this fixes.
SKIPPED_FILE= run_guard empty
if grep -q 'the IR has NO module rows at all' "$W/empty.txt"; then
  ok 'an IR with no modules is an extraction failure, not an exclusion'
else
  bad 'an empty IR passed as though everything had been excluded'
fi

# 5. CONTROL — the pre-existing route still works. A file the parser was handed and
#    could not use is recorded in skipped-python-files.csv and was never a gap; that must
#    not change, and it must not need the new derivation either.
SKIPPED_FILE=pkg/helper.py run_guard skippedroute pkg/core.py
if grep -q 'PARSER GAP (file)  pkg/helper.py' "$W/skippedroute.txt"; then
  bad 'control: a file listed in skipped-python-files.csv became a gap'
else
  ok 'control: a parser-skipped file is still handled by the skipped route'
fi

if [ "$fail" -ne 0 ]; then
  echo "excluded-files: FAILED ($checks checks)"
  exit 1
fi
echo "excluded-files: ok ($checks checks)"
