// HALF TWO — METHOD GROUP CONVERSION.
//
// `Transform t = M;` is a reference to the method M with no call syntax
// anywhere in the expression. An extractor that finds call edges by looking for
// an argument list finds nothing here, and the edge — "something will call M" —
// is exactly what the engine needs. TypeScript's `methodReferenceKind` column
// is documented as a parity slot that is correctly always empty; C# fills it,
// and this file is what fills it with.
//
// Every position a method group can appear in is below: assignment,
// initialiser, argument, return, collection element, dictionary value,
// conditional arm, event subscription, and as an explicit `new D(M)`.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Fixtures.CSharpOnly.Delegates;

public class MethodGroupSources
{
    public int Instance(int value) => value;

    public static int Static(int value) => value;

    public int Overloaded(int value) => value;

    public string Overloaded(string value) => value;

    public int Overloaded(int a, int b) => a + b;

    public T GenericMethod<T>(T value) => value;

    public void VoidMethod(int value) { }

    public Task<int> AsyncMethod(int value) => Task.FromResult(value);

    public bool TryGet(string key, out int value)
    {
        value = key.Length;
        return true;
    }

    public event EventHandler? Raised;

    public void Raise() => Raised?.Invoke(this, EventArgs.Empty);
}

public class MethodGroupConversions
{
    private readonly MethodGroupSources source = new();

    // In a FIELD initialiser.
    private readonly Func<int, int> fromInstanceField;

    private static readonly Func<int, int> FromStaticField = MethodGroupSources.Static;

    private static readonly Action<string> FromConsole = Console.WriteLine;

    public MethodGroupConversions()
    {
        fromInstanceField = source.Instance;
    }

    // In a PROPERTY initialiser and an expression-bodied property.
    public Func<int, int> FromProperty { get; } = MethodGroupSources.Static;

    public Action<string> FromExpressionBodied => Console.WriteLine;

    public void EveryPosition()
    {
        // Plain assignment to a local of a named delegate type and of a BCL one.
        Transform namedDelegate = source.Instance;
        Func<int, int> bclDelegate = source.Instance;
        Action<int> asAction = source.VoidMethod;
        Predicate<int> asPredicate = IsPositive;
        Comparison<int> asComparison = Compare;
        Converter<int, string> asConverter = Stringify;

        // A STATIC method group, unqualified and type-qualified.
        Func<int, int> unqualifiedStatic = Helper;
        Func<int, int> qualifiedStatic = MethodGroupSources.Static;
        Func<string, int> bclStatic = int.Parse;
        Func<double, double> mathStatic = Math.Abs;

        // A method group on an INSTANCE reached through a chain.
        Func<int, int> throughChain = Holder.Shared.Instance;

        // An OVERLOADED method group: which overload is chosen depends on the
        // TARGET TYPE, and there is nothing at the reference site that says
        // which. Three targets, three different methods, one spelling.
        Func<int, int> picksIntInt = source.Overloaded;
        Func<string, string> picksStringString = source.Overloaded;
        Func<int, int, int> picksTwoArgs = source.Overloaded;

        // A GENERIC method group, with the type argument inferred from the
        // target and with it given explicitly.
        Func<int, int> inferredGeneric = source.GenericMethod;
        Func<string, string> inferredGenericString = source.GenericMethod;
        Func<int, int> explicitGeneric = source.GenericMethod<int>;

        // A method group with `out` in its signature.
        TryConvert<string, int> withOut = source.TryGet;

        // An async method group: the reference is to the method, and awaiting
        // happens at the invocation, not here.
        Func<int, Task<int>> asyncGroup = source.AsyncMethod;

        // In ARGUMENT position — the dominant real shape.
        _ = new[] { 1, 2, 3 }.Select(Stringify).ToList();
        _ = new[] { 1, 2, 3 }.Where(IsPositive).ToList();
        _ = new List<int> { 3, 1, 2 };
        var list = new List<int> { 3, 1, 2 };
        list.Sort(Compare);
        list.ForEach(Console.WriteLine);
        _ = list.ConvertAll(Stringify);
        Apply(source.Instance);
        Apply(Helper);

        // In RETURN position.
        _ = ReturnsAMethodGroup();

        // As a COLLECTION element and a dictionary value.
        var handlers = new List<Func<int, int>> { source.Instance, Helper, MethodGroupSources.Static };
        var map = new Dictionary<string, Func<int, int>>
        {
            ["a"] = source.Instance,
            ["b"] = Helper
        };

        // In a CONDITIONAL arm — both arms are method groups, and the
        // conditional has no natural type without a target.
        Func<int, int> chosen = handlers.Count > 0 ? source.Instance : Helper;

        // As an explicit delegate construction.
        Transform constructed = new Transform(source.Instance);
        Func<int, int> constructedBcl = new Func<int, int>(Helper);

        // As an EVENT subscription — a method group and a subscription at once.
        source.Raised += OnRaised;
        source.Raised -= OnRaised;

        // Cached: since C# 11 a static method group conversion is cached, so
        // two of these are reference-equal. Nothing in the syntax says so.
        Func<int, int> firstCache = Helper;
        Func<int, int> secondCache = Helper;
        bool sameInstance = ReferenceEquals(firstCache, secondCache);

        _ = namedDelegate(1) + bclDelegate(1) + asPredicate(1).GetHashCode()
            + asComparison(1, 2) + asConverter(1).Length + unqualifiedStatic(1)
            + qualifiedStatic(1) + bclStatic("1") + (int)mathStatic(1.0)
            + throughChain(1) + picksIntInt(1) + picksStringString("s").Length
            + picksTwoArgs(1, 2) + inferredGeneric(1) + inferredGenericString("s").Length
            + explicitGeneric(1) + (withOut("k", out int got) ? got : 0)
            + asyncGroup(1).Id + chosen(1) + constructed(1) + constructedBcl(1)
            + handlers.Count + map.Count + (sameInstance ? 1 : 0)
            + fromInstanceField(1) + FromStaticField(1) + FromProperty(1);
        asAction(1);
        FromConsole("x");
        FromExpressionBodied("x");
    }

    private static Func<int, int> ReturnsAMethodGroup() => Helper;

    private static int Apply(Func<int, int> f) => f(1);

    private static int Helper(int value) => value;

    private static bool IsPositive(int value) => value > 0;

    private static int Compare(int a, int b) => a.CompareTo(b);

    private static string Stringify(int value) => value.ToString();

    private void OnRaised(object? sender, EventArgs args)
    {
    }

    private static class Holder
    {
        public static readonly MethodGroupSources Shared = new();
    }
}

// A method group of a CONSTRUCTOR is not a thing in C# — there is no `new
// Foo` method group and no `Foo::new`. Java has exactly that, and it does not
// port. The C# replacement is a lambda or a `new()` constraint, both shown.
public class NoConstructorMethodGroup
{
    public NoConstructorMethodGroup()
    {
    }

    public static Func<NoConstructorMethodGroup> ByLambda => () => new NoConstructorMethodGroup();

    public static T ByConstraint<T>() where T : new() => new T();
}
