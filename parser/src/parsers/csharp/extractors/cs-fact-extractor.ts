import { CsModuleRegistry } from '@/analysis-types/csharp/CsModuleRegistry';
import { CsParseGapRegistry } from '@/analysis-types/csharp/CsParseGapRegistry';
import { reorderRefStructModifiers } from '@/parsers/csharp/extractors/cs-modifier-order';
import { rewriteSemicolonBodies } from '@/parsers/csharp/extractors/cs-semicolon-body';
import { CsUsingRegistry } from '@/analysis-types/csharp/CsUsingRegistry';
import { CsAttributeArgumentRegistry } from '@/analysis-types/csharp/CsAttributeArgumentRegistry';
import { CsAttributeRegistry } from '@/analysis-types/csharp/CsAttributeRegistry';
import { CsBlockRegistry } from '@/analysis-types/csharp/CsBlockRegistry';
import { CsCommentRegistry } from '@/analysis-types/csharp/CsCommentRegistry';
import { CsPreprocRegionRegistry } from '@/analysis-types/csharp/CsPreprocRegionRegistry';
import { CsCallSiteRegistry } from '@/analysis-types/csharp/CsCallSiteRegistry';
import { CsEnumMemberRegistry } from '@/analysis-types/csharp/CsEnumMemberRegistry';
import { CsExpressionRegistry } from '@/analysis-types/csharp/CsExpressionRegistry';
import { CsQueryClauseRegistry } from '@/analysis-types/csharp/CsQueryClauseRegistry';
import { CsEventRegistry } from '@/analysis-types/csharp/CsEventRegistry';
import { CsFieldRegistry } from '@/analysis-types/csharp/CsFieldRegistry';
import { CsMethodParameterRegistry } from '@/analysis-types/csharp/CsMethodParameterRegistry';
import { CsMethodRegistry } from '@/analysis-types/csharp/CsMethodRegistry';
import { CsPropertyRegistry } from '@/analysis-types/csharp/CsPropertyRegistry';
import { CsTypeHeritageRegistry } from '@/analysis-types/csharp/CsTypeHeritageRegistry';
import { CsTypeParameterRegistry } from '@/analysis-types/csharp/CsTypeParameterRegistry';
import { CsTypeReferenceRegistry } from '@/analysis-types/csharp/CsTypeReferenceRegistry';
import { CsVariableRegistry } from '@/analysis-types/csharp/CsVariableRegistry';
import { CsTypeRegistry } from '@/analysis-types/csharp/CsTypeRegistry';
import { CsMethodKind } from '@/enums/csharp/methods';
import { CsNullableContext } from '@/enums/csharp/modules';
import {
  CsTypeAccess,
  CsTypeCategory,
  CsTypeModifier,
  CsTypePlacement,
} from '@/enums/csharp/types';
import { CSHARP_SYNTHESIZED_PROGRAM_TYPE_NAME } from '@/constants/csharp-constants';
import type Parser from 'tree-sitter';
import { CSharpParser, stripUtf8Bom } from '@/parsers/csharp/csharp-parser';
import {
  blankAndReport,
  resolveFileSymbols,
} from '@/parsers/csharp/extractors/cs-preproc-blank';
import {
  CsModuleContext,
  mintModule,
  recordParsedShape,
} from '@/parsers/csharp/extractors/cs-module-extractor';
import { collectAttributes } from '@/parsers/csharp/extractors/cs-attribute-extractor';
import {
  extractTopLevelStatements,
  topLevelStatementsOf,
} from '@/parsers/csharp/extractors/cs-member-extractor';
import { extractComments } from '@/parsers/csharp/extractors/cs-comment-extractor';
import { extractParseGaps } from '@/parsers/csharp/extractors/cs-parse-gap-extractor';
import { preprocRegionsFromReport } from '@/parsers/csharp/extractors/cs-preproc-region-extractor';
import { declarationGroupKey, extractTypes } from '@/parsers/csharp/extractors/cs-type-extractor';
import { endLine, startColumn, startLine } from '@/parsers/csharp/extractors/cs-node';
import { extractUsings } from '@/parsers/csharp/extractors/cs-using-extractor';
import {
  fileLevelSymbols,
  implicitFrameworkSymbols,
  NullableContextMap,
} from '@/parsers/csharp/extractors/preproc-context';

