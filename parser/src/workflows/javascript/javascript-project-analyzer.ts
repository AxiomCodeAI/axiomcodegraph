import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

import * as ts from 'typescript';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  JAVASCRIPT_CSV_FILES,
  JS_SKIP_DIRECTORIES,
} from '@/constants/javascript-constants';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import {
  extractJavaScriptFile,
  JsFileFacts,
} from '@/parsers/javascript/extractors/js-fact-extractor';
import {
  accumulateFileCompleteness,
  createCompletenessAccumulator,
  finishCompleteness,
  IrCompletenessReport,
} from '@/parsers/javascript/extractors/js-ir-completeness';
import { moduleHashFor } from '@/parsers/javascript/extractors/js-module-extractor';
import { BUNDLER_CONFIG_NAMES, readBundlerAliases } from '@/parsers/javascript/bundler-alias-reader';
import { PackageJsonResolver } from '@/parsers/javascript/package-json-resolver';
import { WorkspacePackages } from '@/parsers/typescript/workspace-packages';
import {
  buildOutputDirectoriesNamedBy,
  extractPackageEntries,
} from '@/parsers/javascript/package-entry-extractor';
import { EntityUtils } from '@/utils/entity-utils';
import { isGeneratedOutputDirectory } from '@/utils/generated-output';
import { JsRelationWriter } from '@/workflows/javascript/js-relation-writer';
import {
  isJavaScriptSourceFile, stripJsExtension,
} from '@/utils/javascript';
import { JsBlockRegistry } from '@/analysis-types/javascript/JsBlockRegistry';
import { JsCallSiteRegistry } from '@/analysis-types/javascript/JsCallSiteRegistry';
import { JsCommentRegistry } from '@/analysis-types/javascript/JsCommentRegistry';
import { JsExportRegistry } from '@/analysis-types/javascript/JsExportRegistry';
import { JsExpressionRegistry } from '@/analysis-types/javascript/JsExpressionRegistry';
import { JsFieldRegistry } from '@/analysis-types/javascript/JsFieldRegistry';
import { JsImportRegistry } from '@/analysis-types/javascript/JsImportRegistry';
import { JsMethodParameterRegistry } from '@/analysis-types/javascript/JsMethodParameterRegistry';
import { JsMethodRegistry } from '@/analysis-types/javascript/JsMethodRegistry';
import { JsModuleRegistry } from '@/analysis-types/javascript/JsModuleRegistry';
import { JsPackageEntryRegistry } from '@/analysis-types/javascript/JsPackageEntryRegistry';
import { JsParseGapRegistry } from '@/analysis-types/javascript/JsParseGapRegistry';
import { JsScopeRegistry } from '@/analysis-types/javascript/JsScopeRegistry';
import { JsTypeHeritageRegistry } from '@/analysis-types/javascript/JsTypeHeritageRegistry';
import { JsTypeReferenceRegistry } from '@/analysis-types/javascript/JsTypeReferenceRegistry';
import { JsTypeRegistry } from '@/analysis-types/javascript/JsTypeRegistry';
import { JsVariableRegistry } from '@/analysis-types/javascript/JsVariableRegistry';
import { isGitIgnoredDir, isVendoredFile } from '@/utils/git-ignored';
import { scriptTextOf } from '@/utils/vue-sfc';

/**
 * Each relation's header, from its registry, so an EMPTY relation still writes
 * its columns. `getCsvHeader` reads no instance state — the header is a
 * constant list — which is why the prototype can answer without a row.
 */
/** Source extensions a workspace package's entry is mapped back to, in the order they are looked for. */
const JS_SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'] as const;

const HEADER_BY_FILE: Readonly<Record<string, string>> = {
  [JAVASCRIPT_CSV_FILES.MODULES]: JsModuleRegistry.prototype.getCsvHeader(),
  [JAVASCRIPT_CSV_FILES.SCOPES]: JsScopeRegistry.prototype.getCsvHeader(),
  [JAVASCRIPT_CSV_FILES.TYPES]: JsTypeRegistry.prototype.getCsvHeader(),
  [JAVASCRIPT_CSV_FILES.TYPE_HERITAGES]: JsTypeHeritageRegistry.prototype.getCsvHeader(),
  [JAVASCRIPT_CSV_FILES.TYPE_REFERENCES]: JsTypeReferenceRegistry.prototype.getCsvHeader(),
  [JAVASCRIPT_CSV_FILES.METHODS]: JsMethodRegistry.prototype.getCsvHeader(),
  [JAVASCRIPT_CSV_FILES.METHOD_PARAMETERS]: JsMethodParameterRegistry.prototype.getCsvHeader(),
  [JAVASCRIPT_CSV_FILES.FIELDS]: JsFieldRegistry.prototype.getCsvHeader(),
  [JAVASCRIPT_CSV_FILES.VARIABLES]: JsVariableRegistry.prototype.getCsvHeader(),
  [JAVASCRIPT_CSV_FILES.IMPORTS]: JsImportRegistry.prototype.getCsvHeader(),
  [JAVASCRIPT_CSV_FILES.EXPORTS]: JsExportRegistry.prototype.getCsvHeader(),
  [JAVASCRIPT_CSV_FILES.EXPRESSIONS]: JsExpressionRegistry.prototype.getCsvHeader(),
  [JAVASCRIPT_CSV_FILES.CALL_SITES]: JsCallSiteRegistry.prototype.getCsvHeader(),
  [JAVASCRIPT_CSV_FILES.BLOCKS]: JsBlockRegistry.prototype.getCsvHeader(),
  [JAVASCRIPT_CSV_FILES.COMMENTS]: JsCommentRegistry.prototype.getCsvHeader(),
  [JAVASCRIPT_CSV_FILES.PARSE_GAPS]: JsParseGapRegistry.prototype.getCsvHeader(),
  [JAVASCRIPT_CSV_FILES.PACKAGE_ENTRIES]: JsPackageEntryRegistry.prototype.getCsvHeader(),
};

