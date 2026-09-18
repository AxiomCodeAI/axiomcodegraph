// Uses the global usings declared in SecondGlobalFile.cs, again with no
// directive of its own.
namespace Fixtures.GlobalUsings;

public class UsesSecondGlobal
{
    private readonly Regex compiled = new Regex(@"\d+", RegexOptions.Compiled);

    private readonly Matcher aliased = new Matcher(@"\w+");

    public bool Both(string input) => compiled.IsMatch(input) && aliased.IsMatch(input);
}