/**
 * Extracts the fact spine for ONE C# file.
 *
 * ## The order is a dependency order, not a preference
 *
 * ```
 * module → type → type_base → method → method_parameter → field
 *        → type_reference
 *        → expression → call_site
 * ```
 *
 * Each step needs hashes the previous one minted. Expressions and call sites are
 * last, always: they reference everything else, and building them early means
 * re-deriving keys that do not exist yet — which under `partial` collides **by
 * design**, because two parts of one type are supposed to have the same
 * qualified name.
 *
 * The module hash comes first and comes from the PATH ALONE. Nothing about it
 * needs the tree.
 *
 * ## No Roslyn, and no `dotnet`
 *
 * Nothing in this process shells out, resolves a package, or evaluates a
 * project's property graph. The parser is a Node library that runs on arbitrary
 * customer checkouts, and a .NET runtime dependency is a different product.
 * Roslyn lives in `../parser-oracle/csharp`, out of process, and adjudicates.
 *
 * That is a HERMETICITY argument, not a speed one. Roslyn's syntax-only API
 * would not be slower.
 */
export interface CsFileExtractionOptions {
  readonly absoluteFilePath: string;
  readonly filePath: string;
  readonly baseMservPath: string;
  readonly sourceText: string;
  readonly serviceVersionLinkHash: string;
  readonly context: CsModuleContext;
  /**
   * Preprocessor symbols active for THIS emission, over and above the implicit
   * framework ones. An input. Never inferred, never read from a `.csproj` by
   * this process.
   */
  readonly defineConstants: readonly string[];
  /**
   * Namespaces the SDK injects. An INPUT, like `defineConstants`: 59 projects in
   * the corpus enable them and they appear in no file anywhere.
   */
  readonly implicitUsings?: readonly string[];
}

export interface CsFileFacts {
  readonly modules: readonly CsModuleRegistry[];
  readonly types: readonly CsTypeRegistry[];
  readonly heritages: readonly CsTypeHeritageRegistry[];
  readonly typeParameters: readonly CsTypeParameterRegistry[];
  readonly methods: readonly CsMethodRegistry[];
  readonly methodParameters: readonly CsMethodParameterRegistry[];
  readonly properties: readonly CsPropertyRegistry[];
  readonly events: readonly CsEventRegistry[];
  readonly typeReferences: readonly CsTypeReferenceRegistry[];
  readonly usings: readonly CsUsingRegistry[];
  readonly parseGaps: readonly CsParseGapRegistry[];
  readonly fields: readonly CsFieldRegistry[];
  readonly enumMembers: readonly CsEnumMemberRegistry[];
  readonly expressions: readonly CsExpressionRegistry[];
  readonly callSites: readonly CsCallSiteRegistry[];
  readonly queryClauses: readonly CsQueryClauseRegistry[];
  readonly blocks: readonly CsBlockRegistry[];
  readonly variables: readonly CsVariableRegistry[];
  readonly attributes: readonly CsAttributeRegistry[];
  readonly attributeArguments: readonly CsAttributeArgumentRegistry[];
  readonly comments: readonly CsCommentRegistry[];
  readonly preprocRegions: readonly CsPreprocRegionRegistry[];
}

export class CsFactExtractor {
  private readonly parser: CSharpParser;

  constructor(parser?: CSharpParser) {
    // Constructing a CSharpParser runs the grammar gate. Sharing one instance
    // across files is what keeps that a startup cost rather than a per-file one.
    this.parser = parser ?? new CSharpParser();
  }

