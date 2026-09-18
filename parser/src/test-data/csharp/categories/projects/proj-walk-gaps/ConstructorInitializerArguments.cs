// CS-CORPUS-19. Every call inside a constructor INITIALIZER's argument list is
// dropped: `: base(M())` and `: this(N())` emit the BASE_/THIS_CONSTRUCTOR_CALL
// and nothing for M() or N(). The same call in a constructor BODY is fine.
//
// A regression, introduced by the commit that fixed CS-CORPUS-6 (the
// primary-constructor base invocation): the initializer's argument list now
// reaches a handler that emits the base call and does not walk its arguments.
// At the previous commit all four calls below were emitted; at the fixing
// commit only the control is.
//
// It first showed as CS-CORPUS-14 and -15 "clearing" on IfSplitExpressionBody.cs
// -- the DELEGATE_INVOKE rows were gone -- and the member comparator showed the
// method was back. A defect that moves from wrong-kind to missing is not
// half-fixed; it is a different defect. This is that defect.
namespace Fixtures.WalkGaps
{
    public class CiBase { public CiBase(string s) { } public CiBase() { } }

    public class ConstructorInitializerArguments : CiBase
    {
        static string M() => "";
        static string N() => "";

        // GAP: a call as the base-initializer argument.
        public ConstructorInitializerArguments() : base(M()) { }

        // GAP: a call as the this-initializer argument.
        public ConstructorInitializerArguments(int x) : this(N()) { }

        // GAP: two calls inside one initializer argument. Both go.
        public ConstructorInitializerArguments(string s) : base(M() + N()) { }

        // GAP: a call nested inside an object creation in the argument.
        public ConstructorInitializerArguments(long l) : base(new string(M())) { }

        // CONTROL: the same call in a constructor body. Emitted.
        public ConstructorInitializerArguments(double d) { var v = M(); }

        // CONTROL: the initializer with a literal argument -- one row, the
        // base call, and nothing to lose.
        public ConstructorInitializerArguments(bool b) : base("literal") { }
    }
}
