namespace App;

public static class Work
{
    public static int Do(int x) => x;
}

public static class Use
{
    public static int ViaField() => new Holder(x => Work.Do(x)).Run(1);
    public static int ViaPrimary() => new Direct(x => Work.Do(x)).Run(1);
    public static void ViaCtor() => new Stored(() => Work.Do(2)).Go();
    public static void ViaParam() => Api.Each(i => Work.Do(i));
    public static void ViaForward() => Api.Wrap(i => Work.Do(i));
    public static void ViaMaybe() => Api.Maybe(() => Work.Do(3));
    public static void ViaGroup() => Api.Each(Visit);
    public static void NeverRun() => Api.Keep(i => Work.Do(i));
    public static void Listed() { var r = new Rules { v => v.RuleFor("a") }; }
    public static void ParamsLambda() { var b = new Built(v => v.RuleFor("x")); }
    private static void Visit(int i) { Work.Do(i); }
}
