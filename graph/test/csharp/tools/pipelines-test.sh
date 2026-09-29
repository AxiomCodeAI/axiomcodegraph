#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# PIPELINE REGISTRATION (framework-behavior/pipelines.dl): a component registered into a
# framework pipeline, by type argument or by instance, and the hooks the framework runs.
#
# graph/test/csharp/pipelines/src is written as a real project is: the framework types
# (IEndpointFilter, Interceptor, SaveChangesInterceptor, DbContext, BackgroundService) are
# NOT in the source, so it cannot live under cases/, whose oracle compiles every case.
# Three kinds of rows are rendered by qualified name and diffed against expected.hops:
#   registered   a registration site -> each hook of the type it registers
#                (AddEndpointFilter<T>(), AddEndpointFilter(new T()), Interceptors.Add<T>(),
#                AddInterceptor<T>(), AddInterceptors(new T(), sp.GetRequiredService<T>()),
#                AddHostedService<T>())
#   save         an EF save -> the save hooks of every interceptor AddInterceptors adds,
#                synchronous hooks for SaveChanges, Async ones for SaveChangesAsync, on a
#                context and through an interface the context implements
#   wraps        an endpoint or rpc -> the filter or server interceptor that wraps it
# The controls are pinned by being absent: an unregistered filter, a sibling group with no
# filter, an interceptor added to a plain list, a gRPC host that registers none, a
# service's non-rpc helper, and SaveChangesAsync on a type that is not a context.
#
#   pipelines-test.sh [--bless]
# ─────────────────────────────────────────────────────────────────────────────
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(d="$HERE"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
[ -f "$ROOT/parser/dist/index.js" ] || { echo "pipelines-test: SKIP (parser not built)"; exit 0; }
command -v souffle >/dev/null || { echo "pipelines-test: SKIP (no souffle)"; exit 0; }
CASE="$ROOT/graph/test/csharp/pipelines"
W="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$W"' EXIT
export AXIOM_CS_DEV_CACHE="${AXIOM_CS_DEV_CACHE:-$W/.cs-dev-cache}"
node "$ROOT/parser/dist/index.js" "$CASE/src" pipelines false "$W/ir" --per-language > "$W/parse.log" 2>&1 \
  || { echo "  ✗ parser failed"; tail -3 "$W/parse.log"; exit 1; }
bash "$ROOT/graph/csharp/souffle/devrun.sh" "$W/ir" "$W/engine" > "$W/engine.log" 2>&1 \
  || { echo "  ✗ engine failed"; grep -m3 '^Error' "$W/engine.log"; exit 1; }
python3 - "$W/ir/csharp" "$W/engine/out" > "$W/actual.hops" <<'PY'
import csv, os, sys
ir, out = sys.argv[1:3]
lbl = {r['csMethodUniqueHash']: r['qualifiedName'] for r in csv.DictReader(open(os.path.join(ir, 'all-csharp-methods.csv'), newline='', encoding='utf-8'), delimiter='\t')}
def rows(f):
    p = os.path.join(out, f)
    return [r for r in csv.reader(open(p, newline='', encoding='utf-8'), delimiter='\t') if r] if os.path.exists(p) else []
name = {'callback_registered': 'registered', 'event_dispatch': 'save'}
lines = {f"{name[r[5]]}\t{lbl.get(r[1], r[1])}\t{lbl.get(r[3], r[3])}" for r in rows('call-chain-edges.csv') if r[5] in name}
lines |= {f"wraps\t{lbl.get(r[0], r[0])}\t{lbl.get(r[1], r[1])}\t{r[3]}" for r in rows('framework-edge.csv')}
print('\n'.join(sorted(lines)))
PY
if [ "${1:-}" = "--bless" ]; then cp "$W/actual.hops" "$CASE/expected.hops"; echo "pipelines-test: blessed ($(grep -c . "$CASE/expected.hops") rows)"; exit 0; fi
[ -f "$CASE/expected.hops" ] || { echo "  ✗ no expected.hops (run with --bless)"; exit 1; }
for k in registered save wraps; do
  grep -q "^$k	" "$CASE/expected.hops" || { echo "  ✗ the golden has no '$k' row"; exit 1; }
done
if diff -q "$CASE/expected.hops" "$W/actual.hops" >/dev/null; then
  echo "pipelines-test: ok ($(grep -c . "$CASE/expected.hops") rows)"
else
  echo "  ✗ pipeline hops changed"; diff -u "$CASE/expected.hops" "$W/actual.hops" | sed 's/^/      /' | head -60; exit 1
fi
