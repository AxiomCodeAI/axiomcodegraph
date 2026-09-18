// Extension methods, including the two shapes that made the engine wrong.
namespace Cases.Extensions;

public interface IBuilder { }
public sealed class Builder : IBuilder { }

public static class StringExtensions
{
    // `this string` — an EXTERNAL receiver type. In a client-only run `string`
    // resolves to nothing on both sides, so the match is by NAME, and this is the
    // commonest extension receiver in C#.
    public static string Shout(this string input) => input + "!";
    public static string Shout(this string input, int times) => input + times;
}

public static class BuilderExtensions
{
    // A NOMINAL receiver: the `this` type is declared here, so the receiver's type
    // must be it or derive from it.
    public static IBuilder Twice(this IBuilder b) => b;

    // A GENERIC `this` parameter: matches any receiver.
    public static T Identity<T>(this T value) => value;

    // A `this` parameter whose type merely HAS type-parameter arguments. This is NOT
    // a generic receiver, and treating it as one made this method match every
    // receiver in the project -- six wrong edges on a real codebase, because
    // `xs.Where(...)` on a BCL collection chose it over System.Linq's.
    public static System.Collections.Generic.IEnumerable<T> Only<T>(
        this System.Collections.Generic.IEnumerable<T> xs, T _keep) => xs;
}

public sealed class Driver
{
    public string Text(string s) => s.Shout();
    public string TextWithArg(string s) => s.Shout(2);
    public string Literal() => "hi".Shout();
    public IBuilder Nominal(Builder b) => b.Twice();
    public int Generic(int x) => x.Identity();

    // THE CONTROL for `Only`: a receiver that is NOT an IEnumerable must not match
    // it. If the generic-receiver rule is too loose this resolves to Only and the
    // case fails.
    public Builder NotOnly(Builder b) => b.Identity();
}
