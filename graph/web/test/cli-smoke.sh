#!/usr/bin/env bash
# axiom-code-graph — web layer, end to end through the plugin CLI (violation V1-01: the web build succeeded while
# `index` crashed on a renamed column, so every query verb answered "no graph"). Builds a three-file site with the
# real `axiomcode index --lang web`, then asks impact (class, page, custom property), context and path, and checks
# each answer names what the site holds. Exit 0 = every check passed (prints the count), 1 = a check failed.
set -u
ROOT="${AXIOM_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
AX="$ROOT/plugins/axiomcode/skills/axiomcode/scripts/axiomcode"
T=$(mktemp -d "${TMPDIR:-/tmp}/web-cli-smoke.XXXXXX"); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/site/sub"
cat > "$T/site/index.html" <<'H'
<!doctype html>
<html><head><link rel="stylesheet" href="style.css"></head>
<body><nav class="menu" id="top"><a href="sub/about.html" onclick="go()">about</a></nav></body></html>
H
cat > "$T/site/sub/about.html" <<'H'
<!doctype html>
<html><head><link rel="stylesheet" href="../style.css"></head><body><p class="menu">x</p><p class="dark:bg-gray-900 w-1/2">t</p></body></html>
H
printf '.menu{color:red}\n#top{--gap:4px;margin:var(--gap)}\n.never{color:blue}\n.slot > .card{color:green}\n.dark\\:bg-gray-900{background:#111}\n' > "$T/site/style.css"
# a fragment no include reference names, for `link` (SPEC §11.2, Q36): asserted into host.html at line 4
mkdir -p "$T/site/parts"
printf '<!doctype html>\n<html><head><style>.slot{margin:0}</style><link rel="stylesheet" href="style.css"></head><body>\n<div class="slot">\n  <!-- the card goes here -->\n</div></body></html>\n' > "$T/site/host.html"
printf '<p class="card">c</p>\n' > "$T/site/parts/card.html"
pass=0; fail=0
check(){ # name, expected substring, command...
  local name="$1" want="$2"; shift 2; local out
  out=$(cd "$T/site" && "$@" 2>&1)
  if [[ "$out" == *"$want"* ]]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $name: wanted '$want'"; echo "$out" | head -8 | sed 's/^/    /'; fi
}
nocheck(){ # name, substring that must NOT appear in a non-empty answer, command...
  local name="$1" unwanted="$2"; shift 2; local out
  out=$(cd "$T/site" && "$@" 2>&1)
  if [ -n "$out" ] && [[ "$out" != *"$unwanted"* ]]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $name: '$unwanted' in the answer (or no answer)"; echo "$out" | head -8 | sed 's/^/    /'; fi
}
if ! (cd "$T/site" && "$AX" index "$T/site" --lang web >"$T/index.log" 2>&1); then echo "FAIL index:"; tail -5 "$T/index.log"; exit 1; fi
[ -f "$T/site/.axiomcode/out/graph.sqlite" ] && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL index wrote no graph.sqlite"; tail -5 "$T/index.log"; }
check impact-class 'elements carrying .menu: 2' "$AX" impact .menu
check impact-page '1. style.css' "$AX" impact index.html
# V2-10: a <style> element loads at its own file:line
check impact-style-at '"at": "host.html:2"' "$AX" impact host.html --json
# C-04: a single-class selector asked for on a page answers the selector->element role too, not only the class lookup
check impact-class-styled 'elements the selector .menu styles: 1' "$AX" impact .menu --in index.html
check impact-var '--gap' "$AX" impact 'var(--gap)'
# a custom property is asked in CSS's own syntax, var(--name); with --json it is still a name, not the "your edits" answer
check impact-var-json '"--gap"' "$AX" impact 'var(--gap)' --json
check impact-var-json-in '"--gap"' "$AX" impact 'var(--gap)' --in index.html --json
# a bare --gap is a flag the CLI does not know, as on dev: never read as the custom property
nocheck impact-bare-dashdash-not-a-target 'custom property --gap' "$AX" impact --gap
# V2-09: Tailwind class names, as written and with their CSS escape
check impact-tailwind 'elements carrying .dark:bg-gray-900: 1' "$AX" impact .dark:bg-gray-900
check impact-tailwind-escaped 'elements carrying .dark:bg-gray-900: 1' "$AX" impact '.dark\:bg-gray-900'
check impact-tailwind-slash 'elements carrying .w-1/2: 1' "$AX" impact .w-1/2
check impact-handler 'onclick' "$AX" impact index.html
check context 'menu' "$AX" context "menu colour"
check path 'about.html' "$AX" path index.html sub/about.html
check impact-before-link 'elements it styles: 0' "$AX" impact '.slot > .card' --in host.html
check link-include '[asserted]' "$AX" link parts/card.html:1 host.html:4
check impact-asserted 'parts/card.html:1: p.card [match] (included in host.html) [asserted]' "$AX" impact '.slot > .card' --in host.html
check link-list 'parts/card.html → host.html:4  taken yes' "$AX" link
# V3-04: a class token / id written with a template expression is found by its written name; V3-06: an on* attribute
# whose code names no call is still a `handler` row
mkdir -p "$T/tpl"
cat > "$T/tpl/index.html" <<'H'
<!doctype html>
<html><body><div class="{% if a %}py-0.5{% else %}gap-2.5{% endif %}" id="id_{{ f.name }}_div">x</div>
<button onclick="navigator.clipboard.writeText(`${location.origin}?t=1`)">copy</button></body></html>
H
if (cd "$T/tpl" && "$AX" index "$T/tpl" --lang web >"$T/index2.log" 2>&1); then
  T0="$T"; T="$T0/tpl-run"; mkdir -p "$T"; ln -s "$T0/tpl" "$T/site"
  check V3-04-dynamic-class 'elements carrying .{% if a %}py-0.5{% else %}gap-2.5{% endif %}: 1' "$AX" impact '.{% if a %}py-0.5{% else %}gap-2.5{% endif %}'
  check V3-04-dynamic-id 'elements with id id_{{ f.name }}_div' "$AX" impact '#id_{{ f.name }}_div'
  check V3-06-handler-no-call '"role": "handler"' "$AX" impact index.html --json
  T="$T0"
