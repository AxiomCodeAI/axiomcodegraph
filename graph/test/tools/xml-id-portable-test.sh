#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AN XML ID MUST NOT DEPEND ON WHERE THE TREE IS CHECKED OUT.
#
# Every XML element, attribute and value-reference id hashed the file's ABSOLUTE path
# (an element's also the absolute project path). A value reference's id is what a
# declared unknown names (config_unresolved spel_expression), so the Java golden that
# printed one passed only in the checkout it was blessed in, CI included.
#
# The ids now hash the path relative to the analysis root. Checked here:
#   1. one tree parsed from two directories gives the same element, attribute and
#      value-reference ids;
#   2. CONTROL: two byte-identical files at different relative paths in one tree still
#      get different ids, so the key did not simply stop naming the file;
#   3. neither run is empty, so (1) cannot pass on two empty sets.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(d="$HERE"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
PARSER="${AXIOM_PARSER:-$ROOT/parser/dist/index.js}"
[ -f "$PARSER" ] || { echo "xml-id-portable: SKIP (no parser at $PARSER)"; exit 0; }
command -v node >/dev/null 2>&1 || { echo "xml-id-portable: SKIP (no node)"; exit 0; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mk() {  # mk <project dir>
  local p="$1"
  mkdir -p "$p/a/src/main/resources" "$p/b/src/main/resources"
  printf '<project><modelVersion>4.0.0</modelVersion></project>\n' > "$p/pom.xml"
  local x='<beans>\n  <bean id="clock" class="app.Clock">\n    <property name="zone" value="#{systemProperties['"'"'user.timezone'"'"']}"/>\n    <property name="url" value="${db.url:jdbc:h2:mem}"/>\n  </bean>\n</beans>\n'
  printf "$x" > "$p/a/src/main/resources/beans.xml"
  printf "$x" > "$p/b/src/main/resources/beans.xml"
}
mk "$W/one/proj"
mk "$W/two/deeper/checkout/proj"
node "$PARSER" "$W/one/proj" xmlid false "$W/ir1" >"$W/p1.log" 2>&1
node "$PARSER" "$W/two/deeper/checkout/proj" xmlid false "$W/ir2" >"$W/p2.log" 2>&1

fail=0; bad(){ echo "  ✗ $*"; fail=$((fail+1)); }
# The row's own id is the last column of each table.
ids() { [ -f "$1" ] && awk -F'\t' 'NR>1 { print $NF }' "$1" | sort; }
# The ids of the rows of one module's file, by the file path column ($2 = a|b).
ids_of() { [ -f "$1" ] && awk -F'\t' -v m="/$2/src/main/resources/beans.xml" 'NR>1 && index($0, m) { print $NF }' "$1" | sort; }

for t in all-xml-elements all-xml-attributes all-xml-value-references; do
  n1=$(ids "$W/ir1/$t.csv" | grep -c . || true); n2=$(ids "$W/ir2/$t.csv" | grep -c . || true)
  [ "${n1:-0}" -ge 2 ] || bad "$t: the first run wrote ${n1:-0} rows, expected at least 2"
  [ "${n1:-0}" = "${n2:-0}" ] || bad "$t: ${n1:-0} rows from one directory, ${n2:-0} from the other"
  if ! diff -q <(ids "$W/ir1/$t.csv") <(ids "$W/ir2/$t.csv") >/dev/null; then
    bad "$t: the same tree got different ids in two directories ($(comm -23 <(ids "$W/ir1/$t.csv") <(ids "$W/ir2/$t.csv") | grep -c .) moved)"
  fi
  a=$(ids_of "$W/ir1/$t.csv" a); b=$(ids_of "$W/ir1/$t.csv" b)
  [ -n "$a" ] && [ -n "$b" ] || bad "$t: no rows for one of the two identical files"
  [ -z "$(comm -12 <(printf '%s\n' "$a") <(printf '%s\n' "$b") | grep .)" ] \
    || bad "$t: two identical files at different paths share an id"
done
[ "$(awk -F'\t' 'NR>1 && $2=="SPEL_EXPRESSION"' "$W/ir1/all-xml-value-references.csv" 2>/dev/null | grep -c .)" -ge 2 ] \
  || bad "no SPEL_EXPRESSION value reference was extracted, so the id a declared unknown prints was not checked"

if [ "$fail" -eq 0 ]; then echo "xml-id-portable: ok (same ids from two directories, identical files at two paths still distinct)"; else echo "xml-id-portable: $fail failure(s)"; exit 1; fi