/**
 * Walks a JavaScript repository, extracts the fact spine, and exports it as TSV.
 *
 * ## What the unit of analysis is, and why it is not a "program"
 *
 * The TypeScript analyzer groups files by their governing `tsconfig.json`,
 * because a program is the unit of merge scope and two programs have two global
 * scopes. **JavaScript has no such unit.** There is no `files`/`include` list to
 * read, no transitive closure to compute, and no declaration merging for a merge
 * scope to matter to. What a JavaScript file has instead is a governing
 * `package.json`, and that decides exactly one thing: whether the file is
 * CommonJS or ESM.
 *
 * So the file list is a directory walk, and the per-file configuration is
 * resolved by {@link PackageJsonResolver}. That is a simplification in the file
 * layer and a complication in the fact layer, because `moduleSystem` ends up in
 * `js_module`'s primary key while `tsConfigPath` is merely a column on
 * `ts_module`.
 *
 * ## Accumulate nothing; stream in a total order
 *
 * Byte-identical output across runs is a gate, and it is not achievable by
 * writing rows as they are *found*: filesystem enumeration order is not stable
 * across machines. Files are processed in **sorted path order**, each extractor
 * emits deterministically within a file, and rows are streamed to per-relation
 * writers as each file finishes — §10 of `BUILDING-A-PARSER.md`, where holding
 * the whole fact base in memory was measured as the single largest cost and the
 * only architectural one.
 */
export interface JavaScriptAnalysisOptions {
  readonly rootDir: string;
  readonly outputDir: string;
  readonly baseMservPath: string;
  /**
   * The service version IDENTIFIER as the caller knows it — a tag, a commit.
   * HASHED here, exactly as Java, Python and TypeScript hash theirs, so the four
   * languages produce joinable values. Passing a raw string into a column named
   * `...LinkHash` is the mistake this exists to prevent.
   */
  readonly serviceVersionLink?: string;
  /** A pre-computed hash, for a caller that already has one. */
  readonly serviceVersionLinkHash?: string;
  readonly excludeDirs?: readonly string[];
  /**
   * Further roots whose files join this one's set.
   *
   * Their files are unioned with `rootDir`'s before anything is parsed, so an
   * overlapping root cannot cause a file to be extracted twice — which would
   * double the row count with nothing looking wrong.
   */
  readonly additionalRoots?: readonly string[];
  /**
   * This root is a DEPENDENCY handed to the parser, not the project under analysis.
   *
   * The only thing it changes is the build output directory a root's own
   * `package.json` ships from (`main` / `module` / `exports` naming `dist/`,
   * `build/` or `out/`). For a dependency that directory is the source of truth and
   * is walked (#620); for a project it is the artefact beside the source, and walking
   * it extracts every function of the project a second time — which silently changed
   * the answers for the REAL source, because the name-keyed parameter fan cap counts
   * call sites across the whole IR and the copies pushed the project's own functions
   * over it (#796).
   *
   * It is stated by the caller rather than inferred: a published package very often
   * ships `src/` beside `dist/` in its tarball, so "the root has source outside the
   * build directory" would switch #620 back off for exactly those packages.
   * `bin/axiomcode` knows which trees are `--library` entries and says so.
   */
  readonly libraryRoot?: boolean;
}

export interface JavaScriptAnalysisSummary {
  readonly filesSeen: number;
  readonly filesAnalysed: number;
  readonly extractionErrors: number;
  readonly counts: Record<string, number>;
  /**
   * Files classified as bundler or minifier output.
   *
   * Counted apart from `filesAnalysed` because gate 7.3.5 asserts they
   * contribute zero rows to any coverage denominator. A silent exclusion is
   * what §9 of `BUILDING-A-PARSER.md` is about: on one large framework checkout a nested config
   * dropped 1,270 of 1,821 files and nothing counted them.
   */
  readonly bundledFilesExcluded: number;
  /**
   * Source files lost to a DIRECTORY-level skip, by directory name.
   *
   * Distinct from `bundledFilesExcluded`, which counts files that were read and
   * then classified. These were never read: the walk turned around at the
   * directory. Without this a package whose every file sits under `dist/`
   * reports zeroes across the board and is indistinguishable from a package
   * with no JavaScript in it.
   */
  readonly skippedByDirectory: Readonly<Record<string, number>>;
  /**
   * Build-output directories WALKED because a walk root's own `package.json`
   * names them as an entry (#620): `<root>/dist` for a package that ships from
   * `dist/`. Listed so the exception is as visible as the skip it lifts.
   */
  readonly buildOutputWalked: readonly string[];
  /** How each file's module system was decided, so a defaulted 91.4% is visible. */
  readonly moduleSystemSourceCounts: Record<string, number>;
  /** Files whose own syntax contradicts their governing `package.json`. */
  readonly contradictingFiles: number;
  /**
   * IR COMPLETENESS, not a resolution rate.
   *
   * Named for what it measures. "What fraction did the parser resolve" is the
   * wrong question for a parser whose design is to resolve nothing across files
   * — Java answers it with 0 of 67,938 and that is correct. The right question
   * is whether every hop an engine needs was emitted.
   */
  readonly irCompleteness: IrCompletenessReport;
}

