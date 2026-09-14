import * as ts from 'typescript';

import { JS_TYPE_REFERENCE_MAX_DEPTH } from '@/constants/javascript-constants';
import { JsCommentRegistry } from '@/analysis-types/javascript/JsCommentRegistry';
import { JsTypeReferenceRegistry } from
  '@/analysis-types/javascript/JsTypeReferenceRegistry';
import {
  JsTypeReferenceContextKind,
  JsTypeReferenceKind,
  JsTypeReferenceOwnerKind,
} from '@/enums/javascript/type-references';
import {
  jsDocHostsOf, jsDocParameterTagFor, jsDocTagsOfAllBlocks, pointOf,
} from '@/utils/javascript';

/**
 * `js_type_reference` — the JavaScript type system in its entirety, parsed out
 * of comments.
 *
 * ## JSDoc is a type annotation, not a comment feature
 *
 * | channel | share of parameters |
 * |---|---|
 * | nothing | 62.1% |
 * | **JSDoc** | **37.9%** |
 * | syntactic annotation | 0% in the replication corpus; 64 reported and retracted |
 *
 * The compiler parses `@param`, `@returns`, `@type`, `@typedef`, `@template`,
 * `@extends` and `@implements` into `node.jsDoc` and **uses them for inference
 * under `checkJs`**. `ts-comment-extractor.ts` extracts tag *names*; that is a
 * starting point and not the thing. What this file does is read the type
 * EXPRESSIONS the tags carry, as a tree.
 *
 * ## A tree, not a string
 *
 * `Array<Object<string, number>>` is **three rows** with parent FKs, depth and
 * child index — the same shape `ts_type_reference` uses. A consumer that has to
 * re-parse a string to find a generic argument is one that will get it wrong on
 * the first nested union.
 *
 * ## Every row is type-only, and the gate asserts it
 *
 * `isTypeOnly` is `true` in every row here. **No call-graph rule may traverse
 * this relation**, and `@callback` — which names a callable shape — is exactly
 * the row most likely to be mistaken for a call target. It is not one.
 *
 * ## `UNKNOWN_SYNTAX` is deliberate and expected to be non-empty
 *
 * JSDoc type syntax is not standardised; Closure, TypeScript and jsdoc.app all
 * differ on `!T`, on `Object<K,V>`, on `function(this:T, …)`. A type expression
 * this cannot decompose gets **one row with its text preserved**, rather than a
 * guess or a dropped tag. Guessing puts a plausible wrong type into the fact
 * base; dropping loses the only declared-type channel the language has.
 */
export interface JsDocExtractionOptions {
  readonly sourceFile: ts.SourceFile;
  readonly moduleHash: string;
  readonly serviceVersionLinkHash: string;
  /** Comment row by start offset, so a row can cite the comment it came from. */
  readonly commentByStart: ReadonlyMap<number, JsCommentRegistry>;
}

/** One owner asking for the types its JSDoc declares. */
/** An IMPORT_TYPE row and the node it was read from — the fact extractor mints its js_import row. */
export interface JsDocImportType {
  readonly row: JsTypeReferenceRegistry;
  readonly node: ts.ImportTypeNode;
}

export interface JsDocOwner {
  readonly node: ts.Node;
  readonly ownerKind: JsTypeReferenceOwnerKind;
  readonly ownerHash: string;
  /** For a parameter, the name it binds, so the right `@param` is chosen. */
  readonly parameterName?: string;
}

export class JsDocExtractor {
  readonly typeReferences: JsTypeReferenceRegistry[] = [];
  /** Every IMPORT_TYPE row with its node, in emission order. */
  readonly importTypeNodes: JsDocImportType[] = [];

  private readonly options: JsDocExtractionOptions;
  private readonly sourceFile: ts.SourceFile;
  /** Template tags already emitted, so a shared block cannot emit one twice. */
  private readonly emittedTemplateTags = new Set<ts.Node>();

  constructor(options: JsDocExtractionOptions) {
    this.options = options;
    this.sourceFile = options.sourceFile;
  }

