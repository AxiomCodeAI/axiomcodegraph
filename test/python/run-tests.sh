#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# axiom-code-graph — Python engine regression suite  (client -> client ONLY)
#
# For every case in test/python/cases/<name>/src:
#   1. parse the source to IR           (external parser, $AXIOM_PARSER)
#   2. solve with the engine            (src/pipeline/run-souffle.sh --language python)
#   3. COVERAGE GUARD: no call site may vanish silently
#   4. GOLDEN DIFF: normalized edges vs expected/<name>.edges
#   4b. TIER/REASON CENSUS: site counts, tier mix and unresolved reasons vs
#       expected/<name>.tiers -- the axis a deduplicated edge set cannot see
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
#   ./run-tests.sh                 every case + both whole-project fixtures + torture
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
#   AXIOM_PY_PYTHON   pinned interpreter       (default python3.10; also used by the
#                     tier-1 attribution preflight, which is version-sensitive)
#
# NO STDLIB IR IS USED OR REQUIRED.
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
ORACLE_HOME="${AXIOM_PY_ORACLE:-$ROOT/../callchain-oracle/python}"
# The oracle is PINNED to 3.10.4 because opcode shapes are not stable across minor
# versions -- but pinning an absolute PATH is a different thing, and the wrong one: a
# Homebrew-on-Intel-macOS location makes --oracle unrunnable on Linux, Apple Silicon,
# pyenv, or any CI image, reported as a "not found" that reads like a broken checkout.
# Resolve it the way src/pipeline/run-souffle.sh resolves the souffle headers: search
# PATH, never hardcode a prefix. AXIOM_PY_PYTHON still overrides for an unusual install.
find_pinned_python() {
  local c p
  for c in python3.10 python3; do
    p="$(command -v "$c" 2>/dev/null)" && [ -n "$p" ] && { printf '%s\n' "$p"; return; }
  done
}
PY="${AXIOM_PY_PYTHON:-$(find_pinned_python)}"
# Held separately because `PY` is deliberately reset to plain python3 below when
# --oracle is off (the engine checks need nothing else). The tier-1 attribution
# preflight is about the PINNED interpreter's opcodes specifically, so it must keep
# a handle on it either way or it silently degrades to "cannot check" on every run
# that does not pass --oracle.
PINNED_PY="$PY"
# The coverage guard's CHECK 2 compares against CPython tier 1, whose opcode model is
# version-specific, so it must run on the pinned interpreter or it reports version
# differences as parser gaps. Check 1 does not care. Prefer the pinned interpreter and
# fall back to $PY, where check 2 skips itself loudly.
GUARD_PY="$PINNED_PY"
command -v "$GUARD_PY" >/dev/null 2>&1 || GUARD_PY="$PY"
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

# ── PREFLIGHT: is the GROUND TRUTH itself right? ─────────────────────────────
# check_vendor above asserts the vendored copies are IDENTICAL to the harness. It
# cannot say whether either is CORRECT, and tier 1 decides what a call site is and
# who it calls -- every other Python check is scored against it. A defect there is
# not an engine bug a golden catches, it is a wrong expectation every golden then
# agrees with. See tools/check_tier1_attribution.py.
#
# Runs on $PY, not python3: the drift it pins lives in JUMP_IF_TRUE_OR_POP, which
# 3.12 does not have, so on 3.12 the check would pass against a defect that is live
# on the interpreter the oracle pins. It refuses rather than passing when the
# opcodes are absent -- which is why this must not fall back to `python3`.
if command -v "$PINNED_PY" >/dev/null 2>&1; then
  "$PINNED_PY" "$HERE/tools/check_tier1_attribution.py"; t1rc=$?
  # 77 means the interpreter cannot reach the defect -- a loud skip, not a pass and
  # not a failure. Anything else non-zero is the ground truth being wrong.
  [ "$t1rc" = "0" ] || [ "$t1rc" = "77" ] || exit 1
