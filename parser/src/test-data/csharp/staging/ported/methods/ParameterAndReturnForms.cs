// Port of java/methods/MethodParamsTest.java, restricted to the forms Java has
// or nearly has. The C#-only parameter MODES — ref, out, in, ref readonly and
// the `this` marker of an extension method — are covered in depth at
// ../../csharp-only/parameters/ParameterModes.cs, because each is a distinct
// dataflow channel rather than a spelling.
using System;
using System.Collections.Generic;

namespace Fixtures.Ported.Methods;

// SELF-CONTAINED BY RULE. `categories/` is canonical for both blessing and
// running, and no fixture reference may cross a project boundary: a type
// reached through a ProjectReference resolves as a METADATA symbol with zero
// DeclaringSyntaxReferences, which is unadjudicable and would read as a parser
// defect that is really an artifact of partitioning. This file used to reach
// into ported/attributes/ for its attribute types; it now declares the one it
// needs as a `file`-local class, which cannot collide and cannot be referenced
// from anywhere else.
[AttributeUsage(AttributeTargets.Parameter | AttributeTargets.ReturnValue)]
file sealed class FlowAttribute : Attribute
{
    public FlowAttribute(string direction) => Direction = direction;

    public string Direction { get; }
}

[AttributeUsage(AttributeTargets.All)]
file sealed class TagAttribute : Attribute
{
    public TagAttribute(string value) => Value = value;

    public string Value { get; }
}

public class ParameterForms
{
    // Zero, one and many positional parameters.
    public void None() { }

    public void One(int a) { }

    public void Many(int a, string b, double c, object d) { }

    // Reference, value, array, generic, nested-generic, tuple and delegate
    // parameter types.
    public void EveryTypeShape(
        string reference,
        int value,
        int[] array,
        int[][] jagged,
        int[,] rectangular,
        List<int> generic,
        Dictionary<string, List<int>> nestedGeneric,
        (int Id, string Name) tuple,
        Func<int, int> delegateTyped,
        Action callback,
        IEnumerable<KeyValuePair<string, int>> interfaceTyped,
        object boxed,
        DateTime structTyped,
        int? nullableValue)
    {
    }

    // Optional parameters with every kind of default. Java has none of this;
    // Java's answer is an overload family.
    public int Defaults(
        int required,
        int number = 1,
        double real = 1.5,
        string text = "default",
        string nullText = null,
        bool flag = false,
        char ch = 'x',
        DateTime dateTime = default,
        int? nullableNumber = null,
        OverloadKind kind = OverloadKind.Second,
        int computed = 2 * 3)
    {
        return required + number + (int)real + text.Length + (nullText?.Length ?? 0)
            + (flag ? 1 : 0) + ch + dateTime.Year + (nullableNumber ?? 0) + (int)kind + computed;
    }

    // `params` — Java's varargs, same position rule (last), different keyword,
    // and callable with an explicit array.
    public int Params(params int[] values) => values.Length;

    public int ParamsAfterRequired(string first, params object[] rest) => first.Length + rest.Length;

    public int ParamsOfStrings(params string[] values) => values.Length;

    // Attributes on parameters and on the return value.
    public int Attributed(
        [Flow("in")] int input,
        [Tag("tagged")] string tagged) => input + tagged.Length;

    // Named arguments at the CALL site — a caller-side construct that changes
    // nothing about the declaration and everything about the call row.
    public void CallSites()
    {
        Defaults(1);
        Defaults(1, 2);
        Defaults(1, text: "x");
        Defaults(required: 1, flag: true, number: 9);
        Defaults(1, 2, 3.5, "t", null, true, 'y');

        Params();
        Params(1);
        Params(1, 2, 3);
        Params(new[] { 1, 2, 3 });

        ParamsAfterRequired("a");
        ParamsAfterRequired("a", 1, "b", 2.0);

        Many(1, "b", 2.0, null);
        Many(a: 1, c: 2.0, b: "b", d: null);
    }
}

public enum OverloadKind
{
    First,
    Second
}
