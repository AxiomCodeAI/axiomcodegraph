import * as fs from 'fs';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityUtils } from '@/utils/entity-utils';
import * as fsp from 'fs/promises';
import * as path from 'path';

import {
  isPythonPackageInitFileName,
  PYTHON_CSV_FILES,
  PYTHON_PACKAGE_INIT_FILENAMES,
  PYTHON_PACKAGE_INIT_STEM,
  PYTHON_TARGET_VERSION,
} from '@/constants/python-constants';
import { PythonDialect, PythonEmissionRegime } from '@/enums/python/modules';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';
import {
  ProjectModuleFacts,
  PythonResolutionLinker,
} from '@/parsers/python/extractors/python-resolution-linker';
import { Python2Finding } from '@/parsers/python/types';
import { isGitIgnoredDir } from '@/utils/git-ignored';
import { parseFilesInPool, parsePoolJobs } from '@/workflows/python/python-parse-pool';

/** One rejected or unanalysable file. */
interface SkippedPythonFile {
  filePath: string;
  baseMservPath: string;
  serviceVersionLinkHash: string;
  reason: SkippedFileReason;
  /** The offending construct, for a Python 2 rejection; `''` otherwise. */
  construct: string;
  startLine: number;
  startColumn: number;
  detail: string;
}

export interface PythonAnalysisOptions {
  /** Repo root to walk. */
  rootDir: string;
  /** Where the CSVs are written. */
  outputDir: string;
  baseMservPath: string;
  /**
   * The service version IDENTIFIER, as the caller knows it — a tag, a commit,
   * a release name. It is HASHED here, exactly as the Java analyzer hashes its
   * `serviceVersionLink`, so the two languages produce joinable values.
   *
   * Prefer this over {@link serviceVersionLinkHash}: passing a raw string
   * straight into a column named `...LinkHash` is what this replaces, and it
   * meant a rule ported from Java compared a hash against an unhashed string
   * and matched nothing.
   */
  serviceVersionLink?: string;
  /**
   * A PRE-COMPUTED hash, for a caller that already has one.
   *
   * Kept because some callers legitimately do, but if `serviceVersionLink` is
   * given it wins — deriving is the correct path and this is the escape hatch.
   */
  serviceVersionLinkHash?: string;
  /** Directory names to skip entirely. */
  excludeDirs?: string[];
}

export interface PythonAnalysisSummary {
  filesSeen: number;
  filesAnalysed: number;
  filesRejected: number;
  /**
   * Files where the EXTRACTOR threw — always a defect, never a decision.
   *
   * Separate from `filesRejected` because a caller that treats them alike cannot
   * tell a clean run from a parser that crashed on every file and wrote empty
   * relations.
   */
  extractionErrors: number;
  counts: Record<string, number>;
  /** Cross-module resolution results, from the project-level pass. */
  resolution: { importsResolved: number; callSitesResolved: number };
}

/**
 * Directories that never contain source worth analysing, matched by NAME
 * anywhere in the walk.
 *
 * `build` is deliberately NOT here, at any depth. `build/lib` (and its
 * platform-suffixed siblings) is the setuptools output that duplicated every
 * `qualifiedName` project-wide in #564 — but `build` alone is also a real
 * top-level package name (PyPA ships the PEP 517 frontend as `import build`),
 * and #531 / #542 are what a bare-name exclusion applied at every depth
 * already did to Python once: pruned a legitimate package whose segment
 * happened to be `build`, `out`, `env` or `spec`, silently. What distinguishes
 * the artifact from a package is POSITION and SHAPE, not name — it sits at
 * the project ROOT, and its children are `lib`, `lib.<plat>-<pyver>`,
 * `bdist.*`, `scripts-*`, `temp.*` — so `collectRootBuildFiles` below excludes
 * exactly that combination, at the root only, and a `build/` two levels down,
 * or a root `build/` with any OTHER child, is walked like any other package.
 *
 * `dist/` is here, at any depth, matching the TypeScript list: it holds built
 * wheels and sdists, has the same duplication shape as `build/lib`, and
 * unlike `build` there is no comparably known PyPI package shipping SOURCE
 * under that exact name. TypeScript's other two, `out` and `coverage`, are
 * NOT added: neither is an established Python packaging or coverage-tool
 * convention (`coverage.py`'s own default is `htmlcov/`) the way they are for
 * a JS bundler, so there is no evidence for them one way or the other and
 * adding them would be a different language's convention copied across
 * without a reason.
 *
 * `site-packages` and `*.egg-info` (suffix-matched in `collectPythonFiles`)
 * are excluded unconditionally, at any depth: neither is a syntactically
 * valid Python import name (both contain a hyphen), so excluding them can
 * never drop real source.
 */
