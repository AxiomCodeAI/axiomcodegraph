import {
  inventedLambdaParameterOf,
  isMisparsedExtensionBlockHeader,
} from '@/parsers/csharp/extractors/cs-misparse';
import Parser from 'tree-sitter';
import {
  extensionBlockAt,
  type CsExtensionBlock,
  type CsExtensionReceiver,
} from '@/parsers/csharp/extractors/cs-extension-block';

import { CsBlockRegistry } from '@/analysis-types/csharp/CsBlockRegistry';
import { CsCallSiteRegistry } from '@/analysis-types/csharp/CsCallSiteRegistry';
import { CsEnumMemberRegistry } from '@/analysis-types/csharp/CsEnumMemberRegistry';
import { CsExpressionRegistry } from '@/analysis-types/csharp/CsExpressionRegistry';
import { CsEventRegistry } from '@/analysis-types/csharp/CsEventRegistry';
import { CsFieldRegistry } from '@/analysis-types/csharp/CsFieldRegistry';
import { CsMethodParameterRegistry } from '@/analysis-types/csharp/CsMethodParameterRegistry';
import { CsMethodRegistry } from '@/analysis-types/csharp/CsMethodRegistry';
import { CsPropertyRegistry } from '@/analysis-types/csharp/CsPropertyRegistry';
import { CsQueryClauseRegistry } from '@/analysis-types/csharp/CsQueryClauseRegistry';
import { CsTypeParameterRegistry } from '@/analysis-types/csharp/CsTypeParameterRegistry';
import { CsTypeReferenceRegistry } from '@/analysis-types/csharp/CsTypeReferenceRegistry';
import { CsVariableRegistry } from '@/analysis-types/csharp/CsVariableRegistry';
import {
  CSHARP_ANONYMOUS_METHOD_NAMES,
  CSHARP_SYNTHESIZED_PROGRAM_TYPE_NAME,
} from '@/constants/csharp-constants';
import { CsBlockKind } from '@/enums/csharp/blocks';
import { CsDeclarationOwnerKind } from '@/enums/csharp/owners';
import { CsEnumValueKind } from '@/enums/csharp/enum-members';
import { CsEventKind } from '@/enums/csharp/events';
import { CsFieldMemberKind, CsFieldModifier } from '@/enums/csharp/fields';
import { CsParameterMode, CsScopedModifier } from '@/enums/csharp/method-parameters';
import {
  CS_ACCESSOR_METHOD_KINDS,
  CsBodyKind,
  CsConversionKind,
  CsMethodKind,
  CsMethodModifier,
  CsOwnerMemberKind,
} from '@/enums/csharp/methods';
import {
  CsEdgeRole,
  CsExpressionOwnerKind,
  CsReferencedEntityKind,
  CsRootContext,
} from '@/enums/csharp/expressions';
import { CsSetterKind } from '@/enums/csharp/properties';
import { CsVariableScopeKind } from '@/enums/csharp/variables';
import { CsTypeAccess, CsTypeCategory } from '@/enums/csharp/types';
import {
  CsReferenceOwnerKind,
  CsTypeRefContext,
} from '@/enums/csharp/type-references';
import {
  DeclarationOwner,
  addDeclarationOwner,
  countAttributes,
} from '@/parsers/csharp/extractors/cs-attribute-extractor';
import { extractBlocksAndVariables } from '@/parsers/csharp/extractors/cs-block-extractor';
import {
  CsExpressionContext,
  CsExpressionResult,
  PendingReferenceLink,
  extractExpressionTree,
} from '@/parsers/csharp/extractors/cs-expression-extractor';
import {
  BoundaryScope,
  collectExpressionRoots,
  collectLambdas,
  scopeAt,
} from '@/parsers/csharp/extractors/cs-statement-walker';
import { extractTypeReferences } from
  '@/parsers/csharp/extractors/cs-type-reference-extractor';
import {
  CSHARP_RESERVED_KEYWORDS,
  baseTypeName,
  hasNullableAnnotation,
  normalizeCSharpIdentifier,
} from '@/utils/csharp';
import {
  allChildren,
  childOfType,
  childrenOfType,
  endLine,
  namedChildren,
  nodeId,
  startColumn,
  startLine,
} from '@/parsers/csharp/extractors/cs-node';
import { CsTypeParameterOwnerKind } from '@/enums/csharp/type-parameters';
import { extractTypeParameters } from
  '@/parsers/csharp/extractors/cs-type-parameter-extractor';
import {
  PREPROC_CHAIN_ROOT,
  activeChildOfType,
  activeNamedChildren,
  headerOf,
  modifiersOf,
  throughTakenBranch,
  resolvePreprocBranches,
  declarationSpanStartNode,
} from '@/parsers/csharp/extractors/preproc-context';

/**
 * `cs_method`, `cs_method_parameter`, `cs_property` and `cs_event`.
 *
 * These four are extracted together because they are one construct seen from
 * different sides: **a property is a data location AND up to two call targets**,
 * and emitting the location without the targets or the targets without the
 * location loses something the engine needs. The accessor rows must be keyed off
 * the property row that owns them, so they cannot be built by separate passes.
 *
 * ## The 68% inflation, stated where it will be read
 *
 * 66,449 of the `cs_method` rows a real corpus produces come from accessors,
 * against 97,113 method declarations. `isAccessor` exists so a count of methods
 * can be a count of methods.
 *
 * ## Every declared accessor produces EXACTLY ONE row
 *
 * Duplicates do not collide, they DOUBLE. An auto-property has two accessors and
 * no bodies; an expression-bodied property has one accessor with no `get`
 * keyword anywhere. Both are visited on exactly one path, and the accessor 1:1
 * gate asserts the count both directions.
 */

export interface CsMemberExtractionOptions {
  readonly declarationNode: Parser.SyntaxNode;
  /**
   * The enclosing TYPE's parameters, by name.
   *
   * A member of `class Box<T>` may write `T` anywhere, and the binding comes
   * from the type, not the member. Without this every such `T` reads as a
   * reference to a type named `T` and the engine searches the using scope for
   * something that does not exist.
   */
  readonly typeParametersInScope: ReadonlyMap<string, string>;
  /**
   * Methods declared on this type, by name.
   *
   * What turns `methodReferenceKind` from a guess into a same-file one-hop
   * fact — see `isMethodGroupPosition`. Collected in one pass before members
   * are built, because a method group may name a method declared later in the
   * file.
   */
  readonly methodNamesOnType: ReadonlySet<string>;
  /** Events declared on this type, by name. Makes EVENT_SUBSCRIBE a fact. */
  readonly eventNamesOnType: ReadonlySet<string>;
  /** Fields, properties and events, by name. Makes DELEGATE_INVOKE a fact. */
  readonly valueMemberNamesOnType: ReadonlySet<string>;
  /** The two of the three v1.8 sets `eventNamesOnType` does not already carry. */
  readonly fieldNamesOnType: ReadonlySet<string>;
  readonly propertyNamesOnType: ReadonlySet<string>;
  /** `using A = B.C;` aliases declared in this file. */
  readonly usingAliasNames: ReadonlySet<string>;
  /**
   * Local functions declared in the scope ENCLOSING the body being walked.
   * Empty for a method; for a local function, the set its siblings and itself
   * are in.
   */
  readonly enclosingLocalFunctionNames: ReadonlySet<string>;
  readonly csModuleLinkHash: string;
  readonly csTypeLinkHash: string;
  readonly typeQualifiedName: string;
  readonly typeCategory: CsTypeCategory;
  readonly typeName: string;
  readonly serviceVersionLinkHash: string;
  readonly activeSymbols: ReadonlySet<string>;
  /**
   * C# 14 extension blocks the pre-parse pass flattened into this type.
   *
   * A member is governed by a block when its start offset falls inside the
   * block's recorded body range — which survives because the flattening pass
   * preserves every offset. Keyed on the RANGE, never on the node: the
   * wrapper cache evicts, and the tree the range was measured in is not even
   * the tree being walked.
   */
  readonly extensionBlocks?: readonly CsExtensionBlock[];
}

export interface CsMemberExtractionResult {
  readonly methods: CsMethodRegistry[];
  readonly parameters: CsMethodParameterRegistry[];
  readonly properties: CsPropertyRegistry[];
  readonly events: CsEventRegistry[];
  readonly typeParameters: CsTypeParameterRegistry[];
  readonly typeReferences: CsTypeReferenceRegistry[];
  readonly fields: CsFieldRegistry[];
  readonly enumMembers: CsEnumMemberRegistry[];
  readonly expressions: CsExpressionRegistry[];
  readonly callSites: CsCallSiteRegistry[];
  readonly queryClauses: CsQueryClauseRegistry[];
  readonly blocks: CsBlockRegistry[];
  readonly variables: CsVariableRegistry[];
  /**
   * References to locals, bindings and parameters whose declaration rows did
   * not exist when the reference was emitted. Resolved per member by
   * {@link resolveReferenceLinks} once that member's declarations all exist.
   */
  readonly pendingReferenceLinks: PendingReferenceLink[];
  /**
   * `node.id` → the row that declaration produced.
   *
   * Filled here because this is where the hash exists, and read by the
   * attribute and comment passes, which run ONCE over the whole tree rather
   * than being threaded through sixteen call sites. A construct visited on one
   * path stays visited on one path — duplicates DOUBLE.
   */
  readonly declarationOwners: Map<number, DeclarationOwner[]>;
}

const MEMBER_TYPES = new Set([
  'field_declaration',
  'method_declaration',
  'constructor_declaration',
  'destructor_declaration',
  'operator_declaration',
  'conversion_operator_declaration',
  'property_declaration',
  'indexer_declaration',
  'event_declaration',
  'event_field_declaration',
]);

export function extractMembers(
  options: CsMemberExtractionOptions
): CsMemberExtractionResult {
  const result: CsMemberExtractionResult = {
    methods: [],
    parameters: [],
    properties: [],
    events: [],
    typeParameters: [],
    typeReferences: [],
    fields: [],
    enumMembers: [],
    expressions: [],
    callSites: [],
    queryClauses: [],
    blocks: [],
    variables: [],
    pendingReferenceLinks: [],
    declarationOwners: new Map(),
  };

  // A primary constructor is on the TYPE, not in its member list.
  const primaryMark = markOf(result);
  emitPrimaryConstructor(options, result);
  resolveReferenceLinks(result, primaryMark);
  // Enum members are in an `enum_member_declaration_list`, not a
  // `declaration_list`, so the member walk never sees them.
  emitEnumMembers(options, result);

  // Member -> the C# 14 extension-block receiver governing it, filled in by
  // memberNodes as it flattens the blocks.
  const extensionReceivers = new Map<number, Parser.SyntaxNode>();
  for (const member of memberNodes(
    options.declarationNode,
    options.activeSymbols,
    extensionReceivers
  )) {
    // THE GOVERNING EXTENSION RECEIVER, from either of the two ways a block
    // can reach here — and they cannot both fire. `extension_declaration` is a
    // node type only the FORK grammar produced; on the published grammar the
    // pre-parse pass has already flattened the block and the receiver arrives
    // in the side table instead. The fork path is kept because it costs
    // nothing and the grammar may yet grow the rule.
    const flattenedBlock = extensionBlockAt(
      options.extensionBlocks ?? [],
      member.startIndex
    );
    const extensionReceiver = extensionReceivers.get(nodeId(member));
    const receiverFacts =
      flattenedBlock !== undefined
        ? flattenedReceiverFacts(flattenedBlock.receiver)
        : extensionReceiver === undefined
          ? undefined
          : receiverParameterFacts(extensionReceiver, options.activeSymbols);
    // An extension block's members are extension members whether or not the
    // block gives them a receiver VALUE: `extension(string)` declares static
    // ones, which take none. So membership is the BLOCK, and the receiver is a
    // separate question — conflating them made every static extension member
    // look like an ordinary static member of the static class.
    const inExtensionBlock = flattenedBlock !== undefined || extensionReceiver !== undefined;
    // Each member's references resolve against ITS declarations — the locals,
    // bindings and parameters its body, its lambdas and its local functions
    // minted — once they all exist.
    const mark = markOf(result);
    switch (member.type) {
      case 'method_declaration':
      case 'constructor_declaration':
      case 'destructor_declaration':
      case 'operator_declaration':
      case 'conversion_operator_declaration': {
        // `extension(string source)` is a C# 14 extension block the published
        // grammar reads as a CONSTRUCTOR — a constructor of a static class
        // taking one argument, which is not legal C# and resolves to nothing.
        // The block's members are lost inside an ERROR node either way, and
        // cs_parse_gap records that; this only stops the parser ALSO asserting
        // a constructor that does not exist. A wrong row is worse than a
        // missing one, because the missing one shows up in a count.
        if (isMisparsedExtensionBlockHeader(member)) {
          break;
        }
        emitCallable(member, options, result, receiverFacts);
        break;
      }
      case 'property_declaration':
      case 'indexer_declaration': {
        // GIVEN THE RECEIVER. `cs_property.isExtension` says the property is an
        // extension member, and the receiver lives where the
        // compiler puts it: parameter 0 of each ACCESSOR, which is a static
        // method taking the receiver — `get_IsBlank(string source)`. That
        // makes the C# 13 and C# 14 forms identical in the IR, which is the
        // model cs_method.isExtension already follows.
        emitProperty(member, options, result, receiverFacts, inExtensionBlock);
        break;
      }
      case 'event_declaration': {
        emitEventWithAccessors(member, options, result);
        break;
      }
      case 'event_field_declaration': {
        emitFieldLikeEvents(member, options, result);
        break;
      }
      case 'field_declaration': {
        emitFields(member, options, result);
        break;
      }
      default:
        break;
    }
    resolveReferenceLinks(result, mark);
  }
  resolveMemberReferenceLinks(result);

  return result;
}

/** Where a member's rows begin in the shared result, so it resolves against its own. */
interface ResultMark {
  readonly variables: number;
  readonly parameters: number;
  readonly links: number;
}

function markOf(result: CsMemberExtractionResult): ResultMark {
  return {
    variables: result.variables.length,
    parameters: result.parameters.length,
    links: result.pendingReferenceLinks.length,
  };
}

/**
 * THE SAME-FILE, ONE-HOP LINK from a reference to the row it names.
 *
 * `referencedEntityKind` said "this names a local" on 252,742 rows of one
 * stratum and `referencedEntityHash` named none of them: the column and its
 * setter existed and nothing connected them. The engine then had to re-derive
 * WHICH local by name and scope — exactly the fact the parser holds.
 *
 * The rule is the language's. C# forbids a nested scope from redeclaring a
 * name in an enclosing one (CS0136) and forbids using a local before its
 * declaration (CS0841), so within one member the declaration a name refers to
 * is the NEAREST PRECEDING one of that name — across the member's own body,
 * its lambdas and its local functions alike, which is why resolution is per
 * member and not per callable. A parameter precedes its whole body, a lambda
 * parameter precedes its lambda's body, and a reference with no preceding
 * declaration is left unlinked: don't-know is never a positive claim.
 */
function resolveReferenceLinks(result: CsMemberExtractionResult, mark: ResultMark): void {
  const all = result.pendingReferenceLinks.slice(mark.links);
  // A reference to a FIELD, PROPERTY or EVENT resolves against the TYPE's
  // members, which are still being emitted while this member's are — so
  // those links stay pending for {@link resolveMemberReferenceLinks}, which
  // runs once every member of the type exists.
  const links = all.filter((link) => !MEMBER_REFERENCE_KINDS.has(link.kind));
  result.pendingReferenceLinks.length = mark.links;
  result.pendingReferenceLinks.push(...all.filter((link) => MEMBER_REFERENCE_KINDS.has(link.kind)));
  if (links.length === 0) {
    return;
  }
  // Two GROUPS of declaration, not five kinds: every cs_variable row — a
  // local, a binding, a range variable — is one group, and every parameter
  // row is the other. The reference's kind is a classification of the NAME
  // (`foreach ((var k, var v) …)` names a pattern binding; its row is a
  // DECONSTRUCTION) and the link is to the declaration; matching kind for
  // kind left the right row unlinked.
  type Declaration = { readonly line: number; readonly column: number; readonly hash: string; readonly group: 'variable' | 'parameter' };
  const byName = new Map<string, Declaration[]>();
  const add = (name: string, declaration: Declaration): void => {
    if (!byName.has(name)) {
      byName.set(name, []);
    }
    byName.get(name)!.push(declaration);
  };
  for (const variable of result.variables.slice(mark.variables)) {
    add(variable.name, {
      line: variable.startLine,
      column: variable.startColumn,
      hash: variable.getHash(),
      group: 'variable',
    });
  }
  for (const parameter of result.parameters.slice(mark.parameters)) {
    add(parameter.name, {
      line: parameter.startLine,
      column: parameter.startColumn,
      hash: parameter.getHash(),
      group: 'parameter',
    });
  }
  for (const declarations of byName.values()) {
    declarations.sort((a, b) => a.line - b.line || a.column - b.column);
  }
  for (const link of links) {
    const declarations = byName.get(link.name);
    if (declarations === undefined) {
      continue;
    }
    const { startLine, startColumn } = link.row;
    let found: Declaration | undefined;
    for (const declaration of declarations) {
      const precedes =
        declaration.line < startLine || (declaration.line === startLine && declaration.column < startColumn);
      if (!precedes) {
        break;
      }
      if (declaration.group === groupOf(link.kind)) {
        found = declaration;
      }
    }
    if (found !== undefined) {
      link.row.setReferencedEntityHash(found.hash);
    }
  }
}

const MEMBER_REFERENCE_KINDS: ReadonlySet<CsReferencedEntityKind> = new Set([
  CsReferencedEntityKind.FIELD,
  CsReferencedEntityKind.PROPERTY,
  CsReferencedEntityKind.EVENT,
]);

/**
 * The link from a bare member name to the member row it names — resolved
 * once for the whole type, after every member exists, because a field is
 * visible throughout the type regardless of where it is declared. The
 * classification already established that exactly one row of the named kind
 * exists in this file's part; the lookup here is by name within that kind.
 */
function resolveMemberReferenceLinks(result: CsMemberExtractionResult): void {
  const links = result.pendingReferenceLinks.filter((link) => MEMBER_REFERENCE_KINDS.has(link.kind));
  result.pendingReferenceLinks.length = 0;
  if (links.length === 0) {
    return;
  }
  const fields = new Map(result.fields.map((row) => [row.name, row.getHash()]));
  const properties = new Map(result.properties.map((row) => [row.name, row.getHash()]));
  const events = new Map(result.events.map((row) => [row.name, row.getHash()]));
  for (const link of links) {
    const table =
      link.kind === CsReferencedEntityKind.FIELD
        ? fields
        : link.kind === CsReferencedEntityKind.PROPERTY
          ? properties
          : events;
    const hash = table.get(link.name);
    if (hash !== undefined) {
      link.row.setReferencedEntityHash(hash);
    }
  }
}

