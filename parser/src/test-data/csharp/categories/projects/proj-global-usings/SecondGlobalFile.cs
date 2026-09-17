// A SECOND file carrying global usings. The language permits this; convention
// discourages it. It matters here because an extractor that assumes "one
// GlobalUsings.cs per project" finds these and an extractor that assumes
// "global usings are project-level metadata" does not.
global using System.Text.RegularExpressions;
global using Matcher = System.Text.RegularExpressions.Regex;

namespace Fixtures.GlobalUsings;

public class SecondDeclaringFile
{
    public Matcher Pattern { get; } = new Matcher("^a+$");

    public bool Matches(string input) => Pattern.IsMatch(input);
}
