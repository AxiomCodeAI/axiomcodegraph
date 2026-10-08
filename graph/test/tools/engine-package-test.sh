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
# This test counts compiles and asserts cache-entry names, and the parallel flavor is a per-machine
# question answered by probing c++ — under the stub c++ the probe and a later real-c++ run can answer
# differently, so prepare and the run after it would disagree on the -par cache name. The flavor is
# pinned serial: what is under test is packaging and caching, not the solve.
export AXIOM_SOLVE_PARALLEL=0
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

# 4-7. `--prepare` (what `axiomcode prepare` runs at build time) puts the binary where a run looks for it, so the first
# index reuses it instead of compiling. A stub souffle and c++ stand in for the real ones: c++ "compiles" the fake
# engine above and counts its calls. Control: a background prepare under CI compiles nothing.
fake="$W/fake-engine"
{ echo '#!/usr/bin/env bash'
  echo 'while [ $# -gt 0 ]; do case "$1" in -D) D="$2"; shift 2;; -F) shift 2;; *) shift;; esac; done'
  cut -f2 "$ROOT/graph/$lang/souffle/export_manifest.tsv" | sed 's|^|: > "$D/|; s|$|"|'; } > "$fake"
mkdir -p "$W/stub" "$W/inc/souffle/utility" "$W/inc/souffle/datastructure"; : > "$W/inc/souffle/CompiledSouffle.h"; : > "$W/cc-calls"
# the stub include dir must carry what souffle_overlay patches (the seqlock fix seds these
# write-entry RMWs, the publication fix anchors on BTree.h's two link stores, and the overlay
# refuses an include dir without either), as a real install's headers do
printf '%s\n' 'version.fetch_or(0x1, std::memory_order_acquire);' \
              'version.fetch_or(0x1, std::memory_order_acquire);' \
              'version.fetch_or(0x1, std::memory_order_acquire);' > "$W/inc/souffle/utility/ParallelUtil.h"
cat > "$W/inc/souffle/datastructure/BTree.h" <<'BTREE_STUB'
            // move child pointers
            if (this->inner) {
                // move pointers to sibling
                auto* other = static_cast<inner_node*>(sibling);
                for (unsigned i = split_point + 1, j = 0; i <= maxKeys; ++i, ++j) {
                    other->children[j] = getChildren()[i];
                    other->children[j]->parent = other;
                    other->children[j]->position = static_cast<field_index_type>(j);
                }
            }

            // update number of elements
            this->numElements = split_point;
            sibling->numElements = maxKeys - split_point - 1;
                // link this and the sibling node to new root
                this->parent = new_root;
                // switch root node
                *root = new_root;
            keys[pos] = key;
            getChildren()[pos + 1] = newNode;
            newNode->parent = this;
            newNode->position = static_cast<field_index_type>(pos) + 1;
BTREE_STUB
mkdir -p "$W/inc/souffle/utility"
printf '%s\n' '#if _WIN64' '#define __builtin_popcountll __popcnt64' '#else' '#define __builtin_popcountll __popcnt' '#endif' >> "$W/inc/souffle/utility/MiscUtil.h"
printf '%s\n' '#ifdef _WIN32' '#include <intrin.h>' > "$W/inc/souffle/datastructure/PiggyList.h"
{ echo '#!/usr/bin/env bash'
  echo "[ \"\$1\" = --version ] && { echo 'Version: $SOUFFLE_VERSION'; exit 0; }"
  echo 'while [ $# -gt 0 ]; do case "$1" in -g) : > "$2"; echo "// c++" > "$2"; shift 2;; *) shift;; esac; done'; } > "$W/stub/souffle"
{ echo '#!/usr/bin/env bash'
  echo "echo x >> '$W/cc-calls'"
  echo 'while [ $# -gt 0 ]; do case "$1" in -o) o="$2"; shift 2;; *) shift;; esac; done'
  echo "cp '$fake' \"\$o\"; chmod +x \"\$o\""; } > "$W/stub/c++"
chmod +x "$W/stub/souffle" "$W/stub/c++"
prep(){ PATH="$W/stub:$SANDBOX_PATH" AXIOM_SOUFFLE_INCLUDE="$W/inc" AXIOM_SOUFFLE_CACHE="$W/cache" bash "$RUN" --language $lang --prepare > "$W/log" 2>&1; }
calls(){ wc -l < "$W/cc-calls" | tr -d ' '; }
if prep; then
  [ -x "$W/cache/souffle-engine-$lang-$id" ] || bad "prepare left no binary under the run's cache name (souffle-engine-$lang-${id:0:12}…)"
  [ "$(calls)" = 1 ] || bad "prepare compiled $(calls) time(s), expected 1"
  grep -q "engine ready" "$W/log" || bad "prepare did not report the engine ready"
  h="$W/cache/include-seqlock-fix-3/souffle/utility/ParallelUtil.h"
  grep -q 'memory_order_seq_cst' "$h" 2>/dev/null && ! grep -q 'fetch_or(0x1, std::memory_order_acquire)' "$h" \
    || bad "prepare did not leave the patched overlay header (seqlock fix) in the cache"
  b="$W/cache/include-seqlock-fix-3/souffle/datastructure/BTree.h"
  [ "$(grep -c 'seqlock-fix-3' "$b" 2>/dev/null)" = "4" ] \
    || bad "prepare did not leave the four publication fences (seqlock-fix-3) in the overlay BTree.h"
else bad "prepare failed:"; tail -8 "$W/log" | sed 's/^/      /'; fi
prep || bad "a second prepare failed"
grep -q "reusing cached binary" "$W/log" && [ "$(calls)" = 1 ] || bad "a second prepare compiled again ($(calls) compiles)"
# the run that follows: no souffle, no package, only the prepared binary — and it is used, not recompiled
rm -rf "$W/out"
if run; then grep -q "reusing cached binary" "$W/log" || bad "the run after prepare did not reuse the prepared binary"
else bad "the run after prepare failed:"; tail -8 "$W/log" | sed 's/^/      /'; fi
# control: the build's background prepare is skipped under CI, so nothing is compiled
rm -rf "$W/cache"
out="$(PATH="$W/stub:$SANDBOX_PATH" CI=1 AXIOM_SOUFFLE_CACHE="$W/cache" bash "$ROOT/bin/axiomcode" prepare --language $lang --background 2>&1)"
sleep 1
case "$out" in *"not prepared"*) ;; *) bad "background prepare under CI did not say it was skipped: $out";; esac
[ "$(calls)" = 1 ] && [ ! -e "$W/cache/souffle-engine-$lang-$id" ] || bad "background prepare under CI compiled anyway"

if [ "$fail" -eq 0 ]; then echo "engine-package: ok (packaged engine by id, stale package refused, absence explained, prepared binary reused)"; else echo "engine-package: $fail failure(s)"; exit 1; fi
