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
  /**
   * An IIFE: the target is in the file and has a `ts_method` row, but no column
   * links a function-expression `ts_expression` row to it. A SCHEMA gap, raised
   * with ts-oracle, counted apart from anything the parser can fix.
   */
  readonly needsSchemaSlot: number;
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
  readonly needsSchemaSlot: number;
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
export function linkAmbientModuleImports(files: readonly TsFileFacts[]): number {
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

export function measureIrCompleteness(
  files: readonly TsFileFacts[]
): IrCompletenessReport {
  // Cross-file INDEXES, used only to ask whether a fact exists — never to
  // produce a link. Reading the fact base to check it is complete is not the
  // same act as resolving through it.
  const typeNamesByModule = new Map<string, Set<string>>();
  const importsByModule = new Map<string, Map<string, TsImportRegistry>>();
  for (const facts of files) {
    typeNamesByModule.set(facts.fileModuleHash,
      new Set(facts.types.map((t: TsTypeRegistry) => t.name).filter((n) => n !== '')));
    importsByModule.set(facts.fileModuleHash, new Map(facts.importByLocalName));
  }

  const report: Mutable<IrCompletenessReport> = {
    callSites: 0,
    sameFileLinks: 0,
    terminals: 0,
    handedOffComplete: 0,
    handedOffIncomplete: 0,
    inferredReceiver: 0,
    notDerivable: 0,
    needsSchemaSlot: 0,
    gaps: [],
    byReceiverKind: {},
  };
  const gaps: IrGap[] = [];

  for (const facts of files) {
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
    const localTypeNames = typeNamesByModule.get(facts.fileModuleHash) ?? new Set<string>();
    const imports = importsByModule.get(facts.fileModuleHash) ?? new Map();
    const dynamicImportSpecifiers = new Map(
      facts.imports
        .filter((i) => i.importKind === 'DYNAMIC_IMPORT' || i.importKind === 'REQUIRE_CALL')
        .map((i) => [`${i.lineNumber}:${i.startColumn}`, i]));

    for (const callSite of facts.callSites) {
      report.callSites += 1;
      const shape = callSite.receiverKind;
      const bucket = (report.byReceiverKind[shape] ?? {
        total: 0, sameFileLinks: 0, terminals: 0, complete: 0, incomplete: 0, inferred: 0,
        notDerivable: 0, needsSchemaSlot: 0,
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
            checkImportHop(imports, handoff.localName, missing);
            break;
          }
          if (callSite.callKind === 'DYNAMIC_IMPORT_CALL') {
            // `import("./x")` has no callee EXPRESSION — the callee is a
            // keyword. Its target is a MODULE, and the hop is the `ts_import`
            // row the parser emits for it with `resolvedFilePath` filled.
            checkDynamicImportHop(callSite, dynamicImportSpecifiers, missing);
            break;
          }
          const callee = calleeExpressionOf(callSite, expressionByHash, childrenByParent);
          if (!callee) {
            missing.push('a call with no callee expression row');
            break;
          }
          if (callee.kind === 'ARROW_FUNCTION' || callee.kind === 'FUNCTION_EXPRESSION') {
            // An IIFE. The target is right there in the file and has a
            // `ts_method` row — but `ts_expression` has NO FK to it. c16
            // `anonymousTypeHash` covers a class expression and nothing covers a
            // function one, so the engine's only route is a position match.
            // Recorded as its own category and raised with ts-oracle rather than
            // papered over: it is a schema gap, not a parser gap.
            report.needsSchemaSlot += 1;
            bucket.needsSchemaSlot += 1;
            continue;
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
            checkImportHop(imports, handoff.localName, missing);
            break;
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
          checkDeclaredTypeTriple(typeName, localTypeNames, imports, missing);
          checkReceiverToDeclaration(callSite, expressionByHash, annotatedByHash,
            declarationTypeRefByHash, missing);
          break;
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
  report.gaps = gaps;
  return report;
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
function checkDynamicImportHop(
  callSite: CallSiteRow,
  dynamicImports: ReadonlyMap<string, TsImportRegistry>,
  missing: string[]
): void {
  const importRow = dynamicImports.get(`${callSite.startLine}:${callSite.startColumn}`);
  if (!importRow) {
    missing.push('a dynamic import with no ts_import row — the module edge is unrecorded');
    return;
  }
  if (importRow.resolvedFilePath === '' && importRow.getResolvedModuleLinkHash() === ''
    && importRow.getResolutionKind() !== 'BUILTIN_NODE') {
    missing.push(`dynamic import of "${importRow.importedPath}" resolved to nothing`);
  }
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
    const next: ExpressionRow | undefined =
      children.find((c) => c.edgeRole === 'RECEIVER');
    if (!next) {
      missing.push(`a ${current.kind} row in a property chain has no RECEIVER child, so the ` +
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
