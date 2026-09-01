import * as ts from 'typescript';
import { nodeId } from '@/parsers/typescript/extractors/ts-binder';

import { TsTypeReferenceRegistry } from '@/analysis-types/typescript/TsTypeReferenceRegistry';
import { TS_TYPE_REFERENCE_MAX_DEPTH } from '@/constants/typescript-constants';
import { TsTypeParameterOwnerKind } from '@/enums/typescript/type-parameters';
import {
  TsReferenceOwnerKind,
  TsTypeRefContext,
  TsTypeRefKind,
  TsWildcardVariance,
} from '@/enums/typescript/type-references';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Builds the `ts_type_reference` tree from a type node — schema §4.5.
 *
 * ## Why a tree and not a string
 *
 * `A | B | C` becomes one parent row with `childCount = 3` and three child rows,
 * each carrying `position` and `parentReferenceHash`. The measurement settled
 * this against the comma-set alternative three times over: the maximum union
 * arity in real declaration files is **208**, members are arbitrary nested type
 * nodes rather than names, and 45 nodes contain a nested union or intersection.
 *
 * `position` is **source** order and `childCount` is **source** arity. The
 * checker normalises `boolean` into `true | false` and reorders members by type
 * id, so `string | number | boolean` has source order `[string, number,
 * boolean]` and checker order `[string, number, false, true]`. An oracle
 * comparing member-wise against the checker would fail on correct output; it
 * compares type-node trees instead.
 *
 * ## This is also a containment boundary
 *
 * Conditional, mapped, template-literal, `infer`, `keyof`, `typeof` and
 * indexed-access nodes — 10,436 measured — live here and in no other relation.
 * There is no path from any of them into `ts_expression`, so §3.3 holds
 * structurally rather than by a filter that has to be remembered.
 */
export interface TypeReferenceOwner {
  readonly ownerHash: string;
  readonly ownerKind: TsReferenceOwnerKind;
  readonly tsTypeLinkHash: string;
  readonly tsModuleLinkHash: string;
}

/** A planned child edge: the node and the context it occupies in its parent. */
interface PlannedChild {
  readonly node: ts.TypeNode;
  readonly context: TsTypeRefContext;
  readonly isOptionalElement?: boolean;
  readonly isRestElement?: boolean;
}

export class TsTypeReferenceExtractor {
  private readonly rows: TsTypeReferenceRegistry[] = [];

  /**
   * Called for every `FunctionType` / `ConstructorType` node encountered.
   *
   * A function type is BOTH a node in the type graph and a callable signature.
   * It stays in this relation as a type node, and the declaration extractor
   * mints a `ts_method` row for it so a call site can point at it — because tsc
   * resolves `const f: (x: T) => R = (x) => …; f(x)` to the SIGNATURE, not to
   * the arrow. A parser that offers only the arrow disagrees with
   * `getResolvedSignature` on every such call.
   */
  onFunctionType:
    | ((
        node: ts.FunctionTypeNode | ts.ConstructorTypeNode,
        /**
         * This node's OWN `ts_type_reference` hash — the signature's owner.
         *
         * A function type node is the only thing that can own a
         * `FUNCTION_TYPE_SIGNATURE`, so the owner FK is the node itself rather
         * than any enclosing declaration (§4.8.1).
         */
        selfReferenceHash: string
      ) => void)
    | undefined;

  /**
   * Called for every type parameter a TYPE-LEVEL construct declares.
   *
   * `[K in keyof T]` and `infer U` declare real parameters with real scopes and
   * have no Java analogue, so no declaration walk reaches them — they live
   * inside type nodes. 1,337 `infer` and 605 mapped types measured, so this is
   * not a corner: without the hook, 1,942 declarations have no row.
   */
  /**
   * Called for every MEMBER of an anonymous type literal.
   *
   * `{ toCsv(): string }` declares a method that is a real call target — `r.toCsv()`
   * resolves to it — and a type literal has no `ts_type` row for the member to
   * hang off, so nothing else in the walk reaches it. Measured on this
   * repository: 1,052 of 20,313 declaration-bearing nodes had no row, and every
   * one of them was a type-literal member or a parameter of one.
   *
   * Fired from here rather than from the declaration walk because a type literal
   * can be written anywhere a type can — an annotation, a type alias RHS, a
   * union member, a type argument — and this is the only traversal that visits
   * all of those.
   */
  onTypeLiteralMember:
    | ((member: ts.TypeElement, typeLiteralReferenceHash: string) => void)
    | undefined;

