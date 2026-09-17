import Parser from 'tree-sitter';

import { CsAttributeArgumentRegistry } from '@/analysis-types/csharp/CsAttributeArgumentRegistry';
import { CsAttributeRegistry } from '@/analysis-types/csharp/CsAttributeRegistry';
import { CsCallSiteRegistry } from '@/analysis-types/csharp/CsCallSiteRegistry';
import { CsExpressionRegistry } from '@/analysis-types/csharp/CsExpressionRegistry';
import { CsTypeReferenceRegistry } from '@/analysis-types/csharp/CsTypeReferenceRegistry';
import {
  CsAttributeArgumentValueKind,
  CsAttributeTarget,
} from '@/enums/csharp/attributes';
import { CsExpressionOwnerKind, CsRootContext } from '@/enums/csharp/expressions';
import { CsDeclarationOwnerKind } from '@/enums/csharp/owners';
import { CsReferenceOwnerKind, CsTypeRefContext } from '@/enums/csharp/type-references';
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
import {
  CsExpressionResult,
  extractExpressionTree,
} from '@/parsers/csharp/extractors/cs-expression-extractor';
import {
  resolvePreprocBranches,
} from '@/parsers/csharp/extractors/preproc-context';
import { extractTypeReferences } from '@/parsers/csharp/extractors/cs-type-reference-extractor';
import { normalizeCSharpIdentifier, simpleNameOf } from '@/utils/csharp';

/**
 * `cs_attribute` and `cs_attribute_argument`.
 *
 * ## Inert metadata — which is exactly why the ARGUMENTS carry the edges
 *
 * A C# attribute does nothing until something reflects on it, so unlike a
 * TypeScript decorator there is no execution and no order to record. What
 * survives is a name and a payload, and the payload is where the interesting
 * facts are: `[JsonConverter(typeof(MyConverter))]` names a type that a
 * framework instantiates from a stack no source file contains. Drop the
 * argument and that edge exists nowhere in the fact base.
 *
 * ## `[A, B]` is TWO attributes, and counting lists said one
 *
 * The count that shipped before this relation existed was
 * `childrenOfType(node, 'attribute_list').length` — the number of bracket
 * groups. `[A][B]` and `[A, B]` are the same two attributes written two ways
 * and produced 2 and 1. Nothing could see it, because there was no relation to
 * disagree with. There is now, and the gate asserts the two AGREE.
 */

/**
 * A declaration node's identity, so a later pass can attach an attribute or a
 * comment to it without re-deriving a key.
 *
 * Keyed on `node.id` in a SIDE TABLE, never written onto the node: the wrapper
 * cache evicts, so a property set in one traversal is gone by the next.
 */
export interface DeclarationOwner {
  readonly hash: string;
  readonly kind: CsDeclarationOwnerKind;
}

/**
 * ONE node, N owners.
 *
 * `[Obsolete] int a, b;` is one `field_declaration` carrying one attribute
 * list, and TWO field symbols — Roslyn marks both. So the attribute is emitted
 * once per owner, with different owner hashes and therefore different keys: no
 * doubling, and no field silently losing its attribute either.
 */
export type DeclarationOwners = ReadonlyMap<number, readonly DeclarationOwner[]>;

/** Adds an owner without discarding one already recorded for the same node. */
export function addDeclarationOwner(
  table: Map<number, DeclarationOwner[]>,
  id: number,
  owner: DeclarationOwner
): void {
  const existing = table.get(id);
  if (existing === undefined) {
    table.set(id, [owner]);
    return;
  }
  existing.push(owner);
}

export interface CsAttributeExtractionInput {
  /**
   * The node whose `attribute_list` children are read — a declaration, a
   * parameter, a type parameter, or a `global_attribute`.
   */
  readonly declarationNode: Parser.SyntaxNode;
  readonly ownerHash: string;
  readonly ownerKind: CsDeclarationOwnerKind;
  readonly csTypeLinkHash: string;
  readonly csModuleLinkHash: string;
  readonly serviceVersionLinkHash: string;
  readonly typeParametersInScope?: ReadonlyMap<string, string>;
  /** Decides which `#if` branch inside an attribute position is taken. */
  readonly activeSymbols: ReadonlySet<string>;
}

