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
  # V2-22 grain (ruling): one row per (selector, element, page); the later load's sheet_order, every load in `loads`
  db=$(build v107) && eq "V1-07/V2-22 one styles row, sheet_order 3, loads 1,3" \
    "$(sqlite3 "$db" "SELECT group_concat(w.sheet_order || '/' || w.loads) FROM web_styles w JOIN web_stylesheets s ON s.uid = w.stylesheet_uid WHERE s.file = 'a.css'")" "3/1,3"
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
  # queries by; web_styles keeps element, rule and selector lookups
  put "$T/c05/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><p class="a"><b class="a">x</b></p></body></html>
H
  printf '.a{color:red}\np .a{color:blue}\n' > "$T/c05/src/s.css"
  db=$(build c05) && {
    eq "C-05 element uids are prefix + 16 hex (>= 1 row)" "$(sqlite3 "$db" "SELECT count(*) >= 1 AND sum(uid GLOB 'HTML_ELEMENT_????????????????' AND length(uid) = 29) = count(*) FROM web_elements")" "1"
    eq "C-05 every styles row's element_uid names an element" "$(sqlite3 "$db" "SELECT count(*) >= 1 AND sum(e.uid IS NOT NULL) = count(*) FROM web_styles w LEFT JOIN web_elements e ON e.uid = w.element_uid")" "1"
    eq "C-05 the indexes on web_styles / web_computed / web_selector_parts" \
      "$(sqlite3 "$db" "SELECT group_concat(name, ' ') FROM (SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('web_styles', 'web_computed', 'web_selector_parts') ORDER BY name)")" \
      "idx_web_computed_element_uid idx_web_selector_parts_name idx_web_selector_parts_selector_uid idx_web_styles_element_uid idx_web_styles_rule_uid idx_web_styles_selector"
  }
fi

if want V2-02; then
  # a style attribute is a contender: with no rule matching, the inline declaration wins (a page and an unhosted fragment)
  put "$T/v202/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><div style="max-height: 16rem" class="o">x</div></body></html>
H
  printf '<div style="max-height: 8rem" class="o">x</div>\n' > "$T/v202/src/frag.html"
  printf '.other{color:red}\n' > "$T/v202/src/s.css"
  db=$(build v202) && eq "V2-02 one inline winner per page (page and fragment)" \
    "$(sqlite3 "$db" "SELECT group_concat(x, ' ') FROM (SELECT p.file || ':' || c.property || '=' || c.value_text || '/' || c.winner_origin AS x FROM web_computed c JOIN web_pages p ON p.uid = c.page_uid ORDER BY 1)")" \
    "frag.html:max-height=8rem/inline index.html:max-height=16rem/inline"
fi

if want V2-14; then
  # a named <article> is listed as a region, as a named <section> is (SPEC 9.7)
  put "$T/v214/src/index.html" <<'H'
<!doctype html><html><body><article aria-labelledby="t"><h2 id="t">News</h2></article><article><p>x</p></article></body></html>
H
  db=$(build v214) && eq "V2-14 outline names: region for the named article, article for the other" \
    "$(sqlite3 "$db" "SELECT group_concat(name, ',') FROM (SELECT o.name FROM web_outline o WHERE o.kind = 'landmark' ORDER BY o.ordinal)")" "region,article"
fi

if want V2-16; then
  # a var() whose name nothing defines (set by script) still has a scope row: unknown no_definition_in_scope
  put "$T/v216/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><div class="progress">x</div></body></html>
H
  printf '.progress{width:calc(var(--container-width) * 1)}\n' > "$T/v216/src/s.css"
  db=$(build v216) && eq "V2-16 one scope row, unknown no_definition_in_scope" \
    "$(sqlite3 "$db" "SELECT group_concat(name || ':' || status || ':' || reason) FROM web_var_scope")" "--container-width:unknown:no_definition_in_scope"
fi

if want V2-17; then
  # a whitespace-only content is no icon; an icon's font comes from its rule or a class EVERY carrier has
  put "$T/v217/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><div class="clearfix">c</div>
<i class="glyphicon fa fa-calendar"></i><i class="fa fa-calendar"></i></body></html>
H
  put "$T/v217/src/s.css" <<'C'