  onTypeLevelParameter:
    | ((
        typeParameter: ts.TypeParameterDeclaration,
        ownerHash: string,
        ownerKind: TsTypeParameterOwnerKind
      ) => void)
    | undefined;

  constructor(
    private readonly sourceFile: ts.SourceFile,
    private readonly serviceVersionLinkHash: string,
    /** Type-parameter names in lexical scope, so `T` is a TYPE_VARIABLE and not a TYPE_REFERENCE. */
    private readonly typeParametersInScope: () => ReadonlySet<string>,
    /** The declaration a type-variable name refers to, innermost scope first. */
    private readonly typeParameterDeclarationFor:
      (name: string) => ts.TypeParameterDeclaration | undefined = () => undefined
  ) {}

  /**
   * Type-variable references awaiting their declaration's hash.
   *
   * Linked after the walk, because a reference can precede the row for the
   * parameter it names -- `B extends A` mentions `A` while both are still being
   * emitted -- and a link made too early would silently be empty for exactly
   * the shadowing cases that matter.
   */
  readonly pendingTypeVariableLinks:
    { row: TsTypeReferenceRegistry; declaration: ts.TypeParameterDeclaration }[] = [];

  getRows(): readonly TsTypeReferenceRegistry[] {
    return this.rows;
  }

  /**
   * The row emitted for a type NODE, by node identity.
   *
   * A signature declared inside a type -- a call signature, a function type, a
   * type-literal method -- does not create its own return reference: the
   * reference is emitted as part of the ENCLOSING type's tree, at depth 1. The
   * signature row therefore has nothing to link to unless the row that was
   * already emitted can be found again, which is what this is for.
   */
  hashForTypeNode(node: ts.TypeNode): string {
    return this.hashByTypeNode.get(nodeId(node, this.sourceFile)) ?? '';
  }

  private readonly hashByTypeNode = new Map<string, string>();

  /**
   * Emits the whole tree rooted at `node` and returns the ROOT row's hash.
   *
   * The root always has `depth = 0` and an empty `parentReferenceHash`, which is
   * invariant 7 and which `type-hierarchy.dl` depends on in Java.
   */
  extract(
    node: ts.TypeNode,
    context: TsTypeRefContext,
    owner: TypeReferenceOwner,
    isTypeOnlyPosition = true
  ): string {
    return this.emit(node, context, owner, '', 0, 0, isTypeOnlyPosition, {});
  }

