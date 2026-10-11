using Microsoft.Extensions.DependencyInjection;
using App.Widgets;

public static class Program
{
    public static void Concrete(ServiceCollection services) => services.AddWidgetRules();
    public static void Typed(IServiceCollection typed) => typed.AddWidgetRules();
    public static void Derived(AppServices mine) => mine.AddWidgetRules();
    public static void Unrelated(ServiceCollection services) => services.AddGadgets();
}
