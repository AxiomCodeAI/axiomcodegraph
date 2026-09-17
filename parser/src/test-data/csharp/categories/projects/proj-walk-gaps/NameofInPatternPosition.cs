// CS-CORPUS-28 (REGRESSION at fork8): `nameof(...)` in PATTERN position. In a
// `case` label the NAMEOF row becomes a bare NAME_REFERENCE `nameof` with the
// argument hoisted to its own root (315 corpus sites); in a switch-expression
// arm the whole pattern side emits nothing (242 sites). At fork6 both emitted a
// NAMEOF row. Fork rule 7's qualified-constant rule reaching `nameof`. nameof is
// excluded from call adjudication by design, so only the fact-level regime diff
// could see this. Measured at cs-impl@888985c.
using System;
namespace Fixtures.WalkGaps;

public class NameofInPatternPosition
{
    public int Year; public int Month;

    // GAP: case label — `case nameof(X.Y):` and `case nameof(A) or nameof(B):`.
    public static int CaseLabel(string member)
    {
        switch (member)
        {
            case nameof(DateTime.Year): return 1;
            case nameof(DateTime.Month) or nameof(DateTime.Day): return 2;
            default: return 0;
        }
    }

    // GAP: switch-expression arm — `nameof(X.Y) => value`.
    public static string SwitchArm(string member) => member switch
    {
        nameof(DateTime.Year) => "yyyy",
        nameof(DateTime.Month) => "mm",
        _ => "",
    };

    // CONTROL: nameof as an ordinary expression — argument, return value, initializer — a NAMEOF row.
    public static string Control()
    {
        var s = nameof(DateTime.Year);
        Consume(nameof(DateTime.Month));
        return nameof(Year);
    }
    private static void Consume(string s) { }
}
