import * as path from 'path';

import * as ts from 'typescript';

import { JsBlockRegistry } from '@/analysis-types/javascript/JsBlockRegistry';
import { JsFieldRegistry } from '@/analysis-types/javascript/JsFieldRegistry';
import { JsMethodParameterRegistry } from
  '@/analysis-types/javascript/JsMethodParameterRegistry';
import { JsMethodRegistry } from '@/analysis-types/javascript/JsMethodRegistry';
import { JsModuleRegistry } from '@/analysis-types/javascript/JsModuleRegistry';
import { JsScopeRegistry } from '@/analysis-types/javascript/JsScopeRegistry';
import { JsTypeHeritageRegistry } from
  '@/analysis-types/javascript/JsTypeHeritageRegistry';
import { JsTypeRegistry } from '@/analysis-types/javascript/JsTypeRegistry';
import { JsVariableRegistry } from '@/analysis-types/javascript/JsVariableRegistry';
import { JsCallSiteRegistry } from '@/analysis-types/javascript/JsCallSiteRegistry';
import { JsExpressionRegistry } from '@/analysis-types/javascript/JsExpressionRegistry';
import { JsDeclarationExtractor } from
  '@/parsers/javascript/extractors/js-declaration-extractor';
import { JsSourceProvenance } from '@/enums/javascript/modules';
import { JsExpressionExtractor } from
  '@/parsers/javascript/extractors/js-expression-extractor';
import { JsExportRegistry } from '@/analysis-types/javascript/JsExportRegistry';
import { JsImportRegistry } from '@/analysis-types/javascript/JsImportRegistry';
import { JsExportTargetKind } from '@/enums/javascript/exports';
import { nodeKey } from '@/parsers/javascript/extractors/js-symbol-table';
import { JsExpressionWalker } from
  '@/parsers/javascript/extractors/js-expression-walker';
import { extractModuleEdges } from
  '@/parsers/javascript/extractors/js-module-edge-extractor';
import { JsCommentRegistry } from '@/analysis-types/javascript/JsCommentRegistry';
import { JsTypeReferenceRegistry } from
  '@/analysis-types/javascript/JsTypeReferenceRegistry';
import { JsCommentAttachmentKind } from '@/enums/javascript/comments';
import { JsTypeReferenceContextKind, JsTypeReferenceOwnerKind } from
  '@/enums/javascript/type-references';
import { JsParseGapRegistry } from '@/analysis-types/javascript/JsParseGapRegistry';
import { extractComments } from '@/parsers/javascript/extractors/js-comment-extractor';
import { extractParseGaps } from
  '@/parsers/javascript/extractors/js-parse-gap-extractor';
import { JsDocExtractor } from '@/parsers/javascript/extractors/js-jsdoc-extractor';
import { JsModuleSystem, JsModuleSystemSource } from '@/enums/javascript/modules';
import {
  extractModule,
  ModuleShape,
  scriptKindFor,
} from '@/parsers/javascript/extractors/js-module-extractor';
import {
  buildScopes,
  ScopeBuildResult,
} from '@/parsers/javascript/extractors/js-scope-builder';
import { extractScopes } from '@/parsers/javascript/extractors/js-scope-extractor';
import { jsDocTagsOfAllBlocks } from '@/utils/javascript/javascript-node-utils';

/**
 * Extracts the whole fact spine for ONE JavaScript file.
 *
 * ## The order is a dependency order, and JavaScript adds a second pass to it
 *
 * `BUILDING-A-PARSER.md` §1 gives the order as
 * `module → type → method → … → expression → call_site`, expressions last
 * because they reference everything else. That holds here, **and then inverts at
 * the end**:
 *
 * ```
 * module → scope → type → type_heritage → method → method_parameter → field
 *        → variable → type_reference (JSDoc)
 *        → expression → call_site
 *        → import / export        ← SECOND PASS, minted FROM expression rows
 * ```
 *
 * 83.6% of JavaScript module edges are expression-borne: `require('./x')` is a
 * call and `module.exports = X` is an assignment. So `js_import` and `js_export`
 * cannot be built before the expressions they are minted from, and the module
 * graph therefore depends on the relation that §1 says comes last. That is the
 * finding that made JavaScript its own front end rather than a mode of the
 * TypeScript one.
 *
 * ## No `ts.Program`, at any step, for any row
 *
 * `ts.createSourceFile` is text to AST and `ts.resolveModuleName` is a pure
 * function of a specifier and options. Neither needs `node_modules` resolved and
 * neither typechecks. The reasons this is a rule and not a preference:
 * hermeticity, no worst-case bound, and — the one that actually bites — a
 * Program on an unresolvable checkout still builds and quietly types everything
 * `any`, returning **confident wrong answers** rather than failing. Building one
 * is nearly free; that was never the argument.
 */
