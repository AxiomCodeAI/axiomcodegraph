// A `#if` CONDITION THE PARSER CANNOT EVALUATE.
//
// Closing a coverage hole found by running cs-impl's enum audit against this
// corpus: `CsActivationSource.UNEVALUATED` was declared and unreached.
//
// It is the one activation source that is a LIMITATION rather than a fact:
// `isActive = false` otherwise means the condition was false, or an earlier
// branch won, or it was an `#else` nobody reached — and an auditor cannot tell
// a limitation from a fact by looking at the rows. That is why the value exists.
//
// MEASURED, not guessed. Probing the evaluator with twenty-one condition shapes
// showed it handles every form the C# preprocessor grammar actually admits —
// identifier, `true`, `false`, `!`, `&&`, `||`, `==`, `!=`, parentheses — and
// returns `evaluated: false` for exactly two:
//
//   * an INTEGER LITERAL condition, which tree-sitter parses CLEANLY (no ERROR
//     node anywhere) and the evaluator has no case for;
//   * a condition whose node is missing entirely, e.g. `#if A == "x"`.
//
// So UNEVALUATED IS UNREACHABLE FROM COMPILING C#. Every legal condition
// evaluates. Its only population is files that do not compile, which is why
// this file is in proj-noncompiling and not beside the other `#if` fixtures —
// and that is a fact about the value worth recording, because it changes what a
// zero-row assertion on it would have meant.
//
// Expected: CS1517 (invalid preprocessor expression) on each `#if` below.
using System;

namespace Fixtures.NonCompiling;

// An INTEGER literal condition. Parses cleanly; the evaluator has no case for
// `integer_literal`, so the branch is UNEVALUATED rather than CONDITION_FALSE.
#if 1
public class GuardedByInteger
{
    public int Value => 1;
}
#endif

// With an `#else`, so the sibling branch's activation source can be compared
// against the unevaluable one on the same chain.
#if 0
public class GuardedByZero
{
    public int Value => 0;
}
#else
public class ElseOfUnevaluable
{
    public int Value => -1;
}
#endif

// An `#elif` whose own condition is unevaluable, after an `#if` that is not.
#if DEBUG
public class LiveBranch
{
    public int Value => 1;
}
#elif 2
public class UnevaluableElif
{
    public int Value => 2;
}
#else
public class FinalElse
{
    public int Value => 3;
}
#endif

// A condition whose expression node is absent entirely: the second operand is
// a string, which the preprocessor grammar does not admit at all.
#if FEATURE == "enabled"
public class GuardedByStringComparison
{
    public int Value => 4;
}
#endif

// For contrast, in the same file: conditions the evaluator DOES handle, so the
// four evaluable activation sources appear beside the unevaluable one.
#if DEBUG && !RELEASE
public class EvaluableTrue
{
    public int Value => 5;
}
#endif

#if NOT_DEFINED
public class EvaluableFalse
{
    public int Value => 6;
}
#endif
