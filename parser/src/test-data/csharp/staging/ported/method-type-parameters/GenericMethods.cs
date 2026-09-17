// Port of java/method-type-parameters/GenericMethodLinking.java and
// java/methods/{GenericMethodPatterns,MethodTypeParamsTest}.java.
//
// NO ANALOGUE — Java's use-site wildcards in a method signature
// (`void f(List<? extends Number> xs)`) have no C# form. C# expresses variance
// at the DECLARATION site of an interface or delegate, so the nearest thing is
// a type parameter constrained by a base type, plus the built-in variance of
// IEnumerable<out T>. Both are shown; neither is a wildcard.
//
// NO ANALOGUE — a C# constructor cannot declare type parameters, so Java's
// generic constructors do not port. See methods/ConstructorPatterns.cs.
using System;
using System.Collections.Generic;

namespace Fixtures.Ported.MethodTypeParameters;

public class GenericMethodPatterns<TClass>
    where TClass : class
{
    // One method type parameter, unconstrained.
    public T Identity<T>(T value) => value;

    // Two and three, in declaration order.
    public TOut Map<TIn, TOut>(TIn input, Func<TIn, TOut> project) => project(input);

    public TResult Combine<T1, T2, TResult>(T1 a, T2 b, Func<T1, T2, TResult> project) =>
        project(a, b);

    // A method type parameter SHADOWING the class type parameter of the same
    // name. Legal, warns CS0693, and is exactly the case a parser that keys
    // type parameters by name alone gets wrong.
    public TClass Shadowing<TClass>(TClass value) => value;

    // A constraint referencing a SIBLING method type parameter.
    public TDerived Narrow<TBase, TDerived>(TDerived value)
        where TDerived : TBase
        => value;

    // A constraint referencing the CLASS type parameter.
    public T FromClassParameter<T>(T value)
        where T : TClass
        => value;

    // Every constraint form C# has.
    public T ClassConstraint<T>() where T : class => default;

    public T StructConstraint<T>() where T : struct => default;

    public T NotNullConstraint<T>() where T : notnull => default;

    public T UnmanagedConstraint<T>() where T : unmanaged => default;

    public T NewConstraint<T>() where T : new() => new T();

    public T InterfaceConstraint<T>() where T : IComparable<T> => default;

    public T BaseTypeConstraint<T>() where T : Exception => default;

    public T EnumConstraint<T>() where T : struct, Enum => default;

    public T DelegateConstraint<T>() where T : Delegate => default;

    public T MultipleConstraints<T>() where T : class, IComparable<T>, IDisposable, new() => new T();

    // `where T : class?` needs an enabled nullable context and therefore lives
    // in ../../csharp-only/misc/NullableContexts.cs, not here: this project is
    // <Nullable>disable</Nullable> and the annotation would warn CS8632.

    // Constraints on more than one parameter, in one `where` list per parameter.
    public TResult Constrained<TKey, TValue, TResult>(TKey key, TValue value)
        where TKey : notnull, IEquatable<TKey>
        where TValue : class, new()
        where TResult : struct
        => default;

    // Generic methods on every member kind.
    public static T StaticGeneric<T>(T value) => value;

    public virtual T VirtualGeneric<T>(T value) => value;

    public T ExpressionBodiedGeneric<T>(T value) => value;

    public void GenericVoid<T>(T value) { }

    public T[] ReturnsGenericArray<T>(T value) => new[] { value };

    public List<T> ReturnsGenericCollection<T>(T value) => new List<T> { value };

    public Dictionary<TKey, List<TValue>> ReturnsNestedGeneric<TKey, TValue>() => new();

    // A generic LOCAL FUNCTION — no Java form.
    public int GenericLocalFunction(int seed)
    {
        return Wrap(seed).Count;

        List<T> Wrap<T>(T value) => new List<T> { value };
    }

    // The variance-free replacements for Java's wildcards.
    public double SumOfAny<T>(IEnumerable<T> values) where T : struct, IConvertible
    {
        double total = 0;
        foreach (T value in values)
        {
            total += value.ToDouble(null);
        }

        return total;
    }

    public void AcceptsCovariant(IEnumerable<object> values) { }

    public void AcceptsContravariant(IComparer<string> comparer) { }

    // Call sites: inferred, explicit, partially impossible (C# infers all or
    // none), and inference from a lambda's parameter.
    public void CallSites()
    {
        Identity(1);
        Identity("s");
        Identity<int>(1);
        Identity<string>("s");

        Map(1, x => x.ToString());
        Map<int, string>(1, x => x.ToString());

        Combine(1, "s", (a, b) => a + b.Length);

        Narrow<Exception, ArgumentException>(new ArgumentException());

        StaticGeneric(1);
        GenericMethodPatterns<string>.StaticGeneric(1);

        _ = NewConstraint<object>();
        _ = EnumConstraint<DayOfWeek>();
        _ = ReturnsNestedGeneric<string, int>();

        // Inference through a nested generic argument.
        _ = ReturnsGenericCollection(new List<int>());

        // Inference that must flow through a delegate's return type.
        _ = Map(1, x => new List<string> { x.ToString() });

        AcceptsCovariant(new List<string>());
        AcceptsContravariant(Comparer<object>.Default);
    }
}

public class DerivedGenericMethods : GenericMethodPatterns<string>
{
    // Overriding a generic method keeps its arity and may rename the parameter.
    public override TValue VirtualGeneric<TValue>(TValue value) => value;
}

public interface IGenericMethods
{
    T Required<T>(T value);

    T WithConstraint<T>(T value) where T : class;
}

public class GenericMethodImplementation : IGenericMethods
{
    public T Required<T>(T value) => value;

    // The constraint is INHERITED and may not be restated — a C# rule with no
    // Java analogue, since Java re-declares bounds on the override.
    public T WithConstraint<T>(T value) where T : class => value;
}
