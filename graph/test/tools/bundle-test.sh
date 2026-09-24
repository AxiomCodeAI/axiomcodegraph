#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# The bundle stage (graph/bundle/) — the language-neutral output every suite now solves into.
#
# No parser, no soufflé: each language gets a HAND-WRITTEN raw/ dump and a minimal IR whose
# headers carry only the columns the adapter asks for by name (that is the point of resolving
# by name). Then the bundle is built and read back:
#   1. csv/<table>.csv exists for every core table, with the header the schema declares
#   2. a caller and its resolved callee join to qualified names, file and line — in every language
#   3. an unresolved site is kept, with NULL callee, and lands in unresolved_sites
#   4. the vocabulary inside the database knows the language's own values, and a value the
#      schema does not list is still recorded as undocumented rather than dropped
#   5. graph/bundle/SCHEMA.md is what schema.ts renders — the two cannot drift
#   6. a file the PARSER SKIPPED is in `skipped` with its reason — the one table about code
#      that is NOT in the graph, in every language that writes the report (#1148)
# Assertions read the CSVs; the sqlite3 CLI, when present, also queries the database.
# ─────────────────────────────────────────────────────────────────────────────
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"  # the repository root, found by its marker — no level counting
TSX="$ROOT/node_modules/.bin/tsx"
[ -x "$TSX" ] || { echo "bundle-test: SKIP (no node_modules/.bin/tsx — run npm install)"; exit 0; }
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
fail=0; bad(){ echo "  ✗ $*"; fail=$((fail+1)); }
# --debug, because every assertion below reads csv/*.csv. Without it the bundler writes
# graph.sqlite alone — the CSVs are a debugging view of the same core tables, and a
# consumer that queries the database does not want a second copy of it on disk. The
# default is asserted separately at the end.
# Run from a FOREIGN working directory on purpose, with the tsconfig named explicitly, the
# way run-souffle.sh invokes the stage: tsx resolves the @/ alias from the tsconfig it finds
# relative to the cwd, so a test that ran from the checkout passed while every consumer
# running from its own repository failed with "Cannot find module '@/bundle/build'" (#470).
BUNDLE(){ ( cd "$W" && "$TSX" --tsconfig "$ROOT/tsconfig.json" "$ROOT/graph/bundle/cli.ts" --src "$ROOT/graph" --debug "$@" ); }
BUNDLE_NO_DEBUG(){ ( cd "$W" && "$TSX" --tsconfig "$ROOT/tsconfig.json" "$ROOT/graph/bundle/cli.ts" --src "$ROOT/graph" "$@" ); }
SQL(){ command -v sqlite3 >/dev/null && sqlite3 "$1" "$2"; }
HAVE_SQLITE=0; command -v sqlite3 >/dev/null && HAVE_SQLITE=1