.clearfix:before{content:" ";display:table}
.fa-calendar:before{content:"\f073"}
.glyphicon{font-family:"Glyphicons Halflings"}
.fa{font-family:"Font Awesome"}
C
  db=$(build v217) && eq "V2-17 icon classes: fa-calendar only, font from the class every carrier has" \
    "$(sqlite3 "$db" "SELECT group_concat(class_name || '=' || coalesce(font_family, '-')) FROM web_icon_classes")" 'fa-calendar="Font Awesome"'
fi

if want V2-18; then
  # a lone CR is a line break (HTML preprocessing): the element after \r\r\n is on line 4
  mkdir -p "$T/v218/src"; printf '<!doctype html>\r\n<html><body>\r\r\n<p class="late">x</p></body></html>\r\n' > "$T/v218/src/index.html"
  db=$(build v218) && eq "V2-18 p.late on line 4" "$(sqlite3 "$db" "SELECT line FROM web_elements WHERE tag_name = 'p'")" "4"
fi

if want V2-19; then
  # a selector under an at-rule the matcher does not take, in a sheet no page loads, is not_loaded
  put "$T/v219/src/index.html" <<'H'
<!doctype html><html><body><p>x</p></body></html>
H
  printf '@utility no-scrollbar { &::-webkit-scrollbar { display: none } }\n.u{color:red}\n' > "$T/v219/src/unused.css"
  db=$(build v219) && eq "V2-19 every selector of the unloaded sheet is not_loaded" \
    "$(sqlite3 "$db" "SELECT count(*) >= 2 AND sum(usage = 'not_loaded') = count(*) FROM web_selectors")" "1"
fi

if want V2-12; then
  # no 1,024-character cap: a long selector list and a multi-line value are kept in full, whitespace as written, with
  # their sizes; only past 64 KiB is a value cut, and that is a listed LIMIT row
  mkdir -p "$T/v212/src"
  echo '<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><p class="s1">x</p></body></html>' > "$T/v212/src/index.html"
  python3 - "$T/v212/src/s.css" <<'PY'
import sys
sels = ', '.join(f'.s{i}' for i in range(1, 400))
big = 'a' * 70000
open(sys.argv[1], 'w').write(sels + ' { color: red }\n.f { filter: progid:X.Y(\n\t M11=1, M12=0) }\n.b { background-image: url("data:,' + big + '") }\n')
PY
  db=$(build v212) && {
    eq "V2-12 the prelude is kept in full (> 1,024 characters)" "$(sqlite3 "$db" "SELECT length(prelude_text) = prelude_bytes AND prelude_bytes > 2000 AND prelude_truncated = 0 FROM web_rules WHERE prelude_text LIKE '.s1,%'")" "1"
    eq "V2-12 a multi-line value keeps its line break" "$(sqlite3 "$db" "SELECT instr(value_text, char(10)) > 0 FROM web_declarations WHERE property = 'filter'")" "1"
    eq "V2-12 a value over 64 KiB is cut and listed" "$(sqlite3 "$db" "SELECT d.value_truncated || ':' || (d.value_bytes > 65536) || ':' || count(u.node_uid) FROM web_declarations d LEFT JOIN web_unknown u ON u.node_uid = d.uid AND u.kind = 'limit' AND u.reason = 'value_truncated' WHERE d.property = 'background-image'")" "1:1:1"
  }
fi

if want V2-13; then
  # contenders = every applying DECLARATION of the property, the winner included (one declaration reached through two
  # selectors counts once); conditional_overrides = the conditional ones among them, also those ranked BELOW the winner
  put "$T/v213/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><button id="b" class="ui-button">b</button></body></html>
H
  printf '.ui-button:focus { background: #aaa }\n.ui-state-hover, .ui-button:hover, .ui-button { background: #ccc }\n#b.ui-button { background: #ddd }\n' > "$T/v213/src/s.css"
  db=$(build v213) && eq "V2-13 background: 3 declarations, 1 conditional (below the winner)" \
    "$(sqlite3 "$db" "SELECT contenders || '/' || conditional_overrides || '/' || value_text FROM web_computed WHERE property = 'background'")" "3/1/#ddd"
fi

if want V3-01; then
  # a root-relative URL resolves against the NEAREST ancestor of the page that holds the path, the root last; `/` from
  # a page in src/ is src/index.html when src/ holds one
  put "$T/v301/src/public/a.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="/css/x.css"></head><body><p class="x">x</p><a href="/">home</a></body></html>
