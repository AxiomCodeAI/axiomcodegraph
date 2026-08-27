import * as ts from 'typescript';

import { TsBlockRegistry } from '@/analysis-types/typescript/TsBlockRegistry';
import { TsFieldRegistry } from '@/analysis-types/typescript/TsFieldRegistry';
import { TsMethodParameterRegistry } from '@/analysis-types/typescript/TsMethodParameterRegistry';
import { TsMethodRegistry } from '@/analysis-types/typescript/TsMethodRegistry';
import { TsTypeHeritageRegistry } from '@/analysis-types/typescript/TsTypeHeritageRegistry';
import { TsTypeParameterRegistry } from '@/analysis-types/typescript/TsTypeParameterRegistry';
import { TsTypeRegistry } from '@/analysis-types/typescript/TsTypeRegistry';
import { TsVariableRegistry } from '@/analysis-types/typescript/TsVariableRegistry';
import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  TS_ANONYMOUS_METHOD_NAMES,
  TS_MODULE_INITIALIZER_NAME,
} from '@/constants/typescript-constants';
import { TsBlockKind } from '@/enums/typescript/blocks';
import { TsFieldAccess, TsFieldModifier, TsMemberKind } from '@/enums/typescript/fields';
import { TsClauseToken, TsHeritageKind } from '@/enums/typescript/heritage';
import {
  TsDefaultValueKind,
  TsParamKind,
  TsParameterPropertyModifier,
} from '@/enums/typescript/method-parameters';
import {
  TsBodyPresence,
  TsMethodAccess,
  TsMethodKind,
  TsMethodModifier,
  TsSignatureRole,
} from '@/enums/typescript/methods';
import {
  TsTypeParameterOwnerKind,
  TsVarianceAnnotation,
} from '@/enums/typescript/type-parameters';
import {
  TsReferenceOwnerKind,
  TsTypeRefContext,
} from '@/enums/typescript/type-references';
import {
  TsDeclarationSpace,
  TsTypeAccess,
  TsTypeCategory,
  TsTypeModifier,
  TsTypePlacement,
} from '@/enums/typescript/types';
import {
  TsVariableDeclarationKind,
  TsVariableInitializerKind,
  TsVariableScopeKind,
} from '@/enums/typescript/variables';
import { BinderResult, BoundDeclaration, hasModifier, memberName, nodeId } from
  '@/parsers/typescript/extractors/ts-binder';
import {
  qualifiedPathOf,
  simpleNameOf,
  TsTypeReferenceExtractor,
} from '@/parsers/typescript/extractors/ts-type-reference-extractor';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Emits every DECLARATION relation for one source file.
 *
 * This is the Java port: `type-registry-extractor`, `type-method-extractor`,
 * `field-extractor` and `method-parameter-extractor` map across close to 1:1,
 * because TypeScript — like Java and unlike Python — writes its types at the
 * declaration site. 85.3% of parameters carry an annotation, so a syntax-directed
 * walk recovers most of the semantic model from the tree alone.
 *
 * What does NOT port is anything that assumes one declaration per name. Every
 * row here carries the binder's `declarationGroupKey`, and the group key is
 * deliberately not unique.
 */
export interface DeclarationExtractionResult {
  readonly types: readonly TsTypeRegistry[];
  readonly methods: readonly TsMethodRegistry[];
  readonly methodParameters: readonly TsMethodParameterRegistry[];
  readonly fields: readonly TsFieldRegistry[];
  readonly variables: readonly TsVariableRegistry[];
  readonly heritages: readonly TsTypeHeritageRegistry[];
  readonly typeParameters: readonly TsTypeParameterRegistry[];
  readonly blocks: readonly TsBlockRegistry[];
  readonly typeReferenceExtractor: TsTypeReferenceExtractor;
}

/** Where an emission currently is, in the FK sense rather than the lexical one. */
interface EmitContext {
  readonly typeHash: string;
  readonly methodHash: string;
  readonly blockHash: string;
  readonly ownerTypeName: string;
  readonly ownerQualifiedName: string;
  /** Namespace / nested-type path, for qualified names. */
  readonly namePath: readonly string[];
  readonly scopeDepth: number;
  readonly isAmbient: boolean;
  readonly moduleHash: string;
  readonly moduleQualifiedName: string;
}

export interface DeclarationExtractorOptions {
  readonly sourceFile: ts.SourceFile;
  readonly binder: BinderResult;
  readonly filePath: string;
  readonly baseMservPath: string;
  readonly fileName: string;
  readonly moduleHash: string;
  readonly moduleQualifiedName: string;
  readonly isDeclarationFile: boolean;
  readonly serviceVersionLinkHash: string;
  /** For a `declare module "x"` body, the module row that body belongs to. */
  readonly moduleHashForNode: (node: ts.Node) => string;
}

export class TsDeclarationExtractor {
  readonly types: TsTypeRegistry[] = [];
  readonly methods: TsMethodRegistry[] = [];
  readonly methodParameters: TsMethodParameterRegistry[] = [];
  readonly fields: TsFieldRegistry[] = [];
  readonly variables: TsVariableRegistry[] = [];
  readonly heritages: TsTypeHeritageRegistry[] = [];
  readonly typeParameters: TsTypeParameterRegistry[] = [];
  readonly blocks: TsBlockRegistry[] = [];
  readonly typeReferenceExtractor: TsTypeReferenceExtractor;

  /** Emitted hashes by node identity, so later passes never re-derive a key. */
  readonly typeHashByNode = new Map<string, string>();
  readonly methodHashByNode = new Map<string, string>();
  readonly fieldHashByNode = new Map<string, string>();
  readonly variableHashByNode = new Map<string, string>();
  readonly parameterHashByNode = new Map<string, string>();
  readonly blockHashByNode = new Map<string, string>();
  readonly typeParameterHashByNode = new Map<string, string>();
  /** Rows by node identity, for back-patching FKs that only exist later. */
  readonly typeRowByNode = new Map<string, TsTypeRegistry>();
  readonly methodRowByNode = new Map<string, TsMethodRegistry>();
  readonly variableRowByNode = new Map<string, TsVariableRegistry>();
  readonly fieldRowByNode = new Map<string, TsFieldRegistry>();
  readonly blockRowByNode = new Map<string, TsBlockRegistry>();
  /** The synthetic `<module>` initializer, owner of top-level executable code. */
  moduleInitMethodHash = '';

  private readonly sf: ts.SourceFile;
  private readonly typeParameterStack: Set<string>[] = [];
  private blockOrder = 0;
  /**
   * Overload sets, keyed by `(owner hash, escaped name, static-ness)`.
   *
   * Collected during the walk and resolved afterwards, because whether a
   * declaration is SOLE or one of N is only knowable once its siblings have all
   * been seen — and the sibling can appear later in the file.
   */
  private readonly overloadSets = new Map<string, { row: TsMethodRegistry; hasBody: boolean }[]>();

  constructor(private readonly options: DeclarationExtractorOptions) {
    this.sf = options.sourceFile;
    this.typeReferenceExtractor = new TsTypeReferenceExtractor(
      this.sf,
      options.serviceVersionLinkHash,
      () => this.typeParametersInScope()
    );
    // A function type is a callable signature as well as a type node, so it
    // gets a `ts_method` row. Minting it here — from inside the type-reference
    // walk — is what guarantees EVERY function type gets one, wherever it was
    // written: an annotation, a type alias RHS, a nested union member, a type
    // argument. Enumerating those positions by hand would miss one.
    this.typeReferenceExtractor.onFunctionType = (node) => {
      this.emitFunctionTypeSignature(node);
    };
    // `[K in keyof T]` and `infer U` declare real type parameters that no
    // declaration walk reaches — they are inside type NODES. Minting them from
    // the type-reference walk is what guarantees every one gets a row, wherever
    // it was written.
    this.typeReferenceExtractor.onTypeLevelParameter = (typeParameter, ownerHash, ownerKind) => {
      this.emitTypeLevelParameter(typeParameter, ownerHash, ownerKind,
        this.options.moduleHash);
    };
  }

  /** Every function type already given a `ts_method` row, so none is minted twice. */
  private readonly functionTypeSignatures = new Set<string>();
  /** Type-alias name -> its RHS node, for `const f: Callback = …; f()`. */
  readonly typeAliasTargetByName = new Map<string, ts.TypeNode>();

