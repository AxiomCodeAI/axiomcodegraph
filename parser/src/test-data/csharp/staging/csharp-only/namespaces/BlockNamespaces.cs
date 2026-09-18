// HALF TWO — BLOCK namespaces, nested block namespaces, and the two things
// only the block form permits: a namespace inside a namespace, and a `using`
// scoped to one namespace rather than to the file.
using System;

namespace Fixtures.CSharpOnly.Namespaces.Block
{
    using System.Collections.Generic;

    public class InBlockNamespace
    {
        // Resolved by the namespace-scoped `using System.Collections.Generic;`,
        // which does NOT reach the sibling namespace below.
        public List<int> Items { get; } = new List<int>();
    }

    // A namespace NESTED lexically inside another. Its full name is the
    // concatenation, and the parent's usings and types are in scope.
    namespace Inner
    {
        public class InNestedNamespace
        {
            // Reaches the parent namespace's type with no qualification.
            public InBlockNamespace Parent { get; } = new InBlockNamespace();

            // And the parent's namespace-scoped using reaches here too.
            public List<string> Names { get; } = new List<string>();
        }

        namespace Deeper
        {
            public class ThreeLevels
            {
                public InNestedNamespace Middle { get; } = new InNestedNamespace();
            }
        }
    }

    // A DOTTED namespace name declared inside another one: the full name is
    // Fixtures.CSharpOnly.Namespaces.Block.Compound.Path, written in one
    // header rather than three nested blocks. Same result, different syntax
    // tree.
    namespace Compound.Path
    {
        public class InCompoundNamespace
        {
            public InBlockNamespace Parent { get; } = new InBlockNamespace();
        }
    }
}

// A SECOND top-level block namespace in the same file, WITHOUT the
// System.Collections.Generic using — proving the scoping.
namespace Fixtures.CSharpOnly.Namespaces.Sibling
{
    public class InSiblingNamespace
    {
        // Needs the full name, because `using System.Collections.Generic;` was
        // scoped to the other namespace.
        public System.Collections.Generic.List<int> Items { get; } =
            new System.Collections.Generic.List<int>();

        // Reaching across to the other namespace by qualified name.
        public Fixtures.CSharpOnly.Namespaces.Block.InBlockNamespace Other { get; } = new();
    }
}

// The GLOBAL namespace: a type with no namespace at all, declared in a file
// that also declares namespaced ones. Reachable only as `global::` + name.
public class InGlobalNamespace
{
    public int Value => 1;
}
