// GATE FIXTURE for cs-impl -- `CsParseGapKind.SELF_REPORTING_NODE`, and the
// one character that produces it.
//
// FOUND BY cs-corpus, NOT BY ME, and worth saying why. I probed thirty-six
// synthetic shapes for this value -- every malformed #pragma, #line and
// #nullable form, each in ten syntactic positions, plus seven broken-member
// shapes at four file sizes -- and reported it "not synthesizable, an emergent
// property of large real files". Every one of those thirty-six probes ended
// with a newline. cs-corpus isolated the trigger from real corpus files to
// exactly that: a `#pragma` directive as the LAST LINE of a file with NO
// TRAILING NEWLINE. I had varied the directive and its placement and never the
// file's terminator, which is the finding at the top of ../MANIFEST.md --
// "varies the construct, not the modifier" -- turned on its author.
//
// WHAT IT IS. The root reports an error and there is NO ERROR node, NO inserted
// node and NO zero-width named node anywhere in the tree: the `preproc_pragma`
// node reports `hasError` on ITSELF. 9.3% of every file with a parse error in
// cs-oracle's corpus and 26 files in cs-corpus's, every one of them a
// `#pragma warning restore` at the end of a test file. It is a grammar defect
// worth filing upstream, not a property of broken source.
//
// THIS FILE IS VALID C#. It compiles without a diagnostic, which is why it
// lives in proj-grammar-gate beside async-as-identifier and not in
// proj-noncompiling: same class -- source the compiler accepts and the vendored
// grammar does not.
//
// THE LAST BYTE OF THIS FILE IS LOAD-BEARING. It is `8`, not `\n`. Any editor
// configured to add a final newline silently turns this into its own control
// and the gate that needs it goes quietly green. The control is the file beside
// it, byte-identical but for that newline, and it parses clean -- without it
// the claim would be about pragmas rather than about the newline. A gate
// asserting the last byte of this file is requested of cs-impl.
using System;

namespace Fixtures.GrammarGate;

public class PragmaAtEndOfFile
{
    public int Value => 1;

    // A `#pragma` INSIDE the body parses fine; only the one at the very end of
    // the file, unterminated, does not.
#pragma warning disable CS0618
    public int Inside => 2;
#pragma warning restore CS0618
}
#pragma warning restore 618