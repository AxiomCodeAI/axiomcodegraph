// HALF TWO — declaration merging. TWO PARTS, part 2 of 2.
//
// This part ADDS an interface to the list that part 1 started, carries its own
// attribute, and declares members part 1 calls. Neither part is "the"
// declaration: the schema deliberately has no `isPrimaryDeclaration` column,
// because choosing one is cross-file.
using System;

namespace Fixtures.CSharpOnly.Partials;

// Part 2: adds IAudited. The merged type implements EntityBase, IIdentity AND
// IAudited, and NO SINGLE FILE says so.
[Serializable]
public partial class TwoPartEntity : IAudited
{
    private DateTimeOffset modifiedAt = DateTimeOffset.UnixEpoch;

    public DateTimeOffset ModifiedAt => modifiedAt;

    public string Name { get; set; } = string.Empty;

    public void Touch(DateTimeOffset now) => modifiedAt = now;

    // A member calling one declared in part 1.
    public string Summary() => Describe();
}
