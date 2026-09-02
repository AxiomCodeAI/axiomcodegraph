#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# axiom-code-graph — Java engine regression suite
#
# For every case in test/java/cases/<name>/src:
#   1. parse the source to IR            (external parser, $AXIOM_PARSER)
#   2. solve with the engine             (src/pipeline/run-souffle.sh)
#   3. COVERAGE GUARD: no call site may vanish silently
#   4. normalize the edges to golden form and diff against test/java/expected/<name>.edges
#   5. CONFIG REPORT: if the case derives any config-resolution rows (beans, DI edges,
#      config bindings, config entry points, declared unknowns), normalize them and diff
#      against test/java/expected/<name>.config
#
# A golden records every edge WITH its status/kind, and also records declared unknowns, so a
# change in resolution power shows up as a reviewable diff instead of a silent shift.
#
#   ./run-tests.sh                 run every case
#   ./run-tests.sh 04 06           run cases matching those substrings
#   ./run-tests.sh --bless         regenerate goldens from the current engine (review the diff!)
#   ./run-tests.sh --oracle        ALSO validate against ground truth built with javac + javap
#                                  (javac + javap invoke instructions — no third-party analyzer):
#                                  every bytecode-declared client->client edge must be present.
#   ./run-tests.sh --keep          keep the per-case work dirs for debugging
#
#   With --oracle, a case carrying a spring-oracle.conf ALSO boots its sources in a real
#   AnnotationConfigApplicationContext and scores bean_def / di_edge against what Spring
#   itself resolved (tools/spring_oracle.sh + spring_oracle_diff.py). That report is
#   pinned as expected/<name>.spring-oracle, so a precision or recall change fails.
#
# expected/<case>.known-missing   accepted gaps (one edge per line, # comments allowed). A NEW
#                                missing edge fails; a known one that starts working ALSO fails, so
#                                the debt list cannot silently rot.
#
# Environment:
#   AXIOM_PARSER   path to the parser entrypoint   (default ../../../Parser/dist/index.js)
#
# NO EXTERNAL LIBRARY IR IS USED OR REQUIRED — see the note above the EMPTY_LIB line. A case
# may however ship its own lib-src/ STUB library (kilobytes, in the repo), which is extracted
# and passed as --library so the client->library hand-off can be exercised at all.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
# ─────────────────────────────────────────────────────────────────────────────
# CLIENT -> CLIENT ONLY. This suite NEVER stages a library IR — not the JDK, not
# anything else. Two reasons:
#   1. A library IR is ~2 GB and cannot live in the repo, so any test that needed one
#      would be unrunnable for anybody who clones this project.
#   2. What these cases pin down is the engine's resolution of the CLIENT's own code:
#      overload selection, dispatch, shadowing, nesting, config/DI wiring. A library
#      boundary edge tests the library IR, not the rules.
# A call into a library therefore resolves to nothing and is recorded as
# ambiguous_unknown — which is the honest answer for a client-only analysis, and the
# coverage guard still proves the site was not silently dropped.
# ─────────────────────────────────────────────────────────────────────────────
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
  -h|--help) sed -n '2,34p' "$0"; exit 0;; *) FILTERS+=("$a");; esac; done

# ── PREFLIGHT: every relation the parser emits must actually reach the solver ──────────
# Runs before any case, because it is not about a case: a relation staged for the client but
# not for libraries — or listed in lib.map with a suffix absent from LIB_SIG — is EMPTY on
# every run and nothing errors. No golden can see that, so it is checked here.
if ! python3 "$HERE/tools/check_staging.py" --lang java; then
  echo "aborting: the IR staging maps are inconsistent, so some relation silently stages nothing"
  exit 1
fi

[ -f "$PARSER" ] || { echo "SKIP: parser not found at $PARSER (set AXIOM_PARSER)"; exit 77; }
# The engine's --library is mandatory, so it is handed an EMPTY directory. Every lib_*
# relation is then staged empty, which is semantically identical to a library that
# declares nothing: rules that read it derive nothing, and no client->lib edge exists.
EMPTY_LIB="$WORK/.empty-library"; mkdir -p "$EMPTY_LIB"; LIB_ARG="$EMPTY_LIB"


