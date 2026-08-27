import * as ts from 'typescript';

import { TsCallSiteRegistry } from '@/analysis-types/typescript/TsCallSiteRegistry';
import { TsExpressionRegistry } from '@/analysis-types/typescript/TsExpressionRegistry';
import { TsFieldRegistry } from '@/analysis-types/typescript/TsFieldRegistry';
import { TsImportRegistry } from '@/analysis-types/typescript/TsImportRegistry';
import { TsMethodRegistry } from '@/analysis-types/typescript/TsMethodRegistry';
import { TsTypeRegistry } from '@/analysis-types/typescript/TsTypeRegistry';
import { TsVariableRegistry } from '@/analysis-types/typescript/TsVariableRegistry';
import { TsReferencedEntityKind, TsEdgeRole } from '@/enums/typescript/expressions';
import {
  TsResolutionEvidence,
  TsResolvedTargetKind,
} from '@/enums/typescript/call-sites';
import { TsBodyPresence } from '@/enums/typescript/methods';
import {
  BinderResult,
  BoundDeclaration,
  declarationGroupKeyFor,
  escapeName,
  nodeId,
  TsBoundKind,
  TsScope,
} from '@/parsers/typescript/extractors/ts-binder';
import {
  calleeOf,
  unwrapParentheses,
} from '@/parsers/typescript/extractors/ts-expression-extractor';

/**
 * Fills the SAME-FILE resolution links, and stops there.
 *
 * ## The scope of this class is a settled boundary, not a limitation
 *
 * The parser emits IR. Building the call graph is the engine's job. The Java
 * precedent settles it and is worth stating precisely, because it is stronger
 * than a count: `java_type_reference.referencedTypeRegistryLinkHash` is not
 * merely empty in every output on disk — **no Java extractor contains a single
 * statement that fills it.** There is no code path. The column is a slot the
 * engine populates by joining `typeName` against `java_type`, in
 * `type-resolution.dl`.
 *
 * Following an import to a declaring file, walking an `extends` chain across
 * modules, or hopping `a.b.c` through three files' annotations is
 * `type-resolution.dl` rewritten in TypeScript. It was attempted here and is
 * retracted. What remains is the set of links that need ONE lookup inside one
 * file and no import resolution:
 *
 *   - a call to a function declared in this file
 *   - a call through a variable bound to an arrow in this file
 *   - `this.m()` where `m` is declared on the enclosing class in this file
 *   - `new C()` where `C` is declared in this file, including its implicit
 *     constructor
 *   - a namespace-qualified call inside the namespace's own file
 *
 * These are kept because they are strictly more than Java provides and they save
 * the engine a lookup. They are not kept because resolution is the goal.
 *
 * ## What the parser owes the engine instead
 *
 * For everything else — and it is the majority — the obligation is COMPLETENESS,
 * not resolution. A receiver whose declared type lives in another file needs
 * three facts present and nothing more: the receiver's declared type name AS
 * WRITTEN (`ts_call_site.receiverTypeName`), the importing module
 * (`tsModuleLinkHash`), and `ts_import.resolvedFilePath`. With those three the
 * engine joins. `ts-ir-completeness.ts` measures whether they are there.
 *
 * ## Where a link IS emitted, it must be right
 *
 * A parser-filled `resolvedSignatureLinkHash` that disagrees with
 * `getResolvedSignature` is a hard failure at the gate; an unfilled one is not a
 * failure at all. So overloads are chosen by ARITY or not at all — picking the
 * first is wrong on 77.6% of real overloaded calls — and a receiver annotation
 * that is not a BARE IDENTIFIER naming a declaration in this file resolves to
 * nothing (see {@link localTypeNameOf}).
 */
export interface LocalResolutionInput {
  readonly sourceFile: ts.SourceFile;
  readonly binder: BinderResult;
  readonly moduleHash: string;
  readonly types: readonly TsTypeRegistry[];
  readonly methods: readonly TsMethodRegistry[];
  readonly fields: readonly TsFieldRegistry[];
  readonly variables: readonly TsVariableRegistry[];
  readonly imports: ReadonlyMap<string, TsImportRegistry>;
  readonly typeHashByNode: ReadonlyMap<string, string>;
  readonly methodHashByNode: ReadonlyMap<string, string>;
  readonly variableHashByNode: ReadonlyMap<string, string>;
  readonly fieldHashByNode: ReadonlyMap<string, string>;
  readonly parameterHashByNode: ReadonlyMap<string, string>;
  readonly importRowByNode: ReadonlyMap<string, TsImportRegistry>;
  readonly emittedExpressions: readonly { node: ts.Node; row: TsExpressionRegistry }[];
  readonly expressionRowByNode: ReadonlyMap<string, TsExpressionRegistry>;
  readonly callSiteByNode: ReadonlyMap<string, TsCallSiteRegistry>;
  readonly callNodes: readonly { node: ts.Node }[];
  /** Type-alias name -> RHS node, so `const f: Callback = …; f()` has a target. */
  readonly typeAliasTargetByName: ReadonlyMap<string, ts.TypeNode>;
}

/**
 * A call the parser deliberately left for the engine, with the hop it needs named.
 *
 * Not a work queue any more. It was one when this parser tried to follow imports
 * itself; now it exists so `ts-ir-completeness.ts` can ask, per call site,
 * whether the FACTS an engine needs to finish the join were actually emitted.
 * The distinction matters: an unresolved call with a complete hop chain is the
 * parser working as designed, and an unresolved call with a missing hop is a
 * parser bug. Only the second is worth fixing here.
 */
