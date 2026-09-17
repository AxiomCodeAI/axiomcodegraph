// CONTROL: no file-level directive; `#if !NEVER_DEFINED` is active and Kept() is emitted.
namespace Fixtures.FileLevelDefine;
public class ControlNoDefine
{
    private static void Kept() { }
    public static void Run()
    {
#if !NEVER_DEFINED
        Kept();
#endif
    }
}
