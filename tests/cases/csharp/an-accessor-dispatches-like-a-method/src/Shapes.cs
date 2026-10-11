namespace App;

public interface IOptions<T, P>
{
    IOptions<T, P> Then(System.Action a);
    int Count { get; }
}

public interface IPlain
{
    int Size { get; }
    int Len { get; set; }
    string this[int i] { get; }
}

internal class Builder<T, P> : IOptions<T, P>, IPlain
{
    IOptions<T, P> IOptions<T, P>.Then(System.Action a) { a(); return this; }
    int IOptions<T, P>.Count { get { return Tally(); } }
    int IPlain.Size { get { return Tally(); } }
    public int Len { get { return Tally(); } set { Tally(); } }
    public string this[int i] { get { Tally(); return ""; } }
    public int Own { get { return Tally(); } }
    private int Tally() => 1;
}

public abstract class Shape
{
    public abstract int Area { get; }
    public virtual string Name { get { return "shape"; } }
}

public class Square : Shape
{
    public override int Area { get { return 4; } }
    public override string Name { get { return "square"; } }
}

public class Circle : Shape
{
    public override int Area { get { return 3; } }
}