# ── fixtures: one caller → one resolved callee, one unresolved site ──────────
mk_java(){ local d="$1"; mkdir -p "$d/ir" "$d/raw"
  printf 'name\tsignature\tqualifiedName\tfilePath\tstartLine\tendLine\ttypeRegistryLinkHash\townerQualifiedName\tmethodKind\tmethodRegistryUniqueHash\n' > "$d/ir/all-methods.csv"
  printf 'main\tmain(String[])\tapp.Main.main\tsrc/Main.java\t3\t7\tTYPE_REGISTRY_t1\tapp.Main\tSTATIC_METHOD\tMETHOD_REGISTRY_m1\n' >> "$d/ir/all-methods.csv"
  printf 'render\trender()\tapp.Widget.render\tsrc/Widget.java\t4\t9\tTYPE_REGISTRY_t2\tapp.Widget\tINSTANCE_METHOD\tMETHOD_REGISTRY_m2\n' >> "$d/ir/all-methods.csv"
  printf 'render\trender()\tapp.FancyWidget.render\tsrc/FancyWidget.java\t3\t6\tTYPE_REGISTRY_t3\tapp.FancyWidget\tINSTANCE_METHOD\tMETHOD_REGISTRY_m3\n' >> "$d/ir/all-methods.csv"
  printf 'name\tqualifiedName\ttypeCategory\tfilePath\tstartLine\tendLine\ttypeRegistryUniqueHash\n' > "$d/ir/all-types.csv"
  printf 'Main\tapp.Main\tCLASS_TYPE\tsrc/Main.java\t1\t9\tTYPE_REGISTRY_t1\nWidget\tapp.Widget\tCLASS_TYPE\tsrc/Widget.java\t1\t12\tTYPE_REGISTRY_t2\nFancyWidget\tapp.FancyWidget\tCLASS_TYPE\tsrc/FancyWidget.java\t1\t8\tTYPE_REGISTRY_t3\n' >> "$d/ir/all-types.csv"
  printf 'kind\tliteralValue\ttypeRegistryLinkHash\tstartLine\tstartColumn\tendLine\tendColumn\texpressionUniqueHash\n' > "$d/ir/all-expressions.csv"
  printf 'METHOD_INVOCATION\trender\tTYPE_REGISTRY_t1\t5\t9\t5\t20\tEXPRESSION_REFERENCE_e1\nMETHOD_INVOCATION\tmystery\tTYPE_REGISTRY_t1\t6\t9\t6\t22\tEXPRESSION_REFERENCE_e2\n' >> "$d/ir/all-expressions.csv"
  printf 'EXPRESSION_REFERENCE_e1\tMETHOD_REGISTRY_m1\t-\tMETHOD_REGISTRY_m2\tclient\tknown_edge\tmethod\n' > "$d/raw/call-chain-edges.csv"
  printf 'EXPRESSION_REFERENCE_e2\tMETHOD_REGISTRY_m1\t-\t-\t-\tambiguous_unknown\tmethod\n' >> "$d/raw/call-chain-edges.csv"
  printf 'METHOD_REGISTRY_m1\tmain\n' > "$d/raw/entry-point.csv"
  printf 'TYPE_REGISTRY_t2\tnew\nTYPE_REGISTRY_t2\tmade_up_how\nTYPE_REGISTRY_t3\tnew\n' > "$d/raw/type-instantiated.csv"
  printf 'METHOD_REGISTRY_m2\tMETHOD_REGISTRY_m3\tnominal\n' > "$d/raw/dispatch-candidates.csv"
  # A file the parser declined: no method, type or expression row anywhere names it.
  # Written WITHOUT a trailing newline, byte-for-byte as the Java analyzer writes it
  # (`[header, ...rows].join('\n')`) — the one report of the four that ends mid-line, and
  # a reader that drops the last unterminated row would lose the only row there is.
  printf 'filePath\tbaseMservPath\tserviceVersionHash\treason\tuniqueFileHash\n' > "$d/ir/skipped-java-files.csv"
  printf 'src/Huge.java\t/p\tSV1\tFILE_TOO_LARGE\tH1' >> "$d/ir/skipped-java-files.csv"
}
mk_typescript(){ local d="$1"; mkdir -p "$d/ir" "$d/raw"
  printf 'name\tsignature\tqualifiedName\tfilePath\tstartLine\tendLine\ttsTypeLinkHash\townerQualifiedName\tmethodKind\ttsMethodUniqueHash\n' > "$d/ir/all-typescript-methods.csv"
  printf 'main\tmain()\tapp#main\tsrc/app.ts\t3\t7\t\t\tFUNCTION_DECLARATION\tTS_METHOD_m1\nrender\trender()\twidget#Widget.render\tsrc/widget.ts\t4\t9\tTS_TYPE_t2\twidget#Widget\tMETHOD_DECLARATION\tTS_METHOD_m2\n' >> "$d/ir/all-typescript-methods.csv"
  printf 'render\trender()\twidget#FancyWidget.render\tsrc/fancy.ts\t3\t6\tTS_TYPE_t3\twidget#FancyWidget\tMETHOD_DECLARATION\tTS_METHOD_m3\nrender\trender()\tduck#Duck.render\tsrc/duck.ts\t2\t4\tTS_TYPE_t4\tduck#Duck\tMETHOD_DECLARATION\tTS_METHOD_m4\n' >> "$d/ir/all-typescript-methods.csv"
  printf 'name\tqualifiedName\ttypeCategory\tfilePath\tstartLine\tendLine\ttsTypeUniqueHash\n' > "$d/ir/all-typescript-types.csv"
  printf 'Widget\twidget#Widget\tCLASS_TYPE\tsrc/widget.ts\t1\t12\tTS_TYPE_t2\nFancyWidget\twidget#FancyWidget\tCLASS_TYPE\tsrc/fancy.ts\t1\t8\tTS_TYPE_t3\nDuck\tduck#Duck\tCLASS_TYPE\tsrc/duck.ts\t1\t5\tTS_TYPE_t4\n' >> "$d/ir/all-typescript-types.csv"
  printf 'tsModuleUniqueHash\tfilePath\n' > "$d/ir/all-typescript-modules.csv"
  printf 'TS_MODULE_a\tsrc/app.ts\n' >> "$d/ir/all-typescript-modules.csv"
  printf 'callKind\tcalleeName\ttsExpressionLinkHash\ttsModuleLinkHash\tstartLine\tstartColumn\n' > "$d/ir/all-typescript-call-sites.csv"
  printf 'METHOD_CALL\trender\tTS_EXPRESSION_e1\tTS_MODULE_a\t5\t9\nFUNCTION_CALL\tmystery\tTS_EXPRESSION_e2\tTS_MODULE_a\t6\t9\n' >> "$d/ir/all-typescript-call-sites.csv"
  printf 'kind\tstartLine\tstartColumn\tendLine\tendColumn\ttsModuleLinkHash\ttsExpressionUniqueHash\n' > "$d/ir/all-typescript-expressions.csv"
  printf 'CALL\t5\t9\t5\t20\tTS_MODULE_a\tTS_EXPRESSION_e1\nCALL\t6\t9\t6\t22\tTS_MODULE_a\tTS_EXPRESSION_e2\n' >> "$d/ir/all-typescript-expressions.csv"
  printf 'TS_EXPRESSION_e1\tTS_METHOD_m1\t-\tTS_METHOD_m2\tclient\tknown_edge\tMETHOD_CALL\n' > "$d/raw/call-chain-edges.csv"
  printf 'TS_EXPRESSION_e2\tTS_METHOD_m1\t-\t-\t-\tambiguous_unknown\tFUNCTION_CALL\n' >> "$d/raw/call-chain-edges.csv"
  printf 'TS_METHOD_m1\tunimported_module\n' > "$d/raw/entry-point.csv"
  printf 'TS_METHOD_m2\tTS_METHOD_m3\tnominal\nTS_METHOD_m2\tTS_METHOD_m4\tstructural\n' > "$d/raw/dispatch-candidates.csv"
  printf 'TS_TYPE_t2\tnew\nTS_TYPE_t3\tnew\n' > "$d/raw/resolution-type-instantiated.csv"
  printf 'filePath\tbaseMservPath\tserviceVersionLinkHash\treason\tdetail\n' > "$d/ir/skipped-typescript-files.csv"
  printf 'src/orphan.ts\t/p\tSV1\tNO_PROGRAM_CLAIMS_FILE\tno tsconfig claims it\n' >> "$d/ir/skipped-typescript-files.csv"
}
mk_python(){ local d="$1"; mkdir -p "$d/ir" "$d/raw"
  printf 'name\tsignature\tqualifiedName\tfilePath\tstartLine\tendLine\tpyTypeLinkHash\townerQualifiedName\tmethodKind\tpyMethodUniqueHash\n' > "$d/ir/all-python-methods.csv"
  printf 'main\tmain()\tapp.main\tapp.py\t3\t7\t\t\tFUNCTION\tPY_METHOD_m1\nrender\trender(self)\twidget.Widget.render\twidget.py\t4\t9\tPY_TYPE_t2\twidget.Widget\tINSTANCE_METHOD\tPY_METHOD_m2\n' >> "$d/ir/all-python-methods.csv"
  printf 'render\trender(self)\tfancy.FancyWidget.render\tfancy.py\t3\t6\tPY_TYPE_t3\tfancy.FancyWidget\tINSTANCE_METHOD\tPY_METHOD_m3\n' >> "$d/ir/all-python-methods.csv"
  printf 'name\tqualifiedName\ttypeCategory\tfilePath\tstartLine\tendLine\tpyTypeUniqueHash\n' > "$d/ir/all-python-types.csv"
  printf 'Widget\twidget.Widget\tCLASS_TYPE\twidget.py\t1\t12\tPY_TYPE_t2\nFancyWidget\tfancy.FancyWidget\tCLASS_TYPE\tfancy.py\t1\t8\tPY_TYPE_t3\n' >> "$d/ir/all-python-types.csv"
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
  printf 'client\tPY_TYPE_t2\nclient\tPY_TYPE_t3\n' > "$d/raw/resolution-type-instantiated.csv"
  printf 'PY_METHOD_m2\tPY_METHOD_m3\tmro\n' > "$d/raw/dispatch-candidates.csv"
  printf 'filePath\tbaseMservPath\tserviceVersionLinkHash\treason\tconstruct\tstartLine\tstartColumn\tdetail\n' > "$d/ir/skipped-python-files.csv"
  printf 'legacy.py\t/p\tSV1\tPY2_CONSTRUCT_DETECTED\texcept_clause_comma_target\t4\t11\tpython 2 source\n' >> "$d/ir/skipped-python-files.csv"
}

