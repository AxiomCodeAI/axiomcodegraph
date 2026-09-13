#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# The bundle stage (src/bundle/) — the language-neutral output every suite now solves into.
#
# No parser, no soufflé: each language gets a HAND-WRITTEN raw/ dump and a minimal IR whose
# headers carry only the columns the adapter asks for by name (that is the point of resolving
# by name). Then the bundle is built and read back:
#   1. graph/<table>.csv exists for every core table, with the header the schema declares
#   2. a caller and its resolved callee join to qualified names, file and line — in every language
#   3. an unresolved site is kept, with NULL callee, and lands in unresolved_sites
#   4. the vocabulary inside the database knows the language's own values, and a value the
#      schema does not list is still recorded as undocumented rather than dropped
#   5. src/bundle/SCHEMA.md is what schema.ts renders — the two cannot drift
# Assertions read the CSVs; the sqlite3 CLI, when present, also queries the database.
# ─────────────────────────────────────────────────────────────────────────────
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TSX="$ROOT/node_modules/.bin/tsx"
[ -x "$TSX" ] || { echo "bundle-test: SKIP (no node_modules/.bin/tsx — run npm install)"; exit 0; }
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
fail=0; bad(){ echo "  ✗ $*"; fail=$((fail+1)); }
# --debug, because every assertion below reads graph/*.csv. Without it the bundler writes
# graph.sqlite alone — the CSVs are a debugging view of the same core tables, and a
# consumer that queries the database does not want a second copy of it on disk. The
# default is asserted separately at the end.
BUNDLE(){ "$TSX" "$ROOT/src/bundle/cli.ts" --src "$ROOT/src" --debug "$@"; }
BUNDLE_NO_DEBUG(){ "$TSX" "$ROOT/src/bundle/cli.ts" --src "$ROOT/src" "$@"; }
SQL(){ command -v sqlite3 >/dev/null && sqlite3 "$1" "$2"; }
HAVE_SQLITE=0; command -v sqlite3 >/dev/null && HAVE_SQLITE=1

