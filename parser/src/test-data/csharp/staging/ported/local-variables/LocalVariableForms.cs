// Port of java/local-variables/LocalVariableExamples.java.
// The C#-only local forms are here too: `var`, `const` locals, `ref` locals,
// `ref readonly` locals, `using` declarations, `out var`, pattern variables,
// deconstruction and `stackalloc` into a Span.
using System;
using System.Collections.Generic;
using System.IO;
using Fixtures.Ported.LocalVariables.Support;

namespace Fixtures.Ported.LocalVariables;

public class LocalVariableExamples
{
    public void DeclarationForms()
    {
        // Declaration with no initialiser, then definite assignment.
        int uninitialised;
        uninitialised = 1;

        // Declaration with an initialiser.
        int initialised = 2;

        // Several declarators in one statement — one type, three variables,
        // one of them uninitialised.
        int a = 1, b, c = 3;
        b = 2;

        // `var`, which is inferred and is NOT Java's `var` in one respect:
        // C# forbids `var x = null;` because there is nothing to infer.
        var inferredInt = 1;
        var inferredString = "s";
        var inferredList = new List<int>();
        var inferredAnonymous = new { Name = "n" };
        var inferredFromCall = Factories.NewCustomer(1);

        // `const` locals — compile-time constants, not Java's `final`.
        const int ConstInt = 42;
        const string ConstString = "k";
        const double ConstComputed = ConstInt * 1.5;

        // `readonly` does NOT exist on a local; the closest is `const`, and
        // Java's `final` local has no exact C# form. Recorded, not invented.
        _ = uninitialised + initialised + a + b + c + inferredInt + inferredString.Length
            + inferredList.Count + inferredAnonymous.Name.Length + inferredFromCall.Id
            + ConstInt + ConstString.Length + (int)ConstComputed;
    }

    public void EveryInitialiserShape(Customer customer, int[] data)
    {
        int fromLiteral = 1;
        int fromExpression = 1 + 2 * 3;
        int fromCall = Compute();
        int fromMember = customer.Id;
        int fromChain = customer.BillingAddress.PostCode.Length;
        int fromElement = data[0];
        int fromTernary = data.Length > 0 ? data[0] : -1;
        int fromCast = (int)1.5m;
        int fromNullCoalesce = customer.Name?.Length ?? 0;
        Customer fromNew = new Customer();
        Customer fromTargetTypedNew = new();
        Func<int, int> fromLambda = x => x;
        var fromArray = new[] { 1, 2, 3 };
        var fromInitialiser = new Customer { Id = 1, Name = "n" };
        var fromCollectionInitialiser = new List<int> { 1, 2 };
        Money fromStructCtor = new Money(1m, "GBP");
        Money fromDefault = default;
        Customer fromNull = null;
        object fromBoxing = 1;
        _ = fromLiteral + fromExpression + fromCall + fromMember + fromChain + fromElement
            + fromTernary + fromCast + fromNullCoalesce + fromNew.Id + fromTargetTypedNew.Id
            + fromLambda(1) + fromArray.Length + fromInitialiser.Id + fromCollectionInitialiser.Count
            + (int)fromStructCtor.Amount + (int)fromDefault.Amount + (fromNull?.Id ?? 0)
            + fromBoxing.GetHashCode();
    }

    private int Compute() => 1;

    // `ref` and `ref readonly` locals: an ALIAS to storage, not a copy. No Java
    // form; this is the construct that makes C# assignment analysis different.
    public void RefLocals(int[] data, Customer customer)
    {
        ref int slot = ref data[0];
        slot = 42;

        ref readonly int view = ref data[1];

        ref int reassignable = ref data[2];
        reassignable = ref data[3];

        // A ref local to a field.
        ref int fieldAlias = ref counter;
        fieldAlias++;

        // scoped ref (C# 11) — restricts the lifetime.
        Span<int> span = data;
        scoped ref int scopedAlias = ref span[0];
        scopedAlias = 1;
        _ = view + customer.Id;
    }

    private int counter;

    // Pattern-declared locals — scoped to the enclosing statement or block, a
    // scoping rule with no Java-8 analogue (Java 16 `instanceof` patterns match).
    public string PatternLocals(object value)
    {
        if (value is Customer customer)
        {
            return customer.Name;
        }

        if (value is Order { Total: > 0m } order && order.Id > 0)
        {
            return order.Id.ToString();
        }

        // `is not T x` declares `text` but leaves it DEFINITELY UNASSIGNED on
        // the true branch — the binding is only assigned where the pattern
        // matched, which is the false branch here.
        if (value is not string text)
        {
            return "not a string";
        }
        else
        {
            _ = text.Length;
        }

        return value switch
        {
            Money { Currency: "GBP" } money => money.Amount.ToString(),
            int number when number > 0 => number.ToString(),
            var other => other?.ToString() ?? string.Empty
        };
    }

