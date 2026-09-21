// ============================================================================
// THE C# STATIC ORACLE
//
// Emits a ground-truth call graph using Roslyn's semantic model: for every call
// site the compiler can see, the symbol it binds to. This is the thing the engine
// is measured against, so three properties matter more than features.
//
// 1. IT MUST SEE THE SAME PROGRAM THE ENGINE SEES.
//    The engine runs client-only: it reads the project's own source and no
//    dependency IR. So the oracle compiles the project's own .cs files against the
//    REFERENCE ASSEMBLIES ONLY. That makes the comparison apples-to-apples. An
//    oracle with the full NuGet closure would resolve calls into dependencies that
//    the engine was never given and report them as engine misses, which measures
//    the harness rather than the engine.
//
//    Consequently every call site is labelled by WHERE ITS TARGET LIVES:
//      in_source  the target is declared in the project's own files. THIS is what
//                 recall and precision are computed over.
//      external   the target is in a referenced assembly. The engine is expected to
//                 label it, not resolve it, and the harness checks exactly that.
//
// 2. A SITE THE ORACLE COULD NOT READ MUST BE VISIBLE, NOT ABSENT.
//    A file with a compile error, a construct past the pinned language version, an
//    invocation whose symbol Roslyn cannot bind -- each is reported with a reason.
//    A silently dropped oracle row becomes a phantom engine miss or a phantom
//    engine win, depending on which way the join goes, and neither is detectable
//    afterwards.
//
// 3. THE KEY MUST JOIN. A site is identified by (relative path, line, column), all
//    1-based, because that is what the engine's IR carries and what a runtime trace
//    can also produce. Roslyn is 0-based internally and is converted once, here.
//
// WHAT COUNTS AS A CALL. The set matches the engine's invocation_site universe:
// invocations, object creations, constructor delegation, implicit and explicit
// conversions that run user code, user-defined operators, indexer accesses,
// property and event accessor invocations, and a primary constructor's base
// invocation. Roslyn resolves all of them; several have no call syntax at all,
// which is precisely why a syntax-only reading loses them.
//
// Usage:
//   axiom-cs-oracle --src <dir> --out <file.tsv> [--refs <dir>] [--lang-version 13]
//                   [--exclude-tests] [--define A;B]
// ============================================================================

using System.Collections.Immutable;
using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace AxiomCsOracle;

internal static class Program
{
    private const string SchemaVersion = "cs-oracle/1";