  extractFile(options: CsFileExtractionOptions): CsFileFacts {
    // 1. MODULE — from the path, before the tree exists.
    const module = mintModule({
      absoluteFilePath: options.absoluteFilePath,
      filePath: options.filePath,
      baseMservPath: options.baseMservPath,
      context: options.context,
      serviceVersionLinkHash: options.serviceVersionLinkHash,
    });

    // The SAME string the tree is built from. `CSharpParser.parse` strips a
    // leading BOM, so measuring `options.sourceText.length` below would measure
    // a text three bytes longer than the one the tree has positions into, and
    // the parse-gap rows are derived from that length. Normalising once here
    // makes the two agree by construction rather than by coincidence.
    const sourceText = stripUtf8Bom(options.sourceText);
    // THE BRANCHES THIS EMISSION DOES NOT COMPILE ARE BLANKED BEFORE PARSING.
    //
    // tree-sitter parses both arms of a `#if` and the published grammar has no
    // rule for a directive in most declaration positions, so it recovers with
    // an ERROR node — 30 of the 41 shapes it cannot read are preprocessor
    // shapes. The parser already knows which arm this emission takes; the
    // target framework and define set are INPUTS, in cs_module's primary key.
    // So the directives and the dead arms become whitespace and the grammar is
    // handed ordinary C#.
    //
    // Same LENGTH, never shorter: every offset, line and column is preserved,
    // so every span still points at the real source.
    const fileSymbols = resolveFileSymbols(
      options.context.targetFramework,
      options.defineConstants
    );
    const blanked = blankAndReport(sourceText, fileSymbols);
    // AND C# 12'S SEMICOLON BODY BECOMES AN EMPTY BLOCK. `public interface
    // ILock : IBase;` has no rule in the published grammar, and its recovery
    // merges every such declaration in a file into ONE type named after the
    // last of them — so the types are not merely unparsed, they are attributed
    // to the wrong name. 511 declarations across seven codebases. See
    // cs-semicolon-body.ts for why the one character this adds is unobservable
    // in every column the schema records.
    // AND `ref partial struct` BECOMES `partial ref struct`. The grammar takes
    // `ref` only as the last modifier, and the loss when it does not is the
    // whole TYPE with every member in it. The rotation keeps the same tokens
    // and the same length, and nothing records modifier order — see
    // cs-modifier-order.ts.
    const rewritten = reorderRefStructModifiers(rewriteSemicolonBodies(blanked.text).text).text;
    // AND THE FILE ENDS WITH A NEWLINE. A `#pragma` on the last line of a file
    // that has none makes the `preproc_pragma` node report `hasError` ON ITSELF
    // — no ERROR node anywhere, nothing else wrong, and the file fully read —
    // so the gap relation's fallback reported the pragma as the file's defect.
    // 23 of the 945 files in multitarget-A, every one of them complete: 11 types and 94
    // methods in the first one looked at, and a gap row saying not to trust it.
    //
    // The most benign rewrite there is: nothing follows a trailing newline, so
    // no line, column or span can move. A file that already ends in one is
    // untouched, and a pragma that is not last never had the problem.
    const parseText = rewritten.endsWith('\n') ? rewritten : `${rewritten}\n`;
    const tree = this.parser.parse(parseText);
    const root = this.parser.getRootNode(tree);

    // The symbol set this emission is compiled under: what the caller supplied,
    // plus the implicit framework symbols the SDK injects and no `.csproj`
    // contains. `NET8_0_OR_GREATER` is in no file anywhere.
    // Then the file's own `#define` / `#undef`, in order, before its first
    // token — a fact about the file, not a key of the module (CS-CORPUS-25).
    const activeSymbols = fileLevelSymbols(
      root,
      new Set<string>([
        ...options.defineConstants,
        ...implicitFrameworkSymbols(options.context.targetFramework),
      ])
    );

    const nullableContext = new NullableContextMap(
      root,
      options.context.nullableContextDefault ?? CsNullableContext.INHERITED
    );

    // The GAPS are computed first, because the module's error counts are
    // derived from them rather than counted separately — two counters over the
    // same tree drift, and one of them is then wrong with nothing to say so.
    const parseGaps = extractParseGaps({
      root,
      csModuleLinkHash: module.getHash(),
      // THE PARSED TEXT's length, not the original's. Blanking preserves
      // length and the semicolon-body rewrite does not, so coverage measured
      // against the original would be a fraction of a text the tree has no
      // positions into.
      sourceLength: parseText.length,
      serviceVersionLinkHash: options.serviceVersionLinkHash,
    });
    recordParsedShape(module, root, nullableContext, options.context.nullableContextDefault, {
      count: parseGaps.length,
      bytes: parseGaps.reduce((sum, g) => sum + g.byteLength, 0),
    });

    // 2. USINGS. Before types, because the using set is what decides whether an
    //    extension method is visible at all, and because it is the only relation
    //    with rows that come from outside the file.
    const { usings, typeReferences: usingTypeReferences } = extractUsings({
      root,
      csModuleLinkHash: module.getHash(),
      serviceVersionLinkHash: options.serviceVersionLinkHash,
      activeSymbols,
      implicitUsings: options.implicitUsings ?? [],
    });

    // The ALIASES this file declares. `using A = B.C;` then `A` is a reference
    // to the alias, and cs_using records it — this is the set that lets the
    // reference say so, one hop, same file.
    const usingAliasNames = new Set(
      usings.filter((u) => u.aliasName !== '').map((u) => u.aliasName)
    );

    // 3. TYPE, and the relations keyed off a type's own hash: its base list
    //    and its generic parameters. Both are emitted on the same single visit
    //    to the declaration, so neither can be reached by a second path.
    const typeResult = extractTypes({
      root,
      csModuleLinkHash: module.getHash(),
      serviceVersionLinkHash: options.serviceVersionLinkHash,
      activeSymbols,
      nullableContext,
      usingAliasNames,
    });

    // 3b. TOP-LEVEL STATEMENTS. A file with no type and no method: the member
    //     walk starts at a declaration, so `Program.cs` contributed nothing at
    //     all — and in a minimal-hosting app that file is where the whole
    //     application is wired up.
    //
    //     The statements are owned by `Program.<Main>$` — RULING v1.6 §4.0.3,
    //     answered by Roslyn rather than chosen: both the method and its type
    //     carry one DeclaringSyntaxReference, the compilation unit. The type
    //     row is minted HERE, beside the other type rows, and the member
    //     extractor mints the method under it.
    const programType = synthesizedProgramType(root, module.getHash(), nullableContext.at(0), options.serviceVersionLinkHash);
    const topLevel = extractTopLevelStatements({
      root,
      csModuleLinkHash: module.getHash(),
      serviceVersionLinkHash: options.serviceVersionLinkHash,
      activeSymbols,
      usingAliasNames,
      programTypeLinkHash: programType?.getHash() ?? '',
    });
    // The module's entry point — `<Main>$` — since v1.6. A declared hop that
    // was never written: the setter existed, nothing called it.
    const entryPoint = topLevel.methods.find((m) => m.methodKind === CsMethodKind.TOP_LEVEL_ENTRY_POINT);
    if (entryPoint !== undefined) {
      module.setModuleInitMethodLinkHash(entryPoint.getHash());
    }

    // 4. ATTRIBUTES and COMMENTS — ONE walk each over the whole tree, reading
    //    the `node.id` → owner side table the type and member passes filled.
    //    The alternative was threading an emit call through sixteen sites, and
    //    every one of those is a chance to visit a construct on two paths.
    //    Duplicates DOUBLE.
    const attributeResult = collectAttributes({
      root,
      declarationOwners: typeResult.declarationOwners,
      csModuleLinkHash: module.getHash(),
      serviceVersionLinkHash: options.serviceVersionLinkHash,
      activeSymbols,
    });
    const comments = extractComments({
      root,
      csModuleLinkHash: module.getHash(),
      serviceVersionLinkHash: options.serviceVersionLinkHash,
      declarationOwners: typeResult.declarationOwners,
    });

    // 5. THE AUDIT TRAIL for what all of the above was emitted FROM. Which
    //    `#if` branch this emission took, and why.
    // FROM THE BLANKING PASS, not from the tree. The tree has no `preproc_if`
    // nodes any more — they were blanked to whitespace before it was built —
    // so the tree walk returned nothing and this relation emptied itself as a
    // side effect of fixing `#if` parsing.
    const preprocRegions = preprocRegionsFromReport({
      regions: blanked.regions,
      csModuleLinkHash: module.getHash(),
      serviceVersionLinkHash: options.serviceVersionLinkHash,
    });

    return {
      modules: [module],
      types: programType === undefined ? typeResult.types : [...typeResult.types, programType],
      heritages: typeResult.heritages,
      typeParameters: typeResult.typeParameters,
      methods: [...typeResult.methods, ...topLevel.methods],
      methodParameters: [...typeResult.methodParameters, ...topLevel.parameters],
      properties: typeResult.properties,
      events: typeResult.events,
      // The attribute pass produces type references of its own —
      // `[JsonConverter(typeof(X))]` names a type nothing else in the fact base
      // records — so the two lists are concatenated rather than the second
      // being dropped for tidiness.
      typeReferences: [
        ...typeResult.typeReferences,
        ...topLevel.typeReferences,
        ...attributeResult.typeReferences,
        ...usingTypeReferences,
      ],
      fields: typeResult.fields,
      enumMembers: typeResult.enumMembers,
      // LAST, always. They reference everything above by hash, and building
      // them earlier means re-deriving keys that do not exist yet.
      expressions: [
        ...typeResult.expressions,
        ...topLevel.expressions,
        ...attributeResult.expressions,
      ],
      callSites: [...typeResult.callSites, ...topLevel.callSites, ...attributeResult.callSites],
      queryClauses: [...typeResult.queryClauses, ...topLevel.queryClauses],
      blocks: [...typeResult.blocks, ...topLevel.blocks],
      variables: [...typeResult.variables, ...topLevel.variables],
      attributes: attributeResult.attributes,
      attributeArguments: attributeResult.attributeArguments,
      comments,
      preprocRegions,
      usings,
      // The losses, as rows. 2.91% of a real corpus errors, and as a percentage
      // that is a fact nobody can act on.
      parseGaps,
    };
  }
}