  /**
   * The declared type of a method's return, from `@returns`.
   *
   * Returns the root row and the name as written, so the caller can fill both
   * `returnTypeName` and `returnTypeReferenceLinkHash` — the string for a
   * consumer that wants one hop, the tree for a consumer that wants the shape.
   */
  returnTypeOf(owner: JsDocOwner): { name: string; root: JsTypeReferenceRegistry } | undefined {
    const tag = ts.getJSDocReturnTag(owner.node);
    const type = tag?.typeExpression?.type;
    if (tag === undefined || type === undefined) {
      return undefined;
    }
    return this.emitTree(type, owner, JsTypeReferenceContextKind.RETURN,
      tagNameOf(tag));
  }

  /**
   * The declared type of `this`, from `@this {T}`.
   *
   * ## The only channel that can state a receiver's type, and it was dropped
   *
   * `@param` and `@returns` on the SAME function emitted their trees; `@this`
   * emitted nothing — no row, no gap. `JsTypeReferenceContextKind.THIS` was 0.
   *
   * Its row count will be small and its value is not its row count. In the
   * prototype-era CommonJS stratum an untyped `this` is **6.5% of all oracle
   * declines** — 3,653 calls on shipped source that tsc cannot resolve — for
   * exactly the reason the enum records: nothing declares the receiver. `@this`
   * is the one construct in JavaScript that can, and the parser was throwing it
   * away.
   */
  thisTypeOf(owner: JsDocOwner): { name: string; root: JsTypeReferenceRegistry } | undefined {
    for (const tag of jsDocTagsOfAllBlocks(owner.node)) {
      if (tag.kind !== ts.SyntaxKind.JSDocThisTag) {
        continue;
      }
      const type = (tag as ts.JSDocThisTag).typeExpression?.type;
      if (type === undefined) {
        continue;
      }
      return this.emitTree(type, owner, JsTypeReferenceContextKind.THIS,
        tagNameOf(tag));
    }
    return undefined;
  }

  /**
   * Every `@throws {T}` / `@exception {T}` on a callable, one tree each.
   *
   * A function may document several, and each is its own row under THROWS —
   * the closest JavaScript comes to a throws clause. Read from all attached
   * blocks and from the statement that carries the callable, as `@param` is.
   */
  throwsTypesOf(owner: JsDocOwner): JsTypeReferenceRegistry[] {
    const out: JsTypeReferenceRegistry[] = [];
    for (const host of jsDocHostsOf(owner.node)) {
      for (const tag of jsDocTagsOfAllBlocks(host)) {
        if (tag.kind !== ts.SyntaxKind.JSDocThrowsTag) {
          continue;
        }
        const type = (tag as ts.JSDocThrowsTag).typeExpression?.type;
        if (type === undefined) {
          continue;
        }
        const emitted = this.emitTree(type, owner, JsTypeReferenceContextKind.THROWS,
          tagNameOf(tag));
        if (emitted !== undefined) {
          out.push(emitted.root);
        }
      }
    }
    return out;
  }

  /** The declared type of a parameter, from the matching `@param {T} name`. */
  parameterTypeOf(
    owner: JsDocOwner
  ): { name: string; root: JsTypeReferenceRegistry } | undefined {
    // NO NAME GUARD. It used to return early for a parameter with no name of
    // its own, because the old fallback matched tags BY name and had nothing to
    // match on. The shared selection falls back to POSITION, which is exactly
    // what a destructured parameter needs — and the guard, left in place,
    // produced the last 246 of the disagreement: a `declaredTypeName` from the
    // name path and no tree from this one, on every
    // `apply(dep, source, { module, runtimeTemplate })` in one bundler's own source.
    //
    // ONE selection, shared with the path that fills `declaredTypeName`. The
    // two had separate implementations and disagreed 300 times over the corpus —
    // a name with no tree is an internally inconsistent pair, and it is the kind
    // nothing reports because both halves look fine alone.
    const tag = ts.isParameter(owner.node)
      ? jsDocParameterTagFor(owner.node)
      : undefined;
    const type = tag?.typeExpression?.type;
    if (tag === undefined || type === undefined) {
      return undefined;
    }
    // PARAM either way (§3.14.3): the POSITION decides the context kind, the tag
    // only decides the tagName column — `type` for a block on the parameter
    // node itself, `param` for the function's tag.
    return this.emitTree(type, owner, JsTypeReferenceContextKind.PARAM, tagNameOf(tag));
  }

