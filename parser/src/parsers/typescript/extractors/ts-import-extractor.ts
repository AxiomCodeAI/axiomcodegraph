import * as path from 'path';

import * as ts from 'typescript';

import { TsImportRegistry } from '@/analysis-types/typescript/TsImportRegistry';
import { TsImportKind, TsImportResolutionKind } from '@/enums/typescript/imports';
import { nodeId } from '@/parsers/typescript/extractors/ts-binder';

/**
 * Emits `ts_import` rows — schema §4.12.
 *
 * **One declaration with N named specifiers emits N ROWS.** `import { a, type B }`
 * is one declaration and two facts with different runtime existence, so a
 * per-declaration row would have to pick one answer for `isTypeOnly` and be
 * wrong about the other. 45.6% of ecosystem imports are type-only and 34 use the
 * inline `{ type X }` form, so this is the common case, not an edge one.
 *
 * ## Resolution happens here, and it is parser-legal
 *
 * `ts.resolveModuleName` needs **no `ts.Program`**: it is a pure function of a
 * specifier, compiler options and a host, and it returns `undefined` for an
 * unresolvable specifier rather than guessing. Verified on 6.0.3, `"./a.js"`
 * resolves to `a.ts` with extension `.ts` — which is why `resolvedFilePath` is a
 * tier-2 column rather than engine work.
 *
 * It matters beyond imports. §3.1's merge key for a module augmentation is
 * keyed on the RESOLVED target module, so without this the `Request` interface
 * in `augmented-base.ts` and the one inside `declare module "./augmented-base"`
 * would be two symbols instead of one.
 */
export interface ImportExtractorOptions {
  readonly sourceFile: ts.SourceFile;
  readonly filePath: string;
  readonly absoluteFilePath: string;
  readonly tsModuleLinkHash: string;
  readonly compilerOptions: ts.CompilerOptions;
  readonly serviceVersionLinkHash: string;
  /** Absolute resolved path -> `ts_module` hash, for project-internal targets. */
  readonly projectModuleHashes: ReadonlyMap<string, string>;
  readonly toProjectRelative: (absolutePath: string) => string;
}

export interface ImportExtractionResult {
  readonly imports: readonly TsImportRegistry[];
  /** Bound local name -> the row that binds it, for reference resolution. */
  readonly importByLocalName: ReadonlyMap<string, TsImportRegistry>;
  /** Bound local name -> the resolved absolute file, when it resolved at all. */
  readonly resolvedTargetByLocalName: ReadonlyMap<string, string>;
  readonly importRowByNode: ReadonlyMap<string, TsImportRegistry>;
}

export class TsImportExtractor {
  private readonly imports: TsImportRegistry[] = [];
  private readonly importByLocalName = new Map<string, TsImportRegistry>();
  private readonly resolvedTargetByLocalName = new Map<string, string>();
  private readonly importRowByNode = new Map<string, TsImportRegistry>();
  /** One resolution per specifier per file; the same specifier repeats often. */
  private readonly resolutionCache = new Map<string, ResolvedSpecifier>();

  constructor(private readonly options: ImportExtractorOptions) {}

  run(): ImportExtractionResult {
    const sf = this.options.sourceFile;
    for (const statement of sf.statements) {
      if (ts.isImportDeclaration(statement)) {
        this.emitImportDeclaration(statement);
        continue;
      }
      if (ts.isImportEqualsDeclaration(statement)) {
        this.emitImportEquals(statement);
        continue;
      }
    }
    this.emitTripleSlashReferences();
    this.emitDynamicImports();
    return {
      imports: this.imports,
      importByLocalName: this.importByLocalName,
      resolvedTargetByLocalName: this.resolvedTargetByLocalName,
      importRowByNode: this.importRowByNode,
    };
  }

