import Parser from 'tree-sitter';

import {
  PyDecoratorArgumentRegistry,
  PyDecoratorRegistry,
  PyModuleRegistry,
} from '@/analysis-types/python';
import {
  PythonBuiltinDecoratorKind,
  PythonDecoratorArgumentValueType,
  PythonDecoratorContext,
  PythonDecoratorKind,
} from '@/enums/python/decorators';

/** Everything the decorator stage produces for one module. */
export interface PythonDecoratorExtraction {
  decorators: PyDecoratorRegistry[];
  decoratorArguments: PyDecoratorArgumentRegistry[];
  /** `py_decorator` PK -> the decorator expression's `startIndex:endIndex`. */
  expressionRangeByDecorator: Map<string, string>;
  /** `py_decorator_argument` PK -> the argument's `startIndex:endIndex`. */
  expressionRangeByArgument: Map<string, string>;
}

export interface PythonDecoratorInput {
  module: PyModuleRegistry;
  rootNode: Parser.SyntaxNode;
  serviceVersionLinkHash: string;
  typeHashByNodeId: Map<number, string>;
  methodHashByNodeId: Map<number, string>;
}

/**
 * Builtin decorators, and whether each REPLACES what it decorates.
 *
 * The replacement flag is the load-bearing half. `@staticmethod` and
 * `@classmethod` are descriptors that change how the function is BOUND but leave
 * a call reaching the same body, so a call-graph edge to the `def` survives.
 * `@lru_cache` and `@contextmanager` return a different object entirely, so
 * after decoration the name does not refer to the `def` at all and an edge to it
 * is a runtime lie.
 *
 * `@property` sits with the replacers: `obj.x` on a property is a CALL, not an
 * attribute read, and treating the name as the function it decorates loses that.
 */
const BUILTIN_DECORATORS: ReadonlyMap<string, { kind: PythonBuiltinDecoratorKind; replaces: boolean }> =
  new Map([
    ['staticmethod', { kind: PythonBuiltinDecoratorKind.STATICMETHOD, replaces: false }],
    ['classmethod', { kind: PythonBuiltinDecoratorKind.CLASSMETHOD, replaces: false }],
    ['abstractmethod', { kind: PythonBuiltinDecoratorKind.ABSTRACTMETHOD, replaces: false }],
    ['overload', { kind: PythonBuiltinDecoratorKind.OVERLOAD, replaces: false }],
    ['final', { kind: PythonBuiltinDecoratorKind.FINAL, replaces: false }],
    ['wraps', { kind: PythonBuiltinDecoratorKind.WRAPS, replaces: false }],
    ['property', { kind: PythonBuiltinDecoratorKind.PROPERTY, replaces: true }],
    ['setter', { kind: PythonBuiltinDecoratorKind.SETTER, replaces: true }],
    ['deleter', { kind: PythonBuiltinDecoratorKind.DELETER, replaces: true }],
    ['cached_property', { kind: PythonBuiltinDecoratorKind.CACHED_PROPERTY, replaces: true }],
    ['lru_cache', { kind: PythonBuiltinDecoratorKind.LRU_CACHE, replaces: true }],
    ['cache', { kind: PythonBuiltinDecoratorKind.LRU_CACHE, replaces: true }],
    ['dataclass', { kind: PythonBuiltinDecoratorKind.DATACLASS, replaces: false }],
    ['contextmanager', { kind: PythonBuiltinDecoratorKind.CONTEXTMANAGER, replaces: true }],
    ['asynccontextmanager', { kind: PythonBuiltinDecoratorKind.CONTEXTMANAGER, replaces: true }],
    ['deprecated', { kind: PythonBuiltinDecoratorKind.DEPRECATED, replaces: true }],
    ['no_type_check', { kind: PythonBuiltinDecoratorKind.NO_TYPE_CHECK, replaces: false }],
  ]);

