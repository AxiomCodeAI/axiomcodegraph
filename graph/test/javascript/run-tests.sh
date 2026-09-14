#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# axiom-code-graph — JavaScript engine regression suite
#
# For every case in test/javascript/cases/<name>:
#   1. parse cases/<name>/src to IR                 (external parser, $AXIOM_PARSER)
#   2. parse cases/<name>/lib to IR, if present     (the case's own "library", staged
#                                                    with --library exactly as a real
#                                                    dependency parsed from source is)
#   3. solve CLIENT-ONLY (empty --library)          -> expected/<name>.edges
#   4. solve WITH LIBRARY, if present               -> expected/<name>.lib.edges
#   5. COVERAGE GUARD on both: no call site may vanish silently
#   6. with --oracle, score against the TypeScript compiler (allowJs/checkJs):
#        expected/<name>.oracle — one line per compiler-decided site with its bucket.
#      A MISSED or WRONG line fails the run whether or not the golden was rewritten:
#      --bless cannot bless away a regression against the compiler. A known gap is
#      listed in expected/<name>.known-missing (one site per line, `#` comments).
#
#   ./run-tests.sh                 run every case
#   ./run-tests.sh 04 06           run cases matching those substrings
#   ./run-tests.sh --bless         regenerate goldens from the current engine (review!)
#   ./run-tests.sh --oracle        ALSO validate against the compiler
#   ./run-tests.sh --keep          keep the per-case work dirs
#
# Environment:
#   AXIOM_PARSER   path to the parser entrypoint  (default parser/dist/index.js in this repository)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PARSER="${AXIOM_PARSER:-$ROOT/parser/dist/index.js}"
WORK="$HERE/.work"
BLESS=0; KEEP=0; ORACLE=0; FILTERS=()
for a in "$@"; do case "$a" in
  --bless) BLESS=1;; --keep) KEEP=1;; --oracle) ORACLE=1;;
  -h|--help) sed -n '2,26p' "$0"; exit 0;; *) FILTERS+=("$a");; esac; done
[ -f "$PARSER" ] || { echo "SKIP: parser not found at $PARSER (set AXIOM_PARSER)"; exit 77; }
if [ "$BLESS" = "1" ] && [ "$ORACLE" != "1" ]; then
  n_oracle=$(find "$HERE/expected" -name '*.oracle' 2>/dev/null | wc -l | tr -d ' ')
  if [ "${n_oracle:-0}" -gt 0 ]; then
    echo "REFUSING: --bless without --oracle would leave $n_oracle .oracle golden(s) describing the previous engine."
    echo "  Run:  ./run-tests.sh ${FILTERS[*]:-} --bless --oracle"; exit 2
  fi
fi
mkdir -p "$WORK"
EMPTY_LIB="$WORK/.empty-library"; mkdir -p "$EMPTY_LIB"
pass=0; fail=0; failed=()

solve() {
  bash "$ROOT/graph/pipeline/run-souffle.sh" --debug --language javascript \
    --client-ir "$1" --library "$2" --intermediate "$3/int" --output "$3/out" >"$3/solve.log" 2>&1
}
check_golden() {
  local actual="$1" exp="$2" label="$3"
  if [ "$BLESS" = "1" ]; then
    if [ -f "$exp" ] && ! diff -q "$exp" "$actual" >/dev/null; then
      echo "BLESSED $label (changed)"; diff -u "$exp" "$actual" | sed 's/^/    /' | head -30; fi
    cp "$actual" "$exp"; return 0
  fi
  [ -f "$exp" ] || { echo "FAIL ($label: no golden — run with --bless --oracle)"; return 1; }
  diff -q "$exp" "$actual" >/dev/null && return 0
  echo "FAIL ($label changed)"; diff -u "$exp" "$actual" | sed 's/^/    /' | head -40; return 1
}
# oracle_check <ir> <out> <src> <work> <golden> <known-missing>
oracle_check() {
  local ir="$1" out="$2" src="$3" w="$4" golden="$5" known="$6"
  node "$HERE/ground-truth/tsc-oracle.mjs" "$src" "$w/oracle.tsv" >"$w/oracle.log" 2>&1 || { echo "FAIL (oracle — see $w/oracle.log)"; return 1; }
  python3 "$HERE/ground-truth/score.py" "$ir" "$out" "$w/oracle.tsv" --dump="$w/score-rows.tsv" >"$w/score.txt" 2>&1 || { echo "FAIL (score — see $w/score.txt)"; return 1; }
  python3 "$HERE/tools/oracle_diff.py" "$ir" "$out" "$w/oracle.tsv" "$w/score-rows.tsv" >"$w/actual.oracle"
  # a defect is a MISSED/WRONG line not listed as known; a known one that stopped being a defect fails too
  local defects; defects="$(grep -E '  (MISSED|WRONG|LIB_WRONG|ENGINE_DROPPED)  ' "$w/actual.oracle" | cut -d' ' -f1)"
  local kn=""; [ -f "$known" ] && kn="$(grep -vE '^\s*(#|$)' "$known" | cut -d' ' -f1)"
  local new_defects; new_defects="$(comm -23 <(printf '%s\n' $defects | sort -u) <(printf '%s\n' $kn | sort -u) | sed '/^$/d')"
  local fixed; fixed="$(comm -13 <(printf '%s\n' $defects | sort -u) <(printf '%s\n' $kn | sort -u) | sed '/^$/d')"
  if [ -n "$new_defects" ]; then echo "FAIL (oracle: the compiler decided these and the engine did not agree)"; printf '    %s\n' $new_defects; return 1; fi
  if [ -n "$fixed" ]; then echo "FAIL (oracle: known-missing entries now resolve — remove them from $(basename "$known"))"; printf '    %s\n' $fixed; return 1; fi
  check_golden "$w/actual.oracle" "$golden" "oracle golden"
}

