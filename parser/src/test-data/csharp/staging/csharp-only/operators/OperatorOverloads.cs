// HALF TWO — operator overloading. Every one of these is a STATIC METHOD with
// a name the source never writes (`op_Addition`, `op_Implicit`, ...) invoked by
// punctuation.
//
// The load-bearing case is in ConversionOperators.cs: a CAST THAT INVOKES USER
// CODE is a call edge that looks like a type reference.
using System;
using System.Numerics;

namespace Fixtures.CSharpOnly.Operators;

public readonly struct Complex : IEquatable<Complex>
{
    public Complex(double real, double imaginary)
    {
        Real = real;
        Imaginary = imaginary;
    }

    public double Real { get; }

    public double Imaginary { get; }

    // UNARY operators. `+`, `-`, `!`, `~`, `++`, `--`, `true`, `false`.
    public static Complex operator +(Complex value) => value;

    public static Complex operator -(Complex value) => new Complex(-value.Real, -value.Imaginary);

    public static Complex operator ~(Complex value) => new Complex(value.Real, -value.Imaginary);

    // `++` and `--` are declared ONCE and serve both the prefix and the postfix
    // form; the difference is entirely at the call site.
    public static Complex operator ++(Complex value) => new Complex(value.Real + 1, value.Imaginary);

    public static Complex operator --(Complex value) => new Complex(value.Real - 1, value.Imaginary);

    // `true` and `false` must be declared as a PAIR, and declaring them makes
    // the type usable in `if`, `while`, `&&` and `||`. No Java analogue.
    public static bool operator true(Complex value) => value.Real != 0 || value.Imaginary != 0;

    public static bool operator false(Complex value) => value.Real == 0 && value.Imaginary == 0;

    // BINARY arithmetic.
    public static Complex operator +(Complex left, Complex right) =>
        new Complex(left.Real + right.Real, left.Imaginary + right.Imaginary);

    public static Complex operator -(Complex left, Complex right) =>
        new Complex(left.Real - right.Real, left.Imaginary - right.Imaginary);

    public static Complex operator *(Complex left, Complex right) =>
        new Complex(
            (left.Real * right.Real) - (left.Imaginary * right.Imaginary),
            (left.Real * right.Imaginary) + (left.Imaginary * right.Real));

    public static Complex operator /(Complex left, double right) =>
        new Complex(left.Real / right, left.Imaginary / right);

    public static Complex operator %(Complex left, double right) =>
        new Complex(left.Real % right, left.Imaginary % right);

    // OVERLOADED overloads: the same operator with a different operand type on
    // each side, which is three distinct methods.
    public static Complex operator +(Complex left, double right) =>
        new Complex(left.Real + right, left.Imaginary);

    public static Complex operator +(double left, Complex right) =>
        new Complex(left + right.Real, right.Imaginary);

    // EQUALITY must be declared in pairs, and overriding Equals/GetHashCode is
    // required by the analyzer if not by the compiler.
    public static bool operator ==(Complex left, Complex right) => left.Equals(right);

    public static bool operator !=(Complex left, Complex right) => !left.Equals(right);

    // RELATIONAL operators must also be declared in pairs: < with >, <= with >=.
    public static bool operator <(Complex left, Complex right) => left.Magnitude < right.Magnitude;

    public static bool operator >(Complex left, Complex right) => left.Magnitude > right.Magnitude;

    public static bool operator <=(Complex left, Complex right) => left.Magnitude <= right.Magnitude;

    public static bool operator >=(Complex left, Complex right) => left.Magnitude >= right.Magnitude;

    // BITWISE and SHIFT. `&` and `|` combined with `true`/`false` are what make
    // `&&` and `||` work on a user type — the short-circuiting operators
    // themselves CANNOT be overloaded.
    public static Complex operator &(Complex left, Complex right) =>
        new Complex(Math.Min(left.Real, right.Real), Math.Min(left.Imaginary, right.Imaginary));

    public static Complex operator |(Complex left, Complex right) =>
        new Complex(Math.Max(left.Real, right.Real), Math.Max(left.Imaginary, right.Imaginary));

    public static Complex operator ^(Complex left, Complex right) =>
        new Complex(left.Real - right.Real, left.Imaginary - right.Imaginary);

    public static Complex operator <<(Complex value, int shift) =>
        new Complex(value.Real * (1 << shift), value.Imaginary);

    public static Complex operator >>(Complex value, int shift) =>
        new Complex(value.Real / (1 << shift), value.Imaginary);

    public static Complex operator >>>(Complex value, int shift) =>
        new Complex(value.Real / (1 << shift), value.Imaginary);

    public double Magnitude => Math.Sqrt((Real * Real) + (Imaginary * Imaginary));

    public bool Equals(Complex other) => Real == other.Real && Imaginary == other.Imaginary;

    public override bool Equals(object? obj) => obj is Complex other && Equals(other);

    public override int GetHashCode() => HashCode.Combine(Real, Imaginary);

    public override string ToString() => $"{Real}+{Imaginary}i";
}

// CHECKED OPERATORS (C# 11): a second body for the same operator, selected by
// a `checked` context. Two methods, one spelling at the call site, and which
// one runs depends on a context the expression itself does not carry.
public readonly struct Saturating
{
    public Saturating(int value) => Value = value;

    public int Value { get; }

    public static Saturating operator +(Saturating left, Saturating right) =>
        new Saturating(unchecked(left.Value + right.Value));

    public static Saturating operator checked +(Saturating left, Saturating right) =>
        new Saturating(checked(left.Value + right.Value));

    public static Saturating operator -(Saturating value) => new Saturating(unchecked(-value.Value));

    public static Saturating operator checked -(Saturating value) =>
        new Saturating(checked(-value.Value));

    public static Saturating operator ++(Saturating value) =>
        new Saturating(unchecked(value.Value + 1));

    public static Saturating operator checked ++(Saturating value) =>
        new Saturating(checked(value.Value + 1));

    public static explicit operator int(Saturating value) => value.Value;

    public static explicit operator checked int(Saturating value) => checked((int)value.Value);
}