/**
 * Extracts `py_decorator` and `py_decorator_argument`.
 *
 * A decorator is not metadata. It is a call that runs at definition time and
 * whose result is rebound to the decorated name, and two consequences drive the
 * whole design here:
 *
 * 1. **They execute bottom-up.** The decorator nearest the `def` runs first, so
 *    the source order a reader sees is the reverse of the order that runs. Both
 *    are emitted — `position` for what is written, `applicationOrder` for what
 *    happens — because a question like "does auth run before routing" needs the
 *    second and only the second.
 * 2. **They can replace the target.** `@lru_cache` hands back a wrapper, so the
 *    decorated name no longer refers to the `def`. `replacesTarget` records that,
 *    and without it a call graph asserts an edge the runtime does not have.
 */
export class PythonDecoratorExtractor {
  private input!: PythonDecoratorInput;
  private decorators: PyDecoratorRegistry[] = [];
  private decoratorArguments: PyDecoratorArgumentRegistry[] = [];
  private expressionRangeByDecorator = new Map<string, string>();
  private expressionRangeByArgument = new Map<string, string>();

  extract(input: PythonDecoratorInput): PythonDecoratorExtraction {
    this.input = input;
    this.decorators = [];
    this.decoratorArguments = [];
    this.expressionRangeByDecorator = new Map();
    this.expressionRangeByArgument = new Map();

    this.walk(input.rootNode, false);

    return {
      decorators: this.decorators,
      decoratorArguments: this.decoratorArguments,
      expressionRangeByDecorator: this.expressionRangeByDecorator,
      expressionRangeByArgument: this.expressionRangeByArgument,
    };
  }

  /**
   * Finds every `decorated_definition`.
   *
   * `insideFunction` is threaded because it decides `context`: a decorated `def`
   * inside another function is a NESTED_FUNCTION_DECLARATION, which is the shape
   * every decorator factory has internally and is worth telling apart from a
   * module-level or class-level method.
   */
  private walk(node: Parser.SyntaxNode, insideFunction: boolean): void {
    if (node.type === 'decorated_definition') {
      this.visitDecorated(node, insideFunction);
    }
    const entersFunction = node.type === 'function_definition' || node.type === 'lambda';
    for (let index = 0; index < node.namedChildCount; index += 1) {
      const child = node.namedChild(index);
      if (child && !child.isExtra) {
        this.walk(child, insideFunction || entersFunction);
      }
    }
  }

  private visitDecorated(node: Parser.SyntaxNode, insideFunction: boolean): void {
    const definition = node.childForFieldName('definition');
    if (!definition) {
      return;
    }

    const decoratorNodes: Parser.SyntaxNode[] = [];
    for (let index = 0; index < node.namedChildCount; index += 1) {
      const child = node.namedChild(index);
      if (child && child.type === 'decorator' && !child.isExtra) {
        decoratorNodes.push(child);
      }
    }
    if (decoratorNodes.length === 0) {
      return;
    }

    const isClass = definition.type === 'class_definition';
    const ownerHash = isClass
      ? this.input.typeHashByNodeId.get(definition.id) ?? ''
      : this.input.methodHashByNodeId.get(definition.id) ?? '';
    if (ownerHash === '') {
      return;
    }
    const context = isClass
      ? PythonDecoratorContext.TYPE_DECLARATION
      : insideFunction
        ? PythonDecoratorContext.NESTED_FUNCTION_DECLARATION
        : PythonDecoratorContext.METHOD_DECLARATION;

    decoratorNodes.forEach((decoratorNode, position) => {
      // Bottom-up: the decorator written LAST is applied FIRST.
      const applicationOrder = decoratorNodes.length - 1 - position;
      this.emitDecorator(
        decoratorNode,
        ownerHash,
        context,
        isClass,
        position,
        applicationOrder
      );
    });
  }