export interface EngineHandoff {
  readonly callSite: TsCallSiteRegistry;
  /** Which hop the engine has to make. */
  readonly hop: 'IMPORTED_NAME' | 'RECEIVER_DECLARED_TYPE' | 'INFERRED_RECEIVER';
  /** The locally bound name the engine starts from — an import binding, or `""`. */
  readonly localName: string;
  /**
   * The receiver's declared type AS WRITTEN — `Row[]`, `Promise<User>`,
   * `Parser.SyntaxNode`. Not reduced: reduction is what produced the one wrong
   * link this parser has emitted, and it is the engine that knows how to read a
   * type expression.
   */
  readonly receiverTypeName: string;
  readonly declaringModuleHash: string;
}

export interface LocalResolutionResult {
  readonly handoffs: readonly EngineHandoff[];
  readonly stats: ResolutionStats;
}

export interface ResolutionStats {
  callSites: number;
  resolvedLocally: number;
  externalTerminal: number;
  synthesized: number;
  unresolved: number;
  /** Resolution outcome by receiver shape — the number a fixture-only win hides. */
  byReceiverKind: Map<string, { total: number; resolved: number }>;
}

export class TsLocalResolver {
  private readonly sf: ts.SourceFile;
  /**
   * Declared type name -> a local `ts_type` row.
   *
   * Used ONLY for the same-file `extends` chain, where the base name was written
   * in the same declaration and no shadowing question arises. Never for a
   * receiver's type: see {@link localTypeAt} for why a flat table is the wrong
   * instrument there.
   */
  private readonly typeByName = new Map<string, TsTypeRegistry>();
  /** `ts_type` hash -> its methods, so a member lookup is one map hit. */
  private readonly methodsByOwner = new Map<string, TsMethodRegistry[]>();
  /**
   * Owner `declarationGroupKey` -> every method of the MERGED type.
   *
   * The one keyed on a single declaration is not enough and the difference is
   * not academic. `interface Store { read(k): string|undefined }` and
   * `interface Store { read(k, f): string }` are ONE type with an overloaded
   * `read`; looking members up on one declaration finds one overload and
   * resolves `store.read("a","b")` to the single-parameter signature — a wrong
   * answer that is indistinguishable from a right one downstream.
   */
  private readonly methodsByOwnerGroup = new Map<string, TsMethodRegistry[]>();
  /** Declared type name -> the group key of the merged type it names. */
  private readonly groupKeyByTypeName = new Map<string, string>();
  private readonly fieldsByOwner = new Map<string, TsFieldRegistry[]>();
  /** `declarationGroupKey` -> every declaration in the group. This IS the overload set. */
  private readonly methodsByGroup = new Map<string, TsMethodRegistry[]>();
  private readonly variableByHash = new Map<string, TsVariableRegistry>();
  /** Group key -> every declaration of the merged type, for heritage walking. */
  private readonly typeDeclarationsByGroup = new Map<string, TsTypeRegistry[]>();
  private readonly methodByHash = new Map<string, TsMethodRegistry>();
  private readonly handoffs: EngineHandoff[] = [];
  private readonly stats: ResolutionStats = {
    callSites: 0,
    resolvedLocally: 0,
    externalTerminal: 0,
    synthesized: 0,
    unresolved: 0,
    byReceiverKind: new Map(),
  };

  constructor(private readonly input: LocalResolutionInput) {
    this.sf = input.sourceFile;
    const groupByTypeHash = new Map<string, string>();
    for (const type of input.types) {
      groupByTypeHash.set(type.getHash(), type.declarationGroupKey);
      if (type.name === '') {
        continue;
      }
      if (!this.typeByName.has(type.name)) {
        this.typeByName.set(type.name, type);
        this.groupKeyByTypeName.set(type.name, type.declarationGroupKey);
      }
      const declarations = this.typeDeclarationsByGroup.get(type.declarationGroupKey);
      if (declarations) {
        declarations.push(type);
      } else {
        this.typeDeclarationsByGroup.set(type.declarationGroupKey, [type]);
      }
    }
    for (const method of input.methods) {
      const owner = method.tsTypeLinkHash;
      const list = this.methodsByOwner.get(owner);
      if (list) {
        list.push(method);
      } else {
        this.methodsByOwner.set(owner, [method]);
      }
      if (method.declarationGroupKey !== '') {
        const group = this.methodsByGroup.get(method.declarationGroupKey);
        if (group) {
          group.push(method);
        } else {
          this.methodsByGroup.set(method.declarationGroupKey, [method]);
        }
      }
      const ownerGroup = groupByTypeHash.get(owner);
      if (ownerGroup !== undefined) {
        const list = this.methodsByOwnerGroup.get(ownerGroup);
        if (list) {
          list.push(method);
        } else {
          this.methodsByOwnerGroup.set(ownerGroup, [method]);
        }
      }
      this.methodByHash.set(method.getHash(), method);
    }
    for (const field of input.fields) {
      const list = this.fieldsByOwner.get(field.tsTypeLinkHash);
      if (list) {
        list.push(field);
      } else {
        this.fieldsByOwner.set(field.tsTypeLinkHash, [field]);
      }
    }
    for (const variable of input.variables) {
      this.variableByHash.set(variable.getHash(), variable);
    }
  }

  run(): LocalResolutionResult {
    this.resolveIdentifierReferences();
    this.resolveCalls();
    return { handoffs: this.handoffs, stats: this.stats };
  }

  // -------------------------------------------------------------------------
  // identifier references
  // -------------------------------------------------------------------------

  private resolveIdentifierReferences(): void {
    for (const { node, row } of this.input.emittedExpressions) {
      if (!ts.isIdentifier(node)) {
        continue;
      }
      // A property NAME is not a scope lookup: `a.length` does not resolve
      // `length` against the lexical chain, and doing so would bind it to any
      // local variable of that name — a wrong answer that looks like a right one.
      if (row.edgeRole === TsEdgeRole.PROPERTY_NAME) {
        continue;
      }
      const binding = this.lookup(node, node.text);
      if (!binding) {
        if (AMBIENT_GLOBALS.has(node.text)) {
          // Declared outside this analysis. An honest terminal, and the engine
          // closes it from `lib_ts_*`.
          row.setReference(TsReferencedEntityKind.AMBIENT_GLOBAL, '', node.text);
        }
        continue;
      }
      const resolved = this.rowFor(binding);
      row.setReference(resolved.kind, resolved.hash, binding.name);
    }
  }

