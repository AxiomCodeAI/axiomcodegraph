using System;

namespace Cases.ArgumentLambdaParameters
{
    public sealed class WidgetOptions { public void Reset() { } public int Size() => 1; }
    public sealed class GadgetOptions { public void Reset() { } public int Size() => 2; }

    public delegate void Configure<T>(T target);

    public sealed class Registry
    {
        public Registry Setup(Action<WidgetOptions> configure) => this;
        public Registry Both(Action<WidgetOptions> w, Action<GadgetOptions> g) => this;
        public Registry Measure(Func<GadgetOptions, int> f) => this;
        public Registry Declared(Configure<WidgetOptions> c) => this;
        public static Registry Static(int n, Action<GadgetOptions> g) => new Registry();
    }

    public static class RegistryExtensions
    {
        public static Registry Also(this Registry r, Action<GadgetOptions> g) => r;
    }

    // Each lambda below has a parameter with no written type, passed to a method with
    // one candidate: the parameter takes the delegate type at that argument's position.
    public class Wiring
    {
        public void Implicit(Registry r) => r.Setup(o => o.Reset());
        public void Block(Registry r) => r.Setup(o => { o.Reset(); });
        public void SecondArgument(Registry r) => r.Both(w => w.Size(), g => g.Reset());
        public void FuncArgument(Registry r) => r.Measure(g => g.Size());
        public void DeclaredDelegate(Registry r) => r.Declared(o => o.Reset());
        public void StaticCall() => Registry.Static(1, g => g.Reset());
        public void Extension(Registry r) => r.Also(g => g.Reset());
    }

    // Controls.
    public class Controls
    {
        // written type: already resolved before this rule
        public void Explicit(Registry r) => r.Setup((WidgetOptions o) => o.Reset());
        // a lambda stored in a typed local: typed by the local, as before
        public void Stored() { Action<GadgetOptions> a = g => g.Reset(); a(new GadgetOptions()); }
    }
}
