import Parser from 'tree-sitter';

import { PyTypeReferenceRegistry } from '@/analysis-types/python';
import {
  PythonTypeRefContext,
  PythonTypeRefKind,
  PythonTypeRefOwnerKind,
  PythonWildcardVariance,
} from '@/enums/python/type-references';
import { EntityUtils } from '@/utils/entity-utils';

/** A `X = TypeVar("X", ...)` declaration: its variance, and its bound if it has one. */
interface TypeVariableDeclaration {
  variance: string;
  bound: Parser.SyntaxNode | null;
}

/** One type position to walk: a node plus who owns it and in what role. */
export interface TypePositionInput {
  node: Parser.SyntaxNode;
  context: PythonTypeRefContext;
  ownerHash: string;
  ownerKind: PythonTypeRefOwnerKind;
  /** Enclosing class, or `''`. */
  enclosingTypeHash: string;
  /** The scope the annotation is evaluated in. */
  scopeHash: string;
}

/**
 * Everything needed to recover the type positions that live inside
 * EXPRESSIONS rather than declarations.
 */
export interface NarrowingInput {
  rootNode: Parser.SyntaxNode;
  /** `start:end` byte range -> py_expression hash, as the expression stage mints it. */
  expressionByByteRange: Map<string, string>;
  /** py_expression hash -> its scope and enclosing type, for the owning row. */
  scopeByExpressionHash: Map<string, string>;
  typeByExpressionHash: Map<string, string>;
  /** py_expression hash -> the binding it resolves to, where it resolves to one. */
  bindingByExpressionHash: Map<string, string>;
}

export interface TypeReferenceInput {
  positions: TypePositionInput[];
  /** The module root, scanned once for `X = TypeVar("X")` declarations. */
  rootNode: Parser.SyntaxNode;
  /** `scopeHash::name` -> binding hash. A TypeVar's bound is owned by its BINDING. */
  bindingHashByScopeAndName: Map<string, string>;
  /** The module scope, where a TypeVar is conventionally declared. */
  moduleScopeHash: string;
  pyModuleLinkHash: string;
  serviceVersionLinkHash: string;
}

/** `Optional[X]` admits None; `Union[..., None]` does too. */
const OPTIONAL_NAMES: ReadonlySet<string> = new Set(['Optional']);
const UNION_NAMES: ReadonlySet<string> = new Set(['Union']);
const CALLABLE_NAMES: ReadonlySet<string> = new Set(['Callable']);
const TUPLE_NAMES: ReadonlySet<string> = new Set(['Tuple', 'tuple']);
const LITERAL_NAMES: ReadonlySet<string> = new Set(['Literal']);
const ANY_NAMES: ReadonlySet<string> = new Set(['Any']);

/**
 * Calls that DECLARE a type variable.
 *
 * `typing.TypeVar` and a bare `TypeVar` are the same declaration, and an alias
 * from `import typing as t` reaches here as `t.TypeVar`, so the comparison is
 * on the simple name. PEP 612 `ParamSpec` and PEP 646 `TypeVarTuple` declare
 * related things with different arity rules and are deliberately not folded in
 * here -- they need their own kinds, not this one.
 */
const TYPE_VAR_FACTORIES: ReadonlySet<string> = new Set(['TypeVar']);

/**
 * Builds the `py_type_reference` tree for every type position in a module.
 *
 * ## The shape, and why it is a tree
 *
 * A composite annotation references several types that are **related to each
 * other**, so one row per annotation cannot carry it. Each reference gets its own
 * row, and `parentReferenceHash` + `position` + `depth` link them:
 *
 * ```python
 * def f(m: Dict[TypeA, TypeB]): ...
 *
 * d0  SUBSCRIPT  Dict    complete=Dict[TypeA, TypeB]
 * d1    NAME     TypeA   parent=<Dict>  position=0
 * d1    NAME     TypeB   parent=<Dict>  position=1
 * ```
 *
 * Note the shape differs deliberately from the `py_expression` tree for the same
 * text. There, `SUBSCRIPT` is a node and `Dict` is its first child. Here `Dict`
 * **is** the depth-0 reference and the subscript arguments are its children —
 * which is what `java_type_reference` does, and what makes "the type being
 * parameterised" and "its parameters" a parent/child pair rather than siblings.
 *
 * Nesting composes to any depth:
 *
 * ```python
 * x: Dict[TypeA, List[Optional[TypeB]]]
 *
 * d0  SUBSCRIPT Dict
 * d1    NAME      TypeA     parent=Dict      position=0
 * d1    SUBSCRIPT List      parent=Dict      position=1
 * d2      OPTIONAL Optional parent=List      position=0  isOptional
 * d3        NAME   TypeB    parent=Optional  position=0
 * ```
 */
