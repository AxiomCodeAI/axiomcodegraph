#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Staging copies every IR CSV into a Soufflé fact file and drops the rows whose field count differs
# from the header's (graph/pipeline/stage-rows.sh). It runs perl where perl exists and awk where it
# does not, so the two must print the same bytes: a difference would make the facts, and so the
# graph, a function of which tools the machine happens to have.
#
# Each fixture below is staged by both, and the stdout bytes and the stderr report must match. The
# fixtures are the shapes where a line-based tab counter and awk's field splitting could part: a
# trailing tab (an empty last field), an empty line, CRLF, a last line with no newline, a header with
# no newline, an empty file, a quoted field holding a tab (both see two fields: neither parses quotes),
# bytes that are not UTF-8, and torn rows of both kinds (too few fields, too many).
# A NUL byte is left out on purpose: BSD awk ends the line at it (and drops the row as torn) while gawk
# and perl keep the whole line, so awk does not agree with itself there and is no reference.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
unset AXIOM_STAGE_WITH
ROOT="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"

command -v perl >/dev/null 2>&1 || { echo "stage-rows-test: FAILED (no perl on PATH; this test compares perl against awk)"; exit 1; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
fail=0; checks=0
bad(){ checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }
ok(){  checks=$((checks+1)); }

# The tool the sourced file picks: perl here, awk when forced.
( . "$ROOT/graph/pipeline/stage-rows.sh"; [ "$STAGE_ROWS_TOOL" = perl ] ) && ok || bad "stage-rows.sh did not pick perl although perl is on PATH"
( AXIOM_STAGE_WITH=awk; . "$ROOT/graph/pipeline/stage-rows.sh"; [ "$STAGE_ROWS_TOOL" = awk ] ) && ok || bad "AXIOM_STAGE_WITH=awk did not force awk"

printf 'a\tb\tc\n1\t2\t3\n4\t5\t6\n'                         > "$W/clean.csv"
printf 'a\tb\tc\n1\t2\t3\n1\t2\n1\t2\t3\t4\n7\t8\t9\n'       > "$W/torn.csv"
printf 'a\tb\tc\n1\t2\t\n\t\t\n1\t2\t3\t\n'                  > "$W/trailing-tab.csv"
printf 'a\tb\tc\n1\t2\t3\n\n4\t5\t6\n\n'                      > "$W/empty-line.csv"
printf 'a\tb\tc\r\n1\t2\t3\r\n4\t5\r\n'                       > "$W/crlf.csv"
printf 'a\tb\tc\n1\t2\t3\n4\t5\t6'                            > "$W/no-final-newline.csv"
printf 'a\tb\tc\n1\t2'                                        > "$W/torn-last-line.csv"
printf 'a\tb\tc'                                              > "$W/header-only-no-newline.csv"
printf 'a\tb\tc\n'                                            > "$W/header-only.csv"
: > "$W/empty.csv"
printf 'a\tb\n"x\ty"\tz\n"p\tq"\n'                            > "$W/quoted-tab.csv"
printf 'a\tb\n\xff\xfe\t\xc3\x28\n'                          > "$W/bytes.csv"
printf 'a\n1\n\n2\n'                                          > "$W/one-column.csv"
printf '\n\n1\n\n'                                            > "$W/empty-header.csv"

n=0
for f in "$W"/*.csv; do
  n=$((n+1)); name="$(basename "$f")"
  ( . "$ROOT/graph/pipeline/stage-rows.sh"; stage_rows "$f" ) > "$W/p.out" 2> "$W/p.err"; prc=$?
  ( AXIOM_STAGE_WITH=awk; . "$ROOT/graph/pipeline/stage-rows.sh"; stage_rows "$f" ) > "$W/a.out" 2> "$W/a.err"; arc=$?
  [ "$prc" = 0 ] && [ "$arc" = 0 ] && ok || bad "$name: exit status perl=$prc awk=$arc"
  cmp -s "$W/p.out" "$W/a.out" && ok || { bad "$name: staged rows differ"; od -c "$W/a.out" | sed 's/^/        awk  /'; od -c "$W/p.out" | sed 's/^/        perl /'; }
  cmp -s "$W/p.err" "$W/a.err" && ok || bad "$name: report differs: perl '$(cat "$W/p.err")' awk '$(cat "$W/a.err")'"
done

# Not vacuous: the fixtures must hold rows that are kept and rows that are dropped.
( . "$ROOT/graph/pipeline/stage-rows.sh"; stage_rows "$W/torn.csv" ) > "$W/t.out" 2> "$W/t.err"
[ "$(printf '1\t2\t3\n7\t8\t9\n')" = "$(cat "$W/t.out")" ] && ok || bad "torn.csv: expected the two whole rows, got '$(cat "$W/t.out")'"
grep -q "dropped 2 malformed row(s) from $W/torn.csv" "$W/t.err" && ok || bad "torn.csv: expected a report of 2 dropped rows, got '$(cat "$W/t.err")'"
# The control: a clean file comes through as its rows, header removed, nothing reported.
( . "$ROOT/graph/pipeline/stage-rows.sh"; stage_rows "$W/clean.csv" ) > "$W/c.out" 2> "$W/c.err"
tail -n +2 "$W/clean.csv" | cmp -s - "$W/c.out" && [ ! -s "$W/c.err" ] && ok || bad "clean.csv: not passed through unchanged"

[ "$n" -ge 14 ] || bad "only $n fixtures were staged"
[ $fail = 0 ] && echo "stage-rows-test: ok ($checks checks over $n fixtures)" || { echo "stage-rows-test: FAILED"; exit 1; }
