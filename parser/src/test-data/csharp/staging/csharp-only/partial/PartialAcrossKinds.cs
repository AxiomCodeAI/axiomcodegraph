// HALF TWO — every declaration kind that can be partial, and the merges that
// are NOT legal.
//
// Legal: partial class, partial struct, partial record, partial record struct,
// partial interface. A nested type may be partial inside a partial parent.
//
// NOT legal, and therefore absent by rule rather than by omission: a partial
// class does not merge with a partial struct or a partial interface of the same
// name; partial enums and partial delegates do not exist; two partial types
// with the same name and different ARITY are two different types.
using System;
using System.Collections.Generic;

// This file uses a BLOCK namespace, not a file-scoped one, because it declares
// a second namespace below and C# forbids mixing the two forms in one file
// (CS8955). That constraint is itself worth a fixture.
namespace Fixtures.CSharpOnly.Partials
{

    public partial struct PartialStruct
    {
        public int X;
    }

    public partial struct PartialStruct : IEquatable<PartialStruct>
    {
        public int Y;

        public bool Equals(PartialStruct other) => X == other.X && Y == other.Y;

        public override bool Equals(object? obj) => obj is PartialStruct other && Equals(other);

        public override int GetHashCode() => HashCode.Combine(X, Y);
    }

    public partial record PartialRecord(int Id);

    public partial record PartialRecord
    {
        public string Label => $"#{Id}";
    }

    public partial record struct PartialRecordStruct(int Id);

    public partial record struct PartialRecordStruct
    {
        public string Label => $"#{Id}";
    }

    public partial interface IPartialInterface
    {
        int First();
    }

    public partial interface IPartialInterface
    {
        int Second();
    }

    // Same name, DIFFERENT ARITY: three unrelated partial types, six declarations,
    // three groups. The measured corpus has 167 of these collisions and arity is
    // what separates them.
    public partial class Ambiguous
    {
        public int A;
    }

    public partial class Ambiguous
    {
        public int B;
    }

    public partial class Ambiguous<T>
    {
        public T? A;
    }

    public partial class Ambiguous<T>
    {
        public T? B;
    }

    public partial class Ambiguous<T1, T2>
    {
        public T1? A;
    }

    public partial class Ambiguous<T1, T2>
    {
        public T2? B;
    }

    // Two partial types of the same name in DIFFERENT NAMESPACES do not merge.
    namespace Inner
    {
        public partial class Ambiguous
        {
            public int C;
        }

        public partial class Ambiguous
        {
            public int D;
        }
    }

    // A partial type nested in a NON-partial type: legal, and its scope key is the
    // enclosing type's single declaration.
    public class NonPartialHost
    {
        public partial class NestedPartial
        {
            public int First;
        }

        public partial class NestedPartial
        {
            public int Second;
        }
    }

    // The parts of one partial type may be split across an arbitrary number of
    // files; the two parts below sit in the SAME file, which is also normal and is
    // what a source generator emitting into an existing file produces.
    public partial class SameFileBothParts
    {
        public int First;
    }

    public partial class SameFileBothParts
    {
        public int Second;

        public int Sum => First + Second;
    }
}
