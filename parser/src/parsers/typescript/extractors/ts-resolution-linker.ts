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
 * Fills the resolution columns the PARSER can defend, and no others.
 *
 * ## The asymmetry this class exists to preserve
 *
 * A parser-filled `resolvedSignatureLinkHash` that disagrees with
 * `getResolvedSignature` is a HARD FAILURE at the gate. An unfilled one is a
 * measured rate. Those costs are not symmetric, so the rule is: fill it only
 * where syntax decides it, and leave it empty everywhere else. The guess
 * declined becomes a number instead of a silence.
 *
 * §4.15 names the decidable cases and this implements exactly them: a call to a
 * name with one signature in scope, a call on a receiver whose DECLARED type is
 * a locally declared class, `this.m()`, `super.m()`, `new C()`, and a
 * namespace-qualified call. Anything needing an inferred type — a call on a
 * call result, an element access, a generic instantiation — is left
 * `UNRESOLVED`, because deciding it needs the checker.
 *
 * ## Overloads are chosen by ARITY or not at all
 *
 * 77.6% of overloaded calls resolve to a non-first declaration, so picking the
 * first is wrong four times in five and is worse than picking nothing. Where
 * argument count admits exactly one signature the parser takes it; where it
 * admits several it records `overloadCandidateCount` and leaves the target
 * empty. Choosing between same-arity overloads needs argument TYPES, which is
 * the checker's job.
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

/** What a call could not be resolved to locally, for the project pass to finish. */
export interface DeferredCall {
  readonly callSite: TsCallSiteRegistry;
  /** The local name bound by an import, when the callee came through one. */
  readonly importedLocalName: string;
  /** The member being called on an imported namespace or value; `""` for a direct call. */
  readonly memberName: string;
  readonly argumentCount: number;
}

