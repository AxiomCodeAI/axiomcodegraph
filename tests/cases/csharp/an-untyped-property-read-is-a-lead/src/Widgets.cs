using Microsoft.Extensions.Options;

namespace App.Widgets;

public sealed class WidgetOptions { public int MaxCount { get; set; } public int MinCount { get; set; } public int Clamp() => 1; }

public sealed class Box<T>(T value) { public T Value { get; } = value; }

public sealed class WidgetService(IOptions<WidgetOptions> options, Box<WidgetOptions> box)
{
    public int Limit() => options.Value.MaxCount;
    public int Clamped() => options.Value.Clamp();
    public int BoxLimit() => box.Value.MaxCount;
    public void Raise() { options.Value.MaxCount = 9; }
    public string Line() => System.Environment.NewLine;
}
