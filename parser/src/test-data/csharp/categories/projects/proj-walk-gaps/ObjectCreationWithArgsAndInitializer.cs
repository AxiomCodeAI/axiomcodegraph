// CS-CORPUS-22: `new T(args) { a, b }` — an explicit object creation with an
// argument list AND A COLLECTION INITIALIZER — has a CONSTRUCTOR_CALL row that
// ends at the `)`. Roslyn's ObjectCreationExpression ends at the initializer's
// `}`. The parser's own `new T(args) { P = v }` (object initializer), `new() { }`
// and `new T { }` rows all end at the `}`, so this is the one shape of four that
// ends early: an inconsistency inside one relation. Measured at cs-impl@f42baba.
using System.Collections.Generic;
namespace Fixtures.WalkGaps;

public class OcNode { public HashSet<OcNode> Children { get; set; } = new(); }
public class OcHolder { public HashSet<OcNode> Required { get; set; } = new(); }

public class ObjectCreationWithArgsAndInitializer
{
    // GAP: argument list + collection initializer (span ends at `)`).
    public static HashSet<OcNode> ArgsAndCollectionInitializer()
        => new HashSet<OcNode>(EqualityComparer<OcNode>.Default) { new(), new() };

    // CONTROL: argument list + OBJECT initializer — the row spans the initializer.
    public static OcHolderWithCtor ArgsAndObjectInitializer()
        => new OcHolderWithCtor(1) { Required = new HashSet<OcNode>() };

    // GAP: nested — the outer creation and the inner both carry args + initializer.
    public static OcHolder Nested() => new OcHolder
    {
        Required = new HashSet<OcNode>(EqualityComparer<OcNode>.Default)
        {
            new() { Children = new HashSet<OcNode>(EqualityComparer<OcNode>.Default) { new(), new() } }
        }
    };

    // CONTROL: implicit `new() { ... }` — the row spans the initializer.
    public static OcNode ImplicitWithInitializer() => new() { Children = new HashSet<OcNode>() };

    // CONTROL: `new T { ... }` without an argument list — the row spans the initializer.
    public static OcHolder NoArgsWithInitializer() => new OcHolder { Required = new HashSet<OcNode>() };

    // CONTROL: `new T(args)` without an initializer.
    public static HashSet<OcNode> ArgsOnly() => new HashSet<OcNode>(EqualityComparer<OcNode>.Default);
}
public class OcHolderWithCtor { public OcHolderWithCtor(int n) { } public HashSet<OcNode> Required { get; set; } = new(); }
