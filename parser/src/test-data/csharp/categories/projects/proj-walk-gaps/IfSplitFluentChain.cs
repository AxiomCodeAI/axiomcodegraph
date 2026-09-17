// CS-CORPUS-30: an `#if / #else / #endif` splitting a FLUENT CHAIN —
// `builder.A()  #if X  .B()  #else  .C()  #endif  .D();` — is a local parse error at
// every regime (CS-CORPUS-15's family; the expression-body form is fixed, the
// chain form is not). That much this file reproduces: 4 errors, 194 bytes. What it
// does NOT reproduce is fork11's recovery swallowing the whole chain (three corpus
// files, error bytes 38 -> 569, 92 -> 512, 294 -> 310): here every call is still
// walked. Both methods are therefore kept as controls, labelled so, and the corpus
// sites are handed over by name. Measured at cs-impl@3561721.
using System;
namespace Fixtures.WalkGaps;

public class IfcBuilder
{
    public IfcBuilder UseA() => this; public IfcBuilder UseB() => this; public IfcBuilder UseC() => this; public IfcBuilder Build() => this;
    public IfcBuilder UseApp<TApp>() => this; public IfcBuilder Configure<TOptions>(Action<TOptions> configure) => this;
    public static IfcBuilder Create() => new IfcBuilder();
}
public class IfSplitFluentChain
{
    // NOT REPRODUCED (kept as a control): #if inside the chain with a generic call under it — the corpus form.
    public static IfcBuilder SplitWithGenericCall()
    {
        var builder = IfcBuilder.Create()
            .UseApp<IfcBuilder>()
#if IFC_DEBUG
            .Configure<IfcBuilder>(b => b.UseB())
#else
            .UseC()
#endif
            .Build();
        return builder;
    }
    // #if inside the chain, no generic call — a local error at every regime, but the calls are walked (kept as a control).
    public static IfcBuilder SplitPlain()
    {
        var builder = IfcBuilder.Create()
            .UseA()
#if IFC_DEBUG
            .UseB()
#else
            .UseC()
#endif
            .Build();
        return builder;
    }
    // CONTROL: the same chain with the #if around a whole statement — walked.
    public static IfcBuilder Control()
    {
        var builder = IfcBuilder.Create().UseA();
#if IFC_DEBUG
        builder = builder.UseB();
#else
        builder = builder.UseC();
#endif
        return builder.Build();
    }
}