  private emitDecorator(
    decoratorNode: Parser.SyntaxNode,
    ownerHash: string,
    context: PythonDecoratorContext,
    isClass: boolean,
    position: number,
    applicationOrder: number
  ): void {
    // The decorator node includes the `@`; the EXPRESSION is its named child.
    const expression = decoratorNode.namedChild(0);
    if (!expression) {
      return;
    }
    const shape = this.shapeOf(expression);
    const builtin = BUILTIN_DECORATORS.get(shape.name);

    const builder = PyDecoratorRegistry.builder(
      shape.name,
      shape.kind,
      context,
      ownerHash,
      this.normalize(decoratorNode.text),
      position,
      decoratorNode.startPosition.row + 1,
      this.input.module.getHash(),
      this.input.serviceVersionLinkHash
    )
      .withApplicationOrder(applicationOrder)
      .withEndLine(decoratorNode.endPosition.row + 1)
      .withDottedPath(shape.dottedPath)
      .withOwnerLinks(isClass ? ownerHash : '', isClass ? '' : ownerHash);

    // EMPTY for a decorator that is not a call, per §2.12. I had set it to '0'
    // on the reasoning that "zero arguments" is a fact and an empty column is
    // invisible to a query. A0 corrected it and is right: 0 asserts CALLED WITH
    // NOTHING, and `@property` was never called at all. There is no argument
    // list to have a length. `@f()` and `@f` differ in exactly this, and
    // collapsing them would make the column unable to express the difference --
    // the reverse of the problem I thought I was fixing.
    if (shape.arguments) {
      builder.withArgumentCount(String(this.positionalAndKeyword(shape.arguments).length));
    }
    if (builtin) {
      builder.withBuiltin(builtin.kind, builtin.replaces);
    } else {
      // An unknown decorator is ASSUMED to replace its target. That is the
      // conservative direction: the overwhelming majority of hand-written
      // decorators return a wrapper, and claiming otherwise would assert a
      // call-graph edge to a `def` the name no longer refers to.
      builder.withBuiltin(PythonBuiltinDecoratorKind.NONE, true);
    }

    const decorator = builder.build();
    this.decorators.push(decorator);
    this.expressionRangeByDecorator.set(
      decorator.getHash(),
      `${expression.startIndex}:${expression.endIndex}`
    );

    if (shape.arguments) {
      this.emitArguments(shape.arguments, decorator.getHash());
    }
  }

  private emitArguments(args: Parser.SyntaxNode, parentHash: string): void {
    this.positionalAndKeyword(args).forEach((argument, position) => {
      const isKeyword = argument.type === 'keyword_argument';
      const isStarred =
        argument.type === 'list_splat' || argument.type === 'dictionary_splat';
      const nameNode = isKeyword ? argument.childForFieldName('name') : null;
      const valueNode = isKeyword ? argument.childForFieldName('value') : argument;
      if (!valueNode) {
        return;
      }

      // A LIST or TUPLE argument is emitted one row per ELEMENT, as Java does for
      // an array-valued annotation argument. `methods=["GET", "POST"]` is two
      // verbs, and collapsing them into one row would force every consumer to
      // re-parse the text we already have parsed.
      const elements = this.splittableElements(valueNode);
      if (elements.length > 0) {
        elements.forEach((element, arrayIndex) => {
          this.pushArgument(
            nameNode?.text ?? '',
            element,
            position,
            parentHash,
            String(arrayIndex),
            isKeyword,
            isStarred
          );
        });
        return;
      }
      this.pushArgument(
        nameNode?.text ?? '',
        valueNode,
        position,
        parentHash,
        '',
        isKeyword,
        isStarred
      );
    });
  }