H
  printf '.x { color: red }\n' | put "$T/v301/src/public/css/x.css"
  printf '.x { color: blue }\n' | put "$T/v301/src/css/x.css"
  echo '<!doctype html><title>root</title>' > "$T/v301/src/index.html"
  echo '<!doctype html><title>public</title>' > "$T/v301/src/public/index.html"
  db=$(build v301) && {
    eq "V3-01 /css/x.css from public/a.html loads public/css/x.css" "$(sqlite3 "$db" "SELECT group_concat(s.file) FROM web_styles w JOIN web_stylesheets s ON s.uid = w.stylesheet_uid JOIN web_pages p ON p.uid = w.page_uid WHERE p.file = 'public/a.html'")" "public/css/x.css"
    eq "V3-01 href=/ links to public/index.html" "$(sqlite3 "$db" "SELECT group_concat(coalesce(t.file, l.status || ':' || l.reason)) FROM web_links l LEFT JOIN web_pages t ON t.uid = l.to_page_uid WHERE l.url_as_written = '/'")" "public/index.html"
  }
fi

if want V3-02; then
  # a URL naming a directory resolves to its index file in web_references.resolved_file too (index.html, index.htm,
  # index.shtml, default.htm, in that order)
  put "$T/v302/src/a.html" <<'H'
<!doctype html><html><body><a href="/firefox/">f</a><a href="docs/">d</a><a href="old/">o</a></body></html>
H
  echo '<!doctype html><p>f</p>' | put "$T/v302/src/firefox/index.html"
  echo '<!doctype html><p>d</p>' | put "$T/v302/src/docs/index.htm"
  echo '<!doctype html><p>d2</p>' | put "$T/v302/src/docs/default.htm"
  echo '<!doctype html><p>o</p>' | put "$T/v302/src/old/index.shtml"
  db=$(build v302) && {
    eq "V3-02 directory URLs resolve to index files in resolved_file" "$(sqlite3 "$db" "SELECT group_concat(url_as_written || '=' || coalesce(resolved_file, '-'), ' ') FROM (SELECT * FROM web_references WHERE reference_kind = 'ANCHOR' ORDER BY line, col)")" "/firefox/=firefox/index.html docs/=docs/index.htm old/=old/index.shtml"
    eq "V3-02 and links_to agrees" "$(sqlite3 "$db" "SELECT group_concat(t.file, ' ') FROM (SELECT * FROM web_links ORDER BY rowid) l JOIN web_pages t ON t.uid = l.to_page_uid")" "firefox/index.html docs/index.htm old/index.shtml"
  }
fi

