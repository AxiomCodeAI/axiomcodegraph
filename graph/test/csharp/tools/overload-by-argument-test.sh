#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AN OVERLOAD IS PICKED BY ITS ARGUMENTS' TYPES (#1246).
#
# cases/12-overload-by-argument-type scores the same file against Roslyn, and that
# score cannot see this defect: a three-target set that contains the compiler's
# target reads as agreement. What changed is the target COUNT and the tier, so this
# asserts both, per call site, exactly.
#
# THE CONTROLS ARE ROWS IN THE SAME TABLE: `Pad` (arity decided it before), the
# `Unknown` sites (a call's result, `var`, a named argument: no argument type, the
# set stays whole), `Scale('c')` (char reaches int AND double; the engine does not
# rank conversions, so two stay), `Formatter.F("out")` (a PRIVATE exact match is not
# a candidate from outside its type, so it evicts nothing there), and `d.M(3)` (the
# derived overload the compiler binds must not be evicted by an exact match in the
# base).
#
# Exit 0 if every assertion holds, 1 otherwise, 0 with SKIP if the toolchain is
# absent -- matching delegate-field-value-test.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(d="$HERE"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
[ -f "$ROOT/parser/dist/index.js" ] || { echo "overload-by-argument-test: SKIP (parser not built)"; exit 0; }
command -v souffle  >/dev/null || { echo "overload-by-argument-test: SKIP (no souffle)";  exit 0; }
command -v sqlite3  >/dev/null || { echo "overload-by-argument-test: SKIP (no sqlite3)";  exit 0; }

W="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src"
cp "$HERE/../cases/12-overload-by-argument-type/src/Overloads.cs" "$W/src/"

"$ROOT/bin/axiomcode" all "$W/src" "$W/out" --language csharp --version pinned-v1 > "$W/log" 2>&1 \
  || { echo "  ✗ the run failed:"; tail -8 "$W/log"; exit 1; }
DB="$W/out/csharp/graph.sqlite"
[ -f "$DB" ] || { echo "  ✗ no graph.sqlite at $DB"; exit 1; }

# One row per call site: caller, callee name, tier, and the targets' owner and
# signature, sorted. Operator sites are left out (`+` on strings is built in).
got="$(sqlite3 -separator ' ' "$DB" "
  SELECT c.name, s.callee_name, group_concat(DISTINCT e.tier),
         (SELECT group_concat(x, ' ') FROM (
            SELECT DISTINCT t.qualified_name || '(' || t.signature || ')' AS x
            FROM call_edges e2 JOIN methods t ON t.id = e2.callee_method_id
            WHERE e2.call_site_id = s.id ORDER BY x))
  FROM call_sites s JOIN call_edges e ON e.call_site_id = s.id
  JOIN methods c ON c.id = e.caller_id
  WHERE s.callee_name NOT LIKE 'op\_%' ESCAPE '\\'
  GROUP BY s.id ORDER BY s.start_line, s.start_column" | sed 's/Cases\.Overloads\.//g')"

want="Self Scale known_edge MathUtil.Scale(int)
Self Scale known_edge MathUtil.Scale(string)
Inner F known_edge Formatter.F(string)
Literals Scale known_edge MathUtil.Scale(int)
Literals Scale known_edge MathUtil.Scale(double)
Literals Scale known_edge MathUtil.Scale(string)
Literals Scale known_edge MathUtil.Scale(double)
Literals Scale known_edge MathUtil.Scale(double)
Literals Scale known_edge MathUtil.Scale(string)
Declared Scale known_edge MathUtil.Scale(int)
Declared Scale known_edge MathUtil.Scale(string)
Declared Scale known_edge MathUtil.Scale(double)
Pruned Wide known_edge MathUtil.Wide(long)
Pruned Wide known_edge MathUtil.Wide(string)
Pruned Log known_edge MathUtil.Log(string)
Pruned Log known_edge MathUtil.Log(params object[])
Pruned Opt known_edge MathUtil.Opt(int)
Pruned G known_edge MathUtil.G(int)
Pruned G known_edge MathUtil.G(T)
Dispatched Area multi_inferred Circle.Area(int) Shape.Area(int)
Dispatched Area multi_inferred Circle.Area(string) Shape.Area(string)
ThroughInterface K multi_inferred Explicit.K(int) Implicit.K(int)
ThroughInterface K multi_inferred Explicit.K(string) Implicit.K(string)
Arity Pad known_edge MathUtil.Pad(int)
Arity Pad known_edge MathUtil.Pad(int,int)
Unknown Scale multi_inferred MathUtil.Scale(double) MathUtil.Scale(int) MathUtil.Scale(string)
Unknown Compute known_edge MathUtil.Compute()
Unknown Scale multi_inferred MathUtil.Scale(double) MathUtil.Scale(int) MathUtil.Scale(string)
Unknown Scale multi_inferred MathUtil.Scale(double) MathUtil.Scale(int) MathUtil.Scale(string)
Unknown Scale multi_inferred MathUtil.Scale(double) MathUtil.Scale(int)
Hidden M known_edge Derived.M(double)
Private F multi_inferred Formatter.F(object) Formatter.F(string)"

if [ "$got" = "$want" ]; then
  echo "overload-by-argument-test: ok ($(echo "$got" | grep -c known_edge) known_edge, $(echo "$got" | grep -c multi_inferred) multi_inferred)"
else
  echo "  ✗ the per-site targets are not the expected ones:"
  diff <(echo "$want") <(echo "$got") | sed 's/^/      /'
  echo "overload-by-argument-test: FAILED"; exit 1
fi