export interface JsFileExtractionOptions {
  readonly absoluteFilePath: string;
  readonly filePath: string;
  readonly baseMservPath: string;
  readonly moduleQualifiedName: string;
  readonly sourceText: string;
  readonly serviceVersionLinkHash: string;
  /**
   * From the `package.json` that GOVERNS this file — never a run-wide constant.
   *
   * `moduleSystem` is in `js_module`'s primary key, so this is the one option
   * whose wrong value does not produce a wrong column but an incomparable fact
   * base. It is resolved per file, by `PackageJsonResolver`, and the governing
   * file is frequently outside the repository entirely.
   */
  readonly moduleSystem: JsModuleSystem;
  readonly moduleSystemSource: JsModuleSystemSource;
  readonly governingPackageJsonPath: string;
  readonly packageName: string;
  readonly compilerOptions: ts.CompilerOptions;
  /** Absolute path -> `js_module` hash for every file in the analysis. */
  readonly projectModuleHashes: ReadonlyMap<string, string>;
  /** Absolute path -> project-relative path, extension stripped. */
  readonly toProjectRelative: (absolutePath: string) => string;
}

export interface JsFileFacts {
  readonly modules: readonly JsModuleRegistry[];
  readonly scopes: readonly JsScopeRegistry[];
  readonly types: readonly JsTypeRegistry[];
  readonly heritages: readonly JsTypeHeritageRegistry[];
  readonly methods: readonly JsMethodRegistry[];
  readonly methodParameters: readonly JsMethodParameterRegistry[];
  readonly fields: readonly JsFieldRegistry[];
  readonly variables: readonly JsVariableRegistry[];
  readonly blocks: readonly JsBlockRegistry[];
  readonly expressions: readonly JsExpressionRegistry[];
  readonly callSites: readonly JsCallSiteRegistry[];
  readonly imports: readonly JsImportRegistry[];
  readonly exports: readonly JsExportRegistry[];
  readonly comments: readonly JsCommentRegistry[];
  readonly typeReferences: readonly JsTypeReferenceRegistry[];
  readonly parseGaps: readonly JsParseGapRegistry[];
  // OPTIONAL, because a DECLINED file has none of them.
  //
  // A Flow file returns after its module row and is never bound, never walked
  // and never linked — so there is no binder, no declaration extractor and no
  // scope tree to hand back. Marking these optional is the type saying that,
  // rather than a lie kept consistent by building state nobody will read.
  //
  // Nothing outside this file consumes them today; they exist so a later pass
  // can link without re-deriving a key.
  readonly declarations?: JsDeclarationExtractor;
  readonly expressionExtractor?: JsExpressionExtractor;
  readonly shape?: ModuleShape;
  /** The binder's tree, kept so later passes resolve names rather than hashes. */
  readonly binder?: ScopeBuildResult;
  readonly sourceFile?: ts.SourceFile;
  readonly fileModuleHash?: string;
  readonly filePath?: string;
}

