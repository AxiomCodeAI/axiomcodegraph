// CS-CORPUS-23: a RELATIONAL `is` pattern as the CONDITION of a conditional
// expression — `x is < -1 ? a : b`, `x is not null and < 0 ? a : b` — produces
// an IS_PATTERN row that spans the whole conditional, and every call inside the
// two arms is lost. A type pattern in the same position (`o is string ? a : b`)
// is walked correctly, so the `<` of the relational pattern is the trigger. The
// sibling of CS-CORPUS-13 (is-pattern as a logical operand), which is fixed.
// Measured at cs-impl@f42baba.
using System;
namespace Fixtures.WalkGaps;

public class IsPatternAsAConditionalCondition
{
    private static int? Store(string key, object? value) => value as int?;

    // GAP: relational pattern as the condition; the throw's `new` and the call in the other arm both vanish.
    public static int? Relational(int maxLength)
        => maxLength is < -1
            ? throw new ArgumentOutOfRangeException(nameof(maxLength))
            : (int?)Store("max", maxLength);

    // GAP: `is not null and < 0` — the corpus's other form.
    public static int? Combined(int? precision)
        => precision is not null and < 0
            ? throw new ArgumentOutOfRangeException(nameof(precision))
            : Store("precision", precision);

    // CONTROL: a type pattern as the condition — walked.
    public static string TypePattern(object o)
        => o is string ? Describe(o) : Fallback();

    // CONTROL: the same condition parenthesised.
    public static int? Parenthesised(int maxLength)
        => (maxLength is < -1)
            ? throw new ArgumentOutOfRangeException(nameof(maxLength))
            : (int?)Store("max", maxLength);

    // CONTROL: a relational comparison (no pattern) as the condition.
    public static int? NoPattern(int maxLength)
        => maxLength < -1
            ? throw new ArgumentOutOfRangeException(nameof(maxLength))
            : (int?)Store("max", maxLength);

    private static string Describe(object o) => o.ToString() ?? "";
    private static string Fallback() => "";
}
