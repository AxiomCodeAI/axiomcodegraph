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
#   entry-points-test.sh [--bless]
# ─────────────────────────────────────────────────────────────────────────────
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(d="$HERE"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
[ -f "$ROOT/parser/dist/index.js" ] || { echo "entry-points-test: SKIP (parser not built)"; exit 0; }
command -v souffle >/dev/null || { echo "entry-points-test: SKIP (no souffle)"; exit 0; }
CASE="$ROOT/graph/test/csharp/entry-points"
W="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$W"' EXIT
node "$ROOT/parser/dist/index.js" "$CASE/src" entry false "$W/ir" --per-language > "$W/parse.log" 2>&1 \
  || { echo "  ✗ parser failed"; tail -3 "$W/parse.log"; exit 1; }
bash "$ROOT/graph/csharp/souffle/devrun.sh" "$W/ir" "$W/engine" > "$W/engine.log" 2>&1 \
  || { echo "  ✗ engine failed"; grep -m3 '^Error' "$W/engine.log"; exit 1; }
python3 - "$W/ir/csharp" "$W/engine/out" > "$W/actual.entry" <<'PY'
import csv, os, sys
ir, out = sys.argv[1], sys.argv[2]
lbl = {r['csMethodUniqueHash']: r['qualifiedName'] for r in csv.DictReader(open(os.path.join(ir, 'all-csharp-methods.csv'), newline='', encoding='utf-8'), delimiter='\t')}
def rows(f):
    p = os.path.join(out, f)
    return [r for r in csv.reader(open(p, newline='', encoding='utf-8'), delimiter='\t') if r] if os.path.exists(p) else []
lines = [f"entry\t{r[1]}\t{lbl.get(r[0], r[0])}" for r in rows('entry-point.csv')]
lines += [f"reachable\t{lbl.get(r[0], r[0])}" for r in rows('entry-reachable.csv')]
print('\n'.join(sorted(set(lines))))
PY
if [ "${1:-}" = "--bless" ]; then cp "$W/actual.entry" "$CASE/expected.entry"; echo "entry-points-test: blessed ($(grep -c . "$CASE/expected.entry") rows)"; exit 0; fi
[ -f "$CASE/expected.entry" ] || { echo "  ✗ no expected.entry (run with --bless)"; exit 1; }
n=$(grep -c '^entry' "$CASE/expected.entry")
[ "$n" -ge 1 ] || { echo "  ✗ the golden has no entry point"; exit 1; }
if diff -q "$CASE/expected.entry" "$W/actual.entry" >/dev/null; then
  echo "entry-points-test: ok ($n entry points, $(grep -c '^reachable' "$CASE/expected.entry") reachable)"
else
  echo "  ✗ entry points changed"; diff -u "$CASE/expected.entry" "$W/actual.entry" | sed 's/^/      /' | head -40; exit 1
fi
