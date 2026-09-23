import * as fsp from 'fs/promises';
import * as path from 'path';

import { CsAttributeArgumentRegistry } from '@/analysis-types/csharp/CsAttributeArgumentRegistry';
import { CsAttributeRegistry } from '@/analysis-types/csharp/CsAttributeRegistry';
import { CsBlockRegistry } from '@/analysis-types/csharp/CsBlockRegistry';
import { CsCommentRegistry } from '@/analysis-types/csharp/CsCommentRegistry';
import { CsPreprocRegionRegistry } from '@/analysis-types/csharp/CsPreprocRegionRegistry';
import { CsCallSiteRegistry } from '@/analysis-types/csharp/CsCallSiteRegistry';
import { CsEnumMemberRegistry } from '@/analysis-types/csharp/CsEnumMemberRegistry';
import { CsExpressionRegistry } from '@/analysis-types/csharp/CsExpressionRegistry';
import { CsQueryClauseRegistry } from '@/analysis-types/csharp/CsQueryClauseRegistry';
import { CsFieldRegistry } from '@/analysis-types/csharp/CsFieldRegistry';
import { CsModuleRegistry } from '@/analysis-types/csharp/CsModuleRegistry';
import { CsParseGapRegistry } from '@/analysis-types/csharp/CsParseGapRegistry';
import { CsUsingRegistry } from '@/analysis-types/csharp/CsUsingRegistry';
import { CsEventRegistry } from '@/analysis-types/csharp/CsEventRegistry';
import { CsMethodParameterRegistry } from '@/analysis-types/csharp/CsMethodParameterRegistry';
import { CsMethodRegistry } from '@/analysis-types/csharp/CsMethodRegistry';
import { CsPropertyRegistry } from '@/analysis-types/csharp/CsPropertyRegistry';
import { CsTypeHeritageRegistry } from '@/analysis-types/csharp/CsTypeHeritageRegistry';
import { CsTypeParameterRegistry } from '@/analysis-types/csharp/CsTypeParameterRegistry';
import { CsTypeReferenceRegistry } from '@/analysis-types/csharp/CsTypeReferenceRegistry';
import { CsVariableRegistry } from '@/analysis-types/csharp/CsVariableRegistry';
import { CsTypeRegistry } from '@/analysis-types/csharp/CsTypeRegistry';
import {
  CSHARP_DEFAULT_TARGET_FRAMEWORK,
} from '@/constants/csharp-constants';
import { CsNullableContext } from '@/enums/csharp/modules';
import { CSharpParser } from '@/parsers/csharp/csharp-parser';
import { CsFactExtractor } from '@/parsers/csharp/extractors/cs-fact-extractor';
import { CsModuleContext } from '@/parsers/csharp/extractors/cs-module-extractor';
import { implicitFrameworkSymbols } from '@/parsers/csharp/extractors/preproc-context';
import { EntityUtils } from '@/utils/entity-utils';
import { CsRelationWriter } from '@/workflows/csharp/cs-relation-writer';
import { governingProject, readProjectConfig } from '@/workflows/csharp/cs-project-config';

/**
 * Runs the C# front end over one root and writes the fact base.
 *
 * ## Two passes, and the first one parses nothing
 *
 * Pass 1 discovers files and mints every `cs_module` hash **from paths alone**.
 * Pass 2 parses. That split is §1's build order taken literally, and under
 * `partial` it is a requirement rather than a nicety: a type's 88 declarations
 * live in 88 files and no ordering of those files makes one of them first.
 *
 * ## `targetFramework` and `defineConstants` are inputs
 *
 * They are in `cs_module`'s primary key, and a multi-targeting project has more
 * than one answer for the same file. A caller that passes them fixes them for
 * every file (the test suites do). A caller that passes neither gets them from
 * the project that compiles each file — cs-project-config.ts, a subset of MSBuild
 * evaluation that runs no .NET.
 */