export class PythonTypeReferenceExtractor {
  private references: PyTypeReferenceRegistry[] = [];
  /** reference PK -> `start:end` of the node it came from, for the expression join. */
  readonly byteRangeByReference = new Map<string, string>();
  private input!: TypeReferenceInput;

  /**
   * Type positions that appear inside expressions, not declarations.
   *
   * These were entirely absent: on 600 stdlib modules the contexts
   * ISINSTANCE_TYPE, ISSUBCLASS_TYPE and RAISE_TYPE were emitted ZERO times,
   * and so was the owner kind EXPRESSION, while `isinstance(x, Foo)` and
   * `raise ValueError(...)` appear in nearly every file. They are declared in
   * the enums, so nothing about the schema was waiting on a decision -- the
   * facts were simply never produced.
   *
   * They matter more than their column count suggests. A receiver whose type is
   * unknowable from its declaration is often pinned exactly once by an
   * `isinstance` guard, and that guard is the only static evidence there will
   * ever be. Emitting it turns a receiver that no join could resolve into one
   * that can be, without inventing anything: the reference is resolved by the
   * same pass that resolves an annotation, so it either names a type in the
   * corpus or stays empty.
   *
   * The owner is the CALL expression rather than the narrowed variable. Both
   * are defensible, but the call carries the position, and a consumer that
   * wants the variable can read the call's first argument -- whereas owning by
   * the variable would throw away WHERE the narrowing holds, which is the part
   * that makes it sound to use.
   */
  collectNarrowingPositions(input: NarrowingInput): TypePositionInput[] {
    const positions: TypePositionInput[] = [];
    this.walkNarrowing(input.rootNode, input, positions);
    return positions;
  }

  private walkNarrowing(
    node: Parser.SyntaxNode,
    input: NarrowingInput,
    positions: TypePositionInput[]
  ): void {
    if (node.type === 'call') {
      const callee = node.childForFieldName('function');
      const name = callee && callee.type === 'identifier' ? callee.text : '';
      if (name === 'isinstance' || name === 'issubclass') {
        const args = node.childForFieldName('arguments');
        const second = args ? this.positionalArgument(args, 1) : null;
        if (second) {
          const owner = input.expressionByByteRange.get(`${node.startIndex}:${node.endIndex}`);
          if (owner !== undefined) {
            const context =
              name === 'isinstance'
                ? PythonTypeRefContext.ISINSTANCE_TYPE
                : PythonTypeRefContext.ISSUBCLASS_TYPE;
            // `isinstance(x, (A, B))` is a tuple of alternatives, and each is a
            // separate candidate type rather than one composite type. Flattening
            // keeps every alternative individually resolvable.
            for (const candidate of this.tupleAlternatives(second)) {
              positions.push({
                node: candidate,
                context,
                ownerHash: owner,
                ownerKind: PythonTypeRefOwnerKind.EXPRESSION,
                enclosingTypeHash: input.typeByExpressionHash.get(owner) ?? '',
                scopeHash: input.scopeByExpressionHash.get(owner) ?? '',
              });
            }
          }
        }
      }
    }

    if (node.type === 'except_clause' || node.type === 'except_group_clause') {
      this.collectExceptPositions(node, input, positions);
    }

    if (node.type === 'raise_statement') {
      const raised = node.namedChild(0);
      if (raised) {
        // `raise ValueError(...)` names the type through the callee; `raise err`
        // and `raise ValueError` name it directly.
        const typeNode =
          raised.type === 'call' ? raised.childForFieldName('function') : raised;
        const ownerNode = raised;
        const owner = input.expressionByByteRange.get(
          `${ownerNode.startIndex}:${ownerNode.endIndex}`
        );
        if (typeNode && owner !== undefined) {
          positions.push({
            node: typeNode,
            context: PythonTypeRefContext.RAISE_TYPE,
            ownerHash: owner,
            ownerKind: PythonTypeRefOwnerKind.EXPRESSION,
            enclosingTypeHash: input.typeByExpressionHash.get(owner) ?? '',
            scopeHash: input.scopeByExpressionHash.get(owner) ?? '',
          });
        }
      }
    }

    for (let index = 0; index < node.namedChildCount; index += 1) {
      const child = node.namedChild(index);
      if (child) {
        this.walkNarrowing(child, input, positions);
      }
    }
  }

