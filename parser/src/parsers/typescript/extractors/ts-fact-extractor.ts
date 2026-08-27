import * as path from 'path';

import * as ts from 'typescript';

import { TsBlockRegistry } from '@/analysis-types/typescript/TsBlockRegistry';
import { TsCallSiteRegistry } from '@/analysis-types/typescript/TsCallSiteRegistry';
import { TsExpressionRegistry } from '@/analysis-types/typescript/TsExpressionRegistry';
import { TsFieldRegistry } from '@/analysis-types/typescript/TsFieldRegistry';
import { TsImportRegistry } from '@/analysis-types/typescript/TsImportRegistry';
import { TsMethodParameterRegistry } from '@/analysis-types/typescript/TsMethodParameterRegistry';
import { TsMethodRegistry } from '@/analysis-types/typescript/TsMethodRegistry';
import { TsModuleRegistry } from '@/analysis-types/typescript/TsModuleRegistry';
import { TsTypeHeritageRegistry } from '@/analysis-types/typescript/TsTypeHeritageRegistry';
import { TsTypeReferenceRegistry } from '@/analysis-types/typescript/TsTypeReferenceRegistry';
import { TsTypeRegistry } from '@/analysis-types/typescript/TsTypeRegistry';
import { TsVariableRegistry } from '@/analysis-types/typescript/TsVariableRegistry';
import { TsDecoratorArgumentRegistry } from
  '@/analysis-types/typescript/TsDecoratorArgumentRegistry';
import { TsDecoratorRegistry } from '@/analysis-types/typescript/TsDecoratorRegistry';
import { TsDecoratorSystem } from '@/enums/typescript/decorators';
import { TsModuleResolutionMode } from '@/enums/typescript/modules';
import { bindSourceFile, BinderResult } from '@/parsers/typescript/extractors/ts-binder';
import { TsDeclarationExtractor } from
  '@/parsers/typescript/extractors/ts-declaration-extractor';
import { extractDecorators } from '@/parsers/typescript/extractors/ts-decorator-extractor';
import { TsExpressionExtractor } from
  '@/parsers/typescript/extractors/ts-expression-extractor';
import { TsExpressionWalker } from '@/parsers/typescript/extractors/ts-expression-walker';
import { TsImportExtractor } from '@/parsers/typescript/extractors/ts-import-extractor';
import { extractModules } from '@/parsers/typescript/extractors/ts-module-extractor';
import {
  DeferredCall,
  ResolutionStats,
  TsLocalResolver,
} from '@/parsers/typescript/extractors/ts-resolution-linker';

/**
 * Extracts the whole fact spine for ONE TypeScript file.
 *
 * ## The order is a dependency order, not a preference
 *
 * 1. **Modules.** The file's `ts_module` hash is the root of every FK chain, and
 *    it is computable from the path alone — which is what lets step 2 key a
 *    module augmentation under a file that has not been parsed.
 * 2. **Binder.** Scopes, symbol tables and merge-scope keys. Nothing downstream
 *    is trustworthy until §3.1's partition is right, which is why the
 *    merge-partition gate is the first check that runs against output.
 * 3. **Imports.** `ts.resolveModuleName` runs here, and the binder already used
 *    its answer for augmentations.
 * 4. **Declarations.** Types, methods, parameters, fields, variables, heritage,
 *    blocks and the type-reference tree.
 * 5. **Expressions and call sites.** Last, because they reference everything
 *    above by hash and re-deriving any of those keys would collide.
 * 6. **Local resolution.** Only what syntax decides; the rest is deferred to the
 *    project pass or left honestly empty.
 *
 * No `ts.Program` is created at any step. `ts.createSourceFile` is text to AST
 * and `ts.resolveModuleName` is a pure function of a specifier and options —
 * both verified to work with no `node_modules` resolved and no typecheck.
 */
