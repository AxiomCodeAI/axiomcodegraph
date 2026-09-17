// HALF TWO — declaration merging. TWO PARTS, part 1 of 2.
//
// `name -> single entity` is false in C#, and the schema states the primary key
// before any row exists (§2.1): `cs_type` has ONE ROW PER DECLARATION SITE, and
// the merged type is identified by a non-unique `declarationGroupKey` of
// (declarationScopeKey, name, arity). Two parts here means two rows and one
// group.
//
// The parts of a partial type may differ in: which base list entries they name,
// which interfaces they add, which attributes they carry, which type-parameter
// CONSTRAINTS they state (they must agree if both state them), and their
// member sets. They must agree on: name, arity, accessibility, and the `class`
// / `struct` / `record` / `interface` keyword.
using System;
using System.Collections.Generic;

namespace Fixtures.CSharpOnly.Partials;

public interface IIdentity
{
    int Id { get; }
}

public interface IAudited
{
    DateTimeOffset ModifiedAt { get; }
}

public abstract class EntityBase
{
    public abstract string Describe();
}

// Part 1: declares the BASE CLASS and one interface, an attribute, a field, a
// constructor, a property and a method.
[Obsolete("part one carries this attribute")]
public partial class TwoPartEntity : EntityBase, IIdentity
{
    private readonly int id;

    public TwoPartEntity(int id) => this.id = id;

    public int Id => id;

    public override string Describe() => $"{Id}:{Name}";

    // A method declared here and CALLING one declared in the other part.
    public string DescribeWithAudit() => Describe() + "@" + ModifiedAt;
}
