import { TsCallSiteRegistry } from '@/analysis-types/typescript/TsCallSiteRegistry';
import { TsFieldRegistry } from '@/analysis-types/typescript/TsFieldRegistry';
import { TsMethodRegistry } from '@/analysis-types/typescript/TsMethodRegistry';
import { TsTypeHeritageRegistry } from '@/analysis-types/typescript/TsTypeHeritageRegistry';
import { TsTypeRegistry } from '@/analysis-types/typescript/TsTypeRegistry';
import { TS_ANONYMOUS_METHOD_NAMES } from '@/constants/typescript-constants';
import {
  TsResolutionEvidence,
  TsResolvedTargetKind,
} from '@/enums/typescript/call-sites';
import { TsBodyPresence } from '@/enums/typescript/methods';
import { TsTypeCategory } from '@/enums/typescript/types';
import { escapeName } from '@/parsers/typescript/extractors/ts-binder';
import { TsFileFacts } from '@/parsers/typescript/extractors/ts-fact-extractor';

/**
 * Finishes the calls whose target is in another module — Paths 1, 2 and 4 across
 * the file boundary.
 *
 * ## Why this cannot happen during extraction
 *
 * `import { build } from "./helpers"` needs helpers.ts to have been parsed, and
 * a sorted file list is not a dependency order. More importantly, a MERGED type
 * can span files: an interface declared in one file and augmented in another is
 * one type with one member set, and a member lookup that runs before both files
 * are read sees half of it.
 *
 * ## Why it matters more than it looks
 *
 * Measured on this repository's own 317 TypeScript files before this pass
 * existed: `DECLARED_RECEIVER_TYPE` — the schema's PRIMARY resolution mechanism,
 * the one 85.3% annotation coverage is supposed to make work — fired on **26 of
 * 11,529 call sites**. Not because the mechanism is wrong, but because a
 * receiver's declared type is almost always declared in a DIFFERENT FILE, and a
 * per-file resolver has no way to reach it.
 *
 * On the fixture corpus the same code looked healthy, because fixtures are small
 * and self-contained. That is the exact shape of the failure the Python work
 * paid for: a fixture-only win reading as a corpus win.
 */
export interface ProjectResolutionReport {
  readonly callSites: number;
  readonly resolvedToSignature: number;
  readonly externalTerminal: number;
  readonly synthesized: number;
  readonly candidatesOnly: number;
  readonly unresolved: number;
  readonly byReceiverKind: Record<string, { total: number; resolved: number }>;
  readonly byEvidence: Record<string, number>;
}

export class TsProjectResolver {
  /** Module hash -> that file's facts, for its import map. */
  private readonly factsByModule = new Map<string, TsFileFacts>();
  /** Module hash -> declared type name -> the declarations of that name. */
  private readonly typesByModuleAndName = new Map<string, Map<string, TsTypeRegistry[]>>();
  /**
   * Owner `declarationGroupKey` -> every method of the MERGED type, ACROSS FILES.
   *
   * Global rather than per file, because that is what merging means: an
   * interface augmented in a second file contributes members to the same type,
   * and an index keyed per file would find one half of it.
   */
  private readonly methodsByOwnerGroup = new Map<string, TsMethodRegistry[]>();
  private readonly fieldsByOwnerGroup = new Map<string, TsFieldRegistry[]>();
  /** Module hash -> escaped name -> top-level functions, for Path 2. */
  private readonly exportsByModule = new Map<string, Map<string, TsMethodRegistry[]>>();
  private readonly typeByHash = new Map<string, TsTypeRegistry>();
  private readonly typeGroupByHash = new Map<string, string>();
  private readonly heritageByTypeHash = new Map<string, TsTypeHeritageRegistry[]>();
  /** Group key -> every declaration of that merged type. */
  private readonly declarationsByGroup = new Map<string, TsTypeRegistry[]>();

