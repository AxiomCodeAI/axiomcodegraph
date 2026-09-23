#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A DELEGATE STORED IN A FIELD REACHES THE CALLS MADE THROUGH IT (#1206).
#
# `getPath(url)` on a `Func<string, string>` field binds to the delegate's Invoke,
# and before this the engine resolved it to nothing: `impact` on the method stored
# in the field reached none of the code calling through it. The fix does not touch
# the site's resolved target (cases/11-delegate-fields scores that against Roslyn);
# it gives every call through such a member an edge to one synthetic Invoke node
# per member, and puts the stored functions in the dispatch envelope with basis
# `value`. This test is the envelope's half, which the oracle has no opinion on.
#
# FOUR THINGS ARE ASSERTED, and the controls are what make them bite:
#
#   1. the envelope is EXACTLY the expected (member, stored function) pairs. Exact,
#      not "at least", because the failure a value-flow rule invites is the
#      over-eager one: a member keyed by its delegate TYPE would put `Other` behind
#      `getPath`, and `made = Make()` would store `Make` itself;
#   2. every call through a member reaches its node as a call edge, and a call
#      through a LOCAL or a PARAMETER of delegate type does not (that is not a
#      field, and it stays what it was);
#   3. the node is a methods row, so the envelope joins;
#   4. the walk impact makes -- a candidate up to its base, then the callers of the
#      base -- gets from GetPath to Dispatch, the Fetch lambda, Main2 and Handle,
#      and does NOT get to the caller of the other field of the same type.
#
# Exit 0 if every assertion holds, 1 otherwise, 0 with SKIP if the toolchain is
# absent -- matching library-resolution-test.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(d="$HERE"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
[ -f "$ROOT/parser/dist/index.js" ] || { echo "delegate-field-value-test: SKIP (parser not built)"; exit 0; }
command -v souffle  >/dev/null || { echo "delegate-field-value-test: SKIP (no souffle)";  exit 0; }
command -v sqlite3  >/dev/null || { echo "delegate-field-value-test: SKIP (no sqlite3)";  exit 0; }

W="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$W"' EXIT
fail=0; bad(){ echo "  ✗ $*"; fail=$((fail+1)); }

mkdir -p "$W/src"
# The scored case, as it is: every shape in it is also an envelope assertion below.
cp "$HERE/../cases/11-delegate-fields/src/DelegateFields.cs" "$W/src/"
# And the shapes the score cannot read (see the case file's header for why): a
# declared delegate type, a property, a call on a freshly constructed receiver --
# and a STATIC holder, whose type is never instantiated.
cat > "$W/src/Unscored.cs" <<'CS'
using System;

namespace Cases.DelegateFields;

public delegate string PathFn(string url);

public class Holder
{
    static string Named(string url) => url;
    static string Prop(string url) => url;

    private PathFn named = Named;
    public Func<string, string> Handler { get; set; } = Prop;

    public string ViaNamed(string url) => named(url);
    public string ViaProperty(string url) => Handler(url);
    public static string Main3() => new App().Fetch("/a?b");
}

public static class Routes
{
    static string Home(string url) => url;
    public static readonly Func<string, string> Handler = Home;
    public static string Serve(string url) => Routes.Handler(url);
}
CS

"$ROOT/bin/axiomcode" all "$W/src" "$W/out" --language csharp --version pinned-v1 > "$W/log" 2>&1 \
  || { echo "  ✗ the run failed:"; tail -8 "$W/log"; exit 1; }
DB="$W/out/csharp/graph.sqlite"
[ -f "$DB" ] || { echo "  ✗ no graph.sqlite at $DB"; exit 1; }
q(){ sqlite3 -separator ' ' "$DB" "$1"; }

# ── 1. THE ENVELOPE, EXACTLY ────────────────────────────────────────────────
got="$(q "SELECT b.qualified_name, c.name FROM dispatch_candidates d
          JOIN methods b ON b.id = d.base_method_id JOIN methods c ON c.id = d.candidate_method_id
          WHERE d.basis = 'value' ORDER BY 1, 2")"
want="Cases.DelegateFields.App.Fetch.Invoke <lambda>
Cases.DelegateFields.App.getPath.Invoke GetPath
Cases.DelegateFields.App.getPath.Invoke GetPathLoose
Cases.DelegateFields.App.late.Invoke Fallback
Cases.DelegateFields.App.late.Invoke Late
Cases.DelegateFields.App.named.Invoke Appended
Cases.DelegateFields.App.named.Invoke Initial
Cases.DelegateFields.App.other.Invoke Other
Cases.DelegateFields.Holder.Handler.Invoke Prop
Cases.DelegateFields.Holder.named.Invoke Named
Cases.DelegateFields.Routes.Handler.Invoke Home"
[ "$got" = "$want" ] || { bad "the value envelope is not the expected pairs:"; diff <(echo "$want") <(echo "$got") | sed 's/^/      /'; }
[ -n "$got" ] || bad "NEGATIVE CONTROL FAILED: the envelope is empty, so nothing below can bite"