export const DEFAULT_EXCLUDES = [
  '__pycache__', '.git', 'node_modules', '.venv', 'venv', '.tox',
  'dist', '.eggs', '.mypy_cache', '.pytest_cache', '_build', 'site-packages',
];

/**
 * The setuptools `build_py` / `build_ext` / `build_scripts` / `bdist` output
 * shapes: `lib`, `lib.<platform>-<pyver>`, `temp.<platform>-<pyver>`,
 * `scripts-<pyver>`, `bdist.<platform>`. Checked ONLY against the immediate
 * children of the project ROOT's `build/` directory — see
 * `collectRootBuildFiles` — never at another depth, so this cannot become the
 * bare-name-at-every-depth mistake #531 and #542 already were for Python.
 */
const BUILD_ARTIFACT_SHAPE = /^(lib(\.|$)|temp\.|scripts-|bdist\.)/;

/** Chunk size for CSV writes, matching the Java analyzer. */
const CHUNK_SIZE = 50_000;

/**
 * Walks a repository, extracts the Python fact spine, and exports it as TSV.
 *
 * ## Accumulate, then export, in a total order
 *
 * Byte-identical output across runs is a **gate**, not a nicety, and it is not
 * achievable by writing rows as they are discovered: filesystem enumeration
 * order is not guaranteed stable across machines or runs. So every row is
 * accumulated in memory, files are processed in **sorted path order**, and
 * within a file the extractors already emit in a deterministic order (scope-tree
 * pre-order, bindings sorted by name, expressions breadth-first by position).
 * The result is one total order over every relation.
 *
 * ## Rejection is recorded, not merely absent
 *
 * A Python 2 file emits **no facts at all** — no module row, nothing — because
 * it parses cleanly and a partial fact set from it would be a confident wrong
 * answer. Instead it gets a row in `skipped-python-files.csv` naming the
 * offending construct and its position, so the rejection is auditable rather
 * than an unexplained gap.
 *
 * `py_parse_gap` rows are deliberately **not** emitted: that relation is in the
 * deferred set for the second freeze, so the rejection detail lives in the
 * skipped-files CSV until it is unfrozen.
 */

/**
 * A `.py`/`.pyi` file, or an executable script with no extension whose first
 * line is a python shebang (`#!/usr/bin/env python3`): the interpreter runs it
 * as a module, so it is analysed as one (#1376).
 */
