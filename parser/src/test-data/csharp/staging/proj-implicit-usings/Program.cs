// ZERO using directives. Every type and every extension method below is
// resolved by an implicit using that appears in no file in this repository.
//
// Delete <ImplicitUsings>enable</ImplicitUsings> from the .csproj and this file
// stops compiling without changing one byte. Same bytes, different facts —
// which is why the manifest declares the governing configuration for every
// fixture.
namespace Fixtures.ImplicitUsings;

public class Program
{
    // System.Collections.Generic
    private readonly List<int> items = new();

    private readonly Dictionary<string, int> counts = new();

    // System
    public DateTime Timestamp { get; set; } = DateTime.UnixEpoch;

    public Guid Id { get; } = Guid.NewGuid();

    public Action<int>? Callback { get; set; }

    // System.Threading.Tasks
    public async Task<int> CountAsync(CancellationToken cancellationToken)
    {
        await Task.Delay(1, cancellationToken).ConfigureAwait(false);
        return items.Count;
    }

    // System.Linq — every one of these is an EXTENSION METHOD whose enabling
    // directive is SDK-injected.
    public IReadOnlyList<int> Filtered() =>
        items.Where(x => x > 0).OrderBy(x => x).Select(x => x * 2).ToList();

    public int Total() => items.Sum();

    // System.IO
    public string Read(string path)
    {
        using var reader = new StreamReader(path);
        return reader.ReadToEnd();
    }

    public bool Exists(string path) => File.Exists(Path.Combine(path, "x"));

    // System.Net.Http
    public HttpClient CreateClient() => new HttpClient();

    // System.Threading
    private readonly SemaphoreSlim gate = new(1);

    public void Enter() => gate.Wait();

    public void Record(string key)
    {
        counts[key] = counts.TryGetValue(key, out int found) ? found + 1 : 1;
        Console.WriteLine($"{key}={counts[key]} at {Timestamp:O} ({Id})");
        Callback?.Invoke(counts[key]);
    }
}
