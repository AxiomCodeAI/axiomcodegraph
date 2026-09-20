// An EXPLICIT interface implementation is reachable only through an
// interface-typed receiver, and is not a member of its declaring type. Both
// halves matter and they pull in opposite directions:
//
//   through IWorker   the site is POLYMORPHIC and must see every body, the
//                     explicit ones included
//   through Implicit  the explicit body is not a member and must NOT be seen
//
// It also needs the two sides to AGREE ON A KEY: the compiler spells such a
// member `Probe.Explicit.Probe.IWorker.Work/1` and the IR records the member's
// own name with the interface in a separate column, so a naive key scores every
// explicit implementation as a target the engine lost.
namespace Probe;

public interface IWorker { string Work(int n); }

public interface IOther { string Work(int n); }

public class Explicit : IWorker
{
    string IWorker.Work(int n) => "explicit";
}

public class Implicit : IWorker
{
    public string Work(int n) => "implicit";
}

// Two interfaces declaring the same member is the commonest reason to write an
// explicit implementation, and it is why the interface belongs in the key: drop
// it and these two methods become one.
public class Both : IWorker, IOther
{
    string IWorker.Work(int n) => "both:worker";
    string IOther.Work(int n) => "both:other";
}

public static class Driver
{
    public static string ThroughInterface(IWorker w) => w.Work(1);

    public static string ThroughOther(IOther o) => o.Work(2);

    // CONTROL: the class-typed receiver sees only the ordinary implementation.
    public static string ThroughClass(Implicit i) => i.Work(3);

    // CONTROL: a cast is how an explicit implementation is actually called.
    public static string ThroughCast(Explicit e) => ((IWorker)e).Work(4);
}
