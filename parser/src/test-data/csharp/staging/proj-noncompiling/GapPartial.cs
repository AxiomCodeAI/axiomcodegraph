// A PARSE ERROR COVERING 5-50% OF THE FILE -> `CsParseGapKind.ERROR_PARTIAL`.
//
// Closing a coverage hole found by running cs-impl's enum audit against this
// corpus. Only ERROR_LOCAL and INSERTED_NODE were reached before, because
// SyntaxErrors.cs carries exactly one small defect and nothing else here is
// broken at all.
//
// The bucket is the fraction of the file's BYTES inside a maximal ERROR node,
// and the three thresholds were validated by cs-oracle against Roslyn's
// declaration counts -- 98.0% recovery for LOCAL, 50.6% for PARTIAL, 22.7% for
// TRUNCATING. A corpus that only ever produces the first bucket cannot show
// that the other two mean anything.
//
// SIZED BY MEASUREMENT, NOT BY EYE. The ERROR node this grammar produces runs
// from the broken construct to end of file, so the coverage fraction is
// governed by how much valid code sits AFTER the break, not before it. Twenty
// shapes were measured; this one lands just under 15% -- ten points clear of
// the 5% floor and thirty-five clear of the 50% ceiling. The figure is stated
// as a range on purpose: it is a fraction of the WHOLE FILE, so editing this
// comment moves it, and a hard-coded exact value here would go stale the next
// time anyone touched a line of prose. The arrangements that look obvious do
// not: symmetric padding lands at 49.8% or 50.5%, either side of the boundary,
// from a one-class edit.
//
// Read with GapTruncating.cs (the same defect, >50%) and SyntaxErrors.cs
// (INSERTED_NODE, and NOT ERROR_LOCAL -- measured, and the manifest said
// otherwise until this file was written).
namespace Fixtures.NonCompiling;

public sealed class BeforeThePartialError0
{
    public int Value => 0;

    public string Describe() => "BeforeThePartialError0";
}

public sealed class BeforeThePartialError1
{
    public int Value => 1;

    public string Describe() => "BeforeThePartialError1";
}

public sealed class BeforeThePartialError2
{
    public int Value => 2;

    public string Describe() => "BeforeThePartialError2";
}

public sealed class BeforeThePartialError3
{
    public int Value => 3;

    public string Describe() => "BeforeThePartialError3";
}

public sealed class BeforeThePartialError4
{
    public int Value => 4;

    public string Describe() => "BeforeThePartialError4";
}

public sealed class BeforeThePartialError5
{
    public int Value => 5;

    public string Describe() => "BeforeThePartialError5";
}

public sealed class BeforeThePartialError6
{
    public int Value => 6;

    public string Describe() => "BeforeThePartialError6";
}

public sealed class BeforeThePartialError7
{
    public int Value => 7;

    public string Describe() => "BeforeThePartialError7";
}

public sealed class BeforeThePartialError8
{
    public int Value => 8;

    public string Describe() => "BeforeThePartialError8";
}

public sealed class BeforeThePartialError9
{
    public int Value => 9;

    public string Describe() => "BeforeThePartialError9";
}

public sealed class BeforeThePartialError10
{
    public int Value => 10;

    public string Describe() => "BeforeThePartialError10";
}

public sealed class BeforeThePartialError11
{
    public int Value => 11;

    public string Describe() => "BeforeThePartialError11";
}

public sealed class BeforeThePartialError12
{
    public int Value => 12;

    public string Describe() => "BeforeThePartialError12";
}

public sealed class BeforeThePartialError13
{
    public int Value => 13;

    public string Describe() => "BeforeThePartialError13";
}

public sealed class BeforeThePartialError14
{
    public int Value => 14;

    public string Describe() => "BeforeThePartialError14";
}

public sealed class BeforeThePartialError15
{
    public int Value => 15;

    public string Describe() => "BeforeThePartialError15";
}

public sealed class BeforeThePartialError16
{
    public int Value => 16;

    public string Describe() => "BeforeThePartialError16";
}

public sealed class BeforeThePartialError17
{
    public int Value => 17;

    public string Describe() => "BeforeThePartialError17";
}

public sealed class BeforeThePartialError18
{
    public int Value => 18;

    public string Describe() => "BeforeThePartialError18";
}

public sealed class BeforeThePartialError19
{
    public int Value => 19;

    public string Describe() => "BeforeThePartialError19";
}

public sealed class BeforeThePartialError20
{
    public int Value => 20;

    public string Describe() => "BeforeThePartialError20";
}

public sealed class BeforeThePartialError21
{
    public int Value => 21;

    public string Describe() => "BeforeThePartialError21";
}

public sealed class BeforeThePartialError22
{
    public int Value => 22;

    public string Describe() => "BeforeThePartialError22";
}

public sealed class BeforeThePartialError23
{
    public int Value => 23;

    public string Describe() => "BeforeThePartialError23";
}

// --- the break. Everything from here to the end of the file is inside one
// --- maximal ERROR node, which is what makes the fraction measurable at all.
public class BrokenMiddle { public void M(<<>> x) { } }

public sealed class AfterThePartialError0
{
    public int Value => 0;

    public string Describe() => "AfterThePartialError0";
}

public sealed class AfterThePartialError1
{
    public int Value => 1;

    public string Describe() => "AfterThePartialError1";
}

public sealed class AfterThePartialError2
{
    public int Value => 2;

    public string Describe() => "AfterThePartialError2";
}

public sealed class AfterThePartialError3
{
    public int Value => 3;

    public string Describe() => "AfterThePartialError3";
}

public sealed class AfterThePartialError4
{
    public int Value => 4;

    public string Describe() => "AfterThePartialError4";
}

public sealed class AfterThePartialError5
{
    public int Value => 5;

    public string Describe() => "AfterThePartialError5";
}

