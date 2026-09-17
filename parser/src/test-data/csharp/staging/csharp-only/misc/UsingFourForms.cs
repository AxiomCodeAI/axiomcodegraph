// HALF TWO — `using` in the three C#-only syntactic forms. The fourth,
// IMPLICIT usings, appears in no file anywhere and lives in
// ../../proj-implicit-usings/; `global using` spans files and lives in
// ../../proj-global-usings/.
//
// The schema's §2.6 vocabulary is
//   NAMESPACE · STATIC · ALIAS · GLOBAL_NAMESPACE · GLOBAL_STATIC ·
//   GLOBAL_ALIAS · IMPLICIT
// and this file exercises the first three.

// FORM 1 — plain namespace using. Brings the TYPES of a namespace into scope
// and NOT its nested namespaces.
using System;
using System.Collections.Generic;

// FORM 2 — `using static`. Brings the accessible STATIC MEMBERS of ONE TYPE
// into scope as unqualified names: methods, fields, properties, nested types
// and enum members. Java's static import is the direct analogue, and this is
// the only one of the three that has one.
using static System.Math;
using static System.Console;
using static Fixtures.CSharpOnly.Misc.Constants;
using static Fixtures.CSharpOnly.Misc.Palette;

// FORM 3 — alias. Three sub-forms, and they are not the same thing:
//   3a. an alias for a NAMESPACE
using Gen = System.Collections.Generic;
// FOUND WHILE WRITING THIS FILE, and kept as a recorded fact rather than a
// tidied-away one: the obvious alias name for the line above is `Collections`,
// and it DOES NOT WORK here. Inside `namespace Fixtures.CSharpOnly.Misc` the
// name `Collections` binds to the sibling namespace
// `Fixtures.CSharpOnly.Collections` — members of an enclosing namespace are
// searched BEFORE using-alias directives — so `Gen.List<int>` fails
// with CS0234 rather than resolving through the alias. An alias does not win
// against a namespace member, and `global::` is the only escape.
//   3b. an alias for a TYPE
using Text = System.Text.StringBuilder;
//   3c. an alias for a CONSTRUCTED GENERIC type, which cannot be written any
//       other way and is the reason aliases exist
using IntList = System.Collections.Generic.List<int>;
using Lookup = System.Collections.Generic.Dictionary<string, System.Collections.Generic.List<int>>;
//   3d. an alias that SHADOWS a type of the same short name, resolving an
//       ambiguity that would otherwise be a compile error
using Timer = System.Threading.Timer;

namespace Fixtures.CSharpOnly.Misc;

public static class Constants
{
    public const double Tolerance = 0.0001;

    public static readonly string Prefix = "cfg";

    public static int Counter { get; set; }

    public static int Bump() => ++Counter;

    public sealed class Nested
    {
        public int Value => 1;
    }
}

public enum Palette
{
    Red,
    Green,
    Blue
}

public class UsingFourForms
{
    // A type reached through a NAMESPACE alias.
    private readonly Gen.List<int> viaNamespaceAlias = new Gen.List<int>();

    // A type reached through a TYPE alias — `Text` is StringBuilder.
    private readonly Text viaTypeAlias = new Text();

    // A CONSTRUCTED GENERIC alias, used as a type and as a constructor.
    private readonly IntList viaConstructedAlias = new IntList { 1, 2, 3 };

    private readonly Lookup viaNestedGenericAlias = new Lookup();

    public double UsesStaticMembers(double angle)
    {
        // `Sqrt`, `PI`, `Abs`, `Max` — METHODS in scope unqualified, from
        // `using static System.Math`. Nothing at the call site names Math.
        double root = Sqrt(angle);
        double half = PI / 2;
        // NOT `Abs(angle)`: the private `Abs(int)` declared at the bottom of
        // this class HIDES the imported Math.Abs entirely — a member of the
        // enclosing type beats a `using static` import even when the member is
        // not applicable, so the unqualified call fails to compile rather than
        // falling back. That is the whole shadowing rule in one line.
        double magnitude = Math.Abs(angle);
        double bounded = Max(Min(angle, 1.0), -1.0);

        // A static FIELD and a static PROPERTY brought in the same way.
        double tolerance = Tolerance;
        string prefix = Prefix;
        int counter = Counter;
        int bumped = Bump();

        // ENUM MEMBERS unqualified: `using static` on an enum type puts its
        // members in scope with no type name at all. `Red` is Palette.Red.
        Palette colour = Red;
        bool isBlue = colour == Blue;

        // A NESTED TYPE brought into scope by `using static`.
        var nested = new Nested();

        // A void static method — WriteLine, from `using static System.Console`.
        WriteLine(prefix);

        return root + half + magnitude + bounded + tolerance + counter + bumped
            + (isBlue ? 1 : 0) + nested.Value;
    }

    // The SAME calls written qualified, so the pair is comparable: identical
    // targets, different syntax, and the second needs no `using static`.
    public double SameCallsQualified(double angle)
    {
        double root = Math.Sqrt(angle);
        double half = Math.PI / 2;
        double tolerance = Constants.Tolerance;
        Palette colour = Palette.Red;
        Console.WriteLine(Constants.Prefix);
        return root + half + tolerance + (int)colour;
    }

    // A method whose UNQUALIFIED name collides with a `using static` import.
    // The member of the enclosing type wins.
    private static double Abs(int value) => value < 0 ? -value : value;

    public double LocalWinsOverStaticImport(int value) => Abs(value);

    public void AliasesInEveryPosition(Gen.IEnumerable<int> source)
    {
        // An alias in a local declaration, a `new`, a type argument, a cast,
        // `typeof`, a pattern and a default.
        IntList list = new IntList();
        Gen.List<IntList> nested = new Gen.List<IntList>();
        object boxed = list;
        IntList cast = (IntList)boxed;
        Type handle = typeof(IntList);
        bool matched = boxed is IntList;
        IntList? defaulted = default;
        Text builder = new Text();
        Timer? timer = null;

        _ = list.Count + nested.Count + cast.Count + handle.Name.Length
            + (matched ? 1 : 0) + (defaulted?.Count ?? 0) + builder.Length
            + (timer is null ? 0 : 1) + viaNamespaceAlias.Count
            + viaTypeAlias.Length + viaConstructedAlias.Count + viaNestedGenericAlias.Count;
        foreach (int item in source)
        {
            _ = item;
        }
    }

    // `global::` is the ROOT ALIAS. It is not a using directive but it is the
    // same namespace-resolution mechanism, and it is the only way to escape a
    // type that shadows a namespace name.
    public global::System.Guid RootAliased() => global::System.Guid.Empty;

    // An alias-qualified name using an EXTERN alias would need
    // `<Aliases>` metadata on a reference; there is no such reference in this
    // project, so `extern alias` is recorded as ABSENT rather than simulated.
}
