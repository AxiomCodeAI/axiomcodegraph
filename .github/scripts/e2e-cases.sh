#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# The query cases (tests/run.py), every language, answered by the INSTALLED packages.
#
#   e2e-cases.sh <engines-dir> <platform> [tests/run.py args...]
#
# e2e-install.sh proves an install answers every verb on one case per language. That is a smoke test: 0.1.10
# passed it on Windows while 43 of the cases' 1,844 checks failed there — tests not linked through a file path,
# an absolute file:line refused, any argument holding ' or " mangled on its way into Git Bash. None of it is
# platform-specific code; all of it is how Windows writes paths and command lines. So the cases run here, from
# this checkout's plugin scripts, with the engine and parser of the packages a user installs (AXIOMCODE_ENGINE),
# souffle hidden as it is for a user.
#
# CODEGRAPH_TGZ is the packed @axiomcode/code-graph, as for e2e-install.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

engines="${1:?usage: e2e-cases.sh <engines-dir> <platform> [tests/run.py args...]}"; platform="${2:?platform}"; shift 2
root="$(cd "$(dirname "$0")/../.." && pwd)"
engines="$(cd "$engines" && pwd)"
W="$(mktemp -d)"; SHADOW=""; trap 'rm -rf "$W" ${SHADOW:+"$SHADOW"}' EXIT
fail() { echo "::error::e2e cases: $*"; exit 1; }
[ -n "${CODEGRAPH_TGZ:-}" ] || fail "CODEGRAPH_TGZ is not set"

version="$(node "$root/.github/scripts/version.mjs" get)"
bash "$root/packaging/assemble-engine-package.sh" "$platform" "$version" "$engines" "$W/engine" >/dev/null \
  || fail "the engine package did not assemble"
mkdir -p "$W/tgz" "$W/proj"
( cd "$W/engine" && npm pack --silent --pack-destination "$W/tgz" >/dev/null ) || fail "npm pack of the engine package failed"
cp "$CODEGRAPH_TGZ" "$W/tgz/" || fail "no code-graph tarball at $CODEGRAPH_TGZ"
( cd "$W/proj" && npm init -y >/dev/null && npm install --no-audit --no-fund --loglevel=error "$W"/tgz/*.tgz ) \
  || fail "npm install of the packed tarballs failed"
export AXIOMCODE_ENGINE="$W/proj/node_modules/@axiomcode/code-graph"
[ -d "$AXIOMCODE_ENGINE/graph" ] || fail "the installed package has no graph/ at $AXIOMCODE_ENGINE"

. "$root/graph/test/tools/hide-souffle.sh"
py="$(command -v python3 || command -v python)" || fail "no python"
# the bash a native program starts, as the CLI hands it on: on Windows a bare `bash` is System32's WSL launcher
command -v cygpath >/dev/null 2>&1 && export AXIOMCODE_BASH="${AXIOMCODE_BASH:-$(cygpath -m "$BASH")}"
# and Python in UTF-8, as every launcher of the product sets it (the dispatcher, find-python.js): some tests start a
# verb's script directly, and an answer's → is not cp1252
export PYTHONUTF8=1
rc=0
PATH="$SANDBOX_PATH" "$py" "$root/tests/run.py" "$@" || rc=1
# what only Windows can show for real: its separators, its exec, its symlinks, its command lines
for t in mixed_separators no_symlink no_exec windows_argv; do
  PATH="$SANDBOX_PATH" "$py" "$root/tests/$t.py" > "$W/$t.log" 2>&1 && echo "$t: $(tail -1 "$W/$t.log")" \
    || { echo "::error::e2e cases: tests/$t.py failed"; tail -30 "$W/$t.log"; rc=1; }
done
exit $rc
