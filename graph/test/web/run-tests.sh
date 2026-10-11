#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# axiom-code-graph — web engine torture suites (HTML and CSS only; <script> and on* are HTML nodes)
#
# For every case graph/test/web/cases/<suite>/<case>/ (src/ + case.conf):
#   1. build the graph:      bin/axiomcode <case>/src <work>/out --language web --debug
#   2. normalize:            tools/normalize.py <work>/out --kinds=<case kinds>
#                            (the engine's tables, in the oracle's row vocabulary; the contract
#                            is the header of tools/normalize.py)
#   3. gate:                 tools/gate.py expected/<suite>/<case>.tsv actual [known-missing]
#                            missing / extra rows fail; a listed known gap that starts passing fails;
#                            fewer than 1 compared row fails
#   4. per case checks:      check=crosslang -> tools/crosslang_guard.py (0 web<->JS edges, join keys present)
#                            check=var_budget -> tools/var_budget.py (SPEC 3.4a caps; V1-12 one scope row per key)
#                            check=unknown_budget -> tools/unknown_budget.py (SPEC 3.5 iter2 grain and cap)
#                            mode=scale      -> tools/gen_scale.py generates src/, budgets on time and RSS
#
# The expectations are the ORACLE's rows (oracle/oracle.mjs: parse5, postcss, css-select, acorn;
# never the axiom parser), filtered to the case's kinds, then read by a person and marked
# "# reviewed: yes" in the header. An unreviewed expectation fails.
#
#   ./run-tests.sh                   run every case (needs the engine: graph/web/engine)
#   ./run-tests.sh cascade 03        run cases whose "<suite>/<case>" contains any of the words
#   ./run-tests.sh --oracle          check every expectation still equals the oracle (no engine needed)
#   ./run-tests.sh --bless-oracle X  write expected/ from the oracle for cases matching X, marked
#                                    "# reviewed: no" — read them, then flip the header by hand
#   ./run-tests.sh --keep            keep the per-case work dirs (graph/test/web/.work)
#
# mode=queries cases (SPEC 6): cases/queries/<case>/questions.tsv lists SPEC 6.4 templates instantiated on the
# case's site; tools/query_oracle.py derives each answer from the oracle's rows into expected/queries/<case>/<qid>.tsv
# (reviewed by hand); the engine run indexes a copy of the site and asks each question through bin/axiomcode
# <context|impact|path|link> ... --json, graded by tools/grade_query.py (SET, SET>=, ORDER, CHAIN, TOP-k; LINK
# templates are skipped_not_built until fragment hosts exist and are never counted correct).
#
# Environment: AXIOM_ROOT=<checkout> tests that checkout's engine with these suites (default: this tree).
#              Cases run one at a time (one engine solve each).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# AXIOM_ROOT: the checkout whose bin/axiomcode, parser and graph/web engine are under test
# (default: this one). Lets the suites on web/torture run against the feat/web-layer worktree.
ROOT="${AXIOM_ROOT:-$(cd "$HERE/../../.." && pwd)}"
WORK="$HERE/.work"
ORACLE_DIR="$HERE/oracle"
KEEP=0; ORACLE=0; BLESS=0; FILTERS=()
for a in "$@"; do case "$a" in
  --keep) KEEP=1;; --oracle) ORACLE=1;; --bless-oracle) BLESS=1;;
  -h|--help) sed -n '2,33p' "$0"; exit 0;; *) FILTERS+=("$a");; esac; done

