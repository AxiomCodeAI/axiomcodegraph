// MALFORMED ON PURPOSE — the only file in this tree that is not
// syntactically valid C#.
//
// It exists so the `cs_parse_gap` relation has something to be measured
// against, and so the ERROR_LOCAL / ERROR_PARTIAL / ERROR_TRUNCATING buckets
// (validated at 98.0% / 50.6% / 22.7% declaration recovery against Roslyn) have
// a fixture with a known answer.
//
// The damage is deliberately LOCAL: the malformed member sits between two
// well-formed types, so a parser that recovers correctly still emits both of
// them, and one that truncates emits only the first. That difference is the
// measurement.
using System;

namespace Fixtures.NonCompiling;

// Well-formed, BEFORE the damage. Must be recovered.
public class BeforeTheError
{
    public int First => 1;

    public string Second() => "ok";
}

public class ContainsTheError
{
    public int Fine => 1;

    // A missing closing parenthesis: local damage inside one member.
    public int Broken(int a, int b
    {
        return a + b;
    }

    public int AlsoFine => 2;
}

// Well-formed, AFTER the damage. A parser that truncates loses this entirely,
// which is exactly what the TRUNCATING bucket measures.
public class AfterTheError
{
    public int Third => 3;

    public string Fourth() => "ok";
}

public enum AlsoAfter
{
    A,
    B
}
