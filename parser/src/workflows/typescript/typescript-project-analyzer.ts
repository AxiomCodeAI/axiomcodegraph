import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

import * as ts from 'typescript';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  TS_SKIP_DIRECTORIES,
  TS_SOURCE_EXTENSIONS,
  TYPESCRIPT_CSV_FILES,
} from '@/constants/typescript-constants';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import {
  extractTypeScriptFile,
  TsFileFacts,
} from '@/parsers/typescript/extractors/ts-fact-extractor';
import {
  accumulateFileCompleteness,
  finishCompleteness,
  IrCompletenessReport,
  linkAmbientModuleImports,
  linkReExportSources,
  ModuleGraphFacts,
  newCompletenessAccumulator,
} from '@/parsers/typescript/extractors/ts-ir-completeness';
import { moduleHashFor } from '@/parsers/typescript/extractors/ts-module-extractor';
import { TsConfigResolver } from '@/parsers/typescript/tsconfig-resolver';
import { TsRelationWriter } from './ts-relation-writer';
import { EntityUtils } from '@/utils/entity-utils';
import { stripTsExtension } from '@/parsers/typescript/ts-module-paths';

/**
 * Walks a TypeScript repository, extracts the fact spine, and exports it as TSV.
 *
 * ## Accumulate, then export, in a total order
 *
 * Byte-identical output across runs is a gate, not a nicety, and it is not
 * achievable by writing rows as they are found: filesystem enumeration order is
 * not stable across machines. Files are processed in SORTED path order, each
 * extractor emits in a deterministic order within a file, and every row is held
 * in memory until the whole run is done. The Java and Python analyzers do the
 * same, for the same reason.
 *
 * ## A program is the unit of merge scope, so it is the unit of analysis
 *
 * Files are grouped by their GOVERNING tsconfig. Two programs have two global
 * scopes: a global-script `AppConfig` in one is not the same symbol as a
 * global-script `AppConfig` in another, and merging them would be wrong in
 * exactly the direction that looks like successful cross-file merging. Within a
 * program, `GLOBAL` is unambiguous and cross-file merging is correct.
 *
 * The consequence to know: if one run covers several programs, their `GLOBAL`
 * declarations share a merge-scope key. `ts_module.tsConfigPath` distinguishes
 * them, and running one program per invocation avoids the question entirely —
 * which is what the gate does.
 */
/**
 * One output set, shared by every program a driver runs into it.
 *
 * Internal. `analyze()` creates its own when none is given, so the
 * single-program contract is unchanged.
 */
export interface SharedWriteContext {
  readonly writers: Map<string, TsRelationWriter>;
  readonly writerFor: (filename: string) => TsRelationWriter;
}

export interface TypeScriptAnalysisOptions {
  readonly rootDir: string;
  readonly outputDir: string;
  readonly baseMservPath: string;
  /**
   * The service version IDENTIFIER as the caller knows it — a tag, a commit.
   * HASHED here, exactly as Java and Python hash theirs, so the three languages
   * produce joinable values. Passing a raw string into a column named
   * `...LinkHash` is the mistake this exists to prevent.
   */
  readonly serviceVersionLink?: string;
  /** A pre-computed hash, for a caller that already has one. */
  readonly serviceVersionLinkHash?: string;
  readonly excludeDirs?: readonly string[];
}

export interface TypeScriptAnalysisSummary {
  readonly filesSeen: number;
  readonly filesAnalysed: number;
  /**
   * TypeScript files under `rootDir` that belong to a DIFFERENT program,
   * because a nested tsconfig claims them, and so were not analysed here.
   *
   * Not an error: a nested tsconfig is a separate program with its own global
   * scope, and analysing its files under this root would merge two scopes tsc
   * keeps apart. But it is not nothing either. One monorepo nests 30 tsconfigs inside
   * a root whose `include` also covers them, and 534 of its 1,015 files landed
   * here -- silently, because nothing counted them. Each such subtree has to be
   * analysed as its own root to be covered at all.
   */
  readonly filesInOtherPrograms: number;
  /**
   * The roots of those other programs, so a caller can analyse them.
   *
   * A count alone says work is missing without saying where. These are the
   * directories to point another run at: on a monorepo they are the package
   * and integration-test roots, and running each one covers the files this run
   * deliberately left out. Ordered by how many files each accounts for.
   */
  readonly nestedProgramRoots: readonly string[];
  readonly extractionErrors: number;
  readonly counts: Record<string, number>;
  /**
   * IR COMPLETENESS, not a resolution rate.
   *
   * Named for what it measures. The parser emits IR and the engine builds the
   * call graph, so "what fraction did the parser resolve" is the wrong question
   * — Java resolves 0 of its 67,938 type references and that is the design. The
   * right question is whether every hop an engine needs was emitted.
   */
  readonly irCompleteness: IrCompletenessReport;
}


