#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# axiom-code-graph: Hono torture suites (TypeScript; the JavaScript twin sources this runner)
#
# For every case cases/<suite>/<case>/src:
#   1. the expected truth must exist and say it was REVIEWED: expected/<suite>/<case>.tsv and
#      expected/<suite>/<case>.entries, each starting `# hand-reviewed`. A missing or unreviewed
#      golden FAILS: it never skips.
#   2. with --oracle: the independent oracle (truth/, the TypeScript compiler API plus the real
#      pinned `hono`) must reproduce the expected rows exactly, and its runtime half (the fixture
#      run under the real Hono, `app.routes` read back) must agree with the static half wherever
#      the fixture loads. A refusal or a disagreement FAILS.
#   3. the engine runs TWICE: `bare` (no library: a real checkout without node_modules) and `lib`
#      (the pinned hono type declarations staged as a library). Each variant's Hono relations are
#      normalised and compared row by row (tools/hono_compare.py). Until the engine exports the
#      relations SPEC.md section 4 names, the case FAILS with "relation not exported".
#   4. at least ONE row is compared, or the case fails: an empty golden is not a pass.
#
#   ./run-tests.sh [filter...]       cases whose <suite>/<case> contains a filter
#   ./run-tests.sh --oracle          also check expected/ against the oracle (needs truth/node_modules: npm install there)
#   ./run-tests.sh --oracle-only     only step 2 (no parser, no solver): validates the goldens
#   ./run-tests.sh --draft           write the oracle's rows to expected/*.draft for REVIEW (never to the golden)
#   ./run-tests.sh --keep            keep .work/
#
# cases/<suite>/<case>/partial-paths (opt-in): the oracle also prints, and the compare also checks, `ppath HANDLER
# VERB KNOWNPATH` rows: a partial route's composed path with `{}` for the run-time piece (http_route_partial KnownPath).
#
# expected/<suite>/<case>.known-missing: `<variant|*>\t<compared row>` per line (the row as the
# compare prints it after MISSING). A new miss fails; a listed miss that starts passing fails.
#
# Environment: AXIOM_PARSER (default parser/dist/index.js), HONO_ENGINE_ROOT (score another checkout's engine),
#              HONO_LANG (typescript|javascript),
#              HONO_SUITE_DIR (the suite dir holding cases/ and expected/; default: this dir)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
TS_HONO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HERE="${HONO_SUITE_DIR:-$TS_HONO}"
LANG_="${HONO_LANG:-typescript}"
ROOT="$TS_HONO"; while [ "$ROOT" != / ] && { [ ! -f "$ROOT/package.json" ] || [ ! -d "$ROOT/graph" ]; }; do ROOT="$(dirname "$ROOT")"; done
# HONO_ENGINE_ROOT: score ANOTHER checkout's parser and engine (e.g. the implementation branch's worktree)
# with this checkout's cases, goldens and oracle
ENGINE_ROOT="${HONO_ENGINE_ROOT:-$ROOT}"
PARSER="${AXIOM_PARSER:-$ENGINE_ROOT/parser/dist/index.js}"
# the baseline engine (pre-Hono): HONO_BASELINE_ROOT, else a wt-hono-baseline sibling of this checkout, else this tree
BASELINE_ROOT="${HONO_BASELINE_ROOT:-}"
if [ -z "$BASELINE_ROOT" ]; then
  for cand in "$(cd "$ROOT/.." && pwd)/wt-hono-baseline"; do
    [ -f "$cand/graph/pipeline/run-souffle.sh" ] && { BASELINE_ROOT="$cand"; break; }
  done
  [ -n "$BASELINE_ROOT" ] || BASELINE_ROOT="$ROOT"
