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

# ── PREFLIGHT: no reader dies on a big IR field ──────────────────────────────
# Python's csv module caps one field at 128 KiB, and an IR literalValue holding a base64 asset
# is several hundred KB. Every reader that opens an IR CSV then dies AFTER the extraction, the
# solve and the oracle have all succeeded. Costs milliseconds and is repo-wide, because the
# readers span all three languages. See issue #238.
if ! bash "$ROOT/test/tools/csv-limit-test.sh"; then
  echo "aborting: a reader of the IR would die on a large literal"
  exit 1
fi
# ── PREFLIGHT: a relation with no rows is not a drifted schema ───────────────
# The parser writes a relation with no rows as a ZERO-BYTE file, so an unguarded next() on the
# header raises StopIteration -- and the TypeScript harness reported that as "refusing to measure
# against a drifted schema", the one fault that gate exists to catch. Lints every CSV reader in
# the tree for the same shape, because it was in three places and only one crashed. See #244.
if ! bash "$ROOT/test/tools/empty-relation-test.sh"; then
  echo "aborting: a reader would die on a relation that simply has no rows"
  exit 1
fi

# ── PREFLIGHT: both sides of the comparison spell a declaration the same way ──
# `const step = (x) => ...` is `step` to the compiler and was `<arrow@1>` here, so every call to
# it read as one MISSING plus one extra -- and MISSING is this suite's failure verdict. The cause
# was reading a variable's ENCLOSING method (tsMethodLinkHash) as the function it binds
# (boundFunctionLinkHash), which also named the module initializer after an unrelated const.
# Synthesised IR, so it needs no parser and no solver. See #236.
if ! bash "$HERE/tools/arrow-naming-test.sh"; then
  echo "aborting: the engine and the compiler side name a declaration differently"
  exit 1
fi

# ── PREFLIGHT: an anonymous shape is not an owner, and both sides agree what is ─
# The same declaration at the same line had two names: `{ run(n: number): string }#run`
# here — the literal's own source text, truncated at 120 characters — against
# `members#run` on the compiler side, and in the OTHER direction `members#<arrow@39>`
# here against `Holder#<arrow@39>` there for an arrow that is an interface property's
# type. One MISSING plus one extra per call, on accuracy already got right, with three
# such lines parked in a known-missing file as gaps that never existed. Four of the ten
# checks are controls, including one that removes the relation the rule reads and
# requires the answer to DEGRADE — right for the wrong reason is not a passing rule.
# Synthesised IR, so it needs no parser and no solver and cannot skip. See #322.
if ! bash "$HERE/tools/shape-owner-test.sh"; then
  echo "aborting: the two sides do not agree on what owns a member of an anonymous shape"
  exit 1
fi

# ── PREFLIGHT: the dispatch envelope, and what the report claims about it ─────
# The envelope adds the resolved symbol's declaration set to the bound so that picking
# a different OVERLOAD scores as over-approximation rather than fabrication. It read
# that set off the symbol local to the declaration the compiler picked, which carries
# only same-file declarations — so every CROSS-FILE merge (`lib.dom` vs `@types/node`
# `setTimeout`, `String#replace` across two `lib.*.d.ts`) was dropped from the bound.
#
# The second half is what the report then said about the residue: one total labelled
# `demonstrable false positives`, of which 74 in 2,728 sat on a site the scorer itself
# called WRONG. Both halves land on a wrong ANSWER a reader would act on. See #242.
#
# The report check synthesises its own IR and needs no compiler, so it cannot skip; the
# envelope check needs a real TypeScript and says so when it cannot find one.
if ! python3 "$HERE/tools/envelope_report_test.py"; then
  echo "aborting: the dispatch-envelope report is not decomposing what it claims"
  exit 1
fi

# ── PREFLIGHT: what --production counts decides what every corpus number means ─
# `TEST_PATH` matched `.test.ts` and not `.test-d.ts`, the vitest convention for TYPE
# tests, so on the dev member whose type tests outnumber its source 11,055 of 11,818
# "production" sites were tests — and they score better than real code, so the leak
# RAISED the development rate. Fixed in #276, pinned here (#280). Five of the twelve
# pattern cases are controls: a filter's failure mode is symmetric, and over-filtering
# deletes real sites from the measurement just as silently. Synthesised, cannot skip.
if ! python3 "$HERE/tools/production-filter-test.py"; then
  echo "aborting: the production filter is not selecting the population it names"
  exit 1
fi

