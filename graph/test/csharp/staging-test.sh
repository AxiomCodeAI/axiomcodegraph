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
#   5. a STAGED GENERIC type's `T`-typed member has the client's argument
#      substituted for it, so a chain through `IOpt<Settings>.Value` reaches the
#      client method instead of stopping at the library's accessor. Every part of
#      that shape except the argument belongs to the library, so a rule written
#      under one provenance passes every case under cases/ and does nothing here.
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

# ── A STAGED GENERIC TYPE'S PARAMETER, SUBSTITUTED AT THE CLIENT'S SITE ────
# `IOptions<CatalogOptions>.Value.SomeSetting` is the shape configuration is read
# in, and every part of it except the ARGUMENT belongs to the library: the
# interface, its type parameter and the `T Value` property are the library's,
# while the reference that supplies the argument is the client's. A rule written
# under one provenance fires on an in-source wrapper and never on this, so the
# per-case suite can be green while the shape the rule exists for does nothing.
mkdir -p "$WORK/gen-lib" "$WORK/gen-cli"
cat > "$WORK/gen-lib/Opt.cs" <<'EOF2'
namespace LibOpt;

public interface IOpt<T> { T Value { get; } }
EOF2
cat > "$WORK/gen-cli/Read.cs" <<'EOF2'
using LibOpt;

public sealed class Settings { public bool Enabled() => true; }

public sealed class Reader
{
    // The staged interface supplies `Value`; the client supplies Settings for T.
    public bool Read(IOpt<Settings> o) => o.Value.Enabled();
}
EOF2
node "$REPO/parser/dist/index.js" "$WORK/gen-lib" gen-lib false "$WORK/gen-libir" --per-language > "$WORK/gen-parse.log" 2>&1
bash "$REPO/bin/axiomcode" all --language csharp --src "$WORK/gen-cli" --out "$WORK/gen-out" \
  --library "$WORK/gen-libir" --version pinned --debug > "$WORK/gen.log" 2>&1
GEN="$WORK/gen-out/csharp/raw/call-chain-edges.csv"
# The assertion is on the SECOND hop. The first -- `o.Value` -- reaches the
# library's own accessor and was already produced; what was missing is that its
# RESULT had a type, so `.Enabled()` reached a client method instead of nothing.
# Keyed on provenance and tier rather than on a hash, because the client IR the
# pipeline builds internally is not written where a test can read it back.
second=$(awk -F'\t' '$5=="client" && $6=="known_edge" && $7=="method"' "$GEN" 2>/dev/null | wc -l | tr -d ' ')
if [ "${second:-0}" -lt 1 ]; then
  fail "a call on a STAGED generic type's \`T\`-typed member reaches nothing: the type argument is not substituted across provenance"
  awk -F'\t' '{print "        got: "$4"  "$5"  "$6"  "$7}' "$GEN" 2>/dev/null | head -5
fi
if grep -q "ambiguous_unknown" "$GEN" 2>/dev/null; then
  fail "a chain through a staged GENERIC type still has a blind spot"
fi

# ── THE ACCESSOR PATH, THE LARGER HALF BY VOLUME ────────────────────────────
# A property read, a property write, a get-only read and both indexer directions
# on a STAGED type. member_lookup answers with the library's property and every
# fact about it -- its accessors, whether it is an indexer, what the accessor
# dispatches to -- is under "lib", so all five used to produce no edge at all.
mkdir -p "$WORK/acc-lib" "$WORK/acc-cli"
cat > "$WORK/acc-lib/Lib.cs" <<'EOF2'
namespace LibNs;

public class Box
{
    public int Count { get; set; }
    public string Name => "n";
    public int this[int i] { get => i; set { } }
}
EOF2
cat > "$WORK/acc-cli/Use.cs" <<'EOF2'
using LibNs;
namespace CliNs;

public static class Use
{
    public static int ReadProp(Box b) => b.Count;
    public static void WriteProp(Box b) { b.Count = 3; }
    public static string ReadOnly(Box b) => b.Name;
    public static int ReadIdx(Box b) => b[0];
    public static void WriteIdx(Box b) { b[1] = 2; }
}
EOF2
node "$REPO/parser/dist/index.js" "$WORK/acc-lib" acc-lib false "$WORK/acc-libir" --per-language > "$WORK/acc-parse.log" 2>&1
bash "$REPO/bin/axiomcode" all --language csharp --src "$WORK/acc-cli" --out "$WORK/acc-out"   --library "$WORK/acc-libir" --version pinned --debug > "$WORK/acc.log" 2>&1
ACC="$WORK/acc-out/csharp/raw/call-chain-edges.csv"
for kind in property_read property_write indexer; do
  n=$(awk -F'	' -v k="$kind" '$7==k' "$ACC" 2>/dev/null | wc -l | tr -d ' ')
  [ "${n:-0}" -ge 1 ] || fail "no $kind edge on a staged type: the accessor path stops at the boundary"
