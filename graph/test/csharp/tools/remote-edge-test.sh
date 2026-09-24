#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# CROSS-PROCESS EDGES: gRPC, HTTP and messaging (remote_edge).
#
# Each directory under graph/test/csharp/remote/ is a small multi-service tree whose two
# ends meet only through a name: a gRPC service, an HTTP route, a topic or a queue. The
# engine's remote_edge, remote_unserved and remote_unsent are rendered with both ends
# named (tools/normalize_remote.py) and diffed against <case>/expected.remote.
#
# WHY NOT cases/: those are compiled by the Roslyn oracle, and these fixtures reference
# framework types (Grpc.Core, Microsoft.AspNetCore, Confluent.Kafka) that are not staged
# here. That is the real shape -- a project never has them in its source tree -- and
# stubbing them into the fixture would make them in-source and test a different program.
# No compiler adjudicates a cross-process hop anyway; the golden is the contract.
#
#   remote-edge-test.sh [--bless] [case]
# Exit 0 if every golden matches, 1 otherwise, 0 with SKIP if the toolchain is absent.
# ─────────────────────────────────────────────────────────────────────────────
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(d="$HERE"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
[ -f "$ROOT/parser/dist/index.js" ] || { echo "remote-edge-test: SKIP (parser not built)"; exit 0; }
command -v souffle >/dev/null || { echo "remote-edge-test: SKIP (no souffle)"; exit 0; }
BLESS=0; ONLY=""
for a in "$@"; do case "$a" in --bless) BLESS=1;; *) ONLY="$a";; esac; done

W="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$W"' EXIT
pass=0; fail=0; n=0
for dir in "$ROOT"/graph/test/csharp/remote/*/; do
  name="$(basename "$dir")"
  [ -d "$dir/src" ] || continue
  [ -n "$ONLY" ] && [ "$ONLY" != "$name" ] && continue
  n=$((n+1)); w="$W/$name"; mkdir -p "$w"
  if ! node "$ROOT/parser/dist/index.js" "$dir/src" "remote-$name" false "$w/ir" --per-language > "$w/parse.log" 2>&1; then
    echo "  ✗ $name: parser failed"; tail -3 "$w/parse.log"; fail=$((fail+1)); continue; fi
  if ! bash "$ROOT/graph/csharp/souffle/devrun.sh" "$w/ir" "$w/engine" > "$w/engine.log" 2>&1; then
    echo "  ✗ $name: engine failed"; grep -m3 '^Error' "$w/engine.log"; fail=$((fail+1)); continue; fi
  python3 "$HERE/normalize_remote.py" "$w/ir" "$w/engine/out" > "$w/actual.remote"
  exp="$dir/expected.remote"
  if [ "$BLESS" = 1 ]; then cp "$w/actual.remote" "$exp"; echo "  blessed $name ($(grep -c . "$exp") rows)"; pass=$((pass+1)); continue; fi
  if [ ! -f "$exp" ]; then echo "  ✗ $name: no expected.remote (run with --bless)"; fail=$((fail+1)); continue; fi
  if diff -q "$exp" "$w/actual.remote" >/dev/null; then
    echo "  ✓ $name ($(grep -c '^edge' "$exp") edges, $(grep -c '^unserved' "$exp") unserved, $(grep -c '^unsent' "$exp") unsent)"; pass=$((pass+1))
  else
    echo "  ✗ $name: remote edges changed"; diff -u "$exp" "$w/actual.remote" | sed 's/^/      /' | head -40; fail=$((fail+1))
  fi
done
[ "$n" -ge 1 ] || { echo "remote-edge-test: no case ran"; exit 1; }
echo "remote-edge-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
