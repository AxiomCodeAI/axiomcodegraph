// A USER-DEFINED OPERATOR IS A STATIC METHOD CALL, AND SO IS AN EXPLICIT CAST.
// `a + b` where the operand type overloads `+` runs `op_Addition`; `(Money)d` runs
// `op_Explicit`. Both are edges into user code with a body to walk into, and both
// are written down -- which is what separates them from an IMPLICIT conversion,
// which runs with no syntax at the call site at all and stays reserved.
//
// WHICH method runs is resolution, not syntax: `int + int` and `Money + Money` are
// spelled identically, and `-` is `op_Subtraction` between two operands and
// `op_UnaryNegation` before one. So the parser emits a site for every written
// operator and cast and this layer decides, exactly as it does for a receiver's
// type at an ordinary invocation.
//
// THE CONTROLS ARE IN THIS FILE:
//
//   1. BUILT-IN operators on the same tokens (`int + int`, `i > 0`, `(int)d`).
//      They run no user code -- System.Int32 declares no op_Addition, it is an IL
//      instruction -- so the engine must answer `known_builtin_operator` and NOT
//      invent an edge into Money's operator, which is the failure a token-only
//      match produces.
//   2. THE ARITY PAIR. `Money` declares both `operator -(Money)` and
//      `operator -(Money, Money)`. Both carry the token `-`, so matching on the
//      token alone makes each site resolve to two targets; only one is right and
//      the site is not a fan.
//   3. Operators that CANNOT be user-defined -- `&&`, `||`, `??` -- which must get
//      no operator site at all. `&&` is composed from op_BitwiseAnd plus
//      op_True/op_False, so naming it would invent a method C# has no way to
//      declare.
//   4. `x as Money`, which cannot run a user-defined conversion and must not be
//      read as one.
namespace Cases.Operators;

public struct Money
{
    public decimal Amount;

    public static Money operator +(Money x, Money y) => new Money { Amount = x.Amount + y.Amount };
    public static Money operator -(Money x, Money y) => new Money { Amount = x.Amount - y.Amount };
    // CONTROL 2: the same token, one operand. A different method.
    public static Money operator -(Money x) => new Money { Amount = -x.Amount };
    public static bool operator ==(Money x, Money y) => x.Amount == y.Amount;
    public static bool operator !=(Money x, Money y) => !(x == y);
    public static bool operator <(Money x, Money y) => x.Amount < y.Amount;
    public static bool operator >(Money x, Money y) => x.Amount > y.Amount;

    public static explicit operator Money(decimal d) => new Money { Amount = d };
    public static implicit operator decimal(Money m) => m.Amount;

    // NOT `other is Money m && this == m`. A PATTERN BINDING has no type in the
    // engine, so neither operand of that `==` types and the site reads as built-in
    // while the oracle reports Money.op_Equality. That is a general gap -- a
    // pattern-bound name is untyped wherever it is used, not only beside an
    // operator -- so it is named here and left to its own change rather than
    // pinned by a case that would go green for the wrong reason.
    //
    // `this` on its own is fine: `this == other` and `other == this` both resolve,
    // because the OTHER operand carries the type and C# looks on both.
    public override bool Equals(object? other) => other is Money m && Amount == m.Amount;

    public bool SameAs(Money other) => this == other;
    public override int GetHashCode() => Amount.GetHashCode();
}

public class Use
{
    public Money Add(Money a, Money b) => a + b;
    public Money Sub(Money a, Money b) => a - b;
    public Money Negate(Money a) => -a;
    public bool Equal(Money a, Money b) => a == b;
    public bool NotEqual(Money a, Money b) => a != b;
    public bool Less(Money a, Money b) => a < b;
    public bool Greater(Money a, Money b) => a > b;

    // An explicit cast that runs a user-defined conversion.
    public Money FromDecimal(decimal d) => (Money)d;

    // CONTROL 1: the same tokens on built-in types. No user code runs.
    public int BuiltinAdd(int i, int j) => i + j;
    public bool BuiltinCompare(int i) => i > 0;
    public int BuiltinCast(double d) => (int)d;

    // CONTROL 3: not user-definable. No operator site.
    public bool ShortCircuit(bool p, bool q) => p && q;
    public bool OrElse(bool p, bool q) => p || q;
    public string Coalesce(string? s) => s ?? "";

    // CONTROL 4: `as` cannot run a user-defined conversion.
    public object? AsCast(object o) => o as string;
}
