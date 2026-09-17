// HALF TWO — MORE THAN ONE NAMESPACE IN ONE FILE, plus a type in the global
// namespace, plus a namespace name that SHADOWS a type name.
//
// 13 files in the measured corpus declare more than one namespace, which is why
// cs_module carries `namespaceStyle = MIXED` and `namespaceCount` rather than a
// single namespace name.
using System;

namespace Alpha
{
    public class Thing
    {
        public string Which => "alpha";
    }

    public interface IMarker
    {
    }
}

namespace Beta
{
    public class Thing
    {
        public string Which => "beta";
    }

    // Reaching the SAME SHORT NAME in another namespace requires qualification,
    // and the two `Thing`s are unrelated types with identical short names in
    // one file.
    public class Consumer
    {
        public Alpha.Thing FromAlpha { get; } = new Alpha.Thing();

        public Beta.Thing FromBeta { get; } = new Beta.Thing();

        public Thing Unqualified { get; } = new Thing();

        public string Both => FromAlpha.Which + FromBeta.Which + Unqualified.Which;
    }
}

namespace Gamma.Delta
{
    // A dotted namespace declared beside two simple ones.
    public class Thing
    {
        public Alpha.Thing Alpha { get; } = new Alpha.Thing();

        public Beta.Thing Beta { get; } = new Beta.Thing();
    }
}

namespace Alpha
{
    // The SAME namespace re-opened later in the same file. Namespaces merge
    // across declarations, across files and across assemblies — the one thing
    // in C# that really is open for extension.
    public class SecondThing
    {
        public Thing Sibling { get; } = new Thing();
    }
}

// A namespace whose name is also a TYPE name elsewhere. `global::` is the only
// way out of the resulting ambiguity, which is the reason the root alias exists.
namespace Shadowed
{
    public class System
    {
        public string Name => "not the BCL System";
    }

    public class NeedsGlobalQualifier
    {
        // `System.String` here would bind to Shadowed.System, which has no
        // String member. The root alias escapes it.
        public global::System.String Text { get; } = "text";

        public global::System.Collections.Generic.List<int> Items { get; } = new();

        public System Local { get; } = new System();

        public string Describe() => Local.Name + Text.Length + Items.Count;
    }
}