interface SkippedTypeScriptFile {
  filePath: string;
  baseMservPath: string;
  serviceVersionLinkHash: string;
  reason: SkippedFileReason;
  detail: string;
}


export class TypeScriptProjectAnalyzer {
  private skippedFiles: SkippedTypeScriptFile[] = [];

  /**
   * Extracts every PROGRAM under `rootDir` into ONE output directory.
   *
   * A discovered project is not one program. A monorepo root's tsconfig claims
   * only the files at the top, and every package below it is a separate
   * program with a separate global scope -- so analysing the root alone
   * extracted 24 of 965 files on one such repository. The analyser already
   * named the roots it declined; nothing consumed them.
   *
   * The output layout is unchanged: one flat set of relations, as Java
   * produces by taking every project in a single call. What stays PER PROGRAM
   * is the part that must -- the module link passes run within one program's
   * facts, so an import is never linked to an ambient module declared in a
   * different program's global scope.
   */
  async analyzePrograms(
    options: TypeScriptAnalysisOptions
  ): Promise<TypeScriptAnalysisSummary> {
    const shared = this.newSharedWriteContext(options.outputDir);
    const summaries: TypeScriptAnalysisSummary[] = [];
    // A nested program can nest further, so roots drain from a queue rather
    // than one level of walking. Keyed by resolved path because two programs
    // can decline files to each other, which would otherwise recur forever.
    const queue = [path.resolve(options.rootDir)];
    const visited = new Set<string>(queue);
    while (queue.length > 0) {
      const programRoot = queue.shift()!;
      const summary = await this.analyze({ ...options, rootDir: programRoot }, shared);
      summaries.push(summary);
      for (const nested of summary.nestedProgramRoots) {
        const resolved = path.resolve(nested);
        if (!visited.has(resolved)) {
          visited.add(resolved);
          queue.push(resolved);
        }
      }
    }
    await this.publishShared(shared);
    return mergeSummaries(summaries);
  }

  private newSharedWriteContext(outputDir: string): SharedWriteContext {
    const suffix = `${process.pid}.${this.writeSequence}`;
    this.writeSequence += 1;
    const writers = new Map<string, TsRelationWriter>();
    return {
      writers,
      writerFor: (filename: string): TsRelationWriter => {
        const existing = writers.get(filename);
        if (existing) {
          return existing;
        }
        const created = new TsRelationWriter(outputDir, filename, suffix);
        writers.set(filename, created);
        return created;
      },
    };
  }

  /** Publishes a shared set, or discards every temporary if any one fails. */
  private async publishShared(shared: SharedWriteContext): Promise<void> {
    // Every relation gets a file even if no row reached it, so a consumer can
    // tell "no rows" from "the parser never ran".
    for (const filename of Object.values(TYPESCRIPT_CSV_FILES)) {
      if (filename !== TYPESCRIPT_CSV_FILES.SKIPPED_FILES) {
        shared.writerFor(filename);
      }
    }
    try {
      for (const writer of shared.writers.values()) {
        await writer.publish();
      }
    } catch (error) {
      // A relation that failed verification must not leave the others' temp
      // files behind, and must not publish a partial set as if it were whole.
      for (const writer of shared.writers.values()) {
        await writer.discard();
      }
      throw error;
    }
  }

