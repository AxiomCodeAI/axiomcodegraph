import Parser from 'tree-sitter';
import type { CsExtensionBlock } from '@/parsers/csharp/extractors/cs-extension-block';

import { CsBlockRegistry } from '@/analysis-types/csharp/CsBlockRegistry';
import { CsCallSiteRegistry } from '@/analysis-types/csharp/CsCallSiteRegistry';
import { CsEnumMemberRegistry } from '@/analysis-types/csharp/CsEnumMemberRegistry';
import { CsExpressionRegistry } from '@/analysis-types/csharp/CsExpressionRegistry';
import { CsQueryClauseRegistry } from '@/analysis-types/csharp/CsQueryClauseRegistry';
import { CsEventRegistry } from '@/analysis-types/csharp/CsEventRegistry';
import { CsFieldRegistry } from '@/analysis-types/csharp/CsFieldRegistry';
import { CsMethodParameterRegistry } from '@/analysis-types/csharp/CsMethodParameterRegistry';
import { CsMethodRegistry } from '@/analysis-types/csharp/CsMethodRegistry';
import { CsPropertyRegistry } from '@/analysis-types/csharp/CsPropertyRegistry';
import { CsTypeHeritageRegistry } from '@/analysis-types/csharp/CsTypeHeritageRegistry';
import { CsTypeParameterRegistry } from '@/analysis-types/csharp/CsTypeParameterRegistry';
import { CsTypeReferenceRegistry } from '@/analysis-types/csharp/CsTypeReferenceRegistry';
import { CsVariableRegistry } from '@/analysis-types/csharp/CsVariableRegistry';
import { CsTypeRegistry } from '@/analysis-types/csharp/CsTypeRegistry';
import { keyOf } from '@/analysis-types/csharp/cs-row';
import { CSHARP_ARITY_SEPARATOR } from '@/constants/csharp-constants';
import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  CsTypeAccess,
  CsTypeCategory,
  CsTypeModifier,
  CsTypePlacement,
} from '@/enums/csharp/types';
import {
  childOfType,
  childrenOfType,
  endLine,
  hasAnonymousToken,
  namedChildren,
  startColumn,
  startLine,
} from '@/parsers/csharp/extractors/cs-node';
import { CsDeclarationOwnerKind } from '@/enums/csharp/owners';
import { CsTypeParameterOwnerKind } from '@/enums/csharp/type-parameters';
import { extractHeritage } from '@/parsers/csharp/extractors/cs-heritage-extractor';
import {
  DeclarationOwner,
  DeclarationOwners,
  addDeclarationOwner,
  countAttributes,
} from '@/parsers/csharp/extractors/cs-attribute-extractor';
import {
  extractDelegateSignatureReferences,
  extractMembers,
} from '@/parsers/csharp/extractors/cs-member-extractor';
import { extractTypeParameters } from
  '@/parsers/csharp/extractors/cs-type-parameter-extractor';
import {
  PREPROC_CHAIN_ROOT,
  NullableContextMap,
  headerOf,
  modifiersOf,
  resolvePreprocBranches,
  declarationSpanStartNode,
} from '@/parsers/csharp/extractors/preproc-context';
import { normalizeCSharpIdentifier } from '@/utils/csharp';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * `cs_type` — one row per type DECLARATION SITE.
 *
 * A syntax-directed walk with no binder pass, which is the whole reason this is
 * a port of Java rather than of Python: C# declares types at declaration sites,
 * so nothing here has to infer anything.
 *
 * ## What the walk does that a generic tree walk would get wrong
 *
 * **It descends through non-emitting nodes explicitly.** A type inside
 * `#if`/`#else`, inside a namespace, inside another type's `declaration_list`,
 * is three or four levels below the compilation unit and none of the
 * intermediate nodes produces a `cs_type` row. §6: *a tree rooted at a
 * non-emitting node dies before its children are enqueued.* Unwrapping happens
 * in ONE place — {@link childDeclarationSites} — so no position can be missed
 * for one construct and handled for another.
 *
 * **It visits each declaration on exactly ONE path.** Duplicate keys do not
 * collide, they DOUBLE. A `preproc_if` chain is nested in this grammar — `#elif`
 * is a child of the `#if`, `#else` a child of the last `#elif` — so a walker
 * that also treated them as siblings would emit the `#else` body twice with
 * identical hashes and identical everything, and the row count would quietly
 * double with nothing looking wrong.
 */

