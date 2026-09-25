#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Every query verb returns the RIGHT answer on a tiny project whose answers are known.
#
#   e2e-queries.sh <axiomcode-bin> <fixture-dir> <work-dir>
#
# <fixture-dir> is .github/e2e/<language>/: entry() calls helper() calls leaf(), one test
# calls entry(), and `expect` names the four in that language's spelling. The project is
# copied to <work-dir>, committed, indexed, and asked:
#
#   impact LEAF            lists HELPER, the method that calls it
#   path ENTRY LEAF        reached, through HELPER
#   path ENTRY LEAF        the same from the shipped Datalog programs (AXIOMCODE_DATALOG=1)
#   path … --every         at least one route listed, both backends
#   context LEAF           names LEAF
#   leaf's 41 becomes 42, then
#   changed                names LEAF
#   test-impact            selects TEST
#
# Running is not passing: each answer has to contain what the project makes true, and no
# answer may carry a Python traceback.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
bin="${1:?usage: e2e-queries.sh <axiomcode-bin> <fixture-dir> <work-dir>}"; fx="${2:?fixture-dir}"; R="${3:?work-dir}"
fail() { echo "::error::e2e queries ($(basename "$fx")): $*"; exit 1; }
# shellcheck disable=SC2046
eval "$(cat "$fx/expect")"
rm -rf "$R"; mkdir -p "$R"; cp -R "$fx"/. "$R"/; rm -f "$R/expect"
git -C "$R" init -q && git -C "$R" add -A && git -C "$R" -c user.email=e2e@axiomcode -c user.name=e2e commit -qm base \
  || fail "could not commit the fixture"

"$bin" index "$R" > "$R/.index.log" 2>&1 || { tail -20 "$R/.index.log"; fail "axiomcode index exited non-zero"; }
grep 'datalog rules ready' "$R/.index.log" | sed 's/^/   /'

run() {  # <env> <verb and args…>: the answer lands in $R/.q.log, a non-zero exit or a traceback fails
  local env="$1"; shift; LABEL="$* ${env:+($env)}"
  ( cd "$R" && env $env "$bin" "$@" ) > "$R/.q.log" 2>&1; local rc=$?
  if [ "$rc" -ne 0 ] || grep -q 'Traceback (most recent call last)' "$R/.q.log"; then
    sed 's/^/     /' "$R/.q.log" | head -25; fail "$LABEL: rc=$rc"
  fi
}
must() {  # <extended regex> the last answer has to match, and why
  grep -Eq -- "$1" "$R/.q.log" || { sed 's/^/     /' "$R/.q.log" | head -25; fail "$LABEL: expected /$1/ ($2)"; }
  echo "   ok  $LABEL  — $2"
}
DL="AXIOMCODE_DATALOG=1"
run "" impact "$LEAF";                          must "\[resolved\] ([A-Za-z_.]*\.)?$HELPER .*calls it" "$HELPER is a resolved caller"
for e in "" "$DL"; do
  run "$e" path "$ENTRY" "$LEAF";               must "reached" "a chain exists"
                                                must "→ .*([A-Za-z_.]*\.)?$HELPER " "the chain goes through $HELPER"
  run "$e" path "$ENTRY" "$LEAF" --every;       must "[0-9]+ hop\(s\): .*$HELPER.* → .*$LEAF" "a route through $HELPER to $LEAF is listed"
done
run "" context "$LEAF";                         must "^ +([A-Za-z_.]*\.)?$LEAF +" "$LEAF is an entry point"

# a real edit to leaf's body: what changed, and which tests have to run for it
sed 's/41/42/' "$R/$LEAF_FILE" > "$R/.edit" && mv "$R/.edit" "$R/$LEAF_FILE"
git -C "$R" diff --quiet && fail "the edit to $LEAF_FILE changed nothing"
run "" changed;                                 must "([A-Za-z_.]*\.)?$LEAF\b" "$LEAF is reported changed"
run "" test-impact;                             must "^tests to run: [1-9]" "a test reaches the change through the graph"
                                                must "^ +\S*$TEST\S* +\(" "$TEST is the test selected"
echo "e2e queries: every verb answered correctly for $(basename "$fx")"
