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

if want V1-06; then
  # a URL naming a directory serves its index page; a query with no path is the page itself
  put "$T/v106/src/index.html" <<'H'
<!doctype html><html><body><a href="docs/">d</a><a href="?p=1">self</a><a href="?p=2#top">top</a><h1 id="top">t</h1></body></html>
H
  put "$T/v106/src/docs/index.html" <<< '<!doctype html><p>docs</p>'
  db=$(build v106) && eq "V1-06 docs/ and ?p= links resolve (3 rows)" \
    "$(sqlite3 "$db" "SELECT group_concat(x, ' ') FROM (SELECT l.url_as_written || '>' || coalesce(p.file, '-') || ':' || l.status AS x FROM web_links l LEFT JOIN web_pages p ON p.uid = l.to_page_uid ORDER BY 1)")" \
    "?p=1>index.html:match ?p=2#top>index.html:match docs/>docs/index.html:match"
fi

if want V1-08; then
  # whitespace between the tags is a text child: :empty does not match it; a comment alone does not count
  put "$T/v108/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body>
<button class="x" id="ws">
   </button><button class="x" id="none"></button><button class="x" id="cmt"><!-- c --></button><button class="x" id="cmtws"><!-- c --> </button>
</body></html>
H
  printf '.x:empty::after{content:"e"}\n' > "$T/v108/src/s.css"
  db=$(build v108) && eq "V1-08 :empty matches #none and #cmt only" \
    "$(sqlite3 "$db" "SELECT group_concat(id, ',') FROM (SELECT e.html_id AS id FROM web_styles w JOIN web_elements e ON e.uid = w.element_uid JOIN web_selectors s ON s.uid = w.selector_uid WHERE s.selector_text = '.x:empty::after' AND w.status = 'match' ORDER BY 1)")" "cmt,none"
fi

if want V1-09; then
  # An+B written with spaces: a selector list holding two of them keeps both selectors (and the rule after it)
  put "$T/v109/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><ul class="a"><li class="b"><i class="c">1</i></li><li class="b"><i class="c">2</i></li><li class="b"><i class="c">3</i></li></ul></body></html>
H
  printf '.a > .b:nth-last-child(n + 3) .c, .a > .b:nth-last-child(n + 3) .c::after {color:red}\n.z{color:blue}\n' > "$T/v109/src/s.css"
  db=$(build v109) && {
    eq "V1-09 three selector rows (two from the list, .z)" "$(sqlite3 "$db" "SELECT count(*) FROM web_selectors")" "3"
    eq "V1-09 n + 3 from the end matches the first li's .c only" \
      "$(sqlite3 "$db" "SELECT count(*) FROM web_styles w JOIN web_selectors s ON s.uid = w.selector_uid WHERE s.selector_text = '.a > .b:nth-last-child(n + 3) .c' AND w.status = 'match'")" "1"
  }
fi

if want V1-10; then
  # an IE filter value with `,Name=` keeps its closing parenthesis
  put "$T/v110/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><p class="s">x</p></body></html>
H
  printf ".s {\n  background-repeat: repeat-x;\n  filter: progid:DXImageTransform.Microsoft.gradient(startColorstr='#DFDFDF', endColorstr='#BEBEBE',GradientType=0);\n}\n" > "$T/v110/src/s.css"
  db=$(build v110) && eq "V1-10 filter value ends with )" \
    "$(sqlite3 "$db" "SELECT value_text FROM web_declarations WHERE property = 'filter'")" "progid:DXImageTransform.Microsoft.gradient(startColorstr='#DFDFDF', endColorstr='#BEBEBE',GradientType=0)"
fi

if want V1-15; then
  # a vendor animation-name is a KEYFRAMES reference in the IR itself (not only the engine's G10 fallback)
  put "$T/v115/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><p class="k">x</p></body></html>
H
  printf '@keyframes spin{to{opacity:0}}\n.k{-webkit-animation-name: spin; -moz-animation: spin 1s}\n' > "$T/v115/src/s.css"
  db=$(build v115) && {
    eq "V1-15 two KEYFRAMES refs read by the parser" \
      "$(sqlite3 "$db" "SELECT count(*) FROM web_value_refs WHERE reference_kind = 'KEYFRAMES' AND name = 'spin' AND uid NOT LIKE '%\_G10\_%' ESCAPE '\'")" "2"
    eq "V1-15 both reach the @keyframes" "$(sqlite3 "$db" "SELECT count(*) FROM web_keyframes_use WHERE status = 'match'")" "2"
  }
