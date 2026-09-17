// SPAN CONTAINMENT — every child expression's span lies inside its parent's —
// AND THE TWO INVARIANTS THAT ACTUALLY DISCRIMINATE THE DEFECT IT WAS DERIVED FROM.
//
// The containment invariant was derived by cs-oracle from CS-CORPUS-22 with the
// reasoning that a creation span "ending at the type name puts every child
// OUTSIDE its parent". This file was written to give that invariant something
// that fails when it regresses, and it was run at a known-bad commit (a66c352,
// before fork rule 8) and a known-good one (0b1fe4c) to prove it discriminates.
//
// IT DOES NOT. Containment reports 0 violations at BOTH commits over this file.
// The wrong parse — `new HashSet<Node>(c) { … }` read as `new HashSet < Node >
// (c){ … }`, two comparisons and a cast — does not strand children outside a
// short creation. It builds a DIFFERENT TREE: the initializer's children are
// parented to a CAST, the CAST to a BINARY, and every child sits inside its
// wrong parent. A consistent wrong tree satisfies containment.
//
// TWO INVARIANTS THAT DO DISCRIMINATE, each impossible in valid C#, measured
// on this file at the same two commits:
//
//   (a) no INITIALIZER row has a CAST parent      — a cast's operand is never a bare `{ }`
//   (b) no OBJECT_CREATION row ends on an identifier character
//                                                — a creation ends at `)`, `}`, `]`, or is `new()`
//
//   pre-fix  a66c352:  (a) 5 sites   (b) 5 sites
//   post-fix 0b1fe4c:  (a) 0         (b) 0
//
// cs-impl's own measurement of the fix — "linq-heavy-A: 4 casts-of-an-
// initializer -> 0" — is invariant (a) counted on the corpus.
//
// THE TRIGGER'S PRECONDITION IS TWO-PART, and the second part was found here:
//   1. the generic type argument is an IDENTIFIER — `Box<Node>`, `Box<T>`, not
//      `Box<int>`, because `int` cannot be an operand of `<`;
//   2. the argument list LOOKS LIKE A CAST TARGET — `(seed)`, `(A.B)` — because
//      the cast reading needs a type-shaped thing in the parentheses. With
//      `(Make())` the cast is impossible and the creation wins even unfixed.
// The first draft of this file used `Box<int>` throughout and discriminated
// nothing; the second used `(Make())` and discriminated nothing; the third is
// this one. Each shape that does NOT trigger is kept beside the ones that do,
// labelled as the control it is.
//
// The rest of the file is the containment invariant's discriminator as first
// intended — every wrapper carries a call in the last syntactic segment a short
// span would omit — because the invariant is still worth having; it just is not
// the one that catches THIS.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Fixtures.SpineInvariants;

public class Node
{
    public Node()
    {
    }

    public Node(int seed) => Seed = seed;

    public Node(int seed, string label)
    {
        Seed = seed;
        Label = label;
    }

    public int Seed { get; set; }

    public string Label { get; set; } = string.Empty;

    public Node? Child { get; set; }

    public List<int> Items { get; } = new();

    public Dictionary<string, Node> Map { get; } = new();

    public int this[int index] => index;
}

public sealed class Box<T>
{
    public Box()
    {
    }

    public Box(T value) => Value = value;

    public T? Value { get; set; }

    public Box<T>? Inner { get; set; }
}

public static class Outer
{
    public sealed class Nested<T>
    {
        public Nested(T value) => Value = value;

        public T Value { get; set; }

        public int Extra { get; set; }
    }
}

public sealed record Snapshot(int Id, string Name)
{
    public Node? Attached { get; init; }
}

public class SpanContainment
{
    private static int Call() => 1;

    private static int Call(int x) => x;

    private static string Text() => "t";

    private static Node Make() => new Node();

    private static T Id<T>(T value) => value;

    // A generic METHOD whose type argument is an identifier, returning a
    // creation with an initializer — `MakeGeneric < Node > ()` is the same
    // ambiguity on an invocation instead of a creation.
    private static Box<T> MakeGeneric<T>() where T : new() => new Box<T>(new T()) { Inner = null };

    private static int Apply(Func<int, int> f) => f(1);

    private static int Apply2(Func<int, int, int> f) => f(1, 2);

    private static int Consume(Node node) => node.Seed;