  private emit(
    node: ts.TypeNode,
    context: TsTypeRefContext,
    owner: TypeReferenceOwner,
    parentReferenceHash: string,
    position: number,
    depth: number,
    isTypeOnlyPosition: boolean,
    flags: { isOptionalElement?: boolean; isRestElement?: boolean }
  ): string {
    const start = node.getStart(this.sourceFile);
    const startPos = this.sourceFile.getLineAndCharacterOfPosition(start);
    const endPos = this.sourceFile.getLineAndCharacterOfPosition(node.end);
    const children = plannedChildren(node);
    // The depth cap is 32 (OQ-5), and the measured maximum in 25.9 MB of real
    // TypeScript is 19 — so this never fires on anything observed. It stays
    // because a cap that can never fire is a cap nobody maintains, and when it
    // does fire the row says so instead of losing a subtree silently.
    const isTruncated = depth >= TS_TYPE_REFERENCE_MAX_DEPTH && children.length > 0;

    const row = new TsTypeReferenceRegistry({
      kind: kindOf(node, this.typeParametersInScope()),
      context,
      tsTypeLinkHash: owner.tsTypeLinkHash,
      parentReferenceHash,
      position,
      depth,
      typeName: simpleNameOf(node),
      completeTypeName: EntityUtils.normalizeWhitespace(node.getText(this.sourceFile)),
      entityName: entityNameOf(node, this.sourceFile),
      typeVariableName: typeVariableNameOf(node, this.typeParametersInScope()),
      arrayDimensions: arrayDimensionsOf(node),
      wildcardVariance: varianceOf(node),
      startLine: startPos.line + 1,
      endLine: endPos.line + 1,
      typeReferenceOwnerHash: owner.ownerHash,
      referenceOwnerKind: owner.ownerKind,
      tsModuleLinkHash: owner.tsModuleLinkHash,
      // SOURCE arity, always, even when truncated — so a truncated row still
      // says how many children it should have had.
      childCount: children.length,
      isTypeOnlyPosition,
      importSpecifier: importSpecifierOf(node),
      isOptionalElement: flags.isOptionalElement === true,
      isRestElement: flags.isRestElement === true,
      literalValue: literalValueOf(node, this.sourceFile),
      isTruncated,
      startColumn: startPos.character + 1,
      serviceVersionLinkHash: this.serviceVersionLinkHash,
    });
    this.rows.push(row);
    // Keyed on the byte range, so the two nodes that share a start offset --
    // a type and the first type inside it -- do not collide.
    this.hashByTypeNode.set(nodeId(node, this.sourceFile), row.getHash());
    // A type-variable reference names the parameter that declares it. Recorded
    // for a back-patch rather than resolved here, because the row for that
    // parameter may not exist yet.
    if (ts.isTypeReferenceNode(node)
      && ts.isIdentifier(node.typeName)
      && this.typeParametersInScope().has(node.typeName.text)) {
      const declaration = this.typeParameterDeclarationFor(node.typeName.text);
      if (declaration !== undefined) {
        this.pendingTypeVariableLinks.push({ row, declaration });
      }
    }
    if (this.onFunctionType && (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node))) {
      this.onFunctionType(node, row.getHash());
    }
    if (this.onTypeLiteralMember && ts.isTypeLiteralNode(node)) {
      for (const member of node.members) {
        this.onTypeLiteralMember(member, row.getHash());
      }
    }
    if (this.onTypeLevelParameter) {
      if (ts.isMappedTypeNode(node)) {
        this.onTypeLevelParameter(node.typeParameter, row.getHash(),
          TsTypeParameterOwnerKind.MAPPED_TYPE);
      } else if (ts.isInferTypeNode(node)) {
        this.onTypeLevelParameter(node.typeParameter, row.getHash(),
          TsTypeParameterOwnerKind.INFER_TYPE);
      }
    }

    if (isTruncated) {
      return row.getHash();
    }
    let index = 0;
    for (const child of children) {
      this.emit(child.node, child.context, owner, row.getHash(), index, depth + 1,
        isTypeOnlyPosition, {
          isOptionalElement: child.isOptionalElement,
          isRestElement: child.isRestElement,
        });
      index += 1;
    }
    return row.getHash();
  }
}

/**
 * The children a type node contributes, in SOURCE order, each with the context
 * it occupies.
 *
 * Computed before the parent row is built, because `childCount` is a column on
 * the parent and invariant 6 checks it against the rows that actually point
 * back. Deriving it from the node rather than counting emitted rows keeps the
 * two from drifting when a branch is added below.
 */