  /**
   * `import("./x")` and `require("./x")` anywhere in the file.
   *
   * Real module edges that no top-level statement declares, so a pass that only
   * walks statements misses them entirely — and with them the only record that
   * the target file is reachable. `ts_import` has enum values and an expression
   * FK for exactly this (`DYNAMIC_IMPORT`, `REQUIRE_CALL`, c22), because a lazy
   * route is still a route.
   */
  private emitDynamicImports(): void {
    const sf = this.options.sourceFile;
    let index = 0;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
        const first = node.arguments[0];
        if ((isDynamicImport || isRequire) && first && ts.isStringLiteral(first)) {
          this.emit(node, node, first.text,
            isDynamicImport ? TsImportKind.DYNAMIC_IMPORT : TsImportKind.REQUIRE_CALL,
            '', '', '', {
              isTypeOnly: false,
              isWildcard: false,
              isDefaultImport: false,
              isSideEffectOnly: false,
              // Its own index space: a dynamic import shares no clause with the
              // static imports, and the PK includes the clause index.
              clauseIndex: 1000 + index,
            });
          index += 1;
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
  }

  private emitImportDeclaration(node: ts.ImportDeclaration): void {
    if (!ts.isStringLiteral(node.moduleSpecifier)) {
      return;
    }
    const specifier = node.moduleSpecifier.text;
    const declarationIsTypeOnly = node.importClause?.isTypeOnly === true;
    const clause = node.importClause;

    if (!clause) {
      // `import "./polyfill"` — no binding, but a real module edge, and the
      // only reason the target file is in the program at all.
      this.emit(node, node, specifier, TsImportKind.SIDE_EFFECT, '', '', '', {
        isTypeOnly: false,
        isWildcard: false,
        isDefaultImport: false,
        isSideEffectOnly: true,
        clauseIndex: 0,
      });
      return;
    }

    let clauseIndex = 0;
    if (clause.name) {
      this.emit(node, clause, specifier,
        declarationIsTypeOnly ? TsImportKind.TYPE_ONLY_DEFAULT : TsImportKind.DEFAULT,
        clause.name.text, 'default', '', {
          isTypeOnly: declarationIsTypeOnly,
          isWildcard: false,
          isDefaultImport: true,
          isSideEffectOnly: false,
          clauseIndex,
        });
      clauseIndex += 1;
    }

    const bindings = clause.namedBindings;
    if (!bindings) {
      return;
    }
    if (ts.isNamespaceImport(bindings)) {
      // Java's `isOnDemand` slot. The projection stays `import_wildcard` in both
      // languages even though the enum value differs (§2).
      this.emit(node, bindings, specifier,
        declarationIsTypeOnly ? TsImportKind.TYPE_ONLY_NAMESPACE : TsImportKind.NAMESPACE,
        bindings.name.text, '', '', {
          isTypeOnly: declarationIsTypeOnly,
          isWildcard: true,
          isDefaultImport: false,
          isSideEffectOnly: false,
          clauseIndex,
        });
      return;
    }
    for (const element of bindings.elements) {
      const originalName = element.propertyName?.text ?? element.name.text;
      const isAliased = element.propertyName !== undefined;
      // Specifier-level type-only. `import { a, type B }` means these two rows
      // differ in whether they have runtime existence at all, which is why the
      // relation is per bound name rather than per declaration.
      const specifierIsTypeOnly = element.isTypeOnly === true;
      const kind = declarationIsTypeOnly
        ? TsImportKind.TYPE_ONLY_NAMED
        : specifierIsTypeOnly
          ? TsImportKind.INLINE_TYPE_SPECIFIER
          : isAliased
            ? TsImportKind.NAMED_ALIAS
            : TsImportKind.NAMED;
      this.emit(node, element, specifier, kind, element.name.text, originalName,
        isAliased ? element.name.text : '', {
          isTypeOnly: declarationIsTypeOnly || specifierIsTypeOnly,
          isWildcard: false,
          isDefaultImport: false,
          isSideEffectOnly: false,
          clauseIndex,
        });
      clauseIndex += 1;
    }
  }

  private emitImportEquals(node: ts.ImportEqualsDeclaration): void {
    const reference = node.moduleReference;
    if (ts.isExternalModuleReference(reference)) {
      const specifier = ts.isStringLiteral(reference.expression) ? reference.expression.text : '';
      this.emit(node, node, specifier, TsImportKind.IMPORT_EQUALS_REQUIRE, node.name.text, '', '', {
        isTypeOnly: node.isTypeOnly,
        isWildcard: false,
        isDefaultImport: false,
        isSideEffectOnly: false,
        clauseIndex: 0,
      });
      return;
    }
    // `import x = a.b.C` — an ENTITY alias, not a module edge. The specifier
    // column carries the dotted entity path because there is no module to name.
    this.emit(node, node, reference.getText(this.options.sourceFile),
      TsImportKind.IMPORT_EQUALS_ENTITY, node.name.text, '', '', {
        isTypeOnly: node.isTypeOnly,
        isWildcard: false,
        isDefaultImport: false,
        isSideEffectOnly: false,
        clauseIndex: 0,
      });
  }

  /**
   * `/// <reference path="..." />` and `/// <reference types="..." />`.
   *
   * Real module edges that carry no `import` statement, so a fact base built
   * only from import declarations loses them — and in ambient code they are
   * often the only edge there is.
   */
  private emitTripleSlashReferences(): void {
    const sf = this.options.sourceFile;
    for (const reference of sf.referencedFiles) {
      this.emitReference(reference.fileName, reference.pos);
    }
    for (const reference of sf.typeReferenceDirectives) {
      this.emitReference(reference.fileName, reference.pos);
    }
  }

  private emitReference(specifier: string, pos: number): void {
    const sf = this.options.sourceFile;
    const startPos = sf.getLineAndCharacterOfPosition(pos);
    const resolved = this.resolveSpecifier(specifier);
    const row = new TsImportRegistry({
      importKind: TsImportKind.TRIPLE_SLASH_REFERENCE,
      importedPath: specifier,
      moduleOrEntityName: specifier,
      simpleName: '',
      filePath: this.options.filePath,
      lineNumber: startPos.line + 1,
      isTypeOnly: true,
      isWildcard: false,
      originalName: '',
      aliasName: '',
      isDefaultImport: false,
      isSideEffectOnly: true,
      tsModuleLinkHash: this.options.tsModuleLinkHash,
      resolvedFilePath: resolved.relativePath,
      resolutionKind: resolved.kind,
      resolvedExtension: resolved.extension,
      isExternalTarget: resolved.moduleHash === '',
      packageName: resolved.packageName,
      specifierHasExtension: /\.[a-z]+$/i.test(specifier),
      importClauseIndex: 0,
      startColumn: startPos.character + 1,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    if (resolved.moduleHash !== '') {
      row.setResolvedModuleLinkHash(resolved.moduleHash);
    }
    this.imports.push(row);
  }

  private emit(
    declaration: ts.Node,
    bindingNode: ts.Node,
    specifier: string,
    kind: TsImportKind,
    simpleName: string,
    originalName: string,
    aliasName: string,
    flags: {
      isTypeOnly: boolean;
      isWildcard: boolean;
      isDefaultImport: boolean;
      isSideEffectOnly: boolean;
      clauseIndex: number;
    }
  ): void {
    const sf = this.options.sourceFile;
    const startPos = sf.getLineAndCharacterOfPosition(declaration.getStart(sf));
    const isEntityAlias = kind === TsImportKind.IMPORT_EQUALS_ENTITY;
    const resolved = isEntityAlias ? UNRESOLVED : this.resolveSpecifier(specifier);
    const row = new TsImportRegistry({
      importKind: kind,
      importedPath: specifier,
      moduleOrEntityName: specifier,
      simpleName,
      filePath: this.options.filePath,
      lineNumber: startPos.line + 1,
      isTypeOnly: flags.isTypeOnly,
      isWildcard: flags.isWildcard,
      originalName,
      aliasName,
      isDefaultImport: flags.isDefaultImport,
      isSideEffectOnly: flags.isSideEffectOnly,
      tsModuleLinkHash: this.options.tsModuleLinkHash,
      resolvedFilePath: resolved.relativePath,
      resolutionKind: resolved.kind,
      resolvedExtension: resolved.extension,
      // An HONEST negative about this analysis, not a claim about the outside
      // world: the specifier did not resolve to a `ts_module` row here, which
      // is precisely the set the engine closes from `lib_ts_*`.
      isExternalTarget: resolved.moduleHash === '',
      packageName: resolved.packageName,
      specifierHasExtension: /\.[a-z]+$/i.test(specifier),
      importClauseIndex: flags.clauseIndex,
      startColumn: startPos.character + 1,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    if (resolved.moduleHash !== '') {
      row.setResolvedModuleLinkHash(resolved.moduleHash);
    }
    this.imports.push(row);
    this.importRowByNode.set(nodeId(bindingNode, sf), row);
    if (simpleName !== '') {
      this.importByLocalName.set(simpleName, row);
      if (resolved.absolutePath !== '') {
        this.resolvedTargetByLocalName.set(simpleName, resolved.absolutePath);
      }
    }
  }

  private resolveSpecifier(specifier: string): ResolvedSpecifier {
    const cached = this.resolutionCache.get(specifier);
    if (cached) {
      return cached;
    }
    const result = this.doResolve(specifier);
    this.resolutionCache.set(specifier, result);
    return result;
  }

  private doResolve(specifier: string): ResolvedSpecifier {
    // A Node builtin, with or without the `node:` prefix. Both forms must be
    // classified, and the unprefixed form is the common one: `import * as path
    // from "path"` accounts for 241 of the 259 incomplete hand-offs measured on
    // this repository's own source. Without the classification the engine sees
    // an empty `resolvedFilePath` and cannot tell a Node builtin from a project
    // import that failed to resolve — which are different facts needing
    // different treatment, and only one of them is a problem.
    if (specifier.startsWith('node:') || NODE_BUILTIN_SPECIFIERS.has(specifier)) {
      return { ...UNRESOLVED, kind: TsImportResolutionKind.BUILTIN_NODE };
    }
    const resolved = ts.resolveModuleName(
      specifier,
      this.options.absoluteFilePath,
      this.options.compilerOptions,
      ts.sys
    );
    const module = resolved.resolvedModule;
    if (!module) {
      // `undefined` is an honest answer, not a failure to try. It is also the
      // right answer for a wildcard ambient specifier like `"*.svg"`, which
      // names no file anywhere.
      return UNRESOLVED;
    }
    const absolute = path.normalize(module.resolvedFileName);
    const moduleHash = this.options.projectModuleHashes.get(absolute) ?? '';
    const isNodeModules = absolute.includes(`${path.sep}node_modules${path.sep}`);
    return {
      absolutePath: absolute,
      relativePath: this.options.toProjectRelative(absolute),
      moduleHash,
      kind: isNodeModules
        ? (module.extension === ts.Extension.Dts
          ? TsImportResolutionKind.NODE_MODULES_TYPES
          : TsImportResolutionKind.NODE_MODULES_SOURCE)
        : specifier.startsWith('.')
          ? TsImportResolutionKind.RELATIVE_FILE
          : TsImportResolutionKind.PATHS_ALIAS,
      extension: module.extension,
      packageName: module.packageId?.name ?? '',
    };
  }
}

interface ResolvedSpecifier {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly moduleHash: string;
  readonly kind: TsImportResolutionKind;
  readonly extension: string;
  readonly packageName: string;
}

/**
 * Node's builtin module specifiers, unprefixed.
 *
 * Enumerated rather than pattern-matched because there is no pattern: `path` is
 * a builtin and `pathe` is a package, and guessing from the absence of a slash
 * or a dot would misclassify every bare package name in the ecosystem.
 */
const NODE_BUILTIN_SPECIFIERS = new Set([
  'assert', 'assert/strict', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'dns/promises', 'domain',
  'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector', 'inspector/promises',
  'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks', 'process',
  'punycode', 'querystring', 'readline', 'readline/promises', 'repl', 'stream',
  'stream/consumers', 'stream/promises', 'stream/web', 'string_decoder', 'timers',
  'timers/promises', 'tls', 'trace_events', 'tty', 'url', 'util', 'util/types', 'v8', 'vm',
  'wasi', 'worker_threads', 'zlib',
]);

const UNRESOLVED: ResolvedSpecifier = {
  absolutePath: '',
  relativePath: '',
  moduleHash: '',
  kind: TsImportResolutionKind.UNRESOLVED,
  extension: '',
  packageName: '',
};
