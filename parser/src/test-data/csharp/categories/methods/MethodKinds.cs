// Port of java/methods/{MethodKindsTest,AllMethodExamples,ComprehensiveMethodPatterns}.java.
//
// NO ANALOGUE — Java `synchronized`, `native`, `strictfp`, `transient` and
// `volatile` methods have no C# member form. The nearest real things, which are
// covered instead, are `lock` inside the body (blocks/ControlFlow.cs), `extern`
// with [DllImport], and `volatile` as a FIELD modifier.
//
// NO ANALOGUE, other direction: `partial`, `async`, iterator, expression-bodied,
// local-function, operator, conversion, property-accessor, event-accessor and
// explicit-interface methods all exist here and not in Java. Each has its own
// fixture under ../../csharp-only/.
using System;
using System.Runtime.InteropServices;

namespace Fixtures.Ported.Methods;

public abstract class MethodKindExamples
{
    // Accessibility: all six levels. Java has four.
    public void PublicMethod() { }

    internal void InternalMethod() { }

    protected void ProtectedMethod() { }

    private void PrivateMethod() { }

    protected internal void ProtectedInternalMethod() { }

    private protected void PrivateProtectedMethod() { }

    // No modifier at all: `private` by default in a class. Java's default is
    // package-private, so the same absence means something different.
    void DefaultAccessibility() { }

    // Static, instance, and static with a body that touches no state.
    public static void StaticMethod() { }

    public void InstanceMethod() { }

    // abstract / virtual / override / sealed override / new (hiding).
    public abstract void AbstractMethod();

    public abstract int AbstractWithReturn(int value);

    public virtual void VirtualMethod() { }

    public virtual int VirtualWithReturn(int value) => value;

    // Expression-bodied members — no Java form.
    public int ExpressionBodied() => 1;

    public void ExpressionBodiedVoid() => Console.WriteLine();

    public string ExpressionBodiedThrows() => throw new NotSupportedException();

    // Return type forms.
    public void ReturnsVoid() { }

    public int ReturnsValue() => 1;

    public string ReturnsReference() => string.Empty;

    public int[] ReturnsArray() => new int[0];

    public (int Id, string Name) ReturnsTuple() => (1, "n");

    public int? ReturnsNullableValue() => null;

    public ref int ReturnsRef(int[] data) => ref data[0];

    public ref readonly int ReturnsRefReadonly(int[] data) => ref data[0];

    // extern with a platform invoke — the C# analogue of Java `native`.
    [DllImport("libc", EntryPoint = "abs")]
    public static extern int NativeAbs(int value);

    // A method whose body contains a local function; the local function is a
    // method with no accessibility and no owner type of its own.
    public int WithLocalFunction(int seed)
    {
        return Helper(seed) + StaticHelper(seed);

        int Helper(int value) => value + 1;

        static int StaticHelper(int value) => value + 2;
    }

    // A finaliser. Java's finalize() is a method; C#'s is its own member kind
    // with its own syntax and cannot be called or overridden explicitly.
    ~MethodKindExamples()
    {
    }
}

public class DerivedMethodKinds : MethodKindExamples
{
    public override void AbstractMethod() { }

    public override int AbstractWithReturn(int value) => value * 2;

    public override void VirtualMethod() { }

    public sealed override int VirtualWithReturn(int value) => base.VirtualWithReturn(value) + 1;

    // `new` hides rather than overrides — Java hiding happens implicitly for
    // static methods only, and C# makes it explicit and legal for instance ones.
    public new void InstanceMethod() { }

    public new static void StaticMethod() { }
}

public interface IMethodKinds
{
    // An interface method with no body — the Java 7 shape.
    void Required();

    // A DEFAULT IMPLEMENTATION (C# 8) — the direct port of Java 8's `default`.
    void Optional()
    {
        Required();
    }

    // A STATIC interface method (C# 8) — the direct port of Java 8's static
    // interface method.
    static int Helper() => 1;

    // A private interface method (C# 8) — Java 9's private interface method.
    private int Shared() => 2;

    // A static ABSTRACT interface member (C# 11) — generic math. Java has no
    // form of this at all.
    static abstract int Parse(string text);

    // Interface members may also be properties, indexers and events; those are
    // in ../../csharp-only/.
}

public class MethodKindImplementation : IMethodKinds
{
    public void Required() { }

    public static int Parse(string text) => text.Length;
}

public static class StaticClassMethods
{
    // Every member of a static class is static; the class cannot be
    // instantiated or used as a type. Java's closest is a final class with a
    // private constructor.
    public static int Add(int a, int b) => a + b;

    public static void Log(string message) => Console.WriteLine(message);
}

public sealed class SealedMethods
{
    public void CannotBeOverriddenBecauseTheTypeIsSealed() { }
}