export interface CsAnalyzeOptions {
  readonly rootDir: string;
  readonly outputDir: string;
  readonly baseMservPath: string;
  readonly serviceVersionLink: string;
  readonly excludeDirs?: readonly string[];
  /**
   * One emission per target framework. Passing two produces two `cs_module`
   * rows per file with different hashes and non-overlapping `#if` branches,
   * which is the whole point of §2.2's option 3.
   */
  readonly targetFrameworks?: readonly string[];
  readonly defineConstants?: readonly string[];
  readonly langVersion?: string;
  readonly nullableContextDefault?: CsNullableContext;
  /**
   * SDK-injected namespaces. An INPUT: 59 projects in the corpus enable
   * `<ImplicitUsings>` and the namespaces appear in no file anywhere, so an
   * import relation without them is missing exactly the rows that decide
   * whether `xs.Where(…)` resolves.
   */
  readonly implicitUsings?: readonly string[];
}

export interface CsAnalyzeSummary {
  readonly filesSeen: number;
  readonly filesAnalysed: number;
  readonly filesRejected: number;
  readonly extractionErrors: number;
  readonly counts: Record<string, number>;
}

/** Directories never worth walking. `obj/` and `bin/` are build output. */
const DEFAULT_EXCLUDES = ['obj', 'bin', '.git', 'node_modules', 'packages', '.vs'];

/** One file per relation, named as the other front ends name theirs. */
const RELATION_FILES = {
  modules: 'all-csharp-modules.csv',
  types: 'all-csharp-types.csv',
  heritages: 'all-csharp-type-heritages.csv',
  typeParameters: 'all-csharp-type-parameters.csv',
  methods: 'all-csharp-methods.csv',
  methodParameters: 'all-csharp-method-parameters.csv',
  properties: 'all-csharp-properties.csv',
  events: 'all-csharp-events.csv',
  typeReferences: 'all-csharp-type-references.csv',
  usings: 'all-csharp-usings.csv',
  parseGaps: 'all-csharp-parse-gaps.csv',
  fields: 'all-csharp-fields.csv',
  enumMembers: 'all-csharp-enum-members.csv',
  expressions: 'all-csharp-expressions.csv',
  callSites: 'all-csharp-call-sites.csv',
  queryClauses: 'all-csharp-query-clauses.csv',
  blocks: 'all-csharp-blocks.csv',
  variables: 'all-csharp-variables.csv',
  attributes: 'all-csharp-attributes.csv',
  attributeArguments: 'all-csharp-attribute-arguments.csv',
  comments: 'all-csharp-comments.csv',
  preprocRegions: 'all-csharp-preproc-regions.csv',
} as const;

/**
 * One set of writers, one output directory, however many roots feed it.
 *
 * `extract` hands the analyzer every C# project it discovered — 52 under one
 * fixture tree — and each `analyze` call used to mint its own writers for the
 * SAME twenty-two files: the temporary name was `<pid>.<ms>`, two calls in one
 * millisecond shared it, the first to publish renamed it away and the second
 * got ENOENT (CS-ORACLE-3). And had the names not collided, each publish would
 * have replaced the previous project's rows — last project wins, the rest
 * silently gone. A shared context is written once and published once.
 *
 * `seen` is the set of files already extracted this run: the C# detector is
 * shallow, so a directory with source is a project and a `.csproj` beneath it
 * is another, and the files under both would be extracted twice — and
 * duplicate rows do not collide, they DOUBLE.
 */
interface CsSharedWriteContext {
  readonly writers: Record<keyof typeof RELATION_FILES, CsRelationWriter>;
  readonly seen: Set<string>;
}

export class CSharpProjectAnalyzer {
  private readonly extractor: CsFactExtractor;
  /** Makes every temporary file name of this process unique: `<pid>.<n>`. */
  private writeSequence = 0;

  constructor(parser?: CSharpParser) {
    // One parser, one grammar gate, for the whole run.
    this.extractor = new CsFactExtractor(parser ?? new CSharpParser());
  }

  /**
   * Several roots into ONE output directory, as one fact base. Roots are
   * walked in sorted order so the output is deterministic, and a file reached
   * from two roots is extracted once.
   */
  async analyzeMany(
    rootDirs: readonly string[],
    options: Omit<CsAnalyzeOptions, 'rootDir'>
  ): Promise<CsAnalyzeSummary> {
    await fsp.mkdir(options.outputDir, { recursive: true });
    const shared = this.newSharedWriteContext(options.outputDir);
    const summaries: CsAnalyzeSummary[] = [];
    try {
      for (const rootDir of [...rootDirs].sort()) {
        summaries.push(await this.analyze({ ...options, rootDir }, shared));
      }
      for (const writer of Object.values(shared.writers)) {
        await writer.publish();
      }
    } catch (error) {
      for (const writer of Object.values(shared.writers)) {
        await writer.discard();
      }
      throw error;
    }
    return {
      filesSeen: summaries.reduce((n, s) => n + s.filesSeen, 0),
      filesAnalysed: summaries.reduce((n, s) => n + s.filesAnalysed, 0),
      filesRejected: summaries.reduce((n, s) => n + s.filesRejected, 0),
      extractionErrors: summaries.reduce((n, s) => n + s.extractionErrors, 0),
      counts: countsOf(shared.writers),
    };
  }