    private static int Sum(IEnumerable<int> values) => values.Sum();

    // ---------------------------------------------------------------------
    // 1. OBJECT CREATION WITH AN INITIALIZER — the CS-CORPUS-22 shapes.
    //    Every initializer carries a call, so a creation span ending at `)`
    //    or at the type name strands that call.
    // ---------------------------------------------------------------------
    public void CreationWithInitializer()
    {
        // The three measured shapes, in order of what went wrong:
        //   args + collection initializer   (span ended at `)`)
        var argsAndCollection = new List<int>(4) { 1, Call(), Call(2) };

        //   generic + args + initializer, where the TYPE ARGUMENT IS AN IDENTIFIER.
        //   This is the trigger, and the precondition is exact: `new Box<Node>(x)`
        //   can be read as `new Box < Node > (x)` — two comparisons and a cast of
        //   the initializer — ONLY because `Box` and `Node` are both plain
        //   identifiers. The wrong parse put the creation's end at the type name.
        //   The precondition is TWO-PART, and this file found the second part by
        //   running at a known-bad commit: the type argument must be an
        //   identifier AND the argument list must look like a cast target — a
        //   bare identifier `(seed)` or a member access `(A.B)`. With `(Make())`
        //   the cast reading is impossible and the creation wins even unfixed.
        Node seed = Make();
        var identifierArg = new Box<Node>(seed) { Value = Make(), Inner = new Box<Node>(seed) };
        var memberAccessArg = new HashSet<Node>(EqualityComparer<Node>.Default) { new(), Make() };
        var callArg = new Box<Node>(Make()) { Value = Make(), Inner = new Box<Node>(Make()) };
        var genericMethodTypeArg = MakeGeneric<Node>();

        //   qualified generic + identifier type argument + args + initializer
        var qualifiedGeneric = new Outer.Nested<Node>(Make()) { Extra = Call(4) };

        // CONTROL for the trigger: the SAME shapes with a KEYWORD type argument.
        // `int` cannot be an operand, so `new Box < int > (…)` is unreadable as
        // a comparison and the grammar never takes the wrong path. These
        // matched Roslyn before the fix; the identifier-argument forms did not.
        // A discriminator that used only these would have discriminated nothing
        // — which is what the first draft of this file did.
        var keywordArgInit = new Box<int>(Call()) { Value = Call(2), Inner = new Box<int>(Call(3)) };
        var keywordQualified = new Outer.Nested<int>(Call()) { Extra = Call(4) };

        // CONTROLS — the four shapes that matched Roslyn before the fix, kept
        // adjacent so a regression that handles these and not the above is
        // visible as a difference rather than a coincidence.
        var argsOnly = new Node(Call());
        var initOnly = new Node { Seed = Call() };
        var argsAndObjectInit = new Node(Call()) { Seed = Call(2) };
        var targetTyped = new Node();
        Node targetTypedInit = new() { Seed = Call() };
        Node targetTypedArgsInit = new(Call()) { Label = Text() };

        // NESTED creation with initializer — a creation inside an initializer
        // inside a creation, each level carrying a call in its own last segment.
        var nested = new Node(Call())
        {
            Seed = Call(1),
            Child = new Node(Call(2))
            {
                Seed = Call(3),
                Child = new Node { Seed = Call(4), Label = Text() },
                Items = { Call(5), Call(6) },
            },
            Items = { 1, Call(7) },
            Map = { ["k"] = new Node(Call(8)) { Label = Text() } },
        };

        // Array creations with initializers, explicit and implicit, and jagged.
        int[] explicitArray = new int[] { Call(), Call(2) };
        int[] implicitArray = new[] { Call(), Call(3) };
        int[][] jagged = new int[][] { new[] { Call() }, new int[] { Call(4) } };
        Node[] ofCreations = { new Node(Call()) { Seed = Call(5) }, new Node { Seed = Call(6) } };

        // Anonymous type with a call in the last member.
        var anonymous = new { A = Call(), B = new Node(Call(7)) { Seed = Call(8) } };

        // Collection expression (C# 12) with calls and a spread of a call result.
        int[] collectionExpression = [Call(), Call(2), .. Enumerable.Range(0, Call(3))];

        // A creation with initializer as an ARGUMENT, as a RECEIVER, and CAST —
        // the cast is the shape the wrong parse produced by accident, here on
        // purpose.
        Consume(new Node(Call()) { Seed = Call(9) });
        int viaReceiver = new Node(Call()) { Seed = Call(10) }.Seed;
        object cast = (object)new Node(Call()) { Seed = Call(11) };

        _ = argsAndCollection.Count + (identifierArg.Value?.Seed ?? 0) + memberAccessArg.Count + (callArg.Value?.Seed ?? 0)
            + (genericMethodTypeArg.Value?.Seed ?? 0) + qualifiedGeneric.Extra + keywordArgInit.Value + keywordQualified.Extra + argsOnly.Seed
            + initOnly.Seed + argsAndObjectInit.Seed + targetTyped.Seed + targetTypedInit.Seed
            + targetTypedArgsInit.Seed + nested.Seed + explicitArray.Length + implicitArray.Length
            + jagged.Length + ofCreations.Length + anonymous.A + collectionExpression.Length
            + viaReceiver + cast.GetHashCode();
    }