// STATIC ABSTRACT operators in an interface (C# 11, generic math). An operator
// as an interface REQUIREMENT — Java has no form of this at any level.
public interface IAddable<TSelf>
    where TSelf : IAddable<TSelf>
{
    static abstract TSelf operator +(TSelf left, TSelf right);

    static abstract TSelf Zero { get; }

    static virtual TSelf Sum(TSelf a, TSelf b) => a + b;
}

public readonly struct Meters : IAddable<Meters>
{
    public Meters(double value) => Value = value;

    public double Value { get; }

    public static Meters operator +(Meters left, Meters right) => new Meters(left.Value + right.Value);

    public static Meters Zero => new Meters(0);
}

// A generic method constrained by an operator requirement: `left + right` here
// resolves through the constraint, not through either operand's type.
public static class GenericMath
{
    public static T SumAll<T>(params T[] values)
        where T : IAddable<T>
    {
        T total = T.Zero;
        foreach (T value in values)
        {
            total = total + value;
        }

        return total;
    }

    // The BCL's own generic-math constraint.
    public static T Add<T>(T left, T right) where T : INumber<T> => left + right;

    // A `static virtual` interface member is reachable ONLY through a type
    // PARAMETER, never through the concrete type: `Meters.Sum(...)` does not
    // compile (CS0117) because the default implementation is not inherited into
    // the type's own surface. That asymmetry with `static abstract` is the
    // whole point of the pair.
    public static T SumVia<T>(T a, T b) where T : IAddable<T> => T.Sum(a, b);
}

public class OperatorCallSites
{
    public void EveryPunctuationIsACall()
    {
        var a = new Complex(1, 2);
        var b = new Complex(3, 4);

        // Every one of these is a static method call written as punctuation.
        Complex sum = a + b;
        Complex difference = a - b;
        Complex product = a * b;
        Complex quotient = a / 2.0;
        Complex remainder = a % 2.0;
        Complex negated = -a;
        Complex plussed = +a;
        Complex conjugate = ~a;

        // Mixed operand types select a different overload.
        Complex withDouble = a + 1.0;
        Complex doubleFirst = 1.0 + a;

        // Increment and decrement, prefix and postfix, from ONE declaration.
        Complex c = a;
        Complex preInc = ++c;
        Complex postInc = c++;
        Complex preDec = --c;
        Complex postDec = c--;

        // Compound assignment uses the BINARY operator plus an assignment.
        Complex d = a;
        d += b;
        d -= b;
        d *= b;

        // Comparison and equality.
        bool equal = a == b;
        bool notEqual = a != b;
        bool less = a < b;
        bool greaterOrEqual = a >= b;

        // Bitwise, and the short-circuiting forms that route through
        // operator true / operator false.
        Complex and = a & b;
        Complex or = a | b;
        Complex xor = a ^ b;
        Complex shifted = a << 1;
        Complex unsignedShifted = a >>> 1;

        // `if (a)` compiles ONLY because `operator true` exists.
        if (a)
        {
            Console.WriteLine("truthy");
        }

        // `&&` on a user type: operator false, then operator &.
        Complex shortCircuit = a && b;
        Complex shortCircuitOr = a || b;

        // In a ternary condition and a while.
        Complex chosen = a ? b : a;
        while (a)
        {
            break;
        }

        _ = sum + difference + product + quotient + remainder + negated + plussed
            + conjugate + withDouble + doubleFirst + preInc + postInc + preDec
            + postDec + d + and + or + xor + shifted + unsignedShifted
            + shortCircuit + shortCircuitOr + chosen;
        _ = equal || notEqual || less || greaterOrEqual;
    }

    // The checked/unchecked selection, which is a property of the CONTEXT and
    // not of the expression.
    public void CheckedSelection()
    {
        var big = new Saturating(int.MaxValue);
        var one = new Saturating(1);

        // Unchecked context (the default): operator + runs.
        Saturating wrapped = big + one;

        // Checked context: operator checked + runs instead. The SAME `+`.
        try
        {
            Saturating thrown = checked(big + one);
            _ = thrown;
        }
        catch (OverflowException)
        {
        }

        checked
        {
            try
            {
                Saturating alsoThrown = big + one;
                _ = alsoThrown;
            }
            catch (OverflowException)
            {
            }
        }

        unchecked
        {
            Saturating alsoWrapped = big + one;
            _ = alsoWrapped;
        }

        // The same split for the explicit conversion operator.
        int unchecked1 = (int)big;
        try
        {
            int checked1 = checked((int)big);
            _ = checked1;
        }
        catch (OverflowException)
        {
        }

        _ = wrapped.Value + unchecked1;
    }

    public double GenericMathCallSites()
    {
        Meters total = GenericMath.SumAll(new Meters(1), new Meters(2), new Meters(3));
        int added = GenericMath.Add(1, 2);
        double addedDouble = GenericMath.Add(1.5, 2.5);
        Meters viaStaticVirtual = GenericMath.SumVia(new Meters(1), new Meters(2));
        return total.Value + added + addedDouble + viaStaticVirtual.Value;
    }
}
