import * as path from 'path';

import * as ts from 'typescript';

import { TsBlockRegistry } from '@/analysis-types/typescript/TsBlockRegistry';
import { TsCommentRegistry } from '@/analysis-types/typescript/TsCommentRegistry';
import { TsEnumMemberRegistry } from '@/analysis-types/typescript/TsEnumMemberRegistry';
import { TsExportRegistry } from '@/analysis-types/typescript/TsExportRegistry';
import { TsFieldPositionRegistry } from '@/analysis-types/typescript/TsFieldPositionRegistry';
import { TsParseGapRegistry } from '@/analysis-types/typescript/TsParseGapRegistry';
import { TsCallSiteRegistry } from '@/analysis-types/typescript/TsCallSiteRegistry';
import { TsExpressionRegistry } from '@/analysis-types/typescript/TsExpressionRegistry';
import { TsFieldRegistry } from '@/analysis-types/typescript/TsFieldRegistry';
import { TsImportRegistry } from '@/analysis-types/typescript/TsImportRegistry';
import { TsMethodParameterRegistry } from '@/analysis-types/typescript/TsMethodParameterRegistry';
import { TsMethodRegistry } from '@/analysis-types/typescript/TsMethodRegistry';
import { TsModuleRegistry } from '@/analysis-types/typescript/TsModuleRegistry';
import { TsTypeHeritageRegistry } from '@/analysis-types/typescript/TsTypeHeritageRegistry';
import { TsTypeParameterRegistry } from '@/analysis-types/typescript/TsTypeParameterRegistry';
import { TsTypeReferenceRegistry } from '@/analysis-types/typescript/TsTypeReferenceRegistry';
import { TsTypeRegistry } from '@/analysis-types/typescript/TsTypeRegistry';
import { TsVariableRegistry } from '@/analysis-types/typescript/TsVariableRegistry';
import { TsDecoratorArgumentRegistry } from
  '@/analysis-types/typescript/TsDecoratorArgumentRegistry';
import { TsDecoratorRegistry } from '@/analysis-types/typescript/TsDecoratorRegistry';
import { TsDecoratorSystem } from '@/enums/typescript/decorators';
import { TsExportedEntityKind } from '@/enums/typescript/exports';
import { TsParseGapKind } from '@/enums/typescript/parse-gaps';
import { TsModuleResolutionMode } from '@/enums/typescript/modules';
import { bindSourceFile, BinderResult, nodeId } from '@/parsers/typescript/extractors/ts-binder';
import { TsDeclarationExtractor } from
  '@/parsers/typescript/extractors/ts-declaration-extractor';
import { extractComments } from '@/parsers/typescript/extractors/ts-comment-extractor';
import { extractDecorators } from '@/parsers/typescript/extractors/ts-decorator-extractor';
import { extractExports } from '@/parsers/typescript/extractors/ts-export-extractor';
import { TsExpressionExtractor } from
  '@/parsers/typescript/extractors/ts-expression-extractor';