  private pushArgument(
    argumentName: string,
    valueNode: Parser.SyntaxNode,
    position: number,
    parentHash: string,
    arrayIndex: string,
    isKeyword: boolean,
    isStarred: boolean
  ): void {
    const argument = new PyDecoratorArgumentRegistry(
      argumentName,
      this.literalText(valueNode),
      this.valueTypeOf(valueNode),
      position,
      parentHash,
      arrayIndex,
      valueNode.startPosition.row + 1,
      valueNode.endPosition.row + 1,
      isKeyword,
      isStarred,
      this.input.serviceVersionLinkHash
    );
    this.decoratorArguments.push(argument);
    this.expressionRangeByArgument.set(
      argument.getHash(),
      `${valueNode.startIndex}:${valueNode.endIndex}`
    );
  }

  /** The named children of an argument list, minus comments. */
  private positionalAndKeyword(args: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const found: Parser.SyntaxNode[] = [];
    for (let index = 0; index < args.namedChildCount; index += 1) {
      const child = args.namedChild(index);
      if (child && !child.isExtra) {
        found.push(child);
      }
    }
    return found;
  }

  /** Elements of a list/tuple/set literal, or `[]` for anything else. */
  private splittableElements(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    if (node.type !== 'list' && node.type !== 'tuple' && node.type !== 'set') {
      return [];
    }
    return this.positionalAndKeyword(node);
  }

  /**
   * Classifies the decorator expression.
   *
   * `decoratorName` is the RIGHTMOST identifier, so `@app.route("/x")` is named
   * `route` and its `dottedPath` is `app.route` — matching how a consumer thinks
   * about it, and keeping the name comparable with a bare `@route`.
   */
  private shapeOf(expression: Parser.SyntaxNode): {
    name: string;
    kind: PythonDecoratorKind;
    dottedPath: string;
    arguments: Parser.SyntaxNode | null;
  } {
    if (expression.type === 'call') {
      const callee = expression.childForFieldName('function');
      const args = expression.childForFieldName('arguments');
      const dotted = this.pureDottedName(callee);
      if (dotted === '') {
        // PEP 614: the callee can be any expression, as in `@null(null)(null)`
        // whose callee is itself a call. It is a call, but not a call OF A NAME,
        // and there is nothing for dottedPath to point at.
        return {
          name: this.rightmostName(callee),
          kind: PythonDecoratorKind.EXPRESSION,
          dottedPath: '',
          arguments: args ?? null,
        };
      }
      return {
        name: this.rightmostName(callee),
        kind: dotted.includes('.')
          ? PythonDecoratorKind.ATTRIBUTE_CALL
          : PythonDecoratorKind.CALL,
        dottedPath: dotted,
        arguments: args ?? null,
      };
    }
    if (expression.type === 'attribute') {
      // KIND stays syntactic and dottedPath carries resolvability: they are
      // two different facts and collapsing them loses one.
      // `@[null][0].__call__.__call__` IS an attribute access, and saying so
      // costs nothing now that dottedPath no longer claims it can be resolved.
      return {
        name: this.rightmostName(expression),
        kind: PythonDecoratorKind.ATTRIBUTE,
        dottedPath: this.pureDottedName(expression),
        arguments: null,
      };
    }
    if (expression.type === 'identifier') {
      return {
        name: expression.text,
        kind: PythonDecoratorKind.BARE,
        // A single segment IS a dotted path of length one. Leaving it empty
        // meant `@contextlib.contextmanager` was joinable by dottedPath and
        // `@classmethod` was not, so every consumer had to special-case the
        // bare form and fall back to decoratorName.
        dottedPath: expression.text,
        arguments: null,
      };
    }
    if (expression.type === 'subscript') {
      return {
        name: this.rightmostName(expression.childForFieldName('value')),
        kind: PythonDecoratorKind.SUBSCRIPT,
        // `@Registry[int]` points at `Registry`; the subscript is not part of
        // any name. The full text with brackets in it was never resolvable.
        dottedPath: this.pureDottedName(expression.childForFieldName('value')),
        arguments: null,
      };
    }
    // PEP 614 removed the grammar restriction, so any expression is legal here.
    return {
      name: this.rightmostName(expression),
      kind: PythonDecoratorKind.EXPRESSION,
      dottedPath: '',
      arguments: null,
    };
  }