# ── fixtures: one caller → one resolved callee, one unresolved site ──────────
mk_java(){ local d="$1"; mkdir -p "$d/ir" "$d/raw"
  printf 'name\tsignature\tqualifiedName\tfilePath\tstartLine\tendLine\ttypeRegistryLinkHash\townerQualifiedName\tmethodKind\tmethodRegistryUniqueHash\n' > "$d/ir/all-methods.csv"
  printf 'main\tmain(String[])\tapp.Main.main\tsrc/Main.java\t3\t7\tTYPE_REGISTRY_t1\tapp.Main\tSTATIC_METHOD\tMETHOD_REGISTRY_m1\n' >> "$d/ir/all-methods.csv"
  printf 'render\trender()\tapp.Widget.render\tsrc/Widget.java\t4\t9\tTYPE_REGISTRY_t2\tapp.Widget\tINSTANCE_METHOD\tMETHOD_REGISTRY_m2\n' >> "$d/ir/all-methods.csv"
  printf 'name\tqualifiedName\ttypeCategory\tfilePath\tstartLine\tendLine\ttypeRegistryUniqueHash\n' > "$d/ir/all-types.csv"
  printf 'Main\tapp.Main\tCLASS_TYPE\tsrc/Main.java\t1\t9\tTYPE_REGISTRY_t1\nWidget\tapp.Widget\tCLASS_TYPE\tsrc/Widget.java\t1\t12\tTYPE_REGISTRY_t2\n' >> "$d/ir/all-types.csv"
  printf 'kind\tliteralValue\ttypeRegistryLinkHash\tstartLine\tstartColumn\tendLine\tendColumn\texpressionUniqueHash\n' > "$d/ir/all-expressions.csv"
  printf 'METHOD_INVOCATION\trender\tTYPE_REGISTRY_t1\t5\t9\t5\t20\tEXPRESSION_REFERENCE_e1\nMETHOD_INVOCATION\tmystery\tTYPE_REGISTRY_t1\t6\t9\t6\t22\tEXPRESSION_REFERENCE_e2\n' >> "$d/ir/all-expressions.csv"
  printf 'EXPRESSION_REFERENCE_e1\tMETHOD_REGISTRY_m1\t-\tMETHOD_REGISTRY_m2\tclient\tknown_edge\tmethod\n' > "$d/raw/call-chain-edges.csv"
  printf 'EXPRESSION_REFERENCE_e2\tMETHOD_REGISTRY_m1\t-\t-\t-\tambiguous_unknown\tmethod\n' >> "$d/raw/call-chain-edges.csv"
  printf 'METHOD_REGISTRY_m1\tmain\n' > "$d/raw/entry-point.csv"
  printf 'TYPE_REGISTRY_t2\tnew\nTYPE_REGISTRY_t2\tmade_up_how\n' > "$d/raw/type-instantiated.csv"
}
mk_typescript(){ local d="$1"; mkdir -p "$d/ir" "$d/raw"
  printf 'name\tsignature\tqualifiedName\tfilePath\tstartLine\tendLine\ttsTypeLinkHash\townerQualifiedName\tmethodKind\ttsMethodUniqueHash\n' > "$d/ir/all-typescript-methods.csv"
  printf 'main\tmain()\tapp#main\tsrc/app.ts\t3\t7\t\t\tFUNCTION_DECLARATION\tTS_METHOD_m1\nrender\trender()\twidget#Widget.render\tsrc/widget.ts\t4\t9\tTS_TYPE_t2\twidget#Widget\tMETHOD_DECLARATION\tTS_METHOD_m2\n' >> "$d/ir/all-typescript-methods.csv"
  printf 'name\tqualifiedName\ttypeCategory\tfilePath\tstartLine\tendLine\ttsTypeUniqueHash\n' > "$d/ir/all-typescript-types.csv"
  printf 'Widget\twidget#Widget\tCLASS_TYPE\tsrc/widget.ts\t1\t12\tTS_TYPE_t2\n' >> "$d/ir/all-typescript-types.csv"
  printf 'tsModuleUniqueHash\tfilePath\n' > "$d/ir/all-typescript-modules.csv"
  printf 'TS_MODULE_a\tsrc/app.ts\n' >> "$d/ir/all-typescript-modules.csv"
  printf 'callKind\tcalleeName\ttsExpressionLinkHash\ttsModuleLinkHash\tstartLine\tstartColumn\n' > "$d/ir/all-typescript-call-sites.csv"
  printf 'METHOD_CALL\trender\tTS_EXPRESSION_e1\tTS_MODULE_a\t5\t9\nFUNCTION_CALL\tmystery\tTS_EXPRESSION_e2\tTS_MODULE_a\t6\t9\n' >> "$d/ir/all-typescript-call-sites.csv"
  printf 'kind\tstartLine\tstartColumn\tendLine\tendColumn\ttsModuleLinkHash\ttsExpressionUniqueHash\n' > "$d/ir/all-typescript-expressions.csv"
  printf 'CALL\t5\t9\t5\t20\tTS_MODULE_a\tTS_EXPRESSION_e1\nCALL\t6\t9\t6\t22\tTS_MODULE_a\tTS_EXPRESSION_e2\n' >> "$d/ir/all-typescript-expressions.csv"
  printf 'TS_EXPRESSION_e1\tTS_METHOD_m1\t-\tTS_METHOD_m2\tclient\tknown_edge\tMETHOD_CALL\n' > "$d/raw/call-chain-edges.csv"
  printf 'TS_EXPRESSION_e2\tTS_METHOD_m1\t-\t-\t-\tambiguous_unknown\tFUNCTION_CALL\n' >> "$d/raw/call-chain-edges.csv"
  printf 'TS_METHOD_m1\tunimported_module\n' > "$d/raw/entry-point.csv"
}
mk_python(){ local d="$1"; mkdir -p "$d/ir" "$d/raw"
  printf 'name\tsignature\tqualifiedName\tfilePath\tstartLine\tendLine\tpyTypeLinkHash\townerQualifiedName\tmethodKind\tpyMethodUniqueHash\n' > "$d/ir/all-python-methods.csv"
  printf 'main\tmain()\tapp.main\tapp.py\t3\t7\t\t\tFUNCTION\tPY_METHOD_m1\nrender\trender(self)\twidget.Widget.render\twidget.py\t4\t9\tPY_TYPE_t2\twidget.Widget\tINSTANCE_METHOD\tPY_METHOD_m2\n' >> "$d/ir/all-python-methods.csv"
  printf 'name\tqualifiedName\ttypeCategory\tfilePath\tstartLine\tendLine\tpyTypeUniqueHash\n' > "$d/ir/all-python-types.csv"
  printf 'Widget\twidget.Widget\tCLASS_TYPE\twidget.py\t1\t12\tPY_TYPE_t2\n' >> "$d/ir/all-python-types.csv"
  printf 'pyModuleUniqueHash\tfilePath\n' > "$d/ir/all-python-modules.csv"
  printf 'PY_MODULE_a\tapp.py\n' >> "$d/ir/all-python-modules.csv"
  printf 'callKind\tcalleeName\tpyExpressionLinkHash\tpyModuleLinkHash\tstartLine\tstartColumn\tendLine\n' > "$d/ir/all-python-call-sites.csv"
  printf 'METHOD_CALL\trender\tPY_EXPRESSION_e1\tPY_MODULE_a\t5\t9\t5\nSIMPLE_CALL\tmystery\tPY_EXPRESSION_e2\tPY_MODULE_a\t6\t9\t6\n' >> "$d/ir/all-python-call-sites.csv"
  printf 'kind\tstartLine\tstartColumn\tendLine\tendColumn\tpyModuleLinkHash\tpyExpressionUniqueHash\n' > "$d/ir/all-python-expressions.csv"
  printf 'CALL\t5\t9\t5\t20\tPY_MODULE_a\tPY_EXPRESSION_e1\nCALL\t6\t9\t6\t22\tPY_MODULE_a\tPY_EXPRESSION_e2\n' >> "$d/ir/all-python-expressions.csv"
  : > "$d/ir/all-python-decorators.csv"   # a zero-byte relation, as the parser writes one
  printf 'PY_EXPRESSION_e1\tPY_METHOD_m1\t-\tPY_METHOD_m2\tclient\tknown_edge\tMETHOD_CALL\n' > "$d/raw/call-chain-edges.csv"
  printf 'PY_EXPRESSION_e2\tPY_METHOD_m1\t-\t-\t-\tambiguous_unknown\tSIMPLE_CALL\n' >> "$d/raw/call-chain-edges.csv"
  printf 'PY_EXPRESSION_e3\tPY_METHOD_m1\t-\tbuiltin:print\tbuiltin\tboundary_lib\tSIMPLE_CALL\n' >> "$d/raw/call-chain-edges.csv"
  printf 'client\tPY_TYPE_t2\n' > "$d/raw/resolution-type-instantiated.csv"
}

