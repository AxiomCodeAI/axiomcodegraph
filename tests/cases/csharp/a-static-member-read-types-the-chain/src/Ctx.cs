namespace N
{
    public interface IFactory { object Create(); }
    public class Factory : IFactory { public object Create() { return null; } }
    public interface IOtherFactory { object Create(); }
    public class OtherFactory : IOtherFactory { public object Create() { return null; } }

    public interface ICtx { IFactory F { get; } }
    public interface IOther { IOtherFactory F { get; } }

    public class Ctx : ICtx
    {
        public static ICtx Current { get; set; }
        public static ICtx Shared;
        public IFactory F { get; }
    }
}
