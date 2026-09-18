#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# bin/axiomcode --library staging: every source-tree entry gets its own intermediate
# directory, whatever its directory name, and the bundle names each library row by its
# package.
#
# A client requires two copies of one package that both live in a directory called `gamma`
# (the top-level copy from app.js, a nested second version from tools/run.js through its own
# node_modules) and a scoped `@scope/beta` beside an unscoped `beta`. Staged by basename, the
# second parse of each pair overwrote the first with nothing printed, and the client's call
# resolved to the surviving copy (#600); in graph.sqlite both copies were `index.run` in
# `index.js` (#603); and the package-name import join linked every client import of `gamma`
# to BOTH copies (#599). Asserted here:
#   1. five --library entries produce five intermediate IR directories; an entry listed twice
#      is staged once
#   2. every staged package's methods are in the staged library IR
#   3. app.js -> gamma.run() reaches the top-level copy only, tools/run.js -> gamma.run() the
#      nested copy only (graph.sqlite)
#   4. a library row's file_path and qualified_name carry the package as its path under the
#      client, so the two copies are distinguishable in the bundle
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
[ -f "$ROOT/parser/dist/index.js" ] || { echo "library-staging-test: SKIP (parser not built)"; exit 0; }
command -v souffle >/dev/null || { echo "library-staging-test: SKIP (no souffle)"; exit 0; }
# the PHYSICAL path: the resolver records a dependency's real path, and a library staged
# under a symlinked spelling of the same directory (macOS's /var -> /private/var) would not
# join on it
W="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$W"' EXIT
fail=0; bad(){ echo "  ✗ $*"; fail=$((fail+1)); }
A="$W/app"; mkdir -p "$A/node_modules/gamma" "$A/tools/node_modules/gamma" "$A/node_modules/beta" "$A/node_modules/@scope/beta"
echo '{ "name": "app" }' > "$A/package.json"
echo '{ "name": "gamma", "version": "1.0.0", "main": "index.js" }' > "$A/node_modules/gamma/package.json"
echo 'exports.run = function runV1() { return 1; };' > "$A/node_modules/gamma/index.js"
echo '{ "name": "gamma", "version": "2.0.0", "main": "index.js" }' > "$A/tools/node_modules/gamma/package.json"
echo 'exports.run = function runV2() { return 2; };' > "$A/tools/node_modules/gamma/index.js"
echo '{ "name": "beta", "main": "index.js" }' > "$A/node_modules/beta/package.json"
echo 'exports.beta = function betaPlain() { return 3; };' > "$A/node_modules/beta/index.js"
echo '{ "name": "@scope/beta", "main": "index.js" }' > "$A/node_modules/@scope/beta/package.json"
echo 'exports.beta = function betaScoped() { return 4; };' > "$A/node_modules/@scope/beta/index.js"
cat > "$A/app.js" <<'JS'
'use strict';
const gamma = require('gamma');
const { beta } = require('@scope/beta');
function main() { return gamma.run() + beta(); }
main();
JS
cat > "$A/tools/run.js" <<'JS'
'use strict';
const gamma = require('gamma');
const { beta } = require('beta');
function tool() { return gamma.run() + beta(); }
tool();
JS
OUT="$W/out"
LIBS="$A/node_modules/gamma,$A/tools/node_modules/gamma,$A/node_modules/beta,$A/node_modules/@scope/beta,$A/node_modules/gamma"
if ! bash "$ROOT/bin/axiomcode" all "$A" "$OUT" --language javascript --debug --library "$LIBS" > "$W/run.log" 2>&1; then
  echo "  ✗ bin/axiomcode failed:"; tail -8 "$W/run.log"; exit 1; fi
INT="$OUT/.intermediate/lib"
n="$(ls -d "$INT"/*/ | wc -l | tr -d ' ')"
[ "$n" = "4" ] || bad "expected 4 staged library directories, found $n: $(ls "$INT" | tr '\n' ' ')"
grep -q "skipping the duplicate entry" "$W/run.log" || bad "a --library entry listed twice was not reported as skipped"
grep -q "is staged as gamma-" "$W/run.log" || bad "the second gamma was not renamed (log: $(grep '▶' "$W/run.log" | tr '\n' ' '))"
all_methods="$(cat "$INT"/*/javascript/all-javascript-methods.csv 2>/dev/null)"
for m in runV1 runV2 betaPlain betaScoped; do
  printf '%s' "$all_methods" | grep -q "$m" || bad "library method $m is not in any staged IR"
done
if command -v sqlite3 >/dev/null; then
  DB="$OUT/javascript/graph.sqlite"
  [ -f "$DB" ] || bad "no graph.sqlite at $DB"
  for m in runV1 runV2 betaPlain betaScoped; do
    c="$(sqlite3 "$DB" "select count(*) from methods where name='$m'")"
    [ "$c" -ge 1 ] || bad "method $m missing from graph.sqlite"
  done
  callee_of(){ sqlite3 "$DB" "select group_concat(m.name) from call_edges e join methods m on m.id=e.callee_method_id join methods c on c.id=e.caller_id where c.name='$1' and m.name like '$2%'"; }
  # app.js -> gamma.run(): the top-level copy; tools/run.js -> gamma.run(): the nested copy.
  # The other copy can never run from that file (#599).
  t="$(callee_of main run)"
  case "$t" in *runV1*) ;; *) bad "app.js main -> gamma.run() should reach runV1, got '${t:-nothing}'";; esac
  case "$t" in *runV2*) bad "app.js main -> gamma.run() reached the NESTED copy runV2";; esac
  t="$(callee_of tool run)"
  case "$t" in *runV2*) ;; *) bad "tools/run.js tool -> gamma.run() should reach runV2, got '${t:-nothing}'";; esac
  case "$t" in *runV1*) bad "tools/run.js tool -> gamma.run() reached the TOP-LEVEL copy runV1";; esac
  t="$(callee_of main beta)"; [ "$t" = "betaScoped" ] || bad "app.js main -> beta() should reach betaScoped only, got '${t:-nothing}'"
  t="$(callee_of tool beta)"; [ "$t" = "betaPlain" ] || bad "tools/run.js tool -> beta() should reach betaPlain only, got '${t:-nothing}'"
  # #603: a library row's file_path and qualified_name carry the package, as its path under
  # the client, so the two gamma copies are distinguishable in the bundle
  f1="$(sqlite3 "$DB" "select file_path from methods where name='runV1'")"
  f2="$(sqlite3 "$DB" "select file_path from methods where name='runV2'")"
  [ "$f1" = "node_modules/gamma/index.js" ] || bad "runV1 file_path should be node_modules/gamma/index.js, got '$f1'"
  [ "$f2" = "tools/node_modules/gamma/index.js" ] || bad "runV2 file_path should be tools/node_modules/gamma/index.js, got '$f2'"
  q="$(sqlite3 "$DB" "select qualified_name from methods where name='betaScoped'")"
  [ "$q" = "node_modules/@scope/beta/index.betaScoped" ] || bad "betaScoped qualified_name should carry its package, got '$q'"
  c="$(sqlite3 "$DB" "select count(*) from methods where provenance='lib' and file_path not like '%node_modules/%'")"
  [ "$c" = "0" ] || bad "$c library rows without a package prefix"
fi
[ $fail = 0 ] && echo "library-staging-test: ok" || { echo "library-staging-test: $fail failure(s)"; exit 1; }
