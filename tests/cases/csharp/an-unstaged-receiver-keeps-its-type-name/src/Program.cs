using System;
using Microsoft.Extensions.DependencyInjection;
using App.Widgets;

public static class Program
{
    public static void Configure(Action<IServiceCollection> configure) { }
    public static void Tune(Action<Gizmo> tune) { }

    public static void FromNew()
    {
        var services = new ServiceCollection();
        services.AddWidgetRules();
    }

    public static void FromLambda() => Configure(s => s.AddWidgetRules());

    // control: an unstaged receiver never matches an extension whose `this` type is in source
    public static void Control()
    {
        var g = new Gizmo();
        g.AddGadgets();
    }

    // control: a lambda typed as another unstaged type is no by-name match for this IServiceCollection
    public static void OtherLambda() => Tune(z => z.AddWidgetRules());
}