else
  echo "SKIP tier-1 attribution: pinned interpreter $PINNED_PY not found (set AXIOM_PY_PYTHON)"
fi

# ── PREFLIGHT: every relation the parser emits must actually reach the solver ─
# Not about any one case, which is why it runs before all of them: a relation listed in
# lib.map with a suffix absent from LIB_SIG is skipped by run-souffle.sh with a
# `continue`, so no .facts file is written, no .input line is emitted, and the relation
# is EMPTY ON EVERY RUN with nothing erroring. No golden can see that — a rule joining
# against it simply derives nothing.
#
# The guard existed and this front end had never run it. It takes --lang, but its
# counterpart check assumed Java's naming (`java_method` pairs with `lib_method`, the
# prefix dropped) and Python keeps the prefix (`py_method` / `lib_py_method`), so
# --lang python reported 19 failures that were all the tool's. It now infers the
# convention from the maps. Issue #136 is what this catches, one language over.
if ! python3 "$ROOT/test/tools/check_staging.py" --lang python; then
  echo "aborting: the IR staging maps are inconsistent, so some relation silently stages nothing"
  exit 1
fi
# Refuse a project-specific string literal in a rule body -- the engine is developed
# against a handful of codebases, and a literal copied out of one would score well here
# and generalise to nothing (issue #91).
python3 "$HERE/tools/literal_gate.py" || exit 1

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

  if ! "$GUARD_PY" "$HERE/tools/coverage_guard.py" "$w/ir" "$w/out" "$dir/src" >"$w/coverage.txt" 2>&1; then
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

  # ── the TIER and REASON census ───────────────────────────────────────────
  # A second artifact per case, because .edges is a deduplicated SET and is blind to
  # site counts, to the reason on a declared unknown, and to the tier mix as counts.
  # See tools/tier_report.py. Needs no oracle checkout, so it runs on a clean clone
  # where --oracle cannot.
  if ! "$PY" "$HERE/tools/tier_report.py" "$w/out" > "$w/actual.tiers" 2>"$w/tier.log"; then
    echo "FAIL (tier report — see $w/tier.log)"; fail=$((fail+1)); failed+=("$name"); continue; fi
  texp="$HERE/expected/$name.tiers"
  if [ "$BLESS" = "1" ]; then
    cp "$w/actual.tiers" "$texp"
  elif [ ! -f "$texp" ]; then
    echo "FAIL (no tier golden — run with --bless)"; fail=$((fail+1)); failed+=("$name"); continue
  elif ! diff -q "$texp" "$w/actual.tiers" >/dev/null; then
    echo "FAIL (tiers/reasons changed)"; diff -u "$texp" "$w/actual.tiers" | sed 's/^/    /' | head -30
    fail=$((fail+1)); failed+=("$name"); continue
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

