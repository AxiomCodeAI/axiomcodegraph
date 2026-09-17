import Parser from 'tree-sitter';

import { CsTypeHeritageRegistry } from '@/analysis-types/csharp/CsTypeHeritageRegistry';
import { CsTypeReferenceRegistry } from '@/analysis-types/csharp/CsTypeReferenceRegistry';
import { CsHeritageKind } from '@/enums/csharp/heritage';
import { CsTypeCategory } from '@/enums/csharp/types';
import {
  CsReferenceOwnerKind,
  CsTypeRefContext,
} from '@/enums/csharp/type-references';
import { extractTypeReferences } from
  '@/parsers/csharp/extractors/cs-type-reference-extractor';
import { baseTypeName, typeArgumentArity } from '@/utils/csharp';
import {
  namedChildren,
  startColumn,
  startLine,
} from '@/parsers/csharp/extractors/cs-node';
import {
activeChildOfType,
} from '@/parsers/csharp/extractors/preproc-context';

/**
 * `cs_type_heritage` — one row per entry in a type's base list.
 *
 * ## Reading the list is not reading a keyword — but 30.1% of it is decidable
 *
 * `class C : A, IB` has no `extends` and no `implements`, and which entry is the
 * base class is a resolution outcome. That is true of **position 0 of a class's
 * list and nothing else.** Two rules settle the rest from syntax:
 *
 * 1. **The owner forbids a base class** — struct, record struct, interface.
 *    1,066 entries.
 * 2. **POSITION.** A base class must come FIRST if present, so every entry at
 *    position ≥ 1 on a class or record class is an interface. **3,218 entries**,
 *    three times the first rule and the half that is easy to miss.
 *
 * 9,933 of 14,217 entries remain genuinely ambiguous, and only those are handed
 * to the engine.
 *
 * ## Three things in the base list that are not base types
 *
 * 1. **An `argument_list`.** `class P(int a) : Base(a)` passes primary-
 *    constructor arguments to the base constructor. The arguments are an
 *    invocation, not a type, and are recorded as
 *    `hasPrimaryConstructorArguments` on the entry they belong to rather than
 *    emitted as a heritage row of their own. Treating them as one would put a
 *    call's arguments into the type graph.
 * 2. **An enum's underlying type.** `enum E : byte` names storage, not a base:
 *    `E` derives from `System.Enum`. It gets `ENUM_UNDERLYING`.
 * 3. **The colon.** Anonymous, so taking named children only skips it.
 */
export interface CsHeritageExtractionOptions {
  readonly declarationNode: Parser.SyntaxNode;
  readonly csTypeLinkHash: string;
  readonly typeCategory: CsTypeCategory;
  readonly serviceVersionLinkHash: string;
  /** The declaring type's own parameters — `class Impl<T> : Base<T>` uses them. */
  readonly typeParametersInScope: ReadonlyMap<string, string>;
  /** The symbols this emission compiles under — a base list can sit under a `#if`. */
  readonly activeSymbols: ReadonlySet<string>;
}

/**
 * Categories whose base list CANNOT contain a base class.
 *
 * A struct, a record struct and an interface may only list interfaces — the
 * language forbids anything else — so the parser knows without resolving.
 */
const CANNOT_HAVE_BASE_CLASS = new Set<CsTypeCategory>([
  CsTypeCategory.STRUCT,
  CsTypeCategory.RECORD_STRUCT,
  CsTypeCategory.INTERFACE,
]);

export function extractHeritage(
  options: CsHeritageExtractionOptions
): { heritages: CsTypeHeritageRegistry[]; typeReferences: CsTypeReferenceRegistry[] } {
  const typeReferences: CsTypeReferenceRegistry[] = [];
  // Through a `#if`: `class C\n#if X\n : I\n#endif` is the multi-targeting
  // idiom for an interface one target has, and the fork's grammar parses it
  // as a `preproc_if` holding a base list per branch. The branch this emission
  // takes is the one whose base list is read; the other is not in the program.
  const baseList = activeChildOfType(options.declarationNode, 'base_list', options.activeSymbols);
  if (baseList === undefined) {
    return { heritages: [], typeReferences };
  }

  const rows: CsTypeHeritageRegistry[] = [];
  let position = 0;

  // A `#if` inside a base list is not in the tree. The parser blanks the arms
  // this emission does not compile before parsing, so `: A, B` followed by a
  // guarded `, C` arrives as `: A, B` with the directive lines whitespace. The
  // branch that read a `preproc_if` child here — and the fork's
  // `base_continuation` / `base_fragment` nodes it looked for inside it —
  // cannot match, and a read that cannot match is the same defect as a
  // negative control detached from its target.
  const entries = namedChildren(baseList);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;

    if (entry.type === 'argument_list') {
      // The FLAT shape: the arguments belong to the entry before them, which has
      // already been emitted.
      const previous = rows[rows.length - 1];
      if (previous !== undefined) {
        rows[rows.length - 1] = withPrimaryConstructorArguments(previous, options);
      }
      continue;
    }

    // The WRAPPED shape. Unwrapping here, at the one place entries are read,
    // is what keeps a record's base indistinguishable from a class's downstream
    // — the alternative is every later consumer learning about both spellings.
    const isWrapped = entry.type === 'primary_constructor_base_type';
    const typeNode = isWrapped ? baseTypeOf(entry) : entry;

    const { name, arity } = nameAndArity(typeNode);
    rows.push(
      new CsTypeHeritageRegistry({
        csTypeLinkHash: options.csTypeLinkHash,
        position,
        // The TYPE as written, without the argument list. `Parent`, not
        // `Parent(X)`: the second is a name nothing resolves.
        heritageText: typeNode.text,
        baseTypeName: name,
        baseTypeArity: arity,
        heritageKind: heritageKindFor(options.typeCategory, position),
        hasPrimaryConstructorArguments: isWrapped,
        startLine: startLine(typeNode),
        startColumn: startColumn(typeNode),
        serviceVersionLinkHash: options.serviceVersionLinkHash,
      })
    );
    // The base type's own reference TREE. `IRepo<int, string, T>` is four
    // references, and the heritage row carries only the outermost name.
    const heritageRow = rows[rows.length - 1]!;
    const references = extractTypeReferences({
      typeNode,
      ownerLinkHash: options.csTypeLinkHash,
      referenceOwnerKind: CsReferenceOwnerKind.TYPE,
      context:
        options.typeCategory === CsTypeCategory.ENUM
          ? CsTypeRefContext.ENUM_UNDERLYING
          : CsTypeRefContext.BASE_LIST,
      serviceVersionLinkHash: options.serviceVersionLinkHash,
      rootPosition: position,
      typeParametersInScope: options.typeParametersInScope,
    });
    const root = references[0];
    if (root !== undefined) {
      // A same-file, one-hop link from the heritage entry to its reference. NOT
      // a link to the base type's DECLARATION — that is cross-file and the
      // engine's.
      heritageRow.setTypeReferenceLinkHash(root.getHash());
    }
    typeReferences.push(...references);

    position += 1;
  }

  return { heritages: rows, typeReferences };
}