  constructor(private readonly files: readonly TsFileFacts[]) {
    for (const facts of files) {
      this.factsByModule.set(facts.fileModuleHash, facts);
      const byName = new Map<string, TsTypeRegistry[]>();
      for (const type of facts.types) {
        this.typeByHash.set(type.getHash(), type);
        this.typeGroupByHash.set(type.getHash(), type.declarationGroupKey);
        push(this.declarationsByGroup, type.declarationGroupKey, type);
        if (type.name !== '') {
          push(byName, type.name, type);
        }
      }
      this.typesByModuleAndName.set(facts.fileModuleHash, byName);

      const exported = new Map<string, TsMethodRegistry[]>();
      for (const method of facts.methods) {
        if (method.tsTypeLinkHash === '') {
          push(exported, method.escapedName, method);
          continue;
        }
        const group = this.typeGroupByHash.get(method.tsTypeLinkHash);
        if (group !== undefined) {
          push(this.methodsByOwnerGroup, group, method);
        }
      }
      this.exportsByModule.set(facts.fileModuleHash, exported);

      for (const field of facts.fields) {
        const group = this.typeGroupByHash.get(field.tsTypeLinkHash);
        if (group !== undefined) {
          push(this.fieldsByOwnerGroup, group, field);
        }
      }
      for (const heritage of facts.heritages) {
        push(this.heritageByTypeHash, heritage.tsTypeLinkHash, heritage);
      }
    }
  }

  run(): ProjectResolutionReport {
    for (const facts of this.files) {
      for (const deferred of facts.deferredCalls) {
        switch (deferred.kind) {
          case 'IMPORTED_CALLEE': {
            this.resolveImportedCallee(facts, deferred.callSite, deferred.localName,
              deferred.argumentCount);
            break;
          }
          case 'IMPORTED_CONSTRUCTION': {
            this.resolveImportedConstruction(facts, deferred.callSite, deferred.localName,
              deferred.argumentCount);
            break;
          }
          case 'NAMESPACE_MEMBER': {
            this.resolveNamespaceMember(facts, deferred.callSite, deferred.localName,
              deferred.member, deferred.argumentCount);
            break;
          }
          case 'TYPE_CONSTRUCTION': {
            // `super(...)`. The base class is named in this file's heritage
            // clause and is usually imported, so the name is resolved from the
            // declaring module exactly as any other type name would be.
            const type = this.resolveTypeName(facts.fileModuleHash, deferred.typeName);
            if (type) {
              this.resolveConstructorOfGroup(type.declarationGroupKey, deferred.callSite,
                deferred.argumentCount);
            } else if (this.isExternalTypeName(facts.fileModuleHash, deferred.typeName)) {
              deferred.callSite.setExternalTarget(TsResolvedTargetKind.LIB_SIGNATURE,
                TsResolutionEvidence.SUPER_MEMBER);
            }
            break;
          }
          case 'RECEIVER_TYPE_MEMBER': {
            this.resolveReceiverTypeMember(facts, deferred);
            break;
          }
          default: {
            break;
          }
        }
      }
    }
    return this.report();
  }

  // -------------------------------------------------------------------------
  // Path 2 — through an import
  // -------------------------------------------------------------------------

  private resolveImportedCallee(
    facts: TsFileFacts,
    callSite: TsCallSiteRegistry,
    localName: string,
    argumentCount: number
  ): void {
    const importRow = facts.importByLocalName.get(localName);
    if (!importRow) {
      return;
    }
    const targetModule = importRow.getResolvedModuleLinkHash();
    if (targetModule === '') {
      this.markExternalIfKnown(callSite, facts, localName);
      return;
    }
    const exported = importRow.originalName !== '' ? importRow.originalName : localName;
    const candidates = this.exportsByModule.get(targetModule)?.get(escapeName(exported));
    if (candidates && candidates.length > 0) {
      this.apply(callSite, candidates, argumentCount, TsResolutionEvidence.IMPORT_BINDING);
      return;
    }
    // An imported name that is not a function may still be callable: a `const`
    // bound to an arrow. 161 measured call targets are arrows, and every one is
    // reached through the variable rather than by name.
    const target = this.factsByModule.get(targetModule);
    for (const variable of target?.variables ?? []) {
      if (variable.name !== exported) {
        continue;
      }
      const bound = variable.getBoundFunctionLinkHash();
      if (bound === '') {
        continue;
      }
      const method = (target?.methods ?? []).find((m) => m.getHash() === bound);
      if (method) {
        this.apply(callSite, [method], argumentCount, TsResolutionEvidence.IMPORT_BINDING);
        return;
      }
    }
  }

