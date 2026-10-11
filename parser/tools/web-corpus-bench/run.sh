#!/bin/bash
# Runs every corpus through both comparisons and writes results/report.md.
set -e
cd "$(dirname "$0")"; B=$PWD; C=$B/corpus; R=$B/results; mkdir -p "$R"
cd ..; cd ..   # parser/: tsx needs the parser tsconfig for the @/ aliases
run() { npx tsx --tsconfig tsconfig.json "$@"; }
H=$B/html-compare.ts; X=$B/css-compare.ts
run $H --corpus html5lib --mode dat --root $C/parse5/test/data/html5lib-tests/tree-construction &
run $H --corpus wpt --root $C/wpt & run $H --corpus angular --root $C/components & run $H --corpus django --root $C/django &
run $H --corpus dom-examples --root $C/dom-examples & run $H --corpus live --root $C/live/html &
run $H --corpus parse5-huge --root $C/parse5/test/data/huge-page & run $H --corpus parse5-loc --root $C/parse5/test/data/location-info &
run $H --corpus bootstrap --root $C/bootstrap & run $H --corpus petclinic --root $C/spring-petclinic & run $H --corpus h5bp --root $C/html5-boilerplate &
run $X --corpus csstree --mode csstree --root $C/csstree & run $X --corpus postcss-cases --root $C/postcss-parser-tests/cases &
run $X --corpus live --root $C/live/css & run $X --corpus bootstrap --root $C/bootstrap & run $X --corpus angular --root $C/components &
run $X --corpus django --root $C/django & run $X --corpus dom-examples --root $C/dom-examples & run $X --corpus wpt --root $C/wpt &
wait
run $B/report.ts