  /**
   * Mints the `ts_method` row for a `(a: T) => R` written in type position.
   *
   * `bodyPresence` is NO_BODY_INTERFACE and `isTypeOnly` is true: this
   * declaration can never carry a body under any compiler options, so it must
   * never be read as the code that runs. It is a legitimate call TARGET — 44.3%
   * of real targets are bodiless — and the two facts are not in tension.
   */
  private emitFunctionTypeSignature(
    node: ts.FunctionTypeNode | ts.ConstructorTypeNode
  ): void {
    const id = nodeId(node, this.sf);
    if (this.functionTypeSignatures.has(id)) {
      return;
    }
    this.functionTypeSignatures.add(id);
    const isConstructor = ts.isConstructorTypeNode(node);
    const name = isConstructor
      ? TS_ANONYMOUS_METHOD_NAMES.CONSTRUCTOR_TYPE
      : TS_ANONYMOUS_METHOD_NAMES.FUNCTION_TYPE;
    const startPos = this.sf.getLineAndCharacterOfPosition(node.getStart(this.sf));
    const endPos = this.sf.getLineAndCharacterOfPosition(node.end);
    const restIndex = node.parameters.findIndex((p) => p.dotDotDotToken !== undefined);
    const row = new TsMethodRegistry({
      name,
      signature: signatureOf(name, node.parameters, this.sf),
      detailedSignature: detailedSignatureOf(name, node.parameters, node.type, this.sf),
      qualifiedName: `${this.options.moduleQualifiedName}#${name}@${startPos.line + 1}:${startPos.character + 1}`,
      filePath: this.options.filePath,
      startLine: startPos.line + 1,
      endLine: endPos.line + 1,
      tsTypeLinkHash: '',
      ownerTypeName: '',
      ownerQualifiedName: this.options.moduleQualifiedName,
      methodAccess: TsMethodAccess.PUBLIC_ACCESS,
      methodModifiers: new Set(),
      returnTypeName: node.type
        ? EntityUtils.normalizeWhitespace(node.type.getText(this.sf))
        : '',
      isVarArgs: restIndex >= 0,
      hasReceiverParameter: false,
      methodKind: isConstructor
        ? TsMethodKind.CONSTRUCTOR_TYPE_SIGNATURE
        : TsMethodKind.FUNCTION_TYPE_SIGNATURE,
      parameterCount: node.parameters.length,
      hasTypeParameters: (node.typeParameters?.length ?? 0) > 0,
      throwsExceptions: new Set(),
      enclosingMemberLinkHash: '',
      tsModuleLinkHash: this.options.moduleHash,
      declarationGroupKey: '',
      mergeScopeKey: '',
      escapedName: name,
      signatureRole: TsSignatureRole.SOLE,
      overloadIndex: 0,
      bodyPresence: TsBodyPresence.NO_BODY_INTERFACE,
      isTypeOnly: true,
      isAsync: false,
      isGenerator: false,
      isAbstract: false,
      isStatic: false,
      optionalParameterCount: node.parameters.filter((p) => p.questionToken !== undefined).length,
      restParameterIndex: restIndex >= 0 ? restIndex : undefined,
      typeParameterCount: node.typeParameters?.length ?? 0,
      thisParameterTypeName: '',
      isTypePredicateReturn: node.type !== undefined && ts.isTypePredicateNode(node.type),
      startColumn: startPos.character + 1,
      endColumn: endPos.character + 1,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.methods.push(row);
    this.methodHashByNode.set(id, row.getHash());
    this.methodRowByNode.set(id, row);
    // A function type can be generic: `<T>(x: T) => T`. Its parameters belong to
    // this signature row, with METHOD_TYPE_PARAM_BOUND bounds like any other
    // function-shaped declaration's.
    this.emitTypeParameters(node.typeParameters, row.getHash(),
      isConstructor
        ? TsTypeParameterOwnerKind.CONSTRUCT_SIGNATURE
        : TsTypeParameterOwnerKind.FUNCTION,
      {
        typeHash: '',
        methodHash: row.getHash(),
        blockHash: '',
        ownerTypeName: '',
        ownerQualifiedName: this.options.moduleQualifiedName,
        namePath: [],
        scopeDepth: 0,
        isAmbient: true,
        moduleHash: this.options.moduleHash,
        moduleQualifiedName: this.options.moduleQualifiedName,
      },
      TsTypeRefContext.METHOD_TYPE_PARAM_BOUND);
  }

  run(): void {
    const rootContext: EmitContext = {
      typeHash: '',
      methodHash: '',
      blockHash: '',
      ownerTypeName: '',
      ownerQualifiedName: this.options.moduleQualifiedName,
      namePath: [],
      scopeDepth: 0,
      isAmbient: this.options.isDeclarationFile,
      moduleHash: this.options.moduleHash,
      moduleQualifiedName: this.options.moduleQualifiedName,
    };
    // The `<module>` initializer is minted first and unconditionally. Top-level
    // executable statements need an owner, and inventing one lazily would make
    // a file with no top-level code structurally different from one with it.
    this.moduleInitMethodHash = this.emitModuleInitializer(rootContext);
    const withInit: EmitContext = { ...rootContext, methodHash: this.moduleInitMethodHash };
    for (const statement of this.sf.statements) {
      this.visitStatement(statement, withInit);
    }
    this.assignOverloadIdentities();
  }

  // -------------------------------------------------------------------------
  // statements
  // -------------------------------------------------------------------------

  private visitStatement(node: ts.Statement, context: EmitContext): void {
    switch (node.kind) {
      case ts.SyntaxKind.ClassDeclaration: {
        this.emitClassLike(node as ts.ClassDeclaration, context, TsTypeCategory.CLASS_TYPE);
        return;
      }
      case ts.SyntaxKind.InterfaceDeclaration: {
        this.emitInterface(node as ts.InterfaceDeclaration, context);
        return;
      }
      case ts.SyntaxKind.TypeAliasDeclaration: {
        this.emitTypeAlias(node as ts.TypeAliasDeclaration, context);
        return;
      }
      case ts.SyntaxKind.EnumDeclaration: {
        this.emitEnum(node as ts.EnumDeclaration, context);
        return;
      }
      case ts.SyntaxKind.ModuleDeclaration: {
        this.emitModuleDeclaration(node as ts.ModuleDeclaration, context);
        return;
      }
      case ts.SyntaxKind.FunctionDeclaration: {
        this.emitFunctionLike(node as ts.FunctionDeclaration, context,
          TsMethodKind.FUNCTION_DECLARATION);
        return;
      }
      case ts.SyntaxKind.VariableStatement: {
        this.emitVariableStatement(node as ts.VariableStatement, context);
        return;
      }
      case ts.SyntaxKind.Block: {
        const block = this.emitBlock(node as ts.Block, TsBlockKind.BARE_BLOCK, context, '');
        const inner = { ...context, blockHash: block, scopeDepth: context.scopeDepth + 1 };
        for (const statement of (node as ts.Block).statements) {
          this.visitStatement(statement, inner);
        }
        return;
      }
      case ts.SyntaxKind.IfStatement: {
        this.emitIfStatement(node as ts.IfStatement, context);
        return;
      }
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement: {
        this.emitLoop(node as ts.IterationStatement, context);
        return;
      }
      case ts.SyntaxKind.TryStatement: {
        this.emitTryStatement(node as ts.TryStatement, context);
        return;
      }
      case ts.SyntaxKind.SwitchStatement: {
        this.emitSwitch(node as ts.SwitchStatement, context);
        return;
      }
      case ts.SyntaxKind.LabeledStatement: {
        this.visitStatement((node as ts.LabeledStatement).statement, context);
        return;
      }
      default: {
        // Expression statements, returns, throws and the rest carry no
        // declarations of their own; the expression extractor owns them.
        this.visitNestedFunctionsAndClasses(node, context);
        return;
      }
    }
  }

  /**
   * Descends into a statement looking only for function- and class-shaped
   * declarations.
   *
   * Arrows and function expressions are `ts_method` rows, not expression detail
   * — 703 arrows measured, 161 of them resolved call targets — so they must be
   * reached even when they are buried inside an expression the declaration
   * extractor otherwise ignores.
   */
  private visitNestedFunctionsAndClasses(node: ts.Node, context: EmitContext): void {
    ts.forEachChild(node, (child) => {
      if (ts.isFunctionExpression(child)) {
        this.emitFunctionLike(child, context, TsMethodKind.FUNCTION_EXPRESSION);
        return;
      }
      if (ts.isArrowFunction(child)) {
        this.emitFunctionLike(child, context, TsMethodKind.ARROW_FUNCTION);
        return;
      }
      if (ts.isClassExpression(child)) {
        this.emitClassLike(child, context, TsTypeCategory.CLASS_EXPRESSION_TYPE);
        return;
      }
      // An object-literal method is a function-shaped declaration with a body,
      // and it is callable — `jobUtils.format(job)`. It is reached only through
      // this generic descent, because it is not a class member and not an
      // initialiser. Missing it loses every call INSIDE those bodies as well as
      // the method row itself.
      if (child.parent && ts.isObjectLiteralExpression(child.parent)) {
        if (ts.isMethodDeclaration(child)) {
          this.emitFunctionLike(child, context, TsMethodKind.OBJECT_LITERAL_METHOD);
          return;
        }
        if (ts.isGetAccessor(child)) {
          this.emitFunctionLike(child, context, TsMethodKind.GETTER);
          return;
        }
        if (ts.isSetAccessor(child)) {
          this.emitFunctionLike(child, context, TsMethodKind.SETTER);
          return;
        }
      }
      this.visitNestedFunctionsAndClasses(child, context);
    });
  }

  // -------------------------------------------------------------------------
  // types
  // -------------------------------------------------------------------------

  private emitClassLike(
    node: ts.ClassLikeDeclaration,
    context: EmitContext,
    category: TsTypeCategory
  ): string {
    const row = this.emitTypeRow(node, context, category, new Set([
      TsDeclarationSpace.TYPE,
      TsDeclarationSpace.VALUE,
    ]));
    if (!row) {
      return '';
    }
    const inner = this.contextForType(row, node, context);
    this.pushTypeParameters(node.typeParameters);
    this.emitTypeParameters(node.typeParameters, row.getHash(),
      TsTypeParameterOwnerKind.CLASS, inner, TsTypeRefContext.TYPE_PARAM_BOUND);
    this.emitHeritage(node, row, context);

    let memberCount = 0;
    let requiredMemberCount = 0;
    let hasIndexSignature = false;
    const shapeParts: string[] = [];
    for (const member of node.members) {
      const summary = this.emitClassMember(member, inner, row);
      if (summary) {
        memberCount += 1;
        if (!summary.isOptional) {
          requiredMemberCount += 1;
        }
        if (summary.isIndexSignature) {
          hasIndexSignature = true;
        }
        shapeParts.push(summary.shapePart);
      }
    }
    row.setShape(memberCount, requiredMemberCount, shapeDigestOf(shapeParts));
    if (hasIndexSignature) {
      this.indexSignatureOwners.add(row.getHash());
    }
    this.popTypeParameters();
    return row.getHash();
  }

  private emitInterface(node: ts.InterfaceDeclaration, context: EmitContext): void {
    const row = this.emitTypeRow(node, context, TsTypeCategory.INTERFACE_TYPE,
      new Set([TsDeclarationSpace.TYPE]));
    if (!row) {
      return;
    }
    const inner = this.contextForType(row, node, context);
    this.pushTypeParameters(node.typeParameters);
    this.emitTypeParameters(node.typeParameters, row.getHash(),
      TsTypeParameterOwnerKind.INTERFACE, inner, TsTypeRefContext.TYPE_PARAM_BOUND);
    this.emitHeritage(node, row, context);

    let memberCount = 0;
    let requiredMemberCount = 0;
    let hasIndexSignature = false;
    const shapeParts: string[] = [];
    for (const member of node.members) {
      const summary = this.emitTypeMember(member, inner, row);
      if (summary) {
        memberCount += 1;
        if (!summary.isOptional) {
          requiredMemberCount += 1;
        }
        if (summary.isIndexSignature) {
          hasIndexSignature = true;
        }
        shapeParts.push(summary.shapePart);
      }
    }
    row.setShape(memberCount, requiredMemberCount, shapeDigestOf(shapeParts));
    if (hasIndexSignature) {
      this.indexSignatureOwners.add(row.getHash());
    }
    this.popTypeParameters();
  }

  private emitTypeAlias(node: ts.TypeAliasDeclaration, context: EmitContext): void {
    const row = this.emitTypeRow(node, context, TsTypeCategory.TYPE_ALIAS_TYPE,
      new Set([TsDeclarationSpace.TYPE]));
    if (!row) {
      return;
    }
    // `type Callback = (v: string) => number` makes the alias NAME a call
    // target: tsc resolves a call on a `Callback`-annotated variable to this
    // RHS signature. Recorded by name so the resolver can make that hop
    // without re-walking the tree.
    this.typeAliasTargetByName.set(row.name, node.type);
    this.pushTypeParameters(node.typeParameters);
    this.emitTypeParameters(node.typeParameters, row.getHash(),
      TsTypeParameterOwnerKind.TYPE_ALIAS, this.contextForType(row, node, context),
      TsTypeRefContext.TYPE_PARAM_BOUND);
    // The RHS hangs off `aliasTargetReferenceLinkHash` into the type-reference
    // tree. A type alias gets a `ts_type` row because it is a named declaration
    // that merges and can be extended — 2,491 measured — but it gets no path
    // into `ts_call_site`, and this FK is the only edge it has.
    const target = this.typeReferenceExtractor.extract(node.type, TsTypeRefContext.TYPE_ALIAS_RHS, {
      ownerHash: row.getHash(),
      ownerKind: TsReferenceOwnerKind.TYPE,
      tsTypeLinkHash: row.getHash(),
      tsModuleLinkHash: context.moduleHash,
    });
    row.setAliasTargetReferenceLinkHash(target);
    row.setShape(0, 0, shapeDigestOf([]));
    this.popTypeParameters();
  }

  private emitEnum(node: ts.EnumDeclaration, context: EmitContext): void {
    const isConst = hasModifier(node, ts.SyntaxKind.ConstKeyword);
    const row = this.emitTypeRow(
      node,
      context,
      isConst ? TsTypeCategory.CONST_ENUM_TYPE : TsTypeCategory.ENUM_TYPE,
      new Set([TsDeclarationSpace.NAMESPACE, TsDeclarationSpace.TYPE, TsDeclarationSpace.VALUE])
    );
    if (!row) {
      return;
    }
    // `ts_enum_member` is in the second freeze, so members are counted into the
    // shape but not emitted as rows. Counting them keeps `memberCount` honest
    // rather than reporting an enum as an empty shape, which would make it a
    // structural-satisfaction candidate for everything.
    row.setShape(node.members.length, node.members.length,
      shapeDigestOf(node.members.map((m) => `${memberName(m) ?? ''}:ENUM_MEMBER:0:false`)));
  }

  private emitModuleDeclaration(node: ts.ModuleDeclaration, context: EmitContext): void {
    const body = node.body;
    if (ts.isStringLiteral(node.name) || (node.flags & ts.NodeFlags.GlobalAugmentation) !== 0) {
      // An ambient module or `declare global`.
      //
      // It gets BOTH rows, and they are not duplicates. The `ts_module` row says
      // "this is an importable namespace and a merge TABLE"; this `ts_type` row
      // says "this is a declaration SITE of a symbol that merges", which is what
      // carries the `declarationGroupKey`. Two files declaring
      // `declare module "*.svg"` are one symbol, and two files augmenting the
      // same module are too — and only a row with a group key can express that.
      // Without it the partition is missing every ambient module declaration,
      // which on the fixture corpus is six sites tsc counts and the fact base
      // would not.
      this.emitTypeRow(node, context, TsTypeCategory.NAMESPACE_TYPE, undefined)
        ?.setShape(0, 0, shapeDigestOf([]));
      if (body && ts.isModuleBlock(body)) {
        const inner: EmitContext = {
          ...context,
          moduleHash: this.options.moduleHashForNode(node),
          isAmbient: true,
          namePath: [],
        };
        for (const statement of body.statements) {
          this.visitStatement(statement, inner);
        }
      }
      return;
    }

    const row = this.emitTypeRow(node, context, TsTypeCategory.NAMESPACE_TYPE, undefined);
    if (!row) {
      return;
    }
    row.setShape(0, 0, shapeDigestOf([]));
    if (!body) {
      return;
    }
    const inner: EmitContext = {
      ...context,
      typeHash: row.getHash(),
      ownerTypeName: row.name,
      ownerQualifiedName: row.qualifiedName,
      namePath: [...context.namePath, row.name],
      isAmbient: context.isAmbient || hasModifier(node, ts.SyntaxKind.DeclareKeyword),
    };
    if (ts.isModuleDeclaration(body)) {
      // `namespace A.B.C {}` nests one namespace per dotted segment.
      this.emitModuleDeclaration(body, inner);
      return;
    }
    if (!ts.isModuleBlock(body)) {
      return;
    }
    for (const statement of body.statements) {
      this.visitStatement(statement, inner);
    }
  }

  /** Owners that declare an index signature, so `hasIndexSignature` can be set after members. */
  private readonly indexSignatureOwners = new Set<string>();

  private emitTypeRow(
    node: ts.NamedDeclaration,
    context: EmitContext,
    category: TsTypeCategory,
    spacesOverride: ReadonlySet<TsDeclarationSpace> | undefined
  ): TsTypeRegistry | undefined {
    const binding = this.options.binder.bindingByNode.get(nodeId(node, this.sf));
    const start = node.getStart(this.sf);
    const startPos = this.sf.getLineAndCharacterOfPosition(start);
    const endPos = this.sf.getLineAndCharacterOfPosition(node.end);
    const name = binding?.name
      ?? (node.name && ts.isIdentifier(node.name) ? node.name.text : '');
    // A class EXPRESSION has no binding — it declares nothing in any table — so
    // its merge key is its own byte range. It cannot merge with anything, which
    // is correct: two `class {}` expressions are two types even with one name.
    const mergeScopeKey = binding?.mergeScopeKey
      ?? `LOCALS:${EntityUtils.generateEntityHash(ENTITY_IDENTIFIERS.TS_DECLARATION_GROUP,
        `EXPR||${context.moduleHash}||${start}||${node.end}`)}`;
    const escapedName = binding?.escapedName ?? name;
    const groupKey = binding?.declarationGroupKey
      ?? EntityUtils.generateEntityHash(ENTITY_IDENTIFIERS.TS_DECLARATION_GROUP,
        `${mergeScopeKey}||${escapedName}`);
    const spaces = spacesOverride ?? binding?.declarationSpaces ?? new Set<TsDeclarationSpace>();
    const isAmbient = context.isAmbient || hasModifier(node, ts.SyntaxKind.DeclareKeyword);
    const dotted = [...context.namePath, name].filter((p) => p !== '').join('.');

    const row = new TsTypeRegistry({
      name,
      qualifiedName: `${context.moduleQualifiedName}#${dotted}`,
      fileName: this.options.fileName,
      typeCategory: category,
      typeAccess: typeAccessOf(node, binding),
      typeModifiers: typeModifiersOf(node),
      typePlacement: placementOf(node, context),
      filePath: this.options.filePath,
      baseMservPath: this.options.baseMservPath,
      startLine: startPos.line + 1,
      endLine: endPos.line + 1,
      tsModuleLinkHash: context.moduleHash,
      enclosingTypeLinkHash: context.typeHash,
      enclosingMethodLinkHash: context.typeHash === '' ? context.methodHash : '',
      declarationGroupKey: groupKey,
      mergeScopeKey,
      escapedName,
      declarationSpaces: spaces,
      isAmbientDeclaration: isAmbient,
      // The hard column of §3.3: an interface and a type alias have no runtime
      // entity, so no call-graph rule may traverse these rows.
      isTypeOnly: category === TsTypeCategory.INTERFACE_TYPE
        || category === TsTypeCategory.TYPE_ALIAS_TYPE,
      typeParameterCount: (node as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> })
        .typeParameters?.length ?? 0,
      heritageCount: heritageCountOf(node),
      isExported: binding?.isExported ?? false,
      hasIndexSignature: false,
      startColumn: startPos.character + 1,
      endColumn: endPos.character + 1,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.types.push(row);
    this.typeHashByNode.set(nodeId(node, this.sf), row.getHash());
    this.typeRowByNode.set(nodeId(node, this.sf), row);
    return row;
  }

  private contextForType(
    row: TsTypeRegistry,
    node: ts.Node,
    context: EmitContext
  ): EmitContext {
    return {
      ...context,
      typeHash: row.getHash(),
      methodHash: '',
      ownerTypeName: row.name,
      ownerQualifiedName: row.qualifiedName,
      namePath: [...context.namePath, row.name].filter((p) => p !== ''),
      isAmbient: context.isAmbient || hasModifier(node, ts.SyntaxKind.DeclareKeyword),
    };
  }

  // -------------------------------------------------------------------------
  // heritage
  // -------------------------------------------------------------------------

  private emitHeritage(
    node: ts.ClassLikeDeclaration | ts.InterfaceDeclaration,
    owner: TsTypeRegistry,
    context: EmitContext
  ): void {
    for (const clause of node.heritageClauses ?? []) {
      const isExtends = clause.token === ts.SyntaxKind.ExtendsKeyword;
      const clauseToken = isExtends ? TsClauseToken.EXTENDS : TsClauseToken.IMPLEMENTS;
      let position = 0;
      for (const type of clause.types) {
        const isNameShaped = ts.isIdentifier(type.expression)
          || ts.isPropertyAccessExpression(type.expression);
        const kind = !isExtends
          ? TsHeritageKind.IMPLEMENTS_CLAUSE
          : isNameShaped
            ? (ts.isInterfaceDeclaration(node)
              ? TsHeritageKind.EXTENDS_INTERFACE
              : TsHeritageKind.EXTENDS_CLASS)
            // `class C extends mixin(Base) {}` — a computed base. The parser
            // cannot name it, and says so rather than guessing at the callee.
            : TsHeritageKind.EXTENDS_EXPRESSION;
        const startPos = this.sf.getLineAndCharacterOfPosition(type.getStart(this.sf));
        const heritage = new TsTypeHeritageRegistry({
          heritageKind: kind,
          clauseToken,
          position,
          heritageText: EntityUtils.normalizeWhitespace(type.getText(this.sf)),
          heritageSimpleName: simpleNameOf(type),
          heritageQualifiedPath: qualifiedPathOf(type, this.sf),
          typeArgumentCount: type.typeArguments?.length ?? 0,
          // The column Java does not need. `extends` really does inherit
          // members; `implements` asserts and inherits NOTHING, and 60.4% of
          // classes satisfy their interfaces with no clause at all.
          inheritsMembers: isExtends,
          tsTypeLinkHash: owner.getHash(),
          tsModuleLinkHash: context.moduleHash,
          isDynamic: kind === TsHeritageKind.EXTENDS_EXPRESSION,
          startLine: startPos.line + 1,
          startColumn: startPos.character + 1,
          serviceVersionLinkHash: this.options.serviceVersionLinkHash,
        });
        // Every entry also mints a type-reference twin, so heritage names
        // resolve through the same name-to-type machinery as everything else
        // and this relation adds only ordering and `inheritsMembers`.
        heritage.setTsTypeReferenceLinkHash(
          this.typeReferenceExtractor.extract(
            type,
            isExtends ? TsTypeRefContext.SUPER_TYPE : TsTypeRefContext.IMPLEMENTS_INTERFACE,
            {
              ownerHash: heritage.getHash(),
              ownerKind: TsReferenceOwnerKind.HERITAGE,
              tsTypeLinkHash: owner.getHash(),
              tsModuleLinkHash: context.moduleHash,
            }
          )
        );
        this.heritages.push(heritage);
        position += 1;
      }
    }
  }

  // -------------------------------------------------------------------------
  // members
  // -------------------------------------------------------------------------

  private emitClassMember(
    member: ts.ClassElement,
    context: EmitContext,
    owner: TsTypeRegistry
  ): MemberSummary | undefined {
    if (ts.isPropertyDeclaration(member)) {
      const isAccessor = hasModifier(member, ts.SyntaxKind.AccessorKeyword);
      return this.emitField(member, context, owner,
        isAccessor ? TsMemberKind.AUTO_ACCESSOR : TsMemberKind.PROPERTY_DECLARATION);
    }
    if (ts.isIndexSignatureDeclaration(member)) {
      return this.emitField(member, context, owner, TsMemberKind.INDEX_SIGNATURE);
    }
    if (ts.isMethodDeclaration(member)) {
      const hash = this.emitFunctionLike(member, context, TsMethodKind.METHOD_DECLARATION);
      return methodSummary(member, hash);
    }
    if (ts.isConstructorDeclaration(member)) {
      this.emitFunctionLike(member, context, TsMethodKind.CONSTRUCTOR);
      return undefined;
    }
    if (ts.isGetAccessor(member)) {
      const hash = this.emitFunctionLike(member, context, TsMethodKind.GETTER);
      return methodSummary(member, hash);
    }
    if (ts.isSetAccessor(member)) {
      const hash = this.emitFunctionLike(member, context, TsMethodKind.SETTER);
      return methodSummary(member, hash);
    }
    if (ts.isClassStaticBlockDeclaration(member)) {
      this.emitFunctionLike(member, context, TsMethodKind.CLASS_STATIC_BLOCK);
      return undefined;
    }
    return undefined;
  }

  private emitTypeMember(
    member: ts.TypeElement,
    context: EmitContext,
    owner: TsTypeRegistry
  ): MemberSummary | undefined {
    if (ts.isPropertySignature(member)) {
      return this.emitField(member, context, owner, TsMemberKind.PROPERTY_SIGNATURE);
    }
    if (ts.isIndexSignatureDeclaration(member)) {
      return this.emitField(member, context, owner, TsMemberKind.INDEX_SIGNATURE);
    }
    if (ts.isMethodSignature(member)) {
      const hash = this.emitFunctionLike(member, context, TsMethodKind.METHOD_SIGNATURE);
      return methodSummary(member, hash);
    }
    if (ts.isCallSignatureDeclaration(member)) {
      this.emitFunctionLike(member, context, TsMethodKind.CALL_SIGNATURE);
      return undefined;
    }
    if (ts.isConstructSignatureDeclaration(member)) {
      this.emitFunctionLike(member, context, TsMethodKind.CONSTRUCT_SIGNATURE);
      return undefined;
    }
    return undefined;
  }

  private emitField(
    node: ts.PropertyDeclaration | ts.PropertySignature | ts.IndexSignatureDeclaration,
    context: EmitContext,
    owner: TsTypeRegistry,
    memberKind: TsMemberKind
  ): MemberSummary {
    const isIndexSignature = memberKind === TsMemberKind.INDEX_SIGNATURE;
    const name = isIndexSignature ? '' : memberName(node) ?? '';
    const annotation = (node as { type?: ts.TypeNode }).type;
    const isOptional = (node as { questionToken?: ts.QuestionToken }).questionToken !== undefined;
    const isStatic = hasModifier(node, ts.SyntaxKind.StaticKeyword);
    const start = node.getStart(this.sf);
    const startPos = this.sf.getLineAndCharacterOfPosition(start);
    const endPos = this.sf.getLineAndCharacterOfPosition(node.end);
    const typeName = annotation
      ? EntityUtils.normalizeWhitespace(annotation.getText(this.sf))
      : '';

    const row = new TsFieldRegistry({
      name,
      fieldTypeName: typeName,
      fieldBaseType: baseTypeOf(typeName),
      potentialQualifiedName: '',
      isAmbiguous: false,
      filePath: this.options.filePath,
      startLine: startPos.line + 1,
      endLine: endPos.line + 1,
      tsTypeLinkHash: owner.getHash(),
      ownerTypeName: owner.name,
      ownerQualifiedName: owner.qualifiedName,
      fieldAccess: fieldAccessOf(node),
      fieldModifiers: fieldModifiersOf(node, isOptional),
      memberKind,
      tsModuleLinkHash: context.moduleHash,
      // Load-bearing for structural satisfaction: an ABSENT optional member
      // does not break assignability, so a satisfaction rule that ignores this
      // column rejects classes that legitimately satisfy an interface.
      isOptional,
      hasDefiniteAssignment:
        (node as { exclamationToken?: ts.ExclamationToken }).exclamationToken !== undefined,
      isReadonly: hasModifier(node, ts.SyntaxKind.ReadonlyKeyword),
      isStatic,
      indexKeyTypeName: isIndexSignature
        ? indexKeyTypeNameOf(node as ts.IndexSignatureDeclaration, this.sf)
        : '',
      isTypeOnly: memberKind === TsMemberKind.PROPERTY_SIGNATURE,
      // The member's identity ACROSS a merged owner, so a property declared in
      // a module augmentation joins the same member as one declared in the
      // original interface.
      memberGroupKey: EntityUtils.generateEntityHash(
        ENTITY_IDENTIFIERS.TS_DECLARATION_GROUP,
        `${owner.declarationGroupKey}||${name}||${isStatic}`
      ),
      startColumn: startPos.character + 1,
      endColumn: endPos.character + 1,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.fields.push(row);
    this.fieldHashByNode.set(nodeId(node, this.sf), row.getHash());
    this.fieldRowByNode.set(nodeId(node, this.sf), row);

    if (annotation) {
      row.setTypeReferenceLinkHash(
        this.typeReferenceExtractor.extract(annotation, TsTypeRefContext.FIELD_TYPE, {
          ownerHash: row.getHash(),
          ownerKind: TsReferenceOwnerKind.FIELD,
          tsTypeLinkHash: owner.getHash(),
          tsModuleLinkHash: context.moduleHash,
        })
      );
    }
    // A property initialiser can carry an arrow, and an arrow can be a call
    // target, so the walk continues rather than stopping at the field row.
    const initializer = (node as { initializer?: ts.Expression }).initializer;
    if (initializer) {
      this.visitNestedFunctionsAndClasses(node, context);
    }
    return {
      isOptional,
      isIndexSignature,
      shapePart: `${name}:${memberKind}:0:${isOptional}`,
    };
  }

  // -------------------------------------------------------------------------
  // functions
  // -------------------------------------------------------------------------

  private emitModuleInitializer(context: EmitContext): string {
    const endPos = this.sf.getLineAndCharacterOfPosition(this.sf.end);
    const row = new TsMethodRegistry({
      name: TS_MODULE_INITIALIZER_NAME,
      signature: `${TS_MODULE_INITIALIZER_NAME}()`,
      detailedSignature: `${TS_MODULE_INITIALIZER_NAME}(): void`,
      qualifiedName: `${context.moduleQualifiedName}#${TS_MODULE_INITIALIZER_NAME}`,
      filePath: this.options.filePath,
      startLine: 1,
      endLine: endPos.line + 1,
      tsTypeLinkHash: '',
      ownerTypeName: '',
      ownerQualifiedName: context.moduleQualifiedName,
      methodAccess: TsMethodAccess.MODULE_LOCAL_ACCESS,
      methodModifiers: new Set(),
      returnTypeName: '',
      isVarArgs: false,
      hasReceiverParameter: false,
      methodKind: TsMethodKind.MODULE_INITIALIZER,
      parameterCount: 0,
      hasTypeParameters: false,
      throwsExceptions: new Set(),
      enclosingMemberLinkHash: '',
      tsModuleLinkHash: context.moduleHash,
      declarationGroupKey: '',
      mergeScopeKey: '',
      escapedName: TS_MODULE_INITIALIZER_NAME,
      signatureRole: TsSignatureRole.SOLE,
      overloadIndex: 0,
      bodyPresence: TsBodyPresence.HAS_BODY,
      isTypeOnly: false,
      isAsync: false,
      isGenerator: false,
      isAbstract: false,
      isStatic: false,
      optionalParameterCount: 0,
      restParameterIndex: undefined,
      typeParameterCount: 0,
      thisParameterTypeName: '',
      isTypePredicateReturn: false,
      startColumn: 1,
      endColumn: endPos.character + 1,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.methods.push(row);
    return row.getHash();
  }

  private emitFunctionLike(
    node: ts.SignatureDeclaration | ts.ClassStaticBlockDeclaration,
    context: EmitContext,
    methodKind: TsMethodKind
  ): string {
    const binding = this.options.binder.bindingByNode.get(nodeId(node, this.sf));
    const start = node.getStart(this.sf);
    const startPos = this.sf.getLineAndCharacterOfPosition(start);
    const endPos = this.sf.getLineAndCharacterOfPosition(node.end);
    const name = methodNameOf(node, methodKind, binding);
    const parameters = ts.isClassStaticBlockDeclaration(node)
      ? ([] as readonly ts.ParameterDeclaration[])
      : node.parameters;
    const typeParameters = ts.isClassStaticBlockDeclaration(node)
      ? undefined
      : node.typeParameters;
    const returnType = ts.isClassStaticBlockDeclaration(node) ? undefined : node.type;
    const body = (node as { body?: ts.Node }).body;
    const isAmbient = context.isAmbient || hasModifier(node, ts.SyntaxKind.DeclareKeyword);

    this.pushTypeParameters(typeParameters);
    const thisParameter = parameters.find(
      (p) => ts.isIdentifier(p.name) && p.name.text === 'this'
    );
    const restIndex = parameters.findIndex((p) => p.dotDotDotToken !== undefined);
    const dotted = [...context.namePath, name].filter((p) => p !== '').join('.');

    const row = new TsMethodRegistry({
      name,
      signature: signatureOf(name, parameters, this.sf),
      // What distinguishes overloads. Two signatures of one name differ only
      // here, so a coarser signature would collapse an overload set into one
      // row and lose the 77.6% of calls that pick a non-first declaration.
      detailedSignature: detailedSignatureOf(name, parameters, returnType, this.sf),
      qualifiedName: `${context.moduleQualifiedName}#${dotted}`,
      filePath: this.options.filePath,
      startLine: startPos.line + 1,
      endLine: endPos.line + 1,
      tsTypeLinkHash: context.typeHash,
      ownerTypeName: context.ownerTypeName,
      ownerQualifiedName: context.ownerQualifiedName,
      methodAccess: methodAccessOf(node, binding),
      methodModifiers: methodModifiersOf(node),
      returnTypeName: returnType
        ? EntityUtils.normalizeWhitespace(returnType.getText(this.sf))
        : '',
      isVarArgs: restIndex >= 0,
      hasReceiverParameter: thisParameter !== undefined,
      methodKind,
      parameterCount: parameters.length,
      hasTypeParameters: (typeParameters?.length ?? 0) > 0,
      throwsExceptions: thrownTypeNamesOf(body, this.sf),
      enclosingMemberLinkHash: context.methodHash,
      tsModuleLinkHash: context.moduleHash,
      declarationGroupKey: binding?.declarationGroupKey ?? '',
      mergeScopeKey: binding?.mergeScopeKey ?? '',
      escapedName: binding?.escapedName ?? name,
      // Provisional. Overload identity needs the whole set, and the sibling
      // signature may come later in the file, so it is assigned after the walk.
      signatureRole: TsSignatureRole.SOLE,
      overloadIndex: 0,
      bodyPresence: bodyPresenceOf(node, methodKind, body !== undefined, isAmbient),
      isTypeOnly: TYPE_ONLY_METHOD_KINDS.has(methodKind),
      isAsync: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
      isGenerator: (node as { asteriskToken?: ts.AsteriskToken }).asteriskToken !== undefined,
      isAbstract: hasModifier(node, ts.SyntaxKind.AbstractKeyword),
      isStatic: hasModifier(node, ts.SyntaxKind.StaticKeyword),
      optionalParameterCount: parameters.filter((p) => p.questionToken !== undefined).length,
      restParameterIndex: restIndex >= 0 ? restIndex : undefined,
      typeParameterCount: typeParameters?.length ?? 0,
      thisParameterTypeName: thisParameter?.type
        ? EntityUtils.normalizeWhitespace(thisParameter.type.getText(this.sf))
        : '',
      isTypePredicateReturn: returnType !== undefined && ts.isTypePredicateNode(returnType),
      startColumn: startPos.character + 1,
      endColumn: endPos.character + 1,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.methods.push(row);
    this.methodHashByNode.set(nodeId(node, this.sf), row.getHash());
    this.methodRowByNode.set(nodeId(node, this.sf), row);
    this.recordOverloadCandidate(row, context, body !== undefined);

    // METHOD_TYPE_PARAM_BOUND, not TYPE_PARAM_BOUND: the split Java makes, kept
    // so a query about method type parameters does not have to join back to the
    // owner to find out what kind it was.
    this.emitTypeParameters(typeParameters, row.getHash(),
      typeParameterOwnerKindFor(methodKind), context,
      TsTypeRefContext.METHOD_TYPE_PARAM_BOUND);
    if (returnType) {
      row.setReturnTypeReferenceLinkHash(
        this.typeReferenceExtractor.extract(returnType, TsTypeRefContext.METHOD_RETURN, {
          ownerHash: row.getHash(),
          ownerKind: TsReferenceOwnerKind.METHOD,
          tsTypeLinkHash: context.typeHash,
          tsModuleLinkHash: context.moduleHash,
        })
      );
    }
    this.emitParameters(parameters, row, context);

    const inner: EmitContext = {
      ...context,
      methodHash: row.getHash(),
      scopeDepth: context.scopeDepth + 1,
      isAmbient,
    };
    if (body && ts.isBlock(body)) {
      const blockKind = methodKind === TsMethodKind.ARROW_FUNCTION
        ? TsBlockKind.ARROW_BODY
        : methodKind === TsMethodKind.CLASS_STATIC_BLOCK
          ? TsBlockKind.STATIC_BLOCK
          : TsBlockKind.FUNCTION_BODY;
      const blockHash = this.emitBlock(body, blockKind, inner, row.getHash());
      const bodyContext = { ...inner, blockHash };
      for (const statement of body.statements) {
        this.visitStatement(statement, bodyContext);
      }
    } else if (body) {
      // A concise arrow body: an expression, so no block row, but it can still
      // contain a nested arrow or class expression.
      this.visitNestedFunctionsAndClasses(body, inner);
    }
    this.popTypeParameters();
    return row.getHash();
  }

  private emitParameters(
    parameters: readonly ts.ParameterDeclaration[],
    method: TsMethodRegistry,
    context: EmitContext
  ): void {
    let position = 0;
    for (const parameter of parameters) {
      const isThis = ts.isIdentifier(parameter.name) && parameter.name.text === 'this';
      const isRest = parameter.dotDotDotToken !== undefined;
      const isOptional = parameter.questionToken !== undefined;
      const propertyModifiers = parameterPropertyModifiersOf(parameter);
      const isParameterProperty = propertyModifiers.size > 0;
      const startPos = this.sf.getLineAndCharacterOfPosition(parameter.getStart(this.sf));
      const endPos = this.sf.getLineAndCharacterOfPosition(parameter.end);
      const typeName = parameter.type
        ? EntityUtils.normalizeWhitespace(parameter.type.getText(this.sf))
        : '';
      const paramKind = isThis
        ? TsParamKind.THIS
        : isParameterProperty
          ? TsParamKind.PARAMETER_PROPERTY
          : isRest
            ? TsParamKind.REST
            : ts.isObjectBindingPattern(parameter.name)
              ? TsParamKind.BINDING_OBJECT
              : ts.isArrayBindingPattern(parameter.name)
                ? TsParamKind.BINDING_ARRAY
                : isOptional
                  ? TsParamKind.OPTIONAL
                  : TsParamKind.REQUIRED;

      const row = new TsMethodParameterRegistry({
        // `""` for a binding pattern: a destructured parameter binds several
        // names and none of them is the parameter's name.
        paramName: ts.isIdentifier(parameter.name) ? parameter.name.text : '',
        position,
        tsMethodLinkHash: method.getHash(),
        parameterBaseType: baseTypeOf(typeName),
        parameterTypeName: typeName,
        potentialQualifiedName: '',
        isAmbiguous: false,
        isVarArgs: isRest,
        isReceiverParameter: isThis,
        startLine: startPos.line + 1,
        endLine: endPos.line + 1,
        paramKind,
        // Changes ARITY MATCHING, so overload selection that compares counts
        // without it selects the wrong signature.
        isOptional: isOptional || parameter.initializer !== undefined,
        hasDefault: parameter.initializer !== undefined,
        defaultValueText: parameter.initializer
          ? EntityUtils.normalizeWhitespace(parameter.initializer.getText(this.sf))
          : '',
        defaultValueKind: defaultValueKindOf(parameter.initializer),
        isParameterProperty,
        parameterPropertyModifiers: propertyModifiers,
        bindingPatternText: ts.isIdentifier(parameter.name)
          ? ''
          : EntityUtils.normalizeWhitespace(parameter.name.getText(this.sf)),
        decoratorCount: (ts.getDecorators(parameter) ?? []).length,
        startColumn: startPos.character + 1,
        serviceVersionLinkHash: this.options.serviceVersionLinkHash,
      });
      this.methodParameters.push(row);
      this.parameterHashByNode.set(nodeId(parameter, this.sf), row.getHash());

      if (parameter.type) {
        row.setTypeReferenceLinkHash(
          this.typeReferenceExtractor.extract(parameter.type, TsTypeRefContext.METHOD_PARAM, {
            ownerHash: row.getHash(),
            ownerKind: TsReferenceOwnerKind.METHOD_PARAM,
            tsTypeLinkHash: context.typeHash,
            tsModuleLinkHash: context.moduleHash,
          })
        );
      }
      if (isParameterProperty) {
        // `constructor(private x: T)` declares a FIELD as well as a parameter.
        // Recorded as a cross-FK rather than a duplicated row, so the field is
        // counted once in the owning type's shape.
        this.emitParameterProperty(parameter, row, context, typeName);
      }
      position += 1;
    }
  }

  private emitParameterProperty(
    parameter: ts.ParameterDeclaration,
    parameterRow: TsMethodParameterRegistry,
    context: EmitContext,
    typeName: string
  ): void {
    const owner = this.typeRowByNode.get(
      nodeId(parameter.parent.parent, this.sf)
    );
    if (!owner) {
      return;
    }
    const startPos = this.sf.getLineAndCharacterOfPosition(parameter.getStart(this.sf));
    const endPos = this.sf.getLineAndCharacterOfPosition(parameter.end);
    const name = ts.isIdentifier(parameter.name) ? parameter.name.text : '';
    const row = new TsFieldRegistry({
      name,
      fieldTypeName: typeName,
      fieldBaseType: baseTypeOf(typeName),
      potentialQualifiedName: '',
      isAmbiguous: false,
      filePath: this.options.filePath,
      startLine: startPos.line + 1,
      endLine: endPos.line + 1,
      tsTypeLinkHash: owner.getHash(),
      ownerTypeName: owner.name,
      ownerQualifiedName: owner.qualifiedName,
      fieldAccess: fieldAccessOf(parameter),
      fieldModifiers: fieldModifiersOf(parameter, parameter.questionToken !== undefined),
      memberKind: TsMemberKind.PARAMETER_PROPERTY,
      tsModuleLinkHash: context.moduleHash,
      isOptional: parameter.questionToken !== undefined,
      hasDefiniteAssignment: false,
      isReadonly: hasModifier(parameter, ts.SyntaxKind.ReadonlyKeyword),
      isStatic: false,
      indexKeyTypeName: '',
      isTypeOnly: false,
      memberGroupKey: EntityUtils.generateEntityHash(
        ENTITY_IDENTIFIERS.TS_DECLARATION_GROUP,
        `${owner.declarationGroupKey}||${name}||false`
      ),
      startColumn: startPos.character + 1,
      endColumn: endPos.character + 1,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    row.setOriginParameterLinkHash(parameterRow.getHash());
    parameterRow.setDeclaredFieldLinkHash(row.getHash());
    this.fields.push(row);
  }

  // -------------------------------------------------------------------------
  // variables
  // -------------------------------------------------------------------------

  private emitVariableStatement(node: ts.VariableStatement, context: EmitContext): void {
    const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
    const isDeclare = hasModifier(node, ts.SyntaxKind.DeclareKeyword);
    for (const declaration of node.declarationList.declarations) {
      this.emitVariable(declaration, node.declarationList, context, isExported,
        isDeclare || context.isAmbient);
    }
  }

  emitVariable(
    declaration: ts.VariableDeclaration,
    list: ts.VariableDeclarationList | undefined,
    context: EmitContext,
    isExported: boolean,
    isAmbient: boolean,
    declarationKindOverride?: TsVariableDeclarationKind
  ): void {
    const binding = this.options.binder.bindingByNode.get(nodeId(declaration, this.sf));
    const startPos = this.sf.getLineAndCharacterOfPosition(declaration.getStart(this.sf));
    const endPos = this.sf.getLineAndCharacterOfPosition(declaration.end);
    const typeName = declaration.type
      ? EntityUtils.normalizeWhitespace(declaration.type.getText(this.sf))
      : '';
    const isDestructuring = !ts.isIdentifier(declaration.name);
    const row = new TsVariableRegistry({
      name: ts.isIdentifier(declaration.name) ? declaration.name.text : '',
      variableTypeName: typeName,
      variableBaseType: baseTypeOf(typeName),
      potentialQualifiedName: '',
      isAmbiguous: false,
      filePath: this.options.filePath,
      startLine: startPos.line + 1,
      endLine: endPos.line + 1,
      scopeKind: variableScopeKindOf(context, declaration),
      scopeDepth: context.scopeDepth,
      isConst: list !== undefined && (list.flags & ts.NodeFlags.Const) !== 0,
      isTypeInferred: declaration.type === undefined,
      tsTypeLinkHash: context.typeHash,
      tsMethodLinkHash: context.methodHash,
      tsModuleLinkHash: context.moduleHash,
      tsBlockLinkHash: context.blockHash,
      declarationKind: declarationKindOverride
        ?? variableDeclarationKindOf(list),
      hasInitializer: declaration.initializer !== undefined,
      initializerKind: initializerKindOf(declaration.initializer),
      isExported,
      isAmbientDeclare: isAmbient,
      isDestructuring,
      declarationGroupKey: binding?.declarationGroupKey ?? '',
      startColumn: startPos.character + 1,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.variables.push(row);
    this.variableHashByNode.set(nodeId(declaration, this.sf), row.getHash());
    this.variableRowByNode.set(nodeId(declaration, this.sf), row);

    if (declaration.type) {
      row.setTypeReferenceLinkHash(
        this.typeReferenceExtractor.extract(declaration.type, TsTypeRefContext.VARIABLE_TYPE, {
          ownerHash: row.getHash(),
          ownerKind: TsReferenceOwnerKind.VARIABLE,
          tsTypeLinkHash: context.typeHash,
          tsModuleLinkHash: context.moduleHash,
        })
      );
    }
    const initializer = declaration.initializer;
    if (!initializer) {
      return;
    }
    // THE link that makes `const f = () => {}; f()` resolvable. 161 measured
    // call targets are arrow functions, and an arrow has no name of its own for
    // a call site to match — it is reached only through the variable.
    if (ts.isArrowFunction(initializer)) {
      row.setBoundFunctionLinkHash(
        this.emitFunctionLike(initializer, context, TsMethodKind.ARROW_FUNCTION)
      );
      return;
    }
    if (ts.isFunctionExpression(initializer)) {
      row.setBoundFunctionLinkHash(
        this.emitFunctionLike(initializer, context, TsMethodKind.FUNCTION_EXPRESSION)
      );
      return;
    }
    if (ts.isClassExpression(initializer)) {
      this.emitClassLike(initializer, context, TsTypeCategory.CLASS_EXPRESSION_TYPE);
      return;
    }
    this.visitNestedFunctionsAndClasses(initializer, context);
  }

  // -------------------------------------------------------------------------
  // blocks
  // -------------------------------------------------------------------------

  private emitBlock(
    node: ts.Node,
    blockKind: TsBlockKind,
    context: EmitContext,
    methodOwnerOverride: string
  ): string {
    const startPos = this.sf.getLineAndCharacterOfPosition(node.getStart(this.sf));
    const endPos = this.sf.getLineAndCharacterOfPosition(node.end);
    const methodOwner = methodOwnerOverride !== '' ? methodOwnerOverride : context.methodHash;
    const row = new TsBlockRegistry({
      blockKind,
      order: this.blockOrder,
      filePath: this.options.filePath,
      startLine: startPos.line + 1,
      endLine: endPos.line + 1,
      startColumn: startPos.character + 1,
      endColumn: endPos.character + 1,
      nestingDepth: context.scopeDepth,
      tsTypeLinkHash: context.typeHash,
      methodOwnerHash: methodOwner,
      parentContainerHash: context.blockHash !== '' ? context.blockHash : methodOwner,
      tryStatementHash: '',
      resourceCount: usingDeclarationCountOf(node),
      // A TypeScript `catch` binding is `unknown` and cannot be typed, so unlike
      // Java there is nothing to put here. Parity slot, not information.
      caughtExceptionTypes: new Set(),
      ownerTypeName: context.ownerTypeName,
      ownerQualifiedName: context.ownerQualifiedName,
      ownerMethodName: '',
      tsModuleLinkHash: context.moduleHash,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.blocks.push(row);
    this.blockOrder += 1;
    this.blockHashByNode.set(nodeId(node, this.sf), row.getHash());
    this.blockRowByNode.set(nodeId(node, this.sf), row);
    return row.getHash();
  }

  private emitIfStatement(node: ts.IfStatement, context: EmitContext): void {
    // The CONDITION, not just the branches. `if (xs.some((e) => e.ok))` puts an
    // arrow in the header, and an arrow is a `ts_method` row whose parameters
    // other passes resolve against. Skipping it left the arrow with no row and
    // `e` resolving to a PARAMETER with an empty hash — a break in the hop chain
    // that no resolution percentage would show, because the OUTER call resolved
    // fine. The IR-completeness measure is what found it.
    this.visitNestedFunctionsAndClasses(node.expression, context);
    this.emitBranch(node.thenStatement, TsBlockKind.IF, context);
    const elseStatement = node.elseStatement;
    if (!elseStatement) {
      return;
    }
    if (ts.isIfStatement(elseStatement)) {
      // `else if` is a nested IfStatement in the AST, and flattening it would
      // lose which guard governs which body.
      this.emitBranch(elseStatement.thenStatement, TsBlockKind.ELSE_IF, context);
      const tail = elseStatement.elseStatement;
      if (tail) {
        this.emitIfTail(tail, context);
      }
      return;
    }
    this.emitBranch(elseStatement, TsBlockKind.ELSE, context);
  }

  private emitIfTail(node: ts.Statement, context: EmitContext): void {
    if (ts.isIfStatement(node)) {
      this.emitIfStatement(node, context);
      return;
    }
    this.emitBranch(node, TsBlockKind.ELSE, context);
  }

  private emitBranch(node: ts.Statement, kind: TsBlockKind, context: EmitContext): void {
    const hash = this.emitBlock(node, kind, context, '');
    const inner = { ...context, blockHash: hash, scopeDepth: context.scopeDepth + 1 };
    if (ts.isBlock(node)) {
      for (const statement of node.statements) {
        this.visitStatement(statement, inner);
      }
      return;
    }
    this.visitStatement(node, inner);
  }

  private emitLoop(node: ts.IterationStatement, context: EmitContext): void {
    const kind = loopBlockKindOf(node);
    const hash = this.emitBlock(node, kind, context, '');
    const inner = { ...context, blockHash: hash, scopeDepth: context.scopeDepth + 1 };
    // Loop HEADERS hold expressions too, and the same reasoning applies as for
    // an `if` condition.
    for (const part of loopHeaderExpressionsOf(node)) {
      this.visitNestedFunctionsAndClasses(part, inner);
    }
    if (ts.isForStatement(node) && node.initializer
      && ts.isVariableDeclarationList(node.initializer)) {
      for (const declaration of node.initializer.declarations) {
        this.emitVariable(declaration, node.initializer, inner, false, context.isAmbient,
          TsVariableDeclarationKind.FOR_INIT);
      }
    }
    if ((ts.isForInStatement(node) || ts.isForOfStatement(node))
      && ts.isVariableDeclarationList(node.initializer)) {
      for (const declaration of node.initializer.declarations) {
        this.emitVariable(declaration, node.initializer, inner, false, context.isAmbient,
          ts.isForOfStatement(node)
            ? TsVariableDeclarationKind.FOR_OF
            : TsVariableDeclarationKind.FOR_IN);
      }
    }
    if (ts.isBlock(node.statement)) {
      for (const statement of node.statement.statements) {
        this.visitStatement(statement, inner);
      }
      return;
    }
    this.visitStatement(node.statement, inner);
  }

  private emitTryStatement(node: ts.TryStatement, context: EmitContext): void {
    const tryHash = this.emitBlock(node.tryBlock, TsBlockKind.TRY, context, '');
    const tryContext = { ...context, blockHash: tryHash, scopeDepth: context.scopeDepth + 1 };
    for (const statement of node.tryBlock.statements) {
      this.visitStatement(statement, tryContext);
    }
    if (node.catchClause) {
      const catchHash = this.emitBlock(node.catchClause, TsBlockKind.CATCH, context, '');
      const catchContext = {
        ...context,
        blockHash: catchHash,
        scopeDepth: context.scopeDepth + 1,
      };
      if (node.catchClause.variableDeclaration) {
        // tsc's node for a catch binding IS a VariableDeclaration, so it is one
        // here too — and it appears in the merge partition as one.
        this.emitVariable(node.catchClause.variableDeclaration, undefined, catchContext, false,
          context.isAmbient, TsVariableDeclarationKind.CATCH);
      }
      for (const statement of node.catchClause.block.statements) {
        this.visitStatement(statement, catchContext);
      }
    }
    if (node.finallyBlock) {
      const finallyHash = this.emitBlock(node.finallyBlock, TsBlockKind.FINALLY, context, '');
      const finallyContext = {
        ...context,
        blockHash: finallyHash,
        scopeDepth: context.scopeDepth + 1,
      };
      for (const statement of node.finallyBlock.statements) {
        this.visitStatement(statement, finallyContext);
      }
    }
  }

  private emitSwitch(node: ts.SwitchStatement, context: EmitContext): void {
    this.visitNestedFunctionsAndClasses(node.expression, context);
    for (const clause of node.caseBlock.clauses) {
      if (ts.isCaseClause(clause)) {
        this.visitNestedFunctionsAndClasses(clause.expression, context);
      }
    }
    for (const clause of node.caseBlock.clauses) {
      const kind = ts.isCaseClause(clause)
        ? TsBlockKind.SWITCH_CASE
        : TsBlockKind.SWITCH_DEFAULT;
      const hash = this.emitBlock(clause, kind, context, '');
      const inner = { ...context, blockHash: hash, scopeDepth: context.scopeDepth + 1 };
      for (const statement of clause.statements) {
        this.visitStatement(statement, inner);
      }
    }
  }

  // -------------------------------------------------------------------------
  // overload identity
  // -------------------------------------------------------------------------

  private recordOverloadCandidate(
    row: TsMethodRegistry,
    context: EmitContext,
    hasBody: boolean
  ): void {
    if (row.escapedName === '') {
      return;
    }
    // Keyed on OWNER plus name plus static-ness. Two methods of one name on the
    // same class, one static and one not, are two members and not an overload
    // set — and a key without static-ness silently merges them.
    const key = `${context.typeHash}||${row.tsModuleLinkHash}||${row.mergeScopeKey}||${row.escapedName}||${row.isStatic}`;
    const existing = this.overloadSets.get(key);
    if (existing) {
      existing.push({ row, hasBody });
    } else {
      this.overloadSets.set(key, [{ row, hasBody }]);
    }
  }

  /**
   * Assigns `signatureRole` and `overloadIndex` once every sibling has been seen.
   *
   * Cannot happen during the walk: whether a declaration is `SOLE` or one of N
   * depends on declarations that may appear later in the file. Safe to
   * back-patch because neither column is in the primary key — which is exactly
   * why the key deliberately excludes them.
   */
  private assignOverloadIdentities(): void {
    for (const set of this.overloadSets.values()) {
      if (set.length === 1) {
        const only = set[0];
        if (!only) {
          continue;
        }
        // A lone bodiless declaration is AMBIENT only when there is no
        // implementation anywhere in source; an interface member is SOLE
        // because there is no set to be one of.
        const role = only.hasBody
          ? TsSignatureRole.SOLE
          : only.row.bodyPresence === TsBodyPresence.NO_BODY_AMBIENT
            ? TsSignatureRole.AMBIENT
            : TsSignatureRole.SOLE;
        only.row.setOverloadIdentity(role, 0);
        continue;
      }
      const anyBody = set.some((entry) => entry.hasBody);
      let index = 0;
      for (const entry of set) {
        const role = entry.hasBody
          ? TsSignatureRole.IMPLEMENTATION
          : anyBody
            ? TsSignatureRole.OVERLOAD_SIGNATURE
            : TsSignatureRole.AMBIENT;
        entry.row.setOverloadIdentity(role, index);
        index += 1;
      }
    }
  }

  // -------------------------------------------------------------------------
  // type parameters
  // -------------------------------------------------------------------------

  private pushTypeParameters(
    typeParameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined
  ): void {
    const names = new Set<string>();
    for (const typeParameter of typeParameters ?? []) {
      names.add(typeParameter.name.text);
    }
    this.typeParameterStack.push(names);
  }

  private popTypeParameters(): void {
    this.typeParameterStack.pop();
  }

  /**
   * Every type parameter name currently in lexical scope.
   *
   * Needed so `T` inside `class Box<T>` becomes a `TYPE_VARIABLE` row and not a
   * `TYPE_REFERENCE` to a type named `T` that does not exist. Without it the
   * resolution layer chases 42,032 phantom names.
   */
  private typeParametersInScope(): ReadonlySet<string> {
    const all = new Set<string>();
    for (const frame of this.typeParameterStack) {
      for (const name of frame) {
        all.add(name);
      }
    }
    return all;
  }

  /**
   * Emits `ts_type_parameter` rows, their BOUNDS and their DEFAULTS.
   *
   * The bound's context is `TYPE_PARAM_BOUND` for a type owner and
   * `METHOD_TYPE_PARAM_BOUND` for a function-shaped one — the same split Java
   * makes, so "every bound on a method type parameter" stays one predicate even
   * though the declaration rows share a relation.
   *
   * `T extends A & B` produces ONE parameter row whose bound is an
   * `INTERSECTION` reference with two `TYPE_ELEMENT` children, rather than two
   * bound rows. That is the tree this schema uses everywhere, and it keeps
   * `A & B` distinguishable from `A | B`, which two flat rows would not.
   */
  private emitTypeParameters(
    typeParameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined,
    ownerHash: string,
    ownerKind: TsTypeParameterOwnerKind,
    context: EmitContext,
    boundContext: TsTypeRefContext
  ): void {
    let position = 0;
    for (const typeParameter of typeParameters ?? []) {
      const startPos = this.sf.getLineAndCharacterOfPosition(typeParameter.getStart(this.sf));
      const row = new TsTypeParameterRegistry({
        paramName: typeParameter.name.text,
        position,
        ownerTypeName: context.ownerTypeName,
        ownerQualifiedName: context.ownerQualifiedName,
        filePath: this.options.filePath,
        startLine: startPos.line + 1,
        tsTypeLinkHash: ownerKind === TsTypeParameterOwnerKind.CLASS
          || ownerKind === TsTypeParameterOwnerKind.INTERFACE
          || ownerKind === TsTypeParameterOwnerKind.TYPE_ALIAS
          ? ownerHash
          : context.typeHash,
        ownerKind,
        ownerLinkHash: ownerHash,
        constraintText: typeParameter.constraint
          ? EntityUtils.normalizeWhitespace(typeParameter.constraint.getText(this.sf))
          : '',
        defaultText: typeParameter.default
          ? EntityUtils.normalizeWhitespace(typeParameter.default.getText(this.sf))
          : '',
        varianceAnnotation: varianceAnnotationOf(typeParameter),
        isConst: hasModifier(typeParameter, ts.SyntaxKind.ConstKeyword),
        startColumn: startPos.character + 1,
        serviceVersionLinkHash: this.options.serviceVersionLinkHash,
      });
      this.typeParameters.push(row);
      this.typeParameterHashByNode.set(nodeId(typeParameter, this.sf), row.getHash());

      const owner = {
        ownerHash: row.getHash(),
        ownerKind: TsReferenceOwnerKind.TYPE_PARAMETER,
        tsTypeLinkHash: context.typeHash,
        tsModuleLinkHash: context.moduleHash,
      };
      if (typeParameter.constraint) {
        row.setConstraintReferenceLinkHash(
          this.typeReferenceExtractor.extract(typeParameter.constraint, boundContext, owner)
        );
      }
      if (typeParameter.default) {
        row.setDefaultReferenceLinkHash(
          this.typeReferenceExtractor.extract(
            typeParameter.default,
            TsTypeRefContext.TYPE_PARAM_DEFAULT,
            owner
          )
        );
      }
      position += 1;
    }
  }

  /**
   * Emits the type parameters a TYPE-LEVEL construct declares.
   *
   * `[K in keyof T]` and `infer U` declare real parameters with real scopes, and
   * neither has a Java analogue — so neither is reachable from the declaration
   * walk. They are minted from inside the type-reference walk, which is the only
   * traversal that visits every type node wherever it was written.
   */
  emitTypeLevelParameter(
    typeParameter: ts.TypeParameterDeclaration,
    ownerHash: string,
    ownerKind: TsTypeParameterOwnerKind,
    moduleHash: string
  ): void {
    const id = nodeId(typeParameter, this.sf);
    if (this.typeParameterHashByNode.has(id)) {
      return;
    }
    const startPos = this.sf.getLineAndCharacterOfPosition(typeParameter.getStart(this.sf));
    const row = new TsTypeParameterRegistry({
      paramName: typeParameter.name.text,
      position: 0,
      ownerTypeName: '',
      ownerQualifiedName: this.options.moduleQualifiedName,
      filePath: this.options.filePath,
      startLine: startPos.line + 1,
      tsTypeLinkHash: '',
      ownerKind,
      ownerLinkHash: ownerHash,
      constraintText: typeParameter.constraint
        ? EntityUtils.normalizeWhitespace(typeParameter.constraint.getText(this.sf))
        : '',
      defaultText: '',
      varianceAnnotation: '',
      isConst: false,
      startColumn: startPos.character + 1,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.typeParameters.push(row);
    this.typeParameterHashByNode.set(id, row.getHash());
    void moduleHash;
  }
}

interface MemberSummary {
  readonly isOptional: boolean;
  readonly isIndexSignature: boolean;
  readonly shapePart: string;
}

function methodSummary(member: ts.Node, hash: string): MemberSummary | undefined {
  if (hash === '') {
    return undefined;
  }
  const isOptional = (member as { questionToken?: ts.QuestionToken }).questionToken !== undefined;
  const arity = (member as { parameters?: ts.NodeArray<ts.ParameterDeclaration> })
    .parameters?.length ?? 0;
  return {
    isOptional,
    isIndexSignature: false,
    shapePart: `${memberName(member) ?? ''}:METHOD:${arity}:${isOptional}`,
  };
}

/**
 * TIER 3, and labelled as such where it is computed.
 *
 * A pruning aid with no semantic claim: equal digests make two types
 * CANDIDATES for structural satisfaction, never a satisfaction fact. 91.9% of
 * interfaces have no implementer at all and the empty shape is satisfied by
 * everything, so an engine that does not prune first computes noise at
 * O(classes x interfaces). Deciding satisfaction needs `isTypeAssignableTo`,
 * which the parser does not have and must not pretend to.
 */
function shapeDigestOf(parts: readonly string[]): string {
  return EntityUtils.generateEntityHash(
    ENTITY_IDENTIFIERS.TS_DECLARATION_GROUP,
    [...parts].sort().join('|')
  );
}

const TYPE_ONLY_METHOD_KINDS = new Set<TsMethodKind>([
  TsMethodKind.METHOD_SIGNATURE,
  TsMethodKind.CALL_SIGNATURE,
  TsMethodKind.CONSTRUCT_SIGNATURE,
  TsMethodKind.FUNCTION_TYPE_SIGNATURE,
]);

/** `in` / `out` on a type parameter. TypeScript 4.7; 562 measured. */
function varianceAnnotationOf(
  typeParameter: ts.TypeParameterDeclaration
): TsVarianceAnnotation | '' {
  const hasIn = hasModifier(typeParameter, ts.SyntaxKind.InKeyword);
  const hasOut = hasModifier(typeParameter, ts.SyntaxKind.OutKeyword);
  if (hasIn && hasOut) {
    return TsVarianceAnnotation.IN_OUT;
  }
  if (hasIn) {
    return TsVarianceAnnotation.IN;
  }
  if (hasOut) {
    return TsVarianceAnnotation.OUT;
  }
  return '';
}

/**
 * Which of the nine owner kinds a function-shaped declaration is.
 *
 * The distinction is what lets one relation stand in for Java's two: a
 * projection filters on it instead of choosing a relation.
 */
function typeParameterOwnerKindFor(methodKind: TsMethodKind): TsTypeParameterOwnerKind {
  switch (methodKind) {
    case TsMethodKind.FUNCTION_DECLARATION:
    case TsMethodKind.FUNCTION_EXPRESSION:
    case TsMethodKind.FUNCTION_TYPE_SIGNATURE: {
      return TsTypeParameterOwnerKind.FUNCTION;
    }
    case TsMethodKind.ARROW_FUNCTION: {
      return TsTypeParameterOwnerKind.ARROW;
    }
    case TsMethodKind.CALL_SIGNATURE: {
      return TsTypeParameterOwnerKind.CALL_SIGNATURE;
    }
    case TsMethodKind.CONSTRUCT_SIGNATURE:
    case TsMethodKind.CONSTRUCTOR_TYPE_SIGNATURE: {
      return TsTypeParameterOwnerKind.CONSTRUCT_SIGNATURE;
    }
    default: {
      return TsTypeParameterOwnerKind.METHOD;
    }
  }
}

function methodNameOf(
  node: ts.Node,
  methodKind: TsMethodKind,
  binding: BoundDeclaration | undefined
): string {
  if (binding) {
    return binding.name;
  }
  switch (methodKind) {
    case TsMethodKind.CONSTRUCTOR: {
      return TS_ANONYMOUS_METHOD_NAMES.CONSTRUCTOR;
    }
    case TsMethodKind.ARROW_FUNCTION: {
      return TS_ANONYMOUS_METHOD_NAMES.ARROW;
    }
    case TsMethodKind.FUNCTION_EXPRESSION: {
      return (node as ts.FunctionExpression).name?.text
        ?? TS_ANONYMOUS_METHOD_NAMES.FUNCTION_EXPRESSION;
    }
    case TsMethodKind.CALL_SIGNATURE: {
      return TS_ANONYMOUS_METHOD_NAMES.CALL_SIGNATURE;
    }
    case TsMethodKind.CONSTRUCT_SIGNATURE: {
      return TS_ANONYMOUS_METHOD_NAMES.CONSTRUCT_SIGNATURE;
    }
    case TsMethodKind.CLASS_STATIC_BLOCK: {
      return TS_ANONYMOUS_METHOD_NAMES.STATIC_BLOCK;
    }
    default: {
      return memberName(node) ?? '';
    }
  }
}

function signatureOf(
  name: string,
  parameters: readonly ts.ParameterDeclaration[],
  sourceFile: ts.SourceFile
): string {
  const names = parameters.map((p) =>
    ts.isIdentifier(p.name) ? p.name.text : EntityUtils.normalizeWhitespace(
      p.name.getText(sourceFile)));
  return `${name}(${names.join(', ')})`;
}

function detailedSignatureOf(
  name: string,
  parameters: readonly ts.ParameterDeclaration[],
  returnType: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile
): string {
  const parts = parameters.map((p) => EntityUtils.normalizeWhitespace(p.getText(sourceFile)));
  const suffix = returnType
    ? `: ${EntityUtils.normalizeWhitespace(returnType.getText(sourceFile))}`
    : '';
  return `${name}(${parts.join(', ')})${suffix}`;
}

/**
 * The column that stops a `.d.ts` line being read as an implementation.
 *
 * Order matters. A method signature inside a `.d.ts` interface is
 * NO_BODY_INTERFACE, not NO_BODY_AMBIENT: the more specific reason is the one
 * worth recording, because an interface member can never have a body under any
 * compiler options while an ambient function merely does not have one here.
 */
function bodyPresenceOf(
  node: ts.Node,
  methodKind: TsMethodKind,
  hasBody: boolean,
  isAmbient: boolean
): TsBodyPresence {
  if (hasBody) {
    return TsBodyPresence.HAS_BODY;
  }
  if (TYPE_ONLY_METHOD_KINDS.has(methodKind)) {
    return TsBodyPresence.NO_BODY_INTERFACE;
  }
  if (hasModifier(node, ts.SyntaxKind.AbstractKeyword)) {
    return TsBodyPresence.NO_BODY_ABSTRACT;
  }
  if (isAmbient || hasModifier(node, ts.SyntaxKind.DeclareKeyword)) {
    return TsBodyPresence.NO_BODY_AMBIENT;
  }
  return TsBodyPresence.NO_BODY_OVERLOAD;
}

function typeAccessOf(node: ts.Node, binding: BoundDeclaration | undefined): TsTypeAccess {
  if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
    return TsTypeAccess.DEFAULT_EXPORT_ACCESS;
  }
  if (binding?.isExported === true) {
    return TsTypeAccess.EXPORTED_ACCESS;
  }
  if (binding?.mergeScopeKey === 'GLOBAL') {
    return TsTypeAccess.GLOBAL_ACCESS;
  }
  if (binding?.mergeScopeKey.startsWith('NS:') === true) {
    return TsTypeAccess.NAMESPACE_LOCAL_ACCESS;
  }
  return TsTypeAccess.MODULE_LOCAL_ACCESS;
}

function typeModifiersOf(node: ts.Node): ReadonlySet<TsTypeModifier> {
  const out = new Set<TsTypeModifier>();
  if (hasModifier(node, ts.SyntaxKind.AbstractKeyword)) {
    out.add(TsTypeModifier.ABSTRACT);
  }
  if (hasModifier(node, ts.SyntaxKind.DeclareKeyword)) {
    out.add(TsTypeModifier.DECLARE);
  }
  if (hasModifier(node, ts.SyntaxKind.ConstKeyword)) {
    out.add(TsTypeModifier.CONST);
  }
  if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
    out.add(TsTypeModifier.EXPORT);
  }
  if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
    out.add(TsTypeModifier.DEFAULT_EXPORT);
  }
  const typeParameters = (node as {
    typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration>;
  }).typeParameters;
  if (typeParameters && typeParameters.length > 0) {
    out.add(TsTypeModifier.GENERIC);
  }
  return out;
}

function placementOf(node: ts.Node, context: EmitContext): TsTypePlacement {
  if (ts.isClassExpression(node)) {
    return TsTypePlacement.EXPRESSION_PLACEMENT;
  }
  if (context.isAmbient && context.typeHash === '' && context.methodHash !== '') {
    return TsTypePlacement.AMBIENT_MODULE_PLACEMENT;
  }
  if (context.namePath.length > 0) {
    return TsTypePlacement.NAMESPACE_PLACEMENT;
  }
  if (context.typeHash !== '') {
    return TsTypePlacement.NESTED_PLACEMENT;
  }
  if (context.blockHash !== '') {
    return TsTypePlacement.LOCAL_PLACEMENT;
  }
  return TsTypePlacement.TOP_LEVEL_PLACEMENT;
}

function heritageCountOf(node: ts.Node): number {
  const clauses = (node as { heritageClauses?: ts.NodeArray<ts.HeritageClause> }).heritageClauses;
  if (!clauses) {
    return 0;
  }
  let count = 0;
  for (const clause of clauses) {
    count += clause.types.length;
  }
  return count;
}

function methodAccessOf(node: ts.Node, binding: BoundDeclaration | undefined): TsMethodAccess {
  const name = (node as { name?: ts.PropertyName }).name;
  if (name && ts.isPrivateIdentifier(name)) {
    // `#m()` is a HARD runtime private. `private` is erased at emit and is not
    // the same fact, so the two never share a value.
    return TsMethodAccess.PRIVATE_NAME_ACCESS;
  }
  if (hasModifier(node, ts.SyntaxKind.PrivateKeyword)) {
    return TsMethodAccess.PRIVATE_ACCESS;
  }
  if (hasModifier(node, ts.SyntaxKind.ProtectedKeyword)) {
    return TsMethodAccess.PROTECTED_ACCESS;
  }
  if (hasModifier(node, ts.SyntaxKind.PublicKeyword)) {
    return TsMethodAccess.PUBLIC_ACCESS;
  }
  if (binding?.isExported === true) {
    return TsMethodAccess.EXPORTED_ACCESS;
  }
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)) {
    return TsMethodAccess.MODULE_LOCAL_ACCESS;
  }
  return TsMethodAccess.PUBLIC_ACCESS;
}

function methodModifiersOf(node: ts.Node): ReadonlySet<TsMethodModifier> {
  const out = new Set<TsMethodModifier>();
  if (hasModifier(node, ts.SyntaxKind.StaticKeyword)) {
    out.add(TsMethodModifier.STATIC);
  }
  if (hasModifier(node, ts.SyntaxKind.AbstractKeyword)) {
    out.add(TsMethodModifier.ABSTRACT);
  }
  if (hasModifier(node, ts.SyntaxKind.AsyncKeyword)) {
    out.add(TsMethodModifier.ASYNC);
  }
  if ((node as { asteriskToken?: ts.AsteriskToken }).asteriskToken !== undefined) {
    out.add(TsMethodModifier.GENERATOR);
  }
  if (hasModifier(node, ts.SyntaxKind.DeclareKeyword)) {
    out.add(TsMethodModifier.DECLARE);
  }
  if (hasModifier(node, ts.SyntaxKind.OverrideKeyword)) {
    out.add(TsMethodModifier.OVERRIDE);
  }
  if ((node as { questionToken?: ts.QuestionToken }).questionToken !== undefined) {
    out.add(TsMethodModifier.OPTIONAL);
  }
  if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
    out.add(TsMethodModifier.EXPORT);
  }
  if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
    out.add(TsMethodModifier.DEFAULT_EXPORT);
  }
  return out;
}

function fieldAccessOf(node: ts.Node): TsFieldAccess {
  const name = (node as { name?: ts.PropertyName | ts.BindingName }).name;
  if (name && ts.isPrivateIdentifier(name as ts.Node)) {
    return TsFieldAccess.PRIVATE_NAME_ACCESS;
  }
  if (hasModifier(node, ts.SyntaxKind.PrivateKeyword)) {
    return TsFieldAccess.PRIVATE_ACCESS;
  }
  if (hasModifier(node, ts.SyntaxKind.ProtectedKeyword)) {
    return TsFieldAccess.PROTECTED_ACCESS;
  }
  return TsFieldAccess.PUBLIC_ACCESS;
}

function fieldModifiersOf(node: ts.Node, isOptional: boolean): ReadonlySet<TsFieldModifier> {
  const out = new Set<TsFieldModifier>();
  if (hasModifier(node, ts.SyntaxKind.StaticKeyword)) {
    out.add(TsFieldModifier.STATIC);
  }
  if (hasModifier(node, ts.SyntaxKind.ReadonlyKeyword)) {
    out.add(TsFieldModifier.READONLY);
  }
  if (hasModifier(node, ts.SyntaxKind.DeclareKeyword)) {
    out.add(TsFieldModifier.DECLARE);
  }
  if (hasModifier(node, ts.SyntaxKind.AbstractKeyword)) {
    out.add(TsFieldModifier.ABSTRACT);
  }
  if (hasModifier(node, ts.SyntaxKind.OverrideKeyword)) {
    out.add(TsFieldModifier.OVERRIDE);
  }
  if (hasModifier(node, ts.SyntaxKind.AccessorKeyword)) {
    out.add(TsFieldModifier.ACCESSOR);
  }
  if (isOptional) {
    out.add(TsFieldModifier.OPTIONAL);
  }
  if ((node as { exclamationToken?: ts.ExclamationToken }).exclamationToken !== undefined) {
    out.add(TsFieldModifier.DEFINITE_ASSIGNMENT);
  }
  return out;
}

function parameterPropertyModifiersOf(
  parameter: ts.ParameterDeclaration
): ReadonlySet<TsParameterPropertyModifier> {
  const out = new Set<TsParameterPropertyModifier>();
  if (hasModifier(parameter, ts.SyntaxKind.PrivateKeyword)) {
    out.add(TsParameterPropertyModifier.PRIVATE);
  }
  if (hasModifier(parameter, ts.SyntaxKind.ProtectedKeyword)) {
    out.add(TsParameterPropertyModifier.PROTECTED);
  }
  if (hasModifier(parameter, ts.SyntaxKind.PublicKeyword)) {
    out.add(TsParameterPropertyModifier.PUBLIC);
  }
  if (hasModifier(parameter, ts.SyntaxKind.ReadonlyKeyword)) {
    out.add(TsParameterPropertyModifier.READONLY);
  }
  return out;
}

function indexKeyTypeNameOf(node: ts.IndexSignatureDeclaration, sourceFile: ts.SourceFile): string {
  const parameter = node.parameters[0];
  return parameter?.type
    ? EntityUtils.normalizeWhitespace(parameter.type.getText(sourceFile))
    : '';
}

/** The annotation minus its type arguments — `Map` for `Map<string, User>`. */
function baseTypeOf(typeName: string): string {
  const index = typeName.indexOf('<');
  return index < 0 ? typeName : typeName.slice(0, index);
}

/**
 * Type names appearing in `throw new X` inside the body.
 *
 * INFERRED, and labelled as such: TypeScript has no `throws` clause, so unlike
 * Java this column is a syntactic observation about one body rather than a
 * declared contract. It does not see what a callee throws.
 */
function thrownTypeNamesOf(body: ts.Node | undefined, sourceFile: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  if (!body) {
    return out;
  }
  const walk = (node: ts.Node): void => {
    if (ts.isThrowStatement(node) && node.expression && ts.isNewExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)) {
      out.add(node.expression.expression.text);
    }
    // Nested functions have their own row and their own throws; descending into
    // them would attribute a closure's throw to its enclosing function.
    if (ts.isFunctionLike(node) && node !== body) {
      return;
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(body, walk);
  void sourceFile;
  return out;
}

/**
 * The expressions in a loop header.
 *
 * Enumerated rather than reached by a generic descent, because the loop's BODY
 * is walked separately and a generic descent would visit it twice — emitting
 * every nested function in it under two owners.
 */
function loopHeaderExpressionsOf(node: ts.IterationStatement): ts.Expression[] {
  const out: ts.Expression[] = [];
  if (ts.isForStatement(node)) {
    if (node.initializer && !ts.isVariableDeclarationList(node.initializer)) {
      out.push(node.initializer);
    }
    if (node.condition) {
      out.push(node.condition);
    }
    if (node.incrementor) {
      out.push(node.incrementor);
    }
    return out;
  }
  if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    out.push(node.expression);
    return out;
  }
  if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
    out.push(node.expression);
  }
  return out;
}

function loopBlockKindOf(node: ts.IterationStatement): TsBlockKind {
  if (ts.isForStatement(node)) {
    return TsBlockKind.FOR;
  }
  if (ts.isForInStatement(node)) {
    return TsBlockKind.FOR_IN;
  }
  if (ts.isForOfStatement(node)) {
    return node.awaitModifier ? TsBlockKind.FOR_AWAIT_OF : TsBlockKind.FOR_OF;
  }
  if (ts.isWhileStatement(node)) {
    return TsBlockKind.WHILE;
  }
  return TsBlockKind.DO_WHILE;
}

/** `using` / `await using` — TypeScript 5.2's analogue of try-with-resources. */
function usingDeclarationCountOf(node: ts.Node): number {
  let count = 0;
  const statements = (node as { statements?: ts.NodeArray<ts.Statement> }).statements;
  for (const statement of statements ?? []) {
    if (ts.isVariableStatement(statement)) {
      const flags = statement.declarationList.flags;
      if ((flags & ts.NodeFlags.Using) !== 0 || (flags & ts.NodeFlags.AwaitUsing) !== 0) {
        count += statement.declarationList.declarations.length;
      }
    }
  }
  return count;
}

function variableDeclarationKindOf(
  list: ts.VariableDeclarationList | undefined
): TsVariableDeclarationKind {
  if (!list) {
    return TsVariableDeclarationKind.CATCH;
  }
  if ((list.flags & ts.NodeFlags.AwaitUsing) !== 0) {
    return TsVariableDeclarationKind.AWAIT_USING;
  }
  if ((list.flags & ts.NodeFlags.Using) !== 0) {
    return TsVariableDeclarationKind.USING;
  }
  if ((list.flags & ts.NodeFlags.Const) !== 0) {
    return TsVariableDeclarationKind.CONST;
  }
  if ((list.flags & ts.NodeFlags.Let) !== 0) {
    return TsVariableDeclarationKind.LET;
  }
  return TsVariableDeclarationKind.VAR;
}

function variableScopeKindOf(
  context: EmitContext,
  declaration: ts.VariableDeclaration
): TsVariableScopeKind {
  if (declaration.parent && ts.isCatchClause(declaration.parent)) {
    return TsVariableScopeKind.CATCH_BINDING;
  }
  const list = declaration.parent;
  if (list && ts.isVariableDeclarationList(list) && list.parent
    && (ts.isForStatement(list.parent) || ts.isForInStatement(list.parent)
      || ts.isForOfStatement(list.parent))) {
    return TsVariableScopeKind.FOR_BINDING;
  }
  if (context.isAmbient) {
    return TsVariableScopeKind.AMBIENT_SCOPE;
  }
  if (context.blockHash !== '') {
    return TsVariableScopeKind.BLOCK_SCOPE;
  }
  if (context.namePath.length > 0) {
    return TsVariableScopeKind.NAMESPACE_SCOPE;
  }
  if (context.typeHash !== '') {
    return TsVariableScopeKind.FUNCTION_BODY;
  }
  return TsVariableScopeKind.MODULE_SCOPE;
}

function initializerKindOf(node: ts.Expression | undefined): TsVariableInitializerKind {
  if (!node) {
    return TsVariableInitializerKind.NONE;
  }
  if (ts.isArrowFunction(node)) {
    return TsVariableInitializerKind.ARROW;
  }
  if (ts.isFunctionExpression(node)) {
    return TsVariableInitializerKind.FUNCTION_EXPRESSION;
  }
  if (ts.isNewExpression(node)) {
    return TsVariableInitializerKind.NEW;
  }
  if (ts.isCallExpression(node)) {
    return TsVariableInitializerKind.CALL;
  }
  if (ts.isObjectLiteralExpression(node)) {
    return TsVariableInitializerKind.OBJECT_LITERAL;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return TsVariableInitializerKind.ARRAY_LITERAL;
  }
  if (ts.isAsExpression(node)) {
    return TsVariableInitializerKind.AS_EXPRESSION;
  }
  if (ts.isSatisfiesExpression(node)) {
    return TsVariableInitializerKind.SATISFIES;
  }
  if (ts.isAwaitExpression(node)) {
    return TsVariableInitializerKind.AWAIT;
  }
  if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return TsVariableInitializerKind.TEMPLATE;
  }
  if (ts.isClassExpression(node)) {
    return TsVariableInitializerKind.CLASS_EXPRESSION;
  }
  if (ts.isIdentifier(node)) {
    return TsVariableInitializerKind.IDENTIFIER;
  }
  if (ts.isLiteralExpression(node) || node.kind === ts.SyntaxKind.TrueKeyword
    || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) {
    return TsVariableInitializerKind.LITERAL;
  }
  return TsVariableInitializerKind.UNKNOWN;
}

function defaultValueKindOf(node: ts.Expression | undefined): TsDefaultValueKind {
  if (!node) {
    return TsDefaultValueKind.NONE;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return TsDefaultValueKind.STRING;
  }
  if (ts.isNumericLiteral(node)) {
    return TsDefaultValueKind.NUMBER;
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    return TsDefaultValueKind.BOOL;
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return TsDefaultValueKind.NULL;
  }
  if (ts.isIdentifier(node) && node.text === 'undefined') {
    return TsDefaultValueKind.UNDEFINED;
  }
  if (ts.isObjectLiteralExpression(node)) {
    return TsDefaultValueKind.OBJECT;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return TsDefaultValueKind.ARRAY;
  }
  if (ts.isNewExpression(node)) {
    return TsDefaultValueKind.NEW;
  }
  if (ts.isCallExpression(node)) {
    return TsDefaultValueKind.CALL;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return TsDefaultValueKind.ARROW;
  }
  if (ts.isTemplateExpression(node)) {
    return TsDefaultValueKind.TEMPLATE;
  }
  if (ts.isIdentifier(node)) {
    return TsDefaultValueKind.IDENTIFIER;
  }
  return TsDefaultValueKind.UNKNOWN;
}