export function extractJavaScriptFile(options: JsFileExtractionOptions): JsFileFacts {
  // `setParentNodes = true`. The parent pointers are not a convenience: owner
  // derivation and scope lookup both walk ANCESTORS, and the alternative —
  // comparing positions — picks the wrong scope whenever two of them begin at
  // the same offset, which in JavaScript happens constantly because an IIFE's
  // function, its call and its parenthesis all start together.
  const sourceFile = ts.createSourceFile(
    options.absoluteFilePath,
    options.sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(options.absoluteFilePath)
  );

  const moduleResult = extractModule({
    sourceFile,
    sourceText: options.sourceText,
    filePath: options.filePath,
    baseMservPath: options.baseMservPath,
    moduleQualifiedName: options.moduleQualifiedName,
    moduleSystem: options.moduleSystem,
    moduleSystemSource: options.moduleSystemSource,
    governingPackageJsonPath: options.governingPackageJsonPath,
    packageName: options.packageName,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  });
  const fileModuleHash = moduleResult.module.getHash();

  // FLOW IS OUT OF SCOPE, and this is where the scope ends.
  //
  // Ruled after js-corpus sized it: 3,793 parameters carrying Flow annotations
  // indistinguishable from TypeScript ones, `declare function` minting
  // type-only method rows into the call graph, and zero of 248 `@flow` files
  // parsing cleanly. `ts.createSourceFile` under ScriptKind.JS accepts Flow's
  // grammar where it overlaps TypeScript's and MIS-PARSES where it diverges,
  // which is one cause wearing three faces.
  //
  // The module row is still emitted, and that is the entire design. A silent
  // skip is §9's nested-config failure — 1,270 of 1,821 files excluded with nothing
  // counting them, and a run that reported success. Here the file is in the
  // fact base saying exactly what it is, so "how much of this tree was
  // declined" is a query rather than a guess, and gate 7.3.5 — a non-PROJECT
  // file contributes zero rows to any denominator — covers it with no new code.
  //
  // RETURNING EARLY, before the binder. Not after emitting and filtering: the
  // point is that no row exists to be filtered, so nothing downstream can read
  // a Flow annotation as a TypeScript one by forgetting to check a column.
  if (moduleResult.module.sourceProvenance === JsSourceProvenance.FLOW_REJECTED) {
    return {
      modules: [moduleResult.module],
      scopes: [], types: [], heritages: [], methods: [], methodParameters: [],
      fields: [], variables: [], blocks: [], expressions: [], callSites: [],
      imports: [], exports: [], comments: [], typeReferences: [], parseGaps: [],
    };
  }

  // The binder, second. Nothing downstream is trustworthy until the scope tree
  // is right: in a language where 0.165% of parameters are annotated, what a
  // name refers to is the binder's answer and not the type system's. This is the
  // step `ts-fact-extractor.ts` spends on declaration-merge scopes and this
  // front end spends on hoisting, the temporal dead zone and `this`.
  const binder = buildScopes({
    sourceFile,
    moduleSystem: options.moduleSystem,
    hasEsmSyntax: moduleResult.shape.hasEsmSyntax,
  });
  const scopes = extractScopes({
    build: binder,
    moduleHash: fileModuleHash,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  });
  moduleResult.module.setModuleScopeLinkHash(
    scopes.hashOfScope(binder.moduleScope)
  );

  // Declarations third. Types before methods before parameters before fields
  // before variables — each step needs the hashes the previous one minted, and
  // all of them are one walk so no construct is visited twice.
  const declarations = new JsDeclarationExtractor({
    sourceFile,
    binder,
    filePath: options.filePath,
    fileName: path.basename(options.filePath),
    baseMservPath: options.baseMservPath,
    moduleHash: fileModuleHash,
    moduleQualifiedName: options.moduleQualifiedName,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    hashOfScope: scopes.hashOfScope,
  });
  declarations.run();
  moduleResult.module.setModuleInitMethodLinkHash(declarations.moduleInitMethodHash);

  // Expressions and call sites LAST among the tree-walking passes, per §1: they
  // reference everything above by hash, and building them earlier would mean
  // re-deriving keys that do not exist yet.
  const expressions = new JsExpressionExtractor({
    sourceFile,
    binder,
    moduleHash: fileModuleHash,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    hashOfScope: scopes.hashOfScope,
    declarationByAssignment: declarations.declarationByAssignment,
    variableHashByBindingKey: declarations.variableHashByNode,
    parameterHashByNode: declarations.parameterHashByNode,
    declaresTypeNamed: (name) => declarations.typeNamed(name) !== undefined,
  });
  new JsExpressionWalker({
    sourceFile,
    extractor: expressions,
    methodHashByNode: declarations.methodHashByNode,
    moduleInitMethodHash: declarations.moduleInitMethodHash,
  }).run();

  // c32 `introducesDeclarationLinkHash`: the callable an expression IS.
  //
  // The gap it closes: `emitter.on('x', () => { … })` produces a call site, an
  // argument expression, and a js_method row for the arrow — and nothing joined
  // the third to the second, so every call inside that body was orphaned from
  // the edge that reaches it. Measured here at 10,169 callbacks in argument
  // position with no link, and independently by js-oracle at 7,923 of 25,573
  // callables (31.0%), 98.2% of them anonymous.
  //
  // Deliberately NOT c12/c13: `isDeclarationBearing` means "this assignment
  // declares a member", and an arrow passed as an argument declares none.
  // Widening that column would leave every existing consumer reading the old
  // meaning against a column that now carries something else — silently, which
  // is the §4 defect class.
  //
  // Same file, one hop, purely syntactic: both rows were minted by this pass.
  for (const [identity, row] of expressions.rowByNode) {
    const method = declarations.methodHashByNode.get(identity);
    if (method !== undefined) {
      row.setIntroducesDeclarationLinkHash(method);
      continue;
    }
    // A CLASS_EXPRESSION introduces a js_type, and the column is declared
    // FK→js_method. A class expression's row therefore points at its
    // CONSTRUCTOR, which is the callable it introduces and the thing an engine
    // following a call would want; a class with no constructor links nothing
    // rather than pointing into the wrong relation.
    const type = declarations.typeHashByNode.get(identity);
    if (type !== undefined) {
      const constructor = declarations.constructorMethodOf(type);
      if (constructor !== undefined) {
        row.setIntroducesDeclarationLinkHash(constructor);
      }
    }
  }

  // Close the declaration-to-expression links, now that the hashes exist. A
  // variable's initializer, a field's, a prototype assignment's source — each is
  // a chain an engine can follow, and each was empty until this point.
  for (const pending of declarations.pendingExpressionLinks) {
    const hash = expressions.rootHashByNode.get(pending.nodeIdentity)
      ?? expressions.rowByNode.get(pending.nodeIdentity)?.getHash();
    if (hash !== undefined && hash !== '') {
      pending.link(hash);
    }
  }

  // THE SECOND PASS. `js_import` and `js_export` are minted FROM the expression
  // rows above, because 83.6% of JavaScript module edges are expression-borne:
  // `require('./x')` is a call and `module.exports = X` is an assignment. This
  // is the step that inverts §1's build order, and it is the finding that made
  // JavaScript its own front end rather than a mode of the TypeScript one.
  // EVERY declaration under a name, in source order — not the first one.
  //
  // It was `Map<string, one target>`: types last-wins, methods and variables
  // first-wins behind a `has` guard. A module declaring `author` twice gave
  // every `exports.author =` the first one. 570 colliding names over 4,561
  // files, 3,999 shadowed declarations — the largest of the six name-keyed
  // indexes, and the same failure as all of them: a name is not an identity.
  //
  // Resolved at the EXPORT's own position, nearest-preceding, so
  // `module.exports.f = f` picks the `f` a reader would see.
  const declarationTargetByName = new Map<
    string, Array<{ kind: JsExportTargetKind; hash: string; start: number }>
  >();
  const addTarget = (
    name: string, kind: JsExportTargetKind, hash: string, line: number, column: number
  ): void => {
    if (name === '') {
      return;
    }
    const existing = declarationTargetByName.get(name) ?? [];
    existing.push({ kind, hash, start: offsetOfRow(sourceFile, line, column) });
    existing.sort((a, b) => a.start - b.start);
    declarationTargetByName.set(name, existing);
  };
  for (const type of declarations.types) {
    addTarget(type.name, JsExportTargetKind.TYPE, type.getHash(),
      type.startLine, type.startColumn);
  }
  for (const method of declarations.methods) {
    if (method.ownerTypeLinkHash === '') {
      addTarget(method.name, JsExportTargetKind.METHOD, method.getHash(),
        method.startLine, method.startColumn);
    }
  }
  for (const variable of declarations.variables) {
    addTarget(variable.name, JsExportTargetKind.VARIABLE, variable.getHash(),
      variable.startLine, variable.startColumn);
  }
  const moduleEdges = extractModuleEdges({
    sourceFile,
    binder,
    absoluteFilePath: options.absoluteFilePath,
    moduleHash: fileModuleHash,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    serviceVersion: '',
    compilerOptions: options.compilerOptions,
    moduleSystem: options.moduleSystem,
    hashOfScope: scopes.hashOfScope,
    expressionRowByNode: expressions.rowByNode,
    rootHashByNode: expressions.rootHashByNode,
    methodHashByNode: declarations.methodHashByNode,
    typeHashByNode: declarations.typeHashByNode,
    moduleInitMethodHash: declarations.moduleInitMethodHash,
    toProjectRelative: options.toProjectRelative,
    projectModuleHashes: options.projectModuleHashes,
    declarationTargetByName,
  });
  // A scope names the method it belongs to. Back-patched because a scope is
  // minted during the binder pass, which runs BEFORE declarations — and it has
  // to, since a method's bodyScopeLinkHash points back at the scope.
  for (const scope of binder.scopes) {
    if (scope.ownerNode === null) {
      continue;
    }
    const hash = declarations.methodHashByNode.get(nodeKey(scope.ownerNode));
    if (hash !== undefined) {
      scopes.rowByScopeKey.get(scope.key)?.setOwnerMethodLinkHash(hash);
    }
  }

  // THE THREE HOPS, for an inheritance edge. §0: a receiver whose type lives in
  // another file needs the declared name as written, the importing module, and
  // the import's resolvedFilePath — and `class Router extends EventEmitter`
  // where `EventEmitter` came from `require('events')` is exactly that shape.
  // The name was already there; without these two the row named a supertype an
  // engine had no way to find, which is an incompleteness invisible to every
  // count because the row exists and is correctly positioned.
  for (const heritage of declarations.heritages) {
    // By the ROOT identifier: `class A extends ns.Base` is bound through `ns`.
    // Joining on the last segment linked it to an unrelated `{ Base }` import
    // when one existed, and to nothing when it did not (#479).
    const root = heritage.rootIdentifierNameValue();
    if (root === '') {
      continue;
    }
    const importRow = moduleEdges.importBinding(root,
      offsetOfRow(sourceFile, heritage.startLine, 1));
    if (importRow === undefined) {
      continue;
    }
    heritage.setImportLinkHash(importRow.getHash());
    heritage.setResolvedFilePath(importRow.resolvedFilePath);
  }
  // Exported declarations say so, and the module names its default export.
  // `module.exports = Router` IS the default export in CommonJS, so a module
  // with one and an empty defaultExportLinkHash is a module whose principal
  // export an engine cannot find.
  const exportedNames = new Set<string>();
  for (const row of moduleEdges.exports) {
    if (row.localName !== '') {
      exportedNames.add(row.localName);
    }
    if (row.exportedName !== '' && row.exportedName !== 'default') {
      exportedNames.add(row.exportedName);
    }
    if (row.exportedName === 'default' || row.exportForm === 'EXPORT_DEFAULT') {
      moduleResult.module.setDefaultExportLinkHash(row.getHash());
    }
  }
  const exportedTargets = new Set(moduleEdges.exports.map((row) => row.targetLinkHashValue()));
  for (const type of declarations.types) {
    // By NAME for a named declaration, by TARGET for an anonymous one: the
    // default-exported `class extends Base {}` has no name to be found by.
    if (exportedNames.has(type.name) || exportedTargets.has(type.getHash())) {
      type.setIsExported();
    }
  }
  for (const method of declarations.methods) {
    if (method.name !== '' && exportedNames.has(method.name)) {
      method.setIsExported();
    }
  }
  for (const variable of declarations.variables) {
    if (exportedNames.has(variable.name)) {
      variable.setIsExported();
    }
  }

  // A variable bound by `require()` names the import it aliases. That plus
  // `initializerKind = REQUIRE_CALL` is the hop the engine walks for the 34.4%
  // of declines that are calls through a required binding.
  // BY IDENTITY, not by name. A variable is bound by an import only when its
  // declaration node IS the import's binding node; resolving by name let a
  // shadowing local claim the import in both directions (72 wrong reverse
  // targets became 152 when the name lookup became position-aware — more
  // shadows found it). The binder keys variables on the name Identifier and
  // the import extractor now records the same node, so the join is exact.
  const variableByHash = new Map(declarations.variables.map((v) => [v.getHash(), v]));
  for (const [declarationKey, variableHash] of declarations.variableHashByNode) {
    const importRow = moduleEdges.importByBindingNode.get(declarationKey);
    if (importRow === undefined) {
      continue;
    }
    const variable = variableByHash.get(variableHash);
    if (variable === undefined) {
      continue;
    }
    variable.setImportLinkHash(importRow.getHash());
    importRow.setBoundVariableLinkHash(variable.getHash());
  }
  // The same hop, on the call site: a receiver that came through an import
  // carries the import row, which is one of the three things §0 says makes a
  // row complete.
  for (const callSite of expressions.callSites) {
    if (callSite.receiverText === '') {
      continue;
    }
    const importRow = moduleEdges.importBinding(callSite.receiverText,
      offsetOfRow(sourceFile, callSite.startLine, callSite.startColumn));
    if (importRow !== undefined) {
      callSite.setImportLinkHash(importRow.getHash());
    }
  }

  // Comments, which are TRIVIA: not in the AST, so no walk reaches them. After
  // the declarations, because attachment is by a declaration's start offset.
  const ownerByStart = new Map<
    number, { kind: JsCommentAttachmentKind; hash: string }
  >();
  const recordOwner = (
    index: ReadonlyMap<string, string>,
    kind: JsCommentAttachmentKind
  ): void => {
    for (const [identity, hash] of index) {
      // A node identity is `kind:start:end`; the comment scan knows only the
      // start. First-wins, because several nodes begin at one offset — a
      // declaration and its own name — and the OUTERMOST is the one a preceding
      // comment documents.
      const start = Number(identity.split(':')[1] ?? '');
      if (!Number.isNaN(start) && !ownerByStart.has(start)) {
        ownerByStart.set(start, { kind, hash });
      }
    }
  };
  recordOwner(declarations.typeHashByNode, JsCommentAttachmentKind.TYPE);
  recordOwner(declarations.methodHashByNode, JsCommentAttachmentKind.METHOD);
  recordOwner(declarations.fieldHashByNode, JsCommentAttachmentKind.FIELD);
  recordOwner(declarations.variableHashByNode, JsCommentAttachmentKind.VARIABLE);
  // The statement offsets, which is what a leading comment actually precedes.
  for (const [start, owner] of declarations.commentOwnerStarts) {
    if (!ownerByStart.has(start)) {
      ownerByStart.set(start, {
        kind: owner.kind as JsCommentAttachmentKind, hash: owner.hash,
      });
    }
  }
  const comments = extractComments({
    sourceFile,
    moduleHash: fileModuleHash,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    ownerByStart,
  });

  // Every declaration that a JSDoc comment documents points at it. The comment
  // relation already knows which declaration each comment is attached to, so
  // this is that index inverted rather than a second attachment computation —
  // two answers to one question is how the two relations come to disagree.
  const commentByOwnerHash = new Map<string, string>();
  for (const comment of comments.comments) {
    if (!comment.isJsdoc) {
      continue;
    }
    const owner = comment.attachedToLinkHashValue();
    if (owner !== '' && !commentByOwnerHash.has(owner)) {
      commentByOwnerHash.set(owner, comment.getHash());
    }
  }
  for (const method of declarations.methods) {
    const comment = commentByOwnerHash.get(method.getHash());
    if (comment !== undefined) {
      method.setJsdocCommentLinkHash(comment);
    }
  }
  for (const type of declarations.types) {
    const comment = commentByOwnerHash.get(type.getHash());
    if (comment !== undefined) {
      type.setJsdocCommentLinkHash(comment);
    }
  }
  // A parameter's documentation is its FUNCTION's comment: `@param {T} x` lives
  // in the block above the function, not above the parameter, so the parameter
  // cites the same comment its owner does.
  for (const parameter of declarations.methodParameters) {
    const comment = commentByOwnerHash.get(parameter.ownerMethodLinkHash);
    if (comment !== undefined) {
      parameter.setJsdocCommentLinkHash(comment);
    }
  }

  // The JSDoc type trees, last: they link to an OWNER row and to the COMMENT
  // they were read out of, so both must already exist. `Array<Object<string,
  // number>>` is three rows here, not a string — a consumer that has to
  // re-parse a string to find a generic argument gets it wrong on the first
  // nested union.
  const jsdoc = new JsDocExtractor({
    sourceFile,
    moduleHash: fileModuleHash,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    commentByStart: comments.commentByStart,
  });
  for (const { tag, row } of declarations.jsDocTypeTags) {
    const owner = {
      node: tag,
      ownerKind: JsTypeReferenceOwnerKind.TYPE,
      ownerHash: row.getHash(),
    };
    jsdoc.typedefTypeOf(tag, owner);
    // `@template T` on a `@typedef` — a GENERIC type alias, whose tag sits in
    // the same comment block. The block attaches to whatever node follows it,
    // and at end of file that is the EOF token, so asking the tag's own
    // container is the only way to find it.
    jsdoc.templatesOf({ ...owner, node: containerOf(tag) ?? tag });
    // The evidence for a COMMENT_ONLY row. The gate asserts it points at a
    // comment whose `declaresType` is true, so the two relations have to agree
    // about which comments are declarations rather than each asserting it alone.
    let container: ts.Node | undefined = tag;
    while (container !== undefined && container.kind !== ts.SyntaxKind.JSDoc) {
      container = container.parent;
    }
    const evidence = container === undefined
      ? undefined
      : comments.commentByStart.get(container.pos);
    if (evidence !== undefined) {
      row.setJsdocCommentLinkHash(evidence.getHash());
    }
  }
  for (const method of declarations.methods) {
    const node = declarations.nodeForMethod(method);
    if (node === undefined) {
      continue;
    }
    const owner = {
      node,
      ownerKind: JsTypeReferenceOwnerKind.METHOD,
      ownerHash: method.getHash(),
    };
    const returnType = jsdoc.returnTypeOf(owner);
    if (returnType !== undefined) {
      method.setReturnTypeReferenceLinkHash(returnType.root.getHash());
    }
    // `@this {T}` — the receiver's declared type. There is no column on
    // js_method to hold it, and that is the point: the TREE is the fact, and it
    // is reachable from the method through js_type_reference.ownerLinkHash like
    // every other JSDoc-borne type. Emitting it costs one call; not emitting it
    // cost the only statement of a receiver type JavaScript has.
    jsdoc.thisTypeOf(owner);
    // `@throws {T}` — the closest JavaScript comes to a throws clause. Ten over
    // the corpus, and each is a fact an engine cannot get from anywhere else.
    jsdoc.throwsTypesOf(owner);
    // `@template T` — 624 measured, and the reason there is no
    // `js_type_parameter` relation: a separate table for that many comment-borne
    // rows is not worth having, so a type parameter is a type reference with
    // `contextKind = TEMPLATE`. The departure from `ts_type_parameter` is a
    // decision, recorded here and in the enum.
    jsdoc.templatesOf(owner);
  }
  // `@extends {T}` and `@implements {T}` — heritage asserted in a COMMENT, which
  // for `implements` is the only route the language has at all. The method
  // existed and was never called, so both context kinds were declared and never
  // emitted: a gap invisible to every count, because no row was misplaced —
  // there simply were none.
  for (const type of declarations.types) {
    const node = declarations.nodeForType(type);
    if (node === undefined) {
      continue;
    }
    const owner = {
      node,
      ownerKind: JsTypeReferenceOwnerKind.TYPE,
      ownerHash: type.getHash(),
    };
    jsdoc.heritageOf(owner);
    // `@template T` on a CLASS. Collected only for methods until the oracle's
    // JSDoc correction made the counts checkable against ground truth, which
    // showed three class-level templates falling on the floor. A generic class
    // whose type parameter is invisible is a class whose members cannot be
    // substituted.
    jsdoc.templatesOf(owner);
  }
  // Every other typed position: parameters, fields and variables, each linking
  // the tree its JSDoc declared. Collected at MINT time by the declaration pass,
  // because the owner kind and the node are known there and nowhere else.
  for (const pending of declarations.pendingTypeReferences) {
    // An EXPRESSION owner's row was minted by the pass that just ran; its hash
    // could not be known when the declaration walk recorded the reference. If
    // the expression pass emitted nothing for the node — it can, for a value the
    // depth cap dropped — there is no owner, and a reference owned by nothing is
    // a dangling FK, so it is not emitted.
    let ownerHash = pending.ownerHash;
    if (pending.ownerKind === JsTypeReferenceOwnerKind.EXPRESSION) {
      const row = pending.ownerNode === undefined
        ? undefined
        : expressions.rowByNode.get(nodeKey(pending.ownerNode));
      if (row === undefined) {
        continue;
      }
      ownerHash = row.getHash();
    }
    const owner = {
      node: pending.node,
      ownerKind: pending.ownerKind,
      ownerHash,
      parameterName: pending.parameterName,
    };
    const result = pending.contextKind === JsTypeReferenceContextKind.PARAM
      ? jsdoc.parameterTypeOf(owner)
      : jsdoc.declaredTypeOf(owner, pending.contextKind);
    if (result !== undefined) {
      pending.link(result.root.getHash());
    }
  }

  // The same three hops for a JSDoc type reference: `@param {Router} r` where
  // `Router` was required is followable for exactly the same reason an
  // inheritance edge is. After the JSDoc pass, because that is what mints the
  // rows this fills.
  // An IMPORT_TYPE row's hop is its OWN js_import row (§3.8.1), minted here
  // per occurrence — the module-edge walk never enters a comment. Before the
  // by-name join below, which must not see these: the qualifier `Y` of
  // `import("./x").Y` could share a name with a runtime import and be joined
  // to the wrong edge.
  const linkedByImportType = new Set<JsTypeReferenceRegistry>();
  for (const { row, node } of jsdoc.importTypeNodes) {
    const importRow = moduleEdges.emitJsDocImportType(node);
    if (importRow === undefined) {
      continue;
    }
    row.setImportLinkHash(importRow.getHash());
    row.setResolvedFilePath(importRow.resolvedFilePath);
    linkedByImportType.add(row);
  }
  // A JSDoc `@import` tag (#621): a `JSDocImportTag` on any documented node, not
  // an import TYPE node, so the loop above never reaches it. Its rows carry a
  // local name, and the by-name join below is what links `@param {Name}` to them.
  // Before that join, for the same reason the import-type rows are.
  const visitImportTags = (node: ts.Node): void => {
    for (const tag of jsDocTagsOfAllBlocks(node)) {
      if (ts.isJSDocImportTag(tag)) {
        moduleEdges.emitJsDocImportTag(tag);
      }
    }
    ts.forEachChild(node, visitImportTags);
  };
  visitImportTags(sourceFile);
  for (const reference of jsdoc.typeReferences) {
    if (linkedByImportType.has(reference)) {
      continue;
    }
    // `@param {ns.Thing}`: the import binds the ROOT of a qualified name, as it
    // does for `extends ns.Base`; the member is the engine's to look up.
    const importRow = moduleEdges.importBinding(reference.typeName.split('.')[0]!,
      offsetOfRow(sourceFile, reference.startLine, reference.startColumn));
    if (importRow === undefined) {
      continue;
    }
    reference.setImportLinkHash(importRow.getHash());
    reference.setResolvedFilePath(importRow.resolvedFilePath);
  }

  // What the parser could not do, derived from the rows it emitted. Last,
  // because it reads every other relation — which is what makes a gap row exist
  // exactly when the fact it describes is in the relation it names.
  const parseGaps = extractParseGaps({
    sourceFile,
    moduleHash: fileModuleHash,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    imports: moduleEdges.imports,
    typeReferences: jsdoc.typeReferences,
    expressions: expressions.expressions,
    callSites: expressions.callSites,
    scopes: scopes.scopes,
    hasFlowPragma: moduleResult.shape.hasFlowPragma,
    isStrictModeFile: binder.moduleScope.isStrictMode,
  });

  return {
    modules: [moduleResult.module],
    scopes: scopes.scopes,
    types: declarations.types,
    heritages: declarations.heritages,
    methods: declarations.methods,
    methodParameters: declarations.methodParameters,
    fields: declarations.fields,
    variables: declarations.variables,
    blocks: declarations.blocks,
    expressions: expressions.expressions,
    callSites: expressions.callSites,
    imports: moduleEdges.imports,
    exports: moduleEdges.exports,
    comments: comments.comments,
    typeReferences: jsdoc.typeReferences,
    parseGaps,
    declarations,
    expressionExtractor: expressions,
    shape: moduleResult.shape,
    binder,
    sourceFile,
    fileModuleHash,
    filePath: options.filePath,
  };
}

