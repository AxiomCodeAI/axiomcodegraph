import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

import * as ts from 'typescript';

import { TsMethodRegistry } from '@/analysis-types/typescript/TsMethodRegistry';
import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  TS_CSV_CHUNK_SIZE,
  TS_SKIP_DIRECTORIES,
  TS_SOURCE_EXTENSIONS,
  TYPESCRIPT_CSV_FILES,
} from '@/constants/typescript-constants';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import {
  TsResolutionEvidence,
  TsResolvedTargetKind,
} from '@/enums/typescript/call-sites';
import { TsBodyPresence } from '@/enums/typescript/methods';
import {
  extractTypeScriptFile,
  TsFileFacts,
} from '@/parsers/typescript/extractors/ts-fact-extractor';
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
  readonly extractionErrors: number;
  readonly counts: Record<string, number>;
  readonly resolution: ResolutionReport;
}

export interface ResolutionReport {
  readonly callSites: number;
  readonly resolvedToSignature: number;
  readonly externalTerminal: number;
  readonly synthesized: number;
  readonly unresolved: number;
  /**
   * Resolution rate per RECEIVER SHAPE.
   *
   * Reported per shape and not only in aggregate, because an aggregate hides
   * the failure that matters: a parser can resolve every unqualified call and
   * no method call at all and still show a respectable total. In Python a
   * fixture-only win read as a corpus win for exactly this reason.
   */
  readonly byReceiverKind: Record<string, { total: number; resolved: number }>;
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
    const programFiles = filesOfRootProgram(rootDir, configResolver);
    const files = (programFiles ?? collectTypeScriptFiles(rootDir, excludes)).sort();

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
      modules: [], types: [], typeHeritages: [], typeReferences: [], methods: [],
      methodParameters: [], fields: [], variables: [], imports: [], expressions: [],
      callSites: [], blocks: [],
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
      accumulated.typeReferences!.push(...facts.typeReferences);
      accumulated.methods!.push(...facts.methods);
      accumulated.methodParameters!.push(...facts.methodParameters);
      accumulated.fields!.push(...facts.fields);
      accumulated.variables!.push(...facts.variables);
      accumulated.imports!.push(...facts.imports);
      accumulated.expressions!.push(...facts.expressions);
      accumulated.callSites!.push(...facts.callSites);
      accumulated.blocks!.push(...facts.blocks);
    }

    // The cross-module pass MUTATES rows already accumulated — they are the same
    // objects — so it must run before export.
    const crossModule = linkAcrossModules(perFile);

    await fsp.mkdir(options.outputDir, { recursive: true });
    await this.exportCsv(accumulated.modules!, options.outputDir, TYPESCRIPT_CSV_FILES.MODULES);
    await this.exportCsv(accumulated.types!, options.outputDir, TYPESCRIPT_CSV_FILES.TYPES);
    await this.exportCsv(accumulated.typeHeritages!, options.outputDir,
      TYPESCRIPT_CSV_FILES.TYPE_HERITAGES);
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
    await this.exportSkippedFilesCsv(options.outputDir);

    return {
      filesSeen: files.length,
      filesAnalysed: analysed,
      extractionErrors: this.skippedFiles.filter(
        (f) => f.reason === SkippedFileReason.EXTRACTION_ERROR
      ).length,
      counts: {
        ts_module: accumulated.modules!.length,
        ts_type: accumulated.types!.length,
        ts_type_heritage: accumulated.typeHeritages!.length,
        ts_type_reference: accumulated.typeReferences!.length,
        ts_method: accumulated.methods!.length,
        ts_method_parameter: accumulated.methodParameters!.length,
        ts_field: accumulated.fields!.length,
        ts_variable: accumulated.variables!.length,
        ts_import: accumulated.imports!.length,
        ts_expression: accumulated.expressions!.length,
        ts_call_site: accumulated.callSites!.length,
        ts_block: accumulated.blocks!.length,
      },
      resolution: crossModule,
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
 * Finishes the calls whose target is in another module.
 *
 * Cannot happen during extraction: `import { build } from "./helpers"` needs
 * helpers.ts to have been parsed, and a sorted file list is not a dependency
 * order. Path 2 of the resolution layer, and 52.0% of measured targets are
 * outside the project entirely — those become `LIB_SIGNATURE`, an honest
 * terminal the engine closes from `lib_ts_*`, not a failure.
 */
function linkAcrossModules(perFile: readonly TsFileFacts[]): ResolutionReport {
  // Exported declarations by module, so a deferred call is one map hit.
  const methodsByModuleAndName = new Map<string, Map<string, TsMethodRegistry[]>>();
  const constructorsByModuleAndTypeName = new Map<string, Map<string, TsMethodRegistry[]>>();
  const typeHashToName = new Map<string, string>();

  for (const facts of perFile) {
    for (const type of facts.types) {
      typeHashToName.set(type.getHash(), type.name);
    }
  }
  for (const facts of perFile) {
    const byName = new Map<string, TsMethodRegistry[]>();
    const constructors = new Map<string, TsMethodRegistry[]>();
    for (const method of facts.methods) {
      if (method.tsTypeLinkHash === '') {
        const list = byName.get(method.escapedName);
        if (list) {
          list.push(method);
        } else {
          byName.set(method.escapedName, [method]);
        }
        continue;
      }
      if (method.name === '<constructor>') {
        const ownerName = typeHashToName.get(method.tsTypeLinkHash) ?? '';
        const list = constructors.get(ownerName);
        if (list) {
          list.push(method);
        } else {
          constructors.set(ownerName, [method]);
        }
      }
    }
    methodsByModuleAndName.set(facts.fileModuleHash, byName);
    constructorsByModuleAndTypeName.set(facts.fileModuleHash, constructors);
  }

  const report: ResolutionReport = {
    callSites: 0,
    resolvedToSignature: 0,
    externalTerminal: 0,
    synthesized: 0,
    unresolved: 0,
    byReceiverKind: {},
  };
  const mutable = report as {
    callSites: number; resolvedToSignature: number; externalTerminal: number;
    synthesized: number; unresolved: number;
    byReceiverKind: Record<string, { total: number; resolved: number }>;
  };

  for (const facts of perFile) {
    for (const deferred of facts.deferredCalls) {
      const importRow = facts.importByLocalName.get(deferred.importedLocalName);
      if (!importRow) {
        continue;
      }
      const targetModuleHash = importRow.getResolvedModuleLinkHash();
      if (targetModuleHash === '') {
        // Resolved to a file outside the analysis, or not at all. The first is
        // a terminal; the second is honest ignorance and stays UNRESOLVED.
        if (importRow.resolvedFilePath !== '' || importRow.importedPath.startsWith('node:')) {
          deferred.callSite.setExternalTarget(TsResolvedTargetKind.LIB_SIGNATURE,
            TsResolutionEvidence.IMPORT_BINDING);
        }
        continue;
      }
      if (deferred.memberName === '<constructor>') {
        const constructors = constructorsByModuleAndTypeName.get(targetModuleHash)
          ?.get(importRow.originalName !== '' ? importRow.originalName
            : deferred.importedLocalName);
        applyCrossModule(deferred.callSite, constructors);
        continue;
      }
      const lookupName = deferred.memberName !== ''
        // `import * as ns; ns.fn()` — the member is a top-level export of the
        // target module. A NON-namespace import needs the value's type instead,
        // which is the checker's answer, so it is left alone.
        ? (importRow.isWildcard ? deferred.memberName : '')
        : (importRow.originalName !== '' ? importRow.originalName : deferred.importedLocalName);
      if (lookupName === '') {
        continue;
      }
      const candidates = methodsByModuleAndName.get(targetModuleHash)?.get(lookupName);
      applyCrossModule(deferred.callSite, candidates, deferred.argumentCount);
    }
  }

  for (const facts of perFile) {
    mutable.callSites += facts.stats.callSites;
    for (const [shape, bucket] of facts.stats.byReceiverKind) {
      const existing = mutable.byReceiverKind[shape] ?? { total: 0, resolved: 0 };
      existing.total += bucket.total;
      mutable.byReceiverKind[shape] = existing;
    }
  }
  // Counted from the ROWS rather than from the per-file tallies, so the cross-
  // module pass is included and the numbers describe what was actually emitted.
  for (const facts of perFile) {
    for (const callSite of facts.callSites) {
      const kind = callSite.getResolvedTargetKind();
      if (callSite.getResolvedSignatureLinkHash() !== '') {
        mutable.resolvedToSignature += 1;
        const bucket = mutable.byReceiverKind[callSite.receiverKind];
        if (bucket) {
          bucket.resolved += 1;
        }
      } else if (kind === TsResolvedTargetKind.SYNTHESIZED_NO_DECLARATION) {
        mutable.synthesized += 1;
        const bucket = mutable.byReceiverKind[callSite.receiverKind];
        if (bucket) {
          bucket.resolved += 1;
        }
      } else if (kind === TsResolvedTargetKind.LIB_SIGNATURE
        || kind === TsResolvedTargetKind.AMBIENT_SIGNATURE) {
        mutable.externalTerminal += 1;
        const bucket = mutable.byReceiverKind[callSite.receiverKind];
        if (bucket) {
          bucket.resolved += 1;
        }
      } else {
        mutable.unresolved += 1;
      }
    }
  }
  return report;
}

function applyCrossModule(
  callSite: { setResolution: (props: {
    resolvedSignatureLinkHash: string;
    resolvedGroupKey: string;
    resolvedTargetKind: TsResolvedTargetKind;
    resolvedOverloadIndex: number | undefined;
    overloadCandidateCount: number;
    isOverloadResolved: boolean;
    resolutionEvidence: TsResolutionEvidence;
    isAmbientTarget: boolean;
  }) => void },
  candidates: TsMethodRegistry[] | undefined,
  argumentCount = -1
): void {
  if (!candidates || candidates.length === 0) {
    return;
  }
  const viable = argumentCount < 0 ? candidates : candidates.filter((candidate) => {
    const required = candidate.parameterCount - candidate.optionalParameterCount;
    if (argumentCount < required) {
      return false;
    }
    return candidate.restParameterIndex !== undefined
      || argumentCount <= candidate.parameterCount;
  });
  const chosen = viable.length === 1 ? viable[0] : candidates.length === 1
    ? candidates[0] : undefined;
  if (!chosen) {
    // A real overload set that arity cannot narrow. Recorded, not guessed.
    callSite.setResolution({
      resolvedSignatureLinkHash: '',
      resolvedGroupKey: '',
      resolvedTargetKind: TsResolvedTargetKind.UNRESOLVED,
      resolvedOverloadIndex: undefined,
      overloadCandidateCount: candidates.length,
      isOverloadResolved: false,
      resolutionEvidence: TsResolutionEvidence.NONE,
      isAmbientTarget: false,
    });
    return;
  }
  const bodiless = chosen.bodyPresence !== TsBodyPresence.HAS_BODY;
  callSite.setResolution({
    resolvedSignatureLinkHash: chosen.getHash(),
    resolvedGroupKey: chosen.declarationGroupKey,
    resolvedTargetKind: chosen.bodyPresence === TsBodyPresence.NO_BODY_AMBIENT
      ? TsResolvedTargetKind.AMBIENT_SIGNATURE
      : bodiless
        ? TsResolvedTargetKind.PROJECT_SIGNATURE
        : TsResolvedTargetKind.PROJECT_IMPLEMENTATION,
    resolvedOverloadIndex: candidates.length > 1 ? candidates.indexOf(chosen) : undefined,
    overloadCandidateCount: candidates.length,
    isOverloadResolved: candidates.length > 1,
    resolutionEvidence: TsResolutionEvidence.IMPORT_BINDING,
    isAmbientTarget: bodiless,
  });
}

/**
 * The files of the program rooted at `rootDir`, or `undefined` if it declares none.
 *
 * `undefined` and an empty list are different answers and must stay different:
 * no tsconfig means "walk the directory", while a tsconfig claiming nothing
 * means "this program is empty" and walking anyway would analyse files the
 * program deliberately excludes.
 */
function filesOfRootProgram(
  rootDir: string,
  configResolver: TsConfigResolver
): string[] | undefined {
  const configPath = path.join(rootDir, 'tsconfig.json');
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  const out: string[] = [];
  for (const file of collectTypeScriptFiles(rootDir, new Set(TS_SKIP_DIRECTORIES))) {
    const governing = configResolver.resolve(file);
    if (path.resolve(governing.configPath) === path.resolve(configPath)) {
      out.push(file);
    }
  }
  return out;
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