/** Which relation a reference of this kind is declared in. */
function groupOf(kind: CsReferencedEntityKind): 'variable' | 'parameter' {
  return kind === CsReferencedEntityKind.PARAMETER || kind === CsReferencedEntityKind.LAMBDA_PARAMETER
    ? 'parameter'
    : 'variable';
}

/**
 * The member declarations directly inside a type, with `#if` resolved.
 *
 * The same unwrapping `cs-type-extractor` does for type declarations, and for
 * the same reason: a member inside an inactive branch must not be emitted, and
 * the `#elif`/`#else` chain is NESTED, so a walker treating them as siblings
 * emits the `#else` body twice with identical hashes.
 */
/**
 * The receiver of a C# 14 extension block, as a `parameter` node.
 *
 * `extension(string source)` names the receiver and its members may be
 * INSTANCE members; `extension(string)` names only the type and its members are
 * all static. The second form has no `parameter` node — the receiver is a bare
 * type — and returns undefined, which is correct: a static extension member
 * takes no receiver argument, exactly as it does not in C# 13.
 */
function extensionReceiverOf(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  const list = childOfType(node, 'extension_parameter_list');
  if (list === undefined) {
    return undefined;
  }
  return namedChildren(list).find((c) => c.type === 'parameter');
}

/**
 * The block's receiver, as the `this` parameter it becomes.
 *
 * The whole model of C# 14 extension members, and it needs NO schema column.
 * The compiler lowers an instance extension member to a static method on the
 * enclosing class whose first parameter is the receiver — which is precisely
 * what a C# 13 `this`-parameter extension method already is. So the receiver is
 * emitted as parameter 0 with `isThis`, `cs_method.isExtension` follows from it
 * unchanged, and a consumer cannot tell the two forms apart. Neither can the
 * runtime.
 */
function receiverParameterFacts(receiver: Parser.SyntaxNode, activeSymbols: ReadonlySet<string>): ParameterFacts | undefined {
  const facts = readParameters(receiver.parent ?? undefined, activeSymbols)
    .find((p) => p.startLine === startLine(receiver) && p.startColumn === startColumn(receiver));
  if (facts === undefined) {
    return undefined;
  }
  // BOTH the flag and the MODE. `isThis` is what `cs_method.isExtension` is
  // derived from; `parameterMode` is the column a consumer reads. Setting only
  // the first left the receiver at VALUE while the C# 13 form said THIS — the
  // two would have been distinguishable in the IR, and the whole point of this
  // model is that they are the same fact.
  return { ...facts, isThis: true, mode: CsParameterMode.THIS };
}

/**
 * The receiver of a FLATTENED block, built from text rather than from a node.
 *
 * The pre-parse pass blanked the header the receiver was written in, so there
 * is no `parameter` node left to read — by design: blanking is what lets every
 * member form inside the block parse as the member it is. The facts are
 * therefore synthesized from what the pass captured before blanking.
 *
 * Positions are the ORIGINAL ones and still correct, because the pass preserves
 * length to the character.
 *
 * `typeNode` is undefined, and that is a NAMED ABSENCE rather than an
 * oversight: the only node for the receiver's type belongs to the pre-blanking
 * tree, which is discarded, and holding a node from a dead tree is the
 * wrapper-cache mistake this codebase has already paid for twice. The
 * consequence is precise and small — the receiver's TYPE REFERENCE row is not
 * emitted, while the parameter row, its type NAME and `isThis` all are.
 */
function flattenedReceiverFacts(
  receiver: CsExtensionReceiver | undefined
): ParameterFacts | undefined {
  if (receiver === undefined) {
    return undefined;
  }
  return {
    name: normalizeCSharpIdentifier(receiver.name),
    // BOTH the flag and the MODE, for the reason receiverParameterFacts gives:
    // `isThis` is what isExtension derives from and `parameterMode` is the
    // column a consumer reads, and the two forms must be indistinguishable.
    mode: CsParameterMode.THIS,
    isThis: true,
    typeName: baseTypeName(receiver.typeText),
    completeTypeName: receiver.typeText,
    isNullableAnnotated: hasNullableAnnotation(receiver.typeText),
    hasDefaultValue: false,
    defaultValueText: '',
    isParams: false,
    scoped: CsScopedModifier.NONE,
    attributeCount: 0,
    startLine: receiver.startLine,
    startColumn: receiver.startColumn,
    typeNode: undefined,
    defaultValueNode: undefined,
    node: undefined,
  };
}

function memberNodes(
  declaration: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>,
  /**
   * Filled in as extension blocks are flattened: member `node.id` -> the
   * block's receiver `parameter` node.
   *
   * KEYED ON `node.id`, never set ON the node: the wrapper cache evicts, and a
   * property written during one traversal is gone by the next.
   */
  receivers: Map<number, Parser.SyntaxNode> = new Map()
): Parser.SyntaxNode[] {
  const list = childOfType(declaration, 'declaration_list');
  if (list === undefined) {
    return [];
  }
  const out: Parser.SyntaxNode[] = [];
  const queue = namedChildren(list);
  while (queue.length > 0) {
    const node = queue.shift()!;
    // C# 14 EXTENSION BLOCK. Its members are members of the ENCLOSING static
    // class — that is what the compiler emits, and `extension(...)` is a
    // grouping header, not a declaration of its own. So the block is flattened
    // here and its receiver is recorded against each member it governs.
    if (node.type === 'extension_declaration') {
      const inner = childOfType(node, 'declaration_list');
      if (inner !== undefined) {
        const members = namedChildren(inner);
        const receiver = extensionReceiverOf(node);
        for (const m of members) {
          if (receiver !== undefined) {
            receivers.set(nodeId(m), receiver);
          }
        }
        queue.unshift(...members);
      }
      continue;
    }
    if (node.type === PREPROC_CHAIN_ROOT) {
      const { branches, bodies } = resolvePreprocBranches(node, activeSymbols);
      const expanded: Parser.SyntaxNode[] = [];
      for (const branch of branches) {
        if (branch.isActive) {
          expanded.push(...(bodies.get(branch.branchIndex) ?? []));
        }
      }
      queue.unshift(...expanded);
      continue;
    }
    if (MEMBER_TYPES.has(node.type) && !isRecoveryDebris(node)) {
      out.push(node);
    }
  }
  return out;
}

/**
 * A member whose KIND the grammar guessed, and guessed wrong.
 *
 * ```csharp
 * private static string GetDefaultMessage()
 * #if CORECLR
 *     => GetMessageFromNativeResources(...);
 * #else
 *     => SR.Arg_OutOfMemoryException;
 * #endif
 * ```
 *
 * The `#if` splits the arrow body, and the grammar recovers by producing a
 * `property_declaration` named GetDefaultMessage with an ERROR child holding
 * the `()`, followed by a `method_declaration` NAMED `public`. Roslyn says
 * ordinary method. The parser emitted a property with a getter called
 * get_GetDefaultMessage — a correctly-positioned row with the wrong kind, the
 * classification defect exactly, and it passed every count-based check.
 *
 * The rule is the one from DELEGATE_INVOKE: a lookup miss is DON'T KNOW, and
 * the terminal for don't-know is never a positive claim. Two signals say the
 * kind is a guess, and ONLY these two:
 *
 * - a `property_declaration` with an ERROR among its direct children. The
 *   property/method confusion runs exactly one way — a method whose `()` fell
 *   into the ERROR is recovered as a property — so a property with header
 *   debris is the one shape whose kind cannot be trusted;
 * - a member whose NAME is a C# keyword. `public` is not a method name; it is
 *   the next member's modifier, swallowed.
 *
 * A `method_declaration` with an ERROR child KEEPS its row: a method whose
 * RETURN TYPE a `#if` splits still has its name and its parameter list, and
 * withholding it would drop every call in its body for a header that is
 * mostly intact. A type declaration is never withheld — its kind is its
 * keyword, which the grammar cannot confuse, and dropping a class drops
 * everything in it. In every case the ERROR is already a `cs_parse_gap` row
 * naming the node, so the loss that IS taken is recorded rather than silent.
 *
 * ## Since the fork's grammar
 *
 * The shape above is a CLEAN PARSE now: `preproc_if_in_function_body` and
 * `preproc_if_in_property_body` give a `#if`-split body one node per branch,
 * and the body read is the branch this emission takes. No shape in the gate
 * corpus reaches this rule any more, and its negative control was removed
 * with that reason. It stays as a net for recoveries nobody has seen, on the
 * same principle — a kind that is a guess is withheld, and the gap row says
 * where — and the day a fixture produces debris again, the control returns.
 */