fi
echo "baseline engine for pre-existing entry points: $BASELINE_ROOT"
ORACLE_DIR="$TS_HONO/truth"  # NOT `oracle/`: the repository .gitignore ignores every dir of that name
WORK="$HERE/.work"
ORACLE=0; ORACLE_ONLY=0; DRAFT=0; KEEP=0; FILTERS=()
for a in "$@"; do case "$a" in
  --oracle) ORACLE=1;; --oracle-only) ORACLE=1; ORACLE_ONLY=1;; --draft) ORACLE=1; ORACLE_ONLY=1; DRAFT=1;;
  --keep) KEEP=1;; -h|--help) sed -n '2,30p' "$0"; exit 0;; *) FILTERS+=("$a");; esac; done

if [ "$ORACLE" = 1 ] && [ ! -d "$ORACLE_DIR/node_modules/hono" ]; then
  echo "FAIL: the oracle is not installed: (cd $ORACLE_DIR && npm install): refusing to score without it"; exit 1
fi
[ "$ORACLE_ONLY" = 1 ] || [ -f "$PARSER" ] || { echo "FAIL: parser not found at $PARSER (build it: npm install)"; exit 1; }
MANIFEST="$ENGINE_ROOT/graph/$LANG_/souffle/export_manifest.tsv"
mkdir -p "$WORK"
EMPTY_LIB="$WORK/.empty-library"; mkdir -p "$EMPTY_LIB"

# the `lib` variant's library: the pinned packages' TYPE declarations, parsed once per run
LIBIR="$WORK/.hono-lib-ir"
stage_lib() {
  [ -s "$LIBIR/all-typescript-modules.csv" ] && return 0
  local src="$WORK/.hono-lib-src" p
  rm -rf "$src" "$LIBIR"; mkdir -p "$src" "$LIBIR"
  [ -d "$ORACLE_DIR/node_modules/hono" ] || { echo "  (lib variant needs truth/node_modules: npm install there)"; return 1; }
  for p in hono @hono/zod-openapi @hono/zod-validator @hono/node-server; do
    local d="$ORACLE_DIR/node_modules/$p"; [ -d "$d" ] || continue
    mkdir -p "$src/$p"; cp "$d/package.json" "$src/$p/"
    if [ -d "$d/dist/types" ]; then cp -R "$d/dist/types/." "$src/$p/"
    else (cd "$d/dist" && find . -name '*.d.ts' -o -name '*.d.mts' | while read -r f; do mkdir -p "$src/$p/$(dirname "$f")"; cp "$f" "$src/$p/$f"; done); fi
  done
  node "$PARSER" "$src" "hono-lib" false "$LIBIR" >"$WORK/.hono-lib.log" 2>&1
  [ -s "$LIBIR/all-typescript-modules.csv" ]
}

solve() { # ir lib out   (writes $3/rss_kb: the peak resident set of the solve, from /usr/bin/time -l)
  local rc
  if [ -x /usr/bin/time ]; then
    /usr/bin/time -l bash "$ENGINE_ROOT/graph/pipeline/run-souffle.sh" --debug --language "$LANG_" \
      --client-ir "$1" --library "$2" --intermediate "$3/int" --output "$3/out" >"$3/solve.log" 2>"$3/solve.err"; rc=$?
    cat "$3/solve.err" >>"$3/solve.log"
    # macOS reports bytes, GNU time kilobytes: normalise to KB
    awk -v div="$([ "$(uname)" = Darwin ] && echo 1024 || echo 1)" '/maximum resident set size/{b=$1} END{if(b!="") print int(b/div)}' "$3/solve.err" >"$3/rss_kb"
    return $rc
  fi
  bash "$ENGINE_ROOT/graph/pipeline/run-souffle.sh" --debug --language "$LANG_" \
    --client-ir "$1" --library "$2" --intermediate "$3/int" --output "$3/out" >"$3/solve.log" 2>&1
}

rows_of() { grep -v '^#' "$1" | grep -v '^absent' | grep -v '^$' | sort; }