    // ---------------------------------------------------------------------
    // 2. LAMBDAS INSIDE ARGUMENTS — the body sits after `=>`, so a lambda or
    //    argument span that stops at the arrow strands every call in the body.
    // ---------------------------------------------------------------------
    public void LambdaInArgument()
    {
        // Expression body carrying a call.
        int a = Apply(x => Call(x));

        // Block body carrying calls, including one in a nested statement.
        int b = Apply(x =>
        {
            int inner = Call(x);
            if (inner > 0)
            {
                inner += Call(2);
            }

            return Call(inner);
        });

        // Two parameters, typed, with a call in the body.
        int c = Apply2((int x, int y) => Call(x) + Call(y));

        // A lambda in the argument of a CREATION in the argument of a call.
        int d = Consume(new Node(Apply(x => Call(x))) { Seed = Apply(y => Call(y)) });

        // A lambda whose body is another call with a lambda argument.
        int e = Apply(x => Apply(y => Call(x + y)));

        // Lambdas in LINQ arguments, chained — each receiver is the previous
        // call's whole span.
        int f = new[] { 1, 2, 3 }
            .Where(x => Call(x) > 0)
            .Select(x => Call(x) * 2)
            .Aggregate(0, (acc, x) => acc + Call(x));

        // A lambda in a NAMED argument, after a positional one.
        int g = ApplyNamed(seed: Call(), f: x => Call(x));

        // An async lambda in an argument, with an await in its body.
        Func<Task<int>> h = async () => await Task.FromResult(Call());

        // A lambda in an OBJECT INITIALIZER in an argument — three wrappers,
        // and the call is in the innermost last segment.
        int i = Consume(new Node { Seed = Apply(x => Call(x)) });

        // A lambda whose body is a creation with an initializer with a call.
        Func<Node> j = () => new Node(Call()) { Seed = Call(12) };

        _ = a + b + c + d + e + f + g + i + j().Seed + h().Id;
    }

    private static int ApplyNamed(int seed, Func<int, int> f) => f(seed);

    // ---------------------------------------------------------------------
    // 3. INTERPOLATED STRINGS CONTAINING CALLS — the hole sits after the
    //    opening quote, so a string span that stops there strands the call.
    // ---------------------------------------------------------------------
    public void InterpolatedStringWithCall()
    {
        // One hole, one call.
        string a = $"{Call()}";

        // Text before and after the hole, so the string's end is after it.
        string b = $"before {Call()} after";

        // Several holes, the LAST one a call.
        string c = $"{1} and {Text()} and {Call(2)}";

        // A hole with alignment and a format specifier — both trail the call.
        string d = $"{Call(),10:N2}|{Call(2),-8}";

        // A hole containing a lambda-bearing call.
        string e = $"{Apply(x => Call(x))}";

        // A hole containing a creation with an initializer.
        string f = $"{new Node(Call()) { Seed = Call(3) }.Seed}";

        // NESTED interpolation — a hole containing an interpolated string
        // containing a call, three levels.
        string g = $"outer {$"middle {$"inner {Call()}"}"}";

        // Verbatim and raw interpolated forms, each with a call in a hole.
        string h = $@"C:\{Text()}\{Call()}";
        string i = $"""
            raw {Call()} and {Text()}
            """;

        // A ternary inside a hole — parenthesised, as the grammar requires.
        string j = $"{(Call() > 0 ? Text() : Text())}";

        // An interpolated string as an ARGUMENT, and as a receiver.
        Consume(new Node { Label = $"{Call()}" });
        int k = $"{Call()}".Length;

        _ = a.Length + b.Length + c.Length + d.Length + e.Length + f.Length + g.Length
            + h.Length + i.Length + j.Length + k;
    }

