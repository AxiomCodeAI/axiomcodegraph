// ============================================================================
// THE RUNTIME ORACLE'S INSTRUMENTER
//
// Rewrites a MIRROR of the subject's source so that every method body announces
// its own entry, then the subject's own test suite is run against the mirror. The
// trace answers a question no static analysis can: which of the edges the engine
// named were actually TAKEN, and which taken edge did the engine not name at all.
//
// WHAT IS INJECTED, AND WHY IT IS ONLY METHOD ENTRY.
//
// A per-CALL-SITE probe would be better and is not safely writable in C#. There is
// no comma operator, so a marker cannot be slipped in front of an arbitrary
// expression without rewriting that expression -- and rewriting a call whose
// arguments include `ref`, `out`, a lambda, a `stackalloc` or an argument whose
// overload resolution depends on its static type risks changing which overload is
// selected. An instrumenter that changes the program is not measuring the program.
//
// So the probe is a single statement at the top of each body:
//
//     global::AxiomCsTrace.E(<id>);
//
// and the CALLER is recovered from a shadow stack the tracer keeps per thread. That
// yields exact (caller, callee) pairs, which is what a chain is made of, and it
// yields them without touching a single expression.
//
// THE ID IS THE STATIC ORACLE'S KEY. `Type.Name/paramCount`, produced by the same
// display format, so a runtime edge and a static edge join with no translation
// layer to get wrong.
//
// WHAT IS NOT INSTRUMENTED, AND COUNTED RATHER THAN HIDDEN:
//   no body            abstract, interface without a default, extern, partial
//                      definition. Nothing to enter.
//   ref-returning      converting `=> ref x` to a block is not always valid
//   unsafe/fixed       a probe inside a fixed block changes nothing, but the
//                      conversion path is not worth the risk
//   iterators          INSTRUMENTED, with a caveat recorded in the manifest: the
//                      probe fires on the first MoveNext, not at the call, so a
//                      lazily enumerated method that is never consumed reports no
//                      entry even though it was called.
//
// Usage:
//   axiom-cs-instrument --src <mirror-dir> --ids <ids.tsv> [--only <subdir>]
// ============================================================================

using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using static Microsoft.CodeAnalysis.CSharp.SyntaxFactory;

namespace AxiomCsInstrument;