# column N (1-based) of the row whose first column is $3, in headered TSV $1
cell(){ awk -F'\t' -v n="$2" -v k="$3" '$1==k{print $n; exit}' "$1"; }
header(){ head -1 "$1"; }

for lang in java typescript python; do
  d="$W/$lang"; "mk_$lang" "$d"
  if ! BUNDLE --language "$lang" --client-ir "$d/ir" --raw "$d/raw" --out "$d" > "$d/log" 2>&1; then
    bad "$lang: bundle failed:"; sed 's/^/      /' "$d/log" | tail -5; continue
  fi
  G="$d/csv"
  # 1. every core table, with the declared header
  for t in run methods types call_sites call_edges type_ancestors dispatch_candidates overrides entry_points entry_reachable unresolved_sites type_instantiated skipped; do
    [ -f "$G/$t.csv" ] || bad "$lang: csv/$t.csv missing"
  done
  [ "$(header "$G/call_edges.csv")" = "$(printf 'call_site_id\tcaller_id\tcallee_method_id\tcallee_label\tcallee_provenance\ttier\tkind')" ] || bad "$lang: call_edges header is $(header "$G/call_edges.csv")"
  [ "$(header "$G/methods.csv")" = "$(printf 'id\tname\tqualified_name\tsignature\tkind\towner_type_id\towner_qualified_name\tfile_path\tstart_line\tend_line\tprovenance\tvisibility')" ] || bad "$lang: methods header drifted"
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
  # 3b. the DISPATCH ENVELOPE and the RTA set, IN EVERY LANGUAGE (#471).
  #     Asserted inside the per-language loop and not once outside it: the whole defect
  #     was that these two tables were populated in Java and empty in the other two, and
  #     an assertion that runs once passes on Java and never looks.
  [ "$(header "$G/dispatch_candidates.csv")" = "$(printf 'base_method_id\tcandidate_method_id\tbasis')" ] || bad "$lang: dispatch_candidates header is $(header "$G/dispatch_candidates.csv")"
  nd=$(($(wc -l < "$G/dispatch_candidates.csv") - 1))
  [ "$nd" -ge 1 ] || bad "$lang: dispatch_candidates is EMPTY — the dispatch envelope is not language-neutral"
  ni=$(($(wc -l < "$G/type_instantiated.csv") - 1))
  [ "$ni" -ge 1 ] || bad "$lang: type_instantiated is EMPTY — no RTA set for this language"
  # the pair is the base render -> the overriding render, and it joins to real methods
  base="$(awk -F'\t' 'NR>1{print $1; exit}' "$G/dispatch_candidates.csv")"
  cand="$(awk -F'\t' 'NR>1{print $2; exit}' "$G/dispatch_candidates.csv")"
  case "$(cell "$G/methods.csv" 3 "$base")" in *Widget.render) ;; *) bad "$lang: envelope base is '$(cell "$G/methods.csv" 3 "$base")', not a Widget.render";; esac
  case "$(cell "$G/methods.csv" 3 "$cand")" in *FancyWidget.render) ;; *) bad "$lang: envelope candidate is '$(cell "$G/methods.csv" 3 "$cand")', not FancyWidget.render";; esac
  # 3c. THE ONE TABLE ABOUT CODE THAT IS NOT IN THE GRAPH (#1148).
  #     A file the parser declined has no row in methods, types or call_sites — that is the
  #     point — so the ONLY way to tell it from a file with nothing in it is this table. It
  #     was absent from every bundle while the parser, and the skill's own index, both had
  #     it, and the calls into such a file read as engine misses. Asserted per language
  #     because each front end writes a different report with different columns.
  [ "$(header "$G/skipped.csv")" = "$(printf 'file_path\treason\tconstruct\tstart_line\tstart_column\tdetail')" ] || bad "$lang: skipped header is $(header "$G/skipped.csv")"
  case $lang in
    java)       sk=src/Huge.java;   sr=FILE_TOO_LARGE;;
    typescript) sk=src/orphan.ts;   sr=NO_PROGRAM_CLAIMS_FILE;;
    python)     sk=legacy.py;       sr=PY2_CONSTRUCT_DETECTED;;
  esac
  [ "$(cell "$G/skipped.csv" 2 "$sk")" = "$sr" ] || bad "$lang: skipped does not record $sk as $sr (got '$(cell "$G/skipped.csv" 2 "$sk")')"
  # and the file really is absent from the graph — otherwise the row proves nothing
  grep -q "	$sk	" "$G/methods.csv" && bad "$lang: $sk has a methods row; the fixture no longer models a skipped file"
  # the position columns are the python report's alone, and they must not be invented elsewhere
  if [ "$lang" = python ]; then
    [ "$(cell "$G/skipped.csv" 3 "$sk")" = "except_clause_comma_target" ] || bad "python: skipped.construct is '$(cell "$G/skipped.csv" 3 "$sk")'"
    [ "$(cell "$G/skipped.csv" 4 "$sk")" = "4" ] || bad "python: skipped.start_line is '$(cell "$G/skipped.csv" 4 "$sk")', not 4"
    [ "$(cell "$G/skipped.csv" 5 "$sk")" = "11" ] || bad "python: skipped.start_column is '$(cell "$G/skipped.csv" 5 "$sk")', not 11"
  else
    [ -z "$(cell "$G/skipped.csv" 3 "$sk")" ] || bad "$lang: skipped.construct is '$(cell "$G/skipped.csv" 3 "$sk")' — the report has no such column"
    [ -z "$(cell "$G/skipped.csv" 4 "$sk")" ] || bad "$lang: skipped.start_line is not empty — the report carries no position"
  fi
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
    # every basis this language emits is one the schema documents FOR THIS LANGUAGE — an
    # undocumented value here means the vocabulary and the rules disagree about the envelope
    undoc="$(SQL "$DB" "SELECT DISTINCT d.basis FROM dispatch_candidates d WHERE NOT EXISTS (SELECT 1 FROM schema_vocab v WHERE v.table_name='dispatch_candidates' AND v.column_name='basis' AND v.value=d.basis AND v.language='$lang' AND v.meaning NOT LIKE 'undocumented%')")"
    [ -z "$undoc" ] || bad "$lang: dispatch_candidates.basis emits '$undoc', which the schema does not document for $lang"
    # every reason this language emits is documented FOR THIS LANGUAGE: the sets differ per
    # front end, so a reason listed under some other language is not documentation here
    undocsk="$(SQL "$DB" "SELECT DISTINCT k.reason FROM skipped k WHERE NOT EXISTS (SELECT 1 FROM schema_vocab v WHERE v.table_name='skipped' AND v.column_name='reason' AND v.value=k.reason AND v.language='$lang' AND v.meaning NOT LIKE 'undocumented%')")"
    [ -z "$undocsk" ] || bad "$lang: skipped.reason emits '$undocsk', which the schema does not document for $lang"
    [ "$(SQL "$DB" "SELECT count(*) FROM skipped")" = 1 ] || bad "$lang: skipped has $(SQL "$DB" "SELECT count(*) FROM skipped") rows in the database, expected 1"
    # the skipped file has NO methods row — the join a consumer makes to separate
    # "not indexed" from "indexed and empty" must come back zero
    [ "$(SQL "$DB" "SELECT count(*) FROM methods m JOIN skipped k ON k.file_path = m.file_path")" = 0 ] \
      || bad "$lang: a skipped file also has methods rows"
    # an owned member names its owner: SCHEMA.md makes owner_qualified_name NULL only when
    # owner_type_id is (#1247)
    [ "$(SQL "$DB" "SELECT count(*) FROM methods WHERE owner_type_id IS NOT NULL AND coalesce(owner_qualified_name,'')=''")" = 0 ] \
      || bad "$lang: an owned method has no owner_qualified_name"
    case $lang in
      java) [ "$(SQL "$DB" "SELECT count(*) FROM schema_vocab WHERE table_name='type_instantiated' AND value='made_up_how' AND meaning LIKE 'undocumented%'")" = 1 ] || bad "java: an unauthored value was not recorded as undocumented";;
      python) [ "$(SQL "$DB" "SELECT callee_label||'/'||callee_provenance FROM call_edges WHERE tier='boundary_lib'")" = "builtin:print/builtin" ] || bad "python: builtin target not carried as a label";;
    esac
  fi