  private newSharedWriteContext(outputDir: string): CsSharedWriteContext {
    const suffix = `${process.pid}.${this.writeSequence}`;
    this.writeSequence += 1;
    const writers = Object.fromEntries(
      (Object.keys(RELATION_FILES) as (keyof typeof RELATION_FILES)[]).map((key) => [
        key,
        new CsRelationWriter(outputDir, RELATION_FILES[key], suffix),
      ])
    ) as Record<keyof typeof RELATION_FILES, CsRelationWriter>;
    return { writers, seen: new Set() };
  }

  /**
   * One root. With a shared context the rows go to its writers and nothing is
   * published here; without one this call owns its writers and publishes.
   */
  async analyze(options: CsAnalyzeOptions, shared?: CsSharedWriteContext): Promise<CsAnalyzeSummary> {
    const rootDir = path.resolve(options.rootDir);
    const excludes = new Set(options.excludeDirs ?? DEFAULT_EXCLUDES);
    const serviceVersionLinkHash = EntityUtils.generateEntityHash(
      'SERVICE_VERSION',
      options.serviceVersionLink
    );
    const frameworks =
      options.targetFrameworks && options.targetFrameworks.length > 0
        ? options.targetFrameworks
        : [CSHARP_DEFAULT_TARGET_FRAMEWORK];
    const defineConstants = options.defineConstants ?? [];
    const readsProjects = options.targetFrameworks === undefined && options.defineConstants === undefined;

    // PASS 1 — discovery. Sorted, so two runs walk the directory in the same
    // order and the byte-for-byte determinism gate has something to be true of.
    // `readdir` order is filesystem order, which is not stable across machines
    // and is not stable across a rename on some of them.
    const files = (await discoverCsFiles(rootDir, excludes)).sort();

    await fsp.mkdir(options.outputDir, { recursive: true });
    const context = shared ?? this.newSharedWriteContext(options.outputDir);
    const writers = context.writers;

    let filesAnalysed = 0;
    let filesRejected = 0;
    let extractionErrors = 0;

    try {
      for (const absoluteFilePath of files) {
        if (context.seen.has(absoluteFilePath)) {
          // Reached from another root this run; its rows are already written.
          continue;
        }
        context.seen.add(absoluteFilePath);
        const relativePath = path.relative(options.baseMservPath, absoluteFilePath);
        let sourceText: string;
        try {
          sourceText = await fsp.readFile(absoluteFilePath, 'utf-8');
        } catch {
          filesRejected += 1;
          continue;
        }

        // THE GOVERNING PROJECT decides the framework and the symbols, unless the
        // caller fixed them. See cs-project-config.ts for why this is read at all.
        const project = readsProjects
          ? readProjectConfigFor(absoluteFilePath, rootDir, options.baseMservPath)
          : undefined;
        const fileFrameworks =
          project !== undefined && project.targetFramework !== '' ? [project.targetFramework] : frameworks;
        const fileDefines = project !== undefined ? project.defineConstants : defineConstants;
        const implicitFrameworkDefines = project === undefined || project.implicitFrameworkDefines;

        for (const targetFramework of fileFrameworks) {
          // The RESOLVED set, per framework: what the caller supplied plus what
          // the SDK injects. Two frameworks therefore differ in the key even
          // when the .csproj lists the same constants for both, which is what
          // makes the two emissions distinguishable rather than merely
          // differently labelled.
          const activeSymbols = [
            ...fileDefines,
            ...(implicitFrameworkDefines ? implicitFrameworkSymbols(targetFramework) : []),
          ];
          const context: CsModuleContext = {
            targetFramework,
            defineConstantsKey: defineConstantsKeyOf(activeSymbols),
            langVersion: options.langVersion ?? project?.langVersion ?? '',
            nullableContextDefault:
              options.nullableContextDefault ?? CsNullableContext.INHERITED,
            projectPath: project?.projectPath ?? '',
            // NOT the project's assembly name, although it is known. The engine
            // treats an assembly as a wall a simple name cannot cross
            // (type-resolution.dl, THE ASSEMBLY GUARD), and nothing tells it
            // which assemblies REFERENCE which — so filling this in severs every
            // test project from the code it tests. One assembly for the whole
            // tree, as before, until project references are facts.
            assemblyName: '',
            implicitUsingsEnabled: project?.implicitUsings ?? false,
          };

          try {
            const facts = this.extractor.extractFile({
              absoluteFilePath,
              filePath: relativePath,
              baseMservPath: options.baseMservPath,
              sourceText,
              serviceVersionLinkHash,
              context,
              defineConstants: fileDefines,
              implicitUsings: options.implicitUsings ?? project?.usings,
              implicitFrameworkDefines,
            });
            await writers.modules.append(facts.modules as readonly CsModuleRegistry[]);
            await writers.types.append(facts.types as readonly CsTypeRegistry[]);
            await writers.heritages.append(
              facts.heritages as readonly CsTypeHeritageRegistry[]
            );
            await writers.typeParameters.append(
              facts.typeParameters as readonly CsTypeParameterRegistry[]
            );
            await writers.methods.append(facts.methods as readonly CsMethodRegistry[]);
            await writers.methodParameters.append(
              facts.methodParameters as readonly CsMethodParameterRegistry[]
            );
            await writers.properties.append(
              facts.properties as readonly CsPropertyRegistry[]
            );
            await writers.events.append(facts.events as readonly CsEventRegistry[]);
            await writers.typeReferences.append(
              facts.typeReferences as readonly CsTypeReferenceRegistry[]
            );
            await writers.usings.append(facts.usings as readonly CsUsingRegistry[]);
            await writers.parseGaps.append(
              facts.parseGaps as readonly CsParseGapRegistry[]
            );
            await writers.fields.append(facts.fields as readonly CsFieldRegistry[]);
            await writers.enumMembers.append(
              facts.enumMembers as readonly CsEnumMemberRegistry[]
            );
            await writers.expressions.append(
              facts.expressions as readonly CsExpressionRegistry[]
            );
            await writers.callSites.append(
              facts.callSites as readonly CsCallSiteRegistry[]
            );
            await writers.queryClauses.append(
              facts.queryClauses as readonly CsQueryClauseRegistry[]
            );
            await writers.blocks.append(facts.blocks as readonly CsBlockRegistry[]);
            await writers.variables.append(
              facts.variables as readonly CsVariableRegistry[]
            );
            await writers.attributes.append(
              facts.attributes as readonly CsAttributeRegistry[]
            );
            await writers.attributeArguments.append(
              facts.attributeArguments as readonly CsAttributeArgumentRegistry[]
            );
            await writers.comments.append(facts.comments as readonly CsCommentRegistry[]);
            await writers.preprocRegions.append(
              facts.preprocRegions as readonly CsPreprocRegionRegistry[]
            );
          } catch (error) {
            // An extraction error is always a defect, and it is counted rather
            // than swallowed. A caller that cannot tell a clean run from a
            // parser that threw on every file cannot tell anything.
            extractionErrors += 1;
            console.error(
              `[CSharpProjectAnalyzer] ${relativePath} (${targetFramework}): ` +
                `${(error as Error).message}`
            );
          }
        }
        filesAnalysed += 1;
      }

      if (shared === undefined) {
        for (const writer of Object.values(writers)) {
          await writer.publish();
        }
      }
    } catch (error) {
      if (shared === undefined) {
        for (const writer of Object.values(writers)) {
          await writer.discard();
        }
      }
      throw error;
    }

    return {
      filesSeen: files.length,
      filesAnalysed,
      filesRejected,
      extractionErrors,
      counts: countsOf(writers),
    };
  }
}