/**
 * The `JSDoc` block a tag belongs to.
 *
 * A tag's own `.parent` is the block; the block's parent is the node the comment
 * documents. Asking the tag rather than walking from a declaration is what
 * reaches a block at end of file, which attaches to the EOF token and belongs to
 * no declaration at all.
 */
function containerOf(tag: ts.Node): ts.Node | undefined {
  let current: ts.Node | undefined = tag;
  while (current !== undefined && current.kind !== ts.SyntaxKind.JSDoc) {
    current = current.parent;
  }
  return current;
}

/** Kept so a caller can name the file without re-deriving it from the path. */
export function fileNameOf(filePath: string): string {
  return path.basename(filePath);
}

/**
 * A row's own byte offset, from the position it already carries.
 *
 * Every row records `startLine`/`startColumn`, so resolving a name AT a row
 * needs no extra threading — and a name must be resolved at a position, because
 * a module that binds `paint` twice gives references before and after the second
 * binding different answers.
 *
 * 1-based on both axes in the fact base, 0-based in the compiler API.
 */
function offsetOfRow(sourceFile: ts.SourceFile, line: number, column: number): number {
  try {
    return sourceFile.getPositionOfLineAndCharacter(
      Math.max(0, line - 1), Math.max(0, column - 1)
    );
  } catch {
    // A position past the end of the file cannot be converted. Returning 0 means
    // "before everything", which selects the first binding — the same answer the
    // old last-wins map would never have given, and the safe one.
    return 0;
  }
}