/** Grammar node types that declare a type. */
const TYPE_DECLARATION_TYPES = new Set([
  'class_declaration',
  'struct_declaration',
  'interface_declaration',
  'enum_declaration',
  'record_declaration',
  'delegate_declaration',
]);

/** Nodes that hold declarations but declare nothing themselves. */
const TRANSPARENT_CONTAINERS = new Set([
  'compilation_unit',
  'declaration_list',
  'enum_member_declaration_list',
]);

export interface CsTypeExtractionOptions {
  readonly root: Parser.SyntaxNode;
  readonly csModuleLinkHash: string;
  readonly serviceVersionLinkHash: string;
  readonly activeSymbols: ReadonlySet<string>;
  readonly nullableContext: NullableContextMap;
  /** `using A = B.C;` aliases declared in this file, for USING_ALIAS references. */
  readonly usingAliasNames: ReadonlySet<string>;
  /**
   * C# 14 extension blocks the pre-parse pass flattened into their static
   * class, with the receiver it blanked out of the tree.
   *
   * Threaded rather than re-derived: the header the receiver was written in is
   * whitespace by the time this tree exists, so there is nothing left to read.
   */
  readonly extensionBlocks?: readonly CsExtensionBlock[];
}

export interface CsTypeExtractionResult {
  readonly types: readonly CsTypeRegistry[];
  readonly heritages: readonly CsTypeHeritageRegistry[];
  readonly typeParameters: readonly CsTypeParameterRegistry[];
  readonly methods: readonly CsMethodRegistry[];
  readonly methodParameters: readonly CsMethodParameterRegistry[];
  readonly properties: readonly CsPropertyRegistry[];
  readonly events: readonly CsEventRegistry[];
  readonly typeReferences: readonly CsTypeReferenceRegistry[];
  readonly fields: readonly CsFieldRegistry[];
  readonly enumMembers: readonly CsEnumMemberRegistry[];
  readonly expressions: readonly CsExpressionRegistry[];
  readonly callSites: readonly CsCallSiteRegistry[];
  readonly queryClauses: readonly CsQueryClauseRegistry[];
  readonly blocks: readonly CsBlockRegistry[];
  readonly variables: readonly CsVariableRegistry[];
  /**
   * `node.id` → the declaration row it produced, for every type and every
   * member.
   *
   * The attribute and comment passes read this and walk the tree ONCE, instead
   * of being threaded through every emit site. One construct, one visit path —
   * duplicates DOUBLE.
   */
  readonly declarationOwners: DeclarationOwners;
  /** `node.id` → the `cs_type` hash, for the extractors that run after this one. */
  readonly typeHashByNodeId: ReadonlyMap<number, string>;
  /** `node.id` → the declaring node, so a later pass need not re-walk. */
  readonly declarationNodes: ReadonlyMap<number, Parser.SyntaxNode>;
}

/** One frame of the enclosing-scope stack. */
interface ScopeFrame {
  /** Dotted namespace name in force, `''` in the global namespace. */
  readonly namespaceName: string;
  /** `NS:<namespace>` or `NESTED:<parent group key>`. */
  readonly declarationScopeKey: string;
  /** Hash of the enclosing `cs_type`, `''` at top level. */
  readonly containingTypeLinkHash: string;
  /** Dotted prefix for `qualifiedName`, including containing types. */
  readonly qualifiedPrefix: string;
  readonly placement: CsTypePlacement;
}

