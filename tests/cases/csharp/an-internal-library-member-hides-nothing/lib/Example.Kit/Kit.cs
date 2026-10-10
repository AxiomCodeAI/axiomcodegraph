using System.Collections.Generic;
namespace Example.Kit;
public abstract class WidgetBase
{
    internal List<int> Limits { get; } = new();
    protected Counter Quotas { get; } = new();
}
public class Counter { public bool Allow(int n) => n > 2; }
