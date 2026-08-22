import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

import { PYTHON_CSV_FILES, PYTHON_TARGET_VERSION } from '@/constants/python-constants';
import { PythonDialect, PythonEmissionRegime } from '@/enums/python/modules';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';
import {
  ProjectModuleFacts,
  PythonResolutionLinker,
} from '@/parsers/python/extractors/python-resolution-linker';
import { Python2Finding } from '@/types/python';

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
  serviceVersionLinkHash: string;
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

/** Directories that never contain source worth analysing. */
const DEFAULT_EXCLUDES = ['__pycache__', '.git', 'node_modules', '.venv', 'venv', '.tox'];

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
export class PythonProjectAnalyzer {
  private extractor: PythonFactExtractor;
  private resolutionLinker: PythonResolutionLinker;
  private skippedFiles: SkippedPythonFile[] = [];

  constructor(extractor?: PythonFactExtractor, resolutionLinker?: PythonResolutionLinker) {
    this.extractor = extractor ?? new PythonFactExtractor();
    this.resolutionLinker = resolutionLinker ?? new PythonResolutionLinker();
  }

  async analyze(options: PythonAnalysisOptions): Promise<PythonAnalysisSummary> {
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
      decorators: [] as { toCsv(): string; getCsvHeader(): string }[],
      decoratorArguments: [] as { toCsv(): string; getCsvHeader(): string }[],
    };

    // Per-module facts, kept so the cross-module pass can run over all of them
    // once extraction is complete. Cross-module resolution cannot happen during
    // extraction: `from .helpers import build_pipeline` needs helpers.py to have
    // been parsed, and file order is not a dependency order.
    const perModule: ProjectModuleFacts[] = [];

    let analysed = 0;
    for (const filePath of files) {
      let sourceCode: string;
      try {
        sourceCode = await fsp.readFile(filePath, 'utf-8');
      } catch (error) {
        this.recordSkip(filePath, options, SkippedFileReason.READ_ERROR, [], String(error));
        continue;
      }

      let facts;
      try {
        facts = this.extractor.extract({
          sourceCode,
          filePath: path.relative(options.rootDir, filePath) || path.basename(filePath),
          baseMservPath: options.baseMservPath,
          moduleQualifiedName: this.moduleQualifiedNameFor(options.rootDir, filePath),
          serviceVersionLinkHash: options.serviceVersionLinkHash,
          emissionRegime: PythonEmissionRegime.PY3_0_11,
        });
      } catch (error) {
        this.recordSkip(
          filePath,
          options,
          SkippedFileReason.EXTRACTION_ERROR,
          [],
          String(error)
        );
        continue;
      }

      if (facts.dialect !== PythonDialect.PY3 || !facts.module) {
        this.recordSkip(
          filePath,
          options,
          facts.skippedReason ?? SkippedFileReason.PY2_CONSTRUCT_DETECTED,
          facts.python2Findings,
          ''
        );
        continue;
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
      accumulated.decorators.push(...facts.decorators);
      accumulated.decoratorArguments.push(...facts.decoratorArguments);

      perModule.push({
        qualifiedName: facts.module.getQualifiedName(),
        moduleHash: facts.module.getHash(),
        isPackage: path.basename(filePath) === '__init__.py',
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
    }

    // The cross-module pass mutates rows already in `accumulated` — they are the
    // same objects — so it must run BEFORE export.
    const resolution = this.resolutionLinker.linkProject(perModule);

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
      filePath: path.relative(options.rootDir, filePath) || path.basename(filePath),
      baseMservPath: options.baseMservPath,
      serviceVersionLinkHash: options.serviceVersionLinkHash,
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
  private moduleQualifiedNameFor(rootDir: string, filePath: string): string {
    const parsed = path.parse(filePath);
    const segments: string[] = [];
    let directory = parsed.dir;
    // Ascend while each directory is a package. `existsSync` is acceptable here:
    // it runs once per file and the answer is needed before the name is minted.
    while (directory !== '' && directory !== path.dirname(directory)) {
      if (!fs.existsSync(path.join(directory, '__init__.py'))) {
        break;
      }
      segments.unshift(path.basename(directory));
      directory = path.dirname(directory);
    }
    // `__init__` is the package itself, not a submodule of it.
    if (parsed.name !== '__init__') {
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
    return [...relativeSegments, relativeParsed.name]
      .filter(part => part !== '' && part !== '.')
      .join('.') || parsed.name;
  }

  private async collectPythonFiles(
    dir: string,
    excludes: Set<string>
  ): Promise<string[]> {
    const found: string[] = [];
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (excludes.has(entry.name)) {
          continue;
        }
        found.push(...(await this.collectPythonFiles(full, excludes)));
        continue;
      }
      if (entry.name.endsWith('.py') || entry.name.endsWith('.pyi')) {
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