export function extractTypes(options: CsTypeExtractionOptions): CsTypeExtractionResult {
  const types: CsTypeRegistry[] = [];
  const heritages: CsTypeHeritageRegistry[] = [];
  const typeParameters: CsTypeParameterRegistry[] = [];
  const methods: CsMethodRegistry[] = [];
  const methodParameters: CsMethodParameterRegistry[] = [];
  const properties: CsPropertyRegistry[] = [];
  const events: CsEventRegistry[] = [];
  const typeReferences: CsTypeReferenceRegistry[] = [];
  const fields: CsFieldRegistry[] = [];
  const enumMembers: CsEnumMemberRegistry[] = [];
  const expressions: CsExpressionRegistry[] = [];
  const callSites: CsCallSiteRegistry[] = [];
  const queryClauses: CsQueryClauseRegistry[] = [];
  const blocks: CsBlockRegistry[] = [];
  const variables: CsVariableRegistry[] = [];
  const declarationOwners = new Map<number, DeclarationOwner[]>();
  const typeHashByNodeId = new Map<number, string>();
  const declarationNodes = new Map<number, Parser.SyntaxNode>();

  const walk = (
    node: Parser.SyntaxNode,
    enclosing: ScopeFrame,
    enclosingTypeParameters: ReadonlyMap<string, string>
  ): void => {
    // A FILE-SCOPED namespace scopes its FOLLOWING SIBLINGS, not its children.
    // `namespace N;` is a leaf whose subtree is the name and a semicolon; every
    // type in the file is a sibling of it in the compilation unit. Recursing
    // into it the way a block namespace is recursed into finds nothing and
    // leaves 7,626 files' worth of types in the global namespace with an empty
    // `csNamespaceName` — a wrong value in every column derived from it, and no
    // row missing anywhere to notice it by.
    let scope = enclosing;
    for (const child of childDeclarationSites(node, options.activeSymbols)) {
      if (child.type === 'file_scoped_namespace_declaration') {
        scope = namespaceFrame(child, enclosing);
        continue;
      }
      if (child.type === 'namespace_declaration') {
        walk(child, namespaceFrame(child, scope), enclosingTypeParameters);
        continue;
      }
      if (!TYPE_DECLARATION_TYPES.has(child.type)) {
        continue;
      }
      // A type is NEVER withheld for header debris: its kind is its keyword,
      // which the grammar cannot confuse, and a class whose base list a `#if`
      // splits still has every member inside it. The heritage extractor deals
      // with the split list; the parse-gap row records it.
      // The HEADER: the declaration itself, or the taken branch's
      // `class_header` when the header sits under a `#if` (fork rule 32) —
      // name, modifiers, type parameters, base list and attributes are read
      // from it. No header in this program: no type, and its body's members
      // are not in the program either.
      const header = headerOf(child, options.activeSymbols);
      if (header === undefined) {
        continue;
      }
      const row = buildType(child, header, scope, options);
      types.push(row);
      // ATTRIBUTES, not bracket groups. `cs_type.attributeCount` had a setter
      // nobody called, so every type reported 0 — and nothing could see it
      // until cs_attribute existed to disagree.
      row.setAttributeCount(countAttributes(header, options.activeSymbols));
      typeHashByNodeId.set(child.id, row.getHash());
      declarationNodes.set(child.id, child);
      addDeclarationOwner(declarationOwners, child.id, {
        hash: row.getHash(),
        kind: CsDeclarationOwnerKind.TYPE,
      });
      if (header.id !== child.id) {
        addDeclarationOwner(declarationOwners, header.id, {
          hash: row.getHash(),
          kind: CsDeclarationOwnerKind.TYPE,
        });
      }

      // TYPE PARAMETERS FIRST. The base list may use them — `class Impl<T> :
      // Base<T>` — so the scope has to exist before the heritage is read, or
      // every `T` in a base list reads as a reference to a type named `T`.
      const ownTypeParameters = extractTypeParameters({
        declarationNode: header,
        activeSymbols: options.activeSymbols,
        ownerLinkHash: row.getHash(),
        ownerKind: CsTypeParameterOwnerKind.TYPE,
        serviceVersionLinkHash: options.serviceVersionLinkHash,
        typeReferenceSink: typeReferences,
        declarationOwnerSink: declarationOwners,
      });
      typeParameters.push(...ownTypeParameters);

      // A NESTED type sees its enclosing types' parameters too: `class Outer<T>
      // { class Inner { T Field; } }` is legal and `T` is bound by Outer.
      const typeParameterScope = new Map(enclosingTypeParameters);
      for (const parameter of ownTypeParameters) {
        typeParameterScope.set(parameter.name, parameter.getHash());
      }

      // Emitted here, on the one path that reaches this declaration, so nothing
      // below can be reached twice — a duplicate does not collide, it doubles.
      const heritage = extractHeritage({
        declarationNode: header,
        csTypeLinkHash: row.getHash(),
        typeCategory: row.typeCategory,
        serviceVersionLinkHash: options.serviceVersionLinkHash,
        typeParametersInScope: typeParameterScope,
        activeSymbols: options.activeSymbols,
      });
      heritages.push(...heritage.heritages);
      typeReferences.push(...heritage.typeReferences);

      // A delegate's SIGNATURE, which is where a lambda converted to it gets
      // the types of its implicit parameters.
      if (child.type === 'delegate_declaration') {
        typeReferences.push(
          ...extractDelegateSignatureReferences({
            declarationNode: header,
            csTypeLinkHash: row.getHash(),
            serviceVersionLinkHash: options.serviceVersionLinkHash,
            typeParametersInScope: typeParameterScope,
            activeSymbols: options.activeSymbols,
          })
        );
      }

      // MEMBERS, keyed off this declaration site. A property emits its own row
      // AND one cs_method per accessor, which is 68% of that relation — the
      // reason they are built together rather than by separate passes.
      const members = extractMembers({
        declarationNode: child,
        csModuleLinkHash: options.csModuleLinkHash,
        csTypeLinkHash: row.getHash(),
        typeQualifiedName: row.qualifiedName,
        typeCategory: row.typeCategory,
        typeName: row.name,
        serviceVersionLinkHash: options.serviceVersionLinkHash,
        activeSymbols: options.activeSymbols,
        typeParametersInScope: typeParameterScope,
        // Collected in ONE PASS before members are built, because a method
        // group may name a method declared LATER in the file. Building it
        // incrementally would classify a forward reference as a plain name.
        methodNamesOnType: memberNamesDeclaredOn(child, 'method_declaration'),
        eventNamesOnType: eventNamesDeclaredOn(child),
        valueMemberNamesOnType: valueMemberNamesDeclaredOn(child),
        fieldNamesOnType: fieldNamesDeclaredOn(child),
        propertyNamesOnType: new Set(memberNamesDeclaredOn(child, 'property_declaration')),
        usingAliasNames: options.usingAliasNames,
        // A type's members are the outermost scope; nothing encloses them.
        enclosingLocalFunctionNames: new Set(),
        extensionBlocks: options.extensionBlocks ?? [],
      });
      methods.push(...members.methods);
      methodParameters.push(...members.parameters);
      properties.push(...members.properties);
      events.push(...members.events);
      typeParameters.push(...members.typeParameters);
      typeReferences.push(...members.typeReferences);
      fields.push(...members.fields);
      enumMembers.push(...members.enumMembers);
      expressions.push(...members.expressions);
      callSites.push(...members.callSites);
      queryClauses.push(...members.queryClauses);
      blocks.push(...members.blocks);
      variables.push(...members.variables);
      for (const [id, owners] of members.declarationOwners) {
        for (const owner of owners) {
          addDeclarationOwner(declarationOwners, id, owner);
        }
      }

      walk(child, nestedFrame(row, scope), typeParameterScope);
    }
  };

  walk(
    options.root,
    {
      namespaceName: '',
      declarationScopeKey: 'NS:',
      containingTypeLinkHash: '',
      qualifiedPrefix: '',
      placement: CsTypePlacement.TOP_LEVEL,
    },
    new Map()
  );

  return {
    types,
    heritages,
    typeParameters,
    methods,
    methodParameters,
    properties,
    events,
    typeReferences,
    fields,
    enumMembers,
    expressions,
    callSites,
    queryClauses,
    blocks,
    variables,
    declarationOwners,
    typeHashByNodeId,
    declarationNodes,
  };
}