export interface TsFileExtractionOptions {
  readonly absoluteFilePath: string;
  readonly filePath: string;
  readonly baseMservPath: string;
  readonly moduleQualifiedName: string;
  readonly sourceText: string;
  readonly serviceVersionLinkHash: string;
  readonly tsConfigPath: string;
  readonly moduleResolutionMode: TsModuleResolutionMode;
  /**
   * From the tsconfig that GOVERNS this file — never a run-wide constant.
   *
   * Two files three directories apart can legitimately compile under different
   * decorator systems, and the source is identical either way. See
   * `ts-decorator-extractor.ts`.
   */
  readonly decoratorSystem: TsDecoratorSystem;
  readonly compilerOptions: ts.CompilerOptions;
  readonly packageName: string;
  /** Absolute path -> `ts_module` hash for every file in the analysis. */
  readonly projectModuleHashes: ReadonlyMap<string, string>;
  /** Absolute path -> project-relative path, extension stripped. */
  readonly toProjectRelative: (absolutePath: string) => string;
}

export interface TsFileFacts {
  readonly modules: readonly TsModuleRegistry[];
  readonly types: readonly TsTypeRegistry[];
  readonly methods: readonly TsMethodRegistry[];
  readonly methodParameters: readonly TsMethodParameterRegistry[];
  readonly fields: readonly TsFieldRegistry[];
  readonly variables: readonly TsVariableRegistry[];
  readonly heritages: readonly TsTypeHeritageRegistry[];
  readonly typeReferences: readonly TsTypeReferenceRegistry[];
  readonly imports: readonly TsImportRegistry[];
  readonly expressions: readonly TsExpressionRegistry[];
  readonly callSites: readonly TsCallSiteRegistry[];
  readonly blocks: readonly TsBlockRegistry[];
  readonly decorators: readonly TsDecoratorRegistry[];
  readonly decoratorArguments: readonly TsDecoratorArgumentRegistry[];
  /** Calls whose target is in another module; finished by the project pass. */
  readonly deferredCalls: readonly DeferredCall[];
  /** Local name -> the row that binds it, for the project pass. */
  readonly importByLocalName: ReadonlyMap<string, TsImportRegistry>;
  readonly resolvedTargetByLocalName: ReadonlyMap<string, string>;
  readonly stats: ResolutionStats;
  readonly binder: BinderResult;
  readonly sourceFile: ts.SourceFile;
  readonly fileModuleHash: string;
}

