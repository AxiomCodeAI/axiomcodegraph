#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A TARGET-TYPED `new()` OF AN UNSTAGED TYPE IS AN EXTERNAL CONSTRUCTOR (#1290).
#
# cases/16-target-typed-new-external scores the same file against Roslyn, and that
# score cannot see this defect: an unlabelled external site is not a failure there, so
# the case passes with every creation ambiguous_unknown. What changed is the tier and
# the label, so this asserts both, per creation, exactly.
#
# THE CONTROLS ARE ROWS IN THE SAME TABLE: the two creations whose target type is in
# source still resolve to Item's constructor at known_edge.
#
# Exit 0 if every assertion holds, 1 otherwise, 0 with SKIP if the toolchain is
# absent -- matching overload-by-argument-test.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(d="$HERE"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
[ -f "$ROOT/parser/dist/index.js" ] || { echo "target-typed-new-external-test: SKIP (parser not built)"; exit 0; }
command -v souffle  >/dev/null || { echo "target-typed-new-external-test: SKIP (no souffle)";  exit 0; }
command -v sqlite3  >/dev/null || { echo "target-typed-new-external-test: SKIP (no sqlite3)";  exit 0; }

W="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src"
cp "$HERE/../cases/16-target-typed-new-external/src/TargetTypedNewExternal.cs" "$W/src/"

"$ROOT/bin/axiomcode" all "$W/src" "$W/out" --language csharp --version pinned-v1 > "$W/log" 2>&1 \
  || { echo "  ✗ the run failed:"; tail -8 "$W/log"; exit 1; }
DB="$W/out/csharp/graph.sqlite"
[ -f "$DB" ] || { echo "  ✗ no graph.sqlite at $DB"; exit 1; }

# One row per object creation: line, tier, and the target (a label or a method).
got="$(sqlite3 -separator ' ' "$DB" "
  SELECT s.start_line, e.tier, coalesce(e.callee_label, t.qualified_name, '-')
  FROM call_edges e JOIN call_sites s ON s.id = e.call_site_id
  LEFT JOIN methods t ON t.id = e.callee_method_id
  WHERE e.kind = 'new'
  ORDER BY s.start_line, 3" | sed 's/Cases\.TargetTypedNewExternal\.//g')"

want="12 boundary_lib external:List.<constructor>
13 boundary_lib external:Dictionary.<constructor>
16 boundary_lib external:List.<constructor>
17 boundary_lib external:StringBuilder.<constructor>
18 boundary_lib external:List.<constructor>
19 boundary_lib external:List.<constructor>
20 boundary_lib external:string.<constructor>
23 known_edge Item.<constructor>
24 known_edge Item.<constructor>"

if [ "$got" = "$want" ]; then
  echo "target-typed-new-external-test: ok (7 external creations labelled, 2 in-source controls resolved)"
else
  echo "  ✗ target-typed new() rows differ"
  diff <(printf '%s\n' "$want") <(printf '%s\n' "$got") | sed 's/^/      /'
  exit 1
fi