/**
 * The declaration sites directly inside `node`, with every transparent wrapper
 * unwrapped — in ONE place, for every construct at once.
 *
 * The three wrappers that produce no row of their own and would otherwise take
 * their subtree with them:
 *
 * 1. `declaration_list` / `compilation_unit` — the ordinary containers.
 * 2. `preproc_if` and its chain — and only the **active** branch is descended
 *    into, per the §2.2 ruling. `cs_preproc_region` records the rest, so a row
 *    absent because its branch was not taken is auditable rather than lost.
 * 3. `attribute_list` and modifiers, which are skipped because they are not
 *    containers at all.
 *
 * Roslyn parses one branch; tree-sitter parses both. Emitting both would put
 * code in the fact base that never compiles together and make every difference
 * from the oracle read as a parser defect.
 */
function childDeclarationSites(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  const queue: Parser.SyntaxNode[] = [];

  const enqueueChildren = (parent: Parser.SyntaxNode): void => {
    for (const child of namedChildren(parent)) {
      queue.push(child);
    }
  };

  if (TRANSPARENT_CONTAINERS.has(node.type)) {
    enqueueChildren(node);
  } else {
    // A namespace or a type: its members are in its `declaration_list`, and a
    // file-scoped namespace has no list at all — its members are its own
    // children. Both must be handled or file-scoped namespaces, 7,626 of the
    // corpus, contribute no types.
    const list = childOfType(node, 'declaration_list');
    if (list !== undefined) {
      enqueueChildren(list);
    } else {
      for (const child of namedChildren(node)) {
        if (child.type === 'identifier' || child.type === 'qualified_name') {
          continue;
        }
        queue.push(child);
      }
    }
  }

  // SOURCE ORDER is preserved, and that is load-bearing rather than tidy: a
  // file-scoped namespace governs the siblings that FOLLOW it, so a queue that
  // appended an expanded `#if` body to the end would move types written above
  // the namespace to below it and file them under the wrong scope.
  while (queue.length > 0) {
    const child = queue.shift()!;
    if (child.type === PREPROC_CHAIN_ROOT) {
      const { branches, bodies } = resolvePreprocBranches(child, activeSymbols);
      const expanded: Parser.SyntaxNode[] = [];
      for (const branch of branches) {
        if (!branch.isActive) {
          continue;
        }
        expanded.push(...(bodies.get(branch.branchIndex) ?? []));
      }
      queue.unshift(...expanded);
      continue;
    }
    out.push(child);
  }

  return out;
}

