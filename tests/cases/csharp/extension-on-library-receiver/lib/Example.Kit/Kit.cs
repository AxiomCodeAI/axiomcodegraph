namespace Example.Kit;
public class Report { public int Count { get; set; } }
public interface IBuilder<T> { }
public interface IBuilderInitial<T> : IBuilder<T> { }
internal class Builder<T> : IBuilderInitial<T> { }
public static class Kit
{
    public static Report Run() => new Report();
    public static IBuilderInitial<T> For<T>() => new Builder<T>();
}
