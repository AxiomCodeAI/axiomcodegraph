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
<html><head><link rel="stylesheet" href="../style.css"></head><body><p class="menu">x</p></body></html>
H
printf '.menu{color:red}\n#top{--gap:4px;margin:var(--gap)}\n.never{color:blue}\n.slot > .card{color:green}\n' > "$T/site/style.css"
# a fragment no include reference names, for `link` (SPEC §11.2, Q36): asserted into host.html at line 4
mkdir -p "$T/site/parts"
printf '<!doctype html>\n<html><head><link rel="stylesheet" href="style.css"></head><body>\n<div class="slot">\n  <!-- the card goes here -->\n</div></body></html>\n' > "$T/site/host.html"
printf '<p class="card">c</p>\n' > "$T/site/parts/card.html"
pass=0; fail=0
check(){ # name, expected substring, command...
  local name="$1" want="$2"; shift 2; local out
  out=$(cd "$T/site" && "$@" 2>&1)
  if [[ "$out" == *"$want"* ]]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $name: wanted '$want'"; echo "$out" | head -8 | sed 's/^/    /'; fi
}
if ! (cd "$T/site" && "$AX" index "$T/site" --lang web >"$T/index.log" 2>&1); then echo "FAIL index:"; tail -5 "$T/index.log"; exit 1; fi
[ -f "$T/site/.axiomcode/out/graph.sqlite" ] && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL index wrote no graph.sqlite"; tail -5 "$T/index.log"; }
check impact-class 'elements carrying .menu: 2' "$AX" impact .menu
check impact-page '1. style.css' "$AX" impact index.html
# C-04: a single-class selector asked for on a page answers the selector->element role too, not only the class lookup
check impact-class-styled 'elements the selector .menu styles: 1' "$AX" impact .menu --in index.html
check impact-var '--gap' "$AX" impact --gap
# --json with a name that starts with -- (a custom property): a name, not a flag, so not the "your edits" answer
check impact-var-json '"--gap"' "$AX" impact --gap --json
check impact-var-json-in '"--gap"' "$AX" impact --gap --in index.html --json
check impact-handler 'onclick' "$AX" impact index.html
check context 'menu' "$AX" context "menu colour"
check path 'about.html' "$AX" path index.html sub/about.html
check impact-before-link 'elements it styles: 0' "$AX" impact '.slot > .card' --in host.html
check link-include '[asserted]' "$AX" link parts/card.html:1 host.html:4
check impact-asserted 'parts/card.html:1: p.card [match] (included in host.html) [asserted]' "$AX" impact '.slot > .card' --in host.html
check link-list 'parts/card.html → host.html:4  taken yes' "$AX" link
echo "web cli smoke: $pass passed, $fail failed"
[ "$fail" -eq 0 ] && [ "$pass" -ge 1 ]
