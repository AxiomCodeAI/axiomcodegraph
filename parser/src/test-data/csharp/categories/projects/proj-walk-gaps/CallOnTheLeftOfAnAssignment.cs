// CS-CORPUS-7. A call on the LEFT of a simple assignment is dropped, and it
// takes the right-hand side with it. The dominant residual cause in files over
// 32,767 characters, where UnsafeAccessor-style generated code lives.
//
// Compound assignment is CORRECT, which is the control that makes this a
// statement about the simple-assignment path rather than about ref returns.
namespace Fixtures.WalkGaps
{
    public static class Accessors
    {
        private static int _field;
        public static ref int ById(object o) => ref _field;
    }

    public class CallOnTheLeftOfAnAssignment
    {
        static int _g;
        static ref int Local(object o) => ref _g;
        static int Plain() => 1;

        public void Cases(object instance, int value)
        {
            // GAP: unqualified ref-returning call as the assignment target.
            Local(instance) = value;

            // GAP: qualified ref-returning call as the target. This is the
            // `Accessors.Id(instance) = value;` shape.
            Accessors.ById(instance) = value;

            // GAP: both sides are calls. 0 of 2 -- the right-hand side is lost
            // with the left, which is the part that invents a missing edge
            // rather than just dropping one.
            Accessors.ById(instance) = Plain();

            // CONTROL: compound assignment through the same call. Correct.
            Accessors.ById(instance) += value;

            // CONTROL: a plain assignment with a call on the right. Correct.
            _g = Plain();

            // CONTROL: a local declaration with a call. Correct.
            int x = Plain();
        }
    }
}
