#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A STAGED C# LIBRARY IS REACHABLE FROM CLIENT CODE (#1064).
#
# Before this, it was not. Every rule producing a type-name candidate bound ONE
# provenance across the module side and the declaration side, so a client file
# could only reach a client declaration, and a run with a library staged was
# byte-identical to a run with nothing staged. The assembly guard written to
# admit a library group key for a client module filters CANDIDATES, and no rule
# produced a cross-provenance candidate, so it had nothing to admit.
#
# TWO HALVES, AND THE SECOND IS THE ONE THAT PROTECTS EVERYONE ELSE:
#
#   1. with the library staged, each client call carries a real callee_method_id
#      whose provenance is `lib` -- not merely a name label;
#   2. STAGING LOSES NO SITE. Not "changes no site": staging REVEALS accessor
#      sites, because `x[i]` is only known to be an indexer call once the
#      indexer is declared somewhere. On one dev-set project 35 such sites
#      appeared. What may never happen is a site going away.
#
# The second half is asserted because the repair is a change to shared
# resolution rules, not to a library-only path: a rule that widened a join would
# show up here as a site set that moved, on a fixture with no library involved.
#
# And the UNSTAGED run is asserted too, in its own right: the README's rule is
# that an unstaged type is a NAMED BOUNDARY, not a blind spot. Every site in the
# unstaged run must carry an `external:` label, because a repair that made those
# sites resolvable-in-principle and then failed to resolve them would turn a
# named boundary into ambiguous_unknown, which is strictly less information than
# not staging at all. That regression happened once during this work.
#
# Exit 0 if every assertion holds, 1 otherwise, 0 with SKIP if the toolchain is
# absent -- matching library-staging-test.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
[ -f "$ROOT/parser/dist/index.js" ] || { echo "library-resolution-test: SKIP (parser not built)"; exit 0; }
command -v souffle  >/dev/null || { echo "library-resolution-test: SKIP (no souffle)";  exit 0; }
command -v sqlite3  >/dev/null || { echo "library-resolution-test: SKIP (no sqlite3)";  exit 0; }

W="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$W"' EXIT
fail=0; bad(){ echo "  ✗ $*"; fail=$((fail+1)); }

mkdir -p "$W/src" "$W/lib/System/Text"
# The client. Every statement is a shape the issue names: a constructor, an
# instance call, a chained call through a return type, a property, and a call on
# a type the source never says derives from anything.
cat > "$W/src/App.cs" <<'CS'
namespace Probe;

using System.Text;

public static class App
{
    public static void Go(string input)
    {
        var sb = new StringBuilder();
        sb.Append(input);
        sb.ToString().Trim();
        int n = input.Length;
        input.GetType();
        var r = new Rune();
    }
}
CS
# The library. A hand-written stand-in for what a producer of library IR from
# reference assembly metadata would emit: signatures only, no bodies.
cat > "$W/lib/System/Object.cs" <<'CS'
namespace System;

public class Object
{
    public virtual string ToString() => throw null!;
    public Type GetType() => throw null!;
}
CS
cat > "$W/lib/System/String.cs" <<'CS'
namespace System;

public sealed class String
{
    public int Length => throw null!;
    public string Trim() => throw null!;
    public override string ToString() => throw null!;
}
CS
cat > "$W/lib/System/Type.cs" <<'CS'
namespace System;

public abstract class Type
{
    public string Name => throw null!;
}
CS
# A library type that declares NO constructor. The real one has several; a
# signature subset that omits them is the normal case, and `call_ctor_implicit`
# would otherwise assert "this type declares no constructor, so there is no user
# code to call" about a type the engine simply was not told enough about.
cat > "$W/lib/System/Text/Rune.cs" <<'CS'
namespace System.Text;

public sealed class Rune
{
    public int Value => throw null!;
}
CS
cat > "$W/lib/System/Text/StringBuilder.cs" <<'CS'
namespace System.Text;

public sealed class StringBuilder
{
    public StringBuilder() { }
    public StringBuilder Append(string value) => throw null!;
    public override string ToString() => throw null!;
}
CS

# --version is PINNED on both runs. It defaults to `git rev-parse HEAD` of the
# source directory and is part of every primary key, so two runs of the same
# source at different commits share no hashes at all and the site-set comparison
# below would compare two disjoint sets and pass for the wrong reason.
run(){ "$ROOT/bin/axiomcode" all "$W/src" "$1" --language csharp --version pinned-v1 ${2:+--library "$2"} > "$1.log" 2>&1; }

