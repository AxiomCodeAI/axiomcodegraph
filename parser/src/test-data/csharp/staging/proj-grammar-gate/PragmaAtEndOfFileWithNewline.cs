// THE CONTROL for PragmaAtEndOfFile.cs -- byte-identical in every respect that
// matters but the final newline, and it parses clean.
//
// Without this file, "a #pragma at end of file fails to parse" would be a claim
// about pragmas rather than about the newline, and it would be wrong: the
// grammar handles a trailing #pragma perfectly well when the line is
// terminated. A control that covers nothing unique is still the only reason
// its neighbour proves what it claims.
//
// Credit: cs-corpus, who isolated the trigger to one character and declined to
// prune this control on exactly that reasoning.
using System;

namespace Fixtures.GrammarGate;

public class PragmaAtEndOfFileWithNewline
{
    public int Value => 1;

#pragma warning disable CS0618
    public int Inside => 2;
#pragma warning restore CS0618
}
#pragma warning restore 618
