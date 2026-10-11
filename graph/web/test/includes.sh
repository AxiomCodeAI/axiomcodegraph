#!/usr/bin/env bash
# axiom-code-graph — web layer: fragment hosts (SPEC §11.2, G22/G23). One hand-written site holds every include
# flavour the parser reads (SSI virtual and file, posthtml <include src>, gulp @@include, Jinja include / extends /
# import), a cycle, an unresolvable include, a template-expression path, two template roots holding one name, SSI
# set/echo, an Alpine partial whose own markers look like Vue, and an asserted include read from the links file.
# Each check asserts on graph.sqlite and counts >= 1 row, so an absent table or an empty relation fails.
#   bash graph/web/test/includes.sh
set -u
ROOT="${AXIOM_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
T=$(mktemp -d "${TMPDIR:-/tmp}/web-includes.XXXXXX"); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
put(){ mkdir -p "$(dirname "$1")"; cat > "$1"; }
eq(){ if [ "$2" == "$3" ]; then pass=$((pass+1)); echo "ok   $1"; else fail=$((fail+1)); echo "FAIL $1:"; echo "  got:    [$2]"; echo "  wanted: [$3]"; fi; }
S="$T/site"
put "$S/index.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="css/s.css"><title><!--#echo var="title" --></title></head>
<body><!--#set var="title" value="Home" -->
<div class="wrap"><!--#include virtual="/inc/nav.html" --></div>
<include src="partials/side.html"></include>
@@include('./partials/foot.html', {"a": 1})
<p><!--#include virtual="/inc/missing.html" --></p>
<div class="host"><!--#include file="loop1.html" --></div>
<span class="t">{% include partial_name %}</span>
</body></html>
H
echo '<nav class="nav"><a class="lnk" href="#">x</a></nav>' | put "$S/inc/nav.html"
echo '<aside class="side">s</aside>' | put "$S/partials/side.html"
echo '<footer class="foot">f</footer>' | put "$S/partials/foot.html"
echo '<div class="l1"><!--#include file="loop2.html" --></div>' | put "$S/loop1.html"
echo '<div class="l2"><!--#include file="loop1.html" --></div>' | put "$S/loop2.html"
echo '<div class="orphan">o</div>' | put "$S/partials/orphan.html"
echo '<div class="late">l</div>' | put "$S/partials/late.html"
put "$S/app/templates/base.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="/css/s.css"></head><body>
<main class="main">{% block content %}<p class="dflt">d</p>{% endblock %}</main>
{% include "dup.html" %}
</body></html>
H
put "$S/app/templates/child.html" <<'H'
{% extends "base.html" %}
{% from "macros.html" import field %}
{% block content %}<section class="sec">c {% include "parts/card.html" %}</section>{% endblock %}
H
echo '<div class="card">card</div>' | put "$S/app/templates/parts/card.html"
echo '{% macro field(n) %}<input name="{{ n }}">{% endmacro %}' | put "$S/app/templates/macros.html"
echo '<b class="dup1">1</b>' | put "$S/app/templates/dup.html"
echo '<b class="dup2">2</b>' | put "$S/other/templates/dup.html"
put "$S/alp.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="css/s.css"></head><body><div x-data="{open:false}"><include src="partials/overlay.html"></include></div></body></html>
H
put "$S/alp2.html" <<'H'
<!doctype html><html><head><link rel="stylesheet" href="css/s.css"></head><body><div x-data="{open:true}">
  <include src="partials/overlay.html"></include>
  <!-- late content goes here -->
</div></body></html>
H
echo '<div @click="open = false" :class="{x: open}" class="ov">o</div>' | put "$S/partials/overlay.html"
put "$S/css/s.css" <<'H'
.wrap > .nav { color: red }
.nav .lnk { color: blue }
body > .side { color: green }
body > .foot { color: teal }
.main > .sec { color: navy }
.sec > .card { color: gray }
.dflt { color: pink }
.l1 > .l2 { color: olive }
[x-data] > .ov { color: black }
[x-data] > .late { color: white }
H
printf 'partials/late.html\talp2.html\t3\ttest\t-\npartials/nothere.html\talp2.html\t3\ttest\t-\npartials/late.html\talp2.html\t99\ttest\t-\n' > "$S/axiomcode-web-links.tsv"

if ! bash "$ROOT/bin/axiomcode" "$S" "$T/out" --language web > "$T/build.log" 2>&1; then echo "BUILD FAILED"; tail -5 "$T/build.log"; exit 1; fi
db=$(find "$T/out" -name graph.sqlite | head -1)
q(){ sqlite3 "$db" "$1" 2>&1; }
pf(){ echo "(SELECT file FROM web_pages WHERE uid = $1)"; }

