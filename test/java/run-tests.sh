#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# axiom-code-graph — Java engine regression suite
#
# For every case in test/java/cases/<name>/src:
#   1. parse the source to IR            (external parser, $AXIOM_PARSER)
#   2. solve with the engine             (src/pipeline/run-souffle.sh)
#   3. COVERAGE GUARD: no call site may vanish silently
#   4. normalize the edges to golden form and diff against test/java/expected/<name>.edges
#
# A golden records every edge WITH its status/kind, and also records declared unknowns, so a
# change in resolution power shows up as a reviewable diff instead of a silent shift.
#
#   ./run-tests.sh                 run every case
#   ./run-tests.sh 04 06           run cases matching those substrings
#   ./run-tests.sh --bless         regenerate goldens from the current engine (review the diff!)
#   ./run-tests.sh --oracle        ALSO validate against ground truth built from the JDK itself
#                                  (javac + javap invoke instructions — no third-party analyzer):
#                                  every bytecode-declared client->client edge must be present.
#   ./run-tests.sh --keep          keep the per-case work dirs for debugging
#
# expected/<case>.known-missing   accepted gaps (one edge per line, # comments allowed). A NEW
#                                missing edge fails; a known one that starts working ALSO fails, so
#                                the debt list cannot silently rot.
#
# Environment:
#   AXIOM_PARSER   path to the parser entrypoint   (default ../../../Parser/dist/index.js)
#   AXIOM_JDK_IR   path to the JDK IR root         (default ../../../jdk-26)
#   AXIOM_JDK_INDEX  optional tab file of JDK method hashes -> names, for readable lib targets
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PARSER="${AXIOM_PARSER:-$ROOT/../Parser/dist/index.js}"
JDK_IR="${AXIOM_JDK_IR:-$ROOT/../jdk-26}"
JDK_INDEX="${AXIOM_JDK_INDEX:-$HERE/.work/jdk-method-index.tsv}"
WORK="$HERE/.work"
BLESS=0; KEEP=0; ORACLE=0; FILTERS=()
for a in "$@"; do case "$a" in
  --bless) BLESS=1;; --keep) KEEP=1;; --oracle) ORACLE=1;;
  -h|--help) sed -n '2,34p' "$0"; exit 0;; *) FILTERS+=("$a");; esac; done

[ -f "$PARSER" ] || { echo "SKIP: parser not found at $PARSER (set AXIOM_PARSER)"; exit 77; }
[ -d "$JDK_IR" ] || { echo "SKIP: JDK IR not found at $JDK_IR (set AXIOM_JDK_IR)"; exit 77; }