internal static class Program
{
    public static int Main(string[] args)
    {
        string? src = null, ids = null, only = null;
        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--src": src = args[++i]; break;
                case "--ids": ids = args[++i]; break;
                case "--only": only = args[++i]; break;
                default:
                    Console.Error.WriteLine($"instrument: unknown argument {args[i]}");
                    return 2;
            }
        }
        if (src is null || ids is null)
        {
            Console.Error.WriteLine("usage: --src <mirror-dir> --ids <ids.tsv> [--only <subdir>]");
            return 2;
        }
        var root = Path.GetFullPath(src);
        if (!Directory.Exists(root)) { Console.Error.WriteLine($"not a directory: {root}"); return 2; }

        var scope = only is null ? root : Path.GetFullPath(Path.Combine(root, only));
        var files = Directory.EnumerateFiles(scope, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Replace('\\', '/').Contains("/obj/") && !f.Replace('\\', '/').Contains("/bin/"))
            // The tracer's own source must not be instrumented: a probe inside the
            // probe recurses until the stack ends.
            .Where(f => !Path.GetFileName(f).Equals("AxiomCsTrace.cs", StringComparison.OrdinalIgnoreCase))
            .ToList();

        var parseOptions = new CSharpParseOptions(LanguageVersion.CSharp13);
        var table = new List<string>();
        var counts = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["instrumented"] = 0, ["no_body"] = 0, ["ref_return"] = 0,
            ["unsafe_skipped"] = 0, ["iterator"] = 0, ["files_rewritten"] = 0,
            ["rewrite_rejected"] = 0,
        };

        // ONE COUNTER FOR THE WHOLE RUN. It used to be a field of the rewriter, which
        // is constructed per file, so every file started again at 0 and id 0 named 127
        // different methods. The trace then merged unrelated edges and reported 74
        // distinct methods out of 604 probes.
        var nextId = new int[1];
        foreach (var f in files)
        {
            var text = File.ReadAllText(f);
            var tree = CSharpSyntaxTree.ParseText(text, parseOptions, path: f);
            // A file the grammar could not read is left alone: rewriting a
            // misparsed tree produces source that does not compile, and the whole
            // subject then fails to build for one bad file.
            if (tree.GetDiagnostics().Any(d => d.Severity == DiagnosticSeverity.Error)) continue;

            var rw = new EntryProbeRewriter(tree, counts, nextId);
            var newRoot = rw.Visit(tree.GetRoot());
            if (rw.Injected == 0) continue;
            var rewritten = newRoot.ToFullString();

            // THE REWRITE IS RE-PARSED BEFORE IT IS WRITTEN. An instrumenter that
            // emits source the compiler rejects takes down the WHOLE subject for one
            // file, and the failure surfaces as "no trace produced" -- which reads as
            // a tracer or harness problem rather than as a bad rewrite. Two got
            // through before this check existed: a missing space after `return`, and a
            // preprocessor directive pushed off the start of its line.
            //
            // A file that does not survive is left as it was and COUNTED, so the trace
            // is merely incomplete by a knowable amount instead of absent.
            var check = CSharpSyntaxTree.ParseText(rewritten, parseOptions, path: f);
            var broke = check.GetDiagnostics()
                .Where(d => d.Severity == DiagnosticSeverity.Error)
                .Take(3).ToList();
            if (broke.Count > 0)
            {
                counts["rewrite_rejected"]++;
                foreach (var d in broke)
                    Console.Error.WriteLine($"  !! {Path.GetFileName(f)}: {d.Id} {d.GetMessage()} -- left uninstrumented");
                continue;
            }

            table.AddRange(rw.Table);
            File.WriteAllText(f, rewritten, new UTF8Encoding(false));
            counts["files_rewritten"]++;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(ids))!);
        using (var w = new StreamWriter(ids, false, new UTF8Encoding(false)))
        {
            w.WriteLine(string.Join('\t', "id", "key", "filePath", "line", "kind"));
            foreach (var r in table) w.WriteLine(r);
        }
        using (var w = new StreamWriter(Path.ChangeExtension(ids, ".manifest.tsv"), false, new UTF8Encoding(false)))
            foreach (var kv in counts.OrderBy(k => k.Key))
                w.WriteLine($"{kv.Key}\t{kv.Value}");

        Console.Error.WriteLine(
            $"instrument: {counts["files_rewritten"]} files, {counts["instrumented"]} probes, " +
            $"skipped {counts["no_body"]} bodiless / {counts["ref_return"]} ref-returning / " +
            $"{counts["unsafe_skipped"]} unsafe, {counts["iterator"]} iterators (probe fires on first MoveNext)" +
            (counts["rewrite_rejected"] > 0
                ? $", {counts["rewrite_rejected"]} file(s) LEFT UNINSTRUMENTED because the rewrite did not parse"
                : ""));
        return 0;
    }
}

internal sealed class EntryProbeRewriter : CSharpSyntaxRewriter
{
    private readonly SyntaxTree _tree;
    private readonly Dictionary<string, int> _counts;
    private readonly List<string> _table = new();
    private readonly int[] _next;     // shared across files; see the note at the call site
    private readonly Stack<string> _typeNames = new();

    public EntryProbeRewriter(SyntaxTree tree, Dictionary<string, int> counts, int[] nextId)
    {
        _tree = tree;
        _counts = counts;
        _next = nextId;
    }

    public int Injected { get; private set; }
    public IReadOnlyList<string> Table => _table;

    // The type nest, so a key can be built WITHOUT a semantic model. The
    // instrumenter runs over a mirror with no references resolved -- binding it
    // would need the whole dependency closure, which is exactly what this harness
    // avoids -- so the key is assembled syntactically and the join tolerates it: the
    // static side is matched on the same `Type.Name/count` shape.
    public override SyntaxNode? VisitNamespaceDeclaration(NamespaceDeclarationSyntax node)
    {
        _typeNames.Push(node.Name.ToString());
        var r = base.VisitNamespaceDeclaration(node);
        _typeNames.Pop();
        return r;
    }