# column N (1-based) of the row whose first column is $3, in headered TSV $1
cell(){ awk -F'\t' -v n="$2" -v k="$3" '$1==k{print $n; exit}' "$1"; }
header(){ head -1 "$1"; }

for lang in java typescript python; do
  d="$W/$lang"; "mk_$lang" "$d"
  if ! BUNDLE --language "$lang" --client-ir "$d/ir" --raw "$d/raw" --out "$d" > "$d/log" 2>&1; then
    bad "$lang: bundle failed:"; sed 's/^/      /' "$d/log" | tail -5; continue
  fi
  G="$d/graph"
  # 1. every core table, with the declared header
  for t in run methods types call_sites call_edges type_ancestors overrides entry_points entry_reachable unresolved_sites type_instantiated; do
    [ -f "$G/$t.csv" ] || bad "$lang: graph/$t.csv missing"
  done
  [ "$(header "$G/call_edges.csv")" = "$(printf 'call_site_id\tcaller_id\tcallee_method_id\tcallee_label\tcallee_provenance\ttier\tkind')" ] || bad "$lang: call_edges header is $(header "$G/call_edges.csv")"
  [ "$(header "$G/methods.csv")" = "$(printf 'id\tname\tqualified_name\tsignature\tkind\towner_type_id\towner_qualified_name\tfile_path\tstart_line\tend_line\tprovenance')" ] || bad "$lang: methods header drifted"
  # 2. the resolved edge joins to names, file and line
  callee="$(awk -F'\t' '$6=="known_edge"{print $3}' "$G/call_edges.csv")"
  [ -n "$callee" ] || bad "$lang: no known_edge row"
  want=app.Widget.render; [ "$lang" = typescript ] && want='widget#Widget.render'; [ "$lang" = python ] && want=widget.Widget.render
  [ "$(cell "$G/methods.csv" 3 "$callee")" = "$want" ] || bad "$lang: callee $callee does not name $want (got $(cell "$G/methods.csv" 3 "$callee"))"
  site="$(awk -F'\t' '$6=="known_edge"{print $1}' "$G/call_edges.csv")"
  [ "$(cell "$G/call_sites.csv" 4 "$site")" = "render" ] || bad "$lang: site callee_name is '$(cell "$G/call_sites.csv" 4 "$site")', not render"
  [ "$(cell "$G/call_sites.csv" 6 "$site")" = "5" ] || bad "$lang: site start_line is '$(cell "$G/call_sites.csv" 6 "$site")', not 5"
  [ -n "$(cell "$G/call_sites.csv" 5 "$site")" ] || bad "$lang: site has no file_path"
  # 3. the unresolved site is kept with NULL callee, and attributed
  unres="$(awk -F'\t' '$6=="ambiguous_unknown"{print $1"|"$3"|"$4"|"$5}' "$G/call_edges.csv")"
  case "$unres" in *_e2\|\|\|) ;; *) bad "$lang: unresolved row is '$unres' — expected empty callee/label/provenance";; esac
  [ "$(wc -l < "$G/unresolved_sites.csv" | tr -d ' ')" = "2" ] || bad "$lang: unresolved_sites has $(($(wc -l < "$G/unresolved_sites.csv")-1)) rows, expected 1"
  # 4. the in-database catalog
  if [ "$HAVE_SQLITE" = 1 ]; then
    DB="$d/graph.sqlite"; [ -f "$DB" ] || { bad "$lang: graph.sqlite missing"; continue; }
    [ "$(SQL "$DB" "SELECT value FROM run WHERE key='language'")" = "$lang" ] || bad "$lang: run.language wrong"
    n="$(SQL "$DB" "SELECT count(*) FROM schema_vocab WHERE table_name='call_edges' AND column_name='tier' AND language='$lang'")"
    [ "$n" -ge 4 ] || bad "$lang: only $n tier vocabulary rows for the language"
    [ "$(SQL "$DB" "SELECT count(*) FROM schema_tables WHERE scope='ext'")" -gt 0 ] || bad "$lang: no ext tables catalogued"
    [ "$(SQL "$DB" "SELECT count(*) FROM ext_call_chain_edge")" = "$(wc -l < "$d/raw/call-chain-edges.csv" | tr -d ' ')" ] || bad "$lang: ext_call_chain_edge row count differs from raw"
    joined="$(SQL "$DB" "SELECT cm.qualified_name||' -> '||tm.qualified_name||' @ '||s.file_path||':'||s.start_line FROM call_edges e JOIN call_sites s ON s.id=e.call_site_id JOIN methods cm ON cm.id=e.caller_id JOIN methods tm ON tm.id=e.callee_method_id WHERE e.tier='known_edge'")"
    case "$joined" in *"-> "*"Widget.render @ "*":5") ;; *) bad "$lang: the SQL join gave '$joined'";; esac
    case $lang in
      java) [ "$(SQL "$DB" "SELECT count(*) FROM schema_vocab WHERE table_name='type_instantiated' AND value='made_up_how' AND meaning LIKE 'undocumented%'")" = 1 ] || bad "java: an unauthored value was not recorded as undocumented";;
      python) [ "$(SQL "$DB" "SELECT callee_label||'/'||callee_provenance FROM call_edges WHERE tier='boundary_lib'")" = "builtin:print/builtin" ] || bad "python: builtin target not carried as a label";;
    esac
  fi