  /**
   * The innermost binder scope containing `node`.
   *
   * Found by walking AST parents against the binder's scope table, never by
   * position comparison: two scopes can begin at the same offset, and a range
   * test would pick whichever was inserted first.
   */
  private scopeFor(node: ts.Node): TsScope | undefined {
    let current: ts.Node | undefined = node.parent;
    while (current) {
      const scope = this.input.binder.scopeByNode.get(nodeId(current, this.sf));
      if (scope) {
        return scope;
      }
      current = current.parent;
    }
    return this.input.binder.fileScope;
  }

  /** Walks the scope chain outward. Block table first: a `let` shadows a `var` of one name. */
  private lookup(node: ts.Node, name: string): BoundDeclaration | undefined {
    const escaped = escapeName(name);
    let scope = this.scopeFor(node);
    while (scope) {
      const blockMatch = scope.blockTable.get(escaped);
      if (blockMatch && blockMatch.length > 0) {
        return blockMatch[0];
      }
      const varMatch = scope.varTable.get(escaped);
      if (varMatch && varMatch.length > 0) {
        return varMatch[0];
      }
      scope = scope.parent;
    }
    return undefined;
  }

  private rowFor(binding: BoundDeclaration): {
    kind: TsReferencedEntityKind;
    hash: string;
  } {
    const id = nodeId(binding.node, this.sf);
    switch (binding.kind) {
      case TsBoundKind.VariableDeclaration: {
        return {
          kind: TsReferencedEntityKind.VARIABLE,
          hash: this.input.variableHashByNode.get(id) ?? '',
        };
      }
      case TsBoundKind.BindingElement: {
        // A destructured name's declaration node is a BindingElement, which has
        // no row of its own. It resolves to whichever declaration binds the
        // pattern -- a VariableDeclaration for `const {a} = x`, a Parameter for
        // `({a}) => ...`. Both forms occur, and a walk that looks only for the
        // former does not stop at the arrow: `([k]) => ...` inside
        // `const values = ...` resolved `k` to `values`.
        const owner = enclosingBindingOwner(binding.node);
        if (owner === undefined) {
          return { kind: TsReferencedEntityKind.VARIABLE, hash: '' };
        }
        if (ts.isParameter(owner)) {
          return {
            kind: TsReferencedEntityKind.PARAMETER,
            hash: this.input.parameterHashByNode.get(nodeId(owner, this.sf)) ?? '',
          };
        }
        return {
          kind: TsReferencedEntityKind.VARIABLE,
          hash: this.input.variableHashByNode.get(nodeId(owner, this.sf)) ?? '',
        };
      }
      case TsBoundKind.Parameter: {
        return {
          kind: TsReferencedEntityKind.PARAMETER,
          hash: this.input.parameterHashByNode.get(id) ?? '',
        };
      }
      case TsBoundKind.FunctionDeclaration:
      // A NAMED function expression's own name, visible only inside its body.
      // It has a `ts_method` row like any other function-shaped declaration, so
      // it resolves to one — without this case the recursive call in
      // `(function scan(d) { … scan(d) … })(root)` resolves to nothing.
      case TsBoundKind.FunctionExpression: {
        return {
          kind: TsReferencedEntityKind.METHOD,
          hash: this.input.methodHashByNode.get(id) ?? '',
        };
      }
      case TsBoundKind.ClassDeclaration:
      case TsBoundKind.InterfaceDeclaration:
      case TsBoundKind.TypeAliasDeclaration:
      case TsBoundKind.EnumDeclaration: {
        return {
          kind: TsReferencedEntityKind.TYPE,
          hash: this.input.typeHashByNode.get(id) ?? '',
        };
      }
      case TsBoundKind.ModuleDeclaration: {
        return {
          kind: TsReferencedEntityKind.NAMESPACE,
          hash: this.input.typeHashByNode.get(id) ?? '',
        };
      }
      case TsBoundKind.ImportBinding: {
        return {
          kind: TsReferencedEntityKind.IMPORT_BINDING,
          hash: this.input.importRowByNode.get(id)?.getHash() ?? '',
        };
      }
      default: {
        return { kind: TsReferencedEntityKind.UNKNOWN, hash: '' };
      }
    }
  }

  // -------------------------------------------------------------------------
  // calls
  // -------------------------------------------------------------------------

  private resolveCalls(): void {
    for (const { node } of this.input.callNodes) {
      const callSite = this.input.callSiteByNode.get(nodeId(node, this.sf));
      if (!callSite) {
        continue;
      }
      this.stats.callSites += 1;
      const before = this.stats.resolvedLocally + this.stats.externalTerminal
        + this.stats.synthesized;
      this.resolveOneCall(node, callSite);
      const after = this.stats.resolvedLocally + this.stats.externalTerminal
        + this.stats.synthesized;
      if (after === before) {
        this.stats.unresolved += 1;
      }
      const shape = callSite.receiverKind;
      const bucket = this.stats.byReceiverKind.get(shape)
        ?? { total: 0, resolved: 0 };
      bucket.total += 1;
      if (after !== before) {
        bucket.resolved += 1;
      }
      this.stats.byReceiverKind.set(shape, bucket);
    }
  }