/**
 * Every method name this type declares, in one pass.
 *
 * Collected BEFORE members are built because a method group may name a method
 * declared later in the file — C# has no forward-declaration rule — and an
 * incrementally-built set would classify a forward reference as a plain name.
 */
function memberNamesDeclaredOn(
  declaration: Parser.SyntaxNode,
  memberType: string
): ReadonlySet<string> {
  const names = new Set<string>();
  const list = childOfType(declaration, 'declaration_list');
  if (list === undefined) {
    return names;
  }
  for (const member of namedChildren(list)) {
    if (member.type !== memberType) {
      continue;
    }
    const nameNode = member.childForFieldName('name');
    if (nameNode !== null) {
      names.add(normalizeCSharpIdentifier(nameNode.text));
    }
  }
  return names;
}

/**
 * Every event this type declares, in BOTH forms.
 *
 * `event EventHandler A, B;` is a `event_field_declaration` holding declarators,
 * and `event EventHandler C { add … }` is an `event_declaration` with a name
 * field. Reading only the second misses 130 of the 197 events measured — the
 * field-like form is the common one — and every `+=` on one of them would then
 * be a compound assignment rather than a subscription.
 */
/**
 * The names a type declares that hold a VALUE — fields, properties, events.
 *
 * What makes `DELEGATE_INVOKE` a fact rather than a guess. `handler(x)` invokes
 * a delegate exactly when `handler` names a value and not a method, and C#
 * forbids a field and a method sharing a name on one type (CS0102) — so within
 * one file, one lookup decides it. Whether the value's TYPE is a delegate is
 * resolution and is not asked: a value that is invoked IS a delegate, or the
 * program does not compile.
 */
function valueMemberNamesDeclaredOn(declaration: Parser.SyntaxNode): ReadonlySet<string> {
  const names = new Set<string>(memberNamesDeclaredOn(declaration, 'property_declaration'));
  for (const name of eventNamesDeclaredOn(declaration)) {
    names.add(name);
  }
  for (const name of fieldNamesDeclaredOn(declaration)) {
    names.add(name);
  }
  return names;
}

/** The FIELDS a type declares in this file — one set of the three the v1.8 lookup returns. */
function fieldNamesDeclaredOn(declaration: Parser.SyntaxNode): ReadonlySet<string> {
  const names = new Set<string>();
  const list = childOfType(declaration, 'declaration_list');
  if (list === undefined) {
    return names;
  }
  for (const member of namedChildren(list)) {
    if (member.type !== 'field_declaration') {
      continue;
    }
    const variableDeclaration = childOfType(member, 'variable_declaration');
    if (variableDeclaration === undefined) {
      continue;
    }
    for (const declarator of childrenOfType(variableDeclaration, 'variable_declarator')) {
      const nameNode = declarator.childForFieldName('name');
      if (nameNode !== null) {
        names.add(normalizeCSharpIdentifier(nameNode.text));
      }
    }
  }
  return names;
}