interface SkippedJavaScriptFile {
  filePath: string;
  baseMservPath: string;
  serviceVersionLinkHash: string;
  reason: SkippedFileReason;
  detail: string;
}

export class JavaScriptProjectAnalyzer {
  /** Distinguishes concurrent writer sets within one process. */
  private static writeSequence = 0;

  private skippedFiles: SkippedJavaScriptFile[] = [];

  /**
   * Analyses SEVERAL discovered roots into one flat fact set.
   *
   * ## Why this exists, and what happened without it
   *
   * `analyze` publishes a complete relation set to `outputDir`. Calling it once
   * per discovered project against one output directory does not merge those
   * sets — it **overwrites** them, so every project but the last vanishes, and
   * when the calls run concurrently they also race on the temporary files and
   * the run dies with an ENOENT on a path another writer already renamed away.
   * Both happened on the first end-to-end run through `extract.ts`, which is
   * exactly the kind of defect a unit-level harness cannot produce.
   *
   * ## Roots overlap, so the FILE LIST is deduplicated, not the roots
   *
   * A monorepo's root and its `packages/*` are all discovered as projects, and
   * every file under a package is reachable from both. Extracting it twice would
   * mint identical primary keys and **double** the row count — not collide, and
   * not error. The union of files is taken by absolute path before any parsing,
   * which is also what lets every module hash be minted up front.
   */
  async analyzeAll(
    roots: readonly string[],
    options: Omit<JavaScriptAnalysisOptions, 'rootDir'>
  ): Promise<JavaScriptAnalysisSummary> {
    if (roots.length === 0) {
      return this.analyze({ ...options, rootDir: options.baseMservPath });
    }
    return this.analyze({ ...options, rootDir: roots[0]!, additionalRoots: roots.slice(1) });
  }