run "$W/bare" ""          || { echo "  ✗ the client-only run failed:"; tail -8 "$W/bare.log"; exit 1; }
run "$W/staged" "$W/lib"  || { echo "  ✗ the staged run failed:";      tail -8 "$W/staged.log"; exit 1; }
BARE="$W/bare/csharp/graph.sqlite"; STAGED="$W/staged/csharp/graph.sqlite"
for db in "$BARE" "$STAGED"; do [ -f "$db" ] || { bad "no graph.sqlite at $db"; exit 1; }; done

q(){ sqlite3 "$1" "$2"; }

# ── The fixture has to bite. A count of 0 passes every assertion below. ──────
sites="$(q "$BARE" "select count(*) from call_sites")"
[ "${sites:-0}" -ge 5 ] || bad "NEGATIVE CONTROL FAILED: the fixture yields $sites call site(s), expected at least 5 -- every assertion below is vacuous on an empty set"

# ── 1. THE STAGED RUN RESOLVES INTO THE LIBRARY ─────────────────────────────
into_lib="$(q "$STAGED" "select count(*) from call_edges where callee_provenance='lib' and callee_method_id!=''")"
[ "${into_lib:-0}" -ge 5 ] || bad "$into_lib call edge(s) reach a library METHOD, expected at least 5. A name label is not a resolution: the staged declaration is in the fact base and the site has to reach it"
for m in Append ToString Trim get_Length GetType; do
  c="$(q "$STAGED" "select count(*) from call_edges e join methods m on m.id=e.callee_method_id where m.name='$m' and m.provenance='lib'")"
  [ "${c:-0}" -ge 1 ] || bad "no call edge reaches the library's $m"
done
# The constructor specifically: keyed on the site's provenance it found none and
# the engine then ASSERTED the type declares none, which is a wrong claim rather
# than a miss.
# READ FROM ext_call_class, NOT call_edges.tier. Both are exported, and they are
# not the same question: where a site also has an external LABEL the bundle shows
# the external edge, so `tier` reads boundary_lib whether or not the engine ALSO
# classified the site known_implicit_ctor. The claim lives in call_class, so that
# is where it has to be refused -- asserting on `tier` here passed with the guard
# deleted, which is how this check was found to be testing nothing.
ctor="$(q "$STAGED" "select count(*) from ext_call_class where c2='known_implicit_ctor'")"
# AND A CONSTRUCTOR THE LIBRARY DOES DECLARE IS RESOLVED, not merely named.
# Without this the constructor path is satisfied by the naming clause alone: break
# the lookup and every assertion here still passes, because an unresolved `new`
# gets external:<Type>.<constructor> and reads exactly like a resolved one at the
# tier level.
newres="$(q "$STAGED" "select count(*) from call_edges e join methods m on m.id=e.callee_method_id where e.kind='new' and m.provenance='lib'")"
[ "${newres:-0}" -ge 1 ] || bad "no new-expression site resolves to a library constructor, though the staged library declares one. A named boundary is not a resolution"

[ "${ctor:-0}" = "0" ] || bad "$ctor site(s) classified known_implicit_ctor. That tier asserts the type declares NO constructor and there is no user code to call; about a library IR, which is a signature subset, the engine cannot know any such thing. The fixture constructs both a staged type that declares a constructor and one that does not"

# ── 2. STAGING CHANGES NO SITE ──────────────────────────────────────────────
a="$(q "$BARE"   "select count(*) from call_sites")"
[ "${a:-0}" -ge 1 ] || bad "NEGATIVE CONTROL FAILED: the client-only run lists no call site, so the set comparison below compares two empty sets and passes for the wrong reason"
lost="$(sqlite3 "$BARE" "attach '$STAGED' as s; select count(*) from call_sites b where not exists (select 1 from s.call_sites t where t.id=b.id)")"
[ "${lost:-1}" = "0" ] || bad "$lost call site(s) present WITHOUT the library are absent WITH it. A site that ceases to exist is worse than one that resolves to nothing, and call_site_dropped cannot see it: the site was never built rather than built and discarded"
for db in "$BARE" "$STAGED"; do
  d="$(q "$db" "select count(*) from ext_call_site_dropped")"
  [ "${d:-1}" = "0" ] || bad "call_site_dropped is $d in $(basename "$(dirname "$(dirname "$db")")")"
done