    // ---------------------------------------------------------------------
    // 4. THE OTHER WRAPPERS WHOSE LAST SEGMENT CAN BE DROPPED.
    // ---------------------------------------------------------------------
    public void OtherWrappers(Node? maybe, int[] data, Snapshot snapshot, Dictionary<string, Node> map)
    {
        // `with` initializer — the CS-CORPUS-21 shape: the body after `with`
        // was not walked at all.
        var w = snapshot with { Name = Text(), Attached = new Node(Call()) { Seed = Call(2) } };

        // The exact corpus ancestor chain: a throw in a ternary in a coalesce in
        // a with-initializer.
        var w2 = snapshot with
        {
            Attached = maybe ?? (Call() > 0 ? Make() : throw new InvalidOperationException(Text())),
        };

        // Conditional access chain — the whole chain is one expression and the
        // call is at the end of it.
        int? ca = maybe?.Child?.Items.Count(x => Call(x) > 0);

        // Element access with a call in the index, and with index-from-end and
        // range built from calls.
        int ea = data[Call()];
        int fromEnd = data[^Call(1)];
        int[] sliced = data[Call()..Call(2)];

        // Indexer on a creation with an initializer.
        int idx = new Node(Call()) { Seed = Call(3) }[Call(4)];

        // Tuple literal with calls, and a deconstruction from a call.
        var tuple = (Call(), Text(), new Node { Seed = Call(5) });
        var (t1, t2) = (Call(), Call(6));

        // Switch expression whose arms carry calls, itself inside an argument.
        int sw = Consume(new Node { Seed = Call() switch { 0 => Call(1), _ => Call(2) } });

        // Await inside an argument, inside an initializer.
        _ = AwaitInside();

        // A query with calls in every clause.
        var q = from x in data
                let y = Call(x)
                where Call(y) > 0
                orderby Call(x) descending
                select new Node(Call(y)) { Seed = Call(x) };

        // A cast of a creation with an initializer — CS-CORPUS-22's accidental
        // parse, written deliberately, beside a cast of a parenthesised one.
        var castOfInit = (Node)new Node(Call()) { Seed = Call(7) };
        var castOfParen = (Node)(new Node(Call()) { Seed = Call(8) });

        // Relational pattern beside a ternary — the CS-CORPUS-23 shape, where
        // the pattern operand must stop before `?`.
        int rel = Call() is < -1 ? Call(1) : Call(2);
        bool qual = Call() is < int.MaxValue && Call(3) > 0;

        // Nested generic type arguments on a call, with a creation argument —
        // identifier arguments throughout, so every `<`/`>` is ambiguous.
        var gen = Id<Box<List<Node>>>(new Box<List<Node>>(new List<Node> { Make() }) { Inner = null });

        // Inside a generic method the type argument is a TYPE PARAMETER, which
        // is the most identifier-like of all: `T` is one letter and could be
        // anything.
        var viaTypeParam = InGenericMethod<Node>(Make());

        // Parenthesised, twice, around a creation with an initializer.
        var paren = ((new Node(Call()) { Seed = Call(9) }));

        _ = w.Id + w2.Id + (ca ?? 0) + ea + fromEnd + sliced.Length + idx + tuple.Item1 + t1 + t2
            + sw + q.Count() + castOfInit.Seed + castOfParen.Seed + rel + (qual ? 1 : 0)
            + (gen.Value?.Count ?? 0) + paren.Seed + map.Count + viaTypeParam.Seed;
    }

    private static Node InGenericMethod<T>(T seed) where T : Node
    {
        var boxed = new Box<T>(seed) { Inner = new Box<T>(seed) { Inner = null } };
        var set = new HashSet<T>(EqualityComparer<T>.Default) { seed };
        return boxed.Value ?? seed;
    }

    private static async Task<int> AwaitInside()
    {
        var n = new Node(await Task.FromResult(Call())) { Seed = await Task.FromResult(Call(2)) };
        return Consume(new Node { Seed = await Task.FromResult(Call(3)) }) + n.Seed;
    }
}
