#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# axiom-code-graph — Java engine regression suite
#
# For every case in test/java/cases/<name>/src:
#   1. parse the source to IR            (external parser, $AXIOM_PARSER)
#   2. solve with the engine             (graph/pipeline/run-souffle.sh)
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
#   AXIOM_PARSER   path to the parser entrypoint   (default parser/dist/index.js — the parser in this repository)
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
ROOT="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"  # the repository root, found by its marker — no level counting

# ── Nothing this suite depends on may be invisible to git ────────────────────
# Runs first because it is cheap and because the fault it catches makes every OTHER
# result in this file untrustworthy: a fixture input that .gitignore matches is present
# locally, absent from the repository, and so every assertion about it passes here and
# fails on a clone. See test/tools/no-ignored-fixtures.sh.
if ! bash "$ROOT/graph/test/tools/no-ignored-fixtures.sh"; then
  echo "aborting: a fixture input is not in the repository, so nothing below would be a test"
  exit 1
fi
# ── PREFLIGHT: no reader dies on a big IR field ──────────────────────────────
# Python's csv module caps one field at 128 KiB, and an IR literalValue holding a base64 asset
# is several hundred KB. Every reader that opens an IR CSV then dies AFTER the extraction, the
# solve and the oracle have all succeeded. Costs milliseconds and is repo-wide, because the
# readers span all three languages. See issue #238.
if ! bash "$ROOT/graph/test/tools/csv-limit-test.sh"; then
  echo "aborting: a reader of the IR would die on a large literal"
  exit 1
fi
# ── PREFLIGHT: a relation with no rows is not a drifted schema ───────────────
# The parser writes a relation with no rows as a ZERO-BYTE file, so an unguarded next() on the
# header raises StopIteration -- and the TypeScript harness reported that as "refusing to measure
# against a drifted schema", the one fault that gate exists to catch. Lints every CSV reader in
# the tree for the same shape, because it was in three places and only one crashed. See #244.
if ! bash "$ROOT/graph/test/tools/empty-relation-test.sh"; then
  echo "aborting: a reader would die on a relation that simply has no rows"
  exit 1
fi
# ── The library-facts cache key must be derived from the library ─────────────
# Runs early and costs milliseconds, because a wrong key makes every number below meaningless:
# the solve is answered from whichever library IR happened to be staged under that key, and it
# reports success either way. Cheaper to assert than to debug as a phantom engine regression.
if ! bash "$ROOT/graph/test/tools/portable-stat-test.sh"; then
  echo "aborting: the library-facts cache key is not a function of the library IR"
  exit 1
fi
# ── The -I for soufflé's headers must be the one that actually compiles ──────
# Also a preflight, and for the same reason: the old resolution returned a path that only built on
# the machine it was written on, and every run here compiles the engine through it.
if ! bash "$ROOT/graph/test/tools/souffle-include-test.sh"; then
  echo "aborting: the soufflé include path does not resolve to a compilable -I"
  exit 1
fi
# ── The bundle stage must build the language-neutral output ─────────────────
# Every solve below ends by joining the raw relations to the IR and writing graph.sqlite
# (graph/bundle/SCHEMA.md); graph/*.csv is the same core tables and is written only under
# --debug. A broken bundler fails every case identically, after the
# solve's cost; this checks it in milliseconds on hand-written fixtures for all three languages.
if ! bash "$ROOT/graph/test/tools/bundle-test.sh"; then
  echo "aborting: the bundle stage does not produce the documented output"
  exit 1
fi
# ── The engine id and the packaged-engine path ───────────────────────────────
# A machine without souffle finds its binary by the id the rules hash to, so the id must be
# the same from any path and different for any rule change; and the engine package npm
# installed must be used only when its ENGINE_ID matches. Both run without souffle or
# network, in seconds.
if ! bash "$ROOT/graph/test/tools/engine-id-test.sh"; then
  echo "aborting: the engine id is not a function of the rules alone"
  exit 1
fi
if ! bash "$ROOT/graph/test/tools/engine-package-test.sh"; then
  echo "aborting: the packaged-engine path does not check what it runs"
  exit 1
fi
PARSER="${AXIOM_PARSER:-$ROOT/parser/dist/index.js}"
WORK="$HERE/.work"
BLESS=0; KEEP=0; ORACLE=0; FILTERS=()
for a in "$@"; do case "$a" in
  --bless) BLESS=1;; --keep) KEEP=1;; --oracle) ORACLE=1;;
  -h|--help) sed -n '2,34p' "$0"; exit 0;; *) FILTERS+=("$a");; esac; done

