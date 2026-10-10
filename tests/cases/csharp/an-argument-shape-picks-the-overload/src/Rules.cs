using System;
using System.Linq.Expressions;
using System.Text.RegularExpressions;

namespace App;

public interface IValidator<T> { }
public interface IPropertyValidator<T> { }
public class AddressValidator : IValidator<string> { }
public interface ISource { }
public class Box { }

public class Rule<T>
{
    public Rule<T> Must(Func<T, bool> p) => this;
    public Rule<T> Must(Func<object, T, bool> p) => this;
    public Rule<T> Matches(string pattern) => this;
    public Rule<T> Matches(Func<T, string> pattern) => this;
    public Rule<T> Matches(Regex regex) => this;
    public Rule<T> Set(IPropertyValidator<T> v) => this;
    public Rule<T> Set(IValidator<T> v) => this;
    public Rule<T> Set(Func<T, IValidator<T>> make) => this;
    public void Write(int level, string template, params object[] values) { }
    public void Write(int level, Exception error, string template) { }
    public Rule<T> Feed(ISource s) => this;
    public Rule<T> Feed(Box b) => this;
    public Rule<T> Pick(Func<T, int> f) => this;
    public Rule<T> Pick(Box b) => this;
    public int Get(int i) => 0;
    public TOut Get<TOut>(int i) => default!;
    public Rule<T> When(Func<T, bool> p) => this;
    public Rule<T> When(Func<T, int> p) => this;
}

public static class Use
{
    public static void OneArg(Rule<string> r) => r.Must(x => x.Length > 0);
    public static void TwoArgs(Rule<string> r) => r.Must((o, x) => x.Length > 0);
    public static void Literal(Rule<string> r) => r.Matches("a+");
    public static void Lambda(Rule<string> r) => r.Matches(x => x);
    public static void Source(Rule<string> r) { var v = new AddressValidator(); r.Set(v); }
    public static void Iface(Rule<string> r, ISource s) => r.Feed(s);
    public static void PickLambda(Rule<string> r) => r.Pick(x => 1);
    public static int Typed(Rule<string> r) => r.Get<int>(0);
    public static void Same(Rule<string> r) => r.When(x => x.Length > 0);
    public static void Template(Rule<string> r, string t) => r.Write(1, t, new object[0]);
}
