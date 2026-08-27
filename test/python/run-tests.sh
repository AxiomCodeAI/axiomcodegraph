#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# axiom-code-graph — Python engine regression suite  (client -> client ONLY)
#
# For every case in test/python/cases/<name>/src:
#   1. parse the source to IR           (external parser, $AXIOM_PARSER)
#   2. solve with the engine            (src/pipeline/run-souffle.sh --language python)
#   3. COVERAGE GUARD: no call site may vanish silently
#   4. GOLDEN DIFF: normalized edges vs expected/<name>.edges
#   5. CPYTHON ORACLE (--oracle): score against the FROZEN ground truth
#
# SCOPE IS CLIENT->CLIENT BY DESIGN, AND NO STDLIB IR IS STAGED. Library linking is
# python-library-linking's problem and is measured separately, so a regression here is
# never ambiguous about which layer broke. The engine is handed an EMPTY library root,
# which means:
#   - nothing outside the repo is needed to run this suite (the stdlib IR is 462 MB);
#   - a call into the stdlib is reported by NAME (external:functools.wraps) or as
#     ambiguous_unknown, instead of as an opaque PY_METHOD_<hash> that no reader can
#     check — so the goldens got more reviewable, not less.
#
#   ./run-tests.sh                 every case: coverage guard + golden diff
#   ./run-tests.sh --oracle        ALSO validate against CPython-built ground truth
#   ./run-tests.sh 04 11           only cases matching those substrings
#   ./run-tests.sh --bless         regenerate ENGINE goldens (REVIEW the diff)
#   ./run-tests.sh --oracle-only   ground-truth checks alone; needs no engine
#   ./run-tests.sh --keep          keep per-case work dirs
#
# --bless REGENERATES ENGINE GOLDENS ONLY. It cannot touch the CPython ground
# truth: that lives outside this repo, at $AXIOM_PY_ORACLE/locks, and only
# `bin/freeze.py` there can author it. The split is deliberate — if re-blessing
# the ground truth lived beside the code under test, the quickest way past a red
# check would be to re-bless, and a bug present at that moment would become the
# permanent expectation.
#
# Environment:
#   AXIOM_PARSER      parser entrypoint        (default ../../../Parser/dist/index.js)
#   AXIOM_PY_ORACLE   harness checkout         (--oracle only; default ../../../callchain-oracle/python)
#   AXIOM_PY_PYTHON   pinned interpreter       (--oracle only; default python3.10)
#
# NO STDLIB IR IS USED OR REQUIRED.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PARSER="${AXIOM_PARSER:-$ROOT/../Parser/dist/index.js}"
ORACLE_HOME="${AXIOM_PY_ORACLE:-$ROOT/../callchain-oracle/python}"
PY="${AXIOM_PY_PYTHON:-/usr/local/bin/python3.10}"
WORK="$HERE/.work"
export AXIOM_PY_ORACLE="$ORACLE_HOME"

BLESS=0; KEEP=0; ORACLE=0; ORACLE_ONLY=0; FILTERS=()
for a in "$@"; do case "$a" in
  --bless) BLESS=1;; --keep) KEEP=1;; --oracle) ORACLE=1;;
  --oracle-only) ORACLE=1; ORACLE_ONLY=1;;
  -h|--help) sed -n '2,36p' "$0"; exit 0;; *) FILTERS+=("$a");; esac; done

# The PINNED interpreter and the CPython oracle harness are required by --oracle ONLY.
# Gating the whole suite on them made a clone without that external checkout unable to run
# any of it, which is the opposite of what a regression suite is for. The engine checks
# (coverage guard + golden diff) need nothing but python3 and the parser.
if [ "$ORACLE" = "1" ]; then
  command -v "$PY" >/dev/null 2>&1 || { echo "SKIP: pinned interpreter not found at $PY (set AXIOM_PY_PYTHON)"; exit 77; }
  PYVER="$("$PY" -c 'import sys;print("%d.%d.%d"%sys.version_info[:3])')"
  [ "$PYVER" = "3.10.4" ] || echo "NOTE: interpreter is $PYVER, pinned is 3.10.4 — opcode shapes differ; numbers are not comparable across versions."
  [ -d "$ORACLE_HOME/callchain_oracle" ] || { echo "SKIP: callchain-oracle harness not at $ORACLE_HOME (set AXIOM_PY_ORACLE)"; exit 77; }
else
  PY="$(command -v python3)"
fi
if [ "$ORACLE_ONLY" = "0" ]; then
  [ -f "$PARSER" ] || { echo "SKIP: parser not found at $PARSER (set AXIOM_PARSER)"; exit 77; }
fi

# The engine side uses VENDORED copies of the harness's normalizer so the suite runs in a
# bare clone; this fails the run if a harness IS present and has drifted from them, which is
# the only place the "engine and oracle agree on call-site identity" property can be checked.
python3 "$HERE/tools/check_vendor.py" || exit 1

mkdir -p "$WORK" "$HERE/expected"
# Empty library root — see the CLIENT->CLIENT note in the header.
EMPTY_LIB="$WORK/.empty-library"; mkdir -p "$EMPTY_LIB"

