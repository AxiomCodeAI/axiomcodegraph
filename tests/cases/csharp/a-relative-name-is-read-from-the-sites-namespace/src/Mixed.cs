// one file declaring several namespaces: the namespaces a name is read from are the SITE's, not the file's
namespace P.Models       { public sealed class Report { public static Report Make() { return new Report(); } } }
namespace P.Other.Models { public sealed class Report { public static Report Make() { return new Report(); } } }
namespace Z.Models       { public sealed class Report { public static Report Make() { return new Report(); } } }

namespace P
{
    public sealed class Calls
    {
        // inside P, Models is P.Models; P.Other is a child of P and not in scope here
        public Models.Report Partially() => Models.Report.Make();
    }
}

namespace P.Other
{
    public sealed class Deeper
    {
        // inside P.Other, Models is P.Other.Models: the innermost namespace with a match wins
        public Models.Report Nearest() => Models.Report.Make();

        // a nested type reads from the same namespace as the type around it
        public sealed class Inner
        {
            public Models.Report Nested() => Models.Report.Make();
        }
    }
}
