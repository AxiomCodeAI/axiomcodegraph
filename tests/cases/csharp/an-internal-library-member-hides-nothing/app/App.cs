using Example.Kit;
namespace App.Widgets;
public static class Limits { public static bool Allow(int n) => n > 0; }
public static class Quotas { public static bool Allow(int n) => n > 1; }
public class Gadget : WidgetBase
{
    public bool Check(int n) => Limits.Allow(n);
    public bool Other(int n) => Quotas.Allow(n);
}
