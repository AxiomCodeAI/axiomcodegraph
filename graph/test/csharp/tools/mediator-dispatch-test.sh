#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# IN-PROCESS MEDIATOR DISPATCH (#1383): Send(request) -> the handler for its type, and
# Publish(notification) -> every handler for its type and its bases.
#
# cases/18-mediator-send is scored against Roslyn by run-tests.sh like every case, and
# that score cannot see this edge: it is not the site's own target, and the oracle binds
# Send to the mediator interface. So the edges are rendered by qualified name and diffed
# against cases/18-mediator-send/expected.dispatch, in two shapes:
#   in-source   the case as written, with the stand-in contracts in Mediator.cs
#   unstaged    the same case with Mediator.cs removed, which is what a real project has:
#               the package is not in the source tree
# Both shapes also get cases/18-mediator-send/dispatch-only/, a send written partly
# qualified (`new Legacy.GetOrder(id)`) that the engine does not resolve as a type, which
# the Roslyn score would count against the case as a site resolved to nothing.
# Both shapes must give the same edges. The controls (a handler nothing sends, a generic
# request closed over another type, a Send on a receiver that is not a mediator, a
# notification Sent rather than Published or declared as the marker interface) are pinned
# by being absent from the golden.
#
#   mediator-dispatch-test.sh [--bless]
# ─────────────────────────────────────────────────────────────────────────────
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(d="$HERE"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
[ -f "$ROOT/parser/dist/index.js" ] || { echo "mediator-dispatch-test: SKIP (parser not built)"; exit 0; }
command -v souffle >/dev/null || { echo "mediator-dispatch-test: SKIP (no souffle)"; exit 0; }
CASE="$ROOT/graph/test/csharp/cases/18-mediator-send"
W="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/in-source" "$W/unstaged"
cp "$CASE/src/"*.cs "$CASE/dispatch-only/"*.cs "$W/in-source/"
cp "$W/in-source/"*.cs "$W/unstaged/"; rm "$W/unstaged/Mediator.cs"
: > "$W/actual.dispatch"
for shape in in-source unstaged; do
  src="$W/$shape"
  node "$ROOT/parser/dist/index.js" "$src" "mediator-$shape" false "$W/out-$shape/ir" --per-language > "$W/$shape.parse.log" 2>&1 \
    || { echo "  ✗ $shape: parser failed"; tail -3 "$W/$shape.parse.log"; exit 1; }
  bash "$ROOT/graph/csharp/souffle/devrun.sh" "$W/out-$shape/ir" "$W/out-$shape/engine" > "$W/$shape.engine.log" 2>&1 \
    || { echo "  ✗ $shape: engine failed"; grep -m3 '^Error' "$W/$shape.engine.log"; exit 1; }
  python3 - "$W/out-$shape/ir/csharp" "$W/out-$shape/engine/out" "$shape" >> "$W/actual.dispatch" <<'PY'
import csv, os, sys
ir, out, shape = sys.argv[1:4]
# the signature too: one class may handle two requests, with one Handle for each
lbl = {r['csMethodUniqueHash']: r['qualifiedName'] + '(' + r['signature'] + ')' for r in csv.DictReader(open(os.path.join(ir, 'all-csharp-methods.csv'), newline='', encoding='utf-8'), delimiter='\t')}
rows = [r for r in csv.reader(open(os.path.join(out, 'call-chain-edges.csv'), newline='', encoding='utf-8'), delimiter='\t') if r]
print('\n'.join(sorted({f"{shape}\t{lbl.get(r[1], r[1])}\t{lbl.get(r[3], r[3])}" for r in rows if r[5] == 'event_dispatch'})))
PY
done
if [ "${1:-}" = "--bless" ]; then cp "$W/actual.dispatch" "$CASE/expected.dispatch"; echo "mediator-dispatch-test: blessed ($(grep -c . "$CASE/expected.dispatch") rows)"; exit 0; fi
[ -f "$CASE/expected.dispatch" ] || { echo "  ✗ no expected.dispatch (run with --bless)"; exit 1; }
a=$(grep -c '^in-source' "$CASE/expected.dispatch"); b=$(grep -c '^unstaged' "$CASE/expected.dispatch")
[ "$a" -ge 1 ] && [ "$b" -ge 1 ] || { echo "  ✗ the golden has no edge in one of the shapes ($a in-source, $b unstaged)"; exit 1; }
[ "$(grep '^in-source' "$CASE/expected.dispatch" | cut -f2-)" = "$(grep '^unstaged' "$CASE/expected.dispatch" | cut -f2-)" ] \
  || { echo "  ✗ the golden's two shapes disagree"; exit 1; }
if diff -q "$CASE/expected.dispatch" "$W/actual.dispatch" >/dev/null; then
  echo "mediator-dispatch-test: ok ($a edges in each shape)"
else
  echo "  ✗ mediator dispatch edges changed"; diff -u "$CASE/expected.dispatch" "$W/actual.dispatch" | sed 's/^/      /' | head -40; exit 1
fi