  async analyze(
    options: TypeScriptAnalysisOptions,
    shared?: SharedWriteContext
  ): Promise<TypeScriptAnalysisSummary> {
    const serviceVersionLinkHash = options.serviceVersionLink !== undefined
      ? EntityUtils.generateEntityHash(
          ENTITY_IDENTIFIERS.SERVICE_VERSION,
          options.serviceVersionLink
        )
      : options.serviceVersionLinkHash ?? '';

    const rootDir = path.resolve(options.rootDir);
    const excludes = new Set<string>(options.excludeDirs ?? TS_SKIP_DIRECTORIES);
    const configResolver = new TsConfigResolver();
    // A PROGRAM is the unit of merge scope, so when the root declares one its
    // file list wins over a directory walk. This is not an optimisation: a
    // tsconfig that excludes a subtree is saying those files belong to a
    // DIFFERENT program with a different global scope, and analysing them here
    // would merge two global scopes that tsc keeps apart. The fixture corpus
    // relies on exactly that — `staging/tsconfig.json` excludes three subtrees,
    // each of which has its own config and its own expectations.
    // Every emitted path hangs off this, not off rootDir — see pathAnchorFor.
    const pathAnchor = pathAnchorFor(rootDir, options.baseMservPath);
    const rootProgram = filesOfRootProgram(rootDir, configResolver);
    const files = (rootProgram?.files ?? collectTypeScriptFiles(rootDir, excludes)).sort();
    const filesInOtherPrograms = rootProgram?.others.length ?? 0;
    const nestedProgramRoots = programRootsOf(rootProgram?.others ?? [], configResolver);

    // Every module hash up front, from PATHS ALONE. This is what lets a module
    // augmentation in file B key its declarations under file A's hash without
    // file A having been parsed — cross-file merging needs no dependency order.
    const projectModuleHashes = new Map<string, string>();
    for (const file of files) {
      projectModuleHashes.set(
        path.normalize(file),
        moduleHashFor(toRelative(pathAnchor, file), options.baseMservPath, serviceVersionLinkHash)
      );
    }
    const toProjectRelative = (absolutePath: string): string =>
      stripExtension(toRelative(pathAnchor, absolutePath));

    this.skippedFiles = [];
    await fsp.mkdir(options.outputDir, { recursive: true });
    //
    // Rows are STREAMED, not accumulated.
    //
    // Holding every row of every relation until the last file was parsed is a
    // ceiling and not a cost: a large single-tree project exhausted a 12 GB
    // heap with mark-compact pauses reaching 49 s. A row is finished the moment
    // its file is, and nothing downstream of extraction reads it back.
    //
    // Three relations are exceptions, and all three are small. The module link
    // passes MUTATE `ts_import` and `ts_export` after every file is parsed --
    // an import of `declare module "x"` cannot be linked until the file
    // declaring it has been read -- and they index `ts_module` to do it. Those
    // are held; the other seventeen, including `ts_expression` at over half
    // the output, are written as they are produced.
    // When a caller is driving several programs into one output set, the
    // writers belong to that caller and are published once at the end.
    const ownWriteContext = shared ?? this.newSharedWriteContext(options.outputDir);
    const { writerFor } = ownWriteContext;
    const moduleGraph: ModuleGraphFacts[] = [];
    const completenessAccumulator = newCompletenessAccumulator();
    let analysed = 0;

    for (const file of files) {
      let sourceText: string;
      try {
        sourceText = await fsp.readFile(file, 'utf-8');
      } catch (error) {
        this.recordSkip(file, pathAnchor, options, serviceVersionLinkHash,
          SkippedFileReason.READ_ERROR, String(error));
        continue;
      }
      const governing = configResolver.resolve(file);
      let facts: TsFileFacts;
      try {
        facts = extractTypeScriptFile({
          absoluteFilePath: file,
          filePath: toRelative(pathAnchor, file),
          baseMservPath: options.baseMservPath,
          moduleQualifiedName: toProjectRelative(file),
          sourceText,
          serviceVersionLinkHash,
          tsConfigPath: governing.configPath === ''
            ? ''
            : toRelative(pathAnchor, governing.configPath),
          moduleResolutionMode: governing.moduleResolutionMode,
          // Per file, from the config that actually claims it. `legacy/` in the
          // fixture corpus compiles under experimentalDecorators while its
          // siblings do not, and the source is identical either way.
          decoratorSystem: governing.decoratorSystem,
          compilerOptions: governing.options,
          packageName: '',
          projectModuleHashes,
          toProjectRelative,
        });
      } catch (error) {
        // An extraction error is a DEFECT, never a decision. Counted apart from
        // anything else so a parser that throws on every file cannot report a
        // clean run with empty relations.
        this.recordSkip(file, pathAnchor, options, serviceVersionLinkHash,
          SkippedFileReason.EXTRACTION_ERROR, String(error));
        continue;
      }
      analysed += 1;
      // Measured HERE, before the row is let go. The measurement was already
      // per-file: the two indexes it called cross-file were keyed by a file's
      // own module hash and read back under that same key.
      accumulateFileCompleteness(facts, completenessAccumulator);
      moduleGraph.push({
        filePath: facts.filePath,
        modules: facts.modules,
        imports: facts.imports,
        exports: facts.exports,
      });
      await writerFor(TYPESCRIPT_CSV_FILES.TYPES).append(facts.types);
      await writerFor(TYPESCRIPT_CSV_FILES.TYPE_HERITAGES).append(facts.heritages);
      await writerFor(TYPESCRIPT_CSV_FILES.TYPE_PARAMETERS).append(facts.typeParameters);
      await writerFor(TYPESCRIPT_CSV_FILES.TYPE_REFERENCES).append(facts.typeReferences);
      await writerFor(TYPESCRIPT_CSV_FILES.METHODS).append(facts.methods);
      await writerFor(TYPESCRIPT_CSV_FILES.METHOD_PARAMETERS).append(facts.methodParameters);
      await writerFor(TYPESCRIPT_CSV_FILES.FIELDS).append(facts.fields);
      await writerFor(TYPESCRIPT_CSV_FILES.VARIABLES).append(facts.variables);
      await writerFor(TYPESCRIPT_CSV_FILES.EXPRESSIONS).append(facts.expressions);
      await writerFor(TYPESCRIPT_CSV_FILES.CALL_SITES).append(facts.callSites);
      await writerFor(TYPESCRIPT_CSV_FILES.BLOCKS).append(facts.blocks);
      await writerFor(TYPESCRIPT_CSV_FILES.DECORATORS).append(facts.decorators);
      await writerFor(TYPESCRIPT_CSV_FILES.DECORATOR_ARGUMENTS).append(facts.decoratorArguments);
      await writerFor(TYPESCRIPT_CSV_FILES.ENUM_MEMBERS).append(facts.enumMembers);
      await writerFor(TYPESCRIPT_CSV_FILES.FIELD_POSITIONS).append(facts.fieldPositions);
      await writerFor(TYPESCRIPT_CSV_FILES.COMMENTS).append(facts.comments);
      await writerFor(TYPESCRIPT_CSV_FILES.PARSE_GAPS).append(facts.parseGaps);
    }

    // The MODULE graph is the parser's, and it needs every file: an import of
    // `declare module "x"` can only be linked once the file declaring it has
    // been read. This stops one hop short of the call graph, at the module,
    // which is where `type-resolution.dl` takes over.
    linkAmbientModuleImports(moduleGraph);
    // A re-export's source module may be parsed after the file that re-exports
    // from it, so the link is made here. Still the MODULE graph, and
    // ts_export.resolvedSourceModuleLinkHash is the parser's own column.
    linkReExportSources(moduleGraph);
    // Reads the accumulated rows and mutates nothing. Cross-file CALL resolution
    // used to happen here and has been retracted: following an import to a
    // declaring file is `type-resolution.dl` rewritten in TypeScript. What runs
    // instead asks whether the facts an engine needs to make those joins were
    // emitted.
    // Settles the dynamic-import verdicts that waited for the link passes,
    // which is the only part of the measurement that could not run per file.
    const completeness = finishCompleteness(completenessAccumulator);

    // The three held relations, now that the link passes have filled their
    // columns. Written through the same streaming writer so every relation
    // gets one code path, one temp-name scheme and one read-back.
    for (const facts of moduleGraph) {
      await writerFor(TYPESCRIPT_CSV_FILES.MODULES).append(facts.modules);
      await writerFor(TYPESCRIPT_CSV_FILES.IMPORTS).append(facts.imports);
      await writerFor(TYPESCRIPT_CSV_FILES.EXPORTS).append(facts.exports);
    }
    // Published here only when this call OWNS the writers. A caller driving
    // several programs into one set publishes once, after the last of them.
    if (shared === undefined) {
      await this.publishShared(ownWriteContext);
    }
    await this.exportSkippedFilesCsv(options.outputDir);

    return {
      filesSeen: files.length,
      filesAnalysed: analysed,
      filesInOtherPrograms,
      nestedProgramRoots,
      extractionErrors: this.skippedFiles.filter(
        (f) => f.reason === SkippedFileReason.EXTRACTION_ERROR
      ).length,
      counts: {
        ts_module: writerFor(TYPESCRIPT_CSV_FILES.MODULES).rowCount,
        ts_type: writerFor(TYPESCRIPT_CSV_FILES.TYPES).rowCount,
        ts_type_heritage: writerFor(TYPESCRIPT_CSV_FILES.TYPE_HERITAGES).rowCount,
        ts_type_parameter: writerFor(TYPESCRIPT_CSV_FILES.TYPE_PARAMETERS).rowCount,
        ts_type_reference: writerFor(TYPESCRIPT_CSV_FILES.TYPE_REFERENCES).rowCount,
        ts_method: writerFor(TYPESCRIPT_CSV_FILES.METHODS).rowCount,
        ts_method_parameter: writerFor(TYPESCRIPT_CSV_FILES.METHOD_PARAMETERS).rowCount,
        ts_field: writerFor(TYPESCRIPT_CSV_FILES.FIELDS).rowCount,
        ts_variable: writerFor(TYPESCRIPT_CSV_FILES.VARIABLES).rowCount,
        ts_import: writerFor(TYPESCRIPT_CSV_FILES.IMPORTS).rowCount,
        ts_expression: writerFor(TYPESCRIPT_CSV_FILES.EXPRESSIONS).rowCount,
        ts_call_site: writerFor(TYPESCRIPT_CSV_FILES.CALL_SITES).rowCount,
        ts_block: writerFor(TYPESCRIPT_CSV_FILES.BLOCKS).rowCount,
        ts_decorator: writerFor(TYPESCRIPT_CSV_FILES.DECORATORS).rowCount,
        ts_decorator_argument: writerFor(TYPESCRIPT_CSV_FILES.DECORATOR_ARGUMENTS).rowCount,
        ts_enum_member: writerFor(TYPESCRIPT_CSV_FILES.ENUM_MEMBERS).rowCount,
        ts_field_position: writerFor(TYPESCRIPT_CSV_FILES.FIELD_POSITIONS).rowCount,
        ts_export: writerFor(TYPESCRIPT_CSV_FILES.EXPORTS).rowCount,
        ts_comment: writerFor(TYPESCRIPT_CSV_FILES.COMMENTS).rowCount,
        ts_parse_gap: writerFor(TYPESCRIPT_CSV_FILES.PARSE_GAPS).rowCount,
      },
      irCompleteness: completeness,
    };
  }