for dir in "$HERE"/cases/*/; do
  name="$(basename "$dir")"
  if [ ${#FILTERS[@]} -gt 0 ]; then
    match=0; for f in "${FILTERS[@]}"; do [[ "$name" == *"$f"* ]] && match=1; done
    [ $match -eq 1 ] || continue
  fi
  w="$WORK/$name"; rm -rf "$w"; mkdir -p "$w/ir" "$w/libir" "$w/plain" "$w/withlib"
  printf '%-40s ' "$name"
  if ! node "$PARSER" "$dir/src" "$name" false "$w/ir" >"$w/parse.log" 2>&1; then
    echo "FAIL (parse client — see $w/parse.log)"; fail=$((fail+1)); failed+=("$name"); continue; fi
  HAS_LIB=0
  if [ -d "$dir/lib" ] && [ -n "$(ls -A "$dir/lib" 2>/dev/null)" ]; then
    if ! node "$PARSER" "$dir/lib" "$name-lib" false "$w/libir" >"$w/parse-lib.log" 2>&1; then
      echo "FAIL (parse library — see $w/parse-lib.log)"; fail=$((fail+1)); failed+=("$name"); continue; fi
    [ -s "$w/libir/all-javascript-modules.csv" ] && HAS_LIB=1
  fi
  ok=1
  if ! solve "$w/ir" "$EMPTY_LIB" "$w/plain"; then echo "FAIL (solve — see $w/plain/solve.log)"; ok=0; fi
  if [ $ok = 1 ] && ! python3 "$HERE/tools/coverage_guard.py" "$w/ir" "$w/plain/out/raw" >"$w/coverage.txt" 2>&1; then
    echo "FAIL (silent drop)"; sed 's/^/    /' "$w/coverage.txt" | head -12; ok=0; fi
  if [ $ok = 1 ]; then
    python3 "$HERE/tools/normalize_edges.py" "$w/ir" "$w/plain/out/raw" > "$w/actual.edges" 2>"$w/norm.log" || { echo "FAIL (normalize)"; ok=0; }
  fi
  if [ $ok = 1 ]; then check_golden "$w/actual.edges" "$HERE/expected/$name.edges" "edges" || ok=0; fi
  if [ $ok = 1 ] && [ "$ORACLE" = "1" ]; then
    oracle_check "$w/ir" "$w/plain/out/raw" "$dir/src" "$w" "$HERE/expected/$name.oracle" "$HERE/expected/$name.known-missing" || ok=0
  fi
  if [ $ok = 1 ] && [ "$HAS_LIB" = "1" ]; then
    if ! solve "$w/ir" "$w/libir" "$w/withlib"; then echo "FAIL (solve with library)"; ok=0; fi
    if [ $ok = 1 ] && ! python3 "$HERE/tools/coverage_guard.py" "$w/ir" "$w/withlib/out/raw" >"$w/coverage-lib.txt" 2>&1; then echo "FAIL (silent drop, with library)"; ok=0; fi
    if [ $ok = 1 ]; then
      python3 "$HERE/tools/normalize_edges.py" "$w/ir" "$w/withlib/out/raw" "$w/libir" > "$w/actual.lib.edges" 2>>"$w/norm.log"
      check_golden "$w/actual.lib.edges" "$HERE/expected/$name.lib.edges" "lib edges" || ok=0
    fi
  fi
  if [ $ok = 1 ]; then echo "ok"; pass=$((pass+1)); else fail=$((fail+1)); failed+=("$name"); fi
  [ "$KEEP" = "1" ] || rm -rf "$w"
done
echo; echo "passed: $pass  failed: $fail"
[ $fail -eq 0 ] || { printf '  %s\n' "${failed[@]}"; exit 1; }