  async analyze(options: JavaScriptAnalysisOptions): Promise<JavaScriptAnalysisSummary> {
    const serviceVersionLinkHash = options.serviceVersionLink !== undefined
      ? EntityUtils.generateEntityHash(
          ENTITY_IDENTIFIERS.SERVICE_VERSION,
          options.serviceVersionLink
        )
      : options.serviceVersionLinkHash ?? '';

    // CANONICAL, not as spelled — see `realPathOf`. Every workspace package is linked
    // into `node_modules` by a symlink, and TypeScript's resolver answers with the
    // package's real path, so a root spelled through a symlink put one side of the
    // `projectModuleHashes` comparison in real paths and the other in the spelling
    // given: every cross-package import in a monorepo came out RESOLVED_EXTERNAL (#795).
    // `baseMservPath` is canonicalised with it, or `pathAnchorFor` would stop
    // recognising an ancestor spelled the other way and re-anchor every emitted path.
    const rootDir = realPathOf(path.resolve(options.rootDir));
    const excludes = new Set<string>(options.excludeDirs ?? JS_SKIP_DIRECTORIES);
    // Counted, not merely skipped. See `collectJavaScriptFiles`.
    const skippedByDirectory = new Map<string, number>();
    const prunedDirectories: Array<{ directory: string; name: string; files: number; generated?: boolean }> = [];
    const baseMservPath = options.baseMservPath === ''
      ? '' : realPathOf(path.resolve(options.baseMservPath));
    const pathAnchor = pathAnchorFor(rootDir, baseMservPath);
    const packageJson = new PackageJsonResolver();
    const pathAliases = new PathAliasResolver();
    // The union of every root's files, by absolute path. A monorepo root and its
    // packages both claim the same files, and extracting one twice would mint
    // identical primary keys and DOUBLE the row count rather than colliding.
    const discovered = new Map<string, string>();
    const buildOutputWalked: string[] = [];
    // Every `package.json` the walk passes, so a package whose only code sits in
    // a skipped directory still states its entries (#616): the row that says
    // "this package stages nothing" must exist for exactly that package.
    const packageJsonsSeen = new Set<string>();
    const roots = [rootDir, ...(options.additionalRoots ?? []).map((r) => realPathOf(path.resolve(r)))];
    for (const root of roots) {
      // A root that is a PACKAGE shipping from a build directory (#620): its
      // `main` / `exports` name `dist/`, `build/` or `out/`, and that directory is
      // the only code the package ships. Walked, directly under this root only;
      // every nested occurrence stays a skipped artefact.
      const rootPackage = packageJson.packageAt(root);
      // ONLY FOR A DEPENDENCY. See `libraryRoot`: for the project under analysis, a
      // committed `dist/` is a copy of its own source and extracting it changes the
      // answers for the source itself (#796).
      const walkUnderRoot = new Set<string>(
        rootPackage === undefined || options.libraryRoot !== true
          ? []
          : buildOutputDirectoriesNamedBy(rootPackage).filter((name) => excludes.has(name))
      );
      for (const name of walkUnderRoot) {
        buildOutputWalked.push(path.join(root, name));
      }
      let found = 0;
      for (const file of collectJavaScriptFiles(root, excludes, skippedByDirectory, prunedDirectories, walkUnderRoot, packageJsonsSeen)) {
        discovered.set(path.normalize(file), file);
        found += 1;
      }
      // A PROJECT that ships from a build directory and has no other JavaScript
      // (#709). The rule above is right for a dependency and too narrow here: a
      // package whose `main` names `dist/` and whose only code is that `dist/`
      // staged NOTHING when it was analysed as the project rather than as a
      // library, so `javascript/` was written empty and then deleted as a stray.
      //
      // The condition is what keeps #796 intact. That issue is about a project
      // holding BOTH its source and a committed copy of it under `dist/`, where
      // walking the copy changes the answers for the source. Such a project
      // stages its source here, so `found` is non-zero and the build directory
      // stays pruned. Only a root that would otherwise contribute nothing at all
      // reaches this, and for it the build directory is not a copy of the source,
      // it is the only source there is.
      if (found === 0 && rootPackage !== undefined && walkUnderRoot.size === 0) {
        const shipped = buildOutputDirectoriesNamedBy(rootPackage).filter((name) => excludes.has(name));
        if (shipped.length > 0) {
          const shippedOnly = new Set<string>(shipped);
          for (const name of shippedOnly) {
            buildOutputWalked.push(path.join(root, name));
          }
          for (const file of collectJavaScriptFiles(root, excludes, skippedByDirectory, prunedDirectories, shippedOnly, packageJsonsSeen)) {
            discovered.set(path.normalize(file), file);
          }
        }
      }
    }
    const files = [...discovered.values()].sort();

    // Every module hash up front, from PATHS ALONE — §1 of the parser doc.
    //
    // `moduleSystem` is in the key, so this loop consults the governing
    // `package.json`. That is still "paths alone": `PackageJsonResolver` reads
    // the filesystem and parses JSON, and touches no JavaScript. What it buys is
    // that a `require('./x')` in file B can be given file A's module hash
    // without file A having been opened.
    const projectModuleHashes = new Map<string, string>();
    const governingByFile = new Map<string, ReturnType<PackageJsonResolver['resolve']>>();
    for (const file of files) {
      const governing = packageJson.resolve(file);
      governingByFile.set(file, governing);
      projectModuleHashes.set(
        path.normalize(file),
        moduleHashFor(
          toRelative(pathAnchor, file),
          baseMservPath,
          governing.moduleSystem,
          serviceVersionLinkHash
        )
      );
    }
    const toProjectRelative = (absolutePath: string): string =>
      stripExtension(toRelative(pathAnchor, absolutePath));
    // A sibling package imported by its name binds to the walked source its entry is
    // built from, by the same convention as TypeScript's (`WorkspacePackages`).
    const workspacePackages = WorkspacePackages.discover(pathAnchor, excludes);
    const workspaceResolutions = new Map<string, string | undefined>();
    const resolveWorkspaceModule = (specifier: string): string | undefined => {
      if (workspacePackages.size === 0) {
        return undefined;
      }
      if (!workspaceResolutions.has(specifier)) {
        workspaceResolutions.set(specifier, workspacePackages.resolve(specifier,
          (absolutePath) => projectModuleHashes.get(absolutePath), JS_SOURCE_EXTENSIONS)?.absolutePath);
      }
      return workspaceResolutions.get(specifier);
    };

    // Every package this parse touched: each walk root's own `package.json`, and
    // the governing config of every file. What each exposes is a fact of the
    // package, resolved against the module hashes minted above (#616). A root
    // package with no walked file still gets its rows, so "this package stages
    // nothing" is written down rather than inferred from an empty relation.
    const packageEntries: JsPackageEntryRegistry[] = [];
    const packageJsonPaths = new Set<string>(packageJsonsSeen);
    for (const root of roots) {
      const rootPackage = packageJson.packageAt(root);
      if (rootPackage !== undefined) {
        packageJsonPaths.add(rootPackage.path);
      }
    }
    for (const governing of governingByFile.values()) {
      if (governing.packageJsonPath !== '') {
        packageJsonPaths.add(governing.packageJsonPath);
      }
    }
    for (const packageJsonPath of [...packageJsonPaths].sort()) {
      const facts = packageJson.packageAt(path.dirname(packageJsonPath));
      if (facts === undefined) {
        continue;
      }
      packageEntries.push(...extractPackageEntries({
        facts,
        packageJsonPath: toRelative(pathAnchor, packageJsonPath),
        moduleHashOf: (absolutePath) => projectModuleHashes.get(absolutePath),
        serviceVersionLinkHash,
      }));
    }

    this.skippedFiles = [];
    // The pruned directories reach the skip table, one row each (#790), AFTER the
    // reset above so the rows survive it. One row per directory, not per file: the
    // files inside were counted but never enumerated, and inventing paths for them
    // would be a worse answer than naming the directory and the count.
    for (const pruned of prunedDirectories) {
      this.recordSkip(pruned.directory, pathAnchor, options, serviceVersionLinkHash,
        SkippedFileReason.DIRECTORY_EXCLUDED,
        pruned.generated === true
          ? `${pruned.files} JavaScript file(s) under a build's output directory (${pruned.name})`
          : `${pruned.files} JavaScript file(s) under an excluded directory named ${pruned.name}`);
    }
    await fsp.mkdir(options.outputDir, { recursive: true });
    const writers = new Map<string, JsRelationWriter>();
    // Unique per WRITER SET, not per millisecond: two analyzers started together
    // share a `Date.now()`, and a shared temporary name means two writers open
    // it, interleave their bytes, and the loser's rename fails with ENOENT
    // because the winner already moved the file away. Measured on the first
    // end-to-end run.
    JavaScriptProjectAnalyzer.writeSequence += 1;
    const uniqueSuffix = `${process.pid}.${Date.now()}.${JavaScriptProjectAnalyzer.writeSequence}`;
    const writerFor = (filename: string): JsRelationWriter => {
      const existing = writers.get(filename);
      if (existing !== undefined) {
        return existing;
      }
      const created = new JsRelationWriter(options.outputDir, filename, uniqueSuffix,
        HEADER_BY_FILE[filename] ?? '');
      writers.set(filename, created);
      return created;
    };

    let analysed = 0;
    // Folded per file, never collected. Holding every file's facts to measure
    // them at the end made peak memory the whole fact base as live objects and
    // killed a 4,561-file run at 336 seconds, after most of the output had
    // already been written correctly.
    const completeness = createCompletenessAccumulator();
    let bundledFilesExcluded = 0;
    let contradictingFiles = 0;
    const moduleSystemSourceCounts: Record<string, number> = {};

    try {
      await writerFor(JAVASCRIPT_CSV_FILES.PACKAGE_ENTRIES).append(packageEntries);
      for (const file of files) {
        let sourceText: string;
        try {
          sourceText = await fsp.readFile(file, 'utf-8');
        } catch (error) {
          this.recordSkip(file, pathAnchor, options, serviceVersionLinkHash,
            SkippedFileReason.READ_ERROR, String(error));
          continue;
        }
        // A component is read once, by `scriptTextOf`: a `.vue` as its virtual
        // script, a `.svelte`/`.astro` as its JavaScript blocks. One with nothing
        // this analyzer can read (a lang="ts" Vue script is the TypeScript one's) is a recorded skip.
        const script = scriptTextOf(file, sourceText);
        if (script.unread !== undefined) {
          this.recordSkip(file, pathAnchor, options, serviceVersionLinkHash,
            SkippedFileReason.EMPTY_CONTENT, script.unread);
          continue;
        }
        const governing = governingByFile.get(file)!;
        let facts: JsFileFacts;
        try {
          facts = extractJavaScriptFile({
            absoluteFilePath: file,
            filePath: toRelative(pathAnchor, file),
            baseMservPath: baseMservPath,
            moduleQualifiedName: toProjectRelative(file),
            sourceText: script.text,
            scriptKind: script.scriptKind,
            serviceVersionLinkHash,
            moduleSystem: governing.moduleSystem,
            moduleSystemSource: governing.moduleSystemSource,
            governingPackageJsonPath: governing.packageJsonPath === ''
              ? ''
              : toRelative(pathAnchor, governing.packageJsonPath),
            packageName: governing.packageName,
            compilerOptions: compilerOptionsFor(governing.moduleSystem, pathAliases.aliasesFor(file)),
            projectModuleHashes,
            toProjectRelative,
            resolveWorkspaceModule,
          });
        } catch (error) {
          // An extraction error is a DEFECT, never a decision. Counted apart
          // from anything else so a parser that throws on every file cannot
          // report a clean run with empty relations.
          this.recordSkip(file, pathAnchor, options, serviceVersionLinkHash,
            SkippedFileReason.EXTRACTION_ERROR, String(error));
          continue;
        }
        analysed += 1;
        const module = facts.modules[0]!;
        if (module.sourceProvenance !== 'PROJECT') {
          bundledFilesExcluded += 1;
        }
        if (module.contradictsGoverningConfig) {
          contradictingFiles += 1;
        }
        moduleSystemSourceCounts[module.moduleSystemSource] =
          (moduleSystemSourceCounts[module.moduleSystemSource] ?? 0) + 1;

        await writerFor(JAVASCRIPT_CSV_FILES.MODULES).append(facts.modules);
        await writerFor(JAVASCRIPT_CSV_FILES.SCOPES).append(facts.scopes);
        await writerFor(JAVASCRIPT_CSV_FILES.TYPES).append(facts.types);
        await writerFor(JAVASCRIPT_CSV_FILES.TYPE_HERITAGES).append(facts.heritages);
        await writerFor(JAVASCRIPT_CSV_FILES.METHODS).append(facts.methods);
        await writerFor(JAVASCRIPT_CSV_FILES.METHOD_PARAMETERS)
          .append(facts.methodParameters);
        await writerFor(JAVASCRIPT_CSV_FILES.FIELDS).append(facts.fields);
        await writerFor(JAVASCRIPT_CSV_FILES.VARIABLES).append(facts.variables);
        await writerFor(JAVASCRIPT_CSV_FILES.BLOCKS).append(facts.blocks);
        await writerFor(JAVASCRIPT_CSV_FILES.EXPRESSIONS).append(facts.expressions);
        await writerFor(JAVASCRIPT_CSV_FILES.CALL_SITES).append(facts.callSites);
        await writerFor(JAVASCRIPT_CSV_FILES.IMPORTS).append(facts.imports);
        await writerFor(JAVASCRIPT_CSV_FILES.EXPORTS).append(facts.exports);
        await writerFor(JAVASCRIPT_CSV_FILES.COMMENTS).append(facts.comments);
        await writerFor(JAVASCRIPT_CSV_FILES.TYPE_REFERENCES)
          .append(facts.typeReferences);
        await writerFor(JAVASCRIPT_CSV_FILES.PARSE_GAPS).append(facts.parseGaps);
        // Read immediately and discarded, which is now literally true: the
        // measure folds this file into running totals and the objects become
        // garbage on the next iteration.
        accumulateFileCompleteness(completeness, facts);
      }

      for (const filename of Object.values(JAVASCRIPT_CSV_FILES)) {
        if (filename === JAVASCRIPT_CSV_FILES.SKIPPED_FILES) {
          continue;
        }
        // Touch every relation so a consumer can tell "no rows" from "the
        // parser never ran". A missing relation file reads to any FK gate as
        // every reference to it dangling.
        await writerFor(filename).publish();
      }
    } catch (error) {
      for (const writer of writers.values()) {
        await writer.discard();
      }
      throw error;
    }

    await this.exportSkippedFilesCsv(options.outputDir, uniqueSuffix);

    return {
      filesSeen: files.length,
      filesAnalysed: analysed,
      extractionErrors: this.skippedFiles.filter(
        (f) => f.reason === SkippedFileReason.EXTRACTION_ERROR
      ).length,
      counts: {
        js_module: writerFor(JAVASCRIPT_CSV_FILES.MODULES).rowCount,
        js_scope: writerFor(JAVASCRIPT_CSV_FILES.SCOPES).rowCount,
        js_type: writerFor(JAVASCRIPT_CSV_FILES.TYPES).rowCount,
        js_type_heritage: writerFor(JAVASCRIPT_CSV_FILES.TYPE_HERITAGES).rowCount,
        js_method: writerFor(JAVASCRIPT_CSV_FILES.METHODS).rowCount,
        js_method_parameter: writerFor(JAVASCRIPT_CSV_FILES.METHOD_PARAMETERS).rowCount,
        js_field: writerFor(JAVASCRIPT_CSV_FILES.FIELDS).rowCount,
        js_variable: writerFor(JAVASCRIPT_CSV_FILES.VARIABLES).rowCount,
        js_block: writerFor(JAVASCRIPT_CSV_FILES.BLOCKS).rowCount,
        js_expression: writerFor(JAVASCRIPT_CSV_FILES.EXPRESSIONS).rowCount,
        js_call_site: writerFor(JAVASCRIPT_CSV_FILES.CALL_SITES).rowCount,
        js_import: writerFor(JAVASCRIPT_CSV_FILES.IMPORTS).rowCount,
        js_export: writerFor(JAVASCRIPT_CSV_FILES.EXPORTS).rowCount,
        js_comment: writerFor(JAVASCRIPT_CSV_FILES.COMMENTS).rowCount,
        js_type_reference: writerFor(JAVASCRIPT_CSV_FILES.TYPE_REFERENCES).rowCount,
        js_parse_gap: writerFor(JAVASCRIPT_CSV_FILES.PARSE_GAPS).rowCount,
        js_package_entry: writerFor(JAVASCRIPT_CSV_FILES.PACKAGE_ENTRIES).rowCount,
      },
      bundledFilesExcluded,
      skippedByDirectory: Object.fromEntries(
        [...skippedByDirectory.entries()].sort((a, b) => b[1] - a[1])
      ),
      buildOutputWalked,
      moduleSystemSourceCounts,
      contradictingFiles,
      irCompleteness: finishCompleteness(completeness),
    };
  }