done

# 5. SCHEMA.md is the rendering of schema.ts
if ! diff -q <(BUNDLE --print-schema) "$ROOT/src/bundle/SCHEMA.md" >/dev/null; then
  bad "src/bundle/SCHEMA.md is stale — run: npm run schema-doc"
fi


# ── the DEFAULT writes the database and nothing else ────────────────────────
# The deliverable is graph.sqlite. graph/*.csv carries the same core tables, so writing
# both unasked doubles the output for a consumer that reads neither by hand. Asserted
# here rather than trusted, because the fallback below makes the condition non-obvious.
d="$W/default"; mkdir -p "$d"
BUNDLE_NO_DEBUG --language java --client-ir "$W/java/ir" --raw "$W/java/raw" --out "$d" >/dev/null 2>&1
[ -f "$d/graph.sqlite" ] || bad "default: graph.sqlite not written"
if [ -d "$d/graph" ] && [ -n "$(ls -A "$d/graph" 2>/dev/null)" ]; then
  bad "default: graph/ should be empty without --debug, found $(ls "$d/graph" | wc -l | tr -d ' ') files"
fi

if [ "$fail" -eq 0 ]; then
  echo "bundle: ok (3 languages$( [ "$HAVE_SQLITE" = 1 ] && echo ', sqlite queried' || echo ', csv only — no sqlite3 CLI'), schema doc current)"
else
  echo "bundle: $fail failure(s)"; exit 1
fi