pass=0; fail=0; failed=()
for dir in "$HERE"/cases/*/; do
  name="$(basename "$dir")"
  if [ ${#FILTERS[@]} -gt 0 ]; then
    match=0; for f in "${FILTERS[@]}"; do [[ "$name" == *"$f"* ]] && match=1; done
    [ $match -eq 1 ] || continue
  fi
  w="$WORK/$name"; rm -rf "$w"; mkdir -p "$w/ir" "$w/out"
  cfg_summary=""; orc_summary=""      # set -u: both are conditional, so reset per case
  printf '%-34s ' "$name"

  if ! node "$PARSER" "$dir/src" "$name" false "$w/ir" >"$w/parse.log" 2>&1; then
    echo "FAIL (parse — see $w/parse.log)"; fail=$((fail+1)); failed+=("$name"); continue; fi

  # ── STUB LIBRARY (optional, per case) ─────────────────────────────────────────────────
  # A case may ship lib-src/, which is extracted and passed as --library instead of the
  # empty directory. It is a STUB: a handful of types standing in for a dependency, enough
  # to exercise the client->library HAND-OFF (does the boundary edge point at the right
  # method) and nothing deeper — library-internal expansion is a different engine.
  #
  # This exists because the boundary was previously untestable at all. Real dependency IRs
  # are gigabytes and cannot live in the repo, so every case staged an empty library, so no
  # case could exercise a client->library call — which is how a silent drop on that path
  # survived. A stub is kilobytes and pins the same contract.
  case_lib="$LIB_ARG"
  if [ -d "$dir/lib-src" ]; then
    if ! node "$PARSER" "$dir/lib-src" "$name-lib" false "$w/lib-ir" >"$w/parse-lib.log" 2>&1; then
      echo "FAIL (stub-library parse — see $w/parse-lib.log)"; fail=$((fail+1)); failed+=("$name"); continue; fi
    case_lib="$w/lib-ir"
  fi

  if ! bash "$ROOT/src/pipeline/run-souffle.sh" --client-ir "$w/ir" --library "$case_lib" \
        --intermediate "$w/int" --output "$w/out" >"$w/solve.log" 2>&1; then
    echo "FAIL (solve — see $w/solve.log)"; fail=$((fail+1)); failed+=("$name"); continue; fi

  if ! python3 "$HERE/tools/coverage_guard.py" "$w/ir" "$w/out" >"$w/coverage.txt" 2>&1; then
    echo "FAIL (silent drop)"; sed 's/^/    /' "$w/coverage.txt"; fail=$((fail+1)); failed+=("$name"); continue; fi

  lib_ir_arg=""; [ -d "$w/lib-ir" ] && lib_ir_arg="$w/lib-ir"
  python3 "$HERE/tools/normalize_edges.py" "$w/ir" "$w/out" $lib_ir_arg > "$w/actual.edges" 2>"$w/norm.log" || {
    echo "FAIL (normalize — see $w/norm.log)"; fail=$((fail+1)); failed+=("$name"); continue; }

  # ── optional: GROUND TRUTH from javac + javap (no library IR involved) ────
  if [ "$ORACLE" = "1" ]; then
    if python3 "$HERE/tools/bytecode_oracle.py" "$dir/src" "$w/oracle" --app-only > "$w/oracle.edges" 2>"$w/oracle.log"; then
      python3 "$HERE/tools/normalize_edges.py" "$w/ir" "$w/out" --client-pairs > "$w/engine.pairs"
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

  # ── CONFIG-RESOLUTION golden ──────────────────────────────────────────────
  # The edge golden says nothing about beans, DI, config bindings or config entry
  # points, so they need their own. A case with config rows and NO golden fails, and a
  # golden with no rows fails too — so neither gaining nor losing interpretation power
  # can land silently.
  python3 "$HERE/tools/config_report.py" "$w/ir" "$w/out" > "$w/actual.config" 2>"$w/config.log" || {
    echo "FAIL (config report — see $w/config.log)"; fail=$((fail+1)); failed+=("$name"); continue; }
  cfg_rows=$(grep -c '^  ' "$w/actual.config" || true)
  cexp="$HERE/expected/$name.config"
  if [ "$BLESS" = "1" ]; then
    if [ "${cfg_rows:-0}" -gt 0 ]; then cp "$w/actual.config" "$cexp"; else rm -f "$cexp"; fi
  elif [ -f "$cexp" ] || [ "${cfg_rows:-0}" -gt 0 ]; then
    if [ ! -f "$cexp" ]; then
      echo "FAIL (config rows but no golden — run with --bless)"; fail=$((fail+1)); failed+=("$name"); continue; fi
    if ! diff -q "$cexp" "$w/actual.config" >/dev/null; then
      echo "FAIL (config changed)"; diff -u "$cexp" "$w/actual.config" | sed 's/^/    /' | head -40
      fail=$((fail+1)); failed+=("$name"); continue; fi
    cfg_summary="  [config: ${cfg_rows} rows]"
  else cfg_summary=""; fi

  # ── LIVE SPRING CONTEXT oracle (opt-in, and only for cases that declare one) ──
  # cases/<name>/spring-oracle.conf holds: <scan-package> [key=value ...]
  sconf="$dir/spring-oracle.conf"
  if [ "$ORACLE" = "1" ] && [ -f "$sconf" ]; then
    # shellcheck disable=SC2046
    if bash "$HERE/tools/spring_oracle.sh" "$dir/src" "$w/spring" $(cat "$sconf") > "$w/spring.tsv" 2>"$w/spring.log"; then
      python3 "$HERE/tools/spring_oracle_diff.py" "$w/spring.tsv" "$w/ir" "$w/out" > "$w/spring.report" 2>&1
      sexp="$HERE/expected/$name.spring-oracle"
      if [ "$BLESS" = "1" ]; then cp "$w/spring.report" "$sexp"
      elif [ ! -f "$sexp" ]; then
        echo "FAIL (no spring-oracle golden — run with --bless)"; fail=$((fail+1)); failed+=("$name"); continue
      elif ! diff -q "$sexp" "$w/spring.report" >/dev/null; then
        echo "FAIL (spring oracle changed)"; diff -u "$sexp" "$w/spring.report" | sed 's/^/    /' | head -30
        fail=$((fail+1)); failed+=("$name"); continue
      fi
      cfg_summary="$cfg_summary  [spring: $(grep -c 'precision' "$w/spring.report") mechanisms scored]"
    else
      cfg_summary="$cfg_summary  [spring oracle skipped: $(head -1 "$w/spring.log")]"
    fi
  fi

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
    echo "ok ($(wc -l < "$w/actual.edges" | tr -d ' ') edges)$orc_summary${cfg_summary:-}"; pass=$((pass+1))
  else
    echo "FAIL (edges changed)"; diff -u "$exp" "$w/actual.edges" | sed 's/^/    /' | head -40
    fail=$((fail+1)); failed+=("$name")
  fi
done
[ "$KEEP" = "1" ] || rm -rf "$WORK"
echo "─────────────────────────────────────────────"
echo "passed $pass   failed $fail"
[ $fail -eq 0 ] || { printf 'failing: %s\n' "${failed[*]}"; exit 1; }