done

# 4b. A CONFIG_BINDING ROW IS A REASON TO LIST THE FIELD (#890)
#
# `fields` lists a LIBRARY field only when some field_access edge reaches it. A @Value
# field on a library type that nothing reads has no such edge, and config_binding named
# it anyway, so a consumer joining the two lost the row with no indication. Measured at
# 73 percent of config_binding rows on a run with one shared starter staged as a library.
#
# The fixture is the minimum that reproduces it: a library field, NO field_access row
# anywhere, and one config_binding row naming it.
if [ "$HAVE_SQLITE" = 1 ]; then
  cb="$W/cb"; mkdir -p "$cb/ir" "$cb/raw" "$cb/lib-ir" "$cb/lib-facts"
  mk_java "$cb"
  FH='name\tfieldTypeName\tfieldBaseType\tpotentialQualifiedName\tisAmbiguous\tfilePath\tstartLine\tendLine\ttypeRegistryLinkHash\townerTypeName\townerQualifiedName\tfieldAccess\tfieldModifier\tfieldRegistryUniqueHash\n'
  FR='timeout\tint\tint\t\tfalse\tdep/Conf.java\t7\t7\tTYPE_REGISTRY_L1\tConf\tdep.Conf\tprivate\t\tFIELD_REGISTRY_LIBFIELD\n'
  printf "$FH" > "$cb/lib-ir/all-fields.csv"
  printf "$FR" >> "$cb/lib-ir/all-fields.csv"
  printf "$FR" > "$cb/lib-facts/lib_field.facts"          # staged rows carry no header
  printf 'svc.timeout\tvalue_annotation\tfield\tFIELD_REGISTRY_LIBFIELD\tlib\n' > "$cb/raw/config-binding.csv"
  : > "$cb/raw/field-access.csv"                           # the point: nothing reaches it
  BUNDLE --language java --client-ir "$cb/ir" --raw "$cb/raw" \
         --library "$cb/lib-ir" --lib-facts "$cb/lib-facts" --out "$cb/out" >/dev/null 2>&1 \
    || bad "config_binding fixture did not bundle"
  CBDB="$cb/out/graph.sqlite"
  if [ -f "$CBDB" ]; then
    [ "$(SQL "$CBDB" "SELECT count(*) FROM ext_config_binding")" = 1 ] \
      || bad "config_binding: the fixture row did not reach ext_config_binding"
    dangling="$(SQL "$CBDB" "SELECT count(*) FROM ext_config_binding b WHERE b.c2='field' AND NOT EXISTS (SELECT 1 FROM fields f WHERE f.id=b.c3)")"
    [ "$dangling" = 0 ] \
      || bad "config_binding names $dangling field(s) that the fields table does not list"
  fi
