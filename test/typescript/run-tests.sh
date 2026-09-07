#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# axiom-code-graph — TypeScript engine regression suite
#
# For every case in test/typescript/cases/<name>:
#   1. parse cases/<name>/src   to IR      (external parser, $AXIOM_PARSER)
#   2. parse cases/<name>/lib   to IR      — the case's own "library", parsed
#                                            SEPARATELY, exactly as a real dependency is
#   3. solve CLIENT-ONLY   (empty --library)      -> expected/<name>.edges
#   4. solve WITH LIBRARY  (--library the lib IR) -> expected/<name>.lib.edges
#   5. COVERAGE GUARD on both: no call site may vanish silently
#   6. with --oracle, score BOTH against the TypeScript compiler
#        expected/<name>.oracle       client -> client
#        expected/<name>.lib.oracle   client -> client AND client -> library
#
# ── WHY EVERY CASE IS SOLVED TWICE ──────────────────────────────────────────
# The delta between the two goldens IS the client->library mapping. A single run
# cannot separate "resolved correctly" from "resolved by accident": if the library
# link were spurious, removing the library IR would move the CLIENT numbers too.
# Pinning both makes that a reviewable diff on every change instead of a claim.
#
#   ./run-tests.sh                 run every case
#   ./run-tests.sh 04 06           run cases matching those substrings
#   ./run-tests.sh --bless         regenerate goldens from the current engine (review!)
#   ./run-tests.sh --oracle        ALSO validate against the TypeScript compiler
#   ./run-tests.sh --keep          keep the per-case work dirs for debugging
#
# expected/<case>.known-missing      accepted client->client gaps
# expected/<case>.lib.known-missing  accepted client->library gaps
#   One edge per line, `#` comments allowed. A NEW missing edge fails; a known one
#   that STARTS working also fails, so the debt list cannot silently rot.
#
# Environment:
#   AXIOM_PARSER   path to the parser entrypoint  (default ../../../Parser/dist/index.js)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

# ── Nothing this suite depends on may be invisible to git ────────────────────
# Runs first because it is cheap and because the fault it catches makes every OTHER
# result in this file untrustworthy: a fixture input that .gitignore matches is present
# locally, absent from the repository, and so every assertion about it passes here and
# fails on a clone. See test/tools/no-ignored-fixtures.sh.
if ! bash "$ROOT/test/tools/no-ignored-fixtures.sh"; then
  echo "aborting: a fixture input is not in the repository, so nothing below would be a test"
  exit 1
fi
PARSER="${AXIOM_PARSER:-$ROOT/../Parser/dist/index.js}"
WORK="$HERE/.work"
BLESS=0; KEEP=0; ORACLE=0; FILTERS=()
for a in "$@"; do case "$a" in
  --bless) BLESS=1;; --keep) KEEP=1;; --oracle) ORACLE=1;;
  -h|--help) sed -n '2,32p' "$0"; exit 0;; *) FILTERS+=("$a");; esac; done

[ -f "$PARSER" ] || { echo "SKIP: parser not found at $PARSER (set AXIOM_PARSER)"; exit 77; }
mkdir -p "$WORK"
# The engine's --library is mandatory. The client-only pass is handed an EMPTY
# directory, which stages every lib_* relation empty — semantically identical to a
# library that declares nothing, so no client->lib edge can exist.
EMPTY_LIB="$WORK/.empty-library"; mkdir -p "$EMPTY_LIB"

pass=0; fail=0; failed=()

# solve <ir> <library-ir> <workdir> ; leaves edges in <workdir>/out
solve() {
  bash "$ROOT/src/pipeline/run-souffle.sh" --language typescript \
    --client-ir "$1" --library "$2" --intermediate "$3/int" --output "$3/out" \
    >"$3/solve.log" 2>&1
}

# check_golden <actual> <golden-path> <label>  -> 0 ok, 1 fail
check_golden() {
  local actual="$1" exp="$2" label="$3"
  if [ "$BLESS" = "1" ]; then
    if [ -f "$exp" ] && ! diff -q "$exp" "$actual" >/dev/null; then
      echo "BLESSED $label (changed)"; diff -u "$exp" "$actual" | sed 's/^/    /' | head -30
    fi
    cp "$actual" "$exp"; return 0
  fi
  [ -f "$exp" ] || { echo "FAIL ($label: no golden — run with --bless)"; return 1; }
  diff -q "$exp" "$actual" >/dev/null && return 0
  echo "FAIL ($label changed)"; diff -u "$exp" "$actual" | sed 's/^/    /' | head -40; return 1
}