  /**
   * The dotted path, but ONLY when the whole expression is a name chain.
   *
   * PEP 614 allows any expression as a decorator, and CPython's own
   * test_grammar.py exercises `@[null][0].__call__.__call__` and
   * `@[..., null, ...][1]`. Normalising the raw text put strings like
   * `[null][0].__call__.__call__` and `null(null)` into dottedPath -- a column
   * whose only purpose is to be joined against a resolvable entity. Nothing can
   * ever match those, so they were not a link but the appearance of one, and a
   * consumer counting resolvable decorators would have counted them.
   *
   * Empty means "this decorator has no name to resolve", which is a true and
   * checkable statement. `decoratorName` still carries the rightmost identifier,
   * because that is informative without claiming to be resolvable.
   */
  private pureDottedName(node: Parser.SyntaxNode | null | undefined): string {
    if (!node) {
      return '';
    }
    if (node.type === 'identifier') {
      return node.text;
    }
    if (node.type === 'attribute') {
      const base = this.pureDottedName(node.childForFieldName('object'));
      if (base === '') {
        return '';
      }
      const attribute = node.childForFieldName('attribute');
      return attribute ? `${base}.${attribute.text}` : '';
    }
    return '';
  }

  private rightmostName(node: Parser.SyntaxNode | null | undefined): string {
    if (!node) {
      return '';
    }
    if (node.type === 'identifier') {
      return node.text;
    }
    if (node.type === 'attribute') {
      return node.childForFieldName('attribute')?.text ?? '';
    }
    const last = node.namedChild(node.namedChildCount - 1);
    return last && last !== node ? this.rightmostName(last) : '';
  }

  private valueTypeOf(node: Parser.SyntaxNode): PythonDecoratorArgumentValueType {
    switch (node.type) {
      case 'string':
      case 'concatenated_string': {
        const start = node.child(0);
        return (start?.text ?? '').toLowerCase().includes('f')
          ? PythonDecoratorArgumentValueType.FSTRING
          : PythonDecoratorArgumentValueType.STRING_LITERAL;
      }
      case 'integer':
      case 'float': {
        return PythonDecoratorArgumentValueType.NUMBER_LITERAL;
      }
      case 'true':
      case 'false': {
        return PythonDecoratorArgumentValueType.BOOLEAN_LITERAL;
      }
      case 'none': {
        return PythonDecoratorArgumentValueType.NONE_LITERAL;
      }
      case 'list': {
        return PythonDecoratorArgumentValueType.LIST;
      }
      case 'dictionary': {
        return PythonDecoratorArgumentValueType.DICT;
      }
      case 'tuple': {
        return PythonDecoratorArgumentValueType.TUPLE;
      }
      case 'set': {
        return PythonDecoratorArgumentValueType.SET;
      }
      case 'identifier': {
        return PythonDecoratorArgumentValueType.NAME_REFERENCE;
      }
      case 'attribute': {
        return PythonDecoratorArgumentValueType.ATTRIBUTE_REFERENCE;
      }
      case 'call': {
        return PythonDecoratorArgumentValueType.CALL;
      }
      case 'lambda': {
        return PythonDecoratorArgumentValueType.LAMBDA;
      }
      default: {
        return PythonDecoratorArgumentValueType.UNKNOWN;
      }
    }
  }

  /** A string argument's VALUE, quotes stripped; other nodes keep their text. */
  private literalText(node: Parser.SyntaxNode): string {
    const text = this.normalize(node.text);
    if (node.type !== 'string') {
      return text;
    }
    const quote = text.search(/['"]/);
    if (quote < 0) {
      return text;
    }
    return text
      .slice(quote)
      .replace(/^('''|"""|'|")/, '')
      .replace(/('''|"""|'|")$/, '');
  }

  private normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }
}