function plannedChildren(node: ts.TypeNode): PlannedChild[] {
  const out: PlannedChild[] = [];
  const push = (child: ts.TypeNode | undefined, context: TsTypeRefContext,
                extra?: { isOptionalElement?: boolean; isRestElement?: boolean }): void => {
    if (child) {
      out.push({ node: child, context, ...extra });
    }
  };

  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    for (const member of node.types) {
      push(member, TsTypeRefContext.TYPE_ELEMENT);
    }
    return out;
  }
  if (ts.isArrayTypeNode(node)) {
    push(node.elementType, TsTypeRefContext.TYPE_ELEMENT);
    return out;
  }
  if (ts.isTupleTypeNode(node)) {
    for (const element of node.elements) {
      push(element, TsTypeRefContext.TYPE_ELEMENT);
    }
    return out;
  }
  if (ts.isNamedTupleMember(node)) {
    push(node.type, TsTypeRefContext.TYPE_ELEMENT, {
      isOptionalElement: node.questionToken !== undefined,
      isRestElement: node.dotDotDotToken !== undefined,
    });
    return out;
  }
  if (ts.isOptionalTypeNode(node)) {
    push(node.type, TsTypeRefContext.TYPE_ELEMENT, { isOptionalElement: true });
    return out;
  }
  if (ts.isRestTypeNode(node)) {
    push(node.type, TsTypeRefContext.TYPE_ELEMENT, { isRestElement: true });
    return out;
  }
  if (ts.isParenthesizedTypeNode(node) || ts.isTypeOperatorNode(node)) {
    push(node.type, TsTypeRefContext.TYPE_ELEMENT);
    return out;
  }
  if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
    for (const argument of node.typeArguments ?? []) {
      push(argument, TsTypeRefContext.TYPE_ARGUMENT);
    }
    return out;
  }
  if (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) {
    for (const parameter of node.parameters) {
      push(parameter.type, TsTypeRefContext.METHOD_PARAM, {
        isOptionalElement: parameter.questionToken !== undefined,
        isRestElement: parameter.dotDotDotToken !== undefined,
      });
    }
    push(node.type, TsTypeRefContext.METHOD_RETURN);
    return out;
  }
  if (ts.isConditionalTypeNode(node)) {
    push(node.checkType, TsTypeRefContext.CONDITIONAL_CHECK);
    push(node.extendsType, TsTypeRefContext.CONDITIONAL_EXTENDS);
    push(node.trueType, TsTypeRefContext.CONDITIONAL_TRUE);
    push(node.falseType, TsTypeRefContext.CONDITIONAL_FALSE);
    return out;
  }
  if (ts.isMappedTypeNode(node)) {
    push(node.typeParameter.constraint, TsTypeRefContext.MAPPED_CONSTRAINT);
    push(node.nameType, TsTypeRefContext.MAPPED_TEMPLATE);
    push(node.type, TsTypeRefContext.TYPE_ELEMENT);
    return out;
  }
  if (ts.isIndexedAccessTypeNode(node)) {
    push(node.objectType, TsTypeRefContext.TYPE_ELEMENT);
    push(node.indexType, TsTypeRefContext.TYPE_ELEMENT);
    return out;
  }
  if (ts.isTemplateLiteralTypeNode(node)) {
    for (const span of node.templateSpans) {
      push(span.type, TsTypeRefContext.TEMPLATE_SPAN);
    }
    return out;
  }
  if (ts.isTypePredicateNode(node)) {
    push(node.type, TsTypeRefContext.TYPE_PREDICATE_TARGET);
    return out;
  }
  if (ts.isImportTypeNode(node)) {
    for (const argument of node.typeArguments ?? []) {
      push(argument, TsTypeRefContext.TYPE_ARGUMENT);
    }
    return out;
  }
  if (ts.isInferTypeNode(node)) {
    push(node.typeParameter.constraint, TsTypeRefContext.TYPE_PARAM_BOUND);
    return out;
  }
  if (ts.isTypeLiteralNode(node)) {
    // An anonymous structural shape. Its members have no `ts_type` row of their
    // own — 5,015 type literals measured, none with a name, a declaration or a
    // merge identity — so each member's annotation hangs here as an element.
    for (const member of node.members) {
      const memberType = (member as { type?: ts.TypeNode }).type;
      push(memberType, contextForTypeElement(member), {
        isOptionalElement: (member as { questionToken?: ts.QuestionToken }).questionToken !== undefined,
      });
    }
    return out;
  }
  return out;
}

function contextForTypeElement(member: ts.TypeElement): TsTypeRefContext {
  if (ts.isMethodSignature(member) || ts.isCallSignatureDeclaration(member)
    || ts.isConstructSignatureDeclaration(member)) {
    return TsTypeRefContext.METHOD_RETURN;
  }
  if (ts.isIndexSignatureDeclaration(member)) {
    return TsTypeRefContext.INDEX_SIGNATURE_VALUE;
  }
  return TsTypeRefContext.FIELD_TYPE;
}

/** The primitive keyword type nodes. `PRIMITIVE` rather than `TYPE_REFERENCE`: they name no declaration. */
const PRIMITIVE_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AnyKeyword, ts.SyntaxKind.UnknownKeyword, ts.SyntaxKind.NumberKeyword,
  ts.SyntaxKind.BigIntKeyword, ts.SyntaxKind.ObjectKeyword, ts.SyntaxKind.BooleanKeyword,
  ts.SyntaxKind.StringKeyword, ts.SyntaxKind.SymbolKeyword, ts.SyntaxKind.VoidKeyword,
  ts.SyntaxKind.UndefinedKeyword, ts.SyntaxKind.NeverKeyword,
]);