fi

# 4c. A C# MEMBER NAMES ITS OWNER (#1247)
#
# cs_method and cs_field carry the owner's type hash and no owner name column, so the adapter
# mapped none and owner_qualified_name was NULL on every C# member, while the same column is
# filled for Java, TypeScript and Python. The bundle now takes it from the owning type's row.
# The control is a local function: no owner type, so the name must stay NULL.
if [ "$HAVE_SQLITE" = 1 ]; then
  cs="$W/cs"; mkdir -p "$cs/ir" "$cs/raw"
  printf 'name\tqualifiedName\tsignature\tmethodKind\tcsModuleLinkHash\tcsTypeLinkHash\tstartLine\tendLine\tcsMethodUniqueHash\n' > "$cs/ir/all-csharp-methods.csv"
  printf 'Main\tApp.Program.Main\tvoid\tMETHOD\tCS_MODULE_a\tCS_TYPE_t1\t3\t8\tCS_METHOD_m1\n' >> "$cs/ir/all-csharp-methods.csv"
  printf 'get_Value\tApp.Counter.get_Value\tint\tMETHOD\tCS_MODULE_a\tCS_TYPE_t2\t12\t12\tCS_METHOD_m2\n' >> "$cs/ir/all-csharp-methods.csv"
  printf 'Local\tLocal\tvoid\tLOCAL_FUNCTION\tCS_MODULE_a\t\t6\t6\tCS_METHOD_m3\n' >> "$cs/ir/all-csharp-methods.csv"
  printf 'name\tqualifiedName\ttypeCategory\tcsModuleLinkHash\tstartLine\tendLine\tcsTypeUniqueHash\n' > "$cs/ir/all-csharp-types.csv"
  printf 'Program\tApp.Program\tCLASS\tCS_MODULE_a\t1\t9\tCS_TYPE_t1\nCounter\tApp.Counter\tCLASS\tCS_MODULE_a\t10\t14\tCS_TYPE_t2\n' >> "$cs/ir/all-csharp-types.csv"
  printf 'name\tfieldTypeName\tfieldModifiers\tcsTypeLinkHash\tcsModuleLinkHash\tstartLine\tendLine\tcsFieldUniqueHash\n' > "$cs/ir/all-csharp-fields.csv"
  printf '_value\tint\tPRIVATE\tCS_TYPE_t2\tCS_MODULE_a\t11\t11\tCS_FIELD_f1\n' >> "$cs/ir/all-csharp-fields.csv"
  printf 'filePath\tcsModuleUniqueHash\nProgram.cs\tCS_MODULE_a\n' > "$cs/ir/all-csharp-modules.csv"
  printf 'kind\tcsModuleLinkHash\tstartLine\tstartColumn\tendLine\tendColumn\tcsExpressionUniqueHash\n' > "$cs/ir/all-csharp-expressions.csv"
  printf 'INVOCATION\tCS_MODULE_a\t5\t9\t5\t20\tCS_EXPRESSION_e1\n' >> "$cs/ir/all-csharp-expressions.csv"
  printf 'calleeName\tcsExpressionLinkHash\tcsModuleLinkHash\tstartLine\tstartColumn\n' > "$cs/ir/all-csharp-call-sites.csv"
  printf 'get_Value\tCS_EXPRESSION_e1\tCS_MODULE_a\t5\t9\n' >> "$cs/ir/all-csharp-call-sites.csv"
  printf 'CS_EXPRESSION_e1\tCS_METHOD_m1\t-\tCS_METHOD_m2\tclient\tknown_edge\tmethod\n' > "$cs/raw/call-chain-edges.csv"
  BUNDLE --language csharp --client-ir "$cs/ir" --raw "$cs/raw" --out "$cs/out" > "$cs/log" 2>&1 \
    || { bad "csharp owner fixture did not bundle:"; sed 's/^/      /' "$cs/log" | tail -5; }
  CSDB="$cs/out/graph.sqlite"
  if [ -f "$CSDB" ]; then
    got="$(SQL "$CSDB" "SELECT group_concat(name||'='||coalesce(owner_qualified_name,'NULL'), ' ') FROM (SELECT name, owner_qualified_name FROM methods ORDER BY name)")"
    [ "$got" = "Local=NULL Main=App.Program get_Value=App.Counter" ] \
      || bad "csharp: methods.owner_qualified_name is '$got', expected 'Local=NULL Main=App.Program get_Value=App.Counter'"
    got="$(SQL "$CSDB" "SELECT coalesce(owner_qualified_name,'NULL') FROM fields WHERE name='_value'")"
    [ "$got" = "App.Counter" ] || bad "csharp: fields.owner_qualified_name is '$got', expected App.Counter"
  fi
