import * as path from 'path';

import * as ts from 'typescript';

import { TsModuleRegistry } from '@/analysis-types/typescript/TsModuleRegistry';
import { TS_EMISSION_REGIME, TS_TARGET_VERSION } from '@/constants/typescript-constants';
import {
  TsEmissionRegime,
  TsModuleKind,
  TsModuleResolutionMode,
  TsScriptKind,
  TS_MERGE_SCOPE,
} from '@/enums/typescript/modules';
import { nodeId } from '@/parsers/typescript/extractors/ts-binder';

/**
 * Mints the `ts_module` rows for one file — schema §4.1.
 *
 * A file is one row, and so is every `declare module "x" { … }` and every
 * `declare global { … }` inside it. That is not decoration: an ambient module
 * declaration is an independently importable namespace AND a merge scope of its
 * own, and one file may hold many — 173 measured — which is why
 * `declaredSpecifier` and `startLine` are both in the primary key.
 *
 * The file's own row is minted first and its hash is the root of every FK chain
 * in the file, so it must be computable from the path alone. It is: the key is
 * `filePath ‖ baseMservPath ‖ declaredSpecifier ‖ startLine ‖ emissionRegime ‖
 * serviceVersionLinkHash` and nothing in it depends on having parsed anything.
 * That property is what lets a module augmentation in file B key its
 * declarations under file A's module hash without file A having been read yet.
 */
export interface ModuleExtractionInput {
  readonly sourceFile: ts.SourceFile;
  readonly filePath: string;
  readonly baseMservPath: string;
  readonly moduleQualifiedName: string;
  readonly tsConfigPath: string;
  readonly moduleResolutionMode: TsModuleResolutionMode;
  readonly serviceVersionLinkHash: string;
  readonly packageName: string;
}

export interface ModuleExtractionResult {
  readonly fileModule: TsModuleRegistry;
  /** Ambient-module and global-augmentation rows, in source order. */
  readonly nestedModules: readonly TsModuleRegistry[];
  /** Module hash for any node, so a `declare module` body's FKs point at the right row. */
  readonly moduleHashForNode: (node: ts.Node) => string;
  /** `declare module "x"` specifier -> that row's hash, for the binder. */
  readonly ambientModuleHashes: ReadonlyMap<string, string>;
}