function kindOf(node: ts.TypeNode, typeParameters: ReadonlySet<string>): TsTypeRefKind {
  if (PRIMITIVE_KINDS.has(node.kind)) {
    return TsTypeRefKind.PRIMITIVE;
  }
  if (node.kind === ts.SyntaxKind.IntrinsicKeyword) {
    return TsTypeRefKind.INTRINSIC;
  }
  if (ts.isLiteralTypeNode(node)) {
    // `null` is written as a literal type node but denotes a primitive, not a
    // literal member of some wider type.
    return node.literal.kind === ts.SyntaxKind.NullKeyword
      ? TsTypeRefKind.PRIMITIVE
      : TsTypeRefKind.LITERAL;
  }
  if (ts.isTypeReferenceNode(node)) {
    return ts.isIdentifier(node.typeName) && typeParameters.has(node.typeName.text)
      ? TsTypeRefKind.TYPE_VARIABLE
      : TsTypeRefKind.TYPE_REFERENCE;
  }
  if (ts.isExpressionWithTypeArguments(node)) {
    return TsTypeRefKind.TYPE_REFERENCE;
  }
  if (ts.isArrayTypeNode(node)) {
    return TsTypeRefKind.ARRAY;
  }
  if (ts.isTupleTypeNode(node)) {
    return TsTypeRefKind.TUPLE;
  }
  if (ts.isUnionTypeNode(node)) {
    return TsTypeRefKind.UNION;
  }
  if (ts.isIntersectionTypeNode(node)) {
    return TsTypeRefKind.INTERSECTION;
  }
  if (ts.isFunctionTypeNode(node)) {
    return TsTypeRefKind.FUNCTION_TYPE;
  }
  if (ts.isConstructorTypeNode(node)) {
    return TsTypeRefKind.CONSTRUCTOR_TYPE;
  }
  if (ts.isTypeLiteralNode(node)) {
    return TsTypeRefKind.TYPE_LITERAL;
  }
  if (ts.isConditionalTypeNode(node)) {
    return TsTypeRefKind.CONDITIONAL;
  }
  if (ts.isMappedTypeNode(node)) {
    return TsTypeRefKind.MAPPED;
  }
  if (ts.isTemplateLiteralTypeNode(node)) {
    return TsTypeRefKind.TEMPLATE_LITERAL;
  }
  if (ts.isIndexedAccessTypeNode(node)) {
    return TsTypeRefKind.INDEXED_ACCESS;
  }
  if (ts.isTypeQueryNode(node)) {
    return TsTypeRefKind.TYPE_QUERY;
  }
  if (ts.isTypeOperatorNode(node)) {
    return TsTypeRefKind.TYPE_OPERATOR;
  }
  if (ts.isInferTypeNode(node)) {
    return TsTypeRefKind.INFER;
  }
  if (ts.isTypePredicateNode(node)) {
    return TsTypeRefKind.TYPE_PREDICATE;
  }
  if (ts.isImportTypeNode(node)) {
    return TsTypeRefKind.IMPORT_TYPE;
  }
  if (ts.isThisTypeNode(node)) {
    return TsTypeRefKind.THIS_TYPE;
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return TsTypeRefKind.PARENTHESIZED;
  }
  if (ts.isRestTypeNode(node)) {
    return TsTypeRefKind.REST;
  }
  if (ts.isOptionalTypeNode(node)) {
    return TsTypeRefKind.OPTIONAL;
  }
  if (ts.isNamedTupleMember(node)) {
    return TsTypeRefKind.NAMED_TUPLE_MEMBER;
  }
  return TsTypeRefKind.TYPE_REFERENCE;
}

/** The rightmost identifier of a name-shaped type; `""` when the node names nothing. */
export function simpleNameOf(node: ts.TypeNode): string {
  if (ts.isTypeReferenceNode(node)) {
    return rightmostName(node.typeName);
  }
  if (ts.isExpressionWithTypeArguments(node)) {
    return rightmostExpressionName(node.expression);
  }
  if (ts.isTypeQueryNode(node)) {
    return rightmostName(node.exprName);
  }
  if (ts.isImportTypeNode(node) && node.qualifier) {
    return rightmostName(node.qualifier);
  }
  if (ts.isNamedTupleMember(node)) {
    return node.name.text;
  }
  if (PRIMITIVE_KINDS.has(node.kind)) {
    return ts.tokenToString(node.kind) ?? '';
  }
  return '';
}