  getSkippedFiles(): readonly SkippedTypeScriptFile[] {
    return this.skippedFiles;
  }

  private recordSkip(
    file: string,
    pathAnchor: string,
    options: TypeScriptAnalysisOptions,
    serviceVersionLinkHash: string,
    reason: SkippedFileReason,
    detail: string
  ): void {
    this.skippedFiles.push({
      filePath: toRelative(pathAnchor, file),
      baseMservPath: options.baseMservPath,
      serviceVersionLinkHash,
      reason,
      detail: detail.replace(/[\t\n\r]+/g, ' ').slice(0, 300),
    });
  }

  /** Writes one relation, chunked — a single joined string overflows V8's string limit. */

  /**
   * One handle, verified, then an atomic rename.
   *
   * The temporary name is UNIQUE per write. A fixed `<file>.partial` is shared
   * by every writer aimed at the same output directory: two of them open it
   * with 'w', each keeps its own offset, and the bytes interleave -- so the
   * published file begins mid-value rather than being truncated at the end.
   * The same collision also makes the rename itself race, and the loser fails
   * with ENOENT because the winner already moved the file away.
   *
   * The read-back is what makes "fail if a row is torn" a promise to every
   * consumer rather than an assertion the gate makes over its own fixtures. It
   * costs one extra read per relation and turns a bad file into a loud failure
   * instead of a shipped artefact -- which is the whole point, since a torn row
   * loads cleanly and counts wrong.
   */
  private async writeAtomically(outputPath: string, parts: readonly string[]): Promise<void> {
    const temporaryPath = `${outputPath}.${process.pid}.${this.writeSequence}.partial`;
    this.writeSequence += 1;
    const handle = await fsp.open(temporaryPath, 'w');
    try {
      for (const part of parts) {
        if (part !== '') {
          await handle.write(part, null, 'utf-8');
        }
      }
      // Durable before the rename, so a crash cannot leave the destination
      // pointing at a file whose bytes never reached the disk.
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      verifyRelationFile(temporaryPath, outputPath);
    } catch (error) {
      await fsp.rm(temporaryPath, { force: true });
      throw error;
    }
    await fsp.rename(temporaryPath, outputPath);
  }