fi

if want V1-17; then
  # a view-transition pseudo-element with a * argument has specificity 0; with a name it is 0,0,1
  put "$T/v117/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><p>x</p></body></html>
H
  printf '::view-transition-group(*){animation-duration:1s}\n::view-transition-old(hero){animation-duration:1s}\n' > "$T/v117/src/s.css"
  db=$(build v117) && eq "V1-17 specificity (*)=0,0,0 and (hero)=0,0,1" \
    "$(sqlite3 "$db" "SELECT group_concat(x, ' ') FROM (SELECT selector_text || '=' || spec_a || ',' || spec_b || ',' || spec_c AS x FROM web_selectors ORDER BY line)")" \
    "::view-transition-group(*)=0,0,0 ::view-transition-old(hero)=0,0,1"
fi

if want V1-18; then
  # an empty page is a skipped row, never a silent absence
  mkdir -p "$T/v118/src"; : > "$T/v118/src/empty.html"; echo '<!doctype html><p>s</p>' > "$T/v118/src/index.html"
  db=$(build v118) && eq "V1-18 empty page is in skipped" "$(sqlite3 "$db" "SELECT file_path || ':' || reason FROM skipped")" "empty.html:EMPTY_CONTENT"
fi

if want V1-19; then
  # a start tag the browser ignores is not an element: a nested <form>, a second <body>; their children stay, lifted
  put "$T/v119/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body>
<form id="outer"><div class="d"><form class="x"><input class="i"></form></div></form>
<body class="late"><p class="p">x</p></body>
</body></html>
H
  printf 'form{color:red}\n.x{color:blue}\n.late{color:green}\n' > "$T/v119/src/s.css"
  db=$(build v119) && {
    eq "V1-19 one form, one body" "$(sqlite3 "$db" "SELECT group_concat(tag || '=' || n, ' ') FROM (SELECT tag_name AS tag, count(*) AS n FROM web_elements WHERE tag_name IN ('form', 'body') GROUP BY 1 ORDER BY 1)")" "body=1 form=1"
    eq "V1-19 input lifted into the div; p into the body" \
      "$(sqlite3 "$db" "SELECT group_concat(c.tag_name || '<' || p.tag_name, ' ') FROM web_elements c JOIN web_elements p ON p.uid = c.parent_uid WHERE c.tag_name IN ('input', 'p') ORDER BY c.line")" "input<div p<body"
    # the second body's class is added to the open body (it had none), as a browser does; the nested form's is dropped
    eq "V1-19 form{} styles one element; .late the body; .x none" \
      "$(sqlite3 "$db" "SELECT group_concat(t || '=' || n, ' ') FROM (SELECT s.selector_text AS t, count(w.element_uid) AS n FROM web_selectors s LEFT JOIN web_styles w ON w.selector_uid = s.uid AND w.status = 'match' GROUP BY 1 ORDER BY 1)")" ".late=1 .x=0 form=1"
  }
fi

if want C-01; then
  # a `<` that opens no tag is text: code shown in a page must not become an element that swallows the next real tag
  put "$T/c01/src/index.html" <<'H'
<!doctype html>
<html><head><link rel="stylesheet" href="s.css"></head><body>
<p>Example:</p>
{% highlight js %}
for (var v = 0; v < cur.length; v++) {
  data.push({ id: cur[v] });
}
$("#s").select2({ x: 1 });
{% endhighlight %}
<p class="a">one</p>
<p class="b">two</p>
</body></html>
H
  printf '.a{color:red}\n' > "$T/c01/src/s.css"
  db=$(build c01) && {
    eq "C-01 elements are the written ones only" "$(sqlite3 "$db" "SELECT group_concat(tag_name, ',') FROM (SELECT tag_name FROM web_elements ORDER BY line, col)")" "html,head,link,body,p,p,p"
    eq "C-01 .a styles the real p.a" "$(sqlite3 "$db" "SELECT group_concat(e.tag_name || ':' || e.line) FROM web_styles w JOIN web_elements e ON e.uid = w.element_uid")" "p:10"
  }
fi

