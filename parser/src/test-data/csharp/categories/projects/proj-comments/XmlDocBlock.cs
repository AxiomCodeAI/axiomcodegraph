// `/** … */` — THE DELIMITED XML DOCUMENTATION COMMENT.
//
// Closing a coverage hole found by running cs-impl's enum audit against this
// corpus: `CsCommentKind.XML_DOC_BLOCK` was declared and unreached, because
// CommentForms.cs used `///` throughout and nothing used `/** */`.
//
// It is a SEPARATE LEXICAL FORM with the same semantics: the compiler parses the
// content as XML, resolves `cref`s and emits the same documentation file. C#
// inherited the spelling from Java, where `/** */` is the ONLY javadoc form —
// so a Java-shaped codebase ported to C# is full of these, and the corpus
// stratum that would contain them (old-style C# 5/6) is the one deferred by
// cs-oracle.
//
// The leading `*` on each line is stripped. That is a convention the compiler
// implements, not decoration, and a parser that keeps it produces XML that does
// not parse.
using System;
using System.Collections.Generic;

namespace Fixtures.Comments;

/**
 * <summary>A type documented with the delimited form.</summary>
 * <remarks>
 * The leading asterisks are stripped before the XML is parsed, so this is a
 * well-formed <c>remarks</c> element and not a sequence of text lines.
 * </remarks>
 */
public class DelimitedDocumentation
{
    /** <summary>A field, documented on one line.</summary> */
    private int field;

    /**
     * <summary>A property.</summary>
     * <value>The current value.</value>
     */
    public int Property { get; set; }

    /**
     * <summary>A method with every tag the line form also carries.</summary>
     * <param name="first">The first operand.</param>
     * <param name="second">The second operand.</param>
     * <returns>The sum of <paramref name="first"/> and <paramref name="second"/>.</returns>
     * <exception cref="ArgumentOutOfRangeException">Advisory only.</exception>
     * <seealso cref="Property"/>
     */
    public int Add(int first, int second)
    {
        if (first < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(first));
        }

        return first + second + field;
    }

    /**
     * <summary>A generic method.</summary>
     * <typeparam name="T">The element type.</typeparam>
     * <param name="values">The values.</param>
     * <returns>How many there were.</returns>
     */
    public int Count<T>(IEnumerable<T> values)
    {
        int count = 0;
        foreach (T _ in values)
        {
            count++;
        }

        return count;
    }

    /** <inheritdoc /> */
    public override string ToString() => field.ToString();
}

/**
 * <summary>An interface, an enum, a struct, a record and a delegate, each
 * documented with the delimited form.</summary>
 */
public interface IDelimitedDoc
{
    /** <summary>A member.</summary> */
    int Value { get; }
}

/** <summary>An enum.</summary> */
public enum DelimitedEnum
{
    /** <summary>The first member.</summary> */
    First,

    /** <summary>The second.</summary> */
    Second,
}

/** <summary>A struct.</summary> */
public struct DelimitedStruct
{
    /** <summary>A field.</summary> */
    public int Value;
}

/**
 * <summary>A positional record.</summary>
 * <param name="Id">Documents a SYNTHESISED member.</param>
 * <param name="Name">Likewise.</param>
 */
public record DelimitedRecord(int Id, string Name);

/**
 * <summary>A delegate.</summary>
 * <param name="value">The input.</param>
 * <returns>The output.</returns>
 */
public delegate int DelimitedDelegate(int value);

public class BothFormsInOneType
{
    /// <summary>The line form.</summary>
    public int FromLineForm;

    /** <summary>The delimited form, on the very next member.</summary> */
    public int FromBlockForm;

    /* An ORDINARY block comment. One asterisk, not two, and therefore not
       documentation at all — the distinction the two kinds exist to make. */
    public int AfterOrdinaryBlock;

    /*** Three asterisks: still a documentation comment, because the rule is
     * "slash, TWO OR MORE asterisks". A parser matching exactly `/**` misses it.
     */
    public int AfterThreeAsterisks;

    /**/
    public int AfterEmptyBlockComment;

    /** <summary>A delimited doc comment all on one line.</summary> */
    public int OnOneLine;

    /**
       <summary>A delimited doc comment with NO leading asterisks on its
       continuation lines, which is legal and is what a lot of ported Java
       looks like.</summary>
     */
    public int WithoutLeadingAsterisks;
}
