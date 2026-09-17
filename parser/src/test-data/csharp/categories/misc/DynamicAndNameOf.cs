// HALF TWO — `dynamic`, and `nameof`.
//
// `dynamic` is A CALL THE SYNTAX CANNOT RESOLVE. Overload resolution, member
// lookup and conversion all move to RUNTIME, so `d.Anything(1, 2)` binds to
// nothing at compile time and Roslyn's own GetSymbolInfo returns no symbol.
// The schema RESERVES `DYNAMIC_CALL` with a zero-row assertion for exactly the
// reason TypeScript reserves `INDEX_CALL`: it is a fact about a value's runtime
// type, not something readable from syntax. Guessing would be wrong more often
// than right. This file is what the zero-row assertion is asserted against.
//
// `nameof` is the opposite: a compile-time constant whose ARGUMENT is a
// reference the compiler resolves and then throws away. The result is a string
// and the reference is real, which is why an extractor that treats `nameof(X)`
// as a call gets the kind wrong and one that treats it as a literal loses the
// reference.
using System;
using System.Collections.Generic;
using System.Dynamic;

namespace Fixtures.CSharpOnly.Misc;

public class DynamicUsage
{
    // `dynamic` in every declaration position. It is a distinct TYPE reference
    // that erases to object in metadata and carries [Dynamic] as an attribute.
    public dynamic Field = 1;

    public dynamic Property { get; set; } = "s";

    public List<dynamic> Generic = new();

    public dynamic[] Array = System.Array.Empty<dynamic>();

    public Dictionary<string, dynamic> Map = new();

    public Func<dynamic, dynamic> Delegate = d => d;

    public dynamic Returns() => 1;

    public void Accepts(dynamic value)
    {
    }

    public void AcceptsOptional(dynamic value = null!)
    {
    }

    // Calls THROUGH a dynamic receiver: none of these resolve at compile time.
    public void UnresolvableCalls(dynamic receiver)
    {
        // A method call with no known target.
        receiver.AnyMethod();
        receiver.AnyMethod(1);
        receiver.AnyMethod(1, "two", new object());

        // A property read and write with no known member.
        object read = receiver.AnyProperty;
        receiver.AnyProperty = 1;

        // An indexer with no known indexer.
        object element = receiver[0];
        receiver[0] = 1;

        // An operator with no known overload.
        dynamic sum = receiver + receiver;
        dynamic negated = -receiver;
        bool compared = receiver > receiver;

        // A chain, where every hop is unresolvable.
        object? chained = receiver.First().Second().Third;

        // A cast from dynamic, which is a runtime conversion.
        int asInt = (int)receiver;
        string asString = receiver;

        // A foreach over a dynamic, which looks up GetEnumerator at runtime.
        foreach (var item in receiver)
        {
            Console.WriteLine(item);
        }

        // An await on a dynamic.
        _ = read?.ToString() + element + sum + negated + compared + asInt + asString + chained;
    }

    // A call with a KNOWN receiver and a DYNAMIC ARGUMENT: the receiver's
    // overload set is known, and which overload runs is decided at runtime.
    // This is the case where the parser has a real target list and cannot pick.
    public void DynamicArgument(dynamic value)
    {
        Overloaded(value);
        Overloaded(1, value);
        Console.WriteLine(value);
        _ = string.Concat(value, value);
    }

    private static void Overloaded(int value)
    {
    }

    private static void Overloaded(string value)
    {
    }

    private static void Overloaded(int a, string b)
    {
    }

    private static void Overloaded(int a, int b)
    {
    }

    // ExpandoObject and DynamicObject: members that exist only at runtime.
    public void Expando()
    {
        dynamic expando = new ExpandoObject();
        expando.Name = "n";
        expando.Count = 1;
        expando.Nested = new ExpandoObject();
        expando.Nested.Deep = true;
        expando.Method = (Func<int, int>)(x => x + 1);
        int result = expando.Method(1);

        // The same object through its non-dynamic interface, where every member
        // IS resolvable.
        var asDictionary = (IDictionary<string, object>)expando;
        asDictionary["Added"] = 2;
        bool has = asDictionary.ContainsKey("Name");

        _ = result + asDictionary.Count + (has ? 1 : 0);
    }