# ── PREFLIGHT: every relation the parser emits must actually reach the solver ──────────
# Runs before any case, because it is not about a case: a relation staged for the client but
# not for libraries — or listed in lib.map with a suffix absent from LIB_SIG — is EMPTY on
# every run and nothing errors. No golden can see that, so it is checked here.
if ! python3 "$ROOT/graph/test/tools/check_staging.py" --lang java; then
  echo "aborting: the IR staging maps are inconsistent, so some relation silently stages nothing"
  exit 1
fi

# ── PREFLIGHT: a compiler-generated callee is not ground truth ───────────────────────────
# Cheap, and it guards a number rather than a behaviour: an edge to a synthetic member is scored
# MISSING against the engine for a call the source does not contain. javac's own synthetics are
# all excluded by name, so nothing in this suite can reach the flag path -- hence a direct test.
if ! bash "$HERE/tools/synthetic-callee-test.sh"; then
  echo "aborting: the class-file oracle emits compiler-generated callees as ground truth"
  exit 1
fi

# ── PREFLIGHT: the two ground-truth readers must agree ────────────────────────────────
# This suite scores against tools/bytecode_oracle.py; the corpus-scale harness scores against
# tools/ClassFileOracle.java. Both claim to emit the same canonical form, and until this ran
# nothing checked it — so a defect in either was invisible in the other, and the small cases
# could not vouch for the numbers the scale runs report. Constructor rows are expected to
# differ (the two decide "javac-synthesized?" differently, which is undecidable from a class
# file); the counts are a golden so the debt cannot grow, or vanish, unreviewed.
if [ "$ORACLE" = "1" ]; then
  mkdir -p "$WORK"
  agree_out="$WORK/oracle-agreement.txt"
  agree_bless=""; [ "$BLESS" = "1" ] && agree_bless="--bless"
  # STDOUT is the golden; STDERR is commentary (which cases could not be compared) and must stay
  # out of it, or the golden churns whenever a case is added. See tools/oracle_agreement.py.
  agree_err="$WORK/oracle-agreement.err"
  if python3 "$HERE/tools/oracle_agreement.py" "$HERE/cases" "$WORK/.agreement" $agree_bless > "$agree_out" 2>"$agree_err"; then
    [ -s "$agree_err" ] && cat "$agree_err"
    aexp="$HERE/expected/oracle-agreement.txt"
    if [ "$BLESS" = "1" ]; then cp "$agree_out" "$aexp"
    elif [ ! -f "$aexp" ]; then
      echo "aborting: no oracle-agreement golden — run with --bless"; exit 1
    elif ! diff -q "$aexp" "$agree_out" >/dev/null; then
      echo "aborting: the two ground-truth oracles agree differently than the golden records"
      diff -u "$aexp" "$agree_out" | sed 's/^/    /' | head -30; exit 1
    fi
  else
    echo "aborting: the two ground-truth oracles describe different graphs"
    sed 's/^/    /' "$agree_out" | tail -30
    [ -s "${agree_err:-}" ] && sed 's/^/    /' "$agree_err" | tail -10
    exit 1
  fi
fi

[ -f "$PARSER" ] || { echo "SKIP: parser not found at $PARSER (set AXIOM_PARSER)"; exit 77; }

# ── PREFLIGHT: a platform IR build that produced nothing must not look current ───────────
# Sub-second, and it guards the input the torture harness scores against: a stamped-but-empty
# jdk IR stages no platform library, so every receiver typed through java.util is unresolvable by
# construction and the harness cannot even warn -- the directory exists and --check says current.
if ! AXIOM_PARSER="$PARSER" bash "$HERE/tools/jdk-ir-stamp-test.sh"; then
  echo "aborting: build-jdk-ir.sh can stamp a tree that holds no IR"
  exit 1
