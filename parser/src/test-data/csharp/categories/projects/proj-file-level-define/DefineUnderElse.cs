// GAP: the corpus shape — a `#define` chosen by an `#if/#elif/#else` at the top of the file.
// With none of the platform symbols defined the `#else` holds and USE_FALLBACK is defined.
#if FIXTURE_PLATFORM_A
// primary path
#define USE_PRIMARY
#elif FIXTURE_PLATFORM_B
#define USE_PRIMARY
#else
// fallback path
#define USE_FALLBACK
#endif
namespace Fixtures.FileLevelDefine;
public class DefineUnderElse
{
    private static void Fallback() { }
    private static void Primary() { }
    public static void Run()
    {
#if USE_FALLBACK
        Fallback();
#endif
#if USE_PRIMARY
        Primary();
#endif
    }
}