/**
 * The `Program` type the compiler synthesises for a file of top-level
 * statements — RULING v1.6 §4.0.3, and every value here is Roslyn's.
 *
 * `undefined` when the file has no global statement: the type exists only
 * where the compiler would create it.
 *
 * ## The primary-key consequence, and it is not obvious
 *
 * A user-written `public partial class Program { }` — the ASP.NET pattern for
 * making the entry point visible to tests — MERGES with this type: Roslyn
 * reports two DeclaringSyntaxReferences, and the user's member is visible on
 * the merged type. So this row carries the SAME `declarationGroupKey` as a
 * written `Program` at global scope, and it is `isPartial = true` even though
 * no `partial` keyword exists anywhere in its syntax. A gate asserting "only
 * partial types have multi-part groups" would otherwise fail on correct
 * output — the §2.1 shape, an assertion the language falsifies.
 *
 * `SYNTHESIZED` in `typeModifiers` is what says the row has no declaration
 * syntax of its own; its position is the compilation unit, which is the one
 * syntax reference it does have.
 */
function synthesizedProgramType(
  root: Parser.SyntaxNode,
  csModuleLinkHash: string,
  nullableContext: CsNullableContext,
  serviceVersionLinkHash: string
): CsTypeRegistry | undefined {
  // THE SAME READING the member extractor uses to mint `<Main>$`. Two copies of
  // this test meant a file whose only global statement was a stranded `;` got a
  // synthesised `Program` type with no method in it.
  if (topLevelStatementsOf(root).length === 0) {
    return undefined;
  }
  const name = CSHARP_SYNTHESIZED_PROGRAM_TYPE_NAME;
  // The GLOBAL namespace's scope key, spelled exactly as the type extractor
  // spells it for a written type there — the group key must match a written
  // `partial class Program` byte for byte or the two never merge.
  const declarationScopeKey = 'NS:';
  return new CsTypeRegistry({
    name,
    qualifiedName: name,
    arity: 0,
    typeCategory: CsTypeCategory.CLASS,
    typeAccess: CsTypeAccess.INTERNAL,
    // The modifier SET records what is WRITTEN, and nothing is: SYNTHESIZED is
    // the one modifier this type has. `isPartial` and `typeAccess` carry the
    // semantic facts.
    typeModifiers: new Set([CsTypeModifier.SYNTHESIZED]),
    typePlacement: CsTypePlacement.TOP_LEVEL,
    declarationScopeKey,
    declarationGroupKey: declarationGroupKey(declarationScopeKey, name, 0),
    isPartial: true,
    isStatic: false,
    isAbstract: false,
    isSealed: false,
    isReadOnly: false,
    isRefLikeStruct: false,
    isFileLocal: false,
    isRecord: false,
    hasPrimaryConstructor: false,
    primaryConstructorArity: 0,
    nullableContext,
    csModuleLinkHash,
    containingTypeLinkHash: '',
    csNamespaceName: '',
    startLine: startLine(root),
    endLine: endLine(root),
    startColumn: startColumn(root),
    serviceVersionLinkHash,
  });
}
