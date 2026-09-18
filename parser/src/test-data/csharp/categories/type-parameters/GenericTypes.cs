// Port of java/type-parameters/{test-simple-type-params,test-bounded-type-params,
// test-generic-linking,test-annotated-type-params}.java.
//
// THE SPINE DIFFERENCE. C# generics are REIFIED: List<int> and List<string> are
// distinct runtime types, `typeof(T)` works, `new T()` works under a `new()`
// constraint, and a type parameter may be a VALUE type with no boxing. Java's
// erasure makes all of those impossible. Nothing about the SYNTAX shows this,
// which is why it is worth stating.
//
// NO ANALOGUE — use-site wildcards. C# has DECLARATION-SITE variance (`in`/`out`
// on an interface or delegate type parameter) and no `? extends` / `? super` /
// `?` at all. The variance forms are covered below; no wildcard is simulated.
using System;
using System.Collections.Generic;

namespace Fixtures.Ported.TypeParameters;

// One, two and three type parameters.
public class Box<T>
{
    public T Value { get; set; }
}

public class Pair<TFirst, TSecond>
{
    public TFirst First { get; set; }

    public TSecond Second { get; set; }
}

public class Triple<T1, T2, T3>
{
    public T1 A { get; set; }

    public T2 B { get; set; }

    public T3 C { get; set; }
}

// Descriptive names, the BCL convention.
public class Cache<TKey, TValue>
    where TKey : notnull
{
    private readonly Dictionary<TKey, TValue> store = new Dictionary<TKey, TValue>();

    public TValue Get(TKey key) => store[key];

    public void Set(TKey key, TValue value) => store[key] = value;
}

// Every constraint form, on a TYPE rather than a method.
public class Constrained<TClass, TStruct, TNew, TInterface, TBase, TEnum, TDelegate, TUnmanaged, TNotNull>
    where TClass : class
    where TStruct : struct
    where TNew : new()
    where TInterface : IComparable<TInterface>
    where TBase : Exception
    where TEnum : struct, Enum
    where TDelegate : Delegate
    where TUnmanaged : unmanaged
    where TNotNull : notnull
{
}

// A constraint referencing a SIBLING type parameter.
public class Hierarchy<TBase, TDerived>
    where TDerived : TBase
{
    public TBase Widen(TDerived value) => value;
}

// F-bounded / self-referential (CRTP) — the builder pattern, which is where
// this shape actually appears.
public abstract class FluentBuilder<TSelf, TResult>
    where TSelf : FluentBuilder<TSelf, TResult>
{
    public TSelf With(string key, string value) => (TSelf)this;

    public abstract TResult Build();
}

public sealed class UriBuilderish : FluentBuilder<UriBuilderish, Uri>
{
    public override Uri Build() => new Uri("https://example.invalid");
}

// Reification made visible: none of these compile in Java.
public class Reified<T>
    where T : struct
{
    public Type RuntimeType => typeof(T);

    public T[] Array(int size) => new T[size];

    public bool IsSameAs<TOther>() => typeof(T) == typeof(TOther);

    public T Default() => default;

    public T? Nullable() => null;
}

public class ReifiedNew<T>
    where T : new()
{
    public T Create() => new T();
}

// DECLARATION-SITE VARIANCE. `out` = covariant (output positions only),
// `in` = contravariant (input positions only), no modifier = invariant.
public interface IProducer<out T>
{
    T Produce();

    IEnumerable<T> ProduceMany();
}

public interface IConsumer<in T>
{
    void Consume(T value);

    void ConsumeMany(IEnumerable<T> values);
}

public interface ITransformer<in TIn, out TOut>
{
    TOut Transform(TIn input);
}

public interface IInvariant<T>
{
    T Round(T value);
}

// Variance on a DELEGATE type parameter, which Java has no form of either.
public delegate TOut Projection<in TIn, out TOut>(TIn input);

public delegate void Sink<in T>(T value);

public delegate T Source<out T>();

public class VarianceUse
{
    // Assignment that only compiles because of the variance annotation.
    public IProducer<object> Widen(IProducer<string> producer) => producer;

    public IConsumer<string> Narrow(IConsumer<object> consumer) => consumer;

    public ITransformer<string, object> Both(ITransformer<object, string> transformer) => transformer;

    public Projection<string, object> WidenDelegate(Projection<object, string> projection) => projection;

    // The BCL's own variant interfaces.
    public IEnumerable<object> Covariant(IEnumerable<string> values) => values;

    public IComparer<string> Contravariant(IComparer<object> comparer) => comparer;

    public Func<object> CovariantFunc(Func<string> source) => source;

    public Action<string> ContravariantAction(Action<object> sink) => sink;
}

// Generic struct, generic interface, generic delegate, generic nested type and
// a generic type nested in a generic type.
public struct GenericStruct<T>
{
    public T Value;
}

public interface IGenericInterface<T>
{
    T Get();
}

public delegate T GenericDelegate<T>(T input);

public class Outer<TOuter>
{
    public class Inner<TInner>
    {
        public TOuter Outer { get; set; }

        public TInner Inner2 { get; set; }
    }

    public class NonGenericInner
    {
        // Still closes over TOuter.
        public TOuter Value { get; set; }
    }

    public enum NestedEnum
    {
        A
    }
}

// Same NAME, different ARITY — three distinct types. This is the collision the
// schema resolves by putting arity in the identity, and there are 167 of them
// in the measured corpus.
public class Result
{
    public bool Success { get; set; }
}

public class Result<T>
{
    public T Value { get; set; }
}

public class Result<TValue, TError>
{
    public TValue Value { get; set; }

    public TError Error { get; set; }
}

// Attributes on type parameters — Java has these too.
// SELF-CONTAINED BY RULE. `categories/` is canonical for both blessing and
// running, and no fixture reference may cross a project boundary: a type
// reached through a ProjectReference resolves as a METADATA symbol with zero
// DeclaringSyntaxReferences, which is unadjudicable and would read as a parser
// defect that is really an artifact of partitioning. This file used to reach
// into ported/attributes/ for its attribute types; it now declares the one it
// needs as a `file`-local class, which cannot collide and cannot be referenced
// from anywhere else.
[AttributeUsage(AttributeTargets.GenericParameter)]
file sealed class TypeParamAttribute : Attribute
{
    public TypeParamAttribute(string role) => Role = role;

    public string Role { get; }
}

public class Annotated<[TypeParam("element")] TItem>
{
    public TItem Item { get; set; }
}

public class ConstructedReferences
{
    // Constructed generic types in every reference position.
    public Box<int> ValueTypeArgument;
    public Box<string> ReferenceTypeArgument;
    public Box<Box<int>> Nested;
    public Box<Box<Box<int>>> ThreeDeep;
    public Pair<int, string> TwoArguments;
    public Pair<Box<int>, List<string>> ConstructedArguments;
    public Outer<int>.Inner<string> NestedConstructed;
    public Outer<int>.NonGenericInner NestedNonGeneric;
    public Result NonGeneric;
    public Result<int> OneArgument;
    public Result<int, string> TwoArgumentsSameName;
    public Box<int>[] ArrayOfConstructed;
    public List<Box<int>[]> ArrayInsideGeneric;
    public GenericStruct<int> ValueTypeInstantiation;
    public GenericStruct<int>? NullableGenericStruct;
    public GenericDelegate<int> DelegateInstantiation;
    public Type UnboundGeneric = typeof(Box<>);
    public Type UnboundTwoArity = typeof(Pair<,>);
    public Type BoundGeneric = typeof(Box<int>);
}