  /** The declared type of a variable or field, from `@type {T}`. */
  declaredTypeOf(
    owner: JsDocOwner,
    context: JsTypeReferenceContextKind
  ): { name: string; root: JsTypeReferenceRegistry } | undefined {
    const tag = ts.getJSDocTypeTag(owner.node);
    const type = tag?.typeExpression?.type;
    if (type === undefined) {
      return undefined;
    }
    return this.emitTree(type, owner, context, 'type');
  }

  /** The shape a `@typedef`/`@callback` declares. */
  typedefTypeOf(
    tag: ts.JSDocTypedefTag | ts.JSDocCallbackTag,
    owner: JsDocOwner
  ): { name: string; root: JsTypeReferenceRegistry } | undefined {
    const expression = tag.typeExpression;
    if (expression === undefined) {
      return undefined;
    }
    // A `@callback`'s type expression is a JSDocSignature — the compiler's
    // function type spelled as `@param` and `@returns` tags — and the signature
    // ITSELF is the root. Reading `.type` off it took the `@returns` TAG as the
    // root, so every callback in the corpus was one UNKNOWN_SYNTAX row named
    // with the raw tag text (`@returns {void}`) and its parameter types lost:
    // 59 of 59, and no gate said so, because a wrong kind is still one row.
    const type = ts.isJSDocTypeLiteral(expression) || ts.isJSDocSignature(expression)
      ? expression
      : expression.type;
    if (type === undefined) {
      return undefined;
    }
    return this.emitTree(type as ts.Node, owner, JsTypeReferenceContextKind.TYPEDEF,
      ts.isJSDocTypedefTag(tag) ? 'typedef' : 'callback');
  }

  /**
   * `@template T` — a type parameter, which has no relation of its own here.
   *
   * DEDUPED BY TAG. One comment block can declare two `@typedef`s and one
   * `@template`, and the block is reached once per typedef — so the template
   * came out twice, with different owners, which meant no primary key collided
   * and nothing reported it. Measured against ground truth: 20 parameters in the
   * corpus, 26 rows emitted. The count is the only thing that showed it.
   */
  templatesOf(owner: JsDocOwner): void {
    for (const tag of jsDocTagsOfAllBlocks(owner.node)) {
      if (!ts.isJSDocTemplateTag(tag) || this.emittedTemplateTags.has(tag)) {
        continue;
      }
      this.emittedTemplateTags.add(tag);
      for (const parameter of tag.typeParameters) {
        // 624 measured, and the schema's ruling is that a separate relation
        // for that many comment-borne rows is not worth a table. Recorded here
        // so the departure from `ts_type_parameter` reads as a decision.
        this.emitNamedRow(parameter.name.text, owner,
          JsTypeReferenceContextKind.TEMPLATE, 'template', parameter);
      }
    }
  }