    public override SyntaxNode? VisitFileScopedNamespaceDeclaration(FileScopedNamespaceDeclarationSyntax node)
    {
        _typeNames.Push(node.Name.ToString());
        var r = base.VisitFileScopedNamespaceDeclaration(node);
        _typeNames.Pop();
        return r;
    }

    public override SyntaxNode? VisitClassDeclaration(ClassDeclarationSyntax n) => VisitType(n, base.VisitClassDeclaration);
    public override SyntaxNode? VisitStructDeclaration(StructDeclarationSyntax n) => VisitType(n, base.VisitStructDeclaration);
    public override SyntaxNode? VisitRecordDeclaration(RecordDeclarationSyntax n) => VisitType(n, base.VisitRecordDeclaration);
    public override SyntaxNode? VisitInterfaceDeclaration(InterfaceDeclarationSyntax n) => VisitType(n, base.VisitInterfaceDeclaration);

    private SyntaxNode? VisitType<T>(T node, Func<T, SyntaxNode?> baseVisit) where T : TypeDeclarationSyntax
    {
        _typeNames.Push(node.Identifier.Text);
        var r = baseVisit(node);
        _typeNames.Pop();
        return r;
    }

    private string TypePath() => string.Join(".", _typeNames.Reverse());

    public override SyntaxNode? VisitMethodDeclaration(MethodDeclarationSyntax node)
    {
        if (node.ReturnType is RefTypeSyntax) { _counts["ref_return"]++; return node; }
        return Probe(node, node.Identifier.Text, node.ParameterList.Parameters.Count,
            node.Body, node.ExpressionBody, node.ReturnType is PredefinedTypeSyntax { Keyword.RawKind: (int)SyntaxKind.VoidKeyword },
            (b, e) => node.WithBody(b).WithExpressionBody(e).WithSemicolonToken(e is null ? default : node.SemicolonToken),
            HasYield(node));
    }

    public override SyntaxNode? VisitConstructorDeclaration(ConstructorDeclarationSyntax node) =>
        Probe(node, "<constructor>", node.ParameterList.Parameters.Count, node.Body, node.ExpressionBody, true,
            (b, e) => node.WithBody(b).WithExpressionBody(e).WithSemicolonToken(e is null ? default : node.SemicolonToken),
            false);

    public override SyntaxNode? VisitAccessorDeclaration(AccessorDeclarationSyntax node)
    {
        var owner = node.Ancestors().OfType<BasePropertyDeclarationSyntax>().FirstOrDefault();
        var name = owner switch
        {
            PropertyDeclarationSyntax p => p.Identifier.Text,
            IndexerDeclarationSyntax => "this[]",
            EventDeclarationSyntax e => e.Identifier.Text,
            _ => "?",
        };
        var kw = node.Keyword.Text;   // get / set / init / add / remove
        var isVoid = kw is not "get";
        var paramc = kw is "get" ? 0 : 1;
        return Probe(node, $"{kw}_{name}", paramc, node.Body, node.ExpressionBody, isVoid,
            (b, e) => node.WithBody(b).WithExpressionBody(e).WithSemicolonToken(e is null ? default : node.SemicolonToken),
            false);
    }

    public override SyntaxNode? VisitLocalFunctionStatement(LocalFunctionStatementSyntax node)
    {
        if (node.ReturnType is RefTypeSyntax) { _counts["ref_return"]++; return node; }
        return Probe(node, node.Identifier.Text, node.ParameterList.Parameters.Count,
            node.Body, node.ExpressionBody, node.ReturnType is PredefinedTypeSyntax { Keyword.RawKind: (int)SyntaxKind.VoidKeyword },
            (b, e) => node.WithBody(b).WithExpressionBody(e).WithSemicolonToken(e is null ? default : node.SemicolonToken),
            HasYield(node));
    }

    private static bool HasYield(SyntaxNode n) =>
        n.DescendantNodes(d => d is not AnonymousFunctionExpressionSyntax and not LocalFunctionStatementSyntax)
         .Any(d => d is YieldStatementSyntax);

