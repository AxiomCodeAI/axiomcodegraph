// Port of Java's comment and javadoc coverage.
//
// Three lexical forms, and they are not interchangeable:
//   `//`    to end of line
//   `/* */` delimited, and NOT nestable — `/* /* */` ends at the first `*/`,
//           which is the single most common comment bug in C-family languages
//   `///` and `/** */`  documentation comments, whose CONTENT IS XML and is
//           parsed by the compiler when GenerateDocumentationFile is on
//
// The XML doc form is the one that differs from Java: javadoc is HTML with
// `@tags`; C# is well-formed XML with elements, and `cref` attributes inside it
// are RESOLVED BY THE COMPILER — `<see cref="Foo.Bar"/>` is a real symbol
// reference that produces CS1574 when it does not bind. A doc comment is
// therefore not inert text: it can contain a reference the engine may want.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Fixtures.Comments;

// A comment before a type declaration.
/// <summary>
/// A documented type. The <c>summary</c> element is the one every tool reads.
/// </summary>
/// <remarks>
/// <para>Multi-paragraph remarks, with block elements.</para>
/// <para>
/// A list:
/// <list type="bullet">
///   <item><description>first</description></item>
///   <item><description>second</description></item>
/// </list>
/// </para>
/// <para>A code block:
/// <code>
/// var x = new DocumentedType();
/// x.Method(1);
/// </code>
/// </para>
/// </remarks>
/// <seealso cref="UndocumentedType"/>
/// <example>
/// <code>new DocumentedType().Method(1);</code>
/// </example>
public class DocumentedType
{
    /// <summary>A documented field.</summary>
    private int field;

    /// <summary>A documented constant, whose value is <c>3</c>.</summary>
    public const int Constant = 3;

    /// <summary>A documented property.</summary>
    /// <value>The current value.</value>
    public int Property { get; set; }

    /// <summary>A documented event.</summary>
    public event EventHandler Raised;

    /// <summary>A documented indexer.</summary>
    /// <param name="index">The position to read.</param>
    /// <returns>The value at <paramref name="index"/>.</returns>
    public int this[int index] => index;

    /// <summary>A documented constructor.</summary>
    /// <param name="seed">The initial value.</param>
    public DocumentedType(int seed) => field = seed;

    /// <summary>A documented method with every standard tag.</summary>
    /// <param name="first">The first operand.</param>
    /// <param name="second">The second operand.</param>
    /// <returns>The sum of <paramref name="first"/> and <paramref name="second"/>.</returns>
    /// <exception cref="ArgumentOutOfRangeException">
    /// Thrown when <paramref name="first"/> is negative. Advisory only: C# has
    /// no checked exceptions, so nothing verifies this and no caller is obliged
    /// to handle it.
    /// </exception>
    /// <remarks>See <see cref="Property"/> and <see cref="DocumentedType(int)"/>.</remarks>
    public int Method(int first, int second)
    {
        // A comment inside a body.
        if (first < 0)
        {
            /* a delimited comment inside a block */
            throw new ArgumentOutOfRangeException(nameof(first));
        }

        return first + second; // a trailing comment
    }

    /// <summary>A documented generic method.</summary>
    /// <typeparam name="T">The element type.</typeparam>
    /// <param name="values">The values to count.</param>
    /// <returns>The number of values.</returns>
    public int Count<T>(IEnumerable<T> values)
    {
        int count = 0;
        foreach (T _ in values)
        {
            count++;
        }

        return count;
    }

    /// <summary>Inherits documentation from the base member.</summary>
    /// <inheritdoc cref="Method(int, int)"/>
    public int Forwards(int a, int b) => Method(a, b);

    /// <inheritdoc />
    public override string ToString() => field.ToString();
}

/// <summary>A documented generic type.</summary>
/// <typeparam name="TKey">The key type.</typeparam>
/// <typeparam name="TValue">The value type.</typeparam>
public class DocumentedGeneric<TKey, TValue>
{
    /// <summary>A member mentioning <see cref="DocumentedGeneric{TKey, TValue}"/>.</summary>
    public int Count => 0;
}

