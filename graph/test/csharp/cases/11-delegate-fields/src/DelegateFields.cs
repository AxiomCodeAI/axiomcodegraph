// A call through a FIELD (or property) that holds a delegate (#1206).
//
// `getPath(url)` on a `Func<string, string>` field is a call to the delegate's
// Invoke, and Roslyn says exactly that: the target is System.Func`2.Invoke, a
// method outside the source. Which user method RUNS is whatever was stored in the
// field -- a value-flow fact, not a member lookup -- so the per-site answer stays
// what the compiler says and the stored methods go to the dispatch envelope instead
// (dispatch-candidates.csv, basis `value`). tools/delegate-field-value-test.sh
// asserts the envelope rows over this file; here it is scored against the oracle
// like every other case, which is what pins that no call SITE changed its resolved
// target.
//
// THREE SHAPES THE ENVELOPE HANDLES ARE NOT IN THIS FILE, because the score cannot
// read them and would fail the case for a reason that is not this change: a field of
// a DECLARED delegate type (Roslyn's target is the in-source `PathFn.Invoke`, which
// has no cs_method row, before and after), a call through a PROPERTY (Roslyn names
// the site `Invoke` and the engine `Handler`, so the join misses it), and
// `new App().Fetch(x)` (the construction and the call start at one column). The
// tools test carries all three in a second file.
//
// THE SHAPES a function reaches a field by: the initializer, an assignment in the
// constructor (bare and `this.`), an assignment anywhere else, `??=` and `+=`, and
// the branches of `?:`, `??` and parentheses on the right-hand side. And the forms a
// call goes through the field by: bare `f(x)`, `this.f(x)`, `obj.f(x)`,
// `f.Invoke(x)` and `f?.Invoke(x)`.
//
// THE CONTROLS: a second field of the SAME delegate type holds a different method
// and is invoked by its own caller, so an envelope keyed on the delegate TYPE
// rather than on the field would put `Other` behind `getPath` and fail; a method
// group passed as an ARGUMENT is not stored in any field; a local of delegate type
// is not a field; and a method that is only CALLED on the right-hand side
// (`Make()`) is not a method group -- its return value is what is stored.
using System;

namespace Cases.DelegateFields;

public class App
{
    static string GetPath(string url) => url.Split('?')[0];
    static string GetPathLoose(string url) => url;
    static string Other(string url) => url + "!";
    static string Initial(string url) => url.Trim();
    static string Appended(string url) => url.ToUpper();
    static string Late(string url) => url.ToLower();
    static string Fallback(string url) => url;
    static Func<string, string> Make() => s => s;

    private readonly Func<string, string> getPath;
    public readonly Func<string, string> Fetch;
    private Func<string, string> other = Other;                    // an initializer
    private Func<string, string>? named = Initial;
    private Func<string, string>? late;
    private Func<string, string> made = Make();                    // CONTROL: a call, not a group

    public App(Func<string, string>? custom = null, bool strict = true)
    {
        getPath = strict ? (custom ?? GetPath) : GetPathLoose;
        this.Fetch = url => Dispatch(url);
        named += Appended;
    }

    public void Configure()
    {
        late ??= Late;
        this.late = (Fallback);
    }

    string Dispatch(string url) => getPath(url);
    public string ViaThis(string url) => this.getPath(url);
    public string ViaInvoke(string url) => getPath.Invoke(url);
    public string ViaConditional(string url) => late?.Invoke(url) ?? url;
    public string ViaNamed(string url) => named!(url);

    // CONTROL: the same delegate type, a different field, a different method.
    public string UsesOther(string url) => other(url);
    public string UsesMade(string url) => made(url);

    // CONTROL: a local of delegate type, and a method group passed as an argument.
    public string ViaLocal(string url) { Func<string, string> f = GetPath; return f(url); }
    public string Passed(string url) => Apply(GetPath, url);
    static string Apply(Func<string, string> f, string url) => f(url);

    public static string Main2() { var app = new App(); return app.Fetch("/a?b"); }
    public static string Handle(App app, string url) => app.Fetch(url);
}
