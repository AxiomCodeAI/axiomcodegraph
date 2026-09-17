// Port of java/imports/ImportStylePatterns.java.
//
// A C# `using` is NOT a Java import. Java imports a TYPE (or a static member,
// or a package wildcard) and resolves it against a classpath by fully-qualified
// name. C# `using` imports a NAMESPACE — it brings every type in that namespace
// into scope at once and there is no single-type import at all. The nearest
// thing to `import java.util.List;` is `using List = System.Collections.Generic.List<int>;`,
// which is an ALIAS, and aliases are covered in
// ../../csharp-only/misc/UsingFourForms.cs together with `using static`,
// `global using` and SDK-implicit usings, because three of those four have no
// Java form.
//
// This file covers only what ports: the plain namespace using, the
// fully-qualified reference that needs no using, nesting, and `global::`.
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;

// A using placed INSIDE a namespace body: its scope is that namespace only.
// Java has no equivalent — a Java import is always file-scoped.
namespace Fixtures.Ported.Usings
{
    using System.Text;

    public class UsingStyleExamples
    {
        // Resolved through `using System;`
        public DateTime Timestamp = DateTime.UnixEpoch;

        // Resolved through `using System.Collections.Generic;`
        public List<int> Numbers = new List<int>();

        public Dictionary<string, int> Map = new Dictionary<string, int>();

        // Resolved through the namespace-scoped `using System.Text;`
        public StringBuilder Builder = new StringBuilder();

        // Resolved through `using System.Collections.ObjectModel;`
        public ReadOnlyCollection<int> ReadOnly = new ReadOnlyCollection<int>(new List<int>());

        // Fully qualified: no using needed. Java's equivalent is legal too.
        public System.IO.Stream Stream;

        public System.Collections.Generic.HashSet<string> Qualified =
            new System.Collections.Generic.HashSet<string>();

        // `using System;` imports the TYPES in System and NOT its nested
        // namespaces, so `IO.TextReader` does not resolve here and
        // `System.IO.TextReader` is required. Same rule as Java's
        // `import java.util.*` not reaching `java.util.concurrent`.
        public System.IO.TextReader NotReachableAsIoTextReader;

        // `global::` — the root alias, which cannot be shadowed. It exists
        // precisely because a namespace may be shadowed by a type of the same
        // name. Java has no such escape hatch.
        public global::System.Guid RootQualified = global::System.Guid.Empty;

        public global::Fixtures.Ported.Usings.Nested.Deep DeepQualified;

        public void UsesEverything()
        {
            Numbers.Add(1);
            Map["a"] = 1;
            Builder.Append("x");
            Console.WriteLine(Timestamp);
            _ = ReadOnly.Count + Qualified.Count;
            _ = global::System.Math.Abs(-1);
        }
    }

    namespace Nested
    {
        public class Deep
        {
            // A type in a nested namespace, reachable from the parent namespace
            // by its short qualified name because namespaces nest lexically.
            public UsingStyleExamples Parent;
        }
    }
}

// A SECOND namespace in the same file, with its OWN using set. The two
// namespaces in this file do not share `using System.Text;`.
namespace Fixtures.Ported.Usings.Sibling
{
    using System.Globalization;

    public class SiblingScope
    {
        // Resolved through the file-level `using System;`, which reaches here.
        public DateTime Timestamp;

        // Resolved through the namespace-scoped `using System.Globalization;`,
        // which does NOT reach Fixtures.Ported.Usings.
        public CultureInfo Culture = CultureInfo.InvariantCulture;

        // Reaching a sibling namespace by qualified name.
        public Fixtures.Ported.Usings.UsingStyleExamples Sibling;
    }
}
