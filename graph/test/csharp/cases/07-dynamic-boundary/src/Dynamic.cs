// A CALL THROUGH `dynamic` HAS NO STATIC TARGET, AND THAT IS NOT A BLIND SPOT.
// The DLR picks the member at runtime; no reading of the source settles it. The
// engine's answer is the tier `ambiguous_dynamic`: no target, counted separately
// from `ambiguous_unknown` so a language feature is not reported as an engine
// defect, and NOT reachable as `boundary_lib`, which is the tier a consumer follows
// into a staged dependency.
//
// What it must never be is a NAMED boundary. `external:dynamic.Describe` tells a
// consumer there is a type called `dynamic` with that member; what is true is that
// the site is undecidable. Staged against any library it would try to link
// `external:dynamic.*` to a type nothing declares.
//
// THE CONTROLS ARE IN THIS FILE, and there are three kinds:
//
//   1. The SAME member names on a statically typed receiver, which must resolve to
//      a real method. A rule that gave up on the name rather than on the receiver
//      would lose these.
//   2. A real unstaged framework receiver (`string`), which must STILL be a named
//      boundary. `dynamic` is a predefined alias like `string` is, and the change
//      that stops naming it must not stop naming the others -- that clause is worth
//      1,562 sites on one corpus member.
//   3. A `dynamic` value that is only ASSIGNED, never called through, so the tier
//      cannot be reached by marking every mention of the keyword.
namespace Cases.Dynamic;

public class Helper
{
    public string Describe() => "helper";
    public string Name => "helper";
}

public class Use
{
    private dynamic field = null!;
    public dynamic Prop { get; set; } = null!;

    // The four ways a receiver comes to be written `dynamic`.
    public string ViaParameter(dynamic d) => d.Describe();
    public string ViaLocal(object o) { dynamic d = o; return d.Describe(); }
    public string ViaField() => field.Describe();
    public string ViaProperty() => Prop.Describe();

    // Reading a property through `dynamic` is the same site: `Name` invokes a getter
    // the DLR picks. It must reach the output with no target rather than vanish --
    // a site that produced no row is indistinguishable from one nobody saw.
    public string ReadThroughDynamic(dynamic d) => d.Name;

    // CONTROL 1: the same two member names, statically typed. Both must resolve.
    public string StaticCall(Helper h) => h.Describe();
    public string StaticRead(Helper h) => h.Name;

    // CONTROL 2: a predefined alias that IS a real unstaged type. Still a named
    // boundary, still `boundary_lib`.
    public string Framework(string s) => s.Trim();

    // CONTROL 3: `dynamic` assigned and returned, never called through. No site.
    public dynamic PassThrough(dynamic d) => d;
}