for dir in "$HERE"/cases/*/; do
  name="$(basename "$dir")"
  if [ ${#FILTERS[@]} -gt 0 ]; then
    match=0; for f in "${FILTERS[@]}"; do [[ "$name" == *"$f"* ]] && match=1; done
    [ $match -eq 1 ] || continue
  fi
  w="$WORK/$name"; rm -rf "$w"; mkdir -p "$w/ir" "$w/libir" "$w/plain" "$w/withlib"
  printf '%-34s ' "$name"

  if ! node "$PARSER" "$dir/src" "$name" false "$w/ir" >"$w/parse.log" 2>&1; then
    echo "FAIL (parse client — see $w/parse.log)"; fail=$((fail+1)); failed+=("$name"); continue; fi
  HAS_LIB=0
  if [ -d "$dir/lib" ] && [ -n "$(ls -A "$dir/lib" 2>/dev/null)" ]; then
    if ! node "$PARSER" "$dir/lib" "$name-lib" false "$w/libir" >"$w/parse-lib.log" 2>&1; then
      echo "FAIL (parse library — see $w/parse-lib.log)"; fail=$((fail+1)); failed+=("$name"); continue; fi
    [ -s "$w/libir/all-typescript-modules.csv" ] && HAS_LIB=1
  fi

  # ── pass 1: CLIENT ONLY ───────────────────────────────────────────────────
  if ! solve "$w/ir" "$EMPTY_LIB" "$w/plain"; then
    echo "FAIL (solve client-only — see $w/plain/solve.log)"; fail=$((fail+1)); failed+=("$name"); continue; fi
  if ! python3 "$HERE/tools/coverage_guard.py" "$w/ir" "$w/plain/out" >"$w/coverage.txt" 2>&1; then
    echo "FAIL (silent drop, client-only)"; sed 's/^/    /' "$w/coverage.txt" | head -12
    fail=$((fail+1)); failed+=("$name"); continue; fi
  python3 "$HERE/tools/normalize_edges.py" "$w/ir" "$w/plain/out" > "$w/actual.edges" 2>"$w/norm.log" || {
    echo "FAIL (normalize — see $w/norm.log)"; fail=$((fail+1)); failed+=("$name"); continue; }

  # ── pass 2: WITH THE CASE'S LIBRARY IR ────────────────────────────────────
  if [ "$HAS_LIB" = "1" ]; then
    if ! solve "$w/ir" "$w/libir" "$w/withlib"; then
      echo "FAIL (solve with library — see $w/withlib/solve.log)"; fail=$((fail+1)); failed+=("$name"); continue; fi
    if ! python3 "$HERE/tools/coverage_guard.py" "$w/ir" "$w/withlib/out" >"$w/coverage-lib.txt" 2>&1; then
      echo "FAIL (silent drop, with library)"; sed 's/^/    /' "$w/coverage-lib.txt" | head -12
      fail=$((fail+1)); failed+=("$name"); continue; fi
    python3 "$HERE/tools/normalize_edges.py" "$w/ir" "$w/withlib/out" --lib-ir "$w/libir" \
      > "$w/actual.lib.edges" 2>>"$w/norm.log" || {
      echo "FAIL (normalize with library — see $w/norm.log)"; fail=$((fail+1)); failed+=("$name"); continue; }
  fi

  # ── ground truth: the TypeScript compiler ─────────────────────────────────
  orc=""
  if [ "$ORACLE" = "1" ]; then
    ok=1
    if node "$HERE/tools/tsc_oracle_case.mjs" "$dir/src" > "$w/oracle.pairs" 2>"$w/oracle.log"; then
      python3 "$HERE/tools/normalize_edges.py" "$w/ir" "$w/plain/out" --client-pairs > "$w/engine.pairs"
      python3 "$HERE/tools/oracle_diff.py" "$w/engine.pairs" "$w/oracle.pairs" \
        "$HERE/expected/$name.known-missing" > "$w/oracle.diff"; rc=$?
      check_golden "$w/oracle.diff" "$HERE/expected/$name.oracle" "oracle" || ok=0
      [ $rc -eq 0 ] || { echo "FAIL (oracle: NEW missing edge, or a known-missing one started working)"
        grep -E 'MISSING|NOW-FIXED|^oracle=' "$w/oracle.diff" | head -12 | sed 's/^/    /'; ok=0; }
      orc="  [oracle: $(head -1 "$w/oracle.diff")]"
    else
      orc="  [oracle SKIPPED: $(head -1 "$w/oracle.log")]"
    fi
    if [ "$HAS_LIB" = "1" ] && node "$HERE/tools/tsc_oracle_case.mjs" "$dir/src" "$dir/lib" \
         > "$w/oracle.lib.pairs" 2>"$w/oracle-lib.log"; then
      python3 "$HERE/tools/normalize_edges.py" "$w/ir" "$w/withlib/out" --client-pairs \
        --lib-ir "$w/libir" > "$w/engine.lib.pairs"
      python3 "$HERE/tools/oracle_diff.py" "$w/engine.lib.pairs" "$w/oracle.lib.pairs" \
        "$HERE/expected/$name.lib.known-missing" > "$w/oracle.lib.diff"; rc=$?
      check_golden "$w/oracle.lib.diff" "$HERE/expected/$name.lib.oracle" "lib-oracle" || ok=0
      [ $rc -eq 0 ] || { echo "FAIL (lib oracle: NEW missing edge, or a known-missing one started working)"
        grep -E 'MISSING|NOW-FIXED|^oracle=' "$w/oracle.lib.diff" | head -12 | sed 's/^/    /'; ok=0; }
      orc="$orc  [lib: $(head -1 "$w/oracle.lib.diff")]"
    fi
    [ $ok -eq 1 ] || { fail=$((fail+1)); failed+=("$name"); continue; }
  fi

  bad=0
  check_golden "$w/actual.edges" "$HERE/expected/$name.edges" "edges" || bad=1
  if [ "$HAS_LIB" = "1" ]; then
    check_golden "$w/actual.lib.edges" "$HERE/expected/$name.lib.edges" "lib-edges" || bad=1
  fi
  if [ $bad -eq 1 ]; then fail=$((fail+1)); failed+=("$name"); continue; fi

  if [ "$BLESS" = "1" ]; then echo "BLESSED"; pass=$((pass+1)); continue; fi
  n1=$(wc -l < "$w/actual.edges" | tr -d ' ')
  n2=0; [ "$HAS_LIB" = "1" ] && n2=$(wc -l < "$w/actual.lib.edges" | tr -d ' ')
  echo "ok (${n1} edges, ${n2} with lib)${orc}"; pass=$((pass+1))
done

# ── the LINKING gate ─────────────────────────────────────────────────────────
# Run here rather than left to be remembered. The golden cases above parse a case's
# own `lib/` directory; they never install a PACKAGE, so nothing in them exercises
# module resolution, staging discovery, or a non-flat node_modules — the whole
# client->library boundary. That gate lived in fixtures/linking/run.sh and was not
# invoked by anything, so this suite could report 20/20 green while every linking
# mechanism was broken. A gate nobody runs is not a gate.
#
# Skipped, loudly, when the fixture cannot build (it needs a real `typescript` to
# symlink); never silently passed.
if [ "$BLESS" != "1" ]; then
  echo
  echo "── linking fixture ──"
  if bash "$HERE/fixtures/linking/run.sh" "${WORK:-/tmp/ts-linking-fixture}-linking" >"$WORK-linking.log" 2>&1; then
    echo "linking fixture: ok"
  else
    echo "linking fixture: FAILED"
    grep -E '^FAIL' "$WORK-linking.log" | sed 's/^/  /' || tail -5 "$WORK-linking.log" | sed 's/^/  /'
    fail=$((fail+1)); failed+=("linking-fixture")
  fi

  # Whether a package's tsconfig CHAIN survives being mirrored. No case can cover it:
  # every case carries its own src/tsconfig.json with nothing to extend, so none has an
  # ancestor config to lose — which is why #240 survived a green suite. Exit 77 is the
  # fixture declining for want of a parser, not a pass and not a failure.
  echo
  echo "── tsconfig-chain fixture ──"
  bash "$HERE/fixtures/tsconfig-chain/run.sh" "${WORK:-/tmp/ts-tsconfig-chain}-chain" \
       "$PARSER" >"$WORK-chain.log" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "tsconfig-chain fixture: ok"
  elif [ "$rc" -eq 77 ]; then
    echo "tsconfig-chain fixture: SKIPPED ($(tail -1 "$WORK-chain.log"))"
  else
    echo "tsconfig-chain fixture: FAILED"
    grep -E '^FAIL' "$WORK-chain.log" | sed 's/^/  /' || tail -5 "$WORK-chain.log" | sed 's/^/  /'
    fail=$((fail+1)); failed+=("tsconfig-chain-fixture")
  fi
fi

[ "$KEEP" = "1" ] || rm -rf "$WORK"
echo
echo "passed $pass, failed $fail"
[ $fail -eq 0 ] || { printf '  %s\n' "${failed[@]}"; exit 1; }
