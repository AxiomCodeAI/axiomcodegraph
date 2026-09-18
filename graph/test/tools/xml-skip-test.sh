#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A FILE THE EXTRACTOR LOSES MUST LEAVE A ROW SAYING SO. Issue #554.
#
# The XML, properties and YAML analysers guarded large files by LINE COUNT and caught
# extractor failures with a bare console.error. Machine-generated XML is routinely
# megabytes on a few hundred lines, so it passed the line guard, threw inside the
# extractor, and contributed no elements, no attributes and no value references with
# nothing anywhere to say why. Measured on a 2,766-file corpus: 7 files failed to parse
# and 0 of them were recorded.
#
# Two shapes, and the control that proves the guards are not simply skipping everything:
#   report.xml  under the byte threshold, throws -> EXTRACTION_ERROR
#   huge.xml    over the byte threshold          -> FILE_TOO_LARGE
#   fine.xml    ordinary                         -> parsed, elements extracted
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(d="$HERE"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
PARSER="${AXIOM_PARSER:-$ROOT/parser/dist/index.js}"
[ -f "$PARSER" ] || { echo "xml-skip: SKIP (no parser at $PARSER)"; exit 0; }
command -v node >/dev/null 2>&1 || { echo "xml-skip: SKIP (no node)"; exit 0; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
R="$W/proj/src/main/resources"; mkdir -p "$R"
printf '<project><modelVersion>4.0.0</modelVersion></project>\n' > "$W/proj/pom.xml"
printf '<beans><bean id="ok"/></beans>\n' > "$R/fine.xml"
# Both generated on ONE line, which is the whole point: the line guard never sees them.
node -e 'const n=200000,f=process.argv[1];let s="<r>";for(let i=0;i<n;i++)s+=`<i id="${i}">v</i>`;require("fs").writeFileSync(f,s+"</r>")' "$R/report.xml"
node -e 'const n=300000,f=process.argv[1];let s="<r>";for(let i=0;i<n;i++)s+=`<i id="${i}">v</i>`;require("fs").writeFileSync(f,s+"</r>")' "$R/huge.xml"

node "$PARSER" "$W/proj" xmlskip false "$W/ir" >"$W/parse.log" 2>&1
SK="$W/ir/skipped-xml-files.csv"
fail=0; bad(){ echo "  ✗ $*"; fail=$((fail+1)); }
reason(){ [ -f "$SK" ] && awk -F'\t' -v n="$1" 'NR>1 { c=split($1,a,"/"); if (a[c]==n) print $4 }' "$SK"; }

[ -f "$SK" ] || bad "no skipped-xml-files.csv was written at all"
[ "$(reason report.xml)" = EXTRACTION_ERROR ] \
  || bad "a file the extractor threw on was recorded as '$(reason report.xml)', expected EXTRACTION_ERROR"
[ "$(reason huge.xml)" = FILE_TOO_LARGE ] \
  || bad "a file over the byte threshold was recorded as '$(reason huge.xml)', expected FILE_TOO_LARGE"
[ -z "$(reason fine.xml)" ] || bad "an ordinary file was skipped as '$(reason fine.xml)'"
[ "$(awk -F'\t' 'NR>1 && $0 ~ /fine\.xml/' "$W/ir/all-xml-elements.csv" 2>/dev/null | wc -l | tr -d ' ')" -ge 2 ] \
  || bad "the ordinary file contributed no elements, so the guards are over-skipping"

if [ "$fail" -eq 0 ]; then echo "xml-skip: ok (extractor failure and byte-size skip both recorded, ordinary file untouched)"; else echo "xml-skip: $fail failure(s)"; exit 1; fi
