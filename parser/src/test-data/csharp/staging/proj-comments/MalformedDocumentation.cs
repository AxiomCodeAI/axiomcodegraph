// DELIBERATELY MALFORMED XML DOCUMENTATION.
//
// With GenerateDocumentationFile on, the compiler parses the XML inside `///`
// and reports when it is wrong. Real codebases are full of these, so a parser
// meets them constantly, and the WARNINGS ARE THE FIXTURE: they are how the
// oracle can tell that the doc comment was read as XML rather than as text.
//
// Expected warnings, listed in ../MANIFEST.md:
//   CS1570  badly formed XML
//   CS1572  a <param> tag for a parameter that does not exist
//   CS1573  a parameter with no <param> tag, when others have one
//   CS1574  a cref that does not resolve
using System;

namespace Fixtures.Comments;

/// <summary>
/// Unclosed element: <c>this c is never closed.
/// </summary>
public class BadlyFormedXml
{
    /// <summary>Mismatched tags: <b>opened as b, closed as i</i></summary>
    public int Mismatched;

    /// <summary>A raw ampersand & and a raw angle bracket < which are not escaped.</summary>
    public int Unescaped;

    /// <summary>Documents a parameter that does not exist.</summary>
    /// <param name="doesNotExist">No such parameter.</param>
    public int WrongParamName(int actual) => actual;

    /// <summary>Documents one parameter and not the other.</summary>
    /// <param name="first">The first.</param>
    public int MissingParamTag(int first, int second) => first + second;

    /// <summary>References a member that does not exist.</summary>
    /// <seealso cref="NoSuchType.NoSuchMember"/>
    /// <remarks>See also <see cref="AlsoMissing"/>.</remarks>
    public int UnresolvableCref => 1;

    /// <summary>A cref that DOES resolve, for contrast: <see cref="Unescaped"/>.</summary>
    public int ResolvableCref => 2;
}