else fail=$((fail+1)); echo "FAIL index (template site)"; tail -5 "$T/index2.log"; fi
# review 1 (R1-<n>: finding n): the query surface
mkdir -p "$T/rev/blog"
printf '<!doctype html>\n<html><head><link rel="stylesheet" href="style.css"></head><body><p class="card">a</p></body></html>\n' > "$T/rev/index.html"
printf '<!doctype html>\n<html><head><link rel="stylesheet" href="../style.css"></head><body><p class="card">b</p></body></html>\n' > "$T/rev/blog/index.html"
printf '<!doctype html>\n<html><head><link rel="stylesheet" href="style.css"></head><body><p class="card">c</p></body></html>\n' > "$T/rev/oldindex.html"
printf '<!doctype html>\n<html><body><p>x</p></body></html>\n' > "$T/rev/blog/pageX1.html"
printf '.menu { color: red }\n.card {\n  color: blue;\n}\n.ra { color: red !important }\n.rb { color: blue }\n' > "$T/rev/style.css"
printf '<!doctype html>\n<html><head><link rel="stylesheet" href="style.css"></head><body>\n<p class="ra rb">r</p></body></html>\n' > "$T/rev/order.html"
printf '<!doctype html>\n<html><head><style>\n.h, .h { color: red }\n@media print { .h { color: blue } }\n</style></head><body>\n<button class="h k" onclick="openModal(\x27signup\x27); track()">b</button></body></html>\n' > "$T/rev/handler.html"
if (cd "$T/rev" && "$AX" index "$T/rev" --lang web >"$T/index3.log" 2>&1); then
  # R1-10: an explicit repository wins over the graph of the directory asked from ($T/site, whose graph has no .card),
  # with the trailing option the front door appends
  check R1-10-explicit-repo 'oldindex.html' "$AX" impact .card "$T/rev" --json
  T0="$T"; T="$T0/rev-run"; mkdir -p "$T"; ln -s "$T0/rev" "$T/site"
  # R1-09: a stylesheet line names the rule holding it (web_selectors has no end_line)
  check R1-09-sheet-line 'web: selector .card' "$AX" impact style.css:3
  # R1-11: --in index.html is that page, not blog/index.html or oldindex.html
  check R1-11-in-exact 'index.html:2: p.card' "$AX" impact .card --in index.html
  nocheck R1-11-in-not-suffix 'blog/index.html' "$AX" impact .card --in index.html
  nocheck R1-11-in-not-suffix2 'oldindex.html' "$AX" impact .card --in index.html
  # R1-26: a dev option's value is no target
  nocheck R1-26-top-value 'nothing named' "$AX" impact .card --top 5
  # R1-28: rules in cascade order, the winner last: a rule with one !important declaration does not sort last for all
  check R1-28-cascade-order '.ra .rb' bash -c "\"$AX\" impact order.html:3 --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(\" \".join(r[\"selector\"] for r in d.get(\"rows\", []) if r.get(\"role\") == \"styled_by\"))'"
  # [iter5 ruling] one `handler` row per on* attribute, the functions it calls in `calls`
  check V5-handler-one-row '1:openModal,track' bash -c "\"$AX\" impact handler.html --json | python3 -c 'import json,sys; d=json.load(sys.stdin); h=[r for r in d.get(\"rows\", []) if r.get(\"role\") == \"handler\"]; print(len(h), \",\".join(h[0].get(\"calls\") or []) if h else \"-\", sep=\":\")'"
  # [iter5 ruling] styled rows are one per (element, rule) with rule_at and the rule's best status: `.h, .h` counts once
  check V5-styled-per-rule 'handler.html:6=handler.html:3=match handler.html:6=handler.html:4=conditional' bash -c "\"$AX\" impact .h --in handler.html --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(\" \".join(r[\"at\"] + \"=\" + str(r.get(\"rule_at\")) + \"=\" + r[\"status\"] for r in d.get(\"rows\", []) if r.get(\"role\") == \"styled\"))'"
  # R1-23: link refuses a path outside the repository
  # (the site dir is a symlink to $T0/rev, so `../outside` from it is $T0/outside: a real file outside the repository)
  mkdir -p "$T0/outside"; printf '<p>o</p>\n' > "$T0/outside/frag.html"
  check R1-23-link-outside 'is not a file in this repository' "$AX" link ../outside/frag.html:1 index.html:2
  # R1-27: _ in a LIKE pattern is a literal: page_1.html is not pageX1.html
  nocheck R1-27-like-escape 'blog/pageX1.html' "$AX" impact page_1.html
  T="$T0"
else fail=$((fail+1)); echo "FAIL index (review site)"; tail -5 "$T/index3.log"; fi
# R1-12: through MCP, custom-property and attribute lines survive the no-options filter; advice to pass a flag does not
mcp_out=$(python3 - "$ROOT/plugins/axiomcode/mcp/server.py" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
start = src.index('_CLI_OPTIONS = (') if '_CLI_OPTIONS = (' in src else src.index('_OPTION = re.compile')
ns = {'re': re}; exec(src[start:src.index('\n\n', src.index('def plain('))], ns)
print(ns['plain']('web: custom property --brand\n  a.css:1: :root { --brand: #fff }\n  index.html:3: <p class="x" style="margin: var(--gap)">\nre-run with --why for the chain.\nask again with source=True.').replace('\n', ' | '))
PY
)
if [ "$mcp_out" = 'web: custom property --brand |   a.css:1: :root { --brand: #fff } |   index.html:3: <p class="x" style="margin: var(--gap)">' ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL R1-12-mcp-plain: [$mcp_out]"; fi
echo "web cli smoke: $pass passed, $fail failed"
[ "$fail" -eq 0 ] && [ "$pass" -ge 1 ]