if want C-02; then
  # markup inside <xmp> and <textarea> is shown, not built; inside <pre> a second <html>/<head>/<body> is ignored
  put "$T/c02/src/index.html" <<'H'
<!doctype html>
<html><head><link rel="stylesheet" href="s.css"></head><body>
<xmp><div class="x">shown</div></xmp>
<textarea><div class="x">shown</div></textarea>
<pre><!DOCTYPE html><html><head></head><body><div class="x">built</div></body></html></pre>
</body></html>
H
  printf '.x{color:red}\n' > "$T/c02/src/s.css"
  db=$(build c02) && {
    eq "C-02 only the div inside <pre> is an element (.x styles one)" "$(sqlite3 "$db" "SELECT count(*) || ':' || group_concat(p.tag_name) FROM web_styles w JOIN web_elements e ON e.uid = w.element_uid JOIN web_elements p ON p.uid = e.parent_uid")" "1:pre"
    eq "C-02 one html, one head, one body" "$(sqlite3 "$db" "SELECT group_concat(tag_name || '=' || n) FROM (SELECT tag_name, count(*) n FROM web_elements WHERE tag_name IN ('html', 'head', 'body') GROUP BY 1 ORDER BY 1)")" "body=1,head=1,html=1"
  }
fi

if want C-03; then
  # nested <a> are two siblings; an element written after </body> ends the body
  put "$T/c03/src/index.html" <<'H'
<!doctype html>
<html><head><link rel="stylesheet" href="s.css"></head><body>
<a href="#a" class="out"><a href="#b" class="in">x</a></a>
<div class="card">c</div>
</body>
<script>late();</script>
</html>
H
  printf 'a a{color:red}\n.out + .in{color:blue}\nbody > script{display:none}\n' > "$T/c03/src/s.css"
  db=$(build c03) && {
    eq "C-03 a.in follows a.out; the script is the body's last child" \
      "$(sqlite3 "$db" "SELECT group_concat(e.display || '<' || p.tag_name || '@' || e.position, ' ') FROM web_elements e JOIN web_elements p ON p.uid = e.parent_uid WHERE p.tag_name = 'body' ORDER BY e.position")" \
      "a.out<body@0 a.in<body@1 div.card<body@2 script<body@3"
    eq "C-03 styles: .out + .in and body > script match, a a does not" \
      "$(sqlite3 "$db" "SELECT group_concat(x, ' ') FROM (SELECT s.selector_text || '=' || count(w.element_uid) x FROM web_selectors s LEFT JOIN web_styles w ON w.selector_uid = s.uid AND w.status = 'match' GROUP BY s.uid ORDER BY 1)")" \
      ".out + .in=1 a a=0 body > script=1"
  }
fi

if want C-05; then
  # disk cost: uids carry 16 hex digits (every reference equal to its target), and the big tables carry no index nothing
  # queries by; the composite (page, element) and (selector, page) indexes stay
  put "$T/c05/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><p class="a"><b class="a">x</b></p></body></html>
H
  printf '.a{color:red}\np .a{color:blue}\n' > "$T/c05/src/s.css"
  db=$(build c05) && {
    eq "C-05 element uids are prefix + 16 hex (>= 1 row)" "$(sqlite3 "$db" "SELECT count(*) >= 1 AND sum(uid GLOB 'HTML_ELEMENT_????????????????' AND length(uid) = 29) = count(*) FROM web_elements")" "1"
    eq "C-05 every styles row's element_uid names an element" "$(sqlite3 "$db" "SELECT count(*) >= 1 AND sum(e.uid IS NOT NULL) = count(*) FROM web_styles w LEFT JOIN web_elements e ON e.uid = w.element_uid")" "1"
    eq "C-05 the indexes on web_styles / web_computed / web_selector_parts" \
      "$(sqlite3 "$db" "SELECT group_concat(name, ' ') FROM (SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('web_styles', 'web_computed', 'web_selector_parts') ORDER BY name)")" \
      "idx_web_computed_element_uid idx_web_selector_parts_name idx_web_selector_parts_selector_uid idx_web_styles_element_uid idx_web_styles_page_element idx_web_styles_rule_uid idx_web_styles_selector_page"
  }
fi

echo "web violation checks: $pass passed, $fail failed"
[ "$fail" -eq 0 ] && [ "$pass" -ge 1 ]
