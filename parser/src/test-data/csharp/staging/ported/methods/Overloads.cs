// Port of java/methods/MethodOverloadPatterns.java.
// Which overload a call site picks is a question for the ORACLE
// (GetSymbolInfo().Symbol as IMethodSymbol), not for the parser; this file
// covers declaration shapes and provides call sites for it to adjudicate.
using System;
using System.Collections.Generic;

namespace Fixtures.Ported.Methods;

public class OverloadPatterns
{
    // By arity.
    public int Arity() => 0;

    public int Arity(int a) => a;

    public int Arity(int a, int b) => a + b;

    public int Arity(int a, int b, int c) => a + b + c;

    // By parameter type at equal arity.
    public string ByType(int value) => "int";

    public string ByType(long value) => "long";

    public string ByType(double value) => "double";

    public string ByType(decimal value) => "decimal";

    public string ByType(string value) => "string";

    public string ByType(object value) => "object";

    public string ByType(int[] value) => "int[]";

    public string ByType(IEnumerable<int> value) => "IEnumerable<int>";

    // By parameter MODE — `ref`, `out` and `in` participate in overload
    // resolution and Java has none of them.
    public string ByMode(int value) => "value";

    public string ByMode(ref int value) => "ref";

    // `ref` and `out` differ ONLY in the modifier, so they cannot overload
    // each other (CS0663). A distinct name is the only legal spelling — a
    // constraint with no Java analogue at all.
    public string ByModeOut(out int value)
    {
        value = 0;
        return "out";
    }

    // Generic versus non-generic at the same arity: the non-generic wins when
    // both are applicable.
    public string GenericOrNot(int value) => "concrete";

    public string GenericOrNot<T>(T value) => "generic";

    // Differing type-parameter arity.
    public string Arities<T>(T a) => "one";

    public string Arities<T1, T2>(T1 a, T2 b) => "two";

    // `params` versus an exact match: the exact match wins; `params` is the
    // last resort.
    public string ParamsOrExact(int a) => "exact";

    public string ParamsOrExact(params int[] values) => "params";

    // Optional arguments versus a shorter overload: the shorter one wins.
    public string OptionalOrShorter(int a) => "shorter";

    public string OptionalOrShorter(int a, int b = 0) => "optional";

    // Nullable versus non-nullable value type.
    public string Nullability(int value) => "int";

    public string Nullability(int? value) => "int?";

    // Base versus derived parameter — the most derived applicable wins.
    public string Hierarchy(BaseWithConstructors value) => "base";

    public string Hierarchy(DerivedWithConstructors value) => "derived";

    // Static and instance overloads of the same name coexist only when their
    // signatures differ; they are NOT overloads of each other for resolution.
    public string Mixed(int value) => "instance";

    public static string Mixed(string value) => "static";

    // Call sites for every group above.
    public void CallSites()
    {
        Arity();
        Arity(1);
        Arity(1, 2);
        Arity(1, 2, 3);

        ByType(1);
        ByType(1L);
        ByType(1.0);
        ByType(1.0m);
        ByType("s");
        ByType((object)1);
        ByType(new int[0]);
        ByType(new List<int>());

        int slot = 0;
        ByMode(slot);
        ByMode(ref slot);
        ByModeOut(out slot);

        GenericOrNot(1);
        GenericOrNot("s");
        GenericOrNot<int>(1);

        Arities(1);
        Arities(1, "two");

        ParamsOrExact(1);
        ParamsOrExact(1, 2);
        ParamsOrExact();

        OptionalOrShorter(1);
        OptionalOrShorter(1, 2);

        Nullability(1);
        Nullability((int?)1);
        Nullability(null);

        Hierarchy(new DerivedWithImplicitConstructor());
        Hierarchy(new DerivedWithConstructors(1));

        Mixed(1);
        OverloadPatterns.Mixed("s");

        // Named arguments changing which overload is applicable.
        Arity(a: 1, b: 2);
        OptionalOrShorter(a: 1, b: 2);
    }
}

// Overloads split across a base and a derived type: C# resolves against the
// MOST DERIVED type that declares any applicable member, and stops. This is the
// rule that surprises people and it differs from Java's.
public class OverloadBase
{
    public string Take(int value) => "base int";
}

public class OverloadDerived : OverloadBase
{
    public string Take(object value) => "derived object";

    public string CallsBoth()
    {
        // Binds to the DERIVED object overload, not the base int overload,
        // because the derived type declares an applicable member.
        return Take(1) + base.Take(1);
    }
}