function eventNamesDeclaredOn(declaration: Parser.SyntaxNode): ReadonlySet<string> {
  const names = new Set(memberNamesDeclaredOn(declaration, 'event_declaration'));
  const list = childOfType(declaration, 'declaration_list');
  if (list === undefined) {
    return names;
  }
  for (const member of namedChildren(list)) {
    if (member.type !== 'event_field_declaration') {
      continue;
    }
    const variableDeclaration = childOfType(member, 'variable_declaration');
    if (variableDeclaration === undefined) {
      continue;
    }
    for (const declarator of namedChildren(variableDeclaration)) {
      if (declarator.type !== 'variable_declarator') {
        continue;
      }
      const nameNode = declarator.childForFieldName('name');
      if (nameNode !== null) {
        names.add(normalizeCSharpIdentifier(nameNode.text));
      }
    }
  }
  return names;
}

function namespaceFrame(node: Parser.SyntaxNode, parent: ScopeFrame): ScopeFrame {
  const nameNode =
    childOfType(node, 'qualified_name') ?? childOfType(node, 'identifier');
  const declared = nameNode?.text ?? '';
  const namespaceName =
    parent.namespaceName === '' ? declared : `${parent.namespaceName}.${declared}`;
  return {
    namespaceName,
    declarationScopeKey: `NS:${namespaceName}`,
    // A namespace does not nest a type inside another type: a type declared in
    // `namespace A { namespace B { … } }` is still TOP_LEVEL, and its containing
    // type is nothing.
    containingTypeLinkHash: '',
    qualifiedPrefix: namespaceName,
    placement: CsTypePlacement.TOP_LEVEL,
  };
}

function nestedFrame(parent: CsTypeRegistry, outer: ScopeFrame): ScopeFrame {
  return {
    namespaceName: outer.namespaceName,
    // `NESTED:<parent GROUP key>`, never the parent's primary key. Two parts of
    // one `partial` outer type must put their nested types in the SAME scope, or
    // `Outer.Inner` declared in part 1 and part 2 would be two different types.
    // The group key is the only value both parts agree on.
    declarationScopeKey: `NESTED:${parent.declarationGroupKey}`,
    containingTypeLinkHash: parent.getHash(),
    qualifiedPrefix: parent.qualifiedName,
    placement: CsTypePlacement.NESTED,
  };
}

function buildType(
  node: Parser.SyntaxNode,
  header: Parser.SyntaxNode,
  scope: ScopeFrame,
  options: CsTypeExtractionOptions
): CsTypeRegistry {
  // NORMALISED, and this one is in the PRIMARY KEY. `@class` is the identifier
  // `class`; a type declared one way and referenced the other is ONE type, and
  // keying on the raw spelling would make it two.
  // THE `name` FIELD FIRST, and the fallback only where the grammar has none.
  //
  // This read was `childOfType(header, 'identifier')` — the first identifier
  // CHILD — which is right for every declaration whose name is the first
  // identifier in its header, and wrong for the one where it is not. A
  // delegate's header is `delegate <type> <name>`, so when the return type is
  // a bare identifier the first identifier child IS the return type:
  //
  //     public delegate Exception ExceptionPredicate(Exception ex);  -> "Exception"
  //     public delegate T         GenericRet<T>(T a);                -> "T"
  //     public delegate bool      PredicateOk(int a);                -> correct
  //     public delegate System.Exception QualifiedRet(int a);        -> correct
  //
  // Only a BARE identifier return type collides; a predefined type (`bool`),
  // a qualified name and an array type are all other node kinds, which is why
  // 25 of the 27 delegates in desktop-A and 1 of the 2 in library-A were right and the defect
  // survived. The name is in the PRIMARY KEY, so a delegate named after its
  // return type is a type nothing can reference.
  const nameNode = header.childForFieldName('name') ?? childOfType(header, 'identifier');
  const name = normalizeCSharpIdentifier(nameNode?.text ?? '');
  const modifiers = readModifiers(header, options.activeSymbols);
  const typeParameters = childOfType(header, 'type_parameter_list');
  const arity = typeParameters === undefined
    ? 0
    : namedChildren(typeParameters).filter((c) => c.type === 'type_parameter').length;

  const isFileLocal = modifiers.has(CsTypeModifier.FILE);
  const category = categoryOf(node);
  const primaryConstructor = primaryConstructorOf(header);

  // `file class C` in two files in the same namespace are TWO types. The scope
  // key must therefore carry the file, or the group key merges them and the
  // engine sees one type with two halves that never saw each other.
  // `FILE:<hash>:NS:<namespace>`, in exactly that order. The format is part of
  // the contract, not an internal detail: it feeds `declarationGroupKey`, which
  // is how the engine forms a merged partial type, and an implementation that
  // spelled it differently would partition the same program differently.
  const scopeKey = isFileLocal
    ? `FILE:${options.csModuleLinkHash}:${scope.declarationScopeKey}`
    : scope.declarationScopeKey;

  const qualifiedName =
    scope.qualifiedPrefix === '' ? name : `${scope.qualifiedPrefix}.${name}`;

  return new CsTypeRegistry({
    name,
    qualifiedName,
    arity,
    typeCategory: category,
    typeAccess: accessOf(modifiers, scope.placement),
    typeModifiers: modifiers,
    typePlacement: scope.placement,
    declarationScopeKey: scopeKey,
    declarationGroupKey: declarationGroupKey(scopeKey, name, arity),
    isPartial: modifiers.has(CsTypeModifier.PARTIAL),
    isStatic: modifiers.has(CsTypeModifier.STATIC),
    isAbstract: modifiers.has(CsTypeModifier.ABSTRACT),
    isSealed: modifiers.has(CsTypeModifier.SEALED),
    isReadOnly: modifiers.has(CsTypeModifier.READONLY),
    isRefLikeStruct: isRefLikeStruct(node, category),
    isFileLocal,
    isRecord:
      category === CsTypeCategory.RECORD || category === CsTypeCategory.RECORD_STRUCT,
    hasPrimaryConstructor: primaryConstructor !== undefined,
    primaryConstructorArity: primaryConstructor?.arity ?? 0,
    nullableContext: options.nullableContext.at(node.startIndex),
    csModuleLinkHash: options.csModuleLinkHash,
    containingTypeLinkHash: scope.containingTypeLinkHash,
    csNamespaceName: scope.namespaceName,
    // The declaration starts where its first ATTRIBUTE or MODIFIER is, not at a
    // `#if` DIRECTIVE guarding them — a directive is trivia and belongs to no
    // declaration. See declarationSpanStartNode.
    startLine: startLine(declarationSpanStartNode(node, options.activeSymbols)),
    endLine: endLine(node),
    startColumn: startColumn(declarationSpanStartNode(node, options.activeSymbols)),
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  });
}