done
accn=$(wc -l < "$ACC" 2>/dev/null | tr -d ' ')
[ "${accn:-0}" -eq 5 ] || fail "expected 5 accessor edges on the staged type, got ${accn:-0}"

# ── AN ELEMENT TYPE FROM A STAGED RETURN, AND THE IMPLICIT BASES ────────────
# `h.Items()[0].Use()` needs the rank and element name off the LIBRARY's own type
# reference. And a struct's and an enum's base are library types the source never
# writes: the engine still does not invent them, but with System.ValueType and
# System.Enum staged it must derive them, or `p.ToString()` is a blind spot with
# the answer sitting in the staged IR.
mkdir -p "$WORK/rest-lib" "$WORK/rest-cli"
cat > "$WORK/rest-lib/Sys.cs" <<'EOF2'
namespace System;

public class Object
{
    public virtual string ToString() => "o";
}
public class ValueType : Object { }
public class Enum : ValueType { }
EOF2
cat > "$WORK/rest-lib/Coll.cs" <<'EOF2'
namespace LibNs;

public class Holder { public Item[] Items() => null!; }
public class Item { public void Use() { } }
EOF2
cat > "$WORK/rest-cli/Use.cs" <<'EOF2'
using LibNs;
namespace CliNs;

public struct Pt { public int X; }
public enum Col { Red }

public static class Use
{
    public static void Elem(Holder h) { h.Items()[0].Use(); }
    public static string StructBase(Pt p) => p.ToString();
    public static string EnumBase(Col c) => c.ToString();
}
EOF2
node "$REPO/parser/dist/index.js" "$WORK/rest-lib" rest-lib false "$WORK/rest-libir" --per-language > "$WORK/rest-parse.log" 2>&1
bash "$REPO/bin/axiomcode" all --language csharp --src "$WORK/rest-cli" --out "$WORK/rest-out"   --library "$WORK/rest-libir" --version pinned --debug > "$WORK/rest.log" 2>&1
REST="$WORK/rest-out/csharp/raw/call-chain-edges.csv"
if grep -q "ambiguous_unknown" "$REST" 2>/dev/null; then
  fail "a staged return's element type or an implicit base is still a blind spot"
  awk -F'	' '$6=="ambiguous_unknown"{print "        "$4"  "$6"  "$7}' "$REST" | head -3
fi
restn=$(awk -F'	' '$6=="boundary_lib"' "$REST" 2>/dev/null | wc -l | tr -d ' ')
[ "${restn:-0}" -eq 4 ] || fail "expected 4 resolved edges (Items, the element's Use, and two implicit-base ToString), got ${restn:-0}"

# ── A KEYWORD NAMES A STAGED FRAMEWORK TYPE ─────────────────────────────────
# `string` and `System.String` are the same type, and nothing recorded that, so a
# staged framework was useless to source written in keywords. `string` and
# `object` head the list of receiver types that block resolution.
mkdir -p "$WORK/alias-lib" "$WORK/alias-cli"
cat > "$WORK/alias-lib/Sys.cs" <<'EOF2'
namespace System;
public class Object { public virtual string ToString() => "o"; }
public class String : Object { public String Trim() => this; public int Length => 0; }
EOF2
cat > "$WORK/alias-cli/Use.cs" <<'EOF2'
namespace CliNs;
public static class Use
{
    public static string Keyword(string s) => s.Trim();
    public static int Prop(string s) => s.Length;
}
EOF2
node "$REPO/parser/dist/index.js" "$WORK/alias-lib" alias-lib false "$WORK/alias-libir" --per-language > "$WORK/alias-parse.log" 2>&1
bash "$REPO/bin/axiomcode" all --language csharp --src "$WORK/alias-cli" --out "$WORK/alias-out"   --library "$WORK/alias-libir" --version pinned --debug > "$WORK/alias.log" 2>&1
AL="$WORK/alias-out/csharp/raw/call-chain-edges.csv"
aln=$(awk -F'	' '$6=="boundary_lib"' "$AL" 2>/dev/null | wc -l | tr -d ' ')
[ "${aln:-0}" -eq 2 ] || fail "a keyword-typed receiver did not reach the staged framework type: got ${aln:-0} of 2"
grep -q "external:" "$AL" 2>/dev/null && fail "a keyword-typed receiver was still labelled external although its type is staged"

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
