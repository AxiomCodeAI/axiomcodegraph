import * as fs from 'fs';
import * as path from 'path';

import * as ts from 'typescript';

import { TsDecoratorSystem } from '@/enums/typescript/decorators';
import { TsModuleResolutionMode } from '@/enums/typescript/modules';

/**
 * Which tsconfig GOVERNS a file, and what it says.
 *
 * ## Why this is not "read the tsconfig at the root"
 *
 * A repository is not one program. In this repository's own fixture corpus,
 * `staging/tsconfig.json` explicitly EXCLUDES `annotations/legacy`,
 * `type-system/merging/two-files` and `.../three-files`, each of which has its
 * own tsconfig — because they need options the rest of the corpus cannot have.
 * `legacy/` needs `experimentalDecorators`; a global-script merging fixture
 * cannot have `isolatedModules`. Neither option may be imposed on the others.
 *
 * The consequence for facts is concrete, and it is the reason this file exists:
 * **`ts_decorator.decoratorSystem` differs between two files three directories
 * apart**, and the difference is legitimate rather than noise. Standard TC39
 * decorators and legacy `experimentalDecorators` differ in evaluation order, in
 * what the decorator function receives, and in whether parameter decorators are
 * legal at all. A parser that assumes one system per run gets
 * `annotations/legacy/` wrong — and gets it wrong in the direction that looks
 * plausible, which is the kind of wrong nothing downstream notices.
 *
 * `moduleResolutionMode` and `tsConfigPath` on `ts_module` come from here for
 * the same reason: resolution genuinely differs per project, so a specifier that
 * resolves in one program may legitimately not resolve in another.
 *
 * ## No Program is created
 *
 * `ts.readConfigFile` and `ts.parseJsonConfigFileContent` are pure functions of
 * the file system, and `ts.resolveModuleName` is a pure function of a specifier,
 * options and a host. None typechecks anything, and none needs `node_modules`
 * to have been installed for the answer to be honest — an unresolvable specifier
 * returns `undefined`, which is a correct answer and not a missing one.
 */
export interface GoverningTsConfig {
  /** Absolute path of the governing tsconfig; `""` when no config claims the file. */
  readonly configPath: string;
  readonly options: ts.CompilerOptions;
  readonly moduleResolutionMode: TsModuleResolutionMode;
  /**
   * The decorator system in force FOR THIS FILE.
   *
   * Read from `experimentalDecorators` on the governing config after `extends`
   * has been followed. Never assumed, never inherited from a sibling directory.
   */
  readonly decoratorSystem: TsDecoratorSystem;
  /** The files this config claims, absolute and normalised. Empty when it could not be read. */
  readonly fileNames: ReadonlySet<string>;
  /**
   * The configs this one REFERENCES (`references: [{ path }]`), absolute. A
   * solution-style root (`files: []` plus references) claims no file itself and
   * delegates to these; a file they claim is governed by them (#660).
   */
  readonly references: readonly string[];
}

/**
 * The fallback when no tsconfig claims a file.
 *
 * Recorded as `tsConfigPath = ""` rather than silently borrowing a neighbour's
 * options, because "no config governs this file" is a fact worth being able to
 * see in the fact base.
 */
const DEFAULT_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
};

export class TsConfigResolver {
  /** Parsed configs by absolute config path — parsing one is not cheap and repeats per file. */
  private readonly parsed = new Map<string, GoverningTsConfig | undefined>();
  /** Governing config by absolute file path. */
  private readonly governing = new Map<string, GoverningTsConfig>();