conf() { # conf <case-dir> <key> [default]
  local v; v=$(grep -E "^$2=" "$1/case.conf" 2>/dev/null | tail -1 | cut -d= -f2-)
  echo "${v:-${3:-}}"
}
selected() {
  [ ${#FILTERS[@]} -eq 0 ] && return 0
  local f; for f in "${FILTERS[@]}"; do [[ "$1" == *"$f"* ]] && return 0; done; return 1
}
ensure_oracle() {
  [ -f "$ORACLE_DIR/node_modules/css-select/package.json" ] && return 0
  (cd "$ORACLE_DIR" && npm install --no-audit --no-fund >/dev/null 2>&1) || { echo "FAIL: oracle dependencies did not install (cd $ORACLE_DIR && npm install)"; exit 1; }
}
# oracle_rows <src> <kinds> <out-file>
oracle_rows() {
  local tmp; tmp=$(mktemp -d "$WORK/oracle.XXXXXX")
  node "$ORACLE_DIR/oracle.mjs" "$1" "$tmp" --walk=parser --kinds="$2" 2>"$tmp/log" || { cat "$tmp/log"; rm -rf "$tmp"; return 1; }
  cp "$tmp/rows.tsv" "$3"; rm -rf "$tmp"
}

mkdir -p "$WORK"
# Preflight: a fixture file git ignores is missing from every clone, and the case then passes or fails on a
# tree nobody reviewed (the root .gitignore drops target/, dist/, lib/, oracle/ … by name). Refuse to run.
if git -C "$HERE" rev-parse --git-dir >/dev/null 2>&1; then
  ignored=$(cd "$HERE" && find cases expected -type f -print0 | xargs -0 git check-ignore --no-index 2>/dev/null)
  if [ -n "$ignored" ]; then
    echo "FAIL: fixture files are git-ignored (add a re-include to graph/test/web/.gitignore):"
    echo "$ignored" | sed 's/^/  /' | head -20; exit 1
  fi
fi
CASES=()
for d in "$HERE"/cases/*/*/; do
  [ -f "$d/case.conf" ] || continue
  rel="${d#"$HERE"/cases/}"; rel="${rel%/}"
  selected "$rel" && CASES+=("$rel")
done
if [ ${#CASES[@]} -eq 0 ]; then echo "FAIL: no case matched (${FILTERS[*]:-all})"; exit 1; fi

# ── oracle-only modes ─────────────────────────────────────────────────────────────────────────
if [ "$ORACLE" = "1" ] || [ "$BLESS" = "1" ]; then
  ensure_oracle
  pass=0; fail=0; failed=()
  for rel in "${CASES[@]}"; do
    d="$HERE/cases/$rel"; exp="$HERE/expected/$rel.tsv"; mode=$(conf "$d" mode)
    printf '%-52s ' "$rel"
    if [ "$mode" = "scale" ]; then echo "skip (scale: counts come from the generator)"; continue; fi
    if [ "$mode" = "queries" ]; then
      qd="$WORK/$(echo "$rel" | tr / _).q"; rm -rf "$qd"; mkdir -p "$qd"
      node "$ORACLE_DIR/oracle.mjs" "$d/src" "$qd/o" --walk=parser 2>"$qd/log" && python3 "$HERE/tools/query_oracle.py" "$qd/o/rows.tsv" "$d/questions.tsv" "$qd/q" 2>>"$qd/log" \
        || { echo "FAIL (query oracle — see $qd/log)"; fail=$((fail+1)); failed+=("$rel"); continue; }
      expd="$HERE/expected/$rel"; nq=0; bad=0
      for qf in "$qd"/q/*.tsv; do
        qn=$(basename "$qf"); nq=$((nq+1))
        if [ "$BLESS" = "1" ]; then
          mkdir -p "$expd"
          if [ -f "$expd/$qn" ] && diff -q <(grep -v '^# reviewed:' "$expd/$qn") "$qf" >/dev/null; then continue; fi
          { echo "# reviewed: no — oracle-derived $(date +%F); read it, then change this line to '# reviewed: yes <date> <what was checked>'"; cat "$qf"; } > "$expd/$qn"
          echo; printf '    BLESSED (unreviewed) %s' "$qn"; continue
        fi
        if [ ! -f "$expd/$qn" ] || ! diff -q <(grep -v '^# reviewed:' "$expd/$qn") "$qf" >/dev/null; then
          bad=$((bad+1)); echo; printf '    %s differs from the oracle' "$qn"; continue; fi
        grep -q '^# reviewed: yes' "$expd/$qn" || { bad=$((bad+1)); echo; printf '    %s not reviewed' "$qn"; }
      done
      [ "$BLESS" = "1" ] && { echo; echo "  ($nq questions)"; continue; }
      if [ $bad -eq 0 ] && [ $nq -ge 1 ]; then echo "ok ($nq questions)"; pass=$((pass+1)); else echo; echo "  FAIL ($bad of $nq)"; fail=$((fail+1)); failed+=("$rel"); fi
      continue
    fi
    kinds=$(conf "$d" kinds)
    [ -n "$kinds" ] || { echo "FAIL (case.conf has no kinds=)"; fail=$((fail+1)); failed+=("$rel"); continue; }
    act="$WORK/$(echo "$rel" | tr / _).oracle.tsv"
    oracle_rows "$d/src" "$kinds" "$act" || { echo "FAIL (oracle crashed)"; fail=$((fail+1)); failed+=("$rel"); continue; }
    if [ "$BLESS" = "1" ]; then
      mkdir -p "$(dirname "$exp")"
      if [ -f "$exp" ] && diff -q <(grep -v '^#' "$exp") "$act" >/dev/null; then echo "unchanged"; continue; fi
      { echo "# reviewed: no — oracle output $(date +%F); read every row, then change this line to '# reviewed: yes <date> <who/what was checked>'"
        echo "# case: $rel   kinds: $kinds"
        grep '^# shape:' "$d/case.conf" || true
        cat "$act"; } > "$exp"
      echo "BLESSED (unreviewed, $(wc -l < "$act" | tr -d ' ') rows)"; continue
    fi
    [ -f "$exp" ] || { echo "FAIL (no expected/$rel.tsv)"; fail=$((fail+1)); failed+=("$rel"); continue; }
    if diff -q <(grep -v '^#' "$exp") "$act" >/dev/null; then
      n=$(grep -vc '^#' "$exp"); if [ "$n" -ge 1 ]; then echo "ok ($n rows)"; pass=$((pass+1)); else echo "FAIL (0 rows)"; fail=$((fail+1)); failed+=("$rel"); fi
    else
      echo "FAIL (expectation differs from the oracle)"; diff <(grep -v '^#' "$exp") "$act" | head -20 | sed 's/^/    /'
      fail=$((fail+1)); failed+=("$rel")
    fi
  done
  [ "$BLESS" = "1" ] && exit 0
  if [ ${#FILTERS[@]} -eq 0 ] || [[ " ${FILTERS[*]} " == *queries* ]]; then
    python3 "$HERE/tools/grade_query_selftest.py" || { fail=$((fail+1)); failed+=("tools/grade_query_selftest.py"); }
  fi
  echo; echo "oracle agreement — passed: $pass  failed: $fail"
  [ $fail -eq 0 ] && [ $pass -ge 1 ] || { [ ${#failed[@]} -gt 0 ] && printf '  %s\n' "${failed[@]}"; exit 1; }
  exit 0
fi

# ── engine mode ───────────────────────────────────────────────────────────────────────────────
if [ ! -d "$ROOT/graph/web/engine" ] || [ ! -f "$ROOT/graph/web/templates/staging.conf" ]; then
  echo "FAIL: engine not built — graph/web/engine/ and graph/web/templates/staging.conf are missing in $ROOT"
  for rel in "${CASES[@]}"; do printf '%-52s FAIL (engine not built)\n' "$rel"; done
  echo; echo "passed: 0  failed: ${#CASES[@]}"; exit 1
fi
if [ ! -f "$ROOT/parser/dist/index.js" ]; then
  echo "FAIL: parser not built at $ROOT/parser/dist/index.js (npm install && npm run build)"; exit 1
fi
ensure_oracle
pass=0; fail=0; failed=()
for rel in "${CASES[@]}"; do
  d="$HERE/cases/$rel"; exp="$HERE/expected/$rel.tsv"; known="$HERE/expected/$rel.known-missing"
  w="$WORK/$(echo "$rel" | tr / _)"; rm -rf "$w"; mkdir -p "$w"
  printf '%-52s ' "$rel"
  kinds=$(conf "$d" kinds); mode=$(conf "$d" mode); check=$(conf "$d" check)
  src="$d/src"
  if [ "$mode" = "scale" ]; then
    src="$w/src"
    python3 "$HERE/tools/gen_scale.py" "$src" $(conf "$d" gen) >"$w/gen.log" 2>&1 || { echo "FAIL (generator — see $w/gen.log)"; fail=$((fail+1)); failed+=("$rel"); continue; }
  fi
  if [ "$mode" = "queries" ]; then
    # SPEC 6: build the graphs in a copy of the site, ask every question through the front door with --json
    repo="$w/repo"; cp -R "$d/src" "$repo"
    if ! (cd "$repo" && bash "$ROOT/bin/axiomcode" index "$repo" >"$w/index.log" 2>&1); then
      echo "FAIL (index — see $w/index.log)"; tail -3 "$w/index.log" | sed 's/^/    /'; fail=$((fail+1)); failed+=("$rel"); continue; fi
    qok=0; qgraded=0; qskip=0; qbad=()
    while IFS=$'\t' read -r qid _t _g _s _r _f ask _d; do
      case "$qid" in ''|'#'*) continue;; esac
      exp_q="$HERE/expected/$rel/$qid.tsv"
      [ -f "$exp_q" ] && grep -q '^# reviewed: yes' "$exp_q" || { qbad+=("$qid(no reviewed expectation)"); qgraded=$((qgraded+1)); continue; }
      eval "set -- $ask"
      (cd "$repo" && AXIOMCODE_NO_REFRESH=1 bash "$ROOT/bin/axiomcode" "$@" --json) >"$w/$qid.json" 2>"$w/$qid.err"
      python3 "$HERE/tools/grade_query.py" "$w/$qid.json" "$exp_q" >"$w/$qid.grade" 2>&1; rc=$?
      if [ $rc = 4 ]; then
        (cd "$repo" && AXIOMCODE_NO_REFRESH=1 bash "$ROOT/bin/axiomcode" "$@" --json --limit 0) >"$w/$qid.json" 2>"$w/$qid.err"
        python3 "$HERE/tools/grade_query.py" "$w/$qid.json" "$exp_q" >"$w/$qid.grade" 2>&1; rc=$?
      fi
      case $rc in 0) qok=$((qok+1)); qgraded=$((qgraded+1));; 5) qskip=$((qskip+1));; *) qgraded=$((qgraded+1)); qbad+=("$qid");; esac
    done < "$d/questions.tsv"
    if [ $qgraded -ge 1 ] && [ $qok -eq $qgraded ]; then echo "ok (query_ok $qok/$qgraded, skipped_not_built $qskip)"; pass=$((pass+1))
    else echo "FAIL (query_ok $qok/$qgraded, skipped_not_built $qskip): ${qbad[*]}"
      for q in "${qbad[@]}"; do [ -f "$w/${q%%(*}.grade" ] && sed "s/^/    ${q%%(*}: /" "$w/${q%%(*}.grade" | head -3; done
      fail=$((fail+1)); failed+=("$rel"); fi
    [ "$KEEP" = "1" ] || rm -rf "$w"
    continue
  fi
  langs=web
  [[ ",$check," == *",crosslang,"* ]] && langs=web,javascript
  t0=$(date +%s)
  if ! /usr/bin/time -l bash "$ROOT/bin/axiomcode" "$src" "$w/out" --language "$langs" --debug >"$w/build.log" 2>"$w/build.err"; then
    echo "FAIL (build — see $w/build.err)"; tail -3 "$w/build.err" | sed 's/^/    /'; fail=$((fail+1)); failed+=("$rel"); continue
  fi
  secs=$(( $(date +%s) - t0 ))
  rss_mb=$(( $(awk '/maximum resident set size/ {print $1}' "$w/build.err" | sort -n | tail -1) / 1048576 ))
  ok=1
  if [ "$mode" = "scale" ]; then
    oracle_counts="$w/oracle-counts.tsv"
    node "$ORACLE_DIR/oracle.mjs" "$src" "$w/oracle" --walk=parser --kinds="$kinds" 2>"$w/oracle.log" || { echo "FAIL (oracle)"; ok=0; }
    if [ $ok = 1 ]; then
      python3 "$HERE/tools/normalize.py" "$w/out" --kinds="$kinds" > "$w/actual.tsv" 2>"$w/norm.log" || { echo "FAIL (normalize — $(cat "$w/norm.log"))"; ok=0; }
    fi
    if [ $ok = 1 ]; then
      { echo "# reviewed: yes — scale: counts compared against the oracle on the generated tree"; cut -f1 "$w/oracle/rows.tsv" | sort | uniq -c | awk '{print "count\t"$2"\t"$1}'; } > "$w/exp-counts.tsv"
      cut -f1 "$w/actual.tsv" | sort | uniq -c | awk '{print "count\t"$2"\t"$1}' > "$w/act-counts.tsv"
      python3 "$HERE/tools/gate.py" "$w/exp-counts.tsv" "$w/act-counts.tsv" > "$w/gate.txt" || { echo "FAIL (counts)"; sed 's/^/  /' "$w/gate.txt" | head -20; ok=0; }
      budget_s=$(conf "$d" budget_s 270); budget_rss=$(conf "$d" budget_rss_mb 4096)
      if [ "$secs" -gt "$budget_s" ]; then echo "FAIL (time ${secs}s > ${budget_s}s)"; ok=0; fi
      if [ "$rss_mb" -gt "$budget_rss" ]; then echo "FAIL (rss ${rss_mb}MB > ${budget_rss}MB)"; ok=0; fi
    fi
  else
    python3 "$HERE/tools/normalize.py" "$w/out" --kinds="$kinds" > "$w/actual.tsv" 2>"$w/norm.log" || { echo "FAIL (normalize — $(cat "$w/norm.log"))"; ok=0; }
    if [ $ok = 1 ]; then
      [ -f "$exp" ] || { echo "FAIL (no expected/$rel.tsv)"; ok=0; }
    fi
    if [ $ok = 1 ]; then
      args=("$exp" "$w/actual.tsv"); [ -f "$known" ] && args+=("$known")
      python3 "$HERE/tools/gate.py" "${args[@]}" > "$w/gate.txt" || { echo "FAIL"; sed 's/^/  /' "$w/gate.txt" | head -40; ok=0; }
    fi
  fi
  # per-case checks (check=a,b): crosslang -> 0 web<->JS ids + join keys; var_budget -> SPEC 3.4a caps
  if [ $ok = 1 ] && [[ ",$check," == *",crosslang,"* ]]; then
    bash "$ROOT/bin/axiomcode" "$src" "$w/out-js" --language javascript --debug >"$w/build-js.log" 2>&1 \
      || { echo "FAIL (javascript-only build — see $w/build-js.log)"; ok=0; }
    [ $ok = 1 ] && { python3 "$HERE/tools/crosslang_guard.py" "$w/out" "$w/out-js" > "$w/crosslang.txt" || { echo "FAIL (per-language guard)"; sed 's/^/  /' "$w/crosslang.txt"; ok=0; }; }
  fi
  if [ $ok = 1 ] && [[ ",$check," == *",unknown_budget,"* ]]; then
    python3 "$HERE/tools/unknown_budget.py" "$w/out" > "$w/unknown_budget.txt" || { echo "FAIL (unknown-row grain)"; sed 's/^/  /' "$w/unknown_budget.txt"; ok=0; }
  fi
  if [ $ok = 1 ] && [[ ",$check," == *",var_budget,"* ]]; then
    python3 "$HERE/tools/var_budget.py" "$w/out" > "$w/var_budget.txt" || { echo "FAIL (var row caps)"; sed 's/^/  /' "$w/var_budget.txt"; ok=0; }
  fi
  if [ $ok = 1 ]; then echo "ok ($(tail -1 "$w/gate.txt" | sed 's/^ *//'); ${secs}s)"; pass=$((pass+1)); else fail=$((fail+1)); failed+=("$rel"); fi
  [ "$KEEP" = "1" ] || rm -rf "$w"
done
echo; echo "passed: $pass  failed: $fail"
if [ $fail -ne 0 ]; then printf '  %s\n' "${failed[@]}"; exit 1; fi
[ $pass -ge 1 ] || { echo "FAIL: 0 cases passed"; exit 1; }