# ── THE WHOLE-PROJECT FIXTURES ───────────────────────────────────────────────
# test/python/projects holds two realistic projects, 29 files and ~1,040 lines, and its
# README credits them with catching six engine defects the single-construct cases could
# not. THE SUITE NEVER RAN THEM: the loop above iterates cases/*/ and requires a src/
# subdirectory, which these do not have, so nothing checked them and their README table
# was transcribed by hand.
#
# It had drifted. Against the engine's own per-tier SITE counts: known_edge 123 -> 124,
# boundary_lib 76 -> 70, ambiguous_unknown 5 -> 10; the site total (227) and
# multi_inferred (23) still hold. The ambiguous_unknown row is the one that matters,
# because the README's prose names five unknowns — four route decorators and
# functools.wraps — and there are five MORE it never mentioned: bare @abstractmethod in
# four shared modules. Confirmed NOT recent: identical at 4345f2f, before the six Python
# changes that landed after it.
#
# Pinned with the same artifact the cases use, for the same reason: an edge list cannot
# see a tier count move.
if [ "$ORACLE_ONLY" = "0" ] && [ -d "$HERE/projects" ]; then
  for pdir in "$HERE"/projects/*/; do
    pname="$(basename "$pdir")"
    [ -n "$(find "$pdir" -maxdepth 2 -name '*.py' -type f 2>/dev/null | head -1)" ] || continue
    if [ ${#FILTERS[@]} -gt 0 ]; then
      match=0; for f in "${FILTERS[@]}"; do [[ "$pname" == *"$f"* ]] && match=1; done
      [ $match -eq 1 ] || continue
    fi
    printf '%-26s ' "project:$pname"
    pw="$WORK/project-$pname"; rm -rf "$pw"; mkdir -p "$pw/ir"
    if ! node "$PARSER" "$pdir" "$pname" false "$pw/ir" >"$pw/parse.log" 2>&1; then
      echo "FAIL (parse — see $pw/parse.log)"; fail=$((fail+1)); failed+=("project:$pname"); continue; fi
    if ! bash "$ROOT/src/pipeline/run-souffle.sh" --language python \
          --client-ir "$pw/ir" --library "$EMPTY_LIB" \
          --intermediate "$pw/int" --output "$pw/out" >"$pw/solve.log" 2>&1; then
      echo "FAIL (solve — $(tail -1 "$pw/solve.log" | cut -c1-70))"
      fail=$((fail+1)); failed+=("project:$pname"); continue; fi
    if ! "$GUARD_PY" "$HERE/tools/coverage_guard.py" "$pw/ir" "$pw/out" "$pdir" >"$pw/coverage.txt" 2>&1; then
      echo "FAIL (silent drop)"; sed 's/^/    /' "$pw/coverage.txt" | head -12
      fail=$((fail+1)); failed+=("project:$pname"); continue; fi
    "$PY" "$HERE/tools/tier_report.py" "$pw/out" > "$pw/actual.tiers" 2>"$pw/tier.log"
    pexp="$HERE/expected/project-$pname.tiers"
    if [ "$BLESS" = "1" ]; then
      cp "$pw/actual.tiers" "$pexp"; echo "BLESSED"; pass=$((pass+1)); continue; fi
    if [ ! -f "$pexp" ]; then
      echo "FAIL (no tier golden — run with --bless)"; fail=$((fail+1)); failed+=("project:$pname"); continue; fi
    if diff -q "$pexp" "$pw/actual.tiers" >/dev/null; then
      echo "ok ($(head -1 "$pw/actual.tiers" | grep -oE '[0-9]+') sites)"; pass=$((pass+1))
    else
      echo "FAIL (tiers/reasons changed)"; diff -u "$pexp" "$pw/actual.tiers" | sed 's/^/    /' | head -30
      fail=$((fail+1)); failed+=("project:$pname")
    fi
  done
fi

# ── THE TORTURE CASE ─────────────────────────────────────────────────────────
# Runs last and separately because it is the only case with a LIBRARY: two IRs, linked
# with --library, which the loop above cannot express (it parses one src tree and stages
# an empty library by design). Everything else is shared -- the same normalizer
# (tools/engine_edges.py) produces its .edges, and its .oracle is the same shape as
# Java's, so the suite has one convention rather than two.
if [ "$ORACLE_ONLY" = "0" ] && [ -d "$HERE/torture" ]; then
  printf '%-26s ' "torture (client+lib)"
  if out=$(AXIOM_PARSER="$PARSER" bash "$HERE/torture/harness/run.sh" 2>&1); then
    echo "ok ($(echo "$out" | grep -oE 'oracle=[0-9]+ engine=[0-9]+ agree=[0-9]+ missing=[0-9]+ extra=[0-9]+' | head -1))"
    pass=$((pass+1))
  else
    echo "FAIL"; echo "$out" | tail -20 | sed 's/^/    /'
    fail=$((fail+1)); failed+=("torture")
  fi
fi

[ "$KEEP" = "1" ] || rm -rf "$WORK"
echo "─────────────────────────────────────────────"
echo "passed $pass   failed $fail"
[ $fail -eq 0 ] || { printf 'failing: %s\n' "${failed[*]}"; exit 1; }
