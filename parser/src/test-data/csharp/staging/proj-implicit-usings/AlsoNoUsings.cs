// A second file with no directives either, so the effect is demonstrably
// project-wide rather than a property of one file.
namespace Fixtures.ImplicitUsings;

public sealed record Row(int Id, string Name);

public static class Rows
{
    public static IEnumerable<Row> Sample() =>
        Enumerable.Range(1, 3).Select(i => new Row(i, $"row-{i}"));

    public static Dictionary<int, string> ById() =>
        Sample().ToDictionary(r => r.Id, r => r.Name);

    public static async Task<int> CountAsync() =>
        await Task.FromResult(Sample().Count()).ConfigureAwait(false);
}
