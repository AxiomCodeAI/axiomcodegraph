#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# The no-souffle path of run-souffle.sh: with `souffle` absent it must fetch the prebuilt
# engine for (language, id, platform), VERIFY its sha256 against the release's
# sha256sum.txt, cache it, and run it through to the bundle — and it must refuse a binary
# whose checksum does not match, leaving nothing in the cache.
#
# No network: a fake `gh` on PATH answers `release download` from a directory this test
# fills, and the "engine" it serves is a shell script that writes the export manifest's
# files into -D (which is all the driver and the bundle stage need from it).
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUN="$ROOT/src/pipeline/run-souffle.sh"
fail=0; bad(){ echo "  ✗ $*"; fail=$((fail+1)); }
[ -x "$ROOT/node_modules/.bin/tsx" ] || { echo "engine-fetch: SKIP (no node_modules/.bin/tsx — run npm install)"; exit 0; }
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin" "$W/release" "$W/cache" "$W/ir" "$W/int" "$W/out"
# a PATH with everything the driver and the bundler need, and no souffle
for t in bash sh grep awk sed sort cut tr mktemp uname cat rm cp mv ls dirname basename shasum sha256sum stat date mkdir chmod head tail wc find ln printf tee env node git curl; do
  p="$(command -v "$t" 2>/dev/null)" && ln -sf "$p" "$W/bin/$t"
done
ln -sf "$(dirname "$(command -v node)")/npx" "$W/bin/npx" 2>/dev/null || true
. "$ROOT/src/pipeline/engine.conf"

lang=java
id="$(PATH="$W/bin" bash "$RUN" --language $lang --print-engine-id)"
case "$(uname -s)" in Darwin) platform=darwin-universal;; Linux) platform="linux-$(uname -m | sed 's/aarch64/arm64/;s/amd64/x86_64/')";; *) platform="windows-x86_64";; esac
asset="axiom-engine-$lang-$platform"

# the fake engine: writes every manifest file, empty, into -D
{
  echo '#!/usr/bin/env bash'
  echo 'while [ $# -gt 0 ]; do case "$1" in -D) D="$2"; shift 2;; -F) shift 2;; *) shift;; esac; done'
  cut -f2 "$ROOT/src/$lang/souffle/export_manifest.tsv" | sed 's|^|: > "$D/|; s|$|"|'
} > "$W/release/$asset"; chmod +x "$W/release/$asset"
( cd "$W/release" && { command -v sha256sum >/dev/null && sha256sum "$asset" || shasum -a 256 "$asset"; } > sha256sum.txt )

# the fake gh: `gh release download TAG -R REPO -p A -p B -D DIR`
cat > "$W/bin/gh" <<'GH'
#!/usr/bin/env bash
[ "$1" = release ] && [ "$2" = download ] || { echo "fake gh: unsupported: $*" >&2; exit 1; }
tag="$3"; shift 3; dest=.; pats=()
while [ $# -gt 0 ]; do case "$1" in -R) shift 2;; -p) pats+=("$2"); shift 2;; -D) dest="$2"; shift 2;; *) shift;; esac; done
[ "$tag" = "$FAKE_TAG" ] || { echo "release not found" >&2; exit 1; }
for p in "${pats[@]}"; do cp "$FAKE_RELEASE/$p" "$dest/" || exit 1; done
GH
chmod +x "$W/bin/gh"
export FAKE_TAG="engine-$lang-$id" FAKE_RELEASE="$W/release"

run(){ PATH="$W/bin" AXIOM_SOUFFLE_CACHE="$W/cache" bash "$RUN" --language $lang --client-ir "$W/ir" --library "" --intermediate "$W/int" --output "$W/out" > "$W/log" 2>&1; }

# 1. a good release is fetched, verified, cached and run through to the bundle
if run; then
  grep -q "verified sha256" "$W/log" || bad "no 'verified sha256' line in the log"
  [ -x "$W/cache/souffle-engine-$lang-$id" ] || bad "fetched binary not cached under its id"
  [ -f "$W/out/graph.sqlite" ] || [ -f "$W/out/graph/call_edges.csv" ] || bad "the run did not reach the bundle stage"
else
  bad "run with a valid release failed:"; tail -8 "$W/log" | sed 's/^/      /'
fi
# 2. cached: a second run must not download again
: > "$W/log"; run && grep -q "reusing cached binary" "$W/log" || bad "second run did not reuse the cached binary"

# 3. a tampered binary is refused and nothing is cached
rm -rf "$W/cache"/* "$W/out"
printf '\n# tampered\n' >> "$W/release/$asset"
if run; then bad "a binary with a wrong sha256 was accepted"; else
  grep -q "sha256 mismatch" "$W/log" || bad "refusal did not name the sha256 mismatch"
  [ ! -e "$W/cache/souffle-engine-$lang-$id" ] || bad "a refused binary was left in the cache"
fi
# 4. no release at all: the two ways out are named
export FAKE_TAG="engine-$lang-nothing"; rm -rf "$W/out"
if run; then bad "a run with no release and no souffle succeeded"; else
  grep -q "install souffle" "$W/log" && grep -q "merge to main" "$W/log" || bad "the no-release error does not name both ways out"
fi

if [ "$fail" -eq 0 ]; then echo "engine-fetch: ok (fetch, verify, cache, refuse tampered, explain absence)"; else echo "engine-fetch: $fail failure(s)"; exit 1; fi