  private resolveOneCall(node: ts.Node, callSite: TsCallSiteRegistry): void {
    const callee = calleeOf(node);
    if (!callee) {
      return;
    }
    const argumentCount = callArgumentCount(node);

    if (ts.isNewExpression(node)) {
      this.resolveConstruction(callee, callSite, argumentCount);
      return;
    }
    if (callee.kind === ts.SyntaxKind.SuperKeyword) {
      this.resolveSuperConstruction(node, callSite, argumentCount);
      return;
    }
    if (ts.isIdentifier(callee)) {
      this.resolveDirectCall(callee, callSite, argumentCount);
      return;
    }
    if (ts.isPropertyAccessExpression(callee)) {
      this.resolveMemberCall(callee, callSite, argumentCount);
      return;
    }
    // An element-access callee, a call on a call result, an IIFE. All need an
    // inferred type, so the parser records the shape and stops.
  }

  private resolveDirectCall(
    callee: ts.Identifier,
    callSite: TsCallSiteRegistry,
    argumentCount: number
  ): void {
    const binding = this.lookup(callee, callee.text);
    if (!binding) {
      if (AMBIENT_GLOBALS.has(callee.text)) {
        callSite.setExternalTarget(TsResolvedTargetKind.LIB_SIGNATURE,
          TsResolutionEvidence.AMBIENT_GLOBAL);
        this.stats.externalTerminal += 1;
      }
      return;
    }
    if (binding.kind === TsBoundKind.ImportBinding) {
      // Handed to the engine, NOT followed. The `ts_expression` row for this
      // identifier already points at the `ts_import` row, and that row carries
      // `resolvedFilePath` from `ts.resolveModuleName` — which is the whole hop.
      // Chasing it here is `type-resolution.dl` in TypeScript.
      this.handoffs.push({
        callSite,
        hop: 'IMPORTED_NAME',
        localName: callee.text,
        receiverTypeName: '',
        declaringModuleHash: this.input.moduleHash,
      });
      return;
    }
    if (binding.kind === TsBoundKind.FunctionDeclaration
      || binding.kind === TsBoundKind.FunctionExpression) {
      const hash = this.input.methodHashByNode.get(nodeId(binding.node, this.sf));
      const method = hash ? this.methodByHash.get(hash) : undefined;
      if (method) {
        this.chooseFromGroup(method, callSite, argumentCount,
          TsResolutionEvidence.LOCAL_BINDING);
      }
      return;
    }
    if (binding.kind === TsBoundKind.VariableDeclaration
      || binding.kind === TsBoundKind.Parameter) {
      // The DECLARED type wins over whatever was assigned, and this is not a
      // preference — it is what tsc does. For
      // `const f: (s: S) => string = (s) => s.id`, `getResolvedSignature`
      // returns the ANNOTATION's signature, not the arrow's. A parser that
      // offers the arrow disagrees with the oracle on every such call, and the
      // fixture corpus has five of them.
      const declared = this.declaredCallSignatureOf(binding);
      if (declared) {
        this.applyTarget(callSite, declared, undefined, 1, false,
          TsResolutionEvidence.DECLARED_RECEIVER_TYPE);
        return;
      }
      if (binding.kind !== TsBoundKind.VariableDeclaration) {
        return;
      }
      const variableHash = this.input.variableHashByNode.get(nodeId(binding.node, this.sf));
      const variable = variableHash ? this.variableByHash.get(variableHash) : undefined;
      // THE arrow-function path, for an UNANNOTATED binding: `const f = () => {};
      // f()`. 161 measured targets are arrows and none has a name a call site
      // could match — the variable is the only route to them.
      const bound = variable?.getBoundFunctionLinkHash() ?? '';
      if (bound !== '') {
        const method = this.methodByHash.get(bound);
        if (method) {
          this.applyTarget(callSite, method, undefined, 1, false,
            TsResolutionEvidence.LOCAL_BINDING);
        }
      }
      return;
    }
    if (binding.kind === TsBoundKind.ClassDeclaration) {
      // A class called without `new` is an error in TypeScript, so there is
      // nothing to resolve; recording a constructor here would be a fact about
      // code that does not compile.
      return;
    }
  }

  private resolveConstruction(
    callee: ts.Node,
    callSite: TsCallSiteRegistry,
    argumentCount: number
  ): void {
    if (!ts.isIdentifier(callee)) {
      return;
    }
    const binding = this.lookup(callee, callee.text);
    if (!binding) {
      if (AMBIENT_GLOBALS.has(callee.text)) {
        callSite.setExternalTarget(TsResolvedTargetKind.LIB_SIGNATURE,
          TsResolutionEvidence.AMBIENT_GLOBAL);
        this.stats.externalTerminal += 1;
      }
      return;
    }
    if (binding.kind === TsBoundKind.ImportBinding) {
      this.handoffs.push({
        callSite,
        hop: 'IMPORTED_NAME',
        localName: callee.text,
        receiverTypeName: '',
        declaringModuleHash: this.input.moduleHash,
      });
      return;
    }
    if (binding.kind !== TsBoundKind.ClassDeclaration) {
      return;
    }
    const typeHash = this.input.typeHashByNode.get(nodeId(binding.node, this.sf));
    if (!typeHash) {
      return;
    }
    this.resolveConstructorOf(typeHash, callSite, argumentCount);
  }

  private resolveConstructorOf(
    typeHash: string,
    callSite: TsCallSiteRegistry,
    argumentCount: number
  ): void {
    const constructors = (this.methodsByOwner.get(typeHash) ?? [])
      .filter((m) => m.name === '<constructor>');
    if (constructors.length === 0) {
      // 2.3% of measured call sites: an IMPLICIT constructor. There is no
      // declaration node anywhere, so a missing row would be indistinguishable
      // from a resolution failure. This is the honest terminal for it.
      callSite.setResolution({
        resolvedSignatureLinkHash: '',
        resolvedGroupKey: '',
        resolvedTargetKind: TsResolvedTargetKind.SYNTHESIZED_NO_DECLARATION,
        resolvedOverloadIndex: undefined,
        overloadCandidateCount: 1,
        isOverloadResolved: false,
        resolutionEvidence: TsResolutionEvidence.LOCAL_BINDING,
        isAmbientTarget: false,
      });
      this.stats.synthesized += 1;
      return;
    }
    const chosen = chooseByArity(constructors, argumentCount);
    if (chosen) {
      this.applyTarget(callSite, chosen, constructors.length > 1
        ? constructors.indexOf(chosen)
        : undefined, constructors.length, constructors.length > 1,
        TsResolutionEvidence.LOCAL_BINDING);
      return;
    }
    this.recordCandidatesOnly(callSite, constructors.length);
  }

