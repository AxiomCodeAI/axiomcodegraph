// CS-CORPUS-22 residual at fork8: a TUPLE TYPE as the generic argument of a
// creation — `new HashSet<(string Name, string? Schema)>(...)` — is still read
// as comparisons: OBJECT_CREATION ends at the type name, then a TUPLE row, then a
// BINARY. Fork rule 8 covers `new Foo<T>(x)` for a simple type argument. Three
// corpus sites, all NAMED tuple types. Measured at cs-impl@888985c.
using System.Collections.Generic;
namespace Fixtures.WalkGaps;

public class TtA { } public class TtB { }
public class TupleTypeAsGenericArgumentOfCreation
{
    // GAP: tuple type argument with names.
    public static HashSet<(string Name, string? Schema)> Named(IEnumerable<(string Name, string? Schema)> src)
        => new HashSet<(string Name, string? Schema)>(src);
    // NOT REPRODUCED at 888985c (kept as a control): unnamed tuple type argument — walked.
    public static List<(TtA, TtB)> Unnamed() => new List<(TtA, TtB)>(4);
    // CONTROL: tuple type argument with KEYWORD element types — no ambiguity, walked.
    public static List<(int, int)> UnnamedKeywordTypes() => new List<(int, int)>(4);
    // CONTROL: a simple generic argument with an argument list — fork rule 8.
    public static HashSet<string> Control(IEnumerable<string> src) => new HashSet<string>(src);
    // CONTROL: the tuple type in a declaration, not a creation.
    public static (string Name, string? Schema) Decl() => ("a", null);
}