# ── PREFLIGHT: an unsupported compiler is a refusal, not a TypeError ──────────
# TypeScript 7 is the native port and its npm package exports exactly `version` and
# `versionMajorMinor` — no `sys`, no `createProgram`. The stack deliberately prefers
# the PROJECT's compiler, so a project pinned to the current major died on the first
# property access after a solve that can take a thousand seconds, and a reader seeing
# that stack trace goes looking for a bug in the oracle rather than for the pin. The
# last check is a LINT: a guard living in one of five entry points is not a guard.
# See #239.
if ! bash "$HERE/tools/compiler-load-test.sh"; then
  echo "aborting: an unmeasurable compiler is not being refused cleanly at every entry point"
  exit 1
fi

# ── PREFLIGHT: one library that declares nothing must not end the evaluation ──
# `add_lib` returns 1 as an ordinary outcome — a deprecated `@types/<pkg>` stub is a
# package.json and a README — and at one call site it was the command after the final
# `&&`, so under `set -e` its status was the AND-list's and the whole run died
# mid-staging with no error line and no score. Every other call site was already
# guarded, which is what makes it invisible on review: the two forms differ by four
# characters and the unguarded one is the more natural thing to write. See #234.
if ! bash "$HERE/tools/staging-guard-test.sh"; then
  echo "aborting: a library that declares nothing would end the evaluation"
  exit 1
fi

# ── PREFLIGHT: the project is not one of its own dependencies ────────────────
# In a workspace `node_modules/<own-name>` links back to the package being analysed, so
# discovery staged it like any other dependency and every declaration in the project
# existed twice — one declaration, two answers, hedged instead of exact. Measured on a
# workspace built to that shape, changing nothing else: exactness 0.200 -> 0.800,
# decisiveness 0.200 -> 1.000. See #231.
if ! bash "$HERE/tools/self-staging-test.sh"; then
  echo "aborting: the project would be staged as its own dependency"
  exit 1
fi

# ── PREFLIGHT: a self-link points AT the mirror, not back out of it ───────────
# The mirror's node_modules is filled with links into the ORIGINAL roots, which is
# right for a dependency and wrong for a workspace self-link: it resolved back to the
# original copy of the project, so a file importing its own package by name was
# adjudicated against a tree the engine's IR does not contain — same file, same line,
# same column, different root, scored WRONG while both sides agreed. Measured on a
# workspace built to that shape: exactness 0.800 -> 1.000, one WRONG -> none. See #293.
if ! bash "$HERE/tools/mirror-selflink-test.sh"; then
  echo "aborting: a self-import would be adjudicated outside the analysed tree"
  exit 1
fi

# ── PREFLIGHT: a space in the checkout path must not empty the staging ────────
# NM_ROOTS was a space-delimited string iterated unquoted, so a path containing a space
# split into fragments and EVERY dependency lookup missed — no standard library, no
# @types, no dependencies — while the run still printed a score computed against an
# empty global scope. Same tree, one variable: /tmp/nospace staged 45 lib.*.d.ts and
# passed; "/tmp/with space" staged none and the oracle refused. LIBARGS had the
# identical shape. See #296.
if ! bash "$HERE/tools/path-space-test.sh"; then
  echo "aborting: a path containing a space would silently stage no libraries"
  exit 1
fi

# ── PREFLIGHT: a body that implements a signature is not a wrong answer ───────
# `const f: Api<S>['setState'] = (...a) => {}` is the type literal's call signature to
# the compiler and the arrow to the engine, so a call through it scored WRONG. The old
# credit could not reach it for two reasons at once — different files, and the arrow is
# anonymous. Measured on a dev corpus member: 9 of its 9 WRONG rows are that shape,
# WRONG 9 -> 0 and edge-correct 0.598 -> 0.641, every other bucket unchanged. Four of
# the six checks are controls, because the tempting rule — assignability rather than the
# contextual type — credits an UNANNOTATED arrow and manufactures the agreement it is
# supposed to measure. See #237.
# A `.source-root` the reader cannot resolve keys every staged declaration under a path
# nothing else names, and the empty join that follows is reported as a plausible rate
# over the client's own files rather than as a failure (#342).
if ! python3 "$HERE/tools/source_root_test.py"; then
  echo "source-root: FAILED"
  fail=$((fail+1)); failed+=("source-root")
fi

if ! bash "$HERE/tools/signature-impl-test.sh"; then
  echo "aborting: the signature/implementation map is not what the compiler says"
  exit 1
fi

# ── another overload of the same callable is not a wrong answer ──────────────
# `_same_group` compared `declarationGroupKey`, which the parser populates for
# FUNCTION_DECLARATION and nothing else — so an overloaded class METHOD (3,272 keyless
# rows on one project) and every signature kind were invisible to the credit, including
# the construct signatures of an interface the standard library REOPENS in another file.
# Two corpus rows read as the engine naming a target the compiler disagrees with when it
# had named another overload of the same thing (#310). Two of the four checks are
# controls: a same-named method on an unrelated class must NOT be a sibling, or the
# grouping is a name match and manufactures agreement.
if ! bash "$HERE/tools/overload-sibling-test.sh"; then
  echo "aborting: the overload-sibling grouping is not what it claims"
  exit 1