  private resolveSuperConstruction(
    node: ts.Node,
    callSite: TsCallSiteRegistry,
    argumentCount: number
  ): void {
    const baseName = this.extendsBaseNameOf(node);
    if (baseName === '') {
      return;
    }
    // The base class NAME AS WRITTEN. That plus this module and the import row
    // is everything the engine needs; whether the base is in this file or
    // imported is its join to make.
    callSite.setReceiverTypeName(baseName);
    const local = this.localTypeAt(node, baseName);
    if (local) {
      this.resolveConstructorOf(local.getHash(), callSite, argumentCount);
      return;
    }
    this.handoffs.push({
      callSite,
      hop: 'RECEIVER_DECLARED_TYPE',
      localName: '',
      receiverTypeName: baseName,
      declaringModuleHash: this.input.moduleHash,
    });
  }

  /** The `extends` clause's base NAME as written, for the class enclosing `node`. */
  private extendsBaseNameOf(node: ts.Node): string {
    let current: ts.Node | undefined = node.parent;
    while (current) {
      if (ts.isClassLike(current)) {
        for (const clause of current.heritageClauses ?? []) {
          if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
            continue;
          }
          const first = clause.types[0];
          if (first) {
            return first.expression.getText(this.sf);
          }
        }
        return '';
      }
      current = current.parent;
    }
    return '';
  }

  private resolveMemberCall(
    callee: ts.PropertyAccessExpression,
    callSite: TsCallSiteRegistry,
    argumentCount: number
  ): void {
    const receiver = unwrapParentheses(callee.expression);
    const member = ts.isPrivateIdentifier(callee.name) ? callee.name.text : callee.name.text;

    if (receiver.kind === ts.SyntaxKind.ThisKeyword) {
      const owner = this.enclosingType(callee);
      if (!owner) {
        return;
      }
      callSite.setReceiverTypeName(owner.name);
      // Same file, one lookup: the member is on the enclosing class or on a base
      // declared alongside it. When it is on a base that is IMPORTED, this finds
      // nothing and the call is handed off — the engine follows the heritage row
      // and the import, which is what `ts_type_heritage.inheritsMembers` is for.
      if (!this.resolveMemberOfType(owner, member, callSite, argumentCount,
        TsResolutionEvidence.THIS_MEMBER)) {
        this.handoffs.push({
          callSite,
          hop: 'RECEIVER_DECLARED_TYPE',
          localName: '',
          receiverTypeName: owner.name,
          declaringModuleHash: this.input.moduleHash,
        });
      }
      return;
    }
    if (ts.isPropertyAccessExpression(receiver) || ts.isNonNullExpression(receiver)) {
      // A property CHAIN: `this.repo.find()`, `config.db.connect()`. Every hop
      // is a join from a declared type name to a declaration and then to the
      // next annotation — which is exactly what the engine's name-to-type layer
      // does, over a fact base that has all the files. The parser's job is to
      // make sure the hops are PRESENT: the receiver expression row, its
      // `referencedEntityHash`, and the field's `typeReferenceLinkHash` are all
      // emitted, so the chain is walkable without the parser walking it.
      this.handoffs.push({
        callSite,
        hop: 'RECEIVER_DECLARED_TYPE',
        localName: '',
        receiverTypeName: '',
        declaringModuleHash: this.input.moduleHash,
      });
      return;
    }
    if (receiver.kind === ts.SyntaxKind.SuperKeyword) {
      const baseName = this.extendsBaseNameOf(callee);
      if (baseName === '') {
        return;
      }
      callSite.setReceiverTypeName(baseName);
      const base = this.localTypeAt(callee, baseName);
      if (base && this.resolveMemberOfType(base, member, callSite, argumentCount,
        TsResolutionEvidence.SUPER_MEMBER)) {
        return;
      }
      this.handoffs.push({
        callSite,
        hop: 'RECEIVER_DECLARED_TYPE',
        localName: '',
        receiverTypeName: baseName,
        declaringModuleHash: this.input.moduleHash,
      });
      return;
    }
    if (!ts.isIdentifier(receiver)) {
      // A call result, an element access, an IIFE. Each needs the receiver's
      // INFERRED type, which is the checker's answer and not the parser's.
      return;
    }

    const binding = this.lookup(receiver, receiver.text);
    if (!binding) {
      if (AMBIENT_GLOBALS.has(receiver.text)) {
        callSite.setReceiverTypeName(receiver.text);
        callSite.setExternalTarget(TsResolvedTargetKind.LIB_SIGNATURE,
          TsResolutionEvidence.AMBIENT_GLOBAL);
        this.stats.externalTerminal += 1;
      }
      return;
    }
    if (binding.kind === TsBoundKind.ImportBinding) {
      this.handoffs.push({
        callSite,
        hop: 'IMPORTED_NAME',
        localName: receiver.text,
        receiverTypeName: '',
        declaringModuleHash: this.input.moduleHash,
      });
      return;
    }
    if (binding.kind === TsBoundKind.ModuleDeclaration) {
      // `Namespace.fn()` — the member lives in the namespace's own table, so
      // it is a group-key lookup rather than a member lookup.
      const nsGroup = binding.declarationGroupKey;
      const candidates = this.methodsByGroup.get(
        groupKeyForNamespaceMember(nsGroup, member)
      );
      callSite.setReceiverTypeName(binding.name);
      if (candidates && candidates.length > 0) {
        const chosen = chooseByArity(candidates, argumentCount);
        if (chosen) {
          this.applyTarget(callSite, chosen,
            candidates.length > 1 ? candidates.indexOf(chosen) : undefined,
            candidates.length, candidates.length > 1,
            TsResolutionEvidence.NAMESPACE_QUALIFIED);
          return;
        }
        this.recordCandidatesOnly(callSite, candidates.length);
      }
      return;
    }
    if (binding.kind === TsBoundKind.EnumDeclaration
      || binding.kind === TsBoundKind.ClassDeclaration) {
      // A STATIC member call: the receiver names the type itself.
      callSite.setReceiverTypeName(binding.name);
      const typeHash = this.input.typeHashByNode.get(nodeId(binding.node, this.sf));
      const type = typeHash ? this.typeByHash(typeHash) : undefined;
      if (type && this.resolveMemberOfType(type, member, callSite, argumentCount,
        TsResolutionEvidence.DECLARED_RECEIVER_TYPE, true)) {
        return;
      }
      this.handoffs.push({
        callSite,
        hop: 'RECEIVER_DECLARED_TYPE',
        localName: '',
        receiverTypeName: binding.name,
        declaringModuleHash: this.input.moduleHash,
      });
      return;
    }

    // PATH 1 — the primary mechanism, and the reason this schema is Java-shaped.
    // The receiver's DECLARED type is written at its declaration site, so the
    // hop from receiver to type is syntax rather than inference.
    const declaredTypeName = this.declaredTypeNameOf(binding);
    if (declaredTypeName === '') {
      return;
    }
    // AS WRITTEN. `Row[]`, `Promise<User>` and `Parser.SyntaxNode` go into the
    // column verbatim, because the engine is what knows how to read a type
    // expression and reducing it here is what produced the one wrong link this
    // parser has ever emitted.
    callSite.setReceiverTypeName(declaredTypeName);
    const type = this.localTypeAt(receiver, declaredTypeName);
    if (type && this.resolveMemberOfType(type, member, callSite, argumentCount,
      TsResolutionEvidence.DECLARED_RECEIVER_TYPE)) {
      return;
    }
    this.handoffs.push({
      callSite,
      hop: 'RECEIVER_DECLARED_TYPE',
      localName: '',
      receiverTypeName: declaredTypeName,
      declaringModuleHash: this.input.moduleHash,
    });
  }

  /**
   * The `ts_type` an annotation names, resolved THROUGH THE SCOPE CHAIN.
   *
   * Two guards, and each closes a whole class of wrong link.
   *
   * **Only a bare identifier counts.** `Row[]`, `readonly Row[]`,
   * `Promise<Row>`, `Map<K, Row>`, `Row | null`, `Parser.SyntaxNode` and
   * `string` all return nothing, because none of them NAMES a declaration —
   * they name `Array`, `Promise`, `Map`, a union, an imported namespace member
   * and a primitive. An earlier version reduced `Row[]` to `Row` and looked
   * `Row` up, so a project type with a member colliding with an `Array` method
   * would have taken a call belonging to `Array`. Refusing anything that is not
   * a bare identifier fixes the class with no list to maintain.
   *
   * **The name is resolved from the RECEIVER'S POSITION, not from a flat table.**
   * This is the guard the corpus caught:
   *
   * ```ts
   * const map = new Map<string, Row>();   // the GLOBAL Map
   * map.get("k");                          // → lib Map.get
   *
   * function elsewhere() {
   *     class Map { get(k: string) { … } } // a LOCAL Map, in another scope
   * }
   * ```
   *
   * A per-file map keyed by name finds the local `class Map` and resolves
   * `map.get` to it — a wrong target that looks exactly like a right one. Asking
   * the binder what `Map` means AT THAT POSITION gives the answer tsc gives,
   * and makes shadowing correct by construction rather than by exclusion list.
   */
  private localTypeAt(node: ts.Node, annotation: string): TsTypeRegistry | undefined {
    const text = annotation.trim();
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) {
      return undefined;
    }
    const binding = this.lookup(node, text);
    if (!binding) {
      return undefined;
    }
    // Only a TYPE-space declaration can be a receiver's type. A variable or a
    // parameter of the same name shadows the type for VALUE lookups and must
    // not be mistaken for one here.
    if (binding.kind !== TsBoundKind.ClassDeclaration
      && binding.kind !== TsBoundKind.InterfaceDeclaration
      && binding.kind !== TsBoundKind.TypeAliasDeclaration
      && binding.kind !== TsBoundKind.EnumDeclaration) {
      return undefined;
    }
    const hash = this.input.typeHashByNode.get(nodeId(binding.node, this.sf));
    return hash ? this.typeByHash(hash) : undefined;
  }

  /**
   * Finds a member on a type declared IN THIS FILE, over the merged group and
   * the part of the `extends` chain that is also in this file.
   *
   * Returns whether it resolved, so the caller can hand the call to the engine
   * instead of leaving it silently empty. A base class one import away is the
   * common miss and it is not a gap: `ts_type_heritage.inheritsMembers` plus the
   * import row is the hop, and the engine makes it.
   *
   * Walking an `IMPLEMENTS_CLAUSE` row here would be correct in Java and wrong
   * here — `implements` inherits nothing — so only `extends` is followed.
   */
  private resolveMemberOfType(
    type: TsTypeRegistry,
    member: string,
    callSite: TsCallSiteRegistry,
    argumentCount: number,
    evidence: TsResolutionEvidence,
    staticOnly = false
  ): boolean {
    const escaped = escapeName(member);
    const seen = new Set<string>();
    let group: string | undefined = type.declarationGroupKey;
    while (group !== undefined && !seen.has(group)) {
      seen.add(group);
      // Over the MERGED type: an overload contributed by a second declaration of
      // the same interface in this file is a candidate like any other.
      const candidates = (this.methodsByOwnerGroup.get(group) ?? [])
        .filter((m) => m.escapedName === escaped && m.isStatic === staticOnly);
      if (candidates.length > 0) {
        const chosen = chooseByArity(candidates, argumentCount);
        if (!chosen) {
          this.recordCandidatesOnly(callSite, candidates.length);
          return true;
        }
        this.applyTarget(callSite, chosen,
          candidates.length > 1 ? candidates.indexOf(chosen) : undefined,
          candidates.length, candidates.length > 1, evidence);
        return true;
      }
      group = this.extendsGroupInThisFile(group);
    }
    return false;
  }

  /** The `extends` base of a merged type, only when that base is declared in this file. */
  private extendsGroupInThisFile(group: string): string | undefined {
    for (const declaration of this.typeDeclarationsByGroup.get(group) ?? []) {
      const node = this.input.binder.declarationsInOrder
        .find((d) => d.declarationGroupKey === declaration.declarationGroupKey)?.node;
      const clauses = (node as { heritageClauses?: ts.NodeArray<ts.HeritageClause> } | undefined)
        ?.heritageClauses;
      for (const clause of clauses ?? []) {
        if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
          continue;
        }
        for (const type of clause.types) {
          if (!ts.isIdentifier(type.expression)) {
            continue;
          }
          const base = this.typeByName.get(type.expression.text);
          if (base && base.declarationGroupKey !== group) {
            return base.declarationGroupKey;
          }
        }
      }
    }
    return undefined;
  }

  private enclosingType(node: ts.Node): TsTypeRegistry | undefined {
    let current: ts.Node | undefined = node.parent;
    while (current) {
      if (ts.isClassLike(current)) {
        const hash = this.input.typeHashByNode.get(nodeId(current, this.sf));
        return hash ? this.typeByHash(hash) : undefined;
      }
      current = current.parent;
    }
    return undefined;
  }

  private typeByHash(hash: string): TsTypeRegistry | undefined {
    for (const type of this.input.types) {
      if (type.getHash() === hash) {
        return type;
      }
    }
    return undefined;
  }

  /**
   * The receiver's DECLARED type name — the annotation written at its
   * declaration site.
   *
   * 85.3% of parameters and 99.998% of ambient parameters carry one, which is
   * the inverse of Python's 31.8% and the whole reason a syntax-directed parser
   * gets useful resolution here without a binder-driven inference pass.
   */
  private declaredTypeNameOf(binding: BoundDeclaration): string {
    const annotated = binding.node as { type?: ts.TypeNode };
    if (annotated.type) {
      return annotated.type.getText(this.sf);
    }
    if (binding.kind === TsBoundKind.VariableDeclaration
      && ts.isVariableDeclaration(binding.node)) {
      const initializer = binding.node.initializer;
      // No annotation, but `new C()` names the type as plainly as an annotation
      // would. This is a syntactic fact, not an inference: the constructor call
      // is written down.
      if (initializer && ts.isNewExpression(initializer)
        && ts.isIdentifier(initializer.expression)) {
        return initializer.expression.text;
      }
    }
    return '';
  }

  /**
   * The call signature a binding's ANNOTATION denotes, if it denotes one.
   *
   * Two shapes, both purely syntactic:
   *   `const f: (a: T) => R`   the annotation IS a function type
   *   `const f: Callback`      the annotation names an alias whose RHS is one
   *
   * Anything else — a generic instantiation, an interface with a call
   * signature, an intersection — needs the checker, and returns nothing rather
   * than a plausible guess.
   */
  private declaredCallSignatureOf(binding: BoundDeclaration): TsMethodRegistry | undefined {
    const annotation = (binding.node as { type?: ts.TypeNode }).type;
    if (!annotation) {
      return undefined;
    }
    const target = ts.isFunctionTypeNode(annotation) || ts.isConstructorTypeNode(annotation)
      ? annotation
      : ts.isTypeReferenceNode(annotation) && ts.isIdentifier(annotation.typeName)
        ? this.input.typeAliasTargetByName.get(annotation.typeName.text)
        : undefined;
    if (!target || !(ts.isFunctionTypeNode(target) || ts.isConstructorTypeNode(target))) {
      return undefined;
    }
    const hash = this.input.methodHashByNode.get(nodeId(target, this.sf));
    return hash ? this.methodByHash.get(hash) : undefined;
  }

  private chooseFromGroup(
    method: TsMethodRegistry,
    callSite: TsCallSiteRegistry,
    argumentCount: number,
    evidence: TsResolutionEvidence
  ): void {
    const group = method.declarationGroupKey !== ''
      ? this.methodsByGroup.get(method.declarationGroupKey) ?? [method]
      : [method];
    const chosen = chooseByArity(group, argumentCount);
    if (!chosen) {
      this.recordCandidatesOnly(callSite, group.length);
      return;
    }
    this.applyTarget(callSite, chosen, group.length > 1 ? group.indexOf(chosen) : undefined,
      group.length, group.length > 1, evidence);
  }

  private applyTarget(
    callSite: TsCallSiteRegistry,
    method: TsMethodRegistry,
    overloadIndex: number | undefined,
    candidateCount: number,
    isOverloadResolved: boolean,
    evidence: TsResolutionEvidence
  ): void {
    const bodiless = method.bodyPresence !== TsBodyPresence.HAS_BODY;
    callSite.setResolution({
      // ONE SIGNATURE, never a name.
      resolvedSignatureLinkHash: method.getHash(),
      resolvedGroupKey: method.declarationGroupKey,
      resolvedTargetKind: method.bodyPresence === TsBodyPresence.NO_BODY_AMBIENT
        ? TsResolvedTargetKind.AMBIENT_SIGNATURE
        : bodiless
          ? TsResolvedTargetKind.PROJECT_SIGNATURE
          : TsResolvedTargetKind.PROJECT_IMPLEMENTATION,
      resolvedOverloadIndex: overloadIndex,
      overloadCandidateCount: candidateCount,
      isOverloadResolved,
      resolutionEvidence: evidence,
      // The column that stops a bodiless target being read as the code that
      // runs. 44.3% of real targets are bodiless.
      isAmbientTarget: bodiless,
    });
    this.stats.resolvedLocally += 1;
  }

  /**
   * Records that a real overload set was found and NOT chosen from.
   *
   * This is the honest half of the 77.6% number: where arity admits several
   * signatures, choosing needs argument TYPES. Recording the candidate count
   * with an empty target says "a set was seen, none was picked" — which a rule
   * can distinguish from "nothing was found", and a gate can measure.
   */
  private recordCandidatesOnly(callSite: TsCallSiteRegistry, candidateCount: number): void {
    callSite.setResolution({
      resolvedSignatureLinkHash: '',
      resolvedGroupKey: '',
      resolvedTargetKind: TsResolvedTargetKind.UNRESOLVED,
      resolvedOverloadIndex: undefined,
      overloadCandidateCount: candidateCount,
      isOverloadResolved: false,
      resolutionEvidence: TsResolutionEvidence.NONE,
      isAmbientTarget: false,
    });
  }
}