  /**
   * `except ValueError as e:` is the one narrowing construct that types a
   * VARIABLE outright, with no inference and no guard to reason about: inside
   * that handler `e` IS a ValueError. So where the handler binds a name, the
   * reference is owned by that BINDING rather than by an expression -- which is
   * what lets a consumer resolve `e.args` without having to notice that an
   * except clause was involved.
   *
   * Where there is no `as` the type is still worth recording, and it is owned by
   * the exception expression instead.
   *
   * `except (A, B) as e:` is flattened to one reference per alternative, as
   * isinstance is: `e` is one of them and each is separately resolvable.
   */
  private collectExceptPositions(
    node: Parser.SyntaxNode,
    input: NarrowingInput,
    positions: TypePositionInput[]
  ): void {
    const first = node.namedChild(0);
    if (!first) {
      return;
    }
    const isAs = first.type === 'as_pattern';
    const typeNode = isAs ? first.namedChild(0) : first;
    if (!typeNode || typeNode.type === 'block') {
      return;
    }

    let ownerHash = '';
    let ownerKind = PythonTypeRefOwnerKind.EXPRESSION;
    if (isAs) {
      const alias = first.namedChild(1);
      const target =
        alias && alias.type === 'as_pattern_target' ? alias.namedChild(0) : alias;
      const targetExpression = target
        ? input.expressionByByteRange.get(`${target.startIndex}:${target.endIndex}`)
        : undefined;
      const binding =
        targetExpression !== undefined
          ? input.bindingByExpressionHash.get(targetExpression)
          : undefined;
      if (binding !== undefined && binding !== '') {
        ownerHash = binding;
        ownerKind = PythonTypeRefOwnerKind.BINDING;
      }
    }
    if (ownerHash === '') {
      ownerHash =
        input.expressionByByteRange.get(`${typeNode.startIndex}:${typeNode.endIndex}`) ?? '';
      ownerKind = PythonTypeRefOwnerKind.EXPRESSION;
    }
    if (ownerHash === '') {
      return;
    }

    for (const candidate of this.tupleAlternatives(typeNode)) {
      positions.push({
        node: candidate,
        context: PythonTypeRefContext.EXCEPT_TYPE,
        ownerHash,
        ownerKind,
        enclosingTypeHash:
          ownerKind === PythonTypeRefOwnerKind.EXPRESSION
            ? input.typeByExpressionHash.get(ownerHash) ?? ''
            : '',
        scopeHash:
          ownerKind === PythonTypeRefOwnerKind.EXPRESSION
            ? input.scopeByExpressionHash.get(ownerHash) ?? ''
            : '',
      });
    }
  }

  /** The nth POSITIONAL argument, skipping keywords and splats. */
  private positionalArgument(args: Parser.SyntaxNode, wanted: number): Parser.SyntaxNode | null {
    let seen = 0;
    for (let index = 0; index < args.namedChildCount; index += 1) {
      const child = args.namedChild(index);
      if (!child || child.isExtra) {
        continue;
      }
      if (
        child.type === 'keyword_argument' ||
        child.type === 'list_splat' ||
        child.type === 'dictionary_splat'
      ) {
        continue;
      }
      if (seen === wanted) {
        return child;
      }
      seen += 1;
    }
    return null;
  }

