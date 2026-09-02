import { TsFieldRegistry } from '@/analysis-types/typescript/TsFieldRegistry';
import { TsImportRegistry } from '@/analysis-types/typescript/TsImportRegistry';
import { TsTypeRegistry } from '@/analysis-types/typescript/TsTypeRegistry';
import { TsResolvedTargetKind } from '@/enums/typescript/call-sites';
import { TsFileFacts } from '@/parsers/typescript/extractors/ts-fact-extractor';

/**
 * Measures whether the IR is COMPLETE — not whether the parser resolved.
 *
 * ## Why resolution rate is the wrong measure
 *
 * The parser emits IR; the engine builds the call graph. The Java precedent is
 * unambiguous and stronger than any count: `java_type_reference`'s
 * `referencedTypeRegistryLinkHash` is not merely empty in every output — **no
 * Java extractor contains a statement that fills it.** The engine joins
 * `typeName` against `java_type` in `type-resolution.dl`, and that is the design.
 *
 * So "26 of 11,529 call sites use the declared-receiver-type path" is not a
 * hole. The question that matters is different, and this file answers it:
 *
 *   For every call the parser did not resolve, are the facts an engine needs in
 *   order to resolve it actually present?
 *
 * ## The triple, for a receiver whose type lives in another file
 *
 *   1. the receiver's declared type NAME AS WRITTEN — `ts_call_site.receiverTypeName`
 *   2. the importing module — `ts_call_site.tsModuleLinkHash`
 *   3. `ts_import.resolvedFilePath` for the import that binds that name
 *
 * With those three the engine joins and the parser is done. A call site missing
 * any of them is a genuine parser gap. A call site missing NONE of them, and
 * still unresolved, is the parser working exactly as intended.
 *
 * ## And the hop chain, for the receiver itself
 *
 * Path 1 needs more than a name: it needs to get from the call site to the
 * receiver's DECLARATION and from there to its annotation. Each link is a column
 * the parser owns, so each is checkable here:
 *
 *   ts_call_site.receiverExpressionLinkHash
 *     -> ts_expression.referencedEntityHash
 *       -> ts_variable | ts_method_parameter | ts_field  [.typeReferenceLinkHash]
 *         -> ts_type_reference.completeTypeName
 *
 * A break anywhere in that chain is unrecoverable downstream, and invisible in
 * any resolution percentage.
 */
export interface IrCompletenessReport {
  readonly callSites: number;
  /** Links the parser emitted itself — strictly more than Java provides. */
  readonly sameFileLinks: number;
  /** Terminals: target exists and is outside the analysis, or is synthesized. */
  readonly terminals: number;
  /** Handed to the engine WITH every hop present. This is the success case. */
  readonly handedOffComplete: number;
  /** Handed to the engine with a hop MISSING. This is the number to drive down. */
  readonly handedOffIncomplete: number;
  /** Receiver type is genuinely inferred, so there is no annotation to emit. */
  readonly inferredReceiver: number;
  /**
   * The receiver's type is not derivable from SYNTAX at all — a computed member
   * on an unannotated value. Counted apart so it is neither claimed as complete
   * nor reported as a gap the parser could close.
   */
  readonly notDerivable: number;
  readonly gaps: readonly IrGap[];
  /** Per-shape outcome. PROVENANCE, not a quality measure. */
  readonly byReceiverKind: Record<string, ReceiverShapeCounts>;
}

export interface ReceiverShapeCounts {
  readonly total: number;
  readonly sameFileLinks: number;
  readonly terminals: number;
  readonly complete: number;
  readonly incomplete: number;
  readonly inferred: number;
  readonly notDerivable: number;
}

