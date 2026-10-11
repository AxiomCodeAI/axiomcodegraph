namespace App;

public class Context<T> { public T Item; }

public abstract class Validator<T>
{
    public string Check(T item) => Check(new Context<T> { Item = item });
    public virtual string Check(Context<T> ctx) => Run(ctx);
    public string Describe(int depth) => "d";
    protected string Run(Context<T> ctx) => "ok";
}

public class Tracking<T> : Validator<T>
{
    public override string Check(Context<T> ctx) => base.Check(ctx);
}

public class Shadowing<T> : Validator<T>
{
    public new string Describe(int depth) => "shadow";
}
