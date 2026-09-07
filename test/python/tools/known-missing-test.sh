#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# THE DEBT LIST MUST BE RECONCILED IN BOTH DIRECTIONS, OR IT IS NOT A GATE.
#
# oracle_check.py used to fail on ANY missing edge, with no way to record an accepted one. A
# miss is a COVERAGE number, not a defect like a fabrication or a dropped site — so the gate
# could only be green at 100% recall, which for a case named 12-blind-spots is never, and
# `--oracle` was permanently red. Nobody ran it, which cost the only check that compares the
# engine against CPython's own answers. See issue #264.
#
# expected/<case>.known-missing fixes that, and the SECOND direction is what keeps it honest:
# a listed edge that starts resolving must also fail, or the list rots into a record of things
# that were fixed long ago and the gate quietly stops asserting anything. Same discipline as
# test/java's known-missing.
#
# All three failure directions are asserted here by perturbing the list — not the engine — so
# the test needs no engine change and cannot be satisfied by a golden re-bless.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PYTHON_DIR="$(cd "$HERE/.." && pwd)"
CASE=12-blind-spots
SRC="$PYTHON_DIR/cases/$CASE/src"
KNOWN="$PYTHON_DIR/expected/$CASE.known-missing"
PY="${AXIOM_PY_PYTHON:-/usr/local/bin/python3.10}"

command -v "$PY" >/dev/null 2>&1 || { echo "known-missing: SKIP (no pinned interpreter at $PY)"; exit 0; }
ORACLE="${AXIOM_PY_ORACLE:-$PYTHON_DIR/../../../callchain-oracle/python}"
[ -d "$ORACLE/callchain_oracle" ] || { echo "known-missing: SKIP (no harness at $ORACLE)"; exit 0; }
[ -f "$KNOWN" ] || { echo "  FAIL  $KNOWN is missing"; echo "known-missing: FAILED"; exit 1; }

W="$(mktemp -d)"; trap 'cp -f "$W/orig" "$KNOWN"; rm -rf "$W"' EXIT
cp -f "$KNOWN" "$W/orig"

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${KNOWN_MISSING_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

# SYNTHESISED INPUT, not a previous run's output. What is under test is the RECONCILIATION —
# an unlisted miss fails, a listed edge that resolves fails, a stale entry fails — and none of
# that depends on the engine's actual edges. So the pairs file is "every expected edge except the
# recorded gaps": what a perfect engine would emit. That keeps this self-contained and fast, so it
# runs every time rather than skipping whenever no work dir happens to be lying around. A check
# that usually skips is the defect this area keeps producing (#196, #224, #254).
export AXIOM_PY_ORACLE="$ORACLE"
"$PY" "$HERE/known_missing_pairs.py" "$SRC" "$W/orig" > "$W/pairs" 2>"$W/pairs.err" || {
  echo "  FAIL  could not synthesise the engine pairs:"; sed 's/^/          /' "$W/pairs.err" | head -6
  echo "known-missing: FAILED"; exit 1; }
[ -s "$W/pairs" ] || { echo "  FAIL  synthesised pairs file is empty"; echo "known-missing: FAILED"; exit 1; }

# --sites is omitted deliberately: conservation is scored from it, and this test is about the
# missing-edge reconciliation. oracle_check treats an absent --sites as "not supplied".
run(){ "$PY" "$HERE/oracle_check.py" "$CASE" "$SRC" --pairs "$W/pairs" > "$W/out.txt" 2>&1; echo $?; }

# ── 1. the list as committed reconciles ─────────────────────────────────────
rc="$(run)"
[ "$rc" = 0 ] && ok "the committed known-missing list reconciles" \
  || { bad "the committed list does not reconcile (exit $rc):"; sed 's/^/          /' "$W/out.txt" | head -8; }

# ── 2. an UNLISTED miss must fail ───────────────────────────────────────────
grep -v '^main.py:64' "$W/orig" > "$KNOWN"
rc="$(run)"
if [ "$rc" != 0 ] && grep -q 'NEW MISSING EDGE' "$W/out.txt"; then
  ok "an unlisted missing edge fails, and is named"
else
  bad "dropping an entry did not produce a NEW MISSING EDGE failure (exit $rc):"
  sed 's/^/          /' "$W/out.txt" | head -8
fi

# ── 3. a listed edge that RESOLVES must fail ────────────────────────────────
# Simulated by listing an edge the engine already emits: `known` then contains a pair that is
# expected and NOT missing, which is exactly the now-fixed shape.
resolved="$(head -1 "$W/pairs")"
{ cat "$W/orig"; printf '%s\n' "$resolved"; } > "$KNOWN"
rc="$(run)"
if [ "$rc" != 0 ] && grep -q 'NOW RESOLVES' "$W/out.txt"; then
  ok "a listed edge the engine resolves fails, so the list cannot rot"
else
  bad "listing an already-resolved edge did not fail (exit $rc):"
  sed 's/^/          /' "$W/out.txt" | head -8
fi

# ── 4. a STALE entry naming no expected edge must fail ──────────────────────
{ cat "$W/orig"; printf 'main.py:999\tmain.py:998\n'; } > "$KNOWN"
rc="$(run)"
if [ "$rc" != 0 ] && grep -q 'NOT AN EXPECTED EDGE' "$W/out.txt"; then
  ok "an entry that names no expected edge fails, rather than asserting nothing"
else
  bad "a stale entry did not fail (exit $rc):"
  sed 's/^/          /' "$W/out.txt" | head -8
fi

# ── 5. comments and blank lines are not entries ─────────────────────────────
{ cat "$W/orig"; printf '\n# a trailing comment\n   \n'; } > "$KNOWN"
rc="$(run)"
[ "$rc" = 0 ] && ok "comments and blank lines are ignored" \
  || { bad "a comment or blank line was read as an entry (exit $rc):"; sed 's/^/          /' "$W/out.txt" | head -6; }

cp -f "$W/orig" "$KNOWN"
[ "$fail" = 0 ] && echo "known-missing: ok ($checks checks)" || echo "known-missing: FAILED"
exit "$fail"
