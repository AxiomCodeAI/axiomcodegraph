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
  if ! bash "$ROOT/bin/axiomcode" "$d/src" "$d/out" --language web >"$d/build.log" 2>&1; then echo "BUILD FAILED: $1" >&2; tail -5 "$d/build.log" >&2; echo "$1" >> "$T/.build_failures"; return 1; fi
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
  # a template tag inside a <style> declaration value keeps the rule whole (a browser reads the braces as a block of
  # the value); a {% comment %} block in it is stripped by the template engine; a rule inside {% if %} is live
  put "$T/v303c/src/page.html" <<'H'
<!doctype html><html><head><style>
.a { background-color: {{ theme.p|default:"#E54F38" }}; }
.c { color: {{ x }} !important; border: 1px solid {{ y|default:"#fff" }}; }
{% comment %} .dead { color: red } {% endcomment %}
{% if z %}.d { color: blue }{% endif %}
.e { color: green }
</style></head><body><p class="a c d e dead">x</p></body></html>
H
  db=$(build v303c) && {
    eq "V3-03 rules after a template tag in a <style> value keep their selectors" "$(sqlite3 "$db" "SELECT group_concat(selector_text, ' ') FROM (SELECT selector_text FROM web_selectors ORDER BY line, col)")" ".a .c .d .e"
    eq "V3-03 and their declarations, values as written" "$(sqlite3 "$db" "SELECT group_concat(property || '=' || value_text, ' | ') FROM (SELECT * FROM web_declarations WHERE rule_uid IS NOT NULL ORDER BY line, col)")" 'background-color={{ theme.p|default:"#E54F38" }} | color={{ x }} | border=1px solid {{ y|default:"#fff" }} | color=blue | color=green'
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

# ── review 1 (R1-<n>: finding n) ──
# computed value of a property for the element with this id (or class) on a page: value/status[/reason]
cv(){ local why="''"; [ "$(sqlite3 "$1" "SELECT count(*) FROM pragma_table_info('web_computed') WHERE name = 'unknown_reason'")" = 1 ] && why="coalesce('/' || c.unknown_reason, '')"
  sqlite3 "$1" "SELECT group_concat(c.value_text || '/' || c.winner_status || $why, ' ') FROM web_computed c JOIN web_elements e ON e.uid = c.element_uid JOIN web_pages p ON p.uid = c.page_uid WHERE p.file = '$2' AND (e.html_id = '$3' OR ' ' || e.class_names || ' ' LIKE '% $3 %') AND c.property = '$4' AND c.pseudo IS NULL"; }
if want R1-02; then
  # an undecidable contender (:root where <html> is implied) that would outrank the winner leaves it unknown, never a match
  printf '<!doctype html><title>t</title><link rel="stylesheet" href="s.css"><p class="btn">x</p>\n' | put "$T/r102/src/implied.html"
  printf '<!doctype html><html><head><title>t</title><link rel="stylesheet" href="s.css"></head><body><p class="btn">x</p></body></html>\n' | put "$T/r102/src/written.html"
  printf '.btn { color: red }\n:root .btn { color: blue }\n.btn { margin: 0 }\n' > "$T/r102/src/s.css"
  db=$(build r102) && {
    eq "R1-02 implied <html>: :root .btn would outrank .btn, so the winner is unknown" "$(cv "$db" implied.html btn color)" "red/unknown/undecidable_contender:implied_element"
    eq "R1-02 control: a property no undecidable rule sets stays a match" "$(cv "$db" implied.html btn margin)" "0/match"
    eq "R1-02 control: with <html> written, :root .btn matches and wins" "$(cv "$db" written.html btn color)" "blue/match"
  }
fi
if want R1-03; then
  # each anonymous @import layer is its own layer: the later one wins over specificity
  put "$T/r103/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="m.css"></head><body><p id="x" class="y">x</p></body></html>
H
  printf '@import url(a.css) layer;\n@import url(b.css) layer;\n' > "$T/r103/src/m.css"; printf '#x { color: red }\n' > "$T/r103/src/a.css"; printf '.y { color: blue }\n' > "$T/r103/src/b.css"
  db=$(build r103) && eq "R1-03 two anonymous import layers: the later layer wins" "$(cv "$db" index.html x color)" "blue/match"
fi
if want R1-04; then
  # @scope proximity: equal specificity, the nearer scope root wins whatever the order
  put "$T/r104/src/index.html" <<'H'
<!doctype html><html><head><style>@scope (.light) { p { color: black } } @scope (.dark) { p { color: white } }</style></head>
<body><div class="dark"><div class="light"><p id="near-light">x</p></div></div><div class="light"><div class="dark"><p id="near-dark">y</p></div></div></body></html>
H
  db=$(build r104) && {
    eq "R1-04 the nearer scope root (.light) wins over the later rule" "$(cv "$db" index.html near-light color)" "black/match"
    eq "R1-04 control: the nearer root is .dark, and it wins" "$(cv "$db" index.html near-dark color)" "white/match"
  }
fi
if want R1-05; then
  # a sheet linked inside <noscript> is a conditional load (scripting on: not loaded)
  put "$T/r105/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="main.css"><noscript><link rel="stylesheet" href="noscript.css"></noscript></head><body><div class="box">b</div></body></html>
H
  printf '.box { display: none }\n' > "$T/r105/src/main.css"; printf '.box { display: block }\n' > "$T/r105/src/noscript.css"
  db=$(build r105) && {
    eq "R1-05 the noscript sheet's load is conditional" "$(sqlite3 "$db" "SELECT group_concat(s.file || ':' || l.status || ':' || coalesce(l.reason, '-'), ' ') FROM (SELECT * FROM web_loads ORDER BY load_order) l JOIN web_stylesheets s ON s.uid = l.stylesheet_uid")" "main.css:match:- noscript.css:conditional:inert:noscript"
    eq "R1-05 and the unconditional winner is main.css's" "$(cv "$db" index.html box display)" "none/match"
  }
fi
if want R1-08; then
  # `<div/>` followed at once by a tag: the browser keeps the div open, so the p is its child
  put "$T/r108/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><div class="a"/><p class="b">x</p></body></html>
H
  printf '.a > .b { color: red }\n' > "$T/r108/src/s.css"
  db=$(build r108) && eq "R1-08 .a > .b matches the p after <div class=a/>" "$(cv "$db" index.html b color)" "red/match"
fi

if want R1-06; then
  # `:not(.active)` on an element whose class binding can add .active is undecided, not a match
  put "$T/r106/src/index.html" <<'H'
<!doctype html><html><head><style>.btn:not(.active) { color: gray }</style></head><body><button class="btn" :class="{active: on}" id="bound">a</button><button class="btn" id="plain">b</button></body></html>
H
  db=$(build r106) && {
    eq "R1-06 a binding that can add .active leaves .btn:not(.active) conditional" "$(sqlite3 "$db" "SELECT w.status || ':' || coalesce(w.reason, '-') FROM web_styles w JOIN web_elements e ON e.uid = w.element_uid WHERE e.html_id = 'bound'")" "conditional:dynamic_class"
    eq "R1-06 control: without a binding it is a match" "$(sqlite3 "$db" "SELECT w.status FROM web_styles w JOIN web_elements e ON e.uid = w.element_uid WHERE e.html_id = 'plain'")" "match"
  }
fi
if want R1-07; then
  # var(--gap) in an included fragment inherits from the host's :root, through the include site
  put "$T/r107/src/host.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><!--#include virtual="/card.html" --></body></html>
H
  printf '<p class="card">c</p>\n' > "$T/r107/src/card.html"; printf ':root { --gap: 4px }\n.card { margin: var(--gap) }\n' > "$T/r107/src/s.css"
  db=$(build r107) && eq "R1-07 the fragment's p.card finds --gap at the host's <html>" "$(sqlite3 "$db" "SELECT v.status || ':' || coalesce(r.tag_name, '-') FROM web_var_scope v JOIN web_pages p ON p.uid = v.page_uid LEFT JOIN web_elements r ON r.uid = v.root_uid WHERE p.file = 'card.html' AND v.name = '--gap'")" "match:html"
fi
if want R1-16; then
  # class bindings are read by a lexical scan: nothing in the web engine parses JavaScript (owner ruling)
  eq "R1-16 graph/bundle/web imports no JavaScript or TypeScript parser" "$(grep -l -E "from '(typescript|acorn|@babel/parser|esprima)'" "$ROOT"/graph/bundle/web/*.ts 2>/dev/null | wc -l | tr -d ' ')" "0"
  put "$T/r116/src/index.html" <<'H'
<!doctype html><html><head><style>.on { color: red } .x { color: blue } .lg { color: green }</style></head><body><p id="a" :class="{on: v, 'x': w}">a</p><p id="b" :class="'b-' + size">b</p><p id="c" :class="big ? 'lg' : ''">c</p></body></html>
H
  db=$(build r116) && eq "R1-16 binding tokens: object keys, a conditional's strings, an unknowable concatenation" "$(sqlite3 "$db" "SELECT group_concat(x, ' ') FROM (SELECT e.html_id || '=' || s.selector_text AS x FROM web_styles w JOIN web_elements e ON e.uid = w.element_uid JOIN web_selectors s ON s.uid = w.selector_uid WHERE w.reason LIKE '%dynamic_class%' ORDER BY 1)")" "a=.on a=.x b=.lg b=.on b=.x c=.lg"
fi

if want VIA-; then
  # iter4 rulings: a fragment's <link>/<style> is loaded by each host at the include site (via_include), its relative
  # href resolved against the HOST's location; a fragment loads nothing itself; orphan only when nothing includes it
  put "$T/via/src/a.html" <<'H'
<!doctype html><html><head><include src="parts/w.html"></include><link rel="stylesheet" href="css/page.css"></head><body><p class="w">a</p></body></html>
H
  put "$T/via/src/sub/b.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="../css/page.css"></head><body><include src="../parts/w.html"></include></body></html>
H
  put "$T/via/src/parts/w.html" <<'H'
<link rel="stylesheet" href="css/w.css"><style>.w { margin: 0 }</style><div class="w">w</div><img src="img/a.png" alt="">
H
  printf 'png\n' | put "$T/via/src/img/a.png"
  printf '<link rel="stylesheet" href="../css/old.css"><div>o</div>\n' | put "$T/via/src/parts/unused.html"
  for f in page w old; do printf ".w { color: red }\n" | put "$T/via/src/css/$f.css"; done
  db=$(build via) && {
    eq "VIA-01 each host loads the fragment's sheets at the include site, flagged via_include" \
      "$(sqlite3 "$db" "SELECT group_concat(x, ' ') FROM (SELECT p.file || ':' || coalesce(l.load_order, '-') || ':' || coalesce(s.file, l.status || '/' || coalesce(l.reason, '-')) || ':' || (l.via_include IS NOT NULL) AS x FROM web_loads l JOIN web_pages p ON p.uid = l.page_uid LEFT JOIN web_stylesheets s ON s.uid = l.stylesheet_uid ORDER BY p.file, coalesce(l.load_order, 99), x)")" \
      "a.html:1:css/w.css:1 a.html:2:parts/w.html:1 a.html:3:css/page.css:0 sub/b.html:1:css/page.css:0 sub/b.html:2:parts/w.html:1 sub/b.html:-:unknown/unresolved_url:1"
    eq "VIA-02 a fragment loads nothing itself; a sheet only an unincluded fragment links is an orphan" \
      "$(sqlite3 "$db" "SELECT (SELECT count(*) FROM web_loads l JOIN web_pages p ON p.uid = l.page_uid WHERE p.file LIKE 'parts/%') || ':' || (SELECT group_concat(file) FROM web_unknown WHERE kind = 'orphan_sheet')")" "0:css/old.css"
    eq "VIA-03 a fragment's <img src> resolves against each host: there under a.html, not under sub/b.html" \
      "$(sqlite3 "$db" "SELECT group_concat(x, ' ') FROM (SELECT p.file || ':' || coalesce(r.file, '-') || ':' || r.status AS x FROM web_resources r JOIN web_pages p ON p.uid = r.owner_uid WHERE r.url = 'img/a.png' ORDER BY 1)")" "a.html:img/a.png:match sub/b.html:-:unknown"
  }
fi

if want R1-P3; then
  # review 1, P3 findings
  put "$T/r1p3/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"><link rel="preload" as="style" href="app.css" onload="this.rel='stylesheet'">
<script>var s = "{% include 'x.html' %}";</script></head>
<body><input name="t" value="TOKEN_0123456789abcdef0123456789abcdef"><p id="y" class="x z">p</p>
<plaintext><p class="after">a</p></plaintext><div class="after">d</div></body></html>
H
  printf '<div class="inc">x</div>\n' | put "$T/r1p3/src/x.html"
  printf 'a[href*="/*"] { color: red }\n.b { color: blue }\n/* note */\n.x, #y:hover { color: red }\n.z { color: blue }\n' | put "$T/r1p3/src/s.css"
  printf '.app { color: green }\n' | put "$T/r1p3/src/app.css"
  db=$(build r1p3) && {
    eq "R1-18 a web graph writes no core vocabulary for language web" "$(sqlite3 "$db" "SELECT count(*) FROM schema_vocab WHERE language = 'web'")" "0"
    eq "R1-19 an attribute value shaped like an IR hash is data, written whole" "$(sqlite3 "$db" "SELECT value FROM web_attributes WHERE name = 'value'")" "TOKEN_0123456789abcdef0123456789abcdef"
    eq "R1-21 a /* inside a string opens no comment: the rules after it keep their selectors" "$(sqlite3 "$db" "SELECT group_concat(selector_text, ' ') FROM (SELECT selector_text FROM web_selectors WHERE file = 's.css' ORDER BY line, col)")" 'a[href*="/*"] .b .x #y:hover .z'
    eq "R1-22 an include directive inside <script> is no INCLUDE reference" "$(sqlite3 "$db" "SELECT count(*) FROM web_references WHERE reference_kind = 'INCLUDE'")" "0"
    eq "R1-24 a preload-as-style link is a conditional load" "$(sqlite3 "$db" "SELECT s.file || ':' || l.status || ':' || l.reason FROM web_loads l JOIN web_stylesheets s ON s.uid = l.stylesheet_uid WHERE s.file = 'app.css'")" "app.css:conditional:preload_as_style"
    eq "R1-29 web_cascade keys a rule by its unconditional selector: red loses to .z on source order" "$(sqlite3 "$db" "SELECT group_concat(x, ' ') FROM (SELECT d.value_text || '=' || c.outcome || ':' || coalesce(c.lost_reason, '-') AS x FROM web_cascade c JOIN web_declarations d ON d.uid = c.decl JOIN web_elements e ON e.uid = c.element WHERE e.html_id = 'y' AND c.property = 'color' ORDER BY 1)")" "blue=won:- red=lost:source_order"
    eq "R1-31 nothing after <plaintext> is an element" "$(sqlite3 "$db" "SELECT count(*) FROM web_elements WHERE class_names = 'after'")" "0"
  }
  # R1-23: a links file above the repository (the source has .git) is not read
  mkdir -p "$T/r123/repo/src/.git"
  printf '<!doctype html><html><body><div class="slot">s</div></body></html>\n' | put "$T/r123/repo/src/host.html"
  printf '<p class="card">c</p>\n' | put "$T/r123/repo/src/card.html"
  printf 'repo/src/card.html\trepo/src/host.html\t1\tx\tnow\n' | put "$T/r123/axiomcode-web-links.tsv"
  mv "$T/r123/repo/src" "$T/r123/src"; rmdir "$T/r123/repo"
  printf 'src/card.html\tsrc/host.html\t1\tx\tnow\n' > "$T/axiomcode-web-links.tsv"
  db=$(build r123) && eq "R1-23 a links file above the repository root applies to nothing" "$(sqlite3 "$db" "SELECT count(*) FROM web_includes WHERE kind = 'asserted'")" "0"
  rm -f "$T/axiomcode-web-links.tsv"
  # R1-20: an IR row with the wrong field count is declared, not lost silently
  mkdir -p "$T/r120/src"; printf '<!doctype html><html><body><p class="a">a</p></body></html>\n' > "$T/r120/src/index.html"
  if bash "$ROOT/bin/axiomcode" parser "$T/r120/src" "$T/r120/ir" >"$T/r120/parse.log" 2>&1; then
    ir="$T/r120/ir/web"; f="$ir/all-html-class-references.csv"
    { cat "$f"; tail -1 "$f" | sed 's/$/\textra/'; } > "$f.new" && mv "$f.new" "$f"
    if bash "$ROOT/bin/axiomcode" engine --language web --client-ir "$ir" --out "$T/r120/out" >"$T/r120/engine.log" 2>&1; then
      eq "R1-20 the dropped IR row is a web_unknown ir_row_dropped" "$(sqlite3 "$T/r120/out/web/graph.sqlite" "SELECT kind || ':' || detail FROM web_unknown WHERE kind = 'ir_row_dropped'" 2>/dev/null || sqlite3 "$(find "$T/r120/out" -name graph.sqlite | head -1)" "SELECT kind || ':' || detail FROM web_unknown WHERE kind = 'ir_row_dropped'")" "ir_row_dropped:1 row(s) of all-html-class-references.csv with the wrong field count"
    else fail=$((fail+1)); echo "FAIL R1-20 engine on the edited IR"; tail -5 "$T/r120/engine.log"; fi
  else fail=$((fail+1)); echo "FAIL R1-20 parser"; tail -5 "$T/r120/parse.log"; fi
fi

if want V4-; then
  # iteration 5: the V4 violations
  # V4-02: `<include … />` takes the element's place; what follows it is not inside it, so a later include composes
  put "$T/v402/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><include src="./a.html" />
<main><include src="./frag.html" /></main></body></html>
H
  printf '<p class="a">a</p>\n' | put "$T/v402/src/a.html"
  printf '<div style="max-height:1rem">x</div><p class="x">y</p>\n' | put "$T/v402/src/frag.html"
  printf '.x { color: red }\n' | put "$T/v402/src/s.css"
  db=$(build v402) && {
    eq "V4-02 the second include's fragment is styled in its host" "$(sqlite3 "$db" "SELECT count(*) FROM web_styles w JOIN web_pages p ON p.uid = w.page_uid WHERE p.file = 'frag.html' AND w.host_page_uid IS NOT NULL")" "1"
    eq "V4-02 and its elements have computed rows (V3-05 too)" "$(sqlite3 "$db" "SELECT group_concat(property, ' ') FROM (SELECT c.property FROM web_computed c JOIN web_pages p ON p.uid = c.page_uid WHERE p.file = 'frag.html' AND c.host_page_uid IS NOT NULL ORDER BY 1)")" "color max-height"
  }
  # V4-01: every SSI directive is a row: top of file, several in one attribute, #comment
  put "$T/v401/src/a.shtml" <<'H'
<!--#set var="v" value="1" -->
<html><body><meta content="x <!--#echo var="a" --> y <!--#echo var="b" -->"><!--#comment note --></body></html>
H
  db=$(build v401) && eq "V4-01 four directive rows, in order" "$(sqlite3 "$db" "SELECT group_concat(directive, ',') FROM (SELECT directive FROM web_ssi_directives ORDER BY line, col)")" "set,echo,echo,comment"
  # V4-03: a no-op javascript: link is no handler
  put "$T/v403/src/index.html" <<'H'
<!doctype html><html><body><a href="javascript:;">a</a><a href="javascript:void(0)">b</a><a href="javascript:">c</a><a href="javascript:go()">d</a><button onclick="go()">e</button></body></html>
H
  db=$(build v403) && eq "V4-03 only javascript:go() and the onclick are handlers" "$(sqlite3 "$db" "SELECT group_concat(source_kind || ':' || code, ' ') FROM (SELECT * FROM web_handlers ORDER BY line, col)")" "javascript_url:go() on_attribute:go()"
  # V4-04: a data: URI url() is kept whole in its value_ref
  big=$(printf 'A%.0s' $(seq 1 1500)); pre='data:image/svg+xml;charset=US-ASCII,'
  printf '.i { background: url("%s%s") }\n' "$pre" "$big" | put "$T/v404/src/s.css"
  printf '<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><p class="i">i</p></body></html>\n' | put "$T/v404/src/index.html"
  db=$(build v404) && eq "V4-04 the data: URI name is whole" "$(sqlite3 "$db" "SELECT length(name) FROM web_value_refs WHERE reference_kind = 'URL'")" "$(( ${#pre} + ${#big} ))"
  # V4-05 / V4-06: value_bytes counts value_text exactly; a font name before a comment is a font_family reference
  printf '.n { font-family: Arial/*{ff}*/; left: .6em /*{r}*/; }\n@media screen /* c */ { .m { color: red } }\n' | put "$T/v405/src/s.css"
  printf '<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><p class="n m">n</p></body></html>\n' | put "$T/v405/src/index.html"
  db=$(build v405) && {
    eq "V4-05 value_bytes = bytes of value_text" "$(sqlite3 "$db" "SELECT group_concat(property || '=' || value_text || ':' || value_bytes, ' ') FROM (SELECT * FROM web_declarations WHERE property IN ('font-family', 'left') ORDER BY line, col)")" "font-family=Arial:5 left=.6em:4"
    eq "V4-05 prelude_text is comment-free and prelude_bytes counts it" "$(sqlite3 "$db" "SELECT prelude_text || ':' || prelude_bytes FROM web_rules WHERE at_rule_name = 'media'")" "screen:6"
    eq "V4-06 Arial before a comment is a FONT_FAMILY reference with a font_use row" "$(sqlite3 "$db" "SELECT (SELECT group_concat(name) FROM web_value_refs WHERE reference_kind = 'FONT_FAMILY') || ':' || (SELECT count(*) FROM web_font_use WHERE name = 'Arial')")" "Arial:1"
  }
  # V4-07: a directory named without a slash resolves to its index file, in the reference and in links_to
  put "$T/v407/src/a.html" <<'H'
<!doctype html><html><body><a href="docs">d</a><a href="/about">a</a></body></html>
H
  printf '<p>d</p>\n' | put "$T/v407/src/docs/index.html"; printf '<p>a</p>\n' | put "$T/v407/src/about/index.html"
  db=$(build v407) && eq "V4-07 docs and /about resolve to their index files" "$(sqlite3 "$db" "SELECT group_concat(url_as_written || '=' || coalesce(resolved_file, '-'), ' ') FROM (SELECT * FROM web_references WHERE reference_kind = 'ANCHOR' ORDER BY line, col)")" "docs=docs/index.html /about=about/index.html"
  # V4-08: target/ and env/ are read; node_modules/ is not
  put "$T/v408/src/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="target/css/t.css"><link rel="stylesheet" href="env/css/e.css"><link rel="stylesheet" href="node_modules/x/n.css"></head><body><p class="t e n">p</p></body></html>
H
  for d in target/css/t env/css/e node_modules/x/n; do printf '.p { color: red }\n' | put "$T/v408/src/$d.css"; done
  db=$(build v408) && eq "V4-08 target/ and env/ sheets are indexed and loaded; node_modules/ is not" "$(sqlite3 "$db" "SELECT group_concat(x, ' ') FROM (SELECT coalesce(s.file, l.url_as_written) || ':' || l.status AS x FROM web_loads l LEFT JOIN web_stylesheets s ON s.uid = l.stylesheet_uid ORDER BY coalesce(l.load_order, 99), x)")" "target/css/t.css:match env/css/e.css:match node_modules/x/n.css:unknown"
fi

# review #14: a build that failed is a failed check (its eq lines never ran), not a silently skipped one
if [ -s "$T/.build_failures" ]; then fail=$((fail + $(wc -l < "$T/.build_failures"))); echo "FAIL builds: $(tr '\n' ' ' < "$T/.build_failures")"; fi
echo "web violation checks: $pass passed, $fail failed"
[ "$fail" -eq 0 ] && [ "$pass" -ge 1 ]