  /** Distinguishes concurrent writes within one process; the pid does the rest. */
  private writeSequence = 0;

  private async exportSkippedFilesCsv(outputDir: string): Promise<void> {
    const header = ['filePath', 'baseMservPath', 'serviceVersionLinkHash', 'reason', 'detail']
      .join('\t');
    const rows = [...this.skippedFiles]
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map((f) => [f.filePath, f.baseMservPath, f.serviceVersionLinkHash, f.reason, f.detail]
        .join('\t'));
    await this.writeAtomically(
      path.join(outputDir, TYPESCRIPT_CSV_FILES.SKIPPED_FILES),
      [[header, ...rows].join('\n') + '\n']
    );
  }
}

/**
 * The files of the program rooted at `rootDir`, or `undefined` if it declares none.
 *
 * `undefined` and an empty list are different answers and must stay different:
 * no tsconfig means "walk the directory", while a tsconfig that claims nothing
 * means "this program is empty" and walking anyway would analyse files the
 * program deliberately excludes.
 */
function filesOfRootProgram(
  rootDir: string,
  configResolver: TsConfigResolver
): { readonly files: string[]; readonly others: string[] } | undefined {
  const configPath = path.join(rootDir, 'tsconfig.json');
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  const claimed: string[] = [];
  const unclaimed: string[] = [];
  const others: string[] = [];
  for (const file of collectTypeScriptFiles(rootDir, new Set(TS_SKIP_DIRECTORIES))) {
    const governing = configResolver.resolve(file);
    if (path.resolve(governing.configPath) === path.resolve(configPath)) {
      claimed.push(file);
    } else if (governing.configPath === '') {
      unclaimed.push(file);
    } else {
      others.push(file);
    }
  }

  // A program is its roots PLUS everything they import.
  //
  // `files: ["./src/immer.ts", …]` names ENTRY POINTS, not a file list; tsc
  // then follows imports transitively. Reading the config literally gave immer
  // 4 files where the real program has 17, so 13 files and 61% of its call
  // sites were invisible. Nothing reported it, because a file that no config
  // claims is not an error — it simply never arrives.
  //
  // The closure only pulls in files that NO OTHER config claims. A file owned
  // by a nested tsconfig stays in that program, which is what keeps a nested
  // project's separate global scope separate.
  const rootOptions = configResolver.resolve(claimed[0] ?? configPath).options;
  const included = new Set(claimed.map((f) => path.normalize(f)));
  const available = new Map(unclaimed.map((f) => [path.normalize(f), f]));
  const queue = [...claimed];
  while (queue.length > 0) {
    const current = queue.pop()!;
    let text: string;
    try {
      text = fs.readFileSync(current, 'utf-8');
    } catch {
      continue;
    }
    // No parent pointers and no type nodes needed: this pass only reads
    // specifiers, so the cheapest possible parse is the right one.
    const sf = ts.createSourceFile(current, text, ts.ScriptTarget.Latest, false,
      current.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const specifier of importSpecifiersOf(sf)) {
      const resolved = ts.resolveModuleName(specifier, current, rootOptions, ts.sys)
        .resolvedModule?.resolvedFileName;
      if (resolved === undefined) {
        continue;
      }
      const key = path.normalize(resolved);
      if (included.has(key) || !available.has(key)) {
        continue;
      }
      included.add(key);
      queue.push(available.get(key)!);
    }
  }

  const files = [...included].map((f) => available.get(f) ?? f);
  const pulled = new Set(files.map((f) => path.normalize(f)));
  for (const f of unclaimed) {
    if (!pulled.has(path.normalize(f))) {
      others.push(f);
    }
  }
  return { files, others };
}