export function isRecoveryDebris(node: Parser.SyntaxNode): boolean {
  const nameNode = node.childForFieldName('name');
  if (nameNode !== null && CSHARP_RESERVED_KEYWORDS.has(nameNode.text)) {
    return true;
  }
  if (node.type !== 'property_declaration') {
    return false;
  }
  for (let i = 0; i < node.childCount; i += 1) {
    if (node.child(i)?.type === 'ERROR') {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// callables
// ---------------------------------------------------------------------------

function emitCallable(
  node: Parser.SyntaxNode,
  options: CsMemberExtractionOptions,
  result: CsMemberExtractionResult,
  /**
   * The C# 14 extension-block receiver governing this member, ALREADY READ.
   *
   * Facts rather than a node, because a flattened block has no receiver node
   * left to read — see flattenedReceiverFacts.
   */
  extensionReceiver?: ParameterFacts
): void {
  // The HEADER — the node itself, or the taken branch's `method_header` /
  // `constructor_header` when the header sits under a `#if` (fork rule 32).
  // Modifiers, name, parameters, type parameters, return type and attributes
  // are read from it; the body, the span and the identity stay on `node`.
  const header = headerOf(node, options.activeSymbols);
  if (header === undefined) {
    return;
  }
  const modifiers = readMethodModifiers(header, options.activeSymbols);
  // The KIND is the declaration's node type — `constructor_declaration` — and
  // the header fragment's is not it.
  const kind = callableKind(node, modifiers, options.typeName);
  const parameterList = childOfType(header, 'parameter_list');
  const declared = readParameters(parameterList, options.activeSymbols);
  // The block's receiver goes in FRONT, as the `this` parameter it lowers to —
  // and only on an INSTANCE member: a `static` member of an extension block
  // takes no receiver, exactly as it does not in C# 13.
  const receiverFacts =
    extensionReceiver === undefined || modifiers.has(CsMethodModifier.STATIC)
      ? undefined
      : extensionReceiver;
  const parameters = receiverFacts === undefined ? declared : [receiverFacts, ...declared];
  const explicitInterface = childOfType(header, 'explicit_interface_specifier');
  // NORMALISED. `@class` IS the identifier `class`, and `\u0041bc` IS `Abc`.
  // Keeping the raw spelling does not merely miss the link between a
  // declaration and its use — it INVENTS one, because the use then looks like a
  // reference to something undeclared.
  const name = normalizeCSharpIdentifier(callableName(header, kind, options.typeName));

  const method = new CsMethodRegistry({
    name,
    qualifiedName: `${options.typeQualifiedName}.${name}`,
    arity: typeParameterCount(header),
    signature: signatureOf(parameters),
    methodKind: kind,
    returnTypeName: returnTypeOf(header, kind, options.activeSymbols),
    // An explicit interface implementation has NO accessibility modifier and is
    // NOT private: it is callable through the interface. 4,733 sites.
    methodAccess:
      explicitInterface !== undefined
        ? CsTypeAccess.NONE
        : accessOf(modifiers, options.typeCategory),
    methodModifiers: modifiers,
    isStatic: modifiers.has(CsMethodModifier.STATIC),
    isAbstract: modifiers.has(CsMethodModifier.ABSTRACT),
    isVirtual: modifiers.has(CsMethodModifier.VIRTUAL),
    isOverride: modifiers.has(CsMethodModifier.OVERRIDE),
    isSealed: modifiers.has(CsMethodModifier.SEALED),
    isAsync: modifiers.has(CsMethodModifier.ASYNC),
    isIterator: containsYield(node, options.activeSymbols),
    isExtension: parameters.some((p) => p.isThis),
    isPartialDefinition:
      modifiers.has(CsMethodModifier.PARTIAL) && bodyKindOf(node, options.activeSymbols) === CsBodyKind.NONE,
    isPartialImplementation:
      modifiers.has(CsMethodModifier.PARTIAL) && bodyKindOf(node, options.activeSymbols) !== CsBodyKind.NONE,
    explicitInterfaceName: explicitInterfaceNameOf(explicitInterface),
    operatorToken: operatorTokenOf(header),
    conversionKind: conversionKindOf(header),
    csModuleLinkHash: options.csModuleLinkHash,
    csTypeLinkHash: options.csTypeLinkHash,
    isAccessor: false,
    ownerMemberLinkHash: '',
    ownerMemberKind: CsOwnerMemberKind.NONE,
    parameterCount: parameters.length,
    // The declaration starts where its first ATTRIBUTE or MODIFIER is, not at a
    // `#if` DIRECTIVE guarding them — a directive is trivia and belongs to no
    // declaration. See declarationSpanStartNode.
    startLine: startLine(declarationSpanStartNode(node, options.activeSymbols)),
    endLine: endLine(node),
    startColumn: startColumn(declarationSpanStartNode(node, options.activeSymbols)),
    bodyKind: bodyKindOf(node, options.activeSymbols),
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  });

  result.methods.push(method);
  // ATTRIBUTES, not bracket groups. The column existed with a setter nobody
  // called, so every method reported 0 — invisible until cs_attribute gave it
  // something to disagree with.
  method.setAttributeCount(countAttributes(header, options.activeSymbols));
  addDeclarationOwner(result.declarationOwners, nodeId(node), {
    hash: method.getHash(),
    kind: CsDeclarationOwnerKind.METHOD,
  });
  if (header.id !== node.id) {
    // The attribute walk finds a declaration's lists by the owner registered
    // on the node they hang from; under a `#if` they hang from the header.
    addDeclarationOwner(result.declarationOwners, nodeId(header), {
      hash: method.getHash(),
      kind: CsDeclarationOwnerKind.METHOD,
    });
  }
  const parameterRows = buildParameterRows(
    parameters,
    method.getHash(),
    options.serviceVersionLinkHash,
    result.declarationOwners,
    { options, result }
  );
  result.parameters.push(...parameterRows);
  const ownTypeParameters = extractTypeParameters({
    declarationNode: header,
    activeSymbols: options.activeSymbols,
    ownerLinkHash: method.getHash(),
    ownerKind: CsTypeParameterOwnerKind.METHOD,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    typeReferenceSink: result.typeReferences,
    declarationOwnerSink: result.declarationOwners,
  });
  result.typeParameters.push(...ownTypeParameters);
  emitSignatureTypeReferences(
    node, method.getHash(), parameters, parameterRows, options, result, ownTypeParameters
  );
  // `void IFoo.Bar()` names IFoo, and the member is callable ONLY through it.
  // Without the reference the interface is unreachable from the member.
  if (explicitInterface !== undefined) {
    result.typeReferences.push(
      ...extractTypeReferences({
        typeNode: namedChildren(explicitInterface)[0],
        ownerLinkHash: method.getHash(),
        referenceOwnerKind: CsReferenceOwnerKind.METHOD,
        context: CsTypeRefContext.EXPLICIT_INTERFACE,
        serviceVersionLinkHash: options.serviceVersionLinkHash,
      })
    );
  }

  // `: base(x)` and `: this(x)`. A call edge to another constructor, sitting
  // outside the body — so the body walk never saw it and it was emitted
  // nowhere. The caller IS this constructor, unlike a field initializer.
  emitInitializerExpressions(
    {
      node: childOfType(node, 'constructor_initializer'),
      ownerKind: CsExpressionOwnerKind.METHOD,
      ownerHash: method.getHash(),
      rootContext: CsRootContext.CONSTRUCTOR_INITIALIZER,
      callerMethodLinkHash: method.getHash(),
    },
    options,
    result
  );
  const boundaries = emitBody(node, method, parameters, options, result);
  emitLocalFunctions(node, options, result, boundaries);
}

/**
 * The EXPRESSIONS in a callable's body, and the lambdas that own their own.
 *
 * §6: the worklist stops at a function boundary and the caller descends
 * explicitly. `return function () { … }` emitted the function and nothing
 * inside it — 45 of 691 call sites — and every row that WAS emitted was
 * correct; there were simply fewer of them. So each lambda gets a `cs_method`
 * row of its own and its body is walked with THAT as owner, which is what makes
 * a call inside a callback belong to the callback.
 */
function emitBody(
  node: Parser.SyntaxNode,
  owner: CsMethodRegistry,
  parameters: readonly ParameterFacts[],
  options: CsMemberExtractionOptions,
  result: CsMemberExtractionResult,
  /**
   * The scope this body was declared under, when it is a nested callable's:
   * the enclosing body's locals and local functions at that point. A method's
   * own body has none.
   */
  enclosing?: BoundaryScope
): ReadonlyMap<number, BoundaryScope> {
  // `node` is either a DECLARATION whose body must be found, or a body already
  // — an accessor hands its own. Accepting both keeps one walk rather than two
  // that could drift.
  const body =
    node.type === 'block' || node.type === 'arrow_expression_clause'
      ? node
      : functionBodyOf(node, options.activeSymbols);
  const boundaries = new Map<number, BoundaryScope>();
  if (body === undefined) {
    return boundaries;
  }

  const parameterNames = new Set(parameters.map((p) => p.name));
  const expressionResult: CsExpressionResult = {
    expressions: result.expressions,
    callSites: result.callSites,
    queryClauses: result.queryClauses,
    // Filled by the expression pass and read by the block pass, so a block's
    // condition and a local's initializer point at the row the expression layer
    // actually emitted. Keyed on `node.id`, never written onto the node.
    rootHashByNodeId: new Map(),
    hashByNodeId: new Map(),
    rowByNodeId: new Map(),
    pendingReferenceLinks: result.pendingReferenceLinks,
    typeReferences: result.typeReferences,
  };

  // ONCE PER BODY, not once per root.
  //
  // These three are full walks of the body. They were computed inside
  // `contextFor`, which is called once per statement root — so a body of N
  // statements walked itself 3N times, and the extractor was QUADRATIC in
  // statements per method. cs-corpus measured it: 250 statements 39 s, 500
  // statements 163 s, 1,000 killed, against 2,000 in 13 s on the commit before.
  // It blocked the whole sweep, because linq-heavy-A's generated baselines hold
  // methods of that size and linq-heavy-A is 65% of the corpus's call sites.
  //
  // A verification that trimmed the corpus to fit memory did not see it,
  // because it trimmed out exactly the files that exhaust memory. A check
  // sized to pass is a check incapable of failing.
  // The local functions in scope are PER ROOT now, from the statement walk:
  // a block's own declarations plus every enclosing block's, and the enclosing
  // callable's scope at the point this body was declared. A local function
  // calling itself (`Factorial(x - 1)`) or a sibling (`IsEven` ↔ `IsOdd`)
  // names a function declared in the ENCLOSING body — Roslyn adjudicated
  // three such calls as LOCAL_FUNCTION_CALL — and a local function nested in
  // one branch does NOT make every same-named call in the method a call to it,
  // which the body-wide set claimed 69 times over one stratum.
  const enclosingLocalFunctionNames =
    enclosing?.localFunctionNames ?? options.enclosingLocalFunctionNames;
  const patternBindingNames = patternBindingNamesIn(body, options.activeSymbols);
  const queryRangeVariableNames = queryRangeVariableNamesIn(body, options.activeSymbols);
  const typeParameterNames = new Set(options.typeParametersInScope.keys());

  const contextFor = (
    methodHash: string,
    rootContext: CsRootContext,
    names: ReadonlySet<string>,
    localFunctionNames: ReadonlySet<string>
  ): CsExpressionContext => ({
    csModuleLinkHash: options.csModuleLinkHash,
    csTypeLinkHash: options.csTypeLinkHash,
    ownerKind: CsExpressionOwnerKind.METHOD,
    ownerHash: methodHash,
    rootContext,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    callerMethodLinkHash: methodHash,
    parameterNames: names,
    typeParameterNames,
    typeParametersInScope: options.typeParametersInScope,
    methodNamesOnType: options.methodNamesOnType,
    eventNamesOnType: options.eventNamesOnType,
    valueMemberNamesOnType: options.valueMemberNamesOnType,
    fieldNamesOnType: options.fieldNamesOnType,
    propertyNamesOnType: options.propertyNamesOnType,
    localFunctionNames,
    lambdaParameterNames: new Set(),
    patternBindingNames,
    queryRangeVariableNames,
    usingAliasNames: options.usingAliasNames,
    // `await` is a keyword in an async body and an identifier elsewhere.
    awaitIsKeyword: owner.isAsync,
    activeSymbols: options.activeSymbols,
  });

  // An expression-bodied member is one expression in EXPRESSION_BODY context;
  // a block is a statement walk.
  if (body.type === 'arrow_expression_clause') {
    // An expression body declares no local function and no local; what it
    // sees is exactly the enclosing scope. Recorded under the body's own id so
    // a lambda inside it climbs to this entry.
    boundaries.set(body.id, {
      localNames: enclosing?.localNames ?? new Set(),
      localFunctionNames: enclosingLocalFunctionNames,
    });
    extractExpressionTree(
      body,
      contextFor(owner.getHash(), CsRootContext.EXPRESSION_BODY, parameterNames, enclosingLocalFunctionNames),
      expressionResult,
      0,
      enclosing?.localNames
    );
  } else {
    let position = 0;
    const roots = collectExpressionRoots(body, options.activeSymbols, {
      enclosingLocals: enclosing?.localNames,
      enclosingLocalFunctions: enclosingLocalFunctionNames,
      boundaries,
    });
    for (const root of roots) {
      extractExpressionTree(
        root.node,
        contextFor(owner.getHash(), root.rootContext, parameterNames, root.localFunctionNames),
        expressionResult,
        position,
        root.localNames
      );
      position += 1;
    }
  }

  // AFTER the expressions, because the block pass reads the hashes that pass
  // recorded. Running it first would leave every link column empty and the
  // emptiness would look exactly like "this block has no condition".
  emitBlocks(body, owner, options, result, expressionResult);

  // Each lambda gets its OWN method row, so its body's calls belong to it —
  // walked under the scope the enclosing walk recorded where the lambda sits.
  for (const lambda of collectLambdas(body, options.activeSymbols)) {
    emitLambda(
      lambda,
      options,
      result,
      expressionResult,
      parameterNames,
      scopeAt(lambda, boundaries, body)
    );
  }
  return boundaries;
}

/**
 * The blocks and locals of one body, owned by one method row.
 *
 * Called once per body and never re-entered for a nested function: a lambda's
 * body is walked by its OWN call, with its own method as owner. A construct
 * reached twice produces two rows with identical keys, and duplicates DOUBLE.
 */
function emitBlocks(
  body: Parser.SyntaxNode,
  owner: CsMethodRegistry,
  options: CsMemberExtractionOptions,
  result: CsMemberExtractionResult,
  expressionResult: CsExpressionResult
): void {
  const extracted = extractBlocksAndVariables({
    body,
    rootBlockKind: rootBlockKindOf(owner),
    rootScopeKind:
      owner.methodKind === CsMethodKind.LAMBDA ||
      owner.methodKind === CsMethodKind.ANONYMOUS_METHOD
        ? CsVariableScopeKind.LAMBDA_BODY
        : CsVariableScopeKind.METHOD_BODY,
    csModuleLinkHash: options.csModuleLinkHash,
    csTypeLinkHash: options.csTypeLinkHash,
    csMethodLinkHash: owner.getHash(),
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    activeSymbols: options.activeSymbols,
    typeParametersInScope: options.typeParametersInScope,
    rootHashByNodeId: expressionResult.rootHashByNodeId,
  });
  result.blocks.push(...extracted.blocks);
  result.variables.push(...extracted.variables);
  result.typeReferences.push(...extracted.typeReferences);
}

/**
 * What the outermost block of a body IS.
 *
 * Derived from the owner's `methodKind` rather than from the node, because the
 * node is a `block` in every one of these cases and only the owner knows which
 * kind of callable it belongs to. Every value here is reachable, which is what
 * the enum audit checks — `ACCESSOR_BODY` in particular, since accessors are
 * 68% of `cs_method`.
 */
function rootBlockKindOf(owner: CsMethodRegistry): CsBlockKind {
  if (owner.isAccessor) {
    return CsBlockKind.ACCESSOR_BODY;
  }
  switch (owner.methodKind) {
    case CsMethodKind.CONSTRUCTOR:
    case CsMethodKind.STATIC_CONSTRUCTOR:
    case CsMethodKind.PRIMARY_CONSTRUCTOR:
    case CsMethodKind.DESTRUCTOR:
      return CsBlockKind.CONSTRUCTOR_BODY;
    case CsMethodKind.LOCAL_FUNCTION:
      return CsBlockKind.LOCAL_FUNCTION_BODY;
    case CsMethodKind.LAMBDA:
    case CsMethodKind.ANONYMOUS_METHOD:
      return CsBlockKind.LAMBDA_BODY;
    default:
      return CsBlockKind.METHOD_BODY;
  }
}

/**
 * TOP-LEVEL STATEMENTS — a file with no type and no method whose code is still
 * code.
 *
 * ```csharp
 * // Program.cs, in full
 * Console.WriteLine("Hello, World!");
 * ```
 *
 * There is no `class`, no `Main`, and no declaration of any kind — and the
 * member walk starts at a type, so this file contributed NOTHING. Every call in
 * every minimal-hosting `Program.cs` was absent, which for a modern ASP.NET app
 * is where the entire application is wired up.
 *
 * ## The owner is `Program.<Main>$`, and Roslyn said so — RULING v1.6 §4.0.3
 *
 * The compiler synthesises `Program.<Main>$` to hold these. Whether a
 * construct with no declaration syntax emits was cs-oracle's question, and
 * Roslyn answered it: BOTH the method and its type carry exactly one
 * DeclaringSyntaxReference, pointing at the compilation unit; every global
 * statement's enclosing symbol is `<Main>$`; a top-level local function is
 * contained by it. They are not symbols without syntax. So the statements are
 * owned by a METHOD row of kind TOP_LEVEL_ENTRY_POINT, static, returning void,
 * positioned at the compilation unit, on a type row named `Program` that the
 * fact extractor synthesises (see {@link synthesizedProgramType} there), and
 * every call in a minimal-hosting `Program.cs` has a real
 * `callerMethodLinkHash`. Before the ruling the owner was the FILE
 * (`MODULE_INIT`) and the caller hash was empty.
 */
/**
 * The global statements that make a file a TOP-LEVEL PROGRAM.
 *
 * ONE reading of the question, because there were two: the member extractor
 * minted `<Main>$` from this test and the fact extractor minted the `Program`
 * type from its own copy of it, so fixing one left the other inventing a type
 * for a file that declares none — a row whose own method did not exist.
 *
 * MINUS A BARE `;`. A global statement that is nothing but an empty statement
 * runs nothing and declares nothing, and every one of them in this corpus came
 * from ERROR RECOVERY — a semicolon the recovery could not attach to what it
 * belonged to. Counting them turned a file with no top-level statements into a
 * program: a `<Main>$` method and a synthesised `Program` type the file does
 * not contain. The commonest source was C# 12's semicolon-bodied type
 * declaration, which is rewritten before parsing now
 * (cs-semicolon-body.ts), but the recovery has other ways to strand a
 * semicolon and this covers those too.
 */
export function topLevelStatementsOf(root: Parser.SyntaxNode): Parser.SyntaxNode[] {
  // AFTER A NAMESPACE OR A TYPE, a global statement is not one. C# requires
  // top-level statements to precede every namespace and type declaration in
  // their file, so a `global_statement` that follows one is not a statement the
  // language allows there — it is ERROR RECOVERY having ejected something from
  // the declaration above it.
  //
  // Measured: three library files in source-generator-B were flagged as
  // top-level programs, and what the recovery had ejected was METHOD
  // DECLARATIONS — `Task InternalStopListeningAsync(...) { … }` sitting at file
  // scope after a sealed partial class. That minted a `<Main>$` and a
  // synthesised `Program` type in files that contain neither.
  //
  // The rule is syntactic and exact, which is why it is used instead of asking
  // whether the file has errors: a file may have both a gap and real top-level
  // statements, and this keeps those.
  //
  // IT REPLACED a narrower guard that ignored a global statement holding only a
  // bare `;`. That guard was written for the same recovery debris and is now
  // subsumed — recovery ejects PAST a declaration, which this catches — and
  // keeping it would have been a liability rather than a duplicate: a file whose
  // FIRST element is a bare `;` is a legal top-level program that Roslyn mints
  // `<Main>$` for, and the guard would have denied it. A rule that disagrees
  // with the compiler on a legal file is worse than no rule where the case it
  // was defending is already covered.
  let seenDeclaration = false;
  const out: Parser.SyntaxNode[] = [];
  for (const child of namedChildren(root)) {
    if (
      child.type === 'namespace_declaration' ||
      child.type === 'file_scoped_namespace_declaration' ||
      child.type.endsWith('_declaration')
    ) {
      seenDeclaration = true;
      continue;
    }
    if (child.type !== 'global_statement' || seenDeclaration) {
      continue;
    }
    out.push(child);
  }
  return out;
}

export function extractTopLevelStatements(input: {
  readonly root: Parser.SyntaxNode;
  readonly csModuleLinkHash: string;
  readonly serviceVersionLinkHash: string;
  readonly activeSymbols: ReadonlySet<string>;
  readonly usingAliasNames: ReadonlySet<string>;
  /**
   * The synthesised `Program` type's hash — the container of `<Main>$` and of
   * every top-level local function. The fact extractor mints the type row and
   * hands its hash in, so one place owns the synthesis.
   */
  readonly programTypeLinkHash: string;
}): CsMemberExtractionResult {
  const result: CsMemberExtractionResult = {
    methods: [],
    parameters: [],
    properties: [],
    events: [],
    typeParameters: [],
    typeReferences: [],
    fields: [],
    enumMembers: [],
    expressions: [],
    callSites: [],
    queryClauses: [],
    blocks: [],
    variables: [],
    pendingReferenceLinks: [],
    declarationOwners: new Map(),
  };
  const statements = topLevelStatementsOf(input.root);
  if (statements.length === 0) {
    return result;
  }

  // `<Main>$`. Static, void, positioned at the compilation unit — Roslyn's
  // DeclaringSyntaxReference for it — with no accessibility of its own beyond
  // what the compiler gives it (private, on an internal type).
  const entryPoint = new CsMethodRegistry({
    name: CSHARP_ANONYMOUS_METHOD_NAMES.TOP_LEVEL_MAIN,
    qualifiedName: `${CSHARP_SYNTHESIZED_PROGRAM_TYPE_NAME}.${CSHARP_ANONYMOUS_METHOD_NAMES.TOP_LEVEL_MAIN}`,
    arity: 0,
    signature: '',
    methodKind: CsMethodKind.TOP_LEVEL_ENTRY_POINT,
    returnTypeName: 'void',
    methodAccess: CsTypeAccess.PRIVATE,
    methodModifiers: new Set([CsMethodModifier.STATIC]),
    isStatic: true,
    isAbstract: false,
    isVirtual: false,
    isOverride: false,
    isSealed: false,
    isAsync: false,
    isIterator: false,
    isExtension: false,
    isPartialDefinition: false,
    isPartialImplementation: false,
    explicitInterfaceName: '',
    operatorToken: '',
    conversionKind: CsConversionKind.NONE,
    csModuleLinkHash: input.csModuleLinkHash,
    csTypeLinkHash: input.programTypeLinkHash,
    isAccessor: false,
    ownerMemberLinkHash: '',
    ownerMemberKind: CsOwnerMemberKind.NONE,
    parameterCount: 0,
    startLine: startLine(input.root),
    endLine: endLine(input.root),
    startColumn: startColumn(input.root),
    bodyKind: CsBodyKind.BLOCK,
    serviceVersionLinkHash: input.serviceVersionLinkHash,
  });
  result.methods.push(entryPoint);
  const entryPointHash = entryPoint.getHash();

  // The options bag for the synthesised type. Every helper below is the same
  // one a written method's body goes through, which is what keeps top-level
  // code walked by one code path rather than a second walker that drifts.
  const options: CsMemberExtractionOptions = {
    declarationNode: input.root,
    typeParametersInScope: new Map(),
    methodNamesOnType: new Set(),
    eventNamesOnType: new Set(),
    valueMemberNamesOnType: new Set(),
    fieldNamesOnType: new Set(),
    propertyNamesOnType: new Set(),
    usingAliasNames: input.usingAliasNames,
    enclosingLocalFunctionNames: new Set(),
    csModuleLinkHash: input.csModuleLinkHash,
    csTypeLinkHash: input.programTypeLinkHash,
    typeQualifiedName: CSHARP_SYNTHESIZED_PROGRAM_TYPE_NAME,
    typeCategory: CsTypeCategory.CLASS,
    typeName: CSHARP_SYNTHESIZED_PROGRAM_TYPE_NAME,
    serviceVersionLinkHash: input.serviceVersionLinkHash,
    activeSymbols: input.activeSymbols,
  };
  const expressionResult: CsExpressionResult = {
    expressions: result.expressions,
    callSites: result.callSites,
    queryClauses: result.queryClauses,
    rootHashByNodeId: new Map(),
    hashByNodeId: new Map(),
    rowByNodeId: new Map(),
    pendingReferenceLinks: result.pendingReferenceLinks,
    typeReferences: result.typeReferences,
  };
  const context: CsExpressionContext = {
    csModuleLinkHash: input.csModuleLinkHash,
    csTypeLinkHash: input.programTypeLinkHash,
    ownerKind: CsExpressionOwnerKind.METHOD,
    ownerHash: entryPointHash,
    rootContext: CsRootContext.EXPRESSION_STATEMENT,
    serviceVersionLinkHash: input.serviceVersionLinkHash,
    callerMethodLinkHash: entryPointHash,
    // `args` is `<Main>$`'s one parameter — `string[] args`, implicit, and
    // bound as a PARAMETER by Roslyn wherever a top-level statement names it.
    // The parameter has no declaration syntax and gets no row; the reference
    // kind is a fact regardless.
    parameterNames: new Set(['args']),
    typeParameterNames: new Set(),
    methodNamesOnType: new Set(),
    eventNamesOnType: new Set(),
    valueMemberNamesOnType: new Set(),
    fieldNamesOnType: new Set(),
    propertyNamesOnType: new Set(),
    // Per root, from the walk: the statement list is one declaring scope, and
    // a local function inside a TYPE declared further down the same file is
    // not in it. The file-wide set said it was.
    localFunctionNames: new Set(),
    lambdaParameterNames: new Set(),
    patternBindingNames: patternBindingNamesIn(input.root, input.activeSymbols),
    queryRangeVariableNames: queryRangeVariableNamesIn(input.root, input.activeSymbols),
    usingAliasNames: input.usingAliasNames,
    // Top-level statements may await; the compiler makes <Main>$ async.
    awaitIsKeyword: true,
    activeSymbols: input.activeSymbols,
  };

  // ONE walk over ALL the statements, sharing one locals table. Per-statement
  // walks gave each statement a fresh scope.
  let position = 0;
  const boundaries = new Map<number, BoundaryScope>();
  const roots = collectExpressionRoots(statements, options.activeSymbols, { boundaries });
  for (const root of roots) {
    extractExpressionTree(
      root.node,
      { ...context, rootContext: root.rootContext, localFunctionNames: root.localFunctionNames },
      expressionResult,
      position,
      root.localNames
    );
    position += 1;
  }
  for (const statement of statements) {
    // A lambda or a local function in top-level code gets its own method row,
    // for the same reason one in a body does — under the scope recorded where
    // it sits, so `scale(3)` inside a top-level lambda still sees `scale`.
    for (const lambda of collectLambdas(statement, options.activeSymbols)) {
      emitLambda(
        lambda,
        options,
        result,
        expressionResult,
        new Set(),
        scopeAt(lambda, boundaries, statements)
      );
    }
    emitLocalFunctions(statement, options, result, boundaries);
  }

  // The LOCALS. `var builder = WebApplication.CreateBuilder(args);` is the
  // first line of every minimal-hosting app, and the name it binds is referred
  // to by everything after it.
  for (const statement of statements) {
    const extracted = extractBlocksAndVariables({
      body: statement,
      rootBlockKind: CsBlockKind.METHOD_BODY,
      rootScopeKind: CsVariableScopeKind.METHOD_BODY,
      csModuleLinkHash: input.csModuleLinkHash,
      csTypeLinkHash: input.programTypeLinkHash,
      // Owned by `<Main>$`, whose hash is per file — so two Program.cs of the
      // same shape no longer collide on an empty owner.
      csMethodLinkHash: entryPointHash,
      serviceVersionLinkHash: input.serviceVersionLinkHash,
      activeSymbols: input.activeSymbols,
      rootHashByNodeId: expressionResult.rootHashByNodeId,
    });
    result.blocks.push(...extracted.blocks);
    result.variables.push(...extracted.variables);
    result.typeReferences.push(...extracted.typeReferences);
  }
  // The whole file is one member here: `<Main>$`, its lambdas, its local
  // functions.
  resolveReferenceLinks(result, { variables: 0, parameters: 0, links: 0 });

  return result;
}

/**
 * Names bound by a PATTERN or an `out var` anywhere in a body.
 *
 * `x is Foo f` then `f`; `case Foo f:` then `f`; `TryParse(s, out var n)` then
 * `n`. cs_variable records each binding; this is the set that lets a later
 * reference say which kind of declaration it points back to. Collected for
 * the whole body rather than as the walk passes, because the reference can be
 * in the same expression as the binding (`o is string s && s.Length > 0`).
 */
function patternBindingNamesIn(
  body: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): ReadonlySet<string> {
  const names = new Set<string>();
  const stack = [body];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (
      node.type === 'declaration_pattern' ||
      node.type === 'recursive_pattern' ||
      node.type === 'var_pattern' ||
      node.type === 'declaration_expression'
    ) {
      const nameNode = node.childForFieldName('name');
      if (nameNode !== null && nameNode.type === 'identifier') {
        names.add(normalizeCSharpIdentifier(nameNode.text));
      }
    }
    for (const child of activeNamedChildren(node, activeSymbols)) {
      stack.push(child);
    }
  }
  return names;
}

/**
 * Names bound by LINQ clauses anywhere in a body — `from x`, `let x`,
 * `join x`, `into x`. Referenced by every clause after the binding.
 */
function queryRangeVariableNamesIn(
  body: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): ReadonlySet<string> {
  const names = new Set<string>();
  const stack = [body];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'from_clause') {
      const nameNode = node.childForFieldName('name');
      if (nameNode !== null) {
        names.add(normalizeCSharpIdentifier(nameNode.text));
      }
    } else if (
      node.type === 'let_clause' ||
      node.type === 'join_clause' ||
      node.type === 'join_into_clause' ||
      node.type === 'query_continuation'
    ) {
      const nameNode = childOfType(node, 'identifier');
      if (nameNode !== undefined) {
        names.add(normalizeCSharpIdentifier(nameNode.text));
      }
    } else if (node.type === 'query_expression') {
      // `into g` as a CONTINUATION is a bare identifier under the query.
      for (const child of namedChildren(node)) {
        if (child.type === 'identifier') {
          names.add(normalizeCSharpIdentifier(child.text));
        }
      }
    }
    for (const child of activeNamedChildren(node, activeSymbols)) {
      stack.push(child);
    }
  }
  return names;
}