  getSkippedFiles(): readonly SkippedJavaScriptFile[] {
    return this.skippedFiles;
  }

  private recordSkip(
    file: string,
    pathAnchor: string,
    options: JavaScriptAnalysisOptions,
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

  private async exportSkippedFilesCsv(outputDir: string, uniqueSuffix: string): Promise<void> {
    const header = ['filePath', 'baseMservPath', 'serviceVersionLinkHash', 'reason', 'detail']
      .join('\t');
    const rows = [...this.skippedFiles]
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map((f) => [f.filePath, f.baseMservPath, f.serviceVersionLinkHash, f.reason, f.detail]
        .join('\t'));
    const outputPath = path.join(outputDir, JAVASCRIPT_CSV_FILES.SKIPPED_FILES);
    const temporaryPath = `${outputPath}.${uniqueSuffix}.partial`;
    await fsp.writeFile(temporaryPath, [header, ...rows].join('\n') + '\n');
    await fsp.rename(temporaryPath, outputPath);
  }
}

/**
 * Module-resolution options for `ts.resolveModuleName`.
 *
 * `NodeNext` for every file: it is the one resolver that models `exports` maps,
 * `#`-prefixed `imports` maps and conditional exports, and Node's own `require`
 * has honoured `exports` (under the `require` condition) since the map was
 * introduced, so `Node10` for CommonJS files described a loader that no longer
 * exists and left a `require()` of an exports-only package unresolved (#601).
 * WHICH conditions apply is decided per import site, not per file: the module
 * edge extractor passes the resolution mode (`require` for `require()` and
 * `createRequire`, `import` for `import` declarations and `import()`).
 *
 * Where tsc's model and Node's real resolver disagree, the disagreement is
 * worth recording — and it is recorded in `../parser-oracle/javascript`, not
 * here. A parser running two resolvers and comparing them is doing resolution
 * work, which is exactly what `js_import.resolverAgreement` was deleted for.
 */
function compilerOptionsFor(moduleSystem: string, aliases: PathAliases): ts.CompilerOptions {
  return {
    allowJs: true,
    target: ts.ScriptTarget.ESNext,
    module: moduleSystem === 'ESM' ? ts.ModuleKind.NodeNext : ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    ...aliases,
  };
}

/** The alias half of a `jsconfig.json` / `tsconfig.json`: nothing else of it is read. */
type PathAliases = Partial<Pick<ts.CompilerOptions, 'baseUrl' | 'paths' | 'pathsBasePath'>>;

/**
 * The `compilerOptions.paths` / `baseUrl` that govern a file, from the nearest
 * `tsconfig.json` or `jsconfig.json` above it (`tsconfig.json` first, as editors do).
 *
 * Next.js, Remix, Nuxt and Vite projects import their own code as `@/lib/x` or
 * `~/models/x` through that mapping, and the bundler honours it. Without it every
 * such import was UNRESOLVED_MISSING, so a plain imported function was called
 * "by name". `extends` is followed by `ts.parseJsonConfigFileContent`; the directory
 * listing it would do for `include` is skipped, since only the options are wanted.
 *
 * A `vite.config.*` / `webpack.config.*` with a `resolve.alias` counts as such a config
 * too: Vite and Vue apps declare `@` → `src` only there (#1746). The NEARER of the two
 * governs (the tsconfig-family config when both sit in one directory), so a vite app
 * nested under a repository whose own `tsconfig.json` maps `@/*` elsewhere keeps its alias.
 */
class PathAliasResolver {
  private readonly byDirectory = new Map<string, GoverningAliases>();
  private readonly bundlerByDirectory = new Map<string, GoverningAliases>();