export interface CsAttributeExtractionResult {
  readonly attributes: CsAttributeRegistry[];
  readonly attributeArguments: CsAttributeArgumentRegistry[];
  readonly typeReferences: CsTypeReferenceRegistry[];
  /**
   * The ARGUMENT VALUES as expression trees, owned by the attribute.
   *
   * `argumentValue` carried the text and `valueKind` the bucket, and no row
   * existed for the expression itself — so `[Route("/" + Prefix)]` named a
   * constant nothing joined on and `[Obsolete(nameof(Old))]` named a symbol
   * nothing could see. C# attributes are INERT and none of this runs, which is
   * why it was last; it is still a reference, and a rename that misses it
   * breaks the program.
   */
  readonly expressions: CsExpressionRegistry[];
  readonly callSites: CsCallSiteRegistry[];
}

/**
 * The attribute lists a declaration carries, INCLUDING the ones a `#if`
 * selects.
 *
 * `[Conditional("DEBUG")]` written inside a `#if NET8_0` is wrapped in a
 * `preproc_if_in_attribute_list`, so it is not a direct `attribute_list` child
 * and a direct-children scan finds nothing. Measured on multitarget-A: 10 of 1,074
 * attributes, invisible because every OTHER attribute on the same declarations
 * was present.
 *
 * The `activeSymbols` set decides which branch is taken, for the same reason it
 * decides which members exist: an attribute in an inactive branch is not in the
 * program, and `[Obsolete]` in a branch this build does not take does not mark
 * anything.
 */