const PYTHON_SHEBANG = /^#![^\n]*\bpython[0-9.]*\b/;
export function isPythonSourceFile(full: string, name: string): boolean {
  if (name.endsWith('.py') || name.endsWith('.pyi')) return true;
  if (name.includes('.')) return false;
  let fd: number | undefined;
  try {
    fd = fs.openSync(full, 'r');
    const head = Buffer.alloc(128);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    return PYTHON_SHEBANG.test(head.subarray(0, n).toString('utf-8'));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
export class PythonProjectAnalyzer {
  private extractor: PythonFactExtractor;
  private resolutionLinker: PythonResolutionLinker;
  /**
   * The DERIVED service-version hash for the run in flight.
   *
   * Held on the instance because `recordSkip` needs it and is not on the
   * `analyze` call path — a skipped file still carries the version it was
   * skipped under.
   */
  private serviceVersionLinkHash = '';
  private skippedFiles: SkippedPythonFile[] = [];

  constructor(extractor?: PythonFactExtractor, resolutionLinker?: PythonResolutionLinker) {
    this.extractor = extractor ?? new PythonFactExtractor();
    this.resolutionLinker = resolutionLinker ?? new PythonResolutionLinker();
  }

  async analyze(options: PythonAnalysisOptions): Promise<PythonAnalysisSummary> {
    // Derived the same way and with the same prefix as the Java analyzer, so a
    // rule joining on service version works across both languages. py_module's
    // PK includes this value, so getting it wrong does not merely mislabel a
    // column — it changes every module hash and every FK that points at one.
    this.serviceVersionLinkHash =
      options.serviceVersionLink !== undefined
        ? EntityUtils.generateEntityHash(
            ENTITY_IDENTIFIERS.SERVICE_VERSION,
            options.serviceVersionLink
          )
        : (options.serviceVersionLinkHash ?? '');
    const serviceVersionLinkHash = this.serviceVersionLinkHash;
    const excludes = new Set(options.excludeDirs ?? DEFAULT_EXCLUDES);
    // Sorted, so the accumulation order — and therefore the output bytes — does
    // not depend on directory enumeration order.
    const files = (await this.collectPythonFiles(options.rootDir, excludes)).sort();

    this.skippedFiles = [];
    const accumulated = {
      modules: [] as { toCsv(): string; getCsvHeader(): string }[],
      scopes: [] as { toCsv(): string; getCsvHeader(): string }[],
      bindings: [] as { toCsv(): string; getCsvHeader(): string }[],
      types: [] as { toCsv(): string; getCsvHeader(): string }[],
      typeBases: [] as { toCsv(): string; getCsvHeader(): string }[],
      methods: [] as { toCsv(): string; getCsvHeader(): string }[],
      methodParameters: [] as { toCsv(): string; getCsvHeader(): string }[],
      imports: [] as { toCsv(): string; getCsvHeader(): string }[],
      expressions: [] as { toCsv(): string; getCsvHeader(): string }[],
      callSites: [] as { toCsv(): string; getCsvHeader(): string }[],
      typeReferences: [] as { toCsv(): string; getCsvHeader(): string }[],
      fields: [] as { toCsv(): string; getCsvHeader(): string }[],
      fieldPositions: [] as { toCsv(): string; getCsvHeader(): string }[],
      blocks: [] as { toCsv(): string; getCsvHeader(): string }[],
      comments: [] as { toCsv(): string; getCsvHeader(): string }[],
      parseGaps: [] as { toCsv(): string; getCsvHeader(): string }[],
      typeParameters: [] as { toCsv(): string; getCsvHeader(): string }[],
      decorators: [] as { toCsv(): string; getCsvHeader(): string }[],
      decoratorArguments: [] as { toCsv(): string; getCsvHeader(): string }[],
    };

    // Per-module facts, kept so the cross-module pass can run over all of them
    // once extraction is complete. Cross-module resolution cannot happen during
    // extraction: `from .helpers import build_pipeline` needs helpers.py to have
    // been parsed, and file order is not a dependency order.
    const perModule: ProjectModuleFacts[] = [];

    // THE PER-FILE WORK RUNS ON WORKER THREADS when there are enough files
    // (python-parse-pool.ts): read, parse, mirror, extract and hash are
    // independent between files, and profiling shows no single stage dominates
    // — the whole per-file pipeline does. The loop below still CONSUMES every
    // outcome in sorted file order through the unchanged body, so the
    // accumulated rows, the skip order and the output bytes are byte-identical
    // to the serial path (AXIOMCODE_PARSE_JOBS=1), whichever order workers
    // finish in. Everything cross-module stays down in `linkProject`.
    let analysed = 0;

    // One file's outcome, consumed the same way whichever thread produced it.
    // The pool calls this in file order as results arrive (never after
    // buffering them all — a project's rows fill the heap once, not twice),
    // and the serial loop calls it inline, so skip order, accumulation order
    // and therefore output bytes are identical across the two paths.
    const consumeOutcome = (
      filePath: string,
      outcome: { readError?: string; extractError?: string; facts?: ReturnType<PythonFactExtractor['extract']> }
    ): void => {
      if (outcome.readError !== undefined) {
        this.recordSkip(filePath, options, SkippedFileReason.READ_ERROR, [], outcome.readError);
        return;
      }
      if (outcome.extractError !== undefined || !outcome.facts) {
        this.recordSkip(
          filePath,
          options,
          SkippedFileReason.EXTRACTION_ERROR,
          [],
          outcome.extractError ?? 'worker returned no facts'
        );
        return;
      }
      const facts = outcome.facts;

      if (facts.dialect !== PythonDialect.PY3 || !facts.module) {
        this.recordSkip(
          filePath,
          options,
          facts.skippedReason ?? SkippedFileReason.PY2_CONSTRUCT_DETECTED,
          facts.python2Findings,
          ''
        );
        // A REJECTED file still contributes its parse gaps, and this is the case
        // they exist for: nothing else about the file is emitted, so without
        // these rows it is indistinguishable from a file that simply had no
        // facts in it. The skipped-files CSV records the DECISION; these record
        // WHAT could not be represented and where.
        accumulated.parseGaps.push(...facts.parseGaps);
        return;
      }

      analysed += 1;
      accumulated.modules.push(facts.module);
      accumulated.scopes.push(...facts.scopes);
      accumulated.bindings.push(...facts.bindings);
      accumulated.types.push(...facts.types);
      accumulated.typeBases.push(...facts.typeBases);
      accumulated.methods.push(...facts.methods);
      accumulated.methodParameters.push(...facts.methodParameters);
      accumulated.imports.push(...facts.imports);
      accumulated.expressions.push(...facts.expressions);
      accumulated.callSites.push(...facts.callSites);
      accumulated.typeReferences.push(...facts.typeReferences);
      accumulated.fields.push(...facts.fields);
      accumulated.fieldPositions.push(...facts.fieldPositions);
      accumulated.blocks.push(...facts.blocks);
      accumulated.comments.push(...facts.comments);
      accumulated.typeParameters.push(...facts.typeParameters);
      accumulated.parseGaps.push(...facts.parseGaps);
      accumulated.decorators.push(...facts.decorators);
      accumulated.decoratorArguments.push(...facts.decoratorArguments);

      perModule.push({
        qualifiedName: facts.module.getQualifiedName(),
        moduleHash: facts.module.getHash(),
        isPackage: isPythonPackageInitFileName(path.basename(filePath)),
        outerDirs: this.outerDirsOf(filePath, facts.module.getQualifiedName()),
        scopes: facts.scopes,
        bindings: facts.bindings,
        types: facts.types,
        typeBases: facts.typeBases,
        methods: facts.methods,
        methodParameters: facts.methodParameters,
        imports: facts.imports,
        callSites: facts.callSites,
        expressions: facts.expressions,
        typeReferences: facts.typeReferences,
        fields: facts.fields,
        decorators: facts.decorators,
        decoratorArguments: facts.decoratorArguments,
        fieldHashByTypeAndName: facts.fieldHashByTypeAndName,
        receiverNameByMethodHash: facts.receiverNameByMethodHash,
        assignedValueByTargetRange: facts.assignedValueByTargetRange,
        expressionByByteRange: facts.expressionByByteRange,
        byteRangeByExpression: new Map(
          [...facts.expressionByByteRange].map(([range, hash]) => [hash, range])
        ),
      });
    };

    // THE PER-FILE WORK RUNS ON WORKER THREADS when there are enough files
    // (python-parse-pool.ts): read, parse, mirror, extract and hash are
    // independent between files, and profiling shows no single stage dominates
    // — the whole per-file pipeline does. Everything cross-module stays down
    // in `linkProject`. AXIOMCODE_PARSE_JOBS=1 restores the strict serial
    // path; the pool declining (no compiled worker beside this file) falls
    // back to it too.
    const debugT = process.env.AXIOMCODE_PARSE_DEBUG ? Date.now() : 0;
    const mark = (what: string) => {
      if (debugT) process.stderr.write(`[parse-pool] ${what} +${((Date.now() - debugT) / 1000).toFixed(1)}s\n`);
    };
    const jobs = parsePoolJobs(files.length);
    let pooled = false;
    if (jobs > 1) {
      pooled = await parseFilesInPool(
        files.map((filePath, i) => ({
          i,
          filePath,
          recordedFilePath: this.recordedFilePath(filePath, options.rootDir, options.baseMservPath),
          moduleQualifiedName: this.moduleQualifiedNameFor(options.rootDir, filePath),
          baseMservPath: options.baseMservPath,
          serviceVersionLinkHash,
        })),
        jobs,
        (i, outcome) => consumeOutcome(files[i] as string, outcome)
      );
    }
    mark(`pool done (${jobs} jobs, ${files.length} files)`);
    if (!pooled) {
      for (const filePath of files) {
        let outcome;
        try {
          const sourceCode = await fsp.readFile(filePath, 'utf-8');
          try {
            outcome = {
              facts: this.extractor.extract({
                sourceCode,
                filePath: this.recordedFilePath(filePath, options.rootDir, options.baseMservPath),
                baseMservPath: options.baseMservPath,
                moduleQualifiedName: this.moduleQualifiedNameFor(options.rootDir, filePath),
                serviceVersionLinkHash,
                emissionRegime: PythonEmissionRegime.PY3_0_11,
              }),
            };
          } catch (error) {
            outcome = { extractError: String(error) };
          }
        } catch (error) {
          outcome = { readError: String(error) };
        }
        consumeOutcome(filePath, outcome);
      }
    }

    // The cross-module pass mutates rows already in `accumulated` — they are the
    // same objects — so it must run BEFORE export.
    mark('consume done');
    const resolution = this.resolutionLinker.linkProject(perModule);
    mark('linkProject done');

    await fsp.mkdir(options.outputDir, { recursive: true });
    await this.exportCsv(accumulated.modules, options.outputDir, PYTHON_CSV_FILES.MODULES);
    await this.exportCsv(accumulated.scopes, options.outputDir, PYTHON_CSV_FILES.SCOPES);
    await this.exportCsv(accumulated.bindings, options.outputDir, PYTHON_CSV_FILES.BINDINGS);
    await this.exportCsv(accumulated.types, options.outputDir, PYTHON_CSV_FILES.TYPES);
    await this.exportCsv(accumulated.typeBases, options.outputDir, PYTHON_CSV_FILES.TYPE_BASES);
    await this.exportCsv(accumulated.methods, options.outputDir, PYTHON_CSV_FILES.METHODS);
    await this.exportCsv(
      accumulated.methodParameters,
      options.outputDir,
      PYTHON_CSV_FILES.METHOD_PARAMETERS
    );
    await this.exportCsv(accumulated.imports, options.outputDir, PYTHON_CSV_FILES.IMPORTS);
    await this.exportCsv(accumulated.expressions, options.outputDir, PYTHON_CSV_FILES.EXPRESSIONS);
    await this.exportCsv(accumulated.callSites, options.outputDir, PYTHON_CSV_FILES.CALL_SITES);
    await this.exportCsv(
      accumulated.typeReferences,
      options.outputDir,
      PYTHON_CSV_FILES.TYPE_REFERENCES
    );
    await this.exportCsv(accumulated.fields, options.outputDir, PYTHON_CSV_FILES.FIELDS);
    await this.exportCsv(
      accumulated.fieldPositions,
      options.outputDir,
      PYTHON_CSV_FILES.FIELD_POSITIONS
    );
    await this.exportCsv(accumulated.blocks, options.outputDir, PYTHON_CSV_FILES.BLOCKS);
    await this.exportCsv(accumulated.comments, options.outputDir, PYTHON_CSV_FILES.COMMENTS);
    await this.exportCsv(accumulated.parseGaps, options.outputDir, PYTHON_CSV_FILES.PARSE_GAPS);
    await this.exportCsv(
      accumulated.typeParameters,
      options.outputDir,
      PYTHON_CSV_FILES.TYPE_PARAMETERS
    );
    await this.exportCsv(accumulated.decorators, options.outputDir, PYTHON_CSV_FILES.DECORATORS);
    await this.exportCsv(
      accumulated.decoratorArguments,
      options.outputDir,
      PYTHON_CSV_FILES.DECORATOR_ARGUMENTS
    );
    await this.exportSkippedFilesCsv(options.outputDir);

    return {
      filesSeen: files.length,
      filesAnalysed: analysed,
      filesRejected: this.skippedFiles.length,
      // Surfaced separately from `filesRejected` because it means something
      // categorically different: a rejected file is a decision, an extraction
      // error is a defect. Folding the two together lets a parser that throws on
      // every file report a clean run with empty relations.
      extractionErrors: this.skippedFiles.filter(
        f => f.reason === SkippedFileReason.EXTRACTION_ERROR
      ).length,
      resolution,
      counts: {
        py_module: accumulated.modules.length,
        py_scope: accumulated.scopes.length,
        py_binding: accumulated.bindings.length,
        py_type: accumulated.types.length,
        py_type_base: accumulated.typeBases.length,
        py_method: accumulated.methods.length,
        py_method_parameter: accumulated.methodParameters.length,
        py_import: accumulated.imports.length,
        py_expression: accumulated.expressions.length,
        py_call_site: accumulated.callSites.length,
        py_type_reference: accumulated.typeReferences.length,
        py_field: accumulated.fields.length,
        py_field_position: accumulated.fieldPositions.length,
        py_block: accumulated.blocks.length,
        py_comment: accumulated.comments.length,
        py_type_parameter: accumulated.typeParameters.length,
        py_parse_gap: accumulated.parseGaps.length,
        py_decorator: accumulated.decorators.length,
        py_decorator_argument: accumulated.decoratorArguments.length,
      },
    };
  }

  /** Every rejected file, for callers that want to report rather than re-read the CSV. */
  getSkippedFiles(): readonly SkippedPythonFile[] {
    return this.skippedFiles;
  }

  private recordSkip(
    filePath: string,
    options: PythonAnalysisOptions,
    reason: SkippedFileReason,
    findings: Python2Finding[],
    detail: string
  ): void {
    // The FIRST finding in source order names the rejection; the count goes in
    // the detail so a multi-construct file is not misread as a single hit.
    const first = findings[0];
    this.skippedFiles.push({
      filePath: this.recordedFilePath(filePath, options.rootDir, options.baseMservPath),
      baseMservPath: options.baseMservPath,
      serviceVersionLinkHash: this.serviceVersionLinkHash,
      reason,
      construct: first?.construct ?? '',
      startLine: first?.startLine ?? 0,
      startColumn: first?.startColumn ?? 0,
      detail:
        findings.length > 0
          ? `tier${first?.tier ?? 0}; ${findings.length} construct(s); target ${PYTHON_TARGET_VERSION}`
          : detail.replace(/[\t\n\r]+/g, ' ').slice(0, 200),
    });
  }

  /**
   * Derives a module's true importable name by walking up while `__init__.py`
   * is present.
   *
   * The package walk is what makes the name IMPORTABLE rather than merely
   * unique, and the difference is load-bearing. Deriving the name from the path
   * relative to `rootDir` — which is what this used to do, despite a comment
   * claiming otherwise — means analysing `.../lib/python3.10/unittest` names its
   * modules `case`, `loader` and `__init__`. Three consequences, all measured:
   *
   * 1. `class T(unittest.TestCase)` can never resolve, because no module in the
   *    set is called `unittest`. That base was unresolved 244 times, and it took
   *    3,201 `self.assertEqual`-style call sites with it, since a method is only
   *    reachable through the MRO once the base resolves.
   * 2. `__init__.py` is not a submodule called `__init__`; it IS the package. A
   *    package's own name is where re-exports live, so losing it loses every
   *    `from .case import TestCase` alias.
   * 3. `__init__` is not even unique — every package has one, so analysing two
   *    packages produced two modules with the same qualified name.
   *
   * Walking up from the FILE rather than from `rootDir` also makes the name
   * independent of where analysis was started, so the same file gets the same
   * name whether the root is the package or its parent.
   */
  /**
   * The path recorded on every row, and part of a module's identity hash.
   *
   * Relative to the MSERV, not to the analysis root. Those differ whenever a
   * repository holds more than one project: `extract` passes `rootDir` per
   * detected project and `baseMservPath` for the repository, so a root-relative
   * path drops exactly the segment that tells two projects apart.
   *
   * Two consequences, and the second is the serious one.
   *
   * `src/main.py` and `tests/main.py` both became `main.py`. The module hash is
   * filePath + baseMservPath + qualifiedName + regime + version, and with
   * `src` and `tests` not being packages the qualified name collapses to `main`
   * for both, so every input matched and the two files hashed IDENTICALLY.
   * Fact files load with set semantics, so the IR ended up with one module
   * where the source has two, and their methods merged into it. Nothing
   * downstream could separate them: filePath, qualifiedName and hash were all
   * equal, the directory having been discarded before anything else ran.
   *
   * It also made the column inconsistent for tooling that keys on it: a package
   * analysed at its own root reported `core/engine.py` while a loose module
   * reported a bare `main.py`, so the same column sometimes carried the path
   * from the project and sometimes only a file name.
   *
   * The fallback matters. `baseMservPath` is not required to be an ancestor of
   * the file -- tests pass a symbolic `/repo` -- and `path.relative` would then
   * climb out with `../..`, which is worse than the bare name. So the mserv is
   * used only when it actually contains the file, and the analysis root is the
   * fallback, which is what every existing caller already got.
   */
  private recordedFilePath(
    filePath: string,
    rootDir: string,
    baseMservPath: string
  ): string {
    const fromMserv = path.relative(baseMservPath, filePath);
    if (fromMserv !== '' && !fromMserv.startsWith('..') && !path.isAbsolute(fromMserv)) {
      return fromMserv;
    }
    return path.relative(rootDir, filePath) || path.basename(filePath);
  }

  /** The directory names above a module's top-level package, outermost first (see ProjectModuleFacts.outerDirs). */
  private outerDirsOf(filePath: string, qualifiedName: string): string[] {
    const dirs = path.dirname(path.resolve(filePath)).split(path.sep).filter(part => part !== '');
    const inPackage = isPythonPackageInitFileName(path.basename(filePath))
      ? qualifiedName.split('.').length
      : qualifiedName.split('.').length - 1;
    return dirs.slice(0, Math.max(0, dirs.length - inPackage));
  }

  private moduleQualifiedNameFor(rootDir: string, filePath: string): string {
    const parsed = path.parse(filePath);
    const segments: string[] = [];
    let directory = parsed.dir;
    // Ascend while each directory is a package. `existsSync` is acceptable here:
    // it runs once per file and the answer is needed before the name is minted.
    while (directory !== '' && directory !== path.dirname(directory)) {
      if (!this.directoryIsPackage(directory)) {
        break;
      }
      segments.unshift(path.basename(directory));
      directory = path.dirname(directory);
    }
    // `__init__` is the package itself, not a submodule of it.
    if (parsed.name !== PYTHON_PACKAGE_INIT_STEM) {
      segments.push(parsed.name);
    }
    if (segments.length > 0) {
      return segments.join('.');
    }
    // A loose file outside any package falls back to the path relative to the
    // analysis root, which at least keeps it distinct from its namesakes.
    const relative = path.relative(rootDir, filePath);
    const relativeParsed = path.parse(relative);
    const relativeSegments =
      relativeParsed.dir === '' ? [] : relativeParsed.dir.split(path.sep);
    // Still drop a trailing `__init__` here. With the ascent fixed this is not
    // reachable for a regular package, but the invariant is worth holding
    // unconditionally: no module is ever NAMED `__init__`, so nothing
    // downstream has to special-case it.
    const relativeName =
      relativeParsed.name === PYTHON_PACKAGE_INIT_STEM ? [] : [relativeParsed.name];
    return [...relativeSegments, ...relativeName]
      .filter(part => part !== '' && part !== '.')
      .join('.') || parsed.name;
  }

  /**
   * Whether a directory is a regular package.
   *
   * `existsSync` is acceptable here: it runs once per directory per file and
   * the answer is needed before the name is minted.
   */
  private directoryIsPackage(directory: string): boolean {
    return PYTHON_PACKAGE_INIT_FILENAMES.some(marker =>
      fs.existsSync(path.join(directory, marker))
    );
  }

  private async collectPythonFiles(
    dir: string,
    excludes: Set<string>,
    // Whether `dir` IS the walk's root, so its `build` child (if any) is the
    // ONE place `collectRootBuildFiles` applies. `false` at every other
    // depth, deliberately: a `build/` two levels down is walked like any
    // other directory, never shape-matched (#564).
    isRoot = true
  ): Promise<string[]> {
    const found: string[] = [];
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (excludes.has(entry.name) || entry.name.endsWith('.egg-info') || isGitIgnoredDir(full)) {
          continue;
        }
        if (isRoot && entry.name === 'build') {
          found.push(...(await this.collectRootBuildFiles(full, excludes)));
          continue;
        }
        found.push(...(await this.collectPythonFiles(full, excludes, false)));
        continue;
      }
      if (entry.isFile() && isPythonSourceFile(full, entry.name)) {
        found.push(full);
      }
    }
    return found;
  }

  /**
   * Walks the project ROOT's `build/` directory specifically (never one at
   * another depth — see `collectPythonFiles`), excluding only the immediate
   * children matching `BUILD_ARTIFACT_SHAPE`. Everything else under it —
   * `build/__init__.py`, `build/frontend.py`, a data file, a submodule with
   * some other name — is walked exactly like source anywhere else, because a
   * real package literally named `build` (the PyPA PEP 517 frontend is one)
   * is exactly as legitimate here as anywhere (#564).
   */
  private async collectRootBuildFiles(
    buildDir: string,
    excludes: Set<string>
  ): Promise<string[]> {
    const found: string[] = [];
    const entries = await fsp.readdir(buildDir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(buildDir, entry.name);
      if (entry.isDirectory()) {
        if (
          excludes.has(entry.name) ||
          entry.name.endsWith('.egg-info') ||
          BUILD_ARTIFACT_SHAPE.test(entry.name)
        ) {
          continue;
        }
        found.push(...(await this.collectPythonFiles(full, excludes, false)));
        continue;
      }
      if (entry.isFile() && isPythonSourceFile(full, entry.name)) {
        found.push(full);
      }
    }
    return found;
  }

  /**
   * Writes one relation, in chunks.
   *
   * Chunked because a single joined string of a large fact table overflows V8's
   * maximum string length — the same reason the Java analyzer chunks.
   */
  private async exportCsv(
    rows: { toCsv(): string; getCsvHeader(): string }[],
    outputDir: string,
    filename: string
  ): Promise<void> {
    const outputPath = path.join(outputDir, filename);
    const first = rows[0];
    if (!first) {
      // An empty relation still gets its file, so a consumer can distinguish
      // "no rows" from "the parser never ran".
      await fsp.writeFile(outputPath, '', 'utf-8');
      return;
    }

    await fsp.writeFile(outputPath, first.getCsvHeader() + '\n', 'utf-8');
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      await fsp.appendFile(outputPath, chunk.map(r => r.toCsv()).join('\n') + '\n', 'utf-8');
    }
  }

  private async exportSkippedFilesCsv(outputDir: string): Promise<void> {
    const outputPath = path.join(outputDir, PYTHON_CSV_FILES.SKIPPED_FILES);
    const header = [
      'filePath',
      'baseMservPath',
      'serviceVersionLinkHash',
      'reason',
      'construct',
      'startLine',
      'startColumn',
      'detail',
    ].join('\t');

    // Sorted by path so the file is byte-identical across runs.
    const rows = [...this.skippedFiles]
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map(f =>
        [
          f.filePath,
          f.baseMservPath,
          f.serviceVersionLinkHash,
          f.reason,
          f.construct,
          f.startLine.toString(),
          f.startColumn.toString(),
          f.detail,
        ].join('\t')
      );

    await fsp.writeFile(outputPath, [header, ...rows].join('\n') + '\n', 'utf-8');
  }
}