export function extractTypeScriptFile(options: TsFileExtractionOptions): TsFileFacts {
  // `ts.createSourceFile` with `setParentNodes = true`. The parent pointers are
  // not a convenience: owner derivation and scope lookup both walk ANCESTORS,
  // and the alternative — comparing positions — picks the wrong scope whenever
  // two of them begin at the same offset.
  const sourceFile = ts.createSourceFile(
    options.absoluteFilePath,
    options.sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(options.absoluteFilePath)
  );

  const modules = extractModules({
    sourceFile,
    filePath: options.filePath,
    baseMservPath: options.baseMservPath,
    moduleQualifiedName: options.moduleQualifiedName,
    tsConfigPath: options.tsConfigPath,
    moduleResolutionMode: options.moduleResolutionMode,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    packageName: options.packageName,
  });
  const fileModuleHash = modules.fileModule.getHash();

  const binder = bindSourceFile({
    sourceFile,
    moduleHash: fileModuleHash,
    isExternalModule: modules.fileModule.isExternalModule,
    filePath: options.filePath,
    // A module augmentation's declarations belong to the AUGMENTED module's
    // table. Without this, `Request` in `augmented-base.ts` and `Request` inside
    // `declare module "./augmented-base"` are two symbols instead of one.
    resolveModuleHash: (specifier) => {
      const resolved = ts.resolveModuleName(
        specifier,
        options.absoluteFilePath,
        options.compilerOptions,
        ts.sys
      );
      const fileName = resolved.resolvedModule?.resolvedFileName;
      if (!fileName) {
        return undefined;
      }
      const absolute = path.normalize(fileName);
      const moduleHash = options.projectModuleHashes.get(absolute);
      if (!moduleHash) {
        return undefined;
      }
      return { moduleHash, relativePath: options.toProjectRelative(absolute) };
    },
    ambientModuleHashes: modules.ambientModuleHashes,
  });

  const importExtractor = new TsImportExtractor({
    sourceFile,
    filePath: options.filePath,
    absoluteFilePath: options.absoluteFilePath,
    tsModuleLinkHash: fileModuleHash,
    compilerOptions: options.compilerOptions,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    projectModuleHashes: options.projectModuleHashes,
    toProjectRelative: options.toProjectRelative,
  });
  const importResult = importExtractor.run();

  const declarations = new TsDeclarationExtractor({
    sourceFile,
    binder,
    filePath: options.filePath,
    baseMservPath: options.baseMservPath,
    fileName: path.basename(options.filePath),
    moduleHash: fileModuleHash,
    moduleQualifiedName: options.moduleQualifiedName,
    isDeclarationFile: sourceFile.isDeclarationFile,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    moduleHashForNode: modules.moduleHashForNode,
  });
  declarations.run();
  modules.fileModule.setModuleInitMethodLinkHash(declarations.moduleInitMethodHash);

  const expressions = new TsExpressionExtractor({
    sourceFile,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    typeReferenceExtractor: declarations.typeReferenceExtractor,
  });
  new TsExpressionWalker({
    sourceFile,
    extractor: expressions,
    moduleHash: fileModuleHash,
    moduleInitMethodHash: declarations.moduleInitMethodHash,
    moduleHashForNode: modules.moduleHashForNode,
    methodHashByNode: declarations.methodHashByNode,
    typeHashByNode: declarations.typeHashByNode,
    blockHashByNode: declarations.blockHashByNode,
    variableHashByNode: declarations.variableHashByNode,
    fieldHashByNode: declarations.fieldHashByNode,
    parameterHashByNode: declarations.parameterHashByNode,
  }).run();

  const resolver = new TsLocalResolver({
    sourceFile,
    binder,
    moduleHash: fileModuleHash,
    types: declarations.types,
    methods: declarations.methods,
    fields: declarations.fields,
    variables: declarations.variables,
    imports: importResult.importByLocalName,
    typeHashByNode: declarations.typeHashByNode,
    methodHashByNode: declarations.methodHashByNode,
    variableHashByNode: declarations.variableHashByNode,
    fieldHashByNode: declarations.fieldHashByNode,
    parameterHashByNode: declarations.parameterHashByNode,
    importRowByNode: importResult.importRowByNode,
    emittedExpressions: expressions.emitted,
    expressionRowByNode: expressions.rowByNode,
    callSiteByNode: expressions.callSiteByNode,
    callNodes: expressions.getCallNodes(),
    typeAliasTargetByName: declarations.typeAliasTargetByName,
  });
  const resolution = resolver.run();

  // After expressions, because a decorator IS an expression that runs and its
  // FK must point at a row that already exists.
  const decorators = extractDecorators({
    sourceFile,
    moduleHash: fileModuleHash,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    decoratorSystem: options.decoratorSystem,
    typeHashByNode: declarations.typeHashByNode,
    methodHashByNode: declarations.methodHashByNode,
    fieldHashByNode: declarations.fieldHashByNode,
    parameterHashByNode: declarations.parameterHashByNode,
    expressionRowByNode: expressions.rowByNode,
  });

  return {
    modules: [modules.fileModule, ...modules.nestedModules],
    types: declarations.types,
    methods: declarations.methods,
    methodParameters: declarations.methodParameters,
    fields: declarations.fields,
    variables: declarations.variables,
    heritages: declarations.heritages,
    typeReferences: declarations.typeReferenceExtractor.getRows(),
    imports: importResult.imports,
    expressions: expressions.expressions,
    callSites: expressions.callSites,
    blocks: declarations.blocks,
    decorators: decorators.decorators,
    decoratorArguments: decorators.decoratorArguments,
    deferredCalls: resolution.deferredCalls,
    importByLocalName: importResult.importByLocalName,
    resolvedTargetByLocalName: importResult.resolvedTargetByLocalName,
    stats: resolution.stats,
    binder,
    sourceFile,
    fileModuleHash,
  };
}

/**
 * `ts.ScriptKind` decides whether `<` opens JSX, so it cannot be guessed.
 *
 * `.mts` and `.cts` have no `ScriptKind` of their own — they are `TS` with a
 * different module resolution, which `ts_module.scriptKind` records separately.
 * Only `.tsx` changes how the file PARSES.
 */
function scriptKindFor(filePath: string): ts.ScriptKind {
  return filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}