  aliasesFor(file: string): PathAliases {
    const directory = path.dirname(file);
    const config = this.inDirectory(directory);
    const bundler = this.bundlerInDirectory(directory);
    // Both lie on one line of ancestors, so the longer directory is the nearer one.
    if (bundler.aliases.paths === undefined) {
      return config.aliases;
    }
    if (config.aliases.paths === undefined) {
      return { ...config.aliases, ...bundler.aliases };
    }
    return bundler.from.length > config.from.length ? bundler.aliases : config.aliases;
  }

  private bundlerInDirectory(directory: string): GoverningAliases {
    return this.nearest(this.bundlerByDirectory, directory, (dir) => {
      for (const name of BUNDLER_CONFIG_NAMES) {
        const configPath = path.join(dir, name);
        const paths = fs.existsSync(configPath) ? readBundlerAliases(configPath) : undefined;
        if (paths !== undefined) {
          return { paths, pathsBasePath: dir };
        }
      }
      return undefined;
    });
  }

  private inDirectory(directory: string): GoverningAliases {
    return this.nearest(this.byDirectory, directory, (dir) => {
      for (const name of ['tsconfig.json', 'jsconfig.json']) {
        const configPath = path.join(dir, name);
        if (fs.existsSync(configPath)) {
          return readPathAliases(configPath);
        }
      }
      return undefined;
    });
  }