/**
 * The declaration that owns a binding pattern: a VariableDeclaration or a
 * Parameter.
 *
 * The walk crosses ONLY binding-pattern nodes, so it cannot leave the
 * declaration it started inside. An unbounded walk to the nearest
 * VariableDeclaration leaves the function entirely when the pattern belongs to
 * a parameter, and attributes the name to an unrelated outer variable.
 */
function enclosingBindingOwner(node: ts.Node): ts.VariableDeclaration | ts.ParameterDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isVariableDeclaration(current)) {
      return current;
    }
    if (ts.isParameter(current)) {
      return current;
    }
    if (!ts.isBindingElement(current)
      && !ts.isObjectBindingPattern(current)
      && !ts.isArrayBindingPattern(current)) {
      return undefined;
    }
    current = current.parent;
  }
  return undefined;
}

function callArgumentCount(node: ts.Node): number {
  if (ts.isCallExpression(node)) {
    return node.arguments.length;
  }
  if (ts.isNewExpression(node)) {
    return node.arguments?.length ?? 0;
  }
  return 0;
}

/**
 * Selects the ONE signature an argument count admits, or nothing.
 *
 * Deliberately refuses to pick when several remain. A parser that resolves by
 * name and takes the first declaration is wrong on 77.6% of real overloaded
 * calls, so a wrong pick here is worse than an empty column: the empty column
 * becomes a measured rate, and the wrong pick becomes a fact nothing downstream
 * can question.
 */
