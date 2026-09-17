import Parser from 'tree-sitter';

import { CsTypeReferenceRegistry } from '@/analysis-types/csharp/CsTypeReferenceRegistry';
import { CSHARP_TYPE_REFERENCE_MAX_DEPTH } from '@/constants/csharp-constants';
import {
  CsReferenceOwnerKind,
  CsTypeRefContext,
  CsTypeRefKind,
} from '@/enums/csharp/type-references';
import { baseTypeName } from '@/utils/csharp';
import {
  childOfType,
  childrenOfType,
  endLine,
  namedChildren,
  startColumn,
  startLine,
} from '@/parsers/csharp/extractors/cs-node';

/**
 * `cs_type_reference` — the type-reference TREE.
 *
 * `Dictionary<string, List<int?>>` is four references, not one string, and
 * `parentReferenceHash` + `position` + `depth` reconstruct the nesting.
 *
 * ## Reification is why the tree is kept
 *
 * C# generics are reified: `List<int>` and `List<string>` are **distinct
 * runtime types** with distinct method tables, where Java erases both to `List`.
 * The type-argument subtree is therefore part of the type's IDENTITY rather
 * than decoration a compiler discards. Flattening it to `completeTypeName`
 * would leave the engine unable to ask "which constructions of `List` exist in
 * this program", which is a question about reachable code in C# and is not one
 * in Java.
 *
 * ## Wrapper or column, decided per shape
 *
 * §3 says the variant belongs in a field, and the schema gives four fields for
 * exactly that. So:
 *
 * | shape | representation | why |
 * |---|---|---|
 * | `int[,]` | COLUMN `arrayRank = 2` | Java does the same with `arrayDimensions`, and the element type is what matters |
 * | `string?` | COLUMN `isNullableAnnotated` | a wrapper would hide the real shape behind it |
 * | `int*` | COLUMN `isPointer` + kind `POINTER` | one node, both facts |
 * | `(int, string)` | WRAPPER, elements as children | the elements have no other home, and `tupleElementCount` alone would lose their types |
 * | `List<int>` | WRAPPER, arguments as children | the whole reification argument |
 * | `ref int` | WRAPPER | an alias is not the thing it aliases, and no column says so |
 *
 * ## An allowlist of positions, never a generic walk
 *
 * §6: a generic tree walk puts type names into the expression relation, and
 * type-only constructs then reach the call graph. Every call into this module
 * names the CONTEXT it is extracting from, so a position that has not been
 * thought about emits nothing rather than something wrong.
 */

export interface CsTypeReferenceInput {
  /** The type node — `predefined_type`, `generic_name`, `array_type`, … */
  readonly typeNode: Parser.SyntaxNode | null | undefined;
  readonly ownerLinkHash: string;
  readonly referenceOwnerKind: CsReferenceOwnerKind;
  readonly context: CsTypeRefContext;
  readonly serviceVersionLinkHash: string;
  /** Distinguishes several references sharing one owner and context. */
  readonly rootPosition?: number;
  /**
   * Type-parameter names in scope, mapped to their `cs_type_parameter` hash.
   *
   * `T` in `List<T>` is a TYPE VARIABLE, not a reference to a type named `T`,
   * and an engine that cannot tell will try to resolve it as one — searching
   * every `using` in scope for a type that does not exist. The distinction is
   * purely syntactic: the enclosing declarations' parameter lists say which
   * names are bound. So it costs nothing to be right and it is wrong on every
   * generic method otherwise.
   *
   * The hash gives `typeParameterLinkHash` a same-file, one-hop target, which is
   * the only kind of link the IR rule permits.
   */
  readonly typeParametersInScope?: ReadonlyMap<string, string>;
}

export function extractTypeReferences(
  input: CsTypeReferenceInput
): CsTypeReferenceRegistry[] {
  if (input.typeNode === null || input.typeNode === undefined) {
    return [];
  }
  const rows: CsTypeReferenceRegistry[] = [];
  build(input.typeNode, '', input.rootPosition ?? 0, 0, input, rows);
  return rows;
}