fi
if ! bash "$HERE/tools/envelope-merge-test.sh"; then
  echo "aborting: the dispatch envelope is not the resolved symbol's declaration set"
  exit 1
fi
PARSER="${AXIOM_PARSER:-$ROOT/../Parser/dist/index.js}"
WORK="$HERE/.work"
BLESS=0; KEEP=0; ORACLE=0; FILTERS=()
for a in "$@"; do case "$a" in
  --bless) BLESS=1;; --keep) KEEP=1;; --oracle) ORACLE=1;;
  -h|--help) sed -n '2,32p' "$0"; exit 0;; *) FILTERS+=("$a");; esac; done

[ -f "$PARSER" ] || { echo "SKIP: parser not found at $PARSER (set AXIOM_PARSER)"; exit 77; }
# ── --bless WITHOUT --oracle LEAVES THE ORACLE GOLDENS STALE ────────────────
# This has left main red twice. `normalize_edges.py` builds the ENGINE side of BOTH the
# edge goldens and the oracle diff, so a change to how it labels a declaration moves every
# line of both. But the oracle block below only runs under --oracle, so `--bless` alone
# regenerates `.edges` and never recomputes `.oracle` — and the staleness surfaces on
# somebody else's branch as "oracle changed", which reads like an engine regression and is
# not one.
#
# Worse, the two disagreeing can manufacture phantom debt: an arrow labelled `<arrow@11>`
# on one side and `shadowed` on the other scores one MISSING plus one extra, which is
# arithmetically self-consistent, and the MISSING then gets written into `known-missing`
# where the "a listed gap that starts working also fails" rule locks it in.
#
# So refuse rather than warn. There is no case where regenerating one and not the other is
# what the author meant.
if [ "$BLESS" = "1" ] && [ "$ORACLE" != "1" ]; then
  n_oracle=$(find "$HERE/expected" -name '*.oracle' 2>/dev/null | wc -l | tr -d ' ')
  if [ "${n_oracle:-0}" -gt 0 ]; then
    echo "REFUSING: --bless without --oracle"
    echo "  It would regenerate the .edges goldens and leave $n_oracle .oracle golden(s)"
    echo "  describing the PREVIOUS labels. normalize_edges.py builds both sides, so an"
    echo "  engine-label change moves every .oracle line too."
    echo "  Run:  ./run-tests.sh ${FILTERS[*]:-} --bless --oracle"
    exit 2
  fi
