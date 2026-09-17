// Port of java/blocks/{ControlFlowExamples,NestedBlockLinking}.java
// Every statement form that opens a block or a scope, four levels deep, plus
// the four C# block forms Java has no spelling for: `lock`, `checked`,
// `unchecked` and the `using` statement / declaration.
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;

namespace Fixtures.Ported.Blocks;

public class ControlFlowExamples
{
    private readonly object gate = new object();

    public int IfElseChain(int value)
    {
        if (value < 0)
        {
            return -1;
        }
        else if (value == 0)
        {
            return 0;
        }
        else
        {
            return 1;
        }
    }

    // Unbraced bodies: a statement that is not a block, in every position that
    // accepts one.
    public int UnbracedBodies(int value)
    {
        if (value < 0)
            return -1;
        else
            value++;

        for (int i = 0; i < 3; i++)
            value += i;

        while (value > 100)
            value -= 10;

        foreach (var c in "abc")
            value += c;

        do
            value--;
        while (value > 50);

        return value;
    }

    public int ForLoops(int[] data)
    {
        int total = 0;

        for (int i = 0; i < data.Length; i++)
        {
            total += data[i];
        }

        // Multiple initialisers, multiple incrementors, no condition body.
        for (int i = 0, j = data.Length - 1; i < j; i++, j--)
        {
            total += data[i] - data[j];
        }

        // Empty header.
        for (; ; )
        {
            break;
        }

        return total;
    }

    public int ForEachForms(IEnumerable<int> source, Dictionary<string, int> map)
    {
        int total = 0;

        foreach (int item in source)
        {
            total += item;
        }

        foreach (var item in source)
        {
            total += item;
        }

        // Deconstructing foreach — no Java form.
        foreach (var (key, value) in map)
        {
            total += key.Length + value;
        }

        foreach (KeyValuePair<string, int> pair in map)
        {
            total += pair.Value;
        }

        return total;
    }

    public int WhileAndDo(int seed)
    {
        int value = seed;

        while (value > 0)
        {
            value /= 2;
        }

        do
        {
            value++;
        }
        while (value < 10);

        return value;
    }

    // Switch STATEMENT (not the expression) with fall-through via goto case,
    // multiple labels on one section, and a default. `goto case` and `goto
    // default` have no Java analogue.
    public string SwitchStatement(int code)
    {
        string label;

        switch (code)
        {
            case 0:
                label = "zero";
                break;

            case 1:
            case 2:
                label = "small";
                break;

            case 3:
                label = "three";
                goto case 4;

            case 4:
                label = "three-or-four";
                break;

            case 5:
                goto default;

            default:
                label = "other";
                break;
        }

        return label;
    }

    // Pattern-matching switch statement with a `when` guard and a var pattern.
    public string SwitchOnPattern(object value)
    {
        switch (value)
        {
            case null:
                return "null";

            case int n when n > 100:
                return "big int";

            case int n:
                return "int " + n;

            case string { Length: 0 }:
                return "empty string";

            case string s:
                return s;

            case var other:
                return other.GetType().Name;
        }
    }

    // Labels, goto, break and continue. C# `goto` is unrestricted; Java has
    // labelled break/continue only.
    public int LabelsAndGoto(int[][] grid)
    {
        int found = -1;

    restart:
        for (int row = 0; row < grid.Length; row++)
        {
            for (int column = 0; column < grid[row].Length; column++)
            {
                if (grid[row][column] < 0)
                {
                    continue;
                }

                if (grid[row][column] == 99)
                {
                    found = row;
                    goto done;
                }

                if (grid[row][column] == 0)
                {
                    break;
                }
            }
        }

        if (found == -2)
        {
            goto restart;
        }

    done:
        return found;
    }

    // Four levels of nesting, each level a different block kind — the port of
    // NestedBlockLinking.java.
    public int DeeplyNested(IEnumerable<int> source)
    {
        int total = 0;

        foreach (int outer in source)
        {
            if (outer % 2 == 0)
            {
                for (int i = 0; i < outer; i++)
                {
                    while (total < 1000)
                    {
                        switch (i % 3)
                        {
                            case 0:
                                total += 1;
                                break;

                            default:
                                {
                                    // A bare block, which is its own scope.
                                    int local = i * outer;
                                    total += local;
                                }

                                break;
                        }
                    }
                }
            }
        }

        return total;
    }

    // A bare block as a statement, introducing a scope with no control flow.
    public int BareBlocks()
    {
        int result = 0;

        {
            int scoped = 1;
            result += scoped;
        }

        {
            // Same name, different scope — legal because the scopes are siblings.
            int scoped = 2;
            result += scoped;
        }

        return result;
    }

    // `lock` — no Java statement form; Java spells it `synchronized`.
    //
    // The lock SUBJECT is its own expression root context, and it was the
    // thinnest in the whole corpus at one row. Every shape a subject can take
    // is below: a field, `this`, a static field, a property, an element, a
    // call result, a local and a chain.
    private static readonly object SharedGate = new object();

    private object GateProperty => gate;

    private readonly object[] gates = { new object(), new object() };

    public int LockBlock(int delta)
    {
        int result;

        lock (gate)
        {
            result = delta;
        }

        lock (this)
        {
            result += 1;
        }

        lock (SharedGate)
        {
            result += 2;
        }

        lock (GateProperty)
        {
            result += 3;
        }

        lock (gates[0])
        {
            result += 4;
        }

        lock (GateFor(delta))
        {
            result += 5;
        }

        object local = gate;
        lock (local)
        {
            result += 6;
        }

        lock (Nested?.gate ?? SharedGate)
        {
            result += 7;
        }

        // Nested locks, which is the shape that deadlocks.
        lock (gate)
        {
            lock (SharedGate)
            {
                result += 8;
            }
        }

        return result;
    }

    private object GateFor(int index) => gates[index % gates.Length];

    public ControlFlowExamples Nested;

    // `checked` / `unchecked` as statements and as expressions.
    public int CheckedAndUnchecked(int large)
    {
        int wrapped;

        unchecked
        {
            wrapped = large * large;
        }

        try
        {
            checked
            {
                wrapped = large + int.MaxValue;
            }
        }
        catch (OverflowException)
        {
            wrapped = 0;
        }

        int expressionForm = unchecked(int.MaxValue + 1);
        return wrapped + expressionForm;
    }

    // `using` statement, `using` with multiple resources, and the C# 8
    // using DECLARATION whose scope is the rest of the enclosing block.
    public string UsingForms(string path)
    {
        using (var reader = new StringReader(path))
        {
            return reader.ReadToEnd();
        }
    }

    public string UsingMultiple(string path)
    {
        using (var first = new StringReader(path))
        using (var second = new StringReader(path))
        {
            return first.ReadToEnd() + second.ReadToEnd();
        }
    }

    public string UsingDeclaration(string path)
    {
        using var reader = new StringReader(path);
        string content = reader.ReadToEnd();
        return content;
    }

    // A block owned by a lambda, and one owned by a local function — both are
    // block scopes whose parent is not a method declaration.
    public int NestedFunctionBlocks(int seed)
    {
        Func<int, int> doubler = x =>
        {
            int inner = x * 2;
            return inner;
        };

        int Tripler(int x)
        {
            int inner = x * 3;
            return inner;
        }

        return doubler(seed) + Tripler(seed);
    }

    public void MonitorBlock()
    {
        bool taken = false;
        try
        {
            Monitor.Enter(gate, ref taken);
        }
        finally
        {
            if (taken)
            {
                Monitor.Exit(gate);
            }
        }
    }
}