  private resolveImportedConstruction(
    facts: TsFileFacts,
    callSite: TsCallSiteRegistry,
    localName: string,
    argumentCount: number
  ): void {
    const importRow = facts.importByLocalName.get(localName);
    if (!importRow) {
      return;
    }
    const targetModule = importRow.getResolvedModuleLinkHash();
    if (targetModule === '') {
      this.markExternalIfKnown(callSite, facts, localName);
      return;
    }
    const exported = importRow.originalName !== '' ? importRow.originalName : localName;
    const type = this.typesByModuleAndName.get(targetModule)?.get(exported)?.[0];
    if (!type) {
      return;
    }
    callSite.setReceiverTypeName(type.name);
    this.resolveConstructorOfGroup(type.declarationGroupKey, callSite, argumentCount);
  }

  private resolveNamespaceMember(
    facts: TsFileFacts,
    callSite: TsCallSiteRegistry,
    localName: string,
    member: string,
    argumentCount: number
  ): void {
    const importRow = facts.importByLocalName.get(localName);
    if (!importRow) {
      return;
    }
    const targetModule = importRow.getResolvedModuleLinkHash();
    if (targetModule === '') {
      this.markExternalIfKnown(callSite, facts, localName);
      return;
    }
    if (importRow.isWildcard) {
      // `import * as ns; ns.f()` — the member IS a top-level export of the
      // target module.
      const candidates = this.exportsByModule.get(targetModule)?.get(escapeName(member));
      if (candidates && candidates.length > 0) {
        this.apply(callSite, candidates, argumentCount, TsResolutionEvidence.IMPORT_BINDING);
      }
      return;
    }
    // A named import used as a receiver: `import { repo } from "x"; repo.find()`.
    // The member lives on the imported VALUE's declared type, so this is Path 1
    // starting from another module's variable.
    const target = this.factsByModule.get(targetModule);
    const exported = importRow.originalName !== '' ? importRow.originalName : localName;
    for (const variable of target?.variables ?? []) {
      if (variable.name !== exported || variable.variableTypeName === '') {
        continue;
      }
      const typeName = bareTypeName(variable.variableTypeName);
      callSite.setReceiverTypeName(typeName);
      const type = this.resolveTypeName(targetModule, typeName);
      if (type) {
        this.findMember(type.declarationGroupKey, member, false, argumentCount, callSite,
          TsResolutionEvidence.DECLARED_RECEIVER_TYPE);
        return;
      }
      if (this.isExternalTypeName(targetModule, typeName)) {
        callSite.setExternalTarget(TsResolvedTargetKind.LIB_SIGNATURE,
          TsResolutionEvidence.DECLARED_RECEIVER_TYPE);
      }
      return;
    }
  }

  // -------------------------------------------------------------------------
  // Path 1 — declared receiver type, across modules and through chains
  // -------------------------------------------------------------------------