  /** The first directory at or above `directory` where `read` finds a config, cached per directory. */
  private nearest(
    cache: Map<string, GoverningAliases>,
    directory: string,
    read: (dir: string) => PathAliases | undefined
  ): GoverningAliases {
    const cached = cache.get(directory);
    if (cached !== undefined) {
      return cached;
    }
    const here = read(directory);
    let governing: GoverningAliases;
    if (here !== undefined) {
      governing = { aliases: here, from: directory };
    } else {
      const parent = path.dirname(directory);
      governing = parent === directory ? { aliases: {}, from: '' } : this.nearest(cache, parent, read);
    }
    cache.set(directory, governing);
    return governing;
  }
}

/** The aliases in force, and the directory of the config they came from ('' for none). */
interface GoverningAliases {
  aliases: PathAliases;
  from: string;
}

function readPathAliases(configPath: string): PathAliases {
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined || read.config === undefined) {
    return {};
  }
  const host: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readDirectory: () => [],
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
  };
  const { options } = ts.parseJsonConfigFileContent(read.config, host, path.dirname(configPath),
    undefined, configPath);
  const aliases: PathAliases = {};
  if (options.baseUrl !== undefined) {
    aliases.baseUrl = options.baseUrl;
  }
  if (options.paths !== undefined) {
    aliases.paths = options.paths;
    aliases.pathsBasePath = options.pathsBasePath;
  } else {
    const generated = frameworkDefaultAliases(read.config, path.dirname(configPath));
    if (generated !== undefined) {
      aliases.paths = generated;
      aliases.pathsBasePath = path.dirname(configPath);
    }
  }
  return aliases;
}

/**
 * The aliases a framework's GENERATED config would have supplied, when the project's
 * config `extends` (or `references`) one that a checkout does not contain.
 *
 * SvelteKit writes `.svelte-kit/tsconfig.json` and Nuxt `.nuxt/tsconfig*.json` at
 * dev/build time; the project's own config only points at them, so without this every
 * `$lib/api` or `~/utils/price` import was UNRESOLVED_MISSING (#1756). The mapping is the
 * framework's default one: SvelteKit `$lib` → `src/lib`; Nuxt `~`, `@` → the source dir
 * (`app/` first, as Nuxt 4 lays it out, then the root) and `~~`, `@@` → the root. A
 * generated config that IS present is read as written, and a project `paths` wins.
 */
function frameworkDefaultAliases(config: unknown, configDirectory: string): ts.MapLike<string[]> | undefined {
  const { extends: extended, references } = (config ?? {}) as { extends?: unknown; references?: unknown };
  const named = [
    ...(Array.isArray(extended) ? extended : [extended]),
    ...(Array.isArray(references) ? references.map((r) => (r as { path?: unknown } | null)?.path) : []),
  ].filter((p): p is string => typeof p === 'string');
  for (const pointed of named) {
    const target = path.resolve(configDirectory, pointed);
    // `./.nuxt/tsconfig.app.json`, `./.nuxt/tsconfig` (extension implied), or a
    // `references` directory, which means its tsconfig.json
    const namesFile = path.basename(target).startsWith('tsconfig');
    const configFile = !namesFile ? path.join(target, 'tsconfig.json')
      : target.endsWith('.json') ? target : `${target}.json`;
    const generatedDirectory = path.dirname(configFile);
    if (fs.existsSync(configFile) || path.dirname(generatedDirectory) !== configDirectory) {
      continue;
    }
    const framework = path.basename(generatedDirectory);
    if (framework === '.svelte-kit') {
      return { '$lib': ['./src/lib'], '$lib/*': ['./src/lib/*'] };
    }
    if (framework === '.nuxt') {
      const source = ['./app', '.'];
      const root = ['.'];
      const under = (dirs: string[]) => dirs.map((d) => `${d}/*`);
      return {
        '~': source, '~/*': under(source), '@': source, '@/*': under(source),
        '~~': root, '~~/*': under(root), '@@': root, '@@/*': under(root),
      };
    }
  }
  return undefined;
}