  /** The members of `(A, B)`, or the node itself when it is not a tuple. */
  private tupleAlternatives(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const inner = this.unwrap(node);
    if (!inner) {
      return [];
    }
    if (inner.type !== 'tuple') {
      return [inner];
    }
    const members: Parser.SyntaxNode[] = [];
    for (let index = 0; index < inner.namedChildCount; index += 1) {
      const child = inner.namedChild(index);
      if (child && !child.isExtra) {
        members.push(child);
      }
    }
    return members;
  }

  private typeVariables: Map<string, TypeVariableDeclaration> = new Map();

  /**
   * One reference per bounded TypeVar, owned by the variable's own BINDING.
   *
   * A bound is a type position like any other, but it is not reachable from the
   * declaration walk: it sits inside a CALL on the right of an assignment, not
   * in an annotation, so nothing upstream collects it. It is synthesised here
   * because this is already the only place that knows which names are type
   * variables.
   *
   * The owner is the binding rather than the module, which is what the schema's
   * `referenceOwnerKind = BINDING` is for: the bound belongs to `B`, not to the
   * file `B` happens to sit in, and a consumer asking what constrains `B` joins
   * from the binding.
   *
   * A TypeVar whose binding cannot be found is skipped rather than owned by
   * something else. An unowned reference would be a row pointing at nothing,
   * which is worse than the absence it replaces.
   */
  private emitTypeVariableBounds(): void {
    for (const [name, declaration] of this.typeVariables) {
      if (declaration.bound === null) {
        continue;
      }
      const ownerHash = this.bindingHashForTypeVariable(name);
      if (ownerHash === null) {
        continue;
      }
      const node = this.unwrap(declaration.bound);
      if (!node) {
        continue;
      }
      this.emit(
        node,
        {
          node,
          context: PythonTypeRefContext.TYPEVAR_BOUND,
          ownerHash,
          ownerKind: PythonTypeRefOwnerKind.BINDING,
          enclosingTypeHash: '',
          scopeHash: this.input.moduleScopeHash,
        },
        PythonTypeRefContext.TYPEVAR_BOUND,
        '',
        0,
        0
      );
    }
  }

  extract(input: TypeReferenceInput): PyTypeReferenceRegistry[] {
    this.typeVariables = this.collectTypeVariables(input.rootNode);
    this.input = input;
    this.references = [];
    this.byteRangeByReference.clear();

    for (const position of input.positions) {
      const node = this.unwrap(position.node);
      if (node) {
        this.emit(node, position, position.context, '', 0, 0);
      }
    }
    this.emitTypeVariableBounds();
    return this.references;
  }

  /**
   * Strips the wrappers that carry no type of their own: the grammar's `type`
   * node and redundant parentheses.
   */
  private unwrap(node: Parser.SyntaxNode | null): Parser.SyntaxNode | null {
    let current = node;
    while (
      current &&
      (current.type === 'type' || current.type === 'parenthesized_expression')
    ) {
      current = current.namedChild(0);
    }
    return current;
  }

