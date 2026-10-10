namespace App;

public static class Use
{
    public static string ByItem(Tracking<string> v) => v.Check("x");
    public static string ByContext(Tracking<string> v) => v.Check(new Context<string>());
    public static string Shadowed(Shadowing<string> v) => v.Describe(1);
}
