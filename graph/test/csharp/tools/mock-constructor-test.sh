#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A CLASS MOCK RUNS ITS TYPE'S CONSTRUCTOR (#1495): `new Mock<C>(args)` (Moq) and
# `Substitute.ForPartsOf<C>(args)` / `Substitute.For<C>(args)` (NSubstitute) reach the
# constructor of C that the arguments select, a leading `MockBehavior.X` not counted.
#
# The Roslyn score cannot see this hop (the site's own target is the library's, and the
# packages are not in the source), so the event_dispatch edges are rendered by qualified
# name and diffed against mock-constructor/expected.dispatch. The controls (an interface
# mock, a mock built from a lambda, a type with only an implicit constructor, a List<C>,
# a ForPartsOf on another receiver) are pinned by being absent from the golden.
#
#   mock-constructor-test.sh [--bless]
# ─────────────────────────────────────────────────────────────────────────────
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(d="$HERE"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
[ -f "$ROOT/parser/dist/index.js" ] || { echo "mock-constructor-test: SKIP (parser not built)"; exit 0; }
command -v souffle >/dev/null || { echo "mock-constructor-test: SKIP (no souffle)"; exit 0; }
CASE="$ROOT/graph/test/csharp/mock-constructor"
W="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$W"' EXIT
node "$ROOT/parser/dist/index.js" "$CASE/src" mock-ctor false "$W/ir" --per-language > "$W/parse.log" 2>&1 \
  || { echo "  ✗ parser failed"; tail -3 "$W/parse.log"; exit 1; }
bash "$ROOT/graph/csharp/souffle/devrun.sh" "$W/ir" "$W/engine" > "$W/engine.log" 2>&1 \
  || { echo "  ✗ engine failed"; grep -m3 '^Error' "$W/engine.log"; exit 1; }
python3 - "$W/ir/csharp" "$W/engine/out" > "$W/actual.dispatch" <<'PY'
import csv, os, sys
ir, out = sys.argv[1:3]
lbl = {r['csMethodUniqueHash']: r['qualifiedName'] + '(' + r['signature'] + ')' for r in csv.DictReader(open(os.path.join(ir, 'all-csharp-methods.csv'), newline='', encoding='utf-8'), delimiter='\t')}
rows = [r for r in csv.reader(open(os.path.join(out, 'call-chain-edges.csv'), newline='', encoding='utf-8'), delimiter='\t') if r]
print('\n'.join(sorted({f"{lbl.get(r[1], r[1])}\t{lbl.get(r[3], r[3])}" for r in rows if r[5] == 'event_dispatch'})))
PY
if [ "${1:-}" = "--bless" ]; then cp "$W/actual.dispatch" "$CASE/expected.dispatch"; echo "mock-constructor-test: blessed ($(grep -c . "$CASE/expected.dispatch") rows)"; exit 0; fi
[ -f "$CASE/expected.dispatch" ] || { echo "  ✗ no expected.dispatch (run with --bless)"; exit 1; }
n=$(grep -c . "$CASE/expected.dispatch")
[ "$n" -ge 1 ] || { echo "  ✗ the golden holds no edge"; exit 1; }
if diff -q "$CASE/expected.dispatch" "$W/actual.dispatch" >/dev/null; then
  echo "mock-constructor-test: ok ($n edges)"
else
  echo "  ✗ mock constructor edges changed"; diff -u "$CASE/expected.dispatch" "$W/actual.dispatch" | sed 's/^/      /' | head -40; exit 1
fi
