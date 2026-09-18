#!/bin/bash
# =============================================================================
# Compile and run the C# engine over one already-extracted IR directory.
#
# WHY THIS EXISTS SEPARATELY FROM run-souffle.sh: the real executor stages
# libraries, caches binaries, runs the stage<->solve loop and then bundles into
# graph.sqlite. All of that is right for a pipeline run and too slow to iterate a
# rule against. This does the one thing a rule author needs: stage a client IR,
# compile, solve, and drop the raw relations where they can be read.
#
# IT MUST COMPILE, NOT INTERPRET. souffle's interpreter refuses arity beyond a
# built-in limit ("Requested arity not yet supported") and cs_method has 35
# columns, so `souffle -F -D` on this engine aborts with a failed assertion. The
# native path has no such limit, which is why the shared executor compiles too.
#
# Usage: devrun.sh <ir-dir> <work-dir> [relation ...]
#   ir-dir    a directory of all-csharp-*.csv (parser output, flat or per-language)
#   work-dir  scratch: facts/, the binary cache and out/
#   relation  extra relations to .output beyond the export manifest
# =============================================================================
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$HERE/../.." && pwd)"            # graph/
ENG="$SRC/csharp/engine"
DL="$SRC/csharp/souffle"

IR="$(cd "$1" && pwd)"; shift
mkdir -p "$1"; WORK="$(cd "$1" && pwd)"; shift
EXTRA=("$@")

# The parser writes either a flat directory or <out>/csharp/ with --per-language.
[ -f "$IR/all-csharp-modules.csv" ] || { [ -f "$IR/csharp/all-csharp-modules.csv" ] && IR="$IR/csharp"; }
[ -f "$IR/all-csharp-modules.csv" ] || { echo "no all-csharp-modules.csv under $1" >&2; exit 1; }

. "$SRC/pipeline/souffle-include.sh"
INNER="$(find_souffle_include)"
[ -n "$INNER" ] && [ -f "$INNER/souffle/CompiledSouffle.h" ] || {
  echo "souffle headers not found; brew install souffle" >&2; exit 1; }

FACTS="$WORK/facts"; OUT="$WORK/out"
rm -rf "$FACTS" "$OUT"; mkdir -p "$FACTS" "$OUT"

# Stage the client IR exactly as run-souffle.sh does, including the malformed-row
# drop: souffle rejects a whole fact file for one bad line, so a row cut mid-write
# would otherwise take down the run. Every mapped relation is written even when
# absent, so the program text (and therefore the binary cache key) does not depend
# on which entities a project happens to contain.
while IFS=$'\t' read -r rel csv; do
  if [ -f "$IR/$csv.csv" ]; then
    awk -F'\t' 'NR==1{n=NF; next} NF==n{print; next} {bad++}
                END{if(bad>0) printf "  ! dropped %d malformed row(s) from %s\n", bad, FILENAME > "/dev/stderr"}' \
      "$IR/$csv.csv" > "$FACTS/$rel.facts"
  else : > "$FACTS/$rel.facts"; fi
  : > "$FACTS/lib_$rel.facts"
done < <(grep -vE '^[[:space:]]*(#|$)' "$SRC/csharp/templates/client-ir.map")

# Tuning inputs the rules read as facts rather than as compiled constants, so
# sweeping one costs no recompile. Empty means "no cap", which is the sound default.
: > "$FACTS/dispatch_cap.facts"
[ -n "${AXIOM_DISPATCH_CAP:-}" ] && printf '%s\n' "$AXIOM_DISPATCH_CAP" > "$FACTS/dispatch_cap.facts"

# THE RUNTIME TRACE, optional. runtime-oracle/join.py --facts writes it, keyed on
# `Type.Name/paramCount`. Empty is the normal case and the engine then behaves
# exactly as it does with no trace, which is what makes the feature safe to leave
# switched on. AXIOM_CS_RUNTIME_FACTS points at the file.
: > "$FACTS/runtime_observed_edge.facts"
if [ -n "${AXIOM_CS_RUNTIME_FACTS:-}" ] && [ -f "${AXIOM_CS_RUNTIME_FACTS}" ]; then
  cp "$AXIOM_CS_RUNTIME_FACTS" "$FACTS/runtime_observed_edge.facts"
  echo "▶ staged $(wc -l < "$FACTS/runtime_observed_edge.facts" | tr -d ' ') runtime-observed edge(s)"
fi

export LC_ALL=C LC_COLLATE=C
PROG="$WORK/program.dl"
{
  echo "#include \"$DL/decls_base.dl\""
  echo "#include \"$DL/decls_all.dl\""
  for ff in "$FACTS"/*.facts; do
    r=$(basename "$ff" .facts)
    printf '.input %s(IO=file, filename="%s.facts", delimiter="\\t", rfc4180=true)\n' "$r" "$r"
  done
  for d in projections containment resolution expression-resolution call-edge-generation; do
    for f in "$ENG/$d/"*.dl; do [ -f "$f" ] && echo "#include \"$f\""; done
  done
  while IFS=$'\t' read -r pred file; do
    [ -n "$pred" ] && printf '.output %s(IO=file, filename="%s", delimiter="\\t")\n' "$pred" "$file"
  done < <(sort -u "$DL/export_manifest.tsv")
  for r in ${EXTRA[@]+"${EXTRA[@]}"}; do
    printf '.output %s(IO=file, filename="%s.csv", delimiter="\\t")\n' "$r" "$r"
  done
} > "$PROG"

# Content-addressed binary cache, same discipline as the shared executor: the hash
# covers the program text and every included rule file, so a rule edit rebuilds and
# an unchanged tree is instant.
CACHE="${AXIOM_CS_DEV_CACHE:-$WORK/../.cs-dev-cache}"; mkdir -p "$CACHE"
KEY="$(cat "$PROG" "$DL/decls_base.dl" "$DL/decls_all.dl" "$ENG"/*/*.dl 2>/dev/null | shasum | cut -d' ' -f1)"
BIN="$CACHE/cs-engine-$KEY"
if [ ! -x "$BIN" ]; then
  echo "▶ compiling (cache miss)"
  souffle -g "$WORK/program.cpp" "$PROG" 2> "$WORK/.gen.log" || { cat "$WORK/.gen.log" >&2; exit 1; }
  awk '/No rules\/facts defined/{skip=2;next} skip>0{skip--;next} {print}' "$WORK/.gen.log" >&2
  c++ -std=c++17 -O1 -w -I "$INNER" "$WORK/program.cpp" -o "$BIN.tmp.$$"
  mv -f "$BIN.tmp.$$" "$BIN"
else echo "▶ reusing cached binary"; fi

"$BIN" -F "$FACTS" -D "$OUT"
echo "▶ $(ls "$OUT" | wc -l | tr -d ' ') relations written to $OUT"