/**
 * The kind, from the owner AND the position.
 *
 * `position` is not decoration. On a class it is what separates the one entry
 * that might be a base class from every entry that provably is not, and it
 * accounts for three quarters of everything syntax can decide here.
 */
/**
 * The type inside a `primary_constructor_base_type`, or the wrapper if the
 * grammar ever stops nesting one.
 *
 * Falling back to the wrapper rather than throwing is deliberate: a grammar bump
 * that changed this shape would otherwise take the run down, and the honest
 * degradation is a slightly wrong name in one column. The grammar-read gate is
 * what turns that into a NAMED failure instead of a silent one.
 */
function baseTypeOf(wrapper: Parser.SyntaxNode): Parser.SyntaxNode {
  for (const child of namedChildren(wrapper)) {
    if (child.type !== 'argument_list') {
      return child;
    }
  }
  return wrapper;
}

function heritageKindFor(category: CsTypeCategory, position: number): CsHeritageKind {
  if (category === CsTypeCategory.ENUM) {
    return CsHeritageKind.ENUM_UNDERLYING_TYPE;
  }
  if (CANNOT_HAVE_BASE_CLASS.has(category)) {
    return CsHeritageKind.INTERFACE;
  }
  // A class or record class. A base class must be written first, so only the
  // first entry is in doubt.
  return position === 0 ? CsHeritageKind.BASE_OR_INTERFACE : CsHeritageKind.INTERFACE;
}

/**
 * The entry's name and its GENERIC ARITY, kept apart.
 *
 * `IRepo<int, string, T>` is a reference to `IRepo` with arity 3, and both parts
 * are needed: the name is what a `using` scope resolves, and the arity is what
 * distinguishes `IRepo<T>` from `IRepo<T,U>` — two different types with one
 * name, 167 such collisions in the corpus.
 *
 * `A.B.C<T>` puts the generic name at the END of a qualified name, so the arity
 * is read from the innermost node rather than the outermost.
 */
function nameAndArity(entry: Parser.SyntaxNode): { name: string; arity: number } {
  // Both from the WRITTEN text, through the shared type utils. `typeArgumentArity`
  // counts at the top level only, so `IRepo<int, Dictionary<string, T>>` is arity
  // 2 and not 3 — a flat comma count would report 3 and make `IRepo`2` unfindable.
  //
  // A QUALIFIED generic puts its arguments on the LAST segment, and reading the
  // outermost node reports 0 for `System.Collections.Generic.List<int>`, which
  // is most of the BCL as it is actually written. `baseTypeName` keeps the
  // dotted path because that is what a `using` scope resolves.
  const text = entry.text;
  return { name: baseTypeName(text), arity: typeArgumentArity(text) };
}

/**
 * Rebuilds an entry with its primary-constructor arguments recorded.
 *
 * A rebuild rather than a setter because `hasPrimaryConstructorArguments` is in
 * neither the primary key nor the identity, but the row is otherwise immutable
 * and one mutable field would invite the next one — which would be in the key.
 */
function withPrimaryConstructorArguments(
  row: CsTypeHeritageRegistry,
  options: CsHeritageExtractionOptions
): CsTypeHeritageRegistry {
  const rebuilt = new CsTypeHeritageRegistry({
    csTypeLinkHash: row.csTypeLinkHash,
    position: row.position,
    heritageText: row.heritageText,
    baseTypeName: row.baseTypeName,
    baseTypeArity: row.baseTypeArity,
    heritageKind: row.heritageKind,
    hasPrimaryConstructorArguments: true,
    startLine: row.startLine,
    startColumn: row.startColumn,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  });
  // The link set on the original row after construction. Rebuilding a row
  // from its constructor arguments dropped it, so every base with
  // primary-constructor arguments — 1,758 of 8,857 entries on one stratum —
  // had no type-reference tree.
  rebuilt.setTypeReferenceLinkHash(row.getTypeReferenceLinkHash());
  return rebuilt;
}