export interface LocalResolutionResult {
  readonly deferredCalls: readonly DeferredCall[];
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
  /** Declared type name -> the local `ts_type` row, for Path 1's last hop. */
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
  private readonly deferred: DeferredCall[] = [];
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
    return { deferredCalls: this.deferred, stats: this.stats };
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
        // no row of its own. It resolves to the VariableDeclaration that binds
        // it, which is the declaration site the fact base actually records.
        const owner = enclosingVariableDeclaration(binding.node);
        return {
          kind: TsReferencedEntityKind.VARIABLE,
          hash: owner
            ? this.input.variableHashByNode.get(nodeId(owner, this.sf)) ?? ''
            : '',
        };
      }
      case TsBoundKind.Parameter: {
        return {
          kind: TsReferencedEntityKind.PARAMETER,
          hash: this.input.parameterHashByNode.get(id) ?? '',
        };
      }
      case TsBoundKind.FunctionDeclaration: {
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
      // The target is in another module, which may not be parsed yet. Deferred
      // rather than guessed — the project pass has the whole file set.
      this.deferred.push({
        callSite,
        importedLocalName: callee.text,
        memberName: '',
        argumentCount,
      });
      return;
    }
    if (binding.kind === TsBoundKind.FunctionDeclaration) {
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
      this.deferred.push({
        callSite,
        importedLocalName: callee.text,
        memberName: CONSTRUCTOR_MEMBER,
        argumentCount,
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
    const baseType = this.baseClassOf(node);
    if (!baseType) {
      return;
    }
    this.resolveConstructorOf(baseType.getHash(), callSite, argumentCount);
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
      if (owner) {
        callSite.setReceiverTypeName(owner.name);
        this.resolveMemberOfType(owner, member, callSite, argumentCount,
          TsResolutionEvidence.THIS_MEMBER);
      }
      return;
    }
    if (receiver.kind === ts.SyntaxKind.SuperKeyword) {
      const base = this.baseClassOf(callee);
      if (base) {
        callSite.setReceiverTypeName(base.name);
        this.resolveMemberOfType(base, member, callSite, argumentCount,
          TsResolutionEvidence.SUPER_MEMBER);
      }
      return;
    }
    if (!ts.isIdentifier(receiver)) {
      // A property chain, a call result, an element access. Each needs the
      // receiver's INFERRED type, which is the checker's answer and not the
      // parser's.
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
      this.deferred.push({
        callSite,
        importedLocalName: receiver.text,
        memberName: member,
        argumentCount,
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
      const typeHash = this.input.typeHashByNode.get(nodeId(binding.node, this.sf));
      const type = typeHash ? this.typeByHash(typeHash) : undefined;
      if (type) {
        callSite.setReceiverTypeName(type.name);
        this.resolveMemberOfType(type, member, callSite, argumentCount,
          TsResolutionEvidence.DECLARED_RECEIVER_TYPE, true);
      }
      return;
    }

    // PATH 1 — the primary mechanism, and the reason this schema is Java-shaped.
    // The receiver's DECLARED type is written at its declaration site, so the
    // hop from receiver to type is syntax rather than inference.
    const declaredTypeName = this.declaredTypeNameOf(binding);
    if (declaredTypeName === '') {
      return;
    }
    callSite.setReceiverTypeName(declaredTypeName);
    const type = this.typeByName.get(bareTypeName(declaredTypeName));
    if (!type) {
      return;
    }
    this.resolveMemberOfType(type, member, callSite, argumentCount,
      TsResolutionEvidence.DECLARED_RECEIVER_TYPE);
  }

  /**
   * Finds a member on a type, following `extends` and ONLY `extends`.
   *
   * Walking an `IMPLEMENTS_CLAUSE` edge here is correct in Java and WRONG here:
   * `implements` inherits nothing, so a member found through it does not exist
   * on the receiver. That single distinction is what `inheritsMembers` is for.
   */
  private resolveMemberOfType(
    type: TsTypeRegistry,
    member: string,
    callSite: TsCallSiteRegistry,
    argumentCount: number,
    evidence: TsResolutionEvidence,
    staticOnly = false
  ): void {
    const seenGroups = new Set<string>();
    let group: string | undefined = type.declarationGroupKey;
    while (group !== undefined && !seenGroups.has(group)) {
      seenGroups.add(group);
      // Over the MERGED type, so an overload contributed by a second
      // declaration — or by a module augmentation in another file — is a
      // candidate like any other.
      const candidates = (this.methodsByOwnerGroup.get(group) ?? [])
        .filter((m) => m.escapedName === escapeName(member) && m.isStatic === staticOnly);
      if (candidates.length > 0) {
        const chosen = chooseByArity(candidates, argumentCount);
        if (chosen) {
          this.applyTarget(callSite, chosen,
            candidates.length > 1 ? candidates.indexOf(chosen) : undefined,
            candidates.length, candidates.length > 1, evidence);
          return;
        }
        this.recordCandidatesOnly(callSite, candidates.length);
        return;
      }
      group = this.extendsBaseGroupOf(group);
    }
  }

  /**
   * The `extends` base of a MERGED type, following `extends` and only `extends`.
   *
   * Walking an `IMPLEMENTS_CLAUSE` edge here is correct in Java and WRONG here:
   * `implements` inherits nothing, so a member found through it does not exist
   * on the receiver. That single distinction is what `inheritsMembers` records.
   */
  private extendsBaseGroupOf(group: string): string | undefined {
    for (const declaration of this.typeDeclarationsByGroup.get(group) ?? []) {
      const node = this.declarationNodeFor(declaration);
      if (!node) {
        continue;
      }
      const clauses = (node as { heritageClauses?: ts.NodeArray<ts.HeritageClause> })
        .heritageClauses;
      for (const clause of clauses ?? []) {
        if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
          continue;
        }
        for (const type of clause.types) {
          if (!ts.isIdentifier(type.expression)) {
            continue;
          }
          const baseGroup = this.groupKeyByTypeName.get(type.expression.text);
          if (baseGroup !== undefined && baseGroup !== group) {
            return baseGroup;
          }
        }
      }
    }
    return undefined;
  }

  private extendsBaseOf(type: TsTypeRegistry): TsTypeRegistry | undefined {
    const group = this.extendsBaseGroupOf(type.declarationGroupKey);
    return group === undefined
      ? undefined
      : this.typeDeclarationsByGroup.get(group)?.[0];
  }

  private baseClassOf(node: ts.Node): TsTypeRegistry | undefined {
    const owner = this.enclosingType(node);
    return owner ? this.extendsBaseOf(owner) : undefined;
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

  /** The AST node a `ts_type` row came from, matched on the recorded identity map. */
  private declarationNodeFor(type: TsTypeRegistry): ts.Node | undefined {
    for (const [id, hash] of this.input.typeHashByNode) {
      if (hash === type.getHash()) {
        return this.nodeByIdCache.get(id);
      }
    }
    return undefined;
  }

  /** Node identity -> node, populated lazily from the binder's declaration list. */
  private readonly nodeByIdCache = new Map<string, ts.Node>();

  primeNodeCache(nodes: Iterable<ts.Node>): void {
    for (const node of nodes) {
      this.nodeByIdCache.set(nodeId(node, this.sf), node);
    }
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

const CONSTRUCTOR_MEMBER = '<constructor>';

function enclosingVariableDeclaration(node: ts.Node): ts.Node | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isVariableDeclaration(current)) {
      return current;
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

function bareTypeName(annotation: string): string {
  const trimmed = annotation.trim();
  const generic = trimmed.indexOf('<');
  const base = generic < 0 ? trimmed : trimmed.slice(0, generic);
  const dot = base.lastIndexOf('.');
  return (dot < 0 ? base : base.slice(dot + 1)).replace(/\[\]$/, '').trim();
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
]);
