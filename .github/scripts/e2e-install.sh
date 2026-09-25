#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Install the packages the way a user would, and run them.
#
#   e2e-install.sh <engines-dir> <platform> <language> <source-dir>
#
# <engines-dir> is one platform's build-engines output (<lang>/axiomcode-engine-<lang>
# + <lang>/ENGINE_ID). This packs @axiomcode/code-graph and that platform's engine
# package exactly as publish-npm.yml would, installs both into an empty project, and
# runs `axiomcode` on <source-dir> with souffle NOT on PATH. It passes only if the
# installed package found its engine package, used it, and wrote a graph with edges —
# and then indexed that source and answered `impact` and `path` from the query programs
# the engine package ships (#1330), still with no souffle to compile or interpret them.
#
# The test suites cannot see any of this: they run from the checkout, where a missing
# `files` entry, a broken bin, or an engine package the driver does not find all go
# unnoticed until someone installs a release.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

engines="${1:?usage: e2e-install.sh <engines-dir> <platform> <language> <source-dir>}"
platform="${2:?platform}"; lang="${3:?language}"; src="${4:?source-dir}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
engines="$(cd "$engines" && pwd)"; src="$(cd "$src" && pwd)"
W="$(mktemp -d)"; SHADOW=""; trap 'rm -rf "$W" ${SHADOW:+"$SHADOW"}' EXIT
fail() { echo "::error::e2e: $*"; exit 1; }

version="$(node "$root/.github/scripts/version.mjs" get)"
echo "── packing $version"
bash "$root/packaging/assemble-engine-package.sh" "$platform" "$version" "$engines" "$W/engine" >/dev/null \
  || fail "the engine package did not assemble"
mkdir -p "$W/tgz"
( cd "$W/engine" && npm pack --silent --pack-destination "$W/tgz" >/dev/null ) || fail "npm pack of the engine package failed"
# --ignore-scripts: the tree is already built; the tarball must carry what the build produced
( cd "$root" && npm pack --silent --ignore-scripts --pack-destination "$W/tgz" >/dev/null ) || fail "npm pack of code-graph failed"
ls -1 "$W/tgz" | sed 's/^/   /'

echo "── installing into an empty project"
mkdir -p "$W/proj"
( cd "$W/proj" && npm init -y >/dev/null && npm install --no-audit --no-fund --loglevel=error "$W"/tgz/*.tgz ) \
  || fail "npm install of the packed tarballs failed"
bin="$W/proj/node_modules/.bin/axiomcode"
[ -x "$bin" ] || fail "the installed package has no axiomcode bin"

. "$root/graph/test/tools/hide-souffle.sh"
PATH="$SANDBOX_PATH" command -v souffle >/dev/null 2>&1 && fail "souffle is still on the sandbox PATH"

echo "── axiomcode $lang on $(basename "$src"), no souffle"
PATH="$SANDBOX_PATH" "$bin" "$src" "$W/out" --language "$lang" > "$W/run.log" 2>&1
rc=$?
sed 's/^/   /' "$W/run.log" | tail -15
[ "$rc" -eq 0 ] || fail "axiomcode exited $rc"
grep -q "using packaged engine" "$W/run.log" || fail "the run did not use the installed engine package"

db="$(find "$W/out" -name graph.sqlite | head -1)"
[ -n "$db" ] || fail "no graph.sqlite was written"
edges="$(node -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.argv[1], { readOnly: true });
  console.log(db.prepare("SELECT COUNT(*) AS n FROM call_edges").get().n);
' "$db" 2>/dev/null)"
[ -n "$edges" ] && [ "$edges" -gt 0 ] || fail "the graph has no call edges (${edges:-unreadable})"

echo "── axiomcode index, impact and path on a copy of $(basename "$src"), no souffle"
cp -R "$src" "$W/repo"
PATH="$SANDBOX_PATH" "$bin" index "$W/repo" > "$W/index.log" 2>&1 || { tail -15 "$W/index.log"; fail "axiomcode index exited non-zero"; }
ready="$(grep 'datalog rules ready' "$W/index.log" || true)"; echo "   $ready"
# every program from the engine package: not compiled here (no souffle), not left to the interpreter
echo "$ready" | grep -Eq 'ready: ([0-9]+)/\1 compiled' && ! echo "$ready" | grep -Eq '=(cached|interpreter)' \
  || fail "the query programs did not all come from the engine package: $ready"
# one resolved call in the graph: its caller and its callee, by simple name
pair="$(node -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.argv[1], { readOnly: true });
  const r = db.prepare(`SELECT c.name AS a, m.name AS b FROM call_edges e JOIN methods m ON m.id = e.callee_method_id
    JOIN methods c ON c.id = e.caller_id WHERE e.tier = ? AND m.name NOT LIKE ? AND c.name NOT LIKE ? AND c.name <> m.name
    ORDER BY c.name, m.name LIMIT 1`).get("known_edge", "%<%", "%<%");
  if (r) console.log(r.a + " " + r.b);
' "$W/repo/.axiomcode/out/graph.sqlite" 2>/dev/null)"
[ -n "$pair" ] || fail "the indexed graph has no resolved call to ask about"
caller="${pair% *}"; callee="${pair#* }"
( cd "$W/repo" && PATH="$SANDBOX_PATH" "$bin" impact "$callee" ) > "$W/impact.log" 2>&1; rc=$?
sed 's/^/   /' "$W/impact.log" | head -8
[ "$rc" -eq 0 ] || fail "axiomcode impact $callee exited $rc"
# path answers from SQL by default; AXIOMCODE_DATALOG=1 runs the shipped path programs instead
for every in "" --every; do
  ( cd "$W/repo" && PATH="$SANDBOX_PATH" AXIOMCODE_DATALOG=1 "$bin" path "$caller" "$callee" $every ) > "$W/path.log" 2>&1; rc=$?
  sed 's/^/   /' "$W/path.log" | head -4
  [ "$rc" -eq 0 ] || fail "axiomcode path $caller $callee $every exited $rc"
  grep -q 'reached' "$W/path.log" || fail "axiomcode path $caller $callee $every found no route over a resolved call"
done
echo "e2e: ok — installed from the tarballs, used the packaged $platform engine, $edges call edges; impact and path answered from the packaged query programs"