/**
 * The expression tree of an INITIALIZER, owned by the declaration it sits on.
 *
 * ## Why this exists at all
 *
 * The expression walk started at method bodies AND NOTHING ELSE. Measured on
 * 5,773 linq-heavy-A files: `CsExpressionOwnerKind` was 1 of 11 — only `METHOD` had
 * ever been emitted — so a field initializer, a property initializer, a
 * parameter default, an enum member value and a constructor initializer
 * contributed no expressions at all.
 *
 * `static readonly Regex Rx = new Regex("...")` is an object creation and a
 * call site, and neither existed in the fact base. Nothing counted it, because
 * the enclosing type's methods were all present and the count of expressions
 * was large and plausible.
 *
 * ## The OWNER is the declaration, not the enclosing method
 *
 * There is no enclosing method. A field initializer runs from the constructor
 * the compiler synthesises, and attributing it to some nearby method would put
 * a call on a stack it never appears on. `callerMethodLinkHash` is therefore
 * empty for these, and `cs_call_site` records a call whose CALLER is a
 * declaration — which is the truth, and the engine's to attach to whichever
 * constructor it decides runs it.
 */
function emitInitializerExpressions(
  input: {
    readonly node: Parser.SyntaxNode | null | undefined;
    readonly ownerKind: CsExpressionOwnerKind;
    readonly ownerHash: string;
    readonly rootContext: CsRootContext;
    readonly callerMethodLinkHash?: string;
    readonly position?: number;
    /** A primary constructor's parameters, in scope in its base invocation. */
    readonly parameterNames?: ReadonlySet<string>;
  },
  options: CsMemberExtractionOptions,
  result: CsMemberExtractionResult
): string {
  if (input.node === null || input.node === undefined) {
    return '';
  }
  const expressionResult: CsExpressionResult = {
    expressions: result.expressions,
    callSites: result.callSites,
    queryClauses: result.queryClauses,
    rootHashByNodeId: new Map(),
    hashByNodeId: new Map(),
    rowByNodeId: new Map(),
    pendingReferenceLinks: result.pendingReferenceLinks,
    typeReferences: result.typeReferences,
  };
  const context: CsExpressionContext = {
    csModuleLinkHash: options.csModuleLinkHash,
    csTypeLinkHash: options.csTypeLinkHash,
    ownerKind: input.ownerKind,
    ownerHash: input.ownerHash,
    rootContext: input.rootContext,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    callerMethodLinkHash: input.callerMethodLinkHash ?? '',
    // An initializer is outside every method, so no parameter is in scope. A
    // primary constructor's parameters ARE, and that caller passes them.
    parameterNames: input.parameterNames ?? new Set(),
    typeParameterNames: new Set(options.typeParametersInScope.keys()),
    typeParametersInScope: options.typeParametersInScope,
    methodNamesOnType: options.methodNamesOnType,
    eventNamesOnType: options.eventNamesOnType,
    valueMemberNamesOnType: options.valueMemberNamesOnType,
    fieldNamesOnType: options.fieldNamesOnType,
    propertyNamesOnType: options.propertyNamesOnType,
    // An initializer is outside every body, so no local function is in scope.
    localFunctionNames: new Set(),
    lambdaParameterNames: new Set(),
    patternBindingNames: input.node === null || input.node === undefined ? new Set() : patternBindingNamesIn(input.node, options.activeSymbols),
    queryRangeVariableNames: input.node === null || input.node === undefined ? new Set() : queryRangeVariableNamesIn(input.node, options.activeSymbols),
    usingAliasNames: options.usingAliasNames,
    // An initializer is outside every callable; `await` is an identifier.
    awaitIsKeyword: false,
    activeSymbols: options.activeSymbols,
  };
  extractExpressionTree(input.node, context, expressionResult, input.position ?? 0);
  // THE ROOT'S HASH, returned so the declaration can name its initializer.
  // cs_field and cs_property both carry initializerExpressionLinkHash with a
  // setter nothing called — the same declared-and-never-written class the
  // link partition found three of. The walk records the root under the node
  // handed in, so this is a lookup by node id, never an assumption.
  const rootHash = expressionResult.rootHashByNodeId?.get(nodeId(input.node)) ?? '';

  // A LAMBDA in an initializer gets its own `cs_method` row, for the same
  // reason one in a body does: it is a call target invoked later, from a stack
  // the initializer never appears on. Without this, `Func<int,int> F = x =>
  // Compute(x);` has a call inside a callback owned by nothing — and it was
  // also the one attribute the coverage measurement on multitarget-A could not account
  // for, because a lambda with no method row has no owner to attach one to.
  //
  // Including the initializer that IS a lambda: `Func<int, int> F = x => x;`
  // and `event EventHandler E = delegate { };`. `collectLambdas` walks the
  // CHILDREN of the node it is handed, so a bare lambda at the root was never
  // found and had no method row — the IR-sufficiency report showed the two
  // in the gate corpus as expression rows naming no method.
  const initializerLambdas =
    input.node.type === 'lambda_expression' || input.node.type === 'anonymous_method_expression'
      ? [input.node]
      : collectLambdas(input.node, options.activeSymbols);
  for (const lambda of initializerLambdas) {
    // An initializer is outside every body: no local, no local function.
    emitLambda(lambda, options, result, expressionResult, new Set(), undefined);
  }
  return rootHash;
}

/**
 * A lambda or anonymous method as a `cs_method` row.
 *
 * It is a call target: a delegate holding it is invoked later, from a stack the
 * creating method never appears on. Without a row, every call inside a callback
 * has no owner and either vanishes or is attributed to whoever created it.
 */
function emitLambda(
  node: Parser.SyntaxNode,
  options: CsMemberExtractionOptions,
  result: CsMemberExtractionResult,
  expressionResult: CsExpressionResult,
  enclosingParameterNames: ReadonlySet<string>,
  /**
   * The enclosing body's scope where this lambda sits — its locals declared
   * so far and its local functions in scope — so `x => scale(x)` sees the
   * local `scale` and `() => Inner()` sees the local function `Inner`. A
   * lambda CAPTURES its enclosing scope; walking its body with an empty one
   * filed every captured local's invocation as a FUNCTION_CALL, which is a
   * lookup miss reported as a positive claim.
   */
  enclosing: BoundaryScope | undefined
): void {
  const isAnonymousMethod = node.type === 'anonymous_method_expression';
  // The `parameters` FIELD, which is a `parameter_list` for `(a, b) => …` and
  // an `implicit_parameter` for `x => …`. Reading only the list gave every
  // single-parameter lambda ZERO parameters, so `x` in `xs.Select(x => x + 1)`
  // was an unknown name and `g => g()` could not be seen invoking its own
  // parameter — 80% of the corpus's LINQ lambdas are the single-parameter
  // form. Found by adjudicating call kinds against Roslyn.
  const parameterNode = node.childForFieldName('parameters');
  // THE INVENTED LAMBDA'S PARAMETERS ARE ARGUMENTS. `AssertQuery(async, ss =>
  // …)` is read as a lambda whose parameter list holds the call's arguments, so
  // reading the list gave this lambda a parameter named `async` — the enclosing
  // method's own parameter, filed as a binding of a function that does not
  // exist. Only the LAST of them is a parameter of the real lambda. 4,783 sites
  // in linq-heavy; see misparsedAsyncArgumentCallOf for the discriminator.
  // Asked through the NARROW detector, so it applies even where the call repair
  // is refused: the refusals cannot reconstruct an argument list, but the
  // leading "parameters" are arguments in every one of them, and leaving those
  // as parameters leaves a binding that resolves to the wrong thing.
  const inventedParameter = inventedLambdaParameterOf(node);
  const parameters =
    inventedParameter !== undefined
      ? // ONE `parameter` NODE, not a list. `readParameters` iterates a
        // parameter LIST, so handing it a single parameter produced NOTHING and
        // the repaired lambdas came out with no parameter at all — trading a
        // false binding for a missing one, which the gate caught by asserting
        // the real parameter is still there.
        [readParameter(inventedParameter, options.activeSymbols)]
      : parameterNode !== null && parameterNode.type === 'implicit_parameter'
        ? [implicitParameter(parameterNode)]
        : readParameters(parameterNode ?? childOfType(node, 'parameter_list'), options.activeSymbols);
  const name = isAnonymousMethod
    ? CSHARP_ANONYMOUS_METHOD_NAMES.ANONYMOUS_METHOD
    : CSHARP_ANONYMOUS_METHOD_NAMES.LAMBDA;

  const method = new CsMethodRegistry({
    name,
    qualifiedName: `${options.typeQualifiedName}.${name}`,
    arity: 0,
    signature: signatureOf(parameters),
    methodKind: isAnonymousMethod
      ? CsMethodKind.ANONYMOUS_METHOD
      : CsMethodKind.LAMBDA,
    returnTypeName: '',
    // A lambda has NO accessibility: it is reachable only through the delegate
    // that holds it. PRIVATE would overstate its reach.
    methodAccess: CsTypeAccess.NONE,
    methodModifiers: new Set(),
    isStatic: childrenOfType(node, 'modifier').some((m) => m.text.trim() === 'static'),
    isAbstract: false,
    isVirtual: false,
    isOverride: false,
    isSealed: false,
    // `async` is an aliased `modifier` node with no children, exactly as
    // `static` is one line up. This read looked for an anonymous `async`
    // token and so was false on every one of 1,231 fixture lambdas — and
    // until fork12 the grammar agreed, reading `async` as the lambda's return
    // TYPE. A lambda read as not async walks its body with await as an
    // identifier: `await F()` became a NAME_REFERENCE named `await`.
    isAsync: childrenOfType(node, 'modifier').some((m) => m.text.trim() === 'async'),
    isIterator: containsYield(node, options.activeSymbols),
    isExtension: false,
    isPartialDefinition: false,
    isPartialImplementation: false,
    explicitInterfaceName: '',
    operatorToken: '',
    conversionKind: CsConversionKind.NONE,
    csModuleLinkHash: options.csModuleLinkHash,
    csTypeLinkHash: options.csTypeLinkHash,
    isAccessor: false,
    ownerMemberLinkHash: '',
    ownerMemberKind: CsOwnerMemberKind.NONE,
    parameterCount: parameters.length,
    // The declaration starts where its first ATTRIBUTE or MODIFIER is, not at a
    // `#if` DIRECTIVE guarding them — a directive is trivia and belongs to no
    // declaration. See declarationSpanStartNode.
    startLine: startLine(declarationSpanStartNode(node, options.activeSymbols)),
    endLine: endLine(node),
    startColumn: startColumn(declarationSpanStartNode(node, options.activeSymbols)),
    bodyKind: bodyKindOf(node, options.activeSymbols),
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  });
  result.methods.push(method);
  // THE LINK FROM THE EXPRESSION ROW TO THIS METHOD ROW. The lambda's own
  // expression row was emitted by the ENCLOSING walk and recorded by node id;
  // `anonymousDeclarationHash` is the column that names the method row it
  // became, and the setter existed with nothing calling it — 0 of 99,529
  // lambda rows on one stratum carried the link, so an engine following a
  // delegate to the code it runs had to match rows by position.
  expressionResult.rowByNodeId?.get(nodeId(node))?.setAnonymousDeclarationHash(method.getHash());
  method.setAttributeCount(countAttributes(node, options.activeSymbols));
  addDeclarationOwner(result.declarationOwners, nodeId(node), {
    hash: method.getHash(),
    kind: CsDeclarationOwnerKind.METHOD,
  });
  const lambdaParameterRows = buildParameterRows(
    parameters,
    method.getHash(),
    options.serviceVersionLinkHash,
    result.declarationOwners,
    { options, result }
  );
  result.parameters.push(...lambdaParameterRows);
  // A TYPED lambda parameter's type — `(int x) => …` — as a reference of its
  // own context (ruling v1.7). 24,375 typed lambda parameters on one
  // stratum had no type tree. The ABSENCE of a reference on a lambda
  // parameter stays the signal that it is inferred.
  parameters.forEach((facts, index) => {
    const row = lambdaParameterRows[index];
    if (row === undefined || facts.typeNode === undefined) {
      return;
    }
    result.typeReferences.push(
      ...extractTypeReferences({
        typeNode: facts.typeNode,
        ownerLinkHash: row.getHash(),
        referenceOwnerKind: CsReferenceOwnerKind.METHOD_PARAMETER,
        context: CsTypeRefContext.LAMBDA_PARAMETER,
        serviceVersionLinkHash: options.serviceVersionLinkHash,
        typeParametersInScope: options.typeParametersInScope,
      })
    );
  });

  // The `body` FIELD, not "the first named child that is not a parameter list".
  //
  // A single-parameter lambda writes its parameter as a bare `identifier`, not
  // a `parameter_list` — so the positional guess picked the PARAMETER as the
  // body and every `a => <expr>` lost its expression entirely. That is 1,164 of
  // the corpus's 1,462 LINQ queries: 80% of them live in lambda bodies, and
  // almost all of those lambdas are single-parameter.
  const body = node.childForFieldName('body') ?? childOfType(node, 'block');
  if (body === null || body === undefined) {
    return;
  }

  // A lambda CAPTURES its enclosing scope, so the enclosing parameters are
  // still in scope inside it — dropping them would classify a captured
  // parameter as an unknown name.
  const names = new Set([...enclosingParameterNames, ...parameters.map((p) => p.name)]);
  const enclosingLocalFunctionNames =
    enclosing?.localFunctionNames ?? options.enclosingLocalFunctionNames;
  const context: CsExpressionContext = {
    csModuleLinkHash: options.csModuleLinkHash,
    csTypeLinkHash: options.csTypeLinkHash,
    ownerKind: CsExpressionOwnerKind.METHOD,
    ownerHash: method.getHash(),
    rootContext: CsRootContext.LAMBDA_BODY,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    callerMethodLinkHash: method.getHash(),
    // The ENCLOSING method's parameters. The lambda's own are separate, so
    // `x` in `xs.Select(x => x + 1)` is a LAMBDA_PARAMETER and not misfiled as
    // a parameter of whoever created the lambda.
    parameterNames: enclosingParameterNames,
    typeParameterNames: new Set(options.typeParametersInScope.keys()),
    typeParametersInScope: options.typeParametersInScope,
    methodNamesOnType: options.methodNamesOnType,
    eventNamesOnType: options.eventNamesOnType,
    valueMemberNamesOnType: options.valueMemberNamesOnType,
    fieldNamesOnType: options.fieldNamesOnType,
    propertyNamesOnType: options.propertyNamesOnType,
    localFunctionNames: enclosingLocalFunctionNames,
    lambdaParameterNames: new Set(parameters.map((p) => p.name)),
    patternBindingNames: patternBindingNamesIn(body, options.activeSymbols),
    queryRangeVariableNames: queryRangeVariableNamesIn(body, options.activeSymbols),
    usingAliasNames: options.usingAliasNames,
    awaitIsKeyword: method.isAsync,
    activeSymbols: options.activeSymbols,
  };

  if (body.type === 'block') {
    const boundaries = new Map<number, BoundaryScope>();
    let position = 0;
    const roots = collectExpressionRoots(body, options.activeSymbols, {
      enclosingLocals: enclosing?.localNames,
      enclosingLocalFunctions: enclosingLocalFunctionNames,
      boundaries,
    });
    for (const root of roots) {
      extractExpressionTree(
        root.node,
        { ...context, rootContext: root.rootContext, localFunctionNames: root.localFunctionNames },
        expressionResult,
        position,
        root.localNames
      );
      position += 1;
    }
    emitBlocks(body, method, options, result, expressionResult);
    // A local function declared INSIDE a lambda. The enclosing method's local
    // function walk skips lambdas — it has to, or it would attribute a
    // callback's declarations to whoever created it — so this is the only path
    // that reaches one, and without it the function and its whole body vanish.
    emitLocalFunctions(body, { ...options, enclosingLocalFunctionNames }, result, boundaries);
    for (const nested of collectLambdas(body, options.activeSymbols)) {
      emitLambda(nested, options, result, expressionResult, names, scopeAt(nested, boundaries, body));
    }
  } else {
    // By ruling (schema v1.3) the body of an EXPRESSION-BODIED lambda is a
    // child of the `LAMBDA` expression with `edgeRole = LAMBDA_BODY`, and it
    // stays owned by the lambda's own method so its calls belong to the
    // callback. The lambda row was emitted by the ENCLOSING walk, which shares
    // this result and recorded it by node id — one row, both links, and no
    // second copy to double the corpus with.
    const lambdaRow = expressionResult.rowByNodeId?.get(nodeId(node));
    extractExpressionTree(
      body,
      context,
      expressionResult,
      0,
      enclosing?.localNames ?? new Set(),
      lambdaRow === undefined ? undefined : { parent: lambdaRow, role: CsEdgeRole.LAMBDA_BODY }
    );
    // An expression-bodied lambda has no block and gets no block row — but it
    // can still DECLARE, and `xs.Where(s => int.TryParse(s, out var n))` binds
    // `n` with no statement anywhere in sight.
    emitBlocks(body, method, options, result, expressionResult);
    // A nested lambda inside an expression body sees exactly this one's scope.
    const here: BoundaryScope = {
      localNames: enclosing?.localNames ?? new Set(),
      localFunctionNames: enclosingLocalFunctionNames,
    };
    // Including a body that IS a lambda — `a => b => a + b`. `collectLambdas`
    // walks the children of the node it is handed, and a curried lambda's
    // inner function is the body itself, not under it.
    const nestedLambdas =
      body.type === 'lambda_expression' || body.type === 'anonymous_method_expression'
        ? [body]
        : collectLambdas(body, options.activeSymbols);
    for (const nested of nestedLambdas) {
      emitLambda(nested, options, result, expressionResult, names, here);
    }
  }
}