  private resolveReceiverTypeMember(
    facts: TsFileFacts,
    deferred: {
      callSite: TsCallSiteRegistry; rootTypeName: string; rootTypeQualifier: string;
      members: readonly string[]; member: string; isStatic: boolean; argumentCount: number;
    }
  ): void {
    let type = this.resolveTypeName(facts.fileModuleHash, deferred.rootTypeName);
    if (!type) {
      // The receiver's type is declared outside this analysis. That is an
      // honest TERMINAL, not a failure: the target exists, it lives in
      // `lib_ts_*`, and the closed-world gate counts it as closed.
      if (this.isExternalTypeName(facts.fileModuleHash, deferred.rootTypeName)
        || this.isExternalTypeName(facts.fileModuleHash, deferred.rootTypeQualifier)) {
        deferred.callSite.setExternalTarget(TsResolvedTargetKind.LIB_SIGNATURE,
          TsResolutionEvidence.DECLARED_RECEIVER_TYPE);
      }
      return;
    }
    let isStatic = deferred.isStatic;
    // Walk the property chain, one declared type at a time. Every hop is a
    // syntactic fact — the annotation at a declaration site — and every hop may
    // land in a different file, which is why it happens here and not per file.
    for (const hop of deferred.members) {
      const field = this.findField(type.declarationGroupKey, hop, isStatic);
      if (!field || field.fieldTypeName === '') {
        return;
      }
      const hopTypeName = bareTypeName(field.fieldTypeName);
      const next = this.resolveTypeNameFromDeclaringModule(field, hopTypeName);
      if (!next) {
        if (this.isExternalTypeName(field.tsModuleLinkHash, hopTypeName)) {
          deferred.callSite.setExternalTarget(TsResolvedTargetKind.LIB_SIGNATURE,
            TsResolutionEvidence.DECLARED_RECEIVER_TYPE);
        }
        return;
      }
      type = next;
      isStatic = false;
    }
    this.findMember(type.declarationGroupKey, deferred.member, isStatic, deferred.argumentCount,
      deferred.callSite, TsResolutionEvidence.DECLARED_RECEIVER_TYPE);
  }

  /**
   * A type NAME, resolved from the module that wrote it.
   *
   * Local declarations first, then the file's imports. Both are syntax: the name
   * is either declared here or bound here by an import whose specifier
   * `ts.resolveModuleName` already resolved. Nothing is inferred.
   */
  private resolveTypeName(moduleHash: string, name: string): TsTypeRegistry | undefined {
    const local = this.typesByModuleAndName.get(moduleHash)?.get(name)?.[0];
    if (local) {
      return local;
    }
    const facts = this.factsByModule.get(moduleHash);
    const importRow = facts?.importByLocalName.get(name);
    if (!importRow) {
      return undefined;
    }
    const targetModule = importRow.getResolvedModuleLinkHash();
    if (targetModule === '') {
      return undefined;
    }
    const exported = importRow.originalName !== '' ? importRow.originalName : name;
    return this.typesByModuleAndName.get(targetModule)?.get(exported)?.[0];
  }

  private resolveTypeNameFromDeclaringModule(
    field: TsFieldRegistry,
    name: string
  ): TsTypeRegistry | undefined {
    return this.resolveTypeName(field.tsModuleLinkHash, name);
  }

  /**
   * Is a type name that did not resolve declared OUTSIDE this analysis?
   *
   * Two kinds of evidence, both syntactic, and neither of them "it did not
   * resolve so it must be external" — that reasoning would bury every genuine
   * resolution gap as a terminal and make the closed-world number meaningless.
   *
   *   1. The name is a known `lib.*.d.ts` type: `string`, `Array`, `Promise`.
   *   2. The name is bound by an IMPORT whose specifier `ts.resolveModuleName`
   *      resolved to a file this analysis did not read — `node_modules`, or a
   *      package's bundled `.d.ts`. The compiler told us where it lives.
   *
   * Anything else stays unresolved and keeps being counted as a gap.
   */
  private isExternalTypeName(moduleHash: string, name: string): boolean {
    if (name === '') {
      return false;
    }
    if (LIB_TYPE_NAMES.has(name)) {
      return true;
    }
    const importRow = this.factsByModule.get(moduleHash)?.importByLocalName.get(name);
    return importRow !== undefined
      && importRow.isExternalTarget
      && importRow.resolvedFilePath !== '';
  }

  // -------------------------------------------------------------------------
  // member lookup over the merged type and its `extends` chain
  // -------------------------------------------------------------------------