    /// <summary>
    /// Insert the probe. A BLOCK body gets one statement at the top. An EXPRESSION
    /// body is converted to a block, which is the only way to put a statement in
    /// front of it -- and the conversion has to respect whether the member returns a
    /// value, because `{ Probe(); expr; }` is wrong for a non-void member and
    /// `{ Probe(); return expr; }` is wrong for a void one.
    /// </summary>
    private SyntaxNode? Probe<T>(
        T node, string name, int paramc, BlockSyntax? body, ArrowExpressionClauseSyntax? arrow,
        bool isVoid, Func<BlockSyntax?, ArrowExpressionClauseSyntax?, SyntaxNode> rebuild, bool isIterator)
        where T : SyntaxNode
    {
        if (body is null && arrow is null) { _counts["no_body"]++; return node; }
        if (node.Ancestors().Any(a => a is UnsafeStatementSyntax) ||
            node.ChildTokens().Any(t => t.IsKind(SyntaxKind.UnsafeKeyword)))
        { _counts["unsafe_skipped"]++; return node; }

        var id = _next[0]++;
        var key = $"{TypePath()}.{name}/{paramc}";
        var line = _tree.GetLineSpan(node.Span).StartLinePosition.Line + 1;
        _table.Add(string.Join('\t', id.ToString(), key,
            _tree.FilePath.Replace('\\', '/'), line.ToString(),
            isIterator ? "iterator" : typeof(T).Name));
        if (isIterator) _counts["iterator"]++;
        _counts["instrumented"]++;
        Injected++;

        // ENTRY PUSHES AND A finally POPS. An entry probe alone is not enough: the
        // tracer reads the caller off the top of a per-thread shadow stack, and
        // without a matching pop the stack only grows. Measured on FluentValidation:
        // 111,405 stack overflows in one run, after which every caller read as
        // whatever happened to sit at depth 511 -- so the edges were fiction.
        //
        // try/finally is what a coverage tool does and is safe here: `yield return`
        // is permitted inside a try that has a finally (it is only forbidden with a
        // catch), `await` is fine, and ref-returning and unsafe members are skipped
        // above. It does mean the body is re-indented, which changes only whitespace.
        var probe = ParseStatement($"global::AxiomCsTrace.E({id});")
            .WithTrailingTrivia(ElasticCarriageReturnLineFeed);
        var pop = Block(ParseStatement("global::AxiomCsTrace.X();")
            .WithTrailingTrivia(ElasticCarriageReturnLineFeed));

        // Recurse first, so a lambda or local function inside this body is probed too.
        if (body is not null)
        {
            var visited = (BlockSyntax)base.Visit(body)!;
            // THE ORIGINAL BLOCK NODE IS REUSED, not rebuilt from its statements.
            // `Block(visited.Statements)` emits fresh braces with no trivia, so the
            // new `{` lands immediately before the first statement's leading trivia --
            // and when that trivia starts with a preprocessor directive the result is
            // `{#region`, which is CS1040: a directive must be the first
            // non-whitespace on its line. Measured on FluentValidation's
            // DefaultValidatorExtensions.cs. Reusing the node keeps every byte of its
            // trivia where the author put it.
            var guarded = TryStatement(visited, default, FinallyClause(pop));
            return rebuild(Block(probe, guarded), null);
        }

        var expr = (ArrowExpressionClauseSyntax)base.Visit(arrow!)!;
        // THE SPACE AFTER `return` IS NOT OPTIONAL. ReturnStatement does not insert
        // one, and an expression body whose expression begins with an identifier then
        // emits `returnnew ValidatorDescriptor<T>(Rules);` -- which is a compile error
        // in the MIRROR, so the subject does not build and the trace comes back empty
        // with the failure looking like a tracer problem. The operand's own leading
        // trivia is dropped and replaced, because `=> expr` usually has a space there
        // already and keeping both produces `return  expr`.
        var operand = expr.Expression.WithoutLeadingTrivia().WithLeadingTrivia(Space);
        StatementSyntax tail = isVoid
            ? ExpressionStatement(operand)
            : ReturnStatement(operand);
        return rebuild(
            Block(probe, TryStatement(Block(tail), default, FinallyClause(pop))).WithTriviaFrom(arrow!),
            null);
    }
}
