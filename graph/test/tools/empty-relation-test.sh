#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A RELATION WITH NO ROWS IS NOT A DRIFTED SCHEMA.
#
# The parser writes a relation with no rows as a ZERO-BYTE file — not a header, zero bytes — so
# `h = next(reader)` raises StopIteration. In schema_drift.py that propagated out of the gate and
# the TypeScript harness reported
#
#     ! refusing to measure against a drifted schema
#
# which is the one failure mode that gate exists to catch, and was not what had happened. The run
# stopped before the solve. Eleven such files appear on a two-file synthetic project. See #244.
#
# TWO ASSERTIONS. The functional half feeds a real zero-byte relation to the real gate, because
# that is the thing that broke. The lint half (tools/empty_relation_lint.py) walks the AST of
# every CSV reader in the tree for the same unsafe shape, because the defect was in three places
# and only one of them crashed — the pattern this area keeps repeating (#238 was reported in five
# files and was live in eighteen).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"  # the repository root, found by its marker — no level counting
PY="${PYTHON:-python3}"

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${EMPTY_RELATION_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

# ── 1. LINT: no unguarded next() anywhere a CSV is read ────────────────────
if out="$("$PY" "$HERE/empty_relation_lint.py" "$ROOT" 2>&1)"; then
  ok "${out#empty-relation lint: ok }"
else
  bad "an unguarded next() would die on a relation with no rows:"
  printf '%s\n' "$out" | sed 's/^/          /' | head -12
fi

# ── 2. FUNCTIONAL: the real gate gives a VERDICT, it does not crash ────────
# Synthesised, not taken from a work dir, so this runs on every invocation.
#
# THE ASSERTION IS "no traceback", not "exit 0", and that is the whole point of the issue. This
# minimal IR does not match the real 43-column declaration, so schema_drift SHOULD report drift
# and exit 1 — that is the gate working. What must never happen is StopIteration escaping, which
# made the harness blame a drifted schema for a relation that simply had no rows. So: a verdict,
# whatever its verdict, rather than a stack trace.
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/ir"
printf 'name\tparameterCount\ttsMethodUniqueHash\n' > "$W/ir/all-typescript-methods.csv"
printf 'first\t0\tH1\n' >> "$W/ir/all-typescript-methods.csv"
: > "$W/ir/all-typescript-method-parameters.csv"          # zero bytes: the relation has no rows
[ ! -s "$W/ir/all-typescript-method-parameters.csv" ] || { echo "  FAIL  fixture is not zero-byte"; exit 1; }

out="$("$PY" "$ROOT/graph/test/typescript/tools/schema_drift.py" "$W/ir" 2>&1)"; rc=$?
if printf '%s\n' "$out" | grep -qi 'stopiteration\|Traceback (most recent call last)'; then
  bad "a zero-byte relation still crashes schema_drift instead of producing a verdict:"
  printf '%s\n' "$out" | sed 's/^/          /' | tail -6
elif [ "$rc" -gt 1 ]; then
  bad "schema_drift exited $rc — neither a clean pass nor a reported verdict:"
  printf '%s\n' "$out" | sed 's/^/          /' | tail -6
else
  ok "a zero-byte relation yields a verdict (exit $rc), not a traceback"
fi

[ "$fail" = 0 ] && echo "empty-relation: ok ($checks checks)" || echo "empty-relation: FAILED"
exit "$fail"
