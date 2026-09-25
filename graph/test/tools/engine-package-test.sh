#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# The no-souffle path of run-souffle.sh: with `souffle` absent it must find the engine that
# npm installed for this machine — node_modules/@axiomcode/engine-<os>-<cpu>/<lang>/ — use it
# ONLY when that package's ENGINE_ID equals the id of the rules in the checkout, run it
# through to the bundle, and otherwise refuse with the two ways out named.
#
# No network, no npm: a copy of the tree gets a hand-made engine package, and the "engine"
# in it is a shell script that writes the export manifest's files into -D (which is all the
# driver and the bundle stage need from it).
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"  # the repository root, found by its marker
fail=0; bad(){ echo "  ✗ $*"; fail=$((fail+1)); }
[ -x "$ROOT/node_modules/.bin/tsx" ] || { echo "engine-package: SKIP (no node_modules/.bin/tsx — run npm install)"; exit 0; }
W="$(mktemp -d)"; SHADOW=""; trap 'rm -rf "$W" ${SHADOW:+"$SHADOW"}' EXIT
mkdir -p "$W/bin" "$W/ir" "$W/int" "$W/out" "$W/tree"
# a copy of the tree with its own node_modules dir (the real one linked in for the bundler)
cp -R "$ROOT/graph" "$W/tree/graph"; cp "$ROOT/package.json" "$ROOT/tsconfig.json" "$W/tree/"
mkdir -p "$W/tree/node_modules"; ln -s "$ROOT/node_modules/.bin" "$W/tree/node_modules/.bin"
for d in "$ROOT"/node_modules/*/; do n="$(basename "$d")"; [ "$n" = "@axiomcode" ] && continue; ln -s "${d%/}" "$W/tree/node_modules/$n"; done
RUN="$W/tree/graph/pipeline/run-souffle.sh"
# a PATH with everything the driver and the bundler need, and no souffle
. "$(dirname "$0")/hide-souffle.sh"   # sets SANDBOX_PATH (and SHADOW, removed on exit)
for t in ; do
  p="$(command -v "$t" 2>/dev/null)" && ln -sf "$p" "$W/bin/$t"
done
. "$ROOT/graph/pipeline/engine.conf"

lang=java
id="$(PATH="$SANDBOX_PATH" bash "$RUN" --language $lang --print-engine-id)"
arch="$(uname -m | sed 's/aarch64/arm64/;s/amd64|x86_64/x64/;s/x86_64/x64/')"
case "$(uname -s)" in Darwin) platform="darwin-$arch";; Linux) platform="linux-$arch";; *) platform="win32-x64";; esac
pkg="$W/tree/node_modules/$ENGINE_PACKAGE_SCOPE/engine-$platform"; mkdir -p "$pkg/$lang"
# the fake engine: writes every manifest file, empty, into -D
{
  echo '#!/usr/bin/env bash'
  echo 'while [ $# -gt 0 ]; do case "$1" in -D) D="$2"; shift 2;; -F) shift 2;; *) shift;; esac; done'
  cut -f2 "$ROOT/graph/$lang/souffle/export_manifest.tsv" | sed 's|^|: > "$D/|; s|$|"|'
} > "$pkg/$lang/axiomcode-engine-$lang"; chmod +x "$pkg/$lang/axiomcode-engine-$lang"
printf '%s\n' "$id" > "$pkg/$lang/ENGINE_ID"

run(){ PATH="$SANDBOX_PATH" AXIOM_SOUFFLE_CACHE="$W/cache" bash "$RUN" --language $lang --client-ir "$W/ir" --library "" --intermediate "$W/int" --output "$W/out" > "$W/log" 2>&1; }

# 1. the packaged engine with a matching id is used, and the run reaches the bundle
if run; then
  grep -q "using packaged engine" "$W/log" || bad "packaged engine with a matching id was not used"
  [ -f "$W/out/graph.sqlite" ] || [ -f "$W/out/csv/call_edges.csv" ] || bad "the run did not reach the bundle stage"
else
  bad "run with a matching packaged engine failed:"; tail -8 "$W/log" | sed 's/^/      /'
fi
# 2. a package built from OTHER rules is reported and refused; no souffle → the two ways out
printf 'deadbeef%s\n' "${id:8}" > "$pkg/$lang/ENGINE_ID"; rm -rf "$W/out"
if run; then bad "a packaged engine with a different id was used"; else
  grep -q "not using it" "$W/log" || bad "a stale packaged engine was not reported"
  grep -q "npm install" "$W/log" && grep -q "install souffle" "$W/log" || bad "the refusal does not name both ways out"
fi
# 3. no package at all → the same explanation
rm -rf "$W/tree/node_modules/$ENGINE_PACKAGE_SCOPE" "$W/out"
if run; then bad "a run with no engine package and no souffle succeeded"; else
  grep -q "npm install" "$W/log" || bad "the no-package error does not point at npm install"
fi

if [ "$fail" -eq 0 ]; then echo "engine-package: ok (packaged engine by id, stale package refused, absence explained)"; else echo "engine-package: $fail failure(s)"; exit 1; fi
