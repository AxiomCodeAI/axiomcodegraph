using System;

namespace App;

public class Ctx<T> { }
public class Person { }

public abstract class Val<T>
{
    public string Check(T instance) => "item";
    public virtual string Check(Ctx<T> ctx) => "ctx";
}
public class PersonVal : Val<Person> { public override string Check(Ctx<Person> ctx) => "override"; }

public interface IRule<T> { }
public class Rule<T> : IRule<T> { }
public static class RuleExt
{
    public static IRule<T> Must<T>(this IRule<T> r, Func<T, bool> f) => r;
    public static IRule<T> Must<T>(this IRule<T> r, Func<object, T, bool> f) => r;
}

[AttributeUsage(AttributeTargets.Method)]
public class StepAttribute : Attribute { }

public static class Use
{
    public static string ByItem(PersonVal v) => v.Check(new Person());
    public static string ByCtx(PersonVal v) => v.Check(new Ctx<Person>());
    public static void Lambda(IRule<int> r) => r.Must(x => x > 0);
    [Step] public static void Decorated() { }
    public static void Step() { }
}
