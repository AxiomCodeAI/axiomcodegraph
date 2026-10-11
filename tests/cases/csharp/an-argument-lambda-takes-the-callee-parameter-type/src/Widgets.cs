using System;

namespace App.Widgets;

public sealed class WidgetOptions { public void Reset() { } }
public sealed class GadgetOptions { public void Reset() { } }

public sealed class Registry
{
    public Registry Setup(Action<WidgetOptions> configure) => this;
    public Registry Both(Action<WidgetOptions> w, Action<GadgetOptions> g) => this;
    public Registry Pick(Action<WidgetOptions> w) => this;
    public Registry Pick(Action<GadgetOptions> g) => this;
}

public static class Wiring
{
    public static void Implicit(Registry r) => r.Setup(o => o.Reset());
    public static void Explicit(Registry r) => r.Setup((WidgetOptions o) => o.Reset());
    public static void Second(Registry r) => r.Both(w => { }, g => g.Reset());
    public static void Overloaded(Registry r) => r.Pick(x => x.Reset());
}
