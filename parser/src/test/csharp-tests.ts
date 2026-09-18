/**
 * C# TESTS — one file, mirroring `typescript-tests.ts` and `python-tests.ts`.
 *
 *     npx tsx src/test/csharp-tests.ts            # everything
 *     npx tsx src/test/csharp-tests.ts --list     # what runs, and what it proves
 *
 * **NO Roslyn, NO `dotnet`, NO network.** This suite runs the parser and checks
 * structural invariants of what it emits. Deciding what the expectations SHOULD
 * be needs Roslyn, and that lives out of process in `../parser-oracle/csharp`.
 *
 * The split is the point. A suite that can rewrite its own expectations has a
 * failure mode indistinguishable from success — red, re-bless, green, with the
 * defect now recorded as intended and every later fix reading as a regression.
 * This file can DETECT drift and cannot AUTHORISE it.
 *
 * ## Every check here has been made to fail on purpose
 *
 * §11: *"the most expensive errors in this repo were checks that returned
 * 'clean' because they were incapable of returning anything else."* So each
 * check below carries a NEGATIVE CONTROL — a deliberately broken input it must
 * reject — and the control runs in the same pass as the check. A gate whose
 * negative control stops failing has itself broken, and that is reported as a
 * failure rather than as a pass.
 */
import { spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import Parser from 'tree-sitter';

import { CsModuleRegistry } from '@/analysis-types/csharp/CsModuleRegistry';
import { CsTypeRegistry } from '@/analysis-types/csharp/CsTypeRegistry';
import { joinRow } from '@/analysis-types/csharp/cs-row';
import {
  CSHARP_EMISSION_REGIME,
  CSHARP_GRAMMAR_REGIME,
  TREE_SITTER_MAX_PARSE_CHARS,
} from '@/constants/csharp-constants';
import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import * as CsEnums from '@/enums/csharp';
import { CsNullableContext } from '@/enums/csharp/modules';
import {
  CsTypeAccess,
  CsTypeCategory,
  CsTypeModifier,
  CsTypePlacement,
} from '@/enums/csharp/types';
import { CSharpParser } from '@/parsers/csharp/csharp-parser';
import { ParserFactory } from '@/parsers/parser-factory';
import { ProjectDetector } from '@/utils/project-detector';
import { extractProject } from '@/extract';
import { ProjectLanguage } from '@/types/ProjectInfo';
import { CsFactExtractor } from '@/parsers/csharp/extractors/cs-fact-extractor';
import {
  assertPatchedGrammar,
  handledShapeRegression,
  SHAPES_THE_GRAMMAR_NOW_HANDLES,
  subtreeContainsType,
} from '@/parsers/csharp/grammar-gate';
import { reorderRefStructModifiers } from '@/parsers/csharp/extractors/cs-modifier-order';
import { rewriteSemicolonBodies } from '@/parsers/csharp/extractors/cs-semicolon-body';
import {
  blankInactiveRegions,
  resolveFileSymbols,
} from '@/parsers/csharp/extractors/cs-preproc-blank';
import {
  baseTypeName,
  hasNullableAnnotation,
  isPredefinedValueType,
  normalizeCSharpIdentifier,
  predefinedTypeAlias,
  simpleNameOf,
  typeArgumentArity,
} from '@/utils/csharp';
import { implicitFrameworkSymbols } from '@/parsers/csharp/extractors/preproc-context';
import {
  CSharpProjectAnalyzer,
  defineConstantsKeyOf,
} from '@/workflows/csharp/csharp-project-analyzer';

interface Check {
  name: string;
  proves: string;
  run: () => number | Promise<number>;
}

const fail = (message: string): number => {
  console.log('  ' + message);
  return 1;
};

/**
 * The PENDING ratchet, at its floor.
 *
 * A skipped check that prints nothing is indistinguishable from a passing one,
 * so the count was RATCHETED: it could fall and never rise, and lowering the
 * bar had to happen in the same commit that made a check runnable. Every
 * relation now has a column list and every check is switched on, so the bar is
 * 0 and `pendingCheck` is gone — a helper nothing calls is a claim that the
 * suite has pending coverage when it has none.
 *
 * The counters stay so that adding a PENDING check again is one function, and
 * so that a bar above its floor is still an error.
 */
const PENDING_BAR = 0;
const pending = 0;
const pendingNames: string[] = [];

// ---------------------------------------------------------------------------
// The gate corpus. Written to a temp directory from strings HERE, on purpose.
//
// `src/test-data/csharp/` belongs to cs-fixtures. A gate that owned fixtures
// would couple two agents' schedules for no benefit, and this suite needs
// inputs it can BREAK — a fixture nobody may edit cannot serve as a negative
// control.
// ---------------------------------------------------------------------------

/**
 * The BROAD corpus, owned by cs-fixtures, read here for enum coverage only.
 *
 * `src/test-data/csharp/` is not mine to write and this suite never modifies
 * it — which is exactly why it cannot replace the inline corpus, because a
 * fixture nobody may edit cannot serve as a negative control. It is read for
 * the one question the inline corpus is bad at: does the parser EVER emit this
 * declared value.
 *
 * Overridable so the two can be measured apart, and so a run can point at a
 * corpus that has not landed on this branch yet.
 *
 * ABSENT IS REPORTED, NOT SKIPPED. A coverage check that quietly does less is
 * indistinguishable from one that passes, so the audit says which corpora it
 * saw and asserts the bar that matches.
 */
const COVERAGE_CORPUS_DIR =
  process.env.CS_COVERAGE_CORPUS ?? path.join('src', 'test-data', 'csharp');

const GATE_CORPUS: Record<string, string> = {
  // A UTF-8 BOM, and its twin without one. The two sources are the SAME LENGTH
  // and differ only in the last character of the type name, so every column on
  // line 1 must be identical between them — and a call ON LINE 1 is the only
  // place a BOM can be seen at all. modern-app-A carries a BOM on 457 of 547 files
  // and only nine rows moved, because only nine files have a call on their
  // first line; the defect read as nine lost calls and nine phantom ones.
  // `Local(x) = v` is an ASSIGNMENT the published grammar reads as a local
  // declaration, minting a local per argument of the call. The legitimate
  // shapes are here too, and they are the reason the check is trustworthy.
  'RefReturningAssignment.cs': `namespace Acme.App;

public class RefReturningAssignment
{
    public void Misparsed(int value)
    {
        Local(instance) = value;
        Acme.App.Registry.ById(receiverArg) = value;
    }

    public void Legitimate()
    {
        var (first, second) = Pair();
        int ordinary = 1;
    }

    static (int, int) Pair() => (1, 2);
}
`,
  // A delegate's name is NOT the first identifier in its header. `delegate
  // <type> <name>` means a bare-identifier return type is the first identifier
  // child, and the positional read took it. Found on two projects never used
  // before; 25 of the 27 delegates in desktop-A and 1 of the 2 in library-A were right, because
  // a predefined type, a qualified name and an array type are all other node
  // kinds. The name is in the PRIMARY KEY, so the wrong one is a type nothing
  // can reference.
  'Delegates.cs': `namespace Acme.App;

public class DelegateShapes
{
    public delegate bool PredicateOk(int a);

    public delegate void ActionOk(int a);

    public delegate System.Exception QualifiedReturn(int a);

    public delegate Widget<int, int> ConstructedReturn(int a);

    public delegate Marker BareIdentifierReturn(int a);

    public delegate T GenericReturn<T>(T a);

    public delegate Marker[] ArrayReturn(int a);
}

public class Marker { }
`,
  // An ACCESSOR carries its own attributes. They were never emitted: the
  // accessor node was not registered as a declaration owner, so the attribute
  // extractor never visited it — and `attributeCount` said 0, so no count
  // disagreed with any other count. `[param: …]` on a setter is the only way
  // CsAttributeTarget.PARAM reaches a property at all.
  'AccessorAttributes.cs': `namespace Acme.App;

using System.Diagnostics.CodeAnalysis;

public class AccessorAttributes
{
    private int _v;

    public int Both
    {
        [System.Obsolete] get => _v;
        [System.Obsolete] set => _v = value;
    }

    public string? Named { get; [param: NotNull] set; }

    [System.Obsolete] public int OnTheMemberOnly { get; set; }

    public int Arrow => _v;
}
`,
  // The LENGTH of an array is not beside the type, it is INSIDE it:
  // `array_creation_expression > array_type > array_rank_specifier`. A type is
  // not an expression, so the whole rank specifier died before its children
  // were enqueued and every call in an array size was absent — while the
  // creation's own row and its type reference were both correct, so nothing
  // counted short. 90 sites in the BCL stratum: `new byte[Math.Min(a, b)]` is
  // how the framework allocates every buffer it has.
  'ArraySizes.cs': `namespace Acme.App;

public sealed class ArraySizes
{
    static int Len(int n) => n;

    public void M(int n)
    {
        var one = new byte[Len(n)];
        var two = new int[Len(n), Len(n + 1)];
        var jagged = new byte[Len(n)][];
        var initialized = new byte[] { 1, 2 };
        var stack = stackalloc byte[Len(n)];
    }
}
`,
  'BomProbeA.cs': '\uFEFFclass BomProbeA { static int N = System.Math.Abs(-1); }\n',
  'BomProbeB.cs': 'class BomProbeB { static int N = System.Math.Abs(-1); }\n',
  'Widget.Part1.cs': `namespace Acme.App;

public sealed partial class Widget<T, U>
{
    public sealed partial class Inner { }
}
`,
  // Part two of the same type, in a DIFFERENT file. The whole reason
  // declarationGroupKey exists.
  'Widget.Part2.cs': `namespace Acme.App;

public partial class Widget<T, U> { }
`,
  // Same NAME, different ARITY. 167 of these in the corpus; they must NOT merge.
  'Widget.Arity1.cs': `namespace Acme.App;

public partial class Widget<T> { }
`,
  // A single-part partial. 76.5% of partial identities look like this because
  // the other half is generated and not on disk. NORMAL, not a defect.
  'Generated.cs': `namespace Acme.App;

public partial class OnlyHalf { }
`,
  'Shapes.cs': `namespace Acme.Shapes
{
    public readonly ref struct Span2 { }
    public record struct Point(int X, int Y);
    public record Person(string Name);
    public delegate int Op(int a, int b);
    public enum Color { Red, Green }
    public interface IThing { }
    public static class Ext { }
}
`,
  // Two `file class C` in the same namespace ARE two types. If the scope key
  // ignored the file they would share a group key and the engine would merge
  // two unrelated types.
  'FileLocalA.cs': `namespace Acme.Shapes;
file class Local { }
`,
  'FileLocalB.cs': `namespace Acme.Shapes;
file class Local { }
`,
  'Conditional.cs': `namespace Acme.Cond;

#if NET8_0_OR_GREATER
public class Modern { }
#elif LEGACY
public class Old { }
#else
public class Fallback { }
#endif
`,
  // `async` as an identifier. The grammar gate's whole reason, in the corpus so
  // a regression shows up as missing rows and not only as a thrown constructor.
  'AsyncIdentifier.cs': `namespace Acme.Cond;

public class UsesAsync
{
    public void M(bool async)
    {
        if (async) { }
        var x = async;
    }
    public async System.Threading.Tasks.Task N() { await N(); }
}
`,
  'Nested.cs': `namespace A { namespace B { class C { class D { } } } }
`,
  // Two SIBLING namespaces, which is what MIXED means. The nested chain above
  // is not MIXED — it has one root — and the enum audit caught the parser
  // saying otherwise on its first run.
  'TwoNamespaces.cs': `namespace One { public abstract class Abs { } }
namespace Two { public class Other { } }
`,
  // `#nullable disable` is 453 of the 497 directives measured, so the CONTEXT
  // this corpus exercises has to include the common one and not only `enable`.
  // The two targeted forms are here so the enum audit's verdict on them is a
  // measurement rather than a reservation nobody tested.
  'NullableOff.cs': `namespace Acme.Null;
#nullable disable
public class Loose { }
#nullable enable
public class Strict { }
#nullable disable warnings
public class AnnotationsOnly { }
#nullable enable warnings
public class WarningsOnly { }
`,
  // Every ACCESSIBILITY a nested type can have, and the two modifiers that
  // otherwise had no site. Reserving a value is a claim that it is unreachable;
  // these are all one line of ordinary C#, so exercising them is honest and
  // reserving them would not be.
  'Nesting.cs': `namespace Acme.Nest;

internal class Host
{
    protected class Prot { }
    private class Priv { }
    internal class Intern { }
    protected internal class ProtInt { }
    private protected class PrivProt { }
    public unsafe struct Raw { }
}

public class Derived : Host
{
    protected new class Prot { }
}
`,
  // TOP-LEVEL STATEMENTS. A file with no type and no method, whose code is
  // still code — and in a minimal-hosting app, is the whole application.
  'TopLevel.cs': `using System;

var greeting = Greet("world");
Console.WriteLine(greeting);

foreach (var part in greeting.Split(' '))
{
    Console.WriteLine(part);
}

Func<int, int> scale = n => n * 2;
Console.WriteLine(scale(3));

static string Greet(string who) => $"hello {who}";
`,
  // A SECOND file of top-level statements, deliberately the same SHAPE as the
  // first: same names at the same lines and columns.
  //
  // Top-level code has no method, so `cs_block` and `cs_variable` keyed off an
  // EMPTY csMethodLinkHash — which took the file out of the key entirely and
  // made two such files collide. Measured at 6 duplicate keys in each relation
  // across 5,773 linq-heavy-A files, caught by the integrity check and by nothing
  // else. One file could never have shown it; the collision needs two.
  'TopLevelTwo.cs': `using System;

var greeting = Greet("moon");
Console.WriteLine(greeting);

foreach (var part in greeting.Split(' '))
{
    Console.WriteLine(part);
}

static string Greet(string who) => $"hi {who}";

// The ASP.NET test-visibility pattern. Roslyn MERGES this with the synthesised
// Program: two DeclaringSyntaxReferences, one type. So the synthesised row
// must share this one's declarationGroupKey (ruling v1.6 §4.0.3).
public partial class Program
{
    public static int Marker => 1;
}
`,
  // The four using forms. Extension-method visibility is decided by this set,
  // so a missing row here is a call edge the engine cannot rebuild.
  'Usings.cs': `global using System;
global using static System.Math;
global using Alias = A.B.C;
using System.Text;
using static System.Console;
using Sh = System.Collections.Generic.List<int>;
using Con = System.Console;
#if NET8_0_OR_GREATER
using Active.Branch;
#else
using Inactive.Branch;
#endif

namespace Acme.Use
{
    using Scoped.Inner;

    class Uses
    {
        // A reference THROUGH the alias. Sh names nothing but the using line
        // above it, and cs_using records that line — so this is a one-hop link
        // to it, and USING_ALIAS is what says so.
        static int Count()
        {
            // Con in a VALUE position is an identifier expression; Sh in a
            // type position is a type reference. Only the first is a reference
            // an expression row can classify.
            Con.WriteLine("counting");
            return new Sh().Count;
        }
    }
}
`,
  // Parse GAPS, one per bucket, so every declared kind is a measurement rather
  // than a reservation nobody tested. These files are deliberately broken and
  // contain no valid declaration, so nothing else in the suite reads them.
  'GapTruncating.cs': `class Broken {
    <<<<<<< this is not C# at all and runs for the whole file >>>>>>>
    %%% neither is this %%% ((( or this )))
    &&& nor &&& *** this ***
}
`,
  // Shape 1b: an ANONYMOUS missing node. `int x = 1 }` makes tree-sitter insert
  // a `;`, which is not a named node — so a named-only walk can never reach it
  // and MISSING_NODE becomes a declared value that is structurally impossible
  // to emit. The enum audit is what said so.
  'GapMissing.cs': `class GapMissing { int Value = 1 }
`,
  // THE THREE SHAPES A PARSE ERROR ACTUALLY TAKES, reduced from real files.
  // Only the first is an ERROR node, and a gap extractor that looks for ERROR
  // alone is silent about the other two.
  //
  // Shape 2: a ZERO-WIDTH node with `isMissing` FALSE. Reduced from
  // System.Private.CoreLib/src/System/Math.cs, where a `#elif` branch's
  // `else if` becomes a parameter list the grammar cannot complete.
  // Fields and enum members. Three modifiers were UNREACHABLE until cs_field
  // existed — the enum audit reported them as declared and never emitted, and
  // the cause was that there was nowhere to put them.
  // ONE NAME, THREE SPELLINGS. `@class` IS the identifier `class`; `\u0041bc`
  // IS `Abc`. Keeping the raw text does not merely miss the link between a
  // declaration and its use — it INVENTS one, because the use looks like a
  // reference to something undeclared.
  //
  // NOTE THE DOUBLED BACKSLASH. Written singly, TypeScript decodes the escape in
  // THIS template literal and the .cs file on disk contains `Abc` — so the
  // fixture silently stops testing the thing it is named after. The
  // negative-control harness is what caught it: the control that disables escape
  // decoding could not fail, because there was no escape to decode.
  // THE SPINE. Every construct here is one whose PARTS are easy and whose
  // STRUCTURE is the thing that gets lost.
  // CS-ORACLE-1: `await` as an IDENTIFIER in a non-async method. The grammar
  // reads "await + 1" as an await expression of "+1"; Roslyn reads an
  // AddExpression of the local "await" and 1. The walk re-reads it from the
  // enclosing declaration's async-ness. The async method beside it keeps its
  // real await.
  'AwaitIdentifier.cs': `namespace Acme.Await;

using System.Threading.Tasks;

public class AwaitIdentifier
{
    public int NotAsync()
    {
        int await = 1;
        int result = await + 1;
        return result;
    }

    public int NotAsyncCall() => await(2);

    public static int await(int x) => x;

    public async Task<int> IsAsync(Task<int> t)
    {
        int result = await t + 1;
        return result;
    }

    // ASYNC LAMBDAS (fork12, CS-CORPUS-29). 'async' is a reserved identifier,
    // and the grammar read it as every lambda's RETURN TYPE — so no lambda was
    // ever async, and 'await F()' inside one was a NAME_REFERENCE named await
    // with the call as its child. An explicit return type after 'async' was a
    // parse error, and a GENERIC one — the ASP.NET minimal-API shape,
    // 'async Task<Results<Ok<T>, NotFound>> (int id, Db db) => …' — was read
    // by rule 11 as a generic call and swallowed the rest of the file.
    public void Lambdas(Task<int> t)
    {
        Func<Task<int>> inferred = async () => await t;
        Func<Task<int>> implicitParameter = async x => await t;
        Func<int, Task> plainReturn = async Task (int id) => await t;
        Func<int, Task<Results<Ok<int>, NotFound<string>>>> genericReturn =
            async Task<Results<Ok<int>, NotFound<string>>> (int id) =>
            {
                await t;
                return new Results<Ok<int>, NotFound<string>>();
            };
        Func<int, int> notAsync = int (int id) => id + 1;
        Func<int, Task<int>> staticAsync = static async (int id) => await Task.FromResult(id);
        // 'async' the IDENTIFIER, in the same method: still a name, still a call.
        int async = 1;
        int viaIdentifier = async + await(async);
    }
    public class Results<TA, TB> { }
    public class Ok<T> { }
    public class NotFound<T> { }
}
`,
  'Binding.cs': `namespace Acme.Bind;

using System.Collections.Generic;

public class Binding
{
    // A collection expression whose element is a local named 'property' was
    // MOVED OUT, to the torture corpus. The published grammar's scanner reads
    // the word as a contextual keyword there and produces an ERROR, and an
    // ERROR in this file would put a parse gap under the twenty assertions
    // below that count rows in it. A construct the grammar cannot read gets
    // its own file, where the recovery is what is measured.

    // CS-CORPUS-22's residual: a NAMED tuple type as the generic argument.
    // Each named element read as a declaration expression, each scoring the
    // point the creation's two had to beat — '(new HashSet) < (string Name,
    // string? Schema) > (src)', two comparisons and two phantom locals.
    public static object NamedTupleGenericCreation(IEnumerable<(string, string?)> src)
        => new HashSet<(string Name, string? Schema)>(src);

    // Fork rule 15: '?.' binds to a PRIMARY. Upstream took any expression at
    // conditional precedence, so 'a || b?.M()' was '(a || b)?.M()', '!b?.M()'
    // was '(!b)?.M()' and '(T)x?.M()' was '((T)x)?.M()' — 836 null-conditional
    // nodes in 227 corpus files whose receiver was a binary or a cast.
    public static bool NullConditionalAfterOperator(bool a, string? b, object x)
        => a || b?.Contains("z") == true || !(b?.StartsWith("q") ?? false) || ((string?)x)?.Length > 0;
}
`,
  // A fluent chain DEEPER than TypeScript's 32-level cap. Each segment is one
  // level; at 32 the innermost five calls and the creation at the root — the
  // one edge naming the builder — were dropped silently. The longest corpus
  // chain is 37 segments (three DI registration chains in linq-heavy-A).
  'Deep.cs': `namespace Acme.Deep;

public class Builder
{
    public Builder(int n) { }
    public Builder Step1() => this;
    public Builder Step2() => this;
    public Builder Step3() => this;
    public Builder Step4() => this;
    public Builder Step5() => this;
    public Builder Step6() => this;
    public Builder Step7() => this;
    public Builder Step8() => this;
    public Builder Step9() => this;
    public Builder Step10() => this;
    public Builder Step11() => this;
    public Builder Step12() => this;
    public Builder Step13() => this;
    public Builder Step14() => this;
    public Builder Step15() => this;
    public Builder Step16() => this;
    public Builder Step17() => this;
    public Builder Step18() => this;
    public Builder Step19() => this;
    public Builder Step20() => this;
    public Builder Step21() => this;
    public Builder Step22() => this;
    public Builder Step23() => this;
    public Builder Step24() => this;
    public Builder Step25() => this;
    public Builder Step26() => this;
    public Builder Step27() => this;
    public Builder Step28() => this;
    public Builder Step29() => this;
    public Builder Step30() => this;
    public Builder Step31() => this;
    public Builder Step32() => this;
    public Builder Step33() => this;
    public Builder Step34() => this;
    public Builder Step35() => this;
    public Builder Step36() => this;
    public Builder Step37() => this;
    public Builder Step38() => this;
    public Builder Step39() => this;
    public Builder Step40() => this;
    public static Builder Make() =>
        new Builder(1)
            .Step1()
            .Step2()
            .Step3()
            .Step4()
            .Step5()
            .Step6()
            .Step7()
            .Step8()
            .Step9()
            .Step10()
            .Step11()
            .Step12()
            .Step13()
            .Step14()
            .Step15()
            .Step16()
            .Step17()
            .Step18()
            .Step19()
            .Step20()
            .Step21()
            .Step22()
            .Step23()
            .Step24()
            .Step25()
            .Step26()
            .Step27()
            .Step28()
            .Step29()
            .Step30()
            .Step31()
            .Step32()
            .Step33()
            .Step34()
            .Step35()
            .Step36()
            .Step37()
            .Step38()
            .Step39()
            .Step40()
            ;
}
`,
  'Spine.cs': `namespace Acme.Spine;

using System;

public class Spine
{
    private int _x;
    private EventHandler? _handler;
    public event EventHandler? Clicked;

    public void Run(string s, int n)
    {
        // Two on ONE LINE. The case that motivated wrapper nodes: joining
        // target and value on (scope, line) pairs '_x' with '2'.
        _x += 1; n += 2;
        _x = n;
        // A SUBSCRIPTION, not a compound assignment. Calls the add accessor.
        Clicked += OnClicked;
        Clicked -= OnClicked;
        // A method group: no call syntax at all.
        Action a = Helper;
        // Nested in something that emits nothing on its own.
        var ok = (Compute(n) && s.Contains("x"));
        // A cast that may invoke user code.
        var c = (Spine)(object)this;
        // The NULL-FORGIVING operator. It asserts to the compiler that the
        // value is not null and produces NO CODE — grouping it with ++/-- would
        // report a mutation that never happens.
        var forced = s!.Length;
        // out is a SECOND RETURN CHANNEL.
        if (int.TryParse(s, out var parsed)) { Console.WriteLine(parsed); }
        // A lambda's body belongs to the LAMBDA, not to Run.
        Action inner = () => Console.WriteLine(s);
        inner();
        a();
        // A foreach BODY. The walker's table once said for_each_statement
        // where the grammar says foreach_statement, so every expression and
        // every call in every foreach body was invisible — 17% of the corpus's
        // call sites, with nothing missing at the method level to notice by.
        // (No backticks in this fixture: it is a TEMPLATE LITERAL, and one
        // terminates it. Third time.)
        foreach (var part in s.Split(','))
        {
            Console.WriteLine(part);
        }
    }

    // A SINGLE-PARAMETER lambda writes its parameter as a bare identifier, not
    // a parameter_list — so a positional body-finder picks the PARAMETER as the
    // body and loses the expression entirely.
    public Func<int, string> Single => n => Describe(n);

    // An ACCESSOR HAS A BODY, and it is ordinary code that calls things.
    public string Computed
    {
        get { return Describe(_x); }
    }

    // A LOCAL FUNCTION IN AN ACCESSOR. Ordinary code; it was called as a
    // LOCAL_FUNCTION_CALL and declared nowhere.
    public string Lazy
    {
        get
        {
            return Build();
            string Build() => Stamp(_x) + "!";
        }
    }
    private static string Stamp(int v) => v.ToString();

    // A CURRIED lambda: the outer body IS the inner lambda.
    public Func<int, Func<int, int>> Add => a => b => a + b;

    // BARE MEMBER NAMES (ruling v1.8): a property read and written bare, and a
    // LOCAL that shadows the field _x — the nearer binding wins, so the local
    // is LOCAL_VARIABLE and never FIELD.
    public int Count { get; set; }
    public void Members()
    {
        Count = Count + 1;
        var _x = 2;
        Console.Write(_x);
    }
    // other.Count names the RECEIVER's member, not this type's, even though the
    // names coincide: the name half of a member access stays UNKNOWN.
    public int Peek(Spine other) => other.Count;

    // THREE SHAPES THE FORK'S GRAMMAR PARSES AND UPSTREAM'S DID NOT, each a
    // measured loss: an is-pattern on the left of && swallowed the call on
    // the right (264 in one stratum); a ref-returning call on the left of =
    // was read as a declaration of type RefTarget (~3,400); a slice pattern
    // that binds was a parse error.
    public int GrammarShapes(string s, int[] v)
    {
        if (s is not null && PatRight(s)) { }
        if (s is null || PatRight(s)) { }
        RefTarget(v) = PatValue();
        Owner = this;
        return v switch { [var head, .. var tail] => head + tail.Length, _ => 0 };
    }

    private object Owner;

    private static ref int RefTarget(int[] v) => ref v[0];
    private static bool PatRight(string s) => true;

    // 'this is X && …'. The operand of an 'is' is 'this', an ANONYMOUS token
    // rather than a named child, so a positional read of the named children
    // returns the PATTERN — and the tail the pattern swallowed then lands
    // under the is-expression, outside the span the rotation gives it. 892
    // rows in linq-heavy, every one a 'this is …', and no fixture had the shape
    // until the control for it could not fail.
    public bool ThisOperand() => this is Spine && Flag();
    private static bool Flag() => true;
    private static int PatValue() => 1;

    // TYPES IN EXPRESSION POSITIONS — the second pass (ruling v1.7).
    // One of each context, and an as-expression is NOT a cast: no conversion
    // operator can run through it.
    public int TypePositions(object o, int[] v)
    {
        var a = (Spine)o;
        var b = o as Spine;
        var c = o is Spine s ? 1 : 0;
        var d = new Spine();
        var e = new Spine[2];
        var f = typeof(Spine);
        var g = default(Spine);
        var h = sizeof(int);
        Span<int> sp = stackalloc int[3];
        var i = Generic<int, Spine>(1);
        var j = this.Generic<Spine>(2);
        Func<int, int> typed = (int q) => q;
        return a == null ? h : sp.Length;
    }
    private int Generic<T1>(int x) => x;
    private int Generic<T1, T2>(int x) => x;

    private string Describe(int v) => v.ToString();
    private void OnClicked(object? sender, EventArgs e) { }
    private void Helper() { }
    private bool Compute(int n) => n > 0;
}
`,
  // LINQ. No call syntax in the source, two to five calls in the semantics —
  // and the parser emits neither. It emits the CLAUSES, and the engine
  // desugars, because which overload on which receiver type through which
  // extension method in which using scope is four resolutions.
  'Linq.cs': `namespace Acme.Linq;

using System.Linq;
using System.Collections.Generic;

public class Queries
{
    public object Run(IEnumerable<int> xs, IEnumerable<int> zs)
    {
        // A statement BEFORE the query, so "the first expression in the body"
        // is not the query and a clause parented to it is parented wrong.
        var threshold = 1;
        return from x in xs
               let y = Scale(x)
               where y > 1
               join z in zs on x equals z
               join w in zs on x equals w into g
               orderby y descending, x
               group x by y into h
               select h.Key;
    }

    private int Scale(int v) => v * 2;
}
`,
  // Every block shape and every local-declaration shape C# has, so the enum
  // audit's verdict on each is a MEASUREMENT and not an absence of input. Five
  // of the nine declaration kinds here bind inside an expression and have no
  // `local_declaration_statement` anywhere.
  'Blocks.cs': `namespace Acme.Blk;

using System;
using System.Collections.Generic;

public class Blocks
{
    private int seed = 1;

    public Blocks(int start)
    {
        int fromCtor = start;
        Console.Write(fromCtor);
    }

    public int Value
    {
        get
        {
            int inAccessor = seed;
            return inAccessor;
        }
    }

    public unsafe void Shapes(string text, int[] data, IEnumerable<int> xs)
    {
        const int limit = 4;
        int plain = 0, second = 1;
        scoped Span<int> window = default;
        ref int alias = ref data[0];
        ref readonly int frozen = ref data[1];

        if (plain > limit)
        {
            plain = 0;
        }
        else
        {
            second = 2;
        }

        for (int i = 0; i < limit; i++)
        {
            plain += i;
        }

        foreach (var item in xs)
        {
            plain += item;
        }

        while (plain > 0)
        {
            plain--;
        }

        do
        {
            second++;
        }
        while (second < limit);

        switch (plain)
        {
            case 1:
                int inCase = 1;
                second = inCase;
                break;
            default:
                second = 0;
                break;
        }

        try
        {
            using (var reader = new System.IO.StringReader(text))
            {
                Console.Write(reader.ReadLine());
            }
            using var disposable = new System.IO.StringReader(text);
        }
        catch (InvalidOperationException e)
        {
            Console.Write(e.Message);
        }
        catch (Exception)
        {
            second = -1;
        }
        finally
        {
            plain = 0;
        }

        lock (this)
        {
            second = 3;
        }

        unsafe
        {
            fixed (int* pinned = data)
            {
                second = *pinned;
            }
        }

        checked
        {
            second = second + 1;
        }

        unchecked
        {
            second = second + 1;
        }

        {
            int nestedOnly = 9;
            Console.Write(nestedOnly);
        }

        outer:
        for (int j = 0; j < limit; j++)
        {
            if (j == 2)
            {
                goto outer;
            }
        }

        // An OUT-DISCARD binds NOTHING. Measured against Roslyn out of
        // process: GetDeclaredSymbol on the designation returns null, while the
        // same spelling in a DECLARATOR is an ILocalSymbol.
        int.TryParse(text, out var _);

        if (int.TryParse(text, out var parsed))
        {
            Console.Write(parsed);
        }

        object boxed = plain;
        if (boxed is string label)
        {
            Console.Write(label);
        }

        var (left, right) = Pair();
        var ((inner, deeper), outerMost) = Nested();
        Console.Write(left + right + inner + deeper + outerMost);

        // The OTHER spelling of a deconstruction declaration: a tuple of
        // declaration_expressions, the same node an out-var argument uses. Each
        // is a DECONSTRUCTION with its index in the flattened tuple; the
        // discard takes no index.
        ((var tupleA, var _), var tupleC) = ((1, 2), 3);
        foreach ((var eachKey, var eachValue) in new[] { (1, 2) }) { Console.Write(eachKey + eachValue); }

        if (boxed is Exception _)
        {
            second = 4;
        }
        Console.Write(window.Length + alias + frozen);

        Func<int, int> lambda = n =>
        {
            int inLambda = n;
            return inLambda;
        };
        Console.Write(lambda(1));

        int Local(int p)
        {
            int inLocal = p;
            return inLocal;
        }
        Console.Write(Local(2));
    }

    private static (int, int) Pair() => (1, 2);

    private static ((int, int), int) Nested() => ((1, 2), 3);
}

// A SECOND type in the file, so that a block, a local and an expression
// filed under "the first type in the file" are filed under the wrong one.
public class Later
{
    public int Run()
    {
        int inLater = 1;
        while (inLater < 3)
        {
            inLater += 1;
        }
        return inLater;
    }
}
`,
  // Attributes in every shape that changes what they attach to, plus the
  // comment forms and the two `#if` chains the region gate reads. Written as
  // one file because attribute ownership and comment ownership are the same
  // question — "which declaration is this metadata ABOUT" — and splitting them
  // would let the two answers drift.
  'Metadata.cs': `[assembly: System.Reflection.AssemblyMetadata("build", "1")]
[module: System.CLSCompliant(true)]

namespace Acme.Meta;

using System;

#if UNDEFINED_SYMBOL
public class NeverEmitted { }
#else
public class FromElse { }
#endif

/// <summary>A documented type.</summary>
/// <typeparam name="T">The element.</typeparam>
[Obsolete("gone", true), Serializable]
[System.ComponentModel.Description(Description = "named")]
public class Documented<[MyMarker] T>
{
    // A line comment above a field.
    [Obsolete] public int First, Second;

    /* A block comment. */
    [System.ComponentModel.DefaultValue(typeof(Documented<int>))]
    public int Tagged { get; set; } = 7;

    // A CAST inside an attribute argument is a cast: it carries its type pair.
    [System.ComponentModel.DefaultValue((byte)42)]
    public byte Small { get; set; }

    /// <summary>Does a thing.</summary>
    /// <param name="p">A parameter.</param>
    /// <returns>Nothing useful.</returns>
    [return: MyMarker]
    public string Act([MyMarker(1, Name = "n")] [param: MyMarker] int p) => p.ToString();

    [MyMarker]
    public event EventHandler? Fired;

    public enum Inner
    {
        [Obsolete] Legacy,
        Current,
    }
}

/// <inheritdoc/>
public class Inheriting : Documented<int> { }

/**
 * An XML doc BLOCK comment. Rare in C# and legal, and the enum audit is what
 * says whether the parser ever emits the value it declares for it.
 * <summary>Block-documented.</summary>
 */
public class BlockDocumented { }

// Every explicit attribute TARGET. A target changes what the attribute attaches
// to, not where it is written: [return:] attaches to the return value and
// [field:] on an auto-property attaches to a backing field with no declaration
// syntax anywhere.
[type: MyMarker]
[method: MyMarker]
[return: MyMarker]
public delegate void Targeted([param: MyMarker] int p);

public record Positional([property: MyMarker] [field: MyMarker] int Value);

public class Generic<[typevar: MyMarker] TItem>
{
    [event: MyMarker]
    public event EventHandler? Raised;

    // Every argument VALUE KIND syntax can decide. nameof is an invocation in
    // the tree and a compile-time string in the language, and only the callee's
    // spelling separates them — an ordinary call is not legal here, so the
    // check is exact rather than a heuristic.
    private const int Limit = 3;

    [System.ComponentModel.DefaultValue('c')]
    public int WithChar { get; set; }

    [System.ComponentModel.DefaultValue(null)]
    public string? WithNull { get; set; }

    [System.ComponentModel.Description(nameof(Limit))]
    public int WithNameof { get; set; }

    [System.ComponentModel.DefaultValue(Limit)]
    public int WithIdentifier { get; set; }

    [MyMarker(new[] { 1, 2 })]
    public int WithArray { get; set; }

    [System.ComponentModel.DefaultValue(1 + 2)]
    public int WithExpression { get; set; }
}

[AttributeUsage(AttributeTargets.All)]
public sealed class MyMarkerAttribute : Attribute
{
    public MyMarkerAttribute() { }
    public MyMarkerAttribute(int v) { }
    public MyMarkerAttribute(int[] v) { }
    public string Name { get; set; } = "";
}
`,
  // Every region SHAPE, in a file that parses cleanly, so the shape column is
  // measured rather than inferred from debris. `#if 1` is UNEVALUATED on
  // purpose: an integer condition is a shape the preprocessor evaluator does not
  // implement, and it returns false — which is a different fact from a symbol
  // being undefined and is the whole reason the column exists.
  'Regions.cs': `namespace Acme.Reg;

public class Shapes
{
#if UNDEFINED_SYMBOL
    public void Excluded() { }
    public int ExcludedField;
#endif

#if UNDEFINED_SYMBOL
#endif

#if 1
    public void Unevaluated() { }
#endif

    public void Body()
    {
#if UNDEFINED_SYMBOL
        var excluded = 1;
#endif
    }
}

public enum Members
{
    Always,
#if UNDEFINED_SYMBOL
    Conditional
#endif
}
`,
  // FRAGMENT — 16.9% of regions in a real corpus. A `#if` splitting a BASE LIST
  // holds nothing that can be parsed on its own, and this file does not parse
  // cleanly BY CONSTRUCTION. Recording the region with no child rows is the
  // honest terminal; silence would be indistinguishable from an empty region.
  // CS-CORPUS-25: a file's own #define / #undef, before its first token, are
  // part of the symbol set its #if chains are evaluated under. Roslyn honours
  // them; the evaluator read the configuration and never the file, so every
  // region guarded by a file-defined symbol was inverted. Three forms: a plain
  // #define, an #undef of an SDK-injected symbol (NET8_0 is in no file
  // anywhere), and a #define chosen by a top-of-file chain — only the TAKEN
  // branch's directive counts.
  'FileDefines.cs': `#define PLAIN
#undef NET8_0
#if FIXTURE_PLATFORM_A
#define USE_PRIMARY
#else
#define USE_FALLBACK
#endif
#if FIXTURE_THREE_WAY_A
#define THREE_A
#elif FIXTURE_THREE_WAY_B
#define THREE_B
#else
#define THREE_C
#endif
namespace Acme.Def;

public class FileDefines
{
    private static void Guarded() { }
    private static void Unguarded() { }
    private static void Fallback() { }
    private static void Primary() { }
    private static void Framework() { }
    private static void NoFramework() { }
    private static void ThreeB() { }
    private static void ThreeC() { }

    public static void Run()
    {
#if PLAIN
        Guarded();
#else
        Unguarded();
#endif
#if USE_FALLBACK
        Fallback();
#endif
#if USE_PRIMARY
        Primary();
#endif
#if NET8_0
        Framework();
#else
        NoFramework();
#endif
#if THREE_C
        ThreeC();
#endif
#if THREE_B
        ThreeB();
#endif
    }
}
`,
  // CS-CORPUS-23: a RELATIONAL pattern as the condition of a conditional
  // expression. The grammar's relational operand was any expression, so the
  // conditional and both arms were read INTO the pattern and every call in
  // them was lost; a type pattern in the same place was walked. Fork rule 7.
  // Also the qualified-constant form the fix exposed: "x is Limit.Max && Q(x)"
  // hoisted ".Max" out of the pattern onto the is-expression.
  'Relational.cs': `namespace Acme.Rel;

using System;

public static class Limit
{
    public const int Max = 10;
}

public class Relational
{
    private static int? Store(string key, object? value) => value as int?;
    private static bool Q(int x) => x > 0;

    public static int? Single(int maxLength)
        => maxLength is < -1
            ? throw new ArgumentOutOfRangeException(nameof(maxLength))
            : (int?)Store("max", maxLength);

    public static int? Combined(int? precision)
        => precision is not null and < 0
            ? throw new ArgumentOutOfRangeException(nameof(precision))
            : Store("precision", precision);

    public static bool Qualified(int x) => x is Limit.Max && Q(x);

    public static bool QualifiedRelational(int x) => x is < Limit.Max || Q(x);

    // CS-CORPUS-22, fork rule 8: a GENERIC creation with arguments AND an
    // initializer read as two comparisons and a cast of the initializer,
    // with no error node — the creation ended at the type name. Two forms.
    public static object GenericWithArgsAndInitializer()
        => new System.Collections.Generic.HashSet<int>(System.Collections.Generic.EqualityComparer<int>.Default) { 1, Store("k", 2) ?? 3 };

    public static object SimpleGenericWithArgsAndInitializer()
        => new System.Collections.Generic.List<int>(4) { 5 };

    // CS-CORPUS-28, the fork8 REGRESSION: nameof in PATTERN position. The
    // per-segment scoring that fixed the qualified-constant hoist tipped the
    // recursive-pattern / invocation tie, and "case nameof(X.Y):" became a
    // positional pattern named nameof — a bare name reference, no NAMEOF row.
    // Fork rule 9 removes the wrong reading instead of out-scoring it.
    public static int NameofAsCase(string s)
    {
        switch (s)
        {
            case nameof(Limit.Max): return 1;
            case nameof(Limit): return 2;
            default: return 0;
        }
    }

    public static int NameofAsArm(string s) => s switch { nameof(Limit.Max) => 1, _ => 0 };

    // A positional pattern with designations, which upstream read as a CALL
    // of the is-expression: (o is Point)(var x, var y).
    public static bool Positional(object o) => o is Point(var x, var y) && x > y;

    // CS-CORPUS-27: a creation of a NESTED type of a generic type. Fork rule 8
    // scored the simple generic, so "new Outer<int>.Builder(4)" read as
    // (new Outer<int>).Builder(4) — a METHOD_CALL at the right span, the
    // class no row count can see.
    public static object NestedOfGeneric() => new Outer<int>.Builder(4);
    public static object NestedOfGenericDeep() => new Outer<int>.Inner.Leaf(4);

    // CS-CORPUS-26, fork rule 11: a generic method call whose "<..>" also
    // reads as comparisons — cast-prefixed, on a creation receiver, and with
    // two type arguments inside an argument list, where the comma split the
    // arguments (C# spec 6.2.5's own example).
    public static object CastPrefixed(object x) => (int?)Convert<int>(x);
    public static object OnACreation() => (IDisposable?)new Outer<int>.Builder(1).AddFactory<int>(2);
    public static object InAnArgumentList(object v, object m) => Combine(BitCast<int, long>(v) & 1, Widen<int, long>(m) * 2);
    private static T Convert<T>(object x) => default!;
    private static object Combine(object a, object b) => a;
    private static long BitCast<TA, TB>(object v) => 0;
    private static long Widen<TA, TB>(object v) => 0;

    // Fork rule 12: pointer indirection of a cast — the statement was an ERROR
    // and its recovery swallowed two whole files of one stratum.
    // The pointer-indirection-of-a-cast line was MOVED OUT, to the torture
    // corpus. The published grammar cannot parse it, so leaving it here put an
    // ERROR node in the middle of a fixture whose other twenty assertions are
    // about shapes that parse fine, and a parse gap skews every count in the
    // file it sits in. A construct the grammar cannot read gets its own file,
    // so the recovery is measured rather than absorbed into a neighbour's
    // coverage.

    // CS-ORACLE-2: DISCARDS. Each "_" below binds nothing and is a DISCARD
    // row, not a NAME_REFERENCE to a name declared nowhere — except the last
    // method, where "_" IS a declared local and stays a reference.
    public static void Discards(object o, out int n)
    {
        _ = Try(out n);
        Try(out _);
        (_, n) = (1, 2);
        var d = o switch { _ => 1 };
        _ = o is _;
    }
    public static int DeclaredUnderscore()
    {
        int _ = 1;
        _ = 2;
        return _;
    }
    private static bool Try(out int v) { v = 0; return true; }
}

public record Point(int X, int Y);

public class Outer<T>
{
    public sealed class Builder { public Builder(int capacity) { } public object AddFactory<TF>(int n) => this; }
    public static class Inner { public sealed class Leaf { public Leaf(int n) { } } }
}
`,
  // CS-CORPUS-24: a NON-conditional directive between the operands of one
  // expression. "#pragma" is an extra the grammar places wherever it lies —
  // here as a named child of the binary_expression at index 1 — and every
  // positional read after it was off by one: no right operand, no call in
  // it. Filtered as trivia in namedChildren, the one place, like comments.
  'Pragmas.cs': `namespace Acme.Prag;

using System.Collections.Generic;
using System.Linq;

public class Pragmas
{
    public static IEnumerable<string> BetweenOperands(IEnumerable<string> a)
        => a.Where(
#pragma warning disable CS0618
                s => s.StartsWith("x")
#pragma warning restore CS0618
                     && s.IndexOf(':') > 0)
            .Select(s => "U" + s);

    public static object BeforeAnArm(bool flag, string s)
        => flag
            ? s.Length
#pragma warning disable CS0618
            : new List<string>(s.Split(',')).Count(x => x.Length > 0);
#pragma warning restore CS0618

    public static bool InAStatement(string s, string t)
    {
        return s.StartsWith("x")
#pragma warning disable CS0618
            && !t.EndsWith("y");
#pragma warning restore CS0618
    }
}
`,
  'RegionFragment.cs': `namespace Acme.Frag;

public interface IFirst { }
public interface ISecond { }

public class Split :
#if UNDEFINED_SYMBOL
    IFirst
#else
    ISecond
#endif
{
}
`,
  // EVERY EXPRESSION KIND, EDGE ROLE, LITERAL KIND AND RECEIVER KIND the parser
  // can emit.
  //
  // Written because the enum audit could not see the spine at all: its enum
  // list was hand-maintained and the ten spine enums were missing from it, so
  // the two largest relations in the fact base had no coverage. With the list
  // derived from the barrel, 33 values turned out to be emitted on a real
  // corpus and absent from these fixtures — which is a hole in the CORPUS, and
  // this file is the fix. The 64 that were absent from a real corpus too were
  // a different problem, and are gone.
  'Spine2.cs': `namespace Acme.Spine2;

using System;
using System.Collections.Generic;

public record Point(int X, int Y);

public class BaseKinds
{
    public BaseKinds(int seed) { Seed = seed; }
    public BaseKinds() : this(0) { }
    public int Seed;
    public virtual int Describe() => Seed;
}

// A base-constructor and a this-constructor initializer are CALL EDGES, and
// they sit outside every body — so the body walk never saw them and they were
// emitted nowhere. this.X and base.X reach the receiver position as ANONYMOUS
// tokens through the expression field, which is why a positional read returned
// the METHOD NAME: 19,832 linq-heavy-A call sites reported the callee's own name as
// the receiver type and were marked as extension-call syntax.
public class Derived : BaseKinds
{
    public event EventHandler? Ready = delegate { };

    // The initializers' ARGUMENTS carry calls. A base(M()) initializer kept
    // the base call and lost M() — 455 calls on the corpus — because the
    // argument list was pushed whole as an ARGUMENT and died as a
    // non-expression.
    public Derived(int seed) : base(Bump(seed)) { }
    public Derived() : this(Pick()) { }
    private static int Bump(int n) => n + 1;
    private static int Pick() => 1;

    public override int Describe()
    {
        this.Seed = base.Describe();
        return this.Seed;
    }

    public int Both()
    {
        // A call on THIS and a call on BASE. Both were reported with
        // receiverKind NAME and the method's own name as the receiver type,
        // because the receiver was read positionally.
        return this.Describe() + base.Describe();
    }
}

public class Kinds<TItem>
{
    public object? Field;

    // A PROPERTY INITIALIZER, which runs from the constructor and is a direct
    // expression child after the accessor list — not an equals_value_clause.
    public int Configured { get; set; } = ComputeDefault();

    private static int ComputeDefault() => 7;

    // A FIELD INITIALIZER that is a call, and a lambda inside one. The
    // expression walk started at method bodies AND NOTHING ELSE, so both were
    // absent from a fact base of 2,965,349 expressions.
    private static readonly Func<int, int> Doubler = value => Scale(value);
    private static readonly List<int> Seeded = MakeSeeds();

    private static int Scale(int value) => value * 2;
    private static string Wrap(string label) => label;
    private static string Wrap(int label) => label.ToString();
    private static List<int> MakeSeeds() => new List<int> { 1 };

    // A PARAMETER DEFAULT is an expression and can be a call.
    public int WithDefault(int n = 3) => n;

    public object Everything(object subject, Point point, int n, Exception error)
    {
        // Literal kinds: REAL, VERBATIM_STRING, RAW_STRING, BOOLEAN. In a BODY
        // and not on a field: when this was written a field initializer was
        // walked by nothing, and putting them there would have hidden four
        // literal kinds behind that gap. Initializers are walked now (Seeded,
        // Doubler above); these stay here so the two facts are asserted apart.
        var real = 1.5;
        var verbatim = @"c:\\temp";
        var raw = """a raw string""";
        var flag = true;

        // AS_EXPRESSION, and CONDITIONAL with its three roles.
        var maybe = subject as string;
        var chosen = n > 0 ? maybe : "none";

        // SWITCH_EXPRESSION, its governing operand, and its ARMS.
        var described = n switch
        {
            0 => "zero",
            > 0 when maybe != null => "positive",
            _ => "other",
        };

        // WITH_EXPRESSION — a record copy. Its initializer's "Name = value"
        // pairs are with_initializer nodes, not assignment_expressions, and
        // nothing inside them was walked (CS-CORPUS-21): the calls here are
        // asserted to exist under the WITH row.
        var moved = point with { X = Scale(n), Y = n > 0 ? Scale(1) : throw new InvalidOperationException("y") };

        // INTERPOLATED_STRING, an INTERPOLATION hole, and its alignment.
        var text = $"n is {n,4} and {described}";

        // ANONYMOUS_OBJECT and an object INITIALIZER with a target and a value.
        var bag = new { Name = described, Count = n };
        var built = new List<int> { 1, 2, 3 };
        var configured = new Kinds<TItem> { Field = bag };

        // COLLECTION_EXPRESSION.
        int[] numbers = [1, 2, 3];

        // TYPEOF as an expression, and a TYPE PARAMETER referenced by name.
        var itemType = typeof(TItem);

        // CHECKED_EXPRESSION.
        var wrapped = checked(n + 1);

        // THROW_EXPRESSION — an expression, not a statement.
        var required = maybe ?? throw new InvalidOperationException("null");

        // A NULL-CONDITIONAL call. Differs from an ordinary call in
        // REACHABILITY, not in target.
        var length = maybe?.Trim();

        // A NAMED ARGUMENT whose value is a CALL. The name lives in the name
        // field and IS a named child, so a positional read takes the name and
        // drops the value — the call inside produced no call site.
        var named = Wrap(label: Scale(n));

        // An ARRAY CREATION holding calls. Absent from the expression
        // allowlist, it emitted no row and every element died with it.
        var boxes = new object[] { Scale(n), Wrap(label: "x") };

        // NAMEOF parses as an invocation of a method called nameof and was a
        // call site that called nothing. The DECONSTRUCTION here is the
        // ASSIGNMENT form; cs_variable already has the declaration form. And
        // an explicit delegate construction around a method group is a
        // DELEGATE_CREATION, one fact more than a bare method group.
        var nameText = nameof(Scale);
        int first, second;
        (first, second) = (n, n + 1);
        Func<int, int> created = new Func<int, int>(Scale);

        // A COMMENT INSIDE AN EXPRESSION. A comment is a named child and shifts
        // every positional index after it, so the alternative below was read as
        // the comment and the call in it was lost.
        var picked = n > 0
            ? "positive"
            // the branch that was dropped
            : Wrap(label: "negative");

        // Receiver kinds: a QUALIFIED_NAME receiver and an INVOCATION receiver.
        var joined = System.String.Join(",", numbers);
        var trimmed = described.Trim().ToUpperInvariant();

        // LOCK_SUBJECT and THROW_VALUE as statement contexts.
        lock (Field!)
        {
            Field = joined;
        }

        if (n < 0)
        {
            throw error;
        }

        return new object[]
        {
            chosen!, described, moved, text, bag, built, configured, numbers,
            itemType, wrapped, required, joined, trimmed,
            real, verbatim, raw, flag, Doubler, Seeded, Configured, length!,
            named, boxes, picked, nameText, first, second, created,
        };
    }

    public unsafe int Unsafe(int value)
    {
        // ADDRESS_OF and STACKALLOC.
        int* pointer = &value;
        Span<int> scratch = stackalloc int[4];
        scratch[0] = *pointer;
        // SIZEOF, and a FUNCTION POINTER type — legal only here.
        var width = sizeof(int);
        delegate*<int, int> fn = &Scale;
        return scratch[0] + width + fn(1);
    }

    public int[] Slices(int[] xs)
    {
        // RANGE and INDEX operands, and a SPREAD inside a collection expression.
        var middle = xs[1..^1];
        var last = xs[^1];
        int[] all = [..middle, last];
        // The C# 2 ANONYMOUS METHOD, which is a cs_method of its own kind.
        Func<int, int> legacy = delegate (int v) { return v + 1; };
        return [legacy(all.Length)];
    }
}
`,
  // EVERY POSITION a `#if` can select in, with the taken and untaken names
  // deliberately distinguishable.
  //
  // The old branch-selection check looked at TYPES only, and the statement walk
  // resolved every `#if` against an EMPTY symbol set — so inside a body the
  // `#if` branch was never taken and the `#else` always was, in every file,
  // regardless of the configuration the module row names. Not a shortfall, an
  // INVERSION: the fact base described the program that was not selected.
  //
  // One position covered is not the invariant. This file is the invariant.
  'Branches.cs': `namespace Acme.Branch;

using System;

#if NET8_0
public class TakenType { }
#else
public class SkippedType { }
#endif

// Fork rule 22: a base-list CONTINUATION under #if, leading comma. Under
// net8.0 the taken arm adds ITakenBase; the untaken arm's ISkippedBase is
// not a heritage row.
// Fork rule 32: a declaration HEADER under #if, the body after the #endif.
// Under net8.0 the class is HeaderTaken with two bases; the untaken arm's
// name and base are not in the program. The same on a method and on a
// constructor whose ': this()' follows the #endif.
#if NET8_0
public sealed partial class HeaderTaken : System.IDisposable, ITakenBase
#else
public sealed partial class HeaderSkipped : System.IDisposable
#endif
{
    public void Dispose() { }
#if NET8_0
    public void Process(string t, System.ReadOnlySpan<char> takenSpan)
#else
    public void Process(string t, char[] skippedArray)
#endif
    {
        HeaderCall(1);
    }
#if NET8_0
    public HeaderTaken(int takenParam)
#else
    public HeaderTaken(string skippedParam)
#endif
        : this()
    {
        HeaderCall(2);
    }
    public HeaderTaken() { }
    private void HeaderCall(int n) { }
    // Fork rule 34: C# 14's null-conditional assignment is an assignment.
    public void Conditional(HeaderTaken? other, int[]? arr)
    {
        other?.Field = 1;
        arr?[0] = 2;
    }
    public int Field;
    // Fork rule 33: the BCL's safe modifier.
    public safe int SafeField;
}
public class ContinuedBase : System.IDisposable
#if NET8_0
    , ITakenBase
#else
    , ISkippedBase
#endif
{
    public void Dispose() { }
}
// Fork rule 29: the TRAILING-comma run — rule 22's other half.
public class FragmentBase : System.IDisposable,
#if NET8_0
    ITakenBase,
#else
    ISkippedBase,
#endif
    ITrailingBase
{
    public void Dispose() { }
}
public interface ITrailingBase { }
public interface ITakenBase { }
public interface ISkippedBase { }

// Fork rule 24: C# 13's anti-constraint, on its own column.
public static class Allows
{
    public static void Accept<T>(T v) where T : allows ref struct { }
    // Fork rule 35: a constraint continuation with a leading comma under #if.
    public static void Continued<T>(T v) where T : notnull
#if NET8_0
        , allows ref struct
#endif
    { }
    // Fork rule 28: the clause under a #if between the signature and the
    // body — the only way a C# 13 constraint ships in a multi-target file.
    public static bool Guarded<T>(T v)
#if NET8_0
        where T : allows ref struct
#else
        where T : struct
#endif
    { return true; }
}

public class BranchHost
{
#if NET8_0
    public void TakenMethod() { }
    public int TakenField;
#else
    public void SkippedMethod() { }
    public int SkippedField;
#endif

    public void Body()
    {
#if NET8_0
        var takenLocal = 1;
        TakenCall(takenLocal);
        if (takenLocal > 0)
        {
            TakenCall(takenLocal);
        }
        Func<int, int> takenLambda = a => TakenCall2(a);
        int TakenLocalFn() => 1;
        takenLambda(TakenLocalFn());
#else
        var skippedLocal = 2;
        SkippedCall(skippedLocal);
        if (skippedLocal > 0)
        {
            SkippedCall(skippedLocal);
        }
        Func<int, int> skippedLambda = b => SkippedCall2(b);
        int SkippedLocalFn() => 2;
        skippedLambda(SkippedLocalFn());
#endif
    }

    // A #if in EXPRESSION position — an initializer, an argument, an operand,
    // a return value. The grammar has parsed these since upstream as a
    // preproc_if in the expression's place; the walk emitted NOTHING for any of
    // them, neither branch and no gap: the whole initializer vanished.
    public int Expressions()
    {
        var initialized =
#if NET8_0
            TakenInit(1)
#else
            SkippedInit(1)
#endif
            ;
        TakenOuter(
#if NET8_0
            TakenArg(2)
#else
            SkippedArg(2)
#endif
            );
        var operand = initialized +
#if NET8_0
            TakenOperand(3)
#else
            SkippedOperand(3)
#endif
            ;
        return
#if NET8_0
            TakenReturn(operand)
#else
            SkippedReturn(operand)
#endif
            ;
    }
    private int TakenInit(int n) => n;
    private int SkippedInit(int n) => n;
    private void TakenOuter(int n) { }
    private int TakenArg(int n) => n;
    private int SkippedArg(int n) => n;
    private int TakenOperand(int n) => n;
    private int SkippedOperand(int n) => n;
    private int TakenReturn(int n) => n;
    private int SkippedReturn(int n) => n;

    // A #if splitting a FLUENT CHAIN (CS-CORPUS-30, fork rule 14). Before the
    // rule this was a COHERENT misparse: the receiver became an ERROR sibling
    // and the taken branch held '(ERROR) (invocation ChainSegment())' — a call
    // with no receiver, which read out of its branch would have been a bare
    // FUNCTION_CALL. Now it is the chain it is: ChainSegment is a METHOD_CALL
    // on type, and GetCustomAttributes a METHOD_CALL on that — with the
    // untaken arm absent, and every child inside its parent's span.
    public void Chain(System.Type type)
    {
        // TWO segments in the taken arm: ChainSegment is then an INNER segment
        // whose row is its own node inside the #if, and its span must start at
        // 'type' — the receiver row it parents is above the directive.
        type
#if NET8_0
            .ChainSegment().ChainSecond()
#else
            .SkippedSegment()
#endif
            .GetCustomAttributes(false);
    }

    // The OPERATOR form — 'a #if + b #else - b #endif' — rule 14's second
    // shape: the operator and its right operand are inside the branch. The
    // row is the BINARY 'a + TakenOperator(1)' under net8.0, and the other arm
    // is absent. The first grammar for the chain form let a chain branch be
    // EMPTY, and recovery then closed the #if with a MISSING #endif and read
    // BOTH arms as binary operands of one expression — the untaken branch in
    // the tree, which no emission may contain.
    public int OperatorFragment(int a)
    {
        int t = a
#if NET8_0
            + TakenOperator(1)
#else
            - SkippedOperator(2)
#endif
            ;
        return t;
    }
    private int TakenOperator(int n) => n;
    private int SkippedOperator(int n) => n;

    // The operator form's MIRROR: the branch ENDS with the operator, and the
    // right operand follows the #endif. Thirty-five corpus sites, twenty-nine
    // in the BCL. The row is the BINARY 'TakenHead(1) + a' under net8.0.
    public int HeadFragment(int a)
    {
        int t =
#if NET8_0
            TakenHead(1) +
#else
            SkippedHead(2) -
#endif
            a;
        return t;
    }
    private int TakenHead(int n) => n;
    private int SkippedHead(int n) => n;

    // Fork rule 16: an ELSE clause under #if. The orphaned 'else' is a
    // statement of its own — under net8.0 the IF branch's 'else if' continues
    // the outer if, and the 'else' after the #endif continues THAT. Forty-nine
    // corpus sites; upstream flattened a whole namespace recovering one.
    public int ElseFragment(bool a)
    {
        int r;
        if (a) { r = Other(1); }
#if NET8_0
        else if (!a) { r = TakenElse(2); }
#else
        else if (!a) { r = SkippedElse(3); }
#endif
        else { r = Other(4); }
        return r;
    }
    private int TakenElse(int n) => n;
    private int SkippedElse(int n) => n;
    private int Other(int n) => n;

    // Fork rule 17: a #if in a PARAMETER LIST whose branch holds 'T a,'.
    // Upstream read the #if as the first parameter's attribute list and
    // emitted BOTH branches' parameters — arity 3 for a method of arity 2.
    public int ParamFragment(
#if NET8_0
        int takenParam,
#else
        string skippedParam,
#endif
        out int result)
    {
        result = 0;
        // Fork rule 18: the same in an ARGUMENT LIST. Upstream lost the
        // argument after the #endif into an ERROR of its own.
        return Three(1,
#if NET8_0
            TakenFragArg(2),
#else
            SkippedFragArg(3),
#endif
            4);
    }
    private int Three(int a, int b, int c) => a + b + c;
    private int TakenFragArg(int n) => n;
    private int SkippedFragArg(int n) => n;

    // Fork rule 19: the arrow OUTSIDE the #if, 'expression ;' inside each
    // branch. Rows were already right; the ';' was ERROR debris and the file
    // counted as failing to parse. Rule 20: the same on an initializer.
    public int ArrowTail() =>
#if NET8_0
        TakenTail(1);
#else
        SkippedTail(2);
#endif
    private int _tail =
#if NET8_0
        TakenFieldInit(1);
#else
        SkippedFieldInit(2);
#endif
    private int TakenTail(int n) => n;
    private int SkippedTail(int n) => n;
    private static int TakenFieldInit(int n) => n;
    private static int SkippedFieldInit(int n) => n;

    // Fork rule 21: a #if holding a switch SECTION between two others.
    // Upstream read 'case 2:' inside a statement-level #if as a local of type
    // 'case' plus a labeled statement — no error, and no case label.
    public int SectionFragment(int k)
    {
        switch (k)
        {
            case 1:
                return TakenSection(1);
#if NET8_0
            case 2:
                return TakenSection(2);
#else
            case 3:
                return SkippedSection(3);
#endif
            default:
                return 0;
        }
    }
    private int TakenSection(int n) => n;
    private int SkippedSection(int n) => n;

    // Fork rule 23: an if whose 'else' keyword is the last token of the #if
    // branch, the else body after the #endif. Under net8.0 the if is in the
    // program and its consequence's call with it; the block after the #endif
    // is a block of its own either way.
    public void DanglingIf(bool a)
    {
#if NET8_0
        if (a)
        {
            TakenDangle(1);
        }
        else
#endif
        {
            DangleBody(2);
        }
    }
    private void TakenDangle(int n) { }
    private void DangleBody(int n) { }

    // Fork rule 27: rule 18's shape on switch-EXPRESSION arms.
    public int ArmFragment(int k) => k switch
    {
        1 => TakenArm(1),
#if NET8_0
        2 => TakenArm(2),
#else
        3 => SkippedArm(3),
#endif
        _ => 0,
    };
    private int TakenArm(int n) => n;
    private int SkippedArm(int n) => n;

    // Fork rule 31: MODIFIERS under a #if — 57 corpus sites, 53 in the BCL.
    // Under net8.0 the method is protected internal virtual; the untaken arm's
    // 'private' is not in the program. And a branch of several attribute lists.
#if NET8_0
    protected internal virtual
#else
    private
#endif
    int ModifierFragment() => 1;
#if NET8_0
    [System.Obsolete("taken")]
    [System.ComponentModel.EditorBrowsable(System.ComponentModel.EditorBrowsableState.Never)]
#endif
    public static int TwoAttributes() => 2;

    // Rule 21's LABEL form: a stacked 'case' under #if, the shared statements
    // after the #endif. Under net8.0 the untaken label 8 is not in the
    // program and, with nothing after its #endif, has no section block; the
    // taken label 7 is, and the statements are its section's.
    public int LabelFragment(int k)
    {
        switch (k)
        {
            case 6:
#if FLIP
            case 8:
#endif
#if NET8_0
            case 7:
#endif
                return TakenLabel(k);
            default:
                return 0;
        }
    }
    private int TakenLabel(int n) => n;

    // A yield in the UNTAKEN branch must not make this an iterator.
    public System.Collections.Generic.IEnumerable<int> NotAnIterator()
    {
#if NET8_0
        return new int[0];
#else
        yield return 1;
#endif
    }

    private void TakenCall(int n) { }
    private int TakenCall2(int n) => n;
    private void SkippedCall(int n) { }
    private int SkippedCall2(int n) => n;
}

// A chain keyed on a USER-DEFINED constant, so the gate can run this file
// under two configurations and see the selection FLIP. Under one key alone, a
// walker that always took the first branch would pass the NET8_0 chain and a
// walker that always took the last would pass an inverted one — wrong answers
// must be DIFFERENT failures, and that takes two keys.
public class FlipHost
#if FLIP
    : IFlipOn
#else
    : IFlipOff
#endif
{
#if FLIP
    public void FlipOn() { }
#else
    public void FlipOff() { }
#endif

    // ONE HEADER, A BODY PER TARGET — on a method and on a property. Both are
    // grammar rules of the fork: upstream recovered the method as a property
    // with an ERROR child plus a method named by the next keyword, and the
    // property as a property with an ERROR child plus a stray ERROR.
    public string FlipBody()
#if FLIP
        => FlipOnCall();
#else
        => FlipOffCall();
#endif

    public int FlipProperty
#if FLIP
        => FlipOnCall2();
#else
        { get; set; }
#endif

    private string FlipOnCall() => "";
    private string FlipOffCall() => "";
    private int FlipOnCall2() => 1;
}

public interface IFlipOn { }
public interface IFlipOff { }

public enum BranchEnum
{
#if NET8_0
    TakenMember
#else
    SkippedMember
#endif
}

// A NESTED chain: the inner #if is a CHILD region of the branch it sits in,
// and parentRegionLinkHash names that branch. The only nested chain in the
// gate corpus, so the column was empty on every row until it was added.
public class NestedHost
{
#if NET8_0
    public void OuterTaken() { }
#if FLIP
    public void InnerFlipOn() { }
#else
    public void InnerFlipOff() { }
#endif
#else
    public void OuterSkipped() { }
#endif
}
`,
  // The four adjudicated-against-Roslyn shapes, all in one file so the gate
  // that owns them reads one module.
  //
  // - a pattern binding INVOKED (`if (o is Action act) act();`) is a delegate
  //   invocation — Roslyn says so, and the parser said FUNCTION_CALL because
  //   only three of the six value-binding kinds were consulted;
  // - a local function calling ITSELF and a SIBLING is a LOCAL_FUNCTION_CALL,
  //   and the parser said FUNCTION_CALL because the local function's own body
  //   did not see the enclosing scope's declarations;
  // - a method whose arrow body a #if FRAGMENT splits is recovered by the
  //   grammar as a PROPERTY with an ERROR child; Roslyn says ordinary method,
  //   and the parser emitted get_GetDefaultMessage. A header that is debris
  //   has no kind, and no member row is emitted for it;
  // - a call to a name the parser cannot place stays FUNCTION_CALL. A lookup
  //   miss is DON'T KNOW, and the terminal for don't-know is never the
  //   positive claim.
  'Adjudicated.cs': `namespace Acme.Adj;

using System;

public class Adjudicated
{
    public Adjudicated() : base() { }

    public int Recursion(int n)
    {
        return Factorial(n) + (IsEven(n) ? 1 : 0);

        int Factorial(int x) => x <= 1 ? 1 : x * Factorial(x - 1);

        bool IsEven(int x) => x == 0 || IsOdd(x - 1);

        bool IsOdd(int x) => x != 0 && IsEven(x - 1);
    }

    public void Bindings(object o, Func<int, int> f)
    {
        if (o is Action act)
        {
            act();
        }
        Func<Func<int>, int> applyLambda = g => g();
        applyLambda(() => f(1));
    }

    public void Unknown()
    {
        // Declared NOWHERE in this file. Roslyn would say unbound; the parser
        // must say FUNCTION_CALL and never DELEGATE_INVOKE or LOCAL_FUNCTION_CALL.
        NotDeclaredAnywhere();
    }

    private static string GetDefaultMessage()
#if CORECLR
        => Native();
#else
        => "fallback";
#endif

    private static string Native() => "native";

    public void After() { }

    // SCOPE, adjudicated by Roslyn out of process, 8 of 8. A local function
    // is visible in the BLOCK that declares it and everything nested inside,
    // before and after its declaration — and nowhere else. The static method
    // GetOrAdd on this type is what the calls outside that block bind to.
    private static int GetOrAdd(string key) => key.Length;

    public int Scoped(bool flag)
    {
        var a = GetOrAdd("outer");
        if (flag)
        {
            var b = GetOrAdd("inner-before");
            int GetOrAdd(string k) => k.Length + 1;
            var c = GetOrAdd("inner-after");
            var twice = b;
            a += b + c + twice;
        }
        else
        {
            var twice = GetOrAdd("sibling");
            a += twice;
        }
        a += GetOrAdd("after");
        Func<int, int> scale = n => n * 2;
        Func<int, int> viaLambda = n => scale(n) + Helper(n);
        a += viaLambda(1);
        int Helper(int n) => n + 1;
        return a;
    }
}
`,
  'Identifiers.cs': `namespace Acme.Ident;

public class @class
{
    public int \\u0041bc;
    public void @void(int @int) { }
}

public class Escaped<@T> where @T : class { }
`,
  'Fields.cs': `namespace Acme.Fld;

public unsafe class Fields
{
    public const int ConstOne = 1, ConstTwo = 2;
    private volatile int _volatile;
    protected static readonly System.Collections.Generic.List<int>? Cached;
    internal string? Maybe;
    public required string Needed;
    public new int Hidden;
    public fixed byte Buffer[16];
    private unsafe int* _raw;
}

public enum Values : byte
{
    Implicit,
    Literal = 5,
    Computed = Literal | 2,
}
`,
  // A ZERO-WIDTH node that is NOT marked missing: an accessor whose name the
  // grammar inserted for a bare block inside an accessor list. No ERROR, no
  // isMissing anywhere in the tree — only a width comparison can see it.
  // It WAS an orphaned `else if` inside an `#elif`, until fork rule 16 made
  // that parse; reduced from FileSystemEntry.Unix.cs's recovery, where the
  // shape survives every regime. Balanced, so the fixture gate accepts it.
  'GapZeroWidth.cs': `class GapZeroWidth
{
    private int FullPath
    {
        {
            return 1;
        }
    }
    public int M() { return FullPath; }
}
`,
  // Shape 3: NOTHING locatable. `hasError` is true on the root and on one node
  // that is neither an ERROR nor missing nor zero-width. Reduced from
  // one test file of multitarget-B; 26 files of the corpus had the shape.
  //
  // NOTE the absent trailing newline: with one, this file parses CLEAN. That is
  // how narrow the shape is, and it is why the invariant is gated by re-parsing
  // rather than by trusting a fixture to keep producing it.
  // THE LAST BYTE OF THIS FIXTURE IS LOAD-BEARING. It is `e`, not a newline.
  //
  // A `#pragma` as the LAST LINE of a file with NO TRAILING NEWLINE is the one
  // input that produces SELF_REPORTING_NODE: the root reports an error and no
  // ERROR node, inserted node or zero-width node exists anywhere in the tree —
  // the `preproc_pragma` reports hasError on ITSELF. cs-fixtures probed
  // thirty-six shapes for this value and called it unsynthesizable; every probe
  // ended with a newline. cs-corpus isolated the trigger to the terminator.
  // 9.3% of every file with a parse error in the real corpus, every one a
  // `#pragma warning restore` at the end of a test file.
  //
  // The file is VALID C# — csc accepts it — so this WAS a grammar defect, not
  // broken source, and since fork19 it is fixed: the pragma's terminator is an
  // external token that is a newline OR end of file, and this file parses
  // clean like its control. SELF_REPORTING_NODE is reserved with a zero-row
  // assertion; the last byte is still asserted, because the day the scanner
  // regresses this is the file that reports it. An editor configured to add a
  // final newline would turn it into a second control, which is why the byte
  // is pinned explicitly below.
  'GapUnlocatable.cs': `class GapUnlocatable { void M() { } }
#pragma warning disable`,
  // THE CONTROL: byte-identical but for the trailing newline, and it parses
  // clean. Without it the claim above would be about pragmas rather than about
  // the newline.
  'GapUnlocatableControl.cs': `class GapUnlocatableControl { void M() { } }
#pragma warning disable
`,
  'GapLocal.cs': `namespace Acme.Gap;

public class MostlyFine
{
    public int Good() => 1;
    public int AlsoGood() => 2;
    public int StillGood() => 3;
    public int AndGood() => 4;
    public int Fine() => 5;
    public int Ok() => 6;
    public int Yes() => 7;
    public int Sure() => 8;
    <<<>>>
}
`,
  // Heritage and generics. `class C : A, IB` has no keyword between the two, so
  // BASE_OR_INTERFACE is the honest kind; a struct and an interface cannot have
  // a base class at all, so theirs is INTERFACE_ONLY without resolving anything.
  // Members. Every accessor shape, every parameter mode, the operators and the
  // conversions, and a local function — the declaration a member walk never
  // reaches because it is a statement.
  'Members.cs': `namespace Acme.Mem;

public class Members
{
    public int Auto { get; private set; }
    public int Arrow => _x;
    public required string Req { get; init; }
    public static int Stat { get; set; }
    public int this[int i] { get => 0; set { } }
    // CS-ORACLE-4: an init accessor on an INDEXER is INDEXER_INIT, not
    // INDEXER_SET named init_this[] — init is assignable only during object
    // initialization, and the kind is what a consumer switches on.
    public int this[string key] { get => 0; init { } }
    public event System.EventHandler Simple;
    public event System.EventHandler Pair, Second;
    public event System.EventHandler WithBody { add { } remove { } }
    void IFoo.Explicit() { }
    public static Members operator +(Members a, Members b) => a;
    public static explicit operator int(Members m) => 0;
    public static implicit operator Members(int i) => null;
    static Members() { }
    public Members(int a) { }
    ~Members() { }
    public async System.Threading.Tasks.Task Async() { await Async(); }
    public System.Collections.Generic.IEnumerable<int> Iter() { yield return 1; }
    public partial void PartialDef();
    public void Modes(ref int a, out int b, in int c, params int[] d, int e = 5,
                      scoped System.Span<int> f, scoped ref int g) { b = 0; }
    public void HasLocal() { static int Inner(int q) => q; }
    public T Generic<T>(T t) where T : class => t;
    private int _x;
}

// Every remaining modifier, so the enum audit's verdict on each is a
// measurement rather than a reservation nobody tested.
public abstract class Modifiers : Base
{
    public abstract void Abs();
    public virtual void Virt() { }
    public sealed override void Over() { }
    protected internal void ProtInt() { }
    private protected void PrivProt() { }
    internal void Intern() { }
    private void Priv() { }
    protected void Prot() { }
    public extern void Ext();
    public unsafe void Unsafe() { }
    public new void Hidden() { }
    public ref int RefReturn() => ref _f;
    public void RefRo(ref readonly int x) { }
    private int _f;
}

public readonly struct RoStruct
{
    public readonly int Read() => 0;
}

public static class Extensions
{
    public static int CountThem(this System.Collections.Generic.IEnumerable<int> src) => 0;
}

// The type-reference TREE. C# generics are REIFIED, so List<int> and
// List<string> are distinct runtime types and the argument subtree is part of
// the type's identity, not decoration.
public class TypeShapes
{
    public System.Collections.Generic.Dictionary<string,
        System.Collections.Generic.List<int?>> Nested() => null;
    public void Shapes(int[,] rank2, (int X, string Y) tup, int* ptr, dynamic dyn,
                       string? maybe, int?[] nullableArray) { }
    public ref int Aliased() => ref _n;
    private int _n;
}

public interface IDefaults
{
    int Implicitly();
    int AlsoImplicitly { get; }
}

// A #if INSIDE an accessor list. The grammar does not nest a preproc_if here:
// it absorbs the #if into the first accessor, turns the #elif into an accessor
// NAMED AFTER the preprocessor symbol, and emits #else and #endif as bare
// ERROR siblings. Live in CommunityToolkit, and it made extraction THROW.
public class SplitAccessors
{
    public int Length
    {
#if NET8_0_OR_GREATER
        get => 1;
#elif NETSTANDARD2_1_OR_GREATER
        get => 2;
#else
        get;
#endif
    }
}
`,
  'Generics.cs': `namespace Acme.Gen;

public interface IRepo<in TIn, out TOut, T>
    where T : class, System.IDisposable, new()
    where TIn : struct
{
}

public class Impl<T> : Base<T>, IRepo<int, string, T> where T : notnull { }

// 'unmanaged' is a constraint and NOT a type; since v1.15 it has its own
// boolean and exits before the type-counting branch.
public class Blit<TU> where TU : unmanaged { }

// 'default' (C# 9, the override-disambiguation constraint) is now the ONLY
// keyword that reaches the type-counting branch — the grammar reads it as an
// identifier TYPE — so it is the only input that tells a working guard from a
// dead one. It has no boolean of its own: that ruling is open (CS-CORPUS-31).
public class Overrider : Overridden
{
    public override void Pick<TDef>() where TDef : default { }
}
public class Overridden
{
    public virtual void Pick<TDef>() where TDef : struct { }
}

public struct OnlyInterfaces : System.IDisposable, IThing { }

public interface IExtends : IThing, IOther { }

public class WithArgs(int a) : Base(a), IThing { }

public enum Backed : byte { A }

public record Positional(int X) : Parent(X);

// The base invocation of a GENERIC base with a CALL as its argument, nested,
// with the constraint clause after — the one library shape.
public class Outer
{
    private sealed class Nested<TKey>(TKey[] keys) : Base<TKey>(Make(keys)) where TKey : notnull
    {
        private static TKey Make(TKey[] k) => k[0];
    }
}

// A primary constructor with NO base arguments: no invocation, no row.
public class NoBaseArgs(int a) : IThing { }
`,
};

const SERVICE_VERSION = 'cs-gate-v1';

/**
 * A file PAST tree-sitter's parse ceiling, generated rather than typed.
 *
 * The limit is exactly 32,767 CHARACTERS, established by bisection — not
 * "about 30 KB", and not bytes. Every unit here carries a non-ASCII character
 * (`é`, two bytes, one character), so the byte count and the character count
 * DISAGREE, and a gate that built its must-fail input by size in the wrong
 * unit would find this file under the limit in one and over it in the other.
 * cs-oracle's warning: 32,768 BYTES with any non-ASCII character is fewer than
 * 32,768 characters, so it parses and the assertion never fires.
 *
 * The parser measures in characters and switches to callback parsing at
 * 30,000, so this file takes the callback path. The gate asserts every type
 * after the boundary is present — the failure mode of the direct path is
 * SILENT TRUNCATION, and three of five Python stdlib packages lost declarations
 * to it before the workaround existed.
 */
const LARGE_FILE_TYPE_COUNT = 260;
function generateLargeFile(): string {
  const lines = ['namespace Acme.Large;', ''];
  for (let i = 0; i < LARGE_FILE_TYPE_COUNT; i += 1) {
    lines.push(`// Unité ${i}: café, naïve, façade — chaque ligne porte un caractère non-ASCII.`);
    lines.push(`public class Généré${i}`);
    lines.push('{');
    lines.push(`    public int Valeur${i} => ${i};`);
    lines.push('}');
    lines.push('');
  }
  return lines.join('\n');
}

async function writeCorpus(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
  for (const [name, source] of Object.entries(GATE_CORPUS)) {
    await fsp.writeFile(path.join(dir, name), source, 'utf-8');
  }
  await fsp.writeFile(path.join(dir, 'Large.cs'), generateLargeFile(), 'utf-8');
}

async function runAnalyzer(
  corpusDir: string,
  outputDir: string,
  overrides: Partial<Parameters<CSharpProjectAnalyzer['analyze']>[0]> = {}
): Promise<Awaited<ReturnType<CSharpProjectAnalyzer['analyze']>>> {
  const analyzer = new CSharpProjectAnalyzer();
  return analyzer.analyze({
    rootDir: corpusDir,
    outputDir,
    baseMservPath: corpusDir,
    serviceVersionLink: SERVICE_VERSION,
    targetFrameworks: ['net8.0'],
    defineConstants: [],
    langVersion: '13.0',
    nullableContextDefault: CsNullableContext.ENABLE,
    // What <ImplicitUsings>enable</ImplicitUsings> injects for a net8.0 console
    // or library project. An INPUT — the parser never infers it.
    implicitUsings: ['System', 'System.Linq', 'System.Collections.Generic'],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Reading the fact base back. The relation list is DERIVED FROM THE OUTPUT
// DIRECTORY, never from an array in this file.
//
// A hand-maintained array is how adding a relation once made every FK to it
// read as dangling: the new relation's PKs were not in the list, so every
// reference to one looked unresolvable and the gate reported hundreds of
// failures for a change that broke nothing.
// ---------------------------------------------------------------------------

interface Relation {
  readonly name: string;
  readonly file: string;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

function readRelations(outputDir: string): Relation[] {
  const relations: Relation[] = [];
  for (const file of fs.readdirSync(outputDir).sort()) {
    if (!file.startsWith('all-csharp-') || !file.endsWith('.csv')) {
      continue;
    }
    const text = fs.readFileSync(path.join(outputDir, file), 'utf-8');
    if (text === '') {
      relations.push({ name: file, file, header: [], rows: [] });
      continue;
    }
    const lines = text.split('\n').filter((l) => l !== '');
    relations.push({
      name: file,
      file,
      header: lines[0]!.split('\t'),
      rows: lines.slice(1).map((l) => l.split('\t')),
    });
  }
  return relations;
}

/**
 * Every value that LOOKS like an entity hash, and where it appeared.
 *
 * The prefix vocabulary is `ENTITY_IDENTIFIERS`, so this needs no per-relation
 * FK map and cannot go stale when a relation is added. That is the same
 * derive-it-from-the-data discipline as reading the relation list from the
 * directory, applied one level down.
 */
const CS_PREFIXES = Object.entries(ENTITY_IDENTIFIERS)
  .filter(([key]) => key.startsWith('CS_'))
  .map(([, value]) => value as string)
  // Longest first, so `CS_TYPE_PARAMETER` is not matched as `CS_TYPE`.
  .sort((a, b) => b.length - a.length);

function prefixOf(value: string): string | undefined {
  return CS_PREFIXES.find((p) => value.startsWith(p + '_'));
}

// ---------------------------------------------------------------------------
// CHECKS
// ---------------------------------------------------------------------------

/**
 * The grammar is the patched fork, and the gate that says so CAN fail.
 *
 * Both halves matter. Asserting only that the gate passes proves nothing about
 * the gate — a function that returns unconditionally passes too.
 */
function grammarGate(): number {
  let failures = 0;

  try {
    // Constructing the parser runs the gate. Ordinary C# must parse — that is
    // the half of the gate that says a grammar is installed at all.
    const parser = new CSharpParser();
    const tree = parser.parse('class C { void M(int n) { M(n); } }\n');
    if (tree.rootNode.hasError) {
      failures += fail('ordinary C# parses with an ERROR node — no grammar is installed');
    }
    // `if (async)` is NOT asserted. `async` as an ordinary identifier needs it
    // treated as a contextual keyword, which the published grammar does not do
    // — it is one of the 12 KNOWN_GRAMMAR_LIMITATIONS and has a torture
    // fixture. The gate's job changed with the fork's removal: it no longer
    // asserts a grammar we control, it asserts that every limitation of the one
    // we depend on is STILL a limitation, so an upstream fix fires it.
  } catch (error) {
    failures += fail(`the grammar gate threw on the real grammar: ${(error as Error).message}`);
  }

  // EVERY SHAPE THE GRAMMAR NOW HANDLES, asserted in BOTH directions.
  //
  // Thirty-one negative controls were deleted in one commit because the shapes
  // they mutated a workaround for are read correctly now — the `#if` layer by
  // blanking, the `await`/async-lambda re-reads by the grammar itself. The
  // workarounds stay, dormant, and this is what says they may: a regression
  // fires here and names the file whose control has to come back.
  {
    // The RAW tree-sitter parser behind the wrapper, the same way the negative
    // control below reaches it: `handledShapeRegression` takes a `Parser`
    // because the gate it belongs to runs before the wrapper exists.
    const wrapper = new CSharpParser();
    const parser = new Parser();
    parser.setLanguage((wrapper as unknown as { parser: Parser }).parser.getLanguage());
    for (const handled of SHAPES_THE_GRAMMAR_NOW_HANDLES) {
      const regression = handledShapeRegression(parser, handled);
      if (regression !== undefined) {
        failures += fail(regression.split('\n')[0] ?? regression);
      }
    }
    // AND THE OTHER DIRECTION: the predicate must detect a shape that IS
    // misread. Asserted with an inverted expectation rather than by mutating
    // the list, because the list runs in the parser's CONSTRUCTOR and a
    // mutation there crashes every other check instead of failing one.
    const inverted = handledShapeRegression(parser, {
      what: 'ordinary C# (an inverted expectation, to prove this predicate fires)',
      source: 'class C { void M() { } }\n',
      absent: 'method_declaration',
      dormantWorkaround: 'none — this entry exists to be wrong',
    });
    if (inverted === undefined) {
      failures += fail(
        'NEGATIVE CONTROL FAILED: handledShapeRegression accepted a shape whose forbidden node ' +
          'is present. The grammar-regression half of the gate is inert, and the thirty-one ' +
          'controls deleted on the strength of it have nothing standing behind them.'
      );
    }
  }

  // NEGATIVE CONTROL. A probe the patched grammar cannot parse must make the
  // gate throw. If this does not throw, the gate is incapable of failing and
  // every null result it has ever returned is worthless.
  let threw = false;
  try {
    const bare = new Parser();
    // Reuse the real language, feed it a probe that is not C# at all.
    const real = new CSharpParser();
    bare.setLanguage((real as unknown as { parser: Parser }).parser.getLanguage());
    assertPatchedGrammar(bare, 'class { ??? not c# at all ][ }');
  } catch {
    threw = true;
  }
  if (!threw) {
    failures += fail(
      'NEGATIVE CONTROL FAILED: assertPatchedGrammar accepted a source that cannot parse. ' +
        'The gate cannot return non-null, so its passes mean nothing.'
    );
  }

  return failures;
}

/**
 * Arity is asserted at emit time, and the assertion CAN fire.
 *
 * `decls_base_cs.dl` will carry positional `c0..cN`. A dropped or transposed
 * column produces a file that loads cleanly and means something different in
 * every later column — no type error, no parse error, no failing join.
 */
/**
 * EVERY RELATION EMITS EXACTLY THE COLUMNS `schema.json` DECLARES, in that
 * order, and all twenty-two of them exist.
 *
 * The chain this closes: `gen_decls.py --check` proves the Souffle declarations
 * match the schema, and this proves the EMITTED HEADERS match it too. Schema ->
 * engine declarations -> rows on disk, with nothing unwatched in between.
 *
 * Before this, `arity contract` compared each registry's `ARITY` constant
 * against its OWN header — for two of the twenty-two relations — so a column
 * added in code and not in the schema passed, a column reordered in the schema
 * and not in the code passed, and twenty relations were compared against
 * nothing at all. Column ORDER is the contract with the engine: the `.dl`
 * carries only `c0..cN`, so a shifted column loads into Souffle without error
 * and every rule reading past it is silently wrong.
 *
 * The schema is parsed by `gen_decls.py --columns` rather than re-parsed here.
 * A schema with two parsers has two schemas, and the day they disagree neither
 * one is the contract.
 */
/**
 * THE SCHEMA CHAIN HOLDS: schema, engine declarations, emitted rows.
 *
 * `gen_decls.py --check` proves that `decls_base_cs.dl` — the Souffle
 * declarations an engine actually reads — matches `schema.json`, and it
 * asserts on the way through the two invariants the retired ruling document's
 * self-check carried: no relation repeats a column name, and every relation
 * ends in the `isExternal, serviceVersionLinkHash, <own hash>` trailer. C# had
 * no `.dl` at all while Python, TypeScript and JavaScript each had one, so the
 * engine had nothing to declare C# relations with.
 *
 * The other link, emitted headers against the schema, is its own check because
 * it needs the analyzer's output directory.
 */
function theSchemaChainHolds(): number {
  let failures = 0;
  for (const [what, script, args] of [
    ['the .dl matches schema.json', path.join('src', 'schema', 'csharp', 'gen_decls.py'), ['--check']],
  ] as const) {
    const run = spawnSync('python3', [script, ...args], { encoding: 'utf-8' });
    if (run.status !== 0) {
      failures += fail(
        `${what}: ${path.basename(script)} exited ${run.status} — ` +
          `${(run.stdout || run.stderr || '').trim().split('\n').slice(0, 3).join(' | ').slice(0, 400)}`
      );
    }
  }
  return failures;
}

function emittedHeadersMatchTheSchema(outputDir: string): number {
  let failures = 0;
  const generator = path.join('src', 'schema', 'csharp', 'gen_decls.py');
  const run = spawnSync('python3', [generator, '--columns'], { encoding: 'utf-8' });
  if (run.status !== 0) {
    return fail(
      `gen_decls.py --columns exited ${run.status}: ${(run.stderr || run.stdout || '').trim().slice(0, 300)}`
    );
  }
  const schema = new Map<string, string[]>();
  for (const line of run.stdout.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    const [relation, columns] = line.split('\t');
    schema.set(relation!, (columns ?? '').split(','));
  }
  if (schema.size !== 22) {
    failures += fail(`the schema document declares ${schema.size} relations, expected 22`);
  }
  // relation name -> the file the analyzer writes. Mirrors RELATION_FILES; a
  // relation the parser does not write at all is the failure this catches.
  const fileFor = (relation: string): string =>
    'all-csharp-' +
    ({
      cs_module: 'modules',
      cs_type: 'types',
      cs_type_heritage: 'type-heritages',
      cs_type_parameter: 'type-parameters',
      cs_method: 'methods',
      cs_method_parameter: 'method-parameters',
      cs_property: 'properties',
      cs_event: 'events',
      cs_type_reference: 'type-references',
      cs_using: 'usings',
      cs_parse_gap: 'parse-gaps',
      cs_field: 'fields',
      cs_enum_member: 'enum-members',
      cs_expression: 'expressions',
      cs_call_site: 'call-sites',
      cs_query_clause: 'query-clauses',
      cs_block: 'blocks',
      cs_variable: 'variables',
      cs_attribute: 'attributes',
      cs_attribute_argument: 'attribute-arguments',
      cs_comment: 'comments',
      cs_preproc_region: 'preproc-regions',
    }[relation] ?? relation) +
    '.csv';
  for (const [relation, columns] of schema) {
    const file = path.join(outputDir, fileFor(relation));
    if (!fs.existsSync(file)) {
      failures += fail(
        `${relation} is declared in the schema and ${fileFor(relation)} does not exist. A ` +
          'relation the engine declares and the parser never writes is a dangling input.'
      );
      continue;
    }
    const header = fs.readFileSync(file, 'utf-8').split('\n')[0]?.split('\t') ?? [];
    if (header.length !== columns.length) {
      failures += fail(
        `${relation}: the schema declares ${columns.length} columns and the emitted header has ` +
          `${header.length}. The .dl declares c0..c${columns.length - 1}, so the surplus or ` +
          'missing column shifts every rule reading past it.'
      );
      continue;
    }
    for (let i = 0; i < columns.length; i += 1) {
      if (header[i] !== columns[i]) {
        failures += fail(
          `${relation} column ${i}: the schema says \`${columns[i]}\` and the parser emits ` +
            `\`${header[i]}\`. Column ORDER is the contract; a rename is free after the freeze ` +
            'and a reorder is not.'
        );
        break;
      }
    }
  }
  return failures;
}

function arityContract(): number {
  let failures = 0;

  const module = sampleModule();
  const type = sampleType(module.getHash());

  for (const [relation, arity, row] of [
    ['cs_module', CsModuleRegistry.ARITY, module],
    ['cs_type', CsTypeRegistry.ARITY, type],
  ] as const) {
    const headerWidth = row.getCsvHeader().split('\t').length;
    const rowWidth = row.toCsv().split('\t').length;
    if (headerWidth !== arity) {
      failures += fail(`${relation}: header has ${headerWidth} columns, ARITY says ${arity}`);
    }
    if (rowWidth !== arity) {
      failures += fail(`${relation}: row has ${rowWidth} columns, ARITY says ${arity}`);
    }
  }

  // NEGATIVE CONTROL — joinRow must refuse a row of the wrong width.
  let threw = false;
  try {
    joinRow(['a', 'b'], 3, 'cs_negative_control');
  } catch {
    threw = true;
  }
  if (!threw) {
    failures += fail(
      'NEGATIVE CONTROL FAILED: joinRow accepted 2 columns where 3 were declared. ' +
        'The emit-side arity check is inert.'
    );
  }

  return failures;
}

/**
 * Every primary key is unique.
 *
 * **Duplicate keys do not collide. They DOUBLE.** A construct reached by two
 * visit paths produces identical owner, role and position and therefore an
 * identical PK, and the row count quietly doubles with nothing looking wrong.
 * This is the check that says so.
 */
/**
 * EVERY CHILD'S SPAN IS INSIDE ITS PARENT'S — cs-oracle's ruling on
 * CS-CORPUS-22, generalised: for every expression row with a parent, and every
 * block with a parent block, the child's [start, end] lies within the
 * parent's. Corpus-wide, no shape named.
 *
 * What it does NOT do, measured by cs-fixtures at the defect's own commit: it
 * did not catch CS-CORPUS-22. `new Foo<T>(x) { … }` parsed as two comparisons
 * and a cast, with no error node — and a wrong parse does not strand
 * children, it builds an internally consistent tree: the initializer's
 * elements hung off the CAST the bad parse invented, and every one was inside
 * its wrong parent. 0 violations before the fix and 0 after. Containment is a
 * real invariant over a real class (a parent whose SPAN stops early, as the
 * two controls below make happen); it is not the catch for that one.
 *
 * What did discriminate, from cs-fixtures — two facts impossible in valid C#,
 * five sites before the fix and zero after: an INITIALIZER row is never the
 * child of a CAST (a cast's operand is a value, and `{ … }` is not one), and
 * an OBJECT_CREATION never ends on an identifier character (it ends on `)`,
 * `}`, `>` or `]`; ending on a letter means the row stopped at its type name).
 * Both asserted here, over every row, against the fixture text the suite
 * holds.
 */
function spansNest(outputDir: string): number {
  let failures = 0;
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  {
    const expressions = relations.get('all-csharp-expressions.csv');
    const modules = relations.get('all-csharp-modules.csv');
    if (expressions === undefined || modules === undefined || expressions.header.length === 0) {
      failures += fail('all-csharp-expressions.csv or all-csharp-modules.csv is missing');
    } else {
      const e = (n: string): number => expressions.header.indexOf(n);
      const ePk = expressions.header.length - 1;
      const byPk = new Map(expressions.rows.map((r) => [r[ePk]!, r]));
      const initializersUnderCast = expressions.rows.filter(
        (r) => r[e('kind')] === 'INITIALIZER' && byPk.get(r[e('parentExpressionHash')]!)?.[e('kind')] === 'CAST'
      );
      if (initializersUnderCast.length > 0) {
        const first = initializersUnderCast[0]!;
        failures += fail(
          `${initializersUnderCast.length} INITIALIZER row(s) have a CAST parent (first at ${first[e('startLine')]}:${first[e('startColumn')]}) ` +
            '— impossible in valid C#; `new T<A>(x) { … }` read as a cast of its initializer'
        );
      }
      const fileNameByModule = new Map(modules.rows.map((r) => [r[modules.header.length - 1]!, r[modules.header.indexOf('fileName')]!]));
      const lines = new Map<string, string[]>();
      for (const [name, source] of Object.entries(GATE_CORPUS)) {
        lines.set(name, source.split('\n'));
      }
      let creationsChecked = 0;
      const endingOnIdentifier: string[] = [];
      for (const row of expressions.rows) {
        if (row[e('kind')] !== 'OBJECT_CREATION') {
          continue;
        }
        const fileName = fileNameByModule.get(row[e('csModuleLinkHash')]!) ?? '';
        const text = lines.get(fileName);
        if (text === undefined) {
          continue;
        }
        creationsChecked += 1;
        const line = text[Number(row[e('endLine')]) - 1] ?? '';
        const last = line[Number(row[e('endColumn')]) - 1] ?? '';
        if (/[A-Za-z0-9_]/.test(last)) {
          // The FILE and the offending line, because a span defect is a defect
          // about one construct and a position with no file to look it up in
          // costs a bisection of the whole corpus to recover.
          endingOnIdentifier.push(
            `${fileName} ${row[e('startLine')]}:${row[e('startColumn')]}-${row[e('endLine')]}:${row[e('endColumn')]} ` +
              `ends on "${last}" in: ${line.trim()}`
          );
        }
      }
      if (creationsChecked === 0) {
        failures += fail('NEGATIVE CONTROL FAILED: no OBJECT_CREATION row in a fixture the suite holds the text of');
      }
      if (endingOnIdentifier.length > 0) {
        failures += fail(
          `${endingOnIdentifier.length} of ${creationsChecked} OBJECT_CREATION rows end on an identifier character — e.g. ${endingOnIdentifier[0]} ` +
            '— a creation ends on `)`, `}`, `>` or `]`; ending on a letter means the row stopped at its type name'
        );
      }
    }
  }
  const within = (relationName: string, parentColumn: string, what: string): void => {
    const relation = relations.get(relationName);
    if (relation === undefined || relation.header.length === 0) {
      failures += fail(`${relationName} is missing or empty`);
      return;
    }
    const col = (n: string): number => relation.header.indexOf(n);
    const pk = relation.header.length - 1;
    const byPk = new Map(relation.rows.map((r) => [r[pk]!, r]));
    const pos = (r: readonly string[], line: string, column: string): number =>
      Number(r[col(line)]) * 1_000_000 + Number(r[col(column)]);
    let checked = 0;
    let escaped = 0;
    let example = '';
    for (const row of relation.rows) {
      const parent = byPk.get(row[col(parentColumn)]!);
      if (parent === undefined) {
        continue;
      }
      checked += 1;
      const childStart = pos(row, 'startLine', 'startColumn');
      const childEnd = pos(row, 'endLine', 'endColumn');
      const parentStart = pos(parent, 'startLine', 'startColumn');
      const parentEnd = pos(parent, 'endLine', 'endColumn');
      if (childStart < parentStart || childEnd > parentEnd) {
        escaped += 1;
        if (example === '') {
          example =
            `${row[col('kind')] ?? row[col('blockKind')]} at ${row[col('startLine')]}:${row[col('startColumn')]}-${row[col('endLine')]}:${row[col('endColumn')]} ` +
            `under ${parent[col('kind')] ?? parent[col('blockKind')]} at ${parent[col('startLine')]}:${parent[col('startColumn')]}-${parent[col('endLine')]}:${parent[col('endColumn')]}`;
        }
      }
    }
    if (checked === 0) {
      failures += fail(`NEGATIVE CONTROL FAILED: no ${what} has a parent, so containment was checked on nothing`);
    }
    if (escaped > 0) {
      failures += fail(
        `${escaped} of ${checked} ${what} lie outside their parent's span — e.g. ${example}. A child outside its ` +
          'parent is a parent whose span stopped early: a mis-parse that produced a plausible tree.'
      );
    }
  };
  within('all-csharp-expressions.csv', 'parentExpressionHash', 'expression rows');
  within('all-csharp-blocks.csv', 'parentContainerHash', 'block rows');
  return failures;
}

function pkUniqueness(outputDir: string): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  if (relations.length === 0) {
    return fail('no relation files in the output directory — the check cannot see anything');
  }

  for (const relation of relations) {
    if (relation.header.length === 0) {
      continue;
    }
    const pkColumn = relation.header.length - 1;
    const pkName = relation.header[pkColumn]!;
    if (!pkName.endsWith('UniqueHash')) {
      failures += fail(
        `${relation.name}: last column is "${pkName}", not a …UniqueHash. ` +
          'The trailer convention is isExternal, serviceVersionLinkHash, <entity>UniqueHash.'
      );
      continue;
    }
    const seen = new Map<string, number>();
    for (const row of relation.rows) {
      const key = row[pkColumn]!;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1);
    if (duplicates.length > 0) {
      failures += fail(
        `${relation.name}: ${duplicates.length} duplicated primary key(s), ` +
          `e.g. ${duplicates[0]![0]} appears ${duplicates[0]![1]} times`
      );
    }
  }

  // NEGATIVE CONTROL — the same code path, over a fact base with a planted
  // duplicate, must report it.
  const planted = countDuplicates([
    ['CS_TYPE_aaa'],
    ['CS_TYPE_aaa'],
    ['CS_TYPE_bbb'],
  ]);
  if (planted !== 1) {
    failures += fail(
      `NEGATIVE CONTROL FAILED: a planted duplicate PK was not detected (${planted} found).`
    );
  }

  return failures;
}

function countDuplicates(rows: readonly (readonly string[])[]): number {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = row[row.length - 1]!;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.values()].filter((n) => n > 1).length;
}

/**
 * Every value shaped like an entity hash resolves to a row that declares it.
 *
 * The relation list comes from the output directory and the FK vocabulary comes
 * from `ENTITY_IDENTIFIERS`, so neither can go stale.
 *
 * `CS_DECLARATION_GROUP` is exempt BY DESIGN. It is not a primary key anywhere:
 * N parts of one `partial` type carry the same value and the engine forms the
 * merged type by grouping on it. It has its own prefix precisely so it can
 * never be mistaken for an entity hash in a join — including by this check.
 */
function fkIntegrity(outputDir: string): number {
  let failures = 0;
  const relations = readRelations(outputDir);

  const declared = new Set<string>();
  for (const relation of relations) {
    if (relation.header.length === 0) {
      continue;
    }
    const pkColumn = relation.header.length - 1;
    for (const row of relation.rows) {
      declared.add(row[pkColumn]!);
    }
  }

  if (declared.size === 0) {
    return fail('no primary keys anywhere — the check cannot see anything');
  }

  let referenceCount = 0;
  for (const relation of relations) {
    if (relation.header.length === 0) {
      continue;
    }
    const pkColumn = relation.header.length - 1;
    for (const row of relation.rows) {
      for (let column = 0; column < row.length; column += 1) {
        if (column === pkColumn) {
          continue;
        }
        const value = row[column]!;
        if (value === '') {
          continue;
        }
        const prefix = prefixOf(value);
        if (prefix === undefined || prefix === ENTITY_IDENTIFIERS.CS_DECLARATION_GROUP) {
          continue;
        }
        referenceCount += 1;
        if (!declared.has(value)) {
          failures += fail(
            `${relation.name}.${relation.header[column]}: ${value} resolves to no row`
          );
        }
      }
    }
  }

  // The check must have SEEN something. Zero references and zero failures reads
  // exactly like a clean fact base, and is what a broken reader reports.
  if (referenceCount === 0) {
    failures += fail(
      'NEGATIVE CONTROL FAILED: zero foreign keys examined. A fact base with cs_type ' +
        'rows must contain csModuleLinkHash references, so the reader is broken.'
    );
  }

  return failures;
}

/**
 * Two runs, byte-identical.
 *
 * Non-determinism here is usually directory order or a `Map` iterated in
 * insertion order that depends on it, and it is invisible until a diff of two
 * fact bases is used for anything.
 */
async function determinism(corpusDir: string): Promise<number> {
  let failures = 0;
  const first = await withTempDir(async (dir) => {
    await runAnalyzer(corpusDir, dir);
    return digestDirectory(dir);
  });
  const second = await withTempDir(async (dir) => {
    await runAnalyzer(corpusDir, dir);
    return digestDirectory(dir);
  });

  for (const [name, digest] of first) {
    const other = second.get(name);
    if (other === undefined) {
      failures += fail(`${name}: present in run 1 and absent in run 2`);
    } else if (other !== digest) {
      failures += fail(`${name}: two runs differ (${digest} vs ${other})`);
    }
  }
  for (const name of second.keys()) {
    if (!first.has(name)) {
      failures += fail(`${name}: absent in run 1 and present in run 2`);
    }
  }

  // NEGATIVE CONTROL — the comparator must notice a difference it is shown.
  if (digestOf('a') === digestOf('b')) {
    failures += fail('NEGATIVE CONTROL FAILED: the digest is constant.');
  }

  if (first.size === 0) {
    failures += fail('NEGATIVE CONTROL FAILED: nothing was digested, so nothing was compared.');
  }

  return failures;
}

/**
 * Every part of one `partial` type shares one group key, and single-part groups
 * are NORMAL.
 *
 * The inverted gate: 76.5% of partial identities have exactly one part in
 * source, because the other half is a source-generator output that exists only
 * after a build. A check asserting "every partial group has ≥2 parts" would
 * fail on correct output, so the assertion is the opposite one — parts that
 * belong together group together, and parts that differ in ARITY do not.
 */
function partialGrouping(outputDir: string): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const types = relations.find((r) => r.name === 'all-csharp-types.csv');
  if (types === undefined || types.header.length === 0) {
    return fail('all-csharp-types.csv is missing or empty');
  }

  const column = (name: string): number => types.header.indexOf(name);
  const nameColumn = column('name');
  const arityColumn = column('arity');
  const groupColumn = column('declarationGroupKey');
  const pkColumn = types.header.length - 1;
  const fileLocalColumn = column('isFileLocal');
  const partialColumn = column('isPartial');

  // CONTAINING TYPE BY NAME — register 18. `D` is nested in `C` (Nested.cs),
  // `Inner` in `Documented` (Metadata.cs, where Documented is NOT the first
  // type), and a top-level type has no container. The column was an INTEGRITY
  // read; the first type in the file resolved for every nested type.
  {
    const nameByPk = new Map(types.rows.map((r) => [r[pkColumn]!, r[nameColumn]!]));
    const containerColumn = column('containingTypeLinkHash');
    const categoryColumn = column('typeCategory');
    for (const [name, category, container] of [['D', 'CLASS', 'C'], ['Inner', 'ENUM', 'Documented'], ['Documented', 'CLASS', '']] as const) {
      // Widget.Part1.cs has a CLASS named Inner too; the enum is the one in Documented.
      const rows = types.rows.filter((r) => r[nameColumn] === name && r[categoryColumn] === category);
      if (rows.length !== 1) {
        failures += fail(`${rows.length} ${category} type(s) named ${name}, expected exactly 1`);
        continue;
      }
      const link = rows[0]![containerColumn]!;
      const linked = link === '' ? '' : (nameByPk.get(link) ?? 'no type row');
      if (linked !== container) {
        failures += fail(
          `${name}'s containingTypeLinkHash names ${linked === '' ? 'nothing' : linked} — expected ${container === '' ? 'nothing: it is top-level' : container}`
        );
      }
    }
  }

  if ([nameColumn, arityColumn, groupColumn, fileLocalColumn, partialColumn].includes(-1)) {
    return fail('all-csharp-types.csv is missing a column this check reads');
  }

  const byGroup = new Map<string, (readonly string[])[]>();
  for (const row of types.rows) {
    const group = row[groupColumn]!;
    const existing = byGroup.get(group);
    if (existing === undefined) {
      byGroup.set(group, [row]);
    } else {
      existing.push(row);
    }
  }

  // Widget<T,U> is declared in two files. One group, two rows, two distinct PKs.
  const widgetGroups = [...byGroup.entries()].filter(([, rows]) =>
    rows.some((r) => r[nameColumn] === 'Widget' && r[arityColumn] === '2')
  );
  if (widgetGroups.length !== 1) {
    failures += fail(
      `Widget<T,U> spans ${widgetGroups.length} group(s); two parts of one partial type ` +
        'must share exactly one declarationGroupKey'
    );
  } else {
    const rows = widgetGroups[0]![1];
    if (rows.length !== 2) {
      failures += fail(`Widget<T,U> has ${rows.length} part(s) in the group, expected 2`);
    }
    if (new Set(rows.map((r) => r[pkColumn])).size !== rows.length) {
      failures += fail('the two parts of Widget<T,U> share a primary key — they must not');
    }
  }

  // Widget<T> is a DIFFERENT type. Arity is in the identity; 167 such
  // collisions in the corpus are resolved by it alone.
  const arityOne = types.rows.filter(
    (r) => r[nameColumn] === 'Widget' && r[arityColumn] === '1'
  );
  if (arityOne.length !== 1) {
    failures += fail(`expected exactly one Widget<T> row, found ${arityOne.length}`);
  } else if (
    widgetGroups.length === 1 &&
    arityOne[0]![groupColumn] === widgetGroups[0]![0]
  ) {
    failures += fail(
      'Widget<T> and Widget<T,U> share a declarationGroupKey — arity is not in the identity'
    );
  }

  // `ref struct` — STACK-ONLY. It cannot be boxed, captured by a lambda, held
  // by a class or crossed over an await, and those are constraints on where a
  // value may FLOW. Derived from an anonymous token, and unasserted until the
  // sweep said so.
  const refStructs = types.rows.filter((r) => r[column('isRefLikeStruct')] === 'true');
  if (refStructs.length === 0) {
    failures += fail(
      'no type is marked isRefLikeStruct, though the corpus declares `readonly ref ' +
        'struct Span2`. `ref` is an ANONYMOUS token, not a modifier node.'
    );
  }
  if (types.rows.some((r) =>
    r[column('isRefLikeStruct')] === 'true' &&
    !r[column('typeModifiers')]!.split(',').includes('REF')
  )) {
    failures += fail('isRefLikeStruct and the REF modifier disagree');
  }

  // A PRIMARY CONSTRUCTOR is 2,816 declarations in the corpus and synthesizes
  // one property per parameter on a positional record — members with no
  // declaration syntax anywhere.
  const primaryCtors = types.rows.filter(
    (r) => r[column('hasPrimaryConstructor')] === 'true'
  );
  if (primaryCtors.length === 0) {
    failures += fail('no type is marked hasPrimaryConstructor');
  }
  for (const row of primaryCtors) {
    if (row[column('primaryConstructorArity')] === '0' && row[column('name')] !== 'Empty') {
      failures += fail(
        `${row[column('name')]} has a primary constructor of arity 0 — the arity and the ` +
          'flag are one fact recorded twice'
      );
      break;
    }
  }

  // A SINGLE-PART partial group is normal. Asserting the opposite would fail on
  // 76.5% of the real distribution.
  const onlyHalf = types.rows.filter((r) => r[nameColumn] === 'OnlyHalf');
  if (onlyHalf.length !== 1) {
    failures += fail(`expected one OnlyHalf row, found ${onlyHalf.length}`);
  } else if (onlyHalf[0]![partialColumn] !== 'true') {
    failures += fail('OnlyHalf is declared `partial` and isPartial says otherwise');
  }

  // Two `file class Local` in one namespace are TWO types, not one merged one.
  const fileLocal = types.rows.filter((r) => r[nameColumn] === 'Local');
  if (fileLocal.length !== 2) {
    failures += fail(`expected two file-local Local rows, found ${fileLocal.length}`);
  } else {
    if (fileLocal.some((r) => r[fileLocalColumn] !== 'true')) {
      failures += fail('a `file class` row does not have isFileLocal set');
    }
    if (fileLocal[0]![groupColumn] === fileLocal[1]![groupColumn]) {
      failures += fail(
        '`file class Local` in two files shares a declarationGroupKey — the engine would ' +
          'merge two unrelated types. The scope key must carry the file.'
      );
    }
  }

  return failures;
}

/**
 * No row comes from an inactive `#if` branch.
 *
 * tree-sitter parses both branches and Roslyn parses one. Emitting the union
 * puts code in the fact base that never compiles together, and every difference
 * from the oracle then reads as a parser defect.
 */
function preprocBranchSelection(outputDir: string): number {
  let failures = 0;
  const types = readRelations(outputDir).find((r) => r.name === 'all-csharp-types.csv');
  if (types === undefined || types.header.length === 0) {
    return fail('all-csharp-types.csv is missing or empty');
  }
  const nameColumn = types.header.indexOf('name');
  const names = new Set(types.rows.map((r) => r[nameColumn]!));

  // net8.0 with no explicit defines: NET8_0_OR_GREATER holds, LEGACY does not.
  if (!names.has('Modern')) {
    failures += fail('the ACTIVE #if branch produced no row — `Modern` is missing');
  }
  if (names.has('Old')) {
    failures += fail('`Old` came from an inactive #elif branch');
  }
  if (names.has('Fallback')) {
    failures += fail('`Fallback` came from an inactive #else branch');
  }

  return failures;
}

/**
 * `async` as an identifier survives extraction, not merely parsing.
 *
 * The grammar gate throws when the wrong grammar is installed; this asserts the
 * consequence the gate exists to prevent — that the declaration is still THERE.
 * A gate that throws and a corpus that silently loses rows are two different
 * failures and the second is the expensive one.
 */
/**
 * A BOM is an encoding preamble, not a character of the program.
 *
 * Asserted as a PAIR and against an absolute position, because either alone is
 * weak. Two files that agree with each other would both be wrong if the strip
 * moved positions the other way, and one file checked against a hand-written
 * number is a number someone can quietly update. `BomProbeA.cs` and
 * `BomProbeB.cs` are byte-for-byte the same length and differ only in the last
 * letter of the type name, so the call on line 1 must start at the same column
 * in both AND at the column `indexOf` gives on the source with no BOM in it.
 *
 * It has to be a call on LINE 1. A BOM shifts nothing else: line 2 onwards is
 * unaffected, so a corpus with a BOM on four files in five can look completely
 * healthy while every first-line column in it is one too far right.
 */
/**
 * Every call in an array LENGTH is walked.
 *
 * The length hangs under the creation's TYPE — `array_creation_expression >
 * array_type > array_rank_specifier` — and a type is not an expression, so §7's
 * rule bit: the subtree died before its children were enqueued. Nothing counted
 * short when it did. The creation emitted its row, the type reference emitted
 * its row, and only the call inside the brackets was missing.
 *
 * Asserted on the CALL SITES, not on the edge role, because the role is the
 * mechanism and the call is the fact an engine loses. Five shapes, because each
 * reaches the rank specifier by a different path: one dimension, two dimensions
 * (which must stay in source order), a JAGGED type whose second rank specifier
 * is empty and must contribute nothing, an INITIALIZED array whose length is
 * implicit, and `stackalloc`, which is a different expression kind sharing the
 * same type shape.
 */
/**
 * An accessor's own attributes are emitted, and attributed to the ACCESSOR.
 *
 * `[Intrinsic] get => …` and `{ get; [param: NotNull] set; }` produced no
 * attribute row at all. The accessor node was never registered as a declaration
 * owner, so the attribute extractor never visited it — and `attributeCount` on
 * the accessor said 0, which is consistent with emitting nothing. Two counts
 * agreeing because neither was taken.
 *
 * Four assertions, because the failure has four distinguishable shapes:
 *   - the accessor attributes exist at all;
 *   - they are owned by the ACCESSOR and not by the property, which would put
 *     four `[Obsolete]`s on one member and read as correct in any total;
 *   - `[param: …]` on a setter carries target PARAM — the one route by which
 *     that target reaches a property, and unobserved on 12,054 corpus files;
 *   - the ARROW-bodied member's synthesized getter has NO accessor node, so it
 *     must count zero rather than inherit the member's own attributes.
 */
/**
 * A delegate is named by its `name` field, never by the first identifier.
 *
 * `delegate <type> <name>` puts the RETURN TYPE first, so a bare-identifier
 * return type is the first identifier child of the header and a positional read
 * takes it: `public delegate Exception ExceptionPredicate(Exception ex)` was a
 * delegate called `Exception`.
 *
 * All seven shapes, because only two of them collide and the other five are why
 * it survived: a predefined type (`bool`), `void`, a qualified name
 * (`System.Exception`), a constructed generic and an array type are each a node
 * kind that is not `identifier`. Asserted by NAME SET rather than by count — a
 * count was already right, and the whole defect is that a row had the wrong
 * name in its primary key.
 */
/**
 * C# 14 EXTENSION MEMBERS: the block is flattened and the receiver becomes the
 * `this` parameter it lowers to.
 *
 *     public static class Ext14
 *     {
 *         extension(string source)
 *         {
 *             public string Slug() => source.Trim();
 *             public static string Combine(string a, string b) => a + b;
 *         }
 *     }
 *
 * The model is the COMPILER'S, and it needs no schema column. C# lowers an
 * instance extension member to a static method on the enclosing class whose
 * first parameter is the receiver — which is exactly what a C# 13
 * `this`-parameter extension method already is. So the receiver is emitted as
 * parameter 0 with mode THIS, `isExtension` follows from it unchanged, and the
 * two forms are indistinguishable in the IR because they are indistinguishable
 * at runtime.
 *
 * WHAT IT REPLACED, which is why this could not be left alone: upstream has no
 * rule for the block, so `extension(string source)` parsed as a CONSTRUCTOR of
 * the static class taking one argument — not legal C# — and the members inside
 * became LOCAL_FUNCTIONs. Phantom rows with the wrong kind and the wrong owner,
 * under a 28-byte parse gap that understated the damage enormously. Absent
 * would have been better; wrong was what it was.
 *
 * A STATIC member of a block takes NO receiver, exactly as it does not in
 * C# 13, and `extension(int)` — a type-only receiver — has no parameter node at
 * all. Both are asserted, because giving them a receiver would invent an
 * argument the call site does not pass.
 */
/**
 * A `#if` DIRECTIVE is not part of the declaration it guards.
 *
 * A `#if` around an attribute list becomes the declaration's first CHILD, so the
 * node's own start position is the directive line. A directive is trivia and
 * belongs to no declaration; Roslyn starts a declaration at its first attribute
 * when one is present and at its first modifier otherwise.
 *
 * Both branch states are asserted, and they differ:
 *   TAKEN     the attribute IS in the program — start at the attribute
 *   NOT TAKEN the region is disabled text — start at the modifier, past it
 *
 * And `attributeCount` is asserted beside the span, because the two were
 * inconsistent for a different reason found at the same time: the count read
 * direct `attribute_list` children while the emitter resolved the `#if`
 * wrapper, so a declaration whose attribute sat in a TAKEN branch emitted the
 * attribute row and reported a count of zero — a count and its own rows
 * disagreeing, on one node, in one pass.
 */
/**
 * A call site occupies the same position as the expression it IS.
 *
 * `CS_CALL_SITE` is a pure 1:1 chain off `CS_EXPRESSION` — the schema says a
 * call site IS an expression — so the two cannot sit at different positions.
 * They did, in exactly one shape, because one took its span from the expression
 * ROW and the other from the NODE.
 *
 * Under rule 14 a `#if`-guarded chain segment has its span GRAFTED onto the
 * chain's receiver: `builder.UseX()` begins at `builder`, and that is where
 * Roslyn reports every segment of a chain. The expression row got the graft and
 * the call site did not, so the call site landed on the `#if` branch's own
 * line — three lines from its own expression.
 *
 * Nothing was lost and no count moved. It surfaced only because a comparator
 * anchors on the call site's position and Roslyn anchors on the chain head, so
 * the site read as one LOST call and one PHANTOM one at the same place.
 *
 * Asserted over EVERY call site in the fixture rather than the guarded one:
 * the invariant is 1:1 positional identity, and a check that looked only at the
 * shape that broke would not notice the next shape that breaks it.
 */
/**
 * A `#define`'s symbol is the SYMBOL, not the rest of the line.
 *
 * `preproc_arg` is the raw remainder of the directive, and a trailing comment is
 * part of it:
 *
 *     #define READER_WRITER_LOCK_SLIM   // Platform supports ReaderWriterLockSlim
 *
 * recorded the symbol as `"READER_WRITER_LOCK_SLIM   // Platform supports …"`,
 * which matches no `#if` anywhere. The define was READ — the file-level scan
 * found all seven in the corpus file that showed this — and then filed under a
 * name nothing could reference, so every `#if` guarding one took the WRONG
 * BRANCH.
 *
 * WHAT IT LOOKED LIKE, which is why it took three sweeps to find: no parse
 * error, no lost row, no count out of place. The file emitted a full set of
 * facts from the `#else` arms. It is only visible against an oracle that took
 * the other branch — 114 calls missing and 32 present that should not have
 * been, in one 3,800-line file.
 *
 * Asserted in BOTH directions, because a fix that trimmed too much would pass a
 * one-sided check: the commented define is active, and a symbol that merely
 * shares its prefix is NOT.
 */
/**
 * C# 12's SEMICOLON BODY — the shape whose recovery attributed six
 * declarations to the seventh's name.
 *
 * `public interface ILock : IBase;` has no rule in the published grammar. One
 * in a file gives an ERROR plus a stray top-level `;`; SEVERAL in a file merge
 * into one `class_declaration` named after the LAST of them, with the earlier
 * declarations as ERROR children of its header and the next real type's `{ }`
 * as its body. So the failure is not a missing row but six types collapsed into
 * one with the wrong name — and a count of types would have said 4 where 9
 * belong, which is why this check counts BY NAME and asserts the category of
 * each.
 *
 * Every assertion here is about a type that would not exist, or would exist
 * under another type's name, without the pre-parse rewrite.
 */
/**
 * C# 12's COLLECTION EXPRESSION, which the published grammar has no rule for.
 *
 * Every `[…]` in a value position arrives as `element_binding_expression` — the
 * node for `a?[i]` — so the fact base gained an ELEMENT ACCESS the source does
 * not contain and lost the collection. Only the EMPTY form errors, so the other
 * forms were silent, and the enum audit was the only check that could see them:
 * four values were reserved as unreachable on a belief about the grammar that
 * was false.
 *
 * Asserted in every form, INCLUDING the legal `a?[0]` that must stay an element
 * access — the repair keys on the absent receiver, and a repair that also
 * rewrote the legal form would be the worse defect of the two.
 */
async function aCollectionExpressionIsNotAnIndex(): Promise<number> {
  return withTempDir(async (dir) => {
    const corpus = await fsp.mkdtemp(path.join(os.tmpdir(), 'cs-coll-'));
    const source = `namespace Acme.Coll;

public class Collections
{
    private readonly int[] _none = [];
    public string[] Names { get; set; } = [];

    public void Forms(int[] xs, int[]? maybe)
    {
        int[] empty = [];
        int[] one = [1];
        int[] two = [1, 2];
        int[] spread = [.. xs];
        int[] mixed = [1, .. xs, 3];
        int[][] nested = [[1], [2]];
        // THE LEGAL FORM, which must stay an ELEMENT ACCESS: a null-conditional
        // index binding has a receiver, and that is the whole discriminator.
        var item = maybe?[0];
        // And an ordinary index access, and a RANGE index — neither is a
        // collection and neither is a spread.
        var first = xs[0];
        var slice = xs[1..3];
        var tail = xs[..2];
        Consume(empty, one, two, spread, mixed, nested, item, first, slice, tail);
    }

    private void Consume(int[] a, int[] b, int[] c, int[] d, int[] e, int[][] f, int? g, int h, int[] i, int[] j) { }
}
`;
    await fsp.writeFile(path.join(corpus, 'Collections.cs'), source, 'utf-8');
    await runAnalyzer(corpus, dir);
    const relations = new Map(readRelations(dir).map((r) => [r.name, r]));
    const expressions = relations.get('all-csharp-expressions.csv');
    if (expressions === undefined) {
      return fail('all-csharp-expressions.csv is missing');
    }
    const e = (n: string): number => expressions.header.indexOf(n);
    const onLine = (line: number, kind: string): (readonly string[])[] =>
      expressions.rows.filter((r) => Number(r[e('startLine')]) === line && r[e('kind')] === kind);
    let bad = 0;
    // line, elements, why
    for (const [line, elements, why] of [
      [5, 0, 'an empty collection in a FIELD initializer'],
      [6, 0, 'an empty collection in a PROPERTY initializer'],
      [10, 0, 'an empty collection in a local — the only form that sets hasError'],
      [11, 1, 'one element'],
      [12, 2, 'two elements'],
      [13, 1, 'a spread is ONE element'],
      [14, 3, '1, a spread and 3'],
    ] as const) {
      const rows = onLine(line, 'COLLECTION_EXPRESSION');
      if (rows.length !== 1) {
        bad += fail(
          `line ${line} has ${rows.length} COLLECTION_EXPRESSION row(s), expected 1 — ${why}. ` +
            'The grammar reads it as an element_binding_expression, so a zero here is the ' +
            'repair not firing and a two is it firing twice.'
        );
        continue;
      }
      if (Number(rows[0]![e('argumentCount')]) !== elements) {
        bad += fail(
          `line ${line} reports ${rows[0]![e('argumentCount')]} element(s), expected ${elements} ` +
            `— ${why}. The zero-width identifier the recovery inserts for [] is not an element.`
        );
      }
    }
    // The nested form is THREE collections on one line, and the inner two are
    // elements of the outer one: a container whose elements are containers was
    // where the central unwrap mattered.
    const nested = onLine(15, 'COLLECTION_EXPRESSION');
    if (nested.length !== 3) {
      bad += fail(`\`[[1], [2]]\` produced ${nested.length} COLLECTION_EXPRESSION row(s), expected 3`);
    }
    const nestedElements = nested.filter((r) => r[e('edgeRole')] === 'COLLECTION_ELEMENT');
    if (nestedElements.length !== 2) {
      bad += fail(
        `${nestedElements.length} of the nested collections carry the COLLECTION_ELEMENT role, ` +
          'expected 2 — an element of a collection is not a ROOT'
      );
    }
    // THE ELEMENTS THEMSELVES, which died with their `argument` wrapper when the
    // first version of this repair built its own child list and skipped the
    // central unwrap.
    if (onLine(11, 'LITERAL').length !== 1) {
      bad += fail('`[1]` has no LITERAL element row — the element died with its argument wrapper');
    }
    const spread = onLine(13, 'SPREAD_ELEMENT');
    if (spread.length !== 1 || spread[0]![e('isSpread')] !== 'true') {
      bad += fail(
        `\`[.. xs]\` produced ${spread.length} SPREAD_ELEMENT row(s) ` +
          `[isSpread=${spread[0]?.[e('isSpread')] ?? 'n/a'}], expected 1 with isSpread — the ` +
          'grammar reads a spread as a RANGE'
      );
    }
    // THE LEGAL FORMS, in the same file, unchanged. A repair that took these
    // too would be the worse defect: it would erase real index accesses.
    for (const [line, kind, why] of [
      [18, 'ELEMENT_ACCESS', '`maybe?[0]` is a null-conditional INDEX access — it has a receiver'],
      [21, 'ELEMENT_ACCESS', '`xs[0]` is an ordinary index access'],
      [22, 'ELEMENT_ACCESS', '`xs[1..3]` is an index access whose argument is a range'],
      [23, 'ELEMENT_ACCESS', '`xs[..2]` — a range index starting with `..` is NOT a spread'],
    ] as const) {
      if (onLine(line, kind).length === 0) {
        bad += fail(`line ${line} has no ${kind} row — ${why}`);
      }
      if (onLine(line, 'COLLECTION_EXPRESSION').length !== 0) {
        bad += fail(`line ${line} produced a COLLECTION_EXPRESSION — ${why}`);
      }
      if (onLine(line, 'SPREAD_ELEMENT').length !== 0) {
        bad += fail(`line ${line} produced a SPREAD_ELEMENT — ${why}`);
      }
    }
    // NO PHANTOM NAME. The zero-width identifier inserted for `[]` was emitted
    // as a reference to the empty string, once per site, in 1,368 files.
    const emptyNames = expressions.rows.filter(
      (r) => r[e('kind')] === 'NAME_REFERENCE' && r[e('potentialQualifiedName')] === ''
    );
    if (emptyNames.length !== 0) {
      bad += fail(
        `${emptyNames.length} NAME_REFERENCE row(s) naming the empty string — the identifier ` +
          'the recovery inserted for `[]`, emitted as a reference to a name nothing declares'
      );
    }
    // AND NO GAP for the empty form: the shape is read, so reporting it
    // unreadable would make 1,368 files of the corpus look untrustworthy.
    // NO GAP ROW OF ANY KIND. Every `hasError` in this file comes from a `[]`
    // that the parser reads, so there is nothing to report — and the kind
    // matters: suppressing the INSERTED_NODE row alone moved the report to the
    // SELF_REPORTING_NODE fallback, which described the enclosing node of a
    // file that parsed. 594 holdout files reported a hole that way.
    const gaps = relations.get('all-csharp-parse-gaps.csv');
    if (gaps !== undefined && gaps.rows.length !== 0) {
      bad += fail(
        `${gaps.rows.length} parse gap row(s) [${[...new Set(gaps.rows.map((r) => r[gaps.header.indexOf('gapKind')]))].join(',')}] ` +
          'for a file whose only unreadable shape is one the parser reads — the zero-width ' +
          'identifier of `[]`, reported as a hole in a file that has none'
      );
    }
    return bad;
  });
}

/**
 * `ref partial struct` — a modifier ORDER the grammar cannot read, and the
 * whole type is lost when it meets one.
 *
 * C# allows any order; the grammar takes `ref` only as the last modifier. The
 * pre-parse pass rotates it, which is the same tokens in a different order and
 * the same length — and since nothing records modifier ORDER, the rewrite is
 * invisible in every column. Asserted with the modifier SET intact, because a
 * rotation that lost `ref` would be a value type reported as a reference one.
 */
/**
 * A `#pragma` on the last line of a file with no trailing newline.
 *
 * The `preproc_pragma` node reports `hasError` ON ITSELF — no ERROR node
 * anywhere, nothing else wrong, and the file fully read — so the gap relation's
 * FALLBACK, which exists for exactly the files where nothing is locatable,
 * reported the pragma as the file's defect. 23 of the 945 files in multitarget-A, every
 * one of them complete: the first one looked at had 11 types and 94 methods and
 * a gap row telling a consumer not to trust it.
 *
 * A trailing newline is the most benign rewrite there is — nothing follows it,
 * so no line, column or span can move — and it is asserted here against the
 * file that has one, the file that does not, and a pragma in the middle, so the
 * rewrite cannot be passing by doing nothing.
 */
/**
 * The text the shipped parser hands the grammar, for any check that needs to
 * ask what the grammar sees.
 *
 * FOUR passes now, and the list is the reason this is one function: the gap
 * oracle applied only the first for three commits after the second landed, and
 * reported the files the other three make readable as silent gaps. A check that
 * models the pipeline has to model all of it.
 */
function asShippedPreParse(source: string): string {
  const blanked = blankInactiveRegions(source, resolveFileSymbols('net8.0', ['DEBUG', 'TRACE']));
  const rewritten = reorderRefStructModifiers(rewriteSemicolonBodies(blanked).text).text;
  return rewritten.endsWith('\n') ? rewritten : `${rewritten}\n`;
}

/**
 * A call whose first argument is named `async`, which the grammar reads as a
 * LAMBDA.
 *
 * `async` is a contextual keyword the published grammar cannot read as an
 * identifier anywhere. In an argument position it invents a lambda whose
 * parameters are the CALL'S ARGUMENTS — including the enclosing method's own
 * `bool async` parameter — and the call disappears. 4,783 sites in 143 files of
 * linq-heavy; zero in the other eight codebases, because `bool async` is the linq-heavy stratum's
 * test convention rather than a common spelling.
 *
 * Asserted in four forms and one control, and the control is the important one:
 * the same call with a first argument NOT named `async` parses normally, and
 * must come out identically.
 */
/**
 * NO `preproc_` NODE SURVIVES THE PRE-PARSE PASS.
 *
 * Blanking replaces every directive and every inactive arm with whitespace of
 * identical length, so the grammar never sees a `#if` at all: the text it is
 * handed is ordinary C#. That makes branch selection a PROPERTY of the input
 * rather than a check on the output — the untaken arm is not in the text, so no
 * row can come from it — and it makes every `preproc_*` node type in the tree
 * impossible.
 *
 * This check is what lets that claim be relied on. Six negative controls died
 * of it: each mutated a branch-resolution path so that it would descend into an
 * inactive arm, and not one of them could make a gate fail, because there is no
 * inactive arm in the tree to descend into. A control that cannot fail is
 * either a weak gate or a dead defect class, and the two need opposite
 * actions — deleting the control, or fixing the gate. This says which.
 *
 * Asserted over every fixture the suite has: the inline gate corpus and all 305
 * category fixtures, through the SHIPPED chain.
 */
async function noPreprocNodeSurvives(): Promise<number> {
  const parser = new CSharpParser();
  let failures = 0;
  let checked = 0;
  // The ONLY `preproc_*` nodes that may survive, because none of them is
  // conditional and each carries a fact: `#region` names a fold, `#nullable`
  // sets a context the schema records per declaration, `#pragma` configures
  // diagnostics. An ALLOWLIST rather than a count, so a new conditional form
  // fires this even if an old one stops appearing.
  const MAY_SURVIVE = new Set([
    'preproc_region',
    'preproc_endregion',
    'preproc_arg',
    'preproc_nullable',
    'preproc_pragma',
  ]);
  const found = new Map<string, string>();
  const scan = (name: string, source: string): void => {
    checked += 1;
    const root = parser.getRootNode(parser.parse(asShippedPreParse(source)));
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.type.startsWith('preproc') && !MAY_SURVIVE.has(node.type) && !found.has(node.type)) {
        found.set(node.type, `${name}:${node.startPosition.row + 1}`);
      }
      for (let i = 0; i < node.childCount; i += 1) {
        stack.push(node.child(i)!);
      }
    }
  };
  for (const [name, source] of Object.entries(GATE_CORPUS)) {
    scan(name, source);
  }
  const root = path.join('src', 'test-data', 'csharp');
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.cs')) {
        scan(path.relative(root, full), fs.readFileSync(full, 'utf-8'));
      }
    }
  };
  if (fs.existsSync(root)) {
    walk(root);
  }
  if (checked < 300) {
    return fail(`only ${checked} fixtures scanned; the corpus is not being read`);
  }
  if (found.size > 0) {
    failures += fail(
      `${found.size} preproc node type(s) survived the pre-parse pass: ` +
        [...found].map(([type, where]) => `${type} at ${where}`).join(', ') +
        '. Blanking is what makes branch selection structural; a directive in the tree means ' +
        'some path can still resolve a branch, and the six controls that died of this claim ' +
        'were deleted on the strength of it.'
    );
  }
  return failures;
}

async function aCallIsNotALambda(): Promise<number> {
  return withTempDir(async (dir) => {
    const corpus = await fsp.mkdtemp(path.join(os.tmpdir(), 'cs-asyncarg-'));
    const source = `namespace Acme.AsyncArg;

public abstract class QueryTestBase
{
    public virtual Task TwoArgs(bool async)
        => AssertQuery(async, ss => ss.Set<Gear>());

    public virtual Task ThreeArgs(bool async)
        => AssertQuery(async, 1, ss => ss.Set<Gear>());

    public virtual Task TrailingNamed(bool async)
        => AssertQuery(
            async,
            ss => ss.Set<Gear>().Where(g => g.Name == "x"),
            assertEmpty: true);

    // THE CONTROL: the same call with a first argument that is not a contextual
    // keyword. It parses normally, and the repair must not change it.
    public virtual Task NotAsync(int[] xs)
        => AssertQuery(xs, ss => ss.Set<Gear>());

    protected Task AssertQuery(object a, object b) => Task.CompletedTask;
    protected Task AssertQuery(object a, object b, object c) => Task.CompletedTask;
    protected Task AssertQuery(object a, object b, bool assertEmpty) => Task.CompletedTask;
}

public class Gear { public string? Name { get; set; } }
`;
    await fsp.writeFile(path.join(corpus, 'AsyncArgument.cs'), source, 'utf-8');
    await runAnalyzer(corpus, dir);
    const relations = new Map(readRelations(dir).map((r) => [r.name, r]));
    const calls = relations.get('all-csharp-call-sites.csv');
    const methods = relations.get('all-csharp-methods.csv');
    const parameters = relations.get('all-csharp-method-parameters.csv');
    const expressions = relations.get('all-csharp-expressions.csv');
    if (calls === undefined || methods === undefined || parameters === undefined || expressions === undefined) {
      return fail('a relation this check reads is missing');
    }
    const c = (n: string): number => calls.header.indexOf(n);
    let bad = 0;
    const assertQuery = calls.rows.filter((r) => r[c('calleeName')] === 'AssertQuery');
    if (assertQuery.length !== 4) {
      bad += fail(
        `${assertQuery.length} call(s) to AssertQuery, expected 4 — three with a first ` +
          'argument named `async` and one control. A count of 1 is the three misparsed calls ' +
          'still missing.'
      );
    }
    // The argument COUNTS, per line, because the whole point is that the
    // arguments were read as a lambda's parameters.
    for (const [line, count, why] of [
      [6, 2, '`AssertQuery(async, ss => …)` — the argument and the lambda'],
      [9, 3, '`AssertQuery(async, 1, ss => …)` — a non-name argument in the middle'],
      [12, 2, 'the trailing `assertEmpty: true` is inside the ERROR the grammar left and is NOT recoverable — two of three, and the third is a named absence rather than a guess'],
      [20, 2, 'the control, which the grammar parses normally'],
    ] as const) {
      const row = assertQuery.find((r) => Number(r[c('startLine')]) === line);
      if (row === undefined) {
        bad += fail(`no AssertQuery call on line ${line} — ${why}`);
        continue;
      }
      if (Number(row[c('argumentCount')]) !== count) {
        bad += fail(
          `the AssertQuery call on line ${line} has ${row[c('argumentCount')]} argument(s), ` +
            `expected ${count} — ${why}`
        );
      }
    }
    // NO LAMBDA CARRIES `async` AS A PARAMETER. This is the false fact: the
    // enclosing method's own parameter, filed as a binding of a function that
    // does not exist.
    const lambdaHashes = new Set(
      methods.rows
        .filter((r) => r[methods.header.indexOf('methodKind')] === 'LAMBDA')
        .map((r) => r[methods.header.length - 1]!)
    );
    const asyncOnLambda = parameters.rows.filter(
      (r) =>
        lambdaHashes.has(r[parameters.header.indexOf('csMethodLinkHash')]!) &&
        r[parameters.header.indexOf('name')] === 'async'
    );
    if (asyncOnLambda.length !== 0) {
      bad += fail(
        `${asyncOnLambda.length} lambda parameter(s) named async — the enclosing method's own ` +
          'parameter, read as a binding of the lambda the grammar invented'
      );
    }
    // The real lambdas ARE there, with their own parameter: four `ss` lambdas
    // and one `g`. A repair that dropped the lambda would trade one missing
    // fact for another.
    const lambdaParameterNames = parameters.rows
      .filter((r) => lambdaHashes.has(r[parameters.header.indexOf('csMethodLinkHash')]!))
      .map((r) => r[parameters.header.indexOf('name')]);
    const ssCount = lambdaParameterNames.filter((n) => n === 'ss').length;
    if (ssCount !== 4 || !lambdaParameterNames.includes('g')) {
      bad += fail(
        `the real lambdas have parameters [${lambdaParameterNames.join(',')}] — expected four ` +
          'ss and one g, because the LAST invented parameter is the lambda`s own'
      );
    }
    // And the calls INSIDE the lambda bodies, which is what the swallowed
    // subtree holds: `ss.Set<Gear>()` four times and `Where` once.
    const setCalls = calls.rows.filter((r) => r[c('calleeName')] === 'Set');
    if (setCalls.length !== 4) {
      bad += fail(`${setCalls.length} call(s) to Set, expected 4 — the lambda bodies`);
    }
    // THE SPAN, and it is asserted HERE rather than in `spans nest` because the
    // gate corpus has no shape like this: the repaired call's row is built from
    // the CALLEE IDENTIFIER, whose own span is just the name, so every child it
    // gains — the arguments and the lambda — would lie outside its parent's.
    const e = (n: string): number => expressions.header.indexOf(n);
    const byPk = new Map(expressions.rows.map((r) => [r[expressions.header.length - 1]!, r]));
    let outside = 0;
    for (const row of expressions.rows) {
      const parent = byPk.get(row[e('parentExpressionHash')]!);
      if (parent === undefined) {
        continue;
      }
      const start: [number, number] = [Number(row[e('startLine')]), Number(row[e('startColumn')])];
      const end: [number, number] = [Number(row[e('endLine')]), Number(row[e('endColumn')])];
      const pStart: [number, number] = [Number(parent[e('startLine')]), Number(parent[e('startColumn')])];
      const pEnd: [number, number] = [Number(parent[e('endLine')]), Number(parent[e('endColumn')])];
      const before = (a: [number, number], b: [number, number]): boolean =>
        a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
      if (before(start, pStart) || before(pEnd, end)) {
        outside += 1;
        if (outside === 1) {
          bad += fail(
            `${row[e('kind')]} at ${start[0]}:${start[1]}-${end[0]}:${end[1]} lies outside its ` +
              `parent ${parent[e('kind')]} at ${pStart[0]}:${pStart[1]}-${pEnd[0]}:${pEnd[1]} — a ` +
              'repaired call whose span stayed on its callee name'
          );
        }
      }
    }
    return bad;
  });
}

async function aPragmaAtTheEndIsNotAGap(): Promise<number> {
  return withTempDir(async (dir) => {
    const corpus = await fsp.mkdtemp(path.join(os.tmpdir(), 'cs-pragma-'));
    // NO TRAILING NEWLINE on this one. Written with no final `\n` on purpose:
    // that is the whole shape, and a formatter that adds one would silently
    // turn this fixture into the control below.
    await fsp.writeFile(
      path.join(corpus, 'NoNewline.cs'),
      `namespace Acme.Pragma;
#pragma warning disable 618
public class Legacy
{
    public int Value;
    public int Read() => Value;
}
#pragma warning restore 618`,
      'utf-8'
    );
    await fsp.writeFile(
      path.join(corpus, 'WithNewline.cs'),
      `namespace Acme.Pragma;
#pragma warning disable 618
public class Modern
{
    public int Value;
}
#pragma warning restore 618
`,
      'utf-8'
    );
    await runAnalyzer(corpus, dir);
    const relations = new Map(readRelations(dir).map((r) => [r.name, r]));
    const gaps = relations.get('all-csharp-parse-gaps.csv');
    const types = relations.get('all-csharp-types.csv');
    const methods = relations.get('all-csharp-methods.csv');
    if (gaps === undefined || types === undefined || methods === undefined) {
      return fail('a relation this check reads is missing');
    }
    let bad = 0;
    if (gaps.rows.length !== 0) {
      bad += fail(
        `${gaps.rows.length} parse gap row(s) [${gaps.rows
          .map((r) => `${r[gaps.header.indexOf('gapKind')]}:${r[gaps.header.indexOf('nodeType')]}`)
          .join(',')}] — a pragma on the last line of a file with no trailing newline reports ` +
          'hasError on itself, and the fallback then names it as the file`s defect'
      );
    }
    for (const name of ['Legacy', 'Modern']) {
      if (!types.rows.some((r) => r[types.header.indexOf('name')] === name)) {
        bad += fail(`type ${name} has no row`);
      }
    }
    // The file WITHOUT the newline is the one that mattered, and its members
    // have to be there — a check that only counted gaps would pass on an empty
    // fact base.
    if (!methods.rows.some((r) => r[methods.header.indexOf('name')] === 'Read')) {
      bad += fail('Legacy.Read() has no method row — the file with no trailing newline lost it');
    }
    return bad;
  });
}

async function refIsNotAlwaysLast(): Promise<number> {
  return withTempDir(async (dir) => {
    const corpus = await fsp.mkdtemp(path.join(os.tmpdir(), 'cs-refmod-'));
    const source = `namespace Acme.Ref;

public ref partial struct Entry
{
    public int Length;
    public int Measure() => Length;
}

public unsafe ref partial struct Raw
{
    public int Size;
}

public readonly ref partial struct Frozen
{
    public readonly int Count;
}

public ref partial struct Generic<T> where T : struct
{
    public T Value;
}

// The orders the grammar already accepts, in the same file: a rewrite that
// touched these would be changing text it has no reason to.
public partial ref struct Already
{
    public int X;
}

public readonly ref struct Plain
{
    public readonly int Y;
}

public class NotAStruct
{
    // A 'ref' RETURN and a 'ref' LOCAL, neither of which is a type header. The
    // rewrite is confined to 'ref' followed by modifiers followed by a type
    // keyword, and these are what would break if it were not.
    private int _field;
    public ref int Borrow() => ref _field;
    public void Use() { ref int slot = ref _field; slot = 1; }
}
`;
    await fsp.writeFile(path.join(corpus, 'RefStructs.cs'), source, 'utf-8');
    await runAnalyzer(corpus, dir);
    const relations = new Map(readRelations(dir).map((r) => [r.name, r]));
    const types = relations.get('all-csharp-types.csv');
    const methods = relations.get('all-csharp-methods.csv');
    const fields = relations.get('all-csharp-fields.csv');
    const gaps = relations.get('all-csharp-parse-gaps.csv');
    if (types === undefined || methods === undefined || fields === undefined) {
      return fail('a relation this check reads is missing');
    }
    const t = (n: string): number => types.header.indexOf(n);
    const byName = new Map(types.rows.map((r) => [r[t('name')]!, r]));
    let bad = 0;
    for (const [name, modifiers, arity, why] of [
      ['Entry', ['PUBLIC', 'REF', 'PARTIAL'], 0, 'the plain form: `ref partial struct`'],
      ['Raw', ['PUBLIC', 'REF', 'PARTIAL', 'UNSAFE'], 0, '`unsafe ref partial struct` — two modifiers to jump'],
      ['Frozen', ['PUBLIC', 'REF', 'PARTIAL', 'READONLY'], 0, '`readonly ref partial struct`'],
      ['Generic', ['PUBLIC', 'REF', 'PARTIAL'], 1, 'a rewritten header still carries its type parameter and its constraint'],
      ['Already', ['PUBLIC', 'REF', 'PARTIAL'], 0, 'the order the grammar accepts — untouched, and identical in the fact base'],
      ['Plain', ['PUBLIC', 'REF', 'READONLY'], 0, '`readonly ref struct`, which never needed rewriting'],
    ] as const) {
      const row = byName.get(name);
      if (row === undefined) {
        bad += fail(`type ${name} has NO row — ${why}. The whole type is lost when the header fails.`);
        continue;
      }
      if (row[t('typeCategory')] !== 'STRUCT') {
        bad += fail(`${name} is ${row[t('typeCategory')]}, expected STRUCT — ${why}`);
      }
      const own = new Set((row[t('typeModifiers')] ?? '').split(',').filter((m) => m.length > 0));
      for (const modifier of modifiers) {
        if (!own.has(modifier)) {
          bad += fail(
            `${name} does not carry ${modifier} [has ${[...own].join(',')}] — ${why}. A rotation ` +
              'that dropped a modifier would make a ref struct an ordinary one.'
          );
        }
      }
      if (Number(row[t('arity')]) !== arity) {
        bad += fail(`${name} has arity ${row[t('arity')]}, expected ${arity} — ${why}`);
      }
    }
    // THE MEMBERS, which go with the type: a lost header loses everything in it.
    if (!fields.rows.some((r) => r[fields.header.indexOf('name')] === 'Length')) {
      bad += fail('Entry.Length has no field row — the members go with the header');
    }
    if (!methods.rows.some((r) => r[methods.header.indexOf('name')] === 'Measure')) {
      bad += fail('Entry.Measure() has no method row — the members go with the header');
    }
    // THE `ref` RETURN AND `ref` LOCAL, in the same file and untouched.
    if (!methods.rows.some((r) => r[methods.header.indexOf('name')] === 'Borrow')) {
      bad += fail('`public ref int Borrow()` has no method row — the rewrite reached a ref RETURN');
    }
    const variables = relations.get('all-csharp-variables.csv');
    if (variables !== undefined && !variables.rows.some((r) => r[variables.header.indexOf('name')] === 'slot')) {
      bad += fail('`ref int slot = ref _field` has no variable row — the rewrite reached a ref LOCAL');
    }
    if (gaps !== undefined && gaps.rows.length !== 0) {
      bad += fail(
        `${gaps.rows.length} parse gap row(s) in a file the rotation should make readable ` +
          `[first at line ${gaps.rows[0]?.[gaps.header.indexOf('startLine')] ?? '?'}]`
      );
    }
    return bad;
  });
}

/**
 * A TOP-LEVEL STATEMENT PRECEDES EVERY DECLARATION — that is the language rule,
 * and it is what tells a real top-level program from recovery debris.
 *
 * C# allows top-level statements in one file of a project and requires them to
 * come BEFORE every namespace and type declaration in it. So a
 * `global_statement` that FOLLOWS one is not a statement the language permits
 * there: it is error recovery having ejected something from the declaration
 * above it. Measured in source-generator-B: three library files were flagged as
 * top-level programs, and what had been ejected was METHOD DECLARATIONS —
 * `Task InternalStopListeningAsync(…) { … }` at file scope after a sealed
 * partial class. Two `<Main>$` methods and two synthesised `Program` types in
 * files that contain neither.
 *
 * The file-scope method here is the same shape and the grammar accepts it with
 * NO error, which is what makes the syntactic rule the right instrument: asking
 * whether the file has a parse gap would keep this one and reject nothing.
 *
 * And `cs_module.hasTopLevelStatements` is asserted against the method row,
 * because it was a THIRD reading of the question and disagreed with the other
 * two — three modules said true where two entry points existed.
 */
async function aTopLevelStatementPrecedesEveryDeclaration(): Promise<number> {
  return withTempDir(async (dir) => {
    const corpus = await fsp.mkdtemp(path.join(os.tmpdir(), 'cs-toplevel-'));
    // A REAL top-level program: statements first, then a local function.
    await fsp.writeFile(
      path.join(corpus, 'Program.cs'),
      `using System;

Console.WriteLine(Compute());
var doubled = Compute() * 2;

int Compute() => 21;
`,
      'utf-8'
    );
    // A LIBRARY file with a member at file scope AFTER the type — what recovery
    // leaves behind. No parse error anywhere in it.
    await fsp.writeFile(
      path.join(corpus, 'Ejected.cs'),
      `namespace Acme.Ejected;

public sealed class Speech
{
    public int Started;
}

Task Stop(int token) { return Task.CompletedTask; }
`,
      'utf-8'
    );
    await runAnalyzer(corpus, dir);
    const relations = new Map(readRelations(dir).map((r) => [r.name, r]));
    const modules = relations.get('all-csharp-modules.csv');
    const methods = relations.get('all-csharp-methods.csv');
    const types = relations.get('all-csharp-types.csv');
    if (modules === undefined || methods === undefined || types === undefined) {
      return fail('a relation this check reads is missing');
    }
    const m = (n: string): number => modules.header.indexOf(n);
    let bad = 0;
    const moduleFor = (suffix: string): readonly string[] | undefined =>
      modules.rows.find((r) => (r[m('fileName')] ?? '').endsWith(suffix));
    const program = moduleFor('Program.cs');
    const ejected = moduleFor('Ejected.cs');
    for (const [name, row, want] of [
      ['Program.cs', program, 'true'],
      ['Ejected.cs', ejected, 'false'],
    ] as const) {
      if (row === undefined) {
        bad += fail(`${name} produced no module row`);
        continue;
      }
      if (row[m('hasTopLevelStatements')] !== want) {
        bad += fail(
          `${name}: hasTopLevelStatements is ${row[m('hasTopLevelStatements')]}, expected ${want}. ` +
            'A member the recovery ejected past a type declaration is not a top-level statement, ' +
            'and this column must answer the question the SAME way the `<Main>$` minting does.'
        );
      }
    }
    const entries = methods.rows.filter(
      (r) => r[methods.header.indexOf('methodKind')] === 'TOP_LEVEL_ENTRY_POINT'
    );
    if (entries.length !== 1) {
      bad += fail(
        `${entries.length} TOP_LEVEL_ENTRY_POINT row(s), expected exactly 1 — Program.cs has ` +
          'top-level statements and Ejected.cs does not'
      );
    } else if (
      entries[0]![methods.header.indexOf('csModuleLinkHash')] !==
      program?.[modules.header.length - 1]
    ) {
      bad += fail('the `<Main>$` row belongs to the wrong module');
    }
    const programTypes = types.rows.filter((r) => r[types.header.indexOf('name')] === 'Program');
    if (programTypes.length !== 1) {
      bad += fail(
        `${programTypes.length} synthesised Program type(s), expected exactly 1 — one per file ` +
          'that really has top-level statements'
      );
    }
    // The real program's statements still produce their calls, which is the half
    // a stricter rule could have broken.
    const calls = relations.get('all-csharp-call-sites.csv');
    const compute = calls?.rows.filter(
      (r) => r[calls.header.indexOf('calleeName')] === 'Compute'
    ) ?? [];
    if (compute.length !== 2) {
      bad += fail(
        `${compute.length} call(s) to Compute, expected 2 — the top-level statements' own calls`
      );
    }
    return bad;
  });
}

async function aSemicolonIsABody(): Promise<number> {
  return withTempDir(async (dir) => {
    const corpus = await fsp.mkdtemp(path.join(os.tmpdir(), 'cs-semi-'));
    const source = `namespace Acme.Semi;

using System;

// SEVEN semicolon-bodied declarations, then three ordinary ones. The order
// matters: the merge named the collapsed type after the LAST semicolon body,
// and took the FIRST following body as its own.
[Obsolete]
public sealed class Marker;

public interface ILock : IBase, IOther;

public readonly struct Tag;

public class WithCapacity(int capacity);

public abstract class Deep<T> :
    Base<T>;

public class Constrained<T> where T : struct;

internal partial class Partial;

public interface IBase { }
public interface IOther { }
public class Base<T> { }

public class After
{
    public int Y;
}
`;
    // THE DOCUMENTED REFUSAL, in its own file. The rewrite fires only when the
    // `;` is the last non-whitespace character on its line, so two declarations
    // sharing a line are left to the grammar — rewriting them would move the
    // second one's columns, and a rewrite that moves a recorded position is not
    // this pass's bargain. What the refusal must NOT do is invent: the types
    // are absent, the gap says so, and the stranded semicolon is still not a
    // top-level program.
    const refused = `namespace Acme.Refused;

public class OnOneLine; public class AlsoOnOneLine;
`;
    await fsp.writeFile(path.join(corpus, 'SemicolonBody.cs'), source, 'utf-8');
    await fsp.writeFile(path.join(corpus, 'SemicolonRefused.cs'), refused, 'utf-8');
    await runAnalyzer(corpus, dir);
    const relations = new Map(readRelations(dir).map((r) => [r.name, r]));
    const modules = relations.get('all-csharp-modules.csv');
    if (modules === undefined) {
      return fail('all-csharp-modules.csv is missing');
    }
    const moduleHash = (suffix: string): string =>
      modules.rows.find((r) => (r[modules.header.indexOf('fileName')] ?? '').endsWith(suffix))?.[
        modules.header.length - 1
      ] ?? '';
    const bodyModule = moduleHash('SemicolonBody.cs');
    const refusedModule = moduleHash('SemicolonRefused.cs');
    const types = relations.get('all-csharp-types.csv');
    const methods = relations.get('all-csharp-methods.csv');
    const fields = relations.get('all-csharp-fields.csv');
    const heritages = relations.get('all-csharp-type-heritages.csv');
    const parameters = relations.get('all-csharp-method-parameters.csv');
    if (
      types === undefined ||
      methods === undefined ||
      fields === undefined ||
      heritages === undefined ||
      parameters === undefined
    ) {
      return fail('a relation this check reads is missing');
    }
    const t = (n: string): number => types.header.indexOf(n);
    const bodyTypes = types.rows.filter((r) => r[t('csModuleLinkHash')] === bodyModule);
    const byName = new Map(bodyTypes.map((r) => [r[t('name')]!, r]));
    let bad = 0;
    for (const [name, category, arity, why] of [
      ['Marker', 'CLASS', 0, 'a sealed marker class, the commonest form'],
      ['ILock', 'INTERFACE', 0, 'the category comes from the keyword, and a default of CLASS would invert every marker interface'],
      ['Tag', 'STRUCT', 0, 'a readonly struct with no members is a value type, not a class'],
      ['WithCapacity', 'CLASS', 0, 'a primary constructor and a semicolon body together'],
      ['Deep', 'CLASS', 1, 'a base list spanning two lines — the `;` is not on the keyword`s line'],
      ['Constrained', 'CLASS', 1, 'a `where` clause before the `;`'],
      ['Partial', 'CLASS', 0, 'one part of a partial type, declared with no members at all'],
      ['IBase', 'INTERFACE', 0, 'the first ORDINARY declaration after the run — the merge took its body'],
      ['IOther', 'INTERFACE', 0, 'an ordinary interface'],
      ['Base', 'CLASS', 1, 'an ordinary generic class'],
      ['After', 'CLASS', 0, 'the type that owns the field below'],
    ] as const) {
      const row = byName.get(name);
      if (row === undefined) {
        bad += fail(`type ${name} has NO row — ${why}`);
        continue;
      }
      if (row[t('typeCategory')] !== category) {
        bad += fail(`${name} is ${row[t('typeCategory')]}, expected ${category} — ${why}`);
      }
      if (Number(row[t('arity')]) !== arity) {
        bad += fail(`${name} has arity ${row[t('arity')]}, expected ${arity} — ${why}`);
      }
    }
    if (bodyTypes.length !== 11) {
      bad += fail(
        `${bodyTypes.length} type rows in SemicolonBody.cs, expected 11 — a count that is too ` +
          'LOW is the merge and a count that is too HIGH is a synthesised `Program` type for a ' +
          'file with no top-level statements'
      );
    }
    // The attribute still belongs to the declaration, and the declaration still
    // starts at it: a semicolon body changes the END of a header, not the start.
    const marker = byName.get('Marker');
    if (marker !== undefined && (Number(marker[t('attributeCount')]) !== 1 || Number(marker[t('startLine')]) !== 8)) {
      bad += fail(
        `Marker reports ${marker[t('attributeCount')]} attribute(s) starting at line ` +
          `${marker[t('startLine')]}, expected 1 at line 8 — the [Obsolete] above it`
      );
    }
    // TWO interfaces, not one and not a base class: the base list of a
    // semicolon-bodied declaration is read exactly as any other.
    const lock = byName.get('ILock');
    const lockBases = heritages.rows.filter(
      (r) => r[heritages.header.indexOf('csTypeLinkHash')] === lock?.[types.header.length - 1]
    );
    if (lockBases.length !== 2) {
      bad += fail(`ILock has ${lockBases.length} heritage row(s), expected 2 — \`: IBase, IOther\``);
    }
    // The primary constructor is a METHOD with a PARAMETER, on the type that
    // declared it — not on the type the merge would have named.
    const capacity = byName.get('WithCapacity');
    const ctor = methods.rows.find(
      (r) =>
        r[methods.header.indexOf('csTypeLinkHash')] === capacity?.[types.header.length - 1] &&
        r[methods.header.indexOf('methodKind')] === 'PRIMARY_CONSTRUCTOR'
    );
    if (ctor === undefined) {
      bad += fail('WithCapacity(int capacity) has no PRIMARY_CONSTRUCTOR row');
    } else {
      const own = parameters.rows.filter(
        (r) => r[parameters.header.indexOf('csMethodLinkHash')] === ctor[methods.header.length - 1]
      );
      if (own.length !== 1 || own[0]?.[parameters.header.indexOf('name')] !== 'capacity') {
        bad += fail(
          `WithCapacity's primary constructor has ${own.length} parameter(s) ` +
            `[${own.map((r) => r[parameters.header.indexOf('name')]).join(',')}], expected capacity`
        );
      }
    }
    // THE FIELD'S OWNER is the type that declares it. Under the merge every
    // declaration between the first semicolon body and the next real body was
    // part of one type, so a member's owner was a type it is not in — a link
    // that resolves, to the wrong row.
    const after = byName.get('After');
    const y = fields.rows.find((r) => r[fields.header.indexOf('name')] === 'Y');
    if (y === undefined || y[fields.header.indexOf('csTypeLinkHash')] !== after?.[types.header.length - 1]) {
      bad += fail('the field Y is not owned by After — the declarations merged');
    }
    // NO TOP-LEVEL PROGRAM. The `;` of a semicolon body parsed as a top-level
    // empty statement, and a file with one looked like a program: a `<Main>$`
    // method and a `Program` type that this file does not contain.
    const entry = methods.rows.filter(
      (r) => r[methods.header.indexOf('methodKind')] === 'TOP_LEVEL_ENTRY_POINT'
    );
    if (entry.length !== 0) {
      bad += fail(
        `${entry.length} TOP_LEVEL_ENTRY_POINT row(s) across two files with no top-level ` +
          'statements — a stranded `;` was counted as one. The refused file is where this ' +
          'bites: its semicolons ARE stranded, because the rewrite left them alone.'
      );
    }
    const programTypes = types.rows.filter((r) => r[t('name')] === 'Program');
    if (programTypes.length !== 0) {
      bad += fail(
        `${programTypes.length} synthesised Program type(s) for files that declare none — the ` +
          'owner of top-level statements, invented from a stranded semicolon'
      );
    }
    // AND NO PARSE GAP IN THE REWRITTEN FILE. The rewrite is what makes it
    // ordinary C#; if a gap appears there, the shape stopped being rewritten and
    // the rows above are coming from recovery rather than from a parse.
    const gaps = relations.get('all-csharp-parse-gaps.csv');
    const gapsIn = (module: string): number =>
      gaps === undefined
        ? 0
        : gaps.rows.filter((r) => r[gaps.header.indexOf('csModuleLinkHash')] === module).length;
    if (gapsIn(bodyModule) !== 0) {
      bad += fail(
        `${gapsIn(bodyModule)} parse gap row(s) in SemicolonBody.cs, which the rewrite should ` +
          'make readable'
      );
    }
    // THE REFUSAL, asserted from both ends: the gap is there, and nothing was
    // invented. A refusal that silently produced a type would be worse than the
    // gap, because the gap is visible to a consumer and a wrong type is not.
    if (gapsIn(refusedModule) === 0) {
      bad += fail(
        'SemicolonRefused.cs has NO parse gap. Two declarations on one line are left to the ' +
          'grammar deliberately — if they now parse, the rewrite grew a case it should not ' +
          'have, or the grammar grew a rule and this pass can go.'
      );
    }
    const refusedTypes = types.rows.filter(
      (r) =>
        r[t('csModuleLinkHash')] === refusedModule &&
        ['OnOneLine', 'AlsoOnOneLine'].includes(r[t('name')] ?? '')
    );
    if (refusedTypes.length !== 0) {
      bad += fail(
        `${refusedTypes.length} type row(s) from the REFUSED line. The refusal is a known ` +
          'absence; a row from it would mean the recovery was read as a declaration.'
      );
    }
    return bad;
  });
}

async function aDefineIsItsSymbolNotItsLine(): Promise<number> {
  return withTempDir(async (dir) => {
    const corpus = await fsp.mkdtemp(path.join(os.tmpdir(), 'cs-define-'));
    const source = `#define WITH_COMMENT   // a trailing comment, as real code writes them
#define PLAIN
#undef  UNDEFINED_AGAIN  // and on an undef too

namespace Acme.App;

public class DefineShapes
{
#if WITH_COMMENT
    public int CommentedIsActive() => 1;
#endif
#if PLAIN
    public int PlainIsActive() => 2;
#endif
#if WITH_COMMENT_EXTRA
    public int PrefixMustNotMatch() => 3;
#endif
#if UNDEFINED_AGAIN
    public int UndefIsHonoured() => 4;
#endif
#if WITH_COMMENT
#define DEFINED_IN_A_LIVE_ARM
#else
#define DEFINED_IN_A_DEAD_ARM
#endif
#if DEFINED_IN_A_LIVE_ARM
    public int LiveArmDefineApplies() => 5;
#endif
#if DEFINED_IN_A_DEAD_ARM
    public int DeadArmDefineMustNotApply() => 6;
#endif
}
`;
    await fsp.writeFile(path.join(corpus, 'Defines.cs'), source, 'utf-8');
    await runAnalyzer(corpus, dir, { defineConstants: ['UNDEFINED_AGAIN'] });
    const methods = readRelations(dir).find((r) => r.name === 'all-csharp-methods.csv');
    if (methods === undefined) {
      return fail('all-csharp-methods.csv is missing');
    }
    const names = new Set(methods.rows.map((r) => r[methods.header.indexOf('name')]!));
    let bad = 0;
    for (const [name, want, why] of [
      ['CommentedIsActive', true, 'a `#define` with a trailing comment defines the SYMBOL; the comment is not part of it'],
      ['PlainIsActive', true, 'the control: a define with no comment, which always worked'],
      ['PrefixMustNotMatch', false, 'WITH_COMMENT_EXTRA merely shares a prefix with WITH_COMMENT and is a different symbol — a fix that trimmed to a prefix would pass a one-sided check'],
      ['UndefIsHonoured', false, '`#undef` with a trailing comment must remove the symbol the caller defined'],
      // A `#define` INSIDE A BRANCH applies only if that branch is taken. The
      // symbol set has to evolve as the file is walked, which is what a
      // preprocessor does — resolving the prologue in its own pass applied
      // every `#define` it saw, so `#if A / #define P / #else / #define F /
      // #endif` defined BOTH and every branch keyed on either of them was
      // taken. That defect was found on a corpus (it took old-style-A from 99.546% to
      // 100.000%) and fixed, and nothing in this suite asserted it until a
      // control for it could not fail.
      ['LiveArmDefineApplies', true, 'the define in the TAKEN arm is in the program'],
      ['DeadArmDefineMustNotApply', false, 'the define in the UNTAKEN arm is not, and a pass that applied both would take this branch too'],
    ] as const) {
      if (names.has(name) !== want) {
        bad += fail(
          `${name} is ${names.has(name) ? 'present' : 'absent'} and should be ` +
            `${want ? 'present' : 'absent'} — ${why}`
        );
      }
    }
    return bad;
  });
}

function aCallSiteSitsWhereItsExpressionDoes(outputDir: string): number {
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const calls = relations.get('all-csharp-call-sites.csv');
  const expressions = relations.get('all-csharp-expressions.csv');
  if (calls === undefined || expressions === undefined) {
    return fail('a relation this check reads is missing');
  }
  const byPk = new Map(
    expressions.rows.map((r) => [r[expressions.header.length - 1]!, r])
  );
  const iLink = calls.header.indexOf('csExpressionLinkHash');
  const iCl = calls.header.indexOf('startLine');
  const iCc = calls.header.indexOf('startColumn');
  const iEl = expressions.header.indexOf('startLine');
  const iEc = expressions.header.indexOf('startColumn');
  let bad = 0;
  let checked = 0;
  for (const call of calls.rows) {
    const expression = byPk.get(call[iLink]!);
    if (expression === undefined) {
      bad += fail('a call site names an expression row that does not exist');
      continue;
    }
    checked += 1;
    if (call[iCl] !== expression[iEl] || call[iCc] !== expression[iEc]) {
      bad += fail(
        `a call site is at (${call[iCl]},${call[iCc]}) and its own expression row is at ` +
          `(${expression[iEl]},${expression[iEc]}). A call site IS an expression — one 1:1 ` +
          'chain, one position. A #if-guarded chain segment broke this because the row got ' +
          'rule 14`s span graft and the call site did not.'
      );
    }
  }
  if (checked === 0) {
    return fail('no call site was checked — the corpus produced none, so this proves nothing');
  }
  return bad;
}

async function aDirectiveIsNotPartOfTheDeclaration(): Promise<number> {
  return withTempDir(async (dir) => {
    const corpus = await fsp.mkdtemp(path.join(os.tmpdir(), 'cs-span-'));
    // Line numbers are load-bearing; the fixture is written so they are obvious.
    const source = `namespace Acme.App;            // 1
using System;                  // 2
                               // 3
#if LEGACY                     // 4
[Obsolete]                     // 5
#endif                         // 6
public class NotTaken { }      // 7
                               // 8
#if MODERN                     // 9
[Obsolete]                     // 10
#endif                         // 11
public class Taken { }         // 12
                               // 13
[Obsolete]                     // 14
public class Plain { }         // 15
`;
    await fsp.writeFile(path.join(corpus, 'Spans.cs'), source, 'utf-8');
    await runAnalyzer(corpus, dir, { defineConstants: ['MODERN'] });
    const types = readRelations(dir).find((r) => r.name === 'all-csharp-types.csv');
    if (types === undefined) {
      return fail('all-csharp-types.csv is missing');
    }
    const iName = types.header.indexOf('name');
    const iLine = types.header.indexOf('startLine');
    const iCount = types.header.indexOf('attributeCount');
    let bad = 0;
    for (const [name, line, count, why] of [
      ['NotTaken', 7, 0, 'the #if is NOT taken, so the region is disabled text and the class starts at its modifier'],
      ['Taken', 10, 1, 'the #if IS taken, so the attribute is in the program and the class starts at it — not at the directive on line 9'],
      ['Plain', 14, 1, 'no directive at all; the baseline both cases must agree with'],
    ] as const) {
      const row = types.rows.find((r) => r[iName] === name);
      if (row === undefined) {
        bad += fail(`type ${name} produced no row`);
        continue;
      }
      if (Number(row[iLine]) !== line) {
        bad += fail(`${name} starts at line ${row[iLine]}, expected ${line} — ${why}`);
      }
      if (Number(row[iCount]) !== count) {
        bad += fail(
          `${name} reports attributeCount ${row[iCount]}, expected ${count}. The count must ` +
            'resolve the #if exactly as the attribute EMITTER does, or a row exists that the ' +
            'count on its own owner denies.'
        );
      }
    }
    return bad;
  });
}

/**
 * THE TORTURE CORPUS — one fixture per shape the published grammar gets wrong,
 * and an assertion per fixture that it STILL gets it wrong in the way recorded.
 *
 * Every other front end here has one (`src/test-data/python/torture*`). C# had
 * fixtures for what it supports and nothing for what it does not, which is the
 * half that decides whether a fact base can be trusted.
 *
 * Generated from `KNOWN_GRAMMAR_LIMITATIONS`, so the corpus and the gate cannot
 * drift apart — a shape can only be in one by being in the other.
 *
 * Two assertions, by kind, because the two failure modes are not comparable:
 *
 *   ERROR     the file must produce a `cs_parse_gap` row. The rows are lost and
 *             the loss is RECORDED. That is an acceptable state; a silent one
 *             is not.
 *   MISPARSE  the node a correct parse yields must be absent. This is the
 *             repairable set, and each entry is a standing statement of work:
 *             when an extractor repair lands, its assertion flips and the entry
 *             moves out of this list.
 *
 * It also asserts the corpus is NOT EMPTY and that every manifest entry has a
 * file on disk. A torture suite that silently stops loading its fixtures
 * reports OK about nothing, which is the failure this whole file is written
 * against.
 */
/**
 * A misparsed ref-returning assignment mints no phantom locals.
 *
 * `Local(x) = v;` is an assignment the published grammar reads as a local
 * declaration: the "declarator" is a tuple pattern holding the CALL'S
 * ARGUMENTS, so a walk that trusts it mints a local per argument and a variable
 * of type `Local`. No error is raised. ~3,400 call sites carried this shape
 * across the corpus.
 *
 * THE CONTROLS ARE THE POINT OF THIS CHECK. A detector keyed on "a declarator
 * holding a tuple pattern" would rewrite legitimate deconstructions and invent
 * calls the source never wrote, and inventing an edge is worse than losing one.
 * So the legitimate shapes are asserted UNTOUCHED, and they outnumber the
 * repaired one:
 *
 *   var (a, b) = Pair();   a real deconstruction — `var` is the only type a
 *                          tuple declarator may legally follow, and that is the
 *                          whole discriminator
 *   int x = 1;             an ordinary declaration
 *   (p, q) = Pair();       already an assignment; never a declaration
 *
 * A one-sided version of this check would pass while the parser silently
 * deleted every deconstruction in the corpus.
 */
function noPhantomLocalsFromARefReturningAssignment(outputDir: string): number {
  const variables = readRelations(outputDir).find(
    (r) => r.name === 'all-csharp-variables.csv'
  );
  const modules = readRelations(outputDir).find((r) => r.name === 'all-csharp-modules.csv');
  if (variables === undefined || modules === undefined) {
    return fail('a relation this check reads is missing');
  }
  const module = modules.rows.find((r) =>
    (r[modules.header.indexOf('fileName')] ?? '').endsWith('RefReturningAssignment.cs')
  );
  if (module === undefined) {
    return fail('RefReturningAssignment.cs produced no cs_module row');
  }
  const names = new Set(
    variables.rows
      .filter((r) => r[variables.header.indexOf('csModuleLinkHash')] === module[modules.header.length - 1])
      .map((r) => r[variables.header.indexOf('name')]!)
  );
  let bad = 0;
  for (const phantom of ['instance', 'receiverArg']) {
    if (names.has(phantom)) {
      bad += fail(
        `\`${phantom}\` was emitted as a local. It is an ARGUMENT of a ref-returning call that ` +
          'the published grammar misparsed as a declaration — a binding that resolves nothing, ' +
          'with no error raised.'
      );
    }
  }
  for (const real of ['first', 'second', 'ordinary']) {
    if (!names.has(real)) {
      bad += fail(
        `\`${real}\` is missing. The repair must not touch a legitimate declaration — a ` +
          'detector keyed on the tuple pattern alone would delete every deconstruction in the ' +
          'corpus and this check would still pass without this half.'
      );
    }
  }
  return bad;
}

/**
 * EVERY CATEGORY FIXTURE IS ASSERTED, not merely scanned.
 *
 * `src/test-data/csharp/categories/` holds 305 files across 32 categories —
 * delegates, events, explicit interface implementations, async iterators,
 * collections, patterns. The suite read all of it for ONE question, "is this
 * enum value ever emitted anywhere", and asserted nothing else about it. A
 * corpus that large answering one question is a corpus nobody is checking: a
 * file could stop parsing, or stop producing a single row, and the only symptom
 * would be an enum value quietly going unobserved somewhere else.
 *
 * TypeScript's staging tree is asserted per category; C#'s was not. This closes
 * that, and it is deliberately a per-CATEGORY report rather than one number,
 * because "302 of 305 parse" tells you nothing about which capability broke.
 *
 * Three assertions per category, and the third is the one that catches rot:
 *
 *   1. Every file parses through the SHIPPED pipeline without an ERROR node.
 *      A category fixture is hand-written C# that a released compiler accepts;
 *      if the parser cannot read it, that is a defect and not a known
 *      limitation. The 19 shapes that ARE limitations live in torture/, which
 *      this check deliberately excludes.
 *   2. Every file produces at least one row. A file that parses to nothing is
 *      indistinguishable from a file nobody loaded.
 *   3. The category count is asserted against the directory, so a category
 *      silently disappearing fails rather than reducing the denominator.
 */
async function everyCategoryFixtureIsAsserted(): Promise<number> {
  const root = path.join('src', 'test-data', 'csharp', 'categories');
  if (!fs.existsSync(root)) {
    return fail(`the category corpus is missing at ${root}; 305 fixtures assert nothing`);
  }
  const categories = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (categories.length === 0) {
    return fail('the category corpus has no categories');
  }
  /**
   * Fixtures that exist IN ORDER TO FAIL, each with the reason.
   *
   * Excluded by an explicit list rather than by loosening the check, because a
   * check that tolerates failures cannot tell a deliberate one from a
   * regression — and these are the two directories whose whole purpose is to be
   * unreadable.
   */
  const DELIBERATELY_UNPARSEABLE: ReadonlyMap<string, string> = new Map([
    [
      'proj-noncompiling',
      'source that does not compile, so cs_parse_gap has something to report. A fixture ' +
        'here that PARSED would be the defect.',
    ],
    [
      'proj-grammar-gate',
      'the grammar gate`s own probes — `async` as an identifier, a #pragma at end of file. ' +
        'They are limitation shapes and are asserted in torture/ instead.',
    ],
  ]);
  /**
   * Category fixtures that hit a KNOWN limitation, and which one.
   *
   * These are not defects and not deliberate failures — they are ordinary
   * fixtures that happen to contain one of the 19 shapes the published grammar
   * cannot read. Named individually rather than skipped by pattern, so the list
   * is a statement about the grammar and shrinks as limitations are fixed. When
   * one starts parsing, its entry is stale and should be deleted; the shape's
   * own assertion in torture/ is what notices that.
   */
  const HITS_A_KNOWN_LIMITATION: ReadonlyMap<string, string> = new Map([
    ['AttributeUsages.cs', 'an attribute target `typevar:` — a contextual keyword upstream reads as a type'],
    ['CollectionExpressions.cs', 'a collection expression whose element is a local named `property`'],
    ['ParameterModes.cs', 'a function-pointer type carrying `in`/`out` on its parameters'],
    ['PatternForms.cs', 'a relational pattern combined with `and`/`or`'],
    ['AllowsRefStruct.cs', 'the `allows ref struct` anti-constraint (C# 13)'],
    ['ParamsCollections.cs', '`params` over a collection type (C# 13)'],
    ['Pointers.cs', 'pointer indirection of a cast — `*(int*)p`'],
    ['CallOnTheLeftOfAnAssignment.cs', 'the ref-returning assignment misparse, repair 1 of 7'],
  ]);
  const parser = new CSharpParser();
  const files = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...files(full));
      } else if (entry.name.endsWith('.cs')) {
        out.push(full);
      }
    }
    return out;
  };
  let bad = 0;
  let total = 0;
  let knownHits = 0;
  const broken: string[] = [];
  for (const category of categories) {
    const inCategory = files(path.join(root, category));
    if (inCategory.length === 0) {
      bad += fail(`category ${category} holds no .cs fixture; it asserts nothing`);
      continue;
    }
    for (const file of inCategory) {
      const segments = file.split(path.sep);
      const deliberate = segments.find((seg) => DELIBERATELY_UNPARSEABLE.has(seg));
      if (deliberate !== undefined) {
        continue;
      }
      total += 1;
      const source = fs.readFileSync(file, 'utf-8');
      const tree = parser.getRootNode(
        parser.parse(
          blankInactiveRegions(source, resolveFileSymbols('net8.0', ['DEBUG', 'TRACE']))
        )
      );
      if (tree.hasError) {
        const known = HITS_A_KNOWN_LIMITATION.get(path.basename(file));
        if (known === undefined) {
          broken.push(`${category}/${path.basename(file)}`);
        } else {
          knownHits += 1;
        }
        continue;
      }
      if (tree.namedChildCount === 0) {
        broken.push(`${category}/${path.basename(file)} (parsed to nothing)`);
      }
    }
  }
  if (broken.length > 0) {
    bad += fail(
      `${broken.length} of ${total} category fixtures do not parse or produce nothing, across ` +
        `${categories.length} categories. These are hand-written C# a released compiler ` +
        'accepts — a failure here is a DEFECT, not a known limitation, because every known ' +
        `limitation lives in torture/ instead. First few: ${broken.slice(0, 6).join(', ')}`
    );
  }
  if (total === 0) {
    return fail('no category fixture was read; this check proved nothing');
  }
  // The allowlist must be EARNING its entries. If a limitation gets fixed the
  // fixture starts parsing, its entry goes stale, and an allowlist longer than
  // the failures it explains is the same defect as a control detached from its
  // target.
  if (knownHits !== HITS_A_KNOWN_LIMITATION.size) {
    bad += fail(
      `${knownHits} fixtures hit a known limitation and the allowlist names ` +
        `${HITS_A_KNOWN_LIMITATION.size}. An entry that no longer fires is stale — the ` +
        'limitation was fixed and the fixture is now ordinary. Delete it.'
    );
  }
  return bad;
}

async function theTortureCorpusStillBites(): Promise<number> {
  const manifestPath = path.join('src', 'test', 'csharp-gates', 'torture-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return fail('the torture manifest is missing; the corpus asserts nothing');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
    shapes: { file: string; what: string; kind: string; node: string; withChild?: string }[];
  };
  if (manifest.shapes.length === 0) {
    return fail('the torture manifest is empty; the corpus asserts nothing');
  }
  const parser = new CSharpParser();
  let bad = 0;
  let checkedError = 0;
  let checkedMisparse = 0;
  for (const shape of manifest.shapes) {
    if (!fs.existsSync(shape.file)) {
      bad += fail(`torture fixture ${shape.file} is in the manifest and not on disk`);
      continue;
    }
    const source = fs.readFileSync(shape.file, 'utf-8');
    // THROUGH THE SHIPPED PIPELINE. The parser blanks the `#if` arms this
    // emission does not compile before the grammar sees the text, so asserting
    // against the raw source would describe a parser nobody runs — and did:
    // 29 shapes stopped being limitations the moment blanking landed.
    const root = parser.getRootNode(
      parser.parse(
        blankInactiveRegions(source, resolveFileSymbols('net8.0', ['A', 'DEBUG', 'TRACE']))
      )
    );
    if (shape.kind === 'ERROR') {
      checkedError += 1;
      if (!root.hasError) {
        bad += fail(
          `${shape.what}: the published grammar now parses this cleanly. Delete its entry ` +
            'from KNOWN_GRAMMAR_LIMITATIONS, regenerate the corpus, and claim the rows.'
        );
      }
      continue;
    }
    checkedMisparse += 1;
    // The fixture's own comment is prose; the assertion is the shape.
    if (subtreeContainsType(root, shape.node, shape.withChild)) {
      bad += fail(
        `${shape.what}: a correct parse's ${shape.node} is now present. Either upstream fixed ` +
          'the shape or an extractor repair landed — move it out of KNOWN_GRAMMAR_LIMITATIONS.'
      );
    }
  }
  if (checkedError === 0 || checkedMisparse === 0) {
    return fail(
      `the corpus checked ${checkedError} ERROR and ${checkedMisparse} MISPARSE shapes; both ` +
        'kinds must be exercised or one failure mode has no cover at all'
    );
  }
  return bad;
}

async function extensionMembersAreEmitted(): Promise<number> {
  return withTempDir(async (dir) => {
    const corpus = await fsp.mkdtemp(path.join(os.tmpdir(), 'cs-ext14-'));
    // TWO blocks, with a C# 13 `this`-parameter method beside them.
    //
    // Both real files that use the construct — 2 of ~16,400 corpus files —
    // declare exactly one block, but SEVERAL is where the pass had to be
    // proven: a partial rewrite is the failure mode that loses rows, so this
    // asserts that two blocks both flatten and that members of each are
    // attributed to their own receiver.
    const source = `namespace Acme.App;

public static class Ext14
{
    extension(string source)
    {
        public string Slug() => source.Trim();

        public bool IsBlank => source.Length == 0;
    }

    extension(int value)
    {
        public int Doubled() => value * 2;

        public bool IsZero => value == 0;
    }

    public static string Classic(this string s) => s + "!";
}
`;
    await fsp.writeFile(path.join(corpus, 'Ext14.cs'), source, 'utf-8');
    await runAnalyzer(corpus, dir);
    const relations = new Map(readRelations(dir).map((r) => [r.name, r]));
    const methods = relations.get('all-csharp-methods.csv');
    const properties = relations.get('all-csharp-properties.csv');
    const parameters = relations.get('all-csharp-method-parameters.csv');
    const gaps = relations.get('all-csharp-parse-gaps.csv');
    if (
      methods === undefined ||
      properties === undefined ||
      parameters === undefined ||
      gaps === undefined
    ) {
      return fail('a relation this check reads is missing');
    }
    let bad = 0;
    const mName = methods.header.indexOf('name');
    const mKind = methods.header.indexOf('methodKind');
    const mExt = methods.header.indexOf('isExtension');
    const mParams = methods.header.indexOf('parameterCount');
    const names = methods.rows.map((r) => r[mName]!);

    // 1. THE INSTANCE METHOD IS A MEMBER, AND AN EXTENSION ONE. Before the
    //    flattening pass the block's members were SILENTLY absent — 0 methods
    //    and 0 properties where three rows belong — because the grammar reads
    //    `extension(...)` as a constructor and its body as statements, which a
    //    declaration_list walk never visits.
    const slug = methods.rows.find((r) => r[mName] === 'Slug');
    if (slug === undefined) {
      bad += fail('`Slug`, an instance method of the extension block, is missing');
    } else {
      if (slug[mExt] !== 'true') {
        bad += fail(`Slug.isExtension is ${slug[mExt]}, not true`);
      }
      // The receiver is parameter 0 — the whole model, and what makes the C# 13
      // and C# 14 forms one fact.
      if (slug[mParams] !== '1') {
        bad += fail(`Slug takes ${slug[mParams]} parameters, not the 1 receiver`);
      }
    }

    // 2. THE INSTANCE PROPERTY, and the column that says what it is. Nothing
    //    said so before: cs_property had no isExtension, so an extension
    //    property was indistinguishable from an ordinary property of the static
    //    class — right in owner, name and span, silent on the one fact that
    //    matters.
    const pName = properties.header.indexOf('name');
    const pExt = properties.header.indexOf('isExtension');
    if (pExt === -1) {
      bad += fail('cs_property has no isExtension column');
    }
    const isBlank = properties.rows.find((r) => r[pName] === 'IsBlank');
    if (isBlank === undefined) {
      bad += fail('`IsBlank`, an extension property, produced no cs_property row');
    } else if (isBlank[pExt] !== 'true') {
      bad += fail(`IsBlank.isExtension is ${isBlank[pExt]}, not true`);
    }

    // 3. WHERE THE RECEIVER OF A PROPERTY LIVES — the ruling this shape needed.
    //    On the ACCESSOR, as parameter 0, because the accessor is the static
    //    method the compiler emits: `get_IsBlank(string source)`. A property is
    //    not callable and has no parameter list of its own, so a receiver
    //    column on cs_property would have described a call that does not exist.
    const getter = methods.rows.find((r) => r[mName] === 'get_IsBlank');
    if (getter === undefined) {
      bad += fail('`get_IsBlank`, the extension property`s accessor, is missing');
    } else {
      if (getter[mExt] !== 'true') {
        bad += fail(`get_IsBlank.isExtension is ${getter[mExt]}, not true`);
      }
      if (getter[mParams] !== '1') {
        bad += fail(`get_IsBlank takes ${getter[mParams]} parameters, not the 1 receiver`);
      }
      const qOwner = parameters.header.indexOf('csMethodLinkHash');
      const qThis = parameters.header.indexOf('isThis');
      const qMode = parameters.header.indexOf('parameterMode');
      const qName = parameters.header.indexOf('name');
      const mHash = methods.header.indexOf('csMethodUniqueHash');
      const receiver = parameters.rows.find((r) => r[qOwner] === getter[mHash]);
      if (receiver === undefined) {
        bad += fail('the accessor`s receiver has no cs_method_parameter row');
      } else {
        if (receiver[qName] !== 'source') {
          bad += fail(`the receiver is named ${receiver[qName]}, not source`);
        }
        // BOTH, because isExtension derives from isThis and parameterMode is
        // what a consumer reads: setting one and not the other made the C# 14
        // form distinguishable from the C# 13 one, which is the bug.
        if (receiver[qThis] !== 'true') {
          bad += fail('the receiver is not marked isThis');
        }
        if (receiver[qMode] !== CsEnums.CsParameterMode.THIS) {
          bad += fail(`the receiver mode is ${receiver[qMode]}, not THIS`);
        }
      }
    }

    // 3b. THE SECOND BLOCK IS FLATTENED TOO, with ITS OWN receiver. A pass that
    //     handled the first block and not the second would be the partial
    //     rewrite that loses rows — see the companion check.
    const doubled = methods.rows.find((r) => r[mName] === 'Doubled');
    if (doubled === undefined) {
      bad += fail('`Doubled`, a method of the SECOND extension block, is missing');
    } else if (doubled[mExt] !== 'true') {
      bad += fail(`Doubled.isExtension is ${doubled[mExt]}, not true`);
    }
    const isZero = properties.rows.find((r) => r[pName] === 'IsZero');
    if (isZero === undefined) {
      bad += fail('`IsZero`, a property of the SECOND extension block, is missing');
    } else if (isZero[pExt] !== 'true') {
      bad += fail(`IsZero.isExtension is ${isZero[pExt]}, not true`);
    }
    // Each block`s receiver is its own: the second takes an int, and a receiver
    // leaking across blocks would show up here as a string.
    const qOwner2 = parameters.header.indexOf('csMethodLinkHash');
    const qType2 = parameters.header.indexOf('completeTypeName');
    const mHash2 = methods.header.indexOf('csMethodUniqueHash');
    if (doubled !== undefined) {
      const recv = parameters.rows.find((r) => r[qOwner2] === doubled[mHash2]);
      if (recv === undefined) {
        bad += fail('`Doubled` has no receiver parameter row');
      } else if (recv[qType2] !== 'int') {
        bad += fail(`the second block receiver is ${recv[qType2]}, not int`);
      }
    }

    // 4. NO PHANTOM CONSTRUCTOR. `extension(string source)` matches the
    //    constructor production — a constructor of a STATIC class taking one
    //    argument, which is not legal C# and resolves to nothing. A wrong row
    //    is worse than a missing one, because the missing one shows in a count.
    if (methods.rows.some((r) => r[mKind] === CsEnums.CsMethodKind.CONSTRUCTOR)) {
      bad += fail(
        '`extension(string source)` produced a CONSTRUCTOR row. A static class has no ' +
          'constructor taking an argument; this is the phantom cs-misparse.ts removes.'
      );
    }

    // 5. THE REST OF THE FILE SURVIVES, and the file is now read WHOLE: the
    //    block used to leave parse gaps behind and no longer does.
    if (!names.includes('Classic')) {
      bad += fail(
        '`Classic`, an ordinary C# 13 extension method AFTER the block, is missing — the ' +
          'block`s parse error is running past its own braces and taking the file with it.'
      );
    }
    if (gaps.rows.length !== 0) {
      bad += fail(`the flattened block still leaves ${gaps.rows.length} parse-gap row(s)`);
    }
    return bad;
  });
}

/**
 * A block the grammar's recovery does not present cleanly: the pass declines
 * for the WHOLE FILE, and that is the assertion.
 *
 * The boundary is not the NUMBER of blocks — several flatten fine, which the
 * companion check proves. It is what the recovery makes of each one, and that
 * MEASURED boundary is content-dependent:
 *
 *   a block with two or more members   recovers as a constructor with a `block`
 *                                      child, and flattens
 *   a block with ONE member            does not, and its presence degrades the
 *                                      recovery of its neighbours too
 *   a GENERIC block, `extension<T>(…)` does not — not detected at all
 *
 * So a file mixing the two has blocks the pass can read and blocks it cannot,
 * and blanking only the readable ones is WORSE than blanking none: the
 * unflattened block's ERROR debris swallows the tail of the one that was
 * blanked, and a member the file declares goes missing. Measured at
 * `clean=1, headers=2` for the fixture below — the guard's condition is
 * reachable, which is why its negative control can fire.
 */
async function anUnreadableExtensionBlockLeavesTheFileAlone(): Promise<number> {
  return withTempDir(async (dir) => {
    const corpus = await fsp.mkdtemp(path.join(os.tmpdir(), 'cs-ext14-mixed-'));
    // ONE readable block and ONE unreadable one. The second has a single
    // member, which is the shape the recovery does not present cleanly.
    const source = `namespace Acme.App;

public static class Ext14Mixed
{
    extension(string source)
    {
        public string Slug() => source.Trim();

        public bool IsBlank => source.Length == 0;
    }

    extension(int)
    {
        public static int Zero => 0;
    }
}
`;
    await fsp.writeFile(path.join(corpus, 'Ext14Mixed.cs'), source, 'utf-8');
    await runAnalyzer(corpus, dir);
    const relations = new Map(readRelations(dir).map((r) => [r.name, r]));
    const methods = relations.get('all-csharp-methods.csv');
    const properties = relations.get('all-csharp-properties.csv');
    const gaps = relations.get('all-csharp-parse-gaps.csv');
    if (methods === undefined || properties === undefined || gaps === undefined) {
      return fail('a relation this check reads is missing');
    }
    let bad = 0;
    const pExt = properties.header.indexOf('isExtension');
    const mExt = methods.header.indexOf('isExtension');
    const claimed =
      properties.rows.filter((r) => r[pExt] === 'true').length +
      methods.rows.filter((r) => r[mExt] === 'true').length;
    if (claimed !== 0) {
      bad += fail(
        `${claimed} row(s) claim isExtension in a file whose blocks the pass cannot all ` +
          'read. The pass rewrote PART of the file: either the all-or-nothing guard in ' +
          'cs-extension-block.ts was weakened, or the recovery improved and this check ' +
          'should be inverted to require the rows.'
      );
    }
    // AND THE FILE IS STILL REPORTED AS INCOMPLETE. Declining is only defensible
    // because the absence is RECORDED — a silent absence is the property that
    // made this shape worth fixing in the first place.
    if (gaps.rows.length === 0) {
      bad += fail(
        'a file whose extension blocks were left unflattened produced NO parse gap — its ' +
          'members are absent and nothing says the text was not fully read.'
      );
    }
    return bad;
  });
}

function delegatesAreNamedByTheirNameField(outputDir: string): number {
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const modules = relations.get('all-csharp-modules.csv');
  const types = relations.get('all-csharp-types.csv');
  if (modules === undefined || types === undefined) {
    return fail('a relation this check reads is missing');
  }
  const module = modules.rows.find((r) =>
    (r[modules.header.indexOf('fileName')] ?? '').endsWith('Delegates.cs')
  );
  if (module === undefined) {
    return fail('Delegates.cs produced no cs_module row');
  }
  const moduleHash = module[modules.header.length - 1]!;
  const got = new Set(
    types.rows
      .filter(
        (r) =>
          r[types.header.indexOf('csModuleLinkHash')] === moduleHash &&
          r[types.header.indexOf('typeCategory')] === CsEnums.CsTypeCategory.DELEGATE
      )
      .map((r) => r[types.header.indexOf('name')]!)
  );
  const want = [
    'PredicateOk',
    'ActionOk',
    'QualifiedReturn',
    'ConstructedReturn',
    'BareIdentifierReturn',
    'GenericReturn',
    'ArrayReturn',
  ];
  const missing = want.filter((n) => !got.has(n));
  if (missing.length > 0) {
    return fail(
      `delegates named ${missing.join(', ')} are absent; the names emitted were ` +
        `${[...got].sort().join(', ')}. A delegate whose return type is a bare identifier is ` +
        'named after its RETURN TYPE by a positional read, and the name is in the primary key.'
    );
  }
  return 0;
}

function accessorAttributesAreEmitted(outputDir: string): number {
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const modules = relations.get('all-csharp-modules.csv');
  const attributes = relations.get('all-csharp-attributes.csv');
  const methods = relations.get('all-csharp-methods.csv');
  if (modules === undefined || attributes === undefined || methods === undefined) {
    return fail('a relation this check reads is missing');
  }
  const module = modules.rows.find((r) =>
    (r[modules.header.indexOf('fileName')] ?? '').endsWith('AccessorAttributes.cs')
  );
  if (module === undefined) {
    return fail('AccessorAttributes.cs produced no cs_module row');
  }
  const moduleHash = module[modules.header.length - 1]!;
  const mine = attributes.rows.filter(
    (r) => r[attributes.header.indexOf('csModuleLinkHash')] === moduleHash
  );
  const byOwnerKind = (kind: string): readonly (readonly string[])[] =>
    mine.filter((r) => r[attributes.header.indexOf('ownerKind')] === kind);

  let bad = 0;
  // Four on accessors (two on Both, one on Named's setter, one... no: three)
  const ACCESSOR_ATTRIBUTES = 3;
  const onAccessors = byOwnerKind('METHOD');
  if (onAccessors.length !== ACCESSOR_ATTRIBUTES) {
    bad += fail(
      `${onAccessors.length} of ${ACCESSOR_ATTRIBUTES} accessor attributes emitted. An accessor ` +
        'owns its own attributes; the accessor node was not a declaration owner, so the ' +
        'extractor never visited it and attributeCount agreed with the silence.'
    );
  }
  const onProperties = byOwnerKind('PROPERTY');
  if (onProperties.length !== 1) {
    bad += fail(
      `${onProperties.length} attributes are owned by a PROPERTY; exactly one is. Attributing an ` +
        'accessor`s attribute to its property reads as correct in any total.'
    );
  }
  const iTarget = attributes.header.indexOf('attributeTarget');
  if (!mine.some((r) => r[iTarget] === 'PARAM')) {
    bad += fail(
      '`[param: NotNull] set;` emitted no attribute with target PARAM. That target is ' +
        'unobserved on 12,054 corpus files, and a setter is the only place it reaches a property.'
    );
  }
  // The arrow-bodied member: a synthesized getter with no accessor node.
  const iName = methods.header.indexOf('name');
  const iCount = methods.header.indexOf('attributeCount');
  const arrowGetter = methods.rows.find(
    (r) =>
      r[methods.header.indexOf('csModuleLinkHash')] === moduleHash && r[iName] === 'get_Arrow'
  );
  if (arrowGetter === undefined) {
    bad += fail('the arrow-bodied member produced no synthesized getter');
  } else if (arrowGetter[iCount] !== '0') {
    bad += fail(
      `the synthesized getter of an arrow-bodied member counts ${arrowGetter[iCount]} attributes. ` +
        'It has no accessor node; counting the member`s own would credit them twice.'
    );
  }
  return bad;
}

function arrayLengthsAreWalked(outputDir: string): number {
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const modules = relations.get('all-csharp-modules.csv');
  const calls = relations.get('all-csharp-call-sites.csv');
  const expressions = relations.get('all-csharp-expressions.csv');
  if (modules === undefined || calls === undefined || expressions === undefined) {
    return fail('a relation this check reads is missing');
  }
  const module = modules.rows.find((r) =>
    (r[modules.header.indexOf('fileName')] ?? '').endsWith('ArraySizes.cs')
  );
  if (module === undefined) {
    return fail('ArraySizes.cs produced no cs_module row');
  }
  const moduleHash = module[modules.header.length - 1]!;
  const mine = calls.rows.filter(
    (r) => r[calls.header.indexOf('csModuleLinkHash')] === moduleHash
  );
  const lens = mine.filter((r) => r[calls.header.indexOf('calleeName')] === 'Len');
  let bad = 0;
  // one + two(x2) + jagged + stackalloc = 5. The initialized array has no
  // length expression and must contribute none.
  const EXPECTED_LEN_CALLS = 5;
  if (lens.length !== EXPECTED_LEN_CALLS) {
    bad += fail(
      `${lens.length} of ${EXPECTED_LEN_CALLS} calls inside an array length were walked. ` +
        'The length is under the creation`s TYPE, and a type is not an expression — the ' +
        'rank specifier is dropped whole, with the call inside it, while the creation`s own ' +
        'row and its type reference stay correct and nothing counts short.'
    );
  }
  const sizes = expressions.rows.filter(
    (r) =>
      r[expressions.header.indexOf('csModuleLinkHash')] === moduleHash &&
      r[expressions.header.indexOf('edgeRole')] === CsEnums.CsEdgeRole.ARRAY_SIZE
  );
  // Two dimensions in SOURCE order: `new int[Len(n), Len(n + 1)]` must not swap.
  const twoDim = sizes
    .filter((r) => r[expressions.header.indexOf('startLine')] === String(ARRAY_SIZES_TWO_DIM_LINE))
    .map((r) => Number(r[expressions.header.indexOf('startColumn')]));
  if (twoDim.length === 2 && twoDim[0]! > twoDim[1]!) {
    bad += fail(
      'the two dimensions of `new int[Len(n), Len(n + 1)]` are not in source order; ' +
        '`new byte[W(), H()]` would not say which is which'
    );
  }
  return bad;
}

/** The line of `new int[Len(n), Len(n + 1)]` in the ArraySizes.cs fixture. */
const ARRAY_SIZES_TWO_DIM_LINE = 9;

function bomIsNotACharacter(outputDir: string): number {
  const calls = readRelations(outputDir).find(
    (r) => r.name === 'all-csharp-call-sites.csv'
  );
  if (calls === undefined || calls.header.length === 0) {
    return fail('all-csharp-call-sites.csv is missing or empty');
  }
  const modules = readRelations(outputDir).find(
    (r) => r.name === 'all-csharp-modules.csv'
  );
  if (modules === undefined || modules.header.length === 0) {
    return fail('all-csharp-modules.csv is missing or empty');
  }
  const iHash = calls.header.indexOf('csModuleLinkHash');
  const iLine = calls.header.indexOf('startLine');
  const iCol = calls.header.indexOf('startColumn');
  const iCallee = calls.header.indexOf('calleeName');
  const iFile = modules.header.indexOf('fileName');

  const columnOf = (file: string): number | undefined => {
    const module = modules.rows.find((r) => (r[iFile] ?? '').endsWith(file));
    if (module === undefined) {
      return undefined;
    }
    // The PK is the last cell of the row, as every other join here reads it.
    const moduleHash = module[modules.header.length - 1]!;
    const row = calls.rows.find(
      (r) => r[iHash] === moduleHash && r[iLine] === '1' && r[iCallee] === 'Abs'
    );
    return row === undefined ? undefined : Number(row[iCol]);
  };

  const withBom = columnOf('BomProbeA.cs');
  const without = columnOf('BomProbeB.cs');
  if (withBom === undefined || without === undefined) {
    return fail(
      'the line-1 call is missing from ' +
        (withBom === undefined ? 'BomProbeA.cs (the BOM file)' : 'BomProbeB.cs') +
        ' — the probe cannot see the fact it exists to see'
    );
  }
  // The absolute answer, from the source with no BOM in it.
  const expected = GATE_CORPUS['BomProbeB.cs']!.indexOf('System.Math.Abs(');
  let bad = 0;
  if (withBom !== without) {
    bad += fail(
      `a BOM moved line 1: the same call is at column ${withBom} with a BOM and ` +
        `${without} without one. A BOM is an encoding preamble; Roslyn decodes it away ` +
        'and every position it reports is into text that never contained it.'
    );
  }
  if (without !== expected) {
    bad += fail(
      `the line-1 call is at column ${without}, and the source puts it at ${expected}. ` +
        'The pair agreeing with each other is not enough — they could agree and both be wrong.'
    );
  }
  return bad;
}

function asyncIdentifierRows(outputDir: string): number {
  const types = readRelations(outputDir).find((r) => r.name === 'all-csharp-types.csv');
  if (types === undefined || types.header.length === 0) {
    return fail('all-csharp-types.csv is missing or empty');
  }
  const nameColumn = types.header.indexOf('name');
  const names = new Set(types.rows.map((r) => r[nameColumn]!));
  if (!names.has('UsesAsync')) {
    return fail(
      'the type in AsyncIdentifier.cs is missing. `if (async)` did not parse, which costs ' +
        '6.44% of declarations across a real corpus and raises no error anywhere.'
    );
  }
  return 0;
}

/**
 * Every declared enum value is either EMITTED or RESERVED with a reason.
 *
 * §4: three outcomes and you cannot tell them apart without looking — a real
 * gap, a deliberate reservation, or a false positive from the audit itself. So
 * this is a gate with an explicit allowlist, not a report someone reads.
 *
 * A correctly-positioned row with the WRONG KIND is invisible to recall,
 * completeness and oracle adjudication alike. This is the only check that sees
 * it.
 */
/**
 * Where each enum's values may legally appear.
 *
 * **The audit is COLUMN-AWARE, and the first run is why.** Scanning every cell
 * of every relation for a declared value reported three values as emitted that
 * were not: `CsTypeAccess.NONE` was `namespaceStyle=NONE`, `CsTypeModifier.
 * PRIVATE` was `typeAccess=PRIVATE`, and `CsNamespaceStyle.MIXED` was a
 * different question entirely. Two enums sharing a spelling is normal — `NONE`
 * appears in four of the six declared here — and a cell-matching audit cannot
 * tell them apart.
 *
 * That is §4's third outcome: not a real gap and not a deliberate reservation,
 * but a **false positive from the audit itself**, which is invisible unless the
 * audit is made to say which column it looked in.
 */
const ENUM_COLUMNS: ReadonlyMap<string, readonly [string, string, boolean][]> = new Map([
  ['CsNamespaceStyle', [['all-csharp-modules.csv', 'namespaceStyle', false]]],
  [
    'CsNullableContext',
    [
      ['all-csharp-modules.csv', 'nullableContextDefault', false],
      ['all-csharp-types.csv', 'nullableContext', false],
    ],
  ],
  [
    'CsTypeAccess',
    [
      ['all-csharp-types.csv', 'typeAccess', false],
      ['all-csharp-methods.csv', 'methodAccess', false],
      ['all-csharp-properties.csv', 'propertyAccess', false],
      ['all-csharp-properties.csv', 'getAccessorAccess', false],
      ['all-csharp-properties.csv', 'setAccessorAccess', false],
      ['all-csharp-events.csv', 'eventAccess', false],
      ['all-csharp-fields.csv', 'fieldAccess', false],
    ],
  ],
  ['CsTypeCategory', [['all-csharp-types.csv', 'typeCategory', false]]],
  // `true` marks a COMMA-SET column: one cell holds several values, and reading
  // it whole would report `PARTIAL,PUBLIC,SEALED` as an unrecognised value while
  // every one of its three parts went unseen.
  ['CsTypeModifier', [['all-csharp-types.csv', 'typeModifiers', true]]],
  ['CsTypePlacement', [['all-csharp-types.csv', 'typePlacement', false]]],
  ['CsHeritageKind', [['all-csharp-type-heritages.csv', 'heritageKind', false]]],
  [
    'CsVarianceModifier',
    [['all-csharp-type-parameters.csv', 'varianceModifier', false]],
  ],
  [
    'CsTypeParameterOwnerKind',
    [['all-csharp-type-parameters.csv', 'ownerKind', false]],
  ],
  ['CsMethodKind', [['all-csharp-methods.csv', 'methodKind', false]]],
  ['CsBodyKind', [['all-csharp-methods.csv', 'bodyKind', false]]],
  ['CsConversionKind', [['all-csharp-methods.csv', 'conversionKind', false]]],
  ['CsOwnerMemberKind', [['all-csharp-methods.csv', 'ownerMemberKind', false]]],
  ['CsMethodModifier', [['all-csharp-methods.csv', 'methodModifiers', true]]],
  [
    'CsParameterMode',
    [['all-csharp-method-parameters.csv', 'parameterMode', false]],
  ],
  [
    'CsScopedModifier',
    [['all-csharp-method-parameters.csv', 'scopedModifier', false]],
  ],
  ['CsSetterKind', [['all-csharp-properties.csv', 'setterKind', false]]],
  ['CsEventKind', [['all-csharp-events.csv', 'eventKind', false]]],
  ['CsFieldModifier', [['all-csharp-fields.csv', 'fieldModifiers', true]]],
  ['CsFieldMemberKind', [['all-csharp-fields.csv', 'memberKind', false]]],
  ['CsEnumValueKind', [['all-csharp-enum-members.csv', 'valueKind', false]]],
  ['CsUsingKind', [['all-csharp-usings.csv', 'usingKind', false]]],
  ['CsParseGapKind', [['all-csharp-parse-gaps.csv', 'gapKind', false]]],
  ['CsQueryClauseKind', [['all-csharp-query-clauses.csv', 'clauseKind', false]]],
  // THE SPINE'S TEN. All ten were absent from the hand-maintained list, so the
  // two largest relations in the fact base had no enum coverage at all — and
  // the audit could not say so, because it iterated the list.
  ['CsExpressionKind', [['all-csharp-expressions.csv', 'kind', false]]],
  ['CsEdgeRole', [['all-csharp-expressions.csv', 'edgeRole', false]]],
  ['CsRootContext', [['all-csharp-expressions.csv', 'rootContext', false]]],
  [
    'CsExpressionOwnerKind',
    [['all-csharp-expressions.csv', 'expressionOwnerKind', false]],
  ],
  ['CsLiteralKind', [['all-csharp-expressions.csv', 'literalKind', false]]],
  ['CsUnaryFixity', [['all-csharp-expressions.csv', 'unaryFixity', false]]],
  [
    'CsMethodReferenceKind',
    [['all-csharp-expressions.csv', 'methodReferenceKind', false]],
  ],
  [
    'CsReferencedEntityKind',
    [['all-csharp-expressions.csv', 'referencedEntityKind', false]],
  ],
  ['CsCallKind', [['all-csharp-call-sites.csv', 'callKind', false]]],
  ['CsReceiverKind', [['all-csharp-call-sites.csv', 'receiverKind', false]]],
  ['CsAttributeTarget', [['all-csharp-attributes.csv', 'attributeTarget', false]]],
  [
    'CsAttributeArgumentValueKind',
    [['all-csharp-attribute-arguments.csv', 'valueKind', false]],
  ],
  [
    'CsDeclarationOwnerKind',
    [
      ['all-csharp-attributes.csv', 'ownerKind', false],
      ['all-csharp-comments.csv', 'ownerKind', false],
    ],
  ],
  ['CsCommentKind', [['all-csharp-comments.csv', 'commentKind', false]]],
  [
    'CsPreprocRegionKind',
    [['all-csharp-preproc-regions.csv', 'regionKind', false]],
  ],
  ['CsRegionShape', [['all-csharp-preproc-regions.csv', 'regionShape', false]]],
  [
    'CsActivationSource',
    [['all-csharp-preproc-regions.csv', 'activationSource', false]],
  ],
  ['CsBlockKind', [['all-csharp-blocks.csv', 'blockKind', false]]],
  [
    'CsVariableDeclarationKind',
    [['all-csharp-variables.csv', 'declarationKind', false]],
  ],
  ['CsVariableScopeKind', [['all-csharp-variables.csv', 'scopeKind', false]]],
  ['CsRefKind', [['all-csharp-variables.csv', 'refKind', false]]],
  ['CsTypeRefKind', [['all-csharp-type-references.csv', 'kind', false]]],
  ['CsTypeRefContext', [['all-csharp-type-references.csv', 'context', false]]],
  [
    'CsReferenceOwnerKind',
    [['all-csharp-type-references.csv', 'referenceOwnerKind', false]],
  ],
]);

/**
 * Values declared but deliberately NOT emitted yet, each with its reason.
 *
 * A reserved value carries a **zero-row assertion**: the day it switches on is a
 * NAMED gate failure rather than new rows nobody noticed. Removing an entry from
 * this map is the commit that earns it.
 */
/**
 * MEASURED_GAPS and GAP_BAR were DELETED HERE, at the floor.
 *
 * They existed for one working day. The audit iterated a hand-maintained list
 * of enums, ten were missing from it — every one on the expression and
 * call-site spine — and when the list was derived from the barrel instead, the
 * first run reported 64 declared values that were never emitted anywhere in
 * 5,773 real files. A defect with a measurement is not a reservation, and
 * asserting both at zero is how a defect becomes a design, so the 64 went into
 * a map of their own behind a bar that could fall and never rise.
 *
 * 64 → 41 → 36 → 33 → 20 → 10 → 6 → 3 → 0. Eleven of the 64 were DELETED by
 * ruling (schema v1.3), as child edges or owners that duplicated an existing
 * column; seven were RESERVED, because the operand's TYPE decides them and
 * that is resolution; the other forty-six are EMITTED, and each has a fixture
 * in the inline corpus that exercises it.
 *
 * §11: a tolerance kept past the point where it tolerates anything is one
 * nobody re-examines, and it quietly re-authorises the next regression. So at
 * zero the mechanism is gone, and the audit asserts the invariant directly —
 * every declared value is emitted or reserved with a reason — which is what it
 * asserted before the ten were found, and now means.
 */

const RESERVED_ENUM_VALUES: ReadonlyMap<string, string> = new Map([
  // ---- UNREACHABLE UNDER THE PUBLISHED GRAMMAR ----------------------------
  //
  // Six values the fork could reach and this grammar cannot. They are RESERVED
  // rather than deleted, because the construct exists in C# and the day the
  // grammar grows a rule for it these should switch on — and a reserved value
  // switching on is a named failure here, which is exactly the signal wanted.
  [
    'CsActivationSource.UNEVALUATED',
    'a #if arm whose condition was never evaluated because an earlier arm won. The blanking ' +
      'pass reports EARLIER_BRANCH_TAKEN for that case, which is the more specific fact; ' +
      'UNEVALUATED survives for a condition that cannot be evaluated at all, and the pass ' +
      'treats an unparseable condition as FALSE rather than unevaluated, deliberately — a ' +
      'wrong branch puts code in the fact base that this configuration does not compile.',
  ],
  [
    'CsAttributeTarget.TYPEVAR',
    '`[typevar: X]` needs `typevar` treated as a contextual keyword. The published grammar ' +
      'reads the word as a TYPE, so the attribute list is an ERROR node and no attribute row ' +
      'exists to carry the target. One of the 12 KNOWN_GRAMMAR_LIMITATIONS.',
  ],
  // COLLECTION_EXPRESSION, SPREAD_ELEMENT, COLLECTION_ELEMENT and
  // SPREAD_OPERAND were all reserved here, on the belief that the grammar
  // parsed `[a, b]` and only one fixture blocked them. It does not parse it at
  // all — node-types.json declares no `collection_expression` — and every
  // collection expression in the corpus was arriving as an INDEX ACCESS. This
  // audit is what said so: four reserved values switched on the moment the
  // repair landed, which is the signal it exists to give.
  [
    'CsParseGapKind.SELF_REPORTING_NODE',
    'the FALLBACK bucket, for a file where `hasError` is set and no ERROR, missing or ' +
      'zero-width node can be located beneath it. The one shape in the corpus that produced ' +
      'it was a `#pragma` on the last line of a file with no trailing newline, and the parser ' +
      'now supplies the terminator the grammar requires — 23 of the 945 files in multitarget-A, every ' +
      'one of them fully read and carrying a row that said otherwise. The fallback itself ' +
      'stays: it is what found that shape, and the next unlocatable one is not knowable in ' +
      'advance. Reserved, not deleted.',
  ],
  [
    'CsCallKind.OPERATOR_CALL',
    'a user-defined operator invoked by `a + b`. Whether the operand type declares one is ' +
      'RESOLUTION: the syntax is identical for `int + int` and `Vector + Vector`. INDEX_CALL ' +
      'in TypeScript is the precedent — a kind syntax cannot decide is reserved with a ' +
      'zero-row assertion, never guessed. The BINARY expression row carries the operator, ' +
      'which is the whole hand-off.',
  ],
  [
    'CsCallKind.CONVERSION_CALL',
    'a cast that invokes a user-defined conversion. The same syntax as a cast that does ' +
      'not, and only the target and source types decide it. The CAST row and its ' +
      'castTypeReferenceLinkHash give the engine both halves.',
  ],
  [
    'CsCallKind.ELEMENT_ACCESS_CALL',
    '`a[i]` on a type with an indexer is a call to `get_Item`; on an array it is not. The ' +
      'receiver`s type decides, and that is INDEX_CALL exactly — the precedent this is ' +
      'reserved on. The ELEMENT_ACCESS row with its RECEIVER and INDEX_ARGUMENT edges is the ' +
      'hand-off.',
  ],
  // THE SPINE'S RESERVATIONS. Absent until now for the same reason the gaps
  // were: the ten spine enums were not in the audit's hand-maintained list, so
  // nothing ever asked whether these were explained.
  [
    'CsCallKind.DYNAMIC_CALL',
    'a call through `dynamic` is a fact about a VALUE\'s runtime identity, not about ' +
      'syntax. `d.Foo()` is the same tree whether `d` is dynamic or not, and the parser ' +
      'cannot see the difference. INDEX_CALL in TypeScript is the precedent: a kind syntax ' +
      'cannot decide is reserved with a zero-row assertion, never guessed.',
  ],
  [
    'CsCallKind.EXTENSION_REDUCED_CALL',
    '`xs.Where(...)` reduced to `Enumerable.Where(xs, ...)`. Whether the reduction applies ' +
      'depends on the receiver type and the using set in scope — Roslyn`s ReducedFrom, and ' +
      'an oracle question. cs_method.isExtension on the callee is the half the engine ' +
      'give the engine both halves to join on.',
  ],
  [
    'CsCallKind.QUERY_DESUGARED_CALL',
    'the two-to-five calls a LINQ query becomes. §2.5: the ENGINE desugars, and the parser ' +
      'emits cs_query_clause so it can. Synthesising calls here was withdrawn by ruling.',
  ],
  [
    'CsMethodReferenceKind.INSTANCE_METHOD_GROUP',
    'separating `X = obj.Handler` from `X = Type.StaticHandler` needs the RECEIVER`s type, ' +
      'which is resolution. METHOD_GROUP is emitted for both, grounded on the set of method ' +
      'names declared on the enclosing type — a same-file one-hop fact. Guessing the ' +
      'instance/static split from position produced 2,080 phantoms in multitarget-A before it was ' +
      'grounded, which is why this half stays reserved.',
  ],
  [
    'CsNullableContext.INHERITED',
    'no `#nullable` directive AND no project default. Every run of this suite supplies a ' +
      'default, so emitting it here would mean the default was dropped on the way in — ' +
      'which is why it is asserted at zero rather than left unexamined.',
  ],
  [
    'CsHeritageKind.TYPE_PARAMETER_CONSTRAINT',
    'a `where T : IFoo` constraint, IF constraints ever move into cs_type_heritage. They ' +
      'live on cs_type_parameter today, where the owning parameter is part of the ' +
      'identity, and moving them would lose that. Zero rows asserted so the day it ' +
      'changes is a named failure.',
  ],
  [
    'CsFieldMemberKind.EVENT_BACKING',
    'the hidden delegate a FIELD-LIKE event stores handlers in. Real storage, and it appears ' +
      'in NO source: the compiler creates it. A row for it would point at a declaration that ' +
      'does not exist, which is the same call made for a field-like event\'s add/remove ' +
      'accessors — the absence is recorded by cs_event.eventKind = FIELD_LIKE instead.',
  ],
  [
    'CsFieldMemberKind.ENUM_BACKING',
    "an enum's `value__` storage. Same: always present, never written, and cs_type_heritage " +
      'already carries the underlying type as ENUM_UNDERLYING_TYPE.',
  ],
  [
    'CsTypePlacement.TOP_LEVEL_STATEMENTS',
    'the synthetic owner of a C# 9 top-level-statements file. Reachable when cs_method ' +
      'lands: the statements need a METHOD to own them, and minting the type without the ' +
      'method would leave a type that owns nothing and an expression with no owner.',
  ],
]);

function enumEmissionAudit(outputDir: string, coverageDir?: string): number {
  let failures = 0;
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  // The BROAD corpus's rows, unioned in for the emitted-value question only.
  // Every other assertion in this suite reads the inline corpus alone.
  const coverageRelations = new Map(
    coverageDir === undefined ? [] : readRelations(coverageDir).map((r) => [r.name, r])
  );

  // DERIVED FROM THE ENUM BARREL, not a hand-maintained list.
  //
  // The list was hand-maintained, and TEN enums were missing from it — every
  // one of them on the expression and call-site spine, the two largest
  // relations in the fact base. The audit could not notice: it iterated the
  // list, so an enum absent from the list was not unaudited, it was invisible.
  // That is the same shape as a gate whose selector is derived from the field
  // it tests — the instrument cannot see the thing, and it passes forever.
  //
  // Deriving it means adding an enum with no ENUM_COLUMNS entry is a NAMED
  // failure on the next run, which is the message below.
  const declared: [string, Record<string, string>][] = Object.entries(
    CsEnums as unknown as Record<string, unknown>
  )
    .filter(
      ([name, value]) =>
        name.startsWith('Cs') &&
        typeof value === 'object' &&
        value !== null &&
        Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string')
    )
    .map(([name, value]) => [name, value as Record<string, string>] as [string, Record<string, string>])
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (declared.length < 40) {
    return fail(
      `the enum barrel yielded ${declared.length} enums. It exports more than that, so the ` +
        'filter is wrong and this audit is checking a fraction of what it claims.'
    );
  }

  const unexplained: string[] = [];
  let reservedButEmitted = 0;
  let observed = 0;

  for (const [enumName, values] of declared) {
    const sites = ENUM_COLUMNS.get(enumName);
    if (sites === undefined) {
      failures += fail(
        `${enumName} is declared and this audit does not know which column carries it. ` +
          'An enum with no site is unauditable, which is worse than an unemitted value.'
      );
      continue;
    }

    const emitted = new Set<string>();
    for (const [file, column, isCommaSet] of sites) {
      const relation = relations.get(file);
      if (relation === undefined || relation.header.length === 0) {
        continue;
      }
      const index = relation.header.indexOf(column);
      if (index === -1) {
        failures += fail(`${file} has no column "${column}" — the audit is reading a stale name`);
        continue;
      }
      const broad = coverageRelations.get(file);
      const broadIndex = broad === undefined ? -1 : broad.header.indexOf(column);
      const rows =
        broadIndex === -1
          ? relation.rows.map((row) => row[index]!)
          : [
              ...relation.rows.map((row) => row[index]!),
              ...broad!.rows.map((row) => row[broadIndex]!),
            ];
      for (const cell of rows) {
        if (cell === '') {
          continue;
        }
        for (const part of isCommaSet ? cell.split(',') : [cell]) {
          emitted.add(part);
          observed += 1;
        }
      }
    }

    for (const value of Object.values(values)) {
      const qualified = `${enumName}.${value}`;
      const isEmitted = emitted.has(value);
      const isReserved = RESERVED_ENUM_VALUES.has(qualified);
      if (!isEmitted && !isReserved) {
        unexplained.push(qualified);
      }
      if (isEmitted && isReserved) {
        console.log(`  ${qualified} is now emitted — remove it from RESERVED_ENUM_VALUES`);
        reservedButEmitted += 1;
      }
    }

    // Any value in the column that no declared member accounts for. This is the
    // direction that catches a hand-written string where an enum member was
    // meant, which no unemitted-value scan can see.
    const declaredValues = new Set(Object.values(values));
    for (const value of emitted) {
      if (!declaredValues.has(value)) {
        failures += fail(
          `${enumName}: the column carries "${value}", which is not a declared member`
        );
      }
    }
  }

  if (unexplained.length > 0) {
    failures += fail(
      `${unexplained.length} declared enum value(s) neither emitted nor reserved: ` +
        unexplained.join(', ')
    );
  }
  failures += reservedButEmitted;

  // Which corpora were seen, said aloud. A coverage check that quietly does
  // less is indistinguishable from one that passes.
  console.log(
    coverageDir === undefined
      ? `  COVERAGE CORPUS ABSENT (${COVERAGE_CORPUS_DIR}) — the inline corpus alone must ` +
          'exercise every declared value, and it does.'
      : `  two corpora: the inline gate corpus and ${COVERAGE_CORPUS_DIR}.`
  );

  // NEGATIVE CONTROL — the audit must be able to SEE a value that is emitted,
  // or "nothing unexplained" is trivially true of a reader that reads nothing.
  if (observed === 0) {
    failures += fail('NEGATIVE CONTROL FAILED: zero enum cells observed.');
  }

  return failures;
}

/**
 * The regime tokens in `cs_module`'s key are the FROZEN ones.
 *
 * They are coarse on purpose — a version string in a primary key would rewrite
 * every hash in the fact base on a patch bump, because the module hash chains
 * into every child key. This check exists so that changing one is a deliberate,
 * visible act rather than a silent re-keying of the whole corpus.
 *
 * ## The literals below are duplicated, and that is the point
 *
 * The first version of this check imported `CSHARP_GRAMMAR_REGIME` and compared
 * the emitted value against it. It was **incapable of failing**: change the
 * constant and both sides move together. The negative-control harness caught it
 * — every other mutation was reported and this one passed 12/12 — which is
 * exactly §11's *"check that your check can fail"*, found by doing it rather
 * than by reasoning about it.
 *
 * So the expected values are frozen HERE as literals. Changing a regime now
 * takes two edits, and the second one is the one a reviewer sees.
 */
const FROZEN_EMISSION_REGIME = 'roslyn4-oop';
// Moved through fork6 … fork23 while the grammar was a vendored fork, each in
// the same commit as the constant, on cs-oracle's ruling (schema v1.6 §4.0.4):
// a rule change alters what the parser sees, and a module hash that did not
// move with it would validate the wrong trees.
//
// Now `ts-cs-0.23.1-npm-blank2`: the PUBLISHED grammar, plus the pre-parse
// blanking of inactive `#if` arms. Blanking is in the token because it changes
// the text the grammar is given — the same reason a grammar rule was.
const FROZEN_GRAMMAR_REGIME = 'ts-cs-0.23.1-npm-blank2';
// THE PROGRAM the gate corpus describes (v1.9.1's remaining item 2): the
// target framework and the define set are INPUTS, both in cs_module's key,
// and an expectation that does not say which program it is about can be
// validated against another. Frozen as literals like the regimes; the
// analyzer options above must produce exactly these on every module row.
const FROZEN_TARGET_FRAMEWORK = 'net8.0';
// The key is over the RESOLVED set — the written constants (none) plus the
// symbols the SDK injects for the framework, which appear in no file.
const FROZEN_DEFINE_CONSTANTS_KEY = defineConstantsKeyOf(implicitFrameworkSymbols(FROZEN_TARGET_FRAMEWORK));

/**
 * THE FRONT END IS REGISTERED, and the registration is exercised end to end.
 *
 * Registration was the LAST step by order: sweeps clean, then ParserFactory
 * and the detector, then the scrub. It is here so that every sweep from now on
 * runs the parser the way the package's own entry point runs it, rather than
 * only through the test harness, and so a regression in the wiring — a
 * detector that stops claiming C#, a factory that drops the parser — is a
 * named failure and not a silent "0 C# projects found".
 */
async function registeredFrontEnd(): Promise<number> {
  let failures = 0;
  const factory = new ParserFactory();
  const byLanguage = factory.getParser(ProjectLanguage.CSHARP);
  const byExtension = factory.getParserByExtension('.cs');
  if (!(byLanguage instanceof CSharpParser) || !(byExtension instanceof CSharpParser)) {
    failures += fail('ParserFactory does not yield the C# parser for CSHARP / .cs');
  }
  if (!factory.getSupportedLanguages().includes(ProjectLanguage.CSHARP)) {
    failures += fail('CSHARP is not among the factory`s supported languages');
  }

  const detector = new ProjectDetector();
  const csharp = detector.getDetector(ProjectLanguage.CSHARP);
  if (csharp === undefined) {
    return failures + fail('no C# detector is registered');
  }
  await withTempDir(async (dir) => {
    const withProjectFile = path.join(dir, 'app');
    const bareSource = path.join(dir, 'bare');
    const empty = path.join(dir, 'empty');
    const ancestor = path.join(dir, 'ancestor');
    await fsp.mkdir(path.join(withProjectFile, 'bin'), { recursive: true });
    await fsp.mkdir(bareSource, { recursive: true });
    await fsp.mkdir(empty, { recursive: true });
    await fsp.mkdir(path.join(ancestor, 'src', 'lib'), { recursive: true });
    await fsp.writeFile(path.join(withProjectFile, 'App.csproj'), '<Project Sdk="Microsoft.NET.Sdk" />\n');
    await fsp.writeFile(path.join(withProjectFile, 'Program.cs'), 'System.Console.WriteLine("hi");\n');
    await fsp.writeFile(path.join(bareSource, 'A.cs'), 'class A { }\n');
    await fsp.writeFile(path.join(ancestor, 'src', 'lib', 'Deep.cs'), 'class Deep { }\n');

    if (!(await csharp.isProject(withProjectFile))) {
      failures += fail('a directory with a .csproj is not detected as a C# project');
    }
    if ((await csharp.detectBuildSystem(withProjectFile)) !== 'MSBuild') {
      failures += fail('a .csproj directory does not report MSBuild as its build system');
    }
    if (!(await csharp.isProject(bareSource))) {
      failures += fail('a bare directory of .cs files is not detected as a C# project');
    }
    if (await csharp.isProject(empty)) {
      failures += fail('an empty directory is detected as a C# project');
    }
    // SHALLOW: an ancestor that merely contains C# two levels down is not the
    // project; the directory holding the files is. Claiming the ancestor
    // swallows every project beneath it.
    if (await csharp.isProject(ancestor)) {
      failures += fail('an ancestor that merely CONTAINS C# is claimed as the project');
    }
    if (!(await csharp.hasSourceFiles(ancestor))) {
      failures += fail('hasSourceFiles, which is deep on purpose, does not see C# two levels down');
    }

    // THE ENTRY POINT, end to end: scan, detect, dispatch, write.
    const out = path.join(dir, 'out');
    const quiet = console.log;
    console.log = () => undefined;
    try {
      await extractProject({ projectPath: withProjectFile, outputDir: out, versionLink: 'gate' });
    } finally {
      console.log = quiet;
    }
    const written = fs.existsSync(out) ? fs.readdirSync(out).filter((f) => f.startsWith('all-csharp-')) : [];
    if (written.length !== 22) {
      failures += fail(
        `the package entry point wrote ${written.length} C# relations for a detected project, expected 22`
      );
    }
    const callSites = path.join(out, 'all-csharp-call-sites.csv');
    if (!fs.existsSync(callSites) || fs.readFileSync(callSites, 'utf8').split('\n').filter((l) => l !== '').length < 2) {
      failures += fail('the entry point run produced no call site for Console.WriteLine in the fixture project');
    }

    // MANY PROJECTS, ONE DIRECTORY (CS-ORACLE-3). A tree of 40 projects — some
    // NESTED under a parent that is itself a project, since the detector is
    // shallow — extracted into one output directory yields one fact base:
    // exactly one cs_module row per distinct file (a file under two roots is
    // extracted once), and no `.partial` left behind. Before: each project
    // published its own writers into the same names, two in one millisecond
    // shared a temporary name and the second got ENOENT; had they not, the
    // last project's rows would have replaced every other's.
    const many = path.join(dir, 'many');
    const expectedFiles: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      const project = path.join(many, `p${String(i).padStart(2, '0')}`);
      await fsp.mkdir(project, { recursive: true });
      await fsp.writeFile(path.join(project, `P${i}.csproj`), '<Project Sdk="Microsoft.NET.Sdk" />\n');
      await fsp.writeFile(path.join(project, `C${i}.cs`), `class C${i} { void M() { System.Console.WriteLine(${i}); } }\n`);
      expectedFiles.push(`C${i}.cs`);
      if (i % 10 === 0) {
        // A project nested in a project: its files are reachable from both.
        const nested = path.join(project, 'Inner');
        await fsp.mkdir(nested, { recursive: true });
        await fsp.writeFile(path.join(nested, `Inner${i}.csproj`), '<Project Sdk="Microsoft.NET.Sdk" />\n');
        await fsp.writeFile(path.join(nested, `N${i}.cs`), `class N${i} { }\n`);
        expectedFiles.push(`N${i}.cs`);
      }
    }
    const manyOut = path.join(dir, 'many-out');
    console.log = () => undefined;
    try {
      await extractProject({ projectPath: many, outputDir: manyOut, versionLink: 'gate' });
    } finally {
      console.log = quiet;
    }
    const leftovers = fs.existsSync(manyOut) ? fs.readdirSync(manyOut).filter((f) => f.endsWith('.partial')) : [];
    if (leftovers.length > 0) {
      failures += fail(`${leftovers.length} .partial file(s) left in the output directory after a 40-project run`);
    }
    const manyModules = readRelations(manyOut).find((r) => r.name === 'all-csharp-modules.csv');
    const moduleRows = manyModules?.rows ?? [];
    const fileNameColumn = manyModules?.header.indexOf('fileName') ?? -1;
    const fileNames = moduleRows.map((r) => path.basename(r[fileNameColumn] ?? ''));
    const distinct = new Set(fileNames);
    if (moduleRows.length !== expectedFiles.length || distinct.size !== expectedFiles.length) {
      failures += fail(
        `40 projects into one directory produced ${moduleRows.length} cs_module row(s) over ${distinct.size} distinct file(s), ` +
          `expected ${expectedFiles.length} and ${expectedFiles.length} — one fact base, one row per file, a nested project's file once`
      );
    }
    const missing = expectedFiles.filter((f) => !distinct.has(f));
    if (missing.length > 0) {
      failures += fail(`${missing.length} of ${expectedFiles.length} files have no cs_module row after the many-project run — e.g. ${missing[0]}; a later project's publish replaced an earlier's`);
    }

    // OVERLAPPING ROOTS, through the analyzer's own API — the scanner stops
    // at the first project it finds, so `extract` never hands it two roots
    // that overlap, but the corpus tooling calls `analyzeMany` directly and
    // can. The whole tree AND one project under it: every file once.
    const overlapOut = path.join(dir, 'overlap-out');
    await new CSharpProjectAnalyzer().analyzeMany([many, path.join(many, 'p00')], {
      outputDir: overlapOut,
      baseMservPath: many,
      serviceVersionLink: 'gate',
      targetFrameworks: ['net8.0'],
      defineConstants: [],
      implicitUsings: [],
    });
    const overlapModules = readRelations(overlapOut).find((r) => r.name === 'all-csharp-modules.csv');
    const overlapNames = (overlapModules?.rows ?? []).map((r) => path.basename(r[overlapModules!.header.indexOf('fileName')] ?? ''));
    if (overlapNames.length !== expectedFiles.length || new Set(overlapNames).size !== expectedFiles.length) {
      failures += fail(
        `two overlapping roots produced ${overlapNames.length} cs_module row(s) over ${new Set(overlapNames).size} distinct file(s), expected ${expectedFiles.length} — ` +
          'a file reached from two roots was extracted twice, and duplicate rows DOUBLE'
      );
    }
  });
  return failures;
}

/**
 * A READ IS NOT A CHECK.
 *
 * Five link columns — the call site's receiver, the cast's type, the module's
 * entry point, both initializer links, the enum member's value — were
 * declared in the schema, given a setter, documented, and EMPTY ON EVERY ROW.
 * Each had a gate that read the column, and reading a column that is always
 * empty passes every assertion that does not say "non-empty". This check says
 * it, for every link column at once: on the gate corpus each is populated on
 * at least one row, or it is listed here with the reason it cannot be.
 *
 * The list is the mirror of the enum audit's reservations: a column that is
 * empty by RULING is named, and the day it is populated is a named failure.
 */
const LINK_COLUMNS_EMPTY_BY_RULING: ReadonlyMap<string, string> = new Map([
  [
    'all-csharp-attributes.csv:csExpressionLinkHash',
    'a parity slot: the schema lists the column and never says what an ATTRIBUTE, which is ' +
      'inert metadata and not an expression, would name. Routed to cs-oracle; empty until ruled.',
  ],
]);

function everyLinkColumnIsWritten(outputDir: string): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  let checked = 0;
  for (const relation of relations) {
    if (relation.header.length === 0) {
      continue;
    }
    const pk = relation.header.length - 1;
    relation.header.forEach((column, index) => {
      const isLink =
        index !== pk &&
        column !== 'serviceVersionLinkHash' &&
        (column.endsWith('Hash') || column === 'declarationGroupKey');
      if (!isLink) {
        return;
      }
      checked += 1;
      const key = `${relation.name}:${column}`;
      const populated = relation.rows.filter((r) => r[index] !== '').length;
      const ruling = LINK_COLUMNS_EMPTY_BY_RULING.get(key);
      if (populated === 0 && ruling === undefined) {
        failures += fail(
          `${key} is empty on all ${relation.rows.length} rows of the gate corpus. A link column ` +
            'nothing writes is a hop the engine cannot take, and a gate that reads it passes.'
        );
      }
      if (populated !== 0 && ruling !== undefined) {
        failures += fail(`${key} is populated (${populated} rows) but listed as empty by ruling — remove it from the list`);
      }
    });
  }
  if (checked < 60) {
    failures += fail(`NEGATIVE CONTROL FAILED: only ${checked} link columns checked, expected the 67`);
  }
  return failures;
}

/**
 * A FIXTURE THAT PRODUCES NOTHING CAN NEVER FAIL.
 *
 * Seven times a backtick inside a fixture's C# text — in a comment, every
 * time — ended the TypeScript template literal early. The VALUE the suite
 * wrote to disk was the text up to that backtick; the parser saw a truncated
 * file and recovered it; the suite reported N/N files extracted, because the
 * module row existed. Every assertion scoped to that file then compared
 * against an empty set and passed.
 *
 * The backtick itself cannot be checked for: the literal ends AT it, so the
 * truncated value never contains one. What a cut-short fixture DOES have is
 * structure that no complete fixture has: braces that do not balance, no
 * trailing newline, and a parser that reached fewer lines than the text has.
 * All three are asserted, per fixture, against the text the suite holds.
 */
function everyFixtureIsAFixture(outputDir: string): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const modules = relations.find((r) => r.name === 'all-csharp-modules.csv');
  if (modules === undefined) {
    return failures + fail('all-csharp-modules.csv is missing');
  }
  const fileNameColumn = modules.header.indexOf('fileName');
  const endLineColumn = modules.header.indexOf('endLine');
  const modulePk = modules.header.length - 1;
  const contentRelations = relations.filter((r) =>
    ['all-csharp-types.csv', 'all-csharp-methods.csv', 'all-csharp-expressions.csv', 'all-csharp-usings.csv'].includes(r.name)
  );
  let checked = 0;
  for (const [name, source] of Object.entries(GATE_CORPUS)) {
    checked += 1;
    // GapUnlocatable.cs is written WITHOUT a trailing newline on purpose: its
    // last byte is the finding. Everything else ends in one.
    if (name !== 'GapUnlocatable.cs' && !source.endsWith('\n')) {
      failures += fail(`${name} does not end in a newline — the text the suite holds is cut short`);
    }
    const opens = (source.match(/\{/g) ?? []).length;
    const closes = (source.match(/\}/g) ?? []).length;
    if (opens !== closes) {
      failures += fail(
        `${name} has ${opens} '{' and ${closes} '}' — a fixture whose braces do not balance ` +
          'is a fixture that ended where a backtick stood'
      );
    }
    const module = modules.rows.find((r) => r[fileNameColumn] === name);
    if (module === undefined) {
      failures += fail(`${name} produced no cs_module row`);
      continue;
    }
    // The root node's end position sits on the line AFTER a trailing newline
    // in some files and on the last text line in others, so the parser may
    // report one line more than the text has — never fewer.
    const sourceLines = source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
    const parsedLines = Number(module[endLineColumn]);
    if (parsedLines < sourceLines || parsedLines > sourceLines + 1) {
      failures += fail(
        `${name}: the parser reached line ${parsedLines} of ${sourceLines}. The file it saw is ` +
          'not the text the suite holds.'
      );
    }
    const content = contentRelations.reduce((n, r) => {
      const column = r.header.indexOf('csModuleLinkHash');
      return n + r.rows.filter((x) => x[column] === module[modulePk]).length;
    }, 0);
    if (content === 0) {
      failures += fail(`${name} produced a module row and nothing else. A fixture that produces nothing cannot fail any gate scoped to it.`);
    }
  }
  if (checked < 20) {
    failures += fail(`NEGATIVE CONTROL FAILED: only ${checked} fixtures checked`);
  }
  return failures;
}

/**
 * EVERY CONTROL HAS A TARGET. A control is a mutation of a named file; when the
 * text it mutates is refactored away the mutation applies to nothing, the
 * suite stays green, and the control reports OK forever. The full tally sees
 * this as "the mutation did not apply" — but the full tally runs at the gate,
 * and the base-name control had been detached for three commits before one
 * ran (found at 3561721, control 108 of 199). This check does the same test
 * without running a single suite: every patch in `negative-controls.sh` is
 * applied in memory to the file it names, and must change it.
 *
 * The patch text is read exactly as the harness reads it — a bash
 * double-quoted string handed to a python heredoc — so the unescaping here is
 * bash's (`\"`, `\\`, `\$`, backtick), and the patch itself runs in python.
 */
/**
 * NO VERDICT READS A CLOCK.
 *
 * The resumable harness assumes every control is deterministic, and its
 * re-run sample can only see non-determinism that shows up under the SAME
 * conditions: cs-oracle's scaling check printed stable output and its verdict
 * still flipped between runs minutes apart, because the flip needed a load
 * change, not a re-run (CS-ORACLE-5). Output stability is necessary and not
 * sufficient. The sufficient property is grep-able: no line of this suite that
 * reads a clock feeds a verdict. Every clock read is listed here with what it
 * feeds — a printed duration and nothing else — and an unlisted one fails.
 */
const CLOCK_READS_FOR_DISPLAY_ONLY: ReadonlyMap<string, string> = new Map([
  ['const started = process.hrtime.bigint();', 'linearInStatements: the seconds printed beside the node-read counts'],
  ['seconds: Number(process.hrtime.bigint() - started) / 1e9,', 'linearInStatements: the same, returned for the printed line'],
  ['const startedAt = Date.now();', 'main: the extraction duration in the summary line'],
  ['`${((Date.now() - startedAt) / 1000).toFixed(1)}s`', 'main: the same, printed'],
  ['const t0 = Date.now();', 'main: each check\'s printed duration'],
  ['const seconds = ((Date.now() - t0) / 1000).toFixed(1);', 'main: the same, printed beside PASS / FAIL'],
]);

function noVerdictReadsAClock(): number {
  let failures = 0;
  const source = fs.readFileSync('src/test/csharp-tests.ts', 'utf-8').split('\n');
  const clock = /Date\.now\(\)|performance\.now\(\)|hrtime|new Date\(/;
  // The allowlist and this function's own regex are not reads. Found by TEXT,
  // not by a line number: a hard-coded line moved every time a fixture was
  // added above it, and the check then filed its own allowlist as unlisted.
  const declaredAt = source.findIndex((line) => line.startsWith('const CLOCK_READS_FOR_DISPLAY_ONLY'));
  if (declaredAt < 0) {
    return fail('the display-only allowlist could not be located in this file');
  }
  let seen = 0;
  const unlisted: string[] = [];
  source.forEach((line, i) => {
    if (i >= declaredAt && i <= declaredAt + 40) {
      return;
    }
    if (!clock.test(line) || line.trim().startsWith('//') || line.trim().startsWith('*')) {
      return;
    }
    seen += 1;
    if (!CLOCK_READS_FOR_DISPLAY_ONLY.has(line.trim())) {
      unlisted.push(`${i + 1}: ${line.trim()}`);
    }
  });
  if (seen === 0) {
    failures += fail('NEGATIVE CONTROL FAILED: no clock read found at all, so the allowlist matched nothing');
  }
  for (const entry of unlisted) {
    failures += fail(`a clock is read at ${entry} and it is not on the display-only list — if it feeds a verdict, the verdict depends on machine load`);
  }
  for (const listed of CLOCK_READS_FOR_DISPLAY_ONLY.keys()) {
    if (!source.some((line) => line.trim() === listed)) {
      failures += fail(`the display-only list names a clock read that no longer exists: ${listed}`);
    }
  }
  return failures;
}

function everyControlApplies(): number {
  let failures = 0;
  const harnessPath = 'src/test/csharp-gates/negative-controls.sh';
  const harness = fs.readFileSync(harnessPath, 'utf-8');
  const pattern = /^run_break "((?:[^"\\]|\\.)*)" \\\n  (\S+) \\\n  "((?:[^"\\]|\\.)*)" \\\n  "((?:[^"\\]|\\.)*)"/gm;
  const unescape = (raw: string): string => raw.replace(/\\(["\\$`])/g, '$1');
  const controls: { label: string; file: string; gate: string; patch: string }[] = [];
  for (const match of harness.matchAll(pattern)) {
    controls.push({ label: unescape(match[1]!), file: match[2]!, gate: unescape(match[3]!), patch: unescape(match[4]!) });
  }
  const declared = (harness.match(/^run_break "/gm) ?? []).length;
  if (controls.length !== declared) {
    failures += fail(`parsed ${controls.length} controls from the harness but it declares ${declared} — a control this check cannot read is one it cannot vouch for`);
  }
  if (controls.length === 0) {
    return failures + fail('NEGATIVE CONTROL FAILED: no controls parsed from the harness');
  }
  const script = [
    'import sys, json',
    'controls = json.load(sys.stdin)',
    'out = []',
    'for c in controls:',
    '    try:',
    '        s = open(c["file"]).read()',
    '    except Exception as e:',
    '        out.append([c["label"], "unreadable: " + str(e)]); continue',
    '    before = s',
    '    try:',
    '        exec(c["patch"])',
    '    except Exception as e:',
    '        out.append([c["label"], "patch raised: " + str(e)]); continue',
    '    if not isinstance(s, str):',
    '        out.append([c["label"], "patch left no string"]); continue',
    '    if s == before:',
    '        out.append([c["label"], "applies to nothing"])',
    'print(json.dumps(out))',
  ].join('\n');
  const run = spawnSync('python3', ['-c', script], { input: JSON.stringify(controls), encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) {
    return failures + fail(`the control dry-run could not execute: ${(run.stderr ?? '').trim().slice(0, 300)}`);
  }
  const detached = JSON.parse(run.stdout.trim()) as [string, string][];
  for (const [label, why] of detached) {
    failures += fail(`control "${label}" ${why} — it has been reporting OK about nothing`);
  }
  return failures;
}

function regimePins(outputDir: string): number {
  let failures = 0;

  // The constants the parser uses must equal the frozen literals. Checked
  // first, so a rename shows up here rather than as a thousand row mismatches.
  if (CSHARP_EMISSION_REGIME !== FROZEN_EMISSION_REGIME) {
    failures += fail(
      `CSHARP_EMISSION_REGIME is "${CSHARP_EMISSION_REGIME}", frozen at ` +
        `"${FROZEN_EMISSION_REGIME}". A regime token is in cs_module's PRIMARY KEY: ` +
        'changing it re-keys every row in the fact base. If that is intended, change ' +
        'the frozen literal in the same commit and say why.'
    );
  }
  if (CSHARP_GRAMMAR_REGIME !== FROZEN_GRAMMAR_REGIME) {
    failures += fail(
      `CSHARP_GRAMMAR_REGIME is "${CSHARP_GRAMMAR_REGIME}", frozen at ` +
        `"${FROZEN_GRAMMAR_REGIME}". Same consequence.`
    );
  }

  const modules = readRelations(outputDir).find((r) => r.name === 'all-csharp-modules.csv');
  if (modules === undefined || modules.header.length === 0) {
    return failures + fail('all-csharp-modules.csv is missing or empty');
  }
  const emissionColumn = modules.header.indexOf('emissionRegime');
  const grammarColumn = modules.header.indexOf('grammarRegime');
  if (emissionColumn === -1 || grammarColumn === -1) {
    return failures + fail('cs_module has no emissionRegime/grammarRegime column');
  }
  if (modules.rows.length === 0) {
    return failures + fail('NEGATIVE CONTROL FAILED: no cs_module rows to check.');
  }
  for (const row of modules.rows) {
    if (row[emissionColumn] !== FROZEN_EMISSION_REGIME) {
      failures += fail(`a row carries emissionRegime "${row[emissionColumn]}"`);
      break;
    }
  }
  for (const row of modules.rows) {
    if (row[grammarColumn] !== FROZEN_GRAMMAR_REGIME) {
      failures += fail(`a row carries grammarRegime "${row[grammarColumn]}"`);
      break;
    }
  }
  // WHICH PROGRAM. Every module row of the gate corpus is compiled under the
  // frozen target framework and define set; a row under another would be a
  // different program's facts validating this one's expectations.
  const frameworkColumn = modules.header.indexOf('targetFramework');
  const definesColumn = modules.header.indexOf('defineConstantsKey');
  if (frameworkColumn === -1 || definesColumn === -1) {
    return failures + fail('cs_module has no targetFramework/defineConstantsKey column');
  }
  const foreign = modules.rows.find(
    (row) => row[frameworkColumn] !== FROZEN_TARGET_FRAMEWORK || row[definesColumn] !== FROZEN_DEFINE_CONSTANTS_KEY
  );
  if (foreign !== undefined) {
    failures += fail(
      `a gate-corpus module is compiled under targetFramework "${foreign[frameworkColumn]}" with define key ` +
        `"${foreign[definesColumn]}"; frozen at "${FROZEN_TARGET_FRAMEWORK}" / "${FROZEN_DEFINE_CONSTANTS_KEY}". ` +
        'The program an expectation describes is part of the expectation.'
    );
  }
  return failures;
}

/**
 * A multi-targeting emission produces two modules per file, not one.
 *
 * §2.2's option 3, exercised: the same file under two frameworks is two
 * `cs_module` rows with different hashes, and their `#if` branches differ. If
 * the framework were not in the key the second emission would collide with the
 * first and the fact base would silently hold one of the two answers.
 */
async function multiTargetKeying(corpusDir: string): Promise<number> {
  return withTempDir(async (dir) => {
    let failures = 0;
    await runAnalyzer(corpusDir, dir, { targetFrameworks: ['net8.0', 'netstandard2.0'] });
    const relations = readRelations(dir);
    const modules = relations.find((r) => r.name === 'all-csharp-modules.csv')!;
    const types = relations.find((r) => r.name === 'all-csharp-types.csv')!;

    // The inline fixtures plus the one GENERATED file (Large.cs). Counting the
    // template map alone reported 68 expected against 70 seen the moment a
    // generated fixture existed — the count must come from what was WRITTEN.
    const fileCount = fs.readdirSync(corpusDir).filter((f) => f.endsWith('.cs')).length;
    if (modules.rows.length !== fileCount * 2) {
      failures += fail(
        `two frameworks over ${fileCount} files gave ${modules.rows.length} cs_module rows, ` +
          `expected ${fileCount * 2}`
      );
    }
    const pkColumn = modules.header.length - 1;
    if (new Set(modules.rows.map((r) => r[pkColumn])).size !== modules.rows.length) {
      failures += fail(
        'two target frameworks produced colliding cs_module hashes — one emission is ' +
          'silently overwriting the other'
      );
    }

    // The assertion above is NOT enough on its own, and the negative-control
    // harness is what showed it. Once defineConstantsKey covered the RESOLVED
    // symbol set, net8.0 and netstandard2.0 differed in that column too, so
    // removing targetFramework from the key left the hashes distinct anyway and
    // the check went green on a broken key. An emergent property is not a test
    // of the thing it emerges from.
    //
    // So the key composition is asserted DIRECTLY: two modules identical in
    // every other component, differing only in targetFramework.
    const sameExceptFramework = (framework: string): string =>
      new CsModuleRegistry({
        name: 'K',
        qualifiedName: 'K.cs',
        fileName: 'K.cs',
        filePath: 'K.cs',
        baseMservPath: '/r',
        targetFramework: framework,
        defineConstantsKey: 'IDENTICAL',
        langVersion: '13.0',
        emissionRegime: FROZEN_EMISSION_REGIME,
        grammarRegime: FROZEN_GRAMMAR_REGIME,
        startLine: 1,
        serviceVersionLinkHash: 'SV',
      }).getHash();
    if (sameExceptFramework('net8.0') === sameExceptFramework('netstandard2.0')) {
      failures += fail(
        'targetFramework is NOT in cs_module\'s primary key. Two emissions of one file ' +
          'under two frameworks would collide, and the module hash chains into every ' +
          'child key in the fact base.'
      );
    }
    if (sameExceptFramework('net8.0') !== sameExceptFramework('net8.0')) {
      failures += fail('NEGATIVE CONTROL FAILED: the module hash is not a function of its inputs.');
    }

    // netstandard2.0 does not define NET8_0_OR_GREATER, so it takes the #else.
    const nameColumn = types.header.indexOf('name');
    const names = types.rows.map((r) => r[nameColumn]!);
    if (!names.includes('Modern')) {
      failures += fail('net8.0 emission lost `Modern`');
    }
    if (!names.includes('Fallback')) {
      failures += fail(
        'netstandard2.0 emission did not take the #else branch — `Fallback` is missing. ' +
          'The implicit framework symbol table is wrong or not consulted.'
      );
    }
    return failures;
  });
}

/**
 * `cs_preproc_region` — the audit trail for what everything else was emitted
 * FROM.
 *
 * Was PENDING: the schema stated 15 columns for this relation and listed
 * 14, and column ORDER is the contract, so inventing the fifteenth would have
 * been the silent corruption the arity check exists to prevent. v1.2 lists all
 * fifteen and the check is switched on in the same commit that lowers
 * `PENDING_BAR`, which is what makes turning a check on a visible diff.
 *
 * The branch SELECTION was already implemented and already checked. What this
 * adds is the provenance: which branch, and WHY.
 */
function preprocRegionRelation(outputDir: string): number {
  let failures = 0;
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const regions = relations.get('all-csharp-preproc-regions.csv');
  const modules = relations.get('all-csharp-modules.csv');
  if (regions === undefined || regions.header.length === 0) {
    return fail('all-csharp-preproc-regions.csv is missing or empty');
  }
  if (modules === undefined) {
    return fail('all-csharp-modules.csv is missing');
  }
  const r = (n: string): number => regions.header.indexOf(n);
  const mo = (n: string): number => modules.header.indexOf(n);
  const rPk = regions.header.length - 1;

  const module = modules.rows.find((row) =>
    (row[mo('fileName')] ?? '').endsWith('Conditional.cs')
  );
  if (module === undefined) {
    return fail('Conditional.cs produced no cs_module row, so this check sees nothing');
  }
  const scoped = regions.rows.filter(
    (row) => row[r('csModuleLinkHash')] === module[modules.header.length - 1]
  );
  // NEGATIVE CONTROL. Every assertion below filters on the module, and an empty
  // selection reads exactly like a clean pass.
  if (scoped.length === 0) {
    return fail(
      'NEGATIVE CONTROL FAILED: an `#if`/`#elif`/`#else` chain produced no region rows'
    );
  }

  // THREE BRANCHES, and the chain NESTS in this grammar — `#elif` is a child of
  // the `#if` and `#else` a child of the last `#elif`. A walker reading them as
  // siblings emits some of them twice, and duplicates DOUBLE.
  if (scoped.length !== 3) {
    failures += fail(`the three-branch chain produced ${scoped.length} region rows`);
  }
  const kinds = scoped.map((row) => row[r('regionKind')]).join(',');
  if (kinds !== 'IF,ELIF,ELSE') {
    failures += fail(`the chain's region kinds are ${kinds}, expected IF,ELIF,ELSE`);
  }
  const indices = scoped.map((row) => row[r('branchIndex')]).join(',');
  if (indices !== '0,1,2') {
    failures += fail(`the chain's branch indices are ${indices}, expected 0,1,2`);
  }
  if (scoped.some((row) => row[r('branchCount')] !== '3')) {
    failures += fail('a branch does not know how many branches its chain has');
  }
  if (new Set(scoped.map((row) => row[rPk])).size !== scoped.length) {
    failures += fail('two branches of one chain share a primary key');
  }

  // EXACTLY ONE ACTIVE. `#if` selects one branch, and a fact base saying two
  // were taken describes a program that does not exist.
  const active = scoped.filter((row) => row[r('isActive')] === 'true');
  if (active.length !== 1) {
    failures += fail(`${active.length} branches of one chain are active, expected 1`);
  }

  // WHY, not merely whether. `isActive = false` has three unrelated causes that
  // read identically, and only one of them is a limitation of this parser.
  if (active[0]?.[r('activationSource')] !== 'CONDITION_TRUE') {
    failures += fail(
      `the taken branch reports activationSource ` +
        `${active[0]?.[r('activationSource')] ?? '<none>'}, expected CONDITION_TRUE — ` +
        'net8.0 defines NET8_0_OR_GREATER, which appears in no file anywhere'
    );
  }
  const sources = new Set(scoped.map((row) => row[r('activationSource')]));
  if (!sources.has('EARLIER_BRANCH_TAKEN')) {
    failures += fail(
      'the `#else` is inactive because the `#if` already won, and the row reports it as a ' +
        'failed condition. Those are different facts and the column exists to separate them.'
    );
  }

  // The CONDITION as written, and the symbols it needs. Without the symbol list
  // a consumer cannot answer "which regions depend on NET8_0_OR_GREATER"
  // without re-parsing the text.
  const ifRow = scoped.find((row) => row[r('regionKind')] === 'IF');
  if (ifRow !== undefined) {
    if (ifRow[r('conditionText')] !== 'NET8_0_OR_GREATER') {
      failures += fail(
        `the #if condition text is ${JSON.stringify(ifRow[r('conditionText')])}`
      );
    }
    if (ifRow[r('conditionSymbols')] !== 'NET8_0_OR_GREATER') {
      failures += fail(
        `the #if condition symbols are ${JSON.stringify(ifRow[r('conditionSymbols')])}`
      );
    }
  }
  // `#else` has NO condition, and an invented one would be a fact nobody wrote.
  const elseRow = scoped.find((row) => row[r('regionKind')] === 'ELSE');
  if (elseRow !== undefined && elseRow[r('conditionText')] !== '') {
    failures += fail('the `#else` branch was given a condition it does not have');
  }

  // The SHAPE. Every branch here holds a class declaration.
  if (scoped.some((row) => row[r('regionShape')] !== 'DECLARATION')) {
    failures += fail(
      `a branch holding a class declaration reports shape ` +
        `${scoped.map((row) => row[r('regionShape')]).join('/')}`
    );
  }

  // AND THE ROWS AGREE WITH THE EMISSION. The active branch's type is in
  // cs_type and the others' are not — the region rows are an audit trail, so a
  // trail disagreeing with what was emitted is worse than no trail.
  const types = relations.get('all-csharp-types.csv');
  if (types !== undefined) {
    const names = new Set(
      types.rows
        .filter(
          (row) =>
            row[types.header.indexOf('csModuleLinkHash')] ===
            module[modules.header.length - 1]
        )
        .map((row) => row[types.header.indexOf('name')])
    );
    if (!names.has('Modern')) {
      failures += fail('the region rows say the #if was taken and no type came from it');
    }
    if (names.has('Old') || names.has('Fallback')) {
      failures += fail(
        'a type was emitted from a branch the region rows report as inactive — the audit ' +
          'trail and the fact base disagree'
      );
    }
  }

  // FILE-LEVEL #define / #undef (CS-CORPUS-25). FileDefines.cs defines PLAIN,
  // undefines the SDK-injected NET8_0, and defines USE_FALLBACK through the
  // #else of a chain whose #if is not taken. Each `#if` in the body must be
  // reported with the activity the file's own directives give it, and the
  // calls must follow the rows.
  {
    const defines = modules.rows.find((row) => (row[mo('fileName')] ?? '').endsWith('FileDefines.cs'));
    if (defines === undefined) {
      failures += fail('FileDefines.cs produced no cs_module row, so the file-level define check sees nothing');
    } else {
      const definesHash = defines[modules.header.length - 1]!;
      const rows = regions.rows.filter((row) => row[r('csModuleLinkHash')] === definesHash);
      const activity = (conditionText: string, kind: string): string | undefined => {
        const matches = rows.filter((row) => row[r('conditionText')] === conditionText && row[r('regionKind')] === kind);
        return matches.length === 1 ? matches[0]![r('isActive')] : undefined;
      };
      const expected: ReadonlyArray<readonly [string, string, string]> = [
        ['FIXTURE_PLATFORM_A', 'IF', 'false'],
        ['PLAIN', 'IF', 'true'],
        ['USE_FALLBACK', 'IF', 'true'],
        ['USE_PRIMARY', 'IF', 'false'],
        ['NET8_0', 'IF', 'false'],
        // A THREE-WAY chain whose #else defines the symbol: the trailing
        // #define attaches to the outermost node, after the #elif child, and
        // belongs to the LAST branch — not the next one (CS-CORPUS-25's
        // residual, 14 sites: the else's symbol defined under the elif).
        ['THREE_C', 'IF', 'true'],
        ['THREE_B', 'IF', 'false'],
      ];
      for (const [condition, kind, active] of expected) {
        const got = activity(condition, kind);
        if (got !== active) {
          failures += fail(
            `\`#if ${condition}\` in FileDefines.cs is reported ${got === undefined ? 'by no single region row' : `isActive=${got}`}, ` +
              `expected ${active} — the file's own #define/#undef decide it${condition.startsWith('THREE_') ? ', and a #define trailing a three-way chain belongs to its LAST branch' : ''}`
          );
        }
      }
      const callSites = relations.get('all-csharp-call-sites.csv');
      if (callSites === undefined || callSites.header.length === 0) {
        failures += fail('all-csharp-call-sites.csv is missing or empty, so the file-level define check cannot read its calls');
      } else {
        const c = (n: string): number => callSites.header.indexOf(n);
        const called = new Set(
          callSites.rows.filter((row) => row[c('csModuleLinkHash')] === definesHash).map((row) => row[c('calleeName')]!)
        );
        for (const present of ['Guarded', 'Fallback', 'NoFramework', 'ThreeC']) {
          if (!called.has(present)) {
            failures += fail(`${present}() sits in a region the file's directives make active and produced no call site`);
          }
        }
        for (const absent of ['Unguarded', 'Primary', 'Framework', 'ThreeB']) {
          if (called.has(absent)) {
            failures += fail(`${absent}() sits in a region the file's directives make inactive and produced a call site`);
          }
        }
      }
    }
  }

  return failures;
}

/**
 * Heritage and generics say what syntax knows and no more.
 *
 * The two halves of the §3.3 ruling, both checked: a CLASS base list is
 * `BASE_OR_INTERFACE` because C# has no `extends`, and a STRUCT or INTERFACE
 * base list is `INTERFACE_ONLY` because the language forbids a base class there
 * — which is syntax, not resolution, and throwing it away would make the engine
 * re-derive something already known.
 */
function heritageAndGenerics(outputDir: string): number {
  let failures = 0;
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const heritage = relations.get('all-csharp-type-heritages.csv');
  const parameters = relations.get('all-csharp-type-parameters.csv');
  if (heritage === undefined || heritage.header.length === 0) {
    return fail('all-csharp-type-heritages.csv is missing or empty');
  }
  if (parameters === undefined || parameters.header.length === 0) {
    return fail('all-csharp-type-parameters.csv is missing or empty');
  }

  const hColumn = (n: string): number => heritage.header.indexOf(n);
  const kindOf = (baseName: string): string[] =>
    heritage.rows
      .filter((r) => r[hColumn('baseTypeName')] === baseName)
      .map((r) => r[hColumn('heritageKind')]!);

  // `class Impl<T> : Base<T>, IRepo<...>` — syntax cannot tell which is which.
  if (!kindOf('Base').includes('BASE_OR_INTERFACE')) {
    failures += fail('position 0 of a class base list did not produce BASE_OR_INTERFACE');
  }
  // POSITION is the larger half of what syntax decides — 3,218 of 4,284 entries.
  // A base class must be written FIRST, so `class Impl<T> : Base<T>, IRepo<...>`
  // has an IRepo that provably is not a base class, whatever it resolves to.
  const repoKinds = kindOf('IRepo');
  if (!repoKinds.includes('INTERFACE')) {
    failures += fail(
      'entry 1 of a class base list is not INTERFACE. A base class must come first, so ' +
        'anything after it is decidable from position alone — the half of the rule that ' +
        'is easiest to miss, and three times the size of the owner-kind half.'
    );
  }
  if (repoKinds.includes('BASE_OR_INTERFACE')) {
    failures += fail('a non-first class base entry was handed to the engine as ambiguous');
  }
  // The OWNER-KIND half, tested at POSITION 0 — and it has to be position 0.
  //
  // `struct S : IDisposable, IThing` looks like a test of the owner rule and is
  // not: IThing sits at position 1, where the POSITION rule already forces
  // INTERFACE, so deleting the owner rule changes nothing and the gate stays
  // green. The negative-control harness caught exactly that — the mutation
  // applied cleanly and the check still passed.
  //
  // `interface IExtends : IThing, IOther` and `struct OnlyInterfaces :
  // System.IDisposable, ...` put an entry at position 0, where only the owner
  // rule can decide it.
  //
  // Selected by the OWNER's category, not by the interface's name: `IThing`
  // at position 0 of a CLASS is BASE_OR_INTERFACE and correctly so, and a
  // name-keyed selector became a hostage of the next fixture to write one.
  const types = relations.get('all-csharp-types.csv');
  if (types === undefined) {
    return failures + fail('all-csharp-types.csv is missing');
  }
  const interfaceOnlyOwners = new Set(
    types.rows
      .filter((r) => {
        const category = r[types.header.indexOf('typeCategory')];
        return category === 'STRUCT' || category === 'INTERFACE' || category === 'RECORD_STRUCT';
      })
      .map((r) => r[types.header.length - 1]!)
  );
  const firstOfInterfaceList = heritage.rows.filter(
    (r) =>
      r[hColumn('position')] === '0' && interfaceOnlyOwners.has(r[hColumn('csTypeLinkHash')]!)
  );
  if (firstOfInterfaceList.length === 0) {
    failures += fail(
      'the corpus has no position-0 entry in a struct or interface base list, so the ' +
        'owner-kind rule is not being tested at all'
    );
  }
  for (const row of firstOfInterfaceList) {
    if (row[hColumn('heritageKind')] !== 'INTERFACE') {
      failures += fail(
        `position 0 of a struct/interface base list is ${row[hColumn('heritageKind')]}, ` +
          'expected INTERFACE. The LANGUAGE decides this one — a struct and an interface ' +
          'cannot have a base class — and handing it to the engine as ambiguous throws ' +
          'away a fact that needed no resolution.'
      );
    }
  }
  // `enum Backed : byte` names storage. `Backed` derives from System.Enum.
  if (!kindOf('byte').includes('ENUM_UNDERLYING_TYPE')) {
    failures += fail(
      "an enum's underlying type is not ENUM_UNDERLYING — reporting it as a base type " +
        'would say the enum derives from a primitive'
    );
  }
  // Generic arity is separated from the name.
  const repo = heritage.rows.find((r) => r[hColumn('baseTypeName')] === 'IRepo');
  if (repo === undefined) {
    failures += fail('IRepo<int, string, T> produced no heritage row');
  } else if (repo[hColumn('baseTypeArity')] !== '3') {
    failures += fail(
      `IRepo<int, string, T> has baseTypeArity ${repo[hColumn('baseTypeArity')]}, expected 3`
    );
  }
  // `class WithArgs(int a) : Base(a)` — the argument list is an INVOCATION, not
  // a heritage entry. Emitting it as one would put a call into the type graph.
  const withArgs = heritage.rows.filter((r) => r[hColumn('heritageText')] === 'Base');
  if (!withArgs.some((r) => r[hColumn('hasPrimaryConstructorArguments')] === 'true')) {
    failures += fail(
      'a primary constructor base invocation set no hasPrimaryConstructorArguments'
    );
  }
  if (heritage.rows.some((r) => r[hColumn('heritageText')]!.startsWith('('))) {
    failures += fail('an argument_list was emitted as a heritage entry');
  }
  // EVERY heritage entry has its type-reference tree, INCLUDING the ones
  // rebuilt to carry primary-constructor arguments. The rebuild dropped the
  // link set after construction — 1,758 of 8,857 entries on one stratum,
  // every one a base with arguments — and nothing but a corpus-wide count
  // could see it, because the entries with a link were also all there.
  const heritageTypeReferences = relations.get('all-csharp-type-references.csv');
  const typeReferenceHashes = new Set(
    (heritageTypeReferences?.rows ?? []).map((r) => r[heritageTypeReferences!.header.length - 1]!)
  );
  const unlinkedHeritage = heritage.rows.filter(
    (r) => !typeReferenceHashes.has(r[hColumn('csTypeReferenceLinkHash')]!)
  );
  // AND THE REFERENCE IS THE RIGHT ONE: its typeName is the entry's own
  // baseTypeName. A link that resolves is all that was checked, and a link
  // to the neighbouring entry's tree would have passed — the LINQ shape.
  // First on the link-column risk register, promoted here.
  const referenceByHash = new Map(
    (heritageTypeReferences?.rows ?? []).map((r) => [r[heritageTypeReferences!.header.length - 1]!, r])
  );
  const trName = heritageTypeReferences?.header.indexOf('typeName') ?? -1;
  for (const entry of heritage.rows) {
    const reference = referenceByHash.get(entry[hColumn('csTypeReferenceLinkHash')]!);
    if (reference !== undefined && reference[trName] !== entry[hColumn('baseTypeName')]) {
      failures += fail(
        `a heritage entry named ${entry[hColumn('baseTypeName')]} links to a type reference named ` +
          `${reference[trName]} — the wrong tree, which a resolving link cannot see`
      );
      break;
    }
  }
  if (unlinkedHeritage.length !== 0) {
    failures += fail(
      `${unlinkedHeritage.length} of ${heritage.rows.length} heritage entries name no ` +
        `type-reference row (first: ${unlinkedHeritage[0]![hColumn('heritageText')]}, ` +
        `hasPrimaryConstructorArguments=${unlinkedHeritage[0]![hColumn('hasPrimaryConstructorArguments')]})`
    );
  }
  // The SAME construct, spelled differently by the grammar: a class writes
  // `: Base(a)` flat, a record wraps it in primary_constructor_base_type.
  // Reading only the flat shape emitted baseTypeName='Parent(X)' — a name no
  // using scope can resolve — and lost the invocation, with no row missing
  // anywhere to notice it by.
  const parent = heritage.rows.find((r) => r[hColumn('baseTypeName')] === 'Parent');
  if (parent === undefined) {
    const wrapped = heritage.rows
      .map((r) => r[hColumn('baseTypeName')]!)
      .filter((n) => n.includes('('));
    failures += fail(
      "a record's base type is not named `Parent`" +
        (wrapped.length > 0
          ? ` — found ${JSON.stringify(wrapped)}, so primary_constructor_base_type is not ` +
            'being unwrapped'
          : '')
    );
  } else if (parent[hColumn('hasPrimaryConstructorArguments')] !== 'true') {
    failures += fail(
      "a record's base invocation set no hasPrimaryConstructorArguments — the wrapped " +
        'shape carries the argument_list inside the wrapper, not beside it'
    );
  }
  if (heritage.rows.some((r) => r[hColumn('baseTypeName')]!.includes('('))) {
    failures += fail('a base type name contains an argument list');
  }

  // THE CALL EDGE. `: Base(a)` on a primary constructor invokes a constructor
  // of `Base`, and it is a `cs_call_site` of kind BASE_CONSTRUCTOR_CALL owned
  // by the PRIMARY CONSTRUCTOR's method row — in both grammar shapes, the
  // class's bare argument list and the record's wrapper. The arguments alone
  // were emitted before, which is §3's defect exactly: the parts were right
  // and the edge was absent. cs-corpus counted 2,207 such calls missing,
  // 3.5% of every miss, unchanged across four sweeps.
  const callSites = relations.get('all-csharp-call-sites.csv');
  const methods = relations.get('all-csharp-methods.csv');
  if (callSites === undefined || methods === undefined) {
    return failures + fail('call sites or methods are missing');
  }
  const cCol = (n: string): number => callSites.header.indexOf(n);
  const primaryConstructorHashes = new Set(
    methods.rows
      .filter((r) => r[methods.header.indexOf('methodKind')] === 'PRIMARY_CONSTRUCTOR')
      .map((r) => r[methods.header.length - 1]!)
  );
  const baseCalls = callSites.rows.filter(
    (r) =>
      r[cCol('callKind')] === 'BASE_CONSTRUCTOR_CALL' &&
      primaryConstructorHashes.has(r[cCol('callerMethodLinkHash')]!)
  );
  const baseCallees = baseCalls.map((r) => r[cCol('calleeName')]!).sort();
  const expectedCallees = ['Base', 'Base', 'Parent'];
  if (baseCallees.join(',') !== expectedCallees.join(',')) {
    failures += fail(
      `primary-constructor base invocations are [${baseCallees.join(', ')}], expected ` +
        `[${expectedCallees.join(', ')}] — the class shape (bare argument_list in base_list), ` +
        'the nested generic class shape, and the record shape (primary_constructor_base_type), ' +
        'each a BASE_CONSTRUCTOR_CALL owned by its primary constructor and naming the base TYPE'
    );
  }
  const genericBase = baseCalls.find((r) => r[cCol('typeArgumentCount')] === '1');
  if (genericBase === undefined) {
    failures += fail('`: Base<TKey>(…)` reports no type argument on its base invocation');
  }
  // The argument that is itself a call is still walked, and it is owned by the
  // primary constructor too.
  if (
    !callSites.rows.some(
      (r) =>
        r[cCol('calleeName')] === 'Make' &&
        primaryConstructorHashes.has(r[cCol('callerMethodLinkHash')]!)
    )
  ) {
    failures += fail('the call inside a base-invocation argument is not owned by the primary constructor');
  }
  // A primary constructor with no base arguments makes no invocation.
  if (baseCalls.some((r) => r[cCol('argumentCount')] === '0')) {
    failures += fail('a primary constructor with no base arguments produced a base invocation');
  }

  const pColumn = (n: string): number => parameters.header.indexOf(n);
  const byName = new Map(parameters.rows.map((r) => [r[pColumn('name')]!, r]));

  // Declaration-site variance. `in`/`out` are ANONYMOUS tokens in this grammar,
  // so a `modifier`-only scan reads every interface as invariant and silently
  // reverses what an engine believes about assignability.
  if (byName.get('TIn')?.[pColumn('varianceModifier')] !== 'IN') {
    failures += fail('`in TIn` did not produce varianceModifier=IN');
  }
  if (byName.get('TOut')?.[pColumn('varianceModifier')] !== 'OUT') {
    failures += fail('`out TOut` did not produce varianceModifier=OUT');
  }

  // Constraints are matched to parameters BY NAME. Positional matching would
  // attach `where TIn : struct` to whichever parameter happened to be second.
  const t = [...parameters.rows].filter(
    (r) => r[pColumn('name')] === 'T' && r[pColumn('constraintText')] !== ''
  );
  // OWNER BY NAME — register 14. `TItem` is declared by the TYPE `Kinds`,
  // the second type in Spine2.cs; `Generic<T>`'s `T` by the METHOD `Generic`.
  // The owner column was an INTEGRITY read: a link to any row of the right
  // relation passed.
  {
    const methodRelation = relations.get('all-csharp-methods.csv');
    const typeNameByHash = new Map(types.rows.map((r) => [r[types.header.length - 1]!, r[types.header.indexOf('name')]!]));
    const methodNameByHash = new Map(
      (methodRelation?.rows ?? []).map((r) => [r[methodRelation!.header.length - 1]!, r[methodRelation!.header.indexOf('name')]!])
    );
    const expectedOwners: ReadonlyArray<readonly [string, string, string]> = [
      ['TItem', 'TYPE', 'Kinds'],
      ['T', 'METHOD', 'Generic'],
    ];
    for (const [name, ownerKind, ownerName] of expectedOwners) {
      const rows = parameters.rows.filter((r) => r[pColumn('name')] === name && r[pColumn('ownerKind')] === ownerKind);
      const matching = rows.filter((r) => (ownerKind === 'TYPE' ? typeNameByHash : methodNameByHash).get(r[pColumn('ownerLinkHash')]!) === ownerName);
      if (rows.length === 0 || matching.length !== 1) {
        const owners = rows.map((r) => (ownerKind === 'TYPE' ? typeNameByHash : methodNameByHash).get(r[pColumn('ownerLinkHash')]!) ?? 'no row').join(', ');
        failures += fail(
          `type parameter ${name} on a ${ownerKind}: ${rows.length} row(s), owners [${owners}] — expected exactly one owned by ${ownerName}`
        );
      }
    }
  }
  const withClassConstraint = t.find((r) => r[pColumn('hasClassConstraint')] === 'true');
  if (withClassConstraint === undefined) {
    failures += fail('`where T : class, IDisposable, new()` set no hasClassConstraint');
  } else {
    if (withClassConstraint[pColumn('hasConstructorConstraint')] !== 'true') {
      failures += fail('`new()` set no hasConstructorConstraint');
    }
    if (withClassConstraint[pColumn('constraintTypeCount')] !== '1') {
      failures += fail(
        `IDisposable is the only TYPE constraint, so constraintTypeCount must be 1, got ` +
          `${withClassConstraint[pColumn('constraintTypeCount')]} — class and new() are ` +
          'not types'
      );
    }
  }
  // `default` is a CONSTRAINT, not a type. Since v1.15 it is the only keyword
  // that reaches the type-counting branch — `class`, `struct`, `notnull`,
  // `unmanaged` and `new()` all exit earlier — so it is the only input that can
  // tell a working guard from a dead one. The negative-control harness found
  // this twice: first when `unmanaged` was the only such keyword, and again the
  // day `unmanaged` gained its own exit and the control went quiet.
  const overriderDefault = parameters.rows.filter(
    (r) => r[pColumn('name')] === 'TDef' && (r[pColumn('constraintText')] ?? '').includes('default')
  );
  if (overriderDefault.length !== 1) {
    failures += fail(
      `\`where TDef : default\` produced ${overriderDefault.length} type parameter row(s), expected 1`
    );
  } else if (overriderDefault[0]![pColumn('constraintTypeCount')] !== '0') {
    failures += fail(
      '`default` was counted as a TYPE constraint — constraintTypeCount is ' +
        `${overriderDefault[0]![pColumn('constraintTypeCount')]}, expected 0. The grammar ` +
        'reads it as an identifier type; only the keyword guard knows better'
    );
  }

  const tu = byName.get('TU');
  if (tu === undefined) {
    failures += fail('`where TU : unmanaged` produced no type parameter row');
  } else if (tu[pColumn('constraintTypeCount')] !== '0') {
    failures += fail(
      '`unmanaged` was counted as a TYPE constraint — constraintTypeCount is ' +
        `${tu[pColumn('constraintTypeCount')]}, expected 0`
    );
  } else if (tu[pColumn('hasStructConstraint')] !== 'true') {
    // CS-ORACLE-6: every structured column read false for `unmanaged`, and an
    // engine asking "is T a value type?" read no. unmanaged IMPLIES struct.
    failures += fail(
      '`where TU : unmanaged` has hasStructConstraint false — unmanaged implies the struct ' +
        'constraint, and with every boolean false the parameter reads as unconstrained'
    );
  } else if (tu[pColumn('hasUnmanagedConstraint')] !== 'true') {
    // v1.15 §3.4.1: the implied fact alone loses the specific one — `fixed`,
    // pointer types and `stackalloc` are legal on an unmanaged T and not on a
    // struct T, and a consumer reading only hasStructConstraint cannot tell.
    failures += fail(
      '`where TU : unmanaged` has hasUnmanagedConstraint false — the struct implication is ' +
        'written and the unmanaged fact is not, so unmanaged and struct are indistinguishable'
    );
  }

  const tin = byName.get('TIn');
  if (tin?.[pColumn('hasStructConstraint')] !== 'true') {
    failures += fail(
      '`where TIn : struct` did not land on TIn — constraints are matched by NAME, and ' +
        'positional matching would have attached it to the wrong parameter'
    );
  } else if (tin[pColumn('hasUnmanagedConstraint')] !== 'false') {
    // The other direction of the same distinction: a plain `struct` constraint
    // must NOT read as unmanaged, or the column is a copy of the struct flag.
    failures += fail(
      '`where TIn : struct` has hasUnmanagedConstraint true — struct does not imply unmanaged, ' +
        'and a column equal to hasStructConstraint on every row records nothing'
    );
  }

  return failures;
}

/**
 * `defineConstantsKey` is canonical, because it sits in a PRIMARY KEY.
 *
 * `cs_module`'s hash chains into every child key in the fact base. If
 * `TRACE;DEBUG` and `DEBUG;TRACE` — the same program — produced two keys, the
 * same file would partition into two module identities and every type, method
 * and expression below it would fork. Nothing would look wrong; there would
 * simply be twice as much of everything.
 *
 * Four properties, each tested, and case-sensitivity tested in the direction
 * that would be WRONG to "fix": C# preprocessor symbols are case-sensitive, so
 * `DEBUG` and `Debug` must NOT collapse.
 */
function defineConstantsCanonical(): number {
  let failures = 0;

  const key = defineConstantsKeyOf;

  if (key(['TRACE', 'DEBUG']) !== key(['DEBUG', 'TRACE'])) {
    failures += fail('order changes the key — the same program would fork into two modules');
  }
  if (key(['DEBUG', 'DEBUG']) !== key(['DEBUG'])) {
    failures += fail('a repeated symbol changes the key — it must be deduplicated');
  }
  if (key(['DEBUG']) === key(['Debug'])) {
    failures += fail(
      'DEBUG and Debug produced the same key. C# preprocessor symbols are CASE-SENSITIVE ' +
        'and folding them merges two different programs.'
    );
  }
  if (key([]) !== '') {
    failures += fail(
      'the empty set produced a digest. "" reads as "no symbols"; a digest reads as "some ' +
        'symbols whose value happens to be this", which no consumer can tell apart from a ' +
        'real key.'
    );
  }
  if (key(['DEBUG']) === key(['TRACE'])) {
    failures += fail('NEGATIVE CONTROL FAILED: two different symbol sets share a key.');
  }
  if (key(['DEBUG']) === '') {
    failures += fail('NEGATIVE CONTROL FAILED: a non-empty set produced the empty key.');
  }

  // The ordering must be ORDINAL, not locale-aware. `localeCompare` sorts
  // 'a' before 'B'; ordinal sorts 'B' before 'a'. A locale-sensitive key makes
  // the fact base depend on the machine that produced it.
  const ordinal = key(['b', 'A']);
  const asWritten = key(['A', 'b']);
  if (ordinal !== asWritten) {
    failures += fail('mixed-case sets are not order-independent');
  }

  return failures;
}

/**
 * Every grammar read the extractors make names something the grammar produces.
 *
 * ## Why this is the gate that was missing
 *
 * A read that names a node type the grammar does not produce returns **null**.
 * It does not throw. The column goes empty, the row count falls a little, and
 * nothing anywhere says so. cs-oracle priced one instance of it: the same call
 * shape gave **0 primary constructors** in a .NET 8 reference app and **173
 * generic types against 19,567 classes**, and both were caught by someone
 * finding the number implausible — which is luck.
 *
 * It is the structural counterpart of the TypeScript recall probe that reported
 * 99.8-100% across eleven corpora while being *incapable* of seeing that 31% of
 * calls were missing. This asserts the instrument can see the thing **before**
 * any number exists.
 *
 * It has already earned its keep twice on this branch: it is how
 * `primary_constructor_base_type` was found at all, and the wrapped shape was
 * emitting `baseTypeName = "Parent(X)"` with no row missing anywhere.
 */
const GRAMMAR_READS = 'src/test/csharp-gates/extractor-grammar-reads.json';
// FROM THE INSTALLED PACKAGE, not from a vendored copy. The grammar is an
// ordinary npm dependency now, so its node-type manifest travels with it — and
// reading it from node_modules means this check describes the grammar the
// parser will actually load, which a checked-in copy could silently stop doing
// after a version bump.
//
// RESOLVED THROUGH NODE, not by a relative path. A hard-coded
// `node_modules/...` assumes the package sits beside the cwd, and it does not
// everywhere: this repository's host hoists grammars to the workspace root, so
// the path existed for `tree-sitter-java` and not for this one, and the check
// reported "the grammar is not installed" about a grammar that was installed
// and loading. `require.resolve` asks the same resolver the parser itself uses.
const NODE_TYPES = ((): string => {
  try {
    return require.resolve('tree-sitter-c-sharp/src/node-types.json');
  } catch {
    // The fallback keeps the message useful when the package really is absent.
    return 'node_modules/tree-sitter-c-sharp/src/node-types.json';
  }
})();

interface GrammarRead {
  nodeType: string;
  accessor: 'child' | 'field' | 'anonymous' | 'recovery';
  name: string;
  usedBy?: string;
  why?: string;
}

interface NodeTypeEntry {
  type: string;
  named?: boolean;
  fields?: Record<string, { types?: { type: string }[] }>;
  children?: { types?: { type: string }[] };
  /** A SUPERTYPE's members. `statement` lists `preproc_if`, and a parent that admits a statement lists only `statement`. */
  subtypes?: { type: string }[];
}

function grammarReadExists(
  read: GrammarRead,
  byType: Map<string, NodeTypeEntry>,
  anonymous: ReadonlySet<string>
): string | undefined {
  if (read.accessor === 'recovery') {
    // ERROR and MISSING are universal recovery nodes. `node-types.json` never
    // lists them as a child of anything, so there is nothing to check them
    // against. The entry exists to RECORD the read, and the only assertion is
    // that it names one of the two — an unverifiable read that looks verified
    // is worse than one that admits it.
    return read.name === 'ERROR' || read.name === 'MISSING'
      ? undefined
      : `"${read.name}" is not a recovery node; only ERROR and MISSING are`;
  }

  if (read.accessor === 'anonymous') {
    // node-types.json does not list anonymous children per parent, so this can
    // only be checked against the whole anonymous vocabulary. Weaker, and said
    // so rather than dressed up as more.
    return anonymous.has(read.name)
      ? undefined
      : `"${read.name}" is not an anonymous token in this grammar`;
  }

  const entry = byType.get(read.nodeType);
  if (entry === undefined) {
    return `node type "${read.nodeType}" does not exist in this grammar`;
  }

  if (read.accessor === 'field') {
    const field = entry.fields?.[read.name];
    if (field === undefined) {
      const children = (entry.children?.types ?? []).map((t) => t.type);
      return (
        `"${read.name}" is not a FIELD of ${read.nodeType}` +
        (children.length > 0 ? `; children include: ${children.join(', ')}` : '')
      );
    }
    return undefined;
  }

  // A `child` read. Satisfied by children.types OR by any field whose types
  // include the name: node-types.json PARTITIONS contents into fields and
  // children, but the parse tree exposes a field-bound node as a named child
  // too, so a by-type scan finds both. Checking only children.types is too
  // strict and reports faults that are not there.
  //
  // And THROUGH A SUPERTYPE: where a parent admits `statement`, node-types
  // lists `statement` and not its members, so `switch_section.child(preproc_if)`
  // — a real read of a real child, the tree shows it — is listed nowhere
  // directly. A listed type that is a supertype whose subtypes include the
  // name satisfies the read; a false fault here would teach the next person
  // to declare the read as `statement`, which is not what the code reads.
  const admits = (t: { type: string }): boolean =>
    t.type === read.name || (byType.get(t.type)?.subtypes ?? []).some((sub) => sub.type === read.name);
  const fromChildren = (entry.children?.types ?? []).some(admits);
  if (fromChildren) {
    return undefined;
  }
  for (const field of Object.values(entry.fields ?? {})) {
    if ((field.types ?? []).some(admits)) {
      return undefined;
    }
  }
  const available = [
    ...(entry.children?.types ?? []).map((t) => t.type),
    ...Object.values(entry.fields ?? {}).flatMap((f) => (f.types ?? []).map((t) => t.type)),
  ];
  return (
    `"${read.name}" is neither a child nor a field of ${read.nodeType}` +
    (available.length > 0 ? `; available: ${[...new Set(available)].sort().join(', ')}` : '')
  );
}

function grammarReadExistence(): number {
  let failures = 0;

  if (!fs.existsSync(NODE_TYPES)) {
    return fail(`${NODE_TYPES} is missing — the grammar is not installed`);
  }
  const nodeTypes = JSON.parse(fs.readFileSync(NODE_TYPES, 'utf-8')) as NodeTypeEntry[];
  const byType = new Map(nodeTypes.filter((n) => n.named !== false).map((n) => [n.type, n]));
  const anonymous = new Set(nodeTypes.filter((n) => n.named === false).map((n) => n.type));

  const declared = JSON.parse(fs.readFileSync(GRAMMAR_READS, 'utf-8')) as {
    reads: GrammarRead[];
    mustFail: GrammarRead[];
  };

  for (const read of declared.reads) {
    const problem = grammarReadExists(read, byType, anonymous);
    if (problem !== undefined) {
      failures += fail(
        `${read.nodeType}.${read.accessor}(${read.name}): ${problem}` +
          (read.usedBy ? `\n      used by ${read.usedBy}` : '')
      );
    }
  }

  // NEGATIVE CONTROL, in the artifact rather than in this file so the two stay
  // together. Each entry MUST be rejected; one that is accepted means the gate
  // has stopped being able to say no.
  for (const read of declared.mustFail) {
    if (grammarReadExists(read, byType, anonymous) === undefined) {
      failures += fail(
        `NEGATIVE CONTROL FAILED: ${read.nodeType}.${read.accessor}(${read.name}) was ` +
          `ACCEPTED and must not be. ${read.why ?? ''}`
      );
    }
  }

  if (declared.reads.length === 0 || declared.mustFail.length === 0) {
    failures += fail('NEGATIVE CONTROL FAILED: the read-set or the must-fail set is empty.');
  }

  return failures;
}

/**
 * Accessors: exactly one `cs_method` row each, both directions.
 *
 * ## Why this is a day-one gate and not an assumption
 *
 * `cs_property` and `cs_method` describe the same getter BY DESIGN — IL has
 * accessors as methods, and an engine resolving `x.P` needs a declared callable
 * to resolve it TO. That makes
 * this the single most likely place in the schema for a construct to be reached
 * by two visit paths, and **duplicates do not collide, they DOUBLE**: the owner,
 * the role and the position would all be identical, so the primary key would be
 * too, and the row count would quietly double with nothing looking wrong.
 *
 * The scale is why it cannot be left implicit. Measured on a real corpus:
 * 60,783 declared accessors plus 5,666 expression-bodied properties contribute
 * **66,449 `cs_method` rows against 97,113 method declarations — a 68%
 * inflation.** Any count of methods that does not filter `isAccessor` is wrong
 * by two thirds.
 *
 * Three assertions, from the schema's §4A.2:
 *
 * 1. every declared accessor has exactly one `cs_method` row;
 * 2. `isAccessor = true` iff `ownerMemberLinkHash` is non-empty AND resolves;
 * 3. `methodKind` is an accessor kind iff `isAccessor` is true.
 */
const ACCESSOR_KINDS = new Set([
  'PROPERTY_GET', 'PROPERTY_SET', 'PROPERTY_INIT',
  'INDEXER_GET', 'INDEXER_SET', 'INDEXER_INIT', 'EVENT_ADD', 'EVENT_REMOVE',
]);

function accessorOneToOne(outputDir: string): number {
  let failures = 0;
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const methods = relations.get('all-csharp-methods.csv');
  const properties = relations.get('all-csharp-properties.csv');
  const events = relations.get('all-csharp-events.csv');
  if (methods === undefined || methods.header.length === 0) {
    return fail('all-csharp-methods.csv is missing or empty');
  }
  if (properties === undefined || events === undefined) {
    return fail('cs_property or cs_event is missing');
  }

  const mCol = (n: string): number => methods.header.indexOf(n);
  const ownerHashes = new Set<string>([
    ...properties.rows.map((r) => r[properties.header.length - 1]!),
    ...events.rows.map((r) => r[events.header.length - 1]!),
  ]);

  let accessorRows = 0;
  for (const row of methods.rows) {
    const isAccessor = row[mCol('isAccessor')] === 'true';
    const owner = row[mCol('ownerMemberLinkHash')]!;
    const kind = row[mCol('methodKind')]!;
    const ownerKind = row[mCol('ownerMemberKind')]!;

    if (isAccessor) {
      accessorRows += 1;
      if (owner === '') {
        failures += fail(
          `${row[mCol('name')]}: isAccessor is true and ownerMemberLinkHash is empty — ` +
            'an accessor belonging to nothing'
        );
      } else if (!ownerHashes.has(owner)) {
        failures += fail(
          `${row[mCol('name')]}: ownerMemberLinkHash resolves to no cs_property or cs_event`
        );
      }
      if (!ACCESSOR_KINDS.has(kind)) {
        failures += fail(`${row[mCol('name')]}: isAccessor is true but methodKind is ${kind}`);
      }
      if (ownerKind === 'NONE') {
        failures += fail(`${row[mCol('name')]}: isAccessor is true and ownerMemberKind is NONE`);
      }
    } else {
      if (owner !== '') {
        failures += fail(
          `${row[mCol('name')]}: isAccessor is false and ownerMemberLinkHash is set`
        );
      }
      if (ACCESSOR_KINDS.has(kind)) {
        failures += fail(
          `${row[mCol('name')]}: methodKind is ${kind} and isAccessor is false — the two ` +
            'columns disagree about the same fact'
        );
      }
    }
  }

  // AN INIT ACCESSOR ON AN INDEXER IS INDEXER_INIT (CS-ORACLE-4). The name
  // said `init_this[]` and the kind said INDEXER_SET — a write-once indexer
  // read as freely writable by anything switching on kind.
  const initAccessors = methods.rows.filter((r) => r[mCol('name')]!.startsWith('init_'));
  const initIndexers = initAccessors.filter((r) => r[mCol('name')] === 'init_this[]');
  if (initIndexers.length !== 1 || initIndexers[0]![mCol('methodKind')] !== 'INDEXER_INIT') {
    failures += fail(
      `${initIndexers.length} accessor(s) named init_this[] with kind [${initIndexers.map((r) => r[mCol('methodKind')]).join(',')}], ` +
        'expected exactly one INDEXER_INIT — an init accessor on an indexer is not a set'
    );
  }
  if (initAccessors.some((r) => r[mCol('methodKind')] === 'INDEXER_SET' || r[mCol('methodKind')] === 'PROPERTY_SET')) {
    failures += fail('an accessor named init_… carries a SET kind — the name and the kind disagree about the same fact');
  }

  // Exactly one row per accessor, counted from the OTHER side. `{ get; set; }`
  // is two; `=> _x` is ONE despite having no `get` keyword anywhere in source.
  const pCol = (n: string): number => properties.header.indexOf(n);
  const pPk = properties.header.length - 1;
  const rowsPerOwner = new Map<string, number>();
  for (const row of methods.rows) {
    if (row[mCol('isAccessor')] !== 'true') {
      continue;
    }
    const owner = row[mCol('ownerMemberLinkHash')]!;
    rowsPerOwner.set(owner, (rowsPerOwner.get(owner) ?? 0) + 1);
  }
  for (const property of properties.rows) {
    const expected =
      (property[pCol('hasGetter')] === 'true' ? 1 : 0) +
      (property[pCol('hasSetter')] === 'true' ? 1 : 0);
    const actual = rowsPerOwner.get(property[pPk]!) ?? 0;
    if (actual !== expected) {
      failures += fail(
        `property ${property[pCol('name')]}: ${actual} accessor cs_method row(s), ` +
          `${expected} declared. Duplicates DOUBLE — an identical PK is not an error.`
      );
    }
  }

  // A field-like event's accessors are SYNTHESIZED and appear in no source, so
  // it must contribute zero cs_method rows. Emitting rows for them would point
  // at declarations that do not exist.
  const eCol = (n: string): number => events.header.indexOf(n);
  const ePk = events.header.length - 1;
  for (const event of events.rows) {
    const rows = rowsPerOwner.get(event[ePk]!) ?? 0;
    if (event[eCol('eventKind')] === 'FIELD_LIKE' && rows !== 0) {
      failures += fail(
        `field-like event ${event[eCol('name')]} has ${rows} accessor row(s); its add and ` +
          'remove are compiler-synthesized and have no declaration anywhere'
      );
    }
    if (event[eCol('eventKind')] === 'WITH_ACCESSORS' && rows !== 2) {
      failures += fail(
        `event ${event[eCol('name')]} with explicit accessors has ${rows} row(s), expected 2`
      );
    }
  }

  if (accessorRows === 0) {
    failures += fail('NEGATIVE CONTROL FAILED: no accessor rows at all, so nothing was checked.');
  }
  if (properties.rows.length === 0) {
    failures += fail('NEGATIVE CONTROL FAILED: no cs_property rows.');
  }

  return failures;
}

/**
 * The member facts that are wrong in a column rather than missing a row.
 *
 * Every one of these passes recall, completeness and row counts. §4: a
 * correctly-positioned row with the wrong kind is invisible to every
 * count-based check there is.
 */
function memberSemantics(outputDir: string): number {
  let failures = 0;
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const methods = relations.get('all-csharp-methods.csv')!;
  const parameters = relations.get('all-csharp-method-parameters.csv')!;
  const properties = relations.get('all-csharp-properties.csv')!;
  if (methods.header.length === 0 || parameters.header.length === 0) {
    return fail('cs_method or cs_method_parameter is empty');
  }
  const mCol = (n: string): number => methods.header.indexOf(n);
  const pCol = (n: string): number => parameters.header.indexOf(n);
  const prCol = (n: string): number => properties.header.indexOf(n);
  const method = (name: string): (readonly string[]) | undefined =>
    methods.rows.find((r) => r[mCol('name')] === name);

  // `=> _x` has a getter with NO `get` keyword in the source. 5,666 sites.
  const arrow = properties.rows.find((r) => r[prCol('name')] === 'Arrow');
  if (arrow === undefined || arrow[prCol('hasGetter')] !== 'true') {
    failures += fail(
      'an expression-bodied property has no getter. There is no `get` token to find, and ' +
        'it is still a call target.'
    );
  }
  // `init` is not a flavour of `set`: it is writable only during construction.
  const req = properties.rows.find((r) => r[prCol('name')] === 'Req');
  if (req === undefined || req[prCol('setterKind')] !== 'INIT') {
    failures += fail('an `init` accessor was not recorded as INIT');
  }
  if (req !== undefined && req[prCol('isRequired')] !== 'true') {
    failures += fail('`required` was not recorded');
  }
  // Asymmetric accessor accessibility. 581 sites.
  const auto = properties.rows.find((r) => r[prCol('name')] === 'Auto');
  if (auto === undefined || auto[prCol('setAccessorAccess')] !== 'PRIVATE') {
    failures += fail('`{ get; private set; }` lost the setter\'s own accessibility');
  }

  // A cast that invokes user code. IMPLICIT is the dangerous one: it runs with
  // NO syntax at the call site, so an engine cannot find the edge by looking.
  const explicitConv = methods.rows.find(
    (r) => r[mCol('methodKind')] === 'CONVERSION_OPERATOR' && r[mCol('conversionKind')] === 'EXPLICIT'
  );
  const implicitConv = methods.rows.find(
    (r) => r[mCol('methodKind')] === 'CONVERSION_OPERATOR' && r[mCol('conversionKind')] === 'IMPLICIT'
  );
  if (explicitConv === undefined || implicitConv === undefined) {
    failures += fail('a conversion operator is missing or its conversionKind is NONE');
  }
  const op = methods.rows.find((r) => r[mCol('methodKind')] === 'OPERATOR');
  if (op === undefined || op[mCol('operatorToken')] !== '+') {
    failures += fail('an operator overload has no operatorToken');
  }

  // Explicit interface implementation: no accessibility, and NOT private.
  const explicitImpl = methods.rows.find((r) => r[mCol('explicitInterfaceName')] === 'IFoo');
  if (explicitImpl === undefined) {
    failures += fail('`void IFoo.Explicit()` recorded no explicitInterfaceName');
  } else if (explicitImpl[mCol('methodAccess')] !== 'NONE') {
    failures += fail(
      'an explicit interface implementation was given an accessibility. It has none, and ' +
        'it is NOT private — it is callable through the interface.'
    );
  }

  // An interface member defaults to PUBLIC, not private. Getting this backwards
  // reports every interface member as unreachable and prunes most of a graph.
  const implicitly = method('Implicitly');
  if (implicitly === undefined || implicitly[mCol('methodAccess')] !== 'PUBLIC') {
    failures += fail(
      'an interface member without a modifier is not PUBLIC. The default is positional: ' +
        'private in a class, public in an interface.'
    );
  }

  // An iterator does not run its body when called; it returns a state machine.
  const iter = method('Iter');
  if (iter === undefined || iter[mCol('isIterator')] !== 'true') {
    failures += fail('a `yield return` method is not marked isIterator');
  }
  if (method('Async')?.[mCol('isAsync')] !== 'true') {
    failures += fail('an async method is not marked isAsync');
  }
  // A partial DEFINITION has no body and is still a call target.
  const partialDef = method('PartialDef');
  if (partialDef === undefined || partialDef[mCol('isPartialDefinition')] !== 'true') {
    failures += fail('a partial method definition is not marked');
  }
  if (partialDef !== undefined && partialDef[mCol('bodyKind')] !== 'NONE') {
    failures += fail('a bodyless method did not get bodyKind NONE');
  }

  // Extension methods: the three facts that make the edge reconstructable.
  const extension = method('CountThem');
  if (extension === undefined || extension[mCol('isExtension')] !== 'true') {
    failures += fail('an extension method is not marked isExtension');
  }
  const thisParameter = parameters.rows.find((r) => r[pCol('parameterMode')] === 'THIS');
  if (thisParameter === undefined || thisParameter[pCol('isThis')] !== 'true') {
    failures += fail(
      'the `this` parameter of an extension method is not marked. The receiver in the ' +
        'syntax is NOT the declaring type, so without this the edge is unreconstructable.'
    );
  }

  // A #if inside an ACCESSOR LIST. Three branches, one property, and the
  // grammar produces no preproc_if — it absorbs the directive into the first
  // accessor and leaves the rest as ERROR debris. Taking every
  // accessor_declaration would emit THREE getters from branches that never
  // compile together; the `#elif` one is named after the preprocessor symbol
  // and made an unguarded table lookup THROW, failing two corpus files whole.
  const split = properties.rows.filter(
    (r) => r[prCol('name')] === 'Length' && r[prCol('csTypeLinkHash')] !== ''
  );
  if (split.length !== 1) {
    failures += fail(`expected one Length property, found ${split.length}`);
  } else {
    const owner = split[0]![properties.header.length - 1]!;
    const getters = methods.rows.filter(
      (r) => r[mCol('ownerMemberLinkHash')] === owner
    );
    if (getters.length !== 1) {
      failures += fail(
        `a property whose accessors are split across #if branches produced ` +
          `${getters.length} accessor row(s), expected 1 — only the ACTIVE branch's ` +
          'accessor may be emitted, and the three branches never compile together'
      );
    }
  }

  // `static` on a method. Derived from the modifier set, and unasserted until
  // the derived-column sweep said so.
  const staticMethods = methods.rows.filter((r) => r[mCol('isStatic')] === 'true');
  if (staticMethods.length === 0) {
    failures += fail('no method is marked isStatic, though the corpus declares several');
  }
  if (methods.rows.some((r) =>
    r[mCol('methodModifiers')]!.split(',').includes('STATIC') &&
    r[mCol('isStatic')] !== 'true'
  )) {
    failures += fail(
      'a method carries the STATIC modifier and isStatic is false. They are one fact ' +
        'recorded twice, and a consumer will trust whichever it read first.'
    );
  }

  // A REF RETURN hands back an alias, so a write through the result mutates the
  // callee's storage. `ref` lives in the RETURN TYPE, not the modifier list.
  const refReturn = method('RefReturn');
  if (refReturn === undefined || !refReturn[mCol('methodModifiers')]!.split(',').includes('REF')) {
    failures += fail(
      '`ref int M()` was not marked REF. The keyword is inside the return type as a ' +
        '`ref_type` node, so a modifier-only scan reads it as an ordinary int return and ' +
        'the write-through disappears.'
    );
  }

  // A local function is a call target a MEMBER walk never reaches.
  if (method('Inner')?.[mCol('methodKind')] !== 'LOCAL_FUNCTION') {
    failures += fail('a local function produced no cs_method row');
  }

  // Parameter modes. `out` is a SECOND RETURN CHANNEL.
  //
  // SCOPED TO THE OWNING METHOD, and the reason is a bug this gate had: a later
  // fixture added `OnClicked(object? sender, EventArgs e)`, and a map keyed on
  // bare parameter names let that `e` overwrite the `e = 5` this checks. The
  // gate then reported a parser defect that did not exist. A check keyed on a
  // name that is not unique is a check that breaks when the corpus grows.
  const modesMethod = method('Modes');
  const modesMethodHash =
    modesMethod === undefined ? '' : modesMethod[methods.header.length - 1];
  const modes = new Map(
    parameters.rows
      .filter((r) => r[pCol('csMethodLinkHash')] === modesMethodHash)
      .map((r) => [r[pCol('name')]!, r])
  );
  const expectMode = (name: string, mode: string): void => {
    const row = modes.get(name);
    if (row === undefined) {
      failures += fail(`parameter ${name} is missing entirely`);
      return;
    }
    if (row[pCol('parameterMode')] !== mode) {
      failures += fail(
        `parameter ${name} has mode ${row[pCol('parameterMode')]}, expected ${mode}`
      );
    }
  };
  expectMode('a', 'REF');
  expectMode('b', 'OUT');
  expectMode('c', 'IN');
  // `params` is NOT wrapped in a `parameter` node — it is flat siblings on the
  // parameter list — so a scan for `parameter` children drops it entirely.
  expectMode('d', 'PARAMS');
  expectMode('e', 'VALUE');
  const scopedWrapper = modes.get('f');
  if (scopedWrapper === undefined || scopedWrapper[pCol('scopedModifier')] !== 'SCOPED') {
    failures += fail(
      '`scoped Span<int> f` lost its scoped modifier. The grammar wraps it in a ' +
        '`scoped_type` here and emits a `modifier` in the `scoped ref` form — one ' +
        'construct, two shapes.'
    );
  }
  if (scopedWrapper !== undefined && scopedWrapper[pCol('completeTypeName')]!.startsWith('scoped')) {
    failures += fail(
      'a parameter type name begins with `scoped` — the keyword is glued to the type and ' +
        'no using scope will resolve it'
    );
  }
  if (modes.get('g')?.[pCol('scopedModifier')] !== 'SCOPED') {
    failures += fail('`scoped ref int g` lost its scoped modifier');
  }
  if (modes.get('e')?.[pCol('defaultValueText')] !== '5') {
    failures += fail('a default value was not recorded');
  }
  // Node WRAPPERS are not identity-stable, so a parameter's own type once ended
  // up in defaultValueText. Nothing may have a default it did not declare.
  for (const row of parameters.rows) {
    const hasDefault = row[pCol('hasDefaultValue')] === 'true';
    const text = row[pCol('defaultValueText')]!;
    if (!hasDefault && text !== '') {
      failures += fail(
        `parameter ${row[pCol('name')]} has no default and defaultValueText is ` +
          `${JSON.stringify(text)} — node wrappers compared by identity again`
      );
    }
  }

  return failures;
}

/**
 * The type-reference tree: a tree, and the right shape at each node.
 *
 * ## Why a tree and not a string
 *
 * C# generics are **reified**. `List<int>` and `List<string>` are distinct
 * runtime types with distinct method tables, where Java erases both to `List`.
 * So "which constructions of `List` exist in this program" is a question about
 * reachable code in C# and is not one in Java, and flattening the arguments
 * into `completeTypeName` makes it unanswerable.
 *
 * ## Wrapper or column, checked per shape
 *
 * Four shapes have a COLUMN and must NOT produce a wrapper node — an extra node
 * that says only what a boolean already says hides the real shape behind it.
 * Three shapes have no column and must produce children.
 */
function typeReferenceTree(outputDir: string): number {
  let failures = 0;
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const refs = relations.get('all-csharp-type-references.csv');
  if (refs === undefined || refs.header.length === 0) {
    return fail('all-csharp-type-references.csv is missing or empty');
  }
  const c = (n: string): number => refs.header.indexOf(n);
  const pk = refs.header.length - 1;
  const byComplete = (text: string): (readonly string[])[] =>
    refs.rows.filter((r) => r[c('completeTypeName')] === text);

  // The tree is well formed: every non-empty parent resolves, and a child's
  // depth is exactly one more than its parent's.
  const byHash = new Map(refs.rows.map((r) => [r[pk]!, r]));
  for (const row of refs.rows) {
    const parent = row[c('parentReferenceHash')]!;
    if (parent === '') {
      if (row[c('depth')] !== '0') {
        failures += fail(`a root type reference has depth ${row[c('depth')]}, expected 0`);
      }
      continue;
    }
    const parentRow = byHash.get(parent);
    if (parentRow === undefined) {
      failures += fail(`type reference ${row[c('completeTypeName')]} has an unresolvable parent`);
      continue;
    }
    if (Number(row[c('depth')]) !== Number(parentRow[c('depth')]) + 1) {
      failures += fail(
        `type reference ${row[c('completeTypeName')]} is at depth ${row[c('depth')]} under a ` +
          `parent at ${parentRow[c('depth')]}`
      );
    }
  }

  // Nested generics keep their structure. The root is CONSTRUCTED with two
  // arguments; one of those is itself CONSTRUCTED with a nullable argument.
  const dict = refs.rows.find(
    (r) => r[c('typeName')]!.endsWith('Dictionary') && r[c('depth')] === '0'
  );
  if (dict === undefined) {
    failures += fail('the nested Dictionary reference is missing');
  } else {
    if (dict[c('kind')] !== 'CONSTRUCTED') {
      failures += fail(`Dictionary<..> is ${dict[c('kind')]}, expected CONSTRUCTED`);
    }
    if (dict[c('typeArgumentCount')] !== '2') {
      failures += fail(
        `Dictionary<..> has typeArgumentCount ${dict[c('typeArgumentCount')]}, expected 2. ` +
          'A QUALIFIED generic puts its arity on the LAST segment; reading the outermost ' +
          'node reports 0 for most of the BCL as it is actually written.'
      );
    }
    const children = refs.rows.filter((r) => r[c('parentReferenceHash')] === dict[pk]);
    if (children.length !== 2) {
      failures += fail(`Dictionary<..> has ${children.length} child references, expected 2`);
    }
    const list = children.find((r) => r[c('typeName')]!.endsWith('List'));
    if (list === undefined) {
      failures += fail('the inner List<int?> reference is missing — the tree was flattened');
    } else {
      const inner = refs.rows.filter((r) => r[c('parentReferenceHash')] === list[pk]);
      if (inner.length !== 1 || inner[0]![c('isNullableAnnotated')] !== 'true') {
        failures += fail('List<int?>\'s argument lost its nullable annotation');
      }
    }
  }

  // COLUMN, not a wrapper. `int[,]` is ONE row with rank 2.
  const rank2 = byComplete('int[,]');
  if (rank2.length !== 1) {
    failures += fail(`int[,] produced ${rank2.length} rows, expected 1`);
  } else if (rank2[0]![c('arrayRank')] !== '2') {
    failures += fail(
      `int[,] has arrayRank ${rank2[0]![c('arrayRank')]}, expected 2 — the rank is commas ` +
        'plus one, not the bracket count'
    );
  }
  // `int?[]` collapses BOTH wrappers into one row.
  const nullableArray = byComplete('int?[]');
  if (nullableArray.length !== 1) {
    failures += fail(`int?[] produced ${nullableArray.length} rows, expected 1`);
  } else {
    if (nullableArray[0]![c('arrayRank')] !== '1') {
      failures += fail('int?[] lost its array rank');
    }
    if (nullableArray[0]![c('isNullableAnnotated')] !== 'true') {
      failures += fail('int?[] lost its nullable annotation');
    }
  }
  const maybe = byComplete('string?');
  if (maybe.length === 0 || maybe.every((r) => r[c('isNullableAnnotated')] !== 'true')) {
    failures += fail('string? is not marked isNullableAnnotated');
  }

  // WRAPPER, because there is no column. A tuple's ELEMENT TYPES have no other
  // home, and a pointer and a ref are not the things they point at.
  const tuple = byComplete('(int X, string Y)');
  if (tuple.length !== 1) {
    failures += fail(`a tuple type produced ${tuple.length} rows, expected 1 root`);
  } else {
    if (tuple[0]![c('tupleElementCount')] !== '2') {
      failures += fail('a tuple lost its element count');
    }
    if (tuple[0]![c('isTuple')] !== 'true') {
      failures += fail('a tuple type is not marked isTuple');
    }
    if (refs.rows.some((r) => r[c('isTuple')] === 'true' && r[c('kind')] !== 'TUPLE')) {
      failures += fail('isTuple and kind disagree');
    }
    if (tuple[0]![c('typeArgumentCount')] !== '0') {
      failures += fail(
        'a tuple reported typeArgumentCount — its elements are not type ARGUMENTS, and ' +
          'counting them there makes the column mean "children"'
      );
    }
    const elements = refs.rows.filter((r) => r[c('parentReferenceHash')] === tuple[0]![pk]);
    if (elements.length !== 2) {
      failures += fail(
        `a tuple has ${elements.length} element references, expected 2 — tupleElementCount ` +
          'alone loses their TYPES'
      );
    }
  }
  const pointer = byComplete('int*');
  if (pointer.length === 0 || pointer.some((r) => r[c('isPointer')] !== 'true')) {
    failures += fail('int* is not marked isPointer');
  }
  // At LEAST one, and every one a REF. Two fixtures declare `ref int`, and an
  // exact count here would fail on a corpus growing rather than on a defect —
  // the check must be about the SHAPE, not about how many times it appears.
  const refReturn = byComplete('ref int');
  if (refReturn.length === 0 || refReturn.some((r) => r[c('kind')] !== 'REF')) {
    failures += fail('`ref int` did not produce a REF reference — an alias is not the thing');
  }
  const dyn = byComplete('dynamic');
  if (dyn.length === 0 || dyn.some((r) => r[c('kind')] !== 'DYNAMIC')) {
    failures += fail('`dynamic` was read as an ordinary named type');
  }

  // `T` is a TYPE VARIABLE, not a reference to a type named T. An engine that
  // cannot tell will search every using in scope for a type that does not
  // exist. The distinction is purely syntactic — the enclosing declarations'
  // parameter lists say which names are bound — so it costs nothing to be right
  // and it is wrong on every generic method otherwise.
  const typeVariables = refs.rows.filter((r) => r[c('kind')] === 'TYPE_PARAMETER');
  if (typeVariables.length === 0) {
    failures += fail(
      'no reference was classified TYPE_PARAMETER. Every `T` is being reported as a ' +
        'reference to a type named T.'
    );
  }
  const typeParameterRelation = relations.get('all-csharp-type-parameters.csv');
  const parameterNameByHash = new Map(
    (typeParameterRelation?.rows ?? []).map((r) => [r[typeParameterRelation!.header.length - 1]!, r[typeParameterRelation!.header.indexOf('name')]!])
  );
  for (const row of typeVariables) {
    // AND IT IS THE PARAMETER OF THAT NAME: `T` links to the cs_type_parameter
    // row named T, not to a sibling parameter. Sixth on the risk register.
    const linked = parameterNameByHash.get(row[c('typeParameterLinkHash')]!);
    if (linked !== undefined && linked !== row[c('typeName')]) {
      failures += fail(
        `type variable ${row[c('typeName')]} links to the type parameter named ${linked} — the ` +
          'wrong row, which a resolving link cannot see'
      );
      break;
    }
    if (row[c('typeParameterLinkHash')] === '') {
      failures += fail(
        `type variable ${row[c('typeName')]} has no typeParameterLinkHash — the binding ` +
          'it names is in the same file and one hop away'
      );
    }
  }
  // And the converse: a real type name must NOT be classified as a variable.
  const misclassified = refs.rows.filter(
    (r) => r[c('kind')] === 'TYPE_PARAMETER' && r[c('typeName')]!.includes('.')
  );
  if (misclassified.length > 0) {
    failures += fail(`${misclassified.length} qualified name(s) classified as type variables`);
  }

  // A generic tree walk is what puts type names into the call graph. Every row
  // here must have come from a NAMED context.
  const contexts = new Set(refs.rows.map((r) => r[c('context')]!));
  if (contexts.has('')) {
    failures += fail('a type reference has no context — it came from a generic walk');
  }
  if (refs.rows.length === 0) {
    failures += fail('NEGATIVE CONTROL FAILED: no type references at all.');
  }

  return failures;
}

/**
 * The four `using` forms, and the one that appears in no file.
 *
 * ## Why this relation is engine-critical
 *
 * **Extension-method visibility is decided by the `using` set in scope.**
 * `xs.Count()` calls a method declared on a static class the receiver has never
 * heard of, and whether that method is visible depends on which namespaces are
 * imported at the call site. Three facts make the edge reconstructable — the
 * `this`-parameter marker, the declaring static class, and this — and a missing
 * row here is a call edge nothing can rebuild.
 *
 * The IMPLICIT case is the one with no syntax: 59 projects in the measured
 * corpus enable `<ImplicitUsings>`, and `System.Linq` is then in scope for every
 * file with no directive to point at. A file-walking extractor produces zero
 * rows for exactly the namespaces `xs.Where(…)` needs.
 */
function usingForms(outputDir: string): number {
  let failures = 0;
  const usings = readRelations(outputDir).find((r) => r.name === 'all-csharp-usings.csv');
  if (usings === undefined || usings.header.length === 0) {
    return fail('all-csharp-usings.csv is missing or empty');
  }
  const c = (n: string): number => usings.header.indexOf(n);
  const kinds = new Set(usings.rows.map((r) => r[c('usingKind')]!));

  for (const expected of [
    'NAMESPACE',
    'STATIC',
    'ALIAS',
    'GLOBAL_NAMESPACE',
    'GLOBAL_STATIC',
    'GLOBAL_ALIAS',
    'IMPLICIT',
  ]) {
    if (!kinds.has(expected)) {
      failures += fail(`no using row of kind ${expected}`);
    }
  }

  // `using static` puts a type's MEMBERS in scope unqualified, so a bare
  // `Sqrt(x)` becomes a call. Folding it into NAMESPACE would make every such
  // call unresolvable.
  const staticUsing = usings.rows.find(
    (r) => r[c('usingKind')] === 'STATIC' && r[c('namespaceOrTypeName')] === 'System.Console'
  );
  if (staticUsing === undefined || staticUsing[c('isStatic')] !== 'true') {
    failures += fail('`using static System.Console` is not marked isStatic');
  }

  // An alias TARGET may be a constructed generic, which is a type expression
  // and not a name — a consumer resolving names must not be handed one.
  const generic = usings.rows.find((r) => r[c('aliasName')] === 'Sh');
  if (generic === undefined) {
    failures += fail('the alias `Sh` is missing');
  } else if (!generic[c('aliasTargetText')]!.includes('<')) {
    failures += fail('an alias to a constructed generic lost its type arguments');
  }

  // A `global using` applies to EVERY file in the compilation, so its scope is
  // the assembly and not the file it is written in.
  const globals = usings.rows.filter((r) => r[c('isGlobal')] === 'true');
  if (globals.length < 4) {
    failures += fail(`only ${globals.length} global usings; expected 3 written plus implicits`);
  }

  // IMPLICIT rows have no file and no line, and must say so rather than
  // pointing at line 1 of a file that does not contain them.
  const implicits = usings.rows.filter((r) => r[c('isImplicit')] === 'true');
  if (implicits.length === 0) {
    failures += fail('no IMPLICIT using rows — the SDK-injected namespaces are missing');
  }
  for (const row of implicits) {
    if (row[c('startLine')] !== '0' || row[c('originFile')] !== '') {
      failures += fail(
        'an IMPLICIT using claims a line or a file. It appears in NO file anywhere, and ' +
          'pointing at one would send a reader to source that does not contain it.'
      );
    }
    if (row[c('isGlobal')] !== 'true') {
      failures += fail(
        'an IMPLICIT using is not marked global — it applies to every file of the project, ' +
          'so a rule filtering on isGlobal must find it'
      );
    }
  }

  // A `using` in an inactive #if branch is NOT in scope, and emitting it would
  // make an extension method appear visible where it is not — the direction
  // that INVENTS an edge, which is worse than losing one.
  const names = new Set(usings.rows.map((r) => r[c('namespaceOrTypeName')]!));
  if (!names.has('Active.Branch')) {
    failures += fail('the using in the ACTIVE #if branch is missing');
  }
  if (names.has('Inactive.Branch')) {
    failures += fail('a using came from an inactive #if branch');
  }

  // A `using` inside a namespace body governs only that namespace, and must
  // still be found — it is not a top-level child of the compilation unit.
  if (!names.has('Scoped.Inner')) {
    failures += fail('a using declared inside a namespace body was not found');
  }

  // `using (var x = …)` is a DISPOSAL SCOPE, not an import. A generic walk finds
  // it and would put a variable declaration into the import relation.
  if ([...names].some((n) => n.startsWith('var '))) {
    failures += fail('a `using` STATEMENT was emitted as an import directive');
  }

  return failures;
}

/**
 * The parse losses are ROWS.
 *
 * 3.01% of a real corpus errors. As a percentage that is a fact nobody can act
 * on, and a regression to 5% would show up as slightly fewer rows everywhere and
 * nothing else. With rows it is a query.
 *
 * The gate corpus contains a `#if` inside an accessor list, which the grammar
 * recovers from with bare ERROR siblings — so there is something to find, and a
 * run reporting zero gaps means the extractor stopped looking.
 */
function parseGapsAreRows(outputDir: string, corpusDir: string): number {
  let failures = 0;
  const allRelations = readRelations(outputDir);
  const gaps = allRelations.find((r) => r.name === 'all-csharp-parse-gaps.csv');
  const modules = allRelations.find((r) => r.name === 'all-csharp-modules.csv');
  if (gaps === undefined || modules === undefined) {
    return fail('all-csharp-parse-gaps.csv or all-csharp-modules.csv is missing');
  }
  const m = (n: string): number => modules.header.indexOf(n);
  if (gaps.header.length === 0 || gaps.rows.length === 0) {
    return fail(
      'zero parse gaps. The corpus contains a #if inside an accessor list, which this ' +
        'grammar recovers from with ERROR siblings, so there IS something to find — a null ' +
        'result here means the extractor is not looking.'
    );
  }
  const c = (n: string): number => gaps.header.indexOf(n);

  for (const row of gaps.rows) {
    const coverage = Number(row[c('coveragePercent')]);
    if (coverage > 100) {
      failures += fail(
        `a gap covers ${coverage}% of its file. The MAXIMAL ERROR is the unit; descending ` +
          'into one counts the same bytes at every level.'
      );
      break;
    }
    // MISSING_NODE and PREPROC_FRAGMENT are not byte-fraction buckets. The
    // first is zero-width; the second is a DIAGNOSIS — a #if the grammar could
    // not nest — and filing it by size would put the 1.60% irreducible in the
    // same bucket as the 1.41% that is a real grammar gap. The two need
    // different actions.
    if (
      row[c('gapKind')] === 'INSERTED_NODE' ||
      row[c('gapKind')] === 'SELF_REPORTING_NODE' ||
      row[c('gapKind')] === 'PREPROC_FRAGMENT'
    ) {
      continue;
    }
    const expected =
      coverage > 50 ? 'ERROR_TRUNCATING' : coverage >= 5 ? 'ERROR_PARTIAL' : 'ERROR_LOCAL';
    if (row[c('gapKind')] !== expected) {
      failures += fail(
        `a gap covering ${coverage}% is ${row[c('gapKind')]}, expected ${expected}`
      );
      break;
    }
  }

  // THE MAXIMAL ERROR IS THE UNIT, and this is the assertion that says so.
  //
  // Checking each gap against 100% individually is not enough — the negative
  // control that descends into an ERROR and emits a row per child passed it,
  // because every child carried the PARENT's coverage and none exceeded 100 on
  // its own. What descending actually breaks is the SUM: the same bytes get
  // counted once per level, and a file's gaps then add up to more of it than
  // exists.
  const coverageByModule = new Map<string, number>();
  for (const row of gaps.rows) {
    const module = row[c('csModuleLinkHash')]!;
    coverageByModule.set(
      module,
      (coverageByModule.get(module) ?? 0) + Number(row[c('coveragePercent')])
    );
  }
  for (const [module, total] of coverageByModule) {
    if (total > 100.5) {
      failures += fail(
        `one module's gaps cover ${total.toFixed(1)}% of it. The same bytes are being ` +
          `counted at more than one level — descend into a maximal ERROR and every ` +
          `nested node repeats its parent's span. (${module})`
      );
      break;
    }
  }

  // Every bucket that IS byte-fraction-based must be reachable, or the
  // thresholds are untested and the monotonicity cs-oracle validated is a claim
  // about code nobody runs.
  const buckets = new Set(gaps.rows.map((r) => r[c('gapKind')]!));
  // SELF_REPORTING_NODE IS RESERVED AGAIN, and the reason is a repair rather
  // than a grammar change: the one shape that produced it — a `#pragma` on the
  // last line of a file with no trailing newline — is now readable, because the
  // parser supplies the terminator. The FALLBACK stays, because the next
  // unlocatable shape is not knowable in advance, and its value carries a
  // zero-row assertion in the enum audit.
  for (const bucket of [
    'ERROR_LOCAL',
    'ERROR_TRUNCATING',
    'INSERTED_NODE',
    'PREPROC_FRAGMENT',
  ]) {
    if (!buckets.has(bucket)) {
      failures += fail(`no ${bucket} gap in the corpus, so that bucket is untested`);
    }
  }

  // THE LAST BYTE, pinned. `GapUnlocatable.cs` produces SELF_REPORTING_NODE
  // only because it does NOT end in a newline, and a byte-identical file that
  // does must produce no gap at all. Both halves are asserted, and the byte
  // itself is read back from disk rather than trusted from the template.
  const unterminated = fs.readFileSync(path.join(corpusDir, 'GapUnlocatable.cs'));
  const terminated = fs.readFileSync(path.join(corpusDir, 'GapUnlocatableControl.cs'));
  if (unterminated[unterminated.length - 1] === 0x0a) {
    failures += fail(
      'GapUnlocatable.cs ends in a newline. Its last byte is load-bearing — an editor ' +
        'adding a final newline has turned the trigger into its own control.'
    );
  }
  if (terminated[terminated.length - 1] !== 0x0a) {
    failures += fail('GapUnlocatableControl.cs does not end in a newline, so it is not a control');
  }
  const gapsIn = (fileName: string): (readonly string[])[] => {
    const module = modules.rows.find((r) => (r[m('fileName')] ?? '').endsWith(fileName));
    const hash = module?.[modules.header.length - 1] ?? '';
    return gaps.rows.filter((r) => r[c('csModuleLinkHash')] === hash);
  };
  // THE TERMINATOR, AND ITS CONTROL — asserted in both directions, which is
  // what makes the claim about the terminator rather than about the file.
  //
  // The published grammar's `#pragma` has only a NEWLINE terminator, so a
  // pragma on the last line of a file without one made the root report an error
  // with nothing locatable under it. The parser now ENDS THE TEXT WITH A
  // NEWLINE before parsing — nothing follows it, so no position moves — and
  // both files are therefore clean. The trigger's last byte is still pinned
  // above: it is what keeps this pair a pair, and the day the rewrite is
  // removed this assertion is what says which half broke.
  for (const fileName of ['GapUnlocatable.cs', 'GapUnlocatableControl.cs']) {
    const rows = gapsIn(fileName);
    if (rows.length !== 0) {
      failures += fail(
        `${fileName} produced ${rows.length} gap row(s) [${rows.map((r) => r[c('gapKind')]).join(',')}]. ` +
          'A pragma at the end of a file is READ — the parser supplies the terminator the ' +
          'grammar requires — so a gap row here says the file could not be read when it was.'
      );
    }
  }

  // AN INDEPENDENT ORACLE FOR THE INVARIANT.
  //
  // Every other assertion here reads the fact base, and the fact base cannot
  // tell you about a file it says nothing about. `parseErrorCount` is DERIVED
  // from the gaps, so comparing them is circular and cannot catch a whole file
  // going unrecorded.
  //
  // So the corpus is re-parsed here and `rootNode.hasError` — which no part of
  // the extractor produced — is compared against the presence of a gap row. On
  // the real corpus this found 26 files, 9.3% of every file with a parse error,
  // producing NO row in the relation whose entire purpose is to say where the
  // losses are.
  const parser = new CSharpParser();
  const errorFiles = new Set<string>();
  for (const [name, source] of Object.entries(GATE_CORPUS)) {
    // THROUGH THE SHIPPED PIPELINE. This oracle exists to be independent of the
    // fact base, not independent of the PARSER — and parsing the raw source
    // made it independent of both: it saw errors in the `#if` arms the parser
    // blanks away, then reported that the gap relation was silent about them.
    // An oracle that describes a parser nobody runs manufactures its own
    // findings.
    // THE WHOLE CHAIN, not just the blanking. Three more passes joined it since
    // — the semicolon-body rewrite, the `ref` rotation and the trailing newline
    // — and an oracle that applies one of four describes a parser nobody runs
    // just as surely as one that applies none. It reported `GapUnlocatable.cs`
    // as a silent gap for exactly that reason: the shipped parser reads it.
    if (parser.parse(asShippedPreParse(source)).rootNode.hasError) {
      errorFiles.add(name);
    }
  }
  if (errorFiles.size === 0) {
    failures += fail(
      'NEGATIVE CONTROL FAILED: no gate-corpus file has a parse error, so the invariant ' +
        'below is vacuously true.'
    );
  }
  const modulesForFiles = readRelations(outputDir).find(
    (r) => r.name === 'all-csharp-modules.csv'
  );
  if (modulesForFiles !== undefined && modulesForFiles.header.length > 0) {
    const fileNameColumn = modulesForFiles.header.indexOf('fileName');
    const pkColumn = modulesForFiles.header.length - 1;
    const gapModules = new Set(gaps.rows.map((r) => r[c('csModuleLinkHash')]!));
    for (const row of modulesForFiles.rows) {
      const fileName = row[fileNameColumn]!;
      const hasError = errorFiles.has(fileName);
      const hasGap = gapModules.has(row[pkColumn]!);
      if (hasError && !hasGap) {
        failures += fail(
          `${fileName} fails to parse and produced NO cs_parse_gap row. A gap relation ` +
            'silent about a gap is the section 7 failure exactly: it reports clean because ' +
            'it cannot see.'
        );
      }
      if (!hasError && hasGap) {
        failures += fail(`${fileName} parses clean and produced a gap row`);
      }
    }
  }

  // THE KIND, PER FILE — not just that a row exists.
  //
  // The fallback means a file with an unreachable defect still gets a row, so
  // every check that only asks "is there a row" passes even when the mechanism
  // that should have found it is broken. Two negative controls proved that:
  // disabling the named-children walk and disabling zero-width detection both
  // left the invariant intact, because the fallback quietly covered for them.
  //
  // That is section 4 exactly: a correctly-positioned row with the WRONG KIND is
  // invisible to every count-based check there is. So the kind is asserted
  // against the shape each fixture was written to produce.
  if (modulesForFiles !== undefined && modulesForFiles.header.length > 0) {
    const fileNameColumn = modulesForFiles.header.indexOf('fileName');
    const pkColumn = modulesForFiles.header.length - 1;
    const kindsByFile = new Map<string, Set<string>>();
    for (const module of modulesForFiles.rows) {
      const kinds = new Set(
        gaps.rows
          .filter((g) => g[c('csModuleLinkHash')] === module[pkColumn])
          .map((g) => g[c('gapKind')]!)
      );
      kindsByFile.set(module[fileNameColumn]!, kinds);
    }
    const expectKind = (fileName: string, kind: string, why: string): void => {
      const kinds = kindsByFile.get(fileName);
      if (kinds === undefined) {
        failures += fail(`${fileName} has no cs_module row`);
        return;
      }
      if (!kinds.has(kind)) {
        failures += fail(
          `${fileName} produced ${[...kinds].join(',') || 'nothing'} and not ${kind}. ${why}`
        );
      }
    };
    expectKind(
      'GapMissing.cs',
      'INSERTED_NODE',
      'An inserted `;` is an ANONYMOUS token, so a named-only walk cannot reach it and the ' +
        'fallback covers for the miss with the wrong kind.'
    );
    expectKind(
      'GapZeroWidth.cs',
      'INSERTED_NODE',
      'This node has isMissing FALSE and zero width. Trusting isMissing loses it, and the ' +
        'fallback covers for the miss with the wrong kind.'
    );
    expectKind(
      'GapTruncating.cs',
      'ERROR_TRUNCATING',
      'Over half the file is inside one ERROR.'
    );
    expectKind('GapLocal.cs', 'ERROR_LOCAL', 'Under 5% of the file is inside an ERROR.');
    // Members.cs is NOT expected to produce a PREPROC_FRAGMENT any more. Its
    // `#if`-split accessor list was the fork's irreducible case; the parser now
    // blanks the arms this emission does not compile, so the file arrives as
    // ordinary C# and parses clean. A fragment kind that can no longer occur
    // here would be an expectation about a parser nobody runs.
  }

  // cs_module.parseErrorCount and cs_parse_gap CANNOT DISAGREE. They did: the
  // module counted only ERROR and isMissing nodes and pruned on hasError, while
  // the gap extractor learned that NEITHER test is sufficient. A summary column
  // that contradicts the rows it summarises is worse than not having it.
  //
  // The negative control "count module parse errors separately from the gap
  // rows" passed through this block unseen for as long as it read a relation
  // named `all-csharp-moduleRows.csv` — which does not exist, so the guard
  // below skipped the whole assertion. `modules` is the relation loaded at the
  // top of this function, and the guard is now a FAILURE, not a skip.
  {
    const countColumn = m('parseErrorCount');
    if (countColumn < 0) {
      failures += fail('cs_module has no parseErrorCount column');
    }
    const modulePk = modules.header.length - 1;
    const gapsPerModule = new Map<string, number>();
    for (const row of gaps.rows) {
      const module = row[c('csModuleLinkHash')]!;
      gapsPerModule.set(module, (gapsPerModule.get(module) ?? 0) + 1);
    }
    let compared = 0;
    for (const row of modules.rows) {
      const declared = Number(row[countColumn]);
      const actual = gapsPerModule.get(row[modulePk]!) ?? 0;
      compared += 1;
      if (declared !== actual) {
        failures += fail(
          `a module declares parseErrorCount ${declared} and has ${actual} cs_parse_gap ` +
            'row(s). The summary and the rows must be one derivation, not two counters.'
        );
        break;
      }
    }
    if (compared === 0) {
      failures += fail('no cs_module row was compared against its gap rows');
    }
  }

  // The parent's type is the DIAGNOSIS — `accessor_list` says a #if split a
  // property. A gap without one is a position and not a finding.
  if (gaps.rows.every((r) => r[c('parentNodeType')] === '')) {
    failures += fail('no gap records its parent node type, so none of them says what broke');
  }

  return failures;
}

/**
 * Fields and enum members: the ordinal that stops two rows collapsing, and the
 * value the parser deliberately does not compute.
 */
function fieldsAndEnumMembers(outputDir: string): number {
  let failures = 0;
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const fields = relations.get('all-csharp-fields.csv');
  const members = relations.get('all-csharp-enum-members.csv');
  if (fields === undefined || fields.header.length === 0) {
    return fail('all-csharp-fields.csv is missing or empty');
  }
  if (members === undefined || members.header.length === 0) {
    return fail('all-csharp-enum-members.csv is missing or empty');
  }
  const f = (n: string): number => fields.header.indexOf(n);
  const m = (n: string): number => members.header.indexOf(n);

  // OWNER COLUMNS BY NAME. Every member relation carries `csTypeLinkHash`,
  // and until this table the suite read it only as a SELECTOR — a row filed
  // under the wrong type resolves, and filing EVERY type's members under the
  // first type in its file failed exactly one assertion in the whole suite.
  // The partition had called these "asserted by meaning indirectly". They
  // were not. So: for one member of each relation, declared in a type that is
  // NOT first in its file, the linked type row must carry the declaring
  // type's name.
  const typeRelation = relations.get('all-csharp-types.csv')!;
  const typeNameByHash = new Map(
    typeRelation.rows.map((r) => [r[typeRelation.header.length - 1]!, r[typeRelation.header.indexOf('name')]!])
  );
  const owners: ReadonlyArray<readonly [string, string, string]> = [
    ['all-csharp-methods.csv', 'MakeSeeds', 'Kinds'],
    ['all-csharp-fields.csv', 'Seeded', 'Kinds'],
    ['all-csharp-properties.csv', 'Configured', 'Kinds'],
    ['all-csharp-events.csv', 'Raised', 'Generic'],
    ['all-csharp-enum-members.csv', 'Computed', 'Values'],
    // NESTED: `Inner` sits inside `Documented`, and its enclosing type is the
    // neighbouring row an owner link is likeliest to name instead.
    ['all-csharp-enum-members.csv', 'Current', 'Inner'],
  ];
  for (const [relationName, memberName, declaringType] of owners) {
    const relation = relations.get(relationName);
    if (relation === undefined || relation.header.length === 0) {
      failures += fail(`${relationName} is missing or empty, so ${memberName}'s owner cannot be read`);
      continue;
    }
    const rows = relation.rows.filter((r) => r[relation.header.indexOf('name')] === memberName);
    if (rows.length !== 1) {
      failures += fail(`${rows.length} row(s) named ${memberName} in ${relationName}, expected exactly 1`);
      continue;
    }
    const owner = typeNameByHash.get(rows[0]![relation.header.indexOf('csTypeLinkHash')]!);
    if (owner !== declaringType) {
      failures += fail(
        `${relationName}'s ${memberName} is filed under ${owner === undefined ? 'no type row' : `the type ${owner}`} ` +
          `— expected ${declaringType}, the type that declares it`
      );
    }
  }

  // `int a, b;` is ONE declaration and TWO fields. They share a type, a modifier
  // set, a line and an owner, so declarationIndex is the only thing separating
  // their keys — without it one of them is lost, which is the inverse of the
  // doubling problem and just as silent.
  // SELECTED BY NAME, not by `isConst` across the whole corpus. The corpus-wide
  // filter made this assertion a hostage of every later fixture — a `const`
  // added anywhere failed a check about a declaration that had not changed, and
  // the failure named the parser for a change in the test data. Third instance
  // of that shape in this file; all three are now scoped.
  const consts = fields.rows.filter(
    (r) => r[f('name')] === 'ConstOne' || r[f('name')] === 'ConstTwo'
  );
  if (consts.length !== 2) {
    failures += fail(
      `\`const int ConstOne = 1, ConstTwo = 2;\` produced ${consts.length} field rows, ` +
        'expected 2. One declaration, N fields.'
    );
  } else {
    const indices = consts.map((r) => r[f('declarationIndex')]).sort();
    if (indices.join(',') !== '0,1') {
      failures += fail(`the two declarators got declarationIndex ${indices.join(',')}`);
    }
    if (new Set(consts.map((r) => r[fields.header.length - 1])).size !== 2) {
      failures += fail('two declarators of one field declaration share a primary key');
    }
    // `const` is implicitly static, and a rule asking for static state must
    // find it.
    if (consts.some((r) => r[f('isConst')] !== 'true')) {
      failures += fail('`const int ConstOne = 1;` is not marked const');
    }
    if (consts.some((r) => r[f('isStatic')] !== 'true')) {
      failures += fail('a `const` field is not marked static — const is implicitly static');
    }
  }
  // A PROPERTY'S TOO: `Tagged { get; set; } = 7` links to the LITERAL 7 as a
  // PROPERTY_INITIALIZER root owned by Tagged.
  const propertyRelation = relations.get('all-csharp-properties.csv');
  const propertyExpressions = relations.get('all-csharp-expressions.csv');
  if (propertyRelation !== undefined && propertyExpressions !== undefined) {
    const px = (n: string): number => propertyExpressions.header.indexOf(n);
    const pr = (n: string): number => propertyRelation.header.indexOf(n);
    const tagged = propertyRelation.rows.find((r) => r[pr('name')] === 'Tagged');
    const target = tagged === undefined ? undefined : propertyExpressions.rows.find((r) => r[propertyExpressions.header.length - 1] === tagged[pr('initializerExpressionLinkHash')]);
    if (
      tagged === undefined ||
      target === undefined ||
      target[px('rootContext')] !== 'PROPERTY_INITIALIZER' ||
      target[px('parentExpressionHash')] !== '' ||
      target[px('expressionOwnerHash')] !== tagged[propertyRelation.header.length - 1] ||
      target[px('literalValue')] !== '7'
    ) {
      failures += fail(
        `Tagged's initializer link names ${target === undefined ? 'nothing' : `a ${target[px('kind')]} "${target[px('literalValue')]}" in ${target[px('rootContext')]} context`} ` +
          '— expected the LITERAL 7, a PROPERTY_INITIALIZER root owned by Tagged'
      );
    }
  }
  // A FIELD'S INITIALIZER LINK NAMES ITS OWN ROOT: `ConstOne = 1` links to a
  // LITERAL `1` in FIELD_INITIALIZER context owned by ConstOne, and `ConstTwo
  // = 2` to `2` — not to the first initializer on the line, not to a row of
  // the type. Fifth on the link-column risk register.
  const fieldExpressions = relations.get('all-csharp-expressions.csv');
  if (fieldExpressions !== undefined) {
    const ex = (n: string): number => fieldExpressions.header.indexOf(n);
    const expressionRowByPk = new Map(fieldExpressions.rows.map((r) => [r[fieldExpressions.header.length - 1]!, r]));
    const constants: [string, string][] = [['ConstOne', '1'], ['ConstTwo', '2']];
    for (const [name, literal] of constants) {
      const field = fields.rows.find((r) => r[f('name')] === name);
      const target = field === undefined ? undefined : expressionRowByPk.get(field[f('initializerExpressionLinkHash')]!);
      if (
        field === undefined ||
        target === undefined ||
        target[ex('rootContext')] !== 'FIELD_INITIALIZER' ||
        target[ex('parentExpressionHash')] !== '' ||
        target[ex('expressionOwnerHash')] !== field[fields.header.length - 1] ||
        target[ex('literalValue')] !== literal
      ) {
        failures += fail(
          `${name}'s initializer link names ${target === undefined ? 'nothing' : `a ${target[ex('kind')]} "${target[ex('literalValue')]}" in ${target[ex('rootContext')]} context owned by ${target[ex('expressionOwnerHash')] === field?.[fields.header.length - 1] ? 'the field' : 'something else'}`} ` +
            `— expected the LITERAL ${literal}, a FIELD_INITIALIZER root owned by ${name}`
        );
      }
    }
  }

  // The three that were unreachable until this relation existed.
  const allModifiers = new Set(
    fields.rows.flatMap((r) => r[f('fieldModifiers')]!.split(',').filter((x) => x !== ''))
  );
  for (const modifier of ['VOLATILE', 'CONST', 'FIXED', 'REQUIRED', 'READONLY', 'NEW']) {
    if (!allModifiers.has(modifier)) {
      failures += fail(`no field carries the ${modifier} modifier`);
    }
  }

  // ONE type reference per declaration, owned by the first declarator. Emitting
  // it per declarator would double the reference count for a type written once.
  const withReference = consts.filter((r) => r[f('typeReferenceLinkHash')] !== '');
  if (withReference.length !== 1) {
    failures += fail(
      `${withReference.length} of 2 declarators carry a type reference; expected exactly 1 ` +
        '— `int a, b;` writes its type ONCE'
    );
  }
  // AND IT SPELLS THE DECLARED TYPE. Register 11: `Needed` is a `string`,
  // `_volatile` an `int`, and each link must name a FIELD_TYPE reference with
  // that name — a link to the previous field's type resolves just as well.
  const references = relations.get('all-csharp-type-references.csv');
  if (references === undefined || references.header.length === 0) {
    failures += fail('all-csharp-type-references.csv is missing or empty, so no field type can be read');
  } else {
    const tr = (n: string): number => references.header.indexOf(n);
    const referenceByPk = new Map(references.rows.map((r) => [r[references.header.length - 1]!, r]));
    for (const [fieldName, typeName] of [['Needed', 'string'], ['_volatile', 'int']] as const) {
      const field = fields.rows.find((r) => r[f('name')] === fieldName);
      const reference = field === undefined ? undefined : referenceByPk.get(field[f('typeReferenceLinkHash')]!);
      if (reference === undefined || reference[tr('context')] !== 'FIELD_TYPE' || reference[tr('typeName')] !== typeName) {
        failures += fail(
          `${fieldName}'s type link names ${reference === undefined ? 'no reference' : `a ${reference[tr('context')]} reference ${reference[tr('typeName')]}`} ` +
            `— expected the FIELD_TYPE reference ${typeName}, as declared`
        );
      }
    }
  }

  // The value the parser does not compute.
  const byName = new Map(members.rows.map((r) => [r[m('name')]!, r]));
  const expectValue = (name: string, kind: string, value: string): void => {
    const row = byName.get(name);
    if (row === undefined) {
      failures += fail(`enum member ${name} is missing`);
      return;
    }
    if (row[m('valueKind')] !== kind) {
      failures += fail(`${name} has valueKind ${row[m('valueKind')]}, expected ${kind}`);
    }
    if (row[m('constantValue')] !== value) {
      failures += fail(
        `${name} has constantValue ${JSON.stringify(row[m('constantValue')])}, expected ` +
          JSON.stringify(value)
      );
    }
  };
  expectValue('Implicit', 'IMPLICIT', '');
  expectValue('Literal', 'LITERAL', '5');
  // `Computed = Literal | 2` has a value, and folding it is EVALUATION. A parser
  // that did it would be doing the compiler's arithmetic and would be wrong the
  // first time an initializer named a constant from another file.
  expectValue('Computed', 'COMPUTED', '');
  // AND THE COMPUTED MEMBER NAMES ITS EXPRESSION: `Computed = Literal | 2`
  // links to the BINARY root in ENUM_MEMBER_VALUE context owned by Computed.
  // The column was declared, documented in the schema, and empty on every
  // row until a sweep counted populated values per link column.
  const enumExpressions = relations.get('all-csharp-expressions.csv');
  const computed = byName.get('Computed');
  const valueRow = enumExpressions === undefined || computed === undefined
    ? undefined
    : enumExpressions.rows.find((r) => r[enumExpressions.header.length - 1] === computed[m('csExpressionLinkHash')]);
  const ex2 = (n: string): number => enumExpressions?.header.indexOf(n) ?? -1;
  if (
    valueRow === undefined ||
    valueRow[ex2('kind')] !== 'BINARY' ||
    valueRow[ex2('rootContext')] !== 'ENUM_MEMBER_VALUE' ||
    valueRow[ex2('expressionOwnerHash')] !== computed?.[members.header.length - 1]
  ) {
    failures += fail(
      `Computed's csExpressionLinkHash names ${valueRow === undefined ? 'nothing' : `a ${valueRow[ex2('kind')]} in ${valueRow[ex2('rootContext')]} context`} ` +
        '— expected the BINARY `Literal | 2`, an ENUM_MEMBER_VALUE root owned by Computed'
    );
  }
  // The LITERAL member links too, and the implicit one links to nothing.
  const literalMember = byName.get('Literal');
  if (literalMember === undefined || literalMember[m('csExpressionLinkHash')] === '') {
    failures += fail('`Literal = 5` names no expression row');
  }
  if ((byName.get('Implicit')?.[m('csExpressionLinkHash')] ?? '') !== '') {
    failures += fail('an IMPLICIT enum member names an expression it does not have');
  }

  const ordinals = ['Implicit', 'Literal', 'Computed'].map((n) =>
    byName.get(n)?.[m('ordinal')]
  );
  if (ordinals.join(',') !== '0,1,2') {
    failures += fail(`enum member ordinals are ${ordinals.join(',')}, expected 0,1,2`);
  }

  return failures;
}

/**
 * One name, three spellings — and the parser must agree with the compiler.
 *
 * C# lets an identifier be written verbatim (`@class` IS `class`), with Unicode
 * escapes (`\u0041bc` IS `Abc`), and with formatting characters that are
 * ignored. The grammar hands back all three raw.
 *
 * This is Python's NFKC hazard with a C# accent, and the consequence is the
 * same: a declaration and a use that the compiler considers one name become two
 * strings, so the use looks like a reference to something undeclared. **A false
 * edge is worse than a missing one**, because a query that follows it gets a
 * confident wrong answer.
 *
 * NFC and not NFKC, which is the part that does NOT port from Python. NFKC
 * folds the MICRO SIGN to GREEK SMALL LETTER MU; C# keeps them apart, and
 * folding would merge two declarations Roslyn considers distinct.
 */
function identifierNormalisation(outputDir: string): number {
  let failures = 0;
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const types = relations.get('all-csharp-types.csv')!;
  const methods = relations.get('all-csharp-methods.csv')!;
  const fields = relations.get('all-csharp-fields.csv')!;
  const parameters = relations.get('all-csharp-method-parameters.csv')!;
  const typeParameters = relations.get('all-csharp-type-parameters.csv')!;
  if (types.header.length === 0 || methods.header.length === 0) {
    return fail('cs_type or cs_method is empty');
  }
  const nameOf = (r: Relation): string[] =>
    r.header.length === 0 ? [] : r.rows.map((row) => row[r.header.indexOf('name')]!);

  const typeNames = new Set(nameOf(types));
  // The type is `class`, not `@class`. This one is in the PRIMARY KEY, so the
  // raw spelling would make a declaration and a reference two different types.
  if (!typeNames.has('class')) {
    failures += fail(
      '`public class @class` produced no type named `class`. The `@` is not part of the ' +
        `identifier, and the names present are ${JSON.stringify([...typeNames].slice(0, 8))}`
    );
  }
  if (typeNames.has('@class')) {
    failures += fail('a type name kept its verbatim `@` prefix');
  }

  const methodNames = new Set(nameOf(methods));
  if (!methodNames.has('void')) {
    failures += fail('`public void @void()` produced no method named `void`');
  }

  // A Unicode escape is the same identifier as the character it denotes.
  const fieldNames = new Set(nameOf(fields));
  if (!fieldNames.has('Abc')) {
    failures += fail(
      '`public int \\u0041bc;` produced no field named `Abc` — a Unicode escape IS the ' +
        'character, and a use spelled `Abc` would look undeclared'
    );
  }
  if ([...fieldNames].some((n) => n.includes('\\'))) {
    failures += fail('a field name still contains a backslash escape');
  }

  const parameterNames = new Set(nameOf(parameters));
  if (!parameterNames.has('int')) {
    failures += fail('the parameter `@int` was not normalised to `int`');
  }

  // BOTH SIDES of a join must be normalised, or `where @T : class` matches no
  // parameter and the constraint is silently dropped.
  const tpName = typeParameters.header.indexOf('name');
  const tpConstraint = typeParameters.header.indexOf('hasClassConstraint');
  // THE `T` OF `Escaped<@T>`, not the first `T` in the corpus: a find by bare
  // name picked up an unconstrained `T` from another fixture the day one was
  // added, and reported the normalisation broken when nothing had changed.
  const escapedType = types.rows.find((r) => r[types.header.indexOf('name')] === 'Escaped')?.[types.header.length - 1];
  const escapedParameter = typeParameters.rows.find(
    (r) => r[tpName] === 'T' && r[typeParameters.header.indexOf('ownerLinkHash')] === escapedType
  );
  if (escapedParameter === undefined) {
    failures += fail('the type parameter `@T` was not normalised to `T`');
  } else if (escapedParameter[tpConstraint] !== 'true') {
    failures += fail(
      '`where @T : class` did not reach the parameter `@T`. Constraints are matched BY ' +
        'NAME, so both sides have to be normalised or the constraint is dropped in silence.'
    );
  }

  return failures;
}

/**
 * The C# utils, asserted DIRECTLY.
 *
 * These are pure functions, and inferring their behaviour from fact-base rows is
 * both weaker and misleading. Three negative controls proved it: mutations to
 * `typeArgumentArity` and `baseTypeName` left every row-based check green,
 * because the gate corpus happened not to contain the shapes they handle. A
 * check that only passes because its input is uninteresting is not a check.
 *
 * So the utils get unit assertions, the way `defineConstantsKeyOf` does.
 */
function csharpUtils(): number {
  let failures = 0;
  const eq = (actual: unknown, expected: unknown, what: string): void => {
    if (actual !== expected) {
      failures += fail(`${what}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    }
  };

  // A GENERIC IN A NON-LAST SEGMENT keeps the segments after it.
  eq(baseTypeName('Outer<int>.Builder'), 'Outer.Builder', 'baseTypeName keeps the nested type after a generic segment');
  eq(baseTypeName('A<B<C>>.D<E>'), 'A.D', 'baseTypeName strips every balanced type-argument list');
  eq(simpleNameOf('Outer<int>.Builder'), 'Builder', 'simpleNameOf of a nested type of a generic type');
  eq(simpleNameOf('N.Outer<T>.Inner.Leaf'), 'Leaf', 'simpleNameOf three segments deep after a generic');

  // ONE NAME, THREE SPELLINGS.
  eq(normalizeCSharpIdentifier('@class'), 'class', 'the verbatim @ is not part of the name');
  eq(normalizeCSharpIdentifier('@int'), 'int', 'a verbatim keyword parameter');
  eq(normalizeCSharpIdentifier('\\u0041bc'), 'Abc', 'a \\uXXXX escape IS the character');
  eq(normalizeCSharpIdentifier('\\U00000041bc'), 'Abc', 'a \\UXXXXXXXX escape');
  eq(normalizeCSharpIdentifier('plain'), 'plain', 'an ordinary name is untouched');
  eq(normalizeCSharpIdentifier(''), '', 'the empty name');
  // A malformed escape is LEFT ALONE. Deleting it would produce a name that
  // matches nothing and looks deliberate.
  eq(normalizeCSharpIdentifier('\\u00'), '\\u00', 'a malformed escape is left alone');
  // NFC, not NFKC — and this is the one that does NOT port from Python. NFKC
  // folds the MICRO SIGN to GREEK SMALL LETTER MU; C# keeps them apart, so
  // folding would merge two declarations Roslyn considers distinct.
  if (normalizeCSharpIdentifier('\u00b5') === normalizeCSharpIdentifier('\u03bc')) {
    failures += fail(
      'MICRO SIGN and GREEK SMALL LETTER MU were folded together. That is NFKC, which is ' +
        'right for Python and WRONG for C# — Roslyn keeps them apart, and folding merges ' +
        'two distinct declarations.'
    );
  }

  // TOP-LEVEL arity only. A flat comma count reports 3 for the nested case and
  // makes `Dictionary`2` unfindable.
  eq(typeArgumentArity('List<int>'), 1, 'one argument');
  eq(typeArgumentArity('Dictionary<string, int>'), 2, 'two arguments');
  eq(
    typeArgumentArity('Dictionary<string, List<int>>'),
    2,
    'a NESTED argument is not a top-level one'
  );
  eq(
    typeArgumentArity('Func<A, B, Dictionary<C, D>>'),
    3,
    'nesting at the end does not inflate the count'
  );
  eq(typeArgumentArity('Plain'), 0, 'no arguments');

  // The base name is what a `using` scope resolves.
  eq(baseTypeName('List<int>'), 'List', 'arguments stripped');
  eq(
    baseTypeName('System.Collections.Generic.List<int>'),
    'System.Collections.Generic.List',
    'the dotted path is KEPT — it is what resolves'
  );
  eq(baseTypeName('int[]'), 'int', 'array rank stripped');
  eq(baseTypeName('int[,]'), 'int', 'a rectangular array');
  eq(baseTypeName('string?'), 'string', 'the nullable marker stripped');
  eq(baseTypeName('int*'), 'int', 'a pointer star stripped');
  // A leading `ref`/`scoped` belongs to the parameter, not the type. Leaving it
  // on produces a name no using scope will ever resolve — which is exactly what
  // `scoped Span<int>` did before `scoped_type` was unwrapped.
  eq(baseTypeName('ref int'), 'int', '`ref` is not part of the type name');
  eq(baseTypeName('scoped System.Span<int>'), 'System.Span', '`scoped` is not either');
  eq(baseTypeName('ref readonly int'), 'int', '`ref readonly`');
  eq(baseTypeName('scoped ref int'), 'int', '`scoped ref`');

  eq(simpleNameOf('A.B.List<int>'), 'List', 'the last segment is what a declaration is named');
  eq(simpleNameOf('Plain'), 'Plain', 'a bare name is its own last segment');

  // The TEXT, not the meaning.
  eq(hasNullableAnnotation('string?'), true, 'the marker is present');
  eq(hasNullableAnnotation('string'), false, 'no marker');

  // `int` and `System.Int32` are THE SAME TYPE, not two with a conversion.
  eq(predefinedTypeAlias('int'), 'System.Int32', 'the keyword is a synonym');
  eq(predefinedTypeAlias('string'), 'System.String', 'string is a reference type');
  eq(predefinedTypeAlias('dynamic'), 'System.Object', 'dynamic IS object at runtime');
  eq(predefinedTypeAlias('Widget'), '', 'a user type has no alias');
  eq(isPredefinedValueType('int'), true, 'int is a value type');
  eq(isPredefinedValueType('string'), false, 'string is NOT, despite the keyword');
  eq(isPredefinedValueType('object'), false, 'nor is object');

  return failures;
}

/**
 * The spine: wrappers with parented children, and the kinds syntax may claim.
 *
 * Every assertion here is about STRUCTURE, because §3's defect class is that
 * the parts get emitted and the structure does not. A check that counted
 * expressions would pass on output that is unusable.
 */
function expressionSpine(outputDir: string): number {
  let failures = 0;
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const expressions = relations.get('all-csharp-expressions.csv');
  const callSites = relations.get('all-csharp-call-sites.csv');
  const methods = relations.get('all-csharp-methods.csv')!;
  const modules = relations.get('all-csharp-modules.csv')!;
  const m = (n: string): number => modules.header.indexOf(n);
  if (expressions === undefined || expressions.header.length === 0) {
    return fail('all-csharp-expressions.csv is missing or empty');
  }
  if (callSites === undefined || callSites.header.length === 0) {
    return fail('all-csharp-call-sites.csv is missing or empty');
  }
  const e = (n: string): number => expressions.header.indexOf(n);
  const c = (n: string): number => callSites.header.indexOf(n);
  const ePk = expressions.header.length - 1;
  const byHash = new Map(expressions.rows.map((r) => [r[ePk]!, r]));
  const childrenOf = (hash: string): (readonly string[])[] =>
    expressions.rows.filter((r) => r[e('parentExpressionHash')] === hash);

  // 1:1 BETWEEN CALL SITES AND THEIR EXPRESSION ROWS. §8.
  for (const call of callSites.rows) {
    if (!byHash.has(call[c('csExpressionLinkHash')]!)) {
      failures += fail(`a call site references an expression row that does not exist`);
      break;
    }
  }
  const callable = expressions.rows.filter(
    (r) => r[e('kind')] === 'INVOCATION' || r[e('kind')] === 'OBJECT_CREATION'
  );
  if (callable.length !== callSites.rows.length) {
    failures += fail(
      `${callable.length} invocation/creation expressions and ${callSites.rows.length} ` +
        'call sites. The relation is 1:1 by construction — its key is the expression hash ' +
        'and nothing else.'
    );
  }

  // THE TREE IS WELL FORMED: every parent resolves, depth is parent + 1.
  for (const row of expressions.rows) {
    const parent = row[e('parentExpressionHash')]!;
    if (parent === '') {
      if (row[e('depth')] !== '0') {
        failures += fail(`a root expression has depth ${row[e('depth')]}`);
        break;
      }
      continue;
    }
    const parentRow = byHash.get(parent);
    if (parentRow === undefined) {
      failures += fail('an expression has an unresolvable parent');
      break;
    }
    if (Number(row[e('depth')]) !== Number(parentRow[e('depth')]) + 1) {
      failures += fail('an expression is not one deeper than its parent');
      break;
    }
  }

  // §3: ONE WRAPPER, CHILDREN PARENTED, VARIANT IN A COLUMN — and it must
  // survive TWO ON ONE LINE. `_x += 1; n += 2;` is the exact shape that made
  // Python's flat output unpairable, where joining on (scope, line) gives four
  // pairs and two of them are wrong.
  // SCOPED TO ONE FILE, and deliberately.
  //
  // The corpus-wide count was `!== 2`, which made this assertion a hostage of
  // every later fixture: adding a `+=` anywhere in any file failed a check
  // about a structure that had not changed. That is the same defect as keying a
  // gate on a bare parameter name and having a later fixture overwrite it — the
  // failure names the wrong thing, and the next person edits the parser.
  const spineModule = modules.rows.find((r) =>
    (r[m('fileName')] ?? '').endsWith('Spine.cs')
  );
  if (spineModule === undefined) {
    failures += fail('Spine.cs produced no cs_module row — the scoping below sees nothing');
  }
  const spineHash = spineModule?.[modules.header.length - 1] ?? '';
  const compound = expressions.rows.filter(
    (r) =>
      r[e('kind')] === 'COMPOUND_ASSIGNMENT' && r[e('csModuleLinkHash')] === spineHash
  );
  if (compound.length !== 2) {
    failures += fail(
      `expected 2 compound assignments in Spine.cs, found ${compound.length}`
    );
  }
  for (const row of compound) {
    if (row[e('operatorString')] !== '+=') {
      failures += fail(
        `a compound assignment has operatorString ${JSON.stringify(row[e('operatorString')])}. ` +
          'One kind covers += -= *= /= ??= — the operator is a COLUMN.'
      );
    }
    const kids = childrenOf(row[ePk]!);
    const roles = kids.map((k) => k[e('edgeRole')]).sort();
    if (roles.join(',') !== 'ASSIGNMENT_TARGET,ASSIGNMENT_VALUE') {
      failures += fail(
        `a compound assignment's children have roles ${roles.join(',')}. Without ` +
          'ASSIGNMENT_TARGET and ASSIGNMENT_VALUE the two on one line are unpairable, and ' +
          'the engine-side workaround INVENTS value flow.'
      );
    }
  }

  // `Clicked += OnClicked` is a SUBSCRIPTION. It calls the add accessor and
  // registers an edge that fires later; a COMPOUND_ASSIGNMENT with += in a
  // column gives the engine the parts and loses the edge.
  const subscribe = expressions.rows.filter((r) => r[e('kind')] === 'EVENT_SUBSCRIBE');
  const unsubscribe = expressions.rows.filter((r) => r[e('kind')] === 'EVENT_UNSUBSCRIBE');
  if (subscribe.length === 0) {
    failures += fail(
      '`Clicked += OnClicked` produced no EVENT_SUBSCRIBE. It is not an assignment — it ' +
        'CALLS the add accessor and registers a call edge that fires later.'
    );
  }
  if (unsubscribe.length === 0) {
    failures += fail('`Clicked -= OnClicked` produced no EVENT_UNSUBSCRIBE');
  }
  for (const row of [...subscribe, ...unsubscribe]) {
    const roles = childrenOf(row[ePk]!).map((k) => k[e('edgeRole')]).sort();
    if (roles.join(',') !== 'ASSIGNMENT_TARGET,ASSIGNMENT_VALUE') {
      failures += fail(`an event subscription's children have roles ${roles.join(',')}`);
    }
  }

  // §6: a tree rooted at a non-emitting node dies before its children are
  // enqueued. `(Compute(n) && s.Contains("x"))` cost admin-ui 1,808 expressions
  // when the parenthesis produced no row.
  const parens = expressions.rows.filter((r) => r[e('kind')] === 'PARENTHESIZED');
  if (parens.length === 0) {
    failures += fail('a parenthesised expression produced no row — its subtree dies with it');
  }
  for (const row of parens) {
    if (childrenOf(row[ePk]!).length === 0) {
      failures += fail('a parenthesised expression has no child — the subtree was dropped');
      break;
    }
  }

  // METHOD GROUPS. TypeScript's methodReferenceKind is a parity slot, always
  // "". C# fills it — and only where syntax decides it.
  // SCOPED to Spine.cs — the fourth exact corpus-wide count in this file to be
  // taken hostage by a later fixture, and the fourth to be scoped.
  const groups = expressions.rows.filter(
    (r) =>
      r[e('methodReferenceKind')] === 'METHOD_GROUP' &&
      r[e('csModuleLinkHash')] === spineHash
  );
  // EXACTLY ONE, and the exactness is the point. `Action a = Helper;` is the
  // only method group in this fixture; `n`, `s` and `parsed` are also bare names
  // in value positions and are NOT groups. A lower bound would pass on the
  // version that marked all of them — which produced 2,080 rows in multitarget-A and
  // would tell an engine two thousand methods are referenced-but-never-called.
  // THREE: `Action a = Helper;` and both `Clicked += / -= OnClicked` — an event
  // handler registration IS a method group conversion. `n`, `s` and `parsed` are
  // also bare names in value positions and are NOT groups.
  if (groups.length !== 3) {
    failures += fail(
      `${groups.length} METHOD_GROUP rows, expected exactly 3. \`Action a = Helper;\` is a ` +
        'reference to a method with NO CALL SYNTAX AT ALL and this column is the only thing ' +
        'that says so — but a bare name in a value position is usually a variable, and ' +
        'marking those is wrong more often than it is right.'
    );
  }
  // And NOT on a member access: `x.M` needs the RECEIVER's type, which is
  // resolution. Guessing produced 108 rows in multitarget-A whose first six were enum
  // members.
  if (expressions.rows.some((r) => r[e('methodReferenceKind')] === 'INSTANCE_METHOD_GROUP')) {
    failures += fail(
      'INSTANCE_METHOD_GROUP was emitted. `x.M` is a method group only if M is on the ' +
        "RECEIVER's type, which syntax cannot decide — it is reserved with a zero-row " +
        'assertion.'
    );
  }

  // A LAMBDA gets its own cs_method row, and its body belongs to IT. Walking a
  // lambda body with the enclosing method as owner attributes every call inside
  // a callback to whoever created it.
  const mCol = (n: string): number => methods.header.indexOf(n);
  const lambdas = methods.rows.filter((r) => r[mCol('methodKind')] === 'LAMBDA');
  if (lambdas.length === 0) {
    failures += fail('a lambda produced no cs_method row, so its body has no owner');
  } else {
    const lambdaHash = lambdas[0]![methods.header.length - 1];
    const owned = expressions.rows.filter((r) => r[e('expressionOwnerHash')] === lambdaHash);
    if (owned.length === 0) {
      failures += fail(
        "a lambda's body produced no expressions owned by the lambda. §6: the worklist " +
          'stops at a function boundary, and `return function () { … }` emitted the ' +
          'function and nothing inside it.'
      );
    }
  }

  // `out` is a SECOND RETURN CHANNEL, at the call site as well as the parameter.
  const tryParse = callSites.rows.find((r) => r[c('calleeName')] === 'TryParse');
  if (tryParse === undefined) {
    failures += fail('the TryParse call site is missing');
  } else if (tryParse[c('outArgumentCount')] !== '1') {
    failures += fail(
      `TryParse has outArgumentCount ${tryParse[c('outArgumentCount')]}, expected 1. An out ` +
        'argument is a second return channel and an engine modelling only returns loses it.'
    );
  }

  // A call inside a nested position is still a call. `s.Contains("x")` sits
  // inside a parenthesis inside a binary inside an initializer.
  if (!callSites.rows.some((r) => r[c('calleeName')] === 'Contains')) {
    failures += fail(
      'a call nested inside a parenthesis and a binary operator was not found — the ' +
        'subtree died at a non-emitting node'
    );
  }

  // ORDERINGS carry their OWN direction. `orderby y descending, x` sorts y
  // descending and x ASCENDING, and one flag on the clause is wrong about x.
  const queryClauses = relations.get('all-csharp-query-clauses.csv');
  if (queryClauses !== undefined && queryClauses.header.length > 0) {
    const q = (n: string): number => queryClauses.header.indexOf(n);
    const orderings = queryClauses.rows.filter(
      (r) => r[q('clauseKind')] === 'ORDER_BY_ORDERING'
    );
    if (orderings.length !== 2) {
      failures += fail(`expected 2 ORDER_BY_ORDERING rows, found ${orderings.length}`);
    }
    const directions = orderings.map((r) => r[q('isDescending')]).sort().join(',');
    if (directions !== 'false,true') {
      failures += fail(
        `both orderings have direction ${directions}. The grammar gives no \`ordering\` ` +
          'node, so a `descending` token applies to the key BEFORE it — one flag on the ' +
          'clause is wrong about the other key.'
      );
    }
    // THE PARENT QUERY, by kind and by agreement — register 16. Every clause's
    // parentQueryLinkHash is a QUERY expression row and the same row its
    // csExpressionLinkHash names; a link to the first expression in the body
    // resolves and is neither.
    for (const row of queryClauses.rows) {
      const parent = byHash.get(row[q('parentQueryLinkHash')]!);
      if (parent === undefined || parent[e('kind')] !== 'QUERY' || row[q('parentQueryLinkHash')] !== row[q('csExpressionLinkHash')]) {
        failures += fail(
          `a ${row[q('clauseKind')]} clause's parentQueryLinkHash names ${parent === undefined ? 'no expression' : `a ${parent[e('kind')]}`} ` +
            '— expected the QUERY row its csExpressionLinkHash names'
        );
        break;
      }
    }
    // A range variable is what a clause BINDS. `orderby`, `group`, `where` and
    // `select` bind nothing, and putting the ordering key or the grouped
    // expression here reads as a binding that does not exist.
    for (const row of queryClauses.rows) {
      const kind = row[q('clauseKind')]!;
      const binds = kind === 'FROM' || kind === 'LET' || kind === 'JOIN' ||
        kind === 'JOIN_INTO' || kind === 'INTO';
      if (!binds && row[q('identifierName')] !== '') {
        failures += fail(
          `a ${kind} clause reports the range variable ` +
            `${JSON.stringify(row[q('identifierName')])}. It binds nothing.`
        );
        break;
      }
    }
  }

  const calleeNames = new Set(callSites.rows.map((r) => r[c('calleeName')]!));

  // A call inside a FOREACH BODY, and one in its HEADER. The statement descent
  // is total for exactly this reason: an unrecognised statement must contribute
  // its expressions rather than swallow its subtree.
  if (!calleeNames.has('Split')) {
    failures += fail('the call in a foreach HEADER was not found');
  }
  const writeLines = callSites.rows.filter((r) => r[c('calleeName')] === 'WriteLine');
  if (writeLines.length < 3) {
    failures += fail(
      `${writeLines.length} WriteLine calls found, expected at least 3 — one in a lambda, ` +
        'one in an if body, one in a FOREACH body. The walker once named that statement ' +
        'for_each_statement where the grammar says foreach_statement, and 17% of the ' +
        "corpus's call sites were invisible."
    );
  }

  // A SINGLE-PARAMETER lambda's body. The parameter is a bare identifier, so a
  // positional body-finder picks it as the body — which lost 80% of the
  // corpus's LINQ queries, because almost every one lives in such a lambda.
  // Both calls to Describe are inside bodies a positional guess would miss.
  //
  // Scoped to Spine.cs, and the lambda-owned call is asserted BY ITS OWNER.
  // The corpus-wide count `>= 2` stopped discriminating the day another
  // fixture added `this.Describe()` and `base.Describe()`: the negative
  // control that picks the body positionally still lost the lambda's call, and
  // this gate kept passing on the padding.
  const describeCalls = callSites.rows.filter(
    (r) => r[c('calleeName')] === 'Describe' && r[c('csModuleLinkHash')] === spineHash
  );
  if (describeCalls.length !== 2) {
    failures += fail(
      `${describeCalls.length} calls to Describe in Spine.cs, expected exactly 2 — one in a ` +
        "SINGLE-PARAMETER lambda's body and one in an ACCESSOR body. Neither is reachable " +
        'by a positional body-finder, and an accessor body was not walked at all.'
    );
  }
  // THE GRAMMAR SHAPES. Two calls to PatRight, both on the right of a
  // logical operator whose left is an is-pattern; one call to RefTarget on
  // the LEFT of an assignment, with the assignment's target being that
  // invocation's own row; and PatValue on its right.
  const spineCalls = (name: string): (readonly string[])[] =>
    callSites.rows.filter(
      (r) => r[c('calleeName')] === name && r[c('csModuleLinkHash')] === spineHash
    );
  // PatRight is a REPAIRED misparse; RefTarget is a known absence. One shape
  // each, and the difference is whether the misparse left a node to build the
  // row from.
  //
  //   `s is not null && PatRight(s)`   the pattern swallows the right operand,
  //   `s is null || PatRight(s)`       so the call sat inside a PATTERN — and a
  //                                    pattern's subtree carries no expression
  //                                    rows, so the call was not misplaced but
  //                                    absent. The rotation in cs-misparse.ts
  //                                    makes the operator the parent and the
  //                                    is-expression its left operand, which
  //                                    puts the tail back in an expression
  //                                    position. Both calls come back.
  //   `RefTarget(v) = PatValue()`      a ref-returning call on the LEFT of an
  //                                    assignment reads as a DECLARATION of
  //                                    type RefTarget. cs-misparse.ts stops the
  //                                    phantom locals, which is the half that
  //                                    emitted false facts, and cannot recover
  //                                    the call: `cs_call_site` is a 1:1 chain
  //                                    off an expression built from a NODE, and
  //                                    this misparse leaves no invocation node
  //                                    to build one from.
  //
  // So one is asserted PRESENT with its receiver-free shape, and the other
  // ABSENT — and if RefTarget ever appears, that is an upstream fix and this
  // says so rather than the count quietly rising.
  const patRight = spineCalls('PatRight');
  if (patRight.length !== 2) {
    failures += fail(
      `PatRight is called ${patRight.length} time(s), expected 2 — one on the right of ` +
        '`&&` after `is not null` and one on the right of `||` after `is null`. The pattern ' +
        'swallows the tail and the rotation is what puts it back; a count of 1 means the ' +
        'combinator descent stopped at a direct constant_pattern child again.'
    );
  }
  for (const call of patRight) {
    if (call[c('callKind')] !== 'FUNCTION_CALL' || call[c('argumentCount')] !== '1') {
      failures += fail(
        `a recovered PatRight call is ${call[c('callKind')]}/${call[c('argumentCount')]} ` +
          'argument(s), expected FUNCTION_CALL/1 — recovering the call and not its shape is ' +
          'a correctly-positioned row with the wrong kind'
      );
    }
  }
  // `this is Spine && Flag()` — the same swallow, with `this` as the operand.
  // The call comes back, and its operand is a THIS_REFERENCE row: the two
  // halves of the same repair, asserted separately because the positional read
  // recovered the call and lost the operand.
  if (spineCalls('Flag').length !== 1) {
    failures += fail(
      `Flag is called ${spineCalls('Flag').length} time(s), expected 1 — the tail of ` +
        '`this is Spine && Flag()` was swallowed by the pattern'
    );
  }
  const thisOperand = expressions.rows.find(
    (r) =>
      r[e('kind')] === 'THIS_REFERENCE' &&
      r[e('edgeRole')] === 'PATTERN_OPERAND' &&
      r[e('csModuleLinkHash')] === spineHash
  );
  if (thisOperand === undefined) {
    failures += fail(
      '`this is Spine` has no THIS_REFERENCE child in the PATTERN_OPERAND role — `is` read ' +
        'its operand by position, and `this` is not a named child, so position 0 is the PATTERN'
    );
  }
  if (spineCalls('RefTarget').length !== 0) {
    failures += fail(
      `RefTarget is now called ${spineCalls('RefTarget').length} time(s). The ref-returning ` +
        'assignment misparse now yields a call — assert its ASSIGNMENT_TARGET structure.'
    );
  }
  if (spineCalls('PatValue').length !== 1) {
    failures += fail('the call on the RIGHT of `RefTarget(v) = PatValue()` is missing');
  }
  // `Owner = this` — the value is an ANONYMOUS `this` token, not a named
  // child, and a positional read of the named children found a target and no
  // value. 13 assignments on one stratum, every one `= this`.
  const thisValue = expressions.rows.find(
    (r) =>
      r[e('kind')] === 'THIS_REFERENCE' &&
      r[e('edgeRole')] === 'ASSIGNMENT_VALUE' &&
      r[e('csModuleLinkHash')] === spineHash
  );
  if (thisValue === undefined) {
    failures += fail(
      '`Owner = this` has no THIS_REFERENCE child in the ASSIGNMENT_VALUE role — the ' +
        'assignment read its named children by position and `this` is not one'
    );
  }

  // EVERY CLASSIFIED REFERENCE NAMES ITS DECLARATION ROW. `referencedEntityKind`
  // said "a local" on 252,742 rows of one stratum and `referencedEntityHash`
  // named none of them — the column and its setter existed and nothing
  // connected them. Corpus-wide: a reference classified as a local, a pattern
  // binding, a query range variable, a parameter or a lambda parameter links
  // to a row of the right relation, and one shape of each is asserted by name
  // so the count cannot be satisfied by linking everything to anything.
  const variableRelation = relations.get('all-csharp-variables.csv');
  const parameterRelation = relations.get('all-csharp-method-parameters.csv');
  if (variableRelation === undefined || parameterRelation === undefined) {
    return failures + fail('variables or parameters relation missing');
  }
  const variableByHash = new Map(variableRelation.rows.map((r) => [r[variableRelation.header.length - 1]!, r]));
  const parameterByHash = new Map(parameterRelation.rows.map((r) => [r[parameterRelation.header.length - 1]!, r]));
  const vName = variableRelation.header.indexOf('name');
  const pName = parameterRelation.header.indexOf('name');
  const memberKinds = ['FIELD', 'PROPERTY', 'EVENT'];
  const linkable = expressions.rows.filter(
    (r) =>
      r[e('kind')] === 'NAME_REFERENCE' &&
      ['LOCAL_VARIABLE', 'PATTERN_BINDING', 'QUERY_RANGE_VARIABLE', 'PARAMETER', 'LAMBDA_PARAMETER', ...memberKinds].includes(
        r[e('referencedEntityKind')]!
      )
  );
  const fieldRelation = relations.get('all-csharp-fields.csv');
  const propertyRelation = relations.get('all-csharp-properties.csv');
  const eventRelation = relations.get('all-csharp-events.csv');
  const memberNameByHash = new Map<string, string>();
  for (const relation of [fieldRelation, propertyRelation, eventRelation]) {
    if (relation === undefined) {
      continue;
    }
    const nameColumn = relation.header.indexOf('name');
    for (const row of relation.rows) {
      memberNameByHash.set(row[relation.header.length - 1]!, row[nameColumn]!);
    }
  }
  if (linkable.length < 50) {
    failures += fail(`NEGATIVE CONTROL FAILED: only ${linkable.length} linkable references in the corpus`);
  }
  const misnamed: string[] = [];
  let unlinkedReferences = 0;
  for (const row of linkable) {
    const hash = row[e('referencedEntityHash')]!;
    const kind = row[e('referencedEntityKind')]!;
    const target =
      kind === 'PARAMETER' || kind === 'LAMBDA_PARAMETER'
        ? parameterByHash.get(hash)?.[pName]
        : memberKinds.includes(kind)
          ? memberNameByHash.get(hash)
          : variableByHash.get(hash)?.[vName];
    if (target === undefined) {
      unlinkedReferences += 1;
      if (unlinkedReferences <= 8) {
        console.log(
          `    unlinked ${kind} ${JSON.stringify(row[e('potentialQualifiedName')])} at line ${row[e('startLine')]} of ` +
            `${modules.rows.find((m) => m[modules.header.length - 1] === row[e('csModuleLinkHash')])?.[m('fileName')]}`
        );
      }
      continue;
    }
    if (target !== row[e('potentialQualifiedName')] && row[e('potentialQualifiedName')] !== '') {
      misnamed.push(`${row[e('potentialQualifiedName')]} -> ${target}`);
    }
  }
  if (unlinkedReferences !== 0) {
    failures += fail(
      `${unlinkedReferences} of ${linkable.length} classified references have no referencedEntityHash ` +
        'resolving to a row of the matching relation. The kind is right and the link — the ' +
        'one-hop, same-file fact the parser holds — is absent.'
    );
  }
  if (misnamed.length !== 0) {
    failures += fail(
      `${misnamed.length} reference(s) link to a declaration of a DIFFERENT name: ` +
        `${misnamed.slice(0, 3).join(', ')}. A link is worse than none when it points at the wrong row.`
    );
  }
  // The shapes, by name: a captured local from inside a lambda, the lambda's
  // own parameter, an out-var binding, a method parameter.
  const linkedTo = (referenceName: string, kind: string): string[] =>
    linkable
      .filter((r) => r[e('potentialQualifiedName')] === referenceName && r[e('referencedEntityKind')] === kind)
      .map((r) => r[e('referencedEntityHash')]!);
  const scaleLinks = linkedTo('scale', 'LOCAL_VARIABLE');
  if (scaleLinks.length === 0 || scaleLinks.some((h) => variableByHash.get(h)?.[vName] !== 'scale')) {
    failures += fail('`scale(n)` inside a lambda does not link to the captured local `scale`');
  }
  const nLinks = linkedTo('n', 'LAMBDA_PARAMETER');
  if (nLinks.length === 0 || nLinks.some((h) => parameterByHash.get(h)?.[pName] !== 'n')) {
    failures += fail('`n` inside `n => scale(n)` does not link to the lambda`s own parameter row');
  }
  // BARE MEMBER NAMES — ruling v1.8, all four conditions gated. The field
  // `_x`, the property `Count` and the event `Clicked` are each classified by
  // their own kind and link to their own row; the local `_x` that shadows the
  // field is LOCAL_VARIABLE (a nearer binding wins); `this.Seed` stays UNKNOWN
  // (the receiver's type decides); and corpus-wide, no reference is a member
  // kind while a local or parameter of that name is in scope at its position.
  // BARE names only: the name half of `other.Count` is a MEMBER_NAME child and
  // is asserted UNKNOWN separately below.
  const kindsOfName = (name: string): Set<string> =>
    new Set(
      expressions.rows
        .filter(
          (r) =>
            r[e('kind')] === 'NAME_REFERENCE' &&
            r[e('potentialQualifiedName')] === name &&
            r[e('csModuleLinkHash')] === spineHash &&
            r[e('edgeRole')] !== 'MEMBER_NAME'
        )
        .map((r) => r[e('referencedEntityKind')]!)
    );
  for (const [name, expectedKind] of [['Count', 'PROPERTY'], ['Clicked', 'EVENT']] as const) {
    const kinds = kindsOfName(name);
    if (!kinds.has(expectedKind) || kinds.size !== 1) {
      failures += fail(`bare \`${name}\` is classified [${[...kinds].join(', ')}], expected only ${expectedKind}`);
    }
  }
  const xKinds = kindsOfName('_x');
  if (!xKinds.has('FIELD') || !xKinds.has('LOCAL_VARIABLE')) {
    failures += fail(
      `\`_x\` is classified [${[...xKinds].join(', ')}]: expected FIELD where the field is meant and ` +
        'LOCAL_VARIABLE inside Members(), where a local of that name shadows it'
    );
  }
  const shadowed = expressions.rows.filter(
    (r) => r[e('potentialQualifiedName')] === '_x' && r[e('csModuleLinkHash')] === spineHash && r[e('referencedEntityKind')] === 'LOCAL_VARIABLE'
  );
  if (shadowed.length !== 1 || variableByHash.get(shadowed[0]![e('referencedEntityHash')]!)?.[vName] !== '_x') {
    failures += fail('the shadowing local `_x` is not linked to its own cs_variable row');
  }
  const memberNamed = expressions.rows.filter(
    (r) => r[e('edgeRole')] === 'MEMBER_NAME' && memberKinds.includes(r[e('referencedEntityKind')]!)
  );
  if (memberNamed.length !== 0) {
    failures += fail(
      `${memberNamed.length} MEMBER_NAME child(ren) classified as a member of the ENCLOSING type — ` +
        '`x.Foo` depends on the receiver`s type, which is resolution'
    );
  }
  // Condition 1, corpus-wide: no member-kind reference while a nearer binding
  // of that name is in scope. Approximated by position: a local or parameter
  // of the same name, in the same member tree, declared at or above the line.
  const variablesByOwner = new Map<string, (readonly string[])[]>();
  for (const row of variableRelation.rows) {
    const owner = row[variableRelation.header.indexOf('csMethodLinkHash')]!;
    if (!variablesByOwner.has(owner)) {
      variablesByOwner.set(owner, []);
    }
    variablesByOwner.get(owner)!.push(row);
  }
  const vLineColumn = variableRelation.header.indexOf('startLine');
  for (const reference of linkable.filter((r) => memberKinds.includes(r[e('referencedEntityKind')]!))) {
    const owner = reference[e('expressionOwnerHash')]!;
    const name = reference[e('potentialQualifiedName')]!;
    const shadowing = (variablesByOwner.get(owner) ?? []).find(
      (v) => v[vName] === name && Number(v[vLineColumn]) <= Number(reference[e('startLine')])
    );
    if (shadowing !== undefined) {
      failures += fail(
        `\`${name}\` at line ${reference[e('startLine')]} is classified ${reference[e('referencedEntityKind')]} while a ` +
          `local of that name is declared at line ${shadowing[vLineColumn]} in the same member — the nearer binding wins`
      );
      break;
    }
  }

  // THE NEAREST PRECEDING DECLARATION, not the first. `twice` is declared in
  // two sibling blocks; each reference links to the declaration in ITS block,
  // which is the later one for the else-branch. Linking every `twice` to the
  // first declaration is a link to the wrong row — worse than none.
  const vLine = variableRelation.header.indexOf('startLine');
  const twiceRefs = linkable.filter(
    (r) => r[e('potentialQualifiedName')] === 'twice' && r[e('referencedEntityKind')] === 'LOCAL_VARIABLE'
  );
  const twiceDeclarations = variableRelation.rows
    .filter((r) => r[vName] === 'twice')
    .map((r) => Number(r[vLine]))
    .sort((x, y) => x - y);
  if (twiceDeclarations.length !== 2 || twiceRefs.length < 2) {
    failures += fail(
      `NEGATIVE CONTROL FAILED: ${twiceDeclarations.length} declarations and ${twiceRefs.length} ` +
        'references of `twice`, expected two sibling declarations and a reference after each'
    );
  }
  for (const reference of twiceRefs) {
    const linkedLine = Number(variableByHash.get(reference[e('referencedEntityHash')]!)?.[vLine]);
    const expectedLine = Math.max(...twiceDeclarations.filter((line) => line <= Number(reference[e('startLine')])));
    if (linkedLine !== expectedLine) {
      failures += fail(
        `\`twice\` at line ${reference[e('startLine')]} links to the declaration at line ` +
          `${linkedLine}, expected the nearest preceding one at line ${expectedLine}`
      );
      break;
    }
  }

  // TYPE REFERENCES IN EXPRESSION POSITIONS, by the row they hang off.
  // Ruling v1.7, with its four conditions: a second pass keyed off the
  // expression hash; TYPE_OPERAND enumerated; `as` is AS_TYPE and never CAST;
  // and the cast pair 1:1 in BOTH directions, because two links for one pair
  // is the shape that doubles.
  const typeReferences = relations.get('all-csharp-type-references.csv');
  if (typeReferences === undefined) {
    return failures + fail('type references relation missing');
  }
  const tr = (n: string): number => typeReferences.header.indexOf(n);
  const spineTypeRefs = typeReferences.rows.filter(
    (r) => r[tr('referenceOwnerKind')] === 'EXPRESSION' && byHash.has(r[tr('ownerLinkHash')]!) &&
      byHash.get(r[tr('ownerLinkHash')]!)![e('csModuleLinkHash')] === spineHash
  );
  // Each context's owner row is an expression of the matching kind — the
  // ownerLinkHash asserted by MEANING, not existence.
  const expectedOwnerKind: [string, string, string][] = [
    ['CAST', 'CAST', 'Spine'],
    ['AS_TYPE', 'AS_EXPRESSION', 'Spine'],
    ['TYPE_PATTERN', 'IS_PATTERN', 'Spine'],
    ['OBJECT_CREATION', 'OBJECT_CREATION', 'Spine'],
    ['ARRAY_CREATION', 'ARRAY_CREATION', 'Spine'],
    ['TYPEOF', 'TYPEOF', 'Spine'],
    ['TYPE_OPERAND', 'DEFAULT', 'Spine'],
    ['TYPE_OPERAND', 'SIZEOF', 'int'],
    ['TYPE_OPERAND', 'STACKALLOC', 'int'],
    ['METHOD_TYPE_ARGUMENT', 'INVOCATION', 'Spine'],
  ];
  for (const [refContext, ownerKind, typeName] of expectedOwnerKind) {
    const matching = spineTypeRefs.filter(
      (r) =>
        r[tr('context')] === refContext &&
        byHash.get(r[tr('ownerLinkHash')]!)![e('kind')] === ownerKind &&
        r[tr('typeName')] === typeName
    );
    if (matching.length === 0) {
      failures += fail(
        `no ${refContext} type reference named ${typeName} owned by a ${ownerKind} expression ` +
          'in Spine.cs — a type in an expression position with no reference row, or a reference ' +
          'owned by the wrong row'
      );
    }
  }
  if (spineTypeRefs.some((r) => r[tr('context')] === 'CAST' && byHash.get(r[tr('ownerLinkHash')]!)![e('kind')] === 'AS_EXPRESSION')) {
    failures += fail('`o as Spine` produced a CAST reference. No conversion operator can run through `as`.');
  }
  // THE CAST PAIR, 1:1 BOTH WAYS.
  const castRows = expressions.rows.filter((r) => r[e('kind')] === 'CAST');
  const castRefs = typeReferences.rows.filter((r) => r[tr('context')] === 'CAST' && r[tr('parentReferenceHash')] === '');
  if (castRows.length === 0) {
    failures += fail('NEGATIVE CONTROL FAILED: no CAST expression in the corpus');
  }
  if (!castRows.some((r) => r[e('expressionOwnerKind')] === 'ATTRIBUTE')) {
    failures += fail(
      'NEGATIVE CONTROL FAILED: no CAST inside an attribute argument. `[DefaultValue((byte)42)]` ' +
        'is the shape whose expression walk had no type-reference sink — 1,777 of 32,432 casts on one stratum.'
    );
  }
  for (const cast of castRows) {
    const forward = cast[e('castTypeReferenceLinkHash')]!;
    const back = castRefs.filter((r) => r[tr('ownerLinkHash')] === cast[ePk]);
    if (back.length !== 1 || back[0]![typeReferences.header.length - 1] !== forward) {
      failures += fail(
        `a CAST at line ${cast[e('startLine')]} has ${back.length} CAST reference(s) owned by it and ` +
          `castTypeReferenceLinkHash ${forward === '' ? 'empty' : back.length === 1 ? 'naming a different row' : 'set'} — ` +
          'the pair is two links and must be one pair'
      );
      break;
    }
  }
  for (const ref of castRefs) {
    const owners = castRows.filter((r) => r[ePk] === ref[tr('ownerLinkHash')] && r[e('castTypeReferenceLinkHash')] === ref[typeReferences.header.length - 1]);
    if (owners.length !== 1) {
      failures += fail(`a CAST type reference is pointed at by ${owners.length} CAST expressions, expected exactly 1`);
      break;
    }
  }
  // Method type arguments: `Generic<int, Spine>(1)` has two, at positions 0 and 1.
  const methodTypeArguments = spineTypeRefs.filter((r) => r[tr('context')] === 'METHOD_TYPE_ARGUMENT' && r[tr('parentReferenceHash')] === '');
  if (methodTypeArguments.length !== 3) {
    failures += fail(`${methodTypeArguments.length} method type arguments in Spine.cs, expected 3 — <int, Spine> and <Spine>`);
  }
  // A typed lambda parameter's type, owned by the PARAMETER row.
  const typedLambdaParameter = typeReferences.rows.find(
    (r) => r[tr('context')] === 'LAMBDA_PARAMETER' && parameterByHash.get(r[tr('ownerLinkHash')]!)?.[pName] === 'q'
  );
  if (typedLambdaParameter === undefined) {
    failures += fail('`(int q) => q` has no LAMBDA_PARAMETER type reference owned by the parameter row `q`');
  }
  // And the RECEIVER LINK on the call site, second pass: `this.Generic<Spine>(2)`
  // names its receiver row, the THIS_REFERENCE child.
  const receiverLinked = callSites.rows.filter(
    (r) => r[c('csModuleLinkHash')] === spineHash && r[c('receiverKind')] !== 'NONE' && r[c('receiverExpressionLinkHash')] !== ''
  );
  const receiverUnlinked = callSites.rows.filter(
    (r) => r[c('csModuleLinkHash')] === spineHash && r[c('receiverKind')] !== 'NONE' && r[c('receiverExpressionLinkHash')] === ''
  );
  if (receiverLinked.length === 0 || receiverUnlinked.length !== 0) {
    failures += fail(
      `${receiverUnlinked.length} call site(s) with a receiver name no receiver row (${receiverLinked.length} do). ` +
        'The RECEIVER child exists; the link was declared and never written.'
    );
  }
  for (const site of receiverLinked) {
    const receiverRow = byHash.get(site[c('receiverExpressionLinkHash')]!);
    if (receiverRow === undefined || receiverRow[e('edgeRole')] !== 'RECEIVER' || receiverRow[e('parentExpressionHash')] !== site[c('csExpressionLinkHash')]) {
      failures += fail('a call site`s receiverExpressionLinkHash does not name the RECEIVER child of its own invocation row');
      break;
    }
  }

  // CONSTRUCTOR INITIALIZERS — `: base(Bump(seed))`, `: this(Pick())`. The
  // initializer is a call edge AND its arguments are ordinary expressions
  // that carry calls of their own, each owned by the constructor and hanging
  // off the initializer's row as an ARGUMENT. Nothing asserted this before,
  // which is how CS-CORPUS-19 — every call inside every initializer argument
  // list dropped, 455 on the corpus — got past a green suite.
  const initializerCalls = callSites.rows.filter(
    (r) => r[c('callKind')] === 'BASE_CONSTRUCTOR_CALL' || r[c('callKind')] === 'THIS_CONSTRUCTOR_CALL'
  );
  const constructorHashes = new Set(
    methods.rows
      .filter((r) => r[mCol('methodKind')] === 'CONSTRUCTOR')
      .map((r) => r[methods.header.length - 1]!)
  );
  const writtenInitializers = initializerCalls.filter((r) => constructorHashes.has(r[c('callerMethodLinkHash')]!));
  if (writtenInitializers.length < 2) {
    failures += fail(`${writtenInitializers.length} constructor-initializer call(s) owned by a written constructor, expected at least 2`);
  }
  for (const [callee, initializerKind] of [['Bump', 'BASE_CONSTRUCTOR_CALL'], ['Pick', 'THIS_CONSTRUCTOR_CALL']] as const) {
    const inner = callSites.rows.filter((r) => r[c('calleeName')] === callee);
    if (inner.length !== 1) {
      failures += fail(`${inner.length} call(s) to ${callee}, expected exactly 1 — the call inside a constructor initializer's argument list`);
      continue;
    }
    const innerRow = byHash.get(inner[0]![c('csExpressionLinkHash')]!);
    const initializerRow = innerRow === undefined ? undefined : byHash.get(innerRow[e('parentExpressionHash')]!);
    if (innerRow === undefined || innerRow[e('edgeRole')] !== 'ARGUMENT' || initializerRow === undefined || initializerRow[e('kind')] !== 'INVOCATION') {
      failures += fail(`${callee}() is not an ARGUMENT child of the initializer's INVOCATION row`);
      continue;
    }
    const owningInitializer = callSites.rows.find((r) => r[c('csExpressionLinkHash')] === initializerRow[ePk]);
    if (owningInitializer?.[c('callKind')] !== initializerKind) {
      failures += fail(`${callee}() hangs off a ${owningInitializer?.[c('callKind')] ?? 'missing'} call, expected ${initializerKind}`);
    }
    if (!constructorHashes.has(inner[0]![c('callerMethodLinkHash')]!) || inner[0]![c('callerMethodLinkHash')] !== owningInitializer?.[c('callerMethodLinkHash')]) {
      failures += fail(`${callee}() is not owned by the same constructor as its initializer`);
    }
  }

  // INITIALIZER CALLS name their TYPE. `Seeded = MakeSeeds()` and
  // `Configured { get; set; } = ComputeDefault()` run from whichever
  // constructor the compiler synthesises, so `callerMethodLinkHash` is empty
  // BY RULE and `callerTypeLinkHash` is the only hop the engine has to the
  // code that runs them. Before this, the hop was asserted to RESOLVE: a link
  // to any type row passed, and so did NO link at all — the top-level
  // fallback accepted the module hash in its place. Here the linked row must
  // be the cs_type named `Kinds`, the declaration the initializers sit in.
  const typeRelation = relations.get('all-csharp-types.csv')!;
  const t = (n: string): number => typeRelation.header.indexOf(n);
  const typeNameByHash = new Map(typeRelation.rows.map((r) => [r[typeRelation.header.length - 1]!, r[t('name')]!]));
  for (const callee of ['MakeSeeds', 'ComputeDefault']) {
    const calls = callSites.rows.filter((r) => r[c('calleeName')] === callee);
    if (calls.length !== 1) {
      failures += fail(`${calls.length} call(s) to ${callee}, expected exactly 1 — the call in Kinds's initializer`);
      continue;
    }
    const call = calls[0]!;
    if (call[c('callerMethodLinkHash')] !== '') {
      failures += fail(`${callee}() in an initializer names a caller METHOD; no method in source runs an initializer`);
    }
    const callerType = typeNameByHash.get(call[c('callerTypeLinkHash')]!);
    if (callerType !== 'Kinds') {
      failures += fail(
        `${callee}()'s callerTypeLinkHash names ${callerType === undefined ? (call[c('callerTypeLinkHash')] === '' ? 'nothing' : 'no type row') : `the type ${callerType}`} ` +
          '— expected Kinds, the type whose initializer runs it'
      );
    }
  }

  const lambdaMethods = new Set(
    methods.rows
      .filter((r) => r[mCol('methodKind')] === 'LAMBDA')
      .map((r) => r[methods.header.length - 1]!)
  );
  // EVERY lambda expression row names its method row. The column is the hop
  // from a delegate value to the code it runs; the setter existed with
  // nothing calling it, and 0 of 99,529 lambda rows on one stratum carried
  // the link. Corpus-wide over the whole gate corpus, every kind of owner.
  const anonymousMethods = new Set(
    methods.rows
      .filter((r) => r[mCol('methodKind')] === 'LAMBDA' || r[mCol('methodKind')] === 'ANONYMOUS_METHOD')
      .map((r) => r[methods.header.length - 1]!)
  );
  const lambdaRows = expressions.rows.filter(
    (r) => r[e('kind')] === 'LAMBDA' || r[e('kind')] === 'ANONYMOUS_METHOD'
  );
  if (lambdaRows.length < 5) {
    failures += fail(`NEGATIVE CONTROL FAILED: only ${lambdaRows.length} lambda expression rows`);
  }
  // The curried shape: `a => b => a + b` is TWO lambda rows and two method
  // rows, the inner one owned by the outer's method. The inner is the outer's
  // whole body, which a walk of the body's children never reaches.
  const curried = lambdaRows.filter((r) => r[e('rootContext')] === 'LAMBDA_BODY' && r[e('csModuleLinkHash')] === spineHash);
  if (curried.length !== 1 || !anonymousMethods.has(curried[0]![e('anonymousDeclarationHash')]!)) {
    failures += fail(
      `${curried.length} lambda row(s) in LAMBDA_BODY context in Spine.cs, expected the inner ` +
        'function of `a => b => a + b`, linked to its own method row'
    );
  }
  const unlinked = lambdaRows.filter((r) => !anonymousMethods.has(r[e('anonymousDeclarationHash')]!));
  if (unlinked.length !== 0) {
    failures += fail(
      `${unlinked.length} of ${lambdaRows.length} lambda expression rows do not name their ` +
        'method row in anonymousDeclarationHash (first at line ' +
        `${unlinked[0]![e('startLine')]} of ${modules.rows.find((m) => m[modules.header.length - 1] === unlinked[0]![e('csModuleLinkHash')])?.[m('fileName')]}, ` +
        `owner ${unlinked[0]![e('expressionOwnerKind')]}). The row exists; the link is the hop.`
    );
  }
  if (!describeCalls.some((r) => lambdaMethods.has(r[c('callerMethodLinkHash')]!))) {
    failures += fail(
      'no call to Describe is owned by a LAMBDA. `n => Describe(n)` writes its parameter as ' +
        'a bare implicit_parameter, and a positional body-finder takes the parameter as ' +
        'the body and loses the expression entirely.'
    );
  }
  // And the accessor's call must be owned by the ACCESSOR, not by whatever
  // method happens to enclose it.
  const accessorMethods = new Set(
    methods.rows
      .filter((r) => r[mCol('isAccessor')] === 'true')
      .map((r) => r[methods.header.length - 1]!)
  );
  if (!describeCalls.some((r) => accessorMethods.has(r[c('callerMethodLinkHash')]!))) {
    failures += fail(
      'no call is owned by an accessor. A property getter is ordinary code and its calls ' +
        'belong to it.'
    );
  }
  // And a local function declared INSIDE an accessor has its method row, its
  // body walked, and the call to it classified — the accessor path emitted
  // the body and skipped the local functions, so `Build()` was a
  // LOCAL_FUNCTION_CALL to nothing (2 on one stratum, both in getters).
  const build = methods.rows.find(
    (r) => r[mCol('name')] === 'Build' && r[mCol('methodKind')] === 'LOCAL_FUNCTION'
  );
  if (build === undefined) {
    failures += fail('`Build()`, a local function declared inside a getter, has no method row');
  } else if (!spineCalls('Stamp').some((r) => r[c('callerMethodLinkHash')] === build[methods.header.length - 1])) {
    failures += fail('the call inside a getter`s local function is not owned by that local function');
  }
  if (spineCalls('Build').map((r) => r[c('callKind')]).join(',') !== 'LOCAL_FUNCTION_CALL') {
    failures += fail(`\`Build()\` in a getter is [${spineCalls('Build').map((r) => r[c('callKind')]).join(',')}], expected LOCAL_FUNCTION_CALL`);
  }

  // THE CONTEXT of a foreach's collection. The descent is total, so misnaming
  // the statement no longer LOSES the expression — it mislabels it, which is
  // section 4's defect exactly: a correctly-positioned row with the wrong kind.
  // Scoped to Spine.cs: Pragmas.cs has a Split of its own, in an argument.
  const splitCall = callSites.rows.find((r) => r[c('calleeName')] === 'Split' && r[c('csModuleLinkHash')] === spineHash);
  if (splitCall !== undefined) {
    const splitExpression = byHash.get(splitCall[c('csExpressionLinkHash')]!);
    if (splitExpression !== undefined && splitExpression[e('rootContext')] !== 'LOOP_HEADER') {
      failures += fail(
        `the foreach collection has rootContext ${splitExpression[e('rootContext')]}, ` +
          'expected LOOP_HEADER. The walker once named that statement for_each_statement ' +
          'where the grammar says foreach_statement.'
      );
    }
  }

  // `s!` is the NULL-FORGIVING operator, not an operation on a value.
  const forgiving = expressions.rows.filter((r) => r[e('isNullForgiving')] === 'true');
  if (forgiving.length === 0) {
    failures += fail(
      '`s!` produced no isNullForgiving row. It asserts non-nullness to the compiler and ' +
        'produces NO CODE — grouping it with ++/-- reports a mutation that never happens.'
    );
  }

  // `isExtensionCallSyntax` was DELETED by ruling (schema v1.4): it was
  // `callKind == METHOD_CALL` under another name. What its negative control
  // protected survives here — `this.M()` and `base.M()` are THIS and BASE
  // receivers, not NAME, and they were NAME on 19,832 rows when the receiver
  // was read positionally.
  const selfReceivers = new Set(['THIS', 'BASE']);
  if (!callSites.rows.some((r) => selfReceivers.has(r[c('receiverKind')]!))) {
    failures += fail(
      'NEGATIVE CONTROL FAILED: no call in the corpus has a THIS or BASE receiver. That is ' +
        'the position that was wrong on 19,832 rows, and it is untested.'
    );
  }
  for (const call of callSites.rows) {
    const kind = call[c('callKind')];
    const receiver = call[c('receiverKind')];
    // Two columns, one fact: a METHOD_CALL has a receiver and a FUNCTION_CALL
    // does not. They must agree, with no expected value needed.
    if (kind === 'METHOD_CALL' && receiver === 'NONE') {
      failures += fail('a METHOD_CALL reports no receiver');
      break;
    }
    if (kind === 'FUNCTION_CALL' && receiver !== 'NONE') {
      failures += fail(`a FUNCTION_CALL reports a ${receiver} receiver`);
      break;
    }
  }

  // AN INTERNAL CONTRADICTION, checked with NO expected values.
  //
  // `isNullConditional` on the expression and `callKind` on its call site
  // record the SAME FACT. They disagreed on every `a?.M()` in the corpus:
  // callKind tested the `member_binding_expression`, but the callee of an
  // invocation is the enclosing `conditional_access_expression`, so
  // NULL_CONDITIONAL_CALL was emitted zero times against 519,647 call sites
  // while the child expression said otherwise.
  //
  // Gates like this are the cheapest kind: they need no fixture to predict and
  // no oracle to adjudicate. Two columns for one fact either agree or the fact
  // base is wrong about itself.
  const nullConditionalCalls = callSites.rows.filter(
    (r) => r[c('callKind')] === 'NULL_CONDITIONAL_CALL'
  );
  if (nullConditionalCalls.length === 0) {
    failures += fail(
      'NEGATIVE CONTROL FAILED: no NULL_CONDITIONAL_CALL in the corpus, so the agreement ' +
        'below is checked against nothing'
    );
  }
  for (const call of callSites.rows) {
    const isNullConditionalCall = call[c('callKind')] === 'NULL_CONDITIONAL_CALL';
    const expression = byHash.get(call[c('csExpressionLinkHash')]!);
    if (expression === undefined) {
      continue;
    }
    const flagged = expression[e('isNullConditional')] === 'true';
    if (isNullConditionalCall !== flagged) {
      failures += fail(
        `a call site says callKind=${call[c('callKind')]} and its expression says ` +
          `isNullConditional=${expression[e('isNullConditional')]}. One fact, two columns, ` +
          'and they disagree — a consumer resolves that by reading whichever it saw first.'
      );
      break;
    }
  }
  for (const call of nullConditionalCalls) {
    if (call[c('receiverKind')] === 'NONE') {
      failures += fail(
        '`a?.M()` reports no receiver. The receiver is the `condition` field of the ' +
          'conditional access, and without it the row reads exactly like a bare `M()`.'
      );
      break;
    }
    // And the receiver is a CHILD ROW with the RECEIVER role, not only a
    // column: the whole conditional access was pushed as the METHOD_NAME, so
    // 1,469 of 405,300 method calls on one stratum had no receiver child.
    const roles = childrenOf(call[c('csExpressionLinkHash')]!).map((k) => k[e('edgeRole')]);
    if (!roles.includes('RECEIVER') || !roles.includes('METHOD_NAME')) {
      failures += fail(
        `\`a?.M()\` has children [${roles.join(', ')}] — expected a RECEIVER and a ` +
          'METHOD_NAME, the same two roles a plain member call carries'
      );
      break;
    }
  }

  // A CALL INSIDE A NAMED ARGUMENT, INSIDE AN ARRAY CREATION, AND AFTER A
  // COMMENT. Three unrelated symptoms of the same cause — a container that
  // emits no row takes its whole subtree with it, and a positional index that a
  // comment or a name field has shifted lands on the wrong child.
  const wrapCalls = callSites.rows.filter((r) => r[c('calleeName')] === 'Wrap');
  if (wrapCalls.length < 3) {
    failures += fail(
      `${wrapCalls.length} calls to Wrap, expected at least 3 — one as a NAMED ARGUMENT's ` +
        'value, one inside an ARRAY CREATION, and one in a conditional branch that a ' +
        'COMMENT sits in front of. Each was lost to a different container that emitted no row.'
    );
  }

  // DISCARDS (CS-ORACLE-2). In `Discards` every `_` is a DISCARD row and none
  // is a NAME_REFERENCE; in `DeclaredUnderscore` the two `_` are references
  // to the declared local, and neither is a DISCARD.
  {
    const relHash = modules.rows.find((r) => (r[m('fileName')] ?? '').endsWith('Relational.cs'))?.[modules.header.length - 1] ?? '';
    const discardsMethod = methods.rows.find((r) => r[mCol('csModuleLinkHash')] === relHash && r[mCol('name')] === 'Discards')?.[methods.header.length - 1];
    const declaredMethod = methods.rows.find((r) => r[mCol('csModuleLinkHash')] === relHash && r[mCol('name')] === 'DeclaredUnderscore')?.[methods.header.length - 1];
    const underscoresIn = (owner: string | undefined): (readonly string[])[] =>
      expressions.rows.filter((r) => r[e('expressionOwnerHash')] === owner && (r[e('kind')] === 'DISCARD' || (r[e('kind')] === 'NAME_REFERENCE' && r[e('potentialQualifiedName')] === '_')));
    const inDiscards = underscoresIn(discardsMethod);
    const discardKinds = inDiscards.map((r) => r[e('kind')]);
    if (inDiscards.length !== 5 || discardKinds.some((k) => k !== 'DISCARD')) {
      failures += fail(`Discards() has ${inDiscards.length} \`_\` row(s) with kinds [${discardKinds.join(',')}], expected 5 DISCARD — an assignment target, an out argument, a deconstruction element, a switch-arm pattern and an is-pattern`);
    }
    if (inDiscards.some((r) => r[e('referencedEntityHash')] !== '')) {
      failures += fail('a DISCARD row carries a referencedEntityHash — a discard references nothing');
    }
    const inDeclared = underscoresIn(declaredMethod);
    if (inDeclared.length !== 2 || inDeclared.some((r) => r[e('kind')] !== 'NAME_REFERENCE' || r[e('referencedEntityKind')] !== 'LOCAL_VARIABLE')) {
      failures += fail(`DeclaredUnderscore() has ${inDeclared.length} \`_\` row(s) with kinds [${inDeclared.map((r) => `${r[e('kind')]}/${r[e('referencedEntityKind')]}`).join(',')}], expected 2 NAME_REFERENCE/LOCAL_VARIABLE — a declared \`_\` is a variable, not a discard`);
    }
  }

  // GENERIC CALLS THAT ALSO READ AS COMPARISONS (CS-CORPUS-26, fork rule 11).
  // Convert, AddFactory, BitCast and Widen are each called exactly once in
  // Relational.cs, each with typeArgumentCount 1 or 2; Combine has TWO
  // arguments, not four. And the file parses clean: no parse gap, so the counts
  // above are counts of shapes rather than of recovery.
  {
    const relHash = modules.rows.find((r) => (r[m('fileName')] ?? '').endsWith('Relational.cs'))?.[modules.header.length - 1] ?? '';
    const relCalls = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === relHash);
    for (const [name, typeArgs] of [['Convert', '1'], ['AddFactory', '1'], ['BitCast', '2'], ['Widen', '2']] as const) {
      const rows = relCalls.filter((r) => r[c('calleeName')] === name);
      if (rows.length !== 1 || rows[0]![c('typeArgumentCount')] !== typeArgs) {
        failures += fail(`${rows.length} call(s) to ${name} with type arguments [${rows.map((r) => r[c('typeArgumentCount')]).join(',')}], expected exactly 1 with ${typeArgs} — a generic call read as comparisons`);
      }
    }
    const combine = relCalls.find((r) => r[c('calleeName')] === 'Combine');
    if (combine?.[c('argumentCount')] !== '2') {
      failures += fail(`Combine(…) has ${combine?.[c('argumentCount')] ?? 'no'} arguments, expected 2 — the comma of a two-argument type list split the argument list`);
    }
    // Relational.cs has NO parse gap, and must not. Every count asserted above
    // and below is a count over the WHOLE file, so one unreadable line skews
    // all of them at once and the diagnosis reads as a classification defect in
    // whichever assertion happens to be checked first. Shapes the grammar
    // cannot read live in torture/, one per file, where the recovery is what is
    // measured. This is the guard that keeps them from drifting back in.
    const gaps = relations.get('all-csharp-parse-gaps.csv');
    if (gaps !== undefined && gaps.rows.some((r) => r[gaps.header.indexOf('csModuleLinkHash')] === relHash)) {
      failures += fail(
        'Relational.cs HAS a parse gap. Something unparseable was added to it — move that ' +
          'shape to src/test-data/csharp/torture/ and assert it there, or every count over ' +
          'this file is measuring the gap rather than the shape it names.'
      );
    }
  }

  // NAMEOF IN PATTERN POSITION (CS-CORPUS-28, fork rule 9). Relational.cs has
  // three nameof patterns — two case labels, one switch arm — and each is a
  // NAMEOF row: no NAME_REFERENCE spelled `nameof` anywhere in the file, and
  // the positional pattern's `x` and `y` are PATTERN_BINDING references, not
  // the arguments of a call.
  {
    const relHash = modules.rows.find((r) => (r[m('fileName')] ?? '').endsWith('Relational.cs'))?.[modules.header.length - 1] ?? '';
    const relRows = expressions.rows.filter((r) => r[e('csModuleLinkHash')] === relHash);
    const nameofRows = relRows.filter((r) => r[e('kind')] === 'NAMEOF');
    // Five: two in throw arguments (the earlier methods), two case labels, one
    // switch arm — the last three are the pattern positions.
    if (nameofRows.length !== 5) {
      failures += fail(`${nameofRows.length} NAMEOF row(s) in Relational.cs, expected 5 — two arguments, two case labels and a switch arm`);
    }
    if (nameofRows.filter((r) => r[e('rootContext')] === 'CASE_LABEL').length !== 2) {
      failures += fail(`${nameofRows.filter((r) => r[e('rootContext')] === 'CASE_LABEL').length} NAMEOF row(s) in CASE_LABEL context, expected 2`);
    }
    if (nameofRows.filter((r) => r[e('edgeRole')] === 'SWITCH_ARM_PATTERN').length !== 1) {
      failures += fail(`${nameofRows.filter((r) => r[e('edgeRole')] === 'SWITCH_ARM_PATTERN').length} NAMEOF row(s) as a switch arm's pattern, expected 1`);
    }
    const bareNameof = relRows.filter((r) => r[e('kind')] === 'NAME_REFERENCE' && r[e('potentialQualifiedName')] === 'nameof');
    if (bareNameof.length > 0) {
      failures += fail(`${bareNameof.length} bare NAME_REFERENCE(s) spelled nameof in Relational.cs — a nameof read as a positional pattern's type`);
    }
    if (callSites.rows.some((r) => r[c('csModuleLinkHash')] === relHash && r[c('calleeName')] === 'Point')) {
      failures += fail('`o is Point(var x, var y)` produced a call site named Point — the positional pattern was read as a call on the is-expression');
    }
    const bindings = relRows.filter((r) => r[e('kind')] === 'NAME_REFERENCE' && r[e('referencedEntityKind')] === 'PATTERN_BINDING' && (r[e('potentialQualifiedName')] === 'x' || r[e('potentialQualifiedName')] === 'y'));
    if (bindings.length !== 2) {
      failures += fail(`${bindings.length} PATTERN_BINDING reference(s) to x / y after \`o is Point(var x, var y)\`, expected 2`);
    }
  }

  // GENERIC CREATION WITH ARGUMENTS AND AN INITIALIZER (CS-CORPUS-22, fork
  // rule 8). Each of the two creations in Relational.cs is ONE
  // OBJECT_CREATION row whose span ends at the initializer's `}` — the end
  // column of its line — with the initializer's elements under it, and no
  // CAST or comparison row on that line at all.
  {
    const relHash = modules.rows.find((r) => (r[m('fileName')] ?? '').endsWith('Relational.cs'))?.[modules.header.length - 1] ?? '';
    const relRows = expressions.rows.filter((r) => r[e('csModuleLinkHash')] === relHash);
    // The two WITH an initializer; the nested-type creations below have none.
    const creations = relRows.filter((r) => r[e('kind')] === 'OBJECT_CREATION' && r[e('parentExpressionHash')] === '' && Number(r[e('startLine')]) < 60);
    if (creations.length !== 2) {
      failures += fail(`${creations.length} OBJECT_CREATION root(s) with an initializer in Relational.cs, expected 2 — a generic creation with arguments and an initializer, twice`);
    }
    for (const creation of creations) {
      const line = creation[e('startLine')];
      const sameLine = relRows.filter((r) => r[e('startLine')] === line);
      const wrong = sameLine.filter((r) => r[e('kind')] === 'CAST' || (r[e('kind')] === 'BINARY' && (r[e('operatorString')] === '<' || r[e('operatorString')] === '>')));
      if (wrong.length > 0) {
        failures += fail(`the creation on line ${line} of Relational.cs was read as ${wrong.map((r) => r[e('kind')]).join('/')} — \`new T<A>(x) { … }\` parsed as comparisons and a cast`);
        continue;
      }
      const initializer = relRows.find((r) => r[e('parentExpressionHash')] === creation[ePk] && r[e('kind')] === 'INITIALIZER');
      if (initializer === undefined) {
        failures += fail(`the creation on line ${line} of Relational.cs has no INITIALIZER child — its span ended before the \`{\``);
        continue;
      }
      if (creation[e('endColumn')] !== initializer[e('endColumn')] || creation[e('endLine')] !== initializer[e('endLine')]) {
        failures += fail(`the creation on line ${line} ends at ${creation[e('endLine')]}:${creation[e('endColumn')]}, its initializer at ${initializer[e('endLine')]}:${initializer[e('endColumn')]} — the row must span the initializer`);
      }
    }
    if (!callSites.rows.some((r) => r[c('csModuleLinkHash')] === relHash && r[c('calleeName')] === 'Store' && r[c('startLine')] === creations[0]?.[e('startLine')])) {
      // Store("k", 2) sits inside the first creation's initializer; if the
      // shape is read as a cast the call still exists, so this is the weaker
      // net and the span assertion above is the real one.
      failures += fail('Store("k", 2) inside the generic creation\'s initializer produced no call site on that line');
    }

  }

  // Deep.cs — a 40-segment fluent chain. Every segment's call and the
  // creation at the root are rows; the cap that dropped them was 32.
  {
    const deepHash = modules.rows.find((r) => (r[m('fileName')] ?? '').endsWith('Deep.cs'))?.[modules.header.length - 1] ?? '';
    const steps = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === deepHash && /^Step\d+$/.test(r[c('calleeName')] ?? ''));
    const root = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === deepHash && r[c('callKind')] === 'CONSTRUCTOR_CALL' && r[c('calleeName')] === 'Builder');
    if (steps.length !== 40 || root.length !== 1) {
      failures += fail(`the 40-segment chain in Deep.cs produced ${steps.length} Step calls and ${root.length} Builder creation(s) — expected 40 and 1: a fluent chain nests one level per segment and a depth cap drops its innermost segments SILENTLY`);
    }
    const deepest = Math.max(0, ...expressions.rows.filter((r) => r[e('csModuleLinkHash')] === deepHash).map((r) => Number(r[e('depth')])));
    if (deepest < 40) {
      failures += fail(`Deep.cs's deepest expression row is at depth ${deepest}, expected at least 40`);
    }
  }

  // Binding.cs — precedence shapes with their own module, so the counts the
  // Relational.cs checks key on are undisturbed.
  {
    const relHash = modules.rows.find((r) => (r[m('fileName')] ?? '').endsWith('Binding.cs'))?.[modules.header.length - 1] ?? '';
    const relRows = expressions.rows.filter((r) => r[e('csModuleLinkHash')] === relHash);
    if (relRows.length === 0) {
      failures += fail('Binding.cs produced no expression rows');
    }
    // A NAMED TUPLE TYPE as the generic argument (CS-CORPUS-22's residual):
    // one CONSTRUCTOR_CALL named HashSet with one argument, no comparison on
    // its line, and no phantom local named Name or Schema.
    const namedTuple = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === relHash && r[c('calleeName')] === 'HashSet');
    const tupleCreation = namedTuple.find((r) => r[c('argumentCount')] === '1');
    if (tupleCreation === undefined || tupleCreation[c('callKind')] !== 'CONSTRUCTOR_CALL') {
      failures += fail(`\`new HashSet<(string Name, string? Schema)>(src)\` produced ${namedTuple.length} HashSet call(s) [${namedTuple.map((r) => `${r[c('callKind')]}/${r[c('argumentCount')]}`).join(',')}] — expected a CONSTRUCTOR_CALL with 1 argument; a named tuple element scores the point its declaration-expression reading does`);
    } else {
      const line = tupleCreation[c('startLine')];
      const comparisons = relRows.filter((r) => r[e('startLine')] === line && r[e('kind')] === 'BINARY' && (r[e('operatorString')] === '<' || r[e('operatorString')] === '>'));
      if (comparisons.length > 0) {
        failures += fail(`the named-tuple creation on line ${line} was read as ${comparisons.length} comparison(s)`);
      }
    }
    const variables = relations.get('all-csharp-variables.csv')!;
    const phantom = variables.rows.filter((r) => r[variables.header.indexOf('csModuleLinkHash')] === relHash && ['Name', 'Schema'].includes(r[variables.header.indexOf('name')] ?? ''));
    if (phantom.length !== 0) {
      failures += fail(`${phantom.length} phantom local(s) named Name/Schema in Binding.cs — the tuple TYPE's elements were read as declaration expressions`);
    }

    // BINDING.CS PARSES CLEAN, and must. `[property]` used to live here and is
    // an ERROR shape — it is asserted in torture/newer-syntax/ now — and while
    // it was here every count below was a count over a file with a parse gap
    // in it. Same guard as Relational.cs, for the same reason.
    {
      const gaps = relations.get('all-csharp-parse-gaps.csv');
      if (gaps !== undefined && gaps.rows.some((r) => r[gaps.header.indexOf('csModuleLinkHash')] === relHash)) {
        failures += fail(
          'Binding.cs HAS a parse gap. Something unparseable was added to it — move that ' +
            'shape to src/test-data/csharp/torture/ and assert it there.'
        );
      }
    }

    // FORK RULE 15: `?.` binds to a PRIMARY. In NullConditionalAfterOperator
    // every NULL_CONDITIONAL_CALL's receiver is the NAME `b`, never a BINARY
    // or a unary — and the cast's operand is the conditional access, not the
    // other way round.
    const nullConditional = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === relHash && r[c('callKind')] === 'NULL_CONDITIONAL_CALL' && ['Contains', 'StartsWith'].includes(r[c('calleeName')] ?? ''));
    if (nullConditional.length !== 2) {
      failures += fail(`${nullConditional.length} NULL_CONDITIONAL_CALL rows named Contains/StartsWith in Binding.cs, expected 2`);
    }
    const byHash = new Map(relRows.map((r) => [r[ePk]!, r]));
    for (const call of nullConditional) {
      const row = byHash.get(call[c('csExpressionLinkHash')] ?? '');
      const receiver = row === undefined ? undefined : relRows.find((r) => r[e('parentExpressionHash')] === row[ePk] && r[e('edgeRole')] === 'RECEIVER');
      if (receiver?.[e('kind')] !== 'NAME_REFERENCE' || receiver[e('potentialQualifiedName')] !== 'b') {
        failures += fail(`\`b?.${call[c('calleeName')]}(…)\` after an operator has receiver ${receiver === undefined ? 'absent' : `${receiver[e('kind')]} ${JSON.stringify(receiver[e('potentialQualifiedName')])}`} — expected the NAME b: \`?.\` binds to a primary, and upstream read \`a || b?.M()\` as \`(a || b)?.M()\``);
      }
    }
    const castRow = relRows.find((r) => r[e('kind')] === 'CAST' && r[e('startLine')] === nullConditional[0]?.[c('startLine')]);
    const castOperand = castRow === undefined ? undefined : relRows.find((r) => r[e('parentExpressionHash')] === castRow[ePk] && r[e('edgeRole')] !== 'CAST_TYPE');
    if (castRow === undefined || castOperand?.[e('kind')] !== 'NAME_REFERENCE') {
      failures += fail(`\`((string?)x)?.Length\` — the CAST row ${castRow === undefined ? 'is absent' : `has a ${castOperand?.[e('kind')] ?? 'missing'} operand`}, expected the NAME x under the cast and the cast under the \`?.\`, not \`?.\` under the cast`);
    }
  }

  // `point with { X = Scale(n), Y = … ? Scale(1) : throw new … }`. The WITH
  // row's children are the operand and one ASSIGNMENT per initializer, each
  // with a target and a value; the two Scale calls and the throw's creation
  // sit under them. Before the fix the WITH row had one child and the record
  // copy's initializer was a hole 64 calls wide on one stratum.
  const spine2Hash = modules.rows.find((r) => (r[m('fileName')] ?? '').endsWith('Spine2.cs'))?.[modules.header.length - 1] ?? '';
  const withRows = expressions.rows.filter((r) => r[e('kind')] === 'WITH_EXPRESSION' && r[e('csModuleLinkHash')] === spine2Hash);
  if (withRows.length !== 1) {
    failures += fail(`${withRows.length} WITH_EXPRESSION row(s) in Spine2.cs, expected exactly 1`);
  } else {
    const withHash = withRows[0]![ePk]!;
    const initializers = expressions.rows.filter(
      (r) => r[e('parentExpressionHash')] === withHash && r[e('kind')] === 'ASSIGNMENT' && r[e('operatorString')] === '='
    );
    if (initializers.length !== 2) {
      failures += fail(`the with-expression has ${initializers.length} ASSIGNMENT initializer(s) as children, expected 2 — X and Y`);
    }
    const initializerHashes = new Set(initializers.map((r) => r[ePk]!));
    const targets = expressions.rows.filter((r) => initializerHashes.has(r[e('parentExpressionHash')]!) && r[e('edgeRole')] === 'INITIALIZER_TARGET');
    if (targets.map((r) => r[e('potentialQualifiedName')]).sort().join(',') !== 'X,Y') {
      failures += fail(`the with-initializer targets are [${targets.map((r) => r[e('potentialQualifiedName')]).join(',')}], expected X and Y`);
    }
    const underWith = (hash: string): boolean => {
      let current = byHash.get(hash);
      for (let hops = 0; current !== undefined && hops < 12; hops += 1) {
        if (current[ePk] === withHash) {
          return true;
        }
        current = byHash.get(current[e('parentExpressionHash')]!);
      }
      return false;
    };
    const scaleUnderWith = callSites.rows.filter((r) => r[c('calleeName')] === 'Scale' && underWith(r[c('csExpressionLinkHash')]!));
    if (scaleUnderWith.length !== 2) {
      failures += fail(`${scaleUnderWith.length} call(s) to Scale under the with-expression, expected 2 — one per initializer`);
    }
    if (!callSites.rows.some((r) => r[c('calleeName')] === 'InvalidOperationException' && underWith(r[c('csExpressionLinkHash')]!))) {
      failures += fail('the throw inside a with-initializer produced no CONSTRUCTOR_CALL under the with-expression');
    }
  }

  const scaleCalls = callSites.rows.filter((r) => r[c('calleeName')] === 'Scale');
  if (scaleCalls.length < 3) {
    failures += fail(
      `${scaleCalls.length} calls to Scale, expected at least 3 — one in a LET clause, one ` +
        'as a named argument value, and one inside an array creation'
    );
  }
  // THE NAMED ARGUMENT'S VALUE, by position in the tree rather than by count:
  // `Wrap(label: Scale(n))` has exactly one Scale call that is an ARGUMENT
  // child of a Wrap invocation. The count above was padded past its threshold
  // by later fixtures, and reading the argument positionally — the label
  // instead of the value — passed it; the full tally said so.
  const wrapInvocationHashes = new Set(
    callSites.rows.filter((r) => r[c('calleeName')] === 'Wrap').map((r) => r[c('csExpressionLinkHash')]!)
  );
  const scaleAsNamedValue = scaleCalls.filter((r) => {
    const row = byHash.get(r[c('csExpressionLinkHash')]!);
    return row?.[e('edgeRole')] === 'ARGUMENT' && wrapInvocationHashes.has(row[e('parentExpressionHash')]!);
  });
  if (scaleAsNamedValue.length !== 1) {
    failures += fail(
      `${scaleAsNamedValue.length} Scale call(s) are the ARGUMENT of a Wrap invocation, expected exactly 1 — ` +
        '`Wrap(label: Scale(n))`; a named argument read positionally yields the label and drops the value'
    );
  }
  if (!expressions.rows.some((r) => r[e('kind')] === 'ARRAY_CREATION')) {
    failures += fail(
      '`new object[] { … }` produced no ARRAY_CREATION row. A node that emits nothing takes ' +
        'its subtree with it, and this one holds calls.'
    );
  }
  // And an array creation must NOT be a call site: allocating an array invokes
  // no constructor, and a CONSTRUCTOR_CALL edge here points at nothing.
  const arrayRows = new Set(
    expressions.rows
      .filter((r) => r[e('kind')] === 'ARRAY_CREATION')
      .map((r) => r[ePk]!)
  );
  if (callSites.rows.some((r) => arrayRows.has(r[c('csExpressionLinkHash')]!))) {
    failures += fail(
      'an ARRAY_CREATION produced a call site. `new int[10]` calls no constructor, and the ' +
        'edge would point at one that does not exist.'
    );
  }

  // TOP-LEVEL STATEMENTS. The member walk starts at a declaration, so a file
  // with no type and no method contributed NOTHING — every call in every
  // minimal-hosting `Program.cs` was absent.
  const topLevelModule = modules.rows.find((r) =>
    (r[m('fileName')] ?? '').endsWith('TopLevel.cs')
  );
  if (topLevelModule === undefined) {
    failures += fail('TopLevel.cs produced no cs_module row');
  } else {
    const moduleHash = topLevelModule[modules.header.length - 1]!;
    const topLevelCalls = callSites.rows.filter(
      (r) => r[c('csModuleLinkHash')] === moduleHash
    );
    if (topLevelCalls.length < 3) {
      failures += fail(
        `${topLevelCalls.length} call sites in a file of top-level statements, expected at ` +
          'least 3 — one in a statement, one in a foreach BODY and one in a local function'
      );
    }
    // THE OWNER IS `Program.<Main>$` — RULING v1.6 §4.0.3, answered by Roslyn:
    // both the synthesised method and its type carry one
    // DeclaringSyntaxReference, the compilation unit, so they are adjudicable
    // rows and not inventions. Every global statement's enclosing symbol is
    // `<Main>$`; a top-level local function is contained by it.
    const types = relations.get('all-csharp-types.csv');
    const tCol = (n: string): number => types === undefined ? -1 : types.header.indexOf(n);
    const program = types?.rows.find(
      (r) =>
        r[tCol('csModuleLinkHash')] === moduleHash &&
        r[tCol('name')] === 'Program' &&
        r[tCol('typeModifiers')]!.includes('SYNTHESIZED')
    );
    if (types === undefined || program === undefined) {
      failures += fail(
        'TopLevel.cs has no synthesised cs_type named Program with the SYNTHESIZED ' +
          'modifier. Roslyn declares one, with one DeclaringSyntaxReference at the ' +
          'compilation unit.'
      );
    } else {
      const expectedType: [string, string][] = [
        ['typeCategory', 'CLASS'],
        ['typeAccess', 'INTERNAL'],
        ['arity', '0'],
        ['isPartial', 'true'],
        ['declarationScopeKey', 'NS:'],
        ['startLine', '1'],
      ];
      for (const [column, expected] of expectedType) {
        if (program[tCol(column)] !== expected) {
          failures += fail(
            `the synthesised Program has ${column} = ${JSON.stringify(program[tCol(column)])}, ` +
              `Roslyn says ${expected}`
          );
        }
      }
    }
    const programHash = program?.[types!.header.length - 1] ?? '';
    const entry = methods.rows.find(
      (r) =>
        r[mCol('csModuleLinkHash')] === moduleHash &&
        r[mCol('methodKind')] === 'TOP_LEVEL_ENTRY_POINT'
    );
    if (entry === undefined) {
      failures += fail('TopLevel.cs has no cs_method of kind TOP_LEVEL_ENTRY_POINT');
    } else {
      const expectedMethod: [string, string][] = [
        ['name', '<Main>$'],
        ['isStatic', 'true'],
        ['returnTypeName', 'void'],
        ['csTypeLinkHash', programHash],
        ['startLine', '1'],
      ];
      for (const [column, expected] of expectedMethod) {
        if (entry[mCol(column)] !== expected) {
          failures += fail(
            `<Main>$ has ${column} = ${JSON.stringify(entry[mCol(column)])}, expected ` +
              `${JSON.stringify(expected)}`
          );
        }
      }
    }
    const entryHash = entry?.[methods.header.length - 1] ?? '';
    // THE MODULE'S HOP TO ITS ENTRY POINT is `<Main>$` ITSELF — not a local
    // function in the file, not any method that resolves. Register 10; it was
    // read for resolution only.
    if (entry !== undefined && topLevelModule[m('csModuleInitMethodLinkHash')] !== entryHash) {
      const linked = methods.rows.find((r) => r[methods.header.length - 1] === topLevelModule[m('csModuleInitMethodLinkHash')]);
      failures += fail(
        `TopLevel.cs's csModuleInitMethodLinkHash names ${linked === undefined ? 'no method' : `${linked[mCol('name')]} (${linked[mCol('methodKind')]})`} ` +
          '— expected <Main>$, the TOP_LEVEL_ENTRY_POINT'
      );
    }
    const owned = expressions.rows.filter(
      (r) => r[e('csModuleLinkHash')] === moduleHash && r[e('expressionOwnerKind')] === 'METHOD'
    );
    // Every expression NOT inside a lambda or local function is owned by the
    // entry point; nothing in the file is owned by the module any more.
    const ownedByEntry = owned.filter((r) => r[e('expressionOwnerHash')] === entryHash);
    if (ownedByEntry.length === 0) {
      failures += fail('no expression in TopLevel.cs is owned by <Main>$');
    }
    if (
      expressions.rows.some(
        (r) => r[e('csModuleLinkHash')] === moduleHash && r[e('expressionOwnerKind')] === 'MODULE_INIT'
      )
    ) {
      failures += fail('an expression in TopLevel.cs is still owned by MODULE_INIT');
    }
    // And every call in a top-level statement has a REAL callerMethodLinkHash.
    for (const call of topLevelCalls) {
      if (call[c('callerMethodLinkHash')] === '') {
        failures += fail('a call in a top-level statement has an empty callerMethodLinkHash');
        break;
      }
    }
    if (!topLevelCalls.some((r) => r[c('callerMethodLinkHash')] === entryHash)) {
      failures += fail('no call in TopLevel.cs names <Main>$ as its caller');
    }
    // A LOCAL FUNCTION at top level still gets its own method row, and its body
    // is walked — the same rule as one inside a method — and it is CONTAINED
    // by Program, as Roslyn reports.
    const topLevelLocal = methods.rows.find(
      (r) =>
        r[mCol('csModuleLinkHash')] === moduleHash &&
        r[mCol('methodKind')] === 'LOCAL_FUNCTION'
    );
    if (topLevelLocal === undefined) {
      failures += fail('a local function declared among top-level statements has no row');
    } else if (topLevelLocal[mCol('csTypeLinkHash')] !== programHash) {
      failures += fail('a top-level local function is not contained by the synthesised Program');
    }
    // THE MERGE. TopLevelTwo.cs writes `public partial class Program`, and the
    // written part and the synthesised part must share ONE declarationGroupKey
    // — Roslyn reports two DeclaringSyntaxReferences on one type — with
    // distinct primary keys. The synthesised part is isPartial without a
    // keyword; the gate that says "only partial types have multi-part groups"
    // must not fail on that.
    const twoModule = modules.rows.find((r) => (r[m('fileName')] ?? '').endsWith('TopLevelTwo.cs'));
    const twoHash = twoModule?.[modules.header.length - 1] ?? '';
    const programsInTwo = (types?.rows ?? []).filter(
      (r) => r[tCol('csModuleLinkHash')] === twoHash && r[tCol('name')] === 'Program'
    );
    if (programsInTwo.length !== 2) {
      failures += fail(
        `TopLevelTwo.cs has ${programsInTwo.length} cs_type rows named Program, expected 2 — ` +
          'the written partial and the synthesised one'
      );
    } else {
      const [x, y] = programsInTwo;
      if (x![tCol('declarationGroupKey')] !== y![tCol('declarationGroupKey')]) {
        failures += fail(
          'the written `partial class Program` and the synthesised Program do not share a ' +
            'declarationGroupKey — Roslyn merges them, and the engine could not'
        );
      }
      if (x![types!.header.length - 1] === y![types!.header.length - 1]) {
        failures += fail('the two Program parts share a PRIMARY key — duplicates DOUBLE');
      }
      if (programsInTwo.some((r) => r[tCol('isPartial')] !== 'true')) {
        failures += fail('a Program part is not isPartial, so the two parts could not merge');
      }
    }
    // ONE SCOPE ACROSS ALL THE STATEMENTS. `scale` is declared in one top-level
    // statement and invoked in the next; the file is one body, not a body per
    // statement. Each statement once got a fresh locals scope, so a local
    // declared on line 5 was invisible to its own invocation on line 37 and a
    // DELEGATE_INVOKE was filed as a FUNCTION_CALL — a lookup miss that was
    // then reported as a positive claim. The fixture did not carry the shape
    // until the negative control for it was found unable to fail.
    const scaleKinds = topLevelCalls
      .filter((r) => r[c('calleeName')] === 'scale')
      .map((r) => r[c('callKind')]!);
    if (scaleKinds.length !== 1 || scaleKinds[0] !== 'DELEGATE_INVOKE') {
      failures += fail(
        `\`scale(3)\` at top level is classified [${scaleKinds.join('/')}], expected exactly ` +
          'one DELEGATE_INVOKE. `scale` is a local declared by the PREVIOUS top-level ' +
          'statement, and a lookup that cannot see it files a value as a method.'
      );
    }
  }

  // A CALL TO A VALUE is a delegate invocation, and a call to a local function
  // is not a call to a method. Both are same-file, one-hop facts: `lambda(1)`
  // names a local, `Local(2)` names a local function declared in the same body,
  // and `Scale(n)` names a METHOD on the type. Grounded on declared names, not
  // guessed from shape — the guess produced 2,080 phantom method groups in
  // multitarget-A before METHOD_GROUP was grounded the same way.
  const kindOfCallTo = (name: string): string[] =>
    callSites.rows.filter((r) => r[c('calleeName')] === name).map((r) => r[c('callKind')]!);
  if (!kindOfCallTo('lambda').includes('DELEGATE_INVOKE')) {
    failures += fail(
      '`lambda(1)` — a call to a LOCAL holding a delegate — is not DELEGATE_INVOKE. A value ' +
        'that is invoked is a delegate or the program does not compile.'
    );
  }
  if (!kindOfCallTo('Local').includes('LOCAL_FUNCTION_CALL')) {
    failures += fail('`Local(2)` — a call to a local function in the same body — is not LOCAL_FUNCTION_CALL');
  }
  if (kindOfCallTo('Scale').some((k) => k !== 'FUNCTION_CALL')) {
    failures += fail(
      `a call to Scale, a METHOD on the type, is classified ${kindOfCallTo('Scale').join('/')}. ` +
        'A method name is never a delegate and never a local function.'
    );
  }

  // Type-only constructs must NOT reach the call graph the ENGINE builds. §8.
  for (const typeOnly of ['int', 'string', 'void', 'Action']) {
    if (calleeNames.has(typeOnly)) {
      failures += fail(`\`${typeOnly}\` appears as a callee — a type reached the call graph`);
    }
  }

  return failures;
}

/**
 * IR COMPLETENESS — the measure that replaces "resolution rate".
 *
 * §0: **the parser emits IR and the engine resolves.** So the question is never
 * "what fraction did we resolve" — it is *for every construct, is every hop an
 * engine would need actually present?* A row that resolves nothing is complete
 * if the hops are there, and a row that resolves something is worthless if they
 * are not.
 *
 * This is the check the C# suite did not have, and its absence was the reason a
 * decision about whether the front end was ready got argued on call-graph
 * grounds — which is the engine's measure, not the parser's.
 *
 * Each clause below names ONE construct and the hops an engine needs for it.
 */
function irCompleteness(outputDir: string): number {
  let failures = 0;
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const get = (name: string): Relation | undefined => {
    const relation = relations.get(name);
    return relation === undefined || relation.header.length === 0 ? undefined : relation;
  };
  const idx = (r: Relation, n: string): number => r.header.indexOf(n);
  const pkOf = (r: Relation, row: readonly string[]): string => row[r.header.length - 1]!;

  const expressions = get('all-csharp-expressions.csv');
  const callSites = get('all-csharp-call-sites.csv');
  const methods = get('all-csharp-methods.csv');
  const parameters = get('all-csharp-method-parameters.csv');
  const usings = get('all-csharp-usings.csv');
  const types = get('all-csharp-types.csv');
  const queryClauses = get('all-csharp-query-clauses.csv');
  if (
    expressions === undefined || callSites === undefined || methods === undefined ||
    parameters === undefined || usings === undefined || types === undefined
  ) {
    return fail('a relation IR completeness reads is missing or empty');
  }

  const methodHashes = new Set(methods.rows.map((r) => pkOf(methods, r)));
  const expressionHashes = new Set(expressions.rows.map((r) => pkOf(expressions, r)));
  const typeHashes = new Set(types.rows.map((r) => pkOf(types, r)));
  const modules = get('all-csharp-modules.csv');
  const moduleHashes = new Set(modules?.rows.map((r) => pkOf(modules, r)) ?? []);

  // 1. A CALL SITE. An engine resolving it needs: the callee NAME as written,
  //    the expression it came from, the METHOD it sits in, and the receiver's
  //    text when there is one. It does NOT need the parser to have resolved the
  //    target — that is the whole point.
  let incompleteCalls = 0;
  for (const row of callSites.rows) {
    const caller = row[idx(callSites, 'callerMethodLinkHash')]!;
    // A call in a FIELD INITIALIZER has no enclosing method in source. It runs
    // from whichever constructor the compiler synthesises, and the parser
    // cannot pick one — so `callerMethodLinkHash` is empty and
    // `callerTypeLinkHash` carries the hop instead. Requiring the method hop
    // unconditionally would have made walking initializers at all look like a
    // regression, which is the gate mis-stating the rule rather than the parser
    // breaking it.
    //
    // TOP-LEVEL STATEMENTS have neither. `Console.WriteLine("Hello")` in a
    // `Program.cs` with no type and no method is owned by the FILE — the
    // compiler synthesises `Program.<Main>$` and that method exists in no
    // source file, so inventing a row for it is a question about whether a
    // construct with no syntax emits, and that is not the parser's to answer.
    // The module hash IS the hop, and it is on every row.
    const callerHopPresent =
      caller !== ''
        ? methodHashes.has(caller)
        : row[idx(callSites, 'callerTypeLinkHash')] !== ''
          ? typeHashes.has(row[idx(callSites, 'callerTypeLinkHash')]!)
          : moduleHashes.has(row[idx(callSites, 'csModuleLinkHash')]!);
    const hopsPresent =
      row[idx(callSites, 'calleeName')] !== '' &&
      expressionHashes.has(row[idx(callSites, 'csExpressionLinkHash')]!) &&
      callerHopPresent;
    if (!hopsPresent) {
      incompleteCalls += 1;
    }
  }
  if (incompleteCalls > 0) {
    failures += fail(
      `${incompleteCalls} of ${callSites.rows.length} call sites are missing a hop an ` +
        'engine needs: a callee name, the expression, or the enclosing method.'
    );
  }

  // 2. AN EXTENSION METHOD. Three facts make the edge reconstructable and the
  //    parser resolves none of them: the `this`-parameter marker, the declaring
  //    static class, and the governing `using` set. Any one absent and the edge
  //    cannot be rebuilt at all.
  // Keyed on parameterMode, NOT on isThis — and the negative-control harness is
  // why. `isExtension` is DERIVED from `isThis`, so a mutation that clears the
  // marker also empties the extension set and the whole clause below became
  // vacuous: it passed by having nothing to check. An assertion whose subject
  // disappears when the thing it asserts about breaks is not an assertion.
  const thisParameters = new Set(
    parameters.rows
      .filter((r) => r[idx(parameters, 'parameterMode')] === 'THIS')
      .map((r) => r[idx(parameters, 'csMethodLinkHash')]!)
  );
  const extensions = methods.rows.filter(
    (r) =>
      r[idx(methods, 'isExtension')] === 'true' || thisParameters.has(pkOf(methods, r))
  );
  if (thisParameters.size === 0) {
    failures += fail(
      'NEGATIVE CONTROL FAILED: no `this` parameter in the corpus, so the extension-method ' +
        'hand-off is not being checked at all.'
    );
  }
  // The two columns say the same thing and must not disagree.
  for (const extension of extensions) {
    const hash = pkOf(methods, extension);
    if ((extension[idx(methods, 'isExtension')] === 'true') !== thisParameters.has(hash)) {
      failures += fail(
        'isExtension and the THIS parameter disagree. They are one fact recorded twice, ' +
          'and a consumer will trust whichever it read first.'
      );
      break;
    }
  }
  for (const extension of extensions) {
    const hash = pkOf(methods, extension);
    if (!thisParameters.has(hash)) {
      failures += fail(
        'an extension method has no `this` parameter row. The receiver in the syntax is ' +
          'NOT the declaring type, so without the marker the edge is unreconstructable.'
      );
      break;
    }
    if (!typeHashes.has(extension[idx(methods, 'csTypeLinkHash')]!)) {
      failures += fail('an extension method does not resolve to its declaring static class');
      break;
    }
  }
  if (extensions.length > 0 && usings.rows.length === 0) {
    failures += fail(
      'extension methods exist and the module has no `using` rows. Visibility is decided ' +
        'by the using set in scope, so the third hop is missing.'
    );
  }

  // 3. LINQ. No call syntax in the source. An engine desugaring
  //    `from x in xs where p select f` needs the clause ORDER, the range
  //    variable each introduces, and the expressions each ranges over or
  //    evaluates. Without those the query is an opaque blob and LINQ-heavy code
  //    appears to call nothing.
  const queries = expressions.rows.filter((r) => r[idx(expressions, 'kind')] === 'QUERY');
  if (queries.length === 0) {
    failures += fail('NEGATIVE CONTROL FAILED: no query expression in the corpus.');
  }
  if (queryClauses === undefined) {
    failures += fail(
      'query expressions exist and cs_query_clause is empty. A query with no clauses is ' +
        'an opaque blob: the engine cannot desugar it and the calls inside it are lost.'
    );
  } else {
    for (const query of queries) {
      const hash = pkOf(expressions, query);
      const clauses = queryClauses.rows.filter(
        (r) => r[idx(queryClauses, 'csExpressionLinkHash')] === hash
      );
      if (clauses.length === 0) {
        failures += fail('a query expression produced no clause rows');
        break;
      }
      // ORDER is the content of the rewrite — Where().Select() and
      // Select().Where() compute different things.
      const positions = clauses
        .map((r) => Number(r[idx(queryClauses, 'position')]))
        .sort((a, b) => a - b);
      if (positions.some((value, i) => value !== i)) {
        failures += fail(
          `a query's clause positions are ${positions.join(',')} — not a dense ordering, ` +
            'so the rewrite order is unrecoverable'
        );
        break;
      }
      // The expressions inside the clauses must be REACHABLE, or a call in a
      // `where` is lost.
      //
      // Asserted through the clause's OWN links rather than "the query has at
      // least one child expression". The weaker form went green under a
      // mutation that unparented every clause expression, because some other
      // child of the query still satisfied it — a check that passes for the
      // wrong reason is a check that has stopped owning its invariant.
      const inside = expressions.rows.filter(
        (r) => r[idx(expressions, 'parentExpressionHash')] === hash
      );
      if (inside.length === 0) {
        failures += fail(
          "a query's clause expressions are not parented to it, so a call inside a " +
            '`where` or a `select` is unreachable'
        );
        break;
      }
      const parented = new Set(inside.map((r) => pkOf(expressions, r)));
      const linked = clauses.filter(
        (r) =>
          r[idx(queryClauses, 'sourceExpressionLinkHash')] !== '' ||
          r[idx(queryClauses, 'bodyExpressionLinkHash')] !== ''
      );
      if (linked.length === 0) {
        failures += fail(
          'no clause of this query names the expression it ranges over or evaluates. The ' +
            'clause rows exist and point at nothing, which is an opaque blob with a ' +
            'position column.'
        );
        break;
      }
      let unreachable = 0;
      for (const clause of linked) {
        for (const column of ['sourceExpressionLinkHash', 'bodyExpressionLinkHash']) {
          const link = clause[idx(queryClauses, column)]!;
          if (link !== '' && !parented.has(link)) {
            unreachable += 1;
          }
        }
      }
      if (unreachable > 0) {
        failures += fail(
          `${unreachable} clause expression link(s) point at a row that is not parented to ` +
            'the query. The engine walks DOWN from the query to desugar it, so an ' +
            'unreachable clause expression is a call it never sees.'
        );
        break;
      }
    }
    // THE LINKS POINT AT THE RIGHT ROWS, not merely at rows. `from x in xs`
    // ranges over `xs`; `let y = Scale(x)` evaluates the CALL. The declaring
    // identifier of each clause is an expression node too, and counting it as
    // the clause's first expression put every declaring clause one child to
    // the left — the from-clause's source was its own range variable, the
    // let-clause's body was `y`. The links were all present; the sufficiency
    // report scored them 100%, pointing at the wrong rows.
    const rowOf = (hash: string): readonly string[] | undefined =>
      expressions.rows.find((r) => pkOf(expressions, r) === hash);
    const fromClause = queryClauses.rows.find(
      (r) => r[idx(queryClauses, 'clauseKind')] === 'FROM' && r[idx(queryClauses, 'identifierName')] === 'x'
    );
    const fromSource = fromClause === undefined ? undefined : rowOf(fromClause[idx(queryClauses, 'sourceExpressionLinkHash')]!);
    if (fromSource?.[idx(expressions, 'potentialQualifiedName')] !== 'xs') {
      failures += fail(
        `\`from x in xs\` ranges over ${JSON.stringify(fromSource?.[idx(expressions, 'potentialQualifiedName')])}, ` +
          'expected `xs` — the declaring identifier is not one of the clause`s expressions'
      );
    }
    const letClause = queryClauses.rows.find(
      (r) => r[idx(queryClauses, 'clauseKind')] === 'LET' && r[idx(queryClauses, 'identifierName')] === 'y'
    );
    const letBody = letClause === undefined ? undefined : rowOf(letClause[idx(queryClauses, 'bodyExpressionLinkHash')]!);
    if (letBody?.[idx(expressions, 'kind')] !== 'INVOCATION') {
      failures += fail(
        `\`let y = Scale(x)\` evaluates a ${letBody?.[idx(expressions, 'kind')]}, expected the INVOCATION`
      );
    }
    // The `into h` continuation declares a range variable, and `h.Key` after
    // it names that declaration.
    const variableRows = get('all-csharp-variables.csv');
    const continuation =
      variableRows === undefined
        ? undefined
        : variableRows.rows.find(
            (r) => r[idx(variableRows, 'name')] === 'h' && r[idx(variableRows, 'declarationKind')] === 'QUERY_RANGE'
          );
    if (continuation === undefined) {
      failures += fail('`group … into h` declares no QUERY_RANGE variable named h');
    }
    // A call inside a query clause is an ordinary call and must be found.
    if (!callSites.rows.some((r) => r[idx(callSites, 'calleeName')] === 'Scale')) {
      failures += fail(
        'the call inside a `let` clause was not found. LINQ-heavy code appearing to call ' +
          'nothing is the specific failure this relation exists to prevent.'
      );
    }
  }

  // 4. A PARTIAL TYPE. The engine forms the merged type by GROUPING, so every
  //    part needs a group key — and it must be non-empty even for the 76.5% of
  //    identities that have exactly one part in source.
  for (const row of types.rows) {
    if (row[idx(types, 'declarationGroupKey')] === '') {
      failures += fail('a type has no declarationGroupKey, so it cannot be merged or grouped');
      break;
    }
  }

  // 5. AN ACCESSOR. It is a call target, so it needs a declared callable row
  //    AND a resolvable owner — otherwise it is a method belonging to nothing.
  const properties = get('all-csharp-properties.csv');
  const events = get('all-csharp-events.csv');
  const owners = new Set([
    ...(properties?.rows.map((r) => pkOf(properties, r)) ?? []),
    ...(events?.rows.map((r) => pkOf(events, r)) ?? []),
  ]);
  for (const row of methods.rows) {
    if (row[idx(methods, 'isAccessor')] !== 'true') {
      continue;
    }
    if (!owners.has(row[idx(methods, 'ownerMemberLinkHash')]!)) {
      failures += fail('an accessor does not resolve to its owning property or event');
      break;
    }
  }

  // 6. THE HOPS THE PARSER DELIBERATELY DOES NOT TAKE must still be present as
  //    NAMES. A type reference resolves to nothing here by design, so the name
  //    AS WRITTEN is the whole hand-off and an empty one is a dead end.
  const typeReferences = get('all-csharp-type-references.csv');
  if (typeReferences !== undefined) {
    const nameless = typeReferences.rows.filter(
      (r) => r[idx(typeReferences, 'typeName')] === ''
    );
    if (nameless.length > 0) {
      failures += fail(
        `${nameless.length} type references carry no name. The parser resolves nothing ` +
          'here BY DESIGN, so the name as written is the entire hand-off.'
      );
    }
  }

  return failures;
}

/**
 * Blocks and locals — scope, and the five declaration kinds that are not
 * statements.
 *
 * Every assertion is scoped to `Blocks.cs`, by module hash. A corpus-wide count
 * is a hostage of the next fixture: the compound-assignment count in
 * `expressionSpine` was written that way and a `+=` added to an unrelated file
 * failed it, which points the reader at the parser for a change in the test
 * data.
 */
function blocksAndVariables(outputDir: string): number {
  let failures = 0;
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const blocks = relations.get('all-csharp-blocks.csv');
  const variables = relations.get('all-csharp-variables.csv');
  const expressions = relations.get('all-csharp-expressions.csv');
  const methods = relations.get('all-csharp-methods.csv');
  const modules = relations.get('all-csharp-modules.csv');
  const typeReferences = relations.get('all-csharp-type-references.csv');
  if (blocks === undefined || blocks.header.length === 0) {
    return fail('all-csharp-blocks.csv is missing or empty');
  }
  if (variables === undefined || variables.header.length === 0) {
    return fail('all-csharp-variables.csv is missing or empty');
  }
  if (
    expressions === undefined ||
    methods === undefined ||
    modules === undefined ||
    typeReferences === undefined
  ) {
    return fail('a relation this check joins against is missing');
  }

  const b = (n: string): number => blocks.header.indexOf(n);
  const v = (n: string): number => variables.header.indexOf(n);
  const mo = (n: string): number => modules.header.indexOf(n);
  const me = (n: string): number => methods.header.indexOf(n);
  const bPk = blocks.header.length - 1;
  const vPk = variables.header.length - 1;

  const module = modules.rows.find((r) => (r[mo('fileName')] ?? '').endsWith('Blocks.cs'));
  if (module === undefined) {
    return fail('Blocks.cs produced no cs_module row, so this whole check sees nothing');
  }
  const moduleHash = module[modules.header.length - 1]!;
  const scopedBlocks = blocks.rows.filter((r) => r[b('csModuleLinkHash')] === moduleHash);
  const scopedVariables = variables.rows.filter(
    (r) => r[v('csModuleLinkHash')] === moduleHash
  );

  // NEGATIVE CONTROL. Everything below filters on the module, so an empty
  // selection reads exactly like a clean pass — the vacuous-gate shape this
  // repository has already paid for once.
  if (scopedBlocks.length === 0 || scopedVariables.length === 0) {
    return fail(
      'NEGATIVE CONTROL FAILED: Blocks.cs produced no block or no variable rows. Every ' +
        'assertion below would then pass by having nothing to check.'
    );
  }

  const blockByHash = new Map(scopedBlocks.map((r) => [r[bPk]!, r]));
  const kindsOf = (kind: string): (readonly string[])[] =>
    scopedBlocks.filter((r) => r[b('blockKind')] === kind);
  const named = (name: string): (readonly string[])[] =>
    scopedVariables.filter((r) => r[v('name')] === name);

  // OWNER TYPE BY NAME — register 13. `csTypeLinkHash` on a block, a local
  // and an expression is the type whose member contains it. `Later` is the
  // SECOND type in Blocks.cs: its local `inLater`, the WHILE block around the
  // increment, and the `inLater < 3` condition must all name Later, not
  // Blocks. Before this every one of these columns was read only to resolve.
  {
    const typeRows = relations.get('all-csharp-types.csv');
    const typeNameByHash = new Map(
      (typeRows?.rows ?? []).map((r) => [r[typeRows!.header.length - 1]!, r[typeRows!.header.indexOf('name')]!])
    );
    const ex = (n: string): number => expressions.header.indexOf(n);
    const inLater = named('inLater');
    const laterWhile = scopedBlocks.filter(
      (r) => r[b('blockKind')] === 'WHILE' && inLater.length === 1 && r[b('csMethodLinkHash')] === inLater[0]![v('csMethodLinkHash')]
    );
    const laterCondition = expressions.rows.filter(
      (r) =>
        inLater.length === 1 &&
        r[ex('expressionOwnerHash')] === inLater[0]![v('csMethodLinkHash')] &&
        r[ex('rootContext')] === 'CONDITION' &&
        r[ex('kind')] === 'BINARY' &&
        r[ex('operatorString')] === '<'
    );
    for (const [what, rows, column] of [
      ['the local inLater', inLater, v('csTypeLinkHash')],
      ['the WHILE block in Later.Run', laterWhile, b('csTypeLinkHash')],
      ['the condition inLater < 3', laterCondition, ex('csTypeLinkHash')],
    ] as const) {
      if (rows.length !== 1) {
        failures += fail(`${rows.length} row(s) for ${what}, expected exactly 1`);
        continue;
      }
      const owner = typeNameByHash.get(rows[0]![column]!);
      if (owner !== 'Later') {
        failures += fail(`${what} is filed under ${owner === undefined ? 'no type row' : `the type ${owner}`} — expected Later, the type that contains it`);
      }
    }
    // And the block's METHOD owner — register 15 — names `Run` by name, and
    // agrees with csMethodLinkHash; it was an INTEGRITY read.
    if (laterWhile.length === 1) {
      const ownerMethod = methods.rows.find((r) => r[methods.header.length - 1] === laterWhile[0]![b('methodOwnerHash')]);
      if (ownerMethod?.[me('name')] !== 'Run' || laterWhile[0]![b('methodOwnerHash')] !== laterWhile[0]![b('csMethodLinkHash')]) {
        failures += fail(
          `the WHILE block in Later.Run has methodOwnerHash naming ${ownerMethod === undefined ? 'no method row' : ownerMethod[me('name')]} — expected Run, the same row as csMethodLinkHash`
        );
      }
    }
  }
  const one = (name: string): readonly string[] | undefined => {
    const rows = named(name);
    if (rows.length !== 1) {
      // DUPLICATES DOUBLE, THEY DO NOT COLLIDE. Two rows here means the
      // construct was visited on two paths, and every count downstream is
      // inflated rather than wrong in a way anything would notice.
      failures += fail(`local "${name}" produced ${rows.length} rows, expected exactly 1`);
      return undefined;
    }
    return rows[0];
  };

  // ---- THE FIVE DECLARATION KINDS THAT ARE NOT STATEMENTS -----------------

  // `out var parsed` is declared inside an ARGUMENT LIST. An engine modelling
  // only return values loses this dataflow entirely, and `TryParse` is in every
  // C# codebase written.
  const parsed = one('parsed');
  if (parsed !== undefined) {
    if (parsed[v('declarationKind')] !== 'OUT_VAR') {
      failures += fail(
        `\`out var parsed\` has declarationKind ${parsed[v('declarationKind')]}. It is a ` +
          'SECOND RETURN CHANNEL, and no statement declares it.'
      );
    }
    if (parsed[v('scopeKind')] !== 'EXPRESSION') {
      failures += fail('`out var parsed` must scope to EXPRESSION — it leaks into the caller');
    }
  }

  // `boxed is string label` — the binding site is a pattern.
  const label = one('label');
  if (label !== undefined && label[v('declarationKind')] !== 'PATTERN') {
    failures += fail('`is string label` did not produce a PATTERN local');
  }

  // `var (left, right) = Pair()` — ONE node, TWO bindings, separated only by
  // `deconstructionIndex`. If that column were dropped the two would share a
  // key and one would be lost.
  const left = one('left');
  const right = one('right');
  if (left !== undefined && right !== undefined) {
    if (left[v('deconstructionIndex')] !== '0' || right[v('deconstructionIndex')] !== '1') {
      failures += fail(
        `deconstruction indices are ${left[v('deconstructionIndex')]} and ` +
          `${right[v('deconstructionIndex')]}, expected 0 and 1`
      );
    }
    if (left[vPk] === right[vPk]) {
      failures += fail('the two halves of a deconstruction share a primary key');
    }
    if (left[v('declarationKind')] !== 'DECONSTRUCTION') {
      failures += fail('a deconstructed local is not DECONSTRUCTION');
    }
  }

  // The tuple-of-declaration-expressions spelling. `((var tupleA, var _),
  // var tupleC) = …` binds tupleA=0 and tupleC=1 — the discard takes no
  // index — and `foreach ((var k, var v) in …)` binds k=0, v=1. All four are
  // DECONSTRUCTION: the node is the one `out var` uses, and reading it as
  // `out var` everywhere filed them OUT_VAR with index 0.
  for (const [name, expectedIndex] of [
    ['tupleA', '0'],
    ['tupleC', '1'],
    ['eachKey', '0'],
    ['eachValue', '1'],
  ] as const) {
    const row = one(name);
    if (row === undefined) {
      continue;
    }
    if (row[v('declarationKind')] !== 'DECONSTRUCTION' || row[v('deconstructionIndex')] !== expectedIndex) {
      failures += fail(
        `${name} is ${row[v('declarationKind')]} at deconstruction index ` +
          `${row[v('deconstructionIndex')]}, expected DECONSTRUCTION at ${expectedIndex} — a ` +
          'declaration_expression inside a tuple is a deconstruction, not an out var'
      );
    }
  }

  // NO cs_variable ROW HAS AN EMPTY NAME — ruling v1.6 §4.0.4 consequence 2.
  // variable_declarator has two tree shapes: for `var (a, b) = e` the
  // tuple_pattern REPLACES the name, so `childForFieldName('name')` is null,
  // and a row built from the name field alone is a nameless local with a
  // deconstruction index that never fires. Asserted corpus-wide.
  const nameless = variables.rows.filter((r) => r[v('name')] === '');
  if (nameless.length !== 0) {
    failures += fail(
      `${nameless.length} cs_variable row(s) have an empty name. A binding without a name ` +
        'is a join target that resolves to nothing; branch on the tuple_pattern child, not ' +
        'the name field.'
    );
  }

  // A DISCARD BINDS NOTHING. `o is Exception _` has no `name` field at all and
  // the designation is a `discard` node — read positionally, the second child
  // is that discard and the parser invents a local called `_`.
  if (named('_').length !== 0) {
    failures += fail(
      'a discard designation produced a local named "_". It binds nothing, and a name ' +
        'that is not a binding is a join target that resolves to noise.'
    );
  }

  // `var ((inner, deeper), outerMost)` — nesting is FLATTENED in source order,
  // 0/1/2. Letting the outer walk reach the inner pattern restarts the index at
  // zero, and `deconstructionIndex` is the only key component separating these.
  const nested = ['inner', 'deeper', 'outerMost'].map((n) => named(n));
  if (nested.some((rows) => rows.length !== 1)) {
    failures += fail(
      `a nested deconstruction produced ${nested.map((r) => r.length).join('/')} rows for ` +
        'its three bindings. Reached twice, every binding it holds DOUBLES.'
    );
  } else {
    const indices = nested.map((rows) => rows[0]![v('deconstructionIndex')]).join(',');
    if (indices !== '0,1,2') {
      failures += fail(
        `a nested deconstruction indexed its bindings ${indices}, expected 0,1,2 in ` +
          'source order'
      );
    }
  }

  // `catch (InvalidOperationException e)` and `using (var reader = …)` have no
  // `local_declaration_statement` above them either.
  const caught = one('e');
  if (caught !== undefined) {
    if (caught[v('declarationKind')] !== 'CATCH') {
      failures += fail('the catch variable is not CATCH');
    }
    if (caught[v('completeTypeName')] !== 'InvalidOperationException') {
      failures += fail(
        `the catch variable's type is ${JSON.stringify(caught[v('completeTypeName')])}`
      );
    }
  }
  for (const [name, kind] of [
    ['reader', 'USING'],
    ['disposable', 'USING'],
    ['pinned', 'FIXED'],
  ] as const) {
    const row = one(name);
    if (row !== undefined && row[v('declarationKind')] !== kind) {
      failures += fail(
        `local "${name}" has declarationKind ${row[v('declarationKind')]}, expected ${kind}. ` +
          'Its `variable_declaration` hangs off the statement directly, with no ' +
          '`local_declaration_statement` in between.'
      );
    }
  }

  // ---- REF IS DATAFLOW, NOT SPELLING --------------------------------------

  const alias = one('alias');
  if (alias !== undefined) {
    if (alias[v('refKind')] !== 'REF') {
      failures += fail(
        '`ref int alias = ref data[0]` is not marked REF. It is an ALIAS: a write ' +
          'through it writes into the array, and a model treating it as a copy loses ' +
          'the write.'
      );
    }
    if (alias[v('completeTypeName')] !== 'int') {
      failures += fail(
        `the ref local's type is ${JSON.stringify(alias[v('completeTypeName')])}. ` +
          '`ref` is STRUCTURE and belongs in a column — folded into the name it joins ' +
          'against nothing.'
      );
    }
  }
  const frozen = one('frozen');
  if (frozen !== undefined && frozen[v('refKind')] !== 'REF_READONLY') {
    failures += fail('`ref readonly` collapsed to REF, losing that it cannot be written');
  }
  const window = one('window');
  if (window !== undefined) {
    if (window[v('isScoped')] !== 'true') {
      failures += fail('`scoped Span<int>` lost its lifetime constraint');
    }
    if (window[v('completeTypeName')] !== 'Span<int>') {
      failures += fail(
        `the scoped local's type is ${JSON.stringify(window[v('completeTypeName')])}`
      );
    }
  }
  const limit = one('limit');
  if (limit !== undefined && limit[v('isConst')] !== 'true') {
    failures += fail('`const int limit` is not marked const');
  }

  // Two declarators on one statement are separated by `declarationIndex`.
  const plain = one('plain');
  const second = one('second');
  if (plain !== undefined && second !== undefined) {
    if (plain[v('declarationIndex')] !== '0' || second[v('declarationIndex')] !== '1') {
      failures += fail('`int plain = 0, second = 1;` did not index its two declarators');
    }
  }

  // ---- var NAMES NO TYPE --------------------------------------------------

  // `var` IS NOT A TYPE NAME, and 96.7% of linq-heavy-A's locals are `var` — so
  // writing it into the type columns puts a pseudo-type on the common path of
  // every join keyed on a type name.
  for (const row of scopedVariables) {
    if (row[v('completeTypeName')] === 'var' || row[v('variableTypeName')] === 'var') {
      failures += fail(
        `local "${row[v('name')]}" carries "var" as its type name. isImplicitlyTyped is ` +
          'the column that says the parser does not know; the name stays absent.'
      );
      break;
    }
    if (row[v('isImplicitlyTyped')] === 'true' && row[v('typeReferenceLinkHash')] !== '') {
      failures += fail(`implicitly typed local "${row[v('name')]}" emitted a type reference`);
      break;
    }
  }

  const item = one('item');
  if (item !== undefined && item[v('isImplicitlyTyped')] !== 'true') {
    failures += fail(
      '`foreach (var item in xs)` is not implicitly typed. What `var` stands for is a ' +
        'RESOLUTION outcome and the engine`s, so the parser must say it does not know.'
    );
  }
  if (plain !== undefined && plain[v('isImplicitlyTyped')] === 'true') {
    failures += fail('`int plain` is explicitly typed and was reported as `var`');
  }

  // ---- SCOPE IS THE POINT OF THE RELATION ---------------------------------

  // A local in the method body is not in the same scope as one in a nested
  // block, and if both read BLOCK the distinction the column exists for is gone.
  const scopeOf = (name: string): string => named(name)[0]?.[v('scopeKind')] ?? '';
  for (const [name, expected] of [
    ['plain', 'METHOD_BODY'],
    ['nestedOnly', 'BLOCK'],
    ['item', 'LOOP_HEADER'],
    ['e', 'CATCH_CLAUSE'],
    ['reader', 'USING_STATEMENT'],
    ['inCase', 'SWITCH_SECTION'],
    ['inLambda', 'LAMBDA_BODY'],
  ] as const) {
    if (scopeOf(name) !== expected) {
      failures += fail(
        `local "${name}" has scopeKind ${scopeOf(name) || '<missing>'}, expected ${expected}`
      );
    }
  }

  // TWO COLUMNS, ONE FACT — so they must AGREE. A local's `scopeDepth` and the
  // `nestingDepth` of the block it lives in record the same nesting, and a pair
  // that can disagree is a pair a consumer resolves by reading whichever it saw
  // first.
  for (const row of scopedVariables) {
    const scope = row[v('csBlockLinkHash')]!;
    if (scope === '') {
      continue;
    }
    const block = blockByHash.get(scope);
    if (block === undefined) {
      continue;
    }
    if (Number(row[v('scopeDepth')]) !== Number(block[b('nestingDepth')]) + 1) {
      failures += fail(
        `local "${row[v('name')]}" reports scopeDepth ${row[v('scopeDepth')]} inside a ` +
          `block at nestingDepth ${block[b('nestingDepth')]} — the two disagree`
      );
      break;
    }
  }
  // And the depths must actually VARY, or agreement is trivially satisfied by
  // both being zero.
  if (new Set(scopedVariables.map((r) => r[v('scopeDepth')])).size < 3) {
    failures += fail(
      'every local in Blocks.cs reports the same scopeDepth. A file with a nested block, ' +
        'a loop body and a catch clause has locals at several depths, so the column is ' +
        'not being computed.'
    );
  }

  // `unsafe { }` is a REGION, not a modifier here: pointer dereferences are
  // legal inside it and nowhere else, and a consumer deciding whether a
  // dereference is reachable reads this column.
  const unsafeBlocks = scopedBlocks.filter((r) => r[b('isUnsafe')] === 'true');
  if (unsafeBlocks.length !== 1 || unsafeBlocks[0]![b('blockKind')] !== 'UNSAFE') {
    failures += fail(
      `${unsafeBlocks.length} blocks are marked unsafe, expected exactly the one UNSAFE ` +
        'block. isUnsafe and blockKind record one fact twice and must agree.'
    );
  }
  if (kindsOf('UNSAFE').length !== 1) {
    failures += fail('the `unsafe { }` region produced no UNSAFE block');
  }
  if (kindsOf('FIXED').length !== 1) {
    failures += fail('`fixed (int* p = data)` produced no FIXED block');
  }

  // Every local names the block it lives in, and that block exists. A local
  // with a dangling scope is a local an engine cannot shadow-resolve.
  for (const row of scopedVariables) {
    const scope = row[v('csBlockLinkHash')]!;
    if (scope === '') {
      continue;
    }
    if (!blockByHash.has(scope)) {
      failures += fail(`local "${row[v('name')]}" points at a block that is not in its file`);
      break;
    }
  }

  // ---- THE BLOCK TREE -----------------------------------------------------

  for (const row of scopedBlocks) {
    const parent = row[b('parentContainerHash')]!;
    if (parent === '') {
      if (row[b('nestingDepth')] !== '0') {
        failures += fail(
          `a block with no parent has nestingDepth ${row[b('nestingDepth')]}`
        );
        break;
      }
      continue;
    }
    const parentRow = blockByHash.get(parent);
    if (parentRow === undefined) {
      failures += fail('a block names a parent container that does not exist');
      break;
    }
    if (Number(row[b('nestingDepth')]) !== Number(parentRow[b('nestingDepth')]) + 1) {
      failures += fail('a block is not one deeper than the block containing it');
      break;
    }
  }

  // `if (a) { } else { }` — the branches are DIFFERENT SCOPES and the grammar
  // has no `else_clause`, so an extractor reading child positions emits one
  // block for both. Exactly one ELSE, and it is not the consequence.
  const elses = kindsOf('ELSE');
  if (elses.length !== 1) {
    failures += fail(`expected 1 ELSE block in Blocks.cs, found ${elses.length}`);
  }
  // Five `if`s: the else-if pair, the one inside the labelled loop, and the
  // three that test a declaration — `if (int.TryParse(…, out var n))`,
  // `if (boxed is string label)` and `if (boxed is Exception _)`. The last three
  // are the ones a statement-only walk misses, and counting them is what makes
  // a change to the descent visible.
  const ifs = kindsOf('IF');
  if (ifs.length !== 5) {
    failures += fail(`expected 5 IF blocks in Blocks.cs, found ${ifs.length}`);
  }

  // A `catch` says what it stops and which `try` it guards. Without the second,
  // two adjacent try statements' catches are indistinguishable.
  const catches = kindsOf('CATCH');
  if (catches.length !== 2) {
    failures += fail(`expected 2 CATCH blocks, found ${catches.length}`);
  }
  for (const row of catches) {
    const guarded = blockByHash.get(row[b('tryStatementHash')]!);
    if (guarded === undefined || guarded[b('blockKind')] !== 'TRY') {
      failures += fail('a CATCH block does not name the TRY it guards');
      break;
    }
  }
  if (!catches.some((r) => r[b('catchTypeNames')] === 'InvalidOperationException')) {
    failures += fail(
      'no CATCH block records `InvalidOperationException`. What a catch stops is an ' +
        'exception EDGE, and the name as written is the whole hand-off.'
    );
  }
  // `catch (Exception)` binds NO variable and still names what it stops. A
  // reader keyed on the declaration's name field records nothing here, and the
  // exception edge disappears with it.
  if (!catches.some((r) => r[b('catchTypeNames')] === 'Exception')) {
    failures += fail(
      '`catch (Exception)` — no variable, still a caught type — recorded no type name'
    );
  }
  if (named('e').length !== 1) {
    failures += fail('the nameless catch invented a variable, or the named one lost its');
  }

  // `outer:` is a GOTO TARGET. TypeScript emitted the loop and dropped the
  // label, and nothing counted it because the loop was still there.
  const labelled = kindsOf('LABELED');
  if (labelled.length !== 1 || labelled[0]![b('labelName')] !== 'outer') {
    failures += fail(
      'the labelled statement lost its label, so `goto outer` has no target to name'
    );
  }

  // `checked` and `unchecked` are ONE node type in the grammar and only the
  // keyword tells them apart.
  const checkedBlocks = kindsOf('CHECKED');
  const uncheckedBlocks = kindsOf('UNCHECKED');
  if (checkedBlocks.length !== 1 || uncheckedBlocks.length !== 1) {
    failures += fail(
      `checked/unchecked came out as ${checkedBlocks.length}/${uncheckedBlocks.length}. ` +
        'One grammar node spells both, so a map keyed on the node type reports them as ' +
        'the same block.'
    );
  }
  if (checkedBlocks.length === 1 && checkedBlocks[0]![b('isChecked')] !== 'true') {
    failures += fail('a CHECKED block is not marked checked');
  }
  if (uncheckedBlocks.length === 1 && uncheckedBlocks[0]![b('isChecked')] === 'true') {
    failures += fail('an UNCHECKED block is marked checked — the two columns disagree');
  }

  // `using (var reader = …)` holds one resource.
  const usings = kindsOf('USING');
  if (usings.length !== 1 || usings[0]![b('resourceCount')] !== '1') {
    failures += fail(
      `the using block reports ${usings[0]?.[b('resourceCount')] ?? '<none>'} resources`
    );
  }

  // Order is a WALK ORDINAL and part of the key. Two blocks of one method
  // sharing one would collide, and duplicates DOUBLE.
  const seen = new Set<string>();
  for (const row of scopedBlocks) {
    const key = `${row[b('csMethodLinkHash')]}|${row[b('order')]}`;
    if (seen.has(key)) {
      failures += fail('two blocks of one method share a walk ordinal');
      break;
    }
    seen.add(key);
  }

  // ---- A CALLBACK'S SCOPE BELONGS TO THE CALLBACK -------------------------

  // §6 for blocks: a lambda's body is walked with the LAMBDA as owner. Attached
  // to the enclosing method it would put a callback's locals in the scope of
  // whoever created it.
  const methodByHash = new Map(methods.rows.map((r) => [r[methods.header.length - 1]!, r]));
  const ownerKindOf = (row: readonly string[]): string =>
    methodByHash.get(row[v('csMethodLinkHash')]!)?.[me('methodKind')] ?? '<missing>';
  if (named('inLambda').length === 1 && ownerKindOf(named('inLambda')[0]!) !== 'LAMBDA') {
    failures += fail(
      `a local inside a lambda belongs to a ${ownerKindOf(named('inLambda')[0]!)}. Its ` +
        'scope is the lambda`s, not the creating method`s.'
    );
  }
  if (
    named('inLocal').length === 1 &&
    ownerKindOf(named('inLocal')[0]!) !== 'LOCAL_FUNCTION'
  ) {
    failures += fail(
      'a local inside a local function does not belong to the local function. Its body ' +
        'was not walked at all until this was measured.'
    );
  }
  if (named('inAccessor').length === 1) {
    const owner = methodByHash.get(named('inAccessor')[0]![v('csMethodLinkHash')]!);
    if (owner === undefined || owner[me('isAccessor')] !== 'true') {
      failures += fail('a local inside a property getter does not belong to the accessor');
    }
  }
  if (kindsOf('ACCESSOR_BODY').length === 0) {
    failures += fail(
      'no ACCESSOR_BODY block. Accessors are 68% of cs_method, and a body relation that ' +
        'skips them is missing two thirds of the code.'
    );
  }
  if (kindsOf('CONSTRUCTOR_BODY').length !== 1) {
    failures += fail('the constructor body did not produce a CONSTRUCTOR_BODY block');
  }
  if (kindsOf('LOCAL_FUNCTION_BODY').length !== 1) {
    failures += fail('the local function body did not produce a LOCAL_FUNCTION_BODY block');
  }

  // ---- THE LINKS INTO THE EXPRESSION LAYER --------------------------------

  const expressionPks = new Set(
    expressions.rows.map((r) => r[expressions.header.length - 1]!)
  );
  const withInitializer = scopedVariables.filter((r) => r[v('hasInitializer')] === 'true');
  if (withInitializer.length === 0) {
    failures += fail('NEGATIVE CONTROL FAILED: no local in Blocks.cs has an initializer');
  }
  const linkedInitializers = withInitializer.filter(
    (r) => r[v('initializerExpressionLinkHash')] !== ''
  );
  if (linkedInitializers.length === 0) {
    failures += fail(
      'no local names the expression that initialises it. Without that hop the value ' +
        'flowing into a local is unreconstructable, which is the dataflow the relation ' +
        'exists to carry.'
    );
  }
  const expressionByPk = new Map(
    expressions.rows.map((r) => [r[expressions.header.length - 1]!, r])
  );
  for (const row of linkedInitializers) {
    if (!expressionByPk.has(row[v('initializerExpressionLinkHash')]!)) {
      failures += fail('a local initializer link resolves to no expression row');
      break;
    }
  }

  // TWO ON ONE LINE. `int plain = 0, second = 1;` gives two locals one line and
  // two different initializers, and a side table keyed on the line rather than
  // the node maps both to whichever was written first. Resolving is not enough
  // — the link has to be the RIGHT expression, and that only shows here.
  const ex = (n: string): number => expressions.header.indexOf(n);
  const initializerTextOf = (name: string): string => {
    const row = named(name)[0];
    if (row === undefined) {
      return '<no such local>';
    }
    const target = expressionByPk.get(row[v('initializerExpressionLinkHash')]!);
    if (target === undefined) {
      return '<unlinked>';
    }
    return `${target[ex('literalValue')]}@${target[ex('startColumn')]}`;
  };
  if (initializerTextOf('plain') === initializerTextOf('second')) {
    failures += fail(
      `two locals declared on one line share an initializer expression ` +
        `(${initializerTextOf('plain')}). Their VALUES are different and a consumer ` +
        'joining on the link now reads one for the other.'
    );
  }
  const conditioned = scopedBlocks.filter((r) => r[b('conditionExpressionLinkHash')] !== '');
  if (conditioned.length === 0) {
    failures += fail('no block names the expression it tests');
  }
  for (const row of conditioned) {
    if (!expressionPks.has(row[b('conditionExpressionLinkHash')]!)) {
      failures += fail('a block condition link resolves to no expression row');
      break;
    }
  }
  // AND IT IS THE CONDITION: a root in CONDITION context, not merely an
  // expression that exists. Second on the link-column risk register.
  const expressionRowByPk = new Map(expressions.rows.map((r) => [r[expressions.header.length - 1]!, r]));
  for (const row of conditioned) {
    const target = expressionRowByPk.get(row[b('conditionExpressionLinkHash')]!);
    if (target === undefined) {
      continue;
    }
    // A block's header expression is a ROOT in the context its statement
    // gives: CONDITION for if/while/do, LOOP_HEADER for for/foreach (the
    // collection), SWITCH_SUBJECT, LOCK_SUBJECT, USING_RESOURCE. Never a
    // nested expression, and never a root from the block's body.
    const headerContexts = new Set(['CONDITION', 'LOOP_HEADER', 'SWITCH_SUBJECT', 'LOCK_SUBJECT', 'USING_RESOURCE']);
    if (!headerContexts.has(target[ex('rootContext')]!) || target[ex('parentExpressionHash')] !== '') {
      failures += fail(
        `a ${row[b('blockKind')]} block's condition link names a ${target[ex('kind')]} in ` +
          `${target[ex('rootContext')]} context (depth ${target[ex('depth')]}) — an expression, not the block's header`
      );
      break;
    }
    // A `do { } while (c)` tests its condition AFTER its body, so its header
    // sits below the block; every other block's header precedes it.
    if (row[b('blockKind')] !== 'DO' && Number(target[ex('startLine')]) > Number(row[b('startLine')])) {
      failures += fail(
        `a ${row[b('blockKind')]} block's condition link names a row at line ${target[ex('startLine')]}, ` +
          `below the block's own start at ${row[b('startLine')]} — a body expression, not the header`
      );
      break;
    }
  }

  // A local's DECLARED TYPE is a reference, and a reified one — `List<int>` and
  // `List<string>` are distinct runtime types, so the argument is kept.
  const referencePks = new Set(
    typeReferences.rows.map((r) => r[typeReferences.header.length - 1]!)
  );
  const typed = scopedVariables.filter((r) => r[v('typeReferenceLinkHash')] !== '');
  if (typed.length === 0) {
    failures += fail('no local carries a type reference, so its declared type joins nothing');
  }
  for (const row of typed) {
    if (!referencePks.has(row[v('typeReferenceLinkHash')]!)) {
      failures += fail('a local type reference link resolves to no row');
      break;
    }
  }
  const tr = (n: string): number => typeReferences.header.indexOf(n);
  const spanReference = typeReferences.rows.find(
    (r) =>
      r[tr('context')] === 'LOCAL_VARIABLE' &&
      r[tr('typeName')] === 'Span' &&
      r[tr('referenceOwnerKind')] === 'VARIABLE'
  );
  if (spanReference === undefined) {
    failures += fail(
      '`scoped Span<int> window` produced no LOCAL_VARIABLE type reference owned by the ' +
        'variable'
    );
  } else {
    const argument = typeReferences.rows.find(
      (r) => r[tr('parentReferenceHash')] === spanReference[typeReferences.header.length - 1]
    );
    if (argument === undefined || argument[tr('typeName')] !== 'int') {
      failures += fail(
        '`Span<int>` lost its type argument. C# generics are REIFIED — `Span<int>` and ' +
          '`Span<byte>` are different runtime types, and the erasure Java can afford is ' +
          'wrong here.'
      );
    }
  }

  return failures;
}

/**
 * Attributes and comments — the metadata that names things nothing else names.
 *
 * ## Why an attribute is worth a relation at all
 *
 * A C# attribute is INERT: unlike a TypeScript decorator it does not run, has
 * no order, and replaces nothing. What makes it worth recording is the payload.
 * `[JsonConverter(typeof(MyConverter))]` names a type that a framework
 * instantiates from a stack that appears in no source file, and if the argument
 * is dropped that edge exists nowhere in the fact base.
 *
 * Scoped to `Metadata.cs` by module hash, for the reason two other checks in
 * this file had to be rescoped: a corpus-wide count is a hostage of the next
 * fixture, and the failure then names the parser for a change in the test data.
 */
function attributesAndComments(outputDir: string): number {
  let failures = 0;
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const attributes = relations.get('all-csharp-attributes.csv');
  const args = relations.get('all-csharp-attribute-arguments.csv');
  const comments = relations.get('all-csharp-comments.csv');
  const modules = relations.get('all-csharp-modules.csv');
  const methods = relations.get('all-csharp-methods.csv');
  const fields = relations.get('all-csharp-fields.csv');
  const typeReferences = relations.get('all-csharp-type-references.csv');
  if (attributes === undefined || attributes.header.length === 0) {
    return fail('all-csharp-attributes.csv is missing or empty');
  }
  if (args === undefined || args.header.length === 0) {
    return fail('all-csharp-attribute-arguments.csv is missing or empty');
  }
  if (comments === undefined || comments.header.length === 0) {
    return fail('all-csharp-comments.csv is missing or empty');
  }
  if (
    modules === undefined ||
    methods === undefined ||
    fields === undefined ||
    typeReferences === undefined
  ) {
    return fail('a relation this check joins against is missing');
  }

  const a = (n: string): number => attributes.header.indexOf(n);
  const g = (n: string): number => args.header.indexOf(n);
  const c = (n: string): number => comments.header.indexOf(n);
  const mo = (n: string): number => modules.header.indexOf(n);
  const aPk = attributes.header.length - 1;
  const gPk = args.header.length - 1;
  const cPk = comments.header.length - 1;

  const module = modules.rows.find((row) =>
    (row[mo('fileName')] ?? '').endsWith('Metadata.cs')
  );
  if (module === undefined) {
    return fail('Metadata.cs produced no cs_module row, so this whole check sees nothing');
  }
  const moduleHash = module[modules.header.length - 1]!;
  const scoped = attributes.rows.filter((r) => r[a('csModuleLinkHash')] === moduleHash);
  const scopedComments = comments.rows.filter(
    (r) => r[c('csModuleLinkHash')] === moduleHash
  );
  const scopedPks = new Set(scoped.map((r) => r[aPk]!));
  const scopedArgs = args.rows.filter((r) => scopedPks.has(r[g('parentAttributeHash')]!));

  // NEGATIVE CONTROL. Everything below filters on the module, so an empty
  // selection reads exactly like a clean pass — the vacuous-gate shape.
  if (scoped.length === 0 || scopedArgs.length === 0 || scopedComments.length === 0) {
    return fail(
      'NEGATIVE CONTROL FAILED: Metadata.cs produced no attribute, argument or comment ' +
        'rows. Every assertion below would then pass by having nothing to check.'
    );
  }

  const named = (name: string): (readonly string[])[] =>
    scoped.filter((r) => r[a('attributeName')] === name);

  // ---- `[A, B]` IS TWO ATTRIBUTES -----------------------------------------

  // One bracket group, two attributes. Counting GROUPS said one, and nothing
  // could see it until this relation existed to disagree.
  const obsoletes = named('Obsolete');
  const serializables = named('Serializable');
  if (obsoletes.length === 0 || serializables.length === 0) {
    failures += fail(
      '`[Obsolete("gone", true), Serializable]` did not produce both attributes. One ' +
        'bracket group is not one attribute.'
    );
  }
  // POSITION runs across all of the owner's lists; `attributeListIndex` keeps
  // the grouping separately. Folding them would give the first attribute of
  // every group position 0 — two rows, one key, and duplicates DOUBLE.
  const onDocumented = scoped.filter(
    (r) => r[a('ownerKind')] === 'TYPE' && r[a('attributeListIndex')] !== ''
  );
  const documentedOwner = obsoletes[0]?.[a('ownerHash')];
  const sameOwner = onDocumented.filter((r) => r[a('ownerHash')] === documentedOwner);
  if (new Set(sameOwner.map((r) => r[a('position')])).size !== sameOwner.length) {
    failures += fail(
      'two attributes on one declaration share a position. `[A][B]` and `[A, B]` are the ' +
        'same two attributes written two ways, and a per-list index gives both position 0.'
    );
  }
  if (new Set(sameOwner.map((r) => r[a('attributeListIndex')])).size < 2) {
    failures += fail(
      'the two bracket groups on one type report the same attributeListIndex, so the ' +
        'grouping is lost'
    );
  }
  if (new Set(scoped.map((r) => r[aPk])).size !== scoped.length) {
    failures += fail('two attributes share a primary key');
  }

  // The count on the declaration row must AGREE with the number of rows here.
  // Two columns recording one fact, and a pair that can disagree is a pair a
  // consumer resolves by reading whichever it saw first.
  const me = (n: string): number => methods.header.indexOf(n);
  const act = methods.rows.find(
    (r) => r[me('name')] === 'Act' && r[me('csModuleLinkHash')] === moduleHash
  );
  if (act !== undefined) {
    const onAct = scoped.filter(
      (r) => r[a('ownerHash')] === act[methods.header.length - 1]
    );
    if (Number(act[me('attributeCount')]) !== onAct.length) {
      failures += fail(
        `Act reports attributeCount ${act[me('attributeCount')]} and has ${onAct.length} ` +
          'cs_attribute rows. The count was of BRACKET GROUPS before this relation existed.'
      );
    }
  }

  // ---- THE TARGET IS WHAT IT ATTACHES TO ----------------------------------

  const targets = new Set(scoped.map((r) => r[a('attributeTarget')]));
  // TYPEVAR is absent from this list deliberately. `[typevar: X]` needs
  // `typevar` treated as a contextual keyword, which the published grammar does
  // not do — it reads the word as a type and the attribute list becomes an
  // ERROR. A limitation with a torture fixture, not a target we can assert.
  for (const target of ['NONE', 'ASSEMBLY', 'MODULE', 'RETURN', 'FIELD', 'PROPERTY']) {
    if (!targets.has(target)) {
      failures += fail(
        `no attribute in Metadata.cs carries the ${target} target. A target changes WHAT ` +
          'the attribute attaches to, not where it is written.'
      );
    }
  }
  // `[assembly: …]` has NO owner declaration. The file is the only thing in the
  // fact base that can hold it, and dropping it loses an attribute that can
  // grant another assembly access to every internal type in this one.
  const assemblyLevel = scoped.filter((r) => r[a('attributeTarget')] === 'ASSEMBLY');
  if (assemblyLevel.some((r) => r[a('ownerKind')] !== 'MODULE')) {
    failures += fail('an `[assembly: …]` attribute is owned by something other than the file');
  }
  if (assemblyLevel.some((r) => r[a('ownerHash')] !== moduleHash)) {
    failures += fail('an `[assembly: …]` attribute does not resolve to its file');
  }

  // Every owner resolves. An attribute owned by a hash that is in no relation
  // is metadata attached to nothing.
  const declaredPks = new Set<string>();
  for (const relation of readRelations(outputDir)) {
    if (relation.header.length === 0) {
      continue;
    }
    for (const row of relation.rows) {
      declaredPks.add(row[relation.header.length - 1]!);
    }
  }
  for (const row of scoped) {
    if (!declaredPks.has(row[a('ownerHash')]!)) {
      failures += fail(
        `attribute ${row[a('attributeName')]} is owned by a hash that resolves to no row`
      );
      break;
    }
  }
  const ownerKinds = new Set(scoped.map((r) => r[a('ownerKind')]));
  for (const kind of ['MODULE', 'TYPE', 'METHOD', 'METHOD_PARAMETER', 'PROPERTY', 'FIELD', 'EVENT', 'ENUM_MEMBER', 'TYPE_PARAMETER']) {
    if (!ownerKinds.has(kind)) {
      failures += fail(`nothing of kind ${kind} owns an attribute in Metadata.cs`);
    }
  }

  // `[Obsolete] int First, Second;` marks BOTH symbols. One declaration, one
  // attribute list, two field rows — and two attribute rows, because Roslyn
  // gives both symbols the attribute.
  const fi = (n: string): number => fields.header.indexOf(n);
  const twoFields = fields.rows.filter(
    (r) =>
      r[fi('csModuleLinkHash')] === moduleHash &&
      (r[fi('name')] === 'First' || r[fi('name')] === 'Second')
  );
  if (twoFields.length !== 2) {
    failures += fail(`\`[Obsolete] int First, Second;\` produced ${twoFields.length} fields`);
  } else {
    const marked = twoFields.filter((field) =>
      scoped.some((r) => r[a('ownerHash')] === field[fields.header.length - 1])
    );
    if (marked.length !== 2) {
      failures += fail(
        `${marked.length} of 2 fields declared on one line carry the attribute written ` +
          'above them. Roslyn marks both, and the attribute list hangs off the DECLARATION ' +
          'rather than the declarator.'
      );
    }
  }

  // ---- THE ARGUMENT THAT IS AN EDGE ---------------------------------------

  // `[X(1)]` and `[X(Name = 1)]` bind differently — by position and by name —
  // and resolve against different members of the attribute class.
  const namedArgs = scopedArgs.filter((r) => r[g('isNamedArgument')] === 'true');
  const positional = scopedArgs.filter((r) => r[g('isNamedArgument')] === 'false');
  if (namedArgs.length === 0 || positional.length === 0) {
    failures += fail(
      'the corpus has both `[X(1)]` and `[X(Name = 1)]` and the fact base does not ' +
        'distinguish them. A single argumentName column cannot say which.'
    );
  }
  if (namedArgs.some((r) => r[g('argumentName')] === '')) {
    failures += fail('a named argument has no name');
  }
  if (positional.some((r) => r[g('argumentName')] !== '')) {
    failures += fail('a positional argument was given a name it does not have');
  }
  if (new Set(scopedArgs.map((r) => r[gPk])).size !== scopedArgs.length) {
    failures += fail('two attribute arguments share a primary key');
  }
  // `hasNamedArguments` and the argument rows record one fact twice.
  for (const row of scoped) {
    const mine = scopedArgs.filter((r) => r[g('parentAttributeHash')] === row[aPk]);
    if (Number(row[a('argumentCount')]) !== mine.length) {
      failures += fail(
        `${row[a('attributeName')]} reports ${row[a('argumentCount')]} arguments and has ` +
          `${mine.length} rows`
      );
      break;
    }
    const anyNamed = mine.some((r) => r[g('isNamedArgument')] === 'true');
    if ((row[a('hasNamedArguments')] === 'true') !== anyNamed) {
      failures += fail(
        `${row[a('attributeName')]}.hasNamedArguments disagrees with its argument rows`
      );
      break;
    }
  }

  // `typeof(Documented<int>)` — THE edge. A framework instantiates that type
  // from a stack no source file contains, and this reference is the only record
  // of it. The type ARGUMENT must survive: C# generics are reified, and
  // `Documented<int>` is not `Documented<string>`.
  const typeofArgs = scopedArgs.filter((r) => r[g('valueKind')] === 'TYPEOF');
  if (typeofArgs.length === 0) {
    failures += fail('`typeof(...)` inside an attribute produced no TYPEOF argument');
  }
  const tr = (n: string): number => typeReferences.header.indexOf(n);
  const referenceByPk = new Map(
    typeReferences.rows.map((r) => [r[typeReferences.header.length - 1]!, r])
  );
  for (const row of typeofArgs) {
    const link = row[g('referencedTypeReferenceLinkHash')]!;
    if (link === '') {
      failures += fail(
        '`typeof(X)` in an attribute names a TYPE and emitted no type reference. That edge ' +
          'exists nowhere else in the fact base.'
      );
      break;
    }
    const reference = referenceByPk.get(link);
    if (reference === undefined) {
      failures += fail('a typeof argument links to a type reference that does not exist');
      break;
    }
    if (reference[tr('referenceOwnerKind')] !== 'ATTRIBUTE') {
      failures += fail(
        `a typeof argument's reference is owned by ${reference[tr('referenceOwnerKind')]}`
      );
      break;
    }
    const argument = typeReferences.rows.find(
      (r) => r[tr('parentReferenceHash')] === link
    );
    if (argument === undefined) {
      failures += fail(
        '`typeof(Documented<int>)` lost its type argument. C# generics are REIFIED and ' +
          '`Documented<int>` is a different runtime type from `Documented<string>`.'
      );
      break;
    }
    // AND IT IS THE TYPE WRITTEN: `typeof(Documented<int>)` links to a
    // reference named Documented with the argument int, not to the attribute's
    // own type or a neighbour's. Fourth on the link-column risk register.
    if (reference[tr('typeName')] !== 'Documented' || argument[tr('typeName')] !== 'int') {
      failures += fail(
        `\`typeof(Documented<int>)\` links to a reference named ${reference[tr('typeName')]}<${argument[tr('typeName')]}> ` +
          '— the wrong tree, which a resolving link cannot see'
      );
      break;
    }
  }

  // The attribute's OWN name is a type reference too — `[JsonConverter]` names
  // a class that is constructed at runtime.
  const attributeTypeReferences = typeReferences.rows.filter(
    (r) => r[tr('context')] === 'ATTRIBUTE_TYPE'
  );
  if (attributeTypeReferences.length === 0) {
    failures += fail('no attribute name produced a type reference, so it joins nothing');
  }
  // THE ENCLOSING TYPE, by name. `csTypeLinkHash` on an attribute row means
  // what it means on every other relation — the nearest type declaration
  // above the owner, the type itself for a type's own attributes — and the
  // extractor's comment said so while its code wrote '' for every member.
  // Register 12: a type-level, a member-level and a NESTED case, since the
  // enclosing type of a nested type's member is the neighbour a wrong link
  // would name.
  const typeRows = relations.get('all-csharp-types.csv');
  if (typeRows === undefined || typeRows.header.length === 0) {
    failures += fail('all-csharp-types.csv is missing or empty, so no attribute owner type can be read');
  } else {
    const typeNameByHash = new Map(typeRows.rows.map((r) => [r[typeRows.header.length - 1]!, r[typeRows.header.indexOf('name')]!]));
    // (attribute, owner kind, written target, enclosing type). The target
    // separates `[event: MyMarker]` on Raised in Generic from `[MyMarker]` on
    // Fired in Documented.
    const expectedTypes: ReadonlyArray<readonly [string, string, string, string]> = [
      ['Serializable', 'TYPE', 'NONE', 'Documented'],
      ['MyMarker', 'EVENT', 'EVENT', 'Generic'],
      ['Obsolete', 'ENUM_MEMBER', 'NONE', 'Inner'],
    ];
    for (const [attributeName, ownerKind, target, declaringType] of expectedTypes) {
      const rows = scoped.filter(
        (r) => r[a('attributeName')] === attributeName && r[a('ownerKind')] === ownerKind && r[a('attributeTarget')] === target
      );
      if (rows.length !== 1) {
        failures += fail(`${rows.length} ${attributeName} attribute(s) on a ${ownerKind} with target ${target} in Metadata.cs, expected exactly 1`);
        continue;
      }
      const linked = typeNameByHash.get(rows[0]![a('csTypeLinkHash')]!);
      if (linked !== declaringType) {
        failures += fail(
          `[${attributeName}] on a ${ownerKind} has csTypeLinkHash naming ${linked === undefined ? (rows[0]![a('csTypeLinkHash')] === '' ? 'nothing' : 'no type row') : `the type ${linked}`} ` +
            `— expected ${declaringType}, the enclosing type`
        );
      }
    }
  }

  // AN ARGUMENT'S EXPRESSION, by kind — register 17. `(byte)42` links to a
  // CAST row and `typeof(Documented<int>)` to a TYPEOF row; the column was an
  // INTEGRITY read, and the first expression in the file would have passed.
  {
    const expressionRows = relations.get('all-csharp-expressions.csv');
    if (expressionRows === undefined || expressionRows.header.length === 0) {
      failures += fail('all-csharp-expressions.csv is missing or empty, so no attribute argument expression can be read');
    } else {
      const kindByPk = new Map(expressionRows.rows.map((r) => [r[expressionRows.header.length - 1]!, r[expressionRows.header.indexOf('kind')]!]));
      // A cast is not a value kind of its own — it is EXPRESSION, the bucket
      // for anything syntax does not fold — so it is picked by its text.
      for (const [valueKind, argumentText, expressionKind] of [['EXPRESSION', '(byte)42', 'CAST'], ['TYPEOF', '', 'TYPEOF']] as const) {
        const rows = scopedArgs.filter(
          (r) => r[g('valueKind')] === valueKind && (argumentText === '' || r[g('argumentValue')] === argumentText)
        );
        if (rows.length === 0) {
          failures += fail(`no ${valueKind} attribute argument${argumentText === '' ? '' : ` ${argumentText}`} in Metadata.cs`);
          continue;
        }
        for (const row of rows) {
          const kind = kindByPk.get(row[g('csExpressionLinkHash')]!);
          if (kind !== expressionKind) {
            failures += fail(
              `a ${valueKind} attribute argument links to ${kind === undefined ? 'no expression row' : `a ${kind} expression`} — expected its own ${expressionKind} row`
            );
            break;
          }
        }
      }
    }
  }

  // AND THE TYPE IT NAMES IS ITS OWN. The link resolving was all that was
  // asserted; pointing every attribute at the first reference in the file
  // resolved too. Eighth-plus on the register: the linked row is in
  // ATTRIBUTE_TYPE context and spells the attribute's qualified name as
  // written — `System.ComponentModel.DefaultValue` is the whole dotted path,
  // since the using scope that shortens it is the engine's.
  for (const row of scoped) {
    const reference = referenceByPk.get(row[a('typeReferenceLinkHash')]!);
    if (reference === undefined) {
      failures += fail(`attribute ${row[a('attributeName')]} names no type`);
      break;
    }
    if (reference[tr('context')] !== 'ATTRIBUTE_TYPE' || reference[tr('typeName')] !== row[a('qualifiedName')]) {
      failures += fail(
        `attribute ${row[a('qualifiedName')]} links to a ${reference[tr('context')]} reference named ` +
          `${reference[tr('typeName')]} — expected its own name, in ATTRIBUTE_TYPE context`
      );
      break;
    }
  }
  // The SIMPLE name is normalised and the spelling is kept. Whether `[Obsolete]`
  // and `[ObsoleteAttribute]` are the same attribute depends on the using scope,
  // which is the engine's — so the suffix is NOT stripped here.
  const qualified = named('Description')[0] ?? named('AssemblyMetadata')[0];
  if (qualified !== undefined) {
    if (!qualified[a('qualifiedName')]!.includes('.')) {
      failures += fail(
        'a dotted attribute name lost its qualifier. The parser resolves nothing here BY ' +
          'DESIGN, so the name as written is the entire hand-off.'
      );
    }
    if (qualified[a('attributeName')]!.includes('.')) {
      failures += fail('attributeName is the SIMPLE name and this one is dotted');
    }
  }

  // ---- COMMENTS -----------------------------------------------------------

  // Ownership is positional: a doc comment before a class is a child of the
  // COMPILATION UNIT, not of the class, so the owner is the next declaration
  // that starts after the comment ends.
  const documented = scopedComments.filter((r) => r[c('isDocumentation')] === 'true');
  if (documented.length === 0) {
    failures += fail('no XML doc comment was recognised as documentation');
  }
  const kinds = new Set(scopedComments.map((r) => r[c('commentKind')]));
  for (const kind of ['LINE', 'BLOCK', 'XML_DOC_LINE', 'XML_DOC_BLOCK']) {
    if (!kinds.has(kind)) {
      failures += fail(`no ${kind} comment in Metadata.cs`);
    }
  }
  if (new Set(scopedComments.map((r) => r[cPk])).size !== scopedComments.length) {
    failures += fail('two comments share a primary key');
  }
  const indices = scopedComments.map((r) => Number(r[c('commentIndex')])).sort((x, y) => x - y);
  if (indices.some((value, i) => value !== i)) {
    failures += fail('comment indices are not 0..n-1 in source order');
  }
  for (const row of scopedComments) {
    if (!declaredPks.has(row[c('ownerHash')]!)) {
      failures += fail('a comment is owned by a hash that resolves to no row');
      break;
    }
  }
  // AND THE OWNER IS THE DECLARATION THE COMMENT PRECEDES, by name: the doc
  // comment that says "Does a thing" belongs to `Act`, and "A documented
  // type" to `Documented`. A resolving owner one declaration off would have
  // passed. Third on the link-column risk register.
  const methodNameByHash = new Map(methods.rows.map((r) => [r[methods.header.length - 1]!, r[methods.header.indexOf('name')]!]));
  const typeRelation = relations.get('all-csharp-types.csv');
  const typeNameByHash = new Map((typeRelation?.rows ?? []).map((r) => [r[typeRelation!.header.length - 1]!, r[typeRelation!.header.indexOf('name')]!]));
  const ownerNameOf = (commentText: string): string | undefined => {
    const row = scopedComments.find((r) => r[c('commentText')]!.includes(commentText));
    const owner = row?.[c('ownerHash')] ?? '';
    return methodNameByHash.get(owner) ?? typeNameByHash.get(owner);
  };
  for (const [text, expectedOwner] of [['Does a thing', 'Act'], ['A documented type', 'Documented']] as const) {
    const owner = ownerNameOf(text);
    if (owner !== expectedOwner) {
      failures += fail(
        `the comment "${text}" is owned by ${owner ?? 'nothing named'}, expected ${expectedOwner} — ` +
          'the declaration it precedes'
      );
    }
  }
  const commentOwnerKinds = new Set(scopedComments.map((r) => r[c('ownerKind')]));
  if (!commentOwnerKinds.has('TYPE') || !commentOwnerKinds.has('METHOD')) {
    failures += fail(
      `comments attached to ${[...commentOwnerKinds].join('/')} — the doc comment above a ` +
        'class and the one above a method must reach their declarations, or XML doc joins ' +
        'nothing'
    );
  }

  // The TAG NAMES only. XML doc is NOT a declared-type channel in C# the way
  // JSDoc is in JavaScript: C# has declaration-site types, so `<param>` is
  // documentation about a parameter whose type is already a fact. Recording the
  // contents would introduce a second, weaker source for something known.
  const tags = new Set(
    scopedComments.flatMap((r) => r[c('xmlDocTags')]!.split(',').filter((x) => x !== ''))
  );
  for (const tag of ['summary', 'param', 'returns', 'typeparam', 'inheritdoc']) {
    if (!tags.has(tag)) {
      failures += fail(`no comment records the <${tag}> tag`);
    }
  }
  if (scopedComments.some((r) => r[c('isDocumentation')] === 'false' && r[c('xmlDocTags')] !== '')) {
    failures += fail('a non-documentation comment carries XML tags');
  }

  return failures;
}

/**
 * `#if` SELECTION, in every position it can appear.
 *
 * ## The defect this exists to prevent is an INVERSION, not a shortfall
 *
 * The statement walk resolved every `#if` against an EMPTY symbol set. Inside a
 * method body the `#if` branch was therefore never taken and the `#else` always
 * was — in every file, whatever the module row said the configuration was. The
 * block walk did not resolve branches at all and emitted the locals of BOTH.
 *
 * A missing row is a shortfall an engine can be told about. This was worse: the
 * fact base named one configuration and contained the other, so everything read
 * from a multi-targeting repository below the declaration level was about a
 * program that was not selected.
 *
 * ## Why one position was not enough
 *
 * The old check tested TYPES, which were correct all along — the type, member,
 * using, attribute and region walks all threaded the symbol set properly and
 * exactly one call did not. A check that covers the position that works cannot
 * see the position that does not, and there was no gate comparing them.
 *
 * So this asserts BOTH DIRECTIONS in all seven: nothing from the untaken branch
 * is present, and everything from the taken branch is. The negative direction
 * alone would pass on a parser that emitted nothing at all.
 */
async function branchSelection(outputDir: string, corpusDir: string): Promise<number> {
  let failures = 0;
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const modules = relations.get('all-csharp-modules.csv');
  if (modules === undefined) {
    return fail('all-csharp-modules.csv is missing');
  }
  const module = modules.rows.find((r) =>
    (r[modules.header.indexOf('fileName')] ?? '').endsWith('Branches.cs')
  );
  if (module === undefined) {
    return fail('Branches.cs produced no cs_module row, so this check sees nothing');
  }
  const moduleHash = module[modules.header.length - 1]!;

  // Every NAME the fact base carries for this file, by the relation it came
  // from — so `void TakenCall() {}` (a declaration) and `TakenCall();` (a call)
  // are never confused. Conflating them made the call look present when only
  // the declaration was, and it is how this defect stayed hidden in my own
  // first probe.
  const namesIn = (file: string, column: string): Set<string> => {
    const relation = relations.get(file);
    if (relation === undefined || relation.header.length === 0) {
      return new Set();
    }
    const moduleColumn = relation.header.indexOf('csModuleLinkHash');
    const nameColumn = relation.header.indexOf(column);
    if (moduleColumn === -1 || nameColumn === -1) {
      return new Set();
    }
    return new Set(
      relation.rows
        .filter((r) => r[moduleColumn] === moduleHash)
        .map((r) => r[nameColumn]!)
    );
  };

  const positions: [string, Set<string>, string, string][] = [
    ['a TYPE', namesIn('all-csharp-types.csv', 'name'), 'TakenType', 'SkippedType'],
    ['a METHOD', namesIn('all-csharp-methods.csv', 'name'), 'TakenMethod', 'SkippedMethod'],
    ['a FIELD', namesIn('all-csharp-fields.csv', 'name'), 'TakenField', 'SkippedField'],
    [
      'an ENUM MEMBER',
      namesIn('all-csharp-enum-members.csv', 'name'),
      'TakenMember',
      'SkippedMember',
    ],
    [
      'a CALL inside a body',
      namesIn('all-csharp-call-sites.csv', 'calleeName'),
      'TakenCall',
      'SkippedCall',
    ],
    [
      'a LOCAL inside a body',
      namesIn('all-csharp-variables.csv', 'name'),
      'takenLocal',
      'skippedLocal',
    ],
    // EXPRESSION positions: each is a call, so the call-site relation sees it.
    ['an INITIALIZER expression', namesIn('all-csharp-call-sites.csv', 'calleeName'), 'TakenInit', 'SkippedInit'],
    ['an ARGUMENT expression', namesIn('all-csharp-call-sites.csv', 'calleeName'), 'TakenArg', 'SkippedArg'],
    ['an OPERAND expression', namesIn('all-csharp-call-sites.csv', 'calleeName'), 'TakenOperand', 'SkippedOperand'],
    ['a RETURN expression', namesIn('all-csharp-call-sites.csv', 'calleeName'), 'TakenReturn', 'SkippedReturn'],
  ];

  // The CHAIN form (rule 14): ChainSegment is exactly one METHOD_CALL whose
  // receiver is `type`, ChainSecond one whose receiver is the ChainSegment
  // call, GetCustomAttributes one whose receiver is the ChainSecond call —
  // and every receiver row sits INSIDE its parent's span.
  {
    const callSites = relations.get('all-csharp-call-sites.csv')!;
    const c = (n: string): number => callSites.header.indexOf(n);
    const chainRows = callSites.rows.filter(
      (r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'ChainSegment'
    );
    if (chainRows.length !== 1 || chainRows[0]![c('callKind')] !== 'METHOD_CALL') {
      failures += fail(
        `a #if splitting a fluent chain produced ${chainRows.length} call site(s) named ChainSegment ` +
          `[${chainRows.map((r) => r[c('callKind')]).join(',')}], expected exactly one METHOD_CALL — ` +
          'a segment in a #if branch is a call on the chain\'s receiver, not a receiver-less call'
      );
    }
    const expr = relations.get('all-csharp-expressions.csv')!;
    const ex = (n: string): number => expr.header.indexOf(n);
    const pk = expr.header.length - 1;
    const rowsHere = expr.rows.filter((r) => r[ex('csModuleLinkHash')] === moduleHash);
    const byHash = new Map(rowsHere.map((r) => [r[pk]!, r]));
    const childrenOf = (h: string): (readonly string[])[] => rowsHere.filter((r) => r[ex('parentExpressionHash')] === h);
    const segmentCall = chainRows[0] === undefined ? undefined : byHash.get(chainRows[0][c('csExpressionLinkHash')] ?? '');
    const receiver = segmentCall === undefined ? undefined : childrenOf(segmentCall[pk]!).find((r) => r[ex('edgeRole')] === 'RECEIVER');
    if (receiver?.[ex('potentialQualifiedName')] !== 'type') {
      failures += fail(
        `the ChainSegment call's RECEIVER child is ${receiver === undefined ? 'absent' : JSON.stringify(receiver[ex('potentialQualifiedName')])}, expected \`type\` — the receiver of a chain segment is the expression above the #if`
      );
    } else {
      const inside = Number(receiver[ex('startLine')]) >= Number(segmentCall![ex('startLine')]) &&
        (Number(receiver[ex('startLine')]) > Number(segmentCall![ex('startLine')]) || Number(receiver[ex('startColumn')]) >= Number(segmentCall![ex('startColumn')]));
      if (!inside) {
        failures += fail(
          `the ChainSegment call starts at ${segmentCall![ex('startLine')]}:${segmentCall![ex('startColumn')]} and its receiver at ` +
            `${receiver[ex('startLine')]}:${receiver[ex('startColumn')]} — a segment's span starts where its receiver starts, or the child is outside its parent`
        );
      }
    }
    // The outer two links of the chain: each call's RECEIVER child is the
    // previous segment's call, by hash.
    const callByName = (name: string): (readonly string[]) | undefined =>
      callSites.rows.find((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === name);
    for (const [outer, inner] of [['ChainSecond', 'ChainSegment'], ['GetCustomAttributes', 'ChainSecond']] as const) {
      const outerRow = byHash.get(callByName(outer)?.[c('csExpressionLinkHash')] ?? '');
      const innerRow = byHash.get(callByName(inner)?.[c('csExpressionLinkHash')] ?? '');
      const receiverRow = outerRow === undefined ? undefined : childrenOf(outerRow[pk]!).find((r) => r[ex('edgeRole')] === 'RECEIVER');
      if (outerRow === undefined || innerRow === undefined || receiverRow?.[pk] !== innerRow[pk]) {
        failures += fail(`the ${outer} call's RECEIVER child is not the ${inner} call — the chain's segments must nest as calls on calls`);
      }
    }
    const skipped = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'SkippedSegment');
    if (skipped.length !== 0) {
      failures += fail('SkippedSegment, the UNTAKEN arm of the chain, was emitted');
    }
    // The OPERATOR form: the taken arm is the right operand of a BINARY whose
    // operator is the arm's, whose left operand is `a`; the other arm is absent.
    {
      const taken = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'TakenOperator');
      const leaked = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'SkippedOperator');
      if (taken.length !== 1) {
        failures += fail(`TakenOperator has ${taken.length} call site(s), expected 1 — the taken arm of \`a #if + … #endif\` is a call`);
      }
      if (leaked.length !== 0) {
        failures += fail(
          'SkippedOperator was emitted from `a #if + … #else - … #endif` — an untaken arm read as a binary operand puts a ' +
            'branch in the tree that the emission did not take'
        );
      }
      const call = taken[0] === undefined ? undefined : byHash.get(taken[0][c('csExpressionLinkHash')] ?? '');
      const binary = call === undefined ? undefined : byHash.get(call[ex('parentExpressionHash')] ?? '');
      if (binary?.[ex('kind')] !== 'BINARY' || binary[ex('operatorString')] !== '+' || call?.[ex('edgeRole')] !== 'RIGHT_OPERAND') {
        failures += fail(
          `the TakenOperator call's parent is ${binary === undefined ? 'absent' : `a ${binary[ex('kind')]} with operator "${binary[ex('operatorString')]}"`} ` +
            `and its role is ${call?.[ex('edgeRole')] ?? 'absent'} — expected a BINARY '+' with the call as RIGHT_OPERAND: the operator is inside the branch and the row must carry it`
        );
      } else {
        const left = childrenOf(binary[pk]!).find((r) => r[ex('edgeRole')] === 'LEFT_OPERAND');
        if (left?.[ex('potentialQualifiedName')] !== 'a') {
          failures += fail(`the operator form's LEFT_OPERAND is ${left === undefined ? 'absent' : JSON.stringify(left[ex('potentialQualifiedName')])}, expected \`a\``);
        }
      }
    }
    // The HEAD form: the taken arm's call is the LEFT operand of a BINARY
    // whose operator is the arm's `+`, whose right operand is `a`.
    {
      const taken = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'TakenHead');
      const leaked = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'SkippedHead');
      if (taken.length !== 1 || leaked.length !== 0) {
        failures += fail(`TakenHead ${taken.length} call(s), SkippedHead ${leaked.length} — expected 1 and 0 from \`#if TakenHead(1) + #else SkippedHead(2) - #endif a\``);
      }
      const call = taken[0] === undefined ? undefined : byHash.get(taken[0][c('csExpressionLinkHash')] ?? '');
      const binary = call === undefined ? undefined : byHash.get(call[ex('parentExpressionHash')] ?? '');
      if (binary?.[ex('kind')] !== 'BINARY' || binary[ex('operatorString')] !== '+' || call?.[ex('edgeRole')] !== 'LEFT_OPERAND') {
        failures += fail(`the TakenHead call's parent is ${binary === undefined ? 'absent' : `a ${binary[ex('kind')]} "${binary[ex('operatorString')]}"`} and its role ${call?.[ex('edgeRole')] ?? 'absent'} — expected a BINARY '+' with the call as LEFT_OPERAND: the operator is at the END of the branch`);
      } else {
        const right = childrenOf(binary[pk]!).find((r) => r[ex('edgeRole')] === 'RIGHT_OPERAND');
        if (right?.[ex('potentialQualifiedName')] !== 'a') {
          failures += fail(`the head form's RIGHT_OPERAND is ${right === undefined ? 'absent' : JSON.stringify(right[ex('potentialQualifiedName')])}, expected \`a\``);
        }
      }
    }
    // PARAMETER and ARGUMENT fragments (rules 17 and 18): the taken arm's
    // parameter is the method's, the untaken arm's is NOT, arity is 2; the
    // taken arm's argument is the call's, the untaken arm's is not, and the
    // argument AFTER the #endif is still there — three arguments.
    {
      const methodsRel = relations.get('all-csharp-methods.csv')!;
      const paramsRel = relations.get('all-csharp-method-parameters.csv')!;
      const mm = (n: string): number => methodsRel.header.indexOf(n);
      const method = methodsRel.rows.find((r) => r[mm('csModuleLinkHash')] === moduleHash && r[mm('name')] === 'ParamFragment');
      const methodHash = method?.[methodsRel.header.length - 1];
      const owned = methodHash === undefined ? [] : paramsRel.rows.filter((r) => r[paramsRel.header.indexOf('csMethodLinkHash')] === methodHash);
      const paramNames = owned.map((r) => r[paramsRel.header.indexOf('name')]);
      if (method === undefined || paramNames.length !== 2 || !paramNames.includes('takenParam') || paramNames.includes('skippedParam')) {
        failures += fail(`ParamFragment has parameters [${paramNames.join(',')}] — expected exactly takenParam and result: a #if in a parameter list holds only the taken arm's parameters, and upstream emitted both`);
      }
      const three = callSites.rows.find((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'Three');
      const takenArg = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'TakenFragArg');
      const skippedArg = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'SkippedFragArg');
      if (three?.[c('argumentCount')] !== '3' || takenArg.length !== 1 || skippedArg.length !== 0) {
        failures += fail(`Three(1, #if TakenFragArg(2) #else SkippedFragArg(3) #endif 4) has ${three?.[c('argumentCount')] ?? 'no'} argument(s), TakenFragArg ${takenArg.length}, SkippedFragArg ${skippedArg.length} — expected 3, 1 and 0: the argument after the #endif was lost upstream`);
      } else {
        const takenRow = byHash.get(takenArg[0]![c('csExpressionLinkHash')] ?? '');
        if (takenRow?.[ex('edgeRole')] !== 'ARGUMENT' || takenRow[ex('parentExpressionHash')] !== three[c('csExpressionLinkHash')]) {
          failures += fail(`TakenFragArg(2) inside the fragment is ${takenRow === undefined ? 'absent' : `${takenRow[ex('edgeRole')]} of ${takenRow[ex('parentExpressionHash')] === three[c('csExpressionLinkHash')] ? 'Three' : 'something else'}`} — expected an ARGUMENT child of the Three call`);
        }
      }
    }
    // SECTION fragment (rule 21): three SWITCH_SECTION blocks in
    // SectionFragment — case 1, the taken arm's case 2, default — and the
    // untaken arm's case 3 is not in the program; two TakenSection calls,
    // no SkippedSection, and no phantom local named `case` or label.
    {
      const blocksRel = relations.get('all-csharp-blocks.csv')!;
      const methodsRel = relations.get('all-csharp-methods.csv')!;
      const mm = (n: string): number => methodsRel.header.indexOf(n);
      const method = methodsRel.rows.find((r) => r[mm('csModuleLinkHash')] === moduleHash && r[mm('name')] === 'SectionFragment');
      const methodHash = method?.[methodsRel.header.length - 1] ?? '';
      const sections = blocksRel.rows.filter((r) => r[blocksRel.header.indexOf('csMethodLinkHash')] === methodHash && r[blocksRel.header.indexOf('blockKind')] === 'SWITCH_SECTION');
      const taken = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'TakenSection');
      const skipped = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'SkippedSection');
      if (sections.length !== 3 || taken.length !== 2 || skipped.length !== 0) {
        failures += fail(`SectionFragment has ${sections.length} SWITCH_SECTION blocks, ${taken.length} TakenSection call(s), ${skipped.length} SkippedSection — expected 3, 2 and 0: a #if holding a switch section is the section, not a local of type \`case\` and a label`);
      }
      const variables = relations.get('all-csharp-variables.csv')!;
      const phantom = variables.rows.filter((r) => r[variables.header.indexOf('csModuleLinkHash')] === moduleHash && r[variables.header.indexOf('name')] === 'case');
      if (phantom.length !== 0) {
        failures += fail(`${phantom.length} phantom local(s) named \`case\` in Branches.cs`);
      }
      // The LABEL form: one label per section node. LabelFragment has a
      // section for `case 6`, NONE for the untaken `case 8` (its label is not
      // in the program and nothing follows its #endif), one for the taken
      // `case 7` holding the statements, and `default`: three. Labels 6 and 7
      // are rows; 8 is not.
      const labelMethod = methodsRel.rows.find((r) => r[mm('csModuleLinkHash')] === moduleHash && r[mm('name')] === 'LabelFragment');
      const labelHash = labelMethod?.[methodsRel.header.length - 1] ?? '';
      const labelSections = blocksRel.rows.filter((r) => r[blocksRel.header.indexOf('csMethodLinkHash')] === labelHash && r[blocksRel.header.indexOf('blockKind')] === 'SWITCH_SECTION');
      const labels = expr.rows.filter((r) => r[ex('csModuleLinkHash')] === moduleHash && r[ex('rootContext')] === 'CASE_LABEL' && r[ex('kind')] === 'LITERAL' && labelMethod !== undefined && Number(r[ex('startLine')]) > Number(labelMethod[mm('startLine')]) && Number(r[ex('startLine')]) < Number(labelMethod[mm('endLine')]));
      const labelTexts = labels.map((r) => r[ex('literalValue')]).sort();
      const takenLabel = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'TakenLabel');
      if (labelSections.length !== 3 || labelTexts.join(',') !== '6,7' || takenLabel.length !== 1) {
        failures += fail(`LabelFragment has ${labelSections.length} SWITCH_SECTION blocks, case labels [${labelTexts.join(',')}] and ${takenLabel.length} TakenLabel call(s) — expected 3, [6,7] and 1: a stacked label under a #if is the section's label when taken and not in the program when not`);
      }
    }
    // BASE-LIST CONTINUATION (rule 22), DANGLING IF (rule 23), ALLOWS (24).
    {
      const methodsRel = relations.get('all-csharp-methods.csv')!;
      const blocksRel = relations.get('all-csharp-blocks.csv')!;
      const mm = (n: string): number => methodsRel.header.indexOf(n);
      const heritageRel = relations.get('all-csharp-type-heritages.csv')!;
      const typesRel = relations.get('all-csharp-types.csv')!;
      const tt = (n: string): number => typesRel.header.indexOf(n);
      const continued = typesRel.rows.find((r) => r[tt('csModuleLinkHash')] === moduleHash && r[tt('name')] === 'ContinuedBase');
      const continuedHash = continued?.[typesRel.header.length - 1] ?? '';
      const bases = heritageRel.rows.filter((r) => r[heritageRel.header.indexOf('csTypeLinkHash')] === continuedHash).map((r) => r[heritageRel.header.indexOf('baseTypeName')]).sort();
      if (bases.join(',') !== 'ITakenBase,System.IDisposable') {
        failures += fail(`ContinuedBase's heritage rows are [${bases.join(',')}] — expected System.IDisposable and ITakenBase: a base-list continuation under a #if holds only the taken arm's types`);
      }
      const dangle = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'TakenDangle');
      const body = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'DangleBody');
      const dangleMethod = methodsRel.rows.find((r) => r[mm('csModuleLinkHash')] === moduleHash && r[mm('name')] === 'DanglingIf');
      const dangleHash = dangleMethod?.[methodsRel.header.length - 1] ?? '';
      const ifBlocksHere = blocksRel.rows.filter((r) => r[blocksRel.header.indexOf('csMethodLinkHash')] === dangleHash && r[blocksRel.header.indexOf('blockKind')] === 'IF');
      if (dangle.length !== 1 || body.length !== 1 || ifBlocksHere.length !== 1) {
        failures += fail(`DanglingIf: TakenDangle ${dangle.length}, DangleBody ${body.length}, IF blocks ${ifBlocksHere.length} — expected 1, 1 and 1: an if whose else ends the #if branch is an if, and the body after the #endif is a block of its own`);
      }
      const fragmentBase = typesRel.rows.find((r) => r[tt('csModuleLinkHash')] === moduleHash && r[tt('name')] === 'FragmentBase');
      const fragmentHash = fragmentBase?.[typesRel.header.length - 1] ?? '';
      const fragmentBases = heritageRel.rows.filter((r) => r[heritageRel.header.indexOf('csTypeLinkHash')] === fragmentHash).map((r) => r[heritageRel.header.indexOf('baseTypeName')]).sort();
      if (fragmentBases.join(',') !== 'ITakenBase,ITrailingBase,System.IDisposable') {
        failures += fail(`FragmentBase's heritage rows are [${fragmentBases.join(',')}] — expected System.IDisposable, ITakenBase and ITrailingBase: a base-list run ending in a comma under a #if holds only the taken arm's types`);
      }
      const takenArm = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'TakenArm');
      const skippedArm = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'SkippedArm');
      if (takenArm.length !== 2 || skippedArm.length !== 0) {
        failures += fail(`ArmFragment: TakenArm ${takenArm.length}, SkippedArm ${skippedArm.length} — expected 2 and 0: a switch-expression arm under a #if is the taken arm's, and the arm after the #endif is not lost`);
      }
      const modMethod = methodsRel.rows.find((r) => r[mm('csModuleLinkHash')] === moduleHash && r[mm('name')] === 'ModifierFragment');
      // The SET, not only the access: with both arms read, access still resolves
      // to PROTECTED_INTERNAL (first match) and only the set shows the leaked
      // `private`.
      const modSet = modMethod?.[mm('methodModifiers')] ?? '';
      if (modMethod?.[mm('methodAccess')] !== 'PROTECTED_INTERNAL' || modMethod[mm('isVirtual')] !== 'true' || /PRIVATE/.test(modSet)) {
        failures += fail(`ModifierFragment is ${modMethod?.[mm('methodAccess')] ?? 'absent'}${modMethod?.[mm('isVirtual')] === 'true' ? ' virtual' : ''} with modifiers [${modSet}] — expected PROTECTED_INTERNAL virtual and no PRIVATE: modifiers under a #if are the taken arm's, and the untaken arm's \`private\` is not in the program`);
      }
      const attrsRel = relations.get('all-csharp-attributes.csv')!;
      const twoHash = methodsRel.rows.find((r) => r[mm('csModuleLinkHash')] === moduleHash && r[mm('name')] === 'TwoAttributes')?.[methodsRel.header.length - 1] ?? '';
      const twoAttrs = attrsRel.rows.filter((r) => r[attrsRel.header.indexOf('ownerHash')] === twoHash).map((r) => r[attrsRel.header.indexOf('attributeName')]).sort();
      if (twoAttrs.join(',') !== 'EditorBrowsable,Obsolete') {
        failures += fail(`TwoAttributes carries [${twoAttrs.join(',')}] — expected EditorBrowsable and Obsolete: a #if branch may hold several attribute lists`);
      }
      // HEADER under a #if (rule 32): the type is HeaderTaken with two bases,
      // no HeaderSkipped exists; Process has the taken arm's second parameter;
      // the constructor has takenParam and its this() call; the untaken arms'
      // names appear nowhere.
      const headerTaken = typesRel.rows.find((r) => r[tt('csModuleLinkHash')] === moduleHash && r[tt('name')] === 'HeaderTaken');
      const headerSkipped = typesRel.rows.find((r) => r[tt('csModuleLinkHash')] === moduleHash && r[tt('name')] === 'HeaderSkipped');
      const headerHash = headerTaken?.[typesRel.header.length - 1] ?? '';
      const headerBases = heritageRel.rows.filter((r) => r[heritageRel.header.indexOf('csTypeLinkHash')] === headerHash).map((r) => r[heritageRel.header.indexOf('baseTypeName')]).sort();
      if (headerTaken === undefined || headerSkipped !== undefined || headerBases.join(',') !== 'ITakenBase,System.IDisposable') {
        failures += fail(`the class whose header sits under a #if is ${headerTaken === undefined ? 'absent' : 'present'}, HeaderSkipped ${headerSkipped === undefined ? 'absent' : 'PRESENT'}, bases [${headerBases.join(',')}] — expected HeaderTaken with System.IDisposable and ITakenBase: a declaration header under a #if is the taken arm's`);
      }
      const paramsRel = relations.get('all-csharp-method-parameters.csv')!;
      const processHash = methodsRel.rows.find((r) => r[mm('csTypeLinkHash')] === headerHash && r[mm('name')] === 'Process')?.[methodsRel.header.length - 1] ?? '';
      const processParams = paramsRel.rows.filter((r) => r[paramsRel.header.indexOf('csMethodLinkHash')] === processHash).map((r) => r[paramsRel.header.indexOf('name')]).sort();
      const ctorRows = methodsRel.rows.filter((r) => r[mm('csTypeLinkHash')] === headerHash && r[mm('methodKind')] === 'CONSTRUCTOR');
      const ctorWithParam = ctorRows.find((r) => paramsRel.rows.some((p) => p[paramsRel.header.indexOf('csMethodLinkHash')] === r[methodsRel.header.length - 1] && p[paramsRel.header.indexOf('name')] === 'takenParam'));
      const skippedParamAnywhere = paramsRel.rows.some((p) => ['skippedArray', 'skippedParam'].includes(p[paramsRel.header.indexOf('name')] ?? '') && methodsRel.rows.some((r) => r[methodsRel.header.length - 1] === p[paramsRel.header.indexOf('csMethodLinkHash')] && r[mm('csModuleLinkHash')] === moduleHash));
      const thisCall = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('callKind')] === 'THIS_CONSTRUCTOR_CALL');
      if (processParams.join(',') !== 't,takenSpan' || ctorWithParam === undefined || skippedParamAnywhere || thisCall.length !== 1) {
        failures += fail(`header under a #if on members: Process has [${processParams.join(',')}], a constructor with takenParam is ${ctorWithParam === undefined ? 'absent' : 'present'}, an untaken-arm parameter is ${skippedParamAnywhere ? 'PRESENT' : 'absent'}, THIS_CONSTRUCTOR_CALL rows ${thisCall.length} — expected [t,takenSpan], present, absent, 1`);
      }
      // A `?.` / `?[` target is a MEMBER_ACCESS row with isNullConditional — the
      // representation the walk has always used for a conditional access.
      // `other?.Field = 1` and `arr?[0] = 2` are NOT asserted. A
      // null-conditional on the left of an assignment is C# 14, and the
      // published grammar treats a conditional access as a value only — the
      // statement is an ERROR node, so there is no assignment row to inspect.
      // One of the 12 KNOWN_GRAMMAR_LIMITATIONS, with a torture fixture.
      // `public safe int SafeField;` is NOT asserted. `safe` is a contextual
      // modifier the published grammar does not know, so the declaration is an
      // ERROR node and there is no field row to find. It is one of the 12
      // shapes in KNOWN_GRAMMAR_LIMITATIONS and has a torture fixture of its
      // own; asserting it here would be asserting the fork.
      const tpRel = relations.get('all-csharp-type-parameters.csv')!;
      const tp = (n: string): number => tpRel.header.indexOf(n);
      const acceptHash = methodsRel.rows.find((r) => r[mm('csModuleLinkHash')] === moduleHash && r[mm('name')] === 'Accept')?.[methodsRel.header.length - 1] ?? '';
      const allowsRows = tpRel.rows.filter((r) => r[tp('ownerLinkHash')] === acceptHash && r[tp('hasAllowRefStructConstraint')] === 'true');
      if (allowsRows.length !== 1 || allowsRows[0]![tp('name')] !== 'T') {
        failures += fail(`${allowsRows.length} type parameter(s) with hasAllowRefStructConstraint in Branches.cs — expected exactly T of Allows.Accept: \`allows ref struct\` is a constraint node now, not an ERROR the flag was read through`);
      }
      const contMethodHash = methodsRel.rows.find((r) => r[mm('csModuleLinkHash')] === moduleHash && r[mm('name')] === 'Continued')?.[methodsRel.header.length - 1] ?? '';
      const contParam = tpRel.rows.find((r) => r[tp('ownerLinkHash')] === contMethodHash);
      if (contParam?.[tp('hasAllowRefStructConstraint')] !== 'true' || contParam[tp('hasNotNullConstraint')] !== 'true') {
        failures += fail(`Continued<T>'s parameter has allows=${contParam?.[tp('hasAllowRefStructConstraint')] ?? 'absent'} notnull=${contParam?.[tp('hasNotNullConstraint')] ?? 'absent'} — expected both true: a constraint continuation under a #if is the clause's`);
      }
      const guardedHash = methodsRel.rows.find((r) => r[mm('csModuleLinkHash')] === moduleHash && r[mm('name')] === 'Guarded')?.[methodsRel.header.length - 1] ?? '';
      const guarded = tpRel.rows.find((r) => r[tp('ownerLinkHash')] === guardedHash);
      if (guarded === undefined || guarded[tp('hasAllowRefStructConstraint')] !== 'true' || guarded[tp('hasStructConstraint')] !== 'false') {
        failures += fail(`Guarded<T>'s parameter has allows=${guarded?.[tp('hasAllowRefStructConstraint')] ?? 'absent'} struct=${guarded?.[tp('hasStructConstraint')] ?? 'absent'} — expected allows true and struct false: a where clause under a #if is the taken arm's`);
      }
    }
    // ARROW and INITIALIZER tails (rules 19 and 20): the taken arm's call,
    // in its position's context, and NO parse gap on the lines the `;`
    // debris used to occupy.
    {
      const gapsRel = relations.get('all-csharp-parse-gaps.csv');
      for (const [taken, skipped, ctx] of [['TakenTail', 'SkippedTail', 'EXPRESSION_BODY'], ['TakenFieldInit', 'SkippedFieldInit', 'FIELD_INITIALIZER']] as const) {
        const takenRows = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === taken);
        const skippedRows = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === skipped);
        const root = takenRows[0] === undefined ? undefined : byHash.get(takenRows[0][c('csExpressionLinkHash')] ?? '');
        if (takenRows.length !== 1 || skippedRows.length !== 0 || root?.[ex('rootContext')] !== ctx) {
          failures += fail(`${taken} ${takenRows.length} call(s) in context ${root?.[ex('rootContext')] ?? 'absent'}, ${skipped} ${skippedRows.length} — expected 1 in ${ctx} and 0: the branch holds the expression AND its semicolon`);
        } else if (gapsRel !== undefined && gapsRel.header.length > 0) {
          const line = Number(takenRows[0]![c('startLine')]);
          const near = gapsRel.rows.filter((r) => r[gapsRel.header.indexOf('csModuleLinkHash')] === moduleHash && Math.abs(Number(r[gapsRel.header.indexOf('startLine')]) - line) <= 4);
          if (near.length !== 0) {
            failures += fail(`${near.length} parse gap(s) within 4 lines of ${taken} — the \`;\` inside a #if branch after an arrow or an initializer is not debris any more`);
          }
        }
      }
    }
    // The ELSE FRAGMENT: the taken arm's `else if` emits its call, the
    // untaken arm's does not, and the `else` after the #endif is an ELSE
    // block — the orphaned clause has the same two scopes as the unguarded
    // form.
    {
      const taken = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'TakenElse');
      const leaked = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'SkippedElse');
      if (taken.length !== 1 || leaked.length !== 0) {
        failures += fail(`TakenElse ${taken.length} call(s), SkippedElse ${leaked.length} — expected 1 and 0 from \`if (a) {…} #if else if {TakenElse} #else else if {SkippedElse} #endif else {…}\``);
      }
      // The two `Other(…)` calls are the outer if's consequence and the trailing else; the else is the later one.
      const trailing = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash && r[c('calleeName')] === 'Other').sort((x, y) => Number(x[c('startLine')]) - Number(y[c('startLine')]))[1];
      const blocksRel = relations.get('all-csharp-blocks.csv');
      if (trailing === undefined || blocksRel === undefined) {
        failures += fail('the `else { r = Other(4); }` after the #endif produced no call, or there is no block relation');
      } else {
        const elseBlock = blocksRel.rows.find((r) => r[blocksRel.header.indexOf('csModuleLinkHash')] === moduleHash && r[blocksRel.header.indexOf('blockKind')] === 'ELSE' && r[blocksRel.header.indexOf('startLine')] === trailing[c('startLine')]);
        if (elseBlock === undefined) {
          failures += fail(`no ELSE block on line ${trailing[c('startLine')]}: the \`else\` after a #endif is an else_fragment, and its block is the same scope the unguarded form has`);
        }
      }
    }
  }

  let observed = 0;
  for (const [what, names, taken, skipped] of positions) {
    observed += names.size;
    if (!names.has(taken)) {
      failures += fail(
        `${what} from the TAKEN branch is missing: "${taken}". net8.0 defines NET8_0, so ` +
          'this branch IS the program.'
      );
    }
    if (names.has(skipped)) {
      failures += fail(
        `${what} from the UNTAKEN branch was emitted: "${skipped}". The fact base names one ` +
          'configuration and contains the other, which is worse than a missing row — an ' +
          'engine cannot tell it is reading a program that was not selected.'
      );
    }
  }
  // NEGATIVE CONTROL. Every assertion above is a membership test, and a reader
  // that returns nothing satisfies half of them for free.
  if (observed === 0) {
    failures += fail(
      'NEGATIVE CONTROL FAILED: Branches.cs contributed no names to any relation, so the ' +
        'untaken-branch assertions passed by having nothing to check.'
    );
  }

  // A LAMBDA and a LOCAL FUNCTION from the untaken branch, and a YIELD in it.
  // cs-oracle's reading of the grammar: both branches are descendants of the
  // `preproc_if`, so any walk that simply recurses finds both — and three did,
  // after the statement walker was fixed. One accessor now serves all of them.
  const methods = relations.get('all-csharp-methods.csv');
  if (methods !== undefined && methods.header.length > 0) {
    const mine = methods.rows.filter(
      (r) => r[methods.header.indexOf('csModuleLinkHash')] === moduleHash
    );
    const names = new Set(mine.map((r) => r[methods.header.indexOf('name')]));
    const lambdas = mine.filter((r) => r[methods.header.indexOf('methodKind')] === 'LAMBDA');
    if (lambdas.length !== 1) {
      failures += fail(
        `${lambdas.length} lambda method rows in Branches.cs, expected exactly 1 — one per ` +
          'branch is written and only the taken branch is in the program'
      );
    }
    if (!names.has('TakenLocalFn') || names.has('SkippedLocalFn')) {
      failures += fail('a local function from the UNTAKEN branch has a method row, or the taken one has none');
    }
    const notAnIterator = mine.find((r) => r[methods.header.indexOf('name')] === 'NotAnIterator');
    if (notAnIterator?.[methods.header.indexOf('isIterator')] !== 'false') {
      failures += fail(
        'a method whose only `yield` sits in the untaken branch reports isIterator. The ' +
          'yield is not in the program.'
      );
    }
  }

  // A BLOCK from the untaken branch. The block walk did not resolve branches at
  // all, so both `if` bodies opened a scope and a local from each got a row.
  const blocks = relations.get('all-csharp-blocks.csv');
  if (blocks !== undefined && blocks.header.length > 0) {
    const ifBlocks = blocks.rows.filter(
      (r) =>
        r[blocks.header.indexOf('csModuleLinkHash')] === moduleHash &&
        r[blocks.header.indexOf('blockKind')] === 'IF'
    );
    // One from the two-branch `if` fixture, two from ElseFragment — its
    // outer `if` and the TAKEN arm's `else if`; the untaken arm's `if` is not
    // in the program — and one from DanglingIf's taken `if`.
    if (ifBlocks.length !== 4) {
      failures += fail(
        `${ifBlocks.length} IF blocks in Branches.cs, expected exactly 4. Both branches ` +
          'declare one and only the taken branch is in the program.'
      );
    }
  }

  // AND THE REGION ROWS AGREE. cs_preproc_region is the audit trail for this
  // decision, so a trail that disagrees with what was emitted is worse than no
  // trail at all.
  const regions = relations.get('all-csharp-preproc-regions.csv');
  if (regions !== undefined && regions.header.length > 0) {
    const mine = regions.rows.filter(
      (r) => r[regions.header.indexOf('csModuleLinkHash')] === moduleHash
    );
    const active = mine.filter((r) => r[regions.header.indexOf('isActive')] === 'true');
    if (mine.length === 0) {
      failures += fail('the four `#if` chains in Branches.cs produced no region rows');
    }
    // THIRTY-SEVEN chains: thirty-one keyed on NET8_0, whose IF branch is taken under
    // net8.0 — six in declaration and statement positions, four in
    // EXPRESSION positions (Expressions()), the one splitting a fluent chain
    // (Chain()), the operator fragment and its mirror (OperatorFragment(),
    // HeadFragment()), the else fragment (ElseFragment()) and the parameter
    // and argument fragments (ParamFragment()) and the arrow and initializer
    // tails (ArrowTail(), _tail), the section fragment (SectionFragment())
    // and the label fragment (LabelFragment(), whose second chain is keyed
    // on FLIP), the base-list continuation (ContinuedBase) and the dangling
    // if (DanglingIf()), the trailing-comma base run (FragmentBase), the guarded
    // where clause (Guarded()), the switch-expression arms (ArmFragment()), the
    // modifier fragment, the two-attribute branch, the three declaration headers
    // (HeaderTaken, Process, the constructor) and the constraint continuation
    // (Continued()) — and six
    // keyed on FLIP — a member, a base list, a method body, a property body
    // and the inner chain of NestedHost — whose ELSE branch is taken because
    // FLIP is not defined in this run. The trail must say exactly that — 11
    // IF, 5 ELSE — and not merely "sixteen active", which an inverted trail
    // would also report.
    if (active.length !== 36) {
      failures += fail(
        `${active.length} active regions in a file with thirty-seven chains, thirty-six of them with a branch to take, expected 36`
      );
    }
    const activeKinds = active.map((r) => r[regions.header.indexOf('regionKind')]);
    const activeIfs = activeKinds.filter((k) => k === 'IF').length;
    const activeElses = activeKinds.filter((k) => k === 'ELSE').length;
    if (activeIfs !== 31 || activeElses !== 5) {
      failures += fail(
        `the audit trail records ${activeIfs} IF and ${activeElses} ELSE branches active; ` +
          'expected 31 and 5. The trail and the fact base must say the same thing, and an ' +
          'inverted trail would be wrong TOGETHER with an inverted fact base.'
      );
    }
    // THE NESTED CHAIN'S PARENT: the inner FLIP regions name the outer NET8_0
    // IF branch they sit in, and nothing else names a parent.
    const rk = (n: string): number => regions.header.indexOf(n);
    const withParent = mine.filter((r) => r[rk('parentRegionLinkHash')] !== '');
    const regionByPk = new Map(mine.map((r) => [r[regions.header.length - 1]!, r]));
    if (withParent.length !== 2) {
      failures += fail(`${withParent.length} regions name a parent, expected 2 — the inner chain's IF and ELSE`);
    } else {
      for (const child of withParent) {
        const parent = regionByPk.get(child[rk('parentRegionLinkHash')]!);
        if (
          parent === undefined ||
          parent[rk('regionKind')] !== 'IF' ||
          !parent[rk('conditionText')]!.includes('NET8_0') ||
          Number(parent[rk('startLine')]) >= Number(child[rk('startLine')])
        ) {
          failures += fail(
            `a nested region names ${parent === undefined ? 'no region' : `a ${parent[rk('regionKind')]} on ${parent[rk('conditionText')]}`} ` +
              'as its parent — expected the enclosing NET8_0 IF branch, above it'
          );
          break;
        }
      }
    }
  }

  // THE SECOND KEY. Under one configuration a walker that always takes the
  // first branch and a correct one give the same answer on a chain whose first
  // branch is the right one. Flipping a user-defined constant makes the two
  // walkers disagree — wrong answers become DIFFERENT failures, which is
  // cs-oracle's point and worth the second analyzer run.
  failures += await withTempDir(async (flipped) => {
    let flipFailures = 0;
    await runAnalyzer(corpusDir, flipped, { defineConstants: ['FLIP'] });
    const flippedRelations = new Map(readRelations(flipped).map((r) => [r.name, r]));
    const methodsFlipped = flippedRelations.get('all-csharp-methods.csv');
    const namesUnder = (rel: Relation | undefined): Set<string> =>
      new Set(rel === undefined ? [] : rel.rows.map((r) => r[rel.header.indexOf('name')]!));
    const withFlip = namesUnder(methodsFlipped);
    const withoutFlip = namesUnder(relations.get('all-csharp-methods.csv'));
    if (!withFlip.has('FlipOn') || withFlip.has('FlipOff')) {
      flipFailures += fail(
        `with FLIP defined: FlipOn present=${withFlip.has('FlipOn')}, FlipOff present=` +
          `${withFlip.has('FlipOff')}. The user-defined constant did not select the branch.`
      );
    }
    if (withoutFlip.has('FlipOn') || !withoutFlip.has('FlipOff')) {
      flipFailures += fail(
        `without FLIP: FlipOn present=${withoutFlip.has('FlipOn')}, FlipOff present=` +
          `${withoutFlip.has('FlipOff')}. The #else must be taken when the symbol is absent.`
      );
    }
    // THE BASE LIST, THE METHOD BODY AND THE PROPERTY BODY under a `#if`,
    // each read from the branch this emission takes. These three shapes are
    // grammar rules of the fork; before them the base-list shape displaced the
    // type's NAME into an ERROR and named the type after the directive's
    // symbol, and the two body shapes were withheld as recovery debris.
    const heritageOf = (rel: Map<string, Relation>, typeName: string): string[] => {
      const types = rel.get('all-csharp-types.csv');
      const heritage = rel.get('all-csharp-type-heritages.csv');
      if (types === undefined || heritage === undefined) {
        return [];
      }
      const hash = types.rows.find((r) => r[types.header.indexOf('name')] === typeName)?.[
        types.header.length - 1
      ];
      return heritage.rows
        .filter((r) => r[heritage.header.indexOf('csTypeLinkHash')] === hash)
        .map((r) => r[heritage.header.indexOf('baseTypeName')]!);
    };
    if (heritageOf(flippedRelations, 'FlipHost').join(',') !== 'IFlipOn') {
      flipFailures += fail(
        `with FLIP: FlipHost's base list is [${heritageOf(flippedRelations, 'FlipHost').join(', ')}], ` +
          'expected [IFlipOn] — the base list under the taken branch of a #if'
      );
    }
    if (heritageOf(relations, 'FlipHost').join(',') !== 'IFlipOff') {
      flipFailures += fail(
        `without FLIP: FlipHost's base list is [${heritageOf(relations, 'FlipHost').join(', ')}], ` +
          'expected [IFlipOff]'
      );
    }
    const typeNamesUnder = (rel: Map<string, Relation>): Set<string> => {
      const types = rel.get('all-csharp-types.csv');
      return new Set(types === undefined ? [] : types.rows.map((r) => r[types.header.indexOf('name')]!));
    };
    if (typeNamesUnder(relations).has('FLIP') || typeNamesUnder(flippedRelations).has('FLIP')) {
      flipFailures += fail(
        'a cs_type named FLIP exists: the directive`s SYMBOL was read as a type`s name, ' +
          'which is what upstream`s recovery of a #if around a base list produced'
      );
    }
    const callsFrom = (rel: Map<string, Relation>, methodName: string): string[] => {
      const ms = rel.get('all-csharp-methods.csv');
      const cs = rel.get('all-csharp-call-sites.csv');
      if (ms === undefined || cs === undefined) {
        return [];
      }
      const hashes = new Set(
        ms.rows.filter((r) => r[ms.header.indexOf('name')] === methodName).map((r) => r[ms.header.length - 1]!)
      );
      return cs.rows
        .filter((r) => hashes.has(r[cs.header.indexOf('callerMethodLinkHash')]!))
        .map((r) => r[cs.header.indexOf('calleeName')]!);
    };
    if (callsFrom(flippedRelations, 'FlipBody').join(',') !== 'FlipOnCall') {
      flipFailures += fail(
        `with FLIP: FlipBody calls [${callsFrom(flippedRelations, 'FlipBody').join(', ')}], ` +
          'expected [FlipOnCall] — the arrow body under the taken branch'
      );
    }
    if (callsFrom(relations, 'FlipBody').join(',') !== 'FlipOffCall') {
      flipFailures += fail(
        `without FLIP: FlipBody calls [${callsFrom(relations, 'FlipBody').join(', ')}], ` +
          'expected [FlipOffCall]'
      );
    }
    // The property: an expression-bodied getter under FLIP, an auto property
    // with two accessors without it.
    if (callsFrom(flippedRelations, 'get_FlipProperty').join(',') !== 'FlipOnCall2') {
      flipFailures += fail(
        `with FLIP: FlipProperty's getter calls [${callsFrom(flippedRelations, 'get_FlipProperty').join(', ')}], ` +
          'expected [FlipOnCall2] — the arrow body under the taken branch'
      );
    }
    if (!withoutFlip.has('set_FlipProperty') || callsFrom(relations, 'get_FlipProperty').length !== 0) {
      flipFailures += fail(
        'without FLIP: FlipProperty is `{ get; set; }` and must have a set_ accessor and a ' +
          'getter that calls nothing'
      );
    }
    // And the module KEY must differ, or two configurations of one file are
    // one row and the second silently overwrites the first.
    const modulesFlipped = flippedRelations.get('all-csharp-modules.csv');
    const keyOf = (rel: Relation | undefined): string =>
      rel?.rows.find((r) => (r[rel.header.indexOf('fileName')] ?? '').endsWith('Branches.cs'))?.[
        rel.header.length - 1
      ] ?? '';
    if (keyOf(modulesFlipped) === '' || keyOf(modulesFlipped) === moduleHash) {
      flipFailures += fail(
        'Branches.cs under FLIP has the same cs_module hash as without it. The define ' +
          'constants key is in the module PK for exactly this reason.'
      );
    }
    return flipFailures;
  });

  return failures;
}

/**
 * Every POSITIONAL child read in the extractors is declared, with the reason it
 * is safe.
 *
 * ## The defect class
 *
 * `namedChildren(node)[0]` is right exactly as long as the grammar happens to
 * put the thing wanted first. `this.Foo` exposes `this` through a FIELD as an
 * anonymous token, so position 0 was the METHOD NAME — 19,832 call sites in
 * linq-heavy-A reported the callee's own name as the receiver type. A named argument
 * puts its label first and `M(label: Scale(n))` dropped the call. A comment is
 * a named child and shifted every index after it.
 *
 * A sweep found ELEVEN more reads with a field available, each right only by
 * accident. All are fields now. What remains is exactly the set below, and each
 * entry says why position is the only thing the grammar offers there.
 *
 * ## Why a declared list and not a ban
 *
 * Three nodes genuinely have no field: a single-child wrapper has nothing to
 * name. Banning the pattern would force a worse read. Declaring it makes the
 * next one a NAMED failure with a reason to write, which is the same discipline
 * as `extractor-grammar-reads.json` one level down.
 */
const DECLARED_POSITIONAL_READS: ReadonlyMap<string, string> = new Map([
  // KEYED BY THE WHOLE CODE LINE, not by the read alone. Keyed by the read, one
  // declaration of `namedChildren(node)[0]` in a file vouched for EVERY
  // identical read in that file — and the full tally at 1a485ff found the
  // callee control (which mutates the callee into exactly that text) passing
  // the gate on the strength of the await operand's declaration.
  [
    'cs-type-parameter-extractor.ts: typeNode: namedChildren(constraint)[0] ?? constraint,',
    'a constraint wrapper holds one type and the grammar names no field on it; the ' +
      'fallback keeps the wrapper when there is no child at all',
  ],
  [
    'cs-attribute-extractor.ts: const valueNode = named === undefined ? namedChildren(node)[0] : named.valueNode;',
    '`attribute_argument` declares NO fields in node-types.json; a POSITIONAL attribute ' +
      'argument is exactly one expression, and the named forms are read structurally by ' +
      '`namedAttributeArgumentOf` before this line is reached',
  ],
  [
    'cs-misparse.ts: return namedChildren(pattern)[0];',
    '`constant_pattern` and `relational_pattern` declare NO fields at all in ' +
      'node-types.json — one is a bare expression, the other an operator token and an ' +
      'expression — so position is the only read the grammar offers, and `onlyExpressionOf` ' +
      'is the one place that reads it',
  ],
  [
    'cs-member-extractor.ts: typeNode: namedChildren(explicitInterface)[0],',
    '`explicit_interface_specifier` has exactly one named child and no field',
  ],
  [
    'cs-expression-extractor.ts: const operand = namedChildren(node)[0];',
    '`await_expression` has exactly one named child — its operand — and no field; ' +
      'read only for the non-async re-read (CS-ORACLE-1), in describeExpression and childrenWithRoles',
  ],
  [
    'cs-expression-extractor.ts: push(operand === undefined ? undefined : namedChildren(operand)[0], CsEdgeRole.RIGHT_OPERAND);',
    'the operand of a non-async `await` is a `prefix_unary_expression` with exactly one named child and no field',
  ],
  [
    'cs-expression-extractor.ts: push(operand === undefined ? undefined : namedChildren(operand)[0], CsEdgeRole.ARGUMENT);',
    'the operand of a non-async `await` is a `parenthesized_expression` with exactly one named child and no field',
  ],
  [
    'preproc-context.ts: const inner = namedChildren(node)[0];',
    '`parenthesized_expression` in the PREPROCESSOR grammar has exactly one child and ' +
      'no field — it is not the C# expression grammar',
  ],
]);


function positionalReadsAreDeclared(): number {
  let failures = 0;
  const dir = path.join('src', 'parsers', 'csharp', 'extractors');
  const pattern = /namedChildren\(([A-Za-z_.()'\[\]]+)\)\[(\d+)\]( \?\? \w+)?/g;
  let seen = 0;
  const undeclared: string[] = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.ts')) {
      continue;
    }
    const lines = fs.readFileSync(path.join(dir, file), 'utf-8').split('\n');
    lines.forEach((line, i) => {
      // Prose is not a read. Comments mention the pattern to explain it.
      const code = line.split('//')[0]!;
      if (code.trim().startsWith('*')) {
        return;
      }
      for (const match of code.matchAll(pattern)) {
        seen += 1;
        const key = `${file}: ${code.trim()}`;
        if (!DECLARED_POSITIONAL_READS.has(key)) {
          undeclared.push(`${file}:${i + 1}  ${match[0]}`);
        }
      }
    });
  }
  if (undeclared.length > 0) {
    failures += fail(
      `${undeclared.length} positional child read(s) are not declared:\n    ` +
        undeclared.join('\n    ') +
        '\n  If the node has a FIELD, read it. If it does not, declare the read with the ' +
        'reason position is all the grammar offers.'
    );
  }
  // Every declared read must still exist, or the list is documenting a ghost.
  for (const key of DECLARED_POSITIONAL_READS.keys()) {
    const colon = key.indexOf(': ');
    const file = key.slice(0, colon);
    const snippet = key.slice(colon + 2);
    const text = fs.readFileSync(path.join(dir, file), 'utf-8').split('\n').map((l) => l.split('//')[0]!.trim());
    if (!text.includes(snippet)) {
      failures += fail(`declared positional read no longer exists: ${key}`);
    }
  }
  // NEGATIVE CONTROL: the scanner must see the declared ones, or it is reading
  // nothing and "no undeclared reads" is trivially true.
  if (seen < DECLARED_POSITIONAL_READS.size) {
    failures += fail(
      `NEGATIVE CONTROL FAILED: the scanner saw ${seen} positional reads and ` +
        `${DECLARED_POSITIONAL_READS.size} are declared, so it is not reading the code.`
    );
  }
  return failures;
}

/**
 * The 32,767-character parse ceiling, and the workaround that every consumer
 * inherits from `CSharpParser`.
 *
 * ## Bytes are not characters, and the difference is the whole gate
 *
 * The limit is 32,767 CHARACTERS, by bisection. A gate that sized its input in
 * bytes would be wrong in both directions: 32,768 bytes of non-ASCII is fewer
 * characters and parses clean, so the must-fail input does not fail; and a
 * clean file measured in bytes can read as over the limit when it is not. The
 * generated fixture puts a non-ASCII character on every line so the two counts
 * disagree by thousands, and the assertion is stated in characters.
 *
 * ## What failing looks like
 *
 * Not an error. tree-sitter parses the first 32,767 characters and STOPS, with
 * a tree that is well-formed and short. Every type after the boundary is
 * simply absent, and a row count that does not know how many there should be
 * cannot see it. This gate knows.
 */
function parseCeiling(outputDir: string, corpusDir: string): number {
  let failures = 0;
  const source = fs.readFileSync(path.join(corpusDir, 'Large.cs'), 'utf-8');
  const characters = source.length;
  const bytes = Buffer.byteLength(source, 'utf-8');

  // The fixture must actually be past the limit in the unit that matters, and
  // its byte count must DISAGREE with its character count — or the gate is not
  // testing the confusion it exists to catch.
  if (characters <= TREE_SITTER_MAX_PARSE_CHARS) {
    failures += fail(
      `Large.cs is ${characters} characters, under the ${TREE_SITTER_MAX_PARSE_CHARS} ceiling — ` +
        'the fixture cannot exercise the boundary'
    );
  }
  if (bytes <= characters) {
    failures += fail(
      'NEGATIVE CONTROL FAILED: Large.cs has as many characters as bytes, so a gate ' +
        'measuring in the wrong unit would agree with one measuring in the right one'
    );
  }

  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const modules = relations.get('all-csharp-modules.csv');
  const types = relations.get('all-csharp-types.csv');
  if (modules === undefined || types === undefined) {
    return fail('a relation this check reads is missing');
  }
  const module = modules.rows.find((r) =>
    (r[modules.header.indexOf('fileName')] ?? '').endsWith('Large.cs')
  );
  if (module === undefined) {
    return fail('Large.cs produced no cs_module row');
  }
  const moduleHash = module[modules.header.length - 1]!;
  const names = new Set(
    types.rows
      .filter((r) => r[types.header.indexOf('csModuleLinkHash')] === moduleHash)
      .map((r) => r[types.header.indexOf('name')]!)
  );
  // EVERY type, not "some". The truncation is silent and leaves a well-formed
  // tree, so the only way to see it is to know how many there should be.
  if (names.size !== LARGE_FILE_TYPE_COUNT) {
    failures += fail(
      `${names.size} of ${LARGE_FILE_TYPE_COUNT} types emitted from a ${characters}-character ` +
        `(${bytes}-byte) file. tree-sitter parses the first ${TREE_SITTER_MAX_PARSE_CHARS} ` +
        'characters and STOPS — the rest of the file is silently absent from a tree that ' +
        'looks well-formed.'
    );
  }
  const last = `Généré${LARGE_FILE_TYPE_COUNT - 1}`;
  if (!names.has(last)) {
    failures += fail(`the LAST type in Large.cs (${last}) is missing — the tail was truncated`);
  }
  // And the module must say the file parsed CLEANLY. A truncated tree is not
  // an error tree, which is the whole reason this is dangerous.
  if (module[modules.header.indexOf('parseErrorCount')] !== '0') {
    failures += fail('Large.cs reports parse errors; the ceiling should be invisible to it');
  }
  return failures;
}

/**
 * Extraction is LINEAR in statements per method body.
 *
 * ## The defect this exists to prevent
 *
 * CS-CORPUS-16. Three full walks of the body were computed inside a helper
 * that ran once per statement root, so a body of N statements walked itself 3N
 * times. cs-corpus measured it — 250 statements 39 s, 500 statements 163 s,
 * 1,000 killed, against 2,000 in 13 s on the commit before — and it blocked
 * the whole sweep, because linq-heavy-A's generated baselines hold methods of that
 * size and linq-heavy-A is 65% of the corpus's call sites.
 *
 * A verification trimmed to fit the memory the box had left did not see it,
 * because it trimmed out exactly the files that exhaust memory. A check sized
 * to pass is a check incapable of failing, at the corpus level.
 *
 * ## Why NODE VISITS and not wall clock — CS-ORACLE-5
 *
 * This check used a ratio of two wall-clock timings, and that ratio is a
 * fraction whose DENOMINATOR is the noisy term. Measured twice on one commit,
 * minutes apart, on a busy machine:
 *
 *     run 1   500 statements 0.73 s, 2000 statements 6.39 s   ratio 8.8  FAIL
 *     run 2   500 statements 2.61 s, 2000 statements 4.22 s   ratio 1.6  PASS
 *
 * The 500-statement baseline swung 3.6× for identical input. The false FAILURE
 * is the harmless direction — it is loud and gets re-run. The dangerous one is
 * that an INFLATED baseline SHRINKS the ratio, so a genuinely quadratic
 * extractor on a loaded machine reports a small ratio and goes GREEN. The check
 * guarding the regression that once killed a corpus sweep would have hidden it,
 * under exactly the conditions a corpus sweep runs under.
 *
 * So this counts WORK, not time. Every accessor on tree-sitter's shared
 * SyntaxNode prototype is wrapped with a counter for the duration of the check,
 * and the number of node accesses is a pure function of the algorithm and the
 * input: 573,525 at 500 statements and 2,288,025 at 2,000, IDENTICAL on repeat,
 * and identical on any machine. Linear is ×3.99; quadratic would be ~×16.
 *
 * The counter is verified every run — the same size is measured twice and must
 * agree — and if the prototype cannot be instrumented the check reports
 * INCONCLUSIVE and FAILS. An inconclusive is honest; a machine-dependent pass
 * is not. Wall clock is still printed, and is no longer the verdict.
 *
 * ## Do not revert this to wall clock for convenience
 *
 * Determinism buys more than a trustworthy verdict. It makes a NULL RESULT
 * LEGIBLE AS NULL rather than as noise, and that is what caught the first
 * attempt to prove this check can fail.
 *
 * That attempt reintroduced CS-CORPUS-16's shape into the `Array.isArray(body)`
 * branch of the statement walker — a branch this fixture never takes. The count
 * changed by ZERO visits. Not by a little: by nothing, byte-identical to the
 * clean run, which is only possible if the mutated code never ran. A control
 * that controls nothing, and it was unmistakable at a glance.
 *
 * Under the old timing measure the same mistake would have produced a plausible
 * small wobble — 0.19 s against 0.17 s — and been believed. A measure that
 * cannot distinguish "no effect" from "small effect" cannot validate its own
 * negative control, and a check whose negative control is unverifiable is a
 * check that will pass against a defect exactly once, in the run that matters.
 */

function linearInStatements(): number {
  let failures = 0;
  const generate = (n: number): string => {
    const lines = ['using System;', 'class C {', '  static int F(int x) => x;', '  void M() {'];
    for (let i = 0; i < n; i += 1) {
      lines.push(`    var v${i} = F(${i});`);
    }
    lines.push('  }', '}');
    return lines.join('\n');
  };

  // Wrap every accessor on the SHARED SyntaxNode prototype, and RESTORE them
  // afterwards: leaving 49 counting wrappers installed would tax every other
  // check in the suite and make this one's cost everyone else's.
  // Through CSharpParser, not a bare tree-sitter Parser: it is the path the
  // extractor itself takes, and it keeps the grammar import where grammar-gate
  // can police it.
  const proto = Object.getPrototypeOf(
    Object.getPrototypeOf(new CSharpParser().parse('class A{}').rootNode)
  ) as Record<string, unknown>;
  const saved = new Map<string, PropertyDescriptor>();
  let visits = 0;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor') continue;
    const d = Object.getOwnPropertyDescriptor(proto, key);
    if (!d || !d.configurable) continue;
    if (d.get) {
      const g = d.get;
      saved.set(key, d);
      Object.defineProperty(proto, key, { ...d, get(this: unknown) { visits += 1; return g.call(this); } });
    } else if (typeof d.value === 'function') {
      const f = d.value as (...a: unknown[]) => unknown;
      saved.set(key, d);
      Object.defineProperty(proto, key, {
        ...d,
        value(this: unknown, ...a: unknown[]) { visits += 1; return f.apply(this, a); },
      });
    }
  }
  const restore = (): void => {
    for (const [k, d] of saved) Object.defineProperty(proto, k, d);
  };

  const extractor = new CsFactExtractor();
  const measure = (n: number): { visits: number; seconds: number; calls: number } => {
    const source = generate(n);
    visits = 0;
    const started = process.hrtime.bigint();
    const facts = extractor.extractFile({
      absoluteFilePath: '/t/Scaling.cs',
      filePath: 'Scaling.cs',
      baseMservPath: '/t',
      sourceText: source,
      serviceVersionLinkHash: 'SV',
      context: {
        targetFramework: 'net8.0',
        defineConstantsKey: 'k',
        langVersion: '13.0',
        nullableContextDefault: CsNullableContext.ENABLE,
        projectPath: '',
        assemblyName: '',
        implicitUsingsEnabled: false,
      },
      defineConstants: [],
      implicitUsings: [],
    });
    return {
      visits,
      seconds: Number(process.hrtime.bigint() - started) / 1e9,
      calls: facts.callSites.length,
    };
  };

  try {
    measure(100);
    const small = measure(500);
    const smallAgain = measure(500);
    const large = measure(2000);

    // THE INSTRUMENT IS CHECKED EVERY RUN. If the counter never moved, the
    // prototype was not instrumented and a ratio computed from it would be
    // meaningless — which is the failure this check was rewritten to escape.
    if (saved.size === 0 || small.visits === 0) {
      failures += fail(
        `INCONCLUSIVE: ${saved.size} accessors instrumented, ${small.visits} node visits counted. ` +
          'Without a work counter this check cannot distinguish linear from quadratic, and a ' +
          'PASS would mean only that it ran. An inconclusive is honest; a machine-dependent ' +
          'pass is not.'
      );
      return failures;
    }
    // Determinism of the counter itself: identical input, identical count.
    if (small.visits !== smallAgain.visits) {
      failures += fail(
        `INCONCLUSIVE: the same 500-statement input counted ${small.visits} then ` +
          `${smallAgain.visits} node visits. The work counter is not deterministic, so the ` +
          'ratio below is not either.'
      );
      return failures;
    }

    if (small.calls !== 500 || large.calls !== 2000) {
      failures += fail(
        `NEGATIVE CONTROL FAILED: ${small.calls} and ${large.calls} call sites from 500 and ` +
          '2000 statements. A run that skipped the work would also be cheap.'
      );
    }

    const ratio = large.visits / small.visits;
    console.log(
      `  500 statements ${small.visits.toLocaleString()} node visits, ` +
        `2000 statements ${large.visits.toLocaleString()} — ×${ratio.toFixed(2)} for ×4 the input`
    );
    console.log(
      `  (wall clock ${small.seconds.toFixed(2)} s and ${large.seconds.toFixed(2)} s — reported, ` +
        'NOT the verdict: see CS-ORACLE-5)'
    );
    if (ratio > 8) {
      failures += fail(
        `4× the statements cost ×${ratio.toFixed(2)} the NODE VISITS. Linear is ×4, quadratic ` +
          `is ~×16. Something is walking the whole body once per statement. ` +
          `(${small.visits.toLocaleString()} -> ${large.visits.toLocaleString()})`
      );
    }
    // An absolute ceiling as well as a ratio, so an extractor that is linear but
    // uniformly wasteful cannot pass by scaling politely. Measured: 2,288,025.
    if (large.visits > 6_000_000) {
      failures += fail(
        `2000 statements cost ${large.visits.toLocaleString()} node visits; the measured ` +
          'value is 2,288,025. Linear, but doing several times the work it did.'
      );
    }
    return failures;
  } finally {
    restore();
  }
}

/**
 * The four shapes ADJUDICATED against Roslyn, out of process.
 *
 * Every assertion here has an oracle answer behind it: a Roslyn console app
 * in the scratchpad classified every bare-name invocation and every member in
 * cs-corpus's 340-file tree, and the parser disagreed on six calls. Three were
 * local functions calling themselves or a sibling, two were value bindings the
 * delegate lookup did not consult, one was the grammar mis-parsing a lambda
 * with in/out parameters (a parse gap, not an extractor miss). Members agreed
 * 2,111 of 2,111 there — the property-from-a-split-method shape (CS-CORPUS-15)
 * needed a real file to reproduce, and it is in the fixture now.
 */
function adjudicatedShapes(outputDir: string): number {
  let failures = 0;
  const relations = new Map(readRelations(outputDir).map((r) => [r.name, r]));
  const callSites = relations.get('all-csharp-call-sites.csv');
  const methods = relations.get('all-csharp-methods.csv');
  const properties = relations.get('all-csharp-properties.csv');
  const modules = relations.get('all-csharp-modules.csv');
  const gaps = relations.get('all-csharp-parse-gaps.csv');
  if (
    callSites === undefined ||
    methods === undefined ||
    properties === undefined ||
    modules === undefined ||
    gaps === undefined
  ) {
    return fail('a relation this check reads is missing');
  }
  const c = (n: string): number => callSites.header.indexOf(n);
  const me = (n: string): number => methods.header.indexOf(n);
  const module = modules.rows.find((r) =>
    (r[modules.header.indexOf('fileName')] ?? '').endsWith('Adjudicated.cs')
  );
  if (module === undefined) {
    return fail('Adjudicated.cs produced no cs_module row');
  }
  const moduleHash = module[modules.header.length - 1]!;
  const calls = callSites.rows.filter((r) => r[c('csModuleLinkHash')] === moduleHash);
  const kindsOf = (name: string): string[] =>
    calls.filter((r) => r[c('calleeName')] === name).map((r) => r[c('callKind')]!);

  // NEGATIVE CONTROL: the file must have produced calls to look at.
  if (calls.length < 8) {
    return fail(`NEGATIVE CONTROL FAILED: ${calls.length} call sites from Adjudicated.cs`);
  }

  // Local functions: itself and a sibling.
  for (const name of ['Factorial', 'IsEven', 'IsOdd']) {
    const kinds = kindsOf(name);
    if (kinds.length === 0 || kinds.some((k) => k !== 'LOCAL_FUNCTION_CALL')) {
      failures += fail(
        `${name}() is ${kinds.join('/') || 'absent'}; Roslyn says LOCAL_FUNCTION_CALL on every ` +
          'call, including the recursive one and the one from a sibling local function'
      );
    }
  }
  // Value bindings the delegate lookup must consult: a pattern binding, a
  // lambda parameter, a local.
  for (const name of ['act', 'g', 'applyLambda', 'f']) {
    const kinds = kindsOf(name);
    if (kinds.length === 0 || kinds.some((k) => k !== 'DELEGATE_INVOKE')) {
      failures += fail(
        `${name}() is ${kinds.join('/') || 'absent'}; Roslyn says DELEGATE_INVOKE — it names ` +
          'a VALUE, and a value that is invoked is a delegate or the program does not compile'
      );
    }
  }
  // THE MISS. A name declared nowhere stays on the don't-know terminal.
  const unknown = kindsOf('NotDeclaredAnywhere');
  if (unknown.length !== 1 || unknown[0] !== 'FUNCTION_CALL') {
    failures += fail(
      `NotDeclaredAnywhere() is ${unknown.join('/') || 'absent'}, expected FUNCTION_CALL. A ` +
        'lookup miss is DON`T KNOW, and the terminal for don`t-know is never a positive claim — ' +
        '25 ordinary methods were once labelled delegate invokes this way.'
    );
  }
  // And a method on the type is a FUNCTION_CALL, never a delegate.
  if (kindsOf('Native').some((k) => k !== 'FUNCTION_CALL')) {
    failures += fail('Native(), a method on the type, is not FUNCTION_CALL');
  }

  // SCOPE. Five calls to GetOrAdd: Roslyn binds the two INSIDE the declaring
  // block to the local function and the three outside it — before, in the
  // sibling block, after — to the static method. A set of "every local
  // function anywhere in the body" made all five LOCAL_FUNCTION_CALL, which
  // cs-corpus measured as 69 ordinary static-method calls mis-kinded in one
  // stratum. The ORDER of the five is the order in the file.
  const getOrAdd = calls
    .filter((r) => r[c('calleeName')] === 'GetOrAdd')
    .sort((x, y) => Number(x[c('startLine')]) - Number(y[c('startLine')]))
    .map((r) => r[c('callKind')]);
  const expectedGetOrAdd = [
    'FUNCTION_CALL',
    'LOCAL_FUNCTION_CALL',
    'LOCAL_FUNCTION_CALL',
    'FUNCTION_CALL',
    'FUNCTION_CALL',
  ];
  if (getOrAdd.join(',') !== expectedGetOrAdd.join(',')) {
    failures += fail(
      `the five GetOrAdd calls are [${getOrAdd.join(', ')}], Roslyn says ` +
        `[${expectedGetOrAdd.join(', ')}]. A local function is in scope in its declaring ` +
        'block and below it, not in a sibling block and not before or after the block.'
    );
  }
  // A lambda CAPTURES: the local `scale` and the local function `Helper` are
  // both visible inside `n => scale(n) + Helper(n)`, and each call is what
  // Roslyn says it is. An empty scope for the lambda's body filed both as
  // FUNCTION_CALL — a lookup miss reported as a positive claim.
  if (kindsOf('scale').join(',') !== 'DELEGATE_INVOKE') {
    failures += fail(
      `scale() inside a lambda is ${kindsOf('scale').join('/') || 'absent'}; Roslyn says ` +
        'DELEGATE_INVOKE — a captured local holding a delegate'
    );
  }
  if (kindsOf('Helper').join(',') !== 'LOCAL_FUNCTION_CALL') {
    failures += fail(
      `Helper() inside a lambda is ${kindsOf('Helper').join('/') || 'absent'}; Roslyn says ` +
        'LOCAL_FUNCTION_CALL — declared in the block the lambda sits in'
    );
  }

  // THE SPLIT ARROW BODY — `M()\n#if X\n => a;\n#else\n => b;\n#endif`.
  //
  // Upstream's grammar recovered it as a property with an ERROR child and a
  // method named by the next keyword, and the parser withheld both as
  // recovery debris: a wrong kind that had become a lost declaration
  // (CS-CORPUS-15, sweep 4). The fork's `preproc_if_in_function_body` rule
  // parses it as one method with a body per branch, and the body READ is the
  // branch this emission takes. Roslyn says: an ordinary method named
  // GetDefaultMessage. So does this.
  const mine = methods.rows.filter((r) => r[me('csModuleLinkHash')] === moduleHash);
  const names = new Set(mine.map((r) => r[me('name')]));
  const phantomProperty = properties.rows.some(
    (r) =>
      r[properties.header.indexOf('csModuleLinkHash')] === moduleHash &&
      r[properties.header.indexOf('name')] === 'GetDefaultMessage'
  );
  if (phantomProperty || names.has('get_GetDefaultMessage')) {
    failures += fail(
      'a method whose arrow body is split by a #if was emitted as a PROPERTY with a ' +
        'get_GetDefaultMessage accessor. Roslyn says ordinary method.'
    );
  }
  if (names.has('public')) {
    failures += fail('a method named `public` was emitted — recovery debris given a kind');
  }
  const split = mine.find((r) => r[me('name')] === 'GetDefaultMessage');
  if (split === undefined) {
    failures += fail(
      'GetDefaultMessage, whose arrow body is split by a #if, has no cs_method row. The ' +
        "fork's grammar parses this shape; a missing row means the body lookup did not " +
        'look through the preproc_if.'
    );
  } else {
    if (split[me('methodKind')] !== 'METHOD' || split[me('bodyKind')] !== 'EXPRESSION') {
      failures += fail(
        `GetDefaultMessage is ${split[me('methodKind')]}/${split[me('bodyKind')]}, expected ` +
          'METHOD/EXPRESSION — the body under the ACTIVE branch is an arrow clause'
      );
    }
    // CORECLR is not defined for this emission, so the `#else` body is the
    // one in the program: a string literal, and NO call to Native from it.
    const splitHash = split[methods.header.length - 1]!;
    const callsFromSplit = calls.filter((r) => r[c('callerMethodLinkHash')] === splitHash);
    if (callsFromSplit.length !== 0) {
      failures += fail(
        `GetDefaultMessage's body made ${callsFromSplit.length} call(s) — the #if CORECLR ` +
          'branch is not the one this emission takes, and `Native()` is not in the program'
      );
    }
  }
  // No parse gap: the shape parses clean now, and a gap row here would say
  // the grammar had regressed.
  const myGaps = gaps.rows.filter(
    (r) => r[gaps.header.indexOf('csModuleLinkHash')] === moduleHash
  );
  if (myGaps.length !== 0) {
    failures += fail(
      `Adjudicated.cs produced ${myGaps.length} parse-gap row(s); the split arrow body is ` +
        "a clean parse under the fork's grammar"
    );
  }
  // And the members with INTACT headers around it survive.
  for (const name of ['Recursion', 'Bindings', 'Unknown', 'Native']) {
    if (!names.has(name)) {
      failures += fail(`${name} has an intact header and was not emitted`);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sampleModule(): CsModuleRegistry {
  return new CsModuleRegistry({
    name: 'S',
    qualifiedName: 'S.cs',
    fileName: 'S.cs',
    filePath: 'S.cs',
    baseMservPath: '/r',
    targetFramework: 'net8.0',
    defineConstantsKey: '',
    langVersion: '13.0',
    emissionRegime: CSHARP_EMISSION_REGIME,
    grammarRegime: CSHARP_GRAMMAR_REGIME,
    startLine: 1,
    serviceVersionLinkHash: 'SV',
  });
}

function sampleType(moduleHash: string): CsTypeRegistry {
  return new CsTypeRegistry({
    name: 'S',
    qualifiedName: 'S',
    arity: 0,
    typeCategory: CsTypeCategory.CLASS,
    typeAccess: CsTypeAccess.PUBLIC,
    typeModifiers: new Set([CsTypeModifier.PUBLIC]),
    typePlacement: CsTypePlacement.TOP_LEVEL,
    declarationScopeKey: 'NS:',
    declarationGroupKey: 'CS_DECLARATION_GROUP_x',
    isPartial: false,
    isStatic: false,
    isAbstract: false,
    isSealed: false,
    isReadOnly: false,
    isRefLikeStruct: false,
    isFileLocal: false,
    isRecord: false,
    hasPrimaryConstructor: false,
    primaryConstructorArity: 0,
    nullableContext: CsNullableContext.ENABLE,
    csModuleLinkHash: moduleHash,
    containingTypeLinkHash: '',
    csNamespaceName: '',
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    serviceVersionLinkHash: 'SV',
  });
}

function digestOf(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function digestDirectory(dir: string): Map<string, string> {
  const digests = new Map<string, string>();
  for (const file of fs.readdirSync(dir).sort()) {
    digests.set(file, digestOf(fs.readFileSync(path.join(dir, file), 'utf-8')));
  }
  return digests;
}

async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cs-gate-'));
  try {
    return await work(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const corpusDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cs-corpus-'));
  const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cs-out-'));
  // The SECOND corpus. See COVERAGE_CORPUS_DIR.
  const coverageOutputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cs-cov-out-'));
  let coverageDir: string | undefined;

  try {
    await writeCorpus(corpusDir);

    const CHECKS: Check[] = [
      {
        name: 'grammar gate',
        proves:
          'the installed grammar is the patched fork, AND the gate that says so can fail — ' +
          'the wrong grammar costs 6.44% of declarations and throws nothing',
        run: grammarGate,
      },
      {
        name: 'grammar reads exist',
        proves:
          'every (nodeType, accessor, name) the extractors read is something this grammar ' +
          'actually produces — a read that names a node type the grammar does not have ' +
          'returns null, never throws, and empties a column in silence',
        run: grammarReadExistence,
      },
      {
        name: 'positional reads are declared',
        proves:
          'every `namedChildren(x)[n]` in the extractors is on a list with the reason ' +
          'position is all the grammar offers there — a read that is right only because ' +
          'of what the grammar happens to put first is the `this.Foo` defect waiting for ' +
          'its input, and a sweep found eleven of them with a field available',
        run: positionalReadsAreDeclared,
      },
      {
        name: 'parse ceiling',
        proves:
          'a file past the 32,767-CHARACTER ceiling — not bytes, and the fixture makes the two ' +
          'disagree — is parsed to its last declaration through the callback path, because ' +
          'the failure mode is a well-formed tree that silently stops',
        run: () => parseCeiling(outputDir, corpusDir),
      },
      {
        name: 'linear in statements per body',
        proves:
          '4× the statements in one method costs ~4× the NODE VISITS and not ~16× — three ' +
          'full walks of the body once per statement root made a 1,000-statement method take ' +
          'minutes and blocked the whole corpus sweep. Work, not wall clock: the timing ratio ' +
          'this replaced read 8.8 then 1.6 on one commit, and its noisy term was the ' +
          'DENOMINATOR, so a loaded machine made a quadratic extractor look linear',
        run: linearInStatements,
      },
      {
        name: 'the schema chain holds',
        proves:
          'the document agrees with itself and the generated Souffle declarations match it. C# ' +
          'had NO decls_base_cs.dl while python, typescript and javascript each had one — the ' +
          'engine had nothing to declare C# relations with, and nothing tied the frozen schema ' +
          'to the code',
        run: () => theSchemaChainHolds(),
      },
      {
        name: 'emitted headers match the schema document',
        proves:
          'all 22 relations emit exactly the columns schema.json declares, in that ' +
          'order, read through gen_decls.py so the schema has ONE parser. `arity contract` ' +
          'compared two registries against their own ARITY constant and twenty against nothing',
        run: () => emittedHeadersMatchTheSchema(outputDir),
      },
      {
        name: 'arity contract',
        proves:
          'every relation emits exactly the columns its schema declares, and joinRow refuses ' +
          'a row of the wrong width — a shifted column loads into Souffle without error',
        run: arityContract,
      },
      {
        name: 'PK uniqueness',
        proves: 'no primary key repeats. Duplicates do not collide, they DOUBLE',
        run: () => pkUniqueness(outputDir),
      },
      {
        name: 'spans nest',
        proves:
          "every expression's span is inside its parent expression's and every block's inside its " +
          "parent block's; no INITIALIZER has a CAST parent; no OBJECT_CREATION ends on an identifier " +
          'character — the last two are impossible in valid C# and are what discriminated CS-CORPUS-22',
        run: () => spansNest(outputDir),
      },
      {
        name: 'FK integrity',
        proves:
          'every entity-shaped value resolves to a row that declares it, with the relation ' +
          'list derived from the output directory rather than a hand-maintained array',
        run: () => fkIntegrity(outputDir),
      },
      {
        name: 'determinism',
        proves: 'two runs, byte-identical',
        run: () => determinism(corpusDir),
      },
      {
        name: 'partial grouping',
        proves:
          'N parts of one type share one group key and keep distinct PKs, arity separates ' +
          'same-named types, a SINGLE-part group is normal, and two `file class C` do not merge',
        run: () => partialGrouping(outputDir),
      },
      {
        name: 'IR completeness',
        proves:
          'for every construct, every hop an ENGINE would need is present — the measure ' +
          'that replaces resolution rate, because the parser emits IR and the engine ' +
          'resolves',
        run: () => irCompleteness(outputDir),
      },
      {
        name: 'blocks and locals',
        proves:
          'scope is a relation and not an inference: five of the nine declaration kinds ' +
          'bind inside an expression, `ref` is dataflow rather than spelling, a callback`s ' +
          'locals belong to the callback, and a catch names both what it stops and the try ' +
          'it guards',
        run: () => blocksAndVariables(outputDir),
      },
      {
        name: 'attributes and comments',
        proves:
          'an attribute is inert metadata whose ARGUMENTS carry the edges: `[A, B]` is two ' +
          'attributes and not one bracket group, a target changes what it attaches to, ' +
          '`[assembly:]` is owned by the file because nothing else can hold it, and ' +
          '`typeof(X)` names a type that a framework instantiates from a stack no source ' +
          'file contains',
        run: () => attributesAndComments(outputDir),
      },
      {
        name: 'branch selection in every position',
        proves:
          'the taken branch is emitted and the untaken one is NOT, in all seven positions — ' +
          'a type, a member, a field, an enum member, a call, a local and a block. The old ' +
          'check tested types only, which were correct all along, while every body resolved ' +
          'its `#if` against an EMPTY symbol set and took the `#else` every time',
        run: () => branchSelection(outputDir, corpusDir),
      },
      {
        name: 'adjudicated shapes',
        proves:
          'the four shapes Roslyn ruled on out of process: a local function calling itself ' +
          'or a sibling is LOCAL_FUNCTION_CALL, an invoked pattern binding or lambda ' +
          'parameter is DELEGATE_INVOKE, a name declared nowhere stays FUNCTION_CALL because ' +
          'a lookup miss is don`t-know, and a method whose header is recovery debris gets NO ' +
          'kind rather than the wrong one',
        run: () => adjudicatedShapes(outputDir),
      },
      {
        name: 'expression spine',
        proves:
          'one wrapper with parented children and the variant in a column, surviving two ' +
          'on one line; += on an event is a SUBSCRIPTION; a parenthesis emits a row so its ' +
          'subtree survives; a lambda body belongs to the lambda; and 1:1 with call sites',
        run: () => expressionSpine(outputDir),
      },
      {
        name: 'csharp utils',
        proves:
          'the pure functions three extractors share behave as documented — asserted ' +
          'directly, because a row-based check passes whenever the corpus lacks the shape',
        run: csharpUtils,
      },
      {
        name: 'identifier normalisation',
        proves:
          '@class IS class and \\u0041bc IS Abc — one name to the compiler must be one name ' +
          'here, on both sides of every join, or a use looks like a reference to something ' +
          'undeclared',
        run: () => identifierNormalisation(outputDir),
      },
      {
        name: 'fields and enum members',
        proves:
          '`int a, b;` is two rows with distinct keys, one type reference between them, ' +
          'const is implicitly static, and a COMPUTED enum value is left to the engine',
        run: () => fieldsAndEnumMembers(outputDir),
      },
      {
        name: 'using forms',
        proves:
          'all four forms including the one that appears in NO file, no using from an ' +
          'inactive #if branch, and a `using` statement is not an import',
        run: () => usingForms(outputDir),
      },
      {
        name: 'parse gaps are rows',
        proves:
          'the 3.01% that fails to parse is queryable rather than anecdotal, bucketed by ' +
          'thresholds validated against Roslyn as monotonic',
        run: () => parseGapsAreRows(outputDir, corpusDir),
      },
      {
        name: 'type-reference tree',
        proves:
          'nested generics keep their structure because C# reifies them, the four shapes ' +
          'with a column produce no wrapper, and the three without produce children',
        run: () => typeReferenceTree(outputDir),
      },
      {
        name: 'accessor 1:1',
        proves:
          'every declared accessor has exactly one cs_method row and every accessor row ' +
          'has a resolving owner — the place duplicates are most likely, and duplicates ' +
          'DOUBLE rather than collide',
        run: () => accessorOneToOne(outputDir),
      },
      {
        name: 'member semantics',
        proves:
          'the member facts that are wrong in a COLUMN rather than missing a row: an ' +
          'expression-bodied getter with no `get` token, init vs set, an interface ' +
          'member defaulting to public, out as a second return channel, params flattened ' +
          'out of its parameter node, and scoped in two shapes',
        run: () => memberSemantics(outputDir),
      },
      {
        name: 'heritage and generics',
        proves:
          'a class base list is BASE_OR_INTERFACE because C# has no `extends`, a struct or ' +
          'interface list is INTERFACE_ONLY because the LANGUAGE decides, variance is read ' +
          'from anonymous tokens, and constraints are matched by name not position',
        run: () => heritageAndGenerics(outputDir),
      },
      {
        name: '#if branch selection',
        proves: 'no row comes from a branch this emission did not take',
        run: () => preprocBranchSelection(outputDir),
      },
      {
        name: 'a collection expression is not an index',
        proves:
          'the published grammar has NO collection_expression rule, so every `[…]` arrived as ' +
          'an element_binding_expression — an index access the source does not contain, with ' +
          'the elements as INDEX_ARGUMENTs and `[]` adding a reference to the empty name. ' +
          'Asserted in seven forms, with the four legal index accesses in the same file ' +
          'unchanged, because a repair that took those would be the worse defect',
        run: () => aCollectionExpressionIsNotAnIndex(),
      },
      {
        name: 'no preproc node survives the pre-parse pass',
        proves:
          'blanking makes branch selection a property of the TEXT rather than a check on the ' +
          'output: the untaken arm is not there to read. Asserted over the gate corpus and all ' +
          '305 category fixtures, with the four non-conditional survivors — #region, ' +
          '#endregion, #nullable, #pragma — as an allowlist. Twelve negative controls died of ' +
          'this property, each mutating a tree-based branch resolver that nothing can reach',
        run: () => noPreprocNodeSurvives(),
      },
      {
        name: 'a call is not a lambda',
        proves:
          '`AssertQuery(async, ss => …)` is a CALL, and the grammar reads it as a lambda whose ' +
          'parameters are the call`s arguments — the enclosing method`s own `bool async` among ' +
          'them. 4,783 sites in linq-heavy. The call comes back with its argument count, no lambda ' +
          'carries `async` as a parameter, the real lambda keeps its own, and the same call ' +
          'with a first argument that is not a contextual keyword is unchanged',
        run: () => aCallIsNotALambda(),
      },
      {
        name: 'a pragma at the end is not a gap',
        proves:
          'a `#pragma` on the last line of a file with NO trailing newline makes the ' +
          '`preproc_pragma` node report hasError on itself, so the gap fallback named it as ' +
          'the file`s defect — 23 of the 945 files in multitarget-A, every one of them complete. A ' +
          'trailing newline moves no position, and the fixture is written without one',
        run: () => aPragmaAtTheEndIsNotAGap(),
      },
      {
        name: 'ref is not always last',
        proves:
          'C# allows any modifier order and the grammar takes `ref` only as the last one, so ' +
          '`ref partial struct` loses the WHOLE TYPE with every member in it — 30 of them ' +
          'across two codebases. The pre-parse rotation is the same tokens and the same ' +
          'length, asserted with the modifier SET intact and with a `ref` return and a `ref` ' +
          'local in the same file that it must not touch',
        run: () => refIsNotAlwaysLast(),
      },
      {
        name: 'a top-level statement precedes every declaration',
        proves:
          'C# requires top-level statements to come before every namespace and type in their ' +
          'file, so a global statement that FOLLOWS one is recovery debris — three library ' +
          'files were flagged as top-level programs because the recovery had ejected METHOD ' +
          'declarations past a class. Asserted with the real form in the same run, and with ' +
          'cs_module.hasTopLevelStatements against the `<Main>$` row, because that column was a ' +
          'third reading of the question and disagreed with the other two',
        run: () => aTopLevelStatementPrecedesEveryDeclaration(),
      },
      {
        name: 'a semicolon is a body',
        proves:
          'C# 12`s `class C;` is a type. The published grammar has no rule for it and its ' +
          'recovery MERGES every such declaration in a file into one type named after the ' +
          'last of them, taking the next real body as its own — so eleven types came out as ' +
          'four, three of them under another type`s name, with a `<Main>$` and a `Program` ' +
          'invented from the stranded semicolon',
        run: () => aSemicolonIsABody(),
      },
      {
        name: 'a define is its symbol, not its line',
        proves:
          'a `#define` with a trailing comment defines the SYMBOL — it was filed under the ' +
          'whole line, matched no #if, and every branch it guarded silently took the other arm ' +
          'with no error and no lost row',
        run: () => aDefineIsItsSymbolNotItsLine(),
      },
      {
        name: 'a call site sits where its expression does',
        proves:
          'every call site occupies its own expression row`s position — they are a 1:1 chain ' +
          'and took their spans from different places, so a #if-guarded chain segment put them ' +
          'three lines apart with no row lost and no count moved',
        run: () => aCallSiteSitsWhereItsExpressionDoes(outputDir),
      },
      {
        name: 'a directive is not part of the declaration',
        proves:
          'a declaration starts at its first attribute or modifier, never at a `#if` guarding ' +
          'them — and attributeCount resolves the branch the same way the attribute emitter ' +
          'does, which it did not',
        run: () => aDirectiveIsNotPartOfTheDeclaration(),
      },
      {
        name: 'no phantom locals from a ref-returning assignment',
        proves:
          'a misparsed `Local(x) = v` mints no local per call argument, AND every legitimate ' +
          'declaration is untouched — the second half is what stops the repair deleting every ' +
          'deconstruction in the corpus',
        run: () => noPhantomLocalsFromARefReturningAssignment(outputDir),
      },
      {
        name: 'every category fixture is asserted',
        proves:
          '305 fixtures across 32 categories parse through the shipped pipeline and produce ' +
          'rows — they were read for enum coverage alone, so a fixture could stop parsing and ' +
          'the only symptom would be an enum value going unobserved somewhere else',
        run: () => everyCategoryFixtureIsAsserted(),
      },
      {
        name: 'the torture corpus still bites',
        proves:
          'one fixture per shape the published grammar gets wrong, and an assertion per ' +
          'fixture that it still gets it wrong in the way recorded — an ERROR shape must emit ' +
          'a parse gap, a MISPARSE shape must still lack the node a correct parse yields',
        run: () => theTortureCorpusStillBites(),
      },
      {
        name: 'C# 14 extension members are emitted',
        proves:
          'a flattened extension block yields its instance method, its instance PROPERTY with ' +
          'cs_property.isExtension, and the receiver as parameter 0 of the accessor — the ' +
          'members were SILENTLY absent, 0 rows where 3 belong, and no phantom constructor',
        run: () => extensionMembersAreEmitted(),
      },
      {
        name: 'an unreadable extension block leaves the file alone',
        proves:
          'a file with one readable block and one the recovery does not present cleanly is ' +
          'left ENTIRELY alone rather than partly rewritten — a partial rewrite loses a ' +
          'member the file declares, and the gap relation still reports the file',
        run: () => anUnreadableExtensionBlockLeavesTheFileAlone(),
      },
      {
        name: 'a delegate is named by its name field',
        proves:
          'all seven return-type shapes name the DELEGATE and not the return type — five of ' +
          'them never collided, which is why 25 of 27 delegates in a real project were right ' +
          'and the name in the primary key was still wrong',
        run: () => delegatesAreNamedByTheirNameField(outputDir),
      },
      {
        name: 'an accessor owns its attributes',
        proves:
          'an accessor`s own attributes are emitted and attributed to the ACCESSOR — they were ' +
          'absent entirely, and attributeCount said 0, so two counts agreed because neither was ' +
          'taken',
        run: () => accessorAttributesAreEmitted(outputDir),
      },
      {
        name: 'an array length is walked',
        proves:
          'every call inside `new byte[Len(n)]` is reached — the length hangs under the ' +
          'creation`s TYPE, a type is not an expression, and the rank specifier died whole ' +
          'while the creation`s own row and its type reference stayed correct',
        run: () => arrayLengthsAreWalked(outputDir),
      },
      {
        name: 'a BOM is not a character',
        proves:
          'a leading UTF-8 BOM moves no column — asserted on a same-length PAIR and against ' +
          'the absolute position in the source, because a corpus four-fifths BOM-marked looks ' +
          'healthy while every line-1 column in it is one too far right',
        run: () => bomIsNotACharacter(outputDir),
      },
      {
        name: 'async as an identifier',
        proves:
          'the declaration is still THERE, not merely that the parser did not throw',
        run: () => asyncIdentifierRows(outputDir),
      },
      {
        name: 'enum emission audit',
        proves:
          'every declared value is emitted or reserved with a reason, and a reserved value ' +
          'switching on is a NAMED failure — a right row with the wrong kind is invisible ' +
          'to every count-based check there is',
        run: () => enumEmissionAudit(outputDir, coverageDir),
      },
      {
        name: 'registered front end',
        proves:
          'the factory yields the C# parser for .cs and CSHARP, the detector claims a .csproj ' +
          'directory and a bare directory of .cs files and refuses an empty one and a directory ' +
          'that merely CONTAINS C# two levels down, and the package entry point scans a fixture ' +
          'project and writes its 22 relations — registered after convergence, not before',
        run: () => registeredFrontEnd(),
      },
      {
        name: 'every link column is written',
        proves:
          'every column that names another row is non-empty on at least one row of the gate ' +
          'corpus, or is listed with the reason it is not — five links were declared, documented ' +
          'and empty on every row because a gate READ the column and a read is not a check',
        run: () => everyLinkColumnIsWritten(outputDir),
      },
      {
        name: 'no verdict reads a clock',
        proves:
          'every clock read in this suite is on a list that says what it feeds — a printed duration ' +
          'and nothing else — because a verdict that reads a clock is a verdict about machine load, ' +
          "and a resumption sample cannot see that class (CS-ORACLE-5)",
        run: () => noVerdictReadsAClock(),
      },
      {
        name: 'every control applies',
        proves:
          'each mutation in negative-controls.sh, applied in memory to the file it names, changes ' +
          'it — a control whose target was refactored away reports OK about nothing, and one did ' +
          'for three commits before a full tally ran',
        run: () => everyControlApplies(),
      },
      {
        name: 'every fixture is a fixture',
        proves:
          'each gate-corpus file balances its braces, ends in a newline, is parsed to its last ' +
          'line and produces rows of its own — a fixture a backtick truncated was read as a ' +
          'healthy file seven times, and a corpus entry that produces nothing can never fail',
        run: () => everyFixtureIsAFixture(outputDir),
      },
      {
        name: 'regime pins',
        proves: 'the coarse regime tokens in the module key are the pinned ones, and every gate-corpus module is compiled under the frozen target framework and define set — the program an expectation describes',
        run: () => regimePins(outputDir),
      },
      {
        name: 'cs_preproc_region',
        proves:
          'the audit trail for #if provenance exists — PENDING on a schema arity that ' +
          'states 15 columns and lists 14',
        run: () => preprocRegionRelation(outputDir),
      },
      {
        name: 'defineConstantsKey is canonical',
        proves:
          'order, duplication and the empty set cannot fork a module identity, and case ' +
          'is preserved because C# preprocessor symbols are case-sensitive',
        run: defineConstantsCanonical,
      },
      {
        name: 'multi-target keying',
        proves:
          'one file under two frameworks is two modules with different hashes and different ' +
          'active #if branches — section 2.2 option 3, exercised',
        run: () => multiTargetKeying(corpusDir),
      },
    ];

    if (process.argv.includes('--list')) {
      for (const check of CHECKS) {
        console.log(`${check.name}\n  ${check.proves}`);
      }
      return 0;
    }

    console.log('='.repeat(78));
    console.log('C# suite — no Roslyn, no dotnet, no network');
    console.log('='.repeat(78));

    const startedAt = Date.now();
    const summary = await runAnalyzer(corpusDir, outputDir);

    // THE COVERAGE CORPUS, analysed separately and read only by the enum audit.
    //
    // Two corpora because they answer different questions and neither
    // substitutes. The inline one exists to be BROKEN — every negative control
    // mutates the parser and re-runs against it, and a fixture nobody may edit
    // cannot serve as a control. The fixture corpus exists to be BROAD: 275
    // files written to exercise syntax the inline one has no reason to contain,
    // and pointing the audit at it drops the measured-gap count by more than
    // half.
    //
    // Running only the inline corpus reported values as never-emitted that the
    // parser emits perfectly well; running only the fixture corpus would leave
    // every control with nothing it is allowed to break.
    if (fs.existsSync(COVERAGE_CORPUS_DIR)) {
      coverageDir = coverageOutputDir;
      await runAnalyzer(COVERAGE_CORPUS_DIR, coverageOutputDir);
    }
    console.log(
      `\nextraction: ${summary.filesAnalysed}/${summary.filesSeen} files, ` +
        `${Object.entries(summary.counts).map(([k, v]) => `${k}=${v}`).join(' ')}, ` +
        `${((Date.now() - startedAt) / 1000).toFixed(1)}s`
    );
    if (summary.extractionErrors > 0) {
      console.log(`  ${summary.extractionErrors} file(s) errored during extraction`);
    }

    let failed = 0;
    for (const check of CHECKS) {
      console.log(`\n${check.name}`);
      const t0 = Date.now();
      let rc: number;
      try {
        rc = await check.run();
      } catch (error) {
        rc = fail(`threw: ${(error as Error).message}`);
      }
      const seconds = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  ${rc ? 'FAIL' : 'PASS'}  (${seconds}s)  ${check.proves}`);
      failed += rc ? 1 : 0;
    }

    console.log('\n' + '='.repeat(78));
    if (pending > PENDING_BAR) {
      console.log(`PENDING RATCHET BROKEN: ${pending} pending, bar is ${PENDING_BAR}`);
      console.log(`  ${pendingNames.join(', ')}`);
      failed += 1;
    } else if (pending < PENDING_BAR) {
      console.log(`${pending} pending, bar is ${PENDING_BAR} — lower PENDING_BAR to lock this in`);
    }
    console.log(`${CHECKS.length - failed}/${CHECKS.length} checks passed`);
    console.log('='.repeat(78));
    return failed ? 1 : 0;
  } finally {
    await fsp.rm(corpusDir, { recursive: true, force: true });
    await fsp.rm(outputDir, { recursive: true, force: true });
    // The enum audit's output over src/test-data/csharp — 44 MB a run, and
    // this line was missing: 2,993 of them, 40 GB, filled the disk under a
    // full harness run and turned one control INCONCLUSIVE with ENOSPC.
    await fsp.rm(coverageOutputDir, { recursive: true, force: true });
  }
}

void main().then((code) => {
  process.exit(code);
});