# ── preflight: is there a rule set at all? ──────────────────────────────────
# The Python rule set is owned by python-callchain and is empty by design until
# it lands. An empty rule set must still make the suite RED — a suite that goes
# green because there is nothing to test is worse than no suite — but it must say
# so precisely, or every case reports a C++ abort from the solver and reads like
# a regression in something that was never built.
ENGINE_READY=1; ENGINE_WHY=""
if [ ! -f "$ROOT/src/python/souffle/decls_all.dl" ]; then
  ENGINE_READY=0; ENGINE_WHY="src/python/souffle/decls_all.dl missing"
elif [ -z "$(find "$ROOT/src/python/engine" -name '*.dl' -type f 2>/dev/null | head -1)" ]; then
  ENGINE_READY=0; ENGINE_WHY="src/python/engine/**/*.dl is empty — no rules yet"
fi
if [ "$ENGINE_READY" = "0" ] && [ "$ORACLE_ONLY" = "0" ]; then
  echo "NOTE: no Python rule set yet ($ENGINE_WHY)."
  echo "      Every case will be RED at the solve step. That is the expected state,"
  echo "      not a suite defect. Ground truth is independently checkable now:"
  echo "        ./run-tests.sh --oracle-only"
  echo ""
fi

pass=0; fail=0; failed=()

for dir in "$HERE"/cases/*/; do
  name="$(basename "$dir")"
  [ -d "$dir/src" ] || continue
  if [ ${#FILTERS[@]} -gt 0 ]; then
    match=0; for f in "${FILTERS[@]}"; do [[ "$name" == *"$f"* ]] && match=1; done
    [ $match -eq 1 ] || continue
  fi
  w="$WORK/$name"; rm -rf "$w"; mkdir -p "$w/ir" "$w/out"
  printf '%-26s ' "$name"

  # ── ground-truth-only mode: no parser, no engine, no rules needed ────────
  if [ "$ORACLE_ONLY" = "1" ]; then
    if "$PY" "$HERE/tools/oracle_check.py" "$name" "$dir/src" >"$w/oracle.txt" 2>&1; then
      echo "ok  $(head -1 "$w/oracle.txt" | cut -c1-110)"; pass=$((pass+1))
    else
      echo "FAIL (ground truth)"; sed 's/^/    /' "$w/oracle.txt" | head -20
      fail=$((fail+1)); failed+=("$name")
    fi
    continue
  fi

  if ! node "$PARSER" "$dir/src" "$name" false "$w/ir" >"$w/parse.log" 2>&1; then
    echo "FAIL (parse — see $w/parse.log)"; fail=$((fail+1)); failed+=("$name"); continue; fi

  if ! bash "$ROOT/src/pipeline/run-souffle.sh" --language python \
        --client-ir "$w/ir" --library "$EMPTY_LIB" \
        --intermediate "$w/int" --output "$w/out" >"$w/solve.log" 2>&1; then
    if [ "$ENGINE_READY" = "0" ]; then
      echo "RED (no rule set: $ENGINE_WHY)"
    else
      echo "FAIL (solve — $(tail -1 "$w/solve.log" | cut -c1-70))"
    fi
    fail=$((fail+1)); failed+=("$name"); continue; fi

  if ! "$PY" "$HERE/tools/coverage_guard.py" "$w/ir" "$w/out" "$dir/src" >"$w/coverage.txt" 2>&1; then
    echo "FAIL (silent drop)"; sed 's/^/    /' "$w/coverage.txt" | head -12
    fail=$((fail+1)); failed+=("$name"); continue; fi

  if ! "$PY" "$HERE/tools/engine_edges.py" "$w/ir" "$w/out" "$dir/src" --mode golden \
        > "$w/actual.edges" 2>"$w/norm.log"; then
    echo "FAIL (normalize — see $w/norm.log)"; fail=$((fail+1)); failed+=("$name"); continue; fi

  # ── CPython ground truth ────────────────────────────────────────────────
  orc=""
  if [ "$ORACLE" = "1" ]; then
    "$PY" "$HERE/tools/engine_edges.py" "$w/ir" "$w/out" "$dir/src" --mode pairs > "$w/engine.pairs" 2>/dev/null
    "$PY" "$HERE/tools/engine_edges.py" "$w/ir" "$w/out" "$dir/src" --mode sites > "$w/engine.sites" 2>/dev/null
    if ! "$PY" "$HERE/tools/oracle_check.py" "$name" "$dir/src" \
           --pairs "$w/engine.pairs" --sites "$w/engine.sites" \
           --json "$w/score.json" > "$w/oracle.txt" 2>&1; then
      echo "FAIL (CPython oracle)"; sed 's/^/    /' "$w/oracle.txt" | head -24
      fail=$((fail+1)); failed+=("$name"); continue
    fi
    orc="  [$(grep -m1 '^conservation' "$w/oracle.txt" | cut -c1-60)]"
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
    echo "ok ($(wc -l < "$w/actual.edges" | tr -d ' ') edges)$orc"; pass=$((pass+1))
  else
    echo "FAIL (edges changed)"; diff -u "$exp" "$w/actual.edges" | sed 's/^/    /' | head -40
    fail=$((fail+1)); failed+=("$name")
  fi
done

[ "$KEEP" = "1" ] || rm -rf "$WORK"
echo "─────────────────────────────────────────────"
echo "passed $pass   failed $fail"
[ $fail -eq 0 ] || { printf 'failing: %s\n' "${failed[*]}"; exit 1; }