/**
 * Every emitted path hangs off this, not off `rootDir`.
 *
 * When `baseMservPath` names an ancestor of `rootDir`, paths are relative to
 * that ancestor, so two runs over two subtrees of one service produce paths that
 * join. Otherwise `rootDir` is the anchor.
 */
/**
 * A path with every symlink resolved, or the path itself when it cannot be.
 *
 * Two spellings of one directory must not produce two IRs. A root reached through a
 * symlink is ordinary — macOS `/tmp` and `/var`, a symlinked checkout or home, a
 * container bind mount — and the module resolver always answers in real paths for a
 * package found under `node_modules`, which is how every workspace package is linked.
 * Resolving at the root makes both sides one spelling; relative emitted paths are
 * unchanged, because they are relative to that root either way (#795, and #588 for
 * the same class of defect in the library cache key).
 */
function realPathOf(absolutePath: string): string {
  try {
    return fs.realpathSync(absolutePath);
  } catch {
    // A path that does not exist, or that cannot be read, is left exactly as given:
    // the caller's error is better than one invented here.
    return absolutePath;
  }
}

function pathAnchorFor(rootDir: string, baseMservPath: string): string {
  if (baseMservPath === '') {
    return rootDir;
  }
  const base = path.resolve(baseMservPath);
  const relative = path.relative(base, rootDir);
  const rootIsInsideBase = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  return rootIsInsideBase ? base : rootDir;
}

function toRelative(anchor: string, absolutePath: string): string {
  return path.relative(anchor, absolutePath).split(path.sep).join('/');
}

/**
 * A module's qualified name: the relative path with its extension removed.
 *
 * Cutting at the last dot gave `pkg/a.js` for `pkg/a.js.flow`, so a qualified
 * name carried an extension. The directory part is preserved, which is why the
 * strip is applied to the basename and rejoined rather than to the whole path.
 */
function stripExtension(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/');
  const directory = slash < 0 ? '' : relativePath.slice(0, slash + 1);
  return directory + stripJsExtension(relativePath.slice(slash + 1));
}

/**
 * Every JavaScript file under `rootDir`, excluding the directories that are
 * never the project.
 *
 * `node_modules` is excluded **by name**. That is not a scale optimisation:
 * those files are real source, and analysing them as PROJECT code would stage
 * third-party declarations into the wrong provenance bucket — they belong to
 * `lib_js_*`, which the engine stages and the parser does not emit.
 */
function collectJavaScriptFiles(
  rootDir: string,
  excludes: ReadonlySet<string>,
  /**
   * How many source files each skipped directory NAME cost, counted.
   *
   * ## A directory skip is invisible, because the walk never descends
   *
   * one bundled package reported `filesSeen = 0`, `filesAnalysed = 0`,
   * `bundledFilesExcluded = 0` and an empty skipped-files CSV — a whole package
   * contributing nothing, with every counter agreeing that nothing had
   * happened. Its four files were all under `dist/`.
   *
   * The exclusion is right. The SILENCE is §9 of `BUILDING-A-PARSER.md`: on
   * one large framework checkout a structural exclusion dropped 1,270 of 1,821 files and nothing
   * counted them, and the run reported success. A file-level skip reaches
   * `skippedFiles`; a DIRECTORY-level skip never does, because the walker turns
   * around at the directory and the files inside are never enumerated.
   *
   * So they are enumerated — once, only to be counted. The cost is a readdir of
   * a tree that is not being analysed, paid so that "this package contributed
   * nothing" and "this package was skipped" are different answers.
   */
  skippedByDirectory: Map<string, number>,
  /**
   * One entry per pruned directory, with its path, so the skip table can carry a
   * row for it (#790). The name-keyed counts above answer "how much was pruned";
   * this answers "where", which is what a reader needs to tell a first-party
   * package under `packages/node_modules` from an installed dependency.
   */
  prunedDirectories: Array<{ directory: string; name: string; files: number; generated?: boolean }>,
  /**
   * Excluded names to walk anyway when they sit DIRECTLY under `rootDir` (#620):
   * the build directory a package root's own `package.json` ships from.
   */
  walkUnderRoot: ReadonlySet<string> = new Set(),
  /** Every `package.json` passed on the walk, collected for the entry rows (#616). */
  packageJsonsSeen: Set<string> = new Set()
): string[] {
  const out: string[] = [];
  const countUnder = (directory: string): number => {
    let n = 0;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return 0;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        n += countUnder(path.join(directory, entry.name));
      } else if (isJavaScriptSourceFile(entry.name)) {
        n += 1;
      }
    }
    return n;
  };
  const walk = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (isGitIgnoredDir(full) && !(directory === rootDir && walkUnderRoot.has(entry.name))) {
          continue;
        }
        // a build's output directory is pruned like a skipped name, and counted like one (#1545)
        const generated = isGeneratedOutputDirectory(directory, entry.name);
        if (!generated && (!excludes.has(entry.name) || (directory === rootDir && walkUnderRoot.has(entry.name)))) {
          walk(full);
          continue;
        }
        const cost = countUnder(full);
        if (cost > 0) {
          skippedByDirectory.set(entry.name,
            (skippedByDirectory.get(entry.name) ?? 0) + cost);
          prunedDirectories.push({ directory: full, name: entry.name, files: cost, generated });
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (entry.name === 'package.json') {
        packageJsonsSeen.add(full);
      }
      // `.vue`, `.svelte` and `.astro` included: `scriptTextOf` decides what each one holds for JavaScript
      // a minified or bundled script is vendored output, skipped when the index detected its languages (utils/git-ignored.ts)
      if (isJavaScriptSourceFile(entry.name) && !isVendoredFile(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(rootDir);
  return out;
}
