// A SECOND FILE in the same project, with ordinary declarations. Only ONE file
// per compilation may carry top-level statements, so this one demonstrates the
// normal shape sitting beside the exceptional one — and that the synthesised
// Program class from Program.cs is `internal`, `static`, `partial`-less and
// unreachable by name from here.
using System;

namespace Fixtures.TopLevel;

// `internal`, not `public`: the types declared after the top-level statements
// in Program.cs have no accessibility modifier, so they are `internal`, and a
// public member cannot mention them (CS0051). The default accessibility of a
// declaration in the global namespace is the trap here.
internal static class Companion
{
    public static int Describe(global::Row row) => row.Id;

    public static string Kindly(global::Kind kind) => kind.ToString();

    public static int Nested() => new global::Nested.InNamespace().Value;

    public static string ViaHelper(int value) => global::Helper.Describe(value);
}
