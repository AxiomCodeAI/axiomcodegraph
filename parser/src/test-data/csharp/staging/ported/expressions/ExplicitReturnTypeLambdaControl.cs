// THE CONTROL for ExplicitReturnTypeLambda.cs — the same lambdas with the return
// type INFERRED. Every one of these is inside the grammar and parses clean.
//
// Its own file, because anything below a whole-file error in the same file is
// swallowed with it, and a control that could be swallowed by the thing it
// controls for is not a control. Same lambdas, same names, same bookends: the
// only difference between the two files is the return type being written down.
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Fixtures.Ported.Expressions;

public sealed class BeforeTheGapControl
{
    public int Value => 1;

    public string Describe() => "before";
}

public sealed class ExplicitReturnTypeLambdaControl
{
    public Func<object> ReturnsObject = () => new object();

    public Func<int, int> ReturnsInt = (int x) => x + 1;

    public Func<int, Task<int>> ReturnsGenericTask = async (int id) =>
    {
        await Task.Yield();
        return id;
    };

    public Func<IEnumerable<int>, Task<List<int>>> ReturnsNestedGeneric =
        async (IEnumerable<int> source) => new List<int>(source);

    public Func<Task> StaticAsyncVoidTask = static async () => await Task.Yield();

    public RefReader ReturnsRef = (ref int x) => ref x;

    public delegate ref int RefReader(ref int x);

    public int InArgumentPosition() =>
        Apply(async (int x) => await Task.FromResult(x));

    private static int Apply(Func<int, Task<int>> f) => f(1).Result;

    public Func<int> A = () => 1; public Func<int> B = () => 2;
}

public sealed class AfterTheGapControl
{
    public int Value => 2;

    public string Describe() => "after";

    public Func<int, int> InferredReturnType = x => x + 1;
}
