// FIELDS, and every modifier one can carry.
//
// Closing a coverage hole found by running cs-impl's enum audit against this
// corpus: five of the twelve `CsFieldModifier` values — PROTECTED, INTERNAL,
// REQUIRED, UNSAFE and NEW — were declared and unreached. Fields appeared all
// over the corpus and always as `private` or `public`, which is what a corpus
// grown construct-by-construct looks like: the interesting axis was never the
// one being varied.
//
// UNSAFE and FIXED need <AllowUnsafeBlocks>, so they live in
// ../../proj-unsafe/UnsafeFields.cs. The other ten are here.
using System;
using System.Collections.Generic;

namespace Fixtures.Ported.TypeRegistry;

public class FieldModifierMatrix
{
    // All six accessibility levels, on FIELDS rather than on types or methods.
    public int PublicField;

    private int privateField;

    protected int ProtectedField;

    internal int InternalField;

    protected internal int ProtectedInternalField;

    private protected int PrivateProtectedField;

    // No modifier: `private` by default in a class, exactly as for a method,
    // and not the same as Java's package-private default.
    int DefaultIsPrivate;

    // static, readonly, const, volatile — and the combinations that are legal.
    public static int StaticField;

    public readonly int ReadOnlyField;

    public static readonly int StaticReadOnlyField = 1;

    public const int ConstField = 2;

    private const string ConstString = "k";

    public volatile int VolatileField;

    private static volatile bool staticVolatileField;

    // `required` on a FIELD, not a property (C# 11). The object initialiser
    // must set it, which is a constructor obligation expressed on a field.
    public required int RequiredField;

    public required string RequiredReferenceField;

    // Multiple declarators in one declaration: one modifier set, three fields.
    public int First, Second, Third;

    private static readonly int SharedA = 1, SharedB = 2;

    // Initialiser forms.
    private int fromLiteral = 1;
    private int fromExpression = 2 * 3;
    private string fromCall = string.Empty;
    private List<int> fromNew = new List<int>();
    private int[] fromArray = { 1, 2, 3 };
    private Func<int, int> fromLambda = x => x + 1;
    private (int Id, string Name) fromTuple = (1, "n");
    private int? nullableField = null;

    public FieldModifierMatrix()
    {
        // A readonly field is assignable only here or in its declaration.
        ReadOnlyField = 3;
        privateField = 1;
        DefaultIsPrivate = 1;
        _ = privateField + DefaultIsPrivate + fromLiteral + fromExpression
            + fromCall.Length + fromNew.Count + fromArray.Length + fromLambda(1)
            + fromTuple.Id + (nullableField ?? 0) + SharedA + SharedB
            + (staticVolatileField ? 1 : 0);
    }
}

// `new` on a FIELD — hides an inherited field of the same name. The base field
// still exists and is still reachable through a base-typed reference, so this
// is two distinct storage locations with one name.
public class FieldHidingBase
{
    public int Shadowed = 1;

    protected string Name = "base";

    internal static int Counter = 0;
}

public class FieldHidingDerived : FieldHidingBase
{
    // Three `new` fields, one per accessibility, because the modifier combines.
    public new int Shadowed = 2;

    protected new string Name = "derived";

    internal static new int Counter = 1;

    public int Both()
    {
        // Both storage locations, from the same object.
        int fromDerived = Shadowed;
        int fromBase = ((FieldHidingBase)this).Shadowed;
        int alsoBase = base.Shadowed;
        return fromDerived + fromBase + alsoBase + Name.Length + base.Name.Length;
    }
}

// Fields on every declaration kind that permits them.
public struct StructFields
{
    public int Public;
    private int privateValue;
    internal readonly int InternalReadOnly;
    public static int Static;
    public const int Const = 1;

    public StructFields(int seed)
    {
        Public = seed;
        privateValue = seed;
        InternalReadOnly = seed;
    }

    public int Sum() => Public + privateValue + InternalReadOnly;
}

public readonly struct ReadOnlyStructFields
{
    // Every instance field of a readonly struct must itself be readonly.
    public readonly int Value;

    public static int Shared;

    public ReadOnlyStructFields(int value) => Value = value;
}

public record RecordFields(int Id)
{
    private readonly int extra = 1;

    public static int Shared;

    public int Extra => extra;
}

public interface IWithConstant
{
    // An interface may declare a CONST and a static field, and neither is an
    // instance field — interfaces have no instance state.
    const int Version = 1;

    static int Counter = 0;
}

public class RequiredFieldConsumer
{
    // `required` forces the object initialiser to set both.
    public FieldModifierMatrix Build() => new FieldModifierMatrix
    {
        RequiredField = 1,
        RequiredReferenceField = "r",
    };
}
