// EXPECTED FAILURES, one per CandidateReason the oracle classifies on.
// Every construct here is syntactically valid; only binding fails.
//
//   OverloadResolutionFailure  — a call with candidates and no applicable one
//   Inaccessible               — the member exists and is not reachable
//   NotAnAttributeType         — a type used as an attribute that is not one
//   Ambiguous                  — two equally good candidates
//   WrongArity                 — a generic named at the wrong arity
//   NotAValue / NotAType       — a name used in the wrong grammatical role
using System;
using System.Collections.Generic;

namespace Fixtures.NonCompiling;

public class Target
{
    private int privateField;

    private void PrivateMethod()
    {
    }

    protected int ProtectedProperty { get; set; }

    public void Overloaded(int a)
    {
    }

    public void Overloaded(string a)
    {
    }

    public void Generic<T1, T2>(T1 a, T2 b)
    {
    }
}

public class NotAnAttribute
{
}

public static class Ambiguity
{
    public static void Both(int a, long b)
    {
    }

    public static void Both(long a, int b)
    {
    }
}

public class Failures
{
    // CandidateReason.OverloadResolutionFailure — CS1503 / CS1501.
    public void OverloadResolutionFailure(Target target)
    {
        target.Overloaded(1.5);
        target.Overloaded(1, 2);
        target.Overloaded();
    }

    // CandidateReason.Inaccessible — CS0122.
    public void Inaccessible(Target target)
    {
        target.PrivateMethod();
        int read = target.privateField;
        int property = target.ProtectedProperty;
        _ = read + property;
    }

    // CandidateReason.NotAnAttributeType — CS0616.
    [NotAnAttribute]
    public void NotAnAttributeType()
    {
    }

    // CandidateReason.Ambiguous — CS0121.
    public void Ambiguous()
    {
        Ambiguity.Both(1, 1);
    }

    // CandidateReason.WrongArity — CS0305 / CS0308.
    public void WrongArity(Target target)
    {
        target.Generic<int>(1, 2);
        List<int, string> wrongArity = null!;
        _ = wrongArity;
    }

    // A name that does not exist at all — CS0103, no candidates, and therefore
    // NOT a CandidateReason case. Present so the two are distinguishable.
    public void NoSuchName()
    {
        CompletelyUndefined();
        int x = AlsoUndefined;
        _ = x;
    }

    // CS0029 — no conversion. The expression is well-formed and the types do
    // not meet.
    public void NoConversion()
    {
        int number = "not a number";
        Target target = new object();
        _ = number + target.GetHashCode();
    }

    // CS0165 — use of an unassigned local. Definite-assignment analysis, which
    // needs flow and not just binding.
    public int DefiniteAssignment(bool flag)
    {
        int value;
        if (flag)
        {
            value = 1;
        }

        return value;
    }

    // CS0161 — not all code paths return a value.
    public int MissingReturn(bool flag)
    {
        if (flag)
        {
            return 1;
        }
    }

    // CS0535 — an interface member left unimplemented. The TYPE is well-formed
    // and its member set is incomplete.
    public class Incomplete : IComparable<Incomplete>
    {
        public int Value;
    }
}