  /** `@extends {T}` / `@implements {T}` — heritage asserted in a comment. */
  heritageOf(owner: JsDocOwner): { name: string; kind: JsTypeReferenceContextKind }[] {
    const out: { name: string; kind: JsTypeReferenceContextKind }[] = [];
    for (const tag of jsDocTagsOfAllBlocks(owner.node)) {
      const isExtends = ts.isJSDocAugmentsTag(tag);
      const isImplements = ts.isJSDocImplementsTag(tag);
      if (!isExtends && !isImplements) {
        continue;
      }
      const context = isExtends
        ? JsTypeReferenceContextKind.EXTENDS
        // JavaScript has no `implements`, so a comment is the ONLY route by
        // which a file can state one.
        : JsTypeReferenceContextKind.IMPLEMENTS;
      const expression = (tag as ts.JSDocAugmentsTag | ts.JSDocImplementsTag).class;
      const result = this.emitTree(expression, owner, context,
        isExtends ? 'extends' : 'implements');
      if (result !== undefined) {
        out.push({ name: result.name, kind: context });
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------

  private emitNamedRow(
    typeName: string,
    owner: JsDocOwner,
    context: JsTypeReferenceContextKind,
    tagName: string,
    node: ts.Node
  ): JsTypeReferenceRegistry {
    return this.mint({
      typeName,
      referenceKind: JsTypeReferenceKind.NAMED,
      parentHash: '',
      depth: 0,
      childIndex: 0,
      owner,
      context,
      tagName,
      node,
    });
  }

  /**
   * Emits a whole type expression as a tree, returning its root.
   *
   * Depth-capped at 32, with `isTruncated` on the parent rather than a subtree
   * silently vanishing — a cap that can never fire is a cap nobody maintains.
   */
  private emitTree(
    node: ts.Node,
    owner: JsDocOwner,
    context: JsTypeReferenceContextKind,
    tagName: string
  ): { name: string; root: JsTypeReferenceRegistry } | undefined {
    const unwrapped = unwrapParenthesizedType(node);
    const root = this.emitNode(node, owner, context, tagName, '', 0, 0);
    if (root === undefined) {
      return undefined;
    }
    return { name: nameOfType(unwrapped, this.sourceFile), root };
  }

  private emitNode(
    node: ts.Node,
    owner: JsDocOwner,
    context: JsTypeReferenceContextKind,
    tagName: string,
    parentHash: string,
    depth: number,
    childIndex: number
  ): JsTypeReferenceRegistry | undefined {
    if (depth > JS_TYPE_REFERENCE_MAX_DEPTH) {
      return undefined;
    }
    // Classified and named from the UNWRAPPED node; POSITIONED at the node as
    // written, parentheses included. `@param {(A|B)} x` is a union whose row
    // begins at the `(` — where the type expression starts, and where a
    // position join from the tag lands. Positioned at the inner node, 17 such
    // rows read as missing to a join keyed on the tag.
    const written = node;
    node = unwrapParenthesizedType(node);
    const kind = referenceKindOf(node);
    const row = this.mint({
      typeName: nameOfType(node, this.sourceFile),
      referenceKind: kind,
      parentHash,
      depth,
      childIndex,
      owner,
      context,
      tagName,
      node: written,
    });
    const children = childTypesOf(node);
    let emitted = 0;
    for (let i = 0; i < children.length; i += 1) {
      const child = this.emitNode(children[i]!, owner, context, tagName,
        row.getHash(), depth + 1, i);
      if (child === undefined) {
        row.setIsTruncated();
        continue;
      }
      emitted += 1;
    }
    row.setChildCount(emitted);
    return row;
  }

  private mint(init: {
    typeName: string;
    referenceKind: JsTypeReferenceKind;
    parentHash: string;
    depth: number;
    childIndex: number;
    owner: JsDocOwner;
    context: JsTypeReferenceContextKind;
    tagName: string;
    node: ts.Node;
  }): JsTypeReferenceRegistry {
    const at = pointOf(init.node, this.sourceFile);
    const row = new JsTypeReferenceRegistry({
      typeName: init.typeName,
      referenceKind: init.referenceKind,
      parentReferenceLinkHash: init.parentHash,
      depth: init.depth,
      childIndex: init.childIndex,
      contextKind: init.context,
      tagName: init.tagName,
      ownerKind: init.owner.ownerKind,
      ownerLinkHash: init.owner.ownerHash,
      // ALWAYS true. Every row here is type-only, and no call-graph rule may
      // traverse this relation — the gate asserts it in every row.
      isTypeOnly: true,
      isBuiltinType: BUILTIN_TYPE_NAMES.has(init.typeName),
      commentLinkHash: this.commentHashFor(init.node),
      ownerModuleLinkHash: this.options.moduleHash,
      startLine: at.startLine,
      startColumn: at.startColumn,
      serviceVersionLinkHash: this.options.serviceVersionLinkHash,
    });
    this.typeReferences.push(row);
    if (ts.isImportTypeNode(init.node)) {
      this.importTypeNodes.push({ row, node: init.node });
    }
    return row;
  }

  /**
   * The comment a JSDoc type node was read out of.
   *
   * Walks up to the enclosing `JSDoc` node and looks it up by start offset,
   * which is the same key the comment scan used. The two relations therefore
   * agree about which comment a type came from, rather than each computing its
   * own answer.
   */
  private commentHashFor(node: ts.Node): string {
    let current: ts.Node | undefined = node;
    while (current !== undefined) {
      if (current.kind === ts.SyntaxKind.JSDoc) {
        return this.options.commentByStart.get(current.pos)?.getHash() ?? '';
      }
      current = current.parent;
    }
    return '';
  }
}

/**
 * Which JSDoc type form this node is.
 *
 * `UNKNOWN_SYNTAX` is the honest terminal, not a failure: JSDoc type syntax is
 * not standardised, and a node this does not recognise keeps its text rather
 * than being guessed at or dropped.
 */
function referenceKindOf(node: ts.Node): JsTypeReferenceKind {
  if (ts.isTypeReferenceNode(node)) {
    return node.typeArguments !== undefined && node.typeArguments.length > 0
      ? JsTypeReferenceKind.GENERIC_APPLICATION
      : JsTypeReferenceKind.NAMED;
  }
  if (ts.isUnionTypeNode(node)) {
    return JsTypeReferenceKind.UNION;
  }
  if (ts.isIntersectionTypeNode(node)) {
    return JsTypeReferenceKind.INTERSECTION;
  }
  if (ts.isArrayTypeNode(node)) {
    return JsTypeReferenceKind.ARRAY;
  }
  if (ts.isFunctionTypeNode(node) || ts.isJSDocFunctionType(node)) {
    // A callable SHAPE, and the row most likely to be mistaken for a call
    // target. `isTypeOnly` is true and the gate asserts no call site reaches it.
    return JsTypeReferenceKind.FUNCTION_TYPE;
  }
  if (ts.isJSDocSignature(node) || ts.isConstructorTypeNode(node)) {
    // `@callback` spells its function type as tags; `new (…) => T` is the
    // constructor form of the same shape. Parameters and return are children.
    return JsTypeReferenceKind.FUNCTION_TYPE;
  }
  if (ts.isExpressionWithTypeArguments(node)) {
    // `@extends {Base}` / `@implements {I}` — the compiler parses the operand as
    // a heritage expression, not a type reference. It named itself correctly
    // and was classified UNKNOWN_SYNTAX on every one of 173 tags, its type
    // arguments never enqueued.
    return node.typeArguments !== undefined && node.typeArguments.length > 0
      ? JsTypeReferenceKind.GENERIC_APPLICATION
      : JsTypeReferenceKind.NAMED;
  }
  if (ts.isTypeLiteralNode(node) || ts.isJSDocTypeLiteral(node)) {
    return JsTypeReferenceKind.OBJECT_TYPE;
  }
  // The five kinds ruled in §3.14.4, each a node the compiler already
  // distinguishes. 3,718 import types and ~180 of the others had sat under
  // UNKNOWN_SYNTAX with plausible text — decidable shapes we declined to decide.
  if (ts.isImportTypeNode(node)) {
    return JsTypeReferenceKind.IMPORT_TYPE;
  }
  if (ts.isTupleTypeNode(node)) {
    return JsTypeReferenceKind.TUPLE;
  }
  if (ts.isIndexedAccessTypeNode(node)) {
    return JsTypeReferenceKind.INDEXED_ACCESS;
  }
  if (ts.isTypeQueryNode(node)) {
    return JsTypeReferenceKind.TYPE_QUERY;
  }
  if (ts.isTypePredicateNode(node)) {
    return JsTypeReferenceKind.TYPE_PREDICATE;
  }
  if (ts.isOptionalTypeNode(node)) {
    // `[a, b?]` — a tuple element's optionality, the written-TypeScript
    // spelling of the same fact JSDoc's `T=` records.
    return JsTypeReferenceKind.OPTIONAL;
  }
  if (ts.isRestTypeNode(node)) {
    return JsTypeReferenceKind.REST;
  }
  if (ts.isLiteralTypeNode(node)) {
    return JsTypeReferenceKind.TYPE_LITERAL;
  }
  if (ts.isJSDocNullableType(node)) {
    return JsTypeReferenceKind.NULLABLE;
  }
  if (ts.isJSDocNonNullableType(node)) {
    return JsTypeReferenceKind.NON_NULLABLE;
  }
  if (ts.isJSDocOptionalType(node)) {
    return JsTypeReferenceKind.OPTIONAL;
  }
  if (ts.isJSDocVariadicType(node)) {
    return JsTypeReferenceKind.REST;
  }
  if (ts.isJSDocAllType(node) || ts.isJSDocUnknownType(node)
    || node.kind === ts.SyntaxKind.AnyKeyword) {
    return JsTypeReferenceKind.ANY;
  }
  if (isPrimitiveKeyword(node)) {
    return JsTypeReferenceKind.NAMED;
  }
  return JsTypeReferenceKind.UNKNOWN_SYNTAX;
}

function childTypesOf(node: ts.Node): ts.Node[] {
  if (ts.isTypeReferenceNode(node)) {
    return [...(node.typeArguments ?? [])];
  }
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    return [...node.types];
  }
  if (ts.isArrayTypeNode(node)) {
    return [node.elementType];
  }
  if (ts.isJSDocNullableType(node) || ts.isJSDocNonNullableType(node)
    || ts.isJSDocOptionalType(node) || ts.isJSDocVariadicType(node)) {
    return [node.type];
  }
  if (ts.isFunctionTypeNode(node) || ts.isJSDocFunctionType(node) || ts.isConstructorTypeNode(node)) {
    const parameters = node.parameters
      .map((parameter) => parameter.type)
      .filter((type): type is ts.TypeNode => type !== undefined);
    return node.type === undefined ? parameters : [...parameters, node.type];
  }
  if (ts.isJSDocSignature(node)) {
    // Parameters in tag order, then the return — the same order a written
    // function type's children take.
    const parameters = node.parameters
      .map((parameter) => parameter.typeExpression?.type)
      .filter((type): type is ts.TypeNode => type !== undefined);
    const returned = node.type?.typeExpression?.type;
    return returned === undefined ? parameters : [...parameters, returned];
  }
  if (ts.isExpressionWithTypeArguments(node)) {
    return [...(node.typeArguments ?? [])];
  }
  if (ts.isImportTypeNode(node) || ts.isTypeQueryNode(node)) {
    // The specifier of an import type is NOT a child: it is a `js_import` row
    // (§3.14.4), reached through importLinkHash. Type arguments are children.
    return [...(node.typeArguments ?? [])];
  }
  if (ts.isTupleTypeNode(node)) {
    return node.elements.map((element) => (ts.isNamedTupleMember(element) ? element.type : element));
  }
  if (ts.isIndexedAccessTypeNode(node)) {
    return [node.objectType, node.indexType];
  }
  if (ts.isTypePredicateNode(node)) {
    return node.type === undefined ? [] : [node.type];
  }
  if (ts.isOptionalTypeNode(node) || ts.isRestTypeNode(node)) {
    return [node.type];
  }
  if (ts.isTypeLiteralNode(node)) {
    return node.members
      .map((member) => (ts.isPropertySignature(member) ? member.type : undefined))
      .filter((type): type is ts.TypeNode => type !== undefined);
  }
  if (ts.isJSDocTypeLiteral(node)) {
    // `@typedef {Object} T` followed by `@property {string} name` lines: the
    // property types are the members, exactly as a written `{name: string}`'s
    // are above. The names ride on the tags and this relation has no column
    // for a member name in either spelling.
    return (node.jsDocPropertyTags ?? [])
      .map((tag) => tag.typeExpression?.type)
      .filter((type): type is ts.TypeNode => type !== undefined);
  }
  return [];
}

/**
 * The name as written, WITHOUT type arguments.
 *
 * `Array<string>` names `Array`, so a scope lookup needs no string surgery — the
 * argument is a child row. TypeScript learned this one the same way.
 */
function nameOfType(node: ts.Node, sourceFile: ts.SourceFile): string {
  if (ts.isTypeReferenceNode(node)) {
    return node.typeName.getText(sourceFile);
  }
  if (ts.isLiteralTypeNode(node)) {
    return node.literal.getText(sourceFile);
  }
  if (ts.isThisTypeNode(node)) {
    // A ThisType node is not a keyword token, so tokenToString has no name for it.
    return 'this';
  }
  if (isPrimitiveKeyword(node)) {
    return ts.tokenToString(node.kind) ?? '';
  }
  if (ts.isJSDocAllType(node)) {
    return '*';
  }
  if (ts.isArrayTypeNode(node)) {
    return 'Array';
  }
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)
    || ts.isTypeLiteralNode(node) || ts.isJSDocTypeLiteral(node)
    || ts.isFunctionTypeNode(node) || ts.isJSDocFunctionType(node)
    || ts.isJSDocSignature(node) || ts.isConstructorTypeNode(node)) {
    return '';
  }
  if (ts.isJSDocNullableType(node) || ts.isJSDocNonNullableType(node)
    || ts.isJSDocOptionalType(node) || ts.isJSDocVariadicType(node)) {
    return '';
  }
  if (ts.isExpressionWithTypeArguments(node)) {
    return node.expression.getText(sourceFile);
  }
  if (ts.isImportTypeNode(node)) {
    // The QUALIFIER — `Y` of `import("./x").Y`; `""` for a bare `import("./x")`,
    // which names the module itself. The specifier belongs to the import row.
    return node.qualifier?.getText(sourceFile) ?? '';
  }
  if (ts.isTypeQueryNode(node)) {
    return node.exprName.getText(sourceFile);
  }
  if (ts.isTypePredicateNode(node)) {
    return node.parameterName.getText(sourceFile);
  }
  if (ts.isTupleTypeNode(node) || ts.isIndexedAccessTypeNode(node)
    || ts.isOptionalTypeNode(node) || ts.isRestTypeNode(node)) {
    return '';
  }
  // UNKNOWN_SYNTAX keeps its text rather than being dropped or guessed at.
  return node.getText(sourceFile);
}