# JDK method-hash -> name index, so library targets read as java.util.List#add(Object) instead of a
# hash. Derived from the JDK IR in one pass (~2s) and cached in .work — far too large to commit.
mkdir -p "$WORK"
if [ ! -s "$JDK_INDEX" ]; then
  echo "building JDK method index -> $JDK_INDEX"
  awk -F'\t' 'FNR>1 && NF>=22 {print $22"\t"$10"\t"$2"\t"$9"\t"$4"\t"$14}' "$JDK_IR"/*/all-methods.csv > "$JDK_INDEX" 2>/dev/null \
    || awk -F'\t' 'FNR>1 && NF>=22 {print $22"\t"$10"\t"$2"\t"$9"\t"$4"\t"$14}' "$JDK_IR"/all-methods.csv > "$JDK_INDEX"
fi

pass=0; fail=0; failed=()
for dir in "$HERE"/cases/*/; do
  name="$(basename "$dir")"
  if [ ${#FILTERS[@]} -gt 0 ]; then
    match=0; for f in "${FILTERS[@]}"; do [[ "$name" == *"$f"* ]] && match=1; done
    [ $match -eq 1 ] || continue
  fi
  w="$WORK/$name"; rm -rf "$w"; mkdir -p "$w/ir" "$w/out"
  printf '%-34s ' "$name"

  if ! node "$PARSER" "$dir/src" "$name" false "$w/ir" >"$w/parse.log" 2>&1; then
    echo "FAIL (parse — see $w/parse.log)"; fail=$((fail+1)); failed+=("$name"); continue; fi
  if ! bash "$ROOT/src/pipeline/run-souffle.sh" --client-ir "$w/ir" --library "$JDK_IR" \
        --intermediate "$w/int" --output "$w/out" >"$w/solve.log" 2>&1; then
    echo "FAIL (solve — see $w/solve.log)"; fail=$((fail+1)); failed+=("$name"); continue; fi

  if ! python3 "$HERE/tools/coverage_guard.py" "$w/ir" "$w/out" >"$w/coverage.txt" 2>&1; then
    echo "FAIL (silent drop)"; sed 's/^/    /' "$w/coverage.txt"; fail=$((fail+1)); failed+=("$name"); continue; fi

  python3 "$HERE/tools/normalize_edges.py" "$w/ir" "$w/out" "$JDK_INDEX" > "$w/actual.edges" 2>"$w/norm.log" || {
    echo "FAIL (normalize — see $w/norm.log)"; fail=$((fail+1)); failed+=("$name"); continue; }

  # ── optional: validate against GROUND TRUTH derived from the JDK itself ────
  if [ "$ORACLE" = "1" ]; then
    if python3 "$HERE/tools/bytecode_oracle.py" "$dir/src" "$w/oracle" --app-only > "$w/oracle.edges" 2>"$w/oracle.log"; then
      python3 "$HERE/tools/normalize_edges.py" "$w/ir" "$w/out" "$JDK_INDEX" --client-pairs > "$w/engine.pairs"
      if ! python3 "$HERE/tools/oracle_diff.py" "$w/engine.pairs" "$w/oracle.edges" \
             "$HERE/expected/$name.known-missing" > "$w/oracle.diff"; then
        echo "FAIL (bytecode oracle: NEW missing edge, or a known-missing one started working)"
        sed 's/^/    /' "$w/oracle.diff" | grep -E 'MISSING|NOW-FIXED|oracle=' | head -20
        fail=$((fail+1)); failed+=("$name"); continue
      fi
      # The extras are PINNED too. Missing edges are a defect; extras are sound over-approximation —
      # but they must not GROW unnoticed, so the whole oracle diff is a reviewed golden. A rule that
      # widens the dispatch set now shows up here instead of hiding behind "extras are expected".
      oexp="$HERE/expected/$name.oracle"
      if [ "$BLESS" = "1" ]; then cp "$w/oracle.diff" "$oexp"
      elif [ ! -f "$oexp" ]; then
        echo "FAIL (no oracle golden — run with --bless)"; fail=$((fail+1)); failed+=("$name"); continue
      elif ! diff -q "$oexp" "$w/oracle.diff" >/dev/null; then
        echo "FAIL (over-approximation changed)"; diff -u "$oexp" "$w/oracle.diff" | sed 's/^/    /' | head -24
        fail=$((fail+1)); failed+=("$name"); continue
      fi
      orc_summary="  [oracle: $(head -1 "$w/oracle.diff")]"
    else
      orc_summary="  [oracle skipped: $(head -1 "$w/oracle.log")]"
    fi
  else orc_summary=""; fi

  exp="$HERE/expected/$name.edges"
  if [ "$BLESS" = "1" ]; then
    if [ -f "$exp" ] && ! diff -q "$exp" "$w/actual.edges" >/dev/null; then
      echo "BLESSED (changed)"; diff -u "$exp" "$w/actual.edges" | sed 's/^/    /' | head -40
    else echo "BLESSED"; fi
    cp "$w/actual.edges" "$exp"; pass=$((pass+1)); continue
  fi
  if [ ! -f "$exp" ]; then
    echo "FAIL (no golden — run with --bless)"; fail=$((fail+1)); failed+=("$name"); continue; fi
  if diff -q "$exp" "$w/actual.edges" >/dev/null; then
    echo "ok ($(wc -l < "$w/actual.edges" | tr -d ' ') edges)$orc_summary"; pass=$((pass+1))
  else
    echo "FAIL (edges changed)"; diff -u "$exp" "$w/actual.edges" | sed 's/^/    /' | head -40
    fail=$((fail+1)); failed+=("$name")
  fi
done
[ "$KEEP" = "1" ] || rm -rf "$WORK"
echo "─────────────────────────────────────────────"
echo "passed $pass   failed $fail"
[ $fail -eq 0 ] || { printf 'failing: %s\n' "${failed[*]}"; exit 1; }
