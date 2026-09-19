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

# ── A CHAIN THROUGH A STAGED TYPE, WHICH IS THE POINT OF STAGING ────────────
# `new T()`, a call on it, and a call on what that call RETURNS. Each was its own
# layer of the same single-provenance bug, and each is reachable only once the one
# before it works, so they are asserted together.
mkdir -p "$WORK/chain-lib" "$WORK/chain-cli"
cat > "$WORK/chain-lib/Sb.cs" <<'EOF2'
namespace System.Text;

public sealed class StringBuilder
{
    public StringBuilder() { }
    public StringBuilder Append(string value) => throw null!;
    public override string ToString() => throw null!;
}
EOF2
cat > "$WORK/chain-cli/App.cs" <<'EOF2'
using System.Text;

public static class App
{
    public static void Go(string input)
    {
        var sb = new StringBuilder();
        sb.Append(input);
        sb.ToString().Trim();
    }
}
EOF2
node "$REPO/parser/dist/index.js" "$WORK/chain-lib" chain-lib false "$WORK/chain-libir" --per-language > "$WORK/chain-parse.log" 2>&1
bash "$REPO/bin/axiomcode" all --language csharp --src "$WORK/chain-cli" --out "$WORK/chain-out"   --library "$WORK/chain-libir" --version pinned --debug > "$WORK/chain.log" 2>&1
CHAIN="$WORK/chain-out/csharp/raw/call-chain-edges.csv"
if grep -q "ambiguous_unknown" "$CHAIN" 2>/dev/null; then
  fail "a chain through a staged type still has a blind spot: the call resolves and its RESULT does not"
fi
if grep -q "known_implicit_ctor" "$CHAIN" 2>/dev/null; then
  fail "\`new T()\` on a staged type claimed the type declares no constructor, which the staged IR contradicts"
fi
grep -q "external:string.Trim" "$CHAIN" 2>/dev/null ||   fail "the call on a staged method's RETURN value is not named; the chain dies one hop in"

# ── STAGING NOTHING CHANGES NOTHING ─────────────────────────────────────────
# The cross-provenance clauses must be inert on a client-only run. Compared
# relation by relation, and then the SAME comparison is run against the staged
# output to show it is capable of failing -- a diff that cannot fail is not
# evidence.
bash "$REPO/bin/axiomcode" all --language csharp --src "$WORK/chain-cli" --out "$WORK/chain-nolib"   --version pinned --debug > "$WORK/chain-nolib.log" 2>&1
mkdir -p "$WORK/empty-lib"
bash "$REPO/bin/axiomcode" all --language csharp --src "$WORK/chain-cli" --out "$WORK/chain-emptylib"   --library "$WORK/empty-lib" --version pinned --debug > "$WORK/chain-emptylib.log" 2>&1
A="$WORK/chain-nolib/csharp/raw"; B="$WORK/chain-emptylib/csharp/raw"
if [ -d "$B" ]; then
  differing=0
  for f in "$A"/*.csv; do
    n="$(basename "$f")"
    cmp -s <(sort "$f") <(sort "$B/$n" 2>/dev/null) || differing=$((differing+1))
  done
  [ "$differing" -eq 0 ] || fail "staging an EMPTY library changed $differing relation(s); the cross-provenance rules are not inert"
  # the control: the same comparison against the STAGED run must find differences
  moved=0
  for f in "$A"/*.csv; do
    n="$(basename "$f")"
    cmp -s <(sort "$f") <(sort "$WORK/chain-out/csharp/raw/$n" 2>/dev/null) || moved=$((moved+1))
  done
  [ "$moved" -gt 0 ] || fail "the relation-by-relation comparison found no difference even WITH a library staged, so it cannot fail and proves nothing"
fi

if [ "$bad" -eq 0 ]; then
  echo "staging: PASS (names, hierarchy, lookup, constructors, return types and the frontier cross provenance; inert when nothing is staged)"
  exit 0
fi
echo "staging: FAIL ($bad check(s))"
exit 1
