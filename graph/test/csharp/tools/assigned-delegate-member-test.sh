#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A FUNCTION ASSIGNED TO AN INTERFACE'S DELEGATE MEMBER THROUGH A PROPERTY CHAIN
# REACHES THE CALLS MADE THROUGH THAT MEMBER (#1283).
#
# `inst.I.Run = x => ...` stores a lambda in the `Run` property of the object
# `inst.I` names, and `schema.I.Run(value)` calls whatever is stored there. The
# stored function goes to the dispatch envelope with basis `value`, keyed on the
# member (resolution/delegates.dl); this test is that envelope over the shapes
# #1283 names, which the oracle has no opinion on:
#
#   - `inst.I.Run = inst.I.Parse` COPIES a member: Run holds what Parse holds;
#   - the callers are lambdas whose parameter has no written type -- converted to
#     a generic delegate declared in source, a plain one, `Func`, and one under a
#     cast -- so the call through Run has a receiver only when the parameter is
#     typed by the delegate (resolution/lambda-parameters.dl);
#   - a parameter typed by a constrained type parameter (resolution/generics.dl).
#
# FOUR THINGS ARE ASSERTED:
#
#   1. the envelope is EXACTLY the expected (member, lambda line) pairs. The
#      control is a third member of the same type, `Other`, whose lambda must not
#      appear behind Run or Parse, and Run must not gain Other's;
#   2. every call through Run reaches Run's node, and the call through Other only
#      Other's;
#   3. the walk impact makes from the `x + 1` lambda -- stored in Parse, copied to
#      Run -- reaches every caller of Run and of Parse;
#   4. the walk from Other's lambda reaches its own caller and no caller of Run.
#
# Exit 0 if every assertion holds, 1 otherwise, 0 with SKIP if the toolchain is
# absent -- matching delegate-field-value-test.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(d="$HERE"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
[ -f "$ROOT/parser/dist/index.js" ] || { echo "assigned-delegate-member-test: SKIP (parser not built)"; exit 0; }
command -v souffle  >/dev/null || { echo "assigned-delegate-member-test: SKIP (no souffle)";  exit 0; }
command -v sqlite3  >/dev/null || { echo "assigned-delegate-member-test: SKIP (no sqlite3)";  exit 0; }

W="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$W"' EXIT
fail=0; bad(){ echo "  ✗ $*"; fail=$((fail+1)); }

mkdir -p "$W/src"
# Line numbers are asserted below: the lambdas are named `<lambda>`, so a lambda
# is identified by the line it starts on. Edit the source and the lines together.
cat > "$W/src/Assigned.cs" <<'CS'
using System;

namespace Cases.AssignedMembers;

public interface IInternals
{
    Func<int, int> Parse { get; set; }
    Func<int, int> Run { get; set; }
    Func<int, int> Other { get; set; }
}

public interface ISchema
{
    IInternals I { get; }
}

public delegate int ParseFn<T>(T schema, int value) where T : ISchema;
public delegate int PlainFn(ISchema schema, int value);

public static class Setup
{
    public static void Init(ISchema inst, bool check)
    {
        inst.I.Parse = x => x + 1;
        if (!check)
        {
            inst.I.Run = inst.I.Parse;
        }
        else
        {
            inst.I.Run = x => inst.I.Parse(x) * 2;
        }
        inst.I.Other = x => x - 1;
    }
}

public static class Parsers
{
    public static readonly ParseFn<ISchema> Parse = (schema, value) => schema.I.Run(value);
    public static readonly PlainFn Plain = (schema, value) => schema.I.Run(value);
    public static readonly Func<ISchema, int, int> Generic = (schema, value) => schema.I.Run(value);
    public static readonly Func<ISchema, int, int> Cast = (Func<ISchema, int, int>)((schema, value) => schema.I.Run(value));

    public static int ParseTyped(ISchema schema, int value) => schema.I.Run(value);
    public static int Constrained<T>(T schema, int value) where T : ISchema => schema.I.Run(value);

    public static int UsesOther(ISchema schema, int value) => schema.I.Other(value);
}
CS