function build(
  node: Parser.SyntaxNode,
  parentReferenceHash: string,
  position: number,
  depth: number,
  input: CsTypeReferenceInput,
  rows: CsTypeReferenceRegistry[]
): void {
  if (depth > CSHARP_TYPE_REFERENCE_MAX_DEPTH) {
    // A cap that can never fire is a cap nobody maintains. Deeper nodes are
    // dropped rather than emitted at a wrong depth, and the parent is still
    // present so the loss is visible as a missing subtree rather than a
    // silently reshaped tree.
    return;
  }

  const shape = describe(node);
  if (shape === undefined) {
    return;
  }

  // TYPE_PARAMETER is decided here rather than in `describe`, because `describe`
  // reads one node and this needs the enclosing declarations' scope.
  const boundHash =
    shape.kind === CsTypeRefKind.NAMED
      ? input.typeParametersInScope?.get(shape.typeName)
      : undefined;

  const row = new CsTypeReferenceRegistry({
    kind: boundHash === undefined ? shape.kind : CsTypeRefKind.TYPE_PARAMETER,
    context: input.context,
    ownerLinkHash: input.ownerLinkHash,
    referenceOwnerKind: input.referenceOwnerKind,
    parentReferenceHash,
    position,
    depth,
    typeName: shape.typeName,
    completeTypeName: shape.completeTypeName,
    // TYPE ARGUMENTS only. A tuple's elements are counted by
    // `tupleElementCount` and a pointer's pointee is not an argument at all, so
    // counting every child here would make `typeArgumentCount` mean "children",
    // which is a different question and one no rule wants to ask.
    typeArgumentCount:
      shape.kind === CsTypeRefKind.CONSTRUCTED ||
      shape.kind === CsTypeRefKind.FUNCTION_POINTER
        ? shape.children.length
        : 0,
    arrayRank: shape.arrayRank,
    isNullableAnnotated: shape.isNullableAnnotated,
    isPointer: shape.kind === CsTypeRefKind.POINTER,
    isTuple: shape.kind === CsTypeRefKind.TUPLE,
    tupleElementCount: shape.kind === CsTypeRefKind.TUPLE ? shape.children.length : 0,
    startLine: startLine(shape.anchor),
    endLine: endLine(shape.anchor),
    startColumn: startColumn(shape.anchor),
    serviceVersionLinkHash: input.serviceVersionLinkHash,
  });
  // A bare name that is bound as a type PARAMETER by an enclosing declaration.
  // Purely syntactic, and it changes the kind rather than adding a column,
  // because "resolve this name in the using scope" and "this is a type
  // variable" are different instructions to the engine.
  if (boundHash !== undefined) {
    row.setTypeParameterLinkHash(boundHash);
  }
  rows.push(row);

  let childPosition = 0;
  for (const child of shape.children) {
    build(child, row.getHash(), childPosition, depth + 1, input, rows);
    childPosition += 1;
  }
}

interface TypeShape {
  kind: CsTypeRefKind;
  typeName: string;
  completeTypeName: string;
  arrayRank: number;
  isNullableAnnotated: boolean;
  children: Parser.SyntaxNode[];
  /** The node whose position is reported — the innermost meaningful one. */
  anchor: Parser.SyntaxNode;
}

/**
 * Reads one type node into a shape, COLLAPSING the wrappers that have a column.
 *
 * The collapse loop is what makes `int?[]` one row with `arrayRank = 1` and
 * `isNullableAnnotated = true` rather than three rows, two of which say nothing
 * a column does not already say.
 */