fi

# 5. ONE schema for every language: the DDL of every non-ext table, the column catalog and
#    the core catalog rows are byte-identical across the three bundles; only ext_* differs.
if [ "$HAVE_SQLITE" = 1 ]; then
  ddl(){ SQL "$W/$1/graph.sqlite" "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'ext_%' AND name NOT LIKE 'idx_ext_%' ORDER BY type, name"; }
  cols(){ SQL "$W/$1/graph.sqlite" "SELECT * FROM schema_columns ORDER BY 1,2"; }
  core(){ SQL "$W/$1/graph.sqlite" "SELECT * FROM schema_tables WHERE scope != 'ext' ORDER BY 1"; }
  for other in typescript python; do
    [ "$(ddl java)" = "$(ddl $other)" ] || bad "core/catalog DDL differs between java and $other"
    [ "$(cols java)" = "$(cols $other)" ] || bad "schema_columns differs between java and $other"
    [ "$(core java)" = "$(core $other)" ] || bad "core schema_tables rows differ between java and $other"
  done
  [ "$(SQL "$W/java/graph.sqlite" "PRAGMA user_version")" = "$(grep -o "SCHEMA_VERSION = '[0-9]*'" "$ROOT/graph/bundle/schema.ts" | grep -o '[0-9]*')" ] || bad "PRAGMA user_version is not SCHEMA_VERSION"
  # 6. the guide is there, and every canonical query runs on every language's bundle
  for lang in java typescript python; do
    DB="$W/$lang/graph.sqlite"
    [ "$(SQL "$DB" "SELECT count(*) FROM schema_guide")" -ge 5 ] || bad "$lang: schema_guide is missing"
    SQL "$DB" "SELECT name FROM schema_queries" | while read -r q; do
      sql="$(SQL "$DB" "SELECT sql FROM schema_queries WHERE name='$q'")"
      if ! sqlite3 "$DB" ".parameter set :qualified_name 'x'" ".parameter set :depth 2" ".parameter set :file_path 'x'" ".parameter set :line 1" ".parameter set :table_name 'call_edges'" ".parameter set :column_name 'tier'" "$sql" > "$W/q.out" 2> "$W/q.err"; then
        bad "$lang: schema_queries.$q does not run: $(head -1 "$W/q.err")"
      fi
    done
    # and one of them gives the right answer on the fixture
    want=app.Widget.render; [ "$lang" = typescript ] && want='widget#Widget.render'; [ "$lang" = python ] && want=widget.Widget.render
    got="$(sqlite3 "$DB" ".parameter set :qualified_name '$want'" "$(SQL "$DB" "SELECT sql FROM schema_queries WHERE name='callers_of'")" | cut -d'|' -f1,3,4)"
    case "$got" in *"main|5|known_edge"*) ;; *) bad "$lang: callers_of on the fixture gave '$got'";; esac
    env="$(sqlite3 "$DB" ".parameter set :qualified_name '$want'" "$(SQL "$DB" "SELECT sql FROM schema_queries WHERE name='dispatch_envelope_of'")")"
    case "$env" in *FancyWidget.render*) ;; *) bad "$lang: dispatch_envelope_of on the fixture gave '$env'";; esac
    # the fixture instantiates the nominal override's owner, so the query must say so.
    # The column that lets a consumer narrow the envelope itself is worth nothing if it is
    # constant, so TypeScript — whose fixture also carries a duck type nothing constructs —
    # must return BOTH values. That is the discriminating half of this assertion.
    printf '%s\n' "$env" | grep -q '|1$' || bad "$lang: dispatch_envelope_of never marks an instantiated owner (got '$env')"
    if [ "$lang" = typescript ]; then
      printf '%s\n' "$env" | grep -q '|0$' || bad "typescript: owner_instantiated is 1 for the never-constructed duck type — the column does not discriminate"
    fi
  done
