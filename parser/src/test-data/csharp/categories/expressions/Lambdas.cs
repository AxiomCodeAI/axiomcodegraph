// Port of java/expressions/{LambdaExpressionExamples1,LambdaExpressionExamples2}.java.
// C# lambdas differ from Java's in three ways that matter to a parser: they
// convert to a NAMED DELEGATE TYPE rather than to a structural functional
// interface, they may be `async`, and they may carry explicit types, default
// parameter values (C# 12), attributes and an explicit return type (C# 10).
// Anonymous methods (`delegate (int x) { }`) are a second, older spelling with
// no Java form and live in ../../csharp-only/delegates/.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Fixtures.Ported.Expressions;

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

public class LambdaExamples
{
    // Expression-bodied lambdas of every arity.
    public Func<int> NoParameters = () => 1;
    public Func<int, int> OneParameterInferred = x => x + 1;
    public Func<int, int> OneParameterParenthesised = (x) => x + 1;
    public Func<int, int> OneParameterTyped = (int x) => x + 1;
    public Func<int, int, int> TwoParameters = (a, b) => a + b;
    public Func<int, int, int> TwoParametersTyped = (int a, int b) => a + b;
    public Action ActionNoParameters = () => { };
    public Action<int> ActionOneParameter = x => Console.WriteLine(x);
    public Action<int, string> ActionTwoParameters = (x, y) => Console.WriteLine(x + y);
    public Predicate<int> PredicateForm = x => x > 0;
    public Comparison<int> ComparisonForm = (a, b) => a.CompareTo(b);
    public Converter<int, string> ConverterForm = x => x.ToString();

    // Statement-bodied lambdas.
    public Func<int, int> BlockBody = x =>
    {
        int doubled = x * 2;
        return doubled;
    };

    public Action<int> BlockBodyVoid = x =>
    {
        Console.WriteLine(x);
    };

    // Discards as parameters, and a lambda ignoring all of them.
    public Func<int, int, int> Discards = (_, _) => 0;

    // Explicit return type (C# 10) and a `static` lambda that captures nothing.
    public Func<object> ExplicitReturnType = object () => new object();
    public Func<int, int> StaticLambda = static x => x + 1;

    // Default parameter value and `params` on a lambda (C# 12). Both need the
    // lambda's NATURAL delegate type: `Func<int,int>` cannot carry either, so
    // assigning to one is a warning and `var` is the only correct target.
    public void LambdaParameterModifiers()
    {
        var defaultedParameter = (int x = 3) => x * 2;
        var paramsLambda = (params int[] values) => values.Length;
        _ = defaultedParameter(1) + paramsLambda(1, 2);
    }

    // Attribute on a lambda and on its parameter (C# 10).
    public Func<int, int> AttributedLambda =
        [Obsolete] ([Flow("in")] int x) => x;

    // async lambdas — no Java form.
    public Func<Task> AsyncNoResult = async () => await Task.Yield();
    public Func<int, Task<int>> AsyncWithResult = async x =>
    {
        await Task.Yield();
        return x * 2;
    };

    // Nested and returned lambdas; a lambda whose body contains a lambda is the
    // case where a worklist that stops at function boundaries loses everything
    // inside.
    public Func<int, Func<int, int>> Curried = a => b => a + b;

    public Func<int, int> ReturnsALambdaFromABlock()
    {
        return x =>
        {
            Func<int, int> inner = y => y * y;
            return inner(x) + 1;
        };
    }

    // Capture: a local, a parameter, `this`, and a loop variable.
    public Func<int> CaptureLocal()
    {
        int captured = 1;
        return () => captured;
    }

    public Func<int> CaptureParameter(int parameter) => () => parameter;

    private int field = 1;

    public Func<int> CaptureThis() => () => field;

    public IReadOnlyList<Func<int>> CaptureLoopVariable()
    {
        var results = new List<Func<int>>();
        for (int i = 0; i < 3; i++)
        {
            results.Add(() => i);
        }

        foreach (int j in new[] { 1, 2, 3 })
        {
            results.Add(() => j);
        }

        return results;
    }

    // Lambdas in argument position — the dominant real-world shape.
    public IEnumerable<string> InArgumentPosition(IEnumerable<int> source)
    {
        return source
            .Where(x => x > 0)
            .Select(x =>
            {
                int scaled = x * 2;
                return scaled;
            })
            .OrderBy(x => x)
            .ThenByDescending(x => -x)
            .Select(x => x.ToString())
            .ToList();
    }

    public void LambdaWithCallsInside(List<int> source)
    {
        source.ForEach(x => Console.WriteLine(Helper(x)));
        source.Sort((a, b) => Helper(a).CompareTo(Helper(b)));
        _ = source.Aggregate(0, (acc, x) => acc + Helper(x));
    }

    private static int Helper(int value) => value;

    // A lambda assigned to `var` needs a natural delegate type (C# 10).
    public void NaturalType()
    {
        var inferred = (int x) => x + 1;
        var inferredAction = (int x) => Console.WriteLine(x);
        _ = inferred(1);
        inferredAction(1);
    }

    // Expression trees: the same lambda syntax producing DATA, not code. There
    // is no Java analogue and the distinction is invisible in the syntax — only
    // the target type says which it is.
    public System.Linq.Expressions.Expression<Func<int, bool>> AsExpressionTree = x => x > 0;

    public IQueryable<int> UsesExpressionTree(IQueryable<int> source) =>
        source.Where(x => x > 0).OrderBy(x => x);
}