fi
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

  if ! bash "$ROOT/graph/pipeline/run-souffle.sh" --debug --client-ir "$w/ir" --library "$case_lib" \
        --intermediate "$w/int" --output "$w/out" >"$w/solve.log" 2>&1; then
    echo "FAIL (solve — see $w/solve.log)"; fail=$((fail+1)); failed+=("$name"); continue; fi

  if ! python3 "$HERE/tools/coverage_guard.py" "$w/ir" "$w/out/raw" >"$w/coverage.txt" 2>&1; then
    echo "FAIL (silent drop)"; sed 's/^/    /' "$w/coverage.txt"; fail=$((fail+1)); failed+=("$name"); continue; fi

  # QUOTED, via an array. This one expansion doubled as an "omit the argument entirely" flag, so it
  # was bare — and a checkout path containing a space then word-split it, handing the tool a
  # fragment that is not a directory. The library names were silently not loaded and both lib-src
  # cases failed with a diff that reads as an engine regression.
  lib_args=(); [ -d "$w/lib-ir" ] && lib_args=("$w/lib-ir")
  python3 "$HERE/tools/normalize_edges.py" "$w/ir" "$w/out/raw" ${lib_args[@]+"${lib_args[@]}"} > "$w/actual.edges" 2>"$w/norm.log" || {
    echo "FAIL (normalize — see $w/norm.log)"; fail=$((fail+1)); failed+=("$name"); continue; }

  # ── optional: GROUND TRUTH from javac + javap (no library IR involved) ────
  if [ "$ORACLE" = "1" ]; then
    # An array, for the reason above: `--lib-src $dir/lib-src` bare splits on a space in the path,
    # the flag then receives a fragment that is not a directory, the stub is not compiled, and the
    # case's oracle reports `package dep does not exist` — which reads as a broken fixture.
    orc_lib=(); [ -d "$dir/lib-src" ] && orc_lib=(--lib-src "$dir/lib-src")
    if python3 "$HERE/tools/bytecode_oracle.py" "$dir/src" "$w/oracle" --app-only ${orc_lib[@]+"${orc_lib[@]}"} > "$w/oracle.edges" 2>"$w/oracle.log"; then
      python3 "$HERE/tools/normalize_edges.py" "$w/ir" "$w/out/raw" --client-pairs > "$w/engine.pairs"
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
      # ── CLIENT -> LIBRARY, scored (only a case that ships a stub library) ──────────────
      # normalize_edges/oracle_diff compare client->client only, so nothing here judged the
      # boundary hand-off itself: whether the engine names the exactly correct library method.
      # tools/score_boundary.py does, and pinning its report makes the SCORER testable too —
      # it silently discarded every edge whose caller is a constructor, and charged the engine
      # for sites whose receiver could only be typed through a library nobody staged.
      if [ -d "$w/lib-ir" ] && [ -d "$WORK/.agreement/.oracle-classes" ]; then
        java -cp "$WORK/.agreement/.oracle-classes" ClassFileOracle --app "$w/oracle/classes" \
             --with-lines > "$w/boundary.gt" 2>/dev/null
        # The PREFIXES have to include the stub's own packages, or the report measures something
        # the case is not about: score_boundary defaults to java.,javax.,jdk., and a case whose stub
        # is `dep.*` then scores its JDK calls and says nothing about the hand-off it exists for.
        # Read them off the stub IR rather than hard-coding, so a new stub needs no edit here.
        bprefix=$( { awk -F'\t' 'NR>1 && $2 != "" { split($2, p, "."); print p[1] "." }' \
                       "$w/lib-ir/all-types.csv" 2>/dev/null; printf 'java.\njavax.\njdk.\n'; } \
                   | sort -u | paste -sd, -)
        python3 "$HERE/tools/score_boundary.py" "$w/ir" "$w/out/raw" "$w/boundary.gt" \
             --library "$w/lib-ir" --prefix "$bprefix" > "$w/boundary.txt" 2>&1
        bexp="$HERE/expected/$name.boundary"
        if [ "$BLESS" = "1" ]; then cp "$w/boundary.txt" "$bexp"
        elif [ ! -f "$bexp" ]; then
          echo "FAIL (no boundary golden — run with --bless)"; fail=$((fail+1)); failed+=("$name"); continue
        elif ! diff -q "$bexp" "$w/boundary.txt" >/dev/null; then
          echo "FAIL (client->library score changed)"; diff -u "$bexp" "$w/boundary.txt" | sed 's/^/    /' | head -24
          fail=$((fail+1)); failed+=("$name"); continue
        fi
      fi
      orc_summary="  [oracle: $(head -1 "$w/oracle.diff")]"
    else
      # The REASON, not just the label. bytecode_oracle.py writes `javac failed:` on line 1 and the
      # diagnostics after it, so `head -1` printed a skip with an empty cause — indistinguishable
      # from the documented "this machine lacks the Spring jars" skip, which is how a case that
      # could never compile anywhere reported ok for as long as it did.
      orc_summary="  [oracle skipped: $(tr '\n' ' ' < "$w/oracle.log" | tr -s ' ' | cut -c1-140)]"
    fi
  else orc_summary=""; fi

  # ── CONFIG-RESOLUTION golden ──────────────────────────────────────────────
  # The edge golden says nothing about beans, DI, config bindings or config entry
  # points, so they need their own. A case with config rows and NO golden fails, and a
  # golden with no rows fails too — so neither gaining nor losing interpretation power
  # can land silently.
  python3 "$HERE/tools/config_report.py" "$w/ir" "$w/out/raw" > "$w/actual.config" 2>"$w/config.log" || {
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


  # ── DISPATCH-ENVELOPE golden ──────────────────────────────────────────────
  # The edge golden records what the engine CONCLUDED. dispatch_candidates records what
  # the hierarchy ADMITTED — the set those edges were narrowed from, and the only table
  # in the output bundle that answers "what ELSE might run here". Nothing downstream
  # consumes it, so a rule that stopped emitting it would move no other golden and no
  # test would notice; it was Java-only for the whole life of the bundle for exactly that
  # reason (#471). A case with envelope rows and NO golden fails, and a golden with no
  # rows fails too.
  python3 "$HERE/../tools/envelope_report.py" "$w/ir" "$w/out/raw" all-methods.csv methodRegistryUniqueHash --library "$case_lib" > "$w/actual.envelope" 2>"$w/envelope.log" || {
    echo "FAIL (envelope report — see $w/envelope.log)"; fail=$((fail+1)); failed+=("$name"); continue; }
  env_rows=$(wc -l < "$w/actual.envelope" | tr -d ' ')
  eexp="$HERE/expected/$name.envelope"
  if [ "$BLESS" = "1" ]; then
    if [ "${env_rows:-0}" -gt 0 ]; then cp "$w/actual.envelope" "$eexp"; else rm -f "$eexp"; fi
  elif [ -f "$eexp" ] || [ "${env_rows:-0}" -gt 0 ]; then
    if [ ! -f "$eexp" ]; then
      echo "FAIL (envelope rows but no golden — run with --bless)"; fail=$((fail+1)); failed+=("$name"); continue; fi
    if ! diff -q "$eexp" "$w/actual.envelope" >/dev/null; then
      echo "FAIL (dispatch envelope changed)"; diff -u "$eexp" "$w/actual.envelope" | sed 's/^/    /' | head -40
      fail=$((fail+1)); failed+=("$name"); continue; fi
  fi
  # ── LIVE SPRING CONTEXT oracle (opt-in, and only for cases that declare one) ──
  # cases/<name>/spring-oracle.conf holds: <scan-package> [key=value ...]
  sconf="$dir/spring-oracle.conf"
  if [ "$ORACLE" = "1" ] && [ -f "$sconf" ]; then
    # shellcheck disable=SC2046
    if bash "$HERE/tools/spring_oracle.sh" "$dir/src" "$w/spring" $(cat "$sconf") > "$w/spring.tsv" 2>"$w/spring.log"; then
      python3 "$HERE/tools/spring_oracle_diff.py" "$w/spring.tsv" "$w/ir" "$w/out/raw" > "$w/spring.report" 2>&1
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
# ── TORTURE: ten families of construct, scored per family ─────────────────────────────────────
# The cases above each pin ONE rule. This asks what happens when a project uses everything at
# once, and reports WHICH construct is the gap rather than one number. It stages the platform IR,
# because half the families call java.util types and scoring them without it measures the staging.
if [ -d "$HERE/torture" ] && [ ${#FILTERS[@]} -eq 0 ]; then
  printf '%-34s ' "torture (10 families)"
  # --bless has to reach the torture harness too, or a run that regenerates every other golden
  # leaves this one stale and the very next run fails on a diff the operator just approved.
  tort_bless=""; [ "$BLESS" = "1" ] && tort_bless="--bless"
  if out=$(AXIOM_PARSER="$PARSER" bash "$HERE/torture/harness/run.sh" $tort_bless 2>&1); then
    echo "ok  [$(echo "$out" | grep -o 'TOTAL.*' | tr -s ' ')]"
  elif [ $? = 77 ]; then
    echo "SKIP ($(echo "$out" | head -1))"
  else
    echo "FAIL"; echo "$out" | sed 's/^/    /' | head -24; fail=$((fail+1)); failed+=("torture")
  fi
fi

echo "─────────────────────────────────────────────"
echo "passed $pass   failed $fail"
[ $fail -eq 0 ] || { printf 'failing: %s\n' "${failed[*]}"; exit 1; }
