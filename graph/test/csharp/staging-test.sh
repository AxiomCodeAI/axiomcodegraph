#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Does `--library` actually do anything for C#?
#
# WHY THIS IS NOT A CASE UNDER cases/. The per-case suite runs the engine through
# devrun.sh, which stages every lib_* relation EMPTY by design: it exists to
# iterate a rule against one client IR. So the whole staging path -- name
# resolution across provenance, the heritage split reading the base's own
# category, member lookup answering a client question with a library
# declaration, and the stage<->solve loop's frontier -- is invisible to it. That
# is why a C# library could be staged and nothing it declared could ever be
# named, with the per-case suite green throughout.
#
# This runs the REAL executor, which is the only thing that stages.
#
# WHAT IT ASSERTS, and each is a separate failure that was real:
#   1. a client type can NAME a staged library type          (simple and qualified)
#   2. a client type EXTENDING a library type is in the hierarchy
#   3. a call on a library-typed receiver resolves to the library METHOD,
#      not to an `external:` label and not to ambiguous_unknown
#   4. the library frontier file is WRITTEN, so the body-staging loop can run.
#      A missing file read as a converged frontier is indistinguishable from a
#      project that genuinely calls nothing in its libraries.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
WORK="${1:-$REPO/.cs-staging-work}"
rm -rf "$WORK"; mkdir -p "$WORK/libsrc" "$WORK/clisrc"

[ -f "$REPO/parser/dist/index.js" ] || { echo "the parser is not built (npm run build)" >&2; exit 77; }
command -v souffle >/dev/null || { echo "souffle is not installed (brew install souffle)" >&2; exit 77; }

cat > "$WORK/libsrc/Greeter.cs" <<'EOF'
namespace LibNs
{
    public class Greeter { public virtual string Hello(string who) => "hi " + who; }
}
EOF

cat > "$WORK/clisrc/Use.cs" <<'EOF'
using LibNs;
namespace CliNs
{
    public class Derived : Greeter { public string Both() => Hello("inherited"); }
    public class Use
    {
        public string OnLibType(Greeter g) => g.Hello("x");
        public string Qualified(LibNs.Greeter g) => g.Hello("q");
    }
}
EOF

node "$REPO/parser/dist/index.js" "$WORK/libsrc" stub-lib false "$WORK/libir" --per-language > "$WORK/lib-parse.log" 2>&1 || {
  echo "  PARSER FAILED on the stub library"; exit 1; }

bash "$REPO/bin/axiomcode" all --language csharp --src "$WORK/clisrc" --out "$WORK/out" \
  --library "$WORK/libir" --debug > "$WORK/run.log" 2>&1 || {
  echo "  PIPELINE FAILED (see $WORK/run.log)"; tail -5 "$WORK/run.log"; exit 1; }

RAW="$WORK/out/csharp/raw"
bad=0
fail() { echo "  FAIL  $1"; bad=$((bad+1)); }

# 1 and 2: the base resolved and the hierarchy holds it.
if [ -s "$RAW/resolution-type-base-unresolved.csv" ]; then
  fail "a client type's base did not resolve to the staged library type: $(head -1 "$RAW/resolution-type-base-unresolved.csv")"
fi
anc=$(wc -l < "$RAW/resolution-type-ancestor.csv" 2>/dev/null | tr -d ' ')
if [ "${anc:-0}" -lt 1 ]; then
  fail "no type_ancestor row: a client class deriving from a staged library class is in no hierarchy"
fi

# 3: the calls reach the library's own method row, by hash.
libm=$(awk -F'\t' 'NR>1 && $1=="Hello"{print $35}' "$WORK/libir/csharp/all-csharp-methods.csv" | head -1)
[ -n "$libm" ] || fail "the stub library IR has no Hello method to look for"
hits=$(awk -F'\t' -v m="$libm" '$4==m' "$RAW/call-chain-edges.csv" 2>/dev/null | wc -l | tr -d ' ')
if [ "${hits:-0}" -lt 3 ]; then
  fail "only ${hits:-0} edge(s) reach the library method, expected 3 (inherited, by-parameter, by-qualified-name)"
  awk -F'\t' '{print "        got: "$4"  "$6"  "$7}' "$RAW/call-chain-edges.csv" 2>/dev/null | head -5
fi
# and none of them fell back to a label or to a blind spot
if grep -q "ambiguous_unknown" "$RAW/call-chain-edges.csv" 2>/dev/null; then
  fail "a call on a staged library type is still ambiguous_unknown"
fi

# 4: the frontier the stage<->solve loop reads.
if [ ! -f "$RAW/call-edges-lib.csv" ]; then
  fail "call-edges-lib.csv was not written, so the loop reads an absent file as a converged frontier"
elif [ ! -s "$RAW/call-edges-lib.csv" ]; then
  fail "the library frontier is empty although the client calls into the library"
fi

if [ "$bad" -eq 0 ]; then
  echo "staging: PASS (name resolution, hierarchy, member lookup and the frontier all cross provenance)"
  exit 0
fi
echo "staging: FAIL ($bad check(s))"
exit 1