fi

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
      # A REFUSED ORACLE IS NOT A PASS (#235). The oracle declines a case that does not
      # typecheck, because the checker would then be answering about a program nobody
      # wrote — that refusal is correct. Recording it as "SKIPPED" and leaving the case
      # green is not: one committed case had never been scored against ground truth and
      # the suite reported it ok on every run. A missing measurement must not read as a
      # passing one, which is the rule the project harness already applies to itself.
      echo "FAIL (oracle refused — the case is unscored, not passing)"
      sed -n '1,4p' "$w/oracle.log" | sed 's/^/    /'
      ok=0
      orc="  [oracle REFUSED]"
    fi
    if [ "$HAS_LIB" = "1" ]; then
      if node "$HERE/tools/tsc_oracle_case.mjs" "$dir/src" "$dir/lib" \
           > "$w/oracle.lib.pairs" 2>"$w/oracle-lib.log"; then
        python3 "$HERE/tools/normalize_edges.py" "$w/ir" "$w/withlib/out" --client-pairs \
        --lib-ir "$w/libir" > "$w/engine.lib.pairs"
        python3 "$HERE/tools/oracle_diff.py" "$w/engine.lib.pairs" "$w/oracle.lib.pairs" \
        "$HERE/expected/$name.lib.known-missing" > "$w/oracle.lib.diff"; rc=$?
        check_golden "$w/oracle.lib.diff" "$HERE/expected/$name.lib.oracle" "lib-oracle" || ok=0
        [ $rc -eq 0 ] || { echo "FAIL (lib oracle: NEW missing edge, or a known-missing one started working)"
        grep -E 'MISSING|NOW-FIXED|^oracle=' "$w/oracle.lib.diff" | head -12 | sed 's/^/    /'; ok=0; }
        orc="$orc  [lib: $(head -1 "$w/oracle.lib.diff")]"
      else
        # Same rule for the library pass. Previously the `if` simply did not fire and the
        # client->library half went unadjudicated in silence.
        echo "FAIL (lib oracle refused — the client->library half is unscored)"
        sed -n '1,4p' "$w/oracle-lib.log" | sed 's/^/    /'
        ok=0
        orc="$orc  [lib: REFUSED]"
      fi
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
  # Asked once, here, and passed explicitly. The fixture's own default used to be an
  # absolute path inside one developer's home directory and this call never passed the
  # argument, so anywhere else `typescript/lib` was never staged, the global scope was
  # empty, and the MANDATORY baseline failed with three assertions that read as engine
  # defects in native resolution rather than as a missing argument (#331).
  NODE_MODULES="$(bash "$HERE/tools/find-node-modules.sh" || true)"
  [ -n "$NODE_MODULES" ] || echo "  ! no node_modules with a typescript found — fixtures will say so"

  echo "── linking fixture ──"
  if bash "$HERE/fixtures/linking/run.sh" "${WORK:-/tmp/ts-linking-fixture}-linking" "$NODE_MODULES" >"$WORK-linking.log" 2>&1; then
    echo "linking fixture: ok"
  else
    echo "linking fixture: FAILED"
    grep -E '^FAIL' "$WORK-linking.log" | sed 's/^/  /' || tail -5 "$WORK-linking.log" | sed 's/^/  /'
    fail=$((fail+1)); failed+=("linking-fixture")
  fi

  # ── THE FOUR GATES NOTHING RAN ──────────────────────────────────────────────
  # The comment above says it for the fifth: a gate nobody runs is not a gate. That
  # reasoning was acted on for `linking` and these four were left, so the suite could
  # report green while any of the four mechanisms was broken. All four pass today and
  # take about six seconds each — they are unrun, not rotten (#332).
  #
  # Each isolates a question the per-case goldens cannot ask:
  #   dispatch     an interface-typed receiver, where the compiler names the SIGNATURE
  #                and the engine emits the reachable BODIES — two different right
  #                answers, deliberately kept apart
  #   typeflow     every way a receiver acquires a type other than being annotated,
  #                with member names shared on purpose so a lucky name match cannot pass
  #   overloads    one overload set reached through a barrel re-export and by direct
  #                import, so a difference between the two consumers is the module graph
  #                rather than the overload logic
  #   specificity  generic-first overload sets in both directions, built because the
  #                obvious fix for the largest corpus failure class is wrong
  #
  # Second argument is a node_modules to stage a `typescript` from, discovered rather
  # than defaulted to one developer's home directory (#331). Empty means the fixture
  # falls back to its own discovery and says so.
  for fx in dispatch typeflow overloads specificity; do
    echo
    echo "── $fx fixture ──"
    bash "$HERE/fixtures/$fx/run.sh" "${WORK:-/tmp/ts-$fx}-$fx" "$NODE_MODULES"          >"$WORK-$fx.log" 2>&1
    rc=$?
    if [ "$rc" -eq 0 ]; then
      echo "$fx fixture: ok"
    elif [ "$rc" -eq 77 ]; then
      echo "$fx fixture: SKIPPED ($(tail -1 "$WORK-$fx.log"))"
    else
      echo "$fx fixture: FAILED"
      grep -E '^FAIL|^ *!' "$WORK-$fx.log" | sed 's/^/  /' || tail -5 "$WORK-$fx.log" | sed 's/^/  /'
      fail=$((fail+1)); failed+=("$fx-fixture")
    fi
  done

  # Harness gates that take a parser and assert a property of the pipeline itself.
  # Neither is expressible as a case: a case carries its own src/tsconfig.json with
  # nothing to extend (#240), and none installs a package with several programs (#230).
  # Exit 77 is a fixture declining for want of a parser — not a pass and not a failure.
  for fx in tsconfig-chain multi-program; do
    echo
    echo "── $fx fixture ──"
    bash "$HERE/fixtures/$fx/run.sh" "${WORK:-/tmp/ts-$fx}-$fx" "$PARSER" \
         >"$WORK-$fx.log" 2>&1
    rc=$?
    if [ "$rc" -eq 0 ]; then
      echo "$fx fixture: ok"
    elif [ "$rc" -eq 77 ]; then
      echo "$fx fixture: SKIPPED ($(tail -1 "$WORK-$fx.log"))"
    else
      echo "$fx fixture: FAILED"
      grep -E '^FAIL' "$WORK-$fx.log" | sed 's/^/  /' || tail -5 "$WORK-$fx.log" | sed 's/^/  /'
      fail=$((fail+1)); failed+=("$fx-fixture")
    fi
  done
fi

[ "$KEEP" = "1" ] || rm -rf "$WORK"
echo
echo "passed $pass, failed $fail"
[ $fail -eq 0 ] || { printf '  %s\n' "${failed[@]}"; exit 1; }
