// HALF TWO — `global using`. Every directive in this file applies to EVERY
// OTHER FILE in this compilation, including files that import nothing and
// mention no namespace. Consumer.cs is the proof: it has no `using` line at all
// and still resolves List<T>, Console and the alias below.
//
// A global using may itself be a namespace, a static or an alias, so the schema
// carries GLOBAL_NAMESPACE, GLOBAL_STATIC and GLOBAL_ALIAS as separate kinds.
// All three are here.
//
// Constraint worth recording: global usings must precede all non-global ones IN
// EVERY FILE, and only one file per project conventionally holds them — but the
// language permits them in any file, which the second block below demonstrates.

global using System;
global using System.Collections.Generic;
global using System.Linq;

global using static System.Math;
global using static System.String;

global using Registry = System.Collections.Generic.Dictionary<string, int>;
global using Handler = System.Action<int>;

// A NON-global using in the same file, after the global ones. Its scope is this
// file only, which is the distinction the two kinds exist to make.
using System.Text;

namespace Fixtures.GlobalUsings;

public class DeclaringFile
{
    private readonly StringBuilder localOnly = new StringBuilder();

    public Registry Counts { get; } = new Registry();

    public int Length => localOnly.Length;
}