function chooseByArity(
  candidates: readonly TsMethodRegistry[],
  argumentCount: number
): TsMethodRegistry | undefined {
  if (candidates.length === 1) {
    return candidates[0];
  }
  const viable = candidates.filter((candidate) => {
    const required = candidate.parameterCount - candidate.optionalParameterCount;
    if (argumentCount < required) {
      return false;
    }
    if (candidate.restParameterIndex !== undefined) {
      return true;
    }
    return argumentCount <= candidate.parameterCount;
  });
  return viable.length === 1 ? viable[0] : undefined;
}


/**
 * A namespace member's group key.
 *
 * Rebuilt from the namespace's own group key and the member name, exactly as
 * the binder built it, because `NS:<group key>` is the merge scope a namespace
 * mints for its exported members.
 */
function groupKeyForNamespaceMember(namespaceGroupKey: string, member: string): string {
  return declarationGroupKeyFor(`NS:${namespaceGroupKey}`, escapeName(member));
}

/**
 * Names that resolve outside this analysis.
 *
 * A curated set, not "anything not found". The difference matters: an unfound
 * name that is genuinely a project name is a resolution GAP and should be
 * counted as one, while `console` is a resolution TERMINAL that the engine
 * closes from `lib_ts_*`. Collapsing the two would report the gap as success.
 */