export function extractModules(input: ModuleExtractionInput): ModuleExtractionResult {
  const sf = input.sourceFile;
  const isDeclarationFile = sf.isDeclarationFile;
  // `ts.isExternalModule` is the compiler's own answer to the question that
  // decides module scope versus GLOBAL scope, and therefore which merge table
  // every top-level declaration in this file lands in. Guessing it from the
  // presence of the word `import` would be wrong for `export {}` and for
  // `import type` under `isolatedModules`.
  const isExternalModule = ts.isExternalModule(sf);
  const endPos = sf.getLineAndCharacterOfPosition(sf.end);

  const fileModule = new TsModuleRegistry({
    name: moduleStemOf(input.filePath),
    qualifiedName: input.moduleQualifiedName,
    fileName: path.basename(input.filePath),
    filePath: input.filePath,
    baseMservPath: input.baseMservPath,
    moduleKind: isDeclarationFile
      ? TsModuleKind.DECLARATION_FILE
      : isExternalModule
        ? TsModuleKind.SOURCE_MODULE
        : TsModuleKind.SCRIPT_GLOBAL,
    scriptKind: scriptKindOf(input.filePath, isDeclarationFile),
    declaredSpecifier: '',
    isDeclarationFile,
    isExternalModule,
    isAmbient: isDeclarationFile || allTopLevelDeclare(sf),
    packageName: input.packageName,
    // The scope-key prefix this module MINTS. A module file mints
    // MODULE_EXPORTS; a global script contributes to GLOBAL and mints nothing
    // of its own, which is exactly why two scripts' declarations merge.
    mergeTableKey: isExternalModule
      ? `${TS_MERGE_SCOPE.MODULE_EXPORTS}:${''}`
      : TS_MERGE_SCOPE.GLOBAL,
    moduleResolutionMode: input.moduleResolutionMode,
    tsConfigPath: input.tsConfigPath,
    targetTsVersion: TS_TARGET_VERSION,
    emissionRegime: TS_EMISSION_REGIME as TsEmissionRegime,
    startLine: 1,
    endLine: endPos.line + 1,
    hasTopLevelAwait: hasTopLevelAwait(sf),
    hasJsxContent: false,
    serviceVersionLinkHash: input.serviceVersionLinkHash,
  });

  // The mergeTableKey needs the module's own hash, which needs the row. Rebuild
  // it once the hash exists rather than leaving a self-reference dangling: the
  // key is not part of the PK, so the second construction is identical in every
  // column that identifies the row.
  const fileModuleFinal = new TsModuleRegistry({
    name: fileModule.name,
    qualifiedName: fileModule.qualifiedName,
    fileName: fileModule.fileName,
    filePath: fileModule.filePath,
    baseMservPath: fileModule.baseMservPath,
    moduleKind: fileModule.moduleKind,
    scriptKind: fileModule.scriptKind,
    declaredSpecifier: fileModule.declaredSpecifier,
    isDeclarationFile: fileModule.isDeclarationFile,
    isExternalModule: fileModule.isExternalModule,
    isAmbient: fileModule.isAmbient,
    packageName: fileModule.packageName,
    mergeTableKey: isExternalModule
      ? `${TS_MERGE_SCOPE.MODULE_EXPORTS}:${fileModule.getHash()}`
      : TS_MERGE_SCOPE.GLOBAL,
    moduleResolutionMode: fileModule.moduleResolutionMode,
    tsConfigPath: fileModule.tsConfigPath,
    targetTsVersion: fileModule.targetTsVersion,
    emissionRegime: fileModule.emissionRegime,
    startLine: fileModule.startLine,
    endLine: fileModule.endLine,
    hasTopLevelAwait: fileModule.hasTopLevelAwait,
    hasJsxContent: fileModule.hasJsxContent,
    serviceVersionLinkHash: fileModule.serviceVersionLinkHash,
  });

  const nestedModules: TsModuleRegistry[] = [];
  const byNode = new Map<string, string>();
  const ambientModuleHashes = new Map<string, string>();

  const visit = (node: ts.Node): void => {
    if (ts.isModuleDeclaration(node)) {
      const isAmbientModule = ts.isStringLiteral(node.name);
      const isGlobalAugmentation = (node.flags & ts.NodeFlags.GlobalAugmentation) !== 0;
      if (isAmbientModule || isGlobalAugmentation) {
        const specifier = isAmbientModule ? (node.name as ts.StringLiteral).text : '';
        const startPos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const nestedEnd = sf.getLineAndCharacterOfPosition(node.end);
        const row = new TsModuleRegistry({
          name: isAmbientModule ? `"${specifier}"` : 'global',
          qualifiedName: isAmbientModule ? specifier : 'global',
          fileName: fileModuleFinal.fileName,
          filePath: input.filePath,
          baseMservPath: input.baseMservPath,
          moduleKind: isGlobalAugmentation
            ? TsModuleKind.GLOBAL_AUGMENTATION
            // A relative specifier reopens an EXISTING module; a bare one
            // declares a new ambient namespace. Different rows because they are
            // different facts: one merges into a module in this analysis, the
            // other names something outside it.
            : specifier.startsWith('.')
              ? TsModuleKind.MODULE_AUGMENTATION
              : TsModuleKind.AMBIENT_MODULE_DECLARATION,
          scriptKind: fileModuleFinal.scriptKind,
          declaredSpecifier: specifier,
          isDeclarationFile,
          isExternalModule: false,
          isAmbient: true,
          packageName: input.packageName,
          mergeTableKey: isGlobalAugmentation ? TS_MERGE_SCOPE.GLOBAL : '',
          moduleResolutionMode: input.moduleResolutionMode,
          tsConfigPath: input.tsConfigPath,
          targetTsVersion: TS_TARGET_VERSION,
          emissionRegime: TS_EMISSION_REGIME as TsEmissionRegime,
          startLine: startPos.line + 1,
          endLine: nestedEnd.line + 1,
          hasTopLevelAwait: false,
          hasJsxContent: false,
          serviceVersionLinkHash: input.serviceVersionLinkHash,
        });
        nestedModules.push(row);
        byNode.set(nodeId(node, sf), row.getHash());
        if (isAmbientModule) {
          ambientModuleHashes.set(specifier, row.getHash());
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);

  return {
    fileModule: fileModuleFinal,
    nestedModules,
    moduleHashForNode: (node) => byNode.get(nodeId(node, sf)) ?? fileModuleFinal.getHash(),
    ambientModuleHashes,
  };
}

/**
 * The `ts_module` PK, computable from the path ALONE.
 *
 * Exposed because a module augmentation in file B must key its declarations
 * under file A's module hash, and file A may not have been parsed yet. If this
 * needed anything from the parsed file, cross-file merging would need a
 * dependency-ordered traversal that a file list cannot provide.
 */
export function moduleHashFor(
  filePath: string,
  baseMservPath: string,
  serviceVersionLinkHash: string
): string {
  return new TsModuleRegistry({
    name: moduleStemOf(filePath),
    qualifiedName: filePath,
    fileName: path.basename(filePath),
    filePath,
    baseMservPath,
    moduleKind: TsModuleKind.SOURCE_MODULE,
    scriptKind: TsScriptKind.TS,
    declaredSpecifier: '',
    isDeclarationFile: false,
    isExternalModule: true,
    isAmbient: false,
    packageName: '',
    mergeTableKey: '',
    moduleResolutionMode: TsModuleResolutionMode.NODE10,
    tsConfigPath: '',
    targetTsVersion: TS_TARGET_VERSION,
    emissionRegime: TS_EMISSION_REGIME as TsEmissionRegime,
    startLine: 1,
    endLine: 1,
    hasTopLevelAwait: false,
    hasJsxContent: false,
    serviceVersionLinkHash,
  }).getHash();
}

/** `views` for `app/web/views.ts`, and `views` for `app/web/views.d.ts`. */
export function moduleStemOf(filePath: string): string {
  return path.basename(filePath).replace(/\.(d\.ts|tsx?|mts|cts|json)$/, '');
}

function scriptKindOf(filePath: string, isDeclarationFile: boolean): TsScriptKind {
  if (filePath.endsWith('.tsx')) {
    return TsScriptKind.TSX;
  }
  if (filePath.endsWith('.mts')) {
    return TsScriptKind.MTS;
  }
  if (filePath.endsWith('.cts')) {
    return TsScriptKind.CTS;
  }
  if (filePath.endsWith('.json')) {
    return TsScriptKind.JSON;
  }
  return isDeclarationFile ? TsScriptKind.DTS : TsScriptKind.TS;
}

/** Every top-level statement carries `declare`, so the file contributes no runtime code. */
function allTopLevelDeclare(sf: ts.SourceFile): boolean {
  let sawDeclarable = false;
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
      || ts.isImportEqualsDeclaration(statement)) {
      continue;
    }
    sawDeclarable = true;
    const modifiers = (statement as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers;
    const declared = modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) === true;
    if (!declared) {
      return false;
    }
  }
  return sawDeclarable;
}

/** A top-level `await` forces module semantics regardless of imports. */
function hasTopLevelAwait(sf: ts.SourceFile): boolean {
  let found = false;
  const walk = (node: ts.Node): void => {
    if (found) {
      return;
    }
    if (ts.isAwaitExpression(node)) {
      found = true;
      return;
    }
    // A nested function has its own await context, so an await inside one is
    // not a top-level await.
    if (ts.isFunctionLike(node) || ts.isClassLike(node) || ts.isModuleDeclaration(node)) {
      return;
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sf, walk);
  return found;
}