  /**
   * The config that governs `absoluteFilePath`.
   *
   * Nearest ancestor `tsconfig.json` that actually CLAIMS the file. Nearest
   * alone is not enough: `staging/tsconfig.json` is the nearest ancestor of
   * `staging/annotations/legacy/legacy-decorators.ts` and explicitly excludes
   * it, so honouring `include`/`exclude` is what makes this the answer tsc would
   * give. A config that disowns the file does not stop the walk.
   *
   * ## The walk is not bounded by the program being extracted
   *
   * It used to stop at the program root, and that made the answer depend on
   * WHICH program was being extracted rather than on the file. `ts_module`'s
   * primary key is `md5(filePath ‖ baseMservPath ‖ declaredSpecifier ‖ startLine
   * ‖ emissionRegime ‖ serviceVersionLinkHash)` — no program, no config path —
   * so a file reachable from two programs mints ONE key. If the two extractions
   * disagree about the governing config they emit two rows under that one key
   * with different payloads, and Souffle stores both: a single import then
   * yields two contradictory `moduleResolutionMode` values and any count over
   * it doubles.
   *
   * Measured on nest before the ceiling was removed: 7 module keys carrying
   * `moduleResolutionMode {NODE16|NODE10}` and `tsConfigPath {tsconfig.json|""}`.
   * Both shapes came from the ceiling — a nested root with no config of its own
   * (`packages/core/test`), and one whose config claims only `src/**` and
   * `e2e/**` while the file sits beside it
   * (`integration/testing-module-override`). In each case the walk stopped at
   * the program root and never reached the repository config that does claim
   * the file, so the same file resolved NODE16 under the root program and
   * NODE10 under the nested one.
   *
   * So the governing config must be a PURE FUNCTION OF THE FILE, which is what
   * the unbounded walk gives. `fileNames.has()` is what keeps it safe: a config
   * above the analysed tree has to name the file explicitly to win, and one
   * that does is the answer tsc would give too.
   */
  resolve(absoluteFilePath: string): GoverningTsConfig {
    const normalised = path.normalize(absoluteFilePath);
    const cached = this.governing.get(normalised);
    if (cached) {
      return cached;
    }

    let found: GoverningTsConfig | undefined;
    let dir = path.dirname(normalised);
    for (;;) {
      const configPath = path.join(dir, 'tsconfig.json');
      if (fs.existsSync(configPath)) {
        const config = this.parseConfig(configPath);
        if (config && config.fileNames.has(normalised)) {
          found = config;
          break;
        }
        // A solution-style config (`files: [], references: [...]`) claims nothing
        // itself; the program that claims the file is one it references, possibly
        // under a name the walk never looks for (`tsconfig.build.json`). Without
        // this a repository whose root delegates to references lost every file the
        // references claim, silently (#660).
        const viaReference = config ? this.referencedConfigClaiming(config, normalised, new Set()) : undefined;
        if (viaReference) {
          found = viaReference;
          break;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }

    const result: GoverningTsConfig = found ?? {
      configPath: '',
      options: DEFAULT_OPTIONS,
      moduleResolutionMode: TsModuleResolutionMode.NODE10,
      decoratorSystem: TsDecoratorSystem.STANDARD_TC39,
      fileNames: new Set<string>(),
      references: [],
    };
    this.governing.set(normalised, result);
    return result;
  }

  /** The config `config` references (transitively) that claims `file`, if any. */
  private referencedConfigClaiming(
    config: GoverningTsConfig,
    file: string,
    visited: Set<string>
  ): GoverningTsConfig | undefined {
    for (const referenced of config.references) {
      if (visited.has(referenced)) {
        continue;
      }
      visited.add(referenced);
      const parsed = this.parseConfig(referenced);
      if (!parsed) {
        continue;
      }
      if (parsed.fileNames.has(file)) {
        return parsed;
      }
      const deeper = this.referencedConfigClaiming(parsed, file, visited);
      if (deeper) {
        return deeper;
      }
    }
    return undefined;
  }

  /** A parsed config by absolute path, for a caller that already knows the path (a reference). */
  configAt(configPath: string): GoverningTsConfig | undefined {
    return this.parseConfig(configPath);
  }

  /** Every tsconfig under a root, sorted, for the analyzer's per-program grouping. */
  findConfigs(rootDir: string, skipDirectories: ReadonlySet<string>): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      if (entries.some((e) => e.isFile() && e.name === 'tsconfig.json')) {
        out.push(path.join(dir, 'tsconfig.json'));
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && !skipDirectories.has(entry.name)) {
          walk(path.join(dir, entry.name));
        }
      }
    };
    walk(rootDir);
    return out.sort();
  }

  private parseConfig(configPathIn: string): GoverningTsConfig | undefined {
    // Absolute, always. `parseJsonConfigFileContent` joins its base path onto
    // `extends` and onto every `include` glob, so a relative base silently
    // produces an EMPTY file list and the config appears to claim nothing —
    // which reads exactly like "this config does not govern the file".
    const configPath = path.resolve(configPathIn);
    if (this.parsed.has(configPath)) {
      return this.parsed.get(configPath);
    }
    let result: GoverningTsConfig | undefined;
    const read = ts.readConfigFile(configPath, (p) => {
      try {
        return fs.readFileSync(p, 'utf-8');
      } catch {
        return undefined;
      }
    });
    if (!read.error && read.config) {
      // parseJsonConfigFileContent follows `extends`, applies include/exclude
      // and produces the exact file list tsc would compile. Reimplementing that
      // by hand is where a "governing config" usually goes wrong.
      const parsed = ts.parseJsonConfigFileContent(
        read.config,
        ts.sys,
        path.dirname(configPath),
        undefined,
        configPath
      );
      result = {
        configPath,
        options: parsed.options,
        moduleResolutionMode: mapResolutionMode(parsed.options),
        decoratorSystem:
          parsed.options.experimentalDecorators === true
            ? TsDecoratorSystem.LEGACY_EXPERIMENTAL
            : TsDecoratorSystem.STANDARD_TC39,
        fileNames: new Set(parsed.fileNames.map((f) => path.normalize(f))),
        // `path` may name a directory (its tsconfig.json) or a config file by name;
        // resolveProjectReferencePath is the compiler's own reading of it.
        references: (parsed.projectReferences ?? [])
          .map((ref) => path.resolve(ts.resolveProjectReferencePath(ref))),
      };
    }
    this.parsed.set(configPath, result);
    return result;
  }
}

/**
 * `ts.ModuleResolutionKind` to the schema's token.
 *
 * `Bundler`, `Node16` and `NodeNext` are kept apart because they genuinely
 * resolve differently — `./a.js` means different things under each — and
 * `ts_import.resolutionKind` is only interpretable next to this column.
 */
function mapResolutionMode(options: ts.CompilerOptions): TsModuleResolutionMode {
  switch (options.moduleResolution) {
    case ts.ModuleResolutionKind.Node16: {
      return TsModuleResolutionMode.NODE16;
    }
    case ts.ModuleResolutionKind.NodeNext: {
      return TsModuleResolutionMode.NODENEXT;
    }
    case ts.ModuleResolutionKind.Bundler: {
      return TsModuleResolutionMode.BUNDLER;
    }
    case ts.ModuleResolutionKind.Classic: {
      return TsModuleResolutionMode.CLASSIC;
    }
    default: {
      return TsModuleResolutionMode.NODE10;
    }
  }
}
