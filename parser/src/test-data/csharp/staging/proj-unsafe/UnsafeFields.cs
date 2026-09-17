// FIELDS THAT NEED AN UNSAFE CONTEXT.
//
// Closing a coverage hole found by running cs-impl's enum audit against this
// corpus: `CsFieldModifier.UNSAFE` was declared and unreached. Pointers.cs
// carries pointer fields, but on types declared `unsafe struct` — so the
// modifier is on the TYPE and the fields inherit the context without carrying
// the modifier themselves. The value is only produced by `unsafe` written on
// the FIELD.
//
// The remaining ten field modifiers are at
// ../ported/type-registry/FieldForms.cs, which cannot host these two because
// <AllowUnsafeBlocks> is a project property.
using System;

namespace Fixtures.Unsafe;

// A type that is NOT declared unsafe, so each pointer field must say so itself.
public class FieldsInASafeType
{
    // `unsafe` on the FIELD, which is the only spelling that produces the
    // modifier on the field's own row.
    public unsafe int* Pointer;

    private unsafe void* opaque;

    internal unsafe byte** Indirect;

    protected unsafe delegate*<int, int> FunctionPointer;

    // Combined with the other modifiers, because they compose.
    public static unsafe int* StaticPointer;

    public readonly unsafe int* ReadOnlyPointer;

    private static readonly unsafe void* SharedOpaque = null;

    public unsafe int Read() => Pointer == null ? 0 : *Pointer;

    public unsafe FieldsInASafeType()
    {
        ReadOnlyPointer = null;
        opaque = null;
        Indirect = null;
        FunctionPointer = null;
        _ = opaque == SharedOpaque;
    }
}

// `fixed` — a fixed-size buffer, which is inline storage rather than a
// reference, and which is only legal in a struct. The declaring struct here is
// NOT `unsafe`, so the fields carry both modifiers themselves.
public struct BufferInASafeStruct
{
    public unsafe fixed byte Magic[8];

    public unsafe fixed char Name[16];

    public unsafe fixed int Values[4];

    public int Length;
}

// The contrasting shape, kept adjacent: the TYPE is unsafe and the fields are
// not, so the same source construct produces the modifier on a different row.
public unsafe struct BufferInAnUnsafeStruct
{
    public fixed byte Magic[8];

    public int* Pointer;

    public int Length;
}
