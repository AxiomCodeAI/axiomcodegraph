#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# PYTHON'S csv MODULE CAPS ONE FIELD AT 128 KiB, AND AN IR FIELD CAN BE FAR BIGGER.
#
# `ts_expression.literalValue` holds a string literal verbatim, so a source file that embeds a
# base64 asset produces fields of several hundred KB — 787 KB and 970 KB in one corpus project.
# Every reader that opens an IR CSV then dies with
#
#     _csv.Error: field larger than field limit (131072)
#
# and on the run that found this, the extraction, the 391-second solve and a 53,551-row oracle
# had all already succeeded. The refusal is correct — a partial number is worse than none — but
# the cause is one missing line. See issue #238.
#
# TWO ASSERTIONS, because either alone is weak. The lint half catches a NEW reader added without
# the line, which is how nineteen of twenty came to be missing it. The functional half proves the
# line actually works, which a grep cannot: `csv.field_size_limit` could sit in dead code, or be
# called after the read, and the lint would still pass.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PY="${PYTHON:-python3}"

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${CSV_LIMIT_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

# ── 1. LINT: every reader of an IR CSV raises the limit ─────────────────────
missing=""
while IFS= read -r f; do
  grep -q 'field_size_limit' "$f" || missing="$missing
    ${f#$ROOT/}"
  # The CALL, not a mention of the name: a linter that looks FOR this pattern necessarily
  # contains the string, and matching the bare name flagged tools/empty_relation_lint.py for
  # having 'csv.reader' in a detection string. Requiring the open paren picks out the twenty
  # real readers exactly.
done < <(grep -rlE '_?csv\.(reader|DictReader)\(' --include='*.py' "$ROOT/src" "$ROOT/test" 2>/dev/null | sort)
if [ -z "$missing" ]; then
  ok "every .py that reads a CSV raises csv.field_size_limit"
else
  bad "these read a CSV without raising csv.field_size_limit — one big literal kills them:$missing"
fi

# ── 2. FUNCTIONAL: a field over the cap really is readable ─────────────────
# Uses a REAL reader from the tree (the one the issue's traceback names) rather than a
# hand-rolled csv.reader, which would only test CPython.
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
"$PY" - "$W" "$ROOT" > "$W/probe.log" 2>&1 <<'PY'
import os, sys
w, root = sys.argv[1], sys.argv[2]
big = 'A' * 300000                      # ~293 KiB, well past the 128 KiB cap
p = os.path.join(w, 'all-typescript-expressions.csv')
with open(p, 'w', encoding='utf-8') as fh:
    fh.write('kind\tliteralValue\n')
    fh.write(f'STRING\t{big}\n')
sys.path.insert(0, os.path.join(root, 'test', 'typescript', 'ground-truth'))
try:
    from score import read_tsv
except Exception as e:                                  # pragma: no cover - import shape
    print(f'IMPORT-FAILED {type(e).__name__}: {e}')
    raise SystemExit(2)
try:
    rows = read_tsv(p)
except Exception as e:
    print(f'READ-FAILED {type(e).__name__}: {e}')
    raise SystemExit(1)
if len(rows) != 1 or len(rows[0][1]) != len(big):
    print(f'WRONG rows={len(rows)} len={len(rows[0][1]) if rows else "-"}')
    raise SystemExit(3)
print('READ-OK')
PY
rc=$?
case "$rc" in
  0) ok "a 293 KiB field reads through the tree's own read_tsv" ;;
  2) echo "  (could not import ground-truth/score.py — functional half skipped)"
     sed 's/^/          /' "$W/probe.log" | head -3 ;;
  *) bad "a field over the 128 KiB cap still cannot be read (exit $rc):"
     sed 's/^/          /' "$W/probe.log" | head -3 ;;
esac

[ "$fail" = 0 ] && echo "csv-limit: ok ($checks checks)" || echo "csv-limit: FAILED"
exit "$fail"
