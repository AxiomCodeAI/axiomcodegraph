// Port of java/expressions/AssignmentExpressionExamples.java.
// This file exists for BUILDING-A-PARSER.md section 3: the recurring defect is
// that the PARTS of an assignment get emitted and the STRUCTURE does not. Every
// shape below is chosen so that a flat emission is detectably wrong — in
// particular several lines carry TWO assignments, which is the case that makes
// "pair the target and the value by line" invent value flow.
using System;
using System.Collections.Generic;

namespace Fixtures.Ported.Expressions;

public class AssignmentExpressionExamples
{
    private int field;
    private int[] array = new int[8];
    private Dictionary<string, int> map = new Dictionary<string, int>();
    private AssignmentExpressionExamples nested;
    private string text;

    public int Property { get; set; }

    public int this[int index]
    {
        get => array[index];
        set => array[index] = value;
    }

    public void SimpleAssignments(int parameter)
    {
        int local;
        local = 1;
        field = 2;
        Property = 3;
        parameter = 4;
        array[0] = 5;
        map["key"] = 6;
        this[1] = 7;
        this.field = 8;
        text = null;
        _ = local + parameter;
    }

    // Two assignments on one line. A parser that pairs targets to values by
    // (scope, line) yields four pairs here, two of them wrong.
    public void TwoOnOneLine()
    {
        int a; int b;
        a = 1; b = 2;
        a += 10; b += 20;
        field = a; Property = b;
        array[0] = a; array[1] = b;
    }

    // Chained assignment: assignment is an EXPRESSION whose value is the
    // assigned value, so it nests inside itself.
    public void ChainedAssignment()
    {
        int a, b, c;
        a = b = c = 0;
        field = Property = 1;
        array[0] = array[1] = 2;
        map["x"] = map["y"] = 3;
    }

    // Assignment used for its value, in every position that takes an expression.
    public void AssignmentInExpressionPosition(int[] source)
    {
        int a;
        if ((a = source.Length) > 0)
        {
            Console.WriteLine(a);
        }

        while ((a = Read()) != -1)
        {
            Console.WriteLine(a);
        }

        Console.WriteLine(a = 5);
        int b = (a = 6) + (field = 7);
        int c = (a = 8) > 0 ? (a = 9) : (a = 10);
        _ = b + c;
    }

    private int Read() => -1;

    public void CompoundAssignmentEveryOperator(int seed)
    {
        int value = seed;
        value += 1;
        value -= 1;
        value *= 2;
        value /= 2;
        value %= 3;
        value &= 0x0F;
        value |= 0xF0;
        value ^= 0xFF;
        value <<= 1;
        value >>= 1;
        value >>>= 1;
        field = value;
    }

    // Compound assignment on every kind of target.
    public void CompoundOnEveryTarget(int index)
    {
        field += 1;
        Property += 1;
        array[index] += 1;
        map["key"] += 1;
        this[index] += 1;
        nested.field += 1;
        nested.Property += 1;
        nested.array[index] += 1;
        StaticCounter += 1;
    }

    public static int StaticCounter;

    // Null-coalescing assignment. Its target is only READ when it is null, so
    // it is not a plain compound assignment.
    public void NullCoalescingAssignment(Dictionary<string, List<int>> buckets, string key)
    {
        text ??= "default";
        string local = null;
        local ??= "fallback";

        int? maybe = null;
        maybe ??= 5;

        if (!buckets.ContainsKey(key))
        {
            buckets[key] = null;
        }

        buckets[key] ??= new List<int>();
        buckets[key].Add(1);
        _ = local + maybe;
    }

    // ref locals and ref assignment — the target is an ALIAS, not a copy.
    // No Java form at all.
    public void RefAssignment(int[] data)
    {
        ref int slot = ref data[0];
        slot = 42;
        slot += 1;

        ref int other = ref data[1];
        other = ref data[2];
        other = 7;

        ref readonly int view = ref data[3];
        _ = view;
    }

    public ref int RefReturn(int[] data) => ref data[0];

    // Deconstructing assignment, tuple assignment, and the swap idiom.
    public void DeconstructingAssignment(Dictionary<string, int> source)
    {
        int a, b;
        (a, b) = (1, 2);
        (a, b) = (b, a);
        (int x, int y) = (3, 4);
        var (p, q) = (5, 6);
        (a, (b, x)) = (7, (8, 9));

        foreach (var (key, value) in source)
        {
            (a, b) = (value, key.Length);
        }

        // A discard on one side.
        (_, b) = (10, 11);
        (a, _) = (12, 13);
        _ = a + b + x + y + p + q;
    }

    // Assignment through an out parameter — a second write channel.
    public void OutAssignment(string raw)
    {
        if (int.TryParse(raw, out int parsed))
        {
            field = parsed;
        }

        int discardTarget;
        int.TryParse(raw, out discardTarget);
        int.TryParse(raw, out _);
    }

    // Field initialisers are assignments with no statement.
    private int initialised = 1;
    private int computed = 2 * 3;
    private string interpolatedInit = string.Empty;
    private static readonly int StaticInitialised = 4;
    private readonly int readonlyInitialised = 5;

    public AssignmentExpressionExamples()
    {
        // A readonly field is assignable only here.
        readonlyInitialised = 6;
        _ = initialised + computed + interpolatedInit.Length + StaticInitialised + readonlyInitialised;
    }
}