"$ROOT/bin/axiomcode" all "$W/src" "$W/out" --language csharp --version pinned-v1 > "$W/log" 2>&1 \
  || { echo "  ✗ the run failed:"; tail -8 "$W/log"; exit 1; }
DB="$W/out/csharp/graph.sqlite"
[ -f "$DB" ] || { echo "  ✗ no graph.sqlite at $DB"; exit 1; }
q(){ sqlite3 -separator ' ' "$DB" "$1"; }
N=Cases.AssignedMembers.IInternals

# ── 1. THE ENVELOPE, EXACTLY ────────────────────────────────────────────────
got="$(q "SELECT b.qualified_name, c.start_line FROM dispatch_candidates d
          JOIN methods b ON b.id = d.base_method_id JOIN methods c ON c.id = d.candidate_method_id
          WHERE d.basis = 'value' ORDER BY 1, 2")"
want="$N.Other.Invoke 33
$N.Parse.Invoke 24
$N.Run.Invoke 24
$N.Run.Invoke 31"
[ "$got" = "$want" ] || { bad "the value envelope is not the expected pairs (Run.Invoke 24 is the copy from Parse):"; diff <(echo "$want") <(echo "$got") | sed 's/^/      /'; }

# ── 2. THE CALLS THROUGH A MEMBER REACH ITS NODE ────────────────────────────
callers(){ q "SELECT c.name || ':' || c.start_line FROM call_edges e JOIN methods b ON b.id = e.callee_method_id
              JOIN methods c ON c.id = e.caller_id WHERE b.qualified_name = '$1' ORDER BY c.start_line" | tr '\n' ' '; }
[ "$(callers $N.Run.Invoke)" = "<lambda>:39 <lambda>:40 <lambda>:41 <lambda>:42 ParseTyped:44 Constrained:45 " ] \
  || bad "calls through Run: '$(callers $N.Run.Invoke)', expected the lambdas typed by ParseFn<ISchema> (39), PlainFn (40), Func (41) and a cast (42), ParseTyped (44) and Constrained (45)"
[ "$(callers $N.Parse.Invoke)" = "<lambda>:31 " ] || bad "calls through Parse: '$(callers $N.Parse.Invoke)', expected the lambda at 31"
[ "$(callers $N.Other.Invoke)" = "UsesOther:47 " ] || bad "the control member's node has callers '$(callers $N.Other.Invoke)', expected UsesOther only"

# ── 3/4. THE WALK impact MAKES ──────────────────────────────────────────────
# candidate -> base (the envelope), then base -> its callers (call_edges), to a fixpoint.
reach(){ q "WITH RECURSIVE r(id) AS (
    SELECT id FROM methods WHERE file_path LIKE '%Assigned.cs' AND name = '<lambda>' AND start_line = $1
    UNION SELECT e.caller_id FROM call_edges e JOIN r ON e.callee_method_id = r.id
    UNION SELECT d.base_method_id FROM dispatch_candidates d JOIN r ON d.candidate_method_id = r.id)
  SELECT m.name || ':' || m.start_line FROM r JOIN methods m ON m.id = r.id
  WHERE m.provenance = 'client' ORDER BY m.start_line" | tr '\n' ' '; }
r="$(reach 24)"
for m in '<lambda>:31' '<lambda>:39' '<lambda>:40' '<lambda>:41' '<lambda>:42' 'ParseTyped:44' 'Constrained:45'; do
  case " $r" in *" $m "*) ;; *) bad "the x + 1 lambda does not reach $m (reached: $r)";; esac
done
case " $r" in *" UsesOther:47 "*) bad "the x + 1 lambda reaches UsesOther, which calls through a DIFFERENT member";; esac
r="$(reach 33)"
case " $r" in *" UsesOther:47 "*) ;; *) bad "Other's lambda does not reach UsesOther (reached: $r)";; esac
case " $r" in *" ParseTyped:44 "*) bad "Other's lambda reaches ParseTyped, which calls through Run";; esac

[ "$fail" = 0 ] && echo "assigned-delegate-member-test: ok" || { echo "assigned-delegate-member-test: $fail FAILED"; exit 1; }
