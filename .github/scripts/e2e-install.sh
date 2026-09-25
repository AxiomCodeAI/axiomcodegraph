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
# installed package found its engine package, used it, and wrote a graph with edges.
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
echo "e2e: ok — installed from the tarballs, used the packaged $platform engine, $edges call edges"
