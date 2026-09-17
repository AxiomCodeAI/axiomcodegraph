// The other half of the cross-file resolution edge: this file resolves types
// declared in UsingStyles.cs through a `using`, which is the case that requires
// the parser to carry the import edge rather than resolve it.
using System;
using Fixtures.Ported.Usings;
using Fixtures.Ported.Usings.Nested;
using Fixtures.Ported.Usings.Sibling;

namespace Fixtures.Ported.Usings.Consumers;

public class CrossFileUsingConsumer
{
    private readonly UsingStyleExamples resolvedByUsing = new UsingStyleExamples();

    private readonly Deep resolvedByNestedUsing = new Deep();

    private readonly SiblingScope resolvedBySiblingUsing = new SiblingScope();

    // The same type, reached without any using at all.
    private readonly Fixtures.Ported.Usings.UsingStyleExamples resolvedByQualifiedName =
        new Fixtures.Ported.Usings.UsingStyleExamples();

    // An UNUSED using is still a directive and still a row. `System` above is
    // used; this one is here to be unused.
    public int Count() =>
        resolvedByUsing.Numbers.Count
        + (resolvedByNestedUsing.Parent == null ? 0 : 1)
        + (resolvedBySiblingUsing.Sibling == null ? 0 : 1)
        + resolvedByQualifiedName.Map.Count;
}