  private findMember(
    group: string,
    member: string,
    isStatic: boolean,
    argumentCount: number,
    callSite: TsCallSiteRegistry,
    evidence: TsResolutionEvidence
  ): void {
    const escaped = escapeName(member);
    const seen = new Set<string>();
    let current: string | undefined = group;
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      const candidates = (this.methodsByOwnerGroup.get(current) ?? [])
        .filter((m) => m.escapedName === escaped && m.isStatic === isStatic);
      if (candidates.length > 0) {
        this.apply(callSite, candidates, argumentCount, evidence);
        return;
      }
      // A field holding a function — `readonly run: () => void` — is a call
      // target too, reached through the annotation's own signature row.
      const field = this.findField(current, member, isStatic);
      if (field) {
        const signature = this.functionTypeSignatureFor(field);
        if (signature) {
          this.apply(callSite, [signature], argumentCount, evidence);
        }
        return;
      }
      current = this.extendsGroupOf(current);
    }
  }

  private findField(group: string, name: string, isStatic: boolean): TsFieldRegistry | undefined {
    const escaped = escapeName(name);
    const seen = new Set<string>();
    let current: string | undefined = group;
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      const match = (this.fieldsByOwnerGroup.get(current) ?? [])
        .find((f) => escapeName(f.name) === escaped && f.isStatic === isStatic);
      if (match) {
        return match;
      }
      current = this.extendsGroupOf(current);
    }
    return undefined;
  }

  /**
   * The `extends` supertype of a MERGED type — and only `extends`.
   *
   * `inheritsMembers` is the column that decides it. Walking an
   * `IMPLEMENTS_CLAUSE` row here is correct in Java and wrong here: `implements`
   * inherits nothing, so a member found through one does not exist on the
   * receiver. 60.4% of classes declare no `implements` at all, which is also why
   * the reverse direction — finding an implementation from a signature — is
   * `ts_type_satisfies`, the engine's job and not the parser's.
   */
  private extendsGroupOf(group: string): string | undefined {
    for (const declaration of this.declarationsByGroup.get(group) ?? []) {
      for (const heritage of this.heritageByTypeHash.get(declaration.getHash()) ?? []) {
        if (!heritage.inheritsMembers || heritage.heritageSimpleName === '') {
          continue;
        }
        const base = this.resolveTypeName(declaration.tsModuleLinkHash,
          heritage.heritageSimpleName);
        if (base && base.declarationGroupKey !== group) {
          return base.declarationGroupKey;
        }
      }
    }
    return undefined;
  }

  private functionTypeSignatureFor(field: TsFieldRegistry): TsMethodRegistry | undefined {
    const facts = this.factsByModule.get(field.tsModuleLinkHash);
    if (!facts) {
      return undefined;
    }
    // The function-type signature row minted for this annotation sits inside the
    // same file and starts within the field's own span.
    return facts.methods.find((m) =>
      m.methodKind === 'FUNCTION_TYPE_SIGNATURE'
      && m.startLine >= field.startLine
      && m.startLine <= field.endLine);
  }

  private resolveConstructorOfGroup(
    group: string,
    callSite: TsCallSiteRegistry,
    argumentCount: number
  ): void {
    const constructors = (this.methodsByOwnerGroup.get(group) ?? [])
      .filter((m) => m.name === TS_ANONYMOUS_METHOD_NAMES.CONSTRUCTOR);
    if (constructors.length > 0) {
      this.apply(callSite, constructors, argumentCount, TsResolutionEvidence.IMPORT_BINDING);
      return;
    }
    const base = this.extendsGroupOf(group);
    if (base !== undefined) {
      // A derived class with no constructor inherits its base's. Following the
      // chain is what stops `new Derived(x)` reading as synthesized when the
      // argument it passes is declared two classes up.
      this.resolveConstructorOfGroup(base, callSite, argumentCount);
      return;
    }
    const declaration = this.declarationsByGroup.get(group)?.[0];
    if (!declaration || declaration.typeCategory !== TsTypeCategory.CLASS_TYPE) {
      return;
    }
    // 2.3% of measured call sites: an IMPLICIT constructor. There is no
    // declaration node anywhere, so an empty target would be indistinguishable
    // from a resolution failure. This is the honest terminal for it.
    callSite.setResolution({
      resolvedSignatureLinkHash: '',
      resolvedGroupKey: declaration.declarationGroupKey,
      resolvedTargetKind: TsResolvedTargetKind.SYNTHESIZED_NO_DECLARATION,
      resolvedOverloadIndex: undefined,
      overloadCandidateCount: 1,
      isOverloadResolved: false,
      resolutionEvidence: TsResolutionEvidence.IMPORT_BINDING,
      isAmbientTarget: false,
    });
  }

  /**
   * Marks a target that is knowably outside the analysis.
   *
   * Only when the import RESOLVED to a file this analysis did not read, or names
   * a Node builtin. An unresolvable specifier stays UNRESOLVED, because "I could
   * not resolve it" and "it lives in `lib_ts_*`" are different facts and the
   * closed-world gate counts only the second as closed.
   */
  private markExternalIfKnown(
    callSite: TsCallSiteRegistry,
    facts: TsFileFacts,
    localName: string
  ): void {
    const importRow = facts.importByLocalName.get(localName);
    if (!importRow) {
      return;
    }
    if (importRow.resolvedFilePath !== '' || importRow.importedPath.startsWith('node:')) {
      callSite.setExternalTarget(TsResolvedTargetKind.LIB_SIGNATURE,
        TsResolutionEvidence.IMPORT_BINDING);
    }
  }

  private apply(
    callSite: TsCallSiteRegistry,
    candidates: readonly TsMethodRegistry[],
    argumentCount: number,
    evidence: TsResolutionEvidence
  ): void {
    const chosen = chooseByArity(candidates, argumentCount);
    if (!chosen) {
      // A real overload set that arity cannot narrow. Recorded with its size and
      // an empty target: a rule can tell that apart from "nothing was found",
      // and picking the first would be wrong on 77.6% of real overloaded calls.
      callSite.setResolution({
        resolvedSignatureLinkHash: '',
        resolvedGroupKey: '',
        resolvedTargetKind: TsResolvedTargetKind.UNRESOLVED,
        resolvedOverloadIndex: undefined,
        overloadCandidateCount: candidates.length,
        isOverloadResolved: false,
        resolutionEvidence: TsResolutionEvidence.NONE,
        isAmbientTarget: false,
      });
      return;
    }
    const bodiless = chosen.bodyPresence !== TsBodyPresence.HAS_BODY;
    callSite.setResolution({
      resolvedSignatureLinkHash: chosen.getHash(),
      resolvedGroupKey: chosen.declarationGroupKey,
      resolvedTargetKind: chosen.bodyPresence === TsBodyPresence.NO_BODY_AMBIENT
        ? TsResolvedTargetKind.AMBIENT_SIGNATURE
        : bodiless
          ? TsResolvedTargetKind.PROJECT_SIGNATURE
          : TsResolvedTargetKind.PROJECT_IMPLEMENTATION,
      resolvedOverloadIndex: candidates.length > 1 ? candidates.indexOf(chosen) : undefined,
      overloadCandidateCount: candidates.length,
      isOverloadResolved: candidates.length > 1,
      resolutionEvidence: evidence,
      isAmbientTarget: bodiless,
    });
  }

  /**
   * Counted from the emitted ROWS, never from per-file tallies.
   *
   * The cross-module pass mutates rows the per-file pass already counted, so a
   * report built from tallies would describe an intermediate state that no
   * consumer ever sees.
   */
  private report(): ProjectResolutionReport {
    let resolvedToSignature = 0, externalTerminal = 0, synthesized = 0;
    let candidatesOnly = 0, unresolved = 0, callSites = 0;
    const byReceiverKind: Record<string, { total: number; resolved: number }> = {};
    const byEvidence: Record<string, number> = {};

    for (const facts of this.files) {
      for (const callSite of facts.callSites) {
        callSites += 1;
        const bucket = byReceiverKind[callSite.receiverKind]
          ?? { total: 0, resolved: 0 };
        bucket.total += 1;
        const kind = callSite.getResolvedTargetKind();
        const evidence = callSite.getResolutionEvidence();
        byEvidence[evidence] = (byEvidence[evidence] ?? 0) + 1;
        if (callSite.getResolvedSignatureLinkHash() !== '') {
          resolvedToSignature += 1;
          bucket.resolved += 1;
        } else if (kind === TsResolvedTargetKind.SYNTHESIZED_NO_DECLARATION) {
          synthesized += 1;
          bucket.resolved += 1;
        } else if (kind === TsResolvedTargetKind.LIB_SIGNATURE
          || kind === TsResolvedTargetKind.AMBIENT_SIGNATURE) {
          externalTerminal += 1;
          bucket.resolved += 1;
        } else if (callSite.getOverloadCandidateCount() > 1) {
          candidatesOnly += 1;
        } else {
          unresolved += 1;
        }
        byReceiverKind[callSite.receiverKind] = bucket;
      }
    }
    return {
      callSites,
      resolvedToSignature,
      externalTerminal,
      synthesized,
      candidatesOnly,
      unresolved,
      byReceiverKind,
      byEvidence,
    };
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}

