// GAP: an unconditional `#define` on line 1. `#if PLAIN` must be active; the parser says inactive and drops Guarded().
#define PLAIN
namespace Fixtures.FileLevelDefine;
public class PlainDefine
{
    private static void Guarded() { }
    private static void Unguarded() { }
    public static void Run()
    {
#if PLAIN
        Guarded();
#else
        Unguarded();
#endif
    }
}
