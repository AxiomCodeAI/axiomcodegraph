// THE SOURCE-GENERATOR PARTIAL, WITHOUT THE GENERATOR.
//
// The two attributes below are of the shape a source generator triggers on: a
// marker on a field that the generator turns into a property, and a marker on
// a method that it turns into a command. The generator package is ABSENT, so
// the partial has exactly one part and the members the generator would have
// written do not exist. Their names are this fixture's own — what the parser
// sees is a partial class annotated with an attribute whose declaring assembly
// is missing, and that works under any name; what a reader needs is this
// paragraph.
//
// ../proj-partial-generated/ uses three generators that ship in the SDK, so its
// single-part partials really do gain their other halves. This file is the
// same shape with NO generator registered: the attributes are ordinary
// attributes, nothing is generated, and every reference to a would-be
// generated member fails.
//
// This is what a checkout looks like when the generator package is missing, and
// it is the environmental class BUILDING-A-PARSER.md §7 says to classify rather
// than report as a gap. The parser's output for this file should be
// INDISTINGUISHABLE from its output for a file whose generator did run — the
// parser cannot tell, and neither can the source.
//
// Expected: CS1061 / CS0117 on every generated-member reference, and CS0501
// ("must declare a body") on the partial method that has no implementation
// because no generator supplied one.
using System;

namespace Fixtures.NonCompiling;

[AttributeUsage(AttributeTargets.Field)]
public sealed class GeneratedPropertyAttribute : Attribute
{
}

[AttributeUsage(AttributeTargets.Method)]
public sealed class GeneratedCommandAttribute : Attribute
{
}

public partial class ViewModel
{
    // In a project where the generator is present, this field becomes a
    // `Name` property with change notification. Here nothing does.
    [GeneratedProperty]
    private string name = string.Empty;

    [GeneratedProperty]
    private int count;

    // Likewise `Save` would become a `SaveCommand` property.
    [GeneratedCommand]
    private void Save()
    {
    }

    public string Describe()
    {
        // CS1061 — `Name`, `Count` and `SaveCommand` are the members the
        // generator would have written.
        return Name + Count + SaveCommand;
    }
}

public partial class HasUnimplementedExtendedPartial
{
    // A C# 9 extended partial method: an implementation is MANDATORY, and in a
    // generator-driven project the generator supplies it. Without one this is
    // CS0759.
    public partial int Compute(int input);

    public int Use(int input) => Compute(input);
}