/** Selects the ONE signature an argument count admits, or nothing. */
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
    return candidate.restParameterIndex !== undefined
      || argumentCount <= candidate.parameterCount;
  });
  return viable.length === 1 ? viable[0] : undefined;
}

/**
 * The type an annotation NAMES, reduced to a single identifier.
 *
 * `T[]` becomes **`Array`**, not `T`, and that is a correctness fix rather than
 * a nicety. Stripping the brackets says the receiver of `rows.map(…)` is a
 * `Row` — so the resolver looks for `map` on `Row`, and if any project type ever
 * declares a member whose name collides with an `Array` method, it resolves the
 * call to the WRONG declaration and the gate has no way to notice unless the
 * fixture corpus happens to contain that exact collision.
 *
 * `readonly T[]` is the same type. `Map<K, V>` keeps its head, which does not
 * resolve locally and is therefore correctly recognised as external below.
 */
function bareTypeName(annotation: string): string {
  let trimmed = annotation.trim();
  // `T | null` and `T | undefined` are the nullable idiom, and after narrowing
  // the receiver is a `T` — which is why a call on one is legal at all. A union
  // of two REAL types is genuinely ambiguous and resolves to nothing rather
  // than to whichever member happens to be written first.
  if (trimmed.includes('|')) {
    const parts = trimmed.split('|').map((p) => p.trim())
      .filter((p) => p !== 'null' && p !== 'undefined' && p !== '');
    if (parts.length !== 1) {
      return '';
    }
    trimmed = parts[0] ?? '';
  }
  trimmed = trimmed.replace(/^readonly\s+/, '');
  if (trimmed.endsWith('[]')) {
    return 'Array';
  }
  const generic = trimmed.indexOf('<');
  const base = generic < 0 ? trimmed : trimmed.slice(0, generic);
  const dot = base.lastIndexOf('.');
  return (dot < 0 ? base : base.slice(dot + 1)).trim();
}