function describe(node: Parser.SyntaxNode): TypeShape | undefined {
  let current = node;
  let arrayRank = 0;
  let isNullableAnnotated = false;
  const completeTypeName = node.text;

  // Collapse the column-backed wrappers, innermost-last.
  for (;;) {
    if (current.type === 'nullable_type') {
      isNullableAnnotated = true;
      const inner = current.childForFieldName('type') ?? undefined;
      if (inner === undefined) {
        break;
      }
      current = inner;
      continue;
    }
    if (current.type === 'array_type') {
      const specifier = childOfType(current, 'array_rank_specifier');
      // `[,]` is rank 2, `[]` is rank 1: the rank is commas + 1.
      arrayRank +=
        specifier === undefined
          ? 1
          : specifier.text.split(',').length;
      const element = namedChildren(current).find(
        (c) => c.type !== 'array_rank_specifier'
      );
      if (element === undefined) {
        break;
      }
      current = element;
      continue;
    }
    break;
  }

  const base = (kind: CsTypeRefKind, typeName: string, children: Parser.SyntaxNode[]): TypeShape => ({
    kind: arrayRank > 0 ? CsTypeRefKind.ARRAY : kind,
    typeName,
    completeTypeName,
    arrayRank,
    isNullableAnnotated,
    children,
    anchor: current,
  });

  switch (current.type) {
    case 'predefined_type':
      return base(CsTypeRefKind.PREDEFINED, current.text, []);

    case 'identifier':
      // `dynamic` is spelled as a plain identifier. It is RESERVED elsewhere —
      // a call through it is a fact about a value's runtime identity, not its
      // syntax — but the TYPE reference is readable and is emitted.
      return current.text === 'dynamic'
        ? base(CsTypeRefKind.DYNAMIC, 'dynamic', [])
        : base(CsTypeRefKind.NAMED, current.text, []);

    case 'generic_name': {
      const name = childOfType(current, 'identifier')?.text ?? current.text;
      const args = childOfType(current, 'type_argument_list');
      return base(
        CsTypeRefKind.CONSTRUCTED,
        name,
        args === undefined ? [] : namedChildren(args)
      );
    }

    case 'qualified_name': {
      // `A.B.List<int>` — the ARITY and the type arguments live on the LAST
      // segment, and the name a using scope resolves is the whole dotted path.
      // Reading the outermost node for arity would report 0 for every qualified
      // generic, which is most of the BCL as it is actually written.
      const segments = namedChildren(current);
      const last = segments[segments.length - 1];
      if (last?.type === 'generic_name') {
        const args = childOfType(last, 'type_argument_list');
        return base(
          CsTypeRefKind.CONSTRUCTED,
          // The dotted path WITHOUT the arguments. `baseTypeName` is shared with
          // the heritage and member extractors so the three cannot drift — and
          // they had: one read arity off the last segment of a qualified name
          // and the others did not.
          baseTypeName(current.text),
          args === undefined ? [] : namedChildren(args)
        );
      }
      return base(CsTypeRefKind.NAMED, current.text, []);
    }

    case 'alias_qualified_name':
      return base(CsTypeRefKind.NAMED, current.text, []);

    case 'tuple_type': {
      // The elements are children because `tupleElementCount` alone would lose
      // their TYPES, and a tuple's identity is its element types in order.
      const elements = childrenOfType(current, 'tuple_element')
        // The `type` FIELD. `(string Name, int Age)` has a name too, and only
        // the grammar's ordering kept position 0 on the type.
        .map((element) => element.childForFieldName('type') ?? undefined)
        .filter((element): element is Parser.SyntaxNode => element !== undefined);
      return base(CsTypeRefKind.TUPLE, current.text, elements);
    }

    case 'pointer_type': {
      const pointee = current.childForFieldName('type') ?? undefined;
      return base(
        CsTypeRefKind.POINTER,
        pointee?.text ?? current.text,
        pointee === undefined ? [] : [pointee]
      );
    }

    case 'function_pointer_type':
      // `delegate*<int, void>` — a call target with no object. Its parameter and
      // return types are children.
      return base(CsTypeRefKind.FUNCTION_POINTER, current.text, namedChildren(current));

    case 'ref_type': {
      // An ALIAS is not the thing it aliases, and no column says so — hence a
      // wrapper. `ref int M()` returning an alias means `M() = 5` is a write.
      const referent = current.childForFieldName('type') ?? undefined;
      return base(
        CsTypeRefKind.REF,
        referent?.text ?? current.text,
        referent === undefined ? [] : [referent]
      );
    }

    case 'scoped_type': {
      const inner = current.childForFieldName('type') ?? undefined;
      return inner === undefined ? undefined : describe(inner);
    }

    case 'implicit_type':
      // `var`. A declared type that names nothing: the type is whatever the
      // initialiser produces, which is a resolution outcome and the engine's.
      return base(CsTypeRefKind.NAMED, 'var', []);

    default:
      // NOT a generic fallback. An unrecognised node in a type position emits
      // nothing, because a generic walk here is how type-only constructs reach
      // the call graph.
      return undefined;
  }
}