/**
 * The distinct program roots that own `files`, busiest first.
 *
 * Reporting a count of excluded files tells a caller that something is missing
 * without telling them what to do about it. These are the directories to point
 * a further run at.
 */
function programRootsOf(
  files: readonly string[],
  configResolver: TsConfigResolver
): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const governing = configResolver.resolve(file);
    if (governing.configPath === '') {
      continue;
    }
    const root = path.dirname(path.resolve(governing.configPath));
    counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([root]) => root);
}

/** Every module specifier a file imports, re-exports, or imports dynamically. */
function importSpecifiersOf(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined
      && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && ts.isStringLiteral(node.moduleReference.expression)) {
      out.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length > 0
      && ts.isStringLiteral(node.arguments[0]!)) {
      out.push((node.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

/**
 * Every row is exactly as wide as the header, and the file ends in a newline.
 *
 * Read back from what was actually written, not from the strings that were
 * meant to be written -- a check over the in-memory rows cannot see a short
 * write, and a short write is the failure being guarded against.
 */
function verifyRelationFile(temporaryPath: string, outputPath: string): void {
  const text = fs.readFileSync(temporaryPath, 'utf-8');
  if (text === '') {
    return;
  }
  if (!text.endsWith('\n')) {
    throw new Error(`${path.basename(outputPath)}: the write did not end in a newline, so the `
      + 'last row is truncated');
  }
  // Split the way a CONSUMER splits, not the way JavaScript does. Python's
  // str.splitlines() breaks on U+000B, U+000C, U+001C-1E, U+0085, U+2028 and
  // U+2029; `split('\n')` does not. A value carrying one of those produced a
  // file this check called well formed and the reader called torn -- the worst
  // available disagreement, because the parser certified an artefact it could
  // not read the same way as its consumer.
  const lines = text.split(/[\u000A\u000B\u000C\u000D\u001C\u001D\u001E\u0085\u2028\u2029]/);
  const header = lines[0];
  if (header === undefined || header === '') {
    return;
  }
  const width = header.split('\t').length;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || line === '') {
      continue;
    }
    const got = line.split('\t').length;
    if (got !== width) {
      throw new Error(`${path.basename(outputPath)}: line ${i + 1} has ${got} field(s) where the `
        + `header has ${width} — the row is torn: ${JSON.stringify(line.slice(0, 60))}`);
    }
  }
}

function collectTypeScriptFiles(dir: string, excludes: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      // Synchronous on purpose: this walk produces the module-hash table, which
      // every later step needs complete before any file is parsed.
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!excludes.has(entry.name) && !entry.name.startsWith('.')) {
          walk(full);
        }
        continue;
      }
      if (TS_SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

function toRelative(rootDir: string, file: string): string {
  return path.relative(rootDir, file).split(path.sep).join('/') || path.basename(file);
}

/**
 * The directory every emitted path is relative TO.
 *
 * §4.4 says `filePath` is **repo-relative**, and the module PK is
 * `md5(filePath ‖ baseMservPath ‖ …)`. Anchoring on `rootDir` instead broke both
 * on a workspace: analysing `packages/alpha` with the repo root as
 * `baseMservPath` emitted `src/Project.ts`, so `baseMservPath + filePath` named
 * a file that does not exist, and `packages/beta/src/Project.ts` produced the
 * BYTE-IDENTICAL primary key. Two packages' files were one row.
 *
 * `baseMservPath` wins whenever it actually contains the tree being analysed --
 * which is the workspace case, and is exactly when a qualifier is needed. It is
 * caller-supplied, so a value that does not contain `rootDir` is ignored rather
 * than trusted: a single-project run passes the two equal and is unaffected.
 */
function pathAnchorFor(rootDir: string, baseMservPath: string): string {
  if (baseMservPath === '') {
    return rootDir;
  }
  const base = path.resolve(baseMservPath);
  const root = path.resolve(rootDir);
  const contained = root === base || root.startsWith(base + path.sep);
  return contained ? base : root;
}

function stripExtension(relativePath: string): string {
  return stripTsExtension(relativePath);
}

/** Re-exported so a caller can create a source file the same way the extractor does. */
export const TYPESCRIPT_SCRIPT_TARGET = ts.ScriptTarget.Latest;

/**
 * One report for several programs written into one output set.
 *
 * Row counts come from the WRITERS, which already span every program, so they
 * are read once rather than summed -- summing per-program counts would double
 * every relation. File counts are per program and do sum.
 */
function mergeSummaries(
  summaries: readonly TypeScriptAnalysisSummary[]
): TypeScriptAnalysisSummary {
  const sum = (pick: (s: TypeScriptAnalysisSummary) => number): number =>
    summaries.reduce((total, s) => total + pick(s), 0);
  const last = summaries[summaries.length - 1];
  return {
    filesSeen: sum((s) => s.filesSeen),
    filesAnalysed: sum((s) => s.filesAnalysed),
    // Files in another program are now ANALYSED by the driver rather than
    // declined, so the last program's figure is what no program claims at all.
    filesInOtherPrograms: last?.filesInOtherPrograms ?? 0,
    nestedProgramRoots: [],
    extractionErrors: sum((s) => s.extractionErrors),
    // Row counts are read from the SHARED writers, which already span every
    // program. Summing the per-program counts would multiply every relation,
    // because each program's summary reports the running total.
    counts: last?.counts ?? {},
    irCompleteness: mergeCompleteness(summaries.map((s) => s.irCompleteness)),
  };
}

/** Adds up per-program completeness reports. Each program measures its own. */
function mergeCompleteness(reports: readonly IrCompletenessReport[]): IrCompletenessReport {
  const sum = (pick: (r: IrCompletenessReport) => number): number =>
    reports.reduce((total, r) => total + pick(r), 0);
  const byReceiverKind: Record<string, {
    total: number; sameFileLinks: number; terminals: number; complete: number;
    incomplete: number; inferred: number; notDerivable: number;
  }> = {};
  for (const report of reports) {
    for (const [shape, counts] of Object.entries(report.byReceiverKind)) {
      const bucket = byReceiverKind[shape] ?? {
        total: 0, sameFileLinks: 0, terminals: 0, complete: 0, incomplete: 0, inferred: 0,
        notDerivable: 0,
      };
      bucket.total += counts.total;
      bucket.sameFileLinks += counts.sameFileLinks;
      bucket.terminals += counts.terminals;
      bucket.complete += counts.complete;
      bucket.incomplete += counts.incomplete;
      bucket.inferred += counts.inferred;
      bucket.notDerivable += counts.notDerivable;
      byReceiverKind[shape] = bucket;
    }
  }
  return {
    callSites: sum((r) => r.callSites),
    sameFileLinks: sum((r) => r.sameFileLinks),
    terminals: sum((r) => r.terminals),
    handedOffComplete: sum((r) => r.handedOffComplete),
    handedOffIncomplete: sum((r) => r.handedOffIncomplete),
    inferredReceiver: sum((r) => r.inferredReceiver),
    notDerivable: sum((r) => r.notDerivable),
    gaps: reports.flatMap((r) => r.gaps),
    byReceiverKind,
  };
}
