#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# THE CI GATE. Silently-dropped call sites must be ZERO.
#
# This is separated from the rest of the suite because it is the one invariant a
# golden diff structurally cannot check: you cannot notice the absence of
# something that was never recorded. A golden file full of correct edges is
# perfectly consistent with an engine that quietly discards every construct it
# does not understand — and that engine reports excellent precision.
#
# It is also the check that must survive a red suite. While the rule set is being
# written, goldens churn and scores move; "no site vanished" does not, so it can
# be enforced from the first rule onwards.
#
# Exits non-zero if ANY case drops a site, or if the frozen ground truth is
# missing, stale or tampered with.
#
#   ./ci-conservation.sh            all cases
#   ./ci-conservation.sh 04 05      only matching cases
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# Resolve the pinned interpreter through PATH, never as an absolute prefix.
# run-tests.sh states the reason for its own copy of this and it applies verbatim
# here: "pinning an absolute PATH is a different thing, and the wrong one" — a
# Homebrew-on-Intel-macOS location makes this gate unrunnable on Linux, Apple
# Silicon, pyenv or any CI image, reported as a "missing interpreter" that reads
# like a broken checkout. /usr/local/bin/python3.10 is exactly that prefix.
find_pinned_python() {
  local c p
  for c in python3.10 python3; do
    p="$(command -v "$c" 2>/dev/null)" && [ -n "$p" ] && { printf '%s\n' "$p"; return; }
  done
}
PY="${AXIOM_PY_PYTHON:-$(find_pinned_python)}"
export AXIOM_PY_ORACLE="${AXIOM_PY_ORACLE:-$ROOT/../callchain-oracle/python}"
FILTERS=("$@")

command -v "$PY" >/dev/null 2>&1 || { echo "SKIP: pinned interpreter missing ($PY)"; exit 77; }
[ -d "$AXIOM_PY_ORACLE/callchain_oracle" ] || { echo "SKIP: harness missing ($AXIOM_PY_ORACLE)"; exit 77; }

rc=0
for dir in "$HERE"/cases/*/; do
  name="$(basename "$dir")"
  [ -d "$dir/src" ] || continue
  if [ ${#FILTERS[@]} -gt 0 ]; then
    match=0; for f in "${FILTERS[@]}"; do [[ "$name" == *"$f"* ]] && match=1; done
    [ $match -eq 1 ] || continue
  fi
  printf '%-26s ' "$name"
  w="$HERE/.work/$name"

  # Ground truth must be intact before any number derived from it means anything.
  if ! out=$("$PY" "$HERE/tools/oracle_check.py" "$name" "$dir/src" 2>&1); then
    echo "FAIL (ground truth)"; echo "$out" | sed 's/^/    /' | head -8; rc=1; continue
  fi

  if [ -f "$w/engine.sites" ]; then
    # CAPTURE FIRST, THEN GREP. `set -o pipefail` is on, and oracle_check.py exits
    # non-zero for a SCORING failure (a missing or fabricated edge) as well as for a
    # dropped site -- so piping it straight into grep made the pipeline status 1 even
    # when the conservation line said OK, and this gate reported a silent drop that had
    # not happened. That defeats the one thing this file exists for: "no site vanished"
    # must stay checkable while goldens churn and scores move.
    out=$("$PY" "$HERE/tools/oracle_check.py" "$name" "$dir/src" \
            --pairs "$w/engine.pairs" --sites "$w/engine.sites" 2>&1) || true
    if ! printf '%s\n' "$out" | grep -q 'SILENTLY DROPPED (OK)'; then
      echo "FAIL (silent drop)"
      printf '%s\n' "$out" | grep -E 'SILENTLY DROPPED|DROP ' | sed 's/^/    /' | head -8
      rc=1; continue
    fi
    echo "ok (conservation held)"
  else
    # No engine output yet. The ground truth is still verified above, and that is
    # reported honestly rather than as a pass for a check that did not run.
    echo "ground truth ok — engine not run, conservation NOT yet measurable"
  fi
done
echo "─────────────────────────────────────────────"
[ $rc -eq 0 ] && echo "conservation gate: OK" || echo "conservation gate: FAILED"
exit $rc
