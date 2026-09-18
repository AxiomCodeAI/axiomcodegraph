// EXPLICIT-RETURN-TYPE LAMBDAS (C# 10) — NOT PARSED by the vendored grammar.
//
// CS-CORPUS-29: `Task<X> (int id) => …` is outside the grammar, and under fork11
// the return type's `>` followed by the lambda's `(` reads as rule 11's
// generic-call shape, so the error runs to END OF FILE. It is how ASP.NET
// minimal APIs are written — 30 files across the corpora, 17 call sites lost in
// one — and it will dominate any ASP.NET-heavy holdout.
//
// THIS FILE EXISTS SO THE RECOVERY IS MEASURED, NOT ABSORBED. The construct used
// to sit at line 63 of a 172-line lambda fixture, where the whole-file error
// would have swallowed a hundred lines of unrelated coverage into one parse gap
// that nobody could attribute. Alone in its own file, the gap is the file, its
// byte count is the measurement, and the bookends say how much was recovered:
//
//   BeforeTheGap  — must be recovered under any grammar
//   the shapes    — the gap
//   AfterTheGap   — recovered only if the error is local; lost if it runs to EOF
//
// The control — the same lambdas with the return type INFERRED, which the
// grammar parses — is ExplicitReturnTypeLambdaControl.cs, its own file for the
// same reason cs-corpus gave: anything below the gap in the same file is
// swallowed with it. cs-corpus's repro pair in proj-walk-gaps has the same
// shape; this is the coverage-side twin, and it compiles.
//
// Machine-readable: the project property CsFixtureParsedByGrammar is not set
// for this project, because the file is one of many; the label is this header
// and the manifest. If a per-file signal is wanted, say so.
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Fixtures.Ported.Expressions;

/// <summary>Recovered under any grammar. If this is missing, the file was not read at all.</summary>
public sealed class BeforeTheGap
{
    public int Value => 1;

    public string Describe() => "before";
}

public sealed class ExplicitReturnTypeLambda
{
    // The minimal form: a return type before the parameter list.
    public Func<object> ReturnsObject = object () => new object();

    // A primitive return type with a typed parameter.
    public Func<int, int> ReturnsInt = int (int x) => x + 1;

    // The shape that triggers rule 11: a GENERIC return type, so `>` is
    // immediately followed by `(`.
    public Func<int, Task<int>> ReturnsGenericTask = async Task<int> (int id) =>
    {
        await Task.Yield();
        return id;
    };

    // Nested generics in the return type — more `>` before the `(`.
    public Func<IEnumerable<int>, Task<List<int>>> ReturnsNestedGeneric =
        async Task<List<int>> (IEnumerable<int> source) => new List<int>(source);

    // `static` and `async` modifiers before the return type.
    public Func<Task> StaticAsyncVoidTask = static async Task () => await Task.Yield();

    // A `ref` return type, which is the rarest legal form.
    public RefReader ReturnsRef = ref int (ref int x) => ref x;

    public delegate ref int RefReader(ref int x);

    // In ARGUMENT position — the minimal-API shape, and the one the corpus
    // counted: a call whose lambda argument has an explicit generic return type.
    public int InArgumentPosition() =>
        Apply(async Task<int> (int x) => await Task.FromResult(x));

    private static int Apply(Func<int, Task<int>> f) => f(1).Result;

    // Two on one line, so a recovery that eats one and keeps the next is visible.
    public Func<int> A = int () => 1; public Func<int> B = int () => 2;
}

/// <summary>
/// Recovered ONLY if the error above is local. Under fork11 it is not: this type
/// is the measurement of a whole-file error, and its absence is the number.
/// </summary>
public sealed class AfterTheGap
{
    public int Value => 2;

    public string Describe() => "after";

    public Func<int, int> InferredReturnType = x => x + 1;
}