    public sealed class Bag : DynamicObject
    {
        private readonly Dictionary<string, object?> values = new();

        public override bool TryGetMember(GetMemberBinder binder, out object? result) =>
            values.TryGetValue(binder.Name, out result);

        public override bool TrySetMember(SetMemberBinder binder, object? value)
        {
            values[binder.Name] = value;
            return true;
        }

        public override bool TryInvokeMember(
            InvokeMemberBinder binder,
            object?[]? args,
            out object? result)
        {
            result = binder.Name.Length;
            return true;
        }
    }

    public int ThroughDynamicObject()
    {
        dynamic bag = new Bag();
        bag.Anything = 1;
        object? read = bag.Anything;
        int invoked = bag.AnyMethod(1, 2);
        return invoked + (read is int i ? i : 0);
    }
}

public class NameOfUsage
{
    private int field;

    public int Property { get; set; }

    public event EventHandler? Raised;

    public void Method(int parameter)
    {
        // Every kind of thing nameof can name. Each argument is a REFERENCE the
        // compiler resolves; the result is the last identifier, as a constant.
        int local = 1;
        string ofLocal = nameof(local);
        string ofParameter = nameof(parameter);
        string ofField = nameof(field);
        string ofProperty = nameof(Property);
        string ofMethod = nameof(Method);
        string ofEvent = nameof(Raised);
        string ofType = nameof(NameOfUsage);
        string ofNamespaceQualified = nameof(Fixtures.CSharpOnly.Misc.NameOfUsage);
        string ofNestedMember = nameof(NameOfUsage.Property);
        string ofOtherTypeMember = nameof(DynamicUsage.Field);
        string ofGenericType = nameof(List<int>);
        // `nameof(List<>)` — an unbound generic — is C# 14 and does NOT
        // compile at LangVersion 12 (CS0305). Recorded, not simulated.
        string ofConstructedGeneric = nameof(List<string>);
        string ofEnumMember = nameof(DayOfWeek.Monday);
        string ofNamespace = nameof(System.Collections);
        string ofThisMemberChain = nameof(this.Property);

        // nameof in the positions where it actually appears: an argument name
        // in an exception, an attribute argument, a property-changed
        // notification and a string interpolation.
        if (parameter < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(parameter));
        }

        ArgumentNullException.ThrowIfNull(ofLocal, nameof(ofLocal));
        Raised?.Invoke(this, EventArgs.Empty);
        string interpolated = $"{nameof(Property)}={Property}";

        // A `const` initialised from nameof, proving it is a compile-time
        // constant and not a call.
        const string Constant = nameof(NameOfUsage);

        // nameof as a `case` label and as an attribute argument — positions
        // that only accept constants.
        switch (ofType)
        {
            case nameof(NameOfUsage):
                break;
        }

        _ = ofLocal + ofParameter + ofField + ofProperty + ofMethod + ofEvent
            + ofType + ofNamespaceQualified + ofNestedMember + ofOtherTypeMember
            + ofGenericType + ofConstructedGeneric + ofEnumMember + ofNamespace
            + ofThisMemberChain + interpolated + Constant + local;
    }

    // nameof in an ATTRIBUTE argument, including one referring to a parameter
    // of the same method — the CallerArgumentExpression / NotNullIfNotNull
    // shape, where the string must match a parameter name and nameof is how
    // real code keeps it matching.
    [return: System.Diagnostics.CodeAnalysis.NotNullIfNotNull(nameof(input))]
    public static string? Echo(string? input) => input;

    public static void Guard(
        object? value,
        [System.Runtime.CompilerServices.CallerArgumentExpression(nameof(value))]
        string? expression = null)
    {
        if (value is null)
        {
            throw new ArgumentNullException(expression);
        }
    }

    public void UsesGuard()
    {
        // `expression` receives the literal text "Property" with no argument
        // written at the call site — an argument supplied by the COMPILER from
        // the source text of another argument.
        Guard(Property);
        Guard(field + 1);
    }
}