# ── 3. AN UNSTAGED TYPE IS A NAMED BOUNDARY, AND STAGING NEVER COSTS ────────
# The client-only run is NOT asserted to have zero blind spots: `sb.ToString()
# .Trim()` has no receiver type without the library, so there is no name to put
# on the boundary and ambiguous_unknown is the honest answer. That one site is
# present at clean main too, so pinning it to zero here would fail for a defect
# this change does not own.
#
# What IS asserted is the direction. Staging must never turn a NAMED boundary
# into a blind spot, and during this work it did: a half-applied repair made
# those sites resolvable-in-principle and then failed to resolve them, taking
# `external:List.Add` down to ambiguous_unknown -- strictly less information than
# not staging at all.
named="$(q "$BARE" "select count(*) from call_edges where callee_label like 'external:%'")"
[ "${named:-0}" -ge 5 ] || bad "only $named site(s) in the client-only run carry an external: label, expected at least 5"
bare_blind="$(q "$BARE"   "select count(*) from call_edges where tier='ambiguous_unknown'")"
stg_blind="$(q  "$STAGED" "select count(*) from call_edges where tier='ambiguous_unknown'")"
[ "${stg_blind:-1}" -le "${bare_blind:-0}" ] || bad "staging the library RAISED the blind-spot count from $bare_blind to $stg_blind. A named boundary became a blind spot, which is less information than not staging at all"
[ "${stg_blind:-1}" = "0" ] || bad "$stg_blind site(s) are still ambiguous_unknown with the library staged; every receiver in this fixture is declared by it"

# ── 4. A MEMBER THE LIBRARY DOES NOT CARRY IS STILL NAMED ───────────────────
# A library IR is a signature SUBSET -- staging.conf stages signatures and never
# bodies, and any producer covers a subset of the real assembly -- so a member
# that is not in it is one the engine WAS NOT TOLD ABOUT, never one that does not
# exist. `Substring` is declared here with one parameter and called with two, and
# `NoSuchMember` is not declared at all; both must come back as NAMED boundaries.
#
# Keyed the other way, staging made the fact base worse for every partially
# covered type: measured on one dev-set project, ten sites went from a named
# boundary to a blind spot and 32 property reads ceased to exist entirely.
mkdir -p "$W/src2"
cat > "$W/src2/Partial.cs" <<'CS'
namespace Probe;

using System.Text;

public static class Partial
{
    public static void Go(string input, StringBuilder sb)
    {
        input.Substring(1, 2);
        input.NoSuchMember();
        int c = sb.Capacity;
        int m = sb.MaxCapacity;
    }
}
CS
"$ROOT/bin/axiomcode" all "$W/src2" "$W/partial" --language csharp --version pinned-v1 --library "$W/lib" > "$W/partial.log" 2>&1 || { echo "  ✗ the partial-coverage run failed:"; tail -8 "$W/partial.log"; exit 1; }
P2="$W/partial/csharp/graph.sqlite"
if [ -f "$P2" ]; then
  n="$(q "$P2" "select count(*) from call_sites")"
  # FOUR sites: two method calls and two PROPERTY READS. The property reads are
  # the ones that vanished -- `property_access` needs the member and
  # `external_property_read` fired only where the receiver's type was UNSTAGED,
  # so a staged type with an uncarried property satisfied neither and the site
  # was never built.
  [ "${n:-0}" -ge 4 ] || bad "the partial-coverage fixture yields $n site(s), expected at least 4 -- a member absent from the library must still produce a site, and a property read is the shape that ceased to exist"
  reads="$(q "$P2" "select count(*) from call_sites where kind like 'property%'")"
  [ "${reads:-0}" -ge 2 ] || bad "only $reads property-read site(s) for two reads of properties the library does not carry; the site is not built at all when the type is staged and the property is not"
  blind="$(q "$P2" "select count(*) from call_edges where tier='ambiguous_unknown'")"
  [ "${blind:-1}" = "0" ] || bad "$blind site(s) calling a member the library does not carry are blind spots. The TYPE is staged and known, so the site is still a NAMED boundary; absence from a signature subset proves nothing"
  named="$(q "$P2" "select count(*) from call_edges where callee_label like 'external:%'")"
  [ "${named:-0}" -ge 4 ] || bad "only $named site(s) touching an uncarried member are named, expected at least 4"
fi

[ $fail = 0 ] && echo "library-resolution-test: ok" || { echo "library-resolution-test: $fail failure(s)"; exit 1; }