/// <summary>A documented interface, enum, struct, record and delegate.</summary>
public interface IDocumented
{
    /// <summary>A documented interface member.</summary>
    int Value { get; }
}

/// <summary>A documented enum.</summary>
public enum DocumentedEnum
{
    /// <summary>The first member.</summary>
    First,

    /// <summary>The second member.</summary>
    Second,
}

/// <summary>A documented struct.</summary>
public struct DocumentedStruct
{
    /// <summary>A documented field.</summary>
    public int Value;
}

/// <summary>A documented positional record.</summary>
/// <param name="Id">The identifier. This tag documents a member that is
/// SYNTHESISED — there is no property declaration for the compiler to attach
/// it to, and it lands on the generated one.</param>
/// <param name="Name">The name.</param>
public record DocumentedRecord(int Id, string Name);

/// <summary>A documented delegate.</summary>
/// <param name="value">The input.</param>
/// <returns>The output.</returns>
public delegate int DocumentedDelegate(int value);

// A type with NO documentation at all, beside the documented ones. An
// extractor that cannot tell these apart has nothing to report.
public class UndocumentedType
{
    private int field;

    public int Method(int value) => value + field;
}

public class CommentPlacement
{
    // Before a member.
    public int First;

    public int Second; // After a member, on the same line.

    /* Delimited, before a member. */
    public int Third;

    public /* delimited, INSIDE a declaration, between modifier and type */ int Fourth;

    public int /* between type and name */ Fifth;

    public int Sixth /* between name and semicolon */;

    /// <summary>A doc comment immediately followed by an ordinary one.</summary>
    // An ordinary comment between a doc comment and its member. This DETACHES
    // the doc comment in some tools and not in others, and the compiler still
    // attaches it.
    public int Seventh;

    // Two ordinary comments
    // in a row, forming a block by convention and not by syntax.
    public int Eighth;

    //No space after the slashes.
    //// Four slashes: an ORDINARY comment, not a doc comment.
    ///// Five slashes: a doc comment whose first content character is '/'.
    public int Ninth;

    public int Awkward(
        // A comment inside a parameter list, before a parameter.
        int first,
        /* delimited, between parameters */
        int second,
        int third // after the last parameter
        )
    {
        int result = first
            // A comment INSIDE a binary expression, between operands.
            + second
            /* and a delimited one */
            + third;

        int[] values =
        {
            1, // inside a collection initialiser
            2, /* delimited */
            3,
        };

        var chained = new List<int>()
            // between calls in a chain
            .Concat(values)
            /* likewise */
            .ToString();

        int ternary = result > 0
            ? 1 // in the true arm
            : 2; // in the false arm

        return result + values.Length + chained.Length + ternary;
    }

    public string InStringsAndInterpolations()
    {
        // These are NOT comments: they are string content, and an extractor
        // that scans for `//` without a lexer finds four comments here that do
        // not exist.
        string looksLikeLineComment = "// not a comment";
        string looksLikeBlockComment = "/* not a comment */";
        string verbatim = @"C:\path // still not a comment";
        string interpolated = $"{1 + 1} // not a comment either";
        string raw = """
            // not a comment
            /* nor this */
            """;

        // A real comment containing a string literal: "quoted", and a URL
        // https://example.invalid/path — the `//` inside it is not a nested
        // comment because comments do not nest.
        return looksLikeLineComment + looksLikeBlockComment + verbatim + interpolated + raw;
    }

    /*
     * A conventional banner comment.
     * Delimited comments DO NOT NEST: a `/*` inside one is ordinary text and
     * the comment still ends at the first `*` followed by `/`.
     */
    public int AfterBanner => 1;

    // A comment before a preprocessor directive, and one after it.
#if DEBUG
    // Inside a live conditional region.
    public int InLiveRegion => 1;
#else
    // Inside a DEAD conditional region. The compiler never sees this code, but
    // a both-branches parser does, and a comment here belongs to a region the
    // module row says is inactive.
    public int InDeadRegion => 2;
#endif

    #region A named region
    // Inside a #region, which is not a comment and not conditional.
    public int InRegion => 3;
    #endregion

    // The very last comment in the type.
}

// A file-level trailing comment, after every declaration.
