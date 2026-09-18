// CS-CORPUS-5. A comment placed before a child that the extractor reads by
// NAMED-CHILD INDEX shifts the index, and the child's whole subtree is dropped.
// The grammar exposes `left`, `right`, `condition`, `consequence` and
// `alternative` as FIELDS; reading them by position is what breaks.
//
// Measured on 1,971 files of the BCL slice that parse without a gap in both
// runs: 1,362 expressions and 80 call sites suppressed by a comment alone.
//
// Every case below has its control immediately above it, differing ONLY by the
// comment. That is the whole design: the pair is the evidence.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Fixtures.WalkGaps
{
    public static class CommentBeforeAPositionalChild
    {
        static int F() => 1;
        static int G() => 2;
        static IEnumerable<int> Items = Array.Empty<int>();

        // CONTROL: 2 of 2.
        public static int BinaryPlain = F() + G();

        // GAP: comment before the RIGHT operand. The right subtree is dropped.
        public static int BinaryCommentBeforeRight = F() + /* c */ G();

        // GAP: comment before the LEFT operand. The WHOLE binary is dropped.
        public static int BinaryCommentBeforeLeft = /* c */ F() + G();

        // GAP: the same on its own line, which is how it appears in real code.
        public static int BinaryCommentOnItsOwnLine = F() +
            // a comment
            G();

        // GAP: a logical binary, which is the common shape in a guard clause.
        public static bool LogicalCommentBeforeRight = F() > 0 && /* c */ G() > 0;

        // CONTROL: a multi-line ternary with NO comment. Correct.
        public static bool TernaryPlain()
            => Items is IReadOnlyCollection<int> s ? s.Count == 0 :
               !Items.Any();

        // GAP: the identical ternary with a trailing comment on the `:` line.
        // This is the exact shape in the BCL slice.
        public static bool TernaryCommentBeforeFalseArm()
            => Items is IReadOnlyCollection<int> s ? s.Count == 0 : // a comment
               !Items.Any();

        // GAP: a comment before the false arm, on one line.
        public static bool TernaryInlineComment()
            => Items == null ? true : /* c */ !Items.Any();

        // CONTROL: a comment before the TRUE arm. Correct -- only the false arm
        // is affected, and a fix that treated the arms alike would be untested
        // without this line.
        public static bool TernaryCommentBeforeTrueArm()
            => Items == null ? // a comment
               Items!.Any() : false;

        // GAP: a comment before the right-hand side of an assignment.
        static int Target;
        public static void AssignmentCommentBeforeRhs() { Target = /* c */ F(); }

        // CONTROL: the same assignment with no comment.
        public static void AssignmentPlain() { Target = F(); }

        // CONTROL: a comment inside an argument list, before a cast operand and
        // between a receiver and its member. All three are correct today.
        public static bool InsideArgumentList() => Items.Any(x => /* c */ x > 0);
        public static long BeforeCastOperand = (long)/* c */ F();
        public static string BetweenReceiverAndMember = "x". /* c */ ToString();
    }
}
