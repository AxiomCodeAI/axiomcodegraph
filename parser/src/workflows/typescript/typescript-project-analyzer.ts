import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

import * as ts from 'typescript';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  TS_CSV_CHUNK_SIZE,
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
  IrCompletenessReport,
  linkAmbientModuleImports,
  linkReExportSources,
  measureIrCompleteness,
} from '@/parsers/typescript/extractors/ts-ir-completeness';
import { moduleHashFor } from '@/parsers/typescript/extractors/ts-module-extractor';
import { TsConfigResolver } from '@/parsers/typescript/tsconfig-resolver';
import { EntityUtils } from '@/utils/entity-utils';

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
   * keeps apart. But it is not nothing either. NestJS nests 30 tsconfigs inside
   * a root whose `include` also covers them, and 534 of its 1,015 files landed
   * here -- silently, because nothing counted them. Each such subtree has to be
   * analysed as its own root to be covered at all.
   */
  readonly filesInOtherPrograms: number;
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

interface CsvRow {
  toCsv(): string;
  getCsvHeader(): string;
}

export class TypeScriptProjectAnalyzer {
  private skippedFiles: SkippedTypeScriptFile[] = [];

  async analyze(options: TypeScriptAnalysisOptions): Promise<TypeScriptAnalysisSummary> {
    const serviceVersionLinkHash = options.serviceVersionLink !== undefined
      ? EntityUtils.generateEntityHash(
          ENTITY_IDENTIFIERS.SERVICE_VERSION,
          options.serviceVersionLink
        )
      : options.serviceVersionLinkHash ?? '';

    const rootDir = path.resolve(options.rootDir);
    const excludes = new Set<string>(options.excludeDirs ?? TS_SKIP_DIRECTORIES);
    const configResolver = new TsConfigResolver(rootDir);
    // A PROGRAM is the unit of merge scope, so when the root declares one its
    // file list wins over a directory walk. This is not an optimisation: a
    // tsconfig that excludes a subtree is saying those files belong to a
    // DIFFERENT program with a different global scope, and analysing them here
    // would merge two global scopes that tsc keeps apart. The fixture corpus
    // relies on exactly that — `staging/tsconfig.json` excludes three subtrees,
    // each of which has its own config and its own expectations.
    const rootProgram = filesOfRootProgram(rootDir, configResolver);
    const files = (rootProgram?.files ?? collectTypeScriptFiles(rootDir, excludes)).sort();
    const filesInOtherPrograms = rootProgram?.others.length ?? 0;

    // Every module hash up front, from PATHS ALONE. This is what lets a module
    // augmentation in file B key its declarations under file A's hash without
    // file A having been parsed — cross-file merging needs no dependency order.
    const projectModuleHashes = new Map<string, string>();
    for (const file of files) {
      projectModuleHashes.set(
        path.normalize(file),
        moduleHashFor(toRelative(rootDir, file), options.baseMservPath, serviceVersionLinkHash)
      );
    }
    const toProjectRelative = (absolutePath: string): string =>
      stripExtension(toRelative(rootDir, absolutePath));

    this.skippedFiles = [];
    const accumulated: Record<string, CsvRow[]> = {
      modules: [], types: [], typeHeritages: [], typeParameters: [], typeReferences: [], methods: [],
      methodParameters: [], fields: [], variables: [], imports: [], expressions: [],
      callSites: [], blocks: [], decorators: [], decoratorArguments: [],
      enumMembers: [], fieldPositions: [], exports: [], comments: [], parseGaps: [],
    };
    const perFile: TsFileFacts[] = [];
    let analysed = 0;

    for (const file of files) {
      let sourceText: string;
      try {
        sourceText = await fsp.readFile(file, 'utf-8');
      } catch (error) {
        this.recordSkip(file, rootDir, options, serviceVersionLinkHash,
          SkippedFileReason.READ_ERROR, String(error));
        continue;
      }
      const governing = configResolver.resolve(file);
      let facts: TsFileFacts;
      try {
        facts = extractTypeScriptFile({
          absoluteFilePath: file,
          filePath: toRelative(rootDir, file),
          baseMservPath: options.baseMservPath,
          moduleQualifiedName: toProjectRelative(file),
          sourceText,
          serviceVersionLinkHash,
          tsConfigPath: governing.configPath === ''
            ? ''
            : toRelative(rootDir, governing.configPath),
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
        this.recordSkip(file, rootDir, options, serviceVersionLinkHash,
          SkippedFileReason.EXTRACTION_ERROR, String(error));
        continue;
      }
      analysed += 1;
      perFile.push(facts);
      accumulated.modules!.push(...facts.modules);
      accumulated.types!.push(...facts.types);
      accumulated.typeHeritages!.push(...facts.heritages);
      accumulated.typeParameters!.push(...facts.typeParameters);
      accumulated.typeReferences!.push(...facts.typeReferences);
      accumulated.methods!.push(...facts.methods);
      accumulated.methodParameters!.push(...facts.methodParameters);
      accumulated.fields!.push(...facts.fields);
      accumulated.variables!.push(...facts.variables);
      accumulated.imports!.push(...facts.imports);
      accumulated.expressions!.push(...facts.expressions);
      accumulated.callSites!.push(...facts.callSites);
      accumulated.blocks!.push(...facts.blocks);
      accumulated.decorators!.push(...facts.decorators);
      accumulated.decoratorArguments!.push(...facts.decoratorArguments);
      accumulated.enumMembers!.push(...facts.enumMembers);
      accumulated.fieldPositions!.push(...facts.fieldPositions);
      accumulated.exports!.push(...facts.exports);
      accumulated.comments!.push(...facts.comments);
      accumulated.parseGaps!.push(...facts.parseGaps);
    }

    // The MODULE graph is the parser's, and it needs every file: an import of
    // `declare module "x"` can only be linked once the file declaring it has
    // been read. This stops one hop short of the call graph, at the module,
    // which is where `type-resolution.dl` takes over.
    linkAmbientModuleImports(perFile);
    // A re-export's source module may be parsed after the file that re-exports
    // from it, so the link is made here. Still the MODULE graph, and
    // ts_export.resolvedSourceModuleLinkHash is the parser's own column.
    linkReExportSources(perFile);
    // Reads the accumulated rows and mutates nothing. Cross-file CALL resolution
    // used to happen here and has been retracted: following an import to a
    // declaring file is `type-resolution.dl` rewritten in TypeScript. What runs
    // instead asks whether the facts an engine needs to make those joins were
    // emitted.
    const completeness = measureIrCompleteness(perFile);

    await fsp.mkdir(options.outputDir, { recursive: true });
    await this.exportCsv(accumulated.modules!, options.outputDir, TYPESCRIPT_CSV_FILES.MODULES);
    await this.exportCsv(accumulated.types!, options.outputDir, TYPESCRIPT_CSV_FILES.TYPES);
    await this.exportCsv(accumulated.typeHeritages!, options.outputDir,
      TYPESCRIPT_CSV_FILES.TYPE_HERITAGES);
    await this.exportCsv(accumulated.typeParameters!, options.outputDir,
      TYPESCRIPT_CSV_FILES.TYPE_PARAMETERS);
    await this.exportCsv(accumulated.typeReferences!, options.outputDir,
      TYPESCRIPT_CSV_FILES.TYPE_REFERENCES);
    await this.exportCsv(accumulated.methods!, options.outputDir, TYPESCRIPT_CSV_FILES.METHODS);
    await this.exportCsv(accumulated.methodParameters!, options.outputDir,
      TYPESCRIPT_CSV_FILES.METHOD_PARAMETERS);
    await this.exportCsv(accumulated.fields!, options.outputDir, TYPESCRIPT_CSV_FILES.FIELDS);
    await this.exportCsv(accumulated.variables!, options.outputDir,
      TYPESCRIPT_CSV_FILES.VARIABLES);
    await this.exportCsv(accumulated.imports!, options.outputDir, TYPESCRIPT_CSV_FILES.IMPORTS);
    await this.exportCsv(accumulated.expressions!, options.outputDir,
      TYPESCRIPT_CSV_FILES.EXPRESSIONS);
    await this.exportCsv(accumulated.callSites!, options.outputDir,
      TYPESCRIPT_CSV_FILES.CALL_SITES);
    await this.exportCsv(accumulated.blocks!, options.outputDir, TYPESCRIPT_CSV_FILES.BLOCKS);
    await this.exportCsv(accumulated.decorators!, options.outputDir,
      TYPESCRIPT_CSV_FILES.DECORATORS);
    await this.exportCsv(accumulated.decoratorArguments!, options.outputDir,
      TYPESCRIPT_CSV_FILES.DECORATOR_ARGUMENTS);
    await this.exportCsv(accumulated.enumMembers!, options.outputDir,
      TYPESCRIPT_CSV_FILES.ENUM_MEMBERS);
    await this.exportCsv(accumulated.fieldPositions!, options.outputDir,
      TYPESCRIPT_CSV_FILES.FIELD_POSITIONS);
    await this.exportCsv(accumulated.exports!, options.outputDir,
      TYPESCRIPT_CSV_FILES.EXPORTS);
    await this.exportCsv(accumulated.comments!, options.outputDir,
      TYPESCRIPT_CSV_FILES.COMMENTS);
    await this.exportCsv(accumulated.parseGaps!, options.outputDir,
      TYPESCRIPT_CSV_FILES.PARSE_GAPS);
    await this.exportSkippedFilesCsv(options.outputDir);

    return {
      filesSeen: files.length,
      filesAnalysed: analysed,
      filesInOtherPrograms,
      extractionErrors: this.skippedFiles.filter(
        (f) => f.reason === SkippedFileReason.EXTRACTION_ERROR
      ).length,
      counts: {
        ts_module: accumulated.modules!.length,
        ts_type: accumulated.types!.length,
        ts_type_heritage: accumulated.typeHeritages!.length,
        ts_type_parameter: accumulated.typeParameters!.length,
        ts_type_reference: accumulated.typeReferences!.length,
        ts_method: accumulated.methods!.length,
        ts_method_parameter: accumulated.methodParameters!.length,
        ts_field: accumulated.fields!.length,
        ts_variable: accumulated.variables!.length,
        ts_import: accumulated.imports!.length,
        ts_expression: accumulated.expressions!.length,
        ts_call_site: accumulated.callSites!.length,
        ts_block: accumulated.blocks!.length,
        ts_decorator: accumulated.decorators!.length,
        ts_decorator_argument: accumulated.decoratorArguments!.length,
        ts_enum_member: accumulated.enumMembers!.length,
        ts_field_position: accumulated.fieldPositions!.length,
        ts_export: accumulated.exports!.length,
        ts_comment: accumulated.comments!.length,
        ts_parse_gap: accumulated.parseGaps!.length,
      },
      irCompleteness: completeness,
    };
  }

  getSkippedFiles(): readonly SkippedTypeScriptFile[] {
    return this.skippedFiles;
  }

  private recordSkip(
    file: string,
    rootDir: string,
    options: TypeScriptAnalysisOptions,
    serviceVersionLinkHash: string,
    reason: SkippedFileReason,
    detail: string
  ): void {
    this.skippedFiles.push({
      filePath: toRelative(rootDir, file),
      baseMservPath: options.baseMservPath,
      serviceVersionLinkHash,
      reason,
      detail: detail.replace(/[\t\n\r]+/g, ' ').slice(0, 300),
    });
  }

  /** Writes one relation, chunked — a single joined string overflows V8's string limit. */
  private async exportCsv(rows: CsvRow[], outputDir: string, filename: string): Promise<void> {
    const outputPath = path.join(outputDir, filename);
    const first = rows[0];
    if (!first) {
      // An empty relation still gets its file, so a consumer can tell "no rows"
      // from "the parser never ran".
      await fsp.writeFile(outputPath, '', 'utf-8');
      return;
    }
    await fsp.writeFile(outputPath, first.getCsvHeader() + '\n', 'utf-8');
    for (let i = 0; i < rows.length; i += TS_CSV_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + TS_CSV_CHUNK_SIZE);
      await fsp.appendFile(outputPath, chunk.map((r) => r.toCsv()).join('\n') + '\n', 'utf-8');
    }
  }

  private async exportSkippedFilesCsv(outputDir: string): Promise<void> {
    const header = ['filePath', 'baseMservPath', 'serviceVersionLinkHash', 'reason', 'detail']
      .join('\t');
    const rows = [...this.skippedFiles]
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map((f) => [f.filePath, f.baseMservPath, f.serviceVersionLinkHash, f.reason, f.detail]
        .join('\t'));
    await fsp.writeFile(
      path.join(outputDir, TYPESCRIPT_CSV_FILES.SKIPPED_FILES),
      [header, ...rows].join('\n') + '\n',
      'utf-8'
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
  const files: string[] = [];
  const others: string[] = [];
  for (const file of collectTypeScriptFiles(rootDir, new Set(TS_SKIP_DIRECTORIES))) {
    const governing = configResolver.resolve(file);
    if (path.resolve(governing.configPath) === path.resolve(configPath)) {
      files.push(file);
    } else {
      others.push(file);
    }
  }
  return { files, others };
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

function stripExtension(relativePath: string): string {
  return relativePath.replace(/\.(d\.ts|tsx?|mts|cts)$/, '');
}

/** Re-exported so a caller can create a source file the same way the extractor does. */
export const TYPESCRIPT_SCRIPT_TARGET = ts.ScriptTarget.Latest;