const AMBIENT_GLOBALS = new Set([
  'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol',
  'BigInt', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'EvalError', 'ReferenceError', 'URIError', 'AggregateError', 'Promise', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'WeakRef', 'Proxy', 'Reflect', 'globalThis', 'Function',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array',
  'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'Atomics',
  'Intl', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'decodeURI',
  'encodeURIComponent', 'decodeURIComponent', 'structuredClone', 'queueMicrotask',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
  'process', 'Buffer', 'require', 'module', 'exports', '__dirname', '__filename',
  'fetch', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController',
  'AbortSignal', 'Event', 'EventTarget', 'performance', 'crypto',
  // Web/DOM globals. A curated set is the ONLY mechanism available for globals —
  // unlike a type name, a global has no import row to point at — so this list
  // exists where the equivalent list for TYPE names was deliberately removed.
  // Measured on a third-party corpus: `btoa`, `atob` and `Headers` were 7 of 12
  // reported gaps, and all three are globals with nothing for the parser to link.
  'btoa', 'atob', 'Headers', 'Request', 'Response', 'FormData', 'Blob', 'File',
  'FileReader', 'ReadableStream', 'WritableStream', 'TransformStream', 'WebSocket',
  'BroadcastChannel', 'MessageChannel', 'MessagePort', 'Worker', 'navigator', 'window',
  'document', 'location', 'history', 'localStorage', 'sessionStorage', 'indexedDB',
  'alert', 'confirm', 'prompt', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'CustomEvent', 'DOMException', 'reportError', 'Image', 'Audio', 'XMLHttpRequest',
]);
