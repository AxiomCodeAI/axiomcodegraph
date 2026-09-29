using Microsoft.Extensions.DependencyInjection;
namespace App.Widgets;

public interface IRule { bool Check(); }
public class SizeRule : IRule { public bool Check() => true; }
public class Gadget { }

public static class WidgetExtensions
{
    public static IServiceCollection AddWidgetRules(this IServiceCollection s)
    {
        s.AddSingleton<IRule, SizeRule>();
        return s;
    }
    public static Gadget AddGadgets(this Gadget g) => g;
}

public abstract class AppServices : IServiceCollection { }
