// CS-CORPUS-6. A primary-constructor base invocation produces no cs_call_site
// row. 2,207 call sites, 3.5% of all misses.
//
// The schema is explicit that it should: CsCallKind.BASE_CONSTRUCTOR_CALL is
// "`: base(a)` -- and on a primary constructor, `: Base(a)` in the base list".
// The control below shows the written-constructor form IS emitted, so
// BASE_CONSTRUCTOR_CALL works and this one shape does not.
//
// cs-impl already found that this construct has TWO tree shapes -- flat for a
// class, wrapped in primary_constructor_base_type for a record -- and fixed
// baseTypeName and hasPrimaryConstructorArguments. The call site was not
// reached. Both shapes are here for that reason.
using System.Collections.Generic;

namespace Fixtures.WalkGaps
{
    public class Base { public Base(int x) { } }
    public class BaseOfT<T> { public BaseOfT(IEqualityComparer<T> c) { } }

    // GAP: plain class, flat shape.
    public class PlainPrimary(int a) : Base(a) { }

    // GAP: generic class with a constraint.
    public class GenericPrimary<T>(int a) : Base(a) where T : notnull { }

    // GAP: nested generic, a CALL as the base argument, constraints after.
    // This is the one BCL library shape.
    public class Enclosing
    {
        private sealed class Nested<TKey, TValue>(TKey[] keys)
            : BaseOfT<TKey>(EqualityComparer<TKey>.Default)
            where TKey : notnull
        {
            private readonly TKey[] _keys = keys;
        }
    }

    // GAP: positional record, wrapped shape. The base must itself be a RECORD
    // -- CS8864, "records may only inherit from object or another record".
    // Written against the class above first, and corrected on the compiler's
    // word rather than guessed at.
    public record BaseRecord(int X);
    public record PositionalRecord(int X) : BaseRecord(X);

    // GAP: record struct with an interface in the base list as well.
    public interface IMarker { }
    public record struct PositionalRecordStruct(int X) : IMarker;

    // CONTROL: the written-constructor form. This IS emitted, as
    // BASE_CONSTRUCTOR_CALL, and must stay that way.
    public class WrittenConstructor : Base
    {
        public WrittenConstructor(int a) : base(a) { }
        public WrittenConstructor() : this(0) { }
    }

    // CONTROL: a primary constructor with NO base argument list. There is no
    // invocation here and there must be no row.
    public class NoBaseArguments(int a) { private readonly int _a = a; }
}