/**
 * The type references a callable's SIGNATURE contains.
 *
 * The return type is owned by the METHOD; each parameter's type is owned by the
 * PARAMETER, not by the method. That distinction is what lets a rule ask "which
 * types does this method accept" without also picking up what it returns, and
 * it is why `referenceOwnerKind` exists.
 */
function emitSignatureTypeReferences(
  node: Parser.SyntaxNode,
  csMethodLinkHash: string,
  parameters: readonly ParameterFacts[],
  parameterRows: readonly CsMethodParameterRegistry[],
  options: CsMemberExtractionOptions,
  result: CsMemberExtractionResult,
  ownTypeParameters: readonly CsTypeParameterRegistry[] = []
): void {
  // The METHOD's own parameters shadow the type's, which is legal and a
  // compiler warning rather than an error, so the method's win.
  const scope = new Map(options.typeParametersInScope);
  for (const parameter of ownTypeParameters) {
    scope.set(parameter.name, parameter.getHash());
  }
  const returns = throughTakenBranch(node.childForFieldName('returns') ?? node.childForFieldName('type'), options.activeSymbols);
  result.typeReferences.push(
    ...extractTypeReferences({
      typeNode: returns,
      ownerLinkHash: csMethodLinkHash,
      referenceOwnerKind: CsReferenceOwnerKind.METHOD,
      context: CsTypeRefContext.METHOD_RETURN,
      serviceVersionLinkHash: options.serviceVersionLinkHash,
      typeParametersInScope: scope,
    })
  );
  for (let i = 0; i < parameters.length; i += 1) {
    const row = parameterRows[i];
    const facts = parameters[i];
    if (row === undefined || facts === undefined || facts.typeNode === undefined) {
      continue;
    }
    result.typeReferences.push(
      ...extractTypeReferences({
        typeNode: facts.typeNode,
        ownerLinkHash: row.getHash(),
        referenceOwnerKind: CsReferenceOwnerKind.METHOD_PARAMETER,
        context: CsTypeRefContext.METHOD_PARAMETER,
        serviceVersionLinkHash: options.serviceVersionLinkHash,
        typeParametersInScope: scope,
      })
    );
  }
}

/**
 * `void Inner() { }` declared inside a method body.
 *
 * A real, named, callable declaration that a member walk never reaches, because
 * it is a STATEMENT and not a member. Missing it loses a call target entirely,
 * and local functions are the idiomatic replacement for private helpers in
 * modern C# — `static` local functions especially.
 *
 * Nested ones are emitted too: a local function inside a local function is
 * still a call target. Each is owned by the TYPE, not by the enclosing
 * callable, because `cs_method` has no method-owns-method column and inventing
 * one would be a schema change.
 *
 * The walk does NOT descend into lambdas. A local function declared inside a
 * lambda body belongs to that lambda, and lambdas are the expression layer's.
 */
function emitLocalFunctions(
  node: Parser.SyntaxNode,
  options: CsMemberExtractionOptions,
  result: CsMemberExtractionResult,
  /**
   * The scope table the body walk filled. Each local function is walked under
   * the scope recorded AT ITS DECLARATION — its own block's names, which
   * include itself and its siblings (recursion and mutual recursion are
   * LOCAL_FUNCTION_CALLs), and every enclosing block's — and not under "every
   * local function anywhere in the body".
   */
  boundaries: ReadonlyMap<number, BoundaryScope>
): void {
  const stack = activeNamedChildren(node, options.activeSymbols);
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (
      current.type === 'lambda_expression' ||
      current.type === 'anonymous_method_expression'
    ) {
      continue;
    }
    if (current.type === 'local_function_statement') {
      emitLocalFunction(
        current,
        options,
        result,
        boundaries.get(nodeId(current)) ?? {
          localNames: new Set(),
          localFunctionNames: options.enclosingLocalFunctionNames,
        }
      );
      // Its own body is walked by that call, so it is not enqueued again here —
      // a construct reached twice produces two rows with identical keys, and
      // duplicates DOUBLE.
      continue;
    }
    for (const child of activeNamedChildren(current, options.activeSymbols)) {
      stack.push(child);
    }
  }
}

function emitLocalFunction(
  node: Parser.SyntaxNode,
  enclosingOptions: CsMemberExtractionOptions,
  result: CsMemberExtractionResult,
  enclosing: BoundaryScope
): void {
  // The scope this local function sits in, carried into its own body walk. A
  // local function does NOT capture the enclosing locals declared after it —
  // but it does capture those declared before, and its own body walk starts
  // from that snapshot.
  const options: CsMemberExtractionOptions = {
    ...enclosingOptions,
    enclosingLocalFunctionNames: enclosing.localFunctionNames,
  };
  // A local function's header is never under a `#if`; `header` is the node,
  // named so the owner/attribute block below reads as it does in emitCallable.
  const header = node;
  const modifiers = readMethodModifiers(node, options.activeSymbols);
  const parameters = readParameters(childOfType(node, 'parameter_list'), options.activeSymbols);
  const name = normalizeCSharpIdentifier(node.childForFieldName('name')?.text ?? '');

  const method = new CsMethodRegistry({
    name,
    qualifiedName: `${options.typeQualifiedName}.${name}`,
    arity: typeParameterCount(node),
    signature: signatureOf(parameters),
    methodKind: CsMethodKind.LOCAL_FUNCTION,
    returnTypeName: node.childForFieldName('type')?.text ?? '',
    // A local function has NO accessibility: it is visible in its enclosing
    // block and nowhere else. `PRIVATE` would overstate its reach and `PUBLIC`
    // would badly understate the restriction, so NONE says what is true.
    methodAccess: CsTypeAccess.NONE,
    methodModifiers: modifiers,
    isStatic: modifiers.has(CsMethodModifier.STATIC),
    isAbstract: false,
    isVirtual: false,
    isOverride: false,
    isSealed: false,
    isAsync: modifiers.has(CsMethodModifier.ASYNC),
    isIterator: containsYield(node, options.activeSymbols),
    isExtension: false,
    isPartialDefinition: false,
    isPartialImplementation: false,
    explicitInterfaceName: '',
    operatorToken: '',
    conversionKind: CsConversionKind.NONE,
    csModuleLinkHash: options.csModuleLinkHash,
    csTypeLinkHash: options.csTypeLinkHash,
    isAccessor: false,
    ownerMemberLinkHash: '',
    ownerMemberKind: CsOwnerMemberKind.NONE,
    parameterCount: parameters.length,
    // The declaration starts where its first ATTRIBUTE or MODIFIER is, not at a
    // `#if` DIRECTIVE guarding them — a directive is trivia and belongs to no
    // declaration. See declarationSpanStartNode.
    startLine: startLine(declarationSpanStartNode(node, options.activeSymbols)),
    endLine: endLine(node),
    startColumn: startColumn(declarationSpanStartNode(node, options.activeSymbols)),
    bodyKind: bodyKindOf(node, options.activeSymbols),
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  });
  result.methods.push(method);
  // ATTRIBUTES, not bracket groups. The column existed with a setter nobody
  // called, so every method reported 0 — invisible until cs_attribute gave it
  // something to disagree with.
  method.setAttributeCount(countAttributes(header, options.activeSymbols));
  addDeclarationOwner(result.declarationOwners, nodeId(node), {
    hash: method.getHash(),
    kind: CsDeclarationOwnerKind.METHOD,
  });
  if (header.id !== node.id) {
    // The attribute walk finds a declaration's lists by the owner registered
    // on the node they hang from; under a `#if` they hang from the header.
    addDeclarationOwner(result.declarationOwners, nodeId(header), {
      hash: method.getHash(),
      kind: CsDeclarationOwnerKind.METHOD,
    });
  }
  const parameterRows = buildParameterRows(
    parameters,
    method.getHash(),
    options.serviceVersionLinkHash,
    result.declarationOwners,
    { options, result }
  );
  result.parameters.push(...parameterRows);
  const ownTypeParameters = extractTypeParameters({
    declarationNode: header,
    activeSymbols: options.activeSymbols,
    ownerLinkHash: method.getHash(),
    ownerKind: CsTypeParameterOwnerKind.METHOD,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
    typeReferenceSink: result.typeReferences,
    declarationOwnerSink: result.declarationOwners,
  });
  result.typeParameters.push(...ownTypeParameters);
  emitSignatureTypeReferences(
    node, method.getHash(), parameters, parameterRows, options, result, ownTypeParameters
  );
  // The BODY. Its absence here was a silent hole of exactly the shape §6
  // describes: the local function's own row was emitted, its parameters were
  // emitted, and every expression and every call INSIDE it was dropped —
  // because the enclosing method's walk stops at the function boundary and
  // nothing picked the body up on the other side. A tree rooted at a node that
  // emits nothing dies before its children are enqueued.
  const boundaries = emitBody(node, method, parameters, options, result, enclosing);
  emitLocalFunctions(node, options, result, boundaries);
}

/**
 * `class C(int a)` — a constructor declared on the TYPE.
 *
 * It is not in the member list, so a member walk alone finds none: cs-oracle
 * measured **0 primary constructors** in a .NET 8 reference app from exactly
 * this shape of miss, against 2,816 present in the corpus.
 *
 * A delegate's `parameter_list` is its SIGNATURE and is excluded — reporting it
 * as a constructor would tell the engine a delegate type is constructible with
 * those arguments.
 */
function emitPrimaryConstructor(
  options: CsMemberExtractionOptions,
  result: CsMemberExtractionResult
): void {
  const node = options.declarationNode;
  if (node.type === 'delegate_declaration') {
    return;
  }
  const parameterList = childOfType(node, 'parameter_list');
  if (parameterList === undefined) {
    return;
  }
  const parameters = readParameters(parameterList, options.activeSymbols);
  const method = new CsMethodRegistry({
    name: CSHARP_ANONYMOUS_METHOD_NAMES.PRIMARY_CONSTRUCTOR,
    qualifiedName: `${options.typeQualifiedName}.${CSHARP_ANONYMOUS_METHOD_NAMES.PRIMARY_CONSTRUCTOR}`,
    arity: 0,
    signature: signatureOf(parameters),
    methodKind: CsMethodKind.PRIMARY_CONSTRUCTOR,
    returnTypeName: '',
    methodAccess: CsTypeAccess.PUBLIC,
    methodModifiers: new Set(),
    isStatic: false,
    isAbstract: false,
    isVirtual: false,
    isOverride: false,
    isSealed: false,
    isAsync: false,
    isIterator: false,
    isExtension: false,
    isPartialDefinition: false,
    isPartialImplementation: false,
    explicitInterfaceName: '',
    operatorToken: '',
    conversionKind: CsConversionKind.NONE,
    csModuleLinkHash: options.csModuleLinkHash,
    csTypeLinkHash: options.csTypeLinkHash,
    isAccessor: false,
    ownerMemberLinkHash: '',
    ownerMemberKind: CsOwnerMemberKind.NONE,
    parameterCount: parameters.length,
    // The PARAMETER LIST's position, not the type's. Two rows keyed off the same
    // type must not also share a line and column, and the type declaration's
    // own position is already `cs_type`'s.
    startLine: startLine(parameterList),
    endLine: endLine(parameterList),
    startColumn: startColumn(parameterList),
    bodyKind: CsBodyKind.NONE,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  });
  result.methods.push(method);
  const parameterRows = buildParameterRows(
    parameters,
    method.getHash(),
    options.serviceVersionLinkHash,
    result.declarationOwners,
    { options, result }
  );
  result.parameters.push(...parameterRows);
  emitSignatureTypeReferences(node, method.getHash(), parameters, parameterRows, options, result);

  // `class D(int x) : B(x)` — the base ARGUMENT LIST is a call to the base
  // constructor, and it lives in the BASE LIST rather than in any body. The
  // heritage extractor reads the base TYPE from the same node and stops there,
  // so the arguments were emitted nowhere.
  //
  // Owned by the primary constructor, which is what runs them, and the
  // parameters ARE in scope: `B(x)` names this constructor's own parameter.
  //
  // The INVOCATION is the root, not each argument on its own: a positional
  // record wraps type and arguments in `primary_constructor_base_type`, and a
  // class leaves the `argument_list` as a bare sibling of the base type in
  // `base_list`. Either node is the base-constructor call, and it carries a
  // `cs_call_site` of kind BASE_CONSTRUCTOR_CALL naming the base type. The
  // arguments alone were emitted before — the parts, and not the edge.
  const baseList = activeChildOfType(node, 'base_list', options.activeSymbols);
  const invocation =
    baseList === undefined
      ? undefined
      : (childOfType(baseList, 'primary_constructor_base_type') ??
        childOfType(baseList, 'argument_list'));
  if (invocation !== undefined) {
    emitInitializerExpressions(
      {
        node: invocation,
        ownerKind: CsExpressionOwnerKind.TYPE,
        ownerHash: options.csTypeLinkHash,
        rootContext: CsRootContext.PRIMARY_CONSTRUCTOR_BASE,
        callerMethodLinkHash: method.getHash(),
        parameterNames: new Set(parameters.map((p) => p.name)),
      },
      options,
      result
    );
  }
}

function callableKind(
  node: Parser.SyntaxNode,
  modifiers: ReadonlySet<CsMethodModifier>,
  typeName: string
): CsMethodKind {
  switch (node.type) {
    case 'constructor_declaration':
      return modifiers.has(CsMethodModifier.STATIC)
        ? CsMethodKind.STATIC_CONSTRUCTOR
        : CsMethodKind.CONSTRUCTOR;
    case 'destructor_declaration':
      return CsMethodKind.DESTRUCTOR;
    case 'operator_declaration':
      return CsMethodKind.OPERATOR;
    case 'conversion_operator_declaration':
      return CsMethodKind.CONVERSION_OPERATOR;
    default:
      // A method whose name is the type's is NOT a constructor — the grammar
      // already distinguishes them — so no name-based guessing happens here.
      void typeName;
      return CsMethodKind.METHOD;
  }
}

function callableName(
  node: Parser.SyntaxNode,
  kind: CsMethodKind,
  typeName: string
): string {
  if (kind === CsMethodKind.STATIC_CONSTRUCTOR) {
    return CSHARP_ANONYMOUS_METHOD_NAMES.STATIC_CONSTRUCTOR;
  }
  if (kind === CsMethodKind.CONSTRUCTOR) {
    return CSHARP_ANONYMOUS_METHOD_NAMES.CONSTRUCTOR;
  }
  if (kind === CsMethodKind.DESTRUCTOR) {
    return CSHARP_ANONYMOUS_METHOD_NAMES.DESTRUCTOR;
  }
  if (kind === CsMethodKind.OPERATOR) {
    return `operator ${operatorTokenOf(node)}`;
  }
  if (kind === CsMethodKind.CONVERSION_OPERATOR) {
    // The TARGET TYPE is the only thing that distinguishes two conversion
    // operators on one type, and there is no identifier anywhere.
    const target = node.childForFieldName('type');
    return `operator ${target?.text ?? ''}`;
  }
  void typeName;
  return node.childForFieldName('name')?.text ?? '';
}

/**
 * The operator token, from the `operator` FIELD.
 *
 * A field read, and safe: `operator_declaration.operator` is declared as a field
 * in `node-types.json`, unlike `class_declaration.parameters`, which is the trap
 * the grammar-read gate exists for.
 */
function operatorTokenOf(node: Parser.SyntaxNode): string {
  if (node.type !== 'operator_declaration') {
    return '';
  }
  return node.childForFieldName('operator')?.text ?? '';
}

/**
 * `implicit` or `explicit`, from the anonymous keyword.
 *
 * The distinction is reachability: an implicit conversion runs with **no syntax
 * at the call site at all**, so an engine cannot find the edge by looking for a
 * cast. 582 conversion operators measured.
 */
function conversionKindOf(node: Parser.SyntaxNode): CsConversionKind {
  if (node.type !== 'conversion_operator_declaration') {
    return CsConversionKind.NONE;
  }
  for (const child of allChildren(node)) {
    if (child.isNamed) {
      continue;
    }
    if (child.type === 'implicit') {
      return CsConversionKind.IMPLICIT;
    }
    if (child.type === 'explicit') {
      return CsConversionKind.EXPLICIT;
    }
  }
  return CsConversionKind.NONE;
}

function returnTypeOf(node: Parser.SyntaxNode, kind: CsMethodKind, activeSymbols: ReadonlySet<string>): string {
  if (
    kind === CsMethodKind.CONSTRUCTOR ||
    kind === CsMethodKind.STATIC_CONSTRUCTOR ||
    kind === CsMethodKind.DESTRUCTOR
  ) {
    return '';
  }
  // `returns` on a method, `type` on an operator or conversion. Both are real
  // fields; the grammar-read gate declares them as such. Through a `#if`: the
  // taken branch's type, or '' when the field is a chain with no taken branch.
  const returns = throughTakenBranch(node.childForFieldName('returns') ?? node.childForFieldName('type'), activeSymbols);
  return returns?.text ?? '';
}

function typeParameterCount(node: Parser.SyntaxNode): number {
  const list = childOfType(node, 'type_parameter_list');
  if (list === undefined) {
    return 0;
  }
  return namedChildren(list).filter((c) => c.type === 'type_parameter').length;
}

/**
 * A callable's body — a block or an arrow clause — THROUGH a `#if`.
 *
 * `M()\n#if X\n => a;\n#else\n => b;\n#endif` is one header with a body per
 * target, and the fork's grammar puts the bodies under a `preproc_if` child
 * of the declaration. The body read is the branch this emission takes; the
 * other is not in the program and contributes nothing. Before the grammar
 * change this shape recovered as a property with an ERROR child and a method
 * named by the next keyword, and the parser withheld both as debris — a
 * wrong kind that had become a lost declaration.
 */
