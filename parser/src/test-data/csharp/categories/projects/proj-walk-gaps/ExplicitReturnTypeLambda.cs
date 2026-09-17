// CS-CORPUS-29: a lambda with an EXPLICIT RETURN TYPE (C# 10) —
// `async Task<Results<Ok<T>, NotFound<string>>> (int id, Db db) => { ... }` — is
// outside the grammar at every regime (a parse error at fork8 and fork11). Under
// fork11 the recovery is worse: rule 11 reads the return type's `>` followed by the
// lambda's `(` as a generic call, the whole lambda body is swallowed (17 call
// sites lost in one modern-app file), error bytes go 692 -> 2,375, and the file
// is read as having top-level statements, so a phantom `Program` partial part
// appears (12 -> 13 parts against Roslyn's 12). 30 corpus files carry the shape;
// it is how ASP.NET minimal APIs are written. Measured at cs-impl@3561721.
using System;
using System.Threading.Tasks;
namespace Fixtures.WalkGaps;

public class ErtOk<T> { } public class ErtNotFound<T> { } public class ErtResults<TA, TB> { }
public class ErtDb { public Task<ErtOk<string>?> FindAsync(int id) => Task.FromResult<ErtOk<string>?>(null); }
public static class ErtRouter
{
    public static void MapGet(string pattern, Delegate handler) { }
    public static void MapPost(string pattern, Delegate handler) { }
}

public class ExplicitReturnTypeLambda
{
    // GAP: explicit generic return type on an async lambda — the body's calls are lost.
    public static void Explicit()
    {
        ErtRouter.MapGet("/{id:int}", async Task<ErtResults<ErtOk<string>, ErtNotFound<string>>> (int id, ErtDb db) =>
        {
            var found = await db.FindAsync(id);
            Log(found is null ? "missing" : "found");
            return new ErtResults<ErtOk<string>, ErtNotFound<string>>();
        });
    }
    // GAP: explicit NON-generic return type — the same construct without `<`; walked or not is what the sweep says.
    public static void ExplicitPlain()
    {
        ErtRouter.MapPost("/", async Task (int id, ErtDb db) =>
        {
            await db.FindAsync(id);
            Log("posted");
        });
    }
    // The CONTROL lives in ExplicitReturnTypeLambdaControl.cs: at fork11 the single ERROR that starts at the
    // first explicit-return-type lambda runs to the END OF THE FILE (1,231 bytes), so a control placed
    // below it in this file is swallowed with the gap and proves nothing.
    private static void Log(string s) { }
}