/**
 * The MERGED type's identity — `md5(declarationScopeKey ‖ name ‖ arity)`.
 *
 * Deliberately **not unique**. N parts of a `partial` type produce N rows all
 * carrying this value, and grouping on it is how the engine forms the merged
 * type. It gets its own `CS_DECLARATION_GROUP` prefix so it can never be
 * mistaken for an entity hash in a join.
 */
export function declarationGroupKey(
  declarationScopeKey: string,
  name: string,
  arity: number
): string {
  return EntityUtils.generateEntityHash(
    ENTITY_IDENTIFIERS.CS_DECLARATION_GROUP,
    keyOf(declarationScopeKey, `${name}${CSHARP_ARITY_SEPARATOR}${arity}`)
  );
}

/**
 * The category, read from the grammar rather than from the modifier list.
 *
 * `record`, `record class` and `record struct` are all `record_declaration`, and
 * the distinguishing token is an ANONYMOUS `struct` child — not a `modifier`
 * node. A modifier-only scan reports every record as a reference type, which
 * inverts the value semantics for the 32 `record struct` declarations measured.
 */
function categoryOf(node: Parser.SyntaxNode): CsTypeCategory {
  switch (node.type) {
    case 'class_declaration':
      return CsTypeCategory.CLASS;
    case 'struct_declaration':
      return CsTypeCategory.STRUCT;
    case 'interface_declaration':
      return CsTypeCategory.INTERFACE;
    case 'enum_declaration':
      return CsTypeCategory.ENUM;
    case 'delegate_declaration':
      return CsTypeCategory.DELEGATE;
    case 'record_declaration':
      return hasAnonymousToken(node, 'struct')
        ? CsTypeCategory.RECORD_STRUCT
        : CsTypeCategory.RECORD;
    default:
      return CsTypeCategory.CLASS;
  }
}

/**
 * `ref struct` — stack-only, and a real constraint on where a value may flow.
 *
 * The `ref` is an anonymous token on `struct_declaration`, sitting between the
 * `modifier` nodes and the `struct` keyword. It is NOT in the modifier list, so
 * `readonly ref struct Span2` yields exactly one `modifier` node (`readonly`)
 * and the `ref` would be lost by any scan that only reads those.
 */
