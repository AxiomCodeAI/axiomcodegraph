// Port of java/annotations/{MarkerAnnotationTest,SingleValueAnnotationTest,
// NamedArgAnnotationTest,test-all-value-types,test-array-annotations,
// test-nested-annotations,ParameterAnnotationTest}.java
using System;
using System.Diagnostics.CodeAnalysis;

namespace Fixtures.Ported.Attributes;

[Marker]
public class MarkerUsage
{
    [Marker]
    private int field;

    [Marker]
    public void Method()
    {
    }
}

[SingleValue("class-level")]
public class SingleValueUsage
{
    // Named form of the same single positional argument.
    [SingleValue(value: "explicitly-named")]
    public int Property { get; set; }

    [SingleValue("method-level")]
    public void Method([SingleValue("param-level")] int p)
    {
    }
}

[NamedArg("first", Order = 1, Enabled = false)]
[NamedArg("second", 2, Target = typeof(MarkerUsage))]
public class MultipleUsage
{
}

[ValueTypes(
    1,
    -1,
    2,
    3,
    4,
    5U,
    6L,
    7UL,
    8.5f,
    9.5d,
    'x',
    true,
    "literal",
    Level = Severity.High,
    Codes = new[] { 1, 2, 3 },
    Tags = new string[] { "a", "b" },
    Handler = typeof(SingleValueUsage),
    Boxed = 42)]
public class AllValueTypesUsage
{
}

// Array argument in both the explicit and the collection-initializer spelling.
[ValueTypes(0, 0, 0, 0, 0, 0U, 0L, 0UL, 0f, 0d, '\0', false, "", Codes = new int[] { })]
[ValueTypes(0, 0, 0, 0, 0, 0U, 0L, 0UL, 0f, 0d, '\0', false, "", Tags = new[] { "only" })]
public class ArrayArgumentUsage
{
}

// Constant expressions, nameof, and a const field as attribute arguments.
public class ComputedArgumentUsage
{
    public const string Prefix = "cfg";

    // A BARE IDENTIFIER as an attribute argument — a const of the enclosing
    // type, referenced unqualified. Distinct from the `Prefix + "..."` form
    // below, which is a binary expression, and from `Severity.High`, which is a
    // member access. Closes CsAttributeArgumentValueKind.IDENTIFIER.
    [SingleValue(Prefix)]
    public string BareIdentifierArgument;

    // A NULL argument, positionally and as a named member. Closes
    // CsAttributeArgumentValueKind.NULL.
    [SingleValue(null)]
    public string NullPositionalArgument;

    [NamedArg("named", Target = null)]
    public string NullNamedArgument;

    [ValueTypes(0, 0, 0, 0, 0, 0U, 0L, 0UL, 0f, 0d, '\0', false, null, Codes = null, Handler = null)]
    public string NullEverywhere;

    [SingleValue(Prefix + ".enabled")]
    public bool Enabled;

    [SingleValue(nameof(ComputedArgumentUsage))]
    public string SelfName;

    [ValueTypes(0, 0, 0, 0, 2 * 3 + 1, 0U, 0L, 0UL, 0f, 0d, '\0', true, nameof(Prefix))]
    public void WithConstExpressions()
    {
    }
}

public class TargetedUsage
{
    // EXPLICIT `type:` — redundant here and legal, and the only way to attach
    // to the type when the declaration could take an attribute on something
    // else. Closes CsAttributeTarget.TYPE.
    [type: Marker]
    public sealed class ExplicitTypeTarget
    {
        public int Value => 1;
    }

    // Explicit target specifiers: C# has these, Java does not.
    [field: Marker]
    public int AutoProperty { get; set; }

    [return: Flow("out")]
    public int Returns([Flow("in")] int value) => value;

    // THREE different targets on ONE field-like event, and each attaches to a
    // different generated member: `event:` to the event itself, `field:` to the
    // compiler-generated backing delegate, `method:` to the add/remove
    // accessors. Two of the three name members with no declaration syntax.
    [event: SingleValue("on-the-event")]
    [field: Marker]
    [method: SingleValue("on-the-accessor-method")]
    public event EventHandler Raised;

    [method: SingleValue("on-the-constructor")]
    public TargetedUsage(int seed)
    {
    }
}

// Attribute on a type parameter and on a generic method's type parameter.
public class GenericAttributeUsage<[TypeParam("element")] TItem>
{
    public void Convert<[TypeParam("target")] TOut>(TItem item)
    {
    }
}

// EXPLICIT `typevar:` target. Inside a type-parameter list the default target
// is already the type parameter, so this is the redundant-but-legal spelling —
// and it is the only one that produces CsAttributeTarget.TYPEVAR rather than
// NONE.
public class ExplicitTypeVarTarget<[typevar: TypeParam("explicit")] TItem>
{
    public TItem Value { get; set; }

    public void Method<[typevar: TypeParam("explicit-method")] TOut>()
    {
    }
}

// Real BCL attributes carrying nullability contracts — the shape that appears
// throughout the BCL.
public class BclAttributeUsage
{
    [return: NotNullIfNotNull(nameof(input))]
    public static string Echo(string input) => input;

    public static bool TryGet([MaybeNullWhen(false)] out string value)
    {
        value = "found";
        return true;
    }

    [Obsolete("Superseded by Echo", error: false)]
    public static string Legacy(string input) => Echo(input);

    [DoesNotReturn]
    public static void Fail() => throw new InvalidOperationException();
}

[StrictlyTimed]
public class InheritedAttributeUsage
{
}

public class DerivedFromInherited : InheritedAttributeUsage
{
}