function attributeListsOf(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode[] {
  const lists: Parser.SyntaxNode[] = [];
  for (const child of namedChildren(node)) {
    if (child.type === 'attribute_list') {
      lists.push(child);
      continue;
    }
    if (child.type !== PREPROC_ATTRIBUTE_CHAIN_ROOT) {
      continue;
    }
    const { branches, bodies } = resolvePreprocBranches(child, activeSymbols);
    for (const branch of branches) {
      if (!branch.isActive) {
        continue;
      }
      for (const inner of bodies.get(branch.branchIndex) ?? []) {
        if (inner.type === 'attribute_list') {
          lists.push(inner);
        }
      }
    }
  }
  return lists;
}

/** The `#if` wrapper the grammar uses INSIDE an attribute position. */
const PREPROC_ATTRIBUTE_CHAIN_ROOT = 'preproc_if_in_attribute_list';

/**
 * How many ATTRIBUTES a declaration carries — not how many bracket groups.
 *
 * Exported because five relations have an `attributeCount` column and all five
 * were computing it from the list count. One helper is what keeps them from
 * disagreeing again.
 *
 * The `#if`-wrapped lists are NOT counted here, because the callers that use
 * this have no symbol set to hand and a count that guessed a branch would
 * disagree with the rows. Measured at 10 of 1,074 on multitarget-A, and the gate
 * asserts count and rows agree — so the day it matters is a named failure.
 */
/**
 * COUNTED THE SAME WAY THEY ARE EMITTED, through `attributeListsOf`.
 *
 * This read direct `attribute_list` children only, while the emitter has
 * resolved `preproc_if_in_attribute_list` since the day it was written. So a
 * declaration whose attribute sits inside a TAKEN `#if` emitted the attribute
 * row and reported `attributeCount = 0`: a count and its rows disagreeing by
 * construction, on the same node, in the same pass.
 *
 * `activeSymbols` is what the old signature lacked and the reason it was never
 * right — a count that cannot see which branch is taken cannot count what is in
 * one.
 */
export function countAttributes(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): number {
  let total = 0;
  for (const list of attributeListsOf(node, activeSymbols)) {
    total += childrenOfType(list, 'attribute').length;
  }
  return total;
}

/** `field:` → `FIELD`. The specifier's text includes the colon. */
const TARGET_BY_KEYWORD: ReadonlyMap<string, CsAttributeTarget> = new Map([
  ['assembly', CsAttributeTarget.ASSEMBLY],
  ['module', CsAttributeTarget.MODULE],
  ['type', CsAttributeTarget.TYPE],
  ['method', CsAttributeTarget.METHOD],
  ['field', CsAttributeTarget.FIELD],
  ['property', CsAttributeTarget.PROPERTY],
  ['event', CsAttributeTarget.EVENT],
  ['param', CsAttributeTarget.PARAM],
  ['return', CsAttributeTarget.RETURN],
  ['typevar', CsAttributeTarget.TYPEVAR],
]);

export function extractAttributes(
  input: CsAttributeExtractionInput
): CsAttributeExtractionResult {
  const result: CsAttributeExtractionResult = {
    attributes: [],
    attributeArguments: [],
    typeReferences: [],
    expressions: [],
    callSites: [],
  };

  // `position` runs across ALL of the owner's lists. `[A][B]` and `[A, B]` are
  // the same two attributes, and a per-list index would give both `A` and `B`
  // position 0 in the first form — two rows with one key, and duplicates
  // DOUBLE. `attributeListIndex` keeps the grouping as its own column.
  let position = 0;
  let listIndex = 0;

  for (const list of attributeListsOf(input.declarationNode, input.activeSymbols)) {
    const target = targetOf(list);
    for (const attribute of childrenOfType(list, 'attribute')) {
      emitOne(attribute, target, listIndex, position, input, result);
      position += 1;
    }
    listIndex += 1;
  }

  return result;
}

/**
 * `[assembly: InternalsVisibleTo("X")]` — a `global_attribute`, whose owner is
 * the FILE.
 *
 * It attaches to the assembly and there is no assembly row, so `MODULE` is not
 * a fallback here: the file is the only thing in the fact base that can hold
 * it, and the alternative is dropping an attribute that grants another assembly
 * access to every internal type in this one.
 */
export function extractGlobalAttributes(
  root: Parser.SyntaxNode,
  csModuleLinkHash: string,
  serviceVersionLinkHash: string
): CsAttributeExtractionResult {
  const result: CsAttributeExtractionResult = {
    attributes: [],
    attributeArguments: [],
    typeReferences: [],
    expressions: [],
    callSites: [],
  };
  const input: CsAttributeExtractionInput = {
    declarationNode: root,
    ownerHash: csModuleLinkHash,
    ownerKind: CsDeclarationOwnerKind.MODULE,
    csTypeLinkHash: '',
    csModuleLinkHash,
    serviceVersionLinkHash,
    activeSymbols: new Set(),
  };

  let position = 0;
  for (const global of childrenOfType(root, 'global_attribute')) {
    // The `assembly:` / `module:` keyword is an ANONYMOUS token on the
    // `global_attribute` itself, not an `attribute_target_specifier`.
    const target = allChildren(global).some((c) => !c.isNamed && c.type === 'module')
      ? CsAttributeTarget.MODULE
      : CsAttributeTarget.ASSEMBLY;
    for (const attribute of childrenOfType(global, 'attribute')) {
      emitOne(attribute, target, position, position, input, result);
      position += 1;
    }
  }
  return result;
}

function targetOf(list: Parser.SyntaxNode): CsAttributeTarget {
  const specifier = childOfType(list, 'attribute_target_specifier');
  if (specifier === undefined) {
    // Attached to whatever it is written on. NOT "unknown" — the absence of a
    // specifier is itself the answer, and conflating the two would make every
    // ordinary attribute look unclassified.
    return CsAttributeTarget.NONE;
  }
  const keyword = specifier.text.replace(':', '').trim().toLowerCase();
  return TARGET_BY_KEYWORD.get(keyword) ?? CsAttributeTarget.NONE;
}

function emitOne(
  node: Parser.SyntaxNode,
  target: CsAttributeTarget,
  listIndex: number,
  position: number,
  input: CsAttributeExtractionInput,
  result: CsAttributeExtractionResult
): void {
  const nameNode = node.childForFieldName('name');
  const written = nameNode?.text ?? '';
  const argumentList = childOfType(node, 'attribute_argument_list');
  const argumentNodes =
    argumentList === undefined ? [] : childrenOfType(argumentList, 'attribute_argument');

  const attribute = new CsAttributeRegistry({
    // The SIMPLE name, normalised. `[Obsolete]` and `[ObsoleteAttribute]` are
    // the same attribute in C#, and the suffix is NOT stripped here: whether
    // the shortened form resolves depends on what is in the using scope, which
    // is the engine's. `qualifiedName` keeps the spelling so it can decide.
    attributeName: normalizeCSharpIdentifier(simpleNameOf(written)),
    qualifiedName: written,
    attributeTarget: target,
    ownerHash: input.ownerHash,
    ownerKind: input.ownerKind,
    csTypeLinkHash: input.csTypeLinkHash,
    csModuleLinkHash: input.csModuleLinkHash,
    attributeListIndex: listIndex,
    position,
    argumentCount: argumentNodes.length,
    hasNamedArguments: argumentNodes.some((a) => a.childForFieldName('name') !== null),
    startLine: startLine(node),
    endLine: endLine(node),
    startColumn: startColumn(node),
    serviceVersionLinkHash: input.serviceVersionLinkHash,
  });

  // The attribute's own name is a TYPE REFERENCE. `[JsonConverter]` names a
  // class that is constructed at runtime, and without this the only place the
  // name exists is a text column nothing joins on.
  if (nameNode !== null) {
    const references = extractTypeReferences({
      typeNode: nameNode,
      ownerLinkHash: attribute.getHash(),
      referenceOwnerKind: CsReferenceOwnerKind.ATTRIBUTE,
      context: CsTypeRefContext.ATTRIBUTE_TYPE,
      serviceVersionLinkHash: input.serviceVersionLinkHash,
      typeParametersInScope: input.typeParametersInScope,
    });
    const root = references[0];
    if (root !== undefined) {
      attribute.setTypeReferenceLinkHash(root.getHash());
    }
    result.typeReferences.push(...references);
  }

  result.attributes.push(attribute);

  let index = 0;
  for (const argumentNode of argumentNodes) {
    emitArgument(argumentNode, attribute.getHash(), index, input, result);
    index += 1;
  }
}

function emitArgument(
  node: Parser.SyntaxNode,
  parentAttributeHash: string,
  position: number,
  input: CsAttributeExtractionInput,
  result: CsAttributeExtractionResult
): void {
  const nameNode = node.childForFieldName('name');
  // The VALUE is every named child that is not the name. Reading child [0]
  // would return the name itself for `Description = "x"`, which is the
  // positional-read defect with the operands swapped.
  const valueNode = namedChildren(node).find(
    (child) => nameNode === null || child.id !== nameNode.id
  );

  const argument = new CsAttributeArgumentRegistry({
    argumentName: nameNode === null ? '' : normalizeCSharpIdentifier(nameNode.text),
    argumentValue: valueNode?.text ?? '',
    valueKind: valueKindOf(valueNode),
    position,
    isNamedArgument: nameNode !== null,
    parentAttributeHash,
    startLine: startLine(node),
    endLine: endLine(node),
    startColumn: startColumn(node),
    serviceVersionLinkHash: input.serviceVersionLinkHash,
  });

  // `typeof(MyConverter)` — THE edge. A framework instantiates that type from a
  // stack no source file contains, and this reference is the only record of it.
  if (valueNode !== undefined && valueNode.type === 'typeof_expression') {
    const typeNode = valueNode.childForFieldName('type') ?? undefined;
    if (typeNode !== undefined) {
      const references = extractTypeReferences({
        typeNode,
        ownerLinkHash: argument.getHash(),
        referenceOwnerKind: CsReferenceOwnerKind.ATTRIBUTE,
        context: CsTypeRefContext.ATTRIBUTE_TYPE,
        serviceVersionLinkHash: input.serviceVersionLinkHash,
        typeParametersInScope: input.typeParametersInScope,
      });
      const root = references[0];
      if (root !== undefined) {
        argument.setReferencedTypeReferenceLinkHash(root.getHash());
      }
      result.typeReferences.push(...references);
    }
  }

  result.attributeArguments.push(argument);

  // The value as an EXPRESSION TREE, owned by the ATTRIBUTE. No method
  // encloses it and nothing runs it, so callerMethodLinkHash is empty and the
  // owner is the attribute row — the same rule as a field initializer, one
  // level further from executable code.
  if (valueNode !== undefined) {
    const expressionResult: CsExpressionResult = {
      expressions: result.expressions,
      callSites: result.callSites,
      queryClauses: [],
      rootHashByNodeId: new Map(),
      // `[InlineData((byte)42)]` — a cast inside an attribute argument is a
      // cast, and its type reference goes where the attribute's own do. Without
      // a sink here 1,777 of 32,432 casts on one stratum had no pair.
      typeReferences: result.typeReferences,
    };
    extractExpressionTree(
      valueNode,
      {
        csModuleLinkHash: input.csModuleLinkHash,
        csTypeLinkHash: input.csTypeLinkHash,
        ownerKind: CsExpressionOwnerKind.ATTRIBUTE,
        ownerHash: parentAttributeHash,
        rootContext: CsRootContext.ATTRIBUTE_ARGUMENT,
        serviceVersionLinkHash: input.serviceVersionLinkHash,
        callerMethodLinkHash: '',
        parameterNames: new Set(),
        typeParameterNames: new Set(input.typeParametersInScope?.keys() ?? []),
        methodNamesOnType: new Set(),
        eventNamesOnType: new Set(),
        valueMemberNamesOnType: new Set(),
        fieldNamesOnType: new Set(),
        propertyNamesOnType: new Set(),
        localFunctionNames: new Set(),
        lambdaParameterNames: new Set(),
        patternBindingNames: new Set(),
        queryRangeVariableNames: new Set(),
        usingAliasNames: new Set(),
        // An attribute argument is outside every callable.
        awaitIsKeyword: false,
        activeSymbols: input.activeSymbols,
      },
      expressionResult,
      position
    );
    const root = expressionResult.rootHashByNodeId?.get(nodeId(valueNode));
    if (root !== undefined) {
      argument.setExpressionLinkHash(root);
    }
  }
}

/**
 * What an argument's value IS.
 *
 * An ALLOWLIST, and `EXPRESSION` is the honest terminal. The text is carried in
 * `argumentValue` either way, so an unclassified value loses nothing but the
 * bucket — which is §5: a kind syntax cannot decide is withheld, not guessed.
 */
function valueKindOf(node: Parser.SyntaxNode | undefined): CsAttributeArgumentValueKind {
  if (node === undefined) {
    return CsAttributeArgumentValueKind.EXPRESSION;
  }
  switch (node.type) {
    case 'string_literal':
    case 'verbatim_string_literal':
    case 'raw_string_literal':
    case 'interpolated_string_expression':
      return CsAttributeArgumentValueKind.STRING;
    case 'integer_literal':
    case 'real_literal':
      return CsAttributeArgumentValueKind.NUMBER;
    case 'boolean_literal':
      return CsAttributeArgumentValueKind.BOOLEAN;
    case 'character_literal':
      return CsAttributeArgumentValueKind.CHARACTER;
    case 'null_literal':
      return CsAttributeArgumentValueKind.NULL;
    case 'typeof_expression':
      return CsAttributeArgumentValueKind.TYPEOF;
    case 'invocation_expression':
      // `nameof(x)` is an invocation in the tree and a compile-time string in
      // the language. Distinguished by the callee's spelling, which is the only
      // thing that separates it from an ordinary call — and an ordinary call is
      // not legal here, so the check is exact rather than a heuristic.
      return node.childForFieldName('function')?.text === 'nameof'
        ? CsAttributeArgumentValueKind.NAMEOF
        : CsAttributeArgumentValueKind.EXPRESSION;
    case 'member_access_expression':
      return CsAttributeArgumentValueKind.MEMBER_ACCESS;
    case 'identifier':
      return CsAttributeArgumentValueKind.IDENTIFIER;
    case 'array_creation_expression':
    case 'implicit_array_creation_expression':
    case 'initializer_expression':
    case 'collection_expression':
      return CsAttributeArgumentValueKind.ARRAY;
    default:
      return CsAttributeArgumentValueKind.EXPRESSION;
  }
}

/**
 * Every attribute in a file, in ONE walk.
 *
 * The alternative was an emit call at each of sixteen declaration sites, and
 * every one of those is a chance to reach a construct on two paths — which is
 * how a row gets emitted twice, and duplicates DOUBLE rather than collide.
 *
 * An `attribute_list` whose parent produced no declaration row emits nothing.
 * That is not silent: the gate asserts the number of `cs_attribute` rows equals
 * the number of `attribute` nodes in the tree, so an unowned list is a NAMED
 * failure rather than a quietly missing row.
 */
export function collectAttributes(input: {
  readonly root: Parser.SyntaxNode;
  readonly declarationOwners: DeclarationOwners;
  readonly csModuleLinkHash: string;
  readonly serviceVersionLinkHash: string;
  readonly activeSymbols: ReadonlySet<string>;
}): CsAttributeExtractionResult {
  const result: CsAttributeExtractionResult = {
    attributes: [],
    attributeArguments: [],
    typeReferences: [],
    expressions: [],
    callSites: [],
  };

  const merge = (part: CsAttributeExtractionResult): void => {
    result.attributes.push(...part.attributes);
    result.attributeArguments.push(...part.attributeArguments);
    result.typeReferences.push(...part.typeReferences);
    result.expressions.push(...part.expressions);
    result.callSites.push(...part.callSites);
  };

  // `[assembly: …]` first. It attaches to the assembly, which has no row, so
  // the FILE holds it — the alternative is dropping an attribute that grants
  // another assembly access to every internal type in this one.
  merge(
    extractGlobalAttributes(input.root, input.csModuleLinkHash, input.serviceVersionLinkHash)
  );

  // `enclosingTypeHash` is the nearest TYPE declaration above `node`, carried
  // down the walk. A member's attributes belong to the member (ownerHash); the
  // TYPE link is the enclosing type either way — for a type's own attributes
  // the type itself — the same meaning `csTypeLinkHash` has on every other
  // relation. This comment used to say so while the code wrote '' for every
  // member: the column was read as a selector and nothing selected by it.
  const walk = (node: Parser.SyntaxNode, enclosingTypeHash: string): void => {
    const owners = input.declarationOwners.get(node.id);
    const ownType = owners?.find((owner) => owner.kind === CsDeclarationOwnerKind.TYPE);
    const typeHashHere = ownType?.hash ?? enclosingTypeHash;
    if (owners !== undefined && attributeListsOf(node, input.activeSymbols).length > 0) {
      for (const owner of owners) {
        merge(
          extractAttributes({
            declarationNode: node,
            ownerHash: owner.hash,
            ownerKind: owner.kind,
            csTypeLinkHash: typeHashHere,
            csModuleLinkHash: input.csModuleLinkHash,
            serviceVersionLinkHash: input.serviceVersionLinkHash,
            activeSymbols: input.activeSymbols,
          })
        );
      }
    }
    for (const child of namedChildren(node)) {
      walk(child, typeHashHere);
    }
  };
  walk(input.root, '');

  return result;
}