function isRefLikeStruct(node: Parser.SyntaxNode, category: CsTypeCategory): boolean {
  if (category !== CsTypeCategory.STRUCT && category !== CsTypeCategory.RECORD_STRUCT) {
    return false;
  }
  return hasAnonymousToken(node, 'ref');
}

/**
 * A primary constructor's parameter list, when the declaration has one.
 *
 * `class Primary(int a)` (C# 12) and `record Person(string Name)` both attach a
 * `parameter_list` directly to the type declaration. For a positional record
 * that list also **synthesizes one property per parameter** — declarations with
 * no declaration syntax anywhere — which is why the arity is carried on the
 * type row and not only on the eventual `cs_method` row.
 *
 * 2,816 primary constructors measured, 108 of them positional records.
 */
function primaryConstructorOf(node: Parser.SyntaxNode): { arity: number } | undefined {
  const list = childOfType(node, 'parameter_list');
  if (list === undefined) {
    return undefined;
  }
  // A `delegate_declaration` also has a `parameter_list`, and it is the
  // delegate's SIGNATURE, not a primary constructor. Reporting it as one would
  // tell the engine a delegate type is constructible with those arguments.
  if (node.type === 'delegate_declaration') {
    return undefined;
  }
  return {
    arity: namedChildren(list).filter((c) => c.type === 'parameter').length,
  };
}

const MODIFIER_BY_TOKEN: ReadonlyMap<string, CsTypeModifier> = new Map([
  ['public', CsTypeModifier.PUBLIC],
  ['private', CsTypeModifier.PRIVATE],
  ['protected', CsTypeModifier.PROTECTED],
  ['internal', CsTypeModifier.INTERNAL],
  ['static', CsTypeModifier.STATIC],
  ['abstract', CsTypeModifier.ABSTRACT],
  ['sealed', CsTypeModifier.SEALED],
  ['partial', CsTypeModifier.PARTIAL],
  ['readonly', CsTypeModifier.READONLY],
  ['ref', CsTypeModifier.REF],
  ['unsafe', CsTypeModifier.UNSAFE],
  ['new', CsTypeModifier.NEW],
  ['file', CsTypeModifier.FILE],
]);

function readModifiers(node: Parser.SyntaxNode, activeSymbols: ReadonlySet<string>): Set<CsTypeModifier> {
  const found = new Set<CsTypeModifier>();
  for (const child of modifiersOf(node, activeSymbols)) {
    const modifier = MODIFIER_BY_TOKEN.get(child.text.trim());
    if (modifier !== undefined) {
      found.add(modifier);
    }
  }
  // `ref struct` puts `ref` in the tree as an anonymous token rather than a
  // `modifier`, so the set would be missing it while `isRefLikeStruct` is true —
  // two columns disagreeing about the same fact.
  if (hasAnonymousToken(node, 'ref')) {
    found.add(CsTypeModifier.REF);
  }
  return found;
}

/**
 * Declared accessibility, with C#'s default applied.
 *
 * The default is **positional**, not global: `internal` for a top-level type and
 * `private` for a nested one. Emitting a `DEFAULT` sentinel and leaving the
 * engine to re-derive it from the placement column would push a syntactic,
 * local rule across the parser/engine boundary for no benefit.
 *
 * A nested type inside an INTERFACE defaults to `public`, which this handles by
 * reading the placement rather than the parent category — a simplification that
 * is correct for classes, structs and records, and is flagged in the schema log
 * as needing the parent category once `cs_type_heritage` lands.
 */
function accessOf(
  modifiers: ReadonlySet<CsTypeModifier>,
  placement: CsTypePlacement
): CsTypeAccess {
  const hasProtected = modifiers.has(CsTypeModifier.PROTECTED);
  const hasInternal = modifiers.has(CsTypeModifier.INTERNAL);
  const hasPrivate = modifiers.has(CsTypeModifier.PRIVATE);

  if (hasProtected && hasInternal) {
    return CsTypeAccess.PROTECTED_INTERNAL;
  }
  if (hasProtected && hasPrivate) {
    return CsTypeAccess.PRIVATE_PROTECTED;
  }
  if (modifiers.has(CsTypeModifier.PUBLIC)) {
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
  return placement === CsTypePlacement.NESTED
    ? CsTypeAccess.PRIVATE
    : CsTypeAccess.INTERNAL;
}