eq "web_includes: every flavour, host element and position, status (>= 1 row)" \
  "$(q "SELECT group_concat(x, ' | ') FROM (SELECT kind || ' ' || coalesce($(pf host_page_uid), file) || '>' || coalesce($(pf fragment_page_uid), '-') || ' in ' || coalesce((SELECT tag_name FROM web_elements WHERE uid = host_element_uid), '-') || '@' || coalesce(position, '-') || ' ' || status || coalesce(' ' || reason, '') AS x FROM web_includes ORDER BY 1)")" \
  "asserted alp2.html>- in -@- unknown fragment_not_a_page | asserted alp2.html>partials/late.html in -@- unknown no_such_line | asserted alp2.html>partials/late.html in div@1 asserted | gulp:@@include index.html>partials/foot.html in body@2 match | jinja:extends app/templates/base.html>app/templates/child.html in -@- match | jinja:import app/templates/child.html>app/templates/macros.html in -@0 match | jinja:include app/templates/base.html>app/templates/dup.html in body@1 ambiguous ambiguous_template_root | jinja:include app/templates/base.html>other/templates/dup.html in body@1 ambiguous ambiguous_template_root | jinja:include app/templates/child.html>app/templates/parts/card.html in section@0 match | jinja:include index.html>- in span@0 unknown template_url | posthtml:include alp.html>partials/overlay.html in div@0 match | posthtml:include alp2.html>partials/overlay.html in div@0 match | posthtml:include index.html>partials/side.html in body@1 match | ssi:file index.html>loop1.html in div@0 match | ssi:file loop1.html>loop2.html in div@0 match | ssi:file loop2.html>loop1.html in div@0 unknown include_cycle | ssi:virtual index.html>- in p@0 unknown unresolved_url | ssi:virtual index.html>inc/nav.html in div@0 match"

eq "composed styles: fragments matched in their hosts, under the hosts' sheets" \
  "$(q "SELECT group_concat(x, ' | ') FROM (SELECT DISTINCT sel.selector_text || ' ' || e.display || ' ' || $(pf w.page_uid) || '@' || coalesce($(pf w.host_page_uid), '-') AS x FROM web_styles w JOIN web_selectors sel ON sel.uid = w.selector_uid JOIN web_elements e ON e.uid = w.element_uid WHERE w.status = 'match' ORDER BY 1)")" \
  ".dflt p.dflt app/templates/base.html@- | .l1 > .l2 div.l2 loop2.html@index.html | .main > .sec section.sec app/templates/child.html@app/templates/base.html | .nav .lnk a.lnk inc/nav.html@index.html | .sec > .card div.card app/templates/parts/card.html@app/templates/base.html | .wrap > .nav nav.nav inc/nav.html@index.html | [x-data] > .late div.late partials/late.html@alp2.html | [x-data] > .ov div.ov partials/overlay.html@alp.html | [x-data] > .ov div.ov partials/overlay.html@alp2.html | body > .foot footer.foot partials/foot.html@index.html | body > .side aside.side partials/side.html@index.html"

# an ambiguous include resolves to no host, so both candidates stay fragment_no_host; an imported macro file is listed
# and never composed, so it has no host either; the cycle is cut once, on the include that closes it (loop2 -> loop1)
eq "unknowns: the cycle cut, the unresolved and template-expression includes, fragment_no_host only for the unhosted" \
  "$(q "SELECT group_concat(x, ' | ') FROM (SELECT DISTINCT kind || ' ' || reason || ' ' || coalesce(file, '-') AS x FROM web_unknown WHERE kind IN ('include', 'fragment_no_host') ORDER BY 1)")" \
  "fragment_no_host fragment_no_host app/templates/dup.html | fragment_no_host fragment_no_host app/templates/macros.html | fragment_no_host fragment_no_host other/templates/dup.html | fragment_no_host fragment_no_host partials/orphan.html | include ambiguous_template_root app/templates/base.html | include include_cycle loop2.html | include template_url index.html | include unresolved_url index.html"

eq "web_computed carries the host for a composed fragment element" \
  "$(q "SELECT count(*) FROM web_computed c JOIN web_elements e ON e.uid = c.element_uid WHERE e.display = 'aside.side' AND c.property = 'color' AND c.value_text = 'green' AND $(pf c.host_page_uid) = 'index.html'")" "1"

eq "SSI echo and set are template expressions of dialect SSI" \
  "$(q "SELECT group_concat(x, ' | ') FROM (SELECT dialect || ' ' || directive || ' ' || expression_kind AS x FROM web_template_exprs WHERE dialect = 'SSI' ORDER BY 1)")" \
  "SSI echo INTERPOLATION | SSI include REFERENCE | SSI include REFERENCE | SSI include REFERENCE | SSI include REFERENCE | SSI include REFERENCE | SSI set BINDING"

eq "a partial's @click takes its Alpine hosts' dialect" \
  "$(q "SELECT group_concat(DISTINCT source_kind) FROM web_handlers WHERE attr_as_written = '@click'")" "alpine"

eq "a fragment included by >= 2 hosts is a component candidate of kind include" \
  "$(q "SELECT group_concat(display || ' ' || occurrences || '/' || pages, ' | ') FROM web_components WHERE level = 'include' AND display LIKE '%overlay%'")" "include:partials/overlay.html 2/2"

eq "INCLUDE references keep the flavour in attribute_name" \
  "$(q "SELECT group_concat(DISTINCT attribute_name) FROM (SELECT attribute_name FROM web_references WHERE reference_kind = 'INCLUDE' ORDER BY 1)")" \
  "gulp:@@include,jinja:extends,jinja:import,jinja:include,posthtml:include,ssi:file,ssi:virtual"

eq "every INCLUDE reference has a uid of its own (keyed by page, not by a missing attribute)" \
  "$(q "SELECT count(*) >= 2 AND count(*) = count(DISTINCT uid) FROM web_references WHERE reference_kind = 'INCLUDE'")" "1"

echo "web include checks: $pass passed, $fail failed"
[ "$fail" -eq 0 ] && [ "$pass" -ge 1 ]
