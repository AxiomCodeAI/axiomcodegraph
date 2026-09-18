// GAP: `#undef` of a symbol the project defines (DEBUG under a Debug build; TRACE is the safer choice here). `#if TRACE` must be INACTIVE after the undef.
#undef TRACE
namespace Fixtures.FileLevelDefine;
public class Undef
{
    private static void Traced() { }
    private static void Untraced() { }
    public static void Run()
    {
#if TRACE
        Traced();
#else
        Untraced();
#endif
    }
}