import { TsExpressionWalker } from '@/parsers/typescript/extractors/ts-expression-walker';
import { TsImportExtractor } from '@/parsers/typescript/extractors/ts-import-extractor';
import { extractModules } from '@/parsers/typescript/extractors/ts-module-extractor';
import {
  EngineHandoff,
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
  readonly typeParameters: readonly TsTypeParameterRegistry[];
  readonly typeReferences: readonly TsTypeReferenceRegistry[];
  readonly imports: readonly TsImportRegistry[];
  readonly expressions: readonly TsExpressionRegistry[];
  readonly callSites: readonly TsCallSiteRegistry[];
  readonly blocks: readonly TsBlockRegistry[];
  readonly decorators: readonly TsDecoratorRegistry[];
  readonly decoratorArguments: readonly TsDecoratorArgumentRegistry[];
  readonly enumMembers: readonly TsEnumMemberRegistry[];
  readonly fieldPositions: readonly TsFieldPositionRegistry[];
  readonly exports: readonly TsExportRegistry[];
  readonly comments: readonly TsCommentRegistry[];
  readonly parseGaps: readonly TsParseGapRegistry[];
  /**
   * Calls the parser deliberately left to the engine, with the hop it needs.
   *
   * Not a work queue. It is what `ts-ir-completeness.ts` reads to ask whether
   * the FACTS the engine needs were emitted — which is the parser's actual
   * obligation.
   */
  readonly engineHandoffs: readonly EngineHandoff[];
  /** Local name -> the row that binds it, for the project pass. */
  readonly importByLocalName: ReadonlyMap<string, TsImportRegistry>;
  readonly resolvedTargetByLocalName: ReadonlyMap<string, string>;
  readonly stats: ResolutionStats;
  readonly binder: BinderResult;
  readonly sourceFile: ts.SourceFile;
  readonly fileModuleHash: string;
  readonly filePath: string;
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

  // Exports need every local declaration's hash, so this runs after the
  // declaration pass. A re-export chain is the only path from an importer to the
  // real declaration, which is why the relation is not optional.
  const declarationByName = new Map<
    string,
    { hash: string; groupKey: string; kind: TsExportedEntityKind }
  >();
  for (const type of declarations.types) {
    if (type.name !== '') {
      declarationByName.set(type.name, {
        hash: type.getHash(),
        groupKey: type.declarationGroupKey,
        kind: TsExportedEntityKind.TYPE,
      });
    }
  }
  for (const method of declarations.methods) {
    if (method.tsTypeLinkHash === '' && method.escapedName !== ''
      && !declarationByName.has(method.escapedName)) {
      declarationByName.set(method.escapedName, {
        hash: method.getHash(),
        groupKey: method.declarationGroupKey,
        kind: TsExportedEntityKind.METHOD,
      });
    }
  }
  for (const variable of declarations.variables) {
    if (variable.name !== '' && !declarationByName.has(variable.name)) {
      declarationByName.set(variable.name, {
        hash: variable.getHash(),
        groupKey: variable.declarationGroupKey,
        kind: TsExportedEntityKind.VARIABLE,
      });
    }
  }
  const exports = extractExports({
    sourceFile,
    tsModuleLinkHash: fileModuleHash,
    isDeclarationFile: sourceFile.isDeclarationFile,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    declarationByName,
    typeHashByNode: declarations.typeHashByNode,
    methodHashByNode: declarations.methodHashByNode,
    variableHashByNode: declarations.variableHashByNode,
    pendingExpressionLinks: declarations.pendingExpressionLinks,
  });
  for (const row of exports) {
    if (row.exportKind === 'DEFAULT_EXPORT' || row.exportKind === 'DEFAULT_EXPRESSION') {
      modules.fileModule.setDefaultExportLinkHash(row.getHash());
    }
    if (row.exportKind === 'EXPORT_ASSIGNMENT') {
      modules.fileModule.setExportAssignmentLinkHash(row.getHash());
    }
  }

  const expressions = new TsExpressionExtractor({
    sourceFile,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    typeReferenceExtractor: declarations.typeReferenceExtractor,
  });
  const walker = new TsExpressionWalker({
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
  });
  walker.run();
  // After the walk: a function type used as a type ARGUMENT has its return
  // reference emitted by the expression pass, so the signature rows can only be
  // linked once that has run.
  declarations.linkSignatureReturnTypes();

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

  // Close the declaration-to-expression FKs. Nine of them: a variable's
  // initializer, a field's, a parameter default, a block's GUARD (the narrowing
  // lever — 440 type predicates measured), a mixin base, an enum member's value,
  // `export default <expr>`, a dynamic import. Each is a chain an engine can
  // follow, and each was empty until the hash existed to fill it.
  // An object-literal member's owner is the literal itself -- a ts_expression
  // row. Resolved from the extractor's per-node index rather than the walker's
  // ROOT index, so a literal that is an argument or nested inside another
  // literal is reached too, not only one that initialises a variable.
  for (const pending of declarations.pendingLiteralOwnerLinks) {
    const owner = expressions.rowByNode.get(nodeId(pending.node, sourceFile));
    if (owner !== undefined) {
      pending.row.setTsTypeLinkHash(owner.getHash());
    }
  }
  for (const pending of declarations.pendingExpressionLinks) {
    const hash = walker.rootHashByNode.get(nodeId(pending.node, sourceFile));
    if (hash !== undefined && hash !== '') {
      pending.link(hash);
    }
  }
  // c16, the one link that runs the other way: an expression that INTRODUCES a
  // declaration points at it. A `ts_type` for a class expression, a `ts_method`
  // for an arrow or function expression — discriminated by the expression's own
  // kind, which is what the widening made possible.
  for (const [id, declarationHash] of declarations.anonymousDeclarationByNode) {
    expressions.rowByNode.get(id)?.setAnonymousDeclarationHash(declarationHash);
  }
  // `import("m")` and `require("m")` are module edges written inside an
  // expression, so the import row points at the call that performs them.
  for (const importRow of importResult.imports) {
    if (importRow.importKind !== 'DYNAMIC_IMPORT' && importRow.importKind !== 'REQUIRE_CALL') {
      continue;
    }
    const call = importResult.dynamicImportNodeByRow.get(importRow.getHash());
    if (call) {
      const hash = expressions.rowByNode.get(nodeId(call, sourceFile))?.getHash();
      if (hash !== undefined) {
        importRow.setTsExpressionLinkHash(hash);
      }
    }
  }

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
    typeReferenceExtractor: declarations.typeReferenceExtractor,
  });

  // Comments are TRIVIA: not in the AST, so no walk reaches them. The owner map
  // is keyed by a declaration's start OFFSET, because that is what the comment
  // scan knows about the node it precedes.
  const ownerHashByStart = new Map<number, string>();
  for (const [id, hash] of declarations.typeHashByNode) {
    recordOwnerStart(ownerHashByStart, id, hash);
  }
  for (const [id, hash] of declarations.methodHashByNode) {
    recordOwnerStart(ownerHashByStart, id, hash);
  }
  for (const [id, hash] of declarations.fieldHashByNode) {
    recordOwnerStart(ownerHashByStart, id, hash);
  }
  for (const [id, hash] of declarations.variableHashByNode) {
    recordOwnerStart(ownerHashByStart, id, hash);
  }
  const comments = extractComments({
    sourceFile,
    filePath: options.filePath,
    tsModuleLinkHash: fileModuleHash,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    ownerHashByStart,
  });

  // Should always be empty: zero parse failures measured over 25.9 MB. Emitted
  // anyway, because an always-empty relation that suddenly has rows is a signal
  // and a missing relation is a silence.
  const parseGaps: TsParseGapRegistry[] = [];
  for (const diagnostic of parseDiagnosticsOf(sourceFile)) {
    const at = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    const end = sourceFile.getLineAndCharacterOfPosition(
      (diagnostic.start ?? 0) + (diagnostic.length ?? 0)
    );
    parseGaps.push(new TsParseGapRegistry({
      gapKind: TsParseGapKind.PARSE_DIAGNOSTIC,
      diagnosticCode: String(diagnostic.code),
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
      filePath: options.filePath,
      startLine: at.line + 1,
      startColumn: at.character + 1,
      endLine: end.line + 1,
      tsModuleLinkHash: fileModuleHash,
      serviceVersionLinkHash: options.serviceVersionLinkHash,
    }));
  }

  return {
    modules: [modules.fileModule, ...modules.nestedModules],
    types: declarations.types,
    methods: declarations.methods,
    methodParameters: declarations.methodParameters,
    fields: declarations.fields,
    variables: declarations.variables,
    heritages: declarations.heritages,
    typeParameters: declarations.typeParameters,
    typeReferences: declarations.typeReferenceExtractor.getRows(),
    imports: importResult.imports,
    expressions: expressions.expressions,
    callSites: expressions.callSites,
    blocks: declarations.blocks,
    decorators: decorators.decorators,
    decoratorArguments: decorators.decoratorArguments,
    enumMembers: declarations.enumMembers,
    fieldPositions: declarations.fieldPositions,
    exports,
    comments,
    parseGaps,
    engineHandoffs: resolution.handoffs,
    importByLocalName: importResult.importByLocalName,
    resolvedTargetByLocalName: importResult.resolvedTargetByLocalName,
    stats: resolution.stats,
    binder,
    sourceFile,
    fileModuleHash,
    filePath: options.filePath,
  };
}

/**
 * `ts.ScriptKind` decides whether `<` opens JSX, so it cannot be guessed.
 *
 * `.mts` and `.cts` have no `ScriptKind` of their own — they are `TS` with a
 * different module resolution, which `ts_module.scriptKind` records separately.
 * Only `.tsx` changes how the file PARSES.
 */
/**
 * A node identity is `kind:start:end`; the comment scan knows only the start.
 *
 * Recorded first-wins, because several nodes can begin at one offset — a
 * declaration and its own name — and the OUTERMOST is the one a preceding
 * comment documents.
 */
function recordOwnerStart(
  target: Map<number, string>,
  nodeIdentity: string,
  hash: string
): void {
  const start = Number(nodeIdentity.split(':')[1] ?? '');
  if (!Number.isNaN(start) && !target.has(start)) {
    target.set(start, hash);
  }
}

/**
 * Parse diagnostics, without a Program.
 *
 * `ts.createSourceFile` records syntactic diagnostics on the source file itself,
 * under an internal property. Reading it is the only way to see them without a
 * Program — and the alternative, reporting no gaps ever, would make the relation
 * a decoration rather than a signal.
 */
function parseDiagnosticsOf(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  return (sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] })
    .parseDiagnostics ?? [];
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  return filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}