    public static int Main(string[] args)
    {
        string? src = null, outPath = null, refsDir = null, defines = null, dispatchPath = null;
        var langVersion = LanguageVersion.CSharp13;
        var excludeTests = false;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--src": src = args[++i]; break;
                case "--out": outPath = args[++i]; break;
                case "--refs": refsDir = args[++i]; break;
                case "--out-dispatch": dispatchPath = args[++i]; break;
                case "--define": defines = args[++i]; break;
                case "--exclude-tests": excludeTests = true; break;
                case "--lang-version":
                    if (!LanguageVersionFacts.TryParse(args[++i], out langVersion))
                        return Fail($"unrecognised --lang-version {args[i]}");
                    break;
                default: return Fail($"unknown argument {args[i]}");
            }
        }
        if (src is null || outPath is null) return Fail("usage: --src <dir> --out <file.tsv> [--out-dispatch <file.tsv>] [--refs <dir>]");
        if (!Directory.Exists(src)) return Fail($"not a directory: {src}");

        var root = Path.GetFullPath(src);
        var files = EnumerateSources(root, excludeTests).ToList();
        if (files.Count == 0) return Fail($"no .cs files under {root}");

        var parseOptions = new CSharpParseOptions(
            languageVersion: langVersion,
            preprocessorSymbols: (defines ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries));

        var trees = new List<SyntaxTree>(files.Count);
        var unreadable = new List<(string Path, string Reason)>();
        foreach (var f in files)
        {
            string text;
            try { text = File.ReadAllText(f); }
            catch (Exception ex) { unreadable.Add((Rel(root, f), $"READ_FAILED:{ex.GetType().Name}")); continue; }
            trees.Add(CSharpSyntaxTree.ParseText(text, parseOptions, path: f, encoding: Encoding.UTF8));
        }

        var references = ResolveReferences(refsDir);
        if (references.IsEmpty)
            Console.Error.WriteLine("!! no reference assemblies resolved; every framework symbol will be unbound");

        // ONE COMPILATION FOR THE WHOLE TREE. That is what makes a `partial` type
        // declared across files resolve as one type, and it is the same reading the
        // engine takes (the engine's declarationGroupKey merges parts too). It does
        // mean that a repository holding several independent projects is compiled as
        // one assembly, which merges their `internal` members and their top-level
        // Program classes. The manifest records that; it is a property of compiling a
        // repository rather than a solution, and it is symmetric between the two
        // sides, so it does not bias the comparison.
        var compilation = CSharpCompilation.Create(
            assemblyName: "AxiomOracleSubject",
            syntaxTrees: trees,
            references: references,
            options: new CSharpCompilationOptions(
                OutputKind.DynamicallyLinkedLibrary,
                allowUnsafe: true,
                // Warnings are irrelevant to symbol binding and a project's own
                // <TreatWarningsAsErrors> would otherwise suppress diagnostics we want
                // to count rather than react to.
                generalDiagnosticOption: ReportDiagnostic.Suppress));

        // The set of symbols DECLARED IN SOURCE. This is what splits in_source from
        // external, and it is computed from the declarations rather than from the
        // symbol's containing assembly, because a source symbol and a referenced one
        // can share an assembly identity when the subject is compiled as one unit.
        var inSource = new HashSet<string>(StringComparer.Ordinal);
        foreach (var tree in trees)
        {
            var model = compilation.GetSemanticModel(tree);
            foreach (var node in tree.GetRoot().DescendantNodes())
            {
                if (node is not MemberDeclarationSyntax and not LocalFunctionStatementSyntax
                    and not AccessorDeclarationSyntax) continue;
                var sym = model.GetDeclaredSymbol(node);
                if (sym is IMethodSymbol m) inSource.Add(Key(m));
                else if (sym is IPropertySymbol p)
                {
                    if (p.GetMethod is not null) inSource.Add(Key(p.GetMethod));
                    if (p.SetMethod is not null) inSource.Add(Key(p.SetMethod));
                }
                else if (sym is IEventSymbol e)
                {
                    if (e.AddMethod is not null) inSource.Add(Key(e.AddMethod));
                    if (e.RemoveMethod is not null) inSource.Add(Key(e.RemoveMethod));
                }
                else if (sym is INamedTypeSymbol t)
                {
                    // A record's and a primary constructor's members are synthesised and
                    // have no declaration node of their own, so they are collected from
                    // the type. Without this, `new Point(1, 2)` on a positional record
                    // reads as an EXTERNAL target and the engine is marked wrong for
                    // resolving it correctly.
                    foreach (var cm in t.GetMembers().OfType<IMethodSymbol>()) inSource.Add(Key(cm));
                }
            }
        }

        var rows = new List<string>();
        var unbound = new List<string>();
        long siteCount = 0;

        foreach (var tree in trees)
        {
            var model = compilation.GetSemanticModel(tree);
            var rel = Rel(root, tree.FilePath);
            foreach (var node in tree.GetRoot().DescendantNodes())
            {
                foreach (var site in Sites(node, model))
                {
                    siteCount++;
                    var pos = tree.GetLineSpan(site.Anchor.Span).StartLinePosition;
                    var line = pos.Line + 1;      // 1-based, to match the engine's IR
                    var col = pos.Character + 1;
                    var caller = EnclosingMethod(site.Anchor, model);

                    if (site.Target is null)
                    {
                        unbound.Add(Tsv(rel, line.ToString(), col.ToString(), site.Kind, site.UnboundReason ?? "NO_SYMBOL",
                            caller is null ? "" : Key(caller)));
                        continue;
                    }

                    // The DECLARATION a call binds to, before dispatch. The engine's
                    // candidate is compared against this, and its resolved SET against
                    // the dispatch expansion below.
                    //
                    // UNREDUCED. For `xs.Where(p)` Roslyn hands back the REDUCED
                    // extension symbol, whose Parameters.Length EXCLUDES the `this`
                    // receiver -- so `Where` reports 1 parameter where the declaration
                    // has 2. The engine counts the declaration's parameters, including
                    // `this`, because that is what cs_method_parameter contains. Keying
                    // on the reduced form made every extension call an arity mismatch,
                    // which on a codebase of extension methods is most of the corpus.
                    var declared = (site.Target.ReducedFrom ?? site.Target).OriginalDefinition;
                    var key = Key(declared);
                    var where = inSource.Contains(key) ? "in_source" : "external";

                    rows.Add(Tsv(
                        rel, line.ToString(), col.ToString(), site.Kind, where,
                        key,
                        declared.ContainingType?.ToDisplayString() ?? "",
                        declared.Name,
                        declared.Parameters.Length.ToString(),
                        SiteDispatch(site, declared),
                        declared.IsStatic ? "static" : "instance",
                        site.Target.ReducedFrom is not null ? "extension_reduced" : "",
                        caller is null ? "" : Key(caller)));
                }
            }
        }

        // The compiler's own view of whether it could read the program. A subject with
        // errors is still usable -- Roslyn binds what it can -- but the count has to be
        // reported, because a file that did not bind produces no oracle rows and would
        // otherwise read as an engine that found calls the oracle did not.
        var errors = compilation.GetDiagnostics()
            .Where(d => d.Severity == DiagnosticSeverity.Error)
            .ToList();
        var errorFiles = errors
            .Select(d => d.Location.SourceTree?.FilePath)
            .Where(p => p is not null)
            .Select(p => Rel(root, p!))
            .Distinct(StringComparer.Ordinal)
            .ToList();

        // A FILE THE ORACLE COULD NOT PARSE IS NOT EVIDENCE ABOUT THE ENGINE, AND IT
        // IS NOT THE SAME POPULATION AS A FILE THAT MERELY DID NOT BIND. A subject
        // compiled against reference assemblies only has thousands of unresolved-type
        // errors by design, and the rows it still produces are sound -- that is what
        // the external bucket is for. Recovery from a SYNTAX error is different in
        // kind: the parser invents structure to keep going, and the declarations it
        // invents are not in the source. A member-declaration form past the pinned
        // LanguageVersion closes its containing class early and the remainder of the
        // file is re-read as top-level statements, whose synthesised container is
        // `Program` -- a type the subject does not declare. Every site under it names
        // a declaration that does not exist, and scoring those charges the engine
        // with disagreeing when the engine's answer is the correct one.
        //
        // tree.GetDiagnostics() is exactly the parse half, so the split is Roslyn's
        // own rather than a guess from error-code prefixes.
        //
        // NOT capped, unlike errorFile below: the scorer consumes these rows to
        // decide what to skip, and a truncated list would silently score the tail.
        var recoveredFiles = trees
            .Where(t => t.GetDiagnostics().Any(d => d.Severity == DiagnosticSeverity.Error))
            .Select(t => Rel(root, t.FilePath))
            .Distinct(StringComparer.Ordinal)
            .ToList();

        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outPath))!);
        using (var w = new StreamWriter(outPath, false, new UTF8Encoding(false)))
        {
            w.WriteLine(string.Join('\t',
                "filePath", "line", "column", "siteKind", "targetWhere", "targetKey",
                "targetContainingType", "targetName", "targetParamCount",
                "targetDispatch", "targetStatic", "targetExtension", "callerKey"));
            foreach (var r in rows) w.WriteLine(r);
        }

        var unboundPath = Path.ChangeExtension(outPath, ".unbound.tsv");
        using (var w = new StreamWriter(unboundPath, false, new UTF8Encoding(false)))
        {
            w.WriteLine(string.Join('\t', "filePath", "line", "column", "siteKind", "reason", "callerKey"));
            foreach (var r in unbound) w.WriteLine(r);
        }

        // ── THE DISPATCH GROUND TRUTH ───────────────────────────────────────
        // For each CONCRETE type declared in source and each virtual member reachable
        // on it, the body that actually runs. This is the ground truth for the fan,
        // which is the part of a call graph that is hardest to get right and easiest
        // to be quietly wrong about: a fan that is too narrow claims monomorphism it
        // cannot support, and one that is too wide buries the real target.
        //
        // Asked the same way the engine asks it -- per possible runtime type -- so the
        // two are comparable. Roslyn answers it exactly:
        //   an interface member   FindImplementationForInterfaceMember
        //   a virtual member      the most derived override at or below the type
        var dispatchRows = new List<string>();
        if (dispatchPath is not null)
        {
            var concreteTypes = new List<INamedTypeSymbol>();
            foreach (var tree in trees)
            {
                var model = compilation.GetSemanticModel(tree);
                foreach (var node in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
                {
                    if (model.GetDeclaredSymbol(node) is not INamedTypeSymbol t) continue;
                    if (t.IsAbstract || t.IsStatic || t.TypeKind == TypeKind.Interface) continue;
                    if (t.TypeKind is not (TypeKind.Class or TypeKind.Struct)) continue;
                    concreteTypes.Add(t);
                }
            }
            // A partial type yields one declaration node per part, so the same symbol
            // arrives several times. Deduplicated on the symbol, not on the node.
            foreach (var t in concreteTypes.Distinct(SymbolEqualityComparer.Default).OfType<INamedTypeSymbol>())
            {
                // interface members, through every interface the type presents
                foreach (var iface in t.AllInterfaces)
                foreach (var im in iface.GetMembers().OfType<IMethodSymbol>())
                {
                    var impl = t.FindImplementationForInterfaceMember(im) as IMethodSymbol;
                    if (impl is null) continue;
                    // FindImplementationForInterfaceMember returns the member that
                    // IMPLEMENTS the interface, which is not always the body that runs.
                    // `abstract class Shape : IShape { public abstract double Area(); }`
                    // makes Shape.Area the implementation for every subclass, so the
                    // answer for a Circle receiver came back as Shape.Area -- an
                    // ABSTRACT method, which has no body at all. Dispatch has to be
                    // applied on top, and then the answer is Circle.Area.
                    if (impl.IsAbstract || impl.IsVirtual || impl.IsOverride)
                        impl = MostDerived(t, impl) ?? impl;
                    if (impl.IsAbstract) continue;   // nothing to run
                    dispatchRows.Add(Tsv(Key(im), t.ToDisplayString(), Key(impl),
                        inSource.Contains(Key(impl)) ? "in_source" : "external", "interface"));
                }
                // virtual members up the base chain, resolved at this type
                for (var b = t; b is not null; b = b.BaseType)
                foreach (var bm in b.GetMembers().OfType<IMethodSymbol>())
                {
                    if (!(bm.IsVirtual || bm.IsAbstract || bm.IsOverride)) continue;
                    var run = MostDerived(t, bm);
                    if (run is null || run.IsAbstract) continue;
                    dispatchRows.Add(Tsv(Key(bm), t.ToDisplayString(), Key(run),
                        inSource.Contains(Key(run)) ? "in_source" : "external", "virtual"));
                }
            }

            using var dw = new StreamWriter(dispatchPath, false, new UTF8Encoding(false));
            dw.WriteLine(string.Join('\t', "declaredKey", "runtimeType", "runtimeKey", "runtimeWhere", "how"));
            foreach (var r in dispatchRows.Distinct(StringComparer.Ordinal)) dw.WriteLine(r);
        }

        var manifestPath = Path.ChangeExtension(outPath, ".manifest.tsv");
        using (var w = new StreamWriter(manifestPath, false, new UTF8Encoding(false)))
        {
            void Kv(string k, string v) => w.WriteLine($"{k}\t{v}");
            Kv("schema", SchemaVersion);
            Kv("roslynVersion", typeof(CSharpCompilation).Assembly.GetName().Version?.ToString() ?? "unknown");
            Kv("languageVersion", langVersion.ToString());
            Kv("sourceRoot", root);
            Kv("filesParsed", trees.Count.ToString());
            Kv("filesUnreadable", unreadable.Count.ToString());
            Kv("referenceAssemblies", references.Length.ToString());
            Kv("declaredMethodSymbols", inSource.Count.ToString());
            Kv("sitesSeen", siteCount.ToString());
            Kv("sitesBound", rows.Count.ToString());
            Kv("sitesUnbound", unbound.Count.ToString());
            Kv("sitesInSource", rows.Count(r => r.Split('\t')[4] == "in_source").ToString());
            Kv("sitesExternal", rows.Count(r => r.Split('\t')[4] == "external").ToString());
            Kv("compileErrors", errors.Count.ToString());
            Kv("filesWithCompileErrors", errorFiles.Count.ToString());
            Kv("filesWithSyntaxErrors", recoveredFiles.Count.ToString());
            Kv("dispatchRows", dispatchRows.Distinct(StringComparer.Ordinal).Count().ToString());
            // The distinct error codes, so "the subject did not build" is a diagnosable
            // statement rather than a number. CS0246 in bulk means missing references;
            // CS8652 means a construct past the pinned language version.
            Kv("topErrorCodes", string.Join(",", errors.GroupBy(d => d.Id)
                .OrderByDescending(g => g.Count()).Take(8).Select(g => $"{g.Key}:{g.Count()}")));
            foreach (var (p, reason) in unreadable) Kv("unreadable", $"{p}\t{reason}");
            foreach (var f in errorFiles.Take(200)) Kv("errorFile", f);
            foreach (var f in recoveredFiles) Kv("recoveredFile", f);
        }

        Console.Error.WriteLine(
            $"oracle: {trees.Count} files, {siteCount} sites, {rows.Count} bound " +
            $"({rows.Count(r => r.Split('\t')[4] == "in_source")} in-source), {unbound.Count} unbound, " +
            $"{errors.Count} compile errors in {errorFiles.Count} files, " +
            $"{recoveredFiles.Count} of them unparsable");
        return 0;
    }

    private readonly record struct Site(
        SyntaxNode Anchor, string Kind, IMethodSymbol? Target, string? UnboundReason);

    /// <summary>
    /// Every call the compiler resolves at this node. Several have no call syntax:
    /// an implicit conversion, a compound assignment on a type with an operator, a
    /// property access. Those are the ones a syntax-only reading cannot produce, so
    /// they are the ones worth being explicit about.
    /// </summary>
    private static IEnumerable<Site> Sites(SyntaxNode node, SemanticModel model)
    {
        switch (node)
        {
            case InvocationExpressionSyntax inv:
            {
                var si = model.GetSymbolInfo(inv);
                var m = si.Symbol as IMethodSymbol;
                if (m is null && si.CandidateSymbols.Length > 0)
                {
                    // Roslyn could not pick one overload. That is a real answer about
                    // the program, not a hole: the candidates are reported so the
                    // harness can score the engine's set against the same ambiguity
                    // rather than calling the engine wrong for keeping several.
                    foreach (var c in si.CandidateSymbols.OfType<IMethodSymbol>())
                        yield return new Site(inv, "invocation_candidate", c, null);
                    yield break;
                }
                yield return new Site(inv, "invocation", m, m is null ? Reason(si) : null);
                yield break;
            }
            case ObjectCreationExpressionSyntax oc:
                yield return new Site(oc, "object_creation", model.GetSymbolInfo(oc).Symbol as IMethodSymbol,
                    null);
                yield break;
            case ImplicitObjectCreationExpressionSyntax ioc:
                // `new()` with the type inferred from the target. No type name is
                // written at all.
                yield return new Site(ioc, "implicit_object_creation",
                    model.GetSymbolInfo(ioc).Symbol as IMethodSymbol, null);
                yield break;
            case ConstructorInitializerSyntax ci:
                yield return new Site(ci, "ctor_delegate", model.GetSymbolInfo(ci).Symbol as IMethodSymbol, null);
                yield break;
            case PrimaryConstructorBaseTypeSyntax pcb:
                // `class D(int a) : B(a)` -- a base constructor call written in the
                // heritage clause, with no call syntax in the body.
                yield return new Site(pcb, "primary_ctor_base",
                    model.GetSymbolInfo(pcb).Symbol as IMethodSymbol, null);
                yield break;
            case ElementAccessExpressionSyntax ea:
            {
                // `a[i]` on a user-defined indexer is an accessor call. On an array it
                // is not a call at all, and GetSymbolInfo returns nothing, which is the
                // right distinction.
                if (model.GetSymbolInfo(ea).Symbol is IPropertySymbol ip)
                {
                    foreach (var acc in AccessorsCalled(ea, ip))
                        yield return new Site(ea, "indexer", acc, null);
                }
                yield break;
            }
            case MemberAccessExpressionSyntax ma:
            {
                // A PROPERTY read or write is a call to an accessor, and it is the
                // commonest member access in C#. Excluded when the access is itself the
                // callee of an invocation, because that invocation is its own site.
                if (ma.Parent is InvocationExpressionSyntax pi && pi.Expression == ma) yield break;
                if (model.GetSymbolInfo(ma).Symbol is IPropertySymbol prop)
                {
                    foreach (var acc in AccessorsCalled(ma, prop))
                        yield return new Site(ma, "property_accessor", acc, null);
                }
                yield break;
            }
            case IdentifierNameSyntax id:
            {
                // A PROPERTY ACCESS WITH NO RECEIVER. `Own` inside the declaring type
                // is `this.get_Own()`, and a static one is a call too; `o?.Own` binds
                // its name through a MemberBindingExpression rather than a
                // MemberAccessExpression, so it reaches no branch above either.
                //
                // Both were absent from the ground truth entirely (#1170), which is
                // worse than being wrong about them: a shape the oracle holds no row
                // for cannot be scored as agreement and is not counted as engine-only,
                // so the engine's correct edges for it were invisible in BOTH
                // directions -- the one failure mode README.md says scoring against
                // the compiler rules out.
                //
                // The guards are the ones the member-access branch already carries,
                // plus the two places an identifier NAMES a property without calling
                // it. `nameof(Own)` binds to the property and evaluates to a string at
                // compile time -- no accessor runs. `Name =` in an attribute argument
                // or an anonymous object (NameEqualsSyntax) and `name:` in a named
                // argument or a property pattern (NameColonSyntax) are also bindings
                // rather than calls; a property pattern does read the property, but the
                // read is the pattern matcher's, not the expression's, and reporting it
                // would hold the engine to a call no call site in the source spells.
                if (id.Parent is MemberAccessExpressionSyntax pma && pma.Name == id) yield break;
                if (id.Parent is InvocationExpressionSyntax pinv && pinv.Expression == id) yield break;
                if (id.Parent is NameEqualsSyntax or NameColonSyntax) yield break;
                if (InNameOf(id)) yield break;
                if (model.GetSymbolInfo(id).Symbol is IPropertySymbol ip2)
                {
                    foreach (var acc in AccessorsCalled(id, ip2))
                        yield return new Site(id, "property_accessor", acc, null);
                }
                yield break;
            }
            case AssignmentExpressionSyntax asg:
            {
                // `e += handler` is a call to an event's add accessor; `x += y` on a type
                // with a user-defined operator is a call to that operator.
                // ONLY A USER-DEFINED OPERATOR IS A CALL. `sum += x` on two doubles
                // binds to `double.op_Addition`, which is an intrinsic the compiler
                // emits as an add instruction -- there is no method to call and no edge
                // to find. Without the MethodKind test the oracle reports one, and the
                // engine is marked as having missed a site that does not exist. The
                // binary and unary branches already test it; this one did not.
                var op = model.GetSymbolInfo(asg).Symbol as IMethodSymbol;
                if (op is not null && op.MethodKind == MethodKind.UserDefinedOperator)
                    yield return new Site(asg, "operator", op, null);
                if (model.GetSymbolInfo(asg.Left).Symbol is IEventSymbol ev)
                {
                    var acc = asg.IsKind(SyntaxKind.SubtractAssignmentExpression) ? ev.RemoveMethod : ev.AddMethod;
                    if (acc is not null) yield return new Site(asg, "event_accessor", acc, null);
                }
                yield break;
            }
            case BinaryExpressionSyntax bin:
            {
                if (model.GetSymbolInfo(bin).Symbol is IMethodSymbol op && op.MethodKind == MethodKind.UserDefinedOperator)
                    yield return new Site(bin, "operator", op, null);
                yield break;
            }
            case PrefixUnaryExpressionSyntax pre:
            {
                if (model.GetSymbolInfo(pre).Symbol is IMethodSymbol op && op.MethodKind == MethodKind.UserDefinedOperator)
                    yield return new Site(pre, "operator", op, null);
                yield break;
            }
            case PostfixUnaryExpressionSyntax post:
            {
                if (model.GetSymbolInfo(post).Symbol is IMethodSymbol op && op.MethodKind == MethodKind.UserDefinedOperator)
                    yield return new Site(post, "operator", op, null);
                yield break;
            }
            case CastExpressionSyntax cast:
            {
                // An EXPLICIT user-defined conversion. The cast syntax is there, but it
                // looks like a type assertion rather than a call.
                var conv = model.GetConversion(cast.Expression, default);
                if (conv.MethodSymbol is not null)
                    yield return new Site(cast, "conversion", conv.MethodSymbol, null);
                yield break;
            }
            case ArgumentSyntax arg:
            {
                // AN IMPLICIT USER-DEFINED CONVERSION at an argument position. There is
                // NO SYNTAX AT ALL at the call site: `Take(myThing)` where the parameter
                // is a different type and the author wrote an implicit operator. This is
                // the site the parser reserves CONVERSION_CALL for and never emits, and
                // an engine cannot find it from syntax either -- so the oracle reports
                // it, and the harness counts it as a known-undecidable rather than as a
                // miss.
                var conv = model.GetConversion(arg.Expression, default);
                if (conv is { IsUserDefined: true, MethodSymbol: not null })
                    yield return new Site(arg, "implicit_conversion", conv.MethodSymbol, null);
                yield break;
            }
            case ForEachStatementSyntax fe:
            {
                // The iteration protocol: GetEnumerator, MoveNext, Current. Real calls
                // the runtime makes, written nowhere. Reported separately so a harness
                // can choose whether to hold the engine to them; the engine does not
                // emit them, and the oracle saying so is more useful than either side
                // pretending they are not calls.
                var info = model.GetForEachStatementInfo(fe);
                if (info.GetEnumeratorMethod is not null)
                    yield return new Site(fe, "foreach_protocol", info.GetEnumeratorMethod, null);
                yield break;
            }
        }
    }

    /// <summary>
    /// The most derived override of <paramref name="declared"/> at or below
    /// <paramref name="t"/>: what actually runs when the receiver's runtime type is t.
    /// Walks UP from t, because an override is declared on a derived type and the
    /// first one found going up from the runtime type is the one the runtime picks.
    /// Returns null when t does not inherit the member at all.
    /// </summary>
    private static IMethodSymbol? MostDerived(INamedTypeSymbol t, IMethodSymbol declared)
    {
        var target = declared.OriginalDefinition;
        for (var cur = t; cur is not null; cur = cur.BaseType)
        {
            foreach (var m in cur.GetMembers(declared.Name).OfType<IMethodSymbol>())
            {
                if (SymbolEqualityComparer.Default.Equals(m.OriginalDefinition, target)) return m;
                for (var o = m.OverriddenMethod; o is not null; o = o.OverriddenMethod)
                    if (SymbolEqualityComparer.Default.Equals(o.OriginalDefinition, target)) return m;
            }
        }
        return null;
    }

    /// <summary>
    /// Whether THIS SITE is virtually dispatched, which is not the same question as
    /// whether the target is a virtual member.
    ///
    /// `base.Describe()` calls a virtual method NON-VIRTUALLY: the runtime runs the
    /// base implementation and no override. Reporting it as virtual made the harness
    /// expect the engine to fan, and the engine resolving it to exactly the base
    /// method -- which is correct -- read as a lost target.
    ///
    /// The same holds for a receiver whose type cannot be derived from (a struct, an
    /// enum, a sealed class) and for a freshly constructed receiver, but those are
    /// narrowings the engine performs and the harness scores; only the `base` case is
    /// a property of the SITE that the oracle alone can see.
    /// </summary>
    private static string SiteDispatch(Site site, IMethodSymbol declared)
    {
        if (!(declared.IsVirtual || declared.IsAbstract || declared.IsOverride)) return "static_bound";
        if (site.Anchor is InvocationExpressionSyntax inv &&
            inv.Expression is MemberAccessExpressionSyntax ma &&
            ma.Expression is BaseExpressionSyntax) return "non_virtual_base";
        return "virtual";
    }

    /// <summary>
    /// The accessors a property or indexer access at <paramref name="node"/> calls,
    /// in the order the runtime calls them.
    ///
    /// AN ACCESS IS NOT READ XOR WRITE. `p.V = 1` calls the setter and `p.V` the
    /// getter, but `p.V += 1`, `p.V ??= x` and `p.V++` call BOTH -- the compiler reads
    /// the property, applies the operator, and writes it back. Answering with one
    /// accessor made every compound form report only its setter (and `++`/`--` only
    /// its getter, since neither is an assignment at all), so the ground truth held one
    /// row where two calls happen and `p.V = 1` and `p.V += 1` were INDISTINGUISHABLE
    /// to the scorer: a case pinning the difference passed whichever way the engine
    /// answered (#1170).
    ///
    /// The kind test is SyntaxKind rather than the node type, because
    /// AssignmentExpressionSyntax is the node for `=` AND for every compound form;
    /// only SimpleAssignmentExpression is a write on its own.
    /// </summary>
    private static IEnumerable<IMethodSymbol> AccessorsCalled(SyntaxNode node, IPropertySymbol prop)
    {
        var (reads, writes) = node.Parent switch
        {
            AssignmentExpressionSyntax a when a.Left == node =>
                a.IsKind(SyntaxKind.SimpleAssignmentExpression) ? (false, true) : (true, true),
            PrefixUnaryExpressionSyntax pre when pre.Operand == node &&
                pre.Kind() is SyntaxKind.PreIncrementExpression or SyntaxKind.PreDecrementExpression
                => (true, true),
            PostfixUnaryExpressionSyntax post when post.Operand == node &&
                post.Kind() is SyntaxKind.PostIncrementExpression or SyntaxKind.PostDecrementExpression
                => (true, true),
            _ => (true, false),
        };
        if (reads && prop.GetMethod is not null) yield return prop.GetMethod;
        if (writes && prop.SetMethod is not null) yield return prop.SetMethod;
    }

    /// <summary>
    /// Whether this identifier sits inside a `nameof(...)`, where a property name is a
    /// compile-time string and no accessor runs. Roslyn still binds the identifier to
    /// the property, so the symbol alone cannot tell the two apart.
    /// </summary>
    private static bool InNameOf(SyntaxNode node)
    {
        for (var n = node.Parent; n is not null; n = n.Parent)
        {
            if (n is InvocationExpressionSyntax inv &&
                inv.Expression is IdentifierNameSyntax { Identifier.ValueText: "nameof" }) return true;
            if (n is MemberDeclarationSyntax or StatementSyntax) break;
        }
        return false;
    }

    private static string Reason(SymbolInfo si) => si.CandidateReason switch
    {
        CandidateReason.None => "NO_SYMBOL",
        _ => $"CANDIDATE_{si.CandidateReason}",
    };

    private static IMethodSymbol? EnclosingMethod(SyntaxNode node, SemanticModel model)
    {
        for (var n = node; n is not null; n = n.Parent)
        {
            switch (n)
            {
                case MethodDeclarationSyntax or ConstructorDeclarationSyntax or DestructorDeclarationSyntax
                    or OperatorDeclarationSyntax or ConversionOperatorDeclarationSyntax
                    or LocalFunctionStatementSyntax or AccessorDeclarationSyntax:
                    return model.GetDeclaredSymbol(n) as IMethodSymbol;
                // A LAMBDA BODY IS ITS OWN METHOD, and the engine attributes calls in it
                // to the lambda. The oracle has to agree or every callback's caller
                // disagrees for a reason that is about convention rather than about
                // correctness.
                case AnonymousFunctionExpressionSyntax lam:
                    return model.GetSymbolInfo(lam).Symbol as IMethodSymbol;
            }
        }
        return null;
    }

    /// <summary>
    /// The join key for a method symbol. Fully qualified, with the parameter count,
    /// and taken from the ORIGINAL DEFINITION so that `List&lt;int&gt;.Add` and
    /// `List&lt;string&gt;.Add` are one key -- the engine has one method row for the
    /// declaration and comparing against per-instantiation keys would report every
    /// generic call as a mismatch.
    /// </summary>
    private static string Key(IMethodSymbol m)
    {
        var d = m.OriginalDefinition;
        var type = d.ContainingType?.OriginalDefinition.ToDisplayString(
            SymbolDisplayFormat.FullyQualifiedFormat.WithGlobalNamespaceStyle(
                SymbolDisplayGlobalNamespaceStyle.Omitted)) ?? "<global>";
        var name = d.MethodKind switch
        {
            MethodKind.Constructor or MethodKind.StaticConstructor => "<constructor>",
            _ => d.Name,
        };
        return $"{type}.{name}/{d.Parameters.Length}";
    }

    private static string Rel(string root, string full)
    {
        var r = Path.GetRelativePath(root, full);
        return r.Replace(Path.DirectorySeparatorChar, '/');
    }

    private static string Tsv(params string[] cells) =>
        string.Join('\t', cells.Select(c => c.Replace('\t', ' ').Replace('\n', ' ').Replace('\r', ' ')));

    private static int Fail(string msg)
    {
        Console.Error.WriteLine($"oracle: {msg}");
        return 2;
    }

    /// <summary>
    /// Files the oracle reads. Mirrors what the parser walks, so the two sides see the
    /// same file set: build output and package caches are excluded, and test sources
    /// are excluded only when asked.
    /// </summary>
    private static IEnumerable<string> EnumerateSources(string root, bool excludeTests)
    {
        var skip = new[] { "/obj/", "/bin/", "/.git/", "/packages/", "/node_modules/", "/.vs/" };
        foreach (var f in Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories))
        {
            var norm = "/" + f.Replace(Path.DirectorySeparatorChar, '/').TrimStart('/') + "";
            if (skip.Any(s => norm.Contains(s, StringComparison.OrdinalIgnoreCase))) continue;
            if (excludeTests && IsTestPath(norm)) continue;
            yield return f;
        }
    }

    private static bool IsTestPath(string norm) =>
        norm.Contains("/test/", StringComparison.OrdinalIgnoreCase) ||
        norm.Contains("/tests/", StringComparison.OrdinalIgnoreCase) ||
        norm.EndsWith("Tests.cs", StringComparison.OrdinalIgnoreCase) ||
        norm.EndsWith("Test.cs", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// THE REFERENCE ASSEMBLIES, AND ONLY THOSE. The engine is run client-only, so the
    /// oracle is given the framework and nothing else. `--refs` overrides with a
    /// directory of assemblies, which is how a subject that genuinely needs one
    /// dependency to bind its own calls can be measured without giving the oracle the
    /// whole NuGet closure.
    ///
    /// Resolved from the RUNNING runtime's assemblies, so it needs no reference pack
    /// on disk and cannot pick up a different framework version than the one this tool
    /// was built against.
    /// </summary>
    private static ImmutableArray<MetadataReference> ResolveReferences(string? refsDir)
    {
        var b = ImmutableArray.CreateBuilder<MetadataReference>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var tpa = (AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string ?? "")
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);
        foreach (var p in tpa)
        {
            if (!p.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)) continue;
            if (!File.Exists(p)) continue;
            if (!seen.Add(Path.GetFileName(p))) continue;
            try { b.Add(MetadataReference.CreateFromFile(p)); } catch { /* unreadable: skipped, counted by the total */ }
        }

        if (refsDir is not null && Directory.Exists(refsDir))
        {
            foreach (var p in Directory.EnumerateFiles(refsDir, "*.dll", SearchOption.AllDirectories))
            {
                if (!seen.Add(Path.GetFileName(p))) continue;
                try { b.Add(MetadataReference.CreateFromFile(p)); } catch { }
            }
        }
        return b.ToImmutable();
    }
}
