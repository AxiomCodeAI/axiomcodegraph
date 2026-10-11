#!/usr/bin/env bash
# axiom-code-graph — web layer regression checks for measured violations (state/violations.jsonl ids). Each check
# builds a tiny site with `bin/axiomcode <src> <out> --language web`, then asserts on graph.sqlite with a query that
# must return the expected value; each check also asserts it looked at >= 1 row, so an empty table never passes.
#   bash graph/web/test/violations.sh            all checks
#   bash graph/web/test/violations.sh V1-07      the checks whose name contains any argument
set -u
ROOT="${AXIOM_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
T=$(mktemp -d "${TMPDIR:-/tmp}/web-violations.XXXXXX"); trap 'rm -rf "$T"' EXIT
pass=0; fail=0; FILTERS=("$@")
want(){ [ ${#FILTERS[@]} -eq 0 ] && return 0; local f; for f in "${FILTERS[@]}"; do [[ "$1" == *"$f"* ]] && return 0; done; return 1; }
build(){ # name -> builds $T/<name>/src into $T/<name>/out, echoes the sqlite path
  local d="$T/$1"
  if ! bash "$ROOT/bin/axiomcode" "$d/src" "$d/out" --language web >"$d/build.log" 2>&1; then echo "BUILD FAILED: $1" >&2; tail -5 "$d/build.log" >&2; return 1; fi
  find "$d/out" -name graph.sqlite | head -1
}
put(){ mkdir -p "$(dirname "$1")"; cat > "$1"; }
eq(){ # name, got, wanted
  if [ "$2" == "$3" ]; then pass=$((pass+1)); echo "ok   $1"; else fail=$((fail+1)); echo "FAIL $1: got [$2] wanted [$3]"; fi
}

if want V1-07; then
  # a sheet linked twice is in the cascade at both loads
  put "$T/v107/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="a.css"><style>.x{color:blue}</style><link rel="stylesheet" href="a.css"></head><body><p class="x">x</p></body></html>
H
  printf '.x{color:red}\n' > "$T/v107/src/a.css"
  db=$(build v107) && eq "V1-07 one styles row per load (sheet_order 1 and 3)" \
    "$(sqlite3 "$db" "SELECT group_concat(sheet_order) FROM (SELECT w.sheet_order FROM web_styles w JOIN web_stylesheets s ON s.uid = w.stylesheet_uid WHERE s.file = 'a.css' ORDER BY 1)")" "1,3"
fi

if want V1-02; then
  # a page over the parser's size cap is a `skipped` row, not a silent absence
  mkdir -p "$T/v102/src"
  { echo '<!doctype html><html><body>'; seq 1 56000 | sed 's/.*/<p>&<\/p>/'; echo '</body></html>'; } > "$T/v102/src/big.html"
  echo '<!doctype html><p>s</p>' > "$T/v102/src/small.html"
  db=$(build v102) && eq "V1-02 oversize page is in skipped" "$(sqlite3 "$db" "SELECT file_path || ':' || reason FROM skipped")" "big.html:FILE_TOO_LARGE"
fi

if want V1-03; then
  # a block open at EOF closes there: later rules nest in it, and a css gap row says so
  put "$T/v103/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><p class="broken">x</p></body></html>
H
  printf '.broken { color: red;\n.after-broken { color: blue; }\n@media (min-width:10px) { .inside { color: green; }\n' > "$T/v103/src/s.css"
  db=$(build v103) && {
    eq "V1-03 .broken keeps color: red" "$(sqlite3 "$db" "SELECT d.value_text FROM web_declarations d JOIN web_rules r ON r.uid = d.rule_uid WHERE r.prelude_text = '.broken'")" "red"
    eq "V1-03 .after-broken nested in .broken" "$(sqlite3 "$db" "SELECT p.prelude_text FROM web_rules r JOIN web_rules p ON p.uid = r.parent_uid WHERE r.prelude_text = '.after-broken'")" ".broken"
    eq "V1-03 one UNCLOSED_BLOCK gap" "$(sqlite3 "$db" "SELECT count(*) FROM web_gaps WHERE lang = 'css' AND gap_kind = 'UNCLOSED_BLOCK'")" "1"
  }
fi

if want V1-12 V1-22; then
  # var tables: one scope row per (page, element, name) — two rules using --c on one element, a style attribute using it
  # too; visible rows at (use, owner) grain — --c defined in three theme sheets is ONE row per sheet, not per definition
  put "$T/v112/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="t1.css"><link rel="stylesheet" href="t2.css"><link rel="stylesheet" href="a.css"></head>
<body><div class="box big" style="border-color: var(--c)">x</div></body></html>
H
  printf ':root{--c:red}\n:root{--c:pink}\n.box{--c:navy}\n' > "$T/v112/src/t1.css"
  printf ':root{--c:blue}\n' > "$T/v112/src/t2.css"
  printf '.box{color:var(--c)}\n.big{background:var(--c)}\n' > "$T/v112/src/a.css"
  db=$(build v112) && {
    eq "V1-12 scope rows = distinct (page, element, name) and >= 1" \
      "$(sqlite3 "$db" "SELECT count(*) = (SELECT count(*) FROM (SELECT DISTINCT page_uid, element_uid, name FROM web_var_scope)) AND count(*) >= 1 FROM web_var_scope")" "1"
    eq "V1-12 the div's --c root is itself (.box defines it)" \
      "$(sqlite3 "$db" "SELECT count(*) FROM web_var_scope s JOIN web_elements e ON e.uid = s.element_uid WHERE e.tag_name = 'div' AND s.root_uid = s.element_uid")" "1"
    eq "V1-22 visible: one row per (use, owner sheet): 3 uses x 2 sheets" \
      "$(sqlite3 "$db" "SELECT count(*) || '/' || sum(defs) FROM web_var_visible")" "6/12"
    eq "V1-22 web_var_visible_defs expands to one row per (use, def)" \
      "$(sqlite3 "$db" "SELECT count(*) FROM (SELECT DISTINCT value_ref_uid, def_uid FROM web_var_visible_defs WHERE def_uid IS NOT NULL)")" "12"
  }
fi

echo "web violation checks: $pass passed, $fail failed"
[ "$fail" -eq 0 ] && [ "$pass" -ge 1 ]
