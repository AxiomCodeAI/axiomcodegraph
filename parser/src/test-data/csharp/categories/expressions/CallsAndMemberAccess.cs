// Port of java/expressions/{ExpressionStatementTests,ObjectCreationTestCases,
// QualifiedConstructorTest}.java — every way C# invokes something, which is the
// list BUILDING-A-PARSER.md section 5 says to enumerate before calling the call
// relation done. Delegate invocation, method-group conversion and extension
// invocation are C#-only and live in ../../csharp-only/delegates/ and
// ../../csharp-only/extensions/.
using System;
using System.Collections.Generic;
using System.Text;

namespace Fixtures.Ported.Expressions;

public class Receiver
{
    public Receiver()
    {
    }

    public Receiver(int seed)
        : this()
    {
        Seed = seed;
    }

    public int Seed { get; set; }

    public Receiver Inner { get; set; }

    public int Value;

    public int Instance() => 1;

    public int Instance(int a) => a;

    public int Instance(int a, string b) => a + b.Length;

    public static int Static() => 2;

    public static int Static(int a) => a;

    public T Generic<T>(T value) => value;

    public int Optional(int required, int optional = 5, string named = "n") => required + optional + named.Length;

    public int Params(params int[] values) => values.Length;

    public virtual int Virtual() => 3;

    public int this[int index] => index;

    public int this[string key, int index] => key.Length + index;
}

public class Derived : Receiver
{
    public Derived()
        : base(1)
    {
    }

    public Derived(int seed)
        : base(seed)
    {
    }

    public override int Virtual() => base.Virtual() + 1;

    public int CallsBaseMember() => base.Instance() + base.Seed;
}

public class CallExamples
{
    private Receiver receiver = new Receiver();

    private static readonly Receiver Shared = new Receiver(1);

    public void InvocationForms()
    {
        // Unqualified call to a member of `this`.
        Local();

        // Qualified through `this`.
        this.Local();

        // Instance call through a field, a property, a local and a chain.
        receiver.Instance();
        receiver.Inner.Instance();
        receiver.Inner.Inner.Instance();
        Receiver local = receiver;
        local.Instance();

        // Static call, qualified and namespace-qualified.
        Receiver.Static();
        Fixtures.Ported.Expressions.Receiver.Static();
        global::Fixtures.Ported.Expressions.Receiver.Static();

        // Overload selection by arity and by type.
        receiver.Instance(1);
        receiver.Instance(1, "two");
        Receiver.Static(3);

        // Explicit and inferred type arguments.
        receiver.Generic<int>(1);
        receiver.Generic("inferred");

        // Named and optional arguments, in and out of order.
        receiver.Optional(1);
        receiver.Optional(1, 2);
        receiver.Optional(1, named: "x");
        receiver.Optional(named: "x", required: 1, optional: 2);
        receiver.Optional(optional: 2, required: 1);

        // params, in every calling form.
        receiver.Params();
        receiver.Params(1);
        receiver.Params(1, 2, 3);
        receiver.Params(new[] { 1, 2, 3 });

        // Call on a parenthesised expression, on a cast, and on a `new`.
        (receiver).Instance();
        ((Receiver)receiver).Instance();
        new Receiver().Instance();
        new Receiver(1).Inner?.Instance();

        // Call on the result of a call.
        receiver.Generic(receiver).Instance();

        // Null-conditional invocation, in all three forms.
        receiver?.Instance();
        receiver?.Inner?.Instance();
        _ = receiver?[0];
        _ = receiver?.Inner?[1];

        // Element access: array, indexer, two-argument indexer, dictionary.
        int[] data = { 1, 2, 3 };
        _ = data[0];
        _ = receiver[0];
        _ = receiver["k", 1];
        var map = new Dictionary<string, int> { ["a"] = 1 };
        _ = map["a"];

        // Nested call arguments.
        receiver.Instance(receiver.Instance(receiver.Instance(1)));

        // Call in an argument, in a ternary, in an interpolation and in an
        // initialiser — positions where a non-emitting parent has swallowed
        // whole subtrees in other front ends.
        Console.WriteLine(receiver.Instance());
        _ = (receiver.Instance() > 0) ? receiver.Instance(1) : Receiver.Static();
        _ = $"{receiver.Instance()}";
        var list = new List<int> { receiver.Instance(), Receiver.Static() };
        _ = list.Count;
        _ = (receiver.Instance());
        _ = ((receiver.Instance()));
    }

    private int Local() => 0;

    public void ConstructorInvocationForms()
    {
        // Object creation, with and without arguments.
        _ = new Receiver();
        _ = new Receiver(1);

        // Target-typed new (C# 9) — the type is on the left.
        Receiver targetTyped = new();
        Receiver targetTypedWithArgs = new(2);
        _ = targetTyped.Seed + targetTypedWithArgs.Seed;

        // Object initialiser, nested object initialiser, collection initialiser,
        // dictionary initialiser and index initialiser.
        _ = new Receiver { Seed = 1 };
        _ = new Receiver { Seed = 1, Inner = new Receiver { Seed = 2 } };
        _ = new List<int> { 1, 2, 3 };
        _ = new List<Receiver> { new Receiver(1), new Receiver(2) };
        _ = new Dictionary<string, int> { { "a", 1 }, { "b", 2 } };
        _ = new Dictionary<string, int> { ["a"] = 1, ["b"] = 2 };
        _ = new Receiver { Value = 1, Seed = 2 };

        // Generic construction, nested generic construction, constructed from
        // a type parameter.
        _ = new List<Dictionary<string, List<int>>>();
        _ = Create<Receiver>();

        // Array creation in all forms.
        _ = new int[3];
        _ = new int[] { 1, 2 };
        _ = new[] { 1, 2 };
        _ = new int[2, 2];
        _ = new int[2][];
        _ = new Receiver[] { new Receiver(), new Receiver(1) };

        // Anonymous type — the nearest C# thing to a Java anonymous class, and
        // it is NOT the same: it declares data only and has no base type or
        // interface. Java's anonymous class ports to a lambda or a local class,
        // and C# has no local class, so this is a genuine gap in both
        // directions.
        var anonymous = new { Name = "n", Count = 1 };
        var anonymousProjected = new { anonymous.Name, Total = anonymous.Count + 1 };
        _ = anonymous.Name + anonymousProjected.Total;

        // A StringBuilder chain — the shape that dominates real call graphs.
        _ = new StringBuilder().Append('a').Append(1).AppendLine("b").ToString();
    }

    private static T Create<T>() where T : new() => new T();

    public void MemberAccessForms()
    {
        // Field, property, auto-property, static member, const, nested chain.
        _ = receiver.Value;
        _ = receiver.Seed;
        _ = Shared.Seed;
        _ = receiver.Inner.Inner.Value;
        _ = int.MaxValue;
        _ = string.Empty;
        _ = Math.PI;
        _ = DateTime.Now.Year;
        _ = typeof(Receiver).Name;
        _ = nameof(Receiver.Seed);
        _ = "literal".Length;
        _ = new int[1].Length;
        _ = (1 + 2).ToString();
        _ = 42.ToString();
        _ = 'c'.ToString();
    }
}
