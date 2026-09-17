// HALF TWO — no Java analogue whatsoever. Pointers, fixed buffers, stackalloc
// into a pointer, function pointers and pointer arithmetic.
//
// Type-reference note: `int*`, `void*`, `int**` and `delegate*<int,int>` are
// TYPE references with a shape no other language here produces, which is why
// cs_type_reference carries `isPointer`.
using System;
using System.Runtime.InteropServices;

namespace Fixtures.Unsafe;

// An `unsafe` TYPE: every member is an unsafe context.
public unsafe struct Header
{
    // A FIXED-SIZE BUFFER: an array embedded in the struct's own storage.
    public fixed byte Magic[4];

    public fixed char Name[16];

    public int Length;

    // A pointer FIELD.
    public byte* Payload;

    public void* Opaque;

    public byte** Indirect;
}

public class Pointers
{
    // An `unsafe` METHOD.
    public unsafe int SumViaPointer(int[] data)
    {
        int total = 0;

        // `fixed` pins the array so a pointer into it stays valid.
        fixed (int* start = data)
        {
            int* end = start + data.Length;
            for (int* p = start; p < end; p++)
            {
                total += *p;
            }
        }

        return total;
    }

    // An `unsafe` BLOCK inside an ordinary method.
    public int SumViaBlock(int[] data)
    {
        int total = 0;
        unsafe
        {
            fixed (int* start = data)
            {
                for (int i = 0; i < data.Length; i++)
                {
                    total += start[i];
                }
            }
        }

        return total;
    }

    // Pointer arithmetic, dereference, address-of, `->`, casts between pointer
    // types, and `sizeof` of a user struct.
    public unsafe void Arithmetic()
    {
        int value = 42;
        int* p = &value;
        int** pp = &p;

        *p = 43;
        **pp = 44;

        int* moved = p + 1;
        int* back = moved - 1;
        long distance = moved - back;

        void* opaque = p;
        byte* asBytes = (byte*)opaque;
        int reinterpreted = *(int*)asBytes;

        var header = new Header { Length = 1 };
        Header* hp = &header;
        hp->Length = 2;
        int viaArrow = hp->Length;

        int size = sizeof(Header);
        int intSize = sizeof(int);

        _ = distance + reinterpreted + viaArrow + size + intSize;
    }

    // `stackalloc` into a POINTER, which is the unsafe form. The safe Span form
    // is in ../csharp-only/... and needs no unsafe context at all.
    public unsafe int StackAllocPointer(int size)
    {
        int* buffer = stackalloc int[8];
        buffer[0] = size;
        buffer[1] = size * 2;

        byte* bytes = stackalloc byte[16];
        bytes[0] = 1;

        // The initialiser form.
        int* initialised = stackalloc int[] { 1, 2, 3 };

        return buffer[0] + buffer[1] + bytes[0] + initialised[2];
    }

    // Accessing a fixed buffer requires pinning even from inside the struct.
    public unsafe string ReadMagic(Header header)
    {
        byte* magic = header.Magic;
        return $"{magic[0]}{magic[1]}{magic[2]}{magic[3]}";
    }

    // FUNCTION POINTERS (C# 9): `delegate*` is a pointer to a method with no
    // object, no allocation and no delegate type. The managed and the
    // unmanaged calling conventions are different types.
    public unsafe int ViaFunctionPointer(int input)
    {
        delegate*<int, int> managed = &Double;
        delegate*<int, int, int> twoArgs = &Add;
        delegate* unmanaged<int, int> unmanagedPointer = &UnmanagedDouble;

        int a = managed(input);
        int b = twoArgs(input, 1);
        int c = unmanagedPointer(input);

        // A function pointer stored in a field and passed as an argument.
        return a + b + c + Apply(&Double, input);
    }

    private static int Double(int value) => value * 2;

    private static int Add(int a, int b) => a + b;

    [UnmanagedCallersOnly]
    private static int UnmanagedDouble(int value) => value * 2;

    private static unsafe int Apply(delegate*<int, int> f, int value) => f(value);

    // Marshalling with pointers — the P/Invoke shape that made unsafe exist.
    [DllImport("libc", EntryPoint = "memcmp")]
    private static extern unsafe int MemCompare(void* a, void* b, nuint count);

    public unsafe bool SameBytes(byte[] left, byte[] right)
    {
        if (left.Length != right.Length)
        {
            return false;
        }

        fixed (byte* l = left)
        fixed (byte* r = right)
        {
            return MemCompare(l, r, (nuint)left.Length) == 0;
        }
    }

    // `nint` / `nuint` — native-sized integers, C# 9. Not pointers, but the
    // same territory and a distinct primitive type reference.
    public nint NativeInt(nint value) => value + 1;

    public nuint NativeUInt(nuint value) => value + 1;

    // A pointer type in every reference position that accepts one.
    public unsafe void PointerTypeReferences(
        int* parameter,
        void* opaque,
        int** doubleIndirect,
        byte*[] arrayOfPointers)
    {
        int* local = parameter;
        int*[] localArray = arrayOfPointers is null ? null : new int*[1];
        Type handle = typeof(int*);
        _ = local == null ? 0 : *local;
        _ = localArray?.Length ?? 0;
        _ = handle.Name.Length + (opaque == null ? 0 : 1) + (doubleIndirect == null ? 0 : 1);
    }

    public unsafe int* ReturnsPointer(int[] data)
    {
        fixed (int* p = data)
        {
            return p;
        }
    }
}