function functionBodyOf(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode | undefined {
  return (
    activeChildOfType(node, 'block', activeSymbols) ??
    activeChildOfType(node, 'arrow_expression_clause', activeSymbols)
  );
}

function bodyKindOf(node: Parser.SyntaxNode, activeSymbols: ReadonlySet<string>): CsBodyKind {
  const body = functionBodyOf(node, activeSymbols);
  if (body?.type === 'block') {
    return CsBodyKind.BLOCK;
  }
  if (body?.type === 'arrow_expression_clause') {
    return CsBodyKind.EXPRESSION;
  }
  // NONE is not "empty". An interface member, an `abstract`, an `extern` and a
  // `partial` definition all have no body and are all still call targets.
  return CsBodyKind.NONE;
}

/**
 * Whether the body contains `yield` — an ITERATOR.
 *
 * An iterator method's body does not run when it is called: it returns a state
 * machine, and the statements execute on `MoveNext`. An engine that treats the
 * call as executing the body gets the ordering wrong for every `yield return`.
 *
 * The scan stops at nested function boundaries, because a `yield` inside a local
 * function belongs to that function and makes IT the iterator, not the enclosing
 * method.
 */
function containsYield(node: Parser.SyntaxNode, activeSymbols: ReadonlySet<string>): boolean {
  const stack = activeNamedChildren(node, activeSymbols);
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.type === 'yield_statement') {
      return true;
    }
    if (
      current.type === 'local_function_statement' ||
      current.type === 'lambda_expression' ||
      current.type === 'anonymous_method_expression'
    ) {
      continue;
    }
    for (const child of activeNamedChildren(current, activeSymbols)) {
      stack.push(child);
    }
  }
  return false;
}

function explicitInterfaceNameOf(node: Parser.SyntaxNode | undefined): string {
  if (node === undefined) {
    return '';
  }
  // As WRITTEN. The parser does not resolve it; a `using` alias may be in play
  // and following it is the engine's job.
  return node.text.replace(/\.$/, '');
}

// ---------------------------------------------------------------------------
// parameters
// ---------------------------------------------------------------------------

interface ParameterFacts {
  name: string;
  mode: CsParameterMode;
  typeName: string;
  completeTypeName: string;
  isNullableAnnotated: boolean;
  hasDefaultValue: boolean;
  defaultValueText: string;
  isParams: boolean;
  isThis: boolean;
  scoped: CsScopedModifier;
  attributeCount: number;
  startLine: number;
  startColumn: number;
  /** Kept so the parameter's TYPE REFERENCE tree can be built from it. */
  typeNode: Parser.SyntaxNode | undefined;
  /** `= expr` on a parameter. An EXPRESSION, and possibly a call. */
  defaultValueNode: Parser.SyntaxNode | undefined;
  /**
   * The `parameter` node, or undefined for the flat trailing `params` form.
   *
   * `params int[] d` is NOT wrapped in a `parameter` node — the pieces are
   * loose children of the list — which is how the parameter was dropped
   * entirely once. There is no node to attribute an attribute to in that form,
   * and saying so is better than picking the nearest one.
   */
  node: Parser.SyntaxNode | undefined;
}

/**
 * Reads a parameter list, in BOTH shapes the grammar produces.
 *
 * ## `params` is not wrapped in a `parameter` node
 *
 * ```
 * void M(int a, params int[] d)
 *   parameter_list
 *     parameter    "int a"
 *     params       (anonymous)     <- flat
 *     array_type   "int[]"         <- flat
 *     identifier   "d"             <- flat
 * ```
 *
 * The grammar declares `name` and `type` as *multiple fields on the list itself*
 * for exactly this case. A scan for `parameter` children therefore **drops the
 * `params` parameter entirely** — and `params` is everywhere: `string.Format`,
 * every logging call, most `Assert` helpers.
 *
 * This is the second one-construct-two-shapes case on this branch, after
 * `primary_constructor_base_type`, and both were found by reading the grammar's
 * own `node-types.json` rather than by a count looking wrong.
 */
/**
 * `x => …` — a lambda's single untyped parameter, which the grammar exposes as
 * an `implicit_parameter` rather than a `parameter_list`. Its type is whatever
 * the delegate says, which is resolution; the NAME is the fact.
 */
function implicitParameter(node: Parser.SyntaxNode): ParameterFacts {
  return {
    name: normalizeCSharpIdentifier(node.text),
    mode: CsParameterMode.VALUE,
    typeName: '',
    completeTypeName: '',
    isNullableAnnotated: false,
    hasDefaultValue: false,
    defaultValueText: '',
    isParams: false,
    isThis: false,
    scoped: CsScopedModifier.NONE,
    attributeCount: 0,
    startLine: startLine(node),
    startColumn: startColumn(node),
    typeNode: undefined,
    defaultValueNode: undefined,
    node: undefined,
  };
}

/**
 * A parameter list's items, through fork rule 17: `M(\n#if NET\n
 * ReadOnlySpan<char> s,\n#else\n string s,\n#endif\n out T r)` puts each
 * branch's `T a,` run under a `parameter_fragment` inside a `preproc_if`
 * child of the list, and only the TAKEN branch's parameters are in the
 * program. Before the rule, both branches' parameters came out as siblings —
 * arity 3 for a method declared with 2 — and arity is identity.
 */
function parameterListItems(
  list: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  for (const child of allChildren(list)) {
    if (child.type !== PREPROC_CHAIN_ROOT) {
      out.push(child);
      continue;
    }
    const { branches, bodies } = resolvePreprocBranches(child, activeSymbols);
    for (const branch of branches) {
      if (!branch.isActive) {
        continue;
      }
      for (const body of bodies.get(branch.branchIndex) ?? []) {
        if (body.type === 'parameter_fragment') {
          out.push(...allChildren(body));
        }
      }
    }
  }
  return out;
}

function readParameters(
  list: Parser.SyntaxNode | undefined,
  activeSymbols: ReadonlySet<string>
): ParameterFacts[] {
  if (list === undefined) {
    return [];
  }
  const parameters: ParameterFacts[] = [];

  // The flat trailing `params` form, accumulated as its pieces are met.
  let pendingParams: { typeNode?: Parser.SyntaxNode; token?: Parser.SyntaxNode } | undefined;

  for (const child of parameterListItems(list, activeSymbols)) {
    if (child.type === 'parameter') {
      parameters.push(readParameter(child, activeSymbols));
      continue;
    }
    if (!child.isNamed && child.type === 'params') {
      pendingParams = { token: child };
      continue;
    }
    if (pendingParams === undefined) {
      continue;
    }
    if (child.isNamed && child.type !== 'identifier' && pendingParams.typeNode === undefined) {
      pendingParams.typeNode = child;
      continue;
    }
    if (child.isNamed && child.type === 'identifier') {
      const typeNode = pendingParams.typeNode;
      const anchor = pendingParams.token ?? child;
      parameters.push({
        name: child.text,
        mode: CsParameterMode.PARAMS,
        typeName: baseTypeName(typeNode?.text ?? ''),
        completeTypeName: typeNode?.text ?? '',
        isNullableAnnotated: hasNullableAnnotation(typeNode?.text ?? ''),
        hasDefaultValue: false,
        defaultValueText: '',
        isParams: true,
        isThis: false,
        scoped: CsScopedModifier.NONE,
        attributeCount: 0,
        startLine: startLine(anchor),
        startColumn: startColumn(anchor),
        typeNode,
        defaultValueNode: undefined,
        node: undefined,
      });
      pendingParams = undefined;
    }
  }

  return parameters;
}

/**
 * `scoped`, in BOTH shapes the grammar gives it.
 *
 * ```
 * scoped System.Span<int> f   ->  scoped_type "scoped System.Span<int>"   WRAPPER
 * scoped ref int g            ->  modifier "scoped", modifier "ref"       MODIFIER
 * ```
 *
 * The third one-construct-two-shapes case on this branch. Reading only the
 * modifier form left `scopedModifier = NONE` — losing a LIFETIME constraint, so
 * a `ref struct` would appear free to escape the call — and set
 * `completeTypeName` to `"scoped System.Span<int>"`, a type name with a keyword
 * glued to the front that no `using` scope will ever resolve.
 *
 * As with the other two, no row was missing. Only the columns were wrong.
 */
function unwrapScopedType(typeNode: Parser.SyntaxNode | null | undefined): {
  typeNode: Parser.SyntaxNode | undefined;
  isScoped: boolean;
} {
  if (typeNode?.type !== 'scoped_type') {
    return { typeNode: typeNode ?? undefined, isScoped: false };
  }
  const inner = typeNode.childForFieldName('type') ?? undefined;
  return { typeNode: inner ?? typeNode, isScoped: true };
}

function readParameter(node: Parser.SyntaxNode, activeSymbols: ReadonlySet<string>): ParameterFacts {
  const modifiers = childrenOfType(node, 'modifier').map((m) => m.text.trim());
  const declaredType = node.childForFieldName('type');
  const { typeNode, isScoped } = unwrapScopedType(declaredType);
  const nameNode = node.childForFieldName('name');
  // Compared by node ID, NEVER by object identity.
  //
  // `childForFieldName` and `namedChildren` hand back DIFFERENT JavaScript
  // objects for the same node: the binding's wrapper cache evicts, so `===`
  // between two references to one node is true sometimes and false other times.
  // It was true for `int e = 5` and false for `scoped Span<int> f`, which put
  // the parameter's own TYPE into `defaultValueText`. That is the failure mode
  // the never-key-state-on-a-node rule exists for — correct on ten files,
  // wrong on ten thousand, and silent either way.
  const excluded = new Set<number>();
  if (declaredType !== null) {
    excluded.add(declaredType.id);
  }
  if (nameNode !== null) {
    excluded.add(nameNode.id);
  }
  const defaultValue = namedChildren(node).find(
    (c) => !excluded.has(c.id) && c.type !== 'attribute_list' && c.type !== 'modifier'
  );

  const has = (modifier: string): boolean => modifiers.includes(modifier);
  const mode = has('this')
    ? CsParameterMode.THIS
    : has('ref') && has('readonly')
      ? CsParameterMode.REF_READONLY
      : has('out')
        ? CsParameterMode.OUT
        : has('ref')
          ? CsParameterMode.REF
          : has('in')
            ? CsParameterMode.IN
            : has('params')
              ? CsParameterMode.PARAMS
              : CsParameterMode.VALUE;

  const completeTypeName = typeNode?.text ?? '';
  return {
    name: normalizeCSharpIdentifier(nameNode?.text ?? ''),
    mode,
    typeName: baseTypeName(completeTypeName),
    completeTypeName,
    // The text, not the meaning. Whether `string?` MEANS anything depends on the
    // #nullable context, which is on the declaration's row, not here.
    isNullableAnnotated: hasNullableAnnotation(completeTypeName),
    hasDefaultValue: defaultValue !== undefined,
    defaultValueText: defaultValue?.text ?? '',
    isParams: has('params'),
    isThis: has('this'),
    scoped:
      has('scoped') || isScoped ? CsScopedModifier.SCOPED : CsScopedModifier.NONE,
    attributeCount: countAttributes(node, activeSymbols),
    startLine: startLine(node),
    startColumn: startColumn(node),
    typeNode,
    defaultValueNode: defaultValue,
    node,
  };
}

function signatureOf(parameters: readonly ParameterFacts[]): string {
  // Type names as WRITTEN, joined. Not a resolved signature and cannot be — its
  // only job is to give two overloads on one type different primary keys.
  return parameters.map((p) => `${p.mode === CsParameterMode.VALUE ? '' : p.mode.toLowerCase() + ' '}${p.completeTypeName}`).join(',');
}

