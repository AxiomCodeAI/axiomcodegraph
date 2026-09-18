// ASSEMBLY- AND MODULE-LEVEL ATTRIBUTES.
//
// Closing a coverage hole found by running cs-impl's enum audit against this
// corpus: `CsAttributeTarget.ASSEMBLY` and `CsAttributeTarget.MODULE` were
// declared and unreached, because nothing here carried either.
//
// These are the two targets that attach to nothing in the file. An assembly
// attribute belongs to the COMPILATION, a module attribute to the module — so
// the owner of the row is not any declaration, and a `cs_attribute` extractor
// that always keys to an enclosing declaration has nowhere to put them.
//
// Placement is constrained: they must follow every `using` and precede every
// type declaration in the file. That is why they live in a file of their own,
// which is also what real projects do (AssemblyInfo.cs).
using System;
using System.Reflection;
using System.Runtime.CompilerServices;

// Real BCL assembly attributes, the ones that actually appear in AssemblyInfo.
[assembly: AssemblyDescription("cs-fixtures staging — ported category: attributes")]
// NOT AssemblyConfiguration: the SDK generates that one into
// obj/Ported.AssemblyInfo.cs, and a second is CS0579. A real fact about
// assembly attributes — some of them are already there, written by the build.
[assembly: CLSCompliant(false)]

// An assembly attribute with a `typeof` argument, so the ASSEMBLY target and a
// TYPEOF argument value appear on the same row.
[assembly: Fixtures.Ported.Attributes.NamedArg("assembly-level", Target = typeof(string))]

// InternalsVisibleTo — the assembly attribute that changes ACCESSIBILITY for
// another assembly, and therefore the one an engine most needs to see.
[assembly: InternalsVisibleTo("Fixtures.Ported.Tests")]

// MODULE target. One module per assembly here, so this attaches to it.
[module: Fixtures.Ported.Attributes.SingleValue("module-level")]
[module: Fixtures.Ported.Attributes.Marker]

namespace Fixtures.Ported.Attributes;

// A declaration in the same file, after the global attributes, so the
// file-level and declaration-level rows sit side by side.
public sealed class HasAssemblyAndModuleAttributes
{
    public int Value => 1;
}