  /**
   * Emits one reference and recurses into its arguments.
   *
   * `context` is `GENERIC_ARGUMENT` for anything nested, so a query can tell "the
   * declared type of this parameter" from "a type mentioned inside it".
   */
  private emit(
    node: Parser.SyntaxNode,
    position: TypePositionInput,
    context: PythonTypeRefContext,
    parentHash: string,
    index: number,
    depth: number
  ): PyTypeReferenceRegistry | null {
    if (depth > 12) {
      // Annotations nest a few levels in practice; this only guards pathological
      // or malformed input.
      return null;
    }

    const base = this.subscriptBase(node);
    const typeName = this.simpleNameOf(base ?? node);
    // A name bound by TypeVar() is a type VARIABLE, not a reference to a class
    // of that name. Only a bare name is reclassified: in `List[T]` the head is
    // List and the variable is the argument, each of which gets its own row.
    const declaredVariance =
      base === null ? this.typeVariables.get(typeName)?.variance : undefined;
    const kind =
      declaredVariance !== undefined
        ? PythonTypeRefKind.TYPE_VAR
        : this.kindOf(node, base);
    const complete = EntityUtils.normalizeWhitespace(node.text)
      .replace(/\[\s+/g, '[')
      .replace(/\s+\]/g, ']')
      .replace(/\s+,/g, ',');

    const reference = PyTypeReferenceRegistry.builder(
      kind,
      context,
      typeName,
      complete,
      position.ownerHash,
      position.ownerKind,
      this.input.pyModuleLinkHash,
      node.startPosition.row + 1,
      this.input.serviceVersionLinkHash
    )
      .withNesting(parentHash, index, depth)
      .withEnclosingType(position.enclosingTypeHash)
      .withScope(position.scopeHash)
      .withSpan(node.startPosition.row + 1, node.endPosition.row + 1)
      .withFlags({
        isStringForwardRef: kind === PythonTypeRefKind.STRING_FORWARD_REF,
        isOptional: this.admitsNone(node, kind),
      })
      .withTypeVariable(
        declaredVariance !== undefined ? typeName : '',
        declaredVariance ?? ''
      )
      .build();

    this.references.push(reference);
    this.byteRangeByReference.set(reference.getHash(), `${node.startIndex}:${node.endIndex}`);

    // Children: subscript arguments, or the operands of a PEP 604 union.
    const children = this.argumentsOf(node);
    children.forEach((child, childIndex) => {
      const inner = this.unwrap(child);
      if (inner) {
        this.emit(
          inner,
          position,
          PythonTypeRefContext.GENERIC_ARGUMENT,
          reference.getHash(),
          childIndex,
          depth + 1
        );
      }
    });

    return reference;
  }

  /**
   * The arguments of a composite type, in source order.
   *
   * Three shapes, each nesting differently: a subscript's indices, a PEP 604
   * union's operands, and `Callable[[A, B], R]` where the parameter list is a
   * LIST one level deeper — its elements are flattened in so `A` and `B` are
   * arguments of `Callable` rather than of an anonymous list.
   */
  private argumentsOf(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const out: Parser.SyntaxNode[] = [];

    if (node.type === 'binary_operator') {
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (left) {
        out.push(left);
      }
      if (right) {
        out.push(right);
      }
      return out;
    }

    if (node.type === 'generic_type') {
      for (let i = 1; i < node.namedChildCount; i++) {
        const parameterList = node.namedChild(i);
        if (parameterList?.type !== 'type_parameter') {
          continue;
        }
        for (let j = 0; j < parameterList.namedChildCount; j++) {
          const argument = parameterList.namedChild(j);
          if (argument && !argument.isExtra) {
            out.push(...this.flattenCallableList(argument));
          }
        }
      }
      return out;
    }

    if (node.type === 'subscript') {
      const value = node.childForFieldName('value');
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (!child || child.id === value?.id || child.isExtra) {
          continue;
        }
        out.push(...this.flattenCallableList(child));
      }
      return out;
    }