export interface IrGap {
  readonly where: string;
  readonly reason: string;
  readonly detail: string;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Links every import that names an AMBIENT MODULE declared in this analysis.
 *
 * `declare module "untyped-legacy-package" { … }` is its own `ts_module` row
 * (§3.5) precisely so that an import of that specifier has somewhere to point.
 * `ts.resolveModuleName` cannot help — there is no file — so the link comes from
 * the fact base itself, matching the specifier against `declaredSpecifier`.
 *
 * This is the MODULE graph, not the call graph, and `ts_import.resolvedModuleLinkHash`
 * is the parser's own column (§4.12 c14, FK to `ts_module`). Filling it is not
 * the retracted cross-file resolution: it stops one hop short, at the module,
 * which is exactly where the parser's job ends and `type-resolution.dl` begins.
 *
 * Wildcards are honoured because the corpus uses them: `declare module "*.svg"`
 * is the asset-import idiom and matching it literally would leave every
 * `import icon from "./x.svg"` pointing at nothing.
 */
/**
 * The MODULE-graph slice of a file's facts.
 *
 * The link passes need only these four, and naming that lets extraction stream
 * every other relation the moment a file is finished instead of holding all of
 * them until the last one is parsed.
 */
export interface ModuleGraphFacts {
  readonly filePath: string;
  readonly modules: TsFileFacts['modules'];
  readonly imports: TsFileFacts['imports'];
  readonly exports: TsFileFacts['exports'];
}

export function linkAmbientModuleImports(files: readonly ModuleGraphFacts[]): number {
  const exact = new Map<string, string>();
  const patterns: { prefix: string; suffix: string; hash: string }[] = [];
  for (const facts of files) {
    for (const module of facts.modules) {
      if (module.declaredSpecifier === '') {
        continue;
      }
      const star = module.declaredSpecifier.indexOf('*');
      if (star < 0) {
        exact.set(module.declaredSpecifier, module.getHash());
        continue;
      }
      patterns.push({
        prefix: module.declaredSpecifier.slice(0, star),
        suffix: module.declaredSpecifier.slice(star + 1),
        hash: module.getHash(),
      });
    }
  }
  let linked = 0;
  for (const facts of files) {
    for (const importRow of facts.imports) {
      if (importRow.getResolvedModuleLinkHash() !== '' || importRow.importedPath === '') {
        continue;
      }
      const direct = exact.get(importRow.importedPath);
      if (direct !== undefined) {
        importRow.setResolvedModuleLinkHash(direct);
        importRow.setAmbientModuleResolution();
        linked += 1;
        continue;
      }
      for (const pattern of patterns) {
        if (importRow.importedPath.startsWith(pattern.prefix)
          && importRow.importedPath.endsWith(pattern.suffix)
          && importRow.importedPath.length >= pattern.prefix.length + pattern.suffix.length) {
          importRow.setResolvedModuleLinkHash(pattern.hash);
          importRow.setAmbientModuleResolution();
          linked += 1;
          break;
        }
      }
    }
  }
  return linked;
}

/**
 * Links every re-export to the module it re-exports FROM.
 *
 * `export { Thing } from "./m"` names a module, and the file declaring `Thing`
 * may be parsed after this one — so like ambient module imports, the link is made
 * once every file is in. Matching is by the specifier's resolved path, which the
 * import extractor already computed for the same specifier when one exists;
 * otherwise the relative path is resolved against the re-exporting module.
 *
 * Still the MODULE graph. `ts_export.resolvedSourceModuleLinkHash` is the
 * parser's own column (§4.13 c8), and this stops one hop short of the call
 * graph — at the module, which is where `type-resolution.dl` takes over.
 */
export function linkReExportSources(files: readonly ModuleGraphFacts[]): number {
  const modulesByPath = new Map<string, string>();
  for (const facts of files) {
    for (const module of facts.modules) {
      if (module.declaredSpecifier === '') {
        modulesByPath.set(stripKnownExtension(module.filePath), module.getHash());
      }
    }
  }
  let linked = 0;
  for (const facts of files) {
    // The import extractor already resolved every specifier this file mentions,
    // so a re-export from the same specifier reuses that answer rather than
    // resolving it a second time and risking a different one.
    const resolvedBySpecifier = new Map<string, string>();
    for (const importRow of facts.imports) {
      if (importRow.resolvedFilePath !== '') {
        resolvedBySpecifier.set(importRow.importedPath,
          stripKnownExtension(importRow.resolvedFilePath));
      }
    }
    for (const exportRow of facts.exports) {
      if (exportRow.sourceSpecifier === ''
        || exportRow.getResolvedSourceModuleLinkHash() !== '') {
        continue;
      }
      const viaImport = resolvedBySpecifier.get(exportRow.sourceSpecifier);
      const target = viaImport !== undefined
        ? modulesByPath.get(viaImport)
        : modulesByPath.get(resolveRelative(facts.filePath, exportRow.sourceSpecifier));
      if (target !== undefined) {
        exportRow.setResolvedSourceModuleLinkHash(target);
        linked += 1;
      }
    }
  }
  return linked;
}

/** A project-relative path minus its extension, so `./a.js` and `a.ts` compare equal. */
function stripKnownExtension(filePath: string): string {
  return filePath.replace(/\.(d\.ts|tsx?|mts|cts|js|jsx|mjs|cjs)$/, '');
}

/** A relative specifier resolved against the re-exporting file, without touching disk. */
function resolveRelative(fromFilePath: string, specifier: string): string {
  if (!specifier.startsWith('.')) {
    return specifier;
  }
  const base = fromFilePath.split('/').slice(0, -1);
  for (const part of stripKnownExtension(specifier).split('/')) {
    if (part === '.' || part === '') {
      continue;
    }
    if (part === '..') {
      base.pop();
      continue;
    }
    base.push(part);
  }
  return base.join('/');
}

/**
 * A dynamic import whose verdict waits for the module link passes.
 *
 * Holds no row the extraction can stream: a shape, a location, a name, and the
 * import row -- which is retained regardless, because the link passes mutate it.
 */
interface DeferredBase {
  readonly shape: string;
  readonly where: string;
  readonly calleeName: string;
  /** Reasons already established from facts the link passes cannot change. */
  readonly missingSoFar: readonly string[];
}

/**
 * A verdict that waits for the module link passes.
 *
 * Only a verdict that FAILS right now is held. The link passes fill
 * `resolvedModuleLinkHash` and never clear it, and every hop reports a reason
 * only when the resolution columns are empty -- so linking can remove a reason
 * and never add one. A hop that already passes has its final answer, and
 * holding it would retain a record per call site for nothing.
 *
 * Every hop that consults a `ts_import` row is here, because
 * `resolvedModuleLinkHash` is filled only once every file has been parsed --
 * an import of `declare module "x"` cannot be linked until the file declaring
 * it has been read. Deciding in-loop would read an empty column and call a
 * linked import incomplete.
 *
 * These are DATA, deliberately, and not closures. A closure written inside the
 * per-file walk captures its enclosing context, and V8 may keep that whole
 * context alive -- which would retain the expression rows the streaming exists
 * to release. The failure would be invisible except at scale.
 *
 * What each holds is a reference to a per-file map that is retained anyway:
 * the import rows themselves outlive the walk because the link passes mutate
 * them.
 */
export type DeferredVerdict =
  | (DeferredBase & { readonly hop: 'DYNAMIC_IMPORT'; readonly importRow: TsImportRegistry | undefined })
  | (DeferredBase & {
      readonly hop: 'IMPORTED_NAME';
      readonly imports: ReadonlyMap<string, TsImportRegistry>;
      readonly localName: string;
    })
  | (DeferredBase & {
      readonly hop: 'RECEIVER_TYPE';
      readonly imports: ReadonlyMap<string, TsImportRegistry>;
      readonly localTypeNames: ReadonlySet<string>;
      readonly typeName: string;
    });

/** The mutable state an incremental measurement carries between files. */
export interface CompletenessAccumulator {
  readonly report: Mutable<IrCompletenessReport>;
  readonly gaps: IrGap[];
  readonly deferred: DeferredVerdict[];
}

export function newCompletenessAccumulator(): CompletenessAccumulator {
  return {
    report: {
      callSites: 0,
      sameFileLinks: 0,
      terminals: 0,
      handedOffComplete: 0,
      handedOffIncomplete: 0,
      inferredReceiver: 0,
      notDerivable: 0,
      gaps: [],
      byReceiverKind: {},
    },
    gaps: [],
    deferred: [],
  };
}

/**
 * Measures ONE file, so extraction need not hold every row to be measured.
 *
 * The whole measurement was already per-file: the two "cross-file" indexes it
 * built were keyed by a file's own module hash and read back under that same
 * key, so they indexed each file against itself. Making that explicit is what
 * lets the caller stream a relation the moment its file is done.
 */
export function accumulateFileCompleteness(
  facts: TsFileFacts,
  accumulator: CompletenessAccumulator
): void {
  const { report, gaps, deferred } = accumulator;
  measureOneFile(facts, report, gaps, deferred);
}

/**
 * Settles the deferred dynamic imports and returns the finished report.
 *
 * Must run after `linkAmbientModuleImports`, which is the whole reason those
 * verdicts were held.
 */
export function finishCompleteness(accumulator: CompletenessAccumulator): IrCompletenessReport {
  const { report, gaps, deferred } = accumulator;
  for (const pending of deferred) {
    const missing: string[] = [...pending.missingSoFar];
    switch (pending.hop) {
      case 'DYNAMIC_IMPORT': {
        checkDeferredDynamicImportHop(pending.importRow, missing);
        break;
      }
      case 'IMPORTED_NAME': {
        checkImportHop(pending.imports, pending.localName, missing);
        break;
      }
      case 'RECEIVER_TYPE': {
        checkDeclaredTypeTriple(pending.typeName, pending.localTypeNames, pending.imports, missing);
        break;
      }
    }
    const bucket = (report.byReceiverKind[pending.shape] ?? {
      total: 0, sameFileLinks: 0, terminals: 0, complete: 0, incomplete: 0, inferred: 0,
      notDerivable: 0,
    }) as Mutable<ReceiverShapeCounts>;
    report.byReceiverKind[pending.shape] = bucket;
    if (missing.length === 0) {
      report.handedOffComplete += 1;
      bucket.complete += 1;
      continue;
    }
    report.handedOffIncomplete += 1;
    bucket.incomplete += 1;
    for (const reason of missing) {
      gaps.push({ where: pending.where, reason, detail: pending.calleeName });
    }
  }
  report.gaps = gaps;
  return report;
}

export function measureIrCompleteness(
  files: readonly TsFileFacts[]
): IrCompletenessReport {
  const accumulator = newCompletenessAccumulator();
  for (const facts of files) {
    accumulateFileCompleteness(facts, accumulator);
  }
  return finishCompleteness(accumulator);
}

/** The measurement for one file. See `accumulateFileCompleteness`. */
function measureOneFile(
  facts: TsFileFacts,
  report: Mutable<IrCompletenessReport>,
  gaps: IrGap[],
  deferred: DeferredVerdict[]
): void {
    const expressionByHash = new Map(facts.expressions.map((e) => [e.getHash(), e]));
    const declarationTypeRefByHash = new Map<string, string>();
    for (const variable of facts.variables) {
      declarationTypeRefByHash.set(variable.getHash(), variable.getTypeReferenceLinkHash());
    }
    const annotatedByHash = new Map<string, boolean>();
    for (const variable of facts.variables) {
      annotatedByHash.set(variable.getHash(), variable.variableTypeName !== '');
    }
    for (const parameter of facts.methodParameters) {
      annotatedByHash.set(parameter.getHash(), parameter.parameterTypeName !== '');
    }
    for (const field of facts.fields as readonly TsFieldRegistry[]) {
      annotatedByHash.set(field.getHash(), field.fieldTypeName !== '');
    }

    const handoffBySite = new Map(facts.engineHandoffs.map((h) => [h.callSite.getHash(), h]));
    const childrenByParent = new Map<string, typeof facts.expressions[number][]>();
    for (const expression of facts.expressions) {
      const parent = expression.parentExpressionHash;
      if (parent === '') {
        continue;
      }
      const list = childrenByParent.get(parent);
      if (list) {
        list.push(expression);
      } else {
        childrenByParent.set(parent, [expression]);
      }
    }
    const callSiteByExpression = new Set(
      facts.callSites.map((c) => c.tsExpressionLinkHash));
    const heritageByType = new Map<string, typeof facts.heritages[number][]>();
    for (const heritage of facts.heritages) {
      const list = heritageByType.get(heritage.tsTypeLinkHash);
      if (list) {
        list.push(heritage);
      } else {
        heritageByType.set(heritage.tsTypeLinkHash, [heritage]);
      }
    }
    const localTypeNames = new Set(
      facts.types.map((t: TsTypeRegistry) => t.name).filter((n) => n !== ''));
    const imports: ReadonlyMap<string, TsImportRegistry> = new Map(facts.importByLocalName);
    const dynamicImportSpecifiers = new Map(
      facts.imports
        .filter((i) => i.importKind === 'DYNAMIC_IMPORT' || i.importKind === 'REQUIRE_CALL')
        .map((i) => [`${i.lineNumber}:${i.startColumn}`, i]));

    for (const callSite of facts.callSites) {
      report.callSites += 1;
      const shape = callSite.receiverKind;
      const bucket = (report.byReceiverKind[shape] ?? {
        total: 0, sameFileLinks: 0, terminals: 0, complete: 0, incomplete: 0, inferred: 0,
        notDerivable: 0,
      }) as Mutable<ReceiverShapeCounts>;
      bucket.total += 1;
      report.byReceiverKind[shape] = bucket;

      const where = `${callSite.startLine}:${callSite.startColumn}`;
      if (callSite.getResolvedSignatureLinkHash() !== '') {
        report.sameFileLinks += 1;
        bucket.sameFileLinks += 1;
        continue;
      }
      const kind = callSite.getResolvedTargetKind();
      if (kind === TsResolvedTargetKind.LIB_SIGNATURE
        || kind === TsResolvedTargetKind.AMBIENT_SIGNATURE
        || kind === TsResolvedTargetKind.SYNTHESIZED_NO_DECLARATION) {
        report.terminals += 1;
        bucket.terminals += 1;
        continue;
      }

      const handoff = handoffBySite.get(callSite.getHash());
      const missing: string[] = [];

      switch (callSite.receiverKind) {
        case 'NONE': {
          // An unqualified call. The engine starts from the callee identifier's
          // own resolution, or from the import row the parser handed it.
          if (handoff?.hop === 'IMPORTED_NAME') {
            // The hop reads `resolvedModuleLinkHash`, which the link passes
            // fill after every file is parsed. Probed now and held only if it
            // fails, since linking can only turn a failure into a pass.
            const probe: string[] = [];
            checkImportHop(imports, handoff.localName, probe);
            if (probe.length === 0) {
              break;
            }
            deferred.push({
              hop: 'IMPORTED_NAME',
              shape,
              where: `${facts.filePath}:${where} (${callSite.receiverKind})`,
              calleeName: callSite.calleeName,
              missingSoFar: missing,
              imports,
              localName: handoff.localName,
            });
            continue;
          }
          if (callSite.callKind === 'DYNAMIC_IMPORT_CALL') {
            // `import("./x")` has no callee EXPRESSION — the callee is a
            // keyword. Its target is a MODULE, and the hop is the `ts_import`
            // row the parser emits for it with `resolvedFilePath` filled.
            //
            // Unless the specifier is COMPUTED. `await import(packageName)`
            // names its module at runtime, so there is no module edge for any
            // parser to emit and no `ts_import` row to point at. That is not an
            // incomplete hand-off, it is not derivable from syntax — the same
            // bucket as a `new (X as any)()` callee.
            if (!hasLiteralSpecifier(callSite, expressionByHash, childrenByParent)) {
              report.notDerivable += 1;
              bucket.notDerivable += 1;
              continue;
            }
            // DEFERRED, and this is the only verdict that is.
            //
            // The hop reads `resolvedModuleLinkHash`, which
            // `linkAmbientModuleImports` fills after every file is parsed --
            // so deciding here would read an empty column and call a linked
            // import incomplete. Everything else about this call site is
            // already counted, including its bucket total, so what is held
            // over is one boolean per dynamic import and not the row.
            const dynamicProbe: string[] = [];
            checkDeferredDynamicImportHop(
              dynamicImportSpecifiers.get(`${callSite.startLine}:${callSite.startColumn}`),
              dynamicProbe);
            if (dynamicProbe.length === 0) {
              break;
            }
            deferred.push({
              hop: 'DYNAMIC_IMPORT',
              shape,
              where: `${facts.filePath}:${where} (${callSite.receiverKind})`,
              calleeName: callSite.calleeName,
              missingSoFar: missing,
              importRow: dynamicImportSpecifiers.get(
                `${callSite.startLine}:${callSite.startColumn}`),
            });
            continue;
          }
          const callee = calleeExpressionOf(callSite, expressionByHash, childrenByParent);
          if (!callee) {
            missing.push('a call with no callee expression row');
            break;
          }
          if (callee.kind === 'ARROW_FUNCTION' || callee.kind === 'FUNCTION_EXPRESSION') {
            // An IIFE. The target is right there in the file with its own
            // `ts_method` row, and c16 now points at it — the widening ts-oracle
            // made after this parser reported that the two rows existed with no
            // FK between them and the engine's only route was a position match.
            //
            // So this is a checkable hop now, not a category to be excused. An
            // EMPTY c16 on a callee that introduces a declaration is a parser
            // gap, and it is reported as one.
            if (callee.getAnonymousDeclarationHash() === '') {
              missing.push('an IIFE callee introduces a ts_method but c16 ' +
                'anonymousDeclarationHash is empty — the engine is back to matching positions');
            }
            break;
          }
          if (callee.kind !== 'IDENTIFIER_REFERENCE') {
            // `new (X as any)(…)`, a computed callee. The callee's type is not
            // derivable from a NAME, and in the `as any` case not derivable at
            // all.
            report.notDerivable += 1;
            bucket.notDerivable += 1;
            continue;
          }
          if (callee.getReferencedEntityHash() === ''
            && callee.getReferencedEntityKind() === 'UNKNOWN') {
            missing.push('the callee identifier has no referencedEntityHash and is not ' +
              'classified AMBIENT_GLOBAL, so the engine has no starting point');
          }
          break;
        }
        case 'IDENTIFIER': {
          if (handoff?.hop === 'IMPORTED_NAME') {
            // The hop reads `resolvedModuleLinkHash`, which the link passes
            // fill after every file is parsed. Probed now and held only if it
            // fails, since linking can only turn a failure into a pass.
            const probe: string[] = [];
            checkImportHop(imports, handoff.localName, probe);
            if (probe.length === 0) {
              break;
            }
            deferred.push({
              hop: 'IMPORTED_NAME',
              shape,
              where: `${facts.filePath}:${where} (${callSite.receiverKind})`,
              calleeName: callSite.calleeName,
              missingSoFar: missing,
              imports,
              localName: handoff.localName,
            });
            continue;
          }
          const typeName = handoff?.receiverTypeName ?? '';
          if (typeName === '') {
            // No annotation anywhere on the receiver's declaration. Nothing for
            // the parser to emit, and no amount of parser work changes it.
            // Counted here rather than inside a helper, because a helper that
            // both counts and returns void let this case be counted AND fall
            // through to be counted again — 6,770 outcomes for 5,271 call sites.
            report.inferredReceiver += 1;
            bucket.inferred += 1;
            continue;
          }
          // The receiver-to-declaration leg is decidable now; the type's own
          // third leg consults an import row, so the VERDICT waits.
          checkReceiverToDeclaration(callSite, expressionByHash, annotatedByHash,
            declarationTypeRefByHash, missing);
          const typeProbe: string[] = [];
          checkDeclaredTypeTriple(typeName, localTypeNames, imports, typeProbe);
          if (typeProbe.length === 0) {
            break;
          }
          deferred.push({
            hop: 'RECEIVER_TYPE',
            shape,
            where: `${facts.filePath}:${where} (${callSite.receiverKind})`,
            calleeName: callSite.calleeName,
            missingSoFar: missing,
            imports,
            localTypeNames,
            typeName,
          });
          continue;
        }
        case 'THIS': {
          // `this.m()` needs the enclosing TYPE, which is a column on the row.
          if (callSite.callerTypeLinkHash === '') {
            missing.push('a `this` receiver with no callerTypeLinkHash — the engine cannot ' +
              'tell which type the member is on');
          }
          break;
        }
        case 'SUPER': {
          // `super.m()` needs a heritage row that INHERITS MEMBERS. An
          // `implements` row will not do: it inherits nothing.
          const inherited = (heritageByType.get(callSite.callerTypeLinkHash) ?? [])
            .some((h) => h.inheritsMembers);
          if (!inherited) {
            missing.push('a `super` receiver with no inheritsMembers heritage row on the ' +
              'enclosing type — the base class is unreachable');
          }
          break;
        }
        case 'PROPERTY_CHAIN': {
          // `this.repo.find()`, `config.db.connect()`. The engine walks the
          // chain: each PROPERTY_ACCESS row must have both its RECEIVER child
          // and its PROPERTY_NAME child, and the root must be either `this` or
          // an identifier that resolved. That is a walk over emitted rows, so
          // it is checkable here — and writing these off as "inferred", which
          // an earlier version of this file did, hid 1,782 call sites behind a
          // label that said no work was possible.
          checkPropertyChain(callSite, expressionByHash, childrenByParent, missing);
          break;
        }
        case 'CALL_RESULT': {
          // The receiver's type is the inner call's RETURN type. The engine
          // chains through that call's own resolution, so what has to be
          // present is the inner `ts_call_site` row.
          const receiverRow = expressionByHash.get(callSite.receiverExpressionLinkHash);
          if (!receiverRow) {
            missing.push('a CALL_RESULT receiver with no ts_expression row');
          } else if (!callSiteByExpression.has(receiverRow.getHash())) {
            missing.push('the inner call has no ts_call_site row, so its return type is ' +
              'unreachable and the chain stops');
          }
          break;
        }
        case 'NON_NULL':
        case 'AWAIT_RESULT':
        case 'PARENTHESIZED':
        case 'AS_EXPRESSION': {
          // A wrapper. Complete when the wrapped expression is emitted; for
          // `as T` the asserted type is the receiver's type outright.
          const receiverRow = expressionByHash.get(callSite.receiverExpressionLinkHash);
          if (!receiverRow) {
            missing.push(`a ${callSite.receiverKind} receiver with no ts_expression row`);
          } else if (childrenByParent.get(receiverRow.getHash())?.length === undefined) {
            missing.push(`a ${callSite.receiverKind} receiver whose operand was not emitted`);
          }
          break;
        }
        default: {
          // ELEMENT_ACCESS and UNKNOWN. `receiverKind` has no member for a
          // literal or an array-literal receiver, but the receiver's type is
          // still fully derivable from columns the parser emitted: a LITERAL row
          // carries `literalType`, and an ARRAY_LITERAL row names `Array`
          // outright. `"a,b".split(",")` and `[1, 2].map(f)` need nothing
          // further from the parser, so counting them as not-derivable would
          // understate the IR.
          const receiverRow = expressionByHash.get(callSite.receiverExpressionLinkHash);
          if (receiverRow && (receiverRow.kind === 'ARRAY_LITERAL'
            || receiverRow.kind === 'OBJECT_LITERAL'
            || receiverRow.kind === 'TEMPLATE_EXPRESSION'
            || receiverRow.literalType !== '')) {
            report.handedOffComplete += 1;
            bucket.complete += 1;
            continue;
          }
          // What remains is genuinely not derivable from syntax: a computed
          // member, or a receiver whose type comes from an operator's operands.
          // Counted apart so it is neither claimed as complete nor reported as a
          // gap the parser could close.
          report.notDerivable += 1;
          bucket.notDerivable += 1;
          continue;
        }
      }

      if (missing.length === 0) {
        report.handedOffComplete += 1;
        bucket.complete += 1;
        continue;
      }
      report.handedOffIncomplete += 1;
      bucket.incomplete += 1;
      for (const reason of missing) {
        gaps.push({
          where: `${facts.filePath}:${where} (${callSite.receiverKind})`,
          reason,
          detail: callSite.calleeName,
        });
      }
    }
  
}

/**
 * The module hop for a dynamic import, once the link passes have run.
 *
 * A Node builtin legitimately resolves to no file -- the classification IS the
 * hop -- so it is not a gap.
 */
function checkDeferredDynamicImportHop(
  importRow: TsImportRegistry | undefined,
  missing: string[]
): void {
  if (!importRow) {
    missing.push('a dynamic import with no ts_import row — the module edge is unrecorded');
    return;
  }
  if (importRow.resolvedFilePath === '' && importRow.getResolvedModuleLinkHash() === ''
    && importRow.getResolutionKind() !== 'BUILTIN_NODE') {
    missing.push(`dynamic import of "${importRow.importedPath}" resolved to nothing`);
  }
}

/**
 * The leading identifier of a type expression, for a REACHABILITY question only.
 *
 * `Row[]` -> `Row`, `Promise<User>` -> `Promise`, `Parser.SyntaxNode` -> `Parser`,
 * `Row | null` -> `Row`. This asks "can the engine find where this name comes
 * from", which is a different question from "which type is this" — and it is
 * emphatically NOT used to produce a link. The column keeps the text as written;
 * reducing a name and then resolving it is the mistake this file exists to
 * measure rather than repeat.
 */
// ---------------------------------------------------------------------------
// the individual hop checks
// ---------------------------------------------------------------------------

type ExpressionRow = TsFileFacts['expressions'][number];
type CallSiteRow = TsFileFacts['callSites'][number];

/**
 * The engine starts an imported call from the `ts_import` row.
 *
 * A Node builtin legitimately has no `resolvedFilePath` — the classification IS
 * the hop, and the engine stages it from `lib_ts_*`. An empty path with no
 * classification is a real gap: the engine cannot tell a builtin from a project
 * import that failed to resolve, and those need different treatment.
 */
function checkImportHop(
  imports: ReadonlyMap<string, TsImportRegistry>,
  localName: string,
  missing: string[]
): void {
  const importRow = imports.get(localName);
  if (!importRow) {
    missing.push('no ts_import row binds the callee name');
    return;
  }
  if (importRow.importKind === 'IMPORT_EQUALS_ENTITY') {
    // `import Units = Geometry.Units` aliases an ENTITY, not a module. There is
    // no file to resolve and an empty `resolvedFilePath` is the correct answer;
    // the hop is the dotted entity path in `moduleOrEntityName`, which the
    // engine resolves against declarations in this same module.
    if (importRow.moduleOrEntityName === '') {
      missing.push('an entity alias with no moduleOrEntityName — the alias target is unnamed');
    }
    return;
  }
  if (importRow.resolvedFilePath === ''
    && importRow.getResolvedModuleLinkHash() === ''
    && importRow.getResolutionKind() !== 'BUILTIN_NODE') {
    missing.push(`ts_import has neither resolvedFilePath nor resolvedModuleLinkHash for ` +
      `"${importRow.importedPath}"`);
  }
}

/**
 * A dynamic import's hop is its `ts_import` row, matched by POSITION.
 *
 * The row and the call site are minted from the same node, so they share a
 * position exactly. Matching on it is not a heuristic — it is the same identity
 * both rows were keyed from.
 */
/**
 * Whether a dynamic import's specifier is a STRING LITERAL written in source.
 *
 * `import("./x")` names a module the parser can resolve; `import(name)` names
 * one only the runtime knows.
 */
function hasLiteralSpecifier(
  callSite: CallSiteRow,
  expressionByHash: ReadonlyMap<string, ExpressionRow>,
  childrenByParent: ReadonlyMap<string, readonly ExpressionRow[]>
): boolean {
  const callRow = expressionByHash.get(callSite.tsExpressionLinkHash);
  if (!callRow) {
    return false;
  }
  const args = (childrenByParent.get(callRow.getHash()) ?? [])
    .filter((c) => c.edgeRole === 'ARGUMENT');
  const first = args[0];
  return first !== undefined && first.kind === 'LITERAL';
}


/** The callee expression of a call, whatever shape it takes. */
function calleeExpressionOf(
  callSite: CallSiteRow,
  expressionByHash: ReadonlyMap<string, ExpressionRow>,
  childrenByParent: ReadonlyMap<string, ExpressionRow[]>
): ExpressionRow | undefined {
  const callRow = expressionByHash.get(callSite.tsExpressionLinkHash);
  if (!callRow) {
    return undefined;
  }
  return (childrenByParent.get(callRow.getHash()) ?? [])
    .find((child) => child.edgeRole === 'METHOD_NAME');
}

/**
 * The three facts an engine needs when the receiver's type lives elsewhere.
 *
 *   1. the declared type NAME AS WRITTEN   ts_call_site.receiverTypeName
 *   2. the importing module                ts_call_site.tsModuleLinkHash
 *   3. ts_import.resolvedFilePath          for the import binding that name
 *
 * (2) is a non-empty FK on every row and is checked by the invariants check, so
 * what is verified here is that (1) is present and that (3) exists for it —
 * either because the name is declared in this module, or bound by an import, or
 * ambient.
 */
function checkDeclaredTypeTriple(
  typeName: string,
  localTypeNames: ReadonlySet<string>,
  imports: ReadonlyMap<string, TsImportRegistry>,
  missing: string[]
): void {
  if (receiverTypeShapeOf(typeName) !== 'NAMED') {
    // ARRAY and ANONYMOUS need no join. `T[]` and `{ a: string }[]` have `Array`
    // as their receiver type, which is ambient; `{ getHash(): string }` names no
    // declaration at all and its full shape is already in the
    // `ts_type_reference` tree. Counting either as a gap would be asking the
    // parser to invent a declaration the source does not contain.
    return;
  }
  const head = headIdentifierOf(typeName);
  if (head === '') {
    missing.push(`receiver type "${typeName}" contains no identifier the engine can look up`);
    return;
  }
  const importRow = imports.get(head);
  if (importRow) {
    if (importRow.importKind === 'IMPORT_EQUALS_ENTITY') {
      return;
    }
    // Bound by an import: the third leg of the triple must be there.
    if (importRow.resolvedFilePath === ''
      && importRow.getResolvedModuleLinkHash() === ''
      && importRow.getResolutionKind() !== 'BUILTIN_NODE') {
      missing.push(`receiver type "${typeName}" is imported from "${importRow.importedPath}" ` +
        'but that import resolved to nothing — the engine has no file to look in');
    }
    return;
  }
  if (localTypeNames.has(head)) {
    return;
  }
  // Neither declared here nor imported. That makes it an AMBIENT name — a
  // `lib.*.d.ts` type or a global — and the engine finds it by name in
  // `lib_ts_*`. The parser cannot tell an ambient type from a dangling one
  // without a checker, and does not need to: the name as written IS the
  // complete fact. An earlier version gated on a curated list of lib names,
  // which failed on `ClassMethodDecoratorContext` and would have failed on
  // every subsequent lib release — a list that must grow forever is a list
  // that hides gaps rather than finding them.
}

/**
 * The walk from a call site to the DECLARATION that carries the annotation.
 *
 *   ts_call_site.receiverExpressionLinkHash
 *     -> ts_expression.referencedEntityHash
 *       -> ts_variable | ts_method_parameter | ts_field [.typeReferenceLinkHash]
 *
 * A break anywhere here is unrecoverable downstream and invisible in any
 * resolution percentage, which is why it is checked link by link.
 */
function checkReceiverToDeclaration(
  callSite: CallSiteRow,
  expressionByHash: ReadonlyMap<string, ExpressionRow>,
  annotatedByHash: ReadonlyMap<string, boolean>,
  declarationTypeRefByHash: ReadonlyMap<string, string>,
  missing: string[]
): void {
  const receiverHash = callSite.receiverExpressionLinkHash;
  if (receiverHash === '') {
    missing.push('receiverExpressionLinkHash is empty on a method call');
    return;
  }
  const receiverRow = expressionByHash.get(receiverHash);
  if (!receiverRow) {
    missing.push('receiverExpressionLinkHash points at no ts_expression row');
    return;
  }
  const declaration = receiverRow.getReferencedEntityHash();
  if (declaration === '') {
    missing.push('the receiver expression has no referencedEntityHash, so the engine cannot ' +
      'reach the declaration that carries the annotation');
    return;
  }
  if (annotatedByHash.get(declaration) === true
    && declarationTypeRefByHash.has(declaration)
    && declarationTypeRefByHash.get(declaration) === '') {
    missing.push('the receiver declaration is annotated but has no typeReferenceLinkHash, ' +
      'so the annotation is unreachable structurally');
  }
}

/**
 * The walk down a property chain, over emitted rows.
 *
 * Every `PROPERTY_ACCESS` row must carry both children the engine needs — the
 * RECEIVER it reads from and the PROPERTY_NAME it reads — and the root must be
 * `this` or an identifier that resolved. Everything in that description is a row
 * the parser emitted, so it is checkable without following a single import.
 */
function checkPropertyChain(
  callSite: CallSiteRow,
  expressionByHash: ReadonlyMap<string, ExpressionRow>,
  childrenByParent: ReadonlyMap<string, ExpressionRow[]>,
  missing: string[]
): void {
  let current: ExpressionRow | undefined =
    expressionByHash.get(callSite.receiverExpressionLinkHash);
  if (!current) {
    missing.push('a PROPERTY_CHAIN receiver with no ts_expression row');
    return;
  }
  let guard = 0;
  while (current && guard < 64) {
    guard += 1;
    if (current.kind === 'THIS_REFERENCE' || current.kind === 'SUPER_REFERENCE') {
      return;
    }
    if (current.kind === 'IDENTIFIER_REFERENCE') {
      if (current.getReferencedEntityHash() === ''
        && current.getReferencedEntityKind() === 'UNKNOWN') {
        missing.push('the root of a property chain resolved to nothing and is not classified ' +
          'AMBIENT_GLOBAL — the chain has no starting point');
      }
      return;
    }
    if (current.kind !== 'PROPERTY_ACCESS' && current.kind !== 'ELEMENT_ACCESS'
      && current.kind !== 'NON_NULL_EXPRESSION') {
      // A call result or an await inside the chain. Its own row exists, and the
      // engine chains through that node's type; nothing is missing here.
      return;
    }
    const children: ExpressionRow[] = childrenByParent.get(current.getHash()) ?? [];
    // `x!.y()` -- a non-null assertion is a postfix UNARY, so its operand
    // carries UNARY_OPERAND, not RECEIVER. Looking only for RECEIVER reported
    // the emitted row as an unwalkable chain: the IR was right and this check
    // was wrong, which is the more dangerous direction of the two.
    const nextRole: string = current.kind === 'NON_NULL_EXPRESSION' ? 'UNARY_OPERAND' : 'RECEIVER';
    const next: ExpressionRow | undefined =
      children.find((c) => c.edgeRole === nextRole);
    if (!next) {
      missing.push(`a ${current.kind} row in a property chain has no ${nextRole} child, so the ` +
        'chain cannot be walked');
      return;
    }
    if (current.kind === 'PROPERTY_ACCESS'
      && !children.some((c) => c.edgeRole === 'PROPERTY_NAME')) {
      missing.push('a PROPERTY_ACCESS row in a property chain has no PROPERTY_NAME child, so ' +
        'the engine cannot tell which member is being read');
      return;
    }
    current = next;
  }
}

/**
 * Does a receiver's declared type NAME something the engine can look up?
 *
 * Three answers, and only the first needs a join:
 *   NAMED      `User`, `Promise<User>`, `Parser.SyntaxNode` — resolve the head
 *   ARRAY      `T[]`, `readonly Row[]`, `{ a: string }[]` — the type IS `Array`
 *   ANONYMOUS  `{ … }`, `(a: T) => R` — names no declaration; the shape is in
 *              `ts_type_reference` and there is nothing to import
 */
function receiverTypeShapeOf(annotation: string): 'NAMED' | 'ARRAY' | 'ANONYMOUS' {
  const text = annotation.trim().replace(/^readonly\s+/, '');
  if (text.endsWith('[]')) {
    return 'ARRAY';
  }
  if (text.startsWith('{') || text.startsWith('(')) {
    return 'ANONYMOUS';
  }
  return 'NAMED';
}

function headIdentifierOf(annotation: string): string {
  const match = /[A-Za-z_$][A-Za-z0-9_$]*/.exec(
    annotation.trim().replace(/^readonly\s+/, '')
  );
  return match?.[0] ?? '';
}
