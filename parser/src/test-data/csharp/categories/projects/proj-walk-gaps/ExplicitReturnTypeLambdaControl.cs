// CONTROL for CS-CORPUS-29, in its own file because the gap's recovery runs to the end of the file it
// starts in: the same async lambda with an INFERRED return type — walked.
using System;
using System.Threading.Tasks;
namespace Fixtures.WalkGaps;

public class ExplicitReturnTypeLambdaControl
{
    public static void Inferred()
    {
        ErtRouter.MapGet("/{id:int}", async (int id, ErtDb db) =>
        {
            var found = await db.FindAsync(id);
            Log(found is null ? "missing" : "found");
            return new ErtResults<ErtOk<string>, ErtNotFound<string>>();
        });
    }
    private static void Log(string s) { }
}