/** The full dotted path of a name-shaped type; `""` otherwise. */
export function qualifiedPathOf(node: ts.TypeNode, sourceFile: ts.SourceFile): string {
  if (ts.isTypeReferenceNode(node)) {
    return node.typeName.getText(sourceFile);
  }
  if (ts.isExpressionWithTypeArguments(node)) {
    return ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression)
      ? node.expression.getText(sourceFile)
      : '';
  }
  return '';
}

function rightmostName(name: ts.EntityName): string {
  return ts.isIdentifier(name) ? name.text : name.right.text;
}

function rightmostExpressionName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return '';
}

function typeVariableNameOf(node: ts.TypeNode, typeParameters: ReadonlySet<string>): string {
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)
    && typeParameters.has(node.typeName.text)) {
    return node.typeName.text;
  }
  if (ts.isInferTypeNode(node)) {
    return node.typeParameter.name.text;
  }
  return '';
}

/** `T[][]` records `[][]`; anything else records nothing. */
function arrayDimensionsOf(node: ts.TypeNode): string {
  let dimensions = '';
  let current: ts.TypeNode = node;
  while (ts.isArrayTypeNode(current)) {
    dimensions += '[]';
    current = current.elementType;
  }
  return dimensions;
}

/**
 * Java's `wildcardVariance` slot, repurposed.
 *
 * TypeScript has no use-site wildcards, so the slot carries the operators that
 * modify a type in place: `readonly T[]` and `unique symbol`. Same position,
 * different language — which is the cross-language naming rule working as
 * intended rather than false parity.
 */
function varianceOf(node: ts.TypeNode): string {
  if (!ts.isTypeOperatorNode(node)) {
    return '';
  }
  if (node.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return TsWildcardVariance.READONLY;
  }
  if (node.operator === ts.SyntaxKind.UniqueKeyword) {
    return TsWildcardVariance.UNIQUE;
  }
  return '';
}

/**
 * The name a reference writes, WITHOUT its type arguments.
 *
 * `typeName` is only the rightmost segment (`Node`) and `completeTypeName`
 * carries the arguments (`Outer.Inner.Node<T>`), so neither is the qualified
 * name a scope lookup needs. The AST holds it directly: a TypeReferenceNode's
 * `typeName` is an EntityName and its `typeArguments` are a separate property,
 * so this is a read rather than a derivation.
 *
 * Deriving it downstream means finding the first "<" by hand, and the obvious
 * shortcut -- treating `typeName == completeTypeName` as the
 * qualified/unqualified test -- misfiles every generic reference, because
 * `Map<string, User>` differs from `Map` for a reason that has nothing to do
 * with qualification.
 */
function entityNameOf(node: ts.TypeNode, sourceFile: ts.SourceFile): string {
  if (ts.isTypeReferenceNode(node)) {
    return EntityUtils.normalizeWhitespace(node.typeName.getText(sourceFile));
  }
  if (ts.isExpressionWithTypeArguments(node)) {
    return EntityUtils.normalizeWhitespace(node.expression.getText(sourceFile));
  }
  // An import type writes its entity after the specifier: `import("m").T`.
  if (ts.isImportTypeNode(node)) {
    if (node.qualifier !== undefined) {
      return EntityUtils.normalizeWhitespace(node.qualifier.getText(sourceFile));
    }
    // `typeof import("m")["x"]` says the same thing with brackets, and puts the
    // member on the INDEXED ACCESS above instead of on a qualifier. Reading only
    // the qualifier names the module and not the member -- the half that a scope
    // lookup actually needs -- and leaves the bracket form to string arithmetic.
    const parent = node.parent;
    if (parent !== undefined
      && ts.isIndexedAccessTypeNode(parent)
      && parent.objectType === node
      && ts.isLiteralTypeNode(parent.indexType)
      && ts.isStringLiteral(parent.indexType.literal)) {
      return parent.indexType.literal.text;
    }
  }
  return '';
}

function importSpecifierOf(node: ts.TypeNode): string {
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
    && ts.isStringLiteral(node.argument.literal)) {
    return node.argument.literal.text;
  }
  return '';
}

function literalValueOf(node: ts.TypeNode, sourceFile: ts.SourceFile): string {
  if (!ts.isLiteralTypeNode(node) || node.literal.kind === ts.SyntaxKind.NullKeyword) {
    return '';
  }
  return EntityUtils.normalizeWhitespace(node.literal.getText(sourceFile));
}