function buildParameterRows(
  parameters: readonly ParameterFacts[],
  csMethodLinkHash: string,
  serviceVersionLinkHash: string,
  declarationOwners?: Map<number, DeclarationOwner[]>,
  defaults?: { options: CsMemberExtractionOptions; result: CsMemberExtractionResult }
): CsMethodParameterRegistry[] {
  const rows = parameters.map(
    (parameter, position) =>
      new CsMethodParameterRegistry({
        csMethodLinkHash,
        position,
        name: parameter.name,
        parameterMode: parameter.mode,
        typeName: parameter.typeName,
        completeTypeName: parameter.completeTypeName,
        isNullableAnnotated: parameter.isNullableAnnotated,
        hasDefaultValue: parameter.hasDefaultValue,
        defaultValueText: parameter.defaultValueText,
        isParams: parameter.isParams,
        isThis: parameter.isThis,
        scopedModifier: parameter.scoped,
        attributeCount: parameter.attributeCount,
        startLine: parameter.startLine,
        startColumn: parameter.startColumn,
        serviceVersionLinkHash,
      })
  );
  if (declarationOwners !== undefined) {
    parameters.forEach((parameter, position) => {
      if (parameter.node === undefined) {
        return;
      }
      addDeclarationOwner(declarationOwners, nodeId(parameter.node), {
        hash: rows[position]!.getHash(),
        kind: CsDeclarationOwnerKind.METHOD_PARAMETER,
      });
    });
  }
  // `void M(int x = Compute())` — a parameter default is an EXPRESSION and can
  // be a call. `defaultValueText` carried its spelling and nothing joined on
  // it; measured at zero rows across 5,773 linq-heavy-A files.
  if (defaults !== undefined) {
    parameters.forEach((parameter, position) => {
      emitInitializerExpressions(
        {
          node: parameter.defaultValueNode,
          ownerKind: CsExpressionOwnerKind.METHOD_PARAMETER,
          ownerHash: rows[position]!.getHash(),
          rootContext: CsRootContext.PARAMETER_DEFAULT,
        },
        defaults.options,
        defaults.result
      );
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// properties and indexers
// ---------------------------------------------------------------------------

function emitProperty(
  node: Parser.SyntaxNode,
  options: CsMemberExtractionOptions,
  result: CsMemberExtractionResult,
  /** The governing extension-block receiver, already read. */
  extensionReceiver?: ParameterFacts,
  /**
   * Whether the property is declared in an extension block AT ALL.
   *
   * Separate from the receiver, because `extension(string)` declares STATIC
   * extension members and gives them no receiver value: they are extension
   * members with nothing to put in parameter 0.
   */
  isExtensionMember: boolean = false
): void {
  const isIndexer = node.type === 'indexer_declaration';
  const modifiers = readMethodModifiers(node, options.activeSymbols);
  const typeNode = node.childForFieldName('type');
  const explicitInterface = childOfType(node, 'explicit_interface_specifier');
  // An indexer has no identifier — it is `this[...]`. `this[]` is the schema's
  // name for it, and it is stable across the several an owner may declare
  // because `startColumn` separates them.
  const name = isIndexer
    ? 'this[]'
    : normalizeCSharpIdentifier(node.childForFieldName('name')?.text ?? '');
  const completeTypeName = typeNode?.text ?? '';

  const accessors = readAccessors(node, options.activeSymbols);
  const getter = accessors.find((a) => a.keyword === 'get');
  const setter = accessors.find((a) => a.keyword === 'set' || a.keyword === 'init');

  const property = new CsPropertyRegistry({
    name,
    isIndexer,
    propertyTypeName: baseTypeName(completeTypeName),
    completeTypeName,
    isNullableAnnotated: hasNullableAnnotation(completeTypeName),
    propertyAccess:
      explicitInterface !== undefined
        ? CsTypeAccess.NONE
        : accessOf(modifiers, options.typeCategory),
    // Asymmetric accessibility, kept apart. 581 sites of `{ get; private set; }`,
    // and one column would have to be wrong about one of them.
    getAccessorAccess: getter?.access ?? '',
    setAccessorAccess: setter?.access ?? '',
    hasGetter: getter !== undefined,
    hasSetter: setter !== undefined,
    setterKind:
      setter === undefined
        ? CsSetterKind.NONE
        : setter.keyword === 'init'
          ? CsSetterKind.INIT
          : CsSetterKind.SET,
    // `required` is not in CsMethodModifier — it is unreachable in any column
    // that enum feeds — so it is read straight from the token here, into the
    // boolean the property row actually has.
    isRequired: modifiersOf(node, options.activeSymbols).some((m) => m.text.trim() === 'required'),
    isStatic: modifiers.has(CsMethodModifier.STATIC),
    isAbstract: modifiers.has(CsMethodModifier.ABSTRACT),
    isVirtual: modifiers.has(CsMethodModifier.VIRTUAL),
    isOverride: modifiers.has(CsMethodModifier.OVERRIDE),
    // THE NEW COLUMN. An extension property is not an ordinary property of the
    // static class that holds it, and until this column existed nothing said
    // so — the row was right in owner, name and span, and silent on the one
    // fact that makes it an extension member.
    isExtension: isExtensionMember,
    explicitInterfaceName: explicitInterfaceNameOf(explicitInterface),
    csTypeLinkHash: options.csTypeLinkHash,
    // The declaration starts where its first ATTRIBUTE or MODIFIER is, not at a
    // `#if` DIRECTIVE guarding them — a directive is trivia and belongs to no
    // declaration. See declarationSpanStartNode.
    startLine: startLine(declarationSpanStartNode(node, options.activeSymbols)),
    endLine: endLine(node),
    startColumn: startColumn(declarationSpanStartNode(node, options.activeSymbols)),
    attributeCount: countAttributes(node, options.activeSymbols),
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  });
  result.properties.push(property);
  addDeclarationOwner(result.declarationOwners, nodeId(node), {
    hash: property.getHash(),
    kind: CsDeclarationOwnerKind.PROPERTY,
  });
  // `public int P { get; set; } = Compute();` — the initializer follows the
  // ACCESSOR LIST as a direct expression child. NOT an `equals_value_clause`:
  // that wrapper is used for parameter defaults, and looking for it here found
  // nothing across 5,773 files — the same shape that dropped every local
  // initializer once. Distinct from the arrow body, which is the getter and
  // belongs to the getter's own method row.
  //
  // Through a `#if`: the fork's grammar parses `int X\n#if A\n { get; }\n#else\n
  // => 1;\n#endif` as a `preproc_if` holding a body per branch, and the
  // ACTIVE children are the ones this emission reads.
  const accessorList = activeChildOfType(node, 'accessor_list', options.activeSymbols);
  const propertyChildren = activeNamedChildren(node, options.activeSymbols);
  const accessorIndex =
    accessorList === undefined
      ? -1
      : propertyChildren.findIndex((child) => child.id === accessorList.id);
  const propertyInitializer = emitInitializerExpressions(
    {
      node: accessorIndex === -1 ? undefined : propertyChildren[accessorIndex + 1],
      ownerKind: CsExpressionOwnerKind.PROPERTY,
      ownerHash: property.getHash(),
      rootContext: CsRootContext.PROPERTY_INITIALIZER,
    },
    options,
    result
  );
  if (propertyInitializer !== '') {
    property.setInitializerExpressionLinkHash(propertyInitializer);
  }
  result.typeReferences.push(
    ...extractTypeReferences({
      typeNode,
      ownerLinkHash: property.getHash(),
      referenceOwnerKind: CsReferenceOwnerKind.PROPERTY,
      context: CsTypeRefContext.PROPERTY_TYPE,
      serviceVersionLinkHash: options.serviceVersionLinkHash,
      typeParametersInScope: options.typeParametersInScope,
    })
  );
  // An INDEXER's parameters are a `bracketed_parameter_list`, not a
  // `parameter_list`. Reading only the latter loses `this[int i]`'s parameter
  // entirely — and an indexer with no parameters is not an indexer.
  const indexerParameters = readParameters(
    childOfType(node, 'bracketed_parameter_list'),
    options.activeSymbols
  );
  const indexerRows = buildParameterRows(
    indexerParameters,
    property.getHash(),
    options.serviceVersionLinkHash,
    result.declarationOwners,
    { options, result }
  );
  result.parameters.push(...indexerRows);
  for (let i = 0; i < indexerParameters.length; i += 1) {
    const facts = indexerParameters[i];
    const row = indexerRows[i];
    if (facts?.typeNode === undefined || row === undefined) {
      continue;
    }
    result.typeReferences.push(
      ...extractTypeReferences({
        typeNode: facts.typeNode,
        ownerLinkHash: row.getHash(),
        referenceOwnerKind: CsReferenceOwnerKind.METHOD_PARAMETER,
        context: CsTypeRefContext.METHOD_PARAMETER,
        serviceVersionLinkHash: options.serviceVersionLinkHash,
        typeParametersInScope: options.typeParametersInScope,
      })
    );
  }

  // THE RECEIVER GOES ON THE ACCESSORS, not on the property.
  //
  // A property is not callable and has no parameter list; its ACCESSORS are
  // the methods the compiler emits, and each takes the receiver as parameter 0
  // — `get_IsBlank(string source)`. A `static` member of an extension block
  // takes none, exactly as a static extension method does not.
  const accessorReceiver = modifiers.has(CsMethodModifier.STATIC) ? undefined : extensionReceiver;
  for (const accessor of accessors) {
    const row = buildAccessorMethod({
      accessor,
      owner: property.getHash(),
      ownerKind: isIndexer ? CsOwnerMemberKind.INDEXER : CsOwnerMemberKind.PROPERTY,
      memberName: name,
      returnTypeName: accessor.keyword === 'get' ? completeTypeName : '',
      options,
      receiver: accessorReceiver,
    });
    if (row !== undefined) {
      result.methods.push(row);
      // The receiver's own parameter row, owned by the ACCESSOR that takes it.
      // Emitted here rather than in buildAccessorMethod because the row needs
      // the accessor's hash, which does not exist until the row is built.
      if (accessorReceiver !== undefined) {
        result.parameters.push(
          ...buildParameterRows(
            [accessorReceiver],
            row.getHash(),
            options.serviceVersionLinkHash,
            result.declarationOwners,
            { options, result }
          )
        );
      }
      // AN ACCESSOR OWNS ITS OWN ATTRIBUTES. Without this registration the
      // attribute extractor never visits the accessor node, so `[Intrinsic]
      // get => …` and `{ get; [param: NotNull] set; }` produced NO attribute
      // row at all — and `attributeCount` said 0, so nothing disagreed.
      if (accessor.node !== undefined) {
        addDeclarationOwner(result.declarationOwners, nodeId(accessor.node), {
          hash: row.getHash(),
          kind: CsDeclarationOwnerKind.METHOD,
        });
      }
      // AN ACCESSOR HAS A BODY, and it was never walked. A property getter is
      // ordinary code — it calls things — and 5,666 expression-bodied
      // properties plus 5,334 with blocks were measured. Every expression in
      // every one of them was missing, and no count of properties or methods
      // could see it because both rows were present.
      if (accessor.bodyNode !== undefined) {
        // An accessor body is ordinary code: its local functions get rows and
        // their bodies are walked, exactly as a method's are. Without this a
        // `Create()` declared in a getter was called as a LOCAL_FUNCTION_CALL
        // and declared nowhere.
        emitLocalFunctions(accessor.bodyNode, options, result, emitBody(accessor.bodyNode, row, [], options, result));
      }
    }
  }
}

interface AccessorFacts {
  keyword: 'get' | 'set' | 'init' | 'add' | 'remove';
  access: CsTypeAccess | '';
  bodyKind: CsBodyKind;
  isStatic: boolean;
  startLine: number;
  endLine: number;
  startColumn: number;
  /** True when there is no `get` keyword anywhere — an expression-bodied member. */
  isSynthesizedFromArrow: boolean;
  /** The accessor's body, so its expressions can be walked with IT as owner. */
  bodyNode: Parser.SyntaxNode | undefined;
  /**
   * The `accessor_declaration` itself, so its ATTRIBUTES can be read.
   *
   * Undefined for the arrow-bodied form, which synthesizes a getter from a
   * member that has no accessor node at all — there is nothing there to carry
   * an attribute list, and a count taken from the property would credit the
   * property's own attributes to the accessor.
   */
  node: Parser.SyntaxNode | undefined;
}

/**
 * The five accessor keywords, as the GRAMMAR spells them.
 *
 * Discriminating on the name node's TYPE rather than its text is what makes
 * preprocessor debris rejectable — see {@link readAccessors}.
 */
const ACCESSOR_KEYWORD_NODE_TYPES = new Set(['get', 'set', 'init', 'add', 'remove']);

/**
 * Every accessor a property, indexer or event declares.
 *
 * ## Three shapes, and the third is `#if`
 *
 * ```csharp
 * public int P { get; private set; }   // accessor_list, two accessor_declaration
 * public int Q => _x;                  // arrow_expression_clause, ZERO accessors
 * ```
 *
 * `Q` has a getter. It is a call target, it is 5,666 sites in the corpus, and
 * there is no `get` token anywhere to find. Emitting accessors only where the
 * keyword appears loses every one of them, and loses no row any count would
 * miss, because the property row is still there.
 *
 * ## `#if` inside an accessor list, which the grammar does not nest
 *
 * This is one of cs-oracle's 1.60% "`#if` splits a construct" cases, and it is
 * live in CommunityToolkit:
 *
 * ```csharp
 * public int Length
 * {
 * #if NET8_0_OR_GREATER
 *     get => this.length;
 * #elif NETSTANDARD2_1_OR_GREATER
 *     get => this.Span.Length;
 * #else
 *     get;
 * #endif
 * }
 * ```
 *
 * The grammar does NOT produce a `preproc_if` here. It absorbs the `#if` line
 * into the FIRST accessor as a `preproc_if_in_attribute_list` child, turns the
 * `#elif` into an accessor whose **name is the preprocessor symbol**, and emits
 * `#else` and `#endif` as bare `ERROR` siblings.
 *
 * Two consequences, and both were real:
 *
 * 1. `ACCESSOR_METHOD_KIND[keyword]` was an unguarded lookup, so the
 *    symbol-named accessor made it **throw** — two files of the corpus failed
 *    extraction entirely.
 * 2. Taking every `accessor_declaration` would emit THREE getters for one
 *    property: one per branch, from branches that never compile together. That
 *    breaks the accessor 1:1 gate and violates "no row from an inactive branch".
 *
 * So the chain is reconstructed from the debris: the condition is read off the
 * absorbed `preproc_if_in_attribute_list`, the `ERROR` siblings move the state
 * machine, and only the active branch's accessors are emitted. The `#elif`
 * branch's accessor is **unrecoverable** — its `get` keyword was consumed by the
 * error — so when that branch is the active one the accessor is genuinely lost,
 * and that is the irreducible part.
 */
function readAccessors(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): AccessorFacts[] {
  // Through a `#if` — the body under the branch this emission takes.
  const list = activeChildOfType(node, 'accessor_list', activeSymbols);
  if (list === undefined) {
    const arrow = activeChildOfType(node, 'arrow_expression_clause', activeSymbols);
    if (arrow === undefined) {
      return [];
    }
    return [
      {
        keyword: 'get',
        access: '',
        bodyKind: CsBodyKind.EXPRESSION,
        isStatic: false,
        startLine: startLine(arrow),
        endLine: endLine(arrow),
        startColumn: startColumn(arrow),
        isSynthesizedFromArrow: true,
        bodyNode: arrow,
        // No accessor node: the getter is synthesized from `=> expr` and has
        // no syntax of its own to carry an attribute list.
        node: undefined,
      },
    ];
  }

  const accessors: AccessorFacts[] = [];

  // The reconstructed `#if` chain. `inChain` is false for the overwhelming
  // majority of accessor lists, and everything below is then a no-op.
  let inChain = false;
  let branchActive = true;
  let branchTaken = false;

  for (const child of namedChildren(list)) {
    if (child.type === 'ERROR') {
      const text = child.text.trim();
      if (text.startsWith('#else')) {
        branchActive = !branchTaken;
        branchTaken = true;
        continue;
      }
      if (text.startsWith('#endif')) {
        inChain = false;
        branchActive = true;
        branchTaken = false;
        continue;
      }
      if (text.startsWith('#elif')) {
        const holds = evaluateAbsorbedCondition(child, activeSymbols);
        branchActive = !branchTaken && holds;
        branchTaken = branchTaken || holds;
        continue;
      }
      continue;
    }

    if (child.type !== 'accessor_declaration') {
      continue;
    }

    // A `#if` absorbed into this accessor OPENS a chain, and the accessor
    // itself is the first branch's body.
    const opener = childOfType(child, 'preproc_if_in_attribute_list');
    if (opener !== undefined) {
      inChain = true;
      const holds = evaluateAbsorbedCondition(opener, activeSymbols);
      branchActive = holds;
      branchTaken = holds;
    }

    const nameNode = child.childForFieldName('name');
    if (nameNode === null) {
      continue;
    }

    // Discriminate on the name node's TYPE, not its text. A real accessor's
    // name is one of five ANONYMOUS keyword tokens; an `identifier` here is a
    // `#elif` line the error recovery turned into an accessor named after the
    // preprocessor symbol. Matching on text would need a list of every symbol
    // anyone might define.
    if (!ACCESSOR_KEYWORD_NODE_TYPES.has(nameNode.type)) {
      if (inChain) {
        const holds = activeSymbols.has(nameNode.text);
        branchActive = !branchTaken && holds;
        branchTaken = branchTaken || holds;
      }
      continue;
    }

    if (inChain && !branchActive) {
      continue;
    }

    const modifiers = readMethodModifiers(child, activeSymbols);
    accessors.push({
      keyword: nameNode.type as AccessorFacts['keyword'],
      // `''` and not the member's own accessibility: an accessor with no
      // modifier INHERITS the member's, and copying it here would make
      // `{ get; private set; }` indistinguishable from a form that is not even
      // legal. Absent means "same as the member".
      access: modifiers.size === 0 ? '' : accessOf(modifiers, CsTypeCategory.CLASS),
      bodyKind: bodyKindOf(child, activeSymbols),
      isStatic: modifiers.has(CsMethodModifier.STATIC),
      startLine: startLine(child),
      endLine: endLine(child),
      startColumn: startColumn(child),
      isSynthesizedFromArrow: false,
      bodyNode: functionBodyOf(child, activeSymbols),
      node: child,
    });
  }

  return accessors;
}

/**
 * The condition of a `#if`/`#elif` the grammar absorbed into another node.
 *
 * Only the identifiers survive the absorption, so this evaluates the symbols
 * rather than the expression. That is exact for the single-symbol conditions
 * this shape actually occurs with, and conservative otherwise: a compound
 * condition is treated as holding when ALL its symbols are active, which cannot
 * activate a branch that a full evaluation would leave inactive.
 */
function evaluateAbsorbedCondition(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): boolean {
  const symbols: string[] = [];
  const stack = namedChildren(node);
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.type === 'identifier') {
      symbols.push(current.text);
    }
    for (const grandchild of namedChildren(current)) {
      stack.push(grandchild);
    }
  }
  if (symbols.length === 0) {
    return false;
  }
  return symbols.every((symbol) => activeSymbols.has(symbol));
}

const ACCESSOR_METHOD_KIND: Record<
  AccessorFacts['keyword'],
  { property: CsMethodKind; indexer: CsMethodKind; event: CsMethodKind }
> = {
  get: {
    property: CsMethodKind.PROPERTY_GET,
    indexer: CsMethodKind.INDEXER_GET,
    event: CsMethodKind.EVENT_ADD,
  },
  set: {
    property: CsMethodKind.PROPERTY_SET,
    indexer: CsMethodKind.INDEXER_SET,
    event: CsMethodKind.EVENT_REMOVE,
  },
  init: {
    property: CsMethodKind.PROPERTY_INIT,
    indexer: CsMethodKind.INDEXER_INIT,
    event: CsMethodKind.EVENT_ADD,
  },
  add: {
    property: CsMethodKind.EVENT_ADD,
    indexer: CsMethodKind.EVENT_ADD,
    event: CsMethodKind.EVENT_ADD,
  },
  remove: {
    property: CsMethodKind.EVENT_REMOVE,
    indexer: CsMethodKind.EVENT_REMOVE,
    event: CsMethodKind.EVENT_REMOVE,
  },
};

function buildAccessorMethod(input: {
  accessor: AccessorFacts;
  owner: string;
  ownerKind: CsOwnerMemberKind;
  memberName: string;
  returnTypeName: string;
  options: CsMemberExtractionOptions;
  /** The extension-block receiver this accessor takes as parameter 0, if any. */
  receiver?: ParameterFacts;
}): CsMethodRegistry | undefined {
  const { accessor, owner, ownerKind, memberName, options, receiver } = input;
  // GUARDED. This lookup was unguarded and it THREW on two corpus files: the
  // grammar's recovery for `#if` inside an accessor list produces an accessor
  // whose name is the preprocessor SYMBOL, and `ACCESSOR_METHOD_KIND[that]` is
  // undefined. `readAccessors` now rejects those before they reach here, so
  // this is belt and braces — but a whole file failing extraction because one
  // member had an unexpected shape is the wrong failure mode, and the next
  // grammar bump gets a free pass rather than an outage.
  const table = ACCESSOR_METHOD_KIND[accessor.keyword];
  if (table === undefined) {
    return undefined;
  }
  const kind =
    ownerKind === CsOwnerMemberKind.EVENT
      ? table.event
      : ownerKind === CsOwnerMemberKind.INDEXER
        ? table.indexer
        : table.property;

  const name = `${accessor.keyword}_${memberName}`;
  const row = new CsMethodRegistry({
    name,
    qualifiedName: `${options.typeQualifiedName}.${name}`,
    arity: 0,
    signature: receiver === undefined ? '' : signatureOf([receiver]),
    methodKind: kind,
    returnTypeName: input.returnTypeName,
    methodAccess: accessor.access === '' ? CsTypeAccess.NONE : accessor.access,
    methodModifiers: new Set(),
    isStatic: accessor.isStatic,
    isAbstract: false,
    isVirtual: false,
    isOverride: false,
    isSealed: false,
    isAsync: false,
    isIterator: false,
    // An extension property's accessor IS an extension method — the static
    // method the compiler emits with the receiver in parameter 0. Derived from
    // the receiver, exactly as emitCallable derives it from `isThis`, so the
    // flag and the parameter can never disagree.
    isExtension: receiver !== undefined,
    isPartialDefinition: false,
    isPartialImplementation: false,
    explicitInterfaceName: '',
    operatorToken: '',
    conversionKind: CsConversionKind.NONE,
    csModuleLinkHash: options.csModuleLinkHash,
    csTypeLinkHash: options.csTypeLinkHash,
    // Required and non-empty exactly when isAccessor is true. The gate asserts
    // both directions, because a null owner here makes the accessor a method
    // belonging to nothing.
    isAccessor: true,
    ownerMemberLinkHash: owner,
    ownerMemberKind: ownerKind,
    // The receiver is the accessor's only parameter row, so the count and the
    // rows agree by construction. `value` on a setter is NOT counted: it is
    // implied by the property's type and has never had a row.
    parameterCount: receiver === undefined ? 0 : 1,
    startLine: accessor.startLine,
    endLine: accessor.endLine,
    startColumn: accessor.startColumn,
    bodyKind: accessor.bodyKind,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  });
  // An accessor carries its OWN attributes — `[Intrinsic] get => …`,
  // `{ get; [param: NotNull] set; }`. Set AFTER construction, as every other
  // caller does, because attributeCount is not in the constructor's shape.
  // Zero on the arrow-synthesized getter, which has no accessor node to carry
  // one: counting the property's attributes there would credit them twice.
  row.setAttributeCount(accessor.node === undefined ? 0 : countAttributes(accessor.node, options.activeSymbols));
  return row;
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

function emitEventWithAccessors(
  node: Parser.SyntaxNode,
  options: CsMemberExtractionOptions,
  result: CsMemberExtractionResult
): void {
  const modifiers = readMethodModifiers(node, options.activeSymbols);
  const typeNode = node.childForFieldName('type');
  const completeTypeName = typeNode?.text ?? '';
  const explicitInterface = childOfType(node, 'explicit_interface_specifier');
  const name = normalizeCSharpIdentifier(node.childForFieldName('name')?.text ?? '');

  const event = new CsEventRegistry({
    name,
    eventTypeName: baseTypeName(completeTypeName),
    completeTypeName,
    eventKind: CsEventKind.WITH_ACCESSORS,
    eventAccess:
      explicitInterface !== undefined
        ? CsTypeAccess.NONE
        : accessOf(modifiers, options.typeCategory),
    isStatic: modifiers.has(CsMethodModifier.STATIC),
    isVirtual: modifiers.has(CsMethodModifier.VIRTUAL),
    isOverride: modifiers.has(CsMethodModifier.OVERRIDE),
    explicitInterfaceName: explicitInterfaceNameOf(explicitInterface),
    csTypeLinkHash: options.csTypeLinkHash,
    // The declaration starts where its first ATTRIBUTE or MODIFIER is, not at a
    // `#if` DIRECTIVE guarding them — a directive is trivia and belongs to no
    // declaration. See declarationSpanStartNode.
    startLine: startLine(declarationSpanStartNode(node, options.activeSymbols)),
    endLine: endLine(node),
    startColumn: startColumn(declarationSpanStartNode(node, options.activeSymbols)),
    attributeCount: countAttributes(node, options.activeSymbols),
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  });
  result.events.push(event);
  addDeclarationOwner(result.declarationOwners, nodeId(node), {
    hash: event.getHash(),
    kind: CsDeclarationOwnerKind.EVENT,
  });
  result.typeReferences.push(
    ...extractTypeReferences({
      typeNode,
      ownerLinkHash: event.getHash(),
      referenceOwnerKind: CsReferenceOwnerKind.EVENT,
      context: CsTypeRefContext.EVENT_TYPE,
      serviceVersionLinkHash: options.serviceVersionLinkHash,
      typeParametersInScope: options.typeParametersInScope,
    })
  );

  for (const accessor of readAccessors(node, options.activeSymbols)) {
    const row = buildAccessorMethod({
      accessor,
      owner: event.getHash(),
      ownerKind: CsOwnerMemberKind.EVENT,
      memberName: name,
      returnTypeName: '',
      options,
    });
    if (row !== undefined) {
      result.methods.push(row);
      // AN ACCESSOR OWNS ITS OWN ATTRIBUTES. Without this registration the
      // attribute extractor never visits the accessor node, so `[Intrinsic]
      // get => …` and `{ get; [param: NotNull] set; }` produced NO attribute
      // row at all — and `attributeCount` said 0, so nothing disagreed.
      if (accessor.node !== undefined) {
        addDeclarationOwner(result.declarationOwners, nodeId(accessor.node), {
          hash: row.getHash(),
          kind: CsDeclarationOwnerKind.METHOD,
        });
      }
      if (accessor.bodyNode !== undefined) {
        // An accessor body is ordinary code: its local functions get rows and
        // their bodies are walked, exactly as a method's are. Without this a
        // `Create()` declared in a getter was called as a LOCAL_FUNCTION_CALL
        // and declared nowhere.
        emitLocalFunctions(accessor.bodyNode, options, result, emitBody(accessor.bodyNode, row, [], options, result));
      }
    }
  }
}

/**
 * `public event EventHandler A, B;` — 130 measured, and N events per statement.
 *
 * The declarators are the events. Emitting one row per STATEMENT would merge two
 * distinct subscription targets into one, and `startColumn` is what keeps their
 * keys apart on a shared line.
 *
 * Its `add`/`remove` accessors are **synthesized by the compiler and appear in
 * no source**, so no `cs_method` row is emitted for them: a row pointing at a
 * declaration that does not exist is worse than a recorded absence, and
 * `eventKind = FIELD_LIKE` is that record.
 */
function emitFieldLikeEvents(
  node: Parser.SyntaxNode,
  options: CsMemberExtractionOptions,
  result: CsMemberExtractionResult
): void {
  const modifiers = readMethodModifiers(node, options.activeSymbols);
  const declaration = childOfType(node, 'variable_declaration');
  if (declaration === undefined) {
    return;
  }
  const typeNode = declaration.childForFieldName('type');
  const completeTypeName = typeNode?.text ?? '';

  for (const declarator of childrenOfType(declaration, 'variable_declarator')) {
    const eventRow = new CsEventRegistry({
        name: normalizeCSharpIdentifier(declarator.childForFieldName('name')?.text ?? ''),
        eventTypeName: baseTypeName(completeTypeName),
        completeTypeName,
        eventKind: CsEventKind.FIELD_LIKE,
        eventAccess: accessOf(modifiers, options.typeCategory),
        isStatic: modifiers.has(CsMethodModifier.STATIC),
        isVirtual: modifiers.has(CsMethodModifier.VIRTUAL),
        isOverride: modifiers.has(CsMethodModifier.OVERRIDE),
        explicitInterfaceName: '',
        csTypeLinkHash: options.csTypeLinkHash,
        startLine: startLine(declarator),
        endLine: endLine(declarator),
        startColumn: startColumn(declarator),
        attributeCount: countAttributes(node, options.activeSymbols),
        serviceVersionLinkHash: options.serviceVersionLinkHash,
    });
    result.events.push(eventRow);
    addDeclarationOwner(result.declarationOwners, nodeId(declarator), {
      hash: eventRow.getHash(),
      kind: CsDeclarationOwnerKind.EVENT,
    });
    addDeclarationOwner(result.declarationOwners, nodeId(node), {
      hash: eventRow.getHash(),
      kind: CsDeclarationOwnerKind.EVENT,
    });
    emitInitializerExpressions(
      {
        node: namedChildren(declarator).find(
          (child) => child.id !== declarator.childForFieldName('name')?.id
        ),
        ownerKind: CsExpressionOwnerKind.EVENT,
        ownerHash: eventRow.getHash(),
        rootContext: CsRootContext.FIELD_INITIALIZER,
      },
      options,
      result
    );
    result.typeReferences.push(
      ...extractTypeReferences({
        typeNode,
        ownerLinkHash: eventRow.getHash(),
        referenceOwnerKind: CsReferenceOwnerKind.EVENT,
        context: CsTypeRefContext.EVENT_TYPE,
        serviceVersionLinkHash: options.serviceVersionLinkHash,
        typeParametersInScope: options.typeParametersInScope,
      })
    );
  }
}

// ---------------------------------------------------------------------------
// fields
// ---------------------------------------------------------------------------

const FIELD_MODIFIER_BY_TOKEN: ReadonlyMap<string, CsFieldModifier> = new Map([
  ['public', CsFieldModifier.PUBLIC],
  ['private', CsFieldModifier.PRIVATE],
  ['protected', CsFieldModifier.PROTECTED],
  ['internal', CsFieldModifier.INTERNAL],
  ['static', CsFieldModifier.STATIC],
  ['readonly', CsFieldModifier.READONLY],
  ['const', CsFieldModifier.CONST],
  ['volatile', CsFieldModifier.VOLATILE],
  ['required', CsFieldModifier.REQUIRED],
  ['fixed', CsFieldModifier.FIXED],
  ['unsafe', CsFieldModifier.UNSAFE],
  ['new', CsFieldModifier.NEW],
]);

/**
 * `int a, b;` — ONE declaration, N fields.
 *
 * The declarators are the fields. They share a type, a modifier set, a line and
 * an owner, so `declarationIndex` is the only thing that separates their keys —
 * without it the two rows key identically and one is lost. That is the inverse
 * of the doubling problem and just as silent: a field that exists in the program
 * and not in the fact base.
 */
function emitFields(
  node: Parser.SyntaxNode,
  options: CsMemberExtractionOptions,
  result: CsMemberExtractionResult
): void {
  const declaration = childOfType(node, 'variable_declaration');
  if (declaration === undefined) {
    return;
  }
  const modifiers = readFieldModifiers(node, options.activeSymbols);
  const declaredType = declaration.childForFieldName('type');
  const completeTypeName = declaredType?.text ?? '';
  const attributeCount = countAttributes(node, options.activeSymbols);

  let declarationIndex = 0;
  for (const declarator of childrenOfType(declaration, 'variable_declarator')) {
    const nameNode = declarator.childForFieldName('name');
    const field = new CsFieldRegistry({
      name: normalizeCSharpIdentifier(nameNode?.text ?? ''),
      fieldTypeName: baseTypeName(completeTypeName),
      completeTypeName,
      // Filled only where SYNTAX gives it: a dotted type name is already
      // qualified. A bare name's qualified form depends on which `using`
      // supplies it, which is resolution and the engine's.
      potentialQualifiedName: completeTypeName.includes('.')
        ? baseTypeName(completeTypeName)
        : '',
      // A documented PARITY SLOT, always false. Deciding that a bare name is
      // ambiguous requires knowing which namespaces actually contain a type of
      // that name, which is resolution. TypeScript's is always false for the
      // same reason.
      isAmbiguous: false,
      fieldAccess: fieldAccessOf(modifiers, options.typeCategory),
      fieldModifiers: modifiers,
      isStatic:
        modifiers.has(CsFieldModifier.STATIC) || modifiers.has(CsFieldModifier.CONST),
      isReadOnly: modifiers.has(CsFieldModifier.READONLY),
      isConst: modifiers.has(CsFieldModifier.CONST),
      isVolatile: modifiers.has(CsFieldModifier.VOLATILE),
      isRequired: modifiers.has(CsFieldModifier.REQUIRED),
      isFixedSizeBuffer: modifiers.has(CsFieldModifier.FIXED),
      isNullableAnnotated: hasNullableAnnotation(completeTypeName),
      memberKind: CsFieldMemberKind.FIELD,
      csTypeLinkHash: options.csTypeLinkHash,
      csModuleLinkHash: options.csModuleLinkHash,
      declarationIndex,
      attributeCount,
      startLine: startLine(declarator),
      endLine: endLine(declarator),
      startColumn: startColumn(declarator),
      serviceVersionLinkHash: options.serviceVersionLinkHash,
    });
    result.fields.push(field);
    addDeclarationOwner(result.declarationOwners, nodeId(declarator), {
      hash: field.getHash(),
      kind: CsDeclarationOwnerKind.FIELD,
    });
    // AND the declaration node, because the ATTRIBUTE LIST hangs off that, not
    // off the declarator. Registering only the declarator produced a field row
    // with no attribute row: the list sat on a node nothing owned, and the
    // attribute vanished. `[Obsolete] int a, b;` marks BOTH symbols, which is
    // why the table holds a list — each field gets its own attribute row with
    // its own owner hash and therefore its own key.
    addDeclarationOwner(result.declarationOwners, nodeId(node), {
      hash: field.getHash(),
      kind: CsDeclarationOwnerKind.FIELD,
    });
    // The INITIALIZER, owned by the field. Direct child of the declarator, not
    // wrapped in an `equals_value_clause` — that form is for parameter
    // defaults, and looking for the wrapper is what dropped every LOCAL
    // initializer once already.
    const fieldInitializer = emitInitializerExpressions(
      {
        node: namedChildren(declarator).find(
          (child) =>
            (nameNode === null || child.id !== nameNode.id) &&
            child.type !== 'bracketed_argument_list'
        ),
        ownerKind: CsExpressionOwnerKind.FIELD,
        ownerHash: field.getHash(),
        rootContext: CsRootContext.FIELD_INITIALIZER,
      },
      options,
      result
    );
    if (fieldInitializer !== '') {
      field.setInitializerExpressionLinkHash(fieldInitializer);
    }

    // ONE type reference tree per declaration, owned by the FIRST declarator.
    // `int a, b;` has one written type; emitting it twice would double the
    // reference count for a type that appears once.
    if (declarationIndex === 0) {
      const references = extractTypeReferences({
        typeNode: declaredType,
        ownerLinkHash: field.getHash(),
        referenceOwnerKind: CsReferenceOwnerKind.FIELD,
        context: CsTypeRefContext.FIELD_TYPE,
        serviceVersionLinkHash: options.serviceVersionLinkHash,
        typeParametersInScope: options.typeParametersInScope,
      });
      const root = references[0];
      if (root !== undefined) {
        field.setTypeReferenceLinkHash(root.getHash());
      }
      result.typeReferences.push(...references);
    }
    declarationIndex += 1;
  }
}

function readFieldModifiers(node: Parser.SyntaxNode, activeSymbols: ReadonlySet<string>): Set<CsFieldModifier> {
  const found = new Set<CsFieldModifier>();
  for (const child of modifiersOf(node, activeSymbols)) {
    const modifier = FIELD_MODIFIER_BY_TOKEN.get(child.text.trim());
    if (modifier !== undefined) {
      found.add(modifier);
    }
  }
  return found;
}

function fieldAccessOf(
  modifiers: ReadonlySet<CsFieldModifier>,
  ownerCategory: CsTypeCategory
): CsTypeAccess {
  const hasProtected = modifiers.has(CsFieldModifier.PROTECTED);
  const hasInternal = modifiers.has(CsFieldModifier.INTERNAL);
  const hasPrivate = modifiers.has(CsFieldModifier.PRIVATE);
  if (hasProtected && hasInternal) {
    return CsTypeAccess.PROTECTED_INTERNAL;
  }
  if (hasProtected && hasPrivate) {
    return CsTypeAccess.PRIVATE_PROTECTED;
  }
  if (modifiers.has(CsFieldModifier.PUBLIC)) {
    return CsTypeAccess.PUBLIC;
  }
  if (hasProtected) {
    return CsTypeAccess.PROTECTED;
  }
  if (hasInternal) {
    return CsTypeAccess.INTERNAL;
  }
  if (hasPrivate) {
    return CsTypeAccess.PRIVATE;
  }
  // An interface field must be `const` or `static`, and is public either way.
  return ownerCategory === CsTypeCategory.INTERFACE
    ? CsTypeAccess.PUBLIC
    : CsTypeAccess.PRIVATE;
}

// ---------------------------------------------------------------------------
// enum members
// ---------------------------------------------------------------------------

/**
 * Enum members live in an `enum_member_declaration_list`, not a
 * `declaration_list`, so the member walk never reaches them.
 *
 * `constantValue` is filled ONLY for a literal. `C = A | B` has a value and
 * folding it is evaluation, not parsing — a parser that did it would be doing
 * the compiler's arithmetic and would be wrong the first time an initializer
 * named a constant from another file.
 */
function emitEnumMembers(
  options: CsMemberExtractionOptions,
  result: CsMemberExtractionResult
): void {
  const list = childOfType(options.declarationNode, 'enum_member_declaration_list');
  if (list === undefined) {
    return;
  }
  let ordinal = 0;
  for (const member of memberNodesOf(list, options.activeSymbols, 'enum_member_declaration')) {
    const nameNode = childOfType(member, 'identifier');
    const initializer = namedChildren(member).find(
      (child) =>
        child.type !== 'identifier' && child.type !== 'attribute_list'
    );
    const isLiteral =
      initializer !== undefined && initializer.type.endsWith('_literal');

    const enumMember = new CsEnumMemberRegistry({
        name: normalizeCSharpIdentifier(nameNode?.text ?? ''),
        qualifiedName:
          `${options.typeQualifiedName}.` +
          normalizeCSharpIdentifier(nameNode?.text ?? ''),
        ordinal,
        hasInitializer: initializer !== undefined,
        initializerText: initializer?.text ?? '',
        // A LITERAL only. Anything else is the engine's to evaluate.
        constantValue: isLiteral ? initializer.text : '',
        valueKind:
          initializer === undefined
            ? CsEnumValueKind.IMPLICIT
            : isLiteral
              ? CsEnumValueKind.LITERAL
              : CsEnumValueKind.COMPUTED,
        csTypeLinkHash: options.csTypeLinkHash,
        csModuleLinkHash: options.csModuleLinkHash,
        ownerTypeName: options.typeName,
        attributeCount: countAttributes(member, options.activeSymbols),
        startLine: startLine(member),
        endLine: endLine(member),
        startColumn: startColumn(member),
        serviceVersionLinkHash: options.serviceVersionLinkHash,
    });
    result.enumMembers.push(enumMember);
    addDeclarationOwner(result.declarationOwners, nodeId(member), {
      hash: enumMember.getHash(),
      kind: CsDeclarationOwnerKind.ENUM_MEMBER,
    });
    const valueRoot = emitInitializerExpressions(
      {
        node: initializer,
        ownerKind: CsExpressionOwnerKind.ENUM_MEMBER,
        ownerHash: enumMember.getHash(),
        rootContext: CsRootContext.ENUM_MEMBER_VALUE,
      },
      options,
      result
    );
    // The schema: "a COMPUTED member carries csExpressionLinkHash". The setter
    // existed and nothing called it — the fifth declared-and-never-written
    // link, found by the sweep that counted populated values per column.
    if (valueRoot !== '') {
      enumMember.setExpressionLinkHash(valueRoot);
    }
    ordinal += 1;
  }
}

/** The `#if`-resolved children of a list, filtered to one node type. */
function memberNodesOf(
  list: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>,
  nodeType: string
): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  const queue = namedChildren(list);
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.type === PREPROC_CHAIN_ROOT) {
      const { branches, bodies } = resolvePreprocBranches(node, activeSymbols);
      const expanded: Parser.SyntaxNode[] = [];
      for (const branch of branches) {
        if (branch.isActive) {
          expanded.push(...(bodies.get(branch.branchIndex) ?? []));
        }
      }
      queue.unshift(...expanded);
      continue;
    }
    if (node.type === nodeType) {
      out.push(node);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// modifiers and accessibility
// ---------------------------------------------------------------------------

const METHOD_MODIFIER_BY_TOKEN: ReadonlyMap<string, CsMethodModifier> = new Map([
  ['public', CsMethodModifier.PUBLIC],
  ['private', CsMethodModifier.PRIVATE],
  ['protected', CsMethodModifier.PROTECTED],
  ['internal', CsMethodModifier.INTERNAL],
  ['static', CsMethodModifier.STATIC],
  ['abstract', CsMethodModifier.ABSTRACT],
  ['virtual', CsMethodModifier.VIRTUAL],
  ['override', CsMethodModifier.OVERRIDE],
  ['sealed', CsMethodModifier.SEALED],
  ['async', CsMethodModifier.ASYNC],
  ['partial', CsMethodModifier.PARTIAL],
  ['extern', CsMethodModifier.EXTERN],
  ['unsafe', CsMethodModifier.UNSAFE],
  ['new', CsMethodModifier.NEW],
  ['readonly', CsMethodModifier.READONLY],
  ['ref', CsMethodModifier.REF],
]);

function readMethodModifiers(node: Parser.SyntaxNode, activeSymbols: ReadonlySet<string>): Set<CsMethodModifier> {
  const found = new Set<CsMethodModifier>();
  for (const child of modifiersOf(node, activeSymbols)) {
    const modifier = METHOD_MODIFIER_BY_TOKEN.get(child.text.trim());
    if (modifier !== undefined) {
      found.add(modifier);
    }
  }
  // A REF RETURN — `ref int M() => ref _f` — puts `ref` in the RETURN TYPE as a
  // `ref_type` node, not in the modifier list. It is a dataflow fact and not a
  // spelling: the method hands back an ALIAS, so `M() = 5` writes through to the
  // callee's storage. A modifier-only scan reads it as an ordinary `int` return
  // and the write disappears.
  const returns = throughTakenBranch(node.childForFieldName('returns') ?? node.childForFieldName('type'), activeSymbols);
  if (returns?.type === 'ref_type') {
    found.add(CsMethodModifier.REF);
  }
  return found;
}

/**
 * Declared accessibility, with C#'s POSITIONAL default applied.
 *
 * The default is not global: a member of a class or struct defaults to
 * `private`, and a member of an **interface** defaults to `public`. Getting that
 * backwards would report every interface member as unreachable from outside its
 * own type, which is the opposite of true — an engine filtering on
 * accessibility would discard almost every interface member.
 */
function accessOf(
  modifiers: ReadonlySet<CsMethodModifier>,
  ownerCategory: CsTypeCategory
): CsTypeAccess {
  const hasProtected = modifiers.has(CsMethodModifier.PROTECTED);
  const hasInternal = modifiers.has(CsMethodModifier.INTERNAL);
  const hasPrivate = modifiers.has(CsMethodModifier.PRIVATE);

  if (hasProtected && hasInternal) {
    return CsTypeAccess.PROTECTED_INTERNAL;
  }
  if (hasProtected && hasPrivate) {
    return CsTypeAccess.PRIVATE_PROTECTED;
  }
  if (modifiers.has(CsMethodModifier.PUBLIC)) {
    return CsTypeAccess.PUBLIC;
  }
  if (hasProtected) {
    return CsTypeAccess.PROTECTED;
  }
  if (hasInternal) {
    return CsTypeAccess.INTERNAL;
  }
  if (hasPrivate) {
    return CsTypeAccess.PRIVATE;
  }
  return ownerCategory === CsTypeCategory.INTERFACE
    ? CsTypeAccess.PUBLIC
    : CsTypeAccess.PRIVATE;
}

/** Re-exported so the gate can assert `isAccessor` and `methodKind` agree. */
export { CS_ACCESSOR_METHOD_KINDS };