function countsOf(writers: Record<keyof typeof RELATION_FILES, CsRelationWriter>): Record<string, number> {
  return {
        cs_module: writers.modules.rowCount,
        cs_type: writers.types.rowCount,
        cs_type_heritage: writers.heritages.rowCount,
        cs_type_parameter: writers.typeParameters.rowCount,
        cs_method: writers.methods.rowCount,
        cs_method_parameter: writers.methodParameters.rowCount,
        cs_property: writers.properties.rowCount,
        cs_event: writers.events.rowCount,
        cs_type_reference: writers.typeReferences.rowCount,
        cs_using: writers.usings.rowCount,
        cs_parse_gap: writers.parseGaps.rowCount,
        cs_field: writers.fields.rowCount,
        cs_enum_member: writers.enumMembers.rowCount,
        cs_expression: writers.expressions.rowCount,
        cs_call_site: writers.callSites.rowCount,
        cs_query_clause: writers.queryClauses.rowCount,
        cs_block: writers.blocks.rowCount,
        cs_variable: writers.variables.rowCount,
        cs_attribute: writers.attributes.rowCount,
        cs_attribute_argument: writers.attributeArguments.rowCount,
        cs_comment: writers.comments.rowCount,
        cs_preproc_region: writers.preprocRegions.rowCount,
  };
}