# ── 2. THE CALLS THROUGH A MEMBER REACH ITS NODE ────────────────────────────
callers(){ q "SELECT DISTINCT c.name FROM call_edges e JOIN methods b ON b.id = e.callee_method_id
              JOIN methods c ON c.id = e.caller_id WHERE b.qualified_name = '$1' ORDER BY 1" | tr '\n' ' '; }
[ "$(callers Cases.DelegateFields.App.getPath.Invoke)" = "Dispatch ViaInvoke ViaThis " ] \
  || bad "calls through getPath: '$(callers Cases.DelegateFields.App.getPath.Invoke)', expected Dispatch (bare), ViaThis (this.) and ViaInvoke (.Invoke)"
[ "$(callers Cases.DelegateFields.App.Fetch.Invoke)" = "Handle Main2 Main3 " ] \
  || bad "calls through Fetch: '$(callers Cases.DelegateFields.App.Fetch.Invoke)', expected Handle (a parameter), Main2 (a local) and Main3 (new App())"
[ "$(callers Cases.DelegateFields.App.late.Invoke)" = "ViaConditional " ] || bad "late?.Invoke does not reach late's node"
[ "$(callers Cases.DelegateFields.App.named.Invoke)" = "ViaNamed " ] || bad "named!(x) does not reach named's node"
[ "$(callers Cases.DelegateFields.Holder.Handler.Invoke)" = "ViaProperty " ] || bad "a call through a property does not reach its node"
[ "$(callers Cases.DelegateFields.Routes.Handler.Invoke)" = "Serve " ] || bad "Type.f(x) on a static field does not reach its node"
[ "$(callers Cases.DelegateFields.App.other.Invoke)" = "UsesOther " ] || bad "the control field's node has callers '$(callers Cases.DelegateFields.App.other.Invoke)', expected UsesOther only"
# CONTROL: a local and a parameter of delegate type are not fields, and a field
# nothing is seen storing a function into (`made = Make()`) keeps no node.
for m in ViaLocal Apply UsesMade; do
  t="$(q "SELECT group_concat(e.tier) FROM call_edges e JOIN methods c ON c.id = e.caller_id WHERE c.name = '$m' AND e.kind = 'delegate'")"
  [ "$t" = "ambiguous_unknown" ] || bad "the delegate call in $m is '$t', expected it to stay ambiguous_unknown"
done
[ "$(q "SELECT count(*) FROM methods WHERE qualified_name LIKE '%.made.Invoke'")" = "0" ] || bad "a node exists for 'made', which holds a call's result, not a function"

# ── 3. THE NODE IS A METHODS ROW ────────────────────────────────────────────
n="$(q "SELECT count(*) FROM dispatch_candidates d WHERE d.basis = 'value'
        AND NOT EXISTS (SELECT 1 FROM methods m WHERE m.id = d.base_method_id AND m.provenance = 'generated')")"
[ "$n" = "0" ] || bad "$n value pair(s) name a base with no generated methods row"

# ── 4. THE WALK impact MAKES ────────────────────────────────────────────────
# candidate -> base (the envelope), then base -> its callers (call_edges), to a fixpoint.
reach="$(q "WITH RECURSIVE r(id) AS (
    SELECT id FROM methods WHERE qualified_name = 'Cases.DelegateFields.App.GetPath'
    UNION SELECT e.caller_id FROM call_edges e JOIN r ON e.callee_method_id = r.id
    UNION SELECT d.base_method_id FROM dispatch_candidates d JOIN r ON d.candidate_method_id = r.id)
  SELECT DISTINCT m.name FROM r JOIN methods m ON m.id = r.id WHERE m.provenance = 'client' ORDER BY 1" | tr '\n' ' ')"
for m in Dispatch '<lambda>' Main2 Handle Main3 ViaThis ViaInvoke; do
  case " $reach" in *" $m "*) ;; *) bad "GetPath does not reach $m (reached: $reach)";; esac
done
for m in UsesOther ViaConditional ViaNamed; do
  case " $reach" in *" $m "*) bad "GetPath reaches $m, which calls through a DIFFERENT field";; esac
done

[ "$fail" = 0 ] && echo "delegate-field-value-test: ok" || { echo "delegate-field-value-test: $fail FAILED"; exit 1; }
