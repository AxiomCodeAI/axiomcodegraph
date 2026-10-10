using System;
using System.Collections.Generic;

namespace Cases.UntypedReceiverMember
{
    public sealed class Limits { public int Floor { get; set; } }

    public sealed class WidgetOptions
    {
        public int MaxCount { get; set; }
        public Limits Limits { get; } = new Limits();
        public int Clamp() => 1;
    }

    public sealed class Box<T>
    {
        public Box(T value) { Value = value; }
        public T Value { get; }
    }

    // The receiver is a SITE whose result has no type: Lazy<T> and List<T> are not staged,
    // so `lazy.Value` and `xs[0]` are labelled external and nothing says what they return.
    public class Use
    {
        public int Read(Lazy<WidgetOptions> lazy) => lazy.Value.MaxCount;
        public void Write(Lazy<WidgetOptions> lazy) { lazy.Value.MaxCount = 3; }
        public void Bump(Lazy<WidgetOptions> lazy) { lazy.Value.MaxCount += 1; }
        public int Chain(Lazy<WidgetOptions> lazy) => lazy.Value.Limits.Floor;
        public int FromIndexer(List<WidgetOptions> xs) => xs[0].MaxCount;
        public int FromCall(List<WidgetOptions> xs) => xs.Find(IsBig)!.MaxCount;
        static bool IsBig(WidgetOptions w) => true;
    }

    // Controls.
    public class Controls
    {
        // an in-source generic: the read resolves, no unresolved row
        public int Boxed(Box<WidgetOptions> box) => box.Value.MaxCount;
        // namespace qualifiers are untyped member accesses and not sites: no get_Text, no get_Environment
        public string Qualified() => System.Environment.NewLine + System.Text.Encoding.UTF8.WebName;
        // a typed external receiver is labelled, not unresolved
        public int Typed(List<WidgetOptions> xs) => xs.Count;
    }
}
