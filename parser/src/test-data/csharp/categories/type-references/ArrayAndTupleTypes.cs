// Port of java/type-references/{test-array-types,test-nested-generics}.java.
// C# adds two array shapes Java has no form of — RECTANGULAR (multidimensional)
// arrays, which are a distinct type from jagged ones — and value tuples, which
// Java has no form of at all.
using System;
using System.Collections.Generic;

namespace Fixtures.Ported.TypeReferences;

public class ArrayTypeReferences
{
    // One dimension.
    public int[] Ints;
    public string[] Strings;
    public object[] Objects;
    public EntityBase[] References;

    // Jagged: an array OF arrays. Java's `int[][]` is this.
    public int[][] Jagged;
    public int[][][] JaggedThreeDeep;

    // Rectangular: ONE array with two ranks. No Java form; `int[,]` and
    // `int[][]` are different types with different runtime representations.
    public int[,] Rectangular;
    public int[,,] RectangularThreeRank;
    public int[,,,] RectangularFourRank;

    // Mixed: an array of rectangular arrays, and a rectangular array of arrays.
    public int[][,] JaggedOfRectangular;
    public int[,][] RectangularOfJagged;

    // Arrays of constructed generics, and generics of arrays.
    public List<int>[] ArrayOfGeneric;
    public List<int[]> GenericOfArray;
    public Dictionary<string, int[]>[] Both;
    public List<int[][]> GenericOfJagged;
    public List<int[,]> GenericOfRectangular;

    // Arrays of nullable value types and of nullable arrays.
    public int?[] ArrayOfNullable;

    // Array of a type parameter and of an anonymous-typed thing.
    public T[] OfTypeParameter<T>(T value) => new[] { value };

    // Span and Memory over arrays — the BCL types that dominate modern
    // BCL code and are `ref struct`s.
    public Span<byte> AsSpan(byte[] data) => data.AsSpan();

    public ReadOnlySpan<char> AsChars(string text) => text.AsSpan();

    public Memory<int> AsMemory(int[] data) => data.AsMemory();

    public void ArrayCreationForms()
    {
        int[] sized = new int[3];
        int[] initialised = new int[] { 1, 2, 3 };
        int[] inferred = new[] { 1, 2, 3 };
        int[][] jagged = new int[2][];
        jagged[0] = new int[] { 1 };
        int[][] jaggedInitialised = new int[][] { new int[] { 1 }, new int[] { 2, 3 } };
        int[,] rectangular = new int[2, 3];
        int[,] rectangularInitialised = new int[,] { { 1, 2 }, { 3, 4 } };
        int[,] rectangularInferred = { { 1, 2 }, { 3, 4 } };
        int[,,] threeRank = new int[2, 2, 2];
        Array asArray = initialised;

        _ = sized.Length + initialised.Length + inferred.Length + jagged.Length
            + jaggedInitialised.Length + rectangular.GetLength(0)
            + rectangularInitialised.Length + rectangularInferred.Length
            + threeRank.Rank + asArray.Length;
    }
}

public class TupleTypeReferences
{
    // NO ANALOGUE — value tuples. A tuple TYPE is structural, its element names
    // are metadata only, and it is a struct.
    public (int, string) Unnamed;
    public (int Id, string Name) Named;
    public (int Id, string Name, decimal Total) ThreeNamed;
    public (int, string Name) PartiallyNamed;
    public (int Id, (string First, string Last) Name) Nested;
    public ((int A, int B) Left, (int C, int D) Right) NestedBoth;
    public (int Id, string Name)[] ArrayOfTuples;
    public List<(int Id, string Name)> GenericOfTuples;
    public Dictionary<string, (int Id, decimal Total)> TupleAsValue;
    public (int Id, string Name)? NullableTuple;
    public (int Id, List<string> Tags) TupleWithGeneric;

    // Eight or more elements: the compiler nests a TRest, and the syntax hides
    // it entirely.
    public (int A, int B, int C, int D, int E, int F, int G, int H, int I) NineElements;

    // The legacy reference tuple, which is a different type with the same name.
    public Tuple<int, string> LegacyTuple;

    public (int Id, string Name) ReturnsTuple() => (1, "one");

    public void AcceptsTuple((int Id, string Name) value)
    {
    }

    public void TupleExpressions()
    {
        var literal = (1, "one");
        var namedLiteral = (Id: 1, Name: "one");
        (int id, string name) = ReturnsTuple();
        var (id2, name2) = ReturnsTuple();
        var projected = (namedLiteral.Id, namedLiteral.Name.Length);
        bool equal = literal == (1, "one");
        var inferredNames = (id, name);
        _ = literal.Item1 + namedLiteral.Id + id + name.Length + id2 + name2.Length
            + projected.Item2 + (equal ? 1 : 0) + inferredNames.id;
    }
}

public class NestedGenericReferences
{
    public List<List<int>> TwoDeep;
    public List<List<List<int>>> ThreeDeep;
    public Dictionary<string, List<Dictionary<int, string>>> Mixed;
    public Dictionary<Dictionary<string, int>, List<int[]>> GenericKey;
    public Func<List<int>, Dictionary<string, int>> DelegateOfGenerics;
    public IEnumerable<KeyValuePair<string, IReadOnlyList<int>>> Interfaces;
    public Lazy<Func<Task<List<int>>>> Deep;
    public Nullable<int> ExplicitNullable;
    public int? ShorthandNullable;
    public Box<Box<Box<Box<int>>>> FourDeep;
}

public class Box<T>
{
    public T Value;
}

public class Task<T>
{
    public T Result;
}