if want V3-03; then
  # a Jinja directive inside {# #}, {% comment %} or an HTML comment includes nothing; an uncommented one still does
  put "$T/v303/src/templates/child.html" <<'H'
{% comment %} {% extends 'base.html' %} {% endcomment %}
{# {% include 'nav.html' %} #}
<!-- {% include 'foot.html' %} -->
{% block content %}<link rel=stylesheet href=/s.css><p class=x>x</p>{% include 'real.html' %}{% endblock %}
H
  echo '<!doctype html><html><body>{% block content %}{% endblock %}</body></html>' > "$T/v303/src/templates/base.html"
  for f in nav foot real; do echo "<div class=\"$f\">$f</div>" > "$T/v303/src/templates/$f.html"; done
  printf '.x { color: red }\n' > "$T/v303/src/s.css"
  db=$(build v303) && {
    eq "V3-03 only the uncommented include is a reference" "$(sqlite3 "$db" "SELECT group_concat(attribute_name || ' ' || url_as_written) FROM web_references WHERE reference_kind = 'INCLUDE'")" "jinja:include real.html"
    eq "V3-03 no extends composition" "$(sqlite3 "$db" "SELECT count(*) || ':' || sum(kind = 'jinja:include') FROM web_includes")" "1:1"
  }
fi

if want V3-10; then
  # (a) attribute values as the DOM reads them, value_raw as written when they differ; a script body verbatim
  # (b) an SSI directive is no template expression: #include is an INCLUDE reference, #set/#echo/#if are ssi rows
  put "$T/v310/src/index.shtml" <<'H'
<!doctype html><html><body>
<script src="t.js?form=a&amp;lang=b"></script>
<a href="#" onclick="go('a&amp;b')">x</a><a href="javascript:f('&lt;')">y</a>
<script>if (a &amp;&amp; b) {}</script>
<div><!--#set var="x" value="1" --><!--#echo var="x" --><!--#if expr="$x" --><!--#endif --><!--#include virtual="/inc.html" --></div>
</body></html>
H
  echo '<p>inc</p>' > "$T/v310/src/inc.html"; echo '' > "$T/v310/src/t.js"
  db=$(build v310) && {
    eq "V3-10a script attributes decoded, attributes_raw as written" "$(sqlite3 "$db" "SELECT json_extract(attributes, '$.src') || ' | ' || json_extract(attributes_raw, '$.src') FROM web_scripts WHERE script_kind = 'EXTERNAL'")" "t.js?form=a&lang=b | t.js?form=a&amp;lang=b"
    eq "V3-10a an attribute that decodes the same has no value_raw" "$(sqlite3 "$db" "SELECT count(*) FROM web_attributes WHERE name = 'href' AND value = '#' AND value_raw IS NULL")" "1"
    eq "V3-10a handler code decoded, code_raw as written" "$(sqlite3 "$db" "SELECT group_concat(code || ' | ' || code_raw, ' ; ') FROM (SELECT * FROM web_handler ORDER BY handler_index)")" "go('a&b') | go('a&amp;b') ; f('<') | f('&lt;')"
    eq "V3-10a an inline script body is verbatim" "$(sqlite3 "$db" "SELECT body FROM web_scripts WHERE script_kind = 'INLINE'")" "if (a &amp;&amp; b) {}"
    eq "V3-10b no SSI template expressions" "$(sqlite3 "$db" "SELECT count(*) FROM web_template_exprs")" "0"
    eq "V3-10b ssi directives" "$(sqlite3 "$db" "SELECT group_concat(directive, ',') FROM (SELECT * FROM web_ssi_directives ORDER BY line, col)")" "set,echo,if,endif"
    eq "V3-10b #include is an include" "$(sqlite3 "$db" "SELECT kind || ':' || status FROM web_includes")" "ssi:virtual:match"
  }
fi

if want V3-11; then
  # template text before the doctype: a page when it writes <html> or a doctype anywhere, else a fragment
  put "$T/v311/src/templates/page.html" <<'H'
{% load static %}
{% load i18n %}
<!DOCTYPE html>
<html><head><title>t</title></head><body><p>x</p></body></html>
H
  printf '{%% load i18n %%}\n<div class="card">c</div>\n' > "$T/v311/src/templates/part.html"
  db=$(build v311) && eq "V3-11 page kinds" "$(sqlite3 "$db" "SELECT group_concat(file || '=' || document_kind, ' ') FROM (SELECT * FROM web_pages ORDER BY file)")" "templates/page.html=DOCUMENT templates/part.html=FRAGMENT"
fi

if want V3-05; then
  # a composed fragment element that no rule matches keeps its style attribute's computed rows, per host
  put "$T/v305/src/page.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><include src="partials/menu.html"></include></body></html>
H
  printf '<div style="max-height: 16rem">m</div>\n' | put "$T/v305/src/partials/menu.html"
  printf '.other { color: red }\n' > "$T/v305/src/s.css"
  db=$(build v305) && eq "V3-05 inline-only fragment element has a computed row with its host" \
    "$(sqlite3 "$db" "SELECT c.property || '=' || c.value_text || ' ' || c.winner_origin || ' host ' || h.file FROM web_computed c JOIN web_pages h ON h.uid = c.host_page_uid WHERE c.property = 'max-height'")" "max-height=16rem inline host page.html"
fi

if want V3-07; then
  # an include outside any element: the occurrence names the host's root element, at_top_level = 1
  put "$T/v307/src/templates/a.html" <<'H'
{% load i18n %}
{% include 'tags.html' %}
<div class="a">a</div>
H
  sed 's/class="a"/class="b"/' "$T/v307/src/templates/a.html" | put "$T/v307/src/templates/b.html"
  echo '<span class="t">t</span>' | put "$T/v307/src/templates/tags.html"
  db=$(build v307) && eq "V3-07 top-level include occurrences name a root element" \
    "$(sqlite3 "$db" "SELECT count(*) || ':' || sum(o.element_uid IS NOT NULL) || ':' || sum(o.at_top_level) FROM web_component_occurrences o JOIN web_components c ON c.uid = o.component_uid WHERE c.level = 'include'")" "2:2:2"
fi

if want V3-08; then
  # (a) markup inside <iframe> is inert text: no links_to row
  put "$T/v308/src/index.html" <<'H'
<!doctype html><html><head><title>t</title>
<<<<<<< HEAD
<link rel="stylesheet" href="s.css">
</head>
<body class="nav-md"><iframe src="x.html"><a href="/slides/a.htm">link</a></iframe><p class="p">p</p></body></html>
H
  echo '<!doctype html><p>x</p>' > "$T/v308/src/x.html"; mkdir -p "$T/v308/src/slides"; echo '<p>a</p>' > "$T/v308/src/slides/a.htm"
  printf '.nav-md { color: red }\n' > "$T/v308/src/s.css"
  # (b) control: template tags in the head are not text, so this page keeps its written body
  printf '<!doctype html><html><head><title>t</title>{%% block css %%}{%% endblock %%}<link rel="stylesheet" href="s.css"></head>\n<body class="nav-md"><p class="q">q</p></body></html>\n' > "$T/v308/src/t.html"
  db=$(build v308) && {
    eq "V3-08a no link from iframe text" "$(sqlite3 "$db" "SELECT count(*) FROM web_links WHERE url_as_written = '/slides/a.htm'")" "0"
    eq "V3-08b text in the head implies the body: the written <body> is no element, its children and the head's rest are html's" \
      "$(sqlite3 "$db" "SELECT group_concat(e.tag_name || '<' || coalesce(pe.tag_name, '-'), ' ') FROM (SELECT * FROM web_elements ORDER BY line, col) e JOIN web_pages p ON p.uid = e.page_uid LEFT JOIN web_elements pe ON pe.uid = e.parent_uid WHERE p.file = 'index.html'")" \
      "html<- head<html title<head link<html iframe<html a<iframe p<html"
    eq "V3-08b and the written body's class styles nothing there; the control page's body keeps it" \
      "$(sqlite3 "$db" "SELECT group_concat(p.file || ':' || e.tag_name) FROM web_styles w JOIN web_selectors s ON s.uid = w.selector_uid JOIN web_elements e ON e.uid = w.element_uid JOIN web_pages p ON p.uid = w.page_uid WHERE s.selector_text = '.nav-md' AND w.status = 'match'")" \
      "t.html:body"
  }
fi

if want V3-09; then
  # shadows keep their value as written (two spellings, two tokens); a .min.css is vendor for project_uses even with no
  # twin (D3); a hex colour inside a quoted IE filter string is a colour token
  put "$T/v309/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="a.css"><link rel="stylesheet" href="b.min.css"></head><body><p class="a b">x</p></body></html>
H
  printf ".a { box-shadow: 0 -1px 0 rgba(0,0,0,.25); color: #000 }\n.f { filter: progid:DXImageTransform.Microsoft.gradient(startColorstr='#ff449d44', GradientType=0) }\n" > "$T/v309/src/a.css"
  printf '.b { box-shadow: 0 -1px 0 rgba(0, 0, 0, .25); color: #000000 }\n' > "$T/v309/src/b.min.css"
  db=$(build v309) && {
    eq "V3-09 two shadow spellings, two tokens" "$(sqlite3 "$db" "SELECT group_concat(value, ' | ') FROM (SELECT value FROM web_tokens WHERE kind = 'shadow' ORDER BY value)")" "0 -1px 0 rgba(0, 0, 0, .25) | 0 -1px 0 rgba(0,0,0,.25)"
    eq "V3-09 #000000: 2 uses, 1 outside vendor sheets" "$(sqlite3 "$db" "SELECT uses || '/' || project_uses FROM web_tokens WHERE kind = 'color' AND value = '#000000'")" "2/1"
    eq "V3-09 a hex in a quoted filter string is a colour" "$(sqlite3 "$db" "SELECT count(*) FROM web_tokens WHERE kind = 'color' AND value = '#ff449d44'")" "1"
  }
fi

echo "web violation checks: $pass passed, $fail failed"
[ "$fail" -eq 0 ] && [ "$pass" -ge 1 ]
