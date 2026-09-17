// CS-CORPUS-27: `new Outer<T>.Nested(args)` — a creation whose type is a nested
// type of a generic type — is present with the right span at fork8 but emitted
// as INVOCATION / METHOD_CALL. Roslyn: ObjectCreationExpression, methodKind
// Constructor. Nine corpus sites in three strata. Before fork8 the row was
// absent; the fix in presence introduced a defect in kind — the class no row
// count can see. Measured at cs-impl@888985c.
namespace Fixtures.WalkGaps;

public class Outer<T>
{
    public sealed class Builder { public Builder(int capacity) { } }
    public struct Enumerator { public Enumerator(object root) { } }
}
public class Plain { public sealed class Builder { public Builder(int capacity) { } } }

public class NestedTypeOfGenericCreation
{
    // GAP: nested class of a generic type.
    public static Outer<int>.Builder NestedClass() => new Outer<int>.Builder(4);
    // GAP: nested struct of a generic type, as a using-declaration initializer.
    public static void NestedStruct() { var e = new Outer<string>.Enumerator(new object()); }
    // CONTROL: nested type of a NON-generic type — CONSTRUCTOR_CALL.
    public static Plain.Builder NestedOfPlain() => new Plain.Builder(4);
    // CONTROL: the generic type itself — CONSTRUCTOR_CALL (fork rule 8).
    public static Outer<int> GenericItself() => new Outer<int>();
}
