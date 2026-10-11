namespace N
{
    public static class Use
    {
        public static object Local() { var f = Ctx.Current.F; return f.Create(); }
        public static object Chain() { return Ctx.Current.F.Create(); }
        public static object ViaVar() { var c = Ctx.Current; return c.F.Create(); }
        public static object Field() { return Ctx.Shared.F.Create(); }
    }

    public static class Holder
    {
        // control: inside Holder, `Ctx` is this property (the member wins over the type of the same name)
        public static IOther Ctx { get; }
        public static object Other() { return Ctx.F.Create(); }
    }
}