/**
 * Type names that are declared OUTSIDE any project — `lib.*.d.ts` or a package.
 *
 * A receiver typed `string`, `Row[]` or `Map<K, V>` has a real call target and
 * it is not in this analysis: it is in `lib_ts_*`, which the closed-world gate
 * counts as CLOSED. Leaving those UNRESOLVED understates closure badly — the
 * measurement says 52.0% of real call targets are declared outside the project,
 * and on this repository the primitive- and collection-typed receivers are most
 * of that 52%.
 *
 * Curated rather than "anything that did not resolve", for the same reason the
 * ambient-globals set is curated: an unfound PROJECT type is a resolution gap
 * and must keep being counted as one.
 */
const LIB_TYPE_NAMES = new Set([
  'string', 'number', 'boolean', 'symbol', 'bigint', 'object', 'any', 'unknown', 'never',
  'void', 'undefined', 'null', 'this',
  'Array', 'ReadonlyArray', 'Map', 'ReadonlyMap', 'Set', 'ReadonlySet', 'WeakMap', 'WeakSet',
  'Promise', 'PromiseLike', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError',
  'Function', 'Object', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'JSON', 'Math',
  'Iterable', 'Iterator', 'IterableIterator', 'Generator', 'AsyncGenerator', 'AsyncIterable',
  'ArrayBuffer', 'DataView', 'Uint8Array', 'Int32Array', 'Float64Array',
  'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Exclude', 'Extract',
  'NonNullable', 'ReturnType', 'Parameters', 'Awaited', 'InstanceType',
  'Buffer', 'NodeJS', 'Console', 'URL', 'URLSearchParams', 'AbortSignal', 'TemplateStringsArray',
]);
