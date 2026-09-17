// Port of java/expressions/LiteralTypeTestCases.java.
// Interpolated strings, raw string literals and UTF-8 string literals live in
// ../../csharp-only/strings/ because they have no Java form.
using System;

namespace Fixtures.Ported.Expressions;

public class LiteralTypeTestCases
{
    // Integers: decimal, hexadecimal, binary, and digit separators.
    public int Decimal = 42;
    public int Negative = -42;
    public uint Hex = 0xDEAD_BEEFU;
    public int SmallHex = 0x2A;
    public int Binary = 0b1010_1010;
    public int Separated = 1_000_000;
    public int Zero = 0;
    public int MaxInt = int.MaxValue;

    // Suffixes. Java writes 999L and 1.5f; C# writes the same plus U, UL and M.
    public long Long = 999L;
    public ulong ULong = 18_000_000_000_000_000_000UL;
    public uint UInt = 4_000_000_000U;
    public float Float = 1.5f;
    public double Double = 1.5d;
    public double NoSuffix = 1.5;
    public decimal Decimal128 = 1.5m;
    public double Exponent = 1.5e10;
    public double NegativeExponent = 1.5e-10;
    public float ExponentFloat = 1.5e3f;

    // decimal has no Java analogue at all — 128-bit base-10, exact for money.
    public decimal Money = 19.99m;

    // Characters, including every escape form.
    public char Simple = 'a';
    public char Newline = '\n';
    public char Tab = '\t';
    public char Backslash = '\\';
    public char Quote = '\'';
    public char DoubleQuote = '\"';
    public char Null = '\0';
    public char Bell = '\a';
    public char Backspace = '\b';
    public char FormFeed = '\f';
    public char CarriageReturn = '\r';
    public char VerticalTab = '\v';
    public char Unicode = '\u00e9';
    public char UnicodeLong = '\U000000E9';
    public char HexEscape = '\x41';

    // Strings: regular, verbatim, and every escape.
    public string Plain = "hello";
    public string Empty = "";
    public string WithEscapes = "line1\nline2\ttabbed\\slash\"quote\'apostrophe";
    public string WithUnicode = "caf\u00e9 \U0001F600";
    public string Verbatim = @"C:\path\to\file";
    public string VerbatimMultiline = @"first
second
third";
    public string VerbatimQuote = @"he said ""hi""";

    // Booleans, null, and the default literal.
    public bool True = true;
    public bool False = false;
    public string NullString = null;
    public object NullObject = null;
    public int DefaultInt = default;
    public string DefaultString = default;
    public int DefaultOfInt = default(int);
    public DateTime DefaultOfStruct = default(DateTime);

    // Nullable value types — Java has no form.
    public int? NullableInt = null;
    public int? NullableWithValue = 7;
    public DateTime? NullableStruct = null;

    // Array creation literals, in all four spellings.
    public int[] Explicit = new int[] { 1, 2, 3 };
    public int[] Sized = new int[3];
    public int[] Implicit = new[] { 1, 2, 3 };
    public int[] FieldInitializerShorthand = { 1, 2, 3 };
    public int[,] Rectangular = new int[2, 3];
    public int[,] RectangularInitialised = new int[,] { { 1, 2, 3 }, { 4, 5, 6 } };
    public int[][] Jagged = new int[2][];
    public int[][] JaggedInitialised = new int[][] { new int[] { 1 }, new int[] { 2, 3 } };
    public int[,,] ThreeDimensional = new int[2, 2, 2];

    // typeof / nameof / sizeof — nameof and sizeof have no Java form.
    public Type TypeOfClass = typeof(LiteralTypeTestCases);
    public Type TypeOfPrimitive = typeof(int);
    public Type TypeOfArray = typeof(int[]);
    public Type TypeOfOpenGeneric = typeof(System.Collections.Generic.List<>);
    public Type TypeOfClosedGeneric = typeof(System.Collections.Generic.List<int>);
    public string NameOfType = nameof(LiteralTypeTestCases);
    public string NameOfMember = nameof(Plain);
    public int SizeOfInt = sizeof(int);

    public void LiteralsInExpressionPosition()
    {
        int sum = 1 + 2 * 3;
        string joined = "a" + "b" + 1;
        char ch = 'x';
        bool flag = true && false;
        object boxed = 1;
        double mixed = 1 + 2.5;
        long widened = 1 + 2L;
        _ = sum + joined.Length + ch + (flag ? 1 : 0) + boxed.GetHashCode() + (int)mixed + (int)widened;
    }
}