fi

# 7. SCHEMA.md is the rendering of schema.ts
if ! diff -q <(BUNDLE --print-schema) "$ROOT/graph/bundle/SCHEMA.md" >/dev/null; then
  bad "graph/bundle/SCHEMA.md is stale — run: npm run schema-doc"
fi


# ── the DEFAULT writes the database and nothing else ────────────────────────
# The deliverable is graph.sqlite. csv/*.csv carries the same core tables, so writing
# both unasked doubles the output for a consumer that reads neither by hand. Asserted
# here rather than trusted, because the fallback below makes the condition non-obvious.
d="$W/default"; mkdir -p "$d"
BUNDLE_NO_DEBUG --language java --client-ir "$W/java/ir" --raw "$W/java/raw" --out "$d" >/dev/null 2>&1
[ -f "$d/graph.sqlite" ] || bad "default: graph.sqlite not written"
if [ -d "$d/csv" ] && [ -n "$(ls -A "$d/csv" 2>/dev/null)" ]; then
  bad "default: csv/ should be empty without --debug, found $(ls "$d/csv" | wc -l | tr -d ' ') files"
fi

if [ "$fail" -eq 0 ]; then
  echo "bundle: ok (3 languages$( [ "$HAVE_SQLITE" = 1 ] && echo ', one schema across them, canonical queries run' || echo ', csv only — no sqlite3 CLI'), schema doc current)"
else
  echo "bundle: $fail failure(s)"; exit 1
fi
