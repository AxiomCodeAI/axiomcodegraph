// A PARSE ERROR COVERING OVER 50% OF THE FILE -> `CsParseGapKind.ERROR_TRUNCATING`.
// The other two buckets are in GapPartial.cs and SyntaxErrors.cs. 22.7% of
// declarations survive this shape; the file is effectively lost.
namespace Fixtures.NonCompiling;

public sealed class BeforeTheTruncatingError
{
    public int Value => 1;
}

// --- from here the file is scrambled and stays scrambled ---
public class Truncated0 { public int M0(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage0 ][ ;;;
public class Truncated1 { public int M1(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage1 ][ ;;;
public class Truncated2 { public int M2(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage2 ][ ;;;
public class Truncated3 { public int M3(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage3 ][ ;;;
public class Truncated4 { public int M4(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage4 ][ ;;;
public class Truncated5 { public int M5(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage5 ][ ;;;
public class Truncated6 { public int M6(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage6 ][ ;;;
public class Truncated7 { public int M7(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage7 ][ ;;;
public class Truncated8 { public int M8(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage8 ][ ;;;
public class Truncated9 { public int M9(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage9 ][ ;;;
public class Truncated10 { public int M10(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage10 ][ ;;;
public class Truncated11 { public int M11(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage11 ][ ;;;
public class Truncated12 { public int M12(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage12 ][ ;;;
public class Truncated13 { public int M13(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage13 ][ ;;;
public class Truncated14 { public int M14(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage14 ][ ;;;
public class Truncated15 { public int M15(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage15 ][ ;;;
public class Truncated16 { public int M16(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage16 ][ ;;;
public class Truncated17 { public int M17(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage17 ][ ;;;
public class Truncated18 { public int M18(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage18 ][ ;;;
public class Truncated19 { public int M19(int a,, <<>> b) { return a + ; } }{{
    public }{ garbage19 ][ ;;;

public sealed class AfterTheTruncatingError
{
    public int Value => 2;
}
