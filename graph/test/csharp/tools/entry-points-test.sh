#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINTS (#1299): the methods the runtime calls, and what they reach.
#
# graph/test/csharp/entry-points/src holds one of each reason (main, http, test in three
# frameworks and with the Attribute suffix, lifecycle) and a control beside each: an
# instance Main, a controller method with no route, a test class's plain method, a hosted
# service's own method. entry_point and entry_reachable are rendered by qualified name
# and diffed against expected.entry. The http, grpc_service and queue reasons are also
# exercised by the remote/ fixtures, whose handlers they reuse.
#
# entry-points/framework-bases (#1560) holds a method of each cs_framework_callback family
# (hosted services direct and through the project's own base, IHostedLifecycleService,
# options setup classes, view components, SignalR hubs, authorization handlers, model
# binders, a gRPC interceptor, FluentValidation validators, EF Core hooks, Razor Pages
# handlers, MediatR handlers, disposal) beside controls:
# the same method names on unrelated classes, a hub's private and static methods, and the
# project's own `Hub` and `Migration`. It uses the real framework names, so it cannot live
# under cases/, whose oracle compiles against the BCL only.
#
#   entry-points-test.sh [--bless]
# ─────────────────────────────────────────────────────────────────────────────
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(d="$HERE"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
[ -f "$ROOT/parser/dist/index.js" ] || { echo "entry-points-test: SKIP (parser not built)"; exit 0; }
command -v souffle >/dev/null || { echo "entry-points-test: SKIP (no souffle)"; exit 0; }
BASE="$ROOT/graph/test/csharp/entry-points"
W="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$W"' EXIT
export AXIOM_CS_DEV_CACHE="${AXIOM_CS_DEV_CACHE:-$W/.cs-dev-cache}"   # one compile for every case
rc=0
for CASE in "$BASE" "$BASE"/*/; do
CASE="${CASE%/}"; [ -d "$CASE/src" ] || continue
name="$(basename "$CASE")"; C="$W/$name"; mkdir -p "$C"
node "$ROOT/parser/dist/index.js" "$CASE/src" entry false "$C/ir" --per-language > "$C/parse.log" 2>&1 \
  || { echo "  ✗ $name: parser failed"; tail -3 "$C/parse.log"; rc=1; continue; }
bash "$ROOT/graph/csharp/souffle/devrun.sh" "$C/ir" "$C/engine" > "$C/engine.log" 2>&1 \
  || { echo "  ✗ $name: engine failed"; grep -m3 '^Error' "$C/engine.log"; rc=1; continue; }
python3 - "$C/ir/csharp" "$C/engine/out" > "$C/actual.entry" <<'PY2'
import csv, os, sys
ir, out = sys.argv[1], sys.argv[2]
lbl = {r['csMethodUniqueHash']: r['qualifiedName'] for r in csv.DictReader(open(os.path.join(ir, 'all-csharp-methods.csv'), newline='', encoding='utf-8'), delimiter='\t')}
def rows(f):
    p = os.path.join(out, f)
    return [r for r in csv.reader(open(p, newline='', encoding='utf-8'), delimiter='\t') if r] if os.path.exists(p) else []
lines = [f"entry\t{r[1]}\t{lbl.get(r[0], r[0])}" for r in rows('entry-point.csv')]
lines += [f"reachable\t{lbl.get(r[0], r[0])}" for r in rows('entry-reachable.csv')]
print('\n'.join(sorted(set(lines))))
PY2
if [ "${1:-}" = "--bless" ]; then cp "$C/actual.entry" "$CASE/expected.entry"; echo "entry-points-test: $name blessed ($(grep -c . "$CASE/expected.entry") rows)"; continue; fi
[ -f "$CASE/expected.entry" ] || { echo "  ✗ $name: no expected.entry (run with --bless)"; rc=1; continue; }
n=$(grep -c '^entry' "$CASE/expected.entry")
[ "$n" -ge 1 ] || { echo "  ✗ $name: the golden has no entry point"; rc=1; continue; }
if diff -q "$CASE/expected.entry" "$C/actual.entry" >/dev/null; then
  echo "entry-points-test: $name ok ($n entry points, $(grep -c '^reachable' "$CASE/expected.entry") reachable)"
else
  echo "  ✗ $name: entry points changed"; diff -u "$CASE/expected.entry" "$C/actual.entry" | sed 's/^/      /' | head -40; rc=1
fi
done
exit $rc