    return out;
  }

  /** `Callable[[A, B], R]` — the bracketed parameter list is not itself a type. */
  private flattenCallableList(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const inner = this.unwrap(node);
    if (!inner || inner.type !== 'list') {
      return inner ? [inner] : [];
    }
    const out: Parser.SyntaxNode[] = [];
    for (let i = 0; i < inner.namedChildCount; i++) {
      const element = inner.namedChild(i);
      if (element && !element.isExtra) {
        out.push(element);
      }
    }
    return out;
  }

  /** The base of a subscript: the `Dict` in `Dict[str, int]`. */
  private subscriptBase(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (node.type === 'generic_type') {
      return node.namedChild(0);
    }
    if (node.type === 'subscript') {
      return node.childForFieldName('value') ?? node.namedChild(0);
    }
    return null;
  }

  /**
   * Names bound by `X = TypeVar("X")`, mapped to their declared variance.
   *
   * Without this a type variable is indistinguishable from an ordinary class:
   * `List[T]` and `List[Options]` both emit `kind=NAME`, so a consumer
   * resolving the element type looks for a class named `T`, finds nothing, and
   * records an unresolved reference -- or worse, finds an unrelated class that
   * happens to share the name.
   *
   * The whole module is scanned rather than only its top level. A TypeVar is
   * conventionally declared at module scope, but nothing requires it, and one
   * declared inside a function is still a type variable everywhere it is used.
   */
  private collectTypeVariables(root: Parser.SyntaxNode): Map<string, TypeVariableDeclaration> {
    const found = new Map<string, TypeVariableDeclaration>();
    const worklist: Parser.SyntaxNode[] = [root];
    while (worklist.length > 0) {
      const node = worklist.pop();
      if (!node) {
        continue;
      }
      if (node.type === 'assignment') {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (left?.type === 'identifier' && right?.type === 'call') {
          const fn = right.childForFieldName('function');
          if (fn && TYPE_VAR_FACTORIES.has(this.simpleNameOf(fn))) {
            found.set(left.text, {
              variance: this.varianceOf(right),
              bound: this.boundOf(right),
            });
          }
        }
      }
      for (let i = 0; i < node.namedChildCount; i += 1) {
        const child = node.namedChild(i);
        if (child) {
          worklist.push(child);
        }
      }
    }
    return found;
  }

  /**
   * The `bound=` argument of a TypeVar declaration, or null.
   *
   * `TypeVar("B", bound=Base)` constrains B to Base and subclasses, and the
   * schema has a context for exactly this. Without it the constraint is dropped
   * on the floor: the variable is emitted, the class is emitted, and nothing
   * records that one bounds the other.
   *
   * The CONSTRAINT form `TypeVar("C", int, str)` is a different thing -- a
   * closed set of alternatives rather than an upper bound -- and the schema has
   * no context for it, so those positional arguments are deliberately ignored
   * rather than reported as bounds, which would be a wrong answer rather than a
   * missing one.
   */
  private boundOf(call: Parser.SyntaxNode): Parser.SyntaxNode | null {
    const args = call.childForFieldName('arguments');
    if (!args) {
      return null;
    }
    for (let i = 0; i < args.namedChildCount; i += 1) {
      const arg = args.namedChild(i);
      if (arg?.type !== 'keyword_argument') {
        continue;
      }
      if ((arg.childForFieldName('name')?.text ?? '') === 'bound') {
        return arg.childForFieldName('value') ?? null;
      }
    }
    return null;
  }

  /**
   * The binding a TypeVar name belongs to, or null if it cannot be pinned down.
   *
   * The module scope is tried first, because that is where a TypeVar is
   * conventionally declared and the answer is then unambiguous. Nothing
   * requires it though, and one declared inside a function is still a type
   * variable with a real bound:
   *
   * ```python
   * def scoped():
   *     Inner = TypeVar("Inner", bound=Base)
   * ```
   *
   * That binding lives in the function's scope, so the module lookup missed and
   * the bound was silently dropped. The fallback searches every scope, and
   * accepts the result only when EXACTLY ONE scope binds the name. Two scopes
   * binding the same TypeVar name is a genuine ambiguity, and picking either
   * would attach the bound to a variable that may not have it -- an unowned or
   * wrongly owned reference is worse than the absence it replaces, which is the
   * same reason a missing binding is skipped rather than owned by the module.
   */
  private bindingHashForTypeVariable(name: string): string | null {
    const atModule = this.input.bindingHashByScopeAndName.get(
      `${this.input.moduleScopeHash}::${name}`
    );
    if (atModule !== undefined && atModule !== '') {
      return atModule;
    }
    const suffix = `::${name}`;
    let found: string | null = null;
    for (const [key, hash] of this.input.bindingHashByScopeAndName) {
      if (!key.endsWith(suffix) || hash === '') {
        continue;
      }
      if (found !== null) {
        return null;
      }
      found = hash;
    }
    return found;
  }

  /** `covariant=True` / `contravariant=True`; invariant is the default. */
  private varianceOf(call: Parser.SyntaxNode): string {
    const args = call.childForFieldName('arguments');
    if (!args) {
      return PythonWildcardVariance.INVARIANT;
    }
    for (let i = 0; i < args.namedChildCount; i += 1) {
      const arg = args.namedChild(i);
      if (arg?.type !== 'keyword_argument') {
        continue;
      }
      const name = arg.childForFieldName('name')?.text ?? '';
      const value = arg.childForFieldName('value')?.text ?? '';
      if (value !== 'True') {
        continue;
      }
      if (name === 'covariant') {
        return PythonWildcardVariance.COVARIANT;
      }
      if (name === 'contravariant') {
        return PythonWildcardVariance.CONTRAVARIANT;
      }
    }
    return PythonWildcardVariance.INVARIANT;
  }

  private kindOf(
    node: Parser.SyntaxNode,
    base: Parser.SyntaxNode | null
  ): PythonTypeRefKind {
    if (node.type === 'binary_operator') {
      return PythonTypeRefKind.UNION_PEP604;
    }
    if (node.type === 'string' || node.type === 'concatenated_string') {
      return PythonTypeRefKind.STRING_FORWARD_REF;
    }
    if (node.type === 'none') {
      return PythonTypeRefKind.NONE_TYPE;
    }
    if (node.type === 'ellipsis') {
      return PythonTypeRefKind.ELLIPSIS_TYPE;
    }

    if (base !== null) {
      const name = this.simpleNameOf(base);
      if (OPTIONAL_NAMES.has(name)) {
        return PythonTypeRefKind.OPTIONAL;
      }
      if (UNION_NAMES.has(name)) {
        return PythonTypeRefKind.UNION_PEP604;
      }
      if (CALLABLE_NAMES.has(name)) {
        return PythonTypeRefKind.CALLABLE;
      }
      if (TUPLE_NAMES.has(name)) {
        return PythonTypeRefKind.TUPLE_TYPE;
      }
      if (LITERAL_NAMES.has(name)) {
        return PythonTypeRefKind.LITERAL_TYPE;
      }
      return PythonTypeRefKind.SUBSCRIPT;
    }

    if (node.type === 'identifier') {
      return ANY_NAMES.has(node.text) ? PythonTypeRefKind.ANY : PythonTypeRefKind.NAME;
    }
    if (node.type === 'attribute' || node.type === 'member_type') {
      return PythonTypeRefKind.DOTTED_NAME;
    }
    return PythonTypeRefKind.UNKNOWN;
  }

  /**
   * Whether this reference admits `None`.
   *
   * `Optional[X]` by definition, and `Union[..., None]` or `X | None` by having a
   * `None` member. `isOptional` is the #1 subscript in the corpus at 3,517
   * occurrences, so it earns a column rather than being re-derived.
   */
  private admitsNone(node: Parser.SyntaxNode, kind: PythonTypeRefKind): boolean {
    if (kind === PythonTypeRefKind.OPTIONAL) {
      return true;
    }
    if (kind !== PythonTypeRefKind.UNION_PEP604) {
      return false;
    }
    return this.argumentsOf(node).some(argument => {
      const inner = this.unwrap(argument);
      return inner?.type === 'none';
    });
  }

  private simpleNameOf(node: Parser.SyntaxNode): string {
    switch (node.type) {
      case 'identifier': {
        return node.text;
      }
      case 'attribute': {
        return node.childForFieldName('attribute')?.text ?? '';
      }
      case 'member_type': {
        return node.namedChild(node.namedChildCount - 1)?.text ?? '';
      }
      case 'dotted_name': {
        return node.namedChild(node.namedChildCount - 1)?.text ?? '';
      }
      case 'string':
      case 'concatenated_string': {
        for (let i = 0; i < node.namedChildCount; i++) {
          const part = node.namedChild(i);
          if (part?.type === 'string_content') {
            // A forward reference names a type; the quotes are not part of it.
            return part.text.split('[')[0]!.trim();
          }
        }
        return '';
      }
      case 'none': {
        return 'None';
      }
      case 'generic_type':
      case 'subscript': {
        const base = this.subscriptBase(node);
        return base ? this.simpleNameOf(base) : '';
      }
      default: {
        return '';
      }
    }
  }
}