/**
 * The configuration of the project that governs a file, with its path made
 * relative to the tree. Undefined when no `.csproj` governs it, which leaves the
 * file under `unspecified` exactly as before.
 */
function readProjectConfigFor(
  absoluteFilePath: string,
  rootDir: string,
  baseMservPath: string
): { targetFramework: string; defineConstants: readonly string[]; implicitFrameworkDefines: boolean;
     langVersion: string; projectPath: string;
     implicitUsings: boolean; usings: readonly string[] } | undefined {
  // The search stops at the tree being extracted, never above it: a project file
  // outside the tree is not part of what was handed in.
  const stop = path.resolve(baseMservPath).length < path.resolve(rootDir).length ? baseMservPath : rootDir;
  const projectFile = governingProject(absoluteFilePath, stop);
  if (projectFile === undefined) return undefined;
  const config = readProjectConfig(projectFile);
  if (config === null) return undefined;
  return {
    targetFramework: config.targetFramework,
    defineConstants: config.defineConstants,
    implicitFrameworkDefines: config.implicitFrameworkDefines,
    langVersion: config.langVersion,
    projectPath: path.relative(baseMservPath, config.projectFile),
    implicitUsings: config.implicitUsings,
    usings: config.usings,
  };
}

/**
 * The md5 of the **resolved active symbol set**, canonicalised.
 *
 * This sits in `cs_module`'s PRIMARY KEY, and the module hash chains into every
 * child key in the fact base. So the canonicalisation is load-bearing rather
 * than tidy: without it, two projects declaring `TRACE;DEBUG` and `DEBUG;TRACE`
 * — the same program — partition into two module identities, and every type,
 * method and expression below them forks.
 *
 * Four rules, each doing work:
 *
 * - **Deduplicated.** `DEBUG;DEBUG` is one symbol, and a list may repeat.
 * - **Sorted by ORDINAL code point**, not by locale. `Array.prototype.sort` with
 *   no comparator is ordinal by specification; `localeCompare` is not, and would
 *   make the key depend on the machine's collation.
 * - **Joined with `;`**, the separator MSBuild itself uses.
 * - **Case PRESERVED.** C# preprocessor symbols are case-sensitive: `DEBUG` and
 *   `Debug` are two symbols, and folding them would merge two programs.
 *
 * The set is the RESOLVED one — the caller's constants plus the implicit
 * framework symbols the SDK injects, which appear in no `.csproj` and no file.
 * Hashing only what was written would give `net8.0` and `netstandard2.0` the
 * same key while their `#if` branches differ, which is the exact collision
 * `targetFramework` is in the key to prevent.
 */
export function defineConstantsKeyOf(symbols: readonly string[]): string {
  if (symbols.length === 0) {
    // `""` reads as "no symbols". A digest here would read as "some symbols,
    // whose value happens to be this" — a different claim, and one no consumer
    // could distinguish from a real key.
    return '';
  }
  return EntityUtils.generateEntityHash(
    'CS_DEFINES',
    [...new Set(symbols)].sort().join(';')
  );
}

async function discoverCsFiles(
  dir: string,
  excludes: ReadonlySet<string>
): Promise<string[]> {
  const found: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!excludes.has(entry.name)) {
          stack.push(full);
        }
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.cs')) {
        found.push(full);
      }
    }
  }
  return found;
}