function isPrimitiveKeyword(node: ts.Node): boolean {
  return node.kind === ts.SyntaxKind.StringKeyword
    || node.kind === ts.SyntaxKind.NumberKeyword
    || node.kind === ts.SyntaxKind.BooleanKeyword
    || node.kind === ts.SyntaxKind.ObjectKeyword
    || node.kind === ts.SyntaxKind.VoidKeyword
    || node.kind === ts.SyntaxKind.UndefinedKeyword
    || node.kind === ts.SyntaxKind.NullKeyword
    || node.kind === ts.SyntaxKind.NeverKeyword
    || node.kind === ts.SyntaxKind.SymbolKeyword
    || node.kind === ts.SyntaxKind.BigIntKeyword
    || node.kind === ts.SyntaxKind.UnknownKeyword
    || ts.isThisTypeNode(node);
}

/**
 * `(A|null)` is `A|null`. Constraint 6: a tree rooted at a non-emitting node
 * dies before its children are enqueued — and a parenthesised type kept its
 * raw text as one UNKNOWN_SYNTAX row while the union inside it, the only
 * thing the parentheses were written for, was never reached. Unwrapped at the
 * root and at every child, in this one place.
 */
function unwrapParenthesizedType(node: ts.Node): ts.Node {
  let current = node;
  while (ts.isParenthesizedTypeNode(current)) {
    current = current.type;
  }
  return current;
}

function tagNameOf(tag: ts.JSDocTag): string {
  return tag.tagName.text;
}

/** Names that need no declaration to resolve. Feeds `isBuiltinType`. */
const BUILTIN_TYPE_NAMES: ReadonlySet<string> = new Set([
  'string', 'number', 'boolean', 'object', 'symbol', 'bigint', 'undefined',
  'null', 'void', 'never', 'any', 'unknown', '*',
  'Array', 'Object', 'Function', 'Date', 'RegExp', 'Error', 'Promise', 'Map',
  'Set', 'WeakMap', 'WeakSet', 'Symbol', 'String', 'Number', 'Boolean',
  'ArrayBuffer', 'Buffer', 'Iterable', 'Iterator', 'AsyncIterable',
]);