pass=0; fail=0; failed=(); notexported=0
for dir in "$HERE"/cases/*/*/; do
  dir="${dir%/}"; suite="$(basename "$(dirname "$dir")")"; name="$(basename "$dir")"; id="$suite/$name"
  if [ ${#FILTERS[@]} -gt 0 ]; then
    m=0; for f in "${FILTERS[@]}"; do [[ "$id" == *"$f"* ]] && m=1; done; [ $m = 1 ] || continue
  fi
  printf '%-44s ' "$id"
  exp="$HERE/expected/$suite/$name.tsv"; ent="$HERE/expected/$suite/$name.entries"; km="$HERE/expected/$suite/$name.known-missing"
  # chains/ (SPEC R18-R21): a third golden of whole call chains, checked against the compiler oracle and the runtime trace
  chf="$HERE/expected/$suite/$name.chains"; chargs=()
  w="$WORK/$suite/$name"; rm -rf "$w"; mkdir -p "$w"
  # a `partial-paths` file opts the case into `ppath` rows: the known path of each partial route (hono-7-05)
  oflags=(); [ -f "$dir/partial-paths" ] && oflags=(--partial-paths)
  ok=1; notes=""

  if [ "$DRAFT" = 1 ]; then
    mkdir -p "$(dirname "$exp")"
    if node "$ORACLE_DIR/hono-oracle.mjs" "$dir/src" --stores ${oflags[@]+"${oflags[@]}"} >"$w/oracle.full" 2>"$w/oracle.log"; then
      rt="$(node "$ORACLE_DIR/runtime-check.mjs" "$dir/src" "$w/oracle.full" 2>&1 | head -6)"
      grep -v '^store' "$w/oracle.full" | grep -v '^entry' >"$exp.draft"
      grep '^entry' "$w/oracle.full" >"$ent.draft"
      if [ "$suite" = chains ]; then
        node "$ORACLE_DIR/cc-oracle.mjs" "$dir/src" >"$w/cc.tsv" 2>"$w/cc.log"
        node "$ORACLE_DIR/chain-runtime.mjs" "$dir/src" /dev/null --edges --routes "$w/oracle.full" --requests "$chf" >"$w/rt.tsv" 2>&1
        rt="$rt; $(python3 "$TS_HONO/tools/chain_check.py" --cc "$w/cc.tsv" --hono "$w/oracle.full" --rt "$w/rt.tsv" --draft "$chf.draft")"
      fi
      echo "drafted ($rt)"; pass=$((pass+1))
    else echo "FAIL (oracle refused)"; sed 's/^/    /' "$w/oracle.log" | head -4; fail=$((fail+1)); failed+=("$id"); fi
    continue
  fi

  golds=("$exp" "$ent"); [ "$suite" = chains ] && golds+=("$chf")
  [ -f "$chf" ] && chargs=(--chains "$chf")
  for f in "${golds[@]}"; do
    if [ ! -f "$f" ]; then echo "FAIL (no golden: ${f#$HERE/}: draft with --draft, then REVIEW)"; ok=0; break; fi
    if ! head -1 "$f" | grep -q '^# hand-reviewed'; then echo "FAIL (golden not reviewed: ${f#$HERE/} lacks the '# hand-reviewed' header)"; ok=0; break; fi
  done
  [ $ok = 1 ] || { fail=$((fail+1)); failed+=("$id"); continue; }

  if [ "$ORACLE" = 1 ]; then
    if node "$ORACLE_DIR/hono-oracle.mjs" "$dir/src" --stores ${oflags[@]+"${oflags[@]}"} >"$w/oracle.full" 2>"$w/oracle.log"; then
      grep -v '^store' "$w/oracle.full" | sort >"$w/oracle.rows"
      cat "$exp" "$ent" | rows_of /dev/stdin >"$w/expected.rows"
      if grep -q 'ORACLE_UNDECIDED' "$w/oracle.rows"; then echo "FAIL (the oracle could not decide a chain: extend it, do not hand-write)"; ok=0; fi
      if ! diff -q "$w/expected.rows" "$w/oracle.rows" >/dev/null; then
        echo "FAIL (expected differs from the oracle)"; diff "$w/expected.rows" "$w/oracle.rows" | sed 's/^/    /' | head -20; ok=0
      fi
      # an `absent` row on a location that is no function can never fail: refuse it here, engine or not
      node "$TS_HONO/tools/fn-locs.mjs" "$dir/src" | cut -f1 >"$w/fns"
      for a in $(grep '^absent' "$exp" | cut -f2); do grep -qxF "$a" "$w/fns" || { echo "FAIL (absent row $a names no function in the fixture)"; ok=0; }; done
      rt="$(node "$ORACLE_DIR/runtime-check.mjs" "$dir/src" "$w/oracle.full" 2>&1)"; rc=$?
      if [ $rc -ne 0 ]; then echo "FAIL (runtime oracle disagrees with the static oracle)"; echo "$rt" | sed 's/^/    /' | head -8; ok=0; fi
      notes="[$(echo "$rt" | head -1)]"
      if [ -f "$chf" ]; then
        if ! node "$ORACLE_DIR/cc-oracle.mjs" "$dir/src" >"$w/cc.tsv" 2>"$w/cc.log"; then echo "FAIL (call-chain oracle refused)"; head -3 "$w/cc.log" | sed 's/^/    /'; ok=0
        else
          node "$ORACLE_DIR/chain-runtime.mjs" "$dir/src" /dev/null --edges --routes "$w/oracle.full" --requests "$chf" >"$w/rt.tsv" 2>&1
          if grep -q '^runtime skip' "$w/rt.tsv"; then echo "FAIL (chains need the runtime trace: $(grep '^runtime skip' "$w/rt.tsv"))"; ok=0; fi
          if ! python3 "$TS_HONO/tools/chain_check.py" --cc "$w/cc.tsv" --hono "$w/oracle.full" --rt "$w/rt.tsv" --golden "$chf" >"$w/chaincheck.txt"; then
            echo "FAIL (chains golden differs from the oracles)"; sed 's/^/    /' "$w/chaincheck.txt" | head -12; ok=0; fi
          crt="$(node "$ORACLE_DIR/chain-runtime.mjs" "$dir/src" "$chf" 2>&1)" || { echo "FAIL (a chain hop was not observed at run time)"; echo "$crt" | sed 's/^/    /' | head -8; ok=0; }
          notes="$notes [$(head -1 "$w/chaincheck.txt"); $(echo "$crt" | tail -1)]"
        fi
      fi
    else
      echo "FAIL (oracle refused: the case is unscored, not passing)"; sed 's/^/    /' "$w/oracle.log" | head -4; ok=0
    fi
    if [ "$ORACLE_ONLY" = 1 ]; then
      if [ $ok = 1 ]; then echo "oracle ok $notes"; pass=$((pass+1)); else fail=$((fail+1)); failed+=("$id"); fi
      continue
    fi
  fi

  mkdir -p "$w/ir"
  if ! node "$PARSER" "$dir/src" "$name" false "$w/ir" >"$w/parse.log" 2>&1; then
    echo "FAIL (parse: see $w/parse.log)"; fail=$((fail+1)); failed+=("$id"); continue; fi
  res=""
  for variant in bare lib; do
    v="$w/$variant"; mkdir -p "$v"
    lib="$EMPTY_LIB"
    if [ "$variant" = lib ]; then
      if ! stage_lib; then res="$res lib:STAGING-FAILED"; ok=0; continue; fi
      lib="$LIBIR"
    fi
    t0=$(date +%s)
    if ! solve "$w/ir" "$lib" "$v"; then res="$res $variant:SOLVE-FAILED(see $v/solve.log)"; ok=0; continue; fi
    dt=$(( $(date +%s) - t0 ))
    # scale/ cases carry a wall-time budget (seconds) for the solve; exceeding it fails the case
    # budget file: line 1 = seconds, optional `rss_mb N` = peak resident set of the solve
    rss_mb=$(( $(cat "$v/rss_kb" 2>/dev/null || echo 0) / 1024 ))
    if [ -f "$dir/budget" ]; then
      tb="$(head -1 "$dir/budget")"; mb="$(sed -n 's/^rss_mb //p' "$dir/budget")"
      if [ "$dt" -gt "$tb" ]; then res="$res $variant:OVER-BUDGET(${dt}s>${tb}s)"; ok=0; continue; fi
      if [ -n "$mb" ] && [ ! -s "$v/rss_kb" ]; then res="$res $variant:RSS-UNMEASURED"; ok=0; continue; fi
      if [ -n "$mb" ] && [ "$rss_mb" -gt "$mb" ]; then res="$res $variant:OVER-MEMORY(${rss_mb}MB>${mb}MB)"; ok=0; continue; fi
    fi
    python3 "$TS_HONO/tools/hono_compare.py" --lang "$LANG_" --ir "$w/ir" --raw "$v/out/raw" \
      --manifest "$MANIFEST" --relations "$TS_HONO/relations.tsv" --expected "$exp" --entries "$ent" \
      --known-missing "$km" --variant "$variant" ${chargs[@]+"${chargs[@]}"} >"$v/compare.txt" 2>&1; rc=$?
    # an http entry_point row the engine adds that is not in the golden: if the BASELINE engine
    # (HONO_BASELINE_ROOT, default the untouched baseline worktree) already emits it on the same IR, it is
    # pre-existing receiver-blind behaviour SPEC keeps, not a Hono row (orchestrator ruling, iteration 1)
    if [ $rc -eq 1 ] && grep -q '^EXTRA    entry' "$v/compare.txt"; then
      mkdir -p "$v/base"
      if bash "$BASELINE_ROOT/graph/pipeline/run-souffle.sh" --debug --language "$LANG_" --client-ir "$w/ir" --library "$lib" \
           --intermediate "$v/base/int" --output "$v/base/out" >"$v/base/solve.log" 2>&1; then
        python3 "$TS_HONO/tools/hono_compare.py" --lang "$LANG_" --ir "$w/ir" --raw "$v/out/raw" \
          --manifest "$MANIFEST" --relations "$TS_HONO/relations.tsv" --expected "$exp" --entries "$ent" \
          --known-missing "$km" --variant "$variant" ${chargs[@]+"${chargs[@]}"} --baseline-raw "$v/base/out/raw" >"$v/compare.txt" 2>&1; rc=$?
      else res="$res $variant:BASELINE-SOLVE-FAILED"; ok=0; continue; fi
    fi
    n="$(sed -n 's/^compared=//p' "$v/compare.txt" | tail -1)"
    if [ $rc -eq 3 ]; then res="$res $variant:$(head -1 "$v/compare.txt")"; ok=0; notexported=1; continue; fi
    if [ $rc -eq 1 ]; then res="$res $variant:DIFF"; ok=0; continue; fi
    if [ $rc -ne 0 ]; then res="$res $variant:COMPARE-CRASHED(see $v/compare.txt)"; ok=0; continue; fi
    if [ "${n:-0}" -lt 1 ]; then res="$res $variant:COMPARED-0"; ok=0; continue; fi
    res="$res $variant:ok($n,${dt}s,${rss_mb}MB)"
  done
  if [ $ok = 1 ]; then echo "ok$res $notes"; pass=$((pass+1))
  else
    echo "FAIL$res"
    for variant in bare lib; do [ -f "$w/$variant/compare.txt" ] && grep -E '^(MISSING|EXTRA|NOW-FIXED|PRESENT|CHAIN-BROKEN)' "$w/$variant/compare.txt" | head -12 | sed "s/^/    $variant /"; done
    fail=$((fail+1)); failed+=("$id")
  fi
done
[ "$KEEP" = 1 ] || rm -rf "$WORK"/*/
echo
echo "passed $pass, failed $fail"
[ $((pass+fail)) -ge 1 ] || { echo "FAIL: no case ran (a filter matching nothing is not a pass)"; exit 1; }
[ $fail -eq 0 ] || { printf '  %s\n' "${failed[@]}"; exit 1; }