    // `out var` — a local declared in an argument list.
    public int OutVariables(string raw, IDictionary<string, int> map)
    {
        if (int.TryParse(raw, out int parsed))
        {
            return parsed;
        }

        if (map.TryGetValue(raw, out var found))
        {
            return found;
        }

        // A discard instead of a local.
        map.TryGetValue(raw, out _);

        // Declared out, used after the call.
        int.TryParse(raw, out int later);
        return later;
    }

    // Deconstruction into new locals, into existing ones, and mixed.
    public int Deconstruction(IDictionary<string, int> map)
    {
        (int id, string name) = Factories.ValueTuple();
        var (id2, name2) = Factories.ValueTuple();
        (int id3, var name3) = Factories.ValueTuple();

        int existing;
        string existingName;
        (existing, existingName) = Factories.ValueTuple();

        (int nestedA, (int nestedB, int nestedC)) = (1, (2, 3));

        int total = 0;
        foreach (var (key, value) in map)
        {
            total += key.Length + value;
        }

        (_, string discardedFirst) = Factories.ValueTuple();

        return id + name.Length + id2 + name2.Length + id3 + name3.Length
            + existing + existingName.Length + nestedA + nestedB + nestedC + total
            + discardedFirst.Length;
    }

    // `using` declarations and `using` statements introduce locals with a
    // disposal obligation.
    public string UsingLocals(string content)
    {
        using var reader = new StringReader(content);
        using StringWriter writer = new StringWriter();

        using (var inner = new StringReader(content))
        {
            writer.Write(inner.ReadToEnd());
        }

        writer.Write(reader.ReadToEnd());
        return writer.ToString();
    }

    // stackalloc into a Span — safe since C# 7.2, no `unsafe` required. The
    // pointer form lives in ../../proj-unsafe/.
    public int StackAlloc(int size)
    {
        Span<byte> buffer = stackalloc byte[8];
        Span<int> conditional = size > 4 ? stackalloc int[4] : stackalloc int[2];
        ReadOnlySpan<char> chars = stackalloc char[] { 'a', 'b' };
        buffer[0] = 1;
        conditional[0] = 2;
        return buffer[0] + conditional[0] + chars.Length;
    }

    // Scope: loop variables, catch bindings, switch sections, nested blocks,
    // shadowing and closure capture.
    public int Scopes(IEnumerable<int> source)
    {
        int outer = 0;

        for (int i = 0; i < 3; i++)
        {
            int perIteration = i;
            outer += perIteration;
        }

        foreach (int item in source)
        {
            int perItem = item;
            outer += perItem;
        }

        while (outer < 10)
        {
            int perLoop = 1;
            outer += perLoop;
        }

        try
        {
            int inTry = 1;
            outer += inTry;
        }
        catch (InvalidOperationException e)
        {
            outer += e.Message.Length;
        }
        catch (Exception)
        {
            outer += 1;
        }

        switch (outer)
        {
            case 1:
                int inCase = 1;
                outer += inCase;
                break;

            default:
                {
                    int inDefaultBlock = 2;
                    outer += inDefaultBlock;
                }

                break;
        }

        {
            int inBareBlock = 3;
            outer += inBareBlock;
        }

        // A local function's parameters and locals belong to the local
        // function, not to this method.
        int Nested(int seed)
        {
            int inNested = seed;
            return inNested;
        }

        // A lambda's body likewise.
        Func<int, int> lambda = seed =>
        {
            int inLambda = seed;
            return inLambda;
        };

        return outer + Nested(1) + lambda(1);
    }

    // Shadowing: a local hides a field of the same name.
    private int shadowed = 1;

    public int Shadowing()
    {
        int shadowed = 2;
        return shadowed + this.shadowed;
    }

    // Locals in a constructor, in a property accessor, in an indexer, in a
    // static constructor and in an operator — every member body kind.
    public LocalVariableExamples()
    {
        int inConstructor = 1;
        counter = inConstructor;
    }

    static LocalVariableExamples()
    {
        int inStaticConstructor = 1;
        Shared = inStaticConstructor;
    }

    public static int Shared;

    public int Property
    {
        get
        {
            int inGetter = 1;
            return inGetter;
        }

        set
        {
            int inSetter = value;
            counter = inSetter;
        }
    }

    public int this[int index]
    {
        get
        {
            int inIndexer = index;
            return inIndexer;
        }
    }

    public static LocalVariableExamples operator +(LocalVariableExamples left, LocalVariableExamples right)
    {
        int inOperator = left.counter + right.counter;
        return new LocalVariableExamples { counter = inOperator };
    }
}
