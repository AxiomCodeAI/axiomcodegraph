// CS-CORPUS-15 and CS-CORPUS-14, one shape, two defects.
//
// A METHOD whose `=>` expression body is split by a `#if` FRAGMENT is emitted
// as a PROPERTY GETTER (`get_DefaultMessage`), not as a method. Roslyn:
// MethodDeclaration, Ordinary. That is the member-layer defect.
//
// Every call to it is then unresolvable by name, and at the commit that added
// same-type grounding for DELEGATE_INVOKE the lookup MISS fell through to
// DELEGATE_INVOKE: nine ordinary static-method calls in one BCL slice labelled
// as delegate invocations. A lookup miss is "don't know", and the terminal for
// "don't know" is FUNCTION_CALL, never a positive claim.
//
// This is the standard BCL idiom for varying a body per runtime. The repro was
// two exception classes; this is the same shape under neutral names.
namespace Fixtures.WalkGaps
{
    public class IfSplitBase { public IfSplitBase(string message) { } }

    public sealed class IfSplitExpressionBody : IfSplitBase
    {
        // GAP (both): called from a constructor INITIALIZER, before any body.
        public IfSplitExpressionBody() : base(DefaultMessage()) { }

        // GAP (both): the same, through a null-coalescing argument.
        public IfSplitExpressionBody(string? message) : base(message ?? DefaultMessage()) { }

        // GAP (CS-CORPUS-15): the method itself. Its `=>` sits INSIDE the #if.
        private static string DefaultMessage()
#if NEVER_DEFINED_HERE
            => "from the branch that is off";
#else
            => "from the branch that is on";
#endif

        // CONTROL: the identical method with the #if INSIDE the body instead of
        // around the arrow. Emitted as a method, and its callers resolve.
        private static string ControlMessage()
        {
#if NEVER_DEFINED_HERE
            return "off";
#else
            return "on";
#endif
        }
        public string Control() => ControlMessage();

        // CONTROL: a call to a method with no #if anywhere. FUNCTION_CALL.
        private static string Plain() => "plain";
        public string PlainCall() => Plain();
    }
}
